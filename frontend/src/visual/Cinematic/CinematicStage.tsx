import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { EditorialHeading } from "../../ui/EditorialHeading";
import type { ContinuousAudioTimeline } from "../../cinematic/CinematicAudioTimeline";
import type { CinematicScrollController } from "../../cinematic/CinematicScrollController";
import type { CinematicStateStore } from "../../cinematic/CinematicState";
import {
  getActOverlayOpacity,
  getSegmentForAct,
  smoothstep,
  TIMELINE_SEGMENTS,
} from "../../cinematic/CinematicTimeline";
import { evaluateCinematicTransitions } from "../../cinematic/CinematicTransition";
import {
  fetchExpectedSpeciesForScene11,
  fetchObservationGapForScene12,
  getUrlAnalysisId,
  hydrateEcologicalContextForActs,
} from "../../api/ecosonicEcologyApi";
import { acousticStore } from "../../domain/acousticStore";
import type { StoryboardAct } from "../../domain/storyboard";
import { AcousticFieldOverlay } from "../AcousticField/AcousticField";
import {
  createAcousticFieldLayer,
  type ProjectedSpatialTrace,
} from "../AcousticField/acousticFieldEngine";
import { ExpectedSpeciesScene } from "../ExpectedSpecies/ExpectedSpeciesScene";
import { resolveBirdTunnelSlides } from "../ExpectedSpecies/birdTunnelAssets";
import { ObservationGapScene } from "../ObservationGap/ObservationGapScene";
import { createGalleryTunnelController } from "../../components/originkit/ui/hero-13/gallery-tunnel";
import { Section20Hero } from "../../components/originkit/ui/hero-13/section-20-hero";
import { Act10PhotoCardGlobe } from "../Globe/Act10PhotoCardGlobe";
import { createEcologicalFieldLayer } from "../EcologicalField/ecologicalFieldEngine";
import { createValleyLayer } from "../Valley/valleyLayer";
import { Act07To10OverlayTrack } from "./CinematicOverlays";
import { useReducedMotion } from "../engine/useReducedMotion";
import {
  getAcousticFieldBudget,
  getEcologicalFieldBudget,
  getForestBudget,
} from "../engine/viewportBudget";
import { WebGLStage } from "../engine/WebGLStage";
import {
  type CinematicActId,
  type CinematicDirectorState,
  type ForestWaterPhase,
} from "./cinematicSequence";

export interface CinematicDebugController {
  getState: () => {
    act: CinematicActId;
    phase: ForestWaterPhase;
    progress: number;
    scrollProgress: number;
    weights: CinematicDirectorState["weights"];
  };
  jumpToAct: (act: CinematicActId, progress?: number) => void;
  scrollToProgress: (progress: number, instant?: boolean) => void;
  getScrollProgress: () => number;
  getTimeline: () => typeof TIMELINE_SEGMENTS;
  refreshEcology: (latitude?: number, longitude?: number) => Promise<void>;
}

declare global {
  interface Window {
    __ECOSONIC_CINEMATIC__?: CinematicDebugController;
  }
}

export interface CinematicStageProps {
  activeAct: StoryboardAct;
  scrollProgress: number;
  stateStore: CinematicStateStore;
  scrollController: CinematicScrollController;
  audioTimeline: ContinuousAudioTimeline;
  className?: string;
}

const CINEMATIC_CAPTIONS: readonly {
  id: CinematicActId;
  act: StoryboardAct;
  kicker: string | null;
  title: string | null;
  hoverNote?: string;
  subtitle: string | null;
}[] = [
  {
    id: "ACT_01_BLACKNESS",
    act: "BLACKNESS",
    kicker: null,
    title: null,
    subtitle: null,
  },
  {
    id: "ACT_02_FOREST",
    act: "FOREST",
    kicker: "ACT 02 · LIVING VALLEY",
    title: "The living field",
    hoverNote: "Nocturnal woodland strata at threshold.",
    subtitle: "Nocturnal flora · canopy soundscape",
  },
  {
    id: "ACT_03_LEAF",
    act: "LEAF",
    kicker: "ACT 03 · FLORA & STRATA",
    title: "Canopy into resonance",
    hoverNote: "Botanical structure modulates acoustic propagation.",
    subtitle: "Botanical drift · nocturnal stratification",
  },
  {
    id: "ACT_04_WATER",
    act: "WATER",
    kicker: "ACT 04 · NOCTURNAL FLOOR",
    title: "Every contact displaces",
    hoverNote: "Minimal disturbance propagates across the forest floor.",
    subtitle: "Night mist · approaching acoustic field",
  },
  {
    id: "ACT_05_SOUND",
    act: "SOUND",
    kicker: "ACT 05 · ACOUSTIC ENERGY",
    title: "Every wave carries information",
    hoverNote: "Pressure vibrations resolve into identifiable frequency.",
    subtitle: "Sound becomes observation · frequency strata",
  },
];

