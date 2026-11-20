import { apiClient } from './api';
import { PaginatedResponse, Site } from '../types';

export interface CreateSitePayload {
  name: string;
  latitude: number;
  longitude: number;
  description?: string;
}

export const sitesService = {
  /**
   * List monitoring stations
   */
  async listSites(page = 1, pageSize = 50): Promise<PaginatedResponse<Site>> {
    const response = await apiClient.get<PaginatedResponse<Site>>('/sites', {
      params: { page, page_size: pageSize },
    });
    return response.data;
  },

  /**
   * Register a new bioacoustic monitoring station
   */
  async createSite(payload: CreateSitePayload): Promise<Site> {
    const response = await apiClient.post<Site>('/sites', payload);
    return response.data;
  },

  /**
   * Retrieve site detail
   */
  async getSite(id: string): Promise<Site> {
    const response = await apiClient.get<Site>(`/sites/${id}`);
    return response.data;
  },

  /**
   * Update site parameters
   */
  async updateSite(id: string, payload: Partial<CreateSitePayload>): Promise<Site> {
    const response = await apiClient.patch<Site>(`/sites/${id}`, payload);
    return response.data;
  },

  /**
   * Remove a monitoring site
   */
  async deleteSite(id: string): Promise<{ message: string; success: boolean }> {
    const response = await apiClient.delete<{ message: string; success: boolean }>(`/sites/${id}`);
    return response.data;
  },
};
