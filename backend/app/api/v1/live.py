"""REST and WebSocket endpoints for source-agnostic live bioacoustic streaming, soundscape, and disturbance intelligence."""

from __future__ import annotations

import json
import logging
import shutil
import struct
import uuid
import wave
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.core.database import async_session_factory, get_db
from app.core.logging import logger
from app.models.analysis import Analysis, EmbeddingSegment
from app.models.detection import Detection
from app.models.live_session import LiveEvent, LiveSegment, LiveSession
from app.models.soundscape import (
    CoOccurrenceObservation,
    DisturbanceEvent,
    SoundscapeMeasurement,
)
from app.schemas.live_session import (
    LiveEventResponse,
    LiveSegmentResponse,
    LiveSessionCreate,
    LiveSessionDetailResponse,
    LiveSessionResponse,
    LiveSessionStats,
)
from app.schemas.soundscape import (
    AnomalyCandidateResponse,
    CoOccurrenceObservationResponse,
    DisturbanceEventResponse,
    SessionIntelligenceResponse,
    SoundscapeFingerprintResponse,
    SoundscapeMeasurementResponse,
    SoundscapeMetrics,
    TimelineItemResponse,
)
from app.services.acoustic_anomaly_service import acoustic_anomaly_service
from app.services.direct_onnx_engine import direct_onnx_engine
from app.services.ecological_analysis_service import ecological_analysis_service
from app.services.storage_service import storage_service
from app.services.live.session_manager import (
    LiveSessionState,
    get_hardware_metrics,
    live_session_manager,
)
from app.services.soundscape.disturbance_service import disturbance_service

router = APIRouter(prefix="/live", tags=["Live Bioacoustic Intelligence"])

MAX_FRAME_SIZE_BYTES = 128 * 1024  # 128 KB (~2 seconds of 32kHz mono PCM16)
FRAME_RATE_LIMIT_HZ = 200  # Max frames per second per connection


# ============================================================================
# Session Management Endpoints
# ============================================================================

@router.post(
    "/sessions",
    response_model=LiveSessionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new live bioacoustic streaming session",
)
async def create_live_session(
    payload: LiveSessionCreate,
    db: AsyncSession = Depends(get_db),
):
    session_id = str(uuid.uuid4())
    live_session = LiveSession(
        id=session_id,
        source_type=payload.source_type,
        device_id=payload.device_id,
        site_id=payload.site_id,
        latitude=payload.latitude,
        longitude=payload.longitude,
        gps_accuracy_m=payload.gps_accuracy_m,
        gps_captured_at=payload.gps_captured_at,
        sample_rate=payload.sample_rate,
        channels=payload.channels,
        status="created",
    )
    db.add(live_session)
    await db.commit()
    await db.refresh(live_session)

    # Initialize in-memory session coordinator
    await live_session_manager.create_session(
        session_id=session_id,
        sample_rate=payload.sample_rate,
        channels=payload.channels,
    )

    return LiveSessionResponse.model_validate(live_session)


