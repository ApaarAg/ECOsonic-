from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field


class ReviewCreate(BaseModel):
    review_status: str = Field(
        ...,
        description="Review decision: confirmed, rejected, uncertain, or custom status",
    )
    reviewer_note: Optional[str] = Field(default=None, description="Optional reviewer remarks")


class ReviewResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    detection_id: str
    review_status: str
    reviewer_note: Optional[str] = None
    created_at: datetime


class DetectionBase(BaseModel):
    class_label: str = Field(..., description="Model class label (e.g. Passer domesticus_House Sparrow)")
    scientific_name: str = Field(..., description="Scientific binomial name")
    common_name: str = Field(..., description="Common English name")
    taxon_group: Optional[str] = Field(default="Aves", description="Taxonomic grouping")
    record_type: Optional[str] = Field(default="vocalization", description="Call type (song, call, etc.)")
    start_seconds: float = Field(..., ge=0.0, description="Start timestamp in seconds")
    end_seconds: float = Field(..., gt=0.0, description="End timestamp in seconds")
    confidence_score: float = Field(..., ge=0.0, le=1.0, description="Model prediction confidence")
    geo_score: Optional[float] = Field(default=None, ge=0.0, le=1.0, description="Location prior score")
    review_status: str = Field(default="unreviewed", description="Status of human verification")


class DetectionCreate(DetectionBase):
    analysis_id: str


class DetectionUpdate(BaseModel):
    review_status: Optional[str] = None
    geo_score: Optional[float] = None


class DetectionResponse(DetectionBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    analysis_id: str
    reviews: List[ReviewResponse] = []


class EmbeddingSegmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    segment_id: str
    analysis_id: str
    vector_index: int
    start_seconds: float
    end_seconds: float
    detection_id: Optional[str] = None
