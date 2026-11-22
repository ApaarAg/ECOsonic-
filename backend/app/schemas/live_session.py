from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field


SourceTypeLiteral = Literal["browser_mic", "desktop_mic", "field_device", "file_replay"]
SessionStatusLiteral = Literal["created", "active", "paused", "stopped", "failed"]


class LiveSessionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_type: SourceTypeLiteral = Field(
        default="browser_mic",
        description="Origin of the streaming audio producer",
    )
    device_id: Optional[str] = Field(
        default=None,
        description="Optional device identifier (hardware UUID, mic label, etc.)",
    )
    site_id: Optional[str] = Field(
        default=None,
        description="Associated monitoring site UUID",
    )
    latitude: Optional[float] = Field(
        default=None,
        ge=-90.0,
        le=90.0,
        description="Geographic latitude coordinate",
    )
    longitude: Optional[float] = Field(
        default=None,
        ge=-180.0,
        le=180.0,
        description="Geographic longitude coordinate",
    )
    sample_rate: int = Field(
        default=32000,
        description="Audio sampling rate in Hz (default 32000 Hz)",
    )
    channels: int = Field(
        default=1,
        description="Channel count (default 1 = mono)",
    )


class LiveEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    session_id: str
    detection_id: str
    start_seconds: float
    end_seconds: float
    class_label: str
    scientific_name: Optional[str] = None
    common_name: Optional[str] = None
    confidence_score: float
    taxon_group: Optional[str] = None
    model_version: Optional[str] = None
    created_at: datetime


class LiveSegmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    session_id: str
    start_seconds: float
    end_seconds: float
    audio_path: str
    embedding_path: Optional[str] = None
    processing_status: str
    created_at: datetime


class LiveSessionStats(BaseModel):
    audio_capture_rate: float = Field(default=0.0, description="Measured audio throughput in bytes/s")
    audio_input_continuity: float = Field(default=100.0, description="Continuity percentage (100% = no missing frames)")
    avg_inference_latency_ms: float = Field(default=0.0, description="Average BirdNET inference latency per window")
    avg_embedding_latency_ms: float = Field(default=0.0, description="Average embedding extraction latency per window")
    window_processing_lag_ms: float = Field(default=0.0, description="Latency between window completion and inference finish")
    e2e_event_delivery_latency_ms: float = Field(default=0.0, description="End-to-end latency from audio capture to event broadcast")
    dropped_frames: int = Field(default=0, description="Number of missing or dropped audio frames")
    dropped_windows: int = Field(default=0, description="Number of dropped audio windows due to backpressure")
    processed_windows: int = Field(default=0, description="Total completed audio windows (inferred + silent)")
    inferred_windows: int = Field(default=0, description="Number of audio windows evaluated by model inference")
    silent_windows: int = Field(default=0, description="Number of audio windows skipped due to low signal energy / silence")
    inference_queue_size: int = Field(default=0, description="Current depth of pending inference queue")
    embedding_queue_size: int = Field(default=0, description="Current depth of pending embedding queue")
    soundscape_queue_size: int = Field(default=0, description="Current depth of pending soundscape queue")
    gpu_utilization_pct: Optional[float] = Field(default=None, description="GPU compute utilization percentage")
    cpu_utilization_pct: float = Field(default=0.0, description="Host CPU utilization percentage")
    peak_memory_mb: float = Field(default=0.0, description="Peak host RSS memory in MB")


class LiveSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source_type: str
    device_id: Optional[str] = None
    site_id: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    started_at: datetime
    stopped_at: Optional[datetime] = None
    status: str
    sample_rate: int
    channels: int
    total_audio_seconds: float
    processed_audio_seconds: float
    dropped_frames: int
    dropped_windows: int
    recording_path: Optional[str] = None
    created_at: datetime
    events_count: int = 0
    segments_count: int = 0


class LiveSessionDetailResponse(LiveSessionResponse):
    events: List[LiveEventResponse] = []
    segments: List[LiveSegmentResponse] = []
    stats: Optional[LiveSessionStats] = None


# WebSocket Protocol Schemas
class WSDetectionEvent(BaseModel):
    type: Literal["detection"] = "detection"
    session_id: str
    event_id: str
    start_seconds: float
    end_seconds: float
    class_label: str
    scientific_name: Optional[str] = None
    common_name: Optional[str] = None
    confidence_score: float
    taxon_group: Optional[str] = "Bird"
    model_version: str = "3.0.0"


class WSSessionControlEvent(BaseModel):
    type: Literal[
        "session_started",
        "session_paused",
        "session_resumed",
        "session_stopped",
        "processing_update",
        "audio_quality_warning",
        "backpressure_warning",
        "inference_error",
        "heartbeat",
        "heartbeat_ack",
        "handshake_ack",
        "ack",
        "error",
    ]
    session_id: Optional[str] = None
    timestamp: float = Field(default_factory=lambda: datetime.now().timestamp())
    details: Dict[str, Any] = Field(default_factory=dict)
