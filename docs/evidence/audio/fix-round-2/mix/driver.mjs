// Copy of the lead's CDP driver with the review's own profile folder and the e2e's audio flags.
// Usage: node driver.mjs <stepsModule.mjs> [url]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const stepsPath = process.argv[2];
const url = process.argv[3] ?? 'http://localhost:5199/';
const port = 9500 + Math.floor(Math.random() * 100);
const profile = join(here, 'profile-' + port);
mkdirSync(profile, { recursive: true });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--use-angle=d3d11',
  '--enable-gpu',
  '--ignore-gpu-blocklist',
  '--window-size=1280,720',
  '--no-first-run',
  '--no-default-browser-check',
  '--mute-audio',
  '--autoplay-policy=document-user-activation-required',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      break;
    }
  } catch {}
  await sleep(200);
}
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
const consoleLines = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    consoleLines.push(`[${msg.params.type}] ${text}`.slice(0, 400));
  } else if (msg.method === 'Runtime.exceptionThrown') {
    consoleLines.push(`[exception] ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`.slice(0, 600));
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await sleep(1500);

const api = {
  send,
  async evaluate(expression, timeoutMs = 120000) {
    let timer;
    const r = await Promise.race([
      send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
      new Promise((res) => { timer = setTimeout(() => res({ result: { result: { value: '__timeout__' } } }), timeoutMs); }),
    ]);
    clearTimeout(timer);
    if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text };
    return r.result?.result?.value;
  },
  async click(x = 4, y = 4) {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
    }
  },
  wait: sleep,
  log: (...a) => console.log(...a),
  console: consoleLines,
};

try {
  const steps = (await import(pathToFileURL(stepsPath).href)).default;
  await steps(api);
} catch (e) {
  console.log('STEP ERROR', e);
} finally {
  console.log('--- console (' + consoleLines.length + ' lines, last 25) ---');
  for (const l of consoleLines.slice(-25)) console.log(l);
  try { ws.close(); } catch {}
  chrome.kill();
  await sleep(800);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
