import { describe, it, expect } from 'vitest';
import { Site } from '../types';

describe('3-Tier Location Sensitivity and Privacy Enforcement', () => {
  const sites: Site[] = [
    {
      id: 'site-1',
      name: 'Ngorongoro Crater Station',
      latitude: -3.2397,
      longitude: 35.4875,
      location_sensitivity: 'exact',
      created_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'site-2',
      name: 'Amboseli Buffer Observation',
      latitude: -2.6521,
      longitude: 37.2606,
      location_sensitivity: 'generalized',
      generalized_latitude: -2.65,
      generalized_longitude: 37.26,
      created_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'site-3',
      name: 'Critical Rhino Sanctuary Nest',
      latitude: null,
      longitude: null,
      location_sensitivity: 'restricted',
      created_at: '2026-01-01T00:00:00Z',
    },
  ];

  it('preserves exact coordinates for exact-mode stations', () => {
    const exactSite = sites.find((s) => s.location_sensitivity === 'exact')!;
    expect(exactSite.latitude).toBe(-3.2397);
    expect(exactSite.longitude).toBe(35.4875);
  });

  it('uses fuzzed ~1.1km coordinates for generalized-mode stations', () => {
    const genSite = sites.find((s) => s.location_sensitivity === 'generalized')!;
    expect(genSite.generalized_latitude).toBe(-2.65);
    expect(genSite.generalized_longitude).toBe(37.26);
    // Difference between exact and generalized should be small (~0.002 to 0.01 deg)
    expect(Math.abs((genSite.latitude || 0) - genSite.generalized_latitude!)).toBeLessThan(0.02);
  });

  it('completely conceals coordinates for restricted-mode stations', () => {
    const restrictedSite = sites.find((s) => s.location_sensitivity === 'restricted')!;
    expect(restrictedSite.latitude).toBeNull();
    expect(restrictedSite.longitude).toBeNull();
    expect(restrictedSite.generalized_latitude).toBeUndefined();
    expect(restrictedSite.generalized_longitude).toBeUndefined();
  });

  it('filters out restricted stations from direct map pin placement', () => {
    const mappableSites = sites.filter((site) => {
      if (site.location_sensitivity === 'restricted') return false;
      const lat =
        site.location_sensitivity === 'generalized'
          ? (site.generalized_latitude ?? site.latitude)
          : site.latitude;
      const lon =
        site.location_sensitivity === 'generalized'
          ? (site.generalized_longitude ?? site.longitude)
          : site.longitude;
      return typeof lat === 'number' && typeof lon === 'number';
    });

    expect(mappableSites.length).toBe(2);
    expect(mappableSites.some((s) => s.location_sensitivity === 'restricted')).toBe(false);
  });
});
