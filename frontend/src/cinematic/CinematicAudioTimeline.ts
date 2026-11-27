import birdsForestUrl from "../assets/audio/birds_forest.ogg";
import {
  getExistingSharedAudioContext,
  getOrCreateSharedAudioContext,
} from "../api/sharedAudioContext";
import type { AudioTimelineEnvelope } from "./CinematicTransition";

export interface AmbientAudioSnapshot {
  unlocked: boolean;
  muted: boolean;
  birdTrackLoaded: boolean;
}

/**
 * Single-AudioContext continuous ambient acoustic engine spanning Acts 01-12.
 * Layers the public-domain Fontainebleau forest bird recording (birds_forest.ogg)
 * as spaced, cosine-crossfaded spatial phrases over a quiet nocturnal air/harmonic bed.
 *
 * - Never triggers autoplay before a trusted user interaction.
 * - Avoids audible loop cuts via tapered staggered overlapping phrases.
 * - Exposes clean mute/unmute state and ducks to zero during live mic capture or SILENCE.
 */
export class ContinuousAudioTimeline {
  private initialized = false;
  private disposed = false;
  private muted = false;
  private unlocked = false;
  private birdTrackLoaded = false;
  private birdLoadStarted = false;
  private lastGateActive = true;

  private masterGain: GainNode | null = null;
  private airGain: GainNode | null = null;
  private harmonicGain: GainNode | null = null;
  private waterGain: GainNode | null = null;
  private filterNode: BiquadFilterNode | null = null;

  private birdBusGain: GainNode | null = null;
  private birdDistanceFilter: BiquadFilterNode | null = null;
  private birdBuffer: AudioBuffer | null = null;
  private activeBirdSources = new Set<AudioBufferSourceNode>();
  private birdScheduleTimer: number | null = null;
  private birdPhraseIndex = 0;

  private noiseSource: AudioBufferSourceNode | null = null;
  private oscLow: OscillatorNode | null = null;
  private oscFifth: OscillatorNode | null = null;
  private oscHigh: OscillatorNode | null = null;

  private readonly listeners = new Set<() => void>();
  private snapshot: AmbientAudioSnapshot = {
    unlocked: false,
    muted: false,
    birdTrackLoaded: false,
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): AmbientAudioSnapshot => this.snapshot;

  private emit(): void {
    const next: AmbientAudioSnapshot = {
      unlocked: this.unlocked,
      muted: this.muted,
      birdTrackLoaded: this.birdTrackLoaded,
    };
    if (
      next.unlocked === this.snapshot.unlocked &&
      next.muted === this.snapshot.muted &&
      next.birdTrackLoaded === this.snapshot.birdTrackLoaded
    ) {
      return;
    }
    this.snapshot = next;
    for (const listener of this.listeners) {
      listener();
    }
  }

  unlock(): boolean {
    if (this.disposed || typeof window === "undefined") return false;
    const ctx = getOrCreateSharedAudioContext(32000);
    if (!ctx) return false;

    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
    }

    if (!this.initialized) {
      this.setupGraph(ctx);
      this.initialized = true;
    }

    if (!this.birdLoadStarted) {
      this.birdLoadStarted = true;
      void this.loadBirdRecording(ctx);
    }

    if (!this.unlocked) {
      this.unlocked = true;
      this.emit();
    }

    if (this.birdTrackLoaded && !this.muted && this.birdScheduleTimer === null) {
      this.scheduleNextBirdPhrase(180);
    }

