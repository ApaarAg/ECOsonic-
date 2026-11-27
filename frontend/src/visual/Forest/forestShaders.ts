/**
 * Photorealistic WebGL shaders for ACT 02 — FOREST.
 * Renders a real temperate coastal old-growth photograph with smooth depth-mapped
 * 2.5D parallax, restrained 16:15 overcast coastal grading, staged emergence from
 * ACT 01 blackness, subtle fBm mist drift, and sparse atmospheric moisture particles.
 */

export const FOREST_PHOTO_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const FOREST_PHOTO_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform sampler2D uPhotoTex;
uniform sampler2D uDepthTex;
uniform float uTime;
uniform float uEmergence;
uniform float uViewportAspect;
uniform float uPhotoAspect;
uniform vec2 uParallax;
uniform vec2 uDrift;
uniform float uMotionScale;
uniform vec2 uLeafFocusUv;
uniform float uLeafAttention;
uniform float uBackdropDefocus;
uniform float uOpacity;
uniform float uLowBiotic;
uniform float uMidBiotic;
uniform float uAtmospheric;

varying vec2 vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amp * noise2(p);
    p = p * 2.02 + vec2(13.4, 7.9);
    amp *= 0.5;
  }
  return value;
}

vec2 computeCoverUv(vec2 uv, float targetAspect, float mediaAspect) {
  vec2 centered = uv - 0.5;
  if (targetAspect > mediaAspect) {
    // Wider desktop viewport: balance overarching broadleaf branch, mature trunks, and fern floor
    float scaleY = mediaAspect / targetAspect;
    centered.y = centered.y * scaleY - 0.015;
  } else {
    // Portrait / narrow mobile viewport: shift slightly right to center overarching broadleaf branch + trunk depth
    float scaleX = targetAspect / mediaAspect;
    centered.x = centered.x * scaleX + 0.085;
  }
  return centered + 0.5;
}

