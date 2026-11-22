"""Unit and integration tests for Soundscape Fingerprint metrics and scientific acoustic indices."""

from __future__ import annotations

import math
import numpy as np
import pytest

from app.services.soundscape.fingerprint_engine import (
    SoundscapeConfig,
    SoundscapeFingerprintEngine,
    soundscape_engine,
)


def generate_sine_wave(
    freq_hz: float, duration_s: float, sample_rate: int = 32000, amplitude: float = 0.5
) -> np.ndarray:
    """Generate a clean sinusoidal tone."""
    t = np.linspace(0, duration_s, int(sample_rate * duration_s), endpoint=False, dtype=np.float32)
    return amplitude * np.sin(2 * np.pi * freq_hz * t)


def generate_white_noise(
    duration_s: float, sample_rate: int = 32000, amplitude: float = 0.2
) -> np.ndarray:
    """Generate uniform white noise."""
    rng = np.random.default_rng(42)
    return rng.uniform(-amplitude, amplitude, int(sample_rate * duration_s)).astype(np.float32)


def test_soundscape_engine_initialization():
    engine = SoundscapeFingerprintEngine()
    assert engine.bio_min_hz == 2000.0
    assert engine.bio_max_hz == 8000.0
    assert engine.anthro_min_hz == 1000.0
    assert engine.anthro_max_hz == 2000.0
    assert engine.n_fft == 1024
    assert engine.hop_length == 512
    assert engine.window_function == "hann"
    assert engine.frequency_resolution_hz == 31.25
    assert engine.analysis_duration_s == 60.0


def test_pure_tone_spectral_entropy():
    """A pure sinusoid has very low spectral entropy compared to broad white noise."""
    sr = 32000
    tone_samples = generate_sine_wave(freq_hz=4000.0, duration_s=10.0, sample_rate=sr)
    noise_samples = generate_white_noise(duration_s=10.0, sample_rate=sr)

    res_tone = soundscape_engine.analyze_audio_segment(tone_samples, sr, start_seconds=0.0)
    res_noise = soundscape_engine.analyze_audio_segment(noise_samples, sr, start_seconds=0.0)

    assert res_tone.metrics.spectral_entropy is not None
    assert res_noise.metrics.spectral_entropy is not None
    # Sine wave concentrates in one bin; white noise is distributed
    assert res_tone.metrics.spectral_entropy < res_noise.metrics.spectral_entropy


def test_ndsi_biological_vs_anthropogenic():
    """Verify that pure biological band tone yields high positive NDSI, while anthropogenic tone yields negative NDSI."""
    sr = 32000
    # Biological band: 4000 Hz (between 2000 and 8000 Hz)
    bio_tone = generate_sine_wave(freq_hz=4000.0, duration_s=10.0, sample_rate=sr)
    # Anthropogenic band: 1500 Hz (between 1000 and 2000 Hz)
    anthro_tone = generate_sine_wave(freq_hz=1500.0, duration_s=10.0, sample_rate=sr)

    res_bio = soundscape_engine.analyze_audio_segment(bio_tone, sr, start_seconds=0.0)
    res_anthro = soundscape_engine.analyze_audio_segment(anthro_tone, sr, start_seconds=0.0)

    assert res_bio.metrics.ndsi is not None
    assert res_anthro.metrics.ndsi is not None
    assert res_bio.metrics.ndsi > 0.5  # Dominated by biophony
    assert res_anthro.metrics.ndsi < -0.5  # Dominated by anthrophony


def test_soundscape_silence_handling():
    """Silent or dead-microphone windows must return null NDSI and flag 'silent_window'."""
    sr = 32000
    silence = np.zeros(sr * 10, dtype=np.float32)

    res = soundscape_engine.analyze_audio_segment(silence, sr, start_seconds=0.0)

    assert "silent_window" in res.quality_flags
    assert res.metrics.ndsi is None
    assert res.metrics.temporal_activity == 0.0


def test_soundscape_clipping_flag():
    """Signals with heavy digital clipping must be flagged."""
    sr = 32000
    clipped = np.ones(sr * 10, dtype=np.float32) * 1.0  # Constant 1.0 = hard clipping
    res = soundscape_engine.analyze_audio_segment(clipped, sr, start_seconds=0.0)
    assert "clipping_detected" in res.quality_flags


def test_acoustic_complexity_and_temporal_activity():
    """Verify ACI, ADI, AEI, and temporal activity return valid finite numbers on active audio."""
    import soundfile as sf
    from pathlib import Path

    audio_file = Path("backend/data/smoke_audio/birds_forest.ogg")
    if audio_file.exists():
        samples, sr = sf.read(str(audio_file))
        if samples.ndim > 1:
            samples = samples.mean(axis=1)
        samples = samples[: int(sr * 15)]
    else:
        sr = 32000
        samples = generate_white_noise(10.0, sr)

    res = soundscape_engine.analyze_audio_segment(samples, sr, start_seconds=0.0)

    assert res.metrics.aci is not None
    assert res.metrics.aci > 0.0
    assert res.metrics.temporal_activity is not None
    assert res.metrics.temporal_activity > 0.05
    assert res.frequency_bands is not None
    assert "core_biophony_pct" in res.frequency_bands
    assert "mid_anthro_low_bio_pct" in res.frequency_bands


