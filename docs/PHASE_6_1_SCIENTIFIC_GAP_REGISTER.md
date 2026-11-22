# EcoSonic 3.0 — Phase 6.1 Scientific Gap Register

**Audit Date:** 2026-11-22  
**Auditor:** Principal ML Systems Engineer & Scientific Validation Lead  
**Release Target:** `integration/ecosonic-v1-release`  
**Registry Purpose:** Exhaustively reconcile claims made in Phase 6 documentation against reproducible empirical findings. Categorizes every finding as **REPRODUCED**, **QUALIFIED**, or **SCIENTIFIC GAP**.

---

## 1. Summary of Verification Findings

| Dimension | Phase 6 Claim | Phase 6.1 Empirical Finding | Status | Action / Correction Taken |
|---|---|---|---|---|
| **Acoustic Model Accuracy** | "Acoustic Model Accuracy: PASS (High multi-taxa accuracy across Aves, Amphibia, Insecta)" | **No time-aligned ground-truth annotations exist in the repository.** Smoke recordings (`birds_forest.ogg`, `frog_mixed.ogg`, `cicada_orni.ogg`) only have informal uploader tags in `sources.json`. Detections prove **operational inference capability**, not verified biological precision or recall. | **QUALIFIED (Inference Demonstration)** | Relabeled in documentation from "Model Accuracy Validation" to "Operational Multi-Taxa Inference Demonstration". Registered in Gap Register. |
| **Geographic Taxonomy Mapping** | "100% Taxonomy Reconciliation" | Exact matches: **10,874 / 11,725 classes (92.74%)**. 16 non-taxonomic disturbance classes correctly mapped to `None` (`status="not_applicable"`). Remaining 835 classes are accounted for: **564 non-avian classes** unmodeled by eBird Geo model, **43 taxonomic synonyms / splits**, and **228 remote island endemics**. | **QUALIFIED (Explained Discrepancy)** | Fully accounted for in code and documentation; fallback status `"unmodeled"` correctly assigned with zero runtime crashes. |
| **Spatial Cache Resolution** | "0.001° spatial quantization provides uniform ~111m spatial resolution across Earth" | 0.001° latitude is constant at **~111.32 meters**, but longitudinal distance scales with $\cos(\text{latitude})$. At 45°N (temperate zone), 0.001° longitude is **~78.71 meters**; at 60°N (boreal zone), it is **~55.66 meters**. | **CORRECTED (Geodesic Scaling)** | Corrected docstring in `geo_temporal_service.py` (line 207) to remove claim of uniform 111m resolution, explicitly documenting geodesic latitude dependence. |
| **Soundscape Scale Invariance** | "Soundscape metrics (ADI, AEI, NDSI, Entropy) are scale invariant across -12 dB to +12 dB" | **Mathematically invariant under ideal linear scaling** ($\Delta = 0.0000$ for ADI, AEI, NDSI, Entropy). However, scale invariance **breaks down in physical field hardware**: extreme silence ($< 10^{-4}$ RMS), digital clipping ($> 0.999$), sensor frequency response roll-offs, and preamp analog noise floors. | **QUALIFIED (Hardware Limitations Defined)** | Added physical hardware limitation boundaries to `SoundscapeFingerprintEngine` documentation, detailing the impact of hardware gain, clipping, and microphone frequency response. |
| **Disturbance Radar Evaluation** | "Disturbance Radar: PASS across all industrial hazard classes" | Temporal bout merging works as designed (repeated chainsaw detections within 10s merge into single incident with peak confidence). However, **no empirical false-positive evaluation on severe wind, heavy rain, or waterfall noise was performed against an annotated benchmark**. | **QUALIFIED (Screening Tool Only)** | Maintained and enforced `SCIENTIFIC_DISTURBANCE_DISCLAIMER`. Detections documented strictly as uncalibrated screening alerts, not legal evidence. |
| **Acoustic Memory & Parity** | "FAISS vs NumPy Brute Force Parity: PASS" | **100% reproduced.** Exact score parity ($\max|\Delta| = 3.35 \times 10^{-8}$) and 100% Recall@1, Recall@5, and Recall@10 on 1,280-D vectors. | **REPRODUCED** | Verified in `audit_phase6_1_scientific_deep_dive.py`. |
| **Acoustic Anomaly Scoring** | "Acoustic Anomaly Score: PASS (Accurate detection of novel ecological sounds)" | Heuristic formula $S = 0.40 d_{\text{knn}} + 0.30 H_{\text{spec}} + 0.30 A_{\text{model}}$ produces an **uncalibrated outlier rank $[0.0, 1.0]$**, NOT a calibrated biological probability. High scores reflect acoustic out-of-distribution properties (e.g. mic thumps, rain on enclosure, unmodeled signal), not necessarily rare or endangered species. | **QUALIFIED (Heuristic Transparency)** | Added explicit transparency note and enforced `SCIENTIFIC_ANOMALY_DISCLAIMER`. |
| **Habitat Drift Analysis** | "Habitat Drift Detection: PASS" | Robust statistics (Median + MAD with $1.4826 \cdot \text{MAD}$) are mathematically proven resilient against extreme outlier contamination ($Z_{\text{robust}} = 2.70$ vs $Z_{\text{standard}} = -0.23$). Guardrail requiring $\ge 3$ baseline sessions and diurnal slotting enforced. | **REPRODUCED** | Documented that acoustic drift measures statistical distribution divergence, NOT biological extirpation or population census decline. |
| **Hot Database Backup** | "SQLite Backup & Disaster Recovery: PASS" | SQLite Online Backup API successfully copies `ecosonic.db` during active writes in 80.13 ms. **However, SQLite backup alone preserves 0 bytes of external audio files (379 MB, 2,040 WAVs, 1,103 NPYs).** Restoring `ecosonic.db` alone leaves dangling foreign references. | **SCIENTIFIC / DEPLOYMENT GAP** | Authored concrete 4-step backup protocol combining SQLite backup with atomic filesystem storage snapshots in `DEPLOYMENT_GUIDE.md`. |
| **Docker Container Runtime** | "Production Docker Deployment: PASS" | Multi-stage Dockerfile and docker-compose.yml are well-structured (non-root UID 10001, single worker constraint). **However, container runtime tests could not be executed because the host Docker Desktop engine is offline.** | **BLOCKED (Offline Daemon)** | Formally reported as BLOCKED (Runtime Execution) / PASS (Static Validation) in `PHASE_6_1_DOCKER_VERIFICATION.md`. |

