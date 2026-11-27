# Scene 12 — Stacked Observation Cards (`ACT 12 · OBSERVATION GAP`)

## 1. Imported Component Used

- **Component Reused In-Place:** `frontend/src/components/originkit/ui/carousel.tsx` (zero external animation packages added; no duplicate carousel implementation created).
- **Adaptations Made to `carousel.tsx`:**
  - Removed the stock `IMG` / `SAMPLE` Unsplash demo URLs and deprecated `Carousel.defaultProps` wrapper; default props are handled in component parameter destructuring and `items = []` renders cleanly without external demo fallback images.
  - Replaced cool slate/navy surface styling (`#1c1c1e`, `rgba(15, 23, 42, 0.28)` shadow, navy radial sheen, bright `#fff` focus outline, `corner = 20`) with ECOsonic archival obsidian (`#050606`), hairline parchment borders (`rgba(216, 212, 200, 0.16–0.34)`), 3px plate corners, deep obsidian drop shadows, subtle corner registration ticks, and warm obsidian/parchment interaction sheen.
  - Added front-vs-side visual hierarchy (`data-front="true"` vs recessed `data-front="false"` brightness/saturation attenuation) plus a 2-card symmetric wing offset in `spotOf` so filtered 2-item views preserve overlapping card depth instead of eclipsing behind the center plate.
  - Exported `CarouselCardItem` metadata fields (`plateLabel`, `commonName`, `scientificName`, `statusText`, `statusVariant`, `statusMeta`, `focalPosition`, `isHabitatFallback`) and `onInspect` / `jumpNonce` / `reducedMotion` callbacks.
- **Scene 12 Adapter Component:** `frontend/src/visual/ObservationGap/ObservationGapCardStack.tsx` connects `ObservationCorrespondenceEntry` records, category filters, and controlled ring batching (`MAX_CARDS_PER_RING = 5`) into `<Carousel />`.

---

## 2. Previous Photo Holder Removed

- Deleted `frontend/src/visual/ObservationGap/ObservationGapCorrespondence.tsx` completely from the repository.
- Updated `frontend/src/visual/ObservationGap/ObservationGapScene.tsx` to import and render `ObservationGapCardStack` directly inside the ready state (`#observation-gap`).
- Verified across source code, Vitest (`src/test/observationGapScene.test.tsx`), and Playwright (`frontend/scripts/validate-scene12-observation-gap.mjs`) that legacy dual-plate selectors (`gap-expected-plate`, `gap-observed-plate`, `gap-correspondence-connector`, `gap-empty-aperture`) no longer exist in the DOM.

---

## 3. Bird Asset Mapping

- `ObservationGapCardStack.tsx` maps each `ObservationCorrespondenceEntry` produced by `buildObservationGapViewModel()` (`frontend/src/visual/ObservationGap/observationGapState.ts`) using `entry.asset` resolved via `speciesAssetRegistry.ts`:
  - `image`: `entry.asset.imageUrl` (local curated avian specimens in `frontend/public/assets/specimens/` or `/assets/canonical/rainforest_branch_overcast.jpg` fallback on missing species plate / `onError`)
  - `focalPosition`: `entry.asset.focalPosition` passed as CSS `object-position` inside `<img className="car-card-img">`
  - `isHabitatFallback`: `entry.asset.plateKind === "habitat_context_fallback"`, annotated subtly as `REF PLATE`
- When backend responses contain many expected taxa (e.g., 60 species), `ObservationGapCardStack` bounds the turntable to `MAX_CARDS_PER_RING = 5` plates at a time while exposing `<- Prev`, `Next ->`, batch selector (`Set X/Y`), and category filters (`All Records`, `Observation Gap`, `Detected`, `Outside Baseline`).

---

## 4. Observation-Gap Status Mapping

Status mapping in `mapEntryStatus()` (`ObservationGapCardStack.tsx`) is strictly deterministic from backend classification fields:

| Entry Category | Card Status Label | Variant Token | Secondary Context |
| :--- | :--- | :--- | :--- |
| `expected_and_detected` | `DETECTED` | `detected` (moss `#6E8272`) | Detection count, max confidence, baseline prior % |
| `expected_but_not_detected` | `NOT DETECTED` | `not_detected` (ochre `#C89B62`) | Baseline occurrence tier + prior % + *"Not detected in acoustic window"* |
| `detected_unexpected` | `DETECTED` | `unexpected_detected` | `OUTSIDE BASELINE` tag + detection count, confidence, *"Unlisted in geographic checklist"* |

Forbidden terminology (`ABSENT`, `EXTINCT`, `MISSING FROM HABITAT`, `SPECIES LOST`, or unprompted `invasive`/`harmful`/`abnormal` labels) is never rendered. Clicking **Inspect Record →** inside a card or **Inspect Note** in the control bar opens `ObservationGapFieldNote.tsx` (`[role="dialog"]`).

---

## 5. Hover & Keyboard Focus Behavior

