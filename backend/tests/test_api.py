import io
from pathlib import Path
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_and_root(client: AsyncClient):
    res = await client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "healthy"
    assert "version" in data

    res_root = await client.get("/")
    assert res_root.status_code == 200
    assert "EcoSonic" in res_root.json()["message"]


@pytest.mark.asyncio
async def test_sites_api_flow(client: AsyncClient):
    payload = {
        "name": "Bwindi Impenetrable Forest",
        "latitude": -1.05,
        "longitude": 29.62,
        "description": "High altitude rainforest acoustic station",
    }
    create_res = await client.post("/api/v1/sites", json=payload)
    assert create_res.status_code == 201
    site = create_res.json()
    assert site["name"] == payload["name"]
    site_id = site["id"]

    # Get site
    get_res = await client.get(f"/api/v1/sites/{site_id}")
    assert get_res.status_code == 200
    assert get_res.json()["latitude"] == -1.05

    # List sites
    list_res = await client.get("/api/v1/sites")
    assert list_res.status_code == 200
    assert list_res.json()["total"] >= 1

    # Delete site
    del_res = await client.delete(f"/api/v1/sites/{site_id}")
    assert del_res.status_code == 200


@pytest.mark.asyncio
async def test_analyses_upload_and_pipeline_flow(client: AsyncClient):
    smoke_file = Path("backend/data/smoke_audio/cicada_orni.ogg")
    if not smoke_file.exists():
        smoke_file = Path("data/smoke_audio/cicada_orni.ogg")

    assert smoke_file.exists()

    with open(smoke_file, "rb") as f:
        file_bytes = f.read()

    files = {"file": ("cicada_orni.ogg", file_bytes, "audio/ogg")}
    data = {
        "latitude": 43.65,
        "longitude": 10.42,
        "model_version": "BirdNET+ V3.0",
    }

    res = await client.post("/api/v1/analyses", files=files, data=data)
    assert res.status_code == 202
    analysis = res.json()
    analysis_id = analysis["id"]
    assert analysis["status"] in ["queued", "processing", "completed"]

    # Poll status
    status_res = await client.get(f"/api/v1/analyses/{analysis_id}/status")
    assert status_res.status_code == 200

    # Wait briefly or check details
    detail_res = await client.get(f"/api/v1/analyses/{analysis_id}")
    assert detail_res.status_code == 200
    assert detail_res.json()["filename"] == "cicada_orni.ogg"


@pytest.mark.asyncio
async def test_reports_summary_and_export(client: AsyncClient):
    res = await client.get("/api/v1/reports/summary")
    assert res.status_code == 200
    summary = res.json()
    assert "analyses" in summary
    assert "detections" in summary

    export_res = await client.get("/api/v1/reports/export")
    assert export_res.status_code == 200
    assert "text/csv" in export_res.headers.get("content-type", "")
    assert "detection_id,analysis_id" in export_res.text
