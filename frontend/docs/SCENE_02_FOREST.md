# ECOsonic 3.0 — ACT 02: FOREST (`THE LIVING FIELD`)

**Status:** Implemented & verified (photorealistic correction complete; frozen Scene 01 untouched; ACT 03+ deferred).  
**Visual Direction:** `DOCUMENTARY × ORGANIC × SCIENTIFIC × CINEMATIC` — temperate coastal old-growth temperate rainforest at `16:15` overcast light.

---

## 1. Photorealistic Asset Foundation

Procedural stylized tree trunks and synthetic vegetation were replaced with a locally bundled real-world photograph of a temperate coastal old-growth forest (Hall of Mosses, Hoh Rain Forest, Olympic National Park, Washington):

- **Primary Texture:** [`src/assets/forest/hoh-old-growth.webp`](../src/assets/forest/hoh-old-growth.webp) (`2048 × 1365`, `1,141,580` bytes WebP, converted locally from Wikimedia Commons `File:Hall Of Mosses (213654479).jpeg`, CC BY 3.0 — Brandon Kuschel).
- **Depth Parallax Field:** [`src/assets/forest/hoh-old-growth-depth.webp`](../src/assets/forest/hoh-old-growth-depth.webp) (`512 × 341`, `1,642` bytes smoothed grayscale WebP derived locally with heavy Gaussian blur so 2.5D parallax has zero hard cutout halos).
- **Provenance & Candidate Evaluation:** Full evaluation of 10 Wikimedia Commons candidates and attribution terms are recorded in [`docs/ASSET_LICENSES.md`](./ASSET_LICENSES.md). Zero external URLs are hotlinked at runtime.

---

## 2. WebGL Stage & Shader Architecture

ACT 02 runs inside the shared single-canvas `WebGLStage` architecture ([`src/visual/engine/WebGLStage.ts`](../src/visual/engine/WebGLStage.ts)) via:

- [`src/visual/Forest/ForestScene.tsx`](../src/visual/Forest/ForestScene.tsx)
- [`src/visual/Forest/forestShaders.ts`](../src/visual/Forest/forestShaders.ts)
- [`src/visual/Forest/forestState.ts`](../src/visual/Forest/forestState.ts)
- [`src/visual/Forest/forestTransition.ts`](../src/visual/Forest/forestTransition.ts)

### Rendering Pipeline
1. **Aspect-Preserving Framing (`computeCoverUv`):** Renders `hoh-old-growth.webp` on a frustum-sized plane (`PHOTO_OVERSCAN = 1.12`) without stretching or black bars on widescreen desktop (`1440×900`, `1920×1080`) or portrait mobile (`390×844`, `412×915`), biasing downward (`-0.085` Y) on desktop so sword ferns (*Polystichum munitum*) and mossy root flares ground the lower frame, and framing the central mossy maple arch on mobile.
2. **Smooth 2.5D Depth Parallax & Camera Breath:** Samples smoothed `uDepthTex` to displace foreground ferns/trunks (`depthFactor` up to `1.0`) differently from distant overcast clearing (`0.28`) in response to subtle non-repeating irrational-frequency camera drift (`stepForestState`) and damped pointer movement.
3. **16:15 Late-Autumn Grading & Staged Emergence:** Softly compresses bright sky highlights toward overcast slate, retains natural bark/moss shadow detail over a wet charcoal baseline, drifts restrained fBm coastal mist across recessed midground openings, and fades cleanly from ACT 01 `#050706` blackness (`uEmergence`: recessed clearing → midground moss & trunks → foreground ferns).
4. **3D Moisture Motes (`ForestMoistureMotes`):** Renders `420` desktop / `140` mobile soft drifting atmospheric droplets in 3D space ahead of the plane (`drawCalls: 2`, `triangles: 2`).
5. **Accessibility & Continuity:** Honours `prefers-reduced-motion: reduce` (`emergence = 1` immediately, zero camera drift/parallax), reads `acousticStore.liveAudio.bands` subtly without mutating Scene 01/backend contracts, and exposes `window.__ECOSONIC_FOREST_TRANSITION__` (`ForestAct03TransitionHandle`) anchored to the natural autumn bigleaf maple leaf cluster (`uLeafFocusUv`) for future ACT 03 transition continuity.

