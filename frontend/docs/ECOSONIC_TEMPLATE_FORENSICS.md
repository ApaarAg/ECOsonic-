# ECOsonic 3.0 — Template Forensics & Integration Map

**Audit Date:** 2026-11-25  
**Workspace:** `c:\Users\apaar\Desktop\frontend`  
**Status:** Forensic Audit & Architecture Only (No application code modified)

---

## Executive Finding: Existing Repository State

A complete inspection of `c:\Users\apaar\Desktop\frontend` reveals a critical baseline gap:

- **No existing ECOsonic 3.0 application code is present in this workspace.** There is no `package.json`, `vite.config.*`, `tsconfig.json`, `index.html`, `src/` directory, router, API client, WebSocket handler, `Observatory`, `AcousticField`, or ecological UI.
- **Only three downloaded OriginKit templates** (`features-02`, `hero-19`, `hero-38`), OriginKit's Tailwind v4 theme stubs (`app/originkit-section-theme.css`, `app/originkit-section-themes.css`), `postcss.config.mjs`, `.originkit/INSTRUCTIONS.md`, and `public/originkit/` assets exist in the repository.
- **Implication:** Before any template logic is integrated, the ECOsonic 3.0 React + Vite + TypeScript + Tailwind v4 shell, domain state, and backend adapters (including `POST /api/v1/ecology/observation-gap` and the live WebSocket protocol) must be initialized or linked into this repository.

---

## 1. Complete Template Inventory

| Template | Original Purpose | Technical Stack | Animation | ECOsonic Candidate | Adaptation Required | Keep/Reject |
|---|---|---|---|---|---|---|
| `features-02` (`Presence01` + `Globe` + `OrbitControls`) | SaaS "Global Presence / Connecting Worldwide Teams" section with 3 metrics | React `"use client"`, Tailwind v4, `three` (`WebGLRenderer`, `InstancedMesh`, `ShaderMaterial`), `d3-geo` (`geoEquirectangular`, `geoPath`), external GeoJSON fetch | WebGL `requestAnimationFrame` globe rotation + drag inertia; CSS `conic-gradient` `globe-orbit` keyframes (12s/18s) | **Act 10 (Ecological Context)** & **Act 06 (Acoustic Field)** orbit ring motif | Strip SaaS metrics/copy; vendor Natural Earth GeoJSON locally; extract globe geometry/shader into unified WebGL scene; replace decorative rings with ecological/acoustic telemetry | **Modify / Partial Keep** (`CORE` for `globe.tsx` logic; `REJECT` for `features-02.tsx` SaaS wrapper) |
| `hero-19` (`Section26Hero` + `Orb` + `ParticleSphere` + `MaskGroup` + `Backdrop` + `LogoMarquee` + `RecommendationCard`) | "Visionary Everyday Wellness Partner" hero with glowing orange orb over a hand | React `"use client"`, Tailwind v4, `three` (`WebGLRenderer`, `Points`, `PointsMaterial`, `AdditiveBlending`), inline SVG `feGaussianBlur` filters, 16 PNG/SVG assets | Three.js `requestAnimationFrame` Fibonacci particle sphere with CPU per-frame cursor scatter; separate `Orb` `requestAnimationFrame` CSS `--hole-r` mask loop; CSS `logo-marquee` | **Act 05–06 (Sound → Acoustic Field)** & **Act 08 (Disturbance)** particle sphere physics | Strip wellness UI, hand PNG, ceiling lamp PNGs, logo marquee, recommendation card, and SVG blur filters; port `ParticleSphere` Fibonacci distribution & scatter math to GPU/unified Three.js scene | **Modify / Partial Keep** (`CORE` for `particle-sphere.tsx` concept; `REJECT` for `section-26-hero.tsx` & all other subcomponents/assets) |
| `hero-38` (`SectionHero` + `ParticleSimulation`) | "Origin" PR-review SaaS hero with moss-covered fallen tree trunk particle simulation | React `"use client"`, custom scoped CSS (`hero-38.css`), raw **WebGL2/WebGL1 GPGPU** (`SpectralParticles` with `RGBA32F` ping-pong FBOs, `gl.POINTS`), imperative `runPageScript` + `createPortal` + custom `IntersectionObserver` shim | GPU FBO ping-pong physics (`SIM_ATOMIC` / `VS_ATOMIC`) sampling `tree.png` with hover energy/lift + jitter | **Act 02 (Forest)** & **Act 15 (Return to Forest)** organic particle/moss motif | **Discard** `section-hero.tsx`, `hero-38.css`, `runPageScript`, `createPortal`, and `IntersectionObserver` shim; extract/rewrite GPGPU FBO particle shader cleanly inside unified renderer; remove `minWidth: 1200` desktop lock | **Modify / Partial Keep** (`SUPPORTING` / `ASSET` for `particle-simulation.tsx` shader + `tree.png` reference; `REJECT` for `section-hero.tsx` & `hero-38.css`) |
| `hero-19/particlesphere.tsx` | Duplicate/older version of `particle-sphere.tsx` (1,499 lines, 61.9 KB) | React + `three` | Same as `particle-sphere.tsx` without `coreColor`/`coreScale` | None (dead code, unimported) | Delete immediately | **Reject** |
| `app/originkit-section-theme.css` & `originkit-section-themes.css` | Global OriginKit Tailwind v4 `@theme` tokens (24 fonts, 12 device breakpoints, 9 animations) | Tailwind v4 `@theme` | Keyframes for `hero-reveal`, `section-rise`, `trusted-marquee`, `phone-flip-in-x`, etc. | None directly | Replace with a clean ECOsonic `@theme` block (2 fonts, standard responsive breakpoints, ECOsonic palette) | **Reject** (replace with ECOsonic tokens) |

