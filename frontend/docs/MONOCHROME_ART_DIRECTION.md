# ECOsonic 3.0 — Monochrome Art Direction (`ACT 02`–`ACT 04`)

## 1. Visual Language & Palette Philosophy

The prior dark-color photographic and stylized treatments were superseded by a unified **Monochrome Cinematic Silhouette Animation System** inspired by ink-wash / layered paper cutout cinema.

### Allowed Value Range (Zero Chromatic Hues)

All WebGL layers (`BgCanopyPlate`, `MidUnderstoryPlate`, `BranchLeavesPlate`, `FgFernsPlate`, `HeroLeaf`, `WaterSurface`, `ForestMist`), 2D raster plates (`src/assets/stylized/*.webp`), and `ACT 01`–`ACT 04` editorial UI overlays operate exclusively on pure luminance values within the monochrome palette:

- `#000000` / `#080808` — Near-black foreground silhouettes, bank corners, hero leaf outer silhouette, deep water shadow, stage background clear color (`0x080808`)
- `#151515` / `#292929` / `#444444` — Midground tree trunks, tangled branches, shoreline boulders, mirror water body, leaf lamina mid-tones
- `#666666` / `#888888` / `#AAAAAA` — Soft distant gray tree silhouettes, fine leaf venation & edge catches, misty depth veil, quiet UI metadata
- `#CCCCCC` / `#E6E2DA` / `#F2F0EA` / `#FFFFFF` — Pale backlit overcast forest clearing mist (`plate-bg-canopy.webp`), reflected pale sky glow on water ripples, crisp `Instrument Serif` editorial typography

Shader enforcement converts all RGB samples via luminance dot-product (`dot(rgb, vec3(0.299, 0.587, 0.114))`) in `FOREST_PLATE_FRAGMENT_SHADER`, `HERO_LEAF_FRAGMENT_SHADER`, and `WATER_SURFACE_FRAGMENT_SHADER` so chromatic drift is impossible.

---

## 2. Silhouette Depth Hierarchy

```text
Layer 4 (z = -4.0)  BgCanopyPlate       Pale overcast sky (#E6E2DA / #CCCCCC) + feathered mist shafts
Layer 3 (z = -4.0)  Distant Forest      Asymmetric far trunks (#808080–#A0A0A0) with soft optical canopy silhouettes
Layer 2 (z = -1.35) MidUnderstoryPlate  Charcoal/gray trunks (#222222–#444444), gnarled limbs, hanging moss, shoreline rocks & ferns
Layer 1 (z = +0.16) BranchLeavesPlate   Dark arching foreground branch (#0B0B0B) + nine broadleaves framing empty hero socket
Hero    (z = 0.185) Act03HeroLeafGroup  3D corrugated dark broadleaf silhouette (#080808 / #161616–#333333 / veins #555555–#777777)
Water   (y = -1.25) Act04WaterSurface   Mirror-dark planar reflective pool reflecting both Layer 4/3 mist and Layer 2 silhouettes
Layer 0 (z = +1.45) FgFernsPlate        Pitch-black framing boulders, sword ferns & upper-right silhouette leaf (#000000–#080808)
```

---

## 3. Shared Atmosphere, Film Grain & Edge Integration

- **Backlit Clarity:** Placing `#CCCCCC`–`#E6E2DA` pale clearing mist behind darker silhouette planes eliminates black-on-black contrast loss while retaining documentary restraint.
- **Film Grain:** Baked grayscale micro-grain in the generator (`applyMonoGrain`) paired with real-time animated screen grain (`monoGrainHash` at `12 Hz` modulated by `uMotionScale`) unifies 2D planes and 3D hero geometry.
- **Editorial Contrast Scrims:** Soft GPU header (`headerScrim`) and lower-left (`cornerScrim`) dark veils in `FOREST_PLATE_FRAGMENT_SHADER` plus `EditorialShell.tsx` monochrome gradient scrims preserve white `#F2F0EA` readability over bright mist without CSS overlay chrome.
- **Single-Stage Discipline:** Rendered inside a single `WebGLStage` context (`7` draw calls across `ACT 02`–`ACT 04`, `17,280` triangles, single `requestAnimationFrame` loop).

