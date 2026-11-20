"""Deliberate real-model API acceptance run; excluded from the fast unit suite."""

import asyncio
import json
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app.services.analysis_pipeline import analysis_pipeline


@pytest.mark.real_model
@pytest.mark.asyncio
async def test_three_real_recordings_through_upload_api(client):
    analysis_pipeline.set_engine(None)
    analysis_pipeline.load()
    root = Path(__file__).resolve().parents[2]
    manifest = json.loads((root / "backend/data/smoke_audio/sources.json").read_text())
    files = [root / "backend/data/smoke_audio" / item["file"] for item in manifest["recordings"]]
    assert len(files) == 3
    api_results = []

    for audio_path in files:
        with audio_path.open("rb") as audio:
            response = await client.post(
                "/api/v1/analyses",
                files={"file": (audio_path.name, audio, "audio/ogg")},
            )
        assert response.status_code == 202, response.text
        analysis_id = response.json()["id"]

        status = None
        observed_stages = set()
        for _ in range(360):
            # Poll the public analysis resource, as frontend clients do.
            status_response = await client.get(f"/api/v1/analyses/{analysis_id}")
            assert status_response.status_code == 200
            status = status_response.json()
            observed_stages.add(status.get("current_stage"))
            if status["status"] in {"completed", "failed"}:
                break
            await asyncio.sleep(0.5)
        assert status and status["status"] == "completed", status

        results = await client.get(f"/api/v1/analyses/{analysis_id}/results")
        detections = await client.get(f"/api/v1/analyses/{analysis_id}/detections")
        assert results.status_code == detections.status_code == 200
        payload = results.json()
        assert payload["status"] == "completed"
        assert payload["detections"] and detections.json()

        embedding_file = Path(payload["embeddings"]["path"])
        assert embedding_file.is_file()
        vectors = np.load(embedding_file, allow_pickle=False)
        assert vectors.shape == tuple(payload["embeddings"]["shape"])
        assert vectors.shape[1] == 1280 and vectors.dtype == np.float32
        assert np.isfinite(vectors).all()
        assert len(payload["embeddings"]["segments"]) == len(vectors)
        duration = sf.info(audio_path).duration
        assert all(0 <= row["start_seconds"] < duration + 0.1 for row in payload["embeddings"]["segments"])
        assert all(row["end_seconds"] > row["start_seconds"] for row in payload["embeddings"]["segments"])

        detail = await client.get(f"/api/v1/analyses/{analysis_id}")
        assert detail.status_code == 200
        metrics = detail.json()["metrics_json"]
        assert metrics["execution_provider"] in {"GPU", "CPU"}
        assert {"queued", "validating_audio", "preprocessing", "birdnet_inference",
                "saving_detections", "extracting_embeddings", "saving_embeddings",
                "completed"}.issubset(metrics["stage_history"])
        processed_info = sf.info(detail.json()["processed_path"])
        assert processed_info.samplerate == 32000 and processed_info.channels == 1
        api_results.append({
            "file": audio_path.name,
            "analysis_id": analysis_id,
            "status": payload["status"],
            "recording_duration_seconds": duration,
            "processed_audio": {"sample_rate_hz": processed_info.samplerate,
                                "channels": processed_info.channels,
                                "duration_seconds": processed_info.duration},
            "prediction_count": len(payload["detections"]),
            "database_detection_count": len(detections.json()),
            "top_detections": sorted(payload["detections"],
                                      key=lambda d: d["confidence_score"], reverse=True)[:5],
            "embedding_shape": list(vectors.shape),
            "embedding_dtype": str(vectors.dtype),
            "embedding_finite": bool(np.isfinite(vectors).all()),
            "embedding_segments": len(payload["embeddings"]["segments"]),
            "execution_provider": metrics["execution_provider"],
            "stage_history": metrics["stage_history"],
            "timings": metrics["timings"],
            "model_initialization_seconds": metrics["model_initialization_seconds"],
            "peak_rss_bytes": metrics["peak_rss_bytes"],
        })
    output_path = root / "backend" / "test_results" / "phase2_api_integration.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps({"status": "PASS", "recordings": api_results}, indent=2), encoding="utf-8")
