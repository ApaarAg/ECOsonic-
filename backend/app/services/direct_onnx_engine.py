"""Direct in-memory ONNX Runtime inference engine for BirdNET+ V3.0 live streaming.

Provides:
- Persistent ONNX Runtime InferenceSession avoiding per-window subprocess spawning
- Combined predictions and 1,280-D embeddings in a single GPU/CPU forward pass
- Full CUDAExecutionProvider with automated CPUExecutionProvider fallback
- Thread-safe inference execution with input validation and offline cache enforcement
"""

from __future__ import annotations

import logging
import os
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, List, Optional, Tuple

import numpy as np
import onnxruntime as ort

from app.config import settings
from app.services.analysis_pipeline import ModelDetectionOutput, NON_ANIMAL_SOUND_CLASSES
from app.services.birdnet_engine import (
    AudioValidationError,
    BirdNetEngineError,
    _ensure_model_cache_env,
    _prepare_windows_cuda_dll_path,
)

logger = logging.getLogger(__name__)

EXPECTED_CLASS_COUNT = 11725
EXPECTED_EMBEDDING_DIM = 1280
EXPECTED_SAMPLE_RATE = 32000
EXPECTED_SEGMENT_SAMPLES = 96000  # 3.0 seconds @ 32 kHz


@dataclass(frozen=True)
class DirectInferenceResult:
    """Encapsulates detection outputs and extracted acoustic embeddings from a single forward pass."""

    detections: List[ModelDetectionOutput]
    embedding: np.ndarray  # shape (1280,), dtype float32
    raw_scores: np.ndarray  # shape (11725,), dtype float32
    inference_duration_s: float

    @property
    def inference_time_ms(self) -> float:
        return self.inference_duration_s * 1000.0