@router.get(
    "/sessions",
    response_model=List[LiveSessionResponse],
    summary="List all live sessions with filtering and pagination",
)
async def list_live_sessions(
    source_type: Optional[str] = Query(None, description="Filter by source type"),
    status: Optional[str] = Query(None, description="Filter by session status"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(
            LiveSession,
            func.count(func.distinct(LiveEvent.id)).label("events_count"),
            func.count(func.distinct(LiveSegment.id)).label("segments_count"),
        )
        .outerjoin(LiveEvent, LiveSession.id == LiveEvent.session_id)
        .outerjoin(LiveSegment, LiveSession.id == LiveSegment.session_id)
        .group_by(LiveSession.id)
        .order_by(LiveSession.created_at.desc())
        .limit(limit)
        .offset(offset)
    )

    if source_type:
        query = query.where(LiveSession.source_type == source_type)
    if status:
        query = query.where(LiveSession.status == status)

    result = await db.execute(query)
    rows = result.all()

    responses: List[LiveSessionResponse] = []
    for row in rows:
        session_obj = row[0]
        events_cnt = row[1]
        segments_cnt = row[2]
        resp = LiveSessionResponse.model_validate(session_obj)
        resp.events_count = events_cnt
        resp.segments_count = segments_cnt
        responses.append(resp)

    return responses


@router.get(
    "/sessions/{session_id}",
    response_model=LiveSessionDetailResponse,
    summary="Get detailed live session state, events, segments, and live metrics",
)
async def get_live_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(LiveSession)
        .options(
            selectinload(LiveSession.events),
            selectinload(LiveSession.segments),
        )
        .where(LiveSession.id == session_id)
    )
    result = await db.execute(query)
    session_obj = result.scalar_one_or_none()
    if not session_obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Live session {session_id} not found.",
        )

    # In-memory stats if active
    mem_state = live_session_manager.get_session(session_id)
    stats: Optional[LiveSessionStats] = None
    if mem_state:
        stats = mem_state.get_stats()
    else:
        # Generate summary stats from persisted data
        hw = get_hardware_metrics()
        stats = LiveSessionStats(
            audio_capture_rate=0.0,
            audio_input_continuity=100.0,
            avg_inference_latency_ms=0.0,
            avg_embedding_latency_ms=0.0,
            window_processing_lag_ms=0.0,
            e2e_event_delivery_latency_ms=0.0,
            dropped_frames=session_obj.dropped_frames,
            dropped_windows=session_obj.dropped_windows,
            gpu_utilization_pct=hw["gpu_utilization_pct"],
            cpu_utilization_pct=hw["cpu_utilization_pct"],
            peak_memory_mb=hw["peak_memory_mb"],
        )

    detail = LiveSessionDetailResponse.model_validate(session_obj)
    detail.events = [LiveEventResponse.model_validate(ev) for ev in session_obj.events]
    detail.segments = [LiveSegmentResponse.model_validate(sg) for sg in session_obj.segments]
    detail.events_count = len(session_obj.events)
    detail.segments_count = len(session_obj.segments)
    detail.stats = stats
    return detail


@router.get(
    "/sessions/{session_id}/stats",
    response_model=LiveSessionStats,
    summary="Get real-time or persisted statistics for a live session",
)
async def get_live_session_stats(
    session_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(LiveSession).where(LiveSession.id == session_id))
    session_obj = result.scalar_one_or_none()
    if not session_obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Live session {session_id} not found.",
        )

    mem_state = live_session_manager.get_session(session_id)
    if mem_state:
        return mem_state.get_stats()

    hw = get_hardware_metrics()
    return LiveSessionStats(
        audio_capture_rate=0.0,
        audio_input_continuity=100.0,
        avg_inference_latency_ms=0.0,
        avg_embedding_latency_ms=0.0,
        window_processing_lag_ms=0.0,
        e2e_event_delivery_latency_ms=0.0,
        dropped_frames=session_obj.dropped_frames,
        dropped_windows=session_obj.dropped_windows,
        gpu_utilization_pct=hw["gpu_utilization_pct"],
        cpu_utilization_pct=hw["cpu_utilization_pct"],
        peak_memory_mb=hw["peak_memory_mb"],
    )


