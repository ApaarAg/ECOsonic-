import type {
  AnalysisSummaryDto,
  DetectionEvent,
  DisturbanceEvent,
  EcologicalGapSnapshot,
  ExpectedSpeciesBaseline,
  ExpectedSpeciesDto,
  GeospatialContextSummary,
  SoundscapeMetrics,
  SpeciesImageProvenance,
} from "../domain/acousticFieldTypes";
import { acousticStore } from "../domain/acousticStore";

export interface FetchObservationGapOptions {
  apiBaseUrl?: string;
  sessionId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  includeAiInterpretation?: boolean;
}

function resolveApiBaseUrl(explicitBaseUrl?: string): string {
  if (explicitBaseUrl !== undefined) {
    return explicitBaseUrl.replace(/\/$/, "");
  }
  const envUrl = import.meta.env.VITE_ECOSONIC_API_URL as string | undefined;
  return envUrl ? envUrl.replace(/\/$/, "") : "";
}

function normalizeOccurrenceStatus(
  status: string | null | undefined,
  score: number,
): "expected" | "frequent" | "rare" {
  if (status === "frequent") return "frequent";
  if (status === "rare") return "rare";
  if (status === "expected") return "expected";
  if (score >= 0.2) return "frequent";
  if (score >= 0.1) return "expected";
  return "rare";
}

function sortExpectedSpeciesDeterministic(
  species: ExpectedSpeciesDto[],
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
  gap: EcologicalGapSnapshot,
  isDemo = false,
): ExpectedSpeciesBaseline {
  const geo = gap.geospatial_context;
  const referenceUnavailable =
    gap.coverage.observation_adequacy === "location_unspecified" ||
    geo?.reference_status === "unavailable";

  const bySci = new Map<string, ExpectedSpeciesDto>();

  if (!referenceUnavailable) {
    for (const det of gap.expected_and_detected || []) {
      const key = det.scientific_name.trim().toLowerCase();
      if (!key || bySci.has(key)) continue;
      const score = Number(det.occurrence_score ?? 0);
      bySci.set(key, {
        speciesId: det.species_id ?? det.birdnet_taxonomy_id ?? null,
        scientificName: det.scientific_name,
        commonName: det.common_name ?? det.scientific_name,
        occurrenceScore: score,
        occurrenceStatus: normalizeOccurrenceStatus(det.occurrence_status, score),
        birdnetTaxonomyId: det.birdnet_taxonomy_id ?? null,
        ebirdCode: det.ebird_code ?? null,
        image: det.image ?? null,
      });
    }

    for (const item of gap.expected_but_not_detected || []) {
      const key = item.scientific_name.trim().toLowerCase();
      if (!key || bySci.has(key)) continue;
      const score = Number(item.occurrence_score ?? 0);
      bySci.set(key, {
        speciesId: item.species_id ?? item.birdnet_taxonomy_id ?? null,
        scientificName: item.scientific_name,
        commonName: item.common_name ?? item.scientific_name,
        occurrenceScore: score,
        occurrenceStatus: normalizeOccurrenceStatus(item.occurrence_status, score),
        birdnetTaxonomyId: item.birdnet_taxonomy_id ?? null,
        ebirdCode: item.ebird_code ?? null,
        image: item.image ?? null,
      });
    }
  }

  const ordered = sortExpectedSpeciesDeterministic(Array.from(bySci.values()));

  return {
    source: isDemo ? "demo_fixture" : gap.analysisId ? "analysis_record" : "observation_gap",
    isDemo,
    sessionId: gap.session_id,
    analysisId: gap.analysisId ?? null,
    context: {
      locationName:
        geo?.location.location_name ||
        gap.context.location_name ||
        "Field Acoustic Station",
      ecosystemCategory:
        geo?.ecological_context.habitat ||
        gap.context.ecosystem_category ||
        "unspecified",
      latitude: gap.context.latitude ?? null,
      longitude: gap.context.longitude ?? null,
      generalizedCoordinates: gap.context.generalized_coordinates ?? null,
      observationDate: gap.context.observation_date,
      meteorologicalWeek: gap.context.meteorological_week,
      observationDurationSec: gap.context.observation_duration_sec,
      observationAdequacy: gap.coverage.observation_adequacy,
      adequacyExplanation: gap.coverage.adequacy_explanation,
      season: geo?.temporal_context.season ?? null,
      biomeBand: geo?.ecological_context.biome_band ?? null,
      referenceStatus: geo?.reference_status ?? null,
    },
    expectedSpecies: ordered,
    disclaimer:
      gap.scientific_disclaimer ||
      "Expected species reflects the available ecological context and does not imply presence or absence at the observation site.",
    emptyReason: ordered.length === 0 ? gap.coverage.adequacy_explanation : null,
  };
}

/**
 * Fetches deterministic expected-species, observation-gap, and grounded interpretation
 * from ECOBIRDS FastAPI `POST /api/v1/ecology/observation-gap`.
 * Never fabricates ecological checklists or coordinates when the backend is unavailable.
 */
