# ECOsonic 3.0 — Scene 10 & Scene 11 Backend Data Integrity Audit

**Date:** 2026-11-26  
**Scope:** Backend & data-contract integrity audit and remediation for Scene 10 (`ACT 10 · ECOLOGICAL CONTEXT`) and Scene 11 (`ACT 11 · EXPECTED SPECIES`)  
**Verdict:** `ACCEPT — SCENE 10/11 BACKEND VERIFIED` *(with one unrelated pre-existing `test_live_api_and_protocol.py::test_websocket_handshake_and_control_messages` teardown timeout noted in Section F)*

---

## A. Scene 10 (`ACT 10 · ECOLOGICAL CONTEXT`) Field Classification

Inspected rendered overlay in [CinematicOverlays.tsx](file:///c:/Users/apaar/Desktop/ECOBIRDS/frontend/src/visual/Cinematic/CinematicOverlays.tsx#L258-L439) and DTO wiring in [ecosonicEcologyApi.ts](file:///c:/Users/apaar/Desktop/ECOBIRDS/frontend/src/api/ecosonicEcologyApi.ts):

| Scene 10 UI Element | Data Source / Field | Classification | Notes |
|---|---|---|---|
| Station title & ecosystem | `context.location_name`, `context.ecosystem_category` | `REAL_BACKEND_DATA` | Defaults to `"unspecified"` when unconfigured rather than fabricating a biome label |
| Generalized locus | `context.generalized_coordinates.latitude/longitude` | `DETERMINISTIC_DERIVED_DATA` | Rounded (`round(v, 2)`) or `null` when site sensitivity is `"restricted"` (`UNSPECIFIED IN SESSION`) |
| Observation adequacy | `coverage.observation_adequacy` | `DETERMINISTIC_DERIVED_DATA` | Computed deterministically in `ObservationGapEngine.evaluate_observation_gap` |
| Expected count | `coverage.expected_species_count` | `DETERMINISTIC_DERIVED_DATA` | Count of deduplicated BirdNET Geo V3.0 biological species meeting `min_occurrence_score` |
| Detected count | `coverage.detected_expected_count` | `REAL_BACKEND_DATA` | Count of expected taxa matched by canonical `birdnet_taxonomy_id` or normalized `scientific_name` |
| Not detected (gap) count | `coverage.gap_count` | `DETERMINISTIC_DERIVED_DATA` | Strictly `expected_species_count - detected_expected_count` |
| Expected & detected list | `expected_and_detected[]` (`common_name`, `max_confidence`) | `REAL_BACKEND_DATA` | Persisted/thresholded acoustic detections from `LiveEvent` |
| Detected unexpected list | `detected_unexpected[]` | `REAL_BACKEND_DATA` | Valid acoustic detections not in regional checklist, enriched with taxonomy IDs |
| Expected but not detected list | `expected_but_not_detected[]` (`not_detected=true`, `evidence_status="insufficient_evidence_for_absence"`) | `DETERMINISTIC_DERIVED_DATA` | Explicitly labeled `NOT DETECTED · INSUFFICIENT EVIDENCE FOR ABSENCE` |
| Evidence synthesis summary | `interpretation.summary`, `interpretation.provider` | `DETERMINISTIC_DERIVED_DATA` | Uses Gemini only when `GEMINI_API_KEY` is present AND zero ungrounded/absence claims; otherwise `deterministic_rule_engine` |
| Offline / demo fallback banner | Local JSX copy (`DEMO / OFFLINE SESSION · ECOLOGICAL BACKEND DISCONNECTED`) | `STATIC_PRESENTATIONAL_COPY` | Explicitly declines to fabricate checklists/coordinates offline |

---

## B. Scene 11 (`ACT 11 · EXPECTED SPECIES`) Data Flow & Integrity Rules

Inspected [ExpectedSpeciesScene.tsx](file:///c:/Users/apaar/Desktop/ECOBIRDS/frontend/src/visual/ExpectedSpecies/ExpectedSpeciesScene.tsx) and [ecosonicEcologyApi.ts](file:///c:/Users/apaar/Desktop/ECOBIRDS/frontend/src/api/ecosonicEcologyApi.ts#L171-L360):

1. **Primary path:** Consumes `POST /api/v1/ecology/observation-gap` (`buildExpectedBaselineFromGap`) unioning `expected_and_detected` and `expected_but_not_detected`, deterministically sorted by `occurrence_score` descending then common/scientific name.
2. **Station fallback:** When session coordinates are absent, queries `GET /api/v1/sites` -> `GET /api/v1/sites/{site_id}/geo-context` using real `Site` coordinates (masked by `Site.get_public_coordinates()`).
3. **Failure / offline behavior:** Backend HTTP errors (e.g. `503 ECOLOGICAL_DATA_UNAVAILABLE`) surface an explicit `"error"` state in Scene 11; explicit `demo_fixture` data is only reachable via user click on `buildExplicitDemoBaseline()` (`isDemo = true`).

---

## C. Backend Remediations Implemented

| Component | Audit Defect / Risk Found | Fix Applied & Link |
|---|---|---|
| Ecological DTOs | Missing canonical `species_id` on observation-gap items; `ecosystem_category` risked implicit non-null habitat fabrication | Added `species_id`, `birdnet_taxonomy_id`, `ebird_code`; defaulted `ecosystem_category = "unspecified"` ([ecological_intelligence.py](file:///c:/Users/apaar/Desktop/ECOBIRDS/backend/app/schemas/ecological_intelligence.py)) |
| Geo DTOs | `SiteGeoContextResponse` required non-null coordinates, leaking restricted sites | Made `latitude`/`longitude` `Optional[float]`, added `location_sensitivity`, added `species_id` ([environmental_intelligence.py](file:///c:/Users/apaar/Desktop/ECOBIRDS/backend/app/schemas/environmental_intelligence.py)) |
| Provider factory & errors | Risk of `MockEcologicalKnowledgeProvider` active in `production` or silent `[]` return on Geo failure | Added `EcologicalProviderUnavailableError` (`ECOLOGICAL_DATA_UNAVAILABLE`), `InvalidObservationCoordinatesError`, `canonical_species_id` ([provider_base.py](file:///c:/Users/apaar/Desktop/ECOBIRDS/backend/app/services/ecological_knowledge/provider_base.py)), and production mock guard ([__init__.py](file:///c:/Users/apaar/Desktop/ECOBIRDS/backend/app/services/ecological_knowledge/__init__.py)) |
| BirdNET Geo & Mock providers | Synchronous ONNX blocking event loop; non-bio exclusion needed before `top_k` slicing | Offloaded inference via `asyncio.to_thread`, added coordinate validation & non-bio pre-filtering ([birdnet_geo_provider.py](file:///c:/Users/apaar/Desktop/ECOBIRDS/backend/app/services/ecological_knowledge/birdnet_geo_provider.py), [mock_provider.py](file:///c:/Users/apaar/Desktop/ECOBIRDS/backend/app/services/ecological_knowledge/mock_provider.py)) |
| Geo-temporal cache & filtering | Mutable cached NumPy array, unversioned cache dict without lock, `ranked_indices[:top_k]` sliced before filtering, boolean/NaN coords | Added `OrderedDict` LRU keyed by `(model_version, round(lat, 3), round(lon, 3), week)` with `_cache_lock`, serialized ONNX `_lock`, read-only cached array, finite/non-bool coordinate guard, and whole-label `is_non_biological_taxon` preserving valid substring taxa ([geo_temporal_service.py](file:///c:/Users/apaar/Desktop/ECOBIRDS/backend/app/services/geo_temporal_service.py)) |
| Observation-gap engine | `0.0` `start_seconds`/`confidence_score` fell back via `or`; `record_type="sound_class"` skipped unchecked; whitespace sci-name mismatch; undeduplicated expected checklist | Preserved explicit `0.0` via `_extract_field`, checked `record_type`/`taxon_group`/`is_non_biological_taxon`, deduplicated expected taxa by `birdnet_taxonomy_id`/normalized `scientific_name`, joined on ID or normalized name ([observation_gap_engine.py](file:///c:/Users/apaar/Desktop/ECOBIRDS/backend/app/services/observation_gap_engine.py)) |
| Ecology & Sites API routes | Unmapped provider/coordinate exceptions; restricted/generalized coordinates exposed on public responses; blocking site geo calls | Mapped `InvalidObservationCoordinatesError`/`ValueError` -> HTTP `422 INVALID_OBSERVATION_COORDINATES`, `EcologicalProviderUnavailableError` -> HTTP `503 ECOLOGICAL_DATA_UNAVAILABLE`, enriched `detected_unexpected`, masked public coordinates after internal evaluation, wrapped site geo calls in `asyncio.to_thread` ([ecology.py](file:///c:/Users/apaar/Desktop/ECOBIRDS/backend/app/api/v1/ecology.py), [sites.py](file:///c:/Users/apaar/Desktop/ECOBIRDS/backend/app/api/v1/sites.py)) |
| Gemini interpretation scrubber | Risk of absence language or hallucinated species entering summary | Verified `_sanitize_absence_claims` & `_has_ungrounded_taxon` fall back to deterministic summary whenever hallucinated/absence terms appear; `GEMINI_API_KEY` read only from `os.environ.get("GEMINI_API_KEY")` ([ecological_interpretation_service.py](file:///c:/Users/apaar/Desktop/ECOBIRDS/backend/app/services/ecological_interpretation_service.py)) |

---

## D. Frontend / Backend DTO Contract Verification

Verified programmatically in `test_frontend_backend_dto_schema_compatibility` ([test_scene10_11_backend_integrity.py](file:///c:/Users/apaar/Desktop/ECOBIRDS/backend/tests/test_scene10_11_backend_integrity.py)) against TypeScript contracts in [acousticFieldTypes.ts](file:///c:/Users/apaar/Desktop/ECOBIRDS/frontend/src/domain/acousticFieldTypes.ts#L108-L231), [ecosonicEcologyApi.ts](file:///c:/Users/apaar/Desktop/ECOBIRDS/frontend/src/api/ecosonicEcologyApi.ts#L50-L334), and [ecosonic.ts](file:///c:/Users/apaar/Desktop/ECOBIRDS/web/src/types/ecosonic.ts#L200-L286):

- **`POST /api/v1/ecology/observation-gap` (`ObservationGapResponse`):** `session_id`, `context` (`session_id`, `latitude`, `longitude`, `generalized_coordinates`, `location_name`, `ecosystem_category`, `elevation_m`, `timestamp`, `observation_date`, `meteorological_week`, `observation_duration_sec`, `total_audio_windows`, `acoustic_complexity_index`, `normalized_difference_soundscape_index`), `coverage` (`metric_name`, `expected_species_count`, `detected_expected_count`, `detected_unexpected_count`, `gap_count`, `coverage_ratio`, `coverage_percentage`, `observation_adequacy`, `adequacy_explanation`, `disclaimer`), `expected_and_detected[]`, `expected_but_not_detected[]` (`species_id`, `not_detected=true`, `evidence_status="insufficient_evidence_for_absence"`, `possible_factors`), `detected_unexpected[]`, `interpretation`, `scientific_disclaimer`.
- **`GET /api/v1/sites/{site_id}/geo-context` (`SiteGeoContextResponse`):** `site_id`, `site_name`, `latitude`, `longitude`, `location_sensitivity`, `week`, `model_version`, `total_regional_species`, `expected_species_count`, `rare_species_count`, `top_regional_species[]` (`species_id`, `scientific_name`, `common_name`, `birdnet_taxonomy_id`, `species_code`, `geo_score`, `occurrence_status`), `disclaimer`.

---

## E. Observed Latency & Privacy Benchmark Results

Executed `benchmark_scene10_11.py` after all backend code edits (using real BirdNET Geo V3.0 ONNX inference, 14,082 species & 11,725 taxonomy CSV entries):

| Metric | Observed Measurement |
|---|---|
| Cold BirdNET Geo V3.0 load + taxonomy index | `821.23 ms` |
| Geo cache miss median | `61.69 ms` |
| Geo cache hit median (`OrderedDict` + read-only slice) | `0.0038 ms` |
| Provider `get_expected_species` cold | `933.72 ms` |
| Provider `get_expected_species` warm median | `1.20 ms` |
| `POST /api/v1/ecology/observation-gap` E2E cold | `230.32 ms` |
| `POST /api/v1/ecology/observation-gap` E2E warm median | `15.61 ms` |
| `POST /api/v1/ecology/observation-gap` E2E warm p95 | `21.40 ms` |
| Restricted GPS coordinates leaked to logs (`22` log lines) | `false` (`0` leaks) |

---

## F. Test Execution Summary

1. **Targeted Ecological & Scene 10/11 Suite (`pytest backend/tests/test_scene10_11_backend_integrity.py backend/tests/test_ecology_api.py backend/tests/test_phase5_geo_temporal_intelligence.py -v --tb=short`):**
   - **Result:** `33 passed, 1 warning in 12.38s` (`15/15` in `test_scene10_11_backend_integrity.py`, `1/1` in `test_ecology_api.py`, `17/17` in `test_phase5_geo_temporal_intelligence.py`).
2. **Full Backend Suite Excluding Live WebSocket Teardown Test (`pytest backend/tests -k "not test_websocket_handshake_and_control_messages" --tb=short -q`):**
   - **Result:** `202 passed, 14 deselected, 28 warnings in 99.52s` (`13` deselected by `pytest.ini` `addopts = -m "not real_model"` plus `1` excluded via `-k`).
3. **Observed Unrelated Timeout:**
   - During the unfiltered `pytest backend/tests` run prior to filtering, tests `1..88` passed, and `backend/tests/test_live_api_and_protocol.py::test_websocket_handshake_and_control_messages` hit the `pytest.ini` `30.0s` timeout inside Starlette `TestClient` blocking-portal shutdown (`anyio.from_thread.start_blocking_portal` `thread.join()`). That WebSocket live-stream test is outside Scene 10/11 ecological intelligence scope and was not modified.
