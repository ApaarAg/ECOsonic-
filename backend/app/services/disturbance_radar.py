"""EcoSonic Disturbance Radar & Biological Co-Occurrence Intelligence Engine.

Processes, classifies, aggregates, prioritizes, and correlates non-biological acoustic events
using verified BirdNET+ V3.0 model sound classes.

Verified Model Taxonomy:
Physically cross-referenced against the BirdNET V3.0 vocabulary (11,725 species/sound classes):
- Anthropogenic Transportation: Aircraft, Boat, Engine, Motor vehicle, Train, Siren, Vehicle horn
- Mechanical Activity: Chainsaw, Hammer, Power tool, Sawing
- Potential Environmental Hazard: Chainsaw, Explosion, Fire, Gun
- Cultural & Recreational: Fireworks, Music

Scientific Guardrails:
1. Model scores are raw softmax logit projections, NOT calibrated probabilities of legal/illegal activity.
2. Co-occurrence analysis reports temporal correlation only. No causal ecological claim is made.
"""

from __future__ import annotations

import logging
import math
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Coroutine, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

SCIENTIFIC_DISTURBANCE_DISCLAIMER = (
    "Disturbance detections represent acoustic similarity matches to BirdNET V3.0 non-animal classes. "
    "Detections are screening observations and do NOT constitute legal evidence or calibrated probabilities."
)

