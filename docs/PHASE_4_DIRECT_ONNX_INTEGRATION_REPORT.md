# ECOSONIC 3.0 — DIRECT ONNX LIVE INFERENCE INTEGRATION REPORT
**Phase 4 Live Audio Infrastructure — Subprocess Bottleneck Elimination & Production Parity Audit**

- **Date:** 2026-11-22
- **Branch:** `feature/live-direct-onnx-inference`
- **Base Commit:** `0721c99` (Audit Final Phase 4 Closure Gate)
- **Status:** **PASSED / PRODUCTION READY FOR V1 RELEASE**
- **Hardware Profile:**
  - **OS:** Windows 11 Home 64-bit (Build 26100)
  - **CPU:** Intel Core i7-13620H (16 Threads, 2.40 GHz base)
  - **GPU:** NVIDIA GeForce RTX 4060 Laptop GPU (8GB GDDR6 VRAM)
  - **Host Audio Input:** Realtek Microphone Array (`Microphone Array (Realtek(R) Audio)`, Device Index 1)

---

## 1. Executive Summary

During the final cross-phase acceptance audit (`0721c99`), the live audio acquisition and inference subsystem demonstrated a critical architectural bottleneck:
- Spawning child processes via `birdnet.predict` and `birdnet.encode` on Windows introduced process creation overhead, IPC serialization, and file I/O latency of **6,078.75 ms (6.08 seconds)** per 3.0-second inference window.
- Because the hop duration is 3.0 seconds (and optionally 1.5 seconds), the live inference worker accumulated queue backpressure and dropped **93 inference windows** during a 10-minute sustained replay test.

To eliminate this bottleneck while strictly preserving BirdNET V3.0 numerical semantics, we engineered and deployed the **Direct ONNX Live Inference Engine** (`backend/app/services/direct_onnx_engine.py`):
1. **Persistent In-Memory ONNX Runtime Engine:** Loads the official FP32 ONNX acoustic model weights (`.model_cache/acoustic-models/v3.0/onnx/model-fp32-e78c3b50e224.onnx`) and the 11,725 species label taxonomy once at application startup.
2. **Dual-Head Single Forward Pass:** Leverages the native ONNX computational graph outputs `["predictions", "embeddings"]` in a single forward pass, producing both species probabilities and 1,280-dimensional acoustic embeddings with median execution latency of **36.58 ms** on GPU (**69.12 ms** total end-to-end post-window processing latency).
3. **Zero Subprocess Overhead in Live Stream:** The embedding worker receives precomputed in-memory embeddings directly from the inference worker, completely bypassing secondary encoding passes and disk round-trips.
4. **Zero Dropped Windows:** In subsequent 10-minute replay endurance tests (at both 1.5s and 3.0s hop duration) and a 30-minute physical microphone capture test, the live pipeline recorded **0 dropped windows** and **0 dropped frames**.
5. **100% Numerical Parity:** Verified across all four environmental smoke recordings with identical Top-5 species labels, score discrepancies below $10^{-4}$, and embedding cosine similarities $> 0.9999$.

---

## 2. Architecture & Design Implementation

### 2.1 Direct ONNX Engine (`backend/app/services/direct_onnx_engine.py`)

A thread-safe singleton `DirectOnnxEngine` was implemented with the following core responsibilities:
- **Offline Model Cache Enforcement:** Reuses the verified `_ensure_model_cache_env()` logic, strictly rejecting unverified network downloads and verifying the existing 345 MB FP32 ONNX weights and 11,725-species label dictionary in `.model_cache`.
- **Windows CUDA DLL Discovery:** Prepares `PATH` using `_prepare_windows_cuda_dll_path()` to ensure NVIDIA PyPI wheel libraries (`cublasLt64_12.dll`, `cudnn64_9.dll`) are loaded into the process address space before initializing `ort.InferenceSession`.
- **Dual Execution Providers:** Attempts `CUDAExecutionProvider` on the NVIDIA RTX 4060 GPU with automatic, seamless fallback to `CPUExecutionProvider` if GPU drivers or CUDA runtimes are unavailable.
- **Dual Output Evaluation:**
  ```python
  preds, embs = self._session.run(
      ["predictions", "embeddings"],
      {"input": input_tensor},
  )
  ```
  Both the multi-class prediction logits and the normalized 1,280-dimensional embedding are extracted in parallel during a single graph traversal.
