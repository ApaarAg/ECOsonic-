# ECOsonic — Backend Completion Report

## 1. Existing Backend Capabilities (Before Completion)
Before this completion pass, the backend already implemented:
- **File analysis ingestion & BirdNET inference:** `POST /api/v1/analyses`, `GET /api/v1/analyses/{id}`, `/results`, `/detections`, audio validation/resampling to 32 kHz mono WAV (`audio_processor.py`), BirdNET+ V3.0 ONNX predictions & 1,280-D embeddings (`birdnet_engine.py`, `analysis_pipeline.py`), persisted in SQLite (`analyses`, `detections`, `embedding_segments`).
- **Live streaming & Direct ONNX inference:** `POST /api/v1/live/sessions`, `WS /api/v1/live/sessions/{id}/stream`, `DirectOnnxEngine`, rolling ring buffer, persisted `LiveSession` / `LiveSegment` / `LiveEvent`.
- **Soundscape & Disturbance Radar (Live only):** `SoundscapeFingerprintEngine` (`scikit-maad` ACI, ADI, AEI, NDSI, spectral entropy, temporal activity, 5 frequency bands), `DisturbanceRadarService` (`disturbance_events`), and `CoOccurrenceService` (`co_occurrence_observations`).
- **Expected Species & Observation Gap (Live session / Sites only):** `GeoTemporalIntelligenceService` (`BirdNET Geo V3.0 ONNX`), `BirdNetGeoKnowledgeProvider`, `ObservationGapEngine`, exposed via `POST /api/v1/ecology/observation-gap` and `GET /api/v1/sites/{id}/geo-context`.

## 2. Previously Disconnected or Semantically Incomplete Sections
1. **Species classification gaps:** Both `BirdNetEngineAdapter` and `DirectOnnxEngine` assigned `taxon_group = "Unknown"` to biological classes and omitted taxonomy IDs/eBird codes despite `.model_cache/acoustic-models/v3.0/labels_raw-88d976477fac.csv` containing all 11,725 BirdNET V3.0 classes. Non-biological sound classes (`sound_class`) were mixed with biological detections inside `GET /api/v1/detections`, `GET /api/v1/analyses/{id}`, and `GET /api/v1/reports/summary` (counting `"Unknown"` in species richness). On the frontend, `Act07To10Overlay` (`ACT 07 · SPECIES`) read `snapshot.detections[0]` even when it was `recordType === "sound_class"`.
2. **Batch analysis disconnect:** Uploaded audio analyses (`POST /api/v1/analyses`) computed BirdNET predictions and embeddings, but never ran soundscape indices, semantic species partitioning, disturbance analysis, context synthesis, BirdNET Geo expected species, or observation-gap calculation.
3. **Disturbance score & attribution gap:** Live sessions emitted individual merged events (`disturbance_events`), while uploaded analyses lacked disturbance synthesis and neither pipeline exposed a bounded, documented measurable Disturbance Index combining anthropogenic event metrics with spectral pressure (`1–2 kHz` energy & NDSI) and non-causal co-occurrence.
4. **Context disconnect:** `Analysis` had no aggregated `context` (`recording_context`, `acoustic_context`, `biological_context`, `anthropogenic_context`, `temporal_context`).
5. **Expected Species & Observation Gap `reference_unavailable` ambiguity:** Missing coordinates returned `[]` in `get_expected_species` without explicitly distinguishing an empty ecological reference (`empty_reference`) from missing location (`location_unspecified`) or provider failure (`reference_unavailable`). Frontend Scenes 10–12 (`ecosonicEcologyApi.ts`) only queried `/live/sessions` and `/sites`, leaving uploaded `/analyses` disconnected.

