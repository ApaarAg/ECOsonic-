import * as THREE from "three";
import type { WebGLStage } from "../engine/WebGLStage";
import type { ForestBudget } from "../engine/viewportBudget";
import {
  createSeededRandom,
  damp,
  fbm2D,
  generateValleyPathPoints,
  getTerrainHeight,
  getValleyCenterX,
} from "./valleyMath";
import {
  VALLEY_BOTANICAL_FRAGMENT_SHADER,
  VALLEY_BOTANICAL_VERTEX_SHADER,
  VALLEY_DUST_FRAGMENT_SHADER,
  VALLEY_DUST_VERTEX_SHADER,
} from "./valleyShaders";
import {
  createFallbackValleyAtlasTexture,
  createValleyDustTexture,
  createValleyLightRayTexture,
  loadValleyBotanicalAtlas,
} from "./valleyTextures";

export interface ValleyUpdateResult {
  camPos: THREE.Vector3;
  camTarget: THREE.Vector3;
  camRoll: number;
  fov: number;
}

export interface ValleyLayerHandle {
  group: THREE.Group;
  setPointerNdc: (x: number, y: number) => void;
  setPixelRatio: (dpr: number) => void;
  setBudget: (budget: ForestBudget, dpr: number) => void;
  update: (opts: {
    dt: number;
    scrollProgress: number;
    opacity: number;
    disperse: number;
    aspect: number;
    reducedMotion: boolean;
  }) => ValleyUpdateResult;
  dispose: () => void;
}

const MAX_BOTANICAL_COUNT = 34000;

