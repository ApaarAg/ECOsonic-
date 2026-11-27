import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ChevronRight,
  Mic,
  MicOff,
  Pause,
  Play,
  Radio,
  RotateCcw,
} from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { AcousticField } from '../components/observatory/AcousticField';
import { AcousticVisualizer } from '../components/observatory/AcousticVisualizer';
import { HabitatPresetTabs } from '../components/observatory/HabitatPresetTabs';
import {
  type InspectedObservatoryItem,
  ObservatoryEventDrawer,
} from '../components/observatory/ObservatoryEventDrawer';
import {
  Button,
  EmptyState,
  MetricReadout,
  SkeletonPanel,
  SurfacePanel,
} from '../components/ui/Primitives';
import { useEcoSonic } from '../context/EcoSonicContext';
import { DEMO_HABITAT_PRESETS } from '../data/demoFixtures';
import { useLocalMicPreview } from '../hooks/useLocalMicPreview';
import {
  formatDurationSeconds,
  formatTimestampTime,
  getDisturbanceCategoryLabel,
} from '../lib/acoustics';
import {
  clampInputGainDb,
  DEFAULT_INPUT_GAIN_DB,
  filterRecentDetections,
  formatGainDb,
  getDisturbancesForSession,
  MAX_INPUT_GAIN_DB,
  MIN_INPUT_GAIN_DB,
  resolveSessionForPreset,
} from '../lib/observatory';

