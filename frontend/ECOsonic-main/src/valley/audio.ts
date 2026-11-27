/**
 * Procedural nocturnal ambient soundscape matching the Three.js AudioListener pattern:
 * starts muted, fades smoothly on toggle, and muffles through a low-pass filter
 * during the arrow hover transition.
 */
export class ValleyAudioStore {
  public isInitialized = false;
  public isMuted = true;

  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private muffleFilter: BiquadFilterNode | null = null;
  private chimeTimer: number | null = null;
  private nodes: AudioNode[] = [];
  private oscillators: OscillatorNode[] = [];
  private noiseSource: AudioBufferSourceNode | null = null;

  public initAudio(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;
  }

  private ensureContext(): boolean {
    if (typeof window === 'undefined') return false;
    if (this.ctx) return true;

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return false;

    const ctx = new AudioCtx();
    this.ctx = ctx;

    const muffleFilter = ctx.createBiquadFilter();
    muffleFilter.type = 'lowpass';
    muffleFilter.frequency.value = 2400;
    muffleFilter.Q.value = 0.7;

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0;

    muffleFilter.connect(masterGain);
    masterGain.connect(ctx.destination);

    this.muffleFilter = muffleFilter;
    this.masterGain = masterGain;

    // Warm nocturnal harmonic drone pad (D2, A2, E3, F#3)
    const freqs = [73.42, 110.0, 164.81, 185.0];
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.value = freq;
      osc.detune.value = (i - 1.5) * 4.5;

      const gain = ctx.createGain();
      gain.gain.value = i === 0 ? 0.11 : 0.045;

      osc.connect(gain);
      gain.connect(muffleFilter);
      osc.start();
      this.oscillators.push(osc);
      this.nodes.push(gain);
    });

    // Soft filtered night breeze noise
    const bufferSize = ctx.sampleRate * 3;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      data[i] = (lastOut + 0.02 * white) / 1.02;
      lastOut = data[i];
      data[i] *= 2.4;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const breezeFilter = ctx.createBiquadFilter();
    breezeFilter.type = 'bandpass';
    breezeFilter.frequency.value = 420;
    breezeFilter.Q.value = 0.85;

    const breezeGain = ctx.createGain();
    breezeGain.gain.value = 0.075;

    noise.connect(breezeFilter);
    breezeFilter.connect(breezeGain);
    breezeGain.connect(muffleFilter);
    noise.start();

    this.noiseSource = noise;
    this.nodes.push(breezeFilter, breezeGain);

    // Subtle organic night bell notes
    const scale = [293.66, 329.63, 369.99, 440.0, 554.37, 659.25];
    this.chimeTimer = window.setInterval(() => {
      if (!this.ctx || this.isMuted || this.ctx.state !== 'running' || !this.muffleFilter) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = scale[Math.floor(Math.random() * scale.length)];

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.032, now + 0.28);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.4);

      osc.connect(gain);
      gain.connect(this.muffleFilter);
      osc.start(now);
      osc.stop(now + 3.5);
    }, 2600);

    return true;
  }

  public toggleMute(): boolean {
    if (!this.isInitialized) return this.isMuted;

    if (this.isMuted) {
      if (this.ensureContext() && this.ctx && this.masterGain) {
        if (this.ctx.state === 'suspended') {
          void this.ctx.resume();
        }
        const now = this.ctx.currentTime;
        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.setTargetAtTime(0.45, now, 0.35);
      }
      this.isMuted = false;
    } else {
      if (this.ctx && this.masterGain) {
        const now = this.ctx.currentTime;
        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.setTargetAtTime(0, now, 0.25);
      }
      this.isMuted = true;
    }
    return this.isMuted;
  }

  public setHoverMuffle(muffled: boolean): void {
    if (!this.ctx || !this.muffleFilter) return;
    const now = this.ctx.currentTime;
    const targetFreq = muffled ? 320 : 2400;
    this.muffleFilter.frequency.cancelScheduledValues(now);
    this.muffleFilter.frequency.setTargetAtTime(targetFreq, now, 0.28);
  }

  public dispose(): void {
    if (this.chimeTimer !== null) {
      clearInterval(this.chimeTimer);
      this.chimeTimer = null;
    }
    for (const osc of this.oscillators) {
      try {
        osc.stop();
        osc.disconnect();
      } catch {
        // ignore
      }
    }
    this.oscillators = [];
    if (this.noiseSource) {
      try {
        this.noiseSource.stop();
        this.noiseSource.disconnect();
      } catch {
        // ignore
      }
      this.noiseSource = null;
    }
    for (const node of this.nodes) {
      try {
        node.disconnect();
      } catch {
        // ignore
      }
    }
    this.nodes = [];
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.masterGain = null;
    this.muffleFilter = null;
  }
}
