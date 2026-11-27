"""Long-running stability, cancellation, disconnect, and resource-leak tests."""

from __future__ import annotations

import asyncio
import gc
import json
import math
import struct
import wave
from pathlib import Path
from typing import List

import numpy as np
import psutil
import pytest
import pytest_asyncio
import uvicorn
import websockets
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core import database
from app.core.database import get_db
from app.core.job_manager import JobManager
from app.main import app
from app.models.analysis import Analysis
from app.services.acoustic_memory.embedding_index import EmbeddingIndexService, SegmentMetadata
from app.services.acoustic_memory_engine import AcousticMemoryEngine
from app.services.analysis_pipeline import FallbackMockEngine, analysis_pipeline
from app.services.live import embedding_worker, inference_worker, session_manager
from app.services.live.session_manager import live_session_manager
from app.services.storage_service import storage_service


def _write_test_wav(path: Path, duration_s: float = 3.0, sr: int = 32000) -> None:
    n = int(duration_s * sr)
    t = np.linspace(0, duration_s, n, endpoint=False, dtype=np.float32)
    pcm = (np.sin(2.0 * math.pi * 1500.0 * t) * 12000.0).astype("<i2")
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm.tobytes())


@pytest.fixture(autouse=True)
def _mock_pipeline_engine():
    prev = analysis_pipeline.engine
    analysis_pipeline.set_engine(FallbackMockEngine())
    analysis_pipeline.load()
    yield
    analysis_pipeline.set_engine(prev)


@pytest_asyncio.fixture
async def stability_ws_server(test_engine):
    maker = async_sessionmaker(bind=test_engine, class_=AsyncSession, expire_on_commit=False)
    prev_factory = database.async_session_factory
    database.async_session_factory = maker
    embedding_worker.async_session_factory = maker
    inference_worker.async_session_factory = maker
    session_manager.async_session_factory = maker

    async def _override_db():
        async with maker() as db:
            try:
                yield db
                await db.commit()
            except Exception:
                await db.rollback()
                raise
            finally:
                await db.close()

    app.dependency_overrides[get_db] = _override_db
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]

    config = uvicorn.Config(app=app, host="127.0.0.1", port=port, log_level="warning", lifespan="off")
    server = uvicorn.Server(config)
    server_task = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.01)

    try:
        yield f"http://127.0.0.1:{port}", f"ws://127.0.0.1:{port}", maker
    finally:
        await live_session_manager.shutdown(timeout=5.0)
        server.should_exit = True
        await asyncio.wait_for(server_task, timeout=5.0)
        app.dependency_overrides.clear()
        database.async_session_factory = prev_factory
        embedding_worker.async_session_factory = prev_factory
        inference_worker.async_session_factory = prev_factory
        session_manager.async_session_factory = prev_factory


@pytest.mark.asyncio
async def test_20_sequential_uploads_no_leaks(client: AsyncClient, test_engine, tmp_path):
    """Run 20 sequential upload analyses, verify completion, bounded RSS, and clean deletion."""
    wav_path = tmp_path / "seq.wav"
    _write_test_wav(wav_path, duration_s=3.0)
    wav_bytes = wav_path.read_bytes()

    proc = psutil.Process()
    rss_after_first = 0

    analysis_ids: List[str] = []
    for i in range(20):
        resp = await client.post(
            "/api/v1/analyses",
            files={"file": (f"seq_{i}.wav", wav_bytes, "audio/wav")},
        )
        assert resp.status_code == 202
        aid = resp.json()["id"]
        analysis_ids.append(aid)

        # Wait for job completion via explicit JobInfo._task completion
        from app.core.job_manager import job_manager
        job_info = job_manager.get_job(aid)
        if job_info is not None and job_info._task is not None:
            await asyncio.wait_for(job_info._task, timeout=15.0)

        detail = await client.get(f"/api/v1/analyses/{aid}")
        assert detail.status_code == 200
        assert detail.json()["status"] == "completed"
        if i == 0:
            gc.collect()
            rss_after_first = proc.memory_info().rss

    # Dispose all 20 analyses and verify storage cleanup
    for i, aid in enumerate(analysis_ids):
        del_resp = await client.delete(f"/api/v1/analyses/{aid}")
        assert del_resp.status_code == 200
        assert not storage_service.get_raw_path(aid, f"seq_{i}.wav").exists()
        assert not storage_service.get_processed_path(aid).exists()
        assert storage_service.load_embeddings(aid) is None

    gc.collect()
    rss_end = proc.memory_info().rss
    # Ensure no unbounded memory growth across uploads 2..20 after lazy imports settle
    assert (rss_end - rss_after_first) < 40 * 1024 * 1024
    assert len(proc.children(recursive=True)) == 0


