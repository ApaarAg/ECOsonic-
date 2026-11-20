import React, { useEffect, useState } from 'react';
import { Radio, ShieldCheck, Database, Volume2 } from 'lucide-react';
import { apiClient } from '../../services/api';

export const Header: React.FC = () => {
  const [backendStatus, setBackendStatus] = useState<'checking' | 'healthy' | 'offline'>('checking');
  const [utcTime, setUtcTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setUtcTime(now.toUTCString().replace('GMT', 'UTC'));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        await apiClient.get('/health', { timeout: 4000 });
        setBackendStatus('healthy');
      } catch {
        setBackendStatus('offline');
      }
    };
    checkHealth();
    const poll = setInterval(checkHealth, 30000);
    return () => clearInterval(poll);
  }, []);

  return (
    <header className="h-16 border-b border-forest-750 bg-forest-950/80 backdrop-blur-md sticky top-0 z-30 flex items-center justify-between px-6">
      {/* Brand & Mission */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-bio-emerald to-bio-leaf flex items-center justify-center text-forest-950 font-bold shadow-forest-glow">
          <Volume2 className="w-4 h-4 stroke-[2.5]" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold tracking-wider text-sm text-white">
              ECOSONIC
            </span>
            <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-bio-emerald/20 text-bio-leaf border border-bio-emerald/30 font-bold">
              2.0
            </span>
          </div>
          <p className="text-[10px] text-forest-300 font-mono tracking-tight">
            AI Bioacoustic & Environmental Intelligence
          </p>
        </div>
      </div>

      {/* Center Live Telemetry */}
      <div className="hidden md:flex items-center gap-6 text-xs font-mono text-forest-300">
        <div className="flex items-center gap-2">
          <Database className="w-3.5 h-3.5 text-forest-400" />
          <span>Engine:</span>
          <span className="text-gray-200 font-medium">BirdNET+ V3.0 ONNX</span>
        </div>

        <div className="flex items-center gap-2 border-l border-forest-800 pl-4">
          <Radio className="w-3.5 h-3.5 text-bio-leaf animate-pulse" />
          <span>System:</span>
          {backendStatus === 'healthy' ? (
            <span className="inline-flex items-center gap-1 text-bio-leaf">
              <span className="w-1.5 h-1.5 rounded-full bg-bio-leaf animate-ping" />
              ONLINE
            </span>
          ) : backendStatus === 'checking' ? (
            <span className="text-amber-400">CONNECTING...</span>
          ) : (
            <span className="text-rose-400 font-medium">BACKEND DISCONNECTED</span>
          )}
        </div>

        <div className="hidden lg:flex items-center gap-1.5 border-l border-forest-800 pl-4 text-forest-400">
          <span>{utcTime}</span>
        </div>
      </div>

      {/* Model & Version Status */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-forest-900 border border-forest-750 text-xs font-mono">
          <ShieldCheck className="w-3.5 h-3.5 text-bio-leaf" />
          <span className="text-forest-200">Production Node</span>
        </div>
      </div>
    </header>
  );
};
