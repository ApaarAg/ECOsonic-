import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional
import uuid

from app.config import settings
from app.core.database import async_session_factory
from app.core.job_manager import JobManager
from app.core.logging import logger
from app.models.analysis import Analysis, EmbeddingSegment
from app.models.detection import Detection
from app.repositories.analysis_repository import AnalysisRepository
from app.repositories.detection_repository import DetectionRepository
from app.services.analysis_pipeline import analysis_pipeline
from app.services.storage_service import storage_service


async def run_analysis_task(analysis_id: str, manager: JobManager) -> None:
    """
    Background worker task that drives the complete end-to-end analysis lifecycle:
    audio validation, normalization, model inference, embedding extraction,
    and database persistence.
    """
    logger.info("Worker started processing analysis [%s]", analysis_id)

    async with async_session_factory() as session:
        analysis_repo = AnalysisRepository(session)
        detection_repo = DetectionRepository(session)

        analysis = await analysis_repo.get_by_id(analysis_id)
        if not analysis:
            logger.error("Analysis [%s] not found in database.", analysis_id)
            return

        raw_path = Path(analysis.audio_path)
        lat = analysis.latitude
        lon = analysis.longitude

        # Progress reporting hook
        async def progress_hook(prog: float, stage: str):
            manager.update_progress(analysis_id, prog, stage)
            await analysis_repo.update_status(
                analysis_id,
                status="processing",
                progress=prog,
                current_stage=stage,
            )
            await session.commit()

        try:
            # Execute pipeline
            (
                processed_meta,
                model_detections,
                embeddings,
                segments,
            ) = await analysis_pipeline.run_pipeline(
                analysis_id=analysis_id,
                raw_audio_path=raw_path,
                latitude=lat,
                longitude=lon,
                progress_callback=progress_hook,
            )

            # Stage: Persist detections in DB
            db_detections: List[Detection] = []
            for d in model_detections:
                det = Detection(
                    id=str(uuid.uuid4()),
                    analysis_id=analysis_id,
                    class_label=d.class_label,
                    scientific_name=d.scientific_name,
                    common_name=d.common_name,
                    taxon_group=d.taxon_group,
                    record_type=d.record_type,
                    start_seconds=d.start_seconds,
                    end_seconds=d.end_seconds,
                    confidence_score=d.confidence_score,
                    geo_score=d.geo_score,
                    review_status="unreviewed",
                )
                db_detections.append(det)

            await detection_repo.create_batch(db_detections)

            # Stage: Create embedding segment records
            db_segments: List[EmbeddingSegment] = []
            for idx, (start_s, end_s) in enumerate(segments):
                # Associate with matching detection in the same time window if available
                matching_det_id = None
                for det in db_detections:
                    if not (det.end_seconds <= start_s or det.start_seconds >= end_s):
                        matching_det_id = det.id
                        break

                seg = EmbeddingSegment(
                    segment_id=str(uuid.uuid4()),
                    analysis_id=analysis_id,
                    vector_index=idx,
                    start_seconds=start_s,
                    end_seconds=end_s,
                    detection_id=matching_det_id,
                )
                db_segments.append(seg)

            await analysis_repo.add_embedding_segments(db_segments)

            # Compute summary metrics
            unique_species = list({d.scientific_name for d in db_detections})
            avg_conf = (
                sum(d.confidence_score for d in db_detections) / len(db_detections)
                if db_detections
                else 0.0
            )
            metrics = {
                "total_detections": len(db_detections),
                "unique_species_count": len(unique_species),
                "species_detected": unique_species,
                "average_confidence": round(avg_conf, 4),
                "embedding_vectors_count": len(segments),
                "rms_amplitude": processed_meta.rms_amplitude,
                "sample_rate": processed_meta.sample_rate,
                "channels": processed_meta.channels,
            }

            processed_path_str = str(storage_service.get_processed_path(analysis_id))
            embedding_path_str = str(storage_service.get_embedding_path(analysis_id))

            # Finalize analysis record
            await analysis_repo.update(
                analysis_id,
                status="completed",
                progress=100.0,
                current_stage="Completed",
                processed_path=processed_path_str,
                embedding_path=embedding_path_str,
                duration_seconds=processed_meta.duration_seconds,
                model_version=settings.MODEL_VERSION,
                metrics_json=metrics,
                error_message=None,
            )
            await session.commit()
            logger.info("Analysis [%s] completed successfully with %d detections.", analysis_id, len(db_detections))

        except Exception as e:
            logger.exception("Analysis [%s] processing failed: %s", analysis_id, e)
            await analysis_repo.update_status(
                analysis_id,
                status="failed",
                progress=0.0,
                current_stage="Failed",
                error_message=str(e),
            )
            await session.commit()
            raise
