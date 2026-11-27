import React, { useSyncExternalStore } from "react";
import HoloFlipBadge from "../../components/originkit/ui/holo-flip-badge";
import { EditorialHeading } from "../../ui/EditorialHeading";
import { acousticStore } from "../../domain/acousticStore";
import type { StoryboardAct } from "../../domain/storyboard";
import { getActOverlayOpacity } from "../../cinematic/CinematicTimeline";
import type { CinematicActId } from "./cinematicSequence";
import type { ProjectedSpatialTrace } from "../AcousticField/acousticFieldEngine";
import providedHoloBirdImg from "../../assets/canonical/caterina-peloquin-i6nAu1sp6Jc-unsplash.jpg";

export interface ActOverlayProps {
  activeAct: StoryboardAct;
  traceAnchor: ProjectedSpatialTrace;
  reducedMotion?: boolean;
  onRequestEcologyRefresh?: () => void;
}

const ADEQUACY_LABEL: Record<string, string> = {
  adequate: "ADEQUATE OBSERVATION WINDOW",
  marginal_duration: "MARGINAL DURATION · SHORT WINDOW",
  insufficient_duration: "INSUFFICIENT DURATION FOR CHECKLIST",
  location_unspecified: "LOCATION UNSPECIFIED IN SESSION",
  zero_detections: "ZERO DETECTIONS REGISTERED",
  unknown: "OBSERVATION WINDOW",
};

/**
 * Restrained scientific documentary overlays for Acts 07-10.
 * Zero SaaS cards, zero red warning boxes, explicit text/state accessibility.
 */
