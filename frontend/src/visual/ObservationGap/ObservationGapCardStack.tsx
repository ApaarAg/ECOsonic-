import React, { useEffect, useMemo, useState } from "react";
import Carousel, { type CarouselCardItem } from "../../components/originkit/ui/carousel";
import SeleniteChips, { type Chip } from "../../components/originkit/ui/selenite-chips";
import {
  formatBaselineTier,
  formatCategoryLabel,
  type ObservationCorrespondenceEntry,
  type ObservationGapCategory,
  type ObservationGapFilter,
  type ObservationGapViewModel,
} from "./observationGapState";

const MAX_CARDS_PER_RING = 5;

export type ObservationGapFilterSelection =
  | ObservationGapFilter
  | readonly ObservationGapCategory[];

export interface ObservationGapCardStackProps {
  entries: readonly ObservationCorrespondenceEntry[];
  allEntriesCount: number;
  counts: ObservationGapViewModel["counts"];
  activeFilter: ObservationGapFilterSelection;
  selectedIndex: number;
  reducedMotion: boolean;
  onChangeFilter: (filter: ObservationGapFilterSelection) => void;
  onSelectIndex: (index: number) => void;
  onOpenFieldNote: (entry: ObservationCorrespondenceEntry) => void;
}

const SUBSET_OPTIONS: readonly { key: ObservationGapCategory; label: string }[] = [
  { key: "expected_but_not_detected", label: "Gap" },
  { key: "expected_and_detected", label: "Detected" },
  { key: "detected_unexpected", label: "Outside" },
];

function formatPercent(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return `${Math.round(value * 100)}%`;
}

function mapEntryStatus(entry: ObservationCorrespondenceEntry): {
  statusText: "DETECTED" | "NOT DETECTED";
  statusVariant: "detected" | "not_detected" | "unexpected_detected";
  statusMeta: string;
} {
  const confText = formatPercent(entry.maxConfidence);
  const scoreText = formatPercent(entry.occurrenceScore);

  if (entry.category === "expected_and_detected") {
    const parts: string[] = [];
    if (entry.detectionCount !== null) {
      parts.push(
        `${entry.detectionCount} ${entry.detectionCount === 1 ? "detection" : "detections"}`
      );
    }
    if (confText) parts.push(`${confText} confidence`);
    if (scoreText) parts.push(`${scoreText} baseline`);
    return {
      statusText: "DETECTED",
      statusVariant: "detected",
      statusMeta: parts.join(" · ") || "Confirmed in acoustic recording",
    };
  }

  if (entry.category === "detected_unexpected") {
    const parts: string[] = [];
    if (entry.detectionCount !== null) {
      parts.push(
        `${entry.detectionCount} ${entry.detectionCount === 1 ? "detection" : "detections"}`
      );
    }
    if (confText) parts.push(`${confText} confidence`);
    parts.push("Unlisted in geographic checklist");
    return {
      statusText: "DETECTED",
      statusVariant: "unexpected_detected",
      statusMeta: parts.join(" · "),
    };
  }

  const tier = formatBaselineTier(entry.occurrenceStatus);
  const gapParts: string[] = [scoreText ? `${tier} (${scoreText})` : tier];
  gapParts.push("Not detected in acoustic window");
  return {
    statusText: "NOT DETECTED",
    statusVariant: "not_detected",
    statusMeta: gapParts.join(" · "),
  };
}

function toCarouselItem(entry: ObservationCorrespondenceEntry): CarouselCardItem {
  const status = mapEntryStatus(entry);
  return {
    id: entry.id,
    image: entry.asset.imageUrl,
    focalPosition: entry.asset.focalPosition,
    alt: `${entry.commonName} (${entry.scientificName}) archival avian specimen`,
    plateLabel: `PLATE ${entry.indexLabel}`,
    commonName: entry.commonName,
    scientificName: entry.scientificName,
    statusText: status.statusText,
    statusVariant: status.statusVariant,
    statusMeta: status.statusMeta,
    isHabitatFallback: entry.asset.plateKind === "habitat_context_fallback",
  };
}

