import { acousticStore } from "../domain/acousticStore";
import type { DetectionEvent, DisturbanceEvent } from "../domain/acousticFieldTypes";
import { loadAnalysisIntoStore, setUrlAnalysisId } from "./ecosonicEcologyApi";

/**
 * Frozen ECOsonic FastAPI WebSocket protocol adapter:
 * 1. POST /api/v1/live/sessions -> { id }
 * 2. WS /api/v1/live/sessions/{sessionId}/stream
 * 3. JSON control: handshake -> handshake_ack -> start -> 15s heartbeat
 * 4. Binary PCM16 frames: 4-byte big-endian uint32 seq (>I) + mono 32kHz Int16 (<i2)
 *
 * Demo rendering is controlled separately. A missing or unreachable backend is offline.
 */
export interface EcosonicSocketOptions {
  apiBaseUrl?: string;
  wsBaseUrl?: string;
}

export interface BackendDetectionMessage {
  type: "detection";
  session_id: string;
  event_id?: string;
  start_seconds: number;
  end_seconds: number;
  class_label: string;
  scientific_name?: string;
  common_name?: string;
  confidence_score: number;
  record_type: "animal" | "sound_class";
  event_semantics: "window_detection";
  taxon_group?: string | null;
}

type BackendMessage =
  | {
      type: "handshake_ack";
      session_id: string;
      status: string;
      sample_rate: number;
      channels: number;
      expected_seq: number;
    }
  | {
      type: "heartbeat_ack";
      timestamp: number;
    }
  | BackendDetectionMessage
  | {
      type: "disturbance_event" | "disturbance_detected" | "disturbance_updated";
      session_id: string;
      event_id?: string;
      event_type?: string;
      class_label?: string;
      category?: string;
      hazard_classification?: string;
      start_seconds: number;
      end_seconds: number;
      confidence_score?: number;
    }
  | {
      type: "soundscape_measurement";
      session_id: string;
      measurement_id?: string;
      metrics?: {
        aci?: number;
        biophony_ratio?: number;
        anthrophony_ratio?: number;
        quietness_index?: number;
      };
    }
  | {
      type: "processing_update";
      session_id: string;
      status: string;
      inference_duration_ms?: number;
      window_lag_ms?: number;
      is_silent?: boolean;
    }
  | {
      type: "audio_quality_warning";
      reason?: string;
    }
  | {
      type: "session_stopped";
      session_id: string;
    }
  | {
      type: "error";
      code?: string;
      message?: string;
    };

/** Stable rendering parameter only; this does not estimate acoustic location. */
function visualizationPosition(seed: string): { orbitRad: number; liftRad: number } {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const value = h >>> 0;
  return {
    orbitRad: (value % 6283) / 1000,
    liftRad: ((((value >>> 12) % 1000) / 999) - 0.5) * 0.5,
  };
}

export function mapBackendDetection(
  msg: BackendDetectionMessage,
  receivedAtMs = Date.now(),
): DetectionEvent {
  return {
    id: msg.event_id ?? `live-det-${receivedAtMs}`,
    eventType: msg.type,
    sessionId: msg.session_id,
    classLabel: msg.class_label,
    speciesCommon: msg.common_name || msg.class_label,
    speciesScientific: msg.scientific_name || msg.class_label,
    recordType: msg.record_type,
    taxonGroup: msg.taxon_group ?? null,
    eventSemantics: msg.event_semantics,
    modelScore: msg.confidence_score,
    startSeconds: msg.start_seconds,
    endSeconds: msg.end_seconds,
    receivedAtMs,
    visualizationPosition: visualizationPosition(msg.event_id ?? msg.class_label),
    isDemo: false,
  };
}

/** Construct 4-byte big-endian uint32 seq (>I) + signed Int16 (<i2) binary frame. */
export function encodePcm16Frame(seq: number, pcmSamples: Int16Array): ArrayBuffer {
  const buffer = new ArrayBuffer(4 + pcmSamples.length * 2);
  const view = new DataView(buffer);
  view.setUint32(0, seq >>> 0, false);
  for (let i = 0; i < pcmSamples.length; i++) {
    view.setInt16(4 + i * 2, pcmSamples[i], true);
  }
  return buffer;
}

export class EcosonicSocketClient {
  private socket: WebSocket | null = null;
  private sessionId: string | null = null;
  private seqNum = 0;
  private connectGen = 0;
  private heartbeatTimer: number | null = null;
  private pendingHeartbeatSentAt: number | null = null;
  private connectResolver: (() => void) | null = null;
  private connectRejecter: ((error: Error) => void) | null = null;
  private stopResolver: (() => void) | null = null;
  private disconnecting = false;
  private readonly apiBaseUrl: string | undefined;
  private readonly wsBaseUrl: string | undefined;
  private activeApiBaseUrl: string | undefined;