function resolveCaptionTransitionStyle(
  id: CinematicActId,
  opacity: number,
  scrollProgress: number,
  reducedMotion: boolean,
): React.CSSProperties {
  if (reducedMotion) {
    return {
      opacity,
      visibility: opacity > 0.001 ? "visible" : "hidden",
    };
  }
  const seg = getSegmentForAct(id);
  const mid = (seg.start + seg.end) * 0.5;
  const isExiting = scrollProgress > mid;
  // Curved crossfade reduces double-exposure stacking at shared bottom-left anchor
  const shapedOpacity = Math.pow(Math.max(0, Math.min(1, opacity)), 1.55);
  const rest = Math.max(0, 1 - opacity);
  const blurPx = opacity < 0.85 ? rest * 2.4 : 0;
  const yDrift = isExiting ? -rest * 20 : rest * 22;
  const xDrift = id === "ACT_03_LEAF" ? (isExiting ? rest * 8 : -rest * 8) : 0;
  const scale =
    id === "ACT_03_LEAF" || id === "ACT_05_SOUND"
      ? 0.99 + opacity * 0.01
      : 1;
  return {
    opacity: shapedOpacity,
    visibility: shapedOpacity > 0.002 ? "visible" : "hidden",
    transform: `translate3d(${xDrift.toFixed(2)}px, ${yDrift.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`,
    filter: blurPx > 0.05 ? `blur(${blurPx.toFixed(2)}px)` : undefined,
  };
}

