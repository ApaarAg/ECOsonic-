import apiClient from './api';
import { Site, SiteCreate, SiteGeoContext, HabitatDriftSummary, EnvironmentalIncident, CreateSitePayload } from '../types';

export type { CreateSitePayload };

export const sitesService = {
  async getSites(): Promise<Site[]> {
    const res = await apiClient.get<Site[]>('/sites');
    return res.data;
  },

  async listSites(page: number = 1, pageSize: number = 50): Promise<{ items: Site[]; total: number }> {
    const items = await this.getSites();
    return { items, total: items.length };
  },

  async getSite(id: string): Promise<Site> {
    const res = await apiClient.get<Site>(`/sites/${id}`);
    return res.data;
  },

  async createSite(data: SiteCreate): Promise<Site> {
    const res = await apiClient.post<Site>('/sites', data);
    return res.data;
  },

  async updateSite(id: string, data: Partial<SiteCreate>): Promise<Site> {
    const res = await apiClient.patch<Site>(`/sites/${id}`, data);
    return res.data;
  },

  async deleteSite(id: string): Promise<void> {
    await apiClient.delete(`/sites/${id}`);
  },

  async getSiteGeoContext(id: string): Promise<SiteGeoContext> {
    const res = await apiClient.get<SiteGeoContext>(`/sites/${id}/geo-context`);
    return res.data;
  },

  async getSiteSpeciesContext(id: string): Promise<any> {
    const res = await apiClient.get(`/sites/${id}/species-context`);
    return res.data;
  },

  async getSiteHabitatDrift(id: string): Promise<HabitatDriftSummary> {
    const res = await apiClient.get<HabitatDriftSummary>(`/sites/${id}/habitat-drift`);
    return res.data;
  },

  async getSiteHistory(id: string): Promise<any> {
    const res = await apiClient.get(`/sites/${id}/history`);
    return res.data;
  },

  async getSiteIncidents(id: string): Promise<EnvironmentalIncident[]> {
    const res = await apiClient.get<EnvironmentalIncident[]>(`/sites/${id}/incidents`);
    return res.data;
  },

  async getSiteReports(id: string): Promise<any> {
    const res = await apiClient.get(`/sites/${id}/reports`);
    return res.data;
  },
};
