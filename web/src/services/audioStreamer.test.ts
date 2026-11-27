import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BandLimitedResampler,
  createBinaryFrame,
  floatToPcm16,
} from './audioStreamer';

test('floatToPcm16 quantizes Float32 [-1, 1] to signed 16-bit little-endian PCM', () => {
  const input = new Float32Array([-1.0, -0.5, 0.0, 0.5, 1.0, 1.5, -2.0]);
  const pcm = floatToPcm16(input);

  assert.equal(pcm.length, input.length);
  assert.equal(pcm[0], -32768); // Minimum signed 16-bit
  assert.ok(pcm[1] < 0 && pcm[1] > -32768);
  assert.equal(pcm[2], 0);
  assert.ok(pcm[3] > 0 && pcm[3] < 32767);
  assert.equal(pcm[4], 32767); // Clamped maximum signed 16-bit
  assert.equal(pcm[5], 32767); // Saturated clamp
  assert.equal(pcm[6], -32768); // Saturated clamp
});

test('createBinaryFrame builds 4-byte big-endian sequence header followed by PCM16 bytes', () => {
  const pcm = new Int16Array([1000, -2000, 3000, -4000]);
  const seqNum = 42;
  const frame = createBinaryFrame(seqNum, pcm);

  assert.equal(frame.byteLength, 4 + pcm.length * 2); // 4 + 8 = 12 bytes
  const view = new DataView(frame);

  // Big-endian uint32 sequence header
  assert.equal(view.getUint32(0, false), 42);

  // Little-endian int16 audio samples
  assert.equal(view.getInt16(4, true), 1000);
  assert.equal(view.getInt16(6, true), -2000);
  assert.equal(view.getInt16(8, true), 3000);
  assert.equal(view.getInt16(10, true), -4000);
});

test('BandLimitedResampler correctly resamples 48,000 Hz input to 32,000 Hz with FIR filter', () => {
  const inputRate = 48000;
  const outputRate = 32000;
  const resampler = new BandLimitedResampler(inputRate, outputRate, 31);

  // Generate 480 samples (10 ms at 48 kHz) of a 1 kHz test tone
  const inputSamples = new Float32Array(480);
  for (let i = 0; i < inputSamples.length; i++) {
    inputSamples[i] = Math.sin((2 * Math.PI * 1000 * i) / inputRate) * 0.8;
  }

  const resampled = resampler.process(inputSamples);

  // Expected output length: 480 * (32000 / 48000) = 320 samples
  assert.equal(resampled.length, 320);

  // Ensure output samples are non-empty and bounded within [-1.0, 1.0]
  for (let i = 0; i < resampled.length; i++) {
    assert.ok(resampled[i] >= -1.0 && resampled[i] <= 1.0, `Sample ${i} out of bounds: ${resampled[i]}`);
  }
});

test('BandLimitedResampler passes through when input rate matches target rate', () => {
  const resampler = new BandLimitedResampler(32000, 32000);
  const input = new Float32Array([0.1, 0.2, 0.3, 0.4]);
  const output = resampler.process(input);
  assert.equal(output, input);
});

test('createBinaryFrame generates exact 16,004 byte frame for 250ms at 32kHz with strictly monotonic sequences', () => {
  const samples250ms = new Int16Array(8000);
  for (let seq = 0; seq < 10; seq++) {
    const frame = createBinaryFrame(seq, samples250ms);
    assert.equal(frame.byteLength, 16004, 'Frame must be exactly 16,004 bytes (4-byte header + 16,000-byte PCM16)');

    const view = new DataView(frame);
    assert.equal(view.getUint32(0, false), seq, `Header sequence must equal ${seq}`);
  }
});

test('createBinaryFrame handles uint32 maximum boundary correctly', () => {
  const pcm = new Int16Array([50, -50]);
  const maxUint32 = 0xffffffff;
  const frame = createBinaryFrame(maxUint32, pcm);
  const view = new DataView(frame);
  assert.equal(view.getUint32(0, false), maxUint32);
});
