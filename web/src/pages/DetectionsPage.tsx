import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowUpDown,
  Bird,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  RotateCcw,
  Search,
} from 'lucide-react';
import { DetectionDetailDrawer } from '../components/detections/DetectionDetailDrawer';
import { AppShell } from '../components/layout/AppShell';
import { Button, EmptyState, MetricReadout, SkeletonPanel, SurfacePanel } from '../components/ui/Primitives';
import { useEcoSonic } from '../context/EcoSonicContext';
import { formatTimestampDateTime } from '../lib/acoustics';
import {
  computeDetectionSummary,
  exportDetectionsToCsv,
  exportDetectionsToJson,
  filterDetections,
  paginateItems,
  parseUrlFilterParams,
  serializeUrlFilterParams,
  sortDetections,
  type DetectionFilterState,
  type DetectionSortField,
  type SortDirection,
  type TimeWindowFilter,
} from '../lib/detectionIntelligence';
import type { HabitatPresetId, SpeciesDetection } from '../types/ecosonic';

export function DetectionsPage() {
  const { detections, sessions, isLoading, appearance, audioPrefs } = useEcoSonic();
  const [searchParams, setSearchParams] = useSearchParams();

  // Search input state (with debouncing for URL sync)
  const defaultMinConfidence = audioPrefs.minConfidenceThreshold ?? 0.65;
  const initialFilters = useMemo(
    () => parseUrlFilterParams(searchParams, defaultMinConfidence),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [filters, setFilters] = useState<DetectionFilterState>(initialFilters);
  const [searchInput, setSearchInput] = useState(initialFilters.search);
  const [inspectedDetection, setInspectedDetection] = useState<SpeciesDetection | null>(null);

  // Sync state if URL changes externally (e.g. back/forward navigation)
  const lastSerializedParamsRef = useRef(searchParams.toString());
  useEffect(() => {
    const currentParamsStr = searchParams.toString();
    if (currentParamsStr !== lastSerializedParamsRef.current) {
      lastSerializedParamsRef.current = currentParamsStr;
      const parsed = parseUrlFilterParams(searchParams, defaultMinConfidence);
      setFilters(parsed);
      setSearchInput(parsed.search);
    }
  }, [searchParams, defaultMinConfidence]);

  // Debounced update of filter search from searchInput
  useEffect(() => {
    const handler = setTimeout(() => {
      setFilters((prev) => {
        if (prev.search === searchInput) return prev;
        return { ...prev, search: searchInput, page: 1 };
      });
    }, 200);

    return () => clearTimeout(handler);
  }, [searchInput]);

  // Sync state changes to URL query parameters
  const isFirstSyncRef = useRef(true);
  useEffect(() => {
    if (isFirstSyncRef.current) {
      isFirstSyncRef.current = false;
      return;
    }
    const newParams = serializeUrlFilterParams(filters, defaultMinConfidence);
    const newParamsStr = newParams.toString();
    if (newParamsStr !== searchParams.toString()) {
      lastSerializedParamsRef.current = newParamsStr;
      setSearchParams(newParams, { replace: true });
    }
  }, [filters, defaultMinConfidence, searchParams, setSearchParams]);

  // Filtered & Sorted Data
  const filtered = useMemo(() => filterDetections(detections, filters), [detections, filters]);

  const sorted = useMemo(
    () => sortDetections(filtered, filters.sortField, filters.sortDirection),
    [filtered, filters.sortField, filters.sortDirection]
  );

  // Paginated Data
  const pagination = useMemo(
    () => paginateItems(sorted, filters.page, filters.pageSize),
    [sorted, filters.page, filters.pageSize]
  );

  // Summary Metrics
  const summary = useMemo(() => computeDetectionSummary(filtered), [filtered]);

  // Filter change handlers
  const handleSessionChange = (sessionId: string) => {
    setFilters((prev) => ({ ...prev, sessionId, page: 1 }));
  };

  const handleHabitatChange = (habitatPreset: HabitatPresetId | 'all') => {
    setFilters((prev) => ({ ...prev, habitatPreset, page: 1 }));
  };

  const handleTimeWindowChange = (timeWindow: TimeWindowFilter) => {
    setFilters((prev) => ({ ...prev, timeWindow, page: 1 }));
  };

  const handleCustomDateChange = (start: string, end: string) => {
    setFilters((prev) => ({
      ...prev,
      customStartIso: start,
      customEndIso: end,
      page: 1,
    }));
  };

  const handleConfidenceChange = (minConfidence: number) => {
    setFilters((prev) => ({ ...prev, minConfidence, page: 1 }));
  };

  const handleResetConfidenceToDefault = () => {
    setFilters((prev) => ({ ...prev, minConfidence: defaultMinConfidence, page: 1 }));
  };

  const handleSortChange = (field: DetectionSortField) => {
    setFilters((prev) => {
      if (prev.sortField === field) {
        // Toggle direction
        return {
          ...prev,
          sortDirection: prev.sortDirection === 'asc' ? 'desc' : 'asc',
          page: 1,
        };
      }
      return {
        ...prev,
        sortField: field,
        sortDirection: field === 'commonName' || field === 'scientificName' ? 'asc' : 'desc',
        page: 1,
      };
    });
  };

  const handleResetAllFilters = () => {
    setSearchInput('');
    setFilters({
      search: '',
      sessionId: 'all',
      habitatPreset: 'all',
      minConfidence: defaultMinConfidence,
      timeWindow: 'all',
      customStartIso: '',
      customEndIso: '',
      sortField: 'timestamp',
      sortDirection: 'desc',
      page: 1,
      pageSize: 10,
    });
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  // Export handlers
  const handleExportCsv = () => {
    const csvData = exportDetectionsToCsv(sorted);
    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `ecosonic-detections-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    const jsonData = exportDetectionsToJson(sorted, filters);
    const blob = new Blob([jsonData], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `ecosonic-detections-${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Inspect session lookup
  const inspectedSession = useMemo(() => {
    if (!inspectedDetection) return null;
    return sessions.find((s) => s.id === inspectedDetection.sessionId) ?? null;
  }, [inspectedDetection, sessions]);

  const searchInputId = useId();
  const sessionSelectId = useId();
  const habitatSelectId = useId();
  const timeWindowSelectId = useId();
  const confidenceInputId = useId();
  const pageSizeSelectId = useId();

  return (
    <AppShell
      title="Species Intelligence"
      subtitle="Taxonomic acoustic observations with session provenance and raw model confidence scores"
    >
      <div className="space-y-6">
        {/* Summary Metrics Strip */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricReadout
            label="Matching Detections"
            value={summary.totalCount}
            context="Filtered acoustic observations in view"
          />
          <MetricReadout
            label="Distinct Taxa"
            value={summary.distinctSpeciesCount}
            accent="moss"
            context="Unique biological binomials identified"
          />
          <MetricReadout
            label="Active Sessions"
            value={summary.distinctSessionCount}
            context="Monitored transect sessions represented"
          />
          <MetricReadout
            label="Mean Model Score"
            value={summary.meanConfidenceScore > 0 ? summary.meanConfidenceScore.toFixed(3) : '0.000'}
            context="Raw classifier output (not calibrated probability)"
          />
        </section>

        {/* Filter & Sort Controls Panel */}
        <SurfacePanel className="p-5">
          <div className="space-y-4">
            {/* Primary Filter Row */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
              {/* Search */}
              <div className="md:col-span-4">
                <label
                  htmlFor={searchInputId}
                  className="block text-xs font-medium text-[var(--app-text-muted)] mb-1.5"
                >
                  Search Species, Taxon, or ID
                </label>
                <div className="relative">
                  <Search className="w-4 h-4 text-[var(--app-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id={searchInputId}
                    data-testid="species-search-input"
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="e.g. Troglodytes, Wren, or det-demo-101"
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-md bg-[var(--app-bg)] border border-[var(--app-border-strong)] text-[var(--app-text)] placeholder:text-[var(--app-text-muted)]/60 focus:outline-none focus:border-[#788B68]"
                  />
                </div>
              </div>

              {/* Session Selector */}
              <div className="md:col-span-3">
                <label
                  htmlFor={sessionSelectId}
                  className="block text-xs font-medium text-[var(--app-text-muted)] mb-1.5"
                >
                  Monitoring Session
                </label>
                <select
                  id={sessionSelectId}
                  data-testid="session-filter-select"
                  value={filters.sessionId}
                  onChange={(e) => handleSessionChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md bg-[var(--app-bg)] border border-[var(--app-border-strong)] text-[var(--app-text)] focus:outline-none focus:border-[#788B68]"
                >
                  <option value="all">All Sessions</option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id} · {s.siteName.replace(' (Demo Fixture)', '')}
                    </option>
                  ))}
                </select>
              </div>

              {/* Habitat Station Selector */}
              <div className="md:col-span-3">
                <label
                  htmlFor={habitatSelectId}
                  className="block text-xs font-medium text-[var(--app-text-muted)] mb-1.5"
                >
                  Habitat Station
                </label>
                <select
                  id={habitatSelectId}
                  data-testid="habitat-filter-select"
                  value={filters.habitatPreset}
                  onChange={(e) =>
                    handleHabitatChange(e.target.value as HabitatPresetId | 'all')
                  }
                  className="w-full px-3 py-2 text-sm rounded-md bg-[var(--app-bg)] border border-[var(--app-border-strong)] text-[var(--app-text)] focus:outline-none focus:border-[#788B68]"
                >
                  <option value="all">All Habitats</option>
                  <option value="temperate-rainforest">Temperate Rainforest (Hoh Canopy)</option>
                  <option value="boreal-wetland">Boreal Wetland (Karelian Fen)</option>
                  <option value="subalpine-ridge">Subalpine Ridge (Cascade Timberline)</option>
                </select>
              </div>

              {/* Time Window Selector */}
              <div className="md:col-span-2">
                <label
                  htmlFor={timeWindowSelectId}
                  className="block text-xs font-medium text-[var(--app-text-muted)] mb-1.5"
                >
                  Time Window
                </label>
                <select
                  id={timeWindowSelectId}
                  data-testid="timewindow-filter-select"
                  value={filters.timeWindow}
                  onChange={(e) => handleTimeWindowChange(e.target.value as TimeWindowFilter)}
                  className="w-full px-3 py-2 text-sm rounded-md bg-[var(--app-bg)] border border-[var(--app-border-strong)] text-[var(--app-text)] focus:outline-none focus:border-[#788B68]"
                >
                  <option value="all">All Time</option>
                  <option value="1h">Last 1 Hour</option>
                  <option value="24h">Last 24 Hours</option>
                  <option value="custom">Custom Range</option>
                </select>
              </div>
            </div>

            {/* Custom Date Bounds (when timeWindow === 'custom') */}
            {filters.timeWindow === 'custom' && (
              <div className="p-3 rounded-md bg-[var(--app-bg)] border border-[var(--app-border)] grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--app-text-muted)] mb-1">
                    Start Timestamp (ISO or YYYY-MM-DDTHH:MM)
                  </label>
                  <input
                    type="datetime-local"
                    value={filters.customStartIso ? filters.customStartIso.slice(0, 16) : ''}
                    onChange={(e) =>
                      handleCustomDateChange(
                        e.target.value ? new Date(e.target.value).toISOString() : '',
                        filters.customEndIso
                      )
                    }
                    className="w-full px-3 py-1.5 text-xs rounded bg-[var(--app-surface)] border border-[var(--app-border)] text-[var(--app-text)] focus:outline-none focus:border-[#788B68]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--app-text-muted)] mb-1">
                    End Timestamp (ISO or YYYY-MM-DDTHH:MM)
                  </label>
                  <input
                    type="datetime-local"
                    value={filters.customEndIso ? filters.customEndIso.slice(0, 16) : ''}
                    onChange={(e) =>
                      handleCustomDateChange(
                        filters.customStartIso,
                        e.target.value ? new Date(e.target.value).toISOString() : ''
                      )
                    }
                    className="w-full px-3 py-1.5 text-xs rounded bg-[var(--app-surface)] border border-[var(--app-border)] text-[var(--app-text)] focus:outline-none focus:border-[#788B68]"
                  />
                </div>
              </div>
            )}

            {/* Secondary Controls: Minimum Model Score Slider & Actions */}
            <div className="pt-2 border-t border-[var(--app-border)] flex flex-wrap items-center justify-between gap-4">
              <div className="flex-1 min-w-[260px] max-w-md">
                <div className="flex items-center justify-between text-xs font-medium text-[var(--app-text-muted)] mb-1.5">
                  <label htmlFor={confidenceInputId} className="flex items-center gap-2">
                    <span>Min Model Score</span>
                    <span className="font-mono tabular-nums text-[var(--app-text)] text-xs font-bold">
                      {filters.minConfidence.toFixed(2)}
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={handleResetConfidenceToDefault}
                    className="text-[11px] text-[#788B68] hover:underline flex items-center gap-1 cursor-pointer"
                    title={`Restore default configured threshold (${defaultMinConfidence.toFixed(2)})`}
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reset to default ({defaultMinConfidence.toFixed(2)})
                  </button>
                </div>
                <input
                  id={confidenceInputId}
                  type="range"
                  min={0}
                  max={0.95}
                  step={0.05}
                  value={filters.minConfidence}
                  onChange={(e) => handleConfidenceChange(Number(e.target.value))}
                  className="w-full accent-[#788B68] cursor-pointer"
                />
              </div>

              {/* Action Buttons: Export CSV / JSON & Clear Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleExportCsv}
                  disabled={sorted.length === 0}
                  className="flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5 text-[#788B68]" />
                  Export CSV ({sorted.length})
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleExportJson}
                  disabled={sorted.length === 0}
                  className="flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5 text-[#788B68]" />
                  Export JSON
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResetAllFilters}
                  className="text-xs text-[var(--app-text-muted)] hover:text-[var(--app-text)]"
                >
                  Reset All Filters
                </Button>
              </div>
            </div>
          </div>
        </SurfacePanel>

        {/* Detections Table Section */}
        {isLoading ? (
          <SkeletonPanel className="h-72" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Bird className="w-5 h-5" />}
            title="No species detections match these filters"
            description="Adjust the search query, minimum confidence threshold, session, or habitat station filter to view observations."
            actionLabel="Reset All Filters"
            onAction={handleResetAllFilters}
          />
        ) : (
          <SurfacePanel className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse" role="table">
                <thead>
                  <tr className="border-b border-[var(--app-border)] text-xs font-mono text-[var(--app-text-muted)] bg-[var(--app-bg)]/40">
                    <th className="py-3 px-5 font-medium">
                      <button
                        type="button"
                        onClick={() =>
                          handleSortChange(
                            appearance.showScientificNamesFirst ? 'scientificName' : 'commonName'
                          )
                        }
                        className="flex items-center gap-1 hover:text-[var(--app-text)] transition-colors cursor-pointer group"
                      >
                        <span>Species</span>
                        {filters.sortField === 'commonName' ||
                        filters.sortField === 'scientificName' ? (
                          filters.sortDirection === 'asc' ? (
                            <ChevronUp className="w-3.5 h-3.5 text-[#788B68]" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-[#788B68]" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                        )}
                      </button>
                    </th>
                    <th className="py-3 px-5 font-medium">
                      <button
                        type="button"
                        onClick={() =>
                          handleSortChange(
                            appearance.showScientificNamesFirst ? 'commonName' : 'scientificName'
                          )
                        }
                        className="flex items-center gap-1 hover:text-[var(--app-text)] transition-colors cursor-pointer group"
                      >
                        <span>Binomial Nomenclature</span>
                        {filters.sortField === 'scientificName' ? (
                          filters.sortDirection === 'asc' ? (
                            <ChevronUp className="w-3.5 h-3.5 text-[#788B68]" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-[#788B68]" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                        )}
                      </button>
                    </th>
                    <th className="py-3 px-5 font-medium">
                      <button
                        type="button"
                        onClick={() => handleSortChange('timestamp')}
                        className="flex items-center gap-1 hover:text-[var(--app-text)] transition-colors cursor-pointer group"
                      >
                        <span>Timestamp (UTC)</span>
                        {filters.sortField === 'timestamp' ? (
                          filters.sortDirection === 'asc' ? (
                            <ChevronUp className="w-3.5 h-3.5 text-[#788B68]" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-[#788B68]" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                        )}
                      </button>
                    </th>
                    <th className="py-3 px-5 font-medium">
                      <button
                        type="button"
                        onClick={() => handleSortChange('duration')}
                        className="flex items-center gap-1 hover:text-[var(--app-text)] transition-colors cursor-pointer group"
                      >
                        <span>Duration</span>
                        {filters.sortField === 'duration' ? (
                          filters.sortDirection === 'asc' ? (
                            <ChevronUp className="w-3.5 h-3.5 text-[#788B68]" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-[#788B68]" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                        )}
                      </button>
                    </th>
                    <th className="py-3 px-5 font-medium">Frequency Band</th>
                    <th className="py-3 px-5 font-medium">Session / Station</th>
                    <th className="py-3 px-5 font-medium text-right">
                      <button
                        type="button"
                        onClick={() => handleSortChange('confidence')}
                        className="flex items-center gap-1 justify-end ml-auto hover:text-[var(--app-text)] transition-colors cursor-pointer group"
                      >
                        <span>Model Score</span>
                        {filters.sortField === 'confidence' ? (
                          filters.sortDirection === 'asc' ? (
                            <ChevronUp className="w-3.5 h-3.5 text-[#788B68]" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-[#788B68]" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                        )}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--app-border)] text-sm">
                  {pagination.items.map((det) => (
                    <tr
                      key={det.id}
                      onClick={() => setInspectedDetection(det)}
                      className="hover:bg-[var(--app-surface-elevated)]/40 transition-colors cursor-pointer group focus-within:bg-[var(--app-surface-elevated)]/40"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setInspectedDetection(det);
                        }
                      }}
                      role="button"
                      aria-label={`View details for ${det.commonName}`}
                    >
                      <td className="py-3 px-5 font-medium text-[var(--app-text)] whitespace-nowrap group-hover:text-[#788B68] transition-colors">
                        {appearance.showScientificNamesFirst ? det.scientificName : det.commonName}
                      </td>
                      <td className="py-3 px-5 italic text-[var(--app-text-secondary)] whitespace-nowrap">
                        {appearance.showScientificNamesFirst ? det.commonName : det.scientificName}
                      </td>
                      <td className="py-3 px-5 font-mono text-xs tabular-nums text-[var(--app-text-muted)] whitespace-nowrap">
                        {formatTimestampDateTime(det.timestampIso)}
                      </td>
                      <td className="py-3 px-5 font-mono text-xs tabular-nums text-[var(--app-text-muted)] whitespace-nowrap">
                        {det.durationSec.toFixed(1)}s
                      </td>
                      <td className="py-3 px-5 font-mono text-xs tabular-nums text-[var(--app-text-secondary)] whitespace-nowrap">
                        {det.frequencyRangeHz[0]}–{det.frequencyRangeHz[1]} Hz
                      </td>
                      <td className="py-3 px-5 font-mono text-xs text-[var(--app-text-muted)] whitespace-nowrap">
                        <span>{det.sessionId}</span>
                        <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-[var(--app-bg)] border border-[var(--app-border)]">
                          {det.habitatPreset}
                        </span>
                      </td>
                      <td className="py-3 px-5 text-right font-mono tabular-nums font-semibold text-[#788B68] whitespace-nowrap">
                        {det.confidenceScore.toFixed(3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="px-5 py-3 border-t border-[var(--app-border)] bg-[var(--app-bg)]/30 flex flex-wrap items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-3">
                <span className="text-[var(--app-text-muted)]">
                  Showing{' '}
                  <span className="font-mono text-[var(--app-text)]">
                    {Math.min(
                      (pagination.page - 1) * pagination.pageSize + 1,
                      pagination.totalItems
                    )}
                  </span>{' '}
                  to{' '}
                  <span className="font-mono text-[var(--app-text)]">
                    {Math.min(pagination.page * pagination.pageSize, pagination.totalItems)}
                  </span>{' '}
                  of{' '}
                  <span className="font-mono font-medium text-[var(--app-text)]">
                    {pagination.totalItems}
                  </span>{' '}
                  detections
                </span>

                <div className="flex items-center gap-1.5 ml-2 border-l border-[var(--app-border)] pl-3">
                  <label htmlFor={pageSizeSelectId} className="text-[var(--app-text-muted)]">
                    Per page:
                  </label>
                  <select
                    id={pageSizeSelectId}
                    value={filters.pageSize}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        pageSize: Number(e.target.value),
                        page: 1,
                      }))
                    }
                    className="px-2 py-1 rounded bg-[var(--app-surface)] border border-[var(--app-border)] text-[var(--app-text)] focus:outline-none focus:border-[#788B68]"
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="font-mono text-[var(--app-text-muted)] mr-2">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setFilters((prev) => ({
                      ...prev,
                      page: Math.max(1, prev.page - 1),
                    }))
                  }
                  disabled={pagination.page <= 1}
                  aria-label="Previous Page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setFilters((prev) => ({
                      ...prev,
                      page: Math.min(pagination.totalPages, prev.page + 1),
                    }))
                  }
                  disabled={pagination.page >= pagination.totalPages}
                  aria-label="Next Page"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Scientific Caveat Footer */}
            <div className="px-5 py-2.5 border-t border-[var(--app-border)] text-xs text-[var(--app-text-muted)] flex flex-wrap items-center justify-between gap-2 bg-[var(--app-bg)]/60">
              <span>
                Note: Model confidence scores represent raw acoustic classifier similarity and are
                not calibrated detection probabilities.
              </span>
              <span className="font-mono text-[11px]">DEMO FIXTURES</span>
            </div>
          </SurfacePanel>
        )}
      </div>

      {/* Detection Detail Slide-over Drawer */}
      <DetectionDetailDrawer
        detection={inspectedDetection}
        session={inspectedSession}
        showScientificNamesFirst={appearance.showScientificNamesFirst}
        onClose={() => setInspectedDetection(null)}
      />
    </AppShell>
  );
}
