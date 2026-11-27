# ECOsonic 3.0 — Overnight Cinematic Build (ACT 02 → ACT 06)

**Scope:** Unified single-WebGL-canvas opening cinematic sequence spanning **ACT 01 BLACKNESS → ACT 02 FOREST → ACT 03 LEAF → ACT 04 WATER → ACT 05 SOUND → ACT 06 ACOUSTIC FIELD**. No ACT 07+ scenes implemented.

---

## 1. Shared Rendering Architecture & Scene State

- **Single WebGL System & Loop:** Implemented in [`src/visual/Cinematic/CinematicStage.tsx`](../src/visual/Cinematic/CinematicStage.tsx) on top of [`WebGLStage`](../src/visual/engine/WebGLStage.ts). Across all transitions (`BLACKNESS -> FOREST -> LEAF -> WATER -> SOUND -> ACOUSTIC FIELD`), Chromium maintains **exactly 1 `<canvas>` and 1 WebGL context** (`canvases: 1`, `canvasesDuringSequence: 1`, `canvasesAfterHandoff: 1`).
- **Explicit State Machine:** [`src/visual/Cinematic/cinematicSequence.ts`](../src/visual/Cinematic/cinematicSequence.ts) models `ACT_01_BLACKNESS`, `ACT_02_FOREST`, `ACT_03_LEAF`, `ACT_04_WATER`, `ACT_05_SOUND`, and `ACT_06_ACOUSTIC_FIELD`, synchronized with [`src/domain/storyboard.ts`](../src/domain/storyboard.ts), [`src/App.tsx`](../src/App.tsx), and [`src/ui/EditorialShell.tsx`](../src/ui/EditorialShell.tsx).

---

## 2. Scene Breakdown

### ACT 02 — FOREST
- **Selected Asset:** [`src/assets/forest/hoh-old-growth.webp`](../src/assets/forest/hoh-old-growth.webp) (`2048 × 1365`, `1,141,580` bytes WebP, converted locally from `Hall Of Mosses (213654479).jpeg`, CC BY 3.0, Brandon Kuschel) + smoothed parallax map [`hoh-old-growth-depth.webp`](../src/assets/forest/hoh-old-growth-depth.webp) (`512 × 341`, `1,642` bytes). Zero runtime hotlinking; provenance logged in [`docs/ASSET_LICENSES.md`](./ASSET_LICENSES.md).
- **Visual Strategy & Implementation:** [`forestShaders.ts`](../src/visual/Forest/forestShaders.ts) applies aspect-preserving `computeCoverUv` framing (grounding foreground sword ferns on desktop and framing central mossy arches on mobile), smooth Gaussian depth-map 2.5D parallax (`0` hard cutout seams), staged darkness-to-forest emergence, restrained fBm coastal humidity drift, Poisson-disc optical defocus during ACT 03 rack focus, and top header scrim legibility.
- **Measured Performance:** Desktop `1440×900` (`144.9` FPS median, `70.9` min, `7.2 ms` p95), Desktop `1920×1080` (`144.9` FPS median, `131.6` min, `7.4 ms` p95), Mobile `390×844` (`144.9` FPS median, `129.9` min, `7.3 ms` p95), Mobile `412×915` (`144.9` FPS median, `122.0` min, `7.3 ms` p95); `0` errors.

### ACT 03 — LEAF
- **Selected Asset:** [`src/assets/leaf/hero-leaf-albedo.webp`](../src/assets/leaf/hero-leaf-albedo.webp) (`896 × 1280` RGBA, `206,098` bytes) + Sobel tangent normal map [`hero-leaf-normal.webp`](../src/assets/leaf/hero-leaf-normal.webp) (`288,166` bytes), prepared from `Herbarium. Alnus glutinosa. img-002.jpg` (CC BY-SA 4.0, Dmitry Makeev).
- **Physical Animation & Transition:** [`leafState.ts`](../src/visual/Leaf/leafState.ts) and [`leafShaders.ts`](../src/visual/Leaf/leafShaders.ts) render a subdivided 3D leaf mesh (`PlaneGeometry(0.46, 0.66, 28, 36)`) sculpted with lengthwise midrib camber, dihedral gutter, aerodynamic tip flutter, dark olive/umber grading preserving a pale ochre midrib, wet cuticle Fresnel sheen, and a jagged ~6 mm torn V-notch. Transitions smoothly from bough attachment tremor → petiole release → coupled fluttering camera approach while the forest background enters soft optical bokeh.
- **Measured Performance:** `142.9` FPS median / `7.4 ms` p95 (`1440×900`); `142.9` FPS median / `7.1 ms` p95 (`390×844`).

