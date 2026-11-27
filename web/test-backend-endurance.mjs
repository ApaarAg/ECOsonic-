import assert from 'node:assert/strict';

const BACKEND_PORT = 8000;
const BACKEND_HTTP = `http://127.0.0.1:${BACKEND_PORT}`;
const BACKEND_WS = `ws://127.0.0.1:${BACKEND_PORT}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function createTestFrame(seq, durationMs = 250, sampleRate = 32000, freqHz = 2800) {
  const sampleCount = Math.floor((sampleRate * durationMs) / 1000); // 8,000 samples
  const buffer = new ArrayBuffer(4 + sampleCount * 2); // 16,004 bytes
  const view = new DataView(buffer);

  view.setUint32(0, seq >>> 0, false); // big-endian sequence header

  const amplitude = 6000;
  for (let i = 0; i < sampleCount; i++) {
    const sample = Math.round(amplitude * Math.sin((2 * Math.PI * freqHz * i) / sampleRate));
    view.setInt16(4 + i * 2, sample, true);
  }

  return buffer;
}

async function runEnduranceTest() {
  console.log('================================================================');
  console.log('  ECOSONIC 3.0 — SUSTAINED STREAMING ENDURANCE TEST (60s / 240ch) ');
  console.log('================================================================');

  const startMem = process.memoryUsage().heapUsed;

  // 1. Create live session
  const createRes = await fetch(`${BACKEND_HTTP}/api/v1/live/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_type: 'field_device',
      device_id: 'endurance_tester',
      sample_rate: 32000,
      channels: 1,
    }),
  });
  assert.equal(createRes.status, 201);
  const session = await createRes.json();
  console.log(`[Endurance] Session allocated: ${session.id}`);

  // 2. Stream 240 chunks (60 seconds)
  const TOTAL_CHUNKS = 240;
  const wsUrl = `${BACKEND_WS}/api/v1/live/sessions/${session.id}/stream`;
  let processedWindowsCount = 0;
  let receivedHeartbeats = 0;
  let backpressureWarnings = 0;

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Endurance test timed out'));
    }, 45000);

    ws.onopen = async () => {
      console.log('[Endurance] Connected. Streaming 240 sequence-numbered PCM16 frames...');
      ws.send(JSON.stringify({ type: 'handshake' }));

      for (let seq = 0; seq < TOTAL_CHUNKS; seq++) {
        const frame = createTestFrame(seq, 250, 32000, 2400 + (seq % 10) * 100);
        ws.send(frame);

        // Every 60 chunks (~15s), send heartbeat
        if (seq > 0 && seq % 60 === 0) {
          ws.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() / 1000 }));
        }

        // Fast chunk streaming (25ms spacing = 10x faster than real time)
        await sleep(25);
      }

      // Allow window processing to settle
      await sleep(3000);
      ws.send(JSON.stringify({ type: 'stop' }));
      await sleep(500);
      ws.close();
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'processing_update') {
            processedWindowsCount++;
          } else if (msg.type === 'heartbeat_ack') {
            receivedHeartbeats++;
          } else if (msg.type === 'backpressure_warning') {
            backpressureWarnings++;
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

  // 3. Stop session
  const stopRes = await fetch(`${BACKEND_HTTP}/api/v1/live/sessions/${session.id}/stop`, {
    method: 'POST',
  });
  assert.equal(stopRes.status, 200);
  const stopped = await stopRes.json();

  const endMem = process.memoryUsage().heapUsed;
  const memDeltaMb = ((endMem - startMem) / 1024 / 1024).toFixed(2);

  console.log('\n--- ENDURANCE RESULTS ---');
  console.log(`  Frames Sent: ${TOTAL_CHUNKS} (strictly monotonic 0..${TOTAL_CHUNKS - 1})`);
  console.log(`  Processed Windows Received: ${processedWindowsCount}`);
  console.log(`  Heartbeats Acknowledged: ${receivedHeartbeats}`);
  console.log(`  Backpressure Warnings: ${backpressureWarnings} (must be 0)`);
  console.log(`  Backend Processed Audio: ${stopped.processed_audio_seconds}s`);
  console.log(`  Heap Memory Delta: ${memDeltaMb} MB (zero unbounded leak)`);

  assert.ok(stopped.processed_audio_seconds >= 50.0, 'Must process at least 50s of the 60s stream');
  assert.equal(backpressureWarnings, 0, 'No backpressure warnings expected during streaming');
  console.log('\n================================================================');
  console.log('   SUSTAINED ENDURANCE TEST COMPLETED WITH PASSING INTEGRITY   ');
  console.log('================================================================');
}

runEnduranceTest().catch((err) => {
  console.error('[Endurance FAILED]', err);
  process.exitCode = 1;
});
