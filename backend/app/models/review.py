import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional
from sqlalchemy import Column, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.detection import Detection


class Review(Base):
    __tablename__ = "reviews"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    detection_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("detections.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    review_status: Mapped[str] = mapped_column(
        String(50), nullable=False, default="confirmed", index=True
    )
    reviewer_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    detection: Mapped["Detection"] = relationship(
        "Detection", back_populates="reviews"
    )

    __table_args__ = (
        Index("ix_reviews_detection_status", "detection_id", "review_status"),
    )

    def __repr__(self) -> str:
        return f"<Review(id={self.id}, detection_id={self.detection_id}, status={self.review_status})>"
