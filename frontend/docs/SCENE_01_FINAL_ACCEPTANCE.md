# ECOsonic 3.0 — Scene 01 Final Acceptance Gate (`ACT 06 — ACOUSTIC FIELD`)

**Date:** 2026-11-25  
**Scope:** Final acceptance gate for Visual Foundation + Scene 01 (`ACOUSTIC FIELD`) only.  
**Backend Verified Against:** `C:\Users\apaar\Desktop\ECOBIRDS\backend` (`FastAPI 3.0.0`, `BirdNET+ V3.0` ONNX `GPU` / `CUDAExecutionProvider`).

---

## 1. Visual Inspection Results

Inspected real rendered screenshots in headless Chrome across all four required viewports and all five acoustic states (`docs/screenshots/scene01-1440x900.png`, `scene01-1920x1080.png`, `scene01-390x844.png`, `scene01-412x915.png`, `scene01-1440x900-events.png`, `scene01-1440x900-silence.png`, `scene01-1440x900-live.png`):

- **Aesthetic & Identity:** Reads as a restrained documentary/scientific instrument (`#060708` obsidian canvas, subtle deep moss `#1D3327` / bark umber `#3A2D24` / muted slate `#7C8582` / parchment `#E8E4DC` / oxidized ochre `#C86D3B` palette, no neon, no glassmorphism, no SaaS cards).
- **Visual Hierarchy (Explicit 4-Tier Eye Path):**
  1. **Primary:** `Acoustic Field` (`Instrument Serif`, `clamp(2.75rem, 5.8vw, 5.25rem)`)
  2. **Secondary:** `EVERY SOUND LEAVES A TRACE.`
  3. **Tertiary:** `OBSERVATION ACTIVE · FREQUENCY STRATA` / `FIELD SETTLED · AWAITING ACOUSTIC ENERGY`, `CURRENT OBSERVATION`, and `LISTENING / SILENT · LIVE / DEMO SIGNAL · 32 KHZ · MONO`
  4. **Ephemeral:** Transient `DETECTION TRACE` / `ACOUSTIC DISTURBANCE` annotations and camera-facing spatial trace ring
- **Acoustic Geometry & State Continuity:**
  - **State A (`No acoustic energy`):** Settled obsidian/slate field, damped trajectories, `SILENT` / `FIELD SETTLED`.
  - **State B (`Live acoustic activity`):** Organic breathing across 4 ecological frequency strata with anisotropic shell distribution and eccentric `LineLoop` strata.
  - **State C (`Bird detection`):** Localized spatial pulse + parchment ring + ephemeral trace annotation anchored to detection azimuth/elevation.
  - **State D (`Disturbance detection`):** Localized trajectory perturbation + oxidized ochre shift + non-alarmist annotation (`ANTHROPOGENIC`).
  - **State E (`Return to silence`):** Confirmed in `scene01-1440x900-silence.png` that both UI trace labels and the WebGL ochre disturbance ring settle cleanly (`4.5/s` exponential decay in `SILENCE`).

---

## 2. Backend Integration Results

Verified end-to-end against the unmodified `ECOBIRDS` FastAPI + BirdNET+ V3.0 ONNX backend via `scripts/validate-live-integration.mjs`:

- **Pipeline:** `Browser AudioWorklet` → `BandLimitedResampler` (31-tap Blackman-windowed sinc FIR to exact `32,000 Hz` mono) → `floatToPcm16` (`<i2`) → `encodePcm16Frame` (4-byte big-endian `uint32` sequence header `>I` + PCM16) → `POST /api/v1/live/sessions` (`source_type: "browser_mic"`) → `WS /api/v1/live/sessions/{id}/stream` → `FastAPI` → `BirdNET ONNX (GPU)` → `acousticStore` → `AcousticField` WebGL uniforms.
- **Observed Live Session Metrics (`audio_mono_32k.wav` via fake media stream):**
  - `27` binary PCM16 frames streamed (`5` JSON control/heartbeat frames)
  - Events received & processed: `handshake_ack`, `session_started`, `heartbeat_ack`, `detection`, `processing_update`, `disturbance_detected`
  - `0` console errors, `0` page errors, `demoControlsPresentInLive: false` (`+ TRACE` / `+ DISTURBANCE` cleanly hidden in `LIVE` mode)

---

## 3. Physical Microphone Result

- **Hardware Device Probed:** `Microphone Array (Realtek(R) Audio)` (`Default` and `Communications` endpoints enumerated in headless Chrome).
- **Steps 1–6 Verified Live:** Browser mic permission (`--use-fake-ui-for-media-stream`), actual Realtek device capture, `AudioWorklet` live capture (`captureLatencyMs: 4.00 ms`), `32 kHz` mono conversion, WebSocket streaming (`wsLatencyMs: 62.30 ms`), and BirdNET ONNX inference (`inferenceLatencyMs: 85.64 ms`, `MIC LIVE` active).
- **Caveat on Steps 7–8:** Because the physical room was quiet ambient indoor audio during the automated run with no wild bird vocalization in front of the microphone, no live detection event fired from the physical mic itself; detection and disturbance visual responses (`visualResponseLatencyMs: 4.70 ms`) were verified using the real bioacoustic `audio_mono_32k.wav` stream through the exact same `AudioWorklet` → `WebSocket` → `BirdNET ONNX` path.

