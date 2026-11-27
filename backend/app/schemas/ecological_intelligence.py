"""Pydantic schemas for Geospatial Ecological Intelligence and Observation Gap Analysis.

Scientific Terminology & Guardrails:
- "Expected species": Species with modeled regional and seasonal suitability in the observation context.
- "Detected species": Species with verified acoustic classifications above confidence threshold.
- "Expected but not acoustically detected": Expected species without acoustic evidence in the session.
  Strictly represented as `not_detected = True`, NEVER `absent = True`.
- "Observation gap": Discrepancy between regional species expectations and acoustic detections.
- "Acoustic Observation Coverage": Explainable ratio of detected expected species to total expected species.
- "Insufficient evidence for absence": Scientific acknowledgment that non-detection does not prove absence.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field

SCIENTIFIC_ABSENCE_DISCLAIMER = (
    "Acoustic non-detection does NOT establish biological absence. Vocal inactivity, distance from microphone, "
    "dense canopy attenuation, ambient weather noise, seasonal silence, and model detection thresholds all influence "
    "acoustic detectability. ECOsonic reports 'not detected' rather than 'absent'."
)

ACOUSTIC_COVERAGE_DISCLAIMER = (
    "Acoustic Observation Coverage reflects the proportion of regionally expected bird species acoustically registered "
    "during this specific recording window. It is NOT an ecosystem-health score, extinction metric, or absolute biodiversity index."
)


class ObservationContext(BaseModel):
    """Deterministic internal representation for an ecological observation context."""

    model_config = ConfigDict(from_attributes=True)

    session_id: str
    latitude: Optional[float] = Field(None, ge=-90.0, le=90.0)
    longitude: Optional[float] = Field(None, ge=-180.0, le=180.0)
    generalized_coordinates: Optional[Dict[str, Optional[float]]] = None
    location_name: Optional[str] = None
    ecosystem_category: str = "unspecified"
    elevation_m: Optional[float] = None
    timestamp: str  # ISO 8601
    observation_date: str  # YYYY-MM-DD
    meteorological_week: int = Field(..., ge=1, le=48)
    observation_duration_sec: float = Field(..., ge=0.0)
    total_audio_windows: int = Field(default=0, ge=0)
    acoustic_complexity_index: Optional[float] = None
    normalized_difference_soundscape_index: Optional[float] = None


class SpeciesImageProvenance(BaseModel):
    """Provenance-tracked species photograph metadata (zero fabricated imagery)."""

    model_config = ConfigDict(from_attributes=True)

    image_status: Literal["available", "unavailable"] = "unavailable"
    url: Optional[str] = None
    source: Optional[str] = None
    license: Optional[str] = None
    attribution: Optional[str] = None
    source_url: Optional[str] = None
    retrieved_at: Optional[str] = None


class ExpectedSpeciesItem(BaseModel):
    """A species regionally and seasonally expected within the observation context."""

    model_config = ConfigDict(from_attributes=True)

    species_id: Optional[str] = None
    scientific_name: str
    common_name: Optional[str] = None
    occurrence_score: float = Field(..., ge=0.0, le=1.0)
    occurrence_status: Literal["expected", "frequent", "rare"] = "expected"
    birdnet_taxonomy_id: Optional[str] = None
    ebird_code: Optional[str] = None
    habitat_suitability_note: Optional[str] = None
    image: Optional[SpeciesImageProvenance] = None


class DetectedSpeciesItem(BaseModel):
    """A species acoustically detected during the observation session."""

    model_config = ConfigDict(from_attributes=True)

    species_id: Optional[str] = None
    scientific_name: str
    common_name: Optional[str] = None
    birdnet_taxonomy_id: Optional[str] = None
    ebird_code: Optional[str] = None
    max_confidence: float = Field(..., ge=0.0, le=1.0)
    mean_confidence: float = Field(..., ge=0.0, le=1.0)
    detection_count: int = Field(..., ge=1)
    first_seen_seconds: float = Field(..., ge=0.0)
    last_seen_seconds: float = Field(..., ge=0.0)
    is_persistent: bool = False
    is_expected: bool = True
    occurrence_score: Optional[float] = None
    occurrence_status: Optional[str] = None  # expected, rare, unexpected, not_applicable
    image: Optional[SpeciesImageProvenance] = None


class ObservationGapSpeciesItem(BaseModel):
    """A species expected in the ecological context but NOT acoustically detected."""

    model_config = ConfigDict(from_attributes=True)

    species_id: Optional[str] = None
    scientific_name: str
    common_name: Optional[str] = None
    occurrence_score: float = Field(..., ge=0.0, le=1.0)
    occurrence_status: Literal["expected", "frequent", "rare"] = "expected"
    birdnet_taxonomy_id: Optional[str] = None
    ebird_code: Optional[str] = None
    not_detected: bool = Field(default=True, description="Species was not acoustically detected.")
    evidence_status: Literal["insufficient_evidence_for_absence"] = "insufficient_evidence_for_absence"
    possible_factors: List[str] = Field(
        default_factory=lambda: [
            "Vocal inactivity during recording window",
            "Individual outside microphone pick-up radius",
            "Sound attenuation by terrain or dense canopy",
            "Diurnal/nocturnal activity timing differences",
        ]
    )
    image: Optional[SpeciesImageProvenance] = None


class ObservationGapCoverage(BaseModel):
    """Explainable acoustic observation coverage metric."""

    metric_name: str = "Acoustic Observation Coverage"
    expected_species_count: int = Field(..., ge=0)
    detected_expected_count: int = Field(..., ge=0)
    detected_unexpected_count: int = Field(..., ge=0)
    gap_count: int = Field(..., ge=0)
    coverage_ratio: float = Field(..., ge=0.0, le=1.0)
    coverage_percentage: float = Field(..., ge=0.0, le=100.0)
    observation_adequacy: Literal[
        "adequate", "marginal_duration", "insufficient_duration", "location_unspecified", "zero_detections"
    ]
    adequacy_explanation: str
    disclaimer: str = ACOUSTIC_COVERAGE_DISCLAIMER


class EcologicalInterpretation(BaseModel):
    """Grounded AI-assisted or deterministic ecological interpretation."""

    model_config = ConfigDict(from_attributes=True)

    summary: str
    observation_gap_explanation: str
    detected_highlights: List[str]
    unobserved_expected_highlights: List[str]
    limitations: List[str]
    disclaimer: str = "AI-assisted interpretation synthesized from structured ECOsonic observation evidence."
    provider: Literal["gemini", "deterministic_rule_engine", "cached"] = "deterministic_rule_engine"
    is_grounded: bool = True


class ObservationGapRequest(BaseModel):
    """Input payload for generating an observation gap analysis."""

    session_id: str
    latitude: Optional[float] = Field(None, ge=-90.0, le=90.0)
    longitude: Optional[float] = Field(None, ge=-180.0, le=180.0)
    min_occurrence_score: float = Field(
        default=0.08, ge=0.01, le=1.0, description="Minimum regional suitability to consider a species expected"
    )
    min_confidence: float = Field(
        default=0.25, ge=0.05, le=1.0, description="Minimum acoustic detection confidence threshold"
    )
    include_ai_interpretation: bool = Field(
        default=True, description="Attempt Gemini interpretation if configured"
    )


class ObservationGapResponse(BaseModel):
    """Authoritative response structure for expected species gap analysis."""

    session_id: str
    expected_species_status: Literal[
        "available", "empty_reference", "location_unspecified", "reference_unavailable"
    ] = "available"
    context: ObservationContext
    geospatial_context: Optional[Dict[str, Any]] = None
    coverage: ObservationGapCoverage
    expected_and_detected: List[DetectedSpeciesItem]
    expected_but_not_detected: List[ObservationGapSpeciesItem]
    detected_unexpected: List[DetectedSpeciesItem]
    species_analysis: Optional[Dict[str, Any]] = None
    disturbance_analysis: Optional[Dict[str, Any]] = None
    context_analysis: Optional[Dict[str, Any]] = None
    provenance: Optional[Dict[str, Any]] = None
    interpretation: Optional[EcologicalInterpretation] = None
    scientific_disclaimer: str = SCIENTIFIC_ABSENCE_DISCLAIMER
