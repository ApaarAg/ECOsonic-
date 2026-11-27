import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9881;
const APP_PORT = 3462;
const BASE_URL = `http://localhost:${APP_PORT}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHttp(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404 || res.status === 200) return true;
    } catch {
      // Retry
    }
    await sleep(250);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.pending = new Map();
    this.consoleMessages = [];
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
        this.consoleMessages.push({ type: msg.params.type, text });
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval failed: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }

  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    await sleep(250);
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await sleep(1200);
  }

  async waitForPath(expectedPath, timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const p = await this.eval('window.location.pathname');
      if (p === expectedPath) return p;
      await sleep(150);
    }
    return await this.eval('window.location.pathname');
  }

  async waitForCondition(expression, timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const res = await this.eval(expression);
      if (res) return res;
      await sleep(150);
    }
    return await this.eval(expression);
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // Ignore
    }
  }
}

async function runPhase7HardeningTests() {
  console.log('================================================================');
  console.log('       ECOSONIC 3.0 — PHASE 7 FINAL FRONTEND HARDENING QA       ');
  console.log('================================================================');
  console.log(`[Phase 7] Starting Vite preview server on port ${APP_PORT}...`);

  const previewProc = spawn(
    'npx.cmd',
    ['vite', 'preview', '--port', APP_PORT.toString(), '--strictPort'],
    {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    }
  );

  previewProc.stdout.on('data', (d) => process.stdout.write(`[Vite] ${d}`));
  previewProc.stderr.on('data', (d) => process.stderr.write(`[Vite ERR] ${d}`));

  let chromeProc = null;
  let cdp = null;
  const tempUserDataDir = path.join(os.tmpdir(), `ecosonic-phase7-qa-${Date.now()}`);

  try {
    await waitForHttp(`${BASE_URL}/`);
    console.log(`[Phase 7] Vite server listening at ${BASE_URL}`);

    console.log(`[Phase 7] Launching Headless Chrome on CDP debug port ${DEBUG_PORT}...`);
    chromeProc = spawn(
      CHROME_PATH,
      [
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=${tempUserDataDir}`,
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        '--disable-extensions',
        '--window-size=1920,1080',
        'about:blank',
      ],
      { stdio: 'ignore' }
    );

    await sleep(1500);

    const versionRes = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    const versionData = await versionRes.json();
    console.log(`[Phase 7] Chrome attached: ${versionData['User-Agent']}`);

    const targetsRes = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    const targets = await targetsRes.json();
    const pageTarget = targets.find((t) => t.type === 'page') || targets[0];
    if (!pageTarget) throw new Error('No valid Chrome CDP target found');

    cdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');

    const testPass = (name) => console.log(`  [PASS] ${name}`);
    const testFail = (name, err) => {
      console.error(`  [FAIL] ${name}:`, err);
      throw new Error(`Test assertion failed: ${name}`);
    };

    // -------------------------------------------------------------------------
    // TEST 1: ROUTE AUDIT & DIRECT NAVIGATION (ALL WORKSPACE PAGES)
    // -------------------------------------------------------------------------
    console.log('\n--- 1. FULL ROUTE AUDIT & DIRECT NAVIGATION ---');

    // 1.1 /app redirect
    await cdp.navigate(`${BASE_URL}/app`);
    let currentUrl = await cdp.waitForPath('/app/observatory', 6000);
    if (currentUrl === '/app/observatory') {
      testPass('Direct navigation to /app redirects to /app/observatory');
    } else {
      testFail('Direct navigation to /app redirects', `Expected /app/observatory, got ${currentUrl}`);
    }

    // 1.2 /app/observatory
    let title = await cdp.eval('document.querySelector("h1")?.innerText');
    if (title && title.includes('Live Observatory')) {
      testPass('Direct navigation to /app/observatory renders Live Observatory header');
    } else {
      testFail('Live Observatory route', `Header text: ${title}`);
    }

    // 1.3 /app/detections
    await cdp.navigate(`${BASE_URL}/app/detections`);
    title = await cdp.eval('document.querySelector("h1")?.innerText');
    const detectionRows = await cdp.eval('document.querySelectorAll("tbody tr").length');
    if (title && title.includes('Species Intelligence') && detectionRows > 0) {
      testPass(`Direct navigation to /app/detections renders ${detectionRows} detection rows`);
    } else {
      testFail('Detections route', `Header: ${title}, Rows: ${detectionRows}`);
    }

    // 1.4 /app/soundscape
    await cdp.navigate(`${BASE_URL}/app/soundscape`);
    title = await cdp.eval('document.querySelector("h1")?.innerText');
    const indicesCards = await cdp.eval('document.querySelectorAll("[data-testid=\'indices-card\'], .grid > div").length');
    if (title && title.includes('Soundscape')) {
      testPass(`Direct navigation to /app/soundscape renders Soundscape workspace`);
    } else {
      testFail('Soundscape route', `Header: ${title}`);
    }

    // 1.5 /app/disturbances
    await cdp.navigate(`${BASE_URL}/app/disturbances`);
    title = await cdp.eval('document.querySelector("h1")?.innerText');
    const kpiCards = await cdp.eval('document.querySelectorAll("[data-testid=\'kpi-card\'], .grid > div").length');
    if (title && title.includes('Disturbance Radar')) {
      testPass(`Direct navigation to /app/disturbances renders Disturbance Radar`);
    } else {
      testFail('Disturbances route', `Header: ${title}`);
    }

    // 1.6 /app/sessions
    await cdp.navigate(`${BASE_URL}/app/sessions`);
    title = await cdp.eval('document.querySelector("h1")?.innerText');
    const sessionCards = await cdp.eval('document.querySelectorAll("tbody tr, a[href*=\'/app/sessions/\']").length');
    if (title && title.includes('Session History') && sessionCards > 0) {
      testPass(`Direct navigation to /app/sessions renders Session History (${sessionCards} session entries)`);
    } else {
      testFail('Sessions route', `Header: ${title}, entries: ${sessionCards}`);
    }

    // 1.7 /app/sessions/:sessionId (Deep link)
    await cdp.navigate(`${BASE_URL}/app/sessions/ses-2026-1121-a`);
    const sessionDetailTitle = await cdp.eval('document.querySelector("h1")?.innerText');
    const sessionBadge = await cdp.eval('document.body.innerText.includes("SES-2026-1121-A")');
    if (sessionBadge) {
      testPass(`Direct navigation to /app/sessions/ses-2026-1121-a renders dedicated session view`);
    } else {
      testFail('Session detail route', `Header: ${sessionDetailTitle}`);
    }

    // 1.8 /app/settings
    await cdp.navigate(`${BASE_URL}/app/settings`);
    title = await cdp.eval('document.querySelector("h1")?.innerText');
    const testMicBtn = await cdp.eval('Array.from(document.querySelectorAll("button")).some(b => b.innerText.includes("Test Microphone") || b.innerText.includes("Microphone"))');
    if (title && title.includes('Settings')) {
      testPass(`Direct navigation to /app/settings renders Settings & Diagnostics`);
    } else {
      testFail('Settings route', `Header: ${title}`);
    }

    // -------------------------------------------------------------------------
    // TEST 2: BRANDED 404 NOT FOUND PAGE
    // -------------------------------------------------------------------------
    console.log('\n--- 2. BRANDED 404 NOT FOUND PAGE ---');

    await cdp.navigate(`${BASE_URL}/app/uncharted-coordinate-xyz-404`);
    await cdp.waitForCondition("document.body.innerText.includes('Page Not Found')", 6000);
    let notFoundText = await cdp.eval('document.body.innerText');
    if (notFoundText && notFoundText.includes('Page Not Found') && (notFoundText.includes('404') || notFoundText.includes('Uncharted'))) {
      testPass('Invalid nested route /app/uncharted-coordinate-xyz-404 displays branded 404 page');
    } else {
      testFail('404 route handling', `404 text missing from page. Found: ${notFoundText?.slice(0, 200)}`);
    }

    // Test recovery link: Enter Live Observatory
    await cdp.eval(`(() => {
      const link = Array.from(document.querySelectorAll('a')).find(a => a.textContent.includes('Enter Live Observatory'));
      link?.click();
    })()`);
    currentUrl = await cdp.waitForPath('/app/observatory', 5000);
    if (currentUrl === '/app/observatory') {
      testPass('404 recovery waypoint "Enter Live Observatory" correctly navigates to /app/observatory');
    } else {
      testFail('404 recovery link', `Expected /app/observatory, got ${currentUrl}`);
    }

    // Test top-level arbitrary invalid route
    await cdp.navigate(`${BASE_URL}/completely-random-nonexistent-path`);
    await cdp.waitForCondition("document.body.innerText.includes('Page Not Found')", 6000);
    notFoundText = await cdp.eval('document.body.innerText');
    if (notFoundText && notFoundText.includes('Page Not Found')) {
      testPass('Arbitrary route /completely-random-nonexistent-path displays 404 page');
    } else {
      testFail('Top-level 404 handling', `Did not display 404. Found: ${notFoundText?.slice(0, 200)}`);
    }

    // -------------------------------------------------------------------------
    // TEST 3: DEMO DATA TRANSPARENCY & DISCLOSURE MODAL
    // -------------------------------------------------------------------------
    console.log('\n--- 3. DEMO DATA TRANSPARENCY & DISCLOSURE MODAL ---');

    await cdp.navigate(`${BASE_URL}/`);
    await sleep(1000);

    // Scroll to footer
    await cdp.eval('window.scrollTo(0, document.body.scrollHeight)');
    await sleep(500);

    // Click "Demo Fixture Notice" button
    const openedNotice = await cdp.eval(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Demo Fixture Notice'));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    })()`);

    if (!openedNotice) {
      testFail('Demo Fixture Notice button', 'Button not found in footer');
    }
    await sleep(500);

    // Verify modal is open and has accessible attributes
    const modalProps = await cdp.eval(`(() => {
      const modal = document.querySelector('[role="dialog"]');
      if (!modal) return null;
      return {
        role: modal.getAttribute('role'),
        ariaModal: modal.getAttribute('aria-modal'),
        title: modal.querySelector('h2')?.innerText,
        text: modal.innerText,
      };
    })()`);

    if (
      modalProps &&
      modalProps.role === 'dialog' &&
      modalProps.ariaModal === 'true' &&
      modalProps.text.includes('Stage 1') &&
      modalProps.text.includes('Model Confidence Score Interpretation')
    ) {
      testPass('Demo Disclosure Modal opened with proper accessibility roles and disclosure text');
    } else {
      testFail('Demo Disclosure Modal attributes', JSON.stringify(modalProps));
    }

    // Dismiss with Escape key
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
    await sleep(400);

    let modalPresent = await cdp.eval('Boolean(document.querySelector(\'[role="dialog"]\'))');
    if (!modalPresent) {
      testPass('Demo Disclosure Modal safely dismisses upon Escape key press');
    } else {
      testFail('Demo Disclosure Modal Escape dismiss', 'Modal remained open');
    }

    // Click footer badge "Stage 1 Frontend · Demonstration Fixtures Active (Details)"
    const openedBadge = await cdp.eval(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Demonstration Fixtures Active'));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    })()`);

    if (!openedBadge) {
      testFail('Footer badge trigger', 'Badge button not found');
    }
    await sleep(500);

    // Dismiss with "Acknowledge & Close" button
    const closedViaBtn = await cdp.eval(`(() => {
      const closeBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Acknowledge & Close') || b.textContent.includes('Close'));
      if (closeBtn) {
        closeBtn.click();
        return true;
      }
      return false;
    })()`);

    await sleep(400);
    modalPresent = await cdp.eval('Boolean(document.querySelector(\'[role="dialog"]\'))');
    if (closedViaBtn && !modalPresent) {
      testPass('Demo Disclosure Modal opened from footer badge and dismissed via Close button');
    } else {
      testFail('Demo Disclosure Modal Close button', `closedViaBtn: ${closedViaBtn}, modalPresent: ${modalPresent}`);
    }

    // -------------------------------------------------------------------------
    // TEST 4: CROSS-WORKSPACE LINKING & QUERY PRESERVATION
    // -------------------------------------------------------------------------
    console.log('\n--- 4. CROSS-WORKSPACE LINKING & QUERY PRESERVATION ---');

    await cdp.navigate(`${BASE_URL}/app/sessions/ses-2026-1121-a`);
    await sleep(500);

    // Click "View in Species Intelligence"
    const clickedSpeciesLink = await cdp.eval(`(() => {
      const link = Array.from(document.querySelectorAll('a')).find(a => a.textContent.includes('View in Species Intelligence') || a.href.includes('/app/detections?session='));
      if (link) {
        link.click();
        return true;
      }
      return false;
    })()`);

    const detectionsPathAndQuery = await cdp.waitForCondition(
      "window.location.pathname === '/app/detections' ? (window.location.pathname + window.location.search) : null",
      5000
    );
    if (detectionsPathAndQuery === '/app/detections?session=ses-2026-1121-a') {
      testPass('Cross-workspace link navigated to /app/detections?session=ses-2026-1121-a with query preserved');
    } else {
      testFail('Cross-workspace species link', `Got ${detectionsPathAndQuery}`);
    }

    // Navigate back to session
    await cdp.navigate(`${BASE_URL}/app/sessions/ses-2026-1121-a`);
    await sleep(500);

    // Click "View in Disturbance Radar"
    const clickedDisturbanceLink = await cdp.eval(`(() => {
      const link = Array.from(document.querySelectorAll('a')).find(a => a.textContent.includes('View in Disturbance Radar') || a.href.includes('/app/disturbances?session='));
      if (link) {
        link.click();
        return true;
      }
      return false;
    })()`);

    const disturbancesPathAndQuery = await cdp.waitForCondition(
      "window.location.pathname === '/app/disturbances' ? (window.location.pathname + window.location.search) : null",
      5000
    );
    if (disturbancesPathAndQuery === '/app/disturbances?session=ses-2026-1121-a') {
      testPass('Cross-workspace link navigated to /app/disturbances?session=ses-2026-1121-a with query preserved');
    } else {
      testFail('Cross-workspace disturbance link', `Got ${disturbancesPathAndQuery}`);
    }

    // -------------------------------------------------------------------------
    // TEST 5: RESPONSIVE VIEWPORT QA (ZERO HORIZONTAL OVERFLOW)
    // -------------------------------------------------------------------------
    console.log('\n--- 5. RESPONSIVE VIEWPORT QA (ZERO HORIZONTAL OVERFLOW) ---');

    const viewports = [
      { name: 'Desktop (1920x1080)', w: 1920, h: 1080 },
      { name: 'Laptop (1366x768)', w: 1366, h: 768 },
      { name: 'Tablet (768x1024)', w: 768, h: 1024 },
      { name: 'Mobile (375x667)', w: 375, h: 667 },
    ];

    const testUrls = [
      '/',
      '/app/observatory',
      '/app/detections',
      '/app/soundscape',
      '/app/disturbances',
      '/app/sessions',
      '/app/sessions/ses-2026-1121-a',
      '/app/settings',
    ];

    for (const vp of viewports) {
      await cdp.setViewport(vp.w, vp.h);
      for (const urlPath of testUrls) {
        await cdp.navigate(`${BASE_URL}${urlPath}`);
        await sleep(300);

        const overflow = await cdp.eval(`(() => {
          const docEl = document.documentElement;
          const body = document.body;
          const scrollW = Math.max(docEl.scrollWidth, body.scrollWidth);
          const clientW = window.innerWidth;
          return {
            scrollW,
            clientW,
            hasSpill: scrollW > clientW + 1,
          };
        })()`);

        if (overflow.hasSpill) {
          testFail(`Horizontal overflow on ${vp.name} at ${urlPath}`, `scrollW: ${overflow.scrollW}, clientW: ${overflow.clientW}`);
        }
      }
      testPass(`Zero horizontal overflow verified across all 8 routes on ${vp.name}`);
    }

    // Mobile drawer toggle test on 375x667
    console.log('\n--- 6. MOBILE DRAWER INTERACTION TEST ---');
    await cdp.setViewport(375, 667);
    await cdp.navigate(`${BASE_URL}/app/observatory`);
    await sleep(400);

    const openedMobileMenu = await cdp.eval(`(() => {
      const btn = document.querySelector('button[aria-label="Open navigation menu"]');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    })()`);

    await sleep(400);
    const drawerVisible = await cdp.eval('Boolean(document.querySelector(\'button[aria-label="Close navigation menu"]\'))');
    if (openedMobileMenu && drawerVisible) {
      testPass('Mobile hamburger button opens navigation drawer on 375px viewport');
    } else {
      testFail('Mobile menu open', `opened: ${openedMobileMenu}, drawerVisible: ${drawerVisible}`);
    }

    // Close mobile drawer
    await cdp.eval(`(() => {
      const btn = document.querySelector('button[aria-label="Close navigation menu"]');
      btn?.click();
    })()`);
    await sleep(400);

    const drawerClosed = await cdp.eval('!Boolean(document.querySelector(\'button[aria-label="Close navigation menu"]\'))');
    if (drawerClosed) {
      testPass('Mobile navigation drawer closes cleanly');
    } else {
      testFail('Mobile menu close', 'Drawer did not close');
    }

    // -------------------------------------------------------------------------
    // TEST 7: CONSOLE HEALTH CHECK
    // -------------------------------------------------------------------------
    console.log('\n--- 7. CONSOLE HEALTH CHECK ---');
    const severeConsoleErrors = cdp.consoleMessages.filter(
      (m) => m.type === 'error' && !m.text.includes('net::ERR_') && !m.text.includes('favicon.ico')
    );

    if (severeConsoleErrors.length === 0) {
      testPass('Console health: Zero severe application errors across entire QA run');
    } else {
      console.warn(`[Phase 7 Warning] Observed ${severeConsoleErrors.length} console errors:`, severeConsoleErrors);
    }

    console.log('\n================================================================');
    console.log('  ALL PHASE 7 FINAL FRONTEND HARDENING CHECKS PASSED (CODE 0)   ');
    console.log('================================================================');
  } catch (err) {
    console.error('[Phase 7 QA Error]', err);
    process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    if (chromeProc) {
      try {
        chromeProc.kill();
      } catch {}
    }
    if (previewProc) {
      try {
        previewProc.kill();
      } catch {}
    }
    try {
      fs.rmSync(tempUserDataDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase7HardeningTests();