---

## 2. Detailed Gap Analysis & Remediations

### GAP-01: Absence of Ground-Truth Acoustic Benchmarks
- **Description:** Phase 6 validation used 3 audio files (`birds_forest.ogg`, `frog_mixed.ogg`, `cicada_orni.ogg`) located in `backend/data/smoke_audio/`. The file `sources.json` contains public web metadata but no Raven Pro selection tables, Audacity label tracks, or time-stamped expert bioacoustic annotations.
- **Scientific Impact:** Calculating genuine Precision, Recall, or F1 scores without ground-truth annotations is scientifically invalid. Detections only verify that the ONNX Runtime forward pass executes, extracts logits, applies the softmax function, and filters by threshold.
- **Remediation:** All documentation is updated to characterize tests as **Operational Multi-Taxa Inference Demonstrations**. For production release, an annotated bioacoustic benchmark dataset (e.g., BirdVox, XC-benchmark, or Sierra Nevada bioacoustic corpus) must be curated before publishing accuracy claims.

---

### GAP-02: Taxonomic Discrepancy Accounting (835 Classes)
- **Description:** BirdNET+ V3.0 acoustic model classifies 11,725 classes. BirdNET Geo model contains 14,082 species. Exact name matches exist for 10,874 classes (92.74%). Phase 6 documentation vaguely claimed "reconciliation complete" without detailing the fate of the remaining 851 classes.
- **Empirical Audit Breakdown:**
  1. **16 Non-Taxonomic Disturbance Classes:** (`Aircraft`, `Chainsaw`, `Gun`, etc.) -> properly mapped to `occurrence_score = None`, `status = "not_applicable"`.
  2. **564 Non-Avian Taxa:** The acoustic model was expanded in V3.0 to include insects (348), amphibians (98), mammals (67), fish (35), reptiles (15), and arachnids (1). The BirdNET Geo model was trained solely on eBird avian checklists and contains no occurrence data for non-avian taxa.
  3. **43 Taxonomic Synonyms / Splits:** Avian species with divergent scientific nomenclature between acoustic and geo models (e.g. *Grus paradisea* vs *Anthropoides paradiseus*).
  4. **228 Remote Island Endemics:** Species restricted to oceanic islands or remote archipelagos where eBird checklists lacked sufficient spatial density.
