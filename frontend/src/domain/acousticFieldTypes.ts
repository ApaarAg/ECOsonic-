export type AudioSourceKind = "microphone" | "demo" | "silent";

export type SessionConnectionKind = "live" | "demo" | "offline";

export type SessionStatusKind = "idle" | "listening" | "paused" | "error";

export interface VisualizationPosition {
  /** Rendering-only orbit angle; never an acoustic direction measurement. */
  orbitRad: number;
  /** Rendering-only lift; never a measured source elevation. */
  liftRad: number;
}

export interface AudioMetrics {
  /** Root-mean-square acoustic energy normalized to [0, 1]. */
  rms: number;
  /** Peak sample amplitude normalized to [0, 1]. */
  peak: number;
  /** Four ecological frequency strata: [sub-biotic, mid-biotic, avian-high, air]. */
  bands: [number, number, number, number];
  /** Normalized spectral centroid [0, 1]. */
  spectralCentroid: number;
  /** Temporal activity flux [0, 1]. */
  temporalFlux: number;
  /** Sample rate in Hz (ECOsonic canonical 32 kHz). */
  sampleRate: number;
  /** Channel count (canonical MONO = 1). */
  channels: number;
  /** Origin of the current audio signal. */
  source: AudioSourceKind;
  /** Timestamp (performance.now()) of last update. */
  updatedAt: number;
}

export interface DetectionEvent {
  id: string;
  /** Backend event discriminator, preserved from the WebSocket envelope. */
  eventType: "detection";
  sessionId: string;
  /** Original backend class_label, retained separately from display names. */
  classLabel: string;
  speciesCommon: string;
  speciesScientific: string;
  recordType: "animal" | "sound_class";
  taxonGroup: string | null;
  eventSemantics: "window_detection";
  /** Uncalibrated raw BirdNET output score in [0, 1]. */
  modelScore: number;
  /** Source/session-relative three-second inference window. */
  startSeconds: number;
  endSeconds: number;
  /** Wall-clock receipt time, kept separate from the acoustic interval. */
  receivedAtMs: number;
  /** Rendering aid only; does not represent measured source position. */
  visualizationPosition: VisualizationPosition;
  /** Explicit flag: demo/test detections must never masquerade as live observations. */
  isDemo: boolean;
}

export interface DisturbanceEvent {
  id: string;
  sessionId: string;
  kind: "anthropogenic" | "mechanical" | "wind-shear" | "unknown";
  /** Rendering strength only; not a measured physical intensity. */
  intensity: number;
  /** Raw backend model score, when provided. */
  modelScore: number | null;
  startSeconds: number;
  endSeconds: number;
  receivedAtMs: number;
  visualizationPosition: VisualizationPosition;
  durationMs: number;
  isDemo: boolean;
}

export interface SoundscapeMetrics {
  /** Acoustic Complexity Index */
  aci: number;
  /** Biophony ratio [0, 1] */
  biophony: number;
  /** Anthrophony ratio [0, 1] */
  anthrophony: number;
  /** Quietness / stillness factor [0, 1] */
  quietness: number;
}

export interface LatencyTelemetry {
  /** A. Audio capture latency: mic/worklet frame -> frontend domain store (ms). */
  captureLatencyMs: number | null;
  /** B. WebSocket latency: client -> FastAPI -> client heartbeat RTT (ms). */
  wsLatencyMs: number | null;
  /** C. Inference latency: BirdNET / ONNX processing duration reported by backend (ms). */
  inferenceLatencyMs: number | null;
  /** D. Visual response latency: detection/disturbance ingress -> WebGL frame render (ms). */
  visualResponseLatencyMs: number | null;
}

export interface SessionState {
  id: string | null;
  status: SessionStatusKind;
  connection: SessionConnectionKind;
  siteName: string;
  lastError: string | null;
}

export type EcologicalFetchStatus = "idle" | "loading" | "ready" | "unavailable";

export interface ObservationContext {
  session_id: string;
  latitude: number | null;
  longitude: number | null;
  generalized_coordinates: {
    latitude: number | null;
    longitude: number | null;
  } | null;
  location_name: string | null;
  ecosystem_category: string;
  elevation_m: number | null;
  timestamp: string;
  observation_date: string;
  meteorological_week: number;
  observation_duration_sec: number;
  total_audio_windows: number;
  acoustic_complexity_index: number | null;
  normalized_difference_soundscape_index: number | null;
}

export interface SpeciesImageProvenance {
  image_status: "available" | "unavailable";
  url: string | null;
  source: string | null;
  license: string | null;
  attribution: string | null;
  source_url: string | null;
  retrieved_at: string | null;
}

