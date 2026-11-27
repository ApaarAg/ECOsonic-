# ECOsonic 3.0 — Geospatial Ecological Intelligence & Observation Gap Audit

**Date:** November 24, 2026  
**Document Version:** 1.0.0  
**Status:** Audit Completed — Architectural Baseline Established  
**Scope:** Evaluation of repository architecture, spatial data, habitat modeling, BirdNET taxonomy, detection quality, and LLM boundaries for Expected Species Gap Analysis.

---

## 1. Executive Summary

This audit assesses the ECOsonic 3.0 codebase to design and implement a new ecological-intelligence capability:

> **Given a recording location, habitat/context, observation date/time, and BirdNET detections, determine which species are ecologically expected for that context and which expected species were NOT acoustically detected during the observation.**

Crucially, **acoustic non-detection does not prove biological absence**. The system must strictly enforce scientific guardrails and terminology:
- `"Expected species"`
- `"Detected species"`
- `"Expected but not acoustically detected"`
- `"Observation gap"`
- `"Insufficient evidence for absence"`

Furthermore, Large Language Models (Gemini API) may be used exclusively as an **interpretation layer** to synthesize structured evidence into natural language; LLMs **must never be treated as the authoritative species-range database or allowed to hallucinate species presence/absence**.

---

## 2. Detailed Findings

### 2.1 Location Information Currently Existing in the Repository

| Entity / Layer | Location Fields | Type & Format | Storage / Resolution | Current Usage |
|---|---|---|---|---|
| **`Site` model** (`app.models.site`) | `latitude`, `longitude`, `location_sensitivity`, `generalized_latitude`, `generalized_longitude` | Float (WGS84 degrees, -90..90, -180..180), String enum (`exact`, `generalized`, `restricted`) | SQLite `sites` table | Primary physical station metadata. Contains `get_public_coordinates()` enforcing privacy policies by rounding coordinates to 2 decimal places (~1.1 km) or redacting when restricted. |
| **`LiveSession` model** (`app.models.live_session`) | `latitude`, `longitude`, `site_id` | Float (Optional), String UUID foreign key | SQLite `live_sessions` table | Captured during session initialization from browser geolocation API or client payload. Linked optionally to a registered `Site`. |
| **`GeographicContext` model** (`app.models.environmental_intelligence`) | `latitude`, `longitude`, `week` | Float (WGS84), Integer (1..48 BirdNET meteorological weeks) | SQLite `geographic_contexts` table | Attaches regional occurrence scores to individual detections. Quantizes to 0.001° (~111 m) resolution for spatial caching. |
| **Frontend Sessions** (`web/src/types/ecosonic.ts`) | `coordinatesLabel`, `siteName` | String formatted label (e.g. `"47.8600° N, 123.9300° W"`) | Memory & LocalStorage | Readout in observatory headers and session cards. |

### 2.2 Habitat Information Currently Existing in the Repository

| Entity / Layer | Habitat Fields | Permitted Values | Functionality & Limitations |
|---|---|---|---|
| **`Site.ecosystem_category`** | `ecosystem_category` | String (default: `"forest"`) | Broad ecosystem classification (e.g. `"forest"`, `"wetland"`, `"coastal"`, `"grassland"`). |
| **`Site.ecosystem_profile_json`** | JSON dictionary | Freeform JSON | Can store elevation, canopy density, moisture index, vegetation strata. |
| **Frontend Presets** (`web/src/types/ecosonic.ts`) | `HabitatPresetId` | `'temperate-rainforest'`, `'boreal-wetland'`, `'subalpine-ridge'` | Preset selector driving spectral band baselines, soundscape index thresholds, and visual themes. |
| **`HabitatComparison` model** (`app.models.environmental_intelligence`) | Statistical comparison | Multi-horizon drift comparisons | Compares Acoustic Complexity Index (ACI), Bioacoustic Index (BI), and Normalized Difference Soundscape Index (NDSI) across time. |
| **Limitation** | No deterministic external landcover lookup | N/A | Habitat is currently either pre-configured on the `Site` or selected via frontend preset. There is no automated terrestrial landcover resolver (e.g. Corine/NLCD/Copernicus). |

