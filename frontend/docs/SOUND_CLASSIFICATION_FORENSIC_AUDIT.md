# ECOsonic 3.0 — Sound Detection & Classification Forensic Audit

**Audit date:** 2026-11-25  
**Scope:** Current browser client at `C:\Users\apaar\Desktop\frontend` and backend at `C:\Users\apaar\Desktop\ECOBIRDS`. The backend checkout was inspected and exercised read-only; tests that write artifacts ran from a temporary copy. No production code or tests were changed.

## Executive Verdict

# FAIL

The backend does load the intended BirdNET V3.0 ONNX model, produce class scores, and pass real-model CPU/GPU parity and recording-pipeline tests. A real WebSocket replay also reached live inference and persisted detections for several windows. Two recordings agree with their uploader-provided, recording-level labels; that does not establish independently verified species accuracy.

The browser microphone-to-classification path is **not ready to claim as working live classification**. This checkout has no `VITE_ECOSONIC_API_URL`/`VITE_ECOSONIC_WS_URL` configuration or running backend endpoint, so the client selects its visibly labeled `DEMO SIGNAL` mode. Separately, the capture fallback sends analyzer metrics but no PCM, and the resampler can drift if the browser does not honor the requested 32 kHz context. A real browser microphone event was therefore not verified.

Scores are passed through as model scores and then shown as percentages called “confidence”; there is no calibration evidence. Live events also lose acoustic timestamps and class type in the frontend, and the worker can persist non-animal classes as `Bird`. These are material presentation and data-integrity defects.

## Pipeline Status

| Stage | Status | Evidence |
|---|---|---|
| Microphone capture | **NOT VERIFIED** | `ecosonicAudioCapture.ts` requests mono/32 kHz as browser ideals. No live backend URL was configured, and no microphone permission/session was exercised. It does not verify the actual input settings. |
| 32 kHz resampling | **FAIL, conditional** | `AudioContext` is requested at 32 kHz and the resampler reads `context.sampleRate`. `BandLimitedResampler.process` rounds output length independently for each AudioWorklet callback. With 128-sample callbacks at 48 kHz, `round(128 × 32000/48000)=85`; 375 callbacks produce 31,875 rather than 32,000 samples per second. A browser that runs the context at 32 kHz avoids this case, but the client does not assert that it did. |
| PCM16 encoding | **PASS by implementation; input unverified** | The worklet downmixes channels, then converts floats to signed PCM16. Frames contain 8,000 samples (250 ms), little-endian PCM16 payload, and a 4-byte big-endian unsigned sequence number. Backend protocol tests cover framing and validation. No real browser-produced frames were inspected. |
| WebSocket transport | **INCOMPLETE** | With no configured URL, `EcosonicSocketClient.connect()` sets the store to `demo`. The socket protocol and mocked live WebSocket tests pass. A real-rate file replay reached the actual backend/model but ended with an active session and no confirmed stop; see testing notes. |
| Audio buffering | **PASS for 32 kHz mono input** | Backend decodes little-endian signed PCM16, converts to float32 by dividing by 32768, tracks sequence numbers, and buffers 3-second windows with a 3-second hop. The session/API accepts client sample-rate metadata; it does not resample incoming audio to the model rate. |
| BirdNET inference | **PASS** | Live worker loads `DirectOnnxEngine`; the configured V3.0 FP32 ONNX artifact ran on CUDA/GPU and CPU. Direct-engine parity against the BirdNET package passed on both providers. |
| Class mapping | **PASS for label ordering; PARTIAL for taxonomy** | The 11,725-entry `en_us.txt` ordering matches the official BirdNET API outputs in real-model parity tests. Non-animal handling is a hand-maintained subset, and the live worker loses its `record_type` distinction. |
| Confidence handling | **FAIL for wording/calibration** | Raw model output is ranked and filtered; no application softmax or calibration step is applied. Frontend multiplies the score by 100 and labels it “confidence.” The values are not demonstrated to be calibrated probabilities. |
| Event generation | **PARTIAL** | Top five scores at or above 0.10 are emitted per 3-second live window. Animal results are not merged into one time-localized vocalization; repeated labels across windows are separate window events. The final partial live window is not established as processed on stop. |
| Persistence | **PASS in API tests; live replay incomplete** | Recording pipeline, live API/protocol, segments, and event persistence tests passed. The partial real WebSocket replay persisted model events but did not reach a verified stopped state. |
| Frontend display | **FAIL for live provenance** | The parser discards backend start/end seconds and `taxon_group`, assigns arrival-time timestamps, and synthesizes azimuth, elevation, and frequency values. It presents raw scores as percentages. Demo mode is clearly labeled and its sample detections are explicitly triggered. |

