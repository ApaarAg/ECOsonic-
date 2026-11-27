import type { StoryboardAct } from '../../domain/storyboard';

/**
 * Explicit top-level state machine for Acts 01 -> 10:
 * ACT_01_BLACKNESS -> ... -> ACT_06_ACOUSTIC_FIELD -> ACT_07_SPECIES -> ACT_08_DISTURBANCE -> ACT_09_SILENCE -> ACT_10_ECOLOGICAL_CONTEXT
 */
export type CinematicActId =
  | 'ACT_01_BLACKNESS'
  | 'ACT_02_FOREST'
  | 'ACT_03_LEAF'
  | 'ACT_04_WATER'
  | 'ACT_05_SOUND'
  | 'ACT_06_ACOUSTIC_FIELD'
  | 'ACT_07_SPECIES'
  | 'ACT_08_DISTURBANCE'
  | 'ACT_09_SILENCE'
  | 'ACT_10_ECOLOGICAL_CONTEXT'
  | 'ACT_11_EXPECTED_SPECIES'
  | 'ACT_12_OBSERVATION_GAP';

/**
 * Fine-grained continuous narrative state machine across Scenes 02 -> 03 -> 04.
 */
export type ForestWaterPhase =
  | 'FOREST_IDLE'
  | 'LEAF_ATTACHED'
  | 'LEAF_DETACHING'
  | 'LEAF_FALLING'
  | 'WATER_APPROACH'
  | 'WATER_CONTACT'
  | 'RIPPLE'
  | 'WATER_SETTLING';

export const CINEMATIC_ACT_ORDER: readonly CinematicActId[] = [
  'ACT_01_BLACKNESS',
  'ACT_02_FOREST',
  'ACT_03_LEAF',
  'ACT_04_WATER',
  'ACT_05_SOUND',
  'ACT_06_ACOUSTIC_FIELD',
  'ACT_07_SPECIES',
  'ACT_08_DISTURBANCE',
  'ACT_09_SILENCE',
  'ACT_10_ECOLOGICAL_CONTEXT',
  'ACT_11_EXPECTED_SPECIES',
  'ACT_12_OBSERVATION_GAP',
] as const;

export const ACT_DURATION_SECONDS: Record<CinematicActId, number> = {
  ACT_01_BLACKNESS: 3.0,
  ACT_02_FOREST: 5.4,
  ACT_03_LEAF: 7.8,
  ACT_04_WATER: 6.8,
  ACT_05_SOUND: 6.6,
  ACT_06_ACOUSTIC_FIELD: 4.2,
  ACT_07_SPECIES: 6.0,
  ACT_08_DISTURBANCE: 6.0,
  ACT_09_SILENCE: 6.0,
  ACT_10_ECOLOGICAL_CONTEXT: 6.5,
  ACT_11_EXPECTED_SPECIES: 7.0,
  ACT_12_OBSERVATION_GAP: Number.POSITIVE_INFINITY,
};

export function storyboardActToCinematicId(act: StoryboardAct): CinematicActId {
  switch (act) {
    case 'BLACKNESS':
      return 'ACT_01_BLACKNESS';
    case 'FOREST':
      return 'ACT_02_FOREST';
    case 'LEAF':
      return 'ACT_03_LEAF';
    case 'WATER':
      return 'ACT_04_WATER';
    case 'SOUND':
      return 'ACT_05_SOUND';
    case 'SPECIES':
      return 'ACT_07_SPECIES';
    case 'DISTURBANCE':
      return 'ACT_08_DISTURBANCE';
    case 'SILENCE':
      return 'ACT_09_SILENCE';
    case 'ECOLOGICAL CONTEXT':
      return 'ACT_10_ECOLOGICAL_CONTEXT';
    case 'EXPECTED SPECIES':
      return 'ACT_11_EXPECTED_SPECIES';
    case 'OBSERVATION GAP':
      return 'ACT_12_OBSERVATION_GAP';
    case 'ACOUSTIC FIELD':
    default:
      return 'ACT_06_ACOUSTIC_FIELD';
  }
}

