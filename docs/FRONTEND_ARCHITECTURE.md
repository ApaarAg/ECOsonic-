# EcoSonic 3.0 — Frontend Technical Architecture

## 1. System Overview

EcoSonic 3.0 is a specialized bioacoustic and environmental intelligence platform engineered for ecological researchers, conservation organizations, and environmental monitoring teams. The web application operates as a high-density, research-grade instrument connected directly to the production FastAPI backend (`integration/ecosonic-v1-release`, commit `fb397ee`).

```
+---------------------------------------------------------------------------------------+
|                                    EcoSonic 3.0 SPA                                   |
|               (React 19.3.1, TypeScript 7.0.2, Vite 8.3.8, Tailwind CSS 3.4.17)       |
+---------------------------------------------------------------------------------------+
         |                                |                                   |
         v                                v                                   v
+--------------------+        +------------------------+        +--------------------------+
|  SiteContext State |        | Central API Client     |        | AudioStreamer Pipeline   |
|  - Global Site     |        | - Axios Base /api/v1   |        | - Web Audio API (Mic)    |
|  - Station Refresh |        | - Response Interceptor |        | - 32 kHz Resampler       |
|  - Privacy Modes   |        | - Error Normalization  |        | - PCM16 (<i2) Quantizer  |
+--------------------+        +------------------------+        | - Binary WS Framing (>I) |
                                          |                     +--------------------------+
                                          |                                   |
                                          v                                   v
                      +------------------------------------------------------------+
                      |                      FastAPI Backend                       |
                      |              (http://localhost:8000/api/v1)                |
                      +------------------------------------------------------------+
```

---

## 2. Directory and Module Organization

```
frontend/
├── index.html                       # HTML5 template with Inter & JetBrains Mono typography
├── package.json                     # Vite 8, React 19, Lucide, Leaflet, Recharts, Vitest
├── vite.config.ts                   # Proxies /api, /health, and WebSockets (ws: true)
├── tailwind.config.js               # Forest palette (#060907 abyss, #10b981 emerald, etc.)
├── src/
│   ├── main.tsx                     # React root mount
│   ├── App.tsx                      # App router with React.lazy code-splitting
│   ├── index.css                    # Dark theme leaflet overrides, custom scrollbars
│   ├── types/
│   │   └── index.ts                 # Strongly-typed domain interfaces aligned to OpenAPI
│   ├── context/
│   │   └── SiteContext.tsx          # Persistent station context & privacy selector
│   ├── services/
│   │   ├── api.ts                   # Axios client with error normalization
│   │   ├── audioStreamer.ts         # 32kHz resampling, PCM16 framing, WS streaming
│   │   ├── sitesService.ts          # Station CRUD, geo-context, habitat drift
│   │   ├── liveService.ts           # Live session controls, timeline, fingerprints
│   │   ├── analysesService.ts       # Audio batch upload, pipeline progress, embeddings
│   │   ├── detectionsService.ts     # Detections query, human review submissions
│   │   ├── acousticService.ts       # Spectrogram metadata and normalized audio stream
│   │   ├── acousticMemoryService.ts # FAISS index status, rebuild, HDBSCAN, UMAP
│   │   ├── environmentalService.ts  # Incident management, bout transitions, reviews
│   │   └── reportsService.ts        # Platform summary and CSV/JSON downloads
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx        # Shell wrapping SiteProvider, Header, Sidebar
│   │   │   ├── Header.tsx           # Global site selector, telemetry, UTC clock
│   │   │   └── Sidebar.tsx          # 11 navigation links across 3 functional tiers
│   │   ├── maps/
│   │   │   └── SiteMap.tsx          # Leaflet GIS map with 3-tier privacy rendering
│   │   ├── audio/
│   │   │   ├── WaveformPlayer.tsx   # WaveSurfer.js audio scrubber and player
│   │   │   └── SpectrogramView.tsx  # Spectral display canvas
│   │   ├── charts/
│   │   │   ├── DetectionsTimeline.tsx
│   │   │   └── TaxaDistributionChart.tsx
│   │   └── common/
│   │       ├── Badge.tsx, ErrorBanner.tsx, LoadingState.tsx, StatCard.tsx
│   ├── pages/
│   │   ├── Observatory.tsx          # Main home screen (GIS map + intelligence drawer)
│   │   ├── LiveMonitoring.tsx       # Real-time mic ingestion, VU meter, detection feed
│   │   ├── AudioIntelligence.tsx    # Audio file upload, WaveSurfer, detections table
│   │   ├── DisturbanceRadar.tsx     # Anthrophony, chainsaw, gunfire investigation
│   │   ├── SoundscapeIntelligence.tsx # Ecoacoustic indices (ACI, NDSI, ADI, AEI)
│   │   ├── AcousticMemory.tsx       # FAISS 1280-dim vectors, HDBSCAN, 2D UMAP
│   │   ├── AcousticAnomaly.tsx      # Outlier ranking (S) and component breakdown
│   │   ├── HabitatDrift.tsx         # Longitudinal shift, robust Z-scores with MAD
│   │   ├── ReviewLab.tsx            # Human verification queue (4 review decisions)
│   │   ├── IncidentManagement.tsx   # Consolidated bouts, ranger investigation desk
│   │   └── ReportsExports.tsx       # CSV/JSON research export generator
│   └── tests/
│       ├── api.test.ts              # Endpoint URL and base configuration verification
│       ├── audioStreamer.test.ts    # 32kHz resampling, PCM16 quantization, binary framing
│       ├── constants.test.ts        # Design constants and colors
│       ├── formatters.test.ts       # Coordinate, confidence, timestamp formatting
│       ├── privacy.test.ts          # 3-tier location sensitivity enforcement
│       └── services.test.ts         # Service contract verification
```

