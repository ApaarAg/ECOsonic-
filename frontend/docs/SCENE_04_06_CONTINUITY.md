# ECOsonic 3.0 — ACT 04 → ACT 06: Continuity & Water Realism

**Scope:** ACT 04 (`WATER`) → ACT 05 (`SOUND`) → ACT 06 (`ACOUSTIC FIELD`) inside the unified single-`WebGLStage` architecture.  
**Visual Grammar:** `DOCUMENTARY × ORGANIC × SCIENTIFIC × PREMIUM` — one continuous physical event (`leaf descent → water contact → asymmetric ripple → surface vibration → stratified acoustic wave → spatial Acoustic Field`).

---

## 1. Water Realism Strategy & Asset Selection

ACT 04 uses a hybrid photographic-and-physical surface pipeline rather than synthetic pool water:

- **Submerged Pool Bed:** [`src/assets/water/forest-pool-bed.webp`](../src/assets/water/forest-pool-bed.webp) (`1600 × 1132` WebP, `363,442` bytes), sourced locally from `File:Berdorf (LU), Aesbachtal -- 2015 -- 6356.jpg` (`Dietmar Rabich`, `CC BY-SA 4.0`; see [`docs/ASSET_LICENSES.md`](./ASSET_LICENSES.md)).
- **Canopy Reflection Map:** Reuses [`src/assets/forest/hoh-old-growth.webp`](../src/assets/forest/hoh-old-growth.webp) (`uForestTex`) inverted gently across the water surface so reflected trunks and dark canopy light shift with slope and viewing angle.
- **Tannin Absorption & Restraint:** [`src/visual/Water/waterShaders.ts`](../src/visual/Water/waterShaders.ts) refracts `uPoolBedTex` beneath deep humic tannin-brown/near-black water absorption, wet basalt/moss edge shading, and zero neon or holographic artifacts.

---

## 2. Leaf Contact & Asymmetric Ripple Physics

Implemented deterministically across [`src/visual/Leaf/leafState.ts`](../src/visual/Leaf/leafState.ts), [`src/visual/Water/waterState.ts`](../src/visual/Water/waterState.ts), and [`src/visual/Water/waterShaders.ts`](../src/visual/Water/waterShaders.ts):

1. **Untouched ACT 03 Boundary:** Leaf mooring/contact logic is gated strictly behind `w > 0.001` so ACT 03 aerodynamic flight (`w === 0`) remains unchanged.
2. **Pre-Contact Stillness:** Before `contactThreshold = 0.22`, the pool reads calm with only subtle low-frequency environmental drift (`pass0406-water-calm-desktop-1440x900.png`).
3. **Real Surface Crossing & Settling:** When reaching contact, the leaf crosses `y = -0.56` with inertial downward dip (`-0.548 - impactDip`), slight rotational settle, and partial submergence (`uContactSplash` meniscus pulse), staying visible as the physical cause of the disturbance (`pass0406-water-contact-desktop-1440x900.png`).
4. **Deterministic Asymmetric Ripples:** [`waterShaders.ts`](../src/visual/Water/waterShaders.ts) computes `asymmetricRadius` (`cos(ang - 0.32)` leaf orientation anisotropy plus deterministic `fbm` bed warp) paired with viscous amplitude decay so wave fronts spread naturally, lose definition over distance, and dissipate cleanly (`pass0406-water-ripple-desktop-1440x900.png`).

---

## 3. Causal Transition: Water → Sound → Acoustic Field

Coordinated across [`src/visual/Cinematic/cinematicSequence.ts`](../src/visual/Cinematic/cinematicSequence.ts) (`ACT_04_WATER: 6.4` s, `ACT_05_SOUND: 6.6` s), [`src/visual/Cinematic/CinematicStage.tsx`](../src/visual/Cinematic/CinematicStage.tsx), [`src/visual/AcousticField/acousticFieldEngine.ts`](../src/visual/AcousticField/acousticFieldEngine.ts), and [`src/visual/AcousticField/acousticFieldShaders.ts`](../src/visual/AcousticField/acousticFieldShaders.ts):