---

## 4. Latency Measurements (Separated)

Measured via `scripts/validate-live-integration.mjs` during live streaming & BirdNET ONNX GPU inference:

| Stage | Metric | Measured |
|---|---|---|
| **A. Audio capture latency** | `captureLatencyMs` (`AudioWorklet` → `acousticStore`) | **`4.00 ms`** |
| **B. WebSocket latency** | `wsLatencyMs` (`heartbeat` → `heartbeat_ack` RTT) | **`86.90 ms`** (WAV stream) / **`62.30 ms`** (physical mic) |
| **C. Inference latency** | `inferenceLatencyMs` (BirdNET ONNX GPU window) | **`78.39 ms`** (WAV stream) / **`85.64 ms`** (physical mic) |
| **D. Visual response latency** | `visualResponseLatencyMs` (event ingress → WebGL frame) | **`4.70 ms`** |

---

## 5. Performance Measurements (During Active Backend Inference)

Sampled across `995` consecutive `requestAnimationFrame` ticks while FastAPI + BirdNET ONNX processed incoming 3-second audio windows (`scripts/validate-live-integration.mjs`):

- **Median FPS:** `144.9 FPS`
- **Minimum / worst observed FPS:** `35.6 FPS` (`maxFrameTimeMs: 28.10 ms`, single GC/compositor frame during 7 s run)
- **p95 frame time:** `7.20 ms`
- **Draw calls:** `10` (with active spatial event ring; `9` baseline)
- **WebGL contexts / canvases:** `1`
- **Particle count:** `9,000` (Desktop) / `5,400` (Tablet) / `3,000` (Mobile)
- **Console / page errors:** `0`
- **Context loss:** `false`
- **Horizontal overflow:** `false`

---

## 6. Responsive Results

Verified via `scripts/validate-scene01.mjs`:

| Viewport | Canvases | FPS | Draw Calls | Points | Lines | Overflow X | Errors |
|---|---|---|---|---|---|---|---|
| `1440×900` | `1` | `144` | `9` | `9,000` | `896` | `false` | `0` |
| `1920×1080` | `1` | `144` | `9` | `9,000` | `896` | `false` | `0` |
| `390×844` | `1` | `144` | `6` | `3,000` | `288` | `false` | `0` |
| `412×915` | `1` | `144` | `6` | `3,000` | `288` | `false` | `0` |

---

## 7. Reduced-Motion Result

Verified with `reducedMotion: "reduce"` in Playwright:
- `window.matchMedia("(prefers-reduced-motion: reduce)").matches === true`
- Orbital rotation, pointer scatter, and parallax are damped/disabled while the static spatial field, frequency strata, and all telemetry remain visible and functional (`144 FPS`, `1` canvas, `0` errors).

---

## 8. Technical Debt & Residue Audit

- **`src/` audit:** Zero `console.log`/`warn`/`error`, zero `TODO`/`FIXME`, zero `@ts-ignore`, single `WebGLStage`, single rAF loop.
- **Fixes applied during this gate:**
  1. Accelerated silence decay (`4.5/s`) in `acousticFieldState.ts` so disturbance rings clear promptly in `SILENCE`.
  2. Gated `+ TRACE` and `+ DISTURBANCE` demo controls in `EditorialShell.tsx` to `connection !== "live"` so demo state cannot leak into live observation.
  3. Mapped `cultural_sound` and `hazard` disturbance categories to `"anthropogenic"` in `ecosonicSocket.ts` and suppressed `(Unknown)` scientific-name parentheses in `AcousticField.tsx` for non-biological sound classes.
- **Outside `src/`:** Downloaded OriginKit template archives remain in `components/originkit/`, `app/`, and `public/originkit/` (unused by `src/` or the Vite bundle, left untouched pending later scenes).

---

## 9. Remaining Limitations

1. **Physical-mic wild bird detection:** Physical Realtek mic capture → 32 kHz PCM16 → BirdNET inference ran end-to-end (`MIC LIVE`), but no live bird vocalization occurred in the quiet room during the 3.8 s test; detection/disturbance visual triggers were verified via real `audio_mono_32k.wav` streaming through the same pipeline.
2. **Offline font self-hosting:** `Instrument Serif` and `Inter Tight` are loaded from Google Fonts in `index.html` with `Georgia` / system-sans fallbacks when offline.

---

## 10. SCENE 01 FINAL VERDICT

### **ACCEPT**

Scene 01 (`ACT 06 — ACOUSTIC FIELD`) meets all visual hierarchy, organic geometry, state-transition, real backend protocol, performance (`p95 = 7.20 ms`, `median = 144.9 FPS`, `1` WebGL context), responsive, and reduced-motion acceptance criteria, and is ready to serve as the visual foundation for the remaining ECOsonic storyboard.