export const CinematicStage: React.FC<CinematicStageProps> = ({
  activeAct,
  scrollProgress,
  stateStore,
  scrollController,
  audioTimeline,
  className = "",
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  const [traceAnchor, setTraceAnchor] = useState<ProjectedSpatialTrace>({
    xPct: 58,
    yPct: 44,
    active: false,
    isDisturbance: false,
    strength: 0,
  });

  // Context is fetched from the real ecology backend cleanly in a single deduplicated pass.
  const triggerActHooks = (act: CinematicActId) => {
    if (
      act === "ACT_10_ECOLOGICAL_CONTEXT" ||
      act === "ACT_11_EXPECTED_SPECIES" ||
      act === "ACT_12_OBSERVATION_GAP"
    ) {
      const snap = acousticStore.getSnapshot();
      const urlAnalysisId = getUrlAnalysisId();
      if (
        (urlAnalysisId && snap.activeAnalysisId !== urlAnalysisId) ||
        (!snap.ecologicalContext && !snap.expectedBaseline && snap.ecologicalStatus === "idle") ||
        (act === "ACT_10_ECOLOGICAL_CONTEXT" && !snap.ecologicalContext && snap.ecologicalStatus !== "loading")
      ) {
        void hydrateEcologicalContextForActs();
      }
    }
  };

  // Hydrate immediately if deep-linked to ?analysis=<id> OR Acts 10-12 on initial mount
  useEffect(() => {
    const initialAct = stateStore.getSnapshot().currentAct;
    const urlAnalysisId = getUrlAnalysisId();
    if (
      urlAnalysisId ||
      initialAct === "ACT_10_ECOLOGICAL_CONTEXT" ||
      initialAct === "ACT_11_EXPECTED_SPECIES" ||
      initialAct === "ACT_12_OBSERVATION_GAP"
    ) {
      void hydrateEcologicalContextForActs();
    }
  }, [stateStore]);

  // Scrolling is the sole page-level source of cinematic progress.
  useEffect(() => {
    stateStore.setReducedMotion(reducedMotion);
  }, [reducedMotion, stateStore]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const initialWidth = Math.max(1, container.clientWidth || window.innerWidth);
    const initialHeight = Math.max(1, container.clientHeight || window.innerHeight);

    let forestBudget = getForestBudget(initialWidth);
    let fieldBudget = getAcousticFieldBudget(initialWidth);
    let ecoFieldBudget = getEcologicalFieldBudget(initialWidth);

    let stage: WebGLStage;
    try {
      stage = new WebGLStage(container, Math.max(forestBudget.maxDpr, fieldBudget.maxDpr, ecoFieldBudget.maxDpr));
    } catch {
      return;
    }

    stage.renderer.setClearColor(0x060708, 1);
    stage.scene.background = new THREE.Color(0x060708);

    const disposables: Array<{ dispose: () => void }> = [];
    const valleyFog = new THREE.FogExp2(0x020307, 0.0165);
    const obsidianBg = new THREE.Color(0x060708);
    const valleyBg = new THREE.Color(0x020307);
    const blendedBg = new THREE.Color(0x060708);

    // --- LAYER 1: ACT 02 -> ACT 04 Adapted ECOsonic-main Night Flower Valley ---
    const valleyLayer = createValleyLayer(
      stage,
      forestBudget,
      reducedMotionRef.current,
    );
    stage.scene.add(valleyLayer.group);
    disposables.push({ dispose: () => valleyLayer.dispose() });

    // --- LAYER 4: ACT 05 -> ACT 09 Accepted Acoustic Field Engine ---
    const acousticFieldLayer = createAcousticFieldLayer(
      stage,
      container,
      fieldBudget,
      reducedMotionRef.current,
    );
    stage.scene.add(acousticFieldLayer.group);

    // --- LAYER 5: ACT 10 PhotoCardGlobe renders as integrated interactive WebGL2 sphere layer ---

    // --- LAYER 6: ACT 11 -> ACT 12 Shared Ecological Intelligence Field + Moving Bird Photo Tunnel ---
    const ecologicalFieldLayer = createEcologicalFieldLayer(
      stage,
      ecoFieldBudget,
      reducedMotionRef.current,
    );
    stage.scene.add(ecologicalFieldLayer.group);
    disposables.push({ dispose: () => ecologicalFieldLayer.dispose() });

    let lastTunnelBaseline = acousticStore.getSnapshot().expectedBaseline;
    const galleryTunnel = createGalleryTunnelController({
      images: resolveBirdTunnelSlides(lastTunnelBaseline),
      background: "#080808",
      lineColor: "#B0B0B0",
      lineOpacity: 0,
      grid: 8,
      cellMode: "square",
      speed: 50,
      boost: 100,
      fade: 100,
      transparentBackground: true,
    });
    const unsubscribeTunnelBaseline = acousticStore.subscribe(() => {
      const nextBaseline = acousticStore.getSnapshot().expectedBaseline;
      if (nextBaseline === lastTunnelBaseline) return;
      lastTunnelBaseline = nextBaseline;
      galleryTunnel.updateSlides(resolveBirdTunnelSlides(nextBaseline));
    });
    let currentTunnelOpacity = 0;
    let currentTunnelReduced = reducedMotionRef.current;
    let tunnelBoostPressed = false;
    const handleTunnelPointerDown = (ev: PointerEvent) => {
      if (currentTunnelOpacity <= 0.05) return;
      const target = ev.target as HTMLElement | null;
      if (
        target?.closest?.(
          "button, a, input, select, [data-card-trigger], [data-specimen-card], [role='dialog'], [role='tab']",
        )
      ) {
        return;
      }
      tunnelBoostPressed = true;
    };
    const handleTunnelPointerUp = () => {
      tunnelBoostPressed = false;
    };
    window.addEventListener("pointerdown", handleTunnelPointerDown, { passive: true });
    window.addEventListener("pointerup", handleTunnelPointerUp, { passive: true });
    window.addEventListener("blur", handleTunnelPointerUp);

    window.__ECOSONIC_CINEMATIC__ = {
      getState: () => {
        const snap = stateStore.getSnapshot();
        return {
          act: snap.currentAct,
          phase: snap.forestWaterPhase,
          progress: snap.actProgress,
          scrollProgress: snap.scrollProgress,
          weights: { ...stateStore.runtime.lastTransition.weights },
        };
      },
      jumpToAct: (act: CinematicActId, progress?: number) => {
        const target = stateStore.jumpToAct(act, progress);
        scrollController.scrollToProgress(target, true);
        triggerActHooks(act);
      },
      scrollToProgress: (progress: number, instant = false) => {
        scrollController.scrollToProgress(progress, instant);
      },
      getScrollProgress: () => stateStore.runtime.smoothScrollProgress,
      getTimeline: () => TIMELINE_SEGMENTS,
      refreshEcology: async (latitude?: number, longitude?: number) => {
        await hydrateEcologicalContextForActs({ latitude, longitude });
      },
    };

    // Pointer interaction shared cleanly between Night Valley & Acoustic Field
    const handlePointerMove = (ev: PointerEvent) => {
      if (reducedMotionRef.current || ev.pointerType === "touch") return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const ndcX = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
      valleyLayer.setPointerNdc(ndcX, ndcY);
    };
    const handlePointerLeave = () => {
      valleyLayer.setPointerNdc(0.32, -0.28);
    };
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerleave", handlePointerLeave, { passive: true });

    let viewportAspect = initialWidth / Math.max(1, initialHeight);
    let currentMaxDpr = forestBudget.maxDpr;
    stage.setResizeCallback((w, h) => {
      const nextForest = getForestBudget(w);
      const nextField = getAcousticFieldBudget(w);
      const nextEcoField = getEcologicalFieldBudget(w);
      const nextTierChanged = nextField.tier !== fieldBudget.tier;
      forestBudget = nextForest;
      fieldBudget = nextField;
      ecoFieldBudget = nextEcoField;

      const activeActId = stateStore.getSnapshot().currentAct;
      const isFieldOrBeyond =
        activeActId === "ACT_06_ACOUSTIC_FIELD" ||
        activeActId === "ACT_07_SPECIES" ||
        activeActId === "ACT_08_DISTURBANCE" ||
        activeActId === "ACT_09_SILENCE" ||
        activeActId === "ACT_10_ECOLOGICAL_CONTEXT" ||
        activeActId === "ACT_11_EXPECTED_SPECIES" ||
        activeActId === "ACT_12_OBSERVATION_GAP";

      const desiredDpr = isFieldOrBeyond
        ? Math.max(fieldBudget.maxDpr, ecoFieldBudget.maxDpr)
        : forestBudget.maxDpr;
      if (desiredDpr !== currentMaxDpr) {
        currentMaxDpr = desiredDpr;
        stage.setMaxDpr(currentMaxDpr);
      }

      viewportAspect = w / Math.max(1, h);
      const dpr = stage.renderer.getPixelRatio();
      valleyLayer.setBudget(forestBudget, dpr);

      if (nextTierChanged) {
        acousticFieldLayer.applyBudget(fieldBudget, dpr);
        ecologicalFieldLayer.applyBudget(ecoFieldBudget, dpr);
      } else {
        acousticFieldLayer.setPixelRatio(dpr);
        ecologicalFieldLayer.applyBudget(ecoFieldBudget, dpr);
      }
    });

    window.__ECOSONIC_DIAGNOSTICS__ = () => {
      const diag = stage.getDiagnostics();
      return {
        ...diag,
        ecologicalFieldVisible: ecologicalFieldLayer.group.visible,
        latency: { ...acousticStore.liveLatency },
      };
    };

    const camPos = new THREE.Vector3(0, 0, 5.6);
    const camTarget = new THREE.Vector3(0, 0, 0);
    const originVec = new THREE.Vector3(0, 0, 0);
    const soundCamPos = new THREE.Vector3(0, 0, fieldBudget.cameraDistance);
    let traceSyncAccum = 0;

    stage.setFrameCallback((dt) => {
      const reduced = reducedMotionRef.current;

      const prevActId = stateStore.getEvaluation().act;
      const entered = scrollController.tick(dt);
      const frame = stateStore.runtime.lastTransition;
      const currentActId = frame.evaluation.act;
      const actProg = frame.evaluation.actProgress;
      const smoothScroll = frame.evaluation.scrollProgress;
      const w = frame.weights;

      if (entered && entered !== prevActId) {
        triggerActHooks(entered);
      }

      const snap = acousticStore.getSnapshot();
      const isMic = snap.audio.source === "microphone";
      const isExplicitSilent =
        currentActId === "ACT_06_ACOUSTIC_FIELD" &&
        snap.audio.source === "silent" &&
        snap.soundscape.quietness > 0.9;
      audioTimeline.update(frame.audio, isMic, isExplicitSilent);

      // Continuous Night Flower Valley opacity & blossom-to-particle dispersion across Acts 01 -> 05
      const valleyOpacity = w.forestOpacity;
      const lateWaterRelease =
        smoothScroll > 0.36
          ? Math.max(0, Math.min(1, (smoothScroll - 0.36) / 0.08)) * 0.14
          : 0;
      const valleyDisperse = Math.min(1, lateWaterRelease + w.soundMorph * 0.8);
      const valleyView = valleyLayer.update({
        dt,
        scrollProgress: smoothScroll,
        opacity: valleyOpacity,
        disperse: valleyDisperse,
        aspect: viewportAspect,
        reducedMotion: reduced,
      });

      const isValleyActive = valleyLayer.group.visible;
      if (isValleyActive) {
        blendedBg.copy(obsidianBg).lerp(valleyBg, valleyOpacity);
        stage.scene.background = blendedBg;
        valleyFog.density = 0.004 + 0.0125 * valleyOpacity;
        stage.scene.fog = valleyFog;
        stage.renderer.toneMapping =
          valleyOpacity > 0.01 ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
        stage.renderer.toneMappingExposure = 1.0 + 0.08 * valleyOpacity;
      } else {
        stage.scene.background = obsidianBg;
        stage.scene.fog = null;
        stage.renderer.toneMapping = THREE.NoToneMapping;
        stage.renderer.toneMappingExposure = 1.0;
      }

      const isFieldControl =
        currentActId === "ACT_06_ACOUSTIC_FIELD" ||
        currentActId === "ACT_07_SPECIES" ||
        currentActId === "ACT_08_DISTURBANCE" ||
        currentActId === "ACT_09_SILENCE" ||
        currentActId === "ACT_10_ECOLOGICAL_CONTEXT" ||
        currentActId === "ACT_11_EXPECTED_SPECIES" ||
        currentActId === "ACT_12_OBSERVATION_GAP";

      if (!isFieldControl) {
        const m = w.soundMorph;
        const mEase = m * m * (3 - 2 * m);
        soundCamPos.set(
          Math.sin(mEase * Math.PI * 0.25) * 0.4 * (1 - mEase),
          0,
          fieldBudget.cameraDistance,
        );
        camPos.copy(valleyView.camPos).lerp(soundCamPos, mEase);
        camTarget.copy(valleyView.camTarget).lerp(originVec, mEase);

        const targetFov = THREE.MathUtils.lerp(valleyView.fov, 42, mEase);
        if (Math.abs(stage.camera.fov - targetFov) > 0.02) {
          stage.camera.fov = targetFov;
          stage.camera.updateProjectionMatrix();
        }
        stage.camera.position.copy(camPos);
        stage.camera.lookAt(camTarget);
        stage.camera.rotateZ(valleyView.camRoll * (1 - mEase));
      } else if (Math.abs(stage.camera.fov - 42) > 0.02) {
        stage.camera.fov = 42;
        stage.camera.updateProjectionMatrix();
      }

      // Layer 4 ACT 05 -> ACT 09 Acoustic Field (seeded cleanly during Valley -> Sound dispersion)
      const soundP =
        currentActId === "ACT_05_SOUND"
          ? actProg
          : isFieldControl
            ? 1
            : 0;
      acousticFieldLayer.update(
        dt,
        fieldBudget,
        reduced,
        w.soundMorph,
        w.fieldOpacity,
        isFieldControl,
        w.silenceOverride,
        soundP > 0 && currentActId === "ACT_05_SOUND"
          ? {
              rippleAge: soundP * 2.2,
              contactImpulse: 0.45 * (1 - soundP * 0.5),
              impactX: 0,
              impactZ: 0,
            }
          : undefined,
      );

      // Sync projected 2D spatial leader coordinate during ACT 07 SPECIES & ACT 08 DISTURBANCE (~15 Hz throttle)
      if (
        currentActId === "ACT_07_SPECIES" ||
        currentActId === "ACT_08_DISTURBANCE"
      ) {
        traceSyncAccum += dt;
        if (traceSyncAccum >= 0.066) {
          traceSyncAccum = 0;
          const pt = acousticFieldLayer.projectedTrace;
          setTraceAnchor((prev) =>
            prev.active !== pt.active ||
            prev.isDisturbance !== pt.isDisturbance ||
            Math.abs(prev.xPct - pt.xPct) > 0.4 ||
            Math.abs(prev.yPct - pt.yPct) > 0.4
              ? { ...pt }
              : prev,
          );
        }
      }

      // Layer 6: Continuous GalleryTunnel blend across Act 10 -> Act 11 -> Act 12
      const targetTunnelOpacity = w.ecologicalFieldOpacity ?? 0;
      ecologicalFieldLayer.update(dt, 0, reduced);
      currentTunnelOpacity = targetTunnelOpacity;
      currentTunnelReduced = reduced;
    });

    stage.setAfterRenderCallback((dt) => {
      if (currentTunnelOpacity > 0.001) {
        galleryTunnel.renderFrame(
          stage.renderer,
          dt,
          stage.camera.aspect,
          currentTunnelOpacity,
          currentTunnelReduced,
          tunnelBoostPressed,
        );
      }
    });

    stage.start();

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerLeave);
      window.removeEventListener("pointerdown", handleTunnelPointerDown);
      window.removeEventListener("pointerup", handleTunnelPointerUp);
      window.removeEventListener("blur", handleTunnelPointerUp);
      unsubscribeTunnelBaseline();
      galleryTunnel.dispose();
      stage.setAfterRenderCallback(null);
      delete window.__ECOSONIC_CINEMATIC__;
      window.__ECOSONIC_DIAGNOSTICS__ = undefined;
      acousticFieldLayer.dispose();
      for (const item of disposables) {
        item.dispose();
      }
      stage.dispose();
    };
  }, []);

  // The label follows the derived active act; all visible captions use scroll crossfades.
  const sceneAria = (() => {
    switch (activeAct) {
      case "BLACKNESS":
        return "Scene 01: Blackness";
      case "FOREST":
        return "Scene 02: Forest";
      case "LEAF":
        return "Scene 03: Leaf";
      case "WATER":
        return "Scene 04: Water";
      case "SOUND":
        return "Scene 05: Sound";
      case "SPECIES":
        return "Scene 07: Species";
      case "DISTURBANCE":
        return "Scene 08: Disturbance";
      case "SILENCE":
        return "Scene 09: Silence";
      case "ECOLOGICAL CONTEXT":
        return "Scene 10: Ecological Context";
      case "EXPECTED SPECIES":
        return "Scene 11: Expected Species";
      case "OBSERVATION GAP":
        return "Scene 12: Observation Gap";
      case "ACOUSTIC FIELD":
        return "Scene 06: Acoustic Field";
      default:
        return "Scene 01: Blackness";
    }
  })();

  const transitionFrame = useMemo(
    () => evaluateCinematicTransitions(scrollProgress, 0, reducedMotion),
    [scrollProgress, reducedMotion],
  );
  const frameWeights = transitionFrame.weights;
  const fieldBackdropWeight = frameWeights.fieldOpacity;
  const tunnelVignetteWeight = frameWeights.ecologicalFieldOpacity;
  const fieldOverlayOpacity = getActOverlayOpacity(
    "ACT_06_ACOUSTIC_FIELD",
    scrollProgress,
  );

  return (
    <section
      aria-label={sceneAria}
      className={`relative h-dvh min-h-dvh w-full overflow-hidden bg-[#080808] select-none ${className}`}
    >
      {/* PERSISTENT SHARED BACKGROUND LAYER (Acts 11-12) */}
      <div
        data-testid="shared-scene-background"
        className="fixed inset-0 z-0 pointer-events-none overflow-hidden"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100vh",
          overflow: "hidden",
          zIndex: 0,
          pointerEvents: "none",
        }}
      >
        {fieldBackdropWeight > 0.005 ? (
          <div
            aria-hidden="true"
            className="ecosonic-atmosphere pointer-events-none absolute inset-0"
            style={{ opacity: Math.min(1, fieldBackdropWeight * 0.92) }}
          />
        ) : null}

        <div
          ref={containerRef}
          data-testid={
            activeAct === "FOREST"
              ? "forest-canvas-host"
              : activeAct === "ACOUSTIC FIELD"
                ? "acoustic-field-canvas-host"
                : "cinematic-canvas-host"
          }
          className="absolute inset-0 h-full w-full touch-pan-y pointer-events-none"
        />

        {fieldBackdropWeight > 0.005 ? (
          <div
            aria-hidden="true"
            className="ecosonic-grain pointer-events-none absolute inset-0"
            style={{ opacity: fieldBackdropWeight * 0.5 }}
          />
        ) : null}

        {/* Compositional atmospheric darkening vignette for content readability */}
        <div
          aria-hidden="true"
          className="ecosonic-vignette pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 82% 68% at 50% 48%, rgba(6, 8, 7, 0.0) 0%, rgba(5, 7, 6, 0.24) 62%, rgba(2, 4, 3, 0.62) 100%)",
            opacity: tunnelVignetteWeight,
          }}
        />
      </div>

      {/* Centered restrained ECOsonic landing spotlight in ACT 01 transitioning seamlessly into ACT 02 forest */}
      {(() => {
        const landingVisibility = Math.max(0, 1 - smoothstep(0.014, 0.072, scrollProgress));
        if (landingVisibility <= 0.004) return null;
        return (
          <div
            data-testid="landing-ecosonic-spotlight"
            aria-hidden={activeAct !== "BLACKNESS"}
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6"
            style={{
              opacity: landingVisibility,
              transform: reducedMotion
                ? undefined
                : `scale(${(1 + (1 - landingVisibility) * 0.04).toFixed(4)})`,
              filter:
                !reducedMotion && landingVisibility < 0.78
                  ? `blur(${((1 - landingVisibility) * 4).toFixed(2)}px)`
                  : undefined,
            }}
          >
            {/* Physical beam dim spotlight in obsidian darkness — zero neon or bright glow */}
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-0 ${
                reducedMotion ? "" : "ecosonic-spotlight-beam"
              }`}
              style={{
                background: [
                  "radial-gradient(ellipse 36% 24% at 50% 48%, rgba(232, 228, 220, 0.085) 0%, rgba(200, 155, 98, 0.032) 34%, rgba(6, 7, 8, 0) 74%)",
                  "linear-gradient(180deg, rgba(232, 228, 220, 0.042) 0%, rgba(232, 228, 220, 0.015) 45%, rgba(6, 7, 8, 0) 72%)",
                ].join(", "),
              }}
            />
            <div
              className={`relative text-center ${
                reducedMotion ? "" : "ecosonic-wordmark-emerge"
              }`}
            >
              <EditorialHeading
                text="ECOsonic"
                hoverNote="Environmental Acoustic Intelligence"
                revealKey="ACT_01_LANDING_BRAND"
                align="center"
                stagger={14}
                reducedMotion={reducedMotion}
                className="font-editorial text-[clamp(3.4rem,8vw,6.75rem)] font-normal leading-[0.94] tracking-[-0.025em] text-[#E8E4DC]"
                style={{ textShadow: "0 12px 48px rgba(0, 0, 0, 0.9)" }}
              />
            </div>
          </div>
        );
      })()}

      {CINEMATIC_CAPTIONS.map(({ id, act, kicker, title, hoverNote, subtitle }) => {
        const opacity = getActOverlayOpacity(id, scrollProgress);
        if (opacity <= 0.001) return null;
        const isMonochrome = id !== "ACT_05_SOUND";
        return (
          <div
            key={id}
            aria-hidden={activeAct !== act}
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between px-6 pb-8 sm:px-10 sm:pb-12 lg:px-16"
            style={resolveCaptionTransitionStyle(id, opacity, scrollProgress, reducedMotion)}
          >
            <div className="max-w-md space-y-2">
              {kicker ? (
                <p className={`text-[10px] uppercase tracking-[0.24em] ${isMonochrome ? "text-[#C8C8C8]/85" : "text-parchment/60"}`}>
                  {kicker}
                </p>
              ) : null}
              {title ? (
                <EditorialHeading
                  text={title}
                  hoverNote={hoverNote}
                  revealKey={id}
                  align="left"
                  stagger={12}
                  reducedMotion={reducedMotion}
                  className={`font-editorial text-[clamp(1.75rem,3.4vw,3.1rem)] font-light tracking-[0.02em] leading-[1.06] ${isMonochrome ? "text-[#F0F0F0]" : "text-parchment/90"}`}
                  style={{ textShadow: isMonochrome ? "0 2px 24px rgba(8, 8, 8, 0.92)" : "0 2px 24px rgba(5, 7, 6, 0.85)" }}
                />
              ) : null}
              {subtitle ? (
                <p className={`text-[11px] uppercase tracking-[0.18em] ${isMonochrome ? "text-[#9E9E9E]/90" : "text-slate/85"}`}>
                  {subtitle}
                </p>
              ) : null}
            </div>
          </div>
        );
      })}

      <div
        aria-hidden={activeAct !== "ACOUSTIC FIELD"}
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          opacity: fieldOverlayOpacity,
          visibility: fieldOverlayOpacity > 0.001 ? "visible" : "hidden",
          transform: reducedMotion
            ? undefined
            : `translate3d(0, ${((1 - fieldOverlayOpacity) * 10).toFixed(2)}px, 0) scale(${(0.992 + fieldOverlayOpacity * 0.008).toFixed(4)})`,
        }}
      >
        {fieldOverlayOpacity > 0.001 ? <AcousticFieldOverlay /> : null}
      </div>

      <Act10PhotoCardGlobe
        opacity={frameWeights.globeOpacity}
        globePullback={transitionFrame.camera.globePullback}
        scrollProgress={scrollProgress}
        interactive={activeAct === "ECOLOGICAL CONTEXT"}
        reducedMotion={reducedMotion}
      />

      <Act07To10OverlayTrack
        activeAct={activeAct}
        scrollProgress={scrollProgress}
        traceAnchor={traceAnchor}
        reducedMotion={reducedMotion}
        onRequestEcologyRefresh={() => void hydrateEcologicalContextForActs()}
      />

      {(() => {
        const expectedOpacity = getActOverlayOpacity(
          "ACT_11_EXPECTED_SPECIES",
          scrollProgress,
          0.024,
        );
        const gapOpacity = getActOverlayOpacity(
          "ACT_12_OBSERVATION_GAP",
          scrollProgress,
          0.024,
        );
        // Subtle midpoint breath across 11 <-> 12 so bottom-left chapter marker crossfades softly
        const midpointProximity = Math.max(
          0,
          1 - Math.abs(scrollProgress - 0.95) / 0.015,
        );
        const chapterDip = reducedMotion ? 1 : 1 - midpointProximity * 0.42;
        const sharedChapterOpacity =
          Math.max(expectedOpacity, gapOpacity) * chapterDip;
        if (sharedChapterOpacity <= 0.001) return null;
        const sharedScene =
          activeAct === "OBSERVATION GAP" || gapOpacity > expectedOpacity
            ? "observation-gap"
            : "expected-species";
        return (
          <Section20Hero
            overlayOnly
            activeScene={sharedScene}
            opacity={sharedChapterOpacity}
            reducedMotion={reducedMotion}
          />
        );
      })()}

      {(() => {
        const expectedOpacity = getActOverlayOpacity(
          "ACT_11_EXPECTED_SPECIES",
          scrollProgress,
          0.024,
        );
        if (expectedOpacity <= 0.001) return null;
        const exitingToGap = scrollProgress > 0.925;
        const rest = 1 - expectedOpacity;
        const blurPx = expectedOpacity < 0.88 ? rest * 3.8 : 0;
        const shaped = reducedMotion ? expectedOpacity : Math.pow(expectedOpacity, 2.05);
        return (
          <div
            aria-hidden={activeAct !== "EXPECTED SPECIES"}
            className="absolute inset-0 z-10"
            style={{
              opacity: shaped,
              visibility: shaped > 0.002 ? "visible" : "hidden",
              pointerEvents: activeAct === "EXPECTED SPECIES" ? "auto" : "none",
              transform: reducedMotion
                ? undefined
                : exitingToGap
                  ? `perspective(1200px) translate3d(0, ${(-rest * 32).toFixed(2)}px, 0) scale(${(0.935 + expectedOpacity * 0.065).toFixed(4)})`
                  : `perspective(1200px) translate3d(0, ${(rest * 30).toFixed(2)}px, 0) scale(${(0.955 + expectedOpacity * 0.045).toFixed(4)})`,
              filter: !reducedMotion && blurPx > 0.05 ? `blur(${blurPx.toFixed(2)}px)` : undefined,
            }}
          >
            <ExpectedSpeciesScene
              reducedMotion={reducedMotion}
              onRefreshBackend={() => void fetchExpectedSpeciesForScene11()}
            />
          </div>
        );
      })()}

      {(() => {
        const gapOpacity = getActOverlayOpacity(
          "ACT_12_OBSERVATION_GAP",
          scrollProgress,
          0.024,
        );
        if (gapOpacity <= 0.001) return null;
        const rest = 1 - gapOpacity;
        const blurPx = gapOpacity < 0.88 ? rest * 3.6 : 0;
        const shaped = reducedMotion ? gapOpacity : Math.pow(gapOpacity, 2.05);
        return (
          <div
            aria-hidden={activeAct !== "OBSERVATION GAP"}
            className="absolute inset-0 z-10"
            style={{
              opacity: shaped,
              visibility: shaped > 0.002 ? "visible" : "hidden",
              pointerEvents: activeAct === "OBSERVATION GAP" ? "auto" : "none",
              transform: reducedMotion
                ? undefined
                : `perspective(1200px) translate3d(0, ${(rest * 34).toFixed(2)}px, 0) scale(${(1.048 - gapOpacity * 0.048).toFixed(4)})`,
              filter: !reducedMotion && blurPx > 0.05 ? `blur(${blurPx.toFixed(2)}px)` : undefined,
            }}
          >
            <ObservationGapScene
              reducedMotion={reducedMotion}
              onRefreshBackend={() => void fetchObservationGapForScene12()}
            />
          </div>
        );
      })()}
    </section>
  );
};
