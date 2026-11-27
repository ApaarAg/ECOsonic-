export type HabitatPresetId = 'temperate-rainforest' | 'boreal-wetland' | 'subalpine-ridge';

export type MonitoringStatus = 'idle' | 'streaming' | 'paused' | 'completed';

export type DisturbanceCategory =
  | 'transportation'
  | 'environmental_hazard'
  | 'mechanical_activity'
  | 'cultural_sound';

export type DisturbanceSeverity = 'low' | 'moderate' | 'elevated';

export interface SpeciesDetection {
  id: string;
  commonName: string;
  scientificName: string;
  timestampIso: string;
  /** Raw acoustic model confidence score (0..1), NOT a calibrated probability. */
  confidenceScore: number;
  sessionId: string;
  frequencyRangeHz: [number, number];
  durationSec: number;
  habitatPreset: HabitatPresetId;
}

export interface FrequencyBandEnergy {
  bandLabel: string;
  rangeHz: string;
  energyDb: number;
  /** Relative share of spectral energy (0..100%) */
  relativeSharePct: number;
  dominantSource: 'biophony' | 'geophony' | 'anthrophony';
}

export interface TemporalActivityPoint {
  timeLabel: string;
  timestampIso: string;
  biophonyIndex: number;
  anthrophonyIndex: number;
  detectionCount: number;
  meanSplDb: number;
}

export interface SoundscapeIndices {
  /** Acoustic Complexity Index */
  aci: number;
  /** Acoustic Diversity Index */
  adi: number;
  /** Acoustic Evenness Index */
  aei: number;
  /** Normalized Difference Soundscape Index (-1 to +1) */
  ndsi: number;
  /** Spectral Shannon Entropy (normalized 0 to 1) */
  spectralEntropy: number;
  /** Mean Sound Pressure Level in dBFS relative reference */
  meanLevelDbfs: number;
  computedAtIso: string;
}

export interface SoundscapeSnapshot {
  presetId: HabitatPresetId;
  siteName: string;
  indices: SoundscapeIndices;
  frequencyBands: FrequencyBandEnergy[];
  temporalActivity: TemporalActivityPoint[];
}

export interface DisturbanceEvent {
  id: string;
  category: DisturbanceCategory;
  label: string;
  description: string;
  timestampIso: string;
  durationSec: number;
  peakDbfs: number;
  frequencyBandHz: [number, number];
  severity: DisturbanceSeverity;
  confidenceScore: number;
  sessionId: string;
}

export interface SessionSoundscapeSummary {
  aciMean: number;
  ndsiMean: number;
  spectralEntropyMean: number;
  dominantBandHz: string;
}

export interface MonitoringSession {
  id: string;
  title: string;
  siteName: string;
  coordinatesLabel: string;
  startedAtIso: string;
  endedAtIso: string | null;
  durationSec: number;
  status: MonitoringStatus;
  sampleRateHz: number;
  speciesDetectionCount: number;
  distinctSpeciesCount: number;
  disturbanceEventCount: number;
  soundscapeSummary: SessionSoundscapeSummary;
  notes: string;
}

export interface AcousticStreamMetrics {
  framesProcessed: number;
  windowDurationSec: number;
  sampleRateHz: number;
  inputGainDb: number;
  rmsLevelDbfs: number;
  peakFrequencyHz: number;
  bufferLatencyMs: number;
}

