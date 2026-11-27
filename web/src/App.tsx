import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { EcoSonicProvider } from './context/EcoSonicContext';
import { LandingPage } from './pages/LandingPage';
import { ObservatoryPage } from './pages/ObservatoryPage';
import { DetectionsPage } from './pages/DetectionsPage';
import { SoundscapePage } from './pages/SoundscapePage';
import { DisturbancesPage } from './pages/DisturbancesPage';
import { SessionsPage } from './pages/SessionsPage';
import { SessionDetailPage } from './pages/SessionDetailPage';
import { SettingsPage } from './pages/SettingsPage';
import { NotFoundPage } from './pages/NotFoundPage';

export default function App() {
  return (
    <EcoSonicProvider>
      <BrowserRouter>
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<ErrorBoundary><LandingPage /></ErrorBoundary>} />
            <Route path="/app" element={<Navigate to="/app/observatory" replace />} />
            <Route path="/app/observatory" element={<ErrorBoundary><ObservatoryPage /></ErrorBoundary>} />
            <Route path="/app/detections" element={<ErrorBoundary><DetectionsPage /></ErrorBoundary>} />
            <Route path="/app/soundscape" element={<ErrorBoundary><SoundscapePage /></ErrorBoundary>} />
            <Route path="/app/disturbances" element={<ErrorBoundary><DisturbancesPage /></ErrorBoundary>} />
            <Route path="/app/sessions" element={<ErrorBoundary><SessionsPage /></ErrorBoundary>} />
            <Route path="/app/sessions/:sessionId" element={<ErrorBoundary><SessionDetailPage /></ErrorBoundary>} />
            <Route path="/app/settings" element={<ErrorBoundary><SettingsPage /></ErrorBoundary>} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </ErrorBoundary>
      </BrowserRouter>
    </EcoSonicProvider>
  );
}
