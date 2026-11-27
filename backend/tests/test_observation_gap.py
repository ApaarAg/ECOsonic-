"""
Comprehensive Unit & Integration Test Suite for Geospatial Ecological Intelligence
and Observation Gap Analysis Engine in ECOsonic 3.0.

Tests cover:
- Case 1: Partitioning expected vs detected (Gap calculation, non-detection != absence)
- Case 2: Unexpected species detection (marked unexpected, never labeled invasive)
- Case 3: Missing location / unspecified coordinates (no fabricated species)
- Case 4: Short recording (<120s) triggers insufficient duration warning
- Case 5: Zero detections adequacy handling (non-detection is not absence)
- Case 6: Fallback rule engine when Gemini is unavailable
- Case 7: Hallucination filter and absence language sanitizer
- Case 8: Repeated detections deduplication and persistence computation
- Case 9: Non-biological / disturbance sound class exclusion
"""

import pytest
from typing import List, Dict, Any
from app.schemas.ecological_intelligence import (
    ObservationContext,
    ObservationGapResponse,
    ExpectedSpeciesItem,
    DetectedSpeciesItem,
    ObservationGapSpeciesItem,
    ObservationGapCoverage,
    EcologicalInterpretation,
)
from app.services.observation_gap_engine import ObservationGapEngine
from app.services.ecological_interpretation_service import EcologicalInterpretationService


@pytest.fixture
def sample_expected_species() -> List[ExpectedSpeciesItem]:
    """Returns a deterministic list of expected species for Hoh Rainforest."""
    return [
        ExpectedSpeciesItem(
            scientific_name="Troglodytes pacificus",
            common_name="Pacific Wren",
            occurrence_score=0.88,
            occurrence_status="expected",
            birdnet_taxonomy_id="pacwre",
        ),
        ExpectedSpeciesItem(
            scientific_name="Ixoreus naevius",
            common_name="Varied Thrush",
            occurrence_score=0.82,
            occurrence_status="expected",
            birdnet_taxonomy_id="varthr",
        ),
        ExpectedSpeciesItem(
            scientific_name="Cyanocitta stelleri",
            common_name="Steller's Jay",
            occurrence_score=0.75,
            occurrence_status="expected",
            birdnet_taxonomy_id="stejay",
        ),
        ExpectedSpeciesItem(
            scientific_name="Dryocopus pileatus",
            common_name="Pileated Woodpecker",
            occurrence_score=0.68,
            occurrence_status="expected",
            birdnet_taxonomy_id="pilwoo",
        ),
    ]


def make_context(
    session_id: str = "test-session-001",
    latitude: float | None = 47.86,
    longitude: float | None = -123.93,
    duration_seconds: float = 600.0,
) -> ObservationContext:
    """Helper to create a valid ObservationContext."""
    return ObservationContext(
        session_id=session_id,
        latitude=latitude,
        longitude=longitude,
        location_name="Hoh River Basin",
        ecosystem_category="temperate-rainforest",
        timestamp="2026-11-24T12:00:00Z",
        observation_date="2026-11-24",
        meteorological_week=47,
        observation_duration_sec=duration_seconds,
        total_audio_windows=int(duration_seconds / 3.0),
    )


# =========================================================================
# Case 1: Expected = A, B, C, D; Detected = A, B -> Gap = C, D
# =========================================================================
def test_case_1_expected_and_detected_partitioning(sample_expected_species):
    """
    Given expected species [Pacific Wren, Varied Thrush, Steller's Jay, Pileated Woodpecker],
    and detections of [Pacific Wren, Varied Thrush]:
    - Steller's Jay & Pileated Woodpecker must be in expected_but_not_detected.
    - not_detected must be True.
    - evidence_status must be 'insufficient_evidence_for_absence'.
    - Coverage percentage must be 50.0%.
    """
    raw_detections = [
        {"class_label": "Pacific Wren", "scientific_name": "Troglodytes pacificus", "confidence_score": 0.85, "start_seconds": 10.0, "end_seconds": 13.0},
        {"class_label": "Pacific Wren", "scientific_name": "Troglodytes pacificus", "confidence_score": 0.90, "start_seconds": 30.0, "end_seconds": 33.0},
        {"class_label": "Varied Thrush", "scientific_name": "Ixoreus naevius", "confidence_score": 0.78, "start_seconds": 45.0, "end_seconds": 48.0},
    ]

    context = make_context(duration_seconds=600.0)

    (
        detected_exp,
        gap,
        unexpected,
        coverage,
    ) = ObservationGapEngine.evaluate_observation_gap(
        context=context,
        expected_species=sample_expected_species,
        raw_events=raw_detections,
    )

    assert coverage.expected_species_count == 4
    assert coverage.detected_expected_count == 2
    assert coverage.gap_count == 2
    assert coverage.coverage_percentage == 50.0
    assert coverage.observation_adequacy == "adequate"

    # Verify detected expected
    detected_sci_names = [d.scientific_name for d in detected_exp]
    assert "Troglodytes pacificus" in detected_sci_names
    assert "Ixoreus naevius" in detected_sci_names

    # Verify gap
    gap_sci_names = [g.scientific_name for g in gap]
    assert "Cyanocitta stelleri" in gap_sci_names
    assert "Dryocopus pileatus" in gap_sci_names

    for gap_item in gap:
        assert gap_item.not_detected is True
        assert gap_item.evidence_status == "insufficient_evidence_for_absence"


