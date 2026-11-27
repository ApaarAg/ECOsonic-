import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  NormalBlending,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  Vector4,
} from "three";
import { acousticStore } from "../../domain/acousticStore";
import type { WebGLStage } from "../engine/WebGLStage";
import type { AcousticFieldBudget } from "../engine/viewportBudget";
import {
  attachFieldInteractionListeners,
  createFieldInteractionState,
  stepFieldInteraction,
  type FieldInteractionState,
} from "./acousticFieldInteraction";
import {
  CORE_FRAGMENT_SHADER,
  CORE_VERTEX_SHADER,
  FIELD_PARTICLE_FRAGMENT_SHADER,
  FIELD_PARTICLE_VERTEX_SHADER,
  ORBIT_STRATA_FRAGMENT_SHADER,
  ORBIT_STRATA_VERTEX_SHADER,
} from "./acousticFieldShaders";
import {
  createAcousticFieldRuntimeState,
  stepAcousticFieldState,
  type AcousticFieldRuntimeState,
} from "./acousticFieldState";

/** Deterministic PRNG so organic field geometry is reproducible and jitter-free. */
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

export function buildOrganicFieldGeometry(count: number): BufferGeometry {
  const rand = mulberry32(3012026);
  const positions = new Float32Array(count * 3);
  const bands = new Float32Array(count);
  const seeds = new Float32Array(count);

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const y = 1 - 2 * t;
    const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
    // Asymmetric azimuthal clustering so field never looks mathematically uniform
    const theta =
      goldenAngle * i +
      Math.sin(y * 3.1) * 0.24 +
      (rand() - 0.5) * 0.22;

    const layerPick = rand();
    const r =
      layerPick < 0.58
        ? 1.42 + rand() * 0.42
        : 1.84 + rand() * 0.58;

    const x = Math.cos(theta) * radiusAtY * 1.24;
    const yAniso = y * 0.84 + Math.sin(theta * 2.0) * 0.08;
    const z = Math.sin(theta) * radiusAtY * 1.06;

    positions[i * 3] = x * r + (rand() - 0.5) * 0.08;
    positions[i * 3 + 1] = yAniso * r + (rand() - 0.5) * 0.06;
    positions[i * 3 + 2] = z * r + (rand() - 0.5) * 0.08;

    const absY = Math.abs(y);
    if (absY < 0.28) {
      bands[i] = rand() < 0.65 ? 0 : 1;
    } else if (absY < 0.64) {
      bands[i] = rand() < 0.6 ? 1 : 2;
    } else {
      bands[i] = rand() < 0.65 ? 2 : 3;
    }

    seeds[i] = rand();
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aBand", new Float32BufferAttribute(bands, 1));
  geometry.setAttribute("aSeed", new Float32BufferAttribute(seeds, 1));
  return geometry;
}

