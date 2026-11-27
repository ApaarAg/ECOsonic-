import { useEffect, useMemo, useRef, useState } from 'react';
import type { EChartsOption } from 'echarts';
import {
  Check,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  FileText,
  Info,
  MapPin,
  X,
} from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { EChartBox } from '../components/charts/EChartBox';
import { Button, MetricReadout, SkeletonPanel, SurfacePanel } from '../components/ui/Primitives';
import { useEcoSonic } from '../context/EcoSonicContext';
import { DEMO_HABITAT_PRESETS, DEMO_SOUNDSCAPES } from '../data/demoFixtures';
import { formatTimestampDateTime } from '../lib/acoustics';
import {
  ACOUSTIC_INDEX_SPECS,
  type AcousticIndexDoc,
  computeSourceMetrics,
  computeTemporalStats,
  formatSoundscapeExportCsv,
  formatSoundscapeExportJson,
  normalizeSoundscapeIndices,
} from '../lib/soundscapeAnalytics';
import type { HabitatPresetId, SoundscapeIndices } from '../types/ecosonic';

export function SoundscapePage() {
  const { activePreset, setActivePreset, soundscape, isLoading, appearance } = useEcoSonic();
  const isLight = appearance.theme === 'field-light';

  // State
  const [selectedDocKey, setSelectedDocKey] = useState<
    keyof Omit<SoundscapeIndices, 'meanLevelDbfs' | 'computedAtIso'> | null
  >(null);
  const [showDetectionsOverlay, setShowDetectionsOverlay] = useState(false);
  const [showSplOverlay, setShowSplOverlay] = useState(false);
  const [compareAllStations, setCompareAllStations] = useState(false);
  const [showDataTable, setShowDataTable] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const exportTimerRef = useRef<number | null>(null);
  const modalCloseBtnRef = useRef<HTMLButtonElement | null>(null);

  const activeHabitatMeta = useMemo(
    () => DEMO_HABITAT_PRESETS.find((p) => p.id === activePreset) ?? DEMO_HABITAT_PRESETS[0],
    [activePreset]
  );

  const sourceMetrics = useMemo(
    () => computeSourceMetrics(soundscape?.frequencyBands ?? []),
    [soundscape]
  );

  const temporalStats = useMemo(
    () => computeTemporalStats(soundscape?.temporalActivity ?? []),
    [soundscape]
  );

  // Handle Escape key and focus for methodology modal
  useEffect(() => {
    if (!selectedDocKey) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setSelectedDocKey(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    const prevFocus = document.activeElement as HTMLElement | null;
    modalCloseBtnRef.current?.focus();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      prevFocus?.focus();
    };
  }, [selectedDocKey]);
  const axisLabelColor = isLight ? '#243B2E' : '#A5AC9C';
  const axisLineColor = isLight ? 'rgba(16, 28, 23, 0.2)' : 'rgba(213, 217, 198, 0.2)';
  const splitLineColor = isLight ? 'rgba(16, 28, 23, 0.08)' : 'rgba(213, 217, 198, 0.08)';
  const tooltipBg = isLight ? '#EEEBDD' : '#101C17';
  const tooltipText = isLight ? '#101C17' : '#EEEBDD';

  const showTemporaryNotice = (msg: string) => {
    if (exportTimerRef.current !== null) {
      window.clearTimeout(exportTimerRef.current);
    }
    setExportNotice(msg);
    exportTimerRef.current = window.setTimeout(() => {
      exportTimerRef.current = null;
      setExportNotice(null);
    }, 3500);
  };

  const handleExportJson = () => {
    if (!soundscape) return;
    const jsonStr = formatSoundscapeExportJson(soundscape);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ecosonic-soundscape-${soundscape.presetId}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showTemporaryNotice('Exported research-grade soundscape JSON snapshot.');
  };

  const handleExportCsv = () => {
    if (!soundscape) return;
    const csvStr = formatSoundscapeExportCsv(soundscape);
    const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ecosonic-soundscape-${soundscape.presetId}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showTemporaryNotice('Exported soundscape indices & spectral bands CSV.');
  };

  // ECharts Option: Temporal Activity Profile
  const temporalOption = useMemo<EChartsOption>(() => {
    if (!soundscape) return {};
    const times = soundscape.temporalActivity.map((p) => p.timeLabel);
    const bio = soundscape.temporalActivity.map((p) => p.biophonyIndex);
    const anthro = soundscape.temporalActivity.map((p) => p.anthrophonyIndex);
    const detections = soundscape.temporalActivity.map((p) => p.detectionCount);
    const spl = soundscape.temporalActivity.map((p) => p.meanSplDb);

    const seriesList: EChartsOption['series'] = [
      {
        name: 'Biophony Activity',
        type: 'line',
        smooth: true,
        data: bio,
        yAxisIndex: 0,
        lineStyle: { color: '#788B68', width: 2.5 },
        itemStyle: { color: '#788B68' },
        areaStyle: { color: 'rgba(120, 139, 104, 0.16)' },
      },
      {
        name: 'Anthrophony Activity',
        type: 'line',
        smooth: true,
        data: anthro,
        yAxisIndex: 0,
        lineStyle: { color: '#D3A36C', width: 2, type: 'dashed' },
        itemStyle: { color: '#D3A36C' },
      },
    ];

    const yAxes: EChartsOption['yAxis'] = [
      {
        type: 'value',
        name: 'Activity Index',
        nameTextStyle: { color: axisLabelColor, fontFamily: 'IBM Plex Mono, monospace', fontSize: 10 },
        min: 0,
        max: 1,
        splitLine: { lineStyle: { color: splitLineColor } },
        axisLabel: { color: axisLabelColor, fontFamily: 'IBM Plex Mono, monospace', fontSize: 11 },
      },
    ];

    if (showDetectionsOverlay) {
      seriesList.push({
        name: 'Vocal Detections',
        type: 'bar',
        data: detections,
        yAxisIndex: 1,
        barWidth: '22%',
        itemStyle: { color: 'rgba(165, 172, 156, 0.35)', borderRadius: [3, 3, 0, 0] },
      });
    }

    if (showSplOverlay) {
      seriesList.push({
        name: 'Mean SPL (dBFS)',
        type: 'line',
        smooth: false,
        data: spl,
        yAxisIndex: 1,
        lineStyle: { color: '#D5D9C6', width: 1.5, type: 'dotted' },
        itemStyle: { color: '#D5D9C6' },
      });
    }

    if (showDetectionsOverlay || showSplOverlay) {
      yAxes.push({
        type: 'value',
        name: showDetectionsOverlay ? 'Detections' : 'SPL (dBFS)',
        nameTextStyle: { color: axisLabelColor, fontFamily: 'IBM Plex Mono, monospace', fontSize: 10 },
        splitLine: { show: false },
        axisLabel: { color: axisLabelColor, fontFamily: 'IBM Plex Mono, monospace', fontSize: 11 },
      });
    }

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: tooltipBg,
        borderColor: axisLineColor,
        textStyle: { color: tooltipText, fontFamily: 'IBM Plex Mono, monospace', fontSize: 12 },
        formatter: (params: unknown) => {
          if (!Array.isArray(params) || params.length === 0) return '';
          const idx = (params[0] as { dataIndex?: number })?.dataIndex ?? 0;
          const pt = soundscape.temporalActivity[idx];
          if (!pt) return '';
          return `
            <div style="font-weight:600;margin-bottom:4px">${pt.timeLabel} UTC (${soundscape.siteName})</div>
            <div style="color:#788B68">Biophony Index: ${pt.biophonyIndex.toFixed(2)}</div>
            <div style="color:#D3A36C">Anthrophony Index: ${pt.anthrophonyIndex.toFixed(2)}</div>
            <div style="color:#A5AC9C">Vocal Detections: ${pt.detectionCount}</div>
            <div style="color:#D5D9C6">Mean Level: ${pt.meanSplDb.toFixed(1)} dBFS</div>
          `;
        },
      },
      legend: {
        data: [
          'Biophony Activity',
          'Anthrophony Activity',
          ...(showDetectionsOverlay ? ['Vocal Detections'] : []),
          ...(showSplOverlay ? ['Mean SPL (dBFS)'] : []),
        ],
        textStyle: { color: axisLabelColor, fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 11 },
        top: 0,
        right: 0,
      },
      grid: { left: 48, right: showDetectionsOverlay || showSplOverlay ? 52 : 20, top: 40, bottom: 32 },
      xAxis: {
        type: 'category',
        data: times,
        axisLine: { lineStyle: { color: axisLineColor } },
        axisLabel: { color: axisLabelColor, fontFamily: 'IBM Plex Mono, monospace', fontSize: 11 },
      },
      yAxis: yAxes,
      series: seriesList,
    };
  }, [
    soundscape,
    showDetectionsOverlay,
    showSplOverlay,
    tooltipBg,
    tooltipText,
    axisLabelColor,
    axisLineColor,
    splitLineColor,
  ]);

  // ECharts Option: Frequency Band Energy
  const bandOption = useMemo<EChartsOption>(() => {
    if (!soundscape) return {};
    const labels = soundscape.frequencyBands.map((b) => b.rangeHz);
    const shares = soundscape.frequencyBands.map((b) => ({
      value: b.relativeSharePct,
      itemStyle: {
        color:
          b.dominantSource === 'biophony'
            ? '#788B68'
            : b.dominantSource === 'geophony'
              ? '#A5AC9C'
              : '#D3A36C',
        borderRadius: [4, 4, 0, 0],
      },
    }));

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: tooltipBg,
        borderColor: axisLineColor,
        textStyle: { color: tooltipText, fontFamily: 'IBM Plex Mono, monospace', fontSize: 12 },
        formatter: (params: unknown) => {
          const item = Array.isArray(params) ? params[0] : params;
          const idx = (item as { dataIndex?: number })?.dataIndex ?? 0;
          const band = soundscape.frequencyBands[idx];
          if (!band) return '';
          const sourceBadge =
            band.dominantSource === 'biophony'
              ? '<span style="color:#788B68">● Biophony</span>'
              : band.dominantSource === 'geophony'
                ? '<span style="color:#A5AC9C">● Geophony</span>'
                : '<span style="color:#D3A36C">● Anthrophony</span>';
          return `
            <div style="font-weight:600;margin-bottom:4px">${band.bandLabel} (${band.rangeHz})</div>
            <div>Source: ${sourceBadge}</div>
            <div>Relative Share: <b>${band.relativeSharePct}%</b></div>
            <div>Measured Energy: <b>${band.energyDb.toFixed(1)} dBFS</b></div>
          `;
        },
      },
      grid: { left: 46, right: 16, top: 24, bottom: 36 },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: axisLineColor } },
        axisLabel: { color: axisLabelColor, fontFamily: 'IBM Plex Mono, monospace', fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        name: '%',
        nameTextStyle: { color: axisLabelColor, fontFamily: 'IBM Plex Mono, monospace' },
        splitLine: { lineStyle: { color: splitLineColor } },
        axisLabel: { color: axisLabelColor, fontFamily: 'IBM Plex Mono, monospace', fontSize: 11 },
      },
      series: [{ type: 'bar', barWidth: '46%', data: shares }],
    };
  }, [soundscape, tooltipBg, tooltipText, axisLabelColor, axisLineColor, splitLineColor]);

  // ECharts Option: Soundscape Fingerprint Radar (Single vs Comparison)
  const radarOption = useMemo<EChartsOption>(() => {
    if (!soundscape) return {};

    const indicators = [
      { name: 'ACI (Complexity)', max: 1 },
      { name: 'ADI (Diversity)', max: 1 },
      { name: 'AEI (Evenness)', max: 1 },
      { name: 'NDSI (Bio Balance)', max: 1 },
      { name: 'H′ (Spectral Entropy)', max: 1 },
    ];

    const makeRadarData = (snap: (typeof DEMO_SOUNDSCAPES)[HabitatPresetId], color: string, isCurrent: boolean) => {
      const norm = normalizeSoundscapeIndices(snap.indices);
      return {
        value: [norm.aciNorm, norm.adiNorm, norm.aeiNorm, norm.ndsiNorm, norm.entropyNorm],
        name: snap.siteName,
        areaStyle: { color: isCurrent ? 'rgba(120, 139, 104, 0.28)' : 'rgba(211, 163, 108, 0.12)' },
        lineStyle: { color, width: isCurrent ? 2.5 : 1.5, type: isCurrent ? ('solid' as const) : ('dashed' as const) },
        itemStyle: { color },
      };
    };

    const radarSeriesData = compareAllStations
      ? [
          makeRadarData(DEMO_SOUNDSCAPES['temperate-rainforest'], '#788B68', activePreset === 'temperate-rainforest'),
          makeRadarData(DEMO_SOUNDSCAPES['boreal-wetland'], '#A5AC9C', activePreset === 'boreal-wetland'),
          makeRadarData(DEMO_SOUNDSCAPES['subalpine-ridge'], '#D3A36C', activePreset === 'subalpine-ridge'),
        ]
      : [makeRadarData(soundscape, '#788B68', true)];

    return {
      backgroundColor: 'transparent',
      tooltip: {
        backgroundColor: tooltipBg,
        borderColor: axisLineColor,
        textStyle: { color: tooltipText, fontFamily: 'IBM Plex Mono, monospace', fontSize: 11 },
        formatter: (params: unknown) => {
          const item = params as { name?: string; value?: number[] };
          if (!item?.value) return '';
          return `
            <div style="font-weight:600;margin-bottom:4px">${item.name}</div>
            <div>ACI Norm: ${(item.value[0] * 100).toFixed(0)}%</div>
            <div>ADI Norm: ${(item.value[1] * 100).toFixed(0)}%</div>
            <div>AEI Norm: ${(item.value[2] * 100).toFixed(0)}%</div>
            <div>NDSI Norm: ${(item.value[3] * 100).toFixed(0)}%</div>
            <div>H′ Entropy: ${(item.value[4] * 100).toFixed(0)}%</div>
          `;
        },
      },
      legend: compareAllStations
        ? {
            top: 0,
            textStyle: { color: axisLabelColor, fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 10 },
          }
        : undefined,
      radar: {
        indicator: indicators,
        axisName: { color: axisLabelColor, fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 11 },
        splitLine: { lineStyle: { color: axisLineColor } },
        splitArea: {
          areaStyle: {
            color: isLight
              ? ['rgba(16, 28, 23, 0.03)', 'rgba(36, 59, 46, 0.06)']
              : ['rgba(16, 28, 23, 0.2)', 'rgba(24, 39, 31, 0.2)'],
          },
        },
        axisLine: { lineStyle: { color: axisLineColor } },
      },
      series: [{ type: 'radar', data: radarSeriesData }],
    };
  }, [soundscape, compareAllStations, activePreset, tooltipBg, tooltipText, axisLabelColor, axisLineColor, isLight]);

  const activeDocModal: AcousticIndexDoc | null = selectedDocKey
    ? ACOUSTIC_INDEX_SPECS[selectedDocKey]
    : null;

  return (
    <AppShell
      title="Soundscape Intelligence"
      subtitle="Acoustic indices (ACI, ADI, AEI, NDSI), spectral Shannon entropy, and frequency-band energy"
    >
      <div className="space-y-6">
        {/* Station Selector & Geographic Telemetry */}
        <SurfacePanel className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-[#D3A36C]/15 border border-[#D3A36C]/40 text-[#D3A36C]">
                DEMO FIXTURE DATASET · NO FABRICATED HEALTH SCORES
              </span>
              <span className="text-xs text-[var(--app-text-muted)] flex items-center gap-1 font-mono">
                <MapPin className="w-3.5 h-3.5 text-[#788B68]" />
                {activeHabitatMeta.regionLabel} · {activeHabitatMeta.elevationLabel}
              </span>
            </div>
            <p className="text-xs text-[var(--app-text-muted)] max-w-2xl leading-relaxed">
              {activeHabitatMeta.description}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {DEMO_HABITAT_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setActivePreset(p.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  activePreset === p.id
                    ? 'bg-[#788B68] text-[#101C17] font-semibold'
                    : 'bg-[var(--app-bg)] text-[var(--app-text-secondary)] border border-[var(--app-border)]'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </SurfacePanel>

        {/* Temporary Notification Banner */}
        {exportNotice && (
          <div
            role="status"
            className="flex items-center gap-2 p-3.5 rounded-md bg-[#788B68]/15 border border-[#788B68]/40 text-xs text-[#788B68] font-medium"
          >
            <Check className="w-4 h-4 shrink-0" />
            <span>{exportNotice}</span>
          </div>
        )}

        {isLoading || !soundscape ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <SkeletonPanel />
            <SkeletonPanel />
            <SkeletonPanel />
          </div>
        ) : (
          <>
            {/* Core Acoustic Indices Cards with Inspector Targets */}
            <section aria-label="Core Acoustic Indices" className="space-y-2">
              <div className="flex items-center justify-between text-xs text-[var(--app-text-muted)] px-1">
                <span>Empirical Multi-Band Indices ({formatTimestampDateTime(soundscape.indices.computedAtIso)})</span>
                <span className="italic hidden sm:inline">Click info on any card to view peer-reviewed formula</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                {/* ACI */}
                <div className="relative group">
                  <MetricReadout
                    label="ACI (Pieretti et al. 2011)"
                    value={soundscape.indices.aci.toFixed(1)}
                    accent="moss"
                    context="Rapid amplitude modulation across frequency bins."
                  />
                  <button
                    type="button"
                    onClick={() => setSelectedDocKey('aci')}
                    aria-label="Inspect Acoustic Complexity Index methodology"
                    className="absolute top-4 right-4 p-1 rounded hover:bg-[var(--app-surface-elevated)] text-[var(--app-text-muted)] hover:text-[#788B68] transition-colors cursor-pointer"
                  >
                    <Info className="w-4 h-4" />
                  </button>
                </div>

                {/* ADI */}
                <div className="relative group">
                  <MetricReadout
                    label="ADI (Villanueva-Rivera 2011)"
                    value={soundscape.indices.adi.toFixed(2)}
                    context="Shannon diversity across 1 kHz frequency bins."
                  />
                  <button
                    type="button"
                    onClick={() => setSelectedDocKey('adi')}
                    aria-label="Inspect Acoustic Diversity Index methodology"
                    className="absolute top-4 right-4 p-1 rounded hover:bg-[var(--app-surface-elevated)] text-[var(--app-text-muted)] hover:text-[#788B68] transition-colors cursor-pointer"
                  >
                    <Info className="w-4 h-4" />
                  </button>
                </div>

                {/* AEI */}
                <div className="relative group">
                  <MetricReadout
                    label="AEI (Gini Evenness)"
                    value={soundscape.indices.aei.toFixed(2)}
                    context="Gini coefficient of band occupancy (lower = more even)."
                  />
                  <button
                    type="button"
                    onClick={() => setSelectedDocKey('aei')}
                    aria-label="Inspect Acoustic Evenness Index methodology"
                    className="absolute top-4 right-4 p-1 rounded hover:bg-[var(--app-surface-elevated)] text-[var(--app-text-muted)] hover:text-[#788B68] transition-colors cursor-pointer"
                  >
                    <Info className="w-4 h-4" />
                  </button>
                </div>

                {/* NDSI */}
                <div className="relative group">
                  <MetricReadout
                    label="NDSI (Bio Balance)"
                    value={(soundscape.indices.ndsi >= 0 ? '+' : '') + soundscape.indices.ndsi.toFixed(2)}
                    accent={soundscape.indices.ndsi >= 0.5 ? 'moss' : 'amber'}
                    context="Ratio of biophony (2–8 kHz) vs anthrophony (1–2 kHz)."
                  />
                  <button
                    type="button"
                    onClick={() => setSelectedDocKey('ndsi')}
                    aria-label="Inspect Normalized Difference Soundscape Index methodology"
                    className="absolute top-4 right-4 p-1 rounded hover:bg-[var(--app-surface-elevated)] text-[var(--app-text-muted)] hover:text-[#788B68] transition-colors cursor-pointer"
                  >
                    <Info className="w-4 h-4" />
                  </button>
                </div>

                {/* Spectral Shannon Entropy */}
                <div className="relative group">
                  <MetricReadout
                    label="Spectral Entropy H′"
                    value={soundscape.indices.spectralEntropy.toFixed(2)}
                    context="Normalized Shannon entropy of energy distribution (0–1)."
                  />
                  <button
                    type="button"
                    onClick={() => setSelectedDocKey('spectralEntropy')}
                    aria-label="Inspect Spectral Shannon Entropy methodology"
                    className="absolute top-4 right-4 p-1 rounded hover:bg-[var(--app-surface-elevated)] text-[var(--app-text-muted)] hover:text-[#788B68] transition-colors cursor-pointer"
                  >
                    <Info className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </section>

            {/* Charts Row 1: Temporal Activity & Soundscape Fingerprint */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Temporal Activity Chart */}
              <SurfacePanel as="section" className="lg:col-span-7 p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div>
                    <h2 className="font-serif text-2xl font-semibold text-[var(--app-text)]">
                      Temporal Activity Profile
                    </h2>
                    <p className="text-xs text-[var(--app-text-muted)] mt-0.5">
                      Biophony vs anthrophony progression across 10-minute intervals ({soundscape.siteName})
                    </p>
                  </div>

                  <div className="flex items-center gap-2 self-start">
                    <button
                      type="button"
                      onClick={() => setShowDetectionsOverlay((prev) => !prev)}
                      aria-pressed={showDetectionsOverlay}
                      className={`px-2.5 py-1 text-[11px] font-mono rounded border transition-colors cursor-pointer ${
                        showDetectionsOverlay
                          ? 'border-[#788B68]/60 bg-[#788B68]/15 text-[#788B68]'
                          : 'border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-text-muted)] hover:text-[var(--app-text)]'
                      }`}
                    >
                      Detections
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowSplOverlay((prev) => !prev)}
                      aria-pressed={showSplOverlay}
                      className={`px-2.5 py-1 text-[11px] font-mono rounded border transition-colors cursor-pointer ${
                        showSplOverlay
                          ? 'border-[#788B68]/60 bg-[#788B68]/15 text-[#788B68]'
                          : 'border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-text-muted)] hover:text-[var(--app-text)]'
                      }`}
                    >
                      SPL (dBFS)
                    </button>
                  </div>
                </div>

                <EChartBox
                  option={temporalOption}
                  height={280}
                  ariaLabel="Line chart comparing biophony and anthrophony temporal activity"
                />

                {/* Temporal Summary Metrics Bar */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-[var(--app-border)] text-xs">
                  <div>
                    <div className="text-[var(--app-text-muted)]">Peak Biophony</div>
                    <div className="font-mono text-[#788B68] font-medium mt-0.5">
                      {temporalStats.peakBiophony?.timeLabel ?? 'N/A'} ({(temporalStats.peakBiophony?.biophonyIndex ?? 0).toFixed(2)})
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--app-text-muted)]">Peak Anthrophony</div>
                    <div className="font-mono text-[#D3A36C] font-medium mt-0.5">
                      {temporalStats.peakAnthrophony?.timeLabel ?? 'N/A'} ({(temporalStats.peakAnthrophony?.anthrophonyIndex ?? 0).toFixed(2)})
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--app-text-muted)]">Window Detections</div>
                    <div className="font-mono text-[var(--app-text)] font-medium mt-0.5">
                      {temporalStats.totalDetections} calls
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--app-text-muted)]">Mean Sound Pressure</div>
                    <div className="font-mono text-[var(--app-text-secondary)] font-medium mt-0.5">
                      {temporalStats.meanSplDb.toFixed(1)} dBFS
                    </div>
                  </div>
                </div>
              </SurfacePanel>

              {/* Soundscape Fingerprint Radar */}
              <SurfacePanel as="section" className="lg:col-span-5 p-6 space-y-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <h2 className="font-serif text-2xl font-semibold text-[var(--app-text)]">
                        Soundscape Fingerprint
                      </h2>
                      <p className="text-xs text-[var(--app-text-muted)] mt-0.5">
                        Multi-dimensional geometric radar across 5 normalized indices
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setCompareAllStations((prev) => !prev)}
                      aria-pressed={compareAllStations}
                      className={`shrink-0 px-2.5 py-1 text-[11px] font-mono rounded border transition-colors cursor-pointer ${
                        compareAllStations
                          ? 'border-[#D3A36C]/60 bg-[#D3A36C]/15 text-[#D3A36C]'
                          : 'border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-text-muted)] hover:text-[var(--app-text)]'
                      }`}
                    >
                      {compareAllStations ? 'Comparison On' : 'Compare All'}
                    </button>
                  </div>

                  <EChartBox
                    option={radarOption}
                    height={280}
                    ariaLabel="Radar chart showing normalized ACI, ADI, AEI, NDSI, and Spectral Entropy"
                  />
                </div>

                <div className="pt-3 border-t border-[var(--app-border)] text-xs text-[var(--app-text-muted)] flex items-center justify-between">
                  <span>Normalized scale (0.0 to 1.0)</span>
                  <span className="font-mono text-[#788B68]">{soundscape.siteName}</span>
                </div>
              </SurfacePanel>
            </div>

            {/* Charts Row 2: Frequency-Band Energy & Source Attribution */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Frequency-Band Energy Distribution Bar Chart */}
              <SurfacePanel as="section" className="lg:col-span-7 p-6 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-serif text-2xl font-semibold text-[var(--app-text)]">
                      Frequency-Band Energy Distribution
                    </h2>
                    <p className="text-xs text-[var(--app-text-muted)] mt-0.5">
                      Relative spectral share by acoustic band (Moss: Biophony · Stone: Geophony · Amber: Anthrophony)
                    </p>
                  </div>
                </div>

                <EChartBox
                  option={bandOption}
                  height={260}
                  ariaLabel="Bar chart of frequency band energy percentage shares"
                />

                <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--app-text-muted)] pt-2 border-t border-[var(--app-border)]">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#788B68]" />
                    <span>Biophony (Avian Chorus / High Canopy)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#A5AC9C]" />
                    <span>Geophony (Wind, Water, Foliage)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#D3A36C]" />
                    <span>Anthrophony (Machinery, Transit)</span>
                  </div>
                </div>
              </SurfacePanel>

              {/* Source Partition Breakdown & Actions */}
              <SurfacePanel as="section" className="lg:col-span-5 p-6 flex flex-col justify-between space-y-5">
                <div>
                  <h2 className="font-serif text-2xl font-semibold text-[var(--app-text)]">
                    Acoustic Source Partition
                  </h2>
                  <p className="text-xs text-[var(--app-text-muted)] mt-1 leading-relaxed">
                    Spectral energy decomposition across ecological and mechanical sources
                  </p>

                  {/* Horizontal Segmented Share Meter */}
                  <div className="mt-4 space-y-1.5">
                    <div
                      role="progressbar"
                      aria-label="Acoustic source partition meter"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={sourceMetrics.biophonyPct}
                      className="h-3 w-full rounded-full bg-[var(--app-bg)] overflow-hidden flex"
                    >
                      <div
                        style={{ width: `${sourceMetrics.biophonyPct}%` }}
                        className="h-full bg-[#788B68] transition-all"
                        title={`Biophony: ${sourceMetrics.biophonyPct}%`}
                      />
                      <div
                        style={{ width: `${sourceMetrics.geophonyPct}%` }}
                        className="h-full bg-[#A5AC9C] transition-all"
                        title={`Geophony: ${sourceMetrics.geophonyPct}%`}
                      />
                      <div
                        style={{ width: `${sourceMetrics.anthrophonyPct}%` }}
                        className="h-full bg-[#D3A36C] transition-all"
                        title={`Anthrophony: ${sourceMetrics.anthrophonyPct}%`}
                      />
                    </div>
                  </div>

                  <dl className="mt-5 space-y-3.5 text-xs">
                    <div className="flex items-center justify-between border-b border-[var(--app-border)] pb-2">
                      <dt className="text-[var(--app-text-muted)] flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[#788B68]" />
                        Biophony Band Share
                      </dt>
                      <dd className="font-mono tabular-nums text-[#788B68] font-medium">
                        {sourceMetrics.biophonyPct}%
                      </dd>
                    </div>
                    <div className="flex items-center justify-between border-b border-[var(--app-border)] pb-2">
                      <dt className="text-[var(--app-text-muted)] flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[#A5AC9C]" />
                        Geophony Band Share
                      </dt>
                      <dd className="font-mono tabular-nums text-[var(--app-text-secondary)] font-medium">
                        {sourceMetrics.geophonyPct}%
                      </dd>
                    </div>
                    <div className="flex items-center justify-between border-b border-[var(--app-border)] pb-2">
                      <dt className="text-[var(--app-text-muted)] flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[#D3A36C]" />
                        Anthrophony Band Share
                      </dt>
                      <dd className="font-mono tabular-nums text-[#D3A36C] font-medium">
                        {sourceMetrics.anthrophonyPct}%
                      </dd>
                    </div>
                    <div className="flex items-center justify-between border-b border-[var(--app-border)] pb-2">
                      <dt className="text-[var(--app-text-muted)]">Dominant Acoustic Band</dt>
                      <dd className="font-mono text-[var(--app-text)]">
                        {sourceMetrics.dominantBand?.bandLabel ?? 'N/A'} ({sourceMetrics.dominantBand?.rangeHz})
                      </dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-[var(--app-text-muted)]">Mean Window SPL</dt>
                      <dd className="font-mono tabular-nums text-[var(--app-text)]">
                        {soundscape.indices.meanLevelDbfs.toFixed(1)} dBFS
                      </dd>
                    </div>
                  </dl>
                </div>

                {/* Research Export Actions */}
                <div className="pt-4 border-t border-[var(--app-border)] flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleExportJson}
                    aria-label="Export complete soundscape snapshot as JSON"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Export JSON</span>
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleExportCsv}
                    aria-label="Export soundscape indices and frequency bands as CSV"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    <span>Export CSV</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDataTable((prev) => !prev)}
                    aria-expanded={showDataTable}
                  >
                    {showDataTable ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    <span>{showDataTable ? 'Hide Table' : 'View Sample Table'}</span>
                  </Button>
                </div>
              </SurfacePanel>
            </div>

            {/* Expandable Tabular Data Table for Screen-Reader Accessibility & Raw Study */}
            {showDataTable && (
              <SurfacePanel as="section" className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-serif text-xl font-semibold text-[var(--app-text)]">
                      Temporal Sample Log ({soundscape.siteName})
                    </h2>
                    <p className="text-xs text-[var(--app-text-muted)] mt-0.5">
                      Empirical telemetry across all recorded 10-minute sampling intervals
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowDataTable(false)}
                    aria-label="Close sample table"
                    className="p-1 rounded text-[var(--app-text-muted)] hover:text-[var(--app-text)] cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-[var(--app-bg)] text-[var(--app-text-muted)] font-mono border-b border-[var(--app-border)]">
                      <tr>
                        <th className="py-2.5 px-3">Interval (UTC)</th>
                        <th className="py-2.5 px-3">Timestamp</th>
                        <th className="py-2.5 px-3">Biophony Index</th>
                        <th className="py-2.5 px-3">Anthrophony Index</th>
                        <th className="py-2.5 px-3">Bio/Anthro Ratio</th>
                        <th className="py-2.5 px-3">Detections</th>
                        <th className="py-2.5 px-3">Mean SPL</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--app-border)] font-mono">
                      {soundscape.temporalActivity.map((pt) => {
                        const ratio =
                          pt.anthrophonyIndex > 0
                            ? (pt.biophonyIndex / pt.anthrophonyIndex).toFixed(2)
                            : '∞';
                        return (
                          <tr key={pt.timestampIso} className="hover:bg-[var(--app-surface-elevated)]/30">
                            <td className="py-2 px-3 font-medium text-[var(--app-text)]">{pt.timeLabel}</td>
                            <td className="py-2 px-3 text-[var(--app-text-muted)]">{pt.timestampIso}</td>
                            <td className="py-2 px-3 text-[#788B68]">{pt.biophonyIndex.toFixed(2)}</td>
                            <td className="py-2 px-3 text-[#D3A36C]">{pt.anthrophonyIndex.toFixed(2)}</td>
                            <td className="py-2 px-3 text-[var(--app-text-secondary)]">{ratio}x</td>
                            <td className="py-2 px-3 text-[var(--app-text)]">{pt.detectionCount}</td>
                            <td className="py-2 px-3 text-[var(--app-text-muted)]">{pt.meanSplDb.toFixed(1)} dBFS</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </SurfacePanel>
            )}
          </>
        )}
      </div>

      {/* Accessible Acoustic Index Inspector Modal */}
      {activeDocModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="index-doc-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-[2px]"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedDocKey(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setSelectedDocKey(null);
          }}
        >
          <div className="w-full max-w-lg rounded-lg border border-[var(--app-border-strong)] bg-[var(--app-surface)] text-[var(--app-text)] shadow-2xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-[#788B68]/15 border border-[#788B68]/40 text-[#788B68]">
                  {activeDocModal.acronym}
                </span>
                <h3 id="index-doc-title" className="font-serif text-2xl font-semibold text-[var(--app-text)] mt-1.5">
                  {activeDocModal.fullName}
                </h3>
              </div>
              <button
                ref={modalCloseBtnRef}
                type="button"
                onClick={() => setSelectedDocKey(null)}
                aria-label="Close index specification dialog"
                className="p-1.5 rounded-md text-[var(--app-text-muted)] hover:text-[var(--app-text)] hover:bg-[var(--app-surface-elevated)] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs leading-relaxed text-[var(--app-text-secondary)]">
              <div>
                <div className="font-semibold text-[var(--app-text)]">Literature Reference:</div>
                <div className="italic text-[var(--app-text-muted)] mt-0.5">{activeDocModal.reference}</div>
              </div>

              <div>
                <div className="font-semibold text-[var(--app-text)]">Mathematical Formulation:</div>
                <div className="font-mono p-2.5 rounded bg-[var(--app-bg)] border border-[var(--app-border)] text-[var(--app-text)] mt-1 overflow-x-auto">
                  {activeDocModal.formula}
                </div>
              </div>

              <div>
                <div className="font-semibold text-[var(--app-text)]">Scale & Reference Range:</div>
                <div className="font-mono text-[var(--app-text-muted)] mt-0.5">{activeDocModal.scaleRange}</div>
              </div>

              <div>
                <div className="font-semibold text-[var(--app-text)]">Interpretation:</div>
                <div className="mt-0.5">{activeDocModal.interpretation}</div>
              </div>

              <div>
                <div className="font-semibold text-[var(--app-text)]">Ecological Context:</div>
                <div className="mt-0.5">{activeDocModal.biologicalContext}</div>
              </div>

              {soundscape && (
                <div className="p-3 rounded bg-[var(--app-surface-elevated)] border border-[var(--app-border)] mt-2">
                  <div className="text-[var(--app-text-muted)]">Active Station Value ({soundscape.siteName}):</div>
                  <div className="text-base font-mono font-medium text-[#788B68] mt-1">
                    {soundscape.indices[activeDocModal.key]}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-[var(--app-border)]">
              <Button type="button" variant="secondary" size="sm" onClick={() => setSelectedDocKey(null)}>
                Close Specification
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
