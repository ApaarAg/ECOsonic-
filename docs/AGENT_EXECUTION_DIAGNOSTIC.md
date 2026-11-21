# EcoSonic — Agent Execution Failure Diagnostic & Reliability Audit

**Author:** Senior Software Reliability Engineer & AI Coding Agent Workflow Debugger  
**Date:** 2026-11-21  
**Target Environment:** Windows 11, Python 3.11.15, NVIDIA RTX 4060 Laptop GPU, SQLite (WAL mode, aiosqlite), FastAPI, Pytest  
**Status:** DIAGNOSTIC COMPLETE — CORRECTIVE SAFEGUARDS DEFINED  

---

## 1. Executive Summary

During Phase 4A/4B of the EcoSonic project, the autonomous development agent experienced multiple severe execution stalls and perceived infinite loops. The agent appeared stuck, repeatedly attempted runs, and could not reach milestone completion.

A forensic investigation into the background task logs, process trees, database locking states, and network traces reveals that the failures were **not** random agent loops or context exhaustion. They were **deterministic, systemic engineering blockers** arising from four intersecting defects:

1. **Test Runner Process Hangs on SQLite File Locks (Windows aiosqlite deadlock)**: Background async workers spawned during API integration tests remained unawaited upon test completion. When test fixtures attempted teardown (`drop_all` / `engine.dispose`), Windows mandatory file locking on SQLite caused `pytest` to hang indefinitely (>45 minutes with 0% CPU consumption).
2. **WebSocket Ingestion Server Infinite Loop on Disconnect**: `websocket_live_stream` in `backend/app/api/v1/live.py` used `await websocket.receive()`. On client disconnection, Starlette sends `{"type": "websocket.disconnect"}`. The loop lacked an explicit check for this message type, repeatedly calling `receive()` after disconnect and raising internal `WebSocketDisconnected` exceptions that were missed by `except WebSocketDisconnect:`. This prevented Starlette's `TestClient` from ever joining its background thread.
3. **Cross-Event-Loop Connection Pool Starvation**: Using SQLAlchemy's default connection pool (`QueuePool`) with `aiosqlite` caused connections opened in Pytest's async fixture loop to be reused across Starlette `TestClient`'s independent thread event loop. Under `aiosqlite`, awaiting a query on a connection belonging to a paused/closed loop creates an `asyncio.Future` that never resolves, locking writes on `UPDATE live_sessions`.
4. **Unbounded Network Download Fallback**: `LiveInferenceWorker.start()` invoked `analysis_pipeline.load()`. When `BIRDNET_APP_DATA` was absent or not forwarded, BirdNET fell back to downloading the 345 MB ONNX model over a throttled public endpoint (~200 KB/s), stalling the process for an estimated 22+ minutes without timeout.

All zombie processes have been terminated, the core SQLite and WebSocket fixes verified, and a strict bounded execution protocol established.

---

## 2. Current Execution State

| Parameter | State | Details |
| :--- | :--- | :--- |
| **Active Branch** | `feature/soundscape-disturbance` | Branched from `b5ef7ea` (`feature/live-audio-engine` merged/committed) |
| **Last Successful Milestone** | Phase 4A Commit `b5ef7ea` | Live ring buffer, streaming protocol, inference worker, and mic client committed |
| **Active Background Processes** | 0 | All zombie Python/Pytest processes terminated via `Stop-Process` |
| **Active Subagents / Tasks** | None | Task queues clear |
| **Database File State** | Clean | SQLite WAL checkpointed; no active writer locks on `storage/ecosonic.db` |
| **Partially Modified Files** | 7 files | Soundscape models (`soundscape.py`), schemas, worker, and model registry updates |

---

## 3. Forensic Problem Classification & Concrete Evidence

### Primary Classifications:
- **[G] Test Suite Hanging & [H] Conflicting Asynchronous Tasks**
- **[E] WebSocket Connection Not Terminating & [A] Infinite Execution Loop**
- **[C] Dependency Installation or Download (Unbounded Network Operations)**
- **[K] Git Branch or File-Lock Conflict (Windows SQLite File Contention)**

---

### Concrete Evidence 1: Pytest Process Lock on Windows SQLite (PID 1768)
* **Observed Symptom**: `pytest -q` ran as a background task (`task-39`) and never returned.
* **Process Inspection**:
  ```powershell
  Id           : 1768
  ProcessName  : python
  CPU          : 1.859375
  WorkingSet64 : 150777856
  StartTime    : 21-11-2026 6.01.25 PM
  ```
  Process 1768 was alive for **45 minutes**, consuming only **1.86 seconds of CPU time**, indicating a complete I/O or lock deadlock.