---

## 3. Verified Validation Results

Executed after the final shader edit (`npm test`, `tsc -b && vite build`, `node scripts/validate-scene02.mjs`):

- **Vitest Suite (`npm test`):** `5` test files passed, `16/16` tests passed (`acousticFieldState`, `acousticStoreAndStoryboard`, `ecosonicProtocol`, `AcousticField`, `forestScene`).
- **TypeScript + Vite Production Build (`npm run build`):** `tsc -b && vite build` succeeded cleanly (dist assets include bundled `hoh-old-growth-*.webp`, `0` errors).
- **Playwright Real-Browser Validation (`validate-scene02.mjs`):**
  - `1440×900` (Desktop): `0` errors, `1` WebGL canvas, `overflowX: false`, `drawCalls: 2`, `triangles: 2`, `points: 420`, `dpr: 1`, `medianFps: 144.9` (`minFps: 119`), `p95FrameTimeMs: 7.2`, clean switching `02 FOREST ↔ 06 FIELD`.
  - `1920×1080` (Desktop): `0` errors, `1` WebGL canvas, `overflowX: false`, `medianFps: 144.9` (`minFps: 126.6`), `p95FrameTimeMs: 7.3`.
  - `390×844` (Mobile): `0` errors, `1` WebGL canvas, `overflowX: false`, `points: 140`, `dpr: 1.5`, `medianFps: 144.9` (`minFps: 128.2`), `p95FrameTimeMs: 7.2`.
  - `412×915` (Mobile): `0` errors, `1` WebGL canvas, `overflowX: false`, `points: 140`, `dpr: 1.5`, `medianFps: 144.9` (`minFps: 72.5`), `p95FrameTimeMs: 7.2`.
  - `prefers-reduced-motion: reduce`: `reducedMotionMatches: true`, `canvases: 1`, `144 FPS`.
---

## Forest Asset Revision

- **Previous Asset:** [`src/assets/forest/hoh-old-growth.webp`](../src/assets/forest/hoh-old-growth.webp) (`2048 × 1365`, Brandon Kuschel, CC BY 3.0; retained solely as the untouched `waterUniforms.uForestTex` canopy reflection map for ACT 04).
- **Reason for Rejection (ACT 02/03 Continuity):** Although atmospheric, its mossy conifer/maple limbs consisted mostly of fine vertical twigs and distant foliage without large, clearly legible foreground broadleaves, causing the ~11 cm hero leaf in ACT 03 to read as an overlay rather than originating inside existing branch foliage.
- **New Asset:** [`src/assets/forest/coastal-broadleaf-forest.webp`](../src/assets/forest/coastal-broadleaf-forest.webp) + depth map [`src/assets/forest/coastal-broadleaf-forest-depth.webp`](../src/assets/forest/coastal-broadleaf-forest-depth.webp).
- **Source & License:** `File:Beech and ferns in Gullmarsskogen.jpg` by `W.carter` (Wikimedia Commons), **CC0 1.0 Universal (Public Domain Dedication)**.
- **Resolution & Size:** `5472 × 3648` original (`19,350,949` bytes) → `2048 × 1365` optimized WebP (`973,830` bytes) + `512 × 341` depth field (`1,972` bytes).
- **Visual Rationale:** Provides an overarching foreground woody branch lined with large, clearly readable herringbone-veined oval leaves matching the geometric silhouette of the hero leaf, backed by dense understory ferns and mature dark trunks receding into depth. [`forestShaders.ts`](../src/visual/Forest/forestShaders.ts) grades raw greens toward cool damp coastal forest olive/moss and charcoal-umber shadows, while `computeCoverUv` centers the branch node across both desktop widescreen (`1440×900`, `1920×1080`) and portrait mobile (`390×844`, `412×915`) viewports.

---

## Hero Leaf Physics Revision

Implemented deterministic fixed-timestep (`1/90 s` substep) aerodynamic integration in [`src/visual/Leaf/leafState.ts`](../src/visual/Leaf/leafState.ts), coupled with branch camouflage shading (`uCamouflage`) in [`src/visual/Leaf/leafShaders.ts`](../src/visual/Leaf/leafShaders.ts) and responsive frustum-aligned twig anchoring (`computeBranchLeafAnchor`) in [`src/visual/Cinematic/CinematicStage.tsx`](../src/visual/Cinematic/CinematicStage.tsx):

