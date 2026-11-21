"""Unit and integration tests for Acoustic Memory Embedding Indexing."""

from __future__ import annotations

import numpy as np
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.acoustic_memory import EmbeddingIndex
from app.models.live_session import LiveSegment, LiveSession
from app.services.acoustic_memory.embedding_index import (
    EXPECTED_DIMENSION,
    EmbeddingIndexService,
    SegmentMetadata,
)
from app.services.storage_service import storage_service


def generate_random_vector(dim: int = 1280, seed: int = 42) -> np.ndarray:
    """Generate a random synthetic 1,280-D vector."""
    rng = np.random.default_rng(seed)
    return rng.standard_normal(dim).astype(np.float32)


def test_validate_valid_vector():
    vec = generate_random_vector(1280)
    validated = EmbeddingIndexService.validate_vector(vec)
    assert validated.shape == (1280,)
    assert validated.dtype == np.float32


def test_reject_invalid_dimensions():
    vec_512 = generate_random_vector(512)
    with pytest.raises(ValueError, match="Expected 1280 dimensions"):
        EmbeddingIndexService.validate_vector(vec_512)

    vec_2d = np.zeros((2, 1280), dtype=np.float32)
    with pytest.raises(ValueError, match="Vector batch must have shape"):
        EmbeddingIndexService.validate_vector(vec_2d)


def test_reject_nan_and_infinite_vectors():
    vec_nan = generate_random_vector(1280)
    vec_nan[10] = np.nan
    with pytest.raises(ValueError, match="non-finite"):
        EmbeddingIndexService.validate_vector(vec_nan)

    vec_inf = generate_random_vector(1280)
    vec_inf[100] = np.inf
    with pytest.raises(ValueError, match="non-finite"):
        EmbeddingIndexService.validate_vector(vec_inf)


def test_vector_normalization():
    vec = generate_random_vector(1280)
    norm_vec = EmbeddingIndexService.normalize_vector(vec)
    norm_mag = float(np.linalg.norm(norm_vec))
    assert pytest.approx(norm_mag, rel=1e-5) == 1.0


def test_add_vector_and_retrieve():
    service = EmbeddingIndexService()
    vec = generate_random_vector(1280, seed=101)
    meta = SegmentMetadata(
        segment_id="seg-001",
        session_id="sess-alpha",
        start_seconds=0.0,
        end_seconds=3.0,
    )

    added = service.add_vector("seg-001", vec, meta)
    assert added is True
    assert service.vector_count == 1

    retrieved = service.get_vector("seg-001", normalized=True)
    assert retrieved is not None
    assert pytest.approx(float(np.linalg.norm(retrieved)), rel=1e-5) == 1.0

    ret_meta = service.get_metadata("seg-001")
    assert ret_meta is not None
    assert ret_meta.session_id == "sess-alpha"


def test_duplicate_vector_update_without_duplication():
    service = EmbeddingIndexService()
    vec1 = generate_random_vector(1280, seed=1)
    vec2 = generate_random_vector(1280, seed=2)

    service.add_vector("seg-dup", vec1)
    assert service.vector_count == 1

    # Adding again with same ID must update without incrementing count
    service.add_vector("seg-dup", vec2)
    assert service.vector_count == 1

    ids, matrix, _ = service.get_all_vectors()
    assert len(ids) == 1
    assert matrix.shape == (1, 1280)


@pytest.mark.asyncio
async def test_empty_database_rebuild(test_engine):
    """Rebuilding an empty database should safely yield an empty ready index."""
    service = EmbeddingIndexService()
    async with AsyncSession(test_engine) as session:
        res = await service.rebuild_index(session)
        assert res["vector_count"] == 0
        assert res["status"] == "ready"
        assert service.vector_count == 0


@pytest.mark.asyncio
async def test_rebuild_from_disk_embeddings(test_engine, tmp_path):
    """Rebuild must pick up live segment embeddings stored on disk."""
    service = EmbeddingIndexService()

    # Create dummy session and segment in database
    session_id = "test-rebuild-sess"
    seg_id = "test-rebuild-seg-1"
    vec = generate_random_vector(1280, seed=99)

    # Save to disk using storage_service
    emb_path = storage_service.save_live_embedding(
        session_id=session_id,
        start_seconds=0.0,
        end_seconds=3.0,
        vector=vec,
    )

    async with AsyncSession(test_engine) as session:
        sess = LiveSession(id=session_id, source_type="browser_mic", status="stopped")
        seg = LiveSegment(
            id=seg_id,
            session_id=session_id,
            start_seconds=0.0,
            end_seconds=3.0,
            audio_path="fake/path.wav",
            embedding_path=str(emb_path),
            processing_status="embedding_extracted",
        )
        session.add(sess)
        session.add(seg)
        await session.commit()

        # Run rebuild
        result = await service.rebuild_index(session)
        assert result["vector_count"] >= 1
        assert service.get_vector(seg_id) is not None
        assert service.get_metadata(seg_id).session_id == session_id
