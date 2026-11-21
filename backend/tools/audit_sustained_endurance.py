"""Sustained Live Audio Endurance and Stability Audit for EcoSonic 3.0."""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import psutil
import soundfile as sf
from sqlalchemy import select

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
if str(PROJECT_ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from app.core.database import async_session_factory, init_db
from app.models.live_session import LiveEvent, LiveSegment, LiveSession
from app.services.analysis_pipeline import analysis_pipeline
from app.services.birdnet_engine import _ensure_model_cache_env, _prepare_windows_cuda_dll_path
from app.services.live.embedding_worker import embedding_worker
from app.services.live.session_manager import LiveSessionManager
from app.services.soundscape.soundscape_worker import soundscape_worker

_ensure_model_cache_env()
_prepare_windows_cuda_dll_path()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("audit_endurance")

SMOKE_AUDIO_PATH = PROJECT_ROOT / "backend" / "data" / "smoke_audio" / "birds_forest.ogg"
RESULTS_OUTPUT_PATH = PROJECT_ROOT / "docs" / "audit_sustained_endurance_results.json"


def get_vram_usage_mb() -> Optional[float]:
    try:
        res = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=2.0,
            check=False,
        )
        if res.returncode == 0 and res.stdout.strip():
            return float(res.stdout.strip().split("\n")[0])
    except Exception:
        pass
    return None


def audit_physical_microphone() -> Dict[str, Any]:
    """Inspect system physical audio input devices without crashing in headless/CI environments."""
    try:
        import sounddevice as sd

        devices = sd.query_devices()
        input_devices = [
            {
                "index": i,
                "name": dev["name"],
                "channels": dev["max_input_channels"],
                "default_samplerate": dev["default_samplerate"],
            }
            for i, dev in enumerate(devices)
            if dev.get("max_input_channels", 0) > 0
        ]
        default_in = sd.default.device[0] if sd.default.device else None
        return {
            "status": "PASS" if input_devices else "PARTIAL",
            "available_input_devices_count": len(input_devices),
            "default_input_device_index": default_in,
            "devices": input_devices[:5],
            "notes": (
                "Physical microphone hardware discovered."
                if input_devices
                else "No physical audio input devices found in this host environment."
            ),
        }
    except Exception as exc:
        return {
            "status": "NOT TESTED",
            "available_input_devices_count": 0,
            "error": str(exc),
            "notes": "sounddevice library unavailable or audio subsystem query failed.",
        }


