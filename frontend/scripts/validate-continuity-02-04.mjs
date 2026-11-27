import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const executablePath = fs.existsSync(CHROME_PATH) ? CHROME_PATH : EDGE_PATH;

const SCREENSHOT_DIR = path.resolve("docs/screenshots");
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

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

async function measurePerf(page, frames = 55) {
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
          const mem = performance && performance.memory
            ? {
                usedJSHeapMB: Number((performance.memory.usedJSHeapSize / 1048576).toFixed(1)),
                totalJSHeapMB: Number((performance.memory.totalJSHeapSize / 1048576).toFixed(1)),
              }
            : null;
          resolve({
            medianFps: Number((1000 / medianMs).toFixed(1)),
            minFps: Number((1000 / maxMs).toFixed(1)),
            p95FrameTimeMs: Number(p95Ms.toFixed(2)),
            worstFrameTimeMs: Number(maxMs.toFixed(2)),
            memory: mem,
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
  [viteBin, "preview", "--host", "127.0.0.1", "--port", "4191", "--strictPort"],
  { stdio: "ignore", shell: false },
);

try {
  const baseUrl = "http://127.0.0.1:4191";
  await waitForServer(baseUrl);

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox"],
  });

  const viewports = [
    { width: 1440, height: 900, label: "1440x900", isMobile: false },
    { width: 1920, height: 1080, label: "1920x1080", isMobile: false },
    { width: 390, height: 844, label: "mobile", isMobile: true },
    { width: 412, height: 915, label: "mobile-412x915", isMobile: true },
  ];

  const report = [];

  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.isMobile ? 1.5 : 1,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });

    await page.addInitScript(() => {
      window.__CLS_TOTAL__ = 0;
      if (typeof PerformanceObserver !== "undefined") {
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (!entry.hadRecentInput) window.__CLS_TOTAL__ += entry.value;
            }
          }).observe({ type: "layout-shift", buffered: true });
        } catch {
          // ignore
        }
      }
    });

    await page.goto(`${baseUrl}/?act=forest`, { waitUntil: "networkidle" });
    await page.waitForTimeout(350);

    const beats = [
      { id: "ACT_02_FOREST", p: 0.42, key: "scene02" },
      { id: "ACT_02_FOREST", p: 0.92, key: "scene02-branch" },
      { id: "ACT_03_LEAF", p: 0.12, key: "scene03-detach" },
      { id: "ACT_03_LEAF", p: 0.54, key: "scene03" },
      { id: "ACT_03_LEAF", p: 0.90, key: "transition-forest-leaf-water" },
      { id: "ACT_04_WATER", p: 0.16, key: "transition-leaf-contact" },
      { id: "ACT_04_WATER", p: 0.45, key: "scene04" },
      { id: "ACT_04_WATER", p: 0.85, key: "scene04-settling" },
    ];

    const beatMetrics = {};

    for (const beat of beats) {
      await page.evaluate(
        ({ actId, prog }) => window.__ECOSONIC_CINEMATIC__?.jumpToAct(actId, false, prog),
        { actId: beat.id, prog: beat.p },
      );
      await page.waitForTimeout(260);

      const perf = await measurePerf(page, 50);
      const snap = await page.evaluate(() => ({
        state: window.__ECOSONIC_CINEMATIC__?.getState() ?? null,
        canvases: document.querySelectorAll("canvas").length,
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
        cls: Number((window.__CLS_TOTAL__ || 0).toFixed(4)),
        diag: window.__ECOSONIC_DIAGNOSTICS__?.() ?? null,
      }));
      beatMetrics[beat.key] = { ...snap, ...perf };

      // Save exact required filenames + extra diagnostic frames
      if (beat.key === "scene02" || beat.key === "scene03" || beat.key === "scene04") {
        if (vp.label === "1440x900" || vp.label === "1920x1080" || vp.label === "mobile") {
          await page.screenshot({
            path: path.join(SCREENSHOT_DIR, `${beat.key}-${vp.label}.png`),
          });
        } else {
          await page.screenshot({
            path: path.join(SCREENSHOT_DIR, `${beat.key}-${vp.label}.png`),
          });
        }
      } else if (
        vp.label === "1440x900" &&
        (beat.key === "transition-forest-leaf-water" || beat.key === "transition-leaf-contact")
      ) {
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `${beat.key}.png`),
        });
      }

      if (vp.label === "1440x900") {
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `diag-${beat.key}-1440x900.png`),
        });
      }
    }

    // Verify Scene 01 Acoustic Field regression check on 1440x900
    let scene01Check = null;
    if (vp.label === "1440x900") {
      await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
      await page.waitForTimeout(350);
      const s1Perf = await measurePerf(page, 40);
      scene01Check = await page.evaluate(() => ({
        act: window.__ECOSONIC_CINEMATIC__?.getState()?.act ?? null,
        canvases: document.querySelectorAll("canvas").length,
        diag: window.__ECOSONIC_DIAGNOSTICS__?.() ?? null,
      }));
      scene01Check = { ...scene01Check, ...s1Perf };
    }

    report.push({ viewport: vp.label, errors, beats: beatMetrics, scene01Check });
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
  await rmPage.goto(`${baseUrl}/?act=forest`, { waitUntil: "networkidle" });
  await rmPage.waitForTimeout(300);
  await rmPage.screenshot({ path: path.join(SCREENSHOT_DIR, "diag-reduced-02-forest.png") });
  await rmPage.evaluate(() => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_03_LEAF", false, 0.54));
  await rmPage.waitForTimeout(250);
  await rmPage.screenshot({ path: path.join(SCREENSHOT_DIR, "diag-reduced-03-leaf.png") });
  await rmPage.evaluate(() => window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_04_WATER", false, 0.45));
  await rmPage.waitForTimeout(250);
  const rmState = await rmPage.evaluate(() => ({
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    canvases: document.querySelectorAll("canvas").length,
    state: window.__ECOSONIC_CINEMATIC__?.getState() ?? null,
  }));
  await rmPage.screenshot({ path: path.join(SCREENSHOT_DIR, "diag-reduced-04-water.png") });
  await rmCtx.close();

  await browser.close();
  console.log(JSON.stringify({ report, reducedMotion: { ...rmState, errors: rmErrors } }, null, 2));
} finally {
  server.kill("SIGTERM");
}
