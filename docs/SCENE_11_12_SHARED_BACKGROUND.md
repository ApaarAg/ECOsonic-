# ECOsonic — Scene 11 & Scene 12 Shared Background Visual Layer

**Scope:** Persistent shared background visual layer spanning **ACT 11 — EXPECTED SPECIES** → **ACT 12 — OBSERVATION GAP**  
**Status:** Implemented & Verified

---

## 1. Implementation Architecture

The shared background is owned by the persistent parent stage (`frontend/src/visual/Cinematic/CinematicStage.tsx`) and integrated directly into the single existing Three.js WebGL context (`frontend/src/visual/engine/WebGLStage.ts`).

```text
CinematicPage (sticky 100dvh viewport)
└─ CinematicStage
   ├─ Shared Background Layer (`div[data-testid="shared-scene-background"]`, fixed inset-0 z-0 pointer-events-none)
   │  ├─ `.ecosonic-atmosphere` (subtle obsidian/moss radial atmosphere behind canvas)
   │  ├─ WebGLStage canvas host (`div[data-testid="cinematic-canvas-host"]`)
   │  │  └─ Layer 6: `EcologicalIntelligenceFieldLayer` (Three.js Points, LineSegments, LineLoop)
   │  ├─ `.ecosonic-grain` (subtle SVG filmic grain texture)
   │  └─ `.ecosonic-vignette` (compositional edge darkening for foreground legibility)
   └─ Foreground Content (`z-10`, transparent outer containers)
      ├─ Scene 11: `ExpectedSpeciesScene` (`bg-transparent`)
      └─ Scene 12 (future): `ObservationGap` foreground content above the same z-0 layer
```

Key architectural invariants:
- **Zero text:** The background container (`[data-testid="shared-scene-background"]`) and its WebGL shaders/geometries contain zero text, headings, labels, numbers, logos, or captions (`bgTextLength === 0`).
- **Fixed full-viewport container:** Styled with `position: fixed; top: 0; left: 0; width: 100%; height: 100vh; overflow: hidden; z-index: 0; pointer-events: none;`.
- **Foreground transparency:** `ExpectedSpeciesScene` (`frontend/src/visual/ExpectedSpecies/ExpectedSpeciesScene.tsx`) uses `bg-transparent` and a restrained radial readability scrim (`rgba(6, 8, 7, 0.06)` → `rgba(3, 4, 4, 0.48)`) instead of the previous opaque `bg-[#000000]/96` + `0.99` black radial cover.

---

## 2. Visual Asset / Layer Used & Rationale

- **Selected Visual Implementation:** Procedural WebGL/Three.js **Ecological Intelligence Field** (`frontend/src/visual/EcologicalField/ecologicalFieldEngine.ts` + `ecologicalFieldShaders.ts`), rendered inside the single existing `WebGLStage` context.
- **Why It Was Selected:**
  - The repository contains no pre-approved video asset for this sequence (only test/audit recordings under `frontend/docs/screenshots/`), and importing external agency template videos risks embedded text, mismatched aesthetics, and extra decoding overhead.
  - Using `WebGLStage` preserves ECOsonic's single-WebGL-context, single-`requestAnimationFrame` architecture without introducing a second renderer or `<video>` decoder pipeline.
  - Visually renders an undulating 3D organic bioacoustic manifold composed of:
    1. **Particle field** (`Points`): deterministic Fibonacci/golden-ratio harmonic manifold across obsidian/graphite-lichen (`#26362E`), desaturated forest moss (`#52705C`), and restrained warm ochre (`#8F6B40`) tiers.
    2. **Connected lattice filaments** (`LineSegments`): spatial connections between neighboring nodes forming an organic ecological structure.
    3. **Organic contour strata** (`LineLoop`): 4 (mobile) to 6 (desktop) undulating topological wave contours.
    4. **Resonant beacon nodes** (`Points`): low-intensity pulsing hub points in restrained warm ochre-moss.

---

## 3. Persistence Strategy (ACT 11 → ACT 12)

- `EcologicalIntelligenceFieldLayer` is created once during `WebGLStage` initialization inside `CinematicStage.tsx` and never unmounted or recreated when changing acts or scrolling.
- `CinematicTransition.ts` smoothly ramps `ecologicalFieldOpacity` (`smoothstep(0.895, 0.935, g)`) as the Act 10 Ecological Context Globe fades out (`1 - smoothstep(0.912, 0.945, g)`).
- In `CinematicStage.tsx`'s frame loop, `isSharedFieldAct` matches both `ACT_11_EXPECTED_SPECIES` / `EXPECTED SPECIES` and `OBSERVATION GAP` (Scene 12), maintaining `opacity = 1.0` and uninterrupted `masterTime` progression across the Act 11 → Act 12 boundary.
- `isFieldBackdrop` and the compositional `.ecosonic-vignette` remain active across both `"EXPECTED SPECIES"` and `"OBSERVATION GAP"`.
- Verified in browser continuity checks that transitioning from Act 11 to `scrollToProgress(1.0)` preserves the exact same `[data-testid="shared-scene-background"]` DOM node, the exact same `<canvas>` element, and the exact same WebGL context (`sameBgNode: true`, `sameCanvasNode: true`, `sameWebGLContext: true`).

