"""Comprehensive End-to-End Backend QA Tests:
- Paired geospatial coordinate validation (valid / missing / partial / out-of-range)
- Honest geospatial context derivation (location, season, ecological band, reference status)
- Species image resolution, open-license enforcement, SQLite DB caching, and graceful unavailable fallback
- Full audio upload -> analysis execution -> DB persistence -> results retrieval pipeline
"""

from __future__ import annotations

import asyncio
import math
import struct
import wave
from pathlib import Path
from typing import Any, Dict

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.species_image_service import (
    SpeciesImageService,
    _is_open_license,
    species_image_service,
)


def _make_wav_bytes(duration_sec: float = 3.2, sample_rate: int = 32000) -> bytes:
    """Create a valid mono 16-bit PCM WAV byte payload."""
    import io

    n_samples = int(duration_sec * sample_rate)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        frames = bytearray()
        for i in range(n_samples):
            val = int(8000 * math.sin(2.0 * math.pi * 2400.0 * (i / sample_rate)))
            frames.extend(struct.pack("<h", val))
        wf.writeframes(bytes(frames))
    return buf.getvalue()


async def _wait_for_analysis_terminal(
    client: AsyncClient,
    analysis_id: str,
    timeout_sec: float = 12.0,
) -> Dict[str, Any]:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_sec
    last_payload: Dict[str, Any] = {}
    while loop.time() < deadline:
        res = await client.get(f"/api/v1/analyses/{analysis_id}/status")
        assert res.status_code == 200
        last_payload = res.json()
        if last_payload["status"] in ("completed", "failed"):
            return last_payload
        await asyncio.sleep(0.1)
    raise AssertionError(f"Analysis {analysis_id} timed out; last status: {last_payload}")


@pytest.mark.asyncio
async def test_paired_coordinate_validation_on_analyses_and_live_sessions(
    client: AsyncClient,
):
    wav_bytes = _make_wav_bytes()

    # 1. Partial coordinates (latitude only without longitude) -> 422 on POST /analyses
    res_partial = await client.post(
        "/api/v1/analyses",
        files={"file": ("partial.wav", wav_bytes, "audio/wav")},
        data={"latitude": "47.86"},
    )
    assert res_partial.status_code == 422

    # 2. Out-of-range coordinates -> 422 on POST /analyses
    res_oob = await client.post(
        "/api/v1/analyses",
        files={"file": ("oob.wav", wav_bytes, "audio/wav")},
        data={"latitude": "91.5", "longitude": "-123.93"},
    )
    assert res_oob.status_code == 422

    # 3. Partial coordinates -> 422 on POST /live/sessions
    res_live_partial = await client.post(
        "/api/v1/live/sessions",
        json={
            "source_type": "browser_mic",
            "device_id": "test",
            "latitude": 47.86,
        },
    )
    assert res_live_partial.status_code == 422


@pytest.mark.asyncio
async def test_analysis_without_coordinates_marks_geospatial_unavailable_without_fake_species(
    client: AsyncClient,
):
    wav_bytes = _make_wav_bytes()
    upload = await client.post(
        "/api/v1/analyses",
        files={"file": ("no_coords.wav", wav_bytes, "audio/wav")},
    )
    assert upload.status_code == 202
    analysis_id = upload.json()["id"]

    status_payload = await _wait_for_analysis_terminal(client, analysis_id)
    assert status_payload["status"] == "completed", status_payload

    results_res = await client.get(f"/api/v1/analyses/{analysis_id}/results")
    assert results_res.status_code == 200
    data = results_res.json()

    assert data["latitude"] is None
    assert data["longitude"] is None
    assert data["geospatial_context"]["reference_status"] == "unavailable"
    assert data["expected_species"]["status"] == "location_unspecified"
    assert data["expected_species"]["expected_species_status"] == "reference_unavailable"
    assert not data["expected_species"].get("expected_species")
    assert data["observation_gap"]["coverage"]["observation_adequacy"] == "location_unspecified"
    assert "geographic coordinates" in (data["observation_gap"]["coverage"]["adequacy_explanation"] or "").lower()


