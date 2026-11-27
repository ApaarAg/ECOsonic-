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

export function getValleyCenterX(z: number): number {
  return Math.sin(z * 0.028) * 12 + Math.cos(z * 0.015) * 6;
}

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

export function generateValleyPathPoints(
  numWaypoints = 36,
  loopLength = 210,
): Array<{ x: number; y: number; z: number }> {
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
