import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { EditorialHeading } from "../../ui/EditorialHeading";
import {
  acousticStore,
  isLiveAudioSilent,
} from "../../domain/acousticStore";
import type { LatencyTelemetry } from "../../domain/acousticFieldTypes";
import { WebGLStage, type StageDiagnostics } from "../engine/WebGLStage";
import { useReducedMotion } from "../engine/useReducedMotion";
import { getAcousticFieldBudget } from "../engine/viewportBudget";
import { createAcousticFieldLayer } from "./acousticFieldEngine";

declare global {
  interface Window {
    __ECOSONIC_DIAGNOSTICS__?: () =>
      | (StageDiagnostics & { latency: LatencyTelemetry })
      | null;
  }
}

export interface AcousticFieldProps {
  className?: string;
}

export const AcousticFieldOverlay: React.FC = () => {
  const snapshot = useSyncExternalStore(
    acousticStore.subscribe,
    acousticStore.getSnapshot,
    acousticStore.getSnapshot,
  );

  const latestDetection = snapshot.detections[0] ?? null;
  const latestDisturbance = snapshot.disturbances[0] ?? null;
  const isSilent = isLiveAudioSilent(snapshot.audio.rms, snapshot.audio.source);
  const liveAudioStreaming =
    snapshot.session.connection === "live" && snapshot.session.status === "listening";

  const [visibleDetectionId, setVisibleDetectionId] = useState<string | null>(null);
  const [visibleDisturbanceId, setVisibleDisturbanceId] = useState<string | null>(null);

  useEffect(() => {
    if (!latestDetection || isSilent) {
      setVisibleDetectionId(null);
      return;
    }
    setVisibleDetectionId(latestDetection.id);
    const timer = window.setTimeout(() => {
      setVisibleDetectionId((prev) => (prev === latestDetection.id ? null : prev));
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [latestDetection?.id, isSilent]);

  useEffect(() => {
    if (!latestDisturbance || isSilent) {
      setVisibleDisturbanceId(null);
      return;
    }
    setVisibleDisturbanceId(latestDisturbance.id);
    const ttl = Math.max(2000, latestDisturbance.durationMs || 3600);
    const timer = window.setTimeout(() => {
      setVisibleDisturbanceId((prev) =>
        prev === latestDisturbance.id ? null : prev,
      );
    }, ttl);
    return () => window.clearTimeout(timer);
  }, [latestDisturbance?.id, latestDisturbance?.durationMs, isSilent]);

  const activeDetection =
    latestDetection && latestDetection.id === visibleDetectionId
      ? latestDetection
      : null;
  const activeDisturbance =
    latestDisturbance && latestDisturbance.id === visibleDisturbanceId
      ? latestDisturbance
      : null;

  const reducedMotion = useReducedMotion();

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex h-full flex-col justify-between px-6 pb-8 pt-24 sm:px-10 sm:pb-10 sm:pt-24 lg:px-16 lg:pt-24">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate">
            {isSilent
              ? "FIELD SETTLED · AWAITING ACOUSTIC ENERGY"
              : "OBSERVATION ACTIVE · FREQUENCY STRATA"}
          </p>
          <p className="text-[10px] uppercase tracking-[0.18em] text-slate/75">
            {snapshot.session.siteName}
          </p>
        </div>

        <div
          aria-live="polite"
          className="flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-slate tabular-nums"
        >
          <span className="inline-flex items-center gap-2 text-parchment/85">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isSilent
                  ? "bg-slate/50"
                  : snapshot.session.connection === "live"
                    ? "bg-parchment"
                    : "bg-ochre/80"
              }`}
            />
            {isSilent ? "STANDBY" : "LISTENING"}
          </span>
          <span className="text-parchment/30">·</span>
          <span>
            {liveAudioStreaming
              ? "LIVE AUDIO · PCM TRANSMITTING"
              : snapshot.session.connection === "live"
                ? "BACKEND CONNECTED · WAITING FOR PCM"
                : snapshot.session.connection === "demo"
                  ? "LOCAL REFERENCE AUDIO"
                  : "BACKEND OFFLINE"}
          </span>
          <span className="hidden text-parchment/30 sm:inline">·</span>
          <span className="hidden sm:inline">
            {Math.round(snapshot.audio.sampleRate / 1000)} kHz · MONO
          </span>
          {snapshot.session.connection === "live" &&
          snapshot.latency.inferenceLatencyMs !== null ? (
            <>
              <span className="hidden text-parchment/30 md:inline">·</span>
              <span className="hidden md:inline">
                INF {snapshot.latency.inferenceLatencyMs.toFixed(0)} ms
              </span>
            </>
          ) : null}
        </div>
      </div>

      <div aria-hidden="true" />

      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-xl space-y-2.5">
          <p className="text-[10px] uppercase tracking-[0.24em] text-slate">
            ACT 06 · ECOLOGICAL SOUND ENVIRONMENT
          </p>
          <EditorialHeading
            text="Acoustic Field"
            hoverNote="Real-time spectral stratification at 32 kHz."
            revealKey="ACT_06_HEADING"
            align="left"
            stagger={10}
            reducedMotion={reducedMotion}
            className="font-editorial text-[clamp(2.75rem,5.8vw,5.25rem)] leading-[0.94] tracking-[-0.015em] text-parchment"
          />
          <p className="text-[13px] uppercase tracking-[0.16em] text-parchment/85 sm:text-sm">
            EVERY SOUND LEAVES A TRACE.
          </p>
        </div>

        <div
          aria-live="polite"
          className="flex flex-col items-start gap-2 text-left sm:items-end sm:text-right"
        >
          {activeDetection ? (
            <div className="border-l border-parchment/25 pl-3 sm:border-l-0 sm:border-r sm:pl-0 sm:pr-3">
              <p className="text-[10px] uppercase tracking-[0.22em] text-slate">
                {activeDetection.isDemo
                  ? "REFERENCE WINDOW DETECTION"
                  : activeDetection.recordType === "sound_class"
                    ? "SOUND-CLASS WINDOW DETECTION"
                    : "ANIMAL WINDOW DETECTION"}
              </p>
              <p className="font-editorial text-lg text-parchment">
                {activeDetection.speciesCommon}
                {activeDetection.speciesScientific &&
                activeDetection.speciesScientific !== "Unknown" ? (
                  <>
                    {" "}
                    <span className="text-sm italic text-slate">
                      ({activeDetection.speciesScientific})
                    </span>
                  </>
                ) : null}
              </p>
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate tabular-nums">
                BIRDNET SCORE {activeDetection.modelScore.toFixed(2)} · 3-SECOND OBSERVATION WINDOW{" "}
                {activeDetection.startSeconds.toFixed(1)}–{activeDetection.endSeconds.toFixed(1)}s
              </p>
            </div>
          ) : null}

          {activeDisturbance ? (
            <div className="border-l border-ochre/60 pl-3 sm:border-l-0 sm:border-r sm:pl-0 sm:pr-3">
              <p className="text-[10px] uppercase tracking-[0.22em] text-ochre">
                {activeDisturbance.isDemo
                  ? "REFERENCE DISTURBANCE"
                  : "ACOUSTIC DISTURBANCE"}
              </p>
              <p className="text-[11px] uppercase tracking-[0.16em] text-parchment/80 tabular-nums">
                {activeDisturbance.kind} · {activeDisturbance.isDemo
                  ? "LOCAL REFERENCE"
                  : `MODEL SCORE ${activeDisturbance.modelScore?.toFixed(2) ?? "UNAVAILABLE"}`} ·
                {" "}OBSERVATION WINDOW {activeDisturbance.startSeconds.toFixed(1)}–
                {activeDisturbance.endSeconds.toFixed(1)}s
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export const AcousticField: React.FC<AcousticFieldProps> = ({
  className = "",
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const initialWidth = Math.max(1, container.clientWidth || window.innerWidth);
    let budget = getAcousticFieldBudget(initialWidth);

    let stage: WebGLStage | null = null;
    try {
      stage = new WebGLStage(container, budget.maxDpr);
    } catch {
      return;
    }

    stage.camera.position.set(0, 0, budget.cameraDistance);
    const layer = createAcousticFieldLayer(
      stage,
      container,
      budget,
      reducedMotionRef.current,
    );
    stage.scene.add(layer.group);

    let currentMaxDpr = budget.maxDpr;
    stage.setResizeCallback((w) => {
      const nextBudget = getAcousticFieldBudget(w);
      if (nextBudget.tier !== budget.tier) {
        budget = nextBudget;
        if (budget.maxDpr !== currentMaxDpr) {
          currentMaxDpr = budget.maxDpr;
          stage?.setMaxDpr(currentMaxDpr);
        }
        if (stage) {
          layer.applyBudget(budget, stage.renderer.getPixelRatio());
        }
      } else if (stage) {
        layer.setPixelRatio(stage.renderer.getPixelRatio());
      }
    });

    stage.setFrameCallback((dt) => {
      layer.update(dt, budget, reducedMotionRef.current, 1, 1, true);
    });

    window.__ECOSONIC_DIAGNOSTICS__ = () => {
      const diag = stage?.getDiagnostics();
      if (!diag) return null;
      return { ...diag, latency: { ...acousticStore.liveLatency } };
    };
    stage.start();

    return () => {
      window.__ECOSONIC_DIAGNOSTICS__ = undefined;
      layer.dispose();
      stage?.dispose();
    };
  }, []);

  return (
    <section
      aria-label="Scene 01: Acoustic Field"
      className={`relative h-dvh w-full overflow-hidden bg-obsidian ${className}`}
    >
      <div
        aria-hidden="true"
        className="ecosonic-atmosphere pointer-events-none absolute inset-0"
      />
      <div
        aria-hidden="true"
        className="ecosonic-grain pointer-events-none absolute inset-0 opacity-70"
      />

      <div
        ref={containerRef}
        data-testid="acoustic-field-canvas-host"
        className="absolute inset-0 touch-pan-y"
      />

      <AcousticFieldOverlay />
    </section>
  );
};
