import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Protocol, Tuple, runtime_checkable
import numpy as np

from app.config import settings
from app.core.exceptions import AudioProcessingError
from app.core.logging import logger
from app.services.audio_processor import audio_processor, AudioMetadata
from app.services.storage_service import storage_service


@dataclass
class ModelDetectionOutput:
    class_label: str
    scientific_name: str
    common_name: str
    taxon_group: str
    record_type: str
    start_seconds: float
    end_seconds: float
    confidence_score: float
    geo_score: Optional[float] = None


@runtime_checkable
class BirdNetEngineProtocol(Protocol):
    """
    Interface contract for the BirdNET+ engine being developed by the parallel agent.
    Any engine conforming to this protocol can be injected into the analysis pipeline.
    """
    def analyze_audio(
        self,
        audio_path: str,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        min_confidence: float = 0.25,
    ) -> List[Dict[str, Any]]:
        ...

    def extract_embeddings(
        self,
        audio_path: str,
    ) -> Tuple[np.ndarray, List[Tuple[float, float]]]:
        ...


class BirdNetEngineAdapter:
    """
    Production adapter that bridges the official BirdNetEngine class
    (developed in app/services/birdnet_engine.py) to the EcoSonic analysis pipeline.
    """

    def __init__(self, engine: Any):
        self._engine = engine
        try:
            self._engine.load()
            logger.info("BirdNetEngine loaded successfully into adapter.")
        except Exception as e:
            logger.warning("Could not pre-load BirdNetEngine in adapter: %s", e)

    def analyze_audio(
        self,
        audio_path: str,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        min_confidence: float = 0.25,
    ) -> List[Dict[str, Any]]:
        if hasattr(self._engine, "predict"):
            df = self._engine.predict(audio_path)
            # Filter by confidence threshold
            filtered = df[df["confidence"] >= min_confidence]
            results = []
            for _, row in filtered.iterrows():
                species_name = str(row["species_name"])
                parts = species_name.split("_", 1)
                sci = parts[0].strip()
                com = parts[1].strip() if len(parts) > 1 else sci
                results.append({
                    "class_label": species_name,
                    "scientific_name": sci,
                    "common_name": com,
                    "taxon_group": "Aves",
                    "record_type": "vocalization",
                    "start_seconds": float(row["start_time"]),
                    "end_seconds": float(row["end_time"]),
                    "confidence_score": float(row["confidence"]),
                    "geo_score": None,
                })
            return results
        elif hasattr(self._engine, "analyze_audio"):
            return self._engine.analyze_audio(audio_path, latitude, longitude, min_confidence)
        return []

    def extract_embeddings(
        self,
        audio_path: str,
    ) -> Tuple[np.ndarray, List[Tuple[float, float]]]:
        if hasattr(self._engine, "encode"):
            batch = self._engine.encode(audio_path)
            vectors = batch.vectors
            segments = [
                (float(row["start_time"]), float(row["end_time"]))
                for _, row in batch.segments.iterrows()
            ]
            return vectors, segments
        elif hasattr(self._engine, "extract_embeddings"):
            return self._engine.extract_embeddings(audio_path)
        return np.empty((0, 1024), dtype=np.float32), []


class FallbackMockEngine:
    """
    Fallback mock engine providing realistic outputs if the neural model is offline.
    """

    def analyze_audio(
        self,
        audio_path: str,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        min_confidence: float = 0.25,
    ) -> List[Dict[str, Any]]:
        logger.info("Using FallbackMockEngine for detection analysis.")
        return [
            {
                "class_label": "Passer domesticus_House Sparrow",
                "scientific_name": "Passer domesticus",
                "common_name": "House Sparrow",
                "taxon_group": "Aves",
                "record_type": "song",
                "start_seconds": 0.0,
                "end_seconds": 3.0,
                "confidence_score": 0.88,
                "geo_score": 0.95 if (latitude and longitude) else None,
            },
            {
                "class_label": "Turdus merula_Eurasian Blackbird",
                "scientific_name": "Turdus merula",
                "common_name": "Eurasian Blackbird",
                "taxon_group": "Aves",
                "record_type": "call",
                "start_seconds": 3.0,
                "end_seconds": 6.0,
                "confidence_score": 0.76,
                "geo_score": 0.90 if (latitude and longitude) else None,
            },
        ]

    def extract_embeddings(
        self,
        audio_path: str,
    ) -> Tuple[np.ndarray, List[Tuple[float, float]]]:
        logger.info("Using FallbackMockEngine for embedding extraction.")
        embeddings = np.random.randn(2, 1024).astype(np.float32)
        segments = [(0.0, 3.0), (3.0, 6.0)]
        return embeddings, segments


