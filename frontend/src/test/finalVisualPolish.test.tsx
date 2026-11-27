import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { acousticStore } from "../domain/acousticStore";
import { EditorialHeading } from "../ui/EditorialHeading";

describe("Final Visual Polish Pass — Top Auto-Hide, Spotlight, PixelSwarm & Hover Headings", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    acousticStore.reset();
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.useRealTimers();
    window.history.replaceState({}, "", "/");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  });

  it("auto-hides top chrome on scroll and restores after inactivity or top-edge pointer", () => {
    render(<App />);
    const chrome = screen.getByTestId("ecosonic-top-chrome");
    expect(chrome).toHaveAttribute("data-visible", "true");

    Object.defineProperty(window, "scrollY", { configurable: true, value: 420 });
    fireEvent.scroll(window);
    expect(chrome).toHaveAttribute("data-visible", "false");

    // Inactivity restores chrome cleanly
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(chrome).toHaveAttribute("data-visible", "true");

    // Scroll again then move pointer toward top edge
    Object.defineProperty(window, "scrollY", { configurable: true, value: 860 });
    fireEvent.scroll(window);
    expect(chrome).toHaveAttribute("data-visible", "false");

    fireEvent(window, new MouseEvent("pointermove", { clientY: 24 }));
    expect(chrome).toHaveAttribute("data-visible", "true");
  });

  it("renders centered ECOsonic dim spotlight on landing ACT 01", () => {
    render(<App />);
    const spotlight = screen.getByTestId("landing-ecosonic-spotlight");
    expect(spotlight).toBeInTheDocument();
    expect(spotlight).toHaveTextContent("ECOsonic");
    expect(
      screen.getByTestId("heading-hover-note-ACT_01_LANDING_BRAND"),
    ).toHaveTextContent("Environmental Acoustic Intelligence");
  });

  it("reveals editorial heading hover/tap annotations without layout shift", () => {
    render(
      <EditorialHeading
        text="Expected Species"
        hoverNote="Regional seasonal avian baseline."
        revealKey="TEST_HEADING"
        align="center"
      />,
    );

    const heading = screen.getByRole("heading", { name: "Expected Species" });
    const note = screen.getByTestId("heading-hover-note-TEST_HEADING");
    expect(note).toHaveAttribute("aria-hidden", "true");

    fireEvent.mouseEnter(heading.parentElement!);
    expect(note).toHaveAttribute("aria-hidden", "false");

    fireEvent.mouseLeave(heading.parentElement!);
    expect(note).toHaveAttribute("aria-hidden", "true");

    // Touch/tap fallback
    fireEvent.click(heading);
    expect(note).toHaveAttribute("aria-hidden", "false");
  });
});
