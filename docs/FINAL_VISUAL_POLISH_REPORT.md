# ECOsonic — Final Visual Polish Pass Report

## Summary Status

Seven of eight requested visual polish items are complete and verified across desktop (`1440×900`, `1920×1080`), mobile (`390×844`, `412×915`), and `prefers-reduced-motion: reduce`.

**Item 8 (Magnetic Dock Final Act) is blocked and was NOT implemented or fabricated.** An exhaustive search of `frontend/`, `web/`, and `.originkit/` found zero Magnetic Dock components in the repository; the OriginKit manifest (`frontend/.originkit/INSTRUCTIONS.md`) records that `swinging-lanyard-badge` (`frontend/src/components/originkit/ui/swinging-lanyard-badge.tsx`) was installed instead. Per task instructions not to recreate or fake Magnetic Dock, ACT 12 remains cleanly intact.

---

## Completed Items (1–7)

### 1. Top-Panel Auto-Hide (`useAutoHideChrome`)
- **Files:** `frontend/src/ui/useAutoHideChrome.ts`, `frontend/src/ui/EditorialShell.tsx`, `frontend/src/App.tsx`
- **Behavior:** Top header (`data-testid="ecosonic-top-chrome"`) and fixed microphone toggle stay visible when idle, smoothly transition out on scroll (`opacity`, `translateY(-12px)`, `blur(4px)`), restore automatically after scroll inactivity (`1200ms`) or pointer hover near the top edge (`y <= 56px`), and stay pinned while the dropdown is open, a header control has focus, or a live mic session/error is active (`ecosonic:chrome-pin`). Respects `prefers-reduced-motion` (`opacity`-only fade).

### 2. Landing Page — `ECOsonic` with Dim Spotlight (`ACT 01`)
- **Files:** `frontend/src/visual/Cinematic/CinematicStage.tsx`, `frontend/src/styles/ecosonic.css`
- **Behavior:** Centers the `Instrument Serif` `ECOsonic` wordmark (`data-testid="landing-ecosonic-spotlight"`) in obsidian `#060708` darkness beneath a restrained, non-neon physical-beam radial spotlight. Fades monotonically out across `smoothstep(0.014, 0.072, scrollProgress)` into `ACT 02 · FOREST` and stays hidden (`mounted: false`) across Acts 02–12.

### 3. Replace Scene-Name Panel with Pixel Swarm Dropdown
- **Files:** `frontend/src/components/originkit/ui/pixel-swarm-dropdown.tsx`, `frontend/src/ui/EditorialShell.tsx`
- **Behavior:** Replaced `ScribbleLoopNav` with the existing OriginKit `PixelSwarmDropdown` wired in compact container mode across 9 ECOsonic chapters (`01 · ECOsonic` through `12 · Observation Gap`).
- **Fixes Applied During Integration & Audit:**
  - Fixed `withMovedControls()` so explicit `autoplay={false}` is never overwritten back to `true` (`AUTOPLAY_LOOP_DEFAULTS`).
  - Kept the compact `460px` canvas wrapper at `pointerEvents: "none"` and synced `interactive={chromeVisible}` so the hidden/closing canvas never intercepts hover or click targets below the header.
  - Tuned open/close timings (`openMs: 420`, `closeMs: 280`) and wired semantic `<button data-testid="pixel-swarm-trigger">` + `<div role="listbox">` / `<button role="option">` hitboxes aligned to the canvas rows.

### 4. `ACT 06` Cleanup
- **Files:** `frontend/src/ui/EditorialShell.tsx`, `frontend/src/visual/AcousticField/AcousticField.tsx`
- **Behavior:** Removed visible `"DEMO"` and `"SILENCE"` mode labels/controls from ACT 06 (`Acoustic Field`), preserving real `BirdNET`, microphone capture, WebSocket, and acoustic field rendering unchanged.

### 5. `ACT 11` & `ACT 12` Typography
- **Files:** `frontend/src/visual/ExpectedSpecies/ExpectedSpeciesScene.tsx`, `frontend/src/visual/ObservationGap/ObservationGapScene.tsx`
- **Behavior:** Refined typographic scale, tracking, measure (`max-w-[58ch]`), leading (`1.62`), and metadata hierarchy across ACT 11 (`Expected Species`) and ACT 12 (`Observation Gap`) using `Instrument Serif` (`font-editorial`) and `Inter Tight` (`font-technical`).

### 6. Heading Hover-Text Reveal (`EditorialHeading`)
- **Files:** `frontend/src/ui/EditorialHeading.tsx`, integrated across `CinematicStage.tsx`, `AcousticField.tsx`, `CinematicOverlays.tsx`, `ExpectedSpeciesScene.tsx`, and `ObservationGapScene.tsx`
- **Behavior:** Pairs `LetterCascade` entrances with non-shifting absolute subline annotations (`data-testid="heading-hover-note-*"`) revealed on mouse hover, keyboard focus, and mobile tap (`pointerType`-aware so mobile taps do not double-toggle `mouseenter` + `click`). Zero layout shift (`H1` bounding boxes unchanged before and after reveal across all 5 viewports).

