import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  Compass,
  Radio,
  FileAudio,
  ShieldAlert,
  BarChart3,
  Network,
  Zap,
  TrendingUp,
  CheckCircle2,
  AlertOctagon,
  FileSpreadsheet,
} from 'lucide-react';

interface NavSection {
  title: string;
  items: Array<{
    to: string;
    label: string;
    subtitle: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string;
  }>;
}

const navSections: NavSection[] = [
  {
    title: 'Core Monitoring',
    items: [
      {
        to: '/',
        label: 'Observatory',
        subtitle: 'GIS Overview & Stations',
        icon: Compass,
      },
      {
        to: '/live',
        label: 'Live Monitoring',
        subtitle: 'Real-time Streaming',
        icon: Radio,
        badge: 'LIVE',
      },
      {
        to: '/audio',
        label: 'Audio Intelligence',
        subtitle: 'Batch Audio Processing',
        icon: FileAudio,
      },
    ],
  },
  {
    title: 'Acoustic Analytics',
    items: [
      {
        to: '/disturbances',
        label: 'Disturbance Radar',
        subtitle: 'Anthrophony & Events',
        icon: ShieldAlert,
      },
      {
        to: '/soundscape',
        label: 'Soundscape Intelligence',
        subtitle: 'Ecoacoustic Fingerprints',
        icon: BarChart3,
      },
      {
        to: '/memory',
        label: 'Acoustic Memory',
        subtitle: 'FAISS & UMAP Clusters',
        icon: Network,
      },
      {
        to: '/anomalies',
        label: 'Acoustic Anomaly',
        subtitle: 'Outlier Investigation',
        icon: Zap,
      },
      {
        to: '/habitat',
        label: 'Habitat Drift',
        subtitle: 'Trajectory & Baseline',
        icon: TrendingUp,
      },
    ],
  },
  {
    title: 'Verification & Reports',
    items: [
      {
        to: '/review',
        label: 'Review Lab',
        subtitle: 'Human-in-the-Loop',
        icon: CheckCircle2,
      },
      {
        to: '/incidents',
        label: 'Incident Management',
        subtitle: 'Consolidated Bouts',
        icon: AlertOctagon,
      },
      {
        to: '/reports',
        label: 'Reports & Exports',
        subtitle: 'CSV / JSON / QGIS Data',
        icon: FileSpreadsheet,
      },
    ],
  },
];

export const Sidebar: React.FC = () => {
  return (
    <aside className="w-64 border-r border-forest-750 bg-forest-950 flex flex-col justify-between shrink-0 select-none overflow-y-auto">
      <div className="p-3.5 space-y-5">
        {navSections.map((section) => (
          <div key={section.title} className="space-y-1">
            <div className="px-3 pb-1.5 text-[10px] font-mono uppercase tracking-wider text-forest-400 font-semibold">
              {section.title}
            </div>

            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-all duration-150 group relative ${
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
                        <Icon className="w-3.5 h-3.5" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="truncate flex items-center justify-between">
                          <span>{item.label}</span>
                          {item.badge && (
                            <span className="text-[9px] font-mono px-1 rounded bg-bio-emerald/20 text-bio-leaf border border-bio-emerald/30 font-bold">
                              {item.badge}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-forest-400 font-mono truncate">
                          {item.subtitle}
                        </div>
                      </div>

                      {isActive && (
                        <div className="w-1 h-3.5 bg-bio-emerald rounded-full absolute right-1.5" />
                      )}
                    </>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </div>

      {/* Footer telemetry & notice */}
      <div className="p-3 border-t border-forest-800 text-[10px] font-mono text-forest-400 space-y-1 bg-forest-900/40">
        <div className="flex justify-between items-center">
          <span>Framing:</span>
          <span className="text-forest-200">32 kHz PCM16</span>
        </div>
        <div className="flex justify-between items-center">
          <span>Coordinates:</span>
          <span className="text-forest-200">3-Tier Protected</span>
        </div>
      </div>
    </aside>
  );
};
