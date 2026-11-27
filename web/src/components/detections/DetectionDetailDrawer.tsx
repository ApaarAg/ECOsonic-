import { useEffect, useId, useRef } from 'react';
import { Bird, Clock, FileAudio, Radio, Waves, X } from 'lucide-react';
import { formatTimestampDateTime } from '../../lib/acoustics';
import type { MonitoringSession, SpeciesDetection } from '../../types/ecosonic';
import { Button } from '../ui/Primitives';

interface DetectionDetailDrawerProps {
  detection: SpeciesDetection | null;
  session: MonitoringSession | null;
  showScientificNamesFirst: boolean;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function DetectionDetailDrawer({
  detection,
  session,
  showScientificNamesFirst,
  onClose,
}: DetectionDetailDrawerProps) {
  const titleId = useId();
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!detection) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const rafId = window.requestAnimationFrame(() => {
      closeBtnRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === 'Tab' && drawerRef.current) {
        const focusables = Array.from(
          drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter((el) => el.offsetParent !== null);

        if (focusables.length === 0) {
          event.preventDefault();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;

        if (event.shiftKey) {
          if (active === first || !drawerRef.current.contains(active)) {
            event.preventDefault();
            last.focus();
          }
        } else if (active === last || !drawerRef.current.contains(active)) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.cancelAnimationFrame(rafId);
      document.body.style.overflow = prevOverflow;
      previousFocusRef.current?.focus();
    };
  }, [detection, onClose]);

  if (!detection) {
    return null;
  }

  const primaryName = showScientificNamesFirst ? detection.scientificName : detection.commonName;
  const secondaryName = showScientificNamesFirst ? detection.commonName : detection.scientificName;

  const lowHz = detection.frequencyRangeHz?.[0] ?? 0;
  const highHz = detection.frequencyRangeHz?.[1] ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over panel */}
      <div
        ref={drawerRef}
        tabIndex={-1}
        className="relative z-10 w-full max-w-lg bg-[var(--app-surface)] border-l border-[var(--app-border)] shadow-2xl flex flex-col h-full overflow-y-auto animate-in slide-in-from-right duration-250 focus:outline-none"
      >
        {/* Drawer Header */}
        <div className="flex items-start justify-between p-6 border-b border-[var(--app-border)] bg-[var(--app-surface-elevated)]/40">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-[#788B68]/15 border border-[#788B68]/30 text-[#788B68]">
              <Bird className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-mono text-[var(--app-text-muted)] tracking-wider uppercase">
                Acoustic Observation Detail
              </p>
              <h2 id={titleId} className="text-xl font-medium text-[var(--app-text)]">
                {primaryName}
              </h2>
              <p className="text-sm italic text-[var(--app-text-secondary)]">{secondaryName}</p>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close detection detail drawer"
            className="p-1.5 rounded-md text-[var(--app-text-muted)] hover:text-[var(--app-text)] hover:bg-[var(--app-surface-elevated)] transition-colors focus:outline-none focus:ring-1 focus:ring-[#788B68]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Content */}
        <div className="p-6 space-y-6 flex-1 text-sm text-[var(--app-text)]">
          {/* Scientific Caveat Badge */}
          <div className="p-3.5 rounded-lg bg-[var(--app-bg)]/80 border border-[var(--app-border)] space-y-1">
            <div className="flex items-center gap-2 text-xs font-mono text-[var(--app-text-muted)] uppercase">
              <Radio className="w-3.5 h-3.5 text-[#788B68]" />
              Bioacoustic Score Calibration Note
            </div>
            <p className="text-xs text-[var(--app-text-secondary)] leading-relaxed">
              Confidence scores represent raw machine-learning classifier similarity (0.00–1.00)
              against taxonomic training templates. They do not constitute calibrated statistical
              detection probabilities or verified biological observations.
            </p>
          </div>

          {/* Core Metrics Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-[var(--app-surface-elevated)]/50 border border-[var(--app-border)]">
              <span className="block text-xs font-mono text-[var(--app-text-muted)] uppercase">
                Model Confidence
              </span>
              <span className="text-xl font-mono tabular-nums font-semibold text-[#788B68]">
                {detection.confidenceScore.toFixed(3)}
              </span>
              <span className="block text-[11px] text-[var(--app-text-muted)] mt-0.5">
                Raw classifier output
              </span>
            </div>

            <div className="p-3 rounded-lg bg-[var(--app-surface-elevated)]/50 border border-[var(--app-border)]">
              <span className="block text-xs font-mono text-[var(--app-text-muted)] uppercase">
                Call Duration
              </span>
              <span className="text-xl font-mono tabular-nums font-semibold text-[var(--app-text)]">
                {detection.durationSec.toFixed(1)}s
              </span>
              <span className="block text-[11px] text-[var(--app-text-muted)] mt-0.5">
                Segment duration
              </span>
            </div>
          </div>

          {/* Spectral Range & Timing */}
          <div className="space-y-3">
            <h3 className="text-xs font-mono text-[var(--app-text-muted)] uppercase tracking-wider">
              Acoustic Profile
            </h3>
            <div className="p-4 rounded-lg bg-[var(--app-surface-elevated)]/30 border border-[var(--app-border)] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--app-text-muted)] flex items-center gap-1.5">
                  <Waves className="w-3.5 h-3.5 text-[#788B68]" />
                  Frequency Band
                </span>
                <span className="font-mono text-xs tabular-nums text-[var(--app-text)]">
                  {lowHz.toLocaleString()} Hz – {highHz.toLocaleString()} Hz
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--app-text-muted)] flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#788B68]" />
                  Detected Timestamp (UTC)
                </span>
                <span className="font-mono text-xs tabular-nums text-[var(--app-text)]">
                  {formatTimestampDateTime(detection.timestampIso)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--app-text-muted)] flex items-center gap-1.5">
                  <Radio className="w-3.5 h-3.5 text-[#788B68]" />
                  Habitat Station Preset
                </span>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--app-bg)] border border-[var(--app-border)] text-[var(--app-text-secondary)]">
                  {detection.habitatPreset}
                </span>
              </div>
            </div>
          </div>

          {/* Session Provenance */}
          <div className="space-y-3">
            <h3 className="text-xs font-mono text-[var(--app-text-muted)] uppercase tracking-wider">
              Session Provenance
            </h3>
            <div className="p-4 rounded-lg bg-[var(--app-surface-elevated)]/30 border border-[var(--app-border)] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--app-text-muted)] flex items-center gap-1.5">
                  <FileAudio className="w-3.5 h-3.5 text-[#788B68]" />
                  Session Identifier
                </span>
                <span className="font-mono text-xs text-[var(--app-text)]">
                  {detection.sessionId}
                </span>
              </div>
              {session && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--app-text-muted)]">Monitoring Site</span>
                    <span className="text-xs text-[var(--app-text)] font-medium">
                      {session.siteName.replace(' (Demo Fixture)', '')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--app-text-muted)]">Site Coordinates</span>
                    <span className="font-mono text-xs tabular-nums text-[var(--app-text-secondary)]">
                      {session.coordinatesLabel}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--app-text-muted)]">Recording Status</span>
                    <span className="text-xs font-mono text-[#788B68] capitalize">
                      {session.status}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Identification Identifier Metadata */}
          <div className="p-3 rounded-lg bg-[var(--app-bg)]/40 border border-[var(--app-border)] text-xs text-[var(--app-text-muted)] flex items-center justify-between">
            <span>Detection Record ID</span>
            <span className="font-mono text-[var(--app-text-secondary)]">{detection.id}</span>
          </div>
        </div>

        {/* Drawer Footer */}
        <div className="p-4 border-t border-[var(--app-border)] bg-[var(--app-surface-elevated)]/20 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
