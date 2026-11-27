import { acousticStore } from "../domain/acousticStore";
import { getOrCreateSharedAudioContext } from "./sharedAudioContext";

const TARGET_SAMPLE_RATE = 32000;
const CHUNK_DURATION_MS = 250;
const TARGET_CHUNK_SAMPLES = (TARGET_SAMPLE_RATE * CHUNK_DURATION_MS) / 1000; // 8,000 samples (16,000 bytes PCM16)

const WORKLET_CODE = `
class EcosonicMeterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._prevRms = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }
    const channels = input.length;
    const len = input[0].length;
    const mono = new Float32Array(len);
    let sumSq = 0;
    let peak = 0;
    let zeroCrossings = 0;
    let prev = 0;

    for (let i = 0; i < len; i++) {
      let s = 0;
      for (let c = 0; c < channels; c++) {
        s += input[c][i];
      }
      s /= channels;
      mono[i] = s;
      sumSq += s * s;
      const abs = s < 0 ? -s : s;
      if (abs > peak) peak = abs;
      if (i > 0 && ((s >= 0 && prev < 0) || (s < 0 && prev >= 0))) {
        zeroCrossings++;
      }
      prev = s;
    }

    const rms = Math.min(1, Math.sqrt(sumSq / len) * 3.2);
    const centroid = Math.min(1, zeroCrossings / (len * 0.45));
    const flux = Math.min(1, Math.abs(rms - this._prevRms) * 4.5);
    this._prevRms = rms;

    this.port.postMessage(
      {
        rms,
        peak: Math.min(1, peak),
        centroid,
        flux,
        pcm: mono,
        postedAt: currentTime,
      },
      [mono.buffer],
    );
    return true;
  }
}
registerProcessor("ecosonic-meter", EcosonicMeterProcessor);
`;

/**
 * Band-limited Blackman-windowed sinc resampler to guarantee exact 32,000 Hz
 * mono input for BirdNET V3.0 regardless of browser/OS native sample rate.
 */
export class BandLimitedResampler {
  private readonly numTaps: number;
  private readonly halfTaps: number;
  private readonly inputRate: number;
  private readonly outputRate: number;
  private readonly inputRateInt: number;
  private readonly outputRateInt: number;
  private readonly phaseDivisor: number;
  private readonly phaseCount: number;
  private readonly phaseKernels: Float32Array;
  private readonly cutoffRatio: number;
  private inputBuffer = new Float32Array(0);
  private inputBufferStart = 0;
  private totalInputSamples = 0;
  private nextOutputIndex = 0;
  private flushed = false;

  constructor(
    inputRate: number,
    outputRate = TARGET_SAMPLE_RATE,
    numTaps = 31,
  ) {
    this.inputRate = inputRate;
    this.outputRate = outputRate;
    if (!Number.isFinite(inputRate) || inputRate <= 0 || !Number.isFinite(outputRate) || outputRate <= 0) {
      throw new Error("Resampler sample rates must be positive finite values.");
    }
    this.inputRateInt = Math.round(inputRate);
    this.outputRateInt = Math.round(outputRate);
    this.numTaps = numTaps % 2 === 0 ? numTaps + 1 : numTaps;
    this.halfTaps = Math.floor(this.numTaps / 2);
    this.phaseDivisor = this.greatestCommonDivisor(this.inputRateInt, this.outputRateInt);
    this.phaseCount = this.outputRateInt / this.phaseDivisor;
    this.cutoffRatio =
      0.45 * Math.min(1, this.outputRate / this.inputRate);
    this.phaseKernels = this.designPhaseKernels();
  }

  private greatestCommonDivisor(a: number, b: number): number {
    while (b !== 0) {
      const remainder = a % b;
      a = b;
      b = remainder;
    }
    return Math.max(1, a);
  }

  private designPhaseKernels(): Float32Array {
    const kernels = new Float32Array(this.phaseCount * this.numTaps);
    for (let phase = 0; phase < this.phaseCount; phase++) {
      const fraction = phase / this.phaseCount;
      let sum = 0;
      for (let tap = 0; tap < this.numTaps; tap++) {
        const offset = tap - this.halfTaps;
        const distance = fraction - offset;
        const x = 2 * this.cutoffRatio * distance;
        const sinc = Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
        const window =
          0.42 -
          0.5 * Math.cos((2 * Math.PI * tap) / (this.numTaps - 1)) +
          0.08 * Math.cos((4 * Math.PI * tap) / (this.numTaps - 1));
        const index = phase * this.numTaps + tap;
        const weight = 2 * this.cutoffRatio * sinc * window;
        kernels[index] = weight;
        sum += weight;
      }
      if (sum !== 0) {
        const base = phase * this.numTaps;
        for (let tap = 0; tap < this.numTaps; tap++) kernels[base + tap] /= sum;
      }
    }
    return kernels;
  }

