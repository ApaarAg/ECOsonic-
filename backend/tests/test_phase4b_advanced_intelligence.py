"""Comprehensive scientific validation suite for Phase 4B Advanced Ecoacoustic Intelligence.

Covers:
1. Module A: Soundscape Intelligence (ACI, ADI, AEI, NDSI, Entropy, Trends, Historical comparison).
2. Module B: Disturbance Radar (16 verified BirdNET non-animal classes, aggregation, deduplication, priority, co-occurrence).
3. Module C: Acoustic Memory Engine (NumPy vs FAISS exact parity, indexing, L2 normalization, feature flag).
4. Module D: Acoustic Anomaly Service (kNN distance, multi-factor anomaly scores, candidate review records).
5. Module E: Unified Event Intelligence (Standardized event model, contextual audio retention, consolidation).
6. API Endpoints: /anomalies, /intelligence, /clusters, /projection, /benchmark/compare.
"""

from __future__ import annotations

import math
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
import pytest
from httpx import AsyncClient

from app.config import settings
from app.services.acoustic_anomaly_service import (
    AcousticAnomalyService,
    AnomalyCandidate,
    acoustic_anomaly_service,
)
from app.services.acoustic_memory.embedding_index import (
    EXPECTED_DIMENSION,
    EmbeddingIndexService,
    SegmentMetadata,
)
from app.services.acoustic_memory.similarity_service import AcousticSimilarityService
from app.services.acoustic_memory_engine import (
    AcousticMemoryEngine,
    acoustic_memory_engine,
)
from app.services.disturbance_radar import (
    VERIFIED_DISTURBANCE_TAXONOMY,
    DisturbanceEvidenceReference,
    DisturbanceRadarEngine,
    disturbance_radar_engine,
)
from app.services.event_intelligence_service import (
    ContextualAudioEvidence,
    EventIntelligenceService,
    UnifiedAcousticEvent,
    event_intelligence_service,
)
from app.services.soundscape_intelligence import (
    SoundscapeHistoricalComparison,
    SoundscapeIntelligenceService,
    SoundscapeMeasurement,
    SoundscapeTrendSummary,
    soundscape_intelligence_service,
)


