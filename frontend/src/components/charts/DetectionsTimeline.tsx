import React from 'react';
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  Cell,
} from 'recharts';
import { Detection } from '../../types';
import { formatSeconds, formatConfidence } from '../../utils/formatters';

interface DetectionsTimelineProps {
  detections: Detection[];
  durationSeconds?: number;
  onSelectDetection?: (detection: Detection) => void;
  selectedId?: string;
}

export const DetectionsTimeline: React.FC<DetectionsTimelineProps> = ({
  detections,
  durationSeconds = 60,
  onSelectDetection,
  selectedId,
}) => {
  const data = detections.map((d) => ({
    x: d.start_seconds,
    y: Math.round(d.confidence_score * 100),
    z: d.end_seconds - d.start_seconds,
    species: d.common_name,
    sciName: d.scientific_name,
    conf: d.confidence_score,
    raw: d,
  }));

  return (
    <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 space-y-2">
      <div className="flex items-center justify-between text-xs font-mono text-forest-300">
        <span className="font-semibold text-gray-200">Temporal Detection Distribution</span>
        <span className="text-[11px] text-forest-400">Confidence (%) vs Timeline (s)</span>
      </div>

      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: -20 }}>
            <XAxis
              type="number"
              dataKey="x"
              name="Time"
              domain={[0, Math.max(durationSeconds, 10)]}
              tickFormatter={(v) => formatSeconds(v)}
              stroke="#2e463c"
              tick={{ fill: '#6fa18d', fontSize: 10, fontFamily: 'monospace' }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name="Confidence"
              domain={[0, 100]}
              stroke="#2e463c"
              tick={{ fill: '#6fa18d', fontSize: 10, fontFamily: 'monospace' }}
            />
            <ZAxis type="number" dataKey="z" range={[60, 200]} />
            <Tooltip
              cursor={{ strokeDasharray: '3 3', stroke: '#10b981' }}
              content={({ payload }) => {
                if (!payload || !payload.length) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-forest-950/95 border border-forest-700 p-2.5 rounded-lg shadow-xl text-xs font-mono space-y-1">
                    <p className="font-semibold text-white">{d.species}</p>
                    <p className="text-[10px] text-forest-300 italic">{d.sciName}</p>
                    <div className="flex justify-between gap-4 pt-1 border-t border-forest-800 text-[10px]">
                      <span className="text-forest-400">Time: {formatSeconds(d.x)}</span>
                      <span className="text-bio-leaf">Conf: {formatConfidence(d.conf)}</span>
                    </div>
                  </div>
                );
              }}
            />
            <Scatter
              data={data}
              onClick={(entry: any) => onSelectDetection && onSelectDetection(entry?.raw || entry?.payload?.raw)}
            >
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.raw.id === selectedId ? '#34d399' : '#10b981'}
                  stroke={entry.raw.id === selectedId ? '#ffffff' : '#065f46'}
                  strokeWidth={entry.raw.id === selectedId ? 2 : 1}
                  className="cursor-pointer transition-all hover:opacity-100 opacity-85"
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
