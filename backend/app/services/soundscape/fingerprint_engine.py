"""Soundscape Fingerprint Engine computing scientific ecoacoustic indices and frequency distributions.

References:
- Pieretti, N., Farina, A., & Morri, D. (2011). A new methodology to infer the singing activity
  of an avian community: The Acoustic Complexity Index (ACI). Ecological Indicators, 11(3), 868-873.
- Villanueva-Rivera, L. J., Pijanowski, B. C., Doucette, J., & Pekin, B. (2011). A primer of
  acoustic diversity for landscape ecologists. Landscape Ecology, 26(9), 1233-1246.
- Gasc, A., Sueur, J., Pavoine, S., Pellens, R., & Grandcolas, P. (2013). Biodiversity sampling
  using acoustic indices: do they reflect species richness? Ecological Indicators, 25, 279-287.
- Kasten, E. P., Gage, S. H., Fox, J., & Joo, W. (2012). The normalized difference soundscape
  index (NDSI): A novel method to evaluate differences in soundscape composition.
  Ecological Indicators, 17, 78-87.
- Towsey, M., Wimmer, J., Williamson, I., & Roe, P. (2014). The use of acoustic indices to
  determine wildlife activity and diversity in environmental audio recordings.
  Ecological Informatics, 21, 110-125.
"""

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


# Default standard 5-band ecological partition (0 Hz to Nyquist at 32 kHz = 16 kHz)
DEFAULT_ECOLOGICAL_BANDS: Dict[str, Tuple[float, float]] = {
    "infrasound_low_anthro_pct": (0.0, 1000.0),
    "mid_anthro_low_bio_pct": (1000.0, 2000.0),
    "core_biophony_pct": (2000.0, 8000.0),
    "high_biophony_insects_pct": (8000.0, 14000.0),
    "ultrasonic_high_pct": (14000.0, 16000.0),
}


