import asyncio
import io
import uuid
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.dependencies import get_site_repository
from app.models.site import Site
from app.repositories.site_repository import SiteRepository
from app.schemas.common import MessageResponse, PaginatedResponse
from app.schemas.environmental_intelligence import (
    AcousticDetectionGeoContext,
    EnvironmentalIncidentResponse,
    HabitatComparisonRequest,
    HabitatComparisonResponse,
    HabitatDriftSummaryResponse,
    SiteAcousticProfile,
    SiteGeoContextResponse,
)
from app.schemas.site import SiteCreate, SiteResponse, SiteUpdate
from app.services.ecological_report_service import ecological_report_service
from app.services.geo_temporal_service import geo_temporal_service
from app.services.habitat_drift_service import habitat_drift_service
from app.services.incident_management_service import incident_management_service
from app.services.site_intelligence_service import site_intelligence_service

router = APIRouter(prefix="/sites", tags=["Monitoring Sites"])


@router.post(
    "",
    response_model=SiteResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new bioacoustic monitoring site",
)
async def create_site(
    site_in: SiteCreate,
    repo: SiteRepository = Depends(get_site_repository),
):
    gen_lat = site_in.generalized_latitude
    gen_lon = site_in.generalized_longitude
    if site_in.location_sensitivity == "generalized" and (gen_lat is None or gen_lon is None):
        c_lat, c_lon = site_intelligence_service.calculate_generalized_coordinates(site_in.latitude, site_in.longitude)
        gen_lat = gen_lat if gen_lat is not None else c_lat
        gen_lon = gen_lon if gen_lon is not None else c_lon

    site = Site(
        id=str(uuid.uuid4()),
        name=site_in.name,
        latitude=site_in.latitude,
        longitude=site_in.longitude,
        description=site_in.description,
        ecosystem_category=site_in.ecosystem_category,
        timezone=site_in.timezone,
        location_sensitivity=site_in.location_sensitivity,
        generalized_latitude=gen_lat,
        generalized_longitude=gen_lon,
        ecosystem_profile_json=site_in.ecosystem_profile,
        metadata_json=site_in.metadata,
    )
    created = await repo.create(site)
    return created


@router.get(
    "",
    response_model=PaginatedResponse[SiteResponse],
    summary="List monitoring sites with pagination",
)
async def list_sites(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    repo: SiteRepository = Depends(get_site_repository),
):
    skip = (page - 1) * page_size
    items, total = await repo.list(skip=skip, limit=page_size)
    total_pages = (total + page_size - 1) // page_size if total > 0 else 0

    return PaginatedResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get(
    "/{site_id}",
    response_model=SiteResponse,
    summary="Retrieve site metadata by UUID",
)
async def get_site(
    site_id: str,
    repo: SiteRepository = Depends(get_site_repository),
):
    site = await repo.get_by_id(site_id)
    if not site:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Site with ID '{site_id}' not found.",
        )
    return site


@router.patch(
    "/{site_id}",
    response_model=SiteResponse,
    summary="Update monitoring site parameters",
)
async def update_site(
    site_id: str,
    site_in: SiteUpdate,
    repo: SiteRepository = Depends(get_site_repository),
):
    update_data = site_in.model_dump(exclude_unset=True)
    if not update_data:
        site = await repo.get_by_id(site_id)
        if not site:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Site with ID '{site_id}' not found.",
            )
        return site

    # Rename json columns if present
    if "ecosystem_profile" in update_data:
        update_data["ecosystem_profile_json"] = update_data.pop("ecosystem_profile")
    if "metadata" in update_data:
        update_data["metadata_json"] = update_data.pop("metadata")

    updated = await repo.update(site_id, **update_data)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Site with ID '{site_id}' not found.",
        )
    return updated


@router.delete(
    "/{site_id}",
    response_model=MessageResponse,
    summary="Delete a monitoring site",
)
async def delete_site(
    site_id: str,
    repo: SiteRepository = Depends(get_site_repository),
):
    deleted = await repo.delete(site_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Site with ID '{site_id}' not found.",
        )
    return MessageResponse(message=f"Site '{site_id}' deleted successfully.")


# ----------------------------------------------------------------------------
# Phase 5: Geo-Temporal & Habitat Monitoring Endpoints
# ----------------------------------------------------------------------------
@router.get(
    "/{site_id}/geo-context",
    response_model=SiteGeoContextResponse,
    summary="Retrieve regional species checklist and seasonal suitability baseline",
)
async def get_site_geo_context(
    site_id: str,
    week: Optional[int] = Query(None, ge=1, le=48, description="Meteorological week 1..48"),
    top_k: int = Query(50, ge=1, le=200),
    repo: SiteRepository = Depends(get_site_repository),
):
    site = await repo.get_by_id(site_id)
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Site '{site_id}' not found.")

    try:
        checklist = await asyncio.to_thread(
            geo_temporal_service.get_site_regional_checklist,
            latitude=site.latitude,
            longitude=site.longitude,
            week=week,
            site_id=site.id,
            site_name=site.name,
            top_k=top_k,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "INVALID_OBSERVATION_COORDINATES", "message": str(exc)},
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "ECOLOGICAL_DATA_UNAVAILABLE", "message": str(exc)},
        ) from exc

    public_coords = site.get_public_coordinates()
    checklist.latitude = public_coords["latitude"]
    checklist.longitude = public_coords["longitude"]
    checklist.location_sensitivity = str(public_coords["sensitivity"])
    return checklist


