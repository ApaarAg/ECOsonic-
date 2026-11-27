export interface ScrollerState {
  targetProgress: number;
  currentProgress: number;
  velocity: number;
  autoDriftSpeed: number;
  hoverAmount: number;
  hoverTarget: number;
}

export interface ScrollerStepResult {
  progress: number;
  speed: number;
  vignetteTightness: number;
  hoverAmount: number;
}

export const TOUCH_SCROLL_MULTIPLIER = 20;
export const WHEEL_SCROLL_SCALE = 0.00018;
export const DEFAULT_AUTO_DRIFT_SPEED = 0.0095;

export function createSeededRandom(seed = 42197): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function wrapUnit(value: number): number {
  const mod = value % 1;
  return mod < 0 ? mod + 1 : mod;
}

export function hash2D(ix: number, iz: number): number {
  const n = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

export function valueNoise2D(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);

  const a = hash2D(ix, iz);
  const b = hash2D(ix + 1, iz);
  const c = hash2D(ix, iz + 1);
  const d = hash2D(ix + 1, iz + 1);

  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
}

export function fbm2D(x: number, z: number): number {
  return (
    valueNoise2D(x, z) * 0.58 +
    valueNoise2D(x * 2.07 + 13.1, z * 2.07 - 7.4) * 0.28 +
    valueNoise2D(x * 4.19 - 5.3, z * 4.19 + 19.8) * 0.14
  );
}

/**
 * Valley centerline X offset as a function of Z along the winding valley.
 */
export function getValleyCenterX(z: number): number {
  return Math.sin(z * 0.028) * 12 + Math.cos(z * 0.015) * 6;
}

/**
 * Rolling night valley terrain heightmap.
 * Forms a deep concave amphitheater bowl so dense foliage sweeps up both flanks
 * while leaving a dark night sky opening at the top-center.
 */
export function getTerrainHeight(x: number, z: number): number {
  const centerX = getValleyCenterX(z);
  const dx = x - centerX;
  const valleyWall = Math.pow(Math.abs(dx) * 0.036, 1.82) * 10.5;
  const rollingHills =
    Math.sin(x * 0.068 + z * 0.042) * 1.25 +
    Math.cos(z * 0.058 - x * 0.038) * 1.05 +
    Math.sin((x + z) * 0.13) * 0.32;
  const microUndulation = Math.cos(x * 0.31) * Math.sin(z * 0.27) * 0.16;
  return valleyWall + rollingHills + microUndulation - 3.6;
}

/**
 * Computes flower bloom scale (0..1) as the point approaches the camera,
 * matching the engine behavior where flowers bloom from tiny buds near the horizon
 * to full blossoms as they draw closer.
 */
export function computeFlowerBloomScale(
  distanceToCamera: number,
  bloomStartDist = 68,
  bloomFullDist = 18,
): number {
  if (distanceToCamera >= bloomStartDist) return 0.12;
  if (distanceToCamera <= bloomFullDist) return 1.0;
  const t = 1 - (distanceToCamera - bloomFullDist) / (bloomStartDist - bloomFullDist);
  return 0.12 + 0.88 * smoothstep(0, 1, t);
}

/**
 * Computes leaf scale: leaves grow in further back along the valley slopes.
 */
export function computeLeafGrowthScale(
  distanceToCamera: number,
  nearFade = 8,
  peakDist = 42,
  farFade = 92,
): number {
  if (distanceToCamera <= nearFade || distanceToCamera >= farFade) return 0;
  if (distanceToCamera < peakDist) {
    return smoothstep(nearFade, peakDist, distanceToCamera);
  }
  return 1 - smoothstep(peakDist, farFade, distanceToCamera) * 0.75;
}

/**
 * Computes screen-space mouse repulsion offset for a projected NDC point.
 */
export function computeScreenRepulsion(
  ndcX: number,
  ndcY: number,
  mouseNdcX: number,
  mouseNdcY: number,
  aspect: number,
  radius = 0.42,
  strength = 0.19,
): { offsetX: number; offsetY: number; glow: number } {
  const dx = (ndcX - mouseNdcX) * aspect;
  const dy = ndcY - mouseNdcY;
  const dist = Math.hypot(dx, dy);
  if (dist >= radius || dist < 1e-5) {
    return { offsetX: 0, offsetY: 0, glow: 0 };
  }
  const falloff = Math.pow(1 - dist / radius, 2.2);
  const nx = dx / dist;
  const ny = dy / dist;
  return {
    offsetX: (nx * falloff * strength) / Math.max(aspect, 0.2),
    offsetY: ny * falloff * strength,
    glow: falloff,
  };
}

export function createInitialScrollerState(): ScrollerState {
  return {
    targetProgress: 0,
    currentProgress: 0,
    velocity: 0,
    autoDriftSpeed: DEFAULT_AUTO_DRIFT_SPEED,
    hoverAmount: 0,
    hoverTarget: 0,
  };
}

export function applyWheelDelta(state: ScrollerState, deltaY: number): void {
  state.targetProgress += deltaY * WHEEL_SCROLL_SCALE;
}

export function applyTouchDelta(state: ScrollerState, deltaY: number): void {
  // Original engine uses a 20x touch multiplier relative to base scroll
  state.targetProgress += deltaY * WHEEL_SCROLL_SCALE * TOUCH_SCROLL_MULTIPLIER;
}

export function stepScroller(state: ScrollerState, dt: number): ScrollerStepResult {
  const clampedDt = clamp(dt, 0.001, 0.1);
  state.hoverAmount = damp(state.hoverAmount, state.hoverTarget, 3.6, clampedDt);

  // Hover transition eases camera flight to a stop
  const flightScale = 1 - state.hoverAmount;
  state.targetProgress += state.autoDriftSpeed * clampedDt * flightScale;

  const prev = state.currentProgress;
  state.currentProgress = damp(
    state.currentProgress,
    state.targetProgress,
    4.8 - state.hoverAmount * 2.2,
    clampedDt,
  );

  const rawSpeed = Math.abs(state.currentProgress - prev) / clampedDt;
  state.velocity = damp(state.velocity, rawSpeed, 8.0, clampedDt);

  // Vignette tightens as you move faster
  const normalizedSpeed = clamp(
    (state.velocity - DEFAULT_AUTO_DRIFT_SPEED) / 0.08,
    0,
    1,
  );
  const vignetteTightness = 0.34 + normalizedSpeed * 0.42;

  return {
    progress: wrapUnit(state.currentProgress),
    speed: state.velocity,
    vignetteTightness,
    hoverAmount: state.hoverAmount,
  };
}

/**
 * Generates closed-loop valley camera waypoints gliding along the flower valley floor.
 */
export function generateValleyPathPoints(numWaypoints = 36, loopLength = 210): Array<{ x: number; y: number; z: number }> {
  const points: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < numWaypoints; i++) {
    const t = i / numWaypoints;
    const angle = t * Math.PI * 2;
    const z = -Math.sin(angle) * (loopLength * 0.44);
    const x = getValleyCenterX(z) + Math.cos(angle) * 5.2;
    const groundY = getTerrainHeight(x, z);
    const hoverHeight = 5.4 + Math.sin(angle * 3.0) * 0.65 + Math.cos(angle * 2.0) * 0.35;
    points.push({
      x,
      y: groundY + hoverHeight,
      z,
    });
  }
  return points;
}
