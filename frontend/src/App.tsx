import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { Observatory } from './pages/Observatory';
import { AudioIntelligence } from './pages/AudioIntelligence';
import { AcousticMemory } from './pages/AcousticMemory';
import { HabitatMonitor } from './pages/HabitatMonitor';
import { ReviewLab } from './pages/ReviewLab';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Observatory />} />
          <Route path="/audio" element={<AudioIntelligence />} />
          <Route path="/memory" element={<AcousticMemory />} />
          <Route path="/habitat" element={<HabitatMonitor />} />
          <Route path="/review" element={<ReviewLab />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

export default App;
