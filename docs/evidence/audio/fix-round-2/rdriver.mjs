// Review driver: headless Chrome over CDP, profile kept in this folder.
// Usage: node rdriver.mjs <steps.mjs> [url]
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const stepsPath = process.argv[2];
const url = process.argv[3] ?? 'http://localhost:5199/';
const port = 9300 + Math.floor(Math.random() * 200);
const profile = join(here, 'profiles', 'p-' + port);
mkdirSync(profile, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  [
    '--headless=new',
    '--mute-audio',
    '--autoplay-policy=document-user-activation-required',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--use-angle=d3d11',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--window-size=1280,720',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
let ws;
for (let i = 0; i < 100 && !ws; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch {}
  if (!ws) await sleep(200);
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
  } else if (msg.method === 'Runtime.consoleAPICalled')
    consoleLines.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 500));
  else if (msg.method === 'Runtime.exceptionThrown')
    consoleLines.push(`[exception] ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`.slice(0, 800));
  else if (msg.method === 'Log.entryAdded')
    consoleLines.push(`[log.${msg.params.entry.level}] ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`.slice(0, 500));
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

const PROBE = `(() => {
  const P = { contexts: 0, offline: 0, media: [], created: [], ctxs: [] };
  Object.defineProperty(window, '__audioProbe', { value: P });
  P.ctorMs = [];
  const wrap = (name, onNew) => { const C = window[name]; if (typeof C !== 'function') return; window[name] = new Proxy(C, { construct(t, args) { const t0 = performance.now(); const o = new t(...args); if (name === 'AudioContext') P.ctorMs.push({ at: t0, ms: performance.now() - t0 }); onNew(o); return o; } }); };
  P.longtasks = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.longtasks.push({ start: e.startTime, ms: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch {}
  wrap('AudioContext', (c) => { P.contexts++; P.created.push({ at: performance.now(), active: navigator.userActivation ? navigator.userActivation.isActive : null }); P.ctxs.push(c); });
  wrap('OfflineAudioContext', () => P.offline++);
  wrap('Audio', (el) => P.media.push(el));
  P.music = () => P.media.map((el) => ({ file: decodeURIComponent(String(el.currentSrc || el.src).split('/').pop() || ''), volume: el.volume, muted: el.muted, paused: el.paused, time: el.currentTime }));
})();`;
await send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });

const api = {
  send,
  async evaluate(expression, timeoutMs = 120000) {
    let timer;
    const r = await Promise.race([
      send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
      new Promise((res) => { timer = setTimeout(() => res(null), timeoutMs); }),
    ]);
    clearTimeout(timer);
    if (r === null) return { __error: 'timeout' };
    if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text };
    return r.result?.result?.value;
  },
  call(fn, ...args) {
    return api.evaluate(`(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`);
  },
  async until(cond, ms = 30000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = await api.evaluate(`!!(${cond})`, 10000);
      if (v === true) return Date.now() - t0;
      await sleep(100);
    }
    return -1;
  },
  async key(key, { code } = {}) {
    const KEYS = { Escape: 27, Tab: 9, Enter: 13, ' ': 32 };
    const printable = key.length === 1;
    const vk = KEYS[key] ?? (printable ? key.toUpperCase().charCodeAt(0) : 0);
    const c = code ?? (key === ' ' ? 'Space' : printable ? `Key${key.toUpperCase()}` : key);
    const base = { key, code: c, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    await send('Input.dispatchKeyEvent', printable ? { type: 'keyDown', text: key, ...base } : { type: 'rawKeyDown', ...base });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  },
  async click(x = 4, y = 4) {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
      await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
  },
  async clickText(selector, re) {
    const box = await api.evaluate(
      `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => new RegExp(${JSON.stringify(re.source)}).test(x.textContent.trim())); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
    );
    if (!box || box.__error) throw new Error(`no ${selector} matching ${re}`);
    await api.click(box.x, box.y);
    return box;
  },
  async load(u, seed = {}) {
    await send('Page.navigate', { url: u });
    await api.until('document.readyState === "complete"', 30000);
    await api.call((seed) => {
      localStorage.clear();
      const settings = { skipIntros: true, unlockAllLevels: true, quality: 'low', mouseSteering: false, ...(seed.settings ?? {}) };
      localStorage.setItem('iceberg-river.settings.v1', JSON.stringify(settings));
      localStorage.setItem(
        'iceberg-river.story.v1',
        JSON.stringify({ version: 1, completed: seed.storyCompleted ?? [], archive: [], settings: { narrative: seed.narrative ?? true, ai: 'off' } }),
      );
      return true;
    }, seed);
    consoleLines.length = 0;
    await send('Page.reload', { ignoreCache: false });
    await sleep(500);
    await api.until('document.querySelector(".app") !== null', 60000);
    await sleep(800);
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
  console.log('--- console (' + consoleLines.length + ' lines, last 30) ---');
  for (const l of consoleLines.slice(-30)) console.log(l);
  try {
    ws.close();
  } catch {}
  chrome.kill();
  await sleep(800);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
}