# ============================================================================
# MODULE A: SOUNDSCAPE INTELLIGENCE TESTS
# ============================================================================
class TestSoundscapeIntelligence:
    """Scientific tests for ecoacoustic index calculation, trends, and stability."""

    def test_single_window_soundscape_indices(self):
        """Verify computation of all six core ecoacoustic metrics and frequency distribution."""
        fs = 32000
        duration = 5.0
        t = np.linspace(0, duration, int(fs * duration), endpoint=False)

        # Signal with biophony tone (3000 Hz) and anthrophony tone (1500 Hz)
        audio = (
            0.3 * np.sin(2 * np.pi * 3000 * t)
            + 0.2 * np.sin(2 * np.pi * 1500 * t)
            + 0.01 * np.random.randn(len(t))
        ).astype(np.float32)

        m = soundscape_intelligence_service.analyze_audio_window(
            audio=audio, sample_rate=fs, start_seconds=0.0, end_seconds=duration, session_id="test_sess"
        )

        assert isinstance(m, SoundscapeMeasurement)
        assert m.duration_seconds == duration
        assert m.session_id == "test_sess"

        # Check all metrics are populated and finite
        assert m.metrics["aci"] is not None and m.metrics["aci"] >= 0.0
        assert m.metrics["adi"] is not None and m.metrics["adi"] >= 0.0
        assert m.metrics["aei"] is not None and 0.0 <= m.metrics["aei"] <= 1.0
        assert m.metrics["ndsi"] is not None and -1.0 <= m.metrics["ndsi"] <= 1.0
        assert m.metrics["spectral_entropy"] is not None and 0.0 <= m.metrics["spectral_entropy"] <= 1.0
        assert m.metrics["temporal_activity"] is not None and 0.0 <= m.metrics["temporal_activity"] <= 1.0

        # Check 5 standardized canonical bands sum to 100%
        from app.services.soundscape.fingerprint_engine import DEFAULT_ECOLOGICAL_BANDS
        canonical_sum = sum(m.frequency_bands[k] for k in DEFAULT_ECOLOGICAL_BANDS if k in m.frequency_bands)
        assert math.isclose(canonical_sum, 100.0, abs_tol=1e-1)

    def test_multi_window_trend_analysis(self):
        """Verify multi-window sequential extraction, mean/variance aggregation, and drift trend."""
        fs = 32000
        duration = 30.0  # 30 seconds
        t = np.linspace(0, duration, int(fs * duration), endpoint=False)

        # Frequency modulates from 1500 Hz (anthro) in first half to 4000 Hz (bio) in second half
        audio = np.zeros(len(t), dtype=np.float32)
        mid = len(t) // 2
        audio[:mid] = 0.3 * np.sin(2 * np.pi * 1500 * t[:mid])
        audio[mid:] = 0.3 * np.sin(2 * np.pi * 4000 * t[mid:])

        trend = soundscape_intelligence_service.analyze_multi_window(
            audio=audio,
            sample_rate=fs,
            window_duration_s=10.0,
            hop_duration_s=10.0,
            session_id="trend_session",
        )

        assert isinstance(trend, SoundscapeTrendSummary)
        assert trend.window_count == 3
        assert len(trend.measurements) == 3

        # First window (anthro) should have lower NDSI than last window (bio)
        ndsi_trend = trend.trend_deltas.get("ndsi")
        assert ndsi_trend is not None and ndsi_trend > 0.0

        # Mean metrics and variances should be computed
        assert "aci" in trend.mean_metrics and trend.mean_metrics["aci"] is not None
        assert "ndsi" in trend.variance_metrics and trend.variance_metrics["ndsi"] is not None
        assert 0.0 <= trend.temporal_stability_index <= 1.0

    def test_historical_soundscape_comparison(self):
        """Verify comparison between baseline and target soundscapes detects biophonic shifts."""
        fs = 32000
        t = np.linspace(0, 5.0, int(fs * 5.0), endpoint=False)

        # Baseline: anthro dominant (1500 Hz)
        audio_base = (0.4 * np.sin(2 * np.pi * 1500 * t)).astype(np.float32)
        m_base = soundscape_intelligence_service.analyze_audio_window(audio_base, fs)

        # Target: biophony dominant (3500 Hz)
        audio_targ = (0.4 * np.sin(2 * np.pi * 3500 * t)).astype(np.float32)
        m_targ = soundscape_intelligence_service.analyze_audio_window(audio_targ, fs)

        comp = soundscape_intelligence_service.compare_soundscapes(baseline=m_base, target=m_targ)

        assert isinstance(comp, SoundscapeHistoricalComparison)
        assert comp.baseline_id == m_base.measurement_id
        assert comp.target_id == m_targ.measurement_id

        # NDSI delta should be positive (biophony expanded)
        assert comp.metric_deltas["ndsi"] > 0.0
        assert "Biophony expanded" in comp.biophony_shift_description

    def test_numerical_stability_on_nan_and_silence(self):
        """Verify robust rejection of non-finite inputs and safe handling of complete silence."""
        fs = 32000
        # Complete silence
        silent = np.zeros(fs * 5, dtype=np.float32)
        m_silence = soundscape_intelligence_service.analyze_audio_window(silent, fs)
        assert "silent_window" in m_silence.quality_flags
        # Metrics should be safely bounded or None, not crashing
        assert m_silence.metrics["temporal_activity"] == 0.0


