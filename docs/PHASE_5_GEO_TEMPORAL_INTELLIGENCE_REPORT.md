# ECOSONIC 3.0 — PHASE 5 ENGINEERING REPORT
## GEO-TEMPORAL ENVIRONMENTAL INTELLIGENCE & HABITAT MONITORING

**Document Status:** COMPLETED & VALIDATED  
**Branch:** `feature/geo-temporal-intelligence`  
**Base Integration Commit:** `f6f393b` (Phase 4B Advanced Ecoacoustic Intelligence Engine)  
**Primary Architect:** Principal Geospatial ML Engineer, Bioacoustic Systems Architect & Environmental Data Scientist  
**Date:** November 22, 2026  

---

## 1. EXECUTIVE SUMMARY & ARCHITECTURE OVERVIEW

Phase 5 transitions EcoSonic from an acoustic-only real-time detection platform into a comprehensive, scientifically defensible environmental monitoring and conservation intelligence system. Prior phases established the BirdNET+ V3.0 acoustic classifier, Direct ONNX persistent runtime (36.58 ms median GPU latency), real-time PCM16 WebSocket streaming, Soundscape Fingerprint metrics (ACI, ADI, AEI, NDSI, Spectral Entropy), Disturbance Radar, and Acoustic Memory vector discovery (HDBSCAN and UMAP).

Phase 5 delivers the geospatial, temporal, and human-in-the-loop intelligence layers required for longitudinal habitat monitoring across protected areas, research stations, and bioacoustic transects.

```mermaid
flowchart TD
    subgraph SENSORS ["Physical Sensor Layer"]
        A1["Recording Station (Single-Sensor Mic)"]
        A2["Exact Physical Coordinates (Lat/Lon)"]
    end

    subgraph INGESTION ["Acoustic & Geo Ingestion Layer"]
        B1["Direct ONNX Audio Inference (BirdNET+ V3.0)"]
        B2["BirdNET Geo V3.0 Occurrence Model (14,082 Taxa)"]
        B3["Meteorological Week Converter (48 Weeks/Year)"]
        B4["LRU Spatial Cache (~110m, 1 us lookup)"]
    end

    subgraph INTELLIGENCE ["Analytical & Intelligence Layer"]
        C1["Taxonomy Resolver (10,874 Biological Alignments)"]
        C2["Geographic Occurrence Evaluator (Dual-Score Preservation)"]
        C3["Habitat Drift Engine (Duration-Normalized Hourly Rates, MAD, Robust Z)"]
        C4["Ecosystem Baseline Profiles (8 Ecological Categories)"]
    end

    subgraph GOVERNANCE ["Verification, Triaging & Protection"]
        D1["Location Privacy Engine (Exact, Generalized, Restricted)"]
        D2["Expert Verification Service (Non-Destructive Audit Trail)"]
        D3["Incident Management Engine (Rules-Based Threat Triaging)"]
        D4["Ecological Evidence Reports (Hierarchical JSON & Scientific CSV)"]
    end

    A1 --> A2 --> B3
    A1 --> B1
    A2 --> B2
    B3 --> B2
    B2 --> B4
    B1 --> C1
    B4 --> C2
    C1 --> C2
    C2 --> D2
    B1 --> C3
    C4 --> C3
    C3 --> D4
    A2 --> D1
    D1 --> D4
    C3 --> D3
    D2 --> D4
    D3 --> D4
```

### Key Architectural Invariants
1. **Dual Score Separation:** Acoustic confidence ($C_{\text{acoustic}} \in [0, 1]$) and geographic occurrence suitability ($P_{\text{geo}} \in [0, 1]$) are strictly preserved as distinct independent dimensions. They are **never** multiplied or merged into synthetic composite scalars that would distort biological interpretation.
2. **Strict Spatial Physics:** Single-microphone field stations provide physical coordinates for the recording station **only**. Audio signals recorded on single sensors do not contain phase or time-difference-of-arrival (TDOA) information; sound-source coordinates are **never** fabricated.
3. **Location Sensitivity Protections:** Monitoring sites support three distinct privacy tiers (`exact`, `generalized` to 2-decimal spatial resolution $\approx 1.1\text{ km}$, and `restricted` with full coordinate suppression) to prevent poaching and habitat disturbance of endangered species.
4. **Non-Destructive Verification Workflows:** Human expert reviews are stored in append-only audit records. Model predictions, raw scores, and acoustic features are **never mutated or overwritten**.
5. **Scientific Limitation Disclaimers:** All habitat comparisons and automated incident detections explicitly disclaim assertions of species extinction, absolute population collapse, or criminal culpability without field verification.

