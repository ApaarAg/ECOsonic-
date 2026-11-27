import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const executablePath = fs.existsSync(CHROME_PATH) ? CHROME_PATH : EDGE_PATH;

const OUT_DIR = path.resolve("docs/audit_evidence/scene12_stacked_cards");
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE_URL = "http://localhost:5173";

async function waitForScene12Ready(page, moveCursorAway = true) {
  await page.waitForSelector('#observation-gap', { timeout: 15000 });
  const loadDemoBtn = page.locator("button", { hasText: "Load Demo Observation" });
  if ((await loadDemoBtn.count()) > 0 && (await loadDemoBtn.isVisible())) {
    await loadDemoBtn.click();
  }
  await page.waitForSelector('[data-testid="observation-gap-card-stack"]', { timeout: 15000 });
  await page.waitForSelector('.car-slot[data-front="true"] .car-card-img', { timeout: 15000 });
  if (moveCursorAway) {
    await page.mouse.move(16, 16);
  }
  await page.waitForTimeout(550);
}

async function inspectDomState(page) {
  return page.evaluate(() => {
    const canvases = document.querySelectorAll("canvas").length;
    const sharedBg = document.querySelector('[data-testid="shared-scene-background"]');
    const oldExpected = document.querySelector('[data-testid="gap-expected-plate"]');
    const oldObserved = document.querySelector('[data-testid="gap-observed-plate"]');
    const oldConnector = document.querySelector('[data-testid="gap-correspondence-connector"]');
    const oldAperture = document.querySelector('[data-testid="gap-empty-aperture"]');
    const slots = Array.from(document.querySelectorAll(".car-slot"));
    const frontSlot = document.querySelector('.car-slot[data-front="true"]');
    const imgs = Array.from(document.querySelectorAll(".car-card-img"));
    const brokenImgs = imgs.filter((img) => !img.complete || img.naturalWidth === 0).map((img) => img.src);
    const unsplashImgs = imgs.filter((img) => img.src.includes("unsplash.com"));
    const revealLayer = frontSlot?.querySelector(".car-reveal-layer");
    const revealOpacity = revealLayer ? getComputedStyle(revealLayer).opacity : null;
    const pageTextUpper = (document.querySelector("#observation-gap")?.textContent || "").toUpperCase();
    const hasForbiddenWording =
      pageTextUpper.includes("EXTINCT") ||
      pageTextUpper.includes("MISSING FROM HABITAT") ||
      pageTextUpper.includes("SPECIES LOST") ||
      /\bABSENT\b/.test(pageTextUpper);

    return {
      canvasCount: canvases,
      sharedBgPresent: Boolean(sharedBg),
      oldHolderRemoved: !oldExpected && !oldObserved && !oldConnector && !oldAperture,
      slotCount: slots.length,
      hasFrontSlot: Boolean(frontSlot),
      imgCount: imgs.length,
      brokenImgCount: brokenImgs.length,
      unsplashCount: unsplashImgs.length,
      frontRevealOpacity: revealOpacity,
      horizontalOverflowPx: Math.max(
        0,
        document.documentElement.scrollWidth - window.innerWidth
      ),
      hasForbiddenWording,
    };
  });
}

function attachErrorCollectors(page) {
  const pageErrors = [];
  const consoleErrors = [];
  const failedAssets = [];

  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // Deliberate offline route.abort() on **/api/v1/** produces net::ERR_FAILED in Chromium
      if (!text.includes("net::ERR_FAILED")) {
        consoleErrors.push(text);
      }
    }
  });
  page.on("response", (res) => {
    if (res.status() >= 400 && !res.url().includes("/api/v1/")) {
      failedAssets.push({ url: res.url(), status: res.status() });
    }
  });
  page.on("requestfailed", (req) => {
    if (!req.url().includes("/api/v1/")) {
      failedAssets.push({ url: req.url(), error: req.failure()?.errorText || "failed" });
    }
  });

  return { pageErrors, consoleErrors, failedAssets };
}

