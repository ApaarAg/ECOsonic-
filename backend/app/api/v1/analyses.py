from datetime import datetime
import math
from typing import Optional
import uuid
import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse

from app.config import settings
from app.core.exceptions import AudioValidationError, ResourceNotFoundError
from app.core.job_manager import job_manager
from app.core.logging import logger
from app.dependencies import get_analysis_repository
from app.models.analysis import Analysis
from app.repositories.analysis_repository import AnalysisRepository
from app.schemas.analysis import (
    AnalysisDetailResponse,
    AnalysisResponse,
    AnalysisStatusResponse,
)
from app.schemas.detection import DetectionResponse
from app.schemas.common import MessageResponse, PaginatedResponse
from app.services.audio_processor import audio_processor
from app.services.storage_service import storage_service
from app.workers.analysis_worker import run_analysis_task

router = APIRouter(prefix="/analyses", tags=["Analyses"])


@router.get("/{analysis_id}/results", summary="Retrieve persisted analysis results")
async def get_analysis_results(
    analysis_id: str,
    repo: AnalysisRepository = Depends(get_analysis_repository),
):
    analysis = await repo.get_by_id(analysis_id, load_relations=True)
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found.")
    if analysis.status != "completed":
        raise HTTPException(status_code=409, detail=f"Analysis results are not ready (status: {analysis.status}).")

    try:
        vectors = storage_service.load_embeddings(analysis_id)
    except Exception as e:
        logger.error("Corrupted embedding artifact for analysis %s: %s", analysis_id, e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Backing embedding artifact is unreadable or corrupted: {e}",
        )

    if vectors is None:
        logger.error("Missing embedding artifact for completed analysis %s", analysis_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Backing embedding artifact is missing on disk.",
        )

    if (
        vectors.ndim != 2
        or vectors.shape[1] != 1280
        or not np.isfinite(vectors).all()
        or len(vectors) != len(analysis.embedding_segments)
    ):
        logger.error("Invalid embedding artifact for analysis %s: shape=%s", analysis_id, getattr(vectors, "shape", None))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Backing embedding artifact is corrupted, non-finite, or inconsistent with database segments.",
        )

    eco = analysis.ecological_summary_json or {}
    return {
        "analysis_id": analysis.id,
        "status": analysis.status,
        "filename": analysis.filename,
        "latitude": analysis.latitude,
        "longitude": analysis.longitude,
        "gps_accuracy_m": analysis.gps_accuracy_m,
        "gps_captured_at": analysis.gps_captured_at.isoformat() if analysis.gps_captured_at else None,
        "recorded_at": analysis.recorded_at.isoformat() if analysis.recorded_at else None,
        "duration_seconds": analysis.duration_seconds,
        "metrics": analysis.metrics_json,
        "detections": [DetectionResponse.model_validate(d) for d in analysis.detections],
        "species": eco.get("species"),
        "disturbance": eco.get("disturbance"),
        "context": eco.get("context"),
        "geospatial_context": eco.get("geospatial_context"),
        "expected_species": eco.get("expected_species"),
        "observation_gap": eco.get("observation_gap"),
        "soundscape": eco.get("soundscape"),
        "ecological_summary": analysis.ecological_summary_json,
        "embeddings": {
            "path": analysis.embedding_path,
            "shape": list(vectors.shape),
            "dtype": str(vectors.dtype),
            "segments": [
                {"vector_index": row.vector_index, "start_seconds": row.start_seconds,
                 "end_seconds": row.end_seconds, "segment_id": row.segment_id,
                 "detection_id": row.detection_id}
                for row in sorted(analysis.embedding_segments, key=lambda x: x.vector_index)
            ],
        },
    }


@router.get("/{analysis_id}/detections", summary="List persisted detections for an analysis")
async def get_analysis_detections(
    analysis_id: str,
    repo: AnalysisRepository = Depends(get_analysis_repository),
):
    analysis = await repo.get_by_id(analysis_id, load_relations=True)
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found.")
    if analysis.status != "completed":
        raise HTTPException(status_code=409, detail=f"Analysis results are not ready (status: {analysis.status}).")
    return [DetectionResponse.model_validate(d) for d in analysis.detections]