### ACT 04 — WATER
- **Strategy & Ripple Implementation:** [`waterState.ts`](../src/visual/Water/waterState.ts) and [`waterShaders.ts`](../src/visual/Water/waterShaders.ts) render shallow tannin-stained near-black woodland rainwater (`#040605` / `#0D0B07` over subtle wet basalt relief) reflecting the actual Hoh canopy photograph inverted across dynamic surface normals. As the sculpted leaf makes surface contact and floats above meniscus tension, dispersive capillary wave packets radiate and damp naturally via perturbed reflection normals without synthetic neon rings.
- **Measured Performance:** `144.9` FPS median / `7.2 ms` p95 (`1440×900`); `144.9` FPS median / `7.1 ms` p95 (`390×844`).

### ACT 05 — SOUND
- **Causal Translation & Audio Hook:** As `uHarmonicBridge` rises across ACT 05, dispersive water waves take on standing acoustic cadence while [`acousticFieldEngine.ts`](../src/visual/AcousticField/acousticFieldEngine.ts) and [`acousticFieldShaders.ts`](../src/visual/AcousticField/acousticFieldShaders.ts) interpolate ACT 06's Fibonacci particle shell (`uFieldMorph`: `0 -> 1`) directly upward out of horizontal concentric water wave rings (`y = -0.56`) into 3D spherical harmonic shells, colored continuously by `acousticStore.liveAudio.bands` (sub-biotic indigo, mid-biotic moss, avian-high ochre, atmospheric slate-blue) under an automated choreographed camera arc.
- **Measured Performance:** `144.9` FPS median / `7.3 ms` p95 (`1440×900`); `144.9` FPS median / `7.1 ms` p95 (`390×844`).

### ACT 06 — ACOUSTIC FIELD Handoff
- **Handoff Fidelity:** At `uFieldMorph = 1.0`, `uFieldOpacity = 1.0`, forest/leaf/water layers hide cleanly (`visible = false`), and the exact accepted Scene 01 `AcousticField` core, orbital strata, pointer spatial interaction, `AcousticFieldOverlay`, and WebSocket/Audio telemetry retain full control with `0` visual discontinuity and `1` canvas context.
- **Measured Performance:** `144.9` FPS median / `7.5 ms` p95 (`1440×900`); `142.9` FPS median / `7.1 ms` p95 (`390×844`).

---

## 3. OriginKit Component Audit

### Reused / Adapted Primitives
1. **`hero-38 / particle-simulation`** (`components/originkit/ui/hero-38/particle-simulation.tsx`)
   - **COMPONENT:** Interactive cursor-reactive GPU FBO particle simulation driven by an external Unsplash portrait.
   - **ECOsonic USE:** Extracted velocity-damped ambient point-sprite drift concept for sparse 3D atmospheric moisture motes.
   - **SCENE:** ACT 02 — FOREST atmospheric layer (`FOREST_MIST_*_SHADER`).
   - **MODIFICATION:** Rewritten cleanly inside shared `WebGLStage` shaders with `140` (mobile) / `420` (desktop) soft translucent mist particles; removed Unsplash FBO portrait pipeline and `canvas` 2D-build harness.
   - **REJECTION:** Never used for generating trees, bark, foliage, or portrait billboards.
2. **`mask-group`** (`components/originkit/ui/hero-19/mask-group.tsx`)
   - **COMPONENT:** SVG glow ellipse and blurred trapezoid wash paired beneath a sphere hero.
   - **ECOsonic USE:** Conceptual soft radial vignette & focal spotlight masking (`uLeafAttention`, `titleScrim`, optical DoF framing).
   - **SCENE:** ACT 02 → ACT 03 transition & vignette lighting.
   - **MODIFICATION:** Re-implemented directly in GLSL fragment attenuation using organic depth-weighted attenuation over photographic textures.
   - **REJECTION:** Rejected warm orange Figma neon SVG ellipses (`#ED3D11`, `#F06B49`) and DOM blur nodes.
