import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const BACKEND_PORT = 8000;
const BACKEND_HTTP = `http://127.0.0.1:${BACKEND_PORT}`;
const BACKEND_WS = `ws://127.0.0.1:${BACKEND_PORT}`;
const PYTHON_BIN = 'C:\\Users\\apaar\\Desktop\\ECOBIRDS\\.venv\\Scripts\\python.exe';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHttp(url, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 200) return true;
    } catch {}
    await sleep(400);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

/**
 * Builds a 32 kHz PCM16 test audio frame with 4-byte sequence number header.
 */
function createTestFrame(seq, durationMs = 250, sampleRate = 32000, freqHz = 3200) {
  const sampleCount = Math.floor((sampleRate * durationMs) / 1000); // 8,000 samples
  const buffer = new ArrayBuffer(4 + sampleCount * 2); // 16,004 bytes
  const view = new DataView(buffer);

  // Big-endian uint32 sequence header
  view.setUint32(0, seq >>> 0, false);

  // PCM16 little-endian audio samples (3.2 kHz test tone @ -12 dBFS)
  const amplitude = 8000;
  for (let i = 0; i < sampleCount; i++) {
    const sample = Math.round(amplitude * Math.sin((2 * Math.PI * freqHz * i) / sampleRate));
    view.setInt16(4 + i * 2, sample, true);
  }

  return buffer;
}

