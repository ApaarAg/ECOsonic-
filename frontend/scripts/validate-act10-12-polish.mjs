import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const executablePath = fs.existsSync(CHROME_PATH) ? CHROME_PATH : EDGE_PATH;

const OUT_DIR = path.resolve("docs/audit_evidence/act10_12_polish");
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE_URL = process.env.PW_BASE_URL || "http://127.0.0.1:4173";

async function jumpToAct(page, actId, progress) {
  await page.evaluate(
    ({ id, prog }) => {
      window.__ECOSONIC_CINEMATIC__?.jumpToAct(id, prog);
    },
    { id: actId, prog: progress },
  );
  await page.waitForFunction(
    (expectedId) => window.__ECOSONIC_CINEMATIC__?.getState().act === expectedId,
    actId,
    { timeout: 6000 },
  );
  await page.waitForTimeout(350);
}

async function scrollToProgress(page, targetProgress) {
  await page.evaluate((p) => {
    window.__ECOSONIC_CINEMATIC__?.scrollToProgress(p, true);
  }, targetProgress);
  await page.waitForTimeout(320);
}

async function runViewportCase(
  browser,
  { label, width, height, isMobile = false, reducedMotion = false },
) {
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: isMobile,
    isMobile,
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
  });
  const page = await context.newPage();

  // Abort backend API calls so ObservationGap cleanly exposes Load Demo Observation
  await page.route("**/api/v1/**", (route) => route.abort());

  const pageErrors = [];
  const consoleErrors = [];
  const failedAssets = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => {
    const txt = m.text();
    if (
      m.type() === "error" &&
      !txt.includes("net::ERR_FAILED") &&
      !txt.includes("Failed to load resource")
    ) {
      consoleErrors.push(txt);
    }
  });
  page.on("response", (res) => {
    const url = res.url();
    if (res.status() >= 400 && !url.includes("/api/v1/")) {
      failedAssets.push({ url, status: res.status() });
    }
  });

  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="shared-scene-background"]', { timeout: 10000 });
  await page.waitForTimeout(450);

  // 1. ACT 10 — PhotoCardGlobe
  await jumpToAct(page, "ACT_10_ECOLOGICAL_CONTEXT", 0.55);
  await page.waitForSelector('[data-testid="act10-photo-card-globe"] canvas', { timeout: 6000 });
  await page.waitForTimeout(550);

  const act10Check = await page.evaluate(() => {
    const wrap = document.querySelector('[data-testid="act10-photo-card-globe"]');
    const canvas = wrap?.querySelector("canvas");
    const rect = wrap?.getBoundingClientRect();
    const cRect = canvas?.getBoundingClientRect();
    const sharedCanvases = document.querySelectorAll('[data-testid="shared-scene-background"] canvas').length;
    return {
      present: Boolean(wrap),
      canvasW: canvas?.width ?? 0,
      canvasH: canvas?.height ?? 0,
      rect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null,
      cRectW: cRect ? Math.round(cRect.width) : 0,
      cRectH: cRect ? Math.round(cRect.height) : 0,
      sharedCanvases,
      overflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    };
  });

  // Pointer drag interaction test on desktop
  if (!isMobile && !reducedMotion) {
    const cRect = act10Check.rect;
    if (cRect && cRect.w > 80) {
      await page.mouse.move(cRect.x + cRect.w / 2, cRect.y + cRect.h / 2);
      await page.mouse.down();
      await page.mouse.move(cRect.x + cRect.w / 2 + 70, cRect.y + cRect.h / 2 - 20, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(160);
    }
  }

  await page.screenshot({ path: path.join(OUT_DIR, `${label}_act10_globe.png`) });

  // 2. Overlap ACT 10 -> ACT 11 (at boundary 0.90)
  await scrollToProgress(page, 0.9);
  const overlap10to11 = await page.evaluate(() => {
    const st = window.__ECOSONIC_CINEMATIC__?.getState();
    const wrap = document.querySelector('[data-testid="act10-photo-card-globe"]');
    const exp = document.querySelector("#expected-species")?.parentElement;
    return {
      act: st?.act,
      globeOpacity: st?.weights?.globeOpacity ?? 0,
      tunnelOpacity: st?.weights?.ecologicalFieldOpacity ?? 0,
      globeDomOpacity: wrap ? parseFloat(getComputedStyle(wrap).opacity) : 0,
      expectedDomOpacity: exp ? parseFloat(getComputedStyle(exp).opacity) : 0,
      sharedCanvases: document.querySelectorAll('[data-testid="shared-scene-background"] canvas').length,
    };
  });
  if (label === "desktop_1440x900") {
    await page.screenshot({ path: path.join(OUT_DIR, `${label}_overlap_10_11.png`) });
  }

  // 3. ACT 11
  await jumpToAct(page, "ACT_11_EXPECTED_SPECIES", 0.5);
  await page.waitForTimeout(450);
  const act11Check = await page.evaluate(() => {
    const s11 = document.querySelector("#expected-species");
    const imgs = Array.from(document.querySelectorAll("img"));
    return {
      present: Boolean(s11),
      sharedCanvases: document.querySelectorAll('[data-testid="shared-scene-background"] canvas').length,
      brokenImgs: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src),
      overflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    };
  });
  if (label === "desktop_1440x900" || label === "mobile_390x844") {
    await page.screenshot({ path: path.join(OUT_DIR, `${label}_act11_expected.png`) });
  }

  // 4. Overlap ACT 11 -> ACT 12 (at boundary 0.95)
  await scrollToProgress(page, 0.95);
  const overlap11to12 = await page.evaluate(() => {
    const s11 = document.querySelector("#expected-species")?.parentElement;
    const s12 = document.querySelector("#observation-gap")?.parentElement;
    return {
      expectedDomOpacity: s11 ? parseFloat(getComputedStyle(s11).opacity) : 0,
      gapDomOpacity: s12 ? parseFloat(getComputedStyle(s12).opacity) : 0,
      sharedCanvases: document.querySelectorAll('[data-testid="shared-scene-background"] canvas').length,
    };
  });
  if (label === "desktop_1440x900") {
    await page.screenshot({ path: path.join(OUT_DIR, `${label}_overlap_11_12.png`) });
  }

  // 5. ACT 12 — Load Demo Observation so populated SeleniteChips + Carousel show
  await jumpToAct(page, "ACT_12_OBSERVATION_GAP", 0.55);
  await page.waitForSelector("#observation-gap", { timeout: 6000 });
  const demoBtn = page.locator('#observation-gap button:has-text("Load Demo Observation")');
  if (await demoBtn.count()) {
    await demoBtn.first().click();
  }
  await page.waitForSelector('[data-testid="observation-gap-selenite-chips"]', { timeout: 6000 });
  await page.waitForTimeout(550);

  const act12Initial = await page.evaluate(() => {
    const chips = document.querySelector('[data-testid="observation-gap-selenite-chips"]');
    const rect = chips?.getBoundingClientRect();
    const btns = Array.from(chips?.querySelectorAll("button") ?? []).map((b) => ({
      label: b.getAttribute("aria-label"),
      pressed: b.getAttribute("aria-pressed"),
    }));
    const legacyButtons = document.querySelectorAll('[data-testid^="gap-filter-"]').length;
    return {
      activeFilter: chips?.getAttribute("data-active-filter"),
      chipButtons: btns,
      legacyButtons,
      chipsRect: rect ? { left: Math.round(rect.left), right: Math.round(rect.right), w: Math.round(rect.width), h: Math.round(rect.height) } : null,
      carouselCards: document.querySelectorAll("#observation-gap .car-slot").length,
      overflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    };
  });

  await page.screenshot({ path: path.join(OUT_DIR, `${label}_act12_selenite.png`) });

  // Interact with SeleniteChips: click Detected chip
  const detectedBtn = page.locator('[data-testid="observation-gap-selenite-chips"] button[aria-label^="Detected"]');
  await detectedBtn.click();
  await page.waitForTimeout(420);
  const afterDetectedClick = await page.evaluate(() => {
    const chips = document.querySelector('[data-testid="observation-gap-selenite-chips"]');
    return {
      activeFilter: chips?.getAttribute("data-active-filter"),
      carouselCards: document.querySelectorAll("#observation-gap .car-slot").length,
    };
  });

  // Switch back to All via clicking All chip
  const allBtn = page.locator('[data-testid="observation-gap-selenite-chips"] button[aria-label^="All"]');
  await allBtn.click();
  await page.waitForTimeout(350);

  // 6. Reverse scroll ACT 12 -> ACT 11 -> ACT 10
  await scrollToProgress(page, 0.925);
  const reverse11 = await page.evaluate(() => window.__ECOSONIC_CINEMATIC__?.getState()?.act);
  await scrollToProgress(page, 0.872);
  const reverse10 = await page.evaluate(() => ({
    act: window.__ECOSONIC_CINEMATIC__?.getState()?.act,
    globePresent: Boolean(document.querySelector('[data-testid="act10-photo-card-globe"] canvas')),
  }));

  await context.close();
  return {
    label,
    reducedMotion,
    act10Check,
    overlap10to11,
    act11Check,
    overlap11to12,
    act12Initial,
    afterDetectedClick,
    reverse11,
    reverse10,
    failedAssets,
    pageErrors,
    consoleErrors,
  };
}

