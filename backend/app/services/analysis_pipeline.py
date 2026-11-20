"""Audio preprocessing and real BirdNET inference orchestration."""

from __future__ import annotations

import asyncio
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional

import numpy as np

from app.config import settings
from app.core.exceptions import AudioProcessingError
from app.core.logging import logger
from app.services.audio_processor import AudioMetadata, audio_processor
from app.services.storage_service import storage_service


NON_ANIMAL_SOUND_CLASSES = {
    "Gun_Gun", "Chainsaw_Chainsaw", "Aircraft_Aircraft", "Boat_Boat",
    "Explosion_Explosion", "Engine_Engine", "Fire_Fire", "Fireworks_Fireworks",
    "Hammer_Hammer", "Motor vehicle_Motor vehicle", "Music_Music",
    "Power tool_Power tool", "Train_Train", "Sawing_Sawing", "Siren_Siren",
    "Vehicle horn_Vehicle horn",
}


@dataclass
class ModelDetectionOutput:
    class_label: str
    scientific_name: str
    common_name: str
    taxon_group: Optional[str]
    record_type: str
    start_seconds: float
    end_seconds: float
    confidence_score: float
    geo_score: Optional[float] = None


class BirdNetEngineAdapter:
    """Normalize the existing BirdNetEngine API to backend detection records."""

    def __init__(self, engine: Any):
        self._engine = engine
        self._engine.load()

    @property
    def provider(self) -> str:
        return getattr(self._engine, "device", "TEST")

    @property
    def model_version(self) -> str:
        return str(self._engine.model.get_version())

    def analyze_audio(self, audio_path: str, min_confidence: float) -> list[ModelDetectionOutput]:
        frame = self._engine.predict(audio_path)
        detections: list[ModelDetectionOutput] = []
        for row in frame.itertuples(index=False):
            label = str(row.species_name)
            score = float(row.confidence)
            if score < min_confidence:
                continue
            if label in NON_ANIMAL_SOUND_CLASSES:
                scientific, common, group, record_type = "Unknown", label.split("_", 1)[-1], None, "sound_class"
            elif "_" in label:
                scientific, common = (part.strip() for part in label.split("_", 1))
                if not scientific or not common:
                    scientific, common, group, record_type = "Unknown", label, "Unknown", "animal"
                else:
                    group, record_type = "Unknown", "animal"
            else:
                scientific, common, group, record_type = "Unknown", label, "Unknown", "animal"
            detections.append(ModelDetectionOutput(
                class_label=label,
                scientific_name=scientific,
                common_name=common,
                taxon_group=group,
                record_type=record_type,
                start_seconds=float(row.start_time),
                end_seconds=float(row.end_time),
                confidence_score=score,
            ))
        return detections

    def extract_embeddings(self, audio_path: str):
        batch = self._engine.encode(audio_path)
        return batch.vectors, batch.segments


class FallbackMockEngine:
    """Deterministic test double. Production never selects this engine implicitly."""

    def load(self) -> None:
        return None

    @property
    def provider(self) -> str:
        return "MOCK"

    @property
    def model_version(self) -> str:
        return "MOCK-1.0"

    def analyze_audio(self, audio_path: str, min_confidence: float = 0.0, **_: Any):
        return [ModelDetectionOutput(
            class_label="Passer domesticus_House Sparrow",
            scientific_name="Passer domesticus", common_name="House Sparrow",
            taxon_group="Unknown", record_type="animal", start_seconds=0.0,
            end_seconds=3.0, confidence_score=0.88,
        )]

    def extract_embeddings(self, audio_path: str):
        return np.zeros((1, 1280), dtype=np.float32), [(0.0, 3.0)]


class AnalysisPipeline:
    """Loads one real model instance and runs preprocessing, prediction, and encoding."""

    def __init__(self, engine: Any = None):
        self._provided_engine = engine
        self.engine: Any = None
        self._load_lock = threading.Lock()
        self._model_load_seconds: Optional[float] = None

    def set_engine(self, engine: Any) -> None:
        """Explicit injection point for tests; production startup uses BirdNET."""
        with self._load_lock:
            self._provided_engine = engine
            self.engine = None

    def load(self) -> None:
        if self.engine is not None:
            return
        with self._load_lock:
            if self.engine is not None:
                return
            started = time.perf_counter()
            if self._provided_engine is not None:
                if hasattr(self._provided_engine, "analyze_audio"):
                    self.engine = self._provided_engine
                else:
                    self.engine = BirdNetEngineAdapter(self._provided_engine)
            else:
                from app.services.birdnet_engine import BirdNetEngine
                self.engine = BirdNetEngineAdapter(BirdNetEngine(
                    precision="fp32", prefer_gpu=settings.MODEL_PREFER_GPU
                ))
            self._model_load_seconds = time.perf_counter() - started
            logger.info("Real BirdNET model ready in %.3fs on %s", self._model_load_seconds, self.engine.provider)

    async def run_pipeline(
        self,
        analysis_id: str,
        raw_audio_path: Path,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        progress_callback: Optional[Callable[[str, float], Any]] = None,
    ):
        del latitude, longitude
        if self.engine is None:
            raise RuntimeError("Real BirdNET engine is not initialized.")

        timings: dict[str, float] = {}

        async def report(stage: str, progress: float) -> None:
            if progress_callback:
                result = progress_callback(stage, progress)
                if asyncio.iscoroutine(result):
                    await result

        await report("validating_audio", 5)
        raw_meta = audio_processor.inspect_audio(raw_audio_path)
        if raw_meta.is_empty:
            raise AudioProcessingError("Uploaded audio is silent or empty.")

        await report("preprocessing", 15)
        processed_path = storage_service.get_processed_path(analysis_id)
        started = time.perf_counter()
        processed_meta = audio_processor.convert_to_mono_wav(
            raw_audio_path, processed_path, target_sr=32000
        )
        timings["preprocessing_seconds"] = time.perf_counter() - started
        if processed_meta.sample_rate != 32000 or processed_meta.channels != 1:
            raise AudioProcessingError("Normalized audio must be mono at 32,000 Hz.")

        loop = asyncio.get_running_loop()
        await report("birdnet_inference", 35)
        started = time.perf_counter()
        detections = await loop.run_in_executor(
            None, lambda: self.engine.analyze_audio(
                str(processed_path), settings.DEFAULT_CONFIDENCE_THRESHOLD
            )
        )
        timings["prediction_seconds"] = time.perf_counter() - started

        return (processed_meta, detections, processed_path, timings,
                self.engine.provider, self._model_load_seconds)

    def extract_embeddings(self, processed_path: Path, duration_seconds: float):
        started = time.perf_counter()
        vectors, segments_frame = self.engine.extract_embeddings(str(processed_path))
        vectors = np.asarray(vectors)
        if vectors.dtype != np.float32 or vectors.ndim != 2 or vectors.shape[1] != 1280:
            raise ValueError(f"BirdNET embeddings must be float32 (N, 1280), got {vectors.shape} {vectors.dtype}.")
        if not np.isfinite(vectors).all():
            raise ValueError("BirdNET embeddings contain non-finite values.")

        if hasattr(segments_frame, "itertuples"):
            segments = [(float(row.start_time), float(row.end_time)) for row in segments_frame.itertuples(index=False)]
        else:
            segments = [(float(start), float(end)) for start, end in segments_frame]
        if any(start < 0 or end <= start or start > duration_seconds + 0.1 for start, end in segments):
            raise ValueError("BirdNET returned embedding timestamps outside the recording.")
        return vectors, segments, time.perf_counter() - started


analysis_pipeline = AnalysisPipeline()