- **Position Model:** Starts pinned via petiole tip at world anchor projected from photo UV `(0.608, 0.506)` (`z = 0.12`, natural branch leaf scale `PlaneGeometry(0.32, 0.46)`), matching adjacent leaves across desktop and mobile aspects. Advances purely through 3D perspective depth (`z: 0.12 → ~3.18 → 1.85`) without artificial 2D scale tricks.
- **Velocity & Gravity:** Downward gravity acceleration (`-0.34`) starts gently after detachment against progressive upward air cushion and vertical buoyancy restoration.
- **Damping & Air Resistance:** Broadside orientation `broadside = |cos(0.75 * rotX) * cos(0.65 * rotZ)|` modulates instantaneous `airResistance` (`0.38..0.98`), capping terminal downward speed (`clamp(vy, -0.46, 0.16)`) and damping angular speeds smoothly.
- **Lateral Drift:** Multi-octave smooth deterministic horizontal airflow (`gustX` at `0.94, 1.52, 2.47 rad/s`) plus lamina tilt bank-glide (`-sin(rotZ) * 0.24 * broadside`) creates continuous S-curve sideways sweeps and updraft stalls (zero frame-by-frame random jitter).
- **Angular Velocity & Flutter Model:** Integrates bounded angular velocities (`angVelX, angVelY, angVelZ`) under restoring dihedral torque + deterministic cross-flow torques and aerodynamic damping—turning smoothly toward camera, edge-on, partially revealing underside, and gliding back without mechanical coin-spinning—paired with high-along-blade vertex camber wind flex (`flutterFlex`).
- **Phase Transitions:**
  1. `detachment` (`0.00 → 0.16`): Remains nestled on the branch with cool sage-olive camouflage (`uCamouflage = 1`), subtle breeze tremor (`audioBreezeBoost`-coupled when signal exists), and petiole tension tilt before release at `0.16`.
  2. `drop` (`0.16 → 0.28`): Gentle initial gravity acceleration and slight lateral slip.
  3. `float` (`0.28 → 0.62`): Longest gliding descent with S-curve lateral drift, air-pocket cushions, and slow attitude roll.
  4. `approach` (`0.62 → 0.86`): Perspective `z` draws the leaf crisply into macro focus centered above lower typography while forest background softens via `uBackdropDefocus`.
  5. `water_approach` (`0.86 → 1.00`) → `moored` (`ACT 04`): Gently lowers toward `-0.26` and pitches gradually toward near-horizontal attitude before untouched ACT 04 water contact at `y = -0.505`.

---

## Verified Final Validation (`ACT 02 / ACT 03` Precision Correction)

Run after the final edit (`npm test`, `npm run build` with `VITE_ECOSONIC_API_URL=http://127.0.0.1:8000`, `node scripts/validate-act02-03.mjs`):
- **Vitest:** `6` files passed, `24/24` tests passed.
- **TypeScript + Vite Build:** `tsc -b && vite build` clean (`61` modules, `0` errors).
- **Desktop `1440×900`:** `0` errors, `1` canvas, `overflowX: false`, Forest `142.9` median FPS (`7.1 ms` p95), Leaf `144.9` median FPS (`7.2 ms` p95).
- **Desktop `1920×1080`:** `0` errors, `1` canvas, `overflowX: false`, Forest `142.9` median FPS (`7.1 ms` p95), Leaf `144.9` median FPS (`7.2 ms` p95).
- **Mobile `390×844`:** `0` errors, `1` canvas, `overflowX: false`, Forest `144.9` median FPS (`7.2 ms` p95), Leaf `144.9` median FPS (`7.2 ms` p95).
- **Mobile `412×915`:** `0` errors, `1` canvas, `overflowX: false`, Forest `142.9` median FPS (`7.1 ms` p95), Leaf `144.9` median FPS (`7.1 ms` p95).
- **Reduced Motion & Continuity:** `reducedMotion: true` settled cleanly at `144 FPS`, `0` errors; continuous playback stepped `ACT_02_FOREST → ACT_03_LEAF → ACT_04_WATER` with `1` canvas and `0` errors.

