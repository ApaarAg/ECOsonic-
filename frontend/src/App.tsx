import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { LoadingState } from './components/common/LoadingState';

// Lazy-loaded routes for optimized bundle chunking
const Observatory = lazy(() => import('./pages/Observatory').then((m) => ({ default: m.Observatory })));
const LiveMonitoring = lazy(() => import('./pages/LiveMonitoring').then((m) => ({ default: m.LiveMonitoring })));
const AudioIntelligence = lazy(() => import('./pages/AudioIntelligence').then((m) => ({ default: m.AudioIntelligence })));
const DisturbanceRadar = lazy(() => import('./pages/DisturbanceRadar').then((m) => ({ default: m.DisturbanceRadar })));
const SoundscapeIntelligence = lazy(() => import('./pages/SoundscapeIntelligence').then((m) => ({ default: m.SoundscapeIntelligence })));
const AcousticMemory = lazy(() => import('./pages/AcousticMemory').then((m) => ({ default: m.AcousticMemory })));
const AcousticAnomaly = lazy(() => import('./pages/AcousticAnomaly').then((m) => ({ default: m.AcousticAnomaly })));
const HabitatDrift = lazy(() => import('./pages/HabitatDrift').then((m) => ({ default: m.HabitatDrift })));
const ReviewLab = lazy(() => import('./pages/ReviewLab').then((m) => ({ default: m.ReviewLab })));
const IncidentManagement = lazy(() => import('./pages/IncidentManagement').then((m) => ({ default: m.IncidentManagement })));
const ReportsExports = lazy(() => import('./pages/ReportsExports').then((m) => ({ default: m.ReportsExports })));

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route
            path="/"
            element={
              <Suspense fallback={<LoadingState message="Loading Unified Observatory..." />}>
                <Observatory />
              </Suspense>
            }
          />
          <Route
            path="/live"
            element={
              <Suspense fallback={<LoadingState message="Connecting Live Monitoring Node..." />}>
                <LiveMonitoring />
              </Suspense>
            }
          />
          <Route
            path="/audio"
            element={
              <Suspense fallback={<LoadingState message="Initializing Audio Intelligence..." />}>
                <AudioIntelligence />
              </Suspense>
            }
          />
          <Route
            path="/disturbances"
            element={
              <Suspense fallback={<LoadingState message="Calibrating Disturbance Radar..." />}>
                <DisturbanceRadar />
              </Suspense>
            }
          />
          <Route
            path="/soundscape"
            element={
              <Suspense fallback={<LoadingState message="Aggregating Soundscape Fingerprints..." />}>
                <SoundscapeIntelligence />
              </Suspense>
            }
          />
          <Route
            path="/memory"
            element={
              <Suspense fallback={<LoadingState message="Mounting FAISS Acoustic Memory..." />}>
                <AcousticMemory />
              </Suspense>
            }
          />
          <Route
            path="/anomalies"
            element={
              <Suspense fallback={<LoadingState message="Querying Anomaly Candidates..." />}>
                <AcousticAnomaly />
              </Suspense>
            }
          />
          <Route
            path="/habitat"
            element={
              <Suspense fallback={<LoadingState message="Computing Habitat Drift Trajectory..." />}>
                <HabitatDrift />
              </Suspense>
            }
          />
          <Route
            path="/review"
            element={
              <Suspense fallback={<LoadingState message="Loading Human Verification Queue..." />}>
                <ReviewLab />
              </Suspense>
            }
          />
          <Route
            path="/incidents"
            element={
              <Suspense fallback={<LoadingState message="Retrieving Incident Records..." />}>
                <IncidentManagement />
              </Suspense>
            }
          />
          <Route
            path="/reports"
            element={
              <Suspense fallback={<LoadingState message="Preparing Research Export Center..." />}>
                <ReportsExports />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

export default App;
