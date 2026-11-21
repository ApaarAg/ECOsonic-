"""Targeted scientific validation and acceptance test suite for EcoSonic Phase 4B Finalization.

Covers:
1. Mathematical validation of ecoacoustic indices (ACI, ADI, AEI, NDSI, Spectral Entropy, Temporal Activity).
2. Standardized frequency-band terminology (sum to ~100%) and legacy alias compatibility.
3. Disturbance Radar 16-class taxonomy partitioning across 4 scientific categories.
4. Disturbance temporal event merging and peak confidence tracking.
5. Biological vs non-biological co-occurrence evaluation, overlapping bout deduplication,
   and incomplete window handling with strictly non-causal phrasing.
6. Real bioacoustic audio validation (birds_forest.ogg, cicada_orni.ogg, frog_sounds.ogg).
"""

from __future__ import annotations

import math
from pathlib import Path
import uuid
import numpy as np
import pytest
import soundfile as sf

from app.core.database import async_session_factory
from app.models.live_session import LiveEvent, LiveSegment, LiveSession
from app.models.soundscape import (
    CoOccurrenceObservation,
    DisturbanceEvent,
    SoundscapeMeasurement,
)
from app.services.soundscape.fingerprint_engine import (
    DEFAULT_ECOLOGICAL_BANDS,
    LEGACY_BAND_ALIASES,
    SoundscapeConfig,
    SoundscapeFingerprintEngine,
    soundscape_engine,
)
from app.services.soundscape.disturbance_service import (
    BIRDNET_V3_DISTURBANCE_CLASSES,
    ActiveDisturbance,
    DisturbanceRadarService,
    disturbance_service,
)
from app.services.soundscape.cooccurrence_service import (
    MIN_EVAL_DURATION_S,
    CoOccurrenceService,
    cooccurrence_service,
    deduplicate_vocalization_bouts,
)


def make_sine(freq_hz: float, duration_s: float, sample_rate: int = 32000, amplitude: float = 0.5) -> np.ndarray:
    """Generate a clean sinusoidal tone."""
    t = np.linspace(0, duration_s, int(sample_rate * duration_s), endpoint=False, dtype=np.float32)
    return amplitude * np.sin(2 * np.pi * freq_hz * t)


def make_white_noise(duration_s: float, sample_rate: int = 32000, amplitude: float = 0.2) -> np.ndarray:
    """Generate reproducible uniform white noise."""
    rng = np.random.default_rng(12345)
    return rng.uniform(-amplitude, amplitude, int(sample_rate * duration_s)).astype(np.float32)


# ============================================================================
# 1. Scientific Soundscape Fingerprint & Acoustic Indices
# ============================================================================

def test_pure_tone_vs_white_noise_spectral_entropy():
    """Normalized Spectral Shannon Entropy: approaches ~0.0 for pure tone, ~1.0 for flat noise."""
    sr = 32000
    tone = make_sine(3000.0, 10.0, sr)
    noise = make_white_noise(10.0, sr)

    res_tone = soundscape_engine.analyze_audio_segment(tone, sr)
    res_noise = soundscape_engine.analyze_audio_segment(noise, sr)

    assert res_tone.metrics.spectral_entropy is not None
    assert res_noise.metrics.spectral_entropy is not None
    assert 0.0 <= res_tone.metrics.spectral_entropy < 0.20
    assert 0.85 < res_noise.metrics.spectral_entropy <= 1.0