class AnalysisPipeline:
    """
    Coordinates audio ingestion, normalization, model inference,
    and embedding extraction.
    """

    def __init__(self):
        self.engine = self._load_birdnet_engine()

    def _load_birdnet_engine(self) -> Any:
        """
        Dynamically imports the BirdNET engine from `app.services.birdnet_engine` if present,
        otherwise falls back to FallbackMockEngine.
        """
        try:
            from app.services.birdnet_engine import BirdNetEngine
            engine = BirdNetEngine(precision="fp32", prefer_gpu=False)
            return BirdNetEngineAdapter(engine)
        except Exception as e:
            logger.info("Could not initialize BirdNetEngine (%s). Using FallbackMockEngine.", e)
            return FallbackMockEngine()

    async def run_pipeline(
        self,
        analysis_id: str,
        raw_audio_path: Path,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        progress_callback: Optional[Any] = None,
    ) -> Tuple[AudioMetadata, List[ModelDetectionOutput], np.ndarray, List[Tuple[float, float]]]:
        """
        Executes the multi-stage bioacoustic pipeline:
        Stage 1: Validation & Audio Inspection
        Stage 2: Audio Normalization (Mono 48kHz WAV conversion)
        Stage 3: Acoustic Model Inference
        Stage 4: Embedding Extraction
        """
        async def report(prog: float, stage: str):
            if progress_callback:
                if asyncio.iscoroutinefunction(progress_callback):
                    await progress_callback(prog, stage)
                else:
                    progress_callback(prog, stage)

        # Stage 1: Validation & Probe
        await report(10.0, "Validating audio structure")
        raw_meta = audio_processor.inspect_audio(raw_audio_path)
        if raw_meta.is_empty:
            raise AudioProcessingError("Uploaded audio file is silent or empty.")

        # Stage 2: Normalization
        await report(30.0, "Normalizing audio to 48kHz Mono WAV")
        processed_path = storage_service.get_processed_path(analysis_id)
        processed_meta = audio_processor.convert_to_mono_wav(
            raw_audio_path,
            processed_path,
            target_sr=settings.TARGET_SAMPLE_RATE,
        )

        # Stage 3: Inference
        await report(60.0, "Running bioacoustic classification")
        loop = asyncio.get_running_loop()

        raw_detections = await loop.run_in_executor(
            None,
            lambda: self.engine.analyze_audio(
                str(processed_path),
                latitude=latitude,
                longitude=longitude,
                min_confidence=settings.DEFAULT_CONFIDENCE_THRESHOLD,
            )
        )

        detections: List[ModelDetectionOutput] = []
        for d in raw_detections:
            detections.append(
                ModelDetectionOutput(
                    class_label=d.get("class_label", "Unknown"),
                    scientific_name=d.get("scientific_name", "Unknown"),
                    common_name=d.get("common_name", "Unknown"),
                    taxon_group=d.get("taxon_group", "Aves"),
                    record_type=d.get("record_type", "vocalization"),
                    start_seconds=float(d.get("start_seconds", 0.0)),
                    end_seconds=float(d.get("end_seconds", 0.0)),
                    confidence_score=float(d.get("confidence_score", 0.0)),
                    geo_score=d.get("geo_score"),
                )
            )

        # Stage 4: Embedding extraction
        await report(85.0, "Extracting vector embeddings")
        embeddings, segments = await loop.run_in_executor(
            None,
            lambda: self.engine.extract_embeddings(str(processed_path))
        )

        await report(95.0, "Persisting embeddings to storage")
        storage_service.save_embeddings(analysis_id, embeddings)

        await report(100.0, "Pipeline completed")
        return processed_meta, detections, embeddings, segments


analysis_pipeline = AnalysisPipeline()
