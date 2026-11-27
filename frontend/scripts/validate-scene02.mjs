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

const server = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vite", "preview", "--host", "127.0.0.1", "--port", "4175", "--strictPort"],
  { stdio: "ignore", shell: true },
);

try {
  const url = "http://127.0.0.1:4175/?act=forest";
  await waitForServer("http://127.0.0.1:4175/");

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox"],
  });

  const report = [];

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.width < 768 ? 2 : 1,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
    });

    await page.goto(url, { waitUntil: "networkidle" });

    if (vp.width === 1440) {
      await page.waitForTimeout(900);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "scene02-1440x900-emergence.png"),
      });
    }

    // Wait for full staged blackness -> forest emergence (~4.2s total)
    await page.waitForTimeout(vp.width === 1440 ? 3500 : 4200);

    // Collect per-frame rAF stats over ~2.5s
    await page.evaluate(() => {
      window.__FOREST_DELTAS__ = [];
      let last = performance.now();
      window.__COLLECT_FOREST__ = true;
      function sample(now) {
        const dt = now - last;
        last = now;
        if (dt > 0 && dt < 500) window.__FOREST_DELTAS__.push(dt);
        if (window.__COLLECT_FOREST__) requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });
    await page.mouse.move(vp.width * 0.35, vp.height * 0.45);
    await page.waitForTimeout(2400);

    const metrics = await page.evaluate(() => {
      window.__COLLECT_FOREST__ = false;
      const deltas = (window.__FOREST_DELTAS__ || []).slice().sort((a, b) => a - b);
      const n = deltas.length;
      const medianDt = n ? deltas[Math.floor(n / 2)] : 0;
      const p95Dt = n ? deltas[Math.min(n - 1, Math.floor(n * 0.95))] : 0;
      const maxDt = n ? deltas[n - 1] : 0;

      const hasLeafTransition = Boolean(window.__ECOSONIC_FOREST_TRANSITION__);
      return {
        canvases: document.querySelectorAll("canvas").length,
        diag: window.__ECOSONIC_DIAGNOSTICS__?.() ?? null,
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
        hasLeafTransition,
        medianFps: medianDt > 0 ? Number((1000 / medianDt).toFixed(1)) : 0,
        minFps: maxDt > 0 ? Number((1000 / maxDt).toFixed(1)) : 0,
        p95FrameTimeMs: Number(p95Dt.toFixed(2)),
      };
    });

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `scene02-${vp.width}x${vp.height}.png`),
    });

    // Verify switching between 02 FOREST and 06 FIELD preserves strictly 1 WebGL canvas
    if (vp.width === 1440) {
      await page.getByRole("button", { name: /06 FIELD/i }).click();
      await page.waitForTimeout(400);
      metrics.canvasesAfterSwitchToField = await page.evaluate(
        () => document.querySelectorAll("canvas").length,
      );
      await page.getByRole("button", { name: /02 FOREST/i }).click();
      await page.waitForTimeout(400);
      metrics.canvasesAfterSwitchBackToForest = await page.evaluate(
        () => document.querySelectorAll("canvas").length,
      );
    }

    report.push({ viewport: vp.label, errors, ...metrics });
    await context.close();
  }

  // Reduced-motion check
  const rmContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const rmPage = await rmContext.newPage();
  await rmPage.goto(url, { waitUntil: "networkidle" });
  await rmPage.waitForTimeout(500);
  const rmDiag = await rmPage.evaluate(() => ({
    reducedMotionMatches: window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches,
    canvases: document.querySelectorAll("canvas").length,
    diag: window.__ECOSONIC_DIAGNOSTICS__?.() ?? null,
  }));
  await rmContext.close();

  await browser.close();
  console.log(JSON.stringify({ report, rmDiag }, null, 2));
} finally {
  server.kill();
}