export function buildOrganicStratumGeometry(
  radius: number,
  segments: number,
  seed: number,
): BufferGeometry {
  const rand = mulberry32(seed);
  const positions = new Float32Array(segments * 3);
  const progress = new Float32Array(segments);
  const harmonicA = 2 + Math.floor(rand() * 3);
  const harmonicB = 3 + Math.floor(rand() * 4);
  const phaseOffset = rand() * Math.PI * 2;
  const eccX = 1.08 + rand() * 0.16;
  const eccZ = 0.86 + rand() * 0.14;
  const driftX = (rand() - 0.5) * 0.16;
  const driftZ = (rand() - 0.5) * 0.14;

  for (let i = 0; i < segments; i++) {
    const p = i / segments;
    const angle = p * Math.PI * 2;
    const organicR =
      radius +
      Math.sin(angle * harmonicA + phaseOffset) * 0.075 +
      Math.cos(angle * harmonicB - phaseOffset) * 0.042;
    const organicY =
      Math.sin(angle * (harmonicA + 1) + phaseOffset) * 0.085;

    positions[i * 3] = Math.cos(angle) * organicR * eccX + driftX;
    positions[i * 3 + 1] = organicY;
    positions[i * 3 + 2] = Math.sin(angle) * organicR * eccZ + driftZ;
    progress[i] = p;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aProgress", new Float32BufferAttribute(progress, 1));
  return geometry;
}

function buildPulseRingGeometry(segments = 48): BufferGeometry {
  const positions = new Float32Array(segments * 3);
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    positions[i * 3] = Math.cos(a);
    positions[i * 3 + 1] = Math.sin(a);
    positions[i * 3 + 2] = 0;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  return geometry;
}

export interface ProjectedSpatialTrace {
  /** Screen percentages [0..100] */
  xPct: number;
  yPct: number;
  active: boolean;
  isDisturbance: boolean;
  strength: number;
}

export interface WaterSoundBridge {
  rippleAge: number;
  contactImpulse: number;
  impactX: number;
  impactZ: number;
}

export interface AcousticFieldLayerHandle {
  readonly group: Group;
  readonly runtimeState: AcousticFieldRuntimeState;
  readonly interactionState: FieldInteractionState;
  readonly projectedTrace: ProjectedSpatialTrace;
  update: (
    dt: number,
    budget: AcousticFieldBudget,
    reduced: boolean,
    morph: number,
    opacity: number,
    controlCamera: boolean,
    silenceOverride?: number,
    waterBridge?: WaterSoundBridge,
  ) => void;
  applyBudget: (nextBudget: AcousticFieldBudget, pixelRatio: number) => void;
  setPixelRatio: (pixelRatio: number) => void;
  dispose: () => void;
}

export function createAcousticFieldLayer(
  stage: WebGLStage,
  container: HTMLElement,
  initialBudget: AcousticFieldBudget,
  reducedInitial: boolean,
): AcousticFieldLayerHandle {
  let budget = initialBudget;
  const fieldGroup = new Group();
  fieldGroup.scale.setScalar(budget.fieldScale);

  // 1. Current Observation Core
  const coreGeo = new SphereGeometry(0.46, 36, 36);
  const coreMat = new ShaderMaterial({
    vertexShader: CORE_VERTEX_SHADER,
    fragmentShader: CORE_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: true,
    uniforms: {
      uEnergy: { value: 0.08 },
      uBands: { value: new Vector4(0.06, 0.09, 0.05, 0.03) },
      uSilence: { value: 0.45 },
      uDisturbanceStrength: { value: 0 },
      uFieldOpacity: { value: 1 },
    },
  });
  const coreMesh = new Mesh(coreGeo, coreMat);
  coreMesh.renderOrder = 4;
  fieldGroup.add(coreMesh);

  // 2. Organic Acoustic Field Particles
  let particleGeo = buildOrganicFieldGeometry(budget.particleCount);
  const particleMat = new ShaderMaterial({
    vertexShader: FIELD_PARTICLE_VERTEX_SHADER,
    fragmentShader: FIELD_PARTICLE_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uPhase: { value: 0 },
      uEnergy: { value: 0.08 },
      uBands: { value: new Vector4(0.06, 0.09, 0.05, 0.03) },
      uCentroid: { value: 0.36 },
      uFlux: { value: 0.02 },
      uSilence: { value: 0.45 },
      uPixelRatio: { value: stage.renderer.getPixelRatio() },
      uPointScale: { value: budget.pointSizeScale },
      uReducedMotion: { value: reducedInitial ? 1 : 0 },
      uFieldMorph: { value: 1 },
      uFieldOpacity: { value: 1 },
      uWaterRippleAge: { value: 0 },
      uWaterImpulse: { value: 0 },
      uImpactOrigin: { value: new Vector2(0.04, 1.66) },
      uDetectionDir: { value: new Vector3(0.4, 0.72, 0.56) },
      uDetectionStrength: { value: 0 },
      uDisturbanceDir: { value: new Vector3(-0.65, 0.22, 0.72) },
      uDisturbanceStrength: { value: 0 },
      uPointerPos: { value: new Vector3(0, 0, 1.85) },
      uPointerPresence: { value: 0 },
    },
  });
  const points = new Points(particleGeo, particleMat);
  points.renderOrder = 4;
  fieldGroup.add(points);

  // 3. Orbital Frequency Strata
  const strataGroup = new Group();
  fieldGroup.add(strataGroup);
  const strataMaterials: ShaderMaterial[] = [];
  const strataGeometries: BufferGeometry[] = [];
  const strataBandIndices: number[] = [];

  const strataPalette = [
    new Color("#5C548A"),
    new Color("#4E7E66"),
    new Color("#AE794B"),
    new Color("#5D8A9E"),
  ];

  const rebuildStrata = (count: number, segments: number) => {
    while (strataGroup.children.length > 0) {
      strataGroup.remove(strataGroup.children[0]);
    }
    for (const g of strataGeometries) g.dispose();
    for (const m of strataMaterials) m.dispose();
    strataGeometries.length = 0;
    strataMaterials.length = 0;
    strataBandIndices.length = 0;

    for (let i = 0; i < count; i++) {
      const radius = 1.48 + i * 0.24;
      const geo = buildOrganicStratumGeometry(radius, segments, 900 + i * 37);
      const bandIdx = i % 4;
      const mat = new ShaderMaterial({
        vertexShader: ORBIT_STRATA_VERTEX_SHADER,
        fragmentShader: ORBIT_STRATA_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: NormalBlending,
        uniforms: {
          uPhase: { value: 0 },
          uBandEnergy: { value: 0.08 },
          uSilence: { value: 0.45 },
          uReducedMotion: { value: reducedInitial ? 1 : 0 },
          uDetectionStrength: { value: 0 },
          uDisturbanceDir: { value: new Vector3(-0.65, 0.22, 0.72) },
          uDisturbanceStrength: { value: 0 },
          uBaseColor: { value: strataPalette[bandIdx] },
          uBaseOpacity: { value: Math.max(0.09, 0.26 - i * 0.024) },
          uFieldOpacity: { value: 1 },
        },
      });
      const loop = new LineLoop(geo, mat);
      loop.rotation.x = 0.38 + (i % 3) * 0.34;
      loop.rotation.z = -0.24 + i * 0.21;
      loop.renderOrder = 4;
      strataGroup.add(loop);
      strataGeometries.push(geo);
      strataMaterials.push(mat);
      strataBandIndices.push(bandIdx);
    }
  };

  rebuildStrata(budget.strataCount, budget.strataSegments);

  // 4. Localized Event Spatial Ring
  const pulseRingGeo = buildPulseRingGeometry(48);
  const pulseRingMat = new LineBasicMaterial({
    color: new Color("#E8E4DC"),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const pulseRing = new LineLoop(pulseRingGeo, pulseRingMat);
  pulseRing.visible = false;
  pulseRing.renderOrder = 4;
  fieldGroup.add(pulseRing);

  const pulseTargetDir = new Vector3();
  const pulseProjectedVec = new Vector3();
  const parchmentColor = new Color("#E8E4DC");
  const ochreColor = new Color("#C86D3B");
  const projectedTrace: ProjectedSpatialTrace = {
    xPct: 58,
    yPct: 44,
    active: false,
    isDisturbance: false,
    strength: 0,
  };

  const runtimeState = createAcousticFieldRuntimeState();
  const interactionState = createFieldInteractionState();
  const detachInteraction = attachFieldInteractionListeners(container, interactionState);

  return {
    group: fieldGroup,
    runtimeState,
    interactionState,
    projectedTrace,
    applyBudget(nextBudget: AcousticFieldBudget, pixelRatio: number) {
      budget = nextBudget;
      fieldGroup.scale.setScalar(budget.fieldScale);
      particleMat.uniforms.uPointScale.value = budget.pointSizeScale;
      particleMat.uniforms.uPixelRatio.value = pixelRatio;

      particleGeo.dispose();
      particleGeo = buildOrganicFieldGeometry(budget.particleCount);
      points.geometry = particleGeo;

      rebuildStrata(budget.strataCount, budget.strataSegments);
    },
    setPixelRatio(pixelRatio: number) {
      particleMat.uniforms.uPixelRatio.value = pixelRatio;
    },
    update(
      dt: number,
      currentBudget: AcousticFieldBudget,
      reduced: boolean,
      morph: number,
      opacity: number,
      controlCamera: boolean,
      silenceOverride = 0,
      waterBridge?: WaterSoundBridge,
    ) {
      budget = currentBudget;
      fieldGroup.visible = opacity > 0.005;
      if (!fieldGroup.visible) {
        projectedTrace.active = false;
        return;
      }

      const hadPendingEvents =
        acousticStore.pendingDetections.length > 0 ||
        acousticStore.pendingDisturbances.length > 0;

      stepAcousticFieldState(
        runtimeState,
        acousticStore.liveAudio,
        acousticStore.pendingDetections,
        acousticStore.pendingDisturbances,
        dt,
        reduced,
        silenceOverride,
      );

      if (hadPendingEvents && acousticStore.lastEventIngressAt !== null) {
        const visualLatency = Math.max(
          0,
          performance.now() - acousticStore.lastEventIngressAt,
        );
        acousticStore.updateLatency(
          { visualResponseLatencyMs: Number(visualLatency.toFixed(2)) },
          false,
        );
        acousticStore.lastEventIngressAt = null;
      }

      stepFieldInteraction(
        interactionState,
        dt,
        budget.parallaxStrength,
        reduced,
      );

      if (controlCamera) {
        const camLerp = 1 - Math.exp(-5.0 * dt);
        stage.camera.position.x +=
          (interactionState.parallax.x - stage.camera.position.x) * camLerp;
        stage.camera.position.y +=
          (interactionState.parallax.y - stage.camera.position.y) * camLerp;
        stage.camera.position.z +=
          (budget.cameraDistance - stage.camera.position.z) * camLerp;
        stage.camera.lookAt(0, 0, 0);
      }

      const rotScale = reduced ? 0 : 1 - runtimeState.silenceFactor * 0.9;
      fieldGroup.rotation.y =
        (runtimeState.fieldPhase * 0.14 + interactionState.dragYaw) * morph;
      fieldGroup.rotation.x =
        (Math.sin(runtimeState.fieldPhase * 0.08) * 0.06 * rotScale +
          interactionState.dragPitch) *
        morph;

      // Core and strata appear smoothly in the second half of the wave-to-field morph
      const shellAppear = Math.max(0, Math.min(1, (morph - 0.36) / 0.64)) * opacity;

      const pUni = particleMat.uniforms;
      pUni.uPhase.value = runtimeState.fieldPhase;
      pUni.uEnergy.value = runtimeState.energy;
      pUni.uBands.value.set(
        runtimeState.bands[0],
        runtimeState.bands[1],
        runtimeState.bands[2],
        runtimeState.bands[3],
      );
      pUni.uCentroid.value = runtimeState.spectralCentroid;
      pUni.uFlux.value = runtimeState.temporalFlux;
      pUni.uSilence.value = runtimeState.silenceFactor;
      pUni.uReducedMotion.value = reduced ? 1 : 0;
      pUni.uFieldMorph.value = morph;
      pUni.uFieldOpacity.value = opacity;
      if (waterBridge) {
        pUni.uWaterRippleAge.value = waterBridge.rippleAge;
        pUni.uWaterImpulse.value = waterBridge.contactImpulse;
        pUni.uImpactOrigin.value.set(waterBridge.impactX, waterBridge.impactZ);
      } else {
        pUni.uWaterImpulse.value = 0;
      }
      pUni.uDetectionDir.value.set(
        runtimeState.detectionPulse.dir[0],
        runtimeState.detectionPulse.dir[1],
        runtimeState.detectionPulse.dir[2],
      );
      pUni.uDetectionStrength.value = runtimeState.detectionPulse.strength;
      pUni.uDisturbanceDir.value.set(
        runtimeState.disturbanceWave.dir[0],
        runtimeState.disturbanceWave.dir[1],
        runtimeState.disturbanceWave.dir[2],
      );
      pUni.uDisturbanceStrength.value = runtimeState.disturbanceWave.strength;
      pUni.uPointerPos.value.copy(interactionState.worldFocus);
      pUni.uPointerPresence.value = morph >= 0.85 ? interactionState.pointerPresence : 0;

      coreMesh.visible = shellAppear > 0.005;
      coreMat.uniforms.uEnergy.value = runtimeState.energy;
      coreMat.uniforms.uBands.value.copy(pUni.uBands.value);
      coreMat.uniforms.uSilence.value = runtimeState.silenceFactor;
      coreMat.uniforms.uDisturbanceStrength.value =
        runtimeState.disturbanceWave.strength;
      coreMat.uniforms.uFieldOpacity.value = shellAppear;

      strataGroup.visible = shellAppear > 0.005;
      for (let i = 0; i < strataMaterials.length; i++) {
        const sUni = strataMaterials[i].uniforms;
        const bIdx = strataBandIndices[i];
        sUni.uPhase.value = runtimeState.fieldPhase + i * 0.7;
        sUni.uBandEnergy.value = runtimeState.bands[bIdx];
        sUni.uSilence.value = runtimeState.silenceFactor;
        sUni.uReducedMotion.value = reduced ? 1 : 0;
        sUni.uDetectionStrength.value = runtimeState.detectionPulse.strength;
        sUni.uDisturbanceDir.value.copy(pUni.uDisturbanceDir.value);
        sUni.uDisturbanceStrength.value =
          runtimeState.disturbanceWave.strength;
        sUni.uFieldOpacity.value = shellAppear;
      }

      const detStr = runtimeState.detectionPulse.strength;
      const distStr = runtimeState.disturbanceWave.strength;
      const peakStr = Math.max(detStr, distStr) * shellAppear;
      if (peakStr > 0.03) {
        const useDist = distStr > detStr;
        const srcDir = useDist
          ? runtimeState.disturbanceWave.dir
          : runtimeState.detectionPulse.dir;
        pulseTargetDir.set(srcDir[0], srcDir[1], srcDir[2]).normalize();
        pulseRing.position.copy(pulseTargetDir).multiplyScalar(1.88);
        pulseRing.quaternion
          .copy(fieldGroup.quaternion)
          .invert()
          .multiply(stage.camera.quaternion);
        const expand = 0.14 + (1 - Math.max(detStr, distStr)) * 0.28;
        pulseRing.scale.setScalar(expand);
        pulseRingMat.color.copy(useDist ? ochreColor : parchmentColor);
        pulseRingMat.opacity = Math.min(0.68, peakStr * 0.72);
        pulseRing.visible = true;

        fieldGroup.updateMatrixWorld();
        pulseRing.getWorldPosition(pulseProjectedVec);
        pulseProjectedVec.project(stage.camera);
        projectedTrace.xPct = Math.max(16, Math.min(84, (pulseProjectedVec.x * 0.5 + 0.5) * 100));
        projectedTrace.yPct = Math.max(18, Math.min(78, (-pulseProjectedVec.y * 0.5 + 0.5) * 100));
        projectedTrace.active = true;
        projectedTrace.isDisturbance = useDist;
        projectedTrace.strength = peakStr;
      } else {
        pulseRing.visible = false;
        projectedTrace.active = false;
        projectedTrace.strength = 0;
      }
    },
    dispose() {
      detachInteraction();
      coreGeo.dispose();
      coreMat.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      pulseRingGeo.dispose();
      pulseRingMat.dispose();
      for (const g of strataGeometries) g.dispose();
      for (const m of strataMaterials) m.dispose();
    },
  };
}
