from contextlib import asynccontextmanager
import asyncio
from datetime import datetime, timezone
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import update

from app.api.v1.router import api_v1_router
from app.config import settings
from app.core.database import async_session_factory, close_db, init_db
from app.core.job_manager import job_manager
from app.models.analysis import Analysis
from app.models.live_session import LiveSession
from app.services.analysis_pipeline import analysis_pipeline
from app.services.live.session_manager import live_session_manager
from app.services.live.embedding_worker import embedding_worker
from app.services.soundscape.soundscape_worker import soundscape_worker
from app.core.exceptions import (
    AudioProcessingError,
    AudioValidationError,
    EcoSonicException,
    ResourceNotFoundError,
)
from app.core.logging import logger


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown lifecycle management."""
    logger.info("Starting up %s (version: %s)...", settings.PROJECT_NAME, settings.PROJECT_VERSION)
    # Initialize SQLite database tables
    await init_db()
    async with async_session_factory() as session:
        await session.execute(
            update(Analysis)
            .where(Analysis.status.in_(["queued", "processing"]))
            .values(status="failed", progress=0.0,
                    current_stage="failed:process_restart",
                    error_message="Worker process restarted before completion.")
        )
        await session.execute(
            update(LiveSession)
            .where(LiveSession.status.in_(["active", "created"]))
            .values(status="stopped", stopped_at=datetime.now(timezone.utc))
        )
        await session.commit()
    await live_session_manager.initialize()
    if settings.ENABLE_ACOUSTIC_MEMORY:
        from app.services.acoustic_memory.embedding_index import embedding_index_service
        await embedding_index_service.rebuild_index()
    await asyncio.to_thread(analysis_pipeline.load)
    yield
    # Graceful shutdown
    logger.info("Shutting down %s...", settings.PROJECT_NAME)
    await job_manager.cancel_and_wait_all(timeout=5.0)
    await live_session_manager.shutdown(timeout=5.0)
    await embedding_worker.stop()
    await soundscape_worker.stop()
    await close_db()


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.PROJECT_VERSION,
    description="EcoSonic 3.0 AI-Powered Bioacoustic Intelligence Platform Backend API",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS Middleware for Web & Desktop Clients
cors_origins = settings.allowed_origins_list
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins if settings.ENVIRONMENT == "production" else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Global Exception Handlers
@app.exception_handler(AudioValidationError)
async def handle_audio_validation_error(request: Request, exc: AudioValidationError):
    logger.warning("Audio validation error on %s: %s", request.url.path, exc.message)
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={"detail": exc.message, "error_type": "AudioValidationError"},
    )


@app.exception_handler(AudioProcessingError)
async def handle_audio_processing_error(request: Request, exc: AudioProcessingError):
    logger.error("Audio processing failure on %s: %s", request.url.path, exc.message)
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": exc.message, "error_type": "AudioProcessingError"},
    )


@app.exception_handler(ResourceNotFoundError)
async def handle_not_found_error(request: Request, exc: ResourceNotFoundError):
    return JSONResponse(
        status_code=status.HTTP_404_NOT_FOUND,
        content={"detail": exc.message, "error_type": "ResourceNotFoundError"},
    )


# Health & Metadata Endpoints
@app.get("/health", tags=["System"])
async def health_check():
    from app.services.direct_onnx_engine import direct_onnx_engine

    pipeline_engine = analysis_pipeline.engine
    pipeline_ready = pipeline_engine is not None and (
        getattr(pipeline_engine, "_engine", None) is not None
        or getattr(pipeline_engine, "model", None) is not None
        or hasattr(pipeline_engine, "analyze_audio")
    )
    direct_status = direct_onnx_engine.get_status()
    model_ready = bool(pipeline_ready or direct_status.get("is_ready"))
    device_raw = (
        getattr(pipeline_engine, "provider", None)
        or getattr(pipeline_engine, "device", None)
        or direct_status.get("device")
        or "unknown"
    )
    active_providers = direct_status.get("active_providers") or []
    execution_provider = (
        active_providers[0]
        if active_providers
        else (
            "CUDAExecutionProvider"
            if str(device_raw).upper() == "GPU"
            else "CPUExecutionProvider"
            if str(device_raw).upper() == "CPU"
            else str(device_raw)
        )
    )

    import psutil
    rss_mb = round(psutil.Process().memory_info().rss / (1024 * 1024), 1)
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "version": settings.PROJECT_VERSION,
        "model_version": settings.MODEL_VERSION,
        "model_ready": model_ready,
        "model_device": str(device_raw),
        "execution_provider": execution_provider,
        "provider_fallback_reason": direct_status.get("provider_fallback_reason"),
        "rss_mb": rss_mb,
        "direct_onnx_engine": direct_status,
    }


@app.get("/ready", tags=["System"])
async def readiness_check():
    from sqlalchemy import text
    from app.services.direct_onnx_engine import direct_onnx_engine

    pipeline_engine = analysis_pipeline.engine
    pipeline_ready = pipeline_engine is not None and (
        getattr(pipeline_engine, "_engine", None) is not None
        or getattr(pipeline_engine, "model", None) is not None
        or hasattr(pipeline_engine, "analyze_audio")
    )
    direct_status = direct_onnx_engine.get_status()
    model_ready = bool(pipeline_ready or direct_status.get("is_ready"))

    db_ready = False
    try:
        async with async_session_factory() as session:
            await session.execute(text("SELECT 1"))
        db_ready = True
    except Exception:
        db_ready = False

    if not model_ready or not db_ready:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "status": "not_ready",
                "model_ready": model_ready,
                "database_ready": db_ready,
            },
        )

    return {
        "status": "ready",
        "model_ready": model_ready,
        "database_ready": db_ready,
    }


@app.get("/", tags=["System"])
async def root():
    return {
        "message": "Welcome to EcoSonic 3.0 Bioacoustic Intelligence API",
        "documentation": "/docs",
        "api_v1": "/api/v1",
    }


# Mount API V1
app.include_router(api_v1_router, prefix="/api")
