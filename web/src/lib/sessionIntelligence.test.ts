import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterSessions,
  sortSessions,
  paginateSessions,
  parseSessionUrlParams,
  serializeSessionUrlParams,
  inferHabitatPresetFromSession,
  type SessionFilterState,
} from './sessionIntelligence.js';
import { exportSessionToCsv, exportSessionToJson } from './sessionReportExport.js';
import type { MonitoringSession, SpeciesDetection, DisturbanceEvent } from '../types/ecosonic.js';

const MOCK_SESSIONS: MonitoringSession[] = [
  {
    id: 'ses-1',
    title: 'Dawn Canopy Transect',
    siteName: 'Hoh Canopy Station (Demo Fixture)',
    coordinatesLabel: '47.8609° N, 123.9348° W',
    startedAtIso: '2026-11-21T05:45:00.000Z',
    endedAtIso: null,
    durationSec: 3600,
    status: 'streaming',
    sampleRateHz: 48000,
    speciesDetectionCount: 12,
    distinctSpeciesCount: 8,
    disturbanceEventCount: 2,
    soundscapeSummary: {
      aciMean: 180,
      ndsiMean: 0.65,
      spectralEntropyMean: 0.75,
      dominantBandHz: '2-5 kHz',
    },
    notes: 'Canopy dawn recording',
  },
  {
    id: 'ses-2',
    title: 'Twilight Fen Array',
    siteName: 'Karelian Fen Array (Demo Fixture)',
    coordinatesLabel: '62.9312° N, 30.8921° E',
    startedAtIso: '2026-11-20T16:20:00.000Z',
    endedAtIso: '2026-11-20T17:50:00.000Z',
    durationSec: 5400,
    status: 'completed',
    sampleRateHz: 48000,
    speciesDetectionCount: 5,
    distinctSpeciesCount: 4,
    disturbanceEventCount: 1,
    soundscapeSummary: {
      aciMean: 160,
      ndsiMean: 0.5,
      spectralEntropyMean: 0.7,
      dominantBandHz: '1-4 kHz',
    },
    notes: 'Wetland dusk sweep',
  },
  {
    id: 'ses-3',
    title: 'Midday Timberline Baseline',
    siteName: 'Cascade Timberline (Demo Fixture)',
    coordinatesLabel: '48.4718° N, 121.0562° W',
    startedAtIso: '2026-11-19T11:10:00.000Z',
    endedAtIso: '2026-11-19T12:15:00.000Z',
    durationSec: 3900,
    status: 'completed',
    sampleRateHz: 44100,
    speciesDetectionCount: 4,
    distinctSpeciesCount: 3,
    disturbanceEventCount: 3,
    soundscapeSummary: {
      aciMean: 140,
      ndsiMean: 0.2,
      spectralEntropyMean: 0.6,
      dominantBandHz: '0.5-3 kHz',
    },
    notes: 'High elevation wind',
  },
];

const MOCK_DETECTIONS: SpeciesDetection[] = [
  {
    id: 'det-1',
    commonName: 'Pacific Wren',
    scientificName: 'Troglodytes pacificus',
    timestampIso: '2026-11-21T06:00:00.000Z',
    confidenceScore: 0.94,
    sessionId: 'ses-1',
    frequencyRangeHz: [2500, 7000],
    durationSec: 3.5,
    habitatPreset: 'temperate-rainforest',
  },
];

const MOCK_DISTURBANCES: DisturbanceEvent[] = [
  {
    id: 'dis-1',
    category: 'transportation',
    label: 'Commercial Aircraft',
    description: 'Corridor flyover',
    timestampIso: '2026-11-21T06:15:00.000Z',
    durationSec: 45,
    peakDbfs: -20,
    frequencyBandHz: [50, 400],
    severity: 'moderate',
    confidenceScore: 0.85,
    sessionId: 'ses-1',
  },
];