---

## 2. Technical Analysis

### A. `features-02` (`components/originkit/features-02.tsx`, `ui/features-02/globe.tsx`, `orbit-controls.tsx`, `presence-01.css`)
- **WebGL Implementation (`globe.tsx`, 1,047 lines):**
  - Creates its own `WebGLRenderer({ antialias: true, alpha: true })`, `Scene`, `PerspectiveCamera`, `AmbientLight`, `DirectionalLight`, ocean `SphereGeometry(64, 64)`, atmospheric `ShaderMaterial` rim glow, and `InstancedMesh` for land dots.
  - Fetches `ne_50m_land.json` at runtime from `https://raw.githubusercontent.com/martynafford/natural-earth-geojson/...` and rasterizes it onto an offscreen 2D canvas via `d3-geo` (`geoEquirectangular`, `geoPath`) to sample land dots.
  - Uses `ResizeObserver` and stops its `requestAnimationFrame` loop when idle (`!isDragging && rotationSpeed === 0 && !hasVelocity && !hasLerpDelta`) — good baseline discipline.
- **Orbit Overlay (`orbit-controls.tsx`):**
  - Renders 5 hardcoded concentric dashed rings (`DESKTOP_RINGS`: 318–434px, `MOBILE_RINGS`: 297–416px) with CSS `conic-gradient` comet trails animated via `animate-globe-orbit` (`12s`, `18s`).
- **Issues:**
  - External GitHub dependency for GeoJSON fails offline/behind proxies.
  - Hardcoded pixel offsets (`top-92.375`, `top-67`) tightly couple `OrbitControls` to `Presence01`'s exact layout.
  - Contains generic SaaS metrics (`100% Increase in Progress Tracking`, etc.) and `globe-icon.svg`.

### B. `hero-19` (`components/originkit/hero-19.tsx`, `ui/hero-19/*`, `hero-19.css`)
- **WebGL Implementation (`particle-sphere.tsx`, 1,438 lines):**
  - Creates a dedicated `WebGLRenderer`, `Scene`, `PerspectiveCamera`, and 10,000-particle Fibonacci sphere (`Points` + `PointsMaterial` with `AdditiveBlending`).
  - **Severe CPU Bottleneck:** In the `animate()` loop (lines 660–736), it iterates over all `10,000` particles **on the CPU every frame**, computing `Vector3` math, allocating `new Vector3()` per particle, updating `Float32BufferAttribute` positions and colors, and setting `needsUpdate = true`.
  - **Duplicate File:** `particlesphere.tsx` (1,499 lines, 61.9 KB) is an unimported, slightly older copy of `particle-sphere.tsx`.
