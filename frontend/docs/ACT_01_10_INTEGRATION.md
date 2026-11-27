# ECOsonic 3.0 — ACT 01–10 Integration Architecture

**Scope:** Unified single-WebGL-canvas cinematic & scientific observation instrument spanning **ACT 01 (Blackness)** through **ACT 10 (Ecological Context)**.  
**Hard Boundary:** **ACT 11–16** (`EXPECTED SPECIES`, `OBSERVATION GAP`, `UNEXPECTED TAXA`, `GROUNDED INTERPRETATION`, `RETURN TO FOREST`, `OBSERVATORY`) remain unimplemented (`STORYBOARD_REGISTRY` keeps `implemented: index <= 9` in [`src/domain/storyboard.ts`](../src/domain/storyboard.ts)).

---

## 1. Scene State Machine (`ACT 01 → ACT 10`)

Controlled deterministically by [`src/visual/Cinematic/cinematicSequence.ts`](../src/visual/Cinematic/cinematicSequence.ts) inside [`src/visual/Cinematic/CinematicStage.tsx`](../src/visual/Cinematic/CinematicStage.tsx) on a single Three.js [`WebGLStage`](../src/visual/engine/WebGLStage.ts) (`1` `<canvas>`, `1` WebGL context):

| Act ID | UI Label | Duration (`SEQUENCE`) | Core Visual & Physical State |
|---|---|---|---|
| `ACT_01_BLACKNESS` | `ACT 01 · BLACKNESS` | `3.0s` | Obsidian silence followed by faint sound-coupled acoustic traces (`w.fieldOpacity` `0 → 0.30`) before first forest emergence (`sound reveals environment`). |
| `ACT_02_FOREST` | `02 FOREST` | `5.0s` | Staged emergence (`stageReveal`) of locally bundled coastal old-growth photograph (`coastal-broadleaf-forest.webp`) + 2.5D depth parallax + drifting coastal mist (`FOREST_MIST_*`); concealed hero leaf enters only on exit crossfade (`0.88 → 1.0`). |
| `ACT_03_LEAF` | `03 LEAF` | `7.4s` | Detached *Alnus glutinosa* leaf (`36×48` corrugated mesh, dual-sided adaxial/abaxial shading, backlit SSS, wet GGX sheen) driven by [`evaluateLeafCinematics`](../src/visual/Leaf/leafState.ts) through 5 deterministic phases (`detachment → drop → float → approach → water_approach`). |
| `ACT_04_WATER` | `04 WATER` | `6.4s` | Shallow tannin forest pool refracting [`forest-pool-bed.webp`](../src/assets/water/forest-pool-bed.webp) beneath canopy reflection; calm stillness until `contactThreshold = 0.22`, inertial cross (`y = -0.56` with `impactDip`), meniscus buoyancy mooring, and deterministic `asymmetricRadius` capillary waves. |
| `ACT_05_SOUND` | `05 SOUND` | `6.6s` | Causal `WaterSoundBridge` (`uWaterRippleAge`, `uWaterImpulse`, `uImpactOrigin`, `uHarmonicBridge`) lifting water wavefronts through Phase A–E into frequency-stratified bands and the 3D field sphere driven by shared `liveAudio`. |
| `ACT_06_ACOUSTIC_FIELD` | `06 FIELD` | `4.2s` (holds in manual mode) | Authoritative accepted [`AcousticField`](../src/visual/AcousticField/acousticFieldEngine.ts) instrument (`9,000` desktop / `3,000` mobile particles, `ORBIT_STRATA`, obsidian `CORE`, pointer drag/parallax, full microphone/WS/BirdNET loop). |
| `ACT_07_SPECIES` | `07 SPECIES` | `6.0s` | `speciesEmphasis` (`0 → 1`) isolates spherical-harmonic BirdNET trace ring (`ProjectedSpatialTrace`), SVG hairline pointer, species common/scientific name, confidence %, frequency (`Hz`), azimuth degrees, and `UTC` observation timestamp. |
| `ACT_08_DISTURBANCE` | `08 DISTURB` | `6.0s` | `disturbanceEmphasis` deforms field strata and shifts localized orbital trace toward oxidized ochre (`#C86D3B`) with non-causal observational phrasing and temporal co-occurrence delta when applicable. |
| `ACT_09_SILENCE` | `09 STILL` | `6.0s` | Progressive `silenceOverride` (`0.02 → 0.82`) paired with `fieldOpacity` attenuation (`1.0 → 0.26`), damped particle motion/size, and faded orbital traces—communicating quietness visually rather than via text alone. |
| `ACT_10_ECOLOGICAL_CONTEXT` | `10 CONTEXT` | Holds | [`createEcologicalGlobeLayer`](../src/visual/Globe/ecologicalGlobe.ts) resolves offline Natural Earth landmasses + generalized site beacon (`latitude`/`longitude` only when backend supplies real coordinates) alongside live `/api/v1/ecology/observation-gap` ledger. |

---

## 2. Transition Architecture

