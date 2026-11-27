import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { buildExplicitDemoObservationGap } from "../api/ecosonicEcologyApi";
import { acousticStore } from "../domain/acousticStore";
import { ObservationGapCardStack } from "../visual/ObservationGap/ObservationGapCardStack";
import { ObservationGapScene } from "../visual/ObservationGap/ObservationGapScene";
import { buildObservationGapViewModel } from "../visual/ObservationGap/observationGapState";

describe("Scene 12 — Observation Gap Stacked Bird Cards", () => {
  beforeEach(() => {
    acousticStore.reset();
  });

  it("renders the adapted stacked Carousel and removes the old dual-plate photo holder", () => {
    const demoSnapshot = buildExplicitDemoObservationGap();
    acousticStore.setEcologicalContext(demoSnapshot);

    const { container } = render(<ObservationGapScene reducedMotion={false} />);

    expect(screen.getByTestId("observation-gap-card-stack")).toBeInTheDocument();
    expect(screen.getByTestId("gap-stacked-carousel-stage")).toBeInTheDocument();
    expect(container.querySelector(".car-track")).toBeInTheDocument();
    expect(container.querySelectorAll(".car-slot").length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector('.car-slot[data-front="true"]')).toBeInTheDocument();

    // Old dual-plate holder selectors must no longer exist
    expect(screen.queryByTestId("gap-expected-plate")).not.toBeInTheDocument();
    expect(screen.queryByTestId("gap-observed-plate")).not.toBeInTheDocument();
    expect(screen.queryByTestId("gap-correspondence-connector")).not.toBeInTheDocument();
    expect(screen.queryByTestId("gap-empty-aperture")).not.toBeInTheDocument();

    // Real bird images and species names must be populated
    const images = Array.from(container.querySelectorAll<HTMLImageElement>(".car-card-img"));
    expect(images.length).toBeGreaterThanOrEqual(3);
    for (const img of images) {
      expect(img.getAttribute("src")).toBeTruthy();
      expect(img.getAttribute("src")).not.toContain("unsplash.com");
    }

    // Forbidden extinction/absence wording must never appear
    const fullText = (container.textContent ?? "").toUpperCase();
    expect(fullText).not.toContain("EXTINCT");
    expect(fullText).not.toContain("MISSING FROM HABITAT");
    expect(fullText).not.toContain("SPECIES LOST");
    expect(fullText).not.toMatch(/\bABSENT\b/);
  });

  it("caps visual ring density to a focused subset (max 5 cards) even for 60 backend species", () => {
    const demoSnapshot = buildExplicitDemoObservationGap();
    const gapSample = demoSnapshot.expected_but_not_detected[0];
    const sixtyGapRecords = Array.from({ length: 60 }, (_, idx) => ({
      ...gapSample,
      scientific_name: `${gapSample.scientific_name} ${idx + 1}`,
      common_name: `Species Specimen ${idx + 1}`,
    }));

    const viewModel = buildObservationGapViewModel({
      ...demoSnapshot,
      expected_and_detected: [],
      detected_unexpected: [],
      expected_but_not_detected: sixtyGapRecords,
      coverage: {
        ...demoSnapshot.coverage,
        expected_species_count: 60,
        detected_expected_count: 0,
        gap_count: 60,
        detected_unexpected_count: 0,
        coverage_percentage: 0,
      },
    });
    expect(viewModel).not.toBeNull();
    if (!viewModel) throw new Error("Expected viewModel to be built");

    const { container } = render(
      <ObservationGapCardStack
        entries={viewModel.entries}
        allEntriesCount={viewModel.entries.length}
        counts={viewModel.counts}
        activeFilter="all"
        selectedIndex={0}
        reducedMotion={false}
        onChangeFilter={() => {}}
        onSelectIndex={() => {}}
        onOpenFieldNote={() => {}}
      />
    );

    expect(container.querySelectorAll(".car-slot").length).toBe(5);
    expect(screen.getByTestId("gap-next-batch")).toHaveTextContent("Set 1/12");
  });

  it("renders SeleniteChips correspondence selector, maps DETECTED/NOT DETECTED deterministically, and supports tap/focus reveal + Field Note modal", () => {
    const demoSnapshot = buildExplicitDemoObservationGap();
    acousticStore.setEcologicalContext(demoSnapshot);

    const { container } = render(<ObservationGapScene reducedMotion={false} />);

    // Installed OriginKit SeleniteChips replaces legacy boxed filter buttons
    const chipsWrap = screen.getByTestId("observation-gap-selenite-chips");
    expect(chipsWrap).toBeInTheDocument();
    expect(chipsWrap).toHaveAttribute("data-active-filter", "all");
    expect(screen.queryByTestId("gap-filter-expected_and_detected")).not.toBeInTheDocument();

    const detectedChip = within(chipsWrap).getByRole("button", { name: /^Detected ·/i });
    const gapChip = within(chipsWrap).getByRole("button", { name: /^Gap ·/i });
    const outsideChip = within(chipsWrap).getByRole("button", { name: /^Outside ·/i });

    // Filter to Detected species -> front card must reveal DETECTED on tap/click
    fireEvent.click(detectedChip);
    expect(chipsWrap).toHaveAttribute("data-active-filter", "expected_and_detected");
    const frontSlotDetected = container.querySelector('.car-slot[data-front="true"]')!;
    const frontCardDetected = frontSlotDetected.querySelector(".car-card")!;
    expect(frontCardDetected).toHaveAttribute("data-revealed", "false");

    const detectTrigger = frontCardDetected.querySelector<HTMLButtonElement>("[data-card-trigger]")!;
    fireEvent.click(detectTrigger);
    expect(frontCardDetected).toHaveAttribute("data-revealed", "true");
    expect(within(frontSlotDetected as HTMLElement).getByText("DETECTED")).toBeInTheDocument();

    // Unpick Detected then pick Gap -> front card must reveal NOT DETECTED
    fireEvent.click(detectedChip);
    fireEvent.click(gapChip);
    expect(chipsWrap).toHaveAttribute("data-active-filter", "expected_but_not_detected");
    const frontSlotGap = container.querySelector('.car-slot[data-front="true"]')!;
    const frontCardGap = frontSlotGap.querySelector(".car-card")!;
    const gapTrigger = frontCardGap.querySelector<HTMLButtonElement>("[data-card-trigger]")!;
    fireEvent.click(gapTrigger);
    expect(frontCardGap).toHaveAttribute("data-revealed", "true");
    expect(within(frontSlotGap as HTMLElement).getByText("NOT DETECTED")).toBeInTheDocument();

    // Unpick Gap then pick Outside Baseline -> must still render DETECTED with OUTSIDE BASELINE cue
    fireEvent.click(gapChip);
    fireEvent.click(outsideChip);
    expect(chipsWrap).toHaveAttribute("data-active-filter", "detected_unexpected");
    const frontSlotUnexpected = container.querySelector('.car-slot[data-front="true"]')!;
    expect(within(frontSlotUnexpected as HTMLElement).getByText("DETECTED")).toBeInTheDocument();
    expect(
      within(frontSlotUnexpected as HTMLElement).getByText("OUTSIDE BASELINE")
    ).toBeInTheDocument();

    // Opening Inspect Record inside card opens Field Note modal
    const inspectBtn = frontSlotUnexpected.querySelector<HTMLButtonElement>(
      '[data-card-action="inspect"]'
    )!;
    fireEvent.click(inspectBtn);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("disables floating drift under prefers-reduced-motion", () => {
    const demoSnapshot = buildExplicitDemoObservationGap();
    acousticStore.setEcologicalContext(demoSnapshot);

    const { container } = render(<ObservationGapScene reducedMotion={true} />);

    const track = container.querySelector(".car-track");
    expect(track).toHaveAttribute("data-reduced", "true");
    const firstFloat = container.querySelector<HTMLElement>(".car-float");
    expect(firstFloat?.style.animationName).toBe("none");
  });
});
