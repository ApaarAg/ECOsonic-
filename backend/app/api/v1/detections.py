import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.dependencies import get_detection_repository
from app.models.review import Review
from app.repositories.detection_repository import DetectionRepository
from app.schemas.common import PaginatedResponse
from app.schemas.detection import DetectionResponse, ReviewCreate, ReviewResponse

router = APIRouter(prefix="/detections", tags=["Detections"])


@router.get(
    "",
    response_model=PaginatedResponse[DetectionResponse],
    summary="Query detections with multidimensional filters",
)
async def list_detections(
    analysis_id: Optional[str] = Query(None, description="Filter by specific analysis UUID"),
    min_confidence: Optional[float] = Query(None, ge=0.0, le=1.0, description="Minimum confidence score threshold"),
    species: Optional[str] = Query(None, description="Filter by scientific or common species name"),
    review_status: Optional[str] = Query(None, description="Filter by review status (unreviewed, confirmed, rejected, etc.)"),
    record_type: Optional[str] = Query(None, description="Filter by record_type (animal or sound_class)"),
    biological_only: bool = Query(False, description="When true, exclude non-biological sound_class rows"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    repo: DetectionRepository = Depends(get_detection_repository),
):
    skip = (page - 1) * page_size
    effective_record_type = "animal" if biological_only else record_type
    items, total = await repo.list(
        analysis_id=analysis_id,
        min_confidence=min_confidence,
        species=species,
        review_status=review_status,
        record_type=effective_record_type,
        skip=skip,
        limit=page_size,
    )
    total_pages = (total + page_size - 1) // page_size if total > 0 else 0

    return PaginatedResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get(
    "/{detection_id}",
    response_model=DetectionResponse,
    summary="Get single detection details by UUID",
)
async def get_detection(
    detection_id: str,
    repo: DetectionRepository = Depends(get_detection_repository),
):
    det = await repo.get_by_id(detection_id)
    if not det:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Detection with ID '{detection_id}' not found.",
        )
    return det


@router.post(
    "/{detection_id}/reviews",
    response_model=ReviewResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Submit a human verification review for a detection",
)
async def create_review(
    detection_id: str,
    review_in: ReviewCreate,
    repo: DetectionRepository = Depends(get_detection_repository),
):
    det = await repo.get_by_id(detection_id)
    if not det:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Detection with ID '{detection_id}' not found.",
        )

    review = Review(
        id=str(uuid.uuid4()),
        detection_id=detection_id,
        review_status=review_in.review_status,
        reviewer_note=review_in.reviewer_note,
    )
    created_review = await repo.create_review(review)
    return created_review
