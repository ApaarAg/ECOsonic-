import React, { useEffect, useState } from 'react';
import {
  ShieldAlert,
  AlertTriangle,
  Filter,
  CheckCircle2,
  Clock,
  Layers,
  Search,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { useSiteContext } from '../context/SiteContext';
import { environmentalService } from '../services/environmentalService';
import { liveService } from '../services/liveService';
import { EnvironmentalIncident } from '../types';
import { formatDate } from '../utils/formatters';

export const DisturbanceRadar: React.FC = () => {
  const { sites, selectedSite } = useSiteContext();

  const [incidents, setIncidents] = useState<EnvironmentalIncident[]>([]);
  const [taxonomy, setTaxonomy] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [incData, taxData] = await Promise.all([
        environmentalService.getIncidents({
          site_id: selectedSite?.id,
          priority: priorityFilter !== 'all' ? priorityFilter : undefined,
          status: statusFilter !== 'all' ? statusFilter : undefined,
          category: categoryFilter !== 'all' ? categoryFilter : undefined,
        }),
        liveService.getDisturbanceTaxonomy().catch(() => ({})),
      ]);

      setIncidents(incData);
      setTaxonomy(taxData);
    } catch (err: any) {
      console.error('Failed to load disturbance radar data:', err);
      setError(err.message || 'Failed to retrieve disturbance incidents.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedSite?.id, priorityFilter, statusFilter, categoryFilter]);

  const filteredIncidents = incidents.filter((inc) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      inc.title.toLowerCase().includes(term) ||
      inc.incident_code.toLowerCase().includes(term) ||
      inc.category.toLowerCase().includes(term)
    );
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-forest-750">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-400" />
            <h1 className="text-xl font-bold tracking-tight text-white font-mono">
              Disturbance Radar & Anthrophony Investigation
            </h1>
          </div>
          <p className="mt-1 text-xs text-forest-300 font-mono">
            Automated screening of mechanical anthrophony, chainsaw, gunfire, and acoustic hazards
          </p>
        </div>

        <button
          onClick={fetchData}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-forest-900 hover:bg-forest-850 text-xs font-mono text-forest-300 border border-forest-750 transition-colors self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Incidents</span>
        </button>
      </div>

      {/* Mandatory Scientific & Legal Disclaimer Banner */}
      <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-800/50 flex items-start gap-3 text-xs font-mono text-amber-200">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-amber-300 uppercase tracking-wider text-[11px]">
            Investigation Prioritization Notice
          </div>
          <p className="text-amber-200/80 leading-relaxed text-[11px]">
            Disturbance Radar severity tiers (Critical, Medium, Low) are automated heuristic
            screening classifications intended strictly for ranger and field team triage. They do
            not independently constitute proof of criminal activity, illegal logging, or law
            enforcement violations.
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs font-mono">
        <div>
          <label className="text-[10px] text-forest-400 block mb-1">SEARCH BOUTS</label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-forest-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Filter by title, code..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-forest-950 border border-forest-800 text-gray-200 focus:outline-none focus:border-bio-emerald text-xs"
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] text-forest-400 block mb-1">PRIORITY TIER</label>
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="w-full px-3 py-1.5 rounded-lg bg-forest-950 border border-forest-800 text-gray-200 focus:outline-none focus:border-bio-emerald text-xs cursor-pointer"
          >
            <option value="all">All Priorities</option>
            <option value="critical">Critical Tier</option>
            <option value="medium">Medium Tier</option>
            <option value="low">Low Tier</option>
          </select>
        </div>

        <div>
          <label className="text-[10px] text-forest-400 block mb-1">STATUS</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full px-3 py-1.5 rounded-lg bg-forest-950 border border-forest-800 text-gray-200 focus:outline-none focus:border-bio-emerald text-xs cursor-pointer"
          >
            <option value="all">All Statuses</option>
            <option value="open">Open</option>
            <option value="investigating">Investigating</option>
            <option value="resolved">Resolved</option>
            <option value="false_positive">False Positive</option>
          </select>
        </div>

        <div>
          <label className="text-[10px] text-forest-400 block mb-1">CATEGORY</label>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full px-3 py-1.5 rounded-lg bg-forest-950 border border-forest-800 text-gray-200 focus:outline-none focus:border-bio-emerald text-xs cursor-pointer"
          >
            <option value="all">All Categories</option>
            <option value="anthrophony">Anthrophony</option>
            <option value="geophony">Geophony</option>
            <option value="biophony">Biophony</option>
          </select>
        </div>

        <div>
          <label className="text-[10px] text-forest-400 block mb-1">SITE SCOPE</label>
          <div className="py-1.5 px-3 rounded-lg bg-forest-950/60 border border-forest-800 text-forest-300 truncate">
            {selectedSite ? selectedSite.name : 'All Registered Sites'}
          </div>
        </div>
      </div>

      {/* Incidents Grid */}
      {loading ? (
        <div className="py-20 text-center text-xs font-mono text-forest-400">
          <RefreshCw className="w-6 h-6 mx-auto animate-spin text-bio-emerald mb-2" />
          Querying environmental disturbance incidents...
        </div>
      ) : filteredIncidents.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredIncidents.map((inc) => (
            <div
              key={inc.id}
              className="p-4 rounded-xl bg-forest-900 border border-forest-750 flex flex-col justify-between space-y-4 hover:border-forest-600 transition-colors"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-forest-400 font-semibold tracking-wider">
                    {inc.incident_code}
                  </span>
                  <span
                    className={`text-[9px] font-mono px-2 py-0.5 rounded uppercase font-bold border ${
                      inc.priority === 'critical'
                        ? 'bg-rose-950 text-rose-300 border-rose-800'
                        : inc.priority === 'medium'
                        ? 'bg-amber-950 text-amber-300 border-amber-800'
                        : 'bg-forest-800 text-forest-300 border-forest-700'
                    }`}
                  >
                    {inc.priority}
                  </span>
                </div>

                <div className="text-sm font-bold text-white leading-snug">{inc.title}</div>

                <div className="flex items-center gap-2 text-xs font-mono text-forest-400">
                  <span className="capitalize">{inc.category}</span>
                  <span>•</span>
                  <span>{formatDate(inc.created_at)}</span>
                </div>

                {inc.investigation_notes && (
                  <p className="text-xs text-gray-300 pt-2 border-t border-forest-800 font-sans leading-relaxed">
                    {inc.investigation_notes}
                  </p>
                )}
              </div>

              <div className="pt-3 border-t border-forest-800 flex items-center justify-between text-xs font-mono">
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-semibold uppercase ${
                    inc.status === 'open'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : inc.status === 'investigating'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                      : 'bg-bio-emerald/20 text-bio-leaf border border-bio-emerald/30'
                  }`}
                >
                  {inc.status.replace(/_/g, ' ')}
                </span>

                <div className="text-[10px] text-forest-400">
                  {inc.event_ids?.length || 1} Event Bouts
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-24 text-center rounded-xl bg-forest-900 border border-forest-750 space-y-2">
          <ShieldAlert className="w-8 h-8 mx-auto text-forest-600 mb-2" />
          <div className="text-sm font-semibold text-white font-mono">
            No Disturbance Bouts Found
          </div>
          <p className="text-xs text-forest-400 font-mono max-w-md mx-auto">
            {selectedSite
              ? `No active environmental disturbances recorded for station '${selectedSite.name}'.`
              : 'No environmental disturbances recorded across monitoring stations.'}
          </p>
        </div>
      )}
    </div>
  );
};