- **`WaterSoundBridge` Uniforms (`uWaterRippleAge`, `uWaterImpulse`, `uImpactOrigin`) & `uHarmonicBridge`:** Couples active pool waves into particle/strata emergence only while `uFieldMorph < 0.999`, leaving steady-state ACT 06 (`uFieldMorph >= 0.999`) unchanged.
- **Stage Progression:**
  - **Phase A (`wave ripple`):** Field particles hug the outward ripple front near the settled leaf (`pass0406-sound-phaseA-ripple-desktop-1440x900.png`).
  - **Phase C (`frequency structure`):** Surface vibration lifts into stratified bands and `ORBIT_STRATA` around the emerging `CORE` (`pass0406-sound-phaseC-strata-desktop-1440x900.png`).
  - **Phase D/E (`spatial field`):** Water recedes behind the 3D Acoustic Field sphere (`pass0406-sound-phaseD-spatial-desktop-1440x900.png`), handing off cleanly into ACT 06 (`pass0406-act06-desktop-1440x900.png`) inside a single WebGL canvas and render loop.
- **Shared Audio Reactivity & Silent Settling:** Consumes `liveAudio` (`bands[0..3]`, `rms`, `spectralCentroid`, `temporalFlux`, `source`) from [`src/domain/acousticStore.ts`](../src/domain/acousticStore.ts) and [`src/api/ecosonicAudioCapture.ts`](../src/api/ecosonicAudioCapture.ts) (`AnalyserNode` `fftSize = 256`). Under `SILENCE`, `soundAudioGate` settles visual motion smoothly toward rest (`pass0406-act05-silence-1440x900.png`).

---

## 4. Verified Test, Build & Runtime Results

All verification commands below were executed cleanly against the final production bundle (`VITE_ECOSONIC_API_URL=http://127.0.0.1:8000` with live local backend on `127.0.0.1:8000`):

- **Vitest (`npm test`):** `6` test files passed, `24/24` tests passed (`acousticFieldState.test.ts`, `acousticStoreAndStoryboard.test.ts`, `ecosonicProtocol.test.ts`, `forestScene.test.tsx`, `cinematicSequence.test.tsx`, `AcousticField.test.tsx`).
- **TypeScript & Production Bundle (`npm run build`):** `tsc -b && vite build` passed (`62 modules transformed`, built in `2.88s`; includes `forest-pool-bed-CZgQYq-N.webp` `363.44 kB`, `coastal-broadleaf-forest-DlVhe9So.webp` `973.83 kB`, `hoh-old-growth-BJecg1oN.webp` `1,141.58 kB`).
- **Playwright Multi-Viewport & Reduced-Motion Suite (`node scripts/validate-acts04-06.mjs`):**
  - `desktop-1440x900`: `0` errors, `1` canvas, `overflowX: false`, `webpCount: 5`, `maxAssetLoadMs: 15`, `silentSoundCaptured: true`; ACT 04 `144.9` median FPS (`7.1 ms` p95), ACT 05 `142.9` median FPS (`7.2 ms` p95), ACT 06 `144.9` median FPS (`7.2 ms` p95).
  - `desktop-1920x1080`: `0` errors, `1` canvas, `overflowX: false`, `webpCount: 5`, `maxAssetLoadMs: 10.6`; ACT 04 `142.9` median FPS (`7.2 ms` p95), ACT 05 `144.9` median FPS (`7.5 ms` p95), ACT 06 `142.9` median FPS (`7.3 ms` p95).
  - `mobile-390x844`: `0` errors, `1` canvas, `overflowX: false`, `webpCount: 5`, `maxAssetLoadMs: 11`, `dpr: 1.5`; ACT 04 `144.9` median FPS (`7.1 ms` p95), ACT 05 `144.9` median FPS (`7.4 ms` p95), ACT 06 `144.9` median FPS (`7.1 ms` p95).
  - `mobile-412x915`: `0` errors, `1` canvas, `overflowX: false`, `webpCount: 5`, `maxAssetLoadMs: 13.1`, `dpr: 1.5`; ACT 04 `142.9` median FPS (`7.2 ms` p95), ACT 05 `144.9` median FPS (`7.2 ms` p95), ACT 06 `142.9` median FPS (`7.2 ms` p95).
  - **`prefers-reduced-motion: reduce`:** `reducedMotion: true`, `1` canvas, `144 FPS`, `errors: []` (`pass0406-act04-reduced-motion.png`, `pass0406-act05-reduced-motion.png`).
  - **Continuous Sequence Capture:** `observed: ["ACT_02_FOREST", "ACT_03_LEAF", "ACT_04_WATER", "ACT_05_SOUND", "ACT_06_ACOUSTIC_FIELD"]`, `seqCanvases: 1`, `errors: []`, saved at [`docs/screenshots/act02-to-06-continuity.webm`](./screenshots/act02-to-06-continuity.webm) (`10,568,122` bytes).