- **DOM / SVG / CSS Overhead:**
  - `orb.tsx` runs a *second* independent `requestAnimationFrame` loop just to update CSS custom properties (`--hole-x`, `--hole-y`, `--hole-r`) for a `backdrop-blur` / `blur-xl` core mask.
  - `mask-group.tsx` renders inline SVG `feGaussianBlur` filters (`stdDeviation="38.5824"` and `"23.3587"`), which are notoriously expensive on mobile GPUs.
  - `section-26-hero.tsx` + `backdrop.tsx` stack 6+ full-bleed `mix-blend-screen` PNGs (`arcs-desktop.png` 2.6 MB, `ipad-texture.png` 1.67 MB, `bg-shapes-desktop.png` 1.54 MB, etc.) and hardcoded Figma coordinates (`top-[499px]`, `h-[874px]`).
  - `hero-19.css` imports Google Fonts (`Instrument Serif` + `Inter Tight`) directly via `@import url(...)`.

### C. `hero-38` (`components/originkit/hero-38.tsx`, `ui/hero-38/section-hero.tsx`, `particle-simulation.tsx`, `hero-38.css`)
- **WebGL Implementation (`particle-simulation.tsx`, 823 lines):**
  - Raw **WebGL2 / WebGL1 GPGPU** particle engine (`SpectralParticles`) using ping-pong float framebuffers (`RGBA32F` / `OES_texture_float`) and two shader programs (`SIM_ATOMIC` for hover energy/damping, `VS_ATOMIC` for orbital jitter + `gl.POINTS` rendering).
  - Samples an image (`portraitImage`, here `/originkit/hero-38/tree.png`) incrementally using `makeBuilder` with an 8ms frame budget (`BUILD_BUDGET_MS = 8`) so initial pixel sampling does not freeze the main thread.
  - **Mobile / Layout Hazard:** Sets `minWidth: 1200, minHeight: 800` on its host `div`, breaking mobile viewports unless overridden. Defaults to external Unsplash URLs if `portraitImage` is omitted.
  - **FPS / Budget:** Caps `DPR_CAP = 2` and `DENSITY_MAX = 2,000,000` (configured at `density: 50` in `section-hero.tsx`, which computes ~1,025,000 particles on desktop!).
- **Wrapper Anti-Patterns (`section-hero.tsx`, 241 lines):**
  - Uses `runPageScript` with imperative `document.getElementById(...)` listeners, a fake `ReactDOM.createRoot` → `createPortal` adapter, and a custom `IntersectionObserver` polyfill class that attaches global `scroll` and `resize` listeners.
  - `hero-38.css` sets `scroll-behavior: smooth` and `font-family: Arial, Helvetica, sans-serif` inside `.hero-38`, and uses an `overflow: clip` stage with `calc(var(--ok-design-h, 100vh) * 0.058)`.

---

## 3. Keep / Reject Decisions (Role Classification)

| Template / File | Role | Decision & Rationale |
|---|---|---|
| `components/originkit/ui/features-02/globe.tsx` | **CORE** | Keep the `d3-geo` → 3D sphere `InstancedMesh` + atmospheric rim shader pattern; refactor into a shared WebGL scene module with local GeoJSON. |
| `components/originkit/ui/hero-19/particle-sphere.tsx` | **CORE** | Keep the Fibonacci sphere + acoustic/cursor scatter concept; **rewrite** particle displacement into a vertex shader (GPU) rather than CPU `Vector3` loops. |
| `components/originkit/ui/hero-38/particle-simulation.tsx` | **SUPPORTING** | Keep the WebGL2 ping-pong FBO particle sampling architecture (and 8ms incremental `makeBuilder` pattern) for organic forest/moss/species particle transitions; strip Unsplash defaults and `minWidth: 1200`. |
| `public/originkit/hero-38/tree.png` | **ASSET** | Usable as a temporary organic moss/trunk silhouette reference for Act 02/15 testing, though final production should use ECOsonic-authored coastal old-growth forest imagery. |
| `components/originkit/ui/features-02/orbit-controls.tsx` | **REFERENCE** | Useful visual reference for concentric dashed/comet rings, but better rendered as WebGL rings/arcs synchronized to the acoustic field rather than hardcoded DOM `px` divs. |
| `components/originkit/features-02.tsx` | **REJECT** | SaaS metrics, copy, and hardcoded layout. |
| `components/originkit/hero-19.tsx` & `section-26-hero.tsx` | **REJECT** | Wellness SaaS branding, nav, auth buttons, Figma pixel coordinates. |
| `components/originkit/ui/hero-19/{backdrop,logo-marquee,mask-group,orb,recommendation-card}.tsx` | **REJECT** | Unrelated wellness UI, expensive SVG `feGaussianBlur`, redundant rAF loop, and ~8.9 MB of static PNGs. |
| `components/originkit/ui/hero-19/particlesphere.tsx` | **REJECT** | Dead duplicate file (61.9 KB). |
| `components/originkit/hero-38.tsx`, `hero-38.css`, `ui/hero-38/section-hero.tsx` | **REJECT** | Origin PR-review SaaS branding, imperative `runPageScript` + `createPortal` + `IntersectionObserver` shim. |
| `app/originkit-section-theme.css` & `originkit-section-themes.css` | **REJECT** | Bloated 24-font, 12-breakpoint OriginKit dump; replace with minimal ECOsonic tokens. |