export interface GeospatialContextSummary {
  location: {
    latitude: number | null;
    longitude: number | null;
    generalized: { latitude: number | null; longitude: number | null } | null;
    location_name: string | null;
    coordinate_status: "provided" | "unspecified";
  };
  temporal_context: {
    timestamp: string;
    observation_date: string;
    meteorological_week: number;
    season: string;
  };
  ecological_context: {
    habitat: string | null;
    biome_band: string | null;
    hemisphere: string | null;
    region: string | null;
    reference_source: string;
    occurrence_basis: string;
    reference_limitations: string;
  };
  expected_species_count: number | null;
  reference_status: "available" | "empty_reference" | "unavailable";
}

export interface AnalysisSummaryDto {
  id: string;
  filename: string;
  status: string;
  progress: number;
  current_stage: string | null;
  duration_seconds: number | null;
  latitude: number | null;
  longitude: number | null;
  recorded_at: string | null;
  created_at: string;
  detections_count: number | null;
  error_message: string | null;
}

export interface DetectedSpeciesItem {
  species_id?: string | null;
  scientific_name: string;
  common_name: string | null;
  birdnet_taxonomy_id?: string | null;
  ebird_code?: string | null;
  max_confidence: number;
  mean_confidence: number;
  detection_count: number;
  first_seen_seconds: number;
  last_seen_seconds: number;
  is_persistent: boolean;
  is_expected: boolean;
  occurrence_score: number | null;
  occurrence_status: string | null;
  image?: SpeciesImageProvenance | null;
}

export interface ObservationGapSpeciesItem {
  species_id?: string | null;
  scientific_name: string;
  common_name: string | null;
  occurrence_score: number;
  occurrence_status: "expected" | "frequent" | "rare";
  birdnet_taxonomy_id: string | null;
  ebird_code: string | null;
  not_detected: boolean;
  evidence_status: "insufficient_evidence_for_absence";
  possible_factors: string[];
  image?: SpeciesImageProvenance | null;
}

export interface ObservationGapCoverage {
  metric_name: string;
  expected_species_count: number;
  detected_expected_count: number;
  detected_unexpected_count: number;
  gap_count: number;
  coverage_ratio: number;
  coverage_percentage: number;
  observation_adequacy:
    | "adequate"
    | "marginal_duration"
    | "insufficient_duration"
    | "location_unspecified"
    | "zero_detections";
  adequacy_explanation: string;
  disclaimer: string;
}

export interface EcologicalInterpretation {
  summary: string;
  observation_gap_explanation: string;
  detected_highlights: string[];
  unobserved_expected_highlights: string[];
  limitations: string[];
  disclaimer: string;
  provider: "gemini" | "deterministic_rule_engine" | "cached";
  is_grounded: boolean;
}

export interface EcologicalGapSnapshot {
  session_id: string;
  analysisId?: string | null;
  isDemo: boolean;
  context: ObservationContext;
  geospatial_context?: GeospatialContextSummary | null;
  coverage: ObservationGapCoverage;
  expected_and_detected: DetectedSpeciesItem[];
  expected_but_not_detected: ObservationGapSpeciesItem[];
  detected_unexpected: DetectedSpeciesItem[];
  interpretation: EcologicalInterpretation | null;
  scientific_disclaimer: string;
}

export interface ExpectedSpeciesDto {
  speciesId?: string | null;
  scientificName: string;
  commonName?: string | null;
  occurrenceScore: number;
  occurrenceStatus: "expected" | "frequent" | "rare";
  birdnetTaxonomyId?: string | null;
  ebirdCode?: string | null;
  image?: SpeciesImageProvenance | null;
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
  observationAdequacy?: ObservationGapCoverage["observation_adequacy"] | null;
  adequacyExplanation?: string | null;
  season?: string | null;
  biomeBand?: string | null;
  referenceStatus?: "available" | "empty_reference" | "unavailable" | null;
}

export interface ExpectedSpeciesBaseline {
  source: "observation_gap" | "sites_geo_context" | "analysis_record" | "demo_fixture";
  isDemo: boolean;
  sessionId?: string | null;
  analysisId?: string | null;
  siteId?: string | null;
  context: ExpectedSpeciesBaselineContext;
  expectedSpecies: ExpectedSpeciesDto[];
  disclaimer: string;
  emptyReason?: string | null;
}

export interface AcousticDomainSnapshot {
  audio: AudioMetrics;
  detections: DetectionEvent[];
  disturbances: DisturbanceEvent[];
  soundscape: SoundscapeMetrics;
  session: SessionState;
  latency: LatencyTelemetry;
  activeAnalysisId: string | null;
  activeAnalysisFilename: string | null;
  coordinates: {
    latitude: number | null;
    longitude: number | null;
    accuracyM: number | null;
    recordedAt: string | null;
    gpsStatus: "idle" | "acquiring" | "available" | "unavailable";
    gpsError: string | null;
  };
  geospatialContext: GeospatialContextSummary | null;
  ecologicalStatus: EcologicalFetchStatus;
  ecologicalContext: EcologicalGapSnapshot | null;
  expectedBaseline: ExpectedSpeciesBaseline | null;
  ecologicalError: string | null;
}
