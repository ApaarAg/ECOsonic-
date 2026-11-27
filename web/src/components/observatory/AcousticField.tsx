import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  AudioWaveform,
  Activity,
  Layers,
  Sparkles,
  Maximize2,
  Volume2,
} from 'lucide-react';
import type { HabitatPresetId, MonitoringStatus, SpeciesDetection, DisturbanceEvent } from '../../types/ecosonic';
import { formatTimestampTime } from '../../lib/acoustics';

export type AcousticFieldMode = 'ecosystem' | 'spectrogram' | 'waveform' | 'composite';

export interface AcousticFieldProps {
  status?: MonitoringStatus;
  presetId?: HabitatPresetId;
  peakFrequencyHz?: number;
  rmsLevelDbfs?: number;
  sampleRateHz?: number;
  fftSize?: number;
  analyserNode?: AnalyserNode | null;
  isMicrophoneActive?: boolean;
  reducedMotion?: boolean;
  height?: number | string;
  mode?: AcousticFieldMode;
  particleDensity?: number;
  interactive?: boolean;
  detections?: SpeciesDetection[];
  disturbances?: DisturbanceEvent[];
  onModeChange?: (mode: AcousticFieldMode) => void;
  className?: string;
  showControls?: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseX: number;
  baseY: number;
  size: number;
  layer: 'low' | 'mid' | 'high' | 'spore';
  phase: number;
  freqNorm: number;
  alpha: number;
  life: number;
}

interface AcousticEventLocus {
  id: string;
  xNorm: number;
  yNorm: number;
  radius: number;
  maxRadius: number;
  age: number;
  maxAge: number;
  type: 'detection' | 'disturbance';
  label: string;
  subLabel?: string;
  color: string;
  ringColor: string;
}

// Preset-dependent harmonic frequencies (Hz) for demo / synthesized mode
const PRESET_SPECTRAL_PROFILES: Record<
  HabitatPresetId,
  { baseFreq: number; harmonics: number[]; speed: number; complexity: number }
> = {
  'temperate-rainforest': { baseFreq: 3420, harmonics: [1200, 2400, 3420, 5800, 8200], speed: 1.0, complexity: 1.2 },
  'boreal-wetland': { baseFreq: 2150, harmonics: [980, 1850, 2150, 4200, 6400], speed: 0.85, complexity: 0.95 },
  'subalpine-ridge': { baseFreq: 4200, harmonics: [1400, 2800, 4200, 7100, 9600], speed: 1.15, complexity: 1.1 },
};

/**
 * AcousticField
 *
 * ECOsonic's Signature Visual Instrument.
 * Synthesizes Web Audio AnalyserNode metrics, time-frequency spectra, and organic
 * GPU particle fields into a unified bioacoustic ecosystem representation:
 *
 * - Low-frequency (0-500 Hz): Slow, rolling sub-canopy wave motion & spore drift.
 * - Mid-frequency (500-3000 Hz): Fluid laminar biophony streams (birdsong harmonics).
 * - High-frequency (3000-12000 Hz): Fine canopy scatter & acoustic micro-sparkles.
 * - Detection / Disturbance shockwave loci: Radiate outwards upon bioacoustic events.
 * - High performance: Typed arrays, requestAnimationFrame, zero React re-renders in draw loop.
 */
