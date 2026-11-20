from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse

from app.core.exceptions import AudioProcessingError
from app.dependencies import get_analysis_repository
from app.repositories.analysis_repository import AnalysisRepository
from app.services.audio_processor import audio_processor
from app.services.storage_service import storage_service

router = APIRouter(prefix="/acoustic", tags=["Acoustic Intelligence"])


@router.get(
    "/inspect/{analysis_id}",
    summary="Get acoustic signal and container characteristics for an analysis",
)
async def inspect_acoustic_features(
    analysis_id: str,
    repo: AnalysisRepository = Depends(get_analysis_repository),
):
    analysis = await repo.get_by_id(analysis_id)
    if not analysis:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Analysis '{analysis_id}' not found.",
        )

    # Inspect processed audio if available, else raw
    target_path = Path(analysis.processed_path or analysis.audio_path)
    if not target_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Audio file does not exist on disk.",
        )

    try:
        meta = audio_processor.inspect_audio(target_path)
        return {
            "analysis_id": analysis_id,
            "filename": analysis.filename,
            "file_inspected": target_path.name,
            "duration_seconds": meta.duration_seconds,
            "sample_rate": meta.sample_rate,
            "channels": meta.channels,
            "is_mono": meta.is_mono,
            "format": meta.format,
            "subtype": meta.subtype,
            "frames": meta.frames,
            "file_size_bytes": meta.file_size_bytes,
            "rms_amplitude": meta.rms_amplitude,
            "metrics": analysis.metrics_json,
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to inspect acoustic signals: {e}",
        )


@router.get(
    "/stream/{analysis_id}",
    summary="Stream normalized 48kHz Mono WAV audio file for playback and visualization",
)
async def stream_processed_audio(
    analysis_id: str,
    repo: AnalysisRepository = Depends(get_analysis_repository),
):
    analysis = await repo.get_by_id(analysis_id)
    if not analysis:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Analysis '{analysis_id}' not found.",
        )

    processed = storage_service.get_processed_path(analysis_id)
    if not processed.exists():
        # Fallback to raw if processing is not completed
        raw = Path(analysis.audio_path)
        if raw.exists():
            return FileResponse(path=str(raw), media_type="audio/wav")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Processed audio is not available.",
        )

    return FileResponse(
        path=str(processed),
        media_type="audio/wav",
        filename=f"normalized_{analysis.filename}.wav",
    )
