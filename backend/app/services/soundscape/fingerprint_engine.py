"""Soundscape Fingerprint Engine computing ecoacoustic indices and frequency distributions."""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import scipy.signal

try:
    import maad
    import maad.features as mf
    import maad.sound as ms
except ImportError:
    maad = None  # type: ignore[assignment]
    mf = None  # type: ignore[assignment]
    ms = None  # type: ignore[assignment]

from app.schemas.soundscape import SoundscapeFingerprintResponse, SoundscapeMetrics

logger = logging.getLogger(__name__)


@dataclass
class SoundscapeConfig:
    sample_rate: int = 32000
    n_fft: int = 1024
    hop_length: int = 512
    flim_bio: Tuple[int, int] = (2000, 8000)
    flim_anthro: Tuple[int, int] = (1000, 2000)
    min_analysis_duration_s: float = 5.0
    silence_threshold_rms: float = 1e-4
    clipping_threshold: float = 0.999


class SoundscapeFingerprintEngine:
    """Scientific ecoacoustic index computation based on scikit-maad and signal processing."""

    def __init__(self, config: Optional[SoundscapeConfig] = None) -> None:
        self.config = config or SoundscapeConfig()

    @property
    def bio_min_hz(self) -> float:
        return float(self.config.flim_bio[0])

    @property
    def bio_max_hz(self) -> float:
        return float(self.config.flim_bio[1])

    @property
    def anthro_min_hz(self) -> float:
        return float(self.config.flim_anthro[0])

    @property
    def anthro_max_hz(self) -> float:
        return float(self.config.flim_anthro[1])

    @property
    def n_fft(self) -> int:
        return int(self.config.n_fft)

    def analyze_audio_segment(
        self,
        samples: np.ndarray,
        sample_rate: int = 32000,
        start_seconds: float = 0.0,
        session_id: str = "default",
    ) -> SoundscapeFingerprintResponse:
        """Compute the complete Soundscape Fingerprint from an audio sample array."""
        quality_flags: List[str] = []
        duration_s = len(samples) / sample_rate
        end_seconds = round(start_seconds + duration_s, 2)

        calc_params = {
            "sample_rate": sample_rate,
            "n_fft": self.config.n_fft,
            "hop_length": self.config.hop_length,
            "flim_bio": list(self.config.flim_bio),
            "flim_anthro": list(self.config.flim_anthro),
            "bio_band_hz": [float(self.config.flim_bio[0]), float(self.config.flim_bio[1])],
            "anthro_band_hz": [float(self.config.flim_anthro[0]), float(self.config.flim_anthro[1])],
            "duration_seconds": round(duration_s, 2),
            "maad_version": getattr(maad, "__version__", "unavailable") if maad else "unavailable",
        }

        # 1. Basic validation
        if samples.ndim > 1:
            samples = np.mean(samples, axis=1)

        if len(samples) == 0:
            quality_flags.append("empty_audio")
            return SoundscapeFingerprintResponse(
                session_id=session_id,
                window_start_seconds=start_seconds,
                window_end_seconds=end_seconds,
                metrics=SoundscapeMetrics(),
                frequency_bands={},
                calculation_parameters=calc_params,
                quality_flags=quality_flags,
            )

        if not np.isfinite(samples).all():
            quality_flags.append("non_finite_samples_rejected")
            return SoundscapeFingerprintResponse(
                session_id=session_id,
                window_start_seconds=start_seconds,
                window_end_seconds=end_seconds,
                metrics=SoundscapeMetrics(),
                frequency_bands={},
                calculation_parameters=calc_params,
                quality_flags=quality_flags,
            )

        # 2. Audio quality assessment
        rms = float(np.sqrt(np.mean(samples**2)))
        calc_params["rms_energy"] = round(rms, 6)

        if rms < self.config.silence_threshold_rms:
            quality_flags.append("silent_window")

        clip_ratio = float(np.mean(np.abs(samples) >= self.config.clipping_threshold))
        if clip_ratio > 0.05:
            quality_flags.append("clipping_detected")

        if duration_s < self.config.min_analysis_duration_s:
            quality_flags.append("insufficient_duration")

        # If audio is silent or insufficient, return gracefully with quality flags
        if "silent_window" in quality_flags or "insufficient_duration" in quality_flags:
            return SoundscapeFingerprintResponse(
                session_id=session_id,
                window_start_seconds=start_seconds,
                window_end_seconds=end_seconds,
                metrics=SoundscapeMetrics(
                    aci=0.0,
                    adi=0.0,
                    aei=1.0,
                    ndsi=None,  # NDSI undefined when no acoustic energy present
                    spectral_entropy=0.0,
                    temporal_activity=0.0,
                ),
                frequency_bands={
                    "infrasound_low_anthro_pct": 0.0,
                    "mid_anthro_low_bio_pct": 0.0,
                    "core_biophony_pct": 0.0,
                    "high_biophony_insects_pct": 0.0,
                    "ultrasonic_high_pct": 0.0,
                },
                calculation_parameters=calc_params,
                quality_flags=quality_flags,
            )

        # 3. Compute spectrograms via scikit-maad
        try:
            Sxx_power, tn, fn, _ = ms.spectrogram(
                samples,
                sample_rate,
                nperseg=self.config.n_fft,
                noverlap=self.config.hop_length,
                mode="psd",
            )
            Sxx_ampl, _, _, _ = ms.spectrogram(
                samples,
                sample_rate,
                nperseg=self.config.n_fft,
                noverlap=self.config.hop_length,
                mode="amplitude",
            )
        except Exception as exc:
            logger.error("Spectrogram computation failed: %s", exc)
            quality_flags.append(f"spectrogram_error: {exc}")
            return SoundscapeFingerprintResponse(
                session_id=session_id,
                window_start_seconds=start_seconds,
                window_end_seconds=end_seconds,
                metrics=SoundscapeMetrics(),
                frequency_bands={},
                calculation_parameters=calc_params,
                quality_flags=quality_flags,
            )

        # 4. Compute Acoustic Complexity Index (ACI)
        # ACI measures the absolute difference between adjacent intensity values across frequency bins
        try:
            _, _, aci_val = mf.acoustic_complexity_index(Sxx_ampl)
            aci_val = float(aci_val) if np.isfinite(aci_val) else None
        except Exception as exc:
            logger.warning("ACI calculation failed: %s", exc)
            aci_val = None

        # 5. Compute Acoustic Diversity Index (ADI)
        # Shannon diversity of proportion of energy across 1 kHz frequency bands
        try:
            adi_val = float(mf.acoustic_diversity_index(Sxx_power, fn))
            if not np.isfinite(adi_val):
                adi_val = None
        except Exception as exc:
            logger.warning("ADI calculation failed: %s", exc)
            adi_val = None

        # 6. Compute Acoustic Evenness Index (AEI)
        # Gini evenness across 1 kHz frequency bands (0 = perfectly even, 1 = concentrated in few bands)
        try:
            aei_val = float(mf.acoustic_eveness_index(Sxx_power, fn))
            if not np.isfinite(aei_val):
                aei_val = None
        except Exception as exc:
            logger.warning("AEI calculation failed: %s", exc)
            aei_val = None

        # 7. Compute Normalized Difference Soundscape Index (NDSI)
        # Formula: (bio - anthro) / (bio + anthro)
        # Assumes anthro in flim_anthro (default 0-1kHz) and bio in flim_bio (default 1-10kHz)
        try:
            ndsi_res, ratio_ba, anthro_e, bio_e = mf.soundscape_index(
                Sxx_power,
                fn,
                flim_bioPh=self.config.flim_bio,
                flim_antroPh=self.config.flim_anthro,
            )
            ndsi_val = float(ndsi_res)
            # If total bio+anthro energy is negligible, NDSI assumption is violated
            if (anthro_e + bio_e) < 1e-12 or not np.isfinite(ndsi_val):
                ndsi_val = None
                quality_flags.append("ndsi_energy_too_low")
            else:
                ndsi_val = max(-1.0, min(1.0, ndsi_val))
                calc_params["biophony_energy"] = float(bio_e)
                calc_params["anthropophony_energy"] = float(anthro_e)
                calc_params["bio_anthro_ratio"] = float(ratio_ba) if np.isfinite(ratio_ba) else None
        except Exception as exc:
            logger.warning("NDSI calculation failed: %s", exc)
            ndsi_val = None

        # 8. Compute Spectral Shannon Entropy
        try:
            # Normalized Shannon entropy across the average power spectrum: H = -sum(p * log2(p)) / log2(N)
            mean_spectrum = np.mean(Sxx_power, axis=1)
            total_spec_energy = np.sum(mean_spectrum)
            if total_spec_energy > 0:
                p_norm = mean_spectrum / total_spec_energy
                p_nz = p_norm[p_norm > 0]
                shannon_h = float(-np.sum(p_nz * np.log2(p_nz)) / np.log2(len(p_norm)))
            else:
                shannon_h = 0.0

            spectral_ent = shannon_h

            # Also compute Towsey EAS index from scikit-maad
            eas, ecu, ecv, eps, _, _ = mf.spectral_entropy(Sxx_power, fn)
            calc_params["entropy_average_spectrum_eas"] = round(float(eas), 4) if np.isfinite(eas) else None
        except Exception as exc:
            logger.warning("Spectral entropy calculation failed: %s", exc)
            spectral_ent = None

        # 9. Compute Temporal Acoustic Activity
        try:
            act_fraction, act_count, act_mean = mf.temporal_activity(samples, dB_threshold=3)
            act_fraction = float(act_fraction) if np.isfinite(act_fraction) else 0.0
            calc_params["temporal_activity_events_count"] = int(act_count)
            calc_params["temporal_activity_mean_db"] = round(float(act_mean), 2) if np.isfinite(act_mean) else None
        except Exception as exc:
            logger.warning("Temporal activity calculation failed: %s", exc)
            act_fraction = None

        # 10. Frequency-Band Energy Distribution
        # Energy across 5 ecological sub-bands
        band_distribution = self._compute_frequency_bands(Sxx_power, fn)

        metrics = SoundscapeMetrics(
            aci=round(aci_val, 2) if aci_val is not None else None,
            adi=round(adi_val, 4) if adi_val is not None else None,
            aei=round(aei_val, 4) if aei_val is not None else None,
            ndsi=round(ndsi_val, 4) if ndsi_val is not None else None,
            spectral_entropy=round(spectral_ent, 4) if spectral_ent is not None else None,
            temporal_activity=round(act_fraction, 4) if act_fraction is not None else None,
        )

        return SoundscapeFingerprintResponse(
            session_id=session_id,
            window_start_seconds=round(start_seconds, 2),
            window_end_seconds=round(end_seconds, 2),
            metrics=metrics,
            frequency_bands=band_distribution,
            calculation_parameters=calc_params,
            quality_flags=quality_flags,
        )

    def _compute_frequency_bands(
        self, Sxx_power: np.ndarray, fn: np.ndarray
    ) -> Dict[str, float]:
        """Compute percentage energy distribution across standard ecological frequency bands."""
        bands = {
            "infrasound_low_anthro_pct": (0, 1000),
            "mid_anthro_low_bio_pct": (1000, 2000),
            "core_biophony_pct": (2000, 8000),
            "high_biophony_insects_pct": (8000, 14000),
            "ultrasonic_high_pct": (14000, 16000),
        }

        band_energies: Dict[str, float] = {}
        total_energy = float(np.sum(Sxx_power))

        if total_energy <= 0 or not np.isfinite(total_energy):
            return {name: 0.0 for name in bands}

        for name, (fmin, fmax) in bands.items():
            mask = (fn >= fmin) & (fn < fmax)
            if np.any(mask):
                e = float(np.sum(Sxx_power[mask, :]))
                band_energies[name] = round((e / total_energy) * 100.0, 2)
            else:
                band_energies[name] = 0.0

        return band_energies


soundscape_engine = SoundscapeFingerprintEngine()
