# ECOsonic 3.0 — Scenes 02 → 03 → 04 Continuity Pass (`Forest → Leaf → Water`)

## 1. Implementation Architecture

Scenes `02 FOREST` → `03 LEAF` → `04 WATER` render inside the single shared WebGL context and `requestAnimationFrame` loop managed by [`WebGLStage`](file:///c:/Users/apaar/Desktop/frontend/src/visual/engine/WebGLStage.ts) and orchestrated by [`CinematicStage`](file:///c:/Users/apaar/Desktop/frontend/src/visual/Cinematic/CinematicStage.tsx).

- **Single WebGL Context / Single Loop:** `1` `<canvas>` element, `1` `WebGLRenderer`, `1` `requestAnimationFrame` tick (`7` main-pass draw calls during `ACT_02_FOREST`–`ACT_04_WATER`).
- **Monochrome Enforcement:** All raster plates (`src/assets/stylized/*.webp`), shaders (`forestShaders.ts`, `leafShaders.ts`, `waterShaders.ts`), and `ACT_01`–`ACT_04` UI overlays (`#080808`, `#9E9E9E`, `#C8C8C8`, `#F0F0F0`) enforce neutral grayscale luminance (`R === G === B`) with zero chromatic tints.
- **Scene 01 & Acts 05–10 Preservation:** `AcousticFieldOverlay`, `createAcousticFieldLayer`, `createEcologicalGlobeLayer`, `ecosonicSocket`, `ecosonicAudioCapture`, and `ecosonicEcologyApi` remain functionally unchanged.

---

## 2. State Machine

An explicit sub-state machine (`ForestWaterPhase`) in [`cinematicSequence.ts`](file:///c:/Users/apaar/Desktop/frontend/src/visual/Cinematic/cinematicSequence.ts) governs continuity across `ACT_02_FOREST`, `ACT_03_LEAF`, and `ACT_04_WATER`:

```text
FOREST_IDLE       (ACT_02_FOREST, progress < 0.55)
      ↓
LEAF_ATTACHED     (ACT_02_FOREST, progress >= 0.55)
      ↓
LEAF_DETACHING    (ACT_03_LEAF, progress [0.00, 0.20))
      ↓
LEAF_FALLING      (ACT_03_LEAF, progress [0.20, 0.82))
      ↓
WATER_APPROACH    (ACT_03_LEAF [0.82, 1.00] -> ACT_04_WATER [0.00, 0.14))
      ↓
WATER_CONTACT     (ACT_04_WATER, progress [0.14, 0.24))
      ↓
RIPPLE            (ACT_04_WATER, progress [0.24, 0.68))
      ↓
WATER_SETTLING    (ACT_04_WATER, progress [0.68, 1.00])
```

Resolved via `resolveForestWaterPhase(act, p)` and exposed via `window.__ECOSONIC_CINEMATIC__.getState().phase`.

---

## 3. Forest & Mature Protagonist Tree Composition

Generated deterministically by [`generate-stylized-ecology-plates.mjs`](file:///c:/Users/apaar/Desktop/frontend/scripts/generate-stylized-ecology-plates.mjs) across 4 depth planes:

1. **`BgCanopyPlate` (`z = -4.6`, `20.0 × 13.0`, `parallaxFactor = 0.14`)**: Pale grayscale overcast clearing (`#E2E2E2`–`#5E5E5E`), atmospheric mist shafts, and hazy distant woodland silhouettes (`plate-bg-canopy.webp`).
2. **`MidUnderstoryPlate` (`z = -1.8`, `14.0 × 9.0`, `parallaxFactor = 0.45`)**: Subordinate flanking trees, ferns, and continuous sloped shoreline banks (`plate-mid-understory.webp`) with `depthWrite: true` and matching screen-space edge vignette (`edgeVignette: 0.90`, `tintGain: 0.72`) so flanking trunks remain darker than the distant sky.
3. **`HeroTreePlate` (`z = -0.05`, `8.8 × 6.6`, `parallaxFactor = 0.80`)**: Single mature protagonist tree (`plate-hero-tree.webp`) positioned at `worldX = -0.704` (`px = 996`) with volumetric bark shading, organic root buttresses disappearing into a continuous mossy left-side forest floor bank, layered crown foliage, and an arching **Hero Branch** extending into the pale clearing with an abscission twig socket at `(startX = 0.235, startY = 0.925, startZ = -0.015)` (`px = 1264, py = 716`). `depthWrite: true` and `alpha <= 0.42` discard in `FOREST_PLATE_FRAGMENT_SHADER` ensure the trunk and bank cleanly occlude water behind `z = -0.05`.
4. **`FgFernsPlate` (`z = +1.75`, `9.6 × 6.4`, `parallaxFactor = 1.45`)**: Out-of-focus dark foreground foliage silhouettes (`plate-fg-ferns.webp`, blurred via offscreen canvas filter) sweeping past the outer frame edges during descent without obscuring the leaf or water contact zone.

---

## 4. Leaf Physics & Motion Model

Implemented in [`leafState.ts`](file:///c:/Users/apaar/Desktop/frontend/src/visual/Leaf/leafState.ts) (`evaluateLeafCinematics`) and [`leafShaders.ts`](file:///c:/Users/apaar/Desktop/frontend/src/visual/Leaf/leafShaders.ts):

- **Attached & Detaching (`0.00 <= p < 0.20`)**: `computeBranchLeafAnchor` in `CinematicStage.tsx` mirrors `HeroTreePlate` vertex breeze and parallax displacement, and `rotatedPetioleOffset` pins the petiole tip (`PETIOLE_LOCAL_Y = -0.238`) directly to the twig socket while the leaf flexes and twists around its stem. Between `p = 0.10` and `0.20`, the stem separates visibly from the socket and hesitates briefly before gravity dominates.
- **Falling Trajectory (`0.20 <= p < 1.00`)**: Fixed-substep (`1/90s`) deterministic integration over `6.2s` combining gravity (`-0.78`), broadside aerodynamic lift cushions, positive-initial lateral gusts gliding through the open clearing (`gustX`, `bankGlide`), and 3D Z-approach (`z` reaching `> 1.0` mid-descent before settling toward `MOORED_Z = 0.94`).
- **Non-Constant Rotation**: Asymmetric angular velocity (`avX`, `avY`, `avZ`) damped by broadside air resistance with rotational pauses and two edge-on orientation pulses (`edgeOnPulseA`, `edgeOnPulseB`) that narrow the silhouette edge-on to camera.
- **Contact & Mooring (`waterP >= 0.14`)**: Synchronized at `WATER_CONTACT_PROGRESS = 0.14` (`POOL_SURFACE_Y = -1.65`), dipping `-0.011` into the meniscus before settling onto `y = -1.639`, `rotX = -1.36`.

---

## 5. Camera Motion

In `CinematicStage.tsx`, one continuous documentary camera drives `ACT_01`–`ACT_05`:
- **`ACT_02_FOREST`**: Wide establishing framing (`FOREST_CAMERA_Z = 5.35`, `camTarget = (-0.08, 0.28, 0)`), then a slow dolly (`z -> 4.93`, `y -> 0.55`) onto the hero branch during `LEAF_ATTACHED`.
- **`ACT_03_LEAF`**: Holds gently during detachment (`0.00..0.16`), then tracks the falling leaf downward (`camPos.y: 0.55 -> -0.48`, `camTarget.y: 0.55 -> -1.56`, `z -> 4.18`), allowing upper branches to clear upward while the dark forest pool enters organically from the bottom of the frame.
- **`ACT_04_WATER`**: Settles at `(0.04, -0.48, 4.18)` looking at `(0.04, -1.56, 0.72)` (`~18°` downward angle) so both the shoreline reflection and moored leaf remain clearly framed.

---

## 6. Water Rendering, Reflection & Asymmetric Ripple

Implemented in [`waterShaders.ts`](file:///c:/Users/apaar/Desktop/frontend/src/visual/Water/waterShaders.ts) and [`waterState.ts`](file:///c:/Users/apaar/Desktop/frontend/src/visual/Water/waterState.ts):

- **Glitch Resolution:**
  1. Replaced the `10.0 × 4.4` water quad + front `edgeFade` (which exposed the `#080808` clear background on the bottom 25% of mobile viewports) with a `24.0 × 16.0` plane centered at `z = 1.8` (spanning `z = -6.2` to `+9.8`) with zero near-edge fade.
  2. Enabled `depthWrite: true` and `alpha <= 0.42` discard on `MidUnderstoryPlate` and `HeroTreePlate` so shoreline banks and tree roots properly occlude far water behind `z = -0.05`, eliminating the horizontal rectangular seam artifact.
  3. Synchronized `WATER_CONTACT_PROGRESS = 0.14` between `leafState.ts` and `waterState.ts` so `contactImpulse === 0` until the leaf physically touches `POOL_SURFACE_Y`.
- **Planar Reflection Technique:** A mirrored `reflCamera` (`2 * POOL_SURFACE_Y - camPos.y`) renders the forest plates (above `uClipBelowY = POOL_SURFACE_Y - 0.01`, excluding `waterMesh` and `fgFernsPlate`) and the 3D hero leaf into a `WebGLRenderTarget` (`512×320` desktop, `320×200` mobile) inside the single `WebGLStage`. `WATER_SURFACE_FRAGMENT_SHADER` samples `uReflectionTex` in projective screen space with normal distortion, a 5-tap softness blur, and distance attenuation (`0.74`–`0.48`) so reflections appear darker, softer, and less detailed than the forest above.
- **Ripple Technique:** Combines an oblong localized meniscus depression along the leaf axis (`uContactSplash`) with 3-loci footprint wave interference (`d0`, `d1`, `d2`) and fBm spatial phase warping (`warp`) so wavefronts expand as irregular asymmetric arcs rather than mathematical concentric circles, damping exponentially (`exp(-rippleAge * 0.24)`) toward stillness in `WATER_SETTLING`.

---

## 7. Responsive & Reduced-Motion Behavior

- **Responsive:** On portrait viewports (`aspect < 1.0`), `mobilePullback = max(0, 1 - aspect) * 2.55` and `mobileShiftX = max(0, 1 - aspect) * -0.22` frame both the protagonist tree trunk and the hero branch inside `390×844` and `412×915`. Mobile uses `maxDpr = 1.5`, `320×200` reflection target, and `63` mist points.
- **Reduced Motion (`prefers-reduced-motion: reduce`):** Preserves all states and visual composition while zeroing camera drift, pointer parallax, branch sway, leaf tumbling, and water splash (`contactImpulse` capped at static `0.16` subtle indicator).

---

## 8. Performance & Verification Measurements

Measured on production build (`vite preview`, headless Chromium with WebGL) across `validate-continuity-02-04.mjs`:

| Viewport | Beat | Median FPS | p95 Frame (ms) | Worst Frame (ms) | Draw Calls (main pass) | Canvases | Overflow X | CLS | Console / Page Errors |
|---|---|---:|---:|---:|---:|---:|---|---|---:|
| `1440×900` | `scene02` (`ACT_02_FOREST`) | `59.9` | `16.9` | `17.2` | `7` | `1` | `false` | `0.0073` | `0` |
| `1440×900` | `scene03` (`ACT_03_LEAF`) | `59.9` | `17.1` | `17.8` | `7` | `1` | `false` | `0.0128` | `0` |
| `1440×900` | `scene04` (`ACT_04_WATER`) | `59.9` | `17.0` | `17.0` | `7` | `1` | `false` | `0.0128` | `0` |
| `1440×900` | `scene01Check` (`ACT_06_ACOUSTIC_FIELD`) | `59.9` | `17.1` | `17.1` | `9` | `1` | `false` | `—` | `0` |
| `1920×1080` | `scene02` / `scene03` / `scene04` | `59.9` | `17.0`–`17.1` | `17.0`–`17.3` | `7` | `1` | `false` | `0.0046`–`0.0081` | `0` |
| `390×844` (`mobile`) | `scene02` / `scene03` / `scene04` | `59.9` | `17.0` | `17.1`–`17.3` | `7` | `1` | `false` | `0`–`0.0079` | `0` |
| `412×915` (`mobile`) | `scene02` / `scene03` / `scene04` | `59.9` | `17.0`–`17.1` | `17.1`–`17.2` | `7` | `1` | `false` | `0`–`0.0067` | `0` |

- **Memory (`performance.memory`):** `8.0`–`13.6 MB` used JS heap (`16.4`–`19.5 MB` total JS heap) across Scenes 02–04; `20.3 MB` used (`35.9 MB` total) in Scene 01.
- **Unit Tests & Build:** `npm test` passed (`6` test files, `25` tests passing); `npm run build` passed (`tsc -b && vite build`).

---

## 9. Known Visual Limitations

- `HeroTreePlate` and `MidUnderstoryPlate` remain 2.5D illustrated planes rather than full volumetric 3D branch meshes; under extreme pointer parallax angles, tree thickness does not shift perspectivally beyond plane parallax.
- On `ACT_04_WATER` when viewed at `~18°` grazing angle, the floating leaf (`rotX = -1.36`) remains relatively compact in vertical screen height (`~5%` of viewport height) to preserve physical scale relative to the `~11 cm` leaf and trunk.
