"""Acoustic Memory UMAP 2D Dimensionality Reduction and Visualization Service."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
import warnings
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional

import numpy as np
import umap
from sklearn.decomposition import PCA
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory
from app.models.acoustic_memory import AcousticClusterAssignment, AcousticProjection
from app.services.acoustic_memory.embedding_index import (
    EmbeddingIndexService,
    SegmentMetadata,
    embedding_index_service,
)

logger = logging.getLogger(__name__)

SCIENTIFIC_VISUALIZATION_DISCLAIMER = (
    "UMAP 2D coordinates represent non-linear projections of 1,280-D acoustic embedding manifolds. "
    "Spatial proximity reflects mathematical resemblance in model feature space, NOT definitive phylogenetic or ecological proximity."
)


@dataclass
class ProjectionPoint:
    """Frontend-ready 2D projected embedding point."""

    segment_id: str
    x: float
    y: float
    cluster_label: int = -1
    session_id: Optional[str] = None
    analysis_id: Optional[str] = None
    site_id: Optional[str] = None
    start_seconds: float = 0.0
    end_seconds: float = 3.0
    label: Optional[str] = None
    confidence: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class AcousticVisualizationService:
    """Manages offline UMAP 2D manifold projections of bioacoustic representations."""

    def __init__(self, index_service: Optional[EmbeddingIndexService] = None) -> None:
        self.index_service = index_service or embedding_index_service
        self._lock = asyncio.Lock()

    async def compute_projection(
        self,
        n_neighbors: int = 15,
        min_dist: float = 0.1,
        metric: str = "cosine",
        random_state: int = 42,
        cluster_run_id: Optional[str] = None,
        db: Optional[AsyncSession] = None,
    ) -> Dict[str, Any]:
        """Compute reproducible 2D manifold projection of indexed embeddings."""
        async with self._lock:
            t0 = time.perf_counter()
            seg_ids, vectors, meta_list = self.index_service.get_all_vectors(normalized=True)
            n_samples = len(seg_ids)

            if n_samples == 0:
                return {
                    "points": [],
                    "count": 0,
                    "parameters": {},
                    "status": "empty_dataset",
                    "disclaimer": SCIENTIFIC_VISUALIZATION_DISCLAIMER,
                }

            # 1. Resolve cluster labels if cluster_run_id provided
            cluster_map: Dict[str, int] = {}
            if cluster_run_id:
                async def _get_clusters(session: AsyncSession) -> Dict[str, int]:
                    stmt = select(AcousticClusterAssignment).where(
                        AcousticClusterAssignment.cluster_run_id == cluster_run_id
                    )
                    res = await session.execute(stmt)
                    return {a.segment_id: a.cluster_label for a in res.scalars().all()}

                if db:
                    cluster_map = await _get_clusters(db)
                else:
                    async with async_session_factory() as session:
                        cluster_map = await _get_clusters(session)

            # 2. Execute dimensionality reduction
            loop = asyncio.get_running_loop()

            if n_samples < 4:
                # Fallback gracefully for tiny datasets using PCA
                def _pca_project() -> np.ndarray:
                    if n_samples == 1:
                        return np.zeros((1, 2), dtype=np.float32)
                    pca = PCA(n_components=2)
                    return pca.fit_transform(vectors).astype(np.float32)

                coords = await loop.run_in_executor(None, _pca_project)
                method_used = "pca_small_sample_fallback"
                eff_neighbors = 1
            else:
                eff_neighbors = max(2, min(n_neighbors, n_samples - 1))

                def _umap_project() -> np.ndarray:
                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore")
                        reducer = umap.UMAP(
                            n_components=2,
                            n_neighbors=eff_neighbors,
                            min_dist=min_dist,
                            metric=metric,
                            random_state=random_state,
                            n_jobs=1,
                        )
                        return reducer.fit_transform(vectors).astype(np.float32)

                coords = await loop.run_in_executor(None, _umap_project)
                method_used = "umap_2d"

            # 3. Assemble frontend-ready points
            points: List[Dict[str, Any]] = []
            db_projections: List[AcousticProjection] = []

            for i, (seg_id, meta) in enumerate(zip(seg_ids, meta_list)):
                x_val = round(float(coords[i, 0]), 4)
                y_val = round(float(coords[i, 1]), 4)
                c_lbl = cluster_map.get(seg_id, -1)

                pt = ProjectionPoint(
                    segment_id=seg_id,
                    x=x_val,
                    y=y_val,
                    cluster_label=c_lbl,
                    session_id=meta.session_id,
                    analysis_id=meta.analysis_id,
                    site_id=meta.site_id,
                    start_seconds=meta.start_seconds,
                    end_seconds=meta.end_seconds,
                    label=meta.label,
                    confidence=meta.confidence,
                )
                points.append(pt.to_dict())

                db_projections.append(
                    AcousticProjection(
                        id=str(uuid.uuid4()),
                        cluster_run_id=cluster_run_id,
                        segment_id=seg_id,
                        x=x_val,
                        y=y_val,
                    )
                )

            # 4. Persist projection to SQLite
            async def _persist_proj(session: AsyncSession) -> None:
                session.add_all(db_projections)
                await session.commit()

            if db:
                await _persist_proj(db)
            else:
                async with async_session_factory() as session:
                    await _persist_proj(session)

            elapsed = round(time.perf_counter() - t0, 4)
            logger.info("Computed %s projection for %d points in %.3fs", method_used, n_samples, elapsed)

            return {
                "points": points,
                "count": n_samples,
                "parameters": {
                    "method": method_used,
                    "n_neighbors": eff_neighbors,
                    "min_dist": min_dist,
                    "metric": metric,
                    "random_state": random_state,
                    "cluster_run_id": cluster_run_id,
                    "elapsed_seconds": elapsed,
                },
                "disclaimer": SCIENTIFIC_VISUALIZATION_DISCLAIMER,
            }


visualization_service = AcousticVisualizationService()
