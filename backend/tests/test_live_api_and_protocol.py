"""Integration tests for live streaming REST endpoints, WebSocket protocol, and frame validation."""

from __future__ import annotations

import asyncio
import json
import math
import socket
import struct
import numpy as np
import pytest
import pytest_asyncio
import uvicorn
import websockets
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core import database
from app.core.database import get_db
from app.main import app
from app.services.analysis_pipeline import FallbackMockEngine, analysis_pipeline
from app.services.live import embedding_worker, inference_worker, session_manager
from app.services.live.session_manager import live_session_manager


@pytest.fixture(autouse=True)
def setup_mock_engine():
    """Inject mock engine for fast API and protocol tests."""
    previous = analysis_pipeline.engine
    analysis_pipeline.set_engine(FallbackMockEngine())
    analysis_pipeline.load()
    yield
    analysis_pipeline.set_engine(previous)


@pytest_asyncio.fixture
async def live_ws_server(test_engine):
    """Run FastAPI + WebSocket endpoint on the active asyncio loop via uvicorn."""
    maker = async_sessionmaker(
        bind=test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    previous_db_factory = database.async_session_factory
    database.async_session_factory = maker
    embedding_worker.async_session_factory = maker
    inference_worker.async_session_factory = maker
    session_manager.async_session_factory = maker

    async def override_get_db():
        async with maker() as db_session:
            try:
                yield db_session
                await db_session.commit()
            except Exception:
                await db_session.rollback()
                raise
            finally:
                await db_session.close()

    app.dependency_overrides[get_db] = override_get_db

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]

    config = uvicorn.Config(
        app=app,
        host="127.0.0.1",
        port=port,
        log_level="warning",
        lifespan="off",
    )
    server = uvicorn.Server(config)
    server_task = asyncio.create_task(server.serve())
    for _ in range(200):
        if server.started:
            break
        await asyncio.sleep(0.02)

    try:
        yield f"http://127.0.0.1:{port}", f"ws://127.0.0.1:{port}"
    finally:
        await live_session_manager.shutdown(timeout=5.0)
        server.should_exit = True
        await asyncio.wait_for(server_task, timeout=5.0)
        app.dependency_overrides.clear()
        database.async_session_factory = previous_db_factory
        embedding_worker.async_session_factory = previous_db_factory
        inference_worker.async_session_factory = previous_db_factory
        session_manager.async_session_factory = previous_db_factory


@pytest.mark.asyncio
async def test_live_session_rest_lifecycle(client: AsyncClient):
    # 1. Create live session
    payload = {
        "source_type": "desktop_mic",
        "device_id": "realtek_high_def",
        "latitude": 45.123,
        "longitude": -73.456,
        "sample_rate": 32000,
        "channels": 1,
    }
    res = await client.post("/api/v1/live/sessions", json=payload)
    assert res.status_code == 201
    data = res.json()
    assert data["source_type"] == "desktop_mic"
    assert data["status"] == "created"
    assert "id" in data
    session_id = data["id"]

    # 2. List sessions
    res_list = await client.get("/api/v1/live/sessions?source_type=desktop_mic")
    assert res_list.status_code == 200
    items = res_list.json()
    assert any(item["id"] == session_id for item in items)

    # 3. Get session detail
    res_detail = await client.get(f"/api/v1/live/sessions/{session_id}")
    assert res_detail.status_code == 200
    detail = res_detail.json()
    assert detail["id"] == session_id
    assert detail["status"] == "created"
    assert "stats" in detail

    # 4. Stop session
    res_stop = await client.post(f"/api/v1/live/sessions/{session_id}/stop")
    assert res_stop.status_code == 200
    stopped_data = res_stop.json()
    assert stopped_data["status"] == "stopped"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("field", "value"),
    [("sample_rate", 44100), ("sample_rate", 48000), ("channels", 2)],
)
async def test_live_session_rejects_unsupported_model_input_format(client: AsyncClient, field, value):
    payload = {"source_type": "browser_mic", "sample_rate": 32000, "channels": 1}
    payload[field] = value
    response = await client.post("/api/v1/live/sessions", json=payload)
    assert response.status_code == 422
    assert field in response.text


