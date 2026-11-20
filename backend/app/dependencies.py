from typing import AsyncGenerator
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.repositories.analysis_repository import AnalysisRepository
from app.repositories.detection_repository import DetectionRepository
from app.repositories.site_repository import SiteRepository


async def get_analysis_repository(
    session: AsyncSession = Depends(get_db),
) -> AnalysisRepository:
    return AnalysisRepository(session)


async def get_detection_repository(
    session: AsyncSession = Depends(get_db),
) -> DetectionRepository:
    return DetectionRepository(session)


async def get_site_repository(
    session: AsyncSession = Depends(get_db),
) -> SiteRepository:
    return SiteRepository(session)
