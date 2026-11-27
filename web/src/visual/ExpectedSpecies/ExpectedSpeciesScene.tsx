import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { DemoEcoSonicAdapter } from '../../adapters/ecosonicAdapter';
import { useEcoSonic } from '../../context/EcoSonicContext';
import type { ExpectedSpeciesBaseline } from '../../types/ecosonic';
import { ExpectedSpeciesArchive } from './ExpectedSpeciesArchive';
import { buildSpecimenArchive } from './expectedSpeciesState';
import { SpeciesFieldNote } from './SpeciesFieldNote';

function formatAdequacyTag(adequacy: string | null | undefined): string | null {
  switch (adequacy) {
    case 'adequate':
      return 'OBSERVATION: ADEQUATE';
    case 'marginal_duration':
      return 'OBSERVATION: MARGINAL';
    case 'insufficient_duration':
      return 'OBSERVATION: BRIEF (<120S)';
    case 'zero_detections':
      return 'OBSERVATION: SILENT WINDOW';
    case 'location_unspecified':
      return 'LOCATION: UNSPECIFIED';
    default:
      return null;
  }
}

/**
 * Scene 11: EXPECTED SPECIES — Ecological Field Archive.
 * Positioned immediately after ACT 10 (Ecological Context) and before ACT 12 (Observation Gap).
 * Consumes deterministic backend ecological baseline via EcoSonicDataAdapter with zero fabricated species.
 */
