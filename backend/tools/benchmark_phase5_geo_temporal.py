"""Phase 5 Geo-Temporal Environmental Intelligence Performance Benchmark.

Evaluates:
1. BirdNET Geo V3.0 ONNX model load time, cold inference latency, warm inference latency, and throughput.
2. LRU prediction caching performance and speedup ratio.
3. Acoustic detection occurrence evaluation & screening throughput.
4. Habitat drift comparison computation speed across normalized sessions.
5. Ecological report generation latency (JSON vs CSV).
6. Process memory footprint (RSS) and model footprint.
"""

from __future__ import annotations

import asyncio
import gc
import logging
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
import psutil

backend_dir = Path(__file__).resolve().parents[1]
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

# Configure model cache
model_cache_path = backend_dir.parent / ".model_cache"
if model_cache_path.exists():
    os.environ.setdefault("BIRDNET_APP_DATA", str(model_cache_path))

from app.models.environmental_intelligence import (
    EnvironmentalIncident,
    EnvironmentalReview,
    HabitatComparison,
)
from app.models.live_session import LiveEvent, LiveSession
from app.models.site import Site
from app.models.soundscape import DisturbanceEvent
from app.schemas.environmental_intelligence import EcologicalReportRequest
from app.services.ecological_report_service import ecological_report_service
from app.services.environmental_review_service import (
    EnvironmentalReviewCreate,
    environmental_review_service,
)
from app.services.geo_temporal_service import (
    date_to_birdnet_week,
    geo_temporal_service,
)
from app.services.habitat_drift_service import (
    compute_mad,
    compute_robust_z,
    habitat_drift_service,
)
from app.services.incident_management_service import (
    EnvironmentalIncidentCreate,
    incident_management_service,
)
from app.services.site_intelligence_service import site_intelligence_service

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("Phase5Benchmark")


def get_rss_mb() -> float:
    return psutil.Process().memory_info().rss / (1024 * 1024)


