"""Phase 4B Advanced Ecoacoustic Intelligence Performance & Reliability Benchmark.

Benchmarks:
1. Soundscape Fingerprint calculation (single window, multi-window, trend analysis).
2. Disturbance Radar (filtering, temporal merging, priority scoring, biological co-occurrence).
3. Acoustic Memory Engine (Exact NumPy BLAS vs FAISS IndexFlatIP speedup curve across N=50..5000,
   numerical parity, HDBSCAN clustering, UMAP 2D projection).
4. Acoustic Anomaly Discovery (multi-factor anomaly scoring, kNN distance, candidate ranking).
5. Event Intelligence Service (unification, temporal consolidation).
6. System memory footprint (RSS tracking).
"""

from __future__ import annotations

import asyncio
import gc
import logging
import math
import os
import sys
import time
import uuid
from pathlib import Path

import numpy as np
import psutil

# Add backend directory to path
backend_dir = Path(__file__).resolve().parents[1]
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

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

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("Phase4BBenchmark")


def get_rss_mb() -> float:
    return psutil.Process().memory_info().rss / (1024 * 1024)


def generate_synthetic_audio(seconds: float = 3.0, sample_rate: int = 32000) -> np.ndarray:
    """Generate synthetic environmental audio with bioacoustic and anthropogenic components."""
    t = np.linspace(0, seconds, int(sample_rate * seconds), endpoint=False)
    noise = np.random.normal(0, 0.05, len(t))
    biophony = 0.2 * np.sin(2 * np.pi * 4200 * t) + 0.15 * np.sin(2 * np.pi * 5500 * t)
    anthrophony = 0.1 * np.sin(2 * np.pi * 500 * t)
    audio = noise + biophony + anthrophony
    return (audio / np.max(np.abs(audio))).astype(np.float32)


