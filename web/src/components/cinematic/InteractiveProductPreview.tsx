import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Bird,
  ShieldAlert,
  Sparkles,
  Zap,
  Activity,
  Sliders,
  CheckCircle2,
} from 'lucide-react';
import { AcousticField, type AcousticFieldMode } from '../observatory/AcousticField';
import { Badge } from '../ui/Primitives';
import { DEMO_DETECTIONS, DEMO_DISTURBANCES, DEMO_HABITAT_PRESETS, DEMO_SOUNDSCAPES } from '../../data/demoFixtures';
import { formatTimestampTime } from '../../lib/acoustics';
import type { HabitatPresetId, SpeciesDetection, DisturbanceEvent } from '../../types/ecosonic';

/**
 * InteractiveProductPreview
 *
 * OriginKit-inspired Asymmetrical Editorial Showcase + daisyUI structural primitives:
 * - Wide commanding AcousticField canvas dominating the layout
 * - Floating glass telemetry cards & minimal metadata
 * - Live interactive controls (species trigger, disturbance trigger, mode switch)
 * - Restrained typography (Cormorant Garamond + Plus Jakarta Sans + IBM Plex Mono)
 */
export function InteractiveProductPreview() {
  const [selectedPreset, setSelectedPreset] = useState<HabitatPresetId>('temperate-rainforest');
  const [fieldMode, setFieldMode] = useState<AcousticFieldMode>('composite');

  // Simulated live event queues for interactive demonstration
  const [activeDetections, setActiveDetections] = useState<SpeciesDetection[]>(() =>
    DEMO_DETECTIONS.slice(0, 3)
  );
  const [activeDisturbances, setActiveDisturbances] = useState<DisturbanceEvent[]>(() =>
    DEMO_DISTURBANCES.slice(0, 2)
  );

  const activeSoundscape = DEMO_SOUNDSCAPES[selectedPreset] ?? DEMO_SOUNDSCAPES['temperate-rainforest'];

  // Trigger an interactive species vocalization detection
  const handleTriggerAvianEvent = () => {
    const avianList = [
      { name: 'Varied Thrush', sci: 'Ixoreus naevius', freq: [2800, 4200] as [number, number], conf: 0.94 },
      { name: 'Pacific Wren', sci: 'Troglodytes pacificus', freq: [4100, 7800] as [number, number], conf: 0.91 },
      { name: 'Golden-crowned Kinglet', sci: 'Regulus satrapa', freq: [5500, 9200] as [number, number], conf: 0.88 },
      { name: 'Hermit Thrush', sci: 'Catharus guttatus', freq: [2200, 5100] as [number, number], conf: 0.96 },
    ];
    const pick = avianList[Math.floor(Math.random() * avianList.length)];
    const newDet: SpeciesDetection = {
      id: `live-det-${Date.now()}`,
      sessionId: 'demo-hoh-rainforest-01',
      commonName: pick.name,
      scientificName: pick.sci,
      confidenceScore: pick.conf,
      timestampIso: new Date().toISOString(),
      frequencyRangeHz: pick.freq,
      durationSec: 1.5,
      habitatPreset: selectedPreset,
    };
    setActiveDetections((prev) => [newDet, ...prev.slice(0, 4)]);
  };

  // Trigger an interactive non-biological disturbance event
  const handleTriggerDisturbanceEvent = () => {
    const distList = [
      { label: 'Low-Frequency Motor Intrusion', cat: 'transportation' as const, sev: 'moderate' as const, db: -24.5 },
      { label: 'Mechanical Forestry Equipment', cat: 'mechanical_activity' as const, sev: 'elevated' as const, db: -18.2 },
      { label: 'High-Altitude Jet Corridor', cat: 'transportation' as const, sev: 'low' as const, db: -31.4 },
    ];
    const pick = distList[Math.floor(Math.random() * distList.length)];
    const newDist: DisturbanceEvent = {
      id: `live-dist-${Date.now()}`,
      sessionId: 'demo-hoh-rainforest-01',
      label: pick.label,
      description: 'Acoustic intrusion detected in demonstration stream',
      category: pick.cat,
      severity: pick.sev,
      peakDbfs: pick.db,
      timestampIso: new Date().toISOString(),
      durationSec: 2.8,
      frequencyBandHz: [120, 1800],
      confidenceScore: 0.89,
    };
    setActiveDisturbances((prev) => [newDist, ...prev.slice(0, 3)]);
  };

  return (
    <div className="space-y-8">
      {/* Editorial Header & Station Meta */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-6 border-b border-[#D5D9C6]/14">
        <div>
          <div className="flex items-center gap-2">
            <span className="eco-badge eco-badge-moss">
              <span className="w-1.5 h-1.5 rounded-full bg-[#788B68] animate-pulse" />
              INTERACTIVE FIELD INSTRUMENT
            </span>
            <span className="text-xs font-mono text-[#D3A36C] uppercase">
              Demonstration Telemetry
            </span>
          </div>
          <h2 className="mt-3 font-serif text-3xl sm:text-5xl font-semibold leading-[1.08] tracking-tight text-[#EEEBDD]">
            Inside the Live Acoustic Intelligence.
          </h2>
          <p className="mt-3 text-sm text-[#A5AC9C] max-w-xl leading-relaxed">
            Experience how ECOsonic decomposes continuous forest soundscapes into multi-harmonic
            particle ecosystems, species classification loci, and disturbance shockwave boundaries.
          </p>
        </div>

        {/* Habitat Selector Tabs (daisyUI structural tabs adapted to forest tokens) */}
        <div className="flex flex-wrap items-center gap-2">
          {DEMO_HABITAT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setSelectedPreset(preset.id)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer ${
                selectedPreset === preset.id
                  ? 'bg-[#788B68] text-[#101C17] font-semibold shadow-sm'
                  : 'bg-[#18271F] text-[#D5D9C6] hover:bg-[#243B2E] border border-[#D5D9C6]/14'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Asymmetrical Stage: Primary Acoustic Field Canvas (75% width) + Micro-Telemetry Deck (25% width) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Large Visual Instrument Canvas */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          <div className="eco-card-editorial p-1 border border-[#D5D9C6]/20 bg-[#060907] rounded-xl shadow-2xl">
            <AcousticField
              status="streaming"
              presetId={selectedPreset}
              peakFrequencyHz={3420}
              rmsLevelDbfs={-37.8}
              height={380}
              mode={fieldMode}
              onModeChange={setFieldMode}
              detections={activeDetections}
              disturbances={activeDisturbances}
              interactive={true}
              showControls={true}
            />
          </div>

          {/* Interactive Event Launch Bar (Allows visitors to test real-time bioacoustic reactions) */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-[#18271F] border border-[#D5D9C6]/14">
            <div className="flex items-center gap-2 text-xs font-mono text-[#D5D9C6]">
              <Sparkles className="w-4 h-4 text-[#D3A36C]" />
              <span>Interactive Acoustic Stimulation:</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleTriggerAvianEvent}
                className="px-3.5 py-1.5 rounded-md bg-[#243B2E] hover:bg-[#2e4c3a] text-xs font-medium text-[#D5D9C6] border border-[#788B68]/35 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Bird className="w-3.5 h-3.5 text-[#788B68]" />
                <span>Simulate Bird Song Call</span>
              </button>
              <button
                type="button"
                onClick={handleTriggerDisturbanceEvent}
                className="px-3.5 py-1.5 rounded-md bg-[#243B2E] hover:bg-[#3d2c26] text-xs font-medium text-[#D5D9C6] border border-[#E07A5F]/35 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <ShieldAlert className="w-3.5 h-3.5 text-[#E07A5F]" />
                <span>Simulate Disturbance Event</span>
              </button>
            </div>
          </div>
        </div>

        {/* Micro-Telemetry & Biological Metadata Deck (OriginKit Asymmetric Cards) */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          {/* Signal Diagnostics Pill Box */}
          <div className="p-5 rounded-xl bg-[#18271F] border border-[#D5D9C6]/14 space-y-4">
            <div className="flex items-center justify-between border-b border-[#D5D9C6]/10 pb-3">
              <span className="text-xs font-mono text-[#A5AC9C] uppercase">Telemetry Stream</span>
              <Badge variant="moss" className="text-[10px] py-0 px-2">
                48,000 HZ · REAL-TIME
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs font-mono">
              <div className="bg-[#101C17] p-3 rounded-lg border border-[#D5D9C6]/10">
                <div className="text-[10px] text-[#A5AC9C]">INFERENCE LATENCY</div>
                <div className="mt-1 text-lg font-medium text-[#EEEBDD] tabular-nums">18.4 ms</div>
              </div>
              <div className="bg-[#101C17] p-3 rounded-lg border border-[#D5D9C6]/10">
                <div className="text-[10px] text-[#A5AC9C]">ACI COMPLEXITY</div>
                <div className="mt-1 text-lg font-medium text-[#788B68] tabular-nums">
                  {activeSoundscape.indices.aci.toFixed(1)}
                </div>
              </div>
              <div className="bg-[#101C17] p-3 rounded-lg border border-[#D5D9C6]/10">
                <div className="text-[10px] text-[#A5AC9C]">NDSI BALANCE</div>
                <div className="mt-1 text-lg font-medium text-[#D3A36C] tabular-nums">
                  +{activeSoundscape.indices.ndsi.toFixed(2)}
                </div>
              </div>
              <div className="bg-[#101C17] p-3 rounded-lg border border-[#D5D9C6]/10">
                <div className="text-[10px] text-[#A5AC9C]">SPECTRAL ENTROPY</div>
                <div className="mt-1 text-lg font-medium text-[#D5D9C6] tabular-nums">
                  {activeSoundscape.indices.spectralEntropy.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {/* Chronological Avian Loci Log (daisyUI Adapted Timeline) */}
          <div className="p-5 rounded-xl bg-[#18271F] border border-[#D5D9C6]/14 flex-1 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-[#D5D9C6]/10 mb-3">
                <div className="text-xs font-mono text-[#A5AC9C] uppercase flex items-center gap-1.5">
                  <Bird className="w-3.5 h-3.5 text-[#788B68]" />
                  <span>Recent Species Classifications</span>
                </div>
                <span className="text-[10px] font-mono text-[#D3A36C]">BirdNET+ V3.0</span>
              </div>

              <div className="eco-timeline space-y-3">
                {activeDetections.slice(0, 3).map((det) => (
                  <div key={det.id} className="eco-timeline-item">
                    <div className="eco-timeline-point" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-[#EEEBDD] truncate">
                          {det.commonName}
                        </span>
                        <span className="text-xs font-mono text-[#788B68] tabular-nums font-semibold">
                          {(det.confidenceScore * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="text-xs text-[#A5AC9C] italic truncate">
                        {det.scientificName}
                      </div>
                      <div className="text-[11px] font-mono text-[#A5AC9C]/80 mt-0.5">
                        {det.frequencyRangeHz[0]}–{det.frequencyRangeHz[1]} Hz · {formatTimestampTime(det.timestampIso)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 pt-4 border-t border-[#D5D9C6]/10 flex items-center justify-between">
              <span className="text-xs text-[#A5AC9C]">Full continuous analysis</span>
              <Link
                to="/app/observatory"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#788B68] hover:text-[#899D78] hover:underline underline-offset-4"
              >
                <span>Launch Observatory</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
