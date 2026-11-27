import { Vector2, Vector3 } from "three";

export interface FieldInteractionState {
  /** Normalized pointer coordinates [-1, 1] */
  ndc: Vector2;
  /** Smoothed camera parallax offset */
  parallax: Vector2;
  /** 3D point on the observation field shell nearest the pointer */
  worldFocus: Vector3;
  /** Whether pointer is actively hovering/touching the field [0..1] */
  pointerPresence: number;
  /** Subtle rotational nudge from drag */
  dragYaw: number;
  dragPitch: number;
  isDragging: boolean;
}

export function createFieldInteractionState(): FieldInteractionState {
  return {
    ndc: new Vector2(0, 0),
    parallax: new Vector2(0, 0),
    worldFocus: new Vector3(0, 0, 1.8),
    pointerPresence: 0,
    dragYaw: 0,
    dragPitch: 0,
    isDragging: false,
  };
}

export function updatePointerNdc(
  state: FieldInteractionState,
  clientX: number,
  clientY: number,
  rect: DOMRect,
): void {
  if (rect.width <= 0 || rect.height <= 0) return;
  const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
  state.ndc.set(
    Math.max(-1, Math.min(1, nx)),
    Math.max(-1, Math.min(1, ny)),
  );
  state.pointerPresence = 1;
}

export function stepFieldInteraction(
  state: FieldInteractionState,
  dt: number,
  parallaxStrength: number,
  reducedMotion: boolean,
): void {
  const rate = 1 - Math.exp(-5.5 * dt);

  if (reducedMotion) {
    state.parallax.lerp(new Vector2(0, 0), rate);
    state.pointerPresence *= Math.exp(-6 * dt);
    state.dragYaw *= Math.exp(-6 * dt);
    state.dragPitch *= Math.exp(-6 * dt);
    return;
  }

  const targetPx = state.ndc.x * parallaxStrength;
  const targetPy = state.ndc.y * parallaxStrength * 0.7;
  state.parallax.x += (targetPx - state.parallax.x) * rate;
  state.parallax.y += (targetPy - state.parallax.y) * rate;

  // Map NDC onto a gentle front-hemisphere focus point on radius ~1.85
  const r = 1.85;
  const x = state.ndc.x * r * 0.85;
  const y = state.ndc.y * r * 0.85;
  const zSq = Math.max(0.15, r * r - x * x - y * y);
  const targetZ = Math.sqrt(zSq);

  state.worldFocus.x += (x - state.worldFocus.x) * rate;
  state.worldFocus.y += (y - state.worldFocus.y) * rate;
  state.worldFocus.z += (targetZ - state.worldFocus.z) * rate;

  if (!state.isDragging) {
    state.dragYaw *= Math.exp(-1.4 * dt);
    state.dragPitch *= Math.exp(-1.4 * dt);
  }
}

export function attachFieldInteractionListeners(
  element: HTMLElement,
  state: FieldInteractionState,
): () => void {
  let lastX = 0;
  let lastY = 0;

  const onPointerMove = (e: PointerEvent) => {
    const rect = element.getBoundingClientRect();
    updatePointerNdc(state, e.clientX, e.clientY, rect);

    if (state.isDragging) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      state.dragYaw = Math.max(-0.55, Math.min(0.55, state.dragYaw + dx * 0.0032));
      state.dragPitch = Math.max(
        -0.35,
        Math.min(0.35, state.dragPitch + dy * 0.0026),
      );
      lastX = e.clientX;
      lastY = e.clientY;
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    state.isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    const rect = element.getBoundingClientRect();
    updatePointerNdc(state, e.clientX, e.clientY, rect);
  };

  const onPointerUp = () => {
    state.isDragging = false;
  };

  const onPointerLeave = () => {
    state.isDragging = false;
    state.pointerPresence = 0;
  };

  element.addEventListener("pointermove", onPointerMove, { passive: true });
  element.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("pointerup", onPointerUp, { passive: true });
  element.addEventListener("pointerleave", onPointerLeave, { passive: true });

  return () => {
    element.removeEventListener("pointermove", onPointerMove);
    element.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointerup", onPointerUp);
    element.removeEventListener("pointerleave", onPointerLeave);
  };
}
