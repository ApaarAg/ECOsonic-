# ==============================================================================
# EcoSonic 3.0 Production Multi-Stage Dockerfile
# Stage 1: Build & Dependency Wheel Cache
# Stage 2: Production Distroless/Slim Runtime with Non-Root Security Context
# ==============================================================================

FROM python:3.11-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY requirements-backend.txt .
RUN pip install --no-cache-dir --user -r requirements-backend.txt

# ==============================================================================
# Stage 2: Hardened Production Runtime
# ==============================================================================
FROM python:3.11-slim AS runtime

# Install system runtime libraries (FFmpeg, libsndfile for audio decoding)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create unprivileged application user
RUN groupadd -g 10001 ecosonic && \
    useradd -u 10001 -g ecosonic -s /bin/sh -m appuser

WORKDIR /app

# Copy installed Python packages from builder
COPY --from=builder /root/.local /home/appuser/.local

# Copy backend application source
COPY app/ ./app/

# Create persistent storage directories with proper ownership
RUN mkdir -p /app/storage/raw \
             /app/storage/processed \
             /app/storage/embeddings \
             /app/storage/db \
             /app/storage/live_audio \
             /app/storage/model_cache && \
    chown -R appuser:ecosonic /app/storage /home/appuser

ENV PATH=/home/appuser/.local/bin:$PATH
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app
ENV STORAGE_BASE_DIR=/app/storage
ENV DATABASE_URL=sqlite+aiosqlite:////app/storage/db/ecosonic.db
ENV BIRDNET_APP_DATA=/app/storage/model_cache
ENV PORT=8000

USER appuser

# Health check verifying API responsiveness
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/api/v1/health || exit 1

EXPOSE 8000

# EcoSonic single-worker execution guarantee:
# Concurrency is handled internally via asyncio event loop, thread pools, and ring buffer.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