### Architecture trace

1. **Browser capture —** `src/api/ecosonicAudioCapture.ts` requests `getUserMedia` with one channel and 32 kHz as *ideal* constraints, disables browser echo cancellation/noise suppression/AGC, and requests a shared 32 kHz `AudioContext`. The worklet averages input channels into mono float32. Its context rate is the resampler input rate; the reported capture rate returned to the app is the target constant, not a verified device/context measurement.
2. **Resampling and packetization —** the worklet passes mono float32 through a 31-tap band-limited resampler. Resampled samples accumulate into 8,000-sample chunks; conversion clamps and scales to signed PCM16. The worklet path calls the PCM callback. The fallback path polls an `AnalyserNode` for UI level/RMS data but never calls the PCM callback, so it can look active while transmitting no audio.
3. **Transport —** `src/api/ecosonicSocket.ts` POSTs a `browser_mic` session with `sample_rate: 32000, channels: 1`, then streams sequence-prefixed frames. With no API/WS URL, it returns in `demo` state. `VITE_ECOSONIC_WS_URL` can be explicit; otherwise the WS base is derived from `VITE_ECOSONIC_API_URL`.
4. **Backend receive and buffer —** `backend/app/api/v1/live.py` parses control messages and binary frames; `session_manager.py` validates frame alignment/sequence and decodes `<i2` PCM to float32. Channel input is averaged if multichannel. `ring_buffer.py` creates non-overlapping 3 s windows at 3 s hops. Silence below RMS `1e-4` is skipped by the live worker; clipping checks use `0.999` and a clipped-sample ratio. There is no backend rate conversion when a client declares a non-32 kHz sample rate.
5. **Inference —** `backend/app/services/live/inference_worker.py` calls `DirectOnnxEngine.infer` for top five labels per window, with a live score threshold of 0.10. The engine supplies a 96,000-sample (3 s × 32 kHz) waveform to ONNX and reads 11,725 class outputs plus a 1,280-element embedding. Inference uses the loaded model artifact and selected ONNX provider.
6. **Postprocessing and persistence —** class indices map directly to lines in `en_us.txt`; scientific/common names are split at the first underscore. The worker stores detections and segment/audio/embedding records and broadcasts `detection` events. Events use the 3-second window bounds, not source-localized call onsets. The animal path does not debounce/aggregate repeated labels across windows.
7. **Frontend state and rendering —** `EcosonicSocketClient` reads `common_name`, `scientific_name`, and `confidence_score`, but stamps the event with `Date.now()`, hardcodes `frequencyHz: 3200`, and derives spatial values instead of using acoustic measurements. `AcousticField` renders `confidence × 100` as `%`. Built-in sample species are reached through explicit demo controls and carry demo labels; they are not silently inserted into a live socket event.

**Critical sample-rate answer:** the intended format is 32 kHz mono PCM16, and the backend tests validate that representation. The actual browser path does not prove every microphone produces it: the browser constraints are ideal, context rate is not asserted, and the per-callback rounding resampler drifts at common non-integer ratios. The backend trusts the session's declared sample rate and does not repair a mismatch. Therefore the browser-to-BirdNET waveform is **not guaranteed equivalent** to the expected 32 kHz mono input.

## Classification Validation

The production upload pipeline was run against the repository recordings after FFmpeg normalization to mono/32 kHz. Scores below are the strongest window-level result; “top five” lists the strongest per-window results, so the same label can recur in different windows.