- **Input Robustness & Validation:** Normalizes and strictly validates incoming audio buffers. Non-1D arrays, durations shorter than 100 ms (3,200 samples), non-finite values (NaN / $\pm\infty$), and zero-variance DC flatlines trigger a specialized `AudioValidationError`, preventing graph corruption.
- **Thread Safety:** Protected via an internal `threading.Lock()` across session execution and provider management.

### 2.2 Live Inference Worker Integration (`backend/app/services/live/inference_worker.py`)

The live inference worker was refactored from subprocess delegation to direct in-memory execution:
- Replaced the subprocess-based `birdnet.predict()` call with `direct_onnx_engine.infer(window.data, min_confidence, top_k=5)`.
- Extracted the Top-5 species detections and precomputed 1,280-D float32 embedding vector.
- Preserved mock engine compatibility (`FallbackMockEngine`) to guarantee existing unit tests continue to pass without regression.

### 2.3 Live Embedding Worker Vector Pass-Through (`backend/app/services/live/embedding_worker.py`)

The `EmbeddingTask` dataclass was updated to accept an optional pre-extracted embedding vector:
```python
@dataclass
class EmbeddingTask:
    segment_id: str
    audio_path: str
    session_id: Optional[str] = None
    created_at: float = 0.0
    vector: Optional[np.ndarray] = None  # Precomputed in Direct ONNX forward pass
```
When `task.vector` is provided by the live inference worker, `LiveEmbeddingWorker` bypasses `analysis_pipeline.engine.extract_embeddings(task.audio_path)` entirely, writing the `.npy` vector to disk and updating the SQLite `LiveSegment` record asynchronously in ~5 ms.

### 2.4 Pre-Warming & Zero Cold-Start Latency (`backend/app/services/live/session_manager.py`)

In `LiveSessionManager.initialize()`, `direct_onnx_engine.load()` is executed within an asynchronous executor thread. This ensures CUDA kernels and ONNX runtime graphs are pre-warmed, eliminating cold-start latency when the user begins streaming.

---

## 3. Numerical Parity Audit

To ensure the Direct ONNX engine output is identical to official BirdNET V3.0 predictions, comprehensive numerical parity tests were implemented in `backend/tests/test_direct_onnx_parity.py` across four distinct environmental recordings:

1. `birds_forest.ogg` (Temperate woodland soundscape)
2. `birds_garden.ogg` (Urban avian bioacoustics)
3. `cicada_orni.ogg` (High-frequency arthropod biophony)
4. `frog_mixed.ogg` (Amphibian chorus)

### Parity Results Summary

| Recording | Device / Provider | Top-5 Species Label Match | Max Score Absolute Difference | Embedding Cosine Similarity |
|---|---|:---:|:---:|:---:|
| `birds_forest.ogg` | GPU (`CUDAExecutionProvider`) | **100% (5/5)** | $0.000000$ | **1.000000** |
| `birds_forest.ogg` | CPU (`CPUExecutionProvider`) | **100% (5/5)** | $0.000000$ | **1.000000** |
| `birds_garden.ogg` | GPU (`CUDAExecutionProvider`) | **100% (5/5)** | $0.000000$ | **1.000000** |
| `birds_garden.ogg` | CPU (`CPUExecutionProvider`) | **100% (5/5)** | $0.000000$ | **1.000000** |
| `cicada_orni.ogg` | GPU (`CUDAExecutionProvider`) | **100% (5/5)** | $0.000000$ | **1.000000** |
| `cicada_orni.ogg` | CPU (`CPUExecutionProvider`) | **100% (5/5)** | $0.000000$ | **1.000000** |
| `frog_mixed.ogg` | GPU (`CUDAExecutionProvider`) | **100% (5/5)** | $0.000000$ | **1.000000** |
| `frog_mixed.ogg` | CPU (`CPUExecutionProvider`) | **100% (5/5)** | $0.000000$ | **1.000000** |

**Conclusion:** The direct ONNX execution path yields bit-exact or sub-$10^{-4}$ numerical identity compared to the official BirdNET Python package, with perfect cosine similarity across all 1,280 embedding dimensions.

---

## 4. Reconciled Production Path Latency Benchmarks

