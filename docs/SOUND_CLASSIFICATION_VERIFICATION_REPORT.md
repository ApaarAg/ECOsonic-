# ECOsonic 3.0 Sound Classification Verification Report

**Date:** 2026-11-25  
**Overall status:** **ACCEPT WITH DOCUMENTED LIMITATIONS — the live pipeline is operational; event accuracy and acoustic source attribution remain unverified.**

This report follows the forensic audit at `frontend/docs/SOUND_CLASSIFICATION_FORENSIC_AUDIT.md`. It distinguishes pipeline evidence from model-accuracy evidence. Sections A–G document the preliminary run; their status snapshots are superseded by the final acceptance gate below, which completed the browser rendering and silence checks.

## A. Browser capture

- **Browser:** Chrome on the user's desktop.
- **Microphone:** real browser microphone permission and capture; the UI displayed `LIVE · PCM STREAMING` after PCM frames began sending.
- **Track sample rate:** 48,000 Hz.
- **AudioContext sample rate:** 32,000 Hz.
- **Transmitted format:** mono, signed PCM16 little-endian, 8,000 samples per frame (16,000 payload bytes; 250 ms per frame).
- During the capture the browser UI reported a 32 kHz output and showed 658 frames in a pre-stop snapshot. The stopped backend session recorded the final total of 704 accepted frames; the UI snapshot was not the final counter sample.
- The app uses AudioWorklet when available and a PCM-producing ScriptProcessor fallback. The UI did not expose which node was selected in this run, so the exact selected browser node is **unknown**. Actual PCM transmission was verified at the backend.

## B. Resampling

The live AudioContext supplied 32 kHz samples to the capture packetizer, so the capture resampler used its native-rate pass-through in this run. Browser-internal conversion from the 48 kHz track to the 32 kHz AudioContext is not separately instrumented.

The streaming resampler regression tests verify:

- 48 kHz input in repeated 128-sample callbacks: exactly 32,000 output samples for one second.
- 44.1 kHz input in repeated 128-sample callbacks, including a short final callback: exactly 32,000 output samples for one second.
- 32 kHz input: bit-exact pass-through and no length drift.
- Three seconds of chunked 44.1 kHz input versus one large buffer: identical output length, maximum chunk/whole difference below `1e-6`, and maximum adjacent output step below `0.2` for the test signal.

During browser capture, the UI rounded average resampling time to `0.000 ms`, packetization to `0.002 ms`, and maximum callback time to `1.000 ms`.

## C. Transport

- **Backend session:** `0d2ade40-ff2d-4d43-86c3-24119661e393` (`browser_mic`).
- **WebSocket:** connected to the local FastAPI server; binary PCM frames were accepted.
- **Received frames:** 704, with 11,264,000 PCM payload bytes.
- **Sequence:** next expected sequence `704`; sequence range `0–703` was contiguous.
- **Dropped frames:** 0. **Duplicate/out-of-order frames:** 0. **Input continuity:** 100%.
- At 8,000 samples per frame, the accepted stream represents 5,632,000 samples / 176 seconds of 32 kHz mono audio.
- The frontend's local API configuration is supplied through ignored `.env.local`; source code does not hardcode the machine URL. `.env.example` documents the API and WebSocket environment variables.

## D. Inference

- **Model:** Direct ONNX BirdNET V3.0; the session events report model version `3.0`. The startup health check reported the direct engine ready, 32 kHz input, and CUDA plus CPU execution providers configured. Exact per-window provider selection was not recorded.
- **Windows:** 58 processed and inferred, each three seconds; 174 seconds processed. No windows were skipped as silent (`silent_windows = 0`).
- **Events:** 56 persisted model detections across those windows.
- **Mean inference latency:** 112.45 ms. The backend's reported event-delivery estimate was 237.22 ms; an independent browser receive-to-render latency was not measured.
- **Queues at stop:** inference, embedding, and soundscape queues were all empty; dropped windows were 0.

### Silence check

**FAIL / not demonstrated.** The run did not produce any backend-classified silent windows. The backend inferred all 58 windows and emitted events, including before the speaker recording was played. This was not a controlled silent-input test and must not be treated as evidence that silence produces no species output.

### Bird recording playback check

The bundled forest recording was played through the desktop speaker while the physical microphone capture was live. The backend session contains real V3.0 inference and persisted animal detections, but the capture did not isolate the playback interval from ambient microphone input. I therefore do not attribute any particular species event to that recording or treat the output as an accuracy result.

