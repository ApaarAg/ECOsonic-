import React, { useCallback, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import {
  formatOccurrenceTierLabel,
  type SpecimenRecord,
} from './expectedSpeciesState';
import { computeSpecimenToViewportOrigin } from './expectedSpeciesInteraction';

interface SpeciesFieldNoteProps {
  specimen: SpecimenRecord | null;
  originRect: DOMRect | null;
  isDemo: boolean;
  disclaimer: string;
  reducedMotion: boolean;
  getLiveSpecimenRect?: () => DOMRect | null;
  onCloseComplete: () => void;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Physical Natural-History Field Note Sheet.
 * - Originates from the selected specimen plate's bounding box (`DOMRect`)
 * - Inherits slight plate rotation, expands to fill the viewport, straightens to 0deg
 * - Reveals typography through vertical clip masks & image through aperture clip-path
 * - Reverses physically back into the specimen plate upon Escape or Close
 */
export function SpeciesFieldNote({
  specimen,
  originRect,
  isDemo,
  disclaimer,
  reducedMotion,
  getLiveSpecimenRect,
  onCloseComplete,
}: SpeciesFieldNoteProps) {
  const titleId = useId();
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const imageRevealRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const isClosingRef = useRef(false);

  const handleClose = useCallback(() => {
    if (!specimen || isClosingRef.current) return;
    isClosingRef.current = true;

    const sheetEl = sheetRef.current;
    const backdropEl = backdropRef.current;
    const targetRect = getLiveSpecimenRect?.() ?? originRect;

    if (reducedMotion || !sheetEl || typeof sheetEl.animate !== 'function') {
      isClosingRef.current = false;
      onCloseComplete();
      return;
    }

    const origin = computeSpecimenToViewportOrigin(
      targetRect,
      window.innerWidth,
      window.innerHeight
    );

    if (backdropEl && typeof backdropEl.animate === 'function') {
      backdropEl.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: 420, easing: 'ease-out', fill: 'forwards' }
      );
    }

    const anim = sheetEl.animate(
      [
        {
          transform: 'perspective(1400px) translate3d(0px, 0px, 0px) scale(1, 1) rotateY(0deg) rotateZ(0deg)',
          clipPath: 'inset(0% 0% 0% 0%)',
        },
        {
          transform: `perspective(1400px) translate3d(${origin.dxPx}px, ${origin.dyPx}px, 0px) scale(${origin.scaleX}, ${origin.scaleY}) rotateY(${origin.initialRotateYDeg}deg) rotateZ(${origin.initialRotateZDeg}deg)`,
          clipPath: 'inset(4% 4% 4% 4%)',
        },
      ],
      {
        duration: 460,
        easing: 'cubic-bezier(0.32, 0, 0.24, 1)',
        fill: 'forwards',
      }
    );

    anim.onfinish = () => {
      isClosingRef.current = false;
      onCloseComplete();
    };
  }, [specimen, originRect, getLiveSpecimenRect, reducedMotion, onCloseComplete]);

  // Opening choreography: paper edge expansion -> straighten -> text mask wipe -> photo clip
  useEffect(() => {
    if (!specimen) return;
    isClosingRef.current = false;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const sheetEl = sheetRef.current;
    const backdropEl = backdropRef.current;
    const imgEl = imageRevealRef.current;
    const animations: Animation[] = [];

    if (!reducedMotion && sheetEl && typeof sheetEl.animate === 'function') {
      const origin = computeSpecimenToViewportOrigin(
        originRect,
        window.innerWidth,
        window.innerHeight
      );

      if (backdropEl && typeof backdropEl.animate === 'function') {
        animations.push(
          backdropEl.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 380,
            easing: 'ease-out',
            fill: 'both',
          })
        );
      }

      animations.push(
        sheetEl.animate(
          [
            {
              transform: `perspective(1400px) translate3d(${origin.dxPx}px, ${origin.dyPx}px, 0px) scale(${origin.scaleX}, ${origin.scaleY}) rotateY(${origin.initialRotateYDeg}deg) rotateZ(${origin.initialRotateZDeg}deg)`,
              clipPath: 'inset(8% 10% 8% 10%)',
            },
            {
              transform: `perspective(1400px) translate3d(${origin.dxPx * 0.18}px, ${origin.dyPx * 0.18}px, 0px) scale(0.92, 0.94) rotateY(-2.5deg) rotateZ(-0.4deg)`,
              clipPath: 'inset(2% 2% 2% 2%)',
              offset: 0.45,
            },
            {
              transform:
                'perspective(1400px) translate3d(0px, 0px, 0px) scale(1, 1) rotateY(0deg) rotateZ(0deg)',
              clipPath: 'inset(0% 0% 0% 0%)',
            },
          ],
          {
            duration: 760,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'both',
          }
        )
      );

      if (imgEl && typeof imgEl.animate === 'function') {
        animations.push(
          imgEl.animate(
            [
              { clipPath: 'inset(100% 0% 0% 0%)', transform: 'scale(1.06)' },
              { clipPath: 'inset(0% 0% 0% 0%)', transform: 'scale(1)' },
            ],
            {
              duration: 700,
              delay: 320,
              easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
              fill: 'both',
            }
          )
        );
      }

      const maskNodes = sheetEl.querySelectorAll<HTMLElement>('[data-note-rise]');
      maskNodes.forEach((node, idx) => {
        if (typeof node.animate === 'function') {
          animations.push(
            node.animate(
              [
                { transform: 'translate3d(0, 105%, 0)' },
                { transform: 'translate3d(0, 0, 0)' },
              ],
              {
                duration: 540,
                delay: 260 + idx * 65,
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                fill: 'both',
              }
            )
          );
        }
      });
    }

    const focusRaf = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
        return;
      }

      if (e.key === 'Tab' && sheetRef.current) {
        const focusables = Array.from(
          sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter((el) => el.offsetParent !== null);
        if (focusables.length === 0) return;

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;

        if (e.shiftKey) {
          if (active === first || !sheetRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last || !sheetRef.current.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.cancelAnimationFrame(focusRaf);
      document.body.style.overflow = prevOverflow;
      animations.forEach((a) => a.cancel());
    };
  }, [specimen, originRect, reducedMotion, handleClose]);

  if (!specimen) {
    return null;
  }

  const coords = specimen.context.generalizedCoordinates;
  const hasCoords = coords?.latitude != null && coords?.longitude != null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-5 lg:p-8"
    >
      {/* Obsidian archive backdrop */}
      <div
        ref={backdropRef}
        aria-hidden="true"
        onClick={handleClose}
        className="fixed inset-0 bg-[#050806]/90"
      />

      {/* Archival Paper Sheet */}
      <div
        ref={sheetRef}
        className="relative z-10 w-full h-full sm:h-auto sm:max-h-[92vh] max-w-[1220px] bg-[#111814] text-[#EEEBDD] border border-[#D5D9C6]/22 shadow-[0_40px_120px_rgba(0,0,0,0.92)] overflow-y-auto overscroll-contain origin-center"
      >
        {/* Restrained paper-grain material surface */}
        <div
          aria-hidden="true"
          className="pointer-events-none fixed sm:absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: 'radial-gradient(rgba(238,235,221,0.9) 0.75px, transparent 0)',
            backgroundSize: '18px 18px',
          }}
        />

        {/* Top Field-Note folio masthead */}
        <div className="relative z-10 flex items-center justify-between px-5 sm:px-9 py-4 border-b border-[#D5D9C6]/14">
          <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] sm:text-[11px] tracking-[0.2em] uppercase text-[#A5AC9C]">
            <span>EXPECTED SPECIES</span>
            <span aria-hidden="true" className="text-[#D5D9C6]/30">·</span>
            <span className="text-[#D5D9C6]">ECOLOGICAL FIELD NOTE</span>
            <span aria-hidden="true" className="text-[#D5D9C6]/30">·</span>
            <span className="text-[#D3A36C]">PLATE {specimen.indexLabel}</span>
            {isDemo && (
              <span className="px-2 py-0.5 border border-[#D3A36C]/40 bg-[#D3A36C]/10 text-[#D3A36C]">
                DEMO OBSERVATION
              </span>
            )}
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={handleClose}
            aria-label={`Close field note for ${specimen.commonName}`}
            className="inline-flex items-center gap-2 px-3 py-1.5 border border-[#D5D9C6]/24 hover:border-[#EEEBDD]/60 bg-[#0A0F0C] text-[11px] font-mono tracking-[0.16em] uppercase text-[#D5D9C6] hover:text-[#EEEBDD] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D3A36C]"
          >
            <span>Return to Archive</span>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Folio Body: Mobile stacks Image -> Metadata -> Disclaimer; Desktop uses 42% Plate / 58% Note */}
        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 p-5 sm:p-9 lg:p-12 items-start">
          {/* Bird Photographic Specimen Plate (35–45% desktop width) */}
          <div className="lg:col-span-5 flex flex-col gap-3">
            <div className="relative aspect-[4/5] w-full overflow-hidden bg-[#080C0A] border border-[#D5D9C6]/20 p-2 sm:p-2.5">
              <div ref={imageRevealRef} className="relative w-full h-full overflow-hidden">
                <img
                  src={specimen.asset.imageUrl}
                  alt={`${specimen.commonName} (${specimen.scientificName}) documentary natural history plate`}
                  style={{ objectPosition: specimen.asset.focalPosition }}
                  className="w-full h-full object-cover contrast-[1.03] saturate-[0.95]"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono tracking-[0.12em] text-[#A5AC9C]">
              <span>
                {specimen.asset.plateKind === 'habitat_context_fallback'
                  ? specimen.asset.captionNote
                  : `PHOTOGRAPH: ${specimen.asset.artist}`}
              </span>
              <span className="uppercase">{specimen.asset.license}</span>
            </div>
          </div>

          {/* Right Editorial Field Note Sheet */}
          <div className="lg:col-span-7 flex flex-col justify-between space-y-8">
            {/* Title & Taxon Classification */}
            <div className="space-y-3 border-b border-[#D5D9C6]/14 pb-6">
              <div className="overflow-hidden">
                <div
                  data-note-rise
                  className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#788B68]"
                >
                  EXPECTED IN THIS OBSERVATION CONTEXT
                </div>
              </div>

              <div className="overflow-hidden">
                <h2
                  id={titleId}
                  data-note-rise
                  className="font-serif text-4xl sm:text-5xl lg:text-[54px] font-medium leading-[1.03] tracking-tight text-[#EEEBDD]"
                >
                  {specimen.commonName}
                </h2>
              </div>

              <div className="overflow-hidden">
                <p
                  data-note-rise
                  className="font-serif italic text-xl sm:text-2xl text-[#D5D9C6]/85"
                >
                  {specimen.scientificName}
                </p>
              </div>
            </div>

            {/* Strictly Grounded Backend Ecological Metadata */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6 text-xs">
              <div className="space-y-2">
                <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#A5AC9C]">
                  Taxon
                </div>
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between gap-4 border-b border-[#D5D9C6]/10 pb-1">
                    <dt className="text-[#A5AC9C]">Binomial</dt>
                    <dd className="italic font-serif text-[#EEEBDD] text-right">
                      {specimen.scientificName}
                    </dd>
                  </div>
                  {specimen.birdnetTaxonomyId && (
                    <div className="flex justify-between gap-4 border-b border-[#D5D9C6]/10 pb-1">
                      <dt className="text-[#A5AC9C]">BirdNET ID</dt>
                      <dd className="font-mono text-xs text-[#D5D9C6]">{specimen.birdnetTaxonomyId}</dd>
                    </div>
                  )}
                  {specimen.ebirdCode && (
                    <div className="flex justify-between gap-4 border-b border-[#D5D9C6]/10 pb-1">
                      <dt className="text-[#A5AC9C]">Taxon Code</dt>
                      <dd className="font-mono text-xs text-[#D5D9C6] uppercase">{specimen.ebirdCode}</dd>
                    </div>
                  )}
                </dl>
              </div>

              <div className="space-y-2">
                <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#A5AC9C]">
                  Expected Status
                </div>
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between gap-4 border-b border-[#D5D9C6]/10 pb-1">
                    <dt className="text-[#A5AC9C]">Baseline Tier</dt>
                    <dd className="font-mono text-xs tracking-wider uppercase text-[#788B68]">
                      {formatOccurrenceTierLabel(specimen.occurrenceStatus)}
                    </dd>
                  </div>
                  {Number.isFinite(specimen.occurrenceScore) && specimen.occurrenceScore > 0 && (
                    <div className="flex justify-between gap-4 border-b border-[#D5D9C6]/10 pb-1">
                      <dt className="text-[#A5AC9C]">Geo Occurrence Prior</dt>
                      <dd className="font-mono text-xs tabular-nums text-[#EEEBDD]">
                        {specimen.occurrenceScore.toFixed(2)}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>

              <div className="sm:col-span-2 space-y-2">
                <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#A5AC9C]">
                  Observation Context
                </div>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
                  <div className="flex justify-between gap-4 border-b border-[#D5D9C6]/10 pb-1">
                    <dt className="text-[#A5AC9C]">Station / Site</dt>
                    <dd className="text-[#EEEBDD] text-right">{specimen.context.locationName}</dd>
                  </div>
                  <div className="flex justify-between gap-4 border-b border-[#D5D9C6]/10 pb-1">
                    <dt className="text-[#A5AC9C]">Ecosystem</dt>
                    <dd className="text-[#D5D9C6] text-right capitalize">
                      {specimen.context.ecosystemCategory.replace(/-/g, ' ')}
                    </dd>
                  </div>
                  {hasCoords && (
                    <div className="flex justify-between gap-4 border-b border-[#D5D9C6]/10 pb-1">
                      <dt className="text-[#A5AC9C]">Generalized Grid</dt>
                      <dd className="font-mono text-xs tabular-nums text-[#D5D9C6]">
                        {Math.abs(coords!.latitude!).toFixed(2)}° {coords!.latitude! >= 0 ? 'N' : 'S'},{' '}
                        {Math.abs(coords!.longitude!).toFixed(2)}° {coords!.longitude! >= 0 ? 'E' : 'W'}
                      </dd>
                    </div>
                  )}
                  {specimen.context.meteorologicalWeek != null && (
                    <div className="flex justify-between gap-4 border-b border-[#D5D9C6]/10 pb-1">
                      <dt className="text-[#A5AC9C]">Seasonal Window</dt>
                      <dd className="font-mono text-xs text-[#D5D9C6]">
                        Week {specimen.context.meteorologicalWeek} / 48
                        {specimen.context.observationDate ? ` · ${specimen.context.observationDate}` : ''}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>

            {/* Scientific Non-Absence Disclaimer */}
            <div className="p-4 sm:p-5 border-l-2 border-[#D3A36C]/70 bg-[#0A0F0C]/80 space-y-1.5">
              <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#D3A36C]">
                Epistemological Boundary
              </div>
              <p className="text-xs sm:text-sm text-[#D5D9C6]/85 leading-relaxed">
                {disclaimer ||
                  'Expected species reflects the available ecological context and does not imply presence or absence at the observation site.'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