  private sourcePosition(outputIndex: number): { center: number; phase: number } {
    const numerator = outputIndex * this.inputRateInt;
    const remainder = numerator % this.outputRateInt;
    return {
      center: Math.floor(numerator / this.outputRateInt),
      phase: Math.floor(remainder / this.phaseDivisor),
    };
  }

  public process(input: Float32Array): Float32Array {
    if (this.flushed) {
      throw new Error("Cannot process audio after the streaming resampler is flushed.");
    }
    if (this.inputRate === this.outputRate) {
      this.totalInputSamples += input.length;
      this.nextOutputIndex += input.length;
      return input;
    }
    if (input.length === 0) return new Float32Array(0);

    const appended = new Float32Array(this.inputBuffer.length + input.length);
    appended.set(this.inputBuffer);
    appended.set(input, this.inputBuffer.length);
    this.inputBuffer = appended;
    this.totalInputSamples += input.length;
    return this.produce(false);
  }

  /** Emit the deterministic filter tail when capture stops. */
  public flush(): Float32Array {
    if (this.flushed) return new Float32Array(0);
    this.flushed = true;
    if (this.inputRate === this.outputRate || this.totalInputSamples === 0) {
      return new Float32Array(0);
    }
    return this.produce(true);
  }

  private produce(finalChunk: boolean): Float32Array {
    const outputCount = finalChunk
      ? Math.round((this.totalInputSamples * this.outputRate) / this.inputRate)
      : Number.POSITIVE_INFINITY;
    const output: number[] = [];
    while (this.nextOutputIndex < outputCount) {
      const { center, phase } = this.sourcePosition(this.nextOutputIndex);
      if (!finalChunk && center + this.halfTaps >= this.totalInputSamples) break;

      let value = 0;
      const kernelOffset = phase * this.numTaps;
      for (let tap = 0; tap < this.numTaps; tap++) {
        const offset = tap - this.halfTaps;
        const sourceIndex = center + offset;
        value +=
          this.readSample(sourceIndex, finalChunk) *
          this.phaseKernels[kernelOffset + tap];
      }
      output.push(value);
      this.nextOutputIndex++;
    }

    if (!finalChunk) {
      const { center: nextCenter } = this.sourcePosition(this.nextOutputIndex);
      const keepFrom = Math.max(0, nextCenter - this.halfTaps - 1);
      const discardCount = Math.min(
        this.inputBuffer.length,
        Math.max(0, keepFrom - this.inputBufferStart),
      );
      if (discardCount > 0) {
        this.inputBuffer = this.inputBuffer.slice(discardCount);
        this.inputBufferStart += discardCount;
      }
    }
    return Float32Array.from(output);
  }

  private readSample(index: number, finalChunk: boolean): number {
    if (index < 0) return this.inputBuffer[0] ?? 0;
    if (index >= this.totalInputSamples) {
      return finalChunk ? (this.inputBuffer[this.inputBuffer.length - 1] ?? 0) : 0;
    }
    const localIndex = index - this.inputBufferStart;
    return localIndex >= 0 && localIndex < this.inputBuffer.length
      ? this.inputBuffer[localIndex]
      : 0;
  }
}

/** Quantize normalized Float32 [-1, 1] to signed 16-bit little-endian PCM (<i2). */
export function floatToPcm16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1.0, Math.min(1.0, samples[i]));
    pcm[i] = s < 0 ? Math.floor(s * 0x8000) : Math.floor(s * 0x7fff);
  }
  return pcm;
}

export interface MicrophoneCaptureHandle {
  stop: () => Promise<void>;
  /** PCM output rate required by the live backend. */
  sampleRate: number;
  /** Actual rate delivered to the Web Audio input callback. */
  inputSampleRate: number;
  /** Browser-reported microphone track rate, when exposed. */
  trackSampleRate: number | null;
  getStats: () => MicrophoneCaptureStats;
}

export interface MicrophoneCaptureStats {
  audioCallbacks: number;
  inputSamples: number;
  resampledSamples: number;
  emittedFrames: number;
  resamplingTotalMs: number;
  packetizationTotalMs: number;
  callbackTotalMs: number;
  callbackMaxMs: number;
}