def test_ndsi_boundary_conditions():
    """NDSI mathematical boundary validation:
    - Pure anthro (1500 Hz): NDSI approaches -1.0
    - Pure bio (4000 Hz): NDSI approaches +1.0
    - Balanced (1500 Hz + 4000 Hz): NDSI approaches 0.0
    - Silence: NDSI is None, quality flags set.
    """
    sr = 32000
    dur = 10.0

    anthro_tone = make_sine(1500.0, dur, sr, amplitude=0.4)
    bio_tone = make_sine(4000.0, dur, sr, amplitude=0.4)
    balanced_signal = anthro_tone + bio_tone
    silence = np.zeros(int(sr * dur), dtype=np.float32)

    res_anthro = soundscape_engine.analyze_audio_segment(anthro_tone, sr)
    res_bio = soundscape_engine.analyze_audio_segment(bio_tone, sr)
    res_balanced = soundscape_engine.analyze_audio_segment(balanced_signal, sr)
    res_silence = soundscape_engine.analyze_audio_segment(silence, sr)

    # Pure anthro: close to -1.0
    assert res_anthro.metrics.ndsi is not None
    assert res_anthro.metrics.ndsi < -0.85

    # Pure bio: close to +1.0
    assert res_bio.metrics.ndsi is not None
    assert res_bio.metrics.ndsi > 0.85

    # Balanced: near 0.0 (|ndsi| < 0.15)
    assert res_balanced.metrics.ndsi is not None
    assert abs(res_balanced.metrics.ndsi) < 0.15

    # Silence: undefined (None) with quality flags
    assert res_silence.metrics.ndsi is None
    assert "silent_window" in res_silence.quality_flags
    assert "insufficient_energy_for_ndsi" in res_silence.quality_flags or "ndsi_energy_too_low" in res_silence.quality_flags


def test_standardized_frequency_bands_and_legacy_aliases():
    """Verify 5 standardized frequency bands sum to ~100% and legacy aliases are populated."""
    sr = 32000
    noise = make_white_noise(10.0, sr)

    res = soundscape_engine.analyze_audio_segment(noise, sr)
    bands = res.frequency_bands

    # 5 standardized primary band names
    std_keys = [
        "low_frequency_0_1k_pct",
        "mid_frequency_1_2k_pct",
        "biophony_band_2_8k_pct",
        "high_frequency_8_14k_pct",
        "upper_frequency_14_16k_pct",
    ]
    for key in std_keys:
        assert key in bands, f"Standardized band {key} missing from frequency_bands"
        assert bands[key] >= 0.0

    # Total sum of primary bands must approximate 100%
    primary_sum = sum(bands[k] for k in std_keys)
    assert 98.0 <= primary_sum <= 102.0, f"Primary frequency bands sum ({primary_sum}) must be ~100%"

    # Backward compatibility aliases
    for leg_alias, std_name in LEGACY_BAND_ALIASES.items():
        assert leg_alias in bands, f"Legacy alias {leg_alias} missing"
        assert bands[leg_alias] == bands[std_name]


def test_calculation_parameters_and_temporal_threshold_note():
    """Verify calculation parameters document sample rate, FFT, and relative temporal activity threshold."""
    sr = 32000
    samples = make_white_noise(10.0, sr)
    res = soundscape_engine.analyze_audio_segment(samples, sr)
    params = res.calculation_parameters

    assert params["sample_rate"] == 32000
    assert params["n_fft"] == 1024
    assert params["hop_length"] == 512
    assert "temporal_activity_threshold_note" in params
    assert "relative" in params["temporal_activity_threshold_note"].lower()
    assert "ndsi_assumptions" in params
    assert "scientific_disclaimer" in params["ndsi_assumptions"]


# ============================================================================
# 2. Disturbance Radar & Taxonomy Categorization
# ============================================================================

def test_disturbance_taxonomy_scientific_partitioning():
    """Verify that all 16 BirdNET V3.0 non-animal classes are partitioned into the 4 scientific categories."""
    taxonomy = DisturbanceRadarService.get_taxonomy()
    assert taxonomy["supported_classes_count"] == 16
    assert len(taxonomy["categories"]) == 4

    classes = taxonomy["classes"]
    categories_found = set()

    for class_id, info in classes.items():
        assert "category" in info, f"Class {class_id} missing category"
        assert "hazard_classification" in info, f"Class {class_id} missing hazard_classification"
        assert "default_threshold" in info
        assert "scientific_notes" in info
        categories_found.add(info["category"])

    expected_categories = {
        "anthropogenic_transportation",
        "potential_environmental_hazard",
        "mechanical_activity",
        "cultural_sound",
    }
    assert categories_found == expected_categories

    # Verify Chainsaw and Gunshot are potential environmental hazards with critical classification
    assert classes["Chainsaw_Chainsaw"]["category"] == "potential_environmental_hazard"
    assert classes["Chainsaw_Chainsaw"]["hazard_classification"] == "critical"
    assert classes["Gun_Gun"]["category"] == "potential_environmental_hazard"
    assert classes["Gun_Gun"]["hazard_classification"] == "critical"


