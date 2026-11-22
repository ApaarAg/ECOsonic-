"""Disturbance Radar service for detecting, thresholding, and merging non-animal sound events."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Coroutine, Dict, List, Optional, Tuple

import numpy as np
from sqlalchemy import select, update

from app.core.database import async_session_factory
from app.core.logging import logger
from app.models.soundscape import DisturbanceEvent

BroadcastCallback = Callable[[Dict[str, Any]], Coroutine[Any, Any, None]]

# Verified against official BirdNET+ V3.0 model species_list metadata (11,725 classes).
# Strictly restricted to classes physically present in the model weights.
# Scientifically partitioned into 4 distinct categories:
# 1. anthropogenic_transportation
# 2. potential_environmental_hazard
# 3. mechanical_activity
# 4. cultural_sound
BIRDNET_V3_DISTURBANCE_CLASSES: Dict[str, Dict[str, Any]] = {
    "Aircraft_Aircraft": {
        "event_type": "aircraft",
        "display_name": "Aircraft",
        "category": "anthropogenic_transportation",
        "hazard_classification": "low",
        "default_threshold": 0.20,
        "description": "Commercial aircraft, private planes, or helicopters.",
        "scientific_notes": "Jet turbine, turboprop or rotorcraft acoustic signature with prominent low-frequency rumble.",
    },
    "Boat_Boat": {
        "event_type": "boat",
        "display_name": "Boat",
        "category": "anthropogenic_transportation",
        "hazard_classification": "low",
        "default_threshold": 0.20,
        "description": "Motorboats, marine engines, or vessel acoustic signatures.",
        "scientific_notes": "Marine motor propulsion, inboard/outboard wake cavitation, and water surface reverberation.",
    },
    "Chainsaw_Chainsaw": {
        "event_type": "chainsaw",
        "display_name": "Chainsaw",
        "category": "potential_environmental_hazard",
        "hazard_classification": "critical",
        "default_threshold": 0.15,
        "description": "Chainsaw 2-stroke engine and cutting acoustic signature.",
        "scientific_notes": "Two-stroke high-RPM cutting harmonics; acute indicator of logging, deforestation, or habitat degradation.",
    },
    "Engine_Engine": {
        "event_type": "engine",
        "display_name": "Engine",
        "category": "anthropogenic_transportation",
        "hazard_classification": "low",
        "default_threshold": 0.20,
        "description": "Generic internal combustion engine or generator noise.",
        "scientific_notes": "Continuous low-to-mid frequency harmonics from combustion cycles or stationary generators.",
    },
    "Explosion_Explosion": {
        "event_type": "explosion",
        "display_name": "Explosion",
        "category": "potential_environmental_hazard",
        "hazard_classification": "critical",
        "default_threshold": 0.20,
        "description": "Blast, detonation, or rapid transient acoustic shockwave.",
        "scientific_notes": "High-amplitude blast wavefront and low-frequency seismic pressure wave; potential mining or poaching disturbance.",
    },
    "Fire_Fire": {
        "event_type": "fire",
        "display_name": "Fire",
        "category": "potential_environmental_hazard",
        "hazard_classification": "critical",
        "default_threshold": 0.25,
        "description": "Crackling, roaring combustion noise from wildfire or open flames.",
        "scientific_notes": "Broadband crackling and thermal convection roaring; natural wildfire or intentional slash-and-burn clearing.",
    },
    "Fireworks_Fireworks": {
        "event_type": "fireworks",
        "display_name": "Fireworks",
        "category": "cultural_sound",
        "hazard_classification": "medium",
        "default_threshold": 0.20,
        "description": "Pyrotechnic explosions and whistlers.",
        "scientific_notes": "Transient concussive pyrotechnic bursts causing acute localized wildlife flight responses.",
    },
    "Gun_Gun": {
        "event_type": "gunshot",
        "display_name": "Gunshot",
        "category": "potential_environmental_hazard",
        "hazard_classification": "critical",
        "default_threshold": 0.15,
        "description": "Firearm muzzle blast and projectile supersonic crack.",
        "scientific_notes": "Impulsive high-energy ballistic report; primary indicator of hunting, poaching, or armed conflict.",
    },
    "Hammer_Hammer": {
        "event_type": "hammer",
        "display_name": "Hammer",
        "category": "mechanical_activity",
        "hazard_classification": "medium",
        "default_threshold": 0.20,
        "description": "Repetitive percussive metal or wood striking noise.",
        "scientific_notes": "Repetitive percussive transient impacts indicative of construction or anthropogenic fabrication.",
    },
    "Motor vehicle_Motor vehicle": {
        "event_type": "motor_vehicle",
        "display_name": "Motor Vehicle",
        "category": "anthropogenic_transportation",
        "hazard_classification": "low",
        "default_threshold": 0.20,
        "description": "Automobiles, trucks, buses, and road traffic sound.",
        "scientific_notes": "Pneumatic tire-road friction, exhaust drone, and engine acceleration across road corridors.",
    },
    "Music_Music": {
        "event_type": "music",
        "display_name": "Music",
        "category": "cultural_sound",
        "hazard_classification": "low",
        "default_threshold": 0.25,
        "description": "Human music, radios, or amplified audio playback.",
        "scientific_notes": "Rhythmic, melodic amplified acoustic signals indicating human recreational presence without direct habitat damage.",
    },
    "Power tool_Power tool": {
        "event_type": "power_tool",
        "display_name": "Power Tool",
        "category": "mechanical_activity",
        "hazard_classification": "medium",
        "default_threshold": 0.20,
        "description": "Drills, grinders, sanders, and motorized electric tools.",
        "scientific_notes": "High-frequency electric motor whines and abrasive contact signatures.",
    },
    "Sawing_Sawing": {
        "event_type": "sawing",
        "display_name": "Sawing",
        "category": "mechanical_activity",
        "hazard_classification": "medium",
        "default_threshold": 0.20,
        "description": "Manual or circular saw cutting through wood or metal.",
        "scientific_notes": "Periodic frictional blade strokes through wood or metal structures.",
    },
    "Siren_Siren": {
        "event_type": "siren",
        "display_name": "Siren",
        "category": "anthropogenic_transportation",
        "hazard_classification": "medium",
        "default_threshold": 0.20,
        "description": "Emergency vehicle siren (police, ambulance, fire).",
        "scientific_notes": "High-decibel frequency-modulated emergency warning tones.",
    },
    "Train_Train": {
        "event_type": "train",
        "display_name": "Train",
        "category": "anthropogenic_transportation",
        "hazard_classification": "low",
        "default_threshold": 0.20,
        "description": "Locomotive engines, train horns, and rail track rumble.",
        "scientific_notes": "Steel-on-steel rail rumble, diesel locomotive propulsion, and pneumatic horn blasts.",
    },
    "Vehicle horn_Vehicle horn": {
        "event_type": "vehicle_horn",
        "display_name": "Vehicle Horn",
        "category": "anthropogenic_transportation",
        "hazard_classification": "low",
        "default_threshold": 0.20,
        "description": "Automobile or truck acoustic horn warning blasts.",
        "scientific_notes": "Narrowband dual-tone warning blasts from motor vehicle horns.",
    },
}


@dataclass
class ActiveDisturbance:
    """In-memory state of an ongoing disturbance event for temporal merging."""

    event_id: str
    session_id: str
    class_label: str
    event_type: str
    category: str = "anthropogenic_transportation"
    hazard_classification: str = "low"
    start_seconds: float = 0.0
    end_seconds: float = 0.0
    confidence_score: float = 0.0
    window_scores: List[float] = field(default_factory=list)
    model_version: str = "3.0.0"
    review_status: str = "pending"
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    is_closed: bool = False


class DisturbanceRadarService:
    """Detects, filters, and temporally merges non-animal environmental acoustic disturbances."""

    def __init__(
        self,
        merge_tolerance_seconds: float = 3.5,
        cooccurrence_evaluator: Optional[Any] = None,
    ) -> None:
        self.merge_tolerance_seconds = merge_tolerance_seconds
        self._cooccurrence_evaluator = cooccurrence_evaluator
        # session_id -> class_label -> ActiveDisturbance
        self._active_disturbances: Dict[str, Dict[str, ActiveDisturbance]] = {}
        self._lock = asyncio.Lock()

    def set_cooccurrence_evaluator(self, evaluator: Any) -> None:
        self._cooccurrence_evaluator = evaluator

    @staticmethod
    def is_supported(class_label: str) -> bool:
        """Check whether a sound class is in the verified BirdNET V3.0 non-animal taxonomy."""
        return class_label in BIRDNET_V3_DISTURBANCE_CLASSES

    @staticmethod
    def get_taxonomy() -> Dict[str, Any]:
        """Return the complete verified disturbance taxonomy with thresholds, categories, and descriptions."""
        categories = [
            "anthropogenic_transportation",
            "potential_environmental_hazard",
            "mechanical_activity",
            "cultural_sound",
        ]
        return {
            "model_version": "3.0.0",
            "supported_classes_count": len(BIRDNET_V3_DISTURBANCE_CLASSES),
            "categories": categories,
            "classes": BIRDNET_V3_DISTURBANCE_CLASSES,
            "scientific_note": (
                "Taxonomy strictly verified against BirdNET+ V3.0 model weights (11,725 classes). "
                "Raw model confidence scores are uncalibrated classifier outputs, not true posterior probabilities. "
                "Sound classes are scientifically partitioned into anthropogenic transportation, "
                "potential environmental hazards, mechanical activities, and cultural sounds. "
                "Classes not in the model metadata (e.g. drone, jackhammer) are explicitly unsupported."
            ),
        }

    async def process_window_detections(
        self,
        session_id: str,
        window_start: float,
        window_end: float,
        detections: List[Any],
        broadcast_cb: Optional[BroadcastCallback] = None,
    ) -> List[Dict[str, Any]]:
        """Extract disturbance candidates, merge contiguous events, persist to DB, and emit events."""
        async with self._lock:
            if session_id not in self._active_disturbances:
                self._active_disturbances[session_id] = {}

            active_map = self._active_disturbances[session_id]
            emitted_events: List[Dict[str, Any]] = []

            # 1. Filter detections for supported disturbance classes above threshold
            valid_disturbances: List[Tuple[str, str, str, str, float, float, float]] = []
            for det in detections:
                label = getattr(det, "class_label", None) or getattr(det, "species_name", None)
                if not label or label not in BIRDNET_V3_DISTURBANCE_CLASSES:
                    continue

                score = float(getattr(det, "confidence_score", getattr(det, "confidence", 0.0)))
                if not np.isfinite(score):
                    continue

                tax_info = BIRDNET_V3_DISTURBANCE_CLASSES[label]
                threshold = tax_info["default_threshold"]
                if score < threshold:
                    continue

                det_start = round(window_start + float(getattr(det, "start_seconds", getattr(det, "start_time", 0.0))), 3)
                det_end = round(window_start + float(getattr(det, "end_seconds", getattr(det, "end_time", 3.0))), 3)

                valid_disturbances.append(
                    (label, tax_info["event_type"], tax_info["category"], tax_info["hazard_classification"], det_start, det_end, score)
                )

            # 2. Check for expired active events in this session
            expired_labels = []
            for label, active in active_map.items():
                if active.is_closed:
                    expired_labels.append(label)
                    continue
                # If window has moved significantly past the active event without a new hit
                if window_start > active.end_seconds + self.merge_tolerance_seconds:
                    active.is_closed = True
                    expired_labels.append(label)
                    logger.debug(
                        "Disturbance event %s (%s) closed at %.1fs for session %s",
                        active.event_id,
                        label,
                        active.end_seconds,
                        session_id,
                    )
                    # Trigger co-occurrence evaluation on closed event
                    if self._cooccurrence_evaluator:
                        asyncio.create_task(
                            self._cooccurrence_evaluator.evaluate_event(
                                session_id=session_id,
                                disturbance=active,
                                broadcast_cb=broadcast_cb,
                            )
                        )

            for label in expired_labels:
                active_map.pop(label, None)

            # 3. Process each valid disturbance candidate
            for label, event_type, category, hazard_classification, d_start, d_end, score in valid_disturbances:
                active = active_map.get(label)

                # Check if contiguous / overlapping within tolerance
                if active and not active.is_closed and (d_start <= active.end_seconds + self.merge_tolerance_seconds):
                    # MERGE into active event
                    active.end_seconds = max(active.end_seconds, d_end)
                    active.confidence_score = max(active.confidence_score, score)
                    active.window_scores.append(score)

                    # Update database row
                    await self._update_disturbance_in_db(active)

                    ws_event = {
                        "type": "disturbance_updated",
                        "session_id": session_id,
                        "event_id": active.event_id,
                        "event_type": active.event_type,
                        "category": active.category,
                        "hazard_classification": active.hazard_classification,
                        "class_label": active.class_label,
                        "start_seconds": active.start_seconds,
                        "end_seconds": active.end_seconds,
                        "confidence_score": round(active.confidence_score, 4),
                        "model_version": active.model_version,
                        "review_status": active.review_status,
                    }
                    emitted_events.append(ws_event)
                    if broadcast_cb:
                        await broadcast_cb(ws_event)

                else:
                    # NEW disturbance event
                    event_id = str(uuid.uuid4())
                    new_active = ActiveDisturbance(
                        event_id=event_id,
                        session_id=session_id,
                        class_label=label,
                        event_type=event_type,
                        category=category,
                        hazard_classification=hazard_classification,
                        start_seconds=d_start,
                        end_seconds=d_end,
                        confidence_score=score,
                        window_scores=[score],
                    )
                    active_map[label] = new_active

                    # Insert into database
                    await self._insert_disturbance_in_db(new_active)

                    ws_event = {
                        "type": "disturbance_detected",
                        "session_id": session_id,
                        "event_id": event_id,
                        "event_type": event_type,
                        "category": category,
                        "hazard_classification": hazard_classification,
                        "class_label": label,
                        "start_seconds": d_start,
                        "end_seconds": d_end,
                        "confidence_score": round(score, 4),
                        "model_version": "3.0.0",
                        "review_status": "pending",
                    }
                    emitted_events.append(ws_event)
                    if broadcast_cb:
                        await broadcast_cb(ws_event)

            return emitted_events

    async def close_session_disturbances(
        self,
        session_id: str,
        broadcast_cb: Optional[BroadcastCallback] = None,
    ) -> None:
        """Close all remaining active disturbances for a session and run co-occurrence evaluation."""
        async with self._lock:
            active_map = self._active_disturbances.pop(session_id, {})
            for label, active in active_map.items():
                active.is_closed = True
                if self._cooccurrence_evaluator:
                    await self._cooccurrence_evaluator.evaluate_event(
                        session_id=session_id,
                        disturbance=active,
                        broadcast_cb=broadcast_cb,
                    )

    async def _insert_disturbance_in_db(self, active: ActiveDisturbance) -> None:
        try:
            async with async_session_factory() as session:
                db_event = DisturbanceEvent(
                    id=active.event_id,
                    session_id=active.session_id,
                    class_label=active.class_label,
                    event_type=active.event_type,
                    category=active.category,
                    hazard_classification=active.hazard_classification,
                    start_seconds=active.start_seconds,
                    end_seconds=active.end_seconds,
                    confidence_score=active.confidence_score,
                    model_version=active.model_version,
                    review_status=active.review_status,
                )
                session.add(db_event)
                await session.commit()
        except Exception as exc:
            logger.error("Failed to insert DisturbanceEvent %s: %s", active.event_id, exc)

    async def _update_disturbance_in_db(self, active: ActiveDisturbance) -> None:
        try:
            async with async_session_factory() as session:
                await session.execute(
                    update(DisturbanceEvent)
                    .where(DisturbanceEvent.id == active.event_id)
                    .values(
                        end_seconds=active.end_seconds,
                        confidence_score=active.confidence_score,
                    )
                )
                await session.commit()
        except Exception as exc:
            logger.error("Failed to update DisturbanceEvent %s: %s", active.event_id, exc)


disturbance_service = DisturbanceRadarService()

from app.services.soundscape.cooccurrence_service import cooccurrence_service

disturbance_service.set_cooccurrence_evaluator(cooccurrence_service)
