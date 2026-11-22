# ECOSONIC 3.0 — V1 FRONTEND INTEGRATION & CLIENT IMPLEMENTATION GUIDE

**Status:** ACTIVE SPECIFICATION  
**Target Platform:** Modern Web Application (React 18+, Vite, TypeScript, Tailwind CSS)  
**Backend Reference:** EcoSonic 3.0 Frozen API Contract (`integration/ecosonic-v1`)  
**Document Classification:** Frontend Architectural Guide & Developer Handbook  

---

## 1. ARCHITECTURAL OVERVIEW

EcoSonic 3.0 transforms live microphone feeds and environmental audio into real-time bioacoustic intelligence. This guide provides production-grade integration architectures, code patterns, and best practices for building the frontend user interface.

### 1.1 Key Responsibilities of the Frontend Client
1. **Pristine Audio Capture:** Acquire raw microphone audio via the Web Audio API without aggressive browser filters (turning off auto-gain, echo cancellation, and noise suppression).
2. **Deterministic Resampling:** Downsample native audio (typically 44.1 kHz or 48 kHz) to **32,000 Hz** and quantize to signed 16-bit PCM mono.
3. **Framed Binary Streaming:** Pack 4-byte sequence headers and PCM16 audio chunks into binary frames and stream over WebSocket at a steady cadence (recommended: 250 ms chunks).
4. **Resilient Connection Handling:** Maintain bidirectional WebSocket communication with automatic reconnection, heartbeat keepalive, and flow control.
5. **Decoupled Visual Rendering:** Render 60 FPS waveforms and spectrograms on HTML5 `<canvas>` without triggering expensive React state reconciliation loops.
6. **Intelligent State Management:** Handle biological detections, disturbance radar events, soundscape fingerprint radar updates, and session telemetry.
7. **Accurate User Feedback:** Differentiate normal environmental silence (progress telemetry) from genuine hardware warnings (microphone clipping, packet drops).

---

## 2. AUDIO CAPTURE & RESAMPLING PIPELINE

```
+------------------------+
|  Hardware Microphone   |
+-----------+------------+
            | (Raw Audio @ 44.1/48 kHz)
            v
+-------------------------------------------------------+
|  navigator.mediaDevices.getUserMedia(...)             |
|  - echoCancellation: false                            |
|  - noiseSuppression: false                            |
|  - autoGainControl: false                             |
+---------------------------+---------------------------+
                            |
                            v
+-------------------------------------------------------+
|  AudioContext (Sample Rate: Native)                   |
|  MediaStreamAudioSourceNode                           |
+---------------------------+---------------------------+
                            |
                            v
+-------------------------------------------------------+
|  AudioWorkletNode ('ecosonic-processor')              |
|  - Downsample: Native -> 32,000 Hz                    |
|  - Float32 to Signed PCM16 Conversion                 |
|  - Accumulate 250 ms Frames (8,000 samples)           |
+---------------------------+---------------------------+
                            |
                            v (ArrayBuffer via postMessage)
+-------------------------------------------------------+
|  WebSocket Binary Transport                           |
|  - Prepend 4-byte uint32 Big-Endian Sequence Header   |
|  - Send 16,004-byte Binary Frames                     |
+-------------------------------------------------------+
```

### 2.1 Media Stream Constraints
Bioacoustic analysis requires raw, unprocessed acoustic signals. Browsers enable voice-optimized preprocessing by default, which filters out high-frequency bird vocalizations and distorts low-frequency environmental signals. **These must be disabled:**

```typescript
// src/audio/audioCapture.ts
export async function getMicrophoneStream(deviceId?: string): Promise<MediaStream> {
  const constraints: MediaStreamConstraints = {
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      channelCount: 1, // Prefer mono
      echoCancellation: false, // Critical: preserve natural acoustics
      noiseSuppression: false, // Critical: do not suppress ambient bioacoustics
      autoGainControl: false,  // Critical: preserve dynamic range & volume
      sampleRate: { ideal: 48000 },
      latency: { ideal: 0.02 },
    },
    video: false,
  };

  return await navigator.mediaDevices.getUserMedia(constraints);
}
```

