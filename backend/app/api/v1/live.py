"""REST and WebSocket endpoints for source-agnostic live bioacoustic streaming, soundscape, and disturbance intelligence."""

from __future__ import annotations

import json
import logging
import struct
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

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

from app.core.database import async_session_factory, get_db
from app.core.logging import logger
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
    CoOccurrenceObservationResponse,
    DisturbanceEventResponse,
    SoundscapeFingerprintResponse,
    SoundscapeMeasurementResponse,
    SoundscapeMetrics,
    TimelineItemResponse,
)
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


@router.post(
    "/sessions/{session_id}/stop",
    response_model=LiveSessionResponse,
    summary="Gracefully stop a live streaming session",
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

    if not state:
        session_obj.status = "stopped"
        session_obj.stopped_at = datetime.now(timezone.utc)
        await db.commit()
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
            LiveEvent.taxon_group != "sound_class",
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
