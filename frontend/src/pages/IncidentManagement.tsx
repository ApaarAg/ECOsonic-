import React, { useEffect, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  Search,
  CheckCircle2,
  Clock,
  Filter,
  RefreshCw,
  FileText,
  Shield,
  Edit3,
} from 'lucide-react';
import { useSiteContext } from '../context/SiteContext';
import { environmentalService } from '../services/environmentalService';
import { EnvironmentalIncident } from '../types';
import { formatDate } from '../utils/formatters';

export const IncidentManagement: React.FC = () => {
  const { sites, selectedSite } = useSiteContext();

  const [incidents, setIncidents] = useState<EnvironmentalIncident[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<EnvironmentalIncident | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [updating, setUpdating] = useState<boolean>(false);
  const [investigationNotes, setInvestigationNotes] = useState<string>('');
  const [resolutionNotes, setResolutionNotes] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const fetchIncidents = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await environmentalService.getIncidents({
        site_id: selectedSite?.id,
        priority: priorityFilter !== 'all' ? priorityFilter : undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        limit: 50,
      });
      setIncidents(data);
      if (data.length > 0) {
        setSelectedIncident(data[0]);
        setInvestigationNotes(data[0].investigation_notes || '');
        setResolutionNotes(data[0].resolution_notes || '');
      } else {
        setSelectedIncident(null);
      }
    } catch (err: any) {
      console.error('Failed to load incidents:', err);
      setError(err.message || 'Failed to fetch environmental incidents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIncidents();
  }, [selectedSite?.id, priorityFilter, statusFilter]);

  const handleUpdateStatus = async (newStatus: 'open' | 'investigating' | 'resolved' | 'false_positive') => {
    if (!selectedIncident) return;

    try {
      setUpdating(true);
      const updated = await environmentalService.updateIncident(selectedIncident.id, {
        status: newStatus,
        investigation_notes: investigationNotes.trim() || undefined,
        resolution_notes: resolutionNotes.trim() || undefined,
      });

      setSelectedIncident(updated);
      setIncidents((prev) => prev.map((inc) => (inc.id === updated.id ? updated : inc)));
    } catch (err: any) {
      setError(err.message || 'Failed to update incident status');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-forest-750">
        <div>
          <div className="flex items-center gap-2">
            <AlertOctagon className="w-5 h-5 text-rose-400" />
            <h1 className="text-xl font-bold tracking-tight text-white font-mono">
              Environmental Incident Management
            </h1>
          </div>
          <p className="mt-1 text-xs text-forest-300 font-mono">
            Consolidated disturbance bouts, ranger triage, investigation audit trails & resolutions
          </p>
        </div>

        {/* Filters & Refresh */}
        <div className="flex items-center gap-3">
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-forest-900 border border-forest-750 text-xs font-mono text-gray-200 focus:outline-none focus:border-bio-emerald cursor-pointer"
          >
            <option value="all">All Priorities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-forest-900 border border-forest-750 text-xs font-mono text-gray-200 focus:outline-none focus:border-bio-emerald cursor-pointer"
          >
            <option value="all">All Statuses</option>
            <option value="open">Open</option>
            <option value="investigating">Investigating</option>
            <option value="resolved">Resolved</option>
            <option value="false_positive">False Positive</option>
          </select>

          <button
            onClick={fetchIncidents}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-forest-900 hover:bg-forest-850 text-xs font-mono text-forest-300 border border-forest-750 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Statutory Enforcement Boundary Disclaimer */}
      <div className="p-3.5 rounded-xl bg-forest-900 border border-forest-750 flex items-start gap-3 text-xs font-mono text-forest-300">
        <Shield className="w-4 h-4 text-bio-emerald shrink-0 mt-0.5" />
        <div className="space-y-1 leading-relaxed text-[11px]">
          <div className="font-semibold text-white uppercase tracking-wider text-[10px]">
            Operational Boundary Disclaimer
          </div>
          <p>
            Environmental incidents represent automated screening aggregations. Acoustic
            classifications do not constitute proof of criminal activity, illegal logging, or law
            enforcement violations. Field ground-truthing and physical chain of custody remain
            mandatory for legal actions.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-rose-950/80 border border-rose-800 text-xs text-rose-300 font-mono">
          {error}
        </div>
      )}

      {/* Main Dual Investigation Pane */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Incidents List (5 cols) */}
        <div className="lg:col-span-5 p-4 rounded-xl bg-forest-900 border border-forest-750 flex flex-col space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-forest-800">
            <span className="text-xs font-bold text-white font-mono uppercase tracking-wider">
              Incident Bouts ({incidents.length})
            </span>
            <span className="text-[10px] font-mono text-forest-400">
              {selectedSite ? selectedSite.name : 'All Stations'}
            </span>
          </div>

          <div className="space-y-2 overflow-y-auto max-h-[560px] pr-1">
            {incidents.length > 0 ? (
              incidents.map((inc) => {
                const isSelected = selectedIncident?.id === inc.id;
                return (
                  <div
                    key={inc.id}
                    onClick={() => {
                      setSelectedIncident(inc);
                      setInvestigationNotes(inc.investigation_notes || '');
                      setResolutionNotes(inc.resolution_notes || '');
                    }}
                    className={`p-3 rounded-lg border text-xs font-mono cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-forest-850 border-bio-emerald text-white shadow-card-glow'
                        : 'bg-forest-950/70 border-forest-800 text-gray-300 hover:border-forest-600'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white truncate max-w-[200px]">
                        {inc.title}
                      </span>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase border ${
                          inc.priority === 'critical'
                            ? 'bg-rose-950 text-rose-300 border-rose-800'
                            : 'bg-amber-950 text-amber-300 border-amber-800'
                        }`}
                      >
                        {inc.priority}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-forest-400 mt-2">
                      <span>{inc.incident_code}</span>
                      <span className="capitalize">{inc.status.replace(/_/g, ' ')}</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="py-24 text-center text-xs font-mono text-forest-400">
                No environmental incidents recorded for this station.
              </div>
            )}
          </div>
        </div>

        {/* Right: Incident Dossier & Status Transition Desk (7 cols) */}
        <div className="lg:col-span-7 p-5 rounded-xl bg-forest-900 border border-forest-750 flex flex-col space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-forest-800">
            <span className="text-xs font-bold text-white font-mono uppercase tracking-wider">
              Incident Investigation Dossier
            </span>
            {selectedIncident && (
              <span className="text-[10px] font-mono text-forest-400">
                Code: {selectedIncident.incident_code}
              </span>
            )}
          </div>

          {selectedIncident ? (
            <div className="space-y-4 font-mono text-xs">
              <div className="p-4 rounded-xl bg-forest-950 border border-forest-800 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-base font-bold text-white">{selectedIncident.title}</div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase border ${
                      selectedIncident.status === 'open'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                        : selectedIncident.status === 'investigating'
                        ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                        : 'bg-bio-emerald/20 text-bio-leaf border-bio-emerald/40'
                    }`}
                  >
                    {selectedIncident.status.replace(/_/g, ' ')}
                  </span>
                </div>

                <div className="pt-2 border-t border-forest-800 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-forest-500 block text-[10px]">CATEGORY</span>
                    <span className="text-gray-200 capitalize">{selectedIncident.category}</span>
                  </div>
                  <div>
                    <span className="text-forest-500 block text-[10px]">CREATED AT</span>
                    <span className="text-gray-200">{formatDate(selectedIncident.created_at)}</span>
                  </div>
                  <div>
                    <span className="text-forest-500 block text-[10px]">EVENTS IN BOUT</span>
                    <span className="text-gray-200">{selectedIncident.event_ids?.length || 1}</span>
                  </div>
                </div>
              </div>

              {/* Investigation Remarks Input */}
              <div className="space-y-1.5">
                <label className="text-[10px] text-forest-400 block font-semibold uppercase">
                  Investigation Progress Remarks
                </label>
                <textarea
                  rows={2}
                  value={investigationNotes}
                  onChange={(e) => setInvestigationNotes(e.target.value)}
                  placeholder="Enter ranger notes, drone survey findings, or acoustic triangulation remarks..."
                  className="w-full p-2.5 rounded-lg bg-forest-950 border border-forest-800 text-gray-200 text-xs focus:outline-none focus:border-bio-emerald resize-none"
                />
              </div>

              {/* Resolution Remarks Input */}
              <div className="space-y-1.5">
                <label className="text-[10px] text-forest-400 block font-semibold uppercase">
                  Resolution / Outcome Notes
                </label>
                <textarea
                  rows={2}
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  placeholder="Enter resolution details, legal referral, or false-positive explanation..."
                  className="w-full p-2.5 rounded-lg bg-forest-950 border border-forest-800 text-gray-200 text-xs focus:outline-none focus:border-bio-emerald resize-none"
                />
              </div>

              {/* Status Transition Action Buttons */}
              <div className="pt-2 border-t border-forest-800 space-y-2">
                <span className="text-[10px] text-forest-400 block uppercase font-semibold">
                  Transition Status
                </span>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => handleUpdateStatus('investigating')}
                    disabled={updating}
                    className="py-2 px-3 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white font-bold text-xs transition-colors disabled:opacity-50"
                  >
                    Mark Investigating
                  </button>

                  <button
                    onClick={() => handleUpdateStatus('resolved')}
                    disabled={updating}
                    className="py-2 px-3 rounded-lg bg-bio-emerald hover:bg-bio-leaf text-forest-950 font-bold text-xs transition-colors shadow-forest-glow disabled:opacity-50"
                  >
                    Mark Resolved
                  </button>

                  <button
                    onClick={() => handleUpdateStatus('false_positive')}
                    disabled={updating}
                    className="py-2 px-3 rounded-lg bg-forest-800 hover:bg-forest-750 text-forest-300 font-bold text-xs transition-colors disabled:opacity-50"
                  >
                    False Positive
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-24 text-center text-xs font-mono text-forest-400">
              Select an environmental incident to inspect its evidence and manage investigation
              transitions.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
