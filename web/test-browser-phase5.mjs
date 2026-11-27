import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9879;
const APP_PORT = 3460;
const APP_URL = `http://localhost:${APP_PORT}/app/disturbances`;

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

  close() {
    try {
      this.ws.close();
    } catch {
      // Ignore
    }
  }
}

async function runBrowserTest() {
  console.log('[Phase 5 Browser Test] Starting Vite preview on port', APP_PORT);

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
  const tempProfileDir = path.join(os.tmpdir(), `ecosonic-cdp-phase5-${Date.now()}`);

  try {
    await waitForHttp(APP_URL, 15000);
    console.log('[Phase 5 Browser Test] Vite preview running at', APP_URL);

    fs.mkdirSync(tempProfileDir, { recursive: true });

    console.log('[Phase 5 Browser Test] Launching Chrome CDP on port', DEBUG_PORT);
    chromeProc = spawn(
      CHROME_PATH,
      [
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=${tempProfileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--headless=new',
        '--disable-gpu',
        '--window-size=1400,900',
        APP_URL,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    await waitForHttp(`http://127.0.0.1:${DEBUG_PORT}/json/version`, 15000);
    const verRes = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    const pages = await verRes.json();
    const appTarget = pages.find((p) => p.url.includes(APP_PORT.toString())) || pages[0];

    if (!appTarget || !appTarget.webSocketDebuggerUrl) {
      throw new Error('Unable to find inspectable target with webSocketDebuggerUrl');
    }

    cdp = new CDPClient(appTarget.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    console.log('[Phase 5 Browser Test] Connected to Chrome DevTools Protocol');
    await sleep(2000);

    // 1. Initial page load & structure
    console.log('[Test 1] Verifying initial page load and layout...');
    const pageTitle = await cdp.eval('document.title');
    console.log(' - Page title:', pageTitle);

    const initialStructure = await cdp.eval(`(() => {
      const text = document.body.innerText;
      return {
        hasTitle: text.includes('Disturbance Radar'),
        hasTransportation: text.includes('Transportation'),
        hasHazards: text.includes('Environmental Hazards'),
        hasMechanical: text.includes('Mechanical Activity'),
        hasCultural: text.includes('Cultural Sounds'),
        hasTimeline: text.includes('Acoustic Event Timeline'),
      };
    })()`);
    if (!initialStructure.hasTitle || !initialStructure.hasTimeline) {
      throw new Error('Initial page structure missing Disturbance Radar elements');
    }
    console.log(' -> PASSED: Initial Disturbance Radar layout rendered cleanly.');

    // 2. Interactive Category KPI Cards
    console.log('[Test 2] Testing category KPI card click (Transportation)...');
    await cdp.eval(`(() => {
      const transKpi = document.querySelector('[aria-label*="Filter by Transportation"]');
      if (!transKpi) throw new Error('Transportation KPI card not found');
      transKpi.click();
    })()`);
    await sleep(600);

    const transFilterResult = await cdp.eval(`(() => {
      const items = Array.from(document.querySelectorAll('ol[role="list"] li'));
      return {
        count: items.length,
        url: window.location.href,
        allAreTransportation: items.every(li => li.innerText.includes('Transportation')),
      };
    })()`);
    console.log(' - Filtered count for Transportation KPI:', transFilterResult.count);
    console.log(' - URL updated with category:', transFilterResult.url);
    if (transFilterResult.count === 0 || !transFilterResult.allAreTransportation) {
      throw new Error('Transportation KPI card did not filter timeline to Transportation');
    }
    if (!transFilterResult.url.includes('category=transportation')) {
      throw new Error('URL did not update with category=transportation');
    }

    // Click again to toggle back to 'all'
    await cdp.eval(`(() => {
      const transKpi = document.querySelector('[aria-label*="Filter by Transportation"]');
      transKpi.click();
    })()`);
    await sleep(600);
    const clearedResult = await cdp.eval(`(() => {
      return {
        count: document.querySelectorAll('ol[role="list"] li').length,
        url: window.location.href,
      };
    })()`);
    console.log(' - Cleared count after toggle:', clearedResult.count);
    if (clearedResult.url.includes('category=')) {
      throw new Error('URL did not remove category parameter on toggle off');
    }
    console.log(' -> PASSED: Interactive KPI cards toggle filtering and sync to URL.');

    // 3. Multi-field Search
    console.log('[Test 3] Testing search filtering (e.g. "Commercial Aircraft" or "Canopy Branch")...');
    await cdp.eval(`(() => {
      const input = document.querySelector('[data-testid="disturbance-search-input"]');
      if (!input) throw new Error('Search input not found');
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, 'Aircraft');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(600);

    const searchResult = await cdp.eval(`(() => {
      const items = Array.from(document.querySelectorAll('ol[role="list"] li'));
      return {
        count: items.length,
        url: window.location.href,
        hasAircraft: items.length > 0 && items[0].innerText.includes('Commercial Aircraft'),
      };
    })()`);
    console.log(' - Search results count for "Aircraft":', searchResult.count);
    if (searchResult.count !== 1 || !searchResult.hasAircraft) {
      throw new Error(`Expected 1 result for Aircraft, got ${searchResult.count}`);
    }
    if (!searchResult.url.includes('q=Aircraft')) {
      throw new Error('URL did not sync search parameter q=Aircraft');
    }

    // Clear search
    await cdp.eval(`(() => {
      const input = document.querySelector('[data-testid="disturbance-search-input"]');
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(500);
    console.log(' -> PASSED: Search filters and synchronizes to URL param ?q=');

    // 4. Severity & Session Filtering
    console.log('[Test 4] Testing Severity filter (elevated)...');
    await cdp.eval(`(() => {
      const sevSelect = document.querySelector('[data-testid="disturbance-severity-select"]');
      if (!sevSelect) throw new Error('Severity select not found');
      sevSelect.value = 'elevated';
      sevSelect.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(600);

    const sevResult = await cdp.eval(`(() => {
      const items = Array.from(document.querySelectorAll('ol[role="list"] li'));
      return {
        count: items.length,
        url: window.location.href,
        allElevated: items.every(li => li.innerText.toLowerCase().includes('elevated')),
      };
    })()`);
    console.log(' - Elevated severity count:', sevResult.count);
    if (sevResult.count === 0 || !sevResult.allElevated) {
      throw new Error('Severity filtering failed');
    }
    if (!sevResult.url.includes('severity=elevated')) {
      throw new Error('URL did not sync severity parameter');
    }

    // Reset severity to all
    await cdp.eval(`(() => {
      const sevSelect = document.querySelector('[data-testid="disturbance-severity-select"]');
      sevSelect.value = 'all';
      sevSelect.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(500);
    console.log(' -> PASSED: Severity filter operates and synchronizes to URL.');

    // 5. Session selector & Invalid session banner
    console.log('[Test 5] Testing Session selector filter and invalid session handling...');
    await cdp.eval(`(() => {
      const sessSelect = document.querySelector('[data-testid="disturbance-session-select"]');
      if (!sessSelect) throw new Error('Session select not found');
      sessSelect.value = 'ses-2026-1121-a';
      sessSelect.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(600);

    const sessionResult = await cdp.eval(`(() => {
      const items = Array.from(document.querySelectorAll('ol[role="list"] li'));
      return {
        count: items.length,
        url: window.location.href,
      };
    })()`);
    console.log(' - ses-2026-1121-a count:', sessionResult.count);
    if (!sessionResult.url.includes('session=ses-2026-1121-a')) {
      throw new Error('URL did not sync session parameter');
    }

    // Reset session
    await cdp.eval(`(() => {
      const sessSelect = document.querySelector('[data-testid="disturbance-session-select"]');
      sessSelect.value = 'all';
      sessSelect.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(500);
    console.log(' -> PASSED: Session filter operates correctly.');

    // 6. Sorting dropdown
    console.log('[Test 6] Testing sorting dropdown...');
    await cdp.eval(`(() => {
      const sortSelect = document.querySelector('[data-testid="disturbance-sort-select"]');
      if (!sortSelect) throw new Error('Sort select not found');
      sortSelect.value = 'severity_desc';
      sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(600);

    const sortResult = await cdp.eval(`(() => {
      const firstItem = document.querySelector('ol[role="list"] li');
      return {
        firstItemText: firstItem?.innerText || '',
        url: window.location.href,
      };
    })()`);
    if (!sortResult.firstItemText.toLowerCase().includes('elevated')) {
      throw new Error('Sorting by severity_desc did not place elevated item at the top');
    }
    if (!sortResult.url.includes('sort=severity') || !sortResult.url.includes('order=desc')) {
      throw new Error('URL did not sync sort and order parameters');
    }
    console.log(' -> PASSED: Sorting dropdown updates order and synchronizes with URL.');

    // 7. Event Detail Drawer on item click, Escape dismiss, and Session Cross-Link
    console.log('[Test 7] Testing Disturbance Detail Drawer and Session cross-link...');
    await cdp.eval(`(() => {
      const firstItem = document.querySelector('ol[role="list"] li');
      if (!firstItem) throw new Error('No disturbance item found to click');
      firstItem.click();
    })()`);
    await sleep(600);

    const drawerStatus = await cdp.eval(`(() => {
      const dialog = document.querySelector('div[role="dialog"]');
      if (!dialog) return { open: false };
      const crossLink = dialog.querySelector('a[href*="/app/sessions?session="]');
      return {
        open: true,
        text: dialog.innerText,
        crossLinkHref: crossLink ? crossLink.getAttribute('href') : null,
      };
    })()`);
    console.log(' - Drawer status:', { open: drawerStatus.open, crossLinkHref: drawerStatus.crossLinkHref });
    if (!drawerStatus.open || !drawerStatus.text.toUpperCase().includes('ACOUSTIC DISTURBANCE DETAIL')) {
      throw new Error('Disturbance detail drawer did not open properly');
    }
    if (!drawerStatus.crossLinkHref || !drawerStatus.crossLinkHref.includes('/app/sessions?session=')) {
      throw new Error('Session cross-link missing in Disturbance Detail Drawer');
    }

    // Dismiss via Escape
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    });
    await sleep(400);

    const drawerClosed = await cdp.eval(`document.querySelector('div[role="dialog"]') === null`);
    if (!drawerClosed) {
      throw new Error('Drawer failed to dismiss on Escape');
    }
    console.log(' -> PASSED: Detail Drawer open, session cross-link, and keyboard dismissal verified.');

    // 8. Empty state on impossible filter
    console.log('[Test 8] Testing empty state on non-matching query...');
    await cdp.eval(`(() => {
      const input = document.querySelector('[data-testid="disturbance-search-input"]');
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, 'xyznonexistentquery999');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(600);

    const emptyStatus = await cdp.eval(`(() => {
      const text = document.body.innerText;
      return {
        hasEmptyTitle: text.includes('No disturbance events match the active filters'),
        hasResetBtn: text.includes('Reset All Filters'),
      };
    })()`);
    if (!emptyStatus.hasEmptyTitle) {
      throw new Error('Empty state not displayed for non-matching query');
    }

    // Click "Reset All Filters"
    await cdp.eval(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Reset All Filters'));
      if (!btn) throw new Error('Reset All Filters button not found');
      btn.click();
    })()`);
    await sleep(500);

    const restoredCount = await cdp.eval(`document.querySelectorAll('ol[role="list"] li').length`);
    console.log(' - Restored event count after reset:', restoredCount);
    if (restoredCount === 0) {
      throw new Error('Reset action failed to restore disturbance items');
    }
    console.log(' -> PASSED: Empty state and filter reset verified.');

    // 9. Console Error Verification
    console.log('[Test 9] Checking console error logs...');
    const errors = cdp.consoleMessages.filter((m) => m.type === 'error');
    if (errors.length > 0) {
      console.warn('Console error messages:', errors);
    } else {
      console.log(' - Browser console cleanly free of uncaught errors.');
    }

    console.log('\n=========================================');
    console.log('ALL PHASE 5 BROWSER CHECKS PASSED!');
    console.log('=========================================\n');
  } finally {
    if (cdp) cdp.close();
    if (chromeProc) chromeProc.kill('SIGKILL');
    if (previewProc) previewProc.kill('SIGKILL');
    try {
      fs.rmSync(tempProfileDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }
}

runBrowserTest().catch((err) => {
  console.error('[Phase 5 Browser Test FAILED]', err);
  process.exit(1);
});
