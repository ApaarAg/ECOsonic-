import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { getActOverlayOpacity, getScrollProgressForAct } from "../cinematic/CinematicTimeline";
import { evaluateCinematicTransitions } from "../cinematic/CinematicTransition";
import { CinematicStateStore } from "../cinematic/CinematicState";
import { CinematicScrollController } from "../cinematic/CinematicScrollController";
import { ContinuousAudioTimeline } from "../cinematic/CinematicAudioTimeline";
import { acousticStore } from "../domain/acousticStore";
import { buildExplicitDemoBaseline } from "../api/ecosonicEcologyApi";
import { CinematicStage } from "../visual/Cinematic/CinematicStage";

describe("ACT 10 -> 11 -> 12 Final Visual Polish Integration", () => {
  afterEach(() => {
    acousticStore.reset();
  });

  it("replaces old Three.js globe with PhotoCardGlobe in ACT 10 without polluting shared-scene-background", () => {
    acousticStore.setExpectedBaseline(buildExplicitDemoBaseline());
    const act10Progress = getScrollProgressForAct("ACT_10_ECOLOGICAL_CONTEXT", 0.5);
    const store = new CinematicStateStore("ACT_10_ECOLOGICAL_CONTEXT", false);
    const scroll = new CinematicScrollController(store);
    const audio = new ContinuousAudioTimeline();

    const { container, unmount } = render(
      <CinematicStage
        activeAct="ECOLOGICAL CONTEXT"
        scrollProgress={act10Progress}
        stateStore={store}
        scrollController={scroll}
        audioTimeline={audio}
      />,
    );

    const globeHost = screen.getByTestId("act10-photo-card-globe");
    expect(globeHost).toBeInTheDocument();
    expect(globeHost.querySelector("canvas")).toBeInTheDocument();
    expect(globeHost.style.pointerEvents).toBe("auto");

    const bg = container.querySelector('[data-testid="shared-scene-background"]');
    expect(bg?.textContent?.trim()).toBe("");
    expect(bg?.contains(globeHost)).toBe(false);

    unmount();
    audio.dispose();
  });

  it("overlaps ACT 10 -> 11 -> 12 continuously in both forward and reverse directions", () => {
    const boundary10to11 = 0.9;
    const boundary11to12 = 0.95;

    const frameAt10to11 = evaluateCinematicTransitions(boundary10to11, 0.02, false);
    expect(frameAt10to11.weights.globeOpacity).toBeGreaterThan(0.7);
    expect(frameAt10to11.weights.ecologicalFieldOpacity).toBeGreaterThan(0.5);
    expect(frameAt10to11.camera.globePullback).toBeGreaterThan(0.5);

    const act10Overlay = getActOverlayOpacity("ACT_10_ECOLOGICAL_CONTEXT", boundary10to11, 0.022);
    const act11OverlayAtStart = getActOverlayOpacity("ACT_11_EXPECTED_SPECIES", boundary10to11, 0.024);
    expect(act10Overlay + act11OverlayAtStart).toBeCloseTo(1, 3);

    const act11OverlayAtEnd = getActOverlayOpacity("ACT_11_EXPECTED_SPECIES", boundary11to12, 0.024);
    const act12OverlayAtStart = getActOverlayOpacity("ACT_12_OBSERVATION_GAP", boundary11to12, 0.024);
    expect(act11OverlayAtEnd + act12OverlayAtStart).toBeCloseTo(1, 3);

    const mid12Forward = evaluateCinematicTransitions(0.975, 0.01, false);
    const mid12Reverse = evaluateCinematicTransitions(0.975, -0.01, false);
    expect(mid12Forward.weights.ecologicalFieldOpacity).toBe(1);
    expect(mid12Reverse.weights.ecologicalFieldOpacity).toBe(1);
  });
});
