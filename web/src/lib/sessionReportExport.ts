import type {
  DisturbanceEvent,
  MonitoringSession,
  SpeciesDetection,
} from '../types/ecosonic';
import type { SessionNote } from './sessionNotesStorage';

export interface SessionReportExportOptions {
  includeLocalNotes?: boolean;
}

/**
 * Generates an RFC 4180 compliant CSV export covering the selected session's
 * metadata, associated species detections, and disturbance events.
 */
export function exportSessionToCsv(
  session: MonitoringSession,
  detections: readonly SpeciesDetection[],
  disturbances: readonly DisturbanceEvent[],
  notes: readonly SessionNote[] = [],
  options: SessionReportExportOptions = {}
): string {
  const escapeCell = (val: unknown): string => {
    if (val === null || val === undefined) return '""';
    const s = String(val);
    if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return `"${s}"`;
  };

  const lines: string[] = [];

  // Session Summary Section
  lines.push('--- ECOSONIC SESSION METADATA ---');
  lines.push('Session ID,Title,Site Name,Coordinates,Started At (UTC),Ended At (UTC),Duration (s),Status,Sample Rate (Hz)');
  lines.push(
    [
      escapeCell(session.id),
      escapeCell(session.title),
      escapeCell(session.siteName),
      escapeCell(session.coordinatesLabel),
      escapeCell(session.startedAtIso),
      escapeCell(session.endedAtIso || 'Active'),
      escapeCell(session.durationSec),
      escapeCell(session.status),
      escapeCell(session.sampleRateHz),
    ].join(',')
  );

  lines.push('');
  lines.push('--- SOUNDSCAPE INDICES ---');
  lines.push('Mean ACI,Mean NDSI,Mean Entropy,Dominant Band');
  lines.push(
    [
      escapeCell(session.soundscapeSummary.aciMean),
      escapeCell(session.soundscapeSummary.ndsiMean),
      escapeCell(session.soundscapeSummary.spectralEntropyMean),
      escapeCell(session.soundscapeSummary.dominantBandHz),
    ].join(',')
  );

  lines.push('');
  // Species Detections Section
  lines.push('--- SPECIES DETECTIONS ---');
  lines.push('Detection ID,Common Name,Scientific Name,Timestamp (UTC),Model Confidence Score,Duration (s),Freq Low (Hz),Freq High (Hz)');
  for (const d of detections) {
    lines.push(
      [
        escapeCell(d.id),
        escapeCell(d.commonName),
        escapeCell(d.scientificName),
        escapeCell(d.timestampIso),
        escapeCell(d.confidenceScore.toFixed(3)),
        escapeCell(d.durationSec),
        escapeCell(d.frequencyRangeHz[0]),
        escapeCell(d.frequencyRangeHz[1]),
      ].join(',')
    );
  }

  lines.push('');
  // Disturbances Section
  lines.push('--- DISTURBANCE EVENTS ---');
  lines.push('Event ID,Category,Label,Severity,Timestamp (UTC),Duration (s),Peak dBFS,Freq Low (Hz),Freq High (Hz),Model Score');
  for (const ev of disturbances) {
    lines.push(
      [
        escapeCell(ev.id),
        escapeCell(ev.category),
        escapeCell(ev.label),
        escapeCell(ev.severity),
        escapeCell(ev.timestampIso),
        escapeCell(ev.durationSec),
        escapeCell(ev.peakDbfs),
        escapeCell(ev.frequencyBandHz[0]),
        escapeCell(ev.frequencyBandHz[1]),
        escapeCell(ev.confidenceScore.toFixed(2)),
      ].join(',')
    );
  }

  if (options.includeLocalNotes && notes.length > 0) {
    lines.push('');
    lines.push('--- LOCAL RESEARCHER FIELD NOTES ---');
    lines.push('Note ID,Content,Created At (UTC),Updated At (UTC)');
    for (const n of notes) {
      lines.push(
        [
          escapeCell(n.id),
          escapeCell(n.content),
          escapeCell(n.createdAtIso),
          escapeCell(n.updatedAtIso),
        ].join(',')
      );
    }
  }

  return lines.join('\r\n');
}

/**
 * Generates structured JSON export for the selected session.
 */
export function exportSessionToJson(
  session: MonitoringSession,
  detections: readonly SpeciesDetection[],
  disturbances: readonly DisturbanceEvent[],
  notes: readonly SessionNote[] = [],
  options: SessionReportExportOptions = {}
): string {
  const payload = {
    reportType: 'EcoSonic Acoustic Session Report',
    exportedAtIso: new Date().toISOString(),
    provenanceNotice:
      'Observation records and acoustic indices reflect demo fixtures. Confidence scores represent raw classifier outputs and are not calibrated detection probabilities.',
    session: {
      id: session.id,
      title: session.title,
      siteName: session.siteName,
      coordinatesLabel: session.coordinatesLabel,
      startedAtIso: session.startedAtIso,
      endedAtIso: session.endedAtIso,
      durationSec: session.durationSec,
      status: session.status,
      sampleRateHz: session.sampleRateHz,
      speciesDetectionCount: detections.length,
      disturbanceEventCount: disturbances.length,
      soundscapeSummary: session.soundscapeSummary,
      fieldNotes: session.notes,
    },
    speciesDetections: detections.map((d) => ({
      id: d.id,
      commonName: d.commonName,
      scientificName: d.scientificName,
      timestampIso: d.timestampIso,
      confidenceScore: d.confidenceScore,
      durationSec: d.durationSec,
      frequencyRangeHz: d.frequencyRangeHz,
      habitatPreset: d.habitatPreset,
    })),
    disturbanceEvents: disturbances.map((ev) => ({
      id: ev.id,
      category: ev.category,
      label: ev.label,
      description: ev.description,
      severity: ev.severity,
      timestampIso: ev.timestampIso,
      durationSec: ev.durationSec,
      peakDbfs: ev.peakDbfs,
      frequencyBandHz: ev.frequencyBandHz,
      confidenceScore: ev.confidenceScore,
    })),
    localResearcherNotes: options.includeLocalNotes ? notes : undefined,
  };

  return JSON.stringify(payload, null, 2);
}