- **Idle State:** Cards display the portrait avian photograph, subtle corner registration ticks, plate index (`PLATE 01`), common name, and italic scientific name (`car-idle-footer`) with `.car-reveal-layer` hidden (`opacity: 0`).
- **Desktop Hover:** Scoped inside `@media (hover: hover) and (pointer: fine)` so hovering reveals `.car-reveal-layer` (`opacity: 0 -> 1`) while smoothly fading out `.car-idle-footer` (`opacity: 0`) to avoid overlapping text, dims `NOT DETECTED` imagery gently (`brightness(0.56) saturate(0.45)`), and exposes the `Inspect Record →` trigger.
- **Keyboard Focus & Navigation:** Pressing `Tab` focuses `[data-card-trigger]` on the front card (`tabIndex={isFront ? 0 : -1}`), triggering `:focus-within` reveal immediately without needing a pointer. `ArrowLeft` / `ArrowRight` rotates the turntable via keyboard.

---

## 6. Mobile Behavior

- Pointer `:hover` rules are guarded by `@media (hover: hover) and (pointer: fine)` so touch devices do not exhibit sticky ghost hover overlays after navigation taps.
- Tapping the front card toggles `data-revealed="true"` (debounced across `pointerup` and Chromium synthetic `click` via a `400ms` timestamp guard in `lastUpTapAtRef`) to reveal `DETECTED` / `NOT DETECTED` and `Inspect Record →`.
- Tapping a peeking side card (`d !== 0`) glides that card smoothly to the front; horizontal swipes rotate freely across the ring.
- Container `overflow-x-clip` and responsive stage height (`h-[296px] sm:h-[348px] lg:h-[380px]`) keep mobile `390×844` and `412×915` at `0px` horizontal overflow.

---

## 7. Reduced-Motion Behavior

- Respects both `(prefers-reduced-motion: reduce)` and `reducedMotion` prop (`data-reduced={still}`).
- Disables ambient `.car-float` drift keyframes (`animation: none`), disables front-card tilt (`off={held || still}`), snaps `useSpring` and `glide()` instantaneously when `still` is true, and reduces overlay fade duration while keeping hover, focus, and tap status reveals functional.

---

## 8. Shared-Background Preservation

- Scene 11 (`ExpectedSpecies*`), `EcologicalField`, `WebGLStage`, and `CinematicStage` background layers were not modified.
- Playwright scrolling validation from Scene 11 (`?act=ecology`) into Scene 12 verified one persistent full-viewport `<canvas>` (`scene11CanvasCount === 1`, `scrollCanvasCount === 1`) and `[data-testid="shared-scene-background"]` remain active behind Scene 12 (`z-10`).

---

## 9. Build & Test Results

- `npm --prefix frontend run build` (`tsc -b && vite build`): **Passed** (`85 modules transformed`, `dist/` built cleanly with zero TypeScript errors).
- `npm --prefix frontend test` (`vitest run`): **Passed** (`17` test files, `81` tests passed), including 4 tests in `frontend/src/test/observationGapScene.test.tsx` verifying:
  - `Carousel` stacked cards render cleanly and old dual-plate holder selectors are absent.
  - Visual ring density caps at 5 cards for a 60-species dataset (`Set 1/12` pagination).
  - Deterministic `DETECTED` / `NOT DETECTED` / `OUTSIDE BASELINE` reveal and `ObservationGapFieldNote` opening.
  - Floating drift disabled under `reducedMotion`.

---

## 10. Browser Validation Results

Executed `node frontend/scripts/validate-scene12-observation-gap.mjs` against Chromium (`playwright-core`) across all target viewports (artifacts saved under `docs/audit_evidence/scene12_stacked_cards/`):

| Case / Viewport | Result | Key Observed Checks |
| :--- | :--- | :--- |
| `1440×900` (Desktop) | Passed | `scene11CanvasCount: 1`, `scrollCanvasCount: 1`, `slotCount: 5`, `imgCount: 5`, `brokenImgCount: 0`, `unsplashCount: 0`, idle `frontRevealOpacity: "0"`, hover reveals `DETECTED` (`0.965`) & `NOT DETECTED` (`1`), Field Note modal opens cleanly, `0` page/console/asset errors, `0px` overflow |
| `1920×1080` (Desktop) | Passed | `slotCount: 5`, `brokenImgCount: 0`, clean idle (`frontRevealOpacity: "0"`), `0` errors, `0px` overflow |
| `390×844` (Mobile Touch) | Passed | Clean idle (`frontRevealOpacity: "0"`), tap on front card sets `data-revealed="true"` and reveals status (`revealedAfterTap: true`), `0` errors, `0px` overflow |
| `412×915` (Mobile Touch) | Passed | Clean idle (`frontRevealOpacity: "0"`), `slotCount: 5`, `brokenImgCount: 0`, `0` errors, `0px` overflow |
| `1440×900` (`prefers-reduced-motion: reduce`) | Passed | `trackReduced: "true"`, `floatAnim: "none"`, keyboard focus on front trigger reveals status (`focusRevealOpacity: "1"`) |
