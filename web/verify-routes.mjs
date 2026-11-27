import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9884;
const BASE_URL = 'http://localhost:5173';

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
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1440,900',
  ];

  console.log('Launching Chrome for route audit...');
  const chromeProc = spawn(CHROME_PATH, chromeArgs, { stdio: 'ignore' });

  const routes = [
    '/',
    '/app',
    '/app/observatory',
    '/app/soundscape',
    '/app/detections',
    '/app/disturbances',
    '/app/sessions',
    '/app/settings',
  ];

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

    for (const route of routes) {
      const url = `${BASE_URL}${route}`;
      client.consoleMessages = [];
      await client.send('Page.navigate', { url });
      await sleep(1500);

      const pathname = await client.eval('window.location.pathname');
      const title = await client.eval('document.title');
      const errorCount = client.consoleMessages.filter((m) => m.type === 'error').length;
      const heading = await client.eval('document.querySelector("h1, h2")?.textContent');

      console.log(`[PASS] Route: ${route} -> Path: ${pathname} | Heading: "${heading?.trim() || 'N/A'}" | Errors: ${errorCount}`);
      if (errorCount > 0) {
        for (const err of client.consoleMessages.filter((m) => m.type === 'error')) {
          console.error(`   Error on ${route}: ${err.text}`);
        }
      }
    }

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
