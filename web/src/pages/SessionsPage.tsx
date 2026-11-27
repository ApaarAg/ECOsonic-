import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  ExternalLink,
  History,
  MapPin,
  RotateCcw,
  Search,
} from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { Button, EmptyState, MetricReadout, SkeletonPanel, SurfacePanel } from '../components/ui/Primitives';
import { useEcoSonic } from '../context/EcoSonicContext';
import { formatDurationSeconds, formatTimestampDateTime } from '../lib/acoustics';
import {
  filterSessions,
  inferHabitatPresetFromSession,
  paginateSessions,
  parseSessionUrlParams,
  serializeSessionUrlParams,
  sortSessions,
  type SessionFilterState,
  type SessionSortField,
} from '../lib/sessionIntelligence';
import type { HabitatPresetId, MonitoringStatus } from '../types/ecosonic';

export function SessionsPage() {
  const { sessions, isLoading } = useEcoSonic();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Initial URL hydration
  const initialFilters = useMemo(
    () => parseSessionUrlParams(searchParams),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [filters, setFilters] = useState<SessionFilterState>(initialFilters);
  const [searchInput, setSearchInput] = useState(initialFilters.search);

  // Selected session for inspector panel
  const sessionQueryId = searchParams.get('session');
  const [selectedId, setSelectedId] = useState<string | null>(sessionQueryId);

  // Sync state if URL changes externally (e.g. Back/Forward)
  const lastSerializedParamsRef = useRef(searchParams.toString());
  useEffect(() => {
    const currentStr = searchParams.toString();
    if (currentStr !== lastSerializedParamsRef.current) {
      lastSerializedParamsRef.current = currentStr;
      const parsed = parseSessionUrlParams(searchParams);
      setFilters(parsed);
      setSearchInput(parsed.search);
      const qSession = searchParams.get('session');
      if (qSession) {
        setSelectedId(qSession);
      }
    }
  }, [searchParams]);

  // Debounced search input sync
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev) => {
        if (prev.search === searchInput) return prev;
        return { ...prev, search: searchInput, page: 1 };
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Sync state changes to URL query parameters
  const isFirstSyncRef = useRef(true);
  useEffect(() => {
    if (isFirstSyncRef.current) {
      isFirstSyncRef.current = false;
      return;
    }
    const newParams = serializeSessionUrlParams(filters, selectedId, searchParams);
    const newParamsStr = newParams.toString();
    if (newParamsStr !== searchParams.toString()) {
      lastSerializedParamsRef.current = newParamsStr;
      setSearchParams(newParams, { replace: true });
    }
  }, [filters, selectedId, searchParams, setSearchParams]);

  // Filtered & Sorted Sessions
  const filtered = useMemo(() => filterSessions(sessions, filters), [sessions, filters]);

  const sorted = useMemo(
    () => sortSessions(filtered, filters.sortField, filters.sortDirection),
    [filtered, filters.sortField, filters.sortDirection]
  );

  // Paginated Sessions
  const pagination = useMemo(
    () => paginateSessions(sorted, filters.page, filters.pageSize),
    [sorted, filters.page, filters.pageSize]
  );

  // Active inspected session
  const activeSession = useMemo(() => {
    if (selectedId) {
      const match = sessions.find((s) => s.id === selectedId);
      if (match) return match;
    }
    return sorted[0] ?? sessions[0] ?? null;
  }, [selectedId, sessions, sorted]);

  // Reset filters
  const handleResetFilters = () => {
    setSearchInput('');
    setFilters({
      search: '',
      status: 'all',
      habitat: 'all',
      sortField: 'startedAt',
      sortDirection: 'desc',
      page: 1,
      pageSize: 10,
    });
    setSelectedId(null);
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const searchInputId = useId();
  const statusSelectId = useId();
  const habitatSelectId = useId();
  const sortSelectId = useId();

  return (
    <AppShell
      title="Session History"
      subtitle="Archived and active monitoring sessions with species, disturbance, and soundscape summaries"
    >
      <div className="space-y-6">
        {/* Filter & Search Toolbar */}
        <SurfacePanel className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            {/* Search */}
            <div className="md:col-span-4">
              <label
                htmlFor={searchInputId}
                className="block text-xs font-medium text-[var(--app-text-muted)] mb-1.5"
              >
                Search Sessions
              </label>
              <div className="relative">
                <Search className="w-4 h-4 text-[var(--app-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id={searchInputId}
                  data-testid="session-search-input"
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="e.g. Hoh, Karelian, or ses-2026-1121-a"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-md bg-[var(--app-bg)] border border-[var(--app-border-strong)] text-[var(--app-text)] placeholder:text-[var(--app-text-muted)]/60 focus:outline-none focus:border-[#788B68]"
                />
              </div>
            </div>

            {/* Status Filter */}
            <div className="md:col-span-3">
              <label
                htmlFor={statusSelectId}
                className="block text-xs font-medium text-[var(--app-text-muted)] mb-1.5"
              >
                Recording Status
              </label>
              <select
                id={statusSelectId}
                data-testid="session-status-select"
                value={filters.status}
                onChange={(e) =>
                  setFilters((prev) => ({
                    ...prev,
                    status: e.target.value as MonitoringStatus | 'all',
                    page: 1,
                  }))
                }
                className="w-full px-3 py-2 text-sm rounded-md bg-[var(--app-bg)] border border-[var(--app-border-strong)] text-[var(--app-text)] focus:outline-none focus:border-[#788B68]"
              >
                <option value="all">All Statuses</option>
                <option value="streaming">Demo Streaming (Active)</option>
                <option value="completed">Completed</option>
                <option value="calibrating">Calibrating</option>
                <option value="idle">Idle</option>
              </select>
            </div>

            {/* Habitat Preset Filter */}
            <div className="md:col-span-3">
              <label
                htmlFor={habitatSelectId}
                className="block text-xs font-medium text-[var(--app-text-muted)] mb-1.5"
              >
                Habitat Station
              </label>
              <select
                id={habitatSelectId}
                data-testid="session-habitat-select"
                value={filters.habitat}
                onChange={(e) =>
                  setFilters((prev) => ({
                    ...prev,
                    habitat: e.target.value as HabitatPresetId | 'all',
                    page: 1,
                  }))
                }
                className="w-full px-3 py-2 text-sm rounded-md bg-[var(--app-bg)] border border-[var(--app-border-strong)] text-[var(--app-text)] focus:outline-none focus:border-[#788B68]"
              >
                <option value="all">All Habitats</option>
                <option value="temperate-rainforest">Temperate Rainforest (Hoh Canopy)</option>
                <option value="boreal-wetland">Boreal Wetland (Karelian Fen)</option>
                <option value="subalpine-ridge">Subalpine Ridge (Cascade Timberline)</option>
              </select>
            </div>

            {/* Sort Dropdown */}
            <div className="md:col-span-2">
              <label
                htmlFor={sortSelectId}
                className="block text-xs font-medium text-[var(--app-text-muted)] mb-1.5"
              >
                Sort By
              </label>
              <select
                id={sortSelectId}
                data-testid="session-sort-select"
                value={`${filters.sortField}_${filters.sortDirection}`}
                onChange={(e) => {
                  const [field, direction] = e.target.value.split('_') as [
                    SessionSortField,
                    'asc' | 'desc',
                  ];
                  setFilters((prev) => ({
                    ...prev,
                    sortField: field,
                    sortDirection: direction,
                    page: 1,
                  }));
                }}
                className="w-full px-2.5 py-2 text-sm rounded-md bg-[var(--app-bg)] border border-[var(--app-border-strong)] text-[var(--app-text)] focus:outline-none focus:border-[#788B68]"
              >
                <option value="startedAt_desc">Newest First</option>
                <option value="startedAt_asc">Oldest First</option>
                <option value="duration_desc">Longest Duration</option>
                <option value="duration_asc">Shortest Duration</option>
                <option value="detections_desc">Most Detections</option>
                <option value="title_asc">Title (A–Z)</option>
              </select>
            </div>
          </div>
        </SurfacePanel>

        {/* Content View / Empty State */}
        {isLoading ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <SkeletonPanel className="lg:col-span-5 h-80" />
            <SkeletonPanel className="lg:col-span-7 h-80" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<History className="w-5 h-5" />}
            title="No monitoring sessions match the active filters"
            description="Adjust your search terms or status and habitat filters to inspect sessions."
            actionLabel="Reset All Filters"
            onAction={handleResetFilters}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Session List Column */}
            <SurfacePanel as="section" className="lg:col-span-5 divide-y divide-[var(--app-border)]">
              <div className="p-5 flex items-center justify-between">
                <h2 className="font-serif text-xl font-semibold text-[var(--app-text)]">
                  Recorded Sessions
                </h2>
                <span className="text-xs font-mono text-[var(--app-text-muted)]">
                  Showing {pagination.items.length} of {filtered.length}
                </span>
              </div>

              {pagination.items.map((session) => {
                const selected = activeSession?.id === session.id;
                return (
                  <button
                    key={session.id}
                    data-testid={`session-item-${session.id}`}
                    type="button"
                    onClick={() => setSelectedId(session.id)}
                    className={`w-full text-left p-5 transition-colors cursor-pointer ${
                      selected
                        ? 'bg-[var(--app-surface-elevated)]/70'
                        : 'hover:bg-[var(--app-surface-elevated)]/30'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono text-[var(--app-text-muted)]">{session.id}</span>
                      <span
                        className={`font-mono capitalize ${
                          session.status === 'streaming'
                            ? 'text-[#788B68]'
                            : 'text-[var(--app-text-muted)]'
                        }`}
                      >
                        {session.status === 'streaming' ? 'Demo Streaming' : session.status}
                      </span>
                    </div>

                    <div className="mt-1.5 text-sm font-medium text-[var(--app-text)]">
                      {session.title}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--app-text-muted)]">
                      <span>{formatTimestampDateTime(session.startedAtIso)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {formatDurationSeconds(session.durationSec)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{session.speciesDetectionCount} detections</span>
                    </div>
                  </button>
                );
              })}
            </SurfacePanel>

            {/* Session Inspector Column */}
            {activeSession && (
              <SurfacePanel as="section" className="lg:col-span-7 p-6 space-y-6">
                <div className="pb-5 border-b border-[var(--app-border)] flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-mono text-[#D3A36C]">
                      <span>{activeSession.id}</span>
                      <span aria-hidden="true">·</span>
                      <span className="uppercase">
                        {activeSession.status === 'streaming'
                          ? 'Demo Stream Active'
                          : activeSession.status}
                      </span>
                    </div>
                    <h2 className="mt-2 font-serif text-2xl sm:text-3xl font-semibold text-[var(--app-text)]">
                      {activeSession.title}
                    </h2>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--app-text-muted)]">
                      <MapPin className="w-3.5 h-3.5 text-[#788B68]" />
                      <span>{activeSession.siteName}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{activeSession.coordinatesLabel}</span>
                    </div>
                  </div>

                  {/* Primary CTA: Dedicated Session Details Page */}
                  <div className="flex flex-col sm:items-end gap-2 shrink-0">
                    <Link
                      to={`/app/sessions/${encodeURIComponent(activeSession.id)}`}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#788B68] text-[#101C17] text-xs font-semibold hover:bg-[#899D78] transition-colors whitespace-nowrap shadow-sm"
                    >
                      <span>Open Full Session Details</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                    <div className="flex items-center gap-2 text-xs">
                      <Link
                        to={`/app/detections?session=${encodeURIComponent(activeSession.id)}`}
                        className="text-[#788B68] hover:underline"
                      >
                        Species ({activeSession.speciesDetectionCount})
                      </Link>
                      <span aria-hidden="true" className="text-[var(--app-text-muted)]">·</span>
                      <Link
                        to={`/app/disturbances?session=${encodeURIComponent(activeSession.id)}`}
                        className="text-[#D3A36C] hover:underline"
                      >
                        Disturbances ({activeSession.disturbanceEventCount})
                      </Link>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-4 rounded-md bg-[var(--app-bg)] border border-[var(--app-border)]">
                    <div className="text-xs text-[var(--app-text-muted)]">Duration</div>
                    <div className="mt-1.5 text-xl font-mono font-medium tabular-nums text-[var(--app-text)]">
                      {formatDurationSeconds(activeSession.durationSec)}
                    </div>
                  </div>
                  <div className="p-4 rounded-md bg-[var(--app-bg)] border border-[var(--app-border)]">
                    <div className="text-xs text-[var(--app-text-muted)]">Species Detections</div>
                    <div className="mt-1.5 flex items-baseline gap-1.5">
                      <span className="text-xl font-mono font-medium tabular-nums text-[#788B68]">
                        {activeSession.speciesDetectionCount}
                      </span>
                      <span className="text-xs font-mono text-[var(--app-text-muted)]">
                        {activeSession.distinctSpeciesCount} taxa
                      </span>
                    </div>
                  </div>
                  <div className="p-4 rounded-md bg-[var(--app-bg)] border border-[var(--app-border)]">
                    <div className="text-xs text-[var(--app-text-muted)]">Disturbance Events</div>
                    <div className="mt-1.5 text-xl font-mono font-medium tabular-nums text-[var(--app-amber)]">
                      {activeSession.disturbanceEventCount}
                    </div>
                  </div>
                  <div className="p-4 rounded-md bg-[var(--app-bg)] border border-[var(--app-border)]">
                    <div className="text-xs text-[var(--app-text-muted)]">Sample Rate</div>
                    <div className="mt-1.5 flex items-baseline gap-1">
                      <span className="text-xl font-mono font-medium tabular-nums text-[var(--app-text)]">
                        {(activeSession.sampleRateHz / 1000).toFixed(1)}
                      </span>
                      <span className="text-xs font-mono text-[var(--app-text-muted)]">kHz</span>
                    </div>
                  </div>
                </div>

                <div className="pt-2">
                  <h3 className="text-xs font-mono uppercase tracking-wider text-[var(--app-text-muted)] mb-3">
                    Soundscape Summary
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-md bg-[var(--app-bg)] border border-[var(--app-border)] text-sm">
                    <div>
                      <div className="text-xs text-[var(--app-text-muted)]">Mean ACI</div>
                      <div className="mt-1 font-mono tabular-nums text-[var(--app-text)]">
                        {activeSession.soundscapeSummary.aciMean.toFixed(1)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--app-text-muted)]">Mean NDSI</div>
                      <div className="mt-1 font-mono tabular-nums text-[#788B68]">
                        +{activeSession.soundscapeSummary.ndsiMean.toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--app-text-muted)]">Mean Entropy</div>
                      <div className="mt-1 font-mono tabular-nums text-[var(--app-text)]">
                        {activeSession.soundscapeSummary.spectralEntropyMean.toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--app-text-muted)]">Dominant Band</div>
                      <div className="mt-1 font-mono tabular-nums text-[var(--app-text)]">
                        {activeSession.soundscapeSummary.dominantBandHz}
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-mono uppercase tracking-wider text-[var(--app-text-muted)] mb-1.5">
                    Field Notes
                  </h3>
                  <p className="text-sm text-[var(--app-text-secondary)] leading-relaxed">
                    {activeSession.notes}
                  </p>
                </div>
              </SurfacePanel>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
