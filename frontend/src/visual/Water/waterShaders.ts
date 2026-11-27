/**
 * Monochrome forest-pool water shaders for ACT 04 — WATER.
 * Uses a real mirrored WebGLRenderTarget planar reflection pass (uReflectionTex)
 * with 5-tap directional softness blur, shallow dark pool absorption, 3-loci oblong
 * asymmetric capillary wavefronts (zero circular bullseye), localized meniscus
 * depression at leaf contact, and zero front-edge viewport cutoff.
 */

export const WATER_SURFACE_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform float uRippleAge;
uniform float uContactImpulse;
uniform float uContactSplash;
uniform vec2 uImpactXZ;
uniform float uHarmonicBridge;
uniform float uMotionScale;
uniform vec4 uAcousticBands;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormalWorld;
varying vec4 vClipPos;
varying float vWaveHeight;

float evalWaveHeight(vec2 xz) {
  vec2 d = xz - uImpactXZ;
  float r = length(d);

  // Three micro-loci distributed along the moored leaf's oblong axis (breaks perfect circularity)
  vec2 axisDir = vec2(0.84, 0.54);
  float d0 = length(xz - uImpactXZ);
  float d1 = length(xz - (uImpactXZ + axisDir * 0.11));
  float d2 = length(xz - (uImpactXZ - axisDir * 0.10));

  float phaseWarp = sin(xz.x * 2.4 + xz.y * 1.9) * 0.032 + cos(xz.x * 3.7 - xz.y * 2.8) * 0.018;
  float r0 = d0 + phaseWarp * smoothstep(0.08, 0.9, d0);
  float r1 = d1 + phaseWarp * 0.9;
  float r2 = d2 + phaseWarp * 1.1;

  // Imperceptible still-pool micro-breathing before contact
  float calmMotion = (sin(xz.x * 1.3 + uTime * 0.44) + cos(xz.y * 1.5 - uTime * 0.36)) * 0.0012 * uMotionScale;

  float front = uRippleAge * 0.56;
  float p0 = exp(-pow(r0 - front, 2.0) * 5.2);
  float p1 = exp(-pow(r1 - max(0.0, front - 0.09), 2.0) * 4.4) * 0.62;
  float p2 = exp(-pow(r2 - max(0.0, front - 0.24), 2.0) * 3.8) * 0.42;

  float waveOsc =
    sin(r0 * 12.5 - uRippleAge * 4.0) * p0 +
    sin(r1 * 15.0 - uRippleAge * 4.4 + 0.7) * p1 +
    sin(r2 * 17.2 - uRippleAge * 4.9 + 1.4) * p2;

  // Localized oblong meniscus depression upon initial leaf contact
  float localAlong = dot(d, axisDir);
  float localAcross = dot(d, vec2(-axisDir.y, axisDir.x));
  float oblongR2 = localAlong * localAlong * 18.0 + localAcross * localAcross * 42.0;
  float depression = -exp(-oblongR2) * uContactSplash * 0.022;

  float radialDecay = exp(-r * 0.95);
  float contactWave = (waveOsc * uContactImpulse * 0.024 + depression) * radialDecay * uMotionScale;

  float bandAmp = clamp(uAcousticBands.x * 0.45 + uAcousticBands.y * 0.55 + uAcousticBands.z * 0.25, 0.04, 0.90);
  float harmonic = sin(r0 * 12.0 - uTime * 2.2) * exp(-r * 0.45) * uHarmonicBridge * 0.016 * bandAmp * uMotionScale;

  return calmMotion + contactWave + harmonic;
}

