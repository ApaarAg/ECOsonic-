from typing import Any, List, Optional, Tuple
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.site import Site


class SiteRepository:
    """Async repository for monitoring sites."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, site: Site) -> Site:
        self.session.add(site)
        await self.session.flush()
        return site

    async def get_by_id(self, site_id: str) -> Optional[Site]:
        query = select(Site).where(Site.id == site_id)
        result = await self.session.execute(query)
        return result.scalar_one_or_none()

    async def list(
        self, skip: int = 0, limit: int = 50
    ) -> Tuple[List[Site], int]:
        total_res = await self.session.execute(select(func.count(Site.id)))
        total = total_res.scalar() or 0

        query = (
            select(Site)
            .order_by(Site.created_at.desc())
            .offset(skip)
            .limit(limit)
        )
        result = await self.session.execute(query)
        items = list(result.scalars().all())
        return items, total

    async def update(self, site_id: str, **kwargs: Any) -> Optional[Site]:
        stmt = (
            update(Site)
            .where(Site.id == site_id)
            .values(**kwargs)
            .returning(Site)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def delete(self, site_id: str) -> bool:
        stmt = delete(Site).where(Site.id == site_id)
        result = await self.session.execute(stmt)
        return (result.rowcount or 0) > 0