@pytest.mark.asyncio
async def test_analysis_with_real_smoke_audio_and_geospatial_context_populates_full_results(
    client: AsyncClient,
):
    smoke_wav = (
        Path(__file__).resolve().parents[1]
        / "data"
        / "smoke_audio"
        / "birds_forest_e2e.wav"
    )
    payload_bytes = smoke_wav.read_bytes() if smoke_wav.exists() else _make_wav_bytes(3.5)

    upload = await client.post(
        "/api/v1/analyses",
        files={"file": ("birds_forest_e2e.wav", payload_bytes, "audio/wav")},
        data={
            "latitude": "48.40",
            "longitude": "2.70",
            "recorded_at": "2026-05-15T06:30:00Z",
        },
    )
    assert upload.status_code == 202
    analysis_id = upload.json()["id"]

    status_payload = await _wait_for_analysis_terminal(client, analysis_id)
    assert status_payload["status"] == "completed", status_payload

    results_res = await client.get(f"/api/v1/analyses/{analysis_id}/results")
    assert results_res.status_code == 200
    data = results_res.json()

    assert data["analysis_id"] == analysis_id
    assert data["filename"] == "birds_forest_e2e.wav"
    assert data["latitude"] == pytest.approx(48.40)
    assert data["longitude"] == pytest.approx(2.70)

    geo = data["geospatial_context"]
    assert geo["reference_status"] == "available"
    assert geo["location"]["latitude"] == pytest.approx(48.40)
    assert geo["location"]["longitude"] == pytest.approx(2.70)
    assert "spring" in geo["temporal_context"]["season"]
    assert geo["temporal_context"]["meteorological_week"] is not None
    assert geo["ecological_context"]["occurrence_basis"] == "species_expected_from_reference"

    # Expected species come from real BirdNET Geo V3.0 for Northern Hemisphere temperate band
    exp_sec = data["expected_species"]
    assert exp_sec["status"] == "available"
    expected_list = exp_sec["expected_species"]
    assert isinstance(expected_list, list)
    assert len(expected_list) > 0
    first_expected = expected_list[0]
    assert "image" in first_expected
    assert first_expected["image"]["image_status"] in ("available", "unavailable")

    gap = data["observation_gap"]
    assert gap is not None
    assert "coverage" in gap
    assert "observed" in gap
    assert "not_detected" in gap
    assert "not_expected" in gap
    assert "Acoustic non-detection does NOT establish biological absence" in gap["scientific_disclaimer"]

    # Detections + species + context cards populated consistently
    assert isinstance(data["species"], dict)
    assert isinstance(data["disturbance"], dict)
    assert "context" in data and data["context"] is not None


@pytest.mark.asyncio
async def test_species_image_service_provenance_sqlite_cache_and_failure_fallback(
    test_session: AsyncSession,
):
    assert _is_open_license("CC BY-SA 4.0") is True
    assert _is_open_license("Public domain") is True
    assert _is_open_license("All rights reserved") is False

    # 1. Local curated image resolves immediately without network calls
    call_count = 0

    def counting_fetcher(scientific_name: str, common_name: str | None) -> Dict[str, Any]:
        nonlocal call_count
        call_count += 1
        if scientific_name.lower() == "sturnus vulgaris":
            return {
                "image_status": "available",
                "url": "https://upload.wikimedia.org/wikipedia/commons/4/45/Sturnus_vulgaris.jpg",
                "source": "Wikimedia Commons",
                "license": "CC BY-SA 3.0",
                "attribution": "Mdf",
                "source_url": "https://commons.wikimedia.org/wiki/File:Sturnus_vulgaris.jpg",
                "retrieved_at": "2026-11-27T00:00:00Z",
            }
        raise RuntimeError("Simulated upstream HTTP failure")

    service = SpeciesImageService(fetcher=counting_fetcher)

    local_img = await service.get_species_image(
        "Troglodytes pacificus",
        common_name="Pacific Wren",
        db=test_session,
    )
    assert local_img["image_status"] == "available"
    assert local_img["url"] == "/assets/specimens/pacific_wren.jpg"
    assert local_img["license"] == "CC BY-SA 2.0"
    assert call_count == 0

    # 2. First external fetch populates SQLite cache; second call after memory cache clear hits DB (no re-fetch)
    first = await service.get_species_image(
        "Sturnus vulgaris",
        common_name="Common Starling",
        db=test_session,
    )
    assert first["image_status"] == "available"
    assert first["source"] == "Wikimedia Commons"
    assert call_count == 1

    service.clear_memory_cache()
    second = await service.get_species_image(
        "Sturnus vulgaris",
        common_name="Common Starling",
        db=test_session,
    )
    assert second["image_status"] == "available"
    assert second["url"] == first["url"]
    assert call_count == 1  # Served strictly from SQLite cache

    # 3. External failure degrades honestly without raising
    failed = await service.get_species_image(
        "Nonexistentus imaginarius",
        common_name="Imaginary Bird",
        db=test_session,
    )
    assert failed["image_status"] == "unavailable"
    assert failed["url"] is None


