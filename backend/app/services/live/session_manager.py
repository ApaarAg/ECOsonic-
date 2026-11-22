"""Live session manager orchestrating streaming audio sessions, ring buffers, and workers."""

from __future__ import annotations

import asyncio
import logging
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

import psutil
import numpy as np
from fastapi import WebSocket
from sqlalchemy import func, select, update

from app.core.database import async_session_factory
from app.core.logging import logger
from app.models.live_session import LiveEvent, LiveSegment, LiveSession
from app.schemas.live_session import LiveSessionStats
from app.services.live.embedding_worker import embedding_worker
from app.services.live.inference_worker import LiveInferenceWorker
from app.services.live.ring_buffer import AudioRingBuffer
from app.services.soundscape.disturbance_service import disturbance_service
from app.services.soundscape.soundscape_worker import SoundscapeTask, soundscape_worker


def get_hardware_metrics() -> Dict[str, Any]:
    """Collect host CPU, process RAM, and NVIDIA GPU metrics if present."""
    cpu_pct = float(psutil.cpu_percent(interval=None))
    proc = psutil.Process()
    mem_mb = float(proc.memory_info().rss / (1024 * 1024))

    gpu_util: Optional[float] = None
    try:
        res = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=utilization.gpu",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=1.0,
            check=False,
        )
        if res.returncode == 0 and res.stdout.strip():
            gpu_util = float(res.stdout.strip().split("\n")[0])
    except Exception:
        gpu_util = None

    return {
        "cpu_utilization_pct": cpu_pct,
        "peak_memory_mb": round(mem_mb, 2),
        "gpu_utilization_pct": gpu_util,
    }