async function runEndToEndBackendIntegration() {
  console.log('================================================================');
  console.log('    ECOSONIC 3.0 — PHASE 8 END-TO-END BACKEND INTEGRATION QA    ');
  console.log('================================================================');

  let backendProc = null;
  let backendStartedByTest = false;

  try {
    // 1. Check if backend is already listening, or start it
    let isLive = false;
    try {
      const res = await fetch(`${BACKEND_HTTP}/health`);
      if (res.ok) isLive = true;
    } catch {}

    if (!isLive) {
      console.log(`[Phase 8] Starting FastAPI backend on port ${BACKEND_PORT}...`);
      backendProc = spawn(
        PYTHON_BIN,
        ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT)],
        {
          cwd: 'C:\\Users\\apaar\\Desktop\\ECOBIRDS\\backend',
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: true,
        }
      );
      backendStartedByTest = true;

      backendProc.stdout.on('data', (d) => {
        const text = d.toString();
        if (text.includes('Application startup complete') || text.includes('Uvicorn running')) {
          process.stdout.write(`[Backend] ${text}`);
        }
      });
      backendProc.stderr.on('data', (d) => process.stderr.write(`[Backend ERR] ${d}`));

      await waitForHttp(`${BACKEND_HTTP}/health`, 30000);
      console.log(`[Phase 8] FastAPI backend ready at ${BACKEND_HTTP}`);
    } else {
      console.log(`[Phase 8] FastAPI backend already active at ${BACKEND_HTTP}`);
    }

    // -------------------------------------------------------------------------
    // TEST 1: SYSTEM HEALTH & DIRECT ONNX INSPECTION
    // -------------------------------------------------------------------------
    console.log('\n--- 1. SYSTEM HEALTH & DIRECT ONNX READINESS ---');
    const healthRes = await fetch(`${BACKEND_HTTP}/health`);
    assert.equal(healthRes.status, 200, 'Health endpoint must return 200 OK');
    const health = await healthRes.json();

    assert.equal(health.status, 'healthy');
    const engineReady =
      health.direct_onnx_engine?.is_ready === true ||
      health.direct_onnx_engine?.initialized === true ||
      health.model_ready === true;
    assert.ok(engineReady, 'BirdNET Direct ONNX Engine or Model must be ready');
    console.log(`  [PASS] Service: ${health.service} (${health.version})`);
    console.log(`  [PASS] Model: ${health.model_version} on ${health.direct_onnx_engine?.device || health.model_device}`);
    console.log(`  [PASS] Direct ONNX Engine: ready=${health.direct_onnx_engine?.is_ready}, classes=${health.direct_onnx_engine?.class_count || health.direct_onnx_engine?.num_classes}`);

    // -------------------------------------------------------------------------
    // TEST 2: LIVE SESSION CREATION VIA REST
    // -------------------------------------------------------------------------
    console.log('\n--- 2. LIVE SESSION CREATION VIA REST ---');
    const createPayload = {
      source_type: 'browser_mic',
      device_id: 'phase8_qa_worklet',
      sample_rate: 32000,
      channels: 1,
      latitude: 45.5017,
      longitude: -73.5673,
    };

    const createRes = await fetch(`${BACKEND_HTTP}/api/v1/live/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createPayload),
    });
    assert.equal(createRes.status, 201, 'POST /api/v1/live/sessions must return 201 Created');
    const session = await createRes.json();

    assert.ok(session.id, 'Session must return an authoritative UUID');
    assert.equal(session.source_type, 'browser_mic');
    assert.equal(session.sample_rate, 32000);
    assert.equal(session.channels, 1);
    assert.equal(session.status, 'created');
    console.log(`  [PASS] Created live session ${session.id} (status: ${session.status})`);

    // -------------------------------------------------------------------------
    // TEST 3: LIST LIVE SESSIONS & RETRIEVE DETAIL
    // -------------------------------------------------------------------------
    console.log('\n--- 3. SESSIONS LIST & DETAIL RETRIEVAL ---');
    const listRes = await fetch(`${BACKEND_HTTP}/api/v1/live/sessions?limit=10`);
    assert.equal(listRes.status, 200);
    const sessionList = await listRes.json();
    assert.ok(Array.isArray(sessionList) && sessionList.length > 0);
    const found = sessionList.some((s) => s.id === session.id);
    assert.ok(found, 'Created session must appear in session list');
    console.log(`  [PASS] Retrieved ${sessionList.length} active/recent sessions. Target session verified.`);

    const detailRes = await fetch(`${BACKEND_HTTP}/api/v1/live/sessions/${session.id}`);
    assert.equal(detailRes.status, 200);
    const detail = await detailRes.json();
    assert.equal(detail.id, session.id);
    assert.ok(Array.isArray(detail.events));
    assert.ok(Array.isArray(detail.segments));
    console.log(`  [PASS] Session detail verified: sample_rate=${detail.sample_rate}, channels=${detail.channels}`);

    // -------------------------------------------------------------------------
    // TEST 4: WEBSOCKET STREAMING & 32 kHz PCM16 INGESTION
    // -------------------------------------------------------------------------
    console.log('\n--- 4. WEBSOCKET STREAMING & 32 kHz PCM16 PIPELINE ---');
    const wsUrl = `${BACKEND_WS}/api/v1/live/sessions/${session.id}/stream`;
    console.log(`  Connecting WebSocket: ${wsUrl}...`);

    const receivedEvents = [];
    let handshakeAckReceived = false;
    let heartbeatAckReceived = false;

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket connection or streaming test timed out'));
      }, 20000);

      ws.onopen = async () => {
        console.log('  [PASS] WebSocket connected successfully');
        // 1. Send handshake
        ws.send(JSON.stringify({ type: 'handshake' }));

        // 2. Stream 24 chunks (6.0 seconds of audio @ 250ms = 2 full 3.0s windows)
        for (let seq = 0; seq < 24; seq++) {
          const frame = createTestFrame(seq, 250, 32000, 3200); // 3.2 kHz tone
          ws.send(frame);
          await sleep(60); // fast streaming
        }

        // 3. Send heartbeat
        ws.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() / 1000 }));

        // Wait for server processing updates
        await sleep(2500);

        // 4. Send stop
        ws.send(JSON.stringify({ type: 'stop' }));
        await sleep(500);
        ws.close();
      };

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const data = JSON.parse(event.data);
            receivedEvents.push(data);
            if (data.type === 'handshake_ack') {
              handshakeAckReceived = true;
              console.log(`  [PASS] Received handshake_ack (expected_seq: ${data.expected_seq})`);
            } else if (data.type === 'heartbeat_ack') {
              heartbeatAckReceived = true;
              console.log(`  [PASS] Received heartbeat_ack`);
            } else if (data.type === 'processing_update') {
              console.log(`  [PASS] Received processing_update: window=${data.window_index}, processed_s=${data.processed_seconds}, is_silent=${data.is_silent}, status=${data.status}`);
            } else if (data.type === 'soundscape_measurement') {
              console.log(`  [PASS] Received soundscape_measurement: ACI=${data.metrics?.aci}, NDSI=${data.metrics?.ndsi}`);
            } else if (data.type === 'detection') {
              console.log(`  [PASS] Received detection: ${data.common_name} (${data.confidence_score})`);
            }
          } catch {}
        }
      };

      ws.onerror = (err) => {
        clearTimeout(timeout);
        reject(err);
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        resolve();
      };
    });

    assert.ok(handshakeAckReceived, 'Must receive handshake_ack from server');
    assert.ok(heartbeatAckReceived, 'Must receive heartbeat_ack from server');
    const processingUpdates = receivedEvents.filter((e) => e.type === 'processing_update');
    assert.ok(processingUpdates.length >= 1, `Must receive at least 1 processing_update (received ${processingUpdates.length})`);

    // -------------------------------------------------------------------------
    // TEST 5: SESSION STOP & DATABASE PERSISTENCE
    // -------------------------------------------------------------------------
    console.log('\n--- 5. SESSION STOP & PERSISTENCE VALIDATION ---');
    const stopRes = await fetch(`${BACKEND_HTTP}/api/v1/live/sessions/${session.id}/stop`, {
      method: 'POST',
    });
    assert.equal(stopRes.status, 200, 'POST /stop must return 200 OK');
    const stoppedSession = await stopRes.json();
    assert.equal(stoppedSession.status, 'stopped');
    assert.ok(stoppedSession.stopped_at, 'stopped_at timestamp must be populated');
    console.log(`  [PASS] Session stopped cleanly: processed_audio_seconds=${stoppedSession.processed_audio_seconds}`);

    // Verify persisted session records via REST
    const reloadedDetailRes = await fetch(`${BACKEND_HTTP}/api/v1/live/sessions/${session.id}`);
    assert.equal(reloadedDetailRes.status, 200);
    const reloadedDetail = await reloadedDetailRes.json();
    assert.equal(reloadedDetail.status, 'stopped');
    assert.ok(reloadedDetail.processed_audio_seconds >= 3.0, 'Persisted processed audio must be >= 3.0s');
    console.log(`  [PASS] Persisted detail confirmed: ${reloadedDetail.processed_audio_seconds}s audio, segments=${reloadedDetail.segments_count}, events=${reloadedDetail.events_count}`);

    // Verify soundscape measurements via REST
    const soundscapeRes = await fetch(`${BACKEND_HTTP}/api/v1/live/sessions/${session.id}/soundscape`);
    assert.equal(soundscapeRes.status, 200);
    const measurements = await soundscapeRes.json();
    assert.ok(Array.isArray(measurements));
    console.log(`  [PASS] Soundscape measurements retrieved: ${measurements.length} recorded measurements`);

    // -------------------------------------------------------------------------
    // TEST 6: DISTURBANCES & TIMELINE ENDPOINTS
    // -------------------------------------------------------------------------
    console.log('\n--- 6. DISTURBANCES & TIMELINE REST VALIDATION ---');
    const distRes = await fetch(`${BACKEND_HTTP}/api/v1/live/sessions/${session.id}/disturbances`);
    assert.equal(distRes.status, 200);
    const disturbances = await distRes.json();
    assert.ok(Array.isArray(disturbances));
    console.log(`  [PASS] Disturbance query verified (${disturbances.length} events returned)`);

    const timelineRes = await fetch(`${BACKEND_HTTP}/api/v1/live/sessions/${session.id}/timeline`);
    assert.equal(timelineRes.status, 200);
    const timeline = await timelineRes.json();
    assert.ok(Array.isArray(timeline));
    console.log(`  [PASS] Unified timeline verified (${timeline.length} timeline items returned)`);

    console.log('\n================================================================');
    console.log('  ALL END-TO-END BACKEND INTEGRATION CHECKS PASSED (CODE 0)     ');
    console.log('================================================================');
  } catch (err) {
    console.error('\n[Phase 8 QA FAILED]', err);
    process.exitCode = 1;
  } finally {
    if (backendProc && backendStartedByTest) {
      console.log('[Phase 8] Shutting down test backend process...');
      try {
        backendProc.kill();
      } catch {}
    }
  }
}

runEndToEndBackendIntegration();
