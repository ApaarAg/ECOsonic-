import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const executablePath = fs.existsSync(CHROME_PATH) ? CHROME_PATH : EDGE_PATH;

const OUT_DIR = path.resolve("docs/audit_evidence/final_visual_polish");
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
              session_id: "pw-final-polish",
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
              session_id: "pw-final-polish",
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
  await page.waitForFunction(
    (expectedId) => window.__ECOSONIC_CINEMATIC__?.getState().act === expectedId,
    actId,
    { timeout: 6000 },
  );
  await page.waitForTimeout(350);
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
        body: '{"id":"pw-final-polish"}',
      });
    }
    if (url.includes("/api/v1/live/sessions/") && url.endsWith("/stop")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
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
  await page.waitForSelector('[data-testid="landing-ecosonic-spotlight"]', { timeout: 10000 });
  await page.waitForSelector('[data-testid="pixel-swarm-nav"]', { timeout: 10000 });
  await page.waitForTimeout(650);

  // 1. Check landing ECOsonic spotlight + initial chrome state
  const landingSnap = await page.evaluate(() => {
    const spotlight = document.querySelector('[data-testid="landing-ecosonic-spotlight"]');
    return {
      spotlightVisible: Boolean(spotlight && parseFloat(getComputedStyle(spotlight).opacity) > 0.8),
      spotlightText: spotlight?.textContent?.trim() || "",
      oldScribbleAbsent: !document.querySelector('[data-testid="scribble-loop-nav"]'),
      pixelSwarmPresent: Boolean(document.querySelector('[data-testid="pixel-swarm-nav"]')),
      chromeInitialVisible: document.querySelector('[data-testid="ecosonic-top-chrome"]')?.getAttribute("data-visible"),
    };
  });
  if (label === "desktop_1440x900" || label === "mobile_390x844") {
    await page.screenshot({ path: path.join(OUT_DIR, `${label}_act01_spotlight.png`) });
  }

  // 2. Test Top Panel Auto-Hide on active scroll + top-edge pointer / idle restore
  await page.mouse.move(Math.round(width / 2), Math.round(height / 2));
  await page.evaluate(() => {
    const maxY = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: Math.round(maxY * 0.14), behavior: "auto" });
  });
  await page.waitForTimeout(160);
  const chromeAfterScroll = await page.getAttribute('[data-testid="ecosonic-top-chrome"]', "data-visible");

  await page.mouse.move(Math.round(width / 2), 20);
  await page.waitForTimeout(180);
  const chromeOnTopPointer = await page.getAttribute('[data-testid="ecosonic-top-chrome"]', "data-visible");

  // 3. Test Pixel Swarm Dropdown open + chapter select (06 · Acoustic Field)
  await page.click('[data-testid="pixel-swarm-trigger"]');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="pixel-swarm-trigger"]')?.getAttribute("aria-expanded") === "true",
    undefined,
    { timeout: 4000 },
  );
  await page.waitForTimeout(850);
  if (label === "desktop_1440x900" || label === "mobile_412x915") {
    await page.screenshot({ path: path.join(OUT_DIR, `${label}_pixel_swarm_open.png`) });
  }
  await page.click('button[role="option"]:has-text("06 · Acoustic Field")');
  await page.waitForFunction(
    () => window.__ECOSONIC_CINEMATIC__?.getState()?.act === "ACT_06_ACOUSTIC_FIELD",
    undefined,
    { timeout: 15000 },
  );
  await page.waitForTimeout(450);

  // 4. Verify ACT 06 removes "DEMO" and "SILENCE" and landing spotlight stays hidden
  const act06Check = await page.evaluate(() => {
    const text = document.body.textContent || "";
    return {
      hasWordDemo: /\bDEMO\b/i.test(text),
      hasWordSilence: /\bSILENCE\b/i.test(text),
      hasAcousticField: /Acoustic Field/i.test(text),
      landingSpotlightMounted: Boolean(document.querySelector('[data-testid="landing-ecosonic-spotlight"]')),
    };
  });
  if (label === "desktop_1440x900") {
    await page.screenshot({ path: path.join(OUT_DIR, `${label}_act06_clean.png`) });
  }

  // 5. Inspect ACT 10 -> ACT 11 -> ACT 12 overlapping transitions
  await jumpToAct(page, "ACT_10_ECOLOGICAL_CONTEXT", 0.94);
  const overlap10To11 = await page.evaluate(() => {
    const tunnelState = window.__ECOSONIC_CINEMATIC__?.getState();
    const expectedVisible = Boolean(document.querySelector("#expected-species"));
    return {
      act: tunnelState?.act,
      ecologicalFieldOpacity: tunnelState?.weights?.ecologicalFieldOpacity ?? 0,
      globeOpacity: tunnelState?.weights?.globeOpacity ?? 0,
      expectedVisible,
    };
  });
  if (label === "desktop_1440x900") {
    await page.screenshot({ path: path.join(OUT_DIR, `${label}_overlap_10_11.png`) });
  }

  await jumpToAct(page, "ACT_11_EXPECTED_SPECIES", 0.94);
  const overlap11To12 = await page.evaluate(() => {
    const state = window.__ECOSONIC_CINEMATIC__?.getState();
    return {
      act: state?.act,
      expectedVisible: Boolean(document.querySelector("#expected-species")),
      gapVisible: Boolean(document.querySelector("#observation-gap")),
      webglCanvasCount: document.querySelectorAll('[data-testid="shared-scene-background"] canvas').length,
    };
  });
  if (label === "desktop_1440x900") {
    await page.screenshot({ path: path.join(OUT_DIR, `${label}_overlap_11_12.png`) });
  }

  await jumpToAct(page, "ACT_12_OBSERVATION_GAP", 0.5);
  await page.waitForTimeout(250);
  if (label === "desktop_1440x900" || label === "desktop_1920x1080" || label === "mobile_390x844") {
    await page.screenshot({ path: path.join(OUT_DIR, `${label}_act12_typography.png`) });
  }

  // 6. Test Heading Hover-Text interaction without shifting H1 box
  const h1Before = await page.evaluate(() => {
    const h1 = document.querySelector("#observation-gap h1");
    return h1 ? { w: Math.round(h1.getBoundingClientRect().width), h: Math.round(h1.getBoundingClientRect().height) } : null;
  });
  if (isMobile) {
    await page.tap("#observation-gap h1");
  } else {
    await page.hover("#observation-gap h1");
  }
  await page.waitForTimeout(240);
  const hoverCheck = await page.evaluate(() => {
    const h1 = document.querySelector("#observation-gap h1");
    const note = document.querySelector('[data-testid="heading-hover-note-ACT_12_HEADING"]');
    return {
      noteText: note?.textContent?.trim() || "",
      noteOpacity: note ? parseFloat(getComputedStyle(note).opacity) : 0,
      h1After: h1 ? { w: Math.round(h1.getBoundingClientRect().width), h: Math.round(h1.getBoundingClientRect().height) } : null,
    };
  });

  // 7. Reverse scroll ACT 12 -> ACT 11 -> ACT 10 -> ACT 02 -> ACT 01
  const reverseActs = [];
  for (const actId of [
    "ACT_11_EXPECTED_SPECIES",
    "ACT_10_ECOLOGICAL_CONTEXT",
    "ACT_02_FOREST",
    "ACT_01_BLACKNESS",
  ]) {
    await jumpToAct(page, actId, 0.5);
    reverseActs.push(await page.evaluate(() => window.__ECOSONIC_CINEMATIC__?.getState()?.act));
  }

  const layoutFinal = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll("img"));
    return {
      webglCanvasCount: document.querySelectorAll('[data-testid="shared-scene-background"] canvas').length,
      overflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      brokenImgs: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src),
    };
  });

  await context.close();
  return {
    label,
    reducedMotion,
    landingSnap,
    chromeAfterScroll,
    chromeOnTopPointer,
    act06Check,
    overlap10To11,
    overlap11To12,
    h1Before,
    hoverCheck,
    reverseActs,
    layoutFinal,
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
    if (r.layoutFinal.webglCanvasCount !== 1 || r.layoutFinal.overflowPx > 0 || r.layoutFinal.brokenImgs.length > 0) {
      throw new Error(`Layout/canvas/image regression on ${r.label}: ${JSON.stringify(r.layoutFinal)}`);
    }
    if (r.act06Check.hasWordDemo || r.act06Check.hasWordSilence || r.act06Check.landingSpotlightMounted) {
      throw new Error(`ACT 06 check failed on ${r.label}: ${JSON.stringify(r.act06Check)}`);
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