| Recording | Ground truth | Prediction | Score | Correctness | Evidence |
|---|---|---|---:|---|---|
| `birds_forest.ogg` | Fontainebleau forest birds; uploader says wrens are audible. No time-coded species annotation. | Willow Warbler, 12.00–14.656 s. Next strongest: Goldcrest 9–12 s; Willow Warbler 0–3 s; Tree Pipit in the tail; Goldcrest 3–6 s. | 0.9276 | **PLAUSIBLE BUT UNVERIFIED** | The file establishes birds generally, not Willow Warbler. Wren note neither confirms nor contradicts the top class. |
| `frog_mixed.ogg` | Uploader describes Eastern Banjo/Pobblebonk and Motorbike Frogs after dark; no independent time-coded annotation. | Eastern Banjo Frog, 24–27 s. Next: Eastern Banjo Frog 30–32.844 s; Motorbike Frog 18–21 s; Eastern Banjo Frog 0–3 s; Eastern Banjo Frog 21–24 s. | 0.6798 | **VERIFIED CORRECT** against the uploader’s recording-level claim only | At least one top prediction matches the uploader’s stated sound. This does not verify individual event timestamps or independent species accuracy. |
| `cicada_orni.ogg` | Uploader labels the clip as Cicada orni singing; no independent annotation. | Cicada orni / Ash Cicada, 6–9 s. Next: same class 0–3, 18–21, 27–28.844, and 24–27 s. | 0.9139 | **VERIFIED CORRECT** against the uploader’s recording-level label only | Prediction matches the recording-level label. No independent event-level ground truth exists in the checkout. |

The repository also contains `birds_garden.ogg`. It was included in the real BirdNET/direct-ONNX parity suite but excluded from the upload regression fixture because the fixture decoder cannot read its Ogg Skeleton stream. No usable species ground truth was found for it, so **cannot establish correctness from available evidence**.

The real live-worker model path was additionally exercised with normalized `birds_forest` frames. It persisted four windows of detections, including Willow Warbler, Goldcrest, and other forest-bird labels. This establishes that the live worker can invoke the real model and persist events; it does not establish browser capture correctness or field accuracy.

## Bugs Found

### High — PCM stops when AudioWorklet is unavailable

- **File/function:** `src/api/ecosonicAudioCapture.ts`, capture fallback after the AudioWorklet setup path.
- **Failure:** the fallback reads analyser levels for visualization but does not enqueue PCM or call `onPcm16Chunk`.
- **Impact:** the UI can continue showing microphone level/activity while the backend receives no sound to classify. This violates the live capture contract and can be mistaken for an inference failure.
- **Reproducibility:** code path is deterministic whenever worklet construction/loading fails or is unsupported. This branch was not exercised in a browser.
- **Recommended fix:** make fallback produce the same mono float/PCM stream, or report capture unavailable and prevent a live state without streamed audio.

### High — Resampler rounds each callback independently

- **File/function:** `src/api/ecosonicAudioCapture.ts`, `BandLimitedResampler.process`.
- **Failure:** output length is rounded per callback with no fractional sample carry. At 48 kHz input and 128-sample callbacks it emits 85 samples per callback, yielding about 31,875 samples/s instead of 32,000.
- **Impact:** duration and timestamps drift, windows no longer represent the advertised acoustic duration, and pitch/time scale can be wrong when context rate differs from 32 kHz.
- **Reproducibility:** arithmetic from the actual callback sizing and rates; the current protocol test exercises a large block and misses callback-boundary accumulation.
- **Recommended fix:** preserve fractional phase/output count across callbacks and add a streaming test using repeated 128-sample 44.1/48 kHz blocks.

### High — Backend trusts the declared sample rate

- **File/function:** `backend/app/api/v1/live.py` session creation; `session_manager.py`; `DirectOnnxEngine.infer`.
- **Failure:** session `sample_rate`/`channels` values configure buffering and are not required to equal 32 kHz mono. The live model tensor is still interpreted as 96,000 samples at 32 kHz; backend does not resample a 44.1/48 kHz client stream before inference.
- **Impact:** another API client can satisfy frame structure while feeding the model the wrong duration/rate. This is especially risky because the session metadata makes the input appear accepted.
- **Reproducibility:** direct from current API and inference path; frontend happens to declare 32 kHz mono.
- **Recommended fix:** reject unsupported format at session creation or convert audio to the model's required sample rate before windowing/inference.

### High — Non-animal class type is lost and can become “Bird”

