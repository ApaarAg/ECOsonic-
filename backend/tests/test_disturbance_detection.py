"""Unit tests for Disturbance Radar detection, thresholding, and temporal event merging."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import pytest

from app.services.soundscape.disturbance_service import (
    BIRDNET_V3_DISTURBANCE_CLASSES,
    DisturbanceRadarService,
)


@dataclass
class MockDetection:
    class_label: str
    confidence_score: float
    start_seconds: float
    end_seconds: float


@pytest.mark.asyncio
async def test_verified_taxonomy_completeness():
    """Disturbance taxonomy must contain exactly the 16 verified BirdNET V3.0 non-animal classes."""
    taxonomy = DisturbanceRadarService.get_taxonomy()
    assert taxonomy["supported_classes_count"] == 16
    assert "Chainsaw_Chainsaw" in taxonomy["classes"]
    assert "Gun_Gun" in taxonomy["classes"]
    assert "Engine_Engine" in taxonomy["classes"]
    assert "Siren_Siren" in taxonomy["classes"]
    assert "Aircraft_Aircraft" in taxonomy["classes"]

    # Unsupported / synthetic classes must NOT be present
    assert not DisturbanceRadarService.is_supported("Drone_Drone")
    assert not DisturbanceRadarService.is_supported("Jackhammer_Jackhammer")


@pytest.mark.asyncio
async def test_confidence_thresholding():
    """Detections below class threshold must be rejected by disturbance radar."""
    service = DisturbanceRadarService(merge_tolerance_seconds=3.5)
    session_id = "test-thresh-sess"

    # Engine threshold is 0.20. Detection with score 0.12 should be rejected.
    below_thresh = [
        MockDetection(class_label="Engine_Engine", confidence_score=0.12, start_seconds=0.0, end_seconds=3.0)
    ]
    emitted = await service.process_window_detections(
        session_id=session_id, window_start=0.0, window_end=3.0, detections=below_thresh
    )
    assert len(emitted) == 0

    # Detection with score 0.75 should be accepted
    above_thresh = [
        MockDetection(class_label="Engine_Engine", confidence_score=0.75, start_seconds=0.0, end_seconds=3.0)
    ]
    emitted = await service.process_window_detections(
        session_id=session_id, window_start=0.0, window_end=3.0, detections=above_thresh
    )
    assert len(emitted) == 1
    assert emitted[0]["type"] == "disturbance_detected"
    assert emitted[0]["class_label"] == "Engine_Engine"
    assert emitted[0]["confidence_score"] == 0.75


@pytest.mark.asyncio
async def test_contiguous_event_merging():
    """Contiguous or overlapping detections of the same disturbance class must merge into a single event."""
    service = DisturbanceRadarService(merge_tolerance_seconds=3.5)
    session_id = "test-merge-sess"

    # Window 1: Engine at [0.0 - 3.0s], score 0.60
    w1 = [MockDetection(class_label="Engine_Engine", confidence_score=0.60, start_seconds=0.0, end_seconds=3.0)]
    emitted_1 = await service.process_window_detections(session_id, 0.0, 3.0, w1)
    assert len(emitted_1) == 1
    assert emitted_1[0]["type"] == "disturbance_detected"
    event_id = emitted_1[0]["event_id"]
    assert emitted_1[0]["start_seconds"] == 0.0
    assert emitted_1[0]["end_seconds"] == 3.0

    # Window 2: Engine at [3.0 - 6.0s], score 0.82 (contiguous)
    w2 = [MockDetection(class_label="Engine_Engine", confidence_score=0.82, start_seconds=0.0, end_seconds=3.0)]
    emitted_2 = await service.process_window_detections(session_id, 3.0, 6.0, w2)
    assert len(emitted_2) == 1
    # Must be merged: disturbance_updated with SAME event_id
    assert emitted_2[0]["type"] == "disturbance_updated"
    assert emitted_2[0]["event_id"] == event_id
    assert emitted_2[0]["start_seconds"] == 0.0
    assert emitted_2[0]["end_seconds"] == 6.0
    assert emitted_2[0]["confidence_score"] == 0.82

    # Window 3: Engine at [6.0 - 9.0s], score 0.70
    w3 = [MockDetection(class_label="Engine_Engine", confidence_score=0.70, start_seconds=0.0, end_seconds=3.0)]
    emitted_3 = await service.process_window_detections(session_id, 6.0, 9.0, w3)
    assert len(emitted_3) == 1
    assert emitted_3[0]["type"] == "disturbance_updated"
    assert emitted_3[0]["event_id"] == event_id
    assert emitted_3[0]["start_seconds"] == 0.0
    assert emitted_3[0]["end_seconds"] == 9.0


@pytest.mark.asyncio
async def test_distinct_non_contiguous_events():
    """Detections separated by more than merge_tolerance_seconds must create separate events."""
    service = DisturbanceRadarService(merge_tolerance_seconds=3.5)
    session_id = "test-distinct-sess"

    # Event 1 at [0.0 - 3.0s]
    w1 = [MockDetection(class_label="Siren_Siren", confidence_score=0.70, start_seconds=0.0, end_seconds=3.0)]
    e1 = await service.process_window_detections(session_id, 0.0, 3.0, w1)
    assert len(e1) == 1
    assert e1[0]["type"] == "disturbance_detected"
    first_id = e1[0]["event_id"]

    # Long silence between 3.0s and 30.0s (expiry check)
    empty = await service.process_window_detections(session_id, 15.0, 18.0, [])
    assert len(empty) == 0

    # Event 2 at [30.0 - 33.0s]
    w2 = [MockDetection(class_label="Siren_Siren", confidence_score=0.85, start_seconds=0.0, end_seconds=3.0)]
    e2 = await service.process_window_detections(session_id, 30.0, 33.0, w2)
    assert len(e2) == 1
    assert e2[0]["type"] == "disturbance_detected"
    assert e2[0]["event_id"] != first_id
    assert e2[0]["start_seconds"] == 30.0
    assert e2[0]["end_seconds"] == 33.0


@pytest.mark.asyncio
async def test_multiple_simultaneous_disturbance_classes():
    """Different disturbance classes occurring simultaneously must be tracked independently."""
    service = DisturbanceRadarService(merge_tolerance_seconds=3.5)
    session_id = "test-multi-dist-sess"

    detections = [
        MockDetection(class_label="Chainsaw_Chainsaw", confidence_score=0.78, start_seconds=0.0, end_seconds=3.0),
        MockDetection(class_label="Motor vehicle_Motor vehicle", confidence_score=0.65, start_seconds=0.0, end_seconds=3.0),
    ]

    emitted = await service.process_window_detections(session_id, 0.0, 3.0, detections)
    assert len(emitted) == 2
    types = {e["class_label"] for e in emitted}
    assert "Chainsaw_Chainsaw" in types
    assert "Motor vehicle_Motor vehicle" in types