class LiveSessionState:
    """In-memory state of an active streaming session."""

    def __init__(
        self,
        session_id: str,
        sample_rate: int = 32000,
        channels: int = 1,
        window_duration_s: float = 3.0,
        hop_duration_s: float = 3.0,
        min_confidence: float = 0.10,
    ) -> None:
        self.session_id = session_id
        self.sample_rate = sample_rate
        self.channels = channels
        self.window_duration_s = window_duration_s
        self.hop_duration_s = hop_duration_s
        self.min_confidence = min_confidence

        self.status = "created"  # created, active, paused, stopped
        self.ring_buffer = AudioRingBuffer(
            sample_rate=sample_rate,
            window_duration_s=window_duration_s,
            hop_duration_s=hop_duration_s,
            capacity_seconds=30.0,
        )
        self.inference_worker = LiveInferenceWorker(
            session_id=session_id,
            max_queue_size=15,
            min_confidence=min_confidence,
            event_callback=self.broadcast_event,
        )

        # Soundscape accumulation buffer (configurable long-window analysis)
        self.soundscape_window_s: float = 60.0
        self.soundscape_interval_s: float = 60.0
        self._soundscape_samples: List[np.ndarray] = []
        self._soundscape_sample_count: int = 0
        self._last_soundscape_eval_s: float = 0.0

        self.expected_seq = 0
        self.received_frames = 0
        self.dropped_frames = 0
        self.duplicate_frames = 0
        self.total_bytes_received = 0

        self.started_at_time = time.perf_counter()
        self.last_audio_received_at = time.perf_counter()
        self.websockets: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    def add_websocket(self, ws: WebSocket) -> None:
        self.websockets.add(ws)

    def remove_websocket(self, ws: WebSocket) -> None:
        self.websockets.discard(ws)

    async def broadcast_event(self, event: Dict[str, Any]) -> None:
        """Broadcast an event dictionary to all connected WebSocket clients for this session."""
        dead_sockets: List[WebSocket] = []
        for ws in list(self.websockets):
            try:
                await ws.send_json(event)
            except Exception:
                dead_sockets.append(ws)
        for dead in dead_sockets:
            self.remove_websocket(dead)

    def accumulate_soundscape_audio(self, raw_samples: np.ndarray) -> Optional[SoundscapeTask]:
        """Accumulate samples for long-window soundscape analysis and trigger tasks when interval elapsed."""
        if len(raw_samples) == 0:
            return None

        self._soundscape_samples.append(raw_samples)
        self._soundscape_sample_count += len(raw_samples)

        total_audio_s = self.ring_buffer.total_seconds_written
        target_samples = int(self.soundscape_window_s * self.sample_rate)

        # Trigger if minimum required window is accumulated and interval elapsed
        if (
            self._soundscape_sample_count >= target_samples
            and (total_audio_s - self._last_soundscape_eval_s) >= self.soundscape_interval_s
        ):
            all_samples = np.concatenate(self._soundscape_samples)
            window_samples = all_samples[-target_samples:]
            start_s = max(0.0, total_audio_s - self.soundscape_window_s)
            end_s = total_audio_s
            self._last_soundscape_eval_s = total_audio_s

            # Prune buffer to avoid unbounded memory growth (keep max 2x window or 90s)
            max_keep = int(max(90.0, 2.0 * self.soundscape_window_s) * self.sample_rate)
            if len(all_samples) > max_keep:
                self._soundscape_samples = [all_samples[-max_keep:]]
                self._soundscape_sample_count = max_keep

            return SoundscapeTask(
                session_id=self.session_id,
                start_seconds=round(start_s, 2),
                end_seconds=round(end_s, 2),
                samples=window_samples,
                created_at=time.perf_counter(),
            )

        return None

    def finalize_soundscape_audio(self) -> Optional[SoundscapeTask]:
        """Extract a final soundscape analysis window when the session terminates."""
        if not self._soundscape_samples or self._soundscape_sample_count == 0:
            return None

        total_audio_s = self.ring_buffer.total_seconds_written

        # Require at least 10s of audio for meaningful ecological indices
        if total_audio_s < 10.0:
            return None

        target_samples = min(
            self._soundscape_sample_count,
            int(self.soundscape_window_s * self.sample_rate),
        )
        all_samples = np.concatenate(self._soundscape_samples)
        window_samples = all_samples[-target_samples:]
        start_s = max(0.0, total_audio_s - (target_samples / self.sample_rate))
        end_s = total_audio_s

        return SoundscapeTask(
            session_id=self.session_id,
            start_seconds=round(start_s, 2),
            end_seconds=round(end_s, 2),
            samples=window_samples,
            created_at=time.perf_counter(),
        )

    def get_stats(self) -> LiveSessionStats:
        elapsed = max(0.001, time.perf_counter() - self.started_at_time)
        capture_rate = self.total_bytes_received / elapsed
        total_expected_frames = self.received_frames + self.dropped_frames
        continuity = (
            (self.received_frames / total_expected_frames) * 100.0
            if total_expected_frames > 0
            else 100.0
        )

        hw = get_hardware_metrics()

        return LiveSessionStats(
            audio_capture_rate=round(capture_rate, 2),
            audio_input_continuity=round(continuity, 2),
            avg_inference_latency_ms=round(self.inference_worker.avg_inference_latency_ms, 2),
            avg_embedding_latency_ms=round(embedding_worker.avg_latency_ms, 2),
            window_processing_lag_ms=round(self.inference_worker.avg_window_lag_ms, 2),
            e2e_event_delivery_latency_ms=round(
                self.inference_worker.avg_inference_latency_ms
                + self.inference_worker.avg_window_lag_ms,
                2,
            ),
            dropped_frames=self.dropped_frames,
            dropped_windows=self.inference_worker.dropped_windows + self.ring_buffer.dropped_windows,
            inference_queue_size=self.inference_worker.queue_size,
            embedding_queue_size=embedding_worker.queue_size,
            soundscape_queue_size=soundscape_worker.queue_size,
            gpu_utilization_pct=hw["gpu_utilization_pct"],
            cpu_utilization_pct=hw["cpu_utilization_pct"],
            peak_memory_mb=hw["peak_memory_mb"],
        )


