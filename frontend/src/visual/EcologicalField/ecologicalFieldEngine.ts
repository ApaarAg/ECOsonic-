import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  LineLoop,
  LineSegments,
  Points,
  ShaderMaterial,
} from "three";
import type { WebGLStage } from "../engine/WebGLStage";
import type { EcologicalFieldBudget } from "../engine/viewportBudget";
import {
  ECOLOGICAL_BEACON_FRAGMENT_SHADER,
  ECOLOGICAL_BEACON_VERTEX_SHADER,
  ECOLOGICAL_FIELD_NODE_FRAGMENT_SHADER,
  ECOLOGICAL_FIELD_NODE_VERTEX_SHADER,
  ECOLOGICAL_FILAMENT_FRAGMENT_SHADER,
  ECOLOGICAL_FILAMENT_VERTEX_SHADER,
  ECOLOGICAL_STRATUM_FRAGMENT_SHADER,
  ECOLOGICAL_STRATUM_VERTEX_SHADER,
} from "./ecologicalFieldShaders";

/** Deterministic pseudo-random number generator for reproducible particle distribution. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface EcologicalManifoldGeometryData {
  nodeGeo: BufferGeometry;
  filamentGeo: BufferGeometry;
  beaconGeo: BufferGeometry;
}

export function buildEcologicalManifoldGeometry(
  nodeCount: number,
  maxFilaments: number,
  distanceThreshold = 1.15,
  seed = 422026,
): EcologicalManifoldGeometryData {
  const rand = mulberry32(seed);

  const nodePositions = new Float32Array(nodeCount * 3);
  const nodePhases = new Float32Array(nodeCount);
  const nodeTiers = new Float32Array(nodeCount);
  const nodeSizes = new Float32Array(nodeCount);
  const nodeSeeds = new Float32Array(nodeCount);

  // Large-scale organic bioacoustic manifold centered cleanly in the camera frustum
  const goldenRatio = (1 + Math.sqrt(5)) / 2;

  for (let i = 0; i < nodeCount; i++) {
    const t = i / nodeCount;
    const u = ((i * goldenRatio) % 1) * Math.PI * 2;
    const v = t * Math.PI * 2;

    // Asymmetric undulating organic ridge & valley shell
    const majorR = 1.85 + Math.sin(u * 2.0 + v) * 0.34;
    const minorR = 0.88 + Math.cos(v * 3.0 - u) * 0.24;

    const harmonicA = Math.sin(u * 3.0 + v * 2.0) * 0.24;
    const harmonicB = Math.cos(u * 2.0 - v * 3.0) * 0.18;

    const x = Math.cos(u) * (majorR + minorR * Math.cos(v)) * 1.38 + (rand() - 0.5) * 0.26;
    const y = Math.sin(v) * (minorR * 0.92) + harmonicA + (rand() - 0.5) * 0.22;
    const z = Math.sin(u) * (majorR + minorR * Math.cos(v)) * 0.58 + harmonicB - 0.65 + (rand() - 0.5) * 0.28;

    nodePositions[i * 3] = x;
    nodePositions[i * 3 + 1] = y;
    nodePositions[i * 3 + 2] = z;

    nodePhases[i] = rand() * Math.PI * 2;

    // Palette distribution:
    // 55% deep obsidian/graphite-lichen (Tier 0)
    // 32% desaturated forest moss (Tier 1)
    // 13% restrained warm ochre accent (Tier 2)
    const tierRoll = rand();
    if (tierRoll < 0.55) {
      nodeTiers[i] = 0;
      nodeSizes[i] = 0.9 + rand() * 0.45;
    } else if (tierRoll < 0.87) {
      nodeTiers[i] = 1;
      nodeSizes[i] = 1.15 + rand() * 0.55;
    } else {
      nodeTiers[i] = 2;
      nodeSizes[i] = 1.35 + rand() * 0.65;
    }

    nodeSeeds[i] = rand();
  }

  const nodeGeo = new BufferGeometry();
  nodeGeo.setAttribute("position", new Float32BufferAttribute(nodePositions, 3));
  nodeGeo.setAttribute("aPhase", new Float32BufferAttribute(nodePhases, 1));
  nodeGeo.setAttribute("aTier", new Float32BufferAttribute(nodeTiers, 1));
  nodeGeo.setAttribute("aSize", new Float32BufferAttribute(nodeSizes, 1));
  nodeGeo.setAttribute("aSeed", new Float32BufferAttribute(nodeSeeds, 1));

  // Build connected filaments between neighboring nodes (spatial ecological lattice)
  const linePositions: number[] = [];
  const lineAlphas: number[] = [];
  const linePhases: number[] = [];

  const maxNeighborsPerNode = 3;
  let filamentCount = 0;
  const maxDistSq = distanceThreshold * distanceThreshold;

  for (let i = 0; i < nodeCount && filamentCount < maxFilaments; i++) {
    const x1 = nodePositions[i * 3];
    const y1 = nodePositions[i * 3 + 1];
    const z1 = nodePositions[i * 3 + 2];
    const phase1 = nodePhases[i];

    let neighborsFound = 0;

    for (let j = i + 1; j < nodeCount && filamentCount < maxFilaments && neighborsFound < maxNeighborsPerNode; j++) {
      const x2 = nodePositions[j * 3];
      const y2 = nodePositions[j * 3 + 1];
      const z2 = nodePositions[j * 3 + 2];

      const dx = x1 - x2;
      const dy = y1 - y2;
      const dz = z1 - z2;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq > 0.04 && distSq < maxDistSq) {
        const dist = Math.sqrt(distSq);
        const strength = 1.0 - dist / distanceThreshold;

        linePositions.push(x1, y1, z1, x2, y2, z2);
        lineAlphas.push(strength, strength);
        linePhases.push(phase1, nodePhases[j]);

        filamentCount++;
        neighborsFound++;
      }
    }
  }

  const filamentGeo = new BufferGeometry();
  filamentGeo.setAttribute("position", new Float32BufferAttribute(linePositions, 3));
  filamentGeo.setAttribute("aAlpha", new Float32BufferAttribute(lineAlphas, 1));
  filamentGeo.setAttribute("aPhase", new Float32BufferAttribute(linePhases, 1));

  // Build resonant beacon coordinates (structural hub points with subtle pulsing halos)
  const beaconCount = Math.max(4, Math.min(10, Math.floor(nodeCount / 90)));
  const beaconPositions = new Float32Array(beaconCount * 3);
  const beaconPhases = new Float32Array(beaconCount);

  for (let b = 0; b < beaconCount; b++) {
    const pickIdx = Math.floor((b + 0.5) * (nodeCount / beaconCount));
    beaconPositions[b * 3] = nodePositions[pickIdx * 3];
    beaconPositions[b * 3 + 1] = nodePositions[pickIdx * 3 + 1];
    beaconPositions[b * 3 + 2] = nodePositions[pickIdx * 3 + 2];
    beaconPhases[b] = nodePhases[pickIdx];
  }

  const beaconGeo = new BufferGeometry();
  beaconGeo.setAttribute("position", new Float32BufferAttribute(beaconPositions, 3));
  beaconGeo.setAttribute("aPhase", new Float32BufferAttribute(beaconPhases, 1));

  return { nodeGeo, filamentGeo, beaconGeo };
}

function buildOrganicContourStratum(
  radiusX: number,
  radiusY: number,
  zOffset: number,
  segments: number,
  seed: number,
): BufferGeometry {
  const rand = mulberry32(seed);
  const positions = new Float32Array(segments * 3);
  const progress = new Float32Array(segments);
  const harmonicA = 2 + Math.floor(rand() * 2);
  const harmonicB = 3 + Math.floor(rand() * 3);
  const phase = rand() * Math.PI * 2;
  const tilt = (rand() - 0.5) * 0.45;

  for (let i = 0; i < segments; i++) {
    const p = i / segments;
    const angle = p * Math.PI * 2;
    const mod =
      1.0 +
      Math.sin(angle * harmonicA + phase) * 0.14 +
      Math.cos(angle * harmonicB - phase) * 0.09;

    const x = Math.cos(angle) * radiusX * mod;
    const y = Math.sin(angle) * radiusY * mod + Math.sin(angle * 2.0 + phase) * 0.18;
    const z = zOffset + Math.sin(angle + phase) * tilt + Math.cos(angle * 3.0) * 0.14;

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    progress[i] = p;
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geo.setAttribute("aProgress", new Float32BufferAttribute(progress, 1));
  return geo;
}

export interface EcologicalFieldLayerHandle {
  readonly group: Group;
  update: (
    dt: number,
    opacity: number,
    reducedMotion: boolean,
  ) => void;
  applyBudget: (budget: EcologicalFieldBudget, pixelRatio: number) => void;
  dispose: () => void;
}

export function createEcologicalFieldLayer(
  stage: WebGLStage,
  initialBudget: EcologicalFieldBudget,
  reducedInitial: boolean,
): EcologicalFieldLayerHandle {
  const group = new Group();
  group.name = "EcologicalIntelligenceFieldLayer";
  group.renderOrder = 2;

  let budget = initialBudget;
  const geometries = buildEcologicalManifoldGeometry(
    budget.nodeCount,
    budget.maxFilaments,
    budget.distanceThreshold,
  );

  let masterTime = 0;

  // 1. Primary Node Cloud Material
  const nodeMaterial = new ShaderMaterial({
    vertexShader: ECOLOGICAL_FIELD_NODE_VERTEX_SHADER,
    fragmentShader: ECOLOGICAL_FIELD_NODE_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uMotionScale: { value: reducedInitial ? 0 : 1 },
      uPixelRatio: { value: stage.renderer.getPixelRatio() },
      uPointScale: { value: budget.pointScale },
      uOpacity: { value: 0 },
    },
  });

  const nodeMesh = new Points(geometries.nodeGeo, nodeMaterial);
  nodeMesh.name = "EcologicalFieldNodes";
  group.add(nodeMesh);

  // 2. Connected Lattice Filaments Material
  const filamentMaterial = new ShaderMaterial({
    vertexShader: ECOLOGICAL_FILAMENT_VERTEX_SHADER,
    fragmentShader: ECOLOGICAL_FILAMENT_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uMotionScale: { value: reducedInitial ? 0 : 1 },
      uOpacity: { value: 0 },
    },
  });

  const filamentMesh = new LineSegments(geometries.filamentGeo, filamentMaterial);
  filamentMesh.name = "EcologicalFieldFilaments";
  group.add(filamentMesh);

  // 3. Large-Scale Organic Contour Strata
  const strataCount = budget.tier === "mobile" ? 4 : 6;
  const strataSegments = budget.tier === "mobile" ? 84 : 128;
  const strataGeometries: BufferGeometry[] = [];
  const strataMaterials: ShaderMaterial[] = [];
  const strataPalette = [
    new Color("#293C30"),
    new Color("#3B5544"),
    new Color("#664F31"),
  ];

  for (let s = 0; s < strataCount; s++) {
    const rx = 2.1 + s * 0.42;
    const ry = 0.85 + s * 0.22;
    const zOff = -0.3 - s * 0.25;
    const geo = buildOrganicContourStratum(rx, ry, zOff, strataSegments, 7100 + s * 53);
    const mat = new ShaderMaterial({
      vertexShader: ECOLOGICAL_STRATUM_VERTEX_SHADER,
      fragmentShader: ECOLOGICAL_STRATUM_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uMotionScale: { value: reducedInitial ? 0 : 1 },
        uWavePhase: { value: s * 1.15 },
        uOpacity: { value: 0 },
        uColor: { value: strataPalette[s % strataPalette.length] },
        uBaseOpacity: { value: Math.max(0.14, 0.30 - s * 0.028) },
      },
    });
    const loop = new LineLoop(geo, mat);
    loop.name = `EcologicalFieldStratum_${s}`;
    loop.rotation.z = (s - strataCount / 2) * 0.08;
    group.add(loop);
    strataGeometries.push(geo);
    strataMaterials.push(mat);
  }

  // 4. Resonant Beacons Material
  const beaconMaterial = new ShaderMaterial({
    vertexShader: ECOLOGICAL_BEACON_VERTEX_SHADER,
    fragmentShader: ECOLOGICAL_BEACON_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uMotionScale: { value: reducedInitial ? 0 : 1 },
      uPixelRatio: { value: stage.renderer.getPixelRatio() },
      uPointScale: { value: budget.pointScale },
      uOpacity: { value: 0 },
    },
  });

  const beaconMesh = new Points(geometries.beaconGeo, beaconMaterial);
  beaconMesh.name = "EcologicalFieldBeacons";
  group.add(beaconMesh);

  const applyBudget = (nextBudget: EcologicalFieldBudget, pixelRatio: number) => {
    budget = nextBudget;
    nodeMaterial.uniforms.uPixelRatio.value = pixelRatio;
    nodeMaterial.uniforms.uPointScale.value = nextBudget.pointScale;
    beaconMaterial.uniforms.uPixelRatio.value = pixelRatio;
    beaconMaterial.uniforms.uPointScale.value = nextBudget.pointScale;
  };

  const update = (
    dt: number,
    opacity: number,
    reducedMotion: boolean,
  ) => {
    group.visible = opacity > 0.003;
    if (!group.visible) return;

    // When reducedMotion is active, freeze continuous time progression
    const motionScale = reducedMotion ? 0.0 : 1.0;
    masterTime += dt * motionScale;

    // Gentle panoramic organic drift
    group.rotation.y = masterTime * 0.025;
    group.rotation.x = Math.sin(masterTime * 0.018) * 0.045;

    nodeMaterial.uniforms.uTime.value = masterTime;
    nodeMaterial.uniforms.uMotionScale.value = motionScale;
    nodeMaterial.uniforms.uOpacity.value = opacity;

    filamentMaterial.uniforms.uTime.value = masterTime;
    filamentMaterial.uniforms.uMotionScale.value = motionScale;
    filamentMaterial.uniforms.uOpacity.value = opacity;

    for (const mat of strataMaterials) {
      mat.uniforms.uTime.value = masterTime;
      mat.uniforms.uMotionScale.value = motionScale;
      mat.uniforms.uOpacity.value = opacity;
    }

    beaconMaterial.uniforms.uTime.value = masterTime;
    beaconMaterial.uniforms.uMotionScale.value = motionScale;
    beaconMaterial.uniforms.uOpacity.value = opacity;
  };

  const dispose = () => {
    geometries.nodeGeo.dispose();
    geometries.filamentGeo.dispose();
    geometries.beaconGeo.dispose();
    nodeMaterial.dispose();
    filamentMaterial.dispose();
    beaconMaterial.dispose();
    for (const geo of strataGeometries) geo.dispose();
    for (const mat of strataMaterials) mat.dispose();
  };

  return {
    group,
    update,
    applyBudget,
    dispose,
  };
}
