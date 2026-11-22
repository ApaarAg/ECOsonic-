import React from 'react';
import { Play, Check, X, HelpCircle, Bird } from 'lucide-react';
import { Detection } from '../../types';
import { ConfidenceBadge, Badge } from '../common/Badge';
import { formatTimeRange } from '../../utils/formatters';

interface DetectionCardProps {
  detection: Detection;
  isSelected?: boolean;
  onSelect?: (detection: Detection) => void;
  onPlay?: (start: number, end: number) => void;
  onReview?: (detectionId: string, status: 'confirmed' | 'rejected' | 'uncertain') => void;
}

export const DetectionCard: React.FC<DetectionCardProps> = ({
  detection,
  isSelected = false,
  onSelect,
  onPlay,
  onReview,
}) => {
  return (
    <div
      onClick={() => onSelect && onSelect(detection)}
      className={`p-3.5 rounded-xl transition-all cursor-pointer border ${
        isSelected
          ? 'bg-forest-850 border-bio-leaf shadow-card-glow'
          : 'bg-forest-900/80 hover:bg-forest-850/60 border-forest-750'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Left: Species Info */}
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="p-2 rounded-lg bg-forest-800 text-bio-leaf border border-forest-700/60 shrink-0 mt-0.5">
            <Bird className="w-4 h-4" />
          </div>

          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-white truncate hover:text-bio-leaf transition-colors">
              {detection.common_name}
            </h4>
            <p className="text-xs text-forest-300 italic truncate font-mono">
              {detection.scientific_name}
            </p>
            <div className="mt-1 flex items-center gap-2 text-[10px] font-mono text-forest-400">
              <span>{formatTimeRange(detection.start_seconds, detection.end_seconds)}</span>
              <span>•</span>
              <span className="capitalize">{detection.record_type || 'vocalization'}</span>
            </div>
          </div>
        </div>

        {/* Right: Confidence & Play */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <ConfidenceBadge score={detection.confidence_score} />

          {detection.review_status !== 'unreviewed' && (
            <Badge
              size="sm"
              variant={
                detection.review_status === 'confirmed'
                  ? 'emerald'
                  : detection.review_status === 'rejected'
                  ? 'rose'
                  : 'amber'
              }
            >
              {detection.review_status}
            </Badge>
          )}
        </div>
      </div>

      {/* Action Footer (Quick snippet playback & Quick verification) */}
      <div className="mt-3 pt-2 border-t border-forest-800/80 flex items-center justify-between text-xs">
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (onPlay) onPlay(detection.start_seconds, detection.end_seconds);
          }}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-forest-800 hover:bg-forest-750 text-forest-200 hover:text-white font-mono text-[11px] border border-forest-700 transition-colors"
        >
          <Play className="w-3 h-3 text-bio-leaf fill-current" />
          <span>Play Segment</span>
        </button>

        {onReview && (
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onReview(detection.id, 'confirmed');
              }}
              className="p-1 rounded bg-forest-800 hover:bg-emerald-950 text-forest-300 hover:text-emerald-400 border border-forest-700 transition-colors"
              title="Confirm detection"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onReview(detection.id, 'uncertain');
              }}
              className="p-1 rounded bg-forest-800 hover:bg-amber-950 text-forest-300 hover:text-amber-400 border border-forest-700 transition-colors"
              title="Mark uncertain"
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onReview(detection.id, 'rejected');
              }}
              className="p-1 rounded bg-forest-800 hover:bg-rose-950 text-forest-300 hover:text-rose-400 border border-forest-700 transition-colors"
              title="Reject detection"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
