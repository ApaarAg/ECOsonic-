import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const executablePath = fs.existsSync(CHROME_PATH) ? CHROME_PATH : EDGE_PATH;

const SCREENSHOT_DIR = path.resolve("docs/screenshots");
const VIDEO_DIR = path.resolve("docs/screenshots/video-tmp-0406");
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

const viteBin = path.resolve("node_modules/vite/bin/vite.js");
const server = spawn(
  process.execPath,
  [viteBin, "preview", "--host", "127.0.0.1", "--port", "4185", "--strictPort"],
  { stdio: "ignore", shell: false },
);

try {
  const baseUrl = "http://127.0.0.1:4185";
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

    await page.goto(`${baseUrl}/?act=water`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);

    const imageTiming = await page.evaluate(() => {
      const imgs = performance
        .getEntriesByType("resource")
        .filter((r) => r.name.includes(".webp"));
      const maxLoadMs = imgs.reduce((m, r) => Math.max(m, r.duration), 0);
      return {
        webpCount: imgs.length,
        maxAssetLoadMs: Number(maxLoadMs.toFixed(1)),
      };
    });

    if (vp.label === "desktop-1440x900") {
      // Capture key ACT 04 contact beats: pre-contact calm, impact dip, asymmetric ripple
      for (const beat of [
        { p: 0.08, name: "water-calm" },
        { p: 0.25, name: "water-contact" },
        { p: 0.56, name: "water-ripple" },
      ]) {
        await page.evaluate(
          (prog) => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_04_WATER", false, prog),
          beat.p,
        );
        await page.waitForTimeout(260);
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, `pass0406-${beat.name}-${vp.label}.png`) });
      }
      // Capture ACT 05 Phase A/B, Phase C, Phase D/E
      for (const beat of [
        { p: 0.18, name: "sound-phaseA-ripple" },
        { p: 0.50, name: "sound-phaseC-strata" },
        { p: 0.84, name: "sound-phaseD-spatial" },
      ]) {
        await page.evaluate(
          (prog) => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_05_SOUND", false, prog),
          beat.p,
        );
        await page.waitForTimeout(260);
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, `pass0406-${beat.name}-${vp.label}.png`) });
      }
    }

    // Measure & capture ACT 04, ACT 05, ACT 06 per viewport
    await page.evaluate(() => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_04_WATER", false, 0.54));
    await page.waitForTimeout(350);
    const waterPerf = await measureFrameWindow(page, 60);
    const waterMetrics = await page.evaluate(() => ({
      canvases: document.querySelectorAll("canvas").length,
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      diag: window.__ECOSONIC_DIAGNOSTICS__?.() ?? null,
    }));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `pass0406-act04-${vp.label}.png`) });

    await page.evaluate(() => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_05_SOUND", false, 0.52));
    await page.waitForTimeout(350);
    const soundPerf = await measureFrameWindow(page, 60);
    const soundMetrics = await page.evaluate(() => ({
      canvases: document.querySelectorAll("canvas").length,
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      diag: window.__ECOSONIC_DIAGNOSTICS__?.() ?? null,
    }));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `pass0406-act05-${vp.label}.png`) });

    // Exercise SILENCE acoustic state on 1440x900 (toggled via ACT 06 control and persisted back into ACT 05)
    let silentSoundCaptured = false;
    if (vp.label === "desktop-1440x900") {
      await page.evaluate(() => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_06_ACOUSTIC_FIELD", false, 0.2));
      await page.waitForTimeout(200);
      await page.getByRole("button", { name: /^SILENCE$/i }).click();
      await page.evaluate(() => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_05_SOUND", false, 0.52));
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "pass0406-act05-silence-1440x900.png") });
      await page.evaluate(() => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_06_ACOUSTIC_FIELD", false, 0.2));
      await page.waitForTimeout(200);
      await page.getByRole("button", { name: /^DEMO$/i }).click();
      await page.waitForTimeout(300);
      silentSoundCaptured = true;
    }

    await page.evaluate(() => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_06_ACOUSTIC_FIELD", false, 1.0));
    await page.waitForTimeout(350);
    const fieldPerf = await measureFrameWindow(page, 60);
    const fieldMetrics = await page.evaluate(() => ({
      canvases: document.querySelectorAll("canvas").length,
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      diag: window.__ECOSONIC_DIAGNOSTICS__?.() ?? null,
    }));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `pass0406-act06-${vp.label}.png`) });

    report.push({
      viewport: vp.label,
      errors,
      imageTiming,
      silentSoundCaptured,
      act04: { ...waterMetrics, ...waterPerf },
      act05: { ...soundMetrics, ...soundPerf },
      act06: { ...fieldMetrics, ...fieldPerf },
    });
    await context.close();
  }

  // Reduced motion check across ACT 04 & ACT 05
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
  await rmPage.goto(`${baseUrl}/?act=water`, { waitUntil: "networkidle" });
  await rmPage.waitForTimeout(350);
  await rmPage.screenshot({ path: path.join(SCREENSHOT_DIR, "pass0406-act04-reduced-motion.png") });
  await rmPage.evaluate(() => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_05_SOUND", false, 0.56));
  await rmPage.waitForTimeout(350);
  const rmState = await rmPage.evaluate(() => ({
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    canvases: document.querySelectorAll("canvas").length,
    state: window.__ECOSONIC_CINEMATIC__?.getState() ?? null,
    diag: window.__ECOSONIC_DIAGNOSTICS__?.() ?? null,
  }));
  await rmPage.screenshot({ path: path.join(SCREENSHOT_DIR, "pass0406-act05-reduced-motion.png") });
  await rmCtx.close();

  // Continuous playback recording ACT 02 -> ACT 03 -> ACT 04 -> ACT 05 -> ACT 06
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
  await seqPage.evaluate(() => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_02_FOREST", true, 0.72));

  const observed = [];
  const start = Date.now();
  while (Date.now() - start < 32000) {
    const act = await seqPage.evaluate(() => window.__ECOSONIC_CINEMATIC__?.getState()?.act ?? null);
    if (act && observed[observed.length - 1] !== act) {
      observed.push(act);
    }
    if (act === "ACT_06_ACOUSTIC_FIELD") {
      await seqPage.waitForTimeout(1600);
      break;
    }
    await seqPage.waitForTimeout(250);
  }
  const seqCanvases = await seqPage.evaluate(() => document.querySelectorAll("canvas").length);
  const video = seqPage.video();
  await seqCtx.close();

  const videoDest = path.join(SCREENSHOT_DIR, "act02-to-06-continuity.webm");
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
          seqCanvases,
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