export interface AudioInputPreferences {
  preferredDeviceId: string;
  sampleRateHz: 44100 | 48000;
  fftSize: 1024 | 2048 | 4096;
  minConfidenceThreshold: number;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

export interface BackendConnectionConfig {
  apiBaseUrl: string;
  wsStreamUrl: string;
  reconnectIntervalMs: number;
  mode: 'demo' | 'backend_ready';
}

export interface AppAppearancePreferences {
  theme: 'deep-forest' | 'field-light';
  reducedMotionOverride: boolean;
  showScientificNamesFirst: boolean;
}

export interface AdapterDiagnostics {
  adapterName: string;
  isDemoMode: boolean;
  protocolVersion: string;
  datasetId: string | null;
  adapterStatus: 'ready' | 'degraded' | 'offline';
  lastSyncIso: string | null;
  browserAudioApiSupported: boolean;
  mediaDevicesSupported: boolean;
  websocketReadyState: 'not_connected_demo' | 'connecting' | 'open' | 'closed';
}

export interface DetectionQueryOptions {
  search?: string;
  sessionId?: string | 'all';
  minConfidence?: number;
  sortBy?: 'timestamp_desc' | 'timestamp_asc' | 'confidence_desc' | 'name_asc';
}

export interface DisturbanceQueryOptions {
  category?: DisturbanceCategory | 'all';
  severity?: DisturbanceSeverity | 'all';
  sessionId?: string | 'all';
}

// ----------------------------------------------------------------------------
// Geospatial Ecological Intelligence & Observation Gap Types
// ----------------------------------------------------------------------------

export interface ObservationContextDto {
  sessionId: string;
  latitude?: number | null;
  longitude?: number | null;
  generalizedCoordinates?: { latitude?: number | null; longitude?: number | null } | null;
  locationName?: string | null;
  ecosystemCategory: string;
  elevationM?: number | null;
  timestamp: string;
  observationDate: string;
  meteorologicalWeek: number;
  observationDurationSec: number;
  totalAudioWindows: number;
  acousticComplexityIndex?: number | null;
  normalizedDifferenceSoundscapeIndex?: number | null;
}

export interface ExpectedSpeciesDto {
  speciesId?: string | null;
  scientificName: string;
  commonName?: string | null;
  occurrenceScore: number;
  occurrenceStatus: 'expected' | 'frequent' | 'rare';
  birdnetTaxonomyId?: string | null;
  ebirdCode?: string | null;
}

export interface DetectedSpeciesDto {
  speciesId?: string | null;
  scientificName: string;
  commonName?: string | null;
  birdnetTaxonomyId?: string | null;
  ebirdCode?: string | null;
  maxConfidence: number;
  meanConfidence: number;
  detectionCount: number;
  firstSeenSeconds: number;
  lastSeenSeconds: number;
  isPersistent: boolean;
  isExpected: boolean;
  occurrenceScore?: number | null;
  occurrenceStatus?: string | null;
}

export interface ObservationGapSpeciesDto {
  speciesId?: string | null;
  scientificName: string;
  commonName?: string | null;
  occurrenceScore: number;
  occurrenceStatus: 'expected' | 'frequent' | 'rare';
  birdnetTaxonomyId?: string | null;
  ebirdCode?: string | null;
  notDetected: boolean;
  evidenceStatus: 'insufficient_evidence_for_absence';
  possibleFactors: string[];
}

export interface ObservationGapCoverageDto {
  metricName: string;
  expectedSpeciesCount: number;
  detectedExpectedCount: number;
  detectedUnexpectedCount: number;
  gapCount: number;
  coverageRatio: number;
  coveragePercentage: number;
  observationAdequacy:
    | 'adequate'
    | 'marginal_duration'
    | 'insufficient_duration'
    | 'location_unspecified'
    | 'zero_detections';
  adequacyExplanation: string;
  disclaimer: string;
}

export interface EcologicalInterpretationDto {
  summary: string;
  observationGapExplanation: string;
  detectedHighlights: string[];
  unobservedExpectedHighlights: string[];
  limitations: string[];
  disclaimer: string;
  provider: 'gemini' | 'deterministic_rule_engine' | 'cached';
  isGrounded: boolean;
}

export interface ObservationGapAnalysis {
  sessionId: string;
  context: ObservationContextDto;
  coverage: ObservationGapCoverageDto;
  expectedAndDetected: DetectedSpeciesDto[];
  expectedButNotDetected: ObservationGapSpeciesDto[];
  detectedUnexpected: DetectedSpeciesDto[];
  interpretation?: EcologicalInterpretationDto | null;
  scientificDisclaimer: string;
}

export interface ExpectedSpeciesBaselineContext {
  locationName: string;
  ecosystemCategory: string;
  latitude?: number | null;
  longitude?: number | null;
  generalizedCoordinates?: { latitude?: number | null; longitude?: number | null } | null;
  observationDate?: string | null;
  meteorologicalWeek?: number | null;
  observationDurationSec?: number | null;
  observationAdequacy?: ObservationGapCoverageDto['observationAdequacy'] | null;
  adequacyExplanation?: string | null;
}

export interface ExpectedSpeciesBaseline {
  source: 'observation_gap' | 'sites_geo_context' | 'demo_fixture';
  isDemo: boolean;
  sessionId?: string | null;
  siteId?: string | null;
  context: ExpectedSpeciesBaselineContext;
  expectedSpecies: ExpectedSpeciesDto[];
  disclaimer: string;
  emptyReason?: string | null;
}
