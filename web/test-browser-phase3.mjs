import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9877;
const APP_PORT = 3458;
const APP_URL = `http://localhost:${APP_PORT}/app/soundscape`;

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

  async eval(expr) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
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
      this.ws?.close();
    } catch {}
  }
}

async function runSoundscapeBrowserVerification() {
  console.log('--- STARTING PHASE 3 SOUNDSCAPE BROWSER VERIFICATION ---');

  // 1. Start Vite dev server on dedicated port
  console.log(`1. Starting Vite server on port ${APP_PORT}...`);
  const viteProcess = spawn('npx.cmd', ['vite', `--port=${APP_PORT}`, '--strictPort'], {
    cwd: process.cwd(),
    stdio: 'pipe',
    shell: true,
  });

  viteProcess.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
  await waitForHttp(`http://localhost:${APP_PORT}/`);
  console.log(`Vite server ready at http://localhost:${APP_PORT}/`);

  // 2. Launch headless Chrome with clean temp profile
  console.log('2. Launching Chrome headless with remote debugging...');
  const tempUserDataDir = path.join(os.tmpdir(), `chrome-soundscape-profile-${Date.now()}`);
  const chromeProcess = spawn(
    CHROME_PATH,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${tempUserDataDir}`,
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-extensions',
      'about:blank',
    ],
    { stdio: 'pipe' }
  );

  await waitForHttp(`http://localhost:${DEBUG_PORT}/json/version`);
  console.log('Chrome debugging endpoint ready.');

  // 3. Connect to page
  const targetsRes = await fetch(`http://localhost:${DEBUG_PORT}/json/list`);
  const targets = await targetsRes.json();
  const pageTarget = targets.find((t) => t.type === 'page') || targets[0];
  const cdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
  await cdp.connect();

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');

  try {
    console.log('Navigating to', APP_URL);
    await cdp.send('Page.navigate', { url: APP_URL });

    // Wait for page to mount
    console.log('Waiting for SoundscapePage to mount...');
    let mounted = false;
    for (let i = 0; i < 40; i++) {
      mounted = await cdp.eval(`Boolean(document.querySelector('h1')?.textContent?.includes('Soundscape Intelligence'))`);
      if (mounted) break;
      await sleep(250);
    }
    if (!mounted) throw new Error('SoundscapePage did not mount');
    console.log('SoundscapePage mounted successfully.');

    // 1. Verify 5 core acoustic indices are rendered
    console.log('\n--- Test 1: Verify Core Indices ---');
    let loadedIndices = false;
    for (let i = 0; i < 30; i++) {
      const count = await cdp.eval(`document.querySelectorAll('section[aria-label="Core Acoustic Indices"] .font-mono.tabular-nums').length`);
      if (count >= 5) {
        loadedIndices = true;
        break;
      }
      await sleep(200);
    }
    if (!loadedIndices) throw new Error('Soundscape indices did not load in time');

    const metricTexts = await cdp.eval(`Array.from(document.querySelectorAll('section[aria-label="Core Acoustic Indices"] .font-mono.tabular-nums')).map(el => el.textContent.trim())`);
    console.log('Rendered core indices values:', metricTexts);
    if (!metricTexts || metricTexts.length < 5) throw new Error('Did not find 5 core metric readouts');
    // Default temperate-rainforest values: ACI: 184.6, ADI: 2.42, AEI: 0.31, NDSI: +0.68, Entropy: 0.79
    if (metricTexts[0] !== '184.6') throw new Error(`Expected ACI 184.6, got ${metricTexts[0]}`);
    if (metricTexts[3] !== '+0.68') throw new Error(`Expected NDSI +0.68, got ${metricTexts[3]}`);
    console.log('✓ Core indices accurately match Hoh Canopy rainforest fixtures.');

    // 2. Test Station Switcher
    console.log('\n--- Test 2: Test Station Switcher ---');
    await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const wetlandBtn = buttons.find(b => b.textContent && b.textContent.includes('Karelian Fen'));
      if (wetlandBtn) wetlandBtn.click();
    })()`);
    await sleep(1000);

    const wetlandAci = await cdp.eval(`document.querySelector('section[aria-label="Core Acoustic Indices"] .font-mono.tabular-nums')?.textContent?.trim()`);
    console.log('Wetland ACI value after switch:', wetlandAci);
    if (wetlandAci !== '162.4') throw new Error(`Expected wetland ACI 162.4, got ${wetlandAci}`);
    console.log('✓ Habitat preset switching updates indices reactively.');

    // 3. Test Methodology Inspector Modal
    console.log('\n--- Test 3: Test Methodology Inspector Modal ---');
    await cdp.eval(`(() => {
      const infoBtn = document.querySelector('button[aria-label="Inspect Normalized Difference Soundscape Index methodology"]');
      if (infoBtn) infoBtn.click();
    })()`);
    await sleep(500);

    const isModalOpen = await cdp.eval(`Boolean(document.querySelector('[role="dialog"]'))`);
    const modalTitle = await cdp.eval(`document.getElementById('index-doc-title')?.textContent`);
    console.log('Methodology dialog open:', isModalOpen);
    console.log('Dialog title:', modalTitle);
    if (!isModalOpen || !modalTitle?.includes('Normalized Difference Soundscape Index')) {
      throw new Error('Methodology modal failed to open');
    }

    // Close modal via Escape key
    await cdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await sleep(400);
    const isModalClosed = await cdp.eval(`!document.querySelector('[role="dialog"]')`);
    console.log('Modal closed via Escape:', isModalClosed);
    if (!isModalClosed) throw new Error('Modal did not close on Escape');
    console.log('✓ Accessible methodology modal verified.');

    // 4. Test Temporal Activity Overlays
    console.log('\n--- Test 4: Test Temporal Activity Overlays ---');
    await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const detBtn = buttons.find(b => b.textContent && b.textContent.trim() === 'Detections');
      if (detBtn) detBtn.click();
    })()`);
    await sleep(400);

    const detPressed = await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const detBtn = buttons.find(b => b.textContent && b.textContent.trim() === 'Detections');
      return detBtn?.getAttribute('aria-pressed');
    })()`);
    console.log('Detections overlay aria-pressed:', detPressed);
    if (detPressed !== 'true') throw new Error('Detections overlay toggle did not activate');
    console.log('✓ Temporal activity chart overlays work reactively.');

    // 5. Test Radar Fingerprint Comparison Toggle
    console.log('\n--- Test 5: Test Radar Fingerprint Comparison ---');
    await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const compBtn = buttons.find(b => b.textContent && b.textContent.includes('Compare All'));
      if (compBtn) compBtn.click();
    })()`);
    await sleep(400);

    const compActive = await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.some(b => b.textContent && b.textContent.includes('Comparison On'));
    })()`);
    console.log('Comparison radar mode active:', compActive);
    if (!compActive) throw new Error('Comparison radar mode did not toggle');
    console.log('✓ Multi-station radar comparison works.');

    // 6. Test Data Table
    console.log('\n--- Test 6: Test Sample Log Data Table ---');
    await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const tableBtn = buttons.find(b => b.textContent && b.textContent.includes('View Sample Table'));
      if (tableBtn) tableBtn.click();
    })()`);
    await sleep(400);

    const tableRowsCount = await cdp.eval(`document.querySelectorAll('tbody tr').length`);
    console.log('Sample table rows count:', tableRowsCount);
    if (tableRowsCount < 5) throw new Error('Sample log table did not display expected intervals');
    console.log('✓ Screen-reader accessible sample log table works.');

    // 7. Test Export Actions
    console.log('\n--- Test 7: Test Research Data Exports ---');
    await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const jsonBtn = buttons.find(b => b.textContent && b.textContent.includes('Export JSON'));
      if (jsonBtn) jsonBtn.click();
    })()`);
    await sleep(400);

    const jsonNotice = await cdp.eval(`document.body.innerText.includes('Exported research-grade soundscape JSON')`);
    console.log('JSON export notification displayed:', jsonNotice);
    if (!jsonNotice) throw new Error('JSON export notification missing');

    await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const csvBtn = buttons.find(b => b.textContent && b.textContent.includes('Export CSV'));
      if (csvBtn) csvBtn.click();
    })()`);
    await sleep(400);

    const csvNotice = await cdp.eval(`document.body.innerText.includes('Exported soundscape indices & spectral bands CSV')`);
    console.log('CSV export notification displayed:', csvNotice);
    if (!csvNotice) throw new Error('CSV export notification missing');
    console.log('✓ Research data exports (JSON & CSV) verified.');

    // 8. Test Responsive Layout
    console.log('\n--- Test 8: Verify Desktop and Mobile Layouts ---');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(400);
    const desktopOverflow = await cdp.eval(`document.documentElement.scrollWidth <= window.innerWidth`);
    console.log('Desktop layout no horizontal overflow:', desktopOverflow);

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 667,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await sleep(400);
    const mobileOverflow = await cdp.eval(`document.documentElement.scrollWidth <= window.innerWidth`);
    console.log('Mobile layout no horizontal overflow:', mobileOverflow);
    if (!desktopOverflow || !mobileOverflow) throw new Error('Layout overflow detected');
    console.log('✓ Responsive layouts verified.');

    // 9. Console Error Check
    console.log('\n--- Test 9: Check Console Messages ---');
    const severeErrors = cdp.consoleMessages.filter(
      (m) => m.type === 'error' && !m.text.includes('favicon.ico')
    );
    console.log('Recorded console errors count:', severeErrors.length);
    if (severeErrors.length > 0) {
      console.warn('Unexpected console errors:', severeErrors);
      throw new Error(`Found ${severeErrors.length} unexpected console errors`);
    }
    console.log('✓ Zero unexpected console errors.');

    console.log('\n=============================================');
    console.log('ALL PHASE 3 SOUNDSCAPE VERIFICATION PASSED!');
    console.log('=============================================');
    process.exit(0);
  } finally {
    cdp.close();
    chromeProcess.kill();
    viteProcess.kill();
    try {
      fs.rmSync(tempUserDataDir, { recursive: true, force: true });
    } catch {}
  }
}

runSoundscapeBrowserVerification().catch((err) => {
  console.error('\n❌ PHASE 3 VERIFICATION FAILED:', err);
  process.exit(1);
});
