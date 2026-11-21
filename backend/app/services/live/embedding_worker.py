"""Asynchronous, non-blocking embedding extraction worker with bounded queue and backpressure handling."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

import numpy as np
from sqlalchemy import update

from app.core.database import async_session_factory
from app.core.logging import logger
from app.models.live_session import LiveSegment
from app.services.analysis_pipeline import analysis_pipeline
from app.services.storage_service import storage_service


@dataclass(frozen=True)
class EmbeddingTask:
    session_id: str
    segment_id: str
    start_seconds: float
    end_seconds: float
    audio_path: str
    created_at: float


class EmbeddingWorker:
    """Bounded background worker that extracts and persists 1,280-D embeddings without delaying detections."""

    def __init__(
        self,
        max_queue_size: int = 30,
        warning_callback: Optional[Callable[[str, dict], None]] = None,
    ) -> None:
        self.max_queue_size = max_queue_size
        self._queue: asyncio.Queue[EmbeddingTask] = asyncio.Queue(maxsize=max_queue_size)
        self._worker_task: Optional[asyncio.Task] = None
        self._warning_callback = warning_callback
        self._running = False
        self._dropped_count = 0
        self._processed_count = 0
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

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._worker_task = asyncio.create_task(self._run_loop(), name="LiveEmbeddingWorker")
        logger.info("LiveEmbeddingWorker started with max queue capacity %d", self.max_queue_size)

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
        logger.info("LiveEmbeddingWorker stopped (processed=%d, dropped=%d)", self._processed_count, self._dropped_count)

    async def enqueue(self, task: EmbeddingTask) -> bool:
        """Enqueue an embedding task. If queue is full, drop task to protect detection pipeline."""
        try:
            self._queue.put_nowait(task)
            return True
        except asyncio.QueueFull:
            self._dropped_count += 1
            logger.warning(
                "Embedding queue overloaded for session %s (depth=%d, dropped=%d); prioritizing live detection",
                task.session_id,
                self._queue.qsize(),
                self._dropped_count,
            )
            # Asynchronously mark segment as skipped
            asyncio.create_task(self._mark_skipped(task.segment_id))
            if self._warning_callback:
                self._warning_callback(
                    task.session_id,
                    {
                        "type": "backpressure_warning",
                        "component": "embedding_queue",
                        "dropped_embeddings": self._dropped_count,
                        "queue_size": self._queue.qsize(),
                    },
                )
            return False

    async def _mark_skipped(self, segment_id: str) -> None:
        try:
            async with async_session_factory() as session:
                await session.execute(
                    update(LiveSegment)
                    .where(LiveSegment.id == segment_id)
                    .values(processing_status="embedding_skipped_queue_full")
                )
                await session.commit()
        except Exception as exc:
            logger.error("Failed to mark segment %s as skipped: %s", segment_id, exc)

    async def _run_loop(self) -> None:
        while self._running:
            try:
                task = await self._queue.get()
            except asyncio.CancelledError:
                break

            started = time.perf_counter()
            try:
                # Run embedding extraction in thread pool
                loop = asyncio.get_running_loop()
                audio_path = Path(task.audio_path)
                if not audio_path.exists():
                    logger.warning("Audio file for embedding does not exist: %s", task.audio_path)
                    self._queue.task_done()
                    continue

                vectors, _, duration_s = await loop.run_in_executor(
                    None,
                    lambda: analysis_pipeline.extract_embeddings(
                        audio_path, duration_seconds=task.end_seconds - task.start_seconds
                    ),
                )

                # Validate dimensions and finite values
                if vectors.shape[1] != 1280 or not np.isfinite(vectors).all():
                    raise ValueError(f"Extracted embedding invalid shape {vectors.shape} or non-finite values.")

                # Save embedding vector
                saved_path = storage_service.save_live_embedding(
                    session_id=task.session_id,
                    start_seconds=task.start_seconds,
                    end_seconds=task.end_seconds,
                    vector=vectors[0],
                )

                # Update database record
                async with async_session_factory() as session:
                    await session.execute(
                        update(LiveSegment)
                        .where(LiveSegment.id == task.segment_id)
                        .values(
                            embedding_path=str(saved_path),
                            processing_status="embedding_extracted",
                        )
                    )
                    await session.commit()

                elapsed = time.perf_counter() - started
                self._processed_count += 1
                self._total_latency_s += elapsed
                logger.debug(
                    "Extracted embedding for session %s [%.1f-%.1f] in %.3fs",
                    task.session_id,
                    task.start_seconds,
                    task.end_seconds,
                    elapsed,
                )

            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error(
                    "Embedding extraction failed for segment %s [%.1f-%.1f]: %s",
                    task.segment_id,
                    task.start_seconds,
                    task.end_seconds,
                    exc,
                )
                try:
                    async with async_session_factory() as session:
                        await session.execute(
                            update(LiveSegment)
                            .where(LiveSegment.id == task.segment_id)
                            .values(processing_status="embedding_failed")
                        )
                        await session.commit()
                except Exception:
                    pass
            finally:
                self._queue.task_done()


embedding_worker = EmbeddingWorker()