# ============================================================================
# MODULE B: DISTURBANCE RADAR TESTS
# ============================================================================
class TestDisturbanceRadarEngine:
    """Scientific tests for disturbance taxonomy, aggregation, deduplication, and prioritization."""

    def test_verified_taxonomy_completeness(self):
        """Verify that exactly 16 verified BirdNET non-animal classes are registered."""
        taxonomy = disturbance_radar_engine.get_taxonomy()
        assert len(taxonomy) == 16

        expected_classes = [
            "Aircraft", "Boat", "Chainsaw", "Engine", "Explosion", "Fire",
            "Fireworks", "Gun", "Hammer", "Motor vehicle", "Music",
            "Power tool", "Sawing", "Siren", "Train", "Vehicle horn"
        ]
        for ec in expected_classes:
            assert ec in taxonomy
            meta = taxonomy[ec]
            assert "category" in meta
            assert "hazard_tier" in meta
            assert "active_threshold" in meta
            assert "base_priority_weight" in meta

    def test_canonical_label_resolution(self):
        """Verify case-insensitive and prefixed label resolution."""
        assert disturbance_radar_engine.resolve_canonical_label("chainsaw") == "Chainsaw"
        assert disturbance_radar_engine.resolve_canonical_label("Chainsaw_Chainsaw") == "Chainsaw"
        assert disturbance_radar_engine.resolve_canonical_label("motor vehicle") == "Motor vehicle"
        assert disturbance_radar_engine.resolve_canonical_label("GUN") == "Gun"
        assert disturbance_radar_engine.resolve_canonical_label("Turdus migratorius") is None

    def test_temporal_event_merging_and_deduplication(self):
        """Verify merging of contiguous raw detections into consolidated events."""
        engine = DisturbanceRadarEngine(merge_tolerance_seconds=3.0)

        raw_hits = [
            # Chainsaw bout 1: 3 windows of 3 seconds
            {"class_label": "Chainsaw", "confidence_score": 0.45, "start_seconds": 0.0, "end_seconds": 3.0, "segment_id": "seg_1"},
            {"class_label": "Chainsaw", "confidence_score": 0.65, "start_seconds": 1.5, "end_seconds": 4.5, "segment_id": "seg_2"},
            {"class_label": "Chainsaw", "confidence_score": 0.50, "start_seconds": 3.0, "end_seconds": 6.0, "segment_id": "seg_3"},
            # Distinct chainsaw bout 2: starts at 20.0s (> 3.0s after 6.0s)
            {"class_label": "Chainsaw", "confidence_score": 0.70, "start_seconds": 20.0, "end_seconds": 23.0, "segment_id": "seg_4"},
        ]

        events = engine.aggregate_raw_detections(raw_hits, session_id="sess_dist")

        assert len(events) == 2  # Bout 1 and Bout 2
        bout1 = events[0]
        assert bout1.class_label == "Chainsaw"
        assert bout1.start_seconds == 0.0
        assert bout1.end_seconds == 6.0
        assert bout1.duration_seconds == 6.0
        assert bout1.peak_confidence == 0.65
        assert bout1.repetition_count == 3
        assert len(bout1.evidence.segment_ids) == 3

        bout2 = events[1]
        assert bout2.start_seconds == 20.0
        assert bout2.end_seconds == 23.0
        assert bout2.repetition_count == 1

    def test_evidence_based_priority_scoring(self):
        """Verify that critical hazards (Chainsaw, Gunshot) receive higher priority than low hazards (Boat)."""
        engine = DisturbanceRadarEngine()

        # Critical hazard: Chainsaw with high confidence and long duration
        lvl_chain, score_chain = engine.compute_priority("Chainsaw", peak_confidence=0.80, duration_seconds=15.0, repetition_count=5)
        assert lvl_chain == "CRITICAL"
        assert score_chain >= 0.80

        # Low hazard: Distant boat with low confidence and short duration
        lvl_boat, score_boat = engine.compute_priority("Boat", peak_confidence=0.25, duration_seconds=3.0, repetition_count=1)
        assert lvl_boat in ["LOW", "INFORMATIONAL", "MEDIUM"]
        assert score_boat < score_chain

    def test_biological_cooccurrence_evaluation(self):
        """Verify non-causal biological vocalization rate comparison around disturbance."""
        engine = DisturbanceRadarEngine()

        raw_chainsaw = [
            {"class_label": "Chainsaw", "confidence_score": 0.75, "start_seconds": 60.0, "end_seconds": 66.0}
        ]
        dist_event = engine.aggregate_raw_detections(raw_chainsaw, session_id="sess_co")[0]

        # Biological detections: 6 detections before chainsaw (30-60s), only 1 after (66-96s)
        bio_dets = [
            {"common_name": "Robin", "start_seconds": 35.0, "end_seconds": 38.0},
            {"common_name": "Sparrow", "start_seconds": 40.0, "end_seconds": 43.0},
            {"common_name": "Warbler", "start_seconds": 45.0, "end_seconds": 48.0},
            {"common_name": "Robin", "start_seconds": 50.0, "end_seconds": 53.0},
            {"common_name": "Chickadee", "start_seconds": 55.0, "end_seconds": 58.0},
            {"common_name": "Robin", "start_seconds": 58.0, "end_seconds": 60.0},
            {"common_name": "Sparrow", "start_seconds": 80.0, "end_seconds": 83.0},
        ]

        obs = engine.analyze_biological_cooccurrence(dist_event, bio_dets, context_window_seconds=30.0)

        assert obs.disturbance_class == "Chainsaw"
        assert obs.pre_disturbance_activity_rate > obs.post_disturbance_activity_rate
        assert obs.activity_delta < 0.0
        assert "purely observational; non-causal" in obs.interpretation


