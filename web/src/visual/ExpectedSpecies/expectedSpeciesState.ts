import type {
  ExpectedSpeciesBaseline,
  ExpectedSpeciesBaselineContext,
  ExpectedSpeciesDto,
} from '../../types/ecosonic';
import { resolveSpeciesAsset, type SpeciesAssetRecord } from './speciesAssetRegistry';

const NON_BIOLOGICAL_KEYWORDS = new Set([
  'engine',
  'chainsaw',
  'siren',
  'vehicle',
  'gunshot',
  'helicopter',
  'airplane',
  'horn',
  'whistle',
  'machinery',
  'human',
  'speech',
  'noise',
  'wind',
  'rain',
]);

/** Future Scene 12 hook readiness (unused visually in Scene 11) */
export type SpecimenObservationTag =
  | 'expected'
  | 'detected'
  | 'observation_gap'
  | 'unexpected';

export interface SpecimenRecord {
  id: string;
  speciesId?: string | null;
  index: number;
  indexLabel: string;
  scientificName: string;
  abbreviatedScientific: string;
  commonName: string;
  occurrenceScore: number;
  occurrenceStatus: 'expected' | 'frequent' | 'rare';
  birdnetTaxonomyId: string | null;
  ebirdCode: string | null;
  asset: SpeciesAssetRecord;
  context: ExpectedSpeciesBaselineContext;
  observationTag: SpecimenObservationTag;
}

export interface ArchiveSlotTransform {
  specimen: SpecimenRecord;
  offset: number;
  isSelected: boolean;
  visible: boolean;
  xPx: number;
  yPx: number;
  zPx: number;
  rotateYDeg: number;
  widthPx: number;
  heightPx: number;
  zIndex: number;
  dimming: number;
}

export function isBiologicalTaxon(scientificName: string, commonName?: string | null): boolean {
  const sciLower = scientificName.trim().toLowerCase();
  const comLower = (commonName || '').trim().toLowerCase();
  if (!sciLower) return false;
  for (const blocked of NON_BIOLOGICAL_KEYWORDS) {
    if (sciLower === blocked || comLower === blocked) {
      return false;
    }
  }
  return true;
}

export function abbreviateBinomial(scientificName: string): string {
  const parts = scientificName.trim().split(/\s+/);
  if (parts.length < 2) return scientificName.trim();
  const genusInitial = parts[0].charAt(0).toUpperCase();
  return `${genusInitial}. ${parts.slice(1).join(' ')}`;
}

