import type {
  AcousticDomainSnapshot,
  AudioMetrics,
  AudioSourceKind,
  DetectionEvent,
  DisturbanceEvent,
  EcologicalFetchStatus,
  EcologicalGapSnapshot,
  ExpectedSpeciesBaseline,
  GeospatialContextSummary,
  LatencyTelemetry,
  SessionConnectionKind,
  SessionStatusKind,
  SoundscapeMetrics,
} from "./acousticFieldTypes";

type Listener = () => void;

const MAX_RECENT_EVENTS = 8;
export const LIVE_AUDIO_SILENCE_THRESHOLD_RMS = 1e-4;

export function isLiveAudioSilent(rms: number, source: AudioSourceKind): boolean {
  return source === "silent" ||
    (source === "microphone" && rms < LIVE_AUDIO_SILENCE_THRESHOLD_RMS);
}

const createInitialAudio = (): AudioMetrics => ({
  rms: 0,
  peak: 0,
  bands: [0, 0, 0, 0],
  spectralCentroid: 0.35,
  temporalFlux: 0,
  sampleRate: 32000,
  channels: 1,
  source: "silent",
  updatedAt: 0,
});

const createInitialSoundscape = (): SoundscapeMetrics => ({
  aci: 0,
  biophony: 0.5,
  anthrophony: 0,
  quietness: 0.85,
});

const createInitialLatency = (): LatencyTelemetry => ({
  captureLatencyMs: null,
  wsLatencyMs: null,
  inferenceLatencyMs: null,
  visualResponseLatencyMs: null,
});

class AcousticDomainStore {
  /**
   * Mutable high-frequency audio state read directly by the 60 FPS WebGL loop.
   * Updating this object MUST NOT trigger React re-renders.
   */
  public readonly liveAudio: AudioMetrics = createInitialAudio();

  /**
   * Mutable latency metrics updated by audio capture, WebSocket, and WebGL loop.
   */
  public readonly liveLatency: LatencyTelemetry = createInitialLatency();

  /**
   * Event queues drained by the WebGL AcousticField state bridge each frame.
   */
  public readonly pendingDetections: DetectionEvent[] = [];
  public readonly pendingDisturbances: DisturbanceEvent[] = [];

  /** Timestamp (performance.now()) when the latest detection/disturbance entered the store. */
  public lastEventIngressAt: number | null = null;

  private snapshot: AcousticDomainSnapshot = {
    audio: createInitialAudio(),
    detections: [],
    disturbances: [],
    soundscape: createInitialSoundscape(),
    session: {
      id: null,
      status: "idle",
      connection: "offline",
      siteName: "COASTAL OLD-GROWTH · SITE 01",
      lastError: null,
    },
    latency: createInitialLatency(),
    activeAnalysisId: null,
    activeAnalysisFilename: null,
    coordinates: {
      latitude: null,
      longitude: null,
      accuracyM: null,
      recordedAt: null,
      gpsStatus: "idle",
      gpsError: null,
    },
    geospatialContext: null,
    ecologicalStatus: "idle",
    ecologicalContext: null,
    expectedBaseline: null,
    ecologicalError: null,
  };

  private listeners = new Set<Listener>();
  private lastQuietState = true;

  /** Mutable packet counters sampled by the UI once per second. */
  public readonly liveTransport = {
    framesSent: 0,
    samplesSent: 0,
    firstFrameSentAt: null as number | null,
    sendTotalMs: 0,
    sendMaxMs: 0,
  };

  public subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public getSnapshot = (): AcousticDomainSnapshot => this.snapshot;

