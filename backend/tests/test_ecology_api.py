"""
Integration tests for the /api/v1/ecology/observation-gap API endpoint.
"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_ecology_observation_gap_api_endpoint(client: AsyncClient):
    """
    Test POST /api/v1/ecology/observation-gap:
    - 1. Creates a live session via /api/v1/live/sessions.
    - 2. Calls POST /api/v1/ecology/observation-gap for that session.
    - 3. Verifies HTTP 200, valid payload contract, and non-detection disclaimers.
    """
    # 1. Create a session first
    session_res = await client.post(
        "/api/v1/live/sessions",
        json={
            "source_type": "desktop_mic",
            "device_id": "test_mic",
            "latitude": 47.86,
            "longitude": -123.93,
            "sample_rate": 32000,
            "channels": 1,
        },
    )
    assert session_res.status_code == 201
    session_id = session_res.json()["id"]

    # 2. Query observation gap endpoint
    payload = {
        "session_id": session_id,
        "latitude": 47.86,
        "longitude": -123.93,
        "min_occurrence_score": 0.08,
        "min_confidence": 0.25,
        "include_ai_interpretation": False,  # Deterministic rule engine fallback
    }

    response = await client.post("/api/v1/ecology/observation-gap", json=payload)
    assert response.status_code == 200

    data = response.json()
    assert data["session_id"] == session_id
    assert "context" in data
    assert "coverage" in data
    assert "expected_and_detected" in data
    assert "expected_but_not_detected" in data
    assert "detected_unexpected" in data
    assert "scientific_disclaimer" in data
    assert "Acoustic non-detection does NOT establish biological absence" in data["scientific_disclaimer"]

    # Check coverage structure
    cov = data["coverage"]
    assert cov["metric_name"] == "Acoustic Observation Coverage"
    assert "coverage_percentage" in cov
    assert "observation_adequacy" in cov
    assert "disclaimer" in cov
