import type {
  AudioMetrics,
  DetectionEvent,
  DisturbanceEvent,
} from "../../domain/acousticFieldTypes";

export interface SpatialImpulse {
  /** Normalized 3D direction on the observation field shell */
  dir: [number, number, number];
  /** Remaining normalized intensity [0, 1] */
  strength: number;
}

export interface AcousticFieldRuntimeState {
  energy: number;
  bands: [number, number, number, number];
  spectralCentroid: number;
  temporalFlux: number;
  /** 0 = active soundscape, 1 = settled silence */
  silenceFactor: number;
  /** Accumulated organic phase; slows down during silence */
  fieldPhase: number;
  /** Latest window-detection pulse at its rendering-only visual placement. */
  detectionPulse: SpatialImpulse;
  /** Latest localized disturbance perturbation */
  disturbanceWave: SpatialImpulse;
  /** Internal clock for gentle demo soundscape synthesis */
  demoClock: number;
}

export function sphericalToUnitVec3(
  azimuthRad: number,
  elevationRad: number,
): [number, number, number] {
  const cosEl = Math.cos(elevationRad);
  return [
    cosEl * Math.cos(azimuthRad),
    Math.sin(elevationRad),
    cosEl * Math.sin(azimuthRad),
  ];
}

export function createAcousticFieldRuntimeState(): AcousticFieldRuntimeState {
  return {
    energy: 0.08,
    bands: [0.06, 0.09, 0.05, 0.03],
    spectralCentroid: 0.36,
    temporalFlux: 0.02,
    silenceFactor: 0.45,
    fieldPhase: 0,
    detectionPulse: {
      dir: [0.4, 0.72, 0.56],
      strength: 0,
    },
    disturbanceWave: {
      dir: [-0.65, 0.22, 0.72],
      strength: 0,
    },
    demoClock: 0,
  };
}

function expApproach(current: number, target: number, rate: number, dt: number): number {
  const alpha = 1 - Math.exp(-rate * dt);
  return current + (target - current) * alpha;
}

/**
 * Advances the Acoustic Field physics by `dt` seconds.
 * Pure function mutating `state` in place for zero-GC 60 FPS execution.
 */
