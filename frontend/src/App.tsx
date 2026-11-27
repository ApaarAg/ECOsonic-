import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ecosonicSocket } from "./api/ecosonicSocket";
import {
  startMicrophoneCapture,
  type MicrophoneCaptureHandle,
} from "./api/ecosonicAudioCapture";
import { acquireBrowserLocation } from "./api/ecosonicGeolocation";
import { acousticStore } from "./domain/acousticStore";
import { CinematicPage } from "./cinematic/CinematicPage";
import { AnalysisControlDrawer } from "./ui/AnalysisControlDrawer";
import { useAutoHideChrome } from "./ui/useAutoHideChrome";
import { useReducedMotion } from "./visual/engine/useReducedMotion";

export function App() {
  const captureRef = useRef<MicrophoneCaptureHandle | null>(null);
  const [micCapturing, setMicCapturing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [analysisDrawerOpen, setAnalysisDrawerOpen] = useState(false);
  const [chromePinned, setChromePinned] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  const snapshot = useSyncExternalStore(
    acousticStore.subscribe,
    acousticStore.getSnapshot,
    acousticStore.getSnapshot,
  );

  useEffect(() => {
    const onPin = (ev: Event) => {
      const detail = (ev as CustomEvent<{ pinned?: boolean }>).detail;
      setChromePinned(Boolean(detail?.pinned));
    };
    window.addEventListener("ecosonic:chrome-pin", onPin);
    return () => window.removeEventListener("ecosonic:chrome-pin", onPin);
  }, []);

  useEffect(() => {
    return () => {
      void (async () => {
        await captureRef.current?.stop();
        captureRef.current = null;
        await ecosonicSocket.disconnect();
      })();
    };
  }, []);

  const startLive = async () => {
    setBusy(true);
    setCaptureError(null);
    try {
      const existingCoords = acousticStore.getSnapshot().coordinates;
      const hasManualCoords =
        typeof existingCoords.latitude === "number" &&
        Number.isFinite(existingCoords.latitude) &&
        typeof existingCoords.longitude === "number" &&
        Number.isFinite(existingCoords.longitude);

      if (!hasManualCoords) {
        acousticStore.setCoordinates(null, null, null, {
          gpsStatus: "acquiring",
          gpsError: null,
        });
        const loc = await acquireBrowserLocation(4500);
        if (loc.status === "available" && loc.latitude != null && loc.longitude != null) {
          acousticStore.setCoordinates(loc.latitude, loc.longitude, loc.capturedAt, {
            accuracyM: loc.accuracyM,
            gpsStatus: "available",
            gpsError: null,
          });
        } else {
          acousticStore.setCoordinates(null, null, null, {
            accuracyM: null,
            gpsStatus: "unavailable",
            gpsError: loc.error || "Browser/device location unavailable.",
          });
        }
      }

      await ecosonicSocket.connect();
      const capture = await startMicrophoneCapture((chunk) =>
        ecosonicSocket.sendPcm16Chunk(chunk),
      );
      captureRef.current = capture;
      setMicCapturing(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      captureRef.current = null;
      setMicCapturing(false);
      setCaptureError(message);
      await ecosonicSocket.disconnect();
    } finally {
      setBusy(false);
    }
  };

  const stopLive = async () => {
    setBusy(true);
    setCaptureError(null);
    try {
      await captureRef.current?.stop();
      captureRef.current = null;
      setMicCapturing(false);
      await ecosonicSocket.disconnect();
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const isCapturing = micCapturing && captureRef.current !== null;
  const activeError = captureError ?? snapshot.session.lastError;
  const micChromeVisible = useAutoHideChrome({
    pinned: chromePinned || analysisDrawerOpen || isCapturing || busy || Boolean(activeError),
    reducedMotion,
  });

  const handleToggleMicrophone = () => {
    if (busy) return;
    if (isCapturing) {
      void stopLive();
    } else {
      void startLive();
    }
  };

  return (
    <>
      <CinematicPage />
      <div
        aria-label="Live microphone controls"
        className={`fixed right-4 top-3 z-50 flex flex-col items-end gap-1.5 sm:right-6 sm:top-3.5 ${
          reducedMotion
            ? "transition-opacity duration-150"
            : "transition-[opacity,transform,filter] duration-300 ease-out"
        } ${
          micChromeVisible
            ? "translate-y-0 opacity-100 blur-0"
            : "-translate-y-3 opacity-0 blur-[3px] pointer-events-none"
        }`}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="open-analysis-panel-btn"
            aria-expanded={analysisDrawerOpen}
            onClick={() => setAnalysisDrawerOpen((prev) => !prev)}
            className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-[#E8E4DC]/18 bg-[#0D100F]/90 px-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[#E8E4DC]/85 transition-colors hover:border-[#86A68E]/60 hover:text-white sm:h-8"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${snapshot.activeAnalysisId ? "bg-[#86A68E]" : "bg-[#C89B62]/80"}`} />
            <span>Analyze</span>
          </button>

          <button
            type="button"
            role="switch"
            aria-checked={isCapturing}
            aria-busy={busy}
            aria-label={
              isCapturing
                ? "Stop microphone session"
                : "Start microphone session"
            }
            data-testid="microphone-session-toggle"
            onClick={handleToggleMicrophone}
            disabled={busy}
            className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border p-[3px] transition-colors duration-250 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60A5FA] disabled:cursor-wait disabled:opacity-65 sm:h-8 sm:w-14 ${
              isCapturing
                ? "border-[#60A5FA]/50 bg-[#2563EB] shadow-[0_2px_12px_rgba(37,99,235,0.45)]"
                : "border-white/15 bg-[#27272A]/95 shadow-[0_2px_10px_rgba(0,0,0,0.45)] hover:bg-[#323236]"
            }`}
          >
            <span className="sr-only">
              {isCapturing ? "Microphone active" : "Microphone inactive"}
            </span>
            <span
              aria-hidden="true"
              className={`pointer-events-none block h-[20px] w-[22px] rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.35)] transition-transform duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] sm:h-[24px] sm:w-[28px] ${
                isCapturing
                  ? "translate-x-[18px] sm:translate-x-[20px]"
                  : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {activeError ? (
          <p
            role="alert"
            className="max-w-[16rem] rounded bg-[#080808]/90 px-2.5 py-1 text-right text-[10px] text-rose-200 shadow-lg ring-1 ring-white/10 backdrop-blur"
          >
            {activeError}
          </p>
        ) : null}
      </div>

      <AnalysisControlDrawer
        open={analysisDrawerOpen}
        onClose={() => setAnalysisDrawerOpen(false)}
        onJumpToEcology={() => {
          window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_10_ECOLOGICAL_CONTEXT", 0.5);
        }}
      />
    </>
  );
}

export default App;
