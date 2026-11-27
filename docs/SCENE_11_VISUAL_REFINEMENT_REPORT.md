# ECOsonic 3.0 — Scene 11 Visual Refinement Report

## 1. Files Changed

- `frontend/src/visual/ExpectedSpecies/SpeciesSpecimen.tsx`
- `frontend/src/visual/ExpectedSpecies/ExpectedSpeciesScene.tsx`
- `frontend/src/visual/ExpectedSpecies/SpeciesFieldNote.tsx`
- `frontend/src/visual/ExpectedSpecies/ExpectedSpeciesArchive.tsx`

## 2. Original Visual Problem

Scene 11 (`ACT 11 · EXPECTED SPECIES`) had a noticeable dark-green cast across its scene backdrop, radial atmospheric gradient, loading/error/empty containers, specimen plates, custom cursor, and Field Note modal, which clashed with the neutral black/obsidian/charcoal editorial palette used by Scene 10 and the rest of ECOsonic. In addition, the specimen plates used sharp `rounded-[2px]` outer corners and `rounded-[1px]` inner image frames, giving them a harsh/angular UI-component feel rather than refined archival specimen plates.

## 3. Root Cause of Green Treatment

Explicit green-shifted hex and RGBA values were hardcoded across the Scene 11 components:
- Scene container & atmospheric gradient (`ExpectedSpeciesScene.tsx`): `bg-[#070B09]/92`, `rgba(20, 32, 25, 0.42)` → `rgba(7, 11, 9, 0.96)`, plus `bg-[#101814]`, `bg-[#0D1410]`, and `bg-[#0B110E]/95`.
- Specimen plates (`SpeciesSpecimen.tsx`): `bg-[#121A15]`, `bg-[#0C120F]`, `bg-[#111814]`, `bg-[#080C0A]`, `rgba(7,11,9,...)` gradient scrims, and `focus-visible:ring-offset-[#070B09]`.
- Field Note modal (`SpeciesFieldNote.tsx`): `bg-[#050806]/90` backdrop, `bg-[#111814]` sheet, `bg-[#0A0F0C]` controls/callouts, and `bg-[#080C0A]` image frame.
- Archive cursor (`ExpectedSpeciesArchive.tsx`): `#101C17` cursor fill/text.

## 4. Black-Theme Changes

Replaced all green-tinted surface and scrim colors with neutral near-black/obsidian/charcoal values matching Scene 10:
- **Scene wrapper & radial vignette (`ExpectedSpeciesScene.tsx`)**: `bg-[#09090B]/95` (`rgba(9, 9, 11, 0.95)`) with neutral vignette `radial-gradient(ellipse 80% 55% at 50% 45%, rgba(14, 14, 18, 0.38) 0%, rgba(5, 5, 7, 0.97) 76%)`.
- **State containers & badges (`ExpectedSpeciesScene.tsx`)**: `bg-[#101012]` adequacy pill, `bg-[#0D0D0F]` loading skeleton plates, `bg-[#0C0C0E]/95` error and empty-state panels.
- **Specimen plates (`SpeciesSpecimen.tsx`)**: `bg-[#111113]` selected outer plate, `bg-[#101012]` selected inner plate, `bg-[#0B0B0D]` inactive spine plates, `bg-[#080809]` image aperture, neutral `rgba(5,5,7,...)` spine gradient scrims, and `focus-visible:ring-offset-[#09090B]`.
- **Field Note modal (`SpeciesFieldNote.tsx`)**: `bg-[#050507]/90` backdrop, `bg-[#111113]` sheet, `bg-[#080809]` plate frame, and `bg-[#0C0C0E]` close button and epistemological boundary callout.
- **Archive pointer cursor (`ExpectedSpeciesArchive.tsx`)**: `#111113` replacing `#101C17`.

## 5. Specimen Card Corner Changes

