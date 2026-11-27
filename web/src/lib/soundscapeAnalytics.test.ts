import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACOUSTIC_INDEX_SPECS,
  computeSourceMetrics,
  computeTemporalStats,
  formatSoundscapeExportCsv,
  formatSoundscapeExportJson,
  normalizeSoundscapeIndices,
} from './soundscapeAnalytics';
import { DEMO_SOUNDSCAPES } from '../data/demoFixtures';
import type { FrequencyBandEnergy, SoundscapeIndices, TemporalActivityPoint } from '../types/ecosonic';

const mockIndices: SoundscapeIndices = {
  aci: 184.6,
  adi: 2.42,
  aei: 0.31,
  ndsi: 0.68,
  spectralEntropy: 0.79,
  meanLevelDbfs: -38.4,
  computedAtIso: '2026-11-21T06:20:00.000Z',
};

test('normalizeSoundscapeIndices accurately normalizes raw indices into [0, 1] range', () => {
  const norm = normalizeSoundscapeIndices(mockIndices);

  // ACI / 250 -> 184.6 / 250 = 0.7384 -> 0.738
  assert.equal(norm.aciNorm, 0.738);
  // ADI / 3.0 -> 2.42 / 3.0 = 0.8066 -> 0.807
  assert.equal(norm.adiNorm, 0.807);
  // AEI directly clamped -> 0.31
  assert.equal(norm.aeiNorm, 0.31);
  // NDSI: (0.68 + 1) / 2 = 1.68 / 2 = 0.84
  assert.equal(norm.ndsiNorm, 0.84);
  // Spectral Entropy -> 0.79
  assert.equal(norm.entropyNorm, 0.79);

  // Edge cases: boundary clamping
  const extremeIndices: SoundscapeIndices = {
    aci: 500, // exceeds 250
    adi: 4.5, // exceeds 3.0
    aei: -0.2, // below 0
    ndsi: -1.0, // minimum NDSI
    spectralEntropy: 1.5, // exceeds 1.0
    meanLevelDbfs: -12.0,
    computedAtIso: '2026-11-21T00:00:00Z',
  };
  const extremeNorm = normalizeSoundscapeIndices(extremeIndices);
  assert.equal(extremeNorm.aciNorm, 1);
  assert.equal(extremeNorm.adiNorm, 1);
  assert.equal(extremeNorm.aeiNorm, 0);
  assert.equal(extremeNorm.ndsiNorm, 0);
  assert.equal(extremeNorm.entropyNorm, 1);
});

test('ACOUSTIC_INDEX_SPECS defines comprehensive scientific references for all 5 indices', () => {
  const keys = ['aci', 'adi', 'aei', 'ndsi', 'spectralEntropy'] as const;
  for (const k of keys) {
    const doc = ACOUSTIC_INDEX_SPECS[k];
    assert.ok(doc);
    assert.ok(doc.fullName.length > 0);
    assert.ok(doc.reference.length > 0);
    assert.ok(doc.formula.length > 0);
    assert.ok(doc.interpretation.length > 0);
    assert.ok(doc.biologicalContext.length > 0);
  }
});

test('computeSourceMetrics sums percentages and identifies dominant source and band', () => {
  const bands: FrequencyBandEnergy[] = [
    { bandLabel: 'Sub-bass', rangeHz: '20-300', energyDb: -40, relativeSharePct: 10, dominantSource: 'anthrophony' },
    { bandLabel: 'Wind', rangeHz: '300-1000', energyDb: -30, relativeSharePct: 20, dominantSource: 'geophony' },
    { bandLabel: 'Mid Birds', rangeHz: '1-3k', energyDb: -20, relativeSharePct: 40, dominantSource: 'biophony' },
    { bandLabel: 'Upper Birds', rangeHz: '3-6k', energyDb: -22, relativeSharePct: 30, dominantSource: 'biophony' },
  ];

  const metrics = computeSourceMetrics(bands);
  assert.equal(metrics.biophonyPct, 70);
  assert.equal(metrics.geophonyPct, 20);
  assert.equal(metrics.anthrophonyPct, 10);
  assert.equal(metrics.dominantSource, 'biophony');
  assert.equal(metrics.dominantBand?.bandLabel, 'Mid Birds');
  assert.ok(metrics.totalEnergyDb > -40);

  // Empty bands fallback
  const empty = computeSourceMetrics([]);
  assert.equal(empty.biophonyPct, 0);
  assert.equal(empty.dominantBand, null);
});

test('computeTemporalStats extracts peak intervals and computes averages', () => {
  const temporal: TemporalActivityPoint[] = [
    { timeLabel: '05:30', timestampIso: '2026-11-21T05:30:00Z', biophonyIndex: 0.4, anthrophonyIndex: 0.2, detectionCount: 3, meanSplDb: -42 },
    { timeLabel: '05:40', timestampIso: '2026-11-21T05:40:00Z', biophonyIndex: 0.9, anthrophonyIndex: 0.1, detectionCount: 12, meanSplDb: -36 },
    { timeLabel: '05:50', timestampIso: '2026-11-21T05:50:00Z', biophonyIndex: 0.5, anthrophonyIndex: 0.6, detectionCount: 4, meanSplDb: -38 },
  ];

  const stats = computeTemporalStats(temporal);
  assert.equal(stats.peakBiophony?.timeLabel, '05:40');
  assert.equal(stats.peakBiophony?.biophonyIndex, 0.9);
  assert.equal(stats.peakAnthrophony?.timeLabel, '05:50');
  assert.equal(stats.peakAnthrophony?.anthrophonyIndex, 0.6);
  assert.equal(stats.meanBiophony, 0.6);
  assert.equal(stats.meanAnthrophony, 0.3);
  assert.equal(stats.totalDetections, 19);
  assert.equal(stats.meanSplDb, -38.7);
});

test('formatSoundscapeExportJson and formatSoundscapeExportCsv generate clean valid payloads without secrets', () => {
  const snapshot = DEMO_SOUNDSCAPES['temperate-rainforest'];
  const jsonStr = formatSoundscapeExportJson(snapshot, '2026-11-23T12:00:00.000Z');
  const parsed = JSON.parse(jsonStr);

  assert.equal(parsed.application, 'EcoSonic 3.0 Soundscape Observatory');
  assert.equal(parsed.siteName, snapshot.siteName);
  assert.equal(parsed.presetId, 'temperate-rainforest');
  assert.equal(parsed.containsCredentials, false);
  assert.equal(parsed.indices.raw.aci, 184.6);
  assert.equal(parsed.sourceComposition.biophonyPct, 75);
  assert.equal(parsed.frequencyBands.length, 5);
  assert.equal(parsed.temporalActivity.length, 6);

  const csvStr = formatSoundscapeExportCsv(snapshot, '2026-11-23T12:00:00.000Z');
  assert.ok(csvStr.includes('# EcoSonic 3.0 Soundscape Analytics Export'));
  assert.ok(csvStr.includes('### Core Acoustic Indices'));
  assert.ok(csvStr.includes('Acoustic Complexity Index,ACI,184.6,0.738'));
  assert.ok(csvStr.includes('Normalized Difference Soundscape Index,NDSI,0.68,0.84'));
  assert.ok(csvStr.includes('### Frequency Band Energy'));
  assert.ok(csvStr.includes('### Temporal Activity Profile'));
});