- **File/function:** `backend/app/services/analysis_pipeline.py`, `direct_onnx_engine.py`, and `live/inference_worker.py` detection creation/broadcast.
- **Failure:** the model adapter identifies 16 hand-listed labels as `record_type="sound_class"` with `taxon_group=None`. The worker does not preserve `record_type` in the live detection event and uses `det.taxon_group or "Bird"` for persistence/broadcast. Therefore a non-animal label can be stored with a Bird taxon group and emitted as generic `detection`. Other animal classes currently use `Unknown` group, not a resolved taxonomic group.
- **Impact:** downstream consumers can treat machinery or other supported sound classes as bird detections. The frontend also ignores `taxon_group` and has no event-type field to restore the distinction.
- **Reproducibility:** deterministic from the class conversion and fallback logic; no labeled non-animal recording was available to verify end-to-end display.
- **Recommended fix:** carry explicit `record_type`/sound-class taxonomy through persistence, WebSocket schema, DTO, and UI; never default an unknown group to `Bird`.

### High — Frontend replaces acoustic timing and measurements

- **File/function:** `src/api/ecosonicSocket.ts`, live `detection` parser.
- **Failure:** backend `start_seconds`/`end_seconds` are not used for the displayed detection timestamp; the client assigns receive time. It also sets fixed `frequencyHz=3200` and derives azimuth/elevation from label/confidence rather than measuring them.
- **Impact:** the user sees a live wall-clock timestamp and synthetic spatial/frequency attributes that do not describe the detected sound. A 3-second window-level class is not a precise call timestamp.
- **Reproducibility:** deterministic in parser; protocol event contains acoustic window bounds.
- **Recommended fix:** preserve backend window bounds in the display and label derived/illustrative visual values as such, or omit them.

### Medium — “Confidence %” overstates score meaning

- **File/function:** `direct_onnx_engine.py`, score extraction/filtering; `src/visual/AcousticField/AcousticField.tsx`, percentage rendering.
- **Failure:** application code ranks ONNX outputs, filters raw values, and sends them through; it does not apply a cross-class softmax or calibration. The UI renders `round(score × 100)%` under confidence terminology.
- **Impact:** users may read an uncalibrated model score as a calibrated probability that the species is present. The total of class values is not normalized to 1.
- **Reproducibility:** code path; tests check provider parity, not calibration.
- **Recommended fix:** call it a model score unless calibration is measured and documented; do not present probability semantics without a calibration evaluation.

### Medium — Noisy/human-made class metadata over-interprets detections

- **File/function:** `backend/app/services/soundscape/disturbance_service.py`, class metadata and hazard output.
- **Failure:** some model class matches (including chainsaw, fire, and explosion) are assigned `critical` hazard classifications and descriptive text that can imply illegal logging, poaching, or damage. A single acoustic class match does not establish intent, legality, cause, or ecological impact.
- **Impact:** the API can turn a sound classification into an unsupported ecological or legal interpretation. The UI is more cautious in its generic anthropogenic/mechanical presentation, but the backend still exposes those fields.
- **Reproducibility:** present in class metadata; there were no labeled examples to assess these classes' detection accuracy.
- **Recommended fix:** keep sound detection separate from impact/intent conclusions and label any heuristic category as an unverified heuristic.

### Medium — Live labels are window detections, not localized calls

- **File/function:** `backend/app/services/live/ring_buffer.py` and `inference_worker.py`.
- **Failure:** each 3-second window is classified as a unit; live hop equals the window (3 s). Top-five scores over threshold become separate events, with no animal-event debounce/merge and no within-window onset/offset model.
- **Impact:** repeated class labels in adjacent windows are repeated window-level evidence, not independent calls. Displayed intervals describe the analyzed window, not where the call began/ended.
- **Reproducibility:** visible in the live window/event code and in repeated same-label recording outputs.
- **Recommended fix:** describe current events as window-level detections and avoid call-level timing/count claims; validate stop/tail behavior with a controlled live session.

### Unconfirmed live-session anomaly

An exploratory real WebSocket replay produced persisted model events, but the isolated database ended with `status=active`, `stopped_at=NULL`, `total_audio_seconds=10.0`, and `processed_audio_seconds=12.0` (four 3-second windows). The harness did not establish a clean stop or full-clip completion. Because that run was incomplete, the counter mismatch is recorded as an anomaly rather than a confirmed product bug. A clean controlled replay is required before making claims about shutdown/final-window handling.

