import React, { useCallback, useEffect, useId, useState, useSyncExternalStore } from "react";
import {
  createAudioAnalysis,
  getAnalysisStatus,
  listAnalyses,
  loadAnalysisIntoStore,
} from "../api/ecosonicEcologyApi";
import { acquireBrowserLocation } from "../api/ecosonicGeolocation";
import type { AnalysisSummaryDto } from "../domain/acousticFieldTypes";
import { acousticStore } from "../domain/acousticStore";

export interface AnalysisControlDrawerProps {
  open: boolean;
  onClose: () => void;
  onJumpToEcology?: () => void;
}

function validateCoordinateInputs(
  latRaw: string,
  lonRaw: string,
): {
  valid: boolean;
  latitude: number | null;
  longitude: number | null;
  error: string | null;
} {
  const latTrim = latRaw.trim();
  const lonTrim = lonRaw.trim();
  if (!latTrim && !lonTrim) {
    return { valid: true, latitude: null, longitude: null, error: null };
  }
  if (!latTrim || !lonTrim) {
    return {
      valid: false,
      latitude: null,
      longitude: null,
      error: "Both latitude and longitude must be entered together (or clear both).",
    };
  }
  const lat = Number(latTrim);
  const lon = Number(lonTrim);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return {
      valid: false,
      latitude: null,
      longitude: null,
      error: "Latitude must be between -90 and 90 degrees.",
    };
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return {
      valid: false,
      latitude: null,
      longitude: null,
      error: "Longitude must be between -180 and 180 degrees.",
    };
  }
  return { valid: true, latitude: lat, longitude: lon, error: null };
}

