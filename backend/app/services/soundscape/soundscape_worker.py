"""Background worker for non-blocking live soundscape fingerprint computation."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass
from typing import Any, Callable, Coroutine, Dict, Optional

import numpy as np

from app.core.database import async_session_factory
from app.core.logging import logger
from app.models.soundscape import SoundscapeMeasurement
from app.schemas.soundscape import SoundscapeFingerprintResponse
from app.services.soundscape.fingerprint_engine import soundscape_engine


@dataclass(frozen=True)
class SoundscapeTask:
    session_id: str
    start_seconds: float
    end_seconds: float
    samples: np.ndarray
    created_at: float


BroadcastCallback = Callable[[str, Dict[str, Any]], Coroutine[Any, Any, None]]


class LiveSoundscapeWorker:
    """Non-blocking bounded worker that computes soundscape measurements on long analysis windows."""

    def __init__(
        self,
        max_queue_size: int = 10,
        broadcast_callback: Optional[BroadcastCallback] = None,
    ) -> None:
        self.max_queue_size = max_queue_size
        self._queue: asyncio.Queue[SoundscapeTask] = asyncio.Queue(maxsize=max_queue_size)
        self._worker_task: Optional[asyncio.Task] = None
        self._broadcast_callback = broadcast_callback
        self._running = False
        self._processed_count = 0
        self._dropped_count = 0
        self._total_latency_s = 0.0

    @property
    def queue_size(self) -> int:
        return self._queue.qsize()

    @property
    def dropped_count(self) -> int:
        return self._dropped_count

    @property
    def avg_latency_ms(self) -> float:
        if self._processed_count == 0:
            return 0.0
        return (self._total_latency_s / self._processed_count) * 1000.0

    def set_broadcast_callback(self, callback: BroadcastCallback) -> None:
        self._broadcast_callback = callback

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._worker_task = asyncio.create_task(
            self._run_loop(), name="LiveSoundscapeWorker"
        )
        logger.info(
            "LiveSoundscapeWorker started with max queue capacity %d",
            self.max_queue_size,
        )

    async def stop(self) -> None:
        if not self._running:
            return
        self._running = False
        if self._worker_task:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass
            self._worker_task = None
        logger.info(
            "LiveSoundscapeWorker stopped (processed=%d, dropped=%d)",
            self._processed_count,
            self._dropped_count,
        )

    async def enqueue(self, task: SoundscapeTask) -> bool:
        """Enqueue long-window soundscape analysis. If queue full, drop to protect audio streaming."""
        try:
            self._queue.put_nowait(task)
            return True
        except asyncio.QueueFull:
            self._dropped_count += 1
            logger.warning(
                "Soundscape queue full for session %s (depth=%d); dropped window [%.1f-%.1f]",
                task.session_id,
                self._queue.qsize(),
                task.start_seconds,
                task.end_seconds,
            )
            if self._broadcast_callback:
                asyncio.create_task(
                    self._broadcast_callback(
                        task.session_id,
                        {
                            "type": "soundscape_quality_warning",
                            "session_id": task.session_id,
                            "reason": "Soundscape analysis queue full; skipping window to protect real-time audio pipeline.",
                        },
                    )
                )
            return False

    async def _run_loop(self) -> None:
        while self._running:
            try:
                task = await self._queue.get()
            except asyncio.CancelledError:
                break

            t_start = time.perf_counter()
            try:
                loop = asyncio.get_running_loop()
                # Run heavy soundscape computation in executor
                fingerprint: SoundscapeFingerprintResponse = (
                    await loop.run_in_executor(
                        None,
                        lambda: soundscape_engine.analyze_audio_segment(
                            samples=task.samples,
                            sample_rate=32000,
                            start_seconds=task.start_seconds,
                            session_id=task.session_id,
                        ),
                    )
                )

                # Persist to database
                meas_id = str(uuid.uuid4())
                async with async_session_factory() as session:
                    db_meas = SoundscapeMeasurement(
                        id=meas_id,
                        session_id=task.session_id,
                        start_seconds=fingerprint.window_start_seconds,
                        end_seconds=fingerprint.window_end_seconds,
                        aci=fingerprint.metrics.aci,
                        adi=fingerprint.metrics.adi,
                        aei=fingerprint.metrics.aei,
                        ndsi=fingerprint.metrics.ndsi,
                        spectral_entropy=fingerprint.metrics.spectral_entropy,
                        temporal_activity=fingerprint.metrics.temporal_activity,
                        frequency_bands_json=fingerprint.frequency_bands,
                        parameters_json=fingerprint.calculation_parameters,
                        quality_flags_json=fingerprint.quality_flags,
                    )
                    session.add(db_meas)
                    await session.commit()

                elapsed = time.perf_counter() - t_start
                self._processed_count += 1
                self._total_latency_s += elapsed

                # Broadcast live WebSocket event
                if self._broadcast_callback:
                    event_payload = {
                        "type": "soundscape_measurement",
                        "session_id": task.session_id,
                        "measurement_id": meas_id,
                        "start_seconds": fingerprint.window_start_seconds,
                        "end_seconds": fingerprint.window_end_seconds,
                        "metrics": fingerprint.metrics.model_dump(),
                        "frequency_bands": fingerprint.frequency_bands,
                        "calculation_parameters": fingerprint.calculation_parameters,
                        "quality_flags": fingerprint.quality_flags,
                    }
                    await self._broadcast_callback(task.session_id, event_payload)

                    if fingerprint.quality_flags:
                        await self._broadcast_callback(
                            task.session_id,
                            {
                                "type": "soundscape_quality_warning",
                                "session_id": task.session_id,
                                "quality_flags": fingerprint.quality_flags,
                                "start_seconds": fingerprint.window_start_seconds,
                                "end_seconds": fingerprint.window_end_seconds,
                            },
                        )

                logger.debug(
                    "Computed soundscape for session %s [%.1f-%.1f] in %.3fs (ACI=%s, NDSI=%s)",
                    task.session_id,
                    task.start_seconds,
                    task.end_seconds,
                    elapsed,
                    fingerprint.metrics.aci,
                    fingerprint.metrics.ndsi,
                )

            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error(
                    "Soundscape computation failed for session %s [%.1f-%.1f]: %s",
                    task.session_id,
                    task.start_seconds,
                    task.end_seconds,
                    exc,
                    exc_info=True,
                )
            finally:
                self._queue.task_done()


soundscape_worker = LiveSoundscapeWorker()
