import { describe, it, expect } from 'vitest';
import {
  formatSeconds,
  formatTimeRange,
  formatBytes,
  formatConfidence,
  formatCoordinates,
} from '../utils/formatters';

describe('Formatters', () => {
  it('formats seconds into MM:SS.s correctly', () => {
    expect(formatSeconds(0)).toBe('00:00.0');
    expect(formatSeconds(45.2)).toBe('00:45.2');
    expect(formatSeconds(125.8)).toBe('02:05.8');
    expect(formatSeconds(undefined)).toBe('00:00');
  });

  it('formats time ranges correctly', () => {
    expect(formatTimeRange(3.0, 6.0)).toBe('00:03.0 — 00:06.0');
  });

  it('formats bytes into human readable sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1048576 * 2.5)).toBe('2.5 MB');
  });

  it('formats confidence scores as percentages', () => {
    expect(formatConfidence(0.8742)).toBe('87.4%');
    expect(formatConfidence(1.0)).toBe('100.0%');
    expect(formatConfidence(undefined)).toBe('0%');
  });

  it('formats coordinates into geographic strings', () => {
    expect(formatCoordinates(51.5074, -0.1278)).toBe('51.5074° N, 0.1278° W');
    expect(formatCoordinates(-24.01, 31.48)).toBe('24.0100° S, 31.4800° E');
    expect(formatCoordinates(undefined, undefined)).toBe('No GPS data');
  });
});