async def _finalize_live_session_to_analysis(
    session_id: str, db: AsyncSession
) -> Optional[str]:
    """Persist a stopped LiveSession with recorded windows into a canonical Analysis."""
    query = (
        select(LiveSession)
        .options(
            selectinload(LiveSession.events),
            selectinload(LiveSession.segments),
        )
        .where(LiveSession.id == session_id)
    )
    res = await db.execute(query)
    session_obj = res.scalar_one_or_none()
    if not session_obj:
        return None
    if session_obj.analysis_id:
        return session_obj.analysis_id

    ordered_segments = sorted(session_obj.segments, key=lambda s: s.start_seconds)
    if not ordered_segments:
        return None

    analysis_id = str(uuid.uuid4())
    filename = f"live_{session_id[:8]}.wav"
    raw_path = storage_service.get_raw_path(analysis_id, filename)
    processed_path = storage_service.get_processed_path(analysis_id)

    # Concatenate segment WAV PCM frames into raw & canonical 32kHz mono WAV
    pcm_chunks: List[bytes] = []
    for seg in ordered_segments:
        seg_path = Path(seg.audio_path)
        if seg_path.exists():
            try:
                with wave.open(str(seg_path), "rb") as wf:
                    pcm_chunks.append(wf.readframes(wf.getnframes()))
            except Exception as wav_exc:
                logger.warning("Skipping unreadable segment WAV %s: %s", seg_path, wav_exc)

    if not pcm_chunks:
        return None

    total_pcm = b"".join(pcm_chunks)
    for target in (raw_path, processed_path):
        target.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(target), "wb") as out_wf:
            out_wf.setnchannels(session_obj.channels)
            out_wf.setsampwidth(2)
            out_wf.setframerate(session_obj.sample_rate)
            out_wf.writeframes(total_pcm)

    duration_s = max(
        float(session_obj.processed_audio_seconds or 0.0),
        float(session_obj.total_audio_seconds or 0.0),
        float(len(total_pcm)) / float(max(1, session_obj.sample_rate * session_obj.channels * 2)),
    )

    # Assemble (N, 1280) float32 embeddings matching segments strictly
    vec_rows: List[np.ndarray] = []
    embedding_segments: List[EmbeddingSegment] = []
    for idx, seg in enumerate(ordered_segments):
        vec: Optional[np.ndarray] = None
        if seg.embedding_path and Path(seg.embedding_path).exists():
            try:
                loaded = np.load(seg.embedding_path).astype(np.float32)
                if loaded.ndim == 2 and loaded.shape[1] == 1280 and np.isfinite(loaded).all():
                    vec = loaded[0]
                elif loaded.ndim == 1 and loaded.shape[0] == 1280 and np.isfinite(loaded).all():
                    vec = loaded
            except Exception:
                vec = None
        if vec is None:
            vec = np.zeros((1280,), dtype=np.float32)
        vec_rows.append(vec)
        embedding_segments.append(
            EmbeddingSegment(
                analysis_id=analysis_id,
                vector_index=idx,
                start_seconds=float(seg.start_seconds),
                end_seconds=float(seg.end_seconds),
            )
        )

    vectors = np.stack(vec_rows, axis=0).astype(np.float32)
    embedding_path = storage_service.save_embeddings(analysis_id, vectors)

    db_detections = [
        Detection(
            analysis_id=analysis_id,
            class_label=ev.class_label,
            scientific_name=ev.scientific_name,
            common_name=ev.common_name,
            taxon_group=ev.taxon_group,
            record_type=ev.record_type or "animal",
            start_seconds=float(ev.start_seconds),
            end_seconds=float(ev.end_seconds),
            confidence_score=float(ev.confidence_score),
        )
        for ev in session_obj.events
    ]

    onnx_status = direct_onnx_engine.get_status()
    exec_provider = (
        (onnx_status.get("active_providers") or [None])[0]
        or onnx_status.get("device")
        or "CPUExecutionProvider"
    )
    recorded_ts = session_obj.gps_captured_at or session_obj.started_at
    processed_samples = (
        np.frombuffer(total_pcm, dtype=np.int16).astype(np.float32) / 32768.0
    )
    ecological_summary = await ecological_analysis_service.build_analysis_ecology(
        analysis_id=analysis_id,
        filename=filename,
        duration_seconds=duration_s,
        sample_rate=session_obj.sample_rate,
        channels=session_obj.channels,
        latitude=session_obj.latitude,
        longitude=session_obj.longitude,
        recorded_at=recorded_ts,
        model_version=settings.MODEL_VERSION,
        execution_provider=str(exec_provider),
        raw_detections=session_obj.events,
        processed_audio=processed_samples,
    )

    sp_sum = ecological_summary.get("species", {}).get("summary", {})
    dist_sec = ecological_summary.get("disturbance", {})
    exp_sec = ecological_summary.get("expected_species", {})
    gap_cov = ecological_summary.get("observation_gap", {}).get("coverage", {})
    metrics = {
        "source_type": session_obj.source_type,
        "live_session_id": session_id,
        "total_detections": len(db_detections),
        "unique_classes": len({d.class_label for d in db_detections}),
        "biological_detections_count": sp_sum.get("biological_detection_count", 0),
        "unique_biological_species": sp_sum.get("unique_biological_species", 0),
        "non_biological_detections_count": sp_sum.get("non_biological_detection_count", 0),
        "unknown_detections_count": sp_sum.get("unknown_detection_count", 0),
        "disturbance_index": dist_sec.get("disturbance_index"),
        "expected_species_status": exp_sec.get("expected_species_status"),
        "acoustic_coverage_ratio": gap_cov.get("coverage_ratio"),
        "average_confidence": round(
            float(np.mean([d.confidence_score for d in db_detections])) if db_detections else 0.0,
            4,
        ),
        "embedding_vectors_count": len(vectors),
        "embedding_shape": list(vectors.shape),
        "embedding_dtype": str(vectors.dtype),
        "sample_rate": session_obj.sample_rate,
        "channels": session_obj.channels,
        "execution_provider": str(exec_provider),
    }

    analysis_row = Analysis(
        id=analysis_id,
        filename=filename,
        audio_path=str(raw_path),
        processed_path=str(processed_path),
        embedding_path=str(embedding_path),
        status="completed",
        progress=100.0,
        current_stage="completed",
        duration_seconds=round(duration_s, 3),
        latitude=session_obj.latitude,
        longitude=session_obj.longitude,
        gps_accuracy_m=session_obj.gps_accuracy_m,
        gps_captured_at=session_obj.gps_captured_at,
        recorded_at=recorded_ts,
        model_version=settings.MODEL_VERSION,
        metrics_json=metrics,
        ecological_summary_json=ecological_summary,
    )
    db.add(analysis_row)
    if db_detections:
        db.add_all(db_detections)
    if embedding_segments:
        db.add_all(embedding_segments)

    session_obj.analysis_id = analysis_id
    session_obj.recording_path = str(processed_path)
    await db.commit()
    await db.refresh(session_obj)
    return analysis_id