# =========================================================================
# Case 2: Unexpected species detection (marked unexpected, NOT invasive)
# =========================================================================
def test_case_2_unexpected_species_handling(sample_expected_species):
    """
    Given an acoustic detection of a species NOT in the expected regional baseline:
    - Must be partitioned into detected_unexpected.
    - is_expected must be False.
    - occurrence_status must be 'unexpected_detected'.
    - Must NEVER be labeled 'invasive'.
    """
    raw_detections = [
        {"class_label": "Pacific Wren", "scientific_name": "Troglodytes pacificus", "confidence_score": 0.85, "start_seconds": 10.0, "end_seconds": 13.0},
        {"class_label": "Hermit Thrush", "scientific_name": "Catharus guttatus", "confidence_score": 0.72, "start_seconds": 20.0, "end_seconds": 23.0},
        {"class_label": "Hermit Thrush", "scientific_name": "Catharus guttatus", "confidence_score": 0.68, "start_seconds": 50.0, "end_seconds": 53.0},
    ]

    context = make_context(duration_seconds=600.0)

    (
        detected_exp,
        gap,
        unexpected,
        coverage,
    ) = ObservationGapEngine.evaluate_observation_gap(
        context=context,
        expected_species=sample_expected_species,
        raw_events=raw_detections,
    )

    assert coverage.detected_unexpected_count == 1
    assert len(unexpected) == 1
    unexp_item = unexpected[0]
    assert unexp_item.scientific_name == "Catharus guttatus"
    assert unexp_item.is_expected is False
    assert unexp_item.occurrence_status == "unexpected"
    assert unexp_item.detection_count == 2

    # Verify "invasive" does NOT appear anywhere
    response = ObservationGapResponse(
        session_id=context.session_id,
        context=context,
        coverage=coverage,
        expected_and_detected=detected_exp,
        expected_but_not_detected=gap,
        detected_unexpected=unexpected,
    )
    serialized = response.model_dump_json()
    assert "invasive" not in serialized.lower()


# =========================================================================
# Case 3: Missing location -> location_unspecified, no fabricated species
# =========================================================================
def test_case_3_missing_location_adequacy():
    """
    When coordinates are unspecified (None, None):
    - observation_adequacy must be 'location_unspecified'.
    - Expected species count must be 0 (no fabricated regional checklist).
    """
    raw_detections = [
        {"class_label": "Pacific Wren", "scientific_name": "Troglodytes pacificus", "confidence_score": 0.85, "start_seconds": 10.0, "end_seconds": 13.0},
    ]

    context = make_context(latitude=None, longitude=None, duration_seconds=600.0)

    (
        detected_exp,
        gap,
        unexpected,
        coverage,
    ) = ObservationGapEngine.evaluate_observation_gap(
        context=context,
        expected_species=[],  # Unspecified location yields no regional expectations
        raw_events=raw_detections,
    )

    assert coverage.observation_adequacy == "location_unspecified"
    assert coverage.expected_species_count == 0
    assert coverage.gap_count == 0
    assert len(gap) == 0
    assert "not specified" in coverage.adequacy_explanation.lower() or "unspecified" in coverage.adequacy_explanation.lower()


