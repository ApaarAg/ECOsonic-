"""SQLAlchemy models for Acoustic Memory, vector indexing, HDBSCAN clustering, and UMAP projections."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class EmbeddingIndex(Base):
    """Metadata for the current memory-mapped or persistent vector index."""

    __tablename__ = "embedding_indices"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    model_version: Mapped[str] = mapped_column(
        String(100), default="BirdNET+ V3.0", nullable=False
    )
    embedding_dimension: Mapped[int] = mapped_column(
        Integer, default=1280, nullable=False
    )
    indexing_status: Mapped[str] = mapped_column(
        String(50), default="ready", nullable=False, index=True
    )
    vector_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    index_path: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
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

    def __repr__(self) -> str:
        return f"<EmbeddingIndex(id={self.id}, count={self.vector_count}, status={self.indexing_status})>"


class AcousticClusterRun(Base):
    """Record of an offline HDBSCAN clustering analysis run."""

    __tablename__ = "acoustic_cluster_runs"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    model_version: Mapped[str] = mapped_column(
        String(100), default="BirdNET+ V3.0", nullable=False
    )
    dataset_size: Mapped[int] = mapped_column(Integer, nullable=False)
    parameters_json: Mapped[Dict[str, Any]] = mapped_column(
        JSON, default=dict, nullable=False
    )
    cluster_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    noise_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(
        String(50), default="completed", nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    assignments: Mapped[List["AcousticClusterAssignment"]] = relationship(
        "AcousticClusterAssignment",
        back_populates="cluster_run",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    projections: Mapped[List["AcousticProjection"]] = relationship(
        "AcousticProjection",
        back_populates="cluster_run",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    def __repr__(self) -> str:
        return f"<AcousticClusterRun(id={self.id}, clusters={self.cluster_count}, noise={self.noise_count})>"


class AcousticClusterAssignment(Base):
    """Segment assignment to an acoustic cluster."""

    __tablename__ = "acoustic_cluster_assignments"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    cluster_run_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("acoustic_cluster_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    segment_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    cluster_label: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    cluster_run: Mapped["AcousticClusterRun"] = relationship(
        "AcousticClusterRun", back_populates="assignments"
    )

    __table_args__ = (
        Index("ix_cluster_assign_run_seg", "cluster_run_id", "segment_id"),
    )

    def __repr__(self) -> str:
        return f"<AcousticClusterAssignment(run={self.cluster_run_id}, seg={self.segment_id}, label={self.cluster_label})>"


class AcousticProjection(Base):
    """2D UMAP projection coordinates for high-dimensional visualization."""

    __tablename__ = "acoustic_projections"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    cluster_run_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("acoustic_cluster_runs.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    segment_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    x: Mapped[float] = mapped_column(Float, nullable=False)
    y: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    cluster_run: Mapped[Optional["AcousticClusterRun"]] = relationship(
        "AcousticClusterRun", back_populates="projections"
    )

    __table_args__ = (
        Index("ix_projection_run_seg", "cluster_run_id", "segment_id"),
    )

    def __repr__(self) -> str:
        return f"<AcousticProjection(seg={self.segment_id}, x={self.x:.2f}, y={self.y:.2f})>"