@router.post(
    "/sessions/{session_id}/stop",
    response_model=LiveSessionResponse,
    summary="Gracefully stop a live streaming session and finalize persisted Analysis",
)
async def stop_live_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
):
    # Stop in-memory coordinator and workers
    state = await live_session_manager.stop_session(session_id)

    query = select(LiveSession).where(LiveSession.id == session_id)
    result = await db.execute(query)
    session_obj = result.scalar_one_or_none()
    if not session_obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Live session {session_id} not found.",
        )

    if not state and session_obj.status != "stopped":
        session_obj.status = "stopped"
        session_obj.stopped_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(session_obj)

    await _finalize_live_session_to_analysis(session_id, db)
    await db.refresh(session_obj)
    return LiveSessionResponse.model_validate(session_obj)


# ============================================================================
# Phase 4B: Soundscape Fingerprint & Disturbance Radar REST APIs
# ============================================================================

@router.get(
    "/sessions/{session_id}/soundscape",
    response_model=List[SoundscapeMeasurementResponse],
    summary="Retrieve recorded soundscape measurements for a session",
)
async def get_session_soundscape(
    session_id: str,
    db: AsyncSession = Depends(get_db),
):
    session_res = await db.execute(select(LiveSession).where(LiveSession.id == session_id))
    if not session_res.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Live session {session_id} not found.",
        )

    res = await db.execute(
        select(SoundscapeMeasurement)
        .where(SoundscapeMeasurement.session_id == session_id)
        .order_by(SoundscapeMeasurement.start_seconds.asc())
    )
    measurements = res.scalars().all()
    return [SoundscapeMeasurementResponse.model_validate(m) for m in measurements]


@router.get(
    "/sessions/{session_id}/disturbances",
    response_model=List[DisturbanceEventResponse],
    summary="Retrieve recorded disturbance events for a session",
)
async def get_session_disturbances(
    session_id: str,
    db: AsyncSession = Depends(get_db),
):
    session_res = await db.execute(select(LiveSession).where(LiveSession.id == session_id))
    if not session_res.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Live session {session_id} not found.",
        )

    res = await db.execute(
        select(DisturbanceEvent)
        .where(DisturbanceEvent.session_id == session_id)
        .order_by(DisturbanceEvent.start_seconds.asc())
    )
    events = res.scalars().all()
    return [DisturbanceEventResponse.model_validate(e) for e in events]


