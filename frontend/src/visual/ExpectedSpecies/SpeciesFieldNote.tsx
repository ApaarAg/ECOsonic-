import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  formatOccurrenceTierLabel,
  type SpecimenRecord,
} from "./expectedSpeciesState";
import { computeSpecimenToViewportOrigin } from "./expectedSpeciesInteraction";

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
const FALLBACK_HABITAT_IMG = "/assets/canonical/rainforest_branch_overcast.jpg";

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
  const [imgSrc, setImgSrc] = useState(specimen?.asset.imageUrl || FALLBACK_HABITAT_IMG);

  useEffect(() => {
    if (specimen) {
      setImgSrc(specimen.asset.imageUrl);
    }
  }, [specimen]);

  const handleClose = useCallback(() => {
    if (!specimen || isClosingRef.current) return;
    isClosingRef.current = true;

    const sheetEl = sheetRef.current;
    const backdropEl = backdropRef.current;
    const targetRect = getLiveSpecimenRect?.() ?? originRect;

    if (reducedMotion || !sheetEl || typeof sheetEl.animate !== "function") {
      isClosingRef.current = false;
      onCloseComplete();
      return;
    }

    const origin = computeSpecimenToViewportOrigin(
      targetRect,
      window.innerWidth,
      window.innerHeight,
    );

    if (backdropEl && typeof backdropEl.animate === "function") {
      backdropEl.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 420,
        easing: "ease-out",
        fill: "forwards",
      });
    }

    const anim = sheetEl.animate(
      [
        {
          transform:
            "perspective(1400px) translate3d(0px, 0px, 0px) scale(1, 1) rotateY(0deg) rotateZ(0deg)",
          clipPath: "inset(0% 0% 0% 0%)",
        },
        {
          transform: `perspective(1400px) translate3d(${origin.dxPx}px, ${origin.dyPx}px, 0px) scale(${origin.scaleX}, ${origin.scaleY}) rotateY(${origin.initialRotateYDeg}deg) rotateZ(${origin.initialRotateZDeg}deg)`,
          clipPath: "inset(4% 4% 4% 4%)",
        },
      ],
      {
        duration: 460,
        easing: "cubic-bezier(0.32, 0, 0.24, 1)",
        fill: "forwards",
      },
    );

    anim.onfinish = () => {
      isClosingRef.current = false;
      onCloseComplete();
    };
  }, [specimen, originRect, getLiveSpecimenRect, reducedMotion, onCloseComplete]);

  useEffect(() => {
    if (!specimen) return;
    isClosingRef.current = false;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const sheetEl = sheetRef.current;
    const backdropEl = backdropRef.current;
    const imgEl = imageRevealRef.current;
    const animations: Animation[] = [];

    if (!reducedMotion && sheetEl && typeof sheetEl.animate === "function") {
      const origin = computeSpecimenToViewportOrigin(
        originRect,
        window.innerWidth,
        window.innerHeight,
      );

      if (backdropEl && typeof backdropEl.animate === "function") {
        animations.push(
          backdropEl.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 380,
            easing: "ease-out",
            fill: "both",
          }),
        );
      }

      animations.push(
        sheetEl.animate(
          [
            {
              transform: `perspective(1400px) translate3d(${origin.dxPx}px, ${origin.dyPx}px, 0px) scale(${origin.scaleX}, ${origin.scaleY}) rotateY(${origin.initialRotateYDeg}deg) rotateZ(${origin.initialRotateZDeg}deg)`,
              clipPath: "inset(8% 10% 8% 10%)",
            },
            {
              transform: `perspective(1400px) translate3d(${origin.dxPx * 0.18}px, ${origin.dyPx * 0.18}px, 0px) scale(0.92, 0.94) rotateY(-2.5deg) rotateZ(-0.4deg)`,
              clipPath: "inset(2% 2% 2% 2%)",
              offset: 0.45,
            },
            {
              transform:
                "perspective(1400px) translate3d(0px, 0px, 0px) scale(1, 1) rotateY(0deg) rotateZ(0deg)",
              clipPath: "inset(0% 0% 0% 0%)",
            },
          ],
          {
            duration: 760,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            fill: "both",
          },
        ),
      );

      if (imgEl && typeof imgEl.animate === "function") {
        animations.push(
          imgEl.animate(
            [
              { clipPath: "inset(100% 0% 0% 0%)", transform: "scale(1.06)" },
              { clipPath: "inset(0% 0% 0% 0%)", transform: "scale(1)" },
            ],
            {
              duration: 700,
              delay: 320,
              easing: "cubic-bezier(0.22, 1, 0.36, 1)",
              fill: "both",
            },
          ),
        );
      }

      const maskNodes = sheetEl.querySelectorAll<HTMLElement>("[data-note-rise]");
      maskNodes.forEach((node, idx) => {
        if (typeof node.animate === "function") {
          animations.push(
            node.animate(
              [
                { transform: "translate3d(0, 105%, 0)" },
                { transform: "translate3d(0, 0, 0)" },
              ],
              {
                duration: 540,
                delay: 260 + idx * 65,
                easing: "cubic-bezier(0.22, 1, 0.36, 1)",
                fill: "both",
              },
            ),
          );
        }
      });
    }

    const focusRaf = window.requestAnimationFrame(() => {
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

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
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

  const modalNode = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[60] flex items-center justify-center p-0 sm:p-5 lg:p-8"
    >
      <div
        ref={backdropRef}
        aria-hidden="true"
        onClick={handleClose}
        className="fixed inset-0 bg-[#000000]/92"
      />

      <div
        ref={sheetRef}
        className="relative z-10 h-full w-full max-w-[1220px] origin-center overflow-y-auto overscroll-contain border border-[#D8D4C8]/18 bg-[#080909] text-[#D8D4C8] shadow-[0_40px_120px_rgba(0,0,0,0.95)] sm:h-auto sm:max-h-[92vh] sm:rounded-[3px]"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 opacity-[0.04] sm:absolute"
          style={{
            backgroundImage: "radial-gradient(rgba(232,228,220,0.9) 0.75px, transparent 0)",
            backgroundSize: "18px 18px",
          }}
        />

        <div className="relative z-10 flex items-center justify-between border-b border-[#E8E4DC]/14 px-5 py-4 sm:px-9">
          <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[#9EA7A2] sm:text-[11px]">
            <span>EXPECTED SPECIES</span>
            <span aria-hidden="true" className="text-[#E8E4DC]/30">·</span>
            <span className="text-[#E8E4DC]">ECOLOGICAL FIELD NOTE</span>
            <span aria-hidden="true" className="text-[#E8E4DC]/30">·</span>
            <span className="text-[#D3A36C]">PLATE {specimen.indexLabel}</span>
            {isDemo && (
              <span className="border border-[#D3A36C]/40 bg-[#D3A36C]/10 px-2 py-0.5 text-[#D3A36C]">
                DEMO OBSERVATION
              </span>
            )}
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={handleClose}
            aria-label={`Close field note for ${specimen.commonName}`}
            className="inline-flex cursor-pointer items-center gap-2 rounded-[2px] border border-[#E8E4DC]/20 bg-[#050606] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-[#E8E4DC] transition-colors hover:border-[#E8E4DC]/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C89B62]"
          >
            <span>Return to Archive</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="relative z-10 grid grid-cols-1 items-start gap-8 p-5 sm:p-9 lg:grid-cols-12 lg:gap-12 lg:p-12">
          <div className="flex flex-col gap-3 lg:col-span-5">
            <div className="relative aspect-[4/5] w-full overflow-hidden rounded-[2px] border border-[#E8E4DC]/16 bg-[#050606] p-2 sm:p-2.5">
              <div ref={imageRevealRef} className="relative h-full w-full overflow-hidden">
                <img
                  src={imgSrc}
                  alt={`${specimen.commonName} (${specimen.scientificName}) documentary natural history plate`}
                  onError={() => {
                    if (imgSrc !== FALLBACK_HABITAT_IMG) setImgSrc(FALLBACK_HABITAT_IMG);
                  }}
                  style={{ objectPosition: specimen.asset.focalPosition }}
                  className="h-full w-full object-cover contrast-[1.03] saturate-[0.95]"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] tracking-[0.12em] text-[#9EA7A2]">
              <span>
                {specimen.asset.plateKind === "habitat_context_fallback"
                  ? specimen.asset.captionNote
                  : `PHOTOGRAPH: ${specimen.asset.artist}`}
              </span>
              <span className="uppercase">{specimen.asset.license}</span>
            </div>
          </div>

          <div className="flex flex-col justify-between space-y-8 lg:col-span-7">
            <div className="space-y-3 border-b border-[#E8E4DC]/14 pb-6">
              <div className="overflow-hidden">
                <div
                  data-note-rise
                  className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#6E8272]"
                >
                  EXPECTED IN THIS OBSERVATION CONTEXT
                </div>
              </div>

              <div className="overflow-hidden">
                <h2
                  id={titleId}
                  data-note-rise
                  className="font-editorial text-4xl font-normal leading-[1.03] tracking-tight text-[#E8E4DC] sm:text-5xl lg:text-[54px]"
                >
                  {specimen.commonName}
                </h2>
              </div>

              <div className="overflow-hidden">
                <p
                  data-note-rise
                  className="font-editorial text-xl italic text-[#E8E4DC]/82 sm:text-2xl"
                >
                  {specimen.scientificName}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-x-8 gap-y-6 text-xs sm:grid-cols-2">
              <div className="space-y-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#9EA7A2]">
                  Taxon
                </div>
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between gap-4 border-b border-[#E8E4DC]/10 pb-1">
                    <dt className="text-[#9EA7A2]">Binomial</dt>
                    <dd className="font-editorial text-right italic text-[#E8E4DC]">
                      {specimen.scientificName}
                    </dd>
                  </div>
                  {specimen.birdnetTaxonomyId && (
                    <div className="flex justify-between gap-4 border-b border-[#E8E4DC]/10 pb-1">
                      <dt className="text-[#9EA7A2]">BirdNET ID</dt>
                      <dd className="font-mono text-xs text-[#E8E4DC]">{specimen.birdnetTaxonomyId}</dd>
                    </div>
                  )}
                  {specimen.ebirdCode && (
                    <div className="flex justify-between gap-4 border-b border-[#E8E4DC]/10 pb-1">
                      <dt className="text-[#9EA7A2]">Taxon Code</dt>
                      <dd className="font-mono text-xs uppercase text-[#E8E4DC]">{specimen.ebirdCode}</dd>
                    </div>
                  )}
                </dl>
              </div>

              <div className="space-y-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#9EA7A2]">
                  Expected Status
                </div>
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between gap-4 border-b border-[#E8E4DC]/10 pb-1">
                    <dt className="text-[#9EA7A2]">Baseline Tier</dt>
                    <dd className="font-mono text-xs uppercase tracking-wider text-[#6E8272]">
                      {formatOccurrenceTierLabel(specimen.occurrenceStatus)}
                    </dd>
                  </div>
                  {Number.isFinite(specimen.occurrenceScore) && specimen.occurrenceScore > 0 && (
                    <div className="flex justify-between gap-4 border-b border-[#E8E4DC]/10 pb-1">
                      <dt className="text-[#9EA7A2]">Geo Occurrence Prior</dt>
                      <dd className="font-mono text-xs tabular-nums text-[#E8E4DC]">
                        {specimen.occurrenceScore.toFixed(2)}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>

              <div className="space-y-2 sm:col-span-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#9EA7A2]">
                  Observation Context
                </div>
                <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                  <div className="flex justify-between gap-4 border-b border-[#E8E4DC]/10 pb-1">
                    <dt className="text-[#9EA7A2]">Station / Site</dt>
                    <dd className="text-right text-[#E8E4DC]">{specimen.context.locationName}</dd>
                  </div>
                  <div className="flex justify-between gap-4 border-b border-[#E8E4DC]/10 pb-1">
                    <dt className="text-[#9EA7A2]">Ecosystem</dt>
                    <dd className="text-right capitalize text-[#E8E4DC]">
                      {specimen.context.ecosystemCategory.replace(/-/g, " ")}
                    </dd>
                  </div>
                  {hasCoords && (
                    <div className="flex justify-between gap-4 border-b border-[#E8E4DC]/10 pb-1">
                      <dt className="text-[#9EA7A2]">Generalized Grid</dt>
                      <dd className="font-mono text-xs tabular-nums text-[#E8E4DC]">
                        {Math.abs(coords!.latitude!).toFixed(2)}° {coords!.latitude! >= 0 ? "N" : "S"},{" "}
                        {Math.abs(coords!.longitude!).toFixed(2)}° {coords!.longitude! >= 0 ? "E" : "W"}
                      </dd>
                    </div>
                  )}
                  {specimen.context.meteorologicalWeek != null && (
                    <div className="flex justify-between gap-4 border-b border-[#E8E4DC]/10 pb-1">
                      <dt className="text-[#9EA7A2]">Seasonal Window</dt>
                      <dd className="font-mono text-xs text-[#E8E4DC]">
                        Week {specimen.context.meteorologicalWeek} / 48
                        {specimen.context.observationDate ? ` · ${specimen.context.observationDate}` : ""}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>

            <div className="space-y-1.5 border-l-2 border-[#C89B62]/65 bg-[#050606]/90 p-4 sm:p-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C89B62]">
                Epistemological Boundary
              </div>
              <p className="text-xs leading-relaxed text-[#E8E4DC]/85 sm:text-sm">
                {disclaimer ||
                  "Expected species reflects the available ecological context and does not imply presence or absence at the observation site."}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modalNode, document.body) : modalNode;
}