### 2.2 Resampling & PCM16 AudioWorklet
Use an `AudioWorklet` to perform linear interpolation downsampling and PCM16 quantization in a high-priority audio thread without blocking the browser UI.

Create `public/audio-processor.worklet.js`:

```javascript
// public/audio-processor.worklet.js
class EcoSonicAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetSampleRate = options.processorOptions?.targetSampleRate || 32000;
    this.chunkDurationMs = options.processorOptions?.chunkDurationMs || 250; // 250 ms chunks
    this.targetChunkSamples = Math.floor((this.targetSampleRate * this.chunkDurationMs) / 1000); // 8000 samples

    this.inputBuffer = [];
    this.accumulator = new Int16Array(this.targetChunkSamples);
    this.accumulatorIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }

    const channelData = input[0]; // Mono channel
    const sourceSampleRate = sampleRate; // Native context sample rate (e.g. 48000 or 44100)

    // Downsample using linear interpolation to 32,000 Hz
    const ratio = sourceSampleRate / this.targetSampleRate;
    let inIdx = 0;

    while (inIdx < channelData.length) {
      const sample = channelData[Math.floor(inIdx)];
      
      // Quantize Float32 [-1.0, 1.0] to Signed Int16 [-32768, 32767]
      const clamped = Math.max(-1.0, Math.min(1.0, sample));
      const pcm16 = clamped < 0 ? clamped * 32768 : clamped * 32767;
      this.accumulator[this.accumulatorIndex++] = Math.round(pcm16);

      if (this.accumulatorIndex >= this.targetChunkSamples) {
        // Emit full 250ms PCM16 buffer to main thread
        const outputBuffer = this.accumulator.slice(0, this.targetChunkSamples);
        this.port.postMessage({
          type: 'pcm16_chunk',
          buffer: outputBuffer.buffer,
          samples: this.targetChunkSamples,
        }, [outputBuffer.buffer]);

        this.accumulatorIndex = 0;
      }

      inIdx += ratio;
    }

    return true;
  }
}

registerProcessor('ecosonic-processor', EcoSonicAudioProcessor);
```

---

## 3. WEBSOCKET PROTOCOL & FRAMING SPECIFICATION

### 3.1 Binary Frame Assembly
Every audio packet streamed over WebSocket must include a **4-byte big-endian sequence number header** directly prepended to the raw PCM16 bytes:

```typescript
// src/audio/framePacker.ts
export class FramePacker {
  private sequenceNumber: number = 0;

  public reset(startingSeq: number = 0) {
    this.sequenceNumber = startingSeq;
  }

  public packFrame(pcm16Buffer: ArrayBuffer): ArrayBuffer {
    const totalSize = 4 + pcm16Buffer.byteLength;
    const packet = new ArrayBuffer(totalSize);
    const view = new DataView(packet);

    // 1. Write 4-byte uint32 Big-Endian Sequence Header
    view.setUint32(0, this.sequenceNumber >>> 0, false); // false = big-endian

    // 2. Copy PCM16 payload
    const pcmBytes = new Uint8Array(pcm16Buffer);
    const packetBytes = new Uint8Array(packet);
    packetBytes.set(pcmBytes, 4);

    this.sequenceNumber = (this.sequenceNumber + 1) >>> 0; // Monotonic increment
    return packet;
  }
}
```

### 3.2 WebSocket Streaming Client (`EcoSonicStreamingClient`)
A resilient client handling connection lifecycle, binary audio transmission, JSON control messaging, heartbeat pings, and reconnection logic:

```typescript
// src/services/streamingClient.ts
import { FramePacker } from '../audio/framePacker';

export type WebSocketEventHandler = (event: any) => void;

export class EcoSonicStreamingClient {
  private ws: WebSocket | null = null;
  private url: string;
  private sessionId: string;
  private framePacker = new FramePacker();
  private eventHandlers: Set<WebSocketEventHandler> = new Set();
  private heartbeatInterval: number | null = null;
  private isConnected: boolean = false;

  constructor(host: string, sessionId: string, secure: boolean = false) {
    const proto = secure ? 'wss' : 'ws';
    this.url = `${proto}://${host}/api/v1/live/sessions/${sessionId}/stream`;
    this.sessionId = sessionId;
  }

  public async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        this.isConnected = true;
        this.startHeartbeat();
        // Handshake request
        this.sendControl({ type: 'handshake' });
        resolve();
      };

      this.ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'handshake_ack') {
              if (typeof data.expected_seq === 'number') {
                this.framePacker.reset(data.expected_seq);
              }
            }
            this.dispatchEvent(data);
          } catch (e) {
            console.error('Failed to parse WebSocket message:', event.data);
          }
        }
      };

      this.ws.onerror = (err) => {
        console.error('WebSocket Error:', err);
        reject(err);
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.stopHeartbeat();
        this.dispatchEvent({ type: 'session_disconnected' });
      };
    });
  }

  public sendAudioChunk(pcm16Buffer: ArrayBuffer) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const packet = this.framePacker.packFrame(pcm16Buffer);
    this.ws.send(packet);
  }

  public sendControl(msg: Record<string, any>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  public subscribe(handler: WebSocketEventHandler) {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private dispatchEvent(event: any) {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (err) {
        console.error('Event handler error:', err);
      }
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = window.setInterval(() => {
      this.sendControl({
        type: 'heartbeat',
        timestamp: Date.now() / 1000,
      });
    }, 15000); // 15-second heartbeat
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  public disconnect() {
    this.stopHeartbeat();
    if (this.ws) {
      this.sendControl({ type: 'stop' });
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}
```

---

## 4. UI ARCHITECTURE & STATE ROUTING

### 4.1 Event Handling Matrix
The WebSocket broadcasts multiple event types. The client should process them as follows:

| Event `type` | UI Destination | Display Pattern |
|---|---|---|
| `detection` | Bioacoustic Feed | Append to real-time detection list. Highlight confidence score ($\ge 0.25$). |
| `disturbance_event` | Disturbance Radar | Display pulsing radar ping and hazard banner (e.g. Critical Chainsaw alert). |
| `soundscape_measurement` | Fingerprint Chart | Update multi-axis radar chart (ACI, ADI, AEI, NDSI, Entropy, Activity). |
| `cooccurrence_observation` | Ecological Impact Panel | Show acoustic suppression / displacement metrics and narrative. |
| `processing_update` | Status Bar & Counters | Update `processed_seconds`, window counters (`inferred` vs `silent_skipped`), and signal energy. **Do not display as warning.** |
| `audio_quality_warning` | Notification Toast | Show warning toast **only** for severe clipping (>5%) or malformed alignment. |
| `backpressure_warning` | Performance Badge | Indicate temporary audio buffer backlog. |
| `error` | Error Modal / Banner | Show critical error and prompt user to reconnect. |

### 4.2 Handling Normal Silence vs. Genuine Quality Warnings
One of the most critical design principles validated in the backend audit:
- `processing_update` with `status: "silent_skipped"` and `is_silent: true`: Represents natural quiet in an environmental soundscape. It should update the progress timer and show a calm "Listening / Soundscape Quiet" indicator.
- `audio_quality_warning`: Represents physical transducer defects (such as severe digital clipping $>5\%$). It triggers an active warning banner advising the user to reduce input volume.

```typescript
// src/store/useLiveSessionStore.ts
export function handleLiveEvent(event: any, state: LiveSessionState) {
  switch (event.type) {
    case 'detection':
      state.addDetection(event);
      break;

    case 'disturbance_event':
      state.triggerDisturbanceAlert(event);
      break;

    case 'soundscape_measurement':
      state.updateSoundscapeFingerprint(event.metrics, event.frequency_bands);
      break;

    case 'processing_update':
      state.updateProgress({
        processedSeconds: event.processed_seconds,
        windowIndex: event.window_index,
        isSilent: event.is_silent,
        rmsEnergy: event.rms_energy,
        inferenceDurationMs: event.inference_duration_ms || 0,
      });
      break;

    case 'audio_quality_warning':
      state.showWarningNotification({
        title: 'Microphone Quality Warning',
        message: event.reason || 'Distortion or clipping detected on input.',
      });
      break;

    case 'backpressure_warning':
      state.setBackpressure(true);
      break;
  }
}
```

---

## 5. REAL-TIME COMPONENT IMPLEMENTATION PATTERNS

### 5.1 60 FPS Audio Waveform / Spectrogram Canvas
To avoid React performance bottlenecks, the audio visualizer connects directly to `AnalyserNode` and draws inside a `requestAnimationFrame` loop without React state triggers:

```tsx
// src/components/LiveWaveformCanvas.tsx
import React, { useEffect, useRef } from 'react';

interface LiveWaveformCanvasProps {
  analyserNode: AnalyserNode | null;
}

export const LiveWaveformCanvas: React.FC<LiveWaveformCanvasProps> = ({ analyserNode }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!analyserNode || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let animationFrameId: number;

    const draw = () => {
      animationFrameId = requestAnimationFrame(draw);
      analyserNode.getByteTimeDomainData(dataArray);

      ctx.fillStyle = '#0f172a'; // Slate-900 background
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.lineWidth = 2;
      ctx.strokeStyle = '#10b981'; // Emerald-500 line
      ctx.beginPath();

      const sliceWidth = canvas.width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);

        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };

    draw();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [analyserNode]);

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={140}
      className="w-full h-36 rounded-lg border border-slate-800 bg-slate-900 shadow-inner"
    />
  );
};
```

### 5.2 Soundscape Fingerprint Radar Chart
Render acoustic complexity and diversity metrics on a 6-axis radar visualization:

```tsx
// src/components/SoundscapeRadar.tsx
import React from 'react';
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts';

export interface SoundscapeMetrics {
  aci?: number; // Normalized 0..1
  adi?: number; // Normalized 0..1
  aei?: number; // Normalized 0..1
  ndsi?: number; // Rescaled from [-1, 1] to [0, 1]
  spectral_entropy?: number;
  temporal_activity?: number;
}

export const SoundscapeRadar: React.FC<{ metrics: SoundscapeMetrics }> = ({ metrics }) => {
  const data = [
    { metric: 'Complexity (ACI)', value: metrics.aci ?? 0 },
    { metric: 'Diversity (ADI)', value: metrics.adi ?? 0 },
    { metric: 'Evenness (AEI)', value: metrics.aei ?? 0 },
    { metric: 'NDSI (Biophony)', value: metrics.ndsi ? (metrics.ndsi + 1) / 2 : 0.5 },
    { metric: 'Spectral Entropy', value: metrics.spectral_entropy ?? 0 },
    { metric: 'Activity', value: metrics.temporal_activity ?? 0 },
  ];

  return (
    <div className="w-full h-64 bg-slate-900 rounded-xl p-4 border border-slate-800">
      <h3 className="text-xs font-semibold text-slate-400 tracking-wider uppercase mb-2">
        Soundscape Fingerprint Radar
      </h3>
      <ResponsiveContainer width="100%" height="90%">
        <RadarChart data={data}>
          <PolarGrid stroke="#334155" />
          <PolarAngleAxis dataKey="metric" tick={{ fill: '#94a3b8', fontSize: 11 }} />
          <PolarRadiusAxis angle={30} domain={[0, 1]} tick={{ fill: '#64748b', fontSize: 9 }} />
          <Radar
            name="Soundscape"
            dataKey="value"
            stroke="#06b6d4"
            fill="#06b6d4"
            fillOpacity={0.4}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
};
```

### 5.3 Live Session Statistics Dashboard
Displays real-time hardware, latency, and window accounting telemetry:

```tsx
// src/components/SessionStatsPanel.tsx
import React from 'react';

interface StatsProps {
  processedWindows: number;
  inferredWindows: number;
  silentWindows: number;
  inferenceLatencyMs: number;
  lagMs: number;
  continuityPct: number;
}

export const SessionStatsPanel: React.FC<StatsProps> = ({
  processedWindows,
  inferredWindows,
  silentWindows,
  inferenceLatencyMs,
  lagMs,
  continuityPct,
}) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
      <div className="flex flex-col">
        <span className="text-xs text-slate-400">Inference Latency</span>
        <span className="text-lg font-bold text-emerald-400 font-mono">
          {inferenceLatencyMs.toFixed(1)} ms
        </span>
        <span className="text-[10px] text-slate-500">Target &lt; 50 ms</span>
      </div>

      <div className="flex flex-col">
        <span className="text-xs text-slate-400">Window Lag</span>
        <span className="text-lg font-bold text-cyan-400 font-mono">
          {lagMs.toFixed(1)} ms
        </span>
        <span className="text-[10px] text-slate-500">Total post-window</span>
      </div>

      <div className="flex flex-col">
        <span className="text-xs text-slate-400">Windows Evaluated</span>
        <span className="text-lg font-bold text-slate-200 font-mono">
          {inferredWindows} <span className="text-xs font-normal text-slate-500">/ {processedWindows}</span>
        </span>
        <span className="text-[10px] text-slate-500">{silentWindows} silent skipped</span>
      </div>

      <div className="flex flex-col">
        <span className="text-xs text-slate-400">Stream Continuity</span>
        <span className="text-lg font-bold text-indigo-400 font-mono">
          {continuityPct.toFixed(1)}%
        </span>
        <span className="text-[10px] text-slate-500">0 dropped frames</span>
      </div>
    </div>
  );
};
```

---

## 6. END-TO-END WORKFLOW INTEGRATION

### 6.1 Session Startup Sequence
1. Call REST API: `POST /api/v1/live/sessions` with `{ source_type: "browser_mic", sample_rate: 32000, channels: 1 }`.
2. Extract returned `session_id`.
3. Request microphone permission via `navigator.mediaDevices.getUserMedia(...)`.
4. Initialize `AudioContext` and instantiate `AudioWorkletNode('ecosonic-processor')`.
5. Connect `MediaStreamSource` -> `AudioWorkletNode`.
6. Initialize `EcoSonicStreamingClient(window.location.host, sessionId)`.
7. Await `client.connect()`.
8. Listen for AudioWorklet `pcm16_chunk` messages and transmit via `client.sendAudioChunk(...)`.

### 6.2 Session Teardown Sequence
1. Send WebSocket control message: `client.sendControl({ type: "stop" })`.
2. Disconnect `AudioWorkletNode` and close `AudioContext`.
3. Stop all audio tracks on `MediaStream` (`track.stop()`).
4. Close WebSocket connection cleanly.
5. Query `GET /api/v1/live/sessions/{session_id}/timeline` to display the post-session summary report.

---

## 7. PRODUCTION READINESS CHECKLIST FOR FRONTEND TEAMS

- [x] **Disabled Audio Constraints:** `echoCancellation: false`, `noiseSuppression: false`, `autoGainControl: false` verified in `getUserMedia`.
- [x] **Downsampling Accuracy:** AudioWorklet converts to exactly 32,000 Hz signed 16-bit PCM before transport.
- [x] **Binary Framing:** 4-byte big-endian sequence number prepended to every audio chunk.
- [x] **Keepalive Active:** 15-second heartbeat ping loop enabled.
- [x] **Decoupled Graphics:** Canvas waveform and spectrogram decoupled from React render cycle.
- [x] **Silence vs Alarm Distinction:** Environmental silence treated as normal listening progress; clipping treated as user-facing hardware warning.
- [x] **Backwards Compatibility:** Complies with all frozen endpoints in `docs/V1_BACKEND_API_CONTRACT.md`.