@router.post(
    "",
    response_model=AnalysisResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Upload audio and initiate bioacoustic analysis",
)
async def create_analysis(
    file: UploadFile = File(..., description="Audio file (WAV, MP3, FLAC, OGG, M4A)"),
    latitude: Optional[float] = Form(None, ge=-90.0, le=90.0),
    longitude: Optional[float] = Form(None, ge=-180.0, le=180.0),
    gps_accuracy_m: Optional[float] = Form(None, ge=0.0),
    gps_captured_at: Optional[datetime] = Form(None),
    recorded_at: Optional[datetime] = Form(None),
    model_version: Optional[str] = Form(settings.MODEL_VERSION),
    repo: AnalysisRepository = Depends(get_analysis_repository),
):
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file must have a valid filename.",
        )

    if (latitude is None) != (longitude is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Both latitude and longitude must be provided together.",
        )
    if latitude is not None and (not math.isfinite(latitude) or not math.isfinite(longitude)):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Geographic coordinates must be finite numbers.",
        )
    if gps_accuracy_m is not None and (not math.isfinite(gps_accuracy_m) or gps_accuracy_m < 0):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="GPS accuracy must be a finite non-negative number.",
        )

    # 1. Validate extension
    try:
        ext = audio_processor.validate_extension(file.filename)
    except AudioValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    analysis_id = str(uuid.uuid4())
    raw_dest = storage_service.get_raw_path(analysis_id, file.filename)

    # 2. Save stream and enforce size limits
    try:
        size_bytes = await storage_service.save_upload_stream(
            file.file, raw_dest, max_bytes=settings.MAX_UPLOAD_SIZE_BYTES
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=str(e)
        )
    except Exception as e:
        logger.exception("Failed to write uploaded file stream: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to persist uploaded audio: {e}",
        )

    # 3. Validate header magic bytes & audio integrity
    try:
        audio_processor.validate_mime_and_magic(raw_dest, ext, file.content_type)
        preliminary_meta = audio_processor.inspect_audio(raw_dest)
        if preliminary_meta.is_empty:
            raise AudioValidationError("Audio file contains only silence or is empty.")
    except AudioValidationError as e:
        # Cleanup uploaded raw file if invalid
        storage_service.delete_analysis_files(analysis_id)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # 4. Create analysis database record
    analysis = Analysis(
        id=analysis_id,
        filename=file.filename,
        audio_path=str(raw_dest),
        status="queued",
        progress=0.0,
        current_stage="Queued",
        duration_seconds=preliminary_meta.duration_seconds,
        latitude=latitude,
        longitude=longitude,
        gps_accuracy_m=gps_accuracy_m,
        gps_captured_at=gps_captured_at,
        recorded_at=recorded_at,
        model_version=model_version,
    )
    await repo.create(analysis)

    # 5. Dispatch background task via job manager
    job_manager.register_job(analysis_id)
    await job_manager.run_job(analysis_id, run_analysis_task)

    logger.info("Analysis [%s] successfully queued for file '%s'.", analysis_id, file.filename)
    return analysis


@router.get(
    "",
    response_model=PaginatedResponse[AnalysisResponse],
    summary="List analyses with pagination and status filtering",
)
async def list_analyses(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Page size"),
    status: Optional[str] = Query(None, description="Filter by status (queued, processing, completed, failed)"),
    repo: AnalysisRepository = Depends(get_analysis_repository),
):
    skip = (page - 1) * page_size
    items, total = await repo.list(skip=skip, limit=page_size, status=status)
    total_pages = (total + page_size - 1) // page_size if total > 0 else 0

    serialized_items = []
    for item in items:
        resp = AnalysisResponse.model_validate(item)
        resp.detections_count = len(item.detections or [])
        serialized_items.append(resp)

    return PaginatedResponse(
        items=serialized_items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get(
    "/{analysis_id}",
    response_model=AnalysisDetailResponse,
    summary="Get full analysis details with detections, embedding segments, and persisted ecological intelligence",
)
async def get_analysis(
    analysis_id: str,
    repo: AnalysisRepository = Depends(get_analysis_repository),
):
    analysis = await repo.get_by_id(analysis_id, load_relations=True)
    if not analysis:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Analysis with ID '{analysis_id}' not found.",
        )
    detail = AnalysisDetailResponse.model_validate(analysis)
    detail.detections_count = len(analysis.detections)
    eco = analysis.ecological_summary_json
    if isinstance(eco, dict):
        detail.species_analysis = eco.get("species")
        detail.disturbance_analysis = eco.get("disturbance")
        detail.context_analysis = eco.get("context")
        detail.expected_species_analysis = eco.get("expected_species")
        detail.observation_gap_analysis = eco.get("observation_gap")
    return detail


@router.get(
    "/{analysis_id}/status",
    response_model=AnalysisStatusResponse,
    summary="Fast polling status endpoint for progress bars",
)
async def get_analysis_status(
    analysis_id: str,
    repo: AnalysisRepository = Depends(get_analysis_repository),
):
    # Check in-memory job manager first for lowest latency
    job = job_manager.get_job(analysis_id)
    if job:
        return AnalysisStatusResponse(
            id=job.job_id,
            status=job.status,
            progress=job.progress,
            current_stage=job.stage,
            error_message=job.error,
            updated_at=datetime.utcnow(),
        )

    # Fallback to database
    analysis = await repo.get_by_id(analysis_id)
    if not analysis:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Analysis with ID '{analysis_id}' not found.",
        )
    return analysis


@router.delete(
    "/{analysis_id}",
    response_model=MessageResponse,
    summary="Delete an analysis, associated detections, and stored files",
)
async def delete_analysis(
    analysis_id: str,
    repo: AnalysisRepository = Depends(get_analysis_repository),
):
    analysis = await repo.get_by_id(analysis_id)
    if not analysis:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Analysis with ID '{analysis_id}' not found.",
        )

    # Cancel active job if currently processing
    job_manager.cancel_job(analysis_id)

    # Delete database record (cascading deletes detections & segments)
    deleted = await repo.delete(analysis_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete analysis record from database.",
        )

    # Delete physical files
    storage_service.delete_analysis_files(analysis_id)
    return MessageResponse(message=f"Analysis '{analysis_id}' and all associated assets deleted.")


@router.get(
    "/{analysis_id}/embeddings/download",
    summary="Download the raw NumPy embeddings array (.npy)",
)
async def download_embeddings(
    analysis_id: str,
    repo: AnalysisRepository = Depends(get_analysis_repository),
):
    analysis = await repo.get_by_id(analysis_id)
    if not analysis:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Analysis '{analysis_id}' not found.",
        )

    path = storage_service.get_embedding_path(analysis_id)
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Embeddings have not been generated for this analysis.",
        )

    return FileResponse(
        path=str(path),
        media_type="application/octet-stream",
        filename=f"embeddings_{analysis_id}.npy",
    )
