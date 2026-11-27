import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CinematicStage } from "../visual/Cinematic/CinematicStage";
import { CinematicStateStore } from "../cinematic/CinematicState";
import { CinematicScrollController } from "../cinematic/CinematicScrollController";
import { ContinuousAudioTimeline } from "../cinematic/CinematicAudioTimeline";
import { ExpectedSpeciesScene } from "../visual/ExpectedSpecies/ExpectedSpeciesScene";
import {
  buildEcologicalManifoldGeometry,
  createEcologicalFieldLayer,
} from "../visual/EcologicalField/ecologicalFieldEngine";
import { getEcologicalFieldBudget } from "../visual/engine/viewportBudget";
import { Object3D } from "three";

describe("ACT 11 -> ACT 12 Shared Background Visual Layer", () => {
  it("renders one persistent background container at fixed inset-0 z-0 with zero text", () => {
    const store = new CinematicStateStore("ACT_11_EXPECTED_SPECIES", true);
    const scroll = new CinematicScrollController(store);
    const audio = new ContinuousAudioTimeline();

    const { container, unmount } = render(
      <CinematicStage
        activeAct="EXPECTED SPECIES"
        scrollProgress={0.96}
        stateStore={store}
        scrollController={scroll}
        audioTimeline={audio}
      />
    );

    const bg = container.querySelector('[data-testid="shared-scene-background"]');
    expect(bg).toBeInTheDocument();

    // Check fixed viewport styling requirements
    expect(bg).toHaveClass("fixed");
    expect(bg).toHaveClass("inset-0");
    expect(bg).toHaveClass("z-0");
    expect(bg).toHaveClass("pointer-events-none");

    const style = (bg as HTMLElement).style;
    expect(style.position).toBe("fixed");
    expect(style.top).toBe("0px");
    expect(style.left).toBe("0px");
    expect(style.width).toBe("100%");
    expect(style.height).toBe("100vh");
    expect(style.zIndex).toBe("0");
    expect(style.pointerEvents).toBe("none");

    // Strict requirement: ZERO TEXT in the background layer
    expect(bg?.textContent?.trim()).toBe("");

    // Verify no words or text leaked into the visual container
    expect(bg?.textContent).not.toContain("AI");
    expect(bg?.textContent).not.toContain("AUTOMATION");
    expect(bg?.textContent).not.toContain("BUILD");
    expect(bg?.textContent).not.toContain("EXPECTED");

    unmount();
    audio.dispose();
  });

  it("ensures Scene 11 foreground container is transparent so background remains visible", () => {
    const { container } = render(
      <ExpectedSpeciesScene reducedMotion={true} />
    );

    const s11Root = container.querySelector("#expected-species");
    expect(s11Root).toBeInTheDocument();

    // Must be transparent - NOT opaque bg-[#000] or bg-[#000000]/96
    expect(s11Root).toHaveClass("bg-transparent");
    expect(s11Root?.className).not.toContain("bg-[#000000]/96");
    expect(s11Root?.className).not.toContain("bg-black");
  });

  it("persists the same shared background continuously when transitioning to ACT 12 (OBSERVATION GAP)", () => {
    const store = new CinematicStateStore("ACT_11_EXPECTED_SPECIES", true);
    const scroll = new CinematicScrollController(store);
    const audio = new ContinuousAudioTimeline();

    const { container, rerender, unmount } = render(
      <CinematicStage
        activeAct="EXPECTED SPECIES"
        scrollProgress={0.96}
        stateStore={store}
        scrollController={scroll}
        audioTimeline={audio}
      />
    );

    const bgAct11 = container.querySelector('[data-testid="shared-scene-background"]');
    expect(bgAct11).toBeInTheDocument();

    // Transition smoothly into ACT 12 without unmounting or resetting the background
    rerender(
      <CinematicStage
        activeAct="OBSERVATION GAP"
        scrollProgress={1.0}
        stateStore={store}
        scrollController={scroll}
        audioTimeline={audio}
      />
    );

    const bgAct12 = container.querySelector('[data-testid="shared-scene-background"]');
    expect(bgAct12).toBeInTheDocument();
    expect(bgAct12).toBe(bgAct11); // Same persistent DOM node

    // Background still strictly contains zero text in Scene 12
    expect(bgAct12?.textContent?.trim()).toBe("");

    unmount();
    audio.dispose();
  });

  it("constructs organic field geometry with nodes, connected filaments, and resonant beacons", () => {
    const budget = getEcologicalFieldBudget(1440);
    expect(budget.tier).toBe("desktop");
    expect(budget.nodeCount).toBeGreaterThanOrEqual(1000);
    expect(budget.maxFilaments).toBeGreaterThanOrEqual(500);

    const geom = buildEcologicalManifoldGeometry(budget.nodeCount, budget.maxFilaments);
    expect(geom.nodeGeo.getAttribute("position").count).toBe(budget.nodeCount);
    expect(geom.nodeGeo.getAttribute("aTier")).toBeDefined();
    expect(geom.nodeGeo.getAttribute("aPhase")).toBeDefined();
    expect(geom.nodeGeo.getAttribute("aSize")).toBeDefined();

    // Connected lattice filaments
    expect(geom.filamentGeo.getAttribute("position").count).toBeGreaterThan(0);
    expect(geom.filamentGeo.getAttribute("aAlpha")).toBeDefined();

    // Resonant beacon hubs
    expect(geom.beaconGeo.getAttribute("position").count).toBeGreaterThan(0);

    geom.nodeGeo.dispose();
    geom.filamentGeo.dispose();
    geom.beaconGeo.dispose();
  });

  it("adapts budget on mobile viewports (< 768px) to reduce rendering complexity", () => {
    const mobileBudget = getEcologicalFieldBudget(390);
    expect(mobileBudget.tier).toBe("mobile");
    expect(mobileBudget.nodeCount).toBeLessThan(500);
    expect(mobileBudget.maxFilaments).toBeLessThan(200);
    expect(mobileBudget.maxDpr).toBeLessThanOrEqual(1.5);

    const geom = buildEcologicalManifoldGeometry(mobileBudget.nodeCount, mobileBudget.maxFilaments);
    expect(geom.nodeGeo.getAttribute("position").count).toBe(mobileBudget.nodeCount);
    expect(geom.filamentGeo.getAttribute("position").count).toBeLessThanOrEqual(mobileBudget.maxFilaments * 2);

    geom.nodeGeo.dispose();
    geom.filamentGeo.dispose();
    geom.beaconGeo.dispose();
  });

  it("supports reduced motion by freezing continuous harmonic motion without tearing", () => {
    // Mock minimal WebGLStage duck-type
    const mockStage = {
      renderer: {
        getPixelRatio: () => 1,
      },
      scene: new Object3D(),
    } as any;

    const budget = getEcologicalFieldBudget(1024);
    const layer = createEcologicalFieldLayer(mockStage, budget, true);

    expect(layer.group).toBeDefined();
    expect(layer.group.name).toBe("EcologicalIntelligenceFieldLayer");

    // Update with reducedMotion = true
    layer.update(0.016, 1.0, true);
    expect(layer.group.visible).toBe(true);

    // Update with opacity = 0
    layer.update(0.016, 0.0, true);
    expect(layer.group.visible).toBe(false);

    layer.dispose();
  });
});
