/**
 * Monochrome physically shaded 3D hero-leaf shaders for ACT 03 — LEAF (and ACT 04 water mooring).
 * Subtle organic lamina camber + midrib spine + aerodynamic flutter flex + strict monochrome luminance.
 */

export const HERO_LEAF_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform float uFlutterFlex;
uniform float uMotionScale;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vTangent;
varying vec3 vBitangent;
varying float vVeinDepth;

float evalLeafHeight(vec2 uvCoord, float timeVal, float flexVal, float motionScaleVal, out float veinMaskOut) {
  float lateral = (uvCoord.x - 0.5) * 2.0; // [-1..1]
  float along = uvCoord.y;                 // [0 petiole base .. 1 apex]
  float absLat = abs(lateral);

  // Subtle botanical petiole-to-apex S-arch & gentle lamina camber
  float midribArch = -sin(along * 3.14159) * 0.009 + lateral * (along - 0.35) * 0.003;
  float crossGutter = absLat * (0.005 * (1.0 - along * 0.45));
  float curlTip = pow(along, 2.35) * (-0.008) + pow(absLat, 2.6) * 0.002;

  float bladeZone = smoothstep(0.14, 0.28, along) * (1.0 - smoothstep(0.84, 0.99, along)) * smoothstep(0.05, 0.24, absLat);
  float sidePhase = lateral >= 0.0 ? 0.0 : 0.48;
  float ribCoord = along * 6.8 - absLat * 2.15 + sidePhase;
  float interveinalDome = pow(abs(sin(ribCoord * 3.14159)), 0.72) * 0.0045 * bladeZone;
  veinMaskOut = (1.0 - pow(abs(sin(ribCoord * 3.14159)), 0.55)) * bladeZone;

  float stemSpine = exp(-absLat * absLat * 140.0) * (1.0 - along * 0.72) * 0.004;

  // Restrained aerodynamic wing-tip flutter along lamina in flight
  float aeroFlutter = sin(timeVal * 5.2 + along * 4.6 + lateral * 2.2) * pow(along, 1.35) * flexVal * motionScaleVal;

  return midribArch + crossGutter + curlTip + interveinalDome + stemSpine + aeroFlutter;
}

void main() {
  vUv = uv;
  vec3 pos = position;

  float veinMask = 0.0;
  float hCenter = evalLeafHeight(uv, uTime, uFlutterFlex, uMotionScale, veinMask);
  pos.z += hCenter;
  vVeinDepth = veinMask;

  float eps = 0.012;
  float dummyV = 0.0;
  float hx = evalLeafHeight(uv + vec2(eps, 0.0), uTime, uFlutterFlex, uMotionScale, dummyV);
  float hy = evalLeafHeight(uv + vec2(0.0, eps), uTime, uFlutterFlex, uMotionScale, dummyV);
  float dzdx = (hx - hCenter) / (eps * 0.30);
  float dzdy = (hy - hCenter) / (eps * 0.46);

  vec3 localNormal = normalize(vec3(-dzdx, -dzdy, 1.0));
  vec3 localTangent = normalize(vec3(1.0, 0.0, dzdx));
  vec3 localBitangent = normalize(cross(localNormal, localTangent));

  vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
  vWorldPos = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * localNormal);
  vTangent = normalize(mat3(modelMatrix) * localTangent);
  vBitangent = normalize(mat3(modelMatrix) * localBitangent);

  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const HERO_LEAF_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform sampler2D uAlbedoTex;
uniform sampler2D uNormalTex;
uniform float uOpacity;
uniform float uWetSheen;
uniform float uCamouflage;
uniform float uClipBelowY;
uniform vec3 uCameraPos;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vTangent;
varying vec3 vBitangent;
varying float vVeinDepth;

