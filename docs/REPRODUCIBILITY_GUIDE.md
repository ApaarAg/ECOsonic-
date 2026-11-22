# ECOSONIC 3.0 — REPRODUCIBILITY GUIDE

**Release:** EcoSonic 3.0.0  
**Target:** Scientific & Engineering Verification  
**Environment:** Python 3.11, ONNX Runtime 1.32.0, CUDA 12.x / CPU fallback  

---

## 1. Overview

This guide provides step-by-step instructions to reproduce all empirical benchmarks, scientific validation experiments, endurance audits, and data integrity tests reported in the EcoSonic 3.0 Phase 6 release suite.

---

## 2. Environment Setup

### 2.1 Python Environment & Dependencies
Clone the repository, checkout the release branch, and establish an isolated virtual environment:

```bash
git checkout integration/ecosonic-v1-release

# Create virtual environment
python -m venv .venv

# Activate environment (Windows PowerShell)
.venv\Scripts\Activate.ps1
# (Linux/macOS)
source .venv/bin/activate

# Install exact frozen dependencies
pip install -r requirements-frozen.txt
```

### 2.2 Offline Model Cache Provisioning
Verify that pre-downloaded model artifacts and taxonomy files are positioned under `.model_cache`:

```
.model_cache/
├── acoustic-models/
│   └── v3.0/
│       ├── onnx/
│       │   ├── model-fp32-e78c3b50e224.onnx
│       │   └── labels/
│       │       └── en_us.txt
│       └── labels_raw-88d976477fac.csv
├── geo-models/
│   └── 3.0/
│       └── model.onnx
└── taxonomy-v3/
```

Set the model cache environment variable:
```bash
# Windows PowerShell
$env:BIRDNET_APP_DATA = "$PWD\.model_cache"
$env:PYTHONPATH = "backend;.backend"

# Linux / Bash
export BIRDNET_APP_DATA="$(pwd)/.model_cache"
export PYTHONPATH="backend"
```

---

## 3. Automated Benchmark Execution

### 3.1 Stage B: Comprehensive Scientific Validation
Executes all 7 scientific intelligence modules:
1. BirdNET Acoustic Model Validation (multi-taxa, threshold sensitivity, temporal window)
2. BirdNET Geo V3.0 Occurrence Model & Taxonomy Reconciliation
3. Soundscape Fingerprint Stability & Parameter Sensitivity
4. Disturbance Radar Class Evaluation & Bout Deduplication
5. Acoustic Memory Similarity & Manifold Validation (FAISS vs NumPy parity, Recall@K, HDBSCAN, UMAP)
6. Acoustic Anomaly Heuristic Sensitivity Analysis
7. Habitat Drift Statistical Validation (robust Z-scores, MAD, 3-session baseline)

**Command:**
```powershell
.venv\Scripts\python.exe backend\tools\validate_scientific_intelligence.py
```

**Expected Artifacts Generated:**
- `docs/taxonomy_reconciliation_report.json`
- `docs/scientific_validation_results.json`

**Expected Acceptance Thresholds:**
- FAISS vs NumPy Max Absolute Difference: $|\Delta| < 10^{-5}$ (Observed: $2.38 \times 10^{-7}$)
- Retrieval Recall: $\text{Recall@1} = 100\%$, $\text{Recall@5} = 100\%$
- UMAP Determinism: Max coordinate diff $= 0.00$ with `random_state=42`
- Geo Taxonomy Match: $> 90\%$ (Observed: $92.74\%$, 10,874 species)

---

### 3.2 Stage C: Sustained System Endurance & Reliability Audit
Executes 5-minute continuous real-time streaming replay, failure injection (abrupt socket disconnects, corrupted frames), and multi-session concurrency capacity tests.

**Command:**
```powershell
.venv\Scripts\python.exe backend\tools\audit_phase6_sustained_endurance.py
```

**Expected Artifacts Generated:**
- `docs/phase6_endurance_results.json`

**Expected Acceptance Thresholds:**
- Dropped Windows: $0$ (Drop rate: $0.00\%$)
- Memory Leak: Net RSS Growth $< 50\text{ MB}$ (Observed: $-53.37\text{ MB}$)
- Abrupt Disconnect Shutdown Latency: $< 500\text{ ms}$ (Observed: $84.09\text{ ms}$)
- Concurrency: $\ge 3$ simultaneous live streams with 0 dropped windows

---

### 3.3 Stage D: Production Storage & Data Integrity Verification
Tests SQLite WAL PRAGMAs, atomic audio segment writes, online hot database backup, and post-restart persistence fidelity.

**Command:**
```powershell
.venv\Scripts\python.exe backend\tools\verify_storage_and_restart.py
```

**Expected Artifacts Generated:**
- `docs/stage_d_storage_integrity_results.json`

**Expected Acceptance Thresholds:**
- SQLite Journal Mode: `WAL`
- Physical WAV File Duration: $3.0\text{s} \pm 0.01\text{s}$ at $32,000\text{ Hz}$
- Hot Backup PRAGMA integrity_check: `ok` (Duration $< 1.0\text{s}$)
- Restart Persistence Fidelity: `True` (100% entity retrieval)

---

### 3.4 Stage E: Security, Privacy & Input Hardening
Tests path traversal resistance across 6 injection vectors and validates coordinate masking policies across exact, generalized, and restricted modes.

**Command:**
```powershell
.venv\Scripts\python.exe backend\tools\verify_security_and_privacy.py
```

**Expected Artifacts Generated:**
- `docs/stage_e_security_privacy_results.json`

**Expected Acceptance Thresholds:**
- Path Traversal Confined: `True` (100% of payloads confined to session root)
- Privacy Policies Enforced: `True` (`exact`, `generalized` rounded to $0.01^\circ$, `restricted` withheld)

---

### 3.5 Full Fast Regression Test Suite
Runs the complete fast backend test suite:

**Command:**
```powershell
.venv\Scripts\python.exe -m pytest backend/tests/ -m "not real_model"
```

**Expected Outcome:** 171 passed, 0 failed.
