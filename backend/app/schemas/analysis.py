from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from app.schemas.detection import DetectionResponse, EmbeddingSegmentResponse


class AnalysisCreate(BaseModel):
    latitude: Optional[float] = Field(default=None, ge=-90.0, le=90.0)
    longitude: Optional[float] = Field(default=None, ge=-180.0, le=180.0)
    recorded_at: Optional[datetime] = Field(default=None, description="Audio recording timestamp")
    model_version: Optional[str] = Field(default="BirdNET+ V3.0")


class AnalysisStatusResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    status: str
    progress: float
    current_stage: Optional[str] = None
    error_message: Optional[str] = None
    updated_at: datetime


class AnalysisResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    audio_path: str
    processed_path: Optional[str] = None
    status: str
    progress: float
    current_stage: Optional[str] = None
    duration_seconds: Optional[float] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    gps_accuracy_m: Optional[float] = None
    gps_captured_at: Optional[datetime] = None
    recorded_at: Optional[datetime] = None
    model_version: Optional[str] = None
    metrics_json: Optional[Dict[str, Any]] = None
    embedding_path: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    detections_count: Optional[int] = 0


class AnalysisDetailResponse(AnalysisResponse):
    detections: List[DetectionResponse] = []
    embedding_segments: List[EmbeddingSegmentResponse] = []
    ecological_summary: Optional[Dict[str, Any]] = Field(
        default=None,
        validation_alias=AliasChoices("ecological_summary_json", "ecological_summary"),
        serialization_alias="ecological_summary",
    )
    species_analysis: Optional[Dict[str, Any]] = None
    disturbance_analysis: Optional[Dict[str, Any]] = None
    context_analysis: Optional[Dict[str, Any]] = None
    expected_species_analysis: Optional[Dict[str, Any]] = None
    observation_gap_analysis: Optional[Dict[str, Any]] = None
