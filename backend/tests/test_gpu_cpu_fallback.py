"""GPU and CPU fallback execution audit for EcoSonic 2.0.

Verifies:
- Hardware detection (CUDA availability)
- Successful inference when prefer_gpu=False (CPU fallback)
- Logging and telemetry of active execution provider
"""

from __future__ import annotations

import os
from pathlib import Path
import pytest

from app.services.birdnet_engine import BirdNetEngine


@pytest.mark.real_model
def test_birdnet_cpu_fallback_execution():
    """Verify that forcing CPU execution succeeds when GPU is disabled."""
    engine = BirdNetEngine(precision="fp32", prefer_gpu=False)
    engine.load()

    assert engine.device == "CPU"
    meta = engine.inspect()
    assert meta["requested_device"] == "CPU"

    audio_path = Path(__file__).resolve().parents[1] / "data" / "smoke_audio" / "birds_forest.ogg"
    assert audio_path.exists()

    # Predict on CPU
    preds = engine.predict(audio_path)
    assert len(preds) > 0
    assert "species_name" in preds.columns
    assert "confidence" in preds.columns

    # Encode on CPU
    embeddings = engine.encode(audio_path)
    assert embeddings.vectors.shape[1] == 1280
    assert embeddings.vectors.dtype.name == "float32"


@pytest.mark.real_model
def test_birdnet_gpu_execution_when_available():
    """Verify GPU execution when prefer_gpu=True on host with NVIDIA GPU."""
    engine = BirdNetEngine(precision="fp32", prefer_gpu=True)
    engine.load()

    # On this workstation (RTX 4060), device should be GPU
    assert engine.device == "GPU"
    meta = engine.inspect()
    assert meta["requested_device"] == "GPU"
    assert "CUDAExecutionProvider" in meta["execution_providers"]

    audio_path = Path(__file__).resolve().parents[1] / "data" / "smoke_audio" / "birds_forest.ogg"
    preds = engine.predict(audio_path)
    assert len(preds) > 0
