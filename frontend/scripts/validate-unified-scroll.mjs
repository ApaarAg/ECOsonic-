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

async function samplePerformance(page, durationMs = 1200) {
  return page.evaluate((ms) => {
    return new Promise((resolve) => {
      const deltas = [];
      let clsTotal = 0;
      let observer;
      try {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) {
              clsTotal += entry.value || 0;
            }
          }
        });
        observer.observe({ type: "layout-shift", buffered: true });
      } catch {
        // unsupported
      }

      const start = performance.now();
      let prev = start;
      const step = (now) => {
        deltas.push(now - prev);
        prev = now;
        if (now - start >= ms) {
          observer?.disconnect();
          const valid = deltas.slice(2).sort((a, b) => a - b);
          const median = valid[Math.floor(valid.length / 2)] || 16.6;
          const p95 = valid[Math.floor(valid.length * 0.95)] || 16.6;
          const worst = valid[valid.length - 1] || 16.6;
          const mem = performance.memory
            ? Math.round(performance.memory.usedJSHeapSize / (1024 * 1024))
            : null;
          resolve({
            framesMeasured: valid.length,
            medianFps: Number((1000 / median).toFixed(1)),
            p95FrameMs: Number(p95.toFixed(2)),
            worstFrameMs: Number(worst.toFixed(2)),
            jsHeapMb: mem,
            cls: Number(clsTotal.toFixed(4)),
          });
        } else {
          requestAnimationFrame(step);
        }
      };
      requestAnimationFrame(step);
    });
  }, durationMs);
}

const viteBin = path.resolve("node_modules/vite/bin/vite.js");
const server = spawn(
  process.execPath,
  [viteBin, "preview", "--host", "127.0.0.1", "--port", "4188", "--strictPort"],
  { stdio: "ignore", shell: false },
);