@pytest.mark.asyncio
async def test_websocket_handshake_and_control_messages(live_ws_server):
    http_url, ws_url = live_ws_server
    async with AsyncClient(base_url=http_url) as ac:
        resp = await ac.post(
            "/api/v1/live/sessions",
            json={"source_type": "browser_mic", "device_id": "test_mic"},
        )
        assert resp.status_code == 201
        session_id = resp.json()["id"]

    async with websockets.connect(f"{ws_url}/api/v1/live/sessions/{session_id}/stream") as ws:
        handshake = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
        assert handshake["type"] == "handshake_ack"
        assert handshake["session_id"] == session_id

        start_event = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
        assert start_event["type"] == "session_started"

        await ws.send(json.dumps({"type": "heartbeat", "timestamp": 123456.0}))
        hb_ack = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
        assert hb_ack["type"] == "heartbeat_ack"
        assert hb_ack["timestamp"] == 123456.0

        await ws.send(json.dumps({"type": "pause"}))
        pause_event = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
        assert pause_event["type"] == "session_paused"

        await ws.send(json.dumps({"type": "resume"}))
        resume_event = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
        assert resume_event["type"] == "session_resumed"

        await ws.send(json.dumps({"type": "stop"}))
        stop_event = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
        assert stop_event["type"] == "session_stopped"

    await asyncio.sleep(0.05)
    state = live_session_manager.get_session(session_id)
    assert state is not None and state.status == "stopped"
    assert state.inference_worker._running is False
    assert state.inference_worker._worker_task is None
    assert len(state.websockets) == 0


@pytest.mark.asyncio
async def test_websocket_stop_discards_final_partial_window(live_ws_server):
    http_url, ws_url = live_ws_server
    async with AsyncClient(base_url=http_url) as ac:
        resp = await ac.post(
            "/api/v1/live/sessions",
            json={"source_type": "browser_mic", "sample_rate": 32000, "channels": 1},
        )
        session_id = resp.json()["id"]

    async with websockets.connect(f"{ws_url}/api/v1/live/sessions/{session_id}/stream") as ws:
        await asyncio.wait_for(ws.recv(), timeout=5.0)  # handshake_ack
        await asyncio.wait_for(ws.recv(), timeout=5.0)  # session_started
        partial_pcm = np.zeros(32000, dtype="<i2").tobytes()
        await ws.send(struct.pack(">I", 0) + partial_pcm)
        await ws.send(json.dumps({"type": "stop"}))
        stopped = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
        assert stopped["type"] == "session_stopped"
        assert stopped["stats"]["final_partial_samples_discarded"] == 32000
        assert stopped["stats"]["final_partial_seconds_discarded"] == 1.0

    await asyncio.sleep(0.05)
    state = live_session_manager.get_session(session_id)
    assert state is not None and state.status == "stopped"
    assert state.inference_worker._running is False
    assert len(state.websockets) == 0


@pytest.mark.asyncio
async def test_websocket_digital_silence_is_skipped_without_detections(live_ws_server):
    """Three seconds of exact zero PCM traverse WebSocket, ring buffer, and worker."""
    http_url, ws_url = live_ws_server
    async with AsyncClient(base_url=http_url) as ac:
        response = await ac.post(
            "/api/v1/live/sessions",
            json={"source_type": "browser_mic", "sample_rate": 32000, "channels": 1},
        )
        assert response.status_code == 201
        session_id = response.json()["id"]

    zero_pcm = np.zeros(8000, dtype="<i2").tobytes()
    messages = []
    async with websockets.connect(f"{ws_url}/api/v1/live/sessions/{session_id}/stream") as ws:
        assert json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))["type"] == "handshake_ack"
        assert json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))["type"] == "session_started"
        for sequence in range(12):
            await ws.send(struct.pack(">I", sequence) + zero_pcm)

        await ws.send(json.dumps({"type": "stop"}))
        while True:
            message = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
            messages.append(message)
            if message["type"] == "session_stopped":
                break

    skipped = [
        message
        for message in messages
        if message.get("type") == "processing_update"
        and message.get("status") == "silent_skipped"
    ]
    assert len(skipped) == 1
    assert skipped[0]["is_silent"] is True
    assert skipped[0]["rms_energy"] == 0.0
    assert skipped[0]["detections_count"] == 0
    assert not any(message.get("type") == "detection" for message in messages)

    stopped = next(message for message in messages if message["type"] == "session_stopped")
    assert stopped["stats"]["processed_windows"] == 1
    assert stopped["stats"]["inferred_windows"] == 0
    assert stopped["stats"]["silent_windows"] == 1

    async with AsyncClient(base_url=http_url) as ac:
        detail = (await ac.get(f"/api/v1/live/sessions/{session_id}")).json()
    assert detail["events"] == []
    assert len(detail["segments"]) == 1
    assert detail["segments"][0]["processing_status"] == "silent_skipped"

    await asyncio.sleep(0.05)
    state = live_session_manager.get_session(session_id)
    assert state is not None and state.status == "stopped"
    assert len(state.websockets) == 0


