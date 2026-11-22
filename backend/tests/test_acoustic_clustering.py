"""Unit and integration tests for HDBSCAN Acoustic Clustering."""

from __future__ import annotations

import numpy as np
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.acoustic_memory import AcousticClusterAssignment, AcousticClusterRun
from app.services.acoustic_memory.clustering_service import (
    SCIENTIFIC_CLUSTER_DISCLAIMER,
    AcousticClusteringService,
)
from app.services.acoustic_memory.embedding_index import (
    EmbeddingIndexService,
    SegmentMetadata,
)


def create_synthetic_clusters(
    n_clusters: int = 3, points_per_cluster: int = 10, dim: int = 1280
) -> tuple[list[str], list[np.ndarray], list[int]]:
    """Generate cleanly separated synthetic Gaussian clusters in 1,280-D space."""
    rng = np.random.default_rng(42)
    ids: list[str] = []
    vectors: list[np.ndarray] = []
    expected_labels: list[int] = []

    for c in range(n_clusters):
        center = np.zeros(dim, dtype=np.float32)
        center[c * 20] = 5.0  # Separate cluster centers along orthogonal axes
        for i in range(points_per_cluster):
            noise = rng.normal(0.0, 0.1, dim).astype(np.float32)
            v = center + noise
            seg_id = f"clust-{c}-pt-{i}"
            ids.append(seg_id)
            vectors.append(v)
            expected_labels.append(c)

    return ids, vectors, expected_labels


@pytest.mark.asyncio
async def test_hdbscan_clustering_success(test_engine):
    """Verify HDBSCAN discovers separated clusters and records assignments."""
    index = EmbeddingIndexService()
    clustering = AcousticClusteringService(index)

    ids, vectors, _ = create_synthetic_clusters(n_clusters=3, points_per_cluster=8)
    for seg_id, v in zip(ids, vectors):
        index.add_vector(seg_id, v)

    async with AsyncSession(test_engine) as session:
        summary = await clustering.run_clustering(min_cluster_size=4, db=session)

        assert summary.status == "completed"
        assert summary.dataset_size == 24
        assert summary.cluster_count >= 2  # Discovers clean distinct clusters
        assert summary.disclaimer == SCIENTIFIC_CLUSTER_DISCLAIMER

        # Verify DB records
        res_run = await session.execute(
            select(AcousticClusterRun).where(AcousticClusterRun.id == summary.cluster_run_id)
        )
        run_record = res_run.scalars().first()
        assert run_record is not None
        assert run_record.cluster_count == summary.cluster_count

        res_assign = await session.execute(
            select(AcousticClusterAssignment).where(
                AcousticClusterAssignment.cluster_run_id == summary.cluster_run_id
            )
        )
        assignments = res_assign.scalars().all()
        assert len(assignments) == 24


@pytest.mark.asyncio
async def test_hdbscan_small_sample_safety(test_engine):
    """Dataset smaller than min_cluster_size must be handled safely without error."""
    index = EmbeddingIndexService()
    clustering = AcousticClusteringService(index)

    # Only add 2 vectors
    v = np.zeros(1280, dtype=np.float32)
    v[0] = 1.0
    index.add_vector("small-1", v)
    index.add_vector("small-2", v)

    async with AsyncSession(test_engine) as session:
        summary = await clustering.run_clustering(min_cluster_size=5, db=session)
        assert summary.status == "insufficient_samples"
        assert summary.cluster_count == 0
        assert summary.noise_count == 2
