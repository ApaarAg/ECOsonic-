# ECOsonic 3.0 — ACT 03: Leaf (`DETACHMENT`)

## 1. Visual Integration Inside the Forest

The hero leaf (`Act03HeroLeafGroup`) is NOT an unrelated post-overlay asset—it is generated inside the exact same pipeline (`scripts/generate-stylized-ecology-plates.mjs`) as `plate-branch-leaves.webp`:

- **Assets:** `hero-leaf-albedo.webp` (`1024×1400`, `102,584` bytes) and Sobel normal/thickness map `hero-leaf-detail.webp` (`117,038` bytes).
- **Geometry:** `THREE.PlaneGeometry(0.38, 0.52, 36, 48)` deformed physically in `HERO_LEAF_VERTEX_SHADER` with herringbone plicate corrugation, central midrib taper, spoon bowl camber, petiole stem curvature, and velocity-coupled laminar tip flex (`uFlutterFlex`).
- **Monochrome Shading (`HERO_LEAF_FRAGMENT_SHADER`):** Pure grayscale luminance (`#080808` serrated outer silhouette, `#161616–#333333` body, `#555555–#777777` primary/secondary veins, `#999999` soft wet rim highlight), paler abaxial underside (`lum * 1.32 + 0.11`) visible during aerodynamic roll/tilt, backlit translucent clearing scatter (`sssTint`), branch socket occlusion (`uCamouflage`), and atmospheric mist veil blending at soft silhouette edges.

---

## 2. Deterministic Aerodynamic Trajectory (`src/visual/Leaf/leafState.ts`)

Instead of linear or parabolic interpolation, `evaluateLeafCinematics` integrates a fixed-substep (`1/90s` over `6.4s` flight) deterministic model from `[0..1]` act progress anchored at `DEFAULT_ANCHOR` (`startX: 0.168`, `startY: 0.928`, `startZ: 0.185`):

1. **Detachment & Wind Quiver (`0.00 → 0.16`):** Leaf remains attached to the drooping twig socket, catching wind oscillation (`Math.sin(clock * 1.85)`) with gentle petiole strain (`preSnap`) before snapping cleanly off the branch node.
2. **Brief Release Hesitation (`0.16 → 0.28`, `'drop'`):** Initial low vertical velocity accelerates under downward gravity (`-0.56`) before aerodynamic pressure builds.
3. **Aerodynamic Flutter & Lateral Drift (`0.28 → 0.62`, `'float'`):** Broadside air resistance (`0.38 + 0.60 * broadside`) opposes gravity via lift cushion and multi-octave `deterministicAirField` currents, tilting from vertical hanging pose (`rotZ: 2.66 rad`) through horizontal sail glide (`rotX` / `rotY` roll showing paler underside).
4. **Water Approach & Pre-Contact Slowing (`0.62 → 1.00`, `'approach' → 'water_approach'`):** Vertical terminal clamp (`[-0.46, 0.16]`), perspective advance toward impact depth (`z = 1.05`), leveling orientation (`rotX → -1.14 → -1.28`), and air cushion damping down to `y ≈ -1.20` just above the pool mirror.

### Reduced Motion Behavior

Under `prefers-reduced-motion: reduce`:
- In `ACT 02` (`p < 0.04`), the leaf rests attached on the branch socket (`anchor.startX/Y/Z`).
- In `ACT 03` (`0.04 ≤ p ≤ 0.85`), the leaf is presented statically mid-clearing (`(0.05, 0.15, 1.55)`), advancing statically to pre-contact approach near `p > 0.85`.

---

## 3. Continuous Discovery-Follow Camera

`CinematicStage.tsx` eases camera follow (`pFollow`, active cleanly after detachment `p > 0.14`) from upper canopy framing `(0.08, 0.60, 4.93)` downward to pool contemplation framing `(0.0, -0.34, 4.05)` looking toward `(0.04, -1.14, 0.92)` with aspect-aware portrait pullback (`mobilePullback = max(0, 1.0 - aspect) * 2.75`) so no hard cuts ever occur between `ACT 02`, `ACT 03`, and `ACT 04`.

