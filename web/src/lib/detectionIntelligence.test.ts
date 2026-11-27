import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterDetections,
  sortDetections,
  paginateItems,
  computeDetectionSummary,
  exportDetectionsToCsv,
  exportDetectionsToJson,
  parseUrlFilterParams,
  serializeUrlFilterParams,
  type DetectionFilterState,
} from './detectionIntelligence.js';
import type { SpeciesDetection } from '../types/ecosonic.js';

const MOCK_DETECTIONS: SpeciesDetection[] = [
  {
    id: 'det-1',
    commonName: 'Pacific Wren',
    scientificName: 'Troglodytes pacificus',
    timestampIso: '2026-11-21T06:00:00.000Z',
    confidenceScore: 0.95,
    sessionId: 'ses-1',
    frequencyRangeHz: [2500, 7000],
    durationSec: 3.5,
    habitatPreset: 'temperate-rainforest',
  },
  {
    id: 'det-2',
    commonName: 'Varied Thrush',
    scientificName: 'Ixoreus naevius',
    timestampIso: '2026-11-21T05:30:00.000Z',
    confidenceScore: 0.82,
    sessionId: 'ses-1',
    frequencyRangeHz: [1800, 4200],
    durationSec: 2.1,
    habitatPreset: 'temperate-rainforest',
  },
  {
    id: 'det-3',
    commonName: 'Eurasian Bittern',
    scientificName: 'Botaurus stellaris',
    timestampIso: '2026-11-20T16:00:00.000Z',
    confidenceScore: 0.74,
    sessionId: 'ses-2',
    frequencyRangeHz: [120, 450],
    durationSec: 1.8,
    habitatPreset: 'boreal-wetland',
  },
  {
    id: 'det-4',
    commonName: 'Common Snipe',
    scientificName: 'Gallinago gallinago',
    timestampIso: '2026-11-20T15:00:00.000Z',
    confidenceScore: 0.65,
    sessionId: 'ses-2',
    frequencyRangeHz: [1400, 3200],
    durationSec: 4.0,
    habitatPreset: 'boreal-wetland',
  },
  {
    id: 'det-5',
    commonName: 'Clark’s Nutcracker',
    scientificName: 'Nucifraga columbiana',
    timestampIso: '2026-11-19T11:00:00.000Z',
    confidenceScore: 0.88,
    sessionId: 'ses-3',
    frequencyRangeHz: [900, 2400],
    durationSec: 1.2,
    habitatPreset: 'subalpine-ridge',
  },
];

describe('detectionIntelligence - filterDetections', () => {
  it('filters by multi-field search (common name, scientific name, id, session)', () => {
    // Common name
    let result = filterDetections(MOCK_DETECTIONS, { search: 'wren' });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'det-1');

    // Scientific name
    result = filterDetections(MOCK_DETECTIONS, { search: 'ixoreus' });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'det-2');

    // Detection ID
    result = filterDetections(MOCK_DETECTIONS, { search: 'det-3' });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'det-3');

    // Session ID
    result = filterDetections(MOCK_DETECTIONS, { search: 'ses-2' });
    assert.equal(result.length, 2);
  });

  it('filters by session ID and habitat preset', () => {
    let result = filterDetections(MOCK_DETECTIONS, { sessionId: 'ses-1' });
    assert.equal(result.length, 2);

    result = filterDetections(MOCK_DETECTIONS, { habitatPreset: 'boreal-wetland' });
    assert.equal(result.length, 2);

    result = filterDetections(MOCK_DETECTIONS, {
      sessionId: 'ses-1',
      habitatPreset: 'boreal-wetland',
    });
    assert.equal(result.length, 0);
  });

  it('filters by minimum model confidence score', () => {
    const result = filterDetections(MOCK_DETECTIONS, { minConfidence: 0.85 });
    assert.equal(result.length, 2); // det-1 (0.95), det-5 (0.88)
  });

  it('filters by time window and custom bounds', () => {
    const refTime = Date.parse('2026-11-21T06:15:00.000Z');

    // Last 1 hour from refTime
    let result = filterDetections(MOCK_DETECTIONS, { timeWindow: '1h' }, refTime);
    assert.equal(result.length, 2); // det-1 (06:00) and det-2 (05:30)

    // Last 24 hours from refTime
    result = filterDetections(MOCK_DETECTIONS, { timeWindow: '24h' }, refTime);
    assert.equal(result.length, 4); // det-1, det-2, det-3, det-4 (all within 24h)

    // Custom date range
    result = filterDetections(
      MOCK_DETECTIONS,
      {
        timeWindow: 'custom',
        customStartIso: '2026-11-20T00:00:00.000Z',
        customEndIso: '2026-11-20T23:59:59.000Z',
      },
      refTime
    );
    assert.equal(result.length, 2); // det-3 and det-4
  });
});