@router.get(
    "/sessions/{session_id}/timeline",
    response_model=List[TimelineItemResponse],
    summary="Retrieve unified chronological timeline of biological detections, disturbance events, and soundscape measurements",
)
async def get_session_timeline(
    session_id: str,
    db: AsyncSession = Depends(get_db),
):
    session_res = await db.execute(select(LiveSession).where(LiveSession.id == session_id))
    if not session_res.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Live session {session_id} not found.",
        )

    # 1. Biological detections
    bio_res = await db.execute(
        select(LiveEvent)
        .where(
            LiveEvent.session_id == session_id,
            LiveEvent.record_type == "animal",
        )
    )
    bio_events = bio_res.scalars().all()

    # 2. Disturbance events
    dist_res = await db.execute(
        select(DisturbanceEvent)
        .where(DisturbanceEvent.session_id == session_id)
    )
    dist_events = dist_res.scalars().all()

    # 3. Soundscape measurements
    sc_res = await db.execute(
        select(SoundscapeMeasurement)
        .where(SoundscapeMeasurement.session_id == session_id)
    )
    sc_meas = sc_res.scalars().all()

    timeline: List[TimelineItemResponse] = []

    for b in bio_events:
        timeline.append(
            TimelineItemResponse(
                id=b.id,
                session_id=session_id,
                item_type="biological_detection",
                start_seconds=b.start_seconds,
                end_seconds=b.end_seconds,
                label=b.common_name or b.class_label,
                confidence_score=b.confidence_score,
                details={
                    "scientific_name": b.scientific_name,
                    "taxon_group": b.taxon_group,
                    "class_label": b.class_label,
                },
                created_at=b.created_at,
            )
        )

    for d in dist_events:
        timeline.append(
            TimelineItemResponse(
                id=d.id,
                session_id=session_id,
                item_type="disturbance_event",
                start_seconds=d.start_seconds,
                end_seconds=d.end_seconds,
                label=d.class_label,
                confidence_score=d.confidence_score,
                details={
                    "event_type": d.event_type,
                    "category": getattr(d, "category", None),
                    "hazard_classification": getattr(d, "hazard_classification", None),
                    "model_version": d.model_version,
                    "review_status": d.review_status,
                },
                created_at=d.created_at,
            )
        )

    for s in sc_meas:
        timeline.append(
            TimelineItemResponse(
                id=s.id,
                session_id=session_id,
                item_type="soundscape_measurement",
                start_seconds=s.start_seconds,
                end_seconds=s.end_seconds,
                label=f"Soundscape [{s.start_seconds:.0f}-{s.end_seconds:.0f}s]",
                confidence_score=None,
                details={
                    "aci": s.aci,
                    "adi": s.adi,
                    "aei": s.aei,
                    "ndsi": s.ndsi,
                    "spectral_entropy": s.spectral_entropy,
                    "temporal_activity": s.temporal_activity,
                    "frequency_bands": s.frequency_bands,
                    "quality_flags": s.quality_flags,
                },
                created_at=s.created_at,
            )
        )

    timeline.sort(key=lambda item: (item.start_seconds, item.end_seconds))
    return timeline


@router.get(
    "/sessions/{session_id}/co-occurrence",
    response_model=List[CoOccurrenceObservationResponse],
    summary="Retrieve biological vs disturbance co-occurrence observations",
)
async def get_session_cooccurrence(
    session_id: str,
    db: AsyncSession = Depends(get_db),
):
    session_res = await db.execute(select(LiveSession).where(LiveSession.id == session_id))
    if not session_res.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Live session {session_id} not found.",
        )

    res = await db.execute(
        select(CoOccurrenceObservation)
        .where(CoOccurrenceObservation.session_id == session_id)
        .order_by(CoOccurrenceObservation.created_at.asc())
    )
    obs = res.scalars().all()
    return [CoOccurrenceObservationResponse.model_validate(o) for o in obs]