---

## 2. BIRDNET GEO V3.0 MODEL ANALYSIS & INTEGRATION

EcoSonic integrates the official `BirdNET Geo V3.0` occurrence model via the official `birdnet` runtime (`birdnet.load("geo", "3.0", "onnx")`). The model evaluates geographic coordinates and seasonal timing to output occurrence probabilities across its species universe.

### 2.1 Model Specifications
- **Model Architecture:** Feedforward Deep Neural Network trained on global eBird observation datasets.
- **Input Features:** Normalized geographic coordinates (latitude $\in [-90, 90]$, longitude $\in [-180, 180]$) and annual week index ($W \in [1, 48]$ or $-1$ for year-round aggregation).
- **Output Classes:** $14,082$ biological species probability vector.
- **Output Activation:** Softmax distribution normalized such that $\sum_{i=1}^{14082} P_i = 1.0$.
- **Runtime Engine:** Microsoft ONNX Runtime with CPU/CUDA execution providers.

### 2.2 BirdNET 48-Week Meteorological System
BirdNET does not use standard 52-week calendar years. Instead, it partitions the 12 calendar months into exactly 4 weeks per month ($12 \times 4 = 48\text{ weeks}$):
- Each month contains 4 sub-weeks of approximately $7.75$ days:
  - Days 1–7: Sub-week 1
  - Days 8–15: Sub-week 2
  - Days 16–23: Sub-week 3
  - Days 24–31: Sub-week 4
- The global week index $W$ is computed analytically:
  $$W = (M - 1) \times 4 + \min\left(4, \left\lfloor \frac{D - 1}{7.75} \right\rfloor + 1\right), \quad W \in [1, 48]$$
- When spatial queries span seasonal aggregations, $W = -1$ computes an unweighted marginal average across all 48 weeks.

### 2.3 LRU Spatial Caching Architecture
Because forward passes through the 14,082-dimensional output layer require $\approx 37.38\text{ ms}$, EcoSonic implements a high-efficiency in-memory spatial cache:
- **Cache Key:** `(round(latitude, 3), round(longitude, 3), week)`
- **Spatial Resolution:** $0.001^\circ \approx 111\text{ meters}$ at the equator. Multiple recordings taken within a field station or live monitoring transect share cached inference vectors.
- **Cache Capacity:** Default 500 entries (LRU eviction).
- **Lookup Latency:** **$1.00\text{ }\mu\text{s}$** median query latency ($999,992\text{ lookups/sec}$), delivering a **$37,375.5\times$ speedup** over raw ONNX execution.

---

## 3. CROSS-MODEL TAXONOMY ALIGNMENT

A fundamental bioacoustic challenge addressed in Phase 5 is the structural divergence between BirdNET's acoustic and geographic models:

| Dimension | BirdNET+ V3.0 (Acoustic) | BirdNET Geo V3.0 (Geographic) |
|---|---|---|
| Total Classes | $11,725$ | $14,082$ |
| Non-Biological Classes | 23 (Chainsaw, Engine, Gun, Fire, etc.) | 0 (Strictly biological taxa) |
| Label Encoding | Separate columns (`scientific_name`, `common_name`, `birdnet_id`, `ebird_code`) | Concatenated string (`Scientific_CommonName`) |
| Array Alignment | Positional indices do NOT match Geo model | Positional indices do NOT match Acoustic model |

### Alignment Implementation
1. **Pre-Indexing:** On service startup, `GeoTemporalIntelligenceService` indexes the $14,082$ Geo species entries into an in-memory hash table keyed by lowercased scientific name (`self._sci_to_geo_idx`).
2. **Biological Matching:** **$10,874$ biological avian and non-avian species** match directly between the acoustic classifier and the geographic occurrence model.
3. **Non-Biological Disturbance Handling:** Anthropogenic sound categories (Chainsaw, Power tool, Engine, Gun, Siren, etc.) are recognized as non-taxonomic classes. They are assigned `geographic_score = None` and `occurrence_status = "not_applicable"`, preventing nonsensical geographic filtering of mechanical disturbances.

---

## 4. GEOGRAPHIC OCCURRENCE SUITABILITY EVALUATION

