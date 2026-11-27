import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const executablePath = fs.existsSync(CHROME_PATH) ? CHROME_PATH : EDGE_PATH;

const SCREENSHOT_DIR = path.resolve("docs/screenshots");
const VIDEO_DIR = path.resolve("docs/screenshots/video-tmp");
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
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function measureFrameWindow(page, frames = 90) {
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
          resolve({
            medianFps: Number((1000 / medianMs).toFixed(1)),
            minFps: Number((1000 / maxMs).toFixed(1)),
            p95FrameTimeMs: Number(p95Ms.toFixed(2)),
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
  ["vite", "preview", "--host", "127.0.0.1", "--port", "4176", "--strictPort"],
  { stdio: "ignore", shell: true },
);

try {
  const baseUrl = "http://127.0.0.1:4176";
  await waitForServer(baseUrl);

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

    await page.goto(`${baseUrl}/?act=forest`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1800);

    const perf = await measureFrameWindow(page, 90);
    const baseMetrics = await page.evaluate(() => {
      const imgs = performance.getEntriesByType("resource").filter((r) => r.name.includes(".webp"));
      const maxAssetLoadMs = imgs.reduce((m, r) => Math.max(m, r.duration), 0);
      return {
        canvases: document.querySelectorAll("canvas").length,
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
        diag: window.__ECOSONIC_DIAGNOSTICS__?.() ?? null,
        hasCinematic: Boolean(window.__ECOSONIC_CINEMATIC__),
        webpAssetsLoaded: imgs.length,
        maxAssetLoadMs: Number(maxAssetLoadMs.toFixed(1)),
      };
    });

    // Capture ACT 02 on all desktop/mobile viewports
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `seq-02-forest-${vp.label}.png`) });

    // Capture key narrative beats on primary 1440x900 desktop & 390x844 mobile
    if (vp.label === "desktop-1440x900" || vp.label === "mobile-390x844") {
      const suffix = vp.label === "desktop-1440x900" ? "desktop" : "mobile";

      // ACT 03 LEAF (mid-fall macro framing)
      await page.evaluate(() => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_03_LEAF", false, 0.78));
      await page.waitForTimeout(450);
      const leafPerf = await measureFrameWindow(page, 60);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `seq-03-leaf-${suffix}.png`) });

      // ACT 04 WATER (contact + capillary ripples)
      await page.evaluate(() => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_04_WATER", false, 0.56));
      await page.waitForTimeout(450);
      const waterPerf = await measureFrameWindow(page, 60);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `seq-04-water-${suffix}.png`) });

      // ACT 05 SOUND (water ripples lifting into acoustic field wave structure)
      await page.evaluate(() => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_05_SOUND", false, 0.52));
      await page.waitForTimeout(450);
      const soundPerf = await measureFrameWindow(page, 60);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `seq-05-sound-${suffix}.png`) });

      // ACT 06 ACOUSTIC FIELD handoff
      await page.evaluate(() => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_06_ACOUSTIC_FIELD", false, 1.0));
      await page.waitForTimeout(450);
      const fieldPerf = await measureFrameWindow(page, 60);
      const canvasesAfterHandoff = await page.evaluate(() => document.querySelectorAll("canvas").length);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `seq-06-field-${suffix}.png`) });

      viewportReport.push({
        viewport: vp.label,
        errors,
        ...baseMetrics,
        forestPerf: perf,
        leafPerf,
        waterPerf,
        soundPerf,
        fieldPerf,
        canvasesAfterHandoff,
      });
    } else {
      viewportReport.push({
        viewport: vp.label,
        errors,
        ...baseMetrics,
        forestPerf: perf,
      });
    }

    await context.close();
  }

  // Reduced-motion verification
  const rmCtx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const rmPage = await rmCtx.newPage();
  await rmPage.goto(`${baseUrl}/?act=leaf`, { waitUntil: "networkidle" });
  await rmPage.waitForTimeout(500);
  const rmDiag = await rmPage.evaluate(() => ({
    reducedMotionMatches: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    canvases: document.querySelectorAll("canvas").length,
    state: window.__ECOSONIC_CINEMATIC__?.getState() ?? null,
    diag: window.__ECOSONIC_DIAGNOSTICS__?.() ?? null,
  }));
  await rmPage.screenshot({ path: path.join(SCREENSHOT_DIR, "seq-reduced-motion-leaf.png") });
  await rmCtx.close();

  // Continuous live playback verification & recording (BLACKNESS -> FOREST -> LEAF -> WATER -> SOUND -> ACOUSTIC FIELD)
  const seqCtx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 720 } },
  });
  const seqPage = await seqCtx.newPage();
  const seqErrors = [];
  seqPage.on("pageerror", (e) => seqErrors.push(`pageerror: ${e.message}`));
  await seqPage.goto(`${baseUrl}/?sequence=1`, { waitUntil: "domcontentloaded" });

  const observedActs = new Set();
  const deadline = Date.now() + 34000;
  let seqComplete = false;
  while (Date.now() < deadline) {
    const st = await seqPage.evaluate(() => window.__ECOSONIC_CINEMATIC__?.getState() ?? null);
    if (st) {
      observedActs.add(st.act);
      if (st.act === "ACT_06_ACOUSTIC_FIELD") {
        await seqPage.waitForTimeout(1200);
        seqComplete = true;
        break;
      }
    }
    await seqPage.waitForTimeout(250);
  }
  const canvasesDuringSeq = await seqPage.evaluate(() => document.querySelectorAll("canvas").length);
  const videoPath = await seqPage.video()?.path();
  await seqCtx.close();

  if (videoPath && fs.existsSync(videoPath)) {
    const targetVideo = path.join(SCREENSHOT_DIR, "cinematic-sequence.webm");
    fs.copyFileSync(videoPath, targetVideo);
  }
  fs.rmSync(VIDEO_DIR, { recursive: true, force: true });

  await browser.close();

  console.log(
    JSON.stringify(
      {
        viewportReport,
        rmDiag,
        continuousSequence: {
          observedActs: [...observedActs],
          completedAtAct06: seqComplete,
          canvasesDuringSequence: canvasesDuringSeq,
          errors: seqErrors,
          videoSaved: fs.existsSync(path.join(SCREENSHOT_DIR, "cinematic-sequence.webm")),
        },
      },
      null,
      2,
    ),
  );
} finally {
  server.kill();
}
