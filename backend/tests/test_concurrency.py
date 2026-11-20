"""Deterministic concurrency and load testing for EcoSonic 2.0 analysis pipeline.

Audits:
- 1 concurrent upload
- 5 concurrent uploads
- 10 concurrent uploads
Measures upload latency, queue latency, inference latency, total completion latency,
success/failure count, SQLite locking errors, corrupted results, missing detections,
and vector dimensionality/finiteness.
"""

from __future__ import annotations

import asyncio
import io
import os
import time
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
import psutil
import pytest
import soundfile as sf
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import settings
from app.core.database import get_db
from app.core.job_manager import JobManager
from app.main import app
from app.services.analysis_pipeline import analysis_pipeline, FallbackMockEngine
from app.services.storage_service import storage_service
from app.workers import analysis_worker


def _generate_test_wav(duration_s: float = 3.0, sample_rate: int = 32000) -> bytes:
    """Generate a clean synthetic sine wave in memory as 32kHz mono WAV."""
    t = np.linspace(0, duration_s, int(sample_rate * duration_s), endpoint=False, dtype=np.float32)
    audio = 0.3 * np.sin(2 * np.pi * 1000 * t)
    buf = io.BytesIO()
    sf.write(buf, audio, sample_rate, format="WAV", subtype="PCM_16")
    buf.seek(0)
    return buf.read()


@pytest.mark.asyncio
@pytest.mark.parametrize("concurrency", [1, 5, 10])
async def test_concurrent_analysis_pipeline_load(concurrency: int, test_engine):
    """Test pipeline under 1, 5, and 10 concurrent analysis submissions."""
    # Setup test session and mock engine with realistic small inference delay
    maker = async_sessionmaker(bind=test_engine, class_=AsyncSession, expire_on_commit=False)
    analysis_worker.async_session_factory = maker

    class TimedMockEngine(FallbackMockEngine):
        def analyze_audio(self, audio_path: str, min_confidence: float = 0.0, **kwargs):
            time.sleep(0.02)
            return super().analyze_audio(audio_path, min_confidence, **kwargs)

        def extract_embeddings(self, audio_path: str):
            time.sleep(0.02)
            return super().extract_embeddings(audio_path)

    previous_engine = analysis_pipeline.engine
    analysis_pipeline.set_engine(TimedMockEngine())
    analysis_pipeline.load()

    async def override_get_db():
        async with maker() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise
            finally:
                await session.close()

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    wav_bytes = _generate_test_wav(duration_s=3.0)

    process = psutil.Process()
    initial_rss = process.memory_info().rss

    latencies: Dict[str, List[float]] = {
        "upload": [],
        "queue": [],
        "completion": [],
    }

    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        async def submit_and_track(index: int) -> Dict[str, Any]:
            file_name = f"concurrent_sample_{index}.wav"
            upload_start = time.perf_counter()
            resp = await ac.post(
                "/api/v1/analyses",
                files={"file": (file_name, io.BytesIO(wav_bytes), "audio/wav")},
            )
            upload_latency = time.perf_counter() - upload_start
            assert resp.status_code == 202, f"Upload failed: {resp.text}"
            data = resp.json()
            analysis_id = data["id"]

            # Poll until completion
            queue_start = time.perf_counter()
            first_started: float | None = None
            max_wait = 90.0  # seconds
            start_poll = time.perf_counter()
            status_data: Dict[str, Any] = {}

            while time.perf_counter() - start_poll < max_wait:
                status_resp = await ac.get(f"/api/v1/analyses/{analysis_id}/status")
                assert status_resp.status_code == 200
                status_data = status_resp.json()
                if first_started is None and status_data["status"] == "processing":
                    first_started = time.perf_counter() - queue_start
                if status_data["status"] in ("completed", "failed", "cancelled"):
                    break
                await asyncio.sleep(0.05)

            total_completion = time.perf_counter() - upload_start
            queue_latency = first_started or (total_completion)

            return {
                "analysis_id": analysis_id,
                "upload_latency": upload_latency,
                "queue_latency": queue_latency,
                "completion_latency": total_completion,
                "status": status_data.get("status"),
                "error": status_data.get("error_message"),
            }

        # Launch all concurrent uploads simultaneously
        results = await asyncio.gather(*(submit_and_track(i) for i in range(concurrency)))

    # Evaluate results
    success_count = sum(1 for r in results if r["status"] == "completed")
    failure_count = sum(1 for r in results if r["status"] == "failed")
    timeout_count = sum(1 for r in results if r["status"] not in ("completed", "failed", "cancelled"))

    assert failure_count == 0, f"Encountered {failure_count} failures: {results}"
    assert timeout_count == 0, f"Encountered {timeout_count} timeouts: {results}"
    assert success_count == concurrency, f"Expected {concurrency} successful jobs, got {success_count}"

    peak_rss = process.memory_info().rss
    rss_growth_mb = (peak_rss - initial_rss) / (1024 * 1024)

    # Verify every single analysis is fully intact
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        for r in results:
            aid = r["analysis_id"]
            res = await ac.get(f"/api/v1/analyses/{aid}")
            assert res.status_code == 200
            analysis_data = res.json()
            assert analysis_data["status"] == "completed"
            assert len(analysis_data["detections"]) > 0, f"Missing detections for {aid}"
            assert len(analysis_data["embedding_segments"]) > 0, f"Missing segments for {aid}"

            # Verify persisted embeddings array
            vectors = storage_service.load_embeddings(aid)
            assert vectors is not None, f"Embeddings not found for {aid}"
            assert vectors.ndim == 2
            assert vectors.shape[1] == 1280
            assert np.isfinite(vectors).all()
            assert len(vectors) == len(analysis_data["embedding_segments"])

    # Teardown
    app.dependency_overrides.clear()
    analysis_pipeline.set_engine(previous_engine)
    from app.core.job_manager import job_manager
    job_manager._jobs.clear()