export const AnalysisControlDrawer: React.FC<AnalysisControlDrawerProps> = ({
  open,
  onClose,
  onJumpToEcology,
}) => {
  const titleId = useId();
  const snapshot = useSyncExternalStore(
    acousticStore.subscribe,
    acousticStore.getSnapshot,
    acousticStore.getSnapshot,
  );

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [latInput, setLatInput] = useState<string>(
    snapshot.coordinates.latitude != null ? String(snapshot.coordinates.latitude) : "",
  );
  const [lonInput, setLonInput] = useState<string>(
    snapshot.coordinates.longitude != null ? String(snapshot.coordinates.longitude) : "",
  );
  const [gpsAccuracyM, setGpsAccuracyM] = useState<number | null>(
    snapshot.coordinates.accuracyM ?? null,
  );
  const [gpsCapturedAt, setGpsCapturedAt] = useState<string | null>(
    snapshot.coordinates.recordedAt ?? null,
  );
  const [recordedAtInput, setRecordedAtInput] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [activeJob, setActiveJob] = useState<{
    id: string;
    status: string;
    progress: number;
    stage: string | null;
  } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [history, setHistory] = useState<AnalysisSummaryDto[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const refreshHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const items = await listAnalyses(12);
      setHistory(items);
    } catch {
      // keep existing list cleanly
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refreshHistory();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, refreshHistory]);

  // Keep acousticStore.coordinates synced for optional live mic sessions
  useEffect(() => {
    const check = validateCoordinateInputs(latInput, lonInput);
    if (check.valid) {
      acousticStore.setCoordinates(
        check.latitude,
        check.longitude,
        recordedAtInput.trim() || null,
      );
    }
  }, [latInput, lonInput, recordedAtInput]);

  if (!open) return null;

  const handleUseBrowserGps = () => {
    setFormError(null);
    void acquireBrowserLocation(6000).then((loc) => {
      if (loc.status === "available" && loc.latitude != null && loc.longitude != null) {
        setLatInput(loc.latitude.toFixed(4));
        setLonInput(loc.longitude.toFixed(4));
        setGpsAccuracyM(loc.accuracyM);
        setGpsCapturedAt(loc.capturedAt);
        acousticStore.setCoordinates(loc.latitude, loc.longitude, loc.capturedAt, {
          accuracyM: loc.accuracyM,
          gpsStatus: "available",
          gpsError: null,
        });
      } else {
        setGpsAccuracyM(null);
        setGpsCapturedAt(null);
        acousticStore.setCoordinates(null, null, null, {
          accuracyM: null,
          gpsStatus: "unavailable",
          gpsError: loc.error || "Browser/device location unavailable.",
        });
        setFormError(`Unable to acquire browser GPS: ${loc.error || "Position unavailable"}`);
      }
    });
  };

  const handleSubmitUpload = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setFormError(null);

    if (!selectedFile) {
      setFormError("Select an audio file (WAV, MP3, FLAC, OGG, or M4A) to analyze.");
      return;
    }

    const coordCheck = validateCoordinateInputs(latInput, lonInput);
    if (!coordCheck.valid) {
      setFormError(coordCheck.error);
      return;
    }

    setSubmitting(true);
    setActiveJob(null);
    try {
      const isoRecorded = recordedAtInput.trim()
        ? new Date(recordedAtInput.trim()).toISOString()
        : null;
      const created = await createAudioAnalysis(selectedFile, {
        latitude: coordCheck.latitude,
        longitude: coordCheck.longitude,
        gpsAccuracyM,
        gpsCapturedAt,
        recordedAt: isoRecorded,
      });

      setActiveJob({
        id: created.id,
        status: created.status,
        progress: created.progress ?? 0,
        stage: created.current_stage,
      });

      // Poll background analysis pipeline until completion or failure
      let finalStatus = created.status;
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const st = await getAnalysisStatus(created.id);
        finalStatus = st.status;
        setActiveJob({
          id: st.id,
          status: st.status,
          progress: st.progress,
          stage: st.current_stage,
        });
        if (st.status === "completed") {
          await loadAnalysisIntoStore(created.id, { updateUrl: true });
          await refreshHistory();
          break;
        }
        if (st.status === "failed") {
          setFormError(st.error_message || "Analysis job failed during background processing.");
          break;
        }
      }
      if (finalStatus !== "completed" && finalStatus !== "failed") {
        setFormError("Analysis is still processing in background; check history shortly.");
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to submit audio analysis.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenSaved = async (analysisId: string) => {
    setFormError(null);
    await loadAnalysisIntoStore(analysisId, { updateUrl: true });
    onJumpToEcology?.();
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="analysis-workspace-panel"
      className="fixed inset-0 z-[70] flex items-start justify-end bg-black/75 p-3 pt-16 backdrop-blur-sm sm:p-6 sm:pt-18"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[86dvh] w-full max-w-lg flex-col overflow-hidden rounded-[4px] border border-[#E8E4DC]/16 bg-[#080A09] text-[#E8E4DC] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#E8E4DC]/12 px-5 py-3.5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#86A68E]">
              BIOACOUSTIC PIPELINE · UPLOAD & GEOLOCATION
            </p>
            <h2 id={titleId} className="font-editorial text-xl text-[#EDE9E0]">
              Acoustic Analysis & Context
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close analysis workspace"
            className="cursor-pointer rounded-[2px] border border-[#E8E4DC]/20 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[#D8D4C8] hover:border-[#E8E4DC]/50"
          >
            Close
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto p-5">
          <form onSubmit={handleSubmitUpload} data-testid="analysis-upload-form" className="space-y-3.5">
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-[0.18em] text-[#9EA7A2]">
                Recording File (WAV, MP3, FLAC, OGG, M4A)
              </label>
              <input
                type="file"
                accept=".wav,.mp3,.flac,.ogg,.m4a,audio/*"
                data-testid="analysis-audio-input"
                onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                className="mt-1.5 block w-full cursor-pointer rounded-[2px] border border-[#E8E4DC]/18 bg-[#050606] px-3 py-2 font-mono text-xs text-[#E8E4DC] file:mr-3 file:rounded-[2px] file:border-0 file:bg-[#19221D] file:px-2.5 file:py-1 file:font-mono file:text-[10px] file:uppercase file:tracking-[0.14em] file:text-[#86A68E]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-[0.16em] text-[#9EA7A2]">
                  Latitude (-90..90)
                </label>
                <input
                  type="number"
                  step="any"
                  placeholder="e.g. 47.86"
                  value={latInput}
                  data-testid="analysis-latitude-input"
                  onChange={(e) => setLatInput(e.target.value)}
                  className="mt-1 w-full rounded-[2px] border border-[#E8E4DC]/18 bg-[#050606] px-2.5 py-1.5 font-mono text-xs text-[#E8E4DC] placeholder:text-[#9EA7A2]/40 focus:border-[#86A68E] focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-[0.16em] text-[#9EA7A2]">
                  Longitude (-180..180)
                </label>
                <input
                  type="number"
                  step="any"
                  placeholder="e.g. -123.93"
                  value={lonInput}
                  data-testid="analysis-longitude-input"
                  onChange={(e) => setLonInput(e.target.value)}
                  className="mt-1 w-full rounded-[2px] border border-[#E8E4DC]/18 bg-[#050606] px-2.5 py-1.5 font-mono text-xs text-[#E8E4DC] placeholder:text-[#9EA7A2]/40 focus:border-[#86A68E] focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleUseBrowserGps}
                  className="cursor-pointer rounded-[2px] border border-[#E8E4DC]/20 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[#D8D4C8]/85 hover:border-[#86A68E]"
                >
                  Use Browser GPS
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLatInput("");
                    setLonInput("");
                  }}
                  className="cursor-pointer rounded-[2px] border border-[#E8E4DC]/14 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[#9EA7A2] hover:text-[#E8E4DC]"
                >
                  Clear Coords
                </button>
              </div>
              <input
                type="datetime-local"
                aria-label="Recording timestamp (optional)"
                value={recordedAtInput}
                onChange={(e) => setRecordedAtInput(e.target.value)}
                className="rounded-[2px] border border-[#E8E4DC]/16 bg-[#050606] px-2 py-1 font-mono text-[11px] text-[#D8D4C8]/85"
              />
            </div>

            {formError ? (
              <p role="alert" className="rounded-[2px] border border-amber-500/35 bg-amber-950/35 px-3 py-2 font-mono text-[11px] text-amber-200">
                {formError}
              </p>
            ) : null}

            {activeJob ? (
              <div data-testid="analysis-progress-box" className="space-y-1.5 rounded-[2px] border border-[#86A68E]/30 bg-[#0D1310] px-3 py-2.5">
                <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em]">
                  <span className="text-[#86A68E]">{activeJob.stage || activeJob.status}</span>
                  <span className="tabular-nums text-[#E8E4DC]">{Math.round(activeJob.progress)}%</span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full bg-[#86A68E] transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.max(0, activeJob.progress))}%` }}
                  />
                </div>
                {activeJob.status === "completed" && onJumpToEcology ? (
                  <button
                    type="button"
                    data-testid="jump-to-ecology-after-analysis"
                    onClick={() => {
                      onJumpToEcology();
                      onClose();
                    }}
                    className="mt-1.5 w-full cursor-pointer rounded-[2px] border border-[#86A68E]/55 bg-[#86A68E]/16 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[#EDE9E0] hover:bg-[#86A68E]/28"
                  >
                    View Results in Acts 10–12 →
                  </button>
                ) : null}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              data-testid="submit-analysis-btn"
              className="w-full cursor-pointer rounded-[2px] border border-[#86A68E]/60 bg-[#1B2A22] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#EDE9E0] transition-colors hover:bg-[#24382E] disabled:cursor-wait disabled:opacity-60"
            >
              {submitting ? "Running BirdNET + Geospatial Pipeline..." : "Run Real Acoustic Analysis"}
            </button>
          </form>

          {/* Persisted Analyses Selector */}
          <div className="space-y-2.5 border-t border-[#E8E4DC]/12 pt-4">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#9EA7A2]">
                Persisted Analyses ({history.length})
              </p>
              <button
                type="button"
                onClick={() => void refreshHistory()}
                className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.16em] text-[#86A68E] hover:underline"
              >
                {loadingHistory ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            {history.length === 0 ? (
              <p className="font-mono text-[11px] text-[#9EA7A2]/80">
                No saved analyses in backend storage yet.
              </p>
            ) : (
              <ul data-testid="analysis-history-list" className="space-y-1.5">
                {history.map((item) => {
                  const isActive = snapshot.activeAnalysisId === item.id;
                  const hasCoords = item.latitude != null && item.longitude != null;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        disabled={item.status !== "completed"}
                        onClick={() => void handleOpenSaved(item.id)}
                        className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-[2px] border px-3 py-2 text-left transition-colors ${
                          isActive
                            ? "border-[#86A68E]/65 bg-[#121D17]"
                            : "border-[#E8E4DC]/12 bg-[#050606] hover:border-[#E8E4DC]/35"
                        } disabled:cursor-not-allowed disabled:opacity-55`}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-mono text-xs text-[#E8E4DC]">
                            {item.filename}
                          </p>
                          <p className="mt-0.5 font-mono text-[10px] text-[#9EA7A2] tabular-nums">
                            {hasCoords
                              ? `${item.latitude!.toFixed(2)}°, ${item.longitude!.toFixed(2)}°`
                              : "Coordinates unspecified"}{" "}
                            · {item.detections_count ?? 0} detections
                          </p>
                        </div>
                        <span
                          className={`shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] ${
                            item.status === "completed"
                              ? "text-[#86A68E]"
                              : item.status === "failed"
                                ? "text-rose-400"
                                : "text-amber-300"
                          }`}
                        >
                          {isActive ? "Active" : item.status}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
