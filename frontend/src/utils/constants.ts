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

