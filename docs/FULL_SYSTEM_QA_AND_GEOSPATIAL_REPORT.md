# ECOsonic — Full End-to-End QA, Act 10–12 Fix, Geospatial Context & Species Imagery Report

## 1. Website QA Before & After Code Changes

### Phase 1 Baseline Discovery (Before Code Changes)
Running the application locally against a real running FastAPI backend (`127.0.0.1:8000`) and Vite frontend (`127.0.0.1:5173`) revealed critical end-to-end gaps:
1. **Stale process hazard on port 8000:** Background Python processes (`PID 27424`, `19648`) were serving stale code on `127.0.0.1:8000` until terminated cleanly and restarted from workspace disk code.
2. **Missing user-facing analysis upload & geolocation workflow:** The live landing UI exposed only the live microphone toggle (`microphone-session-toggle`) with `0` file upload inputs, `0` coordinate inputs (`latitude`/`longitude`), and no analysis history selector.
3. **Completed backend analyses invisible in Acts 10–12:** Uploading `backend/data/smoke_audio/birds_forest_e2e.wav` via API with coordinates `(47.86, -123.93, 2026-05-15T06:30:00Z)` completed in 12.3s with 9 biological detections (`expected_count: 60`), yet opening/reloading the frontend STILL rendered Acts 10–12 without that analysis's ecological context.

### After Fixes (Live User End-to-End Verification)
- Top-right chrome now provides an `Analyze` button (`data-testid="open-analysis-panel-btn"`) alongside the pill microphone switch (`microphone-session-toggle`).
- Opening `AnalysisControlDrawer` lets a user upload real audio (`.wav`, `.mp3`, `.flac`, `.ogg`, `.m4a`), enter optional paired `Latitude` / `Longitude` (or Browser GPS / `Clear Coords`) + recording timestamp, poll live backend progress (`0% → 100%`), jump directly to Acts 10–12, or reload any saved analysis from history (`?analysis=<id>`).
- Verified end-to-end with `backend/data/smoke_audio/birds_forest_e2e.wav` at Fontainebleau coordinates `(48.40, 2.70, 2026-05-15T06:30)` against real `BirdNET+ V3.0 ONNX` (`GPU`) and `BirdNET Geo V3.0 ONNX`, surviving hard browser reload (`?analysis=31f146e6-5918-408d-ae41-70e8780d056f`).

---

## 2. Exact Root Cause of Empty / Disconnected Acts 10, 11, and 12

1. **Stale un-geocoded live session shadowing persisted completed analyses:**  
   `fetchObservationGapForScene12()` and `fetchExpectedSpeciesForScene11()` queried `GET /api/v1/live/sessions?limit=5` BEFORE checking persisted completed analyses (`GET /api/v1/analyses?status=completed`). When any historical `browser_mic` session existed with `latitude: null, longitude: null` (e.g., `b2d41772-...`), it selected that empty session first, returned `observation_adequacy: "location_unspecified"` with zero species, and never reached persisted completed audio analyses.
2. **Competing un-deduplicated fetches in `CinematicStage.tsx`:**  
   Entering Act 10 triggered concurrent un-deduplicated ecology calls that could overwrite each other out of order.
3. **Un-geocoded detected species leaking into `EXPECTED & DETECTED` & Act 11 (`location_unspecified`):**  
   When an analysis lacked coordinates (`status: "location_unspecified"`), `backend/app/services/ecological_analysis_service.py` placed detected biological taxa in `observation_gap.observed` (which the frontend mapped verbatim into `expected_and_detected` and `ExpectedSpeciesScene`). Adding explicit `location_unspecified` / `reference_unavailable` gating in `mapAnalysisResultsToStorePayload()` keeps `expected_and_detected = []` and `expected_but_not_detected = []` whenever no regional reference baseline exists, while surfacing actual audio detections strictly under `DETECTED IN RECORDING`.
4. **Missing analysis coordinates restoration & upload reset state:**  
   - `acousticStore.hydrateFromAnalysis` now restores `coordinates` (`latitude`, `longitude`, `recordedAt`) when loading saved analyses.
   - `AnalysisControlDrawer.tsx` now clears stale `activeJob` state on new upload submission (`setActiveJob(null)`).

---

## 3. Backend Changes

- **Paired coordinate validation:**
  - `backend/app/api/v1/analyses.py`: `POST /api/v1/analyses` validates paired finite `latitude`/`longitude` (rejects half coordinates or non-finite numbers with HTTP `422`).
  - `backend/app/schemas/live_session.py`: `LiveSessionCreate.validate_paired_coordinates` (`@model_validator`) rejects partial or non-finite coordinate pairs with HTTP `422`.
