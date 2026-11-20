export const NAV_ITEMS = [
  {
    path: '/',
    label: 'Observatory',
    description: 'System overview & real-time monitoring',
    icon: 'Activity',
  },
  {
    path: '/audio',
    label: 'Audio Intelligence',
    description: 'Acoustic upload, classification & spectrograms',
    icon: 'Radio',
  },
  {
    path: '/memory',
    label: 'Acoustic Memory',
    description: 'Vector embeddings & similarity exploration',
    icon: 'Cpu',
  },
  {
    path: '/habitat',
    label: 'Habitat Monitor',
    description: 'Geospatial sites & ecological trends',
    icon: 'MapPin',
  },
  {
    path: '/review',
    label: 'Review Lab',
    description: 'Expert verification & annotation workflow',
    icon: 'CheckSquare',
  },
];

export const TAXON_COLORS: Record<string, string> = {
  Aves: '#10b981', // Emerald
  Anura: '#06b6d4', // Cyan
  Insecta: '#f59e0b', // Amber
  Mammalia: '#8b5cf6', // Violet
  Anthrophony: '#f43f5e', // Coral red
  Biophony: '#10b981',
  Geophony: '#3b82f6',
  Unknown: '#64748b',
};

export const CONFIDENCE_TIERS = {
  HIGH: { min: 0.8, color: 'text-emerald-400', bg: 'bg-emerald-950/40 border-emerald-500/30' },
  MEDIUM: { min: 0.5, color: 'text-amber-400', bg: 'bg-amber-950/40 border-amber-500/30' },
  LOW: { min: 0.0, color: 'text-rose-400', bg: 'bg-rose-950/40 border-rose-500/30' },
};