void main() {
  // Base aspect-preserving cover mapping plus slight overscan so parallax never hits edges
  vec2 baseUv = computeCoverUv(vUv, uViewportAspect, uPhotoAspect);
  float breath = (0.004 * sin(uTime * 0.22) + 0.002 * uAtmospheric) * uMotionScale;
  baseUv = (baseUv - 0.5) / (1.045 + breath) + 0.5;
  baseUv = clamp(baseUv, 0.002, 0.998);

  // Sample smoothed depth field (1.0 = foreground ferns/bark, 0.0 = distant misty sky clearing)
  float depthBase = texture2D(uDepthTex, baseUv).r;

  // Apply gentle continuous 2.5D depth parallax + slow documentary camera micro-drift
  vec2 motionVec = (uParallax * 0.022 + uDrift * 0.011) * uMotionScale;
  float depthFactor = mix(0.28, 1.0, depthBase);
  vec2 displacedUv = clamp(baseUv - motionVec * depthFactor, 0.002, 0.998);

  // Re-sample depth at displaced coordinate for coherent atmospheric & mist compositing
  float depth = texture2D(uDepthTex, displacedUv).r;
  vec3 photo = texture2D(uPhotoTex, displacedUv).rgb;

  // Optical shallow DoF defocus during ACT 02 -> ACT 03 hero leaf approach (smooth Poisson disc)
  if (uBackdropDefocus > 0.005) {
    float blurRad = uBackdropDefocus * 0.0062 * mix(0.65, 1.15, depth);
    vec2 k0 = vec2(0.866, 0.5) * blurRad;
    vec2 k1 = vec2(-0.866, 0.5) * blurRad;
    vec2 k2 = vec2(0.0, -1.0) * blurRad;
    vec2 k3 = vec2(0.5, 0.866) * blurRad * 0.55;
    vec2 k4 = vec2(-0.5, -0.866) * blurRad * 0.55;
    vec2 k5 = vec2(0.95, -0.31) * blurRad * 0.35;
    vec2 k6 = vec2(-0.95, 0.31) * blurRad * 0.35;
    vec3 blurSum =
      photo * 2.0 +
      texture2D(uPhotoTex, clamp(displacedUv + k0, 0.002, 0.998)).rgb +
      texture2D(uPhotoTex, clamp(displacedUv - k0, 0.002, 0.998)).rgb +
      texture2D(uPhotoTex, clamp(displacedUv + k1, 0.002, 0.998)).rgb +
      texture2D(uPhotoTex, clamp(displacedUv - k1, 0.002, 0.998)).rgb +
      texture2D(uPhotoTex, clamp(displacedUv + k2, 0.002, 0.998)).rgb +
      texture2D(uPhotoTex, clamp(displacedUv - k2, 0.002, 0.998)).rgb +
      texture2D(uPhotoTex, clamp(displacedUv + k3, 0.002, 0.998)).rgb +
      texture2D(uPhotoTex, clamp(displacedUv + k4, 0.002, 0.998)).rgb +
      texture2D(uPhotoTex, clamp(displacedUv + k5, 0.002, 0.998)).rgb +
      texture2D(uPhotoTex, clamp(displacedUv + k6, 0.002, 0.998)).rgb;
    photo = blurSum / 12.0;
  }

  // Preserve photographic micro-detail while grading toward ECOsonic's subdued 16:15 coastal forest tone
  float luma = dot(photo, vec3(0.2126, 0.7152, 0.0722));

  // Subdue bright midsummer green excess toward deep overcast coastal olive/pine without synthetic clipping
  float greenExcess = clamp((photo.g - max(photo.r, photo.b)) * 3.2, 0.0, 1.0);
  vec3 coastalOlive = vec3(photo.r * 0.92 + 0.01, photo.g * 0.72, photo.b * 0.78);
  vec3 graded = mix(photo, coastalOlive, greenExcess * 0.72);

  // Compress bright wet-cuticle highlights slightly toward damp overcast slate
  float skyRoll = smoothstep(0.48, 0.94, luma);
  graded = mix(graded, graded * vec3(0.76, 0.78, 0.74), skyRoll * 0.48);

  // Preserve bark/understory shadow detail while gently anchoring deep shadows into wet forest charcoal-umber
  vec3 dampShadow = vec3(0.024, 0.034, 0.026);
  graded = mix(dampShadow, graded, smoothstep(0.0, 0.14, luma) * 0.18 + 0.82);

  // Controlled exposure & spatial depth separation (distant woods subtly dimmer than foreground branch)
  graded *= mix(0.66, 0.94, depth);
  graded = mix(vec3(dot(graded, vec3(0.299, 0.587, 0.114))), graded, 0.82);

  // Restrained drifting coastal mist concentrated in recessed midground/canopy clearing (low depth)
  vec2 mistUv = displacedUv * vec2(2.6, 1.8) + vec2(uTime * 0.014 * uMotionScale, -uTime * 0.004 * uMotionScale);
  float mistNoise = fbm(mistUv);
  float recessedMask = (1.0 - smoothstep(0.18, 0.72, depth)) * smoothstep(0.06, 0.45, 1.0 - displacedUv.y);
  float lowFloorMist = smoothstep(0.55, 0.92, 1.0 - displacedUv.y) * 0.16;
  float mistDensity = (recessedMask * 0.14 + lowFloorMist * 0.08) * smoothstep(0.32, 0.82, mistNoise);
  mistDensity *= (1.0 + 0.18 * uLowBiotic);
  vec3 mistColor = vec3(0.46, 0.52, 0.49);
  graded = mix(graded, mistColor, clamp(mistDensity, 0.0, 0.22));

  // Staged emergence from ACT 01 BLACKNESS (#050706):
  // Stage 1: pale recessed mist clearing appears first
  // Stage 2: midground trunks and hanging moss emerge
  // Stage 3: foreground bark, sword ferns, and leaf litter settle in
  float stageClearing = smoothstep(0.04, 0.52, uEmergence);
  float stageMid = smoothstep(0.18, 0.74, uEmergence);
  float stageForeground = smoothstep(0.36, 0.96, uEmergence);

  float skyWeight = clamp(1.0 - depth * 1.15, 0.0, 1.0);
  float fgWeight = smoothstep(0.48, 0.95, depth);
  float revealMask = mix(stageMid, stageClearing, skyWeight * 0.75);
  revealMask = mix(revealMask, stageForeground, fgWeight * 0.65);

  vec3 obsidian = vec3(0.0196, 0.0275, 0.0235);
  vec3 color = mix(obsidian, graded, revealMask);

  // Subtle ACT 03 leaf attention cue around natural maple leaf cluster when transitioning forward
  if (uLeafAttention > 0.001) {
    float leafDist = length((displacedUv - uLeafFocusUv) * vec2(uPhotoAspect, 1.0));
    float spotlight = exp(-leafDist * leafDist * 26.0);
    color *= mix(1.0, 0.68 + 0.56 * spotlight, clamp(uLeafAttention, 0.0, 1.0));
  }

  // Asymmetric documentary vignette + soft top header scrim so upper nav & bottom-left type stay crisp
  vec2 centeredScreen = vUv - vec2(0.54, 0.46);
  float vignette = 1.0 - smoothstep(0.45, 1.12, length(centeredScreen * vec2(1.05, 1.25))) * 0.36;
  float titleScrim = smoothstep(0.52, 0.0, vUv.x) * smoothstep(0.42, 0.0, vUv.y);
  float headerScrim = smoothstep(0.80, 1.0, vUv.y);
  color *= vignette;
  color = mix(color, obsidian, clamp(titleScrim * 0.28 + headerScrim * 0.52, 0.0, 0.72));

  // Micro-contrast lift slightly in active avian/mid-biotic presence (very subtle documentary breathing)
  color *= (1.0 + 0.025 * uMidBiotic * uMotionScale);
  // Subtle depth darkening as background defocuses during ACT 03 hero leaf macro focus
  color = mix(color, obsidian, clamp(uBackdropDefocus * 0.34, 0.0, 0.38));
  color = mix(obsidian, color, clamp(uOpacity, 0.0, 1.0));

  gl_FragColor = vec4(color, 1.0);
}
`;

export const FOREST_MIST_VERTEX_SHADER = /* glsl */ `
attribute float aSeed;
attribute float aScale;
attribute float aDepth;

