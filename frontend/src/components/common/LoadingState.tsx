import React from 'react';
import { Loader2, Radio } from 'lucide-react';

interface LoadingStateProps {
  message?: string;
  stage?: string;
  progress?: number;
  compact?: boolean;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  message = 'Loading bioacoustic intelligence...',
  stage,
  progress,
  compact = false,
}) => {
  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs font-mono text-forest-300">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-bio-leaf" />
        <span>{message}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="relative mb-4">
        <div className="w-14 h-14 rounded-full border-2 border-forest-700 border-t-bio-leaf animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center text-bio-leaf">
          <Radio className="w-5 h-5 animate-pulse" />
        </div>
      </div>

      <p className="text-sm font-medium text-gray-200">{message}</p>

      {stage && (
        <p className="mt-1 text-xs font-mono text-bio-leaf bg-forest-900/80 px-2.5 py-1 rounded border border-forest-700">
          Stage: {stage}
        </p>
      )}

      {progress !== undefined && progress >= 0 && (
        <div className="w-64 mt-4">
          <div className="flex justify-between text-xs font-mono text-forest-300 mb-1">
            <span>Progress</span>
            <span>{progress.toFixed(0)}%</span>
          </div>
          <div className="w-full bg-forest-900 h-1.5 rounded-full overflow-hidden border border-forest-800">
            <div
              className="bg-gradient-to-r from-bio-emerald to-bio-leaf h-full transition-all duration-300"
              style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