## Scientific / ML Concerns

- **Scores are not calibrated probabilities.** The API returns model scores. The application does not establish calibration, and frontend `% confidence` language overstates what was measured.
- **Thresholds are engineering choices, not validated operating points.** Live filtering is 0.10; upload analysis uses 0.25; disturbance classes use per-class thresholds mainly in the 0.15–0.25 range. Tests establish code behavior, not precision/recall or ecological suitability at those cutoffs.
- **Ground truth is weak and coarse.** Frog and cicada matches are against uploader-provided whole-recording labels. The forest file does not validate its top species. There are no independent time-coded annotations or confusion-matrix results.
- **False positives and false negatives remain unmeasured.** True silence/flatline is skipped/rejected and the direct-model robustness cases pass. A quiet synthetic input is checked for finite outputs, but no evidence establishes false-positive rates on low-level noise or false-negative rates for faint calls.
- **Species ambiguity remains.** A top class among 11,725 labels is a ranking, not proof that the class is present; similar calls, mixed soundscapes, and model-domain conditions are not evaluated by this corpus.
- **Taxonomy is incomplete.** Non-animal classes rely on a manually maintained list; unrecognized labels fall through as animal-like records with `Unknown` names/groups. Live propagation then loses the non-animal type.
- **Hazard interpretation is not supported by classification alone.** A detected sound cannot establish illegal activity or ecological harm without additional evidence.
- **Provider reproducibility differs from the requirements lock.** The checked environment had ONNX Runtime 1.26.0 while requirements specify 1.32.0. CUDA and CPU both worked in this environment; deployment reproducibility should use the declared runtime or pin the tested one.

## Regression Analysis

- Real BirdNET/direct-ONNX parity passed for the four available recordings on both CPU and GPU, including label ordering and score parity. This supports the current model artifact and mapping path rather than a stale or mocked model.
- A fresh real upload-pipeline run on the three smoke recordings reproduced the outputs saved in `backend/test_results/phase2_api_integration.json` from 2026-11-23. No regression was detected in those recording-level outputs.
- The real pipeline returns expected model events and embeddings in the backend. Existing unit/integration tests also exercise the live WebSocket protocol and audio/frame validation, but those live protocol tests use mocked inference.
- The browser frontend has separate limitations: this checkout has no `.env` or `.env.local`, no configured API/WS URL, and no running backend connection. The client therefore falls back to labeled demo mode. The full live microphone flow cannot be compared against the prior backend baseline.
- The partial real WebSocket replay confirms the real worker was invoked, but not a complete session lifecycle. It is not counted as an end-to-end pass.

## Tests and Evidence Run

- Frontend `npm test -- --reporter=dot`: **31 passed** across 7 files. These tests cover helpers/protocol/store behavior, not a real AudioWorklet microphone stream. Output included jsdom canvas/WebGL and React `act` warnings.
- Backend targeted suite (`test_audio_processor.py`, `test_live_api_and_protocol.py`, `test_live_phase4a_finalization.py`, `test_audio_robustness_matrix.py`, `test_embedding_consistency.py`, `test_disturbance_detection.py`, `test_live_ring_buffer.py`, excluding `real_model`): **38 passed**. One Starlette/httpx deprecation warning.
- `test_direct_onnx_parity.py -m real_model`: **7 passed**, including CPU and GPU parity and synthetic signal robustness cases.
- `test_gpu_cpu_fallback.py -m real_model`: **2 passed**, forced CPU and GPU provider coverage.
- `test_real_pipeline.py -m real_model`: **1 passed** in a temporary writable copy because the backend checkout is read-only; it exercised real recording upload, inference, and result persistence.
- Live WebSocket file replay: **incomplete, not a passing E2E**. Real model detections were persisted for four windows; final stop/full clip was not confirmed.
- No actual microphone-to-UI test was possible: no frontend backend URL/listener was available, and no browser mic capture was started.