async def run_sustained_endurance_test(
    duration_seconds: float = 300.0,
) -> Dict[str, Any]:
    logger.info("============================================================")
    logger.info("STARTING SUSTAINED ENDURANCE TEST (Duration: %.1fs)", duration_seconds)
    logger.info("============================================================")

    await init_db()
    analysis_pipeline.load()
    await embedding_worker.start()
    await soundscape_worker.start()

    data, sr = sf.read(str(SMOKE_AUDIO_PATH), dtype="float32")
    if data.ndim > 1:
        data = np.mean(data, axis=1)
    if sr != 32000:
        import scipy.signal
        gcd = math.gcd(sr, 32000)
        data = scipy.signal.resample_poly(data, 32000 // gcd, sr // gcd).astype(np.float32)

    manager = LiveSessionManager()
    session_id = str(uuid.uuid4())

    async with async_session_factory() as session:
        db_sess = LiveSession(
            id=session_id,
            source_type="file_replay",
            device_id="audit_endurance_source",
            sample_rate=32000,
            channels=1,
            status="active",
        )
        session.add(db_sess)
        await session.commit()

    state = await manager.create_session(
        session_id=session_id,
        sample_rate=32000,
        channels=1,
        window_duration_s=3.0,
        hop_duration_s=3.0,
    )

    received_events = []

    async def event_handler(evt: Dict[str, Any]) -> None:
        received_events.append(evt)

    state.inference_worker.event_callback = event_handler
    await manager.start_session(session_id)

    chunk_samples = 8000  # 250ms chunks @ 32 kHz
    total_audio_samples = len(data)

    seq = 0
    pos = 0
    t_start = time.perf_counter()
    proc = psutil.Process()

    ram_samples: List[float] = []
    cpu_samples: List[float] = []
    vram_samples: List[float] = []
    queue_depth_samples: List[int] = []
    timestamps: List[float] = []

    try:
        while (time.perf_counter() - t_start) < duration_seconds:
            t_chunk_start = time.perf_counter()
            if pos >= total_audio_samples:
                pos = 0

            end_pos = min(pos + chunk_samples, total_audio_samples)
            chunk = data[pos:end_pos]
            if len(chunk) < chunk_samples:
                chunk = np.pad(chunk, (0, chunk_samples - len(chunk)))

            pcm16 = (np.clip(chunk, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
            ok, warn = await manager.ingest_audio_frame(session_id, seq, pcm16)

            seq += 1
            pos += chunk_samples

            # Sample metrics every 1 second (4 chunks)
            if seq % 4 == 0:
                elapsed = time.perf_counter() - t_start
                timestamps.append(round(elapsed, 2))
                ram_mb = proc.memory_info().rss / (1024 * 1024)
                ram_samples.append(round(ram_mb, 2))
                cpu_samples.append(round(proc.cpu_percent(), 2))
                vram = get_vram_usage_mb()
                if vram is not None:
                    vram_samples.append(round(vram, 2))
                queue_depth_samples.append(state.inference_worker.queue_size)

                if int(elapsed) % 30 == 0:
                    logger.info(
                        "Elapsed: %.1fs | RAM: %.1f MB | VRAM: %s MB | Queue: %d | Windows Dropped: %d",
                        elapsed,
                        ram_mb,
                        f"{vram:.1f}" if vram else "N/A",
                        state.inference_worker.queue_size,
                        state.inference_worker.dropped_windows,
                    )

            # Real-time pacing
            elapsed_chunk = time.perf_counter() - t_chunk_start
            wait_s = max(0.0, 0.25 - elapsed_chunk)
            if wait_s > 0:
                await asyncio.sleep(wait_s)

        # Allow trailing queue to settle
        await asyncio.sleep(2.0)
    finally:
        logger.info("Stopping live session %s...", session_id)
        await manager.stop_session(session_id)
        await embedding_worker.stop()
        await soundscape_worker.stop()

    total_test_duration = time.perf_counter() - t_start
    ram_trend = (
        (ram_samples[-1] - ram_samples[0])
        if len(ram_samples) >= 2
        else 0.0
    )

    # Check database persistence
    async with async_session_factory() as session:
        seg_res = await session.execute(
            select(LiveSegment).where(LiveSegment.session_id == session_id)
        )
        saved_segments = seg_res.scalars().all()
        evt_res = await session.execute(
            select(LiveEvent).where(LiveEvent.session_id == session_id)
        )
        saved_events = evt_res.scalars().all()

    detections = [e for e in received_events if e.get("type") == "detection"]
    warnings = [e for e in received_events if "warning" in e.get("type", "")]

    logger.info("============================================================")
    logger.info("SUSTAINED ENDURANCE TEST COMPLETED")
    logger.info("  Duration:             %.1fs", total_test_duration)
    logger.info("  Frames Sent:          %d", seq)
    logger.info("  Frames Dropped:       %d", state.dropped_frames)
    logger.info("  Windows Processed:    %d", state.inference_worker.processed_windows)
    logger.info("  Windows Dropped:      %d", state.inference_worker.dropped_windows)
    logger.info("  Detections Count:     %d", len(detections))
    logger.info("  Warnings Count:       %d", len(warnings))
    logger.info("  Initial RAM:          %.2f MB", ram_samples[0] if ram_samples else 0.0)
    logger.info("  Final RAM:            %.2f MB", ram_samples[-1] if ram_samples else 0.0)
    logger.info("  RAM Growth (Delta):   %.2f MB", ram_trend)
    logger.info("  Peak RAM:             %.2f MB", max(ram_samples) if ram_samples else 0.0)
    logger.info("  Peak VRAM:            %.2f MB", max(vram_samples) if vram_samples else 0.0)
    logger.info("  Segments in DB:       %d", len(saved_segments))
    logger.info("  Events in DB:         %d", len(saved_events))
    logger.info("============================================================")

    return {
        "duration_seconds": round(total_test_duration, 2),
        "total_frames_sent": seq,
        "dropped_frames": state.dropped_frames,
        "processed_windows": state.inference_worker.processed_windows,
        "dropped_windows": state.inference_worker.dropped_windows,
        "detections_broadcast_count": len(detections),
        "warnings_broadcast_count": len(warnings),
        "db_segments_count": len(saved_segments),
        "db_events_count": len(saved_events),
        "avg_inference_latency_ms": round(state.inference_worker.avg_inference_latency_ms, 2),
        "avg_window_lag_ms": round(state.inference_worker.avg_window_lag_ms, 2),
        "ram_metrics_mb": {
            "initial_rss": ram_samples[0] if ram_samples else None,
            "final_rss": ram_samples[-1] if ram_samples else None,
            "peak_rss": max(ram_samples) if ram_samples else None,
            "growth_delta": round(ram_trend, 2),
            "is_bounded": bool(ram_trend < 100.0),
        },
        "vram_metrics_mb": {
            "initial": vram_samples[0] if vram_samples else None,
            "peak": max(vram_samples) if vram_samples else None,
        },
        "cpu_metrics_pct": {
            "mean": round(float(np.mean(cpu_samples)), 2) if cpu_samples else None,
            "peak": round(float(np.max(cpu_samples)), 2) if cpu_samples else None,
        },
        "queue_depth_max": max(queue_depth_samples) if queue_depth_samples else 0,
        "graceful_shutdown_success": True,
    }


async def main() -> None:
    mic_audit = audit_physical_microphone()
    # 120 seconds (2 minutes) sustained endurance run
    endurance_results = await run_sustained_endurance_test(duration_seconds=120.0)

    report = {
        "audit_timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "physical_microphone_audit": mic_audit,
        "sustained_endurance_results": endurance_results,
    }

    with open(RESULTS_OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    logger.info("Endurance results saved to %s", RESULTS_OUTPUT_PATH)


if __name__ == "__main__":
    asyncio.run(main())
