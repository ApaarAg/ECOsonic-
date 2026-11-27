import {
  cinematicIdToStoryboardAct,
  storyboardActToCinematicId,
  type CinematicActId,
  type ForestWaterPhase,
} from "../visual/Cinematic/cinematicSequence";
import type { StoryboardAct } from "../domain/storyboard";
import {
  clamp01,
  evaluateTimelineAtScroll,
  getScrollProgressForAct,
} from "./CinematicTimeline";
import {
  evaluateCinematicTransitions,
  type CinematicTransitionFrame,
} from "./CinematicTransition";

export interface CinematicSnapshot {
  scrollProgress: number;
  targetScrollProgress: number;
  scrollVelocity: number;
  currentAct: CinematicActId;
  storyboardAct: StoryboardAct;
  actProgress: number;
  forestWaterPhase: ForestWaterPhase;
  audioUnlocked: boolean;
  reducedMotion: boolean;
}

export interface CinematicRuntimeState {
  rawScrollProgress: number;
  smoothScrollProgress: number;
  scrollVelocity: number;
  audioUnlocked: boolean;
  reducedMotion: boolean;
  clock: number;
  lastTransition: CinematicTransitionFrame;
}

type StateListener = () => void;

export class CinematicStateStore {
  readonly runtime: CinematicRuntimeState;
  private snapshot: CinematicSnapshot;
  private readonly listeners = new Set<StateListener>();
  private lastNotifiedAct: CinematicActId;
  private lastNotifiedAudio: boolean;
  private lastUiSyncClock = 0;

  constructor(
    initialAct: CinematicActId = "ACT_01_BLACKNESS",
    reducedMotion = false,
  ) {
    const startProgress = getScrollProgressForAct(
      initialAct,
      initialAct === "ACT_01_BLACKNESS" ? 0 : undefined,
    );
    const frame = evaluateCinematicTransitions(startProgress, 0, reducedMotion);

    this.runtime = {
      rawScrollProgress: startProgress,
      smoothScrollProgress: startProgress,
      scrollVelocity: 0,
      audioUnlocked: false,
      reducedMotion,
      clock: 0,
      lastTransition: frame,
    };

    this.lastNotifiedAct = frame.evaluation.act;
    this.lastNotifiedAudio = false;
    this.snapshot = this.buildSnapshot(frame);
  }

  private buildSnapshot(frame: CinematicTransitionFrame): CinematicSnapshot {
    return {
      scrollProgress: this.runtime.smoothScrollProgress,
      targetScrollProgress: this.runtime.rawScrollProgress,
      scrollVelocity: this.runtime.scrollVelocity,
      currentAct: frame.evaluation.act,
      storyboardAct: cinematicIdToStoryboardAct(frame.evaluation.act),
      actProgress: frame.evaluation.actProgress,
      forestWaterPhase: frame.evaluation.forestWaterPhase,
      audioUnlocked: this.runtime.audioUnlocked,
      reducedMotion: this.runtime.reducedMotion,
    };
  }

  subscribe = (listener: StateListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): CinematicSnapshot => this.snapshot;

  setReducedMotion(reduced: boolean): void {
    if (this.runtime.reducedMotion === reduced) return;
    this.runtime.reducedMotion = reduced;
    if (reduced) {
      this.runtime.smoothScrollProgress = this.runtime.rawScrollProgress;
      this.runtime.scrollVelocity = 0;
    }
    this.syncFrame(true);
  }

  setTargetScroll(progress: number, instant = false): void {
    const clamped = clamp01(progress);
    this.runtime.rawScrollProgress = clamped;
    if (instant || this.runtime.reducedMotion) {
      this.runtime.smoothScrollProgress = clamped;
      this.runtime.scrollVelocity = 0;
    }
    this.syncFrame(instant);
  }

  setAudioUnlocked(unlocked: boolean): void {
    if (this.runtime.audioUnlocked === unlocked) return;
    this.runtime.audioUnlocked = unlocked;
    this.syncFrame(true);
  }

  jumpToAct(
    act: CinematicActId | StoryboardAct,
    localProgress?: number,
  ): number {
    const actId: CinematicActId =
      typeof act === "string" && act.startsWith("ACT_")
        ? (act as CinematicActId)
        : storyboardActToCinematicId(act as StoryboardAct);
    const target = getScrollProgressForAct(actId, localProgress);
    this.runtime.rawScrollProgress = target;
    this.runtime.smoothScrollProgress = target;
    this.runtime.scrollVelocity = 0;
    this.syncFrame(true);
    return target;
  }

  /**
   * Advances inertia scroll & continuous timeline state inside the SINGLE WebGLStage rAF loop.
   * Returns newly entered act if an act boundary was crossed this frame.
   */
  step(dt: number): CinematicActId | null {
    const safeDt = Math.min(0.1, Math.max(0.001, dt));
    this.runtime.clock += safeDt;

    const prevSmooth = this.runtime.smoothScrollProgress;
    if (this.runtime.reducedMotion) {
      this.runtime.smoothScrollProgress = this.runtime.rawScrollProgress;
      this.runtime.scrollVelocity = 0;
    } else {
      const diff = this.runtime.rawScrollProgress - prevSmooth;
      // Adaptive damping: brisk response on fast flicks, silk-smooth settling when close
      const damping = 9.5 + Math.min(18, Math.abs(diff) * 90);
      const factor = 1 - Math.exp(-damping * safeDt);
      const next =
        Math.abs(diff) < 0.00008 ? this.runtime.rawScrollProgress : prevSmooth + diff * factor;
      this.runtime.smoothScrollProgress = clamp01(next);
      this.runtime.scrollVelocity =
        (this.runtime.smoothScrollProgress - prevSmooth) / safeDt;
    }

    const prevAct = this.lastNotifiedAct;
    const frame = evaluateCinematicTransitions(
      this.runtime.smoothScrollProgress,
      this.runtime.scrollVelocity,
      this.runtime.reducedMotion,
    );
    this.runtime.lastTransition = frame;

    const actChanged = frame.evaluation.act !== prevAct;
    const stateChanged =
      actChanged ||
      this.runtime.audioUnlocked !== this.lastNotifiedAudio;

    // Throttle React snapshot broadcasts (~20Hz during motion, instant on act/state changes)
    const shouldBroadcast =
      stateChanged ||
      (Math.abs(this.runtime.scrollVelocity) > 0.001 &&
        this.runtime.clock - this.lastUiSyncClock >= 0.05);

    if (shouldBroadcast) {
      this.lastUiSyncClock = this.runtime.clock;
      this.lastNotifiedAct = frame.evaluation.act;
      this.lastNotifiedAudio = this.runtime.audioUnlocked;
      this.snapshot = this.buildSnapshot(frame);
      this.emit();
    }

    return actChanged ? frame.evaluation.act : null;
  }

  getEvaluation() {
    return evaluateTimelineAtScroll(this.runtime.smoothScrollProgress);
  }

  private syncFrame(forceEmit: boolean): void {
    const frame = evaluateCinematicTransitions(
      this.runtime.smoothScrollProgress,
      this.runtime.scrollVelocity,
      this.runtime.reducedMotion,
    );
    this.runtime.lastTransition = frame;

    if (forceEmit) {
      this.lastNotifiedAct = frame.evaluation.act;
      this.lastNotifiedAudio = this.runtime.audioUnlocked;
      this.snapshot = this.buildSnapshot(frame);
      this.emit();
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
