from datetime import datetime
import math
from typing import Any, Dict, List, Literal, Optional
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator


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
    gps_accuracy_m: Optional[float] = Field(
        default=None,
        ge=0.0,
        validation_alias=AliasChoices("gps_accuracy_m", "accuracy_m"),
        description="Browser/device geolocation accuracy radius in meters",
    )
    gps_captured_at: Optional[datetime] = Field(
        default=None,
        validation_alias=AliasChoices("gps_captured_at", "captured_at"),
        description="Browser/device geolocation fix timestamp",
    )
    sample_rate: Literal[32000] = Field(
        default=32000,
        description="Live inference accepts 32,000 Hz PCM16 only.",
    )
    channels: Literal[1] = Field(
        default=1,
        description="Live inference accepts mono PCM16 only.",
    )

    @model_validator(mode="after")
    def validate_paired_coordinates(self) -> "LiveSessionCreate":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Both latitude and longitude must be provided together.")
        if self.latitude is not None and not math.isfinite(self.latitude):
            raise ValueError("Latitude must be finite.")
        if self.longitude is not None and not math.isfinite(self.longitude):
            raise ValueError("Longitude must be finite.")
        if self.gps_accuracy_m is not None and (
            not math.isfinite(self.gps_accuracy_m) or self.gps_accuracy_m < 0
        ):
            raise ValueError("GPS accuracy must be finite and non-negative.")
        return self


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
    record_type: Literal["animal", "sound_class"]
    event_semantics: Literal["window_detection"] = "window_detection"
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
    received_frames: int = Field(default=0, description="Accepted WebSocket PCM frames")
    total_bytes_received: int = Field(default=0, description="Accepted PCM payload bytes")
    duplicate_frames: int = Field(default=0, description="Rejected duplicate or out-of-order frames")
    next_expected_sequence: int = Field(default=0, description="Next uint32 sequence number expected from the client")
    avg_inference_latency_ms: float = Field(default=0.0, description="Average BirdNET inference latency per window")
    avg_embedding_latency_ms: float = Field(default=0.0, description="Average embedding extraction latency per window")
    window_processing_lag_ms: float = Field(default=0.0, description="Latency between window completion and inference finish")
    e2e_event_delivery_latency_ms: float = Field(default=0.0, description="End-to-end latency from audio capture to event broadcast")
    dropped_frames: int = Field(default=0, description="Number of missing or dropped audio frames")
    dropped_windows: int = Field(default=0, description="Number of dropped audio windows due to backpressure")
    final_partial_samples_discarded: int = Field(default=0, description="Trailing samples discarded because they did not complete a 3-second inference window")
    final_partial_seconds_discarded: float = Field(default=0.0, description="Trailing audio duration discarded when stopping")
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
    gps_accuracy_m: Optional[float] = None
    gps_captured_at: Optional[datetime] = None
    analysis_id: Optional[str] = None
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
    record_type: Literal["animal", "sound_class"]
    event_semantics: Literal["window_detection"]
    taxon_group: Optional[str] = None
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
