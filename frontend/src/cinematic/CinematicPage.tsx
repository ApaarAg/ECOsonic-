import React, { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { EditorialShell } from "../ui/EditorialShell";
import { useReducedMotion } from "../visual/engine/useReducedMotion";
import { type CinematicActId } from "../visual/Cinematic/cinematicSequence";
import { CinematicStage } from "../visual/Cinematic/CinematicStage";
import { ContinuousAudioTimeline } from "./CinematicAudioTimeline";
import { CinematicScrollController } from "./CinematicScrollController";
import { CinematicStateStore } from "./CinematicState";
import {
  getScrollProgressForAct,
  TIMELINE_SEGMENTS,
  TOTAL_TIMELINE_VH,
} from "./CinematicTimeline";
import { type StoryboardAct } from "../domain/storyboard";
import { storyboardActToCinematicId } from "../visual/Cinematic/cinematicSequence";

function resolveUrlInitialPlayback(): {
  act: CinematicActId;
  explicitTarget: boolean;
} {
  if (typeof window === "undefined") {
    return {
      act: "ACT_01_BLACKNESS",
      explicitTarget: false,
    };
  }
  const params = new URLSearchParams(window.location.search);

  const actParam = params.get("act")?.toLowerCase();
  const hash = window.location.hash.replace(/^#/, "").toLowerCase();
  const token = actParam || hash;

  switch (token) {
    case "blackness":
    case "01":
      return { act: "ACT_01_BLACKNESS", explicitTarget: true };
    case "forest":
    case "02":
      return { act: "ACT_02_FOREST", explicitTarget: true };
    case "leaf":
    case "03":
      return { act: "ACT_03_LEAF", explicitTarget: true };
    case "water":
    case "04":
      return { act: "ACT_04_WATER", explicitTarget: true };
    case "sound":
    case "05":
      return { act: "ACT_05_SOUND", explicitTarget: true };
    case "acoustic-field":
    case "field":
    case "06":
      return {
        act: "ACT_06_ACOUSTIC_FIELD",
        explicitTarget: true,
      };
    case "species":
    case "07":
      return { act: "ACT_07_SPECIES", explicitTarget: true };
    case "disturbance":
    case "08":
      return {
        act: "ACT_08_DISTURBANCE",
        explicitTarget: true,
      };
    case "silence":
    case "09":
      return { act: "ACT_09_SILENCE", explicitTarget: true };
    case "ecology":
    case "ecological-context":
    case "context":
    case "10":
      return {
        act: "ACT_10_ECOLOGICAL_CONTEXT",
        explicitTarget: true,
      };
    case "expected-species":
    case "expected":
    case "11":
      return {
        act: "ACT_11_EXPECTED_SPECIES",
        explicitTarget: true,
      };
    case "observation-gap":
    case "gap":
    case "12":
      return {
        act: "ACT_12_OBSERVATION_GAP",
        explicitTarget: true,
      };
    default:
      return {
        act: "ACT_01_BLACKNESS",
        explicitTarget: false,
      };
  }
}

function isReloadNavigation(): boolean {
  if (typeof performance === "undefined" || !performance.getEntriesByType) {
    return false;
  }
  const nav = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  return nav?.type === "reload";
}

const SCROLL_SESSION_KEY = "ecosonic:scrollProgress";

export const CinematicPage: React.FC = () => {
  const reducedMotion = useReducedMotion();
  const initialConfig = useMemo(() => resolveUrlInitialPlayback(), []);

  const stateStore = useMemo(
    () =>
      new CinematicStateStore(
        initialConfig.act,
        reducedMotion,
      ),
    // Stable singleton per mount; reducedMotion synced via setReducedMotion
    [],
  );

  const audioTimeline = useMemo(() => new ContinuousAudioTimeline(), []);
  const scrollController = useMemo(
    () => new CinematicScrollController(stateStore),
    [stateStore],
  );

  const restoredRef = useRef(false);

  useEffect(() => {
    stateStore.setReducedMotion(reducedMotion);
  }, [reducedMotion, stateStore]);

  useEffect(() => {
    const detachScroll = scrollController.attach();

    if (!restoredRef.current) {
      restoredRef.current = true;
      if (initialConfig.explicitTarget) {
        const targetP = getScrollProgressForAct(
          initialConfig.act,
          initialConfig.act === "ACT_01_BLACKNESS" ? 0 : undefined,
        );
        scrollController.scrollToProgress(targetP, true);
      } else if (isReloadNavigation()) {
        // Restore mid-page position cleanly across browser reloads
        const docScroll = CinematicScrollController.readWindowScrollProgress();
        let saved: number | null = null;
        try {
          const raw = window.sessionStorage.getItem(SCROLL_SESSION_KEY);
          if (raw !== null) {
            const parsed = Number(raw);
            if (Number.isFinite(parsed)) saved = parsed;
          }
        } catch {
          // ignore storage restrictions
        }
        const target = docScroll > 0.002 ? docScroll : (saved ?? 0);
        if (target > 0.002) {
          scrollController.scrollToProgress(target, true);
        }
      }
    }

    const persistScroll = () => {
      try {
        window.sessionStorage.setItem(
          SCROLL_SESSION_KEY,
          stateStore.runtime.rawScrollProgress.toFixed(5),
        );
      } catch {
        // ignore
      }
    };
    window.addEventListener("scroll", persistScroll, { passive: true });

    const unlockAudioOnGesture = (event: Event) => {
      if (
        event.target instanceof Element &&
        event.target.closest('[data-testid="ecosonic-brand-wordmark"]')
      ) {
        return;
      }
      if (audioTimeline.unlock()) {
        stateStore.setAudioUnlocked(true);
        window.removeEventListener("pointerdown", unlockAudioOnGesture);
        window.removeEventListener("keydown", unlockAudioOnGesture);
      }
    };
    window.addEventListener("pointerdown", unlockAudioOnGesture, {
      passive: true,
    });
    window.addEventListener("keydown", unlockAudioOnGesture, {
      passive: true,
    });

    return () => {
      detachScroll();
      window.removeEventListener("scroll", persistScroll);
      window.removeEventListener("pointerdown", unlockAudioOnGesture);
      window.removeEventListener("keydown", unlockAudioOnGesture);
      audioTimeline.dispose();
    };
  }, [audioTimeline, initialConfig, scrollController, stateStore]);

  const snapshot = useSyncExternalStore(
    stateStore.subscribe,
    stateStore.getSnapshot,
    stateStore.getSnapshot,
  );
  const ambientAudio = useSyncExternalStore(
    audioTimeline.subscribe,
    audioTimeline.getSnapshot,
    audioTimeline.getSnapshot,
  );

  const handleToggleAmbience = () => {
    const nextMuted = !ambientAudio.muted;
    audioTimeline.setMuted(nextMuted);
    if (!nextMuted && audioTimeline.unlock()) {
      stateStore.setAudioUnlocked(true);
    }
  };

  const handleSelectAct = (act: StoryboardAct) => {
    if (!audioTimeline.isMuted() && audioTimeline.unlock()) {
      stateStore.setAudioUnlocked(true);
    }
    const actId = storyboardActToCinematicId(act);
    const target = getScrollProgressForAct(
      actId,
      actId === "ACT_01_BLACKNESS" ? 0 : undefined,
    );
    scrollController.scrollToProgress(target, reducedMotion);
  };

  return (
    <div
      data-testid="cinematic-scroll-root"
      className="relative w-full bg-[#080808]"
      style={{ overflowX: "clip" }}
    >
      <EditorialShell
        activeAct={snapshot.storyboardAct}
        scrollProgress={snapshot.scrollProgress}
        onSelectAct={handleSelectAct}
        ambienceMuted={ambientAudio.muted}
        onToggleAmbience={handleToggleAmbience}
      >
        <div
          className="relative w-full"
          style={{ height: `${TOTAL_TIMELINE_VH}vh` }}
        >
          {/* Sticky unified WebGL viewport shared smoothly across all 10 Acts */}
          <div className="sticky top-0 h-dvh w-full overflow-hidden">
            <CinematicStage
              activeAct={snapshot.storyboardAct}
              scrollProgress={snapshot.scrollProgress}
              stateStore={stateStore}
              scrollController={scrollController}
              audioTimeline={audioTimeline}
            />
          </div>

          {/* Continuous passive spatial scroll markers mapping Acts 01-10 without obscuring WebGL pointer interaction */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
          >
            {TIMELINE_SEGMENTS.map((seg) => (
              <div
                key={seg.act}
                data-act-marker={seg.act}
                data-scroll-start={seg.start}
                data-scroll-end={seg.end}
                style={{
                  position: "absolute",
                  top: `${seg.start * 100}%`,
                  height: `${(seg.end - seg.start) * 100}%`,
                  left: 0,
                  right: 0,
                }}
              />
            ))}
          </div>
        </div>
      </EditorialShell>
    </div>
  );
};
