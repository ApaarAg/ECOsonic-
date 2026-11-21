# ECOSONIC 3.0 — PHASE 4B.1 REPORT
## SCIENTIFIC SOUNDSCAPE FINGERPRINT ENGINE

**System:** EcoSonic 3.0 Bioacoustic Intelligence Platform  
**Module:** Soundscape Fingerprint Engine (`SoundscapeFingerprintEngine`)  
**Status:** Complete, Validated, and Benchmarked  
**Branch:** `feature/soundscape-disturbance`  
**Date:** November 2026  

---

## 1. Executive Summary

Phase 4B.1 establishes the scientific and computational core of EcoSonic's **Soundscape Fingerprint Engine** (`backend/app/services/soundscape/fingerprint_engine.py`). Moving beyond short-window inference predictions, this engine transforms continuous environmental audio streams into a structured, standardized collection of ecoacoustic measurements backed by peer-reviewed ecological literature and computational signal processing standards.

All 7 required scientific measurements, comprehensive input validation guardrails, configurable spectral parameters, and window duration quality flagging have been implemented and verified with 100% test pass rate across unit, integration, and live streaming test suites.

---

## 2. Scientific Acoustic Measurements Specification

The engine computes 7 standard ecoacoustic indices using verified implementations from `scikit-maad` (v0.1.12), `SciPy`, and `NumPy`:

### 2.1 Acoustic Complexity Index (ACI)
* **Citation:** Pieretti, N., Farina, A., & Morri, D. (2011). *A new methodology to infer the singing activity of an avian community: The Acoustic Complexity Index (ACI)*. Ecological Indicators, 11(3), 868–873.
* **Formulation:** Computes the sum of absolute differences between adjacent temporal intensity frames within each frequency bin, normalized by the total intensity across that bin:
  $$\text{ACI} = \sum_{k=1}^K \frac{\sum_{i=1}^{N-1} |I_{k, i+1} - I_{k, i}|}{\sum_{i=1}^N I_{k, i}}$$
* **Implementation Note:** Calculated directly on the amplitude spectrogram ($V$), capturing fine-grained biophonic modulations while remaining robust against constant continuous background noise (such as road traffic or distant machinery).

### 2.2 Acoustic Diversity Index (ADI)
* **Citation:** Villanueva-Rivera, L. J., Pijanowski, B. C., Doucette, J., & Pekin, B. (2011). *A primer of acoustic diversity for landscape ecologists*. Landscape Ecology, 26(9), 1233–1246.
* **Formulation:** Shannon diversity index calculated across the proportions of acoustic energy occupying 1,000 Hz frequency bands up to the Nyquist limit:
  $$\text{ADI} = -\sum_{b=1}^B p_b \ln(p_b)$$
* **Configuration:** Band step = 1,000 Hz; energy threshold = -50 dB relative to peak. High ADI values indicate balanced bioacoustic activity spanning multiple spectral niches.

### 2.3 Acoustic Evenness Index (AEI)
* **Citation:** Gasc, A., Sueur, J., Pavoine, S., Pellens, R., & Grandcolas, P. (2013). *Biodiversity sampling using acoustic indices: do they reflect species richness?* Ecological Indicators, 25, 279–287.
* **Formulation:** Gini index measuring inequality in acoustic energy distribution across frequency bands (0 = perfectly even distribution; 1 = all energy concentrated in a single band).
* **Configuration:** Band step = 500 Hz; energy threshold = -50 dB. Complements ADI by quantifying community dominance vs. evenness.

### 2.4 Normalized Difference Soundscape Index (NDSI)
* **Citation:** Kasten, E. P., Gage, S. H., Fox, J., & Joo, W. (2012). *The normalized difference soundscape index (NDSI): A novel method to evaluate differences in soundscape composition*. Ecological Indicators, 17, 78–87.
* **Formulation:** Compares biophonic energy ($E_{\text{bio}}$) and anthropophonic energy ($E_{\text{anthro}}$):
  $$\text{NDSI} = \frac{E_{\text{bio}} - E_{\text{anthro}}}{E_{\text{bio}} + E_{\text{anthro}}}$$
  Range: $[-1.0, +1.0]$, where $+1.0$ is pure biophony, $0.0$ is equal balance, and $-1.0$ is pure anthropophony.