  /**
   * High-frequency audio frame ingress (from AudioWorklet or demo signal).
   * Writes to `liveAudio` without notifying React, except when crossing
   * the discrete silence threshold so UI labels ("LISTENING" / "SILENT") update.
   */
  public pushAudioFrame(
    rms: number,
    peak: number,
    bands: readonly [number, number, number, number],
    spectralCentroid: number,
    temporalFlux: number,
    source: AudioSourceKind,
    sampleRate = 32000,
    captureLatencyMs?: number,
  ): void {
    this.liveAudio.rms = rms;
    this.liveAudio.peak = peak;
    this.liveAudio.bands[0] = bands[0];
    this.liveAudio.bands[1] = bands[1];
    this.liveAudio.bands[2] = bands[2];
    this.liveAudio.bands[3] = bands[3];
    this.liveAudio.spectralCentroid = spectralCentroid;
    this.liveAudio.temporalFlux = temporalFlux;
    this.liveAudio.source = source;
    this.liveAudio.sampleRate = sampleRate;
    this.liveAudio.updatedAt =
      typeof performance !== "undefined" ? performance.now() : Date.now();

    if (typeof captureLatencyMs === "number" && Number.isFinite(captureLatencyMs)) {
      this.liveLatency.captureLatencyMs = Number(captureLatencyMs.toFixed(2));
    }

    const isNowQuiet = isLiveAudioSilent(rms, source);
    if (isNowQuiet !== this.lastQuietState) {
      this.lastQuietState = isNowQuiet;
      this.snapshot = {
        ...this.snapshot,
        audio: {
          ...this.liveAudio,
          bands: [...this.liveAudio.bands] as [number, number, number, number],
        },
        soundscape: {
          ...this.snapshot.soundscape,
          quietness: isNowQuiet ? 0.95 : Math.max(0.05, 1 - rms * 2.2),
        },
        latency: { ...this.liveLatency },
      };
      this.emit();
    }
  }

  public pushDetection(event: DetectionEvent): void {
    this.lastEventIngressAt =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    this.pendingDetections.push(event);
    this.snapshot = {
      ...this.snapshot,
      detections: [event, ...this.snapshot.detections].slice(
        0,
        MAX_RECENT_EVENTS,
      ),
    };
    this.emit();
  }

  public pushDisturbance(event: DisturbanceEvent): void {
    this.lastEventIngressAt =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    this.pendingDisturbances.push(event);
    this.snapshot = {
      ...this.snapshot,
      disturbances: [event, ...this.snapshot.disturbances].slice(
        0,
        MAX_RECENT_EVENTS,
      ),
    };
    this.emit();
  }

  public updateSoundscape(metrics: Partial<SoundscapeMetrics>): void {
    this.snapshot = {
      ...this.snapshot,
      soundscape: { ...this.snapshot.soundscape, ...metrics },
    };
    this.emit();
  }

  public updateLatency(patch: Partial<LatencyTelemetry>, notify = true): void {
    Object.assign(this.liveLatency, patch);
    if (notify) {
      this.snapshot = {
        ...this.snapshot,
        latency: { ...this.liveLatency },
      };
      this.emit();
    }
  }

  public setEcologicalStatus(
    status: EcologicalFetchStatus,
    errorMessage: string | null = null,
  ): void {
    this.snapshot = {
      ...this.snapshot,
      ecologicalStatus: status,
      ecologicalError: status === "ready" ? null : errorMessage,
    };
    this.emit();
  }

  public setEcologicalContext(ctx: EcologicalGapSnapshot | null): void {
    this.snapshot = {
      ...this.snapshot,
      ecologicalStatus: ctx ? "ready" : "unavailable",
      ecologicalContext: ctx,
      geospatialContext: ctx?.geospatial_context ?? this.snapshot.geospatialContext,
      ecologicalError: ctx ? null : this.snapshot.ecologicalError,
    };
    this.emit();
  }

  public setCoordinates(
    latitude: number | null,
    longitude: number | null,
    recordedAt: string | null = null,
    meta?: {
      accuracyM?: number | null;
      gpsStatus?: "idle" | "acquiring" | "available" | "unavailable";
      gpsError?: string | null;
    },
  ): void {
    this.snapshot = {
      ...this.snapshot,
      coordinates: {
        latitude,
        longitude,
        accuracyM: meta?.accuracyM ?? null,
        recordedAt,
        gpsStatus:
          meta?.gpsStatus ??
          (latitude != null && longitude != null ? "available" : "idle"),
        gpsError: meta?.gpsError ?? null,
      },
    };
    this.emit();
  }

  public clearEcologicalForNewLiveSession(): void {
    this.pendingDetections.length = 0;
    this.pendingDisturbances.length = 0;
    this.snapshot = {
      ...this.snapshot,
      detections: [],
      disturbances: [],
      activeAnalysisId: null,
      activeAnalysisFilename: null,
      geospatialContext: null,
      ecologicalStatus: "idle",
      ecologicalContext: null,
      expectedBaseline: null,
      ecologicalError: null,
    };
    this.emit();
  }

