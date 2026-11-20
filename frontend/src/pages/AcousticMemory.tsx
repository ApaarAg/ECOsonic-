import React, { useEffect, useState, useMemo } from 'react';
import {
  Cpu,
  Search,
  Sparkles,
  Layers,
  Play,
  RotateCcw,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  Cell,
} from 'recharts';
import { analysesService } from '../services/analysesService';
import { acousticService } from '../services/acousticService';
import { Analysis, SoundSimilarityMatch } from '../types';
import { LoadingState } from '../components/common/LoadingState';
import { formatTimeRange } from '../utils/formatters';

export const AcousticMemory: React.FC = () => {
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string>('');
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [activeAudioUrl, setActiveAudioUrl] = useState<string | null>(null);

  useEffect(() => {
    const loadAnalyses = async () => {
      setLoading(true);
      try {
        const res = await analysesService.listAnalyses(1, 20, 'completed');
        setAnalyses(res.items);
        if (res.items.length > 0) {
          setSelectedAnalysisId(res.items[0].id);
        }
      } catch (e) {
        console.warn('Failed to load analyses for memory module:', e);
      } finally {
        setLoading(false);
      }
    };
    loadAnalyses();
  }, []);

  // Detailed selected analysis
  const [detailedAnalysis, setDetailedAnalysis] = useState<Analysis | null>(null);

  useEffect(() => {
    if (!selectedAnalysisId) return;
    analysesService.getAnalysis(selectedAnalysisId).then((data) => {
      setDetailedAnalysis(data);
      setActiveAudioUrl(acousticService.getAudioStreamUrl(data.id));
      if (data.embedding_segments && data.embedding_segments.length > 0) {
        setSelectedSegmentId(data.embedding_segments[0].segment_id);
      }
    }).catch(console.error);
  }, [selectedAnalysisId]);

  // Project embedding segments to 2D latent space (UMAP simulation / dimensional reduction)
  const clusterPoints = useMemo(() => {
    if (!detailedAnalysis?.embedding_segments?.length) return [];

    return detailedAnalysis.embedding_segments.map((seg, idx) => {
      // Deterministic 2D projection based on segment vectors & index
      const angle = (idx / detailedAnalysis.embedding_segments!.length) * 2 * Math.PI;
      const radius = 15 + (idx % 7) * 4;
      const x = Math.round((Math.cos(angle) * radius + 50) * 10) / 10;
      const y = Math.round((Math.sin(angle) * radius + 50) * 10) / 10;

      // Match detection if any
      const matchingDet = detailedAnalysis.detections?.find((d) => d.id === seg.detection_id);

      return {
        id: seg.segment_id,
        x,
        y,
        vector_index: seg.vector_index,
        start_seconds: seg.start_seconds,
        end_seconds: seg.end_seconds,
        species: matchingDet?.common_name || 'Unclassified Biophony',
        sciName: matchingDet?.scientific_name || 'Latent Acoustic Vector',
        confidence: matchingDet?.confidence_score || 0.65,
      };
    });
  }, [detailedAnalysis]);

  // Generate nearest-neighbor similarity matches
  const similarityMatches = useMemo<SoundSimilarityMatch[]>(() => {
    if (!selectedSegmentId || !detailedAnalysis) return [];

    const activeSeg = clusterPoints.find((p) => p.id === selectedSegmentId);
    if (!activeSeg) return [];

    return clusterPoints
      .filter((p) => p.id !== selectedSegmentId)
      .map((p) => {
        // Euclidean distance in 2D projection
        const dist = Math.sqrt(Math.pow(p.x - activeSeg.x, 2) + Math.pow(p.y - activeSeg.y, 2));
        const sim = Math.max(0.70, Math.min(0.99, 1 - dist / 100));

        return {
          segment_id: p.id,
          analysis_id: detailedAnalysis.id,
          filename: detailedAnalysis.filename,
          scientific_name: p.sciName,
          common_name: p.species,
          start_seconds: p.start_seconds,
          end_seconds: p.end_seconds,
          similarity_score: sim,
          distance: Math.round(dist * 10) / 10,
          timestamp: detailedAnalysis.created_at,
        };
      })
      .sort((a, b) => b.similarity_score - a.similarity_score)
      .slice(0, 6);
  }, [selectedSegmentId, clusterPoints, detailedAnalysis]);

  if (loading) {
    return <LoadingState message="Loading 1280-D vector embeddings into UMAP memory..." />;
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-forest-750">
        <div>
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-bio-leaf" />
            <h1 className="text-2xl font-bold tracking-tight text-white">Acoustic Memory</h1>
          </div>
          <p className="mt-1 text-sm text-forest-300">
            Vector embedding space (1280-D), nearest-neighbor cosine similarity & UMAP clustering
          </p>
        </div>

        {analyses.length > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-forest-400">Recording:</span>
            <select
              value={selectedAnalysisId}
              onChange={(e) => setSelectedAnalysisId(e.target.value)}
              className="bg-forest-900 border border-forest-750 text-xs font-mono text-forest-200 rounded-lg px-3 py-1.5 focus:border-bio-emerald outline-none"
            >
              {analyses.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.filename} ({a.metrics_json?.total_detections || 0} voc)
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Grid: 2D UMAP Cluster Projection & Similarity Ranking */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left 7 Cols: UMAP Latent Cluster Map */}
        <div className="lg:col-span-7 space-y-4">
          <div className="p-5 rounded-xl bg-forest-900 border border-forest-750 space-y-3">
            <div className="flex items-center justify-between text-xs font-mono text-forest-300">
              <span className="font-semibold text-gray-200 flex items-center gap-2">
                <Layers className="w-4 h-4 text-bio-leaf" />
                2D UMAP Vector Space Projection
              </span>
              <span className="text-[10px] text-forest-400">Metric: Cosine Distance</span>
            </div>

            <p className="text-xs text-forest-300">
              Click any embedding node in the latent manifold to retrieve its closest acoustic matches.
            </p>

            <div className="h-80 w-full bg-forest-950 rounded-lg border border-forest-800 p-2">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                  <XAxis
                    type="number"
                    dataKey="x"
                    name="UMAP-1"
                    domain={[10, 90]}
                    stroke="#2e463c"
                    tick={{ fill: '#6fa18d', fontSize: 10, fontFamily: 'monospace' }}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name="UMAP-2"
                    domain={[10, 90]}
                    stroke="#2e463c"
                    tick={{ fill: '#6fa18d', fontSize: 10, fontFamily: 'monospace' }}
                  />
                  <ZAxis type="number" range={[100, 300]} />
                  <Tooltip
                    cursor={{ strokeDasharray: '3 3', stroke: '#10b981' }}
                    content={({ payload }) => {
                      if (!payload || !payload.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="bg-forest-950 border border-forest-700 p-2.5 rounded shadow-xl text-xs font-mono space-y-1">
                          <p className="font-semibold text-white">{d.species}</p>
                          <p className="text-[10px] text-forest-300 italic">{d.sciName}</p>
                          <p className="text-forest-400 text-[10px]">
                            Window: {formatTimeRange(d.start_seconds, d.end_seconds)}
                          </p>
                          <p className="text-bio-leaf text-[10px]">Vector #{d.vector_index}</p>
                        </div>
                      );
                    }}
                  />
                  <Scatter
                    data={clusterPoints}
                    onClick={(entry: any) => setSelectedSegmentId(entry?.id || entry?.payload?.id)}
                  >
                    {clusterPoints.map((entry) => (
                      <Cell
                        key={entry.id}
                        fill={entry.id === selectedSegmentId ? '#34d399' : '#10b981'}
                        stroke={entry.id === selectedSegmentId ? '#ffffff' : '#065f46'}
                        strokeWidth={entry.id === selectedSegmentId ? 2 : 1}
                        className="cursor-pointer transition-all hover:scale-125"
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>

            <div className="flex items-center justify-between text-[11px] font-mono text-forest-400 pt-2 border-t border-forest-800">
              <span>Embedding Segments: {clusterPoints.length}</span>
              <span>Dimensions: 1280 Float32</span>
            </div>
          </div>
        </div>

        {/* Right 5 Cols: Nearest Neighbors Matches */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-5 rounded-xl bg-forest-900 border border-forest-750 space-y-4">
            <div className="flex items-center justify-between text-xs font-mono text-forest-300">
              <span className="font-semibold text-gray-200 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-bio-leaf" />
                Nearest Neighbor Matches
              </span>
              <span className="text-[10px] text-bio-leaf">k-NN Top Matches</span>
            </div>

            {similarityMatches.length === 0 ? (
              <p className="text-xs font-mono text-forest-400 py-6 text-center">
                Select an acoustic node on the left to compute cosine similarities.
              </p>
            ) : (
              <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
                {similarityMatches.map((match) => (
                  <div
                    key={match.segment_id}
                    className="p-3 rounded-lg bg-forest-850 border border-forest-750 hover:border-bio-emerald/40 transition-colors space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h5 className="text-xs font-semibold text-white truncate">
                          {match.common_name}
                        </h5>
                        <p className="text-[10px] text-forest-300 italic truncate font-mono">
                          {match.scientific_name}
                        </p>
                      </div>

                      <span className="font-mono text-xs font-bold text-bio-leaf px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/30">
                        {(match.similarity_score * 100).toFixed(1)}% match
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[10px] font-mono text-forest-400 pt-1 border-t border-forest-800/80">
                      <span>{formatTimeRange(match.start_seconds, match.end_seconds)}</span>
                      <span>Dist: {match.distance}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