The geographic occurrence service contextualizes acoustic detections without discarding or suppressing novel discoveries.

### 4.1 Plausibility Categorization Matrix

| Status | Occurrence Score ($P_{\text{geo}}$) | Acoustic Confidence ($C_{\text{acoustic}}$) | Interpretation | Action Taken |
|---|---|---|---|---|
| `expected` | $\ge 0.10$ | Any | Resident or established breeding/migratory species | Standard detection record |
| `rare` | $0.03 \le P_{\text{geo}} < 0.10$ | Any | Known regional occurrence with low seasonal density | Standard detection record |
| `unexpected` | $< 0.03$ | $\ge 0.60$ | High acoustic confidence in an area with low modeled suitability | Flagged: `is_unusual_occurrence=True`, `review_recommended=True` |
| `unlikely` | $< 0.03$ | $< 0.60$ | Low geographic suitability with moderate acoustic confidence | Standard detection record |
| `not_applicable` | `None` | Any | Non-biological anthropogenic disturbance | Preserved as disturbance event |

### 4.2 Non-Exclusionary Philosophy
EcoSonic adheres to the bioacoustic principle that **low modeled suitability does not disprove physical presence**. Avian vagrants, migratory overshoots, range shifts driven by climate change, and escaped birds routinely occur outside modeled distributions. 
Therefore, unexpected predictions are **never silenced or dropped**. Instead, they are flagged with human-readable rationale (e.g., *"Unexpected geographic occurrence: high acoustic confidence (0.92) with very low geographic suitability (0.0000). Possible vagrant, out-of-season migrant, range expansion, or acoustic false positive."*) and queued for expert review.

---

## 5. MONITORING SITE INTELLIGENCE & ECOSYSTEM BASELINES

Monitoring sites anchor long-term acoustic observations. Each site is parameterized with an ecosystem category that sets baseline acoustic tolerances:

### 5.1 Supported Ecosystem Classifications

| Ecosystem Category | Primary Biophony Band | Expected Biophony Ratio | Expected Anthrophony Ratio | Anthrophony Tolerance | Typical Taxa Families |
|---|---|---|---|---|---|
| `temperate_broadleaf_forest` | $2,000 - 7,500\text{ Hz}$ | $0.45 - 0.85$ | $0.05 - 0.25$ | $0.20$ | Parulidae, Turdidae, Picidae |
| `tropical_rainforest` | $1,500 - 10,000\text{ Hz}$ | $0.60 - 0.95$ | $0.00 - 0.15$ | $0.10$ | Thraupidae, Trochilidae, Pipridae |
| `boreal_taiga` | $2,000 - 6,500\text{ Hz}$ | $0.30 - 0.70$ | $0.00 - 0.15$ | $0.15$ | Fringillidae, Paridae, Strigidae |
| `grassland_savanna` | $1,800 - 8,000\text{ Hz}$ | $0.35 - 0.75$ | $0.05 - 0.30$ | $0.25$ | Icteridae, Passerellidae, Alaudidae |
| `shrubland_chaparral` | $2,000 - 7,000\text{ Hz}$ | $0.30 - 0.70$ | $0.05 - 0.30$ | $0.25$ | Mimidae, Troglodytidae |
| `wetland_estuary` | $800 - 6,000\text{ Hz}$ | $0.50 - 0.90$ | $0.05 - 0.25$ | $0.15$ | Ardeidae, Anatidae, Rallidae |
| `agricultural_rural` | $1,500 - 6,500\text{ Hz}$ | $0.25 - 0.65$ | $0.15 - 0.50$ | $0.35$ | Columbidae, Sturnidae, Corvidae |
| `urban_suburban` | $2,000 - 7,000\text{ Hz}$ | $0.20 - 0.55$ | $0.30 - 0.70$ | $0.50$ | Turdidae, Corvidae, Passeridae |

---

## 6. LOCATION PRIVACY PROTECTION & COORDINATE SERIALIZATION

To protect vulnerable, threatened, or endangered wildlife from illegal collection, poaching, or unauthorized human intrusion, EcoSonic provides three location privacy tiers enforced across all public endpoints and reports:

1. **`exact`:** Returns true physical sensor GPS coordinates to authorized researchers:
   $$\text{latitude} = \text{lat}_{\text{true}}, \quad \text{longitude} = \text{lon}_{\text{true}}$$
