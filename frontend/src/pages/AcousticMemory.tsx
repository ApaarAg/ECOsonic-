import React, { useEffect, useState, useMemo } from 'react';
import {
  Network,
  Cpu,
  Search,
  Sparkles,
  RefreshCw,
  Play,
  Volume2,
  AlertTriangle,
  Info,
  Layers,
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
import { acousticMemoryService } from '../services/acousticMemoryService';
import {
  AcousticMemoryStatus,
  AcousticMemorySearchResult,
  UMAPPoint,
  ClusteringRunResponse,
} from '../types';

export const AcousticMemory: React.FC = () => {
  const [indexStatus, setIndexStatus] = useState<AcousticMemoryStatus | null>(null);
  const [projectionPoints, setProjectionPoints] = useState<UMAPPoint[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<UMAPPoint | null>(null);
  const [similarResults, setSimilarResults] = useState<AcousticMemorySearchResult[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [rebuilding, setRebuilding] = useState<boolean>(false);
  const [clustering, setClustering] = useState<boolean>(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchMemoryData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [statusData, projData] = await Promise.all([
        acousticMemoryService.getIndexStatus().catch(() => ({
          total_vectors: 0,
          vector_dimension: 1280,
          index_type: 'FAISS IndexFlatIP',
          model_version: 'BirdNET+ V3.0 ONNX',
          is_trained: true,
        })),
        acousticMemoryService.getProjection().catch(() => ({ points: [], dimensions: 2, model_version: '' })),
      ]);

      setIndexStatus(statusData);
      setProjectionPoints(projData.points || []);
      if (projData.points && projData.points.length > 0) {
        setSelectedPoint(projData.points[0]);
      }
    } catch (err: any) {
      console.error('Failed to load acoustic memory data:', err);
      setError(err.message || 'Failed to connect to FAISS index service.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMemoryData();
  }, []);

  // When a point is selected, query its similar neighbors
  useEffect(() => {
    if (!selectedPoint) return;

    const findSimilar = async () => {
      try {
        const results = await acousticMemoryService.getSegmentSimilar(selectedPoint.segment_id, 5);
        setSimilarResults(results);
      } catch (err) {
        console.warn('Could not fetch similar segments for selected point:', err);
        setSimilarResults([]);
      }
    };

    findSimilar();
  }, [selectedPoint?.segment_id]);

  const handleRebuildIndex = async () => {
    try {
      setRebuilding(true);
      await acousticMemoryService.rebuildIndex();
      await fetchMemoryData();
    } catch (err: any) {
      setError(err.message || 'Failed to trigger vector index rebuild');
    } finally {
      setRebuilding(false);
    }
  };

  const handleRunClustering = async () => {
    try {
      setClustering(true);
      await acousticMemoryService.runClustering({ min_cluster_size: 5, min_samples: 3 });
      await fetchMemoryData();
    } catch (err: any) {
      setError(err.message || 'Clustering execution failed');
    } finally {
      setClustering(false);
    }
  };

  // Distinct colors for clusters
  const clusterColors = [
    '#34d399',
    '#06b6d4',
    '#f59e0b',
    '#8b5cf6',
    '#f43f5e',
    '#10b981',
    '#3b82f6',
    '#eab308',
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-forest-750">
        <div>
          <div className="flex items-center gap-2">
            <Network className="w-5 h-5 text-bio-emerald" />
            <h1 className="text-xl font-bold tracking-tight text-white font-mono">
              Acoustic Memory & Embedding Latent Space
            </h1>
          </div>
          <p className="mt-1 text-xs text-forest-300 font-mono">
            1,280-Dimensional BirdNET Vector Index, FAISS Cosine Similarity, HDBSCAN Clusters & UMAP
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleRunClustering}
            disabled={clustering}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-forest-900 hover:bg-forest-850 text-xs font-mono text-cyan-400 border border-forest-750 transition-colors disabled:opacity-50"
          >
            <Sparkles className={`w-3.5 h-3.5 ${clustering ? 'animate-spin' : ''}`} />
            <span>{clustering ? 'Running HDBSCAN...' : 'Run HDBSCAN'}</span>
          </button>

          <button
            onClick={handleRebuildIndex}
            disabled={rebuilding}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-bio-emerald hover:bg-bio-leaf text-forest-950 font-bold text-xs font-mono transition-colors shadow-forest-glow disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${rebuilding ? 'animate-spin' : ''}`} />
            <span>{rebuilding ? 'Rebuilding Index...' : 'Rebuild Index'}</span>
          </button>
        </div>
      </div>

      {/* Scientific Disclaimer Banner */}
      <div className="p-3.5 rounded-xl bg-forest-900 border border-forest-750 flex items-start gap-3 text-xs font-mono text-forest-300">
        <Info className="w-4 h-4 text-bio-emerald shrink-0 mt-0.5" />
        <div className="space-y-1 leading-relaxed text-[11px]">
          <div className="font-semibold text-white uppercase tracking-wider text-[10px]">
            Acoustic Similarity vs Taxonomic Identity
          </div>
          <p>
            Acoustic similarity in embedding space represents mathematical distance between
            spectrogram representations. High cosine similarity does not guarantee taxonomic
            identity; congeneric calls, mechanical harmonics, and soundscape mimics often project into
            adjacent latent clusters.
          </p>
        </div>
      </div>

      {/* Index Status Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 font-mono text-xs">
          <div className="text-forest-400 text-[10px]">TOTAL VECTORS</div>
          <div className="text-2xl font-bold text-white mt-1">
            {indexStatus?.total_vectors.toLocaleString() ?? '—'}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 font-mono text-xs">
          <div className="text-forest-400 text-[10px]">VECTOR DIMENSIONS</div>
          <div className="text-2xl font-bold text-bio-leaf mt-1">
            {indexStatus?.vector_dimension ?? 1280}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 font-mono text-xs">
          <div className="text-forest-400 text-[10px]">INDEX STRUCTURE</div>
          <div className="text-sm font-bold text-gray-200 mt-2 truncate">
            {indexStatus?.index_type ?? 'FAISS IndexFlatIP'}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 font-mono text-xs">
          <div className="text-forest-400 text-[10px]">BACKEND STATUS</div>
          <div className="text-sm font-bold text-bio-emerald mt-2 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-bio-emerald animate-pulse" />
            Synchronized
          </div>
        </div>
      </div>

      {/* Main Dual Workspace: 2D UMAP Scatter Plot + Nearest Neighbors */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: 2D UMAP Projection (7 cols) */}
        <div className="lg:col-span-7 p-4 rounded-xl bg-forest-900 border border-forest-750 flex flex-col space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-forest-800">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-bio-emerald" />
              <h2 className="text-sm font-bold text-white font-mono">
                2D UMAP Embedding Projection ({projectionPoints.length} points)
              </h2>
            </div>
            <span className="text-[10px] font-mono text-forest-400">Cosine Topology</span>
          </div>

          <div className="h-[420px] w-full bg-forest-950 rounded-lg border border-forest-800 p-2">
            {projectionPoints.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                  <XAxis
                    type="number"
                    dataKey="x"
                    name="UMAP 1"
                    stroke="#2e463c"
                    tick={{ fill: '#6fa18d', fontSize: 10, fontFamily: 'monospace' }}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name="UMAP 2"
                    stroke="#2e463c"
                    tick={{ fill: '#6fa18d', fontSize: 10, fontFamily: 'monospace' }}
                  />
                  <ZAxis range={[60, 60]} />
                  <Tooltip
                    cursor={{ strokeDasharray: '3 3' }}
                    content={({ payload }) => {
                      if (!payload || !payload.length) return null;
                      const pt: UMAPPoint = payload[0].payload;
                      return (
                        <div className="p-2.5 rounded-lg bg-forest-900 border border-bio-emerald/40 text-xs font-mono shadow-xl space-y-1">
                          <div className="font-bold text-white">{pt.label}</div>
                          <div className="text-forest-300 text-[10px]">
                            Cluster: #{pt.cluster_id} • Conf: {(pt.confidence * 100).toFixed(1)}%
                          </div>
                          <div className="text-forest-400 text-[9px]">ID: {pt.segment_id.slice(0, 8)}...</div>
                        </div>
                      );
                    }}
                  />
                  <Scatter
                    data={projectionPoints}
                    onClick={(node: any) => setSelectedPoint(node?.payload || node)}
                    cursor="pointer"
                  >
                    {projectionPoints.map((entry, index) => {
                      const isSelected = selectedPoint?.id === entry.id;
                      const color =
                        clusterColors[Math.abs(entry.cluster_id) % clusterColors.length];
                      return (
                        <Cell
                          key={`cell-${index}`}
                          fill={isSelected ? '#ffffff' : color}
                          stroke={isSelected ? '#10b981' : '#060907'}
                          strokeWidth={isSelected ? 3 : 1}
                        />
                      );
                    })}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-xs font-mono text-forest-400 space-y-2">
                <Network className="w-8 h-8 text-forest-600 mb-1" />
                <p>Insufficient embeddings to compute 2D UMAP projection.</p>
                <p className="text-[10px] text-forest-500">
                  Ingest or analyze recordings to accumulate acoustic vectors.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Selected Segment Inspection & Nearest Neighbors (5 cols) */}
        <div className="lg:col-span-5 flex flex-col space-y-4">
          {/* Selected Segment Card */}
          <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-forest-800">
              <span className="text-[10px] font-mono uppercase tracking-wider text-forest-400 font-semibold">
                Target Acoustic Vector
              </span>
              {selectedPoint && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-forest-800 text-bio-leaf font-bold">
                  Cluster #{selectedPoint.cluster_id}
                </span>
              )}
            </div>

            {selectedPoint ? (
              <div className="space-y-3">
                <div>
                  <div className="text-base font-bold text-white">{selectedPoint.label}</div>
                  <div className="text-xs text-forest-400 font-mono">
                    Segment ID: {selectedPoint.segment_id}
                  </div>
                </div>

                {/* Audio snippet player */}
                <div className="p-3 rounded-lg bg-forest-950 border border-forest-800 space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-forest-300 flex items-center gap-1.5">
                      <Volume2 className="w-3.5 h-3.5 text-bio-emerald" />
                      Audio Evidence Snippet
                    </span>
                  </div>
                  <audio
                    controls
                    src={acousticMemoryService.getSegmentAudioUrl(selectedPoint.segment_id)}
                    className="w-full h-8"
                  />
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-xs font-mono text-forest-400">
                Click any node in the UMAP scatter plot to inspect vector neighbors.
              </div>
            )}
          </div>

          {/* Nearest Neighbor Similarity Matches */}
          <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 space-y-3 flex-1">
            <div className="flex items-center justify-between pb-2 border-b border-forest-800">
              <span className="text-[10px] font-mono uppercase tracking-wider text-forest-400 font-semibold flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5 text-cyan-400" />
                Nearest Latent Neighbors (FAISS kNN)
              </span>
            </div>

            <div className="space-y-2 overflow-y-auto max-h-[260px] pr-1">
              {similarResults.length > 0 ? (
                similarResults.map((match, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded-lg bg-forest-950/70 border border-forest-800 flex items-center justify-between text-xs font-mono hover:border-forest-600 transition-colors"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="font-semibold text-gray-200 truncate">
                        {match.common_name || match.class_label || 'Unclassified Vector'}
                      </div>
                      <div className="text-[10px] text-forest-400 italic truncate">
                        {match.scientific_name || `Segment ${match.segment_id.slice(0, 8)}...`}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-bio-leaf font-bold">
                        {(match.similarity_score * 100).toFixed(1)}%
                      </span>
                      <div className="text-[9px] text-forest-400">Similarity</div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-8 text-center text-xs font-mono text-forest-400">
                  {selectedPoint
                    ? 'No nearest neighbors found above similarity threshold.'
                    : 'Awaiting target vector selection.'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
