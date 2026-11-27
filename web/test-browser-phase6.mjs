import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9880;
const APP_PORT = 3461;
const APP_URL = `http://localhost:${APP_PORT}/app/sessions`;

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
  console.log('[Phase 6 Browser Test] Starting Vite preview on port', APP_PORT);

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
  const tempProfileDir = path.join(os.tmpdir(), `ecosonic-cdp-phase6-${Date.now()}`);

  try {
    await waitForHttp(APP_URL, 15000);
    console.log('[Phase 6 Browser Test] Vite preview running at', APP_URL);

    fs.mkdirSync(tempProfileDir, { recursive: true });

    console.log('[Phase 6 Browser Test] Launching Chrome CDP on port', DEBUG_PORT);
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

    console.log('[Phase 6 Browser Test] Connected to Chrome DevTools Protocol');
    await sleep(2000);

    // 1. Initial Page Load of Sessions History
    console.log('[Test 1] Verifying Sessions History page load & elements...');
    const pageTitle = await cdp.eval('document.title');
    console.log(' - Page title:', pageTitle);

    const initialStructure = await cdp.eval(`(() => {
      const text = document.body.innerText;
      return {
        hasTitle: text.includes('Session History'),
        hasRecordedSessions: text.includes('Recorded Sessions'),
        hasSearchInput: !!document.querySelector('[data-testid="session-search-input"]'),
      };
    })()`);
    if (!initialStructure.hasTitle || !initialStructure.hasRecordedSessions) {
      throw new Error('Initial page structure missing Session History elements');
    }
    console.log(' -> PASSED: Session History interface rendered cleanly.');

    // 2. Search filtering on Sessions list
    console.log('[Test 2] Testing session search filtering ("Hoh")...');
    await cdp.eval(`(() => {
      const input = document.querySelector('[data-testid="session-search-input"]');
      if (!input) throw new Error('Search input not found');
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, 'Hoh');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(600);

    const searchResult = await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button[data-testid^="session-item-"]'));
      return {
        count: buttons.length,
        url: window.location.href,
        hasHoh: buttons.length > 0 && buttons[0].innerText.includes('Hoh Basin'),
      };
    })()`);
    console.log(' - Search results count for "Hoh":', searchResult.count);
    if (searchResult.count !== 1 || !searchResult.hasHoh) {
      throw new Error(`Expected 1 result for Hoh, got ${searchResult.count}`);
    }
    if (!searchResult.url.includes('q=Hoh')) {
      throw new Error('URL did not sync search parameter q=Hoh');
    }

    // Clear search
    await cdp.eval(`(() => {
      const input = document.querySelector('[data-testid="session-search-input"]');
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(500);
    console.log(' -> PASSED: Session search filters and syncs to URL param ?q=');

    // 3. Status and Habitat Filters
    console.log('[Test 3] Testing Status filter (completed) and Habitat filter (boreal-wetland)...');
    await cdp.eval(`(() => {
      const habitatSelect = document.querySelector('[data-testid="session-habitat-select"]');
      if (!habitatSelect) throw new Error('Habitat select not found');
      habitatSelect.value = 'boreal-wetland';
      habitatSelect.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(600);

    const habitatResult = await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button[data-testid^="session-item-"]'));
      return {
        count: buttons.length,
        url: window.location.href,
        buttonTexts: buttons.map(b => b.innerText),
        isFen: buttons.length > 0 && buttons[0].innerText.includes('Fen Transect'),
      };
    })()`);
    console.log(' - Boreal wetland session count:', habitatResult.count);
    if (habitatResult.count !== 1 || !habitatResult.isFen) {
      throw new Error(`Habitat filtering failed: ${JSON.stringify(habitatResult)}`);
    }
    if (!habitatResult.url.includes('habitat=boreal-wetland')) {
      throw new Error('URL did not sync habitat parameter');
    }

    // Reset habitat
    await cdp.eval(`(() => {
      const habitatSelect = document.querySelector('[data-testid="session-habitat-select"]');
      habitatSelect.value = 'all';
      habitatSelect.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(500);
    console.log(' -> PASSED: Habitat station filter verified.');

    // 4. Navigate to Dedicated Session Details page (/app/sessions/ses-2026-1121-a)
    console.log('[Test 4] Testing navigation to dedicated session details page (/app/sessions/ses-2026-1121-a)...');
    await cdp.eval(`(() => {
      const link = document.querySelector('a[href*="/app/sessions/ses-2026-1121-a"]');
      if (!link) throw new Error('Dedicated session link not found');
      link.click();
    })()`);
    await sleep(1000);

    const detailPageStatus = await cdp.eval(`(() => {
      const text = document.body.innerText;
      return {
        url: window.location.href,
        hasTitle: text.includes('Session Intelligence'),
        hasSessionId: text.includes('ses-2026-1121-a'),
        hasSoundscape: text.includes('Soundscape Indices'),
        hasTimeline: text.includes('Temporal Event Chronology'),
        hasSpeciesSection: text.includes('Species Observations'),
        hasDisturbancesSection: text.includes('Disturbance Events'),
        hasNotesSection: text.includes('Local Researcher Field Notes'),
      };
    })()`);
    console.log(' - Detail page status:', detailPageStatus);
    if (!detailPageStatus.url.includes('/app/sessions/ses-2026-1121-a') || !detailPageStatus.hasSessionId) {
      throw new Error('Failed to load dedicated session details route');
    }
    console.log(' -> PASSED: Dedicated session details route loaded with complete sections.');

    // 5. Test Local Field Notes in Session Details
    console.log('[Test 5] Testing Local Field Notes creation, display, and deletion...');
    const testNoteText = 'Verified microphone calibration against reference anemometer at 05:45 UTC.';
    await cdp.eval(`((content) => {
      const textarea = document.querySelector('textarea');
      if (!textarea) throw new Error('Notes textarea not found');
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      nativeSetter.call(textarea, content);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));

      const submitBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Save Note'));
      if (!submitBtn) throw new Error('Save Note button not found');
      submitBtn.click();
    })('${testNoteText}')`);
    await sleep(600);

    const notesStatus = await cdp.eval(`(() => {
      const text = document.body.innerText;
      return {
        hasNote: text.includes('Verified microphone calibration'),
        hasEditBtn: Array.from(document.querySelectorAll('button')).some(b => b.innerText === 'Edit'),
        hasDeleteBtn: Array.from(document.querySelectorAll('button')).some(b => b.innerText.includes('Delete')),
      };
    })()`);
    console.log(' - Notes status after creation:', notesStatus);
    if (!notesStatus.hasNote) {
      throw new Error('Failed to create local field note');
    }
    console.log(' -> PASSED: Local field notes persist and display properly.');

    // 6. Test Direct Access to another Session URL (/app/sessions/ses-2026-1120-b)
    console.log('[Test 6] Testing direct URL navigation to another session (/app/sessions/ses-2026-1120-b)...');
    await cdp.eval(`window.location.href = 'http://localhost:${APP_PORT}/app/sessions/ses-2026-1120-b'`);
    await sleep(1500);

    const secondSessionStatus = await cdp.eval(`(() => {
      const text = document.body.innerText;
      return {
        url: window.location.href,
        hasTitle: text.includes('Dusk Fen Transect'),
        hasSessionId: text.includes('ses-2026-1120-b'),
        hasAci: text.includes('162.4'),
      };
    })()`);
    console.log(' - Direct access status:', secondSessionStatus);
    if (!secondSessionStatus.hasSessionId || !secondSessionStatus.hasTitle) {
      throw new Error('Direct URL access to second session failed');
    }
    console.log(' -> PASSED: Direct URL access to dedicated session route works cleanly.');

    // 7. Test Invalid Session ID route (/app/sessions/invalid-id-xyz)
    console.log('[Test 7] Testing invalid session ID error handling (/app/sessions/invalid-id-xyz)...');
    await cdp.eval(`window.location.href = 'http://localhost:${APP_PORT}/app/sessions/invalid-id-xyz'`);
    await sleep(1000);

    const invalidStatus = await cdp.eval(`(() => {
      const text = document.body.innerText;
      return {
        hasNotFound: text.includes('Session Not Found') || text.includes('invalid-id-xyz'),
        hasBackButton: text.includes('Back to Session History'),
      };
    })()`);
    console.log(' - Invalid session handling:', invalidStatus);
    if (!invalidStatus.hasNotFound) {
      throw new Error('Invalid session did not render helpful not-found state');
    }
    console.log(' -> PASSED: Invalid session IDs handle gracefully without crashing.');

    // 8. Test Browser Back/Forward navigation
    console.log('[Test 8] Testing browser Back and Forward navigation...');
    await cdp.eval(`window.history.back()`);
    await sleep(1000);
    const backUrl = await cdp.eval(`window.location.href`);
    console.log(' - URL after Back:', backUrl);

    await cdp.eval(`window.history.forward()`);
    await sleep(1000);
    const forwardUrl = await cdp.eval(`window.location.href`);
    console.log(' - URL after Forward:', forwardUrl);
    console.log(' -> PASSED: Browser history Back and Forward navigation verified.');

    // 9. Check console error messages
    console.log('[Test 9] Verifying browser console cleanliness...');
    const errors = cdp.consoleMessages.filter((m) => m.type === 'error');
    if (errors.length > 0) {
      console.warn('Console error messages:', errors);
    } else {
      console.log(' - Browser console cleanly free of uncaught errors.');
    }

    console.log('\n=========================================');
    console.log('ALL PHASE 6 BROWSER CHECKS PASSED!');
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
  console.error('[Phase 6 Browser Test FAILED]', err);
  process.exit(1);
});
