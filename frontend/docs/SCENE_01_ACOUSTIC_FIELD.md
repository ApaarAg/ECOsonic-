# ECOsonic 3.0 — Scene 01: Acoustic Field (Act 06)

**Status:** Implemented (Visual Foundation + Scene 01 only)  
**Date:** 2026-11-25  

---

## 1. Visual Concept

The **Acoustic Field** is the first interactive spatial observation environment in the 16-act ECOsonic narrative (`BLACKNESS → ... → ACOUSTIC FIELD → ... → OBSERVATORY`).

- **Central Anchor (`CURRENT OBSERVATION`):** A restrained obsidian/charcoal sphere (`#060708`) with a whisper-thin Fresnel rim, grounding the site without resembling a planet, glowing AI orb, or Web3 sphere.
- **Organic Particle Field:** A non-uniform Fibonacci-distributed shell of acoustic particles stratified across four ecological frequency bands (`sub-biotic`, `mid-biotic`, `avian-high`, `atmospheric`) using the ECOsonic palette (bark umber `#3A2D24`, deep moss `#1D3327`, muted slate `#7C8582`, parchment `#E8E4DC`, and oxidized ochre `#C86D3B`).
- **Orbital Frequency Strata:** Tilted 3D closed trajectories with harmonic organic irregularity and travelling acoustic trace luminance.
- **Restrained Editorial Layer:** `Instrument Serif` display statement (`EVERY SOUND LEAVES A TRACE.`) paired with `Inter Tight` tabular scientific telemetry (`LISTENING` / `SILENT`, `DEMO SIGNAL` / `LIVE`, `32 KHZ`, `MONO`).

---

## 2. Template Source & Adaptation

- **Adapted from `hero-19/particle-sphere.tsx`:** Retained the Fibonacci sphere spatial distribution concept and scatter/damping response, but **rewrote all per-frame particle math from CPU `Vector3` loops into custom GLSL vertex/fragment shaders** (`FIELD_PARTICLE_VERTEX_SHADER`, `FIELD_PARTICLE_FRAGMENT_SHADER`).
- **Adapted from `features-02/orbit-controls.tsx`:** Retained the concentric orbital trajectory + travelling comet trace motif, but **replaced hardcoded DOM `px` divs and CSS `conic-gradient` masks with 3D WebGL `LineLoop` strata** (`ORBIT_STRATA_VERTEX_SHADER`, `ORBIT_STRATA_FRAGMENT_SHADER`) perturbed by organic harmonics and live band energy.
- **Rejected:** All OriginKit SaaS wrappers, `hero-19` wellness UI/PNGs/SVG `feGaussianBlur` filters, `orb.tsx` duplicate rAF loop, `particlesphere.tsx` dead duplicate, `hero-38` `runPageScript`/`createPortal` shims, and `originkit-section-theme*.css`.

---

## 3. Component Architecture

```text
src/
  api/
    ecosonicAudioCapture.ts   # AudioWorklet (32 kHz mono) + AnalyserNode band extraction
    ecosonicSocket.ts         # Frozen WebSocket protocol client with explicit DEMO fallback
  domain/
    storyboard.ts             # Fixed 16-act registry (only ACOUSTIC FIELD implemented)
    acousticFieldTypes.ts     # Audio, Detection, Disturbance, Soundscape, Session types
    acousticStore.ts          # External store: mutable liveAudio bridge + discrete React events
  styles/
    ecosonic.css              # Tailwind v4 @theme tokens, atmosphere vignette, reduced-motion
  ui/
    EditorialShell.tsx        # Minimal subordinate top bar & instrument source controls
  visual/
    engine/
      WebGLStage.ts           # Single WebGLRenderer + single requestAnimationFrame loop
      useReducedMotion.ts     # prefers-reduced-motion media query hook
      viewportBudget.ts       # Desktop / Tablet / Mobile GPU budgets
    AcousticField/
      AcousticField.tsx       # Scene 01 component binding store, stage, shaders, and overlay
      acousticFieldState.ts   # Pure physics: audio smoothing, silence settling, pulses
      acousticFieldShaders.ts # Custom GLSL shaders for particles, strata, and core
      acousticFieldInteraction.ts # Pointer parallax, 3D focus, and touch drag
```

