import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acousticStore,
  isLiveAudioSilent,
} from "../domain/acousticStore";
import { STORYBOARD_ACTS, STORYBOARD_REGISTRY } from "../domain/storyboard";

describe("storyboard registry", () => {
  it("contains all 16 fixed acts in order with Acts 01-10 implemented", () => {
    expect(STORYBOARD_ACTS).toHaveLength(16);
    expect(STORYBOARD_ACTS[0]).toBe("BLACKNESS");
    expect(STORYBOARD_ACTS[1]).toBe("FOREST");
    expect(STORYBOARD_ACTS[5]).toBe("ACOUSTIC FIELD");
    expect(STORYBOARD_ACTS[9]).toBe("ECOLOGICAL CONTEXT");
    expect(STORYBOARD_ACTS[15]).toBe("OBSERVATORY");

    const implemented = STORYBOARD_REGISTRY.filter((a) => a.implemented).map(
      (a) => a.act,
    );
    expect(implemented).toEqual([
      "BLACKNESS",
      "FOREST",
      "LEAF",
      "WATER",
      "SOUND",
      "ACOUSTIC FIELD",
      "SPECIES",
      "DISTURBANCE",
      "SILENCE",
      "ECOLOGICAL CONTEXT",
      "EXPECTED SPECIES",
      "OBSERVATION GAP",
    ]);
  });
});

describe("acousticStore", () => {
  beforeEach(() => {
    acousticStore.reset();
  });

  it("updates liveAudio at high frequency without notifying React on every audio frame", () => {
    const listener = vi.fn();
    const unsub = acousticStore.subscribe(listener);

    // Push 10 active microphone frames — only the first quiet->active crossing should notify
    for (let i = 0; i < 10; i++) {
      acousticStore.pushAudioFrame(
        0.25 + i * 0.02,
        0.4,
        [0.1, 0.2, 0.3, 0.1],
        0.45,
        0.1,
        "microphone",
      );
    }

    expect(acousticStore.liveAudio.rms).toBeCloseTo(0.43, 2);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });

  it("marks demo detections and disturbances with isDemo: true", () => {
    acousticStore.triggerDemoDetection();
    acousticStore.triggerDemoDisturbance();

    const snap = acousticStore.getSnapshot();
    expect(snap.detections[0].isDemo).toBe(true);
    expect(snap.disturbances[0].isDemo).toBe(true);
    expect(acousticStore.pendingDetections).toHaveLength(1);
    expect(acousticStore.pendingDisturbances).toHaveLength(1);
  });

  it("uses the backend RMS threshold for digital silence, not ordinary quiet input", () => {
    expect(isLiveAudioSilent(0, "microphone")).toBe(true);
    expect(isLiveAudioSilent(0.005, "microphone")).toBe(false);
    expect(isLiveAudioSilent(0, "demo")).toBe(false);

    const listener = vi.fn();
    const unsub = acousticStore.subscribe(listener);

    acousticStore.setAudioSource("microphone");
    expect(acousticStore.getSnapshot().soundscape.quietness).toBe(0.35);

    // A real microphone frame above the backend zero threshold remains renderable.
    acousticStore.pushAudioFrame(0.005, 0.01, [0, 0, 0, 0], 0.2, 0, "microphone");
    expect(acousticStore.getSnapshot().audio.source).toBe("microphone");
    expect(isLiveAudioSilent(acousticStore.getSnapshot().audio.rms, "microphone")).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsub();
  });

  it("clears demo traces when entering live and blocks demo injection while live", () => {
    acousticStore.triggerDemoDetection();
    acousticStore.triggerDemoDisturbance();
    expect(acousticStore.getSnapshot().detections[0].isDemo).toBe(true);

    acousticStore.setSessionState({ connection: "live", status: "listening" });
    acousticStore.triggerDemoDetection();
    acousticStore.triggerDemoDisturbance();

    expect(acousticStore.getSnapshot().session.connection).toBe("live");
    expect(acousticStore.getSnapshot().detections).toEqual([]);
    expect(acousticStore.getSnapshot().disturbances).toEqual([]);
    expect(acousticStore.pendingDetections).toEqual([]);
    expect(acousticStore.pendingDisturbances).toEqual([]);
  });
});
