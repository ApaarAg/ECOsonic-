import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { acousticStore } from "../domain/acousticStore";
import { AcousticFieldOverlay } from "../visual/AcousticField/AcousticField";

describe("AcousticField scene & shell", () => {
  beforeEach(() => {
    acousticStore.reset();
    window.history.replaceState({}, "", "/?act=acoustic-field");
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("renders editorial typography, telemetry, and removes DEMO and SILENCE labels", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: /Acoustic Field/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/EVERY SOUND LEAVES A TRACE\./i),
    ).toBeInTheDocument();
    expect(screen.getByText(/BACKEND OFFLINE/i)).toBeInTheDocument();
    expect(screen.queryByText(/CURRENT OBSERVATION/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^DEMO$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^SILENCE$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/\bDEMO\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bSILENCE\b/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /Scene 06: Acoustic Field/i }),
    ).toBeInTheDocument();
  });

  it("reflects settled vs listening acoustic states without DEMO or SILENCE labels", () => {
    acousticStore.setAudioSource("silent");
    render(<App />);

    expect(screen.getByText(/STANDBY/i)).toBeInTheDocument();
    expect(
      screen.getByText(/FIELD SETTLED · AWAITING ACOUSTIC ENERGY/i),
    ).toBeInTheDocument();
  });

  it("renders clearly labeled reference detection and disturbance traces", () => {
    render(<AcousticFieldOverlay />);
    act(() => {
      acousticStore.triggerDemoDetection();
      acousticStore.triggerDemoDisturbance();
    });

    expect(screen.getByText(/REFERENCE WINDOW DETECTION/i)).toBeInTheDocument();
    expect(screen.getByText(/REFERENCE DISTURBANCE/i)).toBeInTheDocument();
    expect(screen.queryByText(/\bDEMO\b/i)).not.toBeInTheDocument();
  });

  it("renders a live backend event during low-level microphone input", () => {
    acousticStore.setSessionState({
      id: "session-acceptance-1",
      connection: "live",
      status: "listening",
    });
    acousticStore.pushAudioFrame(0.005, 0.02, [0.1, 0.1, 0.1, 0.1], 0.3, 0.02, "microphone");
    acousticStore.pushDetection({
      id: "backend-event-1",
      eventType: "detection",
      sessionId: "session-acceptance-1",
      classLabel: "Homo sapiens_Human",
      speciesCommon: "Common Blackbird",
      speciesScientific: "Turdus merula",
      recordType: "animal",
      taxonGroup: "Bird",
      eventSemantics: "window_detection",
      modelScore: 0.71,
      startSeconds: 12,
      endSeconds: 15,
      receivedAtMs: 1234,
      visualizationPosition: { orbitRad: 0.5, liftRad: 0.1 },
      isDemo: false,
    });

    render(<AcousticFieldOverlay />);

    expect(screen.getByText(/ANIMAL WINDOW DETECTION/i)).toBeInTheDocument();
    expect(screen.getByText(/Common Blackbird/i)).toBeInTheDocument();
    expect(screen.getByText(/Turdus merula/i)).toBeInTheDocument();
    expect(screen.getByText(/BIRDNET SCORE 0\.71/i)).toBeInTheDocument();
    expect(screen.getByText(/12\.0–15\.0s/i)).toBeInTheDocument();
    expect(screen.queryByText(/SESSION ID session-acceptance-1/i)).not.toBeInTheDocument();
  });
});
