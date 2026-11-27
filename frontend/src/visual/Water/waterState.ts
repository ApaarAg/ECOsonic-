/**
 * Pure shallow forest-pool disturbance & wave damping controller for ACT 04 — WATER
 * and its physical dispersion bridge into ACT 05 — SOUND.
 * Synchronized strictly with WATER_CONTACT_PROGRESS (0.14) so ripples NEVER start
 * before the leaf touches the water surface.
 */

import { WATER_CONTACT_PROGRESS } from "../Leaf/leafState";

export interface WaterRuntimeState {
  waterProgress: number;
  rippleAge: number;
  contactImpulse: number;
  contactSplash: number;
  impactX: number;
  impactZ: number;
  harmonicBridge: number;
}

export function createWaterRuntimeState(): WaterRuntimeState {
  return {
    waterProgress: 0,
    rippleAge: 0,
    contactImpulse: 0,
    contactSplash: 0,
    impactX: 0.04,
    impactZ: 0.94,
    harmonicBridge: 0,
  };
}

export function stepWaterState(
  state: WaterRuntimeState,
  waterProgress: number,
  soundProgress: number,
  _dt: number,
  reducedMotion: boolean,
): void {
  const w = Math.max(0, Math.min(1, waterProgress));
  const s = Math.max(0, Math.min(1, soundProgress));
  state.waterProgress = w;

  // Still water before physical leaf contact (0.14 in ACT 04)
  const contactThreshold = reducedMotion ? 0.05 : WATER_CONTACT_PROGRESS;
  if (w < contactThreshold && s <= 0) {
    state.rippleAge = 0;
    state.contactImpulse = 0;
    state.contactSplash = 0;
    state.harmonicBridge = 0;
    return;
  }

  const postContactSpan = Math.max(0.01, 1 - contactThreshold);
  const wElapsed = Math.max(0, (w - contactThreshold) / postContactSpan) * 5.2;
  const sElapsed = s * 5.8;
  state.rippleAge = wElapsed + sElapsed;

  // Short-lived localized meniscus depression right at surface contact
  state.contactSplash = reducedMotion
    ? 0
    : Math.exp(-Math.pow((state.rippleAge - 0.14) / 0.22, 2)) * 0.92;

  // Gentle rise at touch followed by natural viscous damping toward calm stillness
  const rise = Math.min(1, state.rippleAge / 0.16);
  const damped = Math.exp(-state.rippleAge * 0.24);
  state.contactImpulse = reducedMotion
    ? 0.16
    : Math.max(0.06 * s, rise * damped);

  state.harmonicBridge = s;
}
