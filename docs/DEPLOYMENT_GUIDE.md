# ECOSONIC 3.0 — PRODUCTION DEPLOYMENT GUIDE

**Version:** 3.0.0  
**Target:** Production Backend Operations  
**Architecture:** FastAPI + Direct ONNX Runtime + SQLite WAL + Docker  

---

## 1. System Architecture Overview

EcoSonic 3.0 is a specialized bioacoustic intelligence engine designed for continuous environmental audio processing.

```
                    ┌───────────────────────────────┐
                    │  Client / Microphone Stream   │
                    └───────────────┬───────────────┘
                                    │ WebSocket PCM16
                                    ▼
                    ┌───────────────────────────────┐
                    │      Live Ring Buffer         │
                    │   (32 kHz Mono, 10s Window)   │
                    └───────────────┬───────────────┘
                                    │ 3.0s Slices
                                    ▼
                    ┌───────────────────────────────┐
                    │   Direct ONNX Runtime Engine  │
                    │  (Single-Pass Infer + Embed)  │
                    │   CUDA GPU / CPU Fallback     │
                    └───────┬───────────────┬───────┘
                            │               │
       Detections & Scores  │               │ 1,280-D Embeddings
                            ▼               ▼
      ┌─────────────────────────┐     ┌─────────────────────────┐
      │   Soundscape Worker     │     │    Embedding Worker     │
      │ (ACI, NDSI, Entropy)    │     │   (FAISS + HDBSCAN)     │
      └─────────────┬───────────┘     └─────────────┬───────────┘
                    │                               │
                    └───────────────┬───────────────┘
                                    │ Atomic Persistence
                                    ▼
                    ┌───────────────────────────────┐
                    │     SQLite Database (WAL)     │
                    │  /app/storage/db/ecosonic.db  │
                    └───────────────────────────────┘
```

---

## 2. Hardware & Software Requirements

### Minimum Requirements (CPU Only)
- **CPU:** 4 physical cores (x86_64 or ARM64)
- **RAM:** 4 GB available system memory
- **Storage:** 20 GB SSD storage (plus capacity for raw audio retention)
- **OS:** Linux (Ubuntu 22.04+ / Debian 12+), macOS 13+, or Windows 10/11 x64
- **Software:** Docker Engine 24.0+ and Docker Compose v2.20+

### Recommended Production Requirements (GPU Accelerated)
- **GPU:** NVIDIA GPU with 4+ GB VRAM (e.g., RTX 3060, T4, A10G)
- **Drivers:** NVIDIA Driver 535+ with CUDA 12.x support
- **CPU:** 8 physical cores
- **RAM:** 16 GB DDR4/DDR5
- **Storage:** 100+ GB NVMe SSD (WAL performance benefits significantly from fast I/O)

---

## 3. Quick Start with Docker Compose

### Step 1: Ensure Model Cache is Provisioned
EcoSonic enforces offline execution and prohibits unverified runtime model downloads. Ensure the `.model_cache` directory exists in the project root:

```bash
ls -la .model_cache
# Expected contents:
# .model_cache/acoustic-models/v3.0/onnx/model-fp32-*.onnx
# .model_cache/geo-models/3.0/model.onnx
```

### Step 2: Launch via Docker Compose
Run the following from the repository root:

```bash
docker compose up -d --build
```

### Step 3: Verify Health
Query the automated healthcheck endpoint:

```bash
curl -f http://localhost:8000/api/v1/health
```

Expected JSON response:
```json
{
  "status": "healthy",
  "version": "3.0.0",
  "database": "connected",
  "model_engine": "ready",
  "device": "GPU",
  "timestamp": "2026-11-22T10:30:00Z"
}
```

---

## 4. Environment Variables Reference

| Variable | Default Value | Description |
|---|---|---|
| `PORT` | `8000` | HTTP and WebSocket listening port. |
| `STORAGE_BASE_DIR` | `/app/storage` | Base directory for raw audio, embeddings, and database. |
| `DATABASE_URL` | `sqlite+aiosqlite:////app/storage/db/ecosonic.db` | SQLAlchemy SQLite database connection string. |
| `BIRDNET_APP_DATA` | `/app/storage/model_cache` | Path to pre-provisioned offline model weights. |
| `LOG_LEVEL` | `INFO` | Logging verbosity (`DEBUG`, `INFO`, `WARNING`, `ERROR`). |
| `ENABLE_ACOUSTIC_MEMORY` | `true` | Enables FAISS indexing, HDBSCAN clustering, and UMAP. |
| `MAX_UPLOAD_SIZE_MB` | `100` | Maximum file upload size for batch audio processing. |

---

## 5. Persistent Storage Structure

The persistent Docker volume `ecosonic_storage` maps directly to `/app/storage`:

```
/app/storage/
├── db/
│   ├── ecosonic.db          # Primary SQLite database
│   ├── ecosonic.db-wal      # Write-Ahead Log (WAL)
│   └── ecosonic.db-shm      # Shared memory index
├── live_audio/
│   └── {session_id}/
│       ├── segment_0.0_3.0.wav
│       ├── segment_3.0_6.0.wav
│       └── ...
├── live_embeddings/
│   └── {session_id}/
│       ├── segment_0.0_3.0.npy
│       └── ...
├── raw/                     # Batch uploaded files
├── processed/               # Extracted segments from batch uploads
└── model_cache/             # Read-only mounted model weights
```