  public hydrateFromAnalysis(payload: {
    analysisId: string;
    filename: string;
    siteName: string;
    detections: DetectionEvent[];
    disturbances: DisturbanceEvent[];
    soundscape: Partial<SoundscapeMetrics> | null;
    ecologicalContext: EcologicalGapSnapshot | null;
    expectedBaseline: ExpectedSpeciesBaseline | null;
    geospatialContext: GeospatialContextSummary | null;
    coordinates?: {
      latitude: number | null;
      longitude: number | null;
      accuracyM?: number | null;
      recordedAt: string | null;
    };
  }): void {
    this.pendingDetections.length = 0;
    this.pendingDisturbances.length = 0;
    this.snapshot = {
      ...this.snapshot,
      activeAnalysisId: payload.analysisId,
      activeAnalysisFilename: payload.filename,
      coordinates: payload.coordinates
        ? {
            latitude: payload.coordinates.latitude,
            longitude: payload.coordinates.longitude,
            accuracyM: payload.coordinates.accuracyM ?? null,
            recordedAt: payload.coordinates.recordedAt,
            gpsStatus:
              payload.coordinates.latitude != null &&
              payload.coordinates.longitude != null
                ? "available"
                : "unavailable",
            gpsError: null,
          }
        : this.snapshot.coordinates,
      detections: payload.detections.slice(0, MAX_RECENT_EVENTS),
      disturbances: payload.disturbances.slice(0, MAX_RECENT_EVENTS),
      soundscape: payload.soundscape
        ? { ...this.snapshot.soundscape, ...payload.soundscape }
        : this.snapshot.soundscape,
      session: {
        ...this.snapshot.session,
        siteName: payload.siteName || this.snapshot.session.siteName,
      },
      geospatialContext: payload.geospatialContext,
      ecologicalStatus: payload.ecologicalContext || payload.expectedBaseline ? "ready" : "unavailable",
      ecologicalContext: payload.ecologicalContext,
      expectedBaseline: payload.expectedBaseline,
      ecologicalError: null,
    };
    this.emit();
  }

  public setExpectedBaseline(baseline: ExpectedSpeciesBaseline | null): void {
    this.snapshot = {
      ...this.snapshot,
      expectedBaseline: baseline,
    };
    this.emit();
  }

  public setSessionState(patch: {
    id?: string | null;
    status?: SessionStatusKind;
    connection?: SessionConnectionKind;
    siteName?: string;
    lastError?: string | null;
  }): void {
    const enteringLiveFromDemo =
      patch.connection === "live" && this.snapshot.session.connection === "demo";
    const detections = enteringLiveFromDemo
      ? this.snapshot.detections.filter((event) => !event.isDemo)
      : this.snapshot.detections;
    const disturbances = enteringLiveFromDemo
      ? this.snapshot.disturbances.filter((event) => !event.isDemo)
      : this.snapshot.disturbances;
    if (enteringLiveFromDemo) {
      this.pendingDetections.splice(
        0,
        this.pendingDetections.length,
        ...this.pendingDetections.filter((event) => !event.isDemo),
      );
      this.pendingDisturbances.splice(
        0,
        this.pendingDisturbances.length,
        ...this.pendingDisturbances.filter((event) => !event.isDemo),
      );
    }
    this.snapshot = {
      ...this.snapshot,
      detections,
      disturbances,
      session: {
        ...this.snapshot.session,
        ...patch,
      },
    };
    this.emit();
  }

  public setAudioSource(source: AudioSourceKind): void {
    this.liveAudio.source = source;
    if (source === "silent") {
      this.liveAudio.rms = 0;
      this.liveAudio.peak = 0;
      this.liveAudio.bands = [0, 0, 0, 0];
      this.liveAudio.temporalFlux = 0;
    }
    this.lastQuietState = isLiveAudioSilent(this.liveAudio.rms, source);
    this.snapshot = {
      ...this.snapshot,
      audio: {
        ...this.liveAudio,
        bands: [...this.liveAudio.bands] as [number, number, number, number],
      },
      soundscape: {
        ...this.snapshot.soundscape,
        quietness: source === "silent" ? 1 : 0.35,
      },
      session: {
        ...this.snapshot.session,
        lastError: source === "microphone" ? this.snapshot.session.lastError : null,
      },
    };
    this.emit();
  }

