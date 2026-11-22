import React, { useEffect, useState } from 'react';
import {
  Radio,
  ShieldCheck,
  Cpu,
  MapPin,
  Volume2,
  AlertTriangle,
  ChevronDown,
} from 'lucide-react';
import { checkSystemHealth } from '../../services/api';
import { useSiteContext } from '../../context/SiteContext';
import { HealthStatus } from '../../types';

export const Header: React.FC = () => {
  const { sites, selectedSite, setSelectedSite, loadingSites } = useSiteContext();
  const [health, setHealth] = useState<HealthStatus | null>(null);
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
    let mounted = true;
    const fetchHealth = async () => {
      try {
        const data = await checkSystemHealth();
        if (mounted) {
          setHealth(data);
          setBackendStatus(data.status === 'healthy' ? 'healthy' : 'offline');
        }
      } catch {
        if (mounted) {
          setBackendStatus('offline');
        }
      }
    };
    fetchHealth();
    const poll = setInterval(fetchHealth, 15000);
    return () => {
      mounted = false;
      clearInterval(poll);
    };
  }, []);

  return (
    <header className="h-16 border-b border-forest-750 bg-forest-950/90 backdrop-blur-md sticky top-0 z-30 flex items-center justify-between px-6 select-none">
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
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bio-emerald/20 text-bio-leaf border border-bio-emerald/30 font-bold">
              3.0
            </span>
          </div>
          <p className="text-[10px] text-forest-300 font-mono tracking-tight hidden sm:block">
            Listen to Nature. Understand Its Changes.
          </p>
        </div>
      </div>

      {/* Global Site Selector */}
      <div className="flex items-center gap-2">
        <div className="relative flex items-center">
          <MapPin className="w-3.5 h-3.5 text-bio-emerald absolute left-3 pointer-events-none" />
          <select
            className="pl-8 pr-8 py-1.5 rounded-lg bg-forest-900 border border-forest-750 text-xs font-mono text-gray-200 hover:border-bio-emerald/40 focus:outline-none focus:border-bio-emerald appearance-none cursor-pointer"
            value={selectedSite?.id || ''}
            onChange={(e) => {
              const site = sites.find((s) => s.id === e.target.value) || null;
              setSelectedSite(site);
            }}
            disabled={loadingSites || sites.length === 0}
          >
            {sites.length === 0 ? (
              <option value="">{loadingSites ? 'Loading sites...' : 'No sites registered'}</option>
            ) : (
              sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name} ({site.location_sensitivity.toUpperCase()})
                </option>
              ))
            )}
          </select>
          <ChevronDown className="w-3 h-3 text-forest-400 absolute right-2.5 pointer-events-none" />
        </div>

        {selectedSite?.location_sensitivity === 'restricted' && (
          <span className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-950/60 text-rose-300 border border-rose-800/40 text-[10px] font-mono">
            <AlertTriangle className="w-3 h-3 text-rose-400" />
            Restricted Coordinates
          </span>
        )}
      </div>

      {/* Center Live Telemetry */}
      <div className="hidden lg:flex items-center gap-5 text-xs font-mono text-forest-300">
        <div className="flex items-center gap-2">
          <Cpu className="w-3.5 h-3.5 text-forest-400" />
          <span>Engine:</span>
          <span className="text-gray-200 font-medium">
            {health?.model_version || 'BirdNET+ V3.0 ONNX'}
          </span>
        </div>

        <div className="flex items-center gap-2 border-l border-forest-800 pl-4">
          <Radio className="w-3.5 h-3.5 text-bio-leaf animate-pulse" />
          <span>System:</span>
          {backendStatus === 'healthy' ? (
            <span className="inline-flex items-center gap-1.5 text-bio-leaf font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-bio-leaf animate-ping" />
              ONLINE
            </span>
          ) : backendStatus === 'checking' ? (
            <span className="text-amber-400">CONNECTING...</span>
          ) : (
            <span className="text-rose-400 font-medium">BACKEND DISCONNECTED</span>
          )}
        </div>

        <div className="hidden xl:flex items-center gap-1.5 border-l border-forest-800 pl-4 text-forest-400">
          <span>{utcTime}</span>
        </div>
      </div>

      {/* Production Boundary Label */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-forest-900 border border-forest-750 text-xs font-mono">
          <ShieldCheck className="w-3.5 h-3.5 text-bio-leaf" />
          <span className="text-forest-200 hidden sm:inline">Release Node</span>
          <span className="text-[10px] text-forest-400 font-mono">v3.0.0</span>
        </div>
      </div>
    </header>
  );
};
