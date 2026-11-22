# EcoSonic 3.0 — Frontend Setup & Deployment Guide

This guide describes how to install, configure, develop, test, and deploy the EcoSonic 3.0 web application.

---

## 1. Prerequisites

- **Node.js**: `v18.0.0` or later (tested on `v22.14.0`).
- **npm**: `v9.0.0` or later (tested on `11.2.0`).
- **EcoSonic Backend**: Running on `http://127.0.0.1:8000` (from virtual environment `.venv`).

---

## 2. Installation

Navigate to the `frontend/` directory and install dependencies:

```bash
cd frontend
npm install
```

Installed dependencies include:
- `react` & `react-dom` (v19.3.1)
- `react-router-dom` (v7.18.6)
- `leaflet` & `react-leaflet` (v1.9.4 & v5.0.0)
- `recharts` (v3.11.0)
- `wavesurfer.js` (v8.1.0)
- `lucide-react` (v1.77.0)
- `axios` (v1.21.1)
- `tailwindcss` (v3.4.17)
- `vite` (v8.3.8) & `vitest` (v5.1.1)

---

## 3. Environment Configuration

The frontend uses Vite environment variables. Copy `.env.example` to `.env` if custom endpoints are required:

```bash
# frontend/.env
VITE_BACKEND_URL=http://127.0.0.1:8000
VITE_API_BASE_URL=/api/v1
```

By default, in development mode:
- The Vite dev server runs at `http://localhost:5173`.
- Requests to `/api` and `/health` are proxied to `http://127.0.0.1:8000`.
- WebSockets on `/api/v1/live/sessions/{session_id}/stream` are proxied with full bidirectional binary support (`ws: true`).

---

## 4. Development Server

Start the local development server:

```bash
npm run dev
```

The application will be accessible at:
`http://localhost:5173`

---

## 5. Automated Testing

Run the Vitest test suite:

```bash
npm run test
```

Expected output:
```
✓ src/tests/audioStreamer.test.ts (4 tests)
✓ src/tests/constants.test.ts (3 tests)
✓ src/tests/formatters.test.ts (5 tests)
✓ src/tests/privacy.test.ts (4 tests)
✓ src/tests/services.test.ts (5 tests)
✓ src/tests/api.test.ts (4 tests)

Test Files  6 passed (6)
     Tests  25 passed (25)
```

Run TypeScript type verification:

```bash
npx tsc --noEmit
```

---

## 6. Production Build

Compile the production bundle with optimized code-splitting:

```bash
npm run build
```

The compiled assets are placed in `frontend/dist/`. The bundle is code-split into:
- `dist/assets/vendor-charts-*.js` (~406 kB / 116 kB gzip)
- `dist/assets/vendor-gis-*.js` (~148 kB / 43 kB gzip)
- `dist/assets/vendor-audio-*.js` (~51 kB / 15 kB gzip)
- Lazy-loaded page chunks (~8-25 kB each)

To preview the production build locally:

```bash
npm run preview
```

---

## 7. Production Security and Deployment Boundaries

The EcoSonic backend currently operates without built-in user authentication.

### Security Rules:
1. **Never Expose Directly to Public Internet**: Do not expose `http://127.0.0.1:8000` or the Vite dev server directly to untrusted public networks.
2. **Reverse Proxy Deployment**: For staging and production, deploy the static frontend assets behind an authenticating TLS reverse proxy (e.g., NGINX, Caddy, or Traefik) configured with OAuth2, OIDC, or mTLS.
3. **CORS Configuration**: Restrict backend CORS `allow_origins` to the authorized frontend domain.
4. **Location Privacy**: The backend sanitizes restricted station coordinates. Ensure caching reverse proxies do not bypass coordinate filtering.
