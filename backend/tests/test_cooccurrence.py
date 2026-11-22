"""Unit and integration tests for biological vs anthropogenic co-occurrence analysis."""

from __future__ import annotations

import uuid
import pytest
from sqlalchemy import select

from app.core.database import async_session_factory
from app.models.live_session import LiveEvent, LiveSession
from app.models.soundscape import CoOccurrenceObservation, DisturbanceEvent
from app.services.soundscape.cooccurrence_service import CoOccurrenceService
from app.services.soundscape.disturbance_service import ActiveDisturbance


@pytest.mark.asyncio
async def test_cooccurrence_calculation_and_language(test_engine):
    """Verify before vs after rate calculation and strictly conservative non-causal wording."""
    session_id = str(uuid.uuid4())
    event_id = str(uuid.uuid4())

    async with async_session_factory() as db:
        # Create LiveSession
        live_sess = LiveSession(
            id=session_id,
            source_type="file_replay",
            sample_rate=32000,
            channels=1,
            status="active",
        )
        db.add(live_sess)

        # Create DisturbanceEvent (e.g. Engine from 30.0s to 40.0s)
        dist = DisturbanceEvent(
            id=event_id,
            session_id=session_id,
            class_label="Engine_Engine",
            event_type="engine",
            start_seconds=30.0,
            end_seconds=40.0,
            confidence_score=0.85,
        )
        db.add(dist)

        # Add 4 biological events before disturbance: [10s, 15s, 20s, 25s]
        for t in [10.0, 15.0, 20.0, 25.0]:
            e = LiveEvent(
                id=str(uuid.uuid4()),
                session_id=session_id,
                detection_id=str(uuid.uuid4()),
                start_seconds=t,
                end_seconds=t + 3.0,
                class_label="Turdus merula_Eurasian Blackbird",
                common_name="Eurasian Blackbird",
                confidence_score=0.8,
                taxon_group="Bird",
            )
            db.add(e)

        # Add 1 biological event after disturbance: [50s]
        e_post = LiveEvent(
            id=str(uuid.uuid4()),
            session_id=session_id,
            detection_id=str(uuid.uuid4()),
            start_seconds=50.0,
            end_seconds=53.0,
            class_label="Turdus merula_Eurasian Blackbird",
            common_name="Eurasian Blackbird",
            confidence_score=0.8,
            taxon_group="Bird",
        )
        db.add(e_post)

        await db.commit()

    service = CoOccurrenceService(default_window_seconds=30.0)
    active = ActiveDisturbance(
        event_id=event_id,
        session_id=session_id,
        class_label="Engine_Engine",
        event_type="engine",
        start_seconds=30.0,
        end_seconds=40.0,
        confidence_score=0.85,
    )

    obs = await service.evaluate_event(session_id=session_id, disturbance=active, comparison_window_seconds=30.0)

    assert obs is not None
    assert obs.disturbance_event_id == event_id
    # Pre window: [0 to 30s] (30s duration = 0.5 min). 4 events -> rate = 4 / 0.5 = 8.0 events/min
    assert obs.biological_activity_before == 8.0
    # Post window: [40 to 70s] (30s duration = 0.5 min). 1 event -> rate = 1 / 0.5 = 2.0 events/min
    assert obs.biological_activity_after == 2.0
    assert obs.difference_value == -6.0

    # Strict language verification
    assert "Temporal co-occurrence observed" in obs.interpretation
    assert "rate changed from 8.0 to 2.0 events/min following Engine_Engine" in obs.interpretation
    assert "caused" not in obs.interpretation.lower()
    assert "silenced" not in obs.interpretation.lower()

    # Verify persisted in database
    async with async_session_factory() as db:
        res = await db.execute(
            select(CoOccurrenceObservation).where(CoOccurrenceObservation.disturbance_event_id == event_id)
        )
        persisted = res.scalar_one_or_none()
        assert persisted is not None
        assert persisted.difference_value == -6.0
