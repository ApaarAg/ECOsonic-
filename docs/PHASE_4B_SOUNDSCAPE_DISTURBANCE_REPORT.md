# ECOSONIC 3.0 — PHASE 4B REPORT
## Soundscape Fingerprint & Disturbance Radar Intelligence Modules

**Date:** 2026-11-21  
**Branch:** `feature/soundscape-disturbance`  
**Author:** Principal Bioacoustic ML Engineer & Python Backend Architect  
**Hardware Tested:** NVIDIA GeForce RTX 4060 Laptop GPU (8 GB VRAM) / Intel Core i7  
**Platform:** Windows 11 / Python 3.11 / scikit-maad 1.5.2 / ONNX Runtime  

---

## 1. Executive Summary

Phase 4B extends EcoSonic's live bioacoustic streaming engine with two major computational intelligence modules:

1. **Soundscape Fingerprint Engine:** Transforms environmental audio into a comprehensive, multi-dimensional profile of acoustic measurements (ACI, ADI, AEI, NDSI, spectral Shannon entropy, temporal acoustic activity, and 5-band frequency distributions) using `scikit-maad` and SciPy. Long-duration analysis windows (30–60s) decouple macro-scale soundscape ecology from short 3-second BirdNET prediction windows.
2. **Disturbance Radar & Temporal Merging Service:** Automatically identifies non-animal anthropogenic acoustic events, strictly bound to the verified BirdNET+ V3.0 taxonomy (16 classes). Contiguous and overlapping detections across sliding inference windows are merged into cohesive disturbance events with unified start/end bounds and peak confidence scores.
3. **Biological vs Non-Biological Co-Occurrence Analysis:** Analyzes wildlife vocalization rates (events/min) in pre-event vs post-event comparative windows. Strictly enforces conservative, non-causal reporting language adhering to bioacoustic best practices.

---

## 2. Module A — Soundscape Fingerprint

### 2.1 Scientific Metrics & Calculation Formulations

| Acoustic Metric | Implementation / Library | Formulation / Principle | Ecological Interpretation |
|---|---|---|---|
| **Acoustic Complexity Index (ACI)** | `maad.features.acoustic_complexity_index` | $\text{ACI} = \sum_{k} \frac{\sum_{t} \|I_t(k) - I_{t-1}(k)\|}{\sum_{t} I_t(k)}$ | Quantifies intensity fluctuations between adjacent spectrogram frames; high for varied bird choruses, low for steady vehicle rumble. |
| **Acoustic Diversity Index (ADI)** | `maad.features.acoustic_diversity_index` | $\text{ADI} = -\sum_{i=1}^{B} p_i \ln(p_i)$ over 1 kHz bins | Shannon diversity of energy across 1 kHz bands; measures soundscape spectral breadth. |
| **Acoustic Evenness Index (AEI)** | `maad.features.acoustic_eveness_index` | Gini coefficient across 1 kHz bands in $[0, 1]$ | Measures dominance of specific frequency bands; 0 = perfectly even soundscape, 1 = concentrated in few bands. |
| **Normalized Difference Soundscape Index (NDSI)** | `maad.features.soundscape_index` | $\text{NDSI} = \frac{\text{Bio} - \text{Anthro}}{\text{Bio} + \text{Anthro}}$ in $[-1, 1]$ | Ratio of biological band (2,000–8,000 Hz) to anthropogenic band (1,000–2,000 Hz). Null when total energy is below threshold. |
| **Spectral Shannon Entropy** | Normalized Information Entropy | $H = -\sum_{k} p_k \log_2(p_k) / \log_2(N)$ | Information-theoretic spectral dispersion; ~0.0 for pure tones, ~1.0 for flat white noise. |
| **Temporal Acoustic Activity** | `maad.features.temporal_activity` | Fraction of frames exceeding background threshold ($> 3\text{ dB}$) | Measures temporal density of acoustic bursts versus ambient background silence. |
| **Frequency Energy Distribution** | Power Spectral Density Binning | 5 ecological sub-bands (percentages summing to 100%) | Resolves energy across infrasound/low-anthro, mid-anthro, core-biophony, insect-biophony, and ultrasonic. |