export function cinematicIdToStoryboardAct(id: CinematicActId): StoryboardAct {
  switch (id) {
    case 'ACT_01_BLACKNESS':
      return 'BLACKNESS';
    case 'ACT_02_FOREST':
      return 'FOREST';
    case 'ACT_03_LEAF':
      return 'LEAF';
    case 'ACT_04_WATER':
      return 'WATER';
    case 'ACT_05_SOUND':
      return 'SOUND';
    case 'ACT_06_ACOUSTIC_FIELD':
      return 'ACOUSTIC FIELD';
    case 'ACT_07_SPECIES':
      return 'SPECIES';
    case 'ACT_08_DISTURBANCE':
      return 'DISTURBANCE';
    case 'ACT_09_SILENCE':
      return 'SILENCE';
    case 'ACT_10_ECOLOGICAL_CONTEXT':
      return 'ECOLOGICAL CONTEXT';
    case 'ACT_11_EXPECTED_SPECIES':
      return 'EXPECTED SPECIES';
    case 'ACT_12_OBSERVATION_GAP':
      return 'OBSERVATION GAP';
  }
}

export interface CinematicDirectorState {
  currentAct: CinematicActId;
  /** Explicit fine-grained state for Scenes 02 -> 03 -> 04 continuity */
  forestWaterPhase: ForestWaterPhase;
  /** Normalized progress within currentAct [0..1] */
  actProgress: number;
  /** Whether continuous cinematic playback is advancing automatically across acts */
  playing: boolean;
  /** Total elapsed clock in seconds */
  clock: number;
  /** Computed layer blend weights fed directly into the single shared WebGLStage */
  weights: {
    blacknessClear: number;
    forestOpacity: number;
    forestEmergence: number;
    forestDefocus: number;
    leafOpacity: number;
    leafProgress: number;
    leafAttention: number;
    waterOpacity: number;
    waterProgress: number;
    soundMorph: number;
    fieldOpacity: number;
    silenceOverride: number;
    globeOpacity: number;
    speciesEmphasis: number;
    disturbanceEmphasis: number;
    ecologicalFieldOpacity: number;
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smooth(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function resolveForestWaterPhase(
  act: CinematicActId,
  p: number,
): ForestWaterPhase {
  if (act === 'ACT_01_BLACKNESS' || act === 'ACT_02_FOREST') {
    return p >= 0.55 ? 'LEAF_ATTACHED' : 'FOREST_IDLE';
  }
  if (act === 'ACT_03_LEAF') {
    if (p < 0.20) return 'LEAF_DETACHING';
    if (p < 0.82) return 'LEAF_FALLING';
    return 'WATER_APPROACH';
  }
  if (act === 'ACT_04_WATER') {
    if (p < 0.14) return 'WATER_APPROACH';
    if (p < 0.24) return 'WATER_CONTACT';
    if (p < 0.68) return 'RIPPLE';
    return 'WATER_SETTLING';
  }
  return 'WATER_SETTLING';
}

export function createCinematicDirectorState(
  initialAct: CinematicActId,
  autoPlaySequence: boolean,
  reducedMotion = false,
): CinematicDirectorState {
  const state: CinematicDirectorState = {
    currentAct: initialAct,
    forestWaterPhase: resolveForestWaterPhase(initialAct, reducedMotion ? 0.72 : 0),
    actProgress: reducedMotion ? 0.72 : 0,
    playing: autoPlaySequence,
    clock: 0,
    weights: {
      blacknessClear: 1,
      forestOpacity: 0,
      forestEmergence: 0,
      forestDefocus: 0,
      leafOpacity: 0,
      leafProgress: 0,
      leafAttention: 0,
      waterOpacity: 0,
      waterProgress: 0,
      soundMorph: 0,
      fieldOpacity: 0,
      silenceOverride: 0,
      globeOpacity: 0,
      speciesEmphasis: 0,
      disturbanceEmphasis: 0,
      ecologicalFieldOpacity: 0,
    },
  };
  jumpDirectorToAct(state, initialAct, autoPlaySequence, reducedMotion);
  return state;
}

export function jumpDirectorToAct(
  state: CinematicDirectorState,
  act: CinematicActId,
  playing: boolean,
  reducedMotion: boolean,
): void {
  state.currentAct = act;
  state.playing = playing;

  if (playing) {
    state.actProgress = 0;
  } else {
    switch (act) {
      case 'ACT_01_BLACKNESS':
        state.actProgress = 0.35;
        break;
      case 'ACT_02_FOREST':
        state.actProgress = reducedMotion ? 1 : 0;
        break;
      case 'ACT_03_LEAF':
        state.actProgress = reducedMotion ? 0.65 : 0.04;
        break;
      case 'ACT_04_WATER':
        state.actProgress = reducedMotion ? 0.58 : 0.06;
        break;
      case 'ACT_05_SOUND':
        state.actProgress = reducedMotion ? 0.56 : 0.05;
        break;
      case 'ACT_06_ACOUSTIC_FIELD':
        state.actProgress = 1;
        break;
      case 'ACT_07_SPECIES':
      case 'ACT_08_DISTURBANCE':
      case 'ACT_09_SILENCE':
        state.actProgress = reducedMotion ? 0.85 : 0.25;
        break;
      case 'ACT_10_ECOLOGICAL_CONTEXT':
        state.actProgress = reducedMotion ? 1.0 : 0.2;
        break;
      case 'ACT_11_EXPECTED_SPECIES':
        state.actProgress = reducedMotion ? 1.0 : 0.45;
        break;
    }
  }
  recomputeDirectorWeights(state, reducedMotion);
}

export function stepCinematicDirector(
  state: CinematicDirectorState,
  dt: number,
  reducedMotion: boolean,
): CinematicActId | null {
  state.clock += dt;

  let transitionedAct: CinematicActId | null = null;
  const duration = ACT_DURATION_SECONDS[state.currentAct];
  const progressDuration = Number.isFinite(duration) ? duration : 2.4;

  const shouldAdvance =
    state.playing || state.currentAct !== 'ACT_06_ACOUSTIC_FIELD';

  const speedFactor = reducedMotion && !state.playing ? 0 : 1;
  const holdLimit = state.playing
    ? 1.0
    : state.currentAct === 'ACT_02_FOREST'
      ? 0.92
      : state.currentAct === 'ACT_03_LEAF'
        ? 0.88
        : state.currentAct === 'ACT_04_WATER'
          ? 0.72
          : state.currentAct === 'ACT_05_SOUND'
            ? 0.64
            : state.currentAct === 'ACT_07_SPECIES' ||
                state.currentAct === 'ACT_08_DISTURBANCE' ||
                state.currentAct === 'ACT_09_SILENCE'
              ? 0.9
              : 1.0;

  if (shouldAdvance && state.actProgress < holdLimit) {
    state.actProgress = Math.min(
      holdLimit,
      state.actProgress + (dt / progressDuration) * speedFactor,
    );
  }

  if (Number.isFinite(duration) && state.playing && state.actProgress >= 1.0) {
    const idx = CINEMATIC_ACT_ORDER.indexOf(state.currentAct);
    if (idx >= 0 && idx + 1 < CINEMATIC_ACT_ORDER.length) {
      const nextAct = CINEMATIC_ACT_ORDER[idx + 1];
      state.currentAct = nextAct;
      state.actProgress = 0;
      transitionedAct = nextAct;
    } else {
      state.playing = false;
    }
  }

  recomputeDirectorWeights(state, reducedMotion);
  return transitionedAct;
}

export function recomputeDirectorWeights(
  state: CinematicDirectorState,
  reducedMotion: boolean,
): void {
  const p = state.actProgress;
  const w = state.weights;
  state.forestWaterPhase = resolveForestWaterPhase(state.currentAct, p);

  w.silenceOverride = 0;
  w.globeOpacity = 0;
  w.speciesEmphasis = 0;
  w.disturbanceEmphasis = 0;
  w.ecologicalFieldOpacity = 0;

  switch (state.currentAct) {
    case 'ACT_01_BLACKNESS': {
      w.blacknessClear = smooth(0.44, 1.0, p);
      w.forestOpacity = smooth(0.46, 1.0, p);
      w.forestEmergence = smooth(0.52, 1.0, p) * 0.16;
      w.forestDefocus = 0;
      w.leafOpacity = 0;
      w.leafProgress = 0;
      w.leafAttention = 0;
      w.waterOpacity = 0;
      w.waterProgress = 0;
      w.soundMorph = 1;
      w.fieldOpacity = reducedMotion
        ? 0.18
        : smooth(0.10, 0.42, p) * (1 - smooth(0.64, 0.98, p)) * 0.30;
      w.silenceOverride = 0.82 - smooth(0.16, 0.60, p) * 0.26;
      break;
    }
    case 'ACT_02_FOREST': {
      w.blacknessClear = 1;
      w.forestOpacity = 1;
      w.forestEmergence = reducedMotion ? 1 : Math.min(1, 0.16 + smooth(0.0, 0.65, p) * 0.84);
      // Camera gently dollies toward the hero branch during LEAF_ATTACHED (p >= 0.55)
      const branchCue = smooth(0.55, 1.0, p);
      w.forestDefocus = branchCue * 0.08;
      w.leafAttention = branchCue * 0.65;
      w.leafOpacity = 1;
      w.leafProgress = 0;
      w.waterOpacity = 1;
      w.waterProgress = 0;
      w.soundMorph = 0;
      w.fieldOpacity = 0;
      break;
    }
    case 'ACT_03_LEAF': {
      w.blacknessClear = 1;
      w.forestOpacity = 1;
      w.forestEmergence = 1;
      w.forestDefocus = 0.08 + smooth(0.24, 0.86, p) * 0.44;
      w.leafAttention = (1 - smooth(0.18, 0.42, p)) * 0.65;
      w.leafOpacity = 1;
      w.leafProgress = p;
      w.waterOpacity = 1;
      w.waterProgress = 0;
      w.soundMorph = 0;
      w.fieldOpacity = 0;
      break;
    }
    case 'ACT_04_WATER': {
      w.blacknessClear = 1;
      w.forestOpacity = 1 - smooth(0.84, 1.0, p) * 0.72;
      w.forestEmergence = 1;
      w.forestDefocus = 0.52;
      w.leafOpacity = 1 - smooth(0.86, 1.0, p) * 0.22;
      w.leafProgress = 1;
      w.leafAttention = 0;
      w.waterOpacity = 1 - smooth(0.88, 1.0, p) * 0.14;
      w.waterProgress = p;
      w.soundMorph = smooth(0.86, 1.0, p) * 0.06;
      w.fieldOpacity = smooth(0.84, 1.0, p) * 0.10;
      break;
    }
    case 'ACT_05_SOUND': {
      w.blacknessClear = 1;
      w.forestOpacity = 0;
      w.forestEmergence = 1;
      w.forestDefocus = 1;
      w.leafOpacity = Math.max(0, (1 - smooth(0.0, 0.42, p)) * 0.75);
      w.leafProgress = 1;
      w.leafAttention = 0;
      w.waterOpacity = Math.max(0, (1 - smooth(0.36, 0.88, p)) * 0.88);
      w.waterProgress = 1;
      w.soundMorph = 0.06 + smooth(0.02, 0.94, p) * 0.94;
      w.fieldOpacity = 0.10 + smooth(0.0, 0.84, p) * 0.90;
      break;
    }
    case 'ACT_06_ACOUSTIC_FIELD': {
      w.blacknessClear = 1;
      w.forestOpacity = 0;
      w.forestEmergence = 1;
      w.forestDefocus = 0;
      w.leafOpacity = 0;
      w.leafProgress = 1;
      w.leafAttention = 0;
      w.waterOpacity = 0;
      w.waterProgress = 1;
      w.soundMorph = 1;
      w.fieldOpacity = 1;
      break;
    }
    case 'ACT_07_SPECIES': {
      w.blacknessClear = 1;
      w.forestOpacity = 0;
      w.forestEmergence = 1;
      w.forestDefocus = 0;
      w.leafOpacity = 0;
      w.leafProgress = 1;
      w.leafAttention = 0;
      w.waterOpacity = 0;
      w.waterProgress = 1;
      w.soundMorph = 1;
      w.fieldOpacity = 1;
      w.speciesEmphasis = smooth(0.08, 0.55, p);
      break;
    }
    case 'ACT_08_DISTURBANCE': {
      w.blacknessClear = 1;
      w.forestOpacity = 0;
      w.forestEmergence = 1;
      w.forestDefocus = 0;
      w.leafOpacity = 0;
      w.leafProgress = 1;
      w.leafAttention = 0;
      w.waterOpacity = 0;
      w.waterProgress = 1;
      w.soundMorph = 1;
      w.fieldOpacity = 1;
      w.speciesEmphasis = (1 - smooth(0.0, 0.45, p)) * 0.5;
      w.disturbanceEmphasis = smooth(0.05, 0.52, p);
      break;
    }
    case 'ACT_09_SILENCE': {
      w.blacknessClear = 1;
      w.forestOpacity = 0;
      w.forestEmergence = 1;
      w.forestDefocus = 0;
      w.leafOpacity = 0;
      w.leafProgress = 1;
      w.leafAttention = 0;
      w.waterOpacity = 0;
      w.waterProgress = 1;
      w.soundMorph = 1;
      w.fieldOpacity = 1 - smooth(0.16, 0.96, p) * 0.74;
      w.silenceOverride = reducedMotion ? 1 : smooth(0.02, 0.82, p);
      break;
    }
    case 'ACT_10_ECOLOGICAL_CONTEXT': {
      w.blacknessClear = 1;
      w.forestOpacity = 0;
      w.forestEmergence = 1;
      w.forestDefocus = 0;
      w.leafOpacity = 0;
      w.leafProgress = 1;
      w.leafAttention = 0;
      w.waterOpacity = 0;
      w.waterProgress = 1;
      w.soundMorph = 1;
      w.fieldOpacity = 0.26 - smooth(0.0, 0.55, p) * 0.14;
      w.silenceOverride = 0.92;
      w.globeOpacity = reducedMotion ? 1 : smooth(0.04, 0.48, p);
      w.ecologicalFieldOpacity = reducedMotion ? 0.8 : smooth(0.68, 1.0, p) * 0.85;
      break;
    }
    case 'ACT_11_EXPECTED_SPECIES': {
      w.blacknessClear = 1;
      w.forestOpacity = 0;
      w.forestEmergence = 1;
      w.forestDefocus = 0;
      w.leafOpacity = 0;
      w.leafProgress = 1;
      w.leafAttention = 0;
      w.waterOpacity = 0;
      w.waterProgress = 1;
      w.soundMorph = 1;
      w.fieldOpacity = 0.08 * (1 - smooth(0.0, 0.4, p));
      w.silenceOverride = 0.96;
      w.globeOpacity = 1 - smooth(0.0, 0.45, p);
      w.ecologicalFieldOpacity = 1.0;
      break;
    }
    case 'ACT_12_OBSERVATION_GAP': {
      w.blacknessClear = 1;
      w.forestOpacity = 0;
      w.forestEmergence = 1;
      w.forestDefocus = 0;
      w.leafOpacity = 0;
      w.leafProgress = 1;
      w.leafAttention = 0;
      w.waterOpacity = 0;
      w.waterProgress = 1;
      w.soundMorph = 1;
      w.fieldOpacity = 0;
      w.silenceOverride = 0.96;
      w.globeOpacity = 0;
      w.ecologicalFieldOpacity = 1.0;
      break;
    }
  }
}
