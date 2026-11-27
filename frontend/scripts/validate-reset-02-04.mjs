import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const executablePath = fs.existsSync(CHROME_PATH) ? CHROME_PATH : EDGE_PATH;

const SCREENSHOT_DIR = path.resolve("docs/screenshots");
const VIDEO_DIR = path.resolve("docs/screenshots/video-tmp-reset");
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

async function measureFrameWindow(page, frames = 55) {
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
            worstFrameTimeMs: Number(maxMs.toFixed(2)),
          });
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    });
  }, frames);
}

const viteBin = path.resolve("node_modules/vite/bin/vite.js");
const server = spawn(
  process.execPath,
  [viteBin, "preview", "--host", "127.0.0.1", "--port", "4189", "--strictPort"],
  { stdio: "ignore", shell: false },
);

try {
  const baseUrl = "http://127.0.0.1:4189";
  await waitForServer(baseUrl);

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox"],
  });

  const report = [];

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.width < 768 ? 1.5 : 1,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });

    await page.goto(`${baseUrl}/?act=forest`, { waitUntil: "networkidle" });
    await page.waitForTimeout(350);

    const beats = [
      { id: "ACT_02_FOREST", p: 0.86, tag: "02-forest" },
      { id: "ACT_03_LEAF", p: 0.06, tag: "03-detachment" },
      { id: "ACT_03_LEAF", p: 0.56, tag: "03-leaf" },
      { id: "ACT_03_LEAF", p: 0.90, tag: "03-to-04-transition" },
      { id: "ACT_04_WATER", p: 0.08, tag: "04-water" },
      { id: "ACT_04_WATER", p: 0.25, tag: "04-contact" },
      { id: "ACT_04_WATER", p: 0.58, tag: "04-ripple" },
    ];

    const beatMetrics = {};

    for (const beat of beats) {
      await page.evaluate(
        ({ actId, prog }) => window.__ECOSONIC_CINEMATIC__?.jumpToAct(actId, false, prog),
        { actId: beat.id, prog: beat.p },
      );
      await page.waitForTimeout(260);

      const perf = await measureFrameWindow(page, 45);
      const snap = await page.evaluate(() => ({
        canvases: document.querySelectorAll("canvas").length,
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
        diag: window.__ECOSONIC_DIAGNOSTICS__?.() ?? null,
      }));
      beatMetrics[beat.tag] = { ...snap, ...perf };

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `reset-${beat.tag}-${vp.label}.png`),
      });
    }

    report.push({ viewport: vp.label, errors, beats: beatMetrics });
    await context.close();
  }

  // Reduced motion check across ACT 02, 03, 04
  const rmCtx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const rmPage = await rmCtx.newPage();
  const rmErrors = [];
  rmPage.on("pageerror", (e) => rmErrors.push(e.message));
  rmPage.on("console", (m) => {
    if (m.type() === "error") rmErrors.push(m.text());
  });
  await rmPage.goto(`${baseUrl}/?act=forest`, { waitUntil: "networkidle" });
  await rmPage.waitForTimeout(300);
  await rmPage.screenshot({ path: path.join(SCREENSHOT_DIR, "reset-02-forest-reduced-motion.png") });
  await rmPage.evaluate(() => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_03_LEAF", false, 0.56));
  await rmPage.waitForTimeout(300);
  await rmPage.screenshot({ path: path.join(SCREENSHOT_DIR, "reset-03-leaf-reduced-motion.png") });
  await rmPage.evaluate(() => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_04_WATER", false, 0.56));
  await rmPage.waitForTimeout(300);
  const rmState = await rmPage.evaluate(() => ({
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    canvases: document.querySelectorAll("canvas").length,
    state: window.__ECOSONIC_CINEMATIC__?.getState() ?? null,
    diag: window.__ECOSONIC_DIAGNOSTICS__?.() ?? null,
  }));
  await rmPage.screenshot({ path: path.join(SCREENSHOT_DIR, "reset-04-water-reduced-motion.png") });
  await rmCtx.close();

  // Continuous playback recording ACT 02 -> ACT 03 -> ACT 04
  const seqCtx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: VIDEO_DIR, size: { width: 1440, height: 900 } },
  });
  const seqPage = await seqCtx.newPage();
  const seqErrors = [];
  seqPage.on("pageerror", (e) => seqErrors.push(e.message));
  seqPage.on("console", (m) => {
    if (m.type() === "error") seqErrors.push(m.text());
  });
  await seqPage.goto(`${baseUrl}/?act=forest`, { waitUntil: "networkidle" });
  await seqPage.evaluate(() => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_02_FOREST", true, 0.65));

  const observed = [];
  const start = Date.now();
  while (Date.now() - start < 24000) {
    const act = await seqPage.evaluate(() => window.__ECOSONIC_CINEMATIC__?.getState()?.act ?? null);
    if (act && observed[observed.length - 1] !== act) {
      observed.push(act);
    }
    if (act === "ACT_04_WATER") {
      await seqPage.waitForTimeout(4200);
      break;
    }
    await seqPage.waitForTimeout(250);
  }
  const seqMetrics = await seqPage.evaluate(() => ({
    canvases: document.querySelectorAll("canvas").length,
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
  }));
  const video = seqPage.video();
  await seqCtx.close();

  const videoDest = path.join(SCREENSHOT_DIR, "reset-02-to-04-continuity.webm");
  if (video) {
    const rawPath = await video.path();
    fs.copyFileSync(rawPath, videoDest);
  }
  fs.rmSync(VIDEO_DIR, { recursive: true, force: true });

  await browser.close();
  console.log(
    JSON.stringify(
      {
        report,
        reducedMotion: { ...rmState, errors: rmErrors },
        continuity: {
          observed,
          ...seqMetrics,
          videoSaved: fs.existsSync(videoDest),
          errors: seqErrors,
        },
      },
      null,
      2,
    ),
  );
} finally {
  server.kill("SIGTERM");
}
