import { describe, it, expect } from 'vitest';
import { apiClient, API_BASE_URL } from '../services/api';
import { reportsService } from '../services/reportsService';
import { analysesService } from '../services/analysesService';
import { acousticService } from '../services/acousticService';

describe('API Services', () => {
  it('configures standard API baseURL with v1 prefix', () => {
    expect(API_BASE_URL).toContain('/api/v1');
    expect(apiClient.defaults.baseURL).toContain('/api/v1');
  });

  it('generates correct CSV export URL', () => {
    const url = reportsService.getExportUrl('test-analysis-123');
    expect(url).toBe('/api/v1/reports/export?analysis_id=test-analysis-123');
  });

  it('generates correct embeddings download URL', () => {
    const url = analysesService.getEmbeddingsDownloadUrl('test-uuid-456');
    expect(url).toBe('/api/v1/analyses/test-uuid-456/embeddings/download');
  });

  it('generates correct audio streaming URL', () => {
    const url = acousticService.getAudioStreamUrl('test-uuid-789');
    expect(url).toBe('/api/v1/acoustic/stream/test-uuid-789');
  });
});
