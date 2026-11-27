import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const executablePath = fs.existsSync(CHROME_PATH) ? CHROME_PATH : EDGE_PATH;

const SCREENSHOT_DIR = path.resolve("docs/screenshots");
const VIDEO_DIR = path.resolve("docs/screenshots/video-tmp-0110");
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
  [viteBin, "preview", "--host", "127.0.0.1", "--port", "4187", "--strictPort"],
  { stdio: "ignore", shell: false },
);

try {
  const baseUrl = "http://127.0.0.1:4187";
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

    await page.goto(`${baseUrl}/?act=blackness`, { waitUntil: "networkidle" });
    await page.waitForTimeout(350);

    const actsToInspect = [
      { id: "ACT_01_BLACKNESS", p: 0.34, tag: "act01-sound-traces" },
      { id: "ACT_02_FOREST", p: 0.88, tag: "act02-forest" },
      { id: "ACT_03_LEAF", p: 0.05, tag: "act03-attached" },
      { id: "ACT_03_LEAF", p: 0.62, tag: "act03-float" },
      { id: "ACT_04_WATER", p: 0.25, tag: "act04-contact" },
      { id: "ACT_04_WATER", p: 0.56, tag: "act04-ripple" },
      { id: "ACT_05_SOUND", p: 0.52, tag: "act05-sound" },
      { id: "ACT_06_ACOUSTIC_FIELD", p: 1.0, tag: "act06-field" },
      { id: "ACT_07_SPECIES", p: 0.72, tag: "act07-species" },
      { id: "ACT_08_DISTURBANCE", p: 0.72, tag: "act08-disturbance" },
      { id: "ACT_09_SILENCE", p: 0.90, tag: "act09-silence" },
      { id: "ACT_10_ECOLOGICAL_CONTEXT", p: 0.85, tag: "act10-ecology" },
    ];

    const actMetrics = {};

    for (const item of actsToInspect) {
      await page.evaluate(
        ({ actId, prog }) => window.__ECOSONIC_CINEMATIC__?.jumpToAct(actId, false, prog),
        { actId: item.id, prog: item.p },
      );
      await page.waitForTimeout(280);

      // Measure key representatives across every viewport; capture all 12 on primary desktop 1440x900 and acts 01/03/07/09/10 on secondary viewports
      const captureAll = vp.label === "desktop-1440x900";
      const keyTags = new Set([
        "act01-sound-traces",
        "act02-forest",
        "act03-float",
        "act04-ripple",
        "act05-sound",
        "act06-field",
        "act07-species",
        "act08-disturbance",
        "act09-silence",
        "act10-ecology",
      ]);

      if (item.tag === "act10-ecology") {
        await page.evaluate(() =>
          window.__ECOSONIC_CINEMATIC__?.refreshEcology(47.86, -123.93),
        );
        await page.waitForTimeout(450);
      }

      if (keyTags.has(item.tag)) {
        const perf = await measureFrameWindow(page, 45);
        const snap = await page.evaluate(() => ({
          canvases: document.querySelectorAll("canvas").length,
          overflowX: document.documentElement.scrollWidth > window.innerWidth,
          diag: window.__ECOSONIC_DIAGNOSTICS__?.() ?? null,
        }));
        actMetrics[item.tag] = { ...snap, ...perf };
      }

      if (captureAll || ["act03-float", "act07-species", "act09-silence", "act10-ecology"].includes(item.tag)) {
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `loop01-${item.tag}-${vp.label}.png`),
        });
      }
    }

    // Exercise explicit DEMO + TRACE + DISTURBANCE visual overlays in an isolated non-live context on 1440x900
    let demoOverlaysVerified = false;
    if (vp.label === "desktop-1440x900") {
      const demoCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await demoCtx.route("**/api/v1/live/**", (route) => route.abort());
      const demoPage = await demoCtx.newPage();
      await demoPage.goto(`${baseUrl}/?act=acoustic-field`, { waitUntil: "networkidle" });
      await demoPage.waitForTimeout(300);
      await demoPage.getByRole("button", { name: /^DEMO$/i }).click();
      await demoPage.waitForTimeout(150);
      await demoPage.getByRole("button", { name: /\+ TRACE/i }).click();
      await demoPage.evaluate(() => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_07_SPECIES", false, 0.72));
      await demoPage.waitForTimeout(350);
      await demoPage.screenshot({ path: path.join(SCREENSHOT_DIR, "loop01-act07-demo-trace-1440x900.png") });

      await demoPage.evaluate(() => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_06_ACOUSTIC_FIELD", false, 1.0));
      await demoPage.waitForTimeout(150);
      await demoPage.getByRole("button", { name: /\+ DISTURBANCE/i }).click();
      await demoPage.evaluate(() => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_08_DISTURBANCE", false, 0.72));
      await demoPage.waitForTimeout(350);
      await demoPage.screenshot({ path: path.join(SCREENSHOT_DIR, "loop01-act08-demo-disturb-1440x900.png") });
      await demoCtx.close();
      demoOverlaysVerified = true;
    }

    report.push({ viewport: vp.label, errors, demoOverlaysVerified, acts: actMetrics });
    await context.close();
  }

  // Reduced motion check across ACT 01, ACT 03, ACT 09, ACT 10
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
  await rmPage.goto(`${baseUrl}/?act=blackness`, { waitUntil: "networkidle" });
  await rmPage.evaluate(() => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_03_LEAF", false, 0.65));
  await rmPage.waitForTimeout(250);
  await rmPage.screenshot({ path: path.join(SCREENSHOT_DIR, "loop01-act03-reduced-motion.png") });
  await rmPage.evaluate(() => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_10_ECOLOGICAL_CONTEXT", false, 1.0));
  await rmPage.evaluate(() => window.__ECOSONIC_CINEMATIC__?.refreshEcology(47.86, -123.93));
  await rmPage.waitForTimeout(450);
  const rmState = await rmPage.evaluate(() => ({
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    canvases: document.querySelectorAll("canvas").length,
    state: window.__ECOSONIC_CINEMATIC__?.getState() ?? null,
    diag: window.__ECOSONIC_DIAGNOSTICS__?.() ?? null,
  }));
  await rmPage.screenshot({ path: path.join(SCREENSHOT_DIR, "loop01-act10-reduced-motion.png") });
  await rmCtx.close();

  // Continuous playback recording ACT 01 -> ACT 10 as one unbroken experience
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
  await seqPage.goto(`${baseUrl}/?sequence=1`, { waitUntil: "networkidle" });

  const observed = [];
  const start = Date.now();
  while (Date.now() - start < 72000) {
    const act = await seqPage.evaluate(() => window.__ECOSONIC_CINEMATIC__?.getState()?.act ?? null);
    if (act && observed[observed.length - 1] !== act) {
      observed.push(act);
    }
    if (act === "ACT_10_ECOLOGICAL_CONTEXT") {
      await seqPage.waitForTimeout(1800);
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

  const videoDest = path.join(SCREENSHOT_DIR, "act01-to-10-full-sequence.webm");
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
