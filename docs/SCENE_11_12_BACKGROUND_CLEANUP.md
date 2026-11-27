# Scene 11 + Scene 12 — Background Cleanup (`EcologicalIntelligenceFieldLayer` Disabled)

## 1. Issue Identified

During Scene 11 (`ACT 11 — EXPECTED SPECIES`) and Scene 12 (`ACT 12 — OBSERVATION GAP`), two background visual systems were previously rendering simultaneously:

1. The newly integrated `GalleryTunnel` moving-bird-photo 3D perspective corridor (`frontend/src/components/originkit/ui/hero-13/gallery-tunnel.tsx`).
2. The prior `EcologicalIntelligenceFieldLayer` (`ecologicalFieldEngine.ts` / `ecologicalFieldShaders.ts`) connected filament mesh, glowing beacon/particle nodes, and the `.ecosonic-atmosphere` / `.ecosonic-grain` overlays inside `[data-testid="shared-scene-background"]`.

---

## 2. Exact Cleanup Changes Made

All disabling was scoped strictly to the Act 11–12 timeline path in `frontend/src/visual/Cinematic/CinematicStage.tsx` so shared engines and other cinematic scenes remain untouched:

1. **Disabled `EcologicalIntelligenceFieldLayer` GPU Update & Drawing in Acts 11–12 (`CinematicStage.tsx`):**
   - Separated moving-bird tunnel opacity (`targetTunnelOpacity`) from `ecologicalFieldLayer`.
   - Passed `0` into `ecologicalFieldLayer.update(dt, 0, reduced)` so `ecologicalFieldLayer.group.visible` becomes `false`, suppressing shader updates and preventing any connected mesh filaments, glowing particles, or beacons from drawing or consuming GPU cycles during Acts 11 and 12.
   - Removed the Scene 11–12 camera pull loop that previously repositioned `stage.camera` for the old ecological field.
2. **Removed `.ecosonic-atmosphere` and `.ecosonic-grain` Overlays in Acts 11–12 (`CinematicStage.tsx`):**
   - Removed `"EXPECTED SPECIES"` and `"OBSERVATION GAP"` from `isFieldBackdrop`, leaving those DOM atmosphere/grain layers active only for Acts 06–10 (`ACOUSTIC FIELD`, `SPECIES`, `DISTURBANCE`, `SILENCE`, `ECOLOGICAL CONTEXT`).
3. **Diagnostic Visibility Exposure (`CinematicStage.tsx`):**
   - Exposed `ecologicalFieldVisible: ecologicalFieldLayer.group.visible` in `window.__ECOSONIC_DIAGNOSTICS__()` for automated runtime GPU-visibility verification.
4. **Infrastructure Preserved:**
   - Kept `ecologicalFieldEngine.ts`, `ecologicalFieldShaders.ts`, `EcologicalField`, `CinematicTimeline.ts`, `CinematicTransition.ts`, and Acts 01–10 untouched.

---

## 3. Continuity Verification (`ACT 11 → ACT 12`)

- Both `src/test/movingBirdBackground.test.tsx` and `frontend/scripts/validate-scene11-12-moving-birds.mjs` verify transitioning cleanly from `ACT_11_EXPECTED_SPECIES` into `ACT_12_OBSERVATION_GAP`:
  - `canvasCount === 1` and `sameCanvasInstance === true` (zero WebGL teardown or duplicate canvas).
  - `sameChapterContainer === true` (`[data-testid="shared-hero13-chapter"]` stays mounted continuously as copy shifts from `EXPECTED SPECIES` to `OBSERVATION GAP`).
  - `ecologicalFieldVisible === false`, `atmosphereOverlayCount === 0`, and `grainOverlayCount === 0` in both Scene 11 and Scene 12.
  - Confirmed in `movingBirdBackground.test.tsx` that Acts 06–10 (`ECOLOGICAL CONTEXT`) still render `.ecosonic-atmosphere` and `.ecosonic-grain`.

---

## 4. Build, Test & Browser QA Results

- **`npm --prefix frontend run build` (`tsc -b && vite build`):** Passed (`519` modules transformed, built in `6.59s`).
- **`npm --prefix frontend test` (`vitest run`):** Passed (`18` test files, `84` tests passed), including [movingBirdBackground.test.tsx](../../frontend/src/test/movingBirdBackground.test.tsx), [sharedBackground.test.tsx](../../frontend/src/test/sharedBackground.test.tsx), [expectedSpeciesScene.test.tsx](../../frontend/src/test/expectedSpeciesScene.test.tsx), and [observationGapScene.test.tsx](../../frontend/src/test/observationGapScene.test.tsx).
- **Playwright Browser QA (`node frontend/scripts/validate-scene11-12-moving-birds.mjs`) & Visual Screenshot Inspection:** Passed across `1440×900`, `1920×1080`, `390×844`, `412×915`, and `prefers-reduced-motion: reduce` with `0` errors, `0px` horizontal overflow, `18` loaded bird textures, `0` portrait assets, and visually confirmed clean moving-bird background without mesh lines or particle overlays under [docs/audit_evidence/scene11_12_moving_bird_background/](../docs/audit_evidence/scene11_12_moving_bird_background).
