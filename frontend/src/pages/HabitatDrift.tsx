import React, { useEffect, useState } from 'react';
import {
  TrendingUp,
  AlertTriangle,
  Info,
  Calendar,
  CheckCircle2,
  RefreshCw,
  Sun,
  Sunrise,
  Sunset,
  Moon,
} from 'lucide-react';
import { useSiteContext } from '../context/SiteContext';
import { sitesService } from '../services/sitesService';
import { HabitatDriftSummary } from '../types';

export const HabitatDrift: React.FC = () => {
  const { sites, selectedSite } = useSiteContext();

  const [driftReport, setDriftReport] = useState<HabitatDriftSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isBaselineInsufficient, setIsBaselineInsufficient] = useState<boolean>(false);

  const fetchHabitatDrift = async () => {
    if (!selectedSite) return;

    try {
      setLoading(true);
      setError(null);
      setIsBaselineInsufficient(false);

      const data = await sitesService.getSiteHabitatDrift(selectedSite.id);
      setDriftReport(data);

      if (data.evaluated_comparisons_count < 3) {
        setIsBaselineInsufficient(true);
      }
    } catch (err: any) {
      console.warn('Could not load habitat drift:', err);
      if (err.message && err.message.toLowerCase().includes('baseline')) {
        setIsBaselineInsufficient(true);
      } else {
        setError(err.message || 'Failed to compute habitat drift.');
      }
      setDriftReport(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHabitatDrift();
  }, [selectedSite?.id]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-forest-750">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-bio-emerald" />
            <h1 className="text-xl font-bold tracking-tight text-white font-mono">
              Habitat Drift & Ecological Trajectory Monitoring
            </h1>
          </div>
          <p className="mt-1 text-xs text-forest-300 font-mono">
            Longitudinal ecoacoustic shift analysis via robust Median Absolute Deviation (MAD) Z-scores
          </p>
        </div>

        <button
          onClick={fetchHabitatDrift}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-forest-900 hover:bg-forest-850 text-xs font-mono text-forest-300 border border-forest-750 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Recompute Drift</span>
        </button>
      </div>

      {/* Mandatory Abundance Disclaimer Banner */}
      <div className="p-3.5 rounded-xl bg-forest-900 border border-forest-750 flex items-start gap-3 text-xs font-mono text-forest-300">
        <Info className="w-4 h-4 text-bio-emerald shrink-0 mt-0.5" />
        <div className="space-y-1 leading-relaxed text-[11px]">
          <div className="font-semibold text-white uppercase tracking-wider text-[10px]">
            Ecological Activity vs True Abundance Caveat
          </div>
          <p>
            Bioacoustic detection frequencies reflect vocalization propensity, calling behavior,
            weather conditions, and recording effort. Higher or lower detection rates must NEVER be
            equated directly with biological population abundance without paired mark-recapture or
            distance sampling ground truthing.
          </p>
        </div>
      </div>

      {/* Structured Insufficient Baseline Advisory State */}
      {isBaselineInsufficient && (
        <div className="p-5 rounded-xl bg-amber-950/30 border border-amber-800/60 space-y-3 font-mono text-xs">
          <div className="flex items-center gap-2 text-amber-300 font-bold">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <span>Insufficient Baseline Recordings (Requires ≥ 3 Valid Sessions)</span>
          </div>
          <p className="text-amber-200/80 leading-relaxed font-sans text-xs">
            Station '{selectedSite?.name || 'Selected Station'}' currently has fewer than 3 completed
            baseline sessions. In accordance with ecological statistical protocols, robust drift
            calculations require at least three independent recordings under comparable diurnal regimes
            to establish non-spurious median and MAD thresholds.
          </p>
          <div className="pt-2 border-t border-amber-900/50 flex items-center gap-4 text-[11px] text-amber-300">
            <span>Completed Sessions: {driftReport?.evaluated_comparisons_count || 0} / 3</span>
            <span>Required Action: Ingest additional monitoring sessions</span>
          </div>
        </div>
      )}

      {/* Habitat Trajectory Summary Card */}
      {driftReport && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 font-mono text-xs space-y-1">
            <div className="text-forest-400 text-[10px]">OVERALL TRAJECTORY</div>
            <div className="text-lg font-bold text-bio-leaf capitalize">
              {driftReport.overall_habitat_trend || 'Stable'}
            </div>
            <span className="text-[9px] text-forest-500">Longitudinal acoustic baseline</span>
          </div>

          <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 font-mono text-xs space-y-1">
            <div className="text-forest-400 text-[10px]">BIOPHONY TREND</div>
            <div className="text-lg font-bold text-white capitalize">
              {driftReport.biophony_trend || 'Nominal'}
            </div>
            <span className="text-[9px] text-forest-500">Avian & wildlife chorus</span>
          </div>

          <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 font-mono text-xs space-y-1">
            <div className="text-forest-400 text-[10px]">ANTHROPHONY TREND</div>
            <div className="text-lg font-bold text-amber-300 capitalize">
              {driftReport.anthrophony_trend || 'Low'}
            </div>
            <span className="text-[9px] text-forest-500">Human-made sound footprint</span>
          </div>

          <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 font-mono text-xs space-y-1">
            <div className="text-forest-400 text-[10px]">STABILITY INDEX</div>
            <div className="text-lg font-bold text-cyan-400">
              {driftReport.stability_index !== undefined
                ? (driftReport.stability_index * 100).toFixed(1) + '%'
                : '—'}
            </div>
            <span className="text-[9px] text-forest-500">Ecoacoustic consistency</span>
          </div>
        </div>
      )}

      {/* Diurnal Matching Regimes */}
      <div className="p-5 rounded-xl bg-forest-900 border border-forest-750 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-forest-800">
          <h2 className="text-sm font-bold text-white font-mono">
            Diurnal Acoustic Regimes & Phenological Windows
          </h2>
          <span className="text-[10px] font-mono text-forest-400">Diurnally Matched Baselines</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-mono text-xs">
          <div className="p-3.5 rounded-lg bg-forest-950 border border-forest-800 space-y-2">
            <div className="flex items-center justify-between text-bio-leaf font-semibold">
              <span className="flex items-center gap-1.5">
                <Sunrise className="w-4 h-4" /> Dawn Chorus
              </span>
              <span className="text-[10px]">05:00 - 08:00</span>
            </div>
            <p className="text-[10px] text-forest-400 leading-normal font-sans">
              Peak avian biophony and territory vocalization window. Primary bioacoustic diversity
              benchmark.
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-forest-950 border border-forest-800 space-y-2">
            <div className="flex items-center justify-between text-amber-300 font-semibold">
              <span className="flex items-center gap-1.5">
                <Sun className="w-4 h-4" /> Midday
              </span>
              <span className="text-[10px]">11:00 - 14:00</span>
            </div>
            <p className="text-[10px] text-forest-400 leading-normal font-sans">
              Thermal convection and elevated anthrophony period. Monitored for mechanical noise
              exposure.
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-forest-950 border border-forest-800 space-y-2">
            <div className="flex items-center justify-between text-bio-leaf font-semibold">
              <span className="flex items-center gap-1.5">
                <Sunset className="w-4 h-4" /> Dusk Chorus
              </span>
              <span className="text-[10px]">17:00 - 19:30</span>
            </div>
            <p className="text-[10px] text-forest-400 leading-normal font-sans">
              Evening transition window. High insectoid and amphibian acoustic activity.
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-forest-950 border border-forest-800 space-y-2">
            <div className="flex items-center justify-between text-indigo-300 font-semibold">
              <span className="flex items-center gap-1.5">
                <Moon className="w-4 h-4" /> Nocturnal
              </span>
              <span className="text-[10px]">21:00 - 04:00</span>
            </div>
            <p className="text-[10px] text-forest-400 leading-normal font-sans">
              Nocturnal mammal vocalization, owl calls, and baseline geophony/wind background.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
