import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const executablePath = fs.existsSync(CHROME_PATH) ? CHROME_PATH : EDGE_PATH;

const OUT_DIR = path.resolve("docs/audit_evidence/v1_final_polish");
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
              session_id: "pw-polish-session",
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
              session_id: "pw-polish-session",
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
  await page.waitForTimeout(380);
}

async function scrollSmoothTo(page, targetProgress) {
  await page.evaluate((p) => {
    window.__ECOSONIC_CINEMATIC__?.scrollToProgress(p, false);
  }, targetProgress);
  await page.waitForTimeout(480);
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
        body: '{"id":"pw-polish-session"}',
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
  const birdAudioResponses = [];
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
    if (url.includes("birds_forest")) {
      birdAudioResponses.push({ url, status: res.status() });
    }
    if (res.status() >= 400 && !url.includes("/api/v1/")) {
      failedAssets.push({ url, status: res.status() });
    }
  });

  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="scribble-loop-nav"]', { timeout: 10000 });
  await page.waitForSelector('[data-testid="ambient-audio-toggle"]', { timeout: 10000 });
  await page.waitForSelector('[data-testid="microphone-session-toggle"]', { timeout: 10000 });
  await page.waitForTimeout(500);

  // Verify no AudioContext was created automatically before user gesture
  const audioCountBeforeGesture = await page.evaluate(
    () => window.__ECOSONIC_AUDIO_CONTEXT_COUNT__ ?? 0,
  );

  // Forward scene & boundary continuity audit across 02..12
  const sequenceChecks = [];
  for (const [actId, prog, slug] of [
    ["ACT_02_FOREST", 0.5, "act02_forest"],
    ["ACT_02_FOREST", 0.96, "boundary_forest_leaf"],
    ["ACT_03_LEAF", 0.5, "act03_leaf"],
    ["ACT_03_LEAF", 0.96, "boundary_leaf_water"],
    ["ACT_04_WATER", 0.5, "act04_water"],
    ["ACT_04_WATER", 0.96, "boundary_water_sound"],
    ["ACT_05_SOUND", 0.5, "act05_sound"],
    ["ACT_05_SOUND", 0.96, "boundary_sound_field"],
    ["ACT_06_ACOUSTIC_FIELD", 0.5, "act06_field"],
    ["ACT_07_SPECIES", 0.5, "act07_species"],
    ["ACT_11_EXPECTED_SPECIES", 0.5, "act11_expected"],
    ["ACT_12_OBSERVATION_GAP", 0.5, "act12_gap"],
  ]) {
    await jumpToAct(page, actId, prog);
    const snap = await page.evaluate(() => {
      const state = window.__ECOSONIC_CINEMATIC__?.getState();
      const imgs = Array.from(document.querySelectorAll("img"));
      return {
        act: state?.act,
        canvasCount: document.querySelectorAll("canvas").length,
        overflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
        brokenImgs: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src),
        ecologicalFieldOpacity: state?.weights?.ecologicalFieldOpacity ?? 0,
      };
    });
    sequenceChecks.push(snap);
    if (
      (label === "desktop_1440x900" || label === "mobile_390x844") &&
      ["boundary_forest_leaf", "boundary_water_sound", "act06_field", "act07_species", "act12_gap"].includes(slug)
    ) {
      await page.screenshot({ path: path.join(OUT_DIR, `${label}_${slug}.png`) });
    }
  }

  // Smooth incremental scrub check (non-instant scroll)
  await scrollSmoothTo(page, 0.25);
  await scrollSmoothTo(page, 0.5);

  // Reverse scroll verification across 12 -> 07 -> 06 -> 05 -> 03 -> 02 -> 01
  const reverseActs = [];
  for (const actId of [
    "ACT_07_SPECIES",
    "ACT_06_ACOUSTIC_FIELD",
    "ACT_05_SOUND",
    "ACT_03_LEAF",
    "ACT_02_FOREST",
    "ACT_01_BLACKNESS",
  ]) {
    await jumpToAct(page, actId, 0.5);
    reverseActs.push(await page.evaluate(() => window.__ECOSONIC_CINEMATIC__?.getState()?.act));
  }

  // User gesture -> Ambient bird audio unlock + Mute -> Unmute verification
  await page.click('button[aria-label="Act 02: Forest"]');
  await page.waitForFunction(
    () => window.__ECOSONIC_CINEMATIC__?.getState()?.act === "ACT_02_FOREST",
    undefined,
    { timeout: 6000 },
  );
  await page.waitForTimeout(500);

  const audioCountAfterGesture = await page.evaluate(
    () => window.__ECOSONIC_AUDIO_CONTEXT_COUNT__ ?? 0,
  );

  // Mute -> Unmute toggle test
  const initialMutePressed = await page.getAttribute('[data-testid="ambient-audio-toggle"]', "aria-pressed");
  await page.click('[data-testid="ambient-audio-toggle"]');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="ambient-audio-toggle"]')?.getAttribute("aria-pressed") === "false",
    undefined,
    { timeout: 4000 },
  );
  const mutedText = await page.textContent('[data-testid="ambient-audio-toggle"]');

  await page.click('[data-testid="ambient-audio-toggle"]');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="ambient-audio-toggle"]')?.getAttribute("aria-pressed") === "true",
    undefined,
    { timeout: 4000 },
  );
  const unmutedText = await page.textContent('[data-testid="ambient-audio-toggle"]');

  // Heading stability check
  const h1BoxBefore = await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    return h1 ? { w: Math.round(h1.getBoundingClientRect().width), h: Math.round(h1.getBoundingClientRect().height) } : null;
  });
  await page.waitForTimeout(350);
  const h1BoxAfter = await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    return h1 ? { w: Math.round(h1.getBoundingClientRect().width), h: Math.round(h1.getBoundingClientRect().height) } : null;
  });

  if (label === "mobile_412x915" || label === "desktop_1920x1080") {
    await page.screenshot({ path: path.join(OUT_DIR, `${label}_act02_audio.png`) });
  }

  await context.close();
  return {
    label,
    reducedMotion,
    audioCountBeforeGesture,
    audioCountAfterGesture,
    birdAudioResponses,
    muteCycle: {
      initialMutePressed,
      mutedText: mutedText?.trim(),
      unmutedText: unmutedText?.trim(),
    },
    sequenceChecks,
    reverseActs,
    h1BoxBefore,
    h1BoxAfter,
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
    if (r.audioCountBeforeGesture !== 0 || r.audioCountAfterGesture !== 1) {
      throw new Error(
        `Unexpected AudioContext lifecycle on ${r.label}: before=${r.audioCountBeforeGesture}, after=${r.audioCountAfterGesture}`,
      );
    }
    if (!r.birdAudioResponses.some((res) => res.status === 200)) {
      throw new Error(`Bird audio file not loaded on ${r.label}`);
    }
    if (r.sequenceChecks.some((c) => c.canvasCount !== 1 || c.overflowPx > 0 || c.brokenImgs.length > 0)) {
      throw new Error(`Layout/canvas/image regression on ${r.label}: ${JSON.stringify(r.sequenceChecks)}`);
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
