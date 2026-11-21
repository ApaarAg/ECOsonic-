"""Pydantic schemas for Acoustic Memory search, retrieval, clustering, and visualization APIs."""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class SimilaritySearchRequest(BaseModel):
    query_segment_id: Optional[str] = Field(
        None, description="Segment ID to search similar sounds for"
    )
    query_vector: Optional[List[float]] = Field(
        None, description="Direct 1,280-D query vector"
    )
    limit: int = Field(
        10, ge=1, le=100, description="Maximum number of similar segments to retrieve"
    )
    min_similarity: float = Field(
        0.0, ge=-1.0, le=1.0, description="Minimum cosine similarity score threshold"
    )
    exclude_same_session: bool = Field(
        False, description="Exclude candidate segments from the same monitoring session"
    )
    site_id: Optional[str] = Field(
        None, description="Filter candidates by monitoring site ID"
    )
    model_version: Optional[str] = Field(
        None, description="Filter candidates by model version"
    )
    date_from: Optional[str] = Field(
        None, description="Filter candidates recorded on or after this ISO datetime"
    )
    date_to: Optional[str] = Field(
        None, description="Filter candidates recorded on or before this ISO datetime"
    )


class SimilarityMatchResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    segment_id: str
    similarity_score: float
    session_id: Optional[str] = None
    analysis_id: Optional[str] = None
    site_id: Optional[str] = None
    start_seconds: float
    end_seconds: float
    model_version: str
    label: Optional[str] = None
    confidence: Optional[float] = None
    created_at: Optional[str] = None
    has_audio: bool = False
    disclaimer: str


class IndexStatusResponse(BaseModel):
    vector_count: int
    embedding_dimension: int
    model_version: str
    status: str
    last_updated: str


class IndexRebuildResponse(BaseModel):
    vector_count: int
    elapsed_seconds: float
    model_version: str
    status: str


class SegmentMetadataResponse(BaseModel):
    segment_id: str
    session_id: Optional[str] = None
    analysis_id: Optional[str] = None
    site_id: Optional[str] = None
    start_seconds: float
    end_seconds: float
    model_version: str
    has_audio: bool = False
    label: Optional[str] = None
    confidence: Optional[float] = None
    created_at: Optional[str] = None


class SessionSegmentsResponse(BaseModel):
    session_id: str
    total_count: int
    page: int
    page_size: int
    segments: List[SegmentMetadataResponse]


class ClusteringRunRequest(BaseModel):
    min_cluster_size: int = Field(
        5, ge=2, description="Minimum cluster size for HDBSCAN"
    )
    min_samples: Optional[int] = Field(
        None, ge=1, description="Minimum samples parameter for HDBSCAN"
    )
    metric: str = Field("euclidean", description="Distance metric")


class ClusteringRunResponse(BaseModel):
    cluster_run_id: str
    model_version: str
    dataset_size: int
    cluster_count: int
    noise_count: int
    cluster_sizes: Dict[int, int]
    parameters: Dict[str, Any]
    status: str
    created_at: str
    elapsed_seconds: float
    disclaimer: str


class VisualizationResponse(BaseModel):
    points: List[Dict[str, Any]]
    count: int
    parameters: Dict[str, Any]
    disclaimer: str
