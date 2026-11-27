# ECOsonic 3.0 — Overnight Build 02 (`ACT 07 → ACT 10`)

**Scope:** Continuous single-WebGL-canvas progression extending **ACT 06 — ACOUSTIC FIELD** through **ACT 07 — SPECIES**, **ACT 08 — DISTURBANCE**, **ACT 09 — SILENCE**, and **ACT 10 — ECOLOGICAL CONTEXT**.  
**Hard Boundary:** Acts 11–16 (`EXPECTED SPECIES`, `OBSERVATION GAP`, `UNEXPECTED TAXA`, `GROUNDED INTERPRETATION`, `RETURN TO FOREST`, `OBSERVATORY`) remain unimplemented (`STORYBOARD_REGISTRY` keeps `implemented: index <= 9` in [`src/domain/storyboard.ts`](../src/domain/storyboard.ts)).

---

## 1. Phase 0 Gate: Visual Continuity (`ACT 02 → ACT 06`)

Before extending the storyboard, the closing frames and sequence behavior of `ACT 02 → ACT 06` were visually verified across desktop and mobile screenshots. During mobile inspection, header navigation spacing at `390px` width was refined in [`src/ui/EditorialShell.tsx`](../src/ui/EditorialShell.tsx) so `SEQUENCE` and `MIC / DEMO / SILENCE` telemetry controls never crowd each other (`docs/screenshots/act06-mobile.png`), and ACT 02–06 visual layers remain unbroken inside the single [`WebGLStage`](../src/visual/engine/WebGLStage.ts).

---

## 2. Scene Architecture (`ACT 07 → ACT 10`)

All 10 acts share **1 `<canvas>` and 1 Three.js WebGL context** inside [`CinematicStage`](../src/visual/Cinematic/CinematicStage.tsx), orchestrated by the deterministic state machine [`cinematicSequence.ts`](../src/visual/Cinematic/cinematicSequence.ts) and paired with restrained editorial/scientific HTML/SVG overlays in [`Act07To10Overlay`](../src/visual/Cinematic/CinematicOverlays.tsx).

### ACT 07 — SPECIES (`ACT_07_SPECIES`)
- **Narrative Flow:** `SOUND → LOCALIZED TRACE → ORGANISM IDENTITY`.
- **Visual Mechanism:** Drives `speciesEmphasis` (`1.0` in ACT 07) inside [`acousticFieldEngine.ts`](../src/visual/AcousticField/acousticFieldEngine.ts) and [`acousticFieldState.ts`](../src/visual/AcousticField/acousticFieldState.ts), projecting the spherical-harmonic localized bio-acoustic trace onto 2D viewport coordinates (`ProjectedSpatialTrace`: `xPct`, `yPct`, `active`, `isDisturbance`).
- **Organic Overlay:** [`Act07To10Overlay`](../src/visual/Cinematic/CinematicOverlays.tsx) anchors a thin SVG hairline pointer (`rgba(232, 228, 220, 0.35)`) directly from the 3D field trace to species common name, Latin binomial, confidence %, and dominant frequency (`Hz`).
- **Signal Integrity:** Strictly distinguishes live BirdNET detections (`isDemo: false`) from demo signals (`isDemo: true`) and displays `LISTENING FOR AVIAN VOCAL SIGNATURES` when live audio has yielded zero vocalizations rather than injecting fake bird cards.

### ACT 08 — DISTURBANCE (`ACT_08_DISTURBANCE`)
- **Visual Mechanism:** `disturbanceEmphasis` couples to `DisturbanceEvent` (`kind`, `intensity`, `azimuthRad`, `elevationRad`) to deform particle orbital strata and shift localized field structure without red alert chrome or warning icons.
- **Scientific Restraint:** Copy uses strictly observational phrasing (`ACOUSTIC DISTURBANCE`, `HUMAN-MADE SOUND DETECTED WITHIN FIELD STRATA.`, `OBSERVATIONAL STATE ONLY · NO ECOLOGICAL HARM OR CAUSALITY CLAIMED`).
- **Temporal Co-Occurrence:** When both a `DetectionEvent` and `DisturbanceEvent` arrive within 60 seconds, [`Act07To10Overlay`](../src/visual/Cinematic/CinematicOverlays.tsx) reports exact delta seconds and chronological order with: *"Temporal proximity only; causality is not inferred."*