## 3. Species Classification Architecture (`semantic_classification.py`)
- **Evidence Source (`MODEL-BASED` + local BirdNET V3.0 vocabulary CSV):** Indexes `.model_cache/acoustic-models/v3.0/labels_raw-88d976477fac.csv` (`11,725` classes: `9,788` Aves, `802` Insecta, `649` Amphibia, `419` Mammalia, `35` Actinopterygii, `15` Reptilia, `1` Arachnida, `14` Anthropogenic, `1` Geophony [`Fire`], `1` Music).
- **Semantic Buckets:**
  - `biological` (`record_type = "animal"`): Verified biological taxa (`bird`, `amphibian`, `insect`, `mammal`, `reptile`, `fish`, `arachnid`) meeting `min_reliable_confidence` (`>= 0.15`), enriched with exact `taxon_group`, `birdnet_taxonomy_id`, `ebird_code`, and provenance.
  - `non_biological_anthropogenic` / `non_biological_geophony` (`record_type = "sound_class"`): BirdNET's 16 non-animal classes plus exact sound-class vocabulary (`human`, `human vocal`, `speech`, `vehicle`, `machinery`, `construction`, `alarm`, `wind`, `rain`, `thunder`). Partial substring matching against underscore-delimited non-BirdNET tokens is strictly prevented.
  - `unknown` (`record_type = "unknown"`): Unmapped/ambiguous labels, non-finite/out-of-range confidences, or biological candidates with `confidence < 0.15` (`low_confidence_biological_candidate`), preserving raw metadata with explicit `uncertainty_reason`.

## 4. Anthropogenic & Geophony Separation Approach
- **Capability Honesty:** BirdNET+ V3.0 recognizes **only** its trained 14 anthropogenic classes (`Gun`, `Chainsaw`, `Aircraft`, `Boat`, `Explosion`, `Engine`, `Fireworks`, `Hammer`, `Motor vehicle`, `Power tool`, `Train`, `Sawing`, `Siren`, `Vehicle horn`), `Music`, and `Fire` (`Geophony`). It does **not** run a general-purpose urban human-speech or arbitrary construction classifier (`UNAVAILABLE` for general human speech unless explicitly labeled).
- `semantic_classifier` separates anthropogenic signals (`non_biological_anthropogenic`) from abiotic hazards/weather (`non_biological_geophony`) and prevents biological taxa from ever entering disturbance aggregation.

## 5. Disturbance Calculation (`ecological_analysis_service.build_disturbance_analysis`)
- **Classification Type:** `HEURISTIC` (when indicators exist) / `UNAVAILABLE` (when neither anthropogenic detections nor spectral soundscape metrics exist).
- **Normalized Bounded Formula (`[0.0, 1.0]`, re-normalized over available components):**
  $$\text{DisturbanceIndex} = \frac{0.35 \cdot c_{\text{anthro}} + 0.25 \cdot r_{\text{dur}} + 0.25 \cdot p_{\text{spec}} + 0.15 \cdot h_{\text{tier}}}{\sum w_{\text{available}}}$$
  where:
  - $c_{\text{anthro}}$ (`MODEL-BASED`): mean peak confidence across merged anthropogenic events (`0.0` if soundscape metrics exist with zero anthropogenic detections).
  - $r_{\text{dur}}$ (`DERIVED`): non-overlapping anthropogenic event duration divided by recording duration.
  - $p_{\text{spec}}$ (`DERIVED`): spectral pressure computed as mean of available scaled NDSI inverse $(1 - \text{NDSI})/2$ and `1–2 kHz` band energy share (`mid_frequency_1_2k_pct / 100`). Elevated `1–2 kHz` energy without an anthropogenic label is reported cautiously (`spectral_pressure_without_anthro_label`), never claimed as machinery.
  - $h_{\text{tier}}$ (`HEURISTIC`): max verified hazard tier weight (`critical = 1.0`, `medium = 0.6`, `low = 0.3`), omitted when zero anthropogenic events exist.
- **Causal Guardrail:** Temporal overlap and before/after rates (`disturbance_radar_engine.analyze_biological_cooccurrence`) explicitly set `causal_claim_made = False` and prohibit causal claims.

## 6. Context Architecture (`ecological_analysis_service.build_context_analysis`)
Aggregates only computed/observed evidence with explicit missingness:
- `recording_context` (`DATA-BASED`): ID, filename, duration, sample rate, channels, exact & generalized coordinates, coordinate status, recorded timestamp, meteorological week, model version, execution provider.
- `acoustic_context` (`DERIVED` or `UNAVAILABLE`): `aci`, `adi`, `aei`, `ndsi`, `spectral_entropy`, `temporal_activity`, 5 frequency bands, dominant band, quality flags, FFT parameters.
- `biological_context` (`MODEL-BASED` / `DATA-BASED`): biological detection count, unique species count, taxa breakdown (`Aves`, `Amphibia`, `Insecta`, etc.), top biological taxa, min/max/mean confidence stats.
- `anthropogenic_context` (`HEURISTIC` / `DATA-BASED`): event count, present categories, covered duration, `1–2 kHz` energy %, `disturbance_index`.
- `temporal_context` (`DATA-BASED`): total 3-second windows, active biological/anthropogenic window counts, window coverage ratio, biological first/last seen seconds.

