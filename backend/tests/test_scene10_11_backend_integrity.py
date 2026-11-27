"""Forensic integrity test suite for Scene 10 & Scene 11 backend ecological contracts."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, List

import numpy as np
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import settings
from app.core import database
from app.models.live_session import LiveEvent, LiveSession
from app.models.site import Site
from app.schemas.ecological_intelligence import ExpectedSpeciesItem, ObservationContext
from app.services import ecological_knowledge
from app.services.ecological_interpretation_service import EcologicalInterpretationService
from app.services.ecological_knowledge.birdnet_geo_provider import BirdNetGeoKnowledgeProvider
from app.services.ecological_knowledge.mock_provider import MockEcologicalKnowledgeProvider
from app.services.ecological_knowledge.provider_base import (
    EcologicalProviderUnavailableError,
    InvalidObservationCoordinatesError,
)
from app.services.geo_temporal_service import (
    GeoTemporalIntelligenceService,
    geo_temporal_service,
    is_non_biological_taxon,
)
from app.services.observation_gap_engine import ObservationGapEngine


def _make_ctx(
    session_id: str = "ses-integrity",
    lat: float | None = 47.86,
    lon: float | None = -123.93,
    duration: float = 600.0,
) -> ObservationContext:
    return ObservationContext(
        session_id=session_id,
        latitude=lat,
        longitude=lon,
        location_name="Olympic Basin",
        ecosystem_category="unspecified",
        timestamp="2026-05-15T12:00:00Z",
        observation_date="2026-05-15",
        meteorological_week=19,
        observation_duration_sec=duration,
        total_audio_windows=int(duration // 3.0),
    )


# ---------------------------------------------------------------------------
# 1. Deterministic BirdNET Geo Expectation & Real Taxonomy Verification
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_expected_species_deterministic_real_birdnet_geo():
    provider = BirdNetGeoKnowledgeProvider()
    ctx = await provider.resolve_context(
        session_id="det-check",
        timestamp=datetime(2026, 5, 15, tzinfo=timezone.utc),
        duration_sec=600.0,
        latitude=47.86,
        longitude=-123.93,
        location_name="Hoh Rainforest",
    )
    assert ctx.ecosystem_category == "unspecified"

    first = await provider.get_expected_species(ctx, min_score=0.08, top_k=25)
    second = await provider.get_expected_species(ctx, min_score=0.08, top_k=25)

    assert len(first) > 0
    assert [(s.species_id, s.scientific_name, s.occurrence_score) for s in first] == [
        (s.species_id, s.scientific_name, s.occurrence_score) for s in second
    ]
    assert all(s.species_id for s in first)


# ---------------------------------------------------------------------------
# 2. Production Mock Isolation Guard
# ---------------------------------------------------------------------------
def test_mock_provider_blocked_in_production(monkeypatch):
    monkeypatch.setattr(ecological_knowledge, "_default_provider", None)
    monkeypatch.setenv("USE_MOCK_ECOLOGY_PROVIDER", "true")
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")

    provider = ecological_knowledge.get_ecological_knowledge_provider()
    assert isinstance(provider, BirdNetGeoKnowledgeProvider)
    assert not isinstance(provider, MockEcologicalKnowledgeProvider)

    # Cleanup singleton cache for later tests
    monkeypatch.setattr(ecological_knowledge, "_default_provider", None)


# ---------------------------------------------------------------------------
# 3. Observation Gap Set Algebra: Expected {A, B, C} vs Detected {B, C, D}
# ---------------------------------------------------------------------------
def test_observation_gap_set_algebra_abc_vs_bcd():
    expected = [
        ExpectedSpeciesItem(
            species_id="BN001",
            scientific_name="Taxon alpha",
            common_name="Alpha Bird",
            occurrence_score=0.80,
            occurrence_status="frequent",
            birdnet_taxonomy_id="BN001",
        ),
        ExpectedSpeciesItem(
            species_id="BN002",
            scientific_name="Taxon beta",
            common_name="Beta Bird",
            occurrence_score=0.65,
            occurrence_status="frequent",
            birdnet_taxonomy_id="BN002",
        ),
        ExpectedSpeciesItem(
            species_id="BN003",
            scientific_name="Taxon gamma",
            common_name="Gamma Bird",
            occurrence_score=0.45,
            occurrence_status="expected",
            birdnet_taxonomy_id="BN003",
        ),
    ]
    raw_events = [
        # B matched via normalized whitespace + high confidence at t=0.0
        {
            "class_label": "Taxon beta_Beta Bird",
            "scientific_name": "  Taxon   beta ",
            "common_name": "Beta Bird",
            "confidence_score": 0.91,
            "start_seconds": 0.0,
            "end_seconds": 3.0,
        },
        # C matched via birdnet_taxonomy_id with 2 persistent low-mid hits
        {
            "class_label": "Taxon gamma_Gamma Bird",
            "scientific_name": "Taxon gamma",
            "birdnet_taxonomy_id": "BN003",
            "confidence_score": 0.28,
            "start_seconds": 6.0,
            "end_seconds": 9.0,
        },
        {
            "class_label": "Taxon gamma_Gamma Bird",
            "scientific_name": "Taxon gamma",
            "birdnet_taxonomy_id": "BN003",
            "confidence_score": 0.30,
            "start_seconds": 12.0,
            "end_seconds": 15.0,
        },
        # D unexpected biological taxon
        {
            "class_label": "Taxon delta_Delta Bird",
            "scientific_name": "Taxon delta",
            "common_name": "Delta Bird",
            "confidence_score": 0.77,
            "start_seconds": 18.0,
            "end_seconds": 21.0,
        },
    ]

    det_exp, not_det, unexp, cov = ObservationGapEngine.evaluate_observation_gap(
        context=_make_ctx(),
        expected_species=expected,
        raw_events=raw_events,
    )

    assert {s.scientific_name for s in det_exp} == {"Taxon beta", "Taxon gamma"}
    assert {s.scientific_name for s in not_det} == {"Taxon alpha"}
    assert {s.scientific_name for s in unexp} == {"Taxon delta"}
    assert all(s.species_id for s in det_exp + not_det + unexp)
    assert next(s for s in det_exp if s.scientific_name == "Taxon beta").first_seen_seconds == 0.0
    assert cov.expected_species_count == 3
    assert cov.detected_expected_count == 2
    assert cov.gap_count == 1
    assert cov.detected_unexpected_count == 1
    assert cov.coverage_percentage == 66.7


# ---------------------------------------------------------------------------
# 4. Zero Absence Claims & Scientific Terminology Enforcement
# ---------------------------------------------------------------------------
def test_no_absence_claims_in_schema_or_fallback():
    expected = [
        ExpectedSpeciesItem(
            species_id="BN001",
            scientific_name="Strix occidentalis",
            common_name="Spotted Owl",
            occurrence_score=0.55,
            occurrence_status="frequent",
            birdnet_taxonomy_id="BN001",
        )
    ]
    raw_events = [
        {
            "class_label": "Mimus polyglottos_Northern Mockingbird",
            "scientific_name": "Mimus polyglottos",
            "common_name": "Northern Mockingbird",
            "confidence_score": 0.85,
            "start_seconds": 3.0,
            "end_seconds": 6.0,
        }
    ]
    det_exp, not_det, unexp, cov = ObservationGapEngine.evaluate_observation_gap(
        context=_make_ctx(),
        expected_species=expected,
        raw_events=raw_events,
    )
    assert len(not_det) == 1
    gap_item = not_det[0]
    assert gap_item.not_detected is True
    assert gap_item.evidence_status == "insufficient_evidence_for_absence"
    assert not hasattr(gap_item, "absent")
    assert unexp[0].occurrence_status == "unexpected"

    interp = EcologicalInterpretationService(api_key="").generate_deterministic_fallback(
        _make_ctx(), cov, det_exp, not_det, unexp
    )
    combined_text = f"{interp.summary} {interp.observation_gap_explanation} {' '.join(interp.limitations)}".lower()
    assert "does not establish biological absence" in combined_text or "does not confirm biological absence" in combined_text
    assert "invasive" not in combined_text


# ---------------------------------------------------------------------------
# 5. Non-Biological & sound_class Exclusion Without Wildlife False-Positives
# ---------------------------------------------------------------------------
def test_non_biological_and_sound_class_exclusion_preserves_valid_substrings():
    raw_events = [
        {
            "class_label": "Engine",
            "scientific_name": "Unknown",
            "record_type": "sound_class",
            "confidence_score": 0.99,
        },
        {
            "class_label": "Gunshot, gunfire",
            "scientific_name": "Gunshot, gunfire",
            "record_type": "sound_class",
            "confidence_score": 0.95,
        },
        {
            "class_label": "Homo sapiens_Human",
            "scientific_name": "Homo sapiens",
            "common_name": "Human",
            "confidence_score": 0.92,
        },
        {
            "class_label": "Centrocercus minimus_Gunnison Grouse",
            "scientific_name": "Centrocercus minimus",
            "common_name": "Gunnison Grouse",
            "confidence_score": 0.88,
        },
        {
            "class_label": "Cyphorhinus arada_Musician Wren",
            "scientific_name": "Cyphorhinus arada",
            "common_name": "Musician Wren",
            "confidence_score": 0.84,
        },
        {
            "class_label": "Siren nettingi_Western Lesser Siren",
            "scientific_name": "Siren nettingi",
            "common_name": "Western Lesser Siren",
            "confidence_score": 0.81,
        },
    ]

    agg = ObservationGapEngine.filter_and_aggregate_detections(raw_events)
    assert set(agg.keys()) == {"centrocercus minimus", "cyphorhinus arada", "siren nettingi"}
    assert is_non_biological_taxon("Homo sapiens", "Human") is True
    assert is_non_biological_taxon("Unknown", None, record_type="sound_class") is True
    assert is_non_biological_taxon("Centrocercus minimus", "Gunnison Grouse") is False
    assert is_non_biological_taxon("Siren nettingi", "Western Lesser Siren") is False


# ---------------------------------------------------------------------------
# 6 & 7. Session A vs Session B & Location A vs Location B API Isolation
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_session_and_location_isolation_via_api(client: AsyncClient, test_engine):
    maker = async_sessionmaker(bind=test_engine, expire_on_commit=False)

    async with maker() as db:
        ses_a = LiveSession(
            id="ses-iso-a",
            source_type="desktop_mic",
            status="completed",
            latitude=47.86,
            longitude=-123.93,
            processed_audio_seconds=360.0,
        )
        ses_b = LiveSession(
            id="ses-iso-b",
            source_type="desktop_mic",
            status="completed",
            latitude=25.86,
            longitude=-80.78,
            processed_audio_seconds=360.0,
        )
        db.add_all([ses_a, ses_b])
        await db.flush()
        db.add_all([
            LiveEvent(
                session_id="ses-iso-a",
                start_seconds=0.0,
                end_seconds=3.0,
                class_label="Troglodytes pacificus_Pacific Wren",
                scientific_name="Troglodytes pacificus",
                common_name="Pacific Wren",
                confidence_score=0.91,
                record_type="animal",
            ),
            LiveEvent(
                session_id="ses-iso-a",
                start_seconds=3.0,
                end_seconds=6.0,
                class_label="Engine",
                scientific_name="Unknown",
                common_name="Engine",
                confidence_score=0.99,
                record_type="sound_class",
            ),
            LiveEvent(
                session_id="ses-iso-b",
                start_seconds=0.0,
                end_seconds=3.0,
                class_label="Mimus polyglottos_Northern Mockingbird",
                scientific_name="Mimus polyglottos",
                common_name="Northern Mockingbird",
                confidence_score=0.89,
                record_type="animal",
            ),
        ])
        await db.commit()

    res_a = await client.post(
        "/api/v1/ecology/observation-gap",
        json={"session_id": "ses-iso-a", "include_ai_interpretation": False},
    )
    res_b = await client.post(
        "/api/v1/ecology/observation-gap",
        json={"session_id": "ses-iso-b", "include_ai_interpretation": False},
    )
    assert res_a.status_code == 200
    assert res_b.status_code == 200

    body_a = res_a.json()
    body_b = res_b.json()

    det_a = {d["scientific_name"] for d in body_a["expected_and_detected"] + body_a["detected_unexpected"]}
    det_b = {d["scientific_name"] for d in body_b["expected_and_detected"] + body_b["detected_unexpected"]}
    assert det_a == {"Troglodytes pacificus"}
    assert det_b == {"Mimus polyglottos"}
    assert "Unknown" not in det_a and "Engine" not in det_a

    # Expected checklists for Hoh Rainforest vs Florida Everglades must differ substantially
    exp_a = {s["scientific_name"] for s in body_a["expected_and_detected"] + body_a["expected_but_not_detected"]}
    exp_b = {s["scientific_name"] for s in body_b["expected_and_detected"] + body_b["expected_but_not_detected"]}
    assert len(exp_a) > 0 and len(exp_b) > 0
    assert exp_a != exp_b


# ---------------------------------------------------------------------------
# 8. Cache Key Isolation, Model Versioning, and Immutable Output Array
# ---------------------------------------------------------------------------
def test_cache_key_isolation_versioning_and_immutability():
    svc = GeoTemporalIntelligenceService(model_version="3.0")
    probs_a = svc.get_raw_geo_predictions(47.86, -123.93, week=20)
    assert probs_a.flags.writeable is False

    # Same quantized coordinate/week/version -> cache hit
    probs_a_hit = svc.get_raw_geo_predictions(47.8601, -123.9301, week=20)
    assert probs_a_hit is probs_a
    info = svc.predict_species_probabilities.cache_info()
    assert info.hits >= 1

    # Different location -> miss, distinct probabilities
    probs_b = svc.get_raw_geo_predictions(25.86, -80.78, week=20)
    assert not np.array_equal(probs_a, probs_b)

    # Mutating cache key version invalidates reuse cleanly
    svc.model_version = "3.1-test"
    misses_before = svc.predict_species_probabilities.cache_info().misses
    svc.get_raw_geo_predictions(47.86, -123.93, week=20)
    assert svc.predict_species_probabilities.cache_info().misses == misses_before + 1
    assert any(k[0] == "3.1-test" for k in svc._prediction_cache.keys())


# ---------------------------------------------------------------------------
# 9. Invalid Coordinates & Malformed Inputs Handling
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_invalid_coordinates_and_malformed_inputs(client: AsyncClient, test_engine):
    provider = BirdNetGeoKnowledgeProvider()
    with pytest.raises(InvalidObservationCoordinatesError):
        await provider.resolve_context(
            session_id="bad-coords",
            timestamp=datetime.now(timezone.utc),
            duration_sec=100.0,
            latitude=95.0,
            longitude=10.0,
        )

    # Also test API handling when stored DB session carries out-of-bounds coordinates
    maker = async_sessionmaker(bind=test_engine, expire_on_commit=False)
    async with maker() as db:
        db.add(
            LiveSession(
                id="ses-bad-db-coord",
                source_type="desktop_mic",
                status="completed",
                latitude=142.0,
                longitude=-210.0,
                processed_audio_seconds=300.0,
            )
        )
        await db.commit()

    res = await client.post(
        "/api/v1/ecology/observation-gap",
        json={"session_id": "ses-bad-db-coord", "include_ai_interpretation": False},
    )
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "INVALID_OBSERVATION_COORDINATES"


# ---------------------------------------------------------------------------
# 10. Provider Failure Surfaces Explicit 503 ECOLOGICAL_DATA_UNAVAILABLE
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_provider_unavailable_returns_503_no_silent_mock_fallback(client: AsyncClient, test_engine, monkeypatch):
    maker = async_sessionmaker(bind=test_engine, expire_on_commit=False)
    async with maker() as db:
        db.add(
            Site(
                id="site-down-test",
                name="Outage Station",
                latitude=47.86,
                longitude=-123.93,
                ecosystem_category="temperate-rainforest",
                location_sensitivity="exact",
            )
        )
        db.add(
            LiveSession(
                id="ses-down-test",
                source_type="desktop_mic",
                status="completed",
                latitude=47.86,
                longitude=-123.93,
                processed_audio_seconds=300.0,
            )
        )
        await db.commit()

    def _boom():
        raise RuntimeError("BirdNET Geo ONNX model file missing")

    monkeypatch.setattr(geo_temporal_service, "load_model", _boom)

    # Provider must raise, NEVER return []
    provider = BirdNetGeoKnowledgeProvider()
    ctx = _make_ctx(session_id="ses-down-test")
    with pytest.raises(EcologicalProviderUnavailableError):
        await provider.get_expected_species(ctx)

    monkeypatch.setattr(ecological_knowledge, "_default_provider", provider)

    res_gap = await client.post(
        "/api/v1/ecology/observation-gap",
        json={"session_id": "ses-down-test", "include_ai_interpretation": False},
    )
    assert res_gap.status_code == 503
    assert res_gap.json()["detail"]["code"] == "ECOLOGICAL_DATA_UNAVAILABLE"

    res_site = await client.get("/api/v1/sites/site-down-test/geo-context")
    assert res_site.status_code == 503
    assert res_site.json()["detail"]["code"] == "ECOLOGICAL_DATA_UNAVAILABLE"

    monkeypatch.setattr(ecological_knowledge, "_default_provider", None)


# ---------------------------------------------------------------------------
# 11. Gemini Hallucination Rejection & Deterministic Fallback
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_gemini_hallucination_rejection_and_privacy_payload(monkeypatch):
    svc = EcologicalInterpretationService(api_key="test-fake-key")
    captured_payloads: List[Dict[str, Any]] = []

    class _FakeResp:
        status_code = 200

        def json(self) -> Dict[str, Any]:
            return {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": (
                                        '{"summary": "Corvus corax dominated the forest while Northern Cardinal appeared absent.",'
                                        ' "observation_gap_explanation": "Pacific Wren is not present today.",'
                                        ' "detected_highlights": ["Pacific Wren active early."],'
                                        ' "unobserved_expected_highlights": ["Varied Thrush was not registered."],'
                                        ' "limitations": ["Short recording window."]}'
                                    )
                                }
                            ]
                        }
                    }
                ]
            }

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, json):
            captured_payloads.append(json)
            return _FakeResp()

    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", _FakeClient)

    ctx = _make_ctx().model_copy(
        update={
            "latitude": 47.861234,
            "longitude": -123.934567,
            "generalized_coordinates": {"latitude": None, "longitude": None},
        }
    )
    det_exp, not_det, unexp, cov = ObservationGapEngine.evaluate_observation_gap(
        context=ctx,
        expected_species=[
            ExpectedSpeciesItem(
                species_id="BN1",
                scientific_name="Troglodytes pacificus",
                common_name="Pacific Wren",
                occurrence_score=0.8,
                occurrence_status="frequent",
            )
        ],
        raw_events=[
            {
                "class_label": "Troglodytes pacificus_Pacific Wren",
                "scientific_name": "Troglodytes pacificus",
                "common_name": "Pacific Wren",
                "confidence_score": 0.9,
                "start_seconds": 0.0,
                "end_seconds": 3.0,
            }
        ],
    )

    interp = await svc.interpret_observation_gap(ctx, cov, det_exp, not_det, unexp)
    # Ungrounded summary ("Corvus corax" / "Northern Cardinal") forces deterministic fallback
    assert interp.provider == "deterministic_rule_engine"
    assert "Corvus corax" not in interp.summary
    assert "Northern Cardinal" not in interp.summary
    # Exact GPS coordinates must never be transmitted to Gemini
    sent_text = str(captured_payloads[0])
    assert "47.861234" not in sent_text
    assert "-123.934567" not in sent_text


# ---------------------------------------------------------------------------
# 12. Coordinate Privacy Enforcement Across Restricted & Generalized Sites
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_site_coordinate_privacy_enforced_on_api(client: AsyncClient, test_engine):
    maker = async_sessionmaker(bind=test_engine, expire_on_commit=False)
    async with maker() as db:
        site_rest = Site(
            id="site-restricted-1",
            name="Sensitive Nest Site",
            latitude=47.864321,
            longitude=-123.934321,
            ecosystem_category="temperate-rainforest",
            location_sensitivity="restricted",
        )
        site_gen = Site(
            id="site-generalized-1",
            name="Generalized Sanctuary",
            latitude=47.864321,
            longitude=-123.934321,
            generalized_latitude=47.9,
            generalized_longitude=-123.9,
            ecosystem_category="temperate-rainforest",
            location_sensitivity="generalized",
        )
        db.add_all([site_rest, site_gen])
        await db.flush()
        db.add(
            LiveSession(
                id="ses-restricted-site",
                site_id="site-restricted-1",
                source_type="desktop_mic",
                status="completed",
                processed_audio_seconds=360.0,
            )
        )
        await db.commit()

    geo_rest = await client.get("/api/v1/sites/site-restricted-1/geo-context")
    assert geo_rest.status_code == 200
    g_r = geo_rest.json()
    assert g_r["latitude"] is None and g_r["longitude"] is None
    assert g_r["location_sensitivity"] == "restricted"
    assert len(g_r["top_regional_species"]) > 0

    geo_gen = await client.get("/api/v1/sites/site-generalized-1/geo-context")
    assert geo_gen.status_code == 200
    g_g = geo_gen.json()
    assert g_g["latitude"] == 47.9 and g_g["longitude"] == -123.9
    assert g_g["location_sensitivity"] == "generalized"

    gap_rest = await client.post(
        "/api/v1/ecology/observation-gap",
        json={"session_id": "ses-restricted-site", "include_ai_interpretation": False},
    )
    assert gap_rest.status_code == 200
    gr_json = gap_rest.json()
    assert gr_json["context"]["latitude"] is None and gr_json["context"]["longitude"] is None
    assert gr_json["coverage"]["expected_species_count"] > 0


# ---------------------------------------------------------------------------
# 13. Empty Expected Species Handling (Zero Fabricated Birds)
# ---------------------------------------------------------------------------
def test_empty_expected_species_no_fabrication():
    det_exp, not_det, unexp, cov = ObservationGapEngine.evaluate_observation_gap(
        context=_make_ctx(),
        expected_species=[],
        raw_events=[],
    )
    assert det_exp == []
    assert not_det == []
    assert unexp == []
    assert cov.expected_species_count == 0
    assert cov.gap_count == 0
    assert cov.coverage_ratio == 0.0


# ---------------------------------------------------------------------------
# 14. Concurrent Multi-Location Request Safety
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_concurrent_multi_location_api_safety(client: AsyncClient, test_engine):
    maker = async_sessionmaker(bind=test_engine, expire_on_commit=False)
    async with maker() as db:
        db.add_all([
            LiveSession(
                id="ses-conc-wa",
                source_type="desktop_mic",
                status="completed",
                latitude=47.86,
                longitude=-123.93,
                processed_audio_seconds=300.0,
            ),
            LiveSession(
                id="ses-conc-fl",
                source_type="desktop_mic",
                status="completed",
                latitude=25.86,
                longitude=-80.78,
                processed_audio_seconds=300.0,
            ),
        ])
        await db.commit()

    async def _call(session_id: str):
        r = await client.post(
            "/api/v1/ecology/observation-gap",
            json={"session_id": session_id, "include_ai_interpretation": False},
        )
        assert r.status_code == 200
        data = r.json()
        top_names = tuple(s["scientific_name"] for s in data["expected_but_not_detected"][:5])
        return session_id, top_names

    tasks = [_call("ses-conc-wa" if i % 2 == 0 else "ses-conc-fl") for i in range(12)]
    results = await asyncio.gather(*tasks)

    wa_sets = {names for sid, names in results if sid == "ses-conc-wa"}
    fl_sets = {names for sid, names in results if sid == "ses-conc-fl"}
    assert len(wa_sets) == 1
    assert len(fl_sets) == 1
    assert wa_sets != fl_sets


# ---------------------------------------------------------------------------
# 15. Malformed Provider Failure, Non-Bio Substring Safety & 503 Guard
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_provider_failure_returns_503_and_non_bio_substring_safety(
    client: AsyncClient,
    test_engine,
    monkeypatch,
):
    # Real avian/amphibian taxa with substrings like "gun", "siren", "music" must NEVER be filtered
    assert is_non_biological_taxon("Centrocercus minimus", "Gunnison Grouse") is False
    assert is_non_biological_taxon("Siren nettingi", "Western Lesser Siren") is False
    assert is_non_biological_taxon("Cyphorhinus arada", "Musician Wren") is False
    # Actual sound_class / anthropogenic labels MUST be filtered
    assert is_non_biological_taxon("Human vocal_Human", "Human") is True
    assert is_non_biological_taxon("Chainsaw", "Chainsaw") is True
    assert is_non_biological_taxon("Some class", record_type="sound_class") is True

    # Whitespace normalization & 0.0s boundary event preservation in gap engine
    det_exp, not_det, unexp, cov = ObservationGapEngine.evaluate_observation_gap(
        context=_make_ctx(),
        expected_species=[
            ExpectedSpeciesItem(
                species_id="BN_PW",
                scientific_name="Troglodytes pacificus",
                common_name="Pacific Wren",
                occurrence_score=0.75,
                occurrence_status="frequent",
                birdnet_taxonomy_id="BN_PW",
            ),
            ExpectedSpeciesItem(
                species_id="BN_PW_DUP",
                scientific_name="  Troglodytes   pacificus ",
                common_name="Pacific Wren",
                occurrence_score=0.55,
                occurrence_status="frequent",
                birdnet_taxonomy_id="BN_PW",
            ),
        ],
        raw_events=[
            {
                "class_label": "Troglodytes pacificus_Pacific Wren",
                "scientific_name": "  Troglodytes   pacificus ",
                "common_name": "Pacific Wren",
                "birdnet_taxonomy_id": "BN_PW",
                "confidence_score": 0.88,
                "start_seconds": 0.0,
                "end_seconds": 3.0,
            }
        ],
    )
    assert len(det_exp) == 1
    assert det_exp[0].first_seen_seconds == 0.0
    assert cov.expected_species_count == 1
    assert cov.gap_count == 0

    maker = async_sessionmaker(bind=test_engine, expire_on_commit=False)
    async with maker() as db:
        db.add(
            LiveSession(
                id="ses-provider-down",
                source_type="desktop_mic",
                status="completed",
                latitude=47.86,
                longitude=-123.93,
                processed_audio_seconds=300.0,
            )
        )
        await db.commit()

    class _BrokenProvider:
        async def resolve_context(self, **kwargs):
            return _make_ctx(session_id="ses-provider-down")

        async def get_expected_species(self, context, min_score=0.08, top_k=60):
            raise EcologicalProviderUnavailableError("BirdNET Geo ONNX model unavailable")

    monkeypatch.setattr(ecological_knowledge, "_default_provider", _BrokenProvider())
    try:
        resp = await client.post(
            "/api/v1/ecology/observation-gap",
            json={"session_id": "ses-provider-down", "include_ai_interpretation": False},
        )
        assert resp.status_code == 503
        assert resp.json()["detail"]["code"] == "ECOLOGICAL_DATA_UNAVAILABLE"
    finally:
        monkeypatch.setattr(ecological_knowledge, "_default_provider", None)


# ---------------------------------------------------------------------------
# 16. Frontend / Backend DTO Schema Compatibility Contract
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_frontend_backend_dto_schema_compatibility(client: AsyncClient, test_engine):
    maker = async_sessionmaker(bind=test_engine, expire_on_commit=False)
    async with maker() as db:
        db.add(
            Site(
                id="site-contract-1",
                name="Olympic Contract Station",
                latitude=47.86,
                longitude=-123.93,
                ecosystem_category="temperate-rainforest",
                location_sensitivity="exact",
            )
        )
        await db.flush()
        db.add(
            LiveSession(
                id="ses-contract-1",
                site_id="site-contract-1",
                source_type="desktop_mic",
                status="completed",
                processed_audio_seconds=360.0,
            )
        )
        await db.flush()
        db.add(
            LiveEvent(
                session_id="ses-contract-1",
                class_label="Troglodytes pacificus_Pacific Wren",
                scientific_name="Troglodytes pacificus",
                common_name="Pacific Wren",
                confidence_score=0.91,
                start_seconds=0.0,
                end_seconds=3.0,
                taxon_group="animal",
            )
        )
        await db.commit()

    gap_resp = await client.post(
        "/api/v1/ecology/observation-gap",
        json={"session_id": "ses-contract-1", "include_ai_interpretation": False},
    )
    assert gap_resp.status_code == 200
    gap = gap_resp.json()

    for key in (
        "session_id",
        "context",
        "coverage",
        "expected_and_detected",
        "expected_but_not_detected",
        "detected_unexpected",
        "interpretation",
        "scientific_disclaimer",
    ):
        assert key in gap

    for ctx_key in (
        "session_id",
        "latitude",
        "longitude",
        "generalized_coordinates",
        "location_name",
        "ecosystem_category",
        "elevation_m",
        "timestamp",
        "observation_date",
        "meteorological_week",
        "observation_duration_sec",
        "total_audio_windows",
        "acoustic_complexity_index",
        "normalized_difference_soundscape_index",
    ):
        assert ctx_key in gap["context"]

    for cov_key in (
        "metric_name",
        "expected_species_count",
        "detected_expected_count",
        "detected_unexpected_count",
        "gap_count",
        "coverage_ratio",
        "coverage_percentage",
        "observation_adequacy",
        "adequacy_explanation",
        "disclaimer",
    ):
        assert cov_key in gap["coverage"]

    if gap["expected_but_not_detected"]:
        sp = gap["expected_but_not_detected"][0]
        for sp_key in (
            "species_id",
            "scientific_name",
            "common_name",
            "occurrence_score",
            "occurrence_status",
            "birdnet_taxonomy_id",
            "ebird_code",
            "not_detected",
            "evidence_status",
            "possible_factors",
        ):
            assert sp_key in sp
        assert sp["not_detected"] is True
        assert sp["evidence_status"] == "insufficient_evidence_for_absence"

    geo_resp = await client.get("/api/v1/sites/site-contract-1/geo-context")
    assert geo_resp.status_code == 200
    geo = geo_resp.json()
    for geo_key in (
        "site_id",
        "site_name",
        "latitude",
        "longitude",
        "location_sensitivity",
        "week",
        "model_version",
        "total_regional_species",
        "expected_species_count",
        "rare_species_count",
        "top_regional_species",
        "disclaimer",
    ):
        assert geo_key in geo
    assert len(geo["top_regional_species"]) > 0
    assert "species_id" in geo["top_regional_species"][0]