export function AcousticField({
  status = 'streaming',
  presetId = 'temperate-rainforest',
  peakFrequencyHz = 3420,
  rmsLevelDbfs = -38,
  sampleRateHz = 48000,
  fftSize = 2048,
  analyserNode = null,
  isMicrophoneActive = false,
  reducedMotion = false,
  height = 360,
  mode: controlledMode,
  particleDensity = 1.0,
  interactive = true,
  detections = [],
  disturbances = [],
  onModeChange,
  className = '',
  showControls = true,
}: AcousticFieldProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [internalMode, setInternalMode] = useState<AcousticFieldMode>('composite');
  const activeMode = controlledMode ?? internalMode;

  const handleModeChange = useCallback(
    (nextMode: AcousticFieldMode) => {
      if (onModeChange) {
        onModeChange(nextMode);
      } else {
        setInternalMode(nextMode);
      }
    },
    [onModeChange]
  );

  // Dynamic telemetry displayed in micro-hud
  const [hudTelemetry, setHudTelemetry] = useState({
    peakHz: peakFrequencyHz,
    rmsDbfs: rmsLevelDbfs,
    energyLow: 0.25,
    energyMid: 0.45,
    energyHigh: 0.2,
  });

  // Keep state refs for zero-overhead animation frame access
  const stateRef = useRef({
    status,
    presetId,
    peakFrequencyHz,
    rmsLevelDbfs,
    sampleRateHz,
    fftSize,
    analyserNode,
    isMicrophoneActive,
    reducedMotion,
    activeMode,
    particleDensity,
    interactive,
  });

  useEffect(() => {
    stateRef.current = {
      status,
      presetId,
      peakFrequencyHz,
      rmsLevelDbfs,
      sampleRateHz,
      fftSize,
      analyserNode,
      isMicrophoneActive,
      reducedMotion,
      activeMode,
      particleDensity,
      interactive,
    };
  }, [
    status,
    presetId,
    peakFrequencyHz,
    rmsLevelDbfs,
    sampleRateHz,
    fftSize,
    analyserNode,
    isMicrophoneActive,
    reducedMotion,
    activeMode,
    particleDensity,
    interactive,
  ]);

  // Track event loci queue
  const eventLociRef = useRef<AcousticEventLocus[]>([]);
  const lastDetectionIdRef = useRef<string | null>(null);
  const lastDisturbanceIdRef = useRef<string | null>(null);

  // Synchronize incoming detection events into expanding shockwave rings
  useEffect(() => {
    if (detections.length > 0) {
      const latest = detections[0];
      if (latest && latest.id !== lastDetectionIdRef.current) {
        lastDetectionIdRef.current = latest.id;
        const normY = 1.0 - Math.min(1.0, Math.max(0.05, latest.frequencyRangeHz[0] / 10000));
        const newLocus: AcousticEventLocus = {
          id: latest.id,
          xNorm: 0.65 + (Math.random() * 0.2 - 0.1),
          yNorm: normY,
          radius: 4,
          maxRadius: 140,
          age: 0,
          maxAge: 180,
          type: 'detection',
          label: latest.commonName,
          subLabel: `${(latest.confidenceScore * 100).toFixed(0)}% · ${latest.frequencyRangeHz[0]} Hz`,
          color: '#788B68',
          ringColor: 'rgba(213, 217, 198, ',
        };
        eventLociRef.current.push(newLocus);
        if (eventLociRef.current.length > 8) {
          eventLociRef.current.shift();
        }
      }
    }
  }, [detections]);

  // Synchronize incoming disturbance events into shockwave rings
  useEffect(() => {
    if (disturbances.length > 0) {
      const latest = disturbances[0];
      if (latest && latest.id !== lastDisturbanceIdRef.current) {
        lastDisturbanceIdRef.current = latest.id;
        const newLocus: AcousticEventLocus = {
          id: latest.id,
          xNorm: 0.35 + (Math.random() * 0.2 - 0.1),
          yNorm: 0.72,
          radius: 6,
          maxRadius: 180,
          age: 0,
          maxAge: 200,
          type: 'disturbance',
          label: latest.label,
          subLabel: `${latest.peakDbfs.toFixed(1)} dBFS · Disturbance`,
          color: '#E07A5F',
          ringColor: 'rgba(224, 122, 95, ',
        };
        eventLociRef.current.push(newLocus);
        if (eventLociRef.current.length > 8) {
          eventLociRef.current.shift();
        }
      }
    }
  }, [disturbances]);

  // Pointer state for Casberry-inspired interactive repulsion/attraction
  const pointerRef = useRef<{ x: number; y: number; active: boolean }>({ x: -1000, y: -1000, active: false });

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!stateRef.current.interactive) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    pointerRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      active: true,
    };
  };

  const handlePointerLeave = () => {
    pointerRef.current.active = false;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!stateRef.current.interactive) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Interactive acoustic probe: create an exploratory pulse
    const newLocus: AcousticEventLocus = {
      id: `probe-${Date.now()}`,
      xNorm: Math.max(0.05, Math.min(0.95, clickX / rect.width)),
      yNorm: Math.max(0.05, Math.min(0.95, clickY / rect.height)),
      radius: 4,
      maxRadius: 110,
      age: 0,
      maxAge: 120,
      type: 'detection',
      label: 'Acoustic Probe',
      subLabel: `${Math.round((1 - clickY / rect.height) * 11000)} Hz`,
      color: '#D3A36C',
      ringColor: 'rgba(211, 163, 108, ',
    };
    eventLociRef.current.push(newLocus);
    if (eventLociRef.current.length > 8) {
      eventLociRef.current.shift();
    }
  };

  // Main high-performance render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    let disposed = false;
    let phase = 0;
    let lastHudSync = 0;

    // Pre-allocated typed arrays for live Web Audio data
    let liveFreqBuffer: Uint8Array<ArrayBuffer> | null = null;
    let liveTimeBuffer: Float32Array<ArrayBuffer> | null = null;

    // Waterfall history for spectrogram mode
    const historyCols = 100;
    const freqBins = 40;
    const waterfall: number[][] = Array.from({ length: historyCols }, () => new Array(freqBins).fill(0));

    // Particles system allocation
    const baseParticleCount = Math.round(360 * stateRef.current.particleDensity);
    const particles: Particle[] = [];

    const initParticles = (w: number, h: number) => {
      particles.length = 0;
      for (let i = 0; i < baseParticleCount; i++) {
        const rand = Math.random();
        let layer: Particle['layer'] = 'spore';
        let freqNorm = Math.random();
        let size = 1.2;

        if (rand < 0.25) {
          layer = 'low';
          freqNorm = 0.05 + Math.random() * 0.2;
          size = 2.4 + Math.random() * 1.6;
        } else if (rand < 0.65) {
          layer = 'mid';
          freqNorm = 0.25 + Math.random() * 0.45;
          size = 1.6 + Math.random() * 1.2;
        } else if (rand < 0.85) {
          layer = 'high';
          freqNorm = 0.7 + Math.random() * 0.28;
          size = 1.0 + Math.random() * 0.8;
        }

        const px = Math.random() * w;
        const py = h * (1.0 - freqNorm);

        particles.push({
          x: px,
          y: py,
          vx: (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.2,
          baseX: px,
          baseY: py,
          size,
          layer,
          phase: Math.random() * Math.PI * 2,
          freqNorm,
          alpha: 0.25 + Math.random() * 0.55,
          life: 0.5 + Math.random() * 0.5,
        });
      }
    };

    // Smooth interpolated values for zero-jitter 60 FPS rendering
    let smoothLow = 0.2;
    let smoothMid = 0.3;
    let smoothHigh = 0.15;
    let smoothAmp = 0.25;
    let smoothPeak = stateRef.current.peakFrequencyHz;

    const render = (timeMs: number) => {
      if (disposed) return;
      animId = requestAnimationFrame(render);

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      if (w === 0 || h === 0) return;

      const targetCanvasW = Math.floor(w * dpr);
      const targetCanvasH = Math.floor(h * dpr);
      if (canvas.width !== targetCanvasW || canvas.height !== targetCanvasH) {
        canvas.width = targetCanvasW;
        canvas.height = targetCanvasH;
        initParticles(w, h);
      }

      if (particles.length === 0) {
        initParticles(w, h);
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      // Deep biological obsidian background (#0B130F)
      ctx.fillStyle = '#0B130F';
      ctx.fillRect(0, 0, w, h);

      // Subtle atmospheric forest grain
      ctx.fillStyle = 'rgba(213, 217, 198, 0.018)';
      ctx.fillRect(0, 0, w, h);

      const {
        status: curStatus,
        presetId: curPreset,
        peakFrequencyHz: curPeak,
        analyserNode: curAnalyser,
        isMicrophoneActive: curMicActive,
        reducedMotion: isReduced,
        activeMode: curMode,
      } = stateRef.current;

      const isLiveMic = Boolean(curMicActive && curAnalyser);

      let targetLow = 0.2;
      let targetMid = 0.3;
      let targetHigh = 0.15;
      let targetAmp = 0.25;
      let targetPeak = curPeak;

      if (isLiveMic && curAnalyser) {
        if (!liveFreqBuffer || liveFreqBuffer.length !== curAnalyser.frequencyBinCount) {
          liveFreqBuffer = new Uint8Array(curAnalyser.frequencyBinCount);
        }
        if (!liveTimeBuffer || liveTimeBuffer.length !== curAnalyser.fftSize) {
          liveTimeBuffer = new Float32Array(curAnalyser.fftSize);
        }

        if (curStatus === 'streaming') {
          curAnalyser.getByteFrequencyData(liveFreqBuffer);
          curAnalyser.getFloatTimeDomainData(liveTimeBuffer);

          // Compute frequency energy bands
          const totalBins = liveFreqBuffer.length;
          const lowCut = Math.max(1, Math.floor(totalBins * 0.05));
          const midCut = Math.max(lowCut + 1, Math.floor(totalBins * 0.28));
          const highCut = Math.max(midCut + 1, Math.floor(totalBins * 0.75));

          let lowSum = 0;
          for (let i = 0; i < lowCut; i++) lowSum += liveFreqBuffer[i];
          let midSum = 0;
          for (let i = lowCut; i < midCut; i++) midSum += liveFreqBuffer[i];
          let highSum = 0;
          for (let i = midCut; i < highCut; i++) highSum += liveFreqBuffer[i];

          targetLow = Math.min(1.0, (lowSum / lowCut / 255) * 1.5);
          targetMid = Math.min(1.0, (midSum / (midCut - lowCut) / 255) * 1.8);
          targetHigh = Math.min(1.0, (highSum / (highCut - midCut) / 255) * 2.0);

          // RMS amplitude
          let sumSquares = 0;
          for (let i = 0; i < liveTimeBuffer.length; i++) {
            sumSquares += liveTimeBuffer[i] * liveTimeBuffer[i];
          }
          targetAmp = Math.min(1.0, Math.sqrt(sumSquares / liveTimeBuffer.length) * 3.2);

          // Peak frequency extraction
          let maxVal = 0;
          let maxBin = 0;
          for (let i = 1; i < highCut; i++) {
            if (liveFreqBuffer[i] > maxVal) {
              maxVal = liveFreqBuffer[i];
              maxBin = i;
            }
          }
          targetPeak = Math.round((maxBin * (stateRef.current.sampleRateHz / 2)) / totalBins);
        }
      } else if (curStatus === 'streaming') {
        // Synthesized ecological habitat acoustics
        const profile = PRESET_SPECTRAL_PROFILES[curPreset] ?? PRESET_SPECTRAL_PROFILES['temperate-rainforest'];
        phase += isReduced ? 0.01 : 0.035 * profile.speed;

        targetLow = 0.25 + 0.18 * Math.sin(phase * 0.6) + 0.08 * Math.cos(phase * 1.2);
        targetMid = 0.35 + 0.25 * Math.sin(phase * 1.4 + 0.8) + 0.12 * Math.sin(phase * 2.6);
        targetHigh = 0.18 + 0.14 * Math.sin(phase * 3.1 + 1.2);
        targetAmp = 0.28 + 0.2 * Math.sin(phase * 0.9);
        targetPeak = profile.baseFreq + Math.sin(phase * 0.7) * 420;
      }

      // Smooth interpolation (lerp)
      const lerpFactor = 0.12;
      smoothLow += (targetLow - smoothLow) * lerpFactor;
      smoothMid += (targetMid - smoothMid) * lerpFactor;
      smoothHigh += (targetHigh - smoothHigh) * lerpFactor;
      smoothAmp += (targetAmp - smoothAmp) * lerpFactor;
      smoothPeak += (targetPeak - smoothPeak) * lerpFactor;

      // Update waterfall column if spectrogram or composite is active
      if (curMode === 'spectrogram' || curMode === 'composite') {
        waterfall.shift();
        const newCol: number[] = new Array(freqBins);
        for (let b = 0; b < freqBins; b++) {
          const normB = b / freqBins;
          if (isLiveMic && liveFreqBuffer) {
            const binIdx = Math.min(
              liveFreqBuffer.length - 1,
              Math.floor(normB * normB * (liveFreqBuffer.length * 0.7))
            );
            newCol[b] = liveFreqBuffer[binIdx] / 255;
          } else {
            // Harmonic peaks
            const baseAmp = Math.exp(-Math.pow((normB - 0.32) / 0.14, 2)) * smoothMid;
            const lowAmp = Math.exp(-Math.pow(normB / 0.12, 2)) * smoothLow;
            const highAmp = Math.exp(-Math.pow((normB - 0.68) / 0.16, 2)) * smoothHigh;
            const noise = (Math.sin(b * 12.3 + phase * 4) * 0.5 + 0.5) * 0.06;
            newCol[b] = Math.max(0, Math.min(1, baseAmp + lowAmp * 0.7 + highAmp * 0.85 + noise));
          }
        }
        waterfall.push(newCol);
      }

      // Throttled HUD update (every 180ms)
      if (timeMs - lastHudSync > 180) {
        lastHudSync = timeMs;
        setHudTelemetry({
          peakHz: Math.round(smoothPeak),
          rmsDbfs: isLiveMic ? Math.max(-96, Math.min(0, 20 * Math.log10(Math.max(1e-5, smoothAmp)))) : curPeak ? -38.2 : -52,
          energyLow: smoothLow,
          energyMid: smoothMid,
          energyHigh: smoothHigh,
        });
      }

      // ─────────────────────────────────────────────────────────────
      // LAYER 1: Background Spectrogram Waterfall (composite / spectrogram)
      // ─────────────────────────────────────────────────────────────
      if (curMode === 'spectrogram' || curMode === 'composite') {
        const specH = curMode === 'spectrogram' ? h : h * 0.68;
        const colW = w / historyCols;
        const binH = specH / freqBins;
        const opacityMult = curMode === 'composite' ? 0.42 : 0.88;

        for (let c = 0; c < historyCols; c++) {
          const col = waterfall[c];
          for (let b = 0; b < freqBins; b++) {
            const val = col[b];
            if (val < 0.05) continue;
            const y = specH - (b + 1) * binH;

            // Biological color mapping:
            // 0.05 - 0.3: deep moss #243B2E
            // 0.3 - 0.7: vibrant canopy #788B68
            // 0.7 - 0.9: parchment/stone #D5D9C6
            // > 0.9: bark amber #D3A36C
            let r = 36, g = 59, bVal = 46;
            if (val > 0.85) {
              r = 211; g = 163; bVal = 108;
            } else if (val > 0.65) {
              r = 213; g = 217; bVal = 198;
            } else if (val > 0.3) {
              r = 120; g = 139; bVal = 104;
            }

            ctx.fillStyle = `rgba(${r}, ${g}, ${bVal}, ${(val * opacityMult).toFixed(3)})`;
            ctx.fillRect(c * colW, y, Math.ceil(colW) + 0.5, Math.ceil(binH) + 0.5);
          }
        }
      }

      // ─────────────────────────────────────────────────────────────
      // LAYER 2: Casberry-Inspired Organic Bioacoustic Particle Ecosystem
      // (ecosystem / composite modes)
      // ─────────────────────────────────────────────────────────────
      if (curMode === 'ecosystem' || curMode === 'composite') {
        const pointer = pointerRef.current;
        const hasPointer = pointer.active;

        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];

          // Audio-reactive movement
          let speedFactor = 1.0;
          let waveOffset = 0;

          if (p.layer === 'low') {
            // Slow, large undulating swells
            speedFactor = 0.4 + smoothLow * 1.2;
            waveOffset = Math.sin(phase * 0.8 + p.phase) * (12 + smoothLow * 24);
          } else if (p.layer === 'mid') {
            // Flowing laminar streams of bird vocalizations
            speedFactor = 0.8 + smoothMid * 2.2;
            waveOffset = Math.cos(phase * 1.8 + p.x * 0.015) * (6 + smoothMid * 18);
          } else if (p.layer === 'high') {
            // Fine canopy scatter and micro-flutter
            speedFactor = 1.2 + smoothHigh * 3.4;
            waveOffset = (Math.random() - 0.5) * (2 + smoothHigh * 10);
          } else {
            // Ambient spores
            speedFactor = 0.6 + smoothAmp * 0.8;
            waveOffset = Math.sin(phase * 0.5 + p.phase) * 6;
          }

          if (!isReduced) {
            p.x += (p.vx + 0.5) * speedFactor;
            p.y = p.baseY + waveOffset;

            // Casberry interactive repulsion
            if (hasPointer) {
              const dx = p.x - pointer.x;
              const dy = p.y - pointer.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist < 120 && dist > 1) {
                const force = (120 - dist) / 120;
                p.x += (dx / dist) * force * 4.5;
                p.y += (dy / dist) * force * 4.5;
              }
            }

            // Screen wrap
            if (p.x > w + 20) {
              p.x = -20;
              p.baseX = -20;
            }
          }

          // Render particle with forest aesthetic
          ctx.beginPath();
          const pRadius = Math.max(0.75, p.size * (0.8 + smoothAmp * 0.5));
          ctx.arc(p.x, p.y, pRadius, 0, Math.PI * 2);

          let pColor = 'rgba(120, 139, 104, ';
          if (p.layer === 'high') {
            pColor = 'rgba(211, 163, 108, ';
          } else if (p.layer === 'mid') {
            pColor = 'rgba(213, 217, 198, ';
          } else if (p.layer === 'low') {
            pColor = 'rgba(78, 97, 66, ';
          }

          const currentAlpha = Math.min(1.0, p.alpha * (0.4 + smoothAmp * 0.65));
          ctx.fillStyle = `${pColor}${currentAlpha.toFixed(2)})`;
          ctx.fill();
        }
      }

      // ─────────────────────────────────────────────────────────────
      // LAYER 3: Calibrated Time-Domain Waveform Envelope
      // (waveform / composite modes)
      // ─────────────────────────────────────────────────────────────
      if (curMode === 'waveform' || curMode === 'composite') {
        const waveCenterY = curMode === 'waveform' ? h * 0.5 : h * 0.82;
        const waveSpan = curMode === 'waveform' ? h * 0.38 : h * 0.16;

        // Baseline reference
        ctx.strokeStyle = 'rgba(213, 217, 198, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, waveCenterY);
        ctx.lineTo(w, waveCenterY);
        ctx.stroke();

        const getSample = (nx: number): number => {
          if (isLiveMic && liveTimeBuffer && liveTimeBuffer.length > 0) {
            const idx = Math.min(
              liveTimeBuffer.length - 1,
              Math.max(0, Math.floor(nx * (liveTimeBuffer.length - 1)))
            );
            return Math.max(-1, Math.min(1, liveTimeBuffer[idx] * 2.2));
          }
          // Organic synthesized bird song harmonics
          const env = Math.sin(nx * Math.PI);
          const fundamental = Math.sin(nx * 48 + phase * 3.5);
          const harmonic = Math.sin(nx * 112 + phase * 6.2) * 0.45;
          const highFreq = Math.sin(nx * 260 + phase * 9.8) * 0.25;
          return (fundamental + harmonic + highFreq) * env * smoothAmp;
        };

        // Harmonic fill envelope
        ctx.beginPath();
        ctx.moveTo(0, waveCenterY);
        const step = 4;
        for (let x = 0; x <= w; x += step) {
          const sample = getSample(x / w);
          ctx.lineTo(x, waveCenterY - Math.abs(sample) * waveSpan);
        }
        for (let x = w; x >= 0; x -= step) {
          const sample = getSample(x / w);
          ctx.lineTo(x, waveCenterY + Math.abs(sample) * waveSpan * 0.8);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(120, 139, 104, 0.22)';
        ctx.fill();

        // High-definition primary line trace
        ctx.beginPath();
        for (let x = 0; x <= w; x += 2) {
          const sample = getSample(x / w);
          const y = waveCenterY + sample * waveSpan;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = '#D5D9C6';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // ─────────────────────────────────────────────────────────────
      // LAYER 4: Bioacoustic Detection & Disturbance Event Shockwaves
      // ─────────────────────────────────────────────────────────────
      const loci = eventLociRef.current;
      for (let i = loci.length - 1; i >= 0; i--) {
        const locus = loci[i];
        locus.age += 1;
        const progress = locus.age / locus.maxAge;

        if (progress >= 1.0) {
          loci.splice(i, 1);
          continue;
        }

        const cx = locus.xNorm * w;
        const cy = locus.yNorm * h;
        const curRadius = locus.radius + (locus.maxRadius - locus.radius) * Math.sin(progress * Math.PI * 0.5);
        const ringAlpha = Math.max(0, 1.0 - progress);

        // Concentric acoustic rings
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, curRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `${locus.ringColor}${(ringAlpha * 0.75).toFixed(3)})`;
        ctx.lineWidth = locus.type === 'disturbance' ? 2.5 : 1.5;
        if (locus.type === 'disturbance') {
          ctx.setLineDash([6, 4]);
        }
        ctx.stroke();
        ctx.restore();

        // Center locus beacon
        const beaconRadius = Math.max(2, 5 * (1 - progress * 0.5));
        ctx.beginPath();
        ctx.arc(cx, cy, beaconRadius, 0, Math.PI * 2);
        ctx.fillStyle = locus.color;
        ctx.fill();

        // Micro-annotation tag
        if (progress < 0.7) {
          ctx.font = '11px "IBM Plex Mono", monospace';
          ctx.fillStyle = `rgba(238, 235, 221, ${(1 - progress / 0.7).toFixed(2)})`;
          ctx.fillText(locus.label, cx + 12, cy - 4);
          if (locus.subLabel) {
            ctx.font = '9px "IBM Plex Mono", monospace';
            ctx.fillStyle = `rgba(165, 172, 156, ${(0.8 * (1 - progress / 0.7)).toFixed(2)})`;
            ctx.fillText(locus.subLabel, cx + 12, cy + 9);
          }
        }
      }

      // ─────────────────────────────────────────────────────────────
      // Calibrated Frequency Gridlines (dB & kHz references)
      // ─────────────────────────────────────────────────────────────
      ctx.strokeStyle = 'rgba(213, 217, 198, 0.08)';
      ctx.lineWidth = 1;
      const freqMarkers = [
        { label: '8 kHz', yRatio: 0.16 },
        { label: '4 kHz', yRatio: 0.42 },
        { label: '2 kHz', yRatio: 0.65 },
        { label: '500 Hz', yRatio: 0.88 },
      ];
      ctx.font = '10px "IBM Plex Mono", monospace';
      ctx.fillStyle = 'rgba(213, 217, 198, 0.45)';
      for (const m of freqMarkers) {
        const my = Math.round(h * m.yRatio) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, my);
        ctx.lineTo(w, my);
        ctx.stroke();
        ctx.fillText(m.label, 12, my - 4);
      }

      // Dominant frequency indicator line
      const peakYNorm = 1.0 - Math.min(1.0, Math.max(0.05, smoothPeak / 10000));
      const peakY = Math.round(h * peakYNorm) + 0.5;
      ctx.strokeStyle = 'rgba(211, 163, 108, 0.5)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, peakY);
      ctx.lineTo(w, peakY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#D3A36C';
      ctx.fillText(`${Math.round(smoothPeak)} Hz (Dominant)`, w - 140, peakY - 4);

      ctx.restore();
    };

    animId = requestAnimationFrame(render);

    return () => {
      disposed = true;
      cancelAnimationFrame(animId);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative rounded-xl overflow-hidden border border-[var(--app-border)] bg-[#0B130F] flex flex-col ${className}`}
      style={{ minHeight: typeof height === 'number' ? `${height}px` : height }}
    >
      {/* Interactive Canvas Canvas */}
      <canvas
        ref={canvasRef}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handlePointerDown}
        role="img"
        aria-label="Acoustic Field: Organic bioacoustic particle ecosystem and spectral envelope"
        className="w-full h-full flex-1 block touch-none cursor-crosshair"
      />

      {/* Floating Scientific Telemetry HUD (OriginKit Editorial Overlay) */}
      <div className="absolute top-3 left-3 right-3 flex flex-wrap items-center justify-between gap-3 pointer-events-none">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eco-badge eco-badge-moss text-[11px] py-0.5 px-2.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#788B68] animate-pulse" />
            {isMicrophoneActive ? 'LIVE MIC HARMONICS' : 'ECOSYSTEM FIELD'}
          </span>
          <span className="text-xs font-mono tabular-nums text-[var(--app-text-muted)] bg-[var(--app-surface)]/80 backdrop-blur-md px-2.5 py-0.5 rounded border border-[var(--app-border)]">
            PEAK: <strong className="text-[#D3A36C]">{hudTelemetry.peakHz} Hz</strong>
          </span>
          <span className="text-xs font-mono tabular-nums text-[var(--app-text-muted)] bg-[var(--app-surface)]/80 backdrop-blur-md px-2.5 py-0.5 rounded border border-[var(--app-border)]">
            RMS: <strong className="text-[var(--app-text)]">{hudTelemetry.rmsDbfs.toFixed(1)} dBFS</strong>
          </span>
        </div>

        {/* Multi-Band Frequency Share Indicators */}
        <div className="hidden sm:flex items-center gap-3 bg-[var(--app-surface)]/80 backdrop-blur-md px-3 py-1 rounded-full border border-[var(--app-border)] text-[10px] font-mono text-[var(--app-text-muted)]">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#4E6142]" />
            LOW {(hudTelemetry.energyLow * 100).toFixed(0)}%
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#788B68]" />
            MID {(hudTelemetry.energyMid * 100).toFixed(0)}%
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#D3A36C]" />
            HIGH {(hudTelemetry.energyHigh * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Bottom Mode Switcher & Controls Dock (daisyUI Adapted Structural Dock) */}
      {showControls && (
        <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-3 pointer-events-auto">
          <div className="flex items-center p-1 rounded-lg bg-[var(--app-surface)]/85 backdrop-blur-md border border-[var(--app-border)] text-xs">
            <button
              type="button"
              onClick={() => handleModeChange('composite')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
                activeMode === 'composite'
                  ? 'bg-[#788B68] text-[#101C17] font-semibold'
                  : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text)]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Composite</span>
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('ecosystem')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
                activeMode === 'ecosystem'
                  ? 'bg-[#788B68] text-[#101C17] font-semibold'
                  : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text)]'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Particles</span>
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('spectrogram')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
                activeMode === 'spectrogram'
                  ? 'bg-[#788B68] text-[#101C17] font-semibold'
                  : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text)]'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Waterfall</span>
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('waveform')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
                activeMode === 'waveform'
                  ? 'bg-[#788B68] text-[#101C17] font-semibold'
                  : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text)]'
              }`}
            >
              <AudioWaveform className="w-3.5 h-3.5" />
              <span>Oscilloscope</span>
            </button>
          </div>

          <div className="text-[11px] font-mono text-[var(--app-text-muted)] bg-[var(--app-surface)]/85 backdrop-blur-md px-3 py-1.5 rounded-lg border border-[var(--app-border)] hidden md:block">
            Tip: Click or touch canvas to launch an acoustic frequency probe
          </div>
        </div>
      )}
    </div>
  );
}
