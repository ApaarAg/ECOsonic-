import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { EChartsOption } from 'echarts';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bird,
  Calendar,
  Clock,
  Download,
  FileAudio,
  FileText,
  MapPin,
  Plus,
  Radio,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Waves,
} from 'lucide-react';
import { DetectionDetailDrawer } from '../components/detections/DetectionDetailDrawer';
import { DisturbanceDetailDrawer } from '../components/disturbances/DisturbanceDetailDrawer';
import { EChartBox } from '../components/charts/EChartBox';
import { ObservationGapSection } from '../components/ecology/ObservationGapSection';
import { AppShell } from '../components/layout/AppShell';
import { Button, EmptyState, MetricReadout, SkeletonPanel, SurfacePanel } from '../components/ui/Primitives';
import { useEcoSonic } from '../context/EcoSonicContext';
import {
  formatDurationSeconds,
  formatTimestampDateTime,
} from '../lib/acoustics';
import {
  deleteSessionNote,
  getSessionNotes,
  saveSessionNote,
  type SessionNote,
} from '../lib/sessionNotesStorage';
import {
  exportSessionToCsv,
  exportSessionToJson,
} from '../lib/sessionReportExport';
import type {
  DisturbanceEvent,
  MonitoringSession,
  ObservationGapAnalysis,
  SpeciesDetection,
} from '../types/ecosonic';