### ACT 09 — SILENCE (`ACT_09_SILENCE`)
- **Reused Physics (No Duplicate Silence System):** [`cinematicSequence.ts`](../src/visual/Cinematic/cinematicSequence.ts) sets `silenceOverride: 0.92`, fed directly into [`stepAcousticFieldState`](../src/visual/AcousticField/acousticFieldState.ts) (`stepAcousticFieldState(prev, snap, dt, silenceOverride)`). Particles smoothly settle into a low-energy obsidian equilibrium rather than blanking the viewport.
- **Overlay:** Displays `ACT 09 · SILENCE`, `SILENCE IS ALSO AN OBSERVATION.`, and `NON-DETECTION IS NEVER PROOF OF BIOLOGICAL ABSENCE.` Navigation uses compact label `09 STILL` in [`EditorialShell.tsx`](../src/ui/EditorialShell.tsx) so the Act 01/06 `SILENCE` audio mode button remains unambiguous.

### ACT 10 — ECOLOGICAL CONTEXT (`ACT_10_ECOLOGICAL_CONTEXT`)
- **3D Geographic Context Layer:** [`createEcologicalGlobeLayer`](../src/visual/Globe/ecologicalGlobe.ts) renders inside the shared `WebGLStage` scene (`globeOpacity`: `0 → 1`):
  - Obsidian bathymetry sphere (`SphereGeometry`) + slate Fresnel atmospheric rim (`ShaderMaterial`, additive blending) + subtle 45° spherical graticule arcs (`LineSegments`).
  - **Bundled Offline Landmass Asset:** [`src/assets/geo/world-land.json`](../src/assets/geo/world-land.json) (`78,916` bytes, derived from Public Domain Natural Earth 110m Physical Land: `3,455` land-mask dots + `127` coastline outlines) replaces runtime external network fetches.
  - **Generalized Locus Beacon:** Warm ochre/parchment observation locus marker (`47.86°, -123.93°` in live Olympic National Park validation) renders **only** when the backend returns real `generalized_coordinates`; when null or disconnected, no beacon is fabricated.
  - **Adaptive Framing:** Desktop positions the globe left (`x = -1.08`, `scale = 1.05`) leaving the right column free for the `Expected vs. Observed` ledger; mobile frames the globe unobstructed in the top 34% (`y = 1.62`, `scale = 0.54`) above `pt-[35dvh]` content.

---

## 3. Real Backend Ecology Contract & Scientific Guardrails

- **API Adapter:** [`fetchObservationGapFromBackend`](../src/api/ecosonicEcologyApi.ts) queries `POST ${VITE_ECOSONIC_API_URL}/api/v1/ecology/observation-gap` using the live `session_id` (and optional generalized `latitude`/`longitude`) stored in [`acousticStore`](../src/domain/acousticStore.ts).
- **Schema Alignment ([`src/domain/acousticFieldTypes.ts`](../src/domain/acousticFieldTypes.ts)):** Matches `ObservationGapResponse` (`ObservationContext`, `ObservationGapCoverage`, `DetectedSpeciesItem`, `ObservationGapSpeciesItem`, `EcologicalInterpretation`, `scientific_disclaimer`).
- **Offline Honesty:** When `VITE_ECOSONIC_API_URL` or a live `session_id` is absent, or when the HTTP request fails, `ecologicalStatus` transitions to `"unavailable"`, displaying `BACKEND CONTEXT UNAVAILABLE` / `UNSPECIFIED IN SESSION` without fabricating mock species checklists or coordinates.
- **Non-Absence Discipline:** Expected taxa without detections are always labeled `NOT DETECTED · INSUFFICIENT EVIDENCE FOR ABSENCE` (`not_detected` / `evidence_status: "insufficient_evidence_for_absence"`), never `"absent"`, and `EcologicalInterpretation` (`gemini` or `deterministic_rule_engine`) is rendered subordinate to deterministic checklist counts and `observation_adequacy`.

---

## 4. Verification & Measured Performance

All automated checks below were run after the final code edit against the live ECOBIRDS FastAPI server (`127.0.0.1:8000`) and production Vite build (`VITE_ECOSONIC_API_URL=http://127.0.0.1:8000`):

- **Unit & Integration Tests (`npm test`):** `6/6` test files passed, `24/24` tests passed (`acousticFieldState.test.ts` 4, `acousticStoreAndStoryboard.test.ts` 4, `ecosonicProtocol.test.ts` 2, `forestScene.test.tsx` 3, `AcousticField.test.tsx` 3, `cinematicSequence.test.tsx` 8).
- **Production TypeScript + Vite Build (`npm run build`):** `tsc -b && vite build` passed (`60` modules, `0` errors).
- **Live Ecological Response (`127.0.0.1:8000`):** Verified `POST /api/v1/live/sessions` + `POST /api/v1/ecology/observation-gap` (`47.86, -123.93`) returned `expected_species_count: 60`, `gap_count: 60`, `observation_adequacy: "insufficient_duration"`, `provider: "deterministic_rule_engine"`.