2. **`generalized`:** Obfuscates coordinates to 2 decimal places ($\approx 1.1\text{ km}$ spatial precision), masking the exact nesting or roosting tree while preserving regional context:
   $$\text{lat}_{\text{gen}} = \text{round}(\text{lat}_{\text{true}}, 2), \quad \text{lon}_{\text{gen}} = \text{round}(\text{lon}_{\text{true}}, 2)$$
3. **`restricted`:** Fully suppresses coordinates in public responses:
   $$\text{latitude} = \text{null}, \quad \text{longitude} = \text{null}$$
   A mandatory privacy note is attached: *"Coordinates restricted for ecological sensitivity protection."*

---

## 7. SCIENTIFIC SOUNDSCAPE NORMALIZATION & DURATION CORRECTION

Comparing acoustic metrics across recordings of differing lengths is a frequent source of error in ecoacoustics. A 6-hour recording will naturally accumulate more raw detections than a 30-minute recording regardless of biological density.

### Duration Normalization Formulae
All detection counts and disturbance occurrences are duration-corrected into standard hourly rates:
$$R_{\text{detection}} = \frac{N_{\text{detections}}}{T_{\text{hours}}} = \frac{N_{\text{detections}}}{\max(0.001, T_{\text{seconds}} / 3600.0)} \quad [\text{detections / hour}]$$
$$R_{\text{disturbance}} = \frac{N_{\text{disturbances}}}{T_{\text{hours}}} = \frac{N_{\text{disturbances}}}{\max(0.001, T_{\text{seconds}} / 3600.0)} \quad [\text{events / hour}]$$

The duration ratio between comparison sessions is explicitly logged:
$$\rho_{\text{duration}} = \frac{T_{\text{target}}}{T_{\text{baseline}}}$$

Raw counts are **never** directly compared without duration normalization.

---

## 8. HABITAT DRIFT ENGINE & STATISTICAL COMPARISONS

The Habitat Drift Engine evaluates whether a monitoring location's soundscape has experienced statistically significant shifts in biophony, anthrophony, or vocalization richness.

### 8.1 Non-Parametric Robust Z-Scores
Because environmental acoustic series contain extreme outliers (e.g., wind gusts, heavy storms, transient machinery), standard mean and standard deviation estimates produce skewed confidence intervals. EcoSonic employs non-parametric Median Absolute Deviation (MAD):

$$\text{Median} = \text{med}(X)$$
$$\text{MAD} = \text{med}\left( |X_i - \text{med}(X)| \right)$$
$$\text{Scale Factor} = 1.4826 \times \text{MAD}$$
$$\text{Robust } Z = \frac{x_{\text{target}} - \text{med}(X)}{\max(10^{-5}, 1.4826 \times \text{MAD})}$$

A metric shift is flagged as statistically significant if $|\text{Robust } Z| \ge 2.5$ or if percentage change exceeds calibrated biological thresholds ($|\Delta \%| \ge 40\%$).

### 8.2 Explainable Drift Categories

| Category | Trigger Conditions |
|---|---|
| `increased_disturbance_activity` | Disturbance frequency rate increase $\ge 1.0\text{ event/hr}$ or $\ge 50\%$ increase |
| `reduced_observed_biological_activity` | Duration-normalized detection rate drops by $\ge 40\%$ |
| `increased_acoustic_diversity` | Observed species richness increases by $\ge 3$ taxa |
| `notable_acoustic_change` | Normalized Difference Soundscape Index ($|\Delta\text{NDSI}| \ge 0.20$) |
| `stable_observed_soundscape` | All metrics remain within baseline tolerance bands |
| `insufficient_baseline_data` | Fewer than 3 historical baseline sessions exist for the site |

---

## 9. EXPERT VERIFICATION & NON-DESTRUCTIVE AUDIT TRAILS

EcoSonic implements a non-destructive human-in-the-loop review architecture. Expert human ornithologists and reserve managers can review and annotate AI predictions without altering raw inference records:

### Verification Invariants
- **Original Scores Preserved:** The original model prediction dictionary (`original_prediction_json`) and raw confidence score (`original_score`) remain immutable.
- **Allowed Verification Decisions:**
  - `confirmed`: Field expert verifies vocalization matches species.
  - `rejected`: False positive or misclassification identified.
  - `uncertain`: Audio evidence is ambiguous or degraded.
  - `needs_more_evidence`: Requires additional recordings or ground inspection.
