"""EcoSonic Acoustic Memory Engine.

Unified vector search, scalable FAISS retrieval, HDBSCAN acoustic clustering,
and UMAP 2D representation manifold discovery across 1,280-D BirdNET embeddings.

Architectural Capabilities:
1. Dual Retrieval Engines: Exact NumPy vector baseline and scalable FAISS IndexFlatIP.
2. Embedding Lifecycle: Dimension validation (1280), NaN/Inf sanitization, L2 normalization.
3. Unsupervised Clustering: HDBSCAN density clustering for acoustic niche discovery.
4. Manifold Projections: Reproducible UMAP 2D coordinates for visual exploration.
5. Feature-Flag Awareness: Honors ENABLE_ACOUSTIC_MEMORY with clean disabled-state signaling.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np

try:
    import faiss
except ImportError:
    faiss = None

from app.config import settings
from app.services.acoustic_memory.clustering_service import (
    AcousticClusteringService,
    ClusterRunSummary,
    clustering_service,
)
from app.services.acoustic_memory.embedding_index import (
    EXPECTED_DIMENSION,
    EmbeddingIndexService,
    SegmentMetadata,
    embedding_index_service,
)
from app.services.acoustic_memory.similarity_service import (
    AcousticSimilarityService,
    SimilaritySearchResult,
    similarity_service,
)
from app.services.acoustic_memory.visualization_service import (
    AcousticVisualizationService,
    visualization_service,
)

logger = logging.getLogger(__name__)

SCIENTIFIC_MEMORY_DISCLAIMER = (
    "1,280-D acoustic embeddings quantify deep feature representations extracted by BirdNET+ V3.0. "
    "Geometric proximity reflects similarity in acoustic feature space, NOT guaranteed taxonomic identity or relatedness."
)


@dataclass
class EngineComparisonReport:
    """Rigorous comparison between exact NumPy and FAISS nearest-neighbor retrieval."""

    k: int
    dataset_size: int
    numpy_duration_ms: float
    faiss_duration_ms: float
    speedup_factor: float
    indices_match: bool
    max_score_difference: float
    is_numerically_identical: bool  # max_score_diff < 1e-4 and top-k indices align
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class AcousticMemoryEngine:
    """Integrated production engine orchestrating vector indexing, retrieval, clustering, and projection."""

    def __init__(
        self,
        index_service: Optional[EmbeddingIndexService] = None,
        sim_service: Optional[AcousticSimilarityService] = None,
        cluster_service: Optional[AcousticClusteringService] = None,
        viz_service: Optional[AcousticVisualizationService] = None,
    ) -> None:
        self.index_service = index_service or embedding_index_service
        self.similarity_service = sim_service or similarity_service
        self.clustering_service = cluster_service or clustering_service
        self.visualization_service = viz_service or visualization_service

        self._faiss_index: Optional[Any] = None
        self._faiss_ids: List[str] = []
        self._faiss_lock = asyncio.Lock()

    @property
    def is_enabled(self) -> bool:
        """Check whether Acoustic Memory is active via configuration flag."""
        return bool(getattr(settings, "ENABLE_ACOUSTIC_MEMORY", False))

    def check_enabled(self) -> None:
        """Raise RuntimeError if feature is disabled."""
        if not self.is_enabled:
            raise RuntimeError(
                "Acoustic Memory is currently disabled. Set ENABLE_ACOUSTIC_MEMORY=true to activate."
            )

    def get_status(self) -> Dict[str, Any]:
        """Return engine operational status, index count, and backend availability."""
        idx_status = self.index_service.get_status()
        return {
            "enabled": self.is_enabled,
            "vector_count": idx_status["vector_count"],
            "embedding_dimension": EXPECTED_DIMENSION,
            "model_version": self.index_service.model_version,
            "faiss_available": faiss is not None,
            "faiss_index_built": self._faiss_index is not None,
            "status": idx_status["status"] if self.is_enabled else "disabled",
            "last_updated": idx_status["last_updated"],
            "disclaimer": SCIENTIFIC_MEMORY_DISCLAIMER,
        }

    # ------------------------------------------------------------------------
    # FAISS Index Synchronization
    # ------------------------------------------------------------------------
    def sync_faiss_index(self) -> int:
        """Synchronize in-memory normalized vectors into a FAISS IndexFlatIP index.

        Returns:
            Number of vectors indexed in FAISS.
        """
        if faiss is None:
            logger.warning("FAISS library is not installed; scalable indexing unavailable.")
            return 0

        seg_ids, vectors, _ = self.index_service.get_all_vectors(normalized=True)
        if len(seg_ids) == 0:
            self._faiss_index = None
            self._faiss_ids = []
            return 0

        # Create exact Inner Product index on L2-normalized vectors (equivalent to cosine similarity)
        index = faiss.IndexFlatIP(EXPECTED_DIMENSION)
        vectors_contiguous = np.ascontiguousarray(vectors, dtype=np.float32)
        index.add(vectors_contiguous)

        self._faiss_index = index
        self._faiss_ids = list(seg_ids)
        logger.info("Synchronized %d vectors into FAISS IndexFlatIP.", index.ntotal)
        return int(index.ntotal)

    # ------------------------------------------------------------------------
    # Search Interfaces (NumPy & FAISS)
    # ------------------------------------------------------------------------
    def search_numpy(
        self,
        query_vector: Optional[np.ndarray] = None,
        query_segment_id: Optional[str] = None,
        limit: int = 10,
        min_similarity: float = 0.0,
        exclude_same_session: bool = False,
        site_id: Optional[str] = None,
        model_version: Optional[str] = None,
    ) -> List[SimilaritySearchResult]:
        """Perform exact cosine similarity search using the optimized NumPy BLAS dot-product baseline."""
        return self.similarity_service.search(
            query_vector=query_vector,
            query_segment_id=query_segment_id,
            limit=limit,
            min_similarity=min_similarity,
            exclude_same_session=exclude_same_session,
            site_id=site_id,
            model_version=model_version,
        )

    def search_faiss(
        self,
        query_vector: Optional[np.ndarray] = None,
        query_segment_id: Optional[str] = None,
        limit: int = 10,
        min_similarity: float = 0.0,
        exclude_same_session: bool = False,
        site_id: Optional[str] = None,
    ) -> List[SimilaritySearchResult]:
        """Perform nearest-neighbor retrieval using FAISS IndexFlatIP."""
        if faiss is None:
            # Fallback to NumPy transparently
            return self.search_numpy(
                query_vector=query_vector,
                query_segment_id=query_segment_id,
                limit=limit,
                min_similarity=min_similarity,
                exclude_same_session=exclude_same_session,
                site_id=site_id,
            )

        # Ensure FAISS index is up to date
        if self._faiss_index is None or self._faiss_index.ntotal != self.index_service.vector_count:
            self.sync_faiss_index()

        if self._faiss_index is None or self._faiss_index.ntotal == 0:
            return []

        # Resolve and normalize query vector
        query_session_id: Optional[str] = None
        if query_segment_id:
            raw_q = self.index_service.get_vector(query_segment_id, normalized=False)
            if raw_q is None:
                raise KeyError(f"Query segment ID '{query_segment_id}' not found in index.")
            q_norm = self.index_service.normalize_vector(raw_q)
            q_meta = self.index_service.get_metadata(query_segment_id)
            if q_meta:
                query_session_id = q_meta.session_id
        else:
            q_clean = self.index_service.validate_vector(query_vector)
            q_norm = self.index_service.normalize_vector(q_clean)

        q_input = np.ascontiguousarray(q_norm.reshape(1, -1), dtype=np.float32)

        # Retrieve a wider pool to accommodate exclusions
        k_retrieve = min(self._faiss_index.ntotal, max(limit * 3, 20))
        scores, indices = self._faiss_index.search(q_input, k_retrieve)

        results: List[SimilaritySearchResult] = []
        for sim_score, idx in zip(scores[0], indices[0]):
            if idx < 0 or idx >= len(self._faiss_ids):
                continue

            seg_id = self._faiss_ids[idx]
            score = float(sim_score)

            if query_segment_id and seg_id == query_segment_id:
                continue
            if score < min_similarity:
                continue

            meta = self.index_service.get_metadata(seg_id)
            if not meta:
                continue

            if exclude_same_session and query_session_id and meta.session_id == query_session_id:
                continue
            if site_id and meta.site_id != site_id:
                continue

            has_audio = bool(meta.audio_path and Path(meta.audio_path).exists())

            results.append(
                SimilaritySearchResult(
                    segment_id=seg_id,
                    similarity_score=round(score, 6),
                    session_id=meta.session_id,
                    analysis_id=meta.analysis_id,
                    site_id=meta.site_id,
                    start_seconds=meta.start_seconds,
                    end_seconds=meta.end_seconds,
                    model_version=meta.model_version,
                    label=meta.label,
                    confidence=meta.confidence,
                    created_at=meta.created_at,
                    has_audio=has_audio,
                )
            )

            if len(results) >= limit:
                break

        return results

    def compare_retrieval_engines(
        self,
        query_vector: np.ndarray,
        k: int = 10,
    ) -> EngineComparisonReport:
        """Execute and benchmark identical queries across NumPy and FAISS, comparing outputs.

        Validates numerical parity within float32 tolerance.
        """
        n_vectors = self.index_service.vector_count
        if n_vectors == 0:
            return EngineComparisonReport(
                k=k,
                dataset_size=0,
                numpy_duration_ms=0.0,
                faiss_duration_ms=0.0,
                speedup_factor=1.0,
                indices_match=True,
                max_score_difference=0.0,
                is_numerically_identical=True,
            )

        # 1. Benchmark NumPy
        t_np_0 = time.perf_counter()
        np_res = self.search_numpy(query_vector=query_vector, limit=k)
        np_duration = (time.perf_counter() - t_np_0) * 1000.0

        # 2. Benchmark FAISS
        t_faiss_0 = time.perf_counter()
        faiss_res = self.search_faiss(query_vector=query_vector, limit=k)
        faiss_duration = (time.perf_counter() - t_faiss_0) * 1000.0

        speedup = round(np_duration / max(0.0001, faiss_duration), 2)

        # Compare outputs
        min_len = min(len(np_res), len(faiss_res))
        indices_match = True
        max_diff = 0.0

        for i in range(min_len):
            if np_res[i].segment_id != faiss_res[i].segment_id:
                indices_match = False
            diff = abs(np_res[i].similarity_score - faiss_res[i].similarity_score)
            if diff > max_diff:
                max_diff = diff

        is_identical = bool(indices_match and max_diff < 1e-4)

        return EngineComparisonReport(
            k=k,
            dataset_size=n_vectors,
            numpy_duration_ms=round(np_duration, 4),
            faiss_duration_ms=round(faiss_duration, 4),
            speedup_factor=speedup,
            indices_match=indices_match,
            max_score_difference=round(max_diff, 8),
            is_numerically_identical=is_identical,
        )

    # ------------------------------------------------------------------------
    # Unsupervised Pattern Discovery (HDBSCAN & UMAP)
    # ------------------------------------------------------------------------
    async def run_clustering(
        self,
        min_cluster_size: int = 5,
        min_samples: Optional[int] = None,
        metric: str = "euclidean",
    ) -> ClusterRunSummary:
        """Run asynchronous HDBSCAN clustering across all indexed embeddings."""
        return await self.clustering_service.run_clustering(
            min_cluster_size=min_cluster_size,
            min_samples=min_samples,
            metric=metric,
        )

    async def generate_projections(
        self,
        n_neighbors: int = 15,
        min_dist: float = 0.1,
        cluster_run_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Generate asynchronous UMAP 2D coordinates for visual embedding scatter plots."""
        return await self.visualization_service.compute_projection(
            n_neighbors=n_neighbors,
            min_dist=min_dist,
            cluster_run_id=cluster_run_id,
        )


# Singleton instance
acoustic_memory_engine = AcousticMemoryEngine()
