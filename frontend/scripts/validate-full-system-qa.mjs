import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const executablePath = fs.existsSync(CHROME_PATH) ? CHROME_PATH : EDGE_PATH;

const BASE_URL = process.env.PW_BASE_URL || "http://127.0.0.1:5173";
const AUDIO_PATH = path.resolve("../backend/data/smoke_audio/birds_forest_e2e.wav");
const OUT_DIR = path.resolve(
  "C:\\Users\\apaar\\.gemini\\antigravity\\brain\\62c40627-2d0f-460a-86ad-b75db6687995\\scratch\\full_system_qa",
);
fs.mkdirSync(OUT_DIR, { recursive: true });

async function jumpToAct(page, actId, progress = 0.55) {
  await page.evaluate(
    ({ id, prog }) => {
      window.__ECOSONIC_CINEMATIC__?.jumpToAct(id, prog);
    },
    { id: actId, prog: progress },
  );
  await page.waitForFunction(
    (expectedId) => window.__ECOSONIC_CINEMATIC__?.getState().act === expectedId,
    actId,
    { timeout: 8000 },
  );
  await page.waitForTimeout(450);
}

async function waitForUploadCompletion(page, timeoutMs = 45000) {
  await page.waitForSelector('[data-testid="jump-to-ecology-after-analysis"]', {
    timeout: timeoutMs,
  });
}

