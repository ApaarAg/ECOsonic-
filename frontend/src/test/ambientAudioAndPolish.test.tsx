import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { ContinuousAudioTimeline } from "../cinematic/CinematicAudioTimeline";
import { getScrollProgressForAct } from "../cinematic/CinematicTimeline";
import { evaluateCinematicTransitions } from "../cinematic/CinematicTransition";
import { acousticStore } from "../domain/acousticStore";
import * as sharedAudio from "../api/sharedAudioContext";

describe("V1 Final Polish — Scene-Aware Bird Ambience & Transitions", () => {
  beforeEach(() => {
    acousticStore.reset();
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("modulates birdAmbienceGain softly across Forest -> Sound/Field -> Observation Gap", () => {
    const blackness = evaluateCinematicTransitions(
      getScrollProgressForAct("ACT_01_BLACKNESS", 0),
      0,
      false,
    );
    const forest = evaluateCinematicTransitions(
      getScrollProgressForAct("ACT_02_FOREST", 0.6),
      0,
      false,
    );
    const water = evaluateCinematicTransitions(
      getScrollProgressForAct("ACT_04_WATER", 0.5),
      0,
      false,
    );
    const field = evaluateCinematicTransitions(
      getScrollProgressForAct("ACT_06_ACOUSTIC_FIELD", 0.5),
      0,
      false,
    );
    const gapStart = evaluateCinematicTransitions(
      getScrollProgressForAct("ACT_12_OBSERVATION_GAP", 0.1),
      0,
      false,
    );
    const gapEnd = evaluateCinematicTransitions(
      getScrollProgressForAct("ACT_12_OBSERVATION_GAP", 0.98),
      0,
      false,
    );

    expect(blackness.audio.birdAmbienceGain).toBe(0);
    expect(forest.audio.birdAmbienceGain).toBeGreaterThan(0.85);
    expect(water.audio.birdAmbienceGain).toBeGreaterThan(0.7);
    // Sound/Acoustic Field reduces woodland birdsong so acoustic intelligence dominates
    expect(field.audio.birdAmbienceGain).toBeLessThan(0.3);
    expect(field.audio.birdAmbienceGain).toBeGreaterThan(0.15);
    // Final scene settles progressively calmer
    expect(gapStart.audio.birdAmbienceGain).toBeLessThan(field.audio.birdAmbienceGain);
    expect(gapEnd.audio.birdAmbienceGain).toBeLessThan(gapStart.audio.birdAmbienceGain);
    // GalleryTunnel smooth continuity across 10 -> 11 -> 12
    expect(gapStart.weights.ecologicalFieldOpacity).toBe(1);
  });

  it("unlocks lazily on interaction, supports mute/unmute, and cleans up timers/nodes on dispose", async () => {
    const createdNodes: Array<{ disconnect: ReturnType<typeof vi.fn>; stop?: ReturnType<typeof vi.fn> }> = [];
    const makeGain = () => {
      const n = {
        gain: { value: 0, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      createdNodes.push(n);
      return n;
    };
    const mockCtx = {
      state: "running",
      sampleRate: 32000,
      currentTime: 1.0,
      destination: {},
      resume: vi.fn().mockResolvedValue(undefined),
      decodeAudioData: vi.fn().mockResolvedValue({ duration: 14.65 }),
      createBuffer: vi.fn(() => ({ getChannelData: () => new Float32Array(32000 * 3) })),
      createBufferSource: vi.fn(() => {
        const s = {
          buffer: null,
          loop: false,
          playbackRate: { value: 1 },
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
          onended: null as (() => void) | null,
        };
        createdNodes.push(s);
        return s;
      }),
      createBiquadFilter: vi.fn(() => {
        const f = {
          type: "lowpass",
          frequency: { value: 400, setTargetAtTime: vi.fn() },
          Q: { value: 0.7 },
          connect: vi.fn(),
          disconnect: vi.fn(),
        };
        createdNodes.push(f);
        return f;
      }),
      createGain: vi.fn(makeGain),
      createOscillator: vi.fn(() => {
        const o = {
          type: "sine",
          frequency: { value: 110 },
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        };
        createdNodes.push(o);
        return o;
      }),
      createStereoPanner: vi.fn(() => ({ pan: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() })),
    } as unknown as AudioContext;

    vi.spyOn(sharedAudio, "getOrCreateSharedAudioContext").mockReturnValue(mockCtx);
    vi.spyOn(sharedAudio, "getExistingSharedAudioContext").mockReturnValue(mockCtx);
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(16),
    } as Response);

    const timeline = new ContinuousAudioTimeline();
    expect(timeline.getSnapshot().unlocked).toBe(false);
    expect(timeline.getSnapshot().muted).toBe(false);

    expect(timeline.unlock()).toBe(true);
    await waitFor(() => expect(timeline.getSnapshot().birdTrackLoaded).toBe(true));

    timeline.setMuted(true);
    expect(timeline.isMuted()).toBe(true);
    expect(timeline.getSnapshot().muted).toBe(true);

    timeline.setMuted(false);
    expect(timeline.isMuted()).toBe(false);

    timeline.dispose();
    expect(createdNodes.every((n) => n.disconnect.mock.calls.length > 0)).toBe(true);
  });

  it("renders a keyboard-accessible ambient audio mute/unmute toggle in EditorialShell", () => {
    render(<App />);
    const toggle = screen.getByTestId("ambient-audio-toggle");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).toHaveTextContent(/sound/i);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveTextContent(/muted/i);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).toHaveTextContent(/sound/i);
  });
});
