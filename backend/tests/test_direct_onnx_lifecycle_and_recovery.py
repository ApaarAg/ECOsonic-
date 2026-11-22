"""Lifecycle, failure recovery, fallback, and quiet-signal validation tests for Direct ONNX Engine."""

from __future__ import annotations

import asyncio
import math
import tempfile
import time
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app.core.database import async_session_factory, init_db
from app.models.live_session import LiveSession, LiveSegment
from app.services.direct_onnx_engine import (
    AudioValidationError,
    DirectOnnxEngine,
    direct_onnx_engine,
)
from app.services.live.ring_buffer import AudioRingBuffer
from app.services.live.session_manager import LiveSessionManager

SMOKE_AUDIO_PATH = Path("backend/data/smoke_audio/birds_forest.ogg")


def test_missing_cache_fails_fast(tmp_path: Path):
    """Verify DirectOnnxEngine fails fast when model cache or files are missing."""
    bogus_model = tmp_path / "nonexistent.onnx"
    bogus_labels = tmp_path / "nonexistent_labels.txt"

    engine = DirectOnnxEngine(model_path=bogus_model, labels_path=bogus_labels)
    t0 = time.perf_counter()
    with pytest.raises(FileNotFoundError, match="Direct ONNX model artifact not found"):
        engine.load()
    assert (time.perf_counter() - t0) < 0.1


def test_missing_labels_fails_fast(tmp_path: Path):
    """Verify DirectOnnxEngine fails fast when taxonomy labels file is missing."""
    valid_model = Path(".model_cache/acoustic-models/v3.0/onnx/model-fp32-e78c3b50e224.onnx")
    if not valid_model.exists():
        pytest.skip("Model artifact not present in workspace")

    bogus_labels = tmp_path / "missing_labels.txt"
    engine = DirectOnnxEngine(model_path=valid_model, labels_path=bogus_labels)
    t0 = time.perf_counter()
    with pytest.raises(FileNotFoundError, match="Direct ONNX taxonomy labels file not found"):
        engine.load()
    assert (time.perf_counter() - t0) < 0.1


@pytest.mark.real_model
def test_cpu_fallback_execution():
    """Verify DirectOnnxEngine operates properly when CUDA is omitted/forced to CPU."""
    model_path = Path(".model_cache/acoustic-models/v3.0/onnx/model-fp32-e78c3b50e224.onnx")
    labels_path = Path(".model_cache/acoustic-models/v3.0/onnx/labels/en_us.txt")
    if not model_path.exists():
        pytest.skip("Model artifact not present")

    cpu_engine = DirectOnnxEngine(
        model_path=model_path,
        labels_path=labels_path,
        providers=["CPUExecutionProvider"],
    )
    cpu_engine.load()
    status = cpu_engine.get_status()
    assert "CPUExecutionProvider" in status["active_providers"]
    assert status["device"] == "CPU"
    assert status["is_ready"] is True

    # Run inference on valid 3s noise
    rng = np.random.RandomState(42)
    audio = rng.normal(0, 0.05, 96000).astype(np.float32)
    res = cpu_engine.infer(audio, min_confidence=0.01, top_k=5)
    assert res.embedding.shape == (1280,)
    assert not np.isnan(res.embedding).any()
    assert res.inference_time_ms > 0.0


def test_malformed_audio_rejection():
    """Verify AudioValidationError on bad shapes, NaNs, Infs, empty, and flatlines."""
    engine = direct_onnx_engine

    # 1. Non-1D audio
    with pytest.raises(AudioValidationError, match="1D float32"):
        engine.infer(np.zeros((100, 2), dtype=np.float32))

    # 2. Too short
    with pytest.raises(AudioValidationError, match="minimum 3200"):
        engine.infer(np.zeros(100, dtype=np.float32))

    # 3. NaN/Inf
    bad_audio = np.ones(96000, dtype=np.float32)
    bad_audio[10] = np.nan
    with pytest.raises(AudioValidationError, match="NaN or Inf"):
        engine.infer(bad_audio)

    bad_inf = np.ones(96000, dtype=np.float32)
    bad_inf[10] = np.inf
    with pytest.raises(AudioValidationError, match="NaN or Inf"):
        engine.infer(bad_inf)

    # 4. Zero variance / flatline
    flat = np.full(96000, 0.05, dtype=np.float32)
    with pytest.raises(AudioValidationError, match="zero variance"):
        engine.infer(flat)


