import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy import Column, DateTime, Float, Index, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Site(Base):
    __tablename__ = "sites"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ecosystem_category: Mapped[str] = mapped_column(
        String(50), nullable=False, default="forest", index=True
    )
    timezone: Mapped[str] = mapped_column(String(50), nullable=False, default="UTC")
    location_sensitivity: Mapped[str] = mapped_column(
        String(50), nullable=False, default="exact", index=True
    )  # exact, generalized, restricted
    generalized_latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    generalized_longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ecosystem_profile_json: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    metadata_json: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        Index("ix_sites_coordinates", "latitude", "longitude"),
        Index("ix_sites_ecosystem", "ecosystem_category"),
    )

    def get_public_coordinates(self) -> Dict[str, Optional[float]]:
        """Return coordinate dictionary respecting location sensitivity privacy policy."""
        if self.location_sensitivity == "restricted":
            return {
                "latitude": None,
                "longitude": None,
                "sensitivity": "restricted",
                "note": "Coordinates restricted for ecological sensitivity protection.",
            }
        elif self.location_sensitivity == "generalized":
            gen_lat = self.generalized_latitude if self.generalized_latitude is not None else round(self.latitude, 2)
            gen_lon = self.generalized_longitude if self.generalized_longitude is not None else round(self.longitude, 2)
            return {
                "latitude": gen_lat,
                "longitude": gen_lon,
                "sensitivity": "generalized",
                "note": "Coordinates generalized to protect precise species location.",
            }
        return {
            "latitude": self.latitude,
            "longitude": self.longitude,
            "sensitivity": "exact",
            "note": "Exact physical recording station coordinates.",
        }

    def __repr__(self) -> str:
        return f"<Site(id={self.id}, name={self.name}, ecosystem={self.ecosystem_category})>"
