"""EcoSonic Unified Event Intelligence and Evidence Management Service.

Consolidates and standardizes heterogeneous bioacoustic observations into a common
audit-grade event record:
1. Biological Detections (Avian, amphibian, mammalian, insect vocalizations)
2. Disturbance Events (Verified non-animal anthropogenic and mechanical signatures)
3. Acoustic Anomalies (Statistically novel or unrecognized acoustic candidates)
4. Repeated Sound Patterns (Recurring bioacoustic bouts or persistent anthropogenic drones)
5. Soundscape Change Observations (Quantified shifts in NDSI, ACI, or entropy)

Scientific & Architectural Principles:
1. Evidence Separation: Audio clips and high-dimensional arrays are persisted on disk outside SQLite.
2. Uncertain Preservation: Low-confidence and anomalous observations are preserved with explicit review flags.
3. Event Deduplication: Overlapping and contiguous events of the same class are consolidated.
"""

from __future__ import annotations

import logging
import math
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Tuple, Union

import numpy as np
import soundfile as sf

from app.config import settings

logger = logging.getLogger(__name__)

EventTypeLiteral = Literal[
    "biological_detection",
    "disturbance_event",
    "acoustic_anomaly",
    "repeated_pattern",
    "soundscape_change",
]

SCIENTIFIC_EVENT_DISCLAIMER = (
    "EcoSonic unified event records aggregate automated machine learning and signal processing observations. "
    "All records provide objective screening metadata and require ecological domain verification."
)


@dataclass
class ContextualAudioEvidence:
    """Externalized audio and vector evidence artifacts linked to an event."""

    audio_clip_path: Optional[str] = None
    embedding_path: Optional[str] = None
    spectrogram_path: Optional[str] = None
    clip_duration_seconds: float = 0.0
    sample_rate: int = 32000
    file_size_bytes: int = 0


@dataclass
class UnifiedAcousticEvent:
    """Standardized event record representing any environmental acoustic phenomenon."""

    event_id: str
    session_id: str
    event_type: EventTypeLiteral
    category: str  # biophony, anthrophony, anomaly, soundscape_drift
    class_label: str
    display_name: str
    start_seconds: float
    end_seconds: float
    duration_seconds: float
    confidence_or_score: Optional[float]
    priority_level: str  # CRITICAL, HIGH, MEDIUM, LOW, INFORMATIONAL
    model_version: str
    evidence: ContextualAudioEvidence
    soundscape_snapshot: Dict[str, Any] = field(default_factory=dict)
    details: Dict[str, Any] = field(default_factory=dict)
    review_status: str = "pending"  # pending, confirmed, rejected, flagged
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    disclaimer: str = SCIENTIFIC_EVENT_DISCLAIMER

    def to_dict(self) -> Dict[str, Any]:
        return {
            "event_id": self.event_id,
            "session_id": self.session_id,
            "event_type": self.event_type,
            "category": self.category,
            "class_label": self.class_label,
            "display_name": self.display_name,
            "start_seconds": self.start_seconds,
            "end_seconds": self.end_seconds,
            "duration_seconds": self.duration_seconds,
            "confidence_or_score": self.confidence_or_score,
            "priority_level": self.priority_level,
            "model_version": self.model_version,
            "evidence": asdict(self.evidence),
            "soundscape_snapshot": self.soundscape_snapshot,
            "details": self.details,
            "review_status": self.review_status,
            "created_at": self.created_at,
            "disclaimer": self.disclaimer,
        }


class EventIntelligenceService:
    """Orchestrates event consolidation, contextual audio preservation, and unified intelligence feeds."""

    def __init__(self, evidence_dir: Optional[Path] = None) -> None:
        self.evidence_dir = evidence_dir or (settings.STORAGE_BASE_DIR / "evidence")
        self.evidence_dir.mkdir(parents=True, exist_ok=True)

    def save_audio_evidence(
        self,
        session_id: str,
        event_id: str,
        audio_samples: np.ndarray,
        sample_rate: int = 32000,
    ) -> ContextualAudioEvidence:
        """Persist contextual raw audio clip to disk outside SQLite."""
        session_evidence_dir = self.evidence_dir / session_id
        session_evidence_dir.mkdir(parents=True, exist_ok=True)

        clip_filename = f"{event_id}.wav"
        clip_path = session_evidence_dir / clip_filename

        # Write WAV using soundfile
        audio_f32 = np.asarray(audio_samples, dtype=np.float32)
        sf.write(str(clip_path), audio_f32, sample_rate, subtype="PCM_16")

        dur = len(audio_f32) / max(1, sample_rate)
        fsize = clip_path.stat().st_size if clip_path.exists() else 0

        return ContextualAudioEvidence(
            audio_clip_path=str(clip_path),
            clip_duration_seconds=round(dur, 3),
            sample_rate=sample_rate,
            file_size_bytes=fsize,
        )

    def consolidate_events(
        self,
        events: List[UnifiedAcousticEvent],
        tolerance_seconds: float = 1.5,
    ) -> List[UnifiedAcousticEvent]:
        """Consolidate overlapping and contiguous events of identical type and class label.

        Args:
            events: Chronological list of UnifiedAcousticEvent instances.
            tolerance_seconds: Maximum time separation to merge contiguous bouts.

        Returns:
            Deduplicated, consolidated list of events.
        """
        if not events:
            return []

        # Group by (event_type, class_label)
        grouped: Dict[Tuple[str, str], List[UnifiedAcousticEvent]] = {}
        for ev in events:
            key = (ev.event_type, ev.class_label)
            grouped.setdefault(key, []).append(ev)

        consolidated: List[UnifiedAcousticEvent] = []

        for (e_type, c_lbl), ev_list in grouped.items():
            ev_list.sort(key=lambda e: (e.start_seconds, e.end_seconds))
            current = ev_list[0]

            for next_ev in ev_list[1:]:
                # Check for overlap or contiguous abutment
                if next_ev.start_seconds - current.end_seconds <= tolerance_seconds:
                    # Merge into current
                    new_end = max(current.end_seconds, next_ev.end_seconds)
                    current.end_seconds = round(new_end, 3)
                    current.duration_seconds = round(new_end - current.start_seconds, 3)

                    # Update scores
                    if current.confidence_or_score is not None and next_ev.confidence_or_score is not None:
                        current.confidence_or_score = max(
                            current.confidence_or_score, next_ev.confidence_or_score
                        )

                    # Merge details if dicts
                    if "merged_count" in current.details:
                        current.details["merged_count"] += 1
                    else:
                        current.details["merged_count"] = 2
                else:
                    consolidated.append(current)
                    current = next_ev

            consolidated.append(current)

        consolidated.sort(key=lambda e: (e.start_seconds, e.end_seconds))
        return consolidated


# Singleton instance
event_intelligence_service = EventIntelligenceService()