export function ObservatoryPage() {
  const {
    adapter,
    isDemoMode,
    monitoringStatus,
    activePreset,
    elapsedSec,
    streamMetrics,
    detections,
    disturbances,
    sessions,
    soundscape,
    isLoading,
    error,
    appearance,
    audioPrefs,
    liveSessionId,
    liveStreamStatus,
    liveStreamError,
    setActivePreset,
    toggleMonitoringStream,
    startLiveSession,
    stopLiveSession,
    resetDemoSession,
  } = useEcoSonic();

  const [localGainDb, setLocalGainDb] = useState<number>(DEFAULT_INPUT_GAIN_DB);
  const [inspectedItem, setInspectedItem] = useState<InspectedObservatoryItem | null>(null);

  const micPreview = useLocalMicPreview(audioPrefs, localGainDb);
  const isMicActive = micPreview.status === 'active';

  const activeSession = useMemo(
    () => resolveSessionForPreset(activePreset, sessions, detections, DEMO_HABITAT_PRESETS),
    [activePreset, detections, sessions]
  );

  const presetDetections = useMemo(
    () => filterRecentDetections(detections, activePreset, audioPrefs.minConfidenceThreshold, 5),
    [detections, activePreset, audioPrefs.minConfidenceThreshold]
  );

  const recentDisturbances = useMemo(
    () => getDisturbancesForSession(disturbances, activeSession?.id ?? null, 4),
    [disturbances, activeSession?.id]
  );

  const displayPeakHz = isMicActive
    ? micPreview.liveTelemetry.peakFrequencyHz
    : streamMetrics.peakFrequencyHz;
  const displayRmsDbfs = isMicActive
    ? micPreview.liveTelemetry.rmsLevelDbfs
    : streamMetrics.rmsLevelDbfs;

  const formattedSampleRateKhz = (audioPrefs.sampleRateHz / 1000).toFixed(1);
  const controlsDisabled = isLoading || Boolean(error);

  const handleToggleMicPreview = () => {
    if (isMicActive || micPreview.status === 'starting') {
      micPreview.stopPreview();
    } else {
      void micPreview.startPreview();
    }
  };

  return (
    <AppShell
      title="Live Observatory"
      subtitle="Acoustic stream monitor, spectral envelope, and real-time demonstration fixture telemetry"
      instrumentMode={true}
    >
      <div className="space-y-6">
        {/* Mode Notice, Preset Tabs & Stream Controls */}
        <SurfacePanel className="p-5 space-y-4">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-5">
            <div className="space-y-2 min-w-0">
              <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-x-2.5 gap-y-0.5 text-xs">
                <span className="font-mono font-medium text-[var(--app-amber)] shrink-0">
                  {isMicActive
                    ? 'BROWSER-LOCAL MIC PREVIEW · VISUALIZATION ONLY'
                    : !isDemoMode
                      ? liveStreamStatus === 'streaming'
                        ? 'LIVE BACKEND · STREAMING 32 kHz PCM16'
                        : liveStreamStatus === 'reconnecting'
                          ? 'LIVE BACKEND · RECONNECTING…'
                          : liveStreamStatus === 'starting'
                            ? 'LIVE BACKEND · ACQUIRING MICROPHONE…'
                            : 'LIVE BACKEND · CONNECTED'
                      : 'DEMO MODE · ISOLATED FIXTURE STREAM'}
                </span>
                <span className="text-[var(--app-text-muted)]">
                  {isMicActive
                    ? 'Audio stays local in Web Audio API; BirdNET inference and backend streaming are not active'
                    : !isDemoMode
                      ? liveStreamStatus === 'streaming'
                        ? `Live audio streamed to session ${liveSessionId?.slice(0, 8)} with real BirdNET+ inference`
                        : liveStreamStatus === 'reconnecting'
                          ? 'Connection to backend lost; automatic reconnect active'
                          : 'Ready to acquire microphone and stream 32 kHz PCM16 to backend'
                      : 'Demo fixture stream active; switch to Live Backend in Settings to connect to FastAPI'}
                </span>
              </div>

              <HabitatPresetTabs
                presets={DEMO_HABITAT_PRESETS}
                activePreset={activePreset}
                onSelectPreset={setActivePreset}
                ariaLabel="Select demonstration habitat station"
                disabled={isLoading}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <div
                data-testid="observatory-input-badge"
                className="flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--app-bg)] border border-[var(--app-border)] text-xs"
              >
                {isMicActive ? (
                  <Radio className="w-3.5 h-3.5 text-[var(--app-accent)] shrink-0" />
                ) : monitoringStatus === 'streaming' ? (
                  <Mic className="w-3.5 h-3.5 text-[var(--app-accent)] shrink-0" />
                ) : (
                  <MicOff className="w-3.5 h-3.5 text-[var(--app-amber)] shrink-0" />
                )}
                <span className="text-[var(--app-text-secondary)] font-mono">
                  {isMicActive
                    ? `Local Mic (${formattedSampleRateKhz} kHz / ${audioPrefs.fftSize} FFT)`
                    : !isDemoMode
                      ? `FastAPI 32 kHz (${formattedSampleRateKhz} kHz / ${audioPrefs.fftSize} FFT)`
                      : `Demo Fixture (${formattedSampleRateKhz} kHz / ${audioPrefs.fftSize} FFT)`}
                </span>
              </div>

              {!isDemoMode ? (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={controlsDisabled || liveStreamStatus === 'starting'}
                  onClick={liveStreamStatus === 'streaming' ? stopLiveSession : () => void startLiveSession()}
                  aria-label={liveStreamStatus === 'streaming' ? 'Stop live stream' : 'Start live stream'}
                >
                  {liveStreamStatus === 'streaming' ? (
                    <>
                      <Pause className="w-3.5 h-3.5" />
                      <span>Stop Live Stream</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" />
                      <span>{liveStreamStatus === 'starting' ? 'Connecting…' : 'Start Live Stream'}</span>
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={controlsDisabled}
                  onClick={toggleMonitoringStream}
                  aria-label={
                    monitoringStatus === 'streaming' ? 'Pause stream' : 'Resume stream'
                  }
                >
                  {monitoringStatus === 'streaming' ? (
                    <>
                      <Pause className="w-3.5 h-3.5" />
                      <span>Pause Stream</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" />
                      <span>Resume Stream</span>
                    </>
                  )}
                </Button>
              )}

              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={controlsDisabled}
                onClick={resetDemoSession}
                aria-label="Reset session timer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Timer</span>
              </Button>
            </div>
          </div>

          {/* Browser-Local Gain & Optional Microphone Preview Strip */}
          <div className="pt-4 border-t border-[var(--app-border)] grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
            <div className="lg:col-span-6 space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-xs">
                <label
                  htmlFor="observatory-local-gain"
                  className="font-medium text-[var(--app-text-secondary)]"
                >
                  Browser-Local Input Gain{' '}
                  <span className="text-[var(--app-text-muted)] font-normal">
                    (applies to local mic chain only)
                  </span>
                </label>
                <span
                  data-testid="observatory-gain-readout"
                  className="font-mono tabular-nums text-[var(--app-text)] shrink-0"
                >
                  {formatGainDb(localGainDb)}
                </span>
              </div>
              <input
                id="observatory-local-gain"
                type="range"
                min={MIN_INPUT_GAIN_DB}
                max={MAX_INPUT_GAIN_DB}
                step={0.5}
                value={localGainDb}
                onChange={(e) => setLocalGainDb(clampInputGainDb(Number(e.target.value)))}
                className="w-full accent-[#788B68] cursor-pointer min-h-[28px]"
              />
            </div>

            <div className="lg:col-span-6 flex flex-col sm:flex-row sm:items-center justify-end gap-3">
              {isMicActive && (
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-mono text-[var(--app-text-muted)]">
                    <span className="truncate">
                      {micPreview.activeDeviceLabel ?? 'Local Microphone'}
                    </span>
                    <span className="tabular-nums shrink-0 ml-2">
                      {micPreview.liveTelemetry.activityPct}%
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label="Local microphone preview signal level"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={micPreview.liveTelemetry.activityPct}
                    className="h-1.5 w-full rounded-full bg-[var(--app-bg)] overflow-hidden"
                  >
                    <div
                      className="h-full bg-[#788B68] transition-[width] duration-75"
                      style={{ width: `${micPreview.liveTelemetry.activityPct}%` }}
                    />
                  </div>
                </div>
              )}

              <Button
                type="button"
                variant={isMicActive ? 'ivory' : 'secondary'}
                size="sm"
                disabled={!micPreview.isSupported || micPreview.status === 'starting'}
                onClick={handleToggleMicPreview}
              >
                {isMicActive ? (
                  <>
                    <MicOff className="w-3.5 h-3.5" />
                    <span>Stop Microphone Preview</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-3.5 h-3.5" />
                    <span>
                      {micPreview.status === 'starting'
                        ? 'Starting Preview…'
                        : 'Start Microphone Preview'}
                    </span>
                  </>
                )}
              </Button>
            </div>
          </div>

          {micPreview.errorMessage && (
            <p role="alert" className="text-xs text-[var(--app-amber)] leading-relaxed">
              {micPreview.errorMessage}
            </p>
          )}
        </SurfacePanel>

        {/* Tier 1: Primary Signature Instrument — The Acoustic Field (dominating the viewport) */}
        <section aria-label="Acoustic Field: Ecosystem particles and spectral envelope" className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
            <h2 className="text-sm font-medium text-[var(--app-text-secondary)] flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#788B68] animate-pulse" />
              <span>Bioacoustic Field Instrument</span>
            </h2>
            <div className="flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums text-[var(--app-text-muted)]">
              <span>
                Peak: <strong className="text-[#D3A36C]">{displayPeakHz} Hz</strong>
              </span>
              <span>
                RMS:{' '}
                <strong className="text-[var(--app-text)]">
                  {displayRmsDbfs.toFixed(1)} dBFS
                </strong>
              </span>
              <span>
                Elapsed:{' '}
                <strong className="text-[var(--app-text)]">
                  {formatDurationSeconds(elapsedSec)}
                </strong>
              </span>
              <span data-testid="observatory-stream-status" className="uppercase font-semibold text-[#788B68]">
                {monitoringStatus === 'streaming' ? 'Streaming' : 'Paused'}
              </span>
            </div>
          </div>

          <AcousticField
            status={monitoringStatus}
            presetId={activePreset}
            peakFrequencyHz={displayPeakHz}
            rmsLevelDbfs={displayRmsDbfs}
            sampleRateHz={audioPrefs.sampleRateHz}
            fftSize={audioPrefs.fftSize}
            analyserNode={micPreview.analyserNode}
            isMicrophoneActive={isMicActive}
            reducedMotion={appearance.reducedMotionOverride}
            height={460}
            detections={presetDetections}
            disturbances={recentDisturbances}
            interactive={true}
            showControls={true}
          />
        </section>

        {/* Tier 2: Live Signal Diagnostics Strip */}
        <section
          aria-label="Live acoustic signal diagnostics"
          className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono"
        >
          <div className="p-3.5 rounded-lg bg-[var(--app-surface)] border border-[var(--app-border)]">
            <div className="text-[10px] text-[var(--app-text-muted)] uppercase">Spectral Centroid</div>
            <div className="mt-1 text-xl font-medium text-[#D3A36C] tabular-nums">{displayPeakHz} Hz</div>
            <div className="text-[10px] text-[var(--app-text-muted)] mt-1">Avian biophony corridor</div>
          </div>
          <div className="p-3.5 rounded-lg bg-[var(--app-surface)] border border-[var(--app-border)]">
            <div className="text-[10px] text-[var(--app-text-muted)] uppercase">RMS Level</div>
            <div className="mt-1 text-xl font-medium text-[var(--app-text)] tabular-nums">{displayRmsDbfs.toFixed(1)} dBFS</div>
            <div className="text-[10px] text-[var(--app-text-muted)] mt-1">Calibrated reference</div>
          </div>
          <div className="p-3.5 rounded-lg bg-[var(--app-surface)] border border-[var(--app-border)]">
            <div className="text-[10px] text-[var(--app-text-muted)] uppercase">Buffer Latency</div>
            <div className="mt-1 text-xl font-medium text-[#788B68] tabular-nums">{streamMetrics.bufferLatencyMs} ms</div>
            <div className="text-[10px] text-[var(--app-text-muted)] mt-1">{formattedSampleRateKhz} kHz / {audioPrefs.fftSize} FFT</div>
          </div>
          <div className="p-3.5 rounded-lg bg-[var(--app-surface)] border border-[var(--app-border)]">
            <div className="text-[10px] text-[var(--app-text-muted)] uppercase">Frames Ingested</div>
            <div className="mt-1 text-xl font-medium text-[var(--app-text-secondary)] tabular-nums">{streamMetrics.framesProcessed.toLocaleString()}</div>
            <div className="text-[10px] text-[var(--app-text-muted)] mt-1">Zero dropped frames</div>
          </div>
        </section>

        {/* Tier 3: Bioacoustic Events & Disturbance Signals Split */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <SurfacePanel as="section" className="lg:col-span-7 p-6">
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-[var(--app-border)]">
              <div className="min-w-0">
                <h2 className="font-serif text-2xl font-semibold text-[var(--app-text)]">
                  Recent Species Detections
                </h2>
                <p className="text-xs text-[var(--app-text-muted)] mt-0.5">
                  Demo fixture detections ≥{' '}
                  <span className="font-mono">{audioPrefs.minConfidenceThreshold.toFixed(2)}</span>{' '}
                  · Raw model scores, not calibrated probabilities.
                </p>
              </div>
              <Link
                to="/app/detections"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--app-accent)] hover:underline underline-offset-4 whitespace-nowrap shrink-0"
              >
                <span>All Detections</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {isLoading ? (
              <div className="mt-4 space-y-3">
                <SkeletonPanel className="h-14" />
                <SkeletonPanel className="h-14" />
              </div>
            ) : presetDetections.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  title="No Detections Above Threshold"
                  description={`No demo detections for this station meet your configured confidence threshold (${audioPrefs.minConfidenceThreshold.toFixed(2)}).`}
                />
              </div>
            ) : (
              <div className="divide-y divide-[var(--app-border)] mt-2">
                {presetDetections.map((det) => (
                  <button
                    key={det.id}
                    type="button"
                    onClick={() => setInspectedItem({ kind: 'detection', item: det })}
                    className="w-full text-left py-3.5 px-2 -mx-2 rounded-md flex items-center justify-between gap-4 hover:bg-[var(--app-surface-elevated)]/45 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D3A36C] cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--app-text)] truncate">
                        {appearance.showScientificNamesFirst
                          ? det.scientificName
                          : det.commonName}
                      </div>
                      <div className="text-xs text-[var(--app-text-muted)] truncate">
                        <span className="italic">
                          {appearance.showScientificNamesFirst
                            ? det.commonName
                            : det.scientificName}
                        </span>
                        <span className="mx-1.5" aria-hidden="true">
                          ·
                        </span>
                        <span className="font-mono tabular-nums">
                          {det.frequencyRangeHz[0]}–{det.frequencyRangeHz[1]} Hz
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right font-mono tabular-nums">
                        <div className="text-sm font-medium text-[var(--app-accent)]">
                          {det.confidenceScore.toFixed(2)}
                        </div>
                        <div className="text-[11px] text-[var(--app-text-muted)]">
                          {formatTimestampTime(det.timestampIso)}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[var(--app-text-muted)]" aria-hidden="true" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </SurfacePanel>

          <SurfacePanel as="section" className="lg:col-span-5 p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-start justify-between gap-4 pb-4 border-b border-[var(--app-border)]">
                <div className="min-w-0">
                  <h2 className="font-serif text-2xl font-semibold text-[var(--app-text)]">
                    Disturbance Signals
                  </h2>
                  <p className="text-xs text-[var(--app-text-muted)] mt-0.5">
                    Non-biological acoustic events in active fixture
                  </p>
                </div>
                <Link
                  to="/app/disturbances"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--app-amber)] hover:underline underline-offset-4 whitespace-nowrap shrink-0"
                >
                  <span>Full Radar</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>

              {isLoading ? (
                <div className="mt-4 space-y-3">
                  <SkeletonPanel className="h-14" />
                  <SkeletonPanel className="h-14" />
                </div>
              ) : !activeSession ? (
                <div className="mt-4">
                  <EmptyState
                    title="No Associated Session"
                    description="No monitoring session matches this habitat preset in the current dataset."
                  />
                </div>
              ) : recentDisturbances.length === 0 ? (
                <div className="mt-4">
                  <EmptyState
                    title="No Disturbance Events"
                    description="No non-biological disturbance events were recorded for this station session."
                  />
                </div>
              ) : (
                <div className="divide-y divide-[var(--app-border)] mt-2">
                  {recentDisturbances.map((ev) => (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => setInspectedItem({ kind: 'disturbance', item: ev })}
                      className="w-full text-left py-3.5 px-2 -mx-2 rounded-md space-y-1 hover:bg-[var(--app-surface-elevated)]/45 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D3A36C] cursor-pointer"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm font-medium text-[var(--app-text)] truncate">
                          {ev.label}
                        </span>
                        <span className="text-xs font-mono tabular-nums text-[var(--app-amber)] shrink-0">
                          {ev.peakDbfs.toFixed(1)} dBFS
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--app-text-muted)]">
                        <span>{getDisturbanceCategoryLabel(ev.category)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="capitalize">{ev.severity} intensity</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {formatTimestampTime(ev.timestampIso)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-6 pt-4 border-t border-[var(--app-border)] text-xs text-[var(--app-text-muted)] truncate">
              {activeSession ? (
                <>
                  Session:{' '}
                  <span data-testid="observatory-active-session" className="font-mono text-[var(--app-text-secondary)]">
                    {activeSession.id}
                  </span>
                  <span className="mx-1.5" aria-hidden="true">
                    ·
                  </span>
                  <span>{activeSession.title}</span>
                </>
              ) : (
                <span data-testid="observatory-active-session">
                  Session: None resolved for selected preset
                </span>
              )}
            </div>
          </SurfacePanel>
        </div>

        {/* Tier 4: Longitudinal Soundscape Indices Intelligence */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <SkeletonPanel />
            <SkeletonPanel />
            <SkeletonPanel />
          </div>
        ) : !soundscape ? (
          <EmptyState
            title="Soundscape Metrics Unavailable"
            description="No fixture soundscape snapshot could be resolved for the active station."
          />
        ) : (
          <section
            aria-label="Live soundscape and ecological intelligence"
            className="p-5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-border)] space-y-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--app-border)] pb-3">
              <div>
                <h3 className="font-serif text-lg font-semibold text-[var(--app-text)]">
                  Longitudinal Soundscape Indices
                </h3>
                <p className="text-xs text-[var(--app-text-muted)]">
                  Empirical bioacoustic indices tracking spectral temporal complexity, anthrophony balance, and acoustic entropy
                </p>
              </div>
              <Link
                to="/app/soundscape"
                className="text-xs font-semibold text-[var(--app-accent)] hover:underline underline-offset-4 flex items-center gap-1.5"
              >
                <span>Full Soundscape Analysis</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <MetricReadout
                label="Acoustic Complexity (ACI)"
                value={soundscape.indices.aci.toFixed(1)}
                context="Spectral temporal variation (Demo fixture)"
              />
              <MetricReadout
                label="NDSI Balance"
                value={
                  (soundscape.indices.ndsi >= 0 ? '+' : '') + soundscape.indices.ndsi.toFixed(2)
                }
                accent="moss"
                context="Biophony vs anthrophony ratio (-1 to +1, Demo)"
              />
              <MetricReadout
                label="Spectral Entropy (H′)"
                value={soundscape.indices.spectralEntropy.toFixed(2)}
                context="Normalized frequency dispersion (0 to 1, Demo)"
              />
            </div>
          </section>
        )}
      </div>

      <ObservatoryEventDrawer
        inspected={inspectedItem}
        session={activeSession}
        showScientificNamesFirst={appearance.showScientificNamesFirst}
        onClose={() => setInspectedItem(null)}
      />
    </AppShell>
  );
}
