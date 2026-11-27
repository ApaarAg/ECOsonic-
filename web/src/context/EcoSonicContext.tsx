import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  createEcoSonicAdapter,
  defaultEcoSonicAdapter,
  type EcoSonicDataAdapter,
} from '../adapters/ecosonicAdapter';
import { DEMO_HABITAT_PRESETS } from '../data/demoFixtures';
import { resolveSessionForPreset } from '../lib/observatory';
import {
  areSettingsEqual,
  clearSettingsInStorage,
  type EcoSonicSettingsState,
  getBrowserLocalStorage,
  getDefaultSettings,
  loadSettingsFromStorage,
  sanitizeAppearancePreferences,
  sanitizeAudioInputPreferences,
  sanitizeBackendConnectionConfig,
  saveSettingsToStorage,
} from '../lib/settingsStorage';
import { AudioStreamer } from '../services/audioStreamer';
import type {
  AcousticStreamMetrics,
  AppAppearancePreferences,
  AudioInputPreferences,
  BackendConnectionConfig,
  DisturbanceEvent,
  HabitatPresetId,
  MonitoringSession,
  MonitoringStatus,
  SoundscapeSnapshot,
  SpeciesDetection,
} from '../types/ecosonic';

export type LiveStreamLifecycleStatus =
  | 'idle'
  | 'starting'
  | 'streaming'
  | 'reconnecting'
  | 'paused'
  | 'stopped'
  | 'error';

interface EcoSonicContextValue {
  adapter: EcoSonicDataAdapter;
  isDemoMode: boolean;
  monitoringStatus: MonitoringStatus;
  activePreset: HabitatPresetId;
  elapsedSec: number;
  streamMetrics: AcousticStreamMetrics;
  detections: SpeciesDetection[];
  disturbances: DisturbanceEvent[];
  sessions: MonitoringSession[];
  soundscape: SoundscapeSnapshot | null;
  isLoading: boolean;
  error: string | null;
  lastSyncIso: string | null;
  bootstrapLatencyMs: number | null;
  storageAvailable: boolean;
  storageWarning: string | null;
  appearance: AppAppearancePreferences;
  audioPrefs: AudioInputPreferences;
  backendConfig: BackendConnectionConfig;
  liveSessionId: string | null;
  liveStreamStatus: LiveStreamLifecycleStatus;
  liveStreamError: string | null;
  setActivePreset: (preset: HabitatPresetId) => void;
  toggleMonitoringStream: () => void;
  startLiveSession: (options?: { deviceId?: string }) => Promise<string | null>;
  stopLiveSession: () => Promise<void>;
  resetDemoSession: () => void;
  retryLoad: () => void;
  updateAppearance: (patch: Partial<AppAppearancePreferences>) => void;
  updateAudioPrefs: (patch: Partial<AudioInputPreferences>) => void;
  updateBackendConfig: (patch: Partial<BackendConnectionConfig>) => void;
  resetAllPreferences: () => void;
}

const EcoSonicContext = createContext<EcoSonicContextValue | null>(null);

