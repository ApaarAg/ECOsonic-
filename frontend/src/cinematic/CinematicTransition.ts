import type {
  CinematicActId,
  CinematicDirectorState,
  ForestWaterPhase,
} from "../visual/Cinematic/cinematicSequence";
import {
  clamp01,
  evaluateTimelineAtScroll,
  smoothstep,
  type TimelineEvaluation,
} from "./CinematicTimeline";

export interface AudioTimelineEnvelope {
  silenceWeight: number;
  forestAirGain: number;
  leafRustleGain: number;
  waterResonanceGain: number;
  soundStrataGain: number;
  disturbanceSubGain: number;
  birdAmbienceGain: number;
  ambienceBrightnessHz: number;
  filterCutoffHz: number;
  masterGain: number;
}

export interface CameraTimelineState {
  canopyDescent: number;
  focusPush: number;
  poolElevationMix: number;
  fieldOrbitMix: number;
  globePullback: number;
}

export interface CinematicTransitionFrame {
  evaluation: TimelineEvaluation;
  weights: CinematicDirectorState["weights"];
  soundTraceIllumination: number;
  rippleWavefrontMask: number;
  camera: CameraTimelineState;
  audio: AudioTimelineEnvelope;
}

/**
 * Computes continuous, non-crossfade visual, camera, and audio choreography
 * from normalized scrollProgress [0..1]. Every boundary between Acts 01-10
 * uses physical/perceptual state bridges (illumination, focal push, tracking descent,
 * ripple-to-particle excitation, trajectory shear, decay) rather than opacity cuts.
 */
