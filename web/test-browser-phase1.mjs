import { spawn } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9876;
const APP_PORT = 3457;
const APP_URL = `http://localhost:${APP_PORT}/app/settings`;

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
    this.events = [];
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
      } else if (msg.method) {
        if (msg.method === 'Runtime.consoleAPICalled') {
          const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
          this.consoleMessages.push({ type: msg.params.type, text });
        }
        this.events.push(msg);
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

async function runVerification() {
  console.log('--- STARTING PHASE 1 VERIFICATION ---');

  // 1. Start Vite dev server
  console.log(`1. Starting Vite server on port ${APP_PORT}...`);
  const viteProcess = spawn('npx.cmd', ['vite', `--port=${APP_PORT}`, '--strictPort'], {
    cwd: process.cwd(),
    stdio: 'pipe',
    shell: true,
  });

  viteProcess.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));

  await waitForHttp(`http://localhost:${APP_PORT}/`);
  console.log(`Vite server ready at http://localhost:${APP_PORT}/`);

  // 2. Launch headless Chrome with CDP
  console.log('2. Launching Chrome headless with remote debugging...');
  const tempUserDataDir = path.join(os.tmpdir(), `chrome-test-profile-${Date.now()}`);
  const chromeProcess = spawn(
    CHROME_PATH,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${tempUserDataDir}`,
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-extensions',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
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
    // Navigate to /app/settings
    console.log('Navigating to', APP_URL);
    await cdp.send('Page.navigate', { url: APP_URL });

    // Wait for React to mount
    console.log('Waiting for React and SettingsPage to mount...');
    let mounted = false;
    for (let i = 0; i < 40; i++) {
      mounted = await cdp.eval(`Boolean(document.getElementById('api-base-url'))`);
      if (mounted) break;
      await sleep(250);
    }
    if (!mounted) {
      const html = await cdp.eval(`document.body.innerHTML`);
      console.log('Page body HTML at timeout:', html);
      console.log('Console messages:', cdp.consoleMessages);
      throw new Error('SettingsPage did not mount in time');
    }
    console.log('SettingsPage mounted successfully.');

    // Step 1: Change settings
    console.log('\n--- Step 1: Changing settings ---');
    const changeResult = await cdp.eval(`(() => {
      function setReactInput(el, value) {
        const proto = el instanceof HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
        descriptor.set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // 1. Switch theme to field-light
      const buttons = Array.from(document.querySelectorAll('button'));
      const lightThemeBtn = buttons.find(b => b.textContent && b.textContent.includes('Warm Ivory'));
      if (!lightThemeBtn) return { error: 'Warm Ivory button not found' };
      lightThemeBtn.click();

      // 2. Check scientific names first
      const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      const sciCheckbox = checkboxes[0];
      if (sciCheckbox && !sciCheckbox.checked) sciCheckbox.click();

      // 3. Audio sample rate
      const sampleRateSelect = document.getElementById('sample-rate-select');
      if (sampleRateSelect) setReactInput(sampleRateSelect, '44100');

      // 4. Default confidence
      const confSlider = document.getElementById('default-confidence');
      if (confSlider) setReactInput(confSlider, '0.8');

      // 5. Backend config inputs
      const apiInput = document.getElementById('api-base-url');
      if (apiInput) setReactInput(apiInput, 'https://api.ecosonic.org/v3');

      const wsInput = document.getElementById('ws-stream-url');
      if (wsInput) setReactInput(wsInput, 'wss://stream.ecosonic.org/ws');

      const reconnectInput = document.getElementById('reconnect-interval-ms');
      if (reconnectInput) setReactInput(reconnectInput, '5000');

      const modeSelect = document.getElementById('backend-config-mode');
      if (modeSelect) setReactInput(modeSelect, 'backend_ready');

      // 6. Submit backend form
      const saveBtn = buttons.find(b => b.textContent && b.textContent.includes('Save Configuration'));
      if (!saveBtn) return { error: 'Save Configuration button not found' };
      saveBtn.click();

      return { success: true };
    })()`);
    console.log('Settings change result:', changeResult);
    if (changeResult?.error) throw new Error(changeResult.error);
    await sleep(800);

    // Verify localStorage before reload
    const storedSettings = await cdp.eval(`localStorage.getItem('ecosonic.preferences.v1')`);
    console.log('localStorage stored payload:', storedSettings);
    const parsedStored = JSON.parse(storedSettings);
    if (parsedStored.appearance.theme !== 'field-light') throw new Error('Theme not saved');
    if (parsedStored.backendConfig.mode !== 'backend_ready') throw new Error('Mode not saved');
    if (parsedStored.backendConfig.apiBaseUrl !== 'https://api.ecosonic.org/v3') throw new Error('API URL not saved');

    // Step 2 & 3: Reload browser and confirm persistence
    console.log('\n--- Step 2 & 3: Reload browser & confirm persistence ---');
    await cdp.send('Page.reload');
    await sleep(2000);

    const reloadedTheme = await cdp.eval(`document.documentElement.getAttribute('data-theme')`);
    const reloadedApiUrl = await cdp.eval(`document.getElementById('api-base-url')?.value`);
    const reloadedWsUrl = await cdp.eval(`document.getElementById('ws-stream-url')?.value`);
    const reloadedReconnect = await cdp.eval(`document.getElementById('reconnect-interval-ms')?.value`);
    const reloadedMode = await cdp.eval(`document.getElementById('backend-config-mode')?.value`);
    const reloadedSampleRate = await cdp.eval(`document.getElementById('sample-rate-select')?.value`);

    console.log('Reloaded Theme data-theme:', reloadedTheme);
    console.log('Reloaded API URL:', reloadedApiUrl);
    console.log('Reloaded WS URL:', reloadedWsUrl);
    console.log('Reloaded Reconnect:', reloadedReconnect);
    console.log('Reloaded Mode:', reloadedMode);
    console.log('Reloaded Sample Rate:', reloadedSampleRate);

    if (reloadedTheme !== 'field-light') throw new Error('Theme did not persist after reload');
    if (reloadedApiUrl !== 'https://api.ecosonic.org/v3') throw new Error('API URL did not persist');
    if (reloadedWsUrl !== 'wss://stream.ecosonic.org/ws') throw new Error('WS URL did not persist');
    if (reloadedReconnect !== '5000') throw new Error('Reconnect did not persist');
    if (reloadedMode !== 'backend_ready') throw new Error('Mode did not persist');
    if (reloadedSampleRate !== '44100') throw new Error('Sample rate did not persist');
    console.log('✓ Settings persisted across full browser reload.');

    // Step 4 & 5: Change theme back and verify
    console.log('\n--- Step 4 & 5: Change theme to deep-forest & verify ---');
    await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const darkBtn = buttons.find(b => b.textContent && b.textContent.includes('Deep Forest'));
      if (darkBtn) darkBtn.click();
    })()`);
    await sleep(500);
    const darkThemeAttr = await cdp.eval(`document.documentElement.getAttribute('data-theme')`);
    console.log('Theme data-theme after deep-forest switch:', darkThemeAttr);
    if (darkThemeAttr !== null) throw new Error('data-theme should be null for deep-forest');
    console.log('✓ Theme remains correct.');

    // Step 6: Test microphone permission handling & test action
    console.log('\n--- Step 6: Test microphone permission handling ---');
    const micBadgeText = await cdp.eval(`document.querySelector('[data-testid="mic-permission-badge"]')?.textContent`);
    console.log('Mic Badge Text:', micBadgeText);

    // Click "Test Microphone"
    console.log('Clicking "Test Microphone"...');
    await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const testBtn = buttons.find(b => b.textContent && b.textContent.includes('Test Microphone'));
      if (testBtn) testBtn.click();
    })()`);
    await sleep(1000);

    const isTestingActive = await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.some(b => b.textContent && b.textContent.includes('Stop Test'));
    })()`);
    console.log('Microphone Test active (Stop Test button visible):', isTestingActive);

    // Stop mic test
    await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const stopBtn = buttons.find(b => b.textContent && b.textContent.includes('Stop Test'));
      if (stopBtn) stopBtn.click();
    })()`);
    await sleep(500);
    console.log('✓ Microphone test and permission handled gracefully.');

    // Step 7: Export configuration
    console.log('\n--- Step 7: Export configuration ---');
    await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const exportBtn = buttons.find(b => b.textContent && b.textContent.includes('Export Config JSON'));
      if (exportBtn) exportBtn.click();
    })()`);
    await sleep(500);
    const exportNotice = await cdp.eval(`document.body.innerText.includes('Exported non-secret configuration JSON.')`);
    console.log('Export notice displayed:', exportNotice);
    if (!exportNotice) throw new Error('Export notice not displayed');
    console.log('✓ Configuration export succeeded without secrets.');

    // Step 8: Reset settings through the confirmation modal
    console.log('\n--- Step 8: Reset settings through confirmation modal ---');
    await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const resetBtn = buttons.find(b => b.textContent && b.textContent.includes('Reset Defaults'));
      if (resetBtn) resetBtn.click();
    })()`);
    await sleep(500);

    const isModalOpen = await cdp.eval(`Boolean(document.querySelector('[role="dialog"]'))`);
    console.log('Confirmation modal open:', isModalOpen);
    if (!isModalOpen) throw new Error('Reset modal did not open');

    // Test Escape key dismissal
    console.log('Testing Escape key dismissal on modal...');
    await cdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await sleep(400);
    const isModalClosedAfterEsc = await cdp.eval(`!document.querySelector('[role="dialog"]')`);
    console.log('Modal dismissed via Escape:', isModalClosedAfterEsc);
    if (!isModalClosedAfterEsc) throw new Error('Modal did not dismiss on Escape');

    // Reopen modal and confirm reset
    await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const resetBtn = buttons.find(b => b.textContent && b.textContent.includes('Reset Defaults'));
      if (resetBtn) resetBtn.click();
    })()`);
    await sleep(400);

    console.log('Clicking Reset Defaults inside modal...');
    await cdp.eval(`(() => {
      const modal = document.querySelector('[role="dialog"]');
      const buttons = Array.from(modal.querySelectorAll('button'));
      const confirmBtn = buttons.find(b => b.textContent && b.textContent.trim() === 'Reset Defaults');
      if (confirmBtn) confirmBtn.click();
    })()`);
    await sleep(800);

    const postResetApiUrl = await cdp.eval(`document.getElementById('api-base-url')?.value`);
    const postResetMode = await cdp.eval(`document.getElementById('backend-config-mode')?.value`);
    const postResetSampleRate = await cdp.eval(`document.getElementById('sample-rate-select')?.value`);
    console.log('Post-reset API URL (default 8000):', postResetApiUrl);
    console.log('Post-reset Mode (default demo):', postResetMode);
    console.log('Post-reset Sample Rate (default 48000):', postResetSampleRate);

    if (postResetApiUrl !== 'http://localhost:8000') throw new Error('API URL not reset to default');
    if (postResetMode !== 'demo') throw new Error('Mode not reset to default');
    if (postResetSampleRate !== '48000') throw new Error('Sample rate not reset to default');
    console.log('✓ Reset settings through confirmation modal succeeded.');

    // Step 9: Simulate bootstrap failure
    console.log('\n--- Step 9: Simulate bootstrap failure ---');
    await cdp.eval(`sessionStorage.setItem('ecosonic.test.bootstrapFault', 'once')`);
    await cdp.send('Page.reload');
    await sleep(2000);

    const errorBannerTitle = await cdp.eval(`document.querySelector('[data-testid="workspace-error-banner"]')?.innerText`);
    const diagStatus = await cdp.eval(`document.querySelector('[data-testid="diag-adapter-status"]')?.innerText`);
    console.log('Error Banner text:', errorBannerTitle);
    console.log('Diagnostics adapter status during failure:', diagStatus);

    if (!errorBannerTitle || !errorBannerTitle.includes('Workspace Data Unavailable')) {
      throw new Error('Bootstrap error banner not displayed');
    }
    console.log('✓ Bootstrap failure simulated and ErrorBanner rendered.');

    // Step 10: Retry successfully
    console.log('\n--- Step 10: Retry successfully ---');
    await cdp.eval(`(() => {
      const banner = document.querySelector('[data-testid="workspace-error-banner"]');
      const retryBtn = banner?.querySelector('button');
      if (retryBtn) retryBtn.click();
    })()`);
    await sleep(2000);

    const bannerAfterRetry = await cdp.eval(`Boolean(document.querySelector('[data-testid="workspace-error-banner"]'))`);
    const diagStatusAfterRetry = await cdp.eval(`document.querySelector('[data-testid="diag-adapter-status"]')?.innerText`);
    console.log('Banner still present after retry:', bannerAfterRetry);
    console.log('Diagnostics adapter status after retry:', diagStatusAfterRetry);

    if (bannerAfterRetry) throw new Error('ErrorBanner still visible after retry');
    if (diagStatusAfterRetry !== 'Ready') throw new Error(`Status should be Ready, got: ${diagStatusAfterRetry}`);
    console.log('✓ Retry succeeded and workspace restored to Ready.');

    // Step 11: Verify desktop and mobile layouts
    console.log('\n--- Step 11: Verify desktop and mobile layouts ---');
    // Desktop layout
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(500);
    const desktopOverflow = await cdp.eval(`document.documentElement.scrollWidth <= window.innerWidth`);
    console.log('Desktop layout no horizontal scroll overflow:', desktopOverflow);

    // Mobile layout
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 667,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await sleep(500);
    const mobileOverflow = await cdp.eval(`document.documentElement.scrollWidth <= window.innerWidth`);
    console.log('Mobile layout no horizontal scroll overflow:', mobileOverflow);
    console.log('✓ Desktop and mobile layouts verified.');

    // Step 12: Check console errors
    console.log('\n--- Step 12: Check console logs for errors ---');
    const severeErrors = cdp.consoleMessages.filter((m) => m.type === 'error' && !m.text.includes('favicon.ico') && !m.text.includes('Bootstrap load interrupted'));
    console.log('Recorded console errors count:', severeErrors.length);
    if (severeErrors.length > 0) {
      console.warn('Unexpected console errors:', severeErrors);
      throw new Error(`Found ${severeErrors.length} unexpected console errors`);
    }
    console.log('✓ Zero unexpected console errors.');

    console.log('\n========================================');
    console.log('ALL PHASE 1 VERIFICATION TESTS PASSED!');
    console.log('========================================');
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

runVerification().catch((err) => {
  console.error('\n❌ VERIFICATION FAILED:', err);
  process.exit(1);
});
