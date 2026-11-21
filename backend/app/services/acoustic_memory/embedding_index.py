"""Acoustic Memory Embedding Index service for 1,280-D BirdNET bioacoustic representations.

Maintains normalized vectors and segment metadata in memory for ultra-fast vector retrieval
and exact cosine similarity search, with persistent SQLite index synchronization.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import numpy as np
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory
from app.models.acoustic_memory import EmbeddingIndex
from app.models.analysis import Analysis, EmbeddingSegment
from app.models.detection import Detection
from app.models.live_session import LiveEvent, LiveSegment, LiveSession
from app.services.storage_service import storage_service

logger = logging.getLogger(__name__)

EXPECTED_DIMENSION = 1280
DEFAULT_MODEL_VERSION = "BirdNET+ V3.0"


@dataclass
class SegmentMetadata:
    """Rich metadata associated with an indexed acoustic segment."""

    segment_id: str
    session_id: Optional[str] = None
    analysis_id: Optional[str] = None
    site_id: Optional[str] = None
    start_seconds: float = 0.0
    end_seconds: float = 3.0
    model_version: str = DEFAULT_MODEL_VERSION
    embedding_dimension: int = EXPECTED_DIMENSION
    vector_storage_path: Optional[str] = None
    audio_path: Optional[str] = None
    label: Optional[str] = None
    confidence: Optional[float] = None
    created_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class EmbeddingIndexService:
    """Thread-safe in-memory vector index with persistent metadata backing."""

    def __init__(self, model_version: str = DEFAULT_MODEL_VERSION) -> None:
        self.model_version = model_version
        self.embedding_dimension = EXPECTED_DIMENSION
        self._lock = threading.RLock()
        self._async_lock = asyncio.Lock()

        # In-memory storage using list buffers with lazy matrix caching
        self._segment_ids: List[str] = []
        self._id_to_index: Dict[str, int] = {}
        self._norm_list: List[np.ndarray] = []
        self._raw_list: List[np.ndarray] = []
        self._cached_vectors: Optional[np.ndarray] = None  # Shape (N, 1280), normalized
        self._cached_raw_vectors: Optional[np.ndarray] = None  # Shape (N, 1280), raw float32
        self._metadata: List[SegmentMetadata] = []
        self._last_updated = datetime.now(timezone.utc)
        self._status = "uninitialized"

    @property
    def vector_count(self) -> int:
        with self._lock:
            return len(self._segment_ids)

    @property
    def is_ready(self) -> bool:
        return self._status == "ready"

    def get_status(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "vector_count": len(self._segment_ids),
                "embedding_dimension": self.embedding_dimension,
                "model_version": self.model_version,
                "status": self._status,
                "last_updated": self._last_updated.isoformat(),
            }

    def clear(self) -> None:
        """Reset the in-memory index."""
        with self._lock:
            self._segment_ids.clear()
            self._id_to_index.clear()
            self._norm_list.clear()
            self._raw_list.clear()
            self._cached_vectors = None
            self._cached_raw_vectors = None
            self._metadata.clear()
            self._status = "ready"
            self._last_updated = datetime.now(timezone.utc)

    @staticmethod
    def validate_vector(vector: Any) -> np.ndarray:
        """Validate embedding dimension, dtype, and finite numerical values.

        Raises:
            ValueError: If the vector has invalid shape, non-finite values, or wrong dimension.
        """
        if vector is None:
            raise ValueError("Vector cannot be None.")

        arr = np.asarray(vector, dtype=np.float32)
        if arr.ndim == 2:
            if arr.shape[0] != 1:
                raise ValueError(f"Vector batch must have shape (1, {EXPECTED_DIMENSION}), got {arr.shape}.")
            arr = arr.reshape(-1)

        if arr.ndim != 1:
            raise ValueError(f"Vector must be 1D, got ndim={arr.ndim}.")

        if arr.shape[0] != EXPECTED_DIMENSION:
            raise ValueError(f"Expected {EXPECTED_DIMENSION} dimensions, got {arr.shape[0]}.")

        if not np.all(np.isfinite(arr)):
            raise ValueError("Vector contains non-finite values (NaN or Inf).")

        return arr

    @staticmethod
    def normalize_vector(arr: np.ndarray) -> np.ndarray:
        """Compute L2 normalized representation for exact cosine similarity."""
        norm = float(np.linalg.norm(arr))
        if norm <= 1e-12:
            return arr.copy()
        return (arr / norm).astype(np.float32)

    def add_vector(
        self,
        segment_id: str,
        vector: np.ndarray,
        metadata: Optional[SegmentMetadata] = None,
        check_duplicate: bool = True,
    ) -> bool:
        """Validate, normalize, and add a single vector into the in-memory index."""
        arr = self.validate_vector(vector)
        norm_arr = self.normalize_vector(arr)

        with self._lock:
            if check_duplicate and segment_id in self._id_to_index:
                # Update existing vector and metadata
                idx = self._id_to_index[segment_id]
                self._raw_list[idx] = arr
                self._norm_list[idx] = norm_arr
                self._cached_vectors = None
                self._cached_raw_vectors = None
                if metadata:
                    self._metadata[idx] = metadata
                self._last_updated = datetime.now(timezone.utc)
                return True

            idx = len(self._segment_ids)
            self._segment_ids.append(segment_id)
            self._id_to_index[segment_id] = idx
            self._norm_list.append(norm_arr)
            self._raw_list.append(arr)
            self._cached_vectors = None
            self._cached_raw_vectors = None

            meta = metadata or SegmentMetadata(segment_id=segment_id)
            self._metadata.append(meta)
            self._status = "ready"
            self._last_updated = datetime.now(timezone.utc)
            return True

    def get_vector(self, segment_id: str, normalized: bool = True) -> Optional[np.ndarray]:
        """Retrieve a stored vector by segment ID."""
        with self._lock:
            if segment_id not in self._id_to_index:
                return None
            idx = self._id_to_index[segment_id]
            if normalized:
                return self._norm_list[idx].copy()
            return self._raw_list[idx].copy()

    def get_metadata(self, segment_id: str) -> Optional[SegmentMetadata]:
        """Retrieve segment metadata by segment ID."""
        with self._lock:
            if segment_id not in self._id_to_index:
                return None
            idx = self._id_to_index[segment_id]
            return self._metadata[idx]

    def get_all_vectors(self, normalized: bool = True) -> Tuple[List[str], np.ndarray, List[SegmentMetadata]]:
        """Return references to all indexed IDs, vectors matrix, and metadata list."""
        with self._lock:
            if len(self._segment_ids) == 0:
                empty = np.empty((0, EXPECTED_DIMENSION), dtype=np.float32)
                return [], empty, []
            if normalized:
                if self._cached_vectors is None or len(self._cached_vectors) != len(self._segment_ids):
                    self._cached_vectors = np.asarray(self._norm_list, dtype=np.float32)
                return list(self._segment_ids), self._cached_vectors, list(self._metadata)
            else:
                if self._cached_raw_vectors is None or len(self._cached_raw_vectors) != len(self._segment_ids):
                    self._cached_raw_vectors = np.asarray(self._raw_list, dtype=np.float32)
                return list(self._segment_ids), self._cached_raw_vectors, list(self._metadata)

    async def rebuild_index(self, db: Optional[AsyncSession] = None) -> Dict[str, Any]:
        """Rebuild index by scanning database records and existing embedding files."""
        async with self._async_lock:
            t0 = time.perf_counter()
            self._status = "indexing"

            # Reset in-memory buffers
            temp_ids: List[str] = []
            temp_id_map: Dict[str, int] = {}
            temp_raw: List[np.ndarray] = []
            temp_norm: List[np.ndarray] = []
            temp_meta: List[SegmentMetadata] = []

            async def _populate(session: AsyncSession) -> None:
                # 1. Index batch file analyses
                stmt_analyses = (
                    select(
                        EmbeddingSegment.segment_id,
                        EmbeddingSegment.analysis_id,
                        EmbeddingSegment.vector_index,
                        EmbeddingSegment.start_seconds,
                        EmbeddingSegment.end_seconds,
                        Analysis.embedding_path,
                        Analysis.model_version,
                        Analysis.processed_path,
                        Analysis.recorded_at,
                        Detection.class_label,
                        Detection.confidence_score,
                    )
                    .join(Analysis, EmbeddingSegment.analysis_id == Analysis.id)
                    .outerjoin(Detection, EmbeddingSegment.detection_id == Detection.id)
                )
                res_analyses = await session.execute(stmt_analyses)
                analysis_cache: Dict[str, Optional[np.ndarray]] = {}

                for row in res_analyses.all():
                    seg_id = row.segment_id
                    ana_id = row.analysis_id
                    vec_idx = row.vector_index
                    emb_path_str = row.embedding_path

                    if ana_id not in analysis_cache:
                        if emb_path_str and Path(emb_path_str).exists():
                            try:
                                analysis_cache[ana_id] = np.load(emb_path_str, allow_pickle=False)
                            except Exception as exc:
                                logger.warning("Failed to load embeddings for analysis %s: %s", ana_id, exc)
                                analysis_cache[ana_id] = None
                        else:
                            analysis_cache[ana_id] = None

                    vecs = analysis_cache[ana_id]
                    if vecs is not None and vec_idx < len(vecs):
                        v = vecs[vec_idx]
                        try:
                            v_clean = self.validate_vector(v)
                            v_norm = self.normalize_vector(v_clean)
                            if seg_id not in temp_id_map:
                                temp_id_map[seg_id] = len(temp_ids)
                                temp_ids.append(seg_id)
                                temp_raw.append(v_clean)
                                temp_norm.append(v_norm)
                                temp_meta.append(
                                    SegmentMetadata(
                                        segment_id=seg_id,
                                        analysis_id=ana_id,
                                        start_seconds=row.start_seconds,
                                        end_seconds=row.end_seconds,
                                        model_version=row.model_version or DEFAULT_MODEL_VERSION,
                                        vector_storage_path=emb_path_str,
                                        audio_path=row.processed_path,
                                        label=row.class_label,
                                        confidence=row.confidence_score,
                                        created_at=row.recorded_at.isoformat() if row.recorded_at else None,
                                    )
                                )
                        except ValueError as err:
                            logger.warning("Skipping invalid embedding segment %s: %s", seg_id, err)

                # 2. Index live monitoring segments
                stmt_live = (
                    select(
                        LiveSegment.id,
                        LiveSegment.session_id,
                        LiveSegment.start_seconds,
                        LiveSegment.end_seconds,
                        LiveSegment.audio_path,
                        LiveSegment.embedding_path,
                        LiveSegment.created_at,
                        LiveSession.site_id,
                    )
                    .join(LiveSession, LiveSegment.session_id == LiveSession.id)
                    .where(LiveSegment.embedding_path.is_not(None))
                )
                res_live = await session.execute(stmt_live)

                for row in res_live.all():
                    seg_id = row.id
                    emb_path = Path(row.embedding_path) if row.embedding_path else None
                    if emb_path and emb_path.exists():
                        try:
                            v = np.load(str(emb_path), allow_pickle=False)
                            v_clean = self.validate_vector(v)
                            v_norm = self.normalize_vector(v_clean)
                            if seg_id not in temp_id_map:
                                temp_id_map[seg_id] = len(temp_ids)
                                temp_ids.append(seg_id)
                                temp_raw.append(v_clean)
                                temp_norm.append(v_norm)
                                temp_meta.append(
                                    SegmentMetadata(
                                        segment_id=seg_id,
                                        session_id=row.session_id,
                                        site_id=row.site_id,
                                        start_seconds=row.start_seconds,
                                        end_seconds=row.end_seconds,
                                        model_version=DEFAULT_MODEL_VERSION,
                                        vector_storage_path=str(emb_path),
                                        audio_path=row.audio_path,
                                        created_at=row.created_at.isoformat() if row.created_at else None,
                                    )
                                )
                        except Exception as exc:
                            logger.warning("Failed to load live segment embedding %s: %s", seg_id, exc)

                # 3. Synchronize persistent index record
                idx_row = (await session.execute(select(EmbeddingIndex))).scalars().first()
                if not idx_row:
                    idx_row = EmbeddingIndex(
                        model_version=self.model_version,
                        embedding_dimension=self.embedding_dimension,
                        indexing_status="ready",
                        vector_count=len(temp_ids),
                    )
                    session.add(idx_row)
                else:
                    idx_row.vector_count = len(temp_ids)
                    idx_row.indexing_status = "ready"
                    idx_row.updated_at = datetime.now(timezone.utc)
                await session.commit()

            if db:
                await _populate(db)
            else:
                async with async_session_factory() as session:
                    await _populate(session)

            # Atomically swap into in-memory structure
            with self._lock:
                self._segment_ids = temp_ids
                self._id_to_index = temp_id_map
                self._norm_list = temp_norm
                self._raw_list = temp_raw
                self._cached_vectors = np.asarray(temp_norm, dtype=np.float32) if temp_norm else np.empty((0, EXPECTED_DIMENSION), dtype=np.float32)
                self._cached_raw_vectors = np.asarray(temp_raw, dtype=np.float32) if temp_raw else np.empty((0, EXPECTED_DIMENSION), dtype=np.float32)
                self._metadata = temp_meta
                self._status = "ready"
                self._last_updated = datetime.now(timezone.utc)

            elapsed = time.perf_counter() - t0
            logger.info(
                "Embedding index rebuilt successfully: %d vectors indexed in %.3fs",
                len(temp_ids),
                elapsed,
            )
            return {
                "vector_count": len(temp_ids),
                "elapsed_seconds": round(elapsed, 4),
                "model_version": self.model_version,
                "status": "ready",
            }


embedding_index_service = EmbeddingIndexService()
