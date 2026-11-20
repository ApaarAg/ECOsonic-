import uuid
from typing import TYPE_CHECKING, List, Optional
from sqlalchemy import Float, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.analysis import Analysis, EmbeddingSegment
    from app.models.review import Review


class Detection(Base):
    __tablename__ = "detections"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    analysis_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("analyses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    class_label: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    scientific_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    common_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    taxon_group: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    record_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, default="vocalization")
    start_seconds: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    end_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    confidence_score: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    geo_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    review_status: Mapped[str] = mapped_column(
        String(50), nullable=False, default="unreviewed", index=True
    )

    # Relationships
    analysis: Mapped["Analysis"] = relationship("Analysis", back_populates="detections")
    reviews: Mapped[List["Review"]] = relationship(
        "Review",
        back_populates="detection",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    embedding_segments: Mapped[List["EmbeddingSegment"]] = relationship(
        "EmbeddingSegment",
        back_populates="detection",
        passive_deletes=True,
    )

    __table_args__ = (
        Index("ix_detections_analysis_conf", "analysis_id", "confidence_score"),
        Index("ix_detections_species_conf", "scientific_name", "confidence_score"),
        Index("ix_detections_time_window", "analysis_id", "start_seconds", "end_seconds"),
    )

    def __repr__(self) -> str:
        return f"<Detection(id={self.id}, scientific_name={self.scientific_name}, conf={self.confidence_score:.2f})>"
