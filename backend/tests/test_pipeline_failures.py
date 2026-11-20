import asyncio
from pathlib import Path
import pytest

from app.services.analysis_pipeline import analysis_pipeline


class FailingInferenceEngine:
    def load(self):
        return None

    def predict(self, audio_path):
        raise RuntimeError("synthetic inference failure for test")


@pytest.mark.asyncio
async def test_failed_inference_is_recorded_and_original_upload_is_retained(client):
    analysis_pipeline.set_engine(FailingInferenceEngine())
    analysis_pipeline.load()
    sample = Path("backend/data/smoke_audio/cicada_orni.ogg")
    if not sample.exists():
        sample = Path("data/smoke_audio/cicada_orni.ogg")
    with sample.open("rb") as audio:
        response = await client.post(
            "/api/v1/analyses",
            files={"file": ("cicada_orni.ogg", audio, "audio/ogg")},
        )
    assert response.status_code == 202
    analysis_id = response.json()["id"]
    status = None
    for _ in range(40):
        status = (await client.get(f"/api/v1/analyses/{analysis_id}/status")).json()
        if status["status"] in {"failed", "completed"}:
            break
        await asyncio.sleep(0.05)
    assert status["status"] == "failed"
    detail = (await client.get(f"/api/v1/analyses/{analysis_id}")).json()
    assert detail["current_stage"] == "failed:birdnet_inference"
    assert detail["error_message"] == "RuntimeError during birdnet_inference"
    assert Path(detail["audio_path"]).is_file()
