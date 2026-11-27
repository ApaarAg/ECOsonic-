# Scene 11 + Scene 12 — Shared Moving-Bird Background Integration

## 1. Imported Component Location

- Entry wrapper: `frontend/src/components/originkit/hero-13.tsx`
- Stylesheet tokens: `frontend/src/components/originkit/hero-13.css`
- UI modules under `frontend/src/components/originkit/ui/hero-13/`:
  - `section-20-hero.tsx` (`Section20Hero`)
  - `gallery-tunnel.tsx` (`GalleryTunnel` + `createGalleryTunnelController`)
  - `hero-content.tsx` (`HeroContent`)
  - `focus-reveal.tsx` (`FocusReveal`)
  - `button.tsx` (unchanged component file; unused CTA buttons removed from `HeroContent`)

---

## 2. Original Component Preserved

- Preserved `GalleryTunnel`'s 3D square corridor geometry, slab distribution (`grid = 8`, `cellMode = "square"`, `TUNNEL_WIDTH = 2`, `TUNNEL_HEIGHT = 1.8`, `BASE_SEGMENT_DEPTH = 1`, `TUNNEL_LENGTH = 15`), `PerspectiveCamera(45)`, `SCROLL_TO_Z = 0.05`, `CAMERA_CHASE = 0.1`, `FADE_IN = 1`, speed (`50`), pointer-press speed boost (`100`), fog dissolution (`fade = 100`), segment recycling, and aspect-preserving image cropping.
- Kept `FocusReveal` staggered typography transitions and `Section20Hero` layout hierarchy without introducing a new visual template or altering Scene 11's specimen plates or Scene 12's stacked observation cards.

---

## 3. Bird Asset Mapping

- Created `frontend/src/visual/ExpectedSpecies/birdTunnelAssets.ts` exporting `DEFAULT_BIRD_TUNNEL_SLIDES` and `resolveBirdTunnelSlides(expectedBaseline)`.
- Replaced all stock human portrait URLs (`/originkit/hero-13/potrait-*.png`) in `gallery-tunnel.tsx` and `section-20-hero.tsx` with verified local wildlife bird photography stored under `frontend/public/assets/specimens/` (prioritizing `1000px+` high-resolution ornithology specimens paired with focal `y` anchors matching `speciesAssetRegistry.ts`).
- When ecological baseline data is present in `acousticStore`, `resolveBirdTunnelSlides()` places matching `species_photograph` plates from Scene 11 first, then completes tunnel visual variety across `17` unique curated wildlife bird plates without reusing portraits or non-bird stock imagery.

---

## 4. Scene 11 Text

Rendered in `HeroContent` (`frontend/src/components/originkit/ui/hero-13/hero-content.tsx`) during `ACT 11 — EXPECTED SPECIES`:

- **Main Heading:** `EXPECTED SPECIES`
- **Supporting Text:** `Species expected in this ecological context based on the available acoustic and environmental evidence.`
- **Removed Template UI:** `Elevating Portraits Through Perspective`, `Thoughtfully crafted portraits...`, `Explore Gallery`, and `Book a Shoot` CTA buttons removed completely.

---

## 5. Scene 12 Text

Transitioned smoothly in-place inside `HeroContent` during `ACT 12 — OBSERVATION GAP`:

- **Main Heading:** `OBSERVATION GAP`
- **Supporting Text:** `Compare expected taxa with what was actually detected in the acoustic record.`
- Conservative ecological wording maintained (zero `Missing Species`, `Species Lost`, or `Species Absent`).

---

## 6. Shared-Background Architecture

- Integrated `createGalleryTunnelController()` from `gallery-tunnel.tsx` directly into ECOsonic's existing single `WebGLStage` (`frontend/src/visual/engine/WebGLStage.ts` via `setAfterRenderCallback`) inside `CinematicStage.tsx` (`z-0` `[data-testid="shared-scene-background"]`).
- **Single WebGL Context / Single Render Loop:** Pass 1 renders the existing `EcologicalField` (`EcologicalIntelligenceFieldLayer`) onto `#080808`; Pass 2 executes `renderer.clearDepth()` and renders the transparent-background `GalleryTunnel` bird-photo scene onto the exact same `THREE.WebGLRenderer` (`canvasCount === 1`), preserving full visibility of the underlying ecological network behind and between moving bird plates.
- **Persistent Chapter Overlay (`z-10`):** `<Section20Hero overlayOnly ... />` renders once outside `[data-testid="shared-scene-background"]` spanning both `ACT 11` and `ACT 12`, keeping `[data-testid="shared-scene-background"]` free of DOM text (`sharedBackground.test.tsx`) while preventing Scene 11 -> Scene 12 component remounts.
- Foregrounds (`ExpectedSpeciesScene` and `ObservationGapScene`) sit above in `z-10` with transparent backgrounds (`bg-transparent`) and calibrated responsive margins (`pt-[198px] md:pt-20`).

