"""Adapter for the official BirdNET acoustic V3.0 model."""

from __future__ import annotations

import hashlib
import logging
import math
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf


def _prepare_windows_cuda_dll_path() -> None:
    """Expose NVIDIA wheel DLL folders to BirdNET's spawned worker processes."""
    if os.name != "nt":
        return
    nvidia_root = Path(sys.prefix) / "Lib" / "site-packages" / "nvidia"
    if not nvidia_root.is_dir():
        return
    dll_dirs = [str(path) for path in sorted(nvidia_root.glob("*/bin")) if path.is_dir()]
    existing = os.environ.get("PATH", "").split(os.pathsep)
    existing_norm = {os.path.normcase(path) for path in existing if path}
    additions = [path for path in dll_dirs if os.path.normcase(path) not in existing_norm]
    if additions:
        # BirdNET runs ONNX inference in spawned processes. AddDllDirectory handles
        # loaded in this process are not inherited on Windows, while PATH is.
        os.environ["PATH"] = os.pathsep.join([*additions, *existing])

def _ensure_model_cache_env() -> None:
    """Ensure BIRDNET_APP_DATA points to project .model_cache if not explicitly set."""
    if os.environ.get("BIRDNET_APP_DATA"):
        return
    for candidate in [
        Path(__file__).resolve().parents[3] / ".model_cache",
        Path.cwd() / ".model_cache",
    ]:
        if candidate.is_dir():
            os.environ["BIRDNET_APP_DATA"] = str(candidate.resolve())
            break

_ensure_model_cache_env()

try:
    import onnxruntime as ort
except ImportError:  # pragma: no cover - reported by load() with a useful message
    ort = None  # type: ignore[assignment]
else:
    # CUDA/cuDNN supplied as NVIDIA Python packages are not necessarily on PATH
    # on Windows. Keep the wheel DLL directories available to spawned workers,
    # then use ORT's loader for this process too.
    _prepare_windows_cuda_dll_path()
    preload_dlls = getattr(ort, "preload_dlls", None)
    if preload_dlls is not None:
        preload_dlls(directory="")

import birdnet

logger = logging.getLogger(__name__)

PREDICTION_COLUMNS = ("input", "start_time", "end_time", "species_name", "confidence")
EMBEDDING_COLUMNS = ("input", "start_time", "end_time")
MIN_AUDIO_DURATION_S = 0.1


class BirdNetEngineError(RuntimeError):
    """Raised when BirdNET cannot load or return a valid model result."""


class AudioValidationError(ValueError):
    """Raised when an audio file is not safe to send to the acoustic model."""


@dataclass(frozen=True)
class EmbeddingBatch:
    """Embedding vectors aligned with their BirdNET segment time ranges."""

    vectors: np.ndarray
    segments: pd.DataFrame


