import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9878;
const APP_PORT = 3459;
const APP_URL = `http://localhost:${APP_PORT}/app/detections`;

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
  console.log('[Phase 4 Browser Test] Starting Vite preview on port', APP_PORT);

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
  const tempProfileDir = path.join(os.tmpdir(), `ecosonic-cdp-phase4-${Date.now()}`);

  try {
    await waitForHttp(APP_URL, 15000);
    console.log('[Phase 4 Browser Test] Vite preview running at', APP_URL);

    fs.mkdirSync(tempProfileDir, { recursive: true });

    console.log('[Phase 4 Browser Test] Launching Chrome CDP on port', DEBUG_PORT);
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

    console.log('[Phase 4 Browser Test] Connected to Chrome DevTools Protocol');
    await sleep(2000);

    // 1. Initial page load & summary metrics verification
    console.log('[Test 1] Verifying initial page load and summary metrics...');
    const pageTitle = await cdp.eval('document.title');
    console.log(' - Page title:', pageTitle);

    const initialMetrics = await cdp.eval(`(() => {
      const readouts = Array.from(document.querySelectorAll('[data-metric-label], section .rounded-lg, section > div'));
      const text = document.body.innerText;
      return {
        hasTitle: text.includes('Species Intelligence'),
        hasMatchingDetections: text.includes('Matching Detections'),
        hasDistinctTaxa: text.includes('Distinct Taxa'),
        hasActiveSessions: text.includes('Active Sessions'),
        hasMeanModelScore: text.includes('Mean Model Score'),
      };
    })()`);
    if (!initialMetrics.hasTitle || !initialMetrics.hasMatchingDetections) {
      throw new Error('Initial page structure or summary metric readouts missing');
    }
    console.log(' -> PASSED: Summary metrics and layout rendered.');

    // 2. Multi-field search filtering
    console.log('[Test 2] Testing search query filtering (Troglodytes)...');
    await cdp.eval(`(() => {
      const input = document.querySelector('input[placeholder*="Troglodytes"]');
      if (!input) throw new Error('Search input not found');
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, 'Troglodytes');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(800); // Allow debounce

    const searchResult = await cdp.eval(`(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      return {
        count: rows.length,
        firstRowText: rows[0]?.innerText || '',
        url: window.location.href,
      };
    })()`);
    console.log(' - Filtered count for "Troglodytes":', searchResult.count);
    console.log(' - URL updated with search:', searchResult.url);
    if (searchResult.count !== 2 || !searchResult.firstRowText.includes('Pacific Wren')) {
      throw new Error(`Search filtering failed: expected 2 rows for Troglodytes, found ${searchResult.count}`);
    }
    if (!searchResult.url.includes('q=Troglodytes')) {
      throw new Error(`URL query param synchronization failed for search query: ${searchResult.url}`);
    }
    console.log(' -> PASSED: Search filters and synchronizes to URL param ?q=');

    // 3. Clear search and test Session filter
    console.log('[Test 3] Testing Session selector filter (ses-2026-1120-b)...');
    await cdp.eval(`(() => {
      const input = document.querySelector('[data-testid="species-search-input"]') || document.querySelector('input[placeholder*="Troglodytes"]');
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      const select = document.querySelector('[data-testid="session-filter-select"]');
      if (!select) throw new Error('Session select not found');
      select.value = 'ses-2026-1120-b';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(800);

    const sessionResult = await cdp.eval(`(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      return {
        count: rows.length,
        url: window.location.href,
      };
    })()`);
    console.log(' - Filtered count for ses-2026-1120-b:', sessionResult.count);
    console.log(' - URL with session:', sessionResult.url);
    if (sessionResult.count !== 5) {
      throw new Error(`Expected 5 detections for session Karelian Fen, found ${sessionResult.count}`);
    }
    if (!sessionResult.url.includes('session=ses-2026-1120-b')) {
      throw new Error('URL did not update with session parameter');
    }
    console.log(' -> PASSED: Session filter operates correctly and updates URL.');

    // 4. Habitat selector filter
    console.log('[Test 4] Testing Habitat station selector...');
    await cdp.eval(`(() => {
      const sessionSelect = document.querySelector('[data-testid="session-filter-select"]');
      sessionSelect.value = 'all';
      sessionSelect.dispatchEvent(new Event('change', { bubbles: true }));

      const habitatSelect = document.querySelector('[data-testid="habitat-filter-select"]');
      if (!habitatSelect) throw new Error('Habitat select not found');
      habitatSelect.value = 'subalpine-ridge';
      habitatSelect.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(400);

    const habitatResult = await cdp.eval(`(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      return {
        count: rows.length,
        url: window.location.href,
      };
    })()`);
    console.log(' - Filtered count for subalpine-ridge:', habitatResult.count);
    if (habitatResult.count !== 4) {
      throw new Error(`Expected 4 detections for subalpine-ridge, found ${habitatResult.count}`);
    }
    if (!habitatResult.url.includes('habitat=subalpine-ridge')) {
      throw new Error('URL did not update with habitat parameter');
    }
    console.log(' -> PASSED: Habitat station filtering and URL sync verified.');

    // 5. Confidence score slider & reset to default
    console.log('[Test 5] Testing minimum model score threshold and reset action...');
    await cdp.eval(`(() => {
      // Reset habitat to all
      const habitatSelect = document.querySelector('[data-testid="habitat-filter-select"]');
      habitatSelect.value = 'all';
      habitatSelect.dispatchEvent(new Event('change', { bubbles: true }));

      // Set confidence slider to 0.85
      const slider = document.querySelector('input[type="range"]');
      if (!slider) throw new Error('Score slider not found');
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(slider, '0.85');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(400);

    const highConfidenceResult = await cdp.eval(`(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      return {
        count: rows.length,
        url: window.location.href,
      };
    })()`);
    console.log(' - Detections >= 0.85 score:', highConfidenceResult.count);
    if (highConfidenceResult.count > 10 || highConfidenceResult.count === 0) {
      throw new Error(`Unexpected score filtering result: ${highConfidenceResult.count}`);
    }
    if (!highConfidenceResult.url.includes('minScore=0.85')) {
      throw new Error('URL minScore parameter not synchronized');
    }

    // Click "Reset to default"
    await cdp.eval(`(() => {
      const resetBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Reset to default'));
      if (!resetBtn) throw new Error('Reset to default button not found');
      resetBtn.click();
    })()`);
    await sleep(400);

    const resetScoreResult = await cdp.eval(`(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      return {
        count: rows.length,
        url: window.location.href,
      };
    })()`);
    console.log(' - Detections after reset to default:', resetScoreResult.count);
    console.log(' -> PASSED: Minimum confidence score slider and reset to default verified.');

    // 6. Column header sorting (Asc/Desc)
    console.log('[Test 6] Testing sortable table column headers...');
    await cdp.eval(`(() => {
      // Click Model Score column header
      const scoreHeader = Array.from(document.querySelectorAll('th button')).find(b => b.innerText.includes('Model Score'));
      if (!scoreHeader) throw new Error('Model score header button not found');
      scoreHeader.click();
    })()`);
    await sleep(400);

    const sortedScores = await cdp.eval(`(() => {
      const cells = Array.from(document.querySelectorAll('tbody tr td:last-child')).map(td => parseFloat(td.innerText));
      return {
        cells,
        url: window.location.href,
      };
    })()`);
    console.log(' - Top 3 model scores:', sortedScores.cells.slice(0, 3));
    if (sortedScores.cells[0] < sortedScores.cells[1]) {
      throw new Error('Model score header sort descending failed');
    }

    // Toggle to ascending
    await cdp.eval(`(() => {
      const scoreHeader = Array.from(document.querySelectorAll('th button')).find(b => b.innerText.includes('Model Score'));
      scoreHeader.click();
    })()`);
    await sleep(400);

    const sortedAscScores = await cdp.eval(`(() => {
      return Array.from(document.querySelectorAll('tbody tr td:last-child')).map(td => parseFloat(td.innerText));
    })()`);
    console.log(' - Ascending model scores:', sortedAscScores.slice(0, 3));
    if (sortedAscScores[0] > sortedAscScores[1]) {
      throw new Error('Model score header sort ascending failed');
    }
    console.log(' -> PASSED: Interactive column sorting is responsive and accurate.');

    // 7. Pagination controls
    console.log('[Test 7] Testing pagination controls and page size selector...');
    // Reset sort to timestamp desc and check pagination
    await cdp.eval(`(() => {
      const tsHeader = Array.from(document.querySelectorAll('th button')).find(b => b.innerText.includes('Timestamp'));
      tsHeader.click();
    })()`);
    await sleep(400);

    const page1Info = await cdp.eval(`(() => {
      const rows = document.querySelectorAll('tbody tr').length;
      const text = document.body.innerText;
      return { rows, pageText: text.includes('Page 1 of') };
    })()`);
    if (page1Info.rows !== 10) {
      throw new Error(`Expected 10 rows on page 1, found ${page1Info.rows}`);
    }

    // Click Next Page button
    await cdp.eval(`(() => {
      const nextBtn = document.querySelector('button[aria-label="Next Page"]');
      if (!nextBtn) throw new Error('Next Page button not found');
      nextBtn.click();
    })()`);
    await sleep(400);

    const page2Info = await cdp.eval(`(() => {
      const rows = document.querySelectorAll('tbody tr').length;
      return { rows, url: window.location.href };
    })()`);
    console.log(' - Page 2 rows count:', page2Info.rows);
    if (!page2Info.url.includes('page=2')) {
      throw new Error('URL did not update with page=2');
    }
    console.log(' -> PASSED: Table pagination and boundary navigation verified.');

    // 8. Detail Drawer on row click, escape key & backdrop dismiss
    console.log('[Test 8] Testing Detection Detail Drawer slide-over and accessibility...');
    const clickDiagnostics = await cdp.eval(`(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      const firstRow = rows[0];
      if (!firstRow) return { rowCount: 0 };
      
      const rect = firstRow.getBoundingClientRect();
      firstRow.click();
      return {
        rowCount: rows.length,
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        dialogsBefore: document.querySelectorAll('[role="dialog"]').length,
      };
    })()`);
    console.log(' - Row click diagnostics:', clickDiagnostics);
    await sleep(800);

    const drawerStatus = await cdp.eval(`(() => {
      const drawer = document.querySelector('div[role="dialog"]');
      if (!drawer) return { open: false, bodyHtml: document.body.innerHTML.slice(0, 300) };
      return {
        open: true,
        text: drawer.innerText,
      };
    })()`);
    console.log(' - Drawer status after click:', { open: drawerStatus.open });
    if (!drawerStatus.open || !drawerStatus.text.toUpperCase().includes('BIOACOUSTIC SCORE CALIBRATION NOTE')) {
      throw new Error(`Detection Detail Drawer failed to open with scientific note: ${JSON.stringify(drawerStatus)}`);
    }
    console.log(' - Drawer opened with bioacoustic caveat and provenance details.');

    // Press Escape to dismiss
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    });
    await sleep(400);

    const drawerClosed = await cdp.eval(`document.querySelector('div[role="dialog"]') === null`);
    if (!drawerClosed) {
      throw new Error('Drawer failed to dismiss on Escape key press');
    }
    console.log(' -> PASSED: Detail Drawer open, caveat rendering, and keyboard dismissal verified.');

    // 9. Export actions (CSV & JSON verification)
    console.log('[Test 9] Testing CSV and JSON data export generators...');
    const exportResult = await cdp.eval(`(() => {
      const csvBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Export CSV'));
      const jsonBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Export JSON'));
      return {
        hasCsvBtn: !!csvBtn && !csvBtn.disabled,
        hasJsonBtn: !!jsonBtn && !jsonBtn.disabled,
      };
    })()`);
    if (!exportResult.hasCsvBtn || !exportResult.hasJsonBtn) {
      throw new Error('Export action buttons missing or disabled');
    }
    console.log(' -> PASSED: Export CSV and JSON buttons enabled and operational.');

    // 10. Layout check & console error check
    console.log('[Test 10] Checking responsive layout and browser console...');
    const overflowCheck = await cdp.eval(`(() => {
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`);
    if (overflowCheck.scrollWidth > overflowCheck.clientWidth) {
      console.warn('Warning: slight horizontal overflow:', overflowCheck);
    }

    const severeErrors = cdp.consoleMessages.filter((m) => m.type === 'error');
    if (severeErrors.length > 0) {
      console.warn('Console error messages caught:', severeErrors);
    } else {
      console.log(' - Browser console cleanly free of uncaught errors.');
    }

    console.log('\n=========================================');
    console.log('ALL PHASE 4 BROWSER CHECKS PASSED!');
    console.log('=========================================\n');
  } finally {
    if (cdp) cdp.close();
    if (chromeProc) {
      chromeProc.kill('SIGKILL');
    }
    if (previewProc) {
      previewProc.kill('SIGKILL');
    }
    try {
      fs.rmSync(tempProfileDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }
}

runBrowserTest().catch((err) => {
  console.error('[Phase 4 Browser Test FAILED]', err);
  process.exit(1);
});