    return true;
  }

  setMuted(muted: boolean): void {
    if (this.muted === muted) return;
    this.muted = muted;
    this.emit();

    const ctx = getExistingSharedAudioContext();
    if (!ctx || !this.masterGain || !this.birdBusGain) return;
    const now = ctx.currentTime;
    if (muted) {
      this.masterGain.gain.setTargetAtTime(0, now, 0.22);
      this.birdBusGain.gain.setTargetAtTime(0, now, 0.2);
      this.clearBirdTimer();
    } else if (this.unlocked && this.birdTrackLoaded && this.birdScheduleTimer === null) {
      this.scheduleNextBirdPhrase(260);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  private async loadBirdRecording(ctx: AudioContext): Promise<void> {
    if (typeof fetch !== "function") return;
    try {
      const response = await fetch(birdsForestUrl);
      if (!response.ok || this.disposed) return;
      const rawBytes = await response.arrayBuffer();
      if (this.disposed) return;
      const decoded = await ctx.decodeAudioData(rawBytes);
      if (this.disposed) return;
      this.birdBuffer = decoded;
      this.birdTrackLoaded = true;
      this.emit();
      if (!this.muted && this.birdScheduleTimer === null) {
        this.scheduleNextBirdPhrase(220);
      }
    } catch {
      // Headless or test runtimes without media decoding fall back silently to synthetic bed
    }
  }

  private clearBirdTimer(): void {
    if (this.birdScheduleTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.birdScheduleTimer);
      this.birdScheduleTimer = null;
    }
  }

  private scheduleNextBirdPhrase(delayMs: number): void {
    if (this.disposed || typeof window === "undefined") return;
    this.clearBirdTimer();
    this.birdScheduleTimer = window.setTimeout(() => {
      this.birdScheduleTimer = null;
      if (this.disposed || this.muted || !this.unlocked || !this.birdBuffer) return;
      this.triggerBirdPhrase();
      // Staggered intervals (7.4s .. 9.6s) overlap smoothly over 9.5s phrases without repetitive seams
      const nextMs = 7400 + ((this.birdPhraseIndex * 613) % 2200);
      this.scheduleNextBirdPhrase(nextMs);
    }, delayMs);
  }

  private triggerBirdPhrase(): void {
    const ctx = getExistingSharedAudioContext();
    if (
      this.disposed ||
      !ctx ||
      ctx.state !== "running" ||
      !this.birdBuffer ||
      !this.birdDistanceFilter ||
      this.muted ||
      !this.lastGateActive ||
      (typeof document !== "undefined" && document.hidden)
    ) {
      return;
    }

    const dur = this.birdBuffer.duration;
    if (!Number.isFinite(dur) || dur <= 1.0) return;

    // Sample different windows inside the 14.65s recording so calls feel organic rather than looping identically
    const offsets = [0.25, 3.6, 5.1, 1.4];
    const startOffset = Math.min(
      Math.max(0, dur - 5.0),
      offsets[this.birdPhraseIndex % offsets.length],
    );
    const playDuration = Math.min(9.5, dur - startOffset);
    const rate = 0.97 + ((this.birdPhraseIndex % 5) - 2) * 0.012;
    const pan = ((this.birdPhraseIndex % 4) - 1.5) * 0.16;
    this.birdPhraseIndex += 1;

    const source = ctx.createBufferSource();
    source.buffer = this.birdBuffer;
    source.playbackRate.value = rate;

    const phraseGain = ctx.createGain();
    const now = ctx.currentTime;
    const fadeIn = Math.min(2.4, playDuration * 0.3);
    const fadeOut = Math.min(2.8, playDuration * 0.35);
    const holdEnd = Math.max(now + fadeIn, now + playDuration / rate - fadeOut);

    // Smooth linear-ramp cosine approximation avoids abrupt gain jumps
    phraseGain.gain.setValueAtTime(0.0001, now);
    phraseGain.gain.linearRampToValueAtTime(1.0, now + fadeIn);
    phraseGain.gain.setValueAtTime(1.0, holdEnd);
    phraseGain.gain.linearRampToValueAtTime(0.0001, now + playDuration / rate);

    let lastNode: AudioNode = phraseGain;
    if (typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      phraseGain.connect(panner);
      lastNode = panner;
    }

    source.connect(phraseGain);
    lastNode.connect(this.birdDistanceFilter);

    this.activeBirdSources.add(source);
    source.onended = () => {
      this.activeBirdSources.delete(source);
      try {
        source.disconnect();
        phraseGain.disconnect();
        if (lastNode !== phraseGain) lastNode.disconnect();
      } catch {
        // already disconnected
      }
    };

    try {
      source.start(now, startOffset, playDuration);
    } catch {
      this.activeBirdSources.delete(source);
    }
  }

  private setupGraph(ctx: AudioContext): void {
    const sampleCount = Math.floor(ctx.sampleRate * 3.0);
    const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Deterministic brown/pink-filtered forest air noise loop with zero boundary step
    let last = 0;
    for (let i = 0; i < sampleCount; i++) {
      const s = Math.sin(i * 12.9898 + 0.17) * 43758.5453;
      const white = (s - Math.floor(s)) * 2 - 1;
      last = (last + 0.03 * white) / 1.03;
      const edgeTaper =
        i < 512
          ? i / 512
          : i > sampleCount - 512
            ? (sampleCount - i) / 512
            : 1;
      data[i] = last * 2.4 * edgeTaper;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 340;
    filter.Q.value = 0.7;

    const airGain = ctx.createGain();
    airGain.gain.value = 0;

    const harmonicGain = ctx.createGain();
    harmonicGain.gain.value = 0;

    const waterGain = ctx.createGain();
    waterGain.gain.value = 0;

    const birdDistanceFilter = ctx.createBiquadFilter();
    birdDistanceFilter.type = "lowpass";
    birdDistanceFilter.frequency.value = 3400;
    birdDistanceFilter.Q.value = 0.55;

    const birdBusGain = ctx.createGain();
    birdBusGain.gain.value = 0;

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0;

    const oscLow = ctx.createOscillator();
    oscLow.type = "sine";
    oscLow.frequency.value = 110;

    const oscFifth = ctx.createOscillator();
    oscFifth.type = "sine";
    oscFifth.frequency.value = 164.81;

    const oscHigh = ctx.createOscillator();
    oscHigh.type = "triangle";
    oscHigh.frequency.value = 220;

    noise.connect(filter);
    filter.connect(airGain);
    airGain.connect(masterGain);

    oscLow.connect(harmonicGain);
    oscFifth.connect(harmonicGain);
    harmonicGain.connect(masterGain);

    oscHigh.connect(waterGain);
    waterGain.connect(masterGain);

    birdDistanceFilter.connect(birdBusGain);
    birdBusGain.connect(masterGain);

    masterGain.connect(ctx.destination);

    noise.start();
    oscLow.start();
    oscFifth.start();
    oscHigh.start();

    this.noiseSource = noise;
    this.filterNode = filter;
    this.airGain = airGain;
    this.harmonicGain = harmonicGain;
    this.waterGain = waterGain;
    this.birdDistanceFilter = birdDistanceFilter;
    this.birdBusGain = birdBusGain;
    this.masterGain = masterGain;
    this.oscLow = oscLow;
    this.oscFifth = oscFifth;
    this.oscHigh = oscHigh;
  }

  /**
   * Smoothly evolves filter cutoff, real woodland bird ambience, and layer gains every animation frame.
   * Ducks cleanly to zero when muted, when microphone capture is active, or when explicit SILENCE mode is enabled.
   */
  update(
    envelope: AudioTimelineEnvelope,
    isMicActive: boolean,
    isSilentMode: boolean,
  ): void {
    const ctx = getExistingSharedAudioContext();
    const gate = this.muted || isMicActive || isSilentMode ? 0 : 1;
    this.lastGateActive = gate > 0;

    if (
      this.disposed ||
      !this.initialized ||
      !ctx ||
      ctx.state !== "running" ||
      !this.masterGain ||
      !this.airGain ||
      !this.harmonicGain ||
      !this.waterGain ||
      !this.filterNode ||
      !this.birdBusGain ||
      !this.birdDistanceFilter
    ) {
      return;
    }

    const now = ctx.currentTime;

    this.filterNode.frequency.setTargetAtTime(
      Math.max(120, Math.min(2400, envelope.filterCutoffHz)),
      now,
      0.16,
    );
    this.airGain.gain.setTargetAtTime(
      (envelope.forestAirGain + envelope.leafRustleGain) * 0.11 * gate,
      now,
      0.16,
    );
    this.waterGain.gain.setTargetAtTime(
      envelope.waterResonanceGain * 0.042 * gate,
      now,
      0.16,
    );
    this.harmonicGain.gain.setTargetAtTime(
      (envelope.soundStrataGain * 0.036 + envelope.disturbanceSubGain * 0.032) *
        gate,
      now,
      0.2,
    );
    this.birdDistanceFilter.frequency.setTargetAtTime(
      Math.max(900, Math.min(4800, envelope.ambienceBrightnessHz ?? 3400)),
      now,
      0.35,
    );
    // Low, unobtrusive field-recording level (~0.24 peak before masterGain ~0.68 -> ~0.16 max)
    this.birdBusGain.gain.setTargetAtTime(
      (envelope.birdAmbienceGain ?? 0) * 0.24 * gate,
      now,
      0.45,
    );
    this.masterGain.gain.setTargetAtTime(envelope.masterGain * gate, now, 0.22);

    if (
      gate > 0 &&
      this.birdTrackLoaded &&
      this.activeBirdSources.size === 0 &&
      this.birdScheduleTimer === null
    ) {
      this.scheduleNextBirdPhrase(200);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearBirdTimer();

    for (const source of this.activeBirdSources) {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // source already finished
      }
    }
    this.activeBirdSources.clear();

    try {
      this.noiseSource?.stop();
      this.oscLow?.stop();
      this.oscFifth?.stop();
      this.oscHigh?.stop();
    } catch {
      // nodes may not have started
    }

    this.noiseSource?.disconnect();
    this.oscLow?.disconnect();
    this.oscFifth?.disconnect();
    this.oscHigh?.disconnect();
    this.filterNode?.disconnect();
    this.airGain?.disconnect();
    this.harmonicGain?.disconnect();
    this.waterGain?.disconnect();
    this.birdDistanceFilter?.disconnect();
    this.birdBusGain?.disconnect();
    this.masterGain?.disconnect();
    this.birdBuffer = null;
    this.initialized = false;
    this.listeners.clear();
  }
}
