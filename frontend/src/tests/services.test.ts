import { describe, it, expect } from 'vitest';
import { liveService } from '../services/liveService';
import { sitesService } from '../services/sitesService';
import { environmentalService } from '../services/environmentalService';
import { acousticMemoryService } from '../services/acousticMemoryService';
import { reportsService } from '../services/reportsService';

describe('Domain Services and Schema Mapping', () => {
  it('defines liveService with all required Phase 7 streaming methods', () => {
    expect(typeof liveService.createSession).toBe('function');
    expect(typeof liveService.getSessions).toBe('function');
    expect(typeof liveService.getSession).toBe('function');
    expect(typeof liveService.stopSession).toBe('function');
    expect(typeof liveService.getSessionTimeline).toBe('function');
    expect(typeof liveService.getSessionSoundscape).toBe('function');
    expect(typeof liveService.getSessionFingerprint).toBe('function');
    expect(typeof liveService.getSessionDisturbances).toBe('function');
    expect(typeof liveService.getSessionAnomalies).toBe('function');
    expect(typeof liveService.getDisturbanceTaxonomy).toBe('function');
  });

  it('defines sitesService with CRUD, geo-context and habitat drift methods', () => {
    expect(typeof sitesService.getSites).toBe('function');
    expect(typeof sitesService.getSite).toBe('function');
    expect(typeof sitesService.createSite).toBe('function');
    expect(typeof sitesService.updateSite).toBe('function');
    expect(typeof sitesService.deleteSite).toBe('function');
    expect(typeof sitesService.getSiteGeoContext).toBe('function');
    expect(typeof sitesService.getSiteHabitatDrift).toBe('function');
  });

  it('defines environmentalService with incidents and event reviews', () => {
    expect(typeof environmentalService.getIncidents).toBe('function');
    expect(typeof environmentalService.getIncident).toBe('function');
    expect(typeof environmentalService.updateIncident).toBe('function');
    expect(typeof environmentalService.reviewDisturbanceEvent).toBe('function');
  });

  it('defines acousticMemoryService with vector index, FAISS, and UMAP projection', () => {
    expect(typeof acousticMemoryService.getIndexStatus).toBe('function');
    expect(typeof acousticMemoryService.rebuildIndex).toBe('function');
    expect(typeof acousticMemoryService.searchSimilar).toBe('function');
    expect(typeof acousticMemoryService.runClustering).toBe('function');
    expect(typeof acousticMemoryService.getProjection).toBe('function');
    expect(typeof acousticMemoryService.getSegmentAudioUrl).toBe('function');
    expect(acousticMemoryService.getSegmentAudioUrl('seg-1')).toBe(
      '/api/v1/acoustic-memory/segments/seg-1/audio'
    );
  });

  it('defines reportsService with summary metrics and export downloader', () => {
    expect(typeof reportsService.getSummary).toBe('function');
    expect(typeof reportsService.downloadExport).toBe('function');
    expect(typeof reportsService.getExportUrl).toBe('function');
  });
});