@router.get(
    "/sessions/{session_id}/fingerprint",
    response_model=SoundscapeFingerprintResponse,
    summary="Return the latest or current soundscape fingerprint for a session",
)
async def get_session_fingerprint(
    session_id: str,
    db: AsyncSession = Depends(get_db),
):
    session_res = await db.execute(select(LiveSession).where(LiveSession.id == session_id))
    if not session_res.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Live session {session_id} not found.",
        )

    # Fetch latest measurement
    res = await db.execute(
        select(SoundscapeMeasurement)
        .where(SoundscapeMeasurement.session_id == session_id)
        .order_by(SoundscapeMeasurement.end_seconds.desc())
        .limit(1)
    )
    latest = res.scalar_one_or_none()
    if not latest:
        return SoundscapeFingerprintResponse(
            session_id=session_id,
            window_start_seconds=0.0,
            window_end_seconds=0.0,
            metrics=SoundscapeMetrics(),
            frequency_bands={},
            calculation_parameters={},
            quality_flags=["insufficient_audio_accumulated"],
        )

    return SoundscapeFingerprintResponse(
        session_id=session_id,
        window_start_seconds=latest.start_seconds,
        window_end_seconds=latest.end_seconds,
        metrics=SoundscapeMetrics(**latest.metrics),
        frequency_bands=latest.frequency_bands,
        calculation_parameters=latest.calculation_parameters,
        quality_flags=latest.quality_flags,
    )


@router.get(
    "/disturbances/taxonomy",
    summary="Retrieve verified BirdNET V3.0 disturbance sound classes and thresholds",
)
async def get_disturbance_taxonomy():
    return disturbance_service.get_taxonomy()


@router.get(
    "/sessions/{session_id}/anomalies",
    response_model=List[AnomalyCandidateResponse],
    summary="Retrieve statistically unusual acoustic events and candidates for review",
)
async def get_session_anomalies(
    session_id: str,
    threshold: Optional[float] = Query(None, ge=0.0, le=1.0, description="Minimum anomaly score threshold"),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    session_res = await db.execute(select(LiveSession).where(LiveSession.id == session_id))
    if not session_res.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Live session {session_id} not found.",
        )
    candidates = acoustic_anomaly_service.discover_session_anomalies(
        session_id=session_id, threshold=threshold, max_candidates=limit
    )
    return [AnomalyCandidateResponse.model_validate(c.to_dict()) for c in candidates]