# Canonical 16 verified non-animal sound classes physically present in BirdNET V3.0
VERIFIED_DISTURBANCE_TAXONOMY: Dict[str, Dict[str, Any]] = {
    "Aircraft": {
        "event_type": "aircraft",
        "display_name": "Aircraft",
        "category": "anthropogenic_transportation",
        "hazard_tier": "low",
        "default_threshold": 0.20,
        "base_priority_weight": 0.30,
        "description": "Fixed-wing commercial aircraft, private planes, or rotorcraft acoustics.",
        "signature": "Low-frequency turbine or rotor blade harmonics (50-500 Hz).",
    },
    "Boat": {
        "event_type": "boat",
        "display_name": "Boat",
        "category": "anthropogenic_transportation",
        "hazard_tier": "low",
        "default_threshold": 0.20,
        "base_priority_weight": 0.30,
        "description": "Inboard/outboard marine motors, wake cavitation, and watercraft rumble.",
        "signature": "Propeller blade cavitation and marine exhaust rumble across riparian corridors.",
    },
    "Chainsaw": {
        "event_type": "chainsaw",
        "display_name": "Chainsaw",
        "category": "potential_environmental_hazard",
        "hazard_tier": "critical",
        "default_threshold": 0.15,
        "base_priority_weight": 0.95,
        "description": "Two-stroke high-RPM cutting engine acoustics.",
        "signature": "Harsh 2-stroke engine harmonics (100-3000 Hz) indicative of logging or habitat clearing.",
    },
    "Engine": {
        "event_type": "engine",
        "display_name": "Engine",
        "category": "anthropogenic_transportation",
        "hazard_tier": "low",
        "default_threshold": 0.20,
        "base_priority_weight": 0.35,
        "description": "Generic internal combustion engine or stationary generator droning.",
        "signature": "Stationary or mobile combustion engine mechanical vibrations (80-800 Hz).",
    },
    "Explosion": {
        "event_type": "explosion",
        "display_name": "Explosion",
        "category": "potential_environmental_hazard",
        "hazard_tier": "critical",
        "default_threshold": 0.20,
        "base_priority_weight": 0.95,
        "description": "Concussive blast wave, detonation, or quarry blasting.",
        "signature": "Steep impulsive acoustic shockwave with extended low-frequency seismic tail.",
    },
    "Fire": {
        "event_type": "fire",
        "display_name": "Fire",
        "category": "potential_environmental_hazard",
        "hazard_tier": "critical",
        "default_threshold": 0.25,
        "base_priority_weight": 0.90,
        "description": "Combustion roaring and broadband dry fuel crackling.",
        "signature": "Broadband stochastic crackling and turbulent thermal convection roaring.",
    },
    "Fireworks": {
        "event_type": "fireworks",
        "display_name": "Fireworks",
        "category": "cultural_sound",
        "hazard_tier": "medium",
        "default_threshold": 0.20,
        "base_priority_weight": 0.60,
        "description": "Pyrotechnic explosions, whistlers, and concussive bursts.",
        "signature": "Multiple impulsive concussive bursts with acoustic whistles.",
    },
    "Gun": {
        "event_type": "gunshot",
        "display_name": "Gunshot",
        "category": "potential_environmental_hazard",
        "hazard_tier": "critical",
        "default_threshold": 0.15,
        "base_priority_weight": 0.95,
        "description": "Ballistic muzzle blast and supersonic projectile acoustic crack.",
        "signature": "Sub-millisecond impulsive ballistic report; potential indicator of hunting or poaching.",
    },
    "Hammer": {
        "event_type": "hammer",
        "display_name": "Hammer",
        "category": "mechanical_activity",
        "hazard_tier": "medium",
        "default_threshold": 0.20,
        "base_priority_weight": 0.50,
        "description": "Repetitive percussive metal or timber striking sounds.",
        "signature": "Periodic percussive metallic or timber transient impacts.",
    },
    "Motor vehicle": {
        "event_type": "motor_vehicle",
        "display_name": "Motor Vehicle",
        "category": "anthropogenic_transportation",
        "hazard_tier": "low",
        "default_threshold": 0.20,
        "base_priority_weight": 0.35,
        "description": "Automobiles, trucks, road tire-pavement friction, and road transit.",
        "signature": "Pneumatic tire road friction drone and acceleration roar (100-1500 Hz).",
    },
    "Music": {
        "event_type": "music",
        "display_name": "Music",
        "category": "cultural_sound",
        "hazard_tier": "low",
        "default_threshold": 0.25,
        "base_priority_weight": 0.25,
        "description": "Human musical instruments, amplified speakers, or radio sound.",
        "signature": "Harmonic, rhythmic amplified acoustic signals signifying human recreation.",
    },
    "Power tool": {
        "event_type": "power_tool",
        "display_name": "Power Tool",
        "category": "mechanical_activity",
        "hazard_tier": "medium",
        "default_threshold": 0.20,
        "base_priority_weight": 0.60,
        "description": "Electric drills, rotary saws, grinders, or motorized hand tools.",
        "signature": "High-RPM electric commutator whine and abrasive material contact.",
    },
    "Sawing": {
        "event_type": "sawing",
        "display_name": "Sawing",
        "category": "mechanical_activity",
        "hazard_tier": "medium",
        "default_threshold": 0.20,
        "base_priority_weight": 0.65,
        "description": "Manual or reciprocating cutting strokes through wood or metal.",
        "signature": "Periodic frictional blade strokes through vegetative or timber structures.",
    },
    "Siren": {
        "event_type": "siren",
        "display_name": "Siren",
        "category": "anthropogenic_transportation",
        "hazard_tier": "medium",
        "default_threshold": 0.20,
        "base_priority_weight": 0.70,
        "description": "Emergency vehicle frequency-modulated siren alarm (police, ambulance, fire).",
        "signature": "High-decibel tonal sweeps between 500 Hz and 2000 Hz.",
    },
    "Train": {
        "event_type": "train",
        "display_name": "Train",
        "category": "anthropogenic_transportation",
        "hazard_tier": "low",
        "default_threshold": 0.20,
        "base_priority_weight": 0.35,
        "description": "Freight/passenger train diesel propulsion, steel rail rumble, and horns.",
        "signature": "Heavy steel-on-steel rail rumble and high-volume pneumatic horn blasts.",
    },
    "Vehicle horn": {
        "event_type": "vehicle_horn",
        "display_name": "Vehicle Horn",
        "category": "anthropogenic_transportation",
        "hazard_tier": "low",
        "default_threshold": 0.20,
        "base_priority_weight": 0.40,
        "description": "Automotive warning horn blasts.",
        "signature": "Dual-tone tonal blast (typically 400-500 Hz).",
    },
}

# Support both raw class label formats (e.g. "Chainsaw" or "Chainsaw_Chainsaw")
CANONICAL_LOOKUP: Dict[str, str] = {}
for name in VERIFIED_DISTURBANCE_TAXONOMY:
    CANONICAL_LOOKUP[name.lower()] = name
    CANONICAL_LOOKUP[f"{name.lower()}_{name.lower()}"] = name


@dataclass
class DisturbanceEvidenceReference:
    """Audit references linking an aggregated disturbance event to underlying audio evidence."""

    segment_ids: List[str] = field(default_factory=list)
    audio_paths: List[str] = field(default_factory=list)
    window_indices: List[int] = field(default_factory=list)
    embedding_ids: List[str] = field(default_factory=list)