- **Immutable Audit Trail:** Updating a review decision appends an entry to `history_json` containing the ISO-8601 timestamp, previous decision, new decision, and reviewer notes. Prior history entries are preserved indefinitely.

---

## 10. ENVIRONMENTAL INCIDENT MANAGEMENT & TRIAGING RULES

Qualifying anthropogenic disturbances (from the Disturbance Radar) and extreme acoustic anomalies are structured into operational incident investigation tickets.

### 10.1 Rules-Based Priority Determination

```python
def compute_incident_priority(category, class_label, repetition_count, peak_confidence):
    # Critical environmental hazards
    if class_label in ["Gun", "Explosion", "Fire"]:
        return "critical" if peak_confidence >= 0.50 else "high"
    elif class_label == "Chainsaw":
        if repetition_count >= 3 or peak_confidence >= 0.75:
            return "critical"
        return "high"
    elif class_label in ["Power tool", "Sawing", "Hammer", "Siren"]:
        return "medium"
    elif class_label in ["Aircraft", "Boat", "Engine", "Motor vehicle", "Train"]:
        return "low"
    elif class_label in ["Music", "Fireworks"]:
        return "informational"
    return "medium"
```

### 10.2 Operational Lifecycle
Incidents transition through a defined lifecycle:
$$\text{detected} \longrightarrow \text{under\_review} \longrightarrow \text{confirmed} \lor \text{dismissed} \longrightarrow \text{resolved}$$

Upon resolution (`status="resolved"`), the system records `resolved_at` with resolution notes.

---

## 11. ECOLOGICAL EVIDENCE REPORTING (JSON & CSV)

The reporting module compiles multi-session acoustic observations into structured, publication-ready formats for research and regulatory filing:

### 11.1 Hierarchical JSON Evidence Report
Includes:
- **Metadata Header:** Report UUID, generation timestamp, site metadata, ecosystem category, coordinate privacy representation, model versions (`BirdNET+ V3.0` & `BirdNET Geo V3.0`).
- **Summary Statistics:** Total monitoring sessions, total audio hours analyzed, unique taxa observed, human verified observations count, active incident count.
- **Species Abundance Breakdown:** Full inventory of observed taxa sorted by detection count.
- **Biological Observations Table:** Granular timestamped detections with acoustic confidence and verification status.
- **Anthropogenic Disturbances Table:** Full log of detected disturbance events.
- **Expert Verification Audit Records:** Chronological audit trail of human annotations.
- **Environmental Incidents:** Active and resolved habitat incidents.
- **Disclaimers:** Mandatory scientific limitations disclaimer.

### 11.2 Scientific CSV Export Format
Optimized for R, Pandas, and QGIS:
- Prefaced by a clean `#` commented metadata block containing site parameters and coordinate privacy disclosures.
- Standardized tabular columns: `record_type`, `event_id`, `session_id`, `timestamp`, `scientific_name`, `common_name`, `taxon_group`, `acoustic_confidence`, `start_seconds`, `end_seconds`, `duration_seconds`, `model_version`, `verification_status`.

---

## 12. PERFORMANCE BENCHMARKS & LATENCY EVALUATION

Benchmarks were conducted using `backend/tools/benchmark_phase5_geo_temporal.py` on the real production runtime (Python 3.11.15, Windows x64).

### Benchmark Results Summary

| Benchmark Component | Metric | Measured Value | Notes |
|---|---|---|---|
| **BirdNET Geo V3.0 Model Load** | Load Time | **$359.97\text{ ms}$** | Loads ONNX model + 11,725 taxonomy entries |
| **Model Memory Overhead** | $\Delta\text{RSS}$ | **$+23.19\text{ MB}$** | Very lightweight memory footprint |
| **Cold Geo Inference** | Forward Pass Latency | **$92.05\text{ ms}$** | First execution over 14,082 classes |
| **Warm Geo Inference (N=50)** | Median Latency | **$37.38\text{ ms}$** | p95: $41.02\text{ ms}$, Min: $33.31\text{ ms}$, Max: $44.23\text{ ms}$ |
| **Warm Geo Throughput** | Rate | **$26.8\text{ passes/sec}$** | Continuous execution over global species array |
| **LRU Cache Hit Query (N=1000)** | Median Latency | **$1.00\text{ }\mu\text{s}$** | $0.0010\text{ ms}$ ($999,992\text{ lookups/sec}$) |
| **Cache Speedup Ratio** | Relative Speedup | **$37,375.5\times$** | Massive speedup for repeated site/transect queries |
| **Detection Contextualization (N=300)** | Median Latency | **$0.004\text{ ms}$** | Screening Throughput: **$249,999.9\text{ detections/sec}$** |
| **Robust Z-Score (N=20)** | Calculation Latency | **$21.05\text{ }\mu\text{s}$** | $47,512\text{ calculations/sec}$ |
| **Robust Z-Score (N=500)** | Calculation Latency | **$39.44\text{ }\mu\text{s}$** | $25,355\text{ calculations/sec}$ |
| **JSON Report Generation** | Compilation Latency | **$10.53\text{ ms}$** | 10 sessions, 250 detections, 30 disturbances |
| **Scientific CSV Export** | Export Latency | **$6.44\text{ ms}$** | 57,319 bytes formatted CSV output |
| **Process Memory Footprint** | Peak RSS | **$172.61\text{ MB}$** | Full integrated system with all models loaded |

