import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9882;
const TARGET_URL = 'http://localhost:5173/';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
        const text = msg.params.args.map((a) => a.value ?? a.description ?? JSON.stringify(a)).join(' ');
        this.consoleMessages.push({ type: msg.params.type, text });
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.consoleMessages.push({
          type: 'error',
          text: `Uncaught Exception: ${JSON.stringify(msg.params.exceptionDetails)}`,
        });
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
    } catch {}
  }
}

async function run() {
  const tmpProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-diag-'));
  const chromeArgs = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${tmpProfile}`,
    '--headless=new',
    '--disable-gpu-shader-disk-cache',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1440,900',
  ];

  console.log('Launching Chrome...');
  const chromeProc = spawn(CHROME_PATH, chromeArgs, { stdio: 'ignore' });

  try {
    await sleep(1500);
    const jsonRes = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`);
    const pages = await jsonRes.json();
    const page = pages.find((p) => p.type === 'page') || pages[0];
    if (!page) throw new Error('No page target found');

    const client = new CDPClient(page.webSocketDebuggerUrl);
    await client.connect();
    await client.send('Runtime.enable');
    await client.send('Page.enable');

    console.log(`Navigating to ${TARGET_URL}...`);
    await client.send('Page.navigate', { url: TARGET_URL });
    await sleep(3000);

    console.log('=== Console Logs ===');
    for (const msg of client.consoleMessages) {
      console.log(`[${msg.type}] ${msg.text}`);
    }

    const title = await client.eval('document.title');
    const rootHtml = await client.eval('document.getElementById("root")?.innerHTML?.slice(0, 300)');
    const canvasCount = await client.eval('document.querySelectorAll("canvas").length');
    const bodyClass = await client.eval('document.body.className');
    const computedStyle = await client.eval('window.getComputedStyle(document.body).backgroundColor');
    const leafScale = await client.eval('document.querySelector("section")?.getAttribute("data-phase")');
    const progress = await client.eval('document.querySelector("section")?.getAttribute("data-progress")');

    console.log({
      title,
      rootHtml,
      canvasCount,
      bodyClass,
      computedStyle,
      leafScale,
      progress,
    });

    // Capture screenshot
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('diag-screenshot.png', Buffer.from(screenshot.data, 'base64'));
    console.log('Saved diag-screenshot.png');

    client.close();
  } finally {
    try {
      chromeProc.kill();
    } catch {}
    try {
      fs.rmSync(tmpProfile, { recursive: true, force: true });
    } catch {}
  }
}

run().catch(console.error);