class LiveSessionManager:
    """Registry and coordinator for active real-time streaming sessions."""

    def __init__(self) -> None:
        self._sessions: Dict[str, LiveSessionState] = {}
        self._lock = asyncio.Lock()

    async def initialize(self) -> None:
        """Ensure global workers (such as embedding worker and soundscape worker) are started."""
        await embedding_worker.start()
        await soundscape_worker.start()
        soundscape_worker.set_broadcast_callback(self._broadcast_to_session)
        # Pre-warm Direct ONNX live engine in thread so live streaming has zero cold-start latency
        from app.services.direct_onnx_engine import direct_onnx_engine
        await asyncio.to_thread(direct_onnx_engine.load)

    async def _broadcast_to_session(self, session_id: str, payload: Dict[str, Any]) -> None:
        state = self.get_session(session_id)
        if state:
            await state.broadcast_event(payload)

    async def shutdown(self, timeout: float = 5.0) -> None:
        """Stop all active sessions and background workers."""
        async with self._lock:
            for session_id in list(self._sessions.keys()):
                try:
                    await self.stop_session(session_id)
                except Exception as exc:
                    logger.warning("Error stopping session %s during shutdown: %s", session_id, exc)
            self._sessions.clear()
        await soundscape_worker.stop()

    async def _broadcast_to_session(self, session_id: str, payload: Dict[str, Any]) -> None:
        state = self.get_session(session_id)
        if state:
            await state.broadcast_event(payload)

    async def create_session(
        self,
        session_id: str,
        sample_rate: int = 32000,
        channels: int = 1,
        window_duration_s: float = 3.0,
        hop_duration_s: float = 3.0,
        min_confidence: float = 0.10,
    ) -> LiveSessionState:
        async with self._lock:
            if session_id in self._sessions:
                return self._sessions[session_id]

            state = LiveSessionState(
                session_id=session_id,
                sample_rate=sample_rate,
                channels=channels,
                window_duration_s=window_duration_s,
                hop_duration_s=hop_duration_s,
                min_confidence=min_confidence,
            )
            self._sessions[session_id] = state
            return state

    def get_session(self, session_id: str) -> Optional[LiveSessionState]:
        return self._sessions.get(session_id)

    async def start_session(self, session_id: str) -> Optional[LiveSessionState]:
        state = self.get_session(session_id)
        if not state:
            return None
        state.status = "active"
        await state.inference_worker.start()
        await state.broadcast_event(
            {
                "type": "session_started",
                "session_id": session_id,
                "timestamp": datetime.now(timezone.utc).timestamp(),
            }
        )
        # Update DB
        async with async_session_factory() as session:
            await session.execute(
                update(LiveSession)
                .where(LiveSession.id == session_id)
                .values(status="active")
            )
            await session.commit()
        return state

    async def pause_session(self, session_id: str) -> Optional[LiveSessionState]:
        state = self.get_session(session_id)
        if not state:
            return None
        state.status = "paused"
        await state.broadcast_event(
            {
                "type": "session_paused",
                "session_id": session_id,
                "timestamp": datetime.now(timezone.utc).timestamp(),
            }
        )
        async with async_session_factory() as session:
            await session.execute(
                update(LiveSession)
                .where(LiveSession.id == session_id)
                .values(status="paused")
            )
            await session.commit()
        return state

    async def resume_session(self, session_id: str) -> Optional[LiveSessionState]:
        state = self.get_session(session_id)
        if not state:
            return None
        state.status = "active"
        await state.broadcast_event(
            {
                "type": "session_resumed",
                "session_id": session_id,
                "timestamp": datetime.now(timezone.utc).timestamp(),
            }
        )
        async with async_session_factory() as session:
            await session.execute(
                update(LiveSession)
                .where(LiveSession.id == session_id)
                .values(status="active")
            )
            await session.commit()
        return state

    async def stop_session(self, session_id: str) -> Optional[LiveSessionState]:
        state = self.get_session(session_id)
        if not state:
            return None

        state.status = "stopped"
        # Stop worker
        await state.inference_worker.stop()

        # Enqueue final soundscape window if eligible (>= 10s audio)
        final_task = state.finalize_soundscape_audio()
        if final_task:
            await soundscape_worker.enqueue(final_task)

        # Close all active disturbances and run co-occurrence evaluation
        await disturbance_service.close_session_disturbances(
            session_id, broadcast_cb=state.broadcast_event
        )

        stats = state.get_stats()

        await state.broadcast_event(
            {
                "type": "session_stopped",
                "session_id": session_id,
                "timestamp": datetime.now(timezone.utc).timestamp(),
                "total_audio_seconds": round(state.ring_buffer.total_seconds_written, 3),
                "stats": stats.model_dump(),
            }
        )

        # Update database
        async with async_session_factory() as session:
            await session.execute(
                update(LiveSession)
                .where(LiveSession.id == session_id)
                .values(
                    status="stopped",
                    stopped_at=datetime.now(timezone.utc),
                    total_audio_seconds=state.ring_buffer.total_seconds_written,
                    dropped_frames=state.dropped_frames,
                    dropped_windows=state.ring_buffer.dropped_windows
                    + state.inference_worker.dropped_windows,
                )
            )
            await session.commit()

        return state

    async def ingest_audio_frame(
        self, session_id: str, seq_num: int, pcm_bytes: bytes
    ) -> Tuple[bool, Optional[str]]:
        """Ingest a sequenced PCM audio frame, validate continuity, feed ring buffer, and submit windows."""
        state = self.get_session(session_id)
        if not state:
            return False, f"Session {session_id} not found."

        if state.status == "paused":
            return True, "Session is paused; audio discarded."
        if state.status == "stopped":
            return False, "Session is stopped; audio rejected."

        # Format & alignment validation
        if state.channels > 1:
            bytes_per_sample = 2 * state.channels
            if len(pcm_bytes) % bytes_per_sample != 0:
                return (
                    False,
                    f"PCM frame length {len(pcm_bytes)} not aligned to {state.channels} channels (requires multiple of {bytes_per_sample} bytes).",
                )
        else:
            if len(pcm_bytes) % 2 != 0:
                return False, f"Invalid PCM16 frame length: {len(pcm_bytes)} bytes is not a multiple of 2."

        # Sequence checking with uint32 modular arithmetic (handles wraparound at 2^32 - 1 -> 0)
        MAX_UINT32 = 0xFFFFFFFF
        diff = (seq_num - state.expected_seq) & MAX_UINT32

        if diff == 0:
            state.expected_seq = (state.expected_seq + 1) & MAX_UINT32
        elif diff < 0x80000000:
            missing = diff
            state.dropped_frames += missing
            logger.warning(
                "Missing audio frames for session %s: expected %d, got %d (%d dropped frames)",
                session_id,
                state.expected_seq,
                seq_num,
                missing,
            )
            state.expected_seq = (seq_num + 1) & MAX_UINT32
        else:
            state.duplicate_frames += 1
            return False, f"Duplicate frame detected (seq={seq_num}, expected={state.expected_seq}); discarded."

        state.received_frames += 1
        state.total_bytes_received += len(pcm_bytes)
        state.last_audio_received_at = time.perf_counter()

        # Multi-channel downmixing or mono ingestion
        if state.channels > 1:
            samples_i16 = np.frombuffer(pcm_bytes, dtype="<i2")
            samples_matrix = samples_i16.reshape(-1, state.channels)
            samples_f32 = np.mean(samples_matrix, axis=1, dtype=np.float32) / 32768.0
            samples_written, warning = state.ring_buffer.write_float_samples(samples_f32)
        else:
            samples_written, warning = state.ring_buffer.write_pcm16_bytes(pcm_bytes)
            samples_i16 = np.frombuffer(pcm_bytes, dtype="<i2")
            samples_f32 = samples_i16.astype(np.float32) / 32768.0

        if warning:
            await state.broadcast_event(
                {
                    "type": "audio_quality_warning",
                    "session_id": session_id,
                    "reason": warning,
                }
            )

        if samples_written > 0:
            soundscape_task = state.accumulate_soundscape_audio(samples_f32)
            if soundscape_task:
                await soundscape_worker.enqueue(soundscape_task)

        # Extract complete windows and submit to inference worker
        windows = state.ring_buffer.extract_available_windows()
        for win in windows:
            await state.inference_worker.submit_window(win)

        # Update DB total audio seconds periodically (e.g. every 10 frames)
        if state.received_frames % 20 == 0:
            async with async_session_factory() as session:
                await session.execute(
                    update(LiveSession)
                    .where(LiveSession.id == session_id)
                    .values(
                        total_audio_seconds=state.ring_buffer.total_seconds_written,
                        dropped_frames=state.dropped_frames,
                    )
                )
                await session.commit()

        return True, None

    async def shutdown(self, timeout: Optional[float] = 5.0) -> None:
        """Gracefully shuts down all active live sessions, stopping workers and closing resources."""
        stop_coros = []
        for sid, state in list(self._sessions.items()):
            if state.status != "stopped":
                stop_coros.append(self.stop_session(sid))
            else:
                stop_coros.append(state.inference_worker.stop())
        if stop_coros:
            try:
                if timeout is not None:
                    await asyncio.wait_for(
                        asyncio.gather(*stop_coros, return_exceptions=True),
                        timeout=timeout,
                    )
                else:
                    await asyncio.gather(*stop_coros, return_exceptions=True)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass
        self._sessions.clear()


live_session_manager = LiveSessionManager()