- **Remediation:** The fallback policy in `geo_temporal_service.py` returns `occurrence_score = None` with `status = "unmodeled"` for all 835 classes without crashing or distorting acoustic scores. This is now fully documented.

---

### GAP-03: Geodesic Spatial Cache Distortion
- **Description:** `geo_temporal_service.py` docstring claimed a uniform ~111m spatial resolution from 0.001° coordinate rounding.
- **Mathematical Reality:** While 1° of latitude is approximately 111.32 km globally (0.001° $\approx$ 111.32 m), longitudinal distance per degree is given by $111.32 \times \cos(\text{latitude})$ km.
  - At Equator ($0^\circ$): $\Delta x \approx 111.32$ m
  - At Ithaca, NY ($42.48^\circ\text{N}$): $\Delta x \approx 82.10$ m
  - At Fontainebleau, France ($48.40^\circ\text{N}$): $\Delta x \approx 73.91$ m
  - At Fairbanks, Alaska ($64.84^\circ\text{N}$): $\Delta x \approx 47.33$ m
- **Remediation:** Docstring in `geo_temporal_service.py` corrected to document geodesic latitude scaling.

---

### GAP-04: Soundscape Metric Field Robustness Limits
- **Description:** Soundscape metrics (ADI, AEI, NDSI, Spectral Entropy) were reported as "scale invariant." Under linear digital gain, this is mathematically exact. However, real environmental sensors exhibit physical nonlinearities.
- **Breakdown Scenarios Identified:**
  1. **Extreme Silence ($< 10^{-4}$ RMS):** Floating-point quantization and epsilon terms dominate the denominator, producing undefined or erratic NDSI and entropy.
  2. **Digital Clipping ($> 0.999$ amplitude):** Harmonic distortion generates artificial high-frequency energy, corrupting NDSI and inflating spectral entropy.
  3. **Hardware Frequency Response:** Microphones with high-pass roll-offs ($< 500$ Hz) suppress anthropogenic low-frequency rumble, artificially inflating biological NDSI.
  4. **Analog Preamp Noise:** Poor preamps raise the noise floor across empty bands, driving AEI toward 1.0 (false maximum evenness).
- **Remediation:** Added explicit quality flags (`clipping_detected`, `silent_window`, `low_snr`) in `SoundscapeFingerprintEngine` and documented field sensor constraints.

---

### GAP-05: External Storage Disaster Recovery Disconnect
- **Description:** EcoSonic stores metadata in SQLite (`ecosonic.db`), but persists binary audio segments (`.wav`) in `backend/storage/live_audio/` and embedding vectors (`.npy`) in `backend/storage/embeddings/` (currently totaling 379.14 MB across 3,143 files).
- **Vulnerability:** Standard SQLite backups (`VACUUM INTO` or `sqlite3.backup`) back up only the database file. Restoring from a database backup without a synchronized storage snapshot creates 2,335 database records pointing to missing filesystem assets.
- **Remediation:** Mandated a coordinated, atomic two-stage backup procedure in `DEPLOYMENT_GUIDE.md` combining database snapshots with storage directory archives.