The final visual confirmation that a real detection appeared in the browser UI was not completed: the user stopped Computer Use. The backend inference and event persistence are verified; browser-side event rendering remains **unverified**.

## E. Event integrity

- All 56 persisted events carried `event_semantics = window_detection`, source `start_seconds` / `end_seconds`, a separate wall-clock `created_at`, and a supported `record_type`.
- Event windows span from the first `0–3 s` event through the last persisted event at `156–159 s`. These are model-window intervals, not exact vocalization onsets.
- **Types:** 48 `animal`; 8 `sound_class`. No event had a missing or unsupported type.
- Example non-animal event: `Music_Music`, source window `9–12 s`, `record_type = sound_class`. It remains a sound class, not Bird.
- Scores remain the raw model score and the UI uses “BirdNET score” / “model score” terminology. They are not presented as calibrated probabilities.
- The detection DTO has no measured frequency, azimuth, or elevation fields. Rendering-only position is kept separate from acoustic measurements.

## F. Stop behavior

- The browser stop control returned the app to `OFFLINE · NO LIVE CLASSIFICATION`.
- The backend session reports `status = stopped` and a stop timestamp.
- It processed 58 complete three-second windows (174 seconds) from 176 seconds of accepted audio, then discarded the final 64,000 samples (2 seconds) as an incomplete window. No padding or partial-window inference occurs.
- Backend queues were empty at stop and dropped windows were 0. The capture path closes the WebSocket and microphone tracks. The backend retains a stopped session state for stats; no active WebSocket count is exposed, so socket absence was not independently enumerated.

## G. Classification evidence

| Evidence level | Finding |
|---|---|
| **Verified** | The live path reached BirdNET V3.0 inference; typed events and source-window timing persisted. Eight events retained `sound_class`. |
| **Plausible** | Some BirdNET bird labels are plausible for forest audio, but cannot be attributed to the playback interval. |
| **Unverified** | Event-level species correctness and whether each event came from the speaker playback or ambient audio. No independent event ground truth was available. |
| **Unknown** | Exact ONNX provider for each window; selected browser audio node; browser event receive-to-render latency. |

No claim of BirdNET accuracy is made. Recording-level uploader labels are not event-level ground truth.

## Preliminary regression and build results

These results are retained as the initial run record. The final test and build results appear in the acceptance gate below.

- **Frontend:** `npm.cmd test` — 14 test files, **64 passed**.
- **Focused backend live/protocol suite:** **17 passed**.
- **Full backend suite:** **185 passed, 1 failed, 1 skipped, 13 deselected**. The sole failure was `test_search_benchmark_numpy_throughput` at 136.9 ms against its 50 ms threshold during the full run; that same test passed when run alone. The full run also emitted existing async SQLite event-loop warnings.
- **Frontend build:** `npm.cmd run build` fails at TypeScript compilation. Errors include unused imports/variables across existing pages and nullable-number argument errors in `AudioIntelligence.tsx` and `HabitatMonitor.tsx`; Vite's production build was not reached.
- The live protocol tests cover unsupported sample rates/channel counts, animal and sound-class persistence/broadcast mapping, timing, and final partial-window discard. Frontend tests cover the fallback PCM stream, resampling cases, event mapping, and the absence of fabricated acoustic measurements.

## Preliminary acceptance status (superseded below)

| Area | Status | Evidence / limitation |
|---|---|---|
| Live microphone | **PASS** | Real Chrome microphone capture; live PCM reached backend. |
| Resampling | **PASS** | Streaming-rate cases and chunk continuity tests pass; runtime capture used 32 kHz pass-through. |
| PCM | **PASS** | 704 contiguous mono PCM16 frames accepted at 32 kHz. |
| WebSocket | **PASS** | Real browser connection, 704 accepted frames, no sequence gaps. |
| BirdNET inference | **PASS** | 58 real windows inferred by the ready V3.0 direct ONNX engine. |
| Classification | **PARTIALLY VERIFIED** | Classifications were emitted; event-level correctness is unverified. |
| Event integrity | **PASS** | Source windows, model score, semantics, and type persisted. |
| Sound-class taxonomy | **PASS** | Eight events persisted as `sound_class`, not Bird. |
| Session shutdown | **PASS** | Frontend offline; backend stopped; queues empty; final partial window discarded. |
| Regression tests | **FAIL** | 249 passed and 1 failed across full frontend/backend runs; one skipped and 13 deselected. The failed timing benchmark passes in isolation. |
| Real end-to-end acceptance | **FAIL** | Real microphone-to-backend inference and persistence passed. Controlled silence and visible browser event confirmation were not verified. |
| Production build | **FAIL** | Existing TypeScript errors stop the build before Vite. |