---

## 4. Performance Result

- **Single WebGL Context & Single RAF Loop:** Confirmed `canvasCount === 1` across all tested viewports (`1440×900`, `1920×1080`, `390×844`, `412×915`) and after Act 11 → Act 12 transition. No duplicate WebGL contexts or secondary animation loops were introduced.
- **Bounded Viewport Budgets (`frontend/src/visual/engine/viewportBudget.ts` — `getEcologicalFieldBudget`):**
  - **Desktop (`>= 1024px`):** `nodeCount = 1280`, `maxFilaments = 620`, `6` contour strata, `maxDpr = 2.0` (`points = 1290`, `lines = 1388`, `drawCalls = 9` in SwiftShader headless validation).
  - **Tablet (`768px–1023px`):** `nodeCount = 720`, `maxFilaments = 340`, `maxDpr = 1.75`.
  - **Mobile (`< 768px`):** `nodeCount = 380`, `maxFilaments = 160`, `4` contour strata, `maxDpr = 1.5` (`points = 384`, `lines = 496`, `drawCalls = 7` in SwiftShader headless validation).
- **Note on headless FPS:** Headless validation uses Chromium software SwiftShader (`--use-angle=swiftshader`); desktop reported `16 FPS` at `1440×900` (`64.27 ms`) and `5 FPS` at `1920×1080` (`194.4 ms`), while mobile viewports reported `22 FPS` (`45.13 ms`) at `390×844` and `21 FPS` (`47.98 ms`) at `412×915`. Hardware GPU rendering runs in the single `WebGLStage` frame loop with bounded geometry counts.

---

## 5. Reduced-Motion Behavior

- `CinematicStage` passes `reducedMotion` (from `useReducedMotion()` observing `(prefers-reduced-motion: reduce)`) to `ecologicalFieldLayer.update(dt, targetEcoOpacity, reduced)`.
- When `reducedMotion` is `true`:
  - `motionScale` is set to `0.0`, freezing `masterTime`, vertex harmonic displacement, beacon pulsing, and group rotation in a calm static composition.
  - Camera lerp snaps cleanly (`camLerp = 1`) without animated drift.
  - Global CSS (`frontend/src/styles/ecosonic.css`) collapses CSS transitions (`0.01ms !important`), including the vignette opacity transition.
- Verified with Playwright `page.emulateMedia({ reducedMotion: "reduce" })` (`reducedMotionMatch: true`, `bgExists: true`, `bgTextLength: 0`, `canvasCount: 1`).

---

## 6. Viewport & Automated Validation

### Vitest & Build
- `npm --prefix frontend run build` (`tsc -b && vite build`): **PASS** (`0` TypeScript errors, `79` modules transformed).
- `npm --prefix frontend test` (`vitest run`): **PASS** (`16` test files, `76` tests passed — including `src/test/sharedBackground.test.tsx`).

### Playwright Browser Validation (`frontend/scripts/validate-scene11-12-background.mjs`)
Evidence stored in `docs/audit_evidence/scene11_12_shared_background/validation_summary.json` and viewport screenshots:

| Viewport | `position` / `zIndex` | Background Text | Scene 11 Transparent | Specimens / Interactive | Broken Assets | Console Errors | Horizontal Overflow | Continuity (Same Node & GL) |
|---|---|---|---|---|---|---|---|---|
| `1440×900` | `fixed` / `0` | `0` chars | `true` (`rgba(0, 0, 0, 0)`) | `8` / `true` | `0` | `0` | `false` | `true` (`1` canvas) |
| `1920×1080` | `fixed` / `0` | `0` chars | `true` (`rgba(0, 0, 0, 0)`) | `8` / `true` | `0` | `0` | `false` | `true` (`1` canvas) |
| `390×844` | `fixed` / `0` | `0` chars | `true` (`rgba(0, 0, 0, 0)`) | `4` / `true` | `0` | `0` | `false` | `true` (`1` canvas) |
| `412×915` | `fixed` / `0` | `0` chars | `true` (`rgba(0, 0, 0, 0)`) | `4` / `true` | `0` | `0` | `false` | `true` (`1` canvas) |

*(Plus `prefers-reduced-motion: reduce` at `1440×900`: `bgExists: true`, `bgTextLength: 0`, `canvasCount: 1`.)*
