import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Compass, Radio, ShieldAlert } from 'lucide-react';
import { Button, SurfacePanel } from '../components/ui/Primitives';

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#101C17] text-[#F0EBE1] flex flex-col items-center justify-center p-6 selection:bg-[#788B68] selection:text-[#101C17]">
      <div className="w-full max-w-lg space-y-8 text-center">
        {/* Visual Brand Badge */}
        <div className="inline-flex p-4 rounded-full bg-[#788B68]/15 border border-[#788B68]/30 text-[#788B68] shadow-lg">
          <Compass className="w-10 h-10 animate-pulse" />
        </div>

        {/* Heading */}
        <div className="space-y-3">
          <div className="font-mono text-xs tracking-widest uppercase text-[#D3A36C]">
            404 · Uncharted Acoustic Coordinates
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl font-semibold text-[#EEEBDD]">
            Page Not Found
          </h1>
          <p className="text-sm text-[#A5AC9C] leading-relaxed max-w-md mx-auto">
            The bioacoustic route or resource you requested does not exist or has been shifted to
            another environmental sector.
          </p>
        </div>

        {/* Action Panel */}
        <SurfacePanel className="p-6 space-y-4 bg-[#14231D]/80 border-[#D5D9C6]/15">
          <div className="text-xs text-[#A5AC9C] font-mono">
            Suggested Navigation Waypoints:
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to="/app/observatory"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-md bg-[#788B68] text-[#101C17] text-xs font-semibold hover:bg-[#899D78] transition-colors shadow-sm"
            >
              <Radio className="w-4 h-4" />
              <span>Enter Live Observatory</span>
            </Link>
            <Link
              to="/"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-md bg-[var(--app-surface-elevated)] border border-[var(--app-border)] text-xs font-medium text-[#F0EBE1] hover:text-[#788B68] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Return to Forest Intro</span>
            </Link>
          </div>
        </SurfacePanel>

        <div className="text-xs font-mono text-[#A5AC9C]/60">
          EcoSonic 3.0 · Environmental Sound Intelligence
        </div>
      </div>
    </div>
  );
}
