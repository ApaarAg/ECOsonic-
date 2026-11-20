import { apiClient, API_BASE_URL } from './api';
import { PlatformSummaryReport } from '../types';

export const reportsService = {
  /**
   * Get high-level biodiversity intelligence and platform statistics
   */
  async getSummary(): Promise<PlatformSummaryReport> {
    const response = await apiClient.get<PlatformSummaryReport>('/reports/summary');
    return response.data;
  },

  /**
   * Returns CSV export download URL
   */
  getExportUrl(analysisId?: string): string {
    const query = analysisId ? `?analysis_id=${encodeURIComponent(analysisId)}` : '';
    return `${API_BASE_URL}/reports/export${query}`;
  },
};