export const Act07To10Overlay: React.FC<ActOverlayProps> = ({
  activeAct,
  traceAnchor,
  reducedMotion = false,
  onRequestEcologyRefresh,
}) => {
  const snapshot = useSyncExternalStore(
    acousticStore.subscribe,
    acousticStore.getSnapshot,
    acousticStore.getSnapshot,
  );

  const latestDetection = snapshot.detections[0] ?? null;
  const latestBiologicalDetection =
    snapshot.detections.find((d) => d.recordType !== "sound_class") ?? null;
  const latestDisturbance = snapshot.disturbances[0] ?? null;

  if (activeAct === "SPECIES") {
    const showLeader = Boolean(
      latestBiologicalDetection && traceAnchor.active && !traceAnchor.isDisturbance,
    );
    const labelX = Math.min(72, Math.max(28, traceAnchor.xPct + 8));
    const labelY = Math.max(20, Math.min(68, traceAnchor.yPct - 8));

    return (
      <div className="pointer-events-none absolute inset-0 z-10 flex h-full flex-col justify-between px-6 pb-8 pt-36 sm:px-10 sm:pb-12 sm:pt-32 lg:px-16 lg:pt-24">
        {/* Spatial trace leader emerging directly from the 3D field locus */}
        {showLeader && latestBiologicalDetection ? (
          <div className="pointer-events-none absolute inset-0 hidden sm:block">
            <svg
              aria-hidden="true"
              className="absolute inset-0 h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <line
                x1={traceAnchor.xPct}
                y1={traceAnchor.yPct}
                x2={labelX}
                y2={labelY}
                stroke="rgba(232, 228, 220, 0.35)"
                strokeWidth="0.16"
              />
            </svg>
            <div
              className="absolute border-l border-parchment/35 pl-3"
              style={{ left: `${labelX}%`, top: `${labelY}%` }}
            >
              <p className="text-[10px] uppercase tracking-[0.22em] text-moss-light/90 text-[#86A68E]">
                {latestBiologicalDetection.isDemo
                  ? "DEMO WINDOW DETECTION"
                  : "ANIMAL WINDOW DETECTION"}
              </p>
              <p className="font-editorial text-xl text-parchment">
                {latestBiologicalDetection.speciesCommon}
              </p>
              <p className="text-xs italic text-slate">
                {latestBiologicalDetection.speciesScientific}
              </p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-parchment/75 tabular-nums">
                BIRDNET SCORE {latestBiologicalDetection.modelScore.toFixed(2)} ·{" "}
                3-SECOND OBSERVATION WINDOW {latestBiologicalDetection.startSeconds.toFixed(1)}–{latestBiologicalDetection.endSeconds.toFixed(1)}s
              </p>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate">
              THREE-SECOND MODEL WINDOWS · VISUAL PLACEMENT IS ABSTRACT
            </p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate/75">
              {snapshot.session.connection === "live"
                ? snapshot.session.status === "listening"
                  ? `LIVE AUDIO STREAMING · ${snapshot.session.siteName}`
                  : "BACKEND CONNECTED · AUDIO NOT TRANSMITTING"
                : snapshot.session.connection === "demo"
                  ? "DEMO SIGNAL · EXPLICITLY LABELED"
                  : "BACKEND OFFLINE · LIVE CLASSIFICATION UNAVAILABLE"}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-xl space-y-2.5">
            <p className="text-[10px] uppercase tracking-[0.24em] text-[#86A68E]">
              ACT 07 · LIFE WITHIN THE SOUND
            </p>
            <EditorialHeading
              text="Species"
              hoverNote="3-second avian vocal window classifications."
              revealKey="ACT_07_HEADING"
              align="left"
              stagger={10}
              reducedMotion={reducedMotion}
              className="font-editorial text-[clamp(2.4rem,5vw,4.4rem)] leading-[0.96] tracking-[-0.015em] text-parchment"
            />
            <p className="text-[12px] uppercase tracking-[0.16em] text-slate sm:text-[13px]">
              EACH RESULT COVERS A THREE-SECOND AUDIO WINDOW.
            </p>
          </div>

          <div
            aria-live="polite"
            className="flex flex-col items-start gap-2 border-l border-parchment/20 pl-4 sm:items-end sm:border-l-0 sm:border-r sm:pl-0 sm:pr-4 sm:text-right"
          >
            {latestBiologicalDetection ? (
              <>
                <p className="text-[10px] uppercase tracking-[0.22em] text-slate">
                  {latestBiologicalDetection.isDemo
                    ? "DEMO WINDOW DETECTION"
                    : "ANIMAL WINDOW DETECTION"}
                </p>
                <p className="font-editorial text-xl text-parchment">
                  {latestBiologicalDetection.speciesCommon}{" "}
                  <span className="text-sm italic text-slate">
                    ({latestBiologicalDetection.speciesScientific})
                  </span>
                </p>
                <p className="text-[11px] uppercase tracking-[0.16em] text-parchment/80 tabular-nums">
                  BIRDNET SCORE {latestBiologicalDetection.modelScore.toFixed(2)} ·{" "}
                  3-SECOND OBSERVATION WINDOW {latestBiologicalDetection.startSeconds.toFixed(1)}–{latestBiologicalDetection.endSeconds.toFixed(1)}s
                </p>
              </>
            ) : (
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate">
                LISTENING FOR AVIAN VOCAL SIGNATURES
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (activeAct === "DISTURBANCE") {
    const refBio = latestBiologicalDetection ?? latestDetection;
    let coOccurrenceText: string | null = null;
    if (refBio && refBio.recordType !== "sound_class" && latestDisturbance) {
      const deltaSec = Math.abs(
        (latestDisturbance.receivedAtMs - refBio.receivedAtMs) / 1000,
      );
      if (deltaSec <= 60) {
        const order =
          latestDisturbance.receivedAtMs >= refBio.receivedAtMs
            ? "after"
            : "before";
        coOccurrenceText = `TEMPORAL CO-OCCURRENCE · Observed ${deltaSec.toFixed(1)}s ${order} ${refBio.speciesCommon} detection. Temporal proximity only; causality is not inferred.`;
      }
    }

    return (
      <div className="pointer-events-none absolute inset-0 z-10 flex h-full flex-col justify-between px-6 pb-8 pt-36 sm:px-10 sm:pb-12 sm:pt-32 lg:px-16 lg:pt-24">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.22em] text-ochre/90">
              FOREIGN ACOUSTIC STRUCTURE · SPATIAL DEFORMATION
            </p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate/80">
              OBSERVATIONAL STATE ONLY · NO ECOLOGICAL HARM OR CAUSALITY CLAIMED
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-xl space-y-2.5">
            <p className="text-[10px] uppercase tracking-[0.24em] text-ochre">
              ACT 08 · ACOUSTIC DISTURBANCE
            </p>
            <EditorialHeading
              text="Disturbance"
              hoverNote="Non-biological acoustic energy overlapping the field."
              revealKey="ACT_08_HEADING"
              align="left"
              stagger={10}
              reducedMotion={reducedMotion}
              className="font-editorial text-[clamp(2.4rem,5vw,4.4rem)] leading-[0.96] tracking-[-0.015em] text-parchment"
            />
            <p className="text-[12px] uppercase tracking-[0.16em] text-parchment/80 sm:text-[13px]">
              HUMAN-MADE SOUND DETECTED WITHIN FIELD STRATA.
            </p>
          </div>

          <div
            aria-live="polite"
            className="max-w-sm border-l border-ochre/60 pl-4 sm:border-l-0 sm:border-r sm:pl-0 sm:pr-4 sm:text-right"
          >
            {latestDisturbance ? (
              <>
                <p className="text-[10px] uppercase tracking-[0.22em] text-ochre">
                  {latestDisturbance.isDemo
                    ? "DEMO ACOUSTIC DISTURBANCE"
                    : "OBSERVED ACOUSTIC DISTURBANCE"}
                </p>
                <p className="text-xs uppercase tracking-[0.16em] text-parchment/90 tabular-nums">
                  CLASS: {latestDisturbance.kind} · {latestDisturbance.isDemo
                    ? "DEMO SIGNAL"
                    : `MODEL SCORE ${latestDisturbance.modelScore?.toFixed(2) ?? "UNAVAILABLE"}`} ·
                  {" "}OBSERVATION WINDOW {latestDisturbance.startSeconds.toFixed(1)}–
                  {latestDisturbance.endSeconds.toFixed(1)}s
                </p>
                {coOccurrenceText ? (
                  <p className="mt-2 text-[11px] leading-relaxed text-slate">
                    {coOccurrenceText}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate">
                MONITORING FOR NON-BIOLOGICAL SOUND SIGNATURES
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (activeAct === "SILENCE") {
    return (
      <div className="pointer-events-none absolute inset-0 z-10 flex h-full flex-col justify-between px-6 pb-8 pt-36 sm:px-10 sm:pb-12 sm:pt-32 lg:px-16 lg:pt-24">
        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-[0.24em] text-slate/85">
            INSTRUMENT LISTENING · ABSENCE OF DETECTABLE ACOUSTIC ENERGY
          </p>
        </div>

        <div className="flex flex-col items-start justify-end">
          <div className="max-w-lg space-y-2">
            <p className="text-[10px] uppercase tracking-[0.24em] text-slate">
              ACT 09 · SILENCE
            </p>
            <EditorialHeading
              text="SILENCE IS ALSO AN OBSERVATION."
              hoverNote="Absence of acoustic energy reflects observational limits."
              revealKey="ACT_09_HEADING"
              align="left"
              stagger={8}
              reducedMotion={reducedMotion}
              className="font-editorial text-[clamp(2.1rem,4.4vw,3.8rem)] font-light leading-[1.04] tracking-[-0.01em] text-parchment/90"
            />
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate/80">
              NON-DETECTION IS NEVER PROOF OF BIOLOGICAL ABSENCE.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ACT 10 — ECOLOGICAL CONTEXT (Installed OriginKit HoloFlipBadge + PhotoCardGlobe)
  const rawEco = snapshot.ecologicalContext;
  const eco =
    rawEco && rawEco.coverage.observation_adequacy !== "location_unspecified"
      ? rawEco
      : null;
  const geo = snapshot.geospatialContext ?? rawEco?.geospatial_context ?? null;
  const topWithImage =
    eco?.expected_and_detected.find((s) => s.image?.image_status === "available" && s.image.url) ??
    eco?.detected_unexpected.find((s) => s.image?.image_status === "available" && s.image.url) ??
    null;
  const badgeImage =
    topWithImage?.image?.url ?? providedHoloBirdImg;
  const bioDetections = snapshot.detections.filter((d) => d.recordType !== "sound_class");
  const primaryBio = bioDetections[0] ?? null;
  const uniqueBioSpecies = new Set(
    bioDetections.map((d) => d.speciesCommon || d.speciesScientific).filter(Boolean),
  ).size;
  const peakConfPct =
    bioDetections.length > 0
      ? Math.round(Math.max(...bioDetections.map((d) => d.modelScore)) * 100)
      : null;
  const locationLabel =
    snapshot.coordinates.latitude !== null && snapshot.coordinates.longitude !== null
      ? `${snapshot.coordinates.latitude.toFixed(3)}°, ${snapshot.coordinates.longitude.toFixed(3)}°`
      : geo?.location.location_name || "Location unavailable";

  const badgeCardName = eco
    ? geo?.location.location_name || eco.context.location_name || "Site Reference"
    : snapshot.ecologicalStatus === "loading"
      ? "Analyzing Evidence"
      : snapshot.ecologicalStatus === "unavailable"
        ? "Data Unavailable"
        : "Field Summary";
  const badgeCardType = eco
    ? `${geo?.temporal_context.season || "Ecological"} · W${geo?.temporal_context.meteorological_week ?? "?"}`
    : snapshot.ecologicalStatus === "loading"
      ? "Querying Backend"
      : "Location Unavailable";
  const badgeStats = eco
    ? [
        { label: "Expected", value: Math.min(100, eco.coverage.expected_species_count) },
        { label: "Detected", value: Math.min(100, eco.coverage.detected_expected_count) },
        { label: "Coverage", value: Math.round(eco.coverage.coverage_percentage ?? 0) },
      ]
    : [
        { label: "Expected", value: 0 },
        {
          label: "Detected",
          value: Math.min(100, bioDetections.length),
        },
        { label: "Coverage", value: 0 },
      ];
  const badgeStatusLabel = eco
    ? ADEQUACY_LABEL[eco.coverage.observation_adequacy] ??
      eco.coverage.observation_adequacy.toUpperCase()
    : snapshot.ecologicalStatus === "loading"
      ? "ANALYZING ACOUSTIC EVIDENCE..."
      : snapshot.ecologicalStatus === "unavailable"
        ? "ANALYSIS DATA COULD NOT BE RETRIEVED"
        : "GEOSPATIAL SPECIES REFERENCE UNAVAILABLE";

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex h-full flex-col justify-start overflow-y-auto px-5 pb-6 pt-[42dvh] sm:px-10 sm:pb-10 lg:justify-center lg:px-16 lg:pt-20">
      <div className="pointer-events-auto ml-auto flex w-full max-w-xl flex-col items-center gap-2 lg:items-end">
        <div className="flex w-full max-w-[380px] items-center justify-between px-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#86A68E]">
            ACT 10 · {badgeStatusLabel}
          </span>
          {onRequestEcologyRefresh ? (
            <button
              type="button"
              onClick={onRequestEcologyRefresh}
              className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.18em] text-slate underline decoration-parchment/25 underline-offset-4 transition-colors hover:text-parchment"
            >
              {snapshot.ecologicalStatus === "loading" ? "QUERYING..." : "REFRESH"}
            </button>
          ) : null}
        </div>

        <div
          data-testid="act10-holo-flip-badge"
          className="relative h-[430px] w-full max-w-[380px] sm:h-[470px]"
        >
          <HoloFlipBadge
            background="transparent"
            cardColor="#EDE9E0"
            holoTint="#9CC0AC"
            cardName={badgeCardName}
            cardType={badgeCardType}
            cardNumber={
              snapshot.activeAnalysisId
                ? `ID · ${snapshot.activeAnalysisId.slice(0, 8).toUpperCase()}`
                : "NO ANALYSIS ID"
            }
            rarity={eco ? Math.min(5, Math.max(1, eco.coverage.detected_expected_count + 1)) : 1}
            stats={badgeStats}
            frontSummary={{
              eyebrow:
                snapshot.session.status === "listening"
                  ? "LIVE ECOLOGICAL SIGNAL"
                  : "ECOLOGICAL SIGNAL",
              headline: primaryBio ? primaryBio.speciesCommon : "NO AVIAN SIGNAL",
              rows: [
                {
                  label: "Detected",
                  value:
                    bioDetections.length > 0
                      ? `${bioDetections.length} (${uniqueBioSpecies} sp.)`
                      : "0 biological",
                },
                { label: "Location", value: locationLabel },
                {
                  label: "Confidence",
                  value: peakConfPct !== null ? `${peakConfPct}% peak` : "No signal",
                },
              ],
            }}
            size={84}
            back={{
              setName: geo?.ecological_context.biome_band || "BirdNET Geo V3.0",
              edition: badgeStatusLabel,
              image: badgeImage,
              imageAlt: topWithImage
                ? `${topWithImage.common_name} (${topWithImage.scientific_name})`
                : "Caterina Peloquin — woodland songbird ecological reference",
              rarityLabel: eco
                ? `${eco.coverage.expected_species_count} Expected · ${eco.coverage.gap_count} Not Detected`
                : "LOCATION DATA UNAVAILABLE",
              metrics: eco
                ? [
                    { label: "Expected", value: String(eco.coverage.expected_species_count) },
                    { label: "Observed", value: String(eco.coverage.detected_expected_count) },
                    { label: "Not Detected", value: String(eco.coverage.gap_count) },
                  ]
                : [
                    { label: "Expected", value: "—" },
                    { label: "Observed", value: String(bioDetections.length) },
                    { label: "Location", value: "Unavailable" },
                  ],
              flavour:
                eco?.interpretation?.summary ||
                eco?.coverage.adequacy_explanation ||
                snapshot.ecologicalError ||
                "Acoustic non-detection does NOT establish biological absence.",
              illustrator:
                topWithImage?.common_name ||
                "Photo · Caterina Peloquin",
            }}
            advanced={{
              lineY: 12,
              lineSag: 8,
              stringLength: 28,
              wireColor: "rgba(216, 212, 200, 0.35)",
              textColor: "#141816",
              mutedColor: "#4D5751",
              autoPlay: !reducedMotion,
              hover: 60,
            }}
            style={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0 }}
          />
        </div>
      </div>
    </div>
  );
};

const ACT_07_TO_10: readonly {
  id: CinematicActId;
  act: Extract<StoryboardAct, "SPECIES" | "DISTURBANCE" | "SILENCE" | "ECOLOGICAL CONTEXT">;
}[] = [
  { id: "ACT_07_SPECIES", act: "SPECIES" },
  { id: "ACT_08_DISTURBANCE", act: "DISTURBANCE" },
  { id: "ACT_09_SILENCE", act: "SILENCE" },
  { id: "ACT_10_ECOLOGICAL_CONTEXT", act: "ECOLOGICAL CONTEXT" },
];

function resolveOverlayMotionStyle(
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
  const rest = Math.max(0, 1 - opacity);
  const blurPx = opacity < 0.85 ? rest * 2.4 : 0;
  let transform = "translate3d(0, 0, 0)";
  switch (id) {
    case "ACT_07_SPECIES":
      transform = `translate3d(0, ${(rest * 12).toFixed(2)}px, 0)`;
      break;
    case "ACT_08_DISTURBANCE":
      transform = `translate3d(${(rest * 14).toFixed(2)}px, 0, 0)`;
      break;
    case "ACT_09_SILENCE":
      transform = `scale(${(0.992 + opacity * 0.008).toFixed(4)})`;
      break;
    case "ACT_10_ECOLOGICAL_CONTEXT": {
      const exitingIntoArchive = scrollProgress > 0.875;
      const shaped = exitingIntoArchive ? Math.pow(opacity, 1.95) : opacity;
      transform = exitingIntoArchive
        ? `translate3d(${(rest * 26).toFixed(2)}px, ${(-rest * 24).toFixed(2)}px, 0) scale(${(0.94 + opacity * 0.06).toFixed(4)})`
        : `translate3d(0, ${(rest * 16).toFixed(2)}px, 0) scale(${(0.975 + opacity * 0.025).toFixed(4)})`;
      return {
        opacity: shaped,
        visibility: shaped > 0.002 ? "visible" : "hidden",
        transform,
        filter: blurPx > 0.05 ? `blur(${blurPx.toFixed(2)}px)` : undefined,
      };
    }
  }
  return {
    opacity,
    visibility: opacity > 0.001 ? "visible" : "hidden",
    transform,
    filter: blurPx > 0.05 ? `blur(${blurPx.toFixed(2)}px)` : undefined,
  };
}

/** Keeps editorial overlays mounted through their scroll-driven crossfades. */
export const Act07To10OverlayTrack: React.FC<
  ActOverlayProps & { scrollProgress: number; reducedMotion?: boolean }
> = ({
  activeAct,
  traceAnchor,
  onRequestEcologyRefresh,
  scrollProgress,
  reducedMotion = false,
}) => (
  <>
    {ACT_07_TO_10.map(({ id, act }) => {
      const blendSpan = id === "ACT_10_ECOLOGICAL_CONTEXT" ? 0.022 : 0.018;
      const opacity = getActOverlayOpacity(id, scrollProgress, blendSpan);
      if (opacity <= 0.001) return null;
      return (
        <div
          key={id}
          aria-hidden={activeAct !== act}
          className="absolute inset-0 z-10"
          style={{
            ...resolveOverlayMotionStyle(id, opacity, scrollProgress, reducedMotion),
            pointerEvents: activeAct === act ? "auto" : "none",
          }}
        >
          <Act07To10Overlay
            activeAct={act}
            traceAnchor={traceAnchor}
            reducedMotion={reducedMotion}
            onRequestEcologyRefresh={onRequestEcologyRefresh}
          />
        </div>
      );
    })}
  </>
);