@router.get(
    "/sessions/{session_id}/intelligence",
    response_model=SessionIntelligenceResponse,
    summary="Retrieve holistic bioacoustic intelligence overview for a session",
)
async def get_session_intelligence(
    session_id: str,
    db: AsyncSession = Depends(get_db),
):
    session_res = await db.execute(select(LiveSession).where(LiveSession.id == session_id))
    session_obj = session_res.scalar_one_or_none()
    if not session_obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Live session {session_id} not found.",
        )

    # 1. All session detections classified semantically (biological vs non-biological vs unknown)
    all_ev_res = await db.execute(
        select(LiveEvent).where(LiveEvent.session_id == session_id)
    )
    all_events = all_ev_res.scalars().all()
    species_analysis = ecological_analysis_service.build_species_analysis(all_events)

    bio_items = species_analysis["biological_detections"]
    detections_count = len(bio_items)
    unique_species = {
        b.get("common_name") or b.get("scientific_name") or b.get("label")
        for b in bio_items
        if b.get("scientific_name") or b.get("common_name")
    }

    from collections import Counter
    species_counts = Counter(
        b.get("common_name") or b.get("scientific_name") or b.get("label")
        for b in bio_items
        if b.get("scientific_name") or b.get("common_name")
    )
    top_species = [
        {"species": sp, "count": cnt}
        for sp, cnt in species_counts.most_common(5)
    ]

    # 2. Disturbances
    dist_res = await db.execute(
        select(DisturbanceEvent).where(DisturbanceEvent.session_id == session_id)
    )
    dist_events = dist_res.scalars().all()
    dist_responses = [DisturbanceEventResponse.model_validate(d) for d in dist_events]
    critical_cnt = sum(1 for d in dist_events if getattr(d, "hazard_classification", None) == "critical")

    # 3. Anomalies
    anomalies = acoustic_anomaly_service.discover_session_anomalies(session_id=session_id)
    anom_responses = [AnomalyCandidateResponse.model_validate(a.to_dict()) for a in anomalies]

    # 4. Fingerprint & Soundscape context
    fingerprint_res = await get_session_fingerprint(session_id, db)
    soundscape_payload = (
        {
            "metrics": fingerprint_res.metrics.model_dump(),
            "frequency_bands": fingerprint_res.frequency_bands,
            "calculation_parameters": fingerprint_res.calculation_parameters,
            "quality_flags": fingerprint_res.quality_flags,
        }
        if any(v is not None for v in fingerprint_res.metrics.model_dump().values())
        else None
    )

    duration_s = max(float(session_obj.total_audio_seconds or 0.0), float(session_obj.processed_audio_seconds or 0.0))
    disturbance_analysis = ecological_analysis_service.build_disturbance_analysis(
        analysis_or_session_id=session_id,
        species_analysis=species_analysis,
        duration_seconds=duration_s,
        soundscape_data=soundscape_payload,
    )
    context_analysis = ecological_analysis_service.build_context_analysis(
        recording_id=session_id,
        filename=None,
        duration_seconds=duration_s,
        sample_rate=session_obj.sample_rate,
        channels=session_obj.channels,
        latitude=session_obj.latitude,
        longitude=session_obj.longitude,
        recorded_at=session_obj.started_at,
        model_version="BirdNET+ V3.0",
        execution_provider=None,
        species_analysis=species_analysis,
        disturbance_analysis=disturbance_analysis,
        soundscape_data=soundscape_payload,
    )

    # 5. Co-occurrences
    co_res = await db.execute(
        select(CoOccurrenceObservation).where(CoOccurrenceObservation.session_id == session_id)
    )
    co_obs = co_res.scalars().all()
    co_responses = [CoOccurrenceObservationResponse.model_validate(c) for c in co_obs]

    # Total timeline count
    timeline_count = detections_count + len(dist_events) + len(anomalies)

    return SessionIntelligenceResponse(
        session_id=session_id,
        status=session_obj.status,
        total_audio_seconds=session_obj.total_audio_seconds,
        processed_audio_seconds=session_obj.processed_audio_seconds,
        detections_count=detections_count,
        species_richness=len(unique_species),
        top_detected_species=top_species,
        disturbances=dist_responses,
        disturbances_count=len(dist_responses),
        critical_disturbances_count=critical_cnt,
        anomalies=anom_responses,
        anomalies_count=len(anom_responses),
        soundscape_fingerprint=fingerprint_res,
        co_occurrences=co_responses,
        timeline_events_count=timeline_count,
        species_analysis=species_analysis,
        disturbance_analysis=disturbance_analysis,
        context_analysis=context_analysis,
    )



# ============================================================================
# WebSocket Streaming Endpoint
# ============================================================================

