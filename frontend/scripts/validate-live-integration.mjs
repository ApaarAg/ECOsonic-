import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const executablePath = fs.existsSync(CHROME_PATH) ? CHROME_PATH : EDGE_PATH;

const WAV_FIXTURE =
  process.env.ECOSONIC_TEST_WAV ||
  "C:\\Users\\apaar\\Desktop\\ECOBIRDS\\backend\\storage\\processed\\a038f195-cf70-4ac8-8398-f6f6299e5624\\audio_mono_32k.wav";

const API_URL = process.env.ECOSONIC_API_URL || "http://127.0.0.1:8000";

async function waitForServer(url, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const viteServer = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vite", "--host", "127.0.0.1", "--port", "4174", "--strictPort"],
  {
    stdio: "ignore",
    shell: true,
    env: {
      ...process.env,
      VITE_ECOSONIC_API_URL: API_URL,
    },
  },
);

try {
  await waitForServer(`${API_URL}/health`);
  const healthRes = await fetch(`${API_URL}/health`);
  const health = await healthRes.json();

  await waitForServer("http://127.0.0.1:4174/");

  // 1. Deterministic live-stream test with real WAV audio through AudioWorklet -> 32kHz PCM16 -> FastAPI -> BirdNET ONNX
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--no-sandbox",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${WAV_FIXTURE}`,
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ["microphone"],
  });
  const page = await context.newPage();

  const errors = [];
  const wsFrames = { sentBinary: 0, sentText: 0, receivedText: [] };
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });
  page.on("websocket", (ws) => {
    ws.on("framesent", (frame) => {
      if (typeof frame.payload === "string") wsFrames.sentText += 1;
      else wsFrames.sentBinary += 1;
    });
    ws.on("framereceived", (frame) => {
      if (typeof frame.payload === "string") {
        try {
          wsFrames.receivedText.push(JSON.parse(frame.payload));
        } catch {
          // ignore
        }
      }
    });
  });

  await page.goto("http://127.0.0.1:4174/", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  // State A: No acoustic energy (SILENCE)
  await page.getByRole("button", { name: /^SILENCE$/i }).click();
  await page.waitForTimeout(600);
  const stateAText = await page.evaluate(() => document.body.innerText);

  // Install per-frame rAF sampler during active backend inference
  await page.evaluate(() => {
    window.__FRAME_DELTAS__ = [];
    let last = performance.now();
    window.__COLLECT_FRAMES__ = true;
    function sample(now) {
      const dt = now - last;
      last = now;
      if (dt > 0 && dt < 500) {
        window.__FRAME_DELTAS__.push(dt);
      }
      if (window.__COLLECT_FRAMES__) {
        requestAnimationFrame(sample);
      }
    }
    requestAnimationFrame(sample);
  });

  // State B/C/D: Live acoustic activity -> BirdNET detection & disturbance
  await page.getByRole("button", { name: /^MIC/i }).click();

  // Exercise subtle cursor parallax & interaction while inference runs
  await page.mouse.move(420, 320);
  await page.waitForTimeout(1500);
  await page.mouse.move(980, 520, { steps: 10 });
  await page.waitForTimeout(5000);

  await page.screenshot({
    path: path.resolve("docs/screenshots/scene01-1440x900-live.png"),
  });

  const liveMetrics = await page.evaluate(() => {
    window.__COLLECT_FRAMES__ = false;
    const deltas = (window.__FRAME_DELTAS__ || []).slice().sort((a, b) => a - b);
    const n = deltas.length;
    const medianDt = n ? deltas[Math.floor(n / 2)] : 0;
    const p95Dt = n ? deltas[Math.min(n - 1, Math.floor(n * 0.95))] : 0;
    const maxDt = n ? deltas[n - 1] : 0;
    return {
      frameCount: n,
      medianFps: medianDt > 0 ? Number((1000 / medianDt).toFixed(1)) : 0,
      minFps: maxDt > 0 ? Number((1000 / maxDt).toFixed(1)) : 0,
      p95FrameTimeMs: Number(p95Dt.toFixed(2)),
      maxFrameTimeMs: Number(maxDt.toFixed(2)),
      diag: window.__ECOSONIC_DIAGNOSTICS__?.() ?? null,
      text: document.body.innerText,
      canvases: document.querySelectorAll("canvas").length,
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      demoControlsPresentInLive:
        document.body.innerText.includes("+ TRACE") ||
        document.body.innerText.includes("+ DISTURBANCE"),
    };
  });

  // State E: Return to silence
  await page.getByRole("button", { name: /^SILENCE$/i }).click();
  await page.waitForTimeout(1400);
  const stateEText = await page.evaluate(() => document.body.innerText);

  await context.close();
  await browser.close();

  // 2. Physical microphone hardware probe (without --use-fake-device-for-media-stream)
  let physicalMicResult = { executed: false, reason: "" };
  try {
    const physBrowser = await chromium.launch({
      executablePath,
      headless: true,
      args: [
        "--enable-webgl",
        "--ignore-gpu-blocklist",
        "--no-sandbox",
        "--use-fake-ui-for-media-stream",
      ],
    });
    const physCtx = await physBrowser.newContext({
      viewport: { width: 1440, height: 900 },
      permissions: ["microphone"],
    });
    const physPage = await physCtx.newPage();
    await physPage.goto("http://127.0.0.1:4174/", { waitUntil: "networkidle" });
    await physPage.waitForTimeout(600);
    const deviceProbe = await physPage.evaluate(async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const mics = devices.filter((d) => d.kind === "audioinput");
        return { ok: true, count: mics.length, labels: mics.map((m) => m.label || "unnamed") };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    });
    await physPage.getByRole("button", { name: /^MIC/i }).click();
    await physPage.waitForTimeout(3800);
    const physSnap = await physPage.evaluate(() => ({
      text: document.body.innerText,
      diag: window.__ECOSONIC_DIAGNOSTICS__?.() ?? null,
    }));
    await physCtx.close();
    await physBrowser.close();
    physicalMicResult = {
      executed: deviceProbe.ok && deviceProbe.count > 0 && /MIC LIVE/.test(physSnap.text),
      deviceProbe,
      micLiveActive: /MIC LIVE/.test(physSnap.text),
      captureLatencyMs: physSnap.diag?.latency?.captureLatencyMs ?? null,
      wsLatencyMs: physSnap.diag?.latency?.wsLatencyMs ?? null,
      inferenceLatencyMs: physSnap.diag?.latency?.inferenceLatencyMs ?? null,
    };
  } catch (err) {
    physicalMicResult = {
      executed: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  console.log(
    JSON.stringify(
      {
        backendHealth: health.direct_onnx_engine,
        wavFixture: path.basename(WAV_FIXTURE),
        errors,
        wsFramesSentBinary: wsFrames.sentBinary,
        wsFramesSentText: wsFrames.sentText,
        wsEventTypesReceived: wsFrames.receivedText.map((m) => m.type),
        stateA_silenceOk: /SILENT/.test(stateAText) && /FIELD SETTLED/.test(stateAText),
        stateBCD_liveMetrics: {
          frameCount: liveMetrics.frameCount,
          medianFps: liveMetrics.medianFps,
          minFps: liveMetrics.minFps,
          p95FrameTimeMs: liveMetrics.p95FrameTimeMs,
          maxFrameTimeMs: liveMetrics.maxFrameTimeMs,
          canvases: liveMetrics.canvases,
          overflowX: liveMetrics.overflowX,
          demoControlsPresentInLive: liveMetrics.demoControlsPresentInLive,
          diag: liveMetrics.diag,
        },
        stateE_returnToSilenceOk: /SILENT/.test(stateEText) && /FIELD SETTLED/.test(stateEText),
        physicalMicResult,
      },
      null,
      2,
    ),
  );
} finally {
  viteServer.kill();
}
