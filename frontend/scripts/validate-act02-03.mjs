import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const executablePath = fs.existsSync(CHROME_PATH) ? CHROME_PATH : EDGE_PATH;

const SCREENSHOT_DIR = path.resolve("docs/screenshots");
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

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
  ["vite", "preview", "--host", "127.0.0.1", "--port", "4179", "--strictPort"],
  { stdio: "ignore", shell: true },
);

try {
  const baseUrl = "http://127.0.0.1:4179";
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
    await page.evaluate(() => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_02_FOREST", false, 0.92));
    await page.waitForTimeout(600);

    const forestPerf = await measureFrameWindow(page, 60);
    const forestMetrics = await page.evaluate(() => ({
      canvases: document.querySelectorAll("canvas").length,
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      diag: window.__ECOSONIC_DIAGNOSTICS__?.() ?? null,
    }));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `fix-02-forest-${vp.label}.png`) });

    // Capture attached twig blend at start of ACT 03 (p=0.04) and mid-float/approach across ALL 4 viewports
    if (vp.label === "desktop-1440x900") {
      for (const beat of [
        { p: 0.04, name: "phase1-attached" },
        { p: 0.22, name: "phase2-drop" },
        { p: 0.48, name: "phase3-float" },
        { p: 0.74, name: "phase4-approach" },
        { p: 0.94, name: "phase5-water-approach" },
      ]) {
        await page.evaluate(
          (prog) => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_03_LEAF", false, prog),
          beat.p,
        );
        await page.waitForTimeout(220);
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, `fix-03-${beat.name}-${vp.label}.png`) });
      }
    }

    await page.evaluate(() => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_03_LEAF", false, 0.68));
    await page.waitForTimeout(350);
    const leafPerf = await measureFrameWindow(page, 60);
    const leafMetrics = await page.evaluate(() => ({
      canvases: document.querySelectorAll("canvas").length,
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      diag: window.__ECOSONIC_DIAGNOSTICS__?.() ?? null,
    }));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `fix-03-leaf-${vp.label}.png`) });

    // Check ACT 04 water continuity on primary desktop & mobile
    let waterCanvases = null;
    if (vp.label === "desktop-1440x900" || vp.label === "mobile-390x844") {
      await page.evaluate(() => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_04_WATER", false, 0.56));
      await page.waitForTimeout(350);
      waterCanvases = await page.evaluate(() => document.querySelectorAll("canvas").length);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `fix-04-water-${vp.label}.png`) });
    }

    report.push({
      viewport: vp.label,
      errors,
      forest: { ...forestMetrics, ...forestPerf },
      leaf: { ...leafMetrics, ...leafPerf },
      waterCanvases,
    });
    await context.close();
  }

  // Reduced motion check
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
  await rmPage.goto(`${baseUrl}/?act=leaf`, { waitUntil: "networkidle" });
  await rmPage.waitForTimeout(500);
  const rmState = await rmPage.evaluate(() => ({
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    canvases: document.querySelectorAll("canvas").length,
    state: window.__ECOSONIC_CINEMATIC__?.getState() ?? null,
    diag: window.__ECOSONIC_DIAGNOSTICS__?.() ?? null,
  }));
  await rmPage.screenshot({ path: path.join(SCREENSHOT_DIR, "fix-03-leaf-reduced-motion.png") });
  await rmCtx.close();

  // Continuous ACT 02 -> ACT 03 -> ACT 04 continuity recording check
  const seqCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const seqPage = await seqCtx.newPage();
  const seqErrors = [];
  seqPage.on("pageerror", (e) => seqErrors.push(e.message));
  await seqPage.goto(`${baseUrl}/?act=forest`, { waitUntil: "networkidle" });
  await seqPage.evaluate(() => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_02_FOREST", true, 0.72));
  const observed = [];
  const start = Date.now();
  while (Date.now() - start < 14000) {
    const s = await seqPage.evaluate(() => window.__ECOSONIC_CINEMATIC__?.getState()?.act ?? null);
    if (s && observed[observed.length - 1] !== s) observed.push(s);
    if (s === "ACT_04_WATER") break;
    await seqPage.waitForTimeout(220);
  }
  const seqCanvases = await seqPage.evaluate(() => document.querySelectorAll("canvas").length);
  await seqCtx.close();

  await browser.close();
  console.log(
    JSON.stringify(
      {
        report,
        reducedMotion: { ...rmState, errors: rmErrors },
        continuity: { observed, seqCanvases, errors: seqErrors },
      },
      null,
      2,
    ),
  );
} finally {
  server.kill("SIGTERM");
}
