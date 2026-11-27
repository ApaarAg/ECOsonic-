import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  formatOccurrenceTierLabel,
  type ArchiveSlotTransform,
} from "./expectedSpeciesState";
import {
  buildSpecimenPlateGeometry,
  type SpecimenPlateVariant,
} from "./specimenPlateGeometry";

interface SpeciesSpecimenProps {
  slot: ArchiveSlotTransform;
  reducedMotion: boolean;
  onSelect: (index: number) => void;
  onOpenFieldNote: (index: number, rect: DOMRect | null) => void;
  onCursorHover: (mode: "default" | "specimen" | "selected") => void;
  registerSelectedButtonRef?: (el: HTMLButtonElement | null) => void;
  selectedPlateTiltRef?: React.MutableRefObject<{ rx: number; ry: number }>;
}

const FALLBACK_HABITAT_IMG = "/assets/canonical/rainforest_branch_overcast.jpg";

/**
 * Physical Specimen Plate in the 3D Horizontal Field Archive.
 * Uses a unified asymmetric SVG silhouette for the outer plate, perimeter border,
 * and inner specimen image aperture.
 */
export const SpeciesSpecimen = React.memo(function SpeciesSpecimen({
  slot,
  reducedMotion,
  onSelect,
  onOpenFieldNote,
  onCursorHover,
  registerSelectedButtonRef,
  selectedPlateTiltRef,
}: SpeciesSpecimenProps) {
  const {
    specimen,
    isSelected,
    visible,
    xPx,
    yPx,
    zPx,
    rotateYDeg,
    widthPx,
    heightPx,
    zIndex,
    dimming,
  } = slot;

  const rawUid = useId();
  const uid = rawUid.replace(/[^a-zA-Z0-9_-]/g, "");
  const plateClipId = `eco-plate-clip-${uid}`;
  const apertureClipId = `eco-aperture-clip-${uid}`;

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const imageApertureRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [imgSrc, setImgSrc] = useState(specimen.asset.imageUrl);

  const plateVariant: SpecimenPlateVariant = isSelected
    ? "active"
    : slot.offset < 0
      ? "left"
      : "right";

  const plateGeom = useMemo(
    () => buildSpecimenPlateGeometry(plateVariant, widthPx, heightPx, false),
    [plateVariant, widthPx, heightPx],
  );

  const apertureGeom = useMemo(() => {
    const apW = Math.max(120, Math.round(widthPx - 24));
    const apH = Math.max(140, Math.round(heightPx - 92));
    return buildSpecimenPlateGeometry("active", apW, apH, true);
  }, [widthPx, heightPx]);

  useEffect(() => {
    setImgSrc(specimen.asset.imageUrl);
  }, [specimen.asset.imageUrl]);

  useEffect(() => {
    if (isSelected && registerSelectedButtonRef) {
      registerSelectedButtonRef(buttonRef.current);
    }
  }, [isSelected, registerSelectedButtonRef, specimen.id]);

  useEffect(() => {
    const el = imageApertureRef.current;
    if (!el || !isSelected || reducedMotion) return;
    if (typeof el.animate !== "function") return;

    const anim = el.animate(
      [
        { opacity: 0.42, transform: "scale(1.035)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      {
        duration: 580,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "both",
      },
    );

    return () => anim.cancel();
  }, [isSelected, reducedMotion, specimen.id]);

  if (!visible) {
    return null;
  }

  const absOffset = Math.abs(slot.offset);
  const hoverLiftY = !isSelected && hovered && !reducedMotion ? -4 : 0;
  const hoverPullZ = !isSelected && hovered && !reducedMotion ? 14 : 0;
  const depthOpacity = isSelected ? 1 : Math.max(0.34, 1 - Math.max(0, absOffset - 1) * 0.16);

  const statusMarkerColor =
    specimen.occurrenceStatus === "frequent"
      ? "bg-[#6E8272]"
      : specimen.occurrenceStatus === "rare"
        ? "bg-[#C89B62]"
        : "bg-[#D8D4C8]/70";

  const borderStroke = focused
    ? "rgba(200, 155, 98, 0.9)"
    : isSelected
      ? "rgba(216, 212, 200, 0.34)"
      : hovered
        ? "rgba(216, 212, 200, 0.28)"
        : "rgba(216, 212, 200, 0.15)";

  const baseTransform = `translate3d(-50%, -50%, 0) translate3d(${xPx}px, ${yPx + hoverLiftY}px, ${zPx + hoverPullZ}px) rotateY(${rotateYDeg}deg)`;

  const handleClick = () => {
    if (isSelected) {
      const rect = buttonRef.current?.getBoundingClientRect() ?? null;
      onOpenFieldNote(specimen.index, rect);
    } else {
      onSelect(specimen.index);
    }
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      data-specimen-id={specimen.id}
      data-selected={isSelected ? "true" : "false"}
      data-plate-variant={plateVariant}
      aria-label={
        isSelected
          ? `Open field note for ${specimen.commonName}`
          : `Select expected species ${specimen.commonName}`
      }
      aria-pressed={isSelected}
      onClick={handleClick}
      onMouseEnter={() => {
        setHovered(true);
        onCursorHover(isSelected ? "selected" : "specimen");
      }}
      onMouseLeave={() => {
        setHovered(false);
        onCursorHover("default");
      }}
      onFocus={() => {
        setFocused(true);
        onCursorHover(isSelected ? "selected" : "specimen");
      }}
      onBlur={() => {
        setFocused(false);
        onCursorHover("default");
      }}
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: `${widthPx}px`,
        height: `${heightPx}px`,
        zIndex,
        opacity: depthOpacity,
        transform: baseTransform,
        transformStyle: "preserve-3d",
        filter: isSelected
          ? "drop-shadow(0 24px 36px rgba(0, 0, 0, 0.92))"
          : hovered
            ? "drop-shadow(0 14px 24px rgba(0, 0, 0, 0.86))"
            : "drop-shadow(0 8px 16px rgba(0, 0, 0, 0.78))",
        transition: reducedMotion
          ? "none"
          : "transform 640ms cubic-bezier(0.22, 1, 0.36, 1), width 640ms cubic-bezier(0.22, 1, 0.36, 1), height 640ms cubic-bezier(0.22, 1, 0.36, 1), opacity 480ms ease, filter 500ms ease",
      }}
      className="group cursor-pointer select-none text-left focus-visible:outline-none"
    >
      {/* Shared SVG silhouette clip definitions for outer plate & inner aperture */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute h-0 w-0 overflow-hidden"
      >
        <defs>
          <clipPath id={plateClipId} clipPathUnits="objectBoundingBox">
            <path d={plateGeom.normalizedClipPath} />
          </clipPath>
          <clipPath id={apertureClipId} clipPathUnits="objectBoundingBox">
            <path d={apertureGeom.normalizedClipPath} />
          </clipPath>
        </defs>
      </svg>

      <div
        data-plate-tilt-target={isSelected ? "true" : undefined}
        style={{
          transform:
            isSelected && selectedPlateTiltRef && !reducedMotion
              ? `rotateX(${selectedPlateTiltRef.current.rx.toFixed(2)}deg) rotateY(${selectedPlateTiltRef.current.ry.toFixed(2)}deg)`
              : undefined,
          transformStyle: "preserve-3d",
          clipPath: `url(#${plateClipId})`,
          WebkitClipPath: `url(#${plateClipId})`,
        }}
        className={`relative h-full w-full overflow-hidden transition-colors duration-300 ${
          isSelected ? "bg-[#080909]" : "bg-[#050606]"
        }`}
      >
        {/* Continuous SVG border strictly following the asymmetric plate silhouette */}
        <svg
          aria-hidden="true"
          data-testid="specimen-plate-border"
          viewBox={`0 0 ${plateGeom.width} ${plateGeom.height}`}
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 z-30 h-full w-full"
        >
          {isSelected && (
            <path
              d={plateGeom.strokePath}
              fill="none"
              vectorEffect="non-scaling-stroke"
              stroke="rgba(232, 228, 220, 0.08)"
              strokeWidth={2.5}
            />
          )}
          <path
            d={plateGeom.strokePath}
            fill="none"
            vectorEffect="non-scaling-stroke"
            stroke={borderStroke}
            strokeWidth={isSelected ? 1.15 : 1}
          />
        </svg>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 opacity-[0.03]"
          style={{
            backgroundImage: "radial-gradient(rgba(216,212,200,0.85) 0.65px, transparent 0)",
            backgroundSize: "14px 14px",
          }}
        />

        {isSelected ? (
          <div className="relative flex h-full w-full flex-col bg-[#080909] p-2.5 sm:p-3">
            {/* Subtle bound folio spine crease on left edge */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 w-3 bg-gradient-to-r from-[#D8D4C8]/[0.035] to-transparent"
            />
            <div className="mb-1.5 flex items-center justify-between border-b border-[#D8D4C8]/12 pb-2 pl-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#8B918B]">
              <span>PLATE · {specimen.indexLabel}</span>
              <span className="flex items-center gap-1.5 text-[#D8D4C8]/90">
                <span className={`h-1.5 w-1.5 rounded-full ${statusMarkerColor}`} />
                <span>{formatOccurrenceTierLabel(specimen.occurrenceStatus)}</span>
              </span>
            </div>

            {/* Specimen image aperture inheriting the same asymmetric plate silhouette */}
            <div
              data-testid="specimen-image-aperture"
              style={{
                clipPath: `url(#${apertureClipId})`,
                WebkitClipPath: `url(#${apertureClipId})`,
              }}
              className="relative flex-1 w-full overflow-hidden bg-[#050606] p-1"
            >
              <div
                ref={imageApertureRef}
                style={{
                  clipPath: `url(#${apertureClipId})`,
                  WebkitClipPath: `url(#${apertureClipId})`,
                }}
                className="relative h-full w-full overflow-hidden"
              >
                <img
                  src={imgSrc}
                  alt={`${specimen.commonName} (${specimen.scientificName}) documentary wildlife specimen`}
                  loading="eager"
                  decoding="async"
                  onError={() => {
                    if (imgSrc !== FALLBACK_HABITAT_IMG) setImgSrc(FALLBACK_HABITAT_IMG);
                  }}
                  style={{ objectPosition: specimen.asset.focalPosition }}
                  className="h-full w-full object-cover contrast-[1.02] saturate-[0.92]"
                />
                {specimen.asset.imageStatus === "unavailable" && (
                  <span className="pointer-events-none absolute bottom-2 right-2 z-20 rounded-[2px] border border-[#D8D4C8]/20 bg-[#050606]/82 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.16em] text-[#D8D4C8]/75">
                    Species image unavailable
                  </span>
                )}
                <span aria-hidden="true" className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-black/30" />
              </div>

              {/* Inner aperture border following the identical silhouette */}
              <svg
                aria-hidden="true"
                viewBox={`0 0 ${apertureGeom.width} ${apertureGeom.height}`}
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 z-20 h-full w-full"
              >
                <path
                  d={apertureGeom.strokePath}
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                  stroke="rgba(216, 212, 200, 0.16)"
                  strokeWidth={1}
                />
              </svg>

              {/* Archival registration ticks placed cleanly on the uncut corners */}
              <span aria-hidden="true" className="pointer-events-none absolute right-2 top-2 z-20 h-2 w-2 border-r border-t border-[#D8D4C8]/26" />
              <span aria-hidden="true" className="pointer-events-none absolute bottom-2 left-2 z-20 h-2 w-2 border-b border-l border-[#D8D4C8]/26" />
            </div>

            <div className="mt-1.5 flex items-center justify-between pr-2 pt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#8B918B]">
              <span className="truncate pr-2">
                {specimen.asset.plateKind === "habitat_context_fallback"
                  ? "HABITAT REF · UNINDEXED PHOTO"
                  : specimen.abbreviatedScientific}
              </span>
              <span className="shrink-0 text-[#C89B62]">NOTE · {specimen.indexLabel} →</span>
            </div>
          </div>
        ) : (
          <div className="relative flex h-full w-full flex-col justify-between overflow-hidden">
            <img
              src={imgSrc}
              alt=""
              aria-hidden="true"
              loading={absOffset <= 1 ? "eager" : "lazy"}
              decoding="async"
              onError={() => {
                if (imgSrc !== FALLBACK_HABITAT_IMG) setImgSrc(FALLBACK_HABITAT_IMG);
              }}
              style={{ objectPosition: specimen.asset.focalPosition }}
              className={`absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03] group-hover:brightness-110 ${
                absOffset >= 2
                  ? "contrast-[1.01] saturate-[0.68] brightness-[0.84]"
                  : "contrast-[1.02] saturate-[0.80] brightness-[0.92]"
              }`}
            />

            <div
              aria-hidden="true"
              className="absolute inset-0 transition-colors duration-300"
              style={{
                background: `linear-gradient(180deg, rgba(2,3,3,${Math.min(0.86, 0.56 + dimming * 0.42).toFixed(2)}) 0%, rgba(2,3,3,${Math.min(0.74, 0.32 + dimming * 0.48).toFixed(2)}) 45%, rgba(2,3,3,${Math.min(0.95, 0.82 + dimming * 0.2).toFixed(2)}) 100%)`,
              }}
            />

            <div className="relative z-10 flex flex-col items-center gap-1.5 px-1 pt-3">
              <span className="font-mono text-[10px] tracking-[0.2em] text-[#D8D4C8]/80">
                {specimen.indexLabel}
              </span>
              <span className={`h-1.5 w-1.5 rounded-full ${statusMarkerColor}`} />
            </div>

            <div className="relative z-10 flex flex-1 items-end justify-center overflow-hidden px-1 pb-4">
              <div
                style={{ writingMode: "vertical-rl" }}
                className="flex max-h-[210px] rotate-180 items-center gap-2 overflow-hidden"
              >
                <span className="font-editorial truncate whitespace-nowrap text-[14px] tracking-[0.04em] text-[#D8D4C8]/88">
                  {specimen.commonName}
                </span>
                <span className="whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.14em] text-[#8B918B]/80">
                  {specimen.abbreviatedScientific}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </button>
  );
});
