import React from 'react';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  trend?: {
    value: string;
    isPositive?: boolean;
  };
  accentColor?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  accentColor = 'border-forest-750',
}) => {
  return (
    <div
      className={`glass-panel rounded-xl p-5 border ${accentColor} hover:border-bio-emerald/40 transition-all duration-200 relative overflow-hidden group`}
    >
      <div className="absolute top-0 right-0 w-24 h-24 bg-bio-emerald/5 rounded-full blur-2xl group-hover:bg-bio-emerald/10 transition-colors pointer-events-none" />

      <div className="flex items-start justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-forest-300">
          {title}
        </span>
        {Icon && (
          <div className="p-2 rounded-lg bg-forest-800/80 text-bio-leaf border border-forest-700/60">
            <Icon className="w-4 h-4" />
          </div>
        )}
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-2xl lg:text-3xl font-mono font-semibold text-white tracking-tight">
          {value}
        </span>
        {trend && (
          <span
            className={`text-xs font-mono font-medium ${
              trend.isPositive ? 'text-bio-leaf' : 'text-rose-400'
            }`}
          >
            {trend.value}
          </span>
        )}
      </div>

      {subtitle && (
        <p className="mt-1 text-xs text-forest-400 line-clamp-1">{subtitle}</p>
      )}
    </div>
  );
};
