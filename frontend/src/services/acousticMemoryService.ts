import apiClient from './api';
import {
  AcousticMemoryStatus,
  AcousticMemorySearchResult,
  ClusteringRunResponse,
  UMAPPoint,
} from '../types';

export const acousticMemoryService = {
  async getIndexStatus(): Promise<AcousticMemoryStatus> {
    const res = await apiClient.get<AcousticMemoryStatus>('/acoustic-memory/index/status');
    return res.data;
  },

  async rebuildIndex(): Promise<{ status: string; total_vectors: number }> {
    const res = await apiClient.post('/acoustic-memory/index/rebuild');
    return res.data;
  },

  async searchSimilar(params: {
    segment_id?: string;
    embedding?: number[];
    k?: number;
    min_similarity?: number;
  }): Promise<AcousticMemorySearchResult[]> {
    const res = await apiClient.post<AcousticMemorySearchResult[]>('/acoustic-memory/search', params);
    return res.data;
  },

  async getClusters(): Promise<any> {
    const res = await apiClient.get('/acoustic-memory/clusters');
    return res.data;
  },

  async runClustering(params?: {
    min_cluster_size?: number;
    min_samples?: number;
  }): Promise<ClusteringRunResponse> {
    const res = await apiClient.post<ClusteringRunResponse>('/acoustic-memory/clusters/run', params || {});
    return res.data;
  },

  async getProjection(): Promise<{ points: UMAPPoint[]; dimensions: number; model_version: string }> {
    const res = await apiClient.get('/acoustic-memory/projection');
    return res.data;
  },

  getSegmentAudioUrl(segmentId: string): string {
    return `/api/v1/acoustic-memory/segments/${segmentId}/audio`;
  },

  async getSegmentSimilar(segmentId: string, limit: number = 5): Promise<AcousticMemorySearchResult[]> {
    const res = await apiClient.get<AcousticMemorySearchResult[]>(
      `/acoustic-memory/segments/${segmentId}/similar`,
      { params: { limit } }
    );
    return res.data;
  },
};