uniform float uTime;
uniform float uPixelRatio;
uniform float uMotionScale;
uniform float uEmergence;
uniform float uAtmospheric;
uniform float uLowBiotic;

varying float vAlpha;
varying float vSeed;

void main() {
  vSeed = aSeed;
  vec3 pos = position;
  float driftT = uTime * 0.14 * uMotionScale;
  pos.x += sin(driftT + aSeed * 19.3) * 0.28 + driftT * (0.045 + 0.02 * uAtmospheric);
  pos.x = mod(pos.x + 8.0, 16.0) - 8.0;
  pos.y += cos(driftT * 0.71 + aSeed * 11.7) * 0.10 - mod(uTime * 0.02 * uMotionScale, 1.6);

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float dist = max(1.5, -mvPosition.z);
  gl_PointSize = clamp((aScale * (1.0 + 0.15 * uAtmospheric) * uPixelRatio * 48.0) / dist, 1.0, 9.0);

  float emerge = smoothstep(0.30, 0.95, uEmergence);
  vAlpha = emerge * (0.06 + 0.09 * fract(aSeed * 3.17)) * (1.0 - aDepth * 0.35) * (1.0 + 0.2 * uLowBiotic);
}
`;

export const FOREST_MIST_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying float vAlpha;
varying float vSeed;

void main() {
  vec2 centered = gl_PointCoord - 0.5;
  float r = length(centered);
  if (r > 0.5) discard;
  float soft = smoothstep(0.5, 0.04, r);
  vec3 mistTone = mix(vec3(0.84), vec3(0.68), fract(vSeed * 7.13));
  gl_FragColor = vec4(mistTone, soft * soft * vAlpha);
}
`;

export const FOREST_PLATE_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform float uMotionScale;
uniform float uSwayAmount;
uniform float uParallaxFactor;
uniform vec2 uParallax;
uniform vec2 uDrift;

varying vec2 vUv;
varying vec2 vScreenUv;
varying vec3 vWorldPos;

