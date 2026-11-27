import React, { useMemo, useState, useSyncExternalStore } from "react";
import { EditorialHeading } from "../../ui/EditorialHeading";
import {
  buildExplicitDemoObservationGap,
  fetchObservationGapForScene12,
} from "../../api/ecosonicEcologyApi";
import type { EcologicalGapSnapshot } from "../../domain/acousticFieldTypes";
import { acousticStore } from "../../domain/acousticStore";
import {
  ObservationGapCardStack,
  type ObservationGapFilterSelection,
} from "./ObservationGapCardStack";
import { ObservationGapFieldNote } from "./ObservationGapFieldNote";
import {
  buildObservationGapViewModel,
  filterCorrespondenceEntries,
  type ObservationCorrespondenceEntry,
} from "./observationGapState";

interface ObservationGapSceneProps {
  reducedMotion: boolean;
  onRefreshBackend?: () => void;
}

function formatDurationSeconds(sec: number | null | undefined): string {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec <= 0) {
    return "Window unmeasured";
  }
  if (sec < 120) return `${Math.round(sec)}s recording`;
  return `${(sec / 60).toFixed(1)}m recording`;
}

/**
 * Scene 12: ACT 12 · OBSERVATION GAP — Evidence Correspondence Archive.
 * Evolves Scene 11's specimen archive into Expected ↔ Observed correspondence
 * over the persistent shared EcologicalField background.
 */
