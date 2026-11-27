"""Comprehensive verification tests for ECOsonic Backend Completion.

Covers:
- Semantic Species classification (biological, anthropogenic, geophony, low-confidence/unknown, mixed)
- Measurable non-causal Disturbance analysis (bio-only, anthro-only, mixed, no evidence, malformed)
- Context aggregation (complete, partial, missing metadata)
- Expected Species reference provenance & unavailable/empty distinction
- Observation Gap mathematical set algebra (A,B,C,D vs A,C -> not B,D) & not_detected != absent
- Database persistence & API integration (/analyses, /detections, /reports, /live, /ecology)
- Real BirdNET + BirdNET Geo + scikit-maad real-audio pipeline (@pytest.mark.real_model)
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
import pytest
from httpx import AsyncClient

from app.models.live_session import LiveEvent, LiveSession
from app.schemas.ecological_intelligence import ExpectedSpeciesItem, ObservationContext
from app.services import ecological_knowledge
from app.services.analysis_pipeline import ModelDetectionOutput, analysis_pipeline
from app.services.ecological_analysis_service import ecological_analysis_service
from app.services.ecological_knowledge.provider_base import (
    EcologicalKnowledgeProvider,
    EcologicalProviderUnavailableError,
)
from app.services.semantic_classification import semantic_classifier


# ---------------------------------------------------------------------------
# 1. Species Semantic Classification
# ---------------------------------------------------------------------------
def test_species_classification_biological_anthropogenic_unknown_and_mixed():
    mixed = [
        ModelDetectionOutput(
            class_label="Passer domesticus_House Sparrow",
            scientific_name="Passer domesticus",
            common_name="House Sparrow",
            taxon_group=None,
            record_type="animal",
            start_seconds=0.0,
            end_seconds=3.0,
            confidence_score=0.84,
        ),
        ModelDetectionOutput(
            class_label="Dryophytes versicolor_Gray Treefrog",
            scientific_name="Dryophytes versicolor",
            common_name="Gray Treefrog",
            taxon_group=None,
            record_type="animal",
            start_seconds=3.0,
            end_seconds=6.0,
            confidence_score=0.71,
        ),
        ModelDetectionOutput(
            class_label="Chainsaw_Chainsaw",
            scientific_name="Unknown",
            common_name="Chainsaw",
            taxon_group=None,
            record_type="sound_class",
            start_seconds=6.0,
            end_seconds=9.0,
            confidence_score=0.79,
        ),
        ModelDetectionOutput(
            class_label="Human vocal_Human vocal",
            scientific_name="Unknown",
            common_name="Human vocal",
            taxon_group=None,
            record_type="animal",  # Deliberately mis-tagged upstream to verify semantic guard
            start_seconds=9.0,
            end_seconds=12.0,
            confidence_score=0.65,
        ),
        ModelDetectionOutput(
            class_label="Fire_Fire",
            scientific_name="Unknown",
            common_name="Fire",
            taxon_group="Geophony",
            record_type="sound_class",
            start_seconds=12.0,
            end_seconds=15.0,
            confidence_score=0.60,
        ),
        # Low-confidence biological detection (< 0.15) must route to unknown, NOT biological species
        ModelDetectionOutput(
            class_label="Turdus migratorius_American Robin",
            scientific_name="Turdus migratorius",
            common_name="American Robin",
            taxon_group="Aves",
            record_type="animal",
            start_seconds=15.0,
            end_seconds=18.0,
            confidence_score=0.09,
        ),
        # Unrecognized non-binomial token
        ModelDetectionOutput(
            class_label="weird_unmapped_noise_token",
            scientific_name="weird_unmapped_noise_token",
            common_name="weird_unmapped_noise_token",
            taxon_group=None,
            record_type="animal",
            start_seconds=18.0,
            end_seconds=21.0,
            confidence_score=0.80,
        ),
    ]

    result = ecological_analysis_service.build_species_analysis(mixed)
    assert result["status"] == "detected"

    sci_names = {s["scientific_name"] for s in result["species"]}
    assert sci_names == {"Passer domesticus", "Dryophytes versicolor"}
    # Ensure real CSV taxon groups were populated (Aves + Amphibia, not "Unknown")
    groups = {s["scientific_name"]: s["taxon_group"] for s in result["species"]}
    assert groups["Passer domesticus"] == "Aves"
    assert groups["Dryophytes versicolor"] == "Amphibia"

    non_bio_labels = {d["common_name"] for d in result["non_biological_detections"]}
    assert "Chainsaw" in non_bio_labels
    assert "Human vocal" in non_bio_labels
    assert "Fire" in non_bio_labels

    unk_labels = {d["label"] for d in result["unknown_detections"]}
    assert "Turdus migratorius_American Robin" in unk_labels
    assert "weird_unmapped_noise_token" in unk_labels

    # Malformed confidence detection
    bad = semantic_classifier.classify_detection({"class_label": "Passer domesticus_House Sparrow", "confidence_score": float("nan")})
    assert bad.classification_category == "unknown"


# ---------------------------------------------------------------------------
# 2. Disturbance Analysis (Biological != Disturbance, Measurable, Non-Causal)
# ---------------------------------------------------------------------------
def test_disturbance_analysis_variants():
    # Case A: Biological-only recording with benign soundscape
    bio_only = ecological_analysis_service.build_species_analysis([
        {
            "class_label": "Troglodytes pacificus_Pacific Wren",
            "scientific_name": "Troglodytes pacificus",
            "common_name": "Pacific Wren",
            "confidence_score": 0.91,
            "start_seconds": 0.0,
            "end_seconds": 3.0,
        }
    ])
    dist_bio = ecological_analysis_service.build_disturbance_analysis(
        analysis_or_session_id="a-bio",
        species_analysis=bio_only,
        duration_seconds=30.0,
        soundscape_data={"metrics": {"ndsi": 0.8}, "frequency_bands": {"mid_frequency_1_2k_pct": 5.0}},
    )
    assert dist_bio["status"] == "no_anthropogenic_disturbance_detected"
    assert dist_bio["anthropogenic_events"] == []
    assert dist_bio["disturbance_index"] is not None
    assert dist_bio["disturbance_index"] < 0.15
    assert dist_bio["provenance"]["causal_claim_made"] is False

    # Case B: Anthropogenic-only recording
    anthro_only = ecological_analysis_service.build_species_analysis([
        {
            "class_label": "Chainsaw_Chainsaw",
            "scientific_name": "Unknown",
            "common_name": "Chainsaw",
            "confidence_score": 0.88,
            "start_seconds": 0.0,
            "end_seconds": 9.0,
        }
    ])
    dist_anthro = ecological_analysis_service.build_disturbance_analysis(
        analysis_or_session_id="a-anthro",
        species_analysis=anthro_only,
        duration_seconds=12.0,
        soundscape_data={"metrics": {"ndsi": -0.7}, "frequency_bands": {"mid_frequency_1_2k_pct": 68.0}},
    )
    assert dist_anthro["status"] == "anthropogenic_disturbance_detected"
    assert 0.65 <= dist_anthro["disturbance_index"] <= 1.0
    assert dist_anthro["measurable_indicators"]["anthropogenic_duration_seconds"] == 9.0
    assert "caused" not in dist_anthro["interpretation"].lower()

    # Case C: Mixed recording with overlapping biological vocalization
    mixed_sp = ecological_analysis_service.build_species_analysis([
        {
            "class_label": "Motor vehicle_Motor vehicle",
            "scientific_name": "Unknown",
            "common_name": "Motor vehicle",
            "confidence_score": 0.72,
            "start_seconds": 3.0,
            "end_seconds": 6.0,
        },
        {
            "class_label": "Corvus brachyrhynchos_American Crow",
            "scientific_name": "Corvus brachyrhynchos",
            "common_name": "American Crow",
            "confidence_score": 0.85,
            "start_seconds": 3.0,
            "end_seconds": 6.0,
        },
    ])
    dist_mixed = ecological_analysis_service.build_disturbance_analysis(
        analysis_or_session_id="a-mixed",
        species_analysis=mixed_sp,
        duration_seconds=15.0,
        soundscape_data={"metrics": {"ndsi": -0.1}, "frequency_bands": {"mid_frequency_1_2k_pct": 30.0}},
    )
    assert dist_mixed["measurable_indicators"]["temporal_overlap_with_biology_count"] == 1
    assert len(dist_mixed["co_occurrences"]) == 1
    assert dist_mixed["co_occurrences"][0]["causal_claim_made"] is False

    # Case D: Empty/no-evidence recording must report unavailable (NOT 0.0)
    empty_sp = ecological_analysis_service.build_species_analysis([])
    dist_empty = ecological_analysis_service.build_disturbance_analysis(
        analysis_or_session_id="a-empty",
        species_analysis=empty_sp,
        duration_seconds=None,
        soundscape_data=None,
    )
    assert dist_empty["status"] == "unavailable"
    assert dist_empty["disturbance_index"] is None


# ---------------------------------------------------------------------------
# 3. Context Analysis (Complete, Partial, Missing Metadata)
# ---------------------------------------------------------------------------
def test_context_analysis_complete_partial_and_missing_metadata():
    sp = ecological_analysis_service.build_species_analysis([
        {
            "class_label": "Troglodytes pacificus_Pacific Wren",
            "scientific_name": "Troglodytes pacificus",
            "common_name": "Pacific Wren",
            "confidence_score": 0.90,
            "start_seconds": 0.0,
            "end_seconds": 3.0,
        }
    ])
    dist = ecological_analysis_service.build_disturbance_analysis(
        analysis_or_session_id="ctx-1",
        species_analysis=sp,
        duration_seconds=12.0,
        soundscape_data=None,
    )

    # Complete with soundscape & coords
    full_ctx = ecological_analysis_service.build_context_analysis(
        recording_id="ctx-1",
        filename="sample.wav",
        duration_seconds=12.0,
        sample_rate=32000,
        channels=1,
        latitude=47.86,
        longitude=-123.93,
        recorded_at=datetime(2026, 5, 15, tzinfo=timezone.utc),
        model_version="3.0",
        execution_provider="CPU",
        species_analysis=sp,
        disturbance_analysis=dist,
        soundscape_data={
            "metrics": {"aci": 12.4, "adi": 1.1, "aei": 0.4, "ndsi": 0.65, "spectral_entropy": 0.72, "temporal_activity": 0.5},
            "frequency_bands": {"biophony_band_2_8k_pct": 62.0, "mid_frequency_1_2k_pct": 14.0},
            "calculation_parameters": {"n_fft": 1024},
            "quality_flags": [],
        },
    )
    assert full_ctx["status"] == "complete"
    assert full_ctx["recording_context"]["coordinate_status"] == "provided"
    assert full_ctx["acoustic_context"]["status"] == "measured"
    assert full_ctx["acoustic_context"]["dominant_frequency_band"] == "biophony_band_2_8k_pct"
    assert full_ctx["biological_context"]["unique_species_count"] == 1
    assert full_ctx["temporal_context"]["total_3s_windows"] == 4

    # Partial + missing metadata
    partial_ctx = ecological_analysis_service.build_context_analysis(
        recording_id="ctx-2",
        filename="nometa.wav",
        duration_seconds=12.0,
        sample_rate=32000,
        channels=1,
        latitude=None,
        longitude=None,
        recorded_at=None,
        model_version="3.0",
        execution_provider="CPU",
        species_analysis=sp,
        disturbance_analysis=dist,
        soundscape_data=None,
    )
    assert partial_ctx["status"] == "partial"
    assert partial_ctx["recording_context"]["coordinate_status"] == "unspecified"
    assert partial_ctx["acoustic_context"]["status"] == "unavailable"
    assert partial_ctx["acoustic_context"]["soundscape_metrics"] is None


# ---------------------------------------------------------------------------
# 4. Expected Species & Observation Gap (ABCD vs AC, Empty, Unavailable)
# ---------------------------------------------------------------------------
class _StubEmptyGeoProvider(EcologicalKnowledgeProvider):
    async def resolve_context(self, **kwargs) -> ObservationContext:
        ts = kwargs["timestamp"]
        return ObservationContext(
            session_id=kwargs["session_id"],
            latitude=kwargs.get("latitude"),
            longitude=kwargs.get("longitude"),
            timestamp=ts.isoformat(),
            observation_date=ts.strftime("%Y-%m-%d"),
            meteorological_week=19,
            observation_duration_sec=float(kwargs.get("duration_sec") or 0.0),
        )

    async def get_expected_species(self, context, min_score=0.08, top_k=60):
        return []

    async def get_species_metadata(self, scientific_name):
        return None


class _StubABCDGeoProvider(_StubEmptyGeoProvider):
    async def get_expected_species(self, context, min_score=0.08, top_k=60):
        return [
            ExpectedSpeciesItem(species_id="BN01", scientific_name="Taxon alpha", common_name="Alpha", occurrence_score=0.80, occurrence_status="frequent", birdnet_taxonomy_id="BN01"),
            ExpectedSpeciesItem(species_id="BN02", scientific_name="Taxon beta", common_name="Beta", occurrence_score=0.70, occurrence_status="frequent", birdnet_taxonomy_id="BN02"),
            ExpectedSpeciesItem(species_id="BN03", scientific_name="Taxon gamma", common_name="Gamma", occurrence_score=0.60, occurrence_status="expected", birdnet_taxonomy_id="BN03"),
            ExpectedSpeciesItem(species_id="BN04", scientific_name="Taxon delta", common_name="Delta", occurrence_score=0.50, occurrence_status="expected", birdnet_taxonomy_id="BN04"),
        ]


class _StubFailingGeoProvider(_StubEmptyGeoProvider):
    async def get_expected_species(self, context, min_score=0.08, top_k=60):
        raise EcologicalProviderUnavailableError("Geo model offline in test")


@pytest.mark.asyncio
async def test_expected_species_and_observation_gap_set_algebra_and_states(monkeypatch):
    # 4a. Expected {A, B, C, D} vs Observed {A, C} -> Not detected {B, D}, coverage 0.5, not_detected != absent
    monkeypatch.setattr(ecological_knowledge, "_default_provider", _StubABCDGeoProvider())
    res = await ecological_analysis_service.build_expected_and_gap(
        recording_id="gap-1",
        timestamp=datetime(2026, 5, 15, tzinfo=timezone.utc),
        duration_seconds=300.0,
        latitude=47.86,
        longitude=-123.93,
        biological_detections=[
            {"class_label": "Taxon alpha_Alpha", "scientific_name": "Taxon alpha", "birdnet_taxonomy_id": "BN01", "confidence_score": 0.90, "start_seconds": 0.0, "end_seconds": 3.0},
            {"class_label": "Taxon gamma_Gamma", "scientific_name": "Taxon gamma", "birdnet_taxonomy_id": "BN03", "confidence_score": 0.85, "start_seconds": 3.0, "end_seconds": 6.0},
        ],
        unknown_detections=[],
        soundscape_data=None,
    )
    assert res["expected_species"]["expected_species_status"] == "available"
    obs_sci = {x["scientific_name"] for x in res["observation_gap"]["observed"]}
    not_det = res["observation_gap"]["not_detected"]
    not_det_sci = {x["scientific_name"] for x in not_det}
    assert obs_sci == {"Taxon alpha", "Taxon gamma"}
    assert not_det_sci == {"Taxon beta", "Taxon delta"}
    assert res["observation_gap"]["coverage_ratio"] == 0.5
    assert all(item["not_detected"] is True and item["absent"] is False for item in not_det)

    # 4b. No coordinates -> location_unspecified + reference_unavailable (NOT [])
    no_coords = await ecological_analysis_service.build_expected_and_gap(
        recording_id="gap-nocrd",
        timestamp=datetime(2026, 5, 15, tzinfo=timezone.utc),
        duration_seconds=60.0,
        latitude=None,
        longitude=None,
        biological_detections=[],
        unknown_detections=[],
        soundscape_data=None,
    )
    assert no_coords["expected_species"]["expected_species_status"] == "reference_unavailable"
    assert no_coords["expected_species"]["expected_species"] is None
    assert no_coords["observation_gap"]["coverage_ratio"] is None

    # 4c. Empty expected set (valid coords, 0 species meet threshold) -> distinct from unavailable
    monkeypatch.setattr(ecological_knowledge, "_default_provider", _StubEmptyGeoProvider())
    empty_ref = await ecological_analysis_service.build_expected_and_gap(
        recording_id="gap-empty",
        timestamp=datetime(2026, 5, 15, tzinfo=timezone.utc),
        duration_seconds=60.0,
        latitude=89.9,
        longitude=0.0,
        biological_detections=[],
        unknown_detections=[],
        soundscape_data=None,
    )
    assert empty_ref["expected_species"]["expected_species_status"] == "empty_reference"
    assert empty_ref["expected_species"]["expected_species"] == []

    # 4d. Provider unavailable -> explicit reference_unavailable
    monkeypatch.setattr(ecological_knowledge, "_default_provider", _StubFailingGeoProvider())
    failed_ref = await ecological_analysis_service.build_expected_and_gap(
        recording_id="gap-fail",
        timestamp=datetime(2026, 5, 15, tzinfo=timezone.utc),
        duration_seconds=60.0,
        latitude=47.86,
        longitude=-123.93,
        biological_detections=[],
        unknown_detections=[],
        soundscape_data=None,
    )
    assert failed_ref["expected_species"]["expected_species_status"] == "reference_unavailable"
    assert failed_ref["observation_gap"]["status"] == "reference_unavailable"
    monkeypatch.setattr(ecological_knowledge, "_default_provider", None)


# ---------------------------------------------------------------------------
# 5. End-to-End Persistence & API Integration (Upload -> Worker -> GET /analyses/{id})
# ---------------------------------------------------------------------------
class _MixedMockEngine:
    def load(self):
        return None

    @property
    def provider(self):
        return "MOCK_MIXED"

    @property
    def model_version(self):
        return "BirdNET+ V3.0-MOCK"

    def analyze_audio(self, audio_path: str, min_confidence: float = 0.0, **_: Any):
        return [
            ModelDetectionOutput(
                class_label="Passer domesticus_House Sparrow",
                scientific_name="Passer domesticus",
                common_name="House Sparrow",
                taxon_group="Aves",
                record_type="animal",
                start_seconds=0.0,
                end_seconds=3.0,
                confidence_score=0.88,
            ),
            ModelDetectionOutput(
                class_label="Chainsaw_Chainsaw",
                scientific_name="Unknown",
                common_name="Chainsaw",
                taxon_group="Anthropogenic",
                record_type="sound_class",
                start_seconds=0.0,
                end_seconds=3.0,
                confidence_score=0.77,
            ),
        ]

    def extract_embeddings(self, audio_path: str):
        return np.zeros((1, 1280), dtype=np.float32), [(0.0, 3.0)]


@pytest.mark.asyncio
async def test_analysis_upload_persists_semantic_sections_and_reports_filter_non_bio(
    client: AsyncClient, tmp_path: Path, monkeypatch
):
    import soundfile as sf

    analysis_pipeline.set_engine(_MixedMockEngine())
    analysis_pipeline.load()
    monkeypatch.setattr(ecological_knowledge, "_default_provider", _StubABCDGeoProvider())

    wav_path = tmp_path / "mixed_test.wav"
    t = np.linspace(0, 3.2, 32000 * 3 + 6400, dtype=np.float32)
    sig = 0.1 * np.sin(2 * np.pi * 1500 * t) + 0.1 * np.sin(2 * np.pi * 4000 * t)
    sf.write(wav_path, sig.astype(np.float32), 32000)

    with wav_path.open("rb") as f:
        resp = await client.post(
            "/api/v1/analyses",
            files={"file": ("mixed_test.wav", f, "audio/wav")},
            data={"latitude": "47.86", "longitude": "-123.93"},
        )
    assert resp.status_code == 202, resp.text
    analysis_id = resp.json()["id"]

    detail = None
    for _ in range(100):
        r = await client.get(f"/api/v1/analyses/{analysis_id}")
        assert r.status_code == 200
        detail = r.json()
        if detail["status"] in {"completed", "failed"}:
            break
        await asyncio.sleep(0.05)

    assert detail is not None and detail["status"] == "completed", detail

    # All 5 semantic sections persisted & exposed directly on GET /analyses/{id}
    assert detail["species_analysis"]["summary"]["biological_detection_count"] == 1
    assert detail["species_analysis"]["summary"]["non_biological_detection_count"] == 1
    assert [s["scientific_name"] for s in detail["species_analysis"]["species"]] == ["Passer domesticus"]
    assert detail["disturbance_analysis"]["measurable_indicators"]["anthropogenic_event_count"] == 1
    assert detail["disturbance_analysis"]["disturbance_index"] is not None
    assert detail["context_analysis"]["status"] == "complete"
    assert detail["expected_species_analysis"]["expected_species_status"] == "available"
    assert detail["observation_gap_analysis"]["status"] == "evaluated"

    # GET /analyses/{id}/results exposes same persisted intelligence
    res_ep = await client.get(f"/api/v1/analyses/{analysis_id}/results")
    assert res_ep.status_code == 200
    assert res_ep.json()["species"]["species"][0]["scientific_name"] == "Passer domesticus"

    # Detections endpoint supports biological_only=true filter
    bio_det_res = await client.get(f"/api/v1/detections?analysis_id={analysis_id}&biological_only=true")
    assert bio_det_res.status_code == 200
    assert len(bio_det_res.json()["items"]) == 1
    assert bio_det_res.json()["items"][0]["scientific_name"] == "Passer domesticus"

    # Reports summary excludes non-biological "Unknown" from unique_species_count and top_species
    rep = await client.get("/api/v1/reports/summary")
    assert rep.status_code == 200
    rep_json = rep.json()
    assert all(sp["scientific_name"] != "Unknown" for sp in rep_json["top_species"])
    assert rep_json["detections"]["non_biological_total"] >= 1
    monkeypatch.setattr(ecological_knowledge, "_default_provider", None)


@pytest.mark.asyncio
async def test_live_intelligence_endpoint_includes_semantic_context_and_disturbance(
    client: AsyncClient, test_session
):
    sess = LiveSession(
        id="live-int-1",
        source_type="browser_mic",
        status="active",
        latitude=47.86,
        longitude=-123.93,
        processed_audio_seconds=12.0,
    )
    test_session.add(sess)
    test_session.add_all([
        LiveEvent(
            session_id="live-int-1",
            start_seconds=0.0,
            end_seconds=3.0,
            class_label="Passer domesticus_House Sparrow",
            scientific_name="Passer domesticus",
            common_name="House Sparrow",
            confidence_score=0.82,
            record_type="animal",
            taxon_group="Aves",
        ),
        LiveEvent(
            session_id="live-int-1",
            start_seconds=3.0,
            end_seconds=6.0,
            class_label="Chainsaw_Chainsaw",
            scientific_name="Unknown",
            common_name="Chainsaw",
            confidence_score=0.75,
            record_type="sound_class",
            taxon_group="Anthropogenic",
        ),
    ])
    await test_session.commit()

    resp = await client.get("/api/v1/live/sessions/live-int-1/intelligence")
    assert resp.status_code == 200
    data = resp.json()
    assert data["species_richness"] == 1
    assert data["species_analysis"]["summary"]["non_biological_detection_count"] == 1
    assert data["disturbance_analysis"]["measurable_indicators"]["anthropogenic_event_count"] == 1
    assert data["context_analysis"]["biological_context"]["unique_species_count"] == 1


# ---------------------------------------------------------------------------
# 6. Real BirdNET + BirdNET Geo + scikit-maad Acceptance Check
# ---------------------------------------------------------------------------
@pytest.mark.real_model
@pytest.mark.asyncio
async def test_real_birdnet_single_pass_ecological_synthesis(client: AsyncClient):
    analysis_pipeline.set_engine(None)
    analysis_pipeline.load()
    root = Path(__file__).resolve().parents[2]
    audio_path = root / "backend" / "data" / "smoke_audio" / "birds_forest.ogg"
    assert audio_path.is_file()

    with audio_path.open("rb") as f:
        resp = await client.post(
            "/api/v1/analyses",
            files={"file": (audio_path.name, f, "audio/ogg")},
            data={
                "latitude": "47.86",
                "longitude": "-123.93",
                "recorded_at": "2026-05-15T06:15:00Z",
            },
        )
    assert resp.status_code == 202, resp.text
    analysis_id = resp.json()["id"]

    detail = None
    for _ in range(240):
        r = await client.get(f"/api/v1/analyses/{analysis_id}")
        assert r.status_code == 200
        detail = r.json()
        if detail["status"] in {"completed", "failed"}:
            break
        await asyncio.sleep(0.5)

    assert detail and detail["status"] == "completed", detail
    assert detail["metrics_json"]["execution_provider"] in {"GPU", "CPU"}
    assert detail["species_analysis"]["summary"]["biological_detection_count"] > 0
    # Verify real taxonomy resolved beyond "Unknown"
    assert any(
        s["taxon_group"] in {"Aves", "Insecta", "Amphibia", "Mammalia", "Reptilia"}
        for s in detail["species_analysis"]["species"]
    )
    assert detail["context_analysis"]["acoustic_context"]["status"] == "measured"
    assert detail["expected_species_analysis"]["expected_species_status"] == "available"
    assert detail["observation_gap_analysis"]["status"] == "evaluated"
    assert isinstance(detail["observation_gap_analysis"]["coverage"]["coverage_ratio"], float)