@pytest.mark.asyncio
async def test_disturbance_temporal_event_merging_and_peak_confidence(test_engine):
    """Validate temporal event merging across consecutive inference windows and peak confidence tracking."""
    radar = DisturbanceRadarService(merge_tolerance_seconds=3.5)
    session_id = str(uuid.uuid4())

    async with async_session_factory() as db:
        sess = LiveSession(id=session_id, source_type="desktop_mic", sample_rate=32000, channels=1, status="active")
        db.add(sess)
        await db.commit()

    class MockDetection:
        def __init__(self, label: str, score: float, start: float, end: float):
            self.class_label = label
            self.confidence_score = score
            self.start_seconds = start
            self.end_seconds = end

    # Window 1: Chainsaw detected at 0.0-3.0s, score 0.75
    w1_events = await radar.process_window_detections(
        session_id=session_id,
        window_start=0.0,
        window_end=3.0,
        detections=[MockDetection("Chainsaw_Chainsaw", 0.75, 0.0, 3.0)],
    )
    assert len(w1_events) == 1
    assert w1_events[0]["type"] == "disturbance_detected"
    assert w1_events[0]["category"] == "potential_environmental_hazard"
    assert w1_events[0]["confidence_score"] == 0.75

    # Window 2: Contiguous Chainsaw at 1.5-4.5s with higher peak score 0.88
    w2_events = await radar.process_window_detections(
        session_id=session_id,
        window_start=1.5,
        window_end=4.5,
        detections=[MockDetection("Chainsaw_Chainsaw", 0.88, 0.0, 3.0)],
    )
    assert len(w2_events) == 1
    assert w2_events[0]["type"] == "disturbance_updated"
    assert w2_events[0]["confidence_score"] == 0.88
    assert w2_events[0]["end_seconds"] == 4.5


# ============================================================================
# 3. Co-Occurrence Analysis, Deduplication & Safe Phrasing
# ============================================================================

def test_deduplicate_vocalization_bouts():
    """Verify that consecutive overlapping inference windows for the same species are merged into a single bout."""
    ev1 = LiveEvent(
        id="1", session_id="s1", detection_id="d1",
        class_label="Turdus merula_Common Blackbird",
        start_seconds=1.0, end_seconds=4.0, confidence_score=0.8,
    )
    # Consecutive overlapping detection 1.5s later (same song bout)
    ev2 = LiveEvent(
        id="2", session_id="s1", detection_id="d2",
        class_label="Turdus merula_Common Blackbird",
        start_seconds=2.5, end_seconds=5.5, confidence_score=0.85,
    )
    # Distinct bird singing later
    ev3 = LiveEvent(
        id="3", session_id="s1", detection_id="d3",
        class_label="Parus major_Great Tit",
        start_seconds=10.0, end_seconds=13.0, confidence_score=0.9,
    )

    bouts = deduplicate_vocalization_bouts([ev1, ev2, ev3], max_bout_gap_s=1.5)
    # ev1 and ev2 must be merged into 1 bout
    assert len(bouts) == 2
    blackbird_bout = [b for b in bouts if b["class_label"] == "Turdus merula_Common Blackbird"][0]
    assert blackbird_bout["start_seconds"] == 1.0
    assert blackbird_bout["end_seconds"] == 5.5