@pytest.mark.asyncio
async def test_species_image_api_endpoint_and_graceful_unavailability(client: AsyncClient):
    # Curated local taxon -> HTTP 200 available
    res_local = await client.get(
        "/api/v1/ecology/species-image",
        params={"scientific_name": "Troglodytes pacificus", "common_name": "Pacific Wren"},
    )
    assert res_local.status_code == 200
    body_local = res_local.json()
    assert body_local["image_status"] == "available"
    assert body_local["url"] == "/assets/specimens/pacific_wren.jpg"
    assert body_local["source_url"] is not None

    # Mock upstream failure on global singleton temporarily and verify HTTP 200 unavailable fallback
    previous_fetcher = species_image_service._fetcher
    try:
        species_image_service.set_fetcher_for_testing(
            lambda _sci, _com: (_ for _ in ()).throw(RuntimeError("network down"))
        )
        res_unavail = await client.get(
            "/api/v1/ecology/species-image",
            params={"scientific_name": "Unknownus avis", "common_name": "Unknown Bird"},
        )
        assert res_unavail.status_code == 200
        assert res_unavail.json()["image_status"] == "unavailable"
        assert res_unavail.json()["url"] is None
    finally:
        species_image_service.set_fetcher_for_testing(previous_fetcher)


@pytest.mark.asyncio
async def test_health_and_analyses_list_detections_count_regression(client: AsyncClient):
    # 1. /health reflects loaded runtime engine accurately
    health_res = await client.get("/health")
    assert health_res.status_code == 200
    h = health_res.json()
    assert h["model_ready"] is True
    assert h["model_device"] is not None and h["model_device"] != "unknown"
    assert "execution_provider" in h

    # 2. Real analysis with detections exposes authoritative detections_count in GET /analyses
    wav_bytes = _make_wav_bytes(3.2)
    upload = await client.post(
        "/api/v1/analyses",
        files={"file": ("count_check.wav", wav_bytes, "audio/wav")},
        data={
            "latitude": "47.86",
            "longitude": "-123.93",
            "gps_accuracy_m": "12.5",
            "gps_captured_at": "2026-05-15T06:30:00Z",
        },
    )
    assert upload.status_code == 202
    aid = upload.json()["id"]
    st = await _wait_for_analysis_terminal(client, aid)
    assert st["status"] == "completed"

    results = (await client.get(f"/api/v1/analyses/{aid}/results")).json()
    expected_det_count = len(results["detections"])
    assert expected_det_count >= 1
    assert results["gps_accuracy_m"] == pytest.approx(12.5)
    assert results["gps_captured_at"] is not None

    list_res = await client.get("/api/v1/analyses", params={"page_size": 10})
    assert list_res.status_code == 200
    matched = [item for item in list_res.json()["items"] if item["id"] == aid]
    assert len(matched) == 1
    assert matched[0]["detections_count"] == expected_det_count


