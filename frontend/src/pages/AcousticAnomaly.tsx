import React, { useEffect, useState } from 'react';
import {
  Zap,
  AlertTriangle,
  Info,
  Layers,
  Search,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { useSiteContext } from '../context/SiteContext';
import { liveService } from '../services/liveService';
import { AnomalyCandidate, LiveSession } from '../types';

export const AcousticAnomaly: React.FC = () => {
  const { sites, selectedSite } = useSiteContext();

  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [anomalies, setAnomalies] = useState<AnomalyCandidate[]>([]);
  const [selectedAnomaly, setSelectedAnomaly] = useState<AnomalyCandidate | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Load sessions for site
  useEffect(() => {
    const loadSessions = async () => {
      try {
        setLoading(true);
        const data = await liveService.getSessions({
          site_id: selectedSite?.id,
          limit: 20,
        });
        setSessions(data);
        if (data.length > 0) {
          setSelectedSessionId(data[0].id);
        } else {
          setSelectedSessionId('');
          setAnomalies([]);
          setSelectedAnomaly(null);
        }
      } catch (err: any) {
        console.error('Failed to load sessions for anomaly investigation:', err);
      } finally {
        setLoading(false);
      }
    };

    loadSessions();
  }, [selectedSite?.id]);

  // Load anomalies for selected session
  useEffect(() => {
    if (!selectedSessionId) return;

    const loadAnomalies = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await liveService.getSessionAnomalies(selectedSessionId);
        setAnomalies(data);
        if (data.length > 0) {
          setSelectedAnomaly(data[0]);
        } else {
          setSelectedAnomaly(null);
        }
      } catch (err: any) {
        console.warn('No anomalies recorded for session:', err);
        setAnomalies([]);
        setSelectedAnomaly(null);
      } finally {
        setLoading(false);
      }
    };

    loadAnomalies();
  }, [selectedSessionId]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-forest-750">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-400" />
            <h1 className="text-xl font-bold tracking-tight text-white font-mono">
              Acoustic Anomaly Investigation & Outlier Detection
            </h1>
          </div>
          <p className="mt-1 text-xs text-forest-300 font-mono">
            Unsupervised acoustic novelty ranking via FAISS kNN distance, spectral entropy & model ambiguity
          </p>
        </div>

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

      {/* Mandatory Uncalibrated Heuristic Ranking Disclaimer */}
      <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-800/50 flex items-start gap-3 text-xs font-mono text-amber-200">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-amber-300 uppercase tracking-wider text-[11px]">
            Uncalibrated Heuristic Rank Disclaimer
          </div>
          <p className="text-amber-200/80 leading-relaxed text-[11px]">
            The acoustic anomaly score S ∈ [0.0, 1.0] is an uncalibrated composite heuristic
            ranking metric, NOT a calibrated probability of an ecological anomaly or rare species.
            High scores regularly arise from anthropogenic transient noise, wind turbulence, or
            microphone clipping. Human verification in the Review Lab remains mandatory.
          </p>
        </div>
      </div>

      {/* Main Dual Investigation Pane: Candidate Queue + Decomposition View */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Ranked Anomaly Candidates (6 cols) */}
        <div className="lg:col-span-6 p-4 rounded-xl bg-forest-900 border border-forest-750 flex flex-col space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-forest-800">
            <span className="text-xs font-bold text-white font-mono uppercase tracking-wider">
              Candidate Queue ({anomalies.length} outliers)
            </span>
            <span className="text-[10px] font-mono text-forest-400">Ranked by Composite Score</span>
          </div>

          <div className="space-y-2 overflow-y-auto max-h-[500px] pr-1">
            {anomalies.length > 0 ? (
              anomalies.map((cand, idx) => {
                const isSelected = selectedAnomaly?.candidate_id === cand.candidate_id;
                return (
                  <div
                    key={cand.candidate_id || idx}
                    onClick={() => setSelectedAnomaly(cand)}
                    className={`p-3 rounded-lg border text-xs font-mono cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-forest-850 border-bio-emerald text-white shadow-card-glow'
                        : 'bg-forest-950/70 border-forest-800 text-gray-300 hover:border-forest-600'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-amber-300">
                        Candidate #{idx + 1} • {cand.start_seconds.toFixed(1)}s - {cand.end_seconds.toFixed(1)}s
                      </span>
                      <span className="text-sm font-bold text-rose-400">
                        S = {cand.anomaly_score.toFixed(3)}
                      </span>
                    </div>

                    {cand.primary_reasons && cand.primary_reasons.length > 0 && (
                      <div className="text-[10px] text-forest-400 mt-1 truncate">
                        {cand.primary_reasons.join('; ')}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="py-20 text-center text-xs font-mono text-forest-400">
                {selectedSessionId
                  ? 'No acoustic anomalies detected for this monitoring session.'
                  : 'Select a session to inspect anomaly candidates.'}
              </div>
            )}
          </div>
        </div>

        {/* Right: Heuristic Metric Decomposition (6 cols) */}
        <div className="lg:col-span-6 p-4 rounded-xl bg-forest-900 border border-forest-750 flex flex-col space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-forest-800">
            <span className="text-xs font-bold text-white font-mono uppercase tracking-wider">
              Heuristic Component Decomposition
            </span>
            {selectedAnomaly && (
              <span className="text-[10px] font-mono text-forest-400">
                Window: {selectedAnomaly.duration_seconds.toFixed(1)}s
              </span>
            )}
          </div>

          {selectedAnomaly ? (
            <div className="space-y-4 font-mono text-xs">
              <div className="p-3 rounded-lg bg-forest-950 border border-forest-800 space-y-1">
                <div className="text-forest-400 text-[10px]">CANDIDATE IDENTIFIER</div>
                <div className="text-white font-semibold truncate">{selectedAnomaly.candidate_id}</div>
              </div>

              {/* Decomposed Components */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-lg bg-forest-950 border border-forest-800">
                  <span className="text-forest-400 text-[10px] block">kNN DISTANCE (d_knn)</span>
                  <span className="text-lg font-bold text-bio-leaf mt-1 block">
                    {selectedAnomaly.heuristic_breakdown?.knn_distance?.toFixed(3) ?? '—'}
                  </span>
                  <span className="text-[9px] text-forest-500">Embedding Outlier</span>
                </div>

                <div className="p-3 rounded-lg bg-forest-950 border border-forest-800">
                  <span className="text-forest-400 text-[10px] block">SPECTRAL ENTROPY (H_spec)</span>
                  <span className="text-lg font-bold text-amber-400 mt-1 block">
                    {selectedAnomaly.heuristic_breakdown?.spectral_entropy?.toFixed(3) ?? '—'}
                  </span>
                  <span className="text-[9px] text-forest-500">Shannon Disorder</span>
                </div>

                <div className="p-3 rounded-lg bg-forest-950 border border-forest-800">
                  <span className="text-forest-400 text-[10px] block">AMBIGUITY (A_model)</span>
                  <span className="text-lg font-bold text-rose-400 mt-1 block">
                    {selectedAnomaly.heuristic_breakdown?.model_ambiguity?.toFixed(3) ?? '—'}
                  </span>
                  <span className="text-[9px] text-forest-500">Low Classifier Certainty</span>
                </div>
              </div>

              {/* Primary Attribution Reasons */}
              <div className="p-3 rounded-lg bg-forest-950 border border-forest-800 space-y-2">
                <div className="text-[10px] text-forest-400 font-semibold uppercase">
                  Attribution Factors
                </div>
                <ul className="space-y-1 text-xs text-gray-300 list-disc list-inside">
                  {selectedAnomaly.primary_reasons?.map((reason, idx) => (
                    <li key={idx}>{reason}</li>
                  )) || <li>Unspecified outlier factors</li>}
                </ul>
              </div>

              {/* Disclaimer from Backend */}
              <div className="p-2.5 rounded bg-forest-950/80 border border-forest-800 text-[10px] text-forest-400 leading-normal">
                {selectedAnomaly.disclaimer}
              </div>
            </div>
          ) : (
            <div className="py-20 text-center text-xs font-mono text-forest-400">
              Select an anomaly candidate to view its mathematical decomposition.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
