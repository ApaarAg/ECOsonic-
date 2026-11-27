# ECOsonic 3.0 — Scene 11 Master Visual Refinement

## 1. Existing Visual Architecture

Scene 11 (`ACT_11_EXPECTED_SPECIES`) is mounted inside [CinematicStage.tsx](file:///c:/Users/apaar/Desktop/ECOBIRDS/frontend/src/visual/Cinematic/CinematicStage.tsx) on the unified scroll timeline (`TIMELINE_SEGMENTS` in [CinematicTimeline.ts](file:///c:/Users/apaar/Desktop/ECOBIRDS/frontend/src/cinematic/CinematicTimeline.ts), `0.92`–`1.0`) immediately following `ACT_10_ECOLOGICAL_CONTEXT`. Its presentation and interaction are driven by:
- [ExpectedSpeciesScene.tsx](file:///c:/Users/apaar/Desktop/ECOBIRDS/frontend/src/visual/ExpectedSpecies/ExpectedSpeciesScene.tsx): Subscribes to `acousticStore`, resolves `loading` / `error` / `empty` / `ready` states, renders the editorial masthead and ecological context metadata, and hosts the Field Note modal.
- [ExpectedSpeciesArchive.tsx](file:///c:/Users/apaar/Desktop/ECOBIRDS/frontend/src/visual/ExpectedSpecies/ExpectedSpeciesArchive.tsx): Renders the 3D perspective shelf (`perspective: 1650px`), pointer-damped tilt, keyboard/wheel/drag navigation, and active species caption block.
- [SpeciesSpecimen.tsx](file:///c:/Users/apaar/Desktop/ECOBIRDS/frontend/src/visual/ExpectedSpecies/SpeciesSpecimen.tsx): Renders the active photographic plate and surrounding vertical specimen spines.
- [SpeciesFieldNote.tsx](file:///c:/Users/apaar/Desktop/ECOBIRDS/frontend/src/visual/ExpectedSpecies/SpeciesFieldNote.tsx): Portal-mounted detail modal with specimen-to-viewport origin animation and epistemological boundary callout.
- [expectedSpeciesState.ts](file:///c:/Users/apaar/Desktop/ECOBIRDS/frontend/src/visual/ExpectedSpecies/expectedSpeciesState.ts) & [expectedSpeciesInteraction.ts](file:///c:/Users/apaar/Desktop/ECOBIRDS/frontend/src/visual/ExpectedSpecies/expectedSpeciesInteraction.ts): Deterministic biological filtering, slot geometry, damping, and keyboard action resolution.
- [speciesAssetRegistry.ts](file:///c:/Users/apaar/Desktop/ECOBIRDS/frontend/src/visual/ExpectedSpecies/speciesAssetRegistry.ts): Local verified wildlife photography registry with focal anchors.

## 2. Visual Problems Identified

1. **Green-tinted atmosphere & surfaces**: Scene 11 previously used `#070B09`, `#0C120F`, `#111814`, and green radial washes that broke visual continuity with the black/obsidian language of Scenes 8–10.
2. **Card-like corner geometry**: `11px` outer / `8px` inner radii made specimen plates read like modern UI cards rather than physical photographic plates.
3. **Flat depth falloff across distant spines**: Surrounding spines relied mostly on a linear scrim without progressive opacity/detail attenuation, reducing the sense of spatial depth.
4. **Abrupt specimen aperture & metadata transitions**: The active image aperture used a wide horizontal slit-clip (`inset(6% 36% 6% 36%)`) and `108%` vertical slide-in for captions.
5. **Scene 10 → Scene 11 entry**: `ExpectedSpeciesScene` faded in via opacity alone without a subtle spatial emergence.

## 3. Visual Changes Made

- Replaced all green-tinted backgrounds and scrims with true black/obsidian surfaces (`#000000`, `#050606`, `#070808`, `#080909`).
- Added a barely perceptible center luminance vignette (`rgba(16, 18, 17, 0.28)` → `rgba(0, 0, 0, 0.99)`) and microscopic grain (`opacity-[0.025]`) in [ExpectedSpeciesScene.tsx](file:///c:/Users/apaar/Desktop/ECOBIRDS/frontend/src/visual/ExpectedSpecies/ExpectedSpeciesScene.tsx) so the archive feels spatial without looking like a gradient backdrop.
- Updated loading skeleton plates and error/empty panels to `rounded-[3px]` on `#080909`.

## 4. Specimen Presentation Changes

In [SpeciesSpecimen.tsx](file:///c:/Users/apaar/Desktop/ECOBIRDS/frontend/src/visual/ExpectedSpecies/SpeciesSpecimen.tsx):
- **Restrained photographic plate geometry**: Outer plate reduced to `rounded-[3px]`, inner photographic bezel to `rounded-[2px]` with `p-1` dark recessed mat (`#050606`), `1px` inset ring (`ring-black/30`), and subtle corner registration hairlines (`border-[#E8E4DC]/28`).
- **Active vs. inactive depth field**:
  - Active plate (`absOffset === 0`): full opacity (`1.0`), `border-[#E8E4DC]/32`, `bg-[#080909]`, full photographic detail.
  - Adjacent & distant spines (`!isSelected`): progressive depth opacity falloff (`Math.max(0.34, 1 - Math.max(0, absOffset - 1) * 0.16)`), quieter contrast/saturation on `absOffset >= 2`, and `rgba(2,3,3,...)` scrims.
- **Image loading priority**: Preloads active and immediate adjacent specimens (`loading={absOffset <= 1 ? "eager" : "lazy"}`).

## 5. Transition Changes

- **Specimen selection (`SpeciesSpecimen.tsx`)**: Replaced the `36%` horizontal slit-clip with a calm optical focus resolution (`opacity: 0.42 → 1`, `clipPath: inset(4% 10% 4% 10%) → inset(0%)`, `scale(1.035) → scale(1)`) over `580ms cubic-bezier(0.22, 1, 0.36, 1)`.
- **Metadata settle (`ExpectedSpeciesArchive.tsx`)**: Refined bottom caption transitions to `opacity: 0 → 1` with `translate3d(0, 14px, 0) → 0` (`440ms`, `45ms` stagger).
- **Scene 10 → Scene 11 emergence (`CinematicStage.tsx`)**: Added scroll-synchronized depth emergence (`translate3d` + `scale(0.988 → 1)`) tied to `expectedOpacity` when `!reducedMotion`.

## 6. Color-System Alignment

- **Backgrounds**: `#000000`, `#050606`, `#070808`, `#080909`.
- **Primary typography**: `#E8E4DC` (warm ivory / parchment).
- **Secondary typography**: `#8F9496` (muted gray).
- **Restrained moss accent**: `#6E8272` / `#7A8E7E` (status dot and `ACT 11` label only — never background).
- **Muted ochre secondary accent**: `#C89B62` (`FIELD NOTE →`, `DEMO OBSERVATION`, and epistemological callout).

## 7. Typography Alignment

Preserved ECOsonic's existing font stack with zero new fonts:
- `font-editorial` for `"What species belong to this context?"` and species common/binomial names.
- `font-mono` with uppercase tracking (`0.16em`–`0.22em`) for plate numbers, BirdNET taxonomy IDs, site coordinates, seasonal week, and status tiers.

## 8. Field Note Preservation

Preserved [SpeciesFieldNote.tsx](file:///c:/Users/apaar/Desktop/ECOBIRDS/frontend/src/visual/ExpectedSpecies/SpeciesFieldNote.tsx) interaction, keyboard focus trapping, `Escape` closing, and portal mounting, while aligning its surface palette (`#000000/92` backdrop, `#080909` sheet, `#050606` plate frame/buttons) and corner radii (`sm:rounded-[4px]`, `rounded-[2px]` plate frame).

## 9. Responsive Changes

- Desktop (`1440×900`, `1920×1080`): Full 7-slot 3D perspective shelf (`maxPerSide = 6`), centered active plate, full metadata footer.
- Mobile (`390×844`, `412×915`): Deliberate `maxPerSide = 2` (3 visible slots), `pt-32 sm:pt-20` masthead clearance below the fixed top-right microphone widget, zero horizontal overflow (`scrollWidth === innerWidth`).

## 10. Reduced-Motion Behavior

When `prefers-reduced-motion: reduce` is active:
- `SpeciesSpecimen` disables CSS `transition` (`transition: none`), suppresses `imageApertureRef` Web Animations, and disables hover lift/pull.
- `ExpectedSpeciesArchive` disables the `requestAnimationFrame` pointer tilt loop and caption motion.
- `CinematicStage` disables the Scene 10 → 11 emergence transform.
- `SpeciesFieldNote` opens/closes immediately without 3D origin interpolation.

## 11. Performance Measurements

- **Zero new WebGL contexts** and **zero new `requestAnimationFrame` loops**.
- **GPU-composited transforms & opacity** for specimen transitions (`transform`, `opacity`, `clipPath`).
- **Preloaded active + adjacent (`absOffset <= 1`) images** with lazy-loading for distant spines (`absOffset > 1`).
- **Production bundle**: `npm --prefix frontend run build` (`tsc -b && vite build`) built cleanly in `6.71s`.

## 12. Visual Inspection Results

- **Unit & Integration Tests**: `npm --prefix frontend test` (`vitest run`) passed all `15` test files (`70/70` tests).
- **Headless Chromium Inspection (`vite preview` at `http://localhost:4173`)**:
  - `1440×900` (initial `01 Pacific Wren`, switched `02 Varied Thrush`, Field Note open/closed, backend-unavailable state): Verified true black ground, `3px` plate corners, progressive depth falloff across spines, `0` broken images, `0` page errors, `overflowX: false`.
  - `1920×1080`: Verified full composition and clearance, `0` broken images, `overflowX: false`.
  - `390×844` & `412×915`: Verified mobile masthead clearance below the microphone widget, 3-slot shelf readability, `0` broken images, `overflowX: false`.

## 13. Remaining Limitations

- On `1440×900` desktop, when both `DEMO OBSERVATION` and `OBSERVATION: ADEQUATE` badges are rendered simultaneously in the centered masthead, the right edge of `OBSERVATION: ADEQUATE` still sits close to / partially tucked near the fixed top-right `ACOUSTIC PIPELINE` widget; on `1920×1080` and mobile viewports there is full clearance.

## Final Verdict

ACCEPT — SCENE 11 VISUAL REFINEMENT COMPLETE
