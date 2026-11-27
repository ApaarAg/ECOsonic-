import React, { useEffect, useRef, useState } from 'react';
import {
  formatOccurrenceTierLabel,
  type ArchiveSlotTransform,
} from './expectedSpeciesState';

interface SpeciesSpecimenProps {
  slot: ArchiveSlotTransform;
  reducedMotion: boolean;
  onSelect: (index: number) => void;
  onOpenFieldNote: (index: number, rect: DOMRect | null) => void;
  onCursorHover: (mode: 'default' | 'specimen' | 'selected') => void;
  registerSelectedButtonRef?: (el: HTMLButtonElement | null) => void;
  selectedPlateTiltRef?: React.MutableRefObject<{ rx: number; ry: number }>;
}

/**
 * Physical Specimen Plate in the 3D Horizontal Field Archive.
 * - Unselected: narrow vertical archival plate showing a centered bird crop, index mark,
 *   vertical taxonomic label, and restrained ecological marker.
 * - Selected: rotated flat toward the viewer, pulled forward in Z depth, expanded width,
 *   bird plate revealed physically via clip-path aperture.
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
  const { specimen, isSelected, visible, xPx, yPx, zPx, rotateYDeg, widthPx, heightPx, zIndex, dimming } =
    slot;

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const imageApertureRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);

  // Register button ref when selected so Field Note can restore focus & measure live DOMRect
  useEffect(() => {
    if (isSelected && registerSelectedButtonRef) {
      registerSelectedButtonRef(buttonRef.current);
    }
  }, [isSelected, registerSelectedButtonRef, specimen.id]);

  // Physical clip-path reveal when this specimen turns toward the viewer
  useEffect(() => {
    const el = imageApertureRef.current;
    if (!el || !isSelected || reducedMotion) return;
    if (typeof el.animate !== 'function') return;

    const anim = el.animate(
      [
        { clipPath: 'inset(6% 36% 6% 36%)', transform: 'scale(1.06)' },
        { clipPath: 'inset(0% 0% 0% 0%)', transform: 'scale(1)' },
      ],
      {
        duration: 620,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'both',
      }
    );

    return () => anim.cancel();
  }, [isSelected, reducedMotion, specimen.id]);

  if (!visible) {
    return null;
  }

  const hoverLiftY = !isSelected && hovered && !reducedMotion ? -8 : 0;
  const hoverPullZ = !isSelected && hovered && !reducedMotion ? 18 : 0;

  const statusMarkerColor =
    specimen.occurrenceStatus === 'frequent'
      ? 'bg-[#788B68]'
      : specimen.occurrenceStatus === 'rare'
        ? 'bg-[#D3A36C]'
        : 'bg-[#D5D9C6]/80';

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
      data-selected={isSelected ? 'true' : 'false'}
      aria-label={
        isSelected
          ? `Open field note for ${specimen.commonName}`
          : `Select expected species ${specimen.commonName}`
      }
      aria-pressed={isSelected}
      onClick={handleClick}
      onMouseEnter={() => {
        setHovered(true);
        onCursorHover(isSelected ? 'selected' : 'specimen');
      }}
      onMouseLeave={() => {
        setHovered(false);
        onCursorHover('default');
      }}
      onFocus={() => onCursorHover(isSelected ? 'selected' : 'specimen')}
      onBlur={() => onCursorHover('default')}
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: `${widthPx}px`,
        height: `${heightPx}px`,
        zIndex,
        transform: baseTransform,
        transformStyle: 'preserve-3d',
        transition: reducedMotion
          ? 'none'
          : 'transform 680ms cubic-bezier(0.22, 1, 0.36, 1), width 680ms cubic-bezier(0.22, 1, 0.36, 1), height 680ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 500ms ease',
      }}
      className={`group text-left select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D3A36C] focus-visible:ring-offset-2 focus-visible:ring-offset-[#070B09] cursor-pointer ${
        isSelected
          ? 'shadow-[0_32px_70px_-14px_rgba(0,0,0,0.88),0_12px_28px_-8px_rgba(0,0,0,0.7)]'
          : hovered
            ? 'shadow-[0_18px_36px_-10px_rgba(0,0,0,0.85)]'
            : 'shadow-[0_10px_24px_-8px_rgba(0,0,0,0.75)]'
      }`}
    >
      {/* Inner container receives subtle continuous pointer tilt exclusively when selected */}
      <div
        data-plate-tilt-target={isSelected ? 'true' : undefined}
        style={{
          transform:
            isSelected && selectedPlateTiltRef && !reducedMotion
              ? `rotateX(${selectedPlateTiltRef.current.rx.toFixed(2)}deg) rotateY(${selectedPlateTiltRef.current.ry.toFixed(2)}deg)`
              : undefined,
          transformStyle: 'preserve-3d',
        }}
        className={`relative w-full h-full overflow-hidden rounded-[2px] border transition-colors duration-300 ${
          isSelected
            ? 'bg-[#121A15] border-[#D5D9C6]/34'
            : 'bg-[#0C120F] border-[#D5D9C6]/16 group-hover:border-[#D5D9C6]/32'
        }`}
      >
        {/* Subtle restrained paper grain material surface */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 opacity-[0.045]"
          style={{
            backgroundImage: 'radial-gradient(rgba(238,235,221,0.9) 0.75px, transparent 0)',
            backgroundSize: '14px 14px',
          }}
        />

        {isSelected ? (
          /* ================= EXPANDED FIELD PLATE (SELECTED) ================= */
          <div className="relative flex flex-col w-full h-full p-2.5 sm:p-3 bg-[#111814]">
            {/* Top archival specimen plate bar */}
            <div className="flex items-center justify-between pb-2 mb-1.5 border-b border-[#D5D9C6]/14 text-[10px] font-mono tracking-[0.18em] text-[#A5AC9C] uppercase">
              <span>PLATE · {specimen.indexLabel}</span>
              <span className="flex items-center gap-1.5 text-[#D5D9C6]">
                <span className={`w-1.5 h-1.5 rounded-full ${statusMarkerColor}`} />
                <span>{formatOccurrenceTierLabel(specimen.occurrenceStatus)}</span>
              </span>
            </div>

            {/* Photographic Specimen Aperture */}
            <div className="relative flex-1 w-full overflow-hidden rounded-[1px] bg-[#080C0A] border border-[#D5D9C6]/12">
              <div ref={imageApertureRef} className="w-full h-full">
                <img
                  src={specimen.asset.imageUrl}
                  alt={`${specimen.commonName} (${specimen.scientificName}) documentary wildlife specimen`}
                  loading="eager"
                  decoding="async"
                  style={{ objectPosition: specimen.asset.focalPosition }}
                  className="w-full h-full object-cover contrast-[1.03] saturate-[0.94]"
                />
              </div>

              {/* Subtle corner registration hairlines (museum plate detail) */}
              <span aria-hidden="true" className="pointer-events-none absolute top-1.5 left-1.5 w-2.5 h-2.5 border-t border-l border-[#EEEBDD]/35" />
              <span aria-hidden="true" className="pointer-events-none absolute top-1.5 right-1.5 w-2.5 h-2.5 border-t border-r border-[#EEEBDD]/35" />
              <span aria-hidden="true" className="pointer-events-none absolute bottom-1.5 left-1.5 w-2.5 h-2.5 border-b border-l border-[#EEEBDD]/35" />
              <span aria-hidden="true" className="pointer-events-none absolute bottom-1.5 right-1.5 w-2.5 h-2.5 border-b border-r border-[#EEEBDD]/35" />
            </div>

            {/* Bottom minimal specimen register bar */}
            <div className="pt-2 mt-1.5 flex items-center justify-between text-[10px] font-mono tracking-[0.16em] text-[#A5AC9C] uppercase">
              <span className="truncate pr-2">
                {specimen.asset.plateKind === 'habitat_context_fallback'
                  ? 'HABITAT REF · UNINDEXED PHOTO'
                  : specimen.abbreviatedScientific}
              </span>
              <span className="text-[#D3A36C] shrink-0">FIELD NOTE →</span>
            </div>
          </div>
        ) : (
          /* ================= NARROW ARCHIVAL FACE (PERIPHERAL) ================= */
          <div className="relative flex flex-col justify-between w-full h-full overflow-hidden">
            {/* Full-height narrow bird photographic crop */}
            <img
              src={specimen.asset.imageUrl}
              alt=""
              aria-hidden="true"
              loading="lazy"
              decoding="async"
              style={{ objectPosition: specimen.asset.focalPosition }}
              className="absolute inset-0 w-full h-full object-cover contrast-[1.04] saturate-[0.82] transition-transform duration-500 group-hover:scale-[1.04]"
            />

            {/* Depth & matte charcoal veil preserving legibility & perspective recession */}
            <div
              aria-hidden="true"
              className="absolute inset-0 transition-colors duration-300"
              style={{
                background: `linear-gradient(180deg, rgba(7,11,9,${Math.min(0.84, 0.56 + dimming * 0.4).toFixed(2)}) 0%, rgba(7,11,9,${Math.min(0.7, 0.3 + dimming * 0.45).toFixed(2)}) 45%, rgba(7,11,9,${Math.min(0.94, 0.8 + dimming * 0.2).toFixed(2)}) 100%)`,
              }}
            />

            {/* Top archival index mark + ecological status dot */}
            <div className="relative z-10 flex flex-col items-center gap-1.5 pt-3 px-1">
              <span className="font-mono text-[10px] tracking-[0.2em] text-[#D5D9C6]/85">
                {specimen.indexLabel}
              </span>
              <span className={`w-1.5 h-1.5 rounded-full ${statusMarkerColor}`} />
            </div>

            {/* Bottom vertical spine typography */}
            <div className="relative z-10 flex-1 flex items-end justify-center pb-4 px-1 overflow-hidden">
              <div
                style={{ writingMode: 'vertical-rl' }}
                className="rotate-180 flex items-center gap-2 max-h-[210px] overflow-hidden"
              >
                <span className="font-serif text-[13px] tracking-[0.04em] text-[#EEEBDD]/92 whitespace-nowrap truncate">
                  {specimen.commonName}
                </span>
                <span className="font-mono text-[9px] tracking-[0.14em] text-[#A5AC9C]/80 uppercase whitespace-nowrap">
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
