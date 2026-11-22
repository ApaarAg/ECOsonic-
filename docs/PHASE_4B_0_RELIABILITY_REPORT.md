# ECOSONIC 2.0 / 3.0 — PHASE 4B.0: EXECUTION RELIABILITY & WORKER LIFECYCLE AUDIT REPORT

**Date:** 2026-11-21  
**Active Git Branch:** `feature/soundscape-disturbance`  
**Phase 4A Anchor Commit:** `b5ef7ea`  
**Environment:** Windows x86_64, Python 3.11.15, NVIDIA GeForce RTX 4060 Laptop GPU (8GB VRAM), CUDAExecutionProvider / CPUExecutionProvider  

---

## 1. Executive Summary

During the development and testing of Phase 4A and early Phase 4B soundscape components, deterministic test freezes and process stalls were observed across background workers, SQLite database connections, WebSocket connections, and BirdNET model loading. 

Phase 4B.0 systematically audited, isolated, and resolved each failure mode without discarding any in-flight Phase 4B soundscape work:
1. **Background Worker Lifecycle:** Implemented explicit task tracking, cancellation with timeout-bounded joins, and lifespan shutdown hooks preventing unawaited SQLite operations after database disposal.
2. **Offline Model Cache Enforcement:** Engineered fail-fast cache validation ensuring zero silent network downloads of the 345 MB BirdNET ONNX model artifact during test runs or runtime initialization.
3. **Deterministic Test Execution:** Installed and configured `pytest-timeout==2.4.0` with a 30-second default ceiling, segregating real-model integration tests into an isolated test pass.
4. **SQLite Connection Safety:** Confirmed `NullPool` architecture under `aiosqlite`, eliminating cross-thread/cross-loop connection retention deadlocks.
5. **WebSocket Clean Termination:** Hardened WebSocket message dispatch to trap disconnect frames and immediately terminate inference workers and DB operations.

---

## 2. Checkpoint & Repository Safety

All seven modified Phase 4B files and new soundscape modules were preserved in place:
- `backend/app/models/soundscape.py`
- `backend/app/schemas/soundscape.py`
- `backend/app/services/soundscape/cooccurrence_service.py`
- `backend/app/services/soundscape/disturbance_service.py`
- `backend/app/services/soundscape/fingerprint_engine.py`
- `backend/app/services/soundscape/soundscape_worker.py`
- `backend/app/schemas/live_session.py`

A snapshot patch was generated and secured at:
- `docs/phase4b_wip.patch`

---

## 3. Root Cause Analysis & Implemented Solutions

### 3.1 SQLite Deadlock via Unawaited Background Workers
* **Root Cause:** When `/api/v1/analyses` returned HTTP 202, it spawned `run_analysis_task` via `job_manager.run_job()`. In test cases using `AsyncClient`, the test function completed and Pytest torn down `test_engine` and closed database sessions while the background task was still attempting to write results to SQLite. Under Windows `asyncio` and `aiosqlite`, this resulted in an indefinite thread-join lock (PID 1768 hanging indefinitely).
* **Fix Implemented:**
  - Extended `JobManager` (`backend/app/core/job_manager.py`) with:
    - `wait_for_job(job_id, timeout)`
    - `cancel_job_and_wait(job_id, timeout)`
    - `cancel_and_wait_all(timeout)`
    - `wait_all(timeout)`
  - Integrated `await job_manager.cancel_and_wait_all(5.0)` into the FastAPI lifespan shutdown handler in `backend/app/main.py`.
  - Added fixture teardown in `backend/tests/conftest.py` to ensure all active jobs and live streaming workers are cancelled and awaited before database engine disposal.
  - Authored regression test `test_api_upload_worker_clean_teardown_regression` in `backend/tests/test_reliability_and_lifecycle.py`.

### 3.2 Silent 345 MB BirdNET Model Downloads
* **Root Cause:** If `BIRDNET_APP_DATA` was omitted or cleared, BirdNET’s internal loader defaulted to downloading the 345 MB model (`model-fp32-e78c3b50e224.onnx`) over the public internet, causing 20+ minute un-monitored stalls.
* **Fix Implemented:**
  - Added `validate_offline_model_cache()` to `BirdNetEngine` (`backend/app/services/birdnet_engine.py`).
  - Automatically resolves `BIRDNET_APP_DATA` to local `.model_cache` if unset.
  - Verifies presence and file size (>100 MB) of the exact model artifact:
    `.model_cache/acoustic-models/v3.0/onnx/model-fp32-e78c3b50e224.onnx` (345,249,691 bytes).
  - Fails fast in `< 5 ms` with `BirdNetEngineError` when cache is missing, completely barring unauthorized network traffic.
  - Exposed `model_ready` and `model_device` on `/health` endpoint.
  - Authored validation tests in `backend/tests/test_reliability_and_lifecycle.py`.

