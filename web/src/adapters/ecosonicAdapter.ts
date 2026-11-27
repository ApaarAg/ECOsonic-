import {
  DEMO_DETECTIONS,
  DEMO_DISTURBANCES,
  DEMO_SESSIONS,
  DEMO_SOUNDSCAPES,
  INITIAL_DEMO_STREAM_METRICS,
} from '../data/demoFixtures';
import { filterAndSortDetections, filterDisturbanceEvents } from '../lib/acoustics';
import type {
  AcousticStreamMetrics,
  AdapterDiagnostics,
  BackendConnectionConfig,
  DetectionQueryOptions,
  DisturbanceCategory,
  DisturbanceEvent,
  DisturbanceQueryOptions,
  DisturbanceSeverity,
  ExpectedSpeciesBaseline,
  ExpectedSpeciesDto,
  HabitatPresetId,
  MonitoringSession,
  MonitoringStatus,
  ObservationGapAnalysis,
  SoundscapeSnapshot,
  SpeciesDetection,
} from '../types/ecosonic';

/**
 * EcoSonicDataAdapter defines the frontend integration contract.
 *
 * Implemented by:
 * - BackendEcoSonicAdapter: Production FastAPI REST & WebSocket streaming integration
 * - DemoEcoSonicAdapter: Isolated client-side demo fixture fallback
 */
export interface EcoSonicDataAdapter {
  readonly name: string;
  readonly isDemoMode: boolean;

  getDiagnostics(): AdapterDiagnostics;

  fetchDetections(query?: DetectionQueryOptions): Promise<SpeciesDetection[]>;
  fetchSoundscapeSnapshot(presetId: HabitatPresetId): Promise<SoundscapeSnapshot>;
  fetchDisturbances(query?: DisturbanceQueryOptions): Promise<DisturbanceEvent[]>;
  fetchSessions(): Promise<MonitoringSession[]>;
  fetchSessionById(sessionId: string): Promise<MonitoringSession | null>;
  fetchObservationGap?(
    sessionId: string,
    coords?: { latitude?: number; longitude?: number }
  ): Promise<ObservationGapAnalysis | null>;
  fetchExpectedSpeciesBaseline?(options?: {
    sessionId?: string;
    siteId?: string;
    coords?: { latitude?: number; longitude?: number };
    week?: number;
  }): Promise<ExpectedSpeciesBaseline>;
  createSession?(data?: {
    source_type?: string;
    device_id?: string;
    latitude?: number;
    longitude?: number;
  }): Promise<{ id: string; status: string }>;
  stopSession?(sessionId: string): Promise<void>;
  getInitialStreamMetrics(): AcousticStreamMetrics;
}

/**
 * Production Backend Adapter: Connects directly to frozen FastAPI REST & WebSocket endpoints.
 */
export class BackendEcoSonicAdapter implements EcoSonicDataAdapter {
  public readonly name = 'BackendEcoSonicAdapter (FastAPI Direct ONNX & Real Stream)';
  public readonly isDemoMode = false;

  private apiBaseUrl: string;
  private wsBaseUrl: string;
  private lastSyncIso: string | null = null;
  private lastError: string | null = null;

  constructor(config?: Partial<BackendConnectionConfig>) {
    let defaultApi = 'http://localhost:8000';
    let defaultWs = 'ws://localhost:8000';

    if (typeof import.meta !== 'undefined' && import.meta.env) {
      if (import.meta.env.VITE_API_BASE_URL) {
        defaultApi = import.meta.env.VITE_API_BASE_URL;
      }
      if (import.meta.env.VITE_WS_BASE_URL) {
        defaultWs = import.meta.env.VITE_WS_BASE_URL;
      }
    }

    this.apiBaseUrl = (config?.apiBaseUrl || defaultApi).replace(/\/+$/, '');
    this.wsBaseUrl = (config?.wsStreamUrl || defaultWs).replace(/\/+$/, '');
  }

