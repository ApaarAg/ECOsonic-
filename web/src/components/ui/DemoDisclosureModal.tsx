import { useEffect, useId, useRef } from 'react';
import { AlertTriangle, CheckCircle, Database, Info, Radio, ShieldCheck, X } from 'lucide-react';
import { Button } from './Primitives';

interface DemoDisclosureModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function DemoDisclosureModal({ isOpen, onClose }: DemoDisclosureModalProps) {
  const titleId = useId();
  const descId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

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

      if (e.key === 'Tab' && modalRef.current) {
        const focusables = Array.from(
          modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter((el) => el.offsetParent !== null);

        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;

        if (e.shiftKey) {
          if (active === first || !modalRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last || !modalRef.current.contains(active)) {
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
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/75 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Surface */}
      <div
        ref={modalRef}
        tabIndex={-1}
        className="relative z-10 w-full max-w-2xl bg-[var(--app-surface)] border border-[var(--app-border)] shadow-2xl rounded-xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200 focus:outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[var(--app-border)] bg-[var(--app-surface-elevated)]/40">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#D3A36C]/15 border border-[#D3A36C]/30 text-[#D3A36C]">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 id={titleId} className="font-serif text-xl font-semibold text-[var(--app-text)]">
                Demo Fixture & Architecture Transparency
              </h2>
              <p className="text-xs text-[var(--app-text-muted)] font-mono">
                EcoSonic 3.0 Stage 1 Frontend Disclosure
              </p>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close demo fixture disclosure"
            className="p-1.5 rounded-md text-[var(--app-text-muted)] hover:text-[var(--app-text)] hover:bg-[var(--app-surface-elevated)] transition-colors focus:outline-none focus:ring-1 focus:ring-[#788B68]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div id={descId} className="p-6 space-y-6 overflow-y-auto text-sm text-[var(--app-text)]">
          {/* Important Scientific Notice */}
          <div className="p-4 rounded-lg bg-[var(--app-bg)]/80 border border-[var(--app-border)] space-y-2">
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[#D3A36C]">
              <Info className="w-4 h-4 text-[#D3A36C]" />
              Scientific Data Transparency
            </div>
            <p className="text-xs text-[var(--app-text-secondary)] leading-relaxed">
              All species detections, acoustic disturbance intrusions, and soundscape index records
              currently presented across the Observatory, Species Intelligence, Soundscape, and
              Disturbance workspaces originate from <strong>curated demonstration fixtures</strong>.
              They are designed to illustrate frontend analytical capabilities and do not represent live
              field observations or verified real-time biodiversity surveys.
            </p>
          </div>

          {/* Breakdown Sections */}
          <div className="space-y-4">
            <h3 className="text-xs font-mono uppercase tracking-wider text-[var(--app-text-muted)]">
              Current Architecture Status
            </h3>

            <div className="space-y-3">
              <div className="p-3.5 rounded-lg bg-[var(--app-surface-elevated)]/30 border border-[var(--app-border)] flex items-start gap-3">
                <CheckCircle className="w-4 h-4 text-[#788B68] shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="text-xs font-medium text-[var(--app-text)]">
                    Browser-Local Capabilities (Active)
                  </div>
                  <div className="text-xs text-[var(--app-text-muted)] leading-relaxed">
                    Client-side Web Audio synthesis, microphone enumeration & permission testing,
                    local storage settings persistence, multi-field filtering, sorting, client CSV/JSON
                    exports, and isolated session researcher field notes are fully operational in the browser.
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-[var(--app-surface-elevated)]/30 border border-[var(--app-border)] flex items-start gap-3">
                <Radio className="w-4 h-4 text-[#D3A36C] shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="text-xs font-medium text-[var(--app-text)]">
                    Backend Integration Contract (Awaiting Phase 8 Handoff)
                  </div>
                  <div className="text-xs text-[var(--app-text-muted)] leading-relaxed">
                    Live microphone edge inference, production BirdNET neural audio streaming via WebSocket,
                    remote recording station ingestion, and multi-user database persistence require
                    coupling to the backend ingestion daemon. All data access is cleanly routed through
                    <code className="text-xs text-[#788B68] font-mono mx-1">EcoSonicDataAdapter</code>.
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-[var(--app-surface-elevated)]/30 border border-[var(--app-border)] flex items-start gap-3">
                <ShieldCheck className="w-4 h-4 text-[#A5AC9C] shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="text-xs font-medium text-[var(--app-text)]">
                    Model Confidence Score Interpretation
                  </div>
                  <div className="text-xs text-[var(--app-text-muted)] leading-relaxed">
                    Numerical confidence values (0.00–1.00) represent raw machine learning classifier similarity,
                    not calibrated biological probabilities. They must never be construed as definitive proof of
                    ecological presence or legal misconduct.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--app-border)] bg-[var(--app-surface-elevated)]/20 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Acknowledge & Close
          </Button>
        </div>
      </div>
    </div>
  );
}
