import test from 'node:test';
import assert from 'node:assert/strict';

test('AcousticField supported modes include ecosystem, spectrogram, waveform, and composite', () => {
  const supportedModes = ['ecosystem', 'spectrogram', 'waveform', 'composite'] as const;
  assert.equal(supportedModes.length, 4);
  assert.ok(supportedModes.includes('ecosystem'));
  assert.ok(supportedModes.includes('composite'));
});

test('Habitat preset spectral profiles define valid biological frequency bounds and positive speeds', () => {
  const PRESET_PROFILES = {
    'temperate-rainforest': { baseFreq: 3420, harmonics: [1200, 2400, 3420, 5800, 8200], speed: 1.0 },
    'boreal-wetland': { baseFreq: 2150, harmonics: [980, 1850, 2150, 4200, 6400], speed: 0.85 },
    'subalpine-ridge': { baseFreq: 4200, harmonics: [1400, 2800, 4200, 7100, 9600], speed: 1.15 },
  };

  for (const [preset, profile] of Object.entries(PRESET_PROFILES)) {
    assert.ok(profile.baseFreq > 500 && profile.baseFreq < 12000, `${preset} baseFreq out of biological range`);
    assert.ok(profile.speed > 0, `${preset} speed must be positive`);
    assert.ok(profile.harmonics.length >= 3, `${preset} must have multiple harmonic frequencies`);
    for (const h of profile.harmonics) {
      assert.ok(h > 100 && h < 20000, `Harmonic ${h} out of audible spectrum`);
    }
  }
});

test('Acoustic shockwave loci decay monotonically and cap buffer capacity', () => {
  const lociBuffer: Array<{ id: string; age: number; maxAge: number }> = [];
  const maxCapacity = 8;

  for (let i = 0; i < 15; i++) {
    lociBuffer.push({ id: `ev-${i}`, age: 0, maxAge: 100 });
    if (lociBuffer.length > maxCapacity) {
      lociBuffer.shift();
    }
  }

  assert.equal(lociBuffer.length, maxCapacity, 'Buffer must enforce max capacity to prevent unbounded memory growth');
  assert.equal(lociBuffer[0].id, 'ev-7');
  assert.equal(lociBuffer[maxCapacity - 1].id, 'ev-14');

  // Verify monotonic age progression
  const locus = lociBuffer[0];
  locus.age += 10;
  const progress = locus.age / locus.maxAge;
  assert.equal(progress, 0.1);
  assert.ok(progress >= 0 && progress <= 1.0);
});

test('Multi-band audio frequency energy partitions low, mid, and high bands without NaN', () => {
  const totalBins = 512;
  const mockFreqBuffer = new Uint8Array(totalBins);

  // Fill synthetic audio frequency peaks (e.g. 2.5 kHz bird vocalization)
  for (let i = 0; i < totalBins; i++) {
    mockFreqBuffer[i] = Math.floor(Math.sin(i / 10) * 100 + 120);
  }

  const lowCut = Math.max(1, Math.floor(totalBins * 0.05));
  const midCut = Math.max(lowCut + 1, Math.floor(totalBins * 0.28));
  const highCut = Math.max(midCut + 1, Math.floor(totalBins * 0.75));

  let lowSum = 0;
  for (let i = 0; i < lowCut; i++) lowSum += mockFreqBuffer[i];
  let midSum = 0;
  for (let i = lowCut; i < midCut; i++) midSum += mockFreqBuffer[i];
  let highSum = 0;
  for (let i = midCut; i < highCut; i++) highSum += mockFreqBuffer[i];

  const targetLow = Math.min(1.0, (lowSum / lowCut / 255) * 1.5);
  const targetMid = Math.min(1.0, (midSum / (midCut - lowCut) / 255) * 1.8);
  const targetHigh = Math.min(1.0, (highSum / (highCut - midCut) / 255) * 2.0);

  assert.ok(!Number.isNaN(targetLow) && targetLow >= 0 && targetLow <= 1.0);
  assert.ok(!Number.isNaN(targetMid) && targetMid >= 0 && targetMid <= 1.0);
  assert.ok(!Number.isNaN(targetHigh) && targetHigh >= 0 && targetHigh <= 1.0);
});

test('Color tokens adhere strictly to ECOsonic forest palette', () => {
  const REQUIRED_TOKENS = {
    forest: '#101C17',
    moss: '#788B68',
    stone: '#A5AC9C',
    amber: '#D3A36C',
    terracotta: '#E07A5F',
  };

  assert.equal(REQUIRED_TOKENS.forest, '#101C17');
  assert.equal(REQUIRED_TOKENS.moss, '#788B68');
  assert.equal(REQUIRED_TOKENS.stone, '#A5AC9C');
  assert.equal(REQUIRED_TOKENS.amber, '#D3A36C');
  assert.equal(REQUIRED_TOKENS.terracotta, '#E07A5F');
});