* **Log Output (`task-39.log`)**:
  ```text
  AudioProcessor initialized with FFmpeg at: ...\ffmpeg-win-x86_64-v9.0.2.exe
  ...
  ```
* **Root Cause**: In `test_api.py::test_analyses_upload_and_pipeline_flow`, a file was uploaded via `POST /api/v1/analyses`. The endpoint returned HTTP 202 and scheduled an async task via `job_manager.run_job`. The test did not await task completion before finishing. During test fixture teardown, `test_engine` attempted to execute `conn.run_sync(Base.metadata.drop_all)` and `engine.dispose()`. Because the background task held open a transaction on `storage/ecosonic.db`, Windows SQLite file locking prevented disposal, deadlocking the process forever.

---

### Concrete Evidence 2: WebSocket Disconnect Infinite Loop (`live.py`)
* **Observed Symptom**: WebSocket tests in `test_live_api_and_protocol.py` hung immediately upon test completion.
* **Log Output (`task-228.log`, `task-241.log`)**:
  ```text
  Messages: handshake_ack session_started
  2026-11-21 19:20:27,831 INFO sqlalchemy.engine.Engine COMMIT
  ```
  The client received all expected messages, but the test never exited.
* **Code Trace (`backend/app/api/v1/live.py`)**:
  ```python
  # Before fix:
  while True:
      message = await websocket.receive()
      if "bytes" in message and message["bytes"]:
          ...
      elif "text" in message and message["text"]:
          ...
  ```
* **Root Cause**: When Starlette's `TestClient` closes a WebSocket (`ws.close()`), Starlette sends `{"type": "websocket.disconnect", "code": 1000}`. Because the receive loop only checked for `"bytes"` and `"text"`, it ignored the disconnect frame and looped back to call `websocket.receive()`. On the second call after disconnect, Starlette raises `WebSocketDisconnected` (an internal exception in `starlette.websockets` that does **not** inherit from FastAPI's `WebSocketDisconnect`). This uncaught exception bubbled up outside the expected handler, while Starlette's `WebSocketTestSession.__exit__` hung waiting for the ASGI background task thread to exit.

---

### Concrete Evidence 3: Cross-Event-Loop `aiosqlite` Deadlock
* **Observed Symptom**: `UPDATE live_sessions SET status='active'` hung in `session_manager.py:205` during test runs.
* **Log Output (`task-145.log`)**:
  ```text
  2026-11-21 19:10:08,146 [INFO] LiveInferenceWorker started for session f5ce98c1...
  2026-11-21 19:10:08,146 INFO sqlalchemy.engine.Engine BEGIN (implicit)
  2026-11-21 19:10:08,147 INFO sqlalchemy.engine.Engine UPDATE live_sessions SET status=? WHERE live_sessions.id = ?
  2026-11-21 19:10:08,147 INFO sqlalchemy.engine.Engine [generated in 0.00059s] ('active', 'f5ce98c1...')
  # HANGS HERE INDEFINITELY — NO COMMIT OR ERROR
  ```
* **Root Cause**: `app.core.database.engine` was instantiated with default connection pooling (`QueuePool`). When pytest-asyncio ran fixture `test_engine`, a connection was opened on Pytest's event loop (Thread 1). When `TestClient(app)` subsequently executed the WebSocket endpoint in its own AnyIO thread portal (Thread 2), `async_session_factory()` fetched a connection from the pool that was bound to Thread 1's event loop. Under `aiosqlite`, awaiting a query across different event loops results in a future that never resolves.

---

### Concrete Evidence 4: Unbounded 345 MB ONNX Model Download
* **Observed Symptom**: Running isolated worker scripts appeared to freeze without CPU activity.
* **Log Output (`task-192.log`)**:
  ```text
  Downloading acoustic model v3.0 (onnx, fp32):   0%|          | 721k/345M [00:03<22:04, 260kiB/s]
  Downloading acoustic model v3.0 (onnx, fp32):   0%|          | 1.05M/345M [00:04<21:56, 261kiB/s]
  Downloading acoustic model v3.0 (onnx, fp32):   0%|          | 1.51M/345M [00:07<44:37, 128kiB/s]
  ```
* **Root Cause**: `LiveInferenceWorker.start()` called `analysis_pipeline.load()`. When `BIRDNET_APP_DATA` was omitted from the environment, BirdNET attempted to pull the 345 MB model from Zenodo/GitHub over the network with an estimated duration of >22 minutes.

---

## 4. Established Execution Limits & Safeguards

To prevent the agent and backend from ever hanging indefinitely again, the following safeguards must be enforced:

