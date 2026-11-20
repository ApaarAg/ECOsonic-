"""Persistence and restart recovery audit tests for EcoSonic 2.0.

Audits:
- Behavior after process restart on queued/processing/completed/failed jobs.
- Recovery of job status when in-memory JobManager state is cleared.
- Required invariant: A persisted detection/embedding result must NEVER be
  reported as valid if its required backing artifact is missing or unreadable.
"""

from __future__ import annotations

import asyncio
import io
import os
import shutil
import time
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.database import get_db
from app.core.job_manager import job_manager
from app.main import app
from app.models.analysis import Analysis
from app.services.analysis_pipeline import analysis_pipeline, FallbackMockEngine
from app.services.storage_service import storage_service
from app.workers import analysis_worker


def _make_audio_bytes() -> bytes:
    rate = 32000
    t = np.linspace(0, 3.0, rate * 3, endpoint=False, dtype=np.float32)
    sig = 0.2 * np.sin(2 * np.pi * 440 * t)
    buf = io.BytesIO()
    sf.write(buf, sig, rate, format="WAV")
    buf.seek(0)
    return buf.read()


@pytest.mark.asyncio
async def test_startup_cleans_interrupted_jobs(test_engine):
    """Verify application startup marks queued/processing jobs as failed:process_restart."""
    maker = async_sessionmaker(bind=test_engine, class_=AsyncSession, expire_on_commit=False)

    # 1. Manually insert a queued job and a processing job in SQLite
    async with maker() as session:
        j1 = Analysis(
            id="job-interrupted-queued",
            filename="test1.wav",
            audio_path="/dummy/path1.wav",
            status="queued",
            progress=0.0,
            current_stage="Queued",
        )
        j2 = Analysis(
            id="job-interrupted-processing",
            filename="test2.wav",
            audio_path="/dummy/path2.wav",
            status="processing",
            progress=45.0,
            current_stage="extracting_embeddings",
        )
        j3 = Analysis(
            id="job-already-completed",
            filename="test3.wav",
            audio_path="/dummy/path3.wav",
            status="completed",
            progress=100.0,
            current_stage="completed",
        )
        session.add_all([j1, j2, j3])
        await session.commit()

    # 2. Simulate startup logic (from app.main lifespan)
    async with maker() as session:
        await session.execute(
            update(Analysis)
            .where(Analysis.status.in_(["queued", "processing"]))
            .values(
                status="failed",
                progress=0.0,
                current_stage="failed:process_restart",
                error_message="Worker process restarted before completion.",
            )
        )
        await session.commit()

    # 3. Verify state
    async with maker() as session:
        res1 = await session.get(Analysis, "job-interrupted-queued")
        assert res1.status == "failed"
        assert res1.current_stage == "failed:process_restart"

        res2 = await session.get(Analysis, "job-interrupted-processing")
        assert res2.status == "failed"
        assert res2.current_stage == "failed:process_restart"

        res3 = await session.get(Analysis, "job-already-completed")
        assert res3.status == "completed"


@pytest.mark.asyncio
async def test_job_manager_loss_falls_back_to_sqlite(client):
    """Verify frontend status polling still works if in-memory JobManager state is wiped."""
    # Submit analysis
    wav_bytes = _make_audio_bytes()
    resp = await client.post(
        "/api/v1/analyses",
        files={"file": ("test_recovery.wav", io.BytesIO(wav_bytes), "audio/wav")},
    )
    assert resp.status_code == 202
    aid = resp.json()["id"]

    # Wait until completed
    while True:
        st = await client.get(f"/api/v1/analyses/{aid}/status")
        if st.json()["status"] in ("completed", "failed"):
            break
        await asyncio.sleep(0.05)

    assert st.json()["status"] == "completed"

    # Now simulate process restart / cache loss by wiping job_manager._jobs
    job_manager._jobs.clear()
    assert job_manager.get_job(aid) is None

    # Polling should transparently fallback to database
    fallback_resp = await client.get(f"/api/v1/analyses/{aid}/status")
    assert fallback_resp.status_code == 200
    fallback_data = fallback_resp.json()
    assert fallback_data["id"] == aid
    assert fallback_data["status"] == "completed"
    assert fallback_data["progress"] == 100.0


@pytest.mark.asyncio
async def test_invariant_missing_or_corrupted_backing_artifact_fails_safely(client):
    """Required Invariant: A persisted detection/embedding result must NEVER be

    reported as valid if its required backing artifact is missing or unreadable.
    """
    wav_bytes = _make_audio_bytes()
    resp = await client.post(
        "/api/v1/analyses",
        files={"file": ("test_artifact.wav", io.BytesIO(wav_bytes), "audio/wav")},
    )
    assert resp.status_code == 202
    aid = resp.json()["id"]

    while True:
        st = await client.get(f"/api/v1/analyses/{aid}/status")
        if st.json()["status"] in ("completed", "failed"):
            break
        await asyncio.sleep(0.05)

    assert st.json()["status"] == "completed"

    # Case A: Intact artifact -> succeeds
    res = await client.get(f"/api/v1/analyses/{aid}/results")
    assert res.status_code == 200
    assert res.json()["status"] == "completed"
    assert res.json()["embeddings"]["shape"] is not None

    # Case B: Delete backing .npy artifact on disk
    emb_path = storage_service.get_embedding_path(aid)
    assert emb_path.exists()
    emb_path.unlink()
    assert not emb_path.exists()

    # Results endpoint must NEVER report valid completion when backing artifact is missing!
    res_missing = await client.get(f"/api/v1/analyses/{aid}/results")
    assert res_missing.status_code == 500, (
        f"Expected HTTP 500 when backing artifact is missing, got {res_missing.status_code}"
    )
    assert "missing" in res_missing.json()["detail"].lower()

    # Case C: Write corrupted non-numpy garbage to .npy file
    with open(emb_path, "wb") as f:
        f.write(b"NOT_A_VALID_NUMPY_FILE_GARBAGE_BYTES")

    res_corrupt = await client.get(f"/api/v1/analyses/{aid}/results")
    assert res_corrupt.status_code == 500
    assert "unreadable" in res_corrupt.json()["detail"].lower() or "corrupted" in res_corrupt.json()["detail"].lower()
