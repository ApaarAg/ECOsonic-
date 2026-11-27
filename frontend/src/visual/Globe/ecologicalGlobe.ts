import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import worldLand from "../../assets/geo/world-land.json";

interface WorldLandPayload {
  dots: [number, number][];
  outlines: [number, number][][];
}

function latLngToSphere(lat: number, lng: number, radius: number, out: Vector3): Vector3 {
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;
  const cosLat = Math.cos(latRad);
  out.set(
    cosLat * Math.sin(lngRad) * radius,
    Math.sin(latRad) * radius,
    cosLat * Math.cos(lngRad) * radius,
  );
  return out;
}

const LAND_DOT_VERTEX_SHADER = /* glsl */ `
  uniform float uPixelRatio;
  uniform float uPointScale;
  uniform float uOpacity;
  attribute float aTone;
  varying float vHorizon;
  varying float vTone;

  void main() {
    vTone = aTone;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vec3 viewDir = normalize(-mvPos.xyz);
    vec3 nView = normalize(normalMatrix * normalize(position));
    vHorizon = smoothstep(-0.02, 0.38, dot(nView, viewDir));
    gl_Position = projectionMatrix * mvPos;
    gl_PointSize = clamp(2.8 * uPointScale * uPixelRatio * (5.2 / max(1.6, -mvPos.z)), 1.6, 5.2);
  }
`;

const LAND_DOT_FRAGMENT_SHADER = /* glsl */ `
  uniform float uOpacity;
  varying float vHorizon;
  varying float vTone;

  void main() {
    if (vHorizon <= 0.01 || uOpacity <= 0.005) discard;
    vec2 uv = gl_PointCoord - 0.5;
    float r2 = dot(uv, uv);
    if (r2 > 0.25) discard;
    float edge = 1.0 - smoothstep(0.08, 0.25, r2);

    vec3 moss = vec3(0.41, 0.64, 0.51);
    vec3 mineralSlate = vec3(0.71, 0.75, 0.72);
    vec3 col = mix(moss, mineralSlate, vTone * 0.65);
    gl_FragColor = vec4(col, edge * (0.35 + 0.65 * vHorizon) * 0.92 * uOpacity);
  }
`;

const GLOBE_RIM_VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const GLOBE_RIM_FRAGMENT_SHADER = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    float fresnel = 1.0 - max(dot(normalize(vNormal), normalize(vViewDir)), 0.0);
    float rim = pow(fresnel, 3.8);
    vec3 atmosSlate = vec3(0.365, 0.541, 0.620);
    gl_FragColor = vec4(atmosSlate, rim * 0.28 * uOpacity);
  }
`;

const OCEAN_VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const OCEAN_FRAGMENT_SHADER = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vViewDir);
    vec3 l = normalize(vec3(-0.35, 0.6, 0.7));
    float diff = max(dot(n, l), 0.0);
    float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);

    vec3 obsidian = vec3(0.024, 0.029, 0.032);
    vec3 slateShadow = vec3(0.055, 0.072, 0.068);
    vec3 col = mix(obsidian, slateShadow, diff * 0.65 + rim * 0.35);
    gl_FragColor = vec4(col, 0.96 * uOpacity);
  }
`;

export interface EcologicalGlobeHandle {
  readonly group: Group;
  update: (
    dt: number,
    opacity: number,
    viewportWidth: number,
    pixelRatio: number,
    reducedMotion: boolean,
    locusLat: number | null,
    locusLng: number | null,
  ) => void;
  dispose: () => void;
}

/**
 * Ecological Context Globe adapted from OriginKit `globe.tsx` primitives
 * (landmass dot distribution, shoreline paths, atmospheric Fresnel rim, observation beacon)
 * re-engineered cleanly onto bundled Natural Earth 110m vectors in the single WebGLStage.
 */