export async function fetchObservationGapFromBackend(
  options: FetchObservationGapOptions = {},
): Promise<EcologicalGapSnapshot | null> {
  const baseUrl = resolveApiBaseUrl(options.apiBaseUrl);
  const snap = acousticStore.getSnapshot();
  const sessionId = options.sessionId ?? snap.session.id;

  if (!baseUrl || !sessionId) {
    acousticStore.setEcologicalStatus("unavailable", "No active backend session ID.");
    return null;
  }

  acousticStore.setEcologicalStatus("loading");

  try {
    const body: Record<string, unknown> = {
      session_id: sessionId,
      include_ai_interpretation: options.includeAiInterpretation ?? true,
    };
    if (
      typeof options.latitude === "number" &&
      typeof options.longitude === "number"
    ) {
      body.latitude = options.latitude;
      body.longitude = options.longitude;
    }

    const res = await fetch(`${baseUrl}/api/v1/ecology/observation-gap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errMsg = await res.text().catch(() => `HTTP ${res.status}`);
      acousticStore.setEcologicalStatus("unavailable", errMsg || `HTTP ${res.status}`);
      return null;
    }

    const raw = (await res.json()) as Omit<EcologicalGapSnapshot, "isDemo">;
    const snapshotPayload: EcologicalGapSnapshot = {
      ...raw,
      isDemo: false,
    };
    acousticStore.setEcologicalContext(snapshotPayload);
    acousticStore.setExpectedBaseline(buildExpectedBaselineFromGap(snapshotPayload, false));
    return snapshotPayload;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ecological service unreachable";
    acousticStore.setEcologicalStatus("unavailable", msg);
    return null;
  }
}

export interface AnalysisStatusSnapshot {
  id: string;
  status: string;
  progress: number;
  current_stage: string | null;
  error_message: string | null;
}

interface RawAnalysisResultsPayload {
  analysis_id: string;
  status: string;
  filename?: string;
  latitude?: number | null;
  longitude?: number | null;
  gps_accuracy_m?: number | null;
  gps_captured_at?: string | null;
  recorded_at?: string | null;
  duration_seconds?: number | null;
  detections?: Array<{
    id: string;
    class_label: string;
    scientific_name?: string | null;
    common_name?: string | null;
    taxon_group?: string | null;
    record_type?: string | null;
    start_seconds: number;
    end_seconds: number;
    confidence_score: number;
  }>;
  species?: {
    species?: Array<{
      scientific_name: string;
      common_name?: string | null;
      image?: SpeciesImageProvenance | null;
    }>;
  } | null;
  disturbance?: {
    anthropogenic_events?: Array<{
      event_id?: string;
      category?: string;
      class_label?: string;
      start_seconds?: number;
      end_seconds?: number;
      confidence_score?: number | null;
    }>;
  } | null;
  context?: {
    recording_context?: Record<string, unknown>;
    acoustic_context?: { soundscape_metrics?: Record<string, number | null> | null };
    temporal_context?: Record<string, unknown>;
  } | null;
  geospatial_context?: GeospatialContextSummary | null;
  expected_species?: {
    status?: string;
    expected_species_status?: string;
    expected_species?: Array<Record<string, unknown>> | null;
    reason?: string | null;
  } | null;
  observation_gap?: {
    status?: string;
    observed?: Array<Record<string, unknown>> | null;
    not_detected?: Array<Record<string, unknown>> | null;
    not_expected?: Array<Record<string, unknown>> | null;
    coverage?: Record<string, unknown>;
    scientific_disclaimer?: string;
  } | null;
  soundscape?: { metrics?: Record<string, number | null> } | null;
  ecological_summary?: Record<string, unknown> | null;
}

function stableVizPos(seed: string): { orbitRad: number; liftRad: number } {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const v = h >>> 0;
  return {
    orbitRad: (v % 6283) / 1000,
    liftRad: ((((v >>> 12) % 1000) / 999) - 0.5) * 0.5,
  };
}

export function getUrlAnalysisId(): string | null {
  if (typeof window === "undefined") return null;
  const id = new URLSearchParams(window.location.search).get("analysis")?.trim();
  return id || null;
}

export function setUrlAnalysisId(analysisId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (analysisId) {
      url.searchParams.set("analysis", analysisId);
    } else {
      url.searchParams.delete("analysis");
    }
    window.history.replaceState({}, "", url.toString());
  } catch {
    // ignore history errors in constrained environments
  }
}

export async function createAudioAnalysis(
  file: File,
  options?: {
    latitude?: number | null;
    longitude?: number | null;
    gpsAccuracyM?: number | null;
    gpsCapturedAt?: string | null;
    recordedAt?: string | null;
    apiBaseUrl?: string;
  },
): Promise<AnalysisSummaryDto> {
  const baseUrl = resolveApiBaseUrl(options?.apiBaseUrl);
  if (!baseUrl) {
    throw new Error("VITE_ECOSONIC_API_URL is not configured.");
  }
  const form = new FormData();
  form.append("file", file);
  if (
    typeof options?.latitude === "number" &&
    Number.isFinite(options.latitude) &&
    typeof options?.longitude === "number" &&
    Number.isFinite(options.longitude)
  ) {
    form.append("latitude", String(options.latitude));
    form.append("longitude", String(options.longitude));
    if (
      typeof options?.gpsAccuracyM === "number" &&
      Number.isFinite(options.gpsAccuracyM) &&
      options.gpsAccuracyM >= 0
    ) {
      form.append("gps_accuracy_m", String(options.gpsAccuracyM));
    }
    if (options?.gpsCapturedAt) {
      form.append("gps_captured_at", options.gpsCapturedAt);
    }
  } else if (options?.latitude != null || options?.longitude != null) {
    throw new Error("Both latitude and longitude must be provided together.");
  }
  if (options?.recordedAt) {
    form.append("recorded_at", options.recordedAt);
  }

  const res = await fetch(`${baseUrl}/api/v1/analyses`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const errJson = (await res.json()) as { detail?: unknown };
      if (typeof errJson?.detail === "string") msg = errJson.detail;
      else if (errJson?.detail) msg = JSON.stringify(errJson.detail);
    } catch {
      // ignore json parse failure
    }
    throw new Error(msg);
  }
  return (await res.json()) as AnalysisSummaryDto;
}

export async function getAnalysisStatus(
  analysisId: string,
  apiBaseUrl?: string,
): Promise<AnalysisStatusSnapshot> {
  const baseUrl = resolveApiBaseUrl(apiBaseUrl);
  const res = await fetch(`${baseUrl}/api/v1/analyses/${encodeURIComponent(analysisId)}/status`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} polling analysis status`);
  }
  return (await res.json()) as AnalysisStatusSnapshot;
}

