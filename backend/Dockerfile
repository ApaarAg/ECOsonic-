FROM python:3.11-slim

# Install system dependencies including FFmpeg and libsndfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install
COPY requirements-backend.txt .
RUN pip install --no-cache-dir -r requirements-backend.txt

# Copy source code
COPY app/ ./app/

# Create persistent storage directories
RUN mkdir -p /app/storage/raw /app/storage/processed /app/storage/embeddings /app/storage/db /app/storage/model_cache

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app
ENV STORAGE_BASE_DIR=/app/storage
ENV DATABASE_URL=sqlite+aiosqlite:////app/storage/db/ecosonic.db
ENV BIRDNET_APP_DATA=/app/storage/model_cache

EXPOSE 8000

# EcoSonic 2.0 single-process deployment constraint:
# Must run with exactly 1 worker. Horizontal multi-worker scaling (--workers > 1)
# is unsupported due to in-process JobManager and SQLite database locks.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
