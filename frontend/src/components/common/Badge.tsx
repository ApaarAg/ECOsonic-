import React from 'react';
import { CONFIDENCE_TIERS } from '../../utils/constants';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'emerald' | 'amber' | 'rose' | 'slate' | 'cyan' | 'violet';
  size?: 'sm' | 'md';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'emerald',
  size = 'md',
  className = '',
}) => {
  const variantStyles = {
    emerald: 'bg-emerald-950/60 text-emerald-400 border-emerald-500/30',
    amber: 'bg-amber-950/60 text-amber-400 border-amber-500/30',
    rose: 'bg-rose-950/60 text-rose-400 border-rose-500/30',
    slate: 'bg-forest-800 text-gray-300 border-forest-700',
    cyan: 'bg-cyan-950/60 text-cyan-400 border-cyan-500/30',
    violet: 'bg-purple-950/60 text-purple-400 border-purple-500/30',
  };

  const sizeStyles = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-xs px-2.5 py-1',
  };

  return (
    <span
      className={`inline-flex items-center font-mono font-medium rounded-md border ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
    >
      {children}
    </span>
  );
};

export const ConfidenceBadge: React.FC<{ score: number }> = ({ score }) => {
  let tier = CONFIDENCE_TIERS.LOW;
  if (score >= CONFIDENCE_TIERS.HIGH.min) tier = CONFIDENCE_TIERS.HIGH;
  else if (score >= CONFIDENCE_TIERS.MEDIUM.min) tier = CONFIDENCE_TIERS.MEDIUM;

  const pct = (score * 100).toFixed(0);

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-xs px-2 py-0.5 rounded border ${tier.bg} ${tier.color}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
      {pct}%
    </span>
  );
};