---

## 4. Storyboard Mapping (Acts 01–16)

| Act | Narrative Beat | Candidate Template / Technique | Why | Required Transformation |
|---|---|---|---|---|
| **01 — BLACKNESS** | Silence; minimal environmental emergence | None (Custom ECOsonic) | Pure `#060708` obsidian canvas + subtle ambient vignette | Custom minimal emergence; zero template bloat |
| **02 — FOREST** | Realistic temperate coastal old-growth forest | `hero-38` (`particle-simulation.tsx` + `tree.png` ref) | Organic particle-to-image sampling evokes mist/moss/canopy | Replace PR-review hero with coastal old-growth forest scene; drive particle dispersion via scroll/scroll-progress |
| **03 — LEAF** | Physical leaf detaches and falls | None (Custom ECOsonic) | Requires deterministic physics/bezier fall trajectory | Custom 3D/2D leaf geometry or shader plane in unified WebGL scene |
| **04 — WATER** | Leaf touches water; ripple expands | None (Custom ECOsonic) | Concentric wave interference shader | Custom GLSL ripple shader triggered at leaf impact coordinate |
| **05 — SOUND** | Water ripple transforms into acoustic information | `hero-19` (`particle-sphere.tsx`) + custom waveform | Concentric ripple rings lift into 3D frequency/wavefield | Morph 2D ripple ring into 3D acoustic waveform / nascent particle shell |
| **06 — ACOUSTIC FIELD** | First major interactive data environment | `hero-19` (`particle-sphere.tsx`) + `features-02` (`orbit-controls` motif) | Spatial 3D particle field + orbital telemetry rings | Replace decorative orange cursor-scatter with GPU shader driven by live/recorded soundscape metrics (band energy, centroid, biotic index) |
| **07 — SPECIES** | Acoustic signals become detected species | Custom spatial floating nodes (informed by `particle-sphere` depth) | No downloaded template is a floating gallery | Cluster acoustic particles into species nodes with BirdNET confidence & spectrogram previews |
| **08 — DISTURBANCE** | Human-made acoustic activity changes the field | `hero-19` (`particle-sphere.tsx` scatter physics) | High-energy radial/turbulent scatter communicates intrusion | Drive shader turbulence/ochre-amber shift from backend disturbance detector |
| **09 — SILENCE** | Acoustic field settles | `hero-19` (`particle-sphere.tsx` damping) | Return-to-home damping settles particles back to equilibrium | Smoothly damp amplitude/turbulence to near-zero; transition palette back to deep moss/charcoal |
| **10 — ECOLOGICAL CONTEXT** | Sound → geographic/ecological context | `features-02` (`globe.tsx`) | 3D dotted globe + rim atmosphere provides spatial grounding | Strip SaaS metrics; vendor GeoJSON; zoom/focus globe onto coastal study region & ecoregion metadata |
| **11 — EXPECTED SPECIES** | Ecological baseline | None (Custom ECOsonic analytical UI) | No analytical/taxonomic comparison template exists in repo | Custom editorial + tabular taxonomic baseline view |
| **12 — OBSERVATION GAP** | Expected vs acoustically observed species | None (Custom ECOsonic analytical UI) | Requires scientific uncertainty visualization | Custom comparison view wired to `POST /api/v1/ecology/observation-gap` |
| **13 — UNEXPECTED TAXA** | Detections outside baseline (non-alarmist) | None (Custom ECOsonic analytical UI) | Must avoid "invasive" framing; show neutral evidence | Custom evidence cards with confidence & acoustic snippet |
| **14 — GROUNDED INTERPRETATION** | Gemini explains structured evidence | None (Custom ECOsonic) | Gemini is explanatory layer only, never source of truth | Custom structured-evidence panel rendering backend Gemini synthesis alongside raw citations |
| **15 — RETURN TO FOREST** | Data experience dissolves back into living environment | `hero-38` (`particle-simulation.tsx` reverse) | Particles coalesce back into forest canopy/moss | Reverse particle dispersion into living forest backdrop |
| **16 — OBSERVATORY** | Cinematic experience becomes real ECOsonic instrument | None (Custom ECOsonic) | Full live WebSocket + BirdNET/ONNX + soundscape instrument | Clean, low-overhead instrument layout sharing the single WebGL canvas |

