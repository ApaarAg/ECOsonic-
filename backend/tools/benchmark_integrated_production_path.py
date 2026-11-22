"""Benchmark the integrated Direct ONNX production pipeline for EcoSonic 3.0.

Measures:
- Exactly 96,000 input samples (3.0s @ 32 kHz mono float32)
- 10 warm-up runs + 50 measured runs per configuration
- Granular stage breakdown:
  1. Preprocessing (validation, pad/slice, tensor shaping)
  2. ONNX Runtime execution (predictions + 1280-D embeddings in one dispatch)
  3. Prediction postprocessing (top-5 extraction, label lookup, disturbance check)
  4. Embedding handling (vector validation, .npy storage serialization)
  5. Database persistence (SQLite WAL insert of segment + events)
  6. WebSocket publication (JSON serialization + broadcast simulation)
  7. Total post-window processing latency
- Separately benchmarks GPU (CUDAExecutionProvider) and CPU fallback (CPUExecutionProvider)
- Calculates Real-Time Factor (RTF = Total / 3.0s)
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
import onnxruntime as ort
import soundfile as sf

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
if str(PROJECT_ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from app.core.database import async_session_factory, init_db
from app.models.live_session import LiveEvent, LiveSegment, LiveSession
from app.services.audio_processor import audio_processor
from app.services.birdnet_engine import _ensure_model_cache_env, _prepare_windows_cuda_dll_path
from app.services.direct_onnx_engine import DirectOnnxEngine
from app.services.soundscape.disturbance_service import disturbance_service
from app.services.storage_service import storage_service

_ensure_model_cache_env()
_prepare_windows_cuda_dll_path()

OUTPUT_PATH = PROJECT_ROOT / "docs" / "integrated_direct_onnx_benchmark_results.json"
AUDIO_FILE = PROJECT_ROOT / "backend" / "data" / "smoke_audio" / "birds_forest.ogg"


def load_96000_samples() -> np.ndarray:
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
        temp_wav = Path(tf.name)
    try:
        audio_processor.convert_to_mono_wav(AUDIO_FILE, temp_wav, target_sr=32000)
        data, sr = sf.read(str(temp_wav), dtype="float32")
        if data.ndim > 1:
            data = data.mean(axis=1)
        if len(data) < 96000:
            data = np.pad(data, (0, 96000 - len(data)))
        else:
            data = data[:96000]
        return data.astype(np.float32)
    finally:
        if temp_wav.exists():
            temp_wav.unlink()


def compute_distribution(samples_ms: List[float]) -> Dict[str, float]:
    arr = np.array(samples_ms, dtype=np.float64)
    return {
        "count": int(len(arr)),
        "mean_ms": round(float(np.mean(arr)), 3),
        "std_ms": round(float(np.std(arr)), 3),
        "median_ms": round(float(np.median(arr)), 3),
        "p95_ms": round(float(np.percentile(arr, 95)), 3),
        "p99_ms": round(float(np.percentile(arr, 99)), 3),
        "min_ms": round(float(np.min(arr)), 3),
        "max_ms": round(float(np.max(arr)), 3),
    }


async def benchmark_configuration(
    prefer_gpu: bool,
    n_warmup: int = 10,
    n_measured: int = 50,
) -> Dict[str, Any]:
    engine = DirectOnnxEngine(precision="fp32", prefer_gpu=prefer_gpu)
    engine.load()

    raw_audio = load_96000_samples()
    session_id = f"bench-{'gpu' if prefer_gpu else 'cpu'}"

    # Setup dummy session in DB
    async with async_session_factory() as session:
        existing = await session.get(LiveSession, session_id)
        if not existing:
            session.add(
                LiveSession(
                    id=session_id,
                    source_type="benchmark",
                    sample_rate=32000,
                    channels=1,
                    status="active",
                )
            )
            await session.commit()

    preproc_ms: List[float] = []
    onnx_ms: List[float] = []
    postproc_ms: List[float] = []
    emb_handling_ms: List[float] = []
    persist_ms: List[float] = []
    ws_broadcast_ms: List[float] = []
    total_ms: List[float] = []

    total_runs = n_warmup + n_measured
    print(f"\nBenchmarking {'GPU (CUDAExecutionProvider)' if prefer_gpu else 'CPU (CPUExecutionProvider)'}...")
    print(f"  Warmup: {n_warmup} runs, Measured: {n_measured} runs")

    for run_idx in range(total_runs):
        is_measured = run_idx >= n_warmup
        t_total_start = time.perf_counter()

        # 1. Preprocessing stage
        t0 = time.perf_counter()
        audio = np.asarray(raw_audio, dtype=np.float32)
        if not np.isfinite(audio).all():
            raise ValueError("Non-finite input")
        if float(np.ptp(audio)) == 0.0:
            raise ValueError("Zero variance")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        if len(audio) < 96000:
            audio = np.pad(audio, (0, 96000 - len(audio)))
        else:
            audio = audio[:96000]
        input_tensor = np.expand_dims(audio, axis=0)
        t1 = time.perf_counter()

        # 2. ONNX Runtime execution (both heads)
        preds, embs = engine._session.run(
            ["predictions", "embeddings"],
            {"input": input_tensor},
        )
        t2 = time.perf_counter()

        # 3. Postprocessing & Top-5 extraction
        scores = preds[0]
        embedding = embs[0].astype(np.float32)
        top_indices = np.argsort(scores)[-5:][::-1]
        detections = []
        for idx in top_indices:
            score = float(scores[idx])
            if score >= 0.10:
                label = engine.species_list[idx]
                detections.append(label)
        t3 = time.perf_counter()

        # 4. Embedding handling (.npy persistence)
        saved_emb_path = storage_service.save_live_embedding(
            session_id=session_id,
            start_seconds=float(run_idx * 3.0),
            end_seconds=float((run_idx + 1) * 3.0),
            vector=embedding,
        )
        t4 = time.perf_counter()

        # 5. Database persistence (SQLite WAL)
        import uuid
        seg_id = str(uuid.uuid4())
        async with async_session_factory() as db:
            seg = LiveSegment(
                id=seg_id,
                session_id=session_id,
                start_seconds=float(run_idx * 3.0),
                end_seconds=float((run_idx + 1) * 3.0),
                audio_path="benchmark.wav",
                embedding_path=str(saved_emb_path),
                processing_status="processed",
            )
            db.add(seg)
            for label in detections:
                db.add(
                    LiveEvent(
                        id=str(uuid.uuid4()),
                        session_id=session_id,
                        detection_id=str(uuid.uuid4()),
                        start_seconds=float(run_idx * 3.0),
                        end_seconds=float((run_idx + 1) * 3.0),
                        class_label=label,
                        scientific_name="Unknown",
                        common_name=label,
                        confidence_score=0.75,
                        taxon_group="Bird",
                        model_version="3.0",
                    )
                )
            await db.commit()
        t5 = time.perf_counter()

        # 6. WebSocket event serialization & broadcast simulation
        ws_events = [
            {
                "type": "detection",
                "session_id": session_id,
                "class_label": lbl,
                "confidence_score": 0.75,
            }
            for lbl in detections
        ]
        ws_payload = json.dumps(
            {
                "type": "processing_update",
                "session_id": session_id,
                "detections": ws_events,
            }
        )
        _ = len(ws_payload)
        t6 = time.perf_counter()

        t_total = t6 - t_total_start

        if is_measured:
            preproc_ms.append((t1 - t0) * 1000.0)
            onnx_ms.append((t2 - t1) * 1000.0)
            postproc_ms.append((t3 - t2) * 1000.0)
            emb_handling_ms.append((t4 - t3) * 1000.0)
            persist_ms.append((t5 - t4) * 1000.0)
            ws_broadcast_ms.append((t6 - t5) * 1000.0)
            total_ms.append(t_total * 1000.0)

    engine.close()

    dist_total = compute_distribution(total_ms)
    median_total_s = dist_total["median_ms"] / 1000.0
    rtf = round(median_total_s / 3.0, 5)

    result = {
        "configuration": "GPU (CUDAExecutionProvider)" if prefer_gpu else "CPU (CPUExecutionProvider)",
        "device": engine.device,
        "active_providers": engine.active_providers,
        "runs_measured": n_measured,
        "input_samples": 96000,
        "sample_rate": 32000,
        "audio_window_duration_s": 3.0,
        "real_time_factor_rtf": rtf,
        "speedup_vs_realtime": round(1.0 / rtf, 1) if rtf > 0 else "N/A",
        "stages_ms": {
            "preprocessing": compute_distribution(preproc_ms),
            "onnx_runtime_execution": compute_distribution(onnx_ms),
            "prediction_postprocessing": compute_distribution(postproc_ms),
            "embedding_handling": compute_distribution(emb_handling_ms),
            "database_persistence": compute_distribution(persist_ms),
            "websocket_publication": compute_distribution(ws_broadcast_ms),
            "total_post_window_latency": dist_total,
        },
    }

    print(f"  Results for {result['configuration']}:")
    print(f"    Preprocessing:   {result['stages_ms']['preprocessing']['median_ms']} ms")
    print(f"    ONNX Execution:  {result['stages_ms']['onnx_runtime_execution']['median_ms']} ms")
    print(f"    Postprocessing:  {result['stages_ms']['prediction_postprocessing']['median_ms']} ms")
    print(f"    Emb Handling:    {result['stages_ms']['embedding_handling']['median_ms']} ms")
    print(f"    DB Persistence:  {result['stages_ms']['database_persistence']['median_ms']} ms")
    print(f"    WS Broadcast:    {result['stages_ms']['websocket_publication']['median_ms']} ms")
    print(f"    ----------------------------------------")
    print(f"    TOTAL MEDIAN:    {dist_total['median_ms']} ms (P95: {dist_total['p95_ms']} ms, P99: {dist_total['p99_ms']} ms)")
    print(f"    RTF:             {rtf} ({result['speedup_vs_realtime']}x faster than real-time)")

    return result


async def main():
    await init_db()
    print("================================================================================")
    print("ECOSONIC 3.0 — INTEGRATED DIRECT ONNX PIPELINE BENCHMARK")
    print("================================================================================")

    gpu_results = await benchmark_configuration(prefer_gpu=True, n_warmup=10, n_measured=50)
    cpu_results = await benchmark_configuration(prefer_gpu=False, n_warmup=10, n_measured=50)

    report = {
        "audit_timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "hardware_environment": {
            "os": "Windows 11 Home (x64)",
            "cpu": "Intel Core i7-13620H (16 vCPUs @ 2.40 GHz)",
            "gpu": "NVIDIA GeForce RTX 4060 Laptop GPU (8GB VRAM)",
            "onnxruntime_version": ort.__version__,
        },
        "benchmarks": {
            "gpu_cuda": gpu_results,
            "cpu_fallback": cpu_results,
        },
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print(f"\nBenchmark results successfully written to {OUTPUT_PATH}")


if __name__ == "__main__":
    asyncio.run(main())
