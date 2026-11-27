import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterDisturbanceIntelligence,
  sortDisturbanceEvents,
  calculateCategoryCounts,
  parseDisturbanceUrlParams,
  serializeDisturbanceUrlParams,
  SEVERITY_ORDER,
  type DisturbanceFilterState,
} from './disturbanceIntelligence.js';
import type { DisturbanceEvent } from '../types/ecosonic.js';

const MOCK_DISTURBANCES: DisturbanceEvent[] = [
  {
    id: 'dis-1',
    category: 'transportation',
    label: 'High-Altitude Commercial Flight Corridor',
    description: 'Sub-100Hz rumble from commercial turbofan crossing.',
    timestampIso: '2026-11-21T06:15:00.000Z',
    durationSec: 45,
    peakDbfs: -18.2,
    frequencyBandHz: [40, 320],
    severity: 'elevated',
    confidenceScore: 0.92,
    sessionId: 'ses-1',
  },
  {
    id: 'dis-2',
    category: 'environmental_hazard',
    label: 'Canopy Limb Fracture Impulse',
    description: 'Abrupt transient shock from falling old-growth branch.',
    timestampIso: '2026-11-21T05:40:00.000Z',
    durationSec: 3.5,
    peakDbfs: -12.4,
    frequencyBandHz: [80, 2400],
    severity: 'moderate',
    confidenceScore: 0.88,
    sessionId: 'ses-1',
  },
  {
    id: 'dis-3',
    category: 'mechanical_activity',
    label: 'Forestry Maintenance Vehicle',
    description: 'Low-frequency diesel engine idling at reserve boundary.',
    timestampIso: '2026-11-20T16:45:00.000Z',
    durationSec: 120,
    peakDbfs: -22.1,
    frequencyBandHz: [30, 450],
    severity: 'moderate',
    confidenceScore: 0.84,
    sessionId: 'ses-2',
  },
  {
    id: 'dis-4',
    category: 'cultural_sound',
    label: 'Recreational Trail Speech Corridor',
    description: 'Intermittent human vocal harmonics along marked ridge trail.',
    timestampIso: '2026-11-20T14:10:00.000Z',
    durationSec: 25,
    peakDbfs: -28.5,
    frequencyBandHz: [300, 3100],
    severity: 'low',
    confidenceScore: 0.76,
    sessionId: 'ses-2',
  },
];

describe('disturbanceIntelligence - filterDisturbanceIntelligence', () => {
  it('filters by multi-field search across id, label, description, and session', () => {
    // Search label
    let res = filterDisturbanceIntelligence(MOCK_DISTURBANCES, { search: 'commercial' });
    assert.equal(res.length, 1);
    assert.equal(res[0].id, 'dis-1');

    // Search description
    res = filterDisturbanceIntelligence(MOCK_DISTURBANCES, { search: 'diesel engine' });
    assert.equal(res.length, 1);
    assert.equal(res[0].id, 'dis-3');

    // Search ID
    res = filterDisturbanceIntelligence(MOCK_DISTURBANCES, { search: 'dis-4' });
    assert.equal(res.length, 1);
    assert.equal(res[0].id, 'dis-4');

    // Search session
    res = filterDisturbanceIntelligence(MOCK_DISTURBANCES, { search: 'ses-1' });
    assert.equal(res.length, 2);
  });

  it('filters by category and severity combined', () => {
    let res = filterDisturbanceIntelligence(MOCK_DISTURBANCES, {
      category: 'environmental_hazard',
    });
    assert.equal(res.length, 1);
    assert.equal(res[0].id, 'dis-2');

    res = filterDisturbanceIntelligence(MOCK_DISTURBANCES, {
      severity: 'moderate',
    });
    assert.equal(res.length, 2); // dis-2, dis-3

    res = filterDisturbanceIntelligence(MOCK_DISTURBANCES, {
      category: 'transportation',
      severity: 'moderate',
    });
    assert.equal(res.length, 0); // dis-1 is elevated
  });

  it('filters by session ID correctly', () => {
    const res = filterDisturbanceIntelligence(MOCK_DISTURBANCES, { sessionId: 'ses-2' });
    assert.equal(res.length, 2);
    assert.ok(res.every((e) => e.sessionId === 'ses-2'));
  });
});

describe('disturbanceIntelligence - sortDisturbanceEvents', () => {
  it('sorts by timestamp ascending and descending', () => {
    const desc = sortDisturbanceEvents(MOCK_DISTURBANCES, 'timestamp', 'desc');
    assert.equal(desc[0].id, 'dis-1'); // newest
    assert.equal(desc[desc.length - 1].id, 'dis-4'); // oldest

    const asc = sortDisturbanceEvents(MOCK_DISTURBANCES, 'timestamp', 'asc');
    assert.equal(asc[0].id, 'dis-4');
    assert.equal(asc[asc.length - 1].id, 'dis-1');
  });

  it('sorts by severity (elevated > moderate > low) deterministically', () => {
    const desc = sortDisturbanceEvents(MOCK_DISTURBANCES, 'severity', 'desc');
    assert.equal(desc[0].severity, 'elevated');
    assert.equal(desc[desc.length - 1].severity, 'low');

    const asc = sortDisturbanceEvents(MOCK_DISTURBANCES, 'severity', 'asc');
    assert.equal(asc[0].severity, 'low');
    assert.equal(asc[asc.length - 1].severity, 'elevated');
  });

  it('sorts by duration and peak dBFS', () => {
    const descDuration = sortDisturbanceEvents(MOCK_DISTURBANCES, 'duration', 'desc');
    assert.equal(descDuration[0].id, 'dis-3'); // 120s

    const descDbfs = sortDisturbanceEvents(MOCK_DISTURBANCES, 'peakDbfs', 'desc');
    assert.equal(descDbfs[0].id, 'dis-2'); // -12.4 is highest peak
  });
});

describe('disturbanceIntelligence - calculateCategoryCounts', () => {
  it('computes accurate totals for each category', () => {
    const counts = calculateCategoryCounts(MOCK_DISTURBANCES);
    assert.equal(counts.transportation, 1);
    assert.equal(counts.environmental_hazard, 1);
    assert.equal(counts.mechanical_activity, 1);
    assert.equal(counts.cultural_sound, 1);
    assert.equal(counts.total, 4);
  });
});

describe('disturbanceIntelligence - URL serialization & parsing', () => {
  it('round-trips full filter state to and from URLSearchParams', () => {
    const original: DisturbanceFilterState = {
      search: 'turbofan',
      category: 'transportation',
      severity: 'elevated',
      sessionId: 'ses-1',
      sortField: 'severity',
      sortDirection: 'asc',
    };

    const params = serializeDisturbanceUrlParams(original);
    const parsed = parseDisturbanceUrlParams(params);

    assert.equal(parsed.search, 'turbofan');
    assert.equal(parsed.category, 'transportation');
    assert.equal(parsed.severity, 'elevated');
    assert.equal(parsed.sessionId, 'ses-1');
    assert.equal(parsed.sortField, 'severity');
    assert.equal(parsed.sortDirection, 'asc');
  });

  it('falls back safely for invalid URL values', () => {
    const badParams = new URLSearchParams('category=fake_category&severity=extreme&sort=invalid_sort');
    const parsed = parseDisturbanceUrlParams(badParams);

    assert.equal(parsed.category, 'all');
    assert.equal(parsed.severity, 'all');
    assert.equal(parsed.sortField, 'timestamp');
    assert.equal(parsed.sortDirection, 'desc');
  });
});
