import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const executablePath = fs.existsSync(CHROME_PATH) ? CHROME_PATH : EDGE_PATH;

const OUT_DIR = path.resolve("docs/audit_evidence/master_refinement");
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE_URL = process.env.PW_BASE_URL || "http://127.0.0.1:4173";

async function installTestShims(page) {
  await page.addInitScript(() => {
    const OriginalWS = window.WebSocket;
    class MockLiveWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      constructor(url) {
        super();
        this.url = url;
        this.readyState = 0;
        this.binaryType = "blob";
        this.protocol = "";
        setTimeout(() => {
          this.readyState = 1;
          this.onopen?.(new Event("open"));
          this.dispatchEvent(new Event("open"));
        }, 15);
      }
      send(payload) {
        if (typeof payload === "string" && payload.includes('"handshake"')) {
          setTimeout(() => {
            if (this.readyState !== 1) return;
            const ack = JSON.stringify({
              type: "handshake_ack",
              session_id: "pw-master-session",
              status: "ready",
              sample_rate: 32000,
              channels: 1,
              expected_seq: 0,
            });
            const evt = new MessageEvent("message", { data: ack });
            this.onmessage?.(evt);
            this.dispatchEvent(evt);
          }, 10);
        } else if (typeof payload === "string" && payload.includes('"stop"')) {
          setTimeout(() => {
            if (this.readyState !== 1) return;
            const ack = JSON.stringify({
              type: "session_stopped",
              session_id: "pw-master-session",
            });
            const evt = new MessageEvent("message", { data: ack });
            this.onmessage?.(evt);
            this.dispatchEvent(evt);
          }, 10);
        }
      }
      close() {
        this.readyState = 3;
        const evt = new CloseEvent("close", { code: 1000 });
        this.onclose?.(evt);
        this.dispatchEvent(evt);
      }
    }
    window.WebSocket = function PatchedWebSocket(url, protocols) {
      if (String(url).includes("/api/v1/live/sessions/")) {
        return new MockLiveWebSocket(url);
      }
      return protocols !== undefined ? new OriginalWS(url, protocols) : new OriginalWS(url);
    };
    window.WebSocket.CONNECTING = 0;
    window.WebSocket.OPEN = 1;
    window.WebSocket.CLOSING = 2;
    window.WebSocket.CLOSED = 3;
  });
}

