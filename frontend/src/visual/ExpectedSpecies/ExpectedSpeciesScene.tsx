import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { EditorialHeading } from "../../ui/EditorialHeading";
import {
  buildExplicitDemoBaseline,
  fetchExpectedSpeciesForScene11,
} from "../../api/ecosonicEcologyApi";
import { acousticStore } from "../../domain/acousticStore";
import type { ExpectedSpeciesBaseline } from "../../domain/acousticFieldTypes";
import { ExpectedSpeciesArchive } from "./ExpectedSpeciesArchive";
import { buildSpecimenArchive } from "./expectedSpeciesState";
import { SpeciesFieldNote } from "./SpeciesFieldNote";

function formatAdequacyTag(adequacy: string | null | undefined): string | null {
  switch (adequacy) {
    case "adequate":
      return "OBSERVATION: ADEQUATE";
    case "marginal_duration":
      return "OBSERVATION: MARGINAL";
    case "insufficient_duration":
      return "OBSERVATION: BRIEF (<120S)";
    case "zero_detections":
      return "OBSERVATION: SILENT WINDOW";
    case "location_unspecified":
      return "LOCATION: UNSPECIFIED";
    default:
      return null;
  }
}

interface ExpectedSpeciesSceneProps {
  reducedMotion: boolean;
  onRefreshBackend?: () => void;
}

/**
 * Scene 11: ACT 11 · EXPECTED SPECIES — Ecological Field Archive.
 * Mounted inside CinematicStage on the unified scroll timeline immediately after Act 10.
 * Never fabricates ecological checklists offline; renders explicit states for loading,
 * ready, insufficient-observation/empty, and backend error.
 */