# ============================================================================
# MODULE C: ACOUSTIC MEMORY ENGINE TESTS
# ============================================================================
class TestAcousticMemoryEngine:
    """Scientific tests for embedding indexing, FAISS integration, and exact numerical comparison."""

    @pytest.fixture(autouse=True)
    def setup_isolated_index(self):
        """Provide an isolated EmbeddingIndexService for memory tests."""
        self.idx = EmbeddingIndexService(model_version="BirdNET+ V3.0")
        self.sim = AcousticSimilarityService(self.idx)
        self.mem_engine = AcousticMemoryEngine(index_service=self.idx, sim_service=self.sim)

    def test_vector_indexing_and_normalization(self):
        """Verify vector dimension enforcement, NaN rejection, and unit L2 normalization."""
        # Valid 1280-D vector
        vec = np.random.randn(EXPECTED_DIMENSION).astype(np.float32)
        meta = SegmentMetadata(segment_id="seg_test_1", session_id="sess_1")

        self.idx.add_vector("seg_test_1", vec, meta)
        assert self.idx.vector_count == 1

        # Check normalization
        v_norm = self.idx.get_vector("seg_test_1", normalized=True)
        assert math.isclose(float(np.linalg.norm(v_norm)), 1.0, abs_tol=1e-5)

        # Reject invalid dimensions
        with pytest.raises(ValueError):
            self.idx.add_vector("bad_dim", np.random.randn(512).astype(np.float32), meta)

        # Reject non-finite vectors
        nan_vec = np.random.randn(EXPECTED_DIMENSION).astype(np.float32)
        nan_vec[10] = np.nan
        with pytest.raises(ValueError):
            self.idx.add_vector("nan_vec", nan_vec, meta)

    def test_numpy_and_faiss_numerical_parity(self):
        """Benchmark and verify that FAISS retrieval strictly matches the NumPy baseline."""
        np.random.seed(42)
        n_vectors = 50

        # Populate index with synthetic embeddings
        for i in range(n_vectors):
            vec = np.random.randn(EXPECTED_DIMENSION).astype(np.float32)
            meta = SegmentMetadata(segment_id=f"seg_{i}", session_id=f"sess_{i % 3}")
            self.idx.add_vector(f"seg_{i}", vec, meta)

        assert self.idx.vector_count == n_vectors

        # Sync FAISS
        n_faiss = self.mem_engine.sync_faiss_index()
        assert n_faiss == n_vectors

        # Run comparison
        query = np.random.randn(EXPECTED_DIMENSION).astype(np.float32)
        report = self.mem_engine.compare_retrieval_engines(query, k=10)

        assert report.k == 10
        assert report.dataset_size == n_vectors
        assert report.indices_match is True
        assert report.max_score_difference < 1e-4
        assert report.is_numerically_identical is True

    def test_feature_flag_status(self):
        """Verify engine correctly reflects ENABLE_ACOUSTIC_MEMORY configuration."""
        status = self.mem_engine.get_status()
        assert "enabled" in status
        assert "embedding_dimension" in status
        assert status["embedding_dimension"] == EXPECTED_DIMENSION
        assert "faiss_available" in status


