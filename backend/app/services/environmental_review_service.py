"""EcoSonic Expert Verification & Review Service.

Provides a robust, non-destructive human-in-the-loop review workflow for environmental acoustic observations,
unusual geographic predictions, disturbance events, and anomaly candidates.

Key Invariant:
Original model inferences, confidence scores, and raw acoustic signals are NEVER overwritten or mutated.
Expert verification decisions are recorded in dedicated audit records with full historical traceability.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.environmental_intelligence import EnvironmentalReview
from app.schemas.environmental_intelligence import (
    EnvironmentalReviewCreate,
    EnvironmentalReviewResponse,
    EnvironmentalReviewUpdate,
    ReviewDecision,
)

logger = logging.getLogger(__name__)

ALLOWED_REVIEW_DECISIONS = {"confirmed", "rejected", "uncertain", "needs_more_evidence"}
ALLOWED_REVIEW_CATEGORIES = {
    "unexpected_geographic_occurrence",
    "low_confidence_acoustic_prediction",
    "unusual_acoustic_anomaly",
    "repeated_disturbance_event",
    "soundscape_change",
}


class EnvironmentalReviewService:
    """Production service managing expert verification workflows and audit histories."""

    async def create_review(
        self,
        review_in: EnvironmentalReviewCreate,
        db: AsyncSession,
    ) -> EnvironmentalReviewResponse:
        """Create a new human verification record for an AI prediction or observation."""
        if review_in.review_decision not in ALLOWED_REVIEW_DECISIONS:
            raise ValueError(f"Invalid review decision '{review_in.review_decision}'. Allowed: {ALLOWED_REVIEW_DECISIONS}")

        rev_id = str(uuid.uuid4())
        now_dt = datetime.now(timezone.utc)
        initial_history_entry = {
            "timestamp": now_dt.isoformat(),
            "action": "created",
            "decision": review_in.review_decision,
            "note": review_in.reviewer_note,
        }

        record = EnvironmentalReview(
            id=rev_id,
            review_category=review_in.review_category,
            target_type=review_in.target_type,
            target_id=review_in.target_id,
            site_id=review_in.site_id,
            session_id=review_in.session_id,
            original_prediction_json=review_in.original_prediction,
            original_score=review_in.original_score,
            geo_context_json=review_in.geo_context,
            audio_evidence_path=review_in.audio_evidence_path,
            review_decision=review_in.review_decision,
            reviewer_note=review_in.reviewer_note,
            history_json=[initial_history_entry],
            created_at=now_dt,
            updated_at=now_dt,
        )

        db.add(record)
        await db.flush()
        return EnvironmentalReviewResponse.model_validate(record)

    async def update_review(
        self,
        review_id: str,
        update_in: EnvironmentalReviewUpdate,
        db: AsyncSession,
    ) -> Optional[EnvironmentalReviewResponse]:
        """Update an existing verification record while logging an audit trail in history."""
        record = await db.get(EnvironmentalReview, review_id)
        if not record:
            return None

        if update_in.review_decision not in ALLOWED_REVIEW_DECISIONS:
            raise ValueError(f"Invalid review decision '{update_in.review_decision}'.")

        now_dt = datetime.now(timezone.utc)
        history_entry = {
            "timestamp": now_dt.isoformat(),
            "action": "decision_updated",
            "previous_decision": record.review_decision,
            "new_decision": update_in.review_decision,
            "previous_note": record.reviewer_note,
            "new_note": update_in.reviewer_note,
        }

        history = list(record.history_json or [])
        history.append(history_entry)

        record.review_decision = update_in.review_decision
        record.reviewer_note = update_in.reviewer_note
        record.history_json = history
        record.updated_at = now_dt

        await db.flush()
        return EnvironmentalReviewResponse.model_validate(record)

    async def get_review(self, review_id: str, db: AsyncSession) -> Optional[EnvironmentalReviewResponse]:
        """Retrieve a specific verification record by ID."""
        record = await db.get(EnvironmentalReview, review_id)
        if not record:
            return None
        return EnvironmentalReviewResponse.model_validate(record)

    async def list_reviews(
        self,
        db: AsyncSession,
        site_id: Optional[str] = None,
        session_id: Optional[str] = None,
        review_category: Optional[str] = None,
        review_decision: Optional[str] = None,
        limit: int = 50,
    ) -> List[EnvironmentalReviewResponse]:
        """List verification records filtered by site, session, category, or decision status."""
        stmt = select(EnvironmentalReview).order_by(desc(EnvironmentalReview.created_at))
        if site_id:
            stmt = stmt.where(EnvironmentalReview.site_id == site_id)
        if session_id:
            stmt = stmt.where(EnvironmentalReview.session_id == session_id)
        if review_category:
            stmt = stmt.where(EnvironmentalReview.review_category == review_category)
        if review_decision:
            stmt = stmt.where(EnvironmentalReview.review_decision == review_decision)
        stmt = stmt.limit(limit)

        records = (await db.execute(stmt)).scalars().all()
        return [EnvironmentalReviewResponse.model_validate(r) for r in records]


# Global singleton instance
environmental_review_service = EnvironmentalReviewService()
