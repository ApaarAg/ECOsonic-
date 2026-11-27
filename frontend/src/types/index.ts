export type AnalysisStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export type ReviewStatus = 'unreviewed' | 'confirmed' | 'rejected' | 'uncertain' | 'needs_evidence';

export type LocationSensitivity = 'exact' | 'generalized' | 'restricted';

export interface Site {
  id: string;
  name: string;
  latitude?: number | null;
  longitude?: number | null;
  description?: string | null;
  ecosystem_category?: string;
  timezone?: string;
  location_sensitivity: LocationSensitivity;
  generalized_latitude?: number | null;
  generalized_longitude?: number | null;
  ecosystem_profile?: Record<string, any> | null;
  metadata?: Record<string, any> | null;
  created_at: string;
  analyses_count?: number;
}

export interface SiteCreate {
  name: string;
  latitude: number;
  longitude: number;
  description?: string;
  ecosystem_category?: string;
  timezone?: string;
  location_sensitivity?: LocationSensitivity;
}

export type CreateSitePayload = SiteCreate;

export type LiveSessionStatus = 'created' | 'active' | 'paused' | 'stopped';

export interface LiveSession {
  id: string;
  source_type: string;
  device_id?: string | null;
  site_id?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  started_at: string;
  stopped_at?: string | null;
  status: LiveSessionStatus;
  sample_rate: number;
  channels: number;
  total_audio_seconds: number;
  processed_audio_seconds: number;
  dropped_frames: number;
  dropped_windows: number;
  created_at: string;
  events_count?: number;
  segments_count?: number;
}

export interface LiveSessionCreate {
  source_type?: string;
  site_id?: string;
  device_id?: string;
  sample_rate?: number;
  channels?: number;
  latitude?: number;
  longitude?: number;
}

export interface LiveSessionStats {
  processed_windows: number;
  silent_windows: number;
  dropped_windows: number;
  received_frames: number;
  dropped_frames: number;
  duplicate_frames: number;
  active_websockets: number;
  total_bytes_received: number;
  total_seconds_written: number;
}

export interface LiveEvent {
  id: string;
  session_id: string;
  detection_id?: string;
  start_seconds: number;
  end_seconds: number;
  class_label: string;
  scientific_name?: string;
  common_name?: string;
  confidence_score: number;
  record_type: 'animal' | 'sound_class';
  taxon_group?: string;
  model_version?: string;
  geo_score?: number | null;
  created_at?: string;
}

export interface DisturbanceEvent {
  id?: string;
  event_id?: string;
  session_id: string;
  event_type: string;
  class_label: string;
  category?: 'anthrophony' | 'geophony' | 'biophony' | string;
  hazard_classification?: 'critical' | 'medium' | 'low' | string;
  start_seconds: number;
  end_seconds: number;
  confidence_score: number;
  model_version?: string;
  review_status?: string;
  repetition_count?: number;
  incident_id?: string | null;
  created_at?: string;
}

export interface SoundscapeMetrics {
  aci?: number;
  adi?: number;
  aei?: number;
  ndsi?: number;
  spectral_entropy?: number;
  temporal_activity?: number;
  biophony_ratio?: number;
  anthrophony_ratio?: number;
  [key: string]: number | undefined;
}

export interface SoundscapeFingerprint {
  id?: string;
  measurement_id?: string;
  session_id?: string;
  start_seconds?: number;
  end_seconds?: number;
  metrics: SoundscapeMetrics;
  frequency_bands?: {
    sub_bass?: number;
    bass?: number;
    mid?: number;
    high?: number;
    ultra_high?: number;
    [key: string]: number | undefined;
  };
  calculation_parameters?: Record<string, any>;
  quality_flags: string[];
}

export interface TimelineItem {
  id: string;
  session_id: string;
  item_type: 'biological_detection' | 'disturbance_event' | 'soundscape_measurement';
  start_seconds: number;
  end_seconds: number;
  label: string;
  confidence_score?: number | null;
  details: Record<string, any>;
  created_at: string;
}

export interface AnomalyCandidate {
  candidate_id: string;
  segment_id: string;
  session_id?: string | null;
  start_seconds: number;
  end_seconds: number;
  duration_seconds: number;
  anomaly_score: number;
  heuristic_breakdown?: {
    knn_distance?: number;
    spectral_entropy?: number;
    model_ambiguity?: number;
    [key: string]: number | undefined;
  };
  primary_reasons?: string[];
  soundscape_context?: Record<string, any>;
  review_status?: string;
  audio_path?: string | null;
  created_at?: string;
  disclaimer: string;
}

export interface AcousticMemoryStatus {
  total_vectors: number;
  vector_dimension: number;
  index_type: string;
  model_version: string;
  is_trained: boolean;
}

export interface AcousticMemorySearchResult {
  segment_id: string;
  session_id?: string;
  start_seconds: number;
  end_seconds: number;
  similarity_score: number;
  class_label?: string;
  scientific_name?: string;
  common_name?: string;
  audio_url?: string;
}

