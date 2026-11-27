import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { acousticStore } from "../domain/acousticStore";
import {
  hydrateEcologicalContextForActs,
  loadAnalysisIntoStore,
} from "../api/ecosonicEcologyApi";
import { Act07To10Overlay } from "../visual/Cinematic/CinematicOverlays";
import { ExpectedSpeciesScene } from "../visual/ExpectedSpecies/ExpectedSpeciesScene";
import { ObservationGapScene } from "../visual/ObservationGap/ObservationGapScene";
import { AnalysisControlDrawer } from "../ui/AnalysisControlDrawer";
import {
  resolveSpeciesAsset,
} from "../visual/ExpectedSpecies/speciesAssetRegistry";

describe("Full E2E Frontend-Backend Integration (Acts 10-12, Upload & Imagery)", () => {
  beforeEach(() => {
    acousticStore.reset();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("prioritizes persisted completed geocoded analyses over stale un-geocoded live sessions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url =
        typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();

      if (url.includes("/api/v1/analyses?") && !url.includes("/results")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "ana-completed-001",
                status: "completed",
                filename: "forest_dawn.wav",
                latitude: 48.4,
                longitude: 2.7,
                recorded_at: "2026-05-15T06:30:00Z",
                duration_seconds: 120,
              },
            ],
            total: 1,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("/api/v1/analyses/ana-completed-001/results")) {
        return new Response(
          JSON.stringify({
            analysis_id: "ana-completed-001",
            status: "completed",
            filename: "forest_dawn.wav",
            latitude: 48.4,
            longitude: 2.7,
            recorded_at: "2026-05-15T06:30:00Z",
            duration_seconds: 120,
            metrics: {
              detection_count: 2,
              species_count: 1,
              avg_confidence: 0.91,
              dominant_species: "Common Blackbird",
            },
            detections: [
              {
                id: "det-1",
                species_name: "Common Blackbird",
                scientific_name: "Turdus merula",
                confidence: 0.91,
                start_time: 1.0,
                end_time: 4.0,
                category: "biological",
              },
            ],
            species: [
              {
                common_name: "Common Blackbird",
                scientific_name: "Turdus merula",
                detection_count: 2,
                mean_confidence: 0.91,
                peak_confidence: 0.94,
                total_duration_sec: 6.0,
                status: "active",
                image: {
                  image_status: "available",
                  url: "/assets/specimens/common_blackbird.jpg",
                  source: "ECOsonic Local Curated Commons",
                  license: "CC BY-SA 4.0",
                  attribution: "Test Artist",
                },
              },
            ],
            disturbance: [],
            context: {
              acoustic_load: { index: 0.14, level: "quiet", label: "Quiet" },
              temporal: { period: "dawn", sunrise_relative: "Dawn chorus" },
              weather: { status: "unavailable" },
              habitat: { label: "Temperate Broadleaf Woodland" },
            },
            geospatial_context: {
              reference_status: "available",
              location: {
                latitude: 48.4,
                longitude: 2.7,
                location_name: "Selected Coordinate Site (48.400, 2.700)",
              },
              temporal_context: {
                recorded_at: "2026-05-15T06:30:00Z",
                meteorological_week: 19,
                season: "spring (boreal)",
              },
              ecological_context: {
                biome_band: "Northern Hemisphere Temperate",
                ecosystem_category: "temperate-woodland",
                occurrence_basis: "species_expected_from_reference",
                reference_source: "BirdNET Geo V3.0 (MDF / eBird occurrence prior)",
              },
            },
            expected_species: {
              status: "evaluated",
              expected_species_count: 2,
              expected_species: [
                {
                  scientific_name: "Turdus merula",
                  common_name: "Common Blackbird",
                  occurrence_score: 0.9,
                  occurrence_status: "expected",
                  image: {
                    image_status: "available",
                    url: "/assets/specimens/common_blackbird.jpg",
                    source: "ECOsonic Local Curated Commons",
                    license: "CC BY-SA 4.0",
                    attribution: "Test Artist",
                  },
                },
                {
                  scientific_name: "Erithacus rubecula",
                  common_name: "European Robin",
                  occurrence_score: 0.78,
                  occurrence_status: "expected",
                  image: {
                    image_status: "unavailable",
                    url: null,
                    source: "wikimedia_commons",
                  },
                },
              ],
            },
            observation_gap: {
              status: "evaluated",
              coverage: {
                expected_species_count: 2,
                detected_expected_count: 1,
                detected_unexpected_count: 0,
                gap_count: 1,
                coverage_ratio: 0.5,
                coverage_percentage: 50,
                observation_adequacy: "adequate",
                adequacy_explanation: "50% of baseline species detected.",
                disclaimer: "Non-detection does not establish absence.",
              },
              observed: [
                {
                  scientific_name: "Turdus merula",
                  common_name: "Common Blackbird",
                  occurrence_score: 0.9,
                  detected: true,
                  detection_count: 2,
                  max_confidence: 0.94,
                  category: "expected_and_detected",
                  absence_established: false,
                  image: {
                    image_status: "available",
                    url: "/assets/specimens/common_blackbird.jpg",
                    source: "ECOsonic Local Curated Commons",
                    license: "CC BY-SA 4.0",
                    attribution: "Test Artist",
                  },
                },
              ],
              not_detected: [
                {
                  scientific_name: "Erithacus rubecula",
                  common_name: "European Robin",
                  occurrence_score: 0.78,
                  detected: false,
                  detection_count: 0,
                  category: "expected_but_not_detected",
                  not_detected: true,
                  absent: false,
                  absence_established: false,
                  image: {
                    image_status: "unavailable",
                    url: null,
                    source: "wikimedia_commons",
                  },
                },
              ],
              not_expected: [],
              scientific_disclaimer: "Acoustic non-detection does NOT establish biological absence.",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      // Live sessions only has an empty un-geocoded browser_mic session (regression guard!)
      if (url.includes("/api/v1/live/sessions")) {
        return new Response(
          JSON.stringify([
            {
              id: "stale-empty-mic",
              source_type: "browser_mic",
              latitude: null,
              longitude: null,
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response("{}", { status: 404 });
    });

    const gap = await hydrateEcologicalContextForActs({ apiBaseUrl: "http://127.0.0.1:8000" });
    expect(gap).not.toBeNull();
    expect(fetchMock).toHaveBeenCalled();

    const snap = acousticStore.getSnapshot();
    expect(snap.activeAnalysisId).toBe("ana-completed-001");
    expect(snap.ecologicalStatus).toBe("ready");
    expect(snap.ecologicalContext?.expected_and_detected).toHaveLength(1);
    expect(snap.ecologicalContext?.expected_but_not_detected).toHaveLength(1);
    expect(snap.expectedBaseline?.expectedSpecies).toHaveLength(2);

    // Act 10 renders HoloFlipBadge with geospatial context, removes old Expected vs. Observed block
    render(
      <Act07To10Overlay
        activeAct={{ id: "ACT_10_ECOLOGICAL_CONTEXT", index: 10, label: "Ecological Context" } as any}
        traceAnchor={{} as any}
        reducedMotion={true}
      />,
    );
    expect(screen.getByTestId("act10-holo-flip-badge")).toBeInTheDocument();
    expect(screen.queryByText("Expected vs. Observed")).not.toBeInTheDocument();
    expect(screen.getByText(/Northern Hemisphere Temperate/i)).toBeInTheDocument();
    expect(screen.getByText(/Selected Coordinate Site/i)).toBeInTheDocument();
    expect(screen.getAllByText(/^Expected$/i)[0]).toBeInTheDocument();

    // Act 11 renders expected species including image fallback badge on unindexed plate
    render(<ExpectedSpeciesScene reducedMotion={true} />);
    expect(screen.getByRole("button", { name: /Open field note for Common Blackbird/i })).toBeInTheDocument();

    // Act 12 renders SeleniteChips + observation gap plates
    render(<ObservationGapScene reducedMotion={true} />);
    expect(screen.getByTestId("observation-gap-card-stack")).toBeInTheDocument();
    expect(screen.getByTestId("observation-gap-selenite-chips")).toBeInTheDocument();

    // Stale-data guard: starting a new live session clears A before loading B
    acousticStore.clearEcologicalForNewLiveSession();
    expect(acousticStore.getSnapshot().activeAnalysisId).toBeNull();
    expect(acousticStore.getSnapshot().ecologicalContext).toBeNull();
    expect(acousticStore.getSnapshot().expectedBaseline).toBeNull();
  });

  it("renders honest unavailable/loading/no-coords states without fake species", () => {
    acousticStore.setEcologicalStatus("loading");
    const { rerender } = render(
      <Act07To10Overlay
        activeAct={{ id: "ACT_10_ECOLOGICAL_CONTEXT", index: 10, label: "Ecological Context" } as any}
        traceAnchor={{} as any}
        reducedMotion={true}
      />,
    );
    expect(screen.getAllByText(/ANALYZING ACOUSTIC EVIDENCE/i)[0]).toBeInTheDocument();

    acousticStore.setEcologicalStatus("unavailable", "API offline");
    rerender(
      <Act07To10Overlay
        activeAct={{ id: "ACT_10_ECOLOGICAL_CONTEXT", index: 10, label: "Ecological Context" } as any}
        traceAnchor={{} as any}
        reducedMotion={true}
      />,
    );
    expect(screen.getAllByText(/ANALYSIS DATA COULD NOT BE RETRIEVED/i)[0]).toBeInTheDocument();

    acousticStore.setEcologicalStatus("ready");
    rerender(
      <Act07To10Overlay
        activeAct={{ id: "ACT_10_ECOLOGICAL_CONTEXT", index: 10, label: "Ecological Context" } as any}
        traceAnchor={{} as any}
        reducedMotion={true}
      />,
    );
    expect(screen.getAllByText(/GEOSPATIAL SPECIES REFERENCE UNAVAILABLE/i)[0]).toBeInTheDocument();
  });

  it("maps backend SpeciesImageProvenance honestly for available vs unavailable taxa", () => {
    const available = resolveSpeciesAsset("Customus avis", "Custom Bird", {
      image_status: "available",
      url: "https://upload.wikimedia.org/example.jpg",
      source: "Wikimedia Commons",
      license: "CC BY 4.0",
      attribution: "Ornithologist",
      source_url: "https://commons.wikimedia.org/wiki/File:Example.jpg",
      retrieved_at: "2026-11-27T00:00:00Z",
    });
    expect(available.imageStatus).toBe("available");
    expect(available.plateKind).toBe("species_photograph");
    expect(available.imageUrl).toBe("https://upload.wikimedia.org/example.jpg");
    expect(available.license).toBe("CC BY 4.0");

    const unavailable = resolveSpeciesAsset("Unknownus avis", "Unknown Bird", {
      image_status: "unavailable",
      url: null,
      source: "wikimedia_commons",
      license: null,
      attribution: null,
      source_url: null,
      retrieved_at: "2026-11-27T00:00:00Z",
    });
    expect(unavailable.imageStatus).toBe("unavailable");
    expect(unavailable.plateKind).toBe("habitat_context_fallback");
    expect(unavailable.captionNote).toMatch(/Species image unavailable/i);
  });

  it("validates paired coordinates and loads persisted analysis by ID", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url =
        typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      if (url.includes("/api/v1/analyses?")) {
        return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
      }
      if (url.includes("/api/v1/analyses/reloaded-42/results")) {
        return new Response(
          JSON.stringify({
            analysis_id: "reloaded-42",
            status: "completed",
            filename: "reloaded.wav",
            latitude: 47.86,
            longitude: -123.93,
            recorded_at: "2026-05-15T12:00:00Z",
            duration_seconds: 90,
            metrics: { detection_count: 1, species_count: 1, avg_confidence: 0.88 },
            detections: [],
            species: [],
            disturbance: [],
            context: {
              acoustic_load: { index: 0.1, level: "quiet", label: "Quiet" },
              temporal: { period: "day" },
              weather: { status: "unavailable" },
              habitat: { label: "Temperate Rainforest" },
            },
            expected_species: [],
            observation_gap: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 404 });
    });

    render(<AnalysisControlDrawer open={true} onClose={vi.fn()} />);

    const fileInput = screen.getByTestId("analysis-audio-input") as HTMLInputElement;
    const dummyWav = new File(["RIFF"], "sample.wav", { type: "audio/wav" });
    fireEvent.change(fileInput, { target: { files: [dummyWav] } });

    // Entering latitude without longitude must block submission with paired validation error
    fireEvent.change(screen.getByTestId("analysis-latitude-input"), {
      target: { value: "47.86" },
    });
    fireEvent.submit(screen.getByTestId("analysis-upload-form"));

    expect(
      await screen.findByText(/Both latitude and longitude must be entered together/i),
    ).toBeInTheDocument();

    // Reloading persisted analysis updates activeAnalysisId + URL parameter
    const loaded = await loadAnalysisIntoStore("reloaded-42", {
      apiBaseUrl: "http://127.0.0.1:8000",
      updateUrl: true,
    });
    expect(loaded).not.toBeNull();
    expect(acousticStore.getSnapshot().activeAnalysisId).toBe("reloaded-42");
    expect(window.location.search).toContain("analysis=reloaded-42");

    await waitFor(() => {
      expect(acousticStore.getSnapshot().coordinates.latitude).toBe(47.86);
    });
  });

  it("isolates A -> Start LiveSession B -> Stop B -> Reload B -> Switch back to A without stale data", async () => {
    const makeResultsPayload = (id: string, filename: string, species: string, lat: number, lng: number, expectedCount: number) => ({
      analysis_id: id,
      status: "completed",
      filename,
      latitude: lat,
      longitude: lng,
      recorded_at: "2026-05-15T12:00:00Z",
      duration_seconds: 30,
      metrics: { detection_count: 1, species_count: 1, avg_confidence: 0.91 },
      detections: [
        {
          id: `${id}-det-1`,
          scientific_name: species,
          common_name: species,
          confidence: 0.91,
          start_seconds: 0,
          end_seconds: 3,
          record_type: "animal",
          taxon_group: "Aves",
        },
      ],
      species: [],
      disturbance: [],
      context: {
        acoustic_load: { index: 0.2, level: "quiet", label: "Quiet" },
        temporal: { period: "day" },
        weather: { status: "unavailable" },
        habitat: { label: "Temperate" },
      },
      expected_species: Array.from({ length: expectedCount }, (_, idx) => ({
        scientific_name: `Expected_${id}_${idx}`,
        common_name: `Expected ${id} ${idx}`,
        occurrence_score: 0.5,
        occurrence_status: "expected",
      })),
      observation_gap: {
        session_id: id,
        context: {
          location_name: `Site ${id}`,
          ecosystem_category: "Temperate",
          latitude: lat,
          longitude: lng,
          observation_date: "2026-05-15",
          meteorological_week: 20,
          observation_duration_sec: 30,
        },
        coverage: {
          expected_species_count: expectedCount,
          detected_expected_count: 1,
          detected_unexpected_count: 0,
          gap_count: Math.max(0, expectedCount - 1),
          coverage_ratio: 1 / Math.max(1, expectedCount),
          coverage_percentage: Math.round((100 / Math.max(1, expectedCount)) * 10) / 10,
          observation_adequacy: "adequate",
          adequacy_explanation: `Coverage for ${id}`,
          disclaimer: "Non-detection does not prove absence.",
        },
        expected_and_detected: [],
        expected_but_not_detected: [],
        detected_unexpected: [],
        interpretation: null,
        scientific_disclaimer: "Non-detection does not prove absence.",
      },
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url =
        typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      if (url.includes("/api/v1/analyses/analysis-A/results")) {
        return new Response(
          JSON.stringify(makeResultsPayload("analysis-A", "site_a.wav", "Turdus merula", 47.8, 13.04, 12)),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/api/v1/analyses/analysis-B/results")) {
        return new Response(
          JSON.stringify(makeResultsPayload("analysis-B", "live_b.wav", "Corvus corax", 40.71, -74.0, 6)),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 404 });
    });

    // 1. Load Analysis A
    await loadAnalysisIntoStore("analysis-A", { apiBaseUrl: "http://127.0.0.1:8000", updateUrl: true });
    expect(acousticStore.getSnapshot().activeAnalysisId).toBe("analysis-A");
    expect(acousticStore.getSnapshot().ecologicalContext?.coverage.expected_species_count).toBe(12);
    expect(acousticStore.getSnapshot().detections[0]?.speciesCommon).toBe("Turdus merula");

    // 2. Start LiveSession B (must clear A's stale ecologicalContext & detections immediately)
    acousticStore.clearEcologicalForNewLiveSession();
    expect(acousticStore.getSnapshot().activeAnalysisId).toBeNull();
    expect(acousticStore.getSnapshot().ecologicalContext).toBeNull();
    expect(acousticStore.getSnapshot().detections).toHaveLength(0);

    // 3. Stop B -> finalized to Analysis B -> Reload B
    await loadAnalysisIntoStore("analysis-B", { apiBaseUrl: "http://127.0.0.1:8000", updateUrl: true });
    expect(acousticStore.getSnapshot().activeAnalysisId).toBe("analysis-B");
    expect(acousticStore.getSnapshot().ecologicalContext?.coverage.expected_species_count).toBe(6);
    expect(acousticStore.getSnapshot().detections[0]?.speciesCommon).toBe("Corvus corax");

    // 4. Switch back to Analysis A -> must restore A cleanly without B residue
    await loadAnalysisIntoStore("analysis-A", { apiBaseUrl: "http://127.0.0.1:8000", updateUrl: true });
    expect(acousticStore.getSnapshot().activeAnalysisId).toBe("analysis-A");
    expect(acousticStore.getSnapshot().ecologicalContext?.coverage.expected_species_count).toBe(12);
    expect(acousticStore.getSnapshot().detections[0]?.speciesCommon).toBe("Turdus merula");
  });
});
