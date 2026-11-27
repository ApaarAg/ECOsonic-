import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { acousticStore } from "../domain/acousticStore";
import {
  getActOverlayOpacity,
  getScrollProgressForAct,
  TIMELINE_SEGMENTS,
} from "../cinematic/CinematicTimeline";
import { ExpectedSpeciesScene } from "../visual/ExpectedSpecies/ExpectedSpeciesScene";
import {
  buildSpecimenArchive,
  computeArchiveSlotTransforms,
  isBiologicalTaxon,
} from "../visual/ExpectedSpecies/expectedSpeciesState";
import { buildSpecimenPlateGeometry } from "../visual/ExpectedSpecies/specimenPlateGeometry";
import { buildExpectedBaselineFromGap, buildExplicitDemoBaseline } from "../api/ecosonicEcologyApi";

describe("Scene 11 (ACT 11 · EXPECTED SPECIES) integration & states", () => {
  beforeEach(() => {
    acousticStore.reset();
  });

  it("allocates a non-zero timeline interval immediately following ACT 10 with smooth crossfade", () => {
    const act10 = TIMELINE_SEGMENTS.find((s) => s.act === "ACT_10_ECOLOGICAL_CONTEXT");
    const act11 = TIMELINE_SEGMENTS.find((s) => s.act === "ACT_11_EXPECTED_SPECIES");
    expect(act10).toBeDefined();
    expect(act11).toBeDefined();
    expect(act11!.end).toBeGreaterThan(act11!.start);
    expect(act11!.start).toBeCloseTo(act10!.end, 6);
    expect(getActOverlayOpacity("ACT_11_EXPECTED_SPECIES", getScrollProgressForAct("ACT_11_EXPECTED_SPECIES", 0.5))).toBe(1);
  });

  it("excludes non-biological sound classes while keeping valid wildlife taxa", () => {
    expect(isBiologicalTaxon("Unknown", "Engine")).toBe(false);
    expect(isBiologicalTaxon("Homo sapiens", "Human")).toBe(false);
    expect(isBiologicalTaxon("Troglodytes pacificus", "Pacific Wren")).toBe(true);
    expect(isBiologicalTaxon("Cyphorhinus arada", "Musician Wren")).toBe(true);
  });

  it("renders explicit loading, error, empty, and populated 3D archive states", () => {
    // 1. Loading state
    acousticStore.setEcologicalStatus("loading");
    const { rerender } = render(<ExpectedSpeciesScene reducedMotion={true} />);
    expect(screen.getByText(/ASSEMBLING ECOLOGICAL BASELINE/i)).toBeInTheDocument();

    // 2. Explicit unavailable/error state (zero fake species)
    acousticStore.setEcologicalStatus("unavailable", "503 ECOLOGICAL_DATA_UNAVAILABLE");
    rerender(<ExpectedSpeciesScene reducedMotion={true} />);
    expect(screen.getByText(/ECOLOGICAL BASELINE UNAVAILABLE/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open field note/i })).not.toBeInTheDocument();

    // 3. Explicit empty / location_unspecified state
    acousticStore.setExpectedBaseline({
      source: "observation_gap",
      isDemo: false,
      sessionId: "ses-empty",
      context: {
        locationName: "No Geocoded Observation Site",
        ecosystemCategory: "unspecified",
        observationAdequacy: "location_unspecified",
        adequacyExplanation: "No coordinates supplied.",
      },
      expectedSpecies: [],
      disclaimer: "Expected species reflects the available ecological context and does not imply presence or absence at the observation site.",
      emptyReason: "No monitoring site coordinates are stored.",
    });
    acousticStore.setEcologicalStatus("ready");
    rerender(<ExpectedSpeciesScene reducedMotion={true} />);
    expect(screen.getByText(/NO EXPECTED SPECIES AVAILABLE/i)).toBeInTheDocument();

    // 4. Populated real backend-shaped baseline
    const demoGapBaseline = buildExplicitDemoBaseline();
    acousticStore.setExpectedBaseline({ ...demoGapBaseline, isDemo: false, source: "observation_gap" });
    rerender(<ExpectedSpeciesScene reducedMotion={true} />);

    const openBtn = screen.getByRole("button", { name: /Open field note for Pacific Wren/i });
    expect(openBtn).toBeInTheDocument();

    // Clicking selected plate opens physical Field Note sheet
    fireEvent.click(openBtn);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Epistemological Boundary/i)).toBeInTheDocument();
  });

  it("maps backend EcologicalGapSnapshot expected_and_detected and expected_but_not_detected cleanly", () => {
    const baseline = buildExpectedBaselineFromGap({
      session_id: "ses-10",
      isDemo: false,
      context: {
        session_id: "ses-10",
        latitude: 47.86,
        longitude: -123.93,
        generalized_coordinates: { latitude: 47.86, longitude: -123.93 },
        location_name: "Hoh Basin",
        ecosystem_category: "temperate-rainforest",
        elevation_m: 140,
        timestamp: "2026-05-15T12:00:00Z",
        observation_date: "2026-05-15",
        meteorological_week: 19,
        observation_duration_sec: 480,
        total_audio_windows: 160,
        acoustic_complexity_index: 12,
        normalized_difference_soundscape_index: 0.7,
      },
      coverage: {
        metric_name: "Acoustic Observation Coverage",
        expected_species_count: 2,
        detected_expected_count: 1,
        detected_unexpected_count: 0,
        gap_count: 1,
        coverage_ratio: 0.5,
        coverage_percentage: 50,
        observation_adequacy: "adequate",
        adequacy_explanation: "Sample adequate",
        disclaimer: "Non-detection does not prove absence.",
      },
      expected_and_detected: [
        {
          species_id: "BN04821",
          scientific_name: "Troglodytes pacificus",
          common_name: "Pacific Wren",
          birdnet_taxonomy_id: "BN04821",
          ebird_code: "pacwre1",
          max_confidence: 0.91,
          mean_confidence: 0.87,
          detection_count: 4,
          first_seen_seconds: 0,
          last_seen_seconds: 12,
          is_persistent: true,
          is_expected: true,
          occurrence_score: 0.88,
          occurrence_status: "frequent",
        },
      ],
      expected_but_not_detected: [
        {
          species_id: "BN05104",
          scientific_name: "Ixoreus naevius",
          common_name: "Varied Thrush",
          occurrence_score: 0.82,
          occurrence_status: "frequent",
          birdnet_taxonomy_id: "BN05104",
          ebird_code: "varthr",
          not_detected: true,
          evidence_status: "insufficient_evidence_for_absence",
          possible_factors: ["Vocal inactivity"],
        },
      ],
      detected_unexpected: [],
      interpretation: null,
      scientific_disclaimer: "Acoustic non-detection does NOT establish biological absence.",
    });

    const specimens = buildSpecimenArchive(baseline);
    expect(specimens).toHaveLength(2);
    expect(specimens[0].speciesId).toBe("BN04821");
    expect(specimens[1].speciesId).toBe("BN05104");

    const slots = computeArchiveSlotTransforms(specimens, 0, 1440, false);
    expect(slots[0].isSelected).toBe(true);
    expect(slots[0].zPx).toBeGreaterThan(slots[1].zPx);
  });

  it("renders unified asymmetric SVG specimen plate silhouettes for active, neighbor, and image aperture", () => {
    const activeGeom = buildSpecimenPlateGeometry("active", 296, 396, false);
    const leftGeom = buildSpecimenPlateGeometry("left", 58, 362, false);
    const rightGeom = buildSpecimenPlateGeometry("right", 58, 362, false);
    const apertureGeom = buildSpecimenPlateGeometry("active", 272, 304, true);

    expect(activeGeom.corners.tl.cutX).toBeGreaterThan(0);
    expect(activeGeom.corners.br.cutX).toBeGreaterThan(0);
    expect(activeGeom.corners.tr.cutX).toBe(0);
    expect(leftGeom.corners.tl.cutX).toBeGreaterThan(0);
    expect(leftGeom.corners.tr.cutX).toBe(0);
    expect(rightGeom.corners.tr.cutX).toBeGreaterThan(0);
    expect(rightGeom.corners.tl.cutX).toBe(0);
    expect(apertureGeom.corners.tl.cutX).toBeGreaterThan(0);
    expect(activeGeom.strokePath).toContain("Q ");
    expect(activeGeom.normalizedClipPath).toContain("Z");

    const demoGapBaseline = buildExplicitDemoBaseline();
    acousticStore.setExpectedBaseline({ ...demoGapBaseline, isDemo: false, source: "observation_gap" });
    acousticStore.setEcologicalStatus("ready");
    const { container } = render(<ExpectedSpeciesScene reducedMotion={true} />);

    const plateTargets = container.querySelectorAll("[data-plate-tilt-target], [data-plate-variant] > div");
    expect(plateTargets.length).toBeGreaterThan(1);

    const activeBtn = container.querySelector('[data-selected="true"]');
    expect(activeBtn?.getAttribute("data-plate-variant")).toBe("active");
    expect(activeBtn?.querySelector('[data-testid="specimen-plate-border"] path')).toBeInTheDocument();

    const aperture = activeBtn?.querySelector('[data-testid="specimen-image-aperture"]') as HTMLElement | null;
    expect(aperture).toBeInTheDocument();
    expect(aperture?.style.clipPath).toMatch(/^url\(#eco-aperture-clip-/);

    const rightNeighbor = container.querySelector('[data-plate-variant="right"]');
    expect(rightNeighbor).toBeInTheDocument();
    expect(rightNeighbor?.querySelector('[data-testid="specimen-plate-border"] path')).toBeInTheDocument();
  });
});