All inter-act transitions share camera vectors, uniforms, and layer visibility inside `WebGLStage`:
- **01 → 02:** `ACT_01_BLACKNESS` emits subtle particle/stratum traces (`fieldOpacity` peak `0.30`) before `forestOpacity` and `forestEmergence` lift mist and canopy trunks out of `#050706`.
- **02 → 03:** Camera glides toward branch focus (`uLeafAttention`, `uBackdropDefocus`) while hero leaf material un-blends from `uCamouflage = 1` branch-sage lighting into free aerodynamic glide.
- **03 → 04:** Camera pitches downward (`camTarget.y → -0.44`) as forest backdrop softens and `waterOpacity` rises cleanly underneath the descending leaf (`w > 0.001` in `leafState.ts`).
- **04 → 05 → 06:** `uFieldMorph` (`0.06 → 1.0`) lifts particles continuously from `-0.56` pool ripples into frequency bands (`uBands`), orbital rings, and camera orbit handoff onto `isFieldControl = true` (`ACT 06`).
- **06 → 07 → 08 → 09 → 10:** Camera remains unified inside the Acoustic Field frame while `speciesEmphasis`, `disturbanceEmphasis`, `silenceOverride`, and `globeOpacity` cross-fade smoothly; particle haze settles softly (`fieldOpacity: 0.26 → 0.12`) behind the Act 10 globe.

---

## 3. Assets, Audio Flow & Backend Contracts

- **Offline Bundled Visual Assets (Zero Hotlinking, see [`ASSET_LICENSES.md`](./ASSET_LICENSES.md)):**
  - `src/assets/forest/coastal-broadleaf-forest.webp` & `-depth.webp` (CC BY 4.0) — ACT 02/03 forest environment.
  - `src/assets/forest/hoh-old-growth.webp` & `-depth.webp` (CC BY-SA 4.0) — Canopy reflection map for ACT 04 water.
  - `src/assets/leaf/hero-leaf-albedo.webp` & `hero-leaf-normal.webp` (CC BY-SA 4.0, *Alnus glutinosa*) — ACT 03 3D sculpted leaf.
  - `src/assets/water/forest-pool-bed.webp` (CC BY-SA 4.0, `1600×1132`, `363,442` bytes) — ACT 04 shallow pool bed.
  - `src/assets/geo/world-land.json` (Natural Earth 110m Physical Land, Public Domain, `3,455` dots / `127` coastline outlines) — ACT 10 globe.
- **Audio Capture & Domain Store ([`src/api/ecosonicAudioCapture.ts`](../src/api/ecosonicAudioCapture.ts), [`src/domain/acousticStore.ts`](../src/domain/acousticStore.ts)):**
  - Captures real microphone input via `AudioWorklet` + `AnalyserNode` (`32,000 Hz`, mono, `Int16` PCM16 framing with `>I` seq header), pushing `rms`, `peak`, `bands[0..3]`, `spectralCentroid`, and `temporalFlux` directly to mutable `acousticStore.liveAudio` with zero per-frame React re-renders.
  - Shared `liveAudio` drives ACT 01 pre-forest acoustic whispers, ACT 02 atmospheric modulation, ACT 03 breeze gust boost, ACT 04/05 harmonic wave coupling, and ACT 06–09 field dynamics.
- **Backend WebSocket & Ecology REST Integration ([`src/api/ecosonicSocket.ts`](../src/api/ecosonicSocket.ts), [`src/api/ecosonicEcologyApi.ts`](../src/api/ecosonicEcologyApi.ts)):**
  - `POST /api/v1/live/sessions` → `WS /api/v1/live/sessions/{sessionId}/stream` receives real BirdNET `detection`, `disturbance_event` / `disturbance_detected`, `soundscape_measurement`, and `processing_update` messages.
  - `POST /api/v1/ecology/observation-gap` fetches authoritative geospatial context, `expected_species_count`, `expected_and_detected`, `expected_but_not_detected` (`evidence_status: "insufficient_evidence_for_absence"`), and grounded `EcologicalInterpretation` (`gemini` or `deterministic_rule_engine`).
- **Live / Demo Separation:**
  - `+ TRACE` and `+ DISTURBANCE` UI controls render strictly when `snapshot.session.connection !== "live"`.
  - LIVE sessions without bio-detections honestly display `LISTENING FOR AVIAN VOCAL SIGNATURES` (ACT 07), `MONITORING FOR NON-BIOLOGICAL SOUND SIGNATURES` (ACT 08), and `BACKEND CONTEXT UNAVAILABLE` / `UNSPECIFIED IN SESSION` when backend ecology data is unavailable.

---

## 4. OriginKit Component Accounting

