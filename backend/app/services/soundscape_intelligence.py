"""EcoSonic Advanced Ecoacoustic Soundscape Intelligence Service.

Computes interpretable, scientifically grounded ecoacoustic indices using scikit-maad:
- Acoustic Complexity Index (ACI) [Pieretti et al., 2011]
- Acoustic Diversity Index (ADI) [Villanueva-Rivera et al., 2011]
- Acoustic Evenness Index (AEI) [Villanueva-Rivera et al., 2011]
- Normalized Difference Soundscape Index (NDSI) [Kasten et al., 2012]
- Spectral Shannon Entropy [Sueur et al., 2008]
- Temporal Acoustic Activity & Envelope Dynamics [Towsey et al., 2014]
- Multi-window temporal trend and historical soundscape drift analysis.

Scientific Guardrails:
1. Diversity indices (ADI/AEI) reflect acoustic frequency occupancy, NOT direct biological species richness.
2. NDSI strictly separates anthropogenic mechanical noise (1-2 kHz) from core biophony (2-8 kHz).
   Sub-1000 Hz is isolated to avoid wind turbulence and sensor noise bias.
3. No arbitrary "ecosystem health score" is synthesized; indices are presented with exact calculation parameters.
"""

from __future__ import annotations

import logging
import math
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np

from app.schemas.soundscape import SoundscapeFingerprintResponse, SoundscapeMetrics
from app.services.soundscape.fingerprint_engine import (
    DEFAULT_ECOLOGICAL_BANDS,
    LEGACY_BAND_ALIASES,
    SoundscapeConfig,
    SoundscapeFingerprintEngine,
)

logger = logging.getLogger(__name__)

SCIENTIFIC_SOUNDSCAPE_DISCLAIMER = (
    "Ecoacoustic indices quantify macroscopic acoustic energy distributions across time and frequency. "
    "They do NOT provide direct censuses of biological species richness or individual vocalization counts."
)


@dataclass
class SoundscapeMeasurement:
    """Interpretable ecoacoustic measurement for an acoustic analysis window."""

    measurement_id: str
    session_id: Optional[str]
    start_seconds: float
    end_seconds: float
    duration_seconds: float
    metrics: Dict[str, Optional[float]]
    frequency_bands: Dict[str, float]
    calculation_parameters: Dict[str, Any]
    quality_flags: List[str]
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    disclaimer: str = SCIENTIFIC_SOUNDSCAPE_DISCLAIMER

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class SoundscapeTrendSummary:
    """Multi-window soundscape statistics and temporal evolution."""

    session_id: Optional[str]
    window_count: int
    total_duration_seconds: float
    mean_metrics: Dict[str, Optional[float]]
    variance_metrics: Dict[str, Optional[float]]
    trend_deltas: Dict[str, Optional[float]]  # Final window minus first window
    dominant_frequency_band: str
    temporal_stability_index: float  # 1.0 - mean coefficient of variation across stable indices
    quality_flags: List[str]
    measurements: List[SoundscapeMeasurement]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "window_count": self.window_count,
            "total_duration_seconds": self.total_duration_seconds,
            "mean_metrics": self.mean_metrics,
            "variance_metrics": self.variance_metrics,
            "trend_deltas": self.trend_deltas,
            "dominant_frequency_band": self.dominant_frequency_band,
            "temporal_stability_index": self.temporal_stability_index,
            "quality_flags": self.quality_flags,
            "measurements_count": len(self.measurements),
        }


