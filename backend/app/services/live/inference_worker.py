"""Real-time rolling-window inference worker using the singleton BirdNET V3.0 model."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass
from typing import Any, Callable, Coroutine, Dict, List, Optional

import numpy as np
from sqlalchemy import select, update

from app.config import settings
from app.core.database import async_session_factory
from app.core.logging import logger
from app.models.live_session import LiveEvent, LiveSegment, LiveSession
from app.schemas.live_session import WSDetectionEvent
from app.services.analysis_pipeline import analysis_pipeline, FallbackMockEngine
from app.services.birdnet_engine import AudioValidationError
from app.services.direct_onnx_engine import direct_onnx_engine
from app.services.live.embedding_worker import EmbeddingTask, embedding_worker
from app.services.live.ring_buffer import AudioWindow
from app.services.soundscape.disturbance_service import disturbance_service
from app.services.storage_service import storage_service


EventCallback = Callable[[Dict[str, Any]], Coroutine[Any, Any, None]]


class LiveInferenceWorker:
    """Manages rolling audio window queuing, execution on BirdNET, event emission, and persistence."""

    def __init__(
        self,
        session_id: str,
        max_queue_size: int = 10,
        min_confidence: float = 0.10,
        event_callback: Optional[EventCallback] = None,
    ) -> None:
        self.session_id = session_id
        self.max_queue_size = max_queue_size
        self.min_confidence = min_confidence
        self.event_callback = event_callback

        self._queue: asyncio.Queue[AudioWindow] = asyncio.Queue(maxsize=max_queue_size)
        self._worker_task: Optional[asyncio.Task] = None
        self._running = False

        self._processed_windows = 0
        self._inferred_windows = 0
        self._silent_windows = 0
        self._dropped_windows = 0
        self._total_inference_time_s = 0.0
        self._total_lag_time_s = 0.0
        self._last_inference_duration_ms = 0.0
        self._last_window_lag_ms = 0.0

    @property
    def queue_size(self) -> int:
        return self._queue.qsize()

    @property
    def dropped_windows(self) -> int:
        return self._dropped_windows

    @property
    def processed_windows(self) -> int:
        return self._processed_windows

    @property
    def inferred_windows(self) -> int:
        return self._inferred_windows

    @property
    def silent_windows(self) -> int:
        return self._silent_windows

    @property
    def avg_inference_latency_ms(self) -> float:
        if self._inferred_windows == 0:
            return 0.0
        return (self._total_inference_time_s / self._inferred_windows) * 1000.0

    @property
    def avg_window_lag_ms(self) -> float:
        if self._processed_windows == 0:
            return 0.0
        return (self._total_lag_time_s / self._processed_windows) * 1000.0

    async def start(self) -> None:
        if self._running:
            return
        # If a test mock is injected, respect it; otherwise ensure Direct ONNX is loaded
        if analysis_pipeline.engine is not None and isinstance(analysis_pipeline.engine, FallbackMockEngine):
            analysis_pipeline.load()
        else:
            direct_onnx_engine.load()
        self._running = True
        self._worker_task = asyncio.create_task(
            self._run_loop(), name=f"LiveInferenceWorker-{self.session_id}"
        )
        logger.info("LiveInferenceWorker started for session %s (Direct ONNX engine)", self.session_id)

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
            "LiveInferenceWorker stopped for session %s (processed=%d, dropped=%d)",
            self.session_id,
            self._processed_windows,
            self._dropped_windows,
        )

    async def submit_window(self, window: AudioWindow) -> bool:
        """Submit an extracted audio window for inference with bounded queue backpressure."""
        try:
            self._queue.put_nowait(window)
            return True
        except asyncio.QueueFull:
            self._dropped_windows += 1
            logger.warning(
                "Inference queue full for session %s (depth=%d); dropped window [%.1f-%.1f]",
                self.session_id,
                self._queue.qsize(),
                window.start_seconds,
                window.end_seconds,
            )
            # Emit backpressure warning event
            if self.event_callback:
                asyncio.create_task(
                    self.event_callback(
                        {
                            "type": "backpressure_warning",
                            "session_id": self.session_id,
                            "component": "inference_queue",
                            "dropped_windows": self._dropped_windows,
                            "queue_size": self._queue.qsize(),
                            "start_seconds": window.start_seconds,
                            "end_seconds": window.end_seconds,
                        }
                    )
                )
            # Update database session stats
            asyncio.create_task(self._increment_dropped_window_in_db())
            return False

    async def _increment_dropped_window_in_db(self) -> None:
        try:
            async with async_session_factory() as session:
                await session.execute(
                    update(LiveSession)
                    .where(LiveSession.id == self.session_id)
                    .values(dropped_windows=LiveSession.dropped_windows + 1)
                )
                await session.commit()
        except Exception as exc:
            logger.error("Failed to update dropped_windows in DB: %s", exc)

    async def _run_loop(self) -> None:
        while self._running:
            try:
                window = await self._queue.get()
            except asyncio.CancelledError:
                break

            try:
                await self._process_window(window)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error(
                    "Unexpected error in live inference for session %s [%.1f-%.1f]: %s",
                    self.session_id,
                    window.start_seconds,
                    window.end_seconds,
                    exc,
                    exc_info=True,
                )
                if self.event_callback:
                    await self.event_callback(
                        {
                            "type": "inference_error",
                            "session_id": self.session_id,
                            "error": str(exc),
                            "start_seconds": window.start_seconds,
                            "end_seconds": window.end_seconds,
                        }
                    )
            finally:
                self._queue.task_done()

    async def _process_window(self, window: AudioWindow) -> None:
        t_start = time.perf_counter()
        lag_ms = (t_start - window.created_at) * 1000.0

        # Save audio window WAV to persistent storage
        audio_path = storage_service.save_live_audio_segment(
            session_id=self.session_id,
            start_seconds=window.start_seconds,
            end_seconds=window.end_seconds,
            samples=window.data,
            sample_rate=32000,
        )

        segment_id = str(uuid.uuid4())

        # If window is silent / dead microphone, skip heavy model inference and emit progress telemetry
        if window.is_silent:
            self._silent_windows += 1
            self._processed_windows += 1
            self._total_lag_time_s += (time.perf_counter() - window.created_at)
            if self.event_callback:
                await self.event_callback(
                    {
                        "type": "processing_update",
                        "session_id": self.session_id,
                        "status": "silent_skipped",
                        "processed_seconds": window.end_seconds,
                        "window_index": window.window_index,
                        "is_silent": True,
                        "rms_energy": round(window.rms_energy, 6),
                        "start_seconds": window.start_seconds,
                        "end_seconds": window.end_seconds,
                        "queue_size": self._queue.qsize(),
                        "detections_count": 0,
                    }
                )
            # Create LiveSegment record marked as silent
            async with async_session_factory() as session:
                seg = LiveSegment(
                    id=segment_id,
                    session_id=self.session_id,
                    start_seconds=window.start_seconds,
                    end_seconds=window.end_seconds,
                    audio_path=str(audio_path),
                    processing_status="silent_skipped",
                )
                session.add(seg)
                await session.commit()
            return

        if window.is_clipped and self.event_callback:
            await self.event_callback(
                {
                    "type": "audio_quality_warning",
                    "session_id": self.session_id,
                    "reason": "Audio clipping detected (>5% samples clipped at limit).",
                    "start_seconds": window.start_seconds,
                    "end_seconds": window.end_seconds,
                }
            )

        # Run inference in thread pool
        loop = asyncio.get_running_loop()
        t_infer_start = time.perf_counter()

        use_mock = (
            analysis_pipeline.engine is not None
            and isinstance(analysis_pipeline.engine, FallbackMockEngine)
        )

        try:
            if use_mock:
                raw_detections = await loop.run_in_executor(
                    None,
                    lambda: analysis_pipeline.engine.analyze_audio(str(audio_path), self.min_confidence),
                )
                mock_vectors, _ = analysis_pipeline.engine.extract_embeddings(str(audio_path))
                embedding_vector = mock_vectors[0] if mock_vectors.ndim > 1 else mock_vectors
                active_model_version = str(analysis_pipeline.engine.model_version)
            else:
                direct_res = await loop.run_in_executor(
                    None,
                    lambda: direct_onnx_engine.infer(
                        window.data,
                        min_confidence=self.min_confidence,
                        top_k=5,
                    ),
                )
                raw_detections = direct_res.detections
                embedding_vector = direct_res.embedding
                active_model_version = str(direct_onnx_engine.model_version)
        except AudioValidationError as ave:
            logger.warning(
                "Audio validation rejected window for session %s [%.1f-%.1f]: %s",
                self.session_id,
                window.start_seconds,
                window.end_seconds,
                ave,
            )
            if self.event_callback:
                await self.event_callback(
                    {
                        "type": "audio_quality_warning",
                        "session_id": self.session_id,
                        "reason": str(ave),
                        "start_seconds": window.start_seconds,
                        "end_seconds": window.end_seconds,
                    }
                )
            async with async_session_factory() as session:
                seg = LiveSegment(
                    id=segment_id,
                    session_id=self.session_id,
                    start_seconds=window.start_seconds,
                    end_seconds=window.end_seconds,
                    audio_path=str(audio_path),
                    processing_status="rejected_audio_validation",
                )
                session.add(seg)
                await session.commit()
            return

        inference_duration_s = time.perf_counter() - t_infer_start
        self._inferred_windows += 1
        self._processed_windows += 1
        self._total_inference_time_s += inference_duration_s
        self._total_lag_time_s += (time.perf_counter() - window.created_at)
        self._last_inference_duration_ms = inference_duration_s * 1000.0
        self._last_window_lag_ms = lag_ms

        # Process Disturbance Radar events (extract non-animal classes, merge, persist, broadcast)
        await disturbance_service.process_window_detections(
            session_id=self.session_id,
            window_start=window.start_seconds,
            window_end=window.end_seconds,
            detections=raw_detections,
            broadcast_cb=self.event_callback,
        )

        # Persist segment and detections in DB
        db_events: List[LiveEvent] = []
        ws_events: List[Dict[str, Any]] = []

        for det in raw_detections:
            score = float(det.confidence_score)
            if not np.isfinite(score) or score < 0.0 or score > 1.0:
                logger.warning(
                    "Rejecting non-finite or invalid confidence score %s for %s",
                    score,
                    det.class_label,
                )
                continue

            # Convert local 3-second segment timestamps to absolute session timestamps
            abs_start = round(window.start_seconds + det.start_seconds, 3)
            abs_end = round(window.start_seconds + det.end_seconds, 3)
            event_id = str(uuid.uuid4())

            live_event = LiveEvent(
                id=event_id,
                session_id=self.session_id,
                detection_id=str(uuid.uuid4()),
                start_seconds=abs_start,
                end_seconds=abs_end,
                class_label=det.class_label,
                scientific_name=det.scientific_name,
                common_name=det.common_name,
                confidence_score=score,
                taxon_group=det.taxon_group or "Bird",
                model_version=active_model_version,
            )
            db_events.append(live_event)

            ws_events.append(
                {
                    "type": "detection",
                    "session_id": self.session_id,
                    "event_id": event_id,
                    "start_seconds": abs_start,
                    "end_seconds": abs_end,
                    "class_label": det.class_label,
                    "scientific_name": det.scientific_name,
                    "common_name": det.common_name,
                    "confidence_score": round(score, 4),
                    "taxon_group": det.taxon_group or "Bird",
                    "model_version": active_model_version,
                }
            )

        # Database persistence
        async with async_session_factory() as session:
            seg = LiveSegment(
                id=segment_id,
                session_id=self.session_id,
                start_seconds=window.start_seconds,
                end_seconds=window.end_seconds,
                audio_path=str(audio_path),
                processing_status="processed",
            )
            session.add(seg)
            for ev in db_events:
                session.add(ev)

            # Update session processed audio seconds
            await session.execute(
                update(LiveSession)
                .where(LiveSession.id == self.session_id)
                .values(processed_audio_seconds=window.end_seconds)
            )
            await session.commit()

        # Immediate WebSocket event broadcast
        if self.event_callback:
            for ev in ws_events:
                await self.event_callback(ev)

            # Broadcast processing update
            await self.event_callback(
                {
                    "type": "processing_update",
                    "session_id": self.session_id,
                    "status": "processed",
                    "processed_seconds": window.end_seconds,
                    "window_index": window.window_index,
                    "is_silent": False,
                    "rms_energy": round(window.rms_energy, 6),
                    "inference_duration_ms": round(self._last_inference_duration_ms, 2),
                    "window_lag_ms": round(self._last_window_lag_ms, 2),
                    "queue_size": self._queue.qsize(),
                    "detections_count": len(ws_events),
                }
            )

        # Submit precomputed embedding to background worker for non-blocking persistence
        await embedding_worker.enqueue(
            EmbeddingTask(
                session_id=self.session_id,
                segment_id=segment_id,
                start_seconds=window.start_seconds,
                end_seconds=window.end_seconds,
                audio_path=str(audio_path),
                created_at=time.perf_counter(),
                vector=embedding_vector,
            )
        )
