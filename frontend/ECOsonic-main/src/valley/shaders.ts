export const BOTANICAL_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uBaseSize;
  uniform vec2 uMouseNdc;
  uniform float uAspect;
  uniform float uHoverDisperse;

  attribute float aScale;
  attribute float aSpecies;
  attribute float aKind; // 0.0 = flower, 1.0 = leaf
  attribute float aSeed;
  attribute vec3 aColor;
  attribute vec3 aDisperseDir;

  varying vec3 vColor;
  varying float vSpecies;
  varying float vKind;
  varying float vAlpha;
  varying float vMouseGlow;
  varying float vDepth;
  varying float vBokeh;
  varying float vAngle;

  void main() {
    vec3 pos = position;

    // Gentle nocturnal breeze sway
    float swayPhase = uTime * 1.15 + aSeed * 12.566;
    pos.x += sin(swayPhase + pos.z * 0.14) * (0.1 + 0.09 * (1.0 - aKind));
    pos.y += cos(swayPhase * 0.8 + pos.x * 0.12) * 0.04;

    // Hover transition disperses flowers outward into floating glowing particles
    float disperse = uHoverDisperse * (1.0 - aKind * 0.45);
    pos += aDisperseDir * (disperse * (6.0 + aSeed * 8.0));
    pos.y += disperse * (2.0 + sin(uTime * 1.6 + aSeed * 18.0) * 0.9);

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    float dist = -mvPosition.z;
    vDepth = dist;

    // Flowers bloom from small bud to full size as they approach the camera;
    // leaves carpet the valley floor and rise up the dark hillside slopes.
    float flowerGrow = 1.0 - smoothstep(14.0, 68.0, dist);
    float flowerScale = 0.2 + 0.8 * flowerGrow;

    float leafIn = smoothstep(3.5, 16.0, dist);
    float leafOut = 1.0 - smoothstep(56.0, 98.0, dist) * 0.72;
    float leafScale = (0.35 + 0.65 * leafIn) * leafOut;

    float growthFactor = mix(flowerScale, leafScale, aKind);

    // Subtle shimmer while dispersed
    float disperseScale = mix(1.0, 0.6 + 0.4 * sin(uTime * 2.8 + aSeed * 25.0), uHoverDisperse);

    vec4 clipPos = projectionMatrix * mvPosition;
    vec2 ndc = clipPos.xy / max(clipPos.w, 0.0001);

    // Screen-space mouse repulsion & cursor proximity glow
    vec2 delta = vec2((ndc.x - uMouseNdc.x) * uAspect, ndc.y - uMouseNdc.y);
    float cursorDist = length(delta);
    float radius = 0.42;
    float falloff = pow(clamp(1.0 - cursorDist / radius, 0.0, 1.0), 1.9);

    vec2 pushDir = cursorDist > 0.0001 ? (delta / cursorDist) : vec2(0.0);
    float pushStrength = 0.22 * falloff;
    clipPos.x += (pushDir.x * pushStrength / max(uAspect, 0.25)) * clipPos.w;
    clipPos.y += (pushDir.y * pushStrength) * clipPos.w;

    gl_Position = clipPos;

    // Shallow depth-of-field bokeh near foreground & far screen edges
    float nearBokeh = 1.0 - smoothstep(3.0, 13.5, dist);
    float edgeDist = length(ndc * vec2(0.85, 1.0));
    float edgeBokeh = smoothstep(0.72, 1.32, edgeDist) * 0.55;
    float bokeh = clamp(nearBokeh + edgeBokeh, 0.0, 1.0);
    vBokeh = bokeh;

    float pointSize = uBaseSize * aScale * growthFactor * disperseScale * (1.0 + bokeh * 0.95) * uPixelRatio / max(dist, 2.2);
    gl_PointSize = clamp(pointSize, 0.0, 265.0);

    vColor = aColor;
    vSpecies = aSpecies;
    vKind = aKind;
    vMouseGlow = falloff;
    // Keep stems oriented organically upright while varying blossom & fern tilt
    vAngle = (aSeed - 0.5) * mix(1.05, 2.2, aKind);

    float nearAlpha = smoothstep(1.2, 4.2, dist);
    float farAlpha = 1.0 - smoothstep(58.0, 96.0, dist);
    vAlpha = nearAlpha * farAlpha * clamp(growthFactor * 1.35, 0.0, 1.0) * (1.0 - bokeh * 0.35);
  }