def test_calculation_parameters_retention():
    """Verify that calculation parameters (FFT size, sample rate, band bounds) are retained in the response."""
    sr = 32000
    noise = generate_white_noise(10.0, sr)
    res = soundscape_engine.analyze_audio_segment(noise, sr, start_seconds=10.0)

    assert res.window_start_seconds == 10.0
    assert res.window_end_seconds == 20.0
    params = res.calculation_parameters
    assert params["sample_rate"] == 32000
    assert params["n_fft"] == 1024
    assert params["window_function"] == "hann"
    assert params["frequency_resolution_hz"] == 31.25
    assert params["bio_band_hz"] == [2000.0, 8000.0]
    assert params["anthro_band_hz"] == [1000.0, 2000.0]
    assert "ndsi_assumptions" in params
    assert params["ndsi_assumptions"]["scientific_disclaimer"] is not None


def test_reject_empty_audio():
    """Empty audio sample array must raise ValueError."""
    with pytest.raises(ValueError, match="empty"):
        soundscape_engine.analyze_audio_segment(np.array([], dtype=np.float32), 32000)


def test_reject_nan_inf_audio():
    """Non-finite audio samples (NaN or Inf) must raise ValueError."""
    sr = 32000
    samples_nan = np.zeros(sr, dtype=np.float32)
    samples_nan[10] = np.nan
    with pytest.raises(ValueError, match="non-finite"):
        soundscape_engine.analyze_audio_segment(samples_nan, sr)

    samples_inf = np.zeros(sr, dtype=np.float32)
    samples_inf[10] = np.inf
    with pytest.raises(ValueError, match="non-finite"):
        soundscape_engine.analyze_audio_segment(samples_inf, sr)


def test_reject_invalid_sample_rate():
    """Invalid sample rate (<= 0 or non-integer) must raise ValueError."""
    samples = np.zeros(1000, dtype=np.float32)
    with pytest.raises(ValueError, match="sample_rate"):
        soundscape_engine.analyze_audio_segment(samples, -1)
    with pytest.raises(ValueError, match="sample_rate"):
        soundscape_engine.analyze_audio_segment(samples, 0)


def test_zero_variance_input():
    """Constant non-zero DC offset signal has zero variance and must be flagged."""
    sr = 32000
    dc_signal = np.full(sr * 10, 0.42, dtype=np.float32)
    res = soundscape_engine.analyze_audio_segment(dc_signal, sr, start_seconds=0.0)

    assert "zero_variance_detected" in res.quality_flags
    assert res.metrics.ndsi is None
    assert res.metrics.temporal_activity == 0.0


def test_incomplete_window_flagging():
    """Audio shorter than default 60s analysis duration must be flagged as incomplete_window but still computed."""
    sr = 32000
    samples_15s = generate_white_noise(15.0, sr)
    res = soundscape_engine.analyze_audio_segment(samples_15s, sr, start_seconds=0.0)

    assert "incomplete_window" in res.quality_flags
    assert res.calculation_parameters["is_partial_window"] is True
    assert res.metrics.spectral_entropy is not None
    assert res.metrics.aci is not None


def test_insufficient_duration_flagging():
    """Audio shorter than minimum 5s duration must be flagged as insufficient_duration and exit safely."""
    sr = 32000
    samples_2s = generate_white_noise(2.0, sr)
    res = soundscape_engine.analyze_audio_segment(samples_2s, sr, start_seconds=0.0)

    assert "insufficient_duration" in res.quality_flags
    assert res.metrics.aci == 0.0
    assert res.metrics.ndsi is None


def test_configurable_window_function():
    """Engine must support configurable window functions like hamming and blackman."""
    sr = 32000
    noise = generate_white_noise(10.0, sr)

    engine_hamming = SoundscapeFingerprintEngine(SoundscapeConfig(window_function="hamming"))
    res_hamming = engine_hamming.analyze_audio_segment(noise, sr)
    assert res_hamming.calculation_parameters["window_function"] == "hamming"
    assert res_hamming.metrics.aci is not None

    engine_blackman = SoundscapeFingerprintEngine(SoundscapeConfig(window_function="blackman"))
    res_blackman = engine_blackman.analyze_audio_segment(noise, sr)
    assert res_blackman.calculation_parameters["window_function"] == "blackman"
    assert res_blackman.metrics.aci is not None


def test_custom_frequency_bands():
    """Engine must support custom frequency band dictionaries."""
    sr = 32000
    custom_bands = {
        "low_sub_band_pct": (0.0, 3000.0),
        "mid_sub_band_pct": (3000.0, 9000.0),
        "high_sub_band_pct": (9000.0, 16000.0),
    }
    custom_config = SoundscapeConfig(custom_frequency_bands=custom_bands)
    engine = SoundscapeFingerprintEngine(custom_config)

    noise = generate_white_noise(10.0, sr)
    res = engine.analyze_audio_segment(noise, sr)

    assert "low_sub_band_pct" in res.frequency_bands
    assert "mid_sub_band_pct" in res.frequency_bands
    assert "high_sub_band_pct" in res.frequency_bands
    total_pct = sum(res.frequency_bands.values())
    assert 99.0 <= total_pct <= 101.0  # Percentage distribution sums to ~100%
