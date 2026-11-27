import { describe, expect, it } from "vitest";
import type {
  AudioMetrics,
  DetectionEvent,
  DisturbanceEvent,
} from "../domain/acousticFieldTypes";
import {
  createAcousticFieldRuntimeState,
  sphericalToUnitVec3,
  stepAcousticFieldState,
} from "../visual/AcousticField/acousticFieldState";

function makeAudio(overrides: Partial<AudioMetrics> = {}): AudioMetrics {
  return {
    rms: 0.4,
    peak: 0.6,
    bands: [0.2, 0.35, 0.5, 0.15],
    spectralCentroid: 0.5,
    temporalFlux: 0.2,
    sampleRate: 32000,
    channels: 1,
    source: "microphone",
    updatedAt: 100,
    ...overrides,
  };
}

describe("acousticFieldState", () => {
  it("converts spherical coordinates to unit vector", () => {
    const [x, y, z] = sphericalToUnitVec3(0, 0);
    expect(x).toBeCloseTo(1, 5);
    expect(y).toBeCloseTo(0, 5);
    expect(z).toBeCloseTo(0, 5);
  });

  it("settles progressively toward silence when audio is silent", () => {
    const state = createAcousticFieldRuntimeState();
    state.energy = 0.55;
    state.silenceFactor = 0.05;
    const silentAudio = makeAudio({
      rms: 0,
      peak: 0,
      bands: [0, 0, 0, 0],
      temporalFlux: 0,
      source: "silent",
    });

    for (let i = 0; i < 120; i++) {
      stepAcousticFieldState(state, silentAudio, [], [], 0.016, false);
    }

    expect(state.energy).toBeLessThan(0.02);
    expect(state.silenceFactor).toBeGreaterThan(0.95);
  });

  it("responds to BirdNET detection events and decays smoothly", () => {
    const state = createAcousticFieldRuntimeState();
    const det: DetectionEvent = {
      id: "det-1",
      eventType: "detection",
      sessionId: "session-1",
      classLabel: "Ixoreus naevius_Varied Thrush",
      speciesCommon: "Varied Thrush",
      speciesScientific: "Ixoreus naevius",
      recordType: "animal",
      taxonGroup: "Bird",
      eventSemantics: "window_detection",
      modelScore: 0.9,
      startSeconds: 0,
      endSeconds: 3,
      receivedAtMs: 1000,
      visualizationPosition: { orbitRad: 1.2, liftRad: 0.3 },
      isDemo: false,
    };

    stepAcousticFieldState(state, makeAudio(), [det], [], 0.016, false);
    const initialStrength = state.detectionPulse.strength;
    expect(initialStrength).toBeGreaterThan(0.8);

    for (let i = 0; i < 90; i++) {
      stepAcousticFieldState(state, makeAudio(), [], [], 0.016, false);
    }
    expect(state.detectionPulse.strength).toBeLessThan(initialStrength * 0.45);
  });

  it("responds to disturbance events and freezes phase under reduced motion", () => {
    const state = createAcousticFieldRuntimeState();
    const phaseBefore = state.fieldPhase;
    const dist: DisturbanceEvent = {
      id: "dist-1",
      sessionId: "session-1",
      kind: "anthropogenic",
      intensity: 0.85,
      modelScore: null,
      startSeconds: 0,
      endSeconds: 3,
      receivedAtMs: 2000,
      visualizationPosition: { orbitRad: 0.5, liftRad: -0.2 },
      durationMs: 3000,
      isDemo: true,
    };

    stepAcousticFieldState(state, makeAudio(), [], [dist], 0.016, true);
    expect(state.disturbanceWave.strength).toBeCloseTo(
      0.85 * Math.exp(-0.52 * 0.016),
      4,
    );
    expect(state.fieldPhase).toBe(phaseBefore);
  });
});