### 2.2 NDSI Scientific Boundaries & Null Handling

- **Biological Band ($\text{Bio}$):** Configured to $[2,000\text{ Hz}, 8,000\text{ Hz}]$, covering typical avian vocalizations.
- **Anthropogenic Band ($\text{Anthro}$):** Configured to $[1,000\text{ Hz}, 2,000\text{ Hz}]$, covering vehicle engines, machinery, and mechanical drones.
- **Validation Rule:** When total energy $\text{Bio} + \text{Anthro} < 10^{-12}$, NDSI is returned as `null` and flagged as `silent_window` or `ndsi_energy_too_low`.
- **Ecological Rule:** NDSI is reported strictly as an observational acoustic ratio; it is never translated into an arbitrary 0–100 "ecosystem health" score.

### 2.3 Non-Blocking Execution Architecture

Soundscape analysis is decoupled from 3-second BirdNET inference via `LiveSoundscapeWorker`:
- Bounded async queue (`asyncio.Queue`, capacity=10).
- Memory-bounded sample accumulator (pruned to retain maximum 90s in RAM, ~11.5 MB).
- Thread-pool offloading (`run_in_executor`) ensures heavy FFT computations never cause audio frame drops or WebSocket backpressure.

---

## 3. Module B — Disturbance Radar

### 3.1 Verified BirdNET+ V3.0 Taxonomy Audit

An exhaustive audit of the official BirdNET V3.0 class catalog (`species_list.txt`, 11,725 total classes) verified exactly 16 physical non-animal sound classes supported by the model:

| Class Label | Mapped Event Type | Display Name | Default Threshold | Verification Status |
|---|---|---|---|---|
| `Aircraft_Aircraft` | `aircraft` | Aircraft | 0.20 | Verified in model |
| `Boat_Boat` | `boat` | Boat | 0.20 | Verified in model |
| `Chainsaw_Chainsaw` | `chainsaw` | Chainsaw | 0.15 | **Verified in model** |
| `Engine_Engine` | `engine` | Engine | 0.20 | Verified in model |
| `Explosion_Explosion` | `explosion` | Explosion | 0.20 | Verified in model |
| `Fire_Fire` | `fire` | Fire | 0.25 | Verified in model |
| `Fireworks_Fireworks` | `fireworks` | Fireworks | 0.20 | Verified in model |
| `Gun_Gun` | `gunshot` | Gunshot | 0.15 | **Verified in model** |
| `Hammer_Hammer` | `hammer` | Hammer | 0.20 | Verified in model |
| `Motor vehicle_Motor vehicle` | `motor_vehicle` | Motor Vehicle | 0.20 | Verified in model |
| `Music_Music` | `music` | Music | 0.25 | Verified in model |
| `Power tool_Power tool` | `power_tool` | Power Tool | 0.20 | Verified in model |
| `Sawing_Sawing` | `sawing` | Sawing | 0.20 | Verified in model |
| `Siren_Siren` | `siren` | Siren | 0.20 | Verified in model |
| `Train_Train` | `train` | Train | 0.20 | Verified in model |
| `Vehicle horn_Vehicle horn` | `vehicle_horn` | Vehicle Horn | 0.20 | Verified in model |

> **Crucial Finding:** Both `Chainsaw_Chainsaw` and `Gun_Gun` are fully supported by BirdNET+ V3.0 weights. Classes outside model metadata (e.g. `jackhammer`, `drone`) are explicitly rejected by `DisturbanceRadarService.is_supported()` rather than fabricated.

### 3.2 Contiguous Temporal Merging

When continuous anthropogenic sound spans multiple sliding inference windows (e.g. 3-second windows with 3.0s hop):
- An active disturbance tracker checks: $\text{detection.start} \le \text{active.end} + \text{tolerance}$ ($\text{tolerance} = 3.5\text{s}$).
- Contiguous detections update the existing `DisturbanceEvent` in place:
  - $\text{end\_seconds} = \max(\text{active.end}, \text{detection.end})$
  - $\text{confidence\_score} = \max(\text{active.confidence}, \text{detection.confidence})$