void main() {
  vUv = uv;
  vec3 pos = position;

  // Organic breeze swaying upper canopy & limb tips while keeping trunk base & ground rooted
  float heightWeight = smoothstep(0.24, 0.88, uv.y);
  float breeze = sin(uTime * 0.62 + pos.x * 0.95 + pos.y * 0.72) * 0.015 +
                 cos(uTime * 0.39 + pos.x * 0.65) * 0.008;
  pos.x += breeze * uSwayAmount * heightWeight * uMotionScale;
  pos.y += sin(uTime * 0.51 + pos.x * 1.15) * 0.007 * uSwayAmount * heightWeight * uMotionScale;

  // True layer-depth parallax offset in local plate space
  vec2 layerShift = (uParallax * 0.24 + uDrift * 0.14) * uParallaxFactor * uMotionScale;
  pos.x -= layerShift.x;
  pos.y -= layerShift.y * 0.65;

  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vWorldPos = worldPos.xyz;
  vec4 clipPos = projectionMatrix * viewMatrix * worldPos;
  vScreenUv = (clipPos.xy / max(0.0001, clipPos.w)) * 0.5 + 0.5;
  gl_Position = clipPos;
}
`;

export const FOREST_PLATE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform sampler2D uPlateTex;
uniform float uTime;
uniform float uMotionScale;
uniform float uOpacity;
uniform float uEmergence;
uniform float uDefocus;
uniform float uDepthMist;
uniform float uLayerTintGain;
uniform float uEdgeVignette;
uniform float uClipBelowY;

varying vec2 vUv;
varying vec2 vScreenUv;
varying vec3 vWorldPos;

float monoGrainHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  if (uClipBelowY > -50.0 && vWorldPos.y < uClipBelowY) discard;
  vec4 tex = texture2D(uPlateTex, vUv);

  // Restrained optical depth softness when camera dollies away from upper forest planes
  if (uDefocus > 0.01 && tex.a > 0.01) {
    float r = uDefocus * 0.0038;
    vec4 s0 = texture2D(uPlateTex, clamp(vUv + vec2(r, 0.0), 0.002, 0.998));
    vec4 s1 = texture2D(uPlateTex, clamp(vUv - vec2(r, 0.0), 0.002, 0.998));
    vec4 s2 = texture2D(uPlateTex, clamp(vUv + vec2(0.0, r * 1.3), 0.002, 0.998));
    vec4 s3 = texture2D(uPlateTex, clamp(vUv - vec2(0.0, r * 1.3), 0.002, 0.998));
    tex = tex * 0.40 + (s0 + s1 + s2 + s3) * 0.15;
  }

  float alpha = tex.a * uOpacity;
  if (alpha <= 0.42) discard;

  // Strictly monochrome luminance across all depth planes (R === G === B)
  float lum = pow(max(dot(tex.rgb, vec3(0.299, 0.587, 0.114)), 0.0), 0.84) * uLayerTintGain;
  vec3 col = vec3(lum);

  // Neutral gray atmospheric mist veil for depth separation
  vec3 mistTone = vec3(0.76);
  col = mix(col, mistTone, clamp(uDepthMist, 0.0, 0.55) * 0.34);

  // Subtle animated documentary film grain
  float grain = monoGrainHash(gl_FragCoord.xy + floor(uTime * 12.0) * 1.7 * uMotionScale);
  col += (grain - 0.5) * 0.020;

  // Staged blackness-to-forest emergence (#080808 near-black anchor)
  vec3 obsidian = vec3(0.0314);
  col = mix(obsidian, clamp(col, 0.0, 1.0), clamp(uEmergence, 0.0, 1.0));

  // Soft edge vignette & dark framing scrims so #F2F0EA editorial type reads cleanly over misty sky
  if (uEdgeVignette > 0.01) {
    float vig = 1.0 - smoothstep(0.46, 1.15, length((vScreenUv - vec2(0.50, 0.46)) * vec2(1.04, 1.20))) * 0.30;
    float headerScrim = smoothstep(0.80, 1.0, vScreenUv.y) * 0.64;
    float cornerScrim = smoothstep(0.48, 0.0, vScreenUv.x) * smoothstep(0.32, 0.0, vScreenUv.y) * 0.68;
    col *= vig;
    col = mix(col, obsidian, clamp((headerScrim + cornerScrim) * uEdgeVignette, 0.0, 0.76));
  }

  gl_FragColor = vec4(col, alpha);
}
`;

export const FOREST_MONO_PHOTO_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform float uMotionScale;
uniform float uParallaxFactor;
uniform vec2 uParallax;
uniform vec2 uDrift;

