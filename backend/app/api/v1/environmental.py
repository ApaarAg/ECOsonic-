"""EcoSonic Phase 5 Environmental Intelligence & Expert Review API Router.

Exposes endpoints for:
- Geographic occurrence suitability evaluation (BirdNET Geo V3.0)
- Expert verification reviews and audit trails
- Environmental incident management, triaging, and investigations
"""

from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.schemas.environmental_intelligence import (
    AcousticDetectionGeoContext,
    EnvironmentalIncidentCreate,
    EnvironmentalIncidentResponse,
    EnvironmentalIncidentUpdate,
    EnvironmentalReviewCreate,
    EnvironmentalReviewResponse,
    EnvironmentalReviewUpdate,
    EventReviewRequest,
    GeoContextualizeRequest,
)
from app.services.environmental_review_service import environmental_review_service
from app.services.geo_temporal_service import geo_temporal_service
from app.services.incident_management_service import incident_management_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["environmental"])


# ----------------------------------------------------------------------------
# MODULE A: Geographic Occurrence Intelligence
# ----------------------------------------------------------------------------
@router.post(
    "/geo/contextualize",
    response_model=AcousticDetectionGeoContext,
    summary="Evaluate geographic occurrence suitability for an acoustic detection",
)
async def contextualize_detection(
    request: GeoContextualizeRequest,
):
    """Assess whether a species detection is expected, rare, or unexpected at a given location and time."""
    try:
        return geo_temporal_service.contextualize_acoustic_detection(
            scientific_name=request.scientific_name,
            acoustic_confidence=request.acoustic_confidence,
            latitude=request.latitude,
            longitude=request.longitude,
            week=request.week,
            date=request.date,
            detection_id=request.detection_id,
            live_event_id=request.live_event_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


# ----------------------------------------------------------------------------
# MODULE D: Expert Verification & Review Workflows
# ----------------------------------------------------------------------------
@router.post(
    "/environmental-events/{event_id}/review",
    response_model=EnvironmentalReviewResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Submit an expert verification review for an environmental event or detection",
)
async def review_environmental_event(
    event_id: str,
    review_in: EventReviewRequest,
    db: AsyncSession = Depends(get_db),
):
    """Attach a non-destructive expert review to any live event, detection, or anomaly."""
    full_create = EnvironmentalReviewCreate(
        review_category=review_in.review_category,
        target_type=review_in.target_type,
        target_id=event_id,
        site_id=review_in.site_id,
        session_id=review_in.session_id,
        original_prediction=review_in.original_prediction,
        original_score=review_in.original_score,
        geo_context=review_in.geo_context,
        audio_evidence_path=review_in.audio_evidence_path,
        review_decision=review_in.review_decision,
        reviewer_note=review_in.reviewer_note,
    )
    try:
        return await environmental_review_service.create_review(full_create, db)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.post(
    "/environmental-reviews",
    response_model=EnvironmentalReviewResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new expert verification record",
)
async def create_review(
    review_in: EnvironmentalReviewCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create an expert verification record for human-in-the-loop validation."""
    try:
        return await environmental_review_service.create_review(review_in, db)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.get(
    "/environmental-reviews",
    response_model=List[EnvironmentalReviewResponse],
    summary="List expert verification records with optional filters",
)
async def list_reviews(
    site_id: Optional[str] = Query(None),
    session_id: Optional[str] = Query(None),
    review_category: Optional[str] = Query(None),
    review_decision: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    return await environmental_review_service.list_reviews(
        db=db,
        site_id=site_id,
        session_id=session_id,
        review_category=review_category,
        review_decision=review_decision,
        limit=limit,
    )


@router.get(
    "/environmental-reviews/{review_id}",
    response_model=EnvironmentalReviewResponse,
    summary="Retrieve a specific expert verification record and audit trail",
)
async def get_review(
    review_id: str,
    db: AsyncSession = Depends(get_db),
):
    review = await environmental_review_service.get_review(review_id, db)
    if not review:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Review '{review_id}' not found.")
    return review


@router.patch(
    "/environmental-reviews/{review_id}",
    response_model=EnvironmentalReviewResponse,
    summary="Update an expert verification decision and append audit history",
)
async def update_review(
    review_id: str,
    update_in: EnvironmentalReviewUpdate,
    db: AsyncSession = Depends(get_db),
):
    try:
        updated = await environmental_review_service.update_review(review_id, update_in, db)
        if not updated:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Review '{review_id}' not found.")
        return updated
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


# ----------------------------------------------------------------------------
# MODULE E: Environmental Incident Management
# ----------------------------------------------------------------------------
@router.post(
    "/environmental-incidents",
    response_model=EnvironmentalIncidentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new environmental disturbance or hazard investigation incident",
)
async def create_incident(
    incident_in: EnvironmentalIncidentCreate,
    db: AsyncSession = Depends(get_db),
):
    """Log a new environmental incident for tracking, escalation, and investigation."""
    try:
        return await incident_management_service.create_incident(incident_in, db)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.get(
    "/environmental-incidents",
    response_model=List[EnvironmentalIncidentResponse],
    summary="List environmental incidents across sites and sessions",
)
async def list_incidents(
    site_id: Optional[str] = Query(None),
    session_id: Optional[str] = Query(None),
    incident_status: Optional[str] = Query(None, alias="status"),
    priority: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    return await incident_management_service.list_incidents(
        db=db,
        site_id=site_id,
        session_id=session_id,
        status=incident_status,
        priority=priority,
        limit=limit,
    )


@router.get(
    "/environmental-incidents/{incident_id}",
    response_model=EnvironmentalIncidentResponse,
    summary="Retrieve an environmental incident by ID or incident code",
)
async def get_incident(
    incident_id: str,
    db: AsyncSession = Depends(get_db),
):
    incident = await incident_management_service.get_incident(incident_id, db)
    if not incident:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Incident '{incident_id}' not found.")
    return incident


@router.patch(
    "/environmental-incidents/{incident_id}",
    response_model=EnvironmentalIncidentResponse,
    summary="Update incident status, priority, investigation notes, or resolution notes",
)
async def update_incident(
    incident_id: str,
    update_in: EnvironmentalIncidentUpdate,
    db: AsyncSession = Depends(get_db),
):
    try:
        updated = await incident_management_service.update_incident(incident_id, update_in, db)
        if not updated:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Incident '{incident_id}' not found.")
        return updated
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