export const ObservationGapCardStack: React.FC<ObservationGapCardStackProps> = ({
  entries,
  allEntriesCount,
  counts,
  activeFilter,
  selectedIndex,
  reducedMotion,
  onChangeFilter,
  onSelectIndex,
  onOpenFieldNote,
}) => {
  const totalFiltered = entries.length;
  const safeSelected =
    totalFiltered > 0 ? Math.min(Math.max(selectedIndex, 0), totalFiltered - 1) : 0;

  const totalBatches = Math.max(1, Math.ceil(totalFiltered / MAX_CARDS_PER_RING));
  const currentBatchIndex = Math.floor(safeSelected / MAX_CARDS_PER_RING);
  const batchStart = currentBatchIndex * MAX_CARDS_PER_RING;

  const visibleEntries = useMemo(
    () => entries.slice(batchStart, batchStart + MAX_CARDS_PER_RING),
    [entries, batchStart]
  );

  const carouselItems = useMemo(
    () => visibleEntries.map(toCarouselItem),
    [visibleEntries]
  );

  const localSelected = Math.min(
    Math.max(safeSelected - batchStart, 0),
    Math.max(0, visibleEntries.length - 1)
  );
  const activeEntry = visibleEntries[localSelected] ?? entries[safeSelected] ?? null;

  const [ringAnchor, setRingAnchor] = useState<{ start: number; nonce: number }>({
    start: localSelected + 1,
    nonce: 0,
  });

  const filterKey = useMemo(() => {
    if (Array.isArray(activeFilter)) {
      return activeFilter.length === 0 ? "all" : [...activeFilter].sort().join(",");
    }
    return activeFilter;
  }, [activeFilter]);

  useEffect(() => {
    setRingAnchor((prev) => ({
      start: 1,
      nonce: prev.nonce + 1,
    }));
  }, [filterKey, currentBatchIndex]);

  const handleCarouselChange = (indexInBatch: number) => {
    const globalIndex = batchStart + indexInBatch;
    if (globalIndex >= 0 && globalIndex < totalFiltered) {
      onSelectIndex(globalIndex);
    }
  };

  const handleInspectAtIndex = (indexInBatch: number) => {
    const target = visibleEntries[indexInBatch];
    if (target) {
      onOpenFieldNote(target);
    }
  };

  const handleJumpGlobal = (targetIndex: number) => {
    if (totalFiltered <= 0) return;
    const wrapped = ((targetIndex % totalFiltered) + totalFiltered) % totalFiltered;
    setRingAnchor((prev) => ({
      start: (wrapped % MAX_CARDS_PER_RING) + 1,
      nonce: prev.nonce + 1,
    }));
    onSelectIndex(wrapped);
  };

  const filterCountFor = (key: ObservationGapFilter): number => {
    switch (key) {
      case "all":
        return counts.all;
      case "expected_and_detected":
        return counts.expectedAndDetected;
      case "expected_but_not_detected":
        return counts.expectedButNotDetected;
      case "detected_unexpected":
        return counts.detectedUnexpected;
    }
  };

  const selectedCategorySet = useMemo(() => {
    if (Array.isArray(activeFilter)) {
      return new Set<ObservationGapCategory>(activeFilter);
    }
    if (activeFilter === "all") {
      return new Set<ObservationGapCategory>();
    }
    return new Set<ObservationGapCategory>([activeFilter as ObservationGapCategory]);
  }, [activeFilter]);

  const isAllPicked = selectedCategorySet.size === 0;

  const chipDescriptors = useMemo(
    () => [
      {
        key: "all" as const,
        label: `All · ${filterCountFor("all")}`,
        picked: isAllPicked,
      },
      ...SUBSET_OPTIONS.map((opt) => ({
        key: opt.key,
        label: `${opt.label} · ${filterCountFor(opt.key)}`,
        picked: !isAllPicked && selectedCategorySet.has(opt.key),
      })),
    ],
    [counts, isAllPicked, selectedCategorySet],
  );

  const seleniteItems: Chip[] = useMemo(
    () => chipDescriptors.map((d) => ({ label: d.label, picked: d.picked })),
    [chipDescriptors],
  );

  const handleChipsChange = (pickedLabels: string[]) => {
    const allLabel = chipDescriptors[0].label;
    const pickedSet = new Set(pickedLabels);
    const nextCategories = chipDescriptors
      .slice(1)
      .filter((d) => pickedSet.has(d.label))
      .map((d) => d.key as ObservationGapCategory);

    if (pickedSet.has(allLabel)) {
      // Switching from All -> a specific subset chip
      if (isAllPicked && nextCategories.length > 0) {
        onChangeFilter(nextCategories.length === 1 ? nextCategories[0] : nextCategories);
        return;
      }
      // Explicitly re-picking All clears subset filters
      onChangeFilter("all");
      return;
    }

    if (nextCategories.length === 0 || nextCategories.length === SUBSET_OPTIONS.length) {
      onChangeFilter("all");
      return;
    }

    onChangeFilter(nextCategories.length === 1 ? nextCategories[0] : nextCategories);
  };

  return (
    <div
      className="relative flex flex-col gap-2.5 sm:gap-3.5"
      data-testid="observation-gap-card-stack"
    >
      {/* Installed OriginKit SeleniteChips Correspondence Selector */}
      <div
        className="mx-auto flex w-full max-w-[820px] flex-col items-center gap-1.5"
        data-testid="observation-gap-selenite-chips"
        data-active-filter={filterKey}
      >
        <div className="h-[52px] w-full sm:h-[60px]">
          <SeleniteChips
            items={seleniteItems}
            background="transparent"
            cover="glass"
            chipColor="#0C0F0E"
            borderColor="rgba(216, 212, 200, 0.16)"
            dotColor="rgba(216, 212, 200, 0.14)"
            glassColor="rgba(134, 166, 142, 0.24)"
            solidColor="#1F2D24"
            textColor="#9AA29D"
            activeTextColor="#EDE9E0"
            radius={5}
            scale={195}
            font={{
              fontFamily: '"Inter Tight", "Inter", system-ui, sans-serif',
              fontWeight: 500,
              letterSpacing: "0.02em",
            }}
            advanced={{
              height: 22,
              padding: 9.5,
              checkLeft: 6.2,
              checkGap: 4.5,
              gap: 6.5,
              textSize: 9.2,
              dotPitch: 2.1,
              dotSize: 0.32,
              sheen: 26,
              rim: 60,
            }}
            onChange={handleChipsChange}
            style={{ width: "100%", height: "100%" }}
          />
        </div>

        {totalFiltered > 0 && (
          <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.2em] text-[#D8D4C8]/55 sm:text-[10px]">
            <span>
              Plate {String(safeSelected + 1).padStart(2, "0")} /{" "}
              {String(totalFiltered).padStart(2, "0")}
            </span>
            {totalFiltered !== allEntriesCount && (
              <span className="hidden text-[#D8D4C8]/38 sm:inline">
                ({allEntriesCount} total)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Empty Filter Category Fallback */}
      {totalFiltered === 0 ? (
        <div
          className="mx-auto flex w-full max-w-2xl flex-col items-center justify-center rounded-[2px] border border-[#D8D4C8]/15 bg-[#050606]/75 px-6 py-12 text-center"
          data-testid="gap-filter-empty"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#C89B62]/85">
            Filtered Subset Empty
          </p>
          <p className="mt-2 font-serif text-lg text-[#D8D4C8]">
            No species plates match this category in the current acoustic window.
          </p>
          <button
            type="button"
            onClick={() => onChangeFilter("all")}
            className="mt-5 rounded-[2px] border border-[#D8D4C8]/30 bg-[#080909] px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[#D8D4C8] transition-colors hover:border-[#6E8272]/60"
          >
            Show All {allEntriesCount} Plates
          </button>
        </div>
      ) : (
        <>
          {/* Single Primary Observation-Gap Stacked Card Turntable */}
          <div
            className="relative mx-auto h-[296px] w-full max-w-[840px] overflow-x-clip sm:h-[348px] lg:h-[380px]"
            data-testid="gap-stacked-carousel-stage"
          >
            <Carousel
              items={carouselItems}
              start={ringAnchor.start}
              jumpNonce={ringAnchor.nonce}
              cardWidth={206}
              cardHeight={290}
              gap={24}
              depth={50}
              corner={3}
              sink={12}
              motion={{
                float: reducedMotion ? 0 : 18,
                spin: 0,
                settle: reducedMotion ? 100 : 48,
              }}
              background="transparent"
              sound={false}
              soundVolume={0}
              reducedMotion={reducedMotion}
              onChange={handleCarouselChange}
              onInspect={handleInspectAtIndex}
            />
          </div>

          {/* Frameless Archival Specimen Caption & Navigation Strip */}
          {activeEntry && (
            <div className="mx-auto flex w-full max-w-[820px] flex-col gap-2.5 border-t border-[#D8D4C8]/12 pt-3 px-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#D8D4C8]/50">
                    PLATE {activeEntry.indexLabel}
                  </span>
                  <span className="text-[#D8D4C8]/25">·</span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#D8D4C8]/65">
                    {formatCategoryLabel(activeEntry.category)}
                  </span>
                </div>
                <p className="mt-0.5 truncate font-serif text-base text-[#D8D4C8]">
                  {activeEntry.commonName}{" "}
                  <span className="text-xs italic text-[#D8D4C8]/55">
                    ({activeEntry.scientificName})
                  </span>
                </p>
                <p className="mt-0.5 font-mono text-[9px] tracking-[0.06em] text-[#D8D4C8]/48">
                  Hover, focus, or tap front card to reveal detection status ·{" "}
                  {activeEntry.asset.imageStatus === "available"
                    ? `${activeEntry.asset.sourceLabel || activeEntry.asset.artist} (${activeEntry.asset.license})`
                    : "Species image unavailable"}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="gap-prev-plate"
                  onClick={() => handleJumpGlobal(safeSelected - 1)}
                  className="rounded-[2px] border border-[#D8D4C8]/20 bg-[#080909]/80 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[#D8D4C8]/80 transition-colors hover:border-[#D8D4C8]/45 hover:text-[#D8D4C8]"
                  aria-label="Previous plate"
                >
                  ← Prev
                </button>
                <button
                  type="button"
                  data-testid="gap-next-plate"
                  onClick={() => handleJumpGlobal(safeSelected + 1)}
                  className="rounded-[2px] border border-[#D8D4C8]/20 bg-[#080909]/80 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[#D8D4C8]/80 transition-colors hover:border-[#D8D4C8]/45 hover:text-[#D8D4C8]"
                  aria-label="Next plate"
                >
                  Next →
                </button>
                {totalBatches > 1 && (
                  <button
                    type="button"
                    data-testid="gap-next-batch"
                    onClick={() =>
                      handleJumpGlobal(
                        ((currentBatchIndex + 1) % totalBatches) * MAX_CARDS_PER_RING
                      )
                    }
                    className="rounded-[2px] border border-[#D8D4C8]/16 bg-[#050606]/80 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-[#D8D4C8]/65 transition-colors hover:border-[#D8D4C8]/38 hover:text-[#D8D4C8]"
                  >
                    Set {currentBatchIndex + 1}/{totalBatches}
                  </button>
                )}
                <button
                  type="button"
                  data-testid="gap-open-field-note"
                  onClick={() => onOpenFieldNote(activeEntry)}
                  className="rounded-[2px] border border-[#6E8272]/45 bg-[#6E8272]/12 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[#C5D8C8] transition-colors hover:border-[#6E8272]/80 hover:bg-[#6E8272]/20"
                >
                  Inspect Note
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
