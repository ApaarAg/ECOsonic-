import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  HelpCircle,
  AlertCircle,
  Search,
  Filter,
  Volume2,
  RefreshCw,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import { useSiteContext } from '../context/SiteContext';
import { detectionsService } from '../services/detectionsService';
import { acousticService } from '../services/acousticService';
import { Detection, ReviewStatus } from '../types';
import { formatConfidence, formatSeconds, formatDate } from '../utils/formatters';

export const ReviewLab: React.FC = () => {
  const { sites, selectedSite } = useSiteContext();

  const [detections, setDetections] = useState<Detection[]>([]);
  const [selectedDetection, setSelectedDetection] = useState<Detection | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('unreviewed');
  const [reviewerNote, setReviewerNote] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDetections = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await detectionsService.getDetections({
        site_id: selectedSite?.id,
        review_status: filterStatus !== 'all' ? filterStatus : undefined,
        limit: 50,
      });
      setDetections(data);
      if (data.length > 0) {
        setSelectedDetection(data[0]);
      } else {
        setSelectedDetection(null);
      }
    } catch (err: any) {
      console.error('Failed to load detection review queue:', err);
      setError(err.message || 'Failed to load detections');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetections();
  }, [selectedSite?.id, filterStatus]);

  const handleSubmitReview = async (decision: ReviewStatus) => {
    if (!selectedDetection) return;

    try {
      setSubmitting(true);
      await detectionsService.submitReview(selectedDetection.id, {
        review_status: decision,
        reviewer_note: reviewerNote.trim() || null,
      });

      // Update local state
      const updated = {
        ...selectedDetection,
        review_status: decision,
      };
      setSelectedDetection(updated);
      setDetections((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      setReviewerNote('');

      // Auto-advance to next unreviewed detection
      const nextIdx = detections.findIndex((d) => d.id === selectedDetection.id) + 1;
      if (nextIdx < detections.length) {
        setSelectedDetection(detections[nextIdx]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to submit review');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-forest-750">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-bio-emerald" />
            <h1 className="text-xl font-bold tracking-tight text-white font-mono">
              Bioacoustic Human-in-the-Loop Review Lab
            </h1>
          </div>
          <p className="mt-1 text-xs text-forest-300 font-mono">
            Ornithological validation queue for automated detections & model provenance tracking
          </p>
        </div>

        {/* Filter controls */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-forest-400 uppercase">STATUS:</span>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-forest-900 border border-forest-750 text-xs font-mono text-gray-200 focus:outline-none focus:border-bio-emerald cursor-pointer"
            >
              <option value="all">All Reviews</option>
              <option value="unreviewed">Unreviewed Queue</option>
              <option value="confirmed">Confirmed</option>
              <option value="rejected">Rejected</option>
              <option value="uncertain">Uncertain</option>
              <option value="needs_evidence">Needs More Evidence</option>
            </select>
          </div>

          <button
            onClick={fetchDetections}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-forest-900 hover:bg-forest-850 text-xs font-mono text-forest-300 border border-forest-750 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-rose-950/80 border border-rose-800 text-xs text-rose-300 font-mono">
          {error}
        </div>
      )}

      {/* Main Dual Workspace: Queue on Left, Verification Desk on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Detection Queue (5 cols) */}
        <div className="lg:col-span-5 p-4 rounded-xl bg-forest-900 border border-forest-750 flex flex-col space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-forest-800">
            <span className="text-xs font-bold text-white font-mono uppercase tracking-wider">
              Verification Queue ({detections.length})
            </span>
            <span className="text-[10px] font-mono text-forest-400">
              {selectedSite ? selectedSite.name : 'All Stations'}
            </span>
          </div>

          <div className="space-y-2 overflow-y-auto max-h-[560px] pr-1">
            {detections.length > 0 ? (
              detections.map((det) => {
                const isSelected = selectedDetection?.id === det.id;
                return (
                  <div
                    key={det.id}
                    onClick={() => setSelectedDetection(det)}
                    className={`p-3 rounded-lg border text-xs font-mono cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-forest-850 border-bio-emerald text-white shadow-card-glow'
                        : 'bg-forest-950/70 border-forest-800 text-gray-300 hover:border-forest-600'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white truncate max-w-[200px]">
                        {det.common_name || det.class_label}
                      </span>
                      <span className="text-bio-leaf font-bold">
                        {formatConfidence(det.confidence_score)}
                      </span>
                    </div>

                    <div className="text-[10px] text-forest-400 italic truncate mt-0.5">
                      {det.scientific_name}
                    </div>

                    <div className="flex items-center justify-between text-[9px] text-forest-500 mt-2 pt-1 border-t border-forest-850">
                      <span>
                        Time: {det.start_seconds.toFixed(1)}s - {det.end_seconds.toFixed(1)}s
                      </span>
                      <span
                        className={`px-1 rounded uppercase font-semibold ${
                          det.review_status === 'confirmed'
                            ? 'text-bio-leaf bg-bio-emerald/20'
                            : det.review_status === 'rejected'
                            ? 'text-rose-400 bg-rose-950'
                            : 'text-amber-400 bg-amber-950'
                        }`}
                      >
                        {det.review_status}
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="py-24 text-center text-xs font-mono text-forest-400">
                {filterStatus === 'unreviewed'
                  ? 'Verification queue empty. All biological detections reviewed!'
                  : 'No detections match the selected review status filter.'}
              </div>
            )}
          </div>
        </div>

        {/* Right: Inspection & Decision Console (7 cols) */}
        <div className="lg:col-span-7 p-5 rounded-xl bg-forest-900 border border-forest-750 flex flex-col space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-forest-800">
            <span className="text-xs font-bold text-white font-mono uppercase tracking-wider">
              Ornithologist Inspection Desk
            </span>
            {selectedDetection && (
              <span className="text-[10px] font-mono text-forest-400">
                Detection ID: {selectedDetection.id.slice(0, 8)}...
              </span>
            )}
          </div>

          {selectedDetection ? (
            <div className="space-y-5 font-mono text-xs">
              {/* Species Identification Card */}
              <div className="p-4 rounded-xl bg-forest-950 border border-forest-800 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-lg font-bold text-white">
                    {selectedDetection.common_name || selectedDetection.class_label}
                  </div>
                  <div className="text-right">
                    <span className="text-base font-bold text-bio-leaf">
                      {formatConfidence(selectedDetection.confidence_score)}
                    </span>
                    <span className="text-[10px] text-forest-400 block">Model Confidence</span>
                  </div>
                </div>

                <div className="text-xs text-forest-400 italic">
                  {selectedDetection.scientific_name}
                </div>

                <div className="pt-2 border-t border-forest-800 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-forest-500 block text-[10px]">TIME WINDOW</span>
                    <span className="text-gray-200">
                      {selectedDetection.start_seconds.toFixed(2)}s -{' '}
                      {selectedDetection.end_seconds.toFixed(2)}s (
                      {(selectedDetection.end_seconds - selectedDetection.start_seconds).toFixed(2)}
                      s)
                    </span>
                  </div>
                  <div>
                    <span className="text-forest-500 block text-[10px]">TAXON GROUP</span>
                    <span className="text-gray-200">{selectedDetection.taxon_group || 'Avian (Bird)'}</span>
                  </div>
                </div>
              </div>

              {/* Audio Playback Controls */}
              {selectedDetection.analysis_id && (
                <div className="p-4 rounded-xl bg-forest-950 border border-forest-800 space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-forest-300 flex items-center gap-1.5">
                      <Volume2 className="w-4 h-4 text-bio-emerald" />
                      Continuous Recording Audio Stream
                    </span>
                  </div>
                  <audio
                    controls
                    src={acousticService.getAudioStreamUrl(selectedDetection.analysis_id)}
                    className="w-full h-8"
                  />
                </div>
              )}

              {/* Reviewer Remarks Input */}
              <div className="space-y-1.5">
                <label className="text-[10px] text-forest-400 block font-semibold uppercase">
                  Auditable Review Remarks (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Enter acoustic notes, call type (song, alarm call, flight call), or validation rationale..."
                  value={reviewerNote}
                  onChange={(e) => setReviewerNote(e.target.value)}
                  className="w-full p-2.5 rounded-lg bg-forest-950 border border-forest-800 text-gray-200 text-xs focus:outline-none focus:border-bio-emerald resize-none"
                />
              </div>

              {/* 4 Decision Action Buttons */}
              <div className="pt-2 border-t border-forest-800 space-y-2">
                <span className="text-[10px] text-forest-400 block uppercase font-semibold">
                  Record Verification Decision
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    onClick={() => handleSubmitReview('confirmed')}
                    disabled={submitting}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-bio-emerald hover:bg-bio-leaf text-forest-950 font-bold text-xs transition-colors shadow-forest-glow disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Confirm</span>
                  </button>

                  <button
                    onClick={() => handleSubmitReview('rejected')}
                    disabled={submitting}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-rose-700 hover:bg-rose-600 text-white font-bold text-xs transition-colors shadow-lg disabled:opacity-50"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Reject</span>
                  </button>

                  <button
                    onClick={() => handleSubmitReview('uncertain')}
                    disabled={submitting}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-forest-950 font-bold text-xs transition-colors disabled:opacity-50"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                    <span>Uncertain</span>
                  </button>

                  <button
                    onClick={() => handleSubmitReview('needs_evidence')}
                    disabled={submitting}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-700 hover:bg-indigo-600 text-white font-bold text-xs transition-colors disabled:opacity-50"
                  >
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Needs Evidence</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-24 text-center text-xs font-mono text-forest-400">
              Select a biological detection from the verification queue to begin inspection.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
