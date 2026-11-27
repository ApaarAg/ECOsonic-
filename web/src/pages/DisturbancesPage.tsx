import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Cog,
  FileAudio,
  Music,
  Plane,
  RotateCcw,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { DisturbanceDetailDrawer } from '../components/disturbances/DisturbanceDetailDrawer';
import { AppShell } from '../components/layout/AppShell';
import { Button, EmptyState, MetricReadout, SkeletonPanel, SurfacePanel } from '../components/ui/Primitives';
import { useEcoSonic } from '../context/EcoSonicContext';
import {
  formatDurationSeconds,
  formatTimestampDateTime,
  getDisturbanceCategoryLabel,
} from '../lib/acoustics';
import {
  calculateCategoryCounts,
  filterDisturbanceIntelligence,
  parseDisturbanceUrlParams,
  serializeDisturbanceUrlParams,
  sortDisturbanceEvents,
  type DisturbanceFilterState,
  type DisturbanceSortField,
} from '../lib/disturbanceIntelligence';
import type {
  DisturbanceCategory,
  DisturbanceEvent,
  DisturbanceSeverity,
} from '../types/ecosonic';

const CATEGORY_META: Record<
  DisturbanceCategory,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    accentClass: string;
    description: string;
    badgeBorder: string;
    badgeBg: string;
  }
> = {
  transportation: {
    label: 'Transportation',
    icon: Plane,
    accentClass: 'text-[#D3A36C]',
    badgeBorder: 'border-[#D3A36C]/40',
    badgeBg: 'bg-[#D3A36C]/10',
    description: 'Aircraft, rail corridors, and distant road transit low-frequency envelopes.',
  },
  environmental_hazard: {
    label: 'Potential Environmental Hazard',
    icon: AlertTriangle,
    accentClass: 'text-[#E07A5F]',
    badgeBorder: 'border-[#E07A5F]/40',
    badgeBg: 'bg-[#E07A5F]/10',
    description: 'Severe wind shear, canopy limb fractures, or abrupt abiotic impulse events.',
  },
  mechanical_activity: {
    label: 'Mechanical Activity',
    icon: Cog,
    accentClass: 'text-[#D5D9C6]',
    badgeBorder: 'border-[#D5D9C6]/40',
    badgeBg: 'bg-[#D5D9C6]/10',
    description: 'Harmonic engine signatures, forestry equipment, and motorized maintenance.',
  },
  cultural_sound: {
    label: 'Cultural Sounds',
    icon: Music,
    accentClass: 'text-[#788B68]',
    badgeBorder: 'border-[#788B68]/40',
    badgeBg: 'bg-[#788B68]/10',
    description: 'Human speech corridors, distant village bells, and recreational trail acoustics.',
  },
};

