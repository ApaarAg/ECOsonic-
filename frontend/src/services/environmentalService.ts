import apiClient from './api';
import { EnvironmentalIncident, ReviewCreate } from '../types';

export const environmentalService = {
  async getIncidents(params?: {
    site_id?: string;
    priority?: string;
    status?: string;
    category?: string;
    limit?: number;
  }): Promise<EnvironmentalIncident[]> {
    const res = await apiClient.get<EnvironmentalIncident[]>('/environmental-incidents', { params });
    return res.data;
  },

  async getIncident(id: string): Promise<EnvironmentalIncident> {
    const res = await apiClient.get<EnvironmentalIncident>(`/environmental-incidents/${id}`);
    return res.data;
  },

  async updateIncident(
    id: string,
    data: {
      status?: 'open' | 'investigating' | 'resolved' | 'false_positive';
      investigation_notes?: string;
      resolution_notes?: string;
    }
  ): Promise<EnvironmentalIncident> {
    const res = await apiClient.patch<EnvironmentalIncident>(`/environmental-incidents/${id}`, data);
    return res.data;
  },

  async reviewDisturbanceEvent(eventId: string, data: ReviewCreate): Promise<any> {
    const res = await apiClient.post(`/environmental-events/${eventId}/review`, data);
    return res.data;
  },

  async getReviews(params?: { review_status?: string; limit?: number }): Promise<any[]> {
    const res = await apiClient.get('/environmental-reviews', { params });
    return res.data;
  },

  async contextualizeGeo(data: {
    latitude: number;
    longitude: number;
    week?: number;
    threshold?: number;
  }): Promise<any> {
    const res = await apiClient.post('/geo/contextualize', data);
    return res.data;
  },
};