export function stepAcousticFieldState(
  state: AcousticFieldRuntimeState,
  audio: AudioMetrics,
  pendingDetections: DetectionEvent[],
  pendingDisturbances: DisturbanceEvent[],
  dt: number,
  reducedMotion: boolean,
  silenceOverride = 0,
): void {
  // Drain discrete BirdNET detection events into localized spatial pulse
  while (pendingDetections.length > 0) {
    const det = pendingDetections.shift();
    if (!det) break;
    state.detectionPulse.dir = sphericalToUnitVec3(
      det.visualizationPosition.orbitRad,
      det.visualizationPosition.liftRad,
    );
    state.detectionPulse.strength = Math.min(1, 0.55 + det.modelScore * 0.45);
  }

  // Drain discrete disturbance events into localized trajectory disruption
  while (pendingDisturbances.length > 0) {
    const dist = pendingDisturbances.shift();
    if (!dist) break;
    state.disturbanceWave.dir = sphericalToUnitVec3(
      dist.visualizationPosition.orbitRad,
      dist.visualizationPosition.liftRad,
    );
    state.disturbanceWave.strength = Math.min(1, Math.max(0.35, dist.intensity));
  }

  // Determine target acoustic metrics from live microphone, silent, or demo source
  let targetRms = audio.rms;
  let targetB0 = audio.bands[0];
  let targetB1 = audio.bands[1];
  let targetB2 = audio.bands[2];
  let targetB3 = audio.bands[3];
  let targetCentroid = audio.spectralCentroid;
  let targetFlux = audio.temporalFlux;

  if (audio.source === "demo") {
    state.demoClock += dt;
    const t = state.demoClock;
    // Subtle organic coastal forest soundscape envelope (calm, non-aggressive)
    const canopyBreath = 0.08 + 0.045 * Math.sin(t * 0.42) + 0.025 * Math.sin(t * 1.13);
    const avianShimmer = Math.max(0, Math.sin(t * 0.67 + 1.1)) * 0.09;
    targetRms = canopyBreath + avianShimmer * 0.35;
    targetB0 = 0.07 + 0.04 * Math.sin(t * 0.31);
    targetB1 = 0.11 + 0.05 * Math.sin(t * 0.53 + 0.6);
    targetB2 = 0.06 + avianShimmer;
    targetB3 = 0.03 + 0.02 * Math.cos(t * 0.89);
    targetCentroid = 0.34 + 0.12 * Math.sin(t * 0.29);
    targetFlux = 0.03 + 0.025 * Math.abs(Math.cos(t * 0.77));
  } else if (audio.source === "silent") {
    targetRms = 0;
    targetB0 = 0;
    targetB1 = 0;
    targetB2 = 0;
    targetB3 = 0;
    targetFlux = 0;
  }

  // Smooth narrative attenuation during ACT 09 — SILENCE (reuses field semantics without a second engine)
  const silenceDamp = Math.max(0.04, 1 - Math.max(0, Math.min(1, silenceOverride)) * 0.96);
  targetRms *= silenceDamp;
  targetB0 *= silenceDamp;
  targetB1 *= silenceDamp;
  targetB2 *= silenceDamp;
  targetB3 *= silenceDamp;
  targetFlux *= silenceDamp;

  // Smooth audio reactivity (fast attack, gentle ecological release)
  const attackOrRelease = targetRms > state.energy ? 10.0 : 3.2;
  state.energy = expApproach(state.energy, targetRms, attackOrRelease, dt);
  state.bands[0] = expApproach(state.bands[0], targetB0, 5.5, dt);
  state.bands[1] = expApproach(state.bands[1], targetB1, 5.5, dt);
  state.bands[2] = expApproach(state.bands[2], targetB2, 6.5, dt);
  state.bands[3] = expApproach(state.bands[3], targetB3, 6.5, dt);
  state.spectralCentroid = expApproach(
    state.spectralCentroid,
    targetCentroid,
    3.5,
    dt,
  );
  state.temporalFlux = expApproach(state.temporalFlux, targetFlux, 6.0, dt);

  // Silence settling: when energy is very low and no active pulse/disturbance remains,
  // silenceFactor rises toward 1.0, progressively settling the field.
  const totalActivity =
    state.energy +
    state.detectionPulse.strength * 0.35 +
    state.disturbanceWave.strength * 0.5;
  const baseTargetSilence =
    audio.source === "silent"
      ? 1.0
      : Math.max(0, Math.min(1, 1 - totalActivity / 0.12));
  const targetSilence = Math.max(
    baseTargetSilence,
    Math.max(0, Math.min(1, silenceOverride)),
  );

  state.silenceFactor = expApproach(state.silenceFactor, targetSilence, 1.8, dt);

  // Decay localized pulses & disturbances (settle smoothly when entering silence)
  const effectiveSilence = audio.source === "silent" || silenceOverride > 0.35;
  const pulseDecayRate = effectiveSilence ? 2.4 : 0.75;
  const distDecayRate = effectiveSilence ? 2.4 : 0.52;

  state.detectionPulse.strength *= Math.exp(-pulseDecayRate * dt);
  if (state.detectionPulse.strength < 0.002) {
    state.detectionPulse.strength = 0;
  }

  state.disturbanceWave.strength *= Math.exp(-distDecayRate * dt);
  if (state.disturbanceWave.strength < 0.002) {
    state.disturbanceWave.strength = 0;
  }

  // Advance organic phase (nearly frozen when reducedMotion or full silence)
  if (!reducedMotion) {
    const motionScale = 1 - state.silenceFactor * 0.9;
    state.fieldPhase += dt * (0.22 + state.energy * 0.85) * motionScale;
  }
}
