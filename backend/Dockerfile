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
RUN mkdir -p /app/storage/raw /app/storage/processed /app/storage/embeddings /app/storage/db

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app
ENV STORAGE_BASE_DIR=/app/storage
ENV DATABASE_URL=sqlite+aiosqlite:////app/storage/db/ecosonic.db

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
