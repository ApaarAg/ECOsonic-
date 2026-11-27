export const FIELD_PARTICLE_VERTEX_SHADER = /* glsl */ `
  uniform float uPhase;
  uniform float uEnergy;
  uniform vec4 uBands;
  uniform float uCentroid;
  uniform float uFlux;
  uniform float uSilence;
  uniform float uPixelRatio;
  uniform float uPointScale;
  uniform float uReducedMotion;
  uniform float uFieldMorph;
  uniform float uFieldOpacity;
  uniform float uWaterRippleAge;
  uniform float uWaterImpulse;
  uniform vec2 uImpactOrigin;

  uniform vec3 uDetectionDir;
  uniform float uDetectionStrength;

  uniform vec3 uDisturbanceDir;
  uniform float uDisturbanceStrength;

  uniform vec3 uPointerPos;
  uniform float uPointerPresence;

  attribute float aBand;
  attribute float aSeed;

  varying float vAlpha;
  varying float vDepth;
  varying float vDetectionGlow;
  varying float vDisturbanceMix;
  varying vec3 vAcousticColor;
  varying float vChroma;

  float bandValue(float idx) {
    if (idx < 0.5) return uBands.x;
    if (idx < 1.5) return uBands.y;
    if (idx < 2.5) return uBands.z;
    return uBands.w;
  }

  void main() {
    vec3 basePos = position;
    float baseLen = length(basePos);
    vec3 dir = baseLen > 0.0001 ? basePos / baseLen : vec3(0.0, 1.0, 0.0);

    float activeBand = bandValue(aBand);
    float motionGate = (1.0 - uSilence * 0.88) * (1.0 - uReducedMotion * 0.85);

    // Organic multi-frequency curl-like displacement (non-uniform, restrained)
    float n1 = sin(dir.x * 3.1 + uPhase * 0.9 + aSeed * 6.2831);
    float n2 = cos(dir.y * 2.7 - uPhase * 0.7 + aSeed * 4.17);
    float n3 = sin(dir.z * 3.4 + uPhase * 1.1 + aSeed * 2.91);
    vec3 organicOffset = vec3(n1, n2, n3) * (0.045 + activeBand * 0.14) * motionGate;

    // Frequency strata radial breathing
    float radialBreath = 1.0 + activeBand * 0.16 + uEnergy * 0.06;
    vec3 displaced = basePos * radialBreath + organicOffset;

    // Localized BirdNET detection emergence
    float detAlign = max(0.0, dot(dir, normalize(uDetectionDir)));
    float detMask = pow(detAlign, 10.0) * uDetectionStrength;
    displaced += dir * detMask * 0.28;

    // Localized disturbance trajectory disruption (non-alarmist physical displacement)
    float distAlign = max(0.0, dot(dir, normalize(uDisturbanceDir)));
    float distMask = pow(distAlign, 6.0) * uDisturbanceStrength;
    vec3 tangent = normalize(cross(dir, vec3(0.0, 1.0, 0.15)) + vec3(0.001));
    displaced += (dir * 0.22 + tangent * sin(aSeed * 12.0 + uPhase * 3.0) * 0.18) * distMask;

    // Restrained cursor/touch spatial response
    vec3 toParticle = displaced - uPointerPos;
    float pDist = length(toParticle);
    float pInfluence = smoothstep(0.95, 0.0, pDist) * uPointerPresence * (1.0 - uReducedMotion);
    if (pDist > 0.001) {
      displaced += (toParticle / pDist) * pInfluence * 0.16;
    }

    // Causal Phase A->E morph from shallow pool surface ripple (y = -0.56) -> frequency strata -> ACT 06 field
    float soundAudioGate = 1.0;
    if (uFieldMorph < 0.999) {
      float m = clamp(uFieldMorph, 0.0, 1.0);
      float theta = atan(basePos.z, basePos.x);
      float ringR = 0.16 + length(basePos.xz) * 0.96 + (aSeed - 0.5) * 0.18;
      float bandStrength = clamp(activeBand * 2.2 + uEnergy * 1.4, 0.0, 1.0);
      float audioSignal = clamp(uEnergy * 3.8 + uFlux * 2.2 + bandStrength * 0.45, 0.0, 1.0);
      float activeDrive = clamp(audioSignal * (1.0 - uSilence * 0.82) + uWaterImpulse * 0.55, 0.04, 1.0);

      // Phase A/B: capillary wave crest aligned with physical impact & subtle acoustic modulation
      float crest = sin(ringR * 11.5 - (uWaterRippleAge * 3.4 + uPhase * 2.2) * (1.0 - uReducedMotion * 0.75));
      float waveY = -0.56 + crest * (0.018 + 0.085 * activeDrive) * exp(-ringR * 0.36);

      // Phase C: frequency-dependent vertical separation across the 4 ecological bands
      float bandLiftPhase = smoothstep(0.22, 0.72, m);
      float freqStratumHeight = (aBand - 1.35) * 0.28 + activeBand * 0.38 * (1.0 - uSilence * 0.78);
      float liftCurve = mix(waveY, mix(basePos.y * 0.48 + freqStratumHeight, displaced.y, smoothstep(0.55, 0.92, m)), bandLiftPhase);

      vec3 ringOrigin = vec3(
        uImpactOrigin.x * (1.0 - smoothstep(0.15, 0.85, m)) + cos(theta) * ringR,
        liftCurve,
        uImpactOrigin.y * 0.15 * (1.0 - smoothstep(0.15, 0.85, m)) + sin(theta) * ringR
      );
      float spatialFold = smoothstep(0.32, 0.96, m);
      displaced = mix(ringOrigin, displaced, spatialFold);

      // When SILENT in ACT 05, quiet particles remain settled/sparse rather than dancing arbitrarily
      float crestSelect = smoothstep(-0.35, 0.65, crest) * 0.45 + 0.55;
      soundAudioGate = mix(mix(0.24, 1.0, activeDrive) * mix(crestSelect, 1.0, bandLiftPhase), 1.0, smoothstep(0.84, 1.0, m));
    }

    vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float depthNorm = clamp((-mvPosition.z - 2.5) / 5.5, 0.0, 1.0);
    vDepth = depthNorm;
    vDetectionGlow = detMask;
    vDisturbanceMix = clamp(distMask * 1.35, 0.0, 1.0);

    // Continuous ecological band palette (desaturated documentary pigments, balanced luminance)
    // Band 0 (sub-biotic): deep indigo / muted violet (#5C548A)
    // Band 1 (mid-biotic): desaturated moss green (#4E7E66)
    // Band 2 (avian-high): muted ochre / amber (#AE794B)
    // Band 3 (atmospheric): desaturated blue / slate-cyan (#5D8A9E)
    vec3 cIndigo = vec3(0.361, 0.329, 0.541);
    vec3 cMoss   = vec3(0.306, 0.494, 0.400);
    vec3 cOchre  = vec3(0.682, 0.475, 0.294);
    vec3 cBlue   = vec3(0.365, 0.541, 0.620);

    // Smooth continuous band coordinate with gentle organic boundary blending (not hard stripes)
    float smoothBand = clamp(aBand + (aSeed - 0.5) * 0.72 + (uCentroid - 0.38) * 0.45, 0.0, 3.0);
    vec3 stratumCol = mix(cIndigo, cMoss, smoothstep(0.0, 1.0, smoothBand));
    stratumCol = mix(stratumCol, cOchre, smoothstep(1.0, 2.0, smoothBand));
    stratumCol = mix(stratumCol, cBlue, smoothstep(2.0, 3.0, smoothBand));

    // Global live acoustic-band energy contribution so the whole field reflects live sound structure
    vec4 bandWeights = uBands + vec4(0.035, 0.055, 0.030, 0.025);
    float bandSum = max(0.001, bandWeights.x + bandWeights.y + bandWeights.z + bandWeights.w);
    vec4 normBands = bandWeights / bandSum;
    vec3 liveFieldTint =
      cIndigo * normBands.x +
      cMoss   * normBands.y +
      cOchre  * normBands.z +
      cBlue   * normBands.w;

    // Blend particle's continuous ecological stratum with live global acoustic structure
    vec3 ecologicalCol = mix(stratumCol, liveFieldTint, 0.46);

    // Subtle global high-frequency avian ochre bias during a BirdNET detection (restrained, non-flashing)
    float detBias = uDetectionStrength * (1.0 - uReducedMotion * 0.4) * 0.22;
    ecologicalCol = mix(ecologicalCol, cOchre, detBias);

    vAcousticColor = ecologicalCol;

    // Chromatic intensity responds smoothly to live audio activity & flux, desaturating on silence
    float fluxBoost = uFlux * (1.0 - uReducedMotion * 0.85) * 0.22;
    float activity = clamp(0.42 + uEnergy * 1.45 + activeBand * 0.85 + fluxBoost + uDetectionStrength * 0.2, 0.35, 1.0);
    vChroma = activity * (1.0 - uSilence * 0.86);

    float baseSize = mix(2.3, 4.0, fract(aSeed * 7.13));
    float activityBoost = 1.0 + activeBand * 0.45 + detMask * 0.85;
    float quietScale = mix(1.0, 0.68, clamp(uSilence, 0.0, 1.0) * smoothstep(0.88, 0.25, uFieldOpacity));
    gl_PointSize = baseSize * activityBoost * quietScale * uPointScale * uPixelRatio * (4.4 / max(1.2, -mvPosition.z));

    float settleDim = mix(1.0, 0.56, uSilence);
    vAlpha = clamp((0.34 + (1.0 - depthNorm) * 0.58 + detMask * 0.35) * settleDim, 0.16, 0.96) * clamp(uFieldOpacity, 0.0, 1.0) * soundAudioGate;
  }
`;