### 3.3 Starlette WebSocket Disconnect Frame Looping
* **Root Cause:** Starlette’s `TestClient` WebSocket receive loop returned `{"type": "websocket.disconnect"}` on client disconnect without raising `WebSocketDisconnect`. The server-side receive loop called `receive()` again, resulting in an unhandled exception or hanging the `TestClient` context manager exit.
* **Fix Implemented:**
  - Added explicit check in `backend/app/api/v1/live.py`:
    ```python
    if message.get("type") == "websocket.disconnect":
        logger.info("WebSocket disconnect frame received from client.")
        break
    ```
  - Added `live_session_manager.shutdown(timeout)` to cleanly stop inference workers and flush pending soundscape calculations.

### 3.4 Enforced Pytest Timeout Configuration
* **Configuration:**
  - Installed `pytest-timeout==2.4.0` in the active virtual environment (`.venv`).
  - Configured `pytest.ini`:
    ```ini
    [pytest]
    addopts = -m "not real_model" --timeout=30
    markers =
        real_model: exercises real BirdNET, FFmpeg, database persistence, and API upload end-to-end
    timeout = 30
    timeout_method = thread
    ```
  - Fast test suite runs with `--timeout=30` per test item.
  - Real-model end-to-end tests run with `--timeout=120`.

---

## 4. Test Execution & Verification

### 4.1 Reliability & Lifecycle Test Suite
```powershell
$env:PYTHONPATH="backend;."; $env:BIRDNET_APP_DATA="$PWD\.model_cache"; .venv\Scripts\pytest.exe backend/tests/test_reliability_and_lifecycle.py -v
```
**Results:**
- `test_offline_model_cache_fails_fast_when_missing`: **PASSED** (0.01s fail-fast verification)
- `test_offline_model_cache_succeeds_with_valid_cache`: **PASSED** (Validated 345 MB file)
- `test_job_manager_cancel_and_wait_all_lifecycle`: **PASSED**
- `test_job_manager_wait_for_job`: **PASSED**
- `test_api_upload_worker_clean_teardown_regression`: **PASSED** (Zero SQLite lock)
- `test_health_endpoint_reports_model_readiness`: **PASSED**
- `test_live_session_manager_shutdown`: **PASSED**
- **Outcome:** **7 passed in 1.31s**

### 4.2 Targeted Subsystem Suites
```powershell
.venv\Scripts\pytest.exe backend/tests/test_live_ring_buffer.py backend/tests/test_live_api_and_protocol.py backend/tests/test_api.py backend/tests/test_job_manager.py -v
```
**Results:**
- Ring buffer (7 tests): **PASSED**
- WebSocket API & frame validation (4 tests): **PASSED**
- Core REST API (4 tests): **PASSED**
- Job manager concurrency & cross-loop reuse (5 tests): **PASSED**
- **Outcome:** **20 passed in 2.75s**

### 4.3 Full Fast Backend Suite (Enforced 30s Timeout)
```powershell
.venv\Scripts\pytest.exe backend/tests -q
```
**Results:**
- **Outcome:** **84 passed, 4 deselected in 23.00s** (0 failures, 0 hangs)

### 4.4 Real BirdNET V3.0 GPU Integration Suite
```powershell
.venv\Scripts\pytest.exe backend/tests/test_real_pipeline.py -v -m "real_model" --timeout=120
```
**Results:**
- `test_three_real_recordings_through_upload_api`: **PASSED in 18.06s** on NVIDIA RTX 4060 GPU
- Validated inference on:
  - `birds_forest.ogg`
  - `frog_sounds.ogg`
  - `cicada_orni.ogg`
- Detections, embeddings (1,280 dims), and SQLite persistence fully validated.

---

## 5. Architectural Invariants for Future Phases

1. **Background Job Disposal:** Any endpoint or service launching background processing coroutines must register with `job_manager` or a bounded worker. Never allow orphaned `asyncio.create_task` calls.
2. **Database Session Lifetime:** Database sessions must strictly remain within their `async with async_session_factory() as session:` block. No session reference may survive beyond the life of the worker coroutine.
3. **Offline Model Cache:** No model download may occur automatically during application startup, worker initialization, or automated tests. All models must be pre-provisioned in `.model_cache`.
4. **WebSocket Loop Termination:** Always handle both `WebSocketDisconnect` exceptions and `websocket.disconnect` raw ASGI messages.
5. **Test Timeouts:** Maintain `--timeout=30` default across all PR and development test suites.