* **Frequency Boundaries:**
  * **Anthropophony:** Configurable, default `[1000, 2000]` Hz. Excludes $< 1000$ Hz to avoid low-frequency wind turbulence and microphone buffet artifacts.
  * **Biophony:** Configurable, default `[2000, 8000]` Hz. Captures primary avian, amphibian, and mammalian vocalizations.
* **Scientific Guardrail:** If $(E_{\text{bio}} + E_{\text{anthro}}) < 10^{-12}$, the underlying mathematical assumption is violated. The engine sets `ndsi = None` and adds quality flag `"ndsi_energy_too_low"`.
* **Important Disclaimer:** NDSI measures relative spectral energy distribution between two acoustic bands. It is **never** presented as an arbitrary 0–100 ecosystem health score.

### 2.5 Spectral Shannon Entropy
* **Formulation:** Normalized Shannon entropy across the average power spectral density:
  $$H_{\text{spectral}} = -\frac{\sum_{k} p_k \log_2(p_k)}{\log_2(K)}$$
  where $p_k = S_k / \sum S_k$ is the normalized energy distribution across $K$ frequency bins.
* **Behavior:** Flat broadband white noise yields $H \approx 1.0$; pure narrowband sinusoidal tones yield $H \approx 0.0$.
* **Towsey EAS Metric:** For scientific completeness, the Towsey et al. (2014) Entropy of the Average Spectrum (EAS) is preserved in `calculation_parameters["entropy_average_spectrum_eas"]`.

### 2.6 Temporal Acoustic Activity
* **Citation:** Towsey, M., Wimmer, J., Williamson, I., & Roe, P. (2014). *The use of acoustic indices to determine wildlife activity and diversity in environmental audio recordings*. Ecological Informatics, 21, 110–125.
* **Formulation:** Fraction of the analysis window during which signal amplitude exceeds a background noise threshold (default 3 dB above ambient).
* **Parameters Recorded:** Total active events count and mean active signal level (dB) preserved in `calculation_parameters`.

### 2.7 Frequency-Band Energy Distribution
* Partitions the complete spectrum (0 Hz to Nyquist 16 kHz for 32 kHz sampling rate) into 5 ecological sub-bands:
  1. `infrasound_low_anthro_pct`: `[0, 1000]` Hz
  2. `mid_anthro_low_bio_pct`: `[1000, 2000]` Hz
  3. `core_biophony_pct`: `[2000, 8000]` Hz
  4. `high_biophony_insects_pct`: `[8000, 14000]` Hz
  5. `ultrasonic_high_pct`: `[14000, 16000]` Hz
* Computed as percentage of total power spectral density (PSD) energy. Sums to 100% on active acoustic signals.
* Supports customizable band dictionaries via `SoundscapeConfig(custom_frequency_bands=...)`.

---

## 3. Scientific Configuration & Default Justifications

All signal processing and ecoacoustic parameters are defined in `SoundscapeConfig` without magic numbers:

| Parameter | Default Value | Scientific & Computational Justification |
| :--- | :--- | :--- |
| `sample_rate` | 32,000 Hz | BirdNET V3.0 native sampling rate (Nyquist: 16 kHz). Avoids resample artifacts. |
| `n_fft` | 1,024 points | Spectral resolution $\Delta f = 31.25$ Hz; temporal window = 32 ms. Balances avian harmonic separation and transient resolution. |
| `hop_length` | 512 points | 50% overlap (`noverlap = 512`). Satisfies Constant Overlap-Add (COLA) for Hann window, suppressing spectral leakage. |
| `window_function` | `"hann"` | Standard cosine bell minimizing sidelobe leakage down to -31.5 dB. Also supports `"hamming"`, `"blackman"`, etc. |
| `flim_bio` | `(2000, 8000)` Hz | Primary frequency niche for avian and amphibian communications. |
| `flim_anthro` | `(1000, 2000)` Hz | Core structured anthropophony (engines, mechanical drones, traffic hum). |
| `analysis_duration_s` | 60.0 s | Ecoacoustic indices require long stationarity windows to capture song bouts and ambient intervals. |
| `min_analysis_duration_s` | 5.0 s | Minimum threshold for statistically meaningful spectrogram statistics. Shorter inputs flagged. |
| `silence_threshold_rms` | $10^{-4}$ | Distinguishes microphone dead state or disconnected lines. |
| `zero_variance_threshold`| $10^{-9}$ | Detects flatline / DC offset inputs lacking acoustic dynamic range. |
| `clipping_threshold` | 0.999 | Identifies digital clipping / preamp overload exceeding 5% of frames. |