Documented in full in [`docs/ORIGIN_KIT_ADAPTATIONS.md`](./ORIGIN_KIT_ADAPTATIONS.md): adapted primitives include `particle-sphere` (`ACT 05–09` GPU shaders), `orbit-controls` (3D `ORBIT_STRATA` & camera choreography), `particle-simulation` (`ACT 02` atmospheric mist), `orb` (Schlick Fresnel water surface), `mask-group`/`backdrop` (shader vignette scrims), and `globe` (bundled Natural Earth 3D landmasses for `ACT 10`). All SaaS templates, marketing copy, Figma PNG stacks, and runtime external fetches remain excluded.

---

## 5. Performance, Accessibility & Verification

- **Unit & Component Tests (`npm test`):** `6/6` test files passed, `24/24` tests passed (`acousticFieldState.test.ts`, `acousticStoreAndStoryboard.test.ts`, `ecosonicProtocol.test.ts`, `forestScene.test.tsx`, `cinematicSequence.test.tsx`, `AcousticField.test.tsx`).
- **Production Build (`npm run build` with `VITE_ECOSONIC_API_URL=http://127.0.0.1:8000`):** `tsc -b && vite build` passed (`62` modules transformed in `3.13s`).
- **Playwright Multi-Viewport & Full Sequence Suite ([`scripts/validate-acts01-10.mjs`](../scripts/validate-acts01-10.mjs)):** `0` console/page errors across all 4 viewports, `0` WebGL context losses, `overflowX: false`, `1` `<canvas>` across all acts (`act01`–`act10`), `demoOverlaysVerified: true`, continuous playback verified across all 10 acts (`ACT_01_BLACKNESS → ACT_10_ECOLOGICAL_CONTEXT`) saved at [`docs/screenshots/act01-to-10-full-sequence.webm`](./screenshots/act01-to-10-full-sequence.webm) (`23,096,115` bytes).
  - `desktop-1440x900` (`dpr: 1`): Median FPS `142.9–144.9` across all 10 acts; `p95` `7.0–7.2 ms`; min FPS `133.3–140.8` (transient `71.9` FPS dip during ACT 08 sample window); draw calls `2` (`act04`) to `16` (`act10`); particles up to `9,420` (`act01`) / `9,000` (`act05–09`) / `12,455` (`act10` with `3,455` globe land dots).
  - `desktop-1920x1080` (`dpr: 1`): Median FPS `142.9–144.9`; `p95` `7.0–7.2 ms`; min FPS `126.6–140.8`; `0` errors.
  - `mobile-390x844` (`dpr: 1.5`): Median FPS `142.9–144.9`; `p95` `7.0–7.4 ms`; min FPS `131.6–140.8`; `3,000` field particles / `6,455` total in `act10`; draw calls `2–13`; `0` errors.
  - `mobile-412x915` (`dpr: 1.5`): Median FPS `142.9–144.9`; `p95` `7.1–7.3 ms`; min FPS `71.4–138.9`; `0` errors.
- **Reduced Motion (`prefers-reduced-motion: reduce`):** `reducedMotion: true`, `1` canvas, `142 FPS` (`p95`/`frameTimeMs: 7.04 ms`), `0` errors; narrative acts, static leaf/globe framing, and telemetry remain intact.
- **Live ACT 06 Regression Check ([`scripts/validate-live-integration.mjs`](../scripts/validate-live-integration.mjs)):** Verified against GPU BirdNET ONNX v3.0 (`CUDAExecutionProvider`, `32 kHz`, `11,725` classes) with `audio_mono_32k.wav` and physical OS mic probe (`3` microphones enumerated, `micLiveActive: true`); `wsFramesSentBinary: 26`, live `detection`, `disturbance_detected`, `soundscape_measurement`, and `processing_update` events received; `captureLatencyMs: 4 ms`, `wsLatencyMs: 43.7 ms`, `inferenceLatencyMs: 63.9 ms`, `visualResponseLatencyMs: 6 ms`, `medianFps: 144.9`, `demoControlsPresentInLive: false`, `errors: []`.

---

## 6. Known Limitations

- In `validate-live-integration.mjs`, `stateA_silenceOk` passed (`true`) while `stateE_returnToSilenceOk` reported `false` after stopping WAV playback due to the short settle poll window in the verification harness while residual live event decay was finishing (`stepAcousticFieldState` decay rate `2.4/s`).
- Standalone `prefers-reduced-motion` direct jump (`/?act=blackness` → instant `jumpToAct("ACT_10")`) settled before async WebSocket session creation, cleanly rendering `UNSPECIFIED IN SESSION` without fabricating coordinates; normal `ACT 01 → 10` progression connects WebSocket and populates live coordinates (`47.86°, -123.93°`).
- **ACT 11–16 Status:** Intentionally unimplemented in this pass (`EXPECTED SPECIES`, `OBSERVATION GAP`, `UNEXPECTED TAXA`, `GROUNDED INTERPRETATION`, `RETURN TO FOREST`, `OBSERVATORY`); backend schemas and routes under `/api/v1/ecology/*`, `/api/v1/environmental/*`, `/api/v1/reports/*`, `/api/v1/detections/*`, `/api/v1/sites/*`, and `/api/v1/acoustic/*` are mapped for the next build loop.