@dataclass
class SoundscapeHistoricalComparison:
    """Comparative analysis between two soundscape measurements or monitoring sessions."""

    baseline_id: str
    target_id: str
    metric_deltas: Dict[str, float]
    metric_pct_changes: Dict[str, Optional[float]]
    band_energy_shifts: Dict[str, float]
    biophony_shift_description: str
    anthropophony_shift_description: str
    complexity_shift_description: str
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class SoundscapeIntelligenceService:
    """Production ecoacoustic intelligence service wrapping scikit-maad and multi-window modeling."""

    def __init__(self, config: Optional[SoundscapeConfig] = None) -> None:
        self.config = config or SoundscapeConfig()
        self.engine = SoundscapeFingerprintEngine(self.config)

    def analyze_audio_window(
        self,
        audio: np.ndarray,
        sample_rate: int = 32000,
        start_seconds: float = 0.0,
        end_seconds: Optional[float] = None,
        session_id: Optional[str] = None,
    ) -> SoundscapeMeasurement:
        """Compute comprehensive ecoacoustic indices on a single continuous audio window.

        Args:
            audio: 1D numpy array of audio samples.
            sample_rate: Audio sampling frequency in Hz (default: 32,000 Hz).
            start_seconds: Window onset relative to session or recording start.
            end_seconds: Window end relative to session. If None, computed from sample count.
            session_id: Associated monitoring session UUID.

        Returns:
            SoundscapeMeasurement with validated metrics, parameters, and quality flags.
        """
        if end_seconds is None:
            end_seconds = start_seconds + (len(audio) / max(1, sample_rate))

        # Check sample rate consistency
        if sample_rate != self.config.sample_rate:
            # Dynamically adapt or flag
            pass

        # Compute using scientific fingerprint engine
        fp_resp = self.engine.analyze_audio_segment(
            samples=audio,
            sample_rate=sample_rate,
            start_seconds=start_seconds,
            session_id=session_id or "adhoc_session",
        )

        metrics_dict: Dict[str, Optional[float]] = {
            "aci": fp_resp.metrics.aci,
            "adi": fp_resp.metrics.adi,
            "aei": fp_resp.metrics.aei,
            "ndsi": fp_resp.metrics.ndsi,
            "spectral_entropy": fp_resp.metrics.spectral_entropy,
            "temporal_activity": fp_resp.metrics.temporal_activity,
        }

        # Sanitize for NaN and Inf
        sanitized_metrics: Dict[str, Optional[float]] = {}
        quality_flags = list(fp_resp.quality_flags)

        for k, v in metrics_dict.items():
            if v is None or math.isnan(v) or math.isinf(v):
                sanitized_metrics[k] = None
                if v is not None and (math.isnan(v) or math.isinf(v)):
                    quality_flags.append(f"non_finite_{k}")
            else:
                sanitized_metrics[k] = round(float(v), 6)

        # Sanitize frequency bands
        sanitized_bands: Dict[str, float] = {}
        for b_name, b_val in fp_resp.frequency_bands.items():
            if math.isnan(b_val) or math.isinf(b_val):
                sanitized_bands[b_name] = 0.0
            else:
                sanitized_bands[b_name] = round(float(b_val), 6)

        return SoundscapeMeasurement(
            measurement_id=str(uuid.uuid4()),
            session_id=session_id,
            start_seconds=round(start_seconds, 3),
            end_seconds=round(end_seconds, 3),
            duration_seconds=round(end_seconds - start_seconds, 3),
            metrics=sanitized_metrics,
            frequency_bands=sanitized_bands,
            calculation_parameters=fp_resp.calculation_parameters,
            quality_flags=sorted(list(set(quality_flags))),
        )

    def analyze_multi_window(
        self,
        audio: np.ndarray,
        sample_rate: int = 32000,
        window_duration_s: float = 10.0,
        hop_duration_s: float = 10.0,
        session_id: Optional[str] = None,
    ) -> SoundscapeTrendSummary:
        """Extract multi-window sequential soundscape measurements and analyze temporal trends.

        Args:
            audio: 1D numpy array of audio samples.
            sample_rate: Sampling frequency in Hz.
            window_duration_s: Duration of each analysis window in seconds (default 10s).
            hop_duration_s: Step duration between consecutive window onsets (default 10s).
            session_id: Monitoring session UUID.

        Returns:
            SoundscapeTrendSummary detailing trajectory, means, variances, and stability.
        """
        total_samples = len(audio)
        total_duration = total_samples / max(1, sample_rate)
        window_samples = int(window_duration_s * sample_rate)
        hop_samples = int(hop_duration_s * sample_rate)

        if total_samples < window_samples or window_samples <= 0 or hop_samples <= 0:
            # Single measurement over available audio
            m = self.analyze_audio_window(audio, sample_rate, 0.0, total_duration, session_id)
            return SoundscapeTrendSummary(
                session_id=session_id,
                window_count=1,
                total_duration_seconds=round(total_duration, 3),
                mean_metrics=m.metrics,
                variance_metrics={k: 0.0 for k in m.metrics},
                trend_deltas={k: 0.0 for k in m.metrics},
                dominant_frequency_band=max(m.frequency_bands, key=m.frequency_bands.get) if m.frequency_bands else "none",
                temporal_stability_index=1.0,
                quality_flags=m.quality_flags,
                measurements=[m],
            )

        measurements: List[SoundscapeMeasurement] = []
        start_idx = 0

        while start_idx + window_samples <= total_samples:
            end_idx = start_idx + window_samples
            chunk = audio[start_idx:end_idx]
            t_start = start_idx / sample_rate
            t_end = end_idx / sample_rate

            m = self.analyze_audio_window(chunk, sample_rate, t_start, t_end, session_id)
            measurements.append(m)

            start_idx += hop_samples

        # Compute aggregate means, variances, and deltas
        metric_keys = ["aci", "adi", "aei", "ndsi", "spectral_entropy", "temporal_activity"]
        mean_metrics: Dict[str, Optional[float]] = {}
        variance_metrics: Dict[str, Optional[float]] = {}
        trend_deltas: Dict[str, Optional[float]] = {}
        cv_list: List[float] = []

        for k in metric_keys:
            vals = [m.metrics[k] for m in measurements if m.metrics.get(k) is not None]
            if vals:
                arr = np.array(vals, dtype=np.float64)
                mean_v = float(np.mean(arr))
                var_v = float(np.var(arr))
                mean_metrics[k] = round(mean_v, 6)
                variance_metrics[k] = round(var_v, 6)

                # Coefficient of variation for stability
                if abs(mean_v) > 1e-6:
                    cv = math.sqrt(var_v) / abs(mean_v)
                    cv_list.append(min(1.0, cv))

                # Trend delta: final window minus first window
                first_val = measurements[0].metrics.get(k)
                last_val = measurements[-1].metrics.get(k)
                if first_val is not None and last_val is not None:
                    trend_deltas[k] = round(last_val - first_val, 6)
                else:
                    trend_deltas[k] = 0.0
            else:
                mean_metrics[k] = None
                variance_metrics[k] = None
                trend_deltas[k] = None

        # Determine dominant frequency band across all windows
        all_bands = list(DEFAULT_ECOLOGICAL_BANDS.keys())
        band_totals = {b: 0.0 for b in all_bands}
        for m in measurements:
            for b in all_bands:
                band_totals[b] += m.frequency_bands.get(b, 0.0)

        dominant_band = max(band_totals, key=band_totals.get) if band_totals else "none"

        # Stability index in [0.0, 1.0] (1.0 = completely stationary soundscape)
        mean_cv = float(np.mean(cv_list)) if cv_list else 0.0
        stability_index = round(max(0.0, 1.0 - mean_cv), 4)

        all_flags: List[str] = []
        for m in measurements:
            all_flags.extend(m.quality_flags)

        return SoundscapeTrendSummary(
            session_id=session_id,
            window_count=len(measurements),
            total_duration_seconds=round(total_duration, 3),
            mean_metrics=mean_metrics,
            variance_metrics=variance_metrics,
            trend_deltas=trend_deltas,
            dominant_frequency_band=dominant_band,
            temporal_stability_index=stability_index,
            quality_flags=sorted(list(set(all_flags))),
            measurements=measurements,
        )

    def compare_soundscapes(
        self,
        baseline: SoundscapeMeasurement,
        target: SoundscapeMeasurement,
    ) -> SoundscapeHistoricalComparison:
        """Compare two soundscape measurements to quantify bioacoustic habitat shift.

        Args:
            baseline: Historic or pre-disturbance soundscape measurement.
            target: Current or post-disturbance soundscape measurement.

        Returns:
            SoundscapeHistoricalComparison detailing absolute deltas, percentage shifts, and narratives.
        """
        metric_deltas: Dict[str, float] = {}
        metric_pct_changes: Dict[str, Optional[float]] = {}

        for k in ["aci", "adi", "aei", "ndsi", "spectral_entropy", "temporal_activity"]:
            b_val = baseline.metrics.get(k)
            t_val = target.metrics.get(k)
            if b_val is not None and t_val is not None:
                delta = t_val - b_val
                metric_deltas[k] = round(delta, 6)
                if abs(b_val) > 1e-6:
                    pct = (delta / abs(b_val)) * 100.0
                    metric_pct_changes[k] = round(pct, 2)
                else:
                    metric_pct_changes[k] = None
            else:
                metric_deltas[k] = 0.0
                metric_pct_changes[k] = None

        # Band shifts
        band_shifts: Dict[str, float] = {}
        for b in DEFAULT_ECOLOGICAL_BANDS.keys():
            b_base = baseline.frequency_bands.get(b, 0.0)
            b_targ = target.frequency_bands.get(b, 0.0)
            band_shifts[b] = round(b_targ - b_base, 6)

        # Interpretations
        ndsi_delta = metric_deltas.get("ndsi", 0.0)
        if ndsi_delta > 0.15:
            bio_desc = f"Biophony expanded relative to anthropophony (NDSI delta: +{ndsi_delta:.3f})."
        elif ndsi_delta < -0.15:
            bio_desc = f"Anthropophony dominant; biophony suppressed relative to baseline (NDSI delta: {ndsi_delta:.3f})."
        else:
            bio_desc = f"Soundscape balance remained stable (NDSI delta: {ndsi_delta:+.3f})."

        anthro_shift = band_shifts.get("mid_frequency_1_2k_pct", 0.0)
        if anthro_shift > 0.10:
            anthro_desc = f"Anthropophonic band energy (1-2 kHz) increased by +{anthro_shift*100:.1f}%."
        elif anthro_shift < -0.10:
            anthro_desc = f"Anthropophonic band energy (1-2 kHz) decreased by {anthro_shift*100:.1f}%."
        else:
            anthro_desc = "Anthropophonic band energy remained steady."

        aci_delta = metric_deltas.get("aci", 0.0)
        if aci_delta > 20.0:
            comp_desc = f"Acoustic complexity increased significantly (+{aci_delta:.1f} ACI), indicating higher vocal activity variation."
        elif aci_delta < -20.0:
            comp_desc = f"Acoustic complexity decreased significantly ({aci_delta:.1f} ACI), indicating acoustic homogenization or silence."
        else:
            comp_desc = f"Acoustic complexity remained comparable ({aci_delta:+.1f} ACI)."

        return SoundscapeHistoricalComparison(
            baseline_id=baseline.measurement_id,
            target_id=target.measurement_id,
            metric_deltas=metric_deltas,
            metric_pct_changes=metric_pct_changes,
            band_energy_shifts=band_shifts,
            biophony_shift_description=bio_desc,
            anthropophony_shift_description=anthro_desc,
            complexity_shift_description=comp_desc,
        )


# Singleton instance
soundscape_intelligence_service = SoundscapeIntelligenceService()
