import React, { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Brain,
  CheckCircle2,
  Compass,
  EyeOff,
  HelpCircle,
  Info,
  MapPin,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TreePine,
  Volume2,
  Waves,
} from 'lucide-react';
import type { ObservationGapAnalysis } from '../../types/ecosonic';
import { Button, SurfacePanel } from '../ui/Primitives';

interface ObservationGapSectionProps {
  data: ObservationGapAnalysis | null;
  isLoading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  showScientificNamesFirst?: boolean;
}

type TabFilter = 'all' | 'gap' | 'detected' | 'unexpected';

export function ObservationGapSection({
  data,
  isLoading = false,
  error = null,
  onRefresh,
  showScientificNamesFirst = false,
}: ObservationGapSectionProps) {
  const [activeTab, setActiveTab] = useState<TabFilter>('all');
  const [isInterpretationExpanded, setIsInterpretationExpanded] = useState(true);

  if (isLoading) {
    return (
      <SurfacePanel className="p-6 space-y-6 animate-pulse">
        <div className="flex items-center justify-between border-b border-[var(--app-border)] pb-4">
          <div className="space-y-2">
            <div className="h-5 w-64 bg-[var(--app-surface-elevated)] rounded" />
            <div className="h-3 w-96 bg-[var(--app-surface-elevated)] rounded" />
          </div>
          <div className="h-8 w-24 bg-[var(--app-surface-elevated)] rounded" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-[var(--app-surface-elevated)] rounded-lg" />
          ))}
        </div>
        <div className="h-48 bg-[var(--app-surface-elevated)] rounded-lg" />
      </SurfacePanel>
    );
  }

  if (error) {
    return (
      <SurfacePanel className="p-6 border-red-900/40 bg-red-950/10 space-y-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h3 className="font-serif text-base font-semibold text-red-200">
              Unable to Load Ecological Gap Intelligence
            </h3>
            <p className="text-xs text-red-300/80 leading-relaxed font-mono">{error}</p>
          </div>
        </div>
        {onRefresh && (
          <Button variant="secondary" size="sm" onClick={onRefresh} className="mt-2">
            <RefreshCw className="w-3.5 h-3.5 mr-1" />
            Retry Analysis
          </Button>
        )}
      </SurfacePanel>
    );
  }

  if (!data) {
    return null;
  }

  const { context, coverage, expectedAndDetected, expectedButNotDetected, detectedUnexpected, interpretation } =
    data;

  // Adequacy badge styling
  const getAdequacyBadge = () => {
    switch (coverage.observationAdequacy) {
      case 'adequate':
        return {
          label: 'Adequate Observation Window',
          color: 'bg-[#788B68]/15 text-[#899D78] border-[#788B68]/30',
          icon: CheckCircle2,
        };
      case 'marginal_duration':
        return {
          label: 'Marginal Duration (120–300s)',
          color: 'bg-[#D3A36C]/15 text-[#E5B57E] border-[#D3A36C]/30',
          icon: AlertTriangle,
        };
      case 'insufficient_duration':
        return {
          label: 'Insufficient Duration (<120s)',
          color: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
          icon: AlertTriangle,
        };
      case 'zero_detections':
        return {
          label: 'Zero Acoustic Detections',
          color: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
          icon: Volume2,
        };
      case 'location_unspecified':
        return {
          label: 'Location Unspecified',
          color: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
          icon: Compass,
        };
      default:
        return {
          label: coverage.observationAdequacy,
          color: 'bg-[var(--app-surface-elevated)] text-[var(--app-text-muted)] border-[var(--app-border)]',
          icon: Info,
        };
    }
  };

  const adequacyBadge = getAdequacyBadge();
  const AdequacyIcon = adequacyBadge.icon;

  return (
    <SurfacePanel className="p-6 space-y-6">
      {/* 1. Header & Metric Overview */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[var(--app-border)] pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <TreePine className="w-5 h-5 text-[#788B68]" />
            <h3 className="font-serif text-xl font-semibold text-[var(--app-text)]">
              Geospatial Ecological Intelligence & Observation Gap
            </h3>
          </div>
          <p className="text-xs text-[var(--app-text-muted)] max-w-2xl leading-relaxed">
            Compares acoustically confirmed taxa against the regional baseline checklist from BirdNET Geo.
            Unobserved taxa represent an <span className="text-[var(--app-text)] font-medium">observation gap</span>,
            not evidence of ecological absence.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-medium border ${adequacyBadge.color}`}
          >
            <AdequacyIcon className="w-3.5 h-3.5" />
            <span>{adequacyBadge.label}</span>
          </div>
          {onRefresh && (
            <button
              onClick={onRefresh}
              title="Re-run ecological expectation analysis"
              className="p-1.5 rounded-md hover:bg-[var(--app-surface-elevated)] text-[var(--app-text-muted)] hover:text-[var(--app-text)] transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 2. Primary Metrics Row & Coverage Gauge */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* Coverage Percentage Gauge */}
        <div className="col-span-2 lg:col-span-1 p-4 rounded-lg bg-[var(--app-surface-elevated)] border border-[var(--app-border)] flex flex-col justify-between">
          <div>
            <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--app-text-muted)]">
              Observation Coverage
            </span>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-3xl font-mono font-semibold text-[#788B68] tabular-nums">
                {coverage.coveragePercentage.toFixed(1)}%
              </span>
            </div>
          </div>
          <div className="mt-3">
            <div className="w-full bg-[var(--app-bg)] h-2 rounded-full overflow-hidden border border-[var(--app-border)]">
              <div
                className="bg-[#788B68] h-full transition-all duration-500 rounded-full"
                style={{ width: `${Math.min(100, Math.max(0, coverage.coveragePercentage))}%` }}
              />
            </div>
            <span className="block mt-1.5 text-[10px] text-[var(--app-text-muted)] font-mono">
              {coverage.detectedExpectedCount} of {coverage.expectedSpeciesCount} expected species observed
            </span>
          </div>
        </div>

        {/* Expected Species */}
        <div className="p-4 rounded-lg bg-[var(--app-bg)] border border-[var(--app-border)] flex flex-col justify-between">
          <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--app-text-muted)]">
            Expected Species
          </span>
          <span className="text-2xl font-mono font-medium text-[var(--app-text)] tabular-nums mt-1">
            {coverage.expectedSpeciesCount}
          </span>
          <span className="text-[10px] text-[var(--app-text-muted)] mt-1 font-mono">
            Regional baseline taxa
          </span>
        </div>

        {/* Detected Expected */}
        <div className="p-4 rounded-lg bg-[var(--app-bg)] border border-[var(--app-border)] flex flex-col justify-between">
          <span className="text-[11px] font-mono uppercase tracking-wider text-[#788B68]">
            Observed Baseline
          </span>
          <span className="text-2xl font-mono font-medium text-[#788B68] tabular-nums mt-1">
            {coverage.detectedExpectedCount}
          </span>
          <span className="text-[10px] text-[var(--app-text-muted)] mt-1 font-mono">
            Acoustically confirmed
          </span>
        </div>

        {/* Observation Gap */}
        <div className="p-4 rounded-lg bg-[var(--app-bg)] border border-[var(--app-border)] flex flex-col justify-between">
          <span className="text-[11px] font-mono uppercase tracking-wider text-[#D3A36C]">
            Observation Gap
          </span>
          <span className="text-2xl font-mono font-medium text-[#D3A36C] tabular-nums mt-1">
            {coverage.gapCount}
          </span>
          <span className="text-[10px] text-[var(--app-text-muted)] mt-1 font-mono">
            Expected • Not detected
          </span>
        </div>

        {/* Detected Unexpected */}
        <div className="p-4 rounded-lg bg-[var(--app-bg)] border border-[var(--app-border)] flex flex-col justify-between">
          <span className="text-[11px] font-mono uppercase tracking-wider text-teal-400/90">
            Unexpected Taxa
          </span>
          <span className="text-2xl font-mono font-medium text-teal-400 tabular-nums mt-1">
            {coverage.detectedUnexpectedCount}
          </span>
          <span className="text-[10px] text-[var(--app-text-muted)] mt-1 font-mono">
            Recorded outside baseline
          </span>
        </div>
      </div>

      {/* 3. Ecological Context Strip */}
      <div className="p-3.5 rounded-lg bg-[var(--app-bg)] border border-[var(--app-border)] flex flex-wrap items-center justify-between gap-y-2 gap-x-6 text-xs font-mono">
        <div className="flex items-center gap-2 text-[var(--app-text-secondary)]">
          <MapPin className="w-3.5 h-3.5 text-[var(--app-text-muted)] shrink-0" />
          <span>
            {context.latitude != null && context.longitude != null
              ? `${Math.abs(context.latitude).toFixed(3)}° ${context.latitude >= 0 ? 'N' : 'S'}, ${Math.abs(
                  context.longitude
                ).toFixed(3)}° ${context.longitude >= 0 ? 'E' : 'W'}`
              : 'Location Unspecified'}
          </span>
          {context.generalizedCoordinates && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-400 border border-zinc-700">
              Coarse Privacy Grid (~10km)
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-[var(--app-text-secondary)]">
          <TreePine className="w-3.5 h-3.5 text-[#788B68] shrink-0" />
          <span>{context.locationName || context.ecosystemCategory}</span>
        </div>

        <div className="flex items-center gap-2 text-[var(--app-text-secondary)]">
          <Compass className="w-3.5 h-3.5 text-[var(--app-text-muted)] shrink-0" />
          <span>
            Meteorological Week {context.meteorologicalWeek} / 48 ({context.observationDate})
          </span>
        </div>

        <div className="flex items-center gap-2 text-[var(--app-text-secondary)]">
          <Waves className="w-3.5 h-3.5 text-[var(--app-text-muted)] shrink-0" />
          <span>Duration: {(context.observationDurationSec / 60).toFixed(1)} min</span>
        </div>
      </div>

      {/* 4. Scientific Disclaimer Callout */}
      <div className="p-3.5 rounded-lg bg-amber-500/5 border border-amber-500/20 flex items-start gap-3 text-xs leading-relaxed">
        <Info className="w-4 h-4 text-[#D3A36C] shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <div className="font-semibold text-[#D3A36C] font-mono uppercase tracking-wider text-[11px]">
            Scientific Epistemology Note — Non-Detection ≠ Absence
          </div>
          <p className="text-[var(--app-text-secondary)] text-[11px]">
            {data.scientificDisclaimer ||
              'Acoustic non-detection indicates only that vocalizations were not recorded above model threshold within the sampling window; it does not constitute scientific evidence of local biological absence.'}
          </p>
        </div>
      </div>

      {/* 5. Tabbed Species Lists */}
      <div className="space-y-4">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--app-border)] pb-2 text-xs font-mono">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              activeTab === 'all'
                ? 'bg-[var(--app-surface-elevated)] text-[var(--app-text)] font-semibold border border-[var(--app-border-strong)]'
                : 'text-[var(--app-text-muted)] hover:text-[var(--app-text)]'
            }`}
          >
            All Taxa ({expectedAndDetected.length + expectedButNotDetected.length + detectedUnexpected.length})
          </button>
          <button
            onClick={() => setActiveTab('gap')}
            className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors ${
              activeTab === 'gap'
                ? 'bg-[#D3A36C]/15 text-[#D3A36C] font-semibold border border-[#D3A36C]/30'
                : 'text-[var(--app-text-muted)] hover:text-[#D3A36C]'
            }`}
          >
            <EyeOff className="w-3.5 h-3.5" />
            <span>Observation Gap ({expectedButNotDetected.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('detected')}
            className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors ${
              activeTab === 'detected'
                ? 'bg-[#788B68]/15 text-[#788B68] font-semibold border border-[#788B68]/30'
                : 'text-[var(--app-text-muted)] hover:text-[#788B68]'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Observed Baseline ({expectedAndDetected.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('unexpected')}
            className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors ${
              activeTab === 'unexpected'
                ? 'bg-teal-500/15 text-teal-400 font-semibold border border-teal-500/30'
                : 'text-[var(--app-text-muted)] hover:text-teal-400'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Unexpected Taxa ({detectedUnexpected.length})</span>
          </button>
        </div>

        {/* Observation Gap Tab Content */}
        {(activeTab === 'all' || activeTab === 'gap') && expectedButNotDetected.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <EyeOff className="w-4 h-4 text-[#D3A36C]" />
              <h4 className="font-serif text-sm font-semibold text-[var(--app-text)]">
                Expected but Not Acoustically Detected ({expectedButNotDetected.length})
              </h4>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {expectedButNotDetected.map((item, idx) => (
                <div
                  key={`gap-${item.scientificName}-${idx}`}
                  className="p-4 rounded-lg bg-[var(--app-surface-elevated)]/40 border border-[#D3A36C]/20 hover:border-[#D3A36C]/40 transition-colors space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-sm text-[var(--app-text)]">
                        {showScientificNamesFirst ? item.scientificName : item.commonName}
                      </div>
                      <div className="text-xs text-[var(--app-text-muted)] italic">
                        {showScientificNamesFirst ? item.commonName : item.scientificName}
                      </div>
                    </div>
                    <span className="shrink-0 px-2 py-0.5 rounded text-[10px] font-mono bg-[#D3A36C]/10 text-[#D3A36C] border border-[#D3A36C]/25">
                      {(item.occurrenceScore * 100).toFixed(0)}% regional exp.
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 text-[11px] font-mono text-amber-300/80">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                    <span>Insufficient evidence for absence</span>
                  </div>

                  {item.possibleFactors && item.possibleFactors.length > 0 && (
                    <div className="pt-1 space-y-1">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--app-text-muted)]">
                        Possible Factors:
                      </span>
                      <ul className="text-[11px] text-[var(--app-text-secondary)] space-y-0.5 list-disc list-inside">
                        {item.possibleFactors.map((factor, fIdx) => (
                          <li key={fIdx} className="leading-tight">
                            {factor}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Observed Baseline Tab Content */}
        {(activeTab === 'all' || activeTab === 'detected') && expectedAndDetected.length > 0 && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#788B68]" />
              <h4 className="font-serif text-sm font-semibold text-[var(--app-text)]">
                Observed Regional Baseline Species ({expectedAndDetected.length})
              </h4>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {expectedAndDetected.map((item, idx) => (
                <div
                  key={`det-${item.scientificName}-${idx}`}
                  className="p-4 rounded-lg bg-[var(--app-surface-elevated)]/40 border border-[#788B68]/20 hover:border-[#788B68]/40 transition-colors space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-sm text-[var(--app-text)]">
                        {showScientificNamesFirst ? item.scientificName : item.commonName}
                      </div>
                      <div className="text-xs text-[var(--app-text-muted)] italic">
                        {showScientificNamesFirst ? item.commonName : item.scientificName}
                      </div>
                    </div>
                    <span className="shrink-0 px-2 py-0.5 rounded text-[10px] font-mono bg-[#788B68]/15 text-[#899D78] border border-[#788B68]/30">
                      Score: {item.maxConfidence.toFixed(2)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] font-mono text-[var(--app-text-muted)] pt-1">
                    <span>
                      {item.detectionCount} vocalization{item.detectionCount > 1 ? 's' : ''}
                    </span>
                    <span className={item.isPersistent ? 'text-[#899D78]' : 'text-zinc-400'}>
                      {item.isPersistent ? 'Persistent across windows' : 'Single burst'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Unexpected Detections Tab Content */}
        {(activeTab === 'all' || activeTab === 'unexpected') && detectedUnexpected.length > 0 && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-teal-400" />
              <h4 className="font-serif text-sm font-semibold text-[var(--app-text)]">
                Acoustically Recorded Outside Expected Baseline ({detectedUnexpected.length})
              </h4>
            </div>

            <div className="p-3 rounded-lg bg-teal-500/5 border border-teal-500/20 text-xs text-teal-300/80 leading-relaxed">
              These taxa were detected with high confidence in the acoustic stream but do not appear in the seasonal
              baseline checklist for this 100km² grid. They represent potential seasonal migrants, non-breeding dispersers,
              or recent range shifts — not invasive designations.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {detectedUnexpected.map((item, idx) => (
                <div
                  key={`unexp-${item.scientificName}-${idx}`}
                  className="p-4 rounded-lg bg-[var(--app-surface-elevated)]/40 border border-teal-500/20 hover:border-teal-500/40 transition-colors space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-sm text-[var(--app-text)]">
                        {showScientificNamesFirst ? item.scientificName : item.commonName}
                      </div>
                      <div className="text-xs text-[var(--app-text-muted)] italic">
                        {showScientificNamesFirst ? item.commonName : item.scientificName}
                      </div>
                    </div>
                    <span className="shrink-0 px-2 py-0.5 rounded text-[10px] font-mono bg-teal-500/10 text-teal-300 border border-teal-500/25">
                      Conf: {item.maxConfidence.toFixed(2)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] font-mono text-[var(--app-text-muted)] pt-1">
                    <span>
                      {item.detectionCount} window{item.detectionCount > 1 ? 's' : ''}
                    </span>
                    <span className="text-teal-400/80">Regional Visitor</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 6. Grounded Ecological Interpretation Box */}
      {interpretation && (
        <div className="p-5 rounded-lg bg-[var(--app-bg)] border border-[var(--app-border)] space-y-4">
          <div className="flex items-center justify-between border-b border-[var(--app-border)] pb-3">
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-[#788B68]" />
              <h4 className="font-serif text-base font-semibold text-[var(--app-text)]">
                Ecological Interpretation & Observational Context
              </h4>
            </div>

            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[var(--app-surface-elevated)] text-[var(--app-text-muted)] border border-[var(--app-border)]">
                {interpretation.provider === 'gemini'
                  ? 'Gemini 2.5 • Grounded'
                  : 'Bioacoustic Rule Engine'}
              </span>
              <button
                type="button"
                onClick={() => setIsInterpretationExpanded(!isInterpretationExpanded)}
                className="text-xs text-[var(--app-text-muted)] hover:text-[var(--app-text)]"
              >
                {isInterpretationExpanded ? 'Collapse' : 'Expand'}
              </button>
            </div>
          </div>

          {isInterpretationExpanded && (
            <div className="space-y-4 text-xs leading-relaxed">
              <div className="space-y-1">
                <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--app-text-muted)]">
                  Synthesis
                </span>
                <p className="text-[var(--app-text)]">{interpretation.summary}</p>
              </div>

              {interpretation.observationGapExplanation && (
                <div className="space-y-1">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-[#D3A36C]">
                    Observation Gap Ecological Mechanics
                  </span>
                  <p className="text-[var(--app-text-secondary)]">
                    {interpretation.observationGapExplanation}
                  </p>
                </div>
              )}

              {interpretation.limitations && interpretation.limitations.length > 0 && (
                <div className="space-y-1 pt-1">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--app-text-muted)]">
                    Methodological Boundaries & Limitations:
                  </span>
                  <ul className="text-[11px] text-[var(--app-text-muted)] space-y-0.5 list-disc list-inside">
                    {interpretation.limitations.map((lim, lIdx) => (
                      <li key={lIdx}>{lim}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </SurfacePanel>
  );
}