### 7. Smooth Overlapping `ACT 10 → ACT 11 → ACT 12` Transitions
- **Files:** `frontend/src/cinematic/CinematicTransition.ts`, `frontend/src/visual/Cinematic/CinematicOverlays.tsx`, `frontend/src/visual/Cinematic/CinematicStage.tsx`
- **Behavior:** Replaced hard cut transitions between `ACT 10 · ECOLOGICAL CONTEXT`, `ACT 11 · EXPECTED SPECIES`, and `ACT 12 · OBSERVATION GAP` with overlapping opacity/scale/depth/vignette curves (`ecologicalFieldOpacity` at ACT 10 exit `0.734`, `globeOpacity` `0.996`, continuous `GalleryTunnel` canvas count `1`) verified in both forward and reverse scroll.

---

## Blocked / Incomplete Item

### 8. Magnetic Dock Final Act — Blocked (Component Missing on Disk)
- **Reason:** No Magnetic Dock component exists anywhere in `frontend/`, `web/`, or `.originkit/`.
- **Found Instead:** `frontend/src/components/originkit/ui/swinging-lanyard-badge.tsx` (last installed component listed in `frontend/.originkit/INSTRUCTIONS.md`).
- **Resolution Left to User:** Import the intended Magnetic Dock component into `frontend/src/components/originkit/ui/` before wiring a final interactive dock act, or confirm if `swinging-lanyard-badge.tsx` should be used instead.

---

## Verification Results

All checks below were executed after the final code edit:

1. **TypeScript (Active Edited Scope):**
   - Filtered `npx tsc -b --noEmit` across `src/(App|cinematic/|ui/|visual/|components/originkit/|styles/)` excluding untouched `swinging-lanyard-badge.tsx`: **`0` errors** (`ACTIVE_EDITED_TSC_ERRORS=0`).
   - Note: `frontend/src/components/originkit/ui/swinging-lanyard-badge.tsx` has 2 pre-existing unused-symbol `TS6133` diagnostics (`React`, `easeInOut`).
2. **Production Bundle (`npx vite build`):**
   - **Passed** (`520` modules transformed, built in `7.31s`).
3. **Scoped Unit & Integration Tests (`npx vitest run src/test/`):**
   - **Passed:** `14` test files passed (`14 passed (14)`), `61` tests passed (`61 passed (61)`).
4. **Playwright 5-Viewport Audit (`node scripts/validate-final-visual-polish.mjs`, `PW_EXIT=0`):**
   - Viewports verified: `desktop_1440x900`, `desktop_1920x1080`, `mobile_390x844`, `mobile_412x915`, `desktop_1440x900_reduced` (`prefers-reduced-motion: reduce`).
   - Verified across all 5 viewports:
     - `ACT 01` spotlight visible (`spotlightVisible: true`), old `ScribbleLoopNav` absent (`oldScribbleAbsent: true`), `PixelSwarmDropdown` present (`pixelSwarmPresent: true`).
     - Auto-hide transitions `chromeInitialVisible: "true"` -> `chromeAfterScroll: "false"` -> `chromeOnTopPointer: "true"`.
     - Dropdown selects `06 · Acoustic Field`; ACT 06 has `hasWordDemo: false`, `hasWordSilence: false`, `landingSpotlightMounted: false`.
     - Overlap checks: `ACT 10 -> ACT 11` (`ecologicalFieldOpacity: 0.7344`, `globeOpacity: 0.9958`, `expectedVisible: true`), `ACT 11 -> ACT 12` (`expectedVisible: true`, `gapVisible: true`, `webglCanvasCount: 1`).
     - `EditorialHeading` reveal note visible with zero box shift:
       - `desktop_1440x900`: `764×110` -> `764×110` (`noteOpacity: 0.968`)
       - `desktop_1920x1080`: `764×110` -> `764×110` (`noteOpacity: 0.877`)
       - `mobile_390x844`: `350×71` -> `350×71` (`noteOpacity: 0.968`)
       - `mobile_412x915`: `372×71` -> `372×71` (`noteOpacity: 0.985`)
       - `desktop_1440x900_reduced`: `764×110` -> `764×110` (`noteOpacity: 1`)
     - Reverse scroll `ACT 12 -> ACT 11 -> ACT 10 -> ACT 02 -> ACT 01` verified.
     - Zero console errors, zero page errors, zero failed assets, zero broken images, `overflowPx: 0`, `webglCanvasCount: 1`.
5. **Unfiltered `npm run build` & `npm test -- --run` Baseline (Expected Pre-Existing Failures):**
   - `npm run build` (`tsc -b`): exited `2` solely on pre-existing unimported legacy v1 dashboard files missing `axios`, `lucide-react`, `recharts`, `react-router-dom`, `leaflet`/`react-leaflet`, plus `swinging-lanyard-badge.tsx`.
   - `npm test -- --run`: exited `1` (`19 passed | 2 failed (21)` test files, `84 passed (84)` tests passed); the 2 failures are the pre-existing `axios` import errors in `src/tests/services.test.ts` and `src/tests/api.test.ts`.
