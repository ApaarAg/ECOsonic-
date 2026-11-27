# ECOsonic 3.0 — Acts 01–10 Unified Scroll Integration Architecture

## Overview

Acts 01 through 10 (`BLACKNESS → FOREST → LEAF → WATER → SOUND → ACOUSTIC FIELD → SPECIES → DISTURBANCE → SILENCE → ECOLOGICAL CONTEXT`) execute as **one continuous single-page scroll experience** driven by a single document scroll range (`960vh`), one sticky full-viewport stage (`h-dvh`), one Three.js `WebGLRenderer`, one `requestAnimationFrame` loop, and at most one shared Web Audio `AudioContext`.

## Key Modules

1. **[CinematicTimeline.ts](file:///c:/Users/apaar/Desktop/frontend/src/cinematic/CinematicTimeline.ts)**
   - Maps normalized `scrollProgress` `[0..1]` deterministically across `TIMELINE_SEGMENTS` for Acts `01`–`10` with contiguous boundaries and `resolveForestWaterPhase` synchronization.
2. **[CinematicTransition.ts](file:///c:/Users/apaar/Desktop/frontend/src/cinematic/CinematicTransition.ts)**
   - Evaluates continuous physics, lighting, camera, and soundscape transition parameters across Act boundaries without opaque page cuts or naive crossfades:
     - `01 → 02`: subtle pre-emergence sound trace illumination into old-growth trunks & misty clearing
     - `02 → 03`: optical canopy push onto overhanging broadleaf twig + attached *Alnus glutinosa* leaf -> petiole flex/detachment
     - `03 → 04`: downward camera tracking into monochrome planar forest reflection pool (present prior to water contact at `WATER_CONTACT_PROGRESS = 0.14`)
     - `04 → 05`: expanding pool impact ripple seeding airborne acoustic particles into 3D frequency strata
     - `05 → 06 → 07 → 08 → 09 → 10`: spherical acoustic convergence -> BirdNET/demo biological localization -> physical wave shear -> field damping -> spatial ecological globe reveal
3. **[CinematicState.ts](file:///c:/Users/apaar/Desktop/frontend/src/cinematic/CinematicState.ts)** & **[CinematicScrollController.ts](file:///c:/Users/apaar/Desktop/frontend/src/cinematic/CinematicScrollController.ts)**
   - Adaptive exponential scroll inertia updated inside the single `WebGLStage` rAF tick, supporting forward/backward scrubbing, smooth nav-bar anchor scrolling, voluntary play/pause `SEQUENCE` traversal (yielding automatically upon manual user wheel/touch), mid-page scroll restoration, and instant snapping when `prefers-reduced-motion: reduce` is active.
4. **[CinematicAudioTimeline.ts](file:///c:/Users/apaar/Desktop/frontend/src/cinematic/CinematicAudioTimeline.ts)** & **[sharedAudioContext.ts](file:///c:/Users/apaar/Desktop/frontend/src/api/sharedAudioContext.ts)**
   - Guarantees `<= 1` global `AudioContext` instance across continuous filtered ambient evolution and live Web Audio `AudioWorklet` microphone capture.
5. **Monochrome Forest Realism (`src/visual/Forest/forestShaders.ts` & `src/visual/Cinematic/CinematicStage.tsx`)**
   - Combines photographic old-growth temperate forest structure (`src/assets/forest/hoh-old-growth.webp` + `hoh-old-growth-depth.webp`) with a pure charcoal/silver-gelatin monochrome grade (`R === G === B`), 2.5D depth parallax, drifting canopy mist rays, overhanging foreground bough anchoring the botanical photographic leaf (`src/assets/leaf/hero-leaf-albedo.webp`), blurred foreground ferns, and real-time planar pool reflection (`reflRT`).
