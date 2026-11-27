import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const CDP_PORT = 9235;
const TARGET_URL = 'http://localhost:5174/';
const OUTPUT_DIR = path.resolve('docs/audit_evidence');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const USER_DATA_DIR = path.resolve('tmp_audit_profile');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function launchChrome() {
  console.log('Spawning headless Chrome on port', CDP_PORT);
  const chromeProcess = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${USER_DATA_DIR}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );
  return chromeProcess;
}

async function waitForCdpReady(maxWaitMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (res.ok) {
        const data = await res.json();
        console.log('CDP ready:', data.Browser);
        return data;
      }
    } catch {
      // wait
    }
    await sleep(200);
  }
  throw new Error('Chrome CDP failed to initialize within timeout');
}

async function getNewTab() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(TARGET_URL)}`, { method: 'PUT' });
  return await res.json();
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
    this.events = [];
    this.consoleLogs = [];
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        if (data.id && this.callbacks.has(data.id)) {
          const { res, rej } = this.callbacks.get(data.id);
          this.callbacks.delete(data.id);
          if (data.error) rej(data.error);
          else res(data.result);
        } else if (data.method) {
          if (data.method === 'Runtime.consoleAPICalled') {
            this.consoleLogs.push({
              type: data.params.type,
              args: data.params.args.map(a => a.value ?? a.description),
            });
          }
          this.events.push(data);
        }
      };
    });
  }

  send(method, params = {}) {
    const id = this.id++;
    return new Promise((res, rej) => {
      this.callbacks.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return result.result?.value;
  }

  async screenshot(filename) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    const filePath = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
    console.log(`Saved screenshot: ${filename} (${Math.round(data.length / 1024)} KB)`);
    return filePath;
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const chromeProc = launchChrome();

  try {
    await waitForCdpReady();
    const tab = await getNewTab();
    console.log('Opened tab:', tab.id, tab.webSocketDebuggerUrl);

    const client = new CdpClient(tab.webSocketDebuggerUrl);
    await client.connect();

    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 2,
      mobile: false,
    });

    console.log('Waiting for initial load and rendering...');
    await sleep(2500);

    // 1. Initial Load Inspection (Scene 01 Darkness)
    console.log('\n--- Auditing 1. Initial Load (Scene 01) ---');
    await client.screenshot('01_initial_load_scene01.png');

    const initialDiagnostics = await client.evaluate(`(() => {
      const hero = document.querySelector('section[aria-label="EcoSonic Cinematic Opening"]');
      const canvas = hero?.querySelector('canvas');
      const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
      const progress = hero?.dataset.progress;
      const phase = hero?.dataset.phase;
      const textNodes = Array.from(document.querySelectorAll('h1, h2, h3, span, p'))
        .filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= window.innerHeight && window.getComputedStyle(el).opacity !== '0';
        })
        .map(el => el.textContent.trim())
        .filter(Boolean);

      return {
        hasHero: !!hero,
        hasCanvas: !!canvas,
        canvasSize: canvas ? { width: canvas.width, height: canvas.height } : null,
        glRenderer: gl ? gl.getParameter(gl.RENDERER) : null,
        progress,
        phase,
        visibleTextNodes: textNodes.slice(0, 10),
      };
    })()`);
    console.log('Initial diagnostics:', JSON.stringify(initialDiagnostics, null, 2));

    // 2. Cursor Interaction & Mist Clearing
    console.log('\n--- Auditing 2. Cursor Interaction & Mist Clearing ---');
    for (let x = 300; x <= 1100; x += 150) {
      for (let y = 200; y <= 700; y += 150) {
        await client.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x,
          y,
        });
        await sleep(40);
      }
    }
    await sleep(600);
    await client.screenshot('02_cursor_interaction_mist.png');

    // 3. Scroll Choreography through Sequence
    console.log('\n--- Auditing 3. Scroll Choreography ---');

    // Scroll to Canopy & Twig (Progress ~0.15 - 0.22)
    await client.evaluate(`window.scrollTo({ top: window.innerHeight * 0.9, behavior: 'instant' });`);
    await sleep(800);
    const p1 = await client.evaluate(`document.querySelector('section[aria-label="EcoSonic Cinematic Opening"]')?.dataset.progress`);
    console.log('Scroll step 1 progress:', p1);
    await client.screenshot('03_foliage_canopy_twig.png');

    // Scroll to Leaf Descent (Progress ~0.45)
    await client.evaluate(`window.scrollTo({ top: window.innerHeight * 2.3, behavior: 'instant' });`);
    await sleep(800);
    const p2 = await client.evaluate(`document.querySelector('section[aria-label="EcoSonic Cinematic Opening"]')?.dataset.progress`);
    console.log('Scroll step 2 progress:', p2);
    await client.screenshot('04_falling_leaf_descent.png');

    // Scroll to Water Contact & Ripple (Progress ~0.68)
    await client.evaluate(`window.scrollTo({ top: window.innerHeight * 3.6, behavior: 'instant' });`);
    await sleep(800);
    const p3 = await client.evaluate(`document.querySelector('section[aria-label="EcoSonic Cinematic Opening"]')?.dataset.progress`);
    console.log('Scroll step 3 progress:', p3);
    await client.screenshot('05_water_contact_ripple.png');

    // Scroll to Acoustic Emergence & Brand Reveal (Progress ~0.98 full arrival)
    await client.evaluate(`window.scrollTo({ top: window.innerHeight * 5.12, behavior: 'instant' });`);
    await sleep(800);
    const p4 = await client.evaluate(`document.querySelector('section[aria-label="EcoSonic Cinematic Opening"]')?.dataset.progress`);
    console.log('Scroll step 4 progress:', p4);
    await client.screenshot('06_brand_reveal_listen_ecosystem.png');

    // Scroll to Overview & Pipeline Transition (Progress ~1.05)
    await client.evaluate(`window.scrollTo({ top: window.innerHeight * 6.1, behavior: 'instant' });`);
    await sleep(1000);
    await client.screenshot('07_product_overview_bridge.png');

    // Scroll to Interactive Product Preview (Acoustic Field & Telemetry)
    await client.evaluate(`document.getElementById('preview')?.scrollIntoView({ behavior: 'instant' });`);
    await sleep(1000);
    await client.screenshot('08_interactive_product_preview.png');

    // 4. Performance & Frame Telemetry
    console.log('\n--- Auditing 4. Performance & Memory Telemetry ---');
    const perfMetrics = await client.evaluate(`(() => {
      const memory = window.performance.memory ? {
        usedJSHeapSize: Math.round(window.performance.memory.usedJSHeapSize / 1024 / 1024) + ' MB',
        totalJSHeapSize: Math.round(window.performance.memory.totalJSHeapSize / 1024 / 1024) + ' MB',
      } : 'performance.memory not available in this context';

      return {
        memory,
        timing: {
          domInteractive: window.performance.timing?.domInteractive - window.performance.timing?.navigationStart + ' ms',
          loadEventEnd: window.performance.timing?.loadEventEnd - window.performance.timing?.navigationStart + ' ms',
        }
      };
    })()`);
    console.log('Performance Metrics:', JSON.stringify(perfMetrics, null, 2));

    const fpsMeasurement = await client.evaluate(`new Promise(resolve => {
      let frames = 0;
      const start = performance.now();
      function count() {
        frames++;
        if (performance.now() - start < 1000) {
          requestAnimationFrame(count);
        } else {
          const elapsed = (performance.now() - start) / 1000;
          resolve({ fps: Math.round(frames / elapsed), frames });
        }
      }
      requestAnimationFrame(count);
    })`);
    console.log('Measured FPS (1s window):', fpsMeasurement);

    // 5. Mobile Emulation Audit
    console.log('\n--- Auditing 5. Mobile Experience ---');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
    });
    await client.evaluate(`window.scrollTo({ top: 0, behavior: 'instant' });`);
    await sleep(600);
    await client.screenshot('09_mobile_initial_load.png');

    await client.evaluate(`window.scrollTo({ top: window.innerHeight * 4.8, behavior: 'instant' });`);
    await sleep(600);
    await client.screenshot('10_mobile_brand_reveal.png');

    // 6. Reduced Motion Audit
    console.log('\n--- Auditing 6. Reduced Motion Preference ---');
    await client.send('Emulation.setEmulatedMedia', {
      media: 'screen',
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await client.evaluate(`window.scrollTo({ top: 0, behavior: 'instant' });`);
    await sleep(600);
    await client.screenshot('11_reduced_motion_view.png');

    // 7. Console Logs
    console.log('\n--- Console Logs Captured during journey ---');
    console.log(JSON.stringify(client.consoleLogs, null, 2));

  } finally {
    console.log('Terminating Chrome process...');
    chromeProc.kill('SIGKILL');
  }
}

main().catch(err => {
  console.error('Audit runner error:', err);
  process.exit(1);
});