async def run_benchmark():
    gc.collect()
    rss_initial = get_rss_mb()
    print("=" * 80)
    print("ECOSONIC 3.0 — PHASE 5 GEO-TEMPORAL INTELLIGENCE BENCHMARK")
    print("=" * 80)
    print(f"Python Platform: {sys.version.split()[0]} on {sys.platform}")
    print(f"Initial Process RSS: {rss_initial:.2f} MB")
    print()

    # ------------------------------------------------------------------------
    # BENCHMARK 1: Model Loading & Cold vs Warm Forward Passes
    # ------------------------------------------------------------------------
    print("--- BENCHMARK 1: BirdNET Geo V3.0 ONNX Model Latency ---")
    t0 = time.perf_counter()
    geo_temporal_service.load_model()
    load_time_sec = time.perf_counter() - t0
    rss_after_load = get_rss_mb()
    model_mem_overhead = rss_after_load - rss_initial
    print(f"Geo V3.0 Model Load Time: {load_time_sec * 1000.0:.2f} ms ({load_time_sec:.3f} s)")
    print(f"Species in Model: {geo_temporal_service._model.n_species}")
    print(f"Process RSS after Model Load: {rss_after_load:.2f} MB (Delta: +{model_mem_overhead:.2f} MB)")

    # Cold forward pass
    lat_sample, lon_sample, week_sample = 42.44, -76.50, 20
    t0 = time.perf_counter()
    cold_probs = geo_temporal_service._model.predict(lat_sample, lon_sample, week=week_sample).species_probs
    cold_latency_ms = (time.perf_counter() - t0) * 1000.0
    print(f"Cold Model Inference Latency: {cold_latency_ms:.2f} ms")

    # Warm forward passes (N=50)
    n_warm = 50
    warm_latencies = []
    # Use slightly varying coordinates to bypass in-memory caching and hit ONNX engine
    for i in range(n_warm):
        lat_v = 40.0 + (i * 0.1)
        lon_v = -75.0 - (i * 0.1)
        w_v = (i % 48) + 1
        t_start = time.perf_counter()
        _ = geo_temporal_service._model.predict(lat_v, lon_v, week=w_v).species_probs
        dur = (time.perf_counter() - t_start) * 1000.0
        warm_latencies.append(dur)

    med_warm = float(np.median(warm_latencies))
    p95_warm = float(np.percentile(warm_latencies, 95))
    min_warm = float(np.min(warm_latencies))
    max_warm = float(np.max(warm_latencies))
    throughput_ops = 1000.0 / med_warm
    print(f"Warm ONNX Inference (N={n_warm}):")
    print(f"  Median: {med_warm:.2f} ms | p95: {p95_warm:.2f} ms | Min: {min_warm:.2f} ms | Max: {max_warm:.2f} ms")
    print(f"  Throughput: {throughput_ops:.1f} forward passes/sec")
    print()

    # ------------------------------------------------------------------------
    # BENCHMARK 2: In-Memory LRU Prediction Caching
    # ------------------------------------------------------------------------
    print("--- BENCHMARK 2: LRU Prediction Caching & Spatial Cache Hit Latency ---")
    # Prime cache
    _ = geo_temporal_service.get_raw_geo_predictions(lat_sample, lon_sample, week=week_sample)

    n_cache = 1000
    cache_latencies = []
    for _ in range(n_cache):
        t_start = time.perf_counter()
        _ = geo_temporal_service.get_raw_geo_predictions(lat_sample, lon_sample, week=week_sample)
        cache_latencies.append((time.perf_counter() - t_start) * 1000.0)

    med_cache_us = float(np.median(cache_latencies)) * 1000.0
    p95_cache_us = float(np.percentile(cache_latencies, 95)) * 1000.0
    cache_throughput = 1_000_000.0 / med_cache_us
    cache_speedup = (med_warm * 1000.0) / med_cache_us
    print(f"Cache Hit Query Latency (N={n_cache}):")
    print(f"  Median: {med_cache_us:.2f} \u00b5s ({med_cache_us / 1000.0:.4f} ms)")
    print(f"  p95:    {p95_cache_us:.2f} \u00b5s")
    print(f"  Throughput: {cache_throughput:,.0f} lookups/sec")
    print(f"  Cache Speedup vs Raw Inference: {cache_speedup:,.1f}x")
    print()

    # ------------------------------------------------------------------------
    # BENCHMARK 3: Occurrence Evaluation & Screening Throughput
    # ------------------------------------------------------------------------
    print("--- BENCHMARK 3: Detection Occurrence Evaluation & Taxonomy Alignment ---")
    test_taxa = [
        ("Turdus migratorius", 0.88),
        ("Cyanocitta cristata", 0.75),
        ("Bubo virginianus", 0.91),
        ("Apteryx mantelli", 0.95),  # Vagrant / unexpected
        ("Chainsaw", 0.82),          # Anthropogenic disturbance
        ("Engine", 0.70),            # Transportation disturbance
    ]

    n_evals = 300
    eval_latencies = []
    for i in range(n_evals):
        sp, conf = test_taxa[i % len(test_taxa)]
        t_start = time.perf_counter()
        _ = geo_temporal_service.contextualize_acoustic_detection(
            scientific_name=sp,
            acoustic_confidence=conf,
            latitude=42.44,
            longitude=-76.50,
            week=(i % 48) + 1,
        )
        eval_latencies.append((time.perf_counter() - t_start) * 1000.0)

    med_eval = float(np.median(eval_latencies))
    p95_eval = float(np.percentile(eval_latencies, 95))
    eval_throughput = 1000.0 / med_eval
    print(f"Contextualize Acoustic Detection (N={n_evals}):")
    print(f"  Median: {med_eval:.3f} ms | p95: {p95_eval:.3f} ms")
    print(f"  Screening Throughput: {eval_throughput:,.1f} detections/sec")
    print()

    # ------------------------------------------------------------------------
    # BENCHMARK 4: Habitat Drift Statistical Computation
    # ------------------------------------------------------------------------
    print("--- BENCHMARK 4: Habitat Drift & Non-Parametric Statistics ---")
    # Benchmark MAD and Robust Z-score across series length N=50..500
    z_latencies = []
    for series_len in [20, 50, 100, 250, 500]:
        hist_data = np.random.normal(12.0, 2.5, series_len).tolist()
        t0 = time.perf_counter()
        for _ in range(200):
            _ = compute_robust_z(18.5, hist_data)
        elapsed_us = ((time.perf_counter() - t0) / 200.0) * 1_000_000.0
        z_latencies.append((series_len, elapsed_us))

    print("Robust Z-Score (Median + MAD) Latency:")
    for slen, lus in z_latencies:
        print(f"  Series Length N={slen:3d}: {lus:.2f} \u00b5s ({1_000_000.0 / lus:,.0f} ops/sec)")
    print()

    # ------------------------------------------------------------------------
    # BENCHMARK 5: Report Generation Latency
    # ------------------------------------------------------------------------
    print("--- BENCHMARK 5: Ecological Evidence Report Generation ---")
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from app.core.database import Base

    test_engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(bind=test_engine, expire_on_commit=False)

    async with session_factory() as db:
        # Populate realistic benchmark site with 10 sessions, 250 detections, 25 disturbances
        site_id = str(uuid.uuid4())
        site = Site(
            id=site_id,
            name="Hubbard Brook Benchmark Forest",
            latitude=43.94,
            longitude=-71.75,
            ecosystem_category="temperate_broadleaf_forest",
            location_sensitivity="generalized",
            generalized_latitude=43.94,
            generalized_longitude=-71.75,
        )
        db.add(site)

        for s_idx in range(10):
            s_id = str(uuid.uuid4())
            sess = LiveSession(
                id=s_id,
                site_id=site_id,
                source_type="browser_mic",
                status="completed",
                total_audio_seconds=1800.0,
                processed_audio_seconds=1800.0,
                started_at=datetime.now(timezone.utc),
            )
            db.add(sess)

            for d_idx in range(25):
                db.add(
                    LiveEvent(
                        id=str(uuid.uuid4()),
                        session_id=s_id,
                        class_label=f"Species {d_idx % 8}",
                        scientific_name=f"Species {d_idx % 8}",
                        common_name=f"Common Bird {d_idx % 8}",
                        confidence_score=0.75 + (d_idx % 20) * 0.01,
                        start_seconds=d_idx * 15.0,
                        end_seconds=d_idx * 15.0 + 3.0,
                    )
                )

            for dist_idx in range(3):
                db.add(
                    DisturbanceEvent(
                        id=str(uuid.uuid4()),
                        session_id=s_id,
                        event_type="disturbance",
                        class_label="Chainsaw",
                        category="anthropogenic_disturbance",
                        confidence_score=0.85,
                        start_seconds=dist_idx * 100.0,
                        end_seconds=dist_idx * 100.0 + 10.0,
                    )
                )

        await db.commit()

        # Benchmark JSON report
        req = EcologicalReportRequest(site_id=site_id, format="json", mask_sensitive_locations=True)
        t0 = time.perf_counter()
        json_rep = await ecological_report_service.generate_json_report(req, db)
        json_latency_ms = (time.perf_counter() - t0) * 1000.0

        # Benchmark CSV report
        req_csv = EcologicalReportRequest(site_id=site_id, format="csv", mask_sensitive_locations=True)
        t0 = time.perf_counter()
        csv_rep = await ecological_report_service.generate_csv_report(req_csv, db)
        csv_latency_ms = (time.perf_counter() - t0) * 1000.0

    await test_engine.dispose()

    print(f"Ecological Evidence Report Generation (10 sessions, 250 detections, 30 disturbances):")
    print(f"  Full JSON Report Generation Latency: {json_latency_ms:.2f} ms")
    print(f"  Scientific CSV Export Latency:       {csv_latency_ms:.2f} ms (CSV length: {len(csv_rep):,} bytes)")
    print()

    # ------------------------------------------------------------------------
    # BENCHMARK 6: Final Memory Footprint Summary
    # ------------------------------------------------------------------------
    rss_final = get_rss_mb()
    print("--- BENCHMARK 6: Memory Footprint Summary ---")
    print(f"Initial Baseline RSS:     {rss_initial:.2f} MB")
    print(f"RSS with Geo Model:       {rss_after_load:.2f} MB (+{model_mem_overhead:.2f} MB)")
    print(f"Final Peak RSS:           {rss_final:.2f} MB")
    print("=" * 80)
    print("BENCHMARK COMPLETED SUCCESSFULLY")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(run_benchmark())
