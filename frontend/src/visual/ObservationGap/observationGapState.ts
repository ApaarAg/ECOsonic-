import type {
  DetectedSpeciesItem,
  EcologicalGapSnapshot,
  ObservationGapCoverage,
  ObservationGapSpeciesItem,
} from "../../domain/acousticFieldTypes";
import {
  abbreviateBinomial,
  isBiologicalTaxon,
  makeSpecimenId,
} from "../ExpectedSpecies/expectedSpeciesState";
import {
  resolveSpeciesAsset,
  type SpeciesAssetRecord,
} from "../ExpectedSpecies/speciesAssetRegistry";

export type ObservationGapCategory =
  | "expected_and_detected"
  | "expected_but_not_detected"
  | "detected_unexpected";

export type ObservationGapFilter = "all" | ObservationGapCategory;

export interface ObservationCorrespondenceEntry {
  id: string;
  index: number;
  indexLabel: string;
  category: ObservationGapCategory;
  scientificName: string;
  abbreviatedScientific: string;
  commonName: string;
  birdnetTaxonomyId: string | null;
  ebirdCode: string | null;
  occurrenceScore: number | null;
  occurrenceStatus: string | null;
  detectionCount: number | null;
  maxConfidence: number | null;
  meanConfidence: number | null;
  firstSeenSeconds: number | null;
  lastSeenSeconds: number | null;
  isPersistent: boolean;
  possibleFactors: string[];
  asset: SpeciesAssetRecord;
}

export interface ObservationGapViewModel {
  sessionId: string;
  isDemo: boolean;
  locationName: string;
  ecosystemCategory: string;
  generalizedCoordinates: { latitude: number | null; longitude: number | null } | null;
  observationDate: string;
  meteorologicalWeek: number;
  observationDurationSec: number;
  totalAudioWindows: number;
  coverage: ObservationGapCoverage;
  entries: ObservationCorrespondenceEntry[];
  counts: {
    all: number;
    expectedAndDetected: number;
    expectedButNotDetected: number;
    detectedUnexpected: number;
  };
  interpretationSummary: string | null;
  observationGapExplanation: string | null;
  limitations: string[];
  scientificDisclaimer: string;
}

function normalizeDisplayName(commonName: string | null | undefined, scientificName: string): string {
  const clean = (commonName ?? "").trim();
  return clean.length > 0 ? clean : scientificName.trim();
}

function mapDetectedEntry(
  item: DetectedSpeciesItem,
  category: "expected_and_detected" | "detected_unexpected",
): ObservationCorrespondenceEntry {
  const sci = item.scientific_name.trim();
  const common = normalizeDisplayName(item.common_name, sci);
  return {
    id: `${category}-${makeSpecimenId(sci)}`,
    index: 0,
    indexLabel: "01",
    category,
    scientificName: sci,
    abbreviatedScientific: abbreviateBinomial(sci),
    commonName: common,
    birdnetTaxonomyId: item.birdnet_taxonomy_id ?? item.species_id ?? null,
    ebirdCode: item.ebird_code ?? null,
    occurrenceScore: item.occurrence_score ?? null,
    occurrenceStatus: item.occurrence_status ?? null,
    detectionCount: item.detection_count,
    maxConfidence: item.max_confidence,
    meanConfidence: item.mean_confidence,
    firstSeenSeconds: item.first_seen_seconds,
    lastSeenSeconds: item.last_seen_seconds,
    isPersistent: Boolean(item.is_persistent),
    possibleFactors: [],
    asset: resolveSpeciesAsset(sci, common, item.image),
  };
}

function mapGapEntry(item: ObservationGapSpeciesItem): ObservationCorrespondenceEntry {
  const sci = item.scientific_name.trim();
  const common = normalizeDisplayName(item.common_name, sci);
  return {
    id: `expected_but_not_detected-${makeSpecimenId(sci)}`,
    index: 0,
    indexLabel: "01",
    category: "expected_but_not_detected",
    scientificName: sci,
    abbreviatedScientific: abbreviateBinomial(sci),
    commonName: common,
    birdnetTaxonomyId: item.birdnet_taxonomy_id ?? item.species_id ?? null,
    ebirdCode: item.ebird_code ?? null,
    occurrenceScore: item.occurrence_score,
    occurrenceStatus: item.occurrence_status,
    detectionCount: null,
    maxConfidence: null,
    meanConfidence: null,
    firstSeenSeconds: null,
    lastSeenSeconds: null,
    isPersistent: false,
    possibleFactors: item.possible_factors || [],
    asset: resolveSpeciesAsset(sci, common, item.image),
  };
}

