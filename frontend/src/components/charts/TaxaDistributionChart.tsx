import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { TopSpeciesSummary } from '../../types';

interface TaxaDistributionChartProps {
  speciesList: TopSpeciesSummary[];
  className?: string;
}

export const TaxaDistributionChart: React.FC<TaxaDistributionChartProps> = ({
  speciesList,
  className = '',
}) => {
  const chartData = speciesList.slice(0, 8).map((s) => ({
    name: s.common_name,
    sciName: s.scientific_name,
    count: s.detection_count,
    confidence: Math.round(s.max_confidence * 100),
  }));

  if (!chartData.length) {
    return (
      <div className={`p-6 rounded-xl bg-forest-900 border border-forest-750 flex items-center justify-center text-xs font-mono text-forest-400 ${className}`}>
        No species classification data available yet.
      </div>
    );
  }

  return (
    <div className={`p-4 rounded-xl bg-forest-900 border border-forest-750 space-y-3 ${className}`}>
      <div className="flex items-center justify-between text-xs font-mono text-forest-300">
        <span className="font-semibold text-gray-200">Species Richness Ranking</span>
        <span className="text-[11px] text-forest-400">Total Detections</span>
      </div>

      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 5, right: 20, bottom: 5, left: 30 }}
          >
            <XAxis
              type="number"
              stroke="#2e463c"
              tick={{ fill: '#6fa18d', fontSize: 10, fontFamily: 'monospace' }}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={110}
              stroke="#2e463c"
              tick={{ fill: '#cfe3db', fontSize: 10, fontFamily: 'monospace' }}
            />
            <Tooltip
              cursor={{ fill: 'rgba(52, 211, 153, 0.05)' }}
              content={({ payload }) => {
                if (!payload || !payload.length) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-forest-950 border border-forest-700 p-2 rounded shadow-lg text-xs font-mono">
                    <p className="font-semibold text-white">{d.name}</p>
                    <p className="text-[10px] text-forest-300 italic">{d.sciName}</p>
                    <div className="mt-1 pt-1 border-t border-forest-800 flex justify-between gap-4">
                      <span className="text-forest-400">Detections: {d.count}</span>
                      <span className="text-bio-leaf">Peak Conf: {d.confidence}%</span>
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]}>
              {chartData.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={index === 0 ? '#10b981' : index === 1 ? '#059669' : '#2e463c'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