export async function listAnalyses(
  limit = 12,
  apiBaseUrl?: string,
): Promise<AnalysisSummaryDto[]> {
  const baseUrl = resolveApiBaseUrl(apiBaseUrl);
  if (!baseUrl) return [];
  const res = await fetch(`${baseUrl}/api/v1/analyses?page_size=${limit}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} listing analyses`);
  }
  const payload = (await res.json()) as { items?: AnalysisSummaryDto[] };
  return payload?.items ?? [];
}

function mapAnalysisResultsToStorePayload(detail: RawAnalysisResultsPayload) {
  const summary = (detail.ecological_summary as Record<string, unknown> | null) ?? {};
  const ctx = detail.context ?? (summary.context as RawAnalysisResultsPayload["context"]) ?? null;
  const geo =
    detail.geospatial_context ??
    (summary.geospatial_context as GeospatialContextSummary | null | undefined) ??
    null;
  const expSec =
    detail.expected_species ??
    (summary.expected_species as RawAnalysisResultsPayload["expected_species"]) ??
    null;
  const gap =
    detail.observation_gap ??
    (summary.observation_gap as RawAnalysisResultsPayload["observation_gap"]) ??
    null;
  const dist =
    detail.disturbance ??
    (summary.disturbance as RawAnalysisResultsPayload["disturbance"]) ??
    null;

  const ctxRec = ctx?.recording_context;
  const acMetrics =
    ctx?.acoustic_context?.soundscape_metrics ??
    detail.soundscape?.metrics ??
    null;
  const lat =
    (ctxRec?.latitude as number | null | undefined) ??
    geo?.location.latitude ??
    detail.latitude ??
    null;
  const lon =
    (ctxRec?.longitude as number | null | undefined) ??
    geo?.location.longitude ??
    detail.longitude ??
    null;

  const locName =
    geo?.location.location_name ??
    (ctxRec?.location_name as string | null | undefined) ??
    detail.filename ??
    "Uploaded Analysis";

  const cov = (gap?.coverage ?? {}) as Record<string, unknown>;
  const adequacyRaw = String(cov.observation_adequacy ?? (lat != null && lon != null ? "insufficient_duration" : "location_unspecified"));
  const adequacy = (
    ["adequate", "marginal_duration", "insufficient_duration", "location_unspecified", "zero_detections"].includes(adequacyRaw)
      ? adequacyRaw
      : "location_unspecified"
  ) as EcologicalGapSnapshot["coverage"]["observation_adequacy"];

  const snapshot: EcologicalGapSnapshot = {
    session_id: detail.analysis_id,
    analysisId: detail.analysis_id,
    isDemo: false,
    context: {
      session_id: detail.analysis_id,
      latitude: lat,
      longitude: lon,
      generalized_coordinates:
        geo?.location.generalized ??
        (ctxRec?.generalized_coordinates as { latitude: number | null; longitude: number | null } | null) ??
        null,
      location_name: locName,
      ecosystem_category:
        geo?.ecological_context.habitat ??
        (ctxRec?.ecosystem_category as string | undefined) ??
        "unspecified",
      elevation_m: null,
      timestamp:
        geo?.temporal_context.timestamp ??
        (ctxRec?.recorded_at as string | undefined) ??
        detail.recorded_at ??
        new Date().toISOString(),
      observation_date:
        geo?.temporal_context.observation_date ??
        (ctxRec?.observation_date as string | undefined) ??
        new Date().toISOString().slice(0, 10),
      meteorological_week: Number(
        geo?.temporal_context.meteorological_week ??
          ctxRec?.meteorological_week ??
          1,
      ),
      observation_duration_sec: Number(
        ctxRec?.duration_seconds ?? detail.duration_seconds ?? 0,
      ),
      total_audio_windows: Number(ctx?.temporal_context?.total_3s_windows ?? 0),
      acoustic_complexity_index:
        typeof acMetrics?.aci === "number" ? acMetrics.aci : null,
      normalized_difference_soundscape_index:
        typeof acMetrics?.ndsi === "number" ? acMetrics.ndsi : null,
    },
    geospatial_context: geo,
    coverage: {
      metric_name: "Acoustic Observation Coverage",
      expected_species_count: Number(cov.expected_species_count ?? 0),
      detected_expected_count: Number(cov.detected_expected_count ?? 0),
      detected_unexpected_count: Number(cov.detected_unexpected_count ?? 0),
      gap_count: Number(cov.gap_count ?? 0),
      coverage_ratio: Number(cov.coverage_ratio ?? 0),
      coverage_percentage: Number(cov.coverage_percentage ?? 0),
      observation_adequacy: adequacy,
      adequacy_explanation: String(
        cov.adequacy_explanation ??
          expSec?.reason ??
          "Ecological comparison complete.",
      ),
      disclaimer: String(cov.disclaimer ?? ""),
    },
    expected_and_detected:
      adequacy === "location_unspecified" ||
      gap?.status === "location_unspecified" ||
      gap?.status === "reference_unavailable"
        ? []
        : (((gap?.observed ?? []) as unknown) as EcologicalGapSnapshot["expected_and_detected"]),
    expected_but_not_detected:
      adequacy === "location_unspecified" ||
      gap?.status === "location_unspecified" ||
      gap?.status === "reference_unavailable"
        ? []
        : (((gap?.not_detected ?? []) as unknown) as EcologicalGapSnapshot["expected_but_not_detected"]),
    detected_unexpected:
      adequacy === "location_unspecified" ||
      gap?.status === "location_unspecified" ||
      gap?.status === "reference_unavailable"
        ? (((gap?.observed ?? gap?.not_expected ?? []) as unknown) as EcologicalGapSnapshot["detected_unexpected"])
        : (((gap?.not_expected ?? []) as unknown) as EcologicalGapSnapshot["detected_unexpected"]),
    interpretation: null,
    scientific_disclaimer:
      gap?.scientific_disclaimer ||
      "Acoustic non-detection does NOT establish biological absence.",
  };

  // Preserve full expected species list from expSec if present alongside gap
  let expectedBaseline = buildExpectedBaselineFromGap(snapshot, false);
  if (
    expectedBaseline.expectedSpecies.length === 0 &&
    Array.isArray(expSec?.expected_species) &&
    expSec.expected_species.length > 0
  ) {
    const items: ExpectedSpeciesDto[] = expSec.expected_species.map((s) => ({
      speciesId: (s.species_id as string | null) ?? null,
      scientificName: String(s.scientific_name ?? ""),
      commonName: (s.common_name as string | null) ?? null,
      occurrenceScore: Number(s.occurrence_score ?? 0),
      occurrenceStatus: normalizeOccurrenceStatus(
        s.occurrence_status as string | null,
        Number(s.occurrence_score ?? 0),
      ),
      birdnetTaxonomyId: (s.birdnet_taxonomy_id as string | null) ?? null,
      ebirdCode: (s.ebird_code as string | null) ?? null,
      image: (s.image as SpeciesImageProvenance | null) ?? null,
    }));
    expectedBaseline = {
      ...expectedBaseline,
      expectedSpecies: sortExpectedSpeciesDeterministic(items),
      emptyReason: null,
    };
  }

  const detections: DetectionEvent[] = (detail.detections ?? []).map((d) => ({
    id: d.id,
    eventType: "detection",
    sessionId: detail.analysis_id,
    classLabel: d.class_label,
    speciesCommon: d.common_name || d.class_label,
    speciesScientific: d.scientific_name || d.class_label,
    recordType: d.record_type === "sound_class" ? "sound_class" : "animal",
    taxonGroup: d.taxon_group ?? null,
    eventSemantics: "window_detection",
    modelScore: d.confidence_score,
    startSeconds: d.start_seconds,
    endSeconds: d.end_seconds,
    receivedAtMs: Date.now(),
    visualizationPosition: stableVizPos(d.id || d.class_label),
    isDemo: false,
  }));

  const disturbances: DisturbanceEvent[] = (dist?.anthropogenic_events ?? []).map(
    (ev, idx) => ({
      id: ev.event_id ?? `dist-${detail.analysis_id}-${idx}`,
      sessionId: detail.analysis_id,
      kind: "anthropogenic",
      intensity: Number(ev.confidence_score ?? 0.65),
      modelScore: typeof ev.confidence_score === "number" ? ev.confidence_score : null,
      startSeconds: Number(ev.start_seconds ?? 0),
      endSeconds: Number(ev.end_seconds ?? 3),
      receivedAtMs: Date.now(),
      visualizationPosition: stableVizPos(ev.class_label || String(idx)),
      durationMs: Math.max(1200, ((ev.end_seconds ?? 3) - (ev.start_seconds ?? 0)) * 1000),
      isDemo: false,
    }),
  );

  const soundscapePatch: Partial<SoundscapeMetrics> | null = acMetrics
    ? {
        aci: typeof acMetrics.aci === "number" ? acMetrics.aci : 0,
        biophony: typeof acMetrics.biophony_ratio === "number" ? acMetrics.biophony_ratio : 0.5,
        anthrophony: typeof acMetrics.anthrophony_ratio === "number" ? acMetrics.anthrophony_ratio : 0,
        quietness: typeof acMetrics.quietness_index === "number" ? acMetrics.quietness_index : 0.5,
      }
    : null;

  return {
    analysisId: detail.analysis_id,
    filename: detail.filename ?? "Completed Analysis",
    siteName: `${locName}${detail.filename ? ` · ${detail.filename}` : ""}`,
    detections,
    disturbances,
    soundscape: soundscapePatch,
    ecologicalContext: snapshot,
    expectedBaseline,
    geospatialContext: geo,
    coordinates: {
      latitude: detail.latitude ?? null,
      longitude: detail.longitude ?? null,
      accuracyM: detail.gps_accuracy_m ?? null,
      recordedAt: detail.gps_captured_at ?? detail.recorded_at ?? null,
    },
  };
}