export function DisturbancesPage() {
  const { disturbances, sessions, isLoading } = useEcoSonic();
  const [searchParams, setSearchParams] = useSearchParams();

  // Initial filter hydration
  const initialFilters = useMemo(
    () => parseDisturbanceUrlParams(searchParams),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [filters, setFilters] = useState<DisturbanceFilterState>(initialFilters);
  const [searchInput, setSearchInput] = useState(initialFilters.search);
  const [inspectedEvent, setInspectedEvent] = useState<DisturbanceEvent | null>(null);

  // Sync state if URL changes externally (e.g. Back/Forward)
  const lastSerializedParamsRef = useRef(searchParams.toString());
  useEffect(() => {
    const currentStr = searchParams.toString();
    if (currentStr !== lastSerializedParamsRef.current) {
      lastSerializedParamsRef.current = currentStr;
      const parsed = parseDisturbanceUrlParams(searchParams);
      setFilters(parsed);
      setSearchInput(parsed.search);
    }
  }, [searchParams]);

  // Debounced search input sync
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev) => {
        if (prev.search === searchInput) return prev;
        return { ...prev, search: searchInput };
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Sync filter changes back to URL
  const isFirstSyncRef = useRef(true);
  useEffect(() => {
    if (isFirstSyncRef.current) {
      isFirstSyncRef.current = false;
      return;
    }
    const newParams = serializeDisturbanceUrlParams(filters, searchParams);
    const newParamsStr = newParams.toString();
    if (newParamsStr !== searchParams.toString()) {
      lastSerializedParamsRef.current = newParamsStr;
      setSearchParams(newParams, { replace: true });
    }
  }, [filters, searchParams, setSearchParams]);

  // Total counts by category across all disturbances
  const allCategoryCounts = useMemo(() => calculateCategoryCounts(disturbances), [disturbances]);

  // Filtered & Sorted events
  const filtered = useMemo(
    () => filterDisturbanceIntelligence(disturbances, filters),
    [disturbances, filters]
  );

  const sorted = useMemo(
    () => sortDisturbanceEvents(filtered, filters.sortField, filters.sortDirection),
    [filtered, filters.sortField, filters.sortDirection]
  );

  // Inspected session lookup
  const inspectedSession = useMemo(() => {
    if (!inspectedEvent) return null;
    return sessions.find((s) => s.id === inspectedEvent.sessionId) ?? null;
  }, [inspectedEvent, sessions]);

  // Reset all filters
  const handleResetFilters = () => {
    setSearchInput('');
    setFilters({
      search: '',
      category: 'all',
      severity: 'all',
      sessionId: 'all',
      sortField: 'timestamp',
      sortDirection: 'desc',
    });
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  // Toggle category KPI click
  const handleCategoryKpiClick = (category: DisturbanceCategory) => {
    setFilters((prev) => ({
      ...prev,
      category: prev.category === category ? 'all' : category,
    }));
  };

  // Sort change handler
  const handleSortChange = (field: DisturbanceSortField) => {
    setFilters((prev) => {
      if (prev.sortField === field) {
        return {
          ...prev,
          sortDirection: prev.sortDirection === 'asc' ? 'desc' : 'asc',
        };
      }
      return {
        ...prev,
        sortField: field,
        sortDirection: field === 'category' ? 'asc' : 'desc',
      };
    });
  };

  const searchInputId = useId();
  const severitySelectId = useId();
  const sessionSelectId = useId();
  const sortSelectId = useId();

  // Validate if active session exists in available sessions
  const isSelectedSessionValid =
    filters.sessionId === 'all' || sessions.some((s) => s.id === filters.sessionId);

  return (
    <AppShell
      title="Disturbance Radar"
      subtitle="Categorized non-animal acoustic events, anthrophony envelopes, and temporal intrusion timeline"
    >
      <div className="space-y-6">
        {/* Interactive Category KPI Cards */}
        <section
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
          role="region"
          aria-label="Disturbance category summary cards"
        >
          <div
            onClick={() => handleCategoryKpiClick('transportation')}
            className={`transition-all rounded-lg cursor-pointer text-left ${
              filters.category === 'transportation'
                ? 'ring-2 ring-[#D3A36C] ring-offset-2 ring-offset-[var(--app-bg)]'
                : 'hover:opacity-90'
            }`}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleCategoryKpiClick('transportation');
              }
            }}
            aria-pressed={filters.category === 'transportation'}
            aria-label={`Filter by Transportation. Total: ${allCategoryCounts.transportation}`}
          >
            <MetricReadout
              label="Transportation"
              value={allCategoryCounts.transportation}
              accent="amber"
              context={
                filters.category === 'transportation'
                  ? 'Active Filter · Click to clear'
                  : 'Aircraft & rail corridor signatures'
              }
            />
          </div>

          <div
            onClick={() => handleCategoryKpiClick('environmental_hazard')}
            className={`transition-all rounded-lg cursor-pointer text-left ${
              filters.category === 'environmental_hazard'
                ? 'ring-2 ring-[#E07A5F] ring-offset-2 ring-offset-[var(--app-bg)]'
                : 'hover:opacity-90'
            }`}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleCategoryKpiClick('environmental_hazard');
              }
            }}
            aria-pressed={filters.category === 'environmental_hazard'}
            aria-label={`Filter by Potential Environmental Hazards. Total: ${allCategoryCounts.environmental_hazard}`}
          >
            <MetricReadout
              label="Environmental Hazards"
              value={allCategoryCounts.environmental_hazard}
              context={
                filters.category === 'environmental_hazard'
                  ? 'Active Filter · Click to clear'
                  : 'Wind shear & canopy fracture impulses'
              }
            />
          </div>

          <div
            onClick={() => handleCategoryKpiClick('mechanical_activity')}
            className={`transition-all rounded-lg cursor-pointer text-left ${
              filters.category === 'mechanical_activity'
                ? 'ring-2 ring-[#D5D9C6] ring-offset-2 ring-offset-[var(--app-bg)]'
                : 'hover:opacity-90'
            }`}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleCategoryKpiClick('mechanical_activity');
              }
            }}
            aria-pressed={filters.category === 'mechanical_activity'}
            aria-label={`Filter by Mechanical Activity. Total: ${allCategoryCounts.mechanical_activity}`}
          >
            <MetricReadout
              label="Mechanical Activity"
              value={allCategoryCounts.mechanical_activity}
              context={
                filters.category === 'mechanical_activity'
                  ? 'Active Filter · Click to clear'
                  : 'Motorized equipment & harmonic noise'
              }
            />
          </div>

          <div
            onClick={() => handleCategoryKpiClick('cultural_sound')}
            className={`transition-all rounded-lg cursor-pointer text-left ${
              filters.category === 'cultural_sound'
                ? 'ring-2 ring-[#788B68] ring-offset-2 ring-offset-[var(--app-bg)]'
                : 'hover:opacity-90'
            }`}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleCategoryKpiClick('cultural_sound');
              }
            }}
            aria-pressed={filters.category === 'cultural_sound'}
            aria-label={`Filter by Cultural Sounds. Total: ${allCategoryCounts.cultural_sound}`}
          >
            <MetricReadout
              label="Cultural Sounds"
              value={allCategoryCounts.cultural_sound}
              accent="moss"
              context={
                filters.category === 'cultural_sound'
                  ? 'Active Filter · Click to clear'
                  : 'Human speech & distant community sound'
              }
            />
          </div>
        </section>

        {/* Filter & Controls Panel */}
        <SurfacePanel className="p-5 space-y-4">
          {/* Row 1: Search & Dropdowns */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            {/* Search Input */}
            <div className="md:col-span-5">
              <label
                htmlFor={searchInputId}
                className="block text-xs font-medium text-[var(--app-text-muted)] mb-1.5"
              >
                Search Disturbance Events
              </label>
              <div className="relative">
                <Search className="w-4 h-4 text-[var(--app-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id={searchInputId}
                  data-testid="disturbance-search-input"
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="e.g. flight, chainsaw, canopy, or ses-2026-1121-a"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-md bg-[var(--app-bg)] border border-[var(--app-border-strong)] text-[var(--app-text)] placeholder:text-[var(--app-text-muted)]/60 focus:outline-none focus:border-[#788B68]"
                />
              </div>
            </div>

            {/* Session Selector */}
            <div className="md:col-span-4">
              <label
                htmlFor={sessionSelectId}
                className="block text-xs font-medium text-[var(--app-text-muted)] mb-1.5"
              >
                Monitoring Session
              </label>
              <select
                id={sessionSelectId}
                data-testid="disturbance-session-select"
                value={filters.sessionId}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, sessionId: e.target.value }))
                }
                className="w-full px-3 py-2 text-sm rounded-md bg-[var(--app-bg)] border border-[var(--app-border-strong)] text-[var(--app-text)] focus:outline-none focus:border-[#788B68]"
              >
                <option value="all">All Sessions</option>
                {sessions.map((s, idx) => (
                  <option key={`${s.id}-${idx}`} value={s.id}>
                    {s.id} · {s.siteName.replace(' (Demo Fixture)', '')}
                  </option>
                ))}
              </select>
            </div>

            {/* Severity Filter */}
            <div className="md:col-span-3">
              <label
                htmlFor={severitySelectId}
                className="block text-xs font-medium text-[var(--app-text-muted)] mb-1.5"
              >
                Severity / Intensity
              </label>
              <select
                id={severitySelectId}
                data-testid="disturbance-severity-select"
                value={filters.severity}
                onChange={(e) =>
                  setFilters((prev) => ({
                    ...prev,
                    severity: e.target.value as DisturbanceSeverity | 'all',
                  }))
                }
                className="w-full px-3 py-2 text-sm rounded-md bg-[var(--app-bg)] border border-[var(--app-border-strong)] text-[var(--app-text)] focus:outline-none focus:border-[#788B68]"
              >
                <option value="all">All Severities</option>
                <option value="elevated">Elevated</option>
                <option value="moderate">Moderate</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          {/* Row 2: Category Pills & Sort Selector */}
          <div className="pt-3 border-t border-[var(--app-border)] flex flex-wrap items-center justify-between gap-4">
            {/* Category Pills */}
            <div
              className="flex flex-wrap items-center gap-2"
              role="group"
              aria-label="Filter by disturbance category"
            >
              <button
                type="button"
                data-testid="category-pill-all"
                onClick={() => setFilters((prev) => ({ ...prev, category: 'all' }))}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  filters.category === 'all'
                    ? 'bg-[#788B68] text-[#101C17] font-semibold'
                    : 'bg-[var(--app-bg)] text-[var(--app-text-secondary)] border border-[var(--app-border)] hover:bg-[var(--app-surface-elevated)]'
                }`}
              >
                All Categories ({allCategoryCounts.total})
              </button>

              {(Object.keys(CATEGORY_META) as DisturbanceCategory[]).map((cat) => {
                const meta = CATEGORY_META[cat];
                const Icon = meta.icon;
                const active = filters.category === cat;
                return (
                  <button
                    key={cat}
                    data-testid={`category-pill-${cat}`}
                    type="button"
                    onClick={() =>
                      setFilters((prev) => ({
                        ...prev,
                        category: prev.category === cat ? 'all' : cat,
                      }))
                    }
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      active
                        ? 'bg-[#788B68] text-[#101C17] font-semibold'
                        : 'bg-[var(--app-bg)] text-[var(--app-text-secondary)] border border-[var(--app-border)] hover:bg-[var(--app-surface-elevated)]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>
                      {meta.label} ({allCategoryCounts[cat]})
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Sort & Reset Actions */}
            <div className="flex items-center gap-3">
              <label
                htmlFor={sortSelectId}
                className="text-xs text-[var(--app-text-muted)] shrink-0"
              >
                Sort:
              </label>
              <select
                id={sortSelectId}
                data-testid="disturbance-sort-select"
                value={`${filters.sortField}_${filters.sortDirection}`}
                onChange={(e) => {
                  const [field, direction] = e.target.value.split('_') as [
                    DisturbanceSortField,
                    'asc' | 'desc',
                  ];
                  setFilters((prev) => ({
                    ...prev,
                    sortField: field,
                    sortDirection: direction,
                  }));
                }}
                className="px-2.5 py-1.5 text-xs rounded-md bg-[var(--app-bg)] border border-[var(--app-border-strong)] text-[var(--app-text)] focus:outline-none focus:border-[#788B68]"
              >
                <option value="timestamp_desc">Newest First</option>
                <option value="timestamp_asc">Oldest First</option>
                <option value="severity_desc">Highest Severity</option>
                <option value="severity_asc">Lowest Severity</option>
                <option value="duration_desc">Longest Duration</option>
                <option value="peakDbfs_desc">Highest Peak dBFS</option>
                <option value="category_asc">Category Name (A–Z)</option>
              </select>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetFilters}
                className="text-xs text-[var(--app-text-muted)] hover:text-[var(--app-text)] flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                Reset
              </Button>
            </div>
          </div>
        </SurfacePanel>

        {/* Invalid Session Warning Banner */}
        {!isSelectedSessionValid && (
          <div className="p-4 rounded-lg bg-[var(--app-amber)]/10 border border-[var(--app-amber)]/30 text-xs text-[var(--app-text)] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[#D3A36C] shrink-0" />
              <span>
                Session identifier <strong className="font-mono">{filters.sessionId}</strong> is not
                currently recorded in available sessions.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setFilters((prev) => ({ ...prev, sessionId: 'all' }))}
              className="text-[#D3A36C] font-semibold hover:underline cursor-pointer shrink-0"
            >
              Clear Session Filter
            </button>
          </div>
        )}

        {/* Event Timeline / Empty States */}
        {isLoading ? (
          <SkeletonPanel className="h-72" />
        ) : sorted.length === 0 ? (
          <EmptyState
            icon={<ShieldAlert className="w-5 h-5" />}
            title="No disturbance events match the active filters"
            description="Adjust your search terms, selected session, category pill, or severity threshold to inspect non-biological events."
            actionLabel="Reset All Filters"
            onAction={handleResetFilters}
          />
        ) : (
          <SurfacePanel as="section" className="p-6">
            <div className="pb-4 border-b border-[var(--app-border)] flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-serif text-2xl font-semibold text-[var(--app-text)]">
                Acoustic Event Timeline
              </h2>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-[var(--app-text-muted)]">
                  Showing {sorted.length} of {disturbances.length} events
                </span>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--app-bg)] border border-[var(--app-border)] text-[#788B68]">
                  DEMO FIXTURES
                </span>
              </div>
            </div>

            <ol className="mt-6 space-y-6" role="list">
              {sorted.map((ev, idx) => {
                const meta = CATEGORY_META[ev.category];
                const Icon = meta.icon;
                return (
                  <li
                    key={`${ev.id || 'dist'}-${idx}`}
                    onClick={() => setInspectedEvent(ev)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setInspectedEvent(ev);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Inspect ${ev.label} disturbance event`}
                    className="grid grid-cols-1 lg:grid-cols-12 gap-4 pb-6 border-b border-[var(--app-border)] last:border-b-0 last:pb-0 hover:bg-[var(--app-surface-elevated)]/30 p-3 -mx-3 rounded-lg transition-colors cursor-pointer group focus:outline-none focus:ring-1 focus:ring-[#788B68]"
                  >
                    {/* Column 1: Time and Session */}
                    <div className="lg:col-span-3 font-mono text-xs tabular-nums text-[var(--app-text-muted)] space-y-1">
                      <div className="text-[var(--app-text-secondary)] font-medium">
                        {formatTimestampDateTime(ev.timestampIso)}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <FileAudio className="w-3.5 h-3.5 text-[#788B68]" />
                        <span>Session {ev.sessionId}</span>
                      </div>
                    </div>

                    {/* Column 2: Event Details */}
                    <div className="lg:col-span-6 space-y-1.5">
                      <div className="flex items-center gap-2.5">
                        <Icon className={`w-4 h-4 shrink-0 ${meta.accentClass}`} />
                        <span className={`text-xs font-medium ${meta.accentClass}`}>
                          {getDisturbanceCategoryLabel(ev.category)}
                        </span>
                        <span aria-hidden="true" className="text-[var(--app-text-muted)]">
                          ·
                        </span>
                        <span className="text-xs capitalize px-1.5 py-0.5 rounded bg-[var(--app-bg)] border border-[var(--app-border)] text-[var(--app-text-secondary)]">
                          {ev.severity} intensity
                        </span>
                      </div>
                      <h3 className="text-base font-medium text-[var(--app-text)] group-hover:text-[#D3A36C] transition-colors">
                        {ev.label}
                      </h3>
                      <p className="text-sm text-[var(--app-text-muted)] leading-relaxed">
                        {ev.description}
                      </p>
                    </div>

                    {/* Column 3: Acoustic Readouts */}
                    <div className="lg:col-span-3 flex lg:flex-col lg:items-end justify-between gap-2 font-mono text-xs tabular-nums">
                      <div>
                        <span className="text-[var(--app-text-muted)] mr-1.5">Peak</span>
                        <span className="text-[#D3A36C] font-semibold">
                          {ev.peakDbfs.toFixed(1)} dBFS
                        </span>
                      </div>
                      <div className="text-[var(--app-text-secondary)]">
                        {ev.frequencyBandHz[0]}–{ev.frequencyBandHz[1]} Hz
                      </div>
                      <div className="text-[var(--app-text-muted)]">
                        Duration {formatDurationSeconds(ev.durationSec)} · Score{' '}
                        {ev.confidenceScore.toFixed(2)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>

            {/* Scientific Caveat Footer */}
            <div className="mt-6 pt-4 border-t border-[var(--app-border)] text-xs text-[var(--app-text-muted)] flex flex-wrap items-center justify-between gap-2 bg-[var(--app-bg)]/40 p-3 rounded">
              <span>
                Note: Non-animal and anthropogenic events reflect acoustic model classifications and
                do not establish illegal intent or proven ecological damage.
              </span>
              <span className="font-mono text-[11px]">ACOUSTIC EVENT RADAR</span>
            </div>
          </SurfacePanel>
        )}
      </div>

      {/* Disturbance Detail Drawer */}
      <DisturbanceDetailDrawer
        event={inspectedEvent}
        session={inspectedSession}
        onClose={() => setInspectedEvent(null)}
      />
    </AppShell>
  );
}