---

## 4. Strict Audio Validation & Quality Flagging

The engine rejects invalid inputs with explicit, informative errors and tags degraded signals with quality flags:

1. **Empty Audio Rejection:** `ValueError("Input audio sample array is empty. Minimum duration required.")`.
2. **Non-Finite / NaN Rejection:** `ValueError("Input audio sample array contains non-finite values (NaN or Inf).")`.
3. **Sample Rate Validation:** `ValueError("Invalid sample_rate: ... Must be a positive integer.")`.
4. **Zero-Variance / DC Flatline:** Identifies constant DC offsets (`np.var(samples) <= 1e-9`). Adds `"zero_variance_detected"`, sets `ndsi=None`, and returns zeroed metrics without NaN divergence.
5. **Silence Detection:** Identifies RMS $< 10^{-4}$. Adds `"silent_window"` and returns null NDSI.
6. **Digital Clipping Detection:** Flags `"clipping_detected"` when $> 5\%$ of samples saturate at $\ge 0.999$.
7. **Window Duration Handling:**
   * $< 5.0$ s: Flagged with `"insufficient_duration"`, metrics set to safe defaults.
   * $5.0 \le \text{duration} < 60.0$ s: Flagged with `"incomplete_window"`, `is_partial_window: true`, but full metrics computed to support test suites and final session segments.

---

## 5. Verification Results & Benchmarks

### 5.1 Unit & Integration Test Suite
Command:
```powershell
$env:PYTHONPATH="backend"; .venv\Scripts\python.exe -m pytest backend/tests/test_soundscape_metrics.py -v
```
**Results:** **15 / 15 Passed in 0.58 seconds**

* `test_soundscape_engine_initialization` — PASSED
* `test_pure_tone_spectral_entropy` — PASSED
* `test_ndsi_biological_vs_anthropogenic` — PASSED
* `test_soundscape_silence_handling` — PASSED
* `test_soundscape_clipping_flag` — PASSED
* `test_acoustic_complexity_and_temporal_activity` — PASSED
* `test_calculation_parameters_retention` — PASSED
* `test_reject_empty_audio` — PASSED
* `test_reject_nan_inf_audio` — PASSED
* `test_reject_invalid_sample_rate` — PASSED
* `test_zero_variance_input` — PASSED
* `test_incomplete_window_flagging` — PASSED
* `test_insufficient_duration_flagging` — PASSED
* `test_configurable_window_function` — PASSED
* `test_custom_frequency_bands` — PASSED

### 5.2 Complete Soundscape & Live Session Test Suite
Command:
```powershell
$env:PYTHONPATH="backend"; .venv\Scripts\python.exe -m pytest backend/tests/test_soundscape_metrics.py backend/tests/test_soundscape_streaming.py backend/tests/test_soundscape_api.py backend/tests/test_disturbance_detection.py backend/tests/test_cooccurrence.py backend/tests/test_live_api_and_protocol.py -v
```
**Results:** **34 / 34 Passed in 4.28 seconds**

### 5.3 Real Environmental Audio Benchmark (`birds_forest.ogg`)
Execution:
```powershell
$env:PYTHONPATH="backend"; .venv\Scripts\python.exe backend/tools/verify_phase_4b_soundscape_disturbance.py
```
* **Audio Analyzed:** 14.65 seconds environmental forest recording at 44.1 kHz.
* **Execution Latency:** **0.150 seconds** (100x faster than real-time playback).
* **Acoustic Complexity Index (ACI):** 373.03
* **Acoustic Diversity Index (ADI):** 1.8051
* **Acoustic Evenness Index (AEI):** 0.7962
* **Normalized Difference Soundscape Index (NDSI):** +0.8126 (strongly biophony-dominated)
* **Spectral Shannon Entropy:** 0.7610
* **Temporal Acoustic Activity:** 0.2108 (active bird song bouts)
* **Frequency Bands:**
  * Core Biophony (2–8 kHz): **86.29%**
  * Infrasound / Low Anthro (0–1 kHz): 12.25%
  * Mid Anthro / Low Bio (1–2 kHz): 1.28%
  * High Biophony Insects (8–14 kHz): 0.18%
* **Quality Flags:** `['incomplete_window']` (correctly flagged for 14.65s $< 60$s).
* **Memory RSS Delta:** +1.03 MB.