---

## 5. Dependency Analysis

### Required npm Dependencies (for the target Vite + React + TypeScript app)
- `three` + `@types/three`: Required by `globe.tsx` and `particle-sphere.tsx` (and unified WebGL scene).
- `d3-geo` + `@types/d3-geo`: Required by `globe.tsx` (`geoEquirectangular`, `geoPath`) for land-mask projection.
- `tailwindcss` + `@tailwindcss/postcss`: Already referenced by `postcss.config.mjs`.

### External Network Dependencies to Eliminate
1. `globe.tsx` line 59: `fetch("https://raw.githubusercontent.com/martynafford/natural-earth-geojson/refs/heads/master/50m/physical/ne_50m_land.json")` → **Must be vendored** as a local static JSON/TopoJSON asset (or pre-baked dot coordinate buffer) so the app works offline and without GitHub rate-limit/CORS risk.
2. `hero-19.css` line 3: `@import url("https://fonts.googleapis.com/css2?family=Instrument+Serif...")` → Self-host or load cleanly in `index.html` / `@fontsource` without duplicate `@import`s.
3. `particle-simulation.tsx` lines 50 & 375: Unsplash fallback URLs (`images.unsplash.com/photo-...`) → **Must be removed** so no external portrait images ever leak into ECOsonic.

---

## 6. Rendering Architecture & Conflict Resolution

### Conflicts Identified in Downloaded Templates
1. **Multiple WebGL Contexts:** `globe.tsx`, `particle-sphere.tsx`, and `particle-simulation.tsx` each instantiate their own `WebGLRenderer` / WebGL2 context. On mobile browsers (which cap active WebGL contexts at ~4–8) and during scroll transitions, mounting multiple canvases causes context loss and GPU memory spikes.
2. **Competing `requestAnimationFrame` Loops:** 4 separate rAF loops (`globe.tsx`, `particle-sphere.tsx`, `orb.tsx`, `particle-simulation.tsx`) run independently without a shared frame clock or reduced-motion gate.
3. **Imperative DOM Hacks:** `hero-38/section-hero.tsx` injects `createPortal`, `IntersectionObserver` overrides, and `document.getElementById` listeners.
4. **CSS & Breakpoint Conflicts:** `originkit-section-theme.css` defines 24 fonts and 12 custom breakpoints (`iphone:`, `ipad:`, `desktop-sm:`, etc.), while `hero-38.css` sets `scroll-behavior: smooth` and `Arial`.

### Proposed ECOsonic `src/` Architecture

```text
src/
  app/                  # App shell, router, reduced-motion & viewport providers
  domain/               # Ecological types, 16-act storyboard state machine, observation-gap models
  api/                  # Backend adapters (WebSocket live stream, POST /api/v1/ecology/observation-gap)
  data/                 # Vendored static data (e.g. ne_50m_land.json / precomputed land dots)
  visual/               # SINGLE unified WebGL engine (1 WebGLRenderer, 1 rAF loop)
    engine/             # SceneController, CameraRig, ScrollDirector, DisposeRegistry
    scenes/             # ForestScene, LeafWaterScene, AcousticFieldScene (GPU particle sphere), GlobeScene
    shaders/            # Ripple GLSL, GPGPU particle FBO, atmospheric rim GLSL
  ui/                   # Design system primitives (typography, cards, telemetry pills, badges)
  sections/             # Storyboard Act 01–16 section presenters (pure view + domain bindings)
  pages/                # ExperiencePage (Acts 01–15) & ObservatoryPage (Act 16)
  assets/               # Curated ECOsonic imagery, fonts, icons (no OriginKit wellness/SaaS assets)
```

