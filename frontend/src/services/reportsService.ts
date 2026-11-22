import apiClient, { API_BASE_URL } from './api';
import { PlatformSummaryReport } from '../types';

export const reportsService = {
  async getSummary(params?: { site_id?: string }): Promise<PlatformSummaryReport> {
    const res = await apiClient.get<PlatformSummaryReport>('/reports/summary', { params });
    return res.data;
  },

  getExportUrl(
    params?: string | {
      export_type?: string;
      format?: string;
      site_id?: string;
    }
  ): string {
    if (typeof params === 'string') {
      return `${API_BASE_URL}/reports/export?analysis_id=${encodeURIComponent(params)}`;
    }
    const p = new URLSearchParams({
      export_type: params?.export_type || 'detections',
      format: params?.format || 'csv',
      ...(params?.site_id ? { site_id: params.site_id } : {}),
    });
    return `${API_BASE_URL}/reports/export?${p.toString()}`;
  },

  async downloadExport(params: {
    export_type: 'detections' | 'disturbances' | 'soundscape' | 'habitat_drift';
    format: 'csv' | 'json';
    site_id?: string;
    start_date?: string;
    end_date?: string;
  }): Promise<void> {
    const res = await apiClient.get('/reports/export', {
      params,
      responseType: 'blob',
    });

    const blob = new Blob([res.data], {
      type: params.format === 'csv' ? 'text/csv;charset=utf-8;' : 'application/json;charset=utf-8;',
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute(
      'download',
      `ecosonic_${params.export_type}_${new Date().toISOString().split('T')[0]}.${params.format}`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  },
};
