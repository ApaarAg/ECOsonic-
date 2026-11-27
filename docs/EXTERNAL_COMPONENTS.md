# ECOsonic 3.0 — External Components & Architectural Adaptation Register

**Document Version:** 1.0.0  
**Status:** Approved & Implemented  
**Scope:** Reusable UI components, WebGL/shader techniques, and architectural adaptations for ECOsonic 3.0 public hero and observatory.

---

## 1. Executive Strategy: Coherent Identity vs. Template Assembly

The objective of this integration is strictly:
> *Use the best available building blocks from industry-leading component libraries, design galleries, and shader references to make ECOsonic significantly more sophisticated while preserving one coherent visual identity.*

At no point has ECOsonic imported generic SaaS patterns (such as centered gradient text, blue/purple AI blobs, glassmorphism cards, or floating dashboard screenshots). Every external reference was filtered through the **Nature + Science + Environmental Technology** framework:

$$\text{FOREST} \longrightarrow \text{LIFE} \longrightarrow \text{SOUND} \longrightarrow \text{SIGNAL} \longrightarrow \text{INTELLIGENCE} \longrightarrow \text{ECOSONIC}$$

---

## 2. External Sources Inventory & Mapping Matrix

| Source | Candidate Component / Technique | License / Terms | ECOsonic Target | Implementation File | Architectural Adaptation |
|---|---|---|---|---|---|
| **Casberry Particle Simulator**<br>`https://particles.casberry.in/` | GPU-accelerated acoustic particle field & frequency-reactive density | MIT / Open Reference | **AcousticField** & **WebGLCinematicStage** | `web/src/components/observatory/AcousticField.tsx`<br>`web/src/components/cinematic/WebGLCinematicStage.tsx` | Rebuilt as high-frequency 60 FPS HTML5 2D/WebGL buffer with typed arrays (`Float32Array`), zero-GC ring buffer, multi-band audio reactivity (sub-bass, bird vocalization bands, high-frequency insect sizzle), and interactive frequency probe. |
| **OriginKit Sections**<br>`https://www.originkit.dev/sections` | Asymmetric Editorial Product Preview & Storytelling Grid | MIT / Permissive | **InteractiveProductPreview** & **LandingPage** | `web/src/components/cinematic/InteractiveProductPreview.tsx`<br>`web/src/pages/LandingPage.tsx` | Replaced standard SaaS feature grids with an asymmetric telemetry stage. Features live bioacoustic frequency probes, spectrogram waterfall simulation, and real-time species / disturbance injection without faking live hardware states. |
| **daisyUI**<br>`https://daisyui.com/` | Structural UI primitives (Tabs, Timeline, Badges, Segmented Controls, Floating Docks) | MIT License | **ObservatoryPage**, **AppShell**, **Primitives** | `web/src/components/ui/Primitives.tsx`<br>`web/src/index.css`<br>`web/src/components/layout/AppShell.tsx` | Stripped all default daisyUI styling/colors. Custom-tokenized with ECOsonic palette (`#101C17`, `#788B68`, `#A5AC9C`, `#D3A36C`, `#E07A5F`, `#EEEBDD`). Embedded into `.eco-badge`, `.eco-timeline`, `.eco-floating-dock`. |
| **Design Reference: Interactive Solar Fog** | Volumetric mist displacement & cursor clearance | Open WebGL Reference | **WebGLCinematicStage Shaders** | `web/src/components/cinematic/cinematicShaders.ts` | Implemented 3-octave Fractional Brownian Motion (FBM) canopy mist that curls with time and dynamically parts around the visitor's cursor, revealing bark and wet forest textures. |
| **Design Reference: 3D Flower Valley** | Multi-plane instancing & depth-stratified field | Open Three.js Reference | **Canopy Mote Field** | `web/src/components/cinematic/WebGLCinematicStage.tsx` | Instanced 64 bioluminescent canopy spores and dew particles in view volume with sinusoidal wind sway and acoustic amplitude brightness modulation. |
| **Design Reference: Photography Nature Portfolio** | Liquid displacement & organic earth palette | Creative Reference | **DarkWaterScene** & **LeafMesh** | `web/src/components/cinematic/leafMesh.ts`<br>`web/src/components/cinematic/DarkWaterScene.tsx` | Physics-based 6-DOF leaf descent, stem flexure, and dispersive water contact ripple physics keyed to natural pond colorimetry. |
| **Design Reference: Creative Honey Bee** | Scroll-choreographed camera traversal | Reference Interaction Pattern | **CinematicHero** & **Lenis/GSAP** | `web/src/components/cinematic/CinematicHero.tsx`<br>`web/src/lib/cinematicTimeline.ts` | Lenis smooth scroll scrubbed against camera Z push, pitch, roll, and focus pull into the oak twiglet. |
| **Canonical Imagery: Temperate Rainforest** | 4K Coastal Old-Growth Forest & Watershed Photography | CC0 / Permissive | **WebGLCinematicStage & Stage Backdrops** | `web/public/assets/canonical/` | Unifies opening canopy (`opening_canopy_4k.jpg`), branch foliage (`rainforest_branch_overcast.jpg`), and water reflection pool (`coastal_waterside_forest_4k.jpg`) into a single continuous Douglas-fir / Sitka spruce ecosystem under soft overcast diffuse light. |

