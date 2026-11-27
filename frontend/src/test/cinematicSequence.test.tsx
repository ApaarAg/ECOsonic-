import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { fetchObservationGapFromBackend } from "../api/ecosonicEcologyApi";
import { ContinuousAudioTimeline } from "../cinematic/CinematicAudioTimeline";
import { CinematicScrollController } from "../cinematic/CinematicScrollController";
import { CinematicStateStore } from "../cinematic/CinematicState";
import { getScrollProgressForAct } from "../cinematic/CinematicTimeline";
import { acousticStore } from "../domain/acousticStore";
import {
  createAcousticFieldRuntimeState,
  stepAcousticFieldState,
} from "../visual/AcousticField/acousticFieldState";
import {
  createCinematicDirectorState,
  jumpDirectorToAct,
  resolveForestWaterPhase,
  stepCinematicDirector,
} from "../visual/Cinematic/cinematicSequence";
import { CinematicStage } from "../visual/Cinematic/CinematicStage";
import {
  createLeafRuntimeState,
  evaluateLeafCinematics,
} from "../visual/Leaf/leafState";
import {
  createWaterRuntimeState,
  stepWaterState,
} from "../visual/Water/waterState";

describe("ECOsonic Cinematic Sequence (ACT 01 -> ACT 10)", () => {
  beforeEach(() => {
    acousticStore.reset();
  });

  it("progresses explicitly across ACT_01_BLACKNESS -> ACT_12_OBSERVATION_GAP", () => {
    const dir = createCinematicDirectorState("ACT_01_BLACKNESS", true, false);
    const seen = [dir.currentAct];

    for (let i = 0; i < 5000; i++) {
      const next = stepCinematicDirector(dir, 1 / 60, false);
      if (next) seen.push(next);
      if (dir.currentAct === "ACT_12_OBSERVATION_GAP") break;
    }

    expect(seen).toEqual([
      "ACT_01_BLACKNESS",
      "ACT_02_FOREST",
      "ACT_03_LEAF",
      "ACT_04_WATER",
      "ACT_05_SOUND",
      "ACT_06_ACOUSTIC_FIELD",
      "ACT_07_SPECIES",
      "ACT_08_DISTURBANCE",
      "ACT_09_SILENCE",
      "ACT_10_ECOLOGICAL_CONTEXT",
      "ACT_11_EXPECTED_SPECIES",
      "ACT_12_OBSERVATION_GAP",
    ]);

    // Verify Act 10 globe settle state cleanly before transitioning into Act 11
    const act10Dir = createCinematicDirectorState("ACT_10_ECOLOGICAL_CONTEXT", false, true);
    expect(act10Dir.weights.globeOpacity).toBeGreaterThan(0.8);
    expect(act10Dir.weights.silenceOverride).toBeGreaterThan(0.8);
    // Check ACT 01 pre-forest acoustic traces & ACT 09 progressive silence thinning
    const act1Dir = createCinematicDirectorState("ACT_01_BLACKNESS", true, false);
    for (let i = 0; i < 45; i++) {
      stepCinematicDirector(act1Dir, 1 / 60, false);
    }
    expect(act1Dir.weights.fieldOpacity).toBeGreaterThan(0.05);

    const act9Dir = createCinematicDirectorState("ACT_09_SILENCE", true, false);
    for (let i = 0; i < 300; i++) {
      stepCinematicDirector(act9Dir, 1 / 60, false);
    }
    expect(act9Dir.weights.silenceOverride).toBeGreaterThan(0.8);
    expect(act9Dir.weights.fieldOpacity).toBeLessThan(0.45);
  });

  it("models 5-phase aerodynamic leaf detachment -> drop -> float -> approach -> water_approach -> moored", () => {
    const leaf = createLeafRuntimeState(false);
    evaluateLeafCinematics(leaf, 0.05, 0, 0.5, false);
    expect(leaf.phase).toBe("detachment");
    expect(leaf.camouflageMix).toBeGreaterThan(0.5);

    evaluateLeafCinematics(leaf, 0.22, 0, 1.4, false);
    expect(leaf.phase).toBe("drop");
    expect(leaf.velocity.vy).toBeLessThan(0);

    evaluateLeafCinematics(leaf, 0.38, 0, 2.4, false);
    expect(leaf.phase).toBe("float");
    const driftEarly = leaf.lateralDrift;
    expect(Math.abs(driftEarly)).toBeGreaterThan(0.01);
    expect(leaf.airResistance).toBeGreaterThan(0.35);

    evaluateLeafCinematics(leaf, 0.56, 0, 3.6, false);
    expect(leaf.phase).toBe("float");
    expect(Math.abs(leaf.lateralDrift)).toBeGreaterThan(0.01);

    evaluateLeafCinematics(leaf, 0.72, 0, 4.6, false);
    expect(leaf.phase).toBe("approach");
    expect(leaf.z).toBeGreaterThan(1.0);
    expect(Math.abs(leaf.angularVelocity.angVelY)).toBeLessThan(1.9);

    evaluateLeafCinematics(leaf, 0.94, 0, 6.0, false);
    expect(leaf.phase).toBe("water_approach");

    evaluateLeafCinematics(leaf, 1.0, 0.62, 7.4, false);
    expect(leaf.phase).toBe("moored");
    expect(leaf.y).toBeLessThan(-0.4);
  });

  it("triggers physical water displacement on leaf contact and damps toward ACT 05 wave bridge", () => {
    const water = createWaterRuntimeState();
    stepWaterState(water, 0.1, 0, 0.016, false);
    expect(water.contactImpulse).toBe(0);

    stepWaterState(water, 0.4, 0, 0.016, false);
    expect(water.rippleAge).toBeGreaterThan(0);
    expect(water.contactImpulse).toBeGreaterThan(0.3);

    stepWaterState(water, 1.0, 0.75, 0.016, false);
    expect(water.harmonicBridge).toBe(0.75);
  });

  it("tracks explicit ForestWaterPhase transitions from FOREST_IDLE to WATER_SETTLING", () => {
    expect(resolveForestWaterPhase("ACT_02_FOREST", 0.25)).toBe("FOREST_IDLE");
    expect(resolveForestWaterPhase("ACT_02_FOREST", 0.75)).toBe("LEAF_ATTACHED");
    expect(resolveForestWaterPhase("ACT_03_LEAF", 0.10)).toBe("LEAF_DETACHING");
    expect(resolveForestWaterPhase("ACT_03_LEAF", 0.52)).toBe("LEAF_FALLING");
    expect(resolveForestWaterPhase("ACT_03_LEAF", 0.90)).toBe("WATER_APPROACH");
    expect(resolveForestWaterPhase("ACT_04_WATER", 0.08)).toBe("WATER_APPROACH");
    expect(resolveForestWaterPhase("ACT_04_WATER", 0.18)).toBe("WATER_CONTACT");
    expect(resolveForestWaterPhase("ACT_04_WATER", 0.45)).toBe("RIPPLE");
    expect(resolveForestWaterPhase("ACT_04_WATER", 0.85)).toBe("WATER_SETTLING");
  });

  it("reuses AcousticField silenceFactor during ACT 09 silence override", () => {
    const field = createAcousticFieldRuntimeState();
    field.energy = 0.3;
    field.silenceFactor = 0.1;
    const audio = acousticStore.liveAudio;
    for (let i = 0; i < 120; i++) {
      stepAcousticFieldState(field, audio, [], [], 1 / 60, false, 1.0);
    }
    expect(field.silenceFactor).toBeGreaterThan(0.9);
    expect(field.energy).toBeLessThan(0.08);
  });

  it("sets ecologicalStatus unavailable without fabricating data when backend is disconnected", async () => {
    const result = await fetchObservationGapFromBackend({ apiBaseUrl: "" });
    expect(result).toBeNull();
    expect(acousticStore.getSnapshot().ecologicalStatus).toBe("unavailable");
    expect(acousticStore.getSnapshot().ecologicalContext).toBeNull();
  });

  it("parses authoritative backend ObservationGapResponse cleanly", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        session_id: "sess-1",
        context: {
          session_id: "sess-1",
          latitude: 47.86,
          longitude: -123.93,
          generalized_coordinates: { latitude: 47.86, longitude: -123.93 },
          location_name: "Olympic Rain Forest Station",
          ecosystem_category: "temperate-rainforest",
          elevation_m: 180,
          timestamp: "2026-11-25T00:00:00Z",
          observation_date: "2026-11-25",
          meteorological_week: 44,
          observation_duration_sec: 120,
          total_audio_windows: 40,
          acoustic_complexity_index: 12.4,
          normalized_difference_soundscape_index: 0.68,
        },
        coverage: {
          metric_name: "Acoustic Observation Coverage",
          expected_species_count: 10,
          detected_expected_count: 2,
          detected_unexpected_count: 0,
          gap_count: 8,
          coverage_ratio: 0.2,
          coverage_percentage: 20,
          observation_adequacy: "marginal_duration",
          adequacy_explanation: "Short observation window.",
          disclaimer: "Coverage metric disclaimer.",
        },
        expected_and_detected: [],
        expected_but_not_detected: [
          {
            scientific_name: "Troglodytes pacificus",
            common_name: "Pacific Wren",
            occurrence_score: 0.85,
            occurrence_status: "frequent",
            birdnet_taxonomy_id: null,
            ebird_code: null,
            not_detected: true,
            evidence_status: "insufficient_evidence_for_absence",
            possible_factors: ["Vocal inactivity during recording window"],
          },
        ],
        detected_unexpected: [],
        interpretation: {
          summary: "Marginal 120s sample recorded.",
          observation_gap_explanation: "Brief sampling duration limits vocal detection.",
          detected_highlights: [],
          unobserved_expected_highlights: ["Pacific Wren"],
          limitations: ["Short 120s window"],
          disclaimer: "Grounded summary.",
          provider: "deterministic_rule_engine",
          is_grounded: true,
        },
        scientific_disclaimer: "Acoustic non-detection does NOT establish biological absence.",
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const payload = await fetchObservationGapFromBackend({
      apiBaseUrl: "http://127.0.0.1:8000",
      sessionId: "sess-1",
    });
    expect(payload?.isDemo).toBe(false);
    expect(acousticStore.getSnapshot().ecologicalContext?.expected_but_not_detected[0].not_detected).toBe(true);
    vi.unstubAllGlobals();
  });

  it("respects reduced motion without jarring camera/leaf wobble", () => {
    const dir = createCinematicDirectorState("ACT_03_LEAF", false, true);
    jumpDirectorToAct(dir, "ACT_03_LEAF", false, true);
    const leaf = createLeafRuntimeState(true);
    evaluateLeafCinematics(leaf, dir.weights.leafProgress, 0, 2.0, true);
    expect(leaf.phase).toBe("approach");
    expect(leaf.angularVelocity.angVelY).toBe(0);
    expect(dir.weights.forestEmergence).toBe(1);
  });

  it("navigates across Acts 02-10 and renders the source window interval in ACT 07", () => {
    acousticStore.pushDetection({
      id: "det-utc-1",
      eventType: "detection",
      sessionId: "demo-session",
      classLabel: "Ixoreus naevius_Varied Thrush",
      speciesCommon: "Varied Thrush",
      speciesScientific: "Ixoreus naevius",
      recordType: "animal",
      taxonGroup: "Bird",
      eventSemantics: "window_detection",
      modelScore: 0.91,
      startSeconds: 12.3,
      endSeconds: 15.3,
      receivedAtMs: Date.UTC(2026, 10, 25, 12, 34, 56),
      visualizationPosition: { orbitRad: 0.8, liftRad: 0.3 },
      isDemo: true,
    });
    const store = new CinematicStateStore("ACT_07_SPECIES", true);
    const scroll = new CinematicScrollController(store);
    const audio = new ContinuousAudioTimeline();

    const { rerender, unmount } = render(
      <CinematicStage
        activeAct="SPECIES"
        scrollProgress={getScrollProgressForAct("ACT_07_SPECIES", 0.56)}
        stateStore={store}
        scrollController={scroll}
        audioTimeline={audio}
      />,
    );
    expect(screen.getByRole("region", { name: /Scene 07: Species/i })).toBeInTheDocument();
    expect(screen.getByText(/WINDOW 12\.3–15\.3s/i)).toBeInTheDocument();

    rerender(
      <CinematicStage
        activeAct="DISTURBANCE"
        scrollProgress={getScrollProgressForAct("ACT_08_DISTURBANCE", 0.56)}
        stateStore={store}
        scrollController={scroll}
        audioTimeline={audio}
      />,
    );
    expect(screen.getByRole("region", { name: /Scene 08: Disturbance/i })).toBeInTheDocument();
    expect(screen.getByText(/HUMAN-MADE SOUND DETECTED/i)).toBeInTheDocument();

    rerender(
      <CinematicStage
        activeAct="SILENCE"
        scrollProgress={getScrollProgressForAct("ACT_09_SILENCE", 0.72)}
        stateStore={store}
        scrollController={scroll}
        audioTimeline={audio}
      />,
    );
    expect(screen.getByRole("region", { name: /Scene 09: Silence/i })).toBeInTheDocument();
    expect(screen.getByText(/SILENCE IS ALSO AN OBSERVATION\./i)).toBeInTheDocument();

    rerender(
      <CinematicStage
        activeAct="ECOLOGICAL CONTEXT"
        scrollProgress={getScrollProgressForAct("ACT_10_ECOLOGICAL_CONTEXT", 0.64)}
        stateStore={store}
        scrollController={scroll}
        audioTimeline={audio}
      />,
    );
    expect(screen.getByRole("region", { name: /Scene 10: Ecological Context/i })).toBeInTheDocument();

    rerender(
      <CinematicStage
        activeAct="ACOUSTIC FIELD"
        scrollProgress={getScrollProgressForAct("ACT_06_ACOUSTIC_FIELD", 0.48)}
        stateStore={store}
        scrollController={scroll}
        audioTimeline={audio}
      />,
    );
    expect(screen.getByRole("region", { name: /Scene 06: Acoustic Field/i })).toBeInTheDocument();

    unmount();
    audio.dispose();

    // Ensure App renders without throwing when using URL deep-link
    render(<App />);
    expect(screen.queryByRole("button", { name: /07 SPECIES/i })).not.toBeInTheDocument();
  });
});