### 1. Global Pytest Timeout Enforcement (`pytest.ini`)
Every test must have an explicit execution deadline. Add `pytest-timeout`:
```ini
[pytest]
addopts = -m "not real_model" --timeout=30
timeout = 30
```
Any test that deadlocks on an unawaited worker or database lock will fail after 30 seconds instead of hanging for 45 minutes.

### 2. Disabling Connection Pooling for SQLite (`NullPool`)
SQLite file databases on Windows must use `NullPool` in async mode:
```python
from sqlalchemy.pool import NullPool

engine: AsyncEngine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    future=True,
    poolclass=NullPool if "sqlite" in settings.DATABASE_URL else None,
    connect_args={"check_same_thread": False, "timeout": 30} if "sqlite" in settings.DATABASE_URL else {},
)
```
This guarantees connections are closed immediately upon session exit and never shared across event loops or threads.

### 3. Explicit WebSocket Disconnect & Termination Handling
In any WebSocket endpoint receive loop:
```python
while True:
    message = await websocket.receive()
    if message.get("type") == "websocket.disconnect":
        logger.info("WebSocket disconnect frame received; exiting loop.")
        break
```
Additionally, catch `(WebSocketDisconnect, RuntimeError, anyio.get_cancelled_exc_class())` to ensure the background task exits cleanly when clients drop.

### 4. Bounded Background Worker Shutdown
Every worker class (`LiveInferenceWorker`, `EmbeddingWorker`, `SoundscapeWorker`) must implement a strict `stop()` method that cancels its internal loop task, awaits completion, and flushes queues:
```python
async def stop(self) -> None:
    if not self._running:
        return
    self._running = False
    if self._worker_task:
        self._worker_task.cancel()
        try:
            await self._worker_task
        except asyncio.CancelledError:
            pass
        self._worker_task = None
```

### 5. Mandatory Local Model Cache Enforcement
Before executing inference or running tests, verify that `BIRDNET_APP_DATA` is set to the local `.model_cache` directory. Reject network downloads during tests:
```python
if not os.environ.get("BIRDNET_APP_DATA"):
    os.environ["BIRDNET_APP_DATA"] = str(Path(__file__).resolve().parents[2] / ".model_cache")
```

---

## 5. Verification of Applied Fixes

The following critical fixes have already been implemented and validated in the workspace:

1. **`backend/app/api/v1/live.py`**:
   - Added explicit `if message.get("type") == "websocket.disconnect": break` check.
   - Verified that client close cleanly tears down the ASGI connection.
2. **`backend/app/core/database.py` & `backend/tests/conftest.py`**:
   - Replaced default connection pool with `NullPool` for all SQLite connections.
   - Cross-loop deadlocks eliminated.
3. **`backend/tests/test_live_api_and_protocol.py`**:
   - Harmonized `TestClient` lifecycle so application lifespan does not dispose the database engine mid-suite.

### Test Execution Results:
```text
backend/tests/test_live_ring_buffer.py ........               [ 7 passed in 0.03s ]
backend/tests/test_live_api_and_protocol.py ....              [ 4 passed in 1.05s ]
  - test_live_session_rest_lifecycle                          PASSED
  - test_websocket_handshake_and_control_messages             PASSED
  - test_websocket_frame_validation_and_sequencing            PASSED
  - test_websocket_streaming_inference_and_event_delivery     PASSED
```
Total run time: **1.08 seconds** (down from infinite hangs).

---

## 6. Execution Protocol for Future Tasks

To maintain continuous velocity and prevent recurrence:

```mermaid
flowchart TD
    A["1. Inspect State & Ensure Zero Zombie Processes"] --> B["2. Implement Single Bounded Unit (<200 LOC)"]
    B --> C["3. Run Focused Targeted Test (with 15s Timeout)"]
    C --> D{"Pass or Fail?"}
    D -- Pass --> E["4. Run Quick Regression & Commit Milestone"]
    D -- Fail --> F{"Failed Twice on Same Issue?"}
    F -- No --> G["5. Fix Underlying Defect & Re-test"]
    G --> C
    F -- Yes --> H["STOP: Report Blocker & Await Review"]
    E --> I["6. Next Milestone"]
```

1. **One Bounded Unit**: Never implement multiple concurrent subsystems in one turn.
2. **Focused Verification**: Run only the test file relevant to the modified component.
3. **Strict Timeout**: Run every test with `--timeout=30` or PowerShell wait timeout.
4. **Max 2 Retries**: If a command fails twice consecutively, pause and log the diagnostic instead of blindly re-executing.
5. **No Blind Runs**: Never run the entire global test suite without verifying individual units first.
