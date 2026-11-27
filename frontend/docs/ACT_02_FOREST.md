# ECOsonic 3.0 — ACT 02: Forest (`THE LIVING FIELD`)

## 1. Visual Composition

`ACT 02` establishes a foggy backlit coastal woodland hollow framed by irregular tree silhouettes and soft misty light before human observation isolates any single detail.

### Spatial Layers (`src/visual/Cinematic/CinematicStage.tsx`)

1. **`BgCanopyPlate` (`14.0 × 9.2`, `z = -4.0`, `parallaxFactor = 0.14`):** Full-bleed `1920×1280` WebP (`plate-bg-canopy.webp`, `248,082` bytes) featuring a pale parchment-gray radial clearing (`#E6E2DA → #CCCCCC → #6E6E6E`), feathered overcast mist puffs, and six asymmetrically spaced distant trunks (`#767676–#A0A0A0`) with organic forked canopy boughs and soft silhouette foliage.
2. **`MidUnderstoryPlate` (`7.6 × 5.7`, `y = 0.64`, `z = -1.35`, `parallaxFactor = 0.55`):** Transparent `1920×1440` WebP (`plate-mid-understory.webp`, `122,058` bytes) with framing medium-gray trunks (`#404040–#444444`), outer charcoal trunks (`#222222–#242424`) extending continuously below the bank, forked boughs, moss wisps, shoreline boulders (`y ≈ -1.25`), and sword ferns.
3. **`BranchLeavesPlate` (`4.5 × 2.7`, `y = 0.88`, `z = +0.16`, `parallaxFactor = 0.88`):** Crisp `1600×960` WebP (`plate-branch-leaves.webp`, `58,072` bytes) rendering the main overarching gnarled branch (`#0B0B0B`) from upper-right across the clearing, nine connected monochrome leaves via curved organic shoots, and the drooping twig socket at `(0.56, 0.40)` (`world ≈ (0.27, 1.15)`).
4. **`FgFernsPlate` (`6.2 × 3.6`, `y = -0.18`, `z = +1.45`, `parallaxFactor = 1.48`):** Pitch-black foreground boulders, corner sword ferns (`#050505–#080808`), and upper-right framing leaf.
5. **Atmospheric Mist (`Points`, `renderOrder = 3`):** Subtle monochrome mist particles (`180` desktop / `63` mobile via `viewportBudget.ts`), kept quiet (`#D6D6D6`–`#ADADAD` luminance) without glowing flares.

---

## 2. Subtle Life & Motion

- **Shader Sway (`FOREST_PLATE_VERTEX_SHADER`):** Gentle layered sway (`sin(uTime * 0.68)` + `cos(uTime * 0.41)`) stronger at outer tip masks (`swayAmount: 0.06..0.62`), zeroed when `prefers-reduced-motion` sets `uMotionScale = 0`.
- **2.5D Pointer Parallax & Camera Discovery:** `forestState.ts` applies damped pointer/drift smoothing; near the end of `ACT 02`, `director.weights.leafAttention` subtly nudges camera focus (`+0.14` Y, `-0.22` Z) toward the arching branch and attached hero leaf.

---

## 3. Typography & Navigation

- Title overlay: `THE LIVING FIELD` in `Instrument Serif` (`#F2F0EA`), bottom-left above foreground dark anchor.
- `EditorialShell` (`src/ui/EditorialShell.tsx`) keeps navigation minimal and strictly monochrome (`#F2F0EA` active, `#AAAAAA` inactive, `#080808` top gradient scrim).