`;

export const BOTANICAL_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uHoverDisperse;

  varying vec3 vColor;
  varying float vSpecies;
  varying float vKind;
  varying float vAlpha;
  varying float vMouseGlow;
  varying float vDepth;
  varying float vBokeh;
  varying float vAngle;

  void main() {
    if (vAlpha <= 0.01) discard;

    // Subtle per-sprite rotation so clusters look organic and varied
    vec2 centered = gl_PointCoord - 0.5;
    float c = cos(vAngle);
    float s = sin(vAngle);
    vec2 rotated = vec2(centered.x * c - centered.y * s, centered.x * s + centered.y * c) + 0.5;
    if (rotated.x < 0.015 || rotated.x > 0.985 || rotated.y < 0.015 || rotated.y > 0.985) discard;
    vec2 localUv = mix(vec2(0.008), vec2(0.992), rotated);

    // Sample 4x2 sprite atlas tile (WebGL flipY=true: row 0 is v=0.5..1.0, row 1 is v=0.0..0.5)
    float idx = floor(vSpecies + 0.5);
    float col = mod(idx, 4.0);
    float row = floor(idx / 4.0);

    vec2 tileUv = vec2(
      (col + localUv.x) * 0.25,
      (2.0 - row - localUv.y) * 0.5
    );

    // Sample with subtle photographic shallow-DOF bokeh blur + chromatic edge fringing when out-of-focus
    vec4 tex = texture2D(uAtlas, tileUv);
    if (vBokeh > 0.2) {
      float blurR = 0.0055 * vBokeh;
      vec2 tileMin = vec2(col * 0.25 + 0.004, (1.0 - row) * 0.5 + 0.004);
      vec2 tileMax = vec2((col + 1.0) * 0.25 - 0.004, (2.0 - row) * 0.5 - 0.004);
      vec4 s1 = texture2D(uAtlas, clamp(tileUv + vec2(blurR, 0.0), tileMin, tileMax));
      vec4 s2 = texture2D(uAtlas, clamp(tileUv - vec2(blurR, 0.0), tileMin, tileMax));
      vec4 s3 = texture2D(uAtlas, clamp(tileUv + vec2(0.0, blurR * 2.0), tileMin, tileMax));
      vec4 s4 = texture2D(uAtlas, clamp(tileUv - vec2(0.0, blurR * 2.0), tileMin, tileMax));
      vec4 blurred = (tex + s1 + s2 + s3 + s4) * 0.2;
      tex = mix(tex, blurred, clamp(vBokeh * 0.85, 0.0, 1.0));

      vec2 chromaOffset = centered * (0.006 * vBokeh);
      float rCh = texture2D(uAtlas, clamp(tileUv + chromaOffset, tileMin, tileMax)).r;
      float bCh = texture2D(uAtlas, clamp(tileUv - chromaOffset, tileMin, tileMax)).b;
      tex.r = mix(tex.r, rCh, 0.55);
      tex.b = mix(tex.b, bCh, 0.55);
    }

    // Soft radial bokeh falloff when out-of-focus
    float radial = length(centered) * 2.0;
    float bokehMask = mix(1.0, smoothstep(1.0, 0.14, radial), vBokeh * 0.85);
    if (tex.a * bokehMask < 0.03) discard;

    // Preserve true photographic petal, stamen & frond colors with subtle per-cluster variation
    vec3 color = tex.rgb * vColor;

    // Luminous golden-white bioluminescent bloom near cursor that preserves petal veins & stamen depth
    float lum = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
    float glowAmt = vMouseGlow * (1.0 - vKind * 0.88);
    vec3 warmGold = vec3(1.0, 0.92, 0.72);
    // Multiply-boost petal hues + add warm highlight weighted by flower luminance (no flat grey silhouette)
    color = color * (1.0 + glowAmt * 2.15) + mix(color, warmGold, 0.52) * (pow(lum, 0.85) * glowAmt * 1.45);
    color += warmGold * (pow(vMouseGlow, 2.0) * pow(lum, 1.15) * 0.95 * (1.0 - vKind * 0.92));
    color += vec3(1.0, 0.94, 0.82) * (uHoverDisperse * 0.24 * lum * (1.0 - vKind * 0.72));

    // Exponential depth fog matching the pitch-black night sky
    float fogFactor = 1.0 - exp(-pow(vDepth * uFogDensity, 2.0));
    color = mix(color, uFogColor, clamp(fogFactor, 0.0, 1.0));

    float finalAlpha = tex.a * bokehMask * vAlpha * (1.0 - fogFactor * 0.84);
    gl_FragColor = vec4(color, finalAlpha);
  }
`;