export function SessionDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { adapter, detections: allDetections, disturbances: allDisturbances, appearance } = useEcoSonic();

  const [session, setSession] = useState<MonitoringSession | null>(null);
  const [sessionDetections, setSessionDetections] = useState<SpeciesDetection[]>([]);
  const [sessionDisturbances, setSessionDisturbances] = useState<DisturbanceEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Local Field Notes state
  const [notes, setNotes] = useState<SessionNote[]>([]);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [includeNotesInExport, setIncludeNotesInExport] = useState(true);

  // Inspection drawers
  const [inspectedDetection, setInspectedDetection] = useState<SpeciesDetection | null>(null);
  const [inspectedDisturbance, setInspectedDisturbance] = useState<DisturbanceEvent | null>(null);

  // Geospatial Ecological Gap Analysis state
  const [observationGap, setObservationGap] = useState<ObservationGapAnalysis | null>(null);
  const [isLoadingGap, setIsLoadingGap] = useState(false);
  const [gapError, setGapError] = useState<string | null>(null);

  const loadObservationGap = useCallback(
    async (sid: string) => {
      if (!adapter.fetchObservationGap) {
        setObservationGap(null);
        return;
      }
      setIsLoadingGap(true);
      setGapError(null);
      try {
        const gapData = await adapter.fetchObservationGap(sid);
        setObservationGap(gapData);
      } catch (err) {
        console.warn('Failed to load observation gap analysis:', err);
        setGapError(err instanceof Error ? err.message : 'Failed to retrieve ecological gap analysis.');
      } finally {
        setIsLoadingGap(false);
      }
    },
    [adapter]
  );

  // Fetch session via adapter contract
  const loadSession = useCallback(async () => {
    if (!sessionId) {
      setIsLoading(false);
      setFetchError('No session identifier specified in URL.');
      return;
    }
    setIsLoading(true);
    setFetchError(null);
    try {
      const [result, scopedDets, scopedDist] = await Promise.all([
        adapter.fetchSessionById(sessionId),
        adapter.fetchDetections({ sessionId }),
        adapter.fetchDisturbances({ sessionId }),
      ]);
      if (result) {
        setSession(result);
        const resolvedDets = scopedDets.length > 0 ? scopedDets : allDetections.filter((d) => d.sessionId === sessionId);
        const resolvedDist = scopedDist.length > 0 ? scopedDist : allDisturbances.filter((d) => d.sessionId === sessionId);
        setSessionDetections(resolvedDets);
        setSessionDisturbances(resolvedDist);
        setNotes(getSessionNotes(sessionId));
        // Also fetch ecological observation gap analysis
        loadObservationGap(sessionId);
      } else {
        setSession(null);
        setSessionDetections([]);
        setSessionDisturbances([]);
        setObservationGap(null);
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to retrieve session from adapter.');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, adapter, allDetections, allDisturbances, loadObservationGap]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // Unique species count in this session
  const distinctSpeciesCount = useMemo(() => {
    const set = new Set<string>();
    sessionDetections.forEach((d) => set.add(d.scientificName));
    return set.size;
  }, [sessionDetections]);

  // Note actions
  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId || !newNoteContent.trim()) return;
    const added = saveSessionNote(sessionId, newNoteContent);
    if (added) {
      setNotes(getSessionNotes(sessionId));
      setNewNoteContent('');
    }
  };

  const handleSaveEdit = (noteId: string) => {
    if (!sessionId || !editingContent.trim()) return;
    const updated = saveSessionNote(sessionId, editingContent, noteId);
    if (updated) {
      setNotes(getSessionNotes(sessionId));
      setEditingNoteId(null);
      setEditingContent('');
    }
  };

  const handleDeleteNote = (noteId: string) => {
    if (!sessionId) return;
    if (window.confirm('Are you sure you want to delete this local field note?')) {
      deleteSessionNote(sessionId, noteId);
      setNotes(getSessionNotes(sessionId));
    }
  };

  // Export handlers
  const handleExportCsv = () => {
    if (!session) return;
    const csvStr = exportSessionToCsv(session, sessionDetections, sessionDisturbances, notes, {
      includeLocalNotes: includeNotesInExport,
    });
    const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ecosonic-session-${session.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    if (!session) return;
    const jsonStr = exportSessionToJson(session, sessionDetections, sessionDisturbances, notes, {
      includeLocalNotes: includeNotesInExport,
    });
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ecosonic-session-${session.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Temporal Timeline Visualization (ECharts Option)
  const timelineChartOption = useMemo<EChartsOption>(() => {
    if (!session) return {};

    // Combine events along normalized temporal timeline
    const allEvents = [
      ...sessionDetections.map((d) => ({
        time: d.timestampIso,
        label: appearance.showScientificNamesFirst ? d.scientificName : d.commonName,
        type: 'detection' as const,
        score: d.confidenceScore,
      })),
      ...sessionDisturbances.map((ev) => ({
        time: ev.timestampIso,
        label: ev.label,
        type: 'disturbance' as const,
        score: ev.confidenceScore,
      })),
    ].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));

    const timeLabels = allEvents.map((e) =>
      new Date(e.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    );

    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#101C17',
        borderColor: 'rgba(255,255,255,0.1)',
        textStyle: { color: '#F0EBE1', fontSize: 12 },
        formatter: (params: unknown) => {
          const p = (params as Array<{ dataIndex: number }>)[0];
          if (!p) return '';
          const ev = allEvents[p.dataIndex];
          if (!ev) return '';
          return `<div style="font-family: monospace;">
            <strong>${ev.label}</strong><br/>
            Type: ${ev.type === 'detection' ? 'Species Observation' : 'Acoustic Disturbance'}<br/>
            Model Score: ${ev.score.toFixed(2)}<br/>
            Time (UTC): ${formatTimestampDateTime(ev.time)}
          </div>`;
        },
      },
      grid: {
        left: '4%',
        right: '4%',
        top: '15%',
        bottom: '15%',
        containLabel: true,
      },
      xAxis: {
        type: 'category' as const,
        data: timeLabels.length > 0 ? timeLabels : ['No temporal events'],
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
        axisLabel: { color: '#A5AC9C', fontSize: 11, fontFamily: 'monospace' },
      },
      yAxis: {
        type: 'value' as const,
        name: 'Model Score',
        nameTextStyle: { color: '#A5AC9C', fontSize: 11 },
        min: 0,
        max: 1.0,
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
        axisLabel: { color: '#A5AC9C', fontSize: 11, fontFamily: 'monospace' },
      },
      series: [
        {
          name: 'Session Timeline Events',
          type: 'line',
          smooth: true,
          showSymbol: true,
          symbolSize: 8,
          data: allEvents.map((e) => ({
            value: e.score,
            itemStyle: {
              color: e.type === 'detection' ? '#788B68' : '#D3A36C',
            },
          })),
          lineStyle: {
            color: 'rgba(120, 139, 104, 0.4)',
            width: 2,
            type: 'dashed',
          },
        },
      ],
    };
  }, [session, sessionDetections, sessionDisturbances, appearance.showScientificNamesFirst]);

  return (
    <AppShell
      title="Session Intelligence"
      subtitle="Complete bioacoustic session provenance, acoustic summaries, event inspection, and local field notes"
    >
      <div className="space-y-6">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between">
          <Link
            to="/app/sessions"
            className="inline-flex items-center gap-2 text-xs font-medium text-[var(--app-text-muted)] hover:text-[var(--app-text)] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Return to Session History</span>
          </Link>

          {session && (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleExportCsv}
                className="flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5 text-[#788B68]" />
                Export CSV
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleExportJson}
                className="flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5 text-[#788B68]" />
                Export JSON
              </Button>
            </div>
          )}
        </div>

        {/* Loading / Error / Not Found / Detail View */}
        {isLoading ? (
          <SkeletonPanel className="h-96" />
        ) : fetchError ? (
          <SurfacePanel className="p-8 text-center space-y-4">
            <AlertTriangle className="w-8 h-8 text-[#E07A5F] mx-auto" />
            <h2 className="text-lg font-medium text-[var(--app-text)]">Unable to Load Session</h2>
            <p className="text-sm text-[var(--app-text-muted)] max-w-md mx-auto">{fetchError}</p>
            <Button variant="secondary" onClick={loadSession} className="inline-flex items-center gap-2">
              <RotateCcw className="w-4 h-4" />
              <span>Retry</span>
            </Button>
          </SurfacePanel>
        ) : !session ? (
          <EmptyState
            icon={<FileAudio className="w-6 h-6 text-[#D3A36C]" />}
            title={`Session Not Found: ${sessionId}`}
            description="The requested monitoring session identifier is not recorded in the available dataset."
            actionLabel="Back to Session History"
            onAction={() => navigate('/app/sessions')}
          />
        ) : (
          <div className="space-y-6">
            {/* Header / Overview Surface */}
            <SurfacePanel className="p-6">
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 pb-6 border-b border-[var(--app-border)]">
                <div>
                  <div className="flex items-center gap-2 text-xs font-mono text-[#D3A36C] uppercase">
                    <span>{session.id}</span>
                    <span aria-hidden="true">·</span>
                    <span className="capitalize">{session.status}</span>
                    <span aria-hidden="true">·</span>
                    <span>DEMO FIXTURE</span>
                  </div>
                  <h1 className="mt-2 font-serif text-2xl sm:text-3xl font-semibold text-[var(--app-text)]">
                    {session.title}
                  </h1>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--app-text-muted)]">
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-[#788B68]" />
                      {session.siteName}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{session.coordinatesLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span className="flex items-center gap-1 font-mono">
                      <Clock className="w-3.5 h-3.5" />
                      {formatTimestampDateTime(session.startedAtIso)}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Link
                    to={`/app/detections?session=${encodeURIComponent(session.id)}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--app-surface-elevated)] border border-[var(--app-border)] hover:border-[#788B68] text-xs font-medium text-[var(--app-text)] hover:text-[#788B68] transition-colors"
                  >
                    <Bird className="w-3.5 h-3.5 text-[#788B68]" />
                    <span>Detections Log</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                  <Link
                    to={`/app/disturbances?session=${encodeURIComponent(session.id)}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--app-surface-elevated)] border border-[var(--app-border)] hover:border-[#D3A36C] text-xs font-medium text-[var(--app-text)] hover:text-[#D3A36C] transition-colors"
                  >
                    <ShieldAlert className="w-3.5 h-3.5 text-[#D3A36C]" />
                    <span>Disturbance Radar</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>

              {/* Session Core Metrics Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
                <MetricReadout
                  label="Session Duration"
                  value={formatDurationSeconds(session.durationSec)}
                  context="Total continuous recording"
                />
                <MetricReadout
                  label="Species Detections"
                  value={sessionDetections.length}
                  accent="moss"
                  context={`${distinctSpeciesCount} distinct taxa`}
                />
                <MetricReadout
                  label="Disturbances"
                  value={sessionDisturbances.length}
                  accent="amber"
                  context="Anthropogenic/Abiotic events"
                />
                <MetricReadout
                  label="Sample Rate"
                  value={`${(session.sampleRateHz / 1000).toFixed(1)} kHz`}
                  context="Nyquist: 0–24 kHz range"
                />
              </div>

              {/* Field Notes Section from Fixture */}
              <div className="mt-6 p-4 rounded-lg bg-[var(--app-bg)] border border-[var(--app-border)] space-y-1">
                <h3 className="text-xs font-mono uppercase tracking-wider text-[var(--app-text-muted)]">
                  Session Field Provenance
                </h3>
                <p className="text-sm text-[var(--app-text-secondary)] leading-relaxed">
                  {session.notes}
                </p>
              </div>
            </SurfacePanel>

            {/* Soundscape Summary Indices & Timeline Chart */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Soundscape Summary */}
              <SurfacePanel className="lg:col-span-4 p-5 space-y-4">
                <div className="border-b border-[var(--app-border)] pb-3">
                  <h3 className="font-serif text-lg font-semibold text-[var(--app-text)]">
                    Soundscape Indices
                  </h3>
                  <p className="text-xs text-[var(--app-text-muted)]">
                    Mean ecological bioacoustic metrics
                  </p>
                </div>

                <div className="space-y-3 font-mono text-xs">
                  <div className="flex items-center justify-between p-2.5 rounded bg-[var(--app-bg)] border border-[var(--app-border)]">
                    <span className="text-[var(--app-text-muted)]">Acoustic Complexity (ACI)</span>
                    <span className="text-[var(--app-text)] font-semibold">
                      {session.soundscapeSummary.aciMean.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2.5 rounded bg-[var(--app-bg)] border border-[var(--app-border)]">
                    <span className="text-[var(--app-text-muted)]">Biophony Ratio (NDSI)</span>
                    <span className="text-[#788B68] font-semibold">
                      +{session.soundscapeSummary.ndsiMean.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2.5 rounded bg-[var(--app-bg)] border border-[var(--app-border)]">
                    <span className="text-[var(--app-text-muted)]">Spectral Entropy</span>
                    <span className="text-[var(--app-text)] font-semibold">
                      {session.soundscapeSummary.spectralEntropyMean.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2.5 rounded bg-[var(--app-bg)] border border-[var(--app-border)]">
                    <span className="text-[var(--app-text-muted)]">Dominant Acoustic Band</span>
                    <span className="text-[var(--app-text)] font-semibold">
                      {session.soundscapeSummary.dominantBandHz}
                    </span>
                  </div>
                </div>

                <p className="text-[11px] text-[var(--app-text-muted)] leading-relaxed pt-2">
                  Indices measure bioacoustic frequency occupancy and are contextual ecological indicators,
                  not standalone ecosystem health ratings.
                </p>
              </SurfacePanel>

              {/* Temporal Timeline Chart */}
              <SurfacePanel className="lg:col-span-8 p-5 space-y-4">
                <div className="border-b border-[var(--app-border)] pb-3 flex items-center justify-between">
                  <div>
                    <h3 className="font-serif text-lg font-semibold text-[var(--app-text)]">
                      Temporal Event Chronology
                    </h3>
                    <p className="text-xs text-[var(--app-text-muted)]">
                      Chronological observation arrivals & model scores along session duration
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-xs font-mono">
                    <span className="flex items-center gap-1.5 text-[#788B68]">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#788B68]" />
                      Species
                    </span>
                    <span className="flex items-center gap-1.5 text-[#D3A36C]">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#D3A36C]" />
                      Disturbance
                    </span>
                  </div>
                </div>

                <div className="h-64 w-full">
                  <EChartBox
                    option={timelineChartOption}
                    height="100%"
                    ariaLabel="Temporal event chronology chart"
                  />
                </div>
              </SurfacePanel>
            </div>

            {/* Geospatial Ecological Intelligence & Observation Gap Analysis */}
            <ObservationGapSection
              data={observationGap}
              isLoading={isLoadingGap}
              error={gapError}
              onRefresh={session ? () => loadObservationGap(session.id) : undefined}
              showScientificNamesFirst={appearance.showScientificNamesFirst}
            />

            {/* Session Detections & Disturbances Tables */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Session Species Detections */}
              <SurfacePanel className="p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-[var(--app-border)] pb-3">
                  <div className="flex items-center gap-2">
                    <Bird className="w-4 h-4 text-[#788B68]" />
                    <h3 className="font-serif text-lg font-semibold text-[var(--app-text)]">
                      Species Observations ({sessionDetections.length})
                    </h3>
                  </div>
                  <Link
                    to={`/app/detections?session=${encodeURIComponent(session.id)}`}
                    className="text-xs text-[#788B68] hover:underline"
                  >
                    Open in Detections →
                  </Link>
                </div>

                {sessionDetections.length === 0 ? (
                  <p className="text-xs text-[var(--app-text-muted)] py-8 text-center">
                    No species detections recorded for this session.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead>
                        <tr className="border-b border-[var(--app-border)] text-[var(--app-text-muted)]">
                          <th className="py-2 pr-3">Species</th>
                          <th className="py-2 px-3">Time (UTC)</th>
                          <th className="py-2 pl-3 text-right">Score</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--app-border)]">
                        {sessionDetections.map((det, idx) => (
                          <tr
                            key={`${det.id || 'det'}-${idx}`}
                            onClick={() => setInspectedDetection(det)}
                            className="hover:bg-[var(--app-surface-elevated)]/50 cursor-pointer transition-colors"
                          >
                            <td className="py-2.5 pr-3 text-[var(--app-text)] font-sans font-medium">
                              {appearance.showScientificNamesFirst
                                ? det.scientificName
                                : det.commonName}
                              <span className="block text-[11px] text-[var(--app-text-muted)] italic font-sans">
                                {appearance.showScientificNamesFirst
                                  ? det.commonName
                                  : det.scientificName}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 tabular-nums text-[var(--app-text-muted)] whitespace-nowrap">
                              {new Date(det.timestampIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="py-2.5 pl-3 text-right tabular-nums text-[#788B68] font-semibold">
                              {det.confidenceScore.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SurfacePanel>

              {/* Session Disturbance Events */}
              <SurfacePanel className="p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-[var(--app-border)] pb-3">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-[#D3A36C]" />
                    <h3 className="font-serif text-lg font-semibold text-[var(--app-text)]">
                      Disturbance Events ({sessionDisturbances.length})
                    </h3>
                  </div>
                  <Link
                    to={`/app/disturbances?session=${encodeURIComponent(session.id)}`}
                    className="text-xs text-[#D3A36C] hover:underline"
                  >
                    Open in Radar →
                  </Link>
                </div>

                {sessionDisturbances.length === 0 ? (
                  <p className="text-xs text-[var(--app-text-muted)] py-8 text-center">
                    No disturbance events recorded for this session.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead>
                        <tr className="border-b border-[var(--app-border)] text-[var(--app-text-muted)]">
                          <th className="py-2 pr-3">Event Label</th>
                          <th className="py-2 px-3">Severity</th>
                          <th className="py-2 px-3">Peak</th>
                          <th className="py-2 pl-3 text-right">Duration</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--app-border)]">
                        {sessionDisturbances.map((ev, idx) => (
                          <tr
                            key={`${ev.id || 'dist'}-${idx}`}
                            onClick={() => setInspectedDisturbance(ev)}
                            className="hover:bg-[var(--app-surface-elevated)]/50 cursor-pointer transition-colors"
                          >
                            <td className="py-2.5 pr-3 text-[var(--app-text)] font-sans font-medium">
                              {ev.label}
                              <span className="block text-[11px] text-[var(--app-text-muted)] font-mono">
                                {ev.category}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 capitalize text-[var(--app-text-muted)] whitespace-nowrap">
                              {ev.severity}
                            </td>
                            <td className="py-2.5 px-3 tabular-nums text-[#D3A36C]">
                              {ev.peakDbfs.toFixed(1)} dBFS
                            </td>
                            <td className="py-2.5 pl-3 text-right tabular-nums text-[var(--app-text-muted)]">
                              {formatDurationSeconds(ev.durationSec)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SurfacePanel>
            </div>

            {/* Local Researcher Field Notes */}
            <SurfacePanel className="p-6 space-y-4">
              <div className="border-b border-[var(--app-border)] pb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-serif text-xl font-semibold text-[var(--app-text)]">
                    Local Researcher Field Notes
                  </h3>
                  <p className="text-xs text-[var(--app-text-muted)]">
                    Browser-persisted local observations isolated to session {session.id} (not sent to server)
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs text-[var(--app-text-muted)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeNotesInExport}
                    onChange={(e) => setIncludeNotesInExport(e.target.checked)}
                    className="accent-[#788B68]"
                  />
                  <span>Include local notes in reports</span>
                </label>
              </div>

              {/* Add Note Form */}
              <form onSubmit={handleAddNote} className="space-y-3">
                <textarea
                  value={newNoteContent}
                  onChange={(e) => setNewNoteContent(e.target.value)}
                  placeholder="Record local field observation, micro-climate anomaly, or equipment check for this session..."
                  rows={3}
                  className="w-full p-3 text-sm rounded-md bg-[var(--app-bg)] border border-[var(--app-border-strong)] text-[var(--app-text)] placeholder:text-[var(--app-text-muted)]/60 focus:outline-none focus:border-[#788B68]"
                />
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={!newNoteContent.trim()}
                    className="flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Save Note</span>
                  </Button>
                </div>
              </form>

              {/* Notes List */}
              {notes.length === 0 ? (
                <p className="text-xs text-[var(--app-text-muted)] py-4 text-center">
                  No local researcher notes recorded for this session yet.
                </p>
              ) : (
                <div className="space-y-3 pt-2">
                  {notes.map((note) => (
                    <div
                      key={note.id}
                      className="p-4 rounded-lg bg-[var(--app-bg)] border border-[var(--app-border)] space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs text-[var(--app-text-muted)] font-mono">
                        <span>Created {formatTimestampDateTime(note.createdAtIso)}</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingNoteId(note.id);
                              setEditingContent(note.content);
                            }}
                            className="text-[#788B68] hover:underline"
                          >
                            Edit
                          </button>
                          <span aria-hidden="true">·</span>
                          <button
                            type="button"
                            onClick={() => handleDeleteNote(note.id)}
                            className="text-[#E07A5F] hover:underline flex items-center gap-1"
                          >
                            <Trash2 className="w-3 h-3" />
                            Delete
                          </button>
                        </div>
                      </div>

                      {editingNoteId === note.id ? (
                        <div className="space-y-2 pt-1">
                          <textarea
                            value={editingContent}
                            onChange={(e) => setEditingContent(e.target.value)}
                            rows={3}
                            className="w-full p-2 text-sm rounded bg-[var(--app-surface)] border border-[var(--app-border)] text-[var(--app-text)] focus:outline-none focus:border-[#788B68]"
                          />
                          <div className="flex items-center gap-2 justify-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingNoteId(null)}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleSaveEdit(note.id)}
                            >
                              Save Changes
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-[var(--app-text)] leading-relaxed whitespace-pre-wrap">
                          {note.content}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </SurfacePanel>
          </div>
        )}
      </div>

      {/* Reusable Detection Detail Drawer */}
      <DetectionDetailDrawer
        detection={inspectedDetection}
        session={session}
        showScientificNamesFirst={appearance.showScientificNamesFirst}
        onClose={() => setInspectedDetection(null)}
      />

      {/* Reusable Disturbance Detail Drawer */}
      <DisturbanceDetailDrawer
        event={inspectedDisturbance}
        session={session}
        onClose={() => setInspectedDisturbance(null)}
      />
    </AppShell>
  );
}
