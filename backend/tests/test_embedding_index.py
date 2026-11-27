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


def test_embedding_index_empty_one_multiple_and_duplicate():
    """Verify empty, single, multi, duplicate-update, and raw/normalized parity."""
    service = EmbeddingIndexService()
    ids, mat, metas = service.get_all_vectors(normalized=True)
    assert ids == []
    assert mat.shape == (0, 1280)
    assert metas == []

    # One embedding
    v1 = generate_random_vector(1280, seed=1) * 3.5
    service.add_vector("seg-1", v1, SegmentMetadata(segment_id="seg-1", session_id="s1"))
    assert service.vector_count == 1
    raw_1 = service.get_vector("seg-1", normalized=False)
    norm_1 = service.get_vector("seg-1", normalized=True)
    assert raw_1 is not None and norm_1 is not None
    assert np.allclose(raw_1, v1, atol=1e-5)
    assert np.isclose(np.linalg.norm(norm_1), 1.0, atol=1e-5)

    # Duplicate ID updates in-place without growing count
    v1_updated = generate_random_vector(1280, seed=2) * 2.0
    service.add_vector("seg-1", v1_updated, SegmentMetadata(segment_id="seg-1", session_id="s1b"))
    assert service.vector_count == 1
    assert np.allclose(service.get_vector("seg-1", normalized=False), v1_updated, atol=1e-5)
    assert service.get_metadata("seg-1").session_id == "s1b"

    # Multiple embeddings
    for i in range(2, 12):
        service.add_vector(f"seg-{i}", generate_random_vector(1280, seed=i + 10))
    ids, mat_norm, _ = service.get_all_vectors(normalized=True)
    _, mat_raw, _ = service.get_all_vectors(normalized=False)
    assert len(ids) == 11
    assert mat_norm.shape == (11, 1280)
    assert mat_raw.shape == (11, 1280)
    assert np.allclose(np.linalg.norm(mat_norm, axis=1), 1.0, atol=1e-5)


def test_embedding_index_search_cosine_and_faiss_consistency():
    """Verify NumPy search, cosine similarity, and FAISS IndexFlatIP consistency."""
    from app.services.acoustic_memory.similarity_service import AcousticSimilarityService
    from app.services.acoustic_memory_engine import AcousticMemoryEngine

    service = EmbeddingIndexService()
    rng = np.random.default_rng(123)
    for i in range(20):
        service.add_vector(f"s-{i}", rng.standard_normal(1280, dtype=np.float32) * (i + 1))

    sim_service = AcousticSimilarityService(index_service=service)
    engine = AcousticMemoryEngine(index_service=service, sim_service=sim_service)

    query_raw = service.get_vector("s-5", normalized=False)
    np_results = sim_service.search(query_vector=query_raw, limit=5)
    assert len(np_results) == 5
    assert np_results[0].segment_id == "s-5"
    assert np.isclose(np_results[0].similarity_score, 1.0, atol=1e-5)

    # Cosine similarity parity with explicit normalized dot product
    _, mat_norm, _ = service.get_all_vectors(normalized=True)
    q_norm = EmbeddingIndexService.normalize_vector(query_raw)
    expected_scores = mat_norm @ q_norm
    top_idx = int(np.argmax(expected_scores))
    assert top_idx == 5
    assert np.isclose(np_results[1].similarity_score, float(np.sort(expected_scores)[-2]), atol=1e-4)

    # FAISS consistency
    ntotal = engine.sync_faiss_index()
    if ntotal > 0:
        faiss_results = engine.search_faiss(query_vector=query_raw, limit=5)
        assert [r.segment_id for r in faiss_results] == [r.segment_id for r in np_results]
        for fr, nr in zip(faiss_results, np_results):
            assert np.isclose(fr.similarity_score, nr.similarity_score, atol=1e-4)


def test_embedding_index_readonly_view_zero_norm_and_capacity_growth():
    """Verify returned normalized matrix is read-only, zero-norm is safe, and growth preserves data."""
    service = EmbeddingIndexService()
    zero_vec = np.zeros(1280, dtype=np.float32)
    service.add_vector("zero-seg", zero_vec, SegmentMetadata(segment_id="zero-seg", session_id="s-zero"))
    assert np.all(service.get_vector("zero-seg", normalized=True) == 0.0)
    assert np.all(service.get_vector("zero-seg", normalized=False) == 0.0)

    # Grow past multiple geometric capacity boundaries (64 -> 128 -> 256 -> 512)
    rng = np.random.default_rng(77)
    expected_raw = {}
    for i in range(300):
        vec = rng.standard_normal(1280, dtype=np.float32) * (1.0 + (i % 7))
        seg_id = f"grow-{i}"
        expected_raw[seg_id] = vec
        service.add_vector(seg_id, vec, SegmentMetadata(segment_id=seg_id, session_id=f"sess-{i}"))

    assert service.vector_count == 301
    ids, mat_norm, metas = service.get_all_vectors(normalized=True)
    assert len(ids) == len(metas) == 301
    assert mat_norm.shape == (301, 1280)
    assert mat_norm.flags.writeable is False
    with pytest.raises(ValueError):
        mat_norm[0, 0] = 999.0

    for seg_id, orig in expected_raw.items():
        assert np.allclose(service.get_vector(seg_id, normalized=False), orig, atol=1e-4)
        assert service.get_metadata(seg_id).segment_id == seg_id


@pytest.mark.asyncio
async def test_embedding_index_reload_preserves_search_results(test_engine):
    """Verify persistence and rebuild_index() preserve identical search results."""
    from app.services.acoustic_memory.similarity_service import AcousticSimilarityService

    session_id = "test-reload-search"
    rng = np.random.default_rng(55)
    vecs = [rng.standard_normal(1280, dtype=np.float32) for _ in range(5)]

    svc1 = EmbeddingIndexService()
    async with AsyncSession(test_engine) as session:
        session.add(LiveSession(id=session_id, source_type="browser_mic", status="stopped"))
        for i, v in enumerate(vecs):
            seg_id = f"reload-seg-{i}"
            emb_path = storage_service.save_live_embedding(
                session_id=session_id,
                start_seconds=float(i * 3),
                end_seconds=float((i + 1) * 3),
                vector=v,
            )
            session.add(
                LiveSegment(
                    id=seg_id,
                    session_id=session_id,
                    start_seconds=float(i * 3),
                    end_seconds=float((i + 1) * 3),
                    audio_path=f"fake/{seg_id}.wav",
                    embedding_path=str(emb_path),
                    processing_status="embedding_extracted",
                )
            )
            svc1.add_vector(seg_id, v, SegmentMetadata(segment_id=seg_id, session_id=session_id))
        await session.commit()

    before_res = AcousticSimilarityService(index_service=svc1).search(query_vector=vecs[2], limit=5)

    svc2 = EmbeddingIndexService()
    async with AsyncSession(test_engine) as session:
        await svc2.rebuild_index(session)
    after_res = AcousticSimilarityService(index_service=svc2).search(query_vector=vecs[2], limit=5)

    assert [r.segment_id for r in after_res] == [r.segment_id for r in before_res]
    for a, b in zip(after_res, before_res):
        assert np.isclose(a.similarity_score, b.similarity_score, atol=1e-5)
