# EcoSonic 2.0 — Frontend Architecture & Integration Guide

## 1. Executive Summary

EcoSonic 2.0 Frontend is a modern, research-grade environmental intelligence platform built with **React 19**, **Vite**, **TypeScript**, **Tailwind CSS**, **Wavesurfer.js**, and **Leaflet**.

It is purpose-designed for bioacoustic researchers, conservationists, and ecological data scientists. The interface follows a dark forest-inspired aesthetic (`#060907` charcoal canvas, emerald accents, and high-density telemetry displays) avoiding generic SaaS design patterns.

---

## 2. Technology Stack & Dependencies

| Category | Package | Purpose |
|---|---|---|
| **Core Framework** | `react`, `react-dom` (v19) | Modern component architecture & hooks |
| **Build & Bundler** | `vite` (v8) | Ultra-fast HMR and optimized tree-shaken builds |
| **Language** | `typescript` (v5.8) | Strict types across models, API schemas & UI |
| **Styling** | `tailwindcss`, `postcss`, `autoprefixer` | Dark-forest custom palette, custom scrollbars |
| **Motion** | `framer-motion` | Restrained, scientific UI transitions |
| **Audio Processing** | `wavesurfer.js` (v8) | Interactive waveform visualization, seeking & playback |
| **Geospatial Mapping** | `leaflet`, `react-leaflet` | Geospatial monitoring stations with custom pulsed pins |
| **Data Visualization** | `recharts` | Multi-dimensional timelines, taxa bar rankings & UMAP scatter |
| **Icons** | `lucide-react` | Semantic environmental and audio iconography |
| **HTTP Client** | `axios` | Centralized typed API client with interceptors |
| **Testing** | `vitest` | Fast unit & integration testing for utilities & services |

---

## 3. Application Structure & Pages

```
frontend/
├── src/
│   ├── components/
│   │   ├── audio/
│   │   │   ├── WaveformPlayer.tsx       # Wavesurfer.js waveform with timecode & play/pause
│   │   │   └── SpectrogramView.tsx      # Frequency-domain FFT heatmap view
│   │   ├── charts/
│   │   │   ├── DetectionsTimeline.tsx   # Temporal scatter distribution of vocalizations
│   │   │   └── TaxaDistributionChart.tsx# Species richness and detection counts
│   │   ├── common/
│   │   │   ├── Badge.tsx                # Taxon and confidence badges
│   │   │   ├── ErrorBanner.tsx          # System alert banner with retry trigger
│   │   │   ├── LoadingState.tsx         # Radar pulse and stage progress bar
│   │   │   └── StatCard.tsx             # Ecological metric cards
│   │   ├── detections/
│   │   │   └── DetectionCard.tsx        # Species card with segment play & review triggers
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx            # Root shell with persistent Header & Sidebar
│   │   │   ├── Header.tsx               # Telemetry status, UTC clock, engine indicator
│   │   │   └── Sidebar.tsx              # Navigation with parameter cards (32kHz, 1280-D)
│   │   └── maps/
│   │       └── SiteMap.tsx              # Dark-mode Leaflet station map
│   │
│   ├── pages/
│   │   ├── Observatory.tsx              # Main dashboard: statistics, soundscapes & recent runs
│   │   ├── AudioIntelligence.tsx        # Drag-and-drop upload, status polling, playback & spectrogram
│   │   ├── AcousticMemory.tsx           # 1280-D vector embeddings, UMAP projection & similarity matches
│   │   ├── HabitatMonitor.tsx           # Station management, GPS coordinates & ecological trends
│   │   └── ReviewLab.tsx                # Expert human verification queue, audit notes & status update
│   │
│   ├── services/
│   │   ├── api.ts                       # Base Axios instance with environment-based URL
│   │   ├── analysesService.ts           # Upload, list, detail, status polling, deletion
│   │   ├── detectionsService.ts         # Query detections and submit expert reviews
│   │   ├── sitesService.ts              # Monitoring site CRUD operations
│   │   ├── acousticService.ts           # Acoustic signal inspection & streaming URL
│   │   └── reportsService.ts            # Summary platform statistics & CSV export
│   │
│   ├── tests/
│   │   ├── api.test.ts                  # API service URL & endpoint tests
│   │   ├── constants.test.ts            # Route definitions & confidence tiers
│   │   └── formatters.test.ts           # Timecode, confidence, byte & GPS formatters
│   │
│   ├── types/
│   │   └── index.ts                     # Strict TypeScript interfaces matching FastAPI schemas
│   │
│   └── utils/
│       ├── constants.ts                 # Taxon colors, confidence tiers, navigation
│       └── formatters.ts                # Audio & data formatting functions
│
├── tailwind.config.js                   # Custom forest theme and colors
├── vite.config.ts                       # Proxy config for local backend (/api -> :8000)
├── tsconfig.json                        # Strict compiler configuration
└── package.json                         # Build and test scripts
```

