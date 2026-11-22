"""Tests for live soundscape audio accumulation, background worker execution, and queue backpressure."""

from __future__ import annotations

import asyncio
import time
import numpy as np
import pytest

from app.services.live.session_manager import LiveSessionState
from app.services.soundscape.soundscape_worker import LiveSoundscapeWorker, SoundscapeTask


@pytest.mark.asyncio
async def test_soundscape_worker_bounded_queue_backpressure():
    """Verify that LiveSoundscapeWorker protects the pipeline with bounded queue and drops tasks if saturated."""
    worker = LiveSoundscapeWorker(max_queue_size=2)
    # Don't start loop so queue fills up
    samples = np.zeros(32000 * 5, dtype=np.float32)

    task1 = SoundscapeTask("s1", 0.0, 5.0, samples, time.perf_counter())
    task2 = SoundscapeTask("s1", 5.0, 10.0, samples, time.perf_counter())
    task3 = SoundscapeTask("s1", 10.0, 15.0, samples, time.perf_counter())

    # First two should succeed
    assert await worker.enqueue(task1) is True
    assert await worker.enqueue(task2) is True
    assert worker.queue_size == 2

    # Third should be dropped due to backpressure
    assert await worker.enqueue(task3) is False
    assert worker.dropped_count == 1


@pytest.mark.asyncio
async def test_session_soundscape_accumulation():
    """Verify that LiveSessionState accumulates audio and triggers tasks on configured window intervals."""
    sr = 32000
    state = LiveSessionState(session_id="test-accum-sess", sample_rate=sr)
    state.soundscape_window_s = 10.0  # Test with 10s window
    state.soundscape_interval_s = 10.0

    # Ingest 5 seconds into ring buffer and accumulator
    chunk_5s = np.zeros(sr * 5, dtype=np.float32)
    state.ring_buffer.write_float_samples(chunk_5s)
    task1 = state.accumulate_soundscape_audio(chunk_5s)
    # Not enough audio yet (5s < 10s)
    assert task1 is None

    # Ingest 6 more seconds (total 11s)
    chunk_6s = np.zeros(sr * 6, dtype=np.float32)
    state.ring_buffer.write_float_samples(chunk_6s)
    task2 = state.accumulate_soundscape_audio(chunk_6s)
    # Now >= 10s reached -> task produced
    assert task2 is not None
    assert task2.start_seconds == 1.0  # 11 - 10
    assert task2.end_seconds == 11.0
    assert len(task2.samples) == sr * 10


def test_session_soundscape_buffer_pruning():
    """Verify that LiveSessionState prunes soundscape accumulation buffer to prevent unbounded memory growth."""
    sr = 32000
    state = LiveSessionState(session_id="test-prune-sess", sample_rate=sr)
    state.soundscape_window_s = 10.0
    state.soundscape_interval_s = 10.0

    # Feed 100 seconds of audio in 10s chunks
    for i in range(10):
        chunk = np.zeros(sr * 10, dtype=np.float32)
        state.ring_buffer.write_float_samples(chunk)
        state.accumulate_soundscape_audio(chunk)

    # Buffer must be capped at max_keep (90s = 90 * 32000 = 2,880,000 samples)
    max_keep = int(90.0 * sr)
    assert state._soundscape_sample_count <= max_keep + (sr * 10)


def test_session_soundscape_finalize():
    """Verify that finalize_soundscape_audio produces a task if >= 10s audio exists."""
    sr = 32000
    state = LiveSessionState(session_id="test-finalize-sess", sample_rate=sr)
    state.soundscape_window_s = 30.0

    # Under 10s -> None
    short_chunk = np.zeros(sr * 5, dtype=np.float32)
    state.ring_buffer.write_float_samples(short_chunk)
    state.accumulate_soundscape_audio(short_chunk)
    assert state.finalize_soundscape_audio() is None

    # Over 10s -> extracts window
    chunk_10s = np.zeros(sr * 10, dtype=np.float32)
    state.ring_buffer.write_float_samples(chunk_10s)
    state.accumulate_soundscape_audio(chunk_10s)
    final_task = state.finalize_soundscape_audio()
    assert final_task is not None
    assert final_task.end_seconds == 15.0