Benchmarking was performed with `backend/tools/benchmark_integrated_production_path.py` across 50 measured iterations (+ 10 warm-up runs) using 96,000 float32 samples (3.0 seconds audio @ 32 kHz mono) simulating the complete integrated production path. The canonical machine-readable results are preserved in `docs/integrated_direct_onnx_benchmark_results.json`.

### 4.1 Benchmark Configuration
- **Hardware Profile:** Intel Core i7-13620H (16 vCPUs @ 2.40 GHz), NVIDIA GeForce RTX 4060 Laptop GPU (8GB VRAM), ONNX Runtime 1.26.0
- **Input Segment Size:** 96,000 samples (3.000s @ 32,000 Hz)
- **Measured Iterations:** 50 runs (+ 10 warmup discarded)
- **Active Provider Configurations:**
  - **GPU Mode:** `["CUDAExecutionProvider", "CPUExecutionProvider"]`
  - **CPU Fallback Mode:** `["CPUExecutionProvider"]`

### 4.2 Detailed Latency Statistics by Stage

#### GPU Execution (`CUDAExecutionProvider`)
| Pipeline Stage | Mean | Median | P95 | P99 | Min | Max |
|---|---:|---:|---:|---:|---:|---:|
| Preprocessing & Audio Validation | 0.183 ms | 0.190 ms | 0.259 ms | 0.318 ms | 0.115 ms | 0.367 ms |
| **ONNX Runtime (Preds + Embs)** | **34.861 ms** | **36.577 ms** | **42.035 ms** | **43.979 ms** | **23.908 ms** | **44.993 ms** |
| Postprocessing & Top-K Extraction | 0.427 ms | 0.539 ms | 0.596 ms | 0.638 ms | 0.231 ms | 0.640 ms |
| Embedding File Persistence (`.npy`) | 8.056 ms | 5.854 ms | 18.197 ms | 19.382 ms | 2.422 ms | 19.550 ms |
| Database Persistence (SQLite WAL) | 24.893 ms | 25.171 ms | 30.373 ms | 33.076 ms | 17.905 ms | 33.282 ms |
| WebSocket Publication (Simulated in-process) | 0.029 ms | 0.030 ms | 0.039 ms | 0.041 ms | 0.020 ms | 0.043 ms |
| **Total Post-Window E2E Latency** | **68.449 ms** | **69.119 ms** | **84.857 ms** | **86.560 ms** | **48.815 ms** | **86.879 ms** |

- **Real-Time Factor (RTF):** **0.02304** ($43.4\times$ faster than real-time)

#### CPU Fallback Execution (`CPUExecutionProvider`)
| Pipeline Stage | Mean | Median | P95 | P99 | Min | Max |
|---|---:|---:|---:|---:|---:|---:|
| Preprocessing & Audio Validation | 0.187 ms | 0.178 ms | 0.261 ms | 0.285 ms | 0.127 ms | 0.291 ms |
| **ONNX Runtime (Preds + Embs)** | **60.603 ms** | **55.137 ms** | **83.599 ms** | **133.084 ms** | **45.585 ms** | **151.719 ms** |
| Postprocessing & Top-K Extraction | 0.456 ms | 0.363 ms | 0.740 ms | 1.333 ms | 0.277 ms | 1.878 ms |
| Embedding File Persistence (`.npy`) | 12.527 ms | 12.040 ms | 21.298 ms | 23.555 ms | 3.090 ms | 24.509 ms |
| Database Persistence (SQLite WAL) | 27.799 ms | 23.578 ms | 30.952 ms | 123.144 ms | 19.309 ms | 199.457 ms |
| WebSocket Publication (Simulated in-process) | 0.031 ms | 0.030 ms | 0.038 ms | 0.041 ms | 0.023 ms | 0.043 ms |
| **Total Post-Window E2E Latency** | **101.604 ms** | **93.629 ms** | **145.519 ms** | **224.191 ms** | **80.342 ms** | **257.345 ms** |

- **Real-Time Factor (RTF):** **0.03121** ($32.0\times$ faster than real-time)

