"""REST API endpoints for Geospatial Ecological Intelligence and Expected Species Gap Analysis."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models.live_session import LiveEvent, LiveSession
from app.models.site import Site
from app.models.soundscape import SoundscapeMeasurement
from app.schemas.ecological_intelligence import (
    ObservationGapRequest,
    ObservationGapResponse,
    SpeciesImageProvenance,
)
from app.services.ecological_interpretation_service import (
    ecological_interpretation_service,
)
from app.services.ecological_analysis_service import ecological_analysis_service
from app.services.ecological_knowledge import get_ecological_knowledge_provider
from app.services.ecological_knowledge.provider_base import (
    EcologicalProviderUnavailableError,
    InvalidObservationCoordinatesError,
    canonical_species_id,
)
from app.services.live.session_manager import live_session_manager
from app.services.observation_gap_engine import observation_gap_engine
from app.services.species_image_service import species_image_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ecology", tags=["Geospatial Ecological Intelligence"])


@router.get(
    "/species-image",
    response_model=SpeciesImageProvenance,
    summary="Resolve cached provenance-tracked biological species photograph",
)
async def get_species_image(
    scientific_name: str = Query(..., min_length=2),
    common_name: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
) -> SpeciesImageProvenance:
    """Retrieve verified local or open-licensed Wikimedia species imagery with caching."""
    payload = await species_image_service.get_species_image(
        scientific_name,
        common_name=common_name,
        allow_external=True,
        db=db,
    )
    return SpeciesImageProvenance.model_validate(payload)


@router.post(
    "/observation-gap",
    response_model=ObservationGapResponse,
    status_code=status.HTTP_200_OK,
    summary="Compute expected species gap analysis for an acoustic monitoring session",
)
async def compute_session_observation_gap(
    payload: ObservationGapRequest,
    db: AsyncSession = Depends(get_db),
) -> ObservationGapResponse:
    """Evaluate regional species expectations against actual acoustic detections.

    Retrieves existing session detections, soundscape metrics, and site metadata directly
    from backend storage, enforcing strict scientific separation between acoustic non-detection
    and biological absence.
    """
    session_id = payload.session_id

    # 1. Fetch Session from DB with Site relationship
    session_res = await db.execute(
        select(LiveSession)
        .options(selectinload(LiveSession.site))
        .where(LiveSession.id == session_id)
    )
    session_obj = session_res.scalar_one_or_none()

    active_state = live_session_manager.get_session(session_id)

    if not session_obj and not active_state:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Monitoring session '{session_id}' not found.",
        )

    # 2. Determine Coordinates and Site Context
    # Precedence: Request payload > Session table > Linked Site table
    lat: Optional[float] = payload.latitude
    lon: Optional[float] = payload.longitude
    loc_name: Optional[str] = None
    ecosystem_cat: Optional[str] = None
    site_metadata: Optional[Dict[str, Any]] = None

    if session_obj:
        if lat is None and session_obj.latitude is not None:
            lat = session_obj.latitude
        if lon is None and session_obj.longitude is not None:
            lon = session_obj.longitude

        if session_obj.site:
            if lat is None:
                lat = session_obj.site.latitude
            if lon is None:
                lon = session_obj.site.longitude
            loc_name = session_obj.site.name
            ecosystem_cat = session_obj.site.ecosystem_category
            site_metadata = {
                "location_sensitivity": session_obj.site.location_sensitivity,
                "generalized_latitude": session_obj.site.generalized_latitude,
                "generalized_longitude": session_obj.site.generalized_longitude,
            }

    timestamp = session_obj.started_at if session_obj else datetime.now(timezone.utc)
    duration_sec = float(session_obj.processed_audio_seconds or 0.0) if session_obj else 0.0
    if active_state:
        active_sec = (
            active_state.total_bytes_received / (active_state.sample_rate * 2 * max(1, active_state.channels))
            if active_state.total_bytes_received and active_state.sample_rate
            else 0.0
        )
        duration_sec = max(duration_sec, active_sec)

    # 3. Fetch Bioacoustic Detections
    events_res = await db.execute(
        select(LiveEvent)
        .where(LiveEvent.session_id == session_id)
        .order_by(LiveEvent.start_seconds.asc())
    )
    raw_events = events_res.scalars().all()

    # 4. Fetch Latest Soundscape Metrics (if available)
    meas_res = await db.execute(
        select(SoundscapeMeasurement)
        .where(SoundscapeMeasurement.session_id == session_id)
        .order_by(SoundscapeMeasurement.end_seconds.desc())
        .limit(1)
    )
    latest_meas = meas_res.scalar_one_or_none()
    soundscape_metrics: Dict[str, float] = {}
    if latest_meas and latest_meas.metrics:
        soundscape_metrics = {
            "aci": float(latest_meas.metrics.get("aci", 0.0)),
            "ndsi": float(latest_meas.metrics.get("ndsi", 0.0)),
        }

    # 5. Resolve Ecological Context & Regional Expected Species
    provider = get_ecological_knowledge_provider()
    try:
        context = await provider.resolve_context(
            session_id=session_id,
            timestamp=timestamp,
            duration_sec=duration_sec,
            latitude=lat,
            longitude=lon,
            location_name=loc_name,
            ecosystem_category=ecosystem_cat,
            soundscape_metrics=soundscape_metrics,
            site_metadata=site_metadata,
        )

        expected_species = await provider.get_expected_species(
            context=context,
            min_score=payload.min_occurrence_score,
        )
    except InvalidObservationCoordinatesError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": exc.code, "message": str(exc)},
        ) from exc
    except EcologicalProviderUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": exc.code, "message": str(exc)},
        ) from exc

    # 6. Evaluate Deterministic Expectation-vs-Detection Matrix using internal coordinates
    expected_and_det, expected_not_det, detected_unexp, coverage = (
        observation_gap_engine.evaluate_observation_gap(
            context=context,
            expected_species=expected_species,
            raw_events=raw_events,
            min_confidence=payload.min_confidence,
        )
    )

    # Best-effort canonical taxonomy enrichment for unexpected detections
    for item in detected_unexp:
        meta = await provider.get_species_metadata(item.scientific_name)
        if meta:
            if not item.birdnet_taxonomy_id and meta.get("birdnet_taxonomy_id"):
                item.birdnet_taxonomy_id = str(meta["birdnet_taxonomy_id"])
            if not item.ebird_code and meta.get("ebird_code"):
                item.ebird_code = str(meta["ebird_code"])
            if (not item.common_name or item.common_name == item.scientific_name) and meta.get("common_name"):
                item.common_name = str(meta["common_name"])
            item.species_id = canonical_species_id(item.scientific_name, item.birdnet_taxonomy_id)

    # Apply public coordinate privacy mask before AI prompt construction or API response
    public_context = context
    if site_metadata:
        sensitivity = str(site_metadata.get("location_sensitivity") or "exact").strip().lower()
        if sensitivity == "restricted":
            public_context = context.model_copy(
                update={
                    "latitude": None,
                    "longitude": None,
                    "generalized_coordinates": {"latitude": None, "longitude": None},
                }
            )
        elif sensitivity == "generalized":
            gen_lat = site_metadata.get("generalized_latitude")
            gen_lon = site_metadata.get("generalized_longitude")
            if gen_lat is None and lat is not None:
                gen_lat = round(float(lat), 2)
            if gen_lon is None and lon is not None:
                gen_lon = round(float(lon), 2)
            public_context = context.model_copy(
                update={
                    "latitude": gen_lat,
                    "longitude": gen_lon,
                    "generalized_coordinates": {"latitude": gen_lat, "longitude": gen_lon},
                }
            )

    # 7. Asynchronous AI-Assisted Interpretation (Optional, Non-blocking)
    interpretation = None
    if payload.include_ai_interpretation:
        interpretation = await ecological_interpretation_service.interpret_observation_gap(
            context=public_context,
            coverage=coverage,
            expected_and_detected=expected_and_det,
            expected_but_not_detected=expected_not_det,
            detected_unexpected=detected_unexp,
        )

    # Build structured semantic sections & provenance from the already-fetched data
    soundscape_full = (
        {
            "metrics": latest_meas.metrics,
            "frequency_bands": latest_meas.frequency_bands,
            "calculation_parameters": latest_meas.calculation_parameters,
            "quality_flags": latest_meas.quality_flags,
        }
        if latest_meas
        else None
    )
    species_section = ecological_analysis_service.build_species_analysis(raw_events)
    disturbance_section = ecological_analysis_service.build_disturbance_analysis(
        analysis_or_session_id=session_id,
        species_analysis=species_section,
        duration_seconds=duration_sec,
        soundscape_data=soundscape_full,
    )
    context_section = ecological_analysis_service.build_context_analysis(
        recording_id=session_id,
        filename=None,
        duration_seconds=duration_sec,
        sample_rate=session_obj.sample_rate if session_obj else 32000,
        channels=session_obj.channels if session_obj else 1,
        latitude=public_context.latitude,
        longitude=public_context.longitude,
        recorded_at=timestamp,
        model_version="BirdNET+ V3.0",
        execution_provider=None,
        species_analysis=species_section,
        disturbance_analysis=disturbance_section,
        soundscape_data=soundscape_full,
        location_name=public_context.location_name,
        ecosystem_category=public_context.ecosystem_category,
    )
    if lat is None or lon is None:
        exp_status = "location_unspecified"
    elif expected_species:
        exp_status = "available"
    else:
        exp_status = "empty_reference"

    # Enrich detected & top expected items with provenance-tracked species imagery
    image_targets: list[tuple[str, Optional[str]]] = []
    for item in expected_and_det:
        image_targets.append((item.scientific_name, item.common_name))
    for item in detected_unexp:
        image_targets.append((item.scientific_name, item.common_name))
    for item in expected_not_det[:18]:
        image_targets.append((item.scientific_name, item.common_name))

    try:
        image_map = await species_image_service.resolve_batch(image_targets, max_external=10, concurrency=4)
    except Exception:
        image_map = {}

    for group in (expected_and_det, detected_unexp, expected_not_det):
        for item in group:
            k = species_image_service.normalize_key(item.scientific_name)
            if k in image_map:
                item.image = SpeciesImageProvenance.model_validate(image_map[k])

    geospatial_section = ecological_analysis_service.build_geospatial_context(
        latitude=public_context.latitude,
        longitude=public_context.longitude,
        timestamp=timestamp,
        ecosystem_category=public_context.ecosystem_category,
        location_name=public_context.location_name,
        expected_species_status=exp_status,
        expected_count=len(expected_species) if lat is not None and lon is not None else None,
    )

    provenance_meta = {
        "source": "BirdNET Geo V3.0 ONNX",
        "reference_type": "model_prediction" if exp_status in {"available", "empty_reference"} else "unavailable",
        "confidence": coverage.observation_adequacy if exp_status == "available" else "unavailable",
        "reference_timestamp": datetime.now(timezone.utc).isoformat(),
        "meteorological_week": public_context.meteorological_week,
        "occurrence_basis": "species_expected_from_reference",
    }

    return ObservationGapResponse(
        session_id=session_id,
        expected_species_status=exp_status,
        context=public_context,
        geospatial_context=geospatial_section,
        coverage=coverage,
        expected_and_detected=expected_and_det,
        expected_but_not_detected=expected_not_det,
        detected_unexpected=detected_unexp,
        species_analysis=species_section,
        disturbance_analysis=disturbance_section,
        context_analysis=context_section,
        provenance=provenance_meta,
        interpretation=interpretation,
    )