varying vec2 vUv;
varying vec2 vScreenUv;
varying vec3 vWorldPos;

void main() {
  vUv = uv;
  vec3 pos = position;

  // Gentle organic sway in upper canopy limbs while keeping rooted trunks & floor still
  float canopyWeight = smoothstep(0.32, 0.90, uv.y);
  float breeze = sin(uTime * 0.44 + pos.x * 0.35 + pos.y * 0.25) * 0.012;
  pos.x += breeze * canopyWeight * uMotionScale;

  // Depth parallax offset in world plate coordinates
  vec2 shift = (uParallax * 0.20 + uDrift * 0.11) * uParallaxFactor * uMotionScale;
  pos.x -= shift.x;
  pos.y -= shift.y * 0.55;

  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vWorldPos = worldPos.xyz;
  vec4 clipPos = projectionMatrix * viewMatrix * worldPos;
  vScreenUv = (clipPos.xy / max(0.0001, clipPos.w)) * 0.5 + 0.5;
  gl_Position = clipPos;
}
`;

export const FOREST_MONO_PHOTO_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform sampler2D uPhotoTex;
uniform sampler2D uDepthTex;
uniform float uTime;
uniform float uMotionScale;
uniform float uOpacity;
uniform float uEmergence;
uniform float uDefocus;
uniform float uSoundTraceGlow;
uniform vec2 uParallax;
uniform vec2 uDrift;
uniform float uClipBelowY;

varying vec2 vUv;
varying vec2 vScreenUv;
varying vec3 vWorldPos;

float monoHash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float monoNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(monoHash21(i), monoHash21(i + vec2(1.0, 0.0)), f.x),
    mix(monoHash21(i + vec2(0.0, 1.0)), monoHash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float monoFbm(vec2 p) {
  float value = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amp * monoNoise2(p);
    p = p * 2.03 + vec2(11.7, 6.3);
    amp *= 0.5;
  }
  return value;
}

void main() {
  if (uClipBelowY > -50.0 && vWorldPos.y < uClipBelowY) discard;

  vec2 safeUv = clamp(vUv, 0.002, 0.998);
  float depthBase = texture2D(uDepthTex, safeUv).r;

  // Internal 2.5D depth parallax between trunks, limbs, and misty sky clearing
  vec2 motionVec = (uParallax * 0.015 + uDrift * 0.008) * uMotionScale;
  vec2 dispUv = clamp(safeUv - motionVec * mix(0.18, 1.0, depthBase), 0.002, 0.998);

  float depth = texture2D(uDepthTex, dispUv).r;
  vec3 photo = texture2D(uPhotoTex, dispUv).rgb;

  // Soft Poisson disc optical defocus during hero leaf fall
  if (uDefocus > 0.006) {
    float r = uDefocus * 0.0054 * mix(0.7, 1.15, depth);
    vec2 k0 = vec2(0.866, 0.5) * r;
    vec2 k1 = vec2(-0.866, 0.5) * r;
    vec2 k2 = vec2(0.0, -1.0) * r;
    vec2 k3 = vec2(0.5, 0.866) * r * 0.52;
    vec2 k4 = vec2(-0.5, -0.866) * r * 0.52;
    photo = (
      photo * 2.0 +
      texture2D(uPhotoTex, clamp(dispUv + k0, 0.002, 0.998)).rgb +
      texture2D(uPhotoTex, clamp(dispUv - k0, 0.002, 0.998)).rgb +
      texture2D(uPhotoTex, clamp(dispUv + k1, 0.002, 0.998)).rgb +
      texture2D(uPhotoTex, clamp(dispUv - k1, 0.002, 0.998)).rgb +
      texture2D(uPhotoTex, clamp(dispUv + k2, 0.002, 0.998)).rgb +
      texture2D(uPhotoTex, clamp(dispUv - k2, 0.002, 0.998)).rgb +
      texture2D(uPhotoTex, clamp(dispUv + k3, 0.002, 0.998)).rgb +
      texture2D(uPhotoTex, clamp(dispUv + k4, 0.002, 0.998)).rgb
    ) / 10.0;
  }

  // Strictly black / charcoal / graphite / soft silver-gray luminance (R === G === B)
  float rawLum = dot(photo, vec3(0.2126, 0.7152, 0.0722));
  // Lift shadowed old-growth bark ridges, hanging moss, and fern fronds out of crushed black
  float tonal = pow(clamp(rawLum, 0.0, 1.0), 0.76);
  float contrastLum = smoothstep(0.015, 0.94, tonal);

  // Depth-sculpted chiaroscuro: readable textured bark/ferns in foreground, misty pale clearing behind
  float depthLift = mix(0.94, 0.76, depth * 0.75);
  float luma = contrastLum * depthLift;
  luma = mix(0.055, luma, smoothstep(0.01, 0.14, rawLum) * 0.25 + 0.75);

  // Soft diagonal atmospheric mist & volumetric canopy light beams in upper clearing
  vec2 mistUv = dispUv * vec2(2.4, 1.7) + vec2(uTime * 0.012 * uMotionScale, -uTime * 0.003 * uMotionScale);
  float mistFbm = monoFbm(mistUv);
  float clearingZone = (1.0 - smoothstep(0.15, 0.68, depth)) * smoothstep(0.24, 0.85, dispUv.y);
  float rayCoord = dispUv.x * 1.15 - dispUv.y * 0.55;
  float lightBeam = exp(-pow((rayCoord - 0.34) / 0.16, 2.0)) * smoothstep(0.30, 0.88, dispUv.y) * (0.45 + 0.55 * mistFbm);
  float understoryMist = smoothstep(0.45, 0.12, dispUv.y) * (0.06 + 0.08 * mistFbm);
  float mistVeil = (clearingZone * 0.24 + lightBeam * 0.18 + understoryMist) * smoothstep(0.24, 0.82, mistFbm);
  luma = mix(luma, 0.78, clamp(mistVeil, 0.0, 0.34));

  // Pre-emergence acoustic illumination trace sweeping trunks/sky out of ACT 01 blackness
  if (uSoundTraceGlow > 0.002) {
    float contourEdge = clamp((contrastLum - 0.18) * 1.6, 0.0, 1.0);
    float scanBand = exp(-pow((dispUv.y - (0.28 + 0.45 * mistFbm)) / 0.28, 2.0));
    luma += uSoundTraceGlow * (0.14 * contourEdge + 0.08 * scanBand * clearingZone);
  }

  // Subtle documentary monochrome grain
  float grain = monoHash21(gl_FragCoord.xy + floor(uTime * 12.0) * 1.7 * uMotionScale);
  luma += (grain - 0.5) * 0.018;

  // Staged emergence: pale clearing first -> midground trunks -> dark foreground bark & ferns
  float stageSky = smoothstep(0.03, 0.50, uEmergence);
  float stageMid = smoothstep(0.16, 0.74, uEmergence);
  float stageFg  = smoothstep(0.34, 0.96, uEmergence);
  float skyWeight = clamp(1.0 - depth * 1.15, 0.0, 1.0);
  float fgWeight = smoothstep(0.45, 0.92, depth);
  float reveal = mix(stageMid, stageSky, skyWeight * 0.76);
  reveal = mix(reveal, stageFg, fgWeight * 0.65);

  float obsidianLum = 0.0314;
  float emerged = mix(obsidianLum, clamp(luma, 0.02, 0.90), clamp(reveal, 0.0, 1.0));

  // Asymmetric cinema vignette + clean top/bottom-left scrims for editorial readability
  float vig = 1.0 - smoothstep(0.46, 1.12, length((vScreenUv - vec2(0.50, 0.46)) * vec2(1.04, 1.22))) * 0.34;
  float headerScrim = smoothstep(0.80, 1.0, vScreenUv.y) * 0.64;
  float cornerScrim = smoothstep(0.48, 0.0, vScreenUv.x) * smoothstep(0.32, 0.0, vScreenUv.y) * 0.70;
  emerged *= vig;
  emerged = mix(emerged, obsidianLum, clamp(headerScrim + cornerScrim, 0.0, 0.78));

  float finalLum = mix(obsidianLum, emerged, clamp(uOpacity, 0.0, 1.0));
  gl_FragColor = vec4(vec3(finalLum), 1.0);
}
`;

