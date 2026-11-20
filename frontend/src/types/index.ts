export type AnalysisStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export type ReviewStatus = 'unreviewed' | 'confirmed' | 'rejected' | 'uncertain';

export interface AnalysisMetrics {
  total_detections?: number;
  unique_species_count?: number;
  species_detected?: string[];
  average_confidence?: number;
  embedding_vectors_count?: number;
  rms_amplitude?: number;
  sample_rate?: number;
  channels?: number;
  aci?: number; // Acoustic Complexity Index
  ndsi?: number; // Normalized Difference Soundscape Index
  biophony_ratio?: number;
  anthrophony_ratio?: number;
}

export interface Review {
  id: string;
  detection_id: string;
  review_status: ReviewStatus;
  reviewer_note?: string;
  created_at: string;
}

export interface EmbeddingSegment {
  segment_id: string;
  analysis_id: string;
  vector_index: number;
  start_seconds: number;
  end_seconds: number;
  detection_id?: string;
  umap_x?: number;
  umap_y?: number;
}

export interface Detection {
  id: string;
  analysis_id: string;
  class_label: string;
  scientific_name: string;
  common_name: string;
  taxon_group?: string;
  record_type?: string;
  start_seconds: number;
  end_seconds: number;
  confidence_score: number;
  geo_score?: number;
  review_status: ReviewStatus;
  reviews?: Review[];
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
  latitude?: number;
  longitude?: number;
  recorded_at?: string;
  model_version?: string;
  metrics_json?: AnalysisMetrics;
  embedding_path?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
  detections_count?: number;
  detections?: Detection[];
  embedding_segments?: EmbeddingSegment[];
}

export interface AnalysisStatusResponse {
  id: string;
  status: AnalysisStatus;
  progress: number;
  current_stage?: string;
  error_message?: string;
  updated_at: string;
}

export interface Site {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  description?: string;
  created_at: string;
  analyses_count?: number;
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

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface SoundSimilarityMatch {
  segment_id: string;
  analysis_id: string;
  filename: string;
  scientific_name: string;
  common_name: string;
  start_seconds: number;
  end_seconds: number;
  similarity_score: number;
  distance: number;
  timestamp: string;
}
