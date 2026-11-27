import type {
  DisturbanceCategory,
  DisturbanceEvent,
  DisturbanceSeverity,
} from '../types/ecosonic';

export type DisturbanceSortField = 'timestamp' | 'category' | 'severity' | 'duration' | 'peakDbfs';
export type SortDirection = 'asc' | 'desc';

export interface DisturbanceFilterState {
  search: string;
  category: DisturbanceCategory | 'all';
  severity: DisturbanceSeverity | 'all';
  sessionId: string;
  sortField: DisturbanceSortField;
  sortDirection: SortDirection;
}

export interface DisturbanceCategoryCounts {
  transportation: number;
  environmental_hazard: number;
  mechanical_activity: number;
  cultural_sound: number;
  total: number;
}

export const SEVERITY_ORDER: Record<DisturbanceSeverity, number> = {
  low: 1,
  moderate: 2,
  elevated: 3,
};

/**
 * Filter disturbance events across multi-field search, category, severity, and session.
 */
export function filterDisturbanceIntelligence(
  events: readonly DisturbanceEvent[],
  filters: Partial<DisturbanceFilterState>
): DisturbanceEvent[] {
  const {
    search = '',
    category = 'all',
    severity = 'all',
    sessionId = 'all',
  } = filters;

  const normalizedQuery = search.trim().toLowerCase();

  return events.filter((ev) => {
    // Category match
    if (category !== 'all' && ev.category !== category) {
      return false;
    }

    // Severity match
    if (severity !== 'all' && ev.severity !== severity) {
      return false;
    }

    // Session match
    if (sessionId !== 'all' && ev.sessionId !== sessionId) {
      return false;
    }

    // Multi-field search
    if (normalizedQuery.length > 0) {
      const idMatch = ev.id.toLowerCase().includes(normalizedQuery);
      const catMatch = ev.category.toLowerCase().includes(normalizedQuery);
      const labelMatch = (ev.label || '').toLowerCase().includes(normalizedQuery);
      const descMatch = (ev.description || '').toLowerCase().includes(normalizedQuery);
      const sessionMatch = ev.sessionId.toLowerCase().includes(normalizedQuery);
      const timeMatch = ev.timestampIso.toLowerCase().includes(normalizedQuery);
      const sevMatch = (ev.severity || '').toLowerCase().includes(normalizedQuery);

      if (!idMatch && !catMatch && !labelMatch && !descMatch && !sessionMatch && !timeMatch && !sevMatch) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Sort disturbance events stably with deterministic tie-breaking.
 */
export function sortDisturbanceEvents(
  events: readonly DisturbanceEvent[],
  field: DisturbanceSortField,
  direction: SortDirection
): DisturbanceEvent[] {
  const sorted = [...events];
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
      case 'category':
        diff = a.category.localeCompare(b.category);
        break;
      case 'severity': {
        const rankA = SEVERITY_ORDER[a.severity] ?? 0;
        const rankB = SEVERITY_ORDER[b.severity] ?? 0;
        diff = rankA - rankB;
        break;
      }
      case 'duration':
        diff = (a.durationSec ?? 0) - (b.durationSec ?? 0);
        break;
      case 'peakDbfs':
        diff = (a.peakDbfs ?? -120) - (b.peakDbfs ?? -120);
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
 * Compute counts for all disturbance categories plus total.
 */
export function calculateCategoryCounts(
  events: readonly DisturbanceEvent[]
): DisturbanceCategoryCounts {
  const counts: DisturbanceCategoryCounts = {
    transportation: 0,
    environmental_hazard: 0,
    mechanical_activity: 0,
    cultural_sound: 0,
    total: events.length,
  };

  for (const ev of events) {
    if (ev.category in counts) {
      counts[ev.category as keyof Omit<DisturbanceCategoryCounts, 'total'>] += 1;
    }
  }

  return counts;
}

/**
 * Hydrate disturbance filter state from URL query parameters.
 */
export function parseDisturbanceUrlParams(params: URLSearchParams): DisturbanceFilterState {
  const search = params.get('q') ?? params.get('search') ?? '';
  const sessionId = params.get('session') ?? 'all';

  const categoryParam = params.get('category');
  const validCategories: DisturbanceCategory[] = [
    'transportation',
    'environmental_hazard',
    'mechanical_activity',
    'cultural_sound',
  ];
  const category: DisturbanceCategory | 'all' =
    categoryParam && validCategories.includes(categoryParam as DisturbanceCategory)
      ? (categoryParam as DisturbanceCategory)
      : 'all';

  const severityParam = params.get('severity');
  const validSeverities: DisturbanceSeverity[] = ['low', 'moderate', 'elevated'];
  const severity: DisturbanceSeverity | 'all' =
    severityParam && validSeverities.includes(severityParam as DisturbanceSeverity)
      ? (severityParam as DisturbanceSeverity)
      : 'all';

  const sortParam = params.get('sort');
  const validSortFields: DisturbanceSortField[] = [
    'timestamp',
    'category',
    'severity',
    'duration',
    'peakDbfs',
  ];
  const sortField: DisturbanceSortField =
    sortParam && validSortFields.includes(sortParam as DisturbanceSortField)
      ? (sortParam as DisturbanceSortField)
      : 'timestamp';

  const orderParam = params.get('order');
  const sortDirection: SortDirection = orderParam === 'asc' ? 'asc' : 'desc';

  return {
    search,
    category,
    severity,
    sessionId,
    sortField,
    sortDirection,
  };
}

/**
 * Serialize disturbance filter state into URL query parameters.
 */
export function serializeDisturbanceUrlParams(
  filters: DisturbanceFilterState,
  currentParams?: URLSearchParams
): URLSearchParams {
  const params = new URLSearchParams(currentParams ? currentParams.toString() : '');

  if (filters.search.trim()) {
    params.set('q', filters.search.trim());
  } else {
    params.delete('q');
    params.delete('search');
  }

  if (filters.category !== 'all') {
    params.set('category', filters.category);
  } else {
    params.delete('category');
  }

  if (filters.severity !== 'all') {
    params.set('severity', filters.severity);
  } else {
    params.delete('severity');
  }

  if (filters.sessionId !== 'all') {
    params.set('session', filters.sessionId);
  } else {
    params.delete('session');
  }

  if (filters.sortField !== 'timestamp') {
    params.set('sort', filters.sortField);
    params.set('order', filters.sortDirection);
  } else if (filters.sortDirection !== 'desc') {
    params.set('sort', 'timestamp');
    params.set('order', filters.sortDirection);
  } else {
    params.delete('sort');
    params.delete('order');
  }

  return params;
}