def generate_normalized_embeddings(count: int, dim: int = 1280) -> np.ndarray:
    """Generate count random L2-normalized embeddings in R^dim."""
    raw = np.random.randn(count, dim).astype(np.float32)
    norms = np.linalg.norm(raw, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return raw / norms


def benchmark_soundscape():
    logger.info("\n" + "=" * 70)
    logger.info("BENCHMARK 1: Soundscape Fingerprint Engine")
    logger.info("=" * 70)

    sr = 32000
    audio_3s = generate_synthetic_audio(3.0, sr)

    # 1. Single window latency (warm-up + 5 iterations)
    _ = soundscape_intelligence_service.analyze_audio_window(audio_3s, sr, 0.0, 3.0, "bench-sess")
    latencies = []
    for i in range(5):
        t0 = time.perf_counter()
        m = soundscape_intelligence_service.analyze_audio_window(audio_3s, sr, float(i * 3), float(i * 3 + 3), "bench-sess")
        latencies.append((time.perf_counter() - t0) * 1000)

    median_single = float(np.median(latencies))
    mean_single = float(np.mean(latencies))
    logger.info(f"Single-window (3.0s, 32kHz) latency: median={median_single:.2f} ms, mean={mean_single:.2f} ms")
    formatted_metrics = ", ".join(f"{k}={v:.4f}" if v is not None else f"{k}=None" for k, v in m.metrics.items())
    logger.info(f"Indices: {formatted_metrics}")

    # 2. Multi-window analysis (10 windows = 30s)
    audio_30s = generate_synthetic_audio(30.0, sr)
    t0 = time.perf_counter()
    trend = soundscape_intelligence_service.analyze_multi_window(
        audio=audio_30s,
        sample_rate=sr,
        window_duration_s=3.0,
        hop_duration_s=3.0,
        session_id="bench-sess",
    )
    t_multi = (time.perf_counter() - t0) * 1000
    logger.info(f"Multi-window analysis (10 windows, 30s): {t_multi:.2f} ms ({t_multi / 10:.2f} ms/window), stability={trend.temporal_stability_index:.4f}")

    # 3. Historical comparison
    m1 = trend.measurements[0]
    m2 = trend.measurements[-1]
    t0 = time.perf_counter()
    comparison = soundscape_intelligence_service.compare_soundscapes(baseline=m1, target=m2)
    t_comp = (time.perf_counter() - t0) * 1000
    ndsi_delta = comparison.metric_deltas.get("ndsi", 0.0)
    logger.info(f"Historical comparison (window 1 vs 10): {t_comp:.3f} ms, ndsi_delta={ndsi_delta:+.4f}")

    return {
        "single_window_median_ms": median_single,
        "single_window_mean_ms": mean_single,
        "multi_window_10_total_ms": t_multi,
        "multi_window_per_window_ms": t_multi / 10,
        "stability_index": trend.temporal_stability_index,
        "historical_comparison_ms": t_comp,
    }


def benchmark_disturbance_radar():
    logger.info("\n" + "=" * 70)
    logger.info("BENCHMARK 2: Disturbance Radar")
    logger.info("=" * 70)

    radar = disturbance_radar_engine
    dist_classes_list = sorted(list(VERIFIED_DISTURBANCE_TAXONOMY.keys()))

    results = {}
    for count in [50, 200, 1000]:
        # Generate synthetic raw detections
        raw_detections = []
        for i in range(count):
            label = dist_classes_list[i % len(dist_classes_list)]
            start_t = float((i // 2) * 2.0)
            score = 0.40 + 0.55 * (i % 10) / 10.0
            raw_detections.append({
                "label": label,
                "common_name": label,
                "confidence": score,
                "start_seconds": start_t,
                "end_seconds": start_t + 3.0,
                "window_index": i,
                "segment_id": f"seg_{i}",
            })

        t0 = time.perf_counter()
        events = radar.aggregate_raw_detections(raw_detections, session_id="bench_sess")
        t_merge = (time.perf_counter() - t0) * 1000

        logger.info(f"Processed {count} detections -> {len(events)} merged disturbance events in {t_merge:.2f} ms")
        results[f"merge_{count}_ms"] = t_merge
        results[f"merged_count_{count}"] = len(events)

    # Biological co-occurrence benchmark
    bio_detections = []
    for i in range(200):
        start_t = float(i * 1.5)
        bio_detections.append({
            "common_name": f"Species_{i % 5}",
            "confidence": 0.85,
            "start_seconds": start_t,
            "end_seconds": start_t + 3.0,
        })
    sample_event = events[0] if events else None

    if sample_event:
        t0 = time.perf_counter()
        obs = radar.analyze_biological_cooccurrence(sample_event, bio_detections, context_window_seconds=30.0)
        t_co = (time.perf_counter() - t0) * 1000
        logger.info(f"Biological co-occurrence analysis: {t_co:.3f} ms, concurrent_species={len(obs.concurrent_biological_species)}")
        results["co_occurrence_ms"] = t_co

    return results


def benchmark_acoustic_memory():
    logger.info("\n" + "=" * 70)
    logger.info("BENCHMARK 3: Acoustic Memory Engine & Vector Retrieval")
    logger.info("=" * 70)

    dim = 1280
    query_vec = generate_normalized_embeddings(1, dim)[0]

    # Benchmark dual retrieval scaling
    scales = [50, 200, 500, 1000, 5000]
    results = {}

    logger.info(f"{'Scale (N)':<10} | {'NumPy Latency':<15} | {'FAISS Latency':<15} | {'Speedup':<10} | {'Max Score Diff':<15} | {'Rank Parity'}")
    logger.info("-" * 85)

    for n in scales:
        # Create fresh engine and index
        idx_svc = EmbeddingIndexService()
        sim_svc = AcousticSimilarityService(index_service=idx_svc)
        engine = AcousticMemoryEngine(index_service=idx_svc, sim_service=sim_svc)

        embeddings = generate_normalized_embeddings(n, dim)
        for i in range(n):
            idx_svc.add_vector(
                f"emb_{n}_{i}",
                embeddings[i],
                SegmentMetadata(
                    segment_id=f"emb_{n}_{i}",
                    session_id="bench_sess",
                    start_seconds=float(i * 3),
                    end_seconds=float(i * 3 + 3),
                ),
            )
        engine.sync_faiss_index()

        # Run comparison multiple times
        reports = []
        for _ in range(10):
            rep = engine.compare_retrieval_engines(query_vector=query_vec, k=10)
            reports.append(rep)

        med_np = float(np.median([r.numpy_duration_ms for r in reports]))
        med_faiss = float(np.median([r.faiss_duration_ms for r in reports]))
        speedup = med_np / max(med_faiss, 0.0001)
        last_rep = reports[-1]

        logger.info(
            f"{n:<10} | {med_np:>10.3f} ms    | {med_faiss:>10.3f} ms    | {speedup:>8.2f}x | {last_rep.max_score_difference:>13.2e} | {str(last_rep.indices_match)}"
        )
        results[f"scale_{n}"] = {
            "numpy_ms": med_np,
            "faiss_ms": med_faiss,
            "speedup": speedup,
            "max_score_diff": last_rep.max_score_difference,
            "rank_match": last_rep.indices_match,
        }

    # HDBSCAN Clustering Benchmark
    logger.info("\n--- HDBSCAN Clustering Benchmark ---")
    from sklearn.cluster import HDBSCAN
    for n in [50, 200, 500]:
        embeddings = generate_normalized_embeddings(n, dim)
        t0 = time.perf_counter()
        clusterer = HDBSCAN(min_cluster_size=5, min_samples=3, metric="euclidean")
        labels = clusterer.fit_predict(embeddings)
        t_hdb = (time.perf_counter() - t0) * 1000
        n_clusters = len(set(labels[labels >= 0]))
        noise_cnt = int(np.sum(labels == -1))
        logger.info(f"HDBSCAN (N={n}, Dim={dim}): {t_hdb:.2f} ms -> {n_clusters} clusters, noise={noise_cnt}/{n}")
        results[f"hdbscan_{n}_ms"] = t_hdb

    # UMAP 2D Projection Benchmark
    logger.info("\n--- UMAP 2D Projection Benchmark ---")
    try:
        import umap
        for n in [50, 200, 500]:
            embeddings = generate_normalized_embeddings(n, dim)
            t0 = time.perf_counter()
            reducer = umap.UMAP(n_neighbors=15, min_dist=0.1, n_components=2, metric="cosine", random_state=42)
            coords = reducer.fit_transform(embeddings)
            t_umap = (time.perf_counter() - t0) * 1000
            logger.info(f"UMAP 2D (N={n}, Dim={dim}): {t_umap:.2f} ms -> {len(coords)} points")
            results[f"umap_{n}_ms"] = t_umap
    except Exception as exc:
        logger.warning(f"UMAP benchmark skipped: {exc}")

    return results


def benchmark_acoustic_anomalies():
    logger.info("\n" + "=" * 70)
    logger.info("BENCHMARK 4: Acoustic Anomaly Discovery")
    logger.info("=" * 70)

    dim = 1280
    results = {}

    for n in [50, 200, 500]:
        idx_svc = EmbeddingIndexService()
        sim_svc = AcousticSimilarityService(index_service=idx_svc)
        anom_svc = AcousticAnomalyService(index_service=idx_svc, sim_service=sim_svc, anomaly_threshold=0.50)

        embeddings = generate_normalized_embeddings(n, dim)
        for i in range(n):
            idx_svc.add_vector(
                segment_id=f"seg_{i}",
                vector=embeddings[i],
                metadata=SegmentMetadata(
                    segment_id=f"seg_{i}",
                    session_id=f"sess_{n}",
                    start_seconds=float(i * 3),
                    end_seconds=float(i * 3 + 3),
                    label="Turdus merula" if i % 10 != 0 else None,
                    confidence=0.85 if i % 10 != 0 else 0.15,
                ),
            )

        t0 = time.perf_counter()
        candidates = anom_svc.discover_session_anomalies(session_id=f"sess_{n}", threshold=0.40)
        t_anom = (time.perf_counter() - t0) * 1000

        logger.info(f"Anomaly Discovery (N={n} segments): {t_anom:.2f} ms -> {len(candidates)} candidates detected")
        results[f"anomaly_{n}_ms"] = t_anom
        results[f"candidates_{n}"] = len(candidates)

    return results


def benchmark_event_intelligence():
    logger.info("\n" + "=" * 70)
    logger.info("BENCHMARK 5: Event Intelligence & Consolidation")
    logger.info("=" * 70)

    svc = event_intelligence_service
    results = {}

    events = []
    for i in range(300):
        t_start = float(i * 2.0)
        e_type = ["biological_detection", "disturbance_event", "acoustic_anomaly"][i % 3]
        events.append(
            UnifiedAcousticEvent(
                event_id=f"evt_{i}",
                session_id="bench_sess",
                event_type=e_type,
                category="anthrophony" if e_type == "disturbance_event" else "biophony",
                class_label=f"Label_{i % 10}",
                display_name=f"Label_{i % 10}",
                start_seconds=t_start,
                end_seconds=t_start + 3.0,
                duration_seconds=3.0,
                confidence_or_score=0.75 + (i % 20) / 100.0,
                priority_level="HIGH" if e_type == "disturbance_event" else "MEDIUM",
                model_version="BirdNET+ V3.0",
                evidence=ContextualAudioEvidence(audio_clip_path=f"storage/evidence/bench_sess/evt_{i}.wav"),
            )
        )

    t0 = time.perf_counter()
    consolidated = svc.consolidate_events(events, tolerance_seconds=2.0)
    t_cons = (time.perf_counter() - t0) * 1000

    logger.info(f"Event consolidation (300 events): {t_cons:.2f} ms -> {len(consolidated)} consolidated events")
    results["consolidation_300_ms"] = t_cons
    results["consolidated_count"] = len(consolidated)

    return results


def run_full_benchmark():
    gc.collect()
    rss_initial = get_rss_mb()
    logger.info(f"Starting Phase 4B Advanced Intelligence Benchmark (Initial RSS: {rss_initial:.1f} MB)")

    t_start = time.perf_counter()
    res_soundscape = benchmark_soundscape()
    res_dist = benchmark_disturbance_radar()
    res_mem = benchmark_acoustic_memory()
    res_anom = benchmark_acoustic_anomalies()
    res_event = benchmark_event_intelligence()
    t_total = time.perf_counter() - t_start

    gc.collect()
    rss_final = get_rss_mb()
    logger.info("\n" + "=" * 70)
    logger.info(f"BENCHMARK COMPLETE IN {t_total:.2f} s")
    logger.info(f"Memory: Initial={rss_initial:.1f} MB, Final={rss_final:.1f} MB, Delta={rss_final - rss_initial:+.1f} MB")
    logger.info("=" * 70)

    return {
        "soundscape": res_soundscape,
        "disturbance": res_dist,
        "memory": res_mem,
        "anomaly": res_anom,
        "event": res_event,
        "rss_initial_mb": rss_initial,
        "rss_final_mb": rss_final,
        "rss_delta_mb": rss_final - rss_initial,
        "total_benchmark_time_seconds": t_total,
    }


if __name__ == "__main__":
    run_full_benchmark()