---

## 13. TEST SUITE VERIFICATION & REGRESSION AUDIT

### 13.1 Phase 5 Specific Suite (`test_phase5_geo_temporal_intelligence.py`)
- **17 tests executed:**
  - `TestModuleAGeoTemporalIntelligence`: 6/6 PASSED (week conversion, coordinate validation, LRU caching, biological contextualization, unexpected species flagging, non-biological disturbance handling).
  - `TestModuleBSiteIntelligence`: 2/2 PASSED (ecosystem baseline profiles, location privacy modes).
  - `TestModuleCHabitatDrift`: 2/2 PASSED (robust Z-scores with MAD, session-vs-session normalized drift calculation).
  - `TestModuleDExpertReview`: 1/1 PASSED (non-destructive review persistence and audit trail).
  - `TestModuleEIncidentManagement`: 2/2 PASSED (priority rules, incident lifecycle and resolution).
  - `TestModuleFEcologicalReports`: 1/1 PASSED (hierarchical JSON and scientific CSV report generation).
  - `TestPhase5ApiIntegration`: 3/3 PASSED (`/geo/contextualize`, `/sites` intelligence endpoints, `/environmental` review and incident endpoints).
- **Execution Time:** **$4.71\text{ seconds}$**
- **Pass Rate:** **100% (17 / 17)**

### 13.2 Full Backend Regression Suite
- **184 total tests collected** (13 real-audio GPU/model benchmarks deselected, 171 fast integration tests executed).
- **Pass Rate:** **100% (171 / 171 PASSED, 0 FAILURES, 0 ERRORS)**.
- **Execution Time:** **$58.62\text{ seconds}$**.
- **Coverage Areas Verified:** Acoustic Memory, UMAP, HDBSCAN, Soundscape Fingerprint, Disturbance Radar, WebSocket streaming ring buffer, session lifecycle, direct ONNX inference, audio robustness matrix, and Phase 5 geo-temporal intelligence.

---

## 14. LIMITATIONS, SCIENTIFIC DISCLAIMERS & PHASE 6 RECOMMENDATIONS

### 14.1 Known Scientific & Hardware Limitations
1. **Single-Microphone Physical Constraint:** Directional arrival angles and sound-source distance cannot be calculated without synchronized microphone arrays or time-difference-of-arrival (TDOA) hardware.
2. **Occurrence Suitability vs. Biological Presence:** BirdNET Geo predictions reflect regional eBird observation probabilities. A high score does not guarantee presence; a low score does not disprove presence.
3. **Legal Non-Culpability:** Disturbance detections (e.g. chainsaw or engine acoustic signatures) do not constitute evidence of illegal logging or environmental crime without ground inspection.
4. **Non-Extinction Disclaimer:** Habitat drift metrics report statistical changes in vocalization rates and soundscape indices. They do not substantiate biological population extinction.

### 14.2 Phase 6 Recommendations
1. **Frontend Integration:** Build the EcoSonic React / Next.js web application consuming the frozen API contract, featuring an interactive habitat drift dashboard and incident management Kanban board.
2. **Synchronized Multi-Sensor TDOA Localization:** Integrate hardware array support for acoustic triangulation of poachers, gunshots, and chainsaw signatures.
3. **Automated Scheduled Drift Audits:** Implement daily/weekly background cron workers using the habitat drift engine to compute automated habitat health digests.
