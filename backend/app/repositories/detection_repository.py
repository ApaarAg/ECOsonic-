from typing import List, Optional, Tuple
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.detection import Detection
from app.models.review import Review


class DetectionRepository:
    """Async repository for detections and human reviews."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create_batch(self, detections: List[Detection]) -> List[Detection]:
        if not detections:
            return []
        self.session.add_all(detections)
        await self.session.flush()
        return detections

    async def get_by_id(self, detection_id: str) -> Optional[Detection]:
        query = (
            select(Detection)
            .where(Detection.id == detection_id)
            .options(selectinload(Detection.reviews))
        )
        result = await self.session.execute(query)
        return result.scalar_one_or_none()

    async def list(
        self,
        analysis_id: Optional[str] = None,
        min_confidence: Optional[float] = None,
        species: Optional[str] = None,
        review_status: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> Tuple[List[Detection], int]:
        count_query = select(func.count(Detection.id))
        query = select(Detection).options(selectinload(Detection.reviews))

        if analysis_id:
            count_query = count_query.where(Detection.analysis_id == analysis_id)
            query = query.where(Detection.analysis_id == analysis_id)
        if min_confidence is not None:
            count_query = count_query.where(Detection.confidence_score >= min_confidence)
            query = query.where(Detection.confidence_score >= min_confidence)
        if species:
            species_filter = f"%{species}%"
            cond = Detection.scientific_name.ilike(species_filter) | Detection.common_name.ilike(species_filter)
            count_query = count_query.where(cond)
            query = query.where(cond)
        if review_status:
            count_query = count_query.where(Detection.review_status == review_status)
            query = query.where(Detection.review_status == review_status)

        total_res = await self.session.execute(count_query)
        total = total_res.scalar() or 0

        query = query.order_by(Detection.start_seconds.asc()).offset(skip).limit(limit)
        result = await self.session.execute(query)
        items = list(result.scalars().all())
        return items, total

    async def create_review(self, review: Review) -> Review:
        self.session.add(review)
        await self.session.flush()

        # Update the detection's review_status synchronously
        stmt = (
            update(Detection)
            .where(Detection.id == review.detection_id)
            .values(review_status=review.review_status)
        )
        await self.session.execute(stmt)
        return review

    async def update_review_status(
        self, detection_id: str, status: str
    ) -> Optional[Detection]:
        stmt = (
            update(Detection)
            .where(Detection.id == detection_id)
            .values(review_status=status)
            .returning(Detection)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()