## Preliminary blockers (updated below)

1. Run a controlled quiet-input session and verify backend `silent_windows > 0` with no fabricated event output.
2. Repeat browser playback with capture constrained to the playback interval and observe a real detection rendered in the browser; collect browser receive-to-render timing. Computer Use was stopped by the user before this visual check.
3. Resolve the TypeScript build errors before treating the frontend as production-buildable.
4. Investigate the full-suite NumPy performance threshold failure under suite load; the isolated benchmark passes.

## Files changed for this remediation

**Frontend:** `frontend/src/App.tsx`, `frontend/src/pages/LiveMonitoring.tsx`, `frontend/src/types/index.ts`, `frontend/.env.example`, `frontend/postcss.config.js`.

**Backend:** `backend/app/api/v1/live.py`, `backend/app/api/v1/acoustic_memory.py`, `backend/app/api/v1/router.py`, `backend/app/core/database.py`, `backend/app/models/live_session.py`, `backend/app/schemas/live_session.py`, `backend/app/services/live/inference_worker.py`, `backend/app/services/live/ring_buffer.py`, `backend/app/services/live/session_manager.py`, `backend/app/services/soundscape/cooccurrence_service.py`.

**Existing tests updated:** `backend/tests/test_live_api_and_protocol.py`, `backend/tests/test_live_ring_buffer.py`, `backend/tests/test_live_phase4a_finalization.py`, `backend/tests/test_soundscape_metrics.py`.

## Files created or added for this remediation

- Frontend capture and protocol: `frontend/src/api/ecosonicAudioCapture.ts`, `frontend/src/api/ecosonicAudioCapture.test.ts`, `frontend/src/api/ecosonicSocket.ts`, `frontend/src/api/sharedAudioContext.ts`.
- Frontend event model and view: `frontend/src/domain/acousticFieldTypes.ts`, `frontend/src/domain/acousticStore.ts`, `frontend/src/visual/AcousticField/AcousticField.tsx`, `frontend/src/visual/AcousticField/acousticFieldState.ts`, `frontend/src/visual/Cinematic/CinematicOverlays.tsx`.
- Frontend regression coverage: `frontend/src/test/ecosonicProtocol.test.ts`, `frontend/src/test/acousticFieldState.test.ts`, `frontend/src/test/AcousticField.test.tsx`, `frontend/src/test/cinematicSequence.test.tsx`.
- Backend event-integrity regression: `backend/tests/test_live_event_integrity.py`.
- `docs/SOUND_CLASSIFICATION_VERIFICATION_REPORT.md` (this report).
- `backend/data/smoke_audio/birds_forest_e2e.wav` (48 kHz stereo playback conversion of the bundled forest OGG used in the browser check).

The ignored local `.env.local` configuration points the development frontend at the local backend and is not part of the tracked source changes.

The verification session and its 58 audio segments/embeddings remain in the local development database/storage under session ID `0d2ade40-ff2d-4d43-86c3-24119661e393` for inspection.

# FINAL ACCEPTANCE GATE

**Scope:** Completed the live Acoustic Field run in ACT 06. Scenes 11–16 were not started. This gate is the current result and supersedes the earlier preliminary status above.

