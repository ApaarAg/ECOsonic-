import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BackendEcoSonicAdapter,
  DemoEcoSonicAdapter,
  createEcoSonicAdapter,
} from './ecosonicAdapter';

test('createEcoSonicAdapter instantiates DemoEcoSonicAdapter by default', () => {
  const adapter = createEcoSonicAdapter({
    apiBaseUrl: 'http://localhost:8000',
    wsStreamUrl: 'ws://localhost:8000',
    reconnectIntervalMs: 3000,
    mode: 'demo',
  });
  assert.equal(adapter.isDemoMode, true);
  assert.equal(adapter instanceof DemoEcoSonicAdapter, true);
});

test('createEcoSonicAdapter instantiates BackendEcoSonicAdapter when mode is backend_ready', () => {
  const adapter = createEcoSonicAdapter({
    apiBaseUrl: 'http://localhost:8000',
    wsStreamUrl: 'ws://localhost:8000',
    reconnectIntervalMs: 3000,
    mode: 'backend_ready',
  });
  assert.equal(adapter.isDemoMode, false);
  assert.equal(adapter instanceof BackendEcoSonicAdapter, true);
  assert.ok(adapter.name.includes('BackendEcoSonicAdapter'));
});

test('BackendEcoSonicAdapter getDiagnostics returns healthy diagnostic structure', () => {
  const adapter = new BackendEcoSonicAdapter({
    apiBaseUrl: 'http://localhost:8000',
    wsStreamUrl: 'ws://localhost:8000',
  });
  const diag = adapter.getDiagnostics();
  assert.equal(diag.isDemoMode, false);
  assert.equal(diag.adapterStatus, 'ready');
  assert.ok(diag.protocolVersion.includes('Frozen v1 Protocol'));
});

test('DemoEcoSonicAdapter provides complete fixture datasets', async () => {
  const demoAdapter = new DemoEcoSonicAdapter();
  const sessions = await demoAdapter.fetchSessions();
  assert.ok(sessions.length > 0);

  const detections = await demoAdapter.fetchDetections();
  assert.ok(detections.length > 0);

  const disturbances = await demoAdapter.fetchDisturbances();
  assert.ok(disturbances.length > 0);

  const soundscape = await demoAdapter.fetchSoundscapeSnapshot('temperate-rainforest');
  assert.equal(soundscape.presetId, 'temperate-rainforest');
  assert.ok(soundscape.indices.aci > 0);
});

test('DemoEcoSonicAdapter fetchObservationGap returns comprehensive ecological gap model', async () => {
  const demoAdapter = new DemoEcoSonicAdapter();
  const gap = await demoAdapter.fetchObservationGap('test-session-123');

  assert.equal(gap.sessionId, 'test-session-123');
  assert.ok(gap.coverage.coveragePercentage > 0);
  assert.equal(gap.coverage.expectedSpeciesCount, 8);
  assert.equal(gap.coverage.detectedExpectedCount, 5);
  assert.equal(gap.coverage.gapCount, 3);
  assert.equal(gap.coverage.detectedUnexpectedCount, 1);
  assert.equal(gap.coverage.observationAdequacy, 'adequate');

  // Verify non-detection ≠ absence semantics
  assert.ok(gap.expectedButNotDetected.length === 3);
  gap.expectedButNotDetected.forEach((sp) => {
    assert.equal(sp.notDetected, true);
    assert.equal(sp.evidenceStatus, 'insufficient_evidence_for_absence');
  });

  // Verify scientific disclaimer is present
  assert.ok(gap.scientificDisclaimer.includes('does not constitute scientific evidence of local biological absence'));
});

test('DemoEcoSonicAdapter fetchExpectedSpeciesBaseline merges and deterministically sorts expected taxa', async () => {
  const demoAdapter = new DemoEcoSonicAdapter();
  const baseline = await demoAdapter.fetchExpectedSpeciesBaseline();

  assert.equal(baseline.isDemo, true);
  assert.equal(baseline.source, 'demo_fixture');
  assert.equal(baseline.expectedSpecies.length, 8);
  // Highest occurrenceScore first (Pacific Wren: 0.89)
  assert.equal(baseline.expectedSpecies[0].scientificName, 'Troglodytes pacificus');
  assert.ok(baseline.disclaimer.includes('does not imply presence or absence'));
});

test('BackendEcoSonicAdapter fetchExpectedSpeciesBaseline surfaces errors instead of fabricating demo birds', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('ECONNREFUSED localhost:8000');
  }) as typeof fetch;

  try {
    const backendAdapter = new BackendEcoSonicAdapter({
      apiBaseUrl: 'http://localhost:8000',
      wsStreamUrl: 'ws://localhost:8000',
    });

    await assert.rejects(
      () => backendAdapter.fetchExpectedSpeciesBaseline(),
      /ECONNREFUSED/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
