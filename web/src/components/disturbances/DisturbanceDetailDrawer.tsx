import { useEffect, useId, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  FileAudio,
  Radio,
  ShieldAlert,
  Volume2,
  Waves,
  X,
} from 'lucide-react';
import { formatDurationSeconds, formatTimestampDateTime, getDisturbanceCategoryLabel } from '../../lib/acoustics';
import type { DisturbanceEvent, MonitoringSession } from '../../types/ecosonic';
import { Button } from '../ui/Primitives';

interface DisturbanceDetailDrawerProps {
  event: DisturbanceEvent | null;
  session: MonitoringSession | null;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function DisturbanceDetailDrawer({
  event,
  session,
  onClose,
}: DisturbanceDetailDrawerProps) {
  const titleId = useId();
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!event) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const rafId = window.requestAnimationFrame(() => {
      closeBtnRef.current?.focus();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab' && drawerRef.current) {
        const focusables = Array.from(
          drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter((el) => el.offsetParent !== null);

        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;

        if (e.shiftKey) {
          if (active === first || !drawerRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last || !drawerRef.current.contains(active)) {
          e.preventDefault();
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
  }, [event, onClose]);

  if (!event) {
    return null;
  }

  const lowHz = event.frequencyBandHz?.[0] ?? 0;
  const highHz = event.frequencyBandHz?.[1] ?? 0;

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

      {/* Slide-over Panel */}
      <div
        ref={drawerRef}
        tabIndex={-1}
        className="relative z-10 w-full max-w-lg bg-[var(--app-surface)] border-l border-[var(--app-border)] shadow-2xl flex flex-col h-full overflow-y-auto animate-in slide-in-from-right duration-250 focus:outline-none"
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-[var(--app-border)] bg-[var(--app-surface-elevated)]/40">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-[#D3A36C]/15 border border-[#D3A36C]/30 text-[#D3A36C]">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-mono text-[var(--app-text-muted)] tracking-wider uppercase">
                Acoustic Disturbance Detail
              </p>
              <h2 id={titleId} className="text-xl font-medium text-[var(--app-text)]">
                {event.label}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--app-bg)] border border-[var(--app-border)] text-[#D3A36C]">
                  {getDisturbanceCategoryLabel(event.category)}
                </span>
                <span className="text-xs font-mono capitalize text-[var(--app-text-muted)]">
                  {event.severity} severity
                </span>
              </div>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close disturbance detail drawer"
            className="p-1.5 rounded-md text-[var(--app-text-muted)] hover:text-[var(--app-text)] hover:bg-[var(--app-surface-elevated)] transition-colors focus:outline-none focus:ring-1 focus:ring-[#788B68]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 flex-1 text-sm text-[var(--app-text)]">
          {/* Scientific Caveat Banner */}
          <div className="p-3.5 rounded-lg bg-[var(--app-bg)]/80 border border-[var(--app-border)] space-y-1">
            <div className="flex items-center gap-2 text-xs font-mono text-[var(--app-text-muted)] uppercase">
              <Radio className="w-3.5 h-3.5 text-[#D3A36C]" />
              Acoustic Classification & Ecological Interpretation Caveat
            </div>
            <p className="text-xs text-[var(--app-text-secondary)] leading-relaxed">
              Detection of human-made or mechanical acoustic events is an observational classifier output
              and does not establish illegal activity, intentional misconduct, or proven ecological damage.
              Acoustic co-occurrence does not demonstrate causality. Contextual field investigation is warranted.
            </p>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <h3 className="text-xs font-mono text-[var(--app-text-muted)] uppercase tracking-wider">
              Acoustic Signature Description
            </h3>
            <p className="text-sm text-[var(--app-text-secondary)] leading-relaxed p-3.5 rounded-lg bg-[var(--app-surface-elevated)]/30 border border-[var(--app-border)]">
              {event.description}
            </p>
          </div>

          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-[var(--app-surface-elevated)]/50 border border-[var(--app-border)]">
              <span className="block text-xs font-mono text-[var(--app-text-muted)] uppercase">
                Peak Energy
              </span>
              <span className="text-xl font-mono tabular-nums font-semibold text-[#D3A36C]">
                {event.peakDbfs.toFixed(1)} <span className="text-xs font-normal">dBFS</span>
              </span>
              <span className="block text-[11px] text-[var(--app-text-muted)] mt-0.5">
                Maximum envelope
              </span>
            </div>

            <div className="p-3 rounded-lg bg-[var(--app-surface-elevated)]/50 border border-[var(--app-border)]">
              <span className="block text-xs font-mono text-[var(--app-text-muted)] uppercase">
                Duration
              </span>
              <span className="text-xl font-mono tabular-nums font-semibold text-[var(--app-text)]">
                {formatDurationSeconds(event.durationSec)}
              </span>
              <span className="block text-[11px] text-[var(--app-text-muted)] mt-0.5">
                Event span ({event.durationSec.toFixed(1)}s)
              </span>
            </div>

            <div className="p-3 rounded-lg bg-[var(--app-surface-elevated)]/50 border border-[var(--app-border)] col-span-2 sm:col-span-1">
              <span className="block text-xs font-mono text-[var(--app-text-muted)] uppercase">
                Model Score
              </span>
              <span className="text-xl font-mono tabular-nums font-semibold text-[#788B68]">
                {event.confidenceScore.toFixed(2)}
              </span>
              <span className="block text-[11px] text-[var(--app-text-muted)] mt-0.5">
                Classifier similarity
              </span>
            </div>
          </div>

          {/* Acoustic Spectral Parameters */}
          <div className="space-y-3">
            <h3 className="text-xs font-mono text-[var(--app-text-muted)] uppercase tracking-wider">
              Acoustic Frequency & Timing
            </h3>
            <div className="p-4 rounded-lg bg-[var(--app-surface-elevated)]/30 border border-[var(--app-border)] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--app-text-muted)] flex items-center gap-1.5">
                  <Waves className="w-3.5 h-3.5 text-[#D3A36C]" />
                  Frequency Band
                </span>
                <span className="font-mono text-xs tabular-nums text-[var(--app-text)]">
                  {lowHz.toLocaleString()} Hz – {highHz.toLocaleString()} Hz
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--app-text-muted)] flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#D3A36C]" />
                  Recorded Timestamp (UTC)
                </span>
                <span className="font-mono text-xs tabular-nums text-[var(--app-text)]">
                  {formatTimestampDateTime(event.timestampIso)}
                </span>
              </div>
            </div>
          </div>

