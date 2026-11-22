"""Reliability, offline model cache validation, and worker lifecycle regression tests."""

from __future__ import annotations

import asyncio
import io
import os
import time
from pathlib import Path
import pytest
from httpx import AsyncClient

from app.core.job_manager import JobManager, job_manager
from app.services.birdnet_engine import BirdNetEngine, BirdNetEngineError
from app.services.live.session_manager import live_session_manager
from app.main import app


def test_offline_model_cache_fails_fast_when_missing(tmp_path: Path, monkeypatch):
    """Verify that BirdNetEngine fails fast without network access when cache is missing."""
    empty_dir = tmp_path / "empty_cache"
    empty_dir.mkdir()
    monkeypatch.setenv("BIRDNET_APP_DATA", str(empty_dir))

    engine = BirdNetEngine(precision="fp32")
    t0 = time.perf_counter()
    with pytest.raises(BirdNetEngineError, match="model artifact was not found in cache"):
        engine.validate_offline_model_cache()
    elapsed = time.perf_counter() - t0
    # Must fail fast in milliseconds, never hang on network download
    assert elapsed < 0.1, f"Expected fail-fast in <100ms, took {elapsed:.3f}s"


def test_offline_model_cache_succeeds_with_valid_cache():
    """Verify that the existing project .model_cache is detected and validated."""
    model_cache = Path(".model_cache").resolve()
    if not model_cache.is_dir():
        model_cache = Path(__file__).resolve().parents[2] / ".model_cache"

    assert model_cache.is_dir(), f".model_cache directory not found at {model_cache}"

    engine = BirdNetEngine(precision="fp32")
    model_file = engine.validate_offline_model_cache()
    assert model_file.exists()
    assert model_file.stat().st_size > 300_000_000  # ~345 MB


@pytest.mark.asyncio
async def test_job_manager_cancel_and_wait_all_lifecycle():
    """Verify that cancel_and_wait_all cleanly cancels active jobs and awaits their completion."""
    jm = JobManager(max_concurrent_jobs=3)

    started_events = [asyncio.Event() for _ in range(3)]
    finish_events = [asyncio.Event() for _ in range(3)]

    async def sample_worker(jid: str, manager: JobManager):
        idx = int(jid.split("-")[-1])
        started_events[idx].set()
        try:
            await asyncio.sleep(5.0)
        finally:
            finish_events[idx].set()

    for i in range(3):
        jid = f"job-{i}"
        jm.register_job(jid)
        await jm.run_job(jid, sample_worker)

    # Wait for all workers to start
    await asyncio.gather(*(e.wait() for e in started_events))

    # Cancel and wait for all workers
    t0 = time.perf_counter()
    await jm.cancel_and_wait_all(timeout=2.0)
    elapsed = time.perf_counter() - t0

    # Ensure all workers executed their finally blocks and were awaited
    assert all(e.is_set() for e in finish_events)
    assert elapsed < 1.0, f"Expected fast cancellation, took {elapsed:.3f}s"

    for i in range(3):
        job = jm.get_job(f"job-{i}")
        assert job.status == "cancelled"


@pytest.mark.asyncio
async def test_job_manager_wait_for_job():
    """Verify that wait_for_job awaits until job completion."""
    jm = JobManager(max_concurrent_jobs=2)
    jid = "fast-job"

    async def fast_worker(job_id: str, manager: JobManager):
        await asyncio.sleep(0.05)

    await jm.run_job(jid, fast_worker)
    completed_job = await jm.wait_for_job(jid, timeout=1.0)
    assert completed_job is not None
    assert completed_job.status == "completed"


@pytest.mark.asyncio
async def test_api_upload_worker_clean_teardown_regression(client: AsyncClient):
    """Regression test: submitting an analysis job and immediately tearing down the fixture
    must cancel and await the worker task without SQLite database deadlocks.
    """
    smoke_file = Path("backend/data/smoke_audio/cicada_orni.ogg")
    if not smoke_file.exists():
        smoke_file = Path("data/smoke_audio/cicada_orni.ogg")

    assert smoke_file.exists(), f"Audio file {smoke_file} missing"
    with open(smoke_file, "rb") as f:
        file_bytes = f.read()

    files = {"file": ("cicada_orni.ogg", file_bytes, "audio/ogg")}
    data = {"latitude": 45.0, "longitude": 9.0}

    res = await client.post("/api/v1/analyses", files=files, data=data)
    assert res.status_code == 202
    analysis_id = res.json()["id"]

    # Immediately cancel and wait for all background tasks before fixture exit
    await job_manager.cancel_and_wait_all(timeout=3.0)

    # Verify job state is recorded as cancelled
    job = job_manager.get_job(analysis_id)
    assert job is not None
    assert job.status in ("cancelled", "completed")


@pytest.mark.asyncio
async def test_health_endpoint_reports_model_readiness(client: AsyncClient):
    """Verify that /health exposes model status and readiness fields."""
    res = await client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "healthy"
    assert "model_ready" in data
    assert "model_device" in data


@pytest.mark.asyncio
async def test_live_session_manager_shutdown(test_engine):
    """Verify that live_session_manager.shutdown cancels active sessions and their workers."""
    session_id = "test-shutdown-sess"
    state = await live_session_manager.create_session(session_id=session_id)
    assert state.status == "created"

    # Start session
    await live_session_manager.start_session(session_id)
    assert state.status == "active"
    assert state.inference_worker._running is True

    # Shutdown
    await live_session_manager.shutdown(timeout=2.0)
    assert state.inference_worker._running is False
    assert live_session_manager.get_session(session_id) is None
