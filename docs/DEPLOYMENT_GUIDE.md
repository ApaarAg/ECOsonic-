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

### 7.1 Creating a Live Online Hot Backup
To create a clean, non-locking backup of the live database while streaming sessions are active:

```bash
docker exec -it ecosonic-backend python -c "
import sqlite3
src = sqlite3.connect('file:/app/storage/db/ecosonic.db?mode=ro', uri=True)
dst = sqlite3.connect('/app/storage/db/backup_$(date +%Y%m%d_%H%M%S).db')
with dst:
    src.backup(dst)
src.close()
dst.close()
print('Hot backup created successfully.')
"
```

### 7.2 Restoring from Backup
To restore a snapshot:
1. Stop the backend container:
   ```bash
   docker compose stop ecosonic-backend
   ```
2. Replace `/app/storage/db/ecosonic.db` with the backup file.
3. Remove any stale `-wal` or `-shm` files:
   ```bash
   rm -f /app/storage/db/ecosonic.db-wal /app/storage/db/ecosonic.db-shm
   ```
4. Restart the service:
   ```bash
   docker compose start ecosonic-backend
   ```

### 7.3 Log Inspection & Diagnostics
View real-time structured telemetry:

```bash
docker compose logs -f --tail=100 ecosonic-backend
```
