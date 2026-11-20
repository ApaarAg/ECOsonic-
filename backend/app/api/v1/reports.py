import csv
import io
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.analysis import Analysis
from app.models.detection import Detection
from app.models.review import Review

router = APIRouter(prefix="/reports", tags=["Biodiversity Reports"])


@router.get(
    "/summary",
    summary="Generate high-level bioacoustic intelligence and biodiversity summary",
)
async def get_summary_report(
    session: AsyncSession = Depends(get_db),
):
    # Total analyses
    total_analyses = await session.scalar(select(func.count(Analysis.id))) or 0
    completed_analyses = await session.scalar(
        select(func.count(Analysis.id)).where(Analysis.status == "completed")
    ) or 0
    failed_analyses = await session.scalar(
        select(func.count(Analysis.id)).where(Analysis.status == "failed")
    ) or 0

    # Total detections & species richness
    total_detections = await session.scalar(select(func.count(Detection.id))) or 0
    unique_species = await session.scalar(
        select(func.count(func.distinct(Detection.scientific_name)))
    ) or 0

    # Human reviews summary
    total_reviews = await session.scalar(select(func.count(Review.id))) or 0
    confirmed_reviews = await session.scalar(
        select(func.count(Review.id)).where(Review.review_status == "confirmed")
    ) or 0

    # Top 10 detected species
    top_species_query = (
        select(
            Detection.scientific_name,
            Detection.common_name,
            func.count(Detection.id).label("count"),
            func.max(Detection.confidence_score).label("max_confidence"),
        )
        .group_by(Detection.scientific_name, Detection.common_name)
        .order_by(func.count(Detection.id).desc())
        .limit(10)
    )
    top_species_res = await session.execute(top_species_query)
    top_species = [
        {
            "scientific_name": row.scientific_name,
            "common_name": row.common_name,
            "detection_count": row.count,
            "max_confidence": round(row.max_confidence, 4),
        }
        for row in top_species_res
    ]

    return {
        "analyses": {
            "total": total_analyses,
            "completed": completed_analyses,
            "failed": failed_analyses,
        },
        "detections": {
            "total": total_detections,
            "unique_species_count": unique_species,
        },
        "reviews": {
            "total_reviews": total_reviews,
            "confirmed_count": confirmed_reviews,
        },
        "top_species": top_species,
    }


@router.get(
    "/export",
    summary="Export detections dataset to CSV for conservation research",
)
async def export_detections_csv(
    analysis_id: Optional[str] = Query(None, description="Filter export by analysis ID"),
    session: AsyncSession = Depends(get_db),
):
    query = select(Detection).order_by(Detection.start_seconds.asc())
    if analysis_id:
        query = query.where(Detection.analysis_id == analysis_id)

    res = await session.execute(query)
    detections = res.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "detection_id",
        "analysis_id",
        "scientific_name",
        "common_name",
        "taxon_group",
        "record_type",
        "start_seconds",
        "end_seconds",
        "confidence_score",
        "geo_score",
        "review_status",
    ])

    for d in detections:
        writer.writerow([
            d.id,
            d.analysis_id,
            d.scientific_name,
            d.common_name,
            d.taxon_group,
            d.record_type,
            d.start_seconds,
            d.end_seconds,
            d.confidence_score,
            d.geo_score or "",
            d.review_status,
        ])

    csv_data = output.getvalue()
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=ecosonic_detections.csv"},
    )
