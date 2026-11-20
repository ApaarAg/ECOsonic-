import React, { useMemo } from 'react';
import { formatSeconds } from '../../utils/formatters';

interface SpectrogramViewProps {
  duration?: number;
  highlightRange?: { start: number; end: number };
  sampleRate?: number;
  className?: string;
}

export const SpectrogramView: React.FC<SpectrogramViewProps> = ({
  duration = 30.0,
  highlightRange,
  sampleRate = 32000,
  className = '',
}) => {
  const nyquistKHz = (sampleRate / 2000).toFixed(0);

  // Generate synthetic spectrogram bars matching bioacoustic distributions
  const columns = useMemo(() => {
    const cols = [];
    const count = 48;
    for (let i = 0; i < count; i++) {
      const timeSec = (i / count) * duration;
      const isTarget = highlightRange && timeSec >= highlightRange.start && timeSec <= highlightRange.end;
      // Frequency bin energies
      const lowEnergy = Math.sin(i * 0.4) * 0.3 + 0.3; // Low rumble/wind
      const midEnergy = isTarget ? 0.85 + Math.random() * 0.15 : Math.cos(i * 0.3) * 0.3 + 0.2; // Biophony vocalizations
      const highEnergy = Math.random() * 0.2; // High frequency harmonics
      cols.push({ id: i, timeSec, lowEnergy, midEnergy, highEnergy, isTarget });
    }
    return cols;
  }, [duration, highlightRange]);

  return (
    <div className={`p-4 rounded-xl bg-forest-900 border border-forest-750 space-y-2 select-none ${className}`}>
      <div className="flex items-center justify-between text-[11px] font-mono text-forest-300">
        <span className="flex items-center gap-1.5 font-semibold text-gray-200">
          <span className="w-2 h-2 rounded-full bg-bio-leaf" />
          Acoustic Spectrogram (FFT 512 / Hanning)
        </span>
        <span className="text-forest-400">0 — {nyquistKHz} kHz Bandwidth</span>
      </div>

      {/* Spectrogram Grid */}
      <div className="relative h-36 bg-forest-950 rounded-lg border border-forest-800 p-2 overflow-hidden flex items-end gap-1">
        {/* Frequency Y-Axis Labels */}
        <div className="absolute top-1 left-2 text-[9px] font-mono text-forest-500 z-10">
          {nyquistKHz} kHz
        </div>
        <div className="absolute top-1/2 -translate-y-1/2 left-2 text-[9px] font-mono text-forest-500 z-10">
          {(sampleRate / 4000).toFixed(0)} kHz
        </div>
        <div className="absolute bottom-1 left-2 text-[9px] font-mono text-forest-500 z-10">
          0 kHz
        </div>

        {/* Heatmap Bars */}
        <div className="w-full h-full pl-10 pr-2 flex items-stretch gap-[3px]">
          {columns.map((col) => (
            <div
              key={col.id}
              className={`flex-1 flex flex-col justify-end gap-[1px] transition-all rounded-[1px] ${
                col.isTarget ? 'ring-1 ring-bio-emerald bg-bio-emerald/10' : ''
              }`}
            >
              {/* High bin */}
              <div
                className="w-full rounded-[1px]"
                style={{
                  height: `${col.highEnergy * 30}%`,
                  backgroundColor: col.isTarget ? '#10b981' : '#1b2822',
                  opacity: col.highEnergy + 0.2,
                }}
              />
              {/* Mid bin (Bird vocalization core) */}
              <div
                className="w-full rounded-[1px]"
                style={{
                  height: `${col.midEnergy * 50}%`,
                  backgroundColor: col.isTarget ? '#34d399' : '#2e463c',
                  opacity: col.midEnergy + 0.2,
                }}
              />
              {/* Low bin */}
              <div
                className="w-full rounded-[1px]"
                style={{
                  height: `${col.lowEnergy * 25}%`,
                  backgroundColor: col.isTarget ? '#059669' : '#141f1a',
                  opacity: col.lowEnergy + 0.1,
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Time axis */}
      <div className="flex justify-between text-[10px] font-mono text-forest-400 px-10">
        <span>00:00.0</span>
        <span>{formatSeconds(duration / 2)}</span>
        <span>{formatSeconds(duration)}</span>
      </div>
    </div>
  );
};
