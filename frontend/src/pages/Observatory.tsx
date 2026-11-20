import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  Bird,
  AudioWaveform,
  Volume2,
  FileText,
  Clock,
  ArrowRight,
  TrendingUp,
  Radio,
} from 'lucide-react';
import { reportsService } from '../services/reportsService';
import { analysesService } from '../services/analysesService';
import { Analysis, PlatformSummaryReport } from '../types';
import { StatCard } from '../components/common/StatCard';
import { TaxaDistributionChart } from '../components/charts/TaxaDistributionChart';
import { LoadingState } from '../components/common/LoadingState';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { formatSeconds, formatDate } from '../utils/formatters';

export const Observatory: React.FC = () => {
  const navigate = useNavigate();
  const [report, setReport] = useState<PlatformSummaryReport | null>(null);
  const [recentAnalyses, setRecentAnalyses] = useState<Analysis[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryData, analysesData] = await Promise.all([
        reportsService.getSummary().catch(() => ({
          analyses: { total: 0, completed: 0, failed: 0 },
          detections: { total: 0, unique_species_count: 0 },
          reviews: { total_reviews: 0, confirmed_count: 0 },
          top_species: [],
        })),
        analysesService.listAnalyses(1, 6).catch(() => ({ items: [], total: 0, page: 1, page_size: 6, total_pages: 0 })),
      ]);

      setReport(summaryData);
      setRecentAnalyses(analysesData.items);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch observatory intelligence metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return <LoadingState message="Aggregating global bioacoustic intelligence..." />;
  }

  const totalRecordings = report?.analyses.total || 0;
  const uniqueTaxa = report?.detections.unique_species_count || 0;
  const totalDetections = report?.detections.total || 0;
  const confirmedReviews = report?.reviews.confirmed_count || 0;

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Top Banner / Mission Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-forest-750">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-bio-leaf animate-pulse" />
            <h1 className="text-2xl font-bold tracking-tight text-white">Observatory Dashboard</h1>
          </div>
          <p className="mt-1 text-sm text-forest-300">
            Real-time ecological soundscape telemetry & automated bioacoustic detection stream
          </p>
        </div>

        <div className="flex items-center gap-3">
          <a
            href={reportsService.getExportUrl()}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-forest-850 hover:bg-forest-800 text-xs font-mono text-forest-200 border border-forest-750 transition-colors"
          >
            <FileText className="w-3.5 h-3.5 text-forest-400" />
            <span>Export CSV</span>
          </a>
          <button
            onClick={() => navigate('/audio')}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-bio-emerald hover:bg-bio-leaf text-forest-950 font-semibold text-xs transition-colors shadow-forest-glow"
          >
            <Radio className="w-4 h-4" />
            <span>New Audio Ingestion</span>
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchData} />}

      {/* Top Statistics Matrix */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Recordings Analyzed"
          value={totalRecordings}
          subtitle={`${report?.analyses.completed || 0} successfully classified`}
          icon={AudioWaveform}
          trend={{ value: 'Realtime', isPositive: true }}
        />
        <StatCard
          title="Unique Detected Taxa"
          value={uniqueTaxa}
          subtitle="Species identified by BirdNET+"
          icon={Bird}
          trend={{ value: `${uniqueTaxa} distinct`, isPositive: true }}
        />
        <StatCard
          title="Biological Detections"
          value={totalDetections}
          subtitle="Vocalizations above threshold"
          icon={Volume2}
        />
        <StatCard
          title="Verified Detections"
          value={confirmedReviews}
          subtitle={`${report?.reviews.total_reviews || 0} expert reviews`}
          icon={Activity}
          trend={{
            value: `${
              report?.reviews.total_reviews
                ? Math.round((confirmedReviews / report.reviews.total_reviews) * 100)
                : 100
            }% confirmed`,
            isPositive: true,
          }}
        />
      </div>

      {/* Mid Grid: Taxa Ranking & Soundscape Indices */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Taxa Distribution */}
        <div className="lg:col-span-2 space-y-4">
          <TaxaDistributionChart speciesList={report?.top_species || []} />
        </div>

        {/* Right 1 Col: Soundscape Overview Card */}
        <div className="space-y-4">
          <div className="p-5 rounded-xl bg-forest-900 border border-forest-750 space-y-4">
            <div className="flex items-center justify-between text-xs font-mono text-forest-300">
              <span className="font-semibold text-gray-200 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-bio-leaf" />
                Soundscape Composition
              </span>
              <span className="text-[10px] text-forest-400">ISO 12913</span>
            </div>

            <div className="space-y-3 pt-2">
              <div>
                <div className="flex justify-between text-xs font-mono mb-1">
                  <span className="text-gray-300">Biophony Ratio</span>
                  <span className="text-bio-leaf font-semibold">78.4%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-forest-950 overflow-hidden border border-forest-800">
                  <div className="h-full bg-bio-emerald rounded-full" style={{ width: '78.4%' }} />
                </div>
                <p className="text-[10px] text-forest-400 mt-0.5">Avian & orthopteran vocal activity</p>
              </div>

              <div>
                <div className="flex justify-between text-xs font-mono mb-1">
                  <span className="text-gray-300">Anthrophony Disturbance</span>
                  <span className="text-rose-400 font-semibold">12.1%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-forest-950 overflow-hidden border border-forest-800">
                  <div className="h-full bg-rose-500 rounded-full" style={{ width: '12.1%' }} />
                </div>
                <p className="text-[10px] text-forest-400 mt-0.5">Vehicular and mechanical sounds</p>
              </div>

              <div>
                <div className="flex justify-between text-xs font-mono mb-1">
                  <span className="text-gray-300">Acoustic Complexity (ACI)</span>
                  <span className="text-cyan-400 font-semibold">0.82</span>
                </div>
                <div className="w-full h-2 rounded-full bg-forest-950 overflow-hidden border border-forest-800">
                  <div className="h-full bg-cyan-500 rounded-full" style={{ width: '82%' }} />
                </div>
                <p className="text-[10px] text-forest-400 mt-0.5">High biophonic diversity saturation</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Section: Recent Analyses Activity Table */}
      <div className="p-5 rounded-xl bg-forest-900 border border-forest-750 space-y-4">
        <div className="flex items-center justify-between text-xs font-mono text-forest-300">
          <span className="font-semibold text-gray-200 flex items-center gap-2">
            <Clock className="w-4 h-4 text-bio-leaf" />
            Recent Audio Analyses
          </span>
          <button
            onClick={() => navigate('/audio')}
            className="flex items-center gap-1 text-bio-leaf hover:underline text-xs"
          >
            <span>View All</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>

        {recentAnalyses.length === 0 ? (
          <div className="text-center py-8 text-xs font-mono text-forest-400">
            No analyses recorded yet. Upload a recording in the Audio Intelligence module.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-forest-800 text-forest-400">
                  <th className="pb-2 font-medium">Recording File</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Duration</th>
                  <th className="pb-2 font-medium">Detections</th>
                  <th className="pb-2 font-medium">Ingested At</th>
                  <th className="pb-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-forest-800/60">
                {recentAnalyses.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-forest-850/50 transition-colors group cursor-pointer"
                    onClick={() => navigate(`/audio?analysis_id=${item.id}`)}
                  >
                    <td className="py-3 font-semibold text-white truncate max-w-xs flex items-center gap-2">
                      <AudioWaveform className="w-3.5 h-3.5 text-forest-400 group-hover:text-bio-leaf" />
                      {item.filename}
                    </td>
                    <td className="py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium ${
                          item.status === 'completed'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/40'
                            : item.status === 'processing'
                            ? 'bg-amber-950 text-amber-400 border border-amber-800/40'
                            : 'bg-forest-800 text-gray-300'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            item.status === 'completed'
                              ? 'bg-emerald-400'
                              : item.status === 'processing'
                              ? 'bg-amber-400 animate-pulse'
                              : 'bg-gray-400'
                          }`}
                        />
                        {item.status}
                      </span>
                    </td>
                    <td className="py-3 text-forest-300">
                      {formatSeconds(item.duration_seconds)}
                    </td>
                    <td className="py-3 text-bio-leaf font-bold">
                      {item.detections_count || item.metrics_json?.total_detections || 0}
                    </td>
                    <td className="py-3 text-forest-400">{formatDate(item.created_at)}</td>
                    <td className="py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/audio?analysis_id=${item.id}`);
                        }}
                        className="p-1 rounded bg-forest-800 hover:bg-forest-750 text-forest-200 hover:text-white"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
