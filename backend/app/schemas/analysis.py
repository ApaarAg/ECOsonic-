from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field

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