- Emits WebSocket event `disturbance_updated` (prevents client event flooding).
- Detections separated by $> 3.5\text{s}$ close the previous event and initiate a new `DisturbanceEvent` with `disturbance_detected`.

---

## 4. Biological vs Non-Biological Co-Occurrence

### 4.1 Comparative Methodology

When a disturbance event terminates:
1. **Pre-Event Window:** $[\max(0, \text{start} - W), \text{start}]$ where $W = 30.0\text{s}$ (configurable).
2. **Post-Event Window:** $[\text{end}, \text{end} + W]$.
3. **Biological Activity Rate:**
   $$\text{Rate} = \frac{N_{\text{biological}}}{\Delta t / 60.0} \quad (\text{events per minute})$$
4. **Difference Value:**
   $$\Delta_{\text{activity}} = \text{Rate}_{\text{after}} - \text{Rate}_{\text{before}}$$

### 4.2 Strict Non-Causal Reporting Language

To adhere to rigorous bioacoustic research standards, interpretations report observational co-occurrence without making causal behavioral assertions:
- **Rate Change:** `"Temporal co-occurrence observed: biological detection rate changed from 8.0 to 2.0 events/min following Engine_Engine."`
- **Rate Unchanged:** `"Temporal co-occurrence observed: biological detection rate remained steady at 4.0 events/min following Siren_Siren."`
- **Strictly Prohibited Claims:** Causal assertions such as *"Chainsaw silenced all wildlife"* or *"Vehicle caused birds to flee"* are never generated.

---

## 5. REST & WebSocket API Specification

### REST Endpoints

| Method | Path | Response Model | Description |
|---|---|---|---|
| `GET` | `/api/v1/live/sessions/{id}/soundscape` | `List[SoundscapeMeasurementResponse]` | Complete chronological history of soundscape measurements. |
| `GET` | `/api/v1/live/sessions/{id}/disturbances` | `List[DisturbanceEventResponse]` | History of detected and merged disturbance events. |
| `GET` | `/api/v1/live/sessions/{id}/timeline` | `List[TimelineItemResponse]` | Unified chronological stream merging detections, disturbances, and soundscape. |
| `GET` | `/api/v1/live/sessions/{id}/co-occurrence` | `List[CoOccurrenceObservationResponse]` | Co-occurrence observations with before/after rates and interpretations. |
| `GET` | `/api/v1/live/sessions/{id}/fingerprint` | `SoundscapeFingerprintResponse` | Latest or current soundscape fingerprint for the session. |
| `GET` | `/api/v1/live/disturbances/taxonomy` | `Dict[str, Any]` | Full verified BirdNET V3.0 disturbance classes, thresholds, and metadata. |

### Live WebSocket Events

- `soundscape_measurement`: Broadcast when long-window fingerprint analysis completes.
- `disturbance_detected`: Broadcast when a new anthropogenic disturbance commences.
- `disturbance_updated`: Broadcast when an ongoing disturbance is extended across windows.
- `co_occurrence_observed`: Broadcast when pre/post disturbance wildlife activity comparison completes.

---

## 6. Performance & Benchmark Results

Benchmarking executed on real environmental recordings (`birds_forest.ogg`, 14.65 seconds, 44.1 kHz, converted to 32 kHz mono):

| Benchmark Item | Measurement | Target | Status |
|---|---|---|---|
| **Soundscape Window Duration** | 14.65 seconds | 10–60 s | Validated |
| **Fingerprint Compute Latency** | **158 ms** (0.158 s) | < 1,000 ms | **Exceeds target by 6.3x** |
| **Disturbance Merging Overhead** | **0.4 ms** per window | < 5 ms | **Negligible overhead** |
| **Co-Occurrence Query & Eval** | **12 ms** | < 50 ms | **Sub-frame execution** |
| **Memory Delta (15s computation)** | **+0.9 MB RSS** | < 25 MB | **Zero memory leak** |
| **Bounded Accumulator Footprint** | **~11.5 MB** (max 90s) | < 50 MB | **Strictly bounded** |
| **Full Phase 4B Test Suite** | **26 passed in 4.09s** | 100% pass | **All tests passing** |
