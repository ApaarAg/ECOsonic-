import React, { useEffect, useState } from 'react';
import {
  CheckSquare,
  Check,
  X,
  HelpCircle,
  Play,
  RotateCcw,
  Bird,
  Filter,
  FileEdit,
  Clock,
} from 'lucide-react';
import { detectionsService } from '../services/detectionsService';
import { acousticService } from '../services/acousticService';
import { Detection, ReviewStatus } from '../types';
import { Badge, ConfidenceBadge } from '../components/common/Badge';
import { WaveformPlayer } from '../components/audio/WaveformPlayer';
import { LoadingState } from '../components/common/LoadingState';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { formatTimeRange, formatDate } from '../utils/formatters';

export const ReviewLab: React.FC = () => {
  const [detections, setDetections] = useState<Detection[]>([]);
  const [selectedDetection, setSelectedDetection] = useState<Detection | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('unreviewed');
  const [reviewerNote, setReviewerNote] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDetections = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await detectionsService.listDetections({
        review_status: filterStatus || undefined,
        page_size: 50,
      });
      setDetections(res.items);
      if (res.items.length > 0) {
        setSelectedDetection(res.items[0]);
      } else {
        setSelectedDetection(null);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch detections');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetections();
  }, [filterStatus]);

  const handleSubmitReview = async (decision: ReviewStatus) => {
    if (!selectedDetection) return;
    setSubmitting(true);
    try {
      await detectionsService.submitReview(selectedDetection.id, decision, reviewerNote || undefined);

      // Refresh detection in place or update state
      const updated = {
        ...selectedDetection,
        review_status: decision,
      };
      setSelectedDetection(updated);
      setDetections(detections.map((d) => (d.id === updated.id ? updated : d)));
      setReviewerNote('');
    } catch (err: any) {
      setError(err.message || 'Failed to save review');
    } finally {
      setSubmitting(false);
    }
  };

  const audioStreamUrl = selectedDetection
    ? acousticService.getAudioStreamUrl(selectedDetection.analysis_id)
    : null;

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-forest-750">
        <div>
          <div className="flex items-center gap-2">
            <CheckSquare className="w-5 h-5 text-bio-leaf" />
            <h1 className="text-2xl font-bold tracking-tight text-white">Review Lab</h1>
          </div>
          <p className="mt-1 text-sm text-forest-300">
            Expert human-in-the-loop bioacoustic annotation, confirmation, and model retraining feedback
          </p>
        </div>

        {/* Filter by review status */}
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-forest-400" />
          <span className="text-xs font-mono text-forest-400">Status:</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-forest-900 border border-forest-750 text-xs font-mono text-forest-200 rounded-lg px-3 py-1.5 focus:border-bio-emerald outline-none"
          >
            <option value="">All Statuses</option>
            <option value="unreviewed">Unreviewed</option>
            <option value="confirmed">Confirmed</option>
            <option value="uncertain">Uncertain</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* Grid: Pending Queue (Left) & Inspector / Action Panel (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left 5 Cols: Detection Queue */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 space-y-3">
            <div className="flex items-center justify-between text-xs font-mono text-forest-300 pb-2 border-b border-forest-800">
              <span className="font-semibold text-gray-200">
                Verification Queue ({detections.length})
              </span>
              <span className="text-[10px] text-forest-400 capitalize">{filterStatus || 'all'}</span>
            </div>

            {loading ? (
              <LoadingState compact message="Querying detection queue..." />
            ) : detections.length === 0 ? (
              <p className="text-xs font-mono text-forest-400 py-6 text-center">
                No detections matching the selected status filter.
              </p>
            ) : (
              <div className="space-y-2.5 max-h-[580px] overflow-y-auto pr-1">
                {detections.map((det) => {
                  const isSelected = det.id === selectedDetection?.id;
                  return (
                    <div
                      key={det.id}
                      onClick={() => setSelectedDetection(det)}
                      className={`p-3 rounded-lg border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-forest-850 border-bio-emerald shadow-card-glow'
                          : 'bg-forest-950/70 hover:bg-forest-850 border-forest-800'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h5 className="text-xs font-semibold text-white truncate max-w-[200px]">
                            {det.common_name}
                          </h5>
                          <p className="text-[10px] text-forest-300 italic truncate font-mono">
                            {det.scientific_name}
                          </p>
                        </div>
                        <ConfidenceBadge score={det.confidence_score} />
                      </div>

                      <div className="flex items-center justify-between text-[10px] font-mono text-forest-400 mt-2 pt-1 border-t border-forest-800/60">
                        <span>{formatTimeRange(det.start_seconds, det.end_seconds)}</span>
                        <Badge
                          size="sm"
                          variant={
                            det.review_status === 'confirmed'
                              ? 'emerald'
                              : det.review_status === 'rejected'
                              ? 'rose'
                              : 'slate'
                          }
                        >
                          {det.review_status}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right 7 Cols: Detailed Inspection & Expert Review Actions */}
        <div className="lg:col-span-7 space-y-4">
          {selectedDetection ? (
            <div className="p-6 rounded-xl bg-forest-900 border border-forest-750 space-y-6">
              {/* Header Info */}
              <div className="flex items-start justify-between gap-4 pb-4 border-b border-forest-800">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Bird className="w-5 h-5 text-bio-leaf" />
                    <h3 className="text-lg font-bold text-white">{selectedDetection.common_name}</h3>
                  </div>
                  <p className="text-xs font-mono text-forest-300 italic">
                    {selectedDetection.scientific_name} • Class: {selectedDetection.class_label}
                  </p>
                  <p className="text-[11px] font-mono text-forest-400">
                    Acoustic Window: {formatTimeRange(selectedDetection.start_seconds, selectedDetection.end_seconds)}
                  </p>
                </div>

                <div className="text-right">
                  <ConfidenceBadge score={selectedDetection.confidence_score} />
                  <p className="text-[10px] font-mono text-forest-400 mt-1">
                    Current: <span className="capitalize text-white">{selectedDetection.review_status}</span>
                  </p>
                </div>
              </div>

              {/* Waveform Player */}
              {audioStreamUrl && (
                <div className="space-y-2">
                  <span className="text-[11px] font-mono text-forest-300">
                    Acoustic Segment Playback
                  </span>
                  <WaveformPlayer
                    audioUrl={audioStreamUrl}
                    highlightRegion={{
                      start: selectedDetection.start_seconds,
                      end: selectedDetection.end_seconds,
                    }}
                  />
                </div>
              )}

              {/* Review Actions Form */}
              <div className="space-y-3 pt-2 border-t border-forest-800">
                <div className="flex items-center gap-2 text-xs font-mono text-forest-300">
                  <FileEdit className="w-4 h-4 text-bio-leaf" />
                  <span>Reviewer Remarks & Field Notes</span>
                </div>

                <textarea
                  rows={2}
                  value={reviewerNote}
                  onChange={(e) => setReviewerNote(e.target.value)}
                  placeholder="e.g. Distinct territorial strophes confirm willow warbler signature..."
                  className="w-full bg-forest-950 border border-forest-750 rounded-lg p-2.5 text-xs font-mono text-white placeholder-forest-500 focus:border-bio-emerald outline-none"
                />

                <div className="grid grid-cols-3 gap-3 pt-2">
                  <button
                    onClick={() => handleSubmitReview('confirmed')}
                    disabled={submitting}
                    className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-emerald-950 hover:bg-emerald-900 text-emerald-400 border border-emerald-600/40 text-xs font-mono font-semibold transition-all shadow-forest-glow"
                  >
                    <Check className="w-4 h-4" />
                    <span>Confirm</span>
                  </button>

                  <button
                    onClick={() => handleSubmitReview('uncertain')}
                    disabled={submitting}
                    className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-amber-950 hover:bg-amber-900 text-amber-400 border border-amber-600/40 text-xs font-mono font-semibold transition-all"
                  >
                    <HelpCircle className="w-4 h-4" />
                    <span>Uncertain</span>
                  </button>

                  <button
                    onClick={() => handleSubmitReview('rejected')}
                    disabled={submitting}
                    className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-rose-950 hover:bg-rose-900 text-rose-400 border border-rose-600/40 text-xs font-mono font-semibold transition-all"
                  >
                    <X className="w-4 h-4" />
                    <span>Reject</span>
                  </button>
                </div>
              </div>

              {/* Review History */}
              {selectedDetection.reviews && selectedDetection.reviews.length > 0 && (
                <div className="space-y-2 pt-4 border-t border-forest-800">
                  <span className="text-[11px] font-mono text-forest-300 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-forest-400" />
                    Verification Audit Log ({selectedDetection.reviews.length})
                  </span>
                  <div className="space-y-1.5">
                    {selectedDetection.reviews.map((rev) => (
                      <div
                        key={rev.id}
                        className="p-2.5 rounded-lg bg-forest-950 border border-forest-800 text-[11px] font-mono flex items-center justify-between"
                      >
                        <div>
                          <span className="font-semibold text-white capitalize">{rev.review_status}</span>
                          {rev.reviewer_note && (
                            <p className="text-forest-400 mt-0.5">{rev.reviewer_note}</p>
                          )}
                        </div>
                        <span className="text-forest-500 text-[10px]">{formatDate(rev.created_at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-8 rounded-xl bg-forest-900 border border-forest-750 text-center text-xs font-mono text-forest-400">
              Select a detection from the verification queue on the left.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
