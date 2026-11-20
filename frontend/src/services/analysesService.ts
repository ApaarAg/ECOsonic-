import { apiClient, API_BASE_URL } from './api';
import {
  Analysis,
  AnalysisStatusResponse,
  PaginatedResponse,
} from '../types';

export interface UploadAnalysisParams {
  file: File;
  latitude?: number;
  longitude?: number;
  recorded_at?: string;
  model_version?: string;
}

export const analysesService = {
  /**
   * Upload an audio recording and trigger async background analysis pipeline
   */
  async uploadAnalysis(params: UploadAnalysisParams): Promise<Analysis> {
    const formData = new FormData();
    formData.append('file', params.file);
    if (params.latitude !== undefined && params.latitude !== null) {
      formData.append('latitude', String(params.latitude));
    }
    if (params.longitude !== undefined && params.longitude !== null) {
      formData.append('longitude', String(params.longitude));
    }
    if (params.recorded_at) {
      formData.append('recorded_at', params.recorded_at);
    }
    if (params.model_version) {
      formData.append('model_version', params.model_version);
    }

    const response = await apiClient.post<Analysis>('/analyses', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  /**
   * List recent analyses with pagination and status filter
   */
  async listAnalyses(page = 1, pageSize = 20, status?: string): Promise<PaginatedResponse<Analysis>> {
    const response = await apiClient.get<PaginatedResponse<Analysis>>('/analyses', {
      params: {
        page,
        page_size: pageSize,
        ...(status ? { status } : {}),
      },
    });
    return response.data;
  },

  /**
   * Get detailed analysis record with detections and embedding segments
   */
  async getAnalysis(id: string): Promise<Analysis> {
    const response = await apiClient.get<Analysis>(`/analyses/${id}`);
    return response.data;
  },

  /**
   * Fast polling status endpoint for progress tracking
   */
  async getAnalysisStatus(id: string): Promise<AnalysisStatusResponse> {
    const response = await apiClient.get<AnalysisStatusResponse>(`/analyses/${id}/status`);
    return response.data;
  },

  /**
   * Delete analysis record, associated detections and disk assets
   */
  async deleteAnalysis(id: string): Promise<{ message: string; success: boolean }> {
    const response = await apiClient.delete<{ message: string; success: boolean }>(`/analyses/${id}`);
    return response.data;
  },

  /**
   * Direct download link for embedding binary NumPy array
   */
  getEmbeddingsDownloadUrl(id: string): string {
    return `${API_BASE_URL}/analyses/${id}/embeddings/download`;
  },
};
