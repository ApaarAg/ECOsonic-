import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const executablePath = fs.existsSync(CHROME_PATH) ? CHROME_PATH : EDGE_PATH;

const OUT_DIR = path.resolve("docs/audit_evidence/scene11_12_moving_bird_background");
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE_URL = "http://localhost:5173";

function attachTrackers(page) {
  const pageErrors = [];
  const consoleErrors = [];
  const portraitRequests = [];
  const birdTexturesLoaded = new Set();
  const failedNonApiAssets = [];

  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("net::ERR_FAILED")) {
      consoleErrors.push(msg.text());
    }
  });
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/originkit/hero-13/") || url.includes("potrait")) {
      portraitRequests.push(url);
    }
  });
  page.on("response", (res) => {
    const url = res.url();
    if (url.includes("/assets/specimens/") && res.status() === 200) {
      birdTexturesLoaded.add(url.split("/").pop());
    } else if (res.status() >= 400 && !url.includes("/api/v1/")) {
      failedNonApiAssets.push({ url, status: res.status() });
    }
  });
  page.on("requestfailed", (req) => {
    if (!req.url().includes("/api/v1/")) {
      failedNonApiAssets.push({ url: req.url(), error: req.failure()?.errorText || "failed" });
    }
  });

  return { pageErrors, consoleErrors, portraitRequests, birdTexturesLoaded, failedNonApiAssets };
}

async function hydrateSceneDemoIfNeeded(page, selector) {
  await page.waitForSelector(selector, { timeout: 15000 });
  const demoBtn = page.locator(`${selector} button`, { hasText: "Load Demo Observation" });
  if ((await demoBtn.count()) > 0 && (await demoBtn.isVisible())) {
    await demoBtn.click();
    await page.mouse.move(16, 16);
  }
}

async function runViewportCase({ browser, label, width, height, reducedMotion = false, isMobile = false }) {
  const context = await browser.newContext({
    viewport: { width, height },
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
    hasTouch: isMobile,
    isMobile,
  });
  const page = await context.newPage();
  const trackers = attachTrackers(page);

  await page.route("**/api/v1/**", (route) => route.abort());

  // Enter Scene 11 directly via ?act=expected-species
  await page.goto(`${BASE_URL}/?act=expected-species`, { waitUntil: "domcontentloaded" });
  await hydrateSceneDemoIfNeeded(page, "#expected-species");
  await page.waitForTimeout(1400);

  // Record persistent canvas & chapter references in Scene 11
  const s11State = await page.evaluate(() => {
    const canvases = document.querySelectorAll("canvas");
    const chapter = document.querySelector('[data-testid="shared-hero13-chapter"]');
    const bg = document.querySelector('[data-testid="shared-scene-background"]');
    window.__ecosonicPrevCanvas = canvases[0] || null;
    window.__ecosonicPrevChapter = chapter || null;
    const copyText = (chapter?.textContent || "").replace(/\u00A0/g, " ");
    const diag = window.__ECOSONIC_DIAGNOSTICS__?.() || null;
    return {
      canvasCount: canvases.length,
      bgTextLength: (bg?.textContent || "").trim().length,
      atmosphereOverlayCount: bg ? bg.querySelectorAll(".ecosonic-atmosphere").length : 0,
      grainOverlayCount: bg ? bg.querySelectorAll(".ecosonic-grain").length : 0,
      ecologicalFieldVisible: diag?.ecologicalFieldVisible ?? null,
      chapterPresent: Boolean(chapter),
      hasExpectedTitle: copyText.includes("EXPECTED SPECIES"),
      hasExpectedSubtitle: copyText.includes("Species expected in this ecological context"),
      hasTemplateButtons:
        document.body.textContent?.includes("Explore Gallery") ||
        document.body.textContent?.includes("Book a Shoot") ||
        document.body.textContent?.includes("Elevating Portraits"),
      overflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    };
  });

  await page.screenshot({ path: path.join(OUT_DIR, `${label}_scene11.png`) });

  // Transition continuously to Scene 12 via bottom navigation / scrollProgress
  await page.evaluate(() => {
    window.__ECOSONIC_CINEMATIC__?.jumpToAct("ACT_12_OBSERVATION_GAP", 0.5);
  });
  await hydrateSceneDemoIfNeeded(page, "#observation-gap");
  await page.waitForTimeout(1100);

  const s12State = await page.evaluate(() => {
    const canvases = document.querySelectorAll("canvas");
    const chapter = document.querySelector('[data-testid="shared-hero13-chapter"]');
    const copyText = (chapter?.textContent || "").replace(/\u00A0/g, " ");
    const bg = document.querySelector('[data-testid="shared-scene-background"]');
    const diag = window.__ECOSONIC_DIAGNOSTICS__?.() || null;
    const obsUpper = (document.querySelector("#observation-gap")?.textContent || "").toUpperCase();
    return {
      canvasCount: canvases.length,
      sameCanvasInstance: canvases[0] === window.__ecosonicPrevCanvas,
      sameChapterContainer: chapter === window.__ecosonicPrevChapter,
      atmosphereOverlayCount: bg ? bg.querySelectorAll(".ecosonic-atmosphere").length : 0,
      grainOverlayCount: bg ? bg.querySelectorAll(".ecosonic-grain").length : 0,
      ecologicalFieldVisible: diag?.ecologicalFieldVisible ?? null,
      hasGapTitle: copyText.includes("OBSERVATION GAP"),
      hasGapSubtitle: copyText.includes("Compare expected taxa with what was actually detected"),
      hasForbiddenGapWording:
        obsUpper.includes("MISSING SPECIES") ||
        obsUpper.includes("SPECIES LOST") ||
        obsUpper.includes("SPECIES ABSENT"),
      overflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    };
  });

  await page.screenshot({ path: path.join(OUT_DIR, `${label}_scene12.png`) });
  await context.close();

  return {
    label,
    s11State,
    s12State,
    birdTextureCount: trackers.birdTexturesLoaded.size,
    portraitRequestCount: trackers.portraitRequests.length,
    pageErrors: trackers.pageErrors,
    consoleErrors: trackers.consoleErrors,
    failedNonApiAssets: trackers.failedNonApiAssets,
  };
}

