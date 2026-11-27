# ECOsonic 3.0 — Scene 11 Visibility & Integration Report

**VERDICT:** `ACCEPT — SCENE 11 VISIBLE AND INTEGRATED`

---

## A. Root Cause

The live ECOsonic 3.0 landing experience served on `http://localhost:5173/` (`frontend/` — `ecosonic-frontend`) renders `App.tsx -> CinematicPage.tsx -> CinematicStage.tsx`, where `STORYBOARD_REGISTRY` (`frontend/src/domain/storyboard.ts`) marked `implemented: index <= 9` (stopping at `ACT 10 — ECOLOGICAL CONTEXT`) and `TIMELINE_SEGMENTS` (`frontend/src/cinematic/CinematicTimeline.ts`) ended at `ACT_10_ECOLOGICAL_CONTEXT` (`0.945..1.00`). Meanwhile, the entire Scene 11 (`ExpectedSpeciesScene`, `ExpectedSpeciesArchive`, `SpeciesSpecimen`, `SpeciesFieldNote`, `speciesAssetRegistry`, and the 18 bird specimen plates) had been built solely inside the separate `web/` directory (`web/src/pages/LandingPage.tsx`), which was not the running landing-page application. Consequently, scrolling or navigating on the live site could never enter or mount Scene 11.

Additionally, once mounted in `frontend/`, three integration behaviors needed repair:
1. `ecosonicEcologyApi.ts` only queried `/api/v1/ecology/observation-gap` when `snap.session.id` was already active in memory and did not inspect stored `/api/v1/live/sessions` or `/api/v1/sites/{site_id}/geo-context`.
2. `CinematicScrollController.ts` did not sync `smoothScrollProgress` on `scroll` when `document.hidden` paused `requestAnimationFrame`.
3. `SpeciesFieldNote.tsx` rendered inside the `z-10` overlay wrapper, letting `App.tsx`'s fixed `z-50` microphone panel overlap the modal close button (`Return to Archive`). Mounting the dialog via `createPortal(..., document.body)` at `z-[60]` and reserving header/mobile top padding resolved the stacking and viewport clearances.

---

## B. Runtime Rendering Path

```text
frontend/src/App.tsx
└─ frontend/src/cinematic/CinematicPage.tsx (unified continuous scroll container: TOTAL_TIMELINE_VH = 1120)
   ├─ frontend/src/ui/EditorialShell.tsx (header telemetry + timeline shortcuts 02..11)
   └─ sticky 100dvh viewport -> frontend/src/visual/Cinematic/CinematicStage.tsx
      ├─ WebGLStage canvas (z-0: Forest -> Leaf -> Water -> Sound -> Acoustic Field -> Globe)
      ├─ AcousticFieldOverlay & Act07To10OverlayTrack (z-10 scroll crossfade overlays)
      └─ ACT_11_EXPECTED_SPECIES overlay (z-10, opacity = getActOverlayOpacity("ACT_11_EXPECTED_SPECIES", scrollProgress))
         └─ frontend/src/visual/ExpectedSpecies/ExpectedSpeciesScene.tsx
            ├─ ExpectedSpeciesArchive.tsx (horizontal 3D perspective shelf)
            │  └─ SpeciesSpecimen.tsx (vertical specimen plates + center selected plate)
            └─ SpeciesFieldNote.tsx (createPortal modal sheet at z-[60])
```

---

## C. Scroll Timeline Ranges

Defined in `frontend/src/cinematic/CinematicTimeline.ts` (`TOTAL_TIMELINE_VH = 1120`) and coupled to `frontend/src/cinematic/CinematicTransition.ts`:

```text
ACT 10 — ECOLOGICAL CONTEXT:
start = 0.845
end   = 0.920

ACT 11 — EXPECTED SPECIES:
start = 0.920
end   = 1.000

ACT 12 — OBSERVATION GAP:
reserved in STORYBOARD_ACTS (index = 11, implemented = false; not implemented in this task)
```

Boundary check: `ACT_10_ECOLOGICAL_CONTEXT.end === ACT_11_EXPECTED_SPECIES.start` (`0.920`), with zero gaps, zero dead zones, and continuous reversible crossfade (`getActOverlayOpacity("ACT_10_ECOLOGICAL_CONTEXT", 0.92) + getActOverlayOpacity("ACT_11_EXPECTED_SPECIES", 0.92) === 1.0`).

---

## D. Ecological Data Path

