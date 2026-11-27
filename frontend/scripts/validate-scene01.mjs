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
  ["vite", "preview", "--host", "127.0.0.1", "--port", "4173", "--strictPort"],
  { stdio: "ignore", shell: true },
);

try {
  const url = "http://127.0.0.1:4173/";
  await waitForServer(url);

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--no-sandbox",
    ],
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
    await page.waitForTimeout(1400);

    const metrics = await page.evaluate(() => {
      const canvases = document.querySelectorAll("canvas").length;
      const diag = window.__ECOSONIC_DIAGNOSTICS__?.() ?? null;
      const overflowX =
        document.documentElement.scrollWidth > window.innerWidth;
      return { canvases, diag, overflowX };
    });

    const shotPath = path.join(SCREENSHOT_DIR, `scene01-${vp.width}x${vp.height}.png`);
    await page.screenshot({ path: shotPath });

    // On 1440x900, capture separate detection, disturbance, combined events, and silence states
    if (vp.width === 1440) {
      await page.getByRole("button", { name: "+ TRACE" }).click();
      await page.waitForTimeout(350);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "scene01-1440x900-detection.png"),
      });

      await page.getByRole("button", { name: "SILENCE" }).click();
      await page.waitForTimeout(1000);

      await page.getByRole("button", { name: "DEMO" }).click();
      await page.waitForTimeout(300);
      await page.getByRole("button", { name: "+ DISTURBANCE" }).click();
      await page.waitForTimeout(350);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "scene01-1440x900-disturbance.png"),
      });

      await page.getByRole("button", { name: "+ TRACE" }).click();
      await page.waitForTimeout(300);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "scene01-1440x900-events.png"),
      });

      await page.getByRole("button", { name: "SILENCE" }).click();
      await page.waitForTimeout(1100);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "scene01-1440x900-silence.png"),
      });
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
  await rmPage.waitForTimeout(800);
  const rmDiag = await rmPage.evaluate(() => ({
    reducedMotionMatches: window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches,
    diag: window.__ECOSONIC_DIAGNOSTICS__?.() ?? null,
  }));
  await rmContext.close();

  await browser.close();
  console.log(JSON.stringify({ report, rmDiag }, null, 2));
} finally {
  server.kill();
}
