"""Biological vs Non-Biological Co-occurrence analysis service."""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Coroutine, Dict, List, Optional

from sqlalchemy import select

from app.core.database import async_session_factory
from app.core.logging import logger
from app.models.live_session import LiveEvent
from app.models.soundscape import CoOccurrenceObservation, DisturbanceEvent
from app.services.soundscape.disturbance_service import (
    BIRDNET_V3_DISTURBANCE_CLASSES,
    ActiveDisturbance,
)

BroadcastCallback = Callable[[Dict[str, Any]], Coroutine[Any, Any, None]]


class CoOccurrenceService:
    """Evaluates temporal relationships between anthropogenic/disturbance events and biological vocal activity.

    Adheres strictly to ecological reporting guidelines: reports temporal co-occurrence
    without claiming causal behavioral impact.
    """

    def __init__(self, default_window_seconds: float = 30.0) -> None:
        self.default_window_seconds = default_window_seconds

    async def evaluate_event(
        self,
        session_id: str,
        disturbance: Any,  # ActiveDisturbance or DisturbanceEvent
        comparison_window_seconds: Optional[float] = None,
        broadcast_cb: Optional[BroadcastCallback] = None,
    ) -> Optional[CoOccurrenceObservation]:
        """Compute biological detection rates before vs after a disturbance event and persist observation."""
        window_s = comparison_window_seconds or self.default_window_seconds

        event_id = getattr(disturbance, "event_id", None) or getattr(disturbance, "id", None)
        class_label = getattr(disturbance, "class_label", "Unknown")
        start_s = float(getattr(disturbance, "start_seconds", 0.0))
        end_s = float(getattr(disturbance, "end_seconds", 0.0))

        if not event_id:
            logger.error("Cannot evaluate co-occurrence: missing event_id")
            return None

        # Pre-event range: [max(0, start_s - window_s), start_s]
        pre_start = max(0.0, start_s - window_s)
        pre_end = start_s
        pre_dur = max(0.1, pre_end - pre_start)

        # Post-event range: [end_s, end_s + window_s]
        post_start = end_s
        post_end = end_s + window_s
        post_dur = max(0.1, post_end - post_start)

        try:
            async with async_session_factory() as session:
                # Query all biological detections in session
                query = select(LiveEvent).where(
                    LiveEvent.session_id == session_id,
                    LiveEvent.start_seconds >= pre_start,
                    LiveEvent.start_seconds <= post_end,
                )
                res = await session.execute(query)
                events = res.scalars().all()

                # Filter strictly for biological vocalizations
                bio_pre = [
                    e
                    for e in events
                    if pre_start <= e.start_seconds < pre_end
                    and e.class_label not in BIRDNET_V3_DISTURBANCE_CLASSES
                    and (e.taxon_group or "").lower() != "sound_class"
                ]

                bio_post = [
                    e
                    for e in events
                    if post_start <= e.start_seconds <= post_end
                    and e.class_label not in BIRDNET_V3_DISTURBANCE_CLASSES
                    and (e.taxon_group or "").lower() != "sound_class"
                ]

                # Calculate activity rate in events per minute
                rate_before = round(len(bio_pre) / (pre_dur / 60.0), 2)
                rate_after = round(len(bio_post) / (post_dur / 60.0), 2)
                diff = round(rate_after - rate_before, 2)

                # Formulate scientifically defensible, conservative interpretation (NO causal claims)
                if abs(diff) > 0.05:
                    interpretation = (
                        f"Temporal co-occurrence observed: biological detection rate changed from "
                        f"{rate_before:.1f} to {rate_after:.1f} events/min following {class_label}."
                    )
                else:
                    interpretation = (
                        f"Temporal co-occurrence observed: biological detection rate remained steady at "
                        f"{rate_before:.1f} events/min following {class_label}."
                    )

                obs_id = str(uuid.uuid4())
                observation = CoOccurrenceObservation(
                    id=obs_id,
                    session_id=session_id,
                    disturbance_event_id=event_id,
                    biological_activity_before=rate_before,
                    biological_activity_after=rate_after,
                    comparison_window_seconds=window_s,
                    difference_value=diff,
                    interpretation=interpretation,
                )
                session.add(observation)
                await session.commit()

                logger.info(
                    "Co-occurrence evaluated for event %s (%s): before=%.1f, after=%.1f, diff=%.1f",
                    event_id,
                    class_label,
                    rate_before,
                    rate_after,
                    diff,
                )

                # Broadcast WebSocket event
                if broadcast_cb:
                    ws_payload = {
                        "type": "co_occurrence_observed",
                        "session_id": session_id,
                        "observation_id": obs_id,
                        "disturbance_event_id": event_id,
                        "biological_activity_before": rate_before,
                        "biological_activity_after": rate_after,
                        "comparison_window_seconds": window_s,
                        "difference_value": diff,
                        "interpretation": interpretation,
                    }
                    await broadcast_cb(ws_payload)

                return observation

        except Exception as exc:
            logger.error(
                "Co-occurrence evaluation failed for event %s in session %s: %s",
                event_id,
                session_id,
                exc,
                exc_info=True,
            )
            return None


cooccurrence_service = CoOccurrenceService()
