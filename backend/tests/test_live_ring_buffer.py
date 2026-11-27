"""Unit tests for AudioRingBuffer: windowing, hop sizes, timestamps, and backpressure."""

from __future__ import annotations

import math
import numpy as np
import pytest

from app.services.live.ring_buffer import AudioRingBuffer, AudioWindow


def test_ring_buffer_init_validation():
    with pytest.raises(ValueError, match="sample_rate must be positive"):
        AudioRingBuffer(sample_rate=0)

    with pytest.raises(ValueError, match="window_duration_s must be positive"):
        AudioRingBuffer(window_duration_s=0)

    with pytest.raises(ValueError, match="hop_duration_s must be in"):
        AudioRingBuffer(window_duration_s=3.0, hop_duration_s=4.0)

    with pytest.raises(ValueError, match="capacity_seconds.*must be at least twice"):
        AudioRingBuffer(window_duration_s=3.0, hop_duration_s=3.0, capacity_seconds=5.0)


def test_ring_buffer_exact_window_extraction():
    sr = 32000
    rb = AudioRingBuffer(sample_rate=sr, window_duration_s=3.0, hop_duration_s=3.0, capacity_seconds=30.0)

    # Ingest exactly 1 second (32,000 samples)
    one_sec = (np.ones(32000, dtype=np.float32) * 0.1).tobytes()
    # Using pcm16 bytes
    one_sec_i16 = (np.ones(32000, dtype="<i2") * 1000).tobytes()
    n, warn = rb.write_pcm16_bytes(one_sec_i16)
    assert n == 32000
    assert warn is None
    # Less than 3 seconds -> no window yet
    # Ingest 2 more seconds -> total 3.0s = 96,000 samples
    two_sec_i16 = (np.ones(64000, dtype="<i2") * 1000).tobytes()
    rb.write_pcm16_bytes(two_sec_i16)

    windows = rb.extract_available_windows()
    assert len(windows) == 1
    w = windows[0]
    assert w.window_index == 0
    assert math.isclose(w.start_seconds, 0.0, abs_tol=1e-3)
    assert math.isclose(w.end_seconds, 3.0, abs_tol=1e-3)
    assert len(w.data) == 96000
    assert w.is_silent is False

    # Second call without new data returns nothing
    assert len(rb.extract_available_windows()) == 0


def test_ring_buffer_reports_final_incomplete_window_for_deterministic_discard():
    rb = AudioRingBuffer(sample_rate=32000, window_duration_s=3.0, hop_duration_s=3.0)
    rb.write_float_samples(np.ones(32000, dtype=np.float32) * 0.1)
    assert rb.extract_available_windows() == []
    assert rb.discard_incomplete_tail() == 32000

    rb.write_float_samples(np.ones(64000, dtype=np.float32) * 0.1)
    assert len(rb.extract_available_windows()) == 1
    assert rb.discard_incomplete_tail() == 0


def test_ring_buffer_hop_size_1_5s():
    """Verify that a 1.5s hop on a 3.0s window produces overlapping windows every 1.5s."""
    sr = 32000
    rb = AudioRingBuffer(sample_rate=sr, window_duration_s=3.0, hop_duration_s=1.5, capacity_seconds=30.0)

    # Ingest 4.5 seconds (144,000 samples)
    data = (np.ones(144000, dtype="<i2") * 2000).tobytes()
    rb.write_pcm16_bytes(data)

    windows = rb.extract_available_windows()
    # Window 0: 0.0s - 3.0s
    # Window 1: 1.5s - 4.5s
    assert len(windows) == 2
    assert math.isclose(windows[0].start_seconds, 0.0, abs_tol=1e-3)
    assert math.isclose(windows[0].end_seconds, 3.0, abs_tol=1e-3)

    assert math.isclose(windows[1].start_seconds, 1.5, abs_tol=1e-3)
    assert math.isclose(windows[1].end_seconds, 4.5, abs_tol=1e-3)


def test_ring_buffer_odd_byte_length_rejected():
    rb = AudioRingBuffer()
    with pytest.raises(ValueError, match="not a multiple of 2"):
        rb.write_pcm16_bytes(b"\x00\x01\x02")


def test_ring_buffer_non_finite_rejected():
    rb = AudioRingBuffer()
    nan_arr = np.array([0.1, np.nan, 0.5], dtype=np.float32)
    with pytest.raises(ValueError, match="NaN or infinite"):
        rb.write_float_samples(nan_arr)


def test_ring_buffer_silence_and_clipping_detection():
    rb = AudioRingBuffer()
    # Zero silence
    zeros = np.zeros(32000, dtype="<i2").tobytes()
    _, warn = rb.write_pcm16_bytes(zeros)
    assert warn is not None
    assert "silence" in warn.lower() or "silent" in warn.lower()

    # Extreme clipping
    clipped = (np.ones(32000, dtype="<i2") * 32767).tobytes()
    _, clip_warn = rb.write_pcm16_bytes(clipped)
    assert clip_warn is not None
    assert "clipping" in clip_warn.lower()


def test_ring_buffer_overflow_and_dropped_windows():
    """Verify ring buffer capacity limit drops unread windows and counts them."""
    sr = 32000
    # Capacity = 6.0 seconds (192,000 samples)
    rb = AudioRingBuffer(sample_rate=sr, window_duration_s=3.0, hop_duration_s=3.0, capacity_seconds=6.0)

    # Ingest 15 seconds without extracting windows
    huge_data = (np.ones(15 * sr, dtype="<i2") * 1000).tobytes()
    rb.write_pcm16_bytes(huge_data)

    assert rb.dropped_windows > 0
    # Remaining available windows should still be extractable
    wins = rb.extract_available_windows()
    assert len(wins) > 0
    # The first extracted window must have start_seconds aligned with un-overwritten data
    assert wins[0].start_seconds >= 6.0
