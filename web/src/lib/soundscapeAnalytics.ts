import type {
  FrequencyBandEnergy,
  SoundscapeIndices,
  SoundscapeSnapshot,
  TemporalActivityPoint,
} from '../types/ecosonic';

export interface NormalizedIndexVector {
  aciNorm: number;
  adiNorm: number;
  aeiNorm: number;
  ndsiNorm: number;
  entropyNorm: number;
}

export interface AcousticIndexDoc {
  key: keyof Omit<SoundscapeIndices, 'meanLevelDbfs' | 'computedAtIso'>;
  acronym: string;
  fullName: string;
  reference: string;
  formula: string;
  scaleRange: string;
  interpretation: string;
  biologicalContext: string;
}

export const ACOUSTIC_INDEX_SPECS: Record<
  keyof Omit<SoundscapeIndices, 'meanLevelDbfs' | 'computedAtIso'>,
  AcousticIndexDoc
> = {
  aci: {
    key: 'aci',
    acronym: 'ACI',
    fullName: 'Acoustic Complexity Index',
    reference: 'Pieretti, Farina & Morri (2011)',
    formula: 'ACI = Σ |I_k - I_{k+1}| / Σ I_k across frequency bins',
    scaleRange: '0–300+ (relative scale)',
    interpretation: 'Quantifies rapid amplitude variations across consecutive time slices per frequency bin.',
    biologicalContext: 'High values indicate rich biological chorusing with overlapping vocal modulations; low values correspond to steady unmodulated noise.',
  },
  adi: {
    key: 'adi',
    acronym: 'ADI',
    fullName: 'Acoustic Diversity Index',
    reference: 'Villanueva-Rivera et al. (2011)',
    formula: 'ADI = - Σ p_i * ln(p_i) across frequency bins with energy > -50 dBFS',
    scaleRange: '0–3.5 (Shannon entropy units)',
    interpretation: 'Calculates Shannon diversity across occupied 1 kHz frequency bands.',
    biologicalContext: 'High diversity values indicate an acoustic niche filled across multiple species occupying distinct frequency bands.',
  },
  aei: {
    key: 'aei',
    acronym: 'AEI',
    fullName: 'Acoustic Evenness Index',
    reference: 'Villanueva-Rivera et al. (2011)',
    formula: 'AEI = Gini coefficient of proportion of occupied bands',
    scaleRange: '0.0–1.0 (inverted scale)',
    interpretation: 'Measures the evenness of energy distribution across spectral bands.',
    biologicalContext: 'Lower AEI values indicate high evenness (energy spread balanced across bands); high values indicate dominance by a single band.',
  },
  ndsi: {
    key: 'ndsi',
    acronym: 'NDSI',
    fullName: 'Normalized Difference Soundscape Index',
    reference: 'Kasten, Gage, Fox & Joo (2012)',
    formula: 'NDSI = (Biophony [2-8kHz] - Anthrophony [1-2kHz]) / (Biophony + Anthrophony)',
    scaleRange: '-1.0 to +1.0',
    interpretation: 'Measures relative dominance of biophony over low-frequency anthrophony.',
    biologicalContext: '+1.0 indicates a pristine biophonic soundscape; negative values indicate dominance by mechanical/transportation noise.',
  },
  spectralEntropy: {
    key: 'spectralEntropy',
    acronym: 'H′',
    fullName: 'Spectral Shannon Entropy',
    reference: 'Sueur et al. (2008)',
    formula: 'H′ = - Σ P(f) * log2(P(f)) / log2(N)',
    scaleRange: '0.0 to 1.0 (normalized)',
    interpretation: 'Measures concentration vs dispersion of spectral energy across frequency bins.',
    biologicalContext: '0 represents a pure tone; near 1.0 represents uniform spectral dispersion or complex multi-species soundscapes.',
  },
};

/**
 * Normalize raw bioacoustic indices onto a standard [0, 1] radar/fingerprint scale.
 */