async function run() {
  console.log("=== Validating Scene 12 — Stacked Observation Cards ===");
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--disable-gpu-vsync"],
  });

  const report = { viewports: [], reducedMotion: null, keyboardFocus: null };

  try {
    // 1. Desktop 1440x900: Scene 11 -> Scene 12 continuity + live/demo hover reveals + modal
    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      const { pageErrors, consoleErrors, failedAssets } = attachErrorCollectors(page);

      // Verify Scene 11 -> Scene 12 continuous background on live/scroll first
      await page.goto(`${BASE_URL}/?act=ecology`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
      const scene11CanvasCount = await page.locator("canvas").count();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(1200);
      const scrollCanvasCount = await page.locator("canvas").count();

      // Now block API so explicit Demo Observation exercises all 3 ecological categories deterministically
      await page.route("**/api/v1/**", (route) => route.abort());
      await page.goto(`${BASE_URL}/?act=observation-gap`, { waitUntil: "domcontentloaded" });
      await waitForScene12Ready(page);

      const idleState = await inspectDomState(page);
      await page.screenshot({ path: path.join(OUT_DIR, "desktop_1440x900_idle.png") });

      // Hover front card in full stacked view first (center + side cards all visible)
      const frontAllCard = page.locator('.car-slot[data-front="true"] .car-card');
      const boxAll = await frontAllCard.boundingBox();
      await page.mouse.move(boxAll.x + boxAll.width / 2, boxAll.y + boxAll.height / 2);
      await page.waitForTimeout(450);
      await page.screenshot({ path: path.join(OUT_DIR, "desktop_1440x900_hover_all.png") });

      // Filter & hover DETECTED card
      await page.mouse.move(16, 16);
      await page.click('[data-testid="gap-filter-expected_and_detected"]');
      await page.waitForTimeout(450);
      const detectedCard = page.locator('.car-slot[data-front="true"] .car-card');
      const boxDetected = await detectedCard.boundingBox();
      await page.mouse.move(boxDetected.x + boxDetected.width / 2, boxDetected.y + boxDetected.height / 2);
      await page.waitForFunction(
        () => Number(getComputedStyle(document.querySelector('.car-slot[data-front="true"] .car-reveal-layer')).opacity) > 0.9,
        { timeout: 4000 }
      );
      const hoverDetectedOpacity = await detectedCard.locator(".car-reveal-layer").evaluate((el) => getComputedStyle(el).opacity);
      const hoverDetectedText = await detectedCard.locator(".car-reveal-layer").innerText();
      await page.screenshot({ path: path.join(OUT_DIR, "desktop_1440x900_hover_detected.png") });

      // Open Field Note from card button
      await detectedCard.locator('[data-card-action="inspect"]').click({ force: true });
      await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
      await page.screenshot({ path: path.join(OUT_DIR, "desktop_1440x900_field_note.png") });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);

      // Filter to Observation Gap and hover NOT DETECTED card
      await page.mouse.move(16, 16);
      await page.click('[data-testid="gap-filter-expected_but_not_detected"]');
      await page.waitForTimeout(450);
      const gapCard = page.locator('.car-slot[data-front="true"] .car-card');
      const boxGap = await gapCard.boundingBox();
      await page.mouse.move(boxGap.x + boxGap.width / 2, boxGap.y + boxGap.height / 2);
      await page.waitForFunction(
        () => Number(getComputedStyle(document.querySelector('.car-slot[data-front="true"] .car-reveal-layer')).opacity) > 0.9,
        { timeout: 4000 }
      );
      const hoverGapOpacity = await gapCard.locator(".car-reveal-layer").evaluate((el) => getComputedStyle(el).opacity);
      const hoverGapText = await gapCard.locator(".car-reveal-layer").innerText();
      await page.screenshot({ path: path.join(OUT_DIR, "desktop_1440x900_hover_not_detected.png") });

      report.viewports.push({
        label: "1440x900",
        scene11CanvasCount,
        scrollCanvasCount,
        idleState,
        hoverDetectedOpacity,
        hoverDetectedHasText: hoverDetectedText.includes("DETECTED"),
        hoverGapOpacity,
        hoverGapHasText: hoverGapText.includes("NOT DETECTED"),
        pageErrors,
        consoleErrors,
        failedAssets,
      });
      await context.close();
    }

    // 2. Desktop 1920x1080
    {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const page = await context.newPage();
      const { pageErrors, consoleErrors, failedAssets } = attachErrorCollectors(page);
      await page.route("**/api/v1/**", (route) => route.abort());
      await page.goto(`${BASE_URL}/?act=observation-gap`, { waitUntil: "domcontentloaded" });
      await waitForScene12Ready(page);
      const idleState = await inspectDomState(page);
      await page.screenshot({ path: path.join(OUT_DIR, "desktop_1920x1080_idle.png") });
      report.viewports.push({ label: "1920x1080", idleState, pageErrors, consoleErrors, failedAssets });
      await context.close();
    }

    // 3. Mobile 390x844 (tap reveal + touch carousel turn)
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      const page = await context.newPage();
      const { pageErrors, consoleErrors, failedAssets } = attachErrorCollectors(page);
      await page.route("**/api/v1/**", (route) => route.abort());
      await page.goto(`${BASE_URL}/?act=observation-gap`, { waitUntil: "domcontentloaded" });
      await waitForScene12Ready(page, false);

      const idleState = await inspectDomState(page);
      await page.screenshot({ path: path.join(OUT_DIR, "mobile_390x844_idle.png") });

      // Tap front card trigger to reveal status
      await page.tap('.car-slot[data-front="true"] [data-card-trigger]');
      await page.waitForFunction(
        () => Number(getComputedStyle(document.querySelector('.car-slot[data-front="true"] .car-reveal-layer')).opacity) > 0.9,
        { timeout: 4000 }
      );
      const tapState = await inspectDomState(page);
      const revealedAttr = await page.locator('.car-slot[data-front="true"] .car-card').getAttribute("data-revealed");
      await page.screenshot({ path: path.join(OUT_DIR, "mobile_390x844_tap_reveal.png") });

      report.viewports.push({
        label: "390x844",
        idleState,
        revealedAfterTap: revealedAttr === "true" && Number(tapState.frontRevealOpacity) > 0.9,
        pageErrors,
        consoleErrors,
        failedAssets,
      });
      await context.close();
    }

    // 4. Mobile 412x915
    {
      const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
      const page = await context.newPage();
      const { pageErrors, consoleErrors, failedAssets } = attachErrorCollectors(page);
      await page.route("**/api/v1/**", (route) => route.abort());
      await page.goto(`${BASE_URL}/?act=observation-gap`, { waitUntil: "domcontentloaded" });
      await waitForScene12Ready(page, false);
      const idleState = await inspectDomState(page);
      await page.screenshot({ path: path.join(OUT_DIR, "mobile_412x915_idle.png") });
      report.viewports.push({ label: "412x915", idleState, pageErrors, consoleErrors, failedAssets });
      await context.close();
    }

    // 5. Reduced motion + Keyboard focus at 1440x900
    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
      const page = await context.newPage();
      await page.route("**/api/v1/**", (route) => route.abort());
      await page.goto(`${BASE_URL}/?act=observation-gap`, { waitUntil: "domcontentloaded" });
      await waitForScene12Ready(page);

      const trackReduced = await page.locator(".car-track").getAttribute("data-reduced");
      const floatAnim = await page.locator(".car-float").first().evaluate((el) => getComputedStyle(el).animationName);

      // Focus front card trigger via keyboard/focus
      await page.locator('.car-slot[data-front="true"] [data-card-trigger]').focus();
      await page.waitForFunction(
        () => Number(getComputedStyle(document.querySelector('.car-slot[data-front="true"] .car-reveal-layer')).opacity) > 0.9,
        { timeout: 4000 }
      );
      const focusRevealOpacity = await page
        .locator('.car-slot[data-front="true"] .car-reveal-layer')
        .evaluate((el) => getComputedStyle(el).opacity);
      await page.screenshot({ path: path.join(OUT_DIR, "desktop_1440x900_reduced_motion_focus.png") });

      report.reducedMotion = {
        trackReduced,
        floatAnim,
        focusRevealOpacity,
      };
      await context.close();
    }
  } finally {
    await browser.close();
  }

  fs.writeFileSync(path.join(OUT_DIR, "validation_report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  // Strict exit code check
  for (const vp of report.viewports) {
    if (!vp.idleState.oldHolderRemoved) throw new Error(`Old holder found on ${vp.label}`);
    if (!vp.idleState.hasFrontSlot || vp.idleState.slotCount < 3) throw new Error(`Carousel cards missing on ${vp.label}`);
    if (vp.idleState.frontRevealOpacity !== "0") throw new Error(`Front card should be clean idle (opacity 0) on ${vp.label}, got ${vp.idleState.frontRevealOpacity}`);
    if (vp.idleState.brokenImgCount > 0 || vp.idleState.unsplashCount > 0) throw new Error(`Invalid images on ${vp.label}`);
    if (vp.idleState.horizontalOverflowPx > 1) throw new Error(`Horizontal overflow ${vp.idleState.horizontalOverflowPx}px on ${vp.label}`);
    if (vp.idleState.hasForbiddenWording) throw new Error(`Forbidden wording on ${vp.label}`);
    if (vp.pageErrors.length > 0) throw new Error(`Page errors on ${vp.label}: ${vp.pageErrors.join("; ")}`);
    if (vp.consoleErrors.length > 0) throw new Error(`Console errors on ${vp.label}: ${vp.consoleErrors.join("; ")}`);
    if (vp.failedAssets.length > 0) throw new Error(`Failed non-API assets on ${vp.label}: ${JSON.stringify(vp.failedAssets)}`);
  }
  const mob = report.viewports.find((v) => v.label === "390x844");
  if (!mob?.revealedAfterTap) throw new Error("Mobile 390x844 tap failed to reveal card status");
  if (report.reducedMotion?.trackReduced !== "true" || report.reducedMotion?.floatAnim !== "none") {
    throw new Error("Reduced motion did not disable ambient float");
  }
  if (Number(report.reducedMotion?.focusRevealOpacity) < 0.9) {
    throw new Error(`Keyboard focus reveal opacity failed: ${report.reducedMotion?.focusRevealOpacity}`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
