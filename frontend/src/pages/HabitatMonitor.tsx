import React, { useEffect, useState } from 'react';
import {
  MapPin,
  Plus,
  Radio,
  Clock,
  Activity,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { sitesService, CreateSitePayload } from '../services/sitesService';
import { analysesService } from '../services/analysesService';
import { Site, Analysis } from '../types';
import { SiteMap } from '../components/maps/SiteMap';
import { LoadingState } from '../components/common/LoadingState';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { formatCoordinates, formatDate, formatSeconds } from '../utils/formatters';

export const HabitatMonitor: React.FC = () => {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [siteAnalyses, setSiteAnalyses] = useState<Analysis[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // New site modal state
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [newSiteName, setNewSiteName] = useState<string>('');
  const [newSiteLat, setNewSiteLat] = useState<string>('');
  const [newSiteLon, setNewSiteLon] = useState<string>('');
  const [newSiteDesc, setNewSiteDesc] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  const loadSites = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await sitesService.listSites(1, 50);
      setSites(res.items);
      if (res.items.length > 0) {
        setSelectedSite(res.items[0]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load monitoring sites');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSites();
  }, []);

  // When selected site changes, load analyses
  useEffect(() => {
    if (!selectedSite) return;
    analysesService.listAnalyses(1, 10).then((res) => {
      setSiteAnalyses(res.items);
    }).catch(console.error);
  }, [selectedSite]);

  const handleCreateSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSiteName || !newSiteLat || !newSiteLon) return;

    setSubmitting(true);
    try {
      const payload: CreateSitePayload = {
        name: newSiteName,
        latitude: parseFloat(newSiteLat),
        longitude: parseFloat(newSiteLon),
        description: newSiteDesc || undefined,
      };
      const created = await sitesService.createSite(payload);
      setSites([created, ...sites]);
      setSelectedSite(created);
      setShowAddModal(false);
      setNewSiteName('');
      setNewSiteLat('');
      setNewSiteLon('');
      setNewSiteDesc('');
    } catch (err: any) {
      setError(err.message || 'Failed to register site');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <LoadingState message="Loading geospatial monitoring stations..." />;
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-forest-750">
        <div>
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-bio-leaf" />
            <h1 className="text-2xl font-bold tracking-tight text-white">Habitat Monitor</h1>
          </div>
          <p className="mt-1 text-sm text-forest-300">
            Geographic acoustic monitoring stations, habitat soundscape baseline & disturbance telemetry
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-bio-emerald hover:bg-bio-leaf text-forest-950 font-semibold text-xs font-mono transition-colors shadow-forest-glow"
        >
          <Plus className="w-4 h-4" />
          <span>Register Station</span>
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* Grid: Map View (Left) & Station Telemetry (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left 7 Cols: Leaflet Interactive Map */}
        <div className="lg:col-span-7 space-y-4">
          <div className="h-96 w-full rounded-xl overflow-hidden border border-forest-750">
            <SiteMap
              sites={sites}
              selectedSiteId={selectedSite?.id}
              onSelectSite={(site) => setSelectedSite(site)}
              className="h-full w-full"
            />
          </div>

          {/* Stations Quick Selector */}
          <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 space-y-2">
            <span className="text-xs font-mono font-semibold text-forest-300">
              Active Monitoring Stations ({sites.length})
            </span>
            <div className="flex flex-wrap gap-2 pt-1">
              {sites.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedSite(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition-all ${
                    s.id === selectedSite?.id
                      ? 'bg-forest-850 text-white border-bio-emerald shadow-card-glow'
                      : 'bg-forest-950 text-forest-400 border-forest-800 hover:border-forest-700'
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right 5 Cols: Selected Station Telemetry & Recording History */}
        <div className="lg:col-span-5 space-y-4">
          {selectedSite ? (
            <div className="p-5 rounded-xl bg-forest-900 border border-forest-750 space-y-4">
              <div className="flex items-start justify-between pb-3 border-b border-forest-800">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-bio-leaf" />
                    {selectedSite.name}
                  </h3>
                  <p className="text-xs font-mono text-forest-400 mt-0.5">
                    {formatCoordinates(selectedSite.latitude, selectedSite.longitude)}
                  </p>
                </div>
                <span className="text-[10px] font-mono text-bio-leaf px-2 py-0.5 rounded bg-emerald-950 border border-emerald-800">
                  Active Station
                </span>
              </div>

              {selectedSite.description && (
                <p className="text-xs text-gray-300 leading-relaxed font-sans">
                  {selectedSite.description}
                </p>
              )}

              {/* Ecological Habitat Metrics */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="p-3 rounded-lg bg-forest-950 border border-forest-800 text-xs font-mono">
                  <span className="text-[10px] text-forest-400 uppercase">Avg Biophony</span>
                  <p className="text-base font-bold text-bio-leaf mt-1">81.4%</p>
                </div>
                <div className="p-3 rounded-lg bg-forest-950 border border-forest-800 text-xs font-mono">
                  <span className="text-[10px] text-forest-400 uppercase">Disturbance Index</span>
                  <p className="text-base font-bold text-cyan-400 mt-1">Low (0.14)</p>
                </div>
              </div>

              {/* Station Recording History */}
              <div className="space-y-2 pt-2 border-t border-forest-800">
                <div className="flex items-center justify-between text-xs font-mono text-forest-300">
                  <span className="font-semibold text-gray-200 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-forest-400" />
                    Recording History
                  </span>
                  <span className="text-[10px] text-forest-400">{siteAnalyses.length} runs</span>
                </div>

                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {siteAnalyses.map((item) => (
                    <div
                      key={item.id}
                      className="p-2.5 rounded-lg bg-forest-850 border border-forest-800 flex items-center justify-between text-xs font-mono"
                    >
                      <div>
                        <p className="font-semibold text-white truncate max-w-[180px]">
                          {item.filename}
                        </p>
                        <p className="text-[10px] text-forest-400">
                          {formatSeconds(item.duration_seconds)} • {formatDate(item.created_at)}
                        </p>
                      </div>

                      <span className="text-bio-leaf font-bold">
                        {item.metrics_json?.total_detections || 0} voc
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-6 rounded-xl bg-forest-900 border border-forest-750 text-center text-xs font-mono text-forest-400">
              No site selected. Register a site or pick one from the map.
            </div>
          )}
        </div>
      </div>

      {/* Register Station Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl bg-forest-900 border border-forest-700 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-forest-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <MapPin className="w-4 h-4 text-bio-leaf" />
                Register Monitoring Station
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-forest-400 hover:text-white text-xs font-mono"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSite} className="space-y-3 text-xs font-mono">
              <div>
                <label className="block text-forest-300 uppercase text-[10px] mb-1">Station Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Serengeti North Transect 04"
                  value={newSiteName}
                  onChange={(e) => setNewSiteName(e.target.value)}
                  className="w-full bg-forest-950 border border-forest-750 rounded-lg p-2 text-white outline-none focus:border-bio-emerald"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-forest-300 uppercase text-[10px] mb-1">Latitude</label>
                  <input
                    type="number"
                    step="any"
                    required
                    placeholder="-2.3333"
                    value={newSiteLat}
                    onChange={(e) => setNewSiteLat(e.target.value)}
                    className="w-full bg-forest-950 border border-forest-750 rounded-lg p-2 text-white outline-none focus:border-bio-emerald"
                  />
                </div>
                <div>
                  <label className="block text-forest-300 uppercase text-[10px] mb-1">Longitude</label>
                  <input
                    type="number"
                    step="any"
                    required
                    placeholder="34.8333"
                    value={newSiteLon}
                    onChange={(e) => setNewSiteLon(e.target.value)}
                    className="w-full bg-forest-950 border border-forest-750 rounded-lg p-2 text-white outline-none focus:border-bio-emerald"
                  />
                </div>
              </div>

              <div>
                <label className="block text-forest-300 uppercase text-[10px] mb-1">Description</label>
                <textarea
                  rows={3}
                  placeholder="Habitat characteristics, sensor hardware, elevation, foliage notes..."
                  value={newSiteDesc}
                  onChange={(e) => setNewSiteDesc(e.target.value)}
                  className="w-full bg-forest-950 border border-forest-750 rounded-lg p-2 text-white outline-none focus:border-bio-emerald font-sans text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-forest-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 rounded-lg bg-forest-800 text-forest-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-1.5 rounded-lg bg-bio-emerald hover:bg-bio-leaf text-forest-950 font-bold"
                >
                  {submitting ? 'Registering...' : 'Save Station'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
