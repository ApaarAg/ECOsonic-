# ECOsonic — ACT 12: Observation Gap Visual & Interaction Integration

**Scope:** `ACT 12 — OBSERVATION GAP` integrated into the continuous cinematic timeline immediately following `ACT 11 — EXPECTED SPECIES` over the persistent shared `EcologicalField` WebGL background.

---

## 1. Narrative Intent

Scene 11 (`ACT 11 · EXPECTED SPECIES`) establishes the modeled regional ecological baseline (*"What species belong to this context?"*).  
Scene 12 (`ACT 12 · OBSERVATION GAP`) evolves that physical archive into **evidence correspondence** (*"Where does observation differ from expectation?"*): comparing expected taxa against actual BirdNET acoustic detections without turning the screen into a warning dashboard or inferring biological absence from non-detection.

---

## 2. Scene 11 → Scene 12 Transition

- **Storyboard & Timeline (`frontend/src/domain/storyboard.ts`, `frontend/src/cinematic/CinematicTimeline.ts`, `frontend/src/visual/Cinematic/cinematicSequence.ts`):**
  - Marked `OBSERVATION GAP` (`index: 12`) as `implemented: true` (`index <= 11`).
  - Extended `TOTAL_TIMELINE_VH` to `1240` and allocated contiguous non-overlapping segments `[0.900, 0.950]` to `ACT_11_EXPECTED_SPECIES` and `[0.950, 1.000]` to `ACT_12_OBSERVATION_GAP`.
  - Updated `CinematicTransition.ts`, `CinematicPage.tsx` (`?act=observation-gap` / `#observation-gap` / `#12`), `EditorialShell.tsx` (`12 GAP`), and `CinematicStage.tsx` so Scene 11 and Scene 12 crossfade reversibly (`getActOverlayOpacity` sum `= 1.0` at the `0.950` boundary) while the underlying WebGL background remains untouched (`sameBgNode: true`, `sameCanvasNode: true`, `sameWebGLContext: true`, `canvasCount: 1`).

---

## 3. Reused Visual Language

- **Shared WebGL Background:** Unmodified (`EcologicalField` nodes, filaments, contour strata, and beacons continue seamlessly at `z-0` with zero restarts or context recreation).
- **Asymmetric Specimen Plate Geometry:** Directly reuses `buildSpecimenPlateGeometry` (`frontend/src/visual/ExpectedSpecies/specimenPlateGeometry.ts`) for the Expected Baseline Plate (`variant="left"`), the Observation Record Plate (`variant="active"`), and their inner image apertures, keeping the exact SVG `<clipPath>` + inset SVG perimeter `<path>` + `drop-shadow` aesthetic.
- **Typography & Color Tokens:** Reuses `font-editorial` (`Instrument Serif`), `font-mono`, and ECOsonic's restrained `#080909` / `#D8D4C8` / `#8B918B` / `#6E8272` / `#C89B62` palette.

---

## 4. Observation-Gap Composition

Implemented in `frontend/src/visual/ObservationGap/ObservationGapScene.tsx` and `ObservationGapCorrespondence.tsx`:
- **Archival Masthead:** Quiet printed header (`ACT 12 · OBSERVATION GAP · EVIDENCE CORRESPONDENCE`), site/coordinate/recording-duration strip, and concise methodological cue.
- **Correspondence Filter & Index Strip:** Monospace filters (`ALL`, `OBSERVATION GAP`, `DETECTED`, `OUTSIDE BASELINE`) plus sequential plate index pills (`01`, `02`, ...) with `← Prev` / `Next →` and Left/Right arrow keyboard navigation.
- **Evidence Pair & Connector:** Pairs the **Expected Baseline Plate** (left) and **Observation Record Plate** (right) across a thin `1px` SVG registration connector (`data-testid="gap-correspondence-connector"`).
- **Ledger Summary Strip:** Restrained single-line archival summary (`EXPECTED · DETECTED · GAP · OUTSIDE BASELINE · COVERAGE`) and mandatory scientific disclaimer at the footer, avoiding SaaS comparison tables or large warning boxes.
- **Field Note Dialog (`ObservationGapFieldNote.tsx`):** `createPortal(..., document.body)` at `z-[60]` displaying taxon baseline priors, detection confidence/intervals, possible non-detection factors, grounded session interpretation, and the mandatory `Epistemological Boundary` block.

---

## 5. `expected_and_detected` State

- Both Expected and Observed plates render intact specimen photographs inside asymmetric apertures.
- Continuous `1px` moss-slate SVG correspondence line (`●────────────●`, `data-correspondence-state="confirmed"`) bridges baseline to observation, showing detection count, max BirdNET score, observed second interval, and `NOTE · XX →`.

---

## 6. `expected_but_not_detected` State