export async function loadAnalysisIntoStore(
  analysisId: string,
  options?: { apiBaseUrl?: string; updateUrl?: boolean },
): Promise<EcologicalGapSnapshot | null> {
  const baseUrl = resolveApiBaseUrl(options?.apiBaseUrl);
  if (!baseUrl || !analysisId) {
    acousticStore.setEcologicalStatus("unavailable", "No backend API URL or analysis ID.");
    return null;
  }

  acousticStore.setEcologicalStatus("loading");
  try {
    const res = await fetch(
      `${baseUrl}/api/v1/analyses/${encodeURIComponent(analysisId)}/results`,
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => `HTTP ${res.status}`);
      acousticStore.setEcologicalStatus("unavailable", txt || `HTTP ${res.status}`);
      return null;
    }
    const detail = (await res.json()) as RawAnalysisResultsPayload;
    const mapped = mapAnalysisResultsToStorePayload(detail);
    acousticStore.hydrateFromAnalysis(mapped);
    if (options?.updateUrl !== false) {
      setUrlAnalysisId(mapped.analysisId);
    }
    return mapped.ecologicalContext;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to retrieve analysis results.";
    acousticStore.setEcologicalStatus("unavailable", msg);
    return null;
  }
}

/**
 * Fetches the preferred persisted completed analysis from `/api/v1/analyses`
 * (preferring geocoded records, then latest completed record).
 */
