import apiClient, { API_BASE_URL } from './api';
import { Analysis, AnalysisStatusResponse, Detection } from '../types';

export const analysesService = {
  async uploadAudio(
    file: File,
    siteId?: string,
    latitude?: number,
    longitude?: number,
    confidenceThreshold: number = 0.25
  ): Promise<Analysis> {
    const formData = new FormData();
    formData.append('file', file);
    if (siteId) formData.append('site_id', siteId);
    if (latitude !== undefined) formData.append('latitude', latitude.toString());
    if (longitude !== undefined) formData.append('longitude', longitude.toString());
    formData.append('confidence_threshold', confidenceThreshold.toString());

    const res = await apiClient.post<Analysis>('/analyses', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return res.data;
  },

  async uploadAnalysis(params: {
    file: File;
    site_id?: string;
    latitude?: number;
    longitude?: number;
    recorded_at?: string;
  }): Promise<Analysis> {
    return this.uploadAudio(params.file, params.site_id, params.latitude, params.longitude);
  },

  async getAnalyses(params?: { site_id?: string; status?: string; limit?: number }): Promise<Analysis[]> {
    const res = await apiClient.get<Analysis[]>('/analyses', { params });
    return res.data;
  },

  async listAnalyses(
    page: number = 1,
    pageSize: number = 20,
    status?: string
  ): Promise<{ items: Analysis[]; total: number; page: number; page_size: number; total_pages: number }> {
    const items = await this.getAnalyses({ status, limit: pageSize });
    return {
      items,
      total: items.length,
      page,
      page_size: pageSize,
      total_pages: Math.ceil(items.length / pageSize) || 1,
    };
  },

  async getAnalysis(id: string): Promise<Analysis> {
    const res = await apiClient.get<Analysis>(`/analyses/${id}`);
    return res.data;
  },

  async getAnalysisStatus(id: string): Promise<AnalysisStatusResponse> {
    const res = await apiClient.get<AnalysisStatusResponse>(`/analyses/${id}/status`);
    return res.data;
  },

  async getAnalysisResults(id: string): Promise<any> {
    const res = await apiClient.get(`/analyses/${id}/results`);
    return res.data;
  },

  async getAnalysisDetections(id: string): Promise<Detection[]> {
    const res = await apiClient.get<Detection[]>(`/analyses/${id}/detections`);
    return res.data;
  },

  async deleteAnalysis(id: string): Promise<void> {
    await apiClient.delete(`/analyses/${id}`);
  },

  getEmbeddingsDownloadUrl(analysisId: string): string {
    return `${API_BASE_URL}/analyses/${analysisId}/embeddings/download`;
  },
};
