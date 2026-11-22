# EcoSonic 3.0 — Frontend API Integration Matrix

This matrix establishes the comprehensive integration mapping between the EcoSonic 3.0 React/TypeScript web application and the FastAPI bioacoustic backend (`integration/ecosonic-v1-release`, commit `fb397ee`).

---

## 1. System Health & Infrastructure

| UI Feature | Endpoint / Path | Method | Request Schema | Response Schema | Error Handling & Cases | Loading State | Empty State | Frontend Component |
|---|---|---|---|---|---|---|---|---|
| System Status & Model Node Telemetry | `/health` | `GET` | None | `{ status, service, version, model_version, model_ready, model_device, direct_onnx_engine }` | `500/Timeout` -> Displays "BACKEND DISCONNECTED" in red badge | Pulse indicator in header | Render "CONNECTING..." | `Header.tsx` |
| API Metadata | `/` | `GET` | None | `{ message, documentation, api_v1 }` | Log warning; fallback to defaults | Transparent | N/A | `Header.tsx` |

---

## 2. Unified Observatory (Home Screen)

| UI Feature | Endpoint / Path | Method | Request Schema | Response Schema | Error Handling & Cases | Loading State | Empty State | Frontend Component |
|---|---|---|---|---|---|---|---|---|
| Site Selector & Map Station Markers | `/api/v1/sites` | `GET` | None | `SiteResponse[]` (`id`, `name`, `latitude`, `longitude`, `location_sensitivity`, `generalized_latitude`, `generalized_longitude`, `ecosystem_category`) | `500` -> Banner with retry button | Skeleton card in drawer & spinner | "No monitoring stations registered. Register a station to start observing." | `Observatory.tsx`, `SiteMap.tsx` |
| Active Monitoring Sessions | `/api/v1/live/sessions` | `GET` | Query params: `status=active` | `LiveSessionResponse[]` | 404/500 -> Fallback to empty list | Shimmer badge | "No active live streaming sessions." | `Observatory.tsx` |
| Recent Biological Detections | `/api/v1/detections` | `GET` | Query params: `limit=10` | `DetectionResponse[]` | Network error banner | Shimmer list | "No bioacoustic detections recorded." | `Observatory.tsx` |
| Recent Disturbance Events | `/api/v1/environmental-incidents` | `GET` | Query params: `limit=5` | `EnvironmentalIncidentResponse[]` | Render empty list; notify user | Spinner | "No active environmental disturbance bouts." | `Observatory.tsx` |
| Soundscape Index Summary | `/api/v1/reports/summary` | `GET` | Query params: `site_id` | `SummaryReportResponse` | Fallback gracefully with error pill | Chart skeleton | "Awaiting soundscape baseline." | `Observatory.tsx` |

---

## 3. Live Monitoring & Audio Streaming

| UI Feature | Endpoint / Path | Method | Request Schema | Response Schema | Error Handling & Cases | Loading State | Empty State | Frontend Component |
|---|---|---|---|---|---|---|---|---|
| Quick Session Start | `/api/v1/live/sessions` | `POST` | `LiveSessionCreate` (`site_id`, `name`, `sample_rate: 32000`, `channels: 1`) | `LiveSessionResponse` | 400 (validation), 404 (site not found) -> Inline form error alert | Button spinner | Form input ready | `LiveMonitoring.tsx` |
| Audio Ingestion & Telemetry | `/api/v1/live/sessions/{session_id}/stream` | `WS` | Binary: 4-byte big-endian uint32 seq + 16-bit little-endian PCM (32 kHz mono). Text: `{ type: "handshake" | "start" | "pause" | "resume" | "stop" | "heartbeat" }` | JSON events: `handshake_ack`, `session_started`, `detection`, `processing_update`, `disturbance_event`, `soundscape_measurement`, `audio_quality_warning`, `session_stopped`, `error` | Auto-reconnect up to 3 times; graceful client-side termination if socket drops | "Connecting WebSocket..." banner | "Microphone standby. Click Start Live Stream to begin." | `LiveMonitoring.tsx`, `audioStreamer.ts` |
| Session Termination | `/api/v1/live/sessions/{session_id}/stop` | `POST` | None | `LiveSessionResponse` | Network error -> Forces client-side audio hardware release | "Finalizing session..." | Session stopped summary card | `LiveMonitoring.tsx` |
| Live Session Timeline | `/api/v1/live/sessions/{session_id}/timeline` | `GET` | None | `TimelineItemResponse[]` | 404 -> Alert user session expired | Skeleton timeline | "No events recorded in session." | `LiveMonitoring.tsx` |
| Real-time Soundscape Measurement | `/api/v1/live/sessions/{session_id}/soundscape` | `GET` | None | `SoundscapeFingerprintResponse` | 404 -> Empty stats card | Placeholder gauge | "Accumulating 10s audio window..." | `LiveMonitoring.tsx` |

---

## 4. Audio Intelligence (Analysis & Detections)