async function fetchCompletedAnalysisEcologySnapshot(
  baseUrl: string,
): Promise<ReturnType<typeof mapAnalysisResultsToStorePayload> | null> {
  try {
    const listRes = await fetch(
      `${baseUrl}/api/v1/analyses?status=completed&page_size=10`,
    );
    if (!listRes || !listRes.ok) return null;
    const listPayload = (await listRes.json()) as {
      items?: Array<{ id: string; latitude?: number | null; longitude?: number | null }>;
    };
    const items = listPayload?.items ?? [];
    const candidate =
      items.find((a) => a.latitude != null && a.longitude != null) ?? items[0];
    if (!candidate) return null;

    const detailRes = await fetch(
      `${baseUrl}/api/v1/analyses/${encodeURIComponent(candidate.id)}/results`,
    );
    if (!detailRes || !detailRes.ok) return null;
    const detail = (await detailRes.json()) as RawAnalysisResultsPayload;
    return mapAnalysisResultsToStorePayload(detail);
  } catch {
    return null;
  }
}

let inFlightEcologyHydration: Promise<EcologicalGapSnapshot | null> | null = null;

/**
 * Single coordinated resolver for Acts 10, 11, and 12 (deduplicated so concurrent
 * act hooks cannot overwrite or race each other).
 * Resolution order:
 * 1. Explicit URL `?analysis=<id>` or active analysis already selected by user
 * 2. Active/recent live microphone session (`POST /api/v1/ecology/observation-gap`)
 * 3. Persisted completed analyses (`GET /api/v1/analyses?status=completed`)
 * 4. Registered monitoring sites (`GET /api/v1/sites/{id}/geo-context`)
 * 5. Honest `location_unspecified` empty state or explicit `unavailable` error state
 */
