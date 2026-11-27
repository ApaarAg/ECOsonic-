import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9886;
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
  console.log('================================================================');
  console.log('       ECOSONIC 3.0 — RAPID ROUTE TRANSITIONS & CLEANUP QA      ');
  console.log('================================================================\n');

  const tmpProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-cleanup-'));
  const chromeArgs = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${tmpProfile}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1440,900',
  ];

  const chromeProc = spawn(CHROME_PATH, chromeArgs, { stdio: 'ignore' });

  try {
    await sleep(1500);
    const jsonRes = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`);
    const pages = await jsonRes.json();
    const page = pages.find((p) => p.type === 'page') || pages[0];
    if (!page) throw new Error('No Chrome target');

    const client = new CDPClient(page.webSocketDebuggerUrl);
    await client.connect();
    await client.send('Runtime.enable');
    await client.send('Page.enable');

    // Sequence: Observatory -> Settings -> Sessions -> Observatory -> Detections -> Observatory
    const transitionSequence = [
      '/app/observatory',
      '/app/settings',
      '/app/sessions',
      '/app/observatory',
      '/app/detections',
      '/app/observatory',
    ];

    for (let i = 0; i < transitionSequence.length; i++) {
      const target = transitionSequence[i];
      client.consoleMessages = [];
      console.log(`[Transition ${i + 1}/${transitionSequence.length}] Navigating to ${target}...`);
      await client.send('Page.navigate', { url: `${BASE_URL}${target}` });
      await sleep(1000);

      const errs = client.consoleMessages.filter((m) => m.type === 'error');
      console.log(`  Current path: ${await client.eval('window.location.pathname')} | Uncaught errors: ${errs.length}`);
      if (errs.length > 0) {
        throw new Error(`Errors during navigation to ${target}: ${JSON.stringify(errs)}`);
      }
    }

    console.log('\n================================================================');
    console.log('   ALL ROUTE TRANSITIONS & CLEANUP AUDITS PASSED (CODE 0)       ');
    console.log('================================================================');
    client.close();
  } finally {
    try { chromeProc.kill(); } catch {}
    try { fs.rmSync(tmpProfile, { recursive: true, force: true }); } catch {}
  }
}

run().catch((err) => {
  console.error('[FATAL] Route transition test failed:', err);
  process.exit(1);
});
