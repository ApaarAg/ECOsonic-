import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { acousticStore } from "../domain/acousticStore";

const mockStop = vi.fn(async () => {});
const mockStartMicrophoneCapture = vi.fn(async () => ({
  stop: mockStop,
  inputSampleRate: 48000,
  trackSampleRate: 48000,
  getStats: () => ({
    audioCallbacks: 0,
    resamplingTotalMs: 0,
    packetizationTotalMs: 0,
    callbackMaxMs: 0,
  }),
}));
const mockSocketConnect = vi.fn(async () => {});
const mockSocketDisconnect = vi.fn(async () => {});
const mockSendPcm16Chunk = vi.fn();

vi.mock("../api/ecosonicAudioCapture", () => ({
  startMicrophoneCapture: () => mockStartMicrophoneCapture(),
}));

vi.mock("../api/ecosonicSocket", () => ({
  ecosonicSocket: {
    connect: () => mockSocketConnect(),
    disconnect: () => mockSocketDisconnect(),
    sendPcm16Chunk: (...args: unknown[]) => mockSendPcm16Chunk(...args),
  },
}));

import { App } from "../App";

describe("Microphone toggle switch & top navigation removal", () => {
  beforeEach(() => {
    acousticStore.reset();
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("removes the Acoustic Pipeline status card and replaces old nav with Pixel Swarm Dropdown + single switch", () => {
    const { container } = render(<App />);

    expect(screen.queryByText(/ACOUSTIC PIPELINE/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/OFFLINE · NO LIVE CLASSIFICATION/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Live status begins after the first 8,000-sample PCM frame/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start microphone/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Stop session/i })).not.toBeInTheDocument();

    expect(container.querySelector("[data-cinematic-timeline-nav]")).not.toBeInTheDocument();
    expect(screen.queryByTestId("scribble-loop-nav")).not.toBeInTheDocument();
    expect(screen.getByTestId("pixel-swarm-nav")).toBeInTheDocument();
    expect(screen.getByTestId("ecosonic-brand-wordmark")).toHaveTextContent("ECOsonic");

    // Hover/tap reveal on ECOsonic wordmark shows secondary brand identity
    const wordmark = screen.getByTestId("ecosonic-brand-wordmark");
    expect(wordmark).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(wordmark);
    expect(wordmark).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("ecosonic-brand-identity")).toHaveTextContent(
      /Environmental Acoustic Intelligence/i,
    );

    // Only one microphone switch exists (no duplicate controls)
    expect(screen.getAllByRole("switch")).toHaveLength(1);
  });

  it("starts in OFF state and toggles real microphone session ON and OFF", async () => {
    render(<App />);

    const toggle = screen.getByTestId("microphone-session-toggle");
    expect(toggle).toHaveAttribute("role", "switch");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle.className).toContain("bg-[#27272A]/95");
    expect(toggle.querySelector("span[aria-hidden='true']")?.className).toContain("translate-x-0");

    // Click ON
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(toggle).toHaveAttribute("aria-checked", "true");
    });
    expect(mockSocketConnect).toHaveBeenCalledTimes(1);
    expect(mockStartMicrophoneCapture).toHaveBeenCalledTimes(1);
    expect(toggle.className).toContain("bg-[#2563EB]");
    expect(toggle.querySelector("span[aria-hidden='true']")?.className).toContain(
      "translate-x-[18px]",
    );

    // Click OFF
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(toggle).toHaveAttribute("aria-checked", "false");
    });
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(mockSocketDisconnect).toHaveBeenCalledTimes(1);
    expect(toggle.className).toContain("bg-[#27272A]/95");
  });

  it("stays OFF and surfaces error if microphone capture or permission fails", async () => {
    mockStartMicrophoneCapture.mockRejectedValueOnce(new Error("Permission denied"));
    render(<App />);

    const toggle = screen.getByTestId("microphone-session-toggle");
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Permission denied");
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(mockSocketDisconnect).toHaveBeenCalledTimes(1);
  });
});