export function ExpectedSpeciesScene() {
  const { adapter, sessions, liveSessionId, appearance, isDemoMode } = useEcoSonic();

  const [baseline, setBaseline] = useState<ExpectedSpeciesBaseline | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [fieldNoteOpen, setFieldNoteOpen] = useState<boolean>(false);
  const [originRect, setOriginRect] = useState<DOMRect | null>(null);
  const [explicitDemoInspect, setExplicitDemoInspect] = useState<boolean>(false);

  const selectedButtonRef = useRef<HTMLButtonElement | null>(null);

  const [reducedMotion, setReducedMotion] = useState<boolean>(() => {
    if (appearance.reducedMotionOverride) return true;
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return false;
  });

  useEffect(() => {
    if (appearance.reducedMotionOverride) {
      setReducedMotion(true);
      return;
    }
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [appearance.reducedMotionOverride]);

  const loadBaseline = useCallback(
    async (useExplicitDemo = false) => {
      setStatus('loading');
      setErrorMessage(null);

      try {
        const activeAdapter = useExplicitDemo ? new DemoEcoSonicAdapter() : adapter;
        if (!activeAdapter.fetchExpectedSpeciesBaseline) {
          throw new Error('Active ecological adapter does not support expected species baseline lookup.');
        }

        const preferredSessionId = liveSessionId ?? sessions[0]?.id;
        const result = await activeAdapter.fetchExpectedSpeciesBaseline({
          sessionId: preferredSessionId,
        });

        setBaseline(result);
        setSelectedIndex(0);
        setFieldNoteOpen(false);
        setStatus(result.expectedSpecies.length > 0 ? 'ready' : 'empty');
      } catch (err) {
        console.warn('Scene 11 Expected Species baseline unavailable:', err);
        setBaseline(null);
        setStatus('error');
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'Unable to contact ecological baseline service.'
        );
      }
    },
    [adapter, liveSessionId, sessions]
  );

  useEffect(() => {
    setExplicitDemoInspect(false);
    loadBaseline(false);
  }, [loadBaseline]);

  const specimens = useMemo(() => {
    if (!baseline) return [];
    return buildSpecimenArchive(baseline);
  }, [baseline]);

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

  const handleInspectExplicitDemo = () => {
    setExplicitDemoInspect(true);
    loadBaseline(true);
  };

  const adequacyTag = formatAdequacyTag(baseline?.context.observationAdequacy);
  const isShowingDemo = Boolean(baseline?.isDemo || isDemoMode || explicitDemoInspect);
  const coords = baseline?.context.generalizedCoordinates;
  const hasCoords = coords?.latitude != null && coords?.longitude != null;

  return (
    <section
      id="expected-species"
      aria-label="Expected species"
      data-scene="11"
      className="relative bg-[#070B09] text-[#EEEBDD] py-20 sm:py-28 border-t border-[#D5D9C6]/12 overflow-x-hidden scroll-mt-16"
    >
      {/* Subtle monochrome canopy depth vignette — zero bright colors or gradients */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 55% at 50% 45%, rgba(20, 32, 25, 0.42) 0%, rgba(7, 11, 9, 0.98) 76%)',
        }}
      />

      <div className="relative z-10 max-w-[1440px] mx-auto">
        {/* Top Editorial Masthead & Ecological Context Carry-Over from Act 10 */}
        <div className="px-5 sm:px-8 max-w-[1160px] mx-auto text-center space-y-4 mb-10 sm:mb-14">
          <div className="flex flex-wrap items-center justify-center gap-2.5 text-[10px] sm:text-[11px] font-mono tracking-[0.22em] uppercase text-[#A5AC9C]">
            <span className="text-[#788B68]">ACT 11</span>
            <span aria-hidden="true" className="text-[#D5D9C6]/25">·</span>
            <span>EXPECTED SPECIES</span>
            <span aria-hidden="true" className="text-[#D5D9C6]/25">·</span>
            <span>ECOLOGICAL FIELD ARCHIVE</span>
            {isShowingDemo && (
              <span className="ml-1 px-2.5 py-0.5 border border-[#D3A36C]/45 bg-[#D3A36C]/10 text-[#D3A36C]">
                DEMO OBSERVATION
              </span>
            )}
            {adequacyTag && (
              <span className="px-2.5 py-0.5 border border-[#D5D9C6]/20 bg-[#101814] text-[#D5D9C6]/85">
                {adequacyTag}
              </span>
            )}
          </div>

          <h2 className="font-serif text-3xl sm:text-5xl lg:text-[52px] font-medium tracking-tight text-[#EEEBDD] leading-[1.06]">
            What species belong to this context?
          </h2>

          {/* Context Bar Inherited from Ecological Context (Act 10) */}
          {baseline && (
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs font-mono text-[#D5D9C6]/80">
              <span>{baseline.context.locationName}</span>
              <span aria-hidden="true" className="text-[#D5D9C6]/25">·</span>
              <span className="capitalize">
                {baseline.context.ecosystemCategory.replace(/-/g, ' ')}
              </span>
              {hasCoords && (
                <>
                  <span aria-hidden="true" className="text-[#D5D9C6]/25">·</span>
                  <span className="tabular-nums">
                    {Math.abs(coords!.latitude!).toFixed(2)}° {coords!.latitude! >= 0 ? 'N' : 'S'},{' '}
                    {Math.abs(coords!.longitude!).toFixed(2)}° {coords!.longitude! >= 0 ? 'E' : 'W'}
                  </span>
                </>
              )}
              {baseline.context.meteorologicalWeek != null && (
                <>
                  <span aria-hidden="true" className="text-[#D5D9C6]/25">·</span>
                  <span>Week {baseline.context.meteorologicalWeek} / 48</span>
                </>
              )}
            </div>
          )}

          <p className="max-w-2xl mx-auto text-sm text-[#A5AC9C] leading-relaxed">
            Given the geographic location and seasonal window, these are the species modeled as
            reasonably expected in this habitat. Acoustic non-detection does not establish absence.
          </p>
        </div>

        {/* ===================== STATE 1: ARCHIVAL PREPARATION (LOADING) ===================== */}
        {status === 'loading' && (
          <div
            role="status"
            aria-live="polite"
            className="px-5 sm:px-8 py-14 flex flex-col items-center justify-center space-y-8"
          >
            <div className="flex items-center justify-center gap-2 sm:gap-3 h-[280px] sm:h-[340px]">
              {[0.55, 0.72, 0.85, 1, 0.85, 0.72, 0.55].map((scale, i) => (
                <div
                  key={i}
                  aria-hidden="true"
                  className="border border-[#D5D9C6]/14 bg-[#0D1410] transition-opacity"
                  style={{
                    width: i === 3 ? '210px' : '46px',
                    height: `${Math.round(320 * scale)}px`,
                    opacity: scale * 0.65,
                  }}
                />
              ))}
            </div>
            <div className="font-mono text-xs tracking-[0.26em] uppercase text-[#D5D9C6]/80">
              ASSEMBLING ECOLOGICAL BASELINE
            </div>
          </div>
        )}

        {/* ===================== STATE 2: EXPLICIT ERROR STATE ===================== */}
        {status === 'error' && (
          <div className="max-w-xl mx-auto px-5 sm:px-8 py-14 text-center border border-[#D5D9C6]/16 bg-[#0B110E] space-y-5">
            <div className="font-mono text-xs tracking-[0.24em] uppercase text-[#D3A36C]">
              ECOLOGICAL BASELINE UNAVAILABLE
            </div>
            <p className="text-sm text-[#D5D9C6]/85 leading-relaxed">
              Unable to retrieve regional species expectations from the backend ecological knowledge
              provider ({errorMessage || 'service unreachable'}). No species have been fabricated.
            </p>
            <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => loadBaseline(explicitDemoInspect)}
                className="inline-flex items-center gap-2 px-4 py-2 border border-[#D5D9C6]/30 hover:border-[#EEEBDD] text-xs font-mono tracking-[0.16em] uppercase text-[#EEEBDD] transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Backend</span>
              </button>
              <button
                type="button"
                onClick={handleInspectExplicitDemo}
                className="inline-flex items-center gap-2 px-4 py-2 border border-[#D3A36C]/45 bg-[#D3A36C]/10 hover:bg-[#D3A36C]/20 text-xs font-mono tracking-[0.16em] uppercase text-[#D3A36C] transition-colors cursor-pointer"
              >
                <span>Load Demo Observation</span>
              </button>
            </div>
          </div>
        )}

        {/* ===================== STATE 3: EXPLICIT EMPTY STATE ===================== */}
        {status === 'empty' && (
          <div className="max-w-xl mx-auto px-5 sm:px-8 py-14 text-center border border-[#D5D9C6]/16 bg-[#0B110E] space-y-4">
            <div className="font-mono text-xs tracking-[0.24em] uppercase text-[#A5AC9C]">
              NO EXPECTED SPECIES AVAILABLE
            </div>
            <p className="text-sm text-[#D5D9C6]/85 leading-relaxed">
              {baseline?.emptyReason ||
                'No regional expected species could be resolved for the current observation context.'}
            </p>
            <p className="text-xs font-mono text-[#A5AC9C]/80">
              Expected species are computed strictly from site coordinates and meteorological week.
            </p>
          </div>
        )}

        {/* ===================== STATE 4: POPULATED ARCHIVE ===================== */}
        {status === 'ready' && specimens.length > 0 && (
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

        {/* Subtle restrained epistemological footnote */}
        {status === 'ready' && (
          <div className="mt-10 px-5 sm:px-8 max-w-2xl mx-auto text-center">
            <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-[#A5AC9C]/70 leading-relaxed">
              {baseline?.disclaimer}
            </p>
          </div>
        )}
      </div>

      {/* Physical Field Note Sheet originating from selected Specimen */}
      <SpeciesFieldNote
        specimen={fieldNoteOpen ? selectedSpecimen : null}
        originRect={originRect}
        isDemo={isShowingDemo}
        disclaimer={
          baseline?.disclaimer ||
          'Expected species reflects the available ecological context and does not imply presence or absence at the observation site.'
        }
        reducedMotion={reducedMotion}
        getLiveSpecimenRect={getLiveSpecimenRect}
        onCloseComplete={handleCloseComplete}
      />
    </section>
  );
}