export async function startMicrophoneCapture(
  onPcm16Chunk: (chunk: Int16Array) => boolean | void,
): Promise<MicrophoneCaptureHandle> {
  if (typeof onPcm16Chunk !== "function") {
    throw new Error("capture_unavailable: a PCM16 transport callback is required.");
  }
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.getUserMedia
  ) {
    throw new Error("Microphone capture is unavailable in this environment.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: { ideal: 1 },
      sampleRate: { ideal: TARGET_SAMPLE_RATE },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  const context = getOrCreateSharedAudioContext(TARGET_SAMPLE_RATE);
  if (!context) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("Web Audio API is unavailable in this environment.");
  }
  try {
    if (context.state === "suspended") await context.resume();
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error(`capture_unavailable: AudioContext could not start (${String(error)}).`);
  }

  const track = stream.getAudioTracks()[0];
  const trackRate = track?.getSettings().sampleRate;
  const trackSampleRate =
    typeof trackRate === "number" && Number.isFinite(trackRate) && trackRate > 0
      ? trackRate
      : null;
  // AudioWorklet and ScriptProcessor input frames are clocked at the actual
  // AudioContext rate, which can differ from the browser's track setting.
  const inputSampleRate = context.sampleRate;
  if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0) {
    stream.getTracks().forEach((audioTrack) => audioTrack.stop());
    throw new Error("capture_unavailable: browser did not report an input sample rate.");
  }

  const resampler = new BandLimitedResampler(
    inputSampleRate,
    TARGET_SAMPLE_RATE,
    31,
  );

  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.72;
  source.connect(analyser);

  const freqBins = new Uint8Array(analyser.frequencyBinCount);
  const bands: [number, number, number, number] = [0, 0, 0, 0];

  const computeBands = () => {
    analyser.getByteFrequencyData(freqBins);
    const len = freqBins.length;
    const ranges: [number, number][] = [
      [0, Math.floor(len * 0.08)],
      [Math.floor(len * 0.08), Math.floor(len * 0.28)],
      [Math.floor(len * 0.28), Math.floor(len * 0.62)],
      [Math.floor(len * 0.62), len],
    ];
    for (let b = 0; b < 4; b++) {
      const [start, end] = ranges[b];
      let sum = 0;
      const count = Math.max(1, end - start);
      for (let i = start; i < end; i++) {
        sum += freqBins[i];
      }
      bands[b] = Math.min(1, sum / (count * 255));
    }
  };

  let workletNode: AudioWorkletNode | null = null;
  let fallbackNode: ScriptProcessorNode | null = null;
  let blobUrl: string | null = null;
  let stopped = false;

  const pcmRing = new Float32Array(TARGET_CHUNK_SAMPLES);
  let pcmOffset = 0;
  const captureStats: MicrophoneCaptureStats = {
    audioCallbacks: 0,
    inputSamples: 0,
    resampledSamples: 0,
    emittedFrames: 0,
    resamplingTotalMs: 0,
    packetizationTotalMs: 0,
    callbackTotalMs: 0,
    callbackMaxMs: 0,
  };

  const pushResampledPcm = (rawMono: Float32Array) => {
    const resampleStartedAt = performance.now();
    const resampled = resampler.process(rawMono);
    captureStats.resamplingTotalMs += performance.now() - resampleStartedAt;
    captureStats.resampledSamples += resampled.length;
    const packetizationStartedAt = performance.now();
    let srcOffset = 0;
    while (srcOffset < resampled.length) {
      const remaining = TARGET_CHUNK_SAMPLES - pcmOffset;
      const copyCount = Math.min(remaining, resampled.length - srcOffset);
      pcmRing.set(
        resampled.subarray(srcOffset, srcOffset + copyCount),
        pcmOffset,
      );
      pcmOffset += copyCount;
      srcOffset += copyCount;
      if (pcmOffset >= TARGET_CHUNK_SAMPLES) {
        const accepted = onPcm16Chunk(floatToPcm16(pcmRing));
        captureStats.emittedFrames += 1;
        if (accepted === false) {
          acousticStore.setSessionState({
            status: "error",
            lastError: "PCM transport is not open; microphone capture stopped sending audio.",
          });
        }
        pcmOffset = 0;
      }
    }
    captureStats.packetizationTotalMs += performance.now() - packetizationStartedAt;
  };

  const measureAndSend = (mono: Float32Array, postedAt?: number) => {
    if (stopped) return;
    const t0 = performance.now();
    captureStats.audioCallbacks += 1;
    captureStats.inputSamples += mono.length;
    let sumSq = 0;
    let peak = 0;
    let zeroCrossings = 0;
    let previous = mono[0] ?? 0;
    for (let i = 0; i < mono.length; i++) {
      const sample = mono[i];
      sumSq += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
      if (i > 0 && ((sample >= 0 && previous < 0) || (sample < 0 && previous >= 0))) {
        zeroCrossings++;
      }
      previous = sample;
    }
    const rms = Math.min(1, Math.sqrt(sumSq / Math.max(1, mono.length)) * 3.2);
    const centroid = Math.min(1, zeroCrossings / Math.max(1, mono.length * 0.45));
    computeBands();
    pushResampledPcm(mono);
    const graphLatencyMs =
      typeof postedAt === "number"
        ? Math.max(0, (context.currentTime - postedAt) * 1000)
        : 0;
    acousticStore.pushAudioFrame(
      rms,
      Math.min(1, peak),
      bands,
      centroid,
      0,
      "microphone",
      TARGET_SAMPLE_RATE,
      graphLatencyMs + (performance.now() - t0),
    );
    const callbackMs = performance.now() - t0;
    captureStats.callbackTotalMs += callbackMs;
    captureStats.callbackMaxMs = Math.max(captureStats.callbackMaxMs, callbackMs);
  };

  if (context.audioWorklet && typeof Blob !== "undefined") {
    try {
      blobUrl = URL.createObjectURL(
        new Blob([WORKLET_CODE], { type: "application/javascript" }),
      );
      await context.audioWorklet.addModule(blobUrl);
      workletNode = new AudioWorkletNode(context, "ecosonic-meter");
      workletNode.port.onmessage = (event) => {
        const { pcm, postedAt } = event.data as {
          pcm: Float32Array;
          postedAt?: number;
        };
        if (pcm) {
          measureAndSend(pcm, postedAt);
        }
      };
      source.connect(workletNode);
      // Connect to a silent gain node so the worklet processes without speaker feedback
      const silentGain = context.createGain();
      silentGain.gain.value = 0;
      workletNode.connect(silentGain);
      silentGain.connect(context.destination);
    } catch {
      workletNode = null;
    }
  }

  // Use ScriptProcessor only as a PCM-producing compatibility fallback.
  // An analyser-only fallback would animate the UI while sending zero audio.
  if (!workletNode) {
    try {
      const channelCount = Math.max(1, track?.getSettings().channelCount ?? 1);
      fallbackNode = context.createScriptProcessor(4096, channelCount, 1);
      fallbackNode.onaudioprocess = (event) => {
        const input = event.inputBuffer;
        const channels: Float32Array[] = [];
        for (let channel = 0; channel < input.numberOfChannels; channel++) {
          channels.push(input.getChannelData(channel));
        }
        const mono = new Float32Array(input.length);
        for (let i = 0; i < mono.length; i++) {
          let sum = 0;
          for (const channel of channels) sum += channel[i] ?? 0;
          mono[i] = channels.length ? sum / channels.length : 0;
        }
        measureAndSend(mono);
        const output = event.outputBuffer;
        for (let channel = 0; channel < output.numberOfChannels; channel++) {
          output.getChannelData(channel).fill(0);
        }
      };
      source.connect(fallbackNode);
      const silentGain = context.createGain();
      silentGain.gain.value = 0;
      fallbackNode.connect(silentGain);
      silentGain.connect(context.destination);
    } catch (error) {
      source.disconnect();
      stream.getTracks().forEach((audioTrack) => audioTrack.stop());
      acousticStore.setSessionState({
        status: "error",
        lastError: `capture_unavailable: AudioWorklet and PCM fallback failed (${String(error)}).`,
      });
      throw new Error(`capture_unavailable: AudioWorklet and PCM fallback failed (${String(error)}).`);
    }
  }

  return {
    sampleRate: TARGET_SAMPLE_RATE,
    inputSampleRate,
    trackSampleRate,
    getStats: () => ({ ...captureStats }),
    stop: async () => {
      if (stopped) return;
      stopped = true;
      if (workletNode) {
        workletNode.port.onmessage = null;
        workletNode.disconnect();
      }
      if (fallbackNode) {
        fallbackNode.onaudioprocess = null;
        fallbackNode.disconnect();
      }
      source.disconnect();
      // Drain filter state after disconnecting capture nodes so no in-flight callback runs post-flush.
      const tail = resampler.flush();
      captureStats.resampledSamples += tail.length;
      let tailOffset = 0;
      while (tailOffset < tail.length) {
        const copyCount = Math.min(TARGET_CHUNK_SAMPLES - pcmOffset, tail.length - tailOffset);
        pcmRing.set(tail.subarray(tailOffset, tailOffset + copyCount), pcmOffset);
        pcmOffset += copyCount;
        tailOffset += copyCount;
        if (pcmOffset === TARGET_CHUNK_SAMPLES) {
          onPcm16Chunk(floatToPcm16(pcmRing));
          pcmOffset = 0;
        }
      }
      // A trailing sub-frame is intentionally discarded; the backend accepts
      // only complete 250 ms transport frames and 3-second inference windows.
      pcmOffset = 0;
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
      for (const track of stream.getTracks()) {
        track.stop();
      }
      acousticStore.setAudioSource("silent");
      acousticStore.setSessionState({ status: "idle" });
    },
  };
}