@pytest.mark.asyncio
async def test_live_session_gps_validation_stats_and_finalize_to_analysis(
    client: AsyncClient,
    test_session: AsyncSession,
):
    import numpy as np
    from app.core import database as db_mod
    from app.models.live_session import LiveEvent, LiveSegment
    from app.services.storage_service import storage_service

    # 1. Reject negative GPS accuracy
    bad_res = await client.post(
        "/api/v1/live/sessions",
        json={
            "source_type": "browser_mic",
            "latitude": 47.86,
            "longitude": -123.93,
            "gps_accuracy_m": -4.0,
        },
    )
    assert bad_res.status_code == 422

    # 2. Create valid geocoded live session with accuracy + timestamp
    create_res = await client.post(
        "/api/v1/live/sessions",
        json={
            "source_type": "browser_mic",
            "latitude": 47.86,
            "longitude": -123.93,
            "gps_accuracy_m": 18.2,
            "gps_captured_at": "2026-05-15T06:30:00Z",
            "sample_rate": 32000,
            "channels": 1,
        },
    )
    assert create_res.status_code == 201
    sid = create_res.json()["id"]

    # 3. GET /live/sessions/{id}/stats returns 200 (never 404 for existing session)
    stats_res = await client.get(f"/api/v1/live/sessions/{sid}/stats")
    assert stats_res.status_code == 200
    assert "received_frames" in stats_res.json()

    # 4. Seed one 3s WAV segment + embedding + detection event, then stop session -> finalizes Analysis
    seg_wav = storage_service.live_audio_dir / sid / "segment_0.0_3.0.wav"
    seg_wav.parent.mkdir(parents=True, exist_ok=True)
    seg_wav.write_bytes(_make_wav_bytes(3.0, 32000))

    seg_emb = storage_service.live_embeddings_dir / sid / "segment_0.0_3.0.npy"
    seg_emb.parent.mkdir(parents=True, exist_ok=True)
    np.save(seg_emb, np.zeros((1, 1280), dtype=np.float32))

    async with db_mod.async_session_factory() as s:
        s.add(
            LiveSegment(
                session_id=sid,
                start_seconds=0.0,
                end_seconds=3.0,
                audio_path=str(seg_wav),
                embedding_path=str(seg_emb),
                processing_status="embedding_extracted",
            )
        )
        s.add(
            LiveEvent(
                session_id=sid,
                detection_id="det-live-01",
                start_seconds=0.0,
                end_seconds=3.0,
                class_label="Troglodytes pacificus_Pacific Wren",
                scientific_name="Troglodytes pacificus",
                common_name="Pacific Wren",
                confidence_score=0.91,
                record_type="animal",
                taxon_group="Aves",
            )
        )
        await s.commit()

    stop_res = await client.post(f"/api/v1/live/sessions/{sid}/stop")
    assert stop_res.status_code == 200
    stopped = stop_res.json()
    aid = stopped.get("analysis_id")
    assert aid is not None

    # Verify finalized Analysis is retrievable via /analyses/{id}/results with same GPS + detection
    final_res = await client.get(f"/api/v1/analyses/{aid}/results")
    assert final_res.status_code == 200
    payload = final_res.json()
    assert payload["analysis_id"] == aid
    assert payload["latitude"] == pytest.approx(47.86)
    assert payload["longitude"] == pytest.approx(-123.93)
    assert payload["gps_accuracy_m"] == pytest.approx(18.2)
    assert len(payload["detections"]) == 1
    assert payload["geospatial_context"]["reference_status"] == "available"
    assert len(payload["expected_species"]["expected_species"]) > 0


@pytest.mark.asyncio
async def test_analyses_list_exact_detections_count_0_9_22(client: AsyncClient):
    """Explicit regression test for detections_count across 0, 9, and 22 persisted detections."""
    from app.core import database as db_mod
    from app.models.analysis import Analysis
    from app.models.detection import Detection
    import uuid

    created_ids: dict[int, str] = {}
    async with db_mod.async_session_factory() as s:
        for count in (0, 9, 22):
            aid = str(uuid.uuid4())
            created_ids[count] = aid
            s.add(
                Analysis(
                    id=aid,
                    filename=f"reg_{count}.wav",
                    audio_path=f"/tmp/reg_{count}.wav",
                    status="completed",
                    progress=100,
                    duration_seconds=30.0,
                )
            )
            for idx in range(count):
                s.add(
                    Detection(
                        analysis_id=aid,
                        start_seconds=float(idx),
                        end_seconds=float(idx + 3),
                        class_label="Turdus merula_Common Blackbird",
                        scientific_name="Turdus merula",
                        common_name="Common Blackbird",
                        confidence_score=0.85,
                        record_type="animal",
                        taxon_group="Aves",
                    )
                )
        await s.commit()

    list_res = await client.get("/api/v1/analyses", params={"page_size": 50})
    assert list_res.status_code == 200
    by_id = {item["id"]: item for item in list_res.json()["items"]}
    for expected_count, aid in created_ids.items():
        assert aid in by_id
        assert by_id[aid]["detections_count"] == expected_count
