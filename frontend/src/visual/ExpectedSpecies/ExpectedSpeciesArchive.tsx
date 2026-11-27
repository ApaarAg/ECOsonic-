import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  computeArchiveSlotTransforms,
  formatOccurrenceTierLabel,
  type SpecimenRecord,
} from "./expectedSpeciesState";
import {
  computePlateTilt,
  dampValue,
  resolveArchiveKeyboardAction,
} from "./expectedSpeciesInteraction";
import { SpeciesSpecimen } from "./SpeciesSpecimen";

interface ExpectedSpeciesArchiveProps {
  specimens: SpecimenRecord[];
  selectedIndex: number;
  isFieldNoteOpen: boolean;
  reducedMotion: boolean;
  onSelectIndex: (index: number) => void;
  onOpenFieldNote: (index: number, rect: DOMRect | null) => void;
  registerSelectedButtonRef: (el: HTMLButtonElement | null) => void;
}

export function ExpectedSpeciesArchive({
  specimens,
  selectedIndex,
  isFieldNoteOpen,
  reducedMotion,
  onSelectIndex,
  onOpenFieldNote,
  registerSelectedButtonRef,
}: ExpectedSpeciesArchiveProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const captionTitleRef = useRef<HTMLHeadingElement | null>(null);
  const captionSciRef = useRef<HTMLParagraphElement | null>(null);
  const captionMetaRef = useRef<HTMLDivElement | null>(null);

  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1440,
  );
  const [cursorMode, setCursorMode] = useState<"default" | "specimen" | "selected">("default");
  const [pointerActive, setPointerActive] = useState(false);

  const pointerTargetRef = useRef({ clientX: 0, clientY: 0, normX: 0, normY: 0 });
  const pointerCurrentRef = useRef({ x: 0, y: 0, rx: 0, ry: 0 });
  const selectedPlateTiltRef = useRef({ rx: 0, ry: 0 });
  const rafRef = useRef<number>(0);
  const lastFrameMsRef = useRef<number>(0);
  const dragStartRef = useRef<{ x: number; y: number; active: boolean } | null>(null);
  const wheelAccumRef = useRef(0);
  const lastWheelNavMsRef = useRef(0);

  const isTouchLike = viewportWidth < 768;

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const slots = useMemo(
    () => computeArchiveSlotTransforms(specimens, selectedIndex, viewportWidth, reducedMotion),
    [specimens, selectedIndex, viewportWidth, reducedMotion],
  );

  const selectedSpecimen = specimens[selectedIndex] ?? null;

  useEffect(() => {
    if (!selectedSpecimen || reducedMotion) return;
    const targets = [captionTitleRef.current, captionSciRef.current, captionMetaRef.current];
    const anims: Animation[] = [];

    targets.forEach((el, idx) => {
      if (!el || typeof el.animate !== "function") return;
      anims.push(
        el.animate(
          [
            { opacity: 0, transform: "translate3d(0, 14px, 0)" },
            { opacity: 1, transform: "translate3d(0, 0%, 0)" },
          ],
          {
            duration: 440,
            delay: idx * 45,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            fill: "both",
          },
        ),
      );
    });

    return () => anims.forEach((a) => a.cancel());
  }, [selectedSpecimen?.id, reducedMotion]);

  const runDampedLoop = useCallback(() => {
    rafRef.current = 0;
    if (reducedMotion || isTouchLike) return;

    const now = performance.now();
    const dt = lastFrameMsRef.current ? Math.min(0.08, (now - lastFrameMsRef.current) * 0.001) : 0.016;
    lastFrameMsRef.current = now;

    const target = pointerTargetRef.current;
    const cur = pointerCurrentRef.current;
    const tiltTarget = computePlateTilt(target.normX, target.normY, reducedMotion);

    cur.x = dampValue(cur.x, target.clientX, 16, dt);
    cur.y = dampValue(cur.y, target.clientY, 16, dt);
    cur.rx = dampValue(cur.rx, tiltTarget.rotateXDeg, 9, dt);
    cur.ry = dampValue(cur.ry, tiltTarget.rotateYDeg, 9, dt);

    selectedPlateTiltRef.current.rx = cur.rx;
    selectedPlateTiltRef.current.ry = cur.ry;

    if (cursorRef.current) {
      cursorRef.current.style.transform = `translate3d(${cur.x}px, ${cur.y}px, 0) translate3d(-50%, -50%, 0)`;
    }

    const activeTiltEl = stageRef.current?.querySelector<HTMLElement>('[data-plate-tilt-target="true"]');
    if (activeTiltEl) {
      activeTiltEl.style.transform = `rotateX(${cur.rx.toFixed(2)}deg) rotateY(${cur.ry.toFixed(2)}deg)`;
    }

    const settled =
      Math.abs(cur.x - target.clientX) < 0.25 &&
      Math.abs(cur.y - target.clientY) < 0.25 &&
      Math.abs(cur.rx - tiltTarget.rotateXDeg) < 0.03 &&
      Math.abs(cur.ry - tiltTarget.rotateYDeg) < 0.03;

    if (!settled) {
      rafRef.current = window.requestAnimationFrame(runDampedLoop);
    } else {
      lastFrameMsRef.current = 0;
    }
  }, [reducedMotion, isTouchLike]);

  useEffect(() => {
    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const scheduleDamp = useCallback(() => {
    if (!rafRef.current && !reducedMotion && !isTouchLike) {
      rafRef.current = window.requestAnimationFrame(runDampedLoop);
    }
  }, [runDampedLoop, reducedMotion, isTouchLike]);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (dragStartRef.current?.active) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.15) {
        const nextIdx =
          dx < 0 ? Math.min(specimens.length - 1, selectedIndex + 1) : Math.max(0, selectedIndex - 1);
        if (nextIdx !== selectedIndex) {
          onSelectIndex(nextIdx);
        }
        dragStartRef.current = { x: e.clientX, y: e.clientY, active: true };
      }
    }

    if (reducedMotion || isTouchLike || e.pointerType === "touch") return;

    const normX = ((e.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2;
    const normY = ((e.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 2;
    pointerTargetRef.current = {
      clientX: e.clientX - rect.left,
      clientY: e.clientY - rect.top,
      normX,
      normY,
    };
    if (!pointerActive) {
      pointerCurrentRef.current.x = pointerTargetRef.current.clientX;
      pointerCurrentRef.current.y = pointerTargetRef.current.clientY;
      setPointerActive(true);
    }
    scheduleDamp();
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStartRef.current = { x: e.clientX, y: e.clientY, active: true };
  };

  const handlePointerUpOrCancel = () => {
    if (dragStartRef.current) {
      dragStartRef.current.active = false;
    }
  };

  const handlePointerLeave = () => {
    setPointerActive(false);
    setCursorMode("default");
    if (dragStartRef.current) {
      dragStartRef.current.active = false;
    }
    pointerTargetRef.current.normX = 0;
    pointerTargetRef.current.normY = 0;
    scheduleDamp();
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (isFieldNoteOpen || specimens.length <= 1) return;
    const horizontalIntent = Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.1 || e.shiftKey;
    if (!horizontalIntent) return;

    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    wheelAccumRef.current += delta;

    const now = performance.now();
    if (Math.abs(wheelAccumRef.current) >= 44 && now - lastWheelNavMsRef.current > 180) {
      const step = wheelAccumRef.current > 0 ? 1 : -1;
      const next = Math.max(0, Math.min(specimens.length - 1, selectedIndex + step));
      if (next !== selectedIndex) {
        onSelectIndex(next);
      }
      wheelAccumRef.current = 0;
      lastWheelNavMsRef.current = now;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const action = resolveArchiveKeyboardAction(e.key, selectedIndex, specimens.length, isFieldNoteOpen);
    if (!action) return;

    if (action.type === "select") {
      e.preventDefault();
      onSelectIndex(action.nextIndex);
    } else if (action.type === "open_note") {
      if (e.target === stageRef.current) {
        e.preventDefault();
        const activeBtn = stageRef.current?.querySelector<HTMLButtonElement>('[data-selected="true"]');
        onOpenFieldNote(selectedIndex, activeBtn?.getBoundingClientRect() ?? null);
      }
    }
  };

  return (
    <div className="relative w-full select-none">
      <div
        ref={stageRef}
        tabIndex={0}
        role="region"
        aria-roledescription="ecological specimen archive"
        aria-label="Expected species specimen shelf. Use left and right arrow keys to navigate specimens, Enter to open field note."
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUpOrCancel}
        onPointerCancel={handlePointerUpOrCancel}
        onPointerLeave={handlePointerLeave}
        onWheel={handleWheel}
        className="relative h-[350px] w-full overflow-hidden touch-pan-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#D3A36C]/45 sm:h-[420px] lg:h-[450px]"
        style={{
          perspective: reducedMotion ? "none" : "1650px",
          perspectiveOrigin: "50% 48%",
          cursor: pointerActive && !isTouchLike && !reducedMotion ? "none" : "grab",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-6 h-px bg-gradient-to-r from-transparent via-[#D8D4C8]/14 to-transparent"
        />

        <div
          className="relative h-full w-full"
          style={{
            transformStyle: reducedMotion ? "flat" : "preserve-3d",
          }}
        >
          {slots.map((slot) => (
            <SpeciesSpecimen
              key={slot.specimen.id}
              slot={slot}
              reducedMotion={reducedMotion}
              onSelect={onSelectIndex}
              onOpenFieldNote={onOpenFieldNote}
              onCursorHover={setCursorMode}
              registerSelectedButtonRef={slot.isSelected ? registerSelectedButtonRef : undefined}
              selectedPlateTiltRef={slot.isSelected ? selectedPlateTiltRef : undefined}
            />
          ))}
        </div>

        {!isTouchLike && !reducedMotion && pointerActive && !isFieldNoteOpen && (
          <div
            ref={cursorRef}
            aria-hidden="true"
            className="pointer-events-none fixed left-0 top-0 z-50 will-change-transform sm:absolute"
          >
            <div
              className={`flex items-center justify-center rounded-full border transition-[width,height,background-color,border-color] duration-200 ease-out ${
                cursorMode === "selected"
                  ? "h-[30px] w-[92px] border-[#E8E4DC] bg-[#E8E4DC] text-[#050606] shadow-lg"
                  : cursorMode === "specimen"
                    ? "h-6 w-6 border-[#C89B62]/70 bg-[#050606]/75"
                    : "h-8 w-8 border-[#E8E4DC]/35 bg-transparent"
              }`}
            >
              {cursorMode === "selected" && (
                <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em]">
                  FIELD NOTE
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {selectedSpecimen && (
        <div className="mx-auto flex max-w-[920px] flex-col items-center px-5 pt-3 text-center sm:px-8 sm:pt-4">
          <div className="overflow-hidden">
            <h3
              ref={captionTitleRef}
              className="font-editorial text-2xl font-normal leading-[1.08] tracking-tight text-[#D8D4C8] sm:text-4xl"
            >
              {selectedSpecimen.commonName}
            </h3>
          </div>

          <div className="mt-1 overflow-hidden">
            <p
              ref={captionSciRef}
              className="font-editorial text-base italic text-[#D8D4C8]/78 sm:text-lg"
            >
              {selectedSpecimen.scientificName}
            </p>
          </div>

          <div className="mt-2 overflow-hidden">
            <div
              ref={captionMetaRef}
              className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] font-medium uppercase tracking-[0.22em] text-[#8B918B]"
            >
              <span>{formatOccurrenceTierLabel(selectedSpecimen.occurrenceStatus)}</span>
              <span aria-hidden="true" className="text-[#D8D4C8]/25">·</span>
              <span>ECOLOGICAL BASELINE</span>
              {selectedSpecimen.birdnetTaxonomyId && (
                <>
                  <span aria-hidden="true" className="text-[#D8D4C8]/25">·</span>
                  <span className="font-mono text-[#D8D4C8]/75">
                    TAXON {selectedSpecimen.birdnetTaxonomyId}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="mt-4 flex w-full max-w-md items-center justify-between gap-4 border-t border-[#D8D4C8]/12 pt-3">
            <button
              type="button"
              onClick={() => onSelectIndex(Math.max(0, selectedIndex - 1))}
              disabled={selectedIndex <= 0}
              aria-label="Previous expected species"
              className="inline-flex cursor-pointer items-center gap-2 px-3 py-1 font-mono text-xs uppercase tracking-[0.16em] text-[#E8E4DC]/85 transition-colors hover:text-[#E8E4DC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D3A36C] disabled:pointer-events-none disabled:opacity-30"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              <span className="hidden sm:inline">Prev</span>
            </button>

            <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums tracking-[0.2em] text-[#9EA7A2]">
              <span className="font-medium text-[#E8E4DC]">{selectedSpecimen.indexLabel}</span>
              <span aria-hidden="true">/</span>
              <span>{String(specimens.length).padStart(2, "0")}</span>
            </div>

            <button
              type="button"
              onClick={() => onSelectIndex(Math.min(specimens.length - 1, selectedIndex + 1))}
              disabled={selectedIndex >= specimens.length - 1}
              aria-label="Next expected species"
              className="inline-flex cursor-pointer items-center gap-2 px-3 py-1 font-mono text-xs uppercase tracking-[0.16em] text-[#E8E4DC]/85 transition-colors hover:text-[#E8E4DC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D3A36C] disabled:pointer-events-none disabled:opacity-30"
            >
              <span className="hidden sm:inline">Next</span>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