try {
  const baseUrl = "http://127.0.0.1:4188";
  await waitForServer(baseUrl);

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox"],
  });

  const viewportReports = [];

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

    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(350);

    const initCheck = await page.evaluate(() => ({
      scrollRangePx: document.documentElement.scrollHeight - window.innerHeight,
      initialState: window.__ECOSONIC_CINEMATIC__?.getState() ?? null,
      canvases: document.querySelectorAll("canvas").length,
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      audioContexts: window.__ECOSONIC_AUDIO_CONTEXT_COUNT__ ?? 0,
    }));

    // Real scroll checkpoints spanning ACT 01 -> ACT 10
    const checkpoints = [
      { act: "ACT_01_BLACKNESS", p: 0.35, tag: "01-blackness", shot: vp.label === "desktop-1440x900" },
      { act: "ACT_02_FOREST", p: 0.62, tag: "02-forest", shot: true },
      { act: "ACT_03_LEAF", p: 0.04, tag: "03-leaf-attached", shot: true },
      { act: "ACT_03_LEAF", p: 0.56, tag: "03-leaf-falling", shot: true },
      { act: "ACT_04_WATER", p: 0.54, tag: "04-water-ripple", shot: true },
      { act: "ACT_05_SOUND", p: 0.52, tag: "05-sound-lift", shot: vp.label === "desktop-1440x900" || vp.label === "mobile-390x844" },
      { act: "ACT_06_ACOUSTIC_FIELD", p: 0.52, tag: "06-field", shot: vp.label === "desktop-1440x900" },
      { act: "ACT_07_SPECIES", p: 0.60, tag: "07-species", shot: vp.label === "desktop-1440x900" },
      { act: "ACT_08_DISTURBANCE", p: 0.60, tag: "08-disturbance", shot: vp.label === "desktop-1440x900" },
      { act: "ACT_09_SILENCE", p: 0.72, tag: "09-silence", shot: vp.label === "desktop-1440x900" },
      { act: "ACT_10_ECOLOGICAL_CONTEXT", p: 0.72, tag: "10-ecology", shot: true },
    ];

    const timelineMetrics = {};

    for (const cp of checkpoints) {
      await page.evaluate(({ act, p }) => {
        const seg = window.__ECOSONIC_CINEMATIC__?.getTimeline().find((s) => s.act === act);
        if (!seg) return;
        const target = seg.start + p * (seg.end - seg.start);
        const range = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        window.scrollTo({ top: Math.round(target * range), behavior: "instant" });
      }, { act: cp.act, p: cp.p });

      // Allow scroll inertia to converge seamlessly
      await page.waitForTimeout(360);

      if (cp.act === "ACT_10_ECOLOGICAL_CONTEXT") {
        await page.evaluate(() =>
          window.__ECOSONIC_CINEMATIC__?.refreshEcology(47.86, -123.93),
        );
        await page.waitForTimeout(320);
      }

      const snap = await page.evaluate(() => ({
        state: window.__ECOSONIC_CINEMATIC__?.getState() ?? null,
        diag: window.__ECOSONIC_DIAGNOSTICS__?.() ?? null,
        canvases: document.querySelectorAll("canvas").length,
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
      }));
      timelineMetrics[cp.tag] = snap;

      if (cp.shot) {
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `unified-${cp.tag}-${vp.label}.png`),
        });
      }
    }

    // Active scroll performance & sticky geometry stability test (Test A + B + C)
    const activeScrollPerf = await page.evaluate(() => {
      return new Promise((resolve) => {
        const deltas = [];
        const range = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        window.scrollTo(0, 0);
        let prev = performance.now();
        let stepIdx = 0;
        const totalSteps = 80;
        const run = (now) => {
          deltas.push(now - prev);
          prev = now;
          stepIdx++;
          // Sweep 0 -> 1 smoothly, then jump rapidly/reversely back toward 0.28
          const frac = stepIdx <= 55 ? stepIdx / 55 : 1 - ((stepIdx - 55) / 25) * 0.72;
          window.scrollTo(0, Math.round(frac * range));
          if (stepIdx >= totalSteps) {
            const valid = deltas.slice(3).sort((a, b) => a - b);
            const med = valid[Math.floor(valid.length / 2)] || 16.6;
            const p95 = valid[Math.floor(valid.length * 0.95)] || 16.6;
            const worst = valid[valid.length - 1] || 16.6;
            resolve({
              medianFps: Number((1000 / med).toFixed(1)),
              p95FrameMs: Number(p95.toFixed(2)),
              worstFrameMs: Number(worst.toFixed(2)),
              endAct: window.__ECOSONIC_CINEMATIC__?.getState()?.act ?? null,
              canvases: document.querySelectorAll("canvas").length,
            });
          } else {
            requestAnimationFrame(run);
          }
        };
        requestAnimationFrame(run);
      });
    });

    const idlePerf = await samplePerformance(page, 900);

    // Monochrome check on ACT 02 FOREST canvas pixel samples (ensure R === G === B)
    await page.evaluate(() => {
      const seg = window.__ECOSONIC_CINEMATIC__?.getTimeline().find((s) => s.act === "ACT_02_FOREST");
      if (!seg) return;
      const range = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo(0, Math.round((seg.start + (seg.end - seg.start) * 0.6) * range));
    });
    await page.waitForTimeout(420);

    const monochromeDelta = await page.evaluate(() => {
      return new Promise((resolve) => {
        requestAnimationFrame(() => {
          const canvas = document.querySelector("canvas");
          if (!canvas) {
            resolve(null);
            return;
          }
          const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
          if (!gl) {
            resolve(null);
            return;
          }
          const w = gl.drawingBufferWidth;
          const h = gl.drawingBufferHeight;
          const buf = new Uint8Array(w * h * 4);
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          let maxChannelDiff = 0;
          let brightPixels = 0;
          for (let i = 0; i < buf.length; i += 64) {
            const r = buf[i];
            const g = buf[i + 1];
            const b = buf[i + 2];
            const diff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
            if (diff > maxChannelDiff) maxChannelDiff = diff;
            if ((r + g + b) / 3 > 16) brightPixels++;
          }
          resolve({ maxChannelDiff, nonBlackSampledPixels: brightPixels });
        });
      });
    });

    viewportReports.push({
      viewport: vp.label,
      initCheck,
      activeScrollPerf,
      idlePerf,
      monochromeDelta,
      errors,
      timelineSummary: Object.fromEntries(
        Object.entries(timelineMetrics).map(([k, v]) => [
          k,
          {
            act: v.state?.act,
            phase: v.state?.phase,
            canvases: v.canvases,
            overflowX: v.overflowX,
            calls: v.diag?.calls,
            points: v.diag?.points,
            triangles: v.diag?.triangles,
          },
        ]),
      ),
    });

    await context.close();
  }

  // Test E (Nav jumps 02->06 and 09->03) + Test D (mid-page refresh) + Test H (Demo controls & AudioContext<=1)
  const navCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const navPage = await navCtx.newPage();
  const navErrors = [];
  navPage.on("pageerror", (e) => navErrors.push(e.message));
  await navPage.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await navPage.waitForTimeout(250);

  await navPage.getByRole("button", { name: /02 FOREST/i }).click();
  await navPage.waitForTimeout(320);
  const afterForest = await navPage.evaluate(() => window.__ECOSONIC_CINEMATIC__?.getState()?.act);

  await navPage.getByRole("button", { name: /06 FIELD/i }).click();
  await navPage.waitForTimeout(320);
  const afterField = await navPage.evaluate(() => window.__ECOSONIC_CINEMATIC__?.getState()?.act);

  await navPage.getByRole("button", { name: /09 STILL/i }).click();
  await navPage.waitForTimeout(320);
  const afterSilence = await navPage.evaluate(() => window.__ECOSONIC_CINEMATIC__?.getState()?.act);

  await navPage.getByRole("button", { name: /03 LEAF/i }).click();
  await navPage.waitForTimeout(320);
  const afterLeaf = await navPage.evaluate(() => window.__ECOSONIC_CINEMATIC__?.getState()?.act);

  // Mid-page reload preservation check (Test D)
  await navPage.getByRole("button", { name: /06 FIELD/i }).click();
  await navPage.waitForTimeout(250);
  const preReloadY = await navPage.evaluate(() => window.scrollY);
  await navPage.reload({ waitUntil: "networkidle" });
  await navPage.waitForTimeout(320);
  const postReloadState = await navPage.evaluate(() => ({
    scrollY: window.scrollY,
    act: window.__ECOSONIC_CINEMATIC__?.getState()?.act ?? null,
    audioContexts: window.__ECOSONIC_AUDIO_CONTEXT_COUNT__ ?? 0,
  }));

  // Demo isolation check on ACT 06
  await navPage.getByRole("button", { name: /06 FIELD/i }).click();
  await navPage.waitForTimeout(200);
  await navPage.getByRole("button", { name: /^DEMO$/i }).click();
  await navPage.waitForTimeout(150);
  await navPage.getByRole("button", { name: /\+ TRACE/i }).click();
  await navPage.waitForTimeout(200);
  const demoTraceVisible = await navPage.getByText(/DEMO DETECTION TRACE/i).isVisible();
  await navCtx.close();

  // Test I: Reduced Motion check
  const rmCtx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const rmPage = await rmCtx.newPage();
  const rmErrors = [];
  rmPage.on("pageerror", (e) => rmErrors.push(e.message));
  await rmPage.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await rmPage.waitForTimeout(250);
  await rmPage.getByRole("button", { name: /04 WATER/i }).click();
  await rmPage.waitForTimeout(120);
  const rmAct = await rmPage.evaluate(() => ({
    reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    state: window.__ECOSONIC_CINEMATIC__?.getState() ?? null,
  }));
  await rmCtx.close();

  await browser.close();

  console.log(
    JSON.stringify(
      {
        viewportReports,
        navigationAndReload: {
          jumps: { afterForest, afterField, afterSilence, afterLeaf },
          preReloadY,
          postReloadState,
          demoTraceVisible,
          errors: navErrors,
        },
        reducedMotion: { ...rmAct, errors: rmErrors },
      },
      null,
      2,
    ),
  );
} finally {
  server.kill("SIGTERM");
}