| Viewport | Act | Median FPS | Min FPS | p95 Frame (ms) | Heap (MB) | Draw Calls | Canvases | Overflow X |
|---|---|---|---|---|---|---|---|---|
| Desktop `1440×900` | `act06` | `142.9` | `128.2` | `7.1` | `8.5` | `9` | `1` | `false` |
| Desktop `1440×900` | `act07` | `144.9` | `136.1` | `7.1` | `8.8` | `9` | `1` | `false` |
| Desktop `1440×900` | `act08` | `142.9` | `135.1` | `7.2` | `8.1` | `9` | `1` | `false` |
| Desktop `1440×900` | `act09` | `144.9` | `133.3` | `7.2` | `8.9` | `9` | `1` | `false` |
| Desktop `1440×900` | `act10` | `142.9` | `131.6` | `7.4` | `8.3` | `16` | `1` | `false` |
| Desktop `1920×1080` | `act06` | `142.9` | `135.1` | `7.2` | `7.4` | `9` | `1` | `false` |
| Desktop `1920×1080` | `act07` | `142.9` | `137.0` | `7.2` | `7.3` | `9` | `1` | `false` |
| Desktop `1920×1080` | `act08` | `144.9` | `138.9` | `7.2` | `7.9` | `9` | `1` | `false` |
| Desktop `1920×1080` | `act09` | `144.9` | `137.0` | `7.2` | `7.2` | `9` | `1` | `false` |
| Desktop `1920×1080` | `act10` | `142.9` | `131.6` | `7.5` | `7.3` | `14` | `1` | `false` |
| Mobile `390×844` | `act06` | `144.9` | `137.0` | `7.1` | `6.8` | `6` | `1` | `false` |
| Mobile `390×844` | `act07` | `144.9` | `137.0` | `7.2` | `8.1` | `6` | `1` | `false` |
| Mobile `390×844` | `act08` | `144.9` | `133.3` | `7.3` | `7.4` | `6` | `1` | `false` |
| Mobile `390×844` | `act09` | `142.9` | `137.0` | `7.2` | `8.1` | `6` | `1` | `false` |
| Mobile `390×844` | `act10` | `144.9` | `137.0` | `7.1` | `8.1` | `13` | `1` | `false` |
| Mobile `412×915` | `act06` | `144.9` | `129.9` | `7.2` | `7.3` | `6` | `1` | `false` |
| Mobile `412×915` | `act07` | `144.9` | `138.9` | `7.1` | `7.3` | `6` | `1` | `false` |
| Mobile `412×915` | `act08` | `144.9` | `137.0` | `7.1` | `7.9` | `6` | `1` | `false` |
| Mobile `412×915` | `act09` | `144.9` | `129.9` | `7.4` | `7.1` | `6` | `1` | `false` |
| Mobile `412×915` | `act10` | `144.9` | `137.0` | `7.1` | `7.8` | `11` | `1` | `false` |

- **Continuous Playback (`ACT 06 → ACT 10`) & Reduced Motion:** `observedActs` stepped cleanly through `ACT_06_ACOUSTIC_FIELD`, `ACT_07_SPECIES`, `ACT_08_DISTURBANCE`, `ACT_09_SILENCE`, and `ACT_10_ECOLOGICAL_CONTEXT` (`canvasesDuringSeq: 1`, `errors: []`, recorded to `docs/screenshots/act06-to-10-sequence.webm`). Reduced-motion verification on `act10-reduced-motion` (`1440×900`) settled cleanly at `progress: 1` (`144 FPS`, `14` drawCalls, `0` errors).

---

## 5. Known Limitations & Next Step Scope

- Live headless Chromium sessions without microphone audio input stay honestly in listening/monitoring states during ACT 07 and ACT 08 (`detections: []`, `disturbances: []`); visual bio-trace/disturbance projection can be exercised either via live microphone/WS events or explicit `DEMO` audio mode.
- The next milestone implements **ACT 11 → ACT 16** (`EXPECTED SPECIES`, `OBSERVATION GAP`, `UNEXPECTED TAXA`, `GROUNDED INTERPRETATION`, `RETURN TO FOREST`, and `OBSERVATORY`).
