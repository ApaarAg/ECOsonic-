import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BandLimitedResampler,
  startMicrophoneCapture,
} from "./ecosonicAudioCapture";

function collect(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function sine(rate: number, sampleCount: number, hz = 997): Float32Array {
  return Float32Array.from(
    { length: sampleCount },
    (_, i) => 0.4 * Math.sin((2 * Math.PI * hz * i) / rate),
  );
}

describe("streaming 32 kHz resampler", () => {
  it("preserves cumulative phase for repeated 128-sample callbacks at 48 kHz", () => {
    const input = sine(48000, 48000);
    const resampler = new BandLimitedResampler(48000);
    const output: Float32Array[] = [];
    for (let offset = 0; offset < input.length; offset += 128) {
      output.push(resampler.process(input.subarray(offset, offset + 128)));
    }
    output.push(resampler.flush());
    expect(collect(output)).toHaveLength(32000);
  });

  it("preserves cumulative phase for 44.1 kHz 128-sample callbacks and a final short callback", () => {
    const input = sine(44100, 44100);
    const resampler = new BandLimitedResampler(44100);
    const output: Float32Array[] = [];
    for (let offset = 0; offset < input.length; offset += 128) {
      output.push(resampler.process(input.subarray(offset, Math.min(offset + 128, input.length))));
    }
    output.push(resampler.flush());
    expect(collect(output)).toHaveLength(32000);
  });

  it("passes native 32 kHz samples through without resampling or drift", () => {
    const input = sine(32000, 32000);
    const resampler = new BandLimitedResampler(32000);
    const output: Float32Array[] = [];
    for (let offset = 0; offset < input.length; offset += 128) {
      output.push(resampler.process(input.subarray(offset, offset + 128)));
    }
    output.push(resampler.flush());
    const actual = collect(output);
    expect(actual).toHaveLength(input.length);
    expect(actual).toEqual(input);
  });

  it("matches one large buffer across arbitrary callback boundaries without discontinuities", () => {
    const input = sine(44100, 44100 * 3);
    const whole = new BandLimitedResampler(44100);
    const expected = collect([whole.process(input), whole.flush()]);

    const streaming = new BandLimitedResampler(44100);
    const blocks: Float32Array[] = [];
    for (let offset = 0; offset < input.length; offset += 128) {
      blocks.push(streaming.process(input.subarray(offset, Math.min(offset + 128, input.length))));
    }
    blocks.push(streaming.flush());
    const actual = collect(blocks);

    expect(actual).toHaveLength(expected.length);
    let maxChunkBoundaryDifference = 0;
    let maxAdjacentStep = 0;
    let maxAdjacentStepIndex = 0;
    for (let i = 0; i < actual.length; i++) {
      maxChunkBoundaryDifference = Math.max(
        maxChunkBoundaryDifference,
        Math.abs(actual[i] - expected[i]),
      );
      if (i > 0) {
        const step = Math.abs(actual[i] - actual[i - 1]);
        if (step > maxAdjacentStep) {
          maxAdjacentStep = step;
          maxAdjacentStepIndex = i;
        }
      }
    }
    expect(maxChunkBoundaryDifference).toBeLessThan(1e-6);
    expect(maxAdjacentStep, `large jump at sample ${maxAdjacentStepIndex}`).toBeLessThan(0.2);
  });
});

describe("PCM-producing ScriptProcessor fallback", () => {
  const originalAudioContext = Object.getOwnPropertyDescriptor(window, "AudioContext");
  const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");

  afterEach(() => {
    if (originalAudioContext) Object.defineProperty(window, "AudioContext", originalAudioContext);
    else Reflect.deleteProperty(window, "AudioContext");
    if (originalMediaDevices) Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
    else Reflect.deleteProperty(navigator, "mediaDevices");
  });

  it("downmixes microphone input and emits complete 8,000-sample PCM16 frames", async () => {
    class FakeNode {
      onaudioprocess: ((event: AudioProcessingEvent) => void) | null = null;
      connect() {}
      disconnect() {}
    }
    class FakeContext {
      readonly sampleRate = 48000;
      readonly currentTime = 0;
      readonly state = "running";
      readonly destination = {} as AudioDestinationNode;
      readonly processor = new FakeNode();
      constructor(_options?: AudioContextOptions) {}
      createMediaStreamSource() {
        return new FakeNode() as unknown as MediaStreamAudioSourceNode;
      }
      createAnalyser() {
        return {
          fftSize: 256,
          smoothingTimeConstant: 0,
          frequencyBinCount: 128,
          getByteFrequencyData: (bins: Uint8Array) => bins.fill(0),
        } as unknown as AnalyserNode;
      }
      createScriptProcessor() {
        return this.processor as unknown as ScriptProcessorNode;
      }
      createGain() {
        return Object.assign(new FakeNode(), { gain: { value: 1 } }) as unknown as GainNode;
      }
      resume() {
        return Promise.resolve();
      }
    }

    const track = {
      getSettings: () => ({ sampleRate: 44100, channelCount: 2 }),
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const stream = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: FakeContext,
    });

    const frames: Int16Array[] = [];
    const capture = await startMicrophoneCapture((frame) => {
      frames.push(frame);
      return true;
    });

    const context = (await import("./sharedAudioContext")).getExistingSharedAudioContext() as unknown as FakeContext;
    const processor = context.processor;
    const left = new Float32Array(4096);
    const right = new Float32Array(4096);
    for (let i = 0; i < left.length; i++) {
      left[i] = Math.sin((2 * Math.PI * 900 * i) / 48000) * 0.25;
      right[i] = left[i] * 0.5;
    }
    const output = new Float32Array(4096);
    for (let block = 0; block < 3; block++) {
      processor.onaudioprocess?.({
        inputBuffer: {
          length: 4096,
          numberOfChannels: 2,
          getChannelData: (channel: number) => (channel === 0 ? left : right),
        },
        outputBuffer: {
          numberOfChannels: 1,
          getChannelData: () => output,
        },
      } as unknown as AudioProcessingEvent);
    }

    expect(capture.inputSampleRate).toBe(48000);
    expect(capture.trackSampleRate).toBe(44100);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0]).toHaveLength(8000);
    expect(frames[0].some((sample) => sample !== 0)).toBe(true);
    await capture.stop();
    expect(track.stop).toHaveBeenCalled();
  });
});
