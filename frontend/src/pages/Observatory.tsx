import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Compass,
  Radio,
  FileAudio,
  ShieldAlert,
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  RefreshCw,
  ExternalLink,
  Layers,
} from 'lucide-react';
import { useSiteContext } from '../context/SiteContext';
import { SiteMap } from '../components/maps/SiteMap';
import { liveService } from '../services/liveService';
import { detectionsService } from '../services/detectionsService';
import { environmentalService } from '../services/environmentalService';
import { reportsService } from '../services/reportsService';
import {
  Site,
  LiveSession,
  Detection,
  EnvironmentalIncident,
  PlatformSummaryReport,
} from '../types';
import { formatCoordinates, formatConfidence, formatDate } from '../utils/formatters';

export const Observatory: React.FC = () => {
  const navigate = useNavigate();
  const { sites, selectedSite, setSelectedSite, loadingSites, refreshSites } = useSiteContext();

  const [activeSessions, setActiveSessions] = useState<LiveSession[]>([]);
  const [recentDetections, setRecentDetections] = useState<Detection[]>([]);
  const [recentIncidents, setRecentIncidents] = useState<EnvironmentalIncident[]>([]);
  const [summaryReport, setSummaryReport] = useState<PlatformSummaryReport | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState<boolean>(true);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(true);

  const fetchObservatoryData = async () => {
    try {
      setLoadingMetrics(true);
      const [sessions, detections, incidents, summary] = await Promise.all([
        liveService.getSessions({ status: 'active' }).catch(() => []),
        detectionsService
          .getDetections({ site_id: selectedSite?.id, limit: 6 })
          .catch(() => []),
        environmentalService
          .getIncidents({ site_id: selectedSite?.id, limit: 4 })
          .catch(() => []),
        reportsService.getSummary({ site_id: selectedSite?.id }).catch(() => null),
      ]);

      setActiveSessions(sessions);
      setRecentDetections(detections);
      setRecentIncidents(incidents);
      setSummaryReport(summary);
    } catch (err) {
      console.error('Error fetching observatory data:', err);
    } finally {
      setLoadingMetrics(false);
    }
  };

  useEffect(() => {
    fetchObservatoryData();
  }, [selectedSite?.id]);

  const activeSiteSession = activeSessions.find(
    (s) => s.site_id === selectedSite?.id
  );

  return (
    <div className="space-y-5 flex flex-col h-full max-w-[1600px] mx-auto">
      {/* Top Banner / Mission Control */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-forest-750">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-bio-emerald animate-pulse" />
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <Compass className="w-5 h-5 text-bio-emerald" />
              Unified Bioacoustic Observatory
            </h1>
          </div>
          <p className="mt-1 text-xs text-forest-300 font-mono">
            Landscape-scale environmental acoustic intelligence & multi-station telemetry
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => {
              refreshSites();
              fetchObservatoryData();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-forest-900 hover:bg-forest-850 text-xs font-mono text-forest-300 border border-forest-750 transition-colors"
            title="Refresh observatory feeds"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingMetrics ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            onClick={() => navigate('/live')}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-bio-emerald hover:bg-bio-leaf text-forest-950 font-semibold text-xs font-mono transition-colors shadow-forest-glow"
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Start Live Stream</span>
          </button>

          <button
            onClick={() => navigate('/audio')}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-forest-850 hover:bg-forest-800 text-forest-200 border border-forest-750 text-xs font-mono transition-colors"
          >
            <FileAudio className="w-3.5 h-3.5 text-forest-400" />
            <span>Upload Audio</span>
          </button>
        </div>
      </div>

      {/* Main Observatory Workspace: Map + Collapsible Intelligence Drawer */}
      <div className="flex-1 min-h-[580px] grid grid-cols-1 lg:grid-cols-12 gap-5 relative">
        {/* Left Map View (7 to 8 columns or full if drawer closed) */}
        <div
          className={`${
            drawerOpen ? 'lg:col-span-8' : 'lg:col-span-12'
          } h-[580px] lg:h-full relative flex flex-col transition-all duration-200`}
        >
          <SiteMap
            sites={sites}
            selectedSiteId={selectedSite?.id}
            onSelectSite={(site: Site) => setSelectedSite(site)}
            className="flex-1 w-full h-full min-h-[500px]"
          />

          {/* Drawer Toggle Floating Button */}
          <button
            onClick={() => setDrawerOpen(!drawerOpen)}
            className="absolute bottom-4 right-4 z-[1000] px-3 py-1.5 rounded-lg bg-forest-950/90 backdrop-blur-md border border-forest-750 text-xs font-mono text-gray-200 hover:text-white flex items-center gap-1.5 shadow-lg"
          >
            <Layers className="w-3.5 h-3.5 text-bio-emerald" />
            <span>{drawerOpen ? 'Hide Intelligence Drawer' : 'Show Intelligence Drawer'}</span>
          </button>
        </div>

        {/* Right Collapsible Intelligence Drawer (4 columns) */}
        {drawerOpen && (
          <div className="lg:col-span-4 h-full flex flex-col space-y-4 overflow-y-auto pr-1">
            {/* Selected Station Intelligence Card */}
            <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-forest-400 font-semibold">
                  Station Intelligence
                </span>
                {selectedSite ? (
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded uppercase font-bold border ${
                      selectedSite.location_sensitivity === 'exact'
                        ? 'bg-bio-emerald/20 text-bio-leaf border-bio-emerald/40'
                        : selectedSite.location_sensitivity === 'generalized'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                        : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    }`}
                  >
                    {selectedSite.location_sensitivity}
                  </span>
                ) : null}
              </div>

              {selectedSite ? (
                <div className="space-y-2">
                  <div className="text-base font-bold text-white flex items-center justify-between">
                    <span>{selectedSite.name}</span>
                    <span className="text-xs font-mono text-forest-300 capitalize">
                      {selectedSite.ecosystem_category || 'Forest'}
                    </span>
                  </div>

                  {selectedSite.description && (
                    <p className="text-xs text-forest-300 leading-relaxed font-sans">
                      {selectedSite.description}
                    </p>
                  )}

                  <div className="pt-2 border-t border-forest-800 grid grid-cols-2 gap-2 text-xs font-mono">
                    <div>
                      <span className="text-forest-400 block text-[10px]">COORDINATES</span>
                      <span className="text-gray-200">
                        {selectedSite.location_sensitivity === 'restricted'
                          ? 'Concealed (Restricted)'
                          : selectedSite.location_sensitivity === 'generalized'
                          ? formatCoordinates(
                              selectedSite.generalized_latitude ?? selectedSite.latitude!,
                              selectedSite.generalized_longitude ?? selectedSite.longitude!
                            ) + ' (~1.1km blur)'
                          : formatCoordinates(selectedSite.latitude!, selectedSite.longitude!)}
                      </span>
                    </div>
                    <div>
                      <span className="text-forest-400 block text-[10px]">TIMEZONE</span>
                      <span className="text-gray-200">{selectedSite.timezone || 'UTC'}</span>
                    </div>
                  </div>

                  {/* Active Live Session at this site */}
                  {activeSiteSession && (
                    <div className="mt-3 p-2.5 rounded-lg bg-bio-emerald/15 border border-bio-emerald/40 flex items-center justify-between text-xs font-mono">
                      <div className="flex items-center gap-2 text-bio-leaf">
                        <Radio className="w-3.5 h-3.5 animate-pulse" />
                        <span className="font-semibold">Live Session Streaming</span>
                      </div>
                      <button
                        onClick={() => navigate('/live')}
                        className="px-2 py-0.5 rounded bg-bio-emerald text-forest-950 font-bold text-[10px] hover:bg-bio-leaf"
                      >
                        Inspect
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-6 text-center text-xs font-mono text-forest-400">
                  {loadingSites ? 'Loading station telemetry...' : 'No station selected'}
                </div>
              )}
            </div>

            {/* Recent Bioacoustic Detections Feed */}
            <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-forest-400 font-semibold flex items-center gap-1.5">
                  <BarChart3 className="w-3.5 h-3.5 text-bio-emerald" />
                  Recent Biological Detections
                </span>
                <button
                  onClick={() => navigate('/audio')}
                  className="text-[10px] font-mono text-bio-leaf hover:underline flex items-center gap-1"
                >
                  View All <ChevronRight className="w-3 h-3" />
                </button>
              </div>

              {recentDetections.length > 0 ? (
                <div className="space-y-2">
                  {recentDetections.map((det) => (
                    <div
                      key={det.id}
                      className="p-2.5 rounded-lg bg-forest-950/60 border border-forest-800 flex items-center justify-between text-xs"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-medium text-white truncate">
                          {det.common_name || det.class_label}
                        </div>
                        <div className="text-[10px] text-forest-400 font-mono italic truncate">
                          {det.scientific_name}
                        </div>
                      </div>
                      <div className="text-right font-mono shrink-0">
                        <div className="text-bio-leaf font-bold">
                          {formatConfidence(det.confidence_score)}
                        </div>
                        <span className="text-[9px] px-1 py-0.2 rounded bg-forest-800 text-forest-300 uppercase">
                          {det.review_status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-5 text-center text-xs font-mono text-forest-400">
                  No biological detections recorded for this station.
                </div>
              )}
            </div>

            {/* Recent Disturbance Radar Incidents */}
            <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-forest-400 font-semibold flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                  Disturbance Radar Bouts
                </span>
                <button
                  onClick={() => navigate('/disturbances')}
                  className="text-[10px] font-mono text-amber-300 hover:underline flex items-center gap-1"
                >
                  Radar <ChevronRight className="w-3 h-3" />
                </button>
              </div>

              {recentIncidents.length > 0 ? (
                <div className="space-y-2">
                  {recentIncidents.map((inc) => (
                    <div
                      key={inc.id}
                      className="p-2.5 rounded-lg bg-forest-950/60 border border-forest-800 flex items-center justify-between text-xs"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-medium text-gray-200 truncate">{inc.title}</div>
                        <div className="text-[10px] text-forest-400 font-mono capitalize">
                          {inc.category} • {formatDate(inc.created_at)}
                        </div>
                      </div>
                      <div className="text-right font-mono shrink-0">
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                            inc.priority === 'critical'
                              ? 'bg-rose-950 text-rose-300 border border-rose-800'
                              : 'bg-amber-950 text-amber-300 border border-amber-800'
                          }`}
                        >
                          {inc.priority}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-5 text-center text-xs font-mono text-forest-400">
                  No active environmental disturbance bouts.
                </div>
              )}
            </div>

            {/* Quick Scientific Guidance Pill */}
            <div className="p-3 rounded-lg bg-forest-950/70 border border-forest-800 text-[10px] font-mono text-forest-400 leading-normal space-y-1">
              <div className="text-forest-200 font-semibold flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-amber-400" />
                Scientific Rigor Notice
              </div>
              <p>
                Acoustic detection confidence reflects model pattern matching, not confirmed animal
                abundance. Stationary microphone coordinates identify recording stations, not
                animal positions.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