async function run() {
  console.log("=== Validating Scene 11 + 12 Shared Moving-Bird Background ===");
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--disable-gpu-vsync"],
  });

  const cases = [];
  try {
    cases.push(await runViewportCase({ browser, label: "desktop_1440x900", width: 1440, height: 900 }));
    cases.push(await runViewportCase({ browser, label: "desktop_1920x1080", width: 1920, height: 1080 }));
    cases.push(await runViewportCase({ browser, label: "mobile_390x844", width: 390, height: 844, isMobile: true }));
    cases.push(await runViewportCase({ browser, label: "mobile_412x915", width: 412, height: 915, isMobile: true }));
    cases.push(
      await runViewportCase({
        browser,
        label: "reduced_1440x900",
        width: 1440,
        height: 900,
        reducedMotion: true,
      })
    );
  } finally {
    await browser.close();
  }

  fs.writeFileSync(path.join(OUT_DIR, "validation_report.json"), JSON.stringify({ cases }, null, 2));
  console.log(JSON.stringify({ cases }, null, 2));

  for (const c of cases) {
    if (c.s11State.canvasCount !== 1 || c.s12State.canvasCount !== 1) {
      throw new Error(`Expected exactly 1 canvas on ${c.label}`);
    }
    if (
      c.s11State.ecologicalFieldVisible !== false ||
      c.s12State.ecologicalFieldVisible !== false ||
      c.s11State.atmosphereOverlayCount > 0 ||
      c.s11State.grainOverlayCount > 0 ||
      c.s12State.atmosphereOverlayCount > 0 ||
      c.s12State.grainOverlayCount > 0
    ) {
      throw new Error(`Previous ecological field or grain/atmosphere overlay still active on ${c.label}`);
    }
    if (!c.s12State.sameCanvasInstance || !c.s12State.sameChapterContainer) {
      throw new Error(`Shared background remounted across Scene 11 -> 12 on ${c.label}`);
    }
    if (!c.s11State.hasExpectedTitle || !c.s11State.hasExpectedSubtitle) {
      throw new Error(`Missing Scene 11 text on ${c.label}`);
    }
    if (!c.s12State.hasGapTitle || !c.s12State.hasGapSubtitle) {
      throw new Error(`Missing Scene 12 text on ${c.label}`);
    }
    if (c.s11State.hasTemplateButtons || c.s12State.hasForbiddenGapWording) {
      throw new Error(`Template or forbidden text found on ${c.label}`);
    }
    if (c.portraitRequestCount > 0 || c.birdTextureCount < 10) {
      throw new Error(`Invalid bird textures on ${c.label}: portraits=${c.portraitRequestCount}, birds=${c.birdTextureCount}`);
    }
    if (c.s11State.overflowPx > 1 || c.s12State.overflowPx > 1) {
      throw new Error(`Horizontal overflow detected on ${c.label}`);
    }
    if (c.pageErrors.length > 0 || c.consoleErrors.length > 0 || c.failedNonApiAssets.length > 0) {
      throw new Error(`Runtime errors on ${c.label}`);
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
