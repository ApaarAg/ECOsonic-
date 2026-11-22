import { describe, it, expect } from 'vitest';

describe('Audio Resampling and Binary WebSocket Framing', () => {
  // Helper to resample Float32
  function resample(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
    if (inputRate === outputRate) return input;
    const ratio = inputRate / outputRate;
    const outputLength = Math.round(input.length / ratio);
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const position = i * ratio;
      const index = Math.floor(position);
      const frac = position - index;

      if (index + 1 < input.length) {
        output[i] = input[index] * (1 - frac) + input[index + 1] * frac;
      } else {
        output[i] = input[index] || 0;
      }
    }
    return output;
  }

  // Helper to convert Float32 to Int16
  function floatToInt16(samples: Float32Array): Int16Array {
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1.0, Math.min(1.0, samples[i]));
      pcm[i] = s < 0 ? Math.floor(s * 0x8000) : Math.floor(s * 0x7fff);
    }
    return pcm;
  }

  // Helper to frame binary packet: 4-byte big-endian uint32 + little-endian Int16
  function createBinaryFrame(seq: number, pcmSamples: Int16Array): ArrayBuffer {
    const buffer = new ArrayBuffer(4 + pcmSamples.length * 2);
    const view = new DataView(buffer);
    view.setUint32(0, seq >>> 0, false); // Big-endian (>I)
    for (let i = 0; i < pcmSamples.length; i++) {
      view.setInt16(4 + i * 2, pcmSamples[i], true); // Little-endian (<i2)
    }
    return buffer;
  }

  it('correctly resamples 48,000 Hz audio to 32,000 Hz (3:2 ratio)', () => {
    const inputLength = 4800; // 100 ms at 48kHz
    const input = new Float32Array(inputLength);
    for (let i = 0; i < inputLength; i++) {
      input[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
    }

    const resampled = resample(input, 48000, 32000);
    expect(resampled.length).toBe(3200); // exactly 100 ms at 32kHz
    // Amplitude should be preserved
    expect(Math.max(...resampled)).toBeCloseTo(1.0, 1);
  });

  it('correctly clamps and quantizes Float32 [-1.0, 1.0] to signed Int16', () => {
    const testSamples = new Float32Array([-1.5, -1.0, -0.5, 0.0, 0.5, 1.0, 1.5]);
    const pcm = floatToInt16(testSamples);

    expect(pcm[0]).toBe(-32768); // Clamped to -32768
    expect(pcm[1]).toBe(-32768); // -1.0
    expect(pcm[2]).toBe(-16384); // -0.5
    expect(pcm[3]).toBe(0); // 0.0
    expect(pcm[4]).toBe(16383); // 0.5
    expect(pcm[5]).toBe(32767); // 1.0
    expect(pcm[6]).toBe(32767); // Clamped to 32767
  });

  it('encodes binary WebSocket frame with 4-byte big-endian sequence header', () => {
    const seq = 12345;
    const samples = new Int16Array([1000, -2000, 3000]);
    const frame = createBinaryFrame(seq, samples);

    expect(frame.byteLength).toBe(4 + 3 * 2); // 10 bytes

    const view = new DataView(frame);
    // Sequence number in big-endian
    const unpackedSeq = view.getUint32(0, false);
    expect(unpackedSeq).toBe(12345);

    // Audio samples in little-endian
    expect(view.getInt16(4, true)).toBe(1000);
    expect(view.getInt16(6, true)).toBe(-2000);
    expect(view.getInt16(8, true)).toBe(3000);
  });

  it('handles uint32 sequence wraparound at 2^32 - 1', () => {
    const maxSeq = 0xffffffff;
    const samples = new Int16Array([500]);
    const frame = createBinaryFrame(maxSeq, samples);

    const view = new DataView(frame);
    expect(view.getUint32(0, false)).toBe(4294967295);

    // Next sequence is 0
    const nextSeq = (maxSeq + 1) >>> 0;
    const nextFrame = createBinaryFrame(nextSeq, samples);
    const nextView = new DataView(nextFrame);
    expect(nextView.getUint32(0, false)).toBe(0);
  });
});