**Core Rule:** Only `WebGLStage` creates a `WebGLRenderer` and runs `requestAnimationFrame`. High-frequency audio frames mutate `acousticStore.liveAudio` directly without triggering React re-renders.

---

## 4. Data Inputs

Consumes `audio`, `detections`, `disturbances`, `soundscape`, and `session` from `acousticStore`:

- **Audio Activity:** `rms`, `peak`, `bands[4]`, `spectralCentroid`, `temporalFlux` drive radial breathing, organic curl amplitude, and orbital trace luminance.
- **BirdNET Detection (`DetectionEvent`):** Spawns a localized spatial pulse at `(azimuthRad, elevationRad)` on the field shell, nudging nearby particles outward toward parchment (`#E8E4DC`) and surfacing a restrained transient trace label (explicitly badged `DEMO DETECTION TRACE` when `isDemo: true`).
- **Disturbance (`DisturbanceEvent`):** Triggers a localized trajectory disruption and oxidized ochre (`#C86D3B`) shift without alarmist red UI.
- **Silence:** When `source === "silent"` or acoustic energy drops below threshold, `silenceFactor` approaches `1.0`, exponentially damping orbital velocity, curl displacement, and particle brightness.

---

## 5. Animation Model

- Single `requestAnimationFrame` loop in `WebGLStage` with clamped `dt` (`0.001s` to `0.05s`).
- Exponential attack/release smoothing on audio metrics (`stepAcousticFieldState`).
- `fieldPhase` advances proportional to `(1 - silenceFactor * 0.9)` so the field genuinely settles during silence.
- Spatial impulses (`detectionPulse`, `disturbanceWave`) decay exponentially (`exp(-0.75 * dt)` and `exp(-0.52 * dt)`).

---

## 6. Interaction Model

- **Desktop:** Subtle pointer parallax (`parallaxStrength = 0.32`) and localized 3D hemisphere repulsion around `uPointerPos`, plus click-drag yaw/pitch nudge that springs back gently on release.
- **Mobile:** Touch-drag interaction with `touch-pan-y` CSS so normal vertical scrolling is preserved when not dragging horizontally; reduced parallax (`0.16`).

---

## 7. Responsive Strategy

Adaptive GPU budgets in `src/visual/engine/viewportBudget.ts`:

| Tier | Breakpoint | Max DPR | Particles | Orbital Strata | Segments/Stratum | Camera Z |
|---|---|---|---|---|---|---|
| Desktop | `>= 1024px` | `2.0` | `9,000` | `7` | `128` | `5.6` |
| Tablet | `768px–1023px` | `1.75` | `5,400` | `5` | `96` | `6.4` |
| Mobile | `< 768px` | `1.5` | `2,800` | `4` | `72` | `8.4` |

---

## 8. Performance & Latency Measurements

### Viewport Rendering (Headless Chrome via `scripts/validate-scene01.mjs`)

| Viewport | Canvases / Contexts | FPS | Frame Time | Draw Calls | Points | Lines | Context Lost | Overflow X | Console Errors |
|---|---|---|---|---|---|---|---|---|---|
| `1440×900` (Desktop) | `1` | `144` | `6.95 ms` | `9` | `9,000` | `896` | `false` | `false` | `0` |
| `1920×1080` (Desktop) | `1` | `144` | `6.95 ms` | `9` | `9,000` | `896` | `false` | `false` | `0` |
| `390×844` (Mobile) | `1` | `144` | `6.94 ms` | `6` | `3,000` | `288` | `false` | `false` | `0` |
| `412×915` (Mobile) | `1` | `144` | `6.94 ms` | `6` | `3,000` | `288` | `false` | `false` | `0` |

### End-to-End Real Backend Latency Breakdown (`scripts/validate-live-integration.mjs`)

