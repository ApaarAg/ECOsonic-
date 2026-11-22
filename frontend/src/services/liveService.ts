import apiClient from './api';
import {
  LiveSession,
  LiveSessionCreate,
  TimelineItem,
  SoundscapeFingerprint,
  DisturbanceEvent,
  AnomalyCandidate,
} from '../types';

export const liveService = {
  async getSessions(params?: { site_id?: string; status?: string; limit?: number }): Promise<LiveSession[]> {
    const res = await apiClient.get<LiveSession[]>('/live/sessions', { params });
    return res.data;
  },

  async getSession(id: string): Promise<LiveSession> {
    const res = await apiClient.get<LiveSession>(`/live/sessions/${id}`);
    return res.data;
  },

  async createSession(data: LiveSessionCreate): Promise<LiveSession> {
    const res = await apiClient.post<LiveSession>('/live/sessions', data);
    return res.data;
  },

  async stopSession(id: string): Promise<LiveSession> {
    const res = await apiClient.post<LiveSession>(`/live/sessions/${id}/stop`);
    return res.data;
  },

  async getSessionTimeline(id: string): Promise<TimelineItem[]> {
    const res = await apiClient.get<TimelineItem[]>(`/live/sessions/${id}/timeline`);
    return res.data;
  },

  async getSessionSoundscape(id: string): Promise<SoundscapeFingerprint> {
    const res = await apiClient.get<SoundscapeFingerprint>(`/live/sessions/${id}/soundscape`);
    return res.data;
  },

  async getSessionFingerprint(id: string): Promise<SoundscapeFingerprint> {
    const res = await apiClient.get<SoundscapeFingerprint>(`/live/sessions/${id}/fingerprint`);
    return res.data;
  },

  async getSessionDisturbances(id: string): Promise<DisturbanceEvent[]> {
    const res = await apiClient.get<DisturbanceEvent[]>(`/live/sessions/${id}/disturbances`);
    return res.data;
  },

  async getSessionAnomalies(id: string): Promise<AnomalyCandidate[]> {
    const res = await apiClient.get<AnomalyCandidate[]>(`/live/sessions/${id}/anomalies`);
    return res.data;
  },

  async getSessionCoOccurrence(id: string): Promise<any[]> {
    const res = await apiClient.get(`/live/sessions/${id}/co-occurrence`);
    return res.data;
  },

  async getSessionIntelligence(id: string): Promise<any> {
    const res = await apiClient.get(`/live/sessions/${id}/intelligence`);
    return res.data;
  },

  async getDisturbanceTaxonomy(): Promise<Record<string, any>> {
    const res = await apiClient.get('/live/disturbances/taxonomy');
    return res.data;
  },
};