@dataclass
class DisturbanceEventRecord:
    """Aggregated, deduplicated, and prioritized disturbance event."""

    event_id: str
    session_id: str
    class_label: str
    event_type: str
    category: str
    hazard_tier: str  # critical, medium, low
    priority_level: str  # CRITICAL, HIGH, MEDIUM, LOW, INFORMATIONAL
    priority_score: float  # [0.0, 1.0]
    start_seconds: float
    end_seconds: float
    duration_seconds: float
    peak_confidence: float
    mean_confidence: float
    repetition_count: int
    window_timeline: List[Dict[str, float]]
    evidence: DisturbanceEvidenceReference
    model_version: str = "BirdNET+ V3.0"
    review_status: str = "pending"
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    disclaimer: str = SCIENTIFIC_DISTURBANCE_DISCLAIMER

    def to_dict(self) -> Dict[str, Any]:
        return {
            "event_id": self.event_id,
            "session_id": self.session_id,
            "class_label": self.class_label,
            "event_type": self.event_type,
            "category": self.category,
            "hazard_tier": self.hazard_tier,
            "priority_level": self.priority_level,
            "priority_score": self.priority_score,
            "start_seconds": self.start_seconds,
            "end_seconds": self.end_seconds,
            "duration_seconds": self.duration_seconds,
            "peak_confidence": self.peak_confidence,
            "mean_confidence": self.mean_confidence,
            "repetition_count": self.repetition_count,
            "window_timeline": self.window_timeline,
            "evidence": asdict(self.evidence),
            "model_version": self.model_version,
            "review_status": self.review_status,
            "created_at": self.created_at,
            "disclaimer": self.disclaimer,
        }