---

## 3. Real-Time Audio Streaming Architecture

The browser microphone capture pipeline adheres strictly to the backend binary framing protocol defined in `backend/app/api/v1/live.py`:

```
Browser Audio Hardware (44.1 kHz / 48 kHz)
   │
   ▼ navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } })
AudioContext (Web Audio API)
   │
   ▼ ScriptProcessorNode (bufferSize: 4096)
Linear Interpolation Resampler
   │ Converts arbitrary browser sample rate down to exact 32,000 Hz
   ▼
Float32 to Int16 PCM Quantizer (<i2)
   │ Clamps [-1.0, 1.0] to [-32768, 32767], signed 16-bit little-endian
   ▼
250 ms Chunk Buffer (8,000 samples = 16,000 bytes)
   │
   ▼ Binary WebSocket Framing (>I Header + <i2 Samples)
DataView Frame:
  [ Bytes 0..3 ]: uint32 Sequence Number (Big-Endian `>I`)
  [ Bytes 4..N ]: Int16 PCM Audio Samples (Little-Endian `<i2`)
   │
   ▼ WebSocket.send(ArrayBuffer)
ws://localhost:8000/api/v1/live/sessions/{session_id}/stream
```

### WebSocket Control & Event Protocol
- **Client to Server (Text JSON)**:
  - `{"type": "handshake"}` -> Handshake initiation
  - `{"type": "start"}` -> Transition session to active streaming
  - `{"type": "pause"}` -> Pause ring buffer ingestion
  - `{"type": "resume"}` -> Resume ring buffer ingestion
  - `{"type": "stop"}` -> Graceful session teardown
  - `{"type": "heartbeat", "timestamp": ...}` -> Keep-alive every 15 seconds
- **Server to Client (Text JSON)**:
  - `handshake_ack`: Confirms session parameters and expected sequence number
  - `session_started`, `session_paused`, `session_resumed`, `session_stopped`
  - `detection`: Real-time biological species classification from rolling 3.0s window
  - `processing_update`: Telemetry containing processed seconds, inference duration ms, window lag ms, queue lag
  - `disturbance_event`: Anthrophony event detection (chainsaw, gun, engine, etc.)
  - `soundscape_measurement`: 10.0s ecoacoustic fingerprint calculation
  - `audio_quality_warning`: Low SNR, clipping, or missing frame alerts

---

## 4. Location Privacy Enforcement

The application implements strict 3-tier geographic privacy:

1. **Exact (`location_sensitivity: "exact"`)**:
   - Renders standard emerald station marker at `[site.latitude, site.longitude]`.
   - Full decimal degree precision displayed in telemetry popups.
2. **Generalized (`location_sensitivity: "generalized"`)**:
   - Renders station marker at `[site.generalized_latitude, site.generalized_longitude]`.
   - Displays a diffuse amber dashed circle with radius ~1,100 meters (~1.1 km blur).
   - Coordinates explicitly labeled as `Fuzzed (~1.1km blur)`.
3. **Restricted (`location_sensitivity: "restricted"`)**:
   - `latitude` and `longitude` are received as `null` from backend serialization.
   - The map suppresses marker placement entirely to prevent disclosing sensitive breeding grounds or endangered species habitat.
   - An advisory badge is surfaced on the map: `X Station(s) Restricted (Coordinates Hidden)`.

---

## 5. Scientific Rigor and Disclaimers

Every visualization and analytical component maintains scientific integrity:
- **No Abundance Equivalence**: Biological detection frequencies are never described as animal abundance or population density.
- **Uncalibrated Anomaly Scores**: The acoustic anomaly score $S \in [0.0, 1.0]$ is explicitly documented as an uncalibrated composite heuristic rank rather than a probability.
- **No Legal/Criminal Determinations**: Disturbance Radar priorities are documented strictly as automated screening classifications for ranger triage rather than proof of criminal guilt.
- **Ecoacoustic Index Factors**: The soundscape interface explicitly notes that index values are sensitive to hardware gain, clipping, weather, and recording effort.
- **Insufficient Baseline Handling**: Habitat Drift enforces a structured warning state whenever a site has fewer than 3 completed baseline recording sessions.

---

## 6. Build and Chunking Performance

The build toolchain utilizes Vite 8.3.8 and TypeScript 7.0.2 with dynamic code-splitting:
- Heavy GIS dependencies (`leaflet`, `react-leaflet`) isolated into `vendor-gis` (148 kB).
- Heavy charting libraries (`recharts`) isolated into `vendor-charts` (406 kB).
- Audio waveform visualizers (`wavesurfer.js`) isolated into `vendor-audio` (51 kB).
- All 11 major pages asynchronously loaded via `React.lazy` with instant suspense skeletons.
- Entire production bundle compiles in $< 3.0$ seconds with zero chunk-size warnings.