### 2.3 Species Metadata Already Available

1. **BirdNET V3.0 Acoustic Classifier** (`app.services.direct_onnx_engine`, `app.services.birdnet_engine`):
   - Model weights: Official BirdNET+ V3.0 ONNX model.
   - Classes: **11,725 classes** (11,400+ avian species + amphibians, mammals, and anthropogenic disturbance sound classes).
   - Class format: `"Scientific_CommonName"` (e.g., `"Ixoreus naevius_Varied Thrush"`).
2. **BirdNET Geo V3.0 Spatial Model** (`app.services.geo_temporal_service`):
   - Model weights: Official BirdNET Geo V3.0 ONNX model (`birdnet.load("geo", "3.0", "onnx")`).
   - Species coverage: **14,082 species** covering global avian distributions.
   - Inputs: `(latitude, longitude, week: 1..48)`.
   - Outputs: Continuous occurrence probability vector across all 14,082 species.
   - Taxonomy files: `model_cache/taxonomy-v3` and `acoustic-models/v3.0/labels_raw-88d976477fac.csv`.
   - Taxonomy mapping: Resolves between `scientific_name`, `common_name`, `birdnet_taxonomy_id`, and `ebird_code`.
   - Classification categories:
     - `geo_score >= 0.10`: `expected`
     - `0.03 <= geo_score < 0.10`: `rare` (low seasonal abundance)
     - `geo_score < 0.03`: `unexpected` (potential vagrant or out-of-season migrant)

### 2.4 What is Missing

1. **Deterministic Ecological Knowledge Provider Abstraction:**
   - Currently, `geo_temporal_service.py` has a method `get_site_regional_checklist`, but there is no abstract `EcologicalKnowledgeProvider` interface that can swap between local ONNX models, static checklists, external biodiversity APIs (e.g., GBIF/eBird), or offline mock fixtures.
2. **Deterministic Species Expectation & Observation Gap Model:**
   - No structured comparison engine exists to partition species into the four required sets:
     - `expected_and_detected`
     - `expected_but_not_detected`
     - `detected_unexpected`
     - `insufficient_evidence`
   - No explicit handling ensuring `expected_but_not_detected` is strictly tagged `not_detected = True`, never `absent = True`.
3. **Detection Quality & Acoustic Persistence Filtering:**
   - Live events currently capture individual 3-second window detections. A single false-positive detection at $0.25$ confidence can currently appear as a detected species unless persistent filtering (e.g., min confidence threshold, minimum window count, temporal persistence) is applied.
4. **Transparent Observation Gap Score (`Acoustic Observation Coverage`):**
   - No explainable coverage ratio $\frac{\text{detected expected}}{\text{total expected}}$ exists with explicit scientific limitations, short-duration caveats, and silent-window detection warnings.
5. **Grounded Gemini Interpretation Layer:**
   - Zero Gemini integrations exist in the backend. An asynchronous, decoupled interpretation service is required with strict JSON schema validation, input evidence grounding, and automatic rejection of hallucinated or out-of-evidence species.
6. **Dedicated Observation Gap API Endpoint:**
   - Missing `POST /api/v1/ecology/observation-gap` accepting `session_id` and optional override coordinates, retrieving existing backend session detections, soundscape metrics, and disturbance history without requiring the frontend to resend history.
7. **Frontend Observation Gap Experience:**
   - The session detail page (`web/src/pages/SessionDetailPage.tsx`) lacks an ecological intelligence breakdown presenting Ecological Context, Expected Checklist, Observed Species, and the Observation Gap with scientific disclaimers and AI-assisted interpretation.

### 2.5 Existing APIs & Services That Can Be Reused