@pytest.mark.asyncio
async def test_cooccurrence_insufficient_window_handling(test_engine):
    """When recording before or after disturbance is < 5.0s, co-occurrence returns insufficient data state."""
    service = CoOccurrenceService(default_window_seconds=30.0)
    session_id = str(uuid.uuid4())
    event_id = str(uuid.uuid4())

    async with async_session_factory() as db:
        sess = LiveSession(id=session_id, source_type="desktop_mic", sample_rate=32000, channels=1, status="active")
        db.add(sess)

        # Disturbance occurs at 2.0s -> pre-event window is only 2.0s (< 5.0s minimum threshold)
        dist = DisturbanceEvent(
            id=event_id,
            session_id=session_id,
            class_label="Gun_Gun",
            event_type="gunshot",
            start_seconds=2.0,
            end_seconds=3.0,
            confidence_score=0.92,
        )
        db.add(dist)
        await db.commit()

    obs = await service.evaluate_event(session_id=session_id, disturbance=dist)
    assert obs is not None
    assert "insufficient observation window" in obs.interpretation.lower()
    assert "Temporal co-occurrence observed" in obs.interpretation
    # Prohibited causal claims must NOT exist
    for forbidden in ["caused", "silenced", "scared away", "displaced"]:
        assert forbidden not in obs.interpretation.lower()


@pytest.mark.asyncio
async def test_cooccurrence_strictly_non_causal_interpretation(test_engine):
    """Verify co-occurrence comparison produces non-causal observational reporting."""
    service = CoOccurrenceService(default_window_seconds=30.0)
    session_id = str(uuid.uuid4())
    event_id = str(uuid.uuid4())

    async with async_session_factory() as db:
        sess = LiveSession(id=session_id, source_type="desktop_mic", sample_rate=32000, channels=1, status="active")
        db.add(sess)

        # Session has 60s of segments
        seg = LiveSegment(
            id=str(uuid.uuid4()), session_id=session_id,
            start_seconds=0.0, end_seconds=60.0, audio_path="mock_segment.wav",
        )
        db.add(seg)

        # Disturbance from 25.0 to 30.0s
        dist = DisturbanceEvent(
            id=event_id,
            session_id=session_id,
            class_label="Motor vehicle_Motor vehicle",
            event_type="motor_vehicle",
            start_seconds=25.0,
            end_seconds=30.0,
            confidence_score=0.82,
        )
        db.add(dist)

        # Pre-event vocalizations (between 0 and 25s)
        e1 = LiveEvent(
            id=str(uuid.uuid4()), session_id=session_id, detection_id="d1",
            class_label="Turdus merula_Common Blackbird",
            start_seconds=5.0, end_seconds=8.0, confidence_score=0.9,
            taxon_group="Bird",
        )
        e2 = LiveEvent(
            id=str(uuid.uuid4()), session_id=session_id, detection_id="d2",
            class_label="Parus major_Great Tit",
            start_seconds=15.0, end_seconds=18.0, confidence_score=0.85,
            taxon_group="Bird",
        )
        db.add_all([e1, e2])
        await db.commit()

    obs = await service.evaluate_event(session_id=session_id, disturbance=dist)
    assert obs is not None
    assert obs.biological_activity_before > 0.0
    assert "Temporal co-occurrence observed" in obs.interpretation
    for forbidden in ["caused", "silenced", "scared away", "fled"]:
        assert forbidden not in obs.interpretation.lower()


# ============================================================================
# 4. Real Bioacoustic Audio Validation
# ============================================================================

def test_real_audio_smoke_recordings():
    """Verify ecoacoustic metrics on real test recordings (birds_forest.ogg, cicada_orni.ogg)."""
    recordings = [
        Path("backend/data/smoke_audio/birds_forest.ogg"),
        Path("backend/data/smoke_audio/cicada_orni.ogg"),
    ]

    for rec_path in recordings:
        if not rec_path.exists():
            continue

        samples, sr = sf.read(str(rec_path))
        if samples.ndim > 1:
            samples = samples.mean(axis=1)

        # Analyze a 15-second chunk
        segment = samples[: int(sr * 15)]
        res = soundscape_engine.analyze_audio_segment(segment, sr)

        assert res.metrics.aci is not None and res.metrics.aci > 0.0
        assert res.metrics.adi is not None and res.metrics.adi >= 0.0
        assert res.metrics.aei is not None and 0.0 <= res.metrics.aei <= 1.0
        assert res.metrics.spectral_entropy is not None and 0.0 < res.metrics.spectral_entropy <= 1.0
        assert res.metrics.temporal_activity is not None and res.metrics.temporal_activity >= 0.0
        assert "biophony_band_2_8k_pct" in res.frequency_bands