@dataclass
class BiologicalCoOccurrenceObservation:
    """Non-causal correlation between a disturbance event and surrounding biological vocalizations."""

    observation_id: str
    session_id: str
    disturbance_event_id: str
    disturbance_class: str
    disturbance_start_seconds: float
    disturbance_end_seconds: float
    concurrent_biological_species: List[str]
    concurrent_detections_count: int
    pre_disturbance_activity_rate: float  # detections / min in pre-window
    post_disturbance_activity_rate: float  # detections / min in post-window
    activity_delta: float  # post - pre
    interpretation: str
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class DisturbanceRadarEngine:
    """Core intelligence engine for disturbance aggregation, deduplication, prioritization, and co-occurrence."""

    def __init__(
        self,
        merge_tolerance_seconds: float = 3.5,
        min_duration_seconds: float = 1.0,
        custom_thresholds: Optional[Dict[str, float]] = None,
    ) -> None:
        self.merge_tolerance_seconds = merge_tolerance_seconds
        self.min_duration_seconds = min_duration_seconds
        self.thresholds: Dict[str, float] = {}
        for k, v in VERIFIED_DISTURBANCE_TAXONOMY.items():
            self.thresholds[k] = v["default_threshold"]
        if custom_thresholds:
            for k, val in custom_thresholds.items():
                canonical = self.resolve_canonical_label(k)
                if canonical:
                    self.thresholds[canonical] = max(0.01, min(1.0, val))

    @staticmethod
    def resolve_canonical_label(label: str) -> Optional[str]:
        """Resolve a raw class label into a verified canonical disturbance name."""
        cleaned = label.strip().lower()
        if cleaned in CANONICAL_LOOKUP:
            return CANONICAL_LOOKUP[cleaned]
        # Check prefix match (e.g. "Chainsaw_Chainsaw")
        for key, canonical in CANONICAL_LOOKUP.items():
            if cleaned == key or cleaned.startswith(f"{key}_"):
                return canonical
        return None

    def is_disturbance_class(self, label: str) -> bool:
        """Check whether a label belongs to the verified non-animal disturbance taxonomy."""
        return self.resolve_canonical_label(label) is not None

    def get_taxonomy(self) -> Dict[str, Any]:
        """Return full verified taxonomy with active thresholds."""
        result = {}
        for k, meta in VERIFIED_DISTURBANCE_TAXONOMY.items():
            entry = dict(meta)
            entry["active_threshold"] = self.thresholds.get(k, meta["default_threshold"])
            result[k] = entry
        return result

    def compute_priority(
        self,
        canonical_label: str,
        peak_confidence: float,
        duration_seconds: float,
        repetition_count: int,
    ) -> Tuple[str, float]:
        """Compute an evidence-based priority score and tier for a disturbance event.

        Heuristic:
        Priority = 0.50 * BaseHazardWeight + 0.30 * PeakConfidence + 0.15 * DurationFactor + 0.05 * RepetitionFactor
        """
        meta = VERIFIED_DISTURBANCE_TAXONOMY.get(canonical_label, {})
        base_weight = meta.get("base_priority_weight", 0.40)

        # Duration factor: saturates at 30 seconds
        dur_factor = min(1.0, duration_seconds / 30.0)

        # Repetition factor: saturates at 5 repetitions
        rep_factor = min(1.0, max(0, repetition_count - 1) / 4.0)

        raw_score = (
            0.50 * base_weight
            + 0.30 * min(1.0, peak_confidence)
            + 0.15 * dur_factor
            + 0.05 * rep_factor
        )
        score = round(max(0.0, min(1.0, raw_score)), 4)

        if score >= 0.80 or meta.get("hazard_tier") == "critical" and peak_confidence >= 0.40:
            level = "CRITICAL"
        elif score >= 0.60:
            level = "HIGH"
        elif score >= 0.40:
            level = "MEDIUM"
        elif score >= 0.20:
            level = "LOW"
        else:
            level = "INFORMATIONAL"

        return level, score

    def aggregate_raw_detections(
        self,
        raw_detections: List[Dict[str, Any]],
        session_id: str = "session_0",
    ) -> List[DisturbanceEventRecord]:
        """Aggregate a chronological stream of window-level detections into consolidated disturbance events.

        Performs:
        1. Taxonomy filtering and active threshold verification.
        2. Temporal event merging for consecutive or closely spaced detections (<= merge_tolerance).
        3. Peak and mean confidence calculation.
        4. Event duration estimation.
        5. Evidence tracking.
        6. Event prioritization.

        Args:
            raw_detections: List of dicts with keys: 'label'/'class_label', 'confidence_score',
                            'start_seconds', 'end_seconds', and optional 'segment_id', 'audio_path'.
            session_id: Session UUID.

        Returns:
            List of consolidated DisturbanceEventRecord objects sorted chronologically.
        """
        # 1. Filter to valid disturbance candidates above active threshold
        valid_hits: List[Dict[str, Any]] = []
        for det in raw_detections:
            lbl = det.get("class_label") or det.get("label") or det.get("common_name") or ""
            canonical = self.resolve_canonical_label(lbl)
            if not canonical:
                continue

            conf = float(det.get("confidence_score") or det.get("confidence") or 0.0)
            threshold = self.thresholds.get(canonical, 0.20)
            if conf < threshold:
                continue

            t_start = float(det.get("start_seconds", 0.0))
            t_end = float(det.get("end_seconds", t_start + 3.0))

            valid_hits.append({
                "canonical_label": canonical,
                "confidence": conf,
                "start_seconds": t_start,
                "end_seconds": t_end,
                "segment_id": det.get("segment_id"),
                "audio_path": det.get("audio_path"),
                "window_index": det.get("window_index"),
                "embedding_id": det.get("embedding_id"),
            })

        if not valid_hits:
            return []

        # Sort by start time
        valid_hits.sort(key=lambda x: (x["start_seconds"], x["end_seconds"]))

        # 2. Merge temporal clusters per class
        events: List[DisturbanceEventRecord] = []
        class_clusters: Dict[str, List[List[Dict[str, Any]]]] = {}

        for hit in valid_hits:
            c_lbl = hit["canonical_label"]
            if c_lbl not in class_clusters:
                class_clusters[c_lbl] = [[hit]]
                continue

            # Check if this hit can merge into the last cluster of this class
            last_cluster = class_clusters[c_lbl][-1]
            last_end = max(h["end_seconds"] for h in last_cluster)

            if hit["start_seconds"] - last_end <= self.merge_tolerance_seconds:
                last_cluster.append(hit)
            else:
                class_clusters[c_lbl].append([hit])

        # 3. Assemble consolidated events
        for c_lbl, clusters in class_clusters.items():
            meta = VERIFIED_DISTURBANCE_TAXONOMY[c_lbl]

            for cluster_idx, cluster in enumerate(clusters):
                cluster_start = min(h["start_seconds"] for h in cluster)
                cluster_end = max(h["end_seconds"] for h in cluster)
                duration = round(cluster_end - cluster_start, 3)

                conf_scores = [h["confidence"] for h in cluster]
                peak_conf = round(float(np.max(conf_scores)), 4)
                mean_conf = round(float(np.mean(conf_scores)), 4)

                timeline = [
                    {
                        "start_seconds": h["start_seconds"],
                        "end_seconds": h["end_seconds"],
                        "confidence": h["confidence"],
                    }
                    for h in cluster
                ]

                evidence = DisturbanceEvidenceReference(
                    segment_ids=[h["segment_id"] for h in cluster if h.get("segment_id")],
                    audio_paths=[h["audio_path"] for h in cluster if h.get("audio_path")],
                    window_indices=[h["window_index"] for h in cluster if h.get("window_index") is not None],
                    embedding_ids=[h["embedding_id"] for h in cluster if h.get("embedding_id")],
                )

                rep_count = len(cluster)
                p_level, p_score = self.compute_priority(c_lbl, peak_conf, duration, rep_count)

                events.append(
                    DisturbanceEventRecord(
                        event_id=str(uuid.uuid4()),
                        session_id=session_id,
                        class_label=c_lbl,
                        event_type=meta["event_type"],
                        category=meta["category"],
                        hazard_tier=meta["hazard_tier"],
                        priority_level=p_level,
                        priority_score=p_score,
                        start_seconds=round(cluster_start, 3),
                        end_seconds=round(cluster_end, 3),
                        duration_seconds=duration,
                        peak_confidence=peak_conf,
                        mean_confidence=mean_conf,
                        repetition_count=rep_count,
                        window_timeline=timeline,
                        evidence=evidence,
                    )
                )

        # Sort all final consolidated events chronologically
        events.sort(key=lambda e: (e.start_seconds, e.end_seconds))
        return events

    def analyze_biological_cooccurrence(
        self,
        disturbance_event: DisturbanceEventRecord,
        biological_detections: List[Dict[str, Any]],
        context_window_seconds: float = 30.0,
    ) -> BiologicalCoOccurrenceObservation:
        """Evaluate biological vocal activity around a disturbance event without asserting causality.

        Args:
            disturbance_event: The consolidated disturbance event.
            biological_detections: List of biological detection records with start_seconds, end_seconds, class_label.
            context_window_seconds: Window before and after to compare biological activity (default: 30s).

        Returns:
            BiologicalCoOccurrenceObservation describing vocal rate changes and concurrent vocalizers.
        """
        d_start = disturbance_event.start_seconds
        d_end = disturbance_event.end_seconds

        pre_window = (max(0.0, d_start - context_window_seconds), d_start)
        post_window = (d_end, d_end + context_window_seconds)

        pre_hits = [
            b for b in biological_detections
            if pre_window[0] <= float(b.get("start_seconds", 0.0)) < pre_window[1]
        ]
        post_hits = [
            b for b in biological_detections
            if post_window[0] <= float(b.get("start_seconds", 0.0)) < post_window[1]
        ]
        concurrent_hits = [
            b for b in biological_detections
            if not (float(b.get("end_seconds", 0.0)) < d_start or float(b.get("start_seconds", 0.0)) > d_end)
        ]

        concurrent_species = sorted(list({
            str(b.get("common_name") or b.get("class_label") or b.get("scientific_name"))
            for b in concurrent_hits
        }))

        # Compute activity rate in detections per minute
        pre_dur_min = max(0.1, (pre_window[1] - pre_window[0]) / 60.0)
        post_dur_min = max(0.1, (post_window[1] - post_window[0]) / 60.0)

        pre_rate = round(len(pre_hits) / pre_dur_min, 2)
        post_rate = round(len(post_hits) / post_dur_min, 2)
        delta_rate = round(post_rate - pre_rate, 2)

        if delta_rate < -5.0:
            interp = (
                f"Observed vocal activity decreased by {abs(delta_rate):.1f} detections/min "
                f"following the {disturbance_event.class_label} event (purely observational; non-causal)."
            )
        elif delta_rate > 5.0:
            interp = (
                f"Observed vocal activity increased by {delta_rate:.1f} detections/min "
                f"following the {disturbance_event.class_label} event (purely observational; non-causal)."
            )
        else:
            interp = (
                f"Observed vocal activity remained comparable (delta: {delta_rate:+.1f} det/min) "
                f"around the {disturbance_event.class_label} event."
            )

        return BiologicalCoOccurrenceObservation(
            observation_id=str(uuid.uuid4()),
            session_id=disturbance_event.session_id,
            disturbance_event_id=disturbance_event.event_id,
            disturbance_class=disturbance_event.class_label,
            disturbance_start_seconds=d_start,
            disturbance_end_seconds=d_end,
            concurrent_biological_species=concurrent_species,
            concurrent_detections_count=len(concurrent_hits),
            pre_disturbance_activity_rate=pre_rate,
            post_disturbance_activity_rate=post_rate,
            activity_delta=delta_rate,
            interpretation=interp,
        )


# Singleton instance
disturbance_radar_engine = DisturbanceRadarEngine()
