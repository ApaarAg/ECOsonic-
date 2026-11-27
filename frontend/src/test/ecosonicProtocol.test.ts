import { describe, expect, it } from "vitest";
import {
  BandLimitedResampler,
  floatToPcm16,
} from "../api/ecosonicAudioCapture";
import { encodePcm16Frame, mapBackendDetection } from "../api/ecosonicSocket";

describe("ECOsonic 32kHz mono PCM16 protocol helpers", () => {
  it("resamples 48kHz input down to exact 32kHz sample count", () => {
    const resampler = new BandLimitedResampler(48000, 32000, 31);
    const input = new Float32Array(4800);
    for (let i = 0; i < input.length; i++) {
      input[i] = Math.sin((2 * Math.PI * 1000 * i) / 48000) * 0.5;
    }
    const output = resampler.process(input);
    const tail = resampler.flush();
    expect(output.length + tail.length).toBe(3200);
  });

  it("quantizes float32 samples to signed 16-bit PCM and encodes big-endian uint32 sequence header", () => {
    const floats = new Float32Array([0, 1, -1, 0.5]);
    const pcm16 = floatToPcm16(floats);
    expect(pcm16[0]).toBe(0);
    expect(pcm16[1]).toBe(32767);
    expect(pcm16[2]).toBe(-32768);

    const frame = encodePcm16Frame(42, pcm16);
    expect(frame.byteLength).toBe(4 + floats.length * 2);
    const view = new DataView(frame);
    expect(view.getUint32(0, false)).toBe(42);
    expect(view.getInt16(4, true)).toBe(0);
    expect(view.getInt16(6, true)).toBe(32767);
    expect(view.getInt16(8, true)).toBe(-32768);
  });

  it("preserves window timing and sound-class type without inventing acoustic measurements", () => {
    const event = mapBackendDetection(
      {
        type: "detection",
        session_id: "session-1",
        event_id: "event-7",
        start_seconds: 6,
        end_seconds: 9,
        class_label: "Rain",
        common_name: "Rain",
        confidence_score: 0.92,
        record_type: "sound_class",
        event_semantics: "window_detection",
        taxon_group: null,
      },
      173,
    );
    expect(event).toMatchObject({
      eventType: "detection",
      sessionId: "session-1",
      classLabel: "Rain",
      recordType: "sound_class",
      taxonGroup: null,
      eventSemantics: "window_detection",
      startSeconds: 6,
      endSeconds: 9,
      modelScore: 0.92,
      receivedAtMs: 173,
    });
    expect(event).not.toHaveProperty("frequencyHz");
    expect(event).not.toHaveProperty("azimuthRad");
    expect(event).not.toHaveProperty("elevationRad");
    expect(event.visualizationPosition).toBeDefined();
  });
});
