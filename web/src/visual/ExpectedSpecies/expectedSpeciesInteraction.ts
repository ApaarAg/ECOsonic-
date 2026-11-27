export interface PointerTilt {
  rotateXDeg: number;
  rotateYDeg: number;
}

export interface SpecimenToViewportOrigin {
  dxPx: number;
  dyPx: number;
  scaleX: number;
  scaleY: number;
  initialRotateYDeg: number;
  initialRotateZDeg: number;
}

export function clamp(val: number, min: number, max: number): number {
  return val < min ? min : val > max ? max : val;
}

/** Frame-rate independent exponential smoothing */
export function dampValue(current: number, target: number, lambda: number, dtSec: number): number {
  if (dtSec <= 0) return current;
  return current + (target - current) * (1 - Math.exp(-lambda * dtSec));
}

/** Subtle physical specimen plate cursor tilt (zero tilt in reduced-motion or touch) */
export function computePlateTilt(
  normX: number,
  normY: number,
  reducedMotion: boolean
): PointerTilt {
  if (reducedMotion) {
    return { rotateXDeg: 0, rotateYDeg: 0 };
  }
  return {
    rotateYDeg: clamp(normX, -1, 1) * 4.5,
    rotateXDeg: clamp(-normY, -1, 1) * 3.5,
  };
}

/**
 * Computes FLIP origin delta from a selected specimen plate's bounding box
 * so the Field Note paper sheet physically originates from and rotates out of the plate.
 */
export function computeSpecimenToViewportOrigin(
  specimenRect: { left: number; top: number; width: number; height: number } | null,
  viewportWidth: number,
  viewportHeight: number
): SpecimenToViewportOrigin {
  if (!specimenRect || viewportWidth <= 0 || viewportHeight <= 0) {
    return {
      dxPx: 0,
      dyPx: 28,
      scaleX: 0.42,
      scaleY: 0.56,
      initialRotateYDeg: -6,
      initialRotateZDeg: -1.1,
    };
  }

  const specCenterX = specimenRect.left + specimenRect.width * 0.5;
  const specCenterY = specimenRect.top + specimenRect.height * 0.5;
  const vpCenterX = viewportWidth * 0.5;
  const vpCenterY = viewportHeight * 0.5;

  const dxPx = specCenterX - vpCenterX;
  const dyPx = specCenterY - vpCenterY;
  const scaleX = clamp(specimenRect.width / viewportWidth, 0.16, 0.85);
  const scaleY = clamp(specimenRect.height / viewportHeight, 0.2, 0.88);

  return {
    dxPx,
    dyPx,
    scaleX,
    scaleY,
    initialRotateYDeg: -7.5,
    initialRotateZDeg: -1.25,
  };
}

/**
 * Maps archive keyboard interactions deterministically.
 */
export function resolveArchiveKeyboardAction(
  key: string,
  currentIndex: number,
  total: number,
  isFieldNoteOpen: boolean
):
  | { type: 'select'; nextIndex: number }
  | { type: 'open_note' }
  | { type: 'close_note' }
  | null {
  if (total <= 0) return null;

  if (key === 'Escape' && isFieldNoteOpen) {
    return { type: 'close_note' };
  }

  if (isFieldNoteOpen) {
    return null;
  }

  if (key === 'ArrowLeft') {
    return { type: 'select', nextIndex: Math.max(0, currentIndex - 1) };
  }
  if (key === 'ArrowRight') {
    return { type: 'select', nextIndex: Math.min(total - 1, currentIndex + 1) };
  }
  if (key === 'Home') {
    return { type: 'select', nextIndex: 0 };
  }
  if (key === 'End') {
    return { type: 'select', nextIndex: total - 1 };
  }
  if (key === 'Enter' || key === ' ') {
    return { type: 'open_note' };
  }

  return null;
}