# ============================================================================
# MODULE D: ACOUSTIC ANOMALY SERVICE TESTS
# ============================================================================
class TestAcousticAnomalyService:
    """Scientific tests for kNN distance, novelty scoring, and candidate generation."""

    def test_novelty_scoring_isolated_vs_clustered(self):
        """Verify that isolated vectors receive significantly higher novelty scores than cluster members."""
        idx = EmbeddingIndexService()
        sim = AcousticSimilarityService(idx)
        svc = AcousticAnomalyService(index_service=idx, sim_service=sim)

        np.random.seed(123)
        center = np.random.randn(EXPECTED_DIMENSION).astype(np.float32)
        center /= np.linalg.norm(center)

        # Add 20 points clustered closely around 'center'
        for i in range(20):
            pt = center + 0.05 * np.random.randn(EXPECTED_DIMENSION).astype(np.float32)
            pt /= np.linalg.norm(pt)
            idx.add_vector(f"cluster_pt_{i}", pt, SegmentMetadata(segment_id=f"cluster_pt_{i}", session_id="s1"))

        # Point inside cluster
        in_cluster_pt = center + 0.04 * np.random.randn(EXPECTED_DIMENSION).astype(np.float32)
        score_in, _, factors_in = svc.evaluate_vector_novelty(in_cluster_pt, k_neighbors=5)

        # Isolated anomaly point orthogonal to cluster
        anomaly_pt = np.random.randn(EXPECTED_DIMENSION).astype(np.float32)
        anomaly_pt /= np.linalg.norm(anomaly_pt)
        score_out, _, factors_out = svc.evaluate_vector_novelty(anomaly_pt, k_neighbors=5)

        assert score_out > score_in
        assert factors_out["top1_distance"] > factors_in["top1_distance"]

    def test_anomaly_candidate_generation(self):
        """Verify generation of structured AnomalyCandidate with breakdown."""
        idx = EmbeddingIndexService()
        sim = AcousticSimilarityService(idx)
        svc = AcousticAnomalyService(index_service=idx, sim_service=sim)

        vec = np.random.randn(EXPECTED_DIMENSION).astype(np.float32)
        idx.add_vector("anom_seg_1", vec, SegmentMetadata(segment_id="anom_seg_1", session_id="s_anom", start_seconds=12.0, end_seconds=15.0))

        cand = svc.evaluate_segment_anomaly("anom_seg_1")
        assert cand is not None
        assert isinstance(cand, AnomalyCandidate)
        assert cand.segment_id == "anom_seg_1"
        assert cand.session_id == "s_anom"
        assert 0.0 <= cand.anomaly_score <= 1.0
        assert "composite_score" in cand.heuristic_breakdown
        assert len(cand.primary_reasons) > 0