```text
FastAPI backend (`http://127.0.0.1:8000`)
├─ POST /api/v1/ecology/observation-gap (active or stored geocoded LiveSession)
└─ GET  /api/v1/sites/{site_id}/geo-context (registered geocoded Site fallback)
   → frontend/src/api/ecosonicEcologyApi.ts (`fetchObservationGapFromBackend`, `fetchExpectedSpeciesForScene11`, `buildExpectedBaselineFromGap`)
   → frontend/src/domain/acousticStore.ts (`ecologicalStatus`, `ecologicalContext`, `expectedBaseline`, `ecologicalError`)
   → frontend/src/visual/ExpectedSpecies/expectedSpeciesState.ts (`buildSpecimenArchive`, `isBiologicalTaxon`, `computeArchiveSlotTransforms`)
   → frontend/src/visual/ExpectedSpecies/ExpectedSpeciesScene.tsx
      ├─ State A (ready, specimens > 0): 3D ExpectedSpeciesArchive + SpeciesFieldNote
      ├─ State B (loading): ASSEMBLING ECOLOGICAL BASELINE skeleton
      ├─ State C (ready, empty / location_unspecified): NO EXPECTED SPECIES AVAILABLE + explicit backend reason + manual Load Demo Observation action
      └─ State D (unavailable / 503): ECOLOGICAL BASELINE UNAVAILABLE + Retry Backend + manual Load Demo Observation action
