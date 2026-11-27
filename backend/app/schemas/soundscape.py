"""Pydantic schemas for Soundscape Fingerprint, Disturbance Radar, and Timeline APIs."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class SoundscapeMetrics(BaseModel):
    aci: Optional[float] = Field(
        None, description="Acoustic Complexity Index (ACI) measuring signal intensity variation"
    )
    adi: Optional[float] = Field(
        None, description="Acoustic Diversity Index (ADI) measuring Shannon diversity across frequency bands"
    )
    aei: Optional[float] = Field(
        None, description="Acoustic Evenness Index (AEI) measuring Gini evenness across frequency bands"
    )
    ndsi: Optional[float] = Field(
        None, description="Normalized Difference Soundscape Index (bio - anthro) / (bio + anthro)"
    )
    spectral_entropy: Optional[float] = Field(
        None, description="Spectral Shannon entropy of average spectrum across analysis band"
    )
    temporal_activity: Optional[float] = Field(
        None, description="Fraction of analysis window containing active acoustic energy"
    )


class SoundscapeFingerprintResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    session_id: str
    window_start_seconds: float
    window_end_seconds: float
    metrics: SoundscapeMetrics
    frequency_bands: Dict[str, float] = Field(
        default_factory=dict,
        description="Acoustic energy distribution across frequency sub-bands (anthro, bio, high_bio)",
    )
    calculation_parameters: Dict[str, Any] = Field(
        default_factory=dict,
        description="Spectrogram, window, and frequency parameters used for calculation",
    )
    quality_flags: List[str] = Field(
        default_factory=list,
        description="Signal quality flags (e.g. low_snr, silent_window, clipping_detected)",
    )


class SoundscapeMeasurementResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    session_id: str
    start_seconds: float
    end_seconds: float
    metrics: SoundscapeMetrics
    frequency_bands: Dict[str, float] = Field(default_factory=dict)
    calculation_parameters: Dict[str, Any] = Field(default_factory=dict)
    quality_flags: List[str] = Field(default_factory=list)
    created_at: datetime


class DisturbanceEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    event_id: str = Field(
        validation_alias=AliasChoices("id", "event_id"),
        serialization_alias="event_id",
    )
    session_id: str
    event_type: str
    class_label: str
    category: Optional[str] = None
    hazard_classification: Optional[str] = None
    start_seconds: float
    end_seconds: float
    confidence_score: float
    model_version: str = "3.0.0"
    review_status: str = "pending"
    created_at: datetime


class CoOccurrenceObservationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    session_id: str
    disturbance_event_id: str
    biological_activity_before: float
    biological_activity_after: float
    comparison_window_seconds: float
    difference_value: float
    interpretation: str
    created_at: datetime


class TimelineItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    session_id: str
    item_type: Literal["biological_detection", "disturbance_event", "soundscape_measurement", "acoustic_anomaly"]
    start_seconds: float
    end_seconds: float
    label: str
    confidence_score: Optional[float] = None
    details: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class AnomalyCandidateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    candidate_id: str
    segment_id: str
    session_id: Optional[str] = None
    start_seconds: float
    end_seconds: float
    duration_seconds: float
    anomaly_score: float
    heuristic_breakdown: Dict[str, float] = Field(default_factory=dict)
    primary_reasons: List[str] = Field(default_factory=list)
    top_similar_matches: List[Dict[str, Any]] = Field(default_factory=list)
    model_predictions: List[Dict[str, Any]] = Field(default_factory=list)
    embedding_storage_path: Optional[str] = None
    audio_path: Optional[str] = None
    soundscape_context: Dict[str, Any] = Field(default_factory=dict)
    review_status: str = "unreviewed"
    created_at: str
    disclaimer: str


class SessionIntelligenceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    session_id: str
    status: str
    total_audio_seconds: float
    processed_audio_seconds: float
    detections_count: int
    species_richness: int
    top_detected_species: List[Dict[str, Any]] = Field(default_factory=list)
    disturbances: List[DisturbanceEventResponse] = Field(default_factory=list)
    disturbances_count: int = 0
    critical_disturbances_count: int = 0
    anomalies: List[AnomalyCandidateResponse] = Field(default_factory=list)
    anomalies_count: int = 0
    soundscape_fingerprint: Optional[SoundscapeFingerprintResponse] = None
    co_occurrences: List[CoOccurrenceObservationResponse] = Field(default_factory=list)
    timeline_events_count: int = 0
    species_analysis: Optional[Dict[str, Any]] = None
    disturbance_analysis: Optional[Dict[str, Any]] = None
    context_analysis: Optional[Dict[str, Any]] = None