- **Specimen outer plate (`SpeciesSpecimen.tsx`)**: Updated `rounded-[2px]` → `rounded-[11px]` (`11px` computed border-radius), with `overflow-hidden` so both the plate border and inactive spine imagery clip cleanly.
- **Specimen inner image aperture (`SpeciesSpecimen.tsx`)**: Updated `rounded-[1px]` → `rounded-[8px]` to nest concentrically inside the `11px` outer frame.
- **Field Note modal (`SpeciesFieldNote.tsx`)**: Added `sm:rounded-[11px]` on the desktop modal sheet and `rounded-[8px]` on its plate frame to match the specimen card geometry.

## 6. Typography / Color Consistency

Preserved ECOsonic's editorial serif (`font-editorial`), monospace metadata (`font-mono`), parchment (`#E8E4DC`), muted slate (`#9EA7A2`), and restrained ochre (`#D3A36C`) accents. Active specimen borders were subtly lifted (`border-[#E8E4DC]/40`) against `border-[#E8E4DC]/16` inactive spines so the selected specimen reads clearly without any glowing or saturated borders.

## 7. Responsive Verification

Verified in headless Chromium via Playwright across all four target viewports (`1440×900`, `1920×1080`, `390×844`, `412×915`) plus the `1440×900` Field Note modal:
- `overflowX: false` (`scrollWidth === innerWidth`) on all 4 viewports.
- Adjusted mobile top padding in `ExpectedSpeciesScene.tsx` (`pt-28` → `pt-32 sm:pt-20`) so the `ACT 11 · EXPECTED SPECIES` masthead clears the fixed top-right `ACOUSTIC PIPELINE` widget cleanly on `390×844` and `412×915`.

## 8. Build Result

- Command: `npm --prefix frontend run build` (`tsc -b && vite build`)
- Result: **Passed** (`✓ built in 6.33s`, 0 TypeScript or Vite errors).

## 9. Test Result

- Command: `npm --prefix frontend test` (`vitest run`)
- Result: **Passed** (`15 passed (15)` test files, `70 passed (70)` tests, including `src/test/expectedSpeciesScene.test.tsx`).

## 10. Browser Screenshot Verification

Verified rendered screenshots in headless Chromium against `vite preview` (`http://localhost:4173`):
- `1440×900` desktop (`scene11_desktop_1440x900.png`) & Field Note modal (`scene11_fieldnote_1440x900.png`): Verified `sceneBg: rgba(9, 9, 11, 0.95)`, `plateStyle.borderRadius: 11px`, `plateStyle.backgroundColor: rgb(17, 17, 19)`, `sheetBg: rgb(17, 17, 19)`, `sheetRadius: 11px`, 7 specimen plates rendered, `brokenImgs: []`, `pageErrors: []`.
- `1920×1080` desktop (`scene11_desktop_1920x1080.png`): Verified clean centering, 7 specimen plates, `overflowX: false`, `brokenImgs: []`.
- `390×844` mobile (`scene11_mobile_390x844.png`): Verified masthead clears the microphone widget, 3 visible specimen slots, `overflowX: false`, `brokenImgs: []`.
- `412×915` mobile (`scene11_mobile_412x915.png`): Verified clean layout, 3 visible specimen slots, `overflowX: false`, `brokenImgs: []`.

*(Note: `/api/**` was mocked to `503` during standalone preview verification to exercise the offline fallback → explicit `Load Demo Observation` flow; no runtime page errors occurred.)*

## 11. Remaining Limitations

- On `1440×900` desktop, the right edge of the `OBSERVATION: ADEQUATE` pill in the centered masthead sits close to the fixed top-right `ACOUSTIC PIPELINE` widget when both `DEMO OBSERVATION` and `OBSERVATION: ADEQUATE` badges are displayed simultaneously; on `1920×1080` and mobile viewports there is full clearance.

## 12. Final Verdict

ACCEPT — SCENE 11 VISUAL REFINEMENT COMPLETE
