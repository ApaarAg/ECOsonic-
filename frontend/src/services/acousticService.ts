import { apiClient, API_BASE_URL } from './api';
import { AcousticInspection } from '../types';

export const acousticService = {
  /**
   * Inspect audio physical characteristics, sample rate, channels, RMS
   */
  async inspectAcoustic(analysisId: string): Promise<AcousticInspection> {
    const response = await apiClient.get<AcousticInspection>(`/acoustic/inspect/${analysisId}`);
    return response.data;
  },

  /**
   * Returns streaming URL for the normalized 16-bit PCM Mono WAV audio
   */
  getAudioStreamUrl(analysisId: string): string {
    return `${API_BASE_URL}/acoustic/stream/${analysisId}`;
  },
};