describe('detectionIntelligence - sortDetections', () => {
  it('sorts by timestamp ascending and descending', () => {
    const desc = sortDetections(MOCK_DETECTIONS, 'timestamp', 'desc');
    assert.equal(desc[0].id, 'det-1'); // newest
    assert.equal(desc[desc.length - 1].id, 'det-5'); // oldest

    const asc = sortDetections(MOCK_DETECTIONS, 'timestamp', 'asc');
    assert.equal(asc[0].id, 'det-5');
    assert.equal(asc[asc.length - 1].id, 'det-1');
  });

  it('sorts by confidence score descending and ascending', () => {
    const desc = sortDetections(MOCK_DETECTIONS, 'confidence', 'desc');
    assert.equal(desc[0].id, 'det-1'); // 0.95
    assert.equal(desc[desc.length - 1].id, 'det-4'); // 0.65

    const asc = sortDetections(MOCK_DETECTIONS, 'confidence', 'asc');
    assert.equal(asc[0].id, 'det-4');
  });

  it('sorts by species common name and scientific name alphabetically', () => {
    const byCommon = sortDetections(MOCK_DETECTIONS, 'commonName', 'asc');
    assert.equal(byCommon[0].commonName, 'Clark’s Nutcracker');

    const bySci = sortDetections(MOCK_DETECTIONS, 'scientificName', 'asc');
    assert.equal(bySci[0].scientificName, 'Botaurus stellaris');
  });

  it('provides deterministic tie-breaking by id', () => {
    const items = [
      { ...MOCK_DETECTIONS[0], id: 'det-b', confidenceScore: 0.8 },
      { ...MOCK_DETECTIONS[1], id: 'det-a', confidenceScore: 0.8 },
    ];
    const sorted = sortDetections(items, 'confidence', 'asc');
    assert.equal(sorted[0].id, 'det-a');
    assert.equal(sorted[1].id, 'det-b');
  });
});

describe('detectionIntelligence - pagination and summaries', () => {
  it('paginates correctly and clamps out-of-bounds page requests', () => {
    const page1 = paginateItems(MOCK_DETECTIONS, 1, 2);
    assert.equal(page1.items.length, 2);
    assert.equal(page1.totalPages, 3);
    assert.equal(page1.page, 1);

    const clamped = paginateItems(MOCK_DETECTIONS, 999, 2);
    assert.equal(clamped.page, 3);
    assert.equal(clamped.items.length, 1);
  });

  it('computes detection summary metrics accurately', () => {
    const summary = computeDetectionSummary(MOCK_DETECTIONS);
    assert.equal(summary.totalCount, 5);
    assert.equal(summary.distinctSpeciesCount, 5);
    assert.equal(summary.distinctSessionCount, 3);
    // (0.95 + 0.82 + 0.74 + 0.65 + 0.88) / 5 = 4.04 / 5 = 0.808
    assert.ok(Math.abs(summary.meanConfidenceScore - 0.808) < 0.001);

    const empty = computeDetectionSummary([]);
    assert.equal(empty.totalCount, 0);
    assert.equal(empty.meanConfidenceScore, 0);
  });
});

describe('detectionIntelligence - CSV & JSON export', () => {
  it('exports RFC 4180 compliant CSV', () => {
    const csv = exportDetectionsToCsv([MOCK_DETECTIONS[0]]);
    const lines = csv.split('\r\n');
    assert.equal(lines.length, 2);
    assert.ok(lines[0].includes('Detection ID'));
    assert.ok(lines[1].includes('"Pacific Wren"'));
    assert.ok(lines[1].includes('"Troglodytes pacificus"'));
    assert.ok(lines[1].includes('"0.950"'));
  });

  it('exports structured JSON without sensitive keys', () => {
    const jsonStr = exportDetectionsToJson([MOCK_DETECTIONS[0]], { minConfidence: 0.8 });
    const parsed = JSON.parse(jsonStr);
    assert.equal(parsed.recordCount, 1);
    assert.equal(parsed.detections[0].id, 'det-1');
    assert.ok(parsed.terminologyNotice.includes('raw acoustic classifier output'));
    assert.equal(parsed.activeFilters.minConfidence, 0.8);
  });
});

describe('detectionIntelligence - URL parsing and serialization', () => {
  it('round-trips filter state via URLSearchParams', () => {
    const filters: DetectionFilterState = {
      search: 'wren',
      sessionId: 'ses-1',
      habitatPreset: 'temperate-rainforest',
      minConfidence: 0.75,
      timeWindow: '24h',
      customStartIso: '',
      customEndIso: '',
      sortField: 'confidence',
      sortDirection: 'asc',
      page: 2,
      pageSize: 25,
    };

    const params = serializeUrlFilterParams(filters, 0.65);
    const parsed = parseUrlFilterParams(params, 0.65);

    assert.equal(parsed.search, 'wren');
    assert.equal(parsed.sessionId, 'ses-1');
    assert.equal(parsed.habitatPreset, 'temperate-rainforest');
    assert.equal(parsed.minConfidence, 0.75);
    assert.equal(parsed.timeWindow, '24h');
    assert.equal(parsed.sortField, 'confidence');
    assert.equal(parsed.sortDirection, 'asc');
    assert.equal(parsed.page, 2);
    assert.equal(parsed.pageSize, 25);
  });

  it('handles empty or malformed URL params gracefully', () => {
    const emptyParams = new URLSearchParams('');
    const parsed = parseUrlFilterParams(emptyParams, 0.65);

    assert.equal(parsed.search, '');
    assert.equal(parsed.sessionId, 'all');
    assert.equal(parsed.habitatPreset, 'all');
    assert.equal(parsed.minConfidence, 0.65);
    assert.equal(parsed.timeWindow, 'all');
    assert.equal(parsed.sortField, 'timestamp');
    assert.equal(parsed.sortDirection, 'desc');
    assert.equal(parsed.page, 1);
    assert.equal(parsed.pageSize, 10);
  });
});