async function run() {
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--disable-gpu-vsync",
    ],
  });

  const results = [];
  try {
    results.push(await runViewportCase(browser, { label: "desktop_1440x900", width: 1440, height: 900 }));
    results.push(await runViewportCase(browser, { label: "desktop_1920x1080", width: 1920, height: 1080 }));
    results.push(await runViewportCase(browser, { label: "mobile_390x844", width: 390, height: 844, isMobile: true }));
    results.push(await runViewportCase(browser, { label: "mobile_412x915", width: 412, height: 915, isMobile: true }));
    results.push(
      await runViewportCase(browser, {
        label: "desktop_1440x900_reduced",
        width: 1440,
        height: 900,
        reducedMotion: true,
      }),
    );
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify(results, null, 2));
  for (const r of results) {
    if (r.pageErrors.length > 0 || r.consoleErrors.length > 0) {
      throw new Error(`Console/page errors on ${r.label}: page=${r.pageErrors.join(";")} console=${r.consoleErrors.join(";")}`);
    }
    if (r.failedAssets.length > 0) {
      throw new Error(`Failed local assets on ${r.label}: ${JSON.stringify(r.failedAssets)}`);
    }
    if (!r.act10Check.present || r.act10Check.canvasW <= 0 || r.act10Check.overflowPx > 0) {
      throw new Error(`ACT 10 PhotoCardGlobe check failed on ${r.label}: ${JSON.stringify(r.act10Check)}`);
    }
    if (r.overlap10to11.sharedCanvases !== 1 || r.overlap11to12.sharedCanvases !== 1) {
      throw new Error(`Shared GalleryTunnel canvas duplicated on ${r.label}`);
    }
    if (r.act12Initial.legacyButtons !== 0 || r.act12Initial.chipButtons.length !== 4 || r.act12Initial.overflowPx > 0) {
      throw new Error(`ACT 12 SeleniteChips check failed on ${r.label}: ${JSON.stringify(r.act12Initial)}`);
    }
    if (r.afterDetectedClick.activeFilter !== "expected_and_detected") {
      throw new Error(`ACT 12 SeleniteChips filter click failed on ${r.label}: ${JSON.stringify(r.afterDetectedClick)}`);
    }
    if (r.reverse11 !== "ACT_11_EXPECTED_SPECIES" || r.reverse10.act !== "ACT_10_ECOLOGICAL_CONTEXT" || !r.reverse10.globePresent) {
      throw new Error(`Reverse scroll check failed on ${r.label}: ${JSON.stringify({ reverse11: r.reverse11, reverse10: r.reverse10 })}`);
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
