"""Unit and integration tests for UMAP Acoustic Projection and Visualization."""

from __future__ import annotations

import numpy as np
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.acoustic_memory import AcousticProjection
from app.services.acoustic_memory.embedding_index import (
    EmbeddingIndexService,
    SegmentMetadata,
)
from app.services.acoustic_memory.visualization_service import (
    SCIENTIFIC_VISUALIZATION_DISCLAIMER,
    AcousticVisualizationService,
)


def generate_synthetic_points(n: int = 10, dim: int = 1280, seed: int = 42) -> tuple[list[str], list[np.ndarray]]:
    rng = np.random.default_rng(seed)
    ids = [f"proj-pt-{i}" for i in range(n)]
    vecs = [rng.standard_normal(dim).astype(np.float32) for _ in range(n)]
    return ids, vecs


@pytest.mark.asyncio
async def test_umap_projection_and_reproducibility(test_engine):
    """UMAP projection with fixed random_state must produce reproducible coordinates."""
    index = EmbeddingIndexService()
    vis = AcousticVisualizationService(index)

    ids, vecs = generate_synthetic_points(n=12, seed=10)
    for seg_id, v in zip(ids, vecs):
        index.add_vector(seg_id, v)

    async with AsyncSession(test_engine) as session:
        res1 = await vis.compute_projection(n_neighbors=5, random_state=42, db=session)
        assert res1["count"] == 12
        assert len(res1["points"]) == 12
        assert res1["disclaimer"] == SCIENTIFIC_VISUALIZATION_DISCLAIMER

        pt0_run1 = res1["points"][0]
        assert "x" in pt0_run1 and "y" in pt0_run1

        # Second run with same random state
        res2 = await vis.compute_projection(n_neighbors=5, random_state=42, db=session)
        pt0_run2 = res2["points"][0]

        assert pytest.approx(pt0_run1["x"], abs=1e-3) == pt0_run2["x"]
        assert pytest.approx(pt0_run1["y"], abs=1e-3) == pt0_run2["y"]

        # Verify DB persistence
        res_db = await session.execute(select(AcousticProjection))
        stored = res_db.scalars().all()
        assert len(stored) >= 12


@pytest.mark.asyncio
async def test_umap_small_sample_fallback(test_engine):
    """Small datasets (<4 samples) must fall back gracefully to PCA without error."""
    index = EmbeddingIndexService()
    vis = AcousticVisualizationService(index)

    ids, vecs = generate_synthetic_points(n=2, seed=7)
    for seg_id, v in zip(ids, vecs):
        index.add_vector(seg_id, v)

    async with AsyncSession(test_engine) as session:
        res = await vis.compute_projection(db=session)
        assert res["count"] == 2
        assert res["parameters"]["method"] == "pca_small_sample_fallback"
        assert len(res["points"]) == 2