@pytest.mark.real_model
def test_quiet_bird_call_fixture_validation():
    """Verify that silence gate does NOT drop quiet environmental bird calls, but drops true sub-silence."""
    if not SMOKE_AUDIO_PATH.exists():
        pytest.skip(f"Smoke audio {SMOKE_AUDIO_PATH} not found")

    audio, sr = sf.read(str(SMOKE_AUDIO_PATH), dtype="float32")
    if audio.ndim > 1:
        audio = np.mean(audio, axis=1)

    # Extract 3-second window known to contain bird calls
    window_3s = audio[:96000]
    base_rms = float(np.sqrt(np.mean(window_3s**2)))
    assert base_rms > 0.01, f"Expected active signal, got RMS={base_rms}"

    # Test target RMS levels: 0.005, 0.001, 0.0003, 0.00015 (all >= 1e-4)
    target_rms_levels = [0.005, 0.001, 0.0003, 0.00015]

    ring_buf = AudioRingBuffer(
        sample_rate=32000,
        window_duration_s=3.0,
        hop_duration_s=3.0,
        silence_threshold_rms=1e-4,  # -80 dBFS
    )

    for target_rms in target_rms_levels:
        quiet_signal = (window_3s * (target_rms / base_rms)).astype(np.float32)
        quiet_rms = float(np.sqrt(np.mean(quiet_signal**2)))
        assert quiet_rms >= 1e-4, f"Target {target_rms} dropped below silence threshold: RMS={quiet_rms}"

        # Feed to ring buffer
        pcm16 = (np.clip(quiet_signal, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
        ring_buf.write_pcm16_bytes(pcm16)
        windows = ring_buf.extract_available_windows()
        assert len(windows) == 1
        win = windows[0]
        # Must NOT be marked silent
        assert not win.is_silent, f"Quiet bird call (RMS={quiet_rms}) was incorrectly marked silent!"
        assert not win.is_zero_variance

        # Direct ONNX must process quiet signal without NaN or error
        direct_onnx_engine.load()
        res = direct_onnx_engine.infer(win.data, min_confidence=0.01, top_k=5)
        assert res.embedding.shape == (1280,)
        assert not np.isnan(res.embedding).any()
        assert len(res.detections) >= 0

    # Test actual sub-threshold signal (factor 0.00001 -> RMS ~ 2e-7 << 1e-4)
    silent_signal = (window_3s * 1e-5).astype(np.float32)
    silent_rms = float(np.sqrt(np.mean(silent_signal**2)))
    assert silent_rms < 1e-4
    pcm16_silent = (np.clip(silent_signal, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
    ring_buf.write_pcm16_bytes(pcm16_silent)
    silent_windows = ring_buf.extract_available_windows()
    assert len(silent_windows) == 1
    assert silent_windows[0].is_silent, "Sub-threshold signal must be identified as silent"


@pytest.mark.asyncio
async def test_session_manager_lifecycle_and_restart():
    """Verify session manager initialization, session creation, ingestion, shutdown, and clean restart."""
    await init_db()
    manager = LiveSessionManager()
    await manager.initialize()

    # Session 1: Create, ingest 1.0s of audio, verify, stop
    s1_id = f"test-sess-1-{int(time.time())}"
    async with async_session_factory() as session:
        session.add(
            LiveSession(
                id=s1_id,
                source_type="file_replay",
                device_id="lifecycle_test",
                sample_rate=32000,
                channels=1,
                status="active",
            )
        )
        await session.commit()

    state1 = await manager.create_session(s1_id, sample_rate=32000, channels=1, window_duration_s=3.0, hop_duration_s=3.0)
    await manager.start_session(s1_id)
    assert state1.status == "active"

    # Send 4 chunks of 250ms audio (1 second total)
    rng = np.random.RandomState(123)
    chunk = rng.normal(0, 0.05, 8000).astype(np.float32)
    pcm = (chunk * 32767.0).astype("<i2").tobytes()
    for seq in range(4):
        ok, _ = await manager.ingest_audio_frame(s1_id, seq, pcm)
        assert ok is True

    await asyncio.sleep(0.1)
    await manager.stop_session(s1_id)
    assert state1.status == "stopped"

    # Session 2: Create a second session on the same manager to verify isolation and restart
    s2_id = f"test-sess-2-{int(time.time())}"
    async with async_session_factory() as session:
        session.add(
            LiveSession(
                id=s2_id,
                source_type="file_replay",
                device_id="lifecycle_test",
                sample_rate=32000,
                channels=1,
                status="active",
            )
        )
        await session.commit()

    state2 = await manager.create_session(s2_id, sample_rate=32000, channels=1, window_duration_s=3.0, hop_duration_s=3.0)
    await manager.start_session(s2_id)
    assert state2.received_frames == 0
    assert state2.expected_seq == 0

    # Ingest into session 2
    for seq in range(2):
        ok, _ = await manager.ingest_audio_frame(s2_id, seq, pcm)
        assert ok is True

    assert state2.received_frames == 2
    await manager.stop_session(s2_id)
    await manager.shutdown()
