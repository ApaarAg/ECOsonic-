"""Integration tests for live streaming REST endpoints, WebSocket protocol, and frame validation."""

from __future__ import annotations

import asyncio
import math
import struct
import numpy as np
import pytest
from httpx import AsyncClient
from starlette.testclient import TestClient

from app.main import app
from app.services.analysis_pipeline import FallbackMockEngine, analysis_pipeline


@pytest.fixture(autouse=True)
def setup_mock_engine():
    """Inject mock engine for fast API and protocol tests."""
    previous = analysis_pipeline.engine
    analysis_pipeline.set_engine(FallbackMockEngine())
    analysis_pipeline.load()
    yield
    analysis_pipeline.set_engine(previous)


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


def test_websocket_handshake_and_control_messages(test_engine):
    client = TestClient(app)
    # Create session
    resp = client.post(
        "/api/v1/live/sessions",
        json={"source_type": "browser_mic", "device_id": "test_mic"},
    )
    assert resp.status_code == 201
    session_id = resp.json()["id"]

    # Connect WebSocket
    with client.websocket_connect(f"/api/v1/live/sessions/{session_id}/stream") as ws:
        # Handshake ACK
        handshake = ws.receive_json()
        assert handshake["type"] == "handshake_ack"
        assert handshake["session_id"] == session_id

        # Session start broadcast
        start_event = ws.receive_json()
        assert start_event["type"] == "session_started"

        # Heartbeat
        ws.send_json({"type": "heartbeat", "timestamp": 123456.0})
        hb_ack = ws.receive_json()
        assert hb_ack["type"] == "heartbeat_ack"
        assert hb_ack["timestamp"] == 123456.0

        # Pause
        ws.send_json({"type": "pause"})
        pause_event = ws.receive_json()
        assert pause_event["type"] == "session_paused"

        # Resume
        ws.send_json({"type": "resume"})
        resume_event = ws.receive_json()
        assert resume_event["type"] == "session_resumed"

        # Stop
        ws.send_json({"type": "stop"})
        stop_event = ws.receive_json()
        assert stop_event["type"] == "session_stopped"


def test_websocket_frame_validation_and_sequencing(test_engine):
    client = TestClient(app)
    resp = client.post(
        "/api/v1/live/sessions",
        json={"source_type": "field_device", "device_id": "unit_001"},
    )
    session_id = resp.json()["id"]

    with client.websocket_connect(f"/api/v1/live/sessions/{session_id}/stream") as ws:
        # Consume initial handshake + started
        ws.receive_json()  # handshake_ack
        ws.receive_json()  # session_started

        # 1. Test frame too short (< 4 bytes)
        ws.send_bytes(b"\x00\x01")
        err1 = ws.receive_json()
        assert err1["type"] == "error"
        assert err1["code"] == "INVALID_FRAME_LENGTH"

        # 2. Test odd PCM payload length (not 16-bit aligned)
        ws.send_bytes(struct.pack(">I", 0) + b"\x01\x02\x03")
        err2 = ws.receive_json()
        assert err2["type"] == "error"
        assert err2["code"] == "INVALID_PCM_ALIGNMENT"

        # 3. Test frame too large (> 128 KB)
        huge = struct.pack(">I", 0) + b"\x00" * (130 * 1024)
        ws.send_bytes(huge)
        err3 = ws.receive_json()
        assert err3["type"] == "error"
        assert err3["code"] == "FRAME_TOO_LARGE"

        # 4. Valid frame 0: 1000 PCM samples (2000 bytes)
        valid_pcm = (np.ones(1000, dtype="<i2") * 1500).tobytes()
        ws.send_bytes(struct.pack(">I", 0) + valid_pcm)

        # 5. Duplicate frame 0
        ws.send_bytes(struct.pack(">I", 0) + valid_pcm)
        dup_err = ws.receive_json()
        assert dup_err["type"] == "error"
        assert dup_err["code"] == "FRAME_REJECTED"
        assert "Duplicate" in dup_err["message"]

        # 6. Missing frames: jump from 0 to 5
        ws.send_bytes(struct.pack(">I", 5) + valid_pcm)
        # Server accepts frame 5 while internally logging dropped frames 1..4


def test_websocket_streaming_inference_and_event_delivery(test_engine):
    """Verify streaming 3 seconds of audio produces a detection event and processing update."""
    client = TestClient(app)
    resp = client.post(
        "/api/v1/live/sessions",
        json={"source_type": "desktop_mic", "device_id": "test_mic"},
    )
    session_id = resp.json()["id"]

    with client.websocket_connect(f"/api/v1/live/sessions/{session_id}/stream") as ws:
        ws.receive_json()  # handshake_ack
        ws.receive_json()  # session_started

        # Send 3 seconds of audio in 6 chunks of 0.5s (16,000 samples each = 32,000 bytes)
        chunk_samples = 16000
        chunk_bytes = (np.ones(chunk_samples, dtype="<i2") * 2500).tobytes()

        for seq in range(6):
            ws.send_bytes(struct.pack(">I", seq) + chunk_bytes)

        # Collect events until we receive a detection
        detection_event = None
        for _ in range(10):
            try:
                msg = ws.receive_json()
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
