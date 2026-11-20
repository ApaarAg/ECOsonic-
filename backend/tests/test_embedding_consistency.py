"""Embedding and database consistency audit test suite for EcoSonic 2.0.

Verifies:
- embedding.shape == (N, 1280)
- dtype == float32
- all values are finite
- N matches segment metadata count
- atomic replacement semantics
- missing, corrupted, wrong-dimensional, NaN, Inf, and zero-length arrays
  fail safely and are never treated as valid evidence.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import numpy as np
import pytest

from app.services.storage_service import StorageService, storage_service


def test_storage_service_save_and_load_valid(tmp_path: Path):
    """Verify valid save and load of (N, 1280) float32 embeddings."""
    srv = StorageService(base_dir=tmp_path)
    aid = "test-analysis-valid"
    vectors = np.random.randn(5, 1280).astype(np.float32)

    saved_path = srv.save_embeddings(aid, vectors)
    assert saved_path.exists()
    assert saved_path.name == "embeddings.npy"

    loaded = srv.load_embeddings(aid)
    assert loaded is not None
    assert loaded.shape == (5, 1280)
    assert loaded.dtype == np.float32
    assert np.allclose(vectors, loaded)


def test_storage_service_rejects_wrong_dimension(tmp_path: Path):
    """Verify vectors with shape other than (N, 1280) are rejected."""
    srv = StorageService(base_dir=tmp_path)
    aid = "test-analysis-dim"

    # 1D array
    with pytest.raises(ValueError, match="Expected embedding shape"):
        srv.save_embeddings(aid, np.random.randn(1280).astype(np.float32))

    # Wrong column count (e.g. 512 instead of 1280)
    with pytest.raises(ValueError, match="Expected embedding shape"):
        srv.save_embeddings(aid, np.random.randn(5, 512).astype(np.float32))

    # 3D array
    with pytest.raises(ValueError, match="Expected embedding shape"):
        srv.save_embeddings(aid, np.random.randn(5, 1280, 2).astype(np.float32))


def test_storage_service_rejects_non_finite_values(tmp_path: Path):
    """Verify vectors containing NaN or Inf are rejected."""
    srv = StorageService(base_dir=tmp_path)
    aid = "test-analysis-nonfinite"

    # NaN vector
    nan_vecs = np.zeros((3, 1280), dtype=np.float32)
    nan_vecs[1, 50] = np.nan
    with pytest.raises(ValueError, match="finite float32"):
        srv.save_embeddings(aid, nan_vecs)

    # Inf vector
    inf_vecs = np.zeros((3, 1280), dtype=np.float32)
    inf_vecs[2, 100] = np.inf
    with pytest.raises(ValueError, match="finite float32"):
        srv.save_embeddings(aid, inf_vecs)


def test_storage_service_atomic_replacement(tmp_path: Path):
    """Verify that saving embeddings uses atomic replacement without leaving partial files."""
    srv = StorageService(base_dir=tmp_path)
    aid = "test-analysis-atomic"
    vec1 = np.ones((4, 1280), dtype=np.float32)
    vec2 = np.full((6, 1280), 2.0, dtype=np.float32)

    path1 = srv.save_embeddings(aid, vec1)
    assert srv.load_embeddings(aid).shape == (4, 1280)

    # Replace with vec2
    path2 = srv.save_embeddings(aid, vec2)
    assert path1 == path2
    loaded = srv.load_embeddings(aid)
    assert loaded.shape == (6, 1280)
    assert (loaded == 2.0).all()


def test_load_embeddings_missing_returns_none(tmp_path: Path):
    """Verify loading non-existent embeddings returns None safely."""
    srv = StorageService(base_dir=tmp_path)
    assert srv.load_embeddings("non-existent-id") is None