@dataclass
class SoundscapeConfig:
    """Scientific configuration parameters for the Soundscape Fingerprint Engine.

    Scientific Justifications:
    - sample_rate (32000 Hz): Aligns with BirdNET V3.0 native sampling rate (Nyquist: 16 kHz).
    - n_fft (1024): At 32 kHz, delta_f = 31.25 Hz with a 32 ms window. Strikes an optimal
      trade-off between spectral resolution for harmonic separation and temporal precision.
    - hop_length (512): 50% overlap (noverlap=512) satisfying the Constant Overlap-Add (COLA)
      condition for Hann windowing, suppressing spectral leakage without redundant computation.
    - window_function ('hann'): Cosine bell minimizing sidelobe leakage (-31.5 dB) while
      preserving frequency accuracy.
    - flim_bio (2000, 8000 Hz): Core biophonic band for avian, amphibian, and mammalian vocalizations.
    - flim_anthro (1000, 2000 Hz): Dominant structured anthropophonic engine, vehicle, and mechanical noise.
      Sub-1000 Hz is excluded to prevent low-frequency wind turbulence from contaminating anthrophony.
    - analysis_duration_s (60.0 s): Ecoacoustic indices require long stationarity windows to capture
      song bouts and ambient intervals. Shorter durations (5-60s) are supported with quality flags.
    - min_analysis_duration_s (5.0 s): Minimum threshold for statistically meaningful spectrogram statistics.
    """

    sample_rate: int = 32000
    n_fft: int = 1024
    hop_length: int = 512
    window_function: str = "hann"
    flim_bio: Tuple[int, int] = (2000, 8000)
    flim_anthro: Tuple[int, int] = (1000, 2000)
    analysis_duration_s: float = 60.0
    min_analysis_duration_s: float = 5.0
    silence_threshold_rms: float = 1e-4
    clipping_threshold: float = 0.999
    zero_variance_threshold: float = 1e-9
    adi_bin_step: int = 1000
    adi_db_threshold: float = -50.0
    aei_bin_step: int = 500
    aei_db_threshold: float = -50.0
    temporal_db_threshold: float = 3.0
    custom_frequency_bands: Optional[Dict[str, Tuple[float, float]]] = None


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

    @property
    def hop_length(self) -> int:
        return int(self.config.hop_length)

    @property
    def window_function(self) -> str:
        return str(self.config.window_function)

    @property
    def frequency_resolution_hz(self) -> float:
        return round(float(self.config.sample_rate) / float(self.config.n_fft), 2)

    @property
    def analysis_duration_s(self) -> float:
        return float(self.config.analysis_duration_s)

    def validate_audio_input(
        self, samples: Any, sample_rate: int
    ) -> np.ndarray:
        """Validate input audio array and sample rate.

        Raises:
            ValueError: If sample_rate is invalid, samples is None/empty, or contains NaN/Inf.
        """
        if not isinstance(sample_rate, (int, np.integer)) or sample_rate <= 0:
            raise ValueError(f"Invalid sample_rate: {sample_rate}. Must be a positive integer.")

        if samples is None:
            raise ValueError("Input audio samples cannot be None.")

        if not isinstance(samples, np.ndarray):
            try:
                samples = np.asarray(samples, dtype=np.float32)
            except Exception as exc:
                raise ValueError(f"Failed to convert audio input to NumPy array: {exc}") from exc

        if samples.size == 0:
            raise ValueError("Input audio sample array is empty. Minimum duration required.")

        if not np.all(np.isfinite(samples)):
            raise ValueError("Input audio sample array contains non-finite values (NaN or Inf).")

        # Convert multi-channel audio to mono
        if samples.ndim > 1:
            samples = np.mean(samples, axis=1)

        return samples.astype(np.float32)

    def analyze_audio_segment(
        self,
        samples: np.ndarray,
        sample_rate: int = 32000,
        start_seconds: float = 0.0,
        session_id: str = "default",
    ) -> SoundscapeFingerprintResponse:
        """Compute the complete Soundscape Fingerprint from an audio sample array.

        Performs strict input validation, quality screening, spectrogram generation,
        and computes ACI, ADI, AEI, NDSI, Spectral Shannon Entropy, Temporal Activity,
        and Frequency-Band Energy Distribution.
        """
        # 1. Strict input validation
        samples = self.validate_audio_input(samples, sample_rate)

        quality_flags: List[str] = []
        duration_s = len(samples) / sample_rate
        end_seconds = round(start_seconds + duration_s, 2)

        # Document calculation parameters
        calc_params: Dict[str, Any] = {
            "sample_rate": sample_rate,
            "n_fft": self.config.n_fft,
            "hop_length": self.config.hop_length,
            "window_function": self.config.window_function,
            "frequency_resolution_hz": self.frequency_resolution_hz,
            "temporal_resolution_s": round(self.config.hop_length / sample_rate, 4),
            "flim_bio": list(self.config.flim_bio),
            "flim_anthro": list(self.config.flim_anthro),
            "bio_band_hz": [float(self.config.flim_bio[0]), float(self.config.flim_bio[1])],
            "anthro_band_hz": [float(self.config.flim_anthro[0]), float(self.config.flim_anthro[1])],
            "duration_seconds": round(duration_s, 2),
            "target_analysis_duration_s": self.config.analysis_duration_s,
            "is_partial_window": duration_s < self.config.analysis_duration_s,
            "ndsi_assumptions": {
                "bio_band_hz": list(self.config.flim_bio),
                "anthro_band_hz": list(self.config.flim_anthro),
                "valid_energy_threshold": 1e-12,
                "scientific_disclaimer": "NDSI measures relative spectral energy distribution, not ecosystem health.",
            },
            "maad_version": getattr(maad, "__version__", "unavailable") if maad else "unavailable",
        }

        # 2. Audio quality assessment & sanity checks
        rms = float(np.sqrt(np.mean(samples**2)))
        calc_params["rms_energy"] = round(rms, 6)

        if rms < self.config.silence_threshold_rms:
            quality_flags.append("silent_window")

        # Zero-variance detection (e.g. flatline / constant DC signal)
        variance = float(np.var(samples))
        calc_params["sample_variance"] = round(variance, 8)
        if variance <= self.config.zero_variance_threshold:
            quality_flags.append("zero_variance_detected")

        # Digital clipping check
        clip_ratio = float(np.mean(np.abs(samples) >= self.config.clipping_threshold))
        if clip_ratio > 0.05:
            quality_flags.append("clipping_detected")

        # Window duration checks
        if duration_s < self.config.min_analysis_duration_s:
            quality_flags.append("insufficient_duration")
        elif duration_s < self.config.analysis_duration_s:
            quality_flags.append("incomplete_window")

        # Empty bands template for early exit
        empty_bands = {name: 0.0 for name in (self.config.custom_frequency_bands or DEFAULT_ECOLOGICAL_BANDS)}

        # If audio is silent, dead flatline (zero variance), or insufficient duration, return quality-flagged response
        if (
            "silent_window" in quality_flags
            or "zero_variance_detected" in quality_flags
            or "insufficient_duration" in quality_flags
        ):
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
                frequency_bands=empty_bands,
                calculation_parameters=calc_params,
                quality_flags=quality_flags,
            )

        # 3. Compute spectrograms via scikit-maad
        noverlap = self.config.n_fft - self.config.hop_length
        if noverlap < 0:
            noverlap = self.config.n_fft // 2

        try:
            Sxx_power, tn, fn, _ = ms.spectrogram(
                samples,
                sample_rate,
                window=self.config.window_function,
                nperseg=self.config.n_fft,
                noverlap=noverlap,
                mode="psd",
            )
            Sxx_ampl, _, _, _ = ms.spectrogram(
                samples,
                sample_rate,
                window=self.config.window_function,
                nperseg=self.config.n_fft,
                noverlap=noverlap,
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
                frequency_bands=empty_bands,
                calculation_parameters=calc_params,
                quality_flags=quality_flags,
            )

        # 4. Compute Acoustic Complexity Index (ACI)
        # Pieretti et al. (2011): Direct intensity variations across temporal frames within each frequency bin.
        # Computed using amplitude spectrogram Sxx_ampl.
        try:
            _, _, aci_val = mf.acoustic_complexity_index(Sxx_ampl)
            aci_val = float(aci_val) if np.isfinite(aci_val) else None
        except Exception as exc:
            logger.warning("ACI calculation failed: %s", exc)
            aci_val = None

        # 5. Compute Acoustic Diversity Index (ADI)
        # Villanueva-Rivera et al. (2011): Shannon diversity across frequency bands.
        fmax_eval = min(20000, int(sample_rate / 2))
        try:
            adi_val = float(
                mf.acoustic_diversity_index(
                    Sxx_power,
                    fn,
                    fmin=0,
                    fmax=fmax_eval,
                    bin_step=self.config.adi_bin_step,
                    dB_threshold=self.config.adi_db_threshold,
                    index="shannon",
                )
            )
            if not np.isfinite(adi_val):
                adi_val = None
        except Exception as exc:
            logger.warning("ADI calculation failed: %s", exc)
            adi_val = None

        # 6. Compute Acoustic Evenness Index (AEI)
        # Gasc et al. (2013): Gini index across frequency bands (0 = perfectly even, 1 = concentrated).
        try:
            aei_val = float(
                mf.acoustic_eveness_index(
                    Sxx_power,
                    fn,
                    fmin=0,
                    fmax=fmax_eval,
                    bin_step=self.config.aei_bin_step,
                    dB_threshold=self.config.aei_db_threshold,
                )
            )
            if not np.isfinite(aei_val):
                aei_val = None
        except Exception as exc:
            logger.warning("AEI calculation failed: %s", exc)
            aei_val = None

        # 7. Compute Normalized Difference Soundscape Index (NDSI)
        # Kasten et al. (2012): (bio - anthro) / (bio + anthro)
        try:
            ndsi_res, ratio_ba, anthro_e, bio_e = mf.soundscape_index(
                Sxx_power,
                fn,
                flim_bioPh=self.config.flim_bio,
                flim_antroPh=self.config.flim_anthro,
            )
            ndsi_val = float(ndsi_res)
            # If total biophony + anthropophony energy is negligible, NDSI assumption is violated
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
        # Shannon entropy of average power spectrum: H = -sum(p * log2(p)) / log2(N_bins)
        # Yields ~1.0 for flat white noise, ~0.0 for pure sinusoid tone.
        try:
            mean_spectrum = np.mean(Sxx_power, axis=1)
            total_spec_energy = np.sum(mean_spectrum)
            if total_spec_energy > 0:
                p_norm = mean_spectrum / total_spec_energy
                p_nz = p_norm[p_norm > 0]
                shannon_h = float(-np.sum(p_nz * np.log2(p_nz)) / np.log2(len(p_norm)))
            else:
                shannon_h = 0.0

            spectral_ent = shannon_h

            # Also compute Towsey EAS index from scikit-maad for scientific completeness
            eas, ecu, ecv, eps, _, _ = mf.spectral_entropy(Sxx_power, fn)
            calc_params["entropy_average_spectrum_eas"] = round(float(eas), 4) if np.isfinite(eas) else None
        except Exception as exc:
            logger.warning("Spectral entropy calculation failed: %s", exc)
            spectral_ent = None

        # 9. Compute Temporal Acoustic Activity
        # Towsey et al. (2014) / scikit-maad temporal activity exceeding dB threshold
        try:
            act_fraction, act_count, act_mean = mf.temporal_activity(
                samples, dB_threshold=self.config.temporal_db_threshold
            )
            act_fraction = float(act_fraction) if np.isfinite(act_fraction) else 0.0
            calc_params["temporal_activity_events_count"] = int(act_count)
            calc_params["temporal_activity_mean_db"] = round(float(act_mean), 2) if np.isfinite(act_mean) else None
        except Exception as exc:
            logger.warning("Temporal activity calculation failed: %s", exc)
            act_fraction = None

        # 10. Frequency-Band Energy Distribution
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
        """Compute percentage energy distribution across configured ecological frequency bands."""
        bands = self.config.custom_frequency_bands or DEFAULT_ECOLOGICAL_BANDS

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