export function buildObservationGapViewModel(
  snapshot: EcologicalGapSnapshot | null,
): ObservationGapViewModel | null {
  if (!snapshot) return null;

  const seen = new Set<string>();
  const detected: ObservationCorrespondenceEntry[] = [];
  const gaps: ObservationCorrespondenceEntry[] = [];
  const unexpected: ObservationCorrespondenceEntry[] = [];

  for (const item of snapshot.expected_and_detected || []) {
    if (!isBiologicalTaxon(item.scientific_name, item.common_name)) continue;
    const key = item.scientific_name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    detected.push(mapDetectedEntry(item, "expected_and_detected"));
  }

  for (const item of snapshot.expected_but_not_detected || []) {
    if (!isBiologicalTaxon(item.scientific_name, item.common_name)) continue;
    const key = item.scientific_name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    gaps.push(mapGapEntry(item));
  }

  for (const item of snapshot.detected_unexpected || []) {
    if (!isBiologicalTaxon(item.scientific_name, item.common_name)) continue;
    const key = item.scientific_name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unexpected.push(mapDetectedEntry(item, "detected_unexpected"));
  }

  // Deterministic ordering within each category
  detected.sort((a, b) => (b.maxConfidence ?? 0) - (a.maxConfidence ?? 0));
  gaps.sort((a, b) => (b.occurrenceScore ?? 0) - (a.occurrenceScore ?? 0));
  unexpected.sort((a, b) => (b.maxConfidence ?? 0) - (a.maxConfidence ?? 0));

  const combined = [...detected, ...gaps, ...unexpected].map((entry, idx) => ({
    ...entry,
    index: idx,
    indexLabel: String(idx + 1).padStart(2, "0"),
  }));

  return {
    sessionId: snapshot.session_id,
    isDemo: snapshot.isDemo,
    locationName: snapshot.context.location_name || "Field Acoustic Station",
    ecosystemCategory: snapshot.context.ecosystem_category || "unspecified",
    generalizedCoordinates: snapshot.context.generalized_coordinates ?? null,
    observationDate: snapshot.context.observation_date,
    meteorologicalWeek: snapshot.context.meteorological_week,
    observationDurationSec: snapshot.context.observation_duration_sec,
    totalAudioWindows: snapshot.context.total_audio_windows,
    coverage: snapshot.coverage,
    entries: combined,
    counts: {
      all: combined.length,
      expectedAndDetected: detected.length,
      expectedButNotDetected: gaps.length,
      detectedUnexpected: unexpected.length,
    },
    interpretationSummary: snapshot.interpretation?.summary ?? null,
    observationGapExplanation: snapshot.interpretation?.observation_gap_explanation ?? null,
    limitations: snapshot.interpretation?.limitations ?? [],
    scientificDisclaimer:
      snapshot.scientific_disclaimer ||
      "Acoustic non-detection does NOT establish biological absence.",
  };
}

export function filterCorrespondenceEntries(
  entries: ObservationCorrespondenceEntry[],
  filter: ObservationGapFilter | readonly ObservationGapCategory[],
): ObservationCorrespondenceEntry[] {
  if (Array.isArray(filter)) {
    if (filter.length === 0) return entries;
    const allowed = new Set<ObservationGapCategory>(filter);
    return entries.filter((e) => allowed.has(e.category));
  }
  if (filter === "all") return entries;
  return entries.filter((e) => e.category === filter);
}

export function formatCategoryLabel(category: ObservationGapCategory): string {
  switch (category) {
    case "expected_and_detected":
      return "EXPECTED · DETECTED";
    case "expected_but_not_detected":
      return "EXPECTED · NOT DETECTED";
    case "detected_unexpected":
      return "OBSERVED · OUTSIDE BASELINE";
  }
}

export function formatBaselineTier(status: string | null): string {
  switch (status) {
    case "frequent":
      return "FREQUENT IN CONTEXT";
    case "rare":
      return "INFREQUENT SEASONAL";
    case "expected":
      return "EXPECTED IN CONTEXT";
    default:
      return "OUTSIDE PRIMARY BASELINE";
  }
}