function clampFlight(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function detectSoftwareRenderer(renderer: THREE.WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || "");
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

/**
 * Integrates the ECOsonic-main Fernhollow nocturnal valley (terrain, 34k photographic flowers &
 * fern fronds, volumetric light rays, dust motes, spline flight, and cursor bioluminescence)
 * into the single shared WebGLStage without spawning duplicate WebGL contexts or listeners.
 */
export function createValleyLayer(
  stage: WebGLStage,
  initialBudget: ForestBudget,
  reducedMotion: boolean,
): ValleyLayerHandle {
  const group = new THREE.Group();
  group.name = "FernhollowNightValleyGroup";

  const disposables: Array<{ dispose: () => void }> = [];
  const fogColor = new THREE.Color(0x020307);

  // Local nocturnal lighting rig attached to group so visibility matches valley lifetime cleanly
  const hemiLight = new THREE.HemisphereLight(0x283552, 0x020307, 0.22);
  const moonLight = new THREE.DirectionalLight(0x7c93c4, 0.28);
  moonLight.position.set(18, 36, -24);
  const warmRimLight = new THREE.DirectionalLight(0xd9b88a, 0.12);
  warmRimLight.position.set(-22, 12, 28);
  group.add(hemiLight, moonLight, warmRimLight);

  const waypoints = generateValleyPathPoints(40, 220).map(
    (p) => new THREE.Vector3(p.x, p.y, p.z),
  );
  const pathCurve = new THREE.CatmullRomCurve3(waypoints, true, "catmullrom", 0.5);

  // Rolling night-valley terrain floor
  const terrainGeom = new THREE.PlaneGeometry(280, 280, 96, 96);
  terrainGeom.rotateX(-Math.PI / 2);
  const terrainPos = terrainGeom.attributes.position;
  for (let i = 0; i < terrainPos.count; i++) {
    const x = terrainPos.getX(i);
    const z = terrainPos.getZ(i);
    terrainPos.setY(i, getTerrainHeight(x, z) - 0.9);
  }
  terrainGeom.computeVertexNormals();
  const terrainMat = new THREE.MeshLambertMaterial({
    color: 0x010204,
    transparent: true,
    opacity: 1,
    depthWrite: false,
  });
  const terrainMesh = new THREE.Mesh(terrainGeom, terrainMat);
  terrainMesh.name = "ValleyTerrain";
  terrainMesh.renderOrder = 0;
  group.add(terrainMesh);
  disposables.push(terrainGeom, terrainMat);

  // 34,000 photographic botanical sprites (flowers + fern foliage + nocturnal dew glow florets)
  const rand = createSeededRandom(198742);
  let fallbackAtlas: THREE.CanvasTexture | null = createFallbackValleyAtlasTexture();
  disposables.push(fallbackAtlas);

  const positions = new Float32Array(MAX_BOTANICAL_COUNT * 3);
  const scales = new Float32Array(MAX_BOTANICAL_COUNT);
  const species = new Float32Array(MAX_BOTANICAL_COUNT);
  const kinds = new Float32Array(MAX_BOTANICAL_COUNT);
  const seeds = new Float32Array(MAX_BOTANICAL_COUNT);
  const colors = new Float32Array(MAX_BOTANICAL_COUNT * 3);
  const disperseDirs = new Float32Array(MAX_BOTANICAL_COUNT * 3);

  const glowTintOrange = new THREE.Color("#ff7a24");
  const glowTintGold = new THREE.Color("#ffe138");
  const glowTintViolet = new THREE.Color("#b69cff");
  const glowTintMagenta = new THREE.Color("#f24a98");

  for (let i = 0; i < MAX_BOTANICAL_COUNT; i++) {
    const z = (rand() - 0.5) * 220;
    const centerX = getValleyCenterX(z);
    const lateralSpread = (rand() - 0.5) * 124;
    const biasedX =
      centerX + Math.sign(lateralSpread) * Math.pow(Math.abs(lateralSpread) / 62, 1.15) * 62;

    const groundY = getTerrainHeight(biasedX, z);
    const patch = fbm2D(biasedX * 0.085, z * 0.085);
    const rawSpecies = fbm2D(biasedX * 0.095 + 21.4, z * 0.095 - 14.2);
    const speciesPatch = Math.min(1, Math.max(0, (rawSpecies - 0.3) / 0.4));

    const isFlowerZone = patch > 0.425;
    const isLeaf = !isFlowerZone || rand() > 0.54;
    const stemLift = isLeaf ? 0.25 + rand() * 1.05 : 0.75 + rand() * 1.65;

    positions[i * 3] = biasedX;
    positions[i * 3 + 1] = groundY + stemLift;
    positions[i * 3 + 2] = z;
    kinds[i] = isLeaf ? 1.0 : 0.0;

    if (isLeaf) {
      species[i] = 4 + Math.floor(rand() * 3);
      scales[i] = 1.55 + rand() * 1.35;
      const brightness = 0.72 + rand() * 0.48;
      colors[i * 3] = 0.88 * brightness;
      colors[i * 3 + 1] = 1.04 * brightness;
      colors[i * 3 + 2] = 0.88 * brightness;
    } else {
      let tile = 0;
      let glowTint = glowTintOrange;
      if (speciesPatch < 0.27) {
        tile = 0;
        glowTint = glowTintOrange;
      } else if (speciesPatch < 0.54) {
        tile = 1;
        glowTint = glowTintGold;
      } else if (speciesPatch < 0.78) {
        tile = 2;
        glowTint = glowTintViolet;
      } else {
        tile = 3;
        glowTint = glowTintMagenta;
      }

      const isGlowFloret = rand() > 0.92;
      if (isGlowFloret) {
        tile = 7;
        const brightness = 0.95 + rand() * 0.35;
        colors[i * 3] = glowTint.r * brightness;
        colors[i * 3 + 1] = glowTint.g * brightness;
        colors[i * 3 + 2] = glowTint.b * brightness;
      } else {
        const brightness = 0.88 + rand() * 0.3;
        colors[i * 3] = (0.96 + rand() * 0.08) * brightness;
        colors[i * 3 + 1] = (0.95 + rand() * 0.08) * brightness;
        colors[i * 3 + 2] = (0.94 + rand() * 0.08) * brightness;
      }

      species[i] = tile;
      scales[i] = isGlowFloret ? 0.75 + rand() * 0.7 : 1.05 + rand() * 1.15;
    }

    seeds[i] = rand();

    const theta = rand() * Math.PI * 2;
    const phi = rand() * Math.PI * 0.6;
    disperseDirs[i * 3] = Math.cos(theta) * Math.sin(phi);
    disperseDirs[i * 3 + 1] = Math.cos(phi) * 0.85 + 0.35;
    disperseDirs[i * 3 + 2] = Math.sin(theta) * Math.sin(phi);
  }

  const isSoftwareGl = detectSoftwareRenderer(stage.renderer);
  const resolveBotanicalCount = (tier: ForestBudget["tier"]) =>
    isSoftwareGl ? 16000 : tier === "mobile" ? 20000 : MAX_BOTANICAL_COUNT;

  const botanicalGeo = new THREE.BufferGeometry();
  botanicalGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  botanicalGeo.setAttribute("aScale", new THREE.BufferAttribute(scales, 1));
  botanicalGeo.setAttribute("aSpecies", new THREE.BufferAttribute(species, 1));
  botanicalGeo.setAttribute("aKind", new THREE.BufferAttribute(kinds, 1));
  botanicalGeo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  botanicalGeo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  botanicalGeo.setAttribute("aDisperseDir", new THREE.BufferAttribute(disperseDirs, 3));
  botanicalGeo.setDrawRange(0, resolveBotanicalCount(initialBudget.tier));

  const initialPixelRatio = stage.renderer.getPixelRatio();
  const initialAspect = stage.camera.aspect || 1;
  const botanicalMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: initialPixelRatio },
      uBaseSize: { value: isSoftwareGl ? 1050 : 840 },
      uMouseNdc: { value: new THREE.Vector2(0.32, -0.35) },
      uAspect: { value: initialAspect },
      uHoverDisperse: { value: 0 },
      uLayerOpacity: { value: 0 },
      uAtlas: { value: fallbackAtlas },
      uFogColor: { value: fogColor },
      uFogDensity: { value: 0.0115 },
    },
    vertexShader: VALLEY_BOTANICAL_VERTEX_SHADER,
    fragmentShader: VALLEY_BOTANICAL_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const botanicalPoints = new THREE.Points(botanicalGeo, botanicalMat);
  botanicalPoints.frustumCulled = false;
  botanicalPoints.renderOrder = 2;
  group.add(botanicalPoints);
  disposables.push(botanicalGeo, botanicalMat);

  // Nocturnal dust & pollen motes
  const dustRand = createSeededRandom(77312);
  const dustMap = createValleyDustTexture();
  disposables.push(dustMap);

  const dustCount = 1100;
  const dustPos = new Float32Array(dustCount * 3);
  const dustSizes = new Float32Array(dustCount);
  const dustSeeds = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    const z = (dustRand() - 0.5) * 230;
    const x = getValleyCenterX(z) + (dustRand() - 0.5) * 90;
    const groundY = getTerrainHeight(x, z);
    dustPos[i * 3] = x;
    dustPos[i * 3 + 1] = groundY + 0.8 + dustRand() * 14;
    dustPos[i * 3 + 2] = z;
    dustSizes[i] = 42 + dustRand() * 75;
    dustSeeds[i] = dustRand();
  }

  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  dustGeo.setAttribute("aSize", new THREE.BufferAttribute(dustSizes, 1));
  dustGeo.setAttribute("aSeed", new THREE.BufferAttribute(dustSeeds, 1));
  dustGeo.setDrawRange(0, initialBudget.tier === "mobile" ? 650 : dustCount);

  const dustMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: initialPixelRatio },
      uMouseNdc: { value: new THREE.Vector2(0, 0) },
      uAspect: { value: initialAspect },
      uHoverDisperse: { value: 0 },
      uLayerOpacity: { value: 0 },
      uDustMap: { value: dustMap },
    },
    vertexShader: VALLEY_DUST_VERTEX_SHADER,
    fragmentShader: VALLEY_DUST_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const dustPoints = new THREE.Points(dustGeo, dustMat);
  dustPoints.frustumCulled = false;
  group.add(dustPoints);
  disposables.push(dustGeo, dustMat);

  // Nocturnal canopy light rays
  const rayTex = createValleyLightRayTexture();
  disposables.push(rayTex);
  const rayRand = createSeededRandom(31199);
  const raySprites: Array<{
    sprite: THREE.Sprite;
    mat: THREE.SpriteMaterial;
    baseOpacity: number;
    baseX: number;
    baseY: number;
    phase: number;
  }> = [];

  for (let i = 0; i < 14; i++) {
    const baseOpacity = 0.12 + rayRand() * 0.08;
    const mat = new THREE.SpriteMaterial({
      map: rayTex,
      color: i % 2 === 0 ? 0xaec4ea : 0xe9dec8,
      transparent: true,
      opacity: baseOpacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(mat);
    const t = i / 14;
    const pt = pathCurve.getPointAt(t);
    const offsetX = (rayRand() - 0.5) * 32;
    const baseY = pt.y + 8 + rayRand() * 6;
    sprite.position.set(pt.x + offsetX, baseY, pt.z);
    sprite.scale.set(16 + rayRand() * 14, 34 + rayRand() * 16, 1);
    group.add(sprite);
    raySprites.push({
      sprite,
      mat,
      baseOpacity,
      baseX: pt.x + offsetX,
      baseY,
      phase: rayRand() * Math.PI * 2,
    });
    disposables.push(mat);
  }

  // Load real photographic botanical atlas asynchronously
  let disposed = false;
  void loadValleyBotanicalAtlas()
    .then((photoAtlas) => {
      if (disposed) {
        photoAtlas.dispose();
        return;
      }
      botanicalMat.uniforms.uAtlas.value = photoAtlas;
      disposables.push(photoAtlas);
      if (fallbackAtlas) {
        fallbackAtlas.dispose();
        fallbackAtlas = null;
      }
    })
    .catch(() => {
      // Fallback canvas atlas stays safe without crashing
    });

  const mouseTarget = new THREE.Vector2(0.32, -0.28);
  const mouseCurrent = new THREE.Vector2(0.32, -0.28);
  const camPos = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3();

  let elapsed = 0;
  let idleDrift = 0;
  let smoothFlightT = 0.04;
  let smoothDisperse = 0;

  return {
    group,
    setPointerNdc: (x: number, y: number) => {
      mouseTarget.set(x, y);
    },
    setPixelRatio: (dpr: number) => {
      botanicalMat.uniforms.uPixelRatio.value = dpr;
      dustMat.uniforms.uPixelRatio.value = dpr;
    },
    setBudget: (budget: ForestBudget, dpr: number) => {
      botanicalGeo.setDrawRange(0, resolveBotanicalCount(budget.tier));
      dustGeo.setDrawRange(0, budget.tier === "mobile" ? 650 : dustCount);
      botanicalMat.uniforms.uPixelRatio.value = dpr;
      dustMat.uniforms.uPixelRatio.value = dpr;
    },
    update: ({ dt, scrollProgress, opacity, disperse, aspect, reducedMotion: rm }) => {
      const safeOpacity = Math.max(0, Math.min(1, opacity));
      group.visible = safeOpacity > 0.004;

      const motionScale = rm || reducedMotion ? 0.12 : 1;
      elapsed += dt * motionScale;
      if (!rm && !reducedMotion && safeOpacity > 0.05) {
        idleDrift += dt * 0.0038;
      }

      // Bidirectional scroll-linked valley flight through the open crescent canyon corridor (z: +48 -> -48)
      const normalizedActFlight = Math.min(1, Math.max(0, scrollProgress / 0.48));
      const targetFlight = clampFlight(normalizedActFlight);
      smoothFlightT = rm ? targetFlight : damp(smoothFlightT, targetFlight, 6.2, dt);
      smoothDisperse = rm ? disperse : damp(smoothDisperse, disperse, 4.8, dt);

      mouseCurrent.x = rm ? 0.18 : damp(mouseCurrent.x, mouseTarget.x, 5.5, dt);
      mouseCurrent.y = rm ? -0.2 : damp(mouseCurrent.y, mouseTarget.y, 5.5, dt);

      const driftWave = rm ? 0 : Math.sin(idleDrift * Math.PI * 2) * 3.5;
      const camZ = 42 - smoothFlightT * 74 + driftWave;
      const camX = getValleyCenterX(camZ) + Math.sin(smoothFlightT * Math.PI * 1.4) * 2.2;
      const camGround = getTerrainHeight(camX, camZ);
      camPos.set(camX, camGround + 5.6, camZ);

      const lookZ = camZ - 26;
      const lookX = getValleyCenterX(lookZ) + Math.sin((smoothFlightT + 0.12) * Math.PI * 1.4) * 1.8;
      const lookGround = getTerrainHeight(lookX, lookZ);
      camTarget.set(lookX, lookGround + 0.85, lookZ);

      tangent.subVectors(camTarget, camPos).normalize();
      right.crossVectors(tangent, up).normalize();
      camPos.addScaledVector(right, mouseCurrent.x * 1.35 * motionScale);
      camPos.y += mouseCurrent.y * 0.72 * motionScale;
      camTarget.addScaledVector(right, mouseCurrent.x * 3.4 * motionScale);
      camTarget.y += mouseCurrent.y * 1.85 * motionScale;

      if (group.visible) {
        terrainMat.opacity = safeOpacity;
        botanicalMat.uniforms.uTime.value = elapsed;
        botanicalMat.uniforms.uAspect.value = aspect;
        botanicalMat.uniforms.uMouseNdc.value.copy(mouseCurrent);
        botanicalMat.uniforms.uHoverDisperse.value = smoothDisperse;
        botanicalMat.uniforms.uLayerOpacity.value = safeOpacity;

        dustMat.uniforms.uTime.value = elapsed;
        dustMat.uniforms.uAspect.value = aspect;
        dustMat.uniforms.uMouseNdc.value.copy(mouseCurrent);
        dustMat.uniforms.uHoverDisperse.value = smoothDisperse;
        dustMat.uniforms.uLayerOpacity.value = safeOpacity;

        for (const ray of raySprites) {
          ray.sprite.position.x = ray.baseX + Math.sin(elapsed * 0.22 + ray.phase) * 1.4;
          ray.sprite.position.y = ray.baseY + Math.cos(elapsed * 0.18 + ray.phase) * 0.6;
          ray.mat.opacity = ray.baseOpacity * safeOpacity * (1 - smoothDisperse * 0.55);
        }
      }

      // Subtle focal breathing: spatial forest open (52) -> tactile leaf focus (49.4) -> wide water floor (53.2)
      const leafFocusDip =
        Math.exp(-Math.pow((scrollProgress - 0.245) / 0.075, 2)) * 2.6;
      const waterFloorOpen =
        Math.exp(-Math.pow((scrollProgress - 0.385) / 0.075, 2)) * 1.4;
      const dynamicFov = rm || reducedMotion ? 51 : 52 - leafFocusDip + waterFloorOpen;

      return {
        camPos,
        camTarget,
        camRoll: -mouseCurrent.x * 0.032 * motionScale * safeOpacity,
        fov: dynamicFov,
      };
    },
    dispose: () => {
      disposed = true;
      for (const d of disposables) {
        d.dispose();
      }
    },
  };
}
