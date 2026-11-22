import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  AlertTriangle,
  Activity,
  Layers,
  Radio,
  RefreshCw,
  Clock,
  Info,
  CheckCircle,
} from 'lucide-react';
import { useSiteContext } from '../context/SiteContext';
import { liveService } from '../services/liveService';
import { sitesService } from '../services/sitesService';
import { LiveSession, SoundscapeFingerprint } from '../types';

export const SoundscapeIntelligence: React.FC = () => {
  const { sites, selectedSite } = useSiteContext();

  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [fingerprint, setFingerprint] = useState<SoundscapeFingerprint | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Load sessions for site
  useEffect(() => {
    const loadSessions = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await liveService.getSessions({
          site_id: selectedSite?.id,
          limit: 20,
        });
        setSessions(data);
        if (data.length > 0) {
          setSelectedSessionId(data[0].id);
        } else {
          setSelectedSessionId('');
          setFingerprint(null);
        }
      } catch (err: any) {
        console.error('Failed to load sessions:', err);
        setError(err.message || 'Failed to load monitoring sessions');
      } finally {
        setLoading(false);
      }
    };

    loadSessions();
  }, [selectedSite?.id]);

  // Load fingerprint for selected session
  useEffect(() => {
    if (!selectedSessionId) return;

    const loadFingerprint = async () => {
      try {
        setLoading(true);
        const data = await liveService.getSessionFingerprint(selectedSessionId);
        setFingerprint(data);
      } catch (err: any) {
        console.warn('No fingerprint recorded yet for session:', err);
        setFingerprint(null);
      } finally {
        setLoading(false);
      }
    };

    loadFingerprint();
  }, [selectedSessionId]);

  const metrics = fingerprint?.metrics || {};
  const frequencyBands = fingerprint?.frequency_bands || {};
  const qualityFlags = fingerprint?.quality_flags || [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-forest-750">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-bio-emerald" />
            <h1 className="text-xl font-bold tracking-tight text-white font-mono">
              Soundscape Intelligence & Ecoacoustic Fingerprints
            </h1>
          </div>
          <p className="mt-1 text-xs text-forest-300 font-mono">
            Scientific indices: ACI, ADI, AEI, NDSI, Spectral Shannon Entropy, and 5-Band Acoustic Energy
          </p>
        </div>

        {/* Session Selector */}
        {sessions.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-forest-400 uppercase">SESSION:</span>
            <select
              value={selectedSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-forest-900 border border-forest-750 text-xs font-mono text-gray-200 focus:outline-none focus:border-bio-emerald cursor-pointer"
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id.slice(0, 8)}... ({s.status.toUpperCase()}) - {s.total_audio_seconds.toFixed(0)}s
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Scientific Validity Notice */}
      <div className="p-3.5 rounded-xl bg-forest-900 border border-forest-750 flex items-start gap-3 text-xs font-mono text-forest-300">
        <Info className="w-4 h-4 text-bio-emerald shrink-0 mt-0.5" />
        <div className="space-y-1 leading-relaxed text-[11px]">
          <div className="font-semibold text-white uppercase tracking-wider text-[10px]">
            Ecoacoustic Measurement Caveat
          </div>
          <p>
            Microphone frequency response, preamp gain, clipping, ambient wind/rain, and sampling
            effort directly influence ecoacoustic index values. A high or low index must not be
            interpreted as definitive proof of ecosystem health or degradation without longitudinal
            multi-season baselines.
          </p>
        </div>
      </div>

      {/* Signal Quality Indicators */}
      {qualityFlags.length > 0 && (
        <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-800/50 flex items-center justify-between text-xs font-mono text-amber-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              Quality Warnings Detected: <strong>{qualityFlags.join(', ')}</strong>
            </span>
          </div>
          <span className="text-[10px] text-amber-400">Signal Integrity Flagged</span>
        </div>
      )}

      {/* Core Ecoacoustic Indices Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* ACI */}
        <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-forest-400">ACI (COMPLEXITY)</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-forest-800 text-forest-300">
              Pieretti et al.
            </span>
          </div>
          <div className="text-2xl font-bold font-mono text-white">
            {metrics.aci !== undefined ? metrics.aci.toFixed(2) : '—'}
          </div>
          <p className="text-[10px] text-forest-400 font-mono leading-tight">
            Measures intensity variability across frequency bins. Higher values reflect biological chorus.
          </p>
        </div>

        {/* NDSI */}
        <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-forest-400">NDSI (SOUNDSCAPE)</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-forest-800 text-forest-300">
              Kasten et al.
            </span>
          </div>
          <div className="text-2xl font-bold font-mono text-bio-leaf">
            {metrics.ndsi !== undefined ? metrics.ndsi.toFixed(3) : '—'}
          </div>
          <p className="text-[10px] text-forest-400 font-mono leading-tight">
            Normalized ratio: (Biophony - Anthrophony) / (Biophony + Anthrophony). Range [-1, +1].
          </p>
        </div>

        {/* ADI */}
        <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-forest-400">ADI (DIVERSITY)</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-forest-800 text-forest-300">
              Villanueva-Rivera
            </span>
          </div>
          <div className="text-2xl font-bold font-mono text-white">
            {metrics.adi !== undefined ? metrics.adi.toFixed(2) : '—'}
          </div>
          <p className="text-[10px] text-forest-400 font-mono leading-tight">
            Shannon diversity across 1 kHz frequency bins above threshold (-50 dBFS).
          </p>
        </div>

        {/* AEI */}
        <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-forest-400">AEI (EVENNESS)</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-forest-800 text-forest-300">
              Gini coefficient
            </span>
          </div>
          <div className="text-2xl font-bold font-mono text-white">
            {metrics.aei !== undefined ? metrics.aei.toFixed(2) : '—'}
          </div>
          <p className="text-[10px] text-forest-400 font-mono leading-tight">
            Acoustic Evenness Index. 0 represents high evenness, 1 represents concentration.
          </p>
        </div>
      </div>

      {/* 5-Band Frequency Energy Distribution */}
      <div className="p-5 rounded-xl bg-forest-900 border border-forest-750 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-forest-800">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-bio-emerald" />
            <h2 className="text-sm font-bold text-white font-mono">
              Spectral Frequency-Band Energy Distribution
            </h2>
          </div>
          <span className="text-[10px] font-mono text-forest-400">5 Distinct Ecological Bands</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          {[
            { label: 'Sub-bass', range: '0 - 250 Hz', key: 'sub_bass', color: 'bg-indigo-500' },
            { label: 'Bass', range: '250 - 1000 Hz', key: 'bass', color: 'bg-cyan-500' },
            { label: 'Mid (Biophony)', range: '1 - 4 kHz', key: 'mid', color: 'bg-bio-emerald' },
            { label: 'High (Avian)', range: '4 - 11 kHz', key: 'high', color: 'bg-bio-leaf' },
            { label: 'Ultra-high', range: '11 - 16 kHz', key: 'ultra_high', color: 'bg-amber-400' },
          ].map((band) => {
            const val = (frequencyBands as any)[band.key] || 0;
            return (
              <div
                key={band.key}
                className="p-3 rounded-lg bg-forest-950 border border-forest-800 space-y-2 font-mono"
              >
                <div className="text-[10px] text-forest-400 font-semibold">{band.label}</div>
                <div className="text-[9px] text-forest-500">{band.range}</div>
                <div className="text-lg font-bold text-white">{(val * 100).toFixed(1)}%</div>
                <div className="h-1.5 w-full bg-forest-900 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${band.color} transition-all duration-300`}
                    style={{ width: `${Math.min(100, val * 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Empty State when no session exists */}
      {!loading && !fingerprint && (
        <div className="py-20 text-center rounded-xl bg-forest-900 border border-forest-750 space-y-2">
          <BarChart3 className="w-8 h-8 mx-auto text-forest-600 mb-2" />
          <div className="text-sm font-semibold text-white font-mono">
            No Soundscape Measurements
          </div>
          <p className="text-xs text-forest-400 font-mono max-w-md mx-auto">
            {selectedSite
              ? `No soundscape fingerprints recorded yet for station '${selectedSite.name}'. Start a live monitoring session to generate ecoacoustic metrics.`
              : 'Select a monitoring station or start live streaming to observe soundscape indices.'}
          </p>
        </div>
      )}
    </div>
  );
};