async function jumpToAct(page, actId, progress) {
  await page.evaluate(
    ({ id, prog }) => {
      window.__ECOSONIC_CINEMATIC__?.jumpToAct(id, prog);
    },
    { id: actId, prog: progress },
  );
  try {
    await page.waitForFunction(
      (expectedId) => window.__ECOSONIC_CINEMATIC__?.getState().act === expectedId,
      actId,
      { timeout: 6000 },
    );
  } catch (err) {
    const diag = await page.evaluate(() => ({
      hasCinematic: Boolean(window.__ECOSONIC_CINEMATIC__),
      state: window.__ECOSONIC_CINEMATIC__?.getState() ?? null,
      diag: window.__ECOSONIC_DIAGNOSTICS__?.() ?? null,
    }));
    throw new Error(`jumpToAct(${actId}) failed: ${err.message}; diag=${JSON.stringify(diag)}`);
  }
  await page.waitForTimeout(450);
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
    permissions: ["microphone"],
  });
  const page = await context.newPage();
  await installTestShims(page);

  await page.route("**/api/v1/**", (route) => {
    const url = route.request().url();
    if (url.endsWith("/api/v1/live/sessions")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: '{"id":"pw-master-session"}',
      });
    }
    if (url.includes("/api/v1/live/sessions/") && url.endsWith("/stop")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      });
    }
    return route.abort();
  });

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
  await page.waitForSelector('[data-testid="scribble-loop-nav"]', { timeout: 10000 });
  await page.waitForSelector('[data-testid="microphone-session-toggle"]', { timeout: 10000 });
  await page.waitForTimeout(600);

  // Verify forward transitions: 01 -> 02 -> 03 -> 04 -> 05 -> 11 -> 12
  const transitions = [];
  for (const [actId, prog, slug] of [
    ["ACT_01_BLACKNESS", 0.5, "act01"],
    ["ACT_02_FOREST", 0.5, "act02"],
    ["ACT_03_LEAF", 0.5, "act03"],
    ["ACT_04_WATER", 0.5, "act04"],
    ["ACT_05_SOUND", 0.5, "act05"],
    ["ACT_11_EXPECTED_SPECIES", 0.5, "act11"],
    ["ACT_12_OBSERVATION_GAP", 0.5, "act12"],
  ]) {
    await jumpToAct(page, actId, prog);
    const snap = await page.evaluate(() => {
      const state = window.__ECOSONIC_CINEMATIC__?.getState();
      const bodyText = document.body.textContent || "";
      const imgs = Array.from(document.querySelectorAll("img"));
      const brokenImgs = imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src);
      return {
        act: state?.act,
        canvasCount: document.querySelectorAll("canvas").length,
        overflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
        brokenImgs,
        hasPlaceholderStudioCopy:
          bodyText.includes("Grown, not built") ||
          bodyText.includes("Let’s talk") ||
          bodyText.includes("CURRENT OBSERVATION") ||
          bodyText.includes("POST /api/v1/"),
      };
    });
    transitions.push(snap);
    if (label === "desktop_1440x900" || label === "mobile_390x844") {
      if (["act02", "act03", "act04", "act05", "act11", "act12"].includes(slug)) {
        await page.screenshot({ path: path.join(OUT_DIR, `${label}_${slug}.png`) });
      }
    }
  }

  // Reverse transitions: 12 -> 05 -> 03 -> 02 -> 01
  const reverseActs = [];
  for (const actId of ["ACT_05_SOUND", "ACT_03_LEAF", "ACT_02_FOREST", "ACT_01_BLACKNESS"]) {
    await jumpToAct(page, actId, 0.5);
    const cur = await page.evaluate(() => window.__ECOSONIC_CINEMATIC__?.getState()?.act);
    reverseActs.push(cur);
  }

  // Scribble Loop Navigation click interaction + SVG stroke check
  await page.click('button[aria-label="Act 06: Acoustic Field"]');
  await page.waitForFunction(
    () =>
      window.__ECOSONIC_CINEMATIC__?.getState()?.act === "ACT_06_ACOUSTIC_FIELD" &&
      document.querySelector('[data-testid="scribble-loop-nav"] button[aria-current="step"]')?.textContent?.trim() ===
        "06 FIELD",
    undefined,
    { timeout: 6000 },
  );
  await page.waitForTimeout(450);

  const navCheck = await page.evaluate(() => {
    const nav = document.querySelector('[data-testid="scribble-loop-nav"]');
    const pathEl = nav?.querySelector("path");
    const navButtons = nav ? Array.from(nav.querySelectorAll("button")).map((b) => b.textContent?.trim()) : [];
    const oldNav = document.querySelector("[data-cinematic-timeline-nav]");
    return {
      buttonCount: navButtons.length,
      navButtons,
      hasPathD: Boolean(pathEl?.getAttribute("d") && pathEl.getAttribute("d").length > 8),
      oldNavAbsent: !oldNav,
      activeStep: nav?.querySelector('button[aria-current="step"]')?.textContent?.trim() || null,
    };
  });
  if (label === "desktop_1440x900" || label === "mobile_412x915") {
    await page.screenshot({ path: path.join(OUT_DIR, `${label}_act06.png`) });
  }

  // Layout stability check on heading LetterCascade (two snapshots 350ms apart on ACT 02)
  await jumpToAct(page, "ACT_02_FOREST", 0.5);
  const h1BoxBefore = await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    return h1 ? { w: Math.round(h1.getBoundingClientRect().width), h: Math.round(h1.getBoundingClientRect().height) } : null;
  });
  await page.waitForTimeout(400);
  const h1BoxAfter = await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    return h1 ? { w: Math.round(h1.getBoundingClientRect().width), h: Math.round(h1.getBoundingClientRect().height) } : null;
  });

  // ECOsonic branding hover / tap reveal + non-shifting nav guarantee
  const firstNavLeftBefore = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="scribble-loop-nav"] button');
    return btn ? Math.round(btn.getBoundingClientRect().left) : null;
  });

  if (isMobile) {
    await page.click('[data-testid="ecosonic-brand-wordmark"]');
  } else {
    await page.hover('[data-testid="ecosonic-brand-wordmark"]');
  }
  await page.waitForFunction(
    () => {
      const id = document.querySelector('[data-testid="ecosonic-brand-identity"]');
      return Boolean(id && parseFloat(getComputedStyle(id).opacity) >= 0.9);
    },
    undefined,
    { timeout: 4000 },
  );

  const brandReveal = await page.evaluate(() => {
    const id = document.querySelector('[data-testid="ecosonic-brand-identity"]');
    const btn = document.querySelector('[data-testid="scribble-loop-nav"] button');
    return {
      expanded: document.querySelector('[data-testid="ecosonic-brand-wordmark"]')?.getAttribute("aria-expanded"),
      identityText: id?.textContent?.trim() || "",
      identityOpacity: id ? parseFloat(getComputedStyle(id).opacity) : 0,
      firstNavLeftAfter: btn ? Math.round(btn.getBoundingClientRect().left) : null,
    };
  });
  if (label === "desktop_1440x900" || label === "desktop_1920x1080") {
    await page.screenshot({ path: path.join(OUT_DIR, `${label}_brand_hover.png`) });
  }

  // Microphone toggle OFF -> ON -> OFF regression check
  await page.click('[data-testid="microphone-session-toggle"]');
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="microphone-session-toggle"]')?.getAttribute("aria-checked") ===
      "true",
    undefined,
    { timeout: 6000 },
  );
  await page.click('[data-testid="microphone-session-toggle"]');
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('[data-testid="microphone-session-toggle"]');
      return btn?.getAttribute("aria-checked") === "false" && btn?.getAttribute("aria-busy") === "false";
    },
    undefined,
    { timeout: 6000 },
  );

  await context.close();
  return {
    label,
    reducedMotion,
    transitions,
    reverseActs,
    navCheck,
    h1BoxBefore,
    h1BoxAfter,
    brandReveal: { ...brandReveal, firstNavLeftBefore },
    micCycleOk: true,
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
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
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
      throw new Error(`Errors on ${r.label}: page=${r.pageErrors.join(";")} console=${r.consoleErrors.join(";")}`);
    }
    if (r.failedAssets.length > 0) {
      throw new Error(`Failed assets on ${r.label}: ${JSON.stringify(r.failedAssets)}`);
    }
    for (const t of r.transitions) {
      if (t.overflowPx > 1) throw new Error(`Overflow ${t.overflowPx}px on ${r.label} at ${t.act}`);
      if (t.brokenImgs.length > 0) throw new Error(`Broken imgs on ${r.label}: ${t.brokenImgs.join(",")}`);
      if (t.hasPlaceholderStudioCopy) throw new Error(`Studio/debug copy found on ${r.label} at ${t.act}`);
    }
    if (!r.navCheck.oldNavAbsent || r.navCheck.buttonCount !== 11 || !r.navCheck.hasPathD) {
      throw new Error(`ScribbleLoopNav validation failed on ${r.label}: ${JSON.stringify(r.navCheck)}`);
    }
    if (r.navCheck.activeStep !== "06 FIELD") {
      throw new Error(`Expected active nav step '06 FIELD' after clicking Act 06 on ${r.label}, got '${r.navCheck.activeStep}'`);
    }
    if (r.brandReveal.identityOpacity < 0.9) {
      throw new Error(`Branding hover/tap reveal opacity low on ${r.label}: ${r.brandReveal.identityOpacity}`);
    }
    if (
      r.brandReveal.firstNavLeftBefore !== null &&
      r.brandReveal.firstNavLeftAfter !== null &&
      Math.abs(r.brandReveal.firstNavLeftAfter - r.brandReveal.firstNavLeftBefore) > 1
    ) {
      throw new Error(`Scribble nav shifted on branding hover in ${r.label}`);
    }
    if (r.h1BoxBefore && r.h1BoxAfter && Math.abs(r.h1BoxAfter.h - r.h1BoxBefore.h) > 2) {
      throw new Error(`Heading height shifted on ${r.label}: ${r.h1BoxBefore.h} -> ${r.h1BoxAfter.h}`);
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