export const FIELD_PARTICLE_FRAGMENT_SHADER = /* glsl */ `
  varying float vAlpha;
  varying float vDepth;
  varying float vDetectionGlow;
  varying float vDisturbanceMix;
  varying vec3 vAcousticColor;
  varying float vChroma;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float r2 = dot(uv, uv);
    if (r2 > 0.25) discard;

    float softEdge = 1.0 - smoothstep(0.06, 0.25, r2);

    // Quiet baseline charcoal-moss / muted slate (#2D3D35 -> #68726E)
    vec3 quietBase = mix(vec3(0.16, 0.22, 0.19), vec3(0.42, 0.46, 0.44), 1.0 - vDepth);
    vec3 parchment = vec3(0.910, 0.894, 0.863);
    vec3 ochreDisturb = vec3(0.784, 0.427, 0.231); // #C86D3B oxidized ochre

    // Smooth transition between quiet baseline and active ecological multicolor
    vec3 baseColor = mix(quietBase, vAcousticColor, clamp(vChroma, 0.08, 0.92));

    // Subtle luminance lift in foreground particles without neon bloom
    baseColor = mix(baseColor, parchment, (1.0 - vDepth) * 0.16 * vChroma);

    // Localized BirdNET detection highlights toward warm avian ochre + parchment
    vec3 detHighlight = mix(vec3(0.761, 0.514, 0.290), parchment, 0.55);
    baseColor = mix(baseColor, detHighlight, clamp(vDetectionGlow * 0.88, 0.0, 0.88));

    // Localized disturbance shifts local trajectory toward oxidized ochre (never red)
    baseColor = mix(baseColor, ochreDisturb, clamp(vDisturbanceMix * 0.85, 0.0, 0.85));

    // Subtle atmospheric depth attenuation into obsidian
    baseColor *= mix(1.0, 0.54, vDepth);

    gl_FragColor = vec4(baseColor, softEdge * vAlpha);
  }
`;