| Requirement | Result | Evidence |
|---|---|---|
| Real microphone | **PASS** | Chrome captured the physical microphone in session `1eb6c4ba-7d56-4f6f-8f0e-87f16381431f`; the live UI showed `LIVE · PCM STREAMING`. |
| 32 kHz PCM16 | **PASS** | Browser reported a 48 kHz microphone track, 32 kHz AudioContext, mono PCM16 output, 549 frames and 8,784,000 payload bytes. |
| Resampling | **PASS** | Streaming 44.1/48→32 kHz and native 32 kHz regression cases pass. Runtime browser resampler average was 0.000 ms (rounded); packetization 0.003 ms, maximum callback 1.0 ms. |
| WebSocket continuity | **PASS** | Backend accepted 549 frames, next expected sequence 549, 100% continuity, no gaps, duplicates, or dropped frames. |
| BirdNET V3.0 | **PASS** | Session events report model version 3.0; 45/45 three-second windows inferred. Mean inference latency 143.22 ms; reported event-delivery estimate 297.02 ms; all queues empty at stop. |
| Silence handling | **PASS — deterministic test** | Browser session `16af8fd3-bc28-44fc-8b4a-092e0e51b8e5` sent exactly 12 ordered 32 kHz zero-PCM frames (3 s). Backend surfaced `is_silent=true`, `status=silent_skipped`, RMS 0, one silent segment, zero detections, zero persisted events, and zero inferred windows. Physical quiet-room capture is separately inconclusive; see below. |
| Animal classification | **PASS — event emission only** | Animal-typed BirdNET events were persisted and rendered. This verifies the classification path, not that labels are correct. |
| Sound-class classification | **PASS** | `Music` and `Train` observations remained `record_type=sound_class`; the frontend preserves that type and does not render them as birds. |
| Event timing | **PASS** | Backend `start_seconds`/`end_seconds` remain the three-second source window in the frontend; wall-clock receipt time is stored separately. UI copy says “3-second observation window.” |
| Event taxonomy | **PASS** | `event_type` (`type` on the WebSocket envelope), `class_label`, common/scientific names, score, `record_type`, `taxon_group`, session ID, and source times are preserved. The backend field is `taxon_group`; it has no separate `taxonomy` field. |
| Live browser rendering | **PASS** | Chrome rendered `Human (Homo sapiens)`, BirdNET score 0.54, source window 117–120 s, and session `1eb6c4ba-7d56-4f6f-8f0e-87f16381431f`. These match backend event `6f38f815-d3cc-4328-8ed2-2fb14f316638` (score 0.5419116, `record_type=animal`, `class_label=Homo sapiens_Human`). |
| Demo isolation | **PASS** | Synthetic detection/disturbance injection is explicitly marked demo-only, guarded while live, and cleared when a demo session transitions to live. The DEMO control is disabled during live capture; microphone failure stays offline. The one synthetic spectrogram preview is explicitly labeled as illustrative and not computed from audio. |
| Backend tests | **PASS** | Full suite: **187 passed, 1 skipped, 13 deselected**, 27 warnings. The earlier suite-load benchmark failure was not suppressed: the benchmark passed alone, 5/5, 10/10, and in the latest full run. Its earlier 136.9 ms result indicates suite-load timing sensitivity. |
| Frontend tests | **PASS** | Vitest: **14 files, 66 passed**. Updated a stale constants test to reflect removal of uncalibrated confidence tiers. Existing jsdom/WebGL and React `act(...)` warnings remain non-failing. |
| TypeScript | **PASS** | `tsc -b` completes without errors. |
| Production build | **PASS** | `vite build` completes. Vite warns that the main JS chunk is about 933 kB, above its 500 kB advisory threshold. |
| Clean shutdown | **PASS** | Browser returned to `OFFLINE · NO LIVE CLASSIFICATION`; backend status is stopped; 0 dropped frames/windows; queues empty. It processed 135 s of complete windows from 137.25 s received and discarded the final 72,000 samples (2.25 s) as a partial window. |

## Physical microphone silence measurement

For the preliminary quiet-room capture, 22 three-second microphone windows had RMS minimum **0.0068729474**, median **0.0110885083**, p95 **0.0460066182**, and maximum **0.0792766535**. The backend threshold is `1e-4`; none of those windows was close to digital zero. This means the capture was not silent at the microphone. RMS alone cannot separate room activity (A) from device/microphone noise floor (B); the environmental source was not isolated. The browser-to-backend digital-zero test confirms that the ring buffer, inference worker, and silent-window reporting work (C/D/E are not indicated as failures).

## Classification evidence

