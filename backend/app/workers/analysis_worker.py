"""Background analysis lifecycle with transactional result publication."""

from __future__ import annotations

import asyncio
import sys
import time
import uuid
from pathlib import Path
from typing import List

import numpy as np
import psutil
import soundfile as sf

from app.config import settings
from app.core.database import async_session_factory
from app.core.job_manager import JobManager
from app.core.logging import logger
from app.models.analysis import Analysis, EmbeddingSegment
from app.models.detection import Detection
from app.repositories.analysis_repository import AnalysisRepository
from app.repositories.detection_repository import DetectionRepository
from app.services.analysis_pipeline import analysis_pipeline
from app.services.ecological_analysis_service import ecological_analysis_service
from app.services.storage_service import storage_service


def _peak_rss_bytes(process: psutil.Process) -> int:
    """Return OS high-water RSS when available, otherwise current RSS."""
    memory = process.memory_info()
    windows_peak = getattr(memory, "peak_wset", None)
    if windows_peak is not None:
        return int(windows_peak)
    try:
        import resource
        high_water = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        # macOS reports bytes; Linux and other supported Unix targets report KiB.
        return int(high_water if sys.platform == "darwin" else high_water * 1024)
    except (ImportError, AttributeError, OSError):
        return int(memory.rss)


async def run_analysis_task(analysis_id: str, manager: JobManager) -> None:
    started = time.perf_counter()
    process = psutil.Process()
    failed_stage = "queued"
    stage_history: list[str] = ["queued"]
    embedding_path: Path | None = None
    async with async_session_factory() as session:
        analysis_repo = AnalysisRepository(session)
        detection_repo = DetectionRepository(session)
        analysis = None
        for _ in range(5):
            analysis = await analysis_repo.get_by_id(analysis_id)
            if analysis is not None:
                break
            await asyncio.sleep(0.05)

        if analysis is None:
            logger.error("Analysis %s disappeared before processing", analysis_id)
            raise RuntimeError(f"Analysis {analysis_id} not found in database.")

        async def progress(stage: str, percent: float) -> None:
            nonlocal failed_stage
            failed_stage = stage
            if not stage_history or stage_history[-1] != stage:
                stage_history.append(stage)
            manager.update_progress(analysis_id, percent, stage)
            await analysis_repo.update_status(
                analysis_id, status="processing", progress=percent, current_stage=stage
            )
            await session.commit()

        try:
            if analysis_pipeline.engine is None:
                raise RuntimeError("Real BirdNET model is unavailable; analysis cannot run.")
            (processed_meta, detections, processed_path, timings,
             provider, model_load_seconds) = await analysis_pipeline.run_pipeline(
                analysis_id, Path(analysis.audio_path), analysis.latitude,
                analysis.longitude, progress
            )

            failed_stage = "saving_detections"
            await progress(failed_stage, 75)
            db_detections: List[Detection] = []
            for item in detections:
                db_detections.append(Detection(
                    id=str(uuid.uuid4()), analysis_id=analysis_id,
                    class_label=item.class_label, scientific_name=item.scientific_name,
                    common_name=item.common_name, taxon_group=item.taxon_group,
                    record_type=item.record_type, start_seconds=item.start_seconds,
                    end_seconds=item.end_seconds, confidence_score=item.confidence_score,
                    geo_score=None, review_status="unreviewed",
                ))
            failed_stage = "extracting_embeddings"
            await progress(failed_stage, 82)
            vectors, segments, encoding_seconds = await asyncio.to_thread(
                analysis_pipeline.extract_embeddings, processed_path,
                processed_meta.duration_seconds,
            )
            prediction_windows = {
                (round(d.start_seconds, 6), round(d.end_seconds, 6)) for d in detections
            }
            embedding_windows = {(round(start, 6), round(end, 6)) for start, end in segments}
            if not embedding_windows or not embedding_windows.issuperset(prediction_windows):
                raise ValueError("Prediction timestamps do not align with embedding segments.")
            timings["encoding_seconds"] = encoding_seconds

            failed_stage = "saving_embeddings"
            await progress("saving_embeddings", 90)
            db_segments = []
            detection_windows = [
                (d.start_seconds, d.end_seconds, d.id) for d in db_detections
            ]
            for index, (start_s, end_s) in enumerate(segments):
                if index >= len(vectors) or start_s < 0 or end_s <= start_s:
                    raise ValueError("Embedding segment metadata is invalid.")
                match_id = next((det_id for det_start, det_end, det_id in detection_windows
                                 if det_start < end_s and det_end > start_s), None)
                db_segments.append(EmbeddingSegment(
                    segment_id=str(uuid.uuid4()), analysis_id=analysis_id,
                    vector_index=index, start_seconds=start_s, end_seconds=end_s,
                    detection_id=match_id,
                ))
            if len(db_segments) != len(vectors):
                raise ValueError("Embedding vector count does not match segment metadata.")
            embedding_path = await asyncio.to_thread(
                storage_service.save_embeddings, analysis_id, vectors
            )

            # Publish all database result rows in the same transaction as the
            # final completed state. If inference, encoding, or persistence
            # fails, users never see a partial set of detections/segments.
            failed_stage = "ecological_synthesis"
            await progress(failed_stage, 95)

            def _read_processed_mono() -> np.ndarray | None:
                try:
                    samples, _ = sf.read(str(processed_path), dtype="float32")
                    if samples.ndim > 1:
                        samples = np.mean(samples, axis=1)
                    return samples
                except Exception as read_exc:
                    logger.warning("Could not read processed WAV %s for soundscape: %s", processed_path, read_exc)
                    return None

            processed_audio = await asyncio.to_thread(_read_processed_mono)
            eco_started = time.perf_counter()
            ecological_summary = await ecological_analysis_service.build_analysis_ecology(
                analysis_id=analysis_id,
                filename=analysis.filename,
                duration_seconds=processed_meta.duration_seconds,
                sample_rate=processed_meta.sample_rate,
                channels=processed_meta.channels,
                latitude=analysis.latitude,
                longitude=analysis.longitude,
                recorded_at=analysis.recorded_at,
                model_version=analysis.model_version or settings.MODEL_VERSION,
                execution_provider=provider,
                raw_detections=detections,
                processed_audio=processed_audio,
            )
            timings["ecological_synthesis_seconds"] = time.perf_counter() - eco_started

            # Populate geo_score cleanly on biological detections using the already-cached Geo prior
            expected_by_sci = {
                str(item.get("scientific_name", "")).strip().lower(): float(item["occurrence_score"])
                for item in (ecological_summary.get("expected_species", {}).get("expected_species") or [])
                if item.get("scientific_name") and item.get("occurrence_score") is not None
            }
            if expected_by_sci:
                for det_row in db_detections:
                    if det_row.record_type == "animal" and det_row.scientific_name:
                        sci_key = det_row.scientific_name.strip().lower()
                        if sci_key in expected_by_sci:
                            det_row.geo_score = round(expected_by_sci[sci_key], 4)

            db_started = time.perf_counter()
            await detection_repo.create_batch(db_detections)
            await analysis_repo.add_embedding_segments(db_segments)
            timings["database_insertion_seconds"] = time.perf_counter() - db_started
            timings["total_analysis_seconds"] = time.perf_counter() - started

            sp_sum = ecological_summary.get("species", {}).get("summary", {})
            dist_sec = ecological_summary.get("disturbance", {})
            exp_sec = ecological_summary.get("expected_species", {})
            gap_cov = ecological_summary.get("observation_gap", {}).get("coverage", {})
            metrics = {
                "total_detections": len(db_detections),
                "unique_classes": len({d.class_label for d in db_detections}),
                "biological_detections_count": sp_sum.get("biological_detection_count", 0),
                "unique_biological_species": sp_sum.get("unique_biological_species", 0),
                "non_biological_detections_count": sp_sum.get("non_biological_detection_count", 0),
                "unknown_detections_count": sp_sum.get("unknown_detection_count", 0),
                "disturbance_index": dist_sec.get("disturbance_index"),
                "expected_species_status": exp_sec.get("expected_species_status"),
                "acoustic_coverage_ratio": gap_cov.get("coverage_ratio"),
                "average_confidence": round(float(np.mean([d.confidence_score for d in db_detections])) if db_detections else 0.0, 4),
                "embedding_vectors_count": len(vectors),
                "embedding_shape": list(vectors.shape),
                "embedding_dtype": str(vectors.dtype),
                "sample_rate": processed_meta.sample_rate,
                "channels": processed_meta.channels,
                "execution_provider": provider,
                "stage_history": [*stage_history, "completed"],
                "model_initialization_seconds": model_load_seconds,
                "timings": timings,
                "peak_rss_bytes": _peak_rss_bytes(process),
            }
            await analysis_repo.update(
                analysis_id, status="completed", progress=100.0,
                current_stage="completed",
                processed_path=str(storage_service.get_processed_path(analysis_id)),
                embedding_path=str(embedding_path),
                duration_seconds=processed_meta.duration_seconds,
                model_version=settings.MODEL_VERSION,
                metrics_json=metrics,
                ecological_summary_json=ecological_summary,
                error_message=None,
            )
            await session.commit()
            manager.update_progress(analysis_id, 100.0, "completed")
            logger.info("Analysis %s completed with %s detections", analysis_id, len(db_detections))
        except Exception as exc:
            logger.exception("Analysis %s failed during %s", analysis_id, failed_stage)
            await session.rollback()
            if embedding_path is not None:
                embedding_path.unlink(missing_ok=True)
            safe_message = f"{type(exc).__name__} during {failed_stage}"[:240]
            await analysis_repo.update_status(
                analysis_id, status="failed", progress=0.0,
                current_stage=f"failed:{failed_stage}"[:100],
                error_message=safe_message,
            )
            await session.commit()
            manager.update_progress(analysis_id, 0.0, f"failed:{failed_stage}")
            raise
