"""Automated numerical parity and robustness validation between BirdNET API and Direct ONNX Engine."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import List, Tuple

import numpy as np
import pytest
import soundfile as sf

from app.services.analysis_pipeline import NON_ANIMAL_SOUND_CLASSES
from app.services.audio_processor import audio_processor
from app.services.birdnet_engine import (
    AudioValidationError,
    BirdNetEngine,
    _ensure_model_cache_env,
    _prepare_windows_cuda_dll_path,
)
from app.services.direct_onnx_engine import DirectOnnxEngine

_ensure_model_cache_env()
_prepare_windows_cuda_dll_path()

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SMOKE_DIR = PROJECT_ROOT / "backend" / "data" / "smoke_audio"
RECORDINGS = [
    SMOKE_DIR / "birds_forest.ogg",
    SMOKE_DIR / "birds_garden.ogg",
    SMOKE_DIR / "cicada_orni.ogg",
    SMOKE_DIR / "frog_mixed.ogg",
]


def load_normalized_window(path: Path) -> Tuple[np.ndarray, int]:
    """Extract exactly 3.0 seconds (96,000 samples @ 32 kHz mono float32)."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
        temp_wav = Path(tf.name)
    try:
        audio_processor.convert_to_mono_wav(path, temp_wav, target_sr=32000)
        data, sr = sf.read(str(temp_wav), dtype="float32")
        if data.ndim > 1:
            data = data.mean(axis=1)
        if len(data) < 96000:
            data = np.pad(data, (0, 96000 - len(data)))
        else:
            data = data[:96000]
        return data.astype(np.float32), sr
    finally:
        if temp_wav.exists():
            temp_wav.unlink()


