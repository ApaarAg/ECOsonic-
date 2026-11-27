# ECOsonic 3.0 — ACT 04: Water (`EVERY CONTACT DISPLACES`)

## 1. Monochrome Mirror Surface Architecture

`ACT 04` concludes the physical fall of the detached leaf inside the exact same forest clearing (`CinematicStage.tsx`):

- **Geometry & Placement:** `THREE.PlaneGeometry(10.0, 4.4, 96, 64)` (`Act04WaterSurface`, `renderOrder = 1`) rotated horizontally at `y = -1.25` (`POOL_SURFACE_Y`), positioned at `z = +0.85` so its rear shoreline (`z = -1.35`) meets `MidUnderstoryPlate`'s bank rocks and ferns cleanly without horizontal edge seams.
- **Mirror-Dark Surface (`WATER_SURFACE_FRAGMENT_SHADER`):** Near-black water base (`#080808`–`#151515`) blended strictly in grayscale luminance (`deepTannin = 0.024`, `humicTone = 0.068`).

---

## 2. Planar Dual-Layer Reflection (`forest above / forest reflected below`)

Rather than mirroring generic noise or neon highlights, the water shader computes real view reflection `R = reflect(-V, N)` modulated by wave normals and ray-casts onto both backdrop planes:

1. **Far Clearing & Sky Reflection (`uForestTex`, `z = -4.0`):** Captures upside-down pale overcast mist (`#CCCCCC / #E6E2DA`) and soft distant gray trunks (`#888888`).
2. **Midground Shoreline Reflection (`uMidTex`, `z = -1.35`):** Blends alpha-masked inverted dark trunks (`#292929–#444444`), boulders, and shoreline sword ferns (`mix(bgLum, midLum, midSample.a * 0.85)`) with Schlick Fresnel dielectric response (`F0 = 0.032`).
3. **Soft Horizon & Bank Integration:** Sides fade softly toward `#080808` and far depths fade smoothly (`smoothstep(0.99, 0.64, vUv.y)`) so the water plane never exhibits rectangular quad boundaries.

---

## 3. Contact Physics, Ripple Propagation & Resting Leaf

- **Exact Impact Point (`waterState.ts`):** Controlled by `uImpactXZ = (0.04, 1.05)` coupled directly to `leafState.ts`.
- **Contact Depression & Buoyancy (`0.22 ≤ waterProgress`):** At impact (`contactThreshold = 0.22`), `waterState` drives `contactSplash` (subtle Gaussian depression in `WATER_SURFACE_VERTEX_SHADER`) and `contactImpulse`, while the leaf experiences a brief inertia dip (`impactDip = 0.012`) before rebounding calmly onto `-1.198` (`rotX = -1.32`) so its dark veined silhouette remains visibly resting ON the water mirror.
- **Asymmetric Capillary Ripples:** Both vertex displacement (`primaryFront`, softer trailing `secondaryFront`) and fragment slope normals warp circular waves gently using procedural bed asymmetry (`0.14 * cos(ang - 0.42) + 0.055 * sin(ang * 3.0 + 0.85)` + fractional Brownian motion `bedWarp`), catching muted pale-gray overcast crests (`#AAAAAA`) and shadowed troughs.
- **Pre-Acoustic Readiness (No ACT 05 Visuals Yet):** Toward late `ACT 04`, subtle `harmonicBridge` priming keeps the water surface ready for `ACT 05` without premature spectral waves or glowing effects.
- **Pre-Contact Shadow:** `uLeafShadowXZ` + `uLeafHeightAboveWater` darken the pool softly beneath the approaching leaf right before touchdown.

---

## 4. Verified Runtime Performance (`scripts/validate-reset-02-04.mjs`)

Measured headless Chromium production preview telemetry (`6/6` Vitest suites / `24` tests pass, zero console/page errors, `canvases = 1`, `drawCalls = 7`, `triangles = 17,280`, `overflowX = false`):

- **`1440×900` Desktop:** `142.9–144.9 FPS` median across all 7 beats (`p95`: `7.1–7.2 ms`, `worst`: `7.1–7.8 ms`).
- **`1920×1080` Desktop:** `142.9–144.9 FPS` median across all 7 beats (`p95`: `7.0–7.6 ms`, `worst`: `7.1–14.1 ms`).
- **`390×844` Mobile (`dpr 1.5`):** `142.9–144.9 FPS` median across all 7 beats (`p95`: `7.1–7.6 ms`, `worst`: `7.2–8.2 ms`).
- **`412×915` Mobile (`dpr 1.5`):** `142.9–144.9 FPS` median across all 7 beats (`p95`: `7.1–7.3 ms`, `worst`: `7.2–8.0 ms`).
- **`prefers-reduced-motion`:** Verified static cleanly framed poses in `ACT 02`, `ACT 03`, and `ACT 04` (`144 FPS`, `0` errors).