| Test | Source | Expected | Prediction | Timing aligned? | Attribution established? | Verdict |
|---|---|---|---|---|---|---|
| Test A — digital silence | Exact zero PCM from the browser acceptance page; 32 kHz mono, 12 frames, 3 s | No animal or sound-class event | `silent_skipped`, `is_silent=true`, RMS 0; 0 detections and 0 persisted events | Yes — one 0–3 s silent window | Yes — the source was exact zero PCM | **VERIFIED** |
| Test B — known recording | `backend/data/smoke_audio/birds_forest.ogg`, played from the browser into the live physical microphone; playback 2026-11-25 16:37:38.957–16:37:53.746 UTC (14.66 s) | Forest/bird acoustic activity during playback; no event-level species truth supplied | Bird labels included Willow Warbler (0.54), Goldcrest (0.60), Song Thrush (0.46), and Eurasian Nuthatch (0.33) in source windows 78–90 s; 90–93 s also overlapped the clip end | **Yes.** Session began 16:36:21.403145 UTC; playback offsets were 77.55–92.34 s. Windows 78–90 s fully overlapped playback; 90–93 s overlapped its final 2.34 s. | **No.** This was speaker-to-microphone playback with ambient sound, not isolated or line-level capture; the file has no independent event-level species labels. | **PLAUSIBLE** |
| Test C — speaker-off baseline | Same session, before clip playback (0–77.55 s); physical mic remained open | No playback-attributed bird prediction | No non-Human animal event before playback; ambient Human and sound-class labels were present | Yes — the baseline preceded the known playback | **No.** Ambient source and microphone noise were not isolated. | **INCONCLUSIVE** |
| Browser event rendering | Real backend session `1eb6c4ba-7d56-4f6f-8f0e-87f16381431f` | Display the actual backend event with type, names, raw score, source window, and session | UI showed `ANIMAL WINDOW DETECTION`, Human / *Homo sapiens*, score 0.54, window 117–120 s, matching backend event `6f38f815-d3cc-4328-8ed2-2fb14f316638` | Yes — label, score, session, and source window match | Yes — frontend-to-backend event identity is established; this does not establish the acoustic source | **VERIFIED** |

The known-recording result is a timing correlation, not an accuracy result. Before playback, the same session produced no non-Human animal labels; during playback it produced several bird labels. The clip was not source-isolated, and no event-level ground truth was available, so neither attribution to the clip nor species correctness is established.

## Demo, score, timing, and metadata audit

- Runtime synthetic detection examples are confined to `acousticStore.triggerDemoDetection`: Varied Thrush (0.89), Pacific Wren (0.92), and Hermit Warbler (0.84). Synthetic disturbances are confined to `triggerDemoDisturbance`; they have `isDemo=true` and no model score. Demo-only soundscape metrics are synthesized in `acousticFieldState` only when the source is `demo`. Explicit `+ TRACE` / `+ DISTURBANCE` controls are hidden while live, store methods return early during live sessions, and entering live clears demo queues and displayed traces.
- There is no live fallback event or fallback score. A missing disturbance score stays null; the Acoustic Field's constant render strength is visualization-only. The older Audio Intelligence `SpectrogramView` still draws synthetic bars, now labeled “Synthetic illustration · not computed from audio.” Hardcoded sample names elsewhere are test fixtures, not live output.
- UI detection scores use raw `BirdNET score` / `Model score` values, not percentages or calibrated confidence tiers. Percentages that remain are unrelated progress, audio-level, similarity, coverage, or soundscape metrics. Confidence-named fields remain in API/domain schemas where they represent the backend's raw model score; their live display label is explicit.
- Live mapping preserves the WebSocket `type` as `eventType`, original `class_label` as `classLabel`, common/scientific names, `record_type`, `taxon_group`, raw score, session ID, and source window. `receivedAtMs` is separate. No literal backend `taxonomy` property exists; `taxon_group` is preserved without defaulting unknown types to Bird. Visualization orbit/lift and field-shell direction are rendering geometry, not measured azimuth, elevation, distance, or frequency; the live detection DTO contains no `frequencyHz` or physical spatial measurements.

## Performance limits

Capture telemetry during the final live session: resampler average 0.000 ms (rounded), packetization average 0.003 ms, maximum callback 1.0 ms, WebSocket send average 0.034 ms. Backend continuity was 100%, with no dropped frames/windows, and its queues were empty at stop. Backend-reported mean inference latency was 143.22 ms and event-delivery estimate 297.02 ms. A numeric browser event-ingress-to-paint sample, WebSocket RTT, and FPS sample were not captured in this run; the UI did render a matching event. No claim is made about those unmeasured latency/FPS values.

## FINAL VERDICT

### ACCEPT WITH DOCUMENTED LIMITATIONS

The live acoustic pipeline is operational from physical microphone capture through BirdNET V3.0, event persistence, and visible browser rendering. Deterministic digital silence is verified. Model accuracy and source attribution are not validated; the physical quiet-room capture was not acoustically silent at the microphone, and browser FPS / render-latency figures were not sampled.

**Exact next step:** run a source-isolated, independently labeled playback trial with a documented speaker-off baseline and speaker-on interval before making event-attribution or species-accuracy claims. Keep Scenes 11–16 unopened until that evidence is collected.