export const ORBIT_STRATA_VERTEX_SHADER = /* glsl */ `
  uniform float uPhase;
  uniform float uBandEnergy;
  uniform float uSilence;
  uniform float uReducedMotion;
  uniform vec3 uDisturbanceDir;
  uniform float uDisturbanceStrength;

  attribute float aProgress;
  varying float vProgress;
  varying float vDisturb;

  void main() {
    vec3 pos = position;
    float len = length(pos);
    vec3 dir = len > 0.0001 ? pos / len : vec3(0.0, 1.0, 0.0);

    float motionGate = (1.0 - uSilence * 0.9) * (1.0 - uReducedMotion * 0.85);
    float wave = sin(aProgress * 18.8495 + uPhase * 0.85) * (0.018 + uBandEnergy * 0.075) * motionGate;

    float distAlign = max(0.0, dot(dir, normalize(uDisturbanceDir)));
    float distMask = pow(distAlign, 5.0) * uDisturbanceStrength;

    vec3 displaced = pos * (1.0 + uBandEnergy * 0.06 + wave) + dir * distMask * 0.14;
    vProgress = aProgress;
    vDisturb = distMask;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

export const ORBIT_STRATA_FRAGMENT_SHADER = /* glsl */ `
  uniform float uPhase;
  uniform float uBandEnergy;
  uniform float uSilence;
  uniform float uReducedMotion;
  uniform float uDetectionStrength;
  uniform vec3 uBaseColor;
  uniform float uBaseOpacity;
  uniform float uFieldOpacity;

  varying float vProgress;
  varying float vDisturb;

  void main() {
    // Travelling acoustic trace along the orbital trajectory (adapted from orbit-controls motif)
    float head = fract(uPhase * 0.09);
    float dist = fract(head - vProgress);
    float trace = smoothstep(0.28, 0.0, dist) * (1.0 - uSilence * 0.72) * (1.0 - uReducedMotion * 0.75);

    vec3 quietSlate = vec3(0.32, 0.36, 0.35);
    vec3 ochre = vec3(0.784, 0.427, 0.231);
    vec3 avianAmber = vec3(0.761, 0.514, 0.290);
    vec3 parchment = vec3(0.910, 0.894, 0.863);

    // Desaturate orbital stratum toward slate on silence; subtly warm toward avian amber on detection
    vec3 bandCol = mix(uBaseColor, quietSlate, uSilence * 0.82);
    bandCol = mix(bandCol, avianAmber, uDetectionStrength * 0.22);

    vec3 col = mix(bandCol, parchment, trace * (0.42 + uBandEnergy * 0.42));
    col = mix(col, ochre, clamp(vDisturb * 0.85, 0.0, 0.85));

    float silenceCollapse = mix(1.0, 0.36, uSilence * smoothstep(0.92, 0.35, uFieldOpacity));
    float alpha = (uBaseOpacity * mix(1.0, 0.48, uSilence) * silenceCollapse + trace * 0.26 * silenceCollapse) * clamp(uFieldOpacity, 0.0, 1.0);
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.75));
  }