export function EcoSonicProvider({
  children,
  adapter: propAdapter,
}: {
  children: React.ReactNode;
  adapter?: EcoSonicDataAdapter;
}) {
  const initialStorageRef = useRef<ReturnType<typeof loadSettingsFromStorage> | null>(null);
  if (initialStorageRef.current === null) {
    initialStorageRef.current = loadSettingsFromStorage(getBrowserLocalStorage());
  }

  const [settings, setSettings] = useState<EcoSonicSettingsState>(
    () => initialStorageRef.current!.settings
  );
  const [storageAvailable] = useState<boolean>(
    () => initialStorageRef.current!.storageAvailable
  );
  const [storageWarning, setStorageWarning] = useState<string | null>(() => {
    if (!initialStorageRef.current!.storageAvailable) {
      return 'Browser localStorage is unavailable; preference changes apply to this session only.';
    }
    if (initialStorageRef.current!.recoveredFromCorruption) {
      return 'Corrupted saved preferences were detected and restored safely to defaults.';
    }
    return null;
  });

  const adapter = useMemo(() => {
    if (propAdapter) return propAdapter;
    return createEcoSonicAdapter(settings.backendConfig);
  }, [propAdapter, settings.backendConfig]);

  const [monitoringStatus, setMonitoringStatus] = useState<MonitoringStatus>('streaming');
  const [activePreset, setActivePreset] = useState<HabitatPresetId>('temperate-rainforest');
  const [elapsedSec, setElapsedSec] = useState<number>(2140);
  const [streamMetrics, setStreamMetrics] = useState<AcousticStreamMetrics>(() =>
    adapter.getInitialStreamMetrics()
  );

  const [detections, setDetections] = useState<SpeciesDetection[]>([]);
  const [disturbances, setDisturbances] = useState<DisturbanceEvent[]>([]);
  const [sessions, setSessions] = useState<MonitoringSession[]>([]);
  const [soundscape, setSoundscape] = useState<SoundscapeSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncIso, setLastSyncIso] = useState<string | null>(null);
  const [bootstrapLatencyMs, setBootstrapLatencyMs] = useState<number | null>(null);
  const [reloadNonce, setReloadNonce] = useState<number>(0);

  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const [liveStreamStatus, setLiveStreamStatus] = useState<LiveStreamLifecycleStatus>('idle');
  const [liveStreamError, setLiveStreamError] = useState<string | null>(null);
  const streamerRef = useRef<AudioStreamer | null>(null);

  const lastPersistedRef = useRef<EcoSonicSettingsState>(settings);

  // Sync theme attribute on documentElement for /app/* workspace
  useEffect(() => {
    if (settings.appearance.theme === 'field-light') {
      document.documentElement.setAttribute('data-theme', 'field-light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, [settings.appearance.theme]);

  // Persist validated settings to localStorage only when settings change
  useEffect(() => {
    if (areSettingsEqual(lastPersistedRef.current, settings)) {
      return;
    }
    const result = saveSettingsToStorage(getBrowserLocalStorage(), settings);
    if (result.saved) {
      lastPersistedRef.current = settings;
      setStorageWarning(null);
    } else if (result.error) {
      setStorageWarning(result.error);
    }
  }, [settings]);

  // Initial load & retryable bootstrap from adapter
  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError(null);

    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

    const runBootstrap = async () => {
      try {
        if (
          typeof window !== 'undefined' &&
          window.sessionStorage?.getItem('ecosonic.test.bootstrapFault') === 'once'
        ) {
          window.sessionStorage.removeItem('ecosonic.test.bootstrapFault');
          throw new Error('Bootstrap load interrupted');
        }
      } catch (faultCheckErr) {
        if (faultCheckErr instanceof Error && faultCheckErr.message === 'Bootstrap load interrupted') {
          throw faultCheckErr;
        }
      }

      return Promise.all([
        adapter.fetchDetections(),
        adapter.fetchDisturbances(),
        adapter.fetchSessions(),
        adapter.fetchSoundscapeSnapshot(activePreset),
      ]);
    };

    runBootstrap()
      .then(([det, dist, ses, snd]) => {
        if (!active) return;
        const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        setDetections(det);
        setDisturbances(dist);
        setSessions(ses);
        setSoundscape(snd);
        setLastSyncIso(new Date().toISOString());
        setBootstrapLatencyMs(Math.max(0, Math.round(finishedAt - startedAt)));
        setError(null);
        setIsLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        console.error(
          'EcoSonic workspace bootstrap failed:',
          err instanceof Error ? err.message : 'Unknown error'
        );
        setError(
          'Unable to load acoustic workspace data from the active adapter. Verify settings or retry loading.'
        );
        setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [adapter, activePreset, reloadNonce]);

  // Subtle deterministic telemetry progression while demo stream is active (Demo mode only)
  useEffect(() => {
    if (monitoringStatus !== 'streaming' || !adapter.isDemoMode) return;
    const interval = window.setInterval(() => {
      setElapsedSec((prev) => prev + 1);
      setStreamMetrics((prev) => {
        const phase = (prev.framesProcessed % 20) / 20;
        const rmsJitter = Math.sin(phase * Math.PI * 2) * 1.4;
        const baseFreq =
          activePreset === 'temperate-rainforest'
            ? 3420
            : activePreset === 'boreal-wetland'
              ? 2180
              : 1640;
        return {
          ...prev,
          framesProcessed: prev.framesProcessed + 1,
          rmsLevelDbfs: Number((-37.6 + rmsJitter).toFixed(1)),
          peakFrequencyHz: Math.round(baseFreq + Math.cos(phase * Math.PI * 2) * 380),
        };
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [monitoringStatus, activePreset, adapter.isDemoMode]);

  const handleSetActivePreset = useCallback(
    (preset: HabitatPresetId) => {
      setActivePreset(preset);
      const matched = resolveSessionForPreset(
        preset,
        sessions,
        detections,
        DEMO_HABITAT_PRESETS
      );
      setElapsedSec(matched?.durationSec ?? 0);
      const baseFreq =
        preset === 'temperate-rainforest' ? 3420 : preset === 'boreal-wetland' ? 2180 : 1640;
      setStreamMetrics((prev) => ({
        ...prev,
        peakFrequencyHz: baseFreq,
      }));
    },
    [detections, sessions]
  );

  const retryLoad = useCallback(() => {
    setReloadNonce((n) => n + 1);
  }, []);

  const toggleMonitoringStream = useCallback(() => {
    setMonitoringStatus((prev) => (prev === 'streaming' ? 'paused' : 'streaming'));
  }, []);

  const startLiveSession = useCallback(
    async (options?: { deviceId?: string }): Promise<string | null> => {
      try {
        setLiveStreamError(null);
        setLiveStreamStatus('starting');

        let sessionId = `live-${Date.now()}`;
        if (adapter.createSession) {
          const created = await adapter.createSession({
            source_type: 'browser_mic',
            device_id: options?.deviceId || settings.audioPrefs.preferredDeviceId,
          });
          sessionId = created.id;
        }
        setLiveSessionId(sessionId);

        const streamer = new AudioStreamer({
          sessionId,
          wsBaseUrl: settings.backendConfig.wsStreamUrl,
          targetSampleRate: 32000,
          chunkDurationMs: 250,
          reconnectIntervalMs: settings.backendConfig.reconnectIntervalMs,
          onStatusChange: (s, err) => {
            if (s === 'streaming') setLiveStreamStatus('streaming');
            else if (s === 'reconnecting') setLiveStreamStatus('reconnecting');
            else if (s === 'paused') setLiveStreamStatus('paused');
            else if (s === 'stopped') setLiveStreamStatus('stopped');
            else if (s === 'error') {
              setLiveStreamStatus('error');
              if (err) setLiveStreamError(err);
            }
          },
          onAudioLevel: (rms) => {
            const rmsDb = 20 * Math.log10(Math.max(1e-5, rms));
            setStreamMetrics((prev) => ({
              ...prev,
              rmsLevelDbfs: Number(rmsDb.toFixed(1)),
            }));
          },
          onEvent: (msg) => {
            if (msg.type === 'detection') {
              const newDet: SpeciesDetection = {
                id: msg.event_id || `det-${Date.now()}`,
                commonName: msg.common_name || msg.class_label || 'Avian Species',
                scientificName: msg.scientific_name || msg.class_label || 'Aves',
                timestampIso: new Date().toISOString(),
                confidenceScore: Number(msg.confidence_score || 0),
                sessionId: msg.session_id || sessionId,
                frequencyRangeHz: [1800, 7200],
                durationSec: Math.max(0.5, Number((msg.end_seconds - msg.start_seconds) || 3.0)),
                habitatPreset: activePreset,
              };
              setDetections((prev) => [newDet, ...prev]);
            } else if (msg.type === 'disturbance_event') {
              const newDist: DisturbanceEvent = {
                id: msg.event_id || `dist-${Date.now()}`,
                category:
                  msg.category?.includes('hazard') || msg.hazard_classification === 'critical'
                    ? 'environmental_hazard'
                    : msg.category?.includes('transportation')
                      ? 'transportation'
                      : 'mechanical_activity',
                label: msg.class_label || msg.event_type || 'Disturbance Alert',
                description: `Acoustic detection of ${msg.class_label || msg.event_type}`,
                timestampIso: new Date().toISOString(),
                durationSec: Math.max(0.5, Number((msg.end_seconds - msg.start_seconds) || 3.0)),
                peakDbfs: -18.0,
                frequencyBandHz: [500, 4500],
                severity: msg.hazard_classification === 'critical' ? 'elevated' : 'moderate',
                confidenceScore: Number(msg.confidence_score || 0),
                sessionId: msg.session_id || sessionId,
              };
              setDisturbances((prev) => [newDist, ...prev]);
            } else if (msg.type === 'soundscape_measurement') {
              if (msg.metrics) {
                setSoundscape((prev) => {
                  const base = prev ?? {
                    presetId: activePreset,
                    siteName: 'Live EcoSonic Node',
                    indices: {
                      aci: 0,
                      adi: 0,
                      aei: 0,
                      ndsi: 0,
                      spectralEntropy: 0,
                      meanLevelDbfs: -35.0,
                      computedAtIso: new Date().toISOString(),
                    },
                    frequencyBands: [],
                    temporalActivity: [],
                  };
                  return {
                    ...base,
                    indices: {
                      aci: Number(msg.metrics.aci || base.indices.aci),
                      adi: Number(msg.metrics.adi || base.indices.adi),
                      aei: Number(msg.metrics.aei || base.indices.aei),
                      ndsi: Number(msg.metrics.ndsi || base.indices.ndsi),
                      spectralEntropy: Number(
                        msg.metrics.spectral_entropy || base.indices.spectralEntropy
                      ),
                      meanLevelDbfs: base.indices.meanLevelDbfs,
                      computedAtIso: new Date().toISOString(),
                    },
                  };
                });
              }
            } else if (msg.type === 'processing_update') {
              if (typeof msg.processed_seconds === 'number') {
                setElapsedSec(Math.round(msg.processed_seconds));
              }
              if (typeof msg.window_index === 'number') {
                setStreamMetrics((prev) => ({
                  ...prev,
                  framesProcessed: msg.window_index,
                }));
              }
            }
          },
          onError: (err) => {
            setLiveStreamError(err.message || 'Stream error');
            setLiveStreamStatus('error');
          },
        });

        streamerRef.current = streamer;
        await streamer.start();
        setMonitoringStatus('streaming');
        setLiveStreamStatus('streaming');
        return sessionId;
      } catch (err: any) {
        setLiveStreamStatus('error');
        setLiveStreamError(err.message || 'Failed to start live stream');
        return null;
      }
    },
    [adapter, settings, activePreset]
  );

  const stopLiveSession = useCallback(async () => {
    if (streamerRef.current) {
      await streamerRef.current.stop();
      streamerRef.current = null;
    }
    if (liveSessionId && adapter.stopSession) {
      try {
        await adapter.stopSession(liveSessionId);
      } catch {}
      try {
        const freshSessions = await adapter.fetchSessions();
        setSessions(freshSessions);
      } catch {}
    }
    setMonitoringStatus('idle');
    setLiveStreamStatus('stopped');
  }, [adapter, liveSessionId]);

  // Clean up streamer on unmount
  useEffect(() => {
    return () => {
      if (streamerRef.current) {
        void streamerRef.current.stop();
        streamerRef.current = null;
      }
    };
  }, []);

  const resetDemoSession = useCallback(() => {
    setElapsedSec(0);
    setStreamMetrics({
      ...adapter.getInitialStreamMetrics(),
      framesProcessed: 0,
      sampleRateHz: settings.audioPrefs.sampleRateHz,
    });
  }, [adapter, settings.audioPrefs.sampleRateHz]);

  const updateAppearance = useCallback((patch: Partial<AppAppearancePreferences>) => {
    setSettings((prev) => {
      const nextAppearance = sanitizeAppearancePreferences({ ...prev.appearance, ...patch });
      const next = { ...prev, appearance: nextAppearance };
      return areSettingsEqual(prev, next) ? prev : next;
    });
  }, []);

  const updateAudioPrefs = useCallback((patch: Partial<AudioInputPreferences>) => {
    setSettings((prev) => {
      const nextAudio = sanitizeAudioInputPreferences({ ...prev.audioPrefs, ...patch });
      const next = { ...prev, audioPrefs: nextAudio };
      return areSettingsEqual(prev, next) ? prev : next;
    });
  }, []);

  const updateBackendConfig = useCallback((patch: Partial<BackendConnectionConfig>) => {
    setSettings((prev) => {
      const nextBackend = sanitizeBackendConnectionConfig({ ...prev.backendConfig, ...patch });
      const next = { ...prev, backendConfig: nextBackend };
      return areSettingsEqual(prev, next) ? prev : next;
    });
  }, []);

  const resetAllPreferences = useCallback(() => {
    const defaults = getDefaultSettings();
    clearSettingsInStorage(getBrowserLocalStorage());
    lastPersistedRef.current = defaults;
    setStorageWarning(
      storageAvailable
        ? null
        : 'Browser localStorage is unavailable; preference changes apply to this session only.'
    );
    setSettings((prev) => (areSettingsEqual(prev, defaults) ? prev : defaults));
  }, [storageAvailable]);

  const value = useMemo<EcoSonicContextValue>(
    () => ({
      adapter,
      isDemoMode: adapter.isDemoMode,
      monitoringStatus,
      activePreset,
      elapsedSec,
      streamMetrics,
      detections,
      disturbances,
      sessions,
      soundscape,
      isLoading,
      error,
      lastSyncIso,
      bootstrapLatencyMs,
      storageAvailable,
      storageWarning,
      appearance: settings.appearance,
      audioPrefs: settings.audioPrefs,
      backendConfig: settings.backendConfig,
      liveSessionId,
      liveStreamStatus,
      liveStreamError,
      setActivePreset: handleSetActivePreset,
      toggleMonitoringStream,
      startLiveSession,
      stopLiveSession,
      resetDemoSession,
      retryLoad,
      updateAppearance,
      updateAudioPrefs,
      updateBackendConfig,
      resetAllPreferences,
    }),
    [
      adapter,
      monitoringStatus,
      activePreset,
      elapsedSec,
      streamMetrics,
      detections,
      disturbances,
      sessions,
      soundscape,
      isLoading,
      error,
      lastSyncIso,
      bootstrapLatencyMs,
      storageAvailable,
      storageWarning,
      settings,
      liveSessionId,
      liveStreamStatus,
      liveStreamError,
      handleSetActivePreset,
      toggleMonitoringStream,
      startLiveSession,
      stopLiveSession,
      resetDemoSession,
      retryLoad,
      updateAppearance,
      updateAudioPrefs,
      updateBackendConfig,
      resetAllPreferences,
    ]
  );

  return <EcoSonicContext.Provider value={value}>{children}</EcoSonicContext.Provider>;
}

export function useEcoSonic(): EcoSonicContextValue {
  const ctx = useContext(EcoSonicContext);
  if (!ctx) {
    throw new Error('useEcoSonic must be used inside an EcoSonicProvider');
  }
  return ctx;
}