  public recordPcmFrameSent(sampleCount: number, sendDurationMs = 0): void {
    this.liveTransport.framesSent += 1;
    this.liveTransport.samplesSent += sampleCount;
    this.liveTransport.sendTotalMs += sendDurationMs;
    this.liveTransport.sendMaxMs = Math.max(this.liveTransport.sendMaxMs, sendDurationMs);
    if (this.liveTransport.firstFrameSentAt === null) {
      this.liveTransport.firstFrameSentAt = Date.now();
      this.setSessionState({ status: "listening", lastError: null });
    }
  }

  public resetLiveTransport(): void {
    this.liveTransport.framesSent = 0;
    this.liveTransport.samplesSent = 0;
    this.liveTransport.firstFrameSentAt = null;
    this.liveTransport.sendTotalMs = 0;
    this.liveTransport.sendMaxMs = 0;
  }

  public triggerDemoDetection(): void {
    if (this.snapshot.session.connection === "live") return;
    this.setAudioSource("demo");
    this.setSessionState({ connection: "demo", status: "idle" });
    const samples = [
      {
        common: "Varied Thrush",
        scientific: "Ixoreus naevius",
        conf: 0.89,
      },
      {
        common: "Pacific Wren",
        scientific: "Troglodytes pacificus",
        conf: 0.92,
      },
      {
        common: "Hermit Warbler",
        scientific: "Setophaga occidentalis",
        conf: 0.84,
      },
    ];
    const pick = samples[Math.floor(Math.random() * samples.length)];
    const now = Date.now();
    this.pushDetection({
      id: `demo-det-${now}`,
      eventType: "detection",
      sessionId: "demo-session",
      classLabel: pick.common,
      speciesCommon: pick.common,
      speciesScientific: pick.scientific,
      recordType: "animal",
      taxonGroup: "Bird",
      eventSemantics: "window_detection",
      modelScore: pick.conf,
      startSeconds: 0,
      endSeconds: 3,
      receivedAtMs: now,
      visualizationPosition: {
        orbitRad: Math.random() * Math.PI * 2,
        liftRad: (Math.random() - 0.5) * 0.5,
      },
      isDemo: true,
    });
  }

  public triggerDemoDisturbance(): void {
    if (this.snapshot.session.connection === "live") return;
    this.setAudioSource("demo");
    this.setSessionState({ connection: "demo", status: "idle" });
    const now = Date.now();
    this.pushDisturbance({
      id: `demo-dist-${now}`,
      sessionId: "demo-session",
      kind: "anthropogenic",
      intensity: 0.78,
      modelScore: null,
      startSeconds: 0,
      endSeconds: 3.6,
      receivedAtMs: now,
      visualizationPosition: {
        orbitRad: Math.random() * Math.PI * 2,
        liftRad: (Math.random() - 0.5) * 0.35,
      },
      durationMs: 3600,
      isDemo: true,
    });
  }

  public reset(): void {
    this.pendingDetections.length = 0;
    this.pendingDisturbances.length = 0;
    this.lastEventIngressAt = null;
    Object.assign(this.liveAudio, createInitialAudio());
    Object.assign(this.liveLatency, createInitialLatency());
    this.lastQuietState = true;
    this.snapshot = {
      audio: createInitialAudio(),
      detections: [],
      disturbances: [],
      soundscape: createInitialSoundscape(),
      session: {
        id: null,
        status: "idle",
        connection: "offline",
        siteName: "COASTAL OLD-GROWTH · SITE 01",
        lastError: null,
      },
      latency: createInitialLatency(),
      activeAnalysisId: null,
      activeAnalysisFilename: null,
      coordinates: {
        latitude: null,
        longitude: null,
        accuracyM: null,
        recordedAt: null,
        gpsStatus: "idle",
        gpsError: null,
      },
      geospatialContext: null,
      ecologicalStatus: "idle",
      ecologicalContext: null,
      expectedBaseline: null,
      ecologicalError: null,
    };
    this.resetLiveTransport();
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const acousticStore = new AcousticDomainStore();