@router.get(
    "/{site_id}/species-context",
    response_model=AcousticDetectionGeoContext,
    summary="Evaluate geographic occurrence suitability for a specific species at this site",
)
async def get_site_species_context(
    site_id: str,
    scientific_name: str = Query(..., description="Species scientific name"),
    confidence: float = Query(0.80, ge=0.0, le=1.0, description="Hypothetical or observed acoustic confidence"),
    week: Optional[int] = Query(None, ge=1, le=48),
    repo: SiteRepository = Depends(get_site_repository),
):
    site = await repo.get_by_id(site_id)
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Site '{site_id}' not found.")

    try:
        return await asyncio.to_thread(
            geo_temporal_service.contextualize_acoustic_detection,
            scientific_name=scientific_name,
            acoustic_confidence=confidence,
            latitude=site.latitude,
            longitude=site.longitude,
            week=week,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "INVALID_OBSERVATION_COORDINATES", "message": str(exc)},
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "ECOLOGICAL_DATA_UNAVAILABLE", "message": str(exc)},
        ) from exc


@router.get(
    "/{site_id}/history",
    response_model=SiteAcousticProfile,
    summary="Retrieve aggregated acoustic observation history and baseline profile",
)
async def get_site_history(
    site_id: str,
    db: AsyncSession = Depends(get_db),
):
    profile = await site_intelligence_service.get_site_acoustic_profile(site_id, db)
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Site '{site_id}' not found.")
    return profile


@router.post(
    "/{site_id}/comparisons",
    response_model=HabitatComparisonResponse,
    summary="Execute a statistical habitat drift comparison between recordings",
)
async def create_site_comparison(
    site_id: str,
    comp_in: HabitatComparisonRequest,
    db: AsyncSession = Depends(get_db),
    repo: SiteRepository = Depends(get_site_repository),
):
    site = await repo.get_by_id(site_id)
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Site '{site_id}' not found.")

    if comp_in.comparison_type == "session_vs_session":
        if not comp_in.baseline_session_id or not comp_in.target_session_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Both baseline_session_id and target_session_id are required for session_vs_session comparison.",
            )
        try:
            return await habitat_drift_service.compare_sessions(
                baseline_session_id=comp_in.baseline_session_id,
                target_session_id=comp_in.target_session_id,
                site_id=site_id,
                db=db,
                persist=True,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))

    elif comp_in.comparison_type == "historical_baseline":
        if not comp_in.target_session_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="target_session_id is required for historical_baseline comparison.",
            )
        try:
            return await habitat_drift_service.compare_site_historical_baseline(
                site_id=site_id,
                target_session_id=comp_in.target_session_id,
                db=db,
                baseline_lookback_days=comp_in.baseline_days_back,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported comparison_type '{comp_in.comparison_type}'. Allowed: session_vs_session, historical_baseline",
        )


@router.get(
    "/{site_id}/habitat-drift",
    response_model=HabitatDriftSummaryResponse,
    summary="Retrieve multi-temporal habitat drift trends and soundscape stability summary",
)
async def get_site_habitat_drift(
    site_id: str,
    db: AsyncSession = Depends(get_db),
):
    try:
        return await habitat_drift_service.get_site_drift_summary(site_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.get(
    "/{site_id}/incidents",
    response_model=List[EnvironmentalIncidentResponse],
    summary="List environmental disturbance and hazard incidents for this site",
)
async def list_site_incidents(
    site_id: str,
    status_filter: Optional[str] = Query(None, alias="status"),
    priority_filter: Optional[str] = Query(None, alias="priority"),
    db: AsyncSession = Depends(get_db),
):
    return await incident_management_service.list_incidents(
        db=db, site_id=site_id, status=status_filter, priority=priority_filter
    )


@router.get(
    "/{site_id}/reports",
    summary="Generate comprehensive ecological evidence report (JSON or CSV)",
)
async def get_site_report(
    site_id: str,
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    report_format: str = Query("json", alias="format", pattern="^(json|csv)$"),
    mask_sensitive_locations: bool = Query(True),
    db: AsyncSession = Depends(get_db),
):
    from app.schemas.environmental_intelligence import EcologicalReportRequest

    req = EcologicalReportRequest(
        site_id=site_id,
        start_date=start_date,
        end_date=end_date,
        format=report_format,
        mask_sensitive_locations=mask_sensitive_locations,
    )

    try:
        if report_format == "csv":
            csv_content = await ecological_report_service.generate_csv_report(req, db)
            return Response(
                content=csv_content,
                media_type="text/csv",
                headers={"Content-Disposition": f"attachment; filename=site_{site_id}_ecological_report.csv"},
            )
        else:
            return await ecological_report_service.generate_json_report(req, db)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
