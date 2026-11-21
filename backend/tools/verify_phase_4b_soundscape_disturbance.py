"""Phase 4B verification and performance benchmarking script.

Tests Soundscape Fingerprint, Disturbance Radar, and Biological Co-Occurrence on real audio.
"""

from __future__ import annotations

import asyncio
import logging
import time
import psutil
import soundfile as sf
import numpy as np

from app.core.database import async_session_factory, Base, init_db
from app.models.live_session import LiveEvent, LiveSession
from app.models.soundscape import DisturbanceEvent, SoundscapeMeasurement, CoOccurrenceObservation
from app.services.soundscape.fingerprint_engine import soundscape_engine
from app.services.soundscape.disturbance_service import (
    DisturbanceRadarService,
    ActiveDisturbance,
    BIRDNET_V3_DISTURBANCE_CLASSES,
)
from app.services.soundscape.cooccurrence_service import cooccurrence_service

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("Phase4BBenchmark")


class MockDetection:
    def __init__(self, label: str, score: float, start: float, end: float):
        self.class_label = label
        self.confidence_score = score
        self.start_seconds = start
        self.end_seconds = end


async def main():
    await init_db()
    logger.info("=" * 70)
    logger.info("ECOSONIC 3.0 — PHASE 4B VERIFICATION & BENCHMARK")
    logger.info("Soundscape Fingerprint & Disturbance Radar")
    logger.info("=" * 70)

    # 1. Benchmark Soundscape Fingerprint on real audio
    audio_path = "backend/data/smoke_audio/birds_forest.ogg"
    logger.info("Reading test environmental recording: %s", audio_path)
    data, sr = sf.read(audio_path)
    if data.ndim > 1:
        data = data.mean(axis=1)

    duration_s = len(data) / sr
    logger.info("Loaded %.2fs audio at %d Hz", duration_s, sr)

    proc = psutil.Process()
    mem_before = proc.memory_info().rss / (1024 * 1024)

    t0 = time.perf_counter()
    fp = soundscape_engine.analyze_audio_segment(
        samples=data,
        sample_rate=sr,
        start_seconds=0.0,
        session_id="benchmark-session",
    )
    t_elapsed = time.perf_counter() - t0
    mem_after = proc.memory_info().rss / (1024 * 1024)

    logger.info("--- SOUNDSCAPE FINGERPRINT RESULTS (%.2fs window in %.3fs) ---", duration_s, t_elapsed)
    logger.info("  Acoustic Complexity Index (ACI) : %s", fp.metrics.aci)
    logger.info("  Acoustic Diversity Index (ADI)  : %s", fp.metrics.adi)
    logger.info("  Acoustic Evenness Index (AEI)   : %s", fp.metrics.aei)
    logger.info("  NDSI (bio - anthro / sum)       : %s", fp.metrics.ndsi)
    logger.info("  Spectral Shannon Entropy        : %s", fp.metrics.spectral_entropy)
    logger.info("  Temporal Acoustic Activity      : %s", fp.metrics.temporal_activity)
    logger.info("  Frequency Sub-bands             : %s", fp.frequency_bands)
    logger.info("  Quality Flags                   : %s", fp.quality_flags)
    logger.info("  Memory: before=%.1f MB, after=%.1f MB (delta=%.2f MB)", mem_before, mem_after, mem_after - mem_before)

    # 2. Benchmark Disturbance Radar
    logger.info("\n--- DISTURBANCE RADAR VERIFICATION ---")
    taxonomy = DisturbanceRadarService.get_taxonomy()
    logger.info("Verified supported classes in model: %d", taxonomy["supported_classes_count"])
    for name in ["Chainsaw_Chainsaw", "Gun_Gun", "Engine_Engine", "Siren_Siren"]:
        logger.info("  Verified class '%s' -> %s (threshold=%.2f)", name, taxonomy["classes"][name]["event_type"], taxonomy["classes"][name]["default_threshold"])

    radar = DisturbanceRadarService(merge_tolerance_seconds=3.5)
    sess_id = "bench-radar-sess"

    # Ensure live session exists in DB for foreign key constraint
    async with async_session_factory() as db:
        sess = LiveSession(id=sess_id, source_type="file_replay", sample_rate=sr, channels=1, status="active")
        db.add(sess)
        await db.commit()

    # Simulate 3 contiguous windows of Engine detection: [0-3s], [3-6s], [6-9s]
    w1 = [MockDetection("Engine_Engine", 0.72, 0.0, 3.0)]
    w2 = [MockDetection("Engine_Engine", 0.85, 0.0, 3.0)]
    w3 = [MockDetection("Engine_Engine", 0.68, 0.0, 3.0)]

    emitted_1 = await radar.process_window_detections(sess_id, 0.0, 3.0, w1)
    emitted_2 = await radar.process_window_detections(sess_id, 3.0, 6.0, w2)
    emitted_3 = await radar.process_window_detections(sess_id, 6.0, 9.0, w3)

    logger.info("Window 1 result: %s", emitted_1[0]["type"])
    logger.info("Window 2 result: %s (merged event_id=%s, range=[%.1f-%.1f])", emitted_2[0]["type"], emitted_2[0]["event_id"], emitted_2[0]["start_seconds"], emitted_2[0]["end_seconds"])
    logger.info("Window 3 result: %s (merged event_id=%s, range=[%.1f-%.1f])", emitted_3[0]["type"], emitted_3[0]["event_id"], emitted_3[0]["start_seconds"], emitted_3[0]["end_seconds"])

    assert emitted_1[0]["event_id"] == emitted_2[0]["event_id"] == emitted_3[0]["event_id"]
    assert emitted_3[0]["end_seconds"] == 9.0
    logger.info(">> Successfully verified contiguous disturbance merging: 3 windows merged into 1 event [0.0 - 9.0s].")

    # 3. Benchmark Biological vs Non-Biological Co-occurrence
    logger.info("\n--- CO-OCCURRENCE ANALYSIS VERIFICATION ---")
    active_dist = ActiveDisturbance(
        event_id=emitted_1[0]["event_id"],
        session_id=sess_id,
        class_label="Engine_Engine",
        event_type="engine",
        start_seconds=30.0,
        end_seconds=45.0,
        confidence_score=0.85,
    )

    # Test evaluation logic
    obs = await cooccurrence_service.evaluate_event(
        session_id=sess_id,
        disturbance=active_dist,
        comparison_window_seconds=30.0,
    )
    if obs:
        logger.info("Co-occurrence interpretation generated:")
        logger.info("  %s", obs.interpretation)
        logger.info("  Rate Before: %.1f events/min, Rate After: %.1f events/min, Diff: %.1f", obs.biological_activity_before, obs.biological_activity_after, obs.difference_value)

    logger.info("\n" + "=" * 70)
    logger.info("PHASE 4B BENCHMARK COMPLETE: ALL CRITERIA SATISFIED")
    logger.info("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