1. **`geo_temporal_service.get_raw_geo_predictions` & `date_to_birdnet_week`:**
   - Reused as the core deterministic engine for the local `BirdNetGeoKnowledgeProvider`.
2. **`Site.get_public_coordinates`:**
   - Reused for location privacy: coordinates are coarsened/generalized before passing to any external service.
3. **`live_session_manager` & `LiveSession` DB entities:**
   - Reused to retrieve session duration, audio seconds, timestamp, and linked `Site`.
4. **`LiveEvent` & `detection_repository`:**
   - Reused to query all acoustic events associated with a `session_id`, including confidence scores and temporal stamps.
5. **`SoundscapeMeasurement` & `DisturbanceEvent`:**
   - Reused to extract acoustic complexity indices (ACI, ADI, NDSI) and disturbance events for context enrichment.
6. **`httpx.AsyncClient`:**
   - Already installed in the virtual environment; perfect for calling the Gemini REST API asynchronously without introducing fragile SDK dependencies.

### 2.6 Subsystem Integration Architecture

```
                  ┌────────────────────────────────────────────────────────┐
                  │                 Live Audio Stream                      │
                  │  Mic -> WebSocket -> RingBuffer -> DirectOnnxEngine     │
                  │           (UNCHANGED, REAL-TIME 60 FPS)                │
                  └───────────────────────────┬────────────────────────────┘
                                              │ writes
                                              ▼
                                   ┌─────────────────────┐
                                   │  SQLite Database    │
                                   │  LiveSession        │
                                   │  LiveEvents         │
                                   │  SoundscapeMeasure  │
                                   └──────────┬──────────┘
                                              │ queries
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                          NEW: Observation Gap Subsystem                                 │
│                                                                                         │
│   POST /api/v1/ecology/observation-gap                                                  │
│      │                                                                                  │
│      ├─ 1. Resolve ObservationContext (session time, duration, generalized coordinates) │
│      │                                                                                  │
│      ├─ 2. EcologicalKnowledgeProvider (Local BirdNetGeoProvider / Fallback)            │
│      │     └─ Resolves expected species list & occurrence suitability                   │
│      │                                                                                  │
│      ├─ 3. Detection Quality & Persistence Filter                                       │
│      │     └─ Filters low-confidence or transient false-positives                       │
│      │                                                                                  │
│      ├─ 4. Species Expectation Model                                                    │
│      │     ├─ expected_and_detected                                                     │
│      │     ├─ expected_but_not_detected (not_detected=True; absent=False)               │
│      │     ├─ detected_unexpected                                                       │
│      │     └─ insufficient_evidence (< 120s duration or zero detections)                │
│      │                                                                                  │
│      ├─ 5. Acoustic Observation Coverage Score                                          │
│      │     └─ Explainable ratio + caveats + duration warnings                           │
│      │                                                                                  │
│      └─ 6. Gemini Interpretation Layer (Strictly Grounded, Optional, Asynchronous)      │
│            ├─ Formulates structured JSON payload (NO raw GPS; coarse context only)      │
│            ├─ Queries Gemini 2.5/Flash with Pydantic JSON schema                        │
│            ├─ Hallucination Guard: Validates that every mentioned species exists        │
│            │  in the input evidence. Drops any hallucinated names.                      │
│            └─ Fallback: Returns deterministic analysis if Gemini fails or is unconfigured│
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
                                 ┌─────────────────────────┐
                                 │   Frontend Observatory  │
                                 │   SessionDetailPage     │
                                 │   EcologicalContextCard │
                                 │   ObservationGapCard    │
                                 │   InterpretationCard    │
                                 └─────────────────────────┘
```

---

## 3. Risks of Using LLM-Generated Ecological Facts

Using Large Language Models (LLMs) such as Gemini for biological and ecological inference introduces well-documented scientific risks:

1. **Geographic Hallucinations & Range Inventions:**
   - LLMs frequently assert that a species occurs in a region based on linguistic associations rather than verified range maps (e.g., conflating Pacific temperate rainforest avifauna with European or Appalachian species).
   - **Mitigation:** Gemini is **strictly forbidden** from generating or determining the expected species list. The expected list is generated **100% deterministically** by the spatial occurrence model (`BirdNET Geo V3.0`).
2. **False Claims of Absence:**
   - Naive LLMs often write *"Species X is absent from the forest"*, which is scientifically invalid for bioacoustics. Non-detection can be caused by non-vocal behavior, distance from microphone, canopy attenuation, ambient rain/wind noise, or temporal seasonality.
   - **Mitigation:** The system prompt explicitly instructs Gemini that acoustic non-detection is not absence. Furthermore, output filters reject any response claiming biological absence.
3. **Mischaracterization of Unexpected Species as "Invasive":**
   - LLMs frequently categorize native vagrants, rare migrants, or range-expanding species as "invasive" or "ecologically harmful".
   - **Mitigation:** The taxonomy and categorization strictly label unexpected species as `detected_unexpected` (or `vagrant`/`migratory candidate`), with explicit instructions that an unexpected native detection is not an invasive intrusion.
4. **API Latency & Live Pipeline Contamination:**
   - Synchronously calling an LLM inside an audio pipeline can block WebSocket frames and cause buffer drops.
   - **Mitigation:** Gemini is completely decoupled from audio ingestion. It runs on-demand via an explicit REST endpoint and is completely optional. If Gemini is unavailable, the deterministic ecological gap analysis returns instantaneously.
5. **Location Privacy Leaks:**
   - Sending high-precision GPS coordinates of sensitive or endangered nesting sites to cloud LLMs violates ecological conservation privacy.
   - **Mitigation:** The backend generalizes coordinates (`Site.get_public_coordinates` or 2-decimal truncation ~1.1 km) before including coarse geographic context in the LLM prompt. Raw device GPS is never transmitted to the LLM.

---

## 4. Phase-by-Phase Implementation Plan

- **Phase 1: Define the Data Contract** — Pydantic schemas in `app/schemas/ecological_intelligence.py` for `ObservationContext`, `ExpectedSpecies`, `DetectedSpecies`, `ObservationGapAnalysis`, and `EcologicalInterpretation`.
- **Phase 2: Build the Ecological Knowledge Layer** — Base class `EcologicalKnowledgeProvider` with `BirdNetGeoKnowledgeProvider` (and mock/fallback provider for offline/testing environments).
- **Phase 3: Species Expectation Model** — Pure functional comparison module categorizing species into `expected_and_detected`, `expected_but_not_detected`, `detected_unexpected`, and `insufficient_evidence`.
- **Phase 4: Detection Quality Engine** — Persistence and confidence thresholds ($C \ge 0.35$ for single detection; $C \ge 0.25$ if detected across multiple time windows).
- **Phase 5: Acoustic Observation Coverage Score** — Explainable formula with duration scaling and limitation metadata.
- **Phase 6 & 7: Gemini Interpretation Service & Hallucination Guard** — `app/services/ecological_interpretation_service.py` with Pydantic JSON schema, strict evidence grounding, hallucination scrubbers, and safe offline fallback.
- **Phase 8: API Integration** — `POST /api/v1/ecology/observation-gap` in `backend/app/api/v1/environmental.py` (or dedicated router `ecology.py`).
- **Phase 9 & 10: Frontend Integration** — TypeScript types, API adapter methods, and dedicated UI components on `SessionDetailPage.tsx`.
- **Phase 11: Location Privacy Guard** — Coarse geographic rounding and sensitive site masking.
- **Phase 12: Comprehensive Test Suite** — Unit tests covering all 8 specified edge cases.
- **Phase 13: Performance Verification** — Confirm zero latency impact on live streaming.
- **Phase 14: Documentation** — Publish `docs/GEOSPATIAL_ECOLOGICAL_INTELLIGENCE.md`.