---

## 3. Strict ECOsonic Design Token Overrides

Every imported component strictly inherits ECOsonic's design tokens:

```css
/* ECOsonic Forest & Earth Color Authority */
--eco-black: #060A07;        /* Deep obsidian shadow */
--eco-forest: #101C17;       /* Primary dark forest ground */
--eco-moss: #788B68;         /* Living moss & vegetative biophony */
--eco-sage: #A5AC9C;         /* Lichen & stone telemetry */
--eco-amber: #D3A36C;        /* Avian vocalization & signal highlight */
--eco-terracotta: #E07A5F;   /* Anthropogenic disturbance radar */
--eco-parchment: #EEEBDD;    /* Warm editorial typography & contrast ground */
--eco-bark: #22170E;         /* Wet bark & shaded basin */
```

### Typography Rules
- **Display / Brand:** Serif font (`font-serif`, editorial grade, restrained letter-spacing `0.38em` to `0.44em`).
- **Telemetry / Metrics:** Monospace font (`font-mono`, `IBM Plex Mono`), exact frequency units (`Hz`, `dBFS`, `kHz`).
- **Prose / UI:** Clean humanist sans-serif (`font-sans`, `Plus Jakarta Sans`).

---

## 4. Reusable Architectural Signatures

### 4.1 AcousticField (`AcousticField.tsx`)
A high-performance acoustic field component engineered for both the public hero transition and the live observatory workspace:
- **Modes:** `composite`, `ecosystem`, `spectrogram`, `waveform`.
- **Zero-GC Loop:** Pre-allocated `Float32Array` buffers for multi-band frequency response, wave history, and shockwave loci.
- **Audio Reactivity:** Direct connection to `Web Audio AnalyserNode` or simulated ecological telemetry without routing audio frames through React state.
- **Ecological Loci:** Renders real-time bioacoustic shockwaves when avian species vocalize or mechanical disturbances intrude.

### 4.2 InteractiveProductPreview (`InteractiveProductPreview.tsx`)
An asymmetric editorial showcase built to demonstrate real system capabilities:
- **Species Injection:** Allows users to trigger authentic species detections (*Pacific-slope Flycatcher*, *Hermit Thrush*, *Chestnut-backed Chickadee*) and view real-time confidence scores and spectrogram changes.
- **Disturbance Simulation:** Visualizes anthropogenic intrusion detection across 4 categories (*mechanical activity*, *transportation*, etc.).
- **Live vs Demo Integrity:** Explicit badge indicating `DEMO / EXAMPLE DATA` whenever not bound to active hardware.

### 4.3 WebGLCinematicStage (`WebGLCinematicStage.tsx`)
A high-fidelity Three.js WebGL canvas delivering the opening sequence:
- **Scene 01 Darkness:** Starts in near-blackness (`#060A07`), gradually peeling back mist and darkness as the user moves their cursor or begins scrolling.
- **Interactive Canopy Mist:** FBM shader curling with time and opening a clearing lens around the cursor.
- **Instanced Spores & Motes:** 64 GPU particles floating in the 3D canopy responding to audio amplitude.
- **Seamless Leaf Fall:** 6-DOF aerodynamic descent attached to bare oak twig unprojected mathematically from 2D coordinates into 3D world space.
