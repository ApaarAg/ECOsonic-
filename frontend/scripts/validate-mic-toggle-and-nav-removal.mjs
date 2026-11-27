import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const executablePath = fs.existsSync(CHROME_PATH) ? CHROME_PATH : EDGE_PATH;

const OUT_DIR = path.resolve("docs/audit_evidence/mic_toggle_nav_cleanup");
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE_URL = process.env.PW_BASE_URL || "http://127.0.0.1:4173";

async function installFakeAudioAndSocket(page) {
  await page.addInitScript(() => {
    // Only intercept backend live-session WebSockets so any dev/HMR socket stays untouched.
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
              session_id: "pw-mic-session",
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
              session_id: "pw-mic-session",
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
    window.__OriginalWS = OriginalWS;
  });
}

async function runViewport(browser, { label, width, height, isMobile = false }) {
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: isMobile,
    isMobile,
    permissions: ["microphone"],
  });
  const page = await context.newPage();
  await installFakeAudioAndSocket(page);
  await page.route("**/api/v1/**", (route) => {
    const url = route.request().url();
    if (url.endsWith("/api/v1/live/sessions")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: '{"id":"pw-mic-session"}',
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
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("net::ERR_FAILED")) {
      consoleErrors.push(m.text());
    }
  });

  await page.goto(`${BASE_URL}/?act=observation-gap`, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForSelector('[data-testid="microphone-session-toggle"]', { timeout: 10000 });
  } catch (err) {
    throw new Error(
      `Toggle missing on ${label}: ${err.message}; pageErrors=${JSON.stringify(pageErrors)}; consoleErrors=${JSON.stringify(consoleErrors)}`
    );
  }
  const demoBtn = page.locator("button", { hasText: "Load Demo Observation" });
  if ((await demoBtn.count()) > 0 && (await demoBtn.isVisible())) {
    await demoBtn.click();
    await page.mouse.move(16, 16);
  }
  await page.waitForTimeout(800);

  const offMetrics = await page.evaluate(() => {
    const toggle = document.querySelector('[data-testid="microphone-session-toggle"]');
    const thumb = toggle?.querySelector('span[aria-hidden="true"]');
    const rect = toggle?.getBoundingClientRect();
    const bodyText = document.body.textContent || "";
    const navLabels = ["02 FOREST", "03 LEAF", "04 WATER", "05 SOUND", "06 FIELD", "12 GAP"];
    return {
      togglePresent: Boolean(toggle),
      ariaChecked: toggle?.getAttribute("aria-checked"),
      trackBg: toggle ? getComputedStyle(toggle).backgroundColor : null,
      thumbOffsetPx:
        rect && thumb ? Math.round(thumb.getBoundingClientRect().left - rect.left) : null,
      rightEdgePx: rect ? Math.round(window.innerWidth - rect.right) : null,
      topPx: rect ? Math.round(rect.top) : null,
      navElementCount: document.querySelectorAll("[data-cinematic-timeline-nav]").length,
      navLabelsPresent: navLabels.filter((lbl) => bodyText.includes(lbl)),
      oldPipelineTextPresent:
        bodyText.toUpperCase().includes("ACOUSTIC PIPELINE") ||
        bodyText.toUpperCase().includes("START MICROPHONE"),
      overflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    };
  });
  await page.screenshot({ path: path.join(OUT_DIR, `${label}_toggle_off.png`) });

  // Toggle ON
  await page.click('[data-testid="microphone-session-toggle"]');
  try {
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="microphone-session-toggle"]')?.getAttribute("aria-checked") ===
        "true",
      undefined,
      { timeout: 6000 }
    );
  } catch (err) {
    const diag = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="microphone-session-toggle"]');
      const alert = document.querySelector('[role="alert"]');
      return {
        ariaChecked: btn?.getAttribute("aria-checked"),
        ariaBusy: btn?.getAttribute("aria-busy"),
        disabled: btn?.hasAttribute("disabled"),
        alertText: alert?.textContent?.trim() || null,
        audioCtxState: window.__ECOSONIC_AUDIO_CONTEXT_COUNT__ ?? null,
      };
    });
    throw new Error(`Toggle ON timed out on ${label}: ${err.message}; diag=${JSON.stringify(diag)}; pageErrors=${JSON.stringify(pageErrors)}`);
  }
  await page.waitForTimeout(550);

  const onMetrics = await page.evaluate(() => {
    const toggle = document.querySelector('[data-testid="microphone-session-toggle"]');
    const thumb = toggle?.querySelector('span[aria-hidden="true"]');
    const rect = toggle?.getBoundingClientRect();
    return {
      ariaChecked: toggle?.getAttribute("aria-checked"),
      trackBg: toggle ? getComputedStyle(toggle).backgroundColor : null,
      thumbOffsetPx:
        rect && thumb ? Math.round(thumb.getBoundingClientRect().left - rect.left) : null,
    };
  });
  await page.screenshot({ path: path.join(OUT_DIR, `${label}_toggle_on.png`) });

  // Toggle back OFF
  await page.click('[data-testid="microphone-session-toggle"]');
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('[data-testid="microphone-session-toggle"]');
      return btn?.getAttribute("aria-checked") === "false" && btn?.getAttribute("aria-busy") === "false";
    },
    undefined,
    { timeout: 6000 }
  );
  await page.waitForTimeout(300);
  const backOffChecked = await page
    .locator('[data-testid="microphone-session-toggle"]')
    .getAttribute("aria-checked");

  // Keyboard accessibility check: Space turns ON, Enter turns OFF
  const toggleLocator = page.locator('[data-testid="microphone-session-toggle"]');
  await toggleLocator.focus();
  await toggleLocator.press("Space");
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('[data-testid="microphone-session-toggle"]');
      return btn?.getAttribute("aria-checked") === "true" && btn?.getAttribute("aria-busy") === "false";
    },
    undefined,
    { timeout: 6000 }
  );
  await toggleLocator.press("Enter");
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('[data-testid="microphone-session-toggle"]');
      return btn?.getAttribute("aria-checked") === "false" && btn?.getAttribute("aria-busy") === "false";
    },
    undefined,
    { timeout: 6000 }
  );

  await context.close();
  return { label, offMetrics, onMetrics, backOffChecked, keyboardVerified: true, pageErrors, consoleErrors };
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
    results.push(await runViewport(browser, { label: "desktop_1440x900", width: 1440, height: 900 }));
    results.push(await runViewport(browser, { label: "desktop_1920x1080", width: 1920, height: 1080 }));
    results.push(await runViewport(browser, { label: "mobile_390x844", width: 390, height: 844, isMobile: true }));
    results.push(await runViewport(browser, { label: "mobile_412x915", width: 412, height: 915, isMobile: true }));
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify(results, null, 2));
  for (const r of results) {
    if (!r.offMetrics.togglePresent) throw new Error(`Toggle missing on ${r.label}`);
    if (r.offMetrics.ariaChecked !== "false") throw new Error(`Expected OFF initially on ${r.label}`);
    if (r.offMetrics.navElementCount > 0 || r.offMetrics.navLabelsPresent.length > 0) {
      throw new Error(`Top nav still present on ${r.label}: ${r.offMetrics.navLabelsPresent.join(",")}`);
    }
    if (r.offMetrics.oldPipelineTextPresent) throw new Error(`Old Acoustic Pipeline text present on ${r.label}`);
    if (r.offMetrics.overflowPx > 1) throw new Error(`Overflow on ${r.label}`);
    if (r.onMetrics.ariaChecked !== "true") throw new Error(`Toggle failed to turn ON on ${r.label}`);
    if (r.onMetrics.trackBg !== "rgb(37, 99, 235)") {
      throw new Error(`Expected blue ON track rgb(37, 99, 235) on ${r.label}, got ${r.onMetrics.trackBg}`);
    }
    if (!(r.onMetrics.thumbOffsetPx > r.offMetrics.thumbOffsetPx + 15)) {
      throw new Error(`Thumb did not slide right on ${r.label}: OFF=${r.offMetrics.thumbOffsetPx}, ON=${r.onMetrics.thumbOffsetPx}`);
    }
    if (r.backOffChecked !== "false") throw new Error(`Toggle failed to turn OFF on ${r.label}`);
    if (r.pageErrors.length > 0 || r.consoleErrors.length > 0) {
      throw new Error(`Console/page errors on ${r.label}`);
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