void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float h = evalWaveHeight(wp.xz);
  wp.y += h;
  vWaveHeight = h;

  float eps = 0.032;
  float hx = evalWaveHeight(wp.xz + vec2(eps, 0.0));
  float hz = evalWaveHeight(wp.xz + vec2(0.0, eps));
  vNormalWorld = normalize(vec3((h - hx) / eps, 1.0, (h - hz) / eps));
  vWorldPos = wp.xyz;

  vec4 clipPos = projectionMatrix * viewMatrix * wp;
  vClipPos = clipPos;
  gl_Position = clipPos;
}
`;

export const WATER_SURFACE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform sampler2D uReflectionTex;
uniform float uTime;
uniform float uOpacity;
uniform float uRippleAge;
uniform float uContactImpulse;
uniform float uContactSplash;
uniform vec2 uImpactXZ;
uniform float uHarmonicBridge;
uniform float uMotionScale;
uniform vec3 uCameraPos;
uniform vec4 uAcousticBands;
uniform vec2 uLeafShadowXZ;
uniform float uLeafHeightAboveWater;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormalWorld;
varying vec4 vClipPos;
varying float vWaveHeight;

float hash21(vec2 p) {
  p = fract(p * vec2(234.12, 567.89));
  p += dot(p, p + 34.12);
  return fract(p.x * p.y);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise2(p);
    p = p * 2.02 + vec2(7.3, 11.1);
    a *= 0.5;
  }
  return v;
}

void main() {
  if (uOpacity <= 0.005) discard;

  vec2 xz = vWorldPos.xz;
  vec2 dImpact = xz - uImpactXZ;
  float r = length(dImpact);

  // Asymmetric irregular expanding wavefronts driven by oblong leaf footprint + fBm phase warp
  vec2 axisDir = vec2(0.84, 0.54);
  float d0 = length(xz - uImpactXZ);
  float d1 = length(xz - (uImpactXZ + axisDir * 0.11));
  float d2 = length(xz - (uImpactXZ - axisDir * 0.10));
  float warp = (fbm(xz * 2.1 + vec2(0.3, 0.8)) - 0.5) * 0.14;
  float r0 = d0 + warp * smoothstep(0.06, 0.85, d0);
  float r1 = d1 + warp * 0.85;
  float r2 = d2 + warp * 1.15;

  float front = uRippleAge * 0.56;
  float env0 = exp(-pow(r0 - front, 2.0) * 5.2);
  float env1 = exp(-pow(r1 - max(0.0, front - 0.09), 2.0) * 4.4) * 0.62;
  float env2 = exp(-pow(r2 - max(0.0, front - 0.24), 2.0) * 3.8) * 0.42;

  float slope0 = cos(r0 * 12.5 - uRippleAge * 4.0) * env0;
  float slope1 = cos(r1 * 15.0 - uRippleAge * 4.4 + 0.7) * env1;
  float slope2 = cos(r2 * 17.2 - uRippleAge * 4.9 + 1.4) * env2;

  vec2 dir0 = d0 > 0.001 ? (xz - uImpactXZ) / d0 : vec2(0.0, 1.0);
  vec2 dir1 = d1 > 0.001 ? (xz - (uImpactXZ + axisDir * 0.11)) / d1 : axisDir;
  vec2 dir2 = d2 > 0.001 ? (xz - (uImpactXZ - axisDir * 0.10)) / d2 : -axisDir;

  float decay = uContactImpulse * exp(-r * 0.65) * uMotionScale;
  vec2 rippleGrad = (dir0 * slope0 + dir1 * slope1 + dir2 * slope2) * decay;

  // Fine organic capillary surface drift
  float capX = (fbm(xz * 3.6 + vec2(uTime * 0.035, -uTime * 0.025) * uMotionScale) - 0.5) * 0.018;
  float capZ = (fbm(xz * 3.6 + vec2(4.1 - uTime * 0.028, uTime * 0.032) * uMotionScale) - 0.5) * 0.018;
  vec3 N = normalize(vNormalWorld + vec3(rippleGrad.x * 0.28 + capX, 0.0, rippleGrad.y * 0.28 + capZ));

  vec3 V = normalize(uCameraPos - vWorldPos);

  // True planar reflection sampled from mirrored WebGLRenderTarget with controlled distortion & 5-tap softness
  vec2 screenUv = (vClipPos.xy / max(0.0001, vClipPos.w)) * 0.5 + 0.5;
  vec2 reflBaseUv = vec2(screenUv.x, 1.0 - screenUv.y);
  vec2 distort = vec2(N.x * 0.10, -N.z * 0.14);
  vec2 rUv = clamp(reflBaseUv + distort, vec2(0.005), vec2(0.995));

  vec2 blurOff = vec2(0.0045, 0.0085);
  vec3 r0Col = texture2D(uReflectionTex, rUv).rgb;
  vec3 r1Col = texture2D(uReflectionTex, clamp(rUv + vec2(blurOff.x, 0.0), vec2(0.005), vec2(0.995))).rgb;
  vec3 r2Col = texture2D(uReflectionTex, clamp(rUv - vec2(blurOff.x, 0.0), vec2(0.005), vec2(0.995))).rgb;
  vec3 r3Col = texture2D(uReflectionTex, clamp(rUv + vec2(0.0, blurOff.y), vec2(0.005), vec2(0.995))).rgb;
  vec3 r4Col = texture2D(uReflectionTex, clamp(rUv - vec2(0.0, blurOff.y), vec2(0.005), vec2(0.995))).rgb;
  vec3 reflSample = r0Col * 0.36 + (r1Col + r2Col + r3Col + r4Col) * 0.16;

  // Enforce strict monochrome & preserve luminous forest canopy reflections across ripples
  float reflLum = dot(reflSample, vec3(0.299, 0.587, 0.114));
  // Subtle depth attenuation into foreground water
  float shoreDist = smoothstep(-2.4, 3.2, xz.y);
  vec3 softReflection = vec3(reflLum * mix(0.94, 0.60, shoreDist));

  // Shallow dark forest pool body (strictly monochrome #070707 -> #161616)
  float bottomMottle = fbm(xz * 1.35 + vec2(1.9, 4.2));
  vec3 waterBody = mix(vec3(0.030), vec3(0.075), smoothstep(0.22, 0.85, bottomMottle) * 0.56);

  float cosTheta = clamp(dot(N, V), 0.0, 1.0);
  float fresnel = 0.08 + 0.92 * pow(1.0 - cosTheta, 3.4);
  vec3 waterCol = mix(waterBody, softReflection, clamp(fresnel * 1.55 + 0.28, 0.0, 0.84));

  // Luminous grayscale ripple crests catching overcast clearing mist & branch reflection
  vec3 L = normalize(vec3(-0.30, 0.78, 0.54));
  vec3 H = normalize(L + V);
  float NdotH = max(dot(N, H), 0.0);
  float rippleStrength = length(rippleGrad);
  float wetSpec = pow(NdotH, 30.0) * (0.04 + rippleStrength * 1.15);
  waterCol += vec3(0.84) * wetSpec;
  waterCol *= clamp(1.0 + (slope0 + slope1 * 0.72 + slope2 * 0.52) * decay * 0.60, 0.56, 1.52);

  // Soft pre-contact leaf shadow & silhouette darkening directly under descending / moored leaf
  float shadowProx = 1.0 - smoothstep(0.0, 0.75, max(0.0, uLeafHeightAboveWater));
  float shadowDist = length((xz - uLeafShadowXZ) * vec2(1.20, 0.90));
  float leafShadow = exp(-shadowDist * shadowDist * 30.0) * shadowProx * 0.56;
  waterCol *= (1.0 - leafShadow);

  // Soft misty bank blending on far shoreline (z < -1.8) and outer side banks (|x| > 3.2)
  // NEVER clip or fade the near/bottom camera edge (vUv.y near 0)!
  float farShoreFade = smoothstep(-4.2, -1.9, xz.y);
  float sideBankShade = smoothstep(2.8, 5.4, abs(xz.x));
  waterCol = mix(waterCol, vec3(0.0314), sideBankShade * 0.78);

  // Subtle film grain matching forest plates
  float grain = hash21(gl_FragCoord.xy + floor(uTime * 12.0) * 1.7 * uMotionScale);
  waterCol += (grain - 0.5) * 0.016;

  float alpha = clamp(farShoreFade * uOpacity, 0.0, 0.98);
  gl_FragColor = vec4(clamp(waterCol, 0.0, 1.0), alpha);
}
`;
