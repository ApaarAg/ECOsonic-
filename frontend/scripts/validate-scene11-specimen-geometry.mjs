import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const executablePath = fs.existsSync(CHROME_PATH) ? CHROME_PATH : EDGE_PATH;

const OUT_DIR = path.resolve("docs/audit_evidence/scene11_specimen_geometry");
fs.mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORTS = [
  { width: 1440, height: 900, label: "1440x900" },
  { width: 1920, height: 1080, label: "1920x1080" },
  { width: 390, height: 844, label: "390x844" },
  { width: 412, height: 915, label: "412x915" },
];

async function runValidation() {
  console.log("=== Validating Scene 11 Specimen Plate Geometry Refinement ===");

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
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("http://localhost:5173/?act=ecology", {
      waitUntil: "domcontentloaded",
    });

    await page.waitForFunction(() => Boolean(window.__ECOSONIC_CINEMATIC__), { timeout: 10000 });
    await page.evaluate(() => {
      window.__ECOSONIC_CINEMATIC__.jumpToAct("ACT_10_ECOLOGICAL_CONTEXT", 0.64);
    });
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      window.__ECOSONIC_CINEMATIC__.jumpToAct("ACT_11_EXPECTED_SPECIES", 0.5);
    });

    await page.waitForSelector("#expected-species", { timeout: 10000 });
    await page.waitForFunction(
      () => !document.body.innerText.includes("ASSEMBLING ECOLOGICAL BASELINE"),
      { timeout: 8000 },
    ).catch(() => {});

    const demoBtn = page.locator("button", { hasText: /Load Demo Observation/i });
    if (await demoBtn.count()) {
      await demoBtn.first().click();
    }

    await page.waitForSelector('#expected-species button[data-selected="true"]', { timeout: 8000 });
    await page.waitForTimeout(600);

    // Advance one step so both left AND right neighbors are visible on screen!
    const nextBtn = page.locator('button[aria-label="Next expected species"]');
    if (await nextBtn.count()) {
      await nextBtn.click();
      await page.waitForTimeout(750);
    }

    const geometryAudit = await page.evaluate(() => {
      const activeBtn = document.querySelector('#expected-species button[data-selected="true"]');
      const activePlate = activeBtn?.querySelector('[data-plate-tilt-target="true"]');
      const activeSvgBorder = activeBtn?.querySelector('[data-testid="specimen-plate-border"] path');
      const aperture = activeBtn?.querySelector('[data-testid="specimen-image-aperture"]');
      const apertureImg = aperture?.querySelector("img");

      const leftNeighbor = document.querySelector('#expected-species button[data-plate-variant="left"]');
      const rightNeighbor = document.querySelector('#expected-species button[data-plate-variant="right"]');

      const activePlateStyle = activePlate ? window.getComputedStyle(activePlate) : null;
      const apertureStyle = aperture ? window.getComputedStyle(aperture) : null;
      const activeBtnStyle = activeBtn ? window.getComputedStyle(activeBtn) : null;

      const bg = document.querySelector('[data-testid="shared-scene-background"]');
      const canvases = document.querySelectorAll("canvas");

      return {
        activeVariant: activeBtn?.getAttribute("data-plate-variant"),
        activeClipPath: activePlateStyle?.clipPath,
        activeHasRectangularCssBorder: activePlateStyle?.borderTopWidth !== "0px",
        activeHasRectangularBoxShadow: activeBtnStyle?.boxShadow !== "none",
        activeDropShadowFilter: activeBtnStyle?.filter,
        activeSvgPathD: activeSvgBorder?.getAttribute("d") || "",
        apertureClipPath: apertureStyle?.clipPath,
        apertureImageLoaded: Boolean(apertureImg && apertureImg.complete && apertureImg.naturalWidth > 0),
        leftNeighborPresent: Boolean(leftNeighbor),
        leftNeighborClipPath: leftNeighbor
          ? window.getComputedStyle(leftNeighbor.querySelector("div")).clipPath
          : null,
        rightNeighborPresent: Boolean(rightNeighbor),
        rightNeighborClipPath: rightNeighbor
          ? window.getComputedStyle(rightNeighbor.querySelector("div")).clipPath
          : null,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        sharedBgPresent: Boolean(bg),
        canvasCount: canvases.length,
      };
    });

    console.log(
      `  Active: variant=${geometryAudit.activeVariant}, clip=${geometryAudit.activeClipPath}, rectBorder=${geometryAudit.activeHasRectangularCssBorder}, rectShadow=${geometryAudit.activeHasRectangularBoxShadow}, apertureClip=${geometryAudit.apertureClipPath}`,
    );
    console.log(
      `  Neighbors: left=${geometryAudit.leftNeighborPresent}, right=${geometryAudit.rightNeighborPresent}, overflow=${geometryAudit.horizontalOverflow}, canvases=${geometryAudit.canvasCount}`,
    );

    await page.screenshot({ path: path.join(OUT_DIR, `specimen_plate_${vp.label}.png`) });

    // Verify clicking active specimen opens Field Note dialog and closing works
    const activeLocator = page.locator('#expected-species button[data-selected="true"]');
    await activeLocator.click();
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
    const dialogVisible = await page.locator('[role="dialog"]').isVisible();
    if (vp.label === "1440x900") {
      await page.screenshot({ path: path.join(OUT_DIR, "specimen_field_note_1440x900.png") });
    }
    const closeBtn = page.locator('[role="dialog"] button', { hasText: /Return to Archive/i });
    if (await closeBtn.count()) {
      await closeBtn.click();
      await page.waitForTimeout(400);
    }

    results.push({
      viewport: vp.label,
      geometryAudit,
      fieldNoteInteractive: dialogVisible,
      consoleErrorsCount: consoleErrors.length,
      consoleErrors,
    });

    await page.close();
  }

  await browser.close();

  const summaryPath = path.join(OUT_DIR, "validation_summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify({ results }, null, 2));
  console.log(`\nValidation complete! Summary written to: ${summaryPath}`);
}

runValidation().catch((err) => {
  console.error("Validation failed:", err);
  process.exit(1);
});
