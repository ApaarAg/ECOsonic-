import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Dict, List, Optional
from sqlalchemy import (
    Column,
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

if TYPE_CHECKING:
    from app.models.detection import Detection


class Analysis(Base):
    __tablename__ = "analyses"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    audio_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    processed_path: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    status: Mapped[str] = mapped_column(
        String(50), nullable=False, default="pending", index=True
    )
    progress: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    current_stage: Mapped[Optional[str]] = mapped_column(
        String(100), default="Pending", nullable=True
    )
    duration_seconds: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    gps_accuracy_m: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    gps_captured_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    recorded_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    model_version: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    metrics_json: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )
    ecological_summary_json: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )
    embedding_path: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    detections: Mapped[List["Detection"]] = relationship(
        "Detection",
        back_populates="analysis",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    embedding_segments: Mapped[List["EmbeddingSegment"]] = relationship(
        "EmbeddingSegment",
        back_populates="analysis",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    __table_args__ = (
        Index("ix_analyses_status_created", "status", "created_at"),
        Index("ix_analyses_recorded_at", "recorded_at"),
    )

    def __repr__(self) -> str:
        return f"<Analysis(id={self.id}, filename={self.filename}, status={self.status})>"


class EmbeddingSegment(Base):
    __tablename__ = "embedding_segments"

    segment_id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    analysis_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("analyses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    vector_index: Mapped[int] = mapped_column(Integer, nullable=False)
    start_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    end_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    detection_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("detections.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Relationships
    analysis: Mapped["Analysis"] = relationship(
        "Analysis", back_populates="embedding_segments"
    )
    detection: Mapped[Optional["Detection"]] = relationship(
        "Detection", back_populates="embedding_segments"
    )

    __table_args__ = (
        Index("ix_embedding_analysis_vec", "analysis_id", "vector_index"),
        Index("ix_embedding_time_window", "analysis_id", "start_seconds", "end_seconds"),
    )

    def __repr__(self) -> str:
        return f"<EmbeddingSegment(segment_id={self.segment_id}, analysis_id={self.analysis_id}, idx={self.vector_index})>"
