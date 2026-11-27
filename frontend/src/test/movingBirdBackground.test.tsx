import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildExplicitDemoBaseline } from "../api/ecosonicEcologyApi";
import { CinematicScrollController } from "../cinematic/CinematicScrollController";
import { CinematicStateStore } from "../cinematic/CinematicState";
import { ContinuousAudioTimeline } from "../cinematic/CinematicAudioTimeline";
import { Section20Hero } from "../components/originkit/ui/hero-13/section-20-hero";
import { resolveBirdTunnelSlides } from "../visual/ExpectedSpecies/birdTunnelAssets";
import { CinematicStage } from "../visual/Cinematic/CinematicStage";

describe("Scene 11 + 12 Shared Moving-Bird Background Integration", () => {
  it("resolves only local bird photographs with zero human portraits or duplicate slides", () => {
    const baseline = buildExplicitDemoBaseline();
    const slides = resolveBirdTunnelSlides(baseline);

    expect(slides.length).toBeGreaterThanOrEqual(12);
    const urls = slides.map((s) => s.image);
    expect(new Set(urls).size).toBe(urls.length);

    for (const s of slides) {
      expect(s.image).toMatch(/^\/assets\/specimens\/.+\.jpg$/);
      expect(s.image).not.toContain("potrait");
      expect(s.image).not.toContain("originkit");
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(100);
    }
  });

  it("renders restrained Scene 11 & Scene 12 copy without photography template buttons", () => {
    const { rerender } = render(
      <Section20Hero
        overlayOnly
        activeScene="expected-species"
        opacity={1}
        reducedMotion={true}
      />
    );

    const chapter = screen.getByTestId("shared-hero13-chapter");
    expect(chapter).toHaveTextContent("EXPECTED SPECIES");
    expect(chapter).toHaveTextContent(
      "Species expected in this ecological context based on the available acoustic and environmental evidence."
    );
    expect(chapter.textContent).not.toContain("Elevating Portraits");
    expect(chapter.textContent).not.toContain("Explore Gallery");
    expect(chapter.textContent).not.toContain("Book a Shoot");

    rerender(
      <Section20Hero
        overlayOnly
        activeScene="observation-gap"
        opacity={1}
        reducedMotion={true}
      />
    );

    expect(screen.getByTestId("shared-hero13-chapter")).toBe(chapter);
    expect(chapter).toHaveTextContent("OBSERVATION GAP");
    expect(chapter).toHaveTextContent(
      "Compare expected taxa with what was actually detected in the acoustic record."
    );
    expect(chapter.textContent?.toUpperCase()).not.toContain("MISSING SPECIES");
    expect(chapter.textContent?.toUpperCase()).not.toContain("SPECIES LOST");
    expect(chapter.textContent?.toUpperCase()).not.toContain("SPECIES ABSENT");
  });

  it("keeps shared-hero13-chapter mounted cleanly across Scene 11 -> Scene 12 inside CinematicStage", () => {
    const store = new CinematicStateStore("ACT_11_EXPECTED_SPECIES", true);
    const scroll = new CinematicScrollController(store);
    const audio = new ContinuousAudioTimeline();

    const { container, rerender, unmount } = render(
      <CinematicStage
        activeAct="EXPECTED SPECIES"
        scrollProgress={0.925}
        stateStore={store}
        scrollController={scroll}
        audioTimeline={audio}
      />
    );

    const chapter11 = container.querySelector('[data-testid="shared-hero13-chapter"]');
    expect(chapter11).toBeInTheDocument();
    expect(chapter11?.textContent?.replace(/\u00A0/g, " ")).toContain("EXPECTED SPECIES");

    // Ensure shared WebGL backdrop stays free of DOM text and old Act 06-10 atmospheric/grain overlays
    const bg = container.querySelector('[data-testid="shared-scene-background"]');
    expect(bg?.textContent?.trim()).toBe("");
    expect(bg?.querySelector(".ecosonic-atmosphere")).not.toBeInTheDocument();
    expect(bg?.querySelector(".ecosonic-grain")).not.toBeInTheDocument();

    rerender(
      <CinematicStage
        activeAct="OBSERVATION GAP"
        scrollProgress={0.975}
        stateStore={store}
        scrollController={scroll}
        audioTimeline={audio}
      />
    );

    const chapter12 = container.querySelector('[data-testid="shared-hero13-chapter"]');
    expect(chapter12).toBe(chapter11);
    expect(chapter12?.textContent?.replace(/\u00A0/g, " ")).toContain("OBSERVATION GAP");
    expect(bg?.querySelector(".ecosonic-atmosphere")).not.toBeInTheDocument();
    expect(bg?.querySelector(".ecosonic-grain")).not.toBeInTheDocument();

    // Verify Acts 06-10 retain their own atmospheric backdrop untouched
    rerender(
      <CinematicStage
        activeAct="ECOLOGICAL CONTEXT"
        scrollProgress={0.87}
        stateStore={store}
        scrollController={scroll}
        audioTimeline={audio}
      />
    );
    expect(bg?.querySelector(".ecosonic-atmosphere")).toBeInTheDocument();
    expect(bg?.querySelector(".ecosonic-grain")).toBeInTheDocument();

    unmount();
    audio.dispose();
  });
});
