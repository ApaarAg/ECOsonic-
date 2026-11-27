import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { acousticStore } from '../../domain/acousticStore';
import { WebGLStage } from '../engine/WebGLStage';
import { getForestBudget } from '../engine/viewportBudget';
import {
  FOREST_MIST_FRAGMENT_SHADER,
  FOREST_MIST_VERTEX_SHADER,
  FOREST_PHOTO_FRAGMENT_SHADER,
  FOREST_PHOTO_VERTEX_SHADER,
} from './forestShaders';
import { createForestRuntimeState, stepForestState } from './forestState';
import type { ForestAct03TransitionHandle } from './forestTransition';
import forestPhotoUrl from '../../assets/forest/coastal-broadleaf-forest.webp';
import forestDepthUrl from '../../assets/forest/coastal-broadleaf-forest-depth.webp';

declare global {
  interface Window {
    __ECOSONIC_FOREST_TRANSITION__?: ForestAct03TransitionHandle;
  }
}

export interface ForestSceneProps {
  className?: string;
}

const PHOTO_NATURAL_ASPECT = 2048 / 1365;
const PHOTO_OVERSCAN = 1.12;
const CAMERA_DISTANCE = 5.4;

export const ForestScene: React.FC<ForestSceneProps> = ({ className }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const initialWidth = container.clientWidth || window.innerWidth || 1440;
    const initialHeight = container.clientHeight || window.innerHeight || 900;
    let budget = getForestBudget(initialWidth);

    const mediaQuery =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    let reducedMotion = mediaQuery?.matches ?? false;
    const runtime = createForestRuntimeState(reducedMotion);

    let stage: WebGLStage;
    try {
      stage = new WebGLStage(container, budget.maxDpr);
    } catch {
      return;
    }

    stage.renderer.setClearColor(0x050706, 1);
    stage.scene.background = new THREE.Color(0x050706);
    stage.camera.position.set(0, 0, CAMERA_DISTANCE);
    stage.camera.lookAt(0, 0, 0);

    const disposables: Array<{ dispose: () => void }> = [];

    const loader = new THREE.TextureLoader();
    const photoTexture = loader.load(forestPhotoUrl);
    photoTexture.colorSpace = THREE.SRGBColorSpace;
    photoTexture.wrapS = THREE.ClampToEdgeWrapping;
    photoTexture.wrapT = THREE.ClampToEdgeWrapping;
    photoTexture.minFilter = THREE.LinearMipmapLinearFilter;
    photoTexture.magFilter = THREE.LinearFilter;
    photoTexture.anisotropy = Math.min(8, stage.renderer.capabilities.getMaxAnisotropy());
    disposables.push(photoTexture);

    const depthTexture = loader.load(forestDepthUrl);
    depthTexture.colorSpace = THREE.NoColorSpace;
    depthTexture.wrapS = THREE.ClampToEdgeWrapping;
    depthTexture.wrapT = THREE.ClampToEdgeWrapping;
    depthTexture.minFilter = THREE.LinearFilter;
    depthTexture.magFilter = THREE.LinearFilter;
    disposables.push(depthTexture);

    const computePlaneSize = (aspect: number) => {
      const vFov = THREE.MathUtils.degToRad(stage.camera.fov);
      const visibleHeight = 2 * Math.tan(vFov / 2) * CAMERA_DISTANCE;
      const visibleWidth = visibleHeight * Math.max(0.25, aspect);
      return {
        width: visibleWidth * PHOTO_OVERSCAN,
        height: visibleHeight * PHOTO_OVERSCAN,
      };
    };

    const initialAspect = initialWidth / Math.max(1, initialHeight);
    const initialPlane = computePlaneSize(initialAspect);

    const photoUniforms = {
      uPhotoTex: { value: photoTexture },
      uDepthTex: { value: depthTexture },
      uTime: { value: 0 },
      uEmergence: { value: runtime.emergence },
      uViewportAspect: { value: initialAspect },
      uPhotoAspect: { value: PHOTO_NATURAL_ASPECT },
      uParallax: { value: new THREE.Vector2(0, 0) },
      uDrift: { value: new THREE.Vector2(0, 0) },
      uMotionScale: { value: reducedMotion ? 0 : 1 },
      // Natural foreground broadleaf branch twig node where ACT 03 hero leaf originates
      uLeafFocusUv: { value: new THREE.Vector2(0.604, 0.494) },
      uLeafAttention: { value: 0 },
      uBackdropDefocus: { value: 0 },
      uOpacity: { value: 1 },
      uLowBiotic: { value: 0.16 },
      uMidBiotic: { value: 0.14 },
      uAtmospheric: { value: 0.22 },
    };

    const photoGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
    const photoMaterial = new THREE.ShaderMaterial({
      vertexShader: FOREST_PHOTO_VERTEX_SHADER,
      fragmentShader: FOREST_PHOTO_FRAGMENT_SHADER,
      uniforms: photoUniforms,
      depthWrite: false,
      depthTest: false,
    });
    const photoMesh = new THREE.Mesh(photoGeometry, photoMaterial);
    photoMesh.name = 'ForestPhotographStage';
    photoMesh.scale.set(initialPlane.width, initialPlane.height, 1);
    photoMesh.renderOrder = 0;
    stage.scene.add(photoMesh);
    disposables.push(photoGeometry, photoMaterial);

    // Subtle 3D atmospheric moisture motes drifting through foreground air
    const maxMistParticles = 420;
    const mistPositions = new Float32Array(maxMistParticles * 3);
    const mistSeeds = new Float32Array(maxMistParticles);
    const mistScales = new Float32Array(maxMistParticles);
    const mistDepths = new Float32Array(maxMistParticles);

    for (let i = 0; i < maxMistParticles; i++) {
      const s1 = Math.sin(i * 12.9898 + 0.31) * 43758.5453;
      const r1 = s1 - Math.floor(s1);
      const s2 = Math.sin(i * 78.233 + 1.17) * 43758.5453;
      const r2 = s2 - Math.floor(s2);
      const s3 = Math.sin(i * 41.13 + 2.71) * 43758.5453;
      const r3 = s3 - Math.floor(s3);

      mistPositions[i * 3] = (r1 - 0.5) * 9.0;
      mistPositions[i * 3 + 1] = -2.2 + r2 * 4.4;
      mistPositions[i * 3 + 2] = 0.35 + r3 * 2.4;
      mistSeeds[i] = (i + 0.5) / maxMistParticles;
      mistScales[i] = 0.7 + r2 * 1.1;
      mistDepths[i] = 1.0 - r3;
    }

    const mistGeo = new THREE.BufferGeometry();
    mistGeo.setAttribute('position', new THREE.BufferAttribute(mistPositions, 3));
    mistGeo.setAttribute('aSeed', new THREE.BufferAttribute(mistSeeds, 1));
    mistGeo.setAttribute('aScale', new THREE.BufferAttribute(mistScales, 1));
    mistGeo.setAttribute('aDepth', new THREE.BufferAttribute(mistDepths, 1));
    mistGeo.setDrawRange(0, Math.min(maxMistParticles, budget.mistParticleCount));

    const mistUniforms = {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, budget.maxDpr) },
      uMotionScale: { value: reducedMotion ? 0 : 1 },
      uEmergence: { value: runtime.emergence },
      uAtmospheric: { value: 0.22 },
      uLowBiotic: { value: 0.16 },
    };

    const mistMaterial = new THREE.ShaderMaterial({
      vertexShader: FOREST_MIST_VERTEX_SHADER,
      fragmentShader: FOREST_MIST_FRAGMENT_SHADER,
      uniforms: mistUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const mistPoints = new THREE.Points(mistGeo, mistMaterial);
    mistPoints.name = 'ForestMoistureMotes';
    mistPoints.renderOrder = 2;
    stage.scene.add(mistPoints);
    disposables.push(mistGeo, mistMaterial);

    // ACT 03 — LEAF transition anchor positioned on the natural overarching branch twig node
    const heroLeafAnchorGroup = new THREE.Group();
    heroLeafAnchorGroup.name = 'Act03HeroLeafAnchor';
    heroLeafAnchorGroup.position.set(0.42, -0.02, 0.12);
    stage.scene.add(heroLeafAnchorGroup);

    let leafAttention = 0;
    const transitionHandle: ForestAct03TransitionHandle = {
      getHeroLeafWorldPosition: (out: THREE.Vector3) => heroLeafAnchorGroup.getWorldPosition(out),
      getHeroLeafGroup: () => heroLeafAnchorGroup,
      setLeafAttention: (weight: number) => {
        leafAttention = Math.max(0, Math.min(1, weight));
      },
    };
    window.__ECOSONIC_FOREST_TRANSITION__ = transitionHandle;

    const handlePointerMove = (ev: PointerEvent) => {
      if (reducedMotion || ev.pointerType === 'touch') return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      runtime.targetNdcX = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      runtime.targetNdcY = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
    };

    const handlePointerLeave = () => {
      runtime.targetNdcX = 0;
      runtime.targetNdcY = 0;
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerleave', handlePointerLeave, { passive: true });

    const handleReducedMotionChange = (ev: MediaQueryListEvent) => {
      reducedMotion = ev.matches;
      photoUniforms.uMotionScale.value = reducedMotion ? 0 : 1;
      mistUniforms.uMotionScale.value = reducedMotion ? 0 : 1;
      if (reducedMotion) {
        runtime.emergence = 1;
        runtime.parallaxX = 0;
        runtime.parallaxY = 0;
      }
    };
    mediaQuery?.addEventListener('change', handleReducedMotionChange);

    let currentMaxDpr = budget.maxDpr;
    stage.setResizeCallback((w, h) => {
      budget = getForestBudget(w);
      if (budget.maxDpr !== currentMaxDpr) {
        currentMaxDpr = budget.maxDpr;
        stage.setMaxDpr(currentMaxDpr);
      }
      const aspect = w / Math.max(1, h);
      const plane = computePlaneSize(aspect);
      photoMesh.scale.set(plane.width, plane.height, 1);
      photoUniforms.uViewportAspect.value = aspect;
      mistGeo.setDrawRange(0, Math.min(maxMistParticles, budget.mistParticleCount));
      mistUniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, budget.maxDpr);
    });

    window.__ECOSONIC_DIAGNOSTICS__ = () => {
      const diag = stage.getDiagnostics();
      return { ...diag, latency: { ...acousticStore.liveLatency } };
    };

    stage.setFrameCallback((dt) => {
      const bands = acousticStore.liveAudio.bands;
      const hasSignal = acousticStore.liveAudio.rms > 0.005;
      const targetAmbient = hasSignal
        ? Math.min(1, 0.16 + (bands[0] + bands[1] + bands[3]) * 0.2)
        : 0.16;

      runtime.audioHook.ambientEnergy +=
        (targetAmbient - runtime.audioHook.ambientEnergy) * Math.min(1, dt * 1.6);

      stepForestState(runtime, dt, budget.parallaxStrength, reducedMotion);

      const lowBiotic = runtime.audioHook.ambientEnergy;
      const midBiotic = runtime.audioHook.ambientEnergy * 0.85;
      const atmospheric = 0.18 + runtime.audioHook.ambientEnergy * 0.4;

      photoUniforms.uTime.value = runtime.clock;
      photoUniforms.uEmergence.value = runtime.emergence;
      photoUniforms.uParallax.value.set(runtime.parallaxX, runtime.parallaxY);
      photoUniforms.uDrift.value.set(runtime.driftX, runtime.driftY);
      photoUniforms.uLeafAttention.value = leafAttention;
      photoUniforms.uLowBiotic.value = lowBiotic;
      photoUniforms.uMidBiotic.value = midBiotic;
      photoUniforms.uAtmospheric.value = atmospheric;

      mistUniforms.uTime.value = runtime.clock;
      mistUniforms.uEmergence.value = runtime.emergence;
      mistUniforms.uAtmospheric.value = atmospheric;
      mistUniforms.uLowBiotic.value = lowBiotic;

      // Subtle 3D camera shift coherent with foreground moisture motes
      const camOffsetX = reducedMotion ? 0 : runtime.parallaxX * 0.08 + runtime.driftX * 0.05;
      const camOffsetY = reducedMotion ? 0 : runtime.parallaxY * 0.04 + runtime.driftY * 0.03;
      stage.camera.position.set(camOffsetX, camOffsetY, CAMERA_DISTANCE);
      stage.camera.lookAt(camOffsetX * 0.2, camOffsetY * 0.2, 0);
    });

    stage.start();

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerleave', handlePointerLeave);
      mediaQuery?.removeEventListener('change', handleReducedMotionChange);
      delete window.__ECOSONIC_FOREST_TRANSITION__;
      for (const item of disposables) {
        item.dispose();
      }
      stage.dispose();
    };
  }, []);

  return (
    <section
      aria-label="Scene 02: Forest"
      className={`relative h-dvh min-h-dvh w-full overflow-hidden bg-[#050706] select-none ${className ?? ''}`}
    >
      <div
        ref={containerRef}
        data-testid="forest-canvas-host"
        className="absolute inset-0 h-full w-full"
      />

      {/* Restrained editorial focal title only */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between px-6 pb-8 sm:px-10 sm:pb-12 lg:px-16">
        <div className="max-w-xs sm:max-w-md">
          <h1
            className="font-editorial text-[clamp(1.75rem,3.4vw,3.1rem)] font-light tracking-[0.03em] leading-[1.06] text-parchment/90"
            style={{ textShadow: '0 2px 24px rgba(5, 7, 6, 0.85)' }}
          >
            THE LIVING FIELD
          </h1>
        </div>
      </div>
    </section>
  );
};
