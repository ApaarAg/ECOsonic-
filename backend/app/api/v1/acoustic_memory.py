"""FastAPI endpoints for Acoustic Memory, vector search, clustering, and visualization."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.database import get_db
from app.models.acoustic_memory import AcousticClusterRun
from app.models.live_session import LiveSegment, LiveSession
from app.schemas.acoustic_memory import (
    ClusteringRunRequest,
    ClusteringRunResponse,
    IndexRebuildResponse,
    IndexStatusResponse,
    SegmentMetadataResponse,
    SessionSegmentsResponse,
    SimilarityMatchResponse,
    SimilaritySearchRequest,
    VisualizationResponse,
)
from app.services.acoustic_memory.clustering_service import clustering_service
from app.services.acoustic_memory.embedding_index import embedding_index_service
from app.services.acoustic_memory.similarity_service import similarity_service
from app.services.acoustic_memory.visualization_service import visualization_service
from app.services.acoustic_memory_engine import acoustic_memory_engine

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/acoustic-memory", tags=["Acoustic Memory & Pattern Discovery"])


@router.post(
    "/search",
    response_model=List[SimilarityMatchResponse],
    summary="Search for similar acoustic segments using a segment ID or explicit embedding vector",
)
async def search_similar_segments(
    req: SimilaritySearchRequest,
) -> List[SimilarityMatchResponse]:
    """Execute exact cosine similarity search across indexed acoustic embeddings."""
    try:
        q_vec = np.asarray(req.query_vector, dtype=np.float32) if req.query_vector else None
        results = similarity_service.search(
            query_vector=q_vec,
            query_segment_id=req.query_segment_id,
            limit=req.limit,
            min_similarity=req.min_similarity,
            exclude_same_session=req.exclude_same_session,
            site_id=req.site_id,
            model_version=req.model_version,
            date_from=req.date_from,
            date_to=req.date_to,
        )
        return [SimilarityMatchResponse.model_validate(r.to_dict()) for r in results]
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


@router.get(
    "/search",
    response_model=List[SimilarityMatchResponse],
    summary="Search for similar acoustic segments via GET query parameters",
)
async def search_similar_segments_get(
    query_segment_id: Optional[str] = Query(None, description="Segment ID to use as query"),
    limit: int = Query(10, ge=1, le=100),
    min_similarity: float = Query(0.0, ge=-1.0, le=1.0),
    exclude_same_session: bool = Query(False),
    site_id: Optional[str] = Query(None),
) -> List[SimilarityMatchResponse]:
    """Execute exact cosine similarity search via GET query parameters."""
    if not query_segment_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="query_segment_id is required for GET /search.",
        )
    return await get_similar_for_segment(
        segment_id=query_segment_id,
        limit=limit,
        min_similarity=min_similarity,
        exclude_same_session=exclude_same_session,
        site_id=site_id,
    )



@router.get(
    "/segments/{segment_id}/similar",
    response_model=List[SimilarityMatchResponse],
    summary="Retrieve top-K similar acoustic segments for a given segment ID",
)
async def get_similar_for_segment(
    segment_id: str,
    limit: int = Query(10, ge=1, le=100, description="Max results"),
    min_similarity: float = Query(0.0, ge=-1.0, le=1.0, description="Min similarity score"),
    exclude_same_session: bool = Query(False, description="Exclude same session"),
    site_id: Optional[str] = Query(None, description="Site ID filter"),
) -> List[SimilarityMatchResponse]:
    """Retrieve similar acoustic segments by segment ID."""
    try:
        results = similarity_service.search(
            query_segment_id=segment_id,
            limit=limit,
            min_similarity=min_similarity,
            exclude_same_session=exclude_same_session,
            site_id=site_id,
        )
        return [SimilarityMatchResponse.model_validate(r.to_dict()) for r in results]
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc


@router.get(
    "/sessions/{session_id}/segments",
    response_model=SessionSegmentsResponse,
    summary="Get paginated list of segments and embeddings for a monitoring session",
)
async def get_session_segments(
    session_id: str,
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(50, ge=1, le=200, description="Page size"),
    db: AsyncSession = Depends(get_db),
) -> SessionSegmentsResponse:
    """List acoustic segments for a session with metadata."""
    sess_stmt = select(LiveSession).where(LiveSession.id == session_id)
    sess_row = (await db.execute(sess_stmt)).scalars().first()
    if not sess_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Live session '{session_id}' not found.",
        )

    count_stmt = select(func.count(LiveSegment.id)).where(LiveSegment.session_id == session_id)
    total_count = (await db.execute(count_stmt)).scalar() or 0

    offset = (page - 1) * page_size
    stmt = (
        select(LiveSegment)
        .where(LiveSegment.session_id == session_id)
        .order_by(LiveSegment.start_seconds.asc())
        .offset(offset)
        .limit(page_size)
    )
    segments = (await db.execute(stmt)).scalars().all()

    items: List[SegmentMetadataResponse] = []
    for s in segments:
        has_audio = bool(s.audio_path and Path(s.audio_path).exists())
        items.append(
            SegmentMetadataResponse(
                segment_id=s.id,
                session_id=s.session_id,
                start_seconds=s.start_seconds,
                end_seconds=s.end_seconds,
                model_version=settings.MODEL_VERSION,
                has_audio=has_audio,
                created_at=s.created_at.isoformat(),
            )
        )

    return SessionSegmentsResponse(
        session_id=session_id,
        total_count=total_count,
        page=page,
        page_size=page_size,
        segments=items,
    )


@router.get(
    "/index/status",
    response_model=IndexStatusResponse,
    summary="Get current vector index status and dimension metadata",
)
async def get_index_status() -> IndexStatusResponse:
    """Retrieve operational state of the in-memory acoustic memory index."""
    st = embedding_index_service.get_status()
    return IndexStatusResponse(
        vector_count=st["vector_count"],
        embedding_dimension=st["embedding_dimension"],
        model_version=st["model_version"],
        status=st["status"],
        last_updated=st["last_updated"],
    )


@router.get(
    "/segments/{segment_id}/audio",
    summary="Stream or download the original audio file for an acoustic segment",
)
async def get_segment_audio(segment_id: str):
    """Retrieve original audio clip corresponding to an indexed acoustic segment."""
    audio_path = similarity_service.get_segment_audio_path(segment_id)
    if not audio_path or not audio_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Audio file for segment '{segment_id}' not found.",
        )

    # Security check: ensure path is within base storage directory
    try:
        if not audio_path.resolve().is_relative_to(settings.STORAGE_BASE_DIR.resolve()):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied.",
            )
    except AttributeError:
        # Fallback for older python or Windows path quirks
        pass

    return FileResponse(
        path=str(audio_path),
        media_type="audio/wav",
        filename=audio_path.name,
    )


@router.post(
    "/index/rebuild",
    response_model=IndexRebuildResponse,
    summary="Trigger a controlled, bounded rebuild of the acoustic embedding index",
)
async def rebuild_embedding_index(
    db: AsyncSession = Depends(get_db),
) -> IndexRebuildResponse:
    """Re-scan database records and filesystem vectors to rebuild the vector index."""
    res = await embedding_index_service.rebuild_index(db)
    return IndexRebuildResponse(
        vector_count=res["vector_count"],
        elapsed_seconds=res["elapsed_seconds"],
        model_version=res["model_version"],
        status=res["status"],
    )


@router.post(
    "/clusters/run",
    response_model=ClusteringRunResponse,
    summary="Run offline HDBSCAN clustering across indexed acoustic embeddings",
)
async def run_acoustic_clustering(
    req: ClusteringRunRequest,
    db: AsyncSession = Depends(get_db),
) -> ClusteringRunResponse:
    """Execute HDBSCAN acoustic cluster discovery."""
    summary = await clustering_service.run_clustering(
        min_cluster_size=req.min_cluster_size,
        min_samples=req.min_samples,
        metric=req.metric,
        db=db,
    )
    return ClusteringRunResponse.model_validate(summary.to_dict())


@router.get(
    "/visualization/projection",
    response_model=VisualizationResponse,
    summary="Compute or retrieve 2D UMAP projection coordinates for visualization",
)
async def get_visualization_projection(
    cluster_run_id: Optional[str] = Query(None, description="Optional cluster run to attach labels"),
    n_neighbors: int = Query(15, ge=2, description="UMAP n_neighbors parameter"),
    min_dist: float = Query(0.1, ge=0.0, le=1.0, description="UMAP min_dist parameter"),
    db: AsyncSession = Depends(get_db),
) -> VisualizationResponse:
    """Retrieve 2D UMAP coordinates for frontend visualization."""
    res = await visualization_service.compute_projection(
        n_neighbors=n_neighbors,
        min_dist=min_dist,
        cluster_run_id=cluster_run_id,
        db=db,
    )
    return VisualizationResponse.model_validate(res)


@router.get(
    "/projection",
    response_model=VisualizationResponse,
    summary="Direct alias to retrieve 2D UMAP projection coordinates",
)
async def get_projection_alias(
    cluster_run_id: Optional[str] = Query(None, description="Optional cluster run to attach labels"),
    n_neighbors: int = Query(15, ge=2, description="UMAP n_neighbors parameter"),
    min_dist: float = Query(0.1, ge=0.0, le=1.0, description="UMAP min_dist parameter"),
    db: AsyncSession = Depends(get_db),
) -> VisualizationResponse:
    """Retrieve 2D UMAP coordinates (alias endpoint)."""
    return await get_visualization_projection(
        cluster_run_id=cluster_run_id,
        n_neighbors=n_neighbors,
        min_dist=min_dist,
        db=db,
    )


@router.get(
    "/clusters",
    summary="List past HDBSCAN clustering runs and summaries",
)
async def list_acoustic_clusters(
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Retrieve historical HDBSCAN clustering runs from database."""
    stmt = select(AcousticClusterRun).order_by(AcousticClusterRun.created_at.desc()).limit(limit)
    res = await db.execute(stmt)
    runs = res.scalars().all()
    return [
        {
            "cluster_run_id": r.id,
            "model_version": r.model_version,
            "dataset_size": r.dataset_size,
            "cluster_count": r.cluster_count,
            "noise_count": r.noise_count,
            "parameters": r.parameters,
            "status": r.status,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in runs
    ]


@router.post(
    "/benchmark/compare",
    summary="Benchmark and compare exact NumPy vs FAISS nearest-neighbor retrieval",
)
async def benchmark_retrieval_comparison(
    k: int = Query(10, ge=1, le=100),
):
    """Execute real-time retrieval benchmark comparing NumPy and FAISS engines."""
    seg_ids, vectors, _ = embedding_index_service.get_all_vectors(normalized=True)
    if len(seg_ids) == 0:
        return {
            "status": "empty_index",
            "message": "Cannot benchmark retrieval comparison on empty vector index.",
        }
    sample_query = vectors[0]
    comparison = acoustic_memory_engine.compare_retrieval_engines(sample_query, k=k)
    return comparison.to_dict()