export const ExpectedSpeciesScene: React.FC<ExpectedSpeciesSceneProps> = ({
  reducedMotion,
  onRefreshBackend,
}) => {
  const snapshot = useSyncExternalStore(
    acousticStore.subscribe,
    acousticStore.getSnapshot,
    acousticStore.getSnapshot,
  );

  const [explicitDemoBaseline, setExplicitDemoBaseline] =
    useState<ExpectedSpeciesBaseline | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [fieldNoteOpen, setFieldNoteOpen] = useState<boolean>(false);
  const [originRect, setOriginRect] = useState<DOMRect | null>(null);
  const selectedButtonRef = useRef<HTMLButtonElement | null>(null);

  const activeBaseline: ExpectedSpeciesBaseline | null =
    explicitDemoBaseline ?? snapshot.expectedBaseline;

  const specimens = useMemo(() => {
    if (!activeBaseline) return [];
    return buildSpecimenArchive(activeBaseline);
  }, [activeBaseline]);

  useEffect(() => {
    setSelectedIndex(0);
    setFieldNoteOpen(false);
  }, [activeBaseline?.sessionId, activeBaseline?.siteId, activeBaseline?.isDemo]);

  const status: "loading" | "ready" | "empty" | "error" = useMemo(() => {
    if (explicitDemoBaseline && specimens.length > 0) return "ready";
    if (snapshot.ecologicalStatus === "loading") return "loading";
    if (snapshot.ecologicalStatus === "unavailable" && !activeBaseline) return "error";
    if (activeBaseline) {
      return specimens.length > 0 ? "ready" : "empty";
    }
    return "loading";
  }, [explicitDemoBaseline, snapshot.ecologicalStatus, activeBaseline, specimens.length]);

  const selectedSpecimen = specimens[selectedIndex] ?? specimens[0] ?? null;

  const registerSelectedButtonRef = useCallback((el: HTMLButtonElement | null) => {
    selectedButtonRef.current = el;
  }, []);

  const getLiveSpecimenRect = useCallback(() => {
    return selectedButtonRef.current?.getBoundingClientRect() ?? null;
  }, []);

  const handleOpenFieldNote = useCallback((index: number, rect: DOMRect | null) => {
    setSelectedIndex(index);
    setOriginRect(rect);
    setFieldNoteOpen(true);
  }, []);

  const handleCloseComplete = useCallback(() => {
    setFieldNoteOpen(false);
    window.requestAnimationFrame(() => {
      selectedButtonRef.current?.focus();
    });
  }, []);

  const handleRetryBackend = () => {
    setExplicitDemoBaseline(null);
    if (onRefreshBackend) {
      onRefreshBackend();
    } else {
      void fetchExpectedSpeciesForScene11();
    }
  };

  const handleInspectExplicitDemo = () => {
    setExplicitDemoBaseline(buildExplicitDemoBaseline());
    setSelectedIndex(0);
    setFieldNoteOpen(false);
  };

  const adequacyTag = formatAdequacyTag(activeBaseline?.context.observationAdequacy);
  const isShowingDemo = Boolean(activeBaseline?.isDemo);
  const coords = activeBaseline?.context.generalizedCoordinates;
  const hasCoords = coords?.latitude != null && coords?.longitude != null;

  return (
    <div
      id="expected-species"
      data-scene="11"
      className="pointer-events-auto relative flex h-full w-full flex-col justify-between overflow-y-auto bg-transparent px-3 pb-6 pt-28 text-[#E8E4DC] sm:px-6 sm:pb-8 lg:pt-20"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 75% 55% at 50% 48%, rgba(6, 8, 7, 0.06) 0%, rgba(5, 6, 6, 0.22) 65%, rgba(3, 4, 4, 0.48) 100%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: "radial-gradient(rgba(232,228,220,0.85) 0.6px, transparent 0)",
          backgroundSize: "16px 16px",
        }}
      />

      <div className="relative z-10 mx-auto flex w-full max-w-[1440px] flex-1 flex-col justify-center">
        {/* Top Editorial Masthead inheriting Act 10 Ecological Context */}
        <div className="mx-auto mb-5 max-w-[780px] space-y-2.5 px-2 text-center sm:mb-7">
          <div className="flex flex-wrap items-center justify-center gap-2 font-technical text-[11px] tracking-[0.14em] text-[#8E9691]">
            <span className="text-[#86A68E]">ACT 11</span>
            <span aria-hidden="true" className="text-[#D8D4C8]/25">/</span>
            <span className="uppercase">Expected Species</span>
            <span aria-hidden="true" className="text-[#D8D4C8]/25">·</span>
            <span>Ecological Field Archive</span>
            {isShowingDemo && (
              <span className="ml-1 rounded-[2px] border border-[#C89B62]/40 bg-[#C89B62]/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[#C89B62]">
                Reference Sample
              </span>
            )}
            {adequacyTag && (
              <span className="rounded-[2px] border border-[#D8D4C8]/16 bg-[#080909] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[#D8D4C8]/80">
                {adequacyTag}
              </span>
            )}
          </div>

          <EditorialHeading
            text="What species belong to this context?"
            hoverNote="Regional seasonal avian baseline derived from habitat priors."
            revealKey="ACT_11_HEADING"
            align="center"
            stagger={5}
            reducedMotion={reducedMotion}
            className="font-editorial text-[2.15rem] font-normal leading-[1.03] tracking-[-0.02em] text-[#EDE9E0] sm:text-[3.35rem]"
          />

          {activeBaseline && (
            <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 font-technical text-[12px] tracking-[0.02em] text-[#D8D4C8]/78">
              <span className="text-[#E8E4DC]/90">{activeBaseline.context.locationName}</span>
              <span aria-hidden="true" className="text-[#E8E4DC]/25">·</span>
              <span className="capitalize">
                {activeBaseline.context.ecosystemCategory.replace(/-/g, " ")}
              </span>
              {hasCoords && (
                <>
                  <span aria-hidden="true" className="text-[#E8E4DC]/25">·</span>
                  <span className="tabular-nums text-[#B8B4AC]">
                    {Math.abs(coords!.latitude!).toFixed(2)}° {coords!.latitude! >= 0 ? "N" : "S"},{" "}
                    {Math.abs(coords!.longitude!).toFixed(2)}° {coords!.longitude! >= 0 ? "E" : "W"}
                  </span>
                </>
              )}
              {activeBaseline.context.meteorologicalWeek != null && (
                <>
                  <span aria-hidden="true" className="text-[#E8E4DC]/25">·</span>
                  <span className="tabular-nums">Week {activeBaseline.context.meteorologicalWeek} / 48</span>
                </>
              )}
            </div>
          )}

          <p className="mx-auto max-w-[58ch] font-technical text-[13px] leading-[1.62] tracking-[-0.005em] text-[#A8B0AB] sm:text-[14.5px]">
            Given the geographic location and seasonal window, these are the species modeled as
            reasonably expected in this habitat. Acoustic non-detection does not establish absence.
          </p>
        </div>

        {/* STATE 1: ARCHIVAL PREPARATION (LOADING) */}
        {status === "loading" && (
          <div
            role="status"
            aria-live="polite"
            className="flex flex-col items-center justify-center space-y-6 px-4 py-8"
          >
            <div className="flex h-[260px] items-center justify-center gap-2 sm:h-[310px] sm:gap-3">
              {[0.55, 0.72, 0.85, 1, 0.85, 0.72, 0.55].map((scale, i) => (
                <div
                  key={i}
                  aria-hidden="true"
                  className="rounded-[3px] border border-[#E8E4DC]/12 bg-[#080909]"
                  style={{
                    width: i === 3 ? "180px" : "42px",
                    height: `${Math.round(290 * scale)}px`,
                    opacity: scale * 0.65,
                  }}
                />
              ))}
            </div>
            <div className="font-mono text-xs uppercase tracking-[0.26em] text-[#E8E4DC]/80">
              ASSEMBLING ECOLOGICAL BASELINE
            </div>
          </div>
        )}

        {/* STATE 2: EXPLICIT ERROR / UNAVAILABLE */}
        {status === "error" && (
          <div className="mx-auto max-w-xl space-y-4 rounded-[3px] border border-[#E8E4DC]/14 bg-[#080909]/95 px-6 py-8 text-center">
            <div className="font-mono text-xs uppercase tracking-[0.24em] text-[#C89B62]">
              ECOLOGICAL BASELINE UNAVAILABLE
            </div>
            <p className="text-xs leading-relaxed text-[#E8E4DC]/85 sm:text-sm">
              Unable to retrieve regional species expectations from the backend ecological knowledge
              provider ({snapshot.ecologicalError || "service unreachable or unconfigured"}). No species have been fabricated.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleRetryBackend}
                className="inline-flex cursor-pointer items-center gap-2 border border-[#E8E4DC]/30 px-4 py-2 font-mono text-xs uppercase tracking-[0.16em] text-[#E8E4DC] transition-colors hover:border-[#E8E4DC]"
              >
                <span>Retry Backend</span>
              </button>
              <button
                type="button"
                onClick={handleInspectExplicitDemo}
                className="inline-flex cursor-pointer items-center gap-2 border border-[#D3A36C]/45 bg-[#D3A36C]/10 px-4 py-2 font-mono text-xs uppercase tracking-[0.16em] text-[#D3A36C] transition-colors hover:bg-[#D3A36C]/20"
              >
                <span>Load Demo Observation</span>
              </button>
            </div>
          </div>
        )}

        {/* STATE 3: EXPLICIT INSUFFICIENT OBSERVATION / EMPTY */}
        {status === "empty" && (
          <div className="mx-auto max-w-xl space-y-4 rounded-[3px] border border-[#E8E4DC]/14 bg-[#080909]/95 px-6 py-8 text-center">
            <div className="font-mono text-xs uppercase tracking-[0.24em] text-[#8F9496]">
              NO EXPECTED SPECIES AVAILABLE
            </div>
            <p className="text-xs leading-relaxed text-[#E8E4DC]/85 sm:text-sm">
              {activeBaseline?.emptyReason ||
                "No regional expected species could be resolved for the current observation context."}
            </p>
            <p className="font-mono text-[11px] text-[#9EA7A2]/80">
              Expected species are computed strictly from site coordinates and meteorological week.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleRetryBackend}
                className="inline-flex cursor-pointer items-center gap-2 border border-[#E8E4DC]/30 px-4 py-2 font-mono text-xs uppercase tracking-[0.16em] text-[#E8E4DC] transition-colors hover:border-[#E8E4DC]"
              >
                <span>Refresh Backend</span>
              </button>
              <button
                type="button"
                onClick={handleInspectExplicitDemo}
                className="inline-flex cursor-pointer items-center gap-2 border border-[#D3A36C]/45 bg-[#D3A36C]/10 px-4 py-2 font-mono text-xs uppercase tracking-[0.16em] text-[#D3A36C] transition-colors hover:bg-[#D3A36C]/20"
              >
                <span>Load Demo Observation</span>
              </button>
            </div>
          </div>
        )}

        {/* STATE 4: POPULATED 3D ARCHIVE SHELF */}
        {status === "ready" && specimens.length > 0 && (
          <ExpectedSpeciesArchive
            specimens={specimens}
            selectedIndex={selectedIndex}
            isFieldNoteOpen={fieldNoteOpen}
            reducedMotion={reducedMotion}
            onSelectIndex={setSelectedIndex}
            onOpenFieldNote={handleOpenFieldNote}
            registerSelectedButtonRef={registerSelectedButtonRef}
          />
        )}

        {status === "ready" && (
          <div className="mx-auto mt-4 max-w-2xl px-4 text-center">
            <p className="font-mono text-[10px] uppercase leading-relaxed tracking-[0.16em] text-[#9EA7A2]/75">
              {activeBaseline?.disclaimer}
            </p>
          </div>
        )}
      </div>

      <SpeciesFieldNote
        specimen={fieldNoteOpen ? selectedSpecimen : null}
        originRect={originRect}
        isDemo={isShowingDemo}
        disclaimer={
          activeBaseline?.disclaimer ||
          "Expected species reflects the available ecological context and does not imply presence or absence at the observation site."
        }
        reducedMotion={reducedMotion}
        getLiveSpecimenRect={getLiveSpecimenRect}
        onCloseComplete={handleCloseComplete}
      />
    </div>
  );
};
