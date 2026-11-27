import {
  CINEMATIC_ACT_ORDER,
  resolveForestWaterPhase,
  type CinematicActId,
  type ForestWaterPhase,
} from "../visual/Cinematic/cinematicSequence";

export interface TimelineSegment {
  act: CinematicActId;
  start: number;
  end: number;
  defaultLocalProgress: number;
  label: string;
}

export const TOTAL_TIMELINE_VH = 1240;

export const TIMELINE_SEGMENTS: readonly TimelineSegment[] = [
  {
    act: "ACT_01_BLACKNESS",
    start: 0.0,
    end: 0.055,
    defaultLocalProgress: 0.0,
    label: "01 BLACKNESS",
  },
  {
    act: "ACT_02_FOREST",
    start: 0.055,
    end: 0.175,
    defaultLocalProgress: 0.58,
    label: "02 FOREST",
  },
  {
    act: "ACT_03_LEAF",
    start: 0.175,
    end: 0.32,
    defaultLocalProgress: 0.38,
    label: "03 LEAF",
  },
  {
    act: "ACT_04_WATER",
    start: 0.32,
    end: 0.435,
    defaultLocalProgress: 0.52,
    label: "04 WATER",
  },
  {
    act: "ACT_05_SOUND",
    start: 0.435,
    end: 0.545,
    defaultLocalProgress: 0.52,
    label: "05 SOUND",
  },
  {
    act: "ACT_06_ACOUSTIC_FIELD",
    start: 0.545,
    end: 0.645,
    defaultLocalProgress: 0.48,
    label: "06 ACOUSTIC FIELD",
  },
  {
    act: "ACT_07_SPECIES",
    start: 0.645,
    end: 0.73,
    defaultLocalProgress: 0.56,
    label: "07 SPECIES",
  },
  {
    act: "ACT_08_DISTURBANCE",
    start: 0.73,
    end: 0.8,
    defaultLocalProgress: 0.56,
    label: "08 DISTURBANCE",
  },
  {
    act: "ACT_09_SILENCE",
    start: 0.8,
    end: 0.845,
    defaultLocalProgress: 0.72,
    label: "09 SILENCE",
  },
  {
    act: "ACT_10_ECOLOGICAL_CONTEXT",
    start: 0.845,
    end: 0.9,
    defaultLocalProgress: 0.64,
    label: "10 ECOLOGICAL CONTEXT",
  },
  {
    act: "ACT_11_EXPECTED_SPECIES",
    start: 0.9,
    end: 0.95,
    defaultLocalProgress: 0.5,
    label: "11 EXPECTED SPECIES",
  },
  {
    act: "ACT_12_OBSERVATION_GAP",
    start: 0.95,
    end: 1.0,
    defaultLocalProgress: 0.5,
    label: "12 OBSERVATION GAP",
  },
] as const;

export interface TimelineEvaluation {
  scrollProgress: number;
  act: CinematicActId;
  actIndex: number;
  actProgress: number;
  segmentStart: number;
  segmentEnd: number;
  nextAct: CinematicActId | null;
  forestWaterPhase: ForestWaterPhase;
}

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Resolves global normalized scrollProgress [0..1] into the active Act,
 * normalized within-act progress, and continuous Forest/Leaf/Water phase.
 */
export function evaluateTimelineAtScroll(scrollProgress: number): TimelineEvaluation {
  const p = clamp01(scrollProgress);

  for (let i = 0; i < TIMELINE_SEGMENTS.length; i++) {
    const seg = TIMELINE_SEGMENTS[i];
    const isLast = i === TIMELINE_SEGMENTS.length - 1;
    if (p < seg.end || isLast) {
      const span = Math.max(0.0001, seg.end - seg.start);
      const actProgress = clamp01((p - seg.start) / span);
      return {
        scrollProgress: p,
        act: seg.act,
        actIndex: i,
        actProgress,
        segmentStart: seg.start,
        segmentEnd: seg.end,
        nextAct: isLast ? null : CINEMATIC_ACT_ORDER[i + 1],
        forestWaterPhase: resolveForestWaterPhase(seg.act, actProgress),
      };
    }
  }

  const last = TIMELINE_SEGMENTS[TIMELINE_SEGMENTS.length - 1];
  return {
    scrollProgress: 1,
    act: last.act,
    actIndex: TIMELINE_SEGMENTS.length - 1,
    actProgress: 1,
    segmentStart: last.start,
    segmentEnd: last.end,
    nextAct: null,
    forestWaterPhase: resolveForestWaterPhase(last.act, 1),
  };
}

/**
 * Returns the canonical global scrollProgress [0..1] for any Act and optional local progress.
 */
export function getScrollProgressForAct(
  act: CinematicActId,
  localProgress?: number,
): number {
  const seg =
    TIMELINE_SEGMENTS.find((s) => s.act === act) ?? TIMELINE_SEGMENTS[0];
  const local = clamp01(
    localProgress === undefined ? seg.defaultLocalProgress : localProgress,
  );
  return clamp01(seg.start + local * (seg.end - seg.start));
}

export function getSegmentForAct(act: CinematicActId): TimelineSegment {
  return TIMELINE_SEGMENTS.find((s) => s.act === act) ?? TIMELINE_SEGMENTS[0];
}

/**
 * Gives editorial overlays the same short, reversible blend at each act
 * boundary as the visual layers use. Adjacent acts sum to a soft crossfade,
 * including when the user scrubs quickly or scrolls backward.
 */
export function getActOverlayOpacity(
  act: CinematicActId,
  scrollProgress: number,
  blendHalfSpan = 0.018,
): number {
  const progress = clamp01(scrollProgress);
  const segment = getSegmentForAct(act);
  const blend = Math.min(blendHalfSpan, (segment.end - segment.start) * 0.3);

  const fadeIn =
    segment.start <= 0
      ? 1
      : smoothstep(segment.start - blend, segment.start + blend, progress);
  const fadeOut =
    segment.end >= 1
      ? 1
      : 1 - smoothstep(segment.end - blend, segment.end + blend, progress);

  return clamp01(fadeIn * fadeOut);
}
