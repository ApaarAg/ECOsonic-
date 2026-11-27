# ECOsonic 3.0 — Scene 11 Archival Visual Refinement

## 1. Previous Visual Problem

Scene 11 (`ACT_11_EXPECTED_SPECIES`) was functionally integrated, but still read visually like a modern 3D card carousel: wide gaps separated the surrounding specimens from the active plate, the active plate lacked bound-folio structure, and at `1440×900` the centered masthead badge row sat close to the top-right `ACOUSTIC PIPELINE` widget.

## 2. New Archival Design Concept

Transformed Scene 11 into an **open archival natural-history field book** inside a true black/obsidian cinematic space:
- **Folio Plate Stack**: Tightened horizontal plate spacing (`firstGap` and `stepGap`) and softened `rotateY` angles so neighboring species plates (`02`–`08` and previously viewed plates on the left) read as stacked, overlapping archival pages receding into darkness behind the open central plate.
- **Open Central Plate**: `2px` archival corner geometry (`rounded-[2px]`), `#080909` plate surface, subtle left-edge folio spine crease, recessed `#050606` photographic bezel with corner registration hairlines, and numbered annotation trigger (`NOTE · 01 →`) to open `SpeciesFieldNote`.
- **Neighboring Plate Edges**: Directional edge glints (`border-l-[#D8D4C8]/20` on right-stack plates, `border-r-[#D8D4C8]/20` on left-stack plates) and progressive depth opacity/contrast attenuation.

## 3. Files Changed

- `frontend/src/visual/ExpectedSpecies/expectedSpeciesState.ts`
- `frontend/src/visual/ExpectedSpecies/SpeciesSpecimen.tsx`
- `frontend/src/visual/ExpectedSpecies/ExpectedSpeciesArchive.tsx`
- `frontend/src/visual/ExpectedSpecies/ExpectedSpeciesScene.tsx`
- `frontend/src/visual/ExpectedSpecies/SpeciesFieldNote.tsx`

## 4. Interaction Model

Preserved all existing interactions without adding parallel controllers or RAF loops:
- Arrow keys (`ArrowLeft`/`ArrowRight`), `Home`/`End`, horizontal wheel, pointer drag, and clicking neighboring plates step through the archive stack (`450–640ms` calm documentary easing, zero bounce/overshoot).
- Clicking the active plate (or pressing `Enter`/`Space` on the shelf) opens `SpeciesFieldNote` via the numbered `NOTE · XX →` annotation trigger.
- Preserved loading, backend-unavailable (`Retry Backend` / `Load Demo Observation`), empty, and real observation states.

## 5. Responsive Behavior

- **Desktop (`1440×900`, `1920×1080`)**: Centered open plate with up to 6 receding neighboring plates per side (`maxPerSide = 6`). Masthead constrained to `max-w-[780px]` so `DEMO OBSERVATION` and `OBSERVATION: ADEQUATE` clear the top-right microphone widget cleanly at `1440×900`.
- **Mobile (`390×844`, `412×915`)**: Deliberate 3-slot composition (`maxPerSide = 2`, narrower `42px` neighboring plates), `pt-32 sm:pt-20` top clearance below the microphone widget, `overflowX: false`.

## 6. Reduced-Motion Behavior

- Respects `prefers-reduced-motion: reduce`: disables CSS transitions, 3D plate tilt RAF loop, aperture focus-resolution animation, Scene 10→11 emergence scale/translate, and modal 3D origin interpolation while preserving all specimen selection and Field Note functionality.

## 7. Verification Results

- **Production Build**: `npm --prefix frontend run build` (`tsc -b && vite build`) — **Passed**.
- **Unit & Integration Tests**: `npm --prefix frontend test` (`vitest run`) — **Passed** (`15` test files, `70/70` tests).

## 8. Screenshots Inspected

Inspected rendered screenshots in headless Chromium (`vite preview` at `http://localhost:4173`) across:
- `1440×900`: initial `PLATE · 01` (`Pacific Wren`), switched `PLATE · 02` (`Varied Thrush`), `SpeciesFieldNote` modal open/closed, and backend-unavailable state (`0` broken images, `0` page errors, `overflowX: false`, full mic-widget clearance).
- `1920×1080`: full desktop composition (`0` broken images, `overflowX: false`).
- `390×844` & `412×915`: mobile archival shelf and masthead clearance (`0` broken images, `overflowX: false`).

## 9. Remaining Limitations

- In the standalone `vite preview` verification harness with `reducedMotion: "reduce"`, scrolling via `window.scrollTo` from `?act=10` did not trigger the scroll-driven Act 11 fetch hook within the script timeout, though unit tests (`expectedSpeciesScene.test.tsx`) and `reducedMotion` code paths in `SpeciesSpecimen`, `ExpectedSpeciesArchive`, `SpeciesFieldNote`, and `CinematicStage` are verified.

## Final Verdict

ACCEPT — ARCHIVAL VISUAL REFINEMENT COMPLETE
