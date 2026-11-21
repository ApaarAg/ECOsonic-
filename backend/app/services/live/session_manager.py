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
from fastapi import WebSocket
from sqlalchemy import func, select, update

from app.core.database import async_session_factory
from app.core.logging import logger
from app.models.live_session import LiveEvent, LiveSegment, LiveSession
from app.schemas.live_session import LiveSessionStats
from app.services.live.embedding_worker import embedding_worker
from app.services.live.inference_worker import LiveInferenceWorker
from app.services.live.ring_buffer import AudioRingBuffer


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
        """Ensure global workers (such as embedding worker) are started."""
        await embedding_worker.start()

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

        # Sequence checking
        if seq_num < state.expected_seq:
            state.duplicate_frames += 1
            return False, f"Duplicate frame detected (seq={seq_num}, expected={state.expected_seq}); discarded."

        if seq_num > state.expected_seq:
            missing = seq_num - state.expected_seq
            state.dropped_frames += missing
            logger.warning(
                "Missing audio frames for session %s: expected %d, got %d (%d dropped frames)",
                session_id,
                state.expected_seq,
                seq_num,
                missing,
            )
            state.expected_seq = seq_num + 1
        else:
            state.expected_seq += 1

        state.received_frames += 1
        state.total_bytes_received += len(pcm_bytes)
        state.last_audio_received_at = time.perf_counter()

        # Ingest into ring buffer
        samples_written, warning = state.ring_buffer.write_pcm16_bytes(pcm_bytes)
        if warning:
            await state.broadcast_event(
                {
                    "type": "audio_quality_warning",
                    "session_id": session_id,
                    "reason": warning,
                }
            )

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


live_session_manager = LiveSessionManager()