---

## 6. Critical Architectural Constraint: Single-Worker Deployment

> [!IMPORTANT]
> **EcoSonic MUST be deployed with exactly 1 Uvicorn worker (`--workers 1`).**
> 
> *Technical Rationale:*
> 1. **In-Memory Ring Buffers:** Live streaming sessions maintain high-frequency binary PCM16 ring buffers in process memory. Multi-worker architectures split WebSockets across processes, causing fragmented buffer state.
> 2. **In-Memory Model Session:** Direct ONNX Runtime maintains warm GPU tensors and session state in a singleton engine.
> 3. **SQLite WAL Concurrency:** While SQLite WAL supports concurrent readers, it serializes writers. Multiple independent OS processes writing high-frequency live audio events increase lock contention.
> 4. **Internal Concurrency:** Concurrency in EcoSonic is handled internally via asyncio event loops, background thread pools, and non-blocking asynchronous database writes. A single process comfortably handles 10 simultaneous 32 kHz live streams.

---

## 7. Operational Runbooks

### 7.1 Reverse Proxy & Authentication Perimeter (MANDATORY)

> [!CAUTION]
> **No Built-In Authentication:** The EcoSonic 3.0 backend does not include built-in user authentication. Exposing raw port 8000 to the public internet allows unauthorized session creation and audio injection.
> In production, EcoSonic **MUST** be deployed behind an authenticating reverse proxy (Nginx, Traefik, Caddy, or Cloudflare Tunnel) terminating TLS and enforcing JWT/OAuth or HTTP Basic authentication.

#### Example Production Nginx Reverse Proxy Configuration:

```nginx
server {
    listen 443 ssl http2;
    server_name ecosonic.yourdomain.org;

    ssl_certificate     /etc/letsencrypt/live/ecosonic/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ecosonic/privkey.pem;

    client_max_body_size 100M;

    # Require authentication on all API routes
    auth_basic "EcoSonic Protected Bioacoustic Gateway";
    auth_basic_user_file /etc/nginx/.htpasswd;

    # REST API endpoints
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Live streaming WebSocket endpoint
    location /api/v1/live/ws/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

### 7.2 Two-Stage Coordinated Backup Protocol

> [!WARNING]
> **Do NOT back up `ecosonic.db` alone!**  
> EcoSonic stores metadata in SQLite, but persists 379+ MB of audio snippets (`live_audio/`) and embeddings (`embeddings/`) directly on the filesystem. Restoring `ecosonic.db` without a synchronized filesystem backup produces orphaned database records pointing to non-existent WAV files.

#### Recommended Hot Backup Script (`backup_ecosonic.sh`):

```bash
#!/bin/bash
set -euo pipefail

BACKUP_ROOT="/backups/ecosonic_$(date +%Y%m%d_%H%M%S)"
mkdir -p "${BACKUP_ROOT}/db" "${BACKUP_ROOT}/storage"

echo "[1/4] Performing atomic SQLite online backup..."
docker exec ecosonic-backend python -c "
import sqlite3
src = sqlite3.connect('file:/app/storage/db/ecosonic.db?mode=ro', uri=True)
dst = sqlite3.connect('/app/storage/db/hot_backup.db')
with dst:
    src.backup(dst, pages=100)
src.close()
dst.close()
"
mv /var/lib/docker/volumes/ecosonic_storage/_data/db/hot_backup.db "${BACKUP_ROOT}/db/ecosonic.db"

echo "[2/4] Archiving live audio snippets and embeddings..."
rsync -a --delete \
    /var/lib/docker/volumes/ecosonic_storage/_data/live_audio/ \
    "${BACKUP_ROOT}/storage/live_audio/"
rsync -a --delete \
    /var/lib/docker/volumes/ecosonic_storage/_data/live_embeddings/ \
    "${BACKUP_ROOT}/storage/live_embeddings/"

echo "[3/4] Generating cryptographic SHA256 manifest..."
cd "${BACKUP_ROOT}"
find . -type f -exec sha256sum {} + > SHA256SUMS

echo "[4/4] Coordinated backup completed successfully at: ${BACKUP_ROOT}"
```

### 7.3 Restoring from Coordinated Backup
To restore a snapshot:
1. Stop the backend container:
   ```bash
   docker compose stop ecosonic-backend
   ```
2. Replace `/app/storage/db/ecosonic.db` with the backup database file.
3. Remove stale `-wal` and `-shm` files:
   ```bash
   rm -f /app/storage/db/ecosonic.db-wal /app/storage/db/ecosonic.db-shm
   ```
4. Restore `live_audio/` and `live_embeddings/` directories from the storage backup.
5. Verify SHA256 checksums match `SHA256SUMS`.
6. Restart the service:
   ```bash
   docker compose start ecosonic-backend
   ```

### 7.4 Log Inspection & Diagnostics
View real-time structured telemetry:

```bash
docker compose logs -f --tail=100 ecosonic-backend
```