export function createEcologicalGlobeLayer(): EcologicalGlobeHandle {
  const data = worldLand as unknown as WorldLandPayload;
  const radius = 1.18;

  const group = new Group();
  group.name = "Act10EcologicalGlobe";
  group.visible = false;

  const spinGroup = new Group();
  group.add(spinGroup);

  const tmp = new Vector3();

  // 1. Matte Obsidian Basin Ocean Sphere (non-blue, scientific documentary ground)
  const oceanGeo = new SphereGeometry(radius, 56, 48);
  const oceanMat = new ShaderMaterial({
    vertexShader: OCEAN_VERTEX_SHADER,
    fragmentShader: OCEAN_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: true,
    uniforms: { uOpacity: { value: 0 } },
  });
  const oceanMesh = new Mesh(oceanGeo, oceanMat);
  spinGroup.add(oceanMesh);

  // 2. Restrained Atmospheric Horizon Rim (adapted from globe.tsx rimMaterial)
  const rimGeo = new SphereGeometry(radius * 1.008, 48, 40);
  const rimMat = new ShaderMaterial({
    vertexShader: GLOBE_RIM_VERTEX_SHADER,
    fragmentShader: GLOBE_RIM_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uOpacity: { value: 0 } },
  });
  const rimMesh = new Mesh(rimGeo, rimMat);
  spinGroup.add(rimMesh);

  // 3. Offline Natural Earth Continental Land Dots (placed cleanly above sphere triangles)
  const dotPositions = new Float32Array(data.dots.length * 3);
  const dotTones = new Float32Array(data.dots.length);
  for (let i = 0; i < data.dots.length; i++) {
    const [lat, lng] = data.dots[i];
    latLngToSphere(lat, lng, radius * 1.014, tmp);
    dotPositions[i * 3] = tmp.x;
    dotPositions[i * 3 + 1] = tmp.y;
    dotPositions[i * 3 + 2] = tmp.z;
    dotTones[i] = Math.min(1, Math.abs(lat) / 65);
  }
  const dotsGeo = new BufferGeometry();
  dotsGeo.setAttribute("position", new Float32BufferAttribute(dotPositions, 3));
  dotsGeo.setAttribute("aTone", new Float32BufferAttribute(dotTones, 1));
  const dotsMat = new ShaderMaterial({
    vertexShader: LAND_DOT_VERTEX_SHADER,
    fragmentShader: LAND_DOT_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uPixelRatio: { value: 1 },
      uPointScale: { value: 1 },
      uOpacity: { value: 0 },
    },
  });
  const dotsPoints = new Points(dotsGeo, dotsMat);
  dotsPoints.renderOrder = 2;
  spinGroup.add(dotsPoints);

  // 4. Minimal Continental Coastline Vectors
  const lineCoords: number[] = [];
  const aVec = new Vector3();
  const bVec = new Vector3();
  for (const ring of data.outlines) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [lng0, lat0] = ring[i];
      const [lng1, lat1] = ring[i + 1];
      if (Math.abs(lng1 - lng0) > 120) continue;
      latLngToSphere(lat0, lng0, radius * 1.016, aVec);
      latLngToSphere(lat1, lng1, radius * 1.016, bVec);
      lineCoords.push(aVec.x, aVec.y, aVec.z, bVec.x, bVec.y, bVec.z);
    }
  }
  const coastGeo = new BufferGeometry();
  coastGeo.setAttribute("position", new Float32BufferAttribute(new Float32Array(lineCoords), 3));
  const coastMat = new LineBasicMaterial({
    color: new Color("#9AA89F"),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const coastLines = new LineSegments(coastGeo, coastMat);
  coastLines.renderOrder = 2;
  spinGroup.add(coastLines);

  // 4b. Restrained Scientific Graticule Meridian & Latitude Hairlines (equator & +/-45 deg)
  const gratCoords: number[] = [];
  for (const lat of [-45, 0, 45]) {
    for (let lng = -180; lng < 180; lng += 6) {
      latLngToSphere(lat, lng, radius * 1.011, aVec);
      latLngToSphere(lat, lng + 6, radius * 1.011, bVec);
      gratCoords.push(aVec.x, aVec.y, aVec.z, bVec.x, bVec.y, bVec.z);
    }
  }
  for (let lng = -180; lng < 180; lng += 45) {
    for (let lat = -84; lat < 84; lat += 6) {
      latLngToSphere(lat, lng, radius * 1.011, aVec);
      latLngToSphere(lat + 6, lng, radius * 1.011, bVec);
      gratCoords.push(aVec.x, aVec.y, aVec.z, bVec.x, bVec.y, bVec.z);
    }
  }
  const gratGeo = new BufferGeometry();
  gratGeo.setAttribute("position", new Float32BufferAttribute(new Float32Array(gratCoords), 3));
  const gratMat = new LineBasicMaterial({
    color: new Color("#4F5C58"),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const gratLines = new LineSegments(gratGeo, gratMat);
  gratLines.renderOrder = 1;
  spinGroup.add(gratLines);

  // 5. Generalized Observation Locus Beacon (only visible when real coordinates exist)
  const locusGroup = new Group();
  locusGroup.visible = false;
  spinGroup.add(locusGroup);

  const ringPts: number[] = [];
  const ringSegs = 40;
  for (let i = 0; i < ringSegs; i++) {
    const a = (i / ringSegs) * Math.PI * 2;
    ringPts.push(Math.cos(a) * 0.065, Math.sin(a) * 0.065, 0);
  }
  const locusRingGeo = new BufferGeometry();
  locusRingGeo.setAttribute("position", new Float32BufferAttribute(new Float32Array(ringPts), 3));
  const locusRingMat = new LineBasicMaterial({
    color: new Color("#C89B62"),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const locusRing = new LineLoop(locusRingGeo, locusRingMat);
  locusGroup.add(locusRing);

  const beaconGeo = new SphereGeometry(0.022, 16, 16);
  const beaconMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: "void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "uniform float uOpacity; void main() { gl_FragColor = vec4(0.910, 0.894, 0.863, uOpacity); }",
    uniforms: { uOpacity: { value: 0 } },
  });
  const beaconMesh = new Mesh(beaconGeo, beaconMat);
  locusGroup.add(beaconMesh);

  // Track smoothed orientation toward observation region (default temperate N. America ~46N, -110W)
  let currentYaw = 0;
  let currentPitch = 0.42;
  let seededOrientation = false;
  let idleDrift = 0;

  return {
    group,
    update(dt, opacity, viewportWidth, pixelRatio, reducedMotion, locusLat, locusLng) {
      group.visible = opacity > 0.005;
      if (!group.visible) return;

      const isMobile = viewportWidth < 1024;
      // Adaptive composition: desktop left-balanced split, mobile unobstructed upper-third globe
      const targetScale = isMobile ? 0.54 : 1.05;
      const targetX = isMobile ? 0 : -1.08;
      const targetY = isMobile ? 1.62 : 0.04;
      group.scale.setScalar(targetScale);
      group.position.set(targetX, targetY, 0);

      // Compute calm orientation facing real generalized coordinate when known
      const targetLat = typeof locusLat === "number" ? locusLat : 46.5;
      const targetLng = typeof locusLng === "number" ? locusLng : -114.0;
      const baseYaw = (-targetLng * Math.PI) / 180;
      const basePitch = Math.max(-0.85, Math.min(0.85, (targetLat * Math.PI) / 180));

      if (!reducedMotion) {
        idleDrift = Math.sin(performance.now() * 0.00018) * 0.09;
      } else {
        idleDrift = 0;
      }

      if (!seededOrientation) {
        currentYaw = baseYaw + idleDrift;
        currentPitch = basePitch;
        seededOrientation = true;
      } else {
        const alpha = reducedMotion ? 1 : 1 - Math.exp(-2.8 * dt);
        currentYaw += (baseYaw + idleDrift - currentYaw) * alpha;
        currentPitch += (basePitch - currentPitch) * alpha;
      }

      spinGroup.rotation.y = currentYaw;
      spinGroup.rotation.x = currentPitch;

      oceanMat.uniforms.uOpacity.value = opacity;
      rimMat.uniforms.uOpacity.value = opacity;
      dotsMat.uniforms.uOpacity.value = opacity;
      dotsMat.uniforms.uPixelRatio.value = pixelRatio;
      dotsMat.uniforms.uPointScale.value = isMobile ? 0.92 : 1.08;
      coastMat.opacity = 0.42 * opacity;
      gratMat.opacity = 0.16 * opacity;

      // Show geospatial observation beacon ONLY when real generalized coordinates exist
      const hasRealCoords = typeof locusLat === "number" && typeof locusLng === "number";
      locusGroup.visible = hasRealCoords;
      if (hasRealCoords && locusLat !== null && locusLng !== null) {
        latLngToSphere(locusLat, locusLng, radius * 1.022, tmp);
        locusGroup.position.copy(tmp);
        locusGroup.lookAt(tmp.clone().multiplyScalar(2));
        locusRingMat.opacity = 0.90 * opacity;
        beaconMat.uniforms.uOpacity.value = 0.98 * opacity;
      }
    },
    dispose() {
      oceanGeo.dispose();
      oceanMat.dispose();
      rimGeo.dispose();
      rimMat.dispose();
      dotsGeo.dispose();
      dotsMat.dispose();
      coastGeo.dispose();
      coastMat.dispose();
      gratGeo.dispose();
      gratMat.dispose();
      locusRingGeo.dispose();
      locusRingMat.dispose();
      beaconGeo.dispose();
      beaconMat.dispose();
    },
  };
}
