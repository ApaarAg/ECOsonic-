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
    description="EcoSonic 2.0 AI-Powered Bioacoustic Intelligence Platform Backend API",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS Middleware for Web & Desktop Clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
    model_ready = (
        analysis_pipeline.engine is not None
        and getattr(analysis_pipeline.engine, "model", None) is not None
    )
    device = (
        getattr(analysis_pipeline.engine, "device", "unknown")
        if analysis_pipeline.engine
        else "none"
    )
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "version": settings.PROJECT_VERSION,
        "model_version": settings.MODEL_VERSION,
        "model_ready": model_ready,
        "model_device": device,
    }


@app.get("/", tags=["System"])
async def root():
    return {
        "message": "Welcome to EcoSonic 2.0 Bioacoustic Intelligence API",
        "documentation": "/docs",
        "api_v1": "/api/v1",
    }


# Mount API V1
app.include_router(api_v1_router, prefix="/api")