class BirdNetEngine:
    """Load and reuse the official BirdNET acoustic V3.0 ONNX model."""

    def __init__(
        self,
        *,
        precision: str = "fp32",
        prefer_gpu: bool = True,
    ) -> None:
        if precision not in {"fp16", "fp32"}:
            raise ValueError("precision must be 'fp16' or 'fp32'")
        self.precision = precision
        self.prefer_gpu = prefer_gpu
        self.model: Any | None = None
        self.load_duration_s: float | None = None
        self.device = "CPU"
        self.provider_fallback_reason: str | None = None

    def validate_offline_model_cache(self) -> Path:
        """Verifies that the required BirdNET model weights exist in the local cache.

        Raises BirdNetEngineError immediately if the artifact is missing, preventing
        silent, unbounded 345 MB network downloads during application startup or tests.
        """
        _ensure_model_cache_env()
        app_data = os.environ.get("BIRDNET_APP_DATA")
        if not app_data or not Path(app_data).is_dir():
            raise BirdNetEngineError(
                f"BIRDNET_APP_DATA environment variable is not configured or does not point to a valid directory: '{app_data}'. "
                "Automatic online model download is prohibited. "
                "Please configure BIRDNET_APP_DATA to point to the local .model_cache directory."
            )
        cache_path = Path(app_data)
        onnx_model_dir = cache_path / "acoustic-models" / "v3.0" / "onnx"
        model_candidates = (
            list(onnx_model_dir.glob(f"model-{self.precision}*.onnx"))
            if onnx_model_dir.is_dir()
            else []
        )
        if not model_candidates:
            raise BirdNetEngineError(
                f"Required BirdNET acoustic V3.0 ONNX {self.precision} model artifact was not found in cache: {onnx_model_dir}. "
                "Automatic network download is disabled to prevent process hangs. "
                "Please provision model artifacts in the local cache before starting the engine."
            )
        model_file = model_candidates[0]
        if model_file.stat().st_size < 100_000_000:
            raise BirdNetEngineError(
                f"Model artifact {model_file} is smaller than expected ({model_file.stat().st_size} bytes). Corrupted cache."
            )
        return model_file

    def load(self) -> None:
        """Load the acoustic V3.0 model once and select an available provider."""
        if self.model is not None:
            return
        if ort is None:
            raise BirdNetEngineError(
                "ONNX Runtime is not installed. Install the CPU package or the "
                "CUDA-compatible onnxruntime-gpu package."
            )

        # Enforce offline model cache check before calling birdnet.load()
        self.validate_offline_model_cache()

        providers = ort.get_available_providers()
        if "CPUExecutionProvider" not in providers:
            raise BirdNetEngineError(
                f"ONNX Runtime has no CPU fallback provider: {providers}"
            )
        self.device = (
            "GPU"
            if self.prefer_gpu and "CUDAExecutionProvider" in providers
            else "CPU"
        )

        import time

        started = time.perf_counter()
        try:
            self.model = birdnet.load(
                "acoustic", "3.0", "onnx", precision=self.precision
            )
        except Exception as exc:
            raise BirdNetEngineError(
                "Could not load BirdNET acoustic V3.0 with the ONNX backend."
            ) from exc
        self.load_duration_s = time.perf_counter() - started
        logger.info(
            "Loaded BirdNET %s ONNX (%s precision); inference device=%s",
            self.model.get_version(),
            self.precision,
            self.device,
        )

    def predict(self, audio_path: str | Path) -> pd.DataFrame:
        """Run inference and return normalized per-segment prediction rows."""
        import pandas as pd

        path, duration_s = self._validate_audio(audio_path)
        model = self._require_model()
        try:
            raw_result = self._run_with_provider_fallback(
                "prediction",
                lambda: model.predict(
                    str(path),
                    top_k=5,
                    n_workers=1,
                    batch_size=1,
                    device=self.device,
                    default_confidence_threshold=0.0,
                ),
            )
            raw_frame = raw_result.to_dataframe()
        except BirdNetEngineError:
            raise
        except Exception as exc:
            raise BirdNetEngineError(f"BirdNET prediction failed for {path}.") from exc

        missing = set(PREDICTION_COLUMNS).difference(raw_frame.columns)
        if missing:
            raise BirdNetEngineError(
                f"BirdNET prediction result is missing columns: {sorted(missing)}"
            )
        raw_schema = {
            "columns": list(raw_frame.columns),
            "dtypes": {column: str(dtype) for column, dtype in raw_frame.dtypes.items()},
        }
        predictions = raw_frame.loc[:, PREDICTION_COLUMNS].copy()
        predictions.attrs["birdnet_raw_output_schema"] = raw_schema
        predictions["input"] = predictions["input"].astype(str)
        predictions["start_time"] = pd.to_numeric(
            predictions["start_time"], errors="raise"
        )
        predictions["end_time"] = pd.to_numeric(
            predictions["end_time"], errors="raise"
        )
        predictions["confidence"] = pd.to_numeric(
            predictions["confidence"], errors="raise"
        )
        self._validate_timestamps(predictions, duration_s, "predictions")
        if predictions.empty:
            raise BirdNetEngineError(f"BirdNET returned no prediction rows for {path}.")
        if not np.isfinite(predictions["confidence"].to_numpy(dtype=np.float64)).all():
            raise BirdNetEngineError(
                f"BirdNET returned non-finite prediction scores for {path}; results rejected."
            )
        if ((predictions["confidence"] < 0) | (predictions["confidence"] > 1)).any():
            raise BirdNetEngineError(
                f"BirdNET returned scores outside [0, 1] for {path}; results rejected."
            )
        return predictions

    def encode(self, audio_path: str | Path) -> EmbeddingBatch:
        """Extract finite embeddings and matching segment time metadata."""
        import pandas as pd

        path, duration_s = self._validate_audio(audio_path)
        model = self._require_model()
        try:
            raw_result = self._run_with_provider_fallback(
                "encoding",
                lambda: model.encode(
                    str(path), n_workers=1, batch_size=1, device=self.device
                ),
            )
            structured = raw_result.to_structured_array()
        except BirdNetEngineError:
            raise
        except Exception as exc:
            raise BirdNetEngineError(f"BirdNET encoding failed for {path}.") from exc

        if structured.dtype.names is None:
            raise BirdNetEngineError("BirdNET encoding result is not a structured array.")
        missing = set((*EMBEDDING_COLUMNS, "embedding")).difference(structured.dtype.names)
        if missing:
            raise BirdNetEngineError(
                f"BirdNET encoding result is missing fields: {sorted(missing)}"
            )
        vectors = np.asarray(structured["embedding"])
        segments = pd.DataFrame(
            {
                "input": structured["input"].astype(str),
                "start_time": structured["start_time"],
                "end_time": structured["end_time"],
            }
        )
        self._validate_timestamps(segments, duration_s, "embeddings")
        if vectors.ndim != 2 or vectors.shape[0] != len(segments):
            raise BirdNetEngineError(
                f"Unexpected embedding array shape {vectors.shape} for {len(segments)} segments."
            )
        expected_dim = int(model.get_embeddings_dim())
        if vectors.shape[1] != expected_dim:
            raise BirdNetEngineError(
                f"Embedding dimension {vectors.shape[1]} does not match model metadata {expected_dim}."
            )
        if not np.isfinite(vectors).all():
            bad_count = int(vectors.size - np.isfinite(vectors).sum())
            raise BirdNetEngineError(
                f"BirdNET returned {bad_count} non-finite embedding values for {path}; results rejected."
            )
        if vectors.shape[0] == 0:
            raise BirdNetEngineError(f"BirdNET returned no embeddings for {path}.")
        return EmbeddingBatch(vectors=vectors, segments=segments)

    def inspect(self) -> dict[str, Any]:
        """Return metadata from the loaded model and active ONNX Runtime."""
        model = self._require_model()
        path = Path(model.model_path)
        class_count = len(model.species_list)
        declared_count = int(model.get_n_classes())
        if class_count != declared_count:
            raise BirdNetEngineError(
                f"Loaded label count {class_count} differs from model class count {declared_count}."
            )
        from birdnet.acoustic.models.v3_0.onnx import models as onnx_model_catalog

        model_info = onnx_model_catalog[self.precision]
        actual_sha256 = self._sha256(path)
        if actual_sha256 != model_info.sha256:
            raise BirdNetEngineError(
                "The cached ONNX model checksum does not match the official "
                f"BirdNET package catalog: {actual_sha256} != {model_info.sha256}"
            )
        return {
            "model_family": "BirdNET acoustic",
            "model_version": str(model.get_version()),
            "model_path": str(path),
            "model_filename": path.name,
            "model_precision": self.precision,
            "model_backend": "onnx",
            "model_sha256": actual_sha256,
            "model_download_url": model_info.dl_url,
            "model_catalog_sha256": model_info.sha256,
            "model_catalog_filename": model_info.dl_file_name,
            "class_count": class_count,
            "embedding_dimensions": int(model.get_embeddings_dim()),
            "sample_rate_hz": int(model.get_sample_rate()),
            "segment_size_s": float(model.get_segment_size_s()),
            "first_labels": list(model.species_list)[:5],
            "runtime_version": str(ort.__version__) if ort is not None else None,
            "execution_providers": (
                list(ort.get_available_providers()) if ort is not None else []
            ),
            "requested_device": self.device,
            "provider_fallback_reason": self.provider_fallback_reason,
            "load_duration_s": self.load_duration_s,
        }

    def validate_output(
        self,
        predictions: pd.DataFrame,
        embeddings: EmbeddingBatch,
    ) -> dict[str, Any]:
        """Validate schemas, timestamp ranges, segment alignment and finite values."""
        model = self._require_model()
        if set(PREDICTION_COLUMNS).difference(predictions.columns):
            raise BirdNetEngineError("Normalized prediction schema is incomplete.")
        if not np.isfinite(predictions["confidence"].to_numpy(dtype=np.float64)).all():
            raise BirdNetEngineError("Prediction output contains NaN or infinite scores.")
        if not np.isfinite(embeddings.vectors).all():
            raise BirdNetEngineError("Embedding output contains NaN or infinite values.")
        if embeddings.vectors.shape[1] != int(model.get_embeddings_dim()):
            raise BirdNetEngineError("Embedding output dimension is inconsistent with the model.")

        prediction_segments = predictions[["start_time", "end_time"]].drop_duplicates()
        embedding_segments = embeddings.segments[["start_time", "end_time"]].drop_duplicates()
        pred_keys = {
            (round(float(row.start_time), 6), round(float(row.end_time), 6))
            for row in prediction_segments.itertuples(index=False)
        }
        emb_keys = {
            (round(float(row.start_time), 6), round(float(row.end_time), 6))
            for row in embedding_segments.itertuples(index=False)
        }
        if pred_keys != emb_keys:
            raise BirdNetEngineError(
                "Prediction timestamps and embedding segment timestamps do not align."
            )
        return {
            "prediction_rows": int(len(predictions)),
            "birdnet_raw_output_schema": predictions.attrs.get(
                "birdnet_raw_output_schema", {}
            ),
            "prediction_columns": list(predictions.columns),
            "prediction_dtypes": {
                column: str(dtype) for column, dtype in predictions.dtypes.items()
            },
            "segment_count": int(len(embeddings.segments)),
            "embedding_shape": list(embeddings.vectors.shape),
            "embedding_dtype": str(embeddings.vectors.dtype),
            "embedding_non_finite_count": int(
                embeddings.vectors.size - np.isfinite(embeddings.vectors).sum()
            ),
            "segment_times_aligned": True,
        }

    def _require_model(self) -> Any:
        if self.model is None:
            raise BirdNetEngineError("BirdNET is not loaded. Call load() first.")
        return self.model

    def _run_with_provider_fallback(self, operation: str, call: Any) -> Any:
        """Retry on CPU once if the configured CUDA provider cannot run a call."""
        try:
            return call()
        except Exception as exc:
            if self.device != "GPU":
                raise BirdNetEngineError(
                    f"BirdNET {operation} failed on the CPU ONNX provider."
                ) from exc
            self.provider_fallback_reason = f"{type(exc).__name__}: {exc}"
            logger.warning(
                "BirdNET %s failed with CUDA; retrying with CPU ONNX provider: %s",
                operation,
                exc,
            )
            self.device = "CPU"
            try:
                return call()
            except Exception as cpu_exc:
                raise BirdNetEngineError(
                    f"BirdNET {operation} failed on CUDA and the CPU fallback."
                ) from cpu_exc

    @staticmethod
    def _validate_audio(audio_path: str | Path) -> tuple[Path, float]:
        path = Path(audio_path).expanduser().resolve()
        if not path.is_file():
            raise AudioValidationError(f"Audio file does not exist: {path}")
        try:
            info = sf.info(path)
            audio, _sample_rate = sf.read(path, dtype="float32", always_2d=False)
        except Exception as exc:
            raise AudioValidationError(f"Could not read audio file {path}.") from exc
        duration_s = float(info.duration)
        if not math.isfinite(duration_s) or duration_s < MIN_AUDIO_DURATION_S:
            raise AudioValidationError(
                f"Audio is too short ({duration_s:.6f}s); minimum is {MIN_AUDIO_DURATION_S:.3f}s."
            )
        if info.samplerate <= 0 or info.channels <= 0:
            raise AudioValidationError(f"Audio metadata is invalid for {path}.")
        if audio.size == 0 or not np.isfinite(audio).all():
            raise AudioValidationError(f"Audio contains no samples or non-finite samples: {path}")
        if float(np.ptp(audio)) == 0.0:
            raise AudioValidationError(
                f"Audio has zero variance (digital silence or constant-valued input): {path}"
            )
        return path, duration_s

    @staticmethod
    def _validate_timestamps(
        frame: pd.DataFrame, duration_s: float, label: str
    ) -> None:
        if frame.empty:
            return
        starts = frame["start_time"].to_numpy(dtype=np.float64)
        ends = frame["end_time"].to_numpy(dtype=np.float64)
        if not np.isfinite(starts).all() or not np.isfinite(ends).all():
            raise BirdNetEngineError(f"{label} contain non-finite timestamps.")
        if (starts < 0).any() or (ends <= starts).any():
            raise BirdNetEngineError(f"{label} contain invalid timestamp ranges.")
        if (ends > duration_s + 0.05).any():
            raise BirdNetEngineError(
                f"{label} end after the recording duration ({duration_s:.3f}s)."
            )

    @staticmethod
    def _sha256(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(block)
        return digest.hexdigest()