---

## 7. Transition Verification

- Scrolling or jumping between `ACT_11_EXPECTED_SPECIES` and `ACT_12_OBSERVATION_GAP` (`validate-scene11-12-moving-birds.mjs` and `movingBirdBackground.test.tsx`) verified:
  - Identical `<canvas>` DOM node (`sameCanvasInstance: true`) with zero WebGL teardown/reload.
  - Identical `[data-testid="shared-hero13-chapter"]` DOM element (`sameChapterContainer: true`) continuously visible across the transition boundary (`smoothstep(0.882, 0.918, g)` envelope into Acts 11–12).
  - Stable `slideKey` across Scene 11 -> Scene 12 avoids duplicate texture requests (`birdTextureCount: 18`, `portraitRequestCount: 0`).

---

## 8. Responsive Verification

Validated across desktop and mobile aspect ratios (`1440×900`, `1920×1080`, `390×844`, `412×915`):

- On `>= 768px` (`md:`), `Section20Hero` anchors `EXPECTED SPECIES` / `OBSERVATION GAP` unobtrusively at bottom-left (`md:items-start md:justify-end md:pb-7 md:pl-8 xl:pl-12`), clear of the top masthead, center specimens/cards, and bottom-center ledger/disclaimers.
- On `< 768px` (`390×844`, `412×915`), `Section20Hero` anchors compactly beneath the fixed acoustic header (`pt-[122px]`) while Scene 11/12 content starts at `pt-[198px]`, avoiding collisions and keeping horizontal overflow at `0px`.

---

## 9. Performance Observations

- Reusing ECOsonic's existing single `WebGLStage` renderer avoids spawning a second WebGL context or second `requestAnimationFrame` loop.
- `gallery-tunnel.tsx` loads each bird specimen texture once (`LinearFilter`, `generateMipmaps = false`), recycles pooled segment meshes in place, and caches materials by `${url}|${y}`.
- Only `18` curated local `/assets/specimens/*.jpg` files loaded during Scene 11 -> Scene 12 traversal (`0` duplicate fetches during transition, `0` failed asset loads).
- Under `prefers-reduced-motion: reduce`, tunnel translation speed pauses cleanly (`reducedMotion` parameter in `renderFrame`) while preserving crisp depth framing and readable text.

---

## 10. Build Result

- `npm --prefix frontend run build` (`tsc -b && vite build`): **Passed** (`519 modules transformed`, `✓ built in 7.31s`, zero TypeScript or bundle errors).

---

## 11. Test Result

- `npm --prefix frontend test` (`vitest run`): **Passed** — **18 test files passed, 84 tests passed** (including `src/test/movingBirdBackground.test.tsx`, `src/test/sharedBackground.test.tsx`, `src/test/expectedSpeciesScene.test.tsx`, `src/test/observationGapScene.test.tsx`, `src/tests/api.test.ts`, and `src/tests/services.test.ts`).

---

## 12. Browser QA Result

Executed `node frontend/scripts/validate-scene11-12-moving-birds.mjs` and `node frontend/scripts/validate-scene12-observation-gap.mjs` in headless Chromium (`playwright-core`, screenshots captured under `docs/audit_evidence/scene11_12_moving_bird_background/`):

| Viewport / Mode | Canvas Count | Shared Canvas & Chapter Preserved | Bird Textures / Portraits | Overflow | Errors |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `1440×900` (Desktop) | `1` | Yes / Yes | `18` / `0` | `0px` | `0` |
| `1920×1080` (Desktop) | `1` | Yes / Yes | `18` / `0` | `0px` | `0` |
| `390×844` (Mobile) | `1` | Yes / Yes | `18` / `0` | `0px` | `0` |
| `412×915` (Mobile) | `1` | Yes / Yes | `18` / `0` | `0px` | `0` |
| `1440×900` (`prefers-reduced-motion: reduce`) | `1` | Yes / Yes | `18` / `0` | `0px` | `0` |