  constructor(options: EcosonicSocketOptions = {}) {
    this.apiBaseUrl =
      options.apiBaseUrl ??
      (import.meta.env.VITE_ECOSONIC_API_URL as string | undefined);
    this.wsBaseUrl =
      options.wsBaseUrl ??
      (import.meta.env.VITE_ECOSONIC_WS_URL as string | undefined);
  }

  private getEffectiveApiBase(): string | undefined {
    if (this.apiBaseUrl) return this.apiBaseUrl.replace(/\/$/, "");
    if (typeof window !== "undefined" && window.location?.origin) {
      return window.location.origin.replace(/\/$/, "");
    }
    return undefined;
  }

  private resolveWsBase(httpBaseOverride?: string): string | null {
    if (this.wsBaseUrl && !httpBaseOverride) return this.wsBaseUrl.replace(/\/$/, "");
    const base = (httpBaseOverride ?? this.activeApiBaseUrl ?? this.getEffectiveApiBase())?.replace(/\/$/, "");
    if (!base) return null;
    if (base.startsWith("https://")) return `wss://${base.slice(8)}`;
    if (base.startsWith("http://")) return `ws://${base.slice(7)}`;
    return null;
  }

  public async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    const primaryApiBase = this.getEffectiveApiBase();
    const primaryWsBase = this.resolveWsBase(primaryApiBase);
    if (!primaryApiBase || !primaryWsBase) {
      const error = new Error("Live API URL is not configured; live classification is unavailable.");
      acousticStore.setSessionState({
        connection: "offline",
        status: "error",
        lastError: error.message,
      });
      throw error;
    }

    const gen = ++this.connectGen;
    this.disconnecting = false;
    let sid: string | null = null;
    let resolvedApiBase = primaryApiBase;
    acousticStore.resetLiveTransport();
    acousticStore.clearEcologicalForNewLiveSession();