export function normalizeSoundscapeIndices(indices: SoundscapeIndices): NormalizedIndexVector {
  const aciNorm = Math.min(1, Math.max(0, indices.aci / 250));
  const adiNorm = Math.min(1, Math.max(0, indices.adi / 3.0));
  const aeiNorm = Math.min(1, Math.max(0, indices.aei));
  const ndsiNorm = Math.min(1, Math.max(0, (indices.ndsi + 1) / 2));
  const entropyNorm = Math.min(1, Math.max(0, indices.spectralEntropy));

  return {
    aciNorm: Number(aciNorm.toFixed(3)),
    adiNorm: Number(adiNorm.toFixed(3)),
    aeiNorm: Number(aeiNorm.toFixed(3)),
    ndsiNorm: Number(ndsiNorm.toFixed(3)),
    entropyNorm: Number(entropyNorm.toFixed(3)),
  };
}

/**
 * Summarize acoustic energy and spectral shares by dominant source.
 */
export function computeSourceMetrics(bands: readonly FrequencyBandEnergy[]) {
  const result = {
    biophonyPct: 0,
    geophonyPct: 0,
    anthrophonyPct: 0,
    dominantSource: 'biophony' as FrequencyBandEnergy['dominantSource'],
    dominantBand: null as FrequencyBandEnergy | null,
    totalEnergyDb: -96,
  };

  if (!bands || bands.length === 0) return result;

  let bioSum = 0;
  let geoSum = 0;
  let anthroSum = 0;
  let totalShare = 0;
  let maxShare = -1;
  let maxBand: FrequencyBandEnergy | null = null;
  let sumLinear = 0;

  for (const b of bands) {
    const s = Math.max(0, b.relativeSharePct);
    totalShare += s;
    if (b.dominantSource === 'biophony') bioSum += s;
    else if (b.dominantSource === 'geophony') geoSum += s;
    else anthroSum += s;

    if (s > maxShare) {
      maxShare = s;
      maxBand = b;
    }

    sumLinear += Math.pow(10, b.energyDb / 10);
  }

  result.dominantBand = maxBand;
  if (totalShare > 0) {
    result.biophonyPct = Math.round((bioSum / totalShare) * 100);
    result.geophonyPct = Math.round((geoSum / totalShare) * 100);
    result.anthrophonyPct = Math.max(0, 100 - result.biophonyPct - result.geophonyPct);
  }

  if (result.biophonyPct >= result.geophonyPct && result.biophonyPct >= result.anthrophonyPct) {
    result.dominantSource = 'biophony';
  } else if (result.geophonyPct >= result.anthrophonyPct) {
    result.dominantSource = 'geophony';
  } else {
    result.dominantSource = 'anthrophony';
  }

  if (sumLinear > 0) {
    result.totalEnergyDb = Number((10 * Math.log10(sumLinear / bands.length)).toFixed(1));
  }

  return result;
}

/**
 * Compute aggregate statistics over temporal activity samples.
 */
export function computeTemporalStats(temporal: readonly TemporalActivityPoint[]) {
  if (!temporal || temporal.length === 0) {
    return {
      peakBiophony: null,
      peakAnthrophony: null,
      meanBiophony: 0,
      meanAnthrophony: 0,
      meanSplDb: -96,
      totalDetections: 0,
    };
  }

  let maxBioVal = -1;
  let maxBioPoint: TemporalActivityPoint | null = null;
  let maxAnthroVal = -1;
  let maxAnthroPoint: TemporalActivityPoint | null = null;
  let bioSum = 0;
  let anthroSum = 0;
  let detectionsSum = 0;
  let splSum = 0;

  for (const pt of temporal) {
    bioSum += pt.biophonyIndex;
    anthroSum += pt.anthrophonyIndex;
    detectionsSum += pt.detectionCount;
    splSum += pt.meanSplDb;

    if (pt.biophonyIndex > maxBioVal) {
      maxBioVal = pt.biophonyIndex;
      maxBioPoint = pt;
    }
    if (pt.anthrophonyIndex > maxAnthroVal) {
      maxAnthroVal = pt.anthrophonyIndex;
      maxAnthroPoint = pt;
    }
  }

  return {
    peakBiophony: maxBioPoint,
    peakAnthrophony: maxAnthroPoint,
    meanBiophony: Number((bioSum / temporal.length).toFixed(2)),
    meanAnthrophony: Number((anthroSum / temporal.length).toFixed(2)),
    meanSplDb: Number((splSum / temporal.length).toFixed(1)),
    totalDetections: detectionsSum,
  };
}