export const ObservationGapScene: React.FC<ObservationGapSceneProps> = ({
  reducedMotion,
  onRefreshBackend,
}) => {
  const snapshot = useSyncExternalStore(
    acousticStore.subscribe,
    acousticStore.getSnapshot,
    acousticStore.getSnapshot,
  );

  const [explicitDemoGap, setExplicitDemoGap] =
    useState<EcologicalGapSnapshot | null>(null);
  const [activeFilter, setActiveFilter] =
    useState<ObservationGapFilterSelection>("all");
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [activeFieldNoteEntry, setActiveFieldNoteEntry] =
    useState<ObservationCorrespondenceEntry | null>(null);

  const activeGapSnapshot: EcologicalGapSnapshot | null =
    explicitDemoGap ?? snapshot.ecologicalContext;

  const viewModel = useMemo(
    () => buildObservationGapViewModel(activeGapSnapshot),
    [activeGapSnapshot],
  );

  const filteredEntries = useMemo(() => {
    if (!viewModel) return [];
    return filterCorrespondenceEntries(viewModel.entries, activeFilter);
  }, [viewModel, activeFilter]);

  const status: "loading" | "ready" | "empty" | "error" = useMemo(() => {
    if (explicitDemoGap && viewModel && viewModel.entries.length > 0) return "ready";
    if (snapshot.ecologicalStatus === "loading") return "loading";
    if (snapshot.ecologicalStatus === "unavailable" && !activeGapSnapshot) return "error";
    if (viewModel) {
      if (
        viewModel.coverage.observation_adequacy === "location_unspecified" ||
        viewModel.entries.length === 0
      ) {
        return "empty";
      }
      return "ready";
    }
    return snapshot.ecologicalStatus === "ready" ? "empty" : "loading";
  }, [
    explicitDemoGap,
    snapshot.ecologicalStatus,
    activeGapSnapshot,
    viewModel,
  ]);

  const handleRetryBackend = () => {
    setExplicitDemoGap(null);
    setSelectedIndex(0);
    setActiveFieldNoteEntry(null);
    if (onRefreshBackend) {
      onRefreshBackend();
    } else {
      void fetchObservationGapForScene12();
    }
  };

  const handleInspectExplicitDemo = () => {
    setExplicitDemoGap(buildExplicitDemoObservationGap());
    setActiveFilter("all");
    setSelectedIndex(0);
    setActiveFieldNoteEntry(null);
  };

  const handleChangeFilter = (next: ObservationGapFilterSelection) => {
    setActiveFilter(next);
    setSelectedIndex(0);
  };

  const coords = viewModel?.generalizedCoordinates;
  const hasCoords = coords?.latitude != null && coords?.longitude != null;

  return (
    <div
      id="observation-gap"
      data-scene="12"
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

      <div className="relative z-10 mx-auto flex w-full max-w-[1440px] flex-1 flex-col justify-center">
        {/* Top Archival Masthead inheriting Scene 11 refined editorial typography */}
        <div className="mx-auto mb-5 max-w-[780px] space-y-2.5 px-2 text-center sm:mb-6">
          <div className="flex flex-wrap items-center justify-center gap-2 font-technical text-[11px] tracking-[0.14em] text-[#8E9691]">
            <span className="text-[#86A68E]">ACT 12</span>
            <span aria-hidden="true" className="text-[#D8D4C8]/25">
              /
            </span>
            <span className="uppercase">Observation Gap</span>
            <span aria-hidden="true" className="text-[#D8D4C8]/25">
              ·
            </span>
            <span>Evidence Correspondence</span>
            {viewModel?.isDemo && (
              <span className="ml-1 rounded-[2px] border border-[#C89B62]/40 bg-[#C89B62]/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[#C89B62]">
                Reference Sample
              </span>
            )}
          </div>

          <EditorialHeading
            text="Where does observation differ from expectation?"
            hoverNote="Observed BirdNET detections weighed against expected biota."
            revealKey="ACT_12_HEADING"
            align="center"
            stagger={5}
            reducedMotion={reducedMotion}
            className="font-editorial text-[2.15rem] font-normal leading-[1.03] tracking-[-0.02em] text-[#EDE9E0] sm:text-[3.35rem]"
          />

          {viewModel && (
            <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 font-technical text-[12px] tracking-[0.02em] text-[#D8D4C8]/78">
              <span className="text-[#E8E4DC]/90">{viewModel.locationName}</span>
              <span aria-hidden="true" className="text-[#E8E4DC]/25">
                ·
              </span>
              <span className="capitalize">
                {viewModel.ecosystemCategory.replace(/-/g, " ")}
              </span>
              {hasCoords && (
                <>
                  <span aria-hidden="true" className="text-[#E8E4DC]/25">
                    ·
                  </span>
                  <span className="tabular-nums text-[#B8B4AC]">
                    {Math.abs(coords!.latitude!).toFixed(2)}°{" "}
                    {coords!.latitude! >= 0 ? "N" : "S"},{" "}
                    {Math.abs(coords!.longitude!).toFixed(2)}°{" "}
                    {coords!.longitude! >= 0 ? "E" : "W"}
                  </span>
                </>
              )}
              <span aria-hidden="true" className="text-[#E8E4DC]/25">
                ·
              </span>
              <span className="tabular-nums">{formatDurationSeconds(viewModel.observationDurationSec)}</span>
            </div>
          )}

          <p className="mx-auto max-w-[58ch] font-technical text-[13px] leading-[1.62] tracking-[-0.005em] text-[#A8B0AB] sm:text-[14.5px]">
            Comparing the seasonal ecological baseline against recorded BirdNET detections.
            Acoustic non-detection reflects observational limits, never biological absence.
          </p>
        </div>

        {/* STATE 1: LOADING */}
        {status === "loading" && (
          <div
            role="status"
            aria-live="polite"
            className="flex flex-col items-center justify-center space-y-5 px-4 py-8"
          >
            <div className="flex items-center justify-center gap-6">
              <div className="h-[240px] w-[180px] rounded-[2px] border border-[#E8E4DC]/12 bg-[#080909]/70 sm:h-[300px] sm:w-[230px]" />
              <div className="h-px w-16 bg-[#E8E4DC]/18 sm:w-28" />
              <div className="h-[240px] w-[180px] rounded-[2px] border border-[#E8E4DC]/12 bg-[#080909]/70 sm:h-[300px] sm:w-[230px]" />
            </div>
            <div className="font-mono text-xs uppercase tracking-[0.24em] text-[#E8E4DC]/80">
              ASSEMBLING OBSERVATION CORRESPONDENCE
            </div>
          </div>
        )}

        {/* STATE 2: API UNAVAILABLE */}
        {status === "error" && (
          <div className="mx-auto max-w-xl space-y-4 rounded-[3px] border border-[#E8E4DC]/14 bg-[#080909]/92 px-6 py-8 text-center">
            <div className="font-mono text-xs uppercase tracking-[0.24em] text-[#C89B62]">
              OBSERVATION RECORD UNAVAILABLE
            </div>
            <p className="text-xs leading-relaxed text-[#E8E4DC]/85 sm:text-sm">
              Unable to retrieve observation-gap correspondence from the backend ecological
              provider ({snapshot.ecologicalError || "service unreachable"}). No observations
              have been fabricated.
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

        {/* STATE 3: EMPTY / LOCATION UNSPECIFIED */}
        {status === "empty" && (
          <div className="mx-auto max-w-xl space-y-4 rounded-[3px] border border-[#E8E4DC]/14 bg-[#080909]/92 px-6 py-8 text-center">
            <div className="font-mono text-xs uppercase tracking-[0.24em] text-[#8F9496]">
              OBSERVATION CORRESPONDENCE INCOMPLETE
            </div>
            <p className="text-xs leading-relaxed text-[#E8E4DC]/85 sm:text-sm">
              {viewModel?.coverage.adequacy_explanation ||
                "No geocoded acoustic recording session is currently available to compare against regional baseline expectations."}
            </p>
      <div className="flex flex-wrap items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#9EA7A2]">
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

        {/* STATE 4: POPULATED ARCHIVAL STACKED SPECIMEN CAROUSEL */}
        {status === "ready" && viewModel && (
          <>
            <ObservationGapCardStack
              entries={filteredEntries}
              allEntriesCount={viewModel.entries.length}
              counts={viewModel.counts}
              activeFilter={activeFilter}
              selectedIndex={selectedIndex}
              reducedMotion={reducedMotion}
              onChangeFilter={handleChangeFilter}
              onSelectIndex={setSelectedIndex}
              onOpenFieldNote={setActiveFieldNoteEntry}
            />

            {/* Restrained Archival Ledger Summary Line & Mandatory Caveat */}
            <div className="mx-auto mt-4 flex max-w-3xl flex-col items-center gap-2 px-4 text-center">
              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-[#D8D4C8]/12 pt-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[#8B918B] tabular-nums">
                <span>
                  EXPECTED{" "}
                  <strong className="font-normal text-[#D8D4C8]">
                    {viewModel.coverage.expected_species_count}
                  </strong>
                </span>
                <span aria-hidden="true" className="text-[#D8D4C8]/20">
                  ·
                </span>
                <span>
                  DETECTED{" "}
                  <strong className="font-normal text-[#86A68E]">
                    {viewModel.coverage.detected_expected_count}
                  </strong>
                </span>
                <span aria-hidden="true" className="text-[#D8D4C8]/20">
                  ·
                </span>
                <span>
                  GAP{" "}
                  <strong className="font-normal text-[#D8D4C8]">
                    {viewModel.coverage.gap_count}
                  </strong>
                </span>
                <span aria-hidden="true" className="text-[#D8D4C8]/20">
                  ·
                </span>
                <span>
                  OUTSIDE BASELINE{" "}
                  <strong className="font-normal text-[#C89B62]">
                    {viewModel.coverage.detected_unexpected_count}
                  </strong>
                </span>
                <span aria-hidden="true" className="text-[#D8D4C8]/20">
                  ·
                </span>
                <span>
                  COVERAGE{" "}
                  <strong className="font-normal text-[#D8D4C8]">
                    {Math.round(viewModel.coverage.coverage_percentage)}%
                  </strong>
                </span>
              </div>

              <p className="font-mono text-[10px] uppercase leading-relaxed tracking-[0.15em] text-[#9EA7A2]/75">
                {viewModel.scientificDisclaimer}
              </p>
            </div>
          </>
        )}
      </div>

      <ObservationGapFieldNote
        entry={activeFieldNoteEntry}
        viewModel={viewModel}
        reducedMotion={reducedMotion}
        onCloseComplete={() => setActiveFieldNoteEntry(null)}
      />
    </div>
  );
};
