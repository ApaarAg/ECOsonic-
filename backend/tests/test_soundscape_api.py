"""Integration tests for Phase 4B REST endpoints: soundscape, disturbances, timeline, and co-occurrence."""

from __future__ import annotations

import uuid
import pytest
from httpx import AsyncClient

from app.core.database import async_session_factory
from app.models.live_session import LiveEvent, LiveSession
from app.models.soundscape import (
    CoOccurrenceObservation,
    DisturbanceEvent,
    SoundscapeMeasurement,
)


@pytest.mark.asyncio
async def test_get_disturbance_taxonomy(client: AsyncClient):
    """Verify GET /api/v1/live/disturbances/taxonomy returns the verified 16 classes."""
    resp = await client.get("/api/v1/live/disturbances/taxonomy")
    assert resp.status_code == 200
    data = resp.json()
    assert data["supported_classes_count"] == 16
    assert "classes" in data
    assert "Chainsaw_Chainsaw" in data["classes"]
    assert "Gun_Gun" in data["classes"]
    assert "Engine_Engine" in data["classes"]


@pytest.mark.asyncio
async def test_soundscape_measurements_endpoint(client: AsyncClient):
    """Verify GET /api/v1/live/sessions/{session_id}/soundscape."""
    session_id = str(uuid.uuid4())
    meas_id = str(uuid.uuid4())

    async with async_session_factory() as db:
        sess = LiveSession(id=session_id, source_type="desktop_mic", sample_rate=32000, channels=1, status="active")
        db.add(sess)

        meas = SoundscapeMeasurement(
            id=meas_id,
            session_id=session_id,
            start_seconds=0.0,
            end_seconds=30.0,
            aci=120.5,
            adi=2.1,
            aei=0.45,
            ndsi=0.62,
            spectral_entropy=0.74,
            temporal_activity=0.85,
            frequency_bands_json={"core_biophony_pct": 80.0},
            parameters_json={"n_fft": 1024},
            quality_flags_json=[],
        )
        db.add(meas)
        await db.commit()

    resp = await client.get(f"/api/v1/live/sessions/{session_id}/soundscape")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["id"] == meas_id
    assert items[0]["metrics"]["aci"] == 120.5
    assert items[0]["metrics"]["ndsi"] == 0.62


@pytest.mark.asyncio
async def test_disturbance_events_endpoint(client: AsyncClient):
    """Verify GET /api/v1/live/sessions/{session_id}/disturbances."""
    session_id = str(uuid.uuid4())
    event_id = str(uuid.uuid4())

    async with async_session_factory() as db:
        sess = LiveSession(id=session_id, source_type="field_device", sample_rate=32000, channels=1, status="active")
        db.add(sess)

        dist = DisturbanceEvent(
            id=event_id,
            session_id=session_id,
            class_label="Chainsaw_Chainsaw",
            event_type="chainsaw",
            start_seconds=15.0,
            end_seconds=24.0,
            confidence_score=0.91,
            model_version="3.0.0",
            review_status="pending",
        )
        db.add(dist)
        await db.commit()

    resp = await client.get(f"/api/v1/live/sessions/{session_id}/disturbances")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["event_id"] == event_id
    assert items[0]["class_label"] == "Chainsaw_Chainsaw"
    assert items[0]["event_type"] == "chainsaw"
    assert items[0]["confidence_score"] == 0.91


@pytest.mark.asyncio
async def test_unified_timeline_endpoint(client: AsyncClient):
    """Verify GET /api/v1/live/sessions/{session_id}/timeline returns chronological merged stream."""
    session_id = str(uuid.uuid4())

    async with async_session_factory() as db:
        sess = LiveSession(id=session_id, source_type="browser_mic", sample_rate=32000, channels=1, status="active")
        db.add(sess)

        # 1. Biological event at 5s
        e1 = LiveEvent(
            id=str(uuid.uuid4()),
            session_id=session_id,
            detection_id=str(uuid.uuid4()),
            start_seconds=5.0,
            end_seconds=8.0,
            class_label="Parus major_Great Tit",
            common_name="Great Tit",
            confidence_score=0.88,
            taxon_group="Bird",
        )
        db.add(e1)

        # 2. Disturbance at 12s
        d1 = DisturbanceEvent(
            id=str(uuid.uuid4()),
            session_id=session_id,
            class_label="Engine_Engine",
            event_type="engine",
            start_seconds=12.0,
            end_seconds=18.0,
            confidence_score=0.79,
        )
        db.add(d1)

        # 3. Soundscape at 0-30s
        s1 = SoundscapeMeasurement(
            id=str(uuid.uuid4()),
            session_id=session_id,
            start_seconds=0.0,
            end_seconds=30.0,
            aci=150.0,
        )
        db.add(s1)

        await db.commit()

    resp = await client.get(f"/api/v1/live/sessions/{session_id}/timeline")
    assert resp.status_code == 200
    timeline = resp.json()
    assert len(timeline) == 3

    # Sorted by start_seconds: 0.0 (soundscape), 5.0 (biological), 12.0 (disturbance)
    assert timeline[0]["item_type"] == "soundscape_measurement"
    assert timeline[0]["start_seconds"] == 0.0

    assert timeline[1]["item_type"] == "biological_detection"
    assert timeline[1]["start_seconds"] == 5.0
    assert timeline[1]["label"] == "Great Tit"

    assert timeline[2]["item_type"] == "disturbance_event"
    assert timeline[2]["start_seconds"] == 12.0
    assert timeline[2]["label"] == "Engine_Engine"


@pytest.mark.asyncio
async def test_fingerprint_endpoint(client: AsyncClient):
    """Verify GET /api/v1/live/sessions/{session_id}/fingerprint."""
    session_id = str(uuid.uuid4())

    async with async_session_factory() as db:
        sess = LiveSession(id=session_id, source_type="desktop_mic", sample_rate=32000, channels=1, status="active")
        db.add(sess)

        meas = SoundscapeMeasurement(
            id=str(uuid.uuid4()),
            session_id=session_id,
            start_seconds=0.0,
            end_seconds=60.0,
            aci=180.0,
            adi=2.3,
            aei=0.35,
            ndsi=0.45,
            spectral_entropy=0.68,
            temporal_activity=0.72,
            frequency_bands_json={"core_biophony_pct": 65.0},
            parameters_json={"n_fft": 1024},
            quality_flags_json=[],
        )
        db.add(meas)
        await db.commit()

    resp = await client.get(f"/api/v1/live/sessions/{session_id}/fingerprint")
    assert resp.status_code == 200
    fp = resp.json()
    assert fp["session_id"] == session_id
    assert fp["window_start_seconds"] == 0.0
    assert fp["window_end_seconds"] == 60.0
    assert fp["metrics"]["aci"] == 180.0
    assert fp["metrics"]["ndsi"] == 0.45