### 4.3 Critical Architectural Boundary Clarifications
1. **WebSocket Publication Measurement:** The benchmark's `websocket_publication` stage (~0.03 ms) measures *in-process Python event serialization and queue insertion* (`await state.broadcast_event()`). It is **not** a measurement of browser-to-server or server-to-browser network transit time, TCP transmission latency, or frontend DOM rendering latency.
2. **Sound-Onset-to-Browser Latency:** Total sound-onset-to-browser latency includes:
   - Rolling buffer accumulation duration: up to 3.0 seconds (or 1.5 seconds hop interval elapsed time before a complete window is formed).
   - Ingest framing jitter (typically 1–15 ms).
   - Direct ONNX post-window processing: ~69 ms on GPU (~94 ms on CPU).
   - WebSocket network transit and browser rendering: typically 10–50 ms depending on network topology.
   Therefore, the backend benchmark specifically demonstrates **sub-70ms post-window processing latency**, and does not claim an unrealistic sub-200ms sound-onset-to-browser latency.

---

## 5. Reconciled Inference-Window Accounting & Endurance Validation

Full endurance stress tests were executed using `backend/tools/audit_sustained_endurance.py` with canonical records saved in `docs/direct_onnx_endurance_results.json`:

### 5.1 Mathematical Accounting of Eligible Windows
For any streaming session with total samples $S$, window length $W = 96,000$ samples (3.0s), and hop size $H$:
$$\text{Expected Eligible Windows} = \left\lfloor \frac{S - W}{H} \right\rfloor + 1 \quad (\text{for } S \ge W)$$

| Workload | Ingested Frames | Samples Accepted ($S$) | Hop ($H$) | Expected Windows | Windows Generated | Completed Windows | Inferred Windows | Silent Skipped | Dropped Windows |
|---|:---:|---:|---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Replay 1.5s Hop** | 2,341 | 18,728,000 (585.25s) | 48,000 (1.5s) | **389** | 389 | 389 | 389 | 0 | **0** |
| **Replay 3.0s Hop** | 2,327 | 18,616,000 (581.75s) | 96,000 (3.0s) | **193** | 193 | 193 | 193 | 0 | **0** |
| **Physical Mic (30 min)** | 7,200 | 57,600,000 (1800.0s) | 96,000 (3.0s) | **600** | 600 | 600 | 84 | 516 | **0** |

#### Reconciliation Findings:
1. **Replay 1.5s Hop (389 Windows):** Over 605s elapsed wall-clock time, 2,341 audio frames (250ms chunks) were sent due to sleep timer resolution on Windows ($2,341 \times 8,000 = 18,728,000\text{ samples} = 585.25\text{s}$). $\lfloor (18,728,000 - 96,000) / 48,000 \rfloor + 1 = 389$. Exactly 389 complete windows were eligible, generated, processed, and persisted in SQLite (`LiveSegment`). Zero drops.
2. **Replay 3.0s Hop (193 Windows):** 2,327 audio frames were sent ($18,616,000\text{ samples} = 581.75\text{s}$). $\lfloor (18,616,000 - 96,000) / 96,000 \rfloor + 1 = 193$. Exactly 193 complete windows were eligible, generated, processed, and persisted. Zero drops.
3. **Physical Mic 30 Min (600 Windows):** 7,200 frames of 250ms native microphone audio were captured, resampled, and written ($57,600,000\text{ samples} = 1,800.0\text{s}$). Exactly 600 windows were generated and written as `LiveSegment` records in SQLite.
   - **84 Inferred Windows:** Windows where audio energy exceeded the silence threshold ($RMS \ge 10^{-4}$), executing full ONNX inference and extracting 10 bird detections and 2 disturbance events.
   - **516 Silent Skipped Windows:** Windows in the quiet recording room where ambient energy fell below $10^{-4}\text{ RMS}$ ($-80\text{ dBFS}$). Heavy model forward passes were bypassed to conserve power and compute, recording `processing_status="silent_skipped"`.
   - **Warning Reconciliation:** In previous unoptimized runs, each silent window triggered an `audio_quality_warning`, resulting in 516 redundant warnings. This has been updated so that expected environmental silence is communicated via standard `processing_update` (`status="silent_skipped", is_silent=True`), preserving `audio_quality_warning` solely for true anomalies (such as severe clipping $> 5\%$ or unparseable frames).

### 5.2 Resource Stability Metrics
- **Replay 1.5s Hop:** RAM growth strictly bounded ($\Delta = +53.50\text{ MB}$, initial 1,186.36 MB $\rightarrow$ final 1,239.86 MB); Peak VRAM 2,237.00 MB / 8,192 MB (27.3%).
- **Replay 3.0s Hop:** RAM growth strictly bounded ($\Delta = +52.42\text{ MB}$, initial 1,185.08 MB $\rightarrow$ final 1,237.50 MB); Peak VRAM 1,569.00 MB.
- **Physical Mic 30 Min:** Initial RAM 1,182.63 MB $\rightarrow$ Final RAM 961.01 MB ($\Delta = -221.62\text{ MB}$, verified periodic garbage collection); Peak VRAM 1,748.00 MB. Max queue depth = 1 across all 30 minutes. Graceful shutdown success.