          {/* Session Provenance with Cross-Linking */}
          <div className="space-y-3">
            <h3 className="text-xs font-mono text-[var(--app-text-muted)] uppercase tracking-wider">
              Monitoring Session Provenance
            </h3>
            <div className="p-4 rounded-lg bg-[var(--app-surface-elevated)]/30 border border-[var(--app-border)] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--app-text-muted)] flex items-center gap-1.5">
                  <FileAudio className="w-3.5 h-3.5 text-[#788B68]" />
                  Session Identifier
                </span>
                <span className="font-mono text-xs font-medium text-[var(--app-text)]">
                  {event.sessionId}
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
                    <span className="text-xs text-[var(--app-text-muted)]">Session Status</span>
                    <span className="text-xs font-mono text-[#788B68] capitalize">
                      {session.status}
                    </span>
                  </div>
                </>
              )}

              {/* Cross-Link to Session History */}
              <div className="pt-2 border-t border-[var(--app-border)]">
                <Link
                  to={`/app/sessions?session=${encodeURIComponent(event.sessionId)}`}
                  className="w-full inline-flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-[var(--app-bg)] border border-[var(--app-border)] hover:border-[#788B68] text-xs font-medium text-[var(--app-text)] hover:text-[#788B68] transition-colors"
                >
                  <span>Open in Session History ({event.sessionId})</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          </div>

          {/* Record Metadata */}
          <div className="p-3 rounded-lg bg-[var(--app-bg)]/40 border border-[var(--app-border)] text-xs text-[var(--app-text-muted)] flex items-center justify-between">
            <span>Disturbance Record ID</span>
            <span className="font-mono text-[var(--app-text-secondary)]">{event.id}</span>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--app-border)] bg-[var(--app-surface-elevated)]/20 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
