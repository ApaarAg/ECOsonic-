import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, List, Optional
from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.site import Site


class LiveSession(Base):
    __tablename__ = "live_sessions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    source_type: Mapped[str] = mapped_column(
        String(50), nullable=False, default="browser_mic", index=True
    )
    device_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    site_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("sites.id", ondelete="SET NULL"), nullable=True, index=True
    )
    latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    stopped_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    status: Mapped[str] = mapped_column(
        String(50), nullable=False, default="created", index=True
    )
    sample_rate: Mapped[int] = mapped_column(Integer, default=32000, nullable=False)
    channels: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    total_audio_seconds: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    processed_audio_seconds: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    dropped_frames: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    dropped_windows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    recording_path: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    site: Mapped[Optional["Site"]] = relationship("Site")
    events: Mapped[List["LiveEvent"]] = relationship(
        "LiveEvent",
        back_populates="session",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="LiveEvent.start_seconds",
    )
    segments: Mapped[List["LiveSegment"]] = relationship(
        "LiveSegment",
        back_populates="session",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="LiveSegment.start_seconds",
    )

    __table_args__ = (
        Index("ix_live_sessions_status_created", "status", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<LiveSession(id={self.id}, source_type={self.source_type}, status={self.status})>"


class LiveEvent(Base):
    __tablename__ = "live_events"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    session_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("live_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    detection_id: Mapped[str] = mapped_column(
        String(36), default=lambda: str(uuid.uuid4()), nullable=False, index=True
    )
    start_seconds: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    end_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    class_label: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    scientific_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    common_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    confidence_score: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    taxon_group: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    model_version: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationship
    session: Mapped["LiveSession"] = relationship("LiveSession", back_populates="events")

    __table_args__ = (
        Index("ix_live_events_session_time", "session_id", "start_seconds", "end_seconds"),
        Index("ix_live_events_session_conf", "session_id", "confidence_score"),
    )

    def __repr__(self) -> str:
        return f"<LiveEvent(id={self.id}, label={self.class_label}, conf={self.confidence_score:.2f})>"


class LiveSegment(Base):
    __tablename__ = "live_segments"

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
    audio_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    embedding_path: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    processing_status: Mapped[str] = mapped_column(
        String(50), default="pending", nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationship
    session: Mapped["LiveSession"] = relationship("LiveSession", back_populates="segments")

    __table_args__ = (
        Index("ix_live_segments_session_time", "session_id", "start_seconds", "end_seconds"),
    )

    def __repr__(self) -> str:
        return f"<LiveSegment(id={self.id}, session={self.session_id}, time={self.start_seconds}-{self.end_seconds})>"