    try {
      const coords = acousticStore.getSnapshot().coordinates;
      const sessionBody: Record<string, unknown> = {
        source_type: "browser_mic",
        sample_rate: 32000,
        channels: 1,
      };
      if (
        typeof coords.latitude === "number" &&
        Number.isFinite(coords.latitude) &&
        typeof coords.longitude === "number" &&
        Number.isFinite(coords.longitude)
      ) {
        sessionBody.latitude = coords.latitude;
        sessionBody.longitude = coords.longitude;
        if (
          typeof coords.accuracyM === "number" &&
          Number.isFinite(coords.accuracyM) &&
          coords.accuracyM >= 0
        ) {
          sessionBody.gps_accuracy_m = coords.accuracyM;
        }
        if (coords.recordedAt) {
          sessionBody.gps_captured_at = coords.recordedAt;
        }
      }

      const postSession = async (base: string) =>
        fetch(`${base}/api/v1/live/sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sessionBody),
        });

      let res: Response;
      try {
        res = await postSession(resolvedApiBase);
      } catch (networkErr) {
        const sameOrigin =
          typeof window !== "undefined" && window.location?.origin
            ? window.location.origin.replace(/\/$/, "")
            : null;
        if (sameOrigin && sameOrigin !== resolvedApiBase) {
          try {
            res = await postSession(sameOrigin);
            resolvedApiBase = sameOrigin;
          } catch (fallbackErr) {
            const detail =
              fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
            throw new Error(
              `Cannot reach ECOsonic backend at ${primaryApiBase}/api/v1/live/sessions or ${sameOrigin}/api/v1/live/sessions (${detail}). Ensure FastAPI is running on port 8000.`,
            );
          }
        } else {
          const detail = networkErr instanceof Error ? networkErr.message : String(networkErr);
          throw new Error(
            `Cannot reach ECOsonic backend at ${resolvedApiBase}/api/v1/live/sessions (${detail}). Ensure FastAPI is running on port 8000.`,
          );
        }
      }

      this.activeApiBaseUrl = resolvedApiBase;
      const wsBase = this.resolveWsBase(resolvedApiBase);
      if (!wsBase) {
        throw new Error(`Unable to derive WebSocket URL from ${resolvedApiBase}.`);
      }

      if (!res.ok) {
        throw new Error(`Session creation returned HTTP ${res.status}: ${await res.text()}`);
      }
      const created = (await res.json()) as { id: string };
      if (gen !== this.connectGen) {
        await fetch(
          `${resolvedApiBase}/api/v1/live/sessions/${created.id}/stop`,
          { method: "POST" },
        ).catch(() => {});
        throw new Error("Live connection was cancelled before it opened.");
      }
      sid = created.id;
      this.sessionId = sid;
      acousticStore.setSessionState({ id: sid, status: "idle" });

      const ws = new WebSocket(`${wsBase}/api/v1/live/sessions/${sid}/stream`);
      ws.binaryType = "arraybuffer";
      this.socket = ws;

      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          this.connectResolver = null;
          this.connectRejecter = null;
          reject(new Error("Timed out waiting for the live WebSocket handshake."));
        }, 10000);
        this.connectResolver = () => {
          window.clearTimeout(timeout);
          this.connectResolver = null;
          this.connectRejecter = null;
          resolve();
        };
        this.connectRejecter = (error) => {
          window.clearTimeout(timeout);
          this.connectResolver = null;
          this.connectRejecter = null;
          reject(error);
        };

        ws.onopen = () => {
          this.seqNum = 0;
          ws.send(JSON.stringify({ type: "handshake" }));
        };
        ws.onmessage = (event) => {
          if (typeof event.data !== "string") return;
          try {
            this.handleMessage(JSON.parse(event.data) as BackendMessage);
          } catch {
            // Ignore malformed JSON frames without blocking the render loop.
          }
        };
        ws.onerror = () => this.connectRejecter?.(new Error("Backend WebSocket connection failed."));
        ws.onclose = () => {
          this.stopHeartbeat();
          if (this.socket === ws) this.socket = null;
          this.connectRejecter?.(new Error("Backend WebSocket closed before handshake completed."));
          acousticStore.setSessionState(
            this.disconnecting
              ? { connection: "offline", status: "idle" }
              : {
                  connection: "offline",
                  status: "error",
                  lastError: "Backend WebSocket closed; live classification stopped.",
                },
          );
        };
      });
    } catch (err) {
      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }
      this.stopHeartbeat();
      if (sid) {
        const stopBase = this.activeApiBaseUrl ?? this.getEffectiveApiBase();
        if (stopBase) {
          await fetch(
            `${stopBase}/api/v1/live/sessions/${sid}/stop`,
            { method: "POST" },
          ).catch(() => {});
        }
      }
      this.sessionId = null;
      acousticStore.setSessionState({
        connection: "offline",
        status: "error",
        lastError: err instanceof Error ? err.message : "Backend connection failed.",
      });
      throw err;
    }
  }

  private handleMessage(msg: BackendMessage): void {
    if (msg.type === "handshake_ack") {
      if (msg.sample_rate !== 32000 || msg.channels !== 1) {
        this.connectRejecter?.(
          new Error("Backend handshake did not confirm mono 32 kHz PCM16."),
        );
        return;
      }
      this.seqNum = msg.expected_seq ?? 0;
      acousticStore.setSessionState({
        id: msg.session_id,
        connection: "live",
        status: "idle",
        lastError: null,
      });
      this.socket?.send(JSON.stringify({ type: "start" }));
      if (this.socket) {
        this.sendHeartbeat(this.socket);
        this.startHeartbeat();
      }
      this.connectResolver?.();
      return;
    }

    if (msg.type === "session_stopped") {
      acousticStore.setSessionState({
        connection: "offline",
        status: "idle",
      });
      this.stopResolver?.();
      return;
    }

    if (msg.type === "heartbeat_ack") {
      if (this.pendingHeartbeatSentAt !== null) {
        const rtt = Math.max(0, performance.now() - this.pendingHeartbeatSentAt);
        this.pendingHeartbeatSentAt = null;
        acousticStore.updateLatency({ wsLatencyMs: Number(rtt.toFixed(2)) }, true);
      }
      return;
    }

    if (msg.type === "detection") {
      acousticStore.pushDetection(mapBackendDetection(msg));
      return;
    }

    if (
      msg.type === "disturbance_event" ||
      msg.type === "disturbance_detected" ||
      msg.type === "disturbance_updated"
    ) {
      const cat = (msg.category ?? "anthropogenic").toLowerCase();
      const kind: DisturbanceEvent["kind"] =
        cat.includes("mech")
          ? "mechanical"
          : cat.includes("wind")
            ? "wind-shear"
            : cat.includes("anthro") ||
                cat.includes("human") ||
                cat.includes("cultural") ||
                cat.includes("hazard")
              ? "anthropogenic"
              : "unknown";
      const durMs = Math.max(
        2400,
        Math.round((msg.end_seconds - msg.start_seconds) * 1000) || 3600,
      );
      acousticStore.pushDisturbance({
        id: msg.event_id ?? `live-dist-${Date.now()}`,
        sessionId: msg.session_id,
        kind,
        // Constant visual impulse; the score remains separate and is never used as intensity.
        intensity: 0.6,
        modelScore: typeof msg.confidence_score === "number" ? msg.confidence_score : null,
        startSeconds: msg.start_seconds,
        endSeconds: msg.end_seconds,
        receivedAtMs: Date.now(),
        visualizationPosition: visualizationPosition(msg.event_id ?? msg.class_label ?? kind),
        durationMs: durMs,
        isDemo: false,
      });
      return;
    }

    if (msg.type === "soundscape_measurement" && msg.metrics) {
      acousticStore.updateSoundscape({
        aci: msg.metrics.aci ?? acousticStore.getSnapshot().soundscape.aci,
        biophony:
          msg.metrics.biophony_ratio ??
          acousticStore.getSnapshot().soundscape.biophony,
        anthrophony:
          msg.metrics.anthrophony_ratio ??
          acousticStore.getSnapshot().soundscape.anthrophony,
        quietness:
          msg.metrics.quietness_index ??
          acousticStore.getSnapshot().soundscape.quietness,
      });
      return;
    }

    if (msg.type === "processing_update") {
      if (typeof msg.inference_duration_ms === "number") {
        acousticStore.updateLatency(
          { inferenceLatencyMs: Number(msg.inference_duration_ms.toFixed(2)) },
          true,
        );
      }
      return;
    }

    if (msg.type === "audio_quality_warning" && msg.reason) {
      acousticStore.setSessionState({ lastError: msg.reason });
    } else if (msg.type === "error" && msg.message) {
      this.connectRejecter?.(new Error(msg.message));
      acousticStore.setSessionState({ lastError: msg.message });
    }
  }

  private sendHeartbeat(ws: WebSocket): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    this.pendingHeartbeatSentAt = performance.now();
    ws.send(
      JSON.stringify({
        type: "heartbeat",
        timestamp: Date.now() / 1000,
      }),
    );
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.socket) {
        this.sendHeartbeat(this.socket);
      }
    }, 10000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  public sendPcm16Chunk(pcmSamples: Int16Array): boolean {
    if (pcmSamples.length !== 8000) {
      acousticStore.setSessionState({
        status: "error",
        lastError: `Live PCM frame must contain 8,000 samples; received ${pcmSamples.length}.`,
      });
      return false;
    }
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    const frame = encodePcm16Frame(this.seqNum, pcmSamples);
    const sendStartedAt = performance.now();
    this.socket.send(frame);
    const sendDurationMs = performance.now() - sendStartedAt;
    this.seqNum = (this.seqNum + 1) >>> 0;
    acousticStore.recordPcmFrameSent(pcmSamples.length, sendDurationMs);
    return true;
  }

  public async disconnect(): Promise<void> {
    this.connectGen += 1;
    this.disconnecting = true;
    this.stopHeartbeat();
    const ws = this.socket;
    const sid = this.sessionId;
    let stoppedAck = false;
    if (ws?.readyState === WebSocket.OPEN) {
      stoppedAck = await new Promise<boolean>((resolve) => {
        const timer = window.setTimeout(() => {
          this.stopResolver = null;
          resolve(false);
        }, 5000);
        this.stopResolver = () => {
          window.clearTimeout(timer);
          this.stopResolver = null;
          resolve(true);
        };
        try {
          ws.send(JSON.stringify({ type: "stop" }));
        } catch {
          window.clearTimeout(timer);
          this.stopResolver = null;
          resolve(false);
        }
      });
    }
    ws?.close();
    this.socket = null;
    let finalizedAnalysisId: string | null = null;
    const activeBase = this.activeApiBaseUrl ?? this.getEffectiveApiBase();
    if (sid && activeBase) {
      try {
        const stopRes = await fetch(
          `${activeBase}/api/v1/live/sessions/${sid}/stop`,
          { method: "POST" },
        );
        if (stopRes.ok) {
          const stoppedJson = (await stopRes.json()) as {
            analysis_id?: string | null;
          };
          finalizedAnalysisId = stoppedJson?.analysis_id ?? null;
        }
      } catch {
        // ignore cleanup network errors
      }
    }
    this.sessionId = null;
    acousticStore.setSessionState({
      id: null,
      connection: "offline",
      status: "idle",
    });
    if (finalizedAnalysisId && activeBase) {
      await loadAnalysisIntoStore(finalizedAnalysisId, {
        apiBaseUrl: activeBase,
        updateUrl: true,
      });
    } else if (sid && !stoppedAck) {
      setUrlAnalysisId(null);
    }
  }
}

export const ecosonicSocket = new EcosonicSocketClient();