  public getDiagnostics(): AdapterDiagnostics {
    const hasAudioContext =
      typeof window !== 'undefined' &&
      ('AudioContext' in window || 'webkitAudioContext' in window);
    const hasMediaDevices =
      typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

    return {
      adapterName: this.name,
      isDemoMode: false,
      protocolVersion: 'EcoSonic 3.0 Frozen v1 Protocol (FastAPI + BirdNET+ V3.0 Direct ONNX)',
      datasetId: 'FastAPI Live Session Store',
      adapterStatus: this.lastError ? 'degraded' : 'ready',
      lastSyncIso: this.lastSyncIso,
      browserAudioApiSupported: hasAudioContext,
      mediaDevicesSupported: hasMediaDevices,
      websocketReadyState: 'closed',
    };
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...options?.headers,
        },
        ...options,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        let detail = `HTTP ${res.status} ${res.statusText}`;
        try {
          const parsed = JSON.parse(errorText);
          if (parsed.detail) detail = typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail);
        } catch {}
        throw new Error(detail);
      }

      this.lastSyncIso = new Date().toISOString();
      this.lastError = null;
      return (await res.json()) as T;
    } catch (err: any) {
      this.lastError = err.message || 'Network request failed';
      throw err;
    }
  }

  public async fetchSessions(): Promise<MonitoringSession[]> {
    const rawSessions = await this.request<any[]>('/api/v1/live/sessions?limit=50');
    return rawSessions.map((s) => this.mapLiveSessionToMonitoringSession(s));
  }

  public async fetchSessionById(sessionId: string): Promise<MonitoringSession | null> {
    try {
      const s = await this.request<any>(`/api/v1/live/sessions/${sessionId}`);
      let disturbances: any[] = [];
      try {
        disturbances = await this.request<any[]>(`/api/v1/live/sessions/${sessionId}/disturbances`);
      } catch {}

      return this.mapLiveSessionToMonitoringSession(s, disturbances);
    } catch (err: any) {
      if (err.message?.includes('404') || err.message?.includes('not found')) {
        return null;
      }
      throw err;
    }
  }

  public async fetchDetections(query?: DetectionQueryOptions): Promise<SpeciesDetection[]> {
    // If querying for a specific live session, fetch from that session's authoritative records
    if (query?.sessionId && query.sessionId !== 'all') {
      try {
        const sessionDetail = await this.request<any>(`/api/v1/live/sessions/${query.sessionId}`);
        const events: any[] = sessionDetail.events || [];
        const detections: SpeciesDetection[] = events.map((e, idx) => ({
          id: e.id || `det-${e.session_id}-${idx}`,
          commonName: e.common_name || e.class_label || 'Avian Species',
          scientificName: e.scientific_name || e.class_label || 'Aves',
          timestampIso: e.created_at || new Date().toISOString(),
          confidenceScore: Number(e.confidence_score || e.confidence || 0),
          sessionId: e.session_id,
          frequencyRangeHz: [1800, 7200],
          durationSec: Math.max(0.5, Number((e.end_seconds - e.start_seconds) || 3.0)),
          habitatPreset: 'temperate-rainforest',
        }));
        return filterAndSortDetections(detections, query);
      } catch (err) {
        console.warn(`Failed to fetch detections for session ${query.sessionId}:`, err);
        return [];
      }
    }

    // Query global detections
    try {
      const params = new URLSearchParams();
      params.set('page_size', '50');
      if (query?.minConfidence) {
        params.set('min_confidence', String(query.minConfidence));
      }
      if (query?.search) {
        params.set('species', query.search);
      }

      const res = await this.request<any>(`/api/v1/detections?${params.toString()}`);
      const items: any[] = Array.isArray(res) ? res : res.items || [];
      const detections: SpeciesDetection[] = items.map((d) => ({
        id: d.id,
        commonName: d.common_name || d.species_code,
        scientificName: d.scientific_name,
        timestampIso: d.created_at,
        confidenceScore: Number(d.confidence || 0),
        sessionId: d.analysis_id || 'live-session',
        frequencyRangeHz: [2000, 7500],
        durationSec: Math.max(0.5, Number((d.end_time - d.start_time) || 3.0)),
        habitatPreset: 'temperate-rainforest',
      }));

      return filterAndSortDetections(detections, query);
    } catch {
      // Fallback: collect detections across recent live sessions
      const sessions = await this.request<any[]>('/api/v1/live/sessions?limit=5').catch(() => []);
      const allDetections: SpeciesDetection[] = [];

      for (const s of sessions) {
        try {
          const detail = await this.request<any>(`/api/v1/live/sessions/${s.id}`);
          if (Array.isArray(detail.events)) {
            for (const e of detail.events) {
              allDetections.push({
                id: e.id,
                commonName: e.common_name || e.class_label,
                scientificName: e.scientific_name || e.class_label,
                timestampIso: e.created_at,
                confidenceScore: Number(e.confidence_score || 0),
                sessionId: e.session_id,
                frequencyRangeHz: [1800, 7200],
                durationSec: Math.max(0.5, Number((e.end_seconds - e.start_seconds) || 3.0)),
                habitatPreset: 'temperate-rainforest',
              });
            }
          }
        } catch {}
      }

      return filterAndSortDetections(allDetections, query);
    }
  }

  public async fetchDisturbances(query?: DisturbanceQueryOptions): Promise<DisturbanceEvent[]> {
    let allDisturbances: DisturbanceEvent[] = [];

    if (query?.sessionId && query.sessionId !== 'all') {
      try {
        const events = await this.request<any[]>(`/api/v1/live/sessions/${query.sessionId}/disturbances`);
        allDisturbances = events.map((e) => this.mapDisturbanceResponse(e));
      } catch (err) {
        console.warn(`Failed to fetch disturbances for session ${query.sessionId}:`, err);
        return [];
      }
    } else {
      // Fetch disturbances across recent sessions
      const sessions = await this.request<any[]>('/api/v1/live/sessions?limit=10').catch(() => []);
      for (const s of sessions) {
        try {
          const events = await this.request<any[]>(`/api/v1/live/sessions/${s.id}/disturbances`);
          for (const e of events) {
            allDisturbances.push(this.mapDisturbanceResponse(e));
          }
        } catch {}
      }
    }

    return filterDisturbanceEvents(allDisturbances, query);
  }

  public async fetchSoundscapeSnapshot(presetId: HabitatPresetId): Promise<SoundscapeSnapshot> {
    const sessions = await this.request<any[]>('/api/v1/live/sessions?limit=5').catch(() => []);
    if (sessions.length > 0) {
      const latestSession = sessions[0];
      try {
        const measurements = await this.request<any[]>(
          `/api/v1/live/sessions/${latestSession.id}/soundscape`
        );
        if (measurements.length > 0) {
          const latestM = measurements[measurements.length - 1];
          const mMetrics = latestM.metrics || {};
          const fBands = latestM.frequency_bands || {};

          return {
            presetId,
            siteName: latestSession.site_id ? `Site ${latestSession.site_id.slice(0, 8)}` : 'Live Forest Observatory',
            indices: {
              aci: Number(mMetrics.aci || 0),
              adi: Number(mMetrics.adi || 0),
              aei: Number(mMetrics.aei || 0),
              ndsi: Number(mMetrics.ndsi || 0),
              spectralEntropy: Number(mMetrics.spectral_entropy || 0),
              meanLevelDbfs: -35.2,
              computedAtIso: latestM.created_at || new Date().toISOString(),
            },
            frequencyBands: [
              {
                bandLabel: 'Anthrophony (Low)',
                rangeHz: '0 – 2,000 Hz',
                energyDb: -42.0,
                relativeSharePct: Math.round(Number(fBands.anthro_0_2khz || 0.15) * 100),
                dominantSource: 'anthrophony',
              },
              {
                bandLabel: 'Biophony (Mid)',
                rangeHz: '2,000 – 8,000 Hz',
                energyDb: -32.5,
                relativeSharePct: Math.round(Number(fBands.bio_2_8khz || 0.70) * 100),
                dominantSource: 'biophony',
              },
              {
                bandLabel: 'Biophony (High)',
                rangeHz: '8,000 – 16,000 Hz',
                energyDb: -48.0,
                relativeSharePct: Math.round(Number(fBands.high_bio_8_16khz || 0.15) * 100),
                dominantSource: 'biophony',
              },
            ],
            temporalActivity: measurements.map((m, idx) => ({
              timeLabel: `T+${Math.round(m.start_seconds || idx * 3)}s`,
              timestampIso: m.created_at || new Date().toISOString(),
              biophonyIndex: Number(m.metrics?.temporal_activity || 0.6),
              anthrophonyIndex: Number(m.metrics?.aei || 0.2),
              detectionCount: 1,
              meanSplDb: -36,
            })),
          };
        }
      } catch (err) {
        console.warn('Failed to fetch soundscape measurements:', err);
      }
    }

    // Return clean empty initial snapshot if no live measurements yet
    return {
      presetId,
      siteName: 'Live EcoSonic Node',
      indices: {
        aci: 0,
        adi: 0,
        aei: 0,
        ndsi: 0,
        spectralEntropy: 0,
        meanLevelDbfs: -96.0,
        computedAtIso: new Date().toISOString(),
      },
      frequencyBands: [],
      temporalActivity: [],
    };
  }

  public async createSession(data?: {
    source_type?: string;
    device_id?: string;
    latitude?: number;
    longitude?: number;
  }): Promise<{ id: string; status: string }> {
    const payload = {
      source_type: data?.source_type || 'browser_mic',
      device_id: data?.device_id || 'browser_audio_worklet',
      latitude: data?.latitude ?? null,
      longitude: data?.longitude ?? null,
      sample_rate: 32000,
      channels: 1,
    };
    return await this.request<{ id: string; status: string }>('/api/v1/live/sessions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public async stopSession(sessionId: string): Promise<void> {
    await this.request(`/api/v1/live/sessions/${sessionId}/stop`, {
      method: 'POST',
    });
  }

  public getInitialStreamMetrics(): AcousticStreamMetrics {
    return {
      framesProcessed: 0,
      windowDurationSec: 3.0,
      sampleRateHz: 32000,
      inputGainDb: 0,
      rmsLevelDbfs: -96.0,
      peakFrequencyHz: 0,
      bufferLatencyMs: 0,
    };
  }

  private mapLiveSessionToMonitoringSession(s: any, disturbances: any[] = []): MonitoringSession {
    const durationSec = Math.round(s.processed_audio_seconds || s.total_audio_seconds || 0);
    let status: MonitoringStatus = 'idle';
    if (s.status === 'active') status = 'streaming';
    else if (s.status === 'paused') status = 'paused';
    else if (s.status === 'stopped' || s.status === 'completed') status = 'completed';

    const latLabel = s.latitude ? `${Math.abs(s.latitude).toFixed(4)}° ${s.latitude >= 0 ? 'N' : 'S'}` : '';
    const lonLabel = s.longitude ? `${Math.abs(s.longitude).toFixed(4)}° ${s.longitude >= 0 ? 'E' : 'W'}` : '';
    const coordinatesLabel = latLabel && lonLabel ? `${latLabel}, ${lonLabel}` : 'Coordinates Unspecified';

    const events: any[] = s.events || [];
    const distinctSpecies = new Set(events.map((e) => e.scientific_name || e.class_label)).size;

    return {
      id: s.id,
      title: `Session ${s.id.slice(0, 8).toUpperCase()}`,
      siteName: s.site_id ? `Site ${s.site_id.slice(0, 8)}` : `Field Monitor (${s.source_type || 'mic'})`,
      coordinatesLabel,
      startedAtIso: s.started_at || s.created_at || new Date().toISOString(),
      endedAtIso: s.stopped_at || null,
      durationSec,
      status,
      sampleRateHz: s.sample_rate || 32000,
      speciesDetectionCount: s.events_count ?? events.length,
      distinctSpeciesCount: distinctSpecies > 0 ? distinctSpecies : Math.min(s.events_count || 0, 5),
      disturbanceEventCount: disturbances.length || s.disturbances_count || 0,
      soundscapeSummary: {
        aciMean: Number((s.stats?.mean_aci || 142.15).toFixed(2)),
        ndsiMean: Number((s.stats?.mean_ndsi || 0.35).toFixed(2)),
        spectralEntropyMean: Number((s.stats?.mean_entropy || 0.72).toFixed(2)),
        dominantBandHz: s.stats?.dominant_band || '3,000 – 6,000 Hz',
      },
      notes: s.device_id ? `Device ID: ${s.device_id}` : '',
    };
  }

  private mapDisturbanceResponse(e: any): DisturbanceEvent {
    let category: DisturbanceCategory = 'mechanical_activity';
    if (e.category?.includes('transportation') || e.event_type?.includes('vehicle') || e.event_type?.includes('aircraft')) {
      category = 'transportation';
    } else if (e.category?.includes('hazard') || e.hazard_classification === 'critical' || e.event_type?.includes('gunshot') || e.event_type?.includes('chainsaw')) {
      category = 'environmental_hazard';
    } else if (e.category?.includes('cultural')) {
      category = 'cultural_sound';
    }

    let severity: DisturbanceSeverity = 'low';
    if (e.hazard_classification === 'critical' || e.hazard_tier === 'critical' || e.priority_level === 'CRITICAL') {
      severity = 'elevated';
    } else if (e.hazard_classification === 'moderate' || (e.confidence_score > 0.75)) {
      severity = 'moderate';
    }

    return {
      id: e.id,
      category,
      label: e.class_label || e.event_type || 'Acoustic Disturbance',
      description: `Acoustic detection of ${e.class_label || e.event_type} (${e.category || 'anthropogenic'})`,
      timestampIso: e.created_at || new Date().toISOString(),
      durationSec: Math.max(0.5, Number((e.end_seconds - e.start_seconds) || 3.0)),
      peakDbfs: -18.4,
      frequencyBandHz: category === 'transportation' ? [50, 1200] : [800, 4200],
      severity,
      confidenceScore: Number(e.confidence_score || 0),
      sessionId: e.session_id,
    };
  }

  public async fetchObservationGap(
    sessionId: string,
    coords?: { latitude?: number; longitude?: number }
  ): Promise<ObservationGapAnalysis | null> {
    try {
      const payload: Record<string, any> = { session_id: sessionId };
      if (coords?.latitude !== undefined) payload.latitude = coords.latitude;
      if (coords?.longitude !== undefined) payload.longitude = coords.longitude;
      const res = await this.request<any>('/api/v1/ecology/observation-gap', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      return this.mapObservationGapResponse(res);
    } catch (err: any) {
      if (err.message?.includes('404')) return null;
      throw err;
    }
  }

  public async fetchExpectedSpeciesBaseline(options?: {
    sessionId?: string;
    siteId?: string;
    coords?: { latitude?: number; longitude?: number };
    week?: number;
  }): Promise<ExpectedSpeciesBaseline> {
    // 1. Prefer explicit session or active/latest session Observation Gap response
    let targetSessionId = options?.sessionId;
    if (!targetSessionId && !options?.siteId) {
      const sessions = await this.request<any[]>('/api/v1/live/sessions?limit=5');
      if (sessions.length > 0) {
        targetSessionId = sessions[0].id;
      }
    }

    if (targetSessionId) {
      const gap = await this.fetchObservationGap(targetSessionId, options?.coords);
      if (gap) {
        const baseline = buildExpectedBaselineFromGap(gap, false, 'observation_gap');
        // If session itself lacked coordinates and caller did not specify a sessionId, check registered sites
        if (
          baseline.expectedSpecies.length === 0 &&
          gap.coverage.observationAdequacy === 'location_unspecified' &&
          !options?.sessionId
        ) {
          const siteRes = await this.fetchBaselineFromRegisteredSites(options?.siteId, options?.week);
          if (siteRes) return siteRes;
        }
        return baseline;
      }
    }

    // 2. Fallback to registered Monitoring Sites regional geo-context
    const siteBaseline = await this.fetchBaselineFromRegisteredSites(options?.siteId, options?.week);
    if (siteBaseline) {
      return siteBaseline;
    }

    // 3. Empty live state — never fabricate birds
    return {
      source: 'observation_gap',
      isDemo: false,
      sessionId: targetSessionId ?? null,
      siteId: options?.siteId ?? null,
      context: {
        locationName: 'No Registered Monitoring Site',
        ecosystemCategory: 'unspecified',
        observationAdequacy: 'location_unspecified',
        adequacyExplanation:
          'No active monitoring session or registered site coordinates found in backend storage.',
      },
      expectedSpecies: [],
      disclaimer:
        'Expected species reflects the available ecological context and does not imply presence or absence at the observation site.',
      emptyReason:
        'No monitoring site or geocoded session context is currently stored. Register a site or launch a session in the Observatory to assemble the regional baseline.',
    };
  }

  private async fetchBaselineFromRegisteredSites(
    siteId?: string,
    week?: number
  ): Promise<ExpectedSpeciesBaseline | null> {
    let resolvedSiteId = siteId;
    let siteMeta: any = null;

    if (!resolvedSiteId) {
      const sitesPayload = await this.request<any>('/api/v1/sites?page_size=10');
      const items: any[] = Array.isArray(sitesPayload) ? sitesPayload : sitesPayload.items || [];
      siteMeta = items.find((item) => item.latitude != null && item.longitude != null) ?? items[0] ?? null;
      resolvedSiteId = siteMeta?.id;
    }

    if (!resolvedSiteId) {
      return null;
    }

    const params = new URLSearchParams();
    params.set('top_k', '40');
    if (week !== undefined) {
      params.set('week', String(week));
    }

    const geoCtx = await this.request<any>(
      `/api/v1/sites/${encodeURIComponent(resolvedSiteId)}/geo-context?${params.toString()}`
    );

    const rawSpecies: any[] = Array.isArray(geoCtx.top_regional_species)
      ? geoCtx.top_regional_species
      : [];

    const mapped: ExpectedSpeciesDto[] = rawSpecies
      .filter((s) => s.occurrence_status !== 'unexpected' && s.occurrence_status !== 'location_unspecified')
      .map((s) => ({
        speciesId: s.species_id ?? s.birdnet_taxonomy_id ?? null,
        scientificName: s.scientific_name,
        commonName: s.common_name ?? s.scientific_name,
        occurrenceScore: Number(s.geo_score ?? 0),
        occurrenceStatus: normalizeOccurrenceStatus(s.occurrence_status, Number(s.geo_score ?? 0)),
        birdnetTaxonomyId: s.birdnet_taxonomy_id ?? null,
        ebirdCode: s.species_code ?? null,
      }));

    return {
      source: 'sites_geo_context',
      isDemo: false,
      siteId: geoCtx.site_id ?? resolvedSiteId,
      context: {
        locationName: geoCtx.site_name || siteMeta?.name || 'Registered Field Station',
        ecosystemCategory: siteMeta?.ecosystem_category || 'unspecified',
        latitude: geoCtx.latitude ?? null,
        longitude: geoCtx.longitude ?? null,
        generalizedCoordinates:
          geoCtx.latitude != null && geoCtx.longitude != null
            ? {
                latitude: Math.round(Number(geoCtx.latitude) * 100) / 100,
                longitude: Math.round(Number(geoCtx.longitude) * 100) / 100,
              }
            : null,
        observationDate: geoCtx.recording_date ?? null,
        meteorologicalWeek: geoCtx.week ?? null,
        observationDurationSec: null,
        observationAdequacy: null,
        adequacyExplanation: null,
      },
      expectedSpecies: sortExpectedSpeciesDeterministic(mapped),
      disclaimer:
        geoCtx.disclaimer ||
        'Expected species reflects the available ecological context and does not imply presence or absence at the observation site.',
      emptyReason:
        mapped.length === 0
          ? 'No regional expected species met threshold criteria for these coordinates and season.'
          : null,
    };
  }

  private mapObservationGapResponse(raw: any): ObservationGapAnalysis {
    return {
      sessionId: raw.session_id,
      context: {
        sessionId: raw.context.session_id,
        latitude: raw.context.latitude,
        longitude: raw.context.longitude,
        generalizedCoordinates: raw.context.generalized_coordinates,
        locationName: raw.context.location_name,
        ecosystemCategory: raw.context.ecosystem_category,
        elevationM: raw.context.elevation_m,
        timestamp: raw.context.timestamp,
        observationDate: raw.context.observation_date,
        meteorologicalWeek: raw.context.meteorological_week,
        observationDurationSec: raw.context.observation_duration_sec,
        totalAudioWindows: raw.context.total_audio_windows,
        acousticComplexityIndex: raw.context.acoustic_complexity_index,
        normalizedDifferenceSoundscapeIndex: raw.context.normalized_difference_soundscape_index,
      },
      coverage: {
        metricName: raw.coverage.metric_name,
        expectedSpeciesCount: raw.coverage.expected_species_count,
        detectedExpectedCount: raw.coverage.detected_expected_count,
        detectedUnexpectedCount: raw.coverage.detected_unexpected_count,
        gapCount: raw.coverage.gap_count,
        coverageRatio: raw.coverage.coverage_ratio,
        coveragePercentage: raw.coverage.coverage_percentage,
        observationAdequacy: raw.coverage.observation_adequacy,
        adequacyExplanation: raw.coverage.adequacy_explanation,
        disclaimer: raw.coverage.disclaimer,
      },
      expectedAndDetected: (raw.expected_and_detected || []).map((d: any) => ({
        speciesId: d.species_id ?? d.birdnet_taxonomy_id ?? null,
        scientificName: d.scientific_name,
        commonName: d.common_name,
        birdnetTaxonomyId: d.birdnet_taxonomy_id ?? null,
        ebirdCode: d.ebird_code ?? null,
        maxConfidence: d.max_confidence,
        meanConfidence: d.mean_confidence,
        detectionCount: d.detection_count,
        firstSeenSeconds: d.first_seen_seconds,
        lastSeenSeconds: d.last_seen_seconds,
        isPersistent: d.is_persistent,
        isExpected: d.is_expected,
        occurrenceScore: d.occurrence_score,
        occurrenceStatus: d.occurrence_status,
      })),
      expectedButNotDetected: (raw.expected_but_not_detected || []).map((g: any) => ({
        speciesId: g.species_id ?? g.birdnet_taxonomy_id ?? null,
        scientificName: g.scientific_name,
        commonName: g.common_name,
        occurrenceScore: g.occurrence_score,
        occurrenceStatus: g.occurrence_status,
        birdnetTaxonomyId: g.birdnet_taxonomy_id,
        ebirdCode: g.ebird_code,
        notDetected: g.not_detected ?? true,
        evidenceStatus: g.evidence_status || 'insufficient_evidence_for_absence',
        possibleFactors: g.possible_factors || [],
      })),
      detectedUnexpected: (raw.detected_unexpected || []).map((u: any) => ({
        speciesId: u.species_id ?? u.birdnet_taxonomy_id ?? null,
        scientificName: u.scientific_name,
        commonName: u.common_name,
        birdnetTaxonomyId: u.birdnet_taxonomy_id ?? null,
        ebirdCode: u.ebird_code ?? null,
        maxConfidence: u.max_confidence,
        meanConfidence: u.mean_confidence,
        detectionCount: u.detection_count,
        firstSeenSeconds: u.first_seen_seconds,
        lastSeenSeconds: u.last_seen_seconds,
        isPersistent: u.is_persistent,
        isExpected: u.is_expected,
        occurrenceScore: u.occurrence_score,
        occurrenceStatus: u.occurrence_status,
      })),
      interpretation: raw.interpretation
        ? {
            summary: raw.interpretation.summary,
            observationGapExplanation: raw.interpretation.observation_gap_explanation,
            detectedHighlights: raw.interpretation.detected_highlights || [],
            unobservedExpectedHighlights: raw.interpretation.unobserved_expected_highlights || [],
            limitations: raw.interpretation.limitations || [],
            disclaimer: raw.interpretation.disclaimer,
            provider: raw.interpretation.provider,
            isGrounded: raw.interpretation.is_grounded,
          }
        : null,
      scientificDisclaimer: raw.scientific_disclaimer,
    };
  }
}

/**
 * Demo Fixture Fallback Adapter: Supplies pure isolated client-side demonstration fixtures.
 */
export class DemoEcoSonicAdapter implements EcoSonicDataAdapter {
  public readonly name = 'DemoFixtureAdapter (Local Isolated Fixtures)';
  public readonly isDemoMode = true;

  public getDiagnostics(): AdapterDiagnostics {
    const hasAudioContext =
      typeof window !== 'undefined' &&
      ('AudioContext' in window || 'webkitAudioContext' in window);
    const hasMediaDevices =
      typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

    return {
      adapterName: this.name,
      isDemoMode: true,
      protocolVersion: 'Frontend Contract v3.0 (Demo Mode Fallback)',
      datasetId: 'ecosonic-demo-fixtures-v3',
      adapterStatus: 'ready',
      lastSyncIso: null,
      browserAudioApiSupported: hasAudioContext,
      mediaDevicesSupported: hasMediaDevices,
      websocketReadyState: 'not_connected_demo',
    };
  }

  public async fetchDetections(query?: DetectionQueryOptions): Promise<SpeciesDetection[]> {
    return filterAndSortDetections(DEMO_DETECTIONS, query);
  }

  public async fetchSoundscapeSnapshot(presetId: HabitatPresetId): Promise<SoundscapeSnapshot> {
    return DEMO_SOUNDSCAPES[presetId] ?? DEMO_SOUNDSCAPES['temperate-rainforest'];
  }

  public async fetchDisturbances(query?: DisturbanceQueryOptions): Promise<DisturbanceEvent[]> {
    return filterDisturbanceEvents(DEMO_DISTURBANCES, query);
  }

  public async fetchSessions(): Promise<MonitoringSession[]> {
    return [...DEMO_SESSIONS].sort(
      (a, b) => Date.parse(b.startedAtIso) - Date.parse(a.startedAtIso)
    );
  }

  public async fetchSessionById(sessionId: string): Promise<MonitoringSession | null> {
    return DEMO_SESSIONS.find((s) => s.id === sessionId) ?? null;
  }

  public getInitialStreamMetrics(): AcousticStreamMetrics {
    return { ...INITIAL_DEMO_STREAM_METRICS };
  }

  public async fetchObservationGap(sessionId: string): Promise<ObservationGapAnalysis> {
    const nowIso = new Date().toISOString();
    return {
      sessionId,
      context: {
        sessionId,
        latitude: 47.86,
        longitude: -123.93,
        generalizedCoordinates: { latitude: 47.86, longitude: -123.93 },
        locationName: 'Temperate Old-Growth Rainforest (Hoh River Basin)',
        ecosystemCategory: 'temperate-rainforest',
        elevationM: 240,
        timestamp: nowIso,
        observationDate: nowIso.slice(0, 10),
        meteorologicalWeek: 47,
        observationDurationSec: 1800,
        totalAudioWindows: 600,
        acousticComplexityIndex: 184.6,
        normalizedDifferenceSoundscapeIndex: 0.68,
      },
      coverage: {
        metricName: 'Acoustic Observation Coverage',
        expectedSpeciesCount: 8,
        detectedExpectedCount: 5,
        gapCount: 3,
        detectedUnexpectedCount: 1,
        coverageRatio: 0.625,
        coveragePercentage: 62.5,
        observationAdequacy: 'adequate',
        adequacyExplanation:
          'Sampling duration (1800.0s) and multi-channel acoustic energy meet baseline criteria for regional acoustic inventory.',
        disclaimer:
          'Observation gap measures species expected in the regional checklist that were not acoustically detected during this observation interval. Non-detection does not confirm species absence.',
      },
      expectedAndDetected: [
        {
          scientificName: 'Troglodytes pacificus',
          commonName: 'Pacific Wren',
          maxConfidence: 0.94,
          meanConfidence: 0.88,
          detectionCount: 14,
          firstSeenSeconds: 12.0,
          lastSeenSeconds: 1740.0,
          isPersistent: true,
          isExpected: true,
          occurrenceScore: 0.89,
          occurrenceStatus: 'frequent',
        },
        {
          scientificName: 'Ixoreus naevius',
          commonName: 'Varied Thrush',
          maxConfidence: 0.91,
          meanConfidence: 0.82,
          detectionCount: 9,
          firstSeenSeconds: 45.0,
          lastSeenSeconds: 1620.0,
          isPersistent: true,
          isExpected: true,
          occurrenceScore: 0.84,
          occurrenceStatus: 'frequent',
        },
        {
          scientificName: 'Cyanocitta stelleri',
          commonName: "Steller's Jay",
          maxConfidence: 0.87,
          meanConfidence: 0.79,
          detectionCount: 6,
          firstSeenSeconds: 120.0,
          lastSeenSeconds: 1410.0,
          isPersistent: true,
          isExpected: true,
          occurrenceScore: 0.78,
          occurrenceStatus: 'frequent',
        },
        {
          scientificName: 'Poecile rufescens',
          commonName: 'Chestnut-backed Chickadee',
          maxConfidence: 0.83,
          meanConfidence: 0.75,
          detectionCount: 5,
          firstSeenSeconds: 210.0,
          lastSeenSeconds: 1100.0,
          isPersistent: true,
          isExpected: true,
          occurrenceScore: 0.75,
          occurrenceStatus: 'frequent',
        },
        {
          scientificName: 'Colaptes auratus',
          commonName: 'Northern Flicker',
          maxConfidence: 0.76,
          meanConfidence: 0.69,
          detectionCount: 3,
          firstSeenSeconds: 380.0,
          lastSeenSeconds: 950.0,
          isPersistent: true,
          isExpected: true,
          occurrenceScore: 0.62,
          occurrenceStatus: 'expected',
        },
      ],
      expectedButNotDetected: [
        {
          scientificName: 'Dryocopus pileatus',
          commonName: 'Pileated Woodpecker',
          occurrenceScore: 0.72,
          occurrenceStatus: 'frequent',
          birdnetTaxonomyId: 'pilwoo',
          ebirdCode: 'pilwoo',
          notDetected: true,
          evidenceStatus: 'insufficient_evidence_for_absence',
          possibleFactors: [
            'Non-vocal during 30-minute sampling window',
            'Foraging silently on dead standing snags',
            'Acoustic signal attenuation over dense coniferous canopy',
          ],
        },
        {
          scientificName: 'Sphyrapicus ruber',
          commonName: 'Red-breasted Sapsucker',
          occurrenceScore: 0.58,
          occurrenceStatus: 'expected',
          birdnetTaxonomyId: 'rebsap',
          ebirdCode: 'rebsap',
          notDetected: true,
          evidenceStatus: 'insufficient_evidence_for_absence',
          possibleFactors: [
            'Sap-well foraging with infrequent tapping acoustic signatures',
            'Territorial drumming seasonal; suppressed during late autumn',
          ],
        },
        {
          scientificName: 'Glaucidium gnoma',
          commonName: 'Northern Pygmy-Owl',
          occurrenceScore: 0.41,
          occurrenceStatus: 'rare',
          birdnetTaxonomyId: 'nopowl',
          ebirdCode: 'nopowl',
          notDetected: true,
          evidenceStatus: 'insufficient_evidence_for_absence',
          possibleFactors: [
            'Diurnal/crepuscular raptor with sporadic vocal bouts',
            'Cryptic territorial behavior; low calling frequency in rain/mist',
          ],
        },
      ],
      detectedUnexpected: [
        {
          scientificName: 'Catharus guttatus',
          commonName: 'Hermit Thrush',
          maxConfidence: 0.68,
          meanConfidence: 0.61,
          detectionCount: 2,
          firstSeenSeconds: 410.0,
          lastSeenSeconds: 590.0,
          isPersistent: true,
          isExpected: false,
          occurrenceScore: 0.08,
          occurrenceStatus: 'unexpected',
        },
      ],
      interpretation: {
        summary:
          'Acoustic monitoring recorded 5 of 8 regionally expected avian vocalizers (62.5% acoustic observation coverage) in the Hoh River temperate old-growth canopy. One species not listed in regional baseline (Hermit Thrush) was acoustically recorded.',
        observationGapExplanation:
          'The 3 expected species not acoustically detected (Pileated Woodpecker, Red-breasted Sapsucker, Northern Pygmy-Owl) have vocalization patterns characterized by low temporal frequency and targeted territorial calling rather than continuous vocalization. Non-detection during a 30-minute interval provides insufficient evidence for ecological absence.',
        detectedHighlights: [
          'Persistent territorial vocalizations of Pacific Wren across 14 distinct acoustic windows',
          'Characteristic autumn dawn chorus vocalizations of Varied Thrush in the 2.5–4.5 kHz band',
        ],
        unobservedExpectedHighlights: [
          'Pileated Woodpecker (72% regional expectation) was not acoustically detected; typical calling bouts are episodic and wide-ranging',
          'Northern Pygmy-Owl was not detected; high likelihood of silent perched foraging under overcast canopy conditions',
        ],
        limitations: [
          '30-minute single-interval window does not capture crepuscular or nocturnal vocal activity',
          'Acoustic detection range is constrained by dense coniferous foliage attenuation (~60m radius for high-frequency passerine calls)',
          'Non-detection does NOT indicate or confirm species absence in this habitat',
        ],
        disclaimer:
          'Automated ecological analysis based on BirdNET Geo and acoustic persistence. Non-detection does not imply absence.',
        provider: 'deterministic_rule_engine',
        isGrounded: true,
      },
      scientificDisclaimer:
        'Acoustic non-detection indicates only that vocalizations were not recorded above model threshold within the sampling window; it does not constitute scientific evidence of local biological absence.',
    };
  }

  public async fetchExpectedSpeciesBaseline(options?: {
    sessionId?: string;
  }): Promise<ExpectedSpeciesBaseline> {
    const gap = await this.fetchObservationGap(options?.sessionId || 'ses-2026-1121-a');
    return buildExpectedBaselineFromGap(gap, true, 'demo_fixture');
  }
}

function normalizeOccurrenceStatus(
  rawStatus: string | null | undefined,
  score: number
): 'expected' | 'frequent' | 'rare' {
  if (rawStatus === 'frequent' || rawStatus === 'expected' || rawStatus === 'rare') {
    return rawStatus;
  }
  if (score >= 0.2) return 'frequent';
  if (score >= 0.1) return 'expected';
  return 'rare';
}

export function sortExpectedSpeciesDeterministic(
  species: ExpectedSpeciesDto[]
): ExpectedSpeciesDto[] {
  return [...species].sort((a, b) => {
    const scoreDiff = (b.occurrenceScore ?? 0) - (a.occurrenceScore ?? 0);
    if (Math.abs(scoreDiff) > 1e-6) return scoreDiff;
    const nameA = (a.commonName || a.scientificName).toLowerCase();
    const nameB = (b.commonName || b.scientificName).toLowerCase();
    const cmp = nameA.localeCompare(nameB);
    if (cmp !== 0) return cmp;
    return a.scientificName.toLowerCase().localeCompare(b.scientificName.toLowerCase());
  });
}

export function buildExpectedBaselineFromGap(
  gap: ObservationGapAnalysis,
  isDemo: boolean,
  source: ExpectedSpeciesBaseline['source']
): ExpectedSpeciesBaseline {
  const bySci = new Map<string, ExpectedSpeciesDto>();

  for (const det of gap.expectedAndDetected) {
    const key = det.scientificName.trim().toLowerCase();
    if (!key || bySci.has(key)) continue;
    const score = Number(det.occurrenceScore ?? 0);
    bySci.set(key, {
      speciesId: det.speciesId ?? det.birdnetTaxonomyId ?? null,
      scientificName: det.scientificName,
      commonName: det.commonName ?? det.scientificName,
      occurrenceScore: score,
      occurrenceStatus: normalizeOccurrenceStatus(det.occurrenceStatus, score),
      birdnetTaxonomyId: det.birdnetTaxonomyId ?? null,
      ebirdCode: det.ebirdCode ?? null,
    });
  }

  for (const item of gap.expectedButNotDetected) {
    const key = item.scientificName.trim().toLowerCase();
    if (!key || bySci.has(key)) continue;
    bySci.set(key, {
      speciesId: item.speciesId ?? item.birdnetTaxonomyId ?? null,
      scientificName: item.scientificName,
      commonName: item.commonName ?? item.scientificName,
      occurrenceScore: Number(item.occurrenceScore ?? 0),
      occurrenceStatus: normalizeOccurrenceStatus(item.occurrenceStatus, Number(item.occurrenceScore ?? 0)),
      birdnetTaxonomyId: item.birdnetTaxonomyId ?? null,
      ebirdCode: item.ebirdCode ?? null,
    });
  }

  const ordered = sortExpectedSpeciesDeterministic(Array.from(bySci.values()));

  return {
    source,
    isDemo,
    sessionId: gap.sessionId,
    context: {
      locationName: gap.context.locationName || 'Field Acoustic Station',
      ecosystemCategory: gap.context.ecosystemCategory,
      latitude: gap.context.latitude ?? null,
      longitude: gap.context.longitude ?? null,
      generalizedCoordinates: gap.context.generalizedCoordinates ?? null,
      observationDate: gap.context.observationDate,
      meteorologicalWeek: gap.context.meteorologicalWeek,
      observationDurationSec: gap.context.observationDurationSec,
      observationAdequacy: gap.coverage.observationAdequacy,
      adequacyExplanation: gap.coverage.adequacyExplanation,
    },
    expectedSpecies: ordered,
    disclaimer:
      'Expected species reflects the available ecological context and does not imply presence or absence at the observation site.',
    emptyReason: ordered.length === 0 ? gap.coverage.adequacyExplanation : null,
  };
}

/**
 * Creates the appropriate data adapter based on backend connection configuration.
 */
export function createEcoSonicAdapter(config?: BackendConnectionConfig): EcoSonicDataAdapter {
  if (config?.mode === 'backend_ready') {
    return new BackendEcoSonicAdapter(config);
  }
  return new DemoEcoSonicAdapter();
}

export const defaultEcoSonicAdapter: EcoSonicDataAdapter = new BackendEcoSonicAdapter();
