"""API contract audit test suite covering every /api/v1 endpoint.

Tests:
- valid request
- malformed request
- nonexistent ID
- invalid parameters
- error response formats
"""

from __future__ import annotations

import io
import uuid
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_api_contract_analyses_endpoints(client: AsyncClient):
    """Audit /api/v1/analyses endpoints."""
    # 1. Nonexistent analysis ID
    non_existent = str(uuid.uuid4())
    resp = await client.get(f"/api/v1/analyses/{non_existent}")
    assert resp.status_code == 404
    assert "detail" in resp.json()

    # 2. Nonexistent analysis status
    resp = await client.get(f"/api/v1/analyses/{non_existent}/status")
    assert resp.status_code == 404
    assert "detail" in resp.json()

    # 3. Nonexistent results
    resp = await client.get(f"/api/v1/analyses/{non_existent}/results")
    assert resp.status_code == 404

    # 4. Nonexistent detections
    resp = await client.get(f"/api/v1/analyses/{non_existent}/detections")
    assert resp.status_code == 404

    # 5. Nonexistent embeddings download
    resp = await client.get(f"/api/v1/analyses/{non_existent}/embeddings/download")
    assert resp.status_code == 404

    # 6. Invalid query parameters on list
    resp = await client.get("/api/v1/analyses?page=0")  # page ge 1
    assert resp.status_code == 422  # Pydantic validation error

    resp = await client.get("/api/v1/analyses?page_size=200")  # max 100
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_api_contract_detections_endpoints(client: AsyncClient):
    """Audit /api/v1/detections endpoints."""
    non_existent = str(uuid.uuid4())

    # 1. Nonexistent detection ID
    resp = await client.get(f"/api/v1/detections/{non_existent}")
    assert resp.status_code == 404
    assert "detail" in resp.json()

    # 2. Review on nonexistent detection
    resp = await client.post(
        f"/api/v1/detections/{non_existent}/reviews",
        json={"review_status": "confirmed", "reviewer_note": "Great catch"},
    )
    assert resp.status_code == 404

    # 3. Invalid review status value
    resp = await client.post(
        f"/api/v1/detections/{non_existent}/reviews",
        json={"review_status": "SUPER_VALID"},
    )
    assert resp.status_code == 422  # Enum validation error

    # 4. Invalid min_confidence filter
    resp = await client.get("/api/v1/detections?min_confidence=1.5")
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_api_contract_sites_endpoints(client: AsyncClient):
    """Audit /api/v1/sites endpoints."""
    non_existent = str(uuid.uuid4())

    # 1. Nonexistent site
    resp = await client.get(f"/api/v1/sites/{non_existent}")
    assert resp.status_code == 404

    # 2. Malformed site creation (missing required latitude/longitude)
    resp = await client.post("/api/v1/sites", json={"name": "Incomplete Site"})
    assert resp.status_code == 422

    # 3. Invalid coordinates (latitude > 90)
    resp = await client.post(
        "/api/v1/sites",
        json={"name": "Invalid Site", "latitude": 95.0, "longitude": 12.0},
    )
    assert resp.status_code == 422

    # 4. Delete nonexistent site
    resp = await client.delete(f"/api/v1/sites/{non_existent}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_api_contract_acoustic_endpoints(client: AsyncClient):
    """Audit /api/v1/acoustic endpoints."""
    non_existent = str(uuid.uuid4())

    # 1. Inspect non-existent analysis
    resp = await client.get(f"/api/v1/acoustic/inspect/{non_existent}")
    assert resp.status_code == 404

    # 2. Stream non-existent analysis
    resp = await client.get(f"/api/v1/acoustic/stream/{non_existent}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_api_contract_reports_endpoints(client: AsyncClient):
    """Audit /api/v1/reports endpoints."""
    # 1. Summary report
    resp = await client.get("/api/v1/reports/summary")
    assert resp.status_code == 200
    data = resp.json()
    assert "analyses" in data
    assert "detections" in data
    assert "reviews" in data
    assert "top_species" in data

    # 2. Export CSV
    resp_csv = await client.get("/api/v1/reports/export")
    assert resp_csv.status_code == 200
    assert "text/csv" in resp_csv.headers["content-type"]
    assert "detection_id,analysis_id" in resp_csv.text
