"""SQLAlchemy model for cached species specimen image provenance."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SpeciesImageCache(Base):
    __tablename__ = "species_image_cache"

    scientific_name_key: Mapped[str] = mapped_column(String(255), primary_key=True)
    scientific_name: Mapped[str] = mapped_column(String(255), nullable=False)
    common_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    image_status: Mapped[str] = mapped_column(String(32), nullable=False, default="unavailable")
    image_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    license: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    attribution: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    retrieved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
