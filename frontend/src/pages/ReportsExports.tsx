import React, { useEffect, useState } from 'react';
import {
  FileSpreadsheet,
  Download,
  FileText,
  BarChart3,
  Calendar,
  CheckCircle2,
  RefreshCw,
  Database,
  Layers,
} from 'lucide-react';
import { useSiteContext } from '../context/SiteContext';
import { reportsService } from '../services/reportsService';
import { PlatformSummaryReport } from '../types';

export const ReportsExports: React.FC = () => {
  const { sites, selectedSite } = useSiteContext();

  const [summary, setSummary] = useState<PlatformSummaryReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Export filters
  const [exportType, setExportType] = useState<'detections' | 'disturbances' | 'soundscape' | 'habitat_drift'>('detections');
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const fetchSummary = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await reportsService.getSummary({ site_id: selectedSite?.id });
      setSummary(data);
    } catch (err: any) {
      console.error('Failed to load reports summary:', err);
      setError(err.message || 'Failed to load platform summary metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, [selectedSite?.id]);

  const handleDownload = async () => {
    try {
      setDownloading(`${exportType}_${exportFormat}`);
      setError(null);
      await reportsService.downloadExport({
        export_type: exportType,
        format: exportFormat,
        site_id: selectedSite?.id,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      });
    } catch (err: any) {
      setError(err.message || 'Export generation failed');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-forest-750">
        <div>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-bio-emerald" />
            <h1 className="text-xl font-bold tracking-tight text-white font-mono">
              Ecological Reports & Research Data Exports
            </h1>
          </div>
          <p className="mt-1 text-xs text-forest-300 font-mono">
            Standardized dataset generation for R packages, Python / Pandas modeling & QGIS spatial layers
          </p>
        </div>

        <button
          onClick={fetchSummary}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-forest-900 hover:bg-forest-850 text-xs font-mono text-forest-300 border border-forest-750 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Metrics</span>
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-rose-950/80 border border-rose-800 text-xs text-rose-300 font-mono">
          {error}
        </div>
      )}

      {/* Summary Platform Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 font-mono text-xs">
          <div className="text-forest-400 text-[10px]">RECORDINGS ANALYZED</div>
          <div className="text-2xl font-bold text-white mt-1">
            {summary?.analyses?.completed ?? 0}
          </div>
          <span className="text-[9px] text-forest-500">
            Total files: {summary?.analyses?.total ?? 0}
          </span>
        </div>

        <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 font-mono text-xs">
          <div className="text-forest-400 text-[10px]">BIOLOGICAL DETECTIONS</div>
          <div className="text-2xl font-bold text-bio-leaf mt-1">
            {summary?.detections?.total.toLocaleString() ?? 0}
          </div>
          <span className="text-[9px] text-forest-500">
            Unique species: {summary?.detections?.unique_species_count ?? 0}
          </span>
        </div>

        <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 font-mono text-xs">
          <div className="text-forest-400 text-[10px]">HUMAN REVIEWS</div>
          <div className="text-2xl font-bold text-cyan-400 mt-1">
            {summary?.reviews?.total_reviews ?? 0}
          </div>
          <span className="text-[9px] text-forest-500">
            Confirmed: {summary?.reviews?.confirmed_count ?? 0}
          </span>
        </div>

        <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 font-mono text-xs">
          <div className="text-forest-400 text-[10px]">STATION SCOPE</div>
          <div className="text-sm font-bold text-gray-200 mt-2 truncate">
            {selectedSite ? selectedSite.name : 'All Registered Stations'}
          </div>
          <span className="text-[9px] text-forest-500">Active monitoring filter</span>
        </div>
      </div>

      {/* Research Export Center Form */}
      <div className="p-6 rounded-xl bg-forest-900 border border-forest-750 space-y-6">
        <div className="pb-3 border-b border-forest-800">
          <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider flex items-center gap-2">
            <Download className="w-4 h-4 text-bio-emerald" />
            Research Dataset Generator
          </h2>
          <p className="text-xs text-forest-400 font-mono mt-1">
            Select data table, output serialization format, and optional temporal filters.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-mono text-xs">
          {/* Data Type */}
          <div className="space-y-1.5">
            <label className="text-[10px] text-forest-400 block font-semibold uppercase">
              Export Dataset
            </label>
            <select
              value={exportType}
              onChange={(e) => setExportType(e.target.value as any)}
              className="w-full px-3 py-2 rounded-lg bg-forest-950 border border-forest-800 text-gray-200 focus:outline-none focus:border-bio-emerald text-xs cursor-pointer"
            >
              <option value="detections">Biological Detections Inventory</option>
              <option value="disturbances">Disturbance Radar Events</option>
              <option value="soundscape">Soundscape Fingerprint Indices</option>
              <option value="habitat_drift">Habitat Drift Observations</option>
            </select>
          </div>

          {/* Format */}
          <div className="space-y-1.5">
            <label className="text-[10px] text-forest-400 block font-semibold uppercase">
              File Format
            </label>
            <select
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as any)}
              className="w-full px-3 py-2 rounded-lg bg-forest-950 border border-forest-800 text-gray-200 focus:outline-none focus:border-bio-emerald text-xs cursor-pointer"
            >
              <option value="csv">CSV (Comma-Separated Values)</option>
              <option value="json">JSON (Structured Hierarchy)</option>
            </select>
          </div>

          {/* Start Date */}
          <div className="space-y-1.5">
            <label className="text-[10px] text-forest-400 block font-semibold uppercase">
              Start Date (Optional)
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg bg-forest-950 border border-forest-800 text-gray-200 focus:outline-none focus:border-bio-emerald text-xs cursor-pointer"
            />
          </div>

          {/* End Date */}
          <div className="space-y-1.5">
            <label className="text-[10px] text-forest-400 block font-semibold uppercase">
              End Date (Optional)
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg bg-forest-950 border border-forest-800 text-gray-200 focus:outline-none focus:border-bio-emerald text-xs cursor-pointer"
            />
          </div>
        </div>

        {/* Download Action Trigger */}
        <div className="pt-4 border-t border-forest-800 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-xs font-mono text-forest-400">
            Export target: <strong className="text-white">{exportType.toUpperCase()}</strong> in{' '}
            <strong className="text-bio-leaf">{exportFormat.toUpperCase()}</strong> format.
          </div>

          <button
            onClick={handleDownload}
            disabled={downloading !== null}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-bio-emerald hover:bg-bio-leaf text-forest-950 font-bold text-xs font-mono transition-colors shadow-forest-glow disabled:opacity-50"
          >
            <Download className={`w-4 h-4 ${downloading ? 'animate-bounce' : ''}`} />
            <span>{downloading ? 'Generating Dataset...' : 'Download Export File'}</span>
          </button>
        </div>
      </div>

      {/* Top Detected Taxa Summary Table */}
      {summary?.top_species && summary.top_species.length > 0 && (
        <div className="p-5 rounded-xl bg-forest-900 border border-forest-750 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-forest-800">
            <h2 className="text-sm font-bold text-white font-mono">
              Most Frequently Detected Biological Taxa
            </h2>
            <span className="text-[10px] font-mono text-forest-400">Station Summary</span>
          </div>

          <div className="space-y-2">
            {summary.top_species.map((sp, idx) => (
              <div
                key={idx}
                className="p-3 rounded-lg bg-forest-950 border border-forest-800 flex items-center justify-between text-xs font-mono"
              >
                <div>
                  <div className="font-semibold text-white">{sp.common_name}</div>
                  <div className="text-[10px] text-forest-400 italic">{sp.scientific_name}</div>
                </div>
                <div className="text-right">
                  <span className="font-bold text-bio-leaf">{sp.detection_count} detections</span>
                  <div className="text-[10px] text-forest-400">
                    Max Conf: {(sp.max_confidence * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
