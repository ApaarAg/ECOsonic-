import { apiClient } from './api';
import {
  Detection,
  PaginatedResponse,
  Review,
  ReviewStatus,
} from '../types';

export interface DetectionFilterParams {
  analysis_id?: string;
  min_confidence?: number;
  species?: string;
  review_status?: string;
  page?: number;
  page_size?: number;
}

export const detectionsService = {
  /**
   * List and filter detections across recordings
   */
  async listDetections(params: DetectionFilterParams = {}): Promise<PaginatedResponse<Detection>> {
    const response = await apiClient.get<PaginatedResponse<Detection>>('/detections', {
      params,
    });
    return response.data;
  },

  /**
   * Get detection detail by ID
   */
  async getDetection(id: string): Promise<Detection> {
    const response = await apiClient.get<Detection>(`/detections/${id}`);
    return response.data;
  },

  /**
   * Submit an expert verification review (confirm, reject, uncertain)
   */
  async submitReview(
    detectionId: string,
    status: ReviewStatus,
    note?: string
  ): Promise<Review> {
    const response = await apiClient.post<Review>(`/detections/${detectionId}/reviews`, {
      review_status: status,
      reviewer_note: note,
    });
    return response.data;
  },
};