- **Geospatial & temporal context derivation:**
  - `backend/app/services/ecological_analysis_service.py`: Added `_derive_season`, `_derive_biogeographic_band`, and `build_geospatial_context()`, persisting real spatial-temporal-ecological provenance (`reference_source: "BirdNET Geo V3.0 ONNX (14,082-taxon spatial-seasonal occurrence model)"`, `occurrence_basis: "species_expected_from_reference"`, `reference_status: "available" | "unavailable"`).
- **Provenance-tracked species imagery & SQLite caching:**
  - `backend/app/models/species_image.py` (`SpeciesImageCache` SQLAlchemy table registered in `backend/app/models/__init__.py` and `backend/app/core/database.py`).
  - `backend/app/services/species_image_service.py` (`SpeciesImageService`, wired dynamically to `app.core.database.async_session_factory`).
  - Integrated bounded batch image attachment into `EcologicalAnalysisService.build_analysis_ecology()` (`species`, `expected_species`, `observation_gap`) and `backend/app/api/v1/ecology.py` (`POST /api/v1/ecology/observation-gap` and `GET /api/v1/ecology/species-image`).

---

## 4. API Changes

- **`POST /api/v1/analyses`**: Accepts optional paired finite `latitude` (`[-90, 90]`), `longitude` (`[-180, 180]`), and `recorded_at`; returns HTTP `422` for unpaired/invalid coordinates.
- **`GET /api/v1/analyses/{analysis_id}/results`**: Extended with `filename`, `latitude`, `longitude`, `recorded_at`, `duration_seconds`, and `geospatial_context`, alongside `species`, `disturbance`, `context`, `expected_species`, `observation_gap`, `soundscape`, and `embeddings`.
- **`POST /api/v1/live/sessions`**: Enforces paired finite coordinates cleanly on session creation (`422` if partial/non-finite).
- **`POST /api/v1/ecology/observation-gap`**: Attaches `geospatial_context` and resolved `image` provenance (`SpeciesImageProvenance`) across `expected_and_detected`, `expected_but_not_detected`, and `detected_unexpected`.
- **`GET /api/v1/ecology/species-image`**: New endpoint resolving `scientific_name` + optional `common_name` to a `SpeciesImageProvenance` payload (`image_status`, `url`, `source`, `license`, `attribution`, `source_url`, `retrieved_at`).

---

## 5. Geospatial Context & Ecological Reference Architecture

- **Coordinate privacy & honesty:** Inputs are validated as finite paired WGS84 coordinates; missing coordinates produce `reference_status: "unavailable"`, `observation_adequacy: "location_unspecified"`, and `expected_species: null/[]` without fabricating species checklists.
- **Temporal & ecological enrichment:** `recorded_at` resolves meteorological week (1–48 BirdNET calendar) and hemisphere-aware season (`spring (boreal)` vs `autumn (austral)`, etc.) plus latitudinal biome band (`temperate mid-latitude belt`, etc.).
- **Scientific epistemic framing:** All expected species carry `occurrence_basis: "species_expected_from_reference"`, and observation gap records enforce `not_detected = True`, `absent = False`, and explicit non-detection disclaimers (`Acoustic non-detection does NOT establish biological absence`).

---

## 6. Species Images: Sources, Caching & Fallback Behavior

Resolution hierarchy in `SpeciesImageService`:
1. **Curated Local Wikimedia Commons Registry (`LOCAL_VERIFIED_IMAGES`):** 18 species stored under `frontend/public/assets/specimens/*.jpg` with verified photographer attribution, license (`CC BY` / `CC BY-SA`), and source URLs — served with zero external requests.
2. **In-Memory + Persistent SQLite Cache (`species_image_cache`):** Caches external resolutions (30-day TTL for available open-license images, 12-hour TTL for unavailable entries) so repeated queries avoid upstream calls.
3. **Wikimedia REST Summary + Commons `imageinfo` API:** Looks up uncurated species dynamically (respecting `ECOSONIC_DISABLE_EXTERNAL_MEDIA=1`), inspects `extmetadata` (`LicenseShortName`, `Artist`), and strictly rejects non-open licenses via `_is_open_license`.
4. **Honest Fallback:** When offline, disabled, rate-limited, or lacking an open-licensed image, returns `image_status: "unavailable"` with `url: null`. `speciesAssetRegistry.ts`, `SpeciesSpecimen.tsx`, `ObservationGapCardStack.tsx`, and `ObservationGapFieldNote.tsx` display explicit `"Species image unavailable"` attribution/badges atop the fallback habitat plate without crashing or mislabeling another bird photo.