/**
 * Format structured JSON export for ecological research.
 */
export function formatSoundscapeExportJson(
  snapshot: SoundscapeSnapshot,
  exportedAtIso: string = new Date().toISOString()
): string {
  const norm = normalizeSoundscapeIndices(snapshot.indices);
  const sources = computeSourceMetrics(snapshot.frequencyBands);
  const temporal = computeTemporalStats(snapshot.temporalActivity);

  return JSON.stringify(
    {
      application: 'EcoSonic 3.0 Soundscape Observatory',
      siteName: snapshot.siteName,
      presetId: snapshot.presetId,
      exportedAtIso,
      containsCredentials: false,
      scientificIntegrityNotice:
        'Indices report individual empirical bioacoustic metrics. No composite ecosystem health grades are fabricated.',
      indices: {
        raw: snapshot.indices,
        normalized: norm,
        specifications: ACOUSTIC_INDEX_SPECS,
      },
      sourceComposition: sources,
      frequencyBands: snapshot.frequencyBands,
      temporalSummary: temporal,
      temporalActivity: snapshot.temporalActivity,
    },
    null,
    2
  );
}

/**
 * Format CSV export for spreadsheet and R/Python acoustic analysis.
 */
export function formatSoundscapeExportCsv(
  snapshot: SoundscapeSnapshot,
  exportedAtIso: string = new Date().toISOString()
): string {
  const lines: string[] = [];

  lines.push('# EcoSonic 3.0 Soundscape Analytics Export');
  lines.push(`# Site: ${snapshot.siteName}`);
  lines.push(`# Preset ID: ${snapshot.presetId}`);
  lines.push(`# Computed At: ${snapshot.indices.computedAtIso}`);
  lines.push(`# Exported At: ${exportedAtIso}`);
  lines.push('');

  // Section 1: Indices
  lines.push('### Core Acoustic Indices');
  lines.push('Metric,Acronym,Raw Value,Normalized (0-1),Scale,Reference');
  const norm = normalizeSoundscapeIndices(snapshot.indices);
  lines.push(`Acoustic Complexity Index,ACI,${snapshot.indices.aci},${norm.aciNorm},0-300+,"Pieretti et al. (2011)"`);
  lines.push(`Acoustic Diversity Index,ADI,${snapshot.indices.adi},${norm.adiNorm},0-3.5,"Villanueva-Rivera et al. (2011)"`);
  lines.push(`Acoustic Evenness Index,AEI,${snapshot.indices.aei},${norm.aeiNorm},0-1.0,"Villanueva-Rivera et al. (2011)"`);
  lines.push(`Normalized Difference Soundscape Index,NDSI,${snapshot.indices.ndsi},${norm.ndsiNorm},-1.0 to +1.0,"Kasten et al. (2012)"`);
  lines.push(`Spectral Shannon Entropy,H',${snapshot.indices.spectralEntropy},${norm.entropyNorm},0.0 to 1.0,"Sueur et al. (2008)"`);
  lines.push(`Mean Sound Pressure Level,SPL_dBFS,${snapshot.indices.meanLevelDbfs},N/A,dBFS,Relative reference`);
  lines.push('');

  // Section 2: Frequency Bands
  lines.push('### Frequency Band Energy');
  lines.push('Band Label,Frequency Range (Hz),Energy (dBFS),Relative Share (%),Dominant Source');
  for (const b of snapshot.frequencyBands) {
    lines.push(`"${b.bandLabel}","${b.rangeHz}",${b.energyDb},${b.relativeSharePct},${b.dominantSource}`);
  }
  lines.push('');

  // Section 3: Temporal Activity Points
  lines.push('### Temporal Activity Profile');
  lines.push('Interval Label,Timestamp (ISO),Biophony Index,Anthrophony Index,Detections,Mean SPL (dBFS)');
  for (const pt of snapshot.temporalActivity) {
    lines.push(`"${pt.timeLabel}","${pt.timestampIso}",${pt.biophonyIndex},${pt.anthrophonyIndex},${pt.detectionCount},${pt.meanSplDb}`);
  }

  return lines.join('\n');
}
