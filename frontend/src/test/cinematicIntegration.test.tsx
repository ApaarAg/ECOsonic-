import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { CinematicScrollController } from "../cinematic/CinematicScrollController";
import { CinematicStateStore } from "../cinematic/CinematicState";
import {
  getActOverlayOpacity,
  evaluateTimelineAtScroll,
  getScrollProgressForAct,
  TIMELINE_SEGMENTS,
} from "../cinematic/CinematicTimeline";
import { evaluateCinematicTransitions } from "../cinematic/CinematicTransition";
import { acousticStore } from "../domain/acousticStore";
import { CINEMATIC_ACT_ORDER } from "../visual/Cinematic/cinematicSequence";

const originalScrollMetrics = [
  [document.documentElement, "scrollHeight", Object.getOwnPropertyDescriptor(document.documentElement, "scrollHeight")],
  [document.body, "scrollHeight", Object.getOwnPropertyDescriptor(document.body, "scrollHeight")],
  [window, "scrollY", Object.getOwnPropertyDescriptor(window, "scrollY")],
] as const;

describe("Acts 01-10 unified scroll timeline & integration", () => {
  beforeEach(() => {
    acousticStore.reset();
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
  for (const [target, property, descriptor] of originalScrollMetrics) {
    if (descriptor) {
      Object.defineProperty(target, property, descriptor);
    } else {
      Reflect.deleteProperty(target, property);
    }
  }
  });

  it("maps scrollProgress continuously across all 12 acts without gaps or overlaps", () => {
    expect(TIMELINE_SEGMENTS).toHaveLength(12);
    expect(TIMELINE_SEGMENTS[0].start).toBe(0);
    expect(TIMELINE_SEGMENTS[TIMELINE_SEGMENTS.length - 1].end).toBe(1);

    for (let i = 0; i < TIMELINE_SEGMENTS.length - 1; i++) {
      expect(TIMELINE_SEGMENTS[i].end).toBeCloseTo(
        TIMELINE_SEGMENTS[i + 1].start,
        6,
      );
    }

    const seenActs: string[] = [];
    for (let s = 0; s <= 100; s++) {
      const p = s / 100;
      const ev = evaluateTimelineAtScroll(p);
      expect(ev.actProgress).toBeGreaterThanOrEqual(0);
      expect(ev.actProgress).toBeLessThanOrEqual(1);
      if (seenActs[seenActs.length - 1] !== ev.act) {
        seenActs.push(ev.act);
      }
    }
    expect(seenActs).toEqual([...CINEMATIC_ACT_ORDER]);
  });

  it("evolves visual & audio weights continuously forward and backward without hard opacity cuts", () => {
    const midForest = evaluateCinematicTransitions(
      getScrollProgressForAct("ACT_02_FOREST", 0.65),
      0.04,
      false,
    );
    const leafAttached = evaluateCinematicTransitions(
      getScrollProgressForAct("ACT_03_LEAF", 0.0),
      0.02,
      false,
    );
    const waterPreContact = evaluateCinematicTransitions(
      getScrollProgressForAct("ACT_04_WATER", 0.05),
      0.02,
      false,
    );
    const waterRipple = evaluateCinematicTransitions(
      getScrollProgressForAct("ACT_04_WATER", 0.62),
      0.02,
      false,
    );
    const soundLift = evaluateCinematicTransitions(
      getScrollProgressForAct("ACT_05_SOUND", 0.55),
      0.02,
      false,
    );
    const ecologyEnd = evaluateCinematicTransitions(
      getScrollProgressForAct("ACT_10_ECOLOGICAL_CONTEXT", 0.85),
      0.01,
      false,
    );

    // Leaf is already present on branch during late forest & start of Act 03
    expect(midForest.weights.leafOpacity).toBeGreaterThan(0.25);
    expect(leafAttached.weights.leafOpacity).toBe(1);
    expect(leafAttached.weights.leafProgress).toBe(0);

    // Water surface is already visible before impact and sound particles seed out of water ripples
    expect(waterPreContact.weights.waterOpacity).toBeGreaterThan(0.9);
    expect(waterRipple.weights.waterProgress).toBeGreaterThan(0.5);
    expect(soundLift.weights.soundMorph).toBeGreaterThan(0.4);
    expect(soundLift.weights.fieldOpacity).toBeGreaterThan(0.8);
    expect(ecologyEnd.weights.globeOpacity).toBeGreaterThan(0.8);
  });

  it("crossfades adjacent act overlays at every boundary", () => {
    for (let i = 0; i < TIMELINE_SEGMENTS.length - 1; i++) {
      const previous = TIMELINE_SEGMENTS[i];
      const next = TIMELINE_SEGMENTS[i + 1];
      const boundary = previous.end;
      const combinedOpacity =
        getActOverlayOpacity(previous.act, boundary) +
        getActOverlayOpacity(next.act, boundary);

      expect(combinedOpacity).toBeCloseTo(1, 3);
    }
  });

  it("derives the cinematic act from document scroll and reverses with upward scroll", () => {
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 10000,
    });
    Object.defineProperty(document.body, "scrollHeight", {
      configurable: true,
      value: 10000,
    });

    const store = new CinematicStateStore();
    const controller = new CinematicScrollController(store);
    const detach = controller.attach();
    const range = 10000 - window.innerHeight;

    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: Math.round(0.25 * range),
    });
    fireEvent.scroll(window);
    expect(store.runtime.rawScrollProgress).toBeCloseTo(0.25, 3);
    for (let i = 0; i < 90; i++) store.step(1 / 60);
    expect(store.getEvaluation().act).toBe("ACT_03_LEAF");

    // React StrictMode replays effect cleanup/setup during development.
    detach();
    const reattach = controller.attach();
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: Math.round(0.12 * range),
    });
    fireEvent.scroll(window);
    for (let i = 0; i < 90; i++) store.step(1 / 60);
    expect(store.getEvaluation().act).toBe("ACT_02_FOREST");

    reattach();
  });

  it("supports scroll inertia, reverse scrubbing, and instant snap under reducedMotion", () => {
    const store = new CinematicStateStore("ACT_01_BLACKNESS", false);
    const waterTarget = getScrollProgressForAct("ACT_04_WATER", 0.5);
    store.setTargetScroll(waterTarget, false);

    // Advances progressively with inertia rather than popping instantaneously
    store.step(0.016);
    expect(store.runtime.smoothScrollProgress).toBeGreaterThan(0);
    expect(store.runtime.smoothScrollProgress).toBeLessThan(waterTarget);

    for (let i = 0; i < 60; i++) store.step(0.016);
    expect(store.runtime.smoothScrollProgress).toBeCloseTo(waterTarget, 2);

    // Reverse scroll back into ACT 02 FOREST works symmetrically
    const forestTarget = getScrollProgressForAct("ACT_02_FOREST", 0.5);
    store.setTargetScroll(forestTarget, false);
    for (let i = 0; i < 60; i++) store.step(0.016);
    expect(store.getEvaluation().act).toBe("ACT_02_FOREST");

    // Reduced motion snaps cleanly
    store.setReducedMotion(true);
    const speciesTarget = getScrollProgressForAct("ACT_07_SPECIES", 0.6);
    store.setTargetScroll(speciesTarget, false);
    expect(store.runtime.smoothScrollProgress).toBe(speciesTarget);
  });

  it("renders one scroll page with Pixel Swarm Dropdown wired to the unified timeline", () => {
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 10000,
    });
    Object.defineProperty(document.body, "scrollHeight", {
      configurable: true,
      value: 10000,
    });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});

    const { container } = render(<App />);

    expect(screen.getByTestId("cinematic-scroll-root")).toBeInTheDocument();
    expect(screen.getAllByTestId("cinematic-canvas-host")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /sequence|pause/i })).not.toBeInTheDocument();
    expect(container.querySelector("[data-cinematic-timeline-nav]")).not.toBeInTheDocument();

    expect(screen.queryByTestId("scribble-loop-nav")).not.toBeInTheDocument();
    expect(screen.getByTestId("pixel-swarm-nav")).toBeInTheDocument();
    expect(screen.getByTestId("pixel-swarm-trigger")).toHaveAttribute(
      "aria-label",
      expect.stringMatching(/01 · ECOsonic/i),
    );
    expect(screen.getByTestId("landing-ecosonic-spotlight")).toBeInTheDocument();

    expect(
      screen.getByRole("region", { name: /Scene 01: Blackness/i }),
    ).toBeInTheDocument();

    const store = new CinematicStateStore();
    const controller = new CinematicScrollController(store);
    controller.scrollToProgress(getScrollProgressForAct("ACT_03_LEAF"), false);
    expect(scrollTo).toHaveBeenCalledWith({
      top: Math.round(
        getScrollProgressForAct("ACT_03_LEAF") * (10000 - window.innerHeight),
      ),
      behavior: "auto",
    });
  });
});
