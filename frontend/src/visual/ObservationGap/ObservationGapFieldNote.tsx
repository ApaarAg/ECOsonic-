import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  formatBaselineTier,
  formatCategoryLabel,
  type ObservationCorrespondenceEntry,
  type ObservationGapViewModel,
} from "./observationGapState";
import { buildSpecimenPlateGeometry } from "../ExpectedSpecies/specimenPlateGeometry";

interface ObservationGapFieldNoteProps {
  entry: ObservationCorrespondenceEntry | null;
  viewModel: ObservationGapViewModel | null;
  reducedMotion: boolean;
  onCloseComplete: () => void;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
const FALLBACK_HABITAT_IMG = "/assets/canonical/rainforest_branch_overcast.jpg";

export function ObservationGapFieldNote({
  entry,
  viewModel,
  reducedMotion,
  onCloseComplete,
}: ObservationGapFieldNoteProps) {
  const titleId = useId();
  const rawUid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const plateClipId = `eco-gap-note-clip-${rawUid}`;
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [imgSrc, setImgSrc] = useState(entry?.asset.imageUrl || FALLBACK_HABITAT_IMG);

  useEffect(() => {
    if (entry) {
      setImgSrc(entry.asset.imageUrl);
    }
  }, [entry]);

  const plateGeom = useMemo(
    () => buildSpecimenPlateGeometry("active", 320, 360, true),
    [],
  );

  const handleClose = useCallback(() => {
    onCloseComplete();
  }, [onCloseComplete]);

  useEffect(() => {
    if (!entry) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
        return;
      }

      if (e.key === "Tab" && sheetRef.current) {
        const focusables = Array.from(
          sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [entry, handleClose]);

  if (!entry || !viewModel || typeof document === "undefined") {
    return null;
  }

  const coords = viewModel.generalizedCoordinates;
  const hasCoords = coords?.latitude != null && coords?.longitude != null;
  const isGap = entry.category === "expected_but_not_detected";
  const isUnexpected = entry.category === "detected_unexpected";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6"
    >
      <div
        onClick={handleClose}
        aria-hidden="true"
        className="fixed inset-0 bg-[#050606]/90 backdrop-blur-[8px]"
      />

      <div
        ref={sheetRef}
        className="relative z-10 flex max-h-[92vh] w-full max-w-[1040px] flex-col overflow-hidden rounded-[2px] border border-[#D8D4C8]/18 bg-[#080909] text-[#D8D4C8] shadow-[0_40px_110px_rgba(0,0,0,0.95)]"
        style={{
          transition: reducedMotion ? "none" : "opacity 240ms ease-out",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "radial-gradient(rgba(232,228,220,0.85) 0.7px, transparent 0)",
            backgroundSize: "14px 14px",
          }}
        />

        {/* Top Field-Record Header */}
        <div className="relative z-10 flex items-center justify-between border-b border-[#D8D4C8]/12 px-4 py-3 sm:px-7 sm:py-4">
          <div className="flex flex-wrap items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[#8B918B] sm:text-[11px]">
            <span className="text-[#D8D4C8]">RECORD · {entry.indexLabel}</span>
            <span aria-hidden="true" className="text-[#D8D4C8]/25">
              ·
            </span>
            <span>OBSERVATION GAP EVIDENCE</span>
            <span
              className={`rounded-[2px] border px-2 py-0.5 ${
                isGap
                  ? "border-[#D8D4C8]/20 bg-[#0D100F] text-[#9EA7A2]"
                  : isUnexpected
                    ? "border-[#C89B62]/45 bg-[#C89B62]/10 text-[#C89B62]"
                    : "border-[#6E8272]/45 bg-[#6E8272]/12 text-[#86A68E]"
              }`}
            >
              {formatCategoryLabel(entry.category)}
            </span>
            {viewModel.isDemo && (
              <span className="rounded-[2px] border border-[#C89B62]/40 bg-[#C89B62]/10 px-2 py-0.5 text-[#C89B62]">
                DEMO OBSERVATION
              </span>
            )}
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={handleClose}
            aria-label="Return to Observation Archive"
            className="inline-flex cursor-pointer items-center gap-2 rounded-[2px] border border-[#D8D4C8]/20 bg-[#050606] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[#D8D4C8] transition-colors hover:border-[#C89B62]/60 hover:text-[#C89B62] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C89B62]"
          >
            <span>Return to Archive</span>
            <span aria-hidden="true">×</span>
          </button>
        </div>

        {/* Body */}
        <div className="relative z-10 grid flex-1 grid-cols-1 overflow-y-auto md:grid-cols-12">
          {/* Left Specimen Plate Aperture */}
          <div className="flex flex-col justify-between border-b border-[#D8D4C8]/12 bg-[#050606] p-4 sm:p-6 md:col-span-5 md:border-b-0 md:border-r">
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute h-0 w-0 overflow-hidden"
            >
              <defs>
                <clipPath id={plateClipId} clipPathUnits="objectBoundingBox">
                  <path d={plateGeom.normalizedClipPath} />
                </clipPath>
              </defs>
            </svg>

            <div
              style={{
                clipPath: `url(#${plateClipId})`,
                WebkitClipPath: `url(#${plateClipId})`,
              }}
              className="relative aspect-[4/4.4] w-full overflow-hidden bg-[#080909]"
            >
              <img
                src={imgSrc}
                alt={`${entry.commonName} (${entry.scientificName}) documentary plate`}
                onError={() => {
                  if (imgSrc !== FALLBACK_HABITAT_IMG) setImgSrc(FALLBACK_HABITAT_IMG);
                }}
                style={{ objectPosition: entry.asset.focalPosition }}
                className={`h-full w-full object-cover ${
                  isGap ? "opacity-55 saturate-[0.55] brightness-[0.8]" : "contrast-[1.03] saturate-[0.94]"
                }`}
              />
              {isGap && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#050606]/45">
                  <span className="border border-[#D8D4C8]/25 bg-[#050606]/85 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[#D8D4C8]/85">
                    NOT DETECTED IN WINDOW
                  </span>
                </div>
              )}
              <svg
                aria-hidden="true"
                viewBox={`0 0 ${plateGeom.width} ${plateGeom.height}`}
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 h-full w-full"
              >
                <path
                  d={plateGeom.strokePath}
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                  stroke="rgba(216, 212, 200, 0.28)"
                  strokeWidth={1.1}
                />
              </svg>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-[#D8D4C8]/10 pt-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[#8B918B]">
              <span>
                {entry.asset.imageStatus === "available"
                  ? `${entry.asset.artist} · ${entry.asset.license}`
                  : "Species image unavailable · Habitat context fallback"}
              </span>
              <span>ARCHIVE EVIDENCE</span>
            </div>
          </div>

          {/* Right Field Correspondence Record */}
          <div className="flex flex-col justify-between space-y-5 p-5 sm:p-7 md:col-span-7">
            <div className="space-y-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#6E8272]">
                  {formatCategoryLabel(entry.category)}
                </p>
                <h2
                  id={titleId}
                  className="mt-1 font-editorial text-3xl font-normal leading-tight text-[#D8D4C8] sm:text-4xl"
                >
                  {entry.commonName}
                </h2>
                <p className="mt-0.5 font-editorial text-lg italic text-[#9EA7A2]">
                  {entry.scientificName}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 border-t border-[#D8D4C8]/12 pt-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8B918B]">
                    Taxon & Baseline
                  </div>
                  <dl className="space-y-1.5 text-xs">
                    <div className="flex justify-between gap-3 border-b border-[#D8D4C8]/10 pb-1">
                      <dt className="text-[#8B918B]">Baseline Status</dt>
                      <dd className="font-mono text-[#D8D4C8]">
                        {formatBaselineTier(entry.occurrenceStatus)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3 border-b border-[#D8D4C8]/10 pb-1">
                      <dt className="text-[#8B918B]">Geo Prior</dt>
                      <dd className="font-mono text-[#D8D4C8] tabular-nums">
                        {entry.occurrenceScore != null
                          ? entry.occurrenceScore.toFixed(3)
                          : "Unlisted"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3 border-b border-[#D8D4C8]/10 pb-1">
                      <dt className="text-[#8B918B]">BirdNET ID</dt>
                      <dd className="font-mono text-[#D8D4C8]">
                        {entry.birdnetTaxonomyId || "Unindexed"}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="space-y-2">
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8B918B]">
                    Acoustic Record
                  </div>
                  <dl className="space-y-1.5 text-xs">
                    <div className="flex justify-between gap-3 border-b border-[#D8D4C8]/10 pb-1">
                      <dt className="text-[#8B918B]">Observation</dt>
                      <dd className="font-mono text-[#D8D4C8]">
                        {isGap ? "Not detected" : "Detected"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3 border-b border-[#D8D4C8]/10 pb-1">
                      <dt className="text-[#8B918B]">
                        {isGap ? "Windows Sampled" : "Detections / Max Score"}
                      </dt>
                      <dd className="font-mono text-[#D8D4C8] tabular-nums">
                        {isGap
                          ? `${viewModel.totalAudioWindows} window${viewModel.totalAudioWindows === 1 ? "" : "s"}`
                          : `${entry.detectionCount ?? 0} · ${(entry.maxConfidence ?? 0).toFixed(2)}`}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3 border-b border-[#D8D4C8]/10 pb-1">
                      <dt className="text-[#8B918B]">
                        {isGap ? "Site / Grid" : "Observed Interval"}
                      </dt>
                      <dd className="font-mono text-[#D8D4C8] tabular-nums">
                        {isGap
                          ? hasCoords
                            ? `${Math.abs(coords!.latitude!).toFixed(2)}°, ${Math.abs(coords!.longitude!).toFixed(2)}°`
                            : viewModel.locationName
                          : `${(entry.firstSeenSeconds ?? 0).toFixed(1)}–${(entry.lastSeenSeconds ?? 0).toFixed(1)}s`}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              {isGap && entry.possibleFactors.length > 0 && (
                <div className="space-y-2 border-t border-[#D8D4C8]/12 pt-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8B918B]">
                    Possible Non-Detection Factors
                  </div>
                  <ul className="space-y-1 text-xs leading-relaxed text-[#D8D4C8]/85">
                    {entry.possibleFactors.map((factor, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#C89B62]/70" />
                        <span>{factor}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {viewModel.observationGapExplanation && (
                <div className="space-y-1 border-t border-[#D8D4C8]/12 pt-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8B918B]">
                    Session Interpretation
                  </div>
                  <p className="text-xs leading-relaxed text-[#9EA7A2]">
                    {viewModel.observationGapExplanation}
                  </p>
                </div>
              )}
            </div>

            {/* Mandatory Epistemological Boundary */}
            <div className="border-l-2 border-[#C89B62]/55 bg-[#050606] px-4 py-3 text-xs leading-relaxed text-[#D8D4C8]/90">
              <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[#C89B62]">
                Epistemological Boundary
              </div>
              <p>
                {viewModel.scientificDisclaimer} Acoustic non-detection reflects finite
                recording duration, vocal inactivity, canopy attenuation, and threshold
                constraints rather than biological absence.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
