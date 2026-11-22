"""Unit and integration tests for Acoustic Memory Cosine Similarity Search."""

from __future__ import annotations

import time
import numpy as np
import pytest

from app.services.acoustic_memory.embedding_index import (
    EmbeddingIndexService,
    SegmentMetadata,
)
from app.services.acoustic_memory.similarity_service import (
    AcousticSimilarityService,
    SCIENTIFIC_DISCLAIMER,
)


def make_orthogonal_vectors(dim: int = 1280) -> tuple[np.ndarray, np.ndarray]:
    """Generate two perfectly orthogonal unit vectors."""
    v1 = np.zeros(dim, dtype=np.float32)
    v2 = np.zeros(dim, dtype=np.float32)
    v1[0] = 1.0
    v2[1] = 1.0
    return v1, v2


def test_similar_and_orthogonal_retrieval():
    index = EmbeddingIndexService()
    search = AcousticSimilarityService(index)

    v1, v2 = make_orthogonal_vectors(1280)
    # v1_perturb is almost identical to v1
    v1_perturb = v1.copy()
    v1_perturb[2] = 0.05
    v1_perturb = EmbeddingIndexService.normalize_vector(v1_perturb)

    index.add_vector("target-similar", v1_perturb)
    index.add_vector("target-orthogonal", v2)

    # Search with v1
    results = search.search(query_vector=v1, limit=5)
    assert len(results) == 2
    assert results[0].segment_id == "target-similar"
    assert results[0].similarity_score > 0.99
    assert results[1].segment_id == "target-orthogonal"
    assert pytest.approx(results[1].similarity_score, abs=1e-4) == 0.0
    assert results[0].disclaimer == SCIENTIFIC_DISCLAIMER


def test_query_segment_exclusion():
    index = EmbeddingIndexService()
    search = AcousticSimilarityService(index)

    v = np.zeros(1280, dtype=np.float32)
    v[10] = 1.0

    index.add_vector("seg-query", v)
    index.add_vector("seg-other", v)

    results = search.search(query_segment_id="seg-query", limit=5)
    result_ids = [r.segment_id for r in results]
    assert "seg-query" not in result_ids
    assert "seg-other" in result_ids


def test_same_session_exclusion():
    index = EmbeddingIndexService()
    search = AcousticSimilarityService(index)

    v = np.zeros(1280, dtype=np.float32)
    v[50] = 1.0

    index.add_vector("seg-1", v, SegmentMetadata("seg-1", session_id="sess-A"))
    index.add_vector("seg-2", v, SegmentMetadata("seg-2", session_id="sess-A"))
    index.add_vector("seg-3", v, SegmentMetadata("seg-3", session_id="sess-B"))

    # When exclude_same_session is True, seg-2 from sess-A must be excluded
    res = search.search(query_segment_id="seg-1", exclude_same_session=True)
    result_ids = [r.segment_id for r in res]
    assert "seg-2" not in result_ids
    assert "seg-3" in result_ids


def test_site_and_model_version_filtering():
    index = EmbeddingIndexService()
    search = AcousticSimilarityService(index)

    v = np.ones(1280, dtype=np.float32)

    index.add_vector(
        "seg-site-1",
        v,
        SegmentMetadata("seg-site-1", site_id="site-forest", model_version="BirdNET+ V3.0"),
    )
    index.add_vector(
        "seg-site-2",
        v,
        SegmentMetadata("seg-site-2", site_id="site-wetland", model_version="BirdNET+ V3.0"),
    )
    index.add_vector(
        "seg-old-model",
        v,
        SegmentMetadata("seg-old-model", site_id="site-forest", model_version="BirdNET V2.4"),
    )

    # Filter by site
    res_site = search.search(query_vector=v, site_id="site-wetland")
    assert len(res_site) == 1
    assert res_site[0].segment_id == "seg-site-2"

    # Filter by model version
    res_model = search.search(query_vector=v, model_version="BirdNET V2.4")
    assert len(res_model) == 1
    assert res_model[0].segment_id == "seg-old-model"


def test_search_benchmark_numpy_throughput():
    """Benchmark NumPy exact search latency on 1,000 and 10,000 vectors."""
    index = EmbeddingIndexService()
    search = AcousticSimilarityService(index)

    rng = np.random.default_rng(42)
    n_vectors = 5000
    batch = rng.standard_normal((n_vectors, 1280)).astype(np.float32)

    for i in range(n_vectors):
        index.add_vector(f"bench-vec-{i}", batch[i], check_duplicate=False)

    q = batch[0]
    t0 = time.perf_counter()
    results = search.search(query_vector=q, limit=10)
    latency_ms = (time.perf_counter() - t0) * 1000.0

    assert len(results) == 10
    # On 5,000 vectors, BLAS dot product should complete in well under 50 ms
    assert latency_ms < 50.0