---

## 7. Actual Test & Live Verification Results

> *(Note: Backend pytest ran after final backend edits; frontend Vitest, active TypeScript check, Vite build, and Playwright E2E were re-verified cleanly against final frontend code.)*

- **Backend Pytest** (`backend/tests/test_backend_completion.py`, `test_observation_gap.py`, `test_ecology_api.py`, `test_live_api_and_protocol.py`, `test_full_e2e_qa_and_imagery.py` with `-k "not test_websocket_stop_discards_final_partial_window"`):  
  **29 passed, 0 failed** (`2 deselected` — `test_birdnet_realtime_verification` and `test_websocket_stop_discards_final_partial_window`, where Starlette `TestClient` blocks in its `anyio.from_thread` portal join on Windows).
- **Frontend Vitest** (`npx vitest run src/test/`):  
  **16 test files passed, 67 tests passed, 0 failed** (`fullSystemIntegration.test.tsx`, `expectedSpeciesScene.test.tsx`, `observationGapScene.test.tsx`, and all existing suite specs).
- **Frontend Build & TypeCheck** (`npx tsc --noEmit` filtered across modified/active modules + `npx vite build`):  
  **0 TypeScript errors** across modified/active cinematic & analysis modules; Vite production bundle built cleanly (`dist/assets/index-Bu-b6HnU.js` in `6.22s`).
- **Live Chromium Playwright End-to-End QA** (`frontend/scripts/validate-full-system-qa.mjs` against real Uvicorn GPU BirdNET + Vite):
  - Partial coordinate validation alert verified (`Both latitude and longitude must be entered together (or clear both).`).
  - Missing-coordinates WAV upload verified honest empty/location-unspecified states across Acts 10, 11 (`NO EXPECTED SPECIES AVAILABLE`), and 12 (`OBSERVATION CORRESPONDENCE INCOMPLETE`).
  - Real `birds_forest_e2e.wav` upload at `(48.40, 2.70, 2026-05-15T06:30)` returned **9 biological detections** (*Willow Warbler* 0.842, *Goldcrest* 0.659, *Tree Pipit* 0.608, *Common Blackbird* 0.316, *Eurasian Siskin* 0.334), **60 BirdNET Geo V3.0 expected species**, `2` expected & detected, `58` expected & not detected, `2` detected outside prior, and loaded real Wikimedia Commons photography (*Columba palumbus* in Field Note, `naturalWidth > 0`).
  - Browser hard reload with `?analysis=31f146e6-5918-408d-ae41-70e8780d056f` preserved Act 10–12 state cleanly.
  - Zero console errors, zero page errors, zero unexpected HTTP errors (`>= 400`), `sharedCanvases === 1`, and zero horizontal overflow at `1440×900`, `1920×1080`, `390×844`, and `412×915`.

---

## 8. Remaining Limitations & Blockers

1. **Legacy unmounted TypeScript files:** Running repository-wide `tsc -b` reports pre-existing errors in unmounted legacy dashboard pages/charts (`src/pages/*`, `src/services/api.ts`, `src/components/maps/SiteMap.tsx`, and unused local variables inside `src/components/originkit/ui/*`) that reference unbundled packages (`react-router-dom`, `recharts`, `lucide-react`, `axios`, `leaflet`). Filtered `npx tsc --noEmit` across all active cinematic & analysis modules reports **0 errors**, and `npx vite build` succeeds cleanly.
2. **WebSocket portal test on Windows:** `test_websocket_stop_discards_final_partial_window` hangs in `starlette.testclient` `anyio.from_thread` thread teardown on Windows and was deselected during pytest runs (the other 3 async/WebSocket tests in `test_live_api_and_protocol.py` passed).
3. **HoloFlipBadge (`src/components/originkit/ui/holo-flip-badge.tsx`)**: An OriginKit `holo-flip-badge.tsx` file exists on disk with unused-variable warnings in `tsc`, while Act 10 continues to preserve `Act10PhotoCardGlobe` (`PhotoCardGlobe`) as visually verified in Act 10 QA.
4. **Offline environment image availability:** Uncurated species not present in `LOCAL_VERIFIED_IMAGES` or `species_image_cache` depend on live Wikimedia REST/Commons reachability; when unreachable or `ECOSONIC_DISABLE_EXTERNAL_MEDIA=1` is set, ECOsonic falls back transparently to `image_status: "unavailable"`.