export async function hydrateEcologicalContextForActs(
  options: FetchObservationGapOptions = {},
): Promise<EcologicalGapSnapshot | null> {
  const baseUrl = resolveApiBaseUrl(options.apiBaseUrl);
  if (!baseUrl) {
    acousticStore.setEcologicalStatus("unavailable", "VITE_ECOSONIC_API_URL is not configured.");
    acousticStore.setExpectedBaseline(null);
    return null;
  }

  if (inFlightEcologyHydration) {
    return inFlightEcologyHydration;
  }

  inFlightEcologyHydration = (async () => {
    const snap = acousticStore.getSnapshot();
    const explicitUrlAnalysisId = getUrlAnalysisId();
    const preferredAnalysisId = explicitUrlAnalysisId ?? snap.activeAnalysisId;

    // 1. User-selected or URL-pinned analysis
    if (preferredAnalysisId && !options.sessionId) {
      const loaded = await loadAnalysisIntoStore(preferredAnalysisId, {
        apiBaseUrl: baseUrl,
        updateUrl: Boolean(explicitUrlAnalysisId),
      });
      if (loaded) return loaded;
    }

    // 2. Active live session
    const activeLiveSessionId =
      options.sessionId ??
      (snap.session.connection === "live" ? snap.session.id : null);
    if (activeLiveSessionId) {
      const gap = await fetchObservationGapFromBackend({
        apiBaseUrl: baseUrl,
        sessionId: activeLiveSessionId,
        latitude: options.latitude ?? snap.coordinates.latitude,
        longitude: options.longitude ?? snap.coordinates.longitude,
        includeAiInterpretation: options.includeAiInterpretation ?? true,
      });
      if (gap) return gap;
    }

    // 3. Completed persisted analyses (preferring geocoded completed analyses)
    acousticStore.setEcologicalStatus("loading");
    const completed = await fetchCompletedAnalysisEcologySnapshot(baseUrl);
    if (completed) {
      acousticStore.hydrateFromAnalysis(completed);
      return completed.ecologicalContext;
    }

    // 4. Geocoded live sessions (only if no completed analysis exists yet)
    try {
      const sessionsRes = await fetch(`${baseUrl}/api/v1/live/sessions?limit=5`);
      if (sessionsRes.ok) {
        const list = (await sessionsRes.json()) as Array<{
          id: string;
          latitude?: number | null;
          longitude?: number | null;
        }>;
        const geocoded = list.find((s) => s.latitude != null && s.longitude != null);
        if (geocoded) {
          const gap = await fetchObservationGapFromBackend({
            apiBaseUrl: baseUrl,
            sessionId: geocoded.id,
            latitude: options.latitude,
            longitude: options.longitude,
            includeAiInterpretation: options.includeAiInterpretation ?? true,
          });
          if (gap) return gap;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ecological service unreachable";
      acousticStore.setEcologicalStatus("unavailable", msg);
      return null;
    }

    // 5. Fallback to registered site baseline (Act 11) cleanly
    try {
      const sitesRes = await fetch(`${baseUrl}/api/v1/sites?page_size=10`);
      if (sitesRes.ok) {
        const sitesPayload = (await sitesRes.json()) as
          | Array<{ id: string; name?: string; ecosystem_category?: string; latitude?: number | null; longitude?: number | null }>
          | { items?: Array<{ id: string; name?: string; ecosystem_category?: string; latitude?: number | null; longitude?: number | null }> };
        const items = Array.isArray(sitesPayload) ? sitesPayload : sitesPayload.items || [];
        const geocodedSite = items.find((s) => s.latitude != null && s.longitude != null);
        if (geocodedSite) {
          await fetchExpectedSpeciesForScene11({ apiBaseUrl: baseUrl });
          return acousticStore.getSnapshot().ecologicalContext;
        }
      }
    } catch {
      // handled below
    }

    acousticStore.setEcologicalStatus("ready");
    acousticStore.setExpectedBaseline({
      source: "observation_gap",
      isDemo: false,
      sessionId: null,
      siteId: null,
      context: {
        locationName: "No Geocoded Observation Site",
        ecosystemCategory: "unspecified",
        observationAdequacy: "location_unspecified",
        adequacyExplanation:
          "Upload or record audio with latitude & longitude coordinates in Analyze to compute regional expected species and observation gaps.",
      },
      expectedSpecies: [],
      disclaimer:
        "Expected species reflects the available ecological context and does not imply presence or absence at the observation site.",
      emptyReason:
        "No completed audio analysis or geocoded session was found. Use Analyze / History to upload a recording with optional coordinates.",
    });
    return null;
  })().finally(() => {
    inFlightEcologyHydration = null;
  });

  return inFlightEcologyHydration;
}

/**
 * Resolves authoritative expected species for Scene 11 without fabricating offline species.
 * Resolution order:
 * 1. Existing active/fetched EcologicalGapSnapshot (when non-empty or geocoded)
 * 2. Active session or latest stored backend session (`GET /api/v1/live/sessions`) -> `POST /api/v1/ecology/observation-gap`
 * 3. Registered monitoring site (`GET /api/v1/sites`) -> `GET /api/v1/sites/{id}/geo-context`
 * 4. Honest `location_unspecified` empty state if backend is reachable with no geocoded session/site,
 *    or explicit `unavailable` error state if backend cannot be reached or returns 503.
 */
export async function fetchExpectedSpeciesForScene11(
  options: FetchObservationGapOptions = {},
): Promise<ExpectedSpeciesBaseline | null> {
  const baseUrl = resolveApiBaseUrl(options.apiBaseUrl);
  const snap = acousticStore.getSnapshot();

  if (snap.ecologicalContext) {
    const fromExisting = buildExpectedBaselineFromGap(snap.ecologicalContext, snap.ecologicalContext.isDemo);
    if (fromExisting.expectedSpecies.length > 0) {
      acousticStore.setExpectedBaseline(fromExisting);
      return fromExisting;
    }
  }

  if (!baseUrl) {
    acousticStore.setEcologicalStatus("unavailable", "VITE_ECOSONIC_API_URL is not configured.");
    acousticStore.setExpectedBaseline(null);
    return null;
  }

  acousticStore.setEcologicalStatus("loading");

  try {
    let targetSessionId = options.sessionId ?? snap.session.id;

    if (!targetSessionId) {
      const sessionsRes = await fetch(`${baseUrl}/api/v1/live/sessions?limit=5`);
      if (sessionsRes.ok) {
        const list = (await sessionsRes.json()) as Array<{
          id: string;
          latitude?: number | null;
          longitude?: number | null;
        }>;
        const geocoded = list.find((s) => s.latitude != null && s.longitude != null);
        targetSessionId = geocoded?.id ?? list[0]?.id ?? null;
      } else {
        throw new Error(`HTTP ${sessionsRes.status} retrieving live sessions`);
      }
    }

    let gapBaseline: ExpectedSpeciesBaseline | null = null;
    if (targetSessionId) {
      const gap = await fetchObservationGapFromBackend({
        apiBaseUrl: baseUrl,
        sessionId: targetSessionId,
        latitude: options.latitude,
        longitude: options.longitude,
        includeAiInterpretation: false,
      });
      if (gap) {
        gapBaseline = buildExpectedBaselineFromGap(gap, false);
        if (gapBaseline.expectedSpecies.length > 0) {
          acousticStore.setExpectedBaseline(gapBaseline);
          return gapBaseline;
        }
      } else {
        // Explicit backend error (e.g. 503 ECOLOGICAL_DATA_UNAVAILABLE) already set on store
        return null;
      }
    }

    // Check registered monitoring sites for regional baseline when session lacked coordinates
    const sitesRes = await fetch(`${baseUrl}/api/v1/sites?page_size=10`);
    if (sitesRes.ok) {
      const sitesPayload = (await sitesRes.json()) as
        | Array<{ id: string; name?: string; ecosystem_category?: string; latitude?: number | null; longitude?: number | null }>
        | { items?: Array<{ id: string; name?: string; ecosystem_category?: string; latitude?: number | null; longitude?: number | null }> };
      const items = Array.isArray(sitesPayload) ? sitesPayload : sitesPayload.items || [];
      const geocodedSite =
        items.find((s) => s.latitude != null && s.longitude != null) ?? items[0] ?? null;

      if (geocodedSite) {
        const geoRes = await fetch(
          `${baseUrl}/api/v1/sites/${encodeURIComponent(geocodedSite.id)}/geo-context?top_k=40`,
        );
        if (!geoRes.ok) {
          const txt = await geoRes.text().catch(() => `HTTP ${geoRes.status}`);
          acousticStore.setEcologicalStatus("unavailable", txt || `HTTP ${geoRes.status}`);
          acousticStore.setExpectedBaseline(null);
          return null;
        }
        const geoCtx = (await geoRes.json()) as {
          site_id?: string | null;
          site_name?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          week?: number | null;
          recording_date?: string | null;
          disclaimer?: string;
          top_regional_species?: Array<{
            species_id?: string | null;
            scientific_name: string;
            common_name?: string | null;
            geo_score?: number;
            occurrence_status?: string;
            birdnet_taxonomy_id?: string | null;
            species_code?: string | null;
          }>;
        };

        const mapped: ExpectedSpeciesDto[] = (geoCtx.top_regional_species || [])
          .filter(
            (s) =>
              s.occurrence_status !== "unexpected" &&
              s.occurrence_status !== "location_unspecified",
          )
          .map((s) => ({
            speciesId: s.species_id ?? s.birdnet_taxonomy_id ?? null,
            scientificName: s.scientific_name,
            commonName: s.common_name ?? s.scientific_name,
            occurrenceScore: Number(s.geo_score ?? 0),
            occurrenceStatus: normalizeOccurrenceStatus(
              s.occurrence_status,
              Number(s.geo_score ?? 0),
            ),
            birdnetTaxonomyId: s.birdnet_taxonomy_id ?? null,
            ebirdCode: s.species_code ?? null,
          }));

        const siteBaseline: ExpectedSpeciesBaseline = {
          source: "sites_geo_context",
          isDemo: false,
          siteId: geoCtx.site_id ?? geocodedSite.id,
          context: {
            locationName: geoCtx.site_name || geocodedSite.name || "Registered Field Station",
            ecosystemCategory: geocodedSite.ecosystem_category || "unspecified",
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
            "Expected species reflects the available ecological context and does not imply presence or absence at the observation site.",
          emptyReason:
            mapped.length === 0
              ? "No regional expected species met threshold criteria for these coordinates and season."
              : null,
        };
        acousticStore.setEcologicalStatus("ready");
        acousticStore.setExpectedBaseline(siteBaseline);
        return siteBaseline;
      }
    }

    if (gapBaseline) {
      acousticStore.setEcologicalStatus("ready");
      acousticStore.setExpectedBaseline(gapBaseline);
      return gapBaseline;
    }

    const analysisSnapshot = await fetchCompletedAnalysisEcologySnapshot(baseUrl);
    if (analysisSnapshot) {
      acousticStore.hydrateFromAnalysis(analysisSnapshot);
      return analysisSnapshot.expectedBaseline;
    }

    const emptyBaseline: ExpectedSpeciesBaseline = {
      source: "observation_gap",
      isDemo: false,
      sessionId: targetSessionId ?? null,
      siteId: null,
      context: {
        locationName: "No Geocoded Observation Site",
        ecosystemCategory: "unspecified",
        observationAdequacy: "location_unspecified",
        adequacyExplanation:
          "No active geocoded session or registered monitoring site found in backend storage.",
      },
      expectedSpecies: [],
      disclaimer:
        "Expected species reflects the available ecological context and does not imply presence or absence at the observation site.",
      emptyReason:
        "No monitoring site or geocoded session coordinates are currently stored. Register a site with coordinates or launch a geocoded session to assemble the BirdNET Geo V3.0 checklist.",
    };
    acousticStore.setEcologicalStatus("ready");
    acousticStore.setExpectedBaseline(emptyBaseline);
    return emptyBaseline;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ecological service unreachable";
    acousticStore.setEcologicalStatus("unavailable", msg);
    acousticStore.setExpectedBaseline(null);
    return null;
  }
}

/** Explicit labeled sample observation for user-initiated inspection ONLY (never auto-loaded). */
export function buildExplicitDemoBaseline(): ExpectedSpeciesBaseline {
  return {
    source: "demo_fixture",
    isDemo: true,
    sessionId: "demo-hoh-rainforest",
    siteId: "demo-site-hoh",
    context: {
      locationName: "Hoh River Temperate Canopy",
      ecosystemCategory: "temperate-rainforest",
      latitude: 47.86,
      longitude: -123.93,
      generalizedCoordinates: { latitude: 47.86, longitude: -123.93 },
      observationDate: "2026-05-15",
      meteorologicalWeek: 19,
      observationDurationSec: 600,
      observationAdequacy: "adequate",
      adequacyExplanation:
        "Explicitly requested demonstration baseline for coastal old-growth temperate rainforest.",
    },
    expectedSpecies: [
      {
        speciesId: "BN04821",
        scientificName: "Troglodytes pacificus",
        commonName: "Pacific Wren",
        occurrenceScore: 0.91,
        occurrenceStatus: "frequent",
        birdnetTaxonomyId: "BN04821",
        ebirdCode: "pacwre1",
      },
      {
        speciesId: "BN05104",
        scientificName: "Ixoreus naevius",
        commonName: "Varied Thrush",
        occurrenceScore: 0.86,
        occurrenceStatus: "frequent",
        birdnetTaxonomyId: "BN05104",
        ebirdCode: "varthr",
      },
      {
        speciesId: "BN03112",
        scientificName: "Cyanocitta stelleri",
        commonName: "Steller's Jay",
        occurrenceScore: 0.78,
        occurrenceStatus: "frequent",
        birdnetTaxonomyId: "BN03112",
        ebirdCode: "stejay",
      },
      {
        speciesId: "BN04409",
        scientificName: "Poecile rufescens",
        commonName: "Chestnut-backed Chickadee",
        occurrenceScore: 0.72,
        occurrenceStatus: "frequent",
        birdnetTaxonomyId: "BN04409",
        ebirdCode: "chbchi",
      },
      {
        speciesId: "BN02218",
        scientificName: "Dryocopus pileatus",
        commonName: "Pileated Woodpecker",
        occurrenceScore: 0.54,
        occurrenceStatus: "expected",
        birdnetTaxonomyId: "BN02218",
        ebirdCode: "pilwoo",
      },
      {
        speciesId: "BN02190",
        scientificName: "Sphyrapicus ruber",
        commonName: "Red-breasted Sapsucker",
        occurrenceScore: 0.42,
        occurrenceStatus: "expected",
        birdnetTaxonomyId: "BN02190",
        ebirdCode: "rebsap",
      },
      {
        speciesId: "BN05012",
        scientificName: "Regulus satrapa",
        commonName: "Golden-crowned Kinglet",
        occurrenceScore: 0.65,
        occurrenceStatus: "frequent",
        birdnetTaxonomyId: "BN05012",
        ebirdCode: "gockin",
      },
      {
        speciesId: "BN01894",
        scientificName: "Glaucidium gnoma",
        commonName: "Northern Pygmy-Owl",
        occurrenceScore: 0.09,
        occurrenceStatus: "rare",
        birdnetTaxonomyId: "BN01894",
        ebirdCode: "nopowl",
      },
    ],
    disclaimer:
      "DEMO OBSERVATION · Illustrative field archive only. Acoustic non-detection does not confirm biological absence.",
    emptyReason: null,
  };
}

/**
 * Resolves authoritative observation-gap evidence for Scene 12 without fabricating offline records.
 */
export async function fetchObservationGapForScene12(
  options: FetchObservationGapOptions = {},
): Promise<EcologicalGapSnapshot | null> {
  const snap = acousticStore.getSnapshot();
  if (snap.ecologicalContext && !options.sessionId) {
    return snap.ecologicalContext;
  }
  return await hydrateEcologicalContextForActs(options);
}

/** Explicit labeled sample observation-gap snapshot for user-initiated inspection ONLY (never auto-loaded). */
export function buildExplicitDemoObservationGap(): EcologicalGapSnapshot {
  return {
    session_id: "demo-hoh-rainforest",
    isDemo: true,
    context: {
      session_id: "demo-hoh-rainforest",
      latitude: 47.86,
      longitude: -123.93,
      generalized_coordinates: { latitude: 47.86, longitude: -123.93 },
      location_name: "Hoh River Temperate Canopy",
      ecosystem_category: "temperate-rainforest",
      elevation_m: 140,
      timestamp: "2026-05-15T06:15:00Z",
      observation_date: "2026-05-15",
      meteorological_week: 19,
      observation_duration_sec: 180,
      total_audio_windows: 60,
      acoustic_complexity_index: 14.2,
      normalized_difference_soundscape_index: 0.74,
    },
    coverage: {
      metric_name: "Acoustic Observation Coverage",
      expected_species_count: 4,
      detected_expected_count: 2,
      detected_unexpected_count: 1,
      gap_count: 2,
      coverage_ratio: 0.5,
      coverage_percentage: 50,
      observation_adequacy: "marginal_duration",
      adequacy_explanation:
        "180-second morning sample provides initial biophonic evidence; quieter canopy strata remain undersampled.",
      disclaimer:
        "DEMO OBSERVATION · Acoustic non-detection does NOT establish biological absence.",
    },
    expected_and_detected: [
      {
        species_id: "BN04821",
        scientific_name: "Troglodytes pacificus",
        common_name: "Pacific Wren",
        birdnet_taxonomy_id: "BN04821",
        ebird_code: "pacwre1",
        max_confidence: 0.92,
        mean_confidence: 0.87,
        detection_count: 6,
        first_seen_seconds: 12,
        last_seen_seconds: 147,
        is_persistent: true,
        is_expected: true,
        occurrence_score: 0.91,
        occurrence_status: "frequent",
      },
      {
        species_id: "BN04409",
        scientific_name: "Poecile rufescens",
        common_name: "Chestnut-backed Chickadee",
        birdnet_taxonomy_id: "BN04409",
        ebird_code: "chbchi",
        max_confidence: 0.84,
        mean_confidence: 0.79,
        detection_count: 3,
        first_seen_seconds: 42,
        last_seen_seconds: 111,
        is_persistent: false,
        is_expected: true,
        occurrence_score: 0.72,
        occurrence_status: "frequent",
      },
    ],
    expected_but_not_detected: [
      {
        species_id: "BN05104",
        scientific_name: "Ixoreus naevius",
        common_name: "Varied Thrush",
        occurrence_score: 0.86,
        occurrence_status: "frequent",
        birdnet_taxonomy_id: "BN05104",
        ebird_code: "varthr",
        not_detected: true,
        evidence_status: "insufficient_evidence_for_absence",
        possible_factors: [
          "Vocal inactivity during the 180-second recording window",
          "Distance attenuation across dense old-growth conifer canopy",
        ],
      },
      {
        species_id: "BN02218",
        scientific_name: "Dryocopus pileatus",
        common_name: "Pileated Woodpecker",
        occurrence_score: 0.54,
        occurrence_status: "expected",
        birdnet_taxonomy_id: "BN02218",
        ebird_code: "pilwoo",
        not_detected: true,
        evidence_status: "insufficient_evidence_for_absence",
        possible_factors: [
          "Wide foraging territory outside sensor acoustic horizon",
          "Short observation window relative to territorial drumming cadence",
        ],
      },
    ],
    detected_unexpected: [
      {
        species_id: "BN04910",
        scientific_name: "Empidonax difficilis",
        common_name: "Pacific-slope Flycatcher",
        birdnet_taxonomy_id: "BN04910",
        ebird_code: "pasfly",
        max_confidence: 0.78,
        mean_confidence: 0.74,
        detection_count: 2,
        first_seen_seconds: 81,
        last_seen_seconds: 126,
        is_persistent: false,
        is_expected: false,
        occurrence_score: 0.04,
        occurrence_status: "unexpected",
      },
    ],
    interpretation: {
      summary:
        "Two expected canopy species were acoustically confirmed alongside one seasonal arrival outside the primary regional threshold.",
      observation_gap_explanation:
        "Two expected taxa were not detected in this 180s sample; non-detection reflects vocal or spatial sampling limits rather than habitat absence.",
      detected_highlights: ["Pacific Wren (persistent)", "Chestnut-backed Chickadee"],
      unobserved_expected_highlights: ["Varied Thrush", "Pileated Woodpecker"],
      limitations: ["Marginal 180-second acoustic sample window"],
      disclaimer:
        "DEMO OBSERVATION · Grounded summary of sample telemetry only.",
      provider: "deterministic_rule_engine",
      is_grounded: true,
    },
    scientific_disclaimer:
      "DEMO OBSERVATION · Illustrative observation-gap record only. Acoustic non-detection does NOT establish biological absence.",
  };
}