export function evaluateCinematicTransitions(
  scrollProgress: number,
  scrollVelocity: number,
  reducedMotion: boolean,
): CinematicTransitionFrame {
  const evaluation = evaluateTimelineAtScroll(scrollProgress);
  const g = evaluation.scrollProgress;

  // Global Act offsets cleanly computed from timeline boundaries:
  // 01: 0.00..0.055, 02: 0.055..0.175, 03: 0.175..0.320, 04: 0.320..0.435,
  // 05: 0.435..0.545, 06: 0.545..0.645, 07: 0.645..0.730, 08: 0.730..0.800,
  // 09: 0.800..0.845, 10: 0.845..0.920, 11: 0.920..1.000

  const blacknessClear = smoothstep(0.012, 0.068, g);

  // ACT 01 subtle acoustic filament illumination revealing trunks into ACT 02
  const soundTraceIllumination =
    smoothstep(0.014, 0.052, g) * (1 - smoothstep(0.072, 0.14, g));

  // Forest visibility: emerges progressively out of blackness via sound illumination,
  // holds crisp through Leaf -> early Water, recedes gently as Sound rises into Field
  const forestEmergenceBase =
    smoothstep(0.018, 0.058, g) * 0.28 + smoothstep(0.058, 0.145, g) * 0.72;
  const forestEmergence = reducedMotion
    ? g >= 0.05
      ? 1
      : smoothstep(0.01, 0.05, g)
    : forestEmergenceBase;

  const forestOpacity =
    smoothstep(0.014, 0.072, g) * (1 - smoothstep(0.455, 0.535, g));

  // Forest depth defocus peaks smoothly during mid-canopy descent, sharpening cleanly at pool shoreline
  const forestDefocus =
    smoothstep(0.195, 0.285, g) * 0.56 * (1 - smoothstep(0.325, 0.4, g));

  // Camera push-in toward hero branch at end of ACT 02 into ACT 03 attachment
  const leafAttention =
    smoothstep(0.105, 0.175, g) * 0.72 * (1 - smoothstep(0.195, 0.26, g));

  // Hero leaf is already attached inside canopy by latter half of ACT 02
  const leafOpacity =
    smoothstep(0.085, 0.145, g) * (1 - smoothstep(0.445, 0.5, g));

  // Normalized leaf detachment/fall progress [0..1]
  const leafProgress =
    g < 0.175 ? 0 : g <= 0.32 ? clamp01((g - 0.175) / 0.145) : 1;

  // Water pool enters cleanly beneath forest floor in late ACT 03 BEFORE impact,
  // holds through ACT 04 ripple -> settles upward into SOUND particles across ACT 05
  const waterOpacity =
    smoothstep(0.245, 0.315, g) * (1 - smoothstep(0.465, 0.535, g));

  const waterProgress =
    g < 0.32 ? 0 : g <= 0.435 ? clamp01((g - 0.32) / 0.115) : 1;

  // Ripple wavefront bridges expanding water ring (ACT 04) into rising particle strata (ACT 05)
  const rippleWavefrontMask =
    smoothstep(0.355, 0.435, g) * (1 - smoothstep(0.495, 0.565, g));

  // Sound morph seeds smoothly near late ACT 04 water ripple then lifts into full 3D sphere
  const soundMorph = clamp01(
    smoothstep(0.395, 0.435, g) * 0.1 + smoothstep(0.435, 0.542, g) * 0.9,
  );

  // Field opacity seeds softly from water/sound release then parts smoothly into Globe -> Ecological Field
  const fieldOpacity =
    smoothstep(0.41, 0.485, g) * (1 - smoothstep(0.842, 0.905, g));

  // Biological trace spotlight during ACT 07
  const speciesEmphasis =
    smoothstep(0.635, 0.67, g) * (1 - smoothstep(0.72, 0.75, g));

  // Physical disturbance wave across ACT 08
  const disturbanceEmphasis =
    smoothstep(0.72, 0.755, g) * (1 - smoothstep(0.79, 0.825, g));

  // Acoustic field collapse into stillness during ACT 09 -> persists softly through ACT 10, 11, 12
  const silenceOverride = smoothstep(0.795, 0.838, g) * 0.96;

  // Spatial ecological PhotoCardGlobe rises across ACT 10, gliding smoothly aside as GalleryTunnel emerges in ACT 11
  const globeOpacity =
    smoothstep(0.832, 0.875, g) * (1 - smoothstep(0.892, 0.938, g));

  // Shared persistent GalleryTunnel rises early underneath receding ACT 10 Globe -> continuous across ACT 11 & ACT 12
  const ecologicalFieldOpacity = smoothstep(0.858, 0.922, g);

  const kineticLift = reducedMotion
    ? 0
    : Math.min(0.18, Math.abs(scrollVelocity) * 0.45);

  const camera: CameraTimelineState = {
    canopyDescent: leafProgress,
    focusPush: leafAttention,
    poolElevationMix: smoothstep(0.2, 0.315, g) * (1 - smoothstep(0.435, 0.535, g)),
    fieldOrbitMix: smoothstep(0.435, 0.545, g),
    globePullback: smoothstep(0.842, 0.935, g),
  };

  // Continuous soundscape envelope evolving across all 12 acts without restarts
  const silenceFloor = 1 - smoothstep(0.014, 0.068, g) * 0.9;
  const endSilence = smoothstep(0.79, 0.842, g);
  const silenceWeight = clamp01(Math.max(silenceFloor, endSilence));

  const forestAirGain =
    smoothstep(0.025, 0.125, g) * (1 - smoothstep(0.39, 0.54, g)) * 0.42;
  const leafRustleGain =
    smoothstep(0.16, 0.22, g) * (1 - smoothstep(0.305, 0.37, g)) * 0.35 +
    kineticLift * 0.12;
  const waterResonanceGain =
    smoothstep(0.325, 0.38, g) * (1 - smoothstep(0.45, 0.555, g)) * 0.48;
  const soundStrataGain =
    smoothstep(0.42, 0.5, g) * (1 - smoothstep(0.79, 0.85, g)) * 0.52;
  const disturbanceSubGain = disturbanceEmphasis * 0.38;

  // Scene-aware natural woodland bird ambience:
  // Forest/Leaf/Water -> richer distant birdsong (~0.78..1.0)
  // Sound/Acoustic Field -> softer (~0.20) so acoustic intelligence leads
  // Expected Species / Observation Gap -> ultra-subtle (~0.14 -> ~0.04 toward end)
  const natureIn = smoothstep(0.018, 0.095, g);
  const intelDuck = 1 - smoothstep(0.425, 0.565, g) * 0.78;
  const lateSettle = 1 - smoothstep(0.84, 0.92, g) * 0.36;
  const closingFade = 1 - smoothstep(0.955, 1.0, g) * 0.65;
  const birdAmbienceGain = clamp01(
    natureIn * intelDuck * lateSettle * closingFade * (reducedMotion ? 0.8 : 1),
  );
  const ambienceBrightnessHz = Math.round(
    1850 +
      smoothstep(0.03, 0.14, g) * 2050 * (1 - smoothstep(0.42, 0.56, g) * 0.58) -
      smoothstep(0.88, 1.0, g) * 520,
  );

  const filterCutoffHz =
    220 +
    forestAirGain * 620 +
    waterResonanceGain * 840 +
    soundStrataGain * 1450 +
    disturbanceSubGain * 420;

  const masterGain = reducedMotion
    ? 0.22
    : clamp01((1 - smoothstep(0.96, 1.0, g) * 0.55) * smoothstep(0.01, 0.08, g) * 0.68);

  return {
    evaluation,
    weights: {
      blacknessClear,
      forestOpacity,
      forestEmergence,
      forestDefocus,
      leafAttention,
      leafOpacity,
      leafProgress,
      waterOpacity,
      waterProgress,
      soundMorph,
      fieldOpacity,
      speciesEmphasis,
      disturbanceEmphasis,
      silenceOverride,
      globeOpacity,
      ecologicalFieldOpacity,
    },
    soundTraceIllumination,
    rippleWavefrontMask,
    camera,
    audio: {
      silenceWeight,
      forestAirGain,
      leafRustleGain,
      waterResonanceGain,
      soundStrataGain,
      disturbanceSubGain,
      birdAmbienceGain,
      ambienceBrightnessHz,
      filterCutoffHz,
      masterGain,
    },
  };
}

/**
 * Helper used when jumping or resolving phase metadata cleanly.
 */
export function describeTransitionStage(
  act: CinematicActId,
  phase: ForestWaterPhase,
): string {
  return `${act}:${phase}`;
}