export const DUST_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform vec2 uMouseNdc;
  uniform float uAspect;
  uniform float uHoverDisperse;

  attribute float aSize;
  attribute float aSeed;

  varying float vAlpha;
  varying float vGlow;

  void main() {
    vec3 pos = position;
    pos.x += sin(uTime * 0.45 + aSeed * 19.0) * 1.4;
    pos.y += cos(uTime * 0.38 + aSeed * 14.0) * 0.9 + uHoverDisperse * 1.4;
    pos.z += sin(uTime * 0.32 + aSeed * 23.0) * 1.2;

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    float dist = -mvPos.z;
    vec4 clipPos = projectionMatrix * mvPos;

    vec2 ndc = clipPos.xy / max(clipPos.w, 0.0001);
    vec2 delta = vec2((ndc.x - uMouseNdc.x) * uAspect, ndc.y - uMouseNdc.y);
    float d = length(delta);
    float falloff = pow(clamp(1.0 - d / 0.42, 0.0, 1.0), 2.0);

    vec2 push = d > 0.0001 ? (delta / d) * (0.14 * falloff) : vec2(0.0);
    clipPos.x += (push.x / max(uAspect, 0.25)) * clipPos.w;
    clipPos.y += push.y * clipPos.w;

    gl_Position = clipPos;
    gl_PointSize = clamp(aSize * uPixelRatio * (1.0 + uHoverDisperse * 0.65) / max(dist, 2.0), 1.0, 54.0);

    float twinkle = 0.45 + 0.55 * sin(uTime * 1.7 + aSeed * 31.0);
    float depthFade = smoothstep(2.0, 10.0, dist) * (1.0 - smoothstep(52.0, 88.0, dist));
    vAlpha = twinkle * depthFade * (0.5 + uHoverDisperse * 0.35 + falloff * 0.45);
    vGlow = falloff;
  }
`;

export const DUST_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uDustMap;
  varying float vAlpha;
  varying float vGlow;

  void main() {
    vec4 tex = texture2D(uDustMap, gl_PointCoord);
    if (tex.a < 0.02) discard;
    vec3 col = mix(vec3(0.86, 0.9, 0.96), vec3(1.0, 0.92, 0.72), vGlow * 0.8 + 0.2);
    gl_FragColor = vec4(col * tex.rgb, tex.a * vAlpha);
  }
`;

/**
 * Split-RGB chromatic noise + velocity-responsive vignette post-processing shader.
 */
export const VALLEY_COMPOSITE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignetteTightness: { value: 0.36 },
    uRgbShift: { value: 0.0022 },
    uNoiseAmount: { value: 0.036 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignetteTightness;
    uniform float uRgbShift;
    uniform float uNoiseAmount;
    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 center = vUv - 0.5;
      float dist = length(center);
      vec2 shift = center * dist * uRgbShift * (1.0 + uVignetteTightness * 1.4);

      float r = texture2D(tDiffuse, vUv + shift).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - shift).b;
      vec3 col = vec3(r, g, b);

      // Subtle split-RGB film grain
      float nr = rand(vUv + vec2(uTime * 0.13, 0.1)) - 0.5;
      float ng = rand(vUv + vec2(uTime * 0.17, 0.4)) - 0.5;
      float nb = rand(vUv + vec2(uTime * 0.21, 0.7)) - 0.5;
      col += vec3(nr, ng, nb) * uNoiseAmount;

      // Vignette tightens as camera speed increases
      float vig = smoothstep(1.06 - uVignetteTightness * 0.46, 0.26, dist);
      col *= mix(0.24, 1.0, vig);

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};
