from __future__ import annotations

import time

import numpy as np
import pytest
from sqlalchemy import select

from app.models.live_session import LiveEvent
from app.services.analysis_pipeline import ModelDetectionOutput, analysis_pipeline
from app.services.direct_onnx_engine import DirectInferenceResult, direct_onnx_engine
from app.services.live.embedding_worker import embedding_worker
from app.services.live.inference_worker import LiveInferenceWorker
from app.services.live.ring_buffer import AudioWindow
from app.services.soundscape.disturbance_service import disturbance_service


@pytest.mark.asyncio
async def test_worker_preserves_animal_and_sound_class_through_database_and_websocket(
    client, test_session, monkeypatch
):
    created = await client.post(
        "/api/v1/live/sessions",
        json={"source_type": "browser_mic", "sample_rate": 32000, "channels": 1},
    )
    assert created.status_code == 201
    session_id = created.json()["id"]

    detections = [
        ModelDetectionOutput(
            class_label="Turdus_merula_Blackbird",
            scientific_name="Turdus merula",
            common_name="Blackbird",
            taxon_group="Bird",
            record_type="animal",
            start_seconds=0.0,
            end_seconds=3.0,
            confidence_score=0.91,
        ),
        ModelDetectionOutput(
            class_label="Fire_Fire",
            scientific_name="Unknown",
            common_name="Fire",
            taxon_group=None,
            record_type="sound_class",
            start_seconds=0.0,
            end_seconds=3.0,
            confidence_score=0.77,
        ),
    ]
    result = DirectInferenceResult(
        detections=detections,
        embedding=np.zeros(1280, dtype=np.float32),
        raw_scores=np.zeros(11725, dtype=np.float32),
        inference_duration_s=0.004,
    )
    monkeypatch.setattr(analysis_pipeline, "engine", None)
    monkeypatch.setattr(direct_onnx_engine, "load", lambda: None)
    monkeypatch.setattr(direct_onnx_engine, "infer", lambda *_args, **_kwargs: result)

    async def skip_disturbance_detection(**_kwargs):
        return None

    async def skip_embedding_persistence(_task):
        return None

    monkeypatch.setattr(disturbance_service, "process_window_detections", skip_disturbance_detection)
    monkeypatch.setattr(embedding_worker, "enqueue", skip_embedding_persistence)
    events = []

    async def broadcast(event):
        events.append(event)

    worker = LiveInferenceWorker(session_id=session_id, event_callback=broadcast)
    await worker._process_window(
        AudioWindow(
            data=np.sin(np.linspace(0, 100, 96000)).astype(np.float32) * 0.1,
            start_seconds=0.0,
            end_seconds=3.0,
            window_index=0,
            rms_energy=0.07,
            is_silent=False,
            is_clipped=False,
            created_at=time.perf_counter(),
        )
    )

    persisted = (
        await test_session.execute(
            select(LiveEvent).where(LiveEvent.session_id == session_id).order_by(LiveEvent.class_label)
        )
    ).scalars().all()
    assert [(event.record_type, event.taxon_group) for event in persisted] == [
        ("sound_class", None),
        ("animal", "Bird"),
    ]
    broadcast_detections = [event for event in events if event["type"] == "detection"]
    assert [(event["record_type"], event["taxon_group"]) for event in broadcast_detections] == [
        ("animal", "Bird"),
        ("sound_class", None),
    ]
    assert all(event["start_seconds"] == 0.0 and event["end_seconds"] == 3.0 for event in broadcast_detections)
