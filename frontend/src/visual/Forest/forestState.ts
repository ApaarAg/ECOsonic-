/**
 * Pure runtime state & staged blackness-to-forest emergence controller
 * for ACT 02 — FOREST. Zero React dependencies; mutates in place at 60+ FPS.
 */

export interface ForestAudioHook {
  /** Future ambient wind/rain energy [0..1]; remains 0 until audio system arrives. */
  ambientEnergy: number;
}

export interface ForestRuntimeState {
  /** Normalized elapsed seconds for non-repeating organic drift. */
  clock: number;
  /**
   * Emergence progress from ACT 01 BLACKNESS [0..1]:
   * 0.00 -> 0.25: faint atmospheric moisture
   * 0.25 -> 0.50: distant vertical conifer silhouettes
   * 0.50 -> 0.78: midground trunks & canopy boughs
   * 0.78 -> 1.00: foreground sword ferns, Isothecium moss & hero maple leaf
   */
  emergence: number;
  /** Documentary standing-camera subtle drift offset. */
  driftX: number;
  driftY: number;
  /** Smoothed pointer parallax offset. */
  parallaxX: number;
  parallaxY: number;
  /** Target pointer NDC [-1..1]. */
  targetNdcX: number;
  targetNdcY: number;
  /** Hook for future Web Audio ambient coupling without fake audio now. */
  audioHook: ForestAudioHook;
}

export function createForestRuntimeState(
  reducedMotion = false,
): ForestRuntimeState {
  return {
    clock: 0,
    emergence: reducedMotion ? 1 : 0,
    driftX: 0,
    driftY: 0,
    parallaxX: 0,
    parallaxY: 0,
    targetNdcX: 0,
    targetNdcY: 0,
    audioHook: { ambientEnergy: 0 },
  };
}

/** Smooth cubic/quintic stage curve over normalized interval [edge0, edge1]. */
export function stageReveal(emergence: number, edge0: number, edge1: number): number {
  if (emergence <= edge0) return 0;
  if (emergence >= edge1) return 1;
  const t = (emergence - edge0) / (edge1 - edge0);
  return t * t * (3 - 2 * t);
}

export function stepForestState(
  state: ForestRuntimeState,
  dt: number,
  parallaxStrength: number,
  reducedMotion: boolean,
): void {
  if (reducedMotion) {
    state.emergence = 1;
    state.driftX = 0;
    state.driftY = 0;
    state.parallaxX = 0;
    state.parallaxY = 0;
    return;
  }

  state.clock += dt;

  // Staged eye-adaptation over ~3.8 seconds from blackness
  if (state.emergence < 1) {
    state.emergence = Math.min(1, state.emergence + dt / 3.8);
  }

  // Non-periodic irrational-frequency documentary camera breathing (no obvious loop)
  const t = state.clock;
  state.driftX =
    Math.sin(t * 0.173) * 0.022 + Math.sin(t * 0.071 + 1.4) * 0.014;
  state.driftY =
    Math.cos(t * 0.131 + 0.6) * 0.012 + Math.sin(t * 0.053) * 0.008;

  const rate = 1 - Math.exp(-3.2 * dt);
  const targetPx = state.targetNdcX * parallaxStrength;
  const targetPy = state.targetNdcY * parallaxStrength * 0.55;
  state.parallaxX += (targetPx - state.parallaxX) * rate;
  state.parallaxY += (targetPy - state.parallaxY) * rate;
}
