"""Fixed-memory audio ring buffer for real-time bioacoustic streaming."""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AudioWindow:
    """An extracted audio window with absolute session timestamps."""

    data: np.ndarray  # float32 array normalized to [-1.0, 1.0], shape (window_samples,)
    start_seconds: float
    end_seconds: float
    window_index: int
    rms_energy: float
    is_silent: bool
    is_clipped: bool
    is_zero_variance: bool = False
    created_at: float = 0.0  # time.perf_counter() timestamp


class AudioRingBuffer:
    """Thread-safe synchronized circular audio ring buffer with bounded storage and rolling window extraction."""

    def __init__(
        self,
        sample_rate: int = 32000,
        window_duration_s: float = 3.0,
        hop_duration_s: float = 3.0,
        capacity_seconds: float = 30.0,
        silence_threshold_rms: float = 1e-4,
        clipping_threshold: float = 0.999,
    ) -> None:
        if sample_rate <= 0:
            raise ValueError(f"sample_rate must be positive, got {sample_rate}")
        if window_duration_s <= 0:
            raise ValueError(f"window_duration_s must be positive, got {window_duration_s}")
        if hop_duration_s <= 0 or hop_duration_s > window_duration_s:
            raise ValueError(
                f"hop_duration_s must be in (0, {window_duration_s}], got {hop_duration_s}"
            )
        if capacity_seconds < window_duration_s * 2:
            raise ValueError(
                f"capacity_seconds ({capacity_seconds}) must be at least twice window_duration_s ({window_duration_s})"
            )

        self.sample_rate = sample_rate
        self.window_duration_s = window_duration_s
        self.hop_duration_s = hop_duration_s
        self.capacity_seconds = capacity_seconds
        self.silence_threshold_rms = silence_threshold_rms
        self.clipping_threshold = clipping_threshold

        self.window_samples = int(round(window_duration_s * sample_rate))
        self.hop_samples = int(round(hop_duration_s * sample_rate))
        self.capacity_samples = int(round(capacity_seconds * sample_rate))

        self._buffer = np.zeros(self.capacity_samples, dtype=np.float32)
        self._total_samples_written = 0
        self._next_window_start_sample = 0
        self._window_counter = 0
        self._dropped_windows = 0
        self._lock = threading.Lock()

    @property
    def total_samples_written(self) -> int:
        with self._lock:
            return self._total_samples_written

    @property
    def total_seconds_written(self) -> float:
        with self._lock:
            return self._total_samples_written / self.sample_rate

    @property
    def dropped_windows(self) -> int:
        with self._lock:
            return self._dropped_windows

    def discard_incomplete_tail(self) -> int:
        """Return the trailing sample count that cannot form a full window."""
        with self._lock:
            return max(0, self._total_samples_written - self._next_window_start_sample)

    def write_pcm16_bytes(
        self, raw_bytes: bytes
    ) -> Tuple[int, Optional[str]]:
        """Ingest raw little-endian 16-bit PCM mono bytes into the ring buffer.

        Returns:
            Tuple of (samples_written, warning_message_if_any)
        """
        if not raw_bytes:
            return 0, "Empty audio frame received."

        if len(raw_bytes) % 2 != 0:
            raise ValueError(
                f"Invalid PCM16 frame length: {len(raw_bytes)} bytes is not a multiple of 2."
            )

        samples_i16 = np.frombuffer(raw_bytes, dtype="<i2")
        samples_f32 = samples_i16.astype(np.float32) / 32768.0
        return self.write_float_samples(samples_f32)

    def write_float_samples(
        self, samples: np.ndarray
    ) -> Tuple[int, Optional[str]]:
        """Ingest normalized float32 samples in [-1.0, 1.0] into the ring buffer."""
        if samples.ndim != 1:
            samples = samples.flatten()

        n_samples = len(samples)
        if n_samples == 0:
            return 0, None

        if not np.isfinite(samples).all():
            raise ValueError("Audio chunk contains NaN or infinite values.")

        warning: Optional[str] = None
        rms = float(np.sqrt(np.mean(samples**2)))
        clip_ratio = float(np.mean(np.abs(samples) >= self.clipping_threshold))

        if rms < self.silence_threshold_rms:
            warning = f"Very low signal amplitude (RMS={rms:.6f}); audio may be silent or microphone muted."
        elif clip_ratio > 0.10:
            warning = f"High audio clipping detected ({clip_ratio*100:.1f}% samples clipped at limit)."

        total_incoming = n_samples

        with self._lock:
            # If incoming chunk is larger than buffer capacity, keep only trailing capacity_samples
            if n_samples > self.capacity_samples:
                samples = samples[-self.capacity_samples :]
                n_samples = len(samples)

            write_start_idx = self._total_samples_written % self.capacity_samples
            first_chunk_len = min(n_samples, self.capacity_samples - write_start_idx)
            second_chunk_len = n_samples - first_chunk_len

            self._buffer[write_start_idx : write_start_idx + first_chunk_len] = samples[
                :first_chunk_len
            ]
            if second_chunk_len > 0:
                self._buffer[0:second_chunk_len] = samples[first_chunk_len:]

            self._total_samples_written += total_incoming

            # Check if ring buffer overwrote unread windows (overflow / backpressure)
            oldest_available_sample = max(0, self._total_samples_written - self.capacity_samples)
            if self._next_window_start_sample < oldest_available_sample:
                overwritten_samples = oldest_available_sample - self._next_window_start_sample
                dropped = int(np.ceil(overwritten_samples / self.hop_samples))
                self._dropped_windows += dropped
                self._next_window_start_sample += dropped * self.hop_samples
                logger.warning(
                    "Ring buffer overflow: dropped %d windows (lagging behind real-time by %d samples)",
                    dropped,
                    overwritten_samples,
                )

        return total_incoming, warning

    def extract_available_windows(self) -> List[AudioWindow]:
        """Extract all complete windows that are ready for inference."""
        windows: List[AudioWindow] = []
        now = time.perf_counter()

        with self._lock:
            while (
                self._total_samples_written
                >= self._next_window_start_sample + self.window_samples
            ):
                start_sample = self._next_window_start_sample
                buf_start_idx = start_sample % self.capacity_samples
                first_part = min(self.window_samples, self.capacity_samples - buf_start_idx)
                second_part = self.window_samples - first_part

                window_data = np.empty(self.window_samples, dtype=np.float32)
                window_data[:first_part] = self._buffer[
                    buf_start_idx : buf_start_idx + first_part
                ]
                if second_part > 0:
                    window_data[first_part:] = self._buffer[:second_part]

                start_sec = start_sample / self.sample_rate
                end_sec = (start_sample + self.window_samples) / self.sample_rate

                rms = float(np.sqrt(np.mean(window_data**2)))
                var = float(np.var(window_data))
                is_silent = bool(rms < self.silence_threshold_rms)
                is_clipped = bool(np.mean(np.abs(window_data) >= self.clipping_threshold) > 0.05)
                is_zero_variance = bool(var < 1e-12)

                windows.append(
                    AudioWindow(
                        data=window_data,
                        start_seconds=round(start_sec, 4),
                        end_seconds=round(end_sec, 4),
                        window_index=self._window_counter,
                        rms_energy=round(rms, 6),
                        is_silent=is_silent,
                        is_clipped=is_clipped,
                        is_zero_variance=is_zero_variance,
                        created_at=now,
                    )
                )

                self._window_counter += 1
                self._next_window_start_sample += self.hop_samples

        return windows

    def reset(self) -> None:
        """Reset buffer state and sample counters."""
        with self._lock:
            self._buffer.fill(0)
            self._total_samples_written = 0
            self._next_window_start_sample = 0
            self._window_counter = 0
            self._dropped_windows = 0