# =========================================================================
# Case 4: Short recording (<120s) triggers insufficient duration warning
# =========================================================================
def test_case_4_insufficient_duration(sample_expected_species):
    """
    When recording duration is under 120 seconds:
    - observation_adequacy must be 'insufficient_duration'.
    - adequacy_explanation must explain that the observation window is too short.
    """
    raw_detections = [
        {"class_label": "Pacific Wren", "scientific_name": "Troglodytes pacificus", "confidence_score": 0.85, "start_seconds": 10.0, "end_seconds": 13.0},
    ]

    context = make_context(duration_seconds=65.0)  # < 120s

    (
        detected_exp,
        gap,
        unexpected,
        coverage,
    ) = ObservationGapEngine.evaluate_observation_gap(
        context=context,
        expected_species=sample_expected_species,
        raw_events=raw_detections,
    )

    assert coverage.observation_adequacy == "insufficient_duration"
    assert "brief" in coverage.adequacy_explanation.lower() or "120" in coverage.adequacy_explanation


# =========================================================================
# Case 5: Zero detections adequacy handling
# =========================================================================
def test_case_5_zero_detections(sample_expected_species):
    """
    When raw_detections is empty:
    - observation_adequacy must be 'zero_detections'.
    - detected_expected_count must be 0.
    - All expected species must be in expected_but_not_detected.
    - Non-detection must still NOT be labeled as absence.
    """
    context = make_context(duration_seconds=600.0)

    (
        detected_exp,
        gap,
        unexpected,
        coverage,
    ) = ObservationGapEngine.evaluate_observation_gap(
        context=context,
        expected_species=sample_expected_species,
        raw_events=[],
    )

    assert coverage.observation_adequacy == "zero_detections"
    assert coverage.detected_expected_count == 0
    assert coverage.coverage_percentage == 0.0
    assert coverage.gap_count == 4
    assert len(gap) == 4


# =========================================================================
# Case 6: Fallback rule engine when Gemini is unavailable
# =========================================================================
def test_case_6_gemini_fallback_rule_engine():
    """
    When Gemini API key is missing or call fails:
    - EcologicalInterpretationService must use deterministic fallback rule engine.
    - provider must be 'deterministic_rule_engine'.
    - summary must be grounded and informative.
    - limitations list must be provided.
    """
    service = EcologicalInterpretationService(api_key=None)

    context = make_context(duration_seconds=900.0)

    coverage = ObservationGapCoverage(
        expected_species_count=2,
        detected_expected_count=1,
        detected_unexpected_count=0,
        gap_count=1,
        coverage_ratio=0.5,
        coverage_percentage=50.0,
        observation_adequacy="adequate",
        adequacy_explanation="Observation captured 1 of 2 regionally expected species (50.0% coverage).",
    )

    detected = [
        DetectedSpeciesItem(
            scientific_name="Troglodytes pacificus",
            common_name="Pacific Wren",
            max_confidence=0.92,
            mean_confidence=0.88,
            detection_count=5,
            first_seen_seconds=10.0,
            last_seen_seconds=600.0,
            is_persistent=True,
            is_expected=True,
        ),
    ]

    gap = [
        ObservationGapSpeciesItem(
            scientific_name="Dryocopus pileatus",
            common_name="Pileated Woodpecker",
            occurrence_score=0.7,
            occurrence_status="expected",
        ),
    ]

    interp = service.generate_deterministic_fallback(
        context=context,
        coverage=coverage,
        expected_and_detected=detected,
        expected_but_not_detected=gap,
        detected_unexpected=[],
    )

    assert interp.provider == "deterministic_rule_engine"
    assert interp.is_grounded is True
    assert "Acoustic monitoring across" in interp.summary
    assert any("Pacific Wren" in h for h in interp.detected_highlights)
    assert any("Pileated Woodpecker" in h for h in interp.unobserved_expected_highlights)
    assert "Pileated Woodpecker" in interp.observation_gap_explanation or "Dryocopus pileatus" in interp.observation_gap_explanation
    assert len(interp.limitations) > 0
    assert "does not establish" in interp.observation_gap_explanation.lower() or "not detected" in interp.observation_gap_explanation.lower()