class DirectOnnxEngine:
    """Persistent ONNX Runtime engine executing real-time BirdNET V3.0 inference."""

    def __init__(
        self,
        *,
        precision: str = "fp32",
        prefer_gpu: bool = True,
        model_path: Optional[Path] = None,
        labels_path: Optional[Path] = None,
        providers: Optional[List[str]] = None,
    ) -> None:
        if precision not in {"fp16", "fp32"}:
            raise ValueError("precision must be 'fp16' or 'fp32'")
        self.precision = precision
        self.prefer_gpu = prefer_gpu
        self._custom_model_path = Path(model_path) if model_path is not None else None
        self._custom_labels_path = Path(labels_path) if labels_path is not None else None
        self._custom_providers = list(providers) if providers is not None else None

        self._session: Optional[ort.InferenceSession] = None
        self._species_list: List[str] = []
        self._lock = threading.Lock()
        self._is_ready = False

        self.device = "CPU"
        self.active_providers: List[str] = []
        self.provider_fallback_reason: Optional[str] = None
        self.model_path: Optional[Path] = None
        self.load_duration_s: Optional[float] = None
        self.model_version = "3.0"

    @property
    def is_ready(self) -> bool:
        return self._is_ready

    @property
    def species_list(self) -> List[str]:
        return self._species_list

    def validate_offline_model_cache(self) -> Tuple[Path, Path]:
        """Verify that offline model weights and label dictionary exist in the local cache.

        Prevents automatic network downloads.
        Returns (model_file_path, labels_file_path).
        """
        if self._custom_model_path is not None:
            if not self._custom_model_path.is_file():
                raise FileNotFoundError(
                    f"Direct ONNX model artifact not found: {self._custom_model_path}"
                )
            model_file = self._custom_model_path
        else:
            _ensure_model_cache_env()
            app_data = os.environ.get("BIRDNET_APP_DATA")
            candidates = [
                Path(app_data) if app_data else None,
                Path(__file__).resolve().parents[2] / ".model_cache",
                Path.cwd() / ".model_cache",
            ]
            valid_dir: Optional[Path] = None
            for cand in candidates:
                if cand and cand.is_dir():
                    valid_dir = cand
                    break

            if not valid_dir:
                raise BirdNetEngineError(
                    "Local model cache directory was not found. Automatic download is prohibited. "
                    "Ensure .model_cache directory is provisioned."
                )

            onnx_dir = valid_dir / "acoustic-models" / "v3.0" / "onnx"
            model_candidates = (
                list(onnx_dir.glob(f"model-{self.precision}*.onnx"))
                if onnx_dir.is_dir()
                else []
            )
            if not model_candidates:
                raise BirdNetEngineError(
                    f"BirdNET acoustic V3.0 ONNX {self.precision} model weights not found in {onnx_dir}."
                )
            model_file = model_candidates[0]
            if model_file.stat().st_size < 100_000_000:
                raise BirdNetEngineError(f"Model file {model_file} appears corrupted (size < 100MB).")

        if self._custom_labels_path is not None:
            if not self._custom_labels_path.is_file():
                raise FileNotFoundError(
                    f"Direct ONNX taxonomy labels file not found: {self._custom_labels_path}"
                )
            labels_file = self._custom_labels_path
        else:
            labels_file = onnx_dir / "labels" / "en_us.txt"
            if not labels_file.is_file():
                labels_raw = valid_dir / "acoustic-models" / "v3.0" / "labels_raw-88d976477fac.csv"
                if not labels_raw.is_file():
                    raise BirdNetEngineError(f"Species labels file not found in {onnx_dir / 'labels'}.")

        return model_file, labels_file

    def _load_species_labels(self, labels_file: Path) -> List[str]:
        """Load and validate the 11,725 species class labels."""
        if labels_file.is_file():
            with open(labels_file, "r", encoding="utf-8") as f:
                labels = [line.strip() for line in f if line.strip()]
            if len(labels) == EXPECTED_CLASS_COUNT:
                return labels

        # Fallback to loading via birdnet metadata if custom format
        import birdnet

        model = birdnet.load("acoustic", "3.0", "onnx", precision=self.precision)
        labels = list(model.species_list)
        if len(labels) != EXPECTED_CLASS_COUNT:
            raise BirdNetEngineError(
                f"Unexpected species count {len(labels)}; expected {EXPECTED_CLASS_COUNT}."
            )
        return labels

    def load(self) -> None:
        """Initialize the persistent ONNX Runtime inference session with CUDA and CPU fallback."""
        if self._session is not None and self._is_ready:
            return

        with self._lock:
            if self._session is not None and self._is_ready:
                return

            t_start = time.perf_counter()
            model_file, labels_file = self.validate_offline_model_cache()
            self.model_path = model_file

            # Load species taxonomy labels
            self._species_list = self._load_species_labels(labels_file)

            # Ensure Windows CUDA DLL paths are in PATH
            _prepare_windows_cuda_dll_path()
            preload_dlls = getattr(ort, "preload_dlls", None)
            if preload_dlls is not None:
                preload_dlls(directory="")

            sess_options = ort.SessionOptions()
            sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            sess_options.log_severity_level = 3  # Warnings and errors only

            if self._custom_providers is not None:
                providers_to_try = list(self._custom_providers)
            else:
                available_providers = ort.get_available_providers()
                providers_to_try = []
                if self.prefer_gpu and "CUDAExecutionProvider" in available_providers:
                    providers_to_try.append("CUDAExecutionProvider")
                providers_to_try.append("CPUExecutionProvider")

            session: Optional[ort.InferenceSession] = None
            cuda_success = False

            if "CUDAExecutionProvider" in providers_to_try:
                try:
                    logger.info("Attempting to initialize ONNX Runtime session with CUDAExecutionProvider...")
                    session = ort.InferenceSession(
                        str(model_file),
                        sess_options=sess_options,
                        providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
                    )
                    active = session.get_providers()
                    if "CUDAExecutionProvider" in active:
                        # Warm up CUDA kernel with small Gaussian noise to verify DLL / kernel readiness
                        warmup_tensor = (
                            np.random.RandomState(42)
                            .randn(1, EXPECTED_SEGMENT_SAMPLES)
                            .astype(np.float32)
                            * 1e-3
                        )
                        session.run(["predictions", "embeddings"], {"input": warmup_tensor})
                        self.device = "GPU"
                        self.active_providers = active
                        cuda_success = True
                        logger.info("Direct ONNX Runtime initialized successfully on GPU (CUDAExecutionProvider).")
                except Exception as exc:
                    logger.warning(
                        "CUDAExecutionProvider initialization or warmup failed (%s: %s); falling back to CPU.",
                        type(exc).__name__,
                        exc,
                    )
                    self.provider_fallback_reason = f"{type(exc).__name__}: {exc}"
                    session = None

            if not cuda_success:
                logger.info("Initializing ONNX Runtime session on CPUExecutionProvider...")
                session = ort.InferenceSession(
                    str(model_file),
                    sess_options=sess_options,
                    providers=["CPUExecutionProvider"],
                )
                self.device = "CPU"
                self.active_providers = session.get_providers()
                logger.info("Direct ONNX Runtime initialized successfully on CPU (CPUExecutionProvider).")

            # Validate model inputs and outputs
            input_names = [inp.name for inp in session.get_inputs()]
            if "input" not in input_names:
                raise BirdNetEngineError(f"Model input 'input' not found in model inputs: {input_names}")

            output_names = [out.name for out in session.get_outputs()]
            if "predictions" not in output_names or "embeddings" not in output_names:
                raise BirdNetEngineError(
                    f"Required outputs 'predictions' and 'embeddings' not found in: {output_names}"
                )

            self._session = session
            self._is_ready = True
            self.load_duration_s = time.perf_counter() - t_start

    def infer(
        self,
        audio_data: np.ndarray,
        min_confidence: float = 0.10,
        top_k: int = 5,
    ) -> DirectInferenceResult:
        """Run single-pass inference on raw 32 kHz audio samples.

        Accepts in-memory float32 samples, pads or truncates to 96,000 samples,
        and returns structured detections and normalized 1,280-D embeddings.
        """
        if self._session is None or not self._is_ready:
            self.load()

        if audio_data is None:
            raise AudioValidationError("Audio data is empty or None.")

        audio = np.asarray(audio_data, dtype=np.float32)
        if audio.ndim != 1:
            raise AudioValidationError(f"Expected 1D float32 audio array, got shape {audio.shape}.")

        if len(audio) == 0:
            raise AudioValidationError("Audio data is empty or None.")

        if len(audio) < 3200:
            raise AudioValidationError(f"Audio duration too short: {len(audio)} samples (minimum 3200 samples).")

        if not np.isfinite(audio).all():
            raise AudioValidationError("Audio data contains non-finite samples (NaN or Inf).")

        if float(np.ptp(audio)) == 0.0:
            raise AudioValidationError(
                "Audio has zero variance (digital silence or constant-valued input)."
            )

        # Standardize to exactly 96,000 samples (3.0s @ 32 kHz)
        if len(audio) < EXPECTED_SEGMENT_SAMPLES:
            audio = np.pad(audio, (0, EXPECTED_SEGMENT_SAMPLES - len(audio)))
        elif len(audio) > EXPECTED_SEGMENT_SAMPLES:
            audio = audio[:EXPECTED_SEGMENT_SAMPLES]

        input_tensor = np.expand_dims(audio, axis=0)  # (1, 96000)

        t_infer_start = time.perf_counter()
        with self._lock:
            if self._session is None:
                raise BirdNetEngineError("ONNX session is not active.")
            preds, embs = self._session.run(
                ["predictions", "embeddings"],
                {"input": input_tensor},
            )
        inference_duration_s = time.perf_counter() - t_infer_start

        scores = preds[0]  # shape (11725,)
        embedding = embs[0].astype(np.float32)  # shape (1280,)

        # Validate embedding
        if embedding.shape != (EXPECTED_EMBEDDING_DIM,) or not np.isfinite(embedding).all():
            raise BirdNetEngineError(
                f"Direct ONNX produced invalid embedding: shape={embedding.shape}, finite={np.isfinite(embedding).all()}"
            )

        # Extract Top-K species detections
        if top_k is not None and top_k > 0:
            top_indices = np.argsort(scores)[-top_k:][::-1]
        else:
            top_indices = np.argsort(scores)[::-1]

        detections: List[ModelDetectionOutput] = []
        for idx in top_indices:
            score = float(scores[idx])
            if score < min_confidence:
                continue

            label = self._species_list[idx]
            if label in NON_ANIMAL_SOUND_CLASSES:
                scientific, common, group, record_type = (
                    "Unknown",
                    label.split("_", 1)[-1],
                    None,
                    "sound_class",
                )
            elif "_" in label:
                parts = label.split("_", 1)
                scientific, common = parts[0].strip(), parts[1].strip()
                if not scientific or not common:
                    scientific, common, group, record_type = "Unknown", label, "Unknown", "animal"
                else:
                    group, record_type = "Unknown", "animal"
            else:
                scientific, common, group, record_type = "Unknown", label, "Unknown", "animal"

            detections.append(
                ModelDetectionOutput(
                    class_label=label,
                    scientific_name=scientific,
                    common_name=common,
                    taxon_group=group,
                    record_type=record_type,
                    start_seconds=0.0,
                    end_seconds=3.0,
                    confidence_score=score,
                )
            )

        return DirectInferenceResult(
            detections=detections,
            embedding=embedding,
            raw_scores=scores,
            inference_duration_s=inference_duration_s,
        )

    def close(self) -> None:
        """Release session resources."""
        with self._lock:
            self._session = None
            self._is_ready = False
            logger.info("Direct ONNX Runtime engine session closed.")

    def get_status(self) -> dict[str, Any]:
        """Return diagnostic health and hardware status."""
        return {
            "is_ready": self._is_ready,
            "device": self.device,
            "active_providers": self.active_providers,
            "model_path": str(self.model_path) if self.model_path else None,
            "model_version": self.model_version,
            "class_count": len(self._species_list),
            "embedding_dimensions": EXPECTED_EMBEDDING_DIM,
            "sample_rate_hz": EXPECTED_SAMPLE_RATE,
            "segment_size_s": 3.0,
            "segment_size_samples": EXPECTED_SEGMENT_SAMPLES,
            "provider_fallback_reason": self.provider_fallback_reason,
            "load_duration_s": self.load_duration_s,
        }


# Global Direct ONNX engine singleton for live audio streaming
direct_onnx_engine = DirectOnnxEngine(
    precision="fp32",
    prefer_gpu=settings.MODEL_PREFER_GPU,
)
