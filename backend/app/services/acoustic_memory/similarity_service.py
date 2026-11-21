"""Exact Cosine Similarity Search service across 1,280-D acoustic embeddings."""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np

from app.services.acoustic_memory.embedding_index import (
    EmbeddingIndexService,
    SegmentMetadata,
    embedding_index_service,
)

logger = logging.getLogger(__name__)

SCIENTIFIC_DISCLAIMER = (
    "Cosine similarity in 1,280-D embedding space measures acoustic representation resemblance. "
    "It is NOT a classification probability, species confidence, or proof of biological identity."
)


@dataclass
class SimilaritySearchResult:
    """Standardized representation of an acoustic similarity match."""

    segment_id: str
    similarity_score: float
    session_id: Optional[str] = None
    analysis_id: Optional[str] = None
    site_id: Optional[str] = None
    start_seconds: float = 0.0
    end_seconds: float = 3.0
    model_version: str = "BirdNET+ V3.0"
    label: Optional[str] = None
    confidence: Optional[float] = None
    created_at: Optional[str] = None
    has_audio: bool = False
    disclaimer: str = SCIENTIFIC_DISCLAIMER

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class AcousticSimilarityService:
    """High-throughput cosine similarity retrieval over indexed environmental acoustic embeddings."""

    def __init__(self, index_service: Optional[EmbeddingIndexService] = None) -> None:
        self.index_service = index_service or embedding_index_service

    def search(
        self,
        query_vector: Optional[np.ndarray] = None,
        query_segment_id: Optional[str] = None,
        limit: int = 10,
        min_similarity: float = 0.0,
        exclude_same_session: bool = False,
        site_id: Optional[str] = None,
        model_version: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
    ) -> List[SimilaritySearchResult]:
        """Perform exact cosine similarity search across candidates in the index."""
        if query_vector is None and query_segment_id is None:
            raise ValueError("Must provide either 'query_vector' or 'query_segment_id'.")

        limit = max(1, min(limit, 500))  # Bounded retrieval limit

        # 1. Resolve and normalize query vector
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

        # 2. Retrieve candidate pool
        seg_ids, candidate_matrix, metadata_list = self.index_service.get_all_vectors(normalized=True)
        if len(seg_ids) == 0:
            return []

        # 3. Compute exact cosine similarities via BLAS dot product: (N, 1280) @ (1280,) -> (N,)
        similarities = candidate_matrix @ q_norm

        # 4. Filter candidates and assemble results
        dt_from = datetime.fromisoformat(date_from) if date_from else None
        dt_to = datetime.fromisoformat(date_to) if date_to else None

        valid_matches: List[Tuple[float, int]] = []
        for idx, (seg_id, meta) in enumerate(zip(seg_ids, metadata_list)):
            score = float(similarities[idx])

            # Exclude query segment itself
            if query_segment_id and seg_id == query_segment_id:
                continue

            # Minimum score threshold
            if score < min_similarity:
                continue

            # Exclude same session if requested
            if exclude_same_session and query_session_id and meta.session_id == query_session_id:
                continue

            # Site filter
            if site_id and meta.site_id != site_id:
                continue

            # Model version filter
            if model_version and meta.model_version != model_version:
                continue

            # Date range filter
            if meta.created_at and (dt_from or dt_to):
                try:
                    seg_dt = datetime.fromisoformat(meta.created_at)
                    if dt_from and seg_dt < dt_from:
                        continue
                    if dt_to and seg_dt > dt_to:
                        continue
                except Exception:
                    pass

            valid_matches.append((score, idx))

        if not valid_matches:
            return []

        # 5. Sort top-K by descending similarity score
        valid_matches.sort(key=lambda x: x[0], reverse=True)
        top_matches = valid_matches[:limit]

        results: List[SimilaritySearchResult] = []
        for score, idx in top_matches:
            meta = metadata_list[idx]
            has_audio = bool(meta.audio_path and Path(meta.audio_path).exists())
            results.append(
                SimilaritySearchResult(
                    segment_id=meta.segment_id,
                    similarity_score=round(score, 4),
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
                    disclaimer=SCIENTIFIC_DISCLAIMER,
                )
            )

        return results

    def get_segment_audio_path(self, segment_id: str) -> Optional[Path]:
        """Retrieve original audio file path for an indexed segment."""
        meta = self.index_service.get_metadata(segment_id)
        if not meta or not meta.audio_path:
            return None
        p = Path(meta.audio_path)
        if p.exists() and p.is_file():
            return p
        return None


similarity_service = AcousticSimilarityService()