void main() {
  if (uClipBelowY > -50.0 && vWorldPos.y < uClipBelowY) discard;

  vec4 tex = texture2D(uAlbedoTex, vUv);
  float alphaCutoff = mix(0.30, 0.35, uCamouflage);
  if (tex.a < alphaCutoff || uOpacity <= 0.005) discard;

  vec3 mapN = texture2D(uNormalTex, vUv).xyz * 2.0 - 1.0;
  vec3 nBase = normalize(vWorldNormal);
  vec3 tVec = normalize(vTangent);
  vec3 bVec = normalize(vBitangent);
  float normalStrength = gl_FrontFacing ? 0.85 : 1.0;
  vec3 N = normalize(tVec * mapN.x * normalStrength + bVec * mapN.y * normalStrength + nBase);

  bool isUpperFace = gl_FrontFacing;
  if (!isUpperFace) {
    N = -N;
  }

  vec3 V = normalize(uCameraPos - vWorldPos);
  vec3 L = normalize(vec3(0.30, 0.64, 0.71));
  vec3 Lfill = normalize(vec3(-0.46, 0.36, 0.68));
  vec3 H = normalize(L + V);

  float NdotL = max(dot(N, L), 0.0);
  float wrapDiffuse = max(0.0, (dot(N, L) + 0.56) / 1.56);
  float fillDiffuse = max(0.0, (dot(N, Lfill) + 0.40) / 1.40);
  float rimView = 1.0 - max(dot(N, V), 0.0);

  // Strict monochrome luminance matching surrounding tree foliage (zero color, zero artificial glow)
  float rawLum = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
  float monoLum = pow(max(rawLum, 0.0), 0.90);
  vec3 detailTex = texture2D(uNormalTex, vUv).rgb;
  float absLat = abs((vUv.x - 0.5) * 2.0);
  float midribBand = exp(-absLat * absLat * 180.0) * (1.0 - vUv.y * 0.4);
  float thickness = clamp(0.24 + vVeinDepth * 0.35 + midribBand * 0.42 + detailTex.b * 0.18, 0.2, 1.0);

  vec3 adaxialAlbedo = vec3(monoLum);
  vec3 abaxialAlbedo = vec3(clamp(monoLum * 1.38 + 0.10, 0.0, 0.68));
  vec3 faceAlbedo = isUpperFace ? adaxialAlbedo : abaxialAlbedo;

  float branchShadow = mix(1.0, 0.82 + 0.18 * smoothstep(0.08, 0.80, vUv.y), uCamouflage);
  vec3 baseAlbedo = faceAlbedo * branchShadow;

  float backDot = pow(max(0.0, dot(V, -L)), 2.2);
  float forwardScatter = (backDot * 0.28 + pow(rimView, 2.6) * 0.14) * (1.10 - thickness * 0.62);
  vec3 sssTint = isUpperFace ? vec3(0.12) : vec3(0.18);

  vec3 diffuse =
    baseAlbedo * (vec3(0.62) + vec3(0.74) * wrapDiffuse + vec3(0.28) * fillDiffuse * 0.38) +
    sssTint * forwardScatter * (1.0 - uCamouflage * 0.50);

  float rough = isUpperFace ? mix(0.46, 0.26, uWetSheen * (1.0 - vVeinDepth * 0.3)) : 0.64;
  float alpha2 = rough * rough * rough * rough;
  float NdotH = max(dot(N, H), 0.0);
  float denom = (NdotH * NdotH) * (alpha2 - 1.0) + 1.0;
  float ggxD = alpha2 / (3.14159 * denom * denom + 0.0001);
  float fresnel = 0.03 + 0.97 * pow(rimView, 3.6);
  float specScale = isUpperFace ? uWetSheen * 0.22 : uWetSheen * 0.07;
  vec3 wetSpec = vec3(0.68) * (min(ggxD * 0.07, 0.50) + fresnel * 0.34) * specScale * (0.45 + 0.55 * NdotL);

  vec3 color = diffuse + wetSpec;
  float edgeAlpha = smoothstep(alphaCutoff, mix(0.64, 0.72, uCamouflage), tex.a) * uOpacity;
  gl_FragColor = vec4(color, edgeAlpha);
}
`;