## 7. Expected Species Reference Architecture (`expected_species_analysis`)
- **Reference Source:** Local BirdNET Geo V3.0 ONNX model (`BirdNetGeoKnowledgeProvider`), `reference_type = "model_prediction"`, `min_occurrence_score = 0.08`, excluding all non-biological taxa.
- **Explicit Availability States (Requirement #10):**
  - `available`: Valid coordinates + >= 1 species met threshold (`expected_species = [...]`).
  - `empty_reference`: Valid coordinates + model succeeded with 0 species meeting threshold (`expected_species = []`).
  - `location_unspecified` (`expected_species_status = "reference_unavailable"`): Coordinates absent (`expected_species = None`).
  - `reference_unavailable`: Invalid coordinates or Geo model failure (`expected_species = None`, explicit `reason`).

## 8. Observation Gap Methodology (`observation_gap_analysis`)
- Built deterministically from `Expected` (`expected_species`) $\cap$ `Observed` (biological taxa only via `ObservationGapEngine.evaluate_observation_gap` with multi-window persistence gating):
  - `observed`: $\text{Expected} \cap \text{Observed}$ (`classification = "observed"`)
  - `not_detected`: $\text{Expected} \setminus \text{Observed}$, each tagged `not_detected = True`, `absent = False`, `classification = "not_detected"`, with `evidence_status = "insufficient_evidence_for_absence"`
  - `not_expected`: $\text{Observed} \setminus \text{Expected}$ (`classification = "not_expected"`)
  - `unknown`: Low-confidence / unmapped detections excluded from biological comparison (`classification = "unknown"`)
  - `coverage_ratio`: $|\text{Observed} \cap \text{Expected}| / |\text{Expected}|$ when expected reference is non-empty, else `None` (never silent `0.0` when `reference_unavailable`).

## 9. Single-Pass Execution & API Changes
- **Single-Pass Reuse:** `analysis_worker.run_analysis_task` runs BirdNET inference and audio encoding **once**, reads processed mono WAV once for `SoundscapeIntelligenceService`, computes `ecological_analysis_service.build_analysis_ecology(...)` once, populates biological `Detection.geo_score` from already-evaluated Geo predictions, and persists `ecological_summary_json` atomically.
- **Endpoints Enhanced (Backwards-Compatible):**
  - `GET /api/v1/analyses/{analysis_id}` (`AnalysisDetailResponse`): Exposes persisted `ecological_summary`, `species_analysis`, `disturbance_analysis`, `context_analysis`, `expected_species_analysis`, and `observation_gap_analysis`.
  - `GET /api/v1/analyses/{analysis_id}/results`: Exposes persisted `species`, `disturbance`, `context`, `expected_species`, `observation_gap`, `soundscape`, and `ecological_summary`.
  - `GET /api/v1/detections`: Added `record_type` and `biological_only` filters.
  - `GET /api/v1/reports/summary`: Filters biological detections cleanly out of `sound_class` / `"Unknown"` rows; adds `biological_total` and `non_biological_total`.
  - `GET /api/v1/live/sessions/{session_id}/intelligence`: Adds `species_analysis`, `disturbance_analysis`, `context_analysis` and ensures `species_richness` / `top_detected_species` exclude non-biological rows.
  - `POST /api/v1/ecology/observation-gap`: Adds `expected_species_status`, `species_analysis`, `disturbance_analysis`, `context_analysis`, and `provenance`.
- **Frontend Wiring:**
  - `CinematicOverlays.tsx` (`ACT 07 · SPECIES`): Filters to biological detections (`recordType !== "sound_class"`) so sound classes never render under Species.
  - `ecosonicEcologyApi.ts`: Added fallback querying completed persisted `/api/v1/analyses` (`ecological_summary`) when no active live session or site exists, hydrating Scenes 10–12 from uploaded analyses as well as live sessions.

## 10. Database Changes
- Added nullable `Analysis.ecological_summary_json` JSON column (`backend/app/models/analysis.py`).
- Added backward-compatible SQLite `ALTER TABLE analyses ADD COLUMN ecological_summary_json JSON` migration (`backend/app/core/database.py:_ensure_sqlite_columns`).

## 11. Provenance & Evidence Classification Matrix

| Section | Classification | Backing Source / Engine | Provenance Exposed |
|---|---|---|---|
| **Species** | `MODEL-BASED` / `DATA-BASED` (thresholds) | BirdNET+ V3.0 ONNX + `labels_raw-88d976477fac.csv` | `source_model`, `classification_method`, `birdnet_taxonomy_id`, `uncertainty_reason` |
| **Disturbance** | `HEURISTIC` (index) + `MODEL-BASED` (events) + `DERIVED` (NDSI/band) | `DisturbanceRadarEngine` + `SoundscapeIntelligenceService` | `formula`, `components_used`, `causal_claim_made=False`, `method_type` |
| **Context** | `DATA-BASED` (metadata) + `DERIVED` (soundscape) | `Analysis`/`LiveSession` metadata + `scikit-maad` | Per-subcontext `method_type` & status (`measured` vs `unavailable`) |
| **Expected Species** | `MODEL-BASED` (or `UNAVAILABLE`) | `BirdNetGeoKnowledgeProvider` (BirdNET Geo V3.0 ONNX) | `expected_species_status`, `source`, `reference_type`, `reference_timestamp` |
| **Observation Gap** | `DERIVED` (or `UNAVAILABLE`) | `ObservationGapEngine` set comparison | `status`, `confidence`, `limitations`, `not_detected=True`, `absent=False` |

## 12. Test Results (Executed After Final Code Edit)
1. **Backend Completion & Regression Suite:**
   - `pytest tests/test_backend_completion.py -v`: **`6 passed`** (1 deselected `-m real_model`).
   - `pytest tests/test_backend_completion.py -m real_model -v --timeout=120`: **`1 passed`** (real BirdNET V3.0 ONNX + real BirdNET Geo V3.0 + real `scikit-maad` on `backend/data/smoke_audio/birds_forest.ogg`).
   - `pytest tests --ignore=tests/test_live_api_and_protocol.py -q`: **`199 passed, 1 skipped`**, `14 deselected` (`94.12s`).
   - `pytest tests/test_live_api_and_protocol.py -q`: **`9 passed`** (`7.62s`).
2. **Frontend Verification:**
   - Active edited TS check (`npx tsc -b --noEmit` filtered to `src/(api/ecosonic|domain/|visual/Cinematic/)`): **`0` errors** (`FRONTEND_ACTIVE_TSC_ERRORS=0`).
   - `npx vitest run src/test/`: **`14 passed (14)`** test files, **`61 passed (61)`** tests passed.
   - `npx vite build`: Passed (`520` modules in `7.25s`).

## 13. Known Limitations & Future Improvements
1. **General Human/Urban Acoustic Scope (`UNAVAILABLE`):** Outside BirdNET V3.0's 16 non-animal classes (14 Anthropogenic + Fire + Music), general human speech, conversations, and non-BirdNET urban sounds do not have an enabled general audio classifier (e.g., YAMNet / PANNs); unrecognized labels are conservatively placed in `unknown`.
2. **Heuristic Disturbance Index:** The weighted Disturbance Index is a deterministic acoustic screening heuristic rather than an ecological impact proof; elevated `1–2 kHz` energy without a class label cannot distinguish machinery from broadband abiotic noise.
3. **Avian/Taxonomy Scope in BirdNET Geo:** BirdNET Geo V3.0 models avian seasonal distributions primarily rather than insects/amphibians; non-avian expected checklists remain unavailable unless an external occurrence API (e.g., GBIF/iNaturalist) is added later.
4. **Live Protocol Test Isolation Note:** Running the entire ~208-test backend suite in a single Python process encounters an existing intermittent Windows `anyio` blocking-portal / `aiosqlite` shutdown timeout (`30s` limit) in `test_live_api_and_protocol.py` after prior ONNX/async suites load; running `tests/test_live_api_and_protocol.py` in isolation passes 9/9 in `7.62s`.