describe('sessionIntelligence - filtering and habitat inference', () => {
  it('infers habitat presets accurately from session metadata', () => {
    assert.equal(inferHabitatPresetFromSession(MOCK_SESSIONS[0]), 'temperate-rainforest');
    assert.equal(inferHabitatPresetFromSession(MOCK_SESSIONS[1]), 'boreal-wetland');
    assert.equal(inferHabitatPresetFromSession(MOCK_SESSIONS[2]), 'subalpine-ridge');
  });

  it('filters sessions by multi-field search', () => {
    let res = filterSessions(MOCK_SESSIONS, { search: 'hoh' });
    assert.equal(res.length, 1);
    assert.equal(res[0].id, 'ses-1');

    res = filterSessions(MOCK_SESSIONS, { search: 'ses-2' });
    assert.equal(res.length, 1);
    assert.equal(res[0].id, 'ses-2');
  });

  it('filters sessions by status and habitat', () => {
    let res = filterSessions(MOCK_SESSIONS, { status: 'streaming' });
    assert.equal(res.length, 1);
    assert.equal(res[0].id, 'ses-1');

    res = filterSessions(MOCK_SESSIONS, { habitat: 'boreal-wetland' });
    assert.equal(res.length, 1);
    assert.equal(res[0].id, 'ses-2');
  });
});

describe('sessionIntelligence - sorting and pagination', () => {
  it('sorts sessions by startedAt, duration, and detections', () => {
    const descTime = sortSessions(MOCK_SESSIONS, 'startedAt', 'desc');
    assert.equal(descTime[0].id, 'ses-1');

    const descDur = sortSessions(MOCK_SESSIONS, 'duration', 'desc');
    assert.equal(descDur[0].id, 'ses-2'); // 5400s

    const descDet = sortSessions(MOCK_SESSIONS, 'detections', 'desc');
    assert.equal(descDet[0].id, 'ses-1'); // 12 detections
  });

  it('paginates sessions safely', () => {
    const page1 = paginateSessions(MOCK_SESSIONS, 1, 2);
    assert.equal(page1.items.length, 2);
    assert.equal(page1.totalPages, 2);

    const clamped = paginateSessions(MOCK_SESSIONS, 99, 2);
    assert.equal(clamped.page, 2);
  });
});

describe('sessionIntelligence - URL parameter hydration & serialization', () => {
  it('round-trips session filter state', () => {
    const original: SessionFilterState = {
      search: 'karelian',
      status: 'completed',
      habitat: 'boreal-wetland',
      sortField: 'duration',
      sortDirection: 'asc',
      page: 1,
      pageSize: 10,
    };

    const params = serializeSessionUrlParams(original, 'ses-2');
    assert.equal(params.get('session'), 'ses-2');
    assert.equal(params.get('q'), 'karelian');
    assert.equal(params.get('status'), 'completed');

    const parsed = parseSessionUrlParams(params);
    assert.equal(parsed.search, 'karelian');
    assert.equal(parsed.status, 'completed');
    assert.equal(parsed.habitat, 'boreal-wetland');
    assert.equal(parsed.sortField, 'duration');
    assert.equal(parsed.sortDirection, 'asc');
  });
});

describe('sessionReportExport - CSV & JSON generation', () => {
  it('exports RFC 4180 CSV without leaking credentials', () => {
    const csv = exportSessionToCsv(MOCK_SESSIONS[0], MOCK_DETECTIONS, MOCK_DISTURBANCES);
    assert.ok(csv.includes('ses-1'));
    assert.ok(csv.includes('Pacific Wren'));
    assert.ok(csv.includes('Commercial Aircraft'));
    assert.ok(csv.includes('48000'));
  });

  it('exports structured JSON with session scoping', () => {
    const jsonStr = exportSessionToJson(MOCK_SESSIONS[0], MOCK_DETECTIONS, MOCK_DISTURBANCES);
    const parsed = JSON.parse(jsonStr);
    assert.equal(parsed.session.id, 'ses-1');
    assert.equal(parsed.speciesDetections.length, 1);
    assert.equal(parsed.disturbanceEvents.length, 1);
    assert.ok(parsed.provenanceNotice.includes('demo fixtures'));
  });
});