# =========================================================================
# Case 7: Hallucination filter and absence language sanitizer
# =========================================================================
def test_case_7_hallucination_scrubber_and_absence_sanitizer():
    """
    - Absence language sanitizer must replace 'is absent' with 'was not acoustically detected'.
    - Allowed species whitelist must scrub hallucinated species from output highlights.
    """
    service = EcologicalInterpretationService(api_key=None)

    # 1. Test absence language sanitizer
    dirty_text = "The Pileated Woodpecker is absent from the forest. Northern Owl is absent."
    cleaned = service._sanitize_absence_claims(dirty_text)
    assert "is absent" not in cleaned.lower()
    assert "was not acoustically detected" in cleaned

    # 2. Test hallucinated species scrubber
    allowed_whitelist = {"Troglodytes pacificus", "Pacific Wren", "Dryocopus pileatus", "Pileated Woodpecker"}

    dirty_highlights = [
        "Pacific Wren was observed vocalizing continuously.",
        "An African elephant was detected near the river.",  # Hallucinated!
        "Pileated Woodpecker was expected but unobserved.",
        "Emperor penguin calls were noted in the trees.",    # Hallucinated!
    ]

    scrubbed = service._filter_ungrounded_highlights(dirty_highlights, allowed_whitelist)
    assert len(scrubbed) == 2
    assert any("Pacific Wren" in h for h in scrubbed)
    assert any("Pileated Woodpecker" in h for h in scrubbed)
    assert not any("elephant" in h.lower() for h in scrubbed)
    assert not any("penguin" in h.lower() for h in scrubbed)


# =========================================================================
# Case 8: Repeated detections deduplication and persistence metrics
# =========================================================================
def test_case_8_repeated_detections_persistence(sample_expected_species):
    """
    Given multiple acoustic detections of the same species:
    - Must be deduplicated into a single item.
    - detection_count must be the exact count of qualifying windows.
    - is_persistent must be True when count >= 2.
    - max_confidence and mean_confidence must be calculated correctly.
    """
    raw_detections = [
        {"class_label": "Pacific Wren", "scientific_name": "Troglodytes pacificus", "confidence_score": 0.80, "start_seconds": 10.0, "end_seconds": 13.0},
        {"class_label": "Pacific Wren", "scientific_name": "Troglodytes pacificus", "confidence_score": 0.90, "start_seconds": 25.0, "end_seconds": 28.0},
        {"class_label": "Pacific Wren", "scientific_name": "Troglodytes pacificus", "confidence_score": 0.70, "start_seconds": 40.0, "end_seconds": 43.0},
    ]

    context = make_context(duration_seconds=300.0)

    (
        detected_exp,
        gap,
        unexpected,
        coverage,
    ) = ObservationGapEngine.evaluate_observation_gap(
        context=context,
        expected_species=sample_expected_species,
        raw_events=raw_detections,
    )

    assert len(detected_exp) == 1
    wren = detected_exp[0]
    assert wren.detection_count == 3
    assert wren.max_confidence == 0.90
    assert wren.mean_confidence == 0.80
    assert wren.is_persistent is True
    assert wren.first_seen_seconds == 10.0
    assert wren.last_seen_seconds == 43.0


# =========================================================================
# Case 9: Non-biological and disturbance sound class exclusion
# =========================================================================
def test_case_9_non_biological_exclusion(sample_expected_species):
    """
    Non-biological acoustic classes (Engine, Chainsaw, Siren, Wind, etc.)
    must be excluded by the engine from species gap accounting.
    """
    raw_detections = [
        {"class_label": "Engine", "scientific_name": "Engine", "confidence_score": 0.95, "start_seconds": 5.0, "end_seconds": 8.0},
        {"class_label": "Chainsaw", "scientific_name": "Chainsaw", "confidence_score": 0.92, "start_seconds": 15.0, "end_seconds": 18.0},
        {"class_label": "Pacific Wren", "scientific_name": "Troglodytes pacificus", "confidence_score": 0.88, "start_seconds": 30.0, "end_seconds": 33.0},
    ]

    context = make_context(duration_seconds=300.0)

    (
        detected_exp,
        gap,
        unexpected,
        coverage,
    ) = ObservationGapEngine.evaluate_observation_gap(
        context=context,
        expected_species=sample_expected_species,
        raw_events=raw_detections,
    )

    detected_sci_names = [d.scientific_name for d in detected_exp]
    unexpected_sci_names = [u.scientific_name for u in unexpected]

    assert "Engine" not in detected_sci_names
    assert "Engine" not in unexpected_sci_names
    assert "Chainsaw" not in detected_sci_names
    assert "Chainsaw" not in unexpected_sci_names
    assert coverage.detected_expected_count + coverage.detected_unexpected_count == 1
