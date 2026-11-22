"""Offline HDBSCAN acoustic pattern discovery and clustering service.

Discovers recurring acoustic patterns across 1,280-D BirdNET bioacoustic representations.
Crucially: Clusters represent acoustic similarity niches, NOT verified biological species.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from sklearn.cluster import HDBSCAN
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory
from app.models.acoustic_memory import AcousticClusterAssignment, AcousticClusterRun
from app.services.acoustic_memory.embedding_index import (
    EmbeddingIndexService,
    embedding_index_service,
)

logger = logging.getLogger(__name__)

SCIENTIFIC_CLUSTER_DISCLAIMER = (
    "Acoustic clusters reflect shared spectral and temporal features within the 1,280-D "
    "embedding space. Clusters do NOT denote verified biological species, taxonomies, or individuals."
)


@dataclass
class ClusterRunSummary:
    """Summary of an HDBSCAN clustering run."""

    cluster_run_id: str
    model_version: str
    dataset_size: int
    cluster_count: int
    noise_count: int
    cluster_sizes: Dict[int, int]
    parameters: Dict[str, Any]
    status: str
    created_at: str
    elapsed_seconds: float
    disclaimer: str = SCIENTIFIC_CLUSTER_DISCLAIMER

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class AcousticClusteringService:
    """Unsupervised acoustic cluster exploration and recurrence analysis."""

    def __init__(self, index_service: Optional[EmbeddingIndexService] = None) -> None:
        self.index_service = index_service or embedding_index_service
        self._lock = asyncio.Lock()

    async def run_clustering(
        self,
        min_cluster_size: int = 5,
        min_samples: Optional[int] = None,
        metric: str = "euclidean",
        db: Optional[AsyncSession] = None,
    ) -> ClusterRunSummary:
        """Execute HDBSCAN clustering across all indexed 1,280-D embeddings."""
        async with self._lock:
            t0 = time.perf_counter()
            seg_ids, vectors, _ = self.index_service.get_all_vectors(normalized=True)
            n_samples = len(seg_ids)
            run_id = str(uuid.uuid4())
            now_iso = datetime.now(timezone.utc).isoformat()

            params = {
                "min_cluster_size": min_cluster_size,
                "min_samples": min_samples,
                "metric": metric,
                "normalization": "L2",
            }

            # 1. Handle small or empty datasets safely
            if n_samples == 0:
                return ClusterRunSummary(
                    cluster_run_id=run_id,
                    model_version=self.index_service.model_version,
                    dataset_size=0,
                    cluster_count=0,
                    noise_count=0,
                    cluster_sizes={},
                    parameters=params,
                    status="empty_dataset",
                    created_at=now_iso,
                    elapsed_seconds=round(time.perf_counter() - t0, 4),
                )

            if n_samples < min_cluster_size:
                logger.info("Dataset size %d < min_cluster_size %d; all points assigned as noise.", n_samples, min_cluster_size)
                summary = ClusterRunSummary(
                    cluster_run_id=run_id,
                    model_version=self.index_service.model_version,
                    dataset_size=n_samples,
                    cluster_count=0,
                    noise_count=n_samples,
                    cluster_sizes={},
                    parameters=params,
                    status="insufficient_samples",
                    created_at=now_iso,
                    elapsed_seconds=round(time.perf_counter() - t0, 4),
                )
                await self._persist_run(run_id, summary, seg_ids, [-1] * n_samples, db)
                return summary

            # 2. Fit HDBSCAN in executor to avoid blocking the event loop
            loop = asyncio.get_running_loop()
            clusterer = HDBSCAN(
                min_cluster_size=min_cluster_size,
                min_samples=min_samples,
                metric=metric,
                copy=True,
            )

            labels: np.ndarray = await loop.run_in_executor(None, clusterer.fit_predict, vectors)

            # 3. Aggregate cluster statistics
            unique_labels = set(labels.tolist())
            cluster_labels = [lbl for lbl in unique_labels if lbl >= 0]
            cluster_count = len(cluster_labels)
            noise_count = int(np.sum(labels == -1))
            cluster_sizes = {
                int(lbl): int(np.sum(labels == lbl)) for lbl in sorted(cluster_labels)
            }

            elapsed = round(time.perf_counter() - t0, 4)
            summary = ClusterRunSummary(
                cluster_run_id=run_id,
                model_version=self.index_service.model_version,
                dataset_size=n_samples,
                cluster_count=cluster_count,
                noise_count=noise_count,
                cluster_sizes=cluster_sizes,
                parameters=params,
                status="completed",
                created_at=now_iso,
                elapsed_seconds=elapsed,
            )

            # 4. Persist to database
            await self._persist_run(run_id, summary, seg_ids, labels.tolist(), db)
            logger.info(
                "HDBSCAN clustering completed for %d vectors: %d clusters, %d noise in %.3fs",
                n_samples,
                cluster_count,
                noise_count,
                elapsed,
            )
            return summary

    async def _persist_run(
        self,
        run_id: str,
        summary: ClusterRunSummary,
        segment_ids: List[str],
        labels: List[int],
        db: Optional[AsyncSession],
    ) -> None:
        """Persist cluster run metadata and segment assignments."""
        async def _save(session: AsyncSession) -> None:
            db_run = AcousticClusterRun(
                id=run_id,
                model_version=summary.model_version,
                dataset_size=summary.dataset_size,
                parameters_json=summary.parameters,
                cluster_count=summary.cluster_count,
                noise_count=summary.noise_count,
                status=summary.status,
            )
            session.add(db_run)

            # Bulk save assignments
            assignments = [
                AcousticClusterAssignment(
                    id=str(uuid.uuid4()),
                    cluster_run_id=run_id,
                    segment_id=seg_id,
                    cluster_label=label,
                )
                for seg_id, label in zip(segment_ids, labels)
            ]
            session.add_all(assignments)
            await session.commit()

        if db:
            await _save(db)
        else:
            async with async_session_factory() as session:
                await _save(session)

    async def get_latest_cluster_run(self, db: Optional[AsyncSession] = None) -> Optional[Dict[str, Any]]:
        """Retrieve metadata of the most recent clustering run."""
        async def _query(session: AsyncSession) -> Optional[Dict[str, Any]]:
            stmt = select(AcousticClusterRun).order_by(AcousticClusterRun.created_at.desc()).limit(1)
            res = await session.execute(stmt)
            run = res.scalars().first()
            if not run:
                return None
            return {
                "cluster_run_id": run.id,
                "model_version": run.model_version,
                "dataset_size": run.dataset_size,
                "cluster_count": run.cluster_count,
                "noise_count": run.noise_count,
                "parameters": run.parameters_json,
                "status": run.status,
                "created_at": run.created_at.isoformat(),
                "disclaimer": SCIENTIFIC_CLUSTER_DISCLAIMER,
            }

        if db:
            return await _query(db)
        async with async_session_factory() as session:
            return await _query(session)


clustering_service = AcousticClusteringService()
