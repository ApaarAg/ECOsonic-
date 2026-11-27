import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const executablePath = fs.existsSync(CHROME_PATH) ? CHROME_PATH : EDGE_PATH;

const SCREENSHOT_DIR = path.resolve("docs/screenshots");
const VIDEO_DIR = path.resolve("docs/screenshots/video-tmp-07-10");
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
fs.mkdirSync(VIDEO_DIR, { recursive: true });

const VIEWPORTS = [
  { width: 1440, height: 900, label: "desktop-1440x900" },
  { width: 1920, height: 1080, label: "desktop-1920x1080" },
  { width: 390, height: 844, label: "mobile-390x844" },
  { width: 412, height: 915, label: "mobile-412x915" },
];

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function measureFrameWindow(page, frames = 75) {
  return page.evaluate((count) => {
    return new Promise((resolve) => {
      const deltas = [];
      let prev = performance.now();
      let idx = 0;
      const tick = (now) => {
        deltas.push(now - prev);
        prev = now;
        idx++;
        if (idx >= count) {
          const valid = deltas.slice(2).sort((a, b) => a - b);
          const medianMs = valid[Math.floor(valid.length / 2)] || 16.6;
          const p95Ms = valid[Math.floor(valid.length * 0.95)] || 16.6;
          const maxMs = valid[valid.length - 1] || 16.6;
          const memMb = performance?.memory?.usedJSHeapSize
            ? Number((performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(1))
            : null;
          resolve({
            medianFps: Number((1000 / medianMs).toFixed(1)),
            minFps: Number((1000 / maxMs).toFixed(1)),
            p95FrameTimeMs: Number(p95Ms.toFixed(2)),
            heapMb: memMb,
          });
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    });
  }, frames);
}

const server = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vite", "preview", "--host", "127.0.0.1", "--port", "4177", "--strictPort"],
  { stdio: "ignore", shell: true },
);

try {
  const baseUrl = "http://127.0.0.1:4177";
  await waitForServer(baseUrl);
  await waitForServer("http://127.0.0.1:8000/docs");

  // Query live backend health + test real /api/v1/ecology/observation-gap contract cleanly
  const backendRes = await fetch("http://127.0.0.1:8000/api/v1/live/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_type: "browser_mic",
      sample_rate: 32000,
      channels: 1,
      latitude: 47.86,
      longitude: -123.93,
    }),
  });
  const liveSession = await backendRes.json();
  const ecoRes = await fetch("http://127.0.0.1:8000/api/v1/ecology/observation-gap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: liveSession.id,
      latitude: 47.86,
      longitude: -123.93,
      include_ai_interpretation: true,
    }),
  });
  const ecoPayload = await ecoRes.json();

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox"],
  });

  const viewportReport = [];

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.width < 768 ? 2 : 1,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });

    await page.goto(`${baseUrl}/?act=field`, { waitUntil: "networkidle" });
    await page.waitForTimeout(900);

    const actsToCapture = [
      { id: "ACT_06_ACOUSTIC_FIELD", progress: 1.0, key: "act06" },
      { id: "ACT_07_SPECIES", progress: 0.65, key: "act07" },
      { id: "ACT_08_DISTURBANCE", progress: 0.65, key: "act08" },
      { id: "ACT_09_SILENCE", progress: 0.92, key: "act09" },
      { id: "ACT_10_ECOLOGICAL_CONTEXT", progress: 0.85, key: "act10" },
    ];

    const perAct = {};
    for (const item of actsToCapture) {
      await page.evaluate(
        ({ id, progress }) => {
          window.__ECOSONIC_CINEMATIC__?.jumpToAct(id, false, progress);
        },
        item,
      );
      await page.waitForTimeout(item.id === "ACT_10_ECOLOGICAL_CONTEXT" ? 1300 : 750);

      // For ACT 10 on desktop-1440 & mobile-390, verify real regional backend observation gap render in live UI
      if (
        item.id === "ACT_10_ECOLOGICAL_CONTEXT" &&
        (vp.label === "desktop-1440x900" || vp.label === "mobile-390x844")
      ) {
        await page.evaluate(async () => {
          await window.__ECOSONIC_CINEMATIC__?.refreshEcology(47.86, -123.93);
        });
        await page.waitForTimeout(450);
      }

      const perf = await measureFrameWindow(page, 60);
      const diag = await page.evaluate(() => ({
        canvases: document.querySelectorAll("canvas").length,
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
        diag: window.__ECOSONIC_DIAGNOSTICS__?.() ?? null,
      }));
      perAct[item.key] = { ...perf, ...diag };

      if (vp.label === "desktop-1440x900" || vp.label === "mobile-390x844" || vp.label === "desktop-1920x1080" || vp.label === "mobile-412x915") {
        if (vp.label === "desktop-1440x900" || vp.label === "mobile-390x844" || item.key === "act10") {
          const suffix =
            vp.label === "desktop-1440x900"
              ? "desktop"
              : vp.label === "mobile-390x844"
                ? "mobile"
                : vp.label;
          await page.screenshot({
            path: path.join(SCREENSHOT_DIR, `${item.key}-${suffix}.png`),
          });
        }
      }
    }

    viewportReport.push({ viewport: vp.label, errors, perAct });
    await context.close();
  }

  // Reduced motion check on ACT 10
  const rmCtx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const rmPage = await rmCtx.newPage();
  await rmPage.goto(`${baseUrl}/?act=ecology`, { waitUntil: "networkidle" });
  await rmPage.waitForTimeout(800);
  const rmCheck = await rmPage.evaluate(() => ({
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    canvases: document.querySelectorAll("canvas").length,
    state: window.__ECOSONIC_CINEMATIC__?.getState() ?? null,
    diag: window.__ECOSONIC_DIAGNOSTICS__?.() ?? null,
  }));
  await rmPage.screenshot({ path: path.join(SCREENSHOT_DIR, "act10-reduced-motion.png") });
  await rmCtx.close();

  // Continuous live playback recording: ACT 06 -> ACT 07 -> ACT 08 -> ACT 09 -> ACT 10
  const seqCtx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 720 } },
  });
  const seqPage = await seqCtx.newPage();
  const seqErrors = [];
  seqPage.on("pageerror", (e) => seqErrors.push(`pageerror: ${e.message}`));
  await seqPage.goto(`${baseUrl}/?act=field`, { waitUntil: "domcontentloaded" });
  await seqPage.waitForTimeout(700);
  await seqPage.evaluate(() => {
    window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_06_ACOUSTIC_FIELD", true, 0.45);
  });

  const observedActs = new Set();
  const deadline = Date.now() + 45000;
  let reachedAct10 = false;
  while (Date.now() < deadline) {
    const st = await seqPage.evaluate(() => window.__ECOSONIC_CINEMATIC__?.getState() ?? null);
    if (st) {
      observedActs.add(st.act);
      if (st.act === "ACT_10_ECOLOGICAL_CONTEXT" && st.weights.globeOpacity > 0.85) {
        await seqPage.waitForTimeout(1200);
        reachedAct10 = true;
        break;
      }
    }
    await seqPage.waitForTimeout(250);
  }
  const canvasesDuringSeq = await seqPage.evaluate(() => document.querySelectorAll("canvas").length);
  const videoPath = await seqPage.video()?.path();
  await seqCtx.close();

  if (videoPath && fs.existsSync(videoPath)) {
    fs.copyFileSync(videoPath, path.join(SCREENSHOT_DIR, "act06-to-10-sequence.webm"));
  }
  fs.rmSync(VIDEO_DIR, { recursive: true, force: true });

  await browser.close();

  console.log(
    JSON.stringify(
      {
        backendEcologySample: {
          sessionId: liveSession.id,
          expectedSpeciesCount: ecoPayload.coverage?.expected_species_count,
          gapCount: ecoPayload.coverage?.gap_count,
          adequacy: ecoPayload.coverage?.observation_adequacy,
          provider: ecoPayload.interpretation?.provider,
          coords: ecoPayload.context?.generalized_coordinates,
        },
        viewportReport,
        rmCheck,
        continuousSequence: {
          observedActs: [...observedActs],
          reachedAct10,
          canvasesDuringSeq,
          errors: seqErrors,
          videoSaved: fs.existsSync(path.join(SCREENSHOT_DIR, "act06-to-10-sequence.webm")),
        },
      },
      null,
      2,
    ),
  );
} finally {
  server.kill();
}
