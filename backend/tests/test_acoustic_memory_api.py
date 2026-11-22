"""Integration tests for Acoustic Memory REST endpoints."""

from __future__ import annotations

import tempfile
import uuid
from pathlib import Path

import numpy as np
import pytest
from httpx import AsyncClient

from app.core.database import async_session_factory
from app.models.live_session import LiveSegment, LiveSession
from app.services.acoustic_memory.embedding_index import (
    SegmentMetadata,
    embedding_index_service,
)
from app.services.storage_service import storage_service


def generate_unit_vector(dim: int = 1280, seed: int = 42) -> np.ndarray:
    rng = np.random.default_rng(seed)
    v = rng.standard_normal(dim).astype(np.float32)
    return v / np.linalg.norm(v)


@pytest.mark.asyncio
async def test_get_index_status(client: AsyncClient):
    """Verify GET /api/v1/acoustic-memory/index/status returns operational status."""
    resp = await client.get("/api/v1/acoustic-memory/index/status")
    assert resp.status_code == 200
    data = resp.json()
    assert "vector_count" in data
    assert data["embedding_dimension"] == 1280
    assert "status" in data


@pytest.mark.asyncio
async def test_rebuild_index_endpoint(client: AsyncClient):
    """Verify POST /api/v1/acoustic-memory/index/rebuild triggers index synchronization."""
    resp = await client.post("/api/v1/acoustic-memory/index/rebuild")
    assert resp.status_code == 200
    data = resp.json()
    assert "vector_count" in data
    assert data["status"] == "ready"
    assert "elapsed_seconds" in data


@pytest.mark.asyncio
async def test_search_similar_segments_endpoint(client: AsyncClient):
    """Verify POST /api/v1/acoustic-memory/search performs vector retrieval."""
    v1 = generate_unit_vector(seed=1)
    v2 = generate_unit_vector(seed=2)

    embedding_index_service.clear()
    embedding_index_service.add_vector("seg-test-1", v1, SegmentMetadata("seg-test-1", session_id="s1"))
    embedding_index_service.add_vector("seg-test-2", v2, SegmentMetadata("seg-test-2", session_id="s2"))

    # Search by segment ID
    payload = {
        "query_segment_id": "seg-test-1",
        "limit": 5,
        "min_similarity": -1.0,
    }
    resp = await client.post("/api/v1/acoustic-memory/search", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0]["segment_id"] == "seg-test-2"
    assert "similarity_score" in data[0]
    assert "disclaimer" in data[0]


@pytest.mark.asyncio
async def test_get_similar_for_segment_endpoint(client: AsyncClient):
    """Verify GET /api/v1/acoustic-memory/segments/{segment_id}/similar."""
    v1 = generate_unit_vector(seed=10)
    v2 = generate_unit_vector(seed=11)

    embedding_index_service.clear()
    embedding_index_service.add_vector("seg-tgt-1", v1)
    embedding_index_service.add_vector("seg-tgt-2", v2)

    resp = await client.get("/api/v1/acoustic-memory/segments/seg-tgt-1/similar?limit=5")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["segment_id"] == "seg-tgt-2"


@pytest.mark.asyncio
async def test_session_segments_endpoint(client: AsyncClient):
    """Verify GET /api/v1/acoustic-memory/sessions/{session_id}/segments."""
    session_id = str(uuid.uuid4())
    seg1_id = str(uuid.uuid4())
    seg2_id = str(uuid.uuid4())

    async with async_session_factory() as db:
        sess = LiveSession(id=session_id, source_type="browser_mic", status="active")
        seg1 = LiveSegment(id=seg1_id, session_id=session_id, start_seconds=0.0, end_seconds=3.0, audio_path="none.wav")
        seg2 = LiveSegment(id=seg2_id, session_id=session_id, start_seconds=3.0, end_seconds=6.0, audio_path="none.wav")
        db.add(sess)
        db.add(seg1)
        db.add(seg2)
        await db.commit()

    resp = await client.get(f"/api/v1/acoustic-memory/sessions/{session_id}/segments?page=1&page_size=10")
    assert resp.status_code == 200
    data = resp.json()
    assert data["session_id"] == session_id
    assert data["total_count"] == 2
    assert len(data["segments"]) == 2


@pytest.mark.asyncio
async def test_get_segment_audio_endpoint(client: AsyncClient, tmp_path):
    """Verify GET /api/v1/acoustic-memory/segments/{segment_id}/audio."""
    # 1. Non-existent segment audio returns 404
    resp_404 = await client.get("/api/v1/acoustic-memory/segments/non-existent-seg/audio")
    assert resp_404.status_code == 404

    # 2. Existing segment audio streams WAV file
    dummy_wav = storage_service.save_live_audio_segment(
        session_id="audio-test-sess",
        start_seconds=0.0,
        end_seconds=3.0,
        samples=np.zeros(32000 * 3, dtype=np.float32),
        sample_rate=32000,
    )
    v = generate_unit_vector(seed=77)
    meta = SegmentMetadata("audio-test-seg", session_id="audio-test-sess", audio_path=str(dummy_wav))
    embedding_index_service.add_vector("audio-test-seg", v, meta)

    resp_200 = await client.get("/api/v1/acoustic-memory/segments/audio-test-seg/audio")
    assert resp_200.status_code == 200
    assert resp_200.headers["content-type"] == "audio/wav"
    assert len(resp_200.content) > 0


@pytest.mark.asyncio
async def test_run_clustering_endpoint(client: AsyncClient):
    """Verify POST /api/v1/acoustic-memory/clusters/run."""
    v1 = generate_unit_vector(seed=101)
    v2 = generate_unit_vector(seed=102)
    v3 = generate_unit_vector(seed=103)

    embedding_index_service.clear()
    embedding_index_service.add_vector("c-1", v1)
    embedding_index_service.add_vector("c-2", v2)
    embedding_index_service.add_vector("c-3", v3)

    payload = {"min_cluster_size": 2}
    resp = await client.post("/api/v1/acoustic-memory/clusters/run", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert "cluster_run_id" in data
    assert "cluster_count" in data
    assert "noise_count" in data


@pytest.mark.asyncio
async def test_visualization_projection_endpoint(client: AsyncClient):
    """Verify GET /api/v1/acoustic-memory/visualization/projection."""
    resp = await client.get("/api/v1/acoustic-memory/visualization/projection?n_neighbors=2")
    assert resp.status_code == 200
    data = resp.json()
    assert "points" in data
    assert "parameters" in data
    assert "disclaimer" in data