@pytest.mark.asyncio
async def test_10_repeated_live_sessions_and_simultaneous_disconnects(stability_ws_server):
    """Run 10 live session cycles plus simultaneous mid-stream disconnects without orphan tasks."""
    http_url, ws_url, _ = stability_ws_server
    t = np.linspace(0, 3.0, 96000, endpoint=False, dtype=np.float32)
    pcm = (np.sin(2.0 * math.pi * 1500.0 * t) * 10000.0).astype("<i2")

    async with AsyncClient(base_url=http_url) as ac:
        for idx in range(10):
            resp = await ac.post(
                "/api/v1/live/sessions",
                json={"source_type": "browser_mic", "sample_rate": 32000, "channels": 1},
            )
            assert resp.status_code == 201
            sid = resp.json()["id"]
            async with websockets.connect(f"{ws_url}/api/v1/live/sessions/{sid}/stream") as ws:
                await asyncio.wait_for(ws.recv(), timeout=5.0)
                await asyncio.wait_for(ws.recv(), timeout=5.0)
                for seq in range(12):
                    await ws.send(struct.pack(">I", seq) + pcm[seq * 8000 : (seq + 1) * 8000].tobytes())
                await ws.send(json.dumps({"type": "stop"}))
                while True:
                    evt = json.loads(await asyncio.wait_for(ws.recv(), timeout=10.0))
                    if evt.get("type") == "session_stopped":
                        break
            state = live_session_manager.get_session(sid)
            assert state is not None and state.status == "stopped"
            assert state.inference_worker._worker_task is None

        # Simultaneous abrupt client disconnects mid-inference
        sids = []
        for _ in range(3):
            r = await ac.post(
                "/api/v1/live/sessions",
                json={"source_type": "browser_mic", "sample_rate": 32000, "channels": 1},
            )
            sids.append(r.json()["id"])

        async def _connect_and_drop(sid: str):
            async with websockets.connect(f"{ws_url}/api/v1/live/sessions/{sid}/stream") as ws:
                await asyncio.wait_for(ws.recv(), timeout=5.0)
                await asyncio.wait_for(ws.recv(), timeout=5.0)
                for seq in range(12):
                    await ws.send(struct.pack(">I", seq) + pcm[seq * 8000 : (seq + 1) * 8000].tobytes())
                # Abruptly close without sending stop

        await asyncio.gather(*[_connect_and_drop(s) for s in sids])
        await live_session_manager.shutdown(timeout=5.0)
        for s in sids:
            assert live_session_manager.get_session(s) is None


@pytest.mark.asyncio
async def test_job_cancellation_and_shutdown_while_queued():
    """Verify explicit job cancellation and graceful shutdown with queued jobs."""
    jm = JobManager(max_concurrent_jobs=1)
    started = asyncio.Event()
    release = asyncio.Event()
    cancelled_ids: list[str] = []

    async def _blocking_task(aid: str, _mgr: JobManager) -> None:
        started.set()
        try:
            await release.wait()
        except asyncio.CancelledError:
            cancelled_ids.append(aid)
            raise

    jm.register_job("job-1")
    jm.register_job("job-2")
    await jm.run_job("job-1", _blocking_task)
    await asyncio.wait_for(started.wait(), timeout=2.0)
    await jm.run_job("job-2", _blocking_task)

    # Cancel active job-1 and then shut down while job-2 is queued/pending
    assert jm.cancel_job("job-1") is True
    await jm.cancel_and_wait_all(timeout=5.0)
    assert "job-1" in cancelled_ids
    assert not any(j._task is not None and not j._task.done() for j in jm._jobs.values())


def test_faiss_consistency_after_repeated_updates():
    """Verify FAISS IndexFlatIP remains consistent with EmbeddingIndexService across updates."""
    from app.services.acoustic_memory.similarity_service import AcousticSimilarityService

    idx = EmbeddingIndexService()
    sim = AcousticSimilarityService(index_service=idx)
    engine = AcousticMemoryEngine(index_service=idx, sim_service=sim)
    rng = np.random.default_rng(99)

    for round_no in range(5):
        for i in range(10):
            idx.add_vector(
                f"seg-{i}",
                rng.standard_normal(1280, dtype=np.float32),
                SegmentMetadata(segment_id=f"seg-{i}", session_id=f"r-{round_no}"),
            )
        ntotal = engine.sync_faiss_index()
        assert ntotal == 10
        q = idx.get_vector("seg-3", normalized=False)
        faiss_res = engine.search_faiss(query_vector=q, limit=3)
        np_res = engine.search_numpy(query_vector=q, limit=3)
        assert [r.segment_id for r in faiss_res] == [r.segment_id for r in np_res]
