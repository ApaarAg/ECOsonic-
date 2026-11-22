"""Database models for Soundscape Fingerprint, Disturbance Radar, and Co-occurrence Observations."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class SoundscapeMeasurement(Base):
    __tablename__ = "soundscape_measurements"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    session_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("live_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    start_seconds: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    end_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    aci: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    adi: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    aei: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ndsi: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    spectral_entropy: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    temporal_activity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    frequency_bands_json: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )
    parameters_json: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )
    quality_flags_json: Mapped[Optional[List[str]]] = mapped_column(
        JSON, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        Index("ix_soundscape_session_time", "session_id", "start_seconds", "end_seconds"),
    )

    @property
    def metrics(self) -> Dict[str, Any]:
        return {
            "aci": self.aci,
            "adi": self.adi,
            "aei": self.aei,
            "ndsi": self.ndsi,
            "spectral_entropy": self.spectral_entropy,
            "temporal_activity": self.temporal_activity,
        }

    @property
    def frequency_bands(self) -> Dict[str, Any]:
        return self.frequency_bands_json or {}

    @property
    def calculation_parameters(self) -> Dict[str, Any]:
        return self.parameters_json or {}

    @property
    def quality_flags(self) -> List[str]:
        return self.quality_flags_json or []

    def __repr__(self) -> str:
        return f"<SoundscapeMeasurement(id={self.id}, session={self.session_id}, time={self.start_seconds}-{self.end_seconds})>"


class DisturbanceEvent(Base):
    __tablename__ = "disturbance_events"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    session_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("live_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    class_label: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    hazard_classification: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)
    start_seconds: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    end_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    confidence_score: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    model_version: Mapped[str] = mapped_column(String(50), default="3.0.0", nullable=False)
    review_status: Mapped[str] = mapped_column(
        String(50), default="pending", nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    co_occurrences: Mapped[List["CoOccurrenceObservation"]] = relationship(
        "CoOccurrenceObservation",
        back_populates="disturbance_event",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    __table_args__ = (
        Index("ix_disturbances_session_time", "session_id", "start_seconds", "end_seconds"),
        Index("ix_disturbances_class", "class_label"),
    )

    @property
    def event_id(self) -> str:
        return self.id

    def __repr__(self) -> str:
        return f"<DisturbanceEvent(id={self.id}, label={self.class_label}, time={self.start_seconds}-{self.end_seconds})>"


class CoOccurrenceObservation(Base):
    __tablename__ = "co_occurrence_observations"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    session_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("live_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    disturbance_event_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("disturbance_events.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    biological_activity_before: Mapped[float] = mapped_column(Float, nullable=False)
    biological_activity_after: Mapped[float] = mapped_column(Float, nullable=False)
    comparison_window_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    difference_value: Mapped[float] = mapped_column(Float, nullable=False)
    interpretation: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationship
    disturbance_event: Mapped["DisturbanceEvent"] = relationship(
        "DisturbanceEvent", back_populates="co_occurrences"
    )

    __table_args__ = (
        Index("ix_co_occurrence_session", "session_id"),
        Index("ix_co_occurrence_event", "disturbance_event_id"),
    )

    def __repr__(self) -> str:
        return f"<CoOccurrenceObservation(id={self.id}, event={self.disturbance_event_id}, diff={self.difference_value:.2f})>"