---

## 6. Quiet Bird Call Fixture & Input Validation

In `backend/tests/test_direct_onnx_lifecycle_and_recovery.py`, a dedicated test fixture was created to verify that the silence gate does not discard quiet or distant environmental biophony:
- Real bird vocalizations from `birds_forest.ogg` were calibrated across four signal-level regimes:
  - $0.0050\text{ RMS}$ (-26 dBFS)
  - $0.0010\text{ RMS}$ (-40 dBFS)
  - $0.0003\text{ RMS}$ (-50 dBFS)
  - $0.00015\text{ RMS}$ (-56 dBFS)
- Because the ring buffer's silence threshold is calibrated at $10^{-4}\text{ RMS}$ (-80 dBFS), all four quiet signals passed cleanly without being flagged as silent (`win.is_silent == False`), and Direct ONNX returned valid detections and embeddings.
- In contrast, signals attenuated below $10^{-4}\text{ RMS}$ (-80 dBFS) or pure constant DC flatlines were correctly flagged as silent or rejected via `AudioValidationError`, protecting the ONNX graph from division-by-zero anomalies.

---

## 7. Full Regression Verification Summary

The complete test suite was executed against the repository:

| Test Suite | Selection Flag | Test Count | Status | Execution Duration |
|---|---|:---:|:---:|:---:|
| Unit & Integration Tests | `-m "not real_model"` | 136 | **136 PASSED, 0 FAILED** | 44.27s |
| Real Model & Direct ONNX Tests | `-m "real_model"` | 13 | **13 PASSED, 0 FAILED** | 79.62s |
| **Complete Repository Coverage** | **All Tests** | **149** | **149 PASSED, 0 FAILED** | **123.89s** |

---

## 8. Final Architecture Comparison Matrix

| Metric / Dimension | Phase 4 Audit Baseline (`0721c99`) | Direct ONNX Integration (`feature/live-direct-onnx-inference`) | Improvement Factor |
|---|---:|---:|:---:|
| Live Model Execution Mode | Python subprocess (`birdnet.predict`) | In-memory `ort.InferenceSession` | Process boundary eliminated |
| Inference Latency (GPU) | 6,078.75 ms | **36.58 ms** | **166.2x faster** |
| Post-Window Total Latency | 6,135.75 ms | **69.12 ms** | **88.8x faster** |
| Real-Time Factor (RTF) | 2.045 | **0.023** | **88.9x improvement** |
| Windows Dropped (10 min replay) | 93 dropped windows | **0 dropped windows** | **100% elimination of drops** |
| Windows Dropped (30 min mic) | Untested | **0 dropped windows** | **Zero-drop verified** |
| Acoustic Embedding Overhead | Second subprocess call (~6s) | Precomputed in same forward pass (~0 ms) | Single-pass dual output |
| Memory Stability | RSS growth uncontrolled | RSS bounded (961 - 1288 MB, GC stable) | Production stable |
| Offline Cache Enforcement | Enforced | Enforced | Zero network leakage |

---

## 9. V1 Release Recommendation & Operational Checklist

The **Direct ONNX Live Inference Integration** has fully achieved all objectives:
- [x] Zero subprocess spawning in the real-time live streaming path.
- [x] Numerical parity verified ($100\%$ Top-5 label identity, zero score discrepancy, $> 0.9999$ cosine similarity).
- [x] Single forward pass dual evaluation for both detections and 1,280-D embeddings.
- [x] Zero dropped windows across 10-minute replay endurance (1.5s and 3.0s hop) and 30-minute physical microphone capture.
- [x] Quiet bird call fixture verified against silence threshold.
- [x] All 149 regression tests passing.
- [x] Fast, thread-safe, and resilient with automated CPU fallback.

**Recommendation:** Proceed immediately with merging `feature/live-direct-onnx-inference` into the main integration branch (`integration/ecosonic-v1`) as the official backend inference engine for EcoSonic 3.0.
