export const ECOLOGICAL_FIELD_NODE_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform float uMotionScale;
uniform float uPixelRatio;
uniform float uPointScale;

attribute float aPhase;
attribute float aTier;      // 0 = deep graphite-moss, 1 = desaturated sage/moss, 2 = restrained warm ochre
attribute float aSize;
attribute float aSeed;

varying float vTier;
varying float vDepth;
varying float vPhase;

void main() {
  vTier = aTier;
  vPhase = aPhase;

  vec3 pos = position;

  // Slow, continuous harmonic organic undulation
  float t = uTime * 0.22;
  float motion = uMotionScale;
  pos.y += sin(t * 1.15 + aPhase + pos.x * 0.45) * 0.16 * motion;
  pos.x += cos(t * 0.85 + aPhase * 1.3 + pos.z * 0.35) * 0.12 * motion;
  pos.z += sin(t * 0.95 + aSeed * 6.28318) * 0.14 * motion;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // Attenuate size & brightness smoothly across 3D depth
  float depthDistance = max(1.0, -mvPosition.z);
  vDepth = clamp((depthDistance - 3.0) / 7.5, 0.0, 1.0);

  float pointSize = uPointScale * aSize * (28.0 / depthDistance) * uPixelRatio;
  gl_PointSize = clamp(pointSize, 1.8, 22.0);
}
`;

export const ECOLOGICAL_FIELD_NODE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform float uOpacity;
uniform float uTime;
uniform float uMotionScale;

varying float vTier;
varying float vDepth;
varying float vPhase;

void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord);
  if (dist > 0.5) discard;

  // Soft natural point halo with subtle core
  float radial = smoothstep(0.5, 0.06, dist);
  float core = smoothstep(0.22, 0.0, dist) * 0.55;
  float intensity = radial * 0.72 + core;

  // ECOsonic restrained natural palette (obsidian/graphite, desaturated moss, muted ochre)
  vec3 colTier0 = vec3(0.15, 0.21, 0.18); // dark graphite-lichen
  vec3 colTier1 = vec3(0.32, 0.44, 0.36); // desaturated moss green
  vec3 colTier2 = vec3(0.56, 0.42, 0.25); // restrained warm ochre

  vec3 col = colTier0;
  float baseAlpha = 0.42;

  if (vTier > 1.5) {
    col = colTier2;
    baseAlpha = 0.62;
  } else if (vTier > 0.5) {
    col = colTier1;
    baseAlpha = 0.52;
  }

  // Gentle organic breathing modulation
  float pulse = 0.82 + 0.18 * sin(uTime * 0.6 + vPhase) * uMotionScale;
  baseAlpha *= pulse;

  // Soft depth attenuation into obsidian background
  float fog = 1.0 - smoothstep(0.25, 0.98, vDepth) * 0.72;
  float finalAlpha = intensity * baseAlpha * fog * uOpacity;

  if (finalAlpha < 0.004) discard;

  gl_FragColor = vec4(col, finalAlpha);
}
`;

export const ECOLOGICAL_FILAMENT_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform float uMotionScale;

attribute float aAlpha;
attribute float aPhase;

varying float vAlpha;
varying float vDepth;

void main() {
  vAlpha = aAlpha;

  vec3 pos = position;
  float t = uTime * 0.22;
  float motion = uMotionScale;
  pos.y += sin(t * 1.15 + aPhase + pos.x * 0.45) * 0.16 * motion;
  pos.x += cos(t * 0.85 + aPhase * 1.3 + pos.z * 0.35) * 0.12 * motion;
  pos.z += sin(t * 0.95 + aPhase) * 0.14 * motion;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  float depthDistance = max(1.0, -mvPosition.z);
  vDepth = clamp((depthDistance - 3.0) / 7.5, 0.0, 1.0);
}
`;

export const ECOLOGICAL_FILAMENT_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform float uOpacity;

varying float vAlpha;
varying float vDepth;

void main() {
  // Subtle connected lattice filament in muted lichen/moss
  vec3 filamentCol = vec3(0.22, 0.31, 0.25);
  float fog = 1.0 - smoothstep(0.25, 0.95, vDepth) * 0.75;
  float alpha = vAlpha * fog * uOpacity * 0.36;

  if (alpha < 0.003) discard;

  gl_FragColor = vec4(filamentCol, alpha);
}
`;

export const ECOLOGICAL_STRATUM_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform float uMotionScale;
uniform float uWavePhase;

attribute float aProgress;

varying float vProgress;
varying float vDepth;

void main() {
  vProgress = aProgress;

  vec3 pos = position;
  float t = uTime * 0.18;
  float motion = uMotionScale;

  pos.y += sin(t * 1.1 + aProgress * 6.28318 * 2.0 + uWavePhase) * 0.14 * motion;
  pos.z += cos(t * 0.8 + aProgress * 6.28318 * 3.0 - uWavePhase) * 0.12 * motion;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  float depthDistance = max(1.0, -mvPosition.z);
  vDepth = clamp((depthDistance - 3.0) / 7.5, 0.0, 1.0);
}
`;

export const ECOLOGICAL_STRATUM_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform float uOpacity;
uniform vec3 uColor;
uniform float uBaseOpacity;

varying float vProgress;
varying float vDepth;

void main() {
  float fog = 1.0 - smoothstep(0.25, 0.95, vDepth) * 0.7;
  float shimmer = 0.72 + 0.28 * sin(vProgress * 6.28318 * 3.0);
  float alpha = uBaseOpacity * shimmer * fog * uOpacity;

  if (alpha < 0.003) discard;

  gl_FragColor = vec4(uColor, alpha);
}
`;

export const ECOLOGICAL_BEACON_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform float uMotionScale;
uniform float uPixelRatio;
uniform float uPointScale;

attribute float aPhase;

varying float vPhase;
varying float vDepth;

void main() {
  vPhase = aPhase;
  vec3 pos = position;

  float t = uTime * 0.22;
  float motion = uMotionScale;
  pos.y += sin(t * 1.15 + aPhase + pos.x * 0.45) * 0.16 * motion;
  pos.x += cos(t * 0.85 + aPhase * 1.3 + pos.z * 0.35) * 0.12 * motion;
  pos.z += sin(t * 0.95 + aPhase) * 0.14 * motion;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  float depthDistance = max(1.0, -mvPosition.z);
  vDepth = clamp((depthDistance - 3.0) / 7.5, 0.0, 1.0);

  float pointSize = uPointScale * (110.0 / depthDistance) * uPixelRatio;
  gl_PointSize = clamp(pointSize, 8.0, 42.0);
}
`;

export const ECOLOGICAL_BEACON_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform float uOpacity;
uniform float uTime;
uniform float uMotionScale;

varying float vPhase;
varying float vDepth;

void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord);
  if (dist > 0.5) discard;

  // Multi-tier subtle radial glow (restrained warm ochre-moss)
  float outer = smoothstep(0.5, 0.0, dist) * 0.25;
  float mid = smoothstep(0.28, 0.04, dist) * 0.42;
  float core = smoothstep(0.10, 0.0, dist) * 0.65;
  float intensity = outer + mid + core;

  vec3 beaconColor = vec3(0.62, 0.47, 0.27);
  float breathing = 0.72 + 0.28 * sin(uTime * 0.8 + vPhase) * uMotionScale;

  float fog = 1.0 - smoothstep(0.25, 0.98, vDepth) * 0.68;
  float alpha = intensity * breathing * 0.62 * fog * uOpacity;

  if (alpha < 0.004) discard;

  gl_FragColor = vec4(beaconColor, alpha);
}
`;
