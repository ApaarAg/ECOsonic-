import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import {
  computeArchiveSlotTransforms,
  formatOccurrenceTierLabel,
  type SpecimenRecord,
} from './expectedSpeciesState';
import {
  computePlateTilt,
  dampValue,
  resolveArchiveKeyboardAction,
} from './expectedSpeciesInteraction';
import { SpeciesSpecimen } from './SpeciesSpecimen';

interface ExpectedSpeciesArchiveProps {
  specimens: SpecimenRecord[];
  selectedIndex: number;
  isFieldNoteOpen: boolean;
  reducedMotion: boolean;
  onSelectIndex: (index: number) => void;
  onOpenFieldNote: (index: number, rect: DOMRect | null) => void;
  registerSelectedButtonRef: (el: HTMLButtonElement | null) => void;
}

/**
 * 3D Perspective Horizontal Ecological Archive Stage.
 * Renders vertical Specimen Plates along a shared 3D plane, handles drag/touch/wheel/keyboard
 * selection without blocking vertical page scroll, and surfaces masked editorial captions.
 */
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
    typeof window !== 'undefined' ? window.innerWidth : 1440
  );
  const [cursorMode, setCursorMode] = useState<'default' | 'specimen' | 'selected'>('default');
  const [pointerActive, setPointerActive] = useState(false);

  // High-frequency pointer/tilt refs (zero React re-renders per frame)
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
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const slots = useMemo(
    () => computeArchiveSlotTransforms(specimens, selectedIndex, viewportWidth, reducedMotion),
    [specimens, selectedIndex, viewportWidth, reducedMotion]
  );

  const selectedSpecimen = specimens[selectedIndex] ?? null;

  // Masked vertical wipe reveal for caption underneath (transform-based, zero opacity fade)
  useEffect(() => {
    if (!selectedSpecimen || reducedMotion) return;
    const targets = [captionTitleRef.current, captionSciRef.current, captionMetaRef.current];
    const anims: Animation[] = [];

    targets.forEach((el, idx) => {
      if (!el || typeof el.animate !== 'function') return;
      anims.push(
        el.animate(
          [
            { transform: 'translate3d(0, 108%, 0)' },
            { transform: 'translate3d(0, 0%, 0)' },
          ],
          {
            duration: 460,
            delay: idx * 55,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'both',
          }
        )
      );
    });

    return () => anims.forEach((a) => a.cancel());
  }, [selectedSpecimen?.id, reducedMotion]);

  // Single lightweight damped pointer & cursor loop active ONLY while pointer moves/settles
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

    // Handle desktop drag or touch swipe
    if (dragStartRef.current?.active) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.15) {
        const nextIdx = dx < 0 ? Math.min(specimens.length - 1, selectedIndex + 1) : Math.max(0, selectedIndex - 1);
        if (nextIdx !== selectedIndex) {
          onSelectIndex(nextIdx);
        }
        dragStartRef.current = { x: e.clientX, y: e.clientY, active: true };
      }
    }

    if (reducedMotion || isTouchLike || e.pointerType === 'touch') return;

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
    setCursorMode('default');
    if (dragStartRef.current) {
      dragStartRef.current.active = false;
    }
    pointerTargetRef.current.normX = 0;
    pointerTargetRef.current.normY = 0;
    scheduleDamp();
  };

  // Horizontal wheel / trackpad gesture navigation without breaking vertical scroll narrative
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

    if (action.type === 'select') {
      e.preventDefault();
      onSelectIndex(action.nextIndex);
    } else if (action.type === 'open_note') {
      // Allow Enter/Space handled natively by button click unless fired on stage container
      if (e.target === stageRef.current) {
        e.preventDefault();
        const activeBtn = stageRef.current?.querySelector<HTMLButtonElement>('[data-selected="true"]');
        onOpenFieldNote(selectedIndex, activeBtn?.getBoundingClientRect() ?? null);
      }
    }
  };

  return (
    <div className="relative w-full select-none">
      {/* 3D Perspective Archive Stage */}
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
        className="relative w-full h-[390px] sm:h-[440px] lg:h-[480px] overflow-hidden focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#D3A36C]/45 touch-pan-y"
        style={{
          perspective: reducedMotion ? 'none' : '1650px',
          perspectiveOrigin: '50% 48%',
          cursor: pointerActive && !isTouchLike && !reducedMotion ? 'none' : 'grab',
        }}
      >
        {/* Subtle horizontal museum plinth datum line */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-7 h-px bg-gradient-to-r from-transparent via-[#D5D9C6]/16 to-transparent"
        />

        {/* Shared 3D Transform Plane */}
        <div
          className="relative w-full h-full"
          style={{
            transformStyle: reducedMotion ? 'flat' : 'preserve-3d',
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

        {/* Restrained Ecological Custom Cursor (Desktop & Reduced-Motion Off Only) */}
        {!isTouchLike && !reducedMotion && pointerActive && !isFieldNoteOpen && (
          <div
            ref={cursorRef}
            aria-hidden="true"
            className="pointer-events-none fixed sm:absolute top-0 left-0 z-50 will-change-transform"
          >
            <div
              className={`flex items-center justify-center rounded-full border transition-[width,height,background-color,border-color] duration-200 ease-out ${
                cursorMode === 'selected'
                  ? 'w-[92px] h-[30px] bg-[#EEEBDD] text-[#101C17] border-[#EEEBDD] shadow-lg'
                  : cursorMode === 'specimen'
                    ? 'w-6 h-6 bg-[#101C17]/70 border-[#D3A36C]/70'
                    : 'w-8 h-8 bg-transparent border-[#D5D9C6]/40'
              }`}
            >
              {cursorMode === 'selected' && (
                <span className="font-mono text-[9px] font-semibold tracking-[0.2em] uppercase">
                  FIELD NOTE
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Masked Editorial Caption + Archive Index & Directional Controls */}
      {selectedSpecimen && (
        <div className="max-w-[920px] mx-auto px-5 sm:px-8 pt-4 sm:pt-6 flex flex-col items-center text-center">
          <div className="overflow-hidden">
            <h3
              ref={captionTitleRef}
              className="font-serif text-3xl sm:text-5xl font-medium tracking-tight text-[#EEEBDD] leading-[1.08]"
            >
              {selectedSpecimen.commonName}
            </h3>
          </div>

          <div className="overflow-hidden mt-1.5">
            <p
              ref={captionSciRef}
              className="font-serif italic text-lg sm:text-xl text-[#D5D9C6]/82"
            >
              {selectedSpecimen.scientificName}
            </p>
          </div>

          <div className="overflow-hidden mt-3">
            <div
              ref={captionMetaRef}
              className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-sans text-[11px] font-medium tracking-[0.22em] uppercase text-[#A5AC9C]"
            >
              <span>{formatOccurrenceTierLabel(selectedSpecimen.occurrenceStatus)}</span>
              <span aria-hidden="true" className="text-[#D5D9C6]/30">·</span>
              <span>ECOLOGICAL BASELINE</span>
              {selectedSpecimen.birdnetTaxonomyId && (
                <>
                  <span aria-hidden="true" className="text-[#D5D9C6]/30">·</span>
                  <span className="font-mono text-[#D5D9C6]/75">
                    TAXON {selectedSpecimen.birdnetTaxonomyId}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Restrained Horizontal Archive Navigation */}
          <div className="mt-7 w-full max-w-md flex items-center justify-between gap-4 border-t border-[#D5D9C6]/12 pt-4">
            <button
              type="button"
              onClick={() => onSelectIndex(Math.max(0, selectedIndex - 1))}
              disabled={selectedIndex <= 0}
              aria-label="Previous expected species"
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono tracking-[0.16em] uppercase text-[#D5D9C6] hover:text-[#EEEBDD] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D3A36C]"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Prev</span>
            </button>

            <div className="flex items-center gap-3 font-mono text-[11px] tracking-[0.2em] text-[#A5AC9C] tabular-nums">
              <span className="text-[#EEEBDD] font-medium">{selectedSpecimen.indexLabel}</span>
              <span aria-hidden="true">/</span>
              <span>{String(specimens.length).padStart(2, '0')}</span>
            </div>

            <button
              type="button"
              onClick={() => onSelectIndex(Math.min(specimens.length - 1, selectedIndex + 1))}
              disabled={selectedIndex >= specimens.length - 1}
              aria-label="Next expected species"
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono tracking-[0.16em] uppercase text-[#D5D9C6] hover:text-[#EEEBDD] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D3A36C]"
            >
              <span className="hidden sm:inline">Next</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
