from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_v1_router
from app.config import settings
from app.core.database import close_db, init_db
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
    yield
    # Graceful shutdown
    logger.info("Shutting down %s...", settings.PROJECT_NAME)
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
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "version": settings.PROJECT_VERSION,
        "model_version": settings.MODEL_VERSION,
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