| UI Feature | Endpoint / Path | Method | Request Schema | Response Schema | Error Handling & Cases | Loading State | Empty State | Frontend Component |
|---|---|---|---|---|---|---|---|---|
| Audio Recording Upload | `/api/v1/analyses` | `POST` | `multipart/form-data`: `file`, `site_id`, `latitude`, `longitude`, `confidence_threshold` | `AnalysisResponse` | 400 (corrupt/invalid audio format), 413 (too large) -> Upload rejection alert | Upload progress bar (%) | Dropzone file picker | `AudioIntelligence.tsx` |
| Processing Status & Pipeline Progress | `/api/v1/analyses/{analysis_id}/status` | `GET` | None | `AnalysisStatusResponse` (`status`, `progress`, `current_stage`, `error_message`) | Polling timeout / 500 -> Show failure alert | Progress bar animation | N/A | `AudioIntelligence.tsx` |
| Biological Detections Table | `/api/v1/analyses/{analysis_id}/detections` | `GET` | None | `DetectionResponse[]` | Network error alert | Table skeleton | "No species detected above confidence threshold." | `AudioIntelligence.tsx` |
| Ecoacoustic Audio Inspection | `/api/v1/acoustic/inspect/{analysis_id}` | `GET` | None | `AcousticInspectionResponse` | 404 -> Fallback to file duration | Loading waveform | "Audio inspection metadata unavailable." | `AudioIntelligence.tsx` |
| Audio Playback Stream | `/api/v1/acoustic/stream/{analysis_id}` | `GET` | None | `audio/wav` stream | Audio decoding failure alert | WaveSurfer loading bar | Placeholder audio bar | `AudioIntelligence.tsx`, `WaveformPlayer.tsx` |

---

## 5. Disturbance Radar & Incident Investigation

| UI Feature | Endpoint / Path | Method | Request Schema | Response Schema | Error Handling & Cases | Loading State | Empty State | Frontend Component |
|---|---|---|---|---|---|---|---|---|
| Disturbance Taxonomy & Thresholds | `/api/v1/live/disturbances/taxonomy` | `GET` | None | `TaxonomyResponse` | Fallback to built-in standard categories | Transparent | Standard categories | `DisturbanceRadar.tsx` |
| Consolidated Incident Bouts | `/api/v1/environmental-incidents` | `GET` | Query params: `site_id`, `priority`, `status`, `category` | `EnvironmentalIncidentResponse[]` | Error banner with retry | Card skeletons | "No environmental disturbance bouts recorded for this site." | `DisturbanceRadar.tsx`, `IncidentManagement.tsx` |
| Incident Status Update | `/api/v1/environmental-incidents/{incident_id}` | `PATCH` | `{ status, investigation_notes, resolution_notes }` | `EnvironmentalIncidentResponse` | 404/422 -> Modal notification | Button saving state | N/A | `IncidentManagement.tsx` |
| Disturbance Event Human Review | `/api/v1/environmental-events/{event_id}/review` | `POST` | `ReviewCreate` (`review_status`, `reviewer_note`) | `ReviewResponse` | 400 -> Error banner | Submitting spinner | N/A | `DisturbanceRadar.tsx` |

---

## 6. Soundscape Intelligence & Fingerprints

| UI Feature | Endpoint / Path | Method | Request Schema | Response Schema | Error Handling & Cases | Loading State | Empty State | Frontend Component |
|---|---|---|---|---|---|---|---|---|
| Latest Soundscape Fingerprint | `/api/v1/live/sessions/{session_id}/fingerprint` | `GET` | None | `SoundscapeFingerprintResponse` (`metrics`, `frequency_bands`, `quality_flags`) | 404 -> Fallback to blank chart | Chart skeleton | "No soundscape measurements recorded." | `SoundscapeIntelligence.tsx` |
| Historical Ecoacoustic Metrics | `/api/v1/sites/{site_id}/history` | `GET` | None | `SiteHistoryResponse` | 404 -> Notification of no data | Chart shimmer | "Insufficient acoustic history for selected site." | `SoundscapeIntelligence.tsx` |

---

## 7. Acoustic Memory & Vector Search

