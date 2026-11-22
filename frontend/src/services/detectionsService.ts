import apiClient from './api';
import { Detection, ReviewCreate, Review, ReviewStatus } from '../types';

export const detectionsService = {
  async getDetections(params?: {
    site_id?: string;
    analysis_id?: string;
    species_code?: string;
    min_confidence?: number;
    start_time?: string;
    end_time?: string;
    review_status?: string;
    limit?: number;
  }): Promise<Detection[]> {
    const res = await apiClient.get<Detection[]>('/detections', { params });
    return res.data;
  },

  async listDetections(params?: {
    review_status?: string;
    page_size?: number;
    page?: number;
  }): Promise<{ items: Detection[]; total: number; page: number; page_size: number }> {
    const items = await this.getDetections({
      review_status: params?.review_status,
      limit: params?.page_size,
    });
    return {
      items,
      total: items.length,
      page: params?.page || 1,
      page_size: params?.page_size || 50,
    };
  },

  async getDetection(id: string): Promise<Detection> {
    const res = await apiClient.get<Detection>(`/detections/${id}`);
    return res.data;
  },

  async submitReview(
    detectionId: string,
    review: ReviewCreate | ReviewStatus,
    note?: string
  ): Promise<Review> {
    const payload: ReviewCreate =
      typeof review === 'string'
        ? { review_status: review, reviewer_note: note || null }
        : review;
    const res = await apiClient.post<Review>(`/detections/${detectionId}/reviews`, payload);
    return res.data;
  },
};
