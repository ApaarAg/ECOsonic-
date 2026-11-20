from typing import Any, Dict, List, Optional, Tuple
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.analysis import Analysis, EmbeddingSegment
from app.models.detection import Detection


class AnalysisRepository:
    """Async repository for analyses and embedding segment database operations."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, analysis: Analysis) -> Analysis:
        self.session.add(analysis)
        await self.session.flush()
        return analysis

    async def get_by_id(
        self, analysis_id: str, load_relations: bool = False
    ) -> Optional[Analysis]:
        query = select(Analysis).where(Analysis.id == analysis_id)
        if load_relations:
            query = query.options(
                selectinload(Analysis.detections).selectinload(Detection.reviews),
                selectinload(Analysis.embedding_segments),
            )
        result = await self.session.execute(query)
        return result.scalar_one_or_none()

    async def update(self, analysis_id: str, **kwargs: Any) -> Optional[Analysis]:
        stmt = (
            update(Analysis)
            .where(Analysis.id == analysis_id)
            .values(**kwargs)
            .returning(Analysis)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def update_status(
        self,
        analysis_id: str,
        status: str,
        progress: float,
        current_stage: Optional[str] = None,
        error_message: Optional[str] = None,
    ) -> Optional[Analysis]:
        values: Dict[str, Any] = {
            "status": status,
            "progress": round(progress, 1),
        }
        if current_stage is not None:
            values["current_stage"] = current_stage
        if error_message is not None:
            values["error_message"] = error_message

        stmt = (
            update(Analysis)
            .where(Analysis.id == analysis_id)
            .values(**values)
            .returning(Analysis)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list(
        self,
        skip: int = 0,
        limit: int = 20,
        status: Optional[str] = None,
    ) -> Tuple[List[Analysis], int]:
        count_query = select(func.count(Analysis.id))
        if status:
            count_query = count_query.where(Analysis.status == status)
        total_res = await self.session.execute(count_query)
        total = total_res.scalar() or 0

        query = (
            select(Analysis)
            .options(selectinload(Analysis.detections))
            .order_by(Analysis.created_at.desc())
            .offset(skip)
            .limit(limit)
        )
        if status:
            query = query.where(Analysis.status == status)

        result = await self.session.execute(query)
        items = list(result.scalars().all())
        return items, total

    async def delete(self, analysis_id: str) -> bool:
        analysis = await self.get_by_id(analysis_id, load_relations=True)
        if not analysis:
            return False
        await self.session.delete(analysis)
        await self.session.flush()
        return True

    async def add_embedding_segments(
        self, segments: List[EmbeddingSegment]
    ) -> None:
        if segments:
            self.session.add_all(segments)
            await self.session.flush()
