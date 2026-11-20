"""Run the actual BirdNET V3.0 model on three attributed recordings."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import time
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import psutil
import soundfile as sf

from backend.app.services.birdnet_engine import (
    AudioValidationError,
    BirdNetEngine,
    EmbeddingBatch,
)

logger = logging.getLogger("birdnet_smoke_test")


def package_version(name: str) -> str | None:
    try:
        return version(name)
    except PackageNotFoundError:
        return None


def hardware_report(root: Path) -> dict[str, Any]:
    """Collect host details plus NVIDIA-SMI data when available."""
    gpu = None
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,driver_version,memory.total",
                "--format=csv,noheader",
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            gpu = result.stdout.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired):
        gpu = None
    disk = shutil.disk_usage(root)
    memory = psutil.virtual_memory()
    return {
        "operating_system": platform.platform(),
        "machine": platform.machine(),
        "cpu_count_logical": psutil.cpu_count(logical=True),
        "cpu_count_physical": psutil.cpu_count(logical=False),
        "system_ram_total_bytes": int(memory.total),
        "system_ram_available_bytes": int(memory.available),
        "gpu_from_nvidia_smi": gpu,
        "workspace_disk_free_bytes": int(disk.free),
    }


def recording_metadata(audio_path: Path) -> dict[str, Any]:
    info = sf.info(audio_path)
    return {
        "duration_s": float(info.duration),
        "sample_rate_hz": int(info.samplerate),
        "channels": int(info.channels),
        "frames": int(info.frames),
        "subtype": info.subtype,
        "format": info.format,
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def case_rejected(
    engine: BirdNetEngine,
    name: str,
    path: Path,
    expected_phrase: str,
) -> dict[str, Any]:
    try:
        engine.predict(path)
    except AudioValidationError as exc:
        message = str(exc)
        if expected_phrase not in message:
            return {
                "case": name,
                "status": "FAIL",
                "error": f"Unexpected validation message: {message}",
            }
        return {
            "case": name,
            "status": "PASS",
            "handled_before_inference": True,
            "message": message,
        }
    except Exception as exc:
        return {
            "case": name,
            "status": "FAIL",
            "error": f"Unexpected {type(exc).__name__}: {exc}",
        }
    return {
        "case": name,
        "status": "FAIL",
        "error": "Invalid test input was accepted by validation.",
    }


def numerical_edge_cases(
    engine: BirdNetEngine,
    normal_status: dict[str, Any],
) -> list[dict[str, Any]]:
    """Verify normal audio passes and degenerate audio is rejected safely."""
    results = [normal_status]
    rate = 32_000
    with tempfile.TemporaryDirectory(prefix="ecosonic-birdnet-") as temp_dir:
        temp = Path(temp_dir)
        sf.write(temp / "digital_silence.wav", np.zeros(rate, dtype=np.float32), rate)
        sf.write(
            temp / "constant_value.wav",
            np.full(rate, 0.25, dtype=np.float32),
            rate,
        )
        short_n = 320  # 10 ms: deliberately too short for a useful classification.
        short = np.sin(2 * np.pi * 440 * np.arange(short_n) / rate).astype(np.float32)
        sf.write(temp / "extremely_short.wav", short, rate)
        results.append(
            case_rejected(
                engine,
                "digital_silence",
                temp / "digital_silence.wav",
                "zero variance",
            )
        )
        results.append(
            case_rejected(
                engine,
                "constant_valued_input",
                temp / "constant_value.wav",
                "zero variance",
            )
        )
        results.append(
            case_rejected(
                engine,
                "extremely_short_input",
                temp / "extremely_short.wav",
                "too short",
            )
        )
    return results


def top_detections(predictions: pd.DataFrame) -> list[dict[str, Any]]:
    best_by_class = predictions.loc[
        predictions.groupby("species_name")["confidence"].idxmax()
    ]
    top = best_by_class.sort_values("confidence", ascending=False).head(5)
    return [
        {
            "class": str(row.species_name),
            "score": float(row.confidence),
            "start_time_s": float(row.start_time),
            "end_time_s": float(row.end_time),
        }
        for row in top.itertuples(index=False)
    ]


def load_sources(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        sources = json.load(handle)["recordings"]
    if len(sources) != 3:
        raise ValueError(f"Expected exactly three source records; found {len(sources)}")
    return sources


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cpu",
        action="store_true",
        help="Force CPU inference even when CUDAExecutionProvider is available.",
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[2]
    audio_dir = root / "backend" / "data" / "smoke_audio"
    source_path = audio_dir / "sources.json"
    results_dir = root / "backend" / "test_results"
    results_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("BIRDNET_APP_DATA", str(root / ".model_cache"))
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    report: dict[str, Any] = {
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "python_version": platform.python_version(),
        "python_executable": sys.executable,
        "package_versions": {
            name: package_version(name)
            for name in (
                "birdnet",
                "onnxruntime",
                "onnxruntime-gpu",
                "numpy",
                "pandas",
                "scipy",
                "soundfile",
                "librosa",
                "psutil",
            )
        },
        "hardware": hardware_report(root),
        "model": None,
        "recordings": [],
        "edge_case_tests": [],
        "results_files": {
            "predictions_csv": str((results_dir / "predictions.csv").relative_to(root)),
            "embeddings_npz": str((results_dir / "embeddings.npz").relative_to(root)),
        },
        "overall_status": "FAIL",
    }

    try:
        sources = load_sources(source_path)
        engine = BirdNetEngine(precision="fp32", prefer_gpu=not args.cpu)
        engine.load()
        report["model"] = engine.inspect()
        report["model"]["release_status"] = "official final V3.0 model family"
        report["model"]["artifact_release"] = "3.0.0 (Zenodo record 24162518)"
        report["model"]["newer_artifact_note"] = (
            "3.0.1 was published 2026-11-19 with unchanged weights/classes/labels "
            "and ONNX export fixes; BirdNET 1.5.0 pins the 3.0.0 file."
        )
        report["model"]["model_license"] = "Apache-2.0"
        report["model"]["acceptable_use_policy"] = (
            "BirdNET model acceptable-use policy applies separately."
        )
        report["model"]["library_license"] = "MIT"

        prediction_frames: list[pd.DataFrame] = []
        embedding_arrays: dict[str, np.ndarray] = {}
        first_normal_case: dict[str, Any] | None = None
        failures = 0

        for source in sources:
            audio_path = audio_dir / source["file"]
            record: dict[str, Any] = {
                **source,
                "local_file": str(audio_path.relative_to(root)),
                "status": "FAIL",
            }
            try:
                record["audio"] = recording_metadata(audio_path)
                record["audio"]["sha256"] = sha256_file(audio_path)

                started = time.perf_counter()
                predictions = engine.predict(audio_path)
                prediction_s = time.perf_counter() - started
                started = time.perf_counter()
                embeddings: EmbeddingBatch = engine.encode(audio_path)
                encoding_s = time.perf_counter() - started
                validation = engine.validate_output(predictions, embeddings)

                predictions.insert(0, "recording_id", source["recording_id"])
                prediction_frames.append(predictions)
                embedding_arrays[f"{source['recording_id']}__vectors"] = embeddings.vectors
                embedding_arrays[f"{source['recording_id']}__start_time_s"] = (
                    embeddings.segments["start_time"].to_numpy(dtype=np.float64)
                )
                embedding_arrays[f"{source['recording_id']}__end_time_s"] = (
                    embeddings.segments["end_time"].to_numpy(dtype=np.float64)
                )

                unique_windows = embeddings.segments[["start_time", "end_time"]]
                record.update(
                    {
                        "status": "PASS",
                        "requested_inference_device": engine.device,
                        "adapter_provider_fallback_reason": engine.provider_fallback_reason,
                        "prediction_output_schema": validation,
                        "prediction_time_range_s": {
                            "first_start": float(predictions["start_time"].min()),
                            "last_end": float(predictions["end_time"].max()),
                        },
                        "embedding_segment_time_range_s": {
                            "first_start": float(unique_windows["start_time"].min()),
                            "last_end": float(unique_windows["end_time"].max()),
                        },
                        "inference_duration_s": {
                            "predict": prediction_s,
                            "encode": encoding_s,
                            "combined": prediction_s + encoding_s,
                        },
                        "top_detections": top_detections(predictions),
                    }
                )
                if first_normal_case is None:
                    first_normal_case = {
                        "case": "normal_environmental_audio",
                        "status": "PASS",
                        "actual_model_inference": True,
                        "prediction_finite": bool(
                            np.isfinite(
                                predictions["confidence"].to_numpy(dtype=np.float64)
                            ).all()
                        ),
                        "embedding_finite": bool(np.isfinite(embeddings.vectors).all()),
                        "recording_id": source["recording_id"],
                    }
                logger.info(
                    "%s: %d rows, %d embeddings %s, %.3fs predict + %.3fs encode",
                    source["recording_id"],
                    len(predictions),
                    len(embeddings.vectors),
                    embeddings.vectors.shape,
                    prediction_s,
                    encoding_s,
                )
            except Exception as exc:
                failures += 1
                record["error"] = f"{type(exc).__name__}: {exc}"
                logger.exception("Smoke test failed for %s", source["recording_id"])
            report["recordings"].append(record)

        if first_normal_case is not None:
            report["edge_case_tests"] = numerical_edge_cases(engine, first_normal_case)
        else:
            report["edge_case_tests"] = [
                {
                    "case": "normal_environmental_audio",
                    "status": "BLOCKED",
                    "error": "No recording completed inference.",
                }
            ]

        if prediction_frames:
            all_predictions = pd.concat(prediction_frames, ignore_index=True)
            all_predictions.to_csv(results_dir / "predictions.csv", index=False)
        if embedding_arrays:
            np.savez_compressed(results_dir / "embeddings.npz", **embedding_arrays)

        edge_failures = sum(
            item["status"] != "PASS" for item in report["edge_case_tests"]
        )
        all_recordings_pass = len(report["recordings"]) == 3 and all(
            item["status"] == "PASS" for item in report["recordings"]
        )
        report["overall_status"] = (
            "PASS" if all_recordings_pass and edge_failures == 0 and failures == 0 else "FAIL"
        )
    except Exception as exc:
        report["fatal_error"] = f"{type(exc).__name__}: {exc}"
        logger.exception("BirdNET smoke test could not complete")

    report["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    report_path = results_dir / "birdnet_smoke_test.json"
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8")
    print(
        json.dumps(
            {"overall_status": report["overall_status"], "report": str(report_path)},
            indent=2,
        )
    )
    return 0 if report["overall_status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())