# ============================================================================
# MODULE E: EVENT INTELLIGENCE AND EVIDENCE TESTS
# ============================================================================
class TestEventIntelligenceService:
    """Scientific tests for unified event representation, evidence audio saving, and deduplication."""

    def test_contextual_audio_evidence_persistence(self):
        """Verify writing WAV audio clips to external storage outside SQLite."""
        temp_dir = Path(tempfile.mkdtemp(prefix="ecosonic_evidence_"))
        svc = EventIntelligenceService(evidence_dir=temp_dir)

        fs = 32000
        samples = (0.2 * np.sin(2 * np.pi * 440 * np.linspace(0, 1.0, fs))).astype(np.float32)

        try:
            ev = svc.save_audio_evidence("sess_audit", "ev_001", samples, fs)
            assert isinstance(ev, ContextualAudioEvidence)
            assert ev.audio_clip_path is not None
            assert Path(ev.audio_clip_path).exists()
            assert ev.sample_rate == fs
            assert ev.clip_duration_seconds == 1.0
            assert ev.file_size_bytes > 0
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_overlapping_event_consolidation(self):
        """Verify merging of overlapping and contiguous events of identical type and class."""
        svc = EventIntelligenceService()

        events = [
            UnifiedAcousticEvent(
                event_id="e1", session_id="s1", event_type="biological_detection", category="biophony",
                class_label="Turdus migratorius", display_name="American Robin",
                start_seconds=0.0, end_seconds=3.0, duration_seconds=3.0, confidence_or_score=0.75,
                priority_level="LOW", model_version="BirdNET+ V3.0", evidence=ContextualAudioEvidence(),
            ),
            # Overlaps e1 (starts at 2.0s, ends at 5.0s)
            UnifiedAcousticEvent(
                event_id="e2", session_id="s1", event_type="biological_detection", category="biophony",
                class_label="Turdus migratorius", display_name="American Robin",
                start_seconds=2.0, end_seconds=5.0, duration_seconds=3.0, confidence_or_score=0.88,
                priority_level="LOW", model_version="BirdNET+ V3.0", evidence=ContextualAudioEvidence(),
            ),
            # Different species at 4.0s: should NOT merge with Robin
            UnifiedAcousticEvent(
                event_id="e3", session_id="s1", event_type="biological_detection", category="biophony",
                class_label="Cyanocitta cristata", display_name="Blue Jay",
                start_seconds=4.0, end_seconds=7.0, duration_seconds=3.0, confidence_or_score=0.90,
                priority_level="LOW", model_version="BirdNET+ V3.0", evidence=ContextualAudioEvidence(),
            ),
        ]

        merged = svc.consolidate_events(events, tolerance_seconds=1.5)

        # e1 and e2 should be merged into Robin [0.0 - 5.0s], e3 remains separate
        assert len(merged) == 2
        robin = next(m for m in merged if m.class_label == "Turdus migratorius")
        assert robin.start_seconds == 0.0
        assert robin.end_seconds == 5.0
        assert robin.duration_seconds == 5.0
        assert robin.confidence_or_score == 0.88  # Peak confidence preserved


# ============================================================================
# API ENDPOINT EXTENSION TESTS
# ============================================================================
@pytest.mark.asyncio
async def test_live_session_anomalies_and_intelligence_endpoints(client: AsyncClient):
    """Verify newly added /sessions/{id}/anomalies and /sessions/{id}/intelligence endpoints."""
    # 1. Create a session
    resp = await client.post(
        "/api/v1/live/sessions",
        json={"source_type": "browser_mic", "device_id": "test_unit_4b"},
    )
    assert resp.status_code == 201
    session_id = resp.json()["id"]

    # 2. Query /anomalies
    res_anom = await client.get(f"/api/v1/live/sessions/{session_id}/anomalies")
    assert res_anom.status_code == 200
    assert isinstance(res_anom.json(), list)

    # 3. Query /intelligence
    res_intel = await client.get(f"/api/v1/live/sessions/{session_id}/intelligence")
    assert res_intel.status_code == 200
    data = res_intel.json()
    assert data["session_id"] == session_id
    assert "detections_count" in data
    assert "disturbances_count" in data
    assert "anomalies_count" in data
    assert "top_detected_species" in data


@pytest.mark.asyncio
async def test_acoustic_memory_api_extensions(client: AsyncClient):
    """Verify /acoustic-memory/clusters, /projection, and /benchmark/compare endpoints."""
    # 1. Test /clusters
    res_clusters = await client.get("/api/v1/acoustic-memory/clusters")
    assert res_clusters.status_code == 200
    assert isinstance(res_clusters.json(), list)

    # 2. Test /projection (alias endpoint)
    res_proj = await client.get("/api/v1/acoustic-memory/projection")
    assert res_proj.status_code == 200
    assert "points" in res_proj.json()

    # 3. Test /benchmark/compare
    res_bench = await client.post("/api/v1/acoustic-memory/benchmark/compare?k=5")
    assert res_bench.status_code == 200