- The Expected Baseline Plate retains the species photograph and prior metadata.
- The correspondence line terminates at an archival gap cross (`●────── ╳ ······`, `data-correspondence-state="gap"`).
- The Observation Record Plate preserves its exact physical asymmetric silhouette and perimeter border, revealing a subdued **empty observation aperture** (`data-testid="gap-empty-aperture"`) with hairline registration crosshairs, `NOT DETECTED IN RECORD`, and `INSUFFICIENT EVIDENCE FOR ABSENCE`—communicating the gap visually without any warning card or claim of absence.

---

## 7. `detected_unexpected` State

- The Expected Baseline position renders an unindexed dashed-perimeter socket (`NO BASELINE PRIOR · OUTSIDE SEASONAL THRESHOLD`).
- A dotted field-arrival connector (`······ ◎ ──────●`, `data-correspondence-state="unexpected"`) links to an intact Observation Record Plate accented in restrained warm ochre (`OBSERVED · OUTSIDE BASELINE`), presenting the detection as an observational entry without labeling it invasive, abnormal, or harmful.

---

## 8. Scientific Wording Safeguards

- Strict data mapping via `observationGapState.ts` (`buildObservationGapViewModel`) consumes authoritative backend `EcologicalGapSnapshot` arrays (`expected_and_detected`, `expected_but_not_detected`, `detected_unexpected`) and excludes non-biological sound classes via `isBiologicalTaxon`.
- Never fabricates observations offline; explicit `loading`, `unavailable`, and `empty` (`location_unspecified`) states preserve backend reasons, with `buildExplicitDemoObservationGap()` triggered **only** by explicit user click on `Load Demo Observation` (clearly badged `DEMO OBSERVATION`).
- All non-detection copy explicitly states `NOT DETECTED IN RECORD` / `INSUFFICIENT EVIDENCE FOR ABSENCE` and never claims species absence, extinction, or habitat loss.

---

## 9. Responsive Behavior

- **Desktop (`1440×900`, `1920×1080`):** Horizontal archival evidence pair (`Expected` — `Connector` — `Observed`, `262×332 px` plates) with full ledger and `0` horizontal overflow.
- **Tablet (`768px–1099px`):** Scales plates smoothly to `232×300 px` while keeping horizontal correspondence intact.
- **Mobile (`390×844`, `412×915`):** Switches cleanly to a sequential vertical archival flow (`EXPECTED` → vertical SVG connector `h-12` → `OBSERVED`, `264×236 px` plates) with `0` horizontal overflow and readable metadata.

---

## 10. Reduced-Motion Behavior

- Respects `prefers-reduced-motion: reduce`:
  - Disables overlay translate/scale transitions in `CinematicStage.tsx`.
  - Sets `lineDrawn = true` immediately with `transition: none` on SVG correspondence lines (`stroke-dashoffset`) and plates.
  - Preserves complete static visual composition and all click/keyboard/dialog interactions.
- Verified in Playwright with `page.emulateMedia({ reducedMotion: "reduce" })`.

---

## 11. Test Results

- **`npm --prefix frontend run build` (`tsc -b && vite build`):** **PASS** (`0` TypeScript errors, `84` modules transformed).
- **`npm --prefix frontend test` (`vitest run`):** **PASS** — `17` test files, `80` tests passed (`0` failed, `0` skipped), including `frontend/src/test/observationGapScene.test.tsx` covering loading/unavailable/empty states, all 3 observation-gap categories, scientific wording safeguards, asymmetric plate clip paths, and Field Note modal interaction.

---

## 12. Browser Validation Results (`frontend/scripts/validate-scene12-observation-gap.mjs`)

Evidence stored in `docs/audit_evidence/scene12_observation_gap/validation_summary.json` and viewport screenshots:

| Viewport | Scene 11 → 12 Shared BG & Canvas Preserved | Transparent Outer Layer | Asymmetric Plate `clipPath` & SVG Borders | Broken Images | Horizontal Overflow | Console Errors |
|---|---|---|---|---|---|---|
| `1440×900` | `true` (`1` canvas, `bgTextLength: 0`) | `true` | `expected` + `observed` active | `0` | `false` | `0` |
| `1920×1080` | `true` (`1` canvas, `bgTextLength: 0`) | `true` | `expected` + `observed` active | `0` | `false` | `0` |
| `390×844` | `true` (`1` canvas, `bgTextLength: 0`) | `true` | `expected` + `observed` active | `0` | `false` | `0` |
| `412×915` | `true` (`1` canvas, `bgTextLength: 0`) | `true` | `expected` + `observed` active | `0` | `false` | `0` |

- **3-State Correspondence Verification (Playwright):** `confirmedState: "confirmed"`, `gapState: "gap"`, `unexpectedState: "unexpected"`, plus `ObservationGapFieldNote` dialog open/close verified.
- **Reduced Motion (`1440×900`):** `reducedMotionMatch: true`, `canvasCount: 1`, `connectorPresent: true`, `horizontalOverflow: false`.
