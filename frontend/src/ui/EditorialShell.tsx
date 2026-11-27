import React, { useEffect, useState } from "react";
import PixelSwarmDropdown from "../components/originkit/ui/pixel-swarm-dropdown";
import { type StoryboardAct } from "../domain/storyboard";
import { useAutoHideChrome } from "./useAutoHideChrome";
import { useReducedMotion } from "../visual/engine/useReducedMotion";

interface ChapterOption {
  label: string;
  color: string;
  act: StoryboardAct;
  matches: readonly StoryboardAct[];
}

const PIXEL_CHAPTER_OPTIONS: readonly ChapterOption[] = [
  { label: "01 · ECOsonic", color: "#9EA7A2", act: "BLACKNESS", matches: ["BLACKNESS"] },
  { label: "02 · Living Valley", color: "#5C7A67", act: "FOREST", matches: ["FOREST"] },
  {
    label: "03 · Flora & Water",
    color: "#7B8C8D",
    act: "LEAF",
    matches: ["LEAF", "WATER"],
  },
  { label: "05 · Acoustic Energy", color: "#C89B62", act: "SOUND", matches: ["SOUND"] },
  {
    label: "06 · Acoustic Field",
    color: "#E8E4DC",
    act: "ACOUSTIC FIELD",
    matches: ["ACOUSTIC FIELD"],
  },
  {
    label: "07 · Living Signatures",
    color: "#86A68E",
    act: "SPECIES",
    matches: ["SPECIES", "DISTURBANCE", "SILENCE"],
  },
  {
    label: "10 · Ecological Context",
    color: "#86A68E",
    act: "ECOLOGICAL CONTEXT",
    matches: ["ECOLOGICAL CONTEXT"],
  },
  {
    label: "11 · Expected Species",
    color: "#C89B62",
    act: "EXPECTED SPECIES",
    matches: ["EXPECTED SPECIES"],
  },
  {
    label: "12 · Observation Gap",
    color: "#D3A36C",
    act: "OBSERVATION GAP",
    matches: ["OBSERVATION GAP"],
  },
];

export interface EditorialShellProps {
  activeAct?: StoryboardAct;
  scrollProgress?: number;
  onSelectAct?: (act: StoryboardAct) => void;
  ambienceMuted?: boolean;
  onToggleAmbience?: () => void;
  children: React.ReactNode;
}