@pytest.mark.asyncio
async def test_websocket_frame_validation_and_sequencing(live_ws_server):
    http_url, ws_url = live_ws_server
    async with AsyncClient(base_url=http_url) as ac:
        resp = await ac.post(
            "/api/v1/live/sessions",
            json={"source_type": "field_device", "device_id": "unit_001"},
        )
        session_id = resp.json()["id"]

    async with websockets.connect(f"{ws_url}/api/v1/live/sessions/{session_id}/stream") as ws:
        await asyncio.wait_for(ws.recv(), timeout=5.0)  # handshake_ack
        await asyncio.wait_for(ws.recv(), timeout=5.0)  # session_started

        await ws.send(b"\x00\x01")
        err1 = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
        assert err1["type"] == "error"
        assert err1["code"] == "INVALID_FRAME_LENGTH"

        await ws.send(struct.pack(">I", 0) + b"\x01\x02\x03")
        err2 = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
        assert err2["type"] == "error"
        assert err2["code"] == "INVALID_PCM_ALIGNMENT"

        huge = struct.pack(">I", 0) + b"\x00" * (130 * 1024)
        await ws.send(huge)
        err3 = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
        assert err3["type"] == "error"
        assert err3["code"] == "FRAME_TOO_LARGE"

        valid_pcm = (np.ones(1000, dtype="<i2") * 1500).tobytes()
        await ws.send(struct.pack(">I", 0) + valid_pcm)

        await ws.send(struct.pack(">I", 0) + valid_pcm)
        dup_err = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
        assert dup_err["type"] == "error"
        assert dup_err["code"] == "FRAME_REJECTED"
        assert "Duplicate" in dup_err["message"]

        await ws.send(struct.pack(">I", 5) + valid_pcm)
        await ws.send(json.dumps({"type": "stop"}))
        await asyncio.wait_for(ws.recv(), timeout=5.0)


@pytest.mark.asyncio
async def test_websocket_streaming_inference_and_event_delivery(live_ws_server):
    """Verify streaming 3 seconds of audio produces a detection event and processing update."""
    http_url, ws_url = live_ws_server
    async with AsyncClient(base_url=http_url) as ac:
        resp = await ac.post(
            "/api/v1/live/sessions",
            json={"source_type": "desktop_mic", "device_id": "test_mic"},
        )
        session_id = resp.json()["id"]

    async with websockets.connect(f"{ws_url}/api/v1/live/sessions/{session_id}/stream") as ws:
        await asyncio.wait_for(ws.recv(), timeout=5.0)  # handshake_ack
        await asyncio.wait_for(ws.recv(), timeout=5.0)  # session_started

        chunk_samples = 16000
        chunk_bytes = (np.ones(chunk_samples, dtype="<i2") * 2500).tobytes()

        for seq in range(6):
            await ws.send(struct.pack(">I", seq) + chunk_bytes)

        detection_event = None
        for _ in range(10):
            try:
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
                if msg.get("type") == "detection":
                    detection_event = msg
                    break
            except Exception:
                break

        assert detection_event is not None
        assert detection_event["session_id"] == session_id
        assert math.isclose(detection_event["start_seconds"], 0.0, abs_tol=1e-2)
        assert math.isclose(detection_event["end_seconds"], 3.0, abs_tol=1e-2)
        assert detection_event["confidence_score"] > 0.0
        assert "class_label" in detection_event
        assert detection_event["record_type"] == "animal"
        assert detection_event["taxon_group"] == "Unknown"
        await ws.send(json.dumps({"type": "stop"}))
        await asyncio.wait_for(ws.recv(), timeout=5.0)