3. **`backdrop`** (`components/originkit/ui/hero-19/backdrop.tsx`)
   - **COMPONENT:** Stacked viewport-breakpoint PNG light-rig and grain image cutouts using `mix-blend-screen`.
   - **ECOsonic USE:** Subdued top-to-bottom environmental vignette depth & darkroom grain separation framing editorial headings (`headerScrim`, `titleScrim`).
   - **SCENE:** ACT 02–ACT 04 atmospheric framing (`forestShaders.ts` & `EditorialShell.tsx`).
   - **MODIFICATION:** Consolidated into lightweight shader vignettes and CSS gradients aligned dynamically to canvas aspect.
   - **REJECTION:** Rejected pre-baked Figma PNG exports (`arcs-desktop.png`, `bg-shapes-desktop.png`) and multi-image DOM stacks.
4. **`orb`** (`components/originkit/ui/hero-19/orb.tsx`)
   - **COMPONENT:** Layered glowing orange sphere with pointer-tracked CSS `radial-gradient` hole mask.
   - **ECOsonic USE:** Optical Fresnel grazing specular and radial wave interference thinking adapted strictly to flat dark tannin water optics.
   - **SCENE:** ACT 04 — WATER surface shading (`waterShaders.ts`).
   - **MODIFICATION:** Replaced luminous CSS/SVG core with Schlick dielectric water Fresnel (`F0 = 0.022`, IOR `1.333`) bending the real canopy texture across capillary wave slopes.
   - **REJECTION:** Rejected glowing sphere mesh, orange glow halo, and cursor hole cutout UI.
5. **`particle-sphere`** (`components/originkit/ui/hero-19/particle-sphere.tsx`)
   - **COMPONENT:** Three.js `Points` spherical lattice with cursor scatter and CSS color token resolution.
   - **ECOsonic USE:** Causal planar-to-spherical lattice folding (`uFieldMorph`) feeding directly into accepted ACT 06 Fibonacci shell geometry.
   - **SCENE:** ACT 05 — SOUND → ACT 06 — ACOUSTIC FIELD transition (`acousticFieldEngine.ts`, `acousticFieldShaders.ts`).
   - **MODIFICATION:** Absorbed seamlessly into the existing ACT 06 particle system (zero duplicate particle clouds), driven by horizontal water wave coordinates rising into frequency strata.
   - **REJECTION:** Rejected standalone component wrapper, duplicate `WebGLRenderer`, and solid white/orange glow core.
6. **`orbit-controls`** (`components/originkit/ui/features-02/orbit-controls.tsx`)
   - **COMPONENT:** Responsive dashed concentric CSS orbital rings with conic comet trails.
   - **ECOsonic USE:** Choreographed orbital camera arc gliding upward across ACT 05 → ACT 06 alongside 3D inclined frequency strata paths.
   - **SCENE:** ACT 05 camera lift & ACT 06 `ORBIT_STRATA` geometry.
   - **MODIFICATION:** Implemented purely cinematographically in camera spline motion and GLSL 3D `LineLoop` frequency strata (no interactive OrbitControls gizmos or CSS ring overlays).
   - **REJECTION:** Rejected CSS dashed rings and generic interactive orbit-control widgets.

### Preserved / Deferred & Explicitly Rejected Components
- **`globe`** (`features-02/globe.tsx`): Preserved untouched for future **ACT 10 — ECOLOGICAL CONTEXT** (deferred outside tonight's scope).
- **`logo-marquee`** (`hero-19/logo-marquee.tsx`): **REJECTED** — SaaS social-proof marquee breaks documentary realism.
- **`recommendation-card`** (`hero-19/recommendation-card.tsx`): **REJECTED** — consumer lifestyle UI card breaks documentary scientific immersion.

---

## 4. Verification Summary

- **Vitest (`npm test`):** `6` test files passed, `21/21` tests passed.
- **TypeScript + Vite Production Build (`npm run build`):** Succeeded cleanly (`56` modules, `0` errors).
- **Playwright Chrome Validation (`node scripts/validate-cinematic.mjs`):** `0` console/page errors across `1440×900`, `1920×1080`, `390×844`, `412×915`, `prefers-reduced-motion: reduce`, and live end-to-end `?sequence=1` playback recorded to `docs/screenshots/cinematic-sequence.webm`.