```

---

## E. Files Changed & Created (`frontend/`)

1. **`frontend/public/assets/specimens/*` (18 bird JPEGs + `registry_meta.json`) & `frontend/public/assets/canonical/rainforest_branch_overcast.jpg`** — Copied verified open-licensed local ornithology plates and canonical habitat fallback into the active `frontend/public/assets/` serving root so browser image requests resolve locally with zero 404s.
2. **`frontend/src/domain/storyboard.ts`** — Updated `STORYBOARD_REGISTRY` `implemented: index <= 10` to activate Act 11 (`EXPECTED SPECIES`) while keeping Act 12 (`OBSERVATION GAP`) unimplemented.
3. **`frontend/src/domain/acousticFieldTypes.ts` & `frontend/src/domain/acousticStore.ts`** — Added `ExpectedSpeciesDto`, `ExpectedSpeciesBaselineContext`, `ExpectedSpeciesBaseline`, `expectedBaseline`, and `ecologicalError` state management.
4. **`frontend/src/visual/Cinematic/cinematicSequence.ts`** — Added `ACT_11_EXPECTED_SPECIES` to `CinematicActId`, `CINEMATIC_ACT_ORDER`, `ACT_DURATION_SECONDS`, storyboard mappers, and WebGL director weights (dimming ambient field/globe cleanly beneath Scene 11).
5. **`frontend/src/cinematic/CinematicTimeline.ts` & `frontend/src/cinematic/CinematicTransition.ts`** — Extended `TOTAL_TIMELINE_VH` from `960` to `1120`, allocated contiguous non-zero segment `[0.92, 1.0]` to `ACT_11_EXPECTED_SPECIES`, and adjusted transition smoothstep envelopes across Acts 01–11.
6. **`frontend/src/cinematic/CinematicScrollController.ts` & `frontend/src/cinematic/CinematicPage.tsx`** — Added `document.hidden` instant scroll sync fallback when `rAF` is throttled and `?act=expected-species` / `#expected-species` / `#11` URL jump support.
7. **`frontend/src/ui/EditorialShell.tsx`** — Added `11 EXPECTED` shortcut to `TIMELINE_NAV_ACTS` and added right clearance (`lg:pr-[22.5rem]`) so nav links do not collide with the fixed top-right microphone control panel.
8. **`frontend/src/api/ecosonicEcologyApi.ts`** — Added `buildExpectedBaselineFromGap`, `fetchExpectedSpeciesForScene11` (live session -> observation-gap -> registered site geo-context lookup), error propagation, and user-initiated `buildExplicitDemoBaseline()`.
9. **`frontend/src/visual/ExpectedSpecies/*` (`ExpectedSpeciesScene.tsx`, `ExpectedSpeciesArchive.tsx`, `SpeciesSpecimen.tsx`, `SpeciesFieldNote.tsx`, `expectedSpeciesState.ts`, `expectedSpeciesInteraction.ts`, `speciesAssetRegistry.ts`)** — Integrated Scene 11 into `frontend/` without adding `lucide-react` or a second WebGL context/scroll loop, added image `onError` habitat fallback, rendered `SpeciesFieldNote` via `createPortal` (`z-[60]`), and tuned mobile top clearance (`pt-28 sm:pt-20`).
10. **`frontend/src/visual/Cinematic/CinematicStage.tsx`** — Mounted `ExpectedSpeciesScene` on the shared `z-10` overlay track driven by `getActOverlayOpacity("ACT_11_EXPECTED_SPECIES", scrollProgress)`, wired Act 10/11 backend hooks, and updated aria/field control flags.
11. **`frontend/src/test/acousticStoreAndStoryboard.test.ts`, `cinematicIntegration.test.tsx`, `cinematicSequence.test.tsx`, `expectedSpeciesScene.test.tsx`** — Updated Act 01–11 timeline/storyboard assertions and added Scene 11 state, biology filter, DTO mapping, and Field Note interaction tests.

---

## F. Browser Acceptance Evidence (`http://localhost:5173/` via Chrome CDP)

Verified after final edit across continuous scroll (`y = 0 -> Act 10 -> Act 11 -> back to Act 10 -> re-enter Act 11 -> page reload -> Act 11`), specimen archive reveal, bird photograph loading, Field Note modal opening (`desktop_1440x900`), and pixel inspection:

- `1440×900`: **PASS** (`s10SettledMs = 1461 ms`, `s11SettledMs = 171 ms`, `#expected-species` rect `1424.8 × 900`, `display: flex`, `visibility: visible`, `opacity: 1`, `isCenterInsideExpected: true`, `7/7` plates loaded with `0` broken images, Field Note modal opened, reverse scroll to `ACT_10_ECOLOGICAL_CONTEXT` & reload to `ACT_11_EXPECTED_SPECIES` succeeded).
- `1920×1080`: **PASS** (`s10SettledMs = 1609 ms`, `s11SettledMs = 180 ms`, `#expected-species` rect `1904.8 × 1080`, `isCenterInsideExpected: true`, `7/7` plates loaded with `0` broken images, reverse scroll & reload succeeded).
- `390×844`: **PASS** (`s10SettledMs = 1786 ms`, `s11SettledMs = 325 ms`, `#expected-species` rect `390.4 × 844`, `isCenterInsideExpected: true`, `3/3` visible plates loaded with `0` broken images, reverse scroll & reload succeeded).
- `412×915`: **PASS** (`s10SettledMs = 1631 ms`, `s11SettledMs = 345 ms`, `#expected-species` rect `412 × 915.2`, `isCenterInsideExpected: true`, `3/3` visible plates loaded with `0` broken images, reverse scroll & reload succeeded).
- **Runtime console / asset failures:** `0` uncaught runtime errors, `0` failed network assets (`>= 400`).

---

## G. Build & Test Results

- `npm --prefix frontend run build` (`tsc -b && vite build`): **PASS** (`0` TypeScript errors, `77` modules transformed, built in `4.97 s`).
- `npm --prefix frontend test` (`vitest run`): **PASS** — `15` test files passed (`15/15`), `70` tests passed (`70/70`, `0` failed, `0` skipped) in `10.66 s` (`task-1907`; no edits occurred after this run).
- Backend code was **not** modified during this visibility integration task.

---

## H. Remaining Limitations

1. **Ungeocoded local backend database:** The running backend (`http://127.0.0.1:8000`, started externally prior to this task) currently stores sessions with `latitude: null, longitude: null` and `0` registered monitoring sites (`total: 0`). On initial automatic load without clicking `Load Demo Observation`, Scene 11 honestly renders **State C (`LOCATION: UNSPECIFIED` / `NO EXPECTED SPECIES AVAILABLE`)** rather than fabricating birds; creating a site with coordinates or starting a geocoded live session immediately populates real BirdNET Geo V3.0 species plates.
2. **External legacy process metadata:** In initial backend responses from the pre-existing `uvicorn` PID `31448`, ungeocoded sessions still carried `ecosystem_category: "temperate-rainforest"` in memory until that backend process is restarted with the updated backend defaults.
3. **Dual frontend directories (`frontend/` vs `web/`):** Both directories remain in the repository; `frontend/` (`ecosonic-frontend`) is the live application served on port `5173`. `web/` was not removed so unrelated workspace artifacts remain intact.
4. **Act 12 (`OBSERVATION GAP`):** Remains reserved (`implemented: false`) in `STORYBOARD_REGISTRY` per task scope boundaries.