`;

export const CORE_VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormalView;
  varying vec3 vViewPos;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPos = -mvPosition.xyz;
    vNormalView = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const CORE_FRAGMENT_SHADER = /* glsl */ `
  uniform float uEnergy;
  uniform vec4 uBands;
  uniform float uSilence;
  uniform float uDisturbanceStrength;
  uniform float uFieldOpacity;

  varying vec3 vNormalView;
  varying vec3 vViewPos;

  void main() {
    vec3 n = normalize(vNormalView);
    vec3 v = normalize(vViewPos);
    float fresnel = pow(1.0 - max(0.0, dot(n, v)), 3.4);

    // Core remains obsidian; its whisper-thin Fresnel rim reflects subtle surrounding acoustic tint
    vec3 obsidian = vec3(0.024, 0.027, 0.031);
    vec3 cIndigo = vec3(0.24, 0.21, 0.38);
    vec3 cMoss   = vec3(0.114, 0.200, 0.153);
    vec3 cOchre  = vec3(0.62, 0.41, 0.24);
    vec3 cBlue   = vec3(0.22, 0.34, 0.40);

    vec4 bw = uBands + vec4(0.02, 0.06, 0.02, 0.02);
    float bSum = max(0.001, bw.x + bw.y + bw.z + bw.w);
    vec4 nb = bw / bSum;
    vec3 ambientRim = cIndigo * nb.x + cMoss * nb.y + cOchre * nb.z + cBlue * nb.w;
    ambientRim = mix(ambientRim, cMoss, uSilence * 0.8);

    vec3 ochreDisturb = vec3(0.784, 0.427, 0.231);
    vec3 rimColor = mix(ambientRim, ochreDisturb, clamp(uDisturbanceStrength * 0.55, 0.0, 0.55));
    float rimStrength = fresnel * (0.28 + uEnergy * 0.28) * mix(1.0, 0.52, uSilence);

    vec3 col = mix(obsidian, rimColor, rimStrength);
    float corePresence = smoothstep(0.18, 0.55, uFieldOpacity);
    gl_FragColor = vec4(col, 0.95 * clamp(uFieldOpacity, 0.0, 1.0) * corePresence);
  }
`;