@pytest.mark.real_model
class TestDirectOnnxParity:
    """Rigorous mathematical parity tests between official BirdNET API and Direct ONNX."""

    def test_parity_across_environmental_recordings_gpu(self):
        """Compare GPU inference predictions and embeddings across all 4 smoke soundscapes."""
        engine = BirdNetEngine(precision="fp32", prefer_gpu=True)
        engine.load()

        direct_engine = DirectOnnxEngine(precision="fp32", prefer_gpu=True)
        direct_engine.load()

        for rec_path in RECORDINGS:
            samples_3s, sr = load_normalized_window(rec_path)

            # Write temporary WAV for official BirdNET API
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
                temp_wav = Path(tf.name)
            try:
                sf.write(str(temp_wav), samples_3s, sr)
                birdnet_preds = engine.predict(str(temp_wav))
                birdnet_emb = engine.encode(str(temp_wav))
            finally:
                if temp_wav.exists():
                    temp_wav.unlink()

            # Direct ONNX execution
            direct_res = direct_engine.infer(samples_3s, min_confidence=0.0, top_k=5)

            # 1. Output shape & dimension validation
            assert direct_res.raw_scores.shape == (11725,)
            assert direct_res.embedding.shape == (1280,)
            assert len(direct_res.detections) == 5

            # 2. Top-5 labels parity
            birdnet_top5_labels = list(birdnet_preds.head(5)["species_name"])
            direct_top5_labels = [d.class_label for d in direct_res.detections]
            assert direct_top5_labels == birdnet_top5_labels, (
                f"Mismatch in {rec_path.name}: {direct_top5_labels} != {birdnet_top5_labels}"
            )

            # 3. Top-5 scores parity (tight numerical tolerance)
            birdnet_top5_scores = list(birdnet_preds.head(5)["confidence"])
            for d_det, b_score in zip(direct_res.detections, birdnet_top5_scores):
                assert abs(d_det.confidence_score - b_score) < 1e-4, (
                    f"Score diff in {rec_path.name} for {d_det.class_label}: "
                    f"{d_det.confidence_score} vs {b_score}"
                )

            # 4. Embedding numerical equivalence
            b_vec = birdnet_emb.vectors[0]
            d_vec = direct_res.embedding
            assert np.isfinite(d_vec).all()

            cosine_sim = float(
                np.dot(d_vec, b_vec) / (np.linalg.norm(d_vec) * np.linalg.norm(b_vec))
            )
            assert cosine_sim > 0.9999, f"Low cosine similarity in {rec_path.name}: {cosine_sim}"

            max_abs_diff = float(np.max(np.abs(d_vec - b_vec)))
            assert max_abs_diff < 1e-3, f"Large embedding diff in {rec_path.name}: {max_abs_diff}"

        direct_engine.close()

    def test_parity_across_environmental_recordings_cpu(self):
        """Compare CPU inference predictions and embeddings across all 4 smoke soundscapes."""
        engine = BirdNetEngine(precision="fp32", prefer_gpu=False)
        engine.load()

        direct_engine = DirectOnnxEngine(precision="fp32", prefer_gpu=False)
        direct_engine.load()
        assert direct_engine.device == "CPU"

        for rec_path in RECORDINGS:
            samples_3s, sr = load_normalized_window(rec_path)

            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
                temp_wav = Path(tf.name)
            try:
                sf.write(str(temp_wav), samples_3s, sr)
                birdnet_preds = engine.predict(str(temp_wav))
                birdnet_emb = engine.encode(str(temp_wav))
            finally:
                if temp_wav.exists():
                    temp_wav.unlink()

            direct_res = direct_engine.infer(samples_3s, min_confidence=0.0, top_k=5)

            birdnet_top5_labels = list(birdnet_preds.head(5)["species_name"])
            direct_top5_labels = [d.class_label for d in direct_res.detections]
            assert direct_top5_labels == birdnet_top5_labels

            b_vec = birdnet_emb.vectors[0]
            d_vec = direct_res.embedding
            cosine_sim = float(
                np.dot(d_vec, b_vec) / (np.linalg.norm(d_vec) * np.linalg.norm(b_vec))
            )
            assert cosine_sim > 0.9999

        direct_engine.close()

    def test_synthetic_silence_and_zero_variance_rejection(self):
        """Ensure digital silence and flatline signals are rejected safely."""
        direct_engine = DirectOnnxEngine(precision="fp32", prefer_gpu=False)
        direct_engine.load()

        # All zeros
        zeros = np.zeros(96000, dtype=np.float32)
        with pytest.raises(AudioValidationError, match="zero variance"):
            direct_engine.infer(zeros)

        # Constant DC flatline
        constant = np.ones(96000, dtype=np.float32) * 0.25
        with pytest.raises(AudioValidationError, match="zero variance"):
            direct_engine.infer(constant)

        # Empty array
        with pytest.raises(AudioValidationError, match="empty or None"):
            direct_engine.infer(np.array([], dtype=np.float32))

        direct_engine.close()

    def test_synthetic_non_finite_rejection(self):
        """Ensure arrays with NaN or Inf are rejected safely."""
        direct_engine = DirectOnnxEngine(precision="fp32", prefer_gpu=False)
        direct_engine.load()

        # Array with NaN
        nan_audio = np.random.randn(96000).astype(np.float32)
        nan_audio[100] = np.nan
        with pytest.raises(AudioValidationError, match="non-finite"):
            direct_engine.infer(nan_audio)

        # Array with Inf
        inf_audio = np.random.randn(96000).astype(np.float32)
        inf_audio[500] = np.inf
        with pytest.raises(AudioValidationError, match="non-finite"):
            direct_engine.infer(inf_audio)

        direct_engine.close()

    def test_synthetic_quiet_and_clipping(self):
        """Verify quiet signals and clipped signals are processed with finite output."""
        direct_engine = DirectOnnxEngine(precision="fp32", prefer_gpu=False)
        direct_engine.load()

        # Very quiet sine wave
        t = np.linspace(0, 3.0, 96000, endpoint=False, dtype=np.float32)
        quiet_signal = (np.sin(2 * np.pi * 3000 * t) * 1e-4).astype(np.float32)
        res_quiet = direct_engine.infer(quiet_signal, min_confidence=0.0, top_k=5)
        assert np.isfinite(res_quiet.raw_scores).all()
        assert np.isfinite(res_quiet.embedding).all()
        assert res_quiet.embedding.shape == (1280,)

        # Hard-clipped signal (+1.0 and -1.0)
        clipped_signal = np.clip(np.sin(2 * np.pi * 1000 * t) * 5.0, -1.0, 1.0).astype(np.float32)
        res_clipped = direct_engine.infer(clipped_signal, min_confidence=0.0, top_k=5)
        assert np.isfinite(res_clipped.raw_scores).all()
        assert np.isfinite(res_clipped.embedding).all()

        direct_engine.close()

    def test_thresholding_and_top_k_behavior(self):
        """Verify confidence threshold and Top-K limiting filters behave as specified."""
        direct_engine = DirectOnnxEngine(precision="fp32", prefer_gpu=False)
        direct_engine.load()

        samples_3s, _ = load_normalized_window(RECORDINGS[0])

        # top_k = 3
        res_top3 = direct_engine.infer(samples_3s, min_confidence=0.0, top_k=3)
        assert len(res_top3.detections) == 3

        # top_k = 10
        res_top10 = direct_engine.infer(samples_3s, min_confidence=0.0, top_k=10)
        assert len(res_top10.detections) == 10

        # high confidence threshold (e.g. 0.99)
        res_high = direct_engine.infer(samples_3s, min_confidence=0.99, top_k=10)
        for det in res_high.detections:
            assert det.confidence_score >= 0.99

        direct_engine.close()

    def test_session_lifecycle_and_status(self):
        """Verify readiness, device status, and clean resource release."""
        engine = DirectOnnxEngine(precision="fp32", prefer_gpu=False)
        assert engine.is_ready is False

        engine.load()
        assert engine.is_ready is True
        status = engine.get_status()
        assert status["is_ready"] is True
        assert status["device"] == "CPU"
        assert status["class_count"] == 11725
        assert status["embedding_dimensions"] == 1280

        engine.close()
        assert engine.is_ready is False