export interface UMAPPoint {
  id: string;
  segment_id: string;
  x: number;
  y: number;
  cluster_id: number;
  label: string;
  confidence: number;
  session_id?: string;
}

export interface ClusteringRunResponse {
  cluster_run_id: string;
  model_version: string;
  dataset_size: number;
  cluster_count: number;
  noise_count: number;
  cluster_sizes: Record<string, number>;
  parameters: Record<string, any>;
  status: string;
  elapsed_seconds: number;
  disclaimer: string;
}

export interface MetricDriftStat {
  baseline_value: number | null;
  target_value: number | null;
  delta: number | null;
  pct_change: number | null;
  robust_z_score: number | null;
  is_statistically_significant: boolean;
}

export interface HabitatDriftSummary {
  site_id: string;
  ecosystem_category: string;
  overall_habitat_trend: string;
  evaluated_comparisons_count: number;
  latest_drift_category: string;
  biophony_trend: string;
  anthrophony_trend: string;
  stability_index: number;
  recent_comparisons: any[];
  disclaimer: string;
}

export interface SiteGeoContext {
  site_id: string | null;
  site_name: string | null;
  latitude: number;
  longitude: number;
  week: number;
  recording_date: string | null;
  model_version: string;
  total_regional_species: number;
  expected_species_count: number;
  rare_species_count: number;
  top_regional_species: Array<{
    species_code: string;
    scientific_name: string;
    common_name: string;
    occurrence_probability: number;
    is_expected: boolean;
    is_rare: boolean;
  }>;
  disclaimer: string;
}

export interface EnvironmentalIncident {
  id: string;
  incident_code: string;
  site_id?: string | null;
  session_id?: string | null;
  primary_event_id?: string | null;
  title: string;
  category: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'investigating' | 'resolved' | 'false_positive';
  event_ids: string[];
  evidence?: Record<string, any>;
  investigation_notes?: string | null;
  resolution_notes?: string | null;
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
  disclaimer: string;
}

export interface ReviewCreate {
  review_status: ReviewStatus;
  reviewer_note?: string | null;
}

export interface Review {
  id: string;
  detection_id: string;
  review_status: ReviewStatus;
  reviewer_note?: string | null;
  created_at: string;
}

export interface Detection {
  id: string;
  analysis_id?: string;
  session_id?: string;
  class_label: string;
  scientific_name: string;
  common_name: string;
  taxon_group?: string;
  record_type?: string;
  start_seconds: number;
  end_seconds: number;
  confidence_score: number;
  geo_score?: number | null;
  review_status: ReviewStatus;
  reviews?: Review[];
  created_at?: string;
}

export interface AnalysisMetrics {
  total_detections?: number;
  unique_species_count?: number;
  species_detected?: string[];
  average_confidence?: number;
  embedding_vectors_count?: number;
  rms_amplitude?: number;
  sample_rate?: number;
  channels?: number;
  aci?: number;
  ndsi?: number;
  biophony_ratio?: number;
  anthrophony_ratio?: number;
}

export interface Analysis {
  id: string;
  filename: string;
  audio_path: string;
  processed_path?: string;
  status: AnalysisStatus;
  progress: number;
  current_stage?: string;
  duration_seconds?: number;
  latitude?: number | null;
  longitude?: number | null;
  recorded_at?: string | null;
  model_version?: string;
  metrics_json?: AnalysisMetrics;
  embedding_path?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
  detections_count?: number;
  detections?: Detection[];
  embedding_segments?: Array<{
    segment_id: string;
    analysis_id: string;
    vector_index: number;
    start_seconds: number;
    end_seconds: number;
    detection_id?: string;
    umap_x?: number;
    umap_y?: number;
  }>;
}

export interface AnalysisStatusResponse {
  id: string;
  status: AnalysisStatus;
  progress: number;
  current_stage?: string;
  error_message?: string;
  updated_at: string;
}

export interface AcousticInspection {
  analysis_id: string;
  filename: string;
  file_inspected: string;
  duration_seconds: number;
  sample_rate: number;
  channels: number;
  is_mono: boolean;
  format: string;
  subtype?: string;
  frames: number;
  file_size_bytes: number;
  rms_amplitude: number;
  metrics?: AnalysisMetrics;
}

export interface SoundSimilarityMatch {
  segment_id: string;
  analysis_id: string;
  filename: string;
  scientific_name: string;
  common_name: string;
  similarity_score: number;
  start_seconds: number;
  end_seconds: number;
}

export interface TopSpeciesSummary {
  scientific_name: string;
  common_name: string;
  detection_count: number;
  max_confidence: number;
}

export interface PlatformSummaryReport {
  analyses: {
    total: number;
    completed: number;
    failed: number;
  };
  detections: {
    total: number;
    unique_species_count: number;
  };
  reviews: {
    total_reviews: number;
    confirmed_count: number;
  };
  top_species: TopSpeciesSummary[];
}

export interface HealthStatus {
  status: string;
  service: string;
  version: string;
  model_version: string;
  model_ready: boolean;
  model_device: string;
  direct_onnx_engine?: {
    initialized: boolean;
    provider?: string;
    model_path?: string;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}