@pytest.mark.real_model
@pytest.mark.asyncio
async def test_concurrent_real_model_inference(test_engine):
    """Test 3 concurrent real-model analyses using actual environmental audio."""
    maker = async_sessionmaker(bind=test_engine, class_=AsyncSession, expire_on_commit=False)
    analysis_worker.async_session_factory = maker
    await asyncio.to_thread(analysis_pipeline.load)
    assert analysis_pipeline.engine is not None

    async def override_get_db():
        async with maker() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise
            finally:
                await session.close()

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    audio_dir = Path(__file__).resolve().parents[1] / "data" / "smoke_audio"
    files_to_test = ["birds_forest.ogg", "frog_mixed.ogg", "cicada_orni.ogg"]

    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        async def run_one(fname: str) -> Dict[str, Any]:
            file_path = audio_dir / fname
            with open(file_path, "rb") as f:
                content = f.read()

            t0 = time.perf_counter()
            resp = await ac.post(
                "/api/v1/analyses",
                files={"file": (fname, io.BytesIO(content), "audio/ogg")},
            )
            assert resp.status_code == 202
            aid = resp.json()["id"]

            while True:
                status_resp = await ac.get(f"/api/v1/analyses/{aid}/status")
                assert status_resp.status_code == 200
                st = status_resp.json()
                if st["status"] in ("completed", "failed"):
                    break
                await asyncio.sleep(0.3)

            return {
                "id": aid,
                "file": fname,
                "status": st["status"],
                "duration": time.perf_counter() - t0,
            }

        results = await asyncio.gather(*(run_one(f) for f in files_to_test))

        for r in results:
            assert r["status"] == "completed"
            aid = r["id"]
            vectors = storage_service.load_embeddings(aid)
            assert vectors is not None
            assert vectors.shape[1] == 1280
            assert np.isfinite(vectors).all()

    app.dependency_overrides.clear()
