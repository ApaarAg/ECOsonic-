import type {
  HabitatPresetId,
  MonitoringSession,
  MonitoringStatus,
} from '../types/ecosonic';

export type SessionSortField = 'startedAt' | 'duration' | 'title' | 'siteName' | 'status' | 'detections';
export type SortDirection = 'asc' | 'desc';

export interface SessionFilterState {
  search: string;
  status: MonitoringStatus | 'all';
  habitat: HabitatPresetId | 'all';
  sortField: SessionSortField;
  sortDirection: SortDirection;
  page: number;
  pageSize: number;
}

export interface SessionSummaryMetrics {
  totalSessions: number;
  activeCount: number;
  completedCount: number;
  totalDetections: number;
  totalDisturbances: number;
  totalDurationSec: number;
}

/**
 * Maps siteName or preset hints to a known HabitatPresetId if possible.
 */
export function inferHabitatPresetFromSession(session: MonitoringSession): HabitatPresetId | 'unknown' {
  const text = (session.siteName + ' ' + session.title).toLowerCase();
  if (text.includes('hoh') || text.includes('rainforest') || text.includes('canopy')) {
    return 'temperate-rainforest';
  }
  if (text.includes('karelian') || text.includes('fen') || text.includes('wetland')) {
    return 'boreal-wetland';
  }
  if (text.includes('cascade') || text.includes('timberline') || text.includes('subalpine') || text.includes('ridge')) {
    return 'subalpine-ridge';
  }
  return 'unknown';
}

/**
 * Filter sessions by search query, status, and habitat preset.
 */
export function filterSessions(
  sessions: readonly MonitoringSession[],
  filters: Partial<SessionFilterState>
): MonitoringSession[] {
  const {
    search = '',
    status = 'all',
    habitat = 'all',
  } = filters;

  const normalizedQuery = search.trim().toLowerCase();

  return sessions.filter((session) => {
    // Status filter
    if (status !== 'all' && session.status !== status) {
      return false;
    }

    // Habitat filter
    if (habitat !== 'all') {
      const inferred = inferHabitatPresetFromSession(session);
      if (inferred !== habitat) {
        return false;
      }
    }

    // Multi-field search
    if (normalizedQuery.length > 0) {
      const idMatch = session.id.toLowerCase().includes(normalizedQuery);
      const titleMatch = session.title.toLowerCase().includes(normalizedQuery);
      const siteMatch = session.siteName.toLowerCase().includes(normalizedQuery);
      const coordMatch = session.coordinatesLabel.toLowerCase().includes(normalizedQuery);
      const statusMatch = session.status.toLowerCase().includes(normalizedQuery);
      const dateMatch = session.startedAtIso.toLowerCase().includes(normalizedQuery);

      if (!idMatch && !titleMatch && !siteMatch && !coordMatch && !statusMatch && !dateMatch) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Sort sessions stably with deterministic tie-breaking.
 */
export function sortSessions(
  sessions: readonly MonitoringSession[],
  field: SessionSortField,
  direction: SortDirection
): MonitoringSession[] {
  const sorted = [...sessions];
  const mult = direction === 'asc' ? 1 : -1;

  sorted.sort((a, b) => {
    let diff = 0;
    switch (field) {
      case 'startedAt': {
        const timeA = Date.parse(a.startedAtIso) || 0;
        const timeB = Date.parse(b.startedAtIso) || 0;
        diff = timeA - timeB;
        break;
      }
      case 'duration':
        diff = (a.durationSec ?? 0) - (b.durationSec ?? 0);
        break;
      case 'title':
        diff = a.title.localeCompare(b.title);
        break;
      case 'siteName':
        diff = a.siteName.localeCompare(b.siteName);
        break;
      case 'status':
        diff = a.status.localeCompare(b.status);
        break;
      case 'detections':
        diff = (a.speciesDetectionCount ?? 0) - (b.speciesDetectionCount ?? 0);
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
 * Paginate items with safe page clamping.
 */
export function paginateSessions(
  items: readonly MonitoringSession[],
  page: number,
  pageSize: number
) {
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 10;
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const clampedPage = Math.max(1, Math.min(page, totalPages));

  const startIndex = (clampedPage - 1) * safePageSize;
  const sliced = items.slice(startIndex, startIndex + safePageSize);

  return {
    items: sliced,
    totalItems,
    page: clampedPage,
    pageSize: safePageSize,
    totalPages,
  };
}

/**
 * Parse URL query parameters into SessionFilterState.
 */
export function parseSessionUrlParams(params: URLSearchParams): SessionFilterState {
  const search = params.get('q') ?? params.get('search') ?? '';

  const statusParam = params.get('status');
  const validStatuses: MonitoringStatus[] = ['streaming', 'completed', 'paused', 'idle'];
  const status: MonitoringStatus | 'all' =
    statusParam && validStatuses.includes(statusParam as MonitoringStatus)
      ? (statusParam as MonitoringStatus)
      : 'all';

  const habitatParam = params.get('habitat');
  const validHabitats: HabitatPresetId[] = ['temperate-rainforest', 'boreal-wetland', 'subalpine-ridge'];
  const habitat: HabitatPresetId | 'all' =
    habitatParam && validHabitats.includes(habitatParam as HabitatPresetId)
      ? (habitatParam as HabitatPresetId)
      : 'all';

  const sortParam = params.get('sort');
  const validSortFields: SessionSortField[] = ['startedAt', 'duration', 'title', 'siteName', 'status', 'detections'];
  const sortField: SessionSortField =
    sortParam && validSortFields.includes(sortParam as SessionSortField)
      ? (sortParam as SessionSortField)
      : 'startedAt';

  const orderParam = params.get('order');
  const sortDirection: SortDirection = orderParam === 'asc' ? 'asc' : 'desc';

  const pageParam = parseInt(params.get('page') ?? '1', 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  const pageSizeParam = parseInt(params.get('pageSize') ?? '10', 10);
  const pageSize = [5, 10, 20, 50].includes(pageSizeParam) ? pageSizeParam : 10;

  return {
    search,
    status,
    habitat,
    sortField,
    sortDirection,
    page,
    pageSize,
  };
}

/**
 * Serialize SessionFilterState to URL query parameters.
 */
export function serializeSessionUrlParams(
  filters: SessionFilterState,
  selectedSessionId?: string | null,
  currentParams?: URLSearchParams
): URLSearchParams {
  const params = new URLSearchParams(currentParams ? currentParams.toString() : '');

  if (selectedSessionId) {
    params.set('session', selectedSessionId);
  } else {
    params.delete('session');
  }

  if (filters.search.trim()) {
    params.set('q', filters.search.trim());
  } else {
    params.delete('q');
    params.delete('search');
  }

  if (filters.status !== 'all') {
    params.set('status', filters.status);
  } else {
    params.delete('status');
  }

  if (filters.habitat !== 'all') {
    params.set('habitat', filters.habitat);
  } else {
    params.delete('habitat');
  }

  if (filters.sortField !== 'startedAt') {
    params.set('sort', filters.sortField);
    params.set('order', filters.sortDirection);
  } else if (filters.sortDirection !== 'desc') {
    params.set('sort', 'startedAt');
    params.set('order', filters.sortDirection);
  } else {
    params.delete('sort');
    params.delete('order');
  }

  if (filters.page > 1) {
    params.set('page', filters.page.toString());
  } else {
    params.delete('page');
  }

  if (filters.pageSize !== 10) {
    params.set('pageSize', filters.pageSize.toString());
  } else {
    params.delete('pageSize');
  }

  return params;
}