| UI Feature | Endpoint / Path | Method | Request Schema | Response Schema | Error Handling & Cases | Loading State | Empty State | Frontend Component |
|---|---|---|---|---|---|---|---|---|
| FAISS Index Status | `/api/v1/acoustic-memory/index/status` | `GET` | None | `IndexStatusResponse` (`total_vectors`, `vector_dimension`, `index_type`, `model_version`, `is_trained`) | 500 -> Badge "Index Offline" | Metric skeleton | "Vector index empty (0 embeddings)." | `AcousticMemory.tsx` |
| FAISS Index Rebuild | `/api/v1/acoustic-memory/index/rebuild` | `POST` | None | `{ status, total_vectors }` | Failure notification | Button spinning "Rebuilding..." | Ready button | `AcousticMemory.tsx` |
| 2D UMAP Projection Coordinates | `/api/v1/acoustic-memory/projection` | `GET` | None | `ProjectionResponse` (`points: [{ id, segment_id, x, y, cluster_id, label, confidence }]`) | 404 (insufficient points) -> Explanatory alert | Scatterplot shimmer | "Insufficient embeddings (< 15 vectors) to generate 2D UMAP projection." | `AcousticMemory.tsx` |
| HDBSCAN Clustering Execution | `/api/v1/acoustic-memory/clusters/run` | `POST` | `{ min_cluster_size, min_samples }` | `ClusteringRunResponse` | 422 -> Error alert with parameter hints | "Clustering in progress..." | Parameter inputs | `AcousticMemory.tsx` |
| Acoustic Vector Similarity Search | `/api/v1/acoustic-memory/search` | `POST` | `{ segment_id, k, min_similarity }` | `SearchResultResponse[]` | 404 (segment not found) -> Inline message | Results skeleton | "Select an acoustic segment to discover nearest neighbors." | `AcousticMemory.tsx` |
| Segment Snippet Audio Stream | `/api/v1/acoustic-memory/segments/{segment_id}/audio` | `GET` | None | `audio/wav` binary stream | 404 -> Audio unavailable message | Player buffering | Audio controls | `AcousticMemory.tsx` |

---

## 8. Acoustic Anomaly Investigation

| UI Feature | Endpoint / Path | Method | Request Schema | Response Schema | Error Handling & Cases | Loading State | Empty State | Frontend Component |
|---|---|---|---|---|---|---|---|---|
| Ranked Anomaly Candidates | `/api/v1/live/sessions/{session_id}/anomalies` | `GET` | None | `AnomalyCandidateResponse[]` (`candidate_id`, `anomaly_score`, `heuristic_breakdown`, `primary_reasons`, `disclaimer`) | 404 -> Empty list | Card skeleton | "No acoustic anomaly candidates identified for session." | `AcousticAnomaly.tsx` |
| Heuristic Component Decomposition | `/api/v1/live/sessions/{session_id}/anomalies` | `GET` | Embedded breakdown: `knn_distance`, `spectral_entropy`, `model_ambiguity` | Decomposed metrics | N/A | Sub-card skeleton | "Candidate decomposition pending." | `AcousticAnomaly.tsx` |

---

## 9. Habitat Drift & Ecological Trajectory

| UI Feature | Endpoint / Path | Method | Request Schema | Response Schema | Error Handling & Cases | Loading State | Empty State | Frontend Component |
|---|---|---|---|---|---|---|---|---|
| Site Habitat Drift Assessment | `/api/v1/sites/{site_id}/habitat-drift` | `GET` | None | `HabitatDriftSummaryResponse` (`overall_habitat_trend`, `biophony_trend`, `anthrophony_trend`, `stability_index`, `recent_comparisons`, `disclaimer`) | 400/404 -> Renders structured "Insufficient Baseline" state (< 3 sessions) | Shimmer panels | "Insufficient baseline recordings (< 3 sessions) to compute robust habitat drift." | `HabitatDrift.tsx` |
| Geographic Species Context | `/api/v1/sites/{site_id}/geo-context` | `GET` | None | `SiteGeoContextResponse` (`expected_species_count`, `top_regional_species`) | 404 -> Fallback to uncontextualized | Card skeleton | "Geographic species context unavailable for site coordinates." | `HabitatDrift.tsx` |

---

## 10. Human Review Lab

| UI Feature | Endpoint / Path | Method | Request Schema | Response Schema | Error Handling & Cases | Loading State | Empty State | Frontend Component |
|---|---|---|---|---|---|---|---|---|
| Unreviewed Detection Queue | `/api/v1/detections` | `GET` | `review_status=unreviewed&limit=25` | `DetectionResponse[]` | Error banner with retry | List skeleton | "Review queue empty. All biological detections verified." | `ReviewLab.tsx` |
| Human Verification Submission | `/api/v1/detections/{detection_id}/reviews` | `POST` | `ReviewCreate` (`review_status: confirmed \| rejected \| uncertain \| needs_evidence`, `reviewer_note`) | `ReviewResponse` | 400/422 -> Rejection message | Button spinner | Form inputs ready | `ReviewLab.tsx` |
| Historical Review Audit Log | `/api/v1/environmental-reviews` | `GET` | None | `ReviewAuditResponse[]` | Notification alert | Table skeleton | "No historical review logs recorded." | `ReviewLab.tsx` |

---

## 11. Reports & Data Exports

| UI Feature | Endpoint / Path | Method | Request Schema | Response Schema | Error Handling & Cases | Loading State | Empty State | Frontend Component |
|---|---|---|---|---|---|---|---|---|
| Platform Summary Metrics | `/api/v1/reports/summary` | `GET` | `site_id` | `SummaryReportResponse` | Fallback cards | Shimmer stats | All metrics zeroed | `ReportsExports.tsx` |
| Research Data File Download | `/api/v1/reports/export` | `GET` | `export_type=detections\|disturbances\|soundscape\|habitat_drift&format=csv\|json&site_id&start_date&end_date` | `blob` (CSV or JSON download) | 400/500 -> Toast notification "Export failed" | Button "Generating Export..." | Export buttons ready | `ReportsExports.tsx` |
