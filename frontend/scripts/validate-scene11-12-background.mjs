import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const executablePath = fs.existsSync(CHROME_PATH) ? CHROME_PATH : EDGE_PATH;

const OUT_DIR = path.resolve("docs/audit_evidence/scene11_12_shared_background");
fs.mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORTS = [
  { width: 1440, height: 900, label: "1440x900" },
  { width: 1920, height: 1080, label: "1920x1080" },
  { width: 390, height: 844, label: "390x844" },
  { width: 412, height: 915, label: "412x915" },
];

async function runValidation() {
  console.log("=== Validating Scene 11 -> Scene 12 Shared Background Animation ===");

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--disable-gpu-vsync"],
  });

  const results = [];

  for (const vp of VIEWPORTS) {
    console.log(`\nTesting viewport ${vp.label} (${vp.width}x${vp.height})...`);
    const page = await browser.newPage({
      viewport: { width: vp.width, height: vp.height },
    });

    const consoleErrors = [];
    const failedAssets = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });
    page.on("response", (res) => {
      if (res.status() >= 400 && !res.url().includes("/api/v1/")) {
        failedAssets.push({ url: res.url(), status: res.status() });
      }
    });

    await page.goto("http://localhost:5173/?act=ecology", {
      waitUntil: "domcontentloaded",
    });

    // Wait for cinematic controller, trigger Act 10 -> Act 11 transition to load real backend species
    await page.waitForFunction(() => Boolean(window.__ECOSONIC_CINEMATIC__), { timeout: 10000 });
    await page.evaluate(() => {
      window.__ECOSONIC_CINEMATIC__.jumpToAct("ACT_10_ECOLOGICAL_CONTEXT", 0.64);
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      window.__ECOSONIC_CINEMATIC__.jumpToAct("ACT_11_EXPECTED_SPECIES", 0.5);
    });

    // Wait for loading skeleton to resolve into ready, empty, or error state
    await page.waitForSelector("#expected-species", { timeout: 10000 });
    await page.waitForFunction(
      () => !document.body.innerText.includes("ASSEMBLING ECOLOGICAL BASELINE"),
      { timeout: 8000 },
    ).catch(() => {});

    // If backend has no geocoded session, trigger explicit demo observation to verify specimen shelf + readability
    const demoBtn = page.locator("button", { hasText: /Load Demo Observation/i });
    if (await demoBtn.count()) {
      await demoBtn.first().click();
      await page.waitForSelector('#expected-species button[aria-label*="expected species"]', {
        timeout: 5000,
      }).catch(() => {});
    }

    await page.waitForTimeout(700);

    const s11Audit = await page.evaluate(() => {
      const bg = document.querySelector('[data-testid="shared-scene-background"]');
      const s11Root = document.querySelector("#expected-species");
      const canvases = document.querySelectorAll("canvas");
      const canvasHost = document.querySelector('[data-testid="cinematic-canvas-host"]');
      const canvas = canvasHost?.querySelector("canvas");

      const bgComputed = bg ? window.getComputedStyle(bg) : null;
      const s11Computed = s11Root ? window.getComputedStyle(s11Root) : null;
      const bgText = bg ? bg.textContent.trim() : "NOT_FOUND";
      const diag = typeof window.__ECOSONIC_DIAGNOSTICS__ === "function"
        ? window.__ECOSONIC_DIAGNOSTICS__()
        : null;

      const brokenImages = Array.from(document.querySelectorAll("#expected-species img")).filter(
        (img) => !img.complete || img.naturalWidth === 0,
      ).length;

      return {
        bgExists: Boolean(bg),
        bgPosition: bgComputed?.position,
        bgZIndex: bgComputed?.zIndex,
        bgPointerEvents: bgComputed?.pointerEvents,
        bgWidth: bgComputed?.width,
        bgHeight: bgComputed?.height,
        bgTextLength: bgText.length,
        s11Transparent:
          s11Computed?.backgroundColor === "rgba(0, 0, 0, 0)" ||
          s11Computed?.backgroundColor === "transparent",
        s11BgColor: s11Computed?.backgroundColor,
        canvasCount: canvases.length,
        canvasPresent: Boolean(canvas),
        canvasWidth: canvas?.width,
        canvasHeight: canvas?.height,
        specimenButtonsCount: document.querySelectorAll('#expected-species button[aria-label*="expected species"]').length,
        brokenImages,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        diagnostics: diag,
      };
    });

    console.log(
      `  Background: pos=${s11Audit.bgPosition}, z=${s11Audit.bgZIndex}, text=${s11Audit.bgTextLength}, canvases=${s11Audit.canvasCount}, points=${s11Audit.diagnostics?.points}, lines=${s11Audit.diagnostics?.lines}, fps=${s11Audit.diagnostics?.fps}`,
    );
    console.log(
      `  Scene 11: transparent=${s11Audit.s11Transparent}, overflow=${s11Audit.horizontalOverflow}, specimens=${s11Audit.specimenButtonsCount}`,
    );

    const s11ShotPath = path.join(OUT_DIR, `scene11_${vp.label}.png`);
    await page.screenshot({ path: s11ShotPath });

    // Verify specimen archive interaction still works (click Next expected species)
    const nextBtn = page.locator('button[aria-label="Next expected species"]');
    let specimenInteractive = false;
    if (await nextBtn.count()) {
      const beforeSelected = await page.evaluate(() =>
        document.querySelector('#expected-species [data-selected="true"]')?.getAttribute("aria-label") || "",
      );
      await nextBtn.click();
      await page.waitForTimeout(250);
      const afterSelected = await page.evaluate(() =>
        document.querySelector('#expected-species [data-selected="true"]')?.getAttribute("aria-label") || "",
      );
      specimenInteractive = beforeSelected !== afterSelected;
    }

    // Verify continuous persistence into Act 12 boundary without remount/restart
    const continuityAudit = await page.evaluate(() => {
      const bgBefore = document.querySelector('[data-testid="shared-scene-background"]');
      const canvasBefore = bgBefore?.querySelector("canvas");
      const glBefore = canvasBefore?.getContext("webgl2") || canvasBefore?.getContext("webgl");

      if (window.__ECOSONIC_CINEMATIC__) {
        window.__ECOSONIC_CINEMATIC__.scrollToProgress(1.0, true);
      }

      const bgAfter = document.querySelector('[data-testid="shared-scene-background"]');
      const canvasAfter = bgAfter?.querySelector("canvas");
      const glAfter = canvasAfter?.getContext("webgl2") || canvasAfter?.getContext("webgl");

      return {
        sameBgNode: bgBefore === bgAfter,
        sameCanvasNode: canvasBefore === canvasAfter,
        sameWebGLContext: glBefore === glAfter,
        canvasCountAfter: document.querySelectorAll("canvas").length,
        bgTextLength: bgAfter ? bgAfter.textContent.trim().length : -1,
      };
    });

    console.log(
      `  Continuity: sameBg=${continuityAudit.sameBgNode}, sameCanvas=${continuityAudit.sameCanvasNode}, sameGL=${continuityAudit.sameWebGLContext}, interactive=${specimenInteractive}`,
    );

    results.push({
      viewport: vp.label,
      s11Audit,
      specimenInteractive,
      continuityAudit,
      consoleErrorsCount: consoleErrors.length,
      consoleErrors,
      failedAssets,
    });

    await page.close();
  }

  // Reduced motion check
  console.log("\nTesting Reduced-Motion Behavior...");
  const rmPage = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await rmPage.emulateMedia({ reducedMotion: "reduce" });
  await rmPage.goto("http://localhost:5173/?act=ecology", {
    waitUntil: "domcontentloaded",
  });
  await rmPage.waitForFunction(() => Boolean(window.__ECOSONIC_CINEMATIC__), { timeout: 10000 });
  await rmPage.evaluate(() => {
    window.__ECOSONIC_CINEMATIC__.jumpToAct("ACT_10_ECOLOGICAL_CONTEXT", 0.64);
  });
  await rmPage.waitForTimeout(250);
  await rmPage.evaluate(() => {
    window.__ECOSONIC_CINEMATIC__.jumpToAct("ACT_11_EXPECTED_SPECIES", 0.5);
  });
  await rmPage.waitForSelector("#expected-species", { timeout: 10000 });
  await rmPage.waitForFunction(
    () => !document.body.innerText.includes("ASSEMBLING ECOLOGICAL BASELINE"),
    { timeout: 8000 },
  ).catch(() => {});

  const demoBtn = rmPage.locator("button", { hasText: /Load Demo Observation/i });
  if (await demoBtn.count()) {
    await demoBtn.first().click();
    await rmPage.waitForTimeout(400);
  }
  await rmPage.waitForTimeout(500);

  const rmAudit = await rmPage.evaluate(() => {
    const bg = document.querySelector('[data-testid="shared-scene-background"]');
    const diag = typeof window.__ECOSONIC_DIAGNOSTICS__ === "function"
      ? window.__ECOSONIC_DIAGNOSTICS__()
      : null;
    return {
      bgExists: Boolean(bg),
      bgTextLength: bg ? bg.textContent.trim().length : -1,
      reducedMotionMatch: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      canvasCount: document.querySelectorAll("canvas").length,
      diagnostics: diag,
    };
  });
  console.log(
    `  Reduced-Motion check: match=${rmAudit.reducedMotionMatch}, bgExists=${rmAudit.bgExists}, bgText=${rmAudit.bgTextLength}, canvases=${rmAudit.canvasCount}`,
  );
  await rmPage.screenshot({ path: path.join(OUT_DIR, "scene11_reduced_motion_1440x900.png") });
  await rmPage.close();

  await browser.close();

  const reportPath = path.join(OUT_DIR, "validation_summary.json");
  fs.writeFileSync(reportPath, JSON.stringify({ results, rmAudit }, null, 2));
  console.log(`\nValidation complete! Summary written to: ${reportPath}`);
}

runValidation().catch((err) => {
  console.error("Validation failed:", err);
  process.exit(1);
});
