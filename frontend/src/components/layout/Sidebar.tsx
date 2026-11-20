import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  Activity,
  Radio,
  Cpu,
  MapPin,
  CheckSquare,
  AudioWaveform,
  ExternalLink,
} from 'lucide-react';

const navLinks = [
  {
    to: '/',
    label: 'Observatory',
    subtitle: 'Bioacoustic Overview',
    icon: Activity,
  },
  {
    to: '/audio',
    label: 'Audio Intelligence',
    subtitle: 'Upload & Classify',
    icon: Radio,
  },
  {
    to: '/memory',
    label: 'Acoustic Memory',
    subtitle: 'Embedding Vector Search',
    icon: Cpu,
  },
  {
    to: '/habitat',
    label: 'Habitat Monitor',
    subtitle: 'Geo-Spatial Stations',
    icon: MapPin,
  },
  {
    to: '/review',
    label: 'Review Lab',
    subtitle: 'Human Verification',
    icon: CheckSquare,
  },
];

export const Sidebar: React.FC = () => {
  return (
    <aside className="w-64 border-r border-forest-750 bg-forest-950 flex flex-col justify-between shrink-0 select-none">
      <div className="p-4 space-y-6">
        {/* Navigation list */}
        <div className="space-y-1">
          <div className="px-3 pb-2 text-[10px] font-mono uppercase tracking-widest text-forest-400 font-semibold">
            Intelligence Modules
          </div>

          {navLinks.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 group relative ${
                    isActive
                      ? 'bg-forest-850 text-white font-medium shadow-card-glow border border-bio-emerald/30'
                      : 'text-forest-300 hover:text-white hover:bg-forest-900/60'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <div
                      className={`p-1.5 rounded-md transition-colors ${
                        isActive
                          ? 'bg-bio-emerald text-forest-950 font-bold'
                          : 'bg-forest-800 text-forest-400 group-hover:text-bio-leaf'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="truncate">{item.label}</div>
                      <div className="text-[10px] text-forest-400 font-mono truncate">
                        {item.subtitle}
                      </div>
                    </div>

                    {isActive && (
                      <div className="w-1.5 h-4 bg-bio-emerald rounded-full absolute right-2" />
                    )}
                  </>
                )}
              </NavLink>
            );
          })}
        </div>

        {/* Scientific Monitoring Parameters */}
        <div className="p-3.5 rounded-xl bg-forest-900/70 border border-forest-750 space-y-2.5">
          <div className="flex items-center justify-between text-[11px] font-mono text-forest-300">
            <span className="flex items-center gap-1.5">
              <AudioWaveform className="w-3.5 h-3.5 text-bio-leaf" />
              Sample Rate
            </span>
            <span className="text-white font-semibold">32.0 kHz</span>
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono text-forest-300">
            <span>Window Size</span>
            <span className="text-white font-semibold">3.0 s</span>
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono text-forest-300">
            <span>Latent Dim</span>
            <span className="text-white font-semibold">1280-D</span>
          </div>

          <div className="w-full h-px bg-forest-800 my-1" />

          <div className="flex items-center justify-between text-[10px] font-mono text-forest-400">
            <span>Global Taxa</span>
            <span className="text-bio-leaf">11,725 species</span>
          </div>
        </div>
      </div>

      {/* Footer / API Link */}
      <div className="p-4 border-t border-forest-750/80 bg-forest-900/40">
        <a
          href="/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between px-3 py-2 rounded-lg bg-forest-850 hover:bg-forest-800 border border-forest-750 text-xs text-forest-300 hover:text-white transition-colors"
        >
          <span className="font-mono">FastAPI Docs</span>
          <ExternalLink className="w-3.5 h-3.5 text-forest-400" />
        </a>
      </div>
    </aside>
  );
};