export const EditorialShell: React.FC<EditorialShellProps> = ({
  activeAct = "ACOUSTIC FIELD",
  scrollProgress = 0,
  onSelectAct,
  ambienceMuted = false,
  onToggleAmbience,
  children,
}) => {
  const reducedMotion = useReducedMotion();
  const [brandExpanded, setBrandExpanded] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [headerFocused, setHeaderFocused] = useState(false);

  const pinned = brandExpanded || dropdownOpen || headerFocused;
  const chromeVisible = useAutoHideChrome({ pinned, reducedMotion });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("ecosonic:chrome-pin", { detail: { pinned } }),
    );
  }, [pinned]);

  const isMonochromeAct =
    activeAct === "BLACKNESS" ||
    activeAct === "FOREST" ||
    activeAct === "LEAF" ||
    activeAct === "WATER";

  const activeChapterIdx = Math.max(
    0,
    PIXEL_CHAPTER_OPTIONS.findIndex((item) => item.matches.includes(activeAct)),
  );

  const handleSelectChapter = (idx: number) => {
    const target = PIXEL_CHAPTER_OPTIONS[idx];
    if (target) {
      onSelectAct?.(target.act);
    }
  };

  return (
    <div
      className={`relative min-h-dvh w-full ${
        isMonochromeAct ? "bg-[#060708] text-[#E8E4DC]" : "bg-obsidian text-parchment"
      }`}
    >
      {/* Top progress hairline */}
      <div
        role="progressbar"
        aria-label="Cinematic story progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(scrollProgress * 100)}
        className="pointer-events-none fixed inset-x-0 top-0 z-50 h-px bg-white/10"
      >
        <div
          className="h-full bg-[#C89B62]/80 transition-[width] duration-150 ease-out"
          style={{ width: `${Math.max(0, Math.min(1, scrollProgress)) * 100}%` }}
        />
      </div>

      {/* Auto-hiding unified top chrome: wordmark left, Pixel Swarm chapter selector center, ambience + mic switch right */}
      <header
        data-testid="ecosonic-top-chrome"
        data-visible={chromeVisible ? "true" : "false"}
        onFocusCapture={() => setHeaderFocused(true)}
        onBlurCapture={(ev) => {
          if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) {
            setHeaderFocused(false);
          }
        }}
        className={`pointer-events-none fixed inset-x-0 top-0 z-40 border-b border-[#E8E4DC]/10 bg-[#060708]/76 backdrop-blur-md ${
          reducedMotion
            ? "transition-opacity duration-150"
            : "transition-[opacity,transform,filter] duration-300 ease-out"
        } ${
          chromeVisible
            ? "translate-y-0 opacity-100 blur-0"
            : "-translate-y-3 opacity-0 blur-[4px]"
        }`}
      >
        <div
          className={`mx-auto flex flex-col sm:h-14 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6 sm:pr-44 ${
            chromeVisible ? "" : "pointer-events-none"
          }`}
        >
          {/* Top row (left wordmark + reserved right space for fixed ambience button + microphone pill switch) */}
          <div className="flex h-12 shrink-0 items-center justify-between px-4 pr-36 sm:h-auto sm:px-0 sm:pr-0">
          <div
            className="group pointer-events-auto relative shrink-0"
            onMouseEnter={() => setBrandExpanded(true)}
            onMouseLeave={() => setBrandExpanded(false)}
          >
            <button
              type="button"
              data-testid="ecosonic-brand-wordmark"
              aria-expanded={brandExpanded}
              aria-label="ECOsonic — Environmental Acoustic Intelligence"
              onClick={() => setBrandExpanded((prev) => !prev)}
              className={`inline-flex cursor-pointer items-baseline gap-2 rounded-sm py-1 text-left focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-[#C89B62] ${
                chromeVisible ? "pointer-events-auto" : "pointer-events-none"
              }`}
            >
              <span
                className="font-editorial text-[24px] leading-none tracking-[-0.02em] text-[#E8E4DC] sm:text-[28px]"
                style={{ textShadow: "0 2px 16px rgba(6, 7, 8, 0.9)" }}
              >
                ECOsonic
              </span>
            </button>

            <div
              data-testid="ecosonic-brand-identity"
              aria-hidden={!brandExpanded}
              className={`pointer-events-none absolute left-0 top-full mt-1.5 origin-top-left transition-[opacity,transform] duration-150 ease-out ${
                brandExpanded
                  ? "translate-y-0 opacity-100"
                  : "-translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100"
              }`}
            >
              <span className="inline-block whitespace-nowrap border-l border-[#C89B62]/60 bg-[#060708]/88 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-[#E8E4DC]/85 shadow-sm backdrop-blur-sm">
                Environmental Acoustic Intelligence
              </span>
            </div>
            </div>
          </div>

          {/* Center Pixel Swarm Dropdown replacing old scene-label panel */}
          <div
            className={`relative flex w-full justify-center border-t border-[#E8E4DC]/8 py-0.5 sm:w-auto sm:flex-1 sm:border-t-0 sm:py-0 ${
              chromeVisible ? "pointer-events-auto" : "pointer-events-none"
            }`}
          >
            <div className="w-full max-w-[290px] sm:max-w-[320px]">
              <PixelSwarmDropdown
                data-testid="pixel-swarm-nav"
                ariaLabel="ECOsonic chapter selector"
                compactContainer
                interactive={chromeVisible}
                autoplay={false}
                autoplayLoop={{ autoplay: false, speed: 0 }}
                selectedIndex={activeChapterIdx}
                onSelect={handleSelectChapter}
                onOpenChange={setDropdownOpen}
                label="ACT"
                background="transparent"
                size={310}
                cellSize={3}
                openSpeed={54}
                closeSpeed={56}
                options={PIXEL_CHAPTER_OPTIONS.map((item) => ({
                  label: item.label,
                  color: item.color,
                }))}
                font={{
                  fontFamily: "Inter Tight",
                  fontWeight: 500,
                  fontSize: 16,
                  letterSpacing: "0.02em",
                }}
                advanced={{
                  openMs: 420,
                  closeMs: 280,
                  pillHeight: 54,
                  pillRadius: 27,
                  labelInset: 24,
                  menuGap: 10,
                  rowPitch: 44,
                  menuRadius: 16,
                  pillColor: "#0D0F10",
                  pillBorder: "#272A2D",
                  menuColor: "#0C0E0F",
                  menuBorder: "#25292C",
                  hoverColor: "#181C1E",
                  labelColor: "#7C8582",
                  valueColor: "#E8E4DC",
                  rowColor: "#BDB9B0",
                }}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Restrained environmental soundscape mute/unmute toggle beside microphone switch */}
      {onToggleAmbience ? (
        <button
          type="button"
          data-testid="ambient-audio-toggle"
          aria-pressed={!ambienceMuted}
          aria-label={
            ambienceMuted
              ? "Unmute environmental bird audio"
              : "Mute environmental bird audio"
          }
          onClick={onToggleAmbience}
          className={`fixed right-[72px] top-3 z-50 inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-[#E8E4DC]/18 bg-[#060708]/85 px-2.5 text-[9.5px] uppercase tracking-[0.15em] text-[#E8E4DC]/80 backdrop-blur-sm hover:border-[#C89B62]/60 hover:text-[#E8E4DC] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[#C89B62] sm:right-[90px] sm:top-3.5 sm:h-8 ${
            reducedMotion
              ? "transition-opacity duration-150"
              : "transition-[opacity,transform,filter,border-color,color] duration-300 ease-out"
          } ${
            chromeVisible
              ? "translate-y-0 opacity-100 blur-0 pointer-events-auto"
              : "-translate-y-3 opacity-0 blur-[3px] pointer-events-none"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full transition-colors ${
              ambienceMuted ? "bg-[#8F9496]/55" : "bg-[#C89B62]"
            }`}
          />
          <span>{ambienceMuted ? "Muted" : "Sound"}</span>
        </button>
      ) : null}

      <main>{children}</main>
    </div>
  );
};
