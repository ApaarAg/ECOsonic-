import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, DateTime, Float, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Site(Base):
    __tablename__ = "sites"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        Index("ix_sites_coordinates", "latitude", "longitude"),
    )

    def __repr__(self) -> str:
        return f"<Site(id={self.id}, name={self.name})>"