@router.websocket("/sessions/{session_id}/stream")
async def websocket_live_stream(websocket: WebSocket, session_id: str):
    """Bidirectional WebSocket streaming endpoint for live audio ingestion and event delivery."""
    await websocket.accept()

    # Verify session exists in DB
    async with async_session_factory() as db:
        res = await db.execute(select(LiveSession).where(LiveSession.id == session_id))
        session_obj = res.scalar_one_or_none()
        if not session_obj:
            await websocket.send_json(
                {"type": "error", "code": "SESSION_NOT_FOUND", "message": f"Session {session_id} does not exist."}
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

    if session_obj.sample_rate != 32000 or session_obj.channels != 1:
        await websocket.send_json(
            {
                "type": "error",
                "code": "UNSUPPORTED_AUDIO_FORMAT",
                "message": "Live streaming requires sample_rate=32000, channels=1, PCM16 little-endian.",
            }
        )
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # Ensure in-memory session state is ready
    state = live_session_manager.get_session(session_id)
    if not state:
        state = await live_session_manager.create_session(
            session_id=session_id,
            sample_rate=session_obj.sample_rate,
            channels=session_obj.channels,
        )

    state.add_websocket(websocket)

    # Send handshake acknowledgment
    await websocket.send_json(
        {
            "type": "handshake_ack",
            "session_id": session_id,
            "status": state.status,
            "sample_rate": state.sample_rate,
            "channels": state.channels,
            "expected_seq": state.expected_seq,
        }
    )

    # Automatically start session if in created state
    if state.status == "created":
        await live_session_manager.start_session(session_id)

    frame_count_in_sec = 0
    sec_start = datetime.now().timestamp()

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                logger.info("WebSocket disconnect frame received for session %s", session_id)
                break

            if "bytes" in message and message["bytes"]:
                raw_bytes = message["bytes"]

                # Rate limiting check
                now_ts = datetime.now().timestamp()
                if now_ts - sec_start < 1.0:
                    frame_count_in_sec += 1
                    if frame_count_in_sec > FRAME_RATE_LIMIT_HZ:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "code": "RATE_LIMIT_EXCEEDED",
                                "message": f"Frame rate limit ({FRAME_RATE_LIMIT_HZ} Hz) exceeded.",
                            }
                        )
                        continue
                else:
                    sec_start = now_ts
                    frame_count_in_sec = 1

                # Validate frame size
                if len(raw_bytes) > MAX_FRAME_SIZE_BYTES:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "code": "FRAME_TOO_LARGE",
                            "message": f"Frame size {len(raw_bytes)} bytes exceeds maximum {MAX_FRAME_SIZE_BYTES} bytes.",
                        }
                    )
                    continue

                # Parse frame: 4-byte big-endian uint32 sequence header + PCM16 bytes
                if len(raw_bytes) < 4:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "code": "INVALID_FRAME_LENGTH",
                            "message": f"Frame length {len(raw_bytes)} bytes too short (missing 4-byte sequence header).",
                        }
                    )
                    continue

                seq_num = struct.unpack(">I", raw_bytes[:4])[0]
                pcm_payload = raw_bytes[4:]

                req_align = 2 * (state.channels if state else 1)
                if len(pcm_payload) % req_align != 0:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "code": "INVALID_PCM_ALIGNMENT",
                            "message": f"PCM payload length {len(pcm_payload)} is not {req_align}-byte aligned for {state.channels if state else 1} channel(s).",
                        }
                    )
                    continue

                success, warn = await live_session_manager.ingest_audio_frame(
                    session_id=session_id, seq_num=seq_num, pcm_bytes=pcm_payload
                )

                if not success and warn:
                    await websocket.send_json(
                        {"type": "error", "code": "FRAME_REJECTED", "message": warn, "seq": seq_num}
                    )

            elif "text" in message and message["text"]:
                try:
                    payload = json.loads(message["text"])
                except Exception:
                    await websocket.send_json(
                        {"type": "error", "code": "INVALID_JSON", "message": "Malformed JSON text message."}
                    )
                    continue

                msg_type = payload.get("type")
                if msg_type == "handshake":
                    await websocket.send_json(
                        {
                            "type": "handshake_ack",
                            "session_id": session_id,
                            "status": state.status,
                            "sample_rate": state.sample_rate,
                            "channels": state.channels,
                            "expected_seq": state.expected_seq,
                        }
                    )
                elif msg_type == "start":
                    await live_session_manager.start_session(session_id)
                elif msg_type == "pause":
                    await live_session_manager.pause_session(session_id)
                elif msg_type == "resume":
                    await live_session_manager.resume_session(session_id)
                elif msg_type == "stop":
                    await live_session_manager.stop_session(session_id)
                    break
                elif msg_type == "heartbeat":
                    await websocket.send_json(
                        {
                            "type": "heartbeat_ack",
                            "timestamp": payload.get("timestamp", datetime.now().timestamp()),
                        }
                    )
                else:
                    await websocket.send_json(
                        {"type": "error", "code": "UNKNOWN_CONTROL_MESSAGE", "message": f"Unknown type: {msg_type}"}
                    )

    except (WebSocketDisconnect, RuntimeError):
        logger.info("WebSocket disconnected for session %s", session_id)
    except Exception as exc:
        logger.error("WebSocket unexpected error for session %s: %s", session_id, exc)
    finally:
        state.remove_websocket(websocket)