export function makeSpecimenId(scientificName: string): string {
  return scientificName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Deterministically maps and sorts backend ExpectedSpeciesBaseline into SpecimenRecord[].
 * - Filters out any accidental non-biological classes
 * - Deduplicates by lowercase scientificName
 * - Applies deterministic sort (occurrenceScore desc, commonName asc, scientificName asc)
 * - Caps visible archive shelf cleanly to 24 taxa so peripheral perspective stays uncluttered
 */
export function buildSpecimenArchive(
  baseline: ExpectedSpeciesBaseline,
  maxArchiveSize = 18
): SpecimenRecord[] {
  const dedup = new Map<string, ExpectedSpeciesDto>();

  for (const sp of baseline.expectedSpecies) {
    if (!isBiologicalTaxon(sp.scientificName, sp.commonName)) continue;
    const key = sp.scientificName.trim().toLowerCase();
    if (!dedup.has(key)) {
      dedup.set(key, sp);
    }
  }

  const sorted = Array.from(dedup.values()).sort((a, b) => {
    const scoreDiff = (b.occurrenceScore ?? 0) - (a.occurrenceScore ?? 0);
    if (Math.abs(scoreDiff) > 1e-6) return scoreDiff;
    const labelA = (a.commonName || a.scientificName).toLowerCase();
    const labelB = (b.commonName || b.scientificName).toLowerCase();
    const cmp = labelA.localeCompare(labelB);
    if (cmp !== 0) return cmp;
    return a.scientificName.toLowerCase().localeCompare(b.scientificName.toLowerCase());
  });

  return sorted.slice(0, maxArchiveSize).map((sp, idx) => {
    const common = (sp.commonName || sp.scientificName).trim();
    return {
      id: makeSpecimenId(sp.scientificName),
      speciesId: sp.speciesId ?? sp.birdnetTaxonomyId ?? null,
      index: idx,
      indexLabel: String(idx + 1).padStart(2, '0'),
      scientificName: sp.scientificName.trim(),
      abbreviatedScientific: abbreviateBinomial(sp.scientificName),
      commonName: common,
      occurrenceScore: Number(sp.occurrenceScore ?? 0),
      occurrenceStatus: sp.occurrenceStatus,
      birdnetTaxonomyId: sp.birdnetTaxonomyId ?? null,
      ebirdCode: sp.ebirdCode ?? null,
      asset: resolveSpeciesAsset(sp.scientificName, common),
      context: baseline.context,
      observationTag: 'expected',
    };
  });
}

/**
 * Computes physical 3D perspective slot transforms along the horizontal ecological archive.
 * Guarantees deterministic center dominance for the selected specimen and receding peripheral plates.
 */
export function computeArchiveSlotTransforms(
  specimens: SpecimenRecord[],
  selectedIndex: number,
  viewportWidth: number,
  reducedMotion: boolean
): ArchiveSlotTransform[] {
  if (specimens.length === 0) return [];

  const safeSelected = Math.max(0, Math.min(specimens.length - 1, selectedIndex));
  const isMobile = viewportWidth < 768;
  const isTablet = viewportWidth >= 768 && viewportWidth < 1080;

  const maxPerSide = isMobile ? 2 : isTablet ? 4 : 6;
  const selectedW = isMobile ? Math.min(254, Math.max(216, viewportWidth * 0.62)) : isTablet ? 276 : 308;
  const selectedH = isMobile ? 340 : isTablet ? 376 : 412;

  const spineW = isMobile ? 46 : isTablet ? 54 : 60;
  const spineH = isMobile ? 290 : isTablet ? 336 : 372;

  const firstGap = isMobile ? selectedW * 0.5 + 34 : isTablet ? 204 : 230;
  const stepGap = isMobile ? 52 : isTablet ? 64 : 74;

  return specimens.map((specimen, idx) => {
    const offset = idx - safeSelected;
    const absOffset = Math.abs(offset);
    const isSelected = offset === 0;
    const visible = absOffset <= maxPerSide;

    if (isSelected) {
      return {
        specimen,
        offset,
        isSelected: true,
        visible: true,
        xPx: 0,
        yPx: reducedMotion ? 0 : -8,
        zPx: reducedMotion ? 0 : 94,
        rotateYDeg: 0,
        widthPx: selectedW,
        heightPx: selectedH,
        zIndex: 40,
        dimming: 0,
      };
    }

    const sign = offset < 0 ? -1 : 1;
    const stepsBeyondOne = absOffset - 1;
    const xPx = sign * (firstGap + stepsBeyondOne * stepGap);
    const zPx = reducedMotion ? 0 : -(34 + stepsBeyondOne * 30);
    const yPx = reducedMotion ? 0 : Math.min(18, absOffset * 3);
    // Perspective cabinet turn: peripheral plates angle slightly inward toward the central specimen
    const rotateYDeg = reducedMotion
      ? 0
      : -sign * Math.min(44, (isMobile ? 24 : 30) + stepsBeyondOne * 3.5);
    const dimming = Math.min(0.62, 0.16 + stepsBeyondOne * 0.1);

    return {
      specimen,
      offset,
      isSelected: false,
      visible,
      xPx,
      yPx,
      zPx,
      rotateYDeg,
      widthPx: spineW,
      heightPx: spineH,
      zIndex: Math.max(1, 30 - absOffset),
      dimming,
    };
  });
}

export function formatOccurrenceTierLabel(status: ExpectedSpeciesDto['occurrenceStatus']): string {
  switch (status) {
    case 'frequent':
      return 'FREQUENT IN CONTEXT';
    case 'rare':
      return 'INFREQUENT SEASONAL';
    default:
      return 'EXPECTED IN CONTEXT';
  }
}
