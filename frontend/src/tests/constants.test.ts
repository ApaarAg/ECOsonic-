import { describe, it, expect } from 'vitest';
import { NAV_ITEMS, CONFIDENCE_TIERS, TAXON_COLORS } from '../utils/constants';

describe('Constants', () => {
  it('defines all 5 primary application module routes', () => {
    expect(NAV_ITEMS).toHaveLength(5);
    const paths = NAV_ITEMS.map((n) => n.path);
    expect(paths).toContain('/');
    expect(paths).toContain('/audio');
    expect(paths).toContain('/memory');
    expect(paths).toContain('/habitat');
    expect(paths).toContain('/review');
  });

  it('defines valid confidence thresholds', () => {
    expect(CONFIDENCE_TIERS.HIGH.min).toBe(0.8);
    expect(CONFIDENCE_TIERS.MEDIUM.min).toBe(0.5);
    expect(CONFIDENCE_TIERS.LOW.min).toBe(0.0);
  });

  it('provides taxon color mappings', () => {
    expect(TAXON_COLORS.Aves).toBe('#10b981');
    expect(TAXON_COLORS.Anura).toBe('#06b6d4');
  });
});