The installed BirdNET Python package metadata reports version `1.5.0` (the module itself has no `__version__` attribute); it loaded the acoustic V3.0 FP32 model. The exercised artifact was `model-fp32-e78c3b50e224.onnx` (SHA-256 `E78C3B50E224CD79D549D3C3B5EFDE2436ACD1D3FBD72694F2A0B8547FA18685`), with 11,725 English class labels. The backend configuration targets BirdNET+ V3.0 at 32 kHz. The runtime used CUDA on an RTX 4060 Laptop for GPU cases and CPU for CPU parity cases. The ONNX input was `(1, 96000)`; outputs were 11,725 class scores and a 1,280-value embedding. Provider parity validates equivalence to the BirdNET package path, not ecological accuracy.

## Required Fixes

### BLOCKING

1. Make capture fail visibly unless PCM frames are being produced. Implement a true PCM fallback or remove the silent analyser-only fallback; do not leave the session looking live without audio.
2. Correct streaming resampling across callback boundaries and verify actual `AudioContext`/captured rate. Add tests that feed repeated 128-sample blocks at 44.1 and 48 kHz and assert exact cumulative sample count/duration.
3. Require 32 kHz mono at backend session creation or resample before model windowing. Reject unsupported/mismatched formats rather than treating metadata as proof.
4. Preserve `record_type` through live persistence and WebSocket events, and prevent missing taxon groups from defaulting to `Bird`. Preserve class type in the frontend.
5. Configure the frontend API/WS endpoint and verify one real microphone or known source event reaches the live UI, with captured frames, backend events, and a clean stopped session.
6. Present the current output as an uncalibrated model score, not a probability-like confidence percentage, unless a calibration study supports the wording.

### IMPORTANT

1. Render backend window start/end times and identify them as window-level intervals; remove or explicitly label synthetic frequency/spatial visualization values.
2. Add independently annotated recordings with time-coded bird, frog, cicada, non-animal, low-level-noise, and silence cases. Report class-level precision/recall and false-positive/negative behavior before claiming field accuracy.
3. Validate and document the live 0.10, upload 0.25, and disturbance-class thresholds against a defined operating objective; keep per-event type and thresholds consistent across API, persistence, and display.
4. Separate sound detection from hazard/intent/ecological-impact interpretation. A single classifier match must not assert illegality or damage.
5. Repeat the real WebSocket replay with a controlled full recording and assert accepted audio duration, processed windows, final partial-window policy, persisted events, and `session_stopped` state.
6. Align the installed ONNX Runtime with the declared/pinned deployment version and repeat CPU/GPU parity on that exact environment.

### OPTIONAL

1. Surface whether inference ran on GPU or CPU and expose fallback reason in diagnostics.
2. Add counters for emitted PCM samples, actual rate, frames sent/accepted, sequence gaps, windows queued/dropped, and end-to-end event latency.
3. Add a clear “model score” explanation and raw window interval to the operator view.

## Final Answers

1. **Overall verdict:** FAIL for production/live-readiness; backend model inference itself passes the available technical validation.
2. **Does real sound detection work?** Yes in the backend upload pipeline and in partial real live-worker replay. Browser microphone streaming is not established.
3. **Does classification work?** The model produces consistent labels/scores; only recording-level agreement is shown for frogs and cicada, without independent or time-coded ground truth.
4. **Which classifications were verified?** Eastern Banjo Frog and Cicada orni match their uploader-provided recording labels only. Willow Warbler in `birds_forest` is plausible but unverified. No class is independently verified at event level.
5. **Bugs found:** PCM-silent fallback, callback-level resampler drift, unvalidated backend sample rate, non-animal-to-Bird fallback/class-type loss, fabricated UI timing/spatial/frequency values, uncalibrated score-as-percent language, and overreaching hazard metadata. Live animal events are window-level and not call-localized.
6. **Demo contamination:** No evidence that hardcoded demo species leak into a live event. Demo detections are explicit and labeled. This checkout defaults to `DEMO SIGNAL` because no backend URL is configured.
7. **Safe to claim as a working real-time classifier?** No. The browser capture/transport chain is unverified and contains known format/fallback defects; available recordings are insufficient to establish field classification accuracy.
8. **Exact next action:** fix PCM fallback and phase-preserving resampling, connect the frontend to a configured live backend, then rerun a browser microphone/source replay while asserting actual 32 kHz mono frames, timestamps/type through the UI, and clean full-session stop. Keep scores labeled as uncalibrated model scores until calibrated against annotated data.