**Core Rule:** Only `src/visual/engine/` may create a `WebGLRenderer` and run `requestAnimationFrame`. Acts 01–15 transition by morphing camera, uniforms, and geometry visibility within that **single persistent WebGL canvas**, while `src/sections/` renders semantic HTML/UI overlays above it.

---

## 7. Asset Strategy

Current `public/originkit/` footprint is **~10.8 MB** across 18 files:
- **`public/originkit/hero-19/` (~9.6 MB, 16 files):** `arcs-desktop.png` (2.64 MB), `ipad-texture.png` (1.68 MB), `bg-shapes-desktop.png` (1.54 MB), `bg-shapes-tablet.png` (1.07 MB), `arcs-texture.png` (1.06 MB), `texture-desktop.png` (1.00 MB), `bg-shapes.png` (416 KB), `hand.png` (137 KB), `logo-strip-marquee.svg` (104 KB), and 7 wellness/UI SVGs. **Action: Delete all 16 files.** None belong in ECOsonic.
- **`public/originkit/features-02/globe-icon.svg` (2.1 KB):** Generic icon. **Action: Delete.**
- **`public/originkit/hero-38/tree.png` (1.16 MB):** Moss-covered fallen tree trunk. **Action: Retain temporarily** in `src/assets/reference/` for prototyping Act 02/15 particle sampling, then replace with compressed WebP/AVIF coastal old-growth forest imagery.
- **GeoJSON:** Vendor `ne_50m_land.json` (or pre-bake a compact binary/JSON lat-lon dot array) into `src/data/` to eliminate the runtime GitHub fetch.

---

## 8. Visual Language

- **Palette:**
  - Obsidian (`#060708`) — Act 01 blackness, primary canvas
  - Wet Charcoal (`#111413`) — secondary surfaces, observatory panels
  - Deep Moss (`#1D3327`) — forest/biotic baseline
  - Bark Umber (`#3A2D24`) — organic structure, grounded earth
  - Parchment (`#E8E4DC`) — primary editorial typography
  - Muted Slate (`#7C8582`) — scientific metadata, axes, secondary labels
  - Oxidized Ochre (`#C86D3B`) — acoustic disturbance, unexpected taxa highlight (neutral, non-alarmist)
- **Typography:**
  - **Editorial Serif:** `Instrument Serif` (already present in `hero-19.css`) for major environmental/act statements.
  - **Technical Sans & Mono:** `Inter Tight` (or `Inter`) for UI/scientific prose + `Geist Mono` / `DM Mono` (`tabular-nums`) for frequencies, confidence scores, and coordinates.
- **Motion:** Driven by acoustic energy, disturbance turbulence, damping, and scroll progress—never decorative marquee loops or arbitrary hover gimmicks.

---

## 9. Transition Strategy (Object-to-Object Morphs)

1. **Act 02 → 03 → 04 → 05 (Forest → Leaf → Water → Sound):**  
   Canopy particles coalesce → single 3D leaf detaches and falls → impact spawns concentric GLSL water ripple → ripple rings extrude vertically into acoustic frequency rings.
2. **Act 05 → 06 → 07 → 08 → 09 (Sound → Acoustic Field → Species → Disturbance → Silence):**  
   Frequency rings wrap into the 3D Fibonacci `ParticleSphere` (GPU-driven) → high-confidence clusters pull outward into species nodes → human-made noise injects radial turbulence & ochre tint → damping settles velocity back to zero.
3. **Act 09 → 10 (Silence → Ecological Context):**  
   Settled `ParticleSphere` radius locks and cross-fades/morphs its Fibonacci points into the `InstancedMesh` land dots of `GlobeScene`, rotating smoothly to the coastal study coordinates.
4. **Act 14 → 15 → 16 (Interpretation → Return to Forest → Observatory):**  
   Analytical overlays recede; forest particle simulation reforms (`tree` / coastal canopy); UI docks into the live `Observatory` instrument without tearing down the WebGL context.

---

## 10. Responsive Strategy

- **Eliminate OriginKit's 12 custom breakpoints** (`iphone:`, `ipad-air:`, `ultrawide:`) and `hero-38`'s `minWidth: 1200, minHeight: 800` floor.
- Standardize on Tailwind v4's standard responsive scale (`sm`, `md`, `lg`, `xl`, `2xl`) with fluid `clamp()` typography.
- **Adaptive GPU Budgets:**
  - Desktop (`>= 1024px`): DPR capped at `2`, `ParticleSphere` up to `10,000` GPU vertices, `ParticleSimulation` capped at `<= 250,000` points (down from `2,000,000`).
  - Mobile (`< 768px`): DPR capped at `1.5`, `ParticleSphere` `3,500` vertices, `ParticleSimulation` `<= 60,000` points, touch-drag isolated from page scroll only when interacting with the canvas.
