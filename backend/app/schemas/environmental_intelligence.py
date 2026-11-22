"""Pydantic schemas for Phase 5 Geo-Temporal Environmental Intelligence."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field


# ----------------------------------------------------------------------------
# MODULE A: Geographic Context Schemas
# ----------------------------------------------------------------------------
class SpeciesGeoContext(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    scientific_name: str
    common_name: Optional[str] = None
    birdnet_taxonomy_id: Optional[str] = None
    species_code: Optional[str] = None
    geo_score: float = Field(..., ge=0.0, le=1.0)
    occurrence_status: str  # expected, rare, unexpected, vagrant, out_of_season
    is_unusual_occurrence: bool
    review_recommended: bool = False
    flag_reason: Optional[str] = None


class SiteGeoContextResponse(BaseModel):
    site_id: Optional[str] = None
    site_name: Optional[str] = None
    latitude: float
    longitude: float
    week: int
    recording_date: Optional[str] = None
    model_version: str = "BirdNET Geo V3.0"
    total_regional_species: int
    expected_species_count: int
    rare_species_count: int
    top_regional_species: List[SpeciesGeoContext]
    disclaimer: str


class AcousticDetectionGeoContext(BaseModel):
    detection_id: Optional[str] = None
    live_event_id: Optional[str] = None
    scientific_name: str
    common_name: Optional[str] = None
    birdnet_taxonomy_id: Optional[str] = None
    acoustic_confidence: float
    geographic_score: Optional[float] = None
    occurrence_status: str
    is_unusual_occurrence: bool
    review_recommended: bool
    flag_reason: Optional[str] = None
    disclaimer: str


class GeoContextualizeRequest(BaseModel):
    scientific_name: str
    acoustic_confidence: float = Field(..., ge=0.0, le=1.0)
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    week: Optional[int] = Field(None, ge=1, le=48)
    date: Optional[str] = None
    detection_id: Optional[str] = None
    live_event_id: Optional[str] = None


# ----------------------------------------------------------------------------
# MODULE B: Site Intelligence & Sensitivity Schemas
# ----------------------------------------------------------------------------
class SiteAcousticProfile(BaseModel):
    site_id: str
    name: str
    ecosystem_category: str
    recording_station_coords: Dict[str, Any]
    sound_source_localization_note: str = (
        "Single-microphone deployments provide recording station coordinates only. "
        "Sound source coordinates are not estimated or fabricated."
    )
    total_sessions: int
    total_audio_hours: float
    species_richness_observed: int
    common_taxa: List[str]
    recent_disturbances_count: int
    last_observation_timestamp: Optional[str] = None


# ----------------------------------------------------------------------------
# MODULE C: Habitat Drift Schemas
# ----------------------------------------------------------------------------
class HabitatComparisonRequest(BaseModel):
    baseline_session_id: Optional[str] = None
    target_session_id: Optional[str] = None
    comparison_type: str = Field(
        default="session_vs_session",
        description="session_vs_session, daily, weekly, monthly, historical_baseline",
    )
    baseline_days_back: int = Field(default=30, ge=1, le=365)


class MetricDriftStat(BaseModel):
    baseline_value: Optional[float]
    target_value: Optional[float]
    delta: Optional[float]
    pct_change: Optional[float]
    robust_z_score: Optional[float] = None
    is_statistically_significant: bool = False


class HabitatComparisonResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    comparison_id: str
    site_id: str
    comparison_type: str
    baseline_session_id: Optional[str] = None
    target_session_id: Optional[str] = None
    baseline_period: Optional[str] = None
    comparison_period: Optional[str] = None
    drift_category: str  # stable_observed_soundscape, notable_acoustic_change, etc.
    status: str  # completed, insufficient_baseline, failed
    normalized_duration_ratio: float
    detection_rate_per_hour: MetricDriftStat
    species_richness: MetricDriftStat
    soundscape_indices: Dict[str, MetricDriftStat]
    disturbance_frequency_per_hour: MetricDriftStat
    explainable_findings: List[str]
    scientific_limitations: str
    created_at: str


class HabitatDriftSummaryResponse(BaseModel):
    site_id: str
    ecosystem_category: str
    overall_habitat_trend: str
    evaluated_comparisons_count: int
    latest_drift_category: str
    biophony_trend: str
    anthrophony_trend: str
    stability_index: float
    recent_comparisons: List[HabitatComparisonResponse]
    disclaimer: str


# ----------------------------------------------------------------------------
# MODULE D: Environmental Review Schemas
# ----------------------------------------------------------------------------
ReviewDecision = Literal["confirmed", "rejected", "uncertain", "needs_more_evidence"]


class EnvironmentalReviewCreate(BaseModel):
    review_category: str = Field(
        ...,
        description="unexpected_geographic_occurrence, low_confidence_acoustic_prediction, unusual_acoustic_anomaly, repeated_disturbance_event, soundscape_change",
    )
    target_type: str = Field(
        ..., description="live_event, detection, anomaly_candidate, disturbance_event"
    )
    target_id: str
    site_id: Optional[str] = None
    session_id: Optional[str] = None
    original_prediction: Dict[str, Any]
    original_score: float
    geo_context: Optional[Dict[str, Any]] = None
    audio_evidence_path: Optional[str] = None
    review_decision: ReviewDecision = "needs_more_evidence"
    reviewer_note: Optional[str] = None


class EventReviewRequest(BaseModel):
    review_category: str = Field(
        default="unexpected_geographic_occurrence",
        description="unexpected_geographic_occurrence, low_confidence_acoustic_prediction, unusual_acoustic_anomaly, repeated_disturbance_event, soundscape_change",
    )
    target_type: str = Field(
        default="live_event",
        description="live_event, detection, anomaly_candidate, disturbance_event",
    )
    site_id: Optional[str] = None
    session_id: Optional[str] = None
    original_prediction: Dict[str, Any] = Field(default_factory=dict)
    original_score: float = Field(default=0.0, ge=0.0, le=1.0)
    geo_context: Optional[Dict[str, Any]] = None
    audio_evidence_path: Optional[str] = None
    review_decision: ReviewDecision = "needs_more_evidence"
    reviewer_note: Optional[str] = None


class EnvironmentalReviewUpdate(BaseModel):
    review_decision: ReviewDecision
    reviewer_note: Optional[str] = None


class EnvironmentalReviewResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    review_category: str
    target_type: str
    target_id: str
    site_id: Optional[str]
    session_id: Optional[str]
    original_prediction: Dict[str, Any]
    original_score: float
    geo_context: Optional[Dict[str, Any]]
    audio_evidence_path: Optional[str]
    review_decision: str
    reviewer_note: Optional[str]
    history: List[Dict[str, Any]]
    created_at: datetime
    updated_at: datetime


# ----------------------------------------------------------------------------
# MODULE E: Environmental Incident Schemas
# ----------------------------------------------------------------------------
IncidentPriority = Literal["informational", "low", "medium", "high", "critical"]
IncidentStatus = Literal["detected", "under_review", "confirmed", "dismissed", "resolved"]


class EnvironmentalIncidentCreate(BaseModel):
    site_id: Optional[str] = None
    session_id: Optional[str] = None
    primary_event_id: Optional[str] = None
    title: str = Field(..., min_length=3, max_length=255)
    category: str = Field(
        default="anthropogenic_disturbance",
        description="anthropogenic_disturbance, logging_signature, gunfire_signature, wildfire_signature, critical_anomaly",
    )
    priority: IncidentPriority = "medium"
    status: IncidentStatus = "detected"
    event_ids: List[str] = Field(default_factory=list)
    evidence: Dict[str, Any] = Field(default_factory=dict)
    investigation_notes: Optional[str] = None


class EnvironmentalIncidentUpdate(BaseModel):
    title: Optional[str] = None
    priority: Optional[IncidentPriority] = None
    status: Optional[IncidentStatus] = None
    event_ids: Optional[List[str]] = None
    evidence: Optional[Dict[str, Any]] = None
    investigation_notes: Optional[str] = None
    resolution_notes: Optional[str] = None


class EnvironmentalIncidentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    incident_code: str
    site_id: Optional[str]
    session_id: Optional[str]
    primary_event_id: Optional[str]
    title: str
    category: str
    priority: str
    status: str
    event_ids: List[str]
    evidence: Dict[str, Any]
    investigation_notes: Optional[str]
    resolution_notes: Optional[str]
    created_at: datetime
    updated_at: datetime
    resolved_at: Optional[datetime]
    disclaimer: str = (
        "Environmental incidents represent automated screening aggregations. "
        "Acoustic classifications do not constitute proof of criminal activity, illegal logging, or law enforcement violations."
    )


# ----------------------------------------------------------------------------
# MODULE F: Ecological Evidence Reports
# ----------------------------------------------------------------------------
class EcologicalReportRequest(BaseModel):
    site_id: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    format: Literal["json", "csv"] = "json"
    include_raw_ai_predictions: bool = True
    include_unverified_detections: bool = True
    mask_sensitive_locations: bool = True


class EcologicalReportMetadata(BaseModel):
    report_id: str
    generated_at: str
    site_id: str
    site_name: str
    ecosystem_category: str
    geographic_coordinates: Dict[str, Any]
    model_version: str = "BirdNET+ V3.0 & BirdNET Geo V3.0"
    analysis_period: Dict[str, Optional[str]]
    total_audio_hours_analyzed: float
    species_inventory_count: int
    human_verified_observations_count: int
    disturbances_recorded_count: int
    incidents_logged_count: int
    disclaimer: str