Verified against the live FastAPI + BirdNET+ V3.0 ONNX (GPU) backend (`POST /api/v1/live/sessions` + `WS /api/v1/live/sessions/{id}/stream`) with Chrome `AudioWorklet` + `BandLimitedResampler` streaming 32 kHz mono PCM16 (`>I` sequence header + `<i2` payload) from `audio_mono_32k.wav`:

| Stage | Metric | Measured |
|---|---|---|
| **A. Audio capture latency** | `captureLatencyMs` (AudioWorklet → `acousticStore`) | `4.00 ms` |
| **B. WebSocket latency** | `wsLatencyMs` (`heartbeat` → `heartbeat_ack` RTT) | `4.00 ms` capture / `40.90 ms` WS |
| **C. Inference latency** | `inferenceLatencyMs` (BirdNET ONNX GPU window) | `53.23 ms` (`54.21–81.35 ms` physical mic) |
| **D. Visual response latency** | `visualResponseLatencyMs` (event ingress → WebGL frame) | `3.60 ms` |

During active BirdNET GPU inference after the color pass (`1,000` consecutive rAF frames): **`144.9 FPS` median**, **`71.9 FPS` minimum** (`maxFrameTimeMs: 13.90 ms`), **`7.20 ms` p95 frame time**, `10` draw calls (`9` baseline), `1` WebGL context, `0` console/page errors, `contextLost: false`, `overflowX: false`.

---

## COLOR SYSTEM

### Acoustic Band → Color Mapping

All colors are desaturated, documentary ecological pigments computed continuously on the GPU:

| Ecological Stratum | Band (`uBands`) | Hex / Linear Role | Semantic Meaning |
|---|---|---|---|
| **Sub-biotic / low frequency** | `uBands.x` | `#5C548A` (deep indigo / muted violet) | Low-frequency ambient rumble, canopy wind base |
| **Mid-biotic** | `uBands.y` | `#4E7E66` (desaturated moss green) | Mid-band biotic soundscape & forest bed |
| **Avian-high** | `uBands.z` | `#AE794B` (muted ochre / amber) | High-frequency biological & avian activity |
| **Atmospheric** | `uBands.w` | `#5D8A9E` (desaturated blue / slate-cyan) | Upper-band atmospheric air & shimmer |
| **Quiet Baseline** | `uSilence → 1.0` | Charcoal-moss / muted slate (`#293830` → `#6B7570`) | Settled quiet acoustic equilibrium |
| **Disturbance** | `uDisturbanceStrength` | `#C86D3B` (oxidized ochre, never red) | Localized non-biotic / anthropogenic disruption |

### Shader Implementation

- **Particle Field (`FIELD_PARTICLE_VERTEX_SHADER` & `FIELD_PARTICLE_FRAGMENT_SHADER`):** Each particle blends a continuous band coordinate (`aBand + (aSeed - 0.5) * 0.72 + (uCentroid - 0.38) * 0.45`) with the live normalized `uBands` energy vector (`46%` global acoustic structure mix), ensuring smooth organic transitions with no hard stripes or rainbow gradients.
- **Orbital Strata (`ORBIT_STRATA_FRAGMENT_SHADER`):** Each of the `4`–`7` `LineLoop` strata carries its corresponding band pigment, desaturating toward muted slate when `uSilence → 1.0` and warming subtly on detection/disturbance.
- **Central Observation Core (`CORE_FRAGMENT_SHADER`):** Remains predominantly obsidian (`#060708`); only its thin Fresnel rim reflects the weighted ambient `uBands` tint at low intensity (`0.28 + uEnergy * 0.28`), preserving `TEXT + ACOUSTIC FIELD` hierarchy.

### Dynamic State Behavior

