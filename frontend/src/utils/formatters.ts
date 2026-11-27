export function formatSeconds(seconds?: number): string {
  if (seconds === undefined || seconds === null || isNaN(seconds)) return '00:00';
  const mins = Math.floor(seconds / 60);
  const remainingSecs = seconds % 60;
  const secs = Math.floor(remainingSecs);
  const ms = Math.round((remainingSecs - secs) * 10) % 10;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`;
}

export function formatTimeRange(start: number, end: number): string {
  return `${formatSeconds(start)} — ${formatSeconds(end)}`;
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function formatModelScore(score?: number | null): string {
  if (score === undefined || score === null || !Number.isFinite(score)) return '—';
  return score.toFixed(2);
}

export function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

export function formatCoordinates(lat?: number | null, lon?: number | null): string {
  if (lat === undefined || lon === undefined || lat === null || lon === null) return 'No GPS data';
  const latStr = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}`;
  const lonStr = `${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;
  return `${latStr}, ${lonStr}`;
}