async function main() {
  if (!fs.existsSync(AUDIO_PATH)) {
    throw new Error(`Smoke WAV audio missing at ${AUDIO_PATH}`);
  }
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });

  const consoleErrors = [];
  const pageErrors = [];
  const unexpectedHttpErrors = [];

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });
    page.on("pageerror", (err) => pageErrors.push(String(err)));
    page.on("response", (res) => {
      if (res.status() >= 400) {
        unexpectedHttpErrors.push({ url: res.url(), status: res.status() });
      }
    });

    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="shared-scene-background"]', { timeout: 15000 });
    await page.waitForSelector('[data-testid="open-analysis-panel-btn"]', { timeout: 10000 });
    await page.waitForTimeout(600);

    // ------------------------------------------------------------------
    // 1. Partial/invalid coordinates validation in Analyze drawer
    // ------------------------------------------------------------------
    await page.click('[data-testid="open-analysis-panel-btn"]');
    await page.waitForSelector('[data-testid="analysis-workspace-panel"]');
    await page.setInputFiles('[data-testid="analysis-audio-input"]', AUDIO_PATH);
    await page.fill('[data-testid="analysis-latitude-input"]', "48.40");
    await page.click('[data-testid="submit-analysis-btn"]');
    const coordAlertText = await page.locator('[role="alert"]').textContent();

    // ------------------------------------------------------------------
    // 2. Upload real audio WITHOUT coordinates -> location_unspecified honest state
    // ------------------------------------------------------------------
    await page.click('button:has-text("Clear Coords")');
    await page.click('[data-testid="submit-analysis-btn"]');
    await waitForUploadCompletion(page, 60000);
    await page.click('[data-testid="jump-to-ecology-after-analysis"]');
    await page.waitForTimeout(500);

    await jumpToAct(page, "ACT_10_ECOLOGICAL_CONTEXT", 0.55);
    const noCoordsAct10Text = await page.evaluate(() => document.body.innerText);

    await page.screenshot({ path: path.join(OUT_DIR, "act10_no_coords.png") });

    await jumpToAct(page, "ACT_11_EXPECTED_SPECIES", 0.55);
    const noCoordsAct11Text = await page.evaluate(() => document.body.innerText);

    await jumpToAct(page, "ACT_12_OBSERVATION_GAP", 0.55);
    const noCoordsAct12Text = await page.evaluate(() => document.body.innerText);

    // ------------------------------------------------------------------
    // 3. Upload real audio WITH coordinates (48.40, 2.70) -> Real BirdNET + Geo V3.0
    // ------------------------------------------------------------------
    await page.click('[data-testid="open-analysis-panel-btn"]');
    await page.waitForSelector('[data-testid="analysis-workspace-panel"]');
    await page.setInputFiles('[data-testid="analysis-audio-input"]', AUDIO_PATH);
    await page.fill('[data-testid="analysis-latitude-input"]', "48.40");
    await page.fill('[data-testid="analysis-longitude-input"]', "2.70");
    await page.fill('input[type="datetime-local"]', "2026-05-15T06:30");
    await page.click('[data-testid="submit-analysis-btn"]');
    await waitForUploadCompletion(page, 60000);
    const currentUrlWithAnalysis = page.url();
    await page.click('[data-testid="jump-to-ecology-after-analysis"]');
    await page.waitForTimeout(600);

    // Act 10 (1440x900)
    await jumpToAct(page, "ACT_10_ECOLOGICAL_CONTEXT", 0.55);
    await page.waitForSelector('[data-testid="act10-photo-card-globe"] canvas', { timeout: 8000 });
    await page.waitForTimeout(650);
    const act10Desktop = await page.evaluate(() => ({
      text: document.body.innerText,
      globePresent: Boolean(document.querySelector('[data-testid="act10-photo-card-globe"] canvas')),
      sharedCanvases: document.querySelectorAll('[data-testid="shared-scene-background"] canvas').length,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    await page.screenshot({ path: path.join(OUT_DIR, "act10_desktop.png") });

    // Act 11 (1440x900) + Field Note check
    await jumpToAct(page, "ACT_11_EXPECTED_SPECIES", 0.55);
    await page.waitForTimeout(650);
    const act11Desktop = await page.evaluate(() => ({
      buttons: Array.from(document.querySelectorAll('#expected-species button[aria-label*="Open field note"]')).length,
      text: document.body.innerText,
      sharedCanvases: document.querySelectorAll('[data-testid="shared-scene-background"] canvas').length,
    }));
    await page.screenshot({ path: path.join(OUT_DIR, "act11_desktop.png") });

    const firstNoteBtn = page.locator('#expected-species button[aria-label*="Open field note"]').first();
    await firstNoteBtn.click();
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
    await page.waitForTimeout(450);
    const fieldNoteDialogInfo = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const img = dlg?.querySelector("img");
      return {
        text: dlg?.textContent?.slice(0, 600) ?? "",
        imgSrc: img?.getAttribute("src") ?? null,
        imgNaturalWidth: img?.naturalWidth ?? 0,
      };
    });
    await page.screenshot({ path: path.join(OUT_DIR, "act11_fieldnote_desktop.png") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // Act 12 (1440x900) + SeleniteChips + Stacked Cards + Field Note check
    await jumpToAct(page, "ACT_12_OBSERVATION_GAP", 0.55);
    await page.waitForSelector('[data-testid="observation-gap-card-stack"]', { timeout: 8000 });
    await page.waitForTimeout(650);
    const act12Desktop = await page.evaluate(() => ({
      hasChips: Boolean(document.querySelector('[data-testid="observation-gap-selenite-chips"] canvas')),
      hasStack: Boolean(document.querySelector('[data-testid="observation-gap-card-stack"]')),
      text: document.body.innerText,
      sharedCanvases: document.querySelectorAll('[data-testid="shared-scene-background"] canvas').length,
    }));
    await page.screenshot({ path: path.join(OUT_DIR, "act12_desktop.png") });

    // ------------------------------------------------------------------
    // 4. Reload Persistence Check (?analysis=<id> survives hard refresh)
    // ------------------------------------------------------------------
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="shared-scene-background"]', { timeout: 15000 });
    await page.waitForTimeout(800);
    await jumpToAct(page, "ACT_12_OBSERVATION_GAP", 0.55);
    await page.waitForSelector('[data-testid="observation-gap-card-stack"]', { timeout: 10000 });
    const afterReloadAct12Text = await page.evaluate(() => document.body.innerText);

    // ------------------------------------------------------------------
    // 5. Multi-Viewport Responsive Checks (1920x1080, 390x844, 412x915)
    // ------------------------------------------------------------------
    const viewportsReport = [];
    for (const vp of [
      { label: "desktop_1920", width: 1920, height: 1080 },
      { label: "mobile_390", width: 390, height: 844 },
      { label: "mobile_412", width: 412, height: 915 },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await jumpToAct(page, "ACT_10_ECOLOGICAL_CONTEXT", 0.55);
      await page.waitForTimeout(450);
      const v10 = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        sharedCanvases: document.querySelectorAll('[data-testid="shared-scene-background"] canvas').length,
      }));
      if (vp.label === "mobile_390") {
        await page.screenshot({ path: path.join(OUT_DIR, "act10_mobile.png") });
      }
      await jumpToAct(page, "ACT_12_OBSERVATION_GAP", 0.55);
      await page.waitForTimeout(450);
      const v12 = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        hasStack: Boolean(document.querySelector('[data-testid="observation-gap-card-stack"]')),
      }));
      if (vp.label === "mobile_390") {
        await page.screenshot({ path: path.join(OUT_DIR, "act12_mobile.png") });
      }
      viewportsReport.push({ ...vp, v10, v12 });
    }

    const summary = {
      urlWithAnalysis: currentUrlWithAnalysis,
      coordAlertText,
      noCoordsHonesty: {
        act10MissingRef: /LOCATION UNSPECIFIED IN SESSION|GEOSPATIAL SPECIES REFERENCE UNAVAILABLE/i.test(noCoordsAct10Text),
        act11NoExpected: /NO EXPECTED SPECIES AVAILABLE/i.test(noCoordsAct11Text),
        act12Incomplete: /OBSERVATION CORRESPONDENCE INCOMPLETE/i.test(noCoordsAct12Text),
      },
      act10: {
        globePresent: act10Desktop.globePresent,
        hasExpectedRef: /EXPECTED \(REF\)/i.test(act10Desktop.text),
        hasSpringOrTemperate: /spring|Temperate/i.test(act10Desktop.text),
        sharedCanvases: act10Desktop.sharedCanvases,
        noOverflow: act10Desktop.scrollWidth <= act10Desktop.innerWidth,
      },
      act11: {
        specimenNoteButtons: act11Desktop.buttons,
        sharedCanvases: act11Desktop.sharedCanvases,
        fieldNoteImgSrc: fieldNoteDialogInfo.imgSrc,
        fieldNoteImgLoaded: fieldNoteDialogInfo.imgNaturalWidth > 0,
      },
      act12: {
        hasSeleniteChipsCanvas: act12Desktop.hasChips,
        hasCardStack: act12Desktop.hasStack,
        sharedCanvases: act12Desktop.sharedCanvases,
      },
      reloadPersistence: {
        preservedAnalysisParam: /[?&]analysis=/.test(currentUrlWithAnalysis),
        act12PopulatedAfterReload:
          /EXPECTED\s+\d+/.test(afterReloadAct12Text) &&
          !/DEMO OBSERVATION/i.test(afterReloadAct12Text),
      },
      viewportsReport,
      consoleErrors,
      pageErrors,
      unexpectedHttpErrors,
    };

    console.log(JSON.stringify(summary, null, 2));

    if (
      !summary.coordAlertText ||
      !summary.noCoordsHonesty.act10MissingRef ||
      !summary.noCoordsHonesty.act11NoExpected ||
      !summary.noCoordsHonesty.act12Incomplete ||
      !summary.act10.globePresent ||
      !summary.act10.hasExpectedRef ||
      !summary.act11.specimenNoteButtons ||
      !summary.act12.hasCardStack ||
      !summary.reloadPersistence.preservedAnalysisParam ||
      !summary.reloadPersistence.act12PopulatedAfterReload ||
      consoleErrors.length > 0 ||
      pageErrors.length > 0 ||
      unexpectedHttpErrors.length > 0
    ) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
