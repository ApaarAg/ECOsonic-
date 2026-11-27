import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import {
  createForestRuntimeState,
  stageReveal,
  stepForestState,
} from "../visual/Forest/forestState";

describe("ACT 02 — FOREST state & scene", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("progresses blackness-to-forest emergence across deterministic stages", () => {
    const state = createForestRuntimeState(false);
    expect(state.emergence).toBe(0);

    for (let i = 0; i < 60; i++) {
      stepForestState(state, 1 / 60, 0.14, false);
    }
    expect(state.emergence).toBeGreaterThan(0.2);
    expect(stageReveal(state.emergence, 0.02, 0.34)).toBeGreaterThan(0.5);
    expect(stageReveal(state.emergence, 0.64, 0.96)).toBe(0);

    for (let i = 0; i < 240; i++) {
      stepForestState(state, 1 / 60, 0.14, false);
    }
    expect(state.emergence).toBe(1);
    expect(stageReveal(state.emergence, 0.64, 0.96)).toBe(1);
  });

  it("snaps emergence to 1 and zeros drift/parallax under reduced motion", () => {
    const state = createForestRuntimeState(true);
    state.targetNdcX = 0.8;
    state.targetNdcY = -0.6;
    stepForestState(state, 0.016, 0.14, true);

    expect(state.emergence).toBe(1);
    expect(state.driftX).toBe(0);
    expect(state.driftY).toBe(0);
    expect(state.parallaxX).toBe(0);
    expect(state.parallaxY).toBe(0);
  });

  it("transitions cleanly to ACT 02 FOREST via timeline URL with Pixel Swarm Dropdown", () => {
    window.history.replaceState({}, "", "/?act=forest");
    const { container } = render(<App />);
    expect(container.querySelector("[data-cinematic-timeline-nav]")).not.toBeInTheDocument();
    expect(screen.queryByTestId("scribble-loop-nav")).not.toBeInTheDocument();
    expect(screen.getByTestId("pixel-swarm-nav")).toBeInTheDocument();
    expect(screen.getByTestId("pixel-swarm-trigger")).toHaveAttribute(
      "aria-label",
      expect.stringMatching(/02 · Living Valley/i),
    );

    expect(
      screen.getByRole("region", { name: /Scene 02: Forest/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /THE LIVING FIELD/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /\+ TRACE/i }),
    ).not.toBeInTheDocument();
  });
});