- **Live Audio Response:** `uBands[4]`, `uEnergy`, `uCentroid`, and `uFlux` increase chromatic contribution (`vChroma`) smoothly as acoustic activity rises.
- **Silence Behavior:** As `uSilence` approaches `1.0`, `vChroma` drops by `86%` and orbital strata desaturate by `82%` toward the charcoal/moss/slate baseline.
- **Detection Behavior:** `uDetectionStrength` warms the localized spatial region toward avian ochre + parchment (`#E8E4DC`) and introduces a subtle (`<= 22%`) global avian-ochre bias communicating high-frequency biological activity without flashing.
- **Disturbance Behavior:** Remains localized to `uDisturbanceDir` in oxidized ochre (`#C86D3B`) and decays rapidly (`4.5/s`) when returning to silence.
- **Reduced Motion:** `uReducedMotion` damps `uFlux` chromatic pulsing (`85%`) and orbital trace travel (`75%`) while keeping band color meaning intact.

### Accessibility & Performance Impact

- Color never acts as the sole state indicator: `LISTENING / SILENT`, `LIVE / DEMO SIGNAL`, `OBSERVATION ACTIVE / FIELD SETTLED`, and ephemeral text traces remain high-contrast parchment/slate over obsidian.
- Mobile (`390×844`, `412×915`) shares the exact shader saturation curve (`vChroma`) so lower particle count (`3,000`) does not appear oversaturated.
- **Performance Impact vs. Monochrome Baseline:** Zero additional draw calls (`9` baseline / `10` with event ring), `1` WebGL context, `0` React per-frame rerenders, and `p95` frame time unchanged at `7.20 ms` (`144.9 FPS` median).

---

## 9. Accessibility

- `prefers-reduced-motion: reduce` disables orbital rotation, camera parallax, and pointer scatter while preserving the static spatial field and all telemetry.
- Semantic landmarks (`<header>`, `<nav aria-label="Acoustic Field Instrument Controls">`, `<main>`, `<section aria-label="Scene 01: Acoustic Field">`).
- `aria-live="polite"` regions for acoustic status (`LISTENING` / `SILENT`) and transient detection/disturbance traces.
- Keyboard-accessible controls with high-contrast `focus-visible` outlines.

---

## 10. Known Limitations

1. **Physical-mic wild bird detection:** Physical `Microphone Array (Realtek(R) Audio)` capture → 32 kHz mono PCM16 → WebSocket → BirdNET ONNX ran end-to-end (`MIC LIVE`, `4.00 ms` capture, `45.20 ms` WS, `81.35 ms` inference), though no live bird vocalization was present in the quiet room during the automated capture; detection/disturbance visual responses were verified via real `audio_mono_32k.wav` streaming through the same path.
2. **Font Loading Offline:** `Instrument Serif` and `Inter Tight` are linked via Google Fonts in `index.html` with Georgia/system-sans fallbacks; self-hosted `@fontsource` bundling can be added later for fully offline deployments.
3. **Other Storyboard Acts:** Acts `01–05` and `07–16` are intentionally unimplemented per prompt scope.

---

## 11. Validation & Color Comparison Screenshots

- `docs/screenshots/scene01-1440x900-monochrome-baseline.png` — Pre-color-pass monochrome baseline (`1440×900`)
- `docs/screenshots/scene01-1440x900.png` — Multicolor idle / demo (`1440×900`)
- `docs/screenshots/scene01-1440x900-live.png` — Multicolor live FastAPI + BirdNET ONNX stream (`1440×900`)
- `docs/screenshots/scene01-1440x900-detection.png` — Multicolor localized BirdNET detection trace (`1440×900`)
- `docs/screenshots/scene01-1440x900-disturbance.png` — Multicolor localized oxidized-ochre disturbance (`1440×900`)
- `docs/screenshots/scene01-1440x900-events.png` — Multicolor combined detection + disturbance (`1440×900`)
- `docs/screenshots/scene01-1440x900-silence.png` — Multicolor settled `SILENCE` desaturation (`1440×900`)
- `docs/screenshots/scene01-1920x1080.png` — Full HD desktop (`1920×1080`)
- `docs/screenshots/scene01-390x844.png` — Mobile (`390×844`)
- `docs/screenshots/scene01-412x915.png` — Mobile (`412×915`)