- **Reduced Motion (`prefers-reduced-motion: reduce`):** Freeze auto-rotation, disable FBO jitter/turbulence, and render static/stepped keyframes for Acts 01–15.

---

## 11. Performance Risks

1. **CPU Per-Frame Particle Loop (`particle-sphere.tsx`):** Updating 10,000 `Vector3` positions/colors on the CPU every frame will drop below 60 FPS on mid-tier laptops/mobile. **Mitigation:** Move displacement and color interpolation into a custom `ShaderMaterial` vertex shader.
2. **Over-Dense GPGPU FBO (`particle-simulation.tsx`):** `DENSITY_MAX = 2,000,000` and `RGBA32F` float textures can crash mobile WebGL or fail on devices without `EXT_color_buffer_float`. **Mitigation:** Cap density at `250k` desktop / `60k` mobile and preserve the `u_static` fallback already present in `VS_ATOMIC`.
3. **Synchronous GeoJSON + Canvas Rasterization (`globe.tsx`):** Fetching and scanning `ne_50m_land.json` on mount causes a noticeable main-thread stall. **Mitigation:** Precompute land dot coordinates at build time into a compact JSON/Float32Array in `src/data/`.
4. **DOM Blur Filters (`hero-19/mask-group.tsx`, `orb.tsx`):** SVG `feGaussianBlur` + `backdrop-blur-[50px]` cause severe compositing overhead. **Mitigation:** Reject these components; render glow via additive WebGL shader halos.

---

## 12. Recommended Implementation Order

1. **Phase 0 — App Shell & Backend Contract:** Initialize Vite + React + TypeScript + Tailwind v4 (`src/app/`, `src/domain/`, `src/api/`). Implement the typed client for `POST /api/v1/ecology/observation-gap` and the live WebSocket protocol.
2. **Phase 1 — Unified WebGL Engine (`src/visual/engine/`):** Create the single `WebGLRenderer`, `SceneController`, `DisposeRegistry`, and reduced-motion-aware `requestAnimationFrame` loop.
3. **Phase 2 — Act 06 (`AcousticField`) + Act 16 (`Observatory`) Core:** Build the GPU-accelerated `ParticleSphere` (adapted from `hero-19/particle-sphere.tsx`) wired to real soundscape/disturbance state so the core scientific instrument works end-to-end first.
4. **Phase 3 — Act 10 (`GlobeScene`) & Acts 11–14 (Ecology & Observation Gap):** Port `features-02/globe.tsx` with precomputed local land dots into the unified engine, then build the Observation Gap, Unexpected Taxa, and Gemini Grounded Interpretation views.
5. **Phase 4 — Opening Narrative (Acts 01–05) & Closing (Act 15):** Build Blackness → Forest (adapted `particle-simulation.tsx`) → Leaf → Water Ripple → Sound → Acoustic Field morphs, plus Return to Forest.

---

## 13. Explicit Exclusion List (Do NOT Use)

- `components/originkit/hero-19.tsx`
- `components/originkit/ui/hero-19/section-26-hero.tsx`
- `components/originkit/ui/hero-19/backdrop.tsx`
- `components/originkit/ui/hero-19/logo-marquee.tsx`
- `components/originkit/ui/hero-19/mask-group.tsx`
- `components/originkit/ui/hero-19/orb.tsx`
- `components/originkit/ui/hero-19/recommendation-card.tsx`
- `components/originkit/ui/hero-19/particlesphere.tsx` (dead duplicate)
- `components/originkit/hero-38.tsx`
- `components/originkit/hero-38.css`
- `components/originkit/ui/hero-38/section-hero.tsx` (`runPageScript`, `createPortal`, `IntersectionObserver` shim)
- `components/originkit/features-02.tsx`
- `components/originkit/presence-01.css`
- `app/originkit-section-theme.css` & `app/originkit-section-themes.css`
- All 16 files in `public/originkit/hero-19/` and `public/originkit/features-02/globe-icon.svg`
