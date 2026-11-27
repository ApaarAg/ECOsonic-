import type { HabitatPresetId, SpeciesDetection } from '../types/ecosonic';

export type TimeWindowFilter = 'all' | '1h' | '24h' | 'custom';
export type DetectionSortField = 'timestamp' | 'commonName' | 'scientificName' | 'confidence' | 'duration';
export type SortDirection = 'asc' | 'desc';

export interface DetectionFilterState {
  search: string;
  sessionId: string;
  habitatPreset: HabitatPresetId | 'all';
  minConfidence: number;
  timeWindow: TimeWindowFilter;
  customStartIso: string;
  customEndIso: string;
  sortField: DetectionSortField;
  sortDirection: SortDirection;
  page: number;
  pageSize: number;
}

export interface DetectionSummaryMetrics {
  totalCount: number;
  distinctSpeciesCount: number;
  distinctSessionCount: number;
  meanConfidenceScore: number;
}

export interface PaginationResult<T> {
  items: T[];
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Filter species detections with robust handling of search, session, habitat, time, and confidence.
 */
export function filterDetections(
  detections: readonly SpeciesDetection[],
  filters: Partial<DetectionFilterState>,
  referenceTimeMs: number = Date.now()
): SpeciesDetection[] {
  const {
    search = '',
    sessionId = 'all',
    habitatPreset = 'all',
    minConfidence = 0,
    timeWindow = 'all',
    customStartIso = '',
    customEndIso = '',
  } = filters;

  const normalizedQuery = search.trim().toLowerCase();
  const safeMinConfidence = Number.isFinite(minConfidence) ? Math.max(0, Math.min(1, minConfidence)) : 0;

  // Pre-calculate time window boundaries
  let windowStartMs = -Infinity;
  let windowEndMs = Infinity;

  if (timeWindow === '1h') {
    windowStartMs = referenceTimeMs - 3600 * 1000;
    windowEndMs = referenceTimeMs;
  } else if (timeWindow === '24h') {
    windowStartMs = referenceTimeMs - 24 * 3600 * 1000;
    windowEndMs = referenceTimeMs;
  } else if (timeWindow === 'custom') {
    if (customStartIso) {
      const parsedStart = Date.parse(customStartIso);
      if (Number.isFinite(parsedStart)) {
        windowStartMs = parsedStart;
      }
    }
    if (customEndIso) {
      const parsedEnd = Date.parse(customEndIso);
      if (Number.isFinite(parsedEnd)) {
        windowEndMs = parsedEnd;
      }
    }
  }

  return detections.filter((det) => {
    // Session match
    if (sessionId !== 'all' && det.sessionId !== sessionId) {
      return false;
    }

    // Habitat preset match
    if (habitatPreset !== 'all' && det.habitatPreset !== habitatPreset) {
      return false;
    }

    // Confidence threshold (handling missing or NaN values safely)
    const score = Number.isFinite(det.confidenceScore) ? det.confidenceScore : 0;
    if (score < safeMinConfidence) {
      return false;
    }

    // Timestamp verification
    const timestampMs = Date.parse(det.timestampIso);
    if (!Number.isFinite(timestampMs)) {
      return false;
    }
    if (timestampMs < windowStartMs || timestampMs > windowEndMs) {
      return false;
    }

    // Multi-field search match
    if (normalizedQuery.length > 0) {
      const commonMatch = det.commonName.toLowerCase().includes(normalizedQuery);
      const sciMatch = det.scientificName.toLowerCase().includes(normalizedQuery);
      const idMatch = det.id.toLowerCase().includes(normalizedQuery);
      const sessionMatch = det.sessionId.toLowerCase().includes(normalizedQuery);
      if (!commonMatch && !sciMatch && !idMatch && !sessionMatch) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Sort species detections deterministically by field and direction.
 */
export function sortDetections(
  detections: readonly SpeciesDetection[],
  field: DetectionSortField,
  direction: SortDirection
): SpeciesDetection[] {
  const sorted = [...detections];
  const mult = direction === 'asc' ? 1 : -1;

  sorted.sort((a, b) => {
    let diff = 0;
    switch (field) {
      case 'timestamp': {
        const timeA = Date.parse(a.timestampIso) || 0;
        const timeB = Date.parse(b.timestampIso) || 0;
        diff = timeA - timeB;
        break;
      }
      case 'commonName':
        diff = a.commonName.localeCompare(b.commonName);
        break;
      case 'scientificName':
        diff = a.scientificName.localeCompare(b.scientificName);
        break;
      case 'confidence':
        diff = (a.confidenceScore ?? 0) - (b.confidenceScore ?? 0);
        break;
      case 'duration':
        diff = (a.durationSec ?? 0) - (b.durationSec ?? 0);
        break;
    }

    if (diff !== 0) {
      return mult * diff;
    }

    // Deterministic tie-breaker
    return a.id.localeCompare(b.id);
  });

  return sorted;
}

/**
 * Paginate items with safe boundary and page clamping.
 */
export function paginateItems<T>(
  items: readonly T[],
  page: number,
  pageSize: number
): PaginationResult<T> {
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 10;
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const clampedPage = Math.max(1, Math.min(page, totalPages));

  const startIndex = (clampedPage - 1) * safePageSize;
  const slicedItems = items.slice(startIndex, startIndex + safePageSize);

  return {
    items: slicedItems,
    totalItems,
    page: clampedPage,
    pageSize: safePageSize,
    totalPages,
  };
}

/**
 * Compute summary metrics for a filtered set of species detections.
 */
export function computeDetectionSummary(
  filteredDetections: readonly SpeciesDetection[]
): DetectionSummaryMetrics {
  const totalCount = filteredDetections.length;
  if (totalCount === 0) {
    return {
      totalCount: 0,
      distinctSpeciesCount: 0,
      distinctSessionCount: 0,
      meanConfidenceScore: 0,
    };
  }

  const speciesSet = new Set<string>();
  const sessionSet = new Set<string>();
  let scoreSum = 0;
  let validScoreCount = 0;

  for (const item of filteredDetections) {
    if (item.scientificName) {
      speciesSet.add(item.scientificName);
    }
    if (item.sessionId) {
      sessionSet.add(item.sessionId);
    }
    if (Number.isFinite(item.confidenceScore)) {
      scoreSum += item.confidenceScore;
      validScoreCount += 1;
    }
  }

  return {
    totalCount,
    distinctSpeciesCount: speciesSet.size,
    distinctSessionCount: sessionSet.size,
    meanConfidenceScore: validScoreCount > 0 ? scoreSum / validScoreCount : 0,
  };
}

/**
 * Generate RFC 4180 compliant CSV content from a detection slice.
 */
export function exportDetectionsToCsv(detections: readonly SpeciesDetection[]): string {
  const headers = [
    'Detection ID',
    'Common Name',
    'Scientific Name',
    'Timestamp (UTC)',
    'Model Confidence Score',
    'Duration (s)',
    'Frequency Low (Hz)',
    'Frequency High (Hz)',
    'Session ID',
    'Habitat Preset',
  ];

  const escapeCell = (value: unknown): string => {
    if (value === null || value === undefined) return '""';
    const str = String(value);
    if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return `"${str}"`;
  };

  const rows = detections.map((det) => [
    escapeCell(det.id),
    escapeCell(det.commonName),
    escapeCell(det.scientificName),
    escapeCell(det.timestampIso),
    escapeCell(Number.isFinite(det.confidenceScore) ? det.confidenceScore.toFixed(3) : ''),
    escapeCell(det.durationSec),
    escapeCell(det.frequencyRangeHz?.[0] ?? ''),
    escapeCell(det.frequencyRangeHz?.[1] ?? ''),
    escapeCell(det.sessionId),
    escapeCell(det.habitatPreset),
  ]);

  return [headers.map(escapeCell).join(','), ...rows.map((r) => r.join(','))].join('\r\n');
}

/**
 * Generate clean JSON export with provenance and active filter parameters.
 */
export function exportDetectionsToJson(
  detections: readonly SpeciesDetection[],
  filters?: Partial<DetectionFilterState>
): string {
  const payload = {
    exportedAtIso: new Date().toISOString(),
    recordCount: detections.length,
    activeFilters: filters
      ? {
          search: filters.search || undefined,
          sessionId: filters.sessionId !== 'all' ? filters.sessionId : undefined,
          habitatPreset: filters.habitatPreset !== 'all' ? filters.habitatPreset : undefined,
          minConfidence: filters.minConfidence,
          timeWindow: filters.timeWindow,
          customStartIso: filters.customStartIso || undefined,
          customEndIso: filters.customEndIso || undefined,
          sortField: filters.sortField,
          sortDirection: filters.sortDirection,
        }
      : undefined,
    terminologyNotice:
      'Confidence scores represent raw acoustic classifier output and are not calibrated biological presence probabilities.',
    detections: detections.map((d) => ({
      id: d.id,
      commonName: d.commonName,
      scientificName: d.scientificName,
      timestampIso: d.timestampIso,
      confidenceScore: d.confidenceScore,
      durationSec: d.durationSec,
      frequencyRangeHz: d.frequencyRangeHz,
      sessionId: d.sessionId,
      habitatPreset: d.habitatPreset,
    })),
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Parse URL query parameters to hydrate DetectionFilterState.
 */
export function parseUrlFilterParams(
  params: URLSearchParams,
  defaultMinConfidence: number
): DetectionFilterState {
  const search = params.get('q') ?? params.get('search') ?? '';
  const sessionId = params.get('session') ?? 'all';
  const habitat = params.get('habitat') ?? 'all';
  const timeWindowParam = params.get('window') ?? 'all';

  const validTimeWindows: TimeWindowFilter[] = ['all', '1h', '24h', 'custom'];
  const timeWindow: TimeWindowFilter = validTimeWindows.includes(timeWindowParam as TimeWindowFilter)
    ? (timeWindowParam as TimeWindowFilter)
    : 'all';

  const customStartIso = params.get('start') ?? '';
  const customEndIso = params.get('end') ?? '';

  const rawMinScore = params.get('minScore') ?? params.get('score');
  let minConfidence = defaultMinConfidence;
  if (rawMinScore !== null) {
    const parsed = parseFloat(rawMinScore);
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      minConfidence = parsed;
    }
  }

  const sortFieldParam = params.get('sort') ?? 'timestamp';
  const validSortFields: DetectionSortField[] = [
    'timestamp',
    'commonName',
    'scientificName',
    'confidence',
    'duration',
  ];
  const sortField: DetectionSortField = validSortFields.includes(sortFieldParam as DetectionSortField)
    ? (sortFieldParam as DetectionSortField)
    : 'timestamp';

  const orderParam = params.get('order') ?? 'desc';
  const sortDirection: SortDirection = orderParam === 'asc' ? 'asc' : 'desc';

  const pageParam = parseInt(params.get('page') ?? '1', 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  const pageSizeParam = parseInt(params.get('pageSize') ?? '10', 10);
  const pageSize = [10, 25, 50].includes(pageSizeParam) ? pageSizeParam : 10;

  return {
    search,
    sessionId,
    habitatPreset: habitat as HabitatPresetId | 'all',
    minConfidence,
    timeWindow,
    customStartIso,
    customEndIso,
    sortField,
    sortDirection,
    page,
    pageSize,
  };
}

/**
 * Serialize DetectionFilterState into URLSearchParams (omitting default values to keep URL clean).
 */
export function serializeUrlFilterParams(
  filters: DetectionFilterState,
  defaultMinConfidence: number
): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.search.trim()) {
    params.set('q', filters.search.trim());
  }
  if (filters.sessionId !== 'all') {
    params.set('session', filters.sessionId);
  }
  if (filters.habitatPreset !== 'all') {
    params.set('habitat', filters.habitatPreset);
  }
  // Store minScore if it deviates meaningfully from default
  if (Math.abs(filters.minConfidence - defaultMinConfidence) > 0.001) {
    params.set('minScore', filters.minConfidence.toFixed(2));
  }
  if (filters.timeWindow !== 'all') {
    params.set('window', filters.timeWindow);
    if (filters.timeWindow === 'custom') {
      if (filters.customStartIso) params.set('start', filters.customStartIso);
      if (filters.customEndIso) params.set('end', filters.customEndIso);
    }
  }
  if (filters.sortField !== 'timestamp') {
    params.set('sort', filters.sortField);
  }
  if (filters.sortDirection !== 'desc') {
    params.set('order', filters.sortDirection);
  }
  if (filters.page > 1) {
    params.set('page', filters.page.toString());
  }
  if (filters.pageSize !== 10) {
    params.set('pageSize', filters.pageSize.toString());
  }

  return params;
}
