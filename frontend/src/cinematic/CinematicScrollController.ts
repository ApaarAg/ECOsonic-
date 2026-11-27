import { clamp01 } from "./CinematicTimeline";
import type { CinematicStateStore } from "./CinematicState";

/**
 * Unifies document scroll events, ResizeObserver viewport height changes,
 * smooth programmatic timeline shortcuts, and the single shared rAF tick.
 */
export class CinematicScrollController {
  private readonly store: CinematicStateStore;
  private programmaticScrollUntilMs = 0;
  private lastProgrammaticScrollY = -1;
  private disposed = false;

  constructor(store: CinematicStateStore) {
    this.store = store;
  }

  static getScrollRangePx(): number {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return 0;
    }
    const docEl = document.documentElement;
    const totalHeight = Math.max(
      docEl?.scrollHeight ?? 0,
      document.body?.scrollHeight ?? 0,
    );
    return Math.max(0, totalHeight - window.innerHeight);
  }

  static readWindowScrollProgress(): number {
    if (typeof window === "undefined") return 0;
    const range = CinematicScrollController.getScrollRangePx();
    if (range <= 1) return 0;
    return clamp01(window.scrollY / range);
  }

  attach(): () => void {
    if (typeof window === "undefined") return () => {};
    // React StrictMode replays effect setup/cleanup in development. Re-attach
    // the same controller instance so manual scroll remains live afterward.
    this.disposed = false;

    const handleScroll = () => {
      if (this.disposed) return;
      const range = CinematicScrollController.getScrollRangePx();
      if (range <= 1) return;

      const currentProgress = clamp01(window.scrollY / range);
      const now = performance.now();

      // Ignore intermediate scroll events emitted while programmatic smooth scroll is still traveling
      if (now < this.programmaticScrollUntilMs) {
        if (Math.abs(window.scrollY - this.lastProgrammaticScrollY) <= 8) {
          this.programmaticScrollUntilMs = 0;
        }
        return;
      }

      const instantSync = typeof document !== "undefined" && document.hidden;
      this.store.setTargetScroll(currentProgress, instantSync);
    };

    const handleResize = () => {
      if (this.disposed) return;
      const range = CinematicScrollController.getScrollRangePx();
      if (range > 1) {
        this.scrollToProgress(this.store.runtime.rawScrollProgress, true);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize, { passive: true });

    return () => {
      this.disposed = true;
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    };
  }

  /**
   * Synchronizes window scrollY cleanly without fighting jsdom or browser scroll inertia.
   */
  scrollToProgress(progress: number, instant = false): void {
    const clamped = clamp01(progress);
    const range = CinematicScrollController.getScrollRangePx();

    this.store.setTargetScroll(clamped, instant || range <= 1);

    if (range > 1 && typeof window !== "undefined") {
      const targetY = Math.round(clamped * range);
      this.programmaticScrollUntilMs = performance.now() + 260;
      this.lastProgrammaticScrollY = targetY;
      try {
        // Sync DOM scrollY in one step so browser smooth-scroll inertia never overrides
        // CinematicStateStore's own WebGL inertia interpolation while traveling across acts.
        window.scrollTo({
          top: targetY,
          behavior: "auto",
        });
      } catch {
        // jsdom fallback where window.scrollTo may throw NotImplementedError
      }
    }
  }

  /** Called from the single WebGLStage rAF callback. */
  tick(dt: number) {
    return this.store.step(dt);
  }
}