---

## 4. API Integration Matrix

The frontend integrates directly with the live FastAPI backend:

| Page / Component | Backend Endpoint | Method | Frontend Handling |
|---|---|---|---|
| **Observatory** | `/api/v1/reports/summary` | `GET` | Fetches total recordings, detections, and top species |
| **Observatory** | `/api/v1/analyses` | `GET` | Fetches recent 6 analyses for the activity feed |
| **Observatory** | `/api/v1/reports/export` | `GET` | Direct download button for complete CSV dataset |
| **Audio Intelligence** | `/api/v1/analyses` | `POST` | Multipart upload with audio file, GPS coords & timestamp |
| **Audio Intelligence** | `/api/v1/analyses/{id}/status` | `GET` | Polling loop tracking stage & progress % until completed |
| **Audio Intelligence** | `/api/v1/analyses/{id}` | `GET` | Retrieves full analysis with detections & embedding segments |
| **Audio Intelligence** | `/api/v1/analyses/{id}` | `DELETE` | Cancels job, deletes DB records and storage files |
| **Audio Intelligence** | `/api/v1/acoustic/stream/{id}` | `GET` | Streams normalized 32kHz Mono WAV directly to WaveSurfer |
| **Audio Intelligence** | `/api/v1/analyses/{id}/embeddings/download` | `GET` | Download link for binary NumPy array (`.npy`) |
| **Acoustic Memory** | `/api/v1/analyses/{id}` | `GET` | Loads 1280-D embedding segments metadata for UMAP clustering |
| **Habitat Monitor** | `/api/v1/sites` | `GET` | Loads monitoring stations displayed on Leaflet map |
| **Habitat Monitor** | `/api/v1/sites` | `POST` | Registers new geographic monitoring station |
| **Review Lab** | `/api/v1/detections` | `GET` | Filters detection queue by status (`unreviewed`, `confirmed`, etc.) |
| **Review Lab** | `/api/v1/detections/{id}/reviews` | `POST` | Submits human verification decisions with reviewer remarks |

### Handled Extended Endpoints & Documented Dependencies:
- `/analyses/{id}/timeline`: Rendered dynamically in frontend from `detections` array sorted by `start_seconds`.
- `/analyses/{id}/spectrogram`: Rendered via client-side Web Audio FFT spectrogram view linked to the audio stream.
- `/analyses/{id}/similar/{segment_id}`: UMAP latent space similarity computed from the 1280-D embedding segment metadata and linked vectors.
- `/sites/{id}/analyses`: Connected to site-level analysis queries and station recording history.

---

## 5. Audio Upload & Status Polling Workflow

1. User selects or drops an audio file (`.wav`, `.mp3`, `.flac`, `.ogg`, `.m4a`).
2. Client validates format and file size (< 256MB).
3. Optional latitude, longitude, and recording date inputs are collected.
4. Form data is dispatched to `POST /api/v1/analyses` returning an analysis UUID with status `queued` (HTTP 202 Accepted).
5. Polling worker queries `GET /api/v1/analyses/{id}/status` every 1,000ms:
   - Stage 1: Validating audio structure (10%)
   - Stage 2: Normalizing audio to 32kHz Mono WAV (30%)
   - Stage 3: Running bioacoustic classification (60%)
   - Stage 4: Extracting vector embeddings (85%)
   - Stage 5: Completed (100%)
6. On completion, full analysis and detections are retrieved and rendered.
7. User can click any detection card or timeline scatter point to immediately jump to and listen to that vocalization window in the WaveSurfer audio player.

---

## 6. Build and Acceptance Verification

### Production Build:
```bash
cd frontend && npm run build
```
Result:
```
vite v8.3.8 building client environment for production...
✓ 2658 modules transformed.
dist/index.html                     1.18 kB │ gzip:   0.66 kB
dist/assets/index-DpM_L___.css     26.45 kB │ gzip:   5.88 kB
dist/assets/index-BnZgP28O.js   1,030.78 kB │ gzip: 304.79 kB
✓ built in 1.27s
```

### Test Suite:
```bash
cd frontend && npm test
```
Result:
```
✓ src/tests/constants.test.ts (3 tests)
✓ src/tests/formatters.test.ts (5 tests)
✓ src/tests/api.test.ts (4 tests)

Test Files  3 passed (3)
Tests       12 passed (12)
```
