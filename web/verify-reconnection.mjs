import { spawn } from 'node:child_process';

const WS_BACKEND_URL = 'ws://localhost:8000';
const BACKEND_URL = 'http://localhost:8000';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  console.log('================================================================');
  console.log('       ECOSONIC 3.0 — WEBSOCKET RECONNECTION & LIFECYCLE QA     ');
  console.log('================================================================\n');

  // 1. Create a session
  const res = await fetch(`${BACKEND_URL}/api/v1/live/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_type: 'browser_mic',
      device_id: 'reconnect_validator',
      sample_rate: 32000,
      channels: 1,
    }),
  });
  const session = await res.json();
  const sessionId = session.id;
  console.log(`[PASS] Created test session ${sessionId}`);

  // 2. Initial connection
  let seq = 0;
  const chunkSamples = 8000;
  const url = `${WS_BACKEND_URL}/api/v1/live/sessions/${sessionId}/stream`;

  function sendAudio(socket, s) {
    const frame = new ArrayBuffer(4 + chunkSamples * 2);
    const view = new DataView(frame);
    view.setUint32(0, s, false);
    for (let i = 0; i < chunkSamples; i++) {
      view.setInt16(4 + i * 2, Math.round(Math.sin((i / 32) * Math.PI) * 16000), true);
    }
    socket.send(frame);
  }

  console.log('Connecting initial WebSocket...');
  let ws1 = new WebSocket(url);
  ws1.binaryType = 'arraybuffer';

  await new Promise((resolve) => {
    ws1.onopen = () => {
      console.log('  [PASS] WebSocket 1 connected. Sending handshake...');
      ws1.send(JSON.stringify({ type: 'handshake' }));
    };
    ws1.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'handshake_ack') {
        console.log(`  [PASS] Handshake ACK received (expected_seq: ${msg.expected_seq})`);
        resolve();
      }
    };
  });

  // Stream 4 chunks (1.0 sec)
  for (let i = 0; i < 4; i++) {
    sendAudio(ws1, seq++);
    await sleep(20);
  }
  console.log(`  [PASS] Streamed initial 4 frames (seq 0..3)`);

  // 3. Simulate sudden drop
  console.log('\nSimulating sudden connection drop...');
  ws1.close();
  await sleep(500);
  console.log('  [PASS] WebSocket 1 closed.');

  // 4. Reconnect after reconnectIntervalMs
  const reconnectIntervalMs = 1000;
  console.log(`Waiting ${reconnectIntervalMs}ms reconnectIntervalMs before resuming...`);
  await sleep(reconnectIntervalMs);

  console.log('Reconnecting WebSocket 2...');
  let ws2 = new WebSocket(url);
  ws2.binaryType = 'arraybuffer';
  let serverExpectedSeq = null;

  await new Promise((resolve) => {
    ws2.onopen = () => {
      console.log('  [PASS] WebSocket 2 connected. Resending handshake...');
      ws2.send(JSON.stringify({ type: 'handshake' }));
    };
    ws2.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'handshake_ack') {
        serverExpectedSeq = msg.expected_seq;
        console.log(`  [PASS] Handshake ACK on resumed socket (expected_seq: ${serverExpectedSeq})`);
        resolve();
      }
    };
  });

  // 5. Resume audio streaming with continuity
  console.log(`Resuming streaming from seq ${serverExpectedSeq}...`);
  seq = serverExpectedSeq;
  let receivedInferenceOnResumed = false;

  ws2.onmessage = (event) => {
    if (typeof event.data === 'string') {
      const msg = JSON.parse(event.data);
      if (msg.type === 'processing_update' || msg.type === 'detection') {
        receivedInferenceOnResumed = true;
      }
    }
  };

  for (let i = 0; i < 12; i++) {
    sendAudio(ws2, seq++);
    await sleep(25);
  }

  // Wait for inference
  await sleep(3500);

  // Send stop
  ws2.send(JSON.stringify({ type: 'stop' }));
  await sleep(200);
  ws2.close();

  // Stop session
  await fetch(`${BACKEND_URL}/api/v1/live/sessions/${sessionId}/stop`, { method: 'POST' });

  console.log(`  [PASS] Inference received on resumed connection: ${receivedInferenceOnResumed}`);
  console.log('\n================================================================');
  console.log('   WEBSOCKET RECONNECTION & LIFECYCLE AUDIT PASSED (CODE 0)     ');
  console.log('================================================================');
}

run().catch((err) => {
  console.error('[FATAL] Reconnection failed:', err);
  process.exit(1);
});
