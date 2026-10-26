#!/usr/bin/env node
/**
 * Browser checks of the sound (docs/AUDIO_DESIGN.md §11): drives the real game in headless Chrome
 * (or Edge) over the DevTools protocol and checks, by number, what the player would hear. Plain Node
 * (global fetch and WebSocket), no dependency.
 *
 *   node scripts/audio-e2e.mjs [--serve] [--port 5199] [--url http://localhost:5199/] [--only S2,S6]
 *                              [--quick] [--out logs/audio] [--chrome <path>] [--headed] [--keep-profile]
 *                              [--cpu-throttle 2] [--read-sec 20] [--audio-worker on|off]
 *
 * It needs the Vite dev server (it imports the app's own modules by their /src URLs). --serve starts
 * one on --port (default 5199, with its own dependency cache) and stops it at the end; never 5173,
 * which is the developer's own server. Each scenario loads a fresh page with a seeded profile (Story
 * AI off, so no agent calls; narrative on; every level unlocked; intros skipped; quality low).
 *
 * Two kinds of evidence, never mixed:
 *  - engine: what the page really does. The recorded music is checked on its actual media elements
 *    (src, volume, muted, paused), wrapped before any script runs; with package A's engine installed
 *    the numbers of window.__icebergAudio (state, meter, lab) are checked too, otherwise those checks
 *    read "not measurable".
 *  - bridge: a recording engine (src/audio/game/testing/recording.ts) is installed in the page, so the
 *    real 3D view's sound bridge plays into a recorder: every request, bell, duck, hold and motif the
 *    game asked for, joined to the run's own event log. It proves what was asked for, not how it
 *    sounded.
 *
 * Gestures are trusted (Input.dispatchMouseEvent / dispatchKeyEvent). The browser runs with
 * --mute-audio and --autoplay-policy=document-user-activation-required. Output: one JSON per scenario
 * and summary.{json,md} under --out/<timestamp>/. Exit code 1 if any check failed.
 *
 * Scenarios (AUDIO_DESIGN.md §11.3): S0 clock sanity, S1 autoplay, S2 Arcade basics, S3 event coverage
 * on every level (with S4, magnitude in the wild), S5 rapid collisions, S6 volume controls by keyboard
 * and M, S7 pause, S8 leave / retry / level change, S9 hidden tab, S10 church bells, S11 Story moments,
 * CALVE the intro's calving, S12 performance, S13 determinism, R offline renders (R1-R7, R9-R11),
 * S4M the magnitude mapping against every collision of many autopilot lines (audio off).
 * S3E, S5E, S8E, S10E and S11E run S3/S4, S5, S8, S10 and S11 again on the real engine (its own
 * trace and meters, no recorder); S14, a Story restart that keeps the game screen up (Replay chapter,
 * Continue with narrative off), on the engine; EPI, the epilogue motif's bake on the main thread
 * (?audioworker=off: the Revelation's frame time at the idle and loading paces, and the epilogue
 * started with its motif not baked at all); EPIW, that worst case with the motifs in a Web Worker;
 * BAKE / BAKEOFF measure the level set's bake from a cold start (and the ?audio=off baseline).
 * --quick runs fewer levels in S3 and S10. --cpu-throttle N slows the page's main thread N times (DevTools
 * CPU throttling): a slower machine for the bake's timing; it cannot reach a worker, so the pages are
 * loaded with ?audioworkerslow=N and the motif worker stays busy N times as long. --audio-worker off
 * loads every page with ?audioworker=off (motifs baked on the main thread, the fallback). --read-sec is how long S11E reads chapter 9's
 * Revelation before starting the epilogue (default 20). Determinism of the bridge's trace is also a headless test
 * (src/audio/game/integration.test.ts).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = 42;
/**
 * How long a page load may take to render the app. A fresh dev server (--serve keeps a dependency
 * cache of its own) pre-bundles three.js, Rapier and React on the first request, and on a cold cache
 * that took more than a minute once (S1 and S2 failed at the old 60 s); later loads take a second or two.
 */
const FIRST_RENDER_MS = 180000;
const notRendered = () =>
  new Error(`the app did not render within ${FIRST_RENDER_MS / 1000} s (a fresh dev server pre-bundles its dependencies on the first load; is the server up and the page free of errors?)`);

// --- command line -----------------------------------------------------------------------------------

function parseArgs(argv) {
  const o = { serve: false, port: 5199, url: null, only: null, quick: false, out: 'logs/audio', chrome: null, headed: false, keepProfile: false, cpuThrottle: 1, readSec: 20, audioWorker: 'on' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--serve') o.serve = true;
    else if (a === '--port') o.port = Number(next());
    else if (a === '--url') o.url = next();
    else if (a === '--only') o.only = next().split(',').map((s) => s.trim().toUpperCase());
    else if (a === '--quick') o.quick = true;
    else if (a === '--out') o.out = next();
    else if (a === '--chrome') o.chrome = next();
    else if (a === '--headed') o.headed = true;
    else if (a === '--keep-profile') o.keepProfile = true;
    else if (a === '--cpu-throttle') o.cpuThrottle = Number(next());
    else if (a === '--read-sec') o.readSec = Number(next());
    else if (a === '--audio-worker') o.audioWorker = next();
    else if (a === '--help' || a === '-h') {
      console.log(fileUsage());
      process.exit(0);
    } else {
      console.error(`unknown option ${a}\n${fileUsage()}`);
      process.exit(2);
    }
  }
  if (!Number.isInteger(o.port) || o.port <= 0) throw new Error('--port needs a number');
  if (!(o.cpuThrottle >= 1)) throw new Error('--cpu-throttle needs a rate >= 1');
  if (!(o.readSec >= 0)) throw new Error('--read-sec needs a number of seconds');
  if (o.audioWorker !== 'on' && o.audioWorker !== 'off') throw new Error('--audio-worker is on or off');
  o.url ??= `http://localhost:${o.port}/`;
  if (/:5173\b/.test(o.url) || o.port === 5173) {
    console.error('Port 5173 is the developer\'s own dev server: use another port (default 5199).');
    process.exit(2);
  }
  return o;
}

function fileUsage() {
  return 'usage: node scripts/audio-e2e.mjs [--serve] [--port 5199] [--url <dev server>] [--only S1,S2] [--quick] [--out logs/audio] [--chrome <path>] [--headed] [--keep-profile] [--cpu-throttle 2] [--read-sec 20] [--audio-worker on|off]';
}

/** url with these query parameters set (the ones it has kept). */
function withQuery(url, params) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
}

/**
 * Every page this run loads gets the run's own flags: --audio-worker off (?audioworker=off: motifs bake
 * on the main thread), and with --cpu-throttle N the motif worker slowed N times too
 * (?audioworkerslow=N): DevTools CPU throttling slows the page's main thread only, and a worker target
 * refuses it ("Operation is only supported for pages, not workers"), so the worker stays as busy as a
 * thread that much slower would be.
 */
function pageUrl(url) {
  return withQuery(url, {
    ...(opts.audioWorker === 'off' ? { audioworker: 'off' } : {}),
    ...(opts.cpuThrottle > 1 ? { audioworkerslow: opts.cpuThrottle } : {}),
  });
}

const opts = parseArgs(process.argv.slice(2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- the dev server (optional) ------------------------------------------------------------------------

async function startServer(port) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'iceberg-audio-e2e-vite-'));
  const slash = (p) => p.split(path.sep).join('/');
  const config = path.join(tmp, 'vite.audio-e2e.config.mjs');
  // The project config, with a dependency cache of its own (never the developer's node_modules/.vite).
  writeFileSync(
    config,
    `import base from ${JSON.stringify(slash(path.join(ROOT, 'vite.config.ts')))};\n` +
      `export default { ...base, cacheDir: ${JSON.stringify(slash(path.join(tmp, 'cache')))}, ` +
      `server: { ...(base.server ?? {}), port: ${port}, strictPort: true } };\n`,
  );
  const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [vite, '--port', String(port), '--strictPort', '--config', config], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const url = `http://localhost:${port}/`;
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`vite exited:\n${log}`);
    try {
      if ((await fetch(url)).ok) return { url, stop: () => (child.kill(), removeTempDir(tmp, "the dev server's temp folder")) };
    } catch {}
    await sleep(500);
  }
  child.kill();
  throw new Error(`vite did not answer on ${url}:\n${log}`);
}

// --- the browser over CDP -----------------------------------------------------------------------------

function findChrome() {
  if (opts.chrome) return opts.chrome;
  if (process.env.CHROME) return process.env.CHROME;
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('No Chrome or Edge found: pass --chrome <path> or set CHROME.');
  return found;
}

/** Runs before any page script: counts audio contexts and keeps every media element the page makes. */
const PROBE = `(() => {
  const P = { contexts: 0, offline: 0, media: [] };
  Object.defineProperty(window, '__audioProbe', { value: P });
  const wrap = (name, onNew) => {
    const C = window[name];
    if (typeof C !== 'function') return;
    window[name] = new Proxy(C, { construct(t, args) { const o = new t(...args); onNew(o); return o; } });
  };
  wrap('AudioContext', () => P.contexts++);
  wrap('webkitAudioContext', () => P.contexts++);
  wrap('OfflineAudioContext', () => P.offline++);
  wrap('Audio', (el) => P.media.push(el));
  P.music = () => P.media.map((el) => ({
    file: decodeURIComponent(String(el.currentSrc || el.src).split('/').pop() || ''),
    volume: el.volume, muted: el.muted, paused: el.paused, time: el.currentTime,
  }));
  P.playing = () => P.music().filter((m) => !m.paused);
})();`;

class Browser {
  static async launch() {
    const port = 9339 + Math.floor(Math.random() * 400);
    const profile = mkdtempSync(path.join(os.tmpdir(), 'iceberg-audio-e2e-profile-'));
    const args = [
      ...(opts.headed ? [] : ['--headless=new']),
      '--mute-audio',
      '--autoplay-policy=document-user-activation-required',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []),
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--window-size=1280,720',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ];
    const proc = spawn(findChrome(), args, { stdio: 'ignore' });
    let ws = null;
    for (let i = 0; i < 100 && !ws; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = list.find((t) => t.type === 'page');
        if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
      } catch {}
      if (!ws) await sleep(200);
    }
    if (!ws) throw new Error('the browser did not open its debugging port');
    await new Promise((r, j) => {
      ws.addEventListener('open', r, { once: true });
      ws.addEventListener('error', j, { once: true });
    });
    const b = new Browser(proc, ws, profile);
    try {
      b.version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).Browser ?? '';
    } catch {
      b.version = '';
    }
    await b.send('Runtime.enable');
    await b.send('Log.enable');
    await b.send('Page.enable');
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    if (opts.cpuThrottle > 1) await b.send('Emulation.setCPUThrottlingRate', { rate: opts.cpuThrottle });
    await b.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
    return b;
  }

  constructor(proc, ws, profile) {
    this.proc = proc;
    this.ws = ws;
    this.profile = profile;
    this.id = 0;
    this.pending = new Map();
    this.console = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg);
        this.pending.delete(msg.id);
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
        this.console.push({ level: msg.params.type, text: text.slice(0, 500) });
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        this.console.push({ level: 'exception', text: String(d.exception?.description ?? d.text).slice(0, 800) });
      } else if (msg.method === 'Log.entryAdded') {
        this.console.push({ level: `log.${msg.params.entry.level}`, text: `${msg.params.entry.text} ${msg.params.entry.url ?? ''}`.slice(0, 500) });
      }
    });
  }

  send(method, params = {}) {
    return new Promise((resolve) => {
      const id = ++this.id;
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluate an expression in the page (promises awaited, the value returned as JSON). */
  async evaluate(expression, timeoutMs = 120000) {
    const r = await Promise.race([
      this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
      sleep(timeoutMs).then(() => null),
    ]);
    if (r === null) throw new Error(`evaluate timed out after ${timeoutMs} ms: ${expression.slice(0, 120)}`);
    if (r.result?.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error(`page: ${d.exception?.description ?? d.text}`);
    }
    return r.result?.result?.value;
  }

  /** Call a page-side function with JSON arguments. */
  call(fn, ...args) {
    return this.evaluate(`(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`);
  }

  async until(cond, ms = 30000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try {
        if (await this.evaluate(`!!(${cond})`, 10000)) return Date.now() - t0;
      } catch {}
      await sleep(100);
    }
    return -1;
  }

  /** A trusted key press. */
  async key(key, { code, vk, shift = false } = {}) {
    const KEYS = { Escape: 27, Tab: 9, ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38, ArrowDown: 40, Enter: 13, ' ': 32 };
    const printable = key.length === 1;
    const windowsVirtualKeyCode = vk ?? KEYS[key] ?? (printable ? key.toUpperCase().charCodeAt(0) : 0);
    const c = code ?? (key === ' ' ? 'Space' : printable ? `Key${key.toUpperCase()}` : key);
    const modifiers = shift ? 8 : 0;
    const base = { key, code: c, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode, modifiers };
    await this.send('Input.dispatchKeyEvent', printable ? { type: 'keyDown', text: key, ...base } : { type: 'rawKeyDown', ...base });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  /** A trusted click at a point (the page's top-left corner by default: no control there). */
  async click(x = 4, y = 4) {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
    }
  }

  /** A trusted click on the centre of the first `selector` whose text matches `re`. */
  async clickText(selector, re) {
    const box = await this.evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => new RegExp(${JSON.stringify(re.source)}).test(x.textContent.trim())); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (!box) throw new Error(`no ${selector} matching ${re}`);
    await this.click(box.x, box.y);
    return box;
  }

  /** A fresh document at url with a seeded profile (a new document has no user activation). */
  async load(url, seed = {}) {
    await this.send('Page.navigate', { url: pageUrl(url) });
    await this.until('document.readyState === "complete"', FIRST_RENDER_MS);
    await this.call(seedProfile, seed);
    this.console.length = 0;
    await this.send('Page.reload', { ignoreCache: false });
    await sleep(500);
    const ms = await this.until('document.querySelector(".app") !== null', FIRST_RENDER_MS);
    if (ms < 0) throw notRendered();
    await sleep(800);
  }

  async close() {
    try {
      this.ws.close();
    } catch {}
    const exited = this.proc.exitCode !== null || this.proc.signalCode !== null ? Promise.resolve() : new Promise((r) => this.proc.once('exit', r));
    this.proc.kill();
    await Promise.race([exited, sleep(5000)]);
    await sleep(600);
    if (!opts.keepProfile) removeTempDir(this.profile, 'the browser profile');
  }
}

/**
 * Chrome's helper processes can hold files in the profile for a moment after the browser has gone (on
 * Windows a plain rmSync once failed with EPERM after every check had passed, and the run's JSON and
 * summary were lost); the dev server's dependency cache is removed the same way. Retried for 8-10 s,
 * then left in the temp folder with a warning: a leftover folder must never cost a run its results.
 */
function removeTempDir(dir, what) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  } catch (err) {
    console.warn(`  (${what} ${dir} could not be removed: ${err?.code ?? err}; left in the temp folder)`);
  }
}

// --- page-side functions (serialised with toString: no closures over Node variables) --------------------

function seedProfile(seed) {
  localStorage.clear();
  const settings = { skipIntros: true, unlockAllLevels: true, quality: 'low', mouseSteering: false, ...(seed.settings ?? {}) };
  localStorage.setItem('iceberg-river.settings.v1', typeof seed.rawSettings === 'string' ? seed.rawSettings : JSON.stringify(settings));
  localStorage.setItem(
    'iceberg-river.story.v1',
    JSON.stringify({ version: 1, completed: seed.storyCompleted ?? [], archive: [], settings: { narrative: seed.narrative ?? true, ai: 'off' } }),
  );
  if (seed.progress) localStorage.setItem('iceberg-river.progress.v1', JSON.stringify(seed.progress));
  return true;
}

/** The app's stores and the audio port, by the same /src URLs the app loaded them from. */
async function appModules() {
  const [app, game, story, engine] = await Promise.all([
    import('/src/state/appStore.ts'),
    import('/src/state/gameStore.ts'),
    import('/src/state/storyStore.ts'),
    import('/src/audio/game/engine.ts'),
  ]);
  return { app: app.useAppStore, game: game.useGameStore, story: story.useStoryStore, engine };
}

async function nav(action) {
  const { useAppStore } = await import('/src/state/appStore.ts');
  const s = useAppStore.getState();
  if (action.level) s.playLevel(action.level);
  else if (action.chapterCard) s.openChapter(action.chapterCard);
  else if (action.chapter) s.playChapter(action.chapter, false);
  else if (action.screen) s.goTo(action.screen);
  else if (action.settings) s.updateSettings(action.settings);
  return useAppStore.getState().screen;
}

/** Install the recording engine (bridge evidence); the context clock follows the page's clock. */
async function installRecorder() {
  if (window.__audioRec) return true;
  const [eng, rec] = await Promise.all([import('/src/audio/game/engine.ts'), import('/src/audio/game/testing/recording.ts')]);
  const m = new rec.RecordingAudioManager();
  const off = eng.installAudioEngine(m);
  window.__audioRec = { m, off };
  const tick = () => {
    m.clock = performance.now() / 1000;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return eng.audioEngine() === m;
}

/**
 * Autopilot at `speed` × real time: each animation frame adds speed − 1 fixed steps on top of the
 * game loop's own, so the 3D view and its sound bridge still run every frame. Ends on complete,
 * failed, or after maxSec of wall clock.
 */
function drive(o) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let frames = 0;
    const done = (why) => {
      const h = window.__iceberg;
      const s = h ? h.snapshot() : null;
      resolve({ why, frames, wallSec: (performance.now() - t0) / 1000, phase: s?.phase ?? 'gone', time: s?.time ?? 0, s: s?.course?.s ?? 0 });
    };
    const step = () => {
      const h = window.__iceberg;
      if (!h) return done('gone');
      h.autopilot(true, o.lane ?? 0);
      let snap = h.snapshot();
      if (snap.phase === 'complete' || snap.phase === 'failed') return done(snap.phase);
      if ((performance.now() - t0) / 1000 > o.maxSec) return done('time');
      if (o.untilSec && snap.time >= o.untilSec) return done('untilSec');
      if (snap.phase === 'playing' && o.speed > 1) snap = h.fastForward((o.speed - 1) / 60);
      frames++;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/** The current recorder session against the run's own event log (bridge evidence, page-side). */
function bridgeSummary(o) {
  const rec = window.__audioRec;
  const h = window.__iceberg;
  if (!rec || !h) return { error: !rec ? 'no recorder' : 'no game' };
  const m = rec.m;
  const sess = m.sessions[m.sessions.length - 1];
  const log = h.runLog().events;
  const traces = sess.traces;
  const byCause = new Map();
  for (const t of traces) {
    if (t.cause < 0) continue;
    let a = byCause.get(t.cause);
    if (!a) byCause.set(t.cause, (a = []));
    a.push(t);
  }
  const overflowTraces = traces.filter((t) => t.kind === 'drop' && t.reason === 'overflow');
  const overflowed = overflowTraces.reduce((n, t) => n + Number((/(\d+) events/.exec(t.note ?? '') ?? [0, 0])[1]), 0);
  const types = {};
  let traced = 0;
  let ended = 0;
  let typeMismatch = 0;
  const unended = [];
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    types[e.type] = (types[e.type] ?? 0) + 1;
    const ts = byCause.get(i + 1) ?? [];
    const ev = ts.find((t) => t.kind === 'event');
    if (!ev) continue;
    traced++;
    if (ev.ev !== e.type) typeMismatch++;
    const ok = ev.note === 'no sound by design' || ts.some((t) => t.kind === 'play' || t.kind === 'coalesce' || (t.kind === 'drop' && t.reason));
    if (ok) ended++;
    else if (unended.length < 10) unended.push({ seq: i + 1, type: e.type });
  }
  const drops = {};
  for (const t of traces) if (t.kind === 'drop' && t.reason) drops[t.reason] = (drops[t.reason] ?? 0) + 1;
  const perFrame = new Map();
  for (const t of traces) if (t.kind === 'event') perFrame.set(t.frame, (perFrame.get(t.frame) ?? 0) + 1);
  const maxEventsInFrame = Math.max(0, ...perFrame.values());
  const reqFrame = new Map();
  for (const p of sess.plays) reqFrame.set(p.frame, (reqFrame.get(p.frame) ?? 0) + 1);
  const maxRequestsInFrame = Math.max(0, ...reqFrame.values());
  const families = {};
  const sounds = {};
  for (const p of sess.plays) {
    if (p.reason !== null) continue;
    families[p.family] = (families[p.family] ?? 0) + 1;
    for (const l of p.layers) sounds[l.sound] = (sounds[l.sound] ?? 0) + 1;
  }
  // Hits and breaks with their inputs, for the magnitude checks (S4).
  const eventTrace = (cause) => (byCause.get(cause) ?? []).find((t) => t.kind === 'event');
  const hits = [];
  const breaks = [];
  let kindMismatch = 0;
  for (const p of sess.plays) {
    const e = log[p.cause - 1];
    const ev = eventTrace(p.cause);
    if (!e || !ev) continue;
    const peak = Math.max(...p.layers.map((l) => l.gainDb));
    if (p.family === 'hit' && e.type === 'collision') {
      hits.push({ kind: ev.note, sound: p.layers[0].sound, gainDb: p.layers[0].gainDb, impulse: e.impulse, relSpeed: e.relSpeed, m: ev.input?.m ?? null });
    } else if (e.type === 'obstacleBroken' || e.type === 'treeFelled') {
      // key −1: a later body of a placement already heard breaking (an F2 add-on, 9 dB under the break).
      breaks.push({ kind: ev.note, family: p.family, sounds: p.layers.map((l) => l.sound), peakDb: peak, massT: ev.input?.massT ?? null, addOn: p.key === -1 });
    }
  }
  const K = window.__kindSounds;
  if (K) for (const hit of hits) if (hit.kind && K[hit.kind] && ![K[hit.kind].hit, K[hit.kind].hitHeavy].includes(hit.sound)) kindMismatch++;
  const strikes = sess.bells.filter((b) => b.form === 'strike');
  const notes = traces.filter((t) => typeof t.note === 'string' && /^bell-/.test(t.note)).map((t) => ({ frame: t.frame, t: +t.t.toFixed(2), gt: +t.gt.toFixed(2), note: t.note }));
  return {
    token: sess.token,
    level: sess.info.levelId,
    mode: sess.info.mode,
    chapter: sess.info.chapterId,
    events: log.length,
    types,
    traced,
    ended,
    overflowed,
    typeMismatch,
    unended,
    drops,
    requests: sess.plays.length,
    admitted: sess.plays.filter((p) => p.reason === null).length,
    maxEventsInFrame,
    maxRequestsInFrame,
    maxAdmittedInFrame: sess.maxAdmittedInFrame,
    maxLayers: Math.max(0, ...sess.plays.map((p) => p.layers.length)),
    families,
    sounds,
    hits,
    breaks,
    kindMismatch,
    bells: {
      strikes: strikes.length,
      byVoicing: strikes.reduce((a, b) => ((a[b.voicing] = (a[b.voicing] ?? 0) + 1), a), {}),
      shivers: sess.bells.filter((b) => b.form === 'shiver').length,
      clanks: sess.bells.filter((b) => b.form === 'clank').length,
      list: sess.bells.map((b) => ({ slot: b.slot, voicing: b.voicing, form: b.form, frame: b.frame, when: +b.when.toFixed(2), choked: b.choked })),
      notes,
    },
    ducks: sess.ducks.map((d) => ({ key: d.key, music: d.levels?.music ?? null, frame: d.frame })),
    phases: sess.phases,
    sessionEnded: sess.ended,
    endCalls: sess.endCalls,
    ambience: sess.ambience ? { ...sess.ambience.counts } : null,
  };
}

/** Page-side: the autopilot at 6x on a lane until the run ends; every collision event's kind, J and v. */
function collisions(o) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const step = () => {
      const h = window.__iceberg;
      h.autopilot(true, o.lane);
      const s = h.snapshot();
      if (s.phase === 'complete' || s.phase === 'failed' || performance.now() - t0 > o.maxSec * 1000) {
        const ev = h.runLog().events.filter((e) => e.type === 'collision').map((e) => ({ kind: e.kind, J: e.impulse, v: e.relSpeed }));
        return resolve({ phase: s.phase, time: s.time, ev });
      }
      if (s.phase === 'playing') h.fastForward(5 / 60);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/** Pairs of (the iceberg's horizontal speed, the speed the scrape voice was last told), every 100 ms. */
function scrapeTrack(sec) {
  return new Promise((resolve) => {
    const out = [];
    const t0 = performance.now();
    const tick = () => {
      const h = window.__iceberg;
      const s = window.__audioRec?.m.sessions.at(-1);
      const last = s?.ambience?.last?.scrape;
      if (h && last) {
        const snap = h.snapshot();
        out.push({ ice: snap.speed, scrape: last.speed, onLand: last.onLand, airborne: last.airborne, mass: last.massT, radius: last.radius, ground: last.ground });
      }
      if (performance.now() - t0 > sec * 1000) return resolve(out);
      setTimeout(tick, 100);
    };
    tick();
  });
}

/** The recorder's app-level view: sessions, router (cue, holds, ducks), app ducks, motifs, bake sets. */
function recorderState() {
  const m = window.__audioRec?.m;
  if (!m) return null;
  return {
    sessions: m.sessions.map((s) => ({
      token: s.token,
      level: s.info.levelId,
      mode: s.info.mode,
      chapter: s.info.chapterId,
      ended: s.ended,
      endCalls: s.endCalls,
      plays: s.plays.length,
      admitted: s.plays.filter((p) => p.reason === null).length,
      bells: s.bells.length,
      ducks: s.ducks.map((d) => d.key + (d.levels ? '' : ':off')),
      calve: s.plays.filter((p) => p.family === 'calve').map((p) => ({ sound: p.layers[0].sound, gainDb: +p.layers[0].gainDb.toFixed(1), frame: p.frame })),
    })),
    cue: m.music.cue,
    trimDb: m.music.trimDb,
    holds: [...m.music.holds],
    routerDucks: Object.fromEntries(m.music.ducks),
    routerCalls: m.music.calls.slice(),
    appDucks: m.ducks.map((d) => ({ key: d.key, on: d.levels !== null, music: d.levels?.music ?? null })),
    motifs: m.motifs.map((x) => ({ variant: x.motif.variant, tempoScale: x.motif.tempoScale, delaySec: x.delaySec, at: +x.at.toFixed(2), stopped: x.stopped })),
    prepared: m.prepared.map((p) => ({ sounds: p.sounds.length, bells: p.bells, motifs: p.motifs.map((x) => x.variant) })),
    now: m.clock,
  };
}

/**
 * Sample the media elements every `everyMs` until `until` (a predicate source over them) is true or
 * maxMs passes. With `screen`, the clock starts as the page itself goes to that screen.
 */
async function watchMusic(o) {
  const store = o.screen ? (await import('/src/state/appStore.ts')).useAppStore : null;
  return new Promise((resolve) => {
    const t0 = performance.now();
    if (store) store.getState().goTo(o.screen);
    const pred = new Function('m', `return (${o.until});`);
    const tick = () => {
      const m = window.__audioProbe.music();
      const t = performance.now() - t0;
      if (pred(m)) return resolve({ ms: t, music: m });
      if (t > o.maxMs) return resolve({ ms: -1, music: m });
      setTimeout(tick, o.everyMs ?? 25);
    };
    tick();
  });
}

// --- checks --------------------------------------------------------------------------------------------

const near = (a, b, tol) => typeof a === 'number' && Math.abs(a - b) <= tol;
/** A level for the report: digital silence (−Infinity) would print as null in JSON. */
const dbText = (x) => (Number.isFinite(x) ? +x.toFixed(1) : String(x));
const db = (x) => 20 * Math.log10(x);

class Scenario {
  constructor(id, title, kind) {
    this.id = id;
    this.title = title;
    this.kind = kind;
    this.checks = [];
    this.notes = [];
    this.data = {};
  }
  check(name, pass, value, expect) {
    this.checks.push({ name, pass: Boolean(pass), value, expect });
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}  (${JSON.stringify(value)}${expect !== undefined ? ` vs ${expect}` : ''})`);
  }
  na(name, why) {
    this.checks.push({ name, pass: null, value: null, expect: why });
    console.log(`  n/a   ${name}  (${why})`);
  }
  note(text) {
    this.notes.push(text);
    console.log(`  note  ${text}`);
  }
}

const playingPhase = 'window.__iceberg && window.__iceberg.snapshot().phase === "playing"';
const engineState = () => 'window.__icebergAudio ? window.__icebergAudio.state() : null';

/**
 * Page-side: wait until the AudioContext's clock has advanced `ms` (headless Chrome runs it slower
 * than the wall clock: 0.84x in S0 on this laptop, so a wall-clock window holds less audio than it
 * says). Gives up after 6x `ms` of wall time. Returns the context and wall seconds that passed.
 */
async function ctxWait(ms) {
  const { audio } = await import('/src/audio/manager.ts');
  const c0 = audio.now();
  const w0 = performance.now();
  while (audio.now() - c0 < ms / 1000 && performance.now() - w0 < 6 * ms) await new Promise((r) => setTimeout(r, 10));
  return { ctxSec: audio.now() - c0, wallSec: (performance.now() - w0) / 1000 };
}

/**
 * Per-bus peak and RMS (dBFS) over the next `ms` of AUDIO time (the context's clock, see ctxWait).
 * The engine's meter reports what it saw since its last call (and only starts sampling at its first),
 * so it is read once to open the window; digital silence (−Infinity) cannot cross CDP by value, so
 * the numbers come back as text.
 */
async function meterOver(b, ms) {
  await b.evaluate('(window.__icebergAudio.meter(), true)');
  await b.call(ctxWait, ms);
  const text = await b.evaluate(
    'JSON.stringify(Object.entries(window.__icebergAudio.meter()).map(([k, v]) => [k, String(v.peakDb), String(v.rmsDb)]))',
  );
  return Object.fromEntries(JSON.parse(text).map(([k, p, r]) => [k, { peakDb: Number(p), rmsDb: Number(r) }]));
}

async function enterLevel(b, level) {
  await b.call(nav, { level });
  const ms = await b.until(playingPhase, 90000);
  if (ms < 0) throw new Error(`${level} never reached play`);
  return ms;
}

async function consoleProblems(b, sc) {
  const bad = b.console.filter((c) => /not allowed to start|AudioContext was not allowed/i.test(c.text));
  sc.check('no "AudioContext was not allowed to start" warning', bad.length === 0, bad.length, 0);
  const errors = b.console.filter((c) => c.level === 'error' || c.level === 'exception' || c.level === 'log.error');
  const audioErrors = errors.filter((c) => /audio|sound|bell|motif|music/i.test(c.text));
  sc.check('no audio errors in the console', audioErrors.length === 0, audioErrors.map((c) => c.text.slice(0, 160)), '[]');
  if (errors.length > audioErrors.length) sc.note(`other console errors: ${errors.filter((c) => !audioErrors.includes(c)).map((c) => c.text.slice(0, 120)).join(' | ')}`);
}

// --- scenarios -------------------------------------------------------------------------------------------

const ARCADE_LEVELS = ['mountain-valley', 'rocky-canyon', 'alpine-pass', 'riverside-town', 'glacier-avalanche', 'power-valley', 'ravine-run', 'highland-maze', 'summit-labyrinth'];
const CHURCH_LEVELS = { 'alpine-pass': ['pass-chapel'], 'riverside-town': ['st-brides'], 'highland-maze': ['clachan-kirk', 'loch-kirk'], 'summit-labyrinth': ['fjord-chapel'] };
/** Arcade's el.volume: music 0.6, the bed -2 dB, and K.545's own loudness cut (src/audio/tracks.ts). */
const ARCADE_BED = 0.6 * 10 ** (-2 / 20);
/** A recording's loudness cut (dB) as the page's player applies it (recordingGainDb of tracks.ts). */
const recordingCutDb = (b, cue) => b.evaluate(`(async () => (await import('/src/audio/tracks.ts')).recordingGainDb(${JSON.stringify(cue)}))()`);
/**
 * Autopilot lanes (m off the level's line) that reach what the default lines never do. A headless
 * sweep of lanes -24 ... 24 on four levels (SEED 42): Mountain Valley at +8 fells a pine at 9.8 s and
 * strikes the stone barrier four times at 20.4 s (then fails); at +16 it fells two trees and completes.
 */
const RARE_LANES = [
  { level: 'mountain-valley', lane: 8 },
  { level: 'mountain-valley', lane: 16 },
];
/**
 * More lines for S4's sample of played hits (S3 and S3E, not --quick): about 30 hits per pass over the
 * nine default lines is too few to measure a rank correlation to a few hundredths (its bootstrap 95 %
 * interval was 0.68-0.94 at n = 36).
 */
const S4_LANES = ARCADE_LEVELS.flatMap((level) => [-8, 8].map((lane) => ({ level, lane }))).filter((x) => !RARE_LANES.some((r) => r.level === x.level && r.lane === x.lane));
/**
 * S4_LANES runs (the ±8 m lanes). Not a held-out set: S4M scored the candidate mappings on every
 * collision of lanes 0, ±8 and ±16 of all nine levels, the ±8 m lanes included, and the physics is
 * deterministic per level, lane and seed, so the gate (COLLISION_MAG.jGate) was chosen on these
 * collisions too. Reported apart only as a split of the sample.
 */
const s4LaneRun = (name) => S4_LANES.some((x) => name === `${x.level} lane ${x.lane}`);

/** Node's bank checksum of S13's set (core plus house.collapse, dam.break, glass.break, clachan-kirk). */
const NODE_BANK_CHECKSUM = '74a0ca9e';
/** Node's pcmHash of every motif the game plays (src/audio/synth/motifRender.test.ts PINNED). */
const NODE_MOTIF_HASHES = {
  'act1@1': 'de157a25',
  'act1@0.94': '1c8cd626',
  'act2@1': '0e6cf86b',
  'act3@1': 'b996e105',
  'act3-bare@1': 'b8aadbda',
  'ch8@1': '546a9fc9',
  'epilogue@1': '336c5177',
};

const SCENARIOS = {
  async S1(b, sc) {
    await b.load(opts.url);
    await sleep(2000);
    const before = await b.evaluate('({ contexts: __audioProbe.contexts, offline: __audioProbe.offline, media: __audioProbe.media.length, active: navigator.userActivation.hasBeenActive })');
    sc.check('before any gesture: no AudioContext constructed', before.contexts === 0 && before.offline === 0, before, '0 and 0');
    sc.check('before any gesture: no music element', before.media === 0, before.media, 0);
    const hasEngine = await b.evaluate('!!window.__icebergAudio');
    sc.data.engine = hasEngine;
    await b.key('Escape');
    await sleep(300);
    if (hasEngine) {
      const st = await b.evaluate('window.__icebergAudio.state().status');
      sc.check('after Escape (no activation): not running', st !== 'running', st, '!= running');
    } else sc.na('after Escape: engine status', 'engine not installed (package A)');
    await b.click();
    if (hasEngine) {
      const ms = await b.until('window.__icebergAudio.state().status === "running"', 2000);
      sc.check('after a click: running within 500 ms', ms >= 0 && ms <= 500, ms, '<= 500 ms');
      const n = await b.evaluate('__audioProbe.contexts');
      sc.check('one AudioContext', n === 1, n, 1);
    } else {
      const n = await b.evaluate('__audioProbe.contexts');
      sc.check('the stand-in engine constructs nothing, even after a gesture', n === 0, n, 0);
      sc.na('after a click: running within 500 ms', 'engine not installed (package A)');
    }
    // The music unlocked on that click: entering Arcade play starts K.545 without another gesture.
    await enterLevel(b, 'mountain-valley');
    const w = await b.call(watchMusic, { until: 'm.some((x) => !x.paused && /k545/.test(x.file))', maxMs: 8000 });
    sc.check('the music was unlocked by the first click (K.545 plays in Arcade)', w.ms >= 0, w.music, 'K.545 playing');
    await consoleProblems(b, sc);
  },

  async S2(b, sc) {
    await b.load(opts.url);
    await b.click();
    await enterLevel(b, 'mountain-valley');
    await b.evaluate('window.__iceberg.autopilot(true, 0), true');
    await sleep(4000);
    const music = await b.evaluate('__audioProbe.playing()');
    sc.data.music = music;
    sc.check('Arcade plays one recording', music.length === 1, music.length, 1);
    sc.check('it is the wonder cue (Mozart K.545)', /mozart-k545/.test(music[0]?.file ?? ''), music[0]?.file, 'mozart-k545-allegro.mp3');
    const arcadeVolume = ARCADE_BED * 10 ** ((await recordingCutDb(b, 'wonder')) / 20);
    sc.check("el.volume = 0.6 × 10^(−2/20) × K.545's loudness cut, after the fade (Arcade sits 2 dB under the effects)", near(music[0]?.volume, arcadeVolume, 0.01), music[0]?.volume, arcadeVolume.toFixed(4));
    const st = await b.evaluate(engineState());
    if (st) {
      sc.check('engine: cue wonder', st.music.cue === 'wonder', st.music.cue, 'wonder');
      const meter = await meterOver(b, 1000);
      sc.data.meter = meter;
      sc.check('engine: ambience bus above −50 dBFS RMS while playing (1 s window)', meter.ambience.rmsDb > -50, meter.ambience.rmsDb, '> −50');
    } else sc.na('engine: buses and meters', 'engine not installed (package A)');
    // Leaving play: the cue goes to null; the player's own 3 s fade, then pause.
    const w = await b.call(watchMusic, { screen: 'levelSelect', until: 'm.every((x) => x.paused)', maxMs: 6000, everyMs: 20 });
    sc.check('quitting to the menu: the music fades and pauses within 3.0–3.3 s', w.ms >= 2900 && w.ms <= 3300, Math.round(w.ms), '3000–3300 ms');
    await consoleProblems(b, sc);
  },

  async S6(b, sc) {
    await b.load(opts.url);
    await b.click();
    await b.call(nav, { screen: 'settings' });
    await b.until('document.querySelector(\'input[type="range"]\')', 5000);
    const focusSlider = async (label) => {
      for (let i = 0; i < 80; i++) {
        const at = await b.evaluate(`(() => { const a = document.activeElement; const id = a && a.getAttribute('aria-labelledby'); return id ? document.getElementById(id)?.textContent : (a?.textContent ?? '').slice(0, 40); })()`);
        if (at === label) return i;
        await b.key('Tab');
      }
      return -1;
    };
    const steps = { 'Master volume': 4, 'Music volume': 2, 'Ambience volume': 4, 'Effects volume': 6 };
    for (const [label, n] of Object.entries(steps)) {
      const tabs = await focusSlider(label);
      sc.check(`${label}: reached by Tab`, tabs >= 0, tabs, '>= 0 presses');
      const ring = await b.evaluate(`(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle + ' ' + s.outlineWidth; })()`);
      sc.check(`${label}: visible focus ring`, !/^none/.test(ring), ring, 'an outline');
      for (let i = 0; i < n; i++) await b.key('ArrowLeft');
      // A player lets go and listens before the next slider: the previews are throttled to one per
      // 0.4 s (audio time), so without this pause the Effects preview fell inside the Ambience one's.
      await sleep(700);
    }
    // The previews (a cold start: no level with a church has been played; the core keeps St Bride's strike).
    if (await b.evaluate('!!window.__icebergAudio')) {
      const previews = await b.evaluate(`window.__icebergAudio.trace().filter((e) => /^preview /.test(e.note ?? '')).map((e) => e.note)`);
      sc.check('engine: releasing Ambience previews a church bell from a cold start (the core keeps St Bride’s strike)', previews.includes('preview ambience'), previews);
      sc.check('engine: releasing Effects previews a stone hit', previews.includes('preview effects'), previews);
    } else sc.na('engine: the slider previews', 'engine not installed (package A)');
    const settings = await b.evaluate('JSON.parse(localStorage.getItem("iceberg-river.settings.v1"))');
    const want = { masterVolume: 0.8, musicVolume: 0.5, ambienceVolume: 0.6, effectsVolume: 0.5 };
    for (const [k, v] of Object.entries(want)) sc.check(`arrow keys set and save ${k}`, near(settings[k], v, 1e-6), settings[k], v);
    const valuetext = await b.evaluate(`[...document.querySelectorAll('input[type="range"]')].slice(1).map((e) => e.getAttribute('aria-valuetext'))`);
    sc.check('sliders read out in percent', JSON.stringify(valuetext) === JSON.stringify(['80 percent', '50 percent', '60 percent', '50 percent']), valuetext);
    // Mute all sound: the last switch, by keyboard.
    for (let i = 0; i < 20; i++) {
      const lab = await b.evaluate(`(() => { const a = document.activeElement; const id = a && a.getAttribute('aria-labelledby'); return id ? document.getElementById(id)?.textContent : ''; })()`);
      if (lab === 'Mute all sound') break;
      await b.key('Tab');
    }
    await b.key(' ');
    sc.check('Space on "Mute all sound" mutes', (await b.evaluate('JSON.parse(localStorage.getItem("iceberg-river.settings.v1")).soundMuted')) === true, true);
    await b.key(' ');
    // In play: the music follows master × music × the Arcade bed.
    await enterLevel(b, 'mountain-valley');
    await b.evaluate('window.__iceberg.autopilot(true, 0), true');
    await sleep(4000);
    const expect = 0.8 * 0.5 * 10 ** (-2 / 20) * 10 ** ((await recordingCutDb(b, 'wonder')) / 20);
    const music = await b.evaluate('__audioProbe.playing()');
    sc.check("el.volume = master × music × 10^(−2/20) × the recording's loudness cut", near(music[0]?.volume, expect, 0.005), music[0]?.volume, expect.toFixed(4));
    const st = await b.evaluate(engineState());
    if (st) {
      sc.check('engine: bus gains follow the settings', near(st.buses.ambience, 0.6, 1e-3) && near(st.buses.effects, 0.5, 1e-3) && near(st.buses.master, 0.8, 1e-3), st.buses, 'ambience 0.6, effects 0.5, master 0.8');
    } else sc.na('engine: bus gains', 'engine not installed (package A)');
    // M in play. First, the meter must hear the game, or "silent" afterwards would prove nothing.
    const heard = st ? await meterOver(b, 500) : null;
    if (heard) sc.check('engine: the master meter hears the game before M', heard.master.rmsDb > -80, heard.master.rmsDb, '> −80');
    await b.key('m');
    const off = await b.call(watchMusic, { until: 'm.every((x) => x.paused || x.muted)', maxMs: 1000, everyMs: 10 });
    const live1 = await b.evaluate('document.querySelector(\'[data-testid="sound-announcement"]\').textContent');
    sc.check('M mutes all sound: the music stops at once (≤ 150 ms)', off.ms >= 0 && off.ms <= 150, Math.round(off.ms), '<= 150 ms');
    sc.check('M is announced in the live region', live1.trim() === 'Sound off', live1);
    sc.check('M is saved', (await b.evaluate('JSON.parse(localStorage.getItem("iceberg-river.settings.v1")).soundMuted')) === true, true);
    if (st) {
      // The window from 150 ms after M to 350 ms after it (audio time).
      await b.call(ctxWait, 150);
      const muted = await meterOver(b, 200);
      sc.check('engine: master below −100 dBFS from 150 ms after M', muted.master.rmsDb < -100, dbText(muted.master.rmsDb), '< −100');
    }
    await b.key('m');
    const on = await b.call(watchMusic, { until: 'm.some((x) => !x.paused && !x.muted)', maxMs: 4000 });
    const live2 = await b.evaluate('document.querySelector(\'[data-testid="sound-announcement"]\').textContent');
    sc.check('M again: the music comes back', on.ms >= 0, Math.round(on.ms));
    sc.check('…announced "Sound on"', live2.trim() === 'Sound on', live2);
    // Persisted across a reload; garbage loads the defaults.
    await b.send('Page.reload', {});
    if ((await b.until('document.querySelector(".app") !== null', FIRST_RENDER_MS)) < 0) throw notRendered();
    await sleep(800);
    const kept = await b.call(async () => (await import('/src/state/appStore.ts')).useAppStore.getState().settings);
    sc.check('the settings persist across a reload', near(kept.masterVolume, 0.8, 1e-9) && near(kept.effectsVolume, 0.5, 1e-9) && kept.soundMuted === false, { masterVolume: kept.masterVolume, effectsVolume: kept.effectsVolume, soundMuted: kept.soundMuted });
    await b.load(opts.url, { rawSettings: '{"masterVolume":"loud","ambienceVolume":-3,"effectsVolume":7,"soundMuted":"yes"}' });
    const fixed = await b.call(async () => (await import('/src/state/appStore.ts')).useAppStore.getState().settings);
    sc.check('garbage settings load as defaults (or clamped)', fixed.masterVolume === 1 && fixed.ambienceVolume === 0 && fixed.effectsVolume === 1 && fixed.soundMuted === false, { masterVolume: fixed.masterVolume, ambienceVolume: fixed.ambienceVolume, effectsVolume: fixed.effectsVolume, soundMuted: fixed.soundMuted });
    await consoleProblems(b, sc);
  },

  async S7(b, sc) {
    await b.load(opts.url);
    await b.click();
    await enterLevel(b, 'mountain-valley');
    await b.evaluate('window.__iceberg.autopilot(true, 0), true');
    await sleep(4000);
    const v0 = (await b.evaluate('__audioProbe.playing()'))[0]?.volume ?? 0;
    const paused = v0 * 10 ** (-8 / 20);
    await b.key('Escape');
    const p = await b.call(watchMusic, { until: `m.some((x) => !x.paused && Math.abs(x.volume - ${paused}) < ${paused * 0.035})`, maxMs: 2000, everyMs: 10 });
    sc.check('Esc: the music dips 8 dB within 400 ms', p.ms >= 0 && p.ms <= 400, { ms: Math.round(p.ms), volume: p.music.find((x) => !x.paused)?.volume }, `${paused.toFixed(4)} in <= 400 ms`);
    sc.check('…and the game is paused', (await b.evaluate('window.__iceberg.snapshot().phase')) === 'paused', 'paused');
    const st = await b.evaluate(engineState());
    if (st) sc.check('engine: effects and ambience gated (gate → 0 within 200 ms)', st.buses.gate < 0.01, st.buses.gate, '< 0.01');
    else sc.na('engine: the pause gate on effects and ambience', 'engine not installed (package A)');
    await b.key('Escape');
    const r = await b.call(watchMusic, { until: `m.some((x) => !x.paused && Math.abs(x.volume - ${v0}) < ${v0 * 0.035})`, maxMs: 2000, everyMs: 10 });
    sc.check('resume: back to the play level within 0.8 s', r.ms >= 0 && r.ms <= 800, Math.round(r.ms), '<= 800 ms');
    for (let i = 0; i < 10; i++) {
      await b.key('Escape');
      await sleep(100);
    }
    await sleep(1000);
    const after = { phase: await b.evaluate('window.__iceberg.snapshot().phase'), music: await b.evaluate('__audioProbe.playing()') };
    const expectVol = after.phase === 'paused' ? paused : v0;
    sc.check('10 rapid Esc presses: a consistent end state (phase and music agree)', after.music.length === 1 && near(after.music[0].volume, expectVol, expectVol * 0.035), after, `${after.phase}: ${expectVol.toFixed(4)}`);
    if (after.phase === 'paused') await b.key('Escape');
    await sleep(800);
    await b.evaluate('window.dispatchEvent(new Event("blur")), true');
    await sleep(500);
    const blur = { phase: await b.evaluate('window.__iceberg.snapshot().phase'), music: await b.evaluate('__audioProbe.playing()') };
    sc.check('window blur pauses like Esc (music at the pause level)', blur.phase === 'paused' && near(blur.music[0]?.volume, paused, paused * 0.035), blur, paused.toFixed(4));
    await consoleProblems(b, sc);
  },

  async S8(b, sc) {
    await b.load(opts.url);
    await b.click();
    sc.check('recording engine installed in the page', await b.call(installRecorder), true);
    // The dev build runs React's StrictMode: each attempt's sound is mounted, unmounted and mounted
    // again, so an attempt makes two sessions and the first is ended at once. The invariant checked
    // is the one that matters: one live session at a time, every other one ended.
    const live = (st) => st.sessions.filter((s) => s.ended === null);
    await enterLevel(b, 'riverside-town');
    await b.call(drive, { speed: 1, maxSec: 6 });
    const s1 = await b.call(recorderState);
    const first = live(s1);
    sc.check('play has one live session, Arcade, for the level', first.length === 1 && first[0].level === 'riverside-town' && first[0].mode === 'arcade', s1.sessions.map((s) => [s.token, s.level, s.ended]));
    if (s1.sessions.length > 1) sc.note(`StrictMode (dev): ${s1.sessions.length} sessions for the first attempt, ${s1.sessions.length - 1} ended at once`);
    sc.check('the session asked for sounds', first[0]?.plays > 0, { plays: first[0]?.plays, bells: first[0]?.bells });
    // The scrape follows the iceberg's real state (its own horizontal speed, mass, radius, ground).
    const track = await b.call(scrapeTrack, 5);
    const r = pearson(track.map((p) => p.ice), track.map((p) => p.scrape));
    sc.data.scrape = track;
    sc.check('the scrape is driven by the iceberg\'s real speed (Pearson r, 10 Hz, real time)', track.length >= 30 && r >= 0.95, { r: +r.toFixed(3), samples: track.length, ground: [...new Set(track.map((p) => p.ground))], massT: track[0]?.mass }, 'r >= 0.95');
    const old = first[0].token;
    await b.key('r');
    const ms = await b.until(`window.__audioRec.m.sessions.some((s) => s.token > ${old} && s.ended === null)`, 15000);
    sc.check('R (retry): a new live session', ms >= 0, ms);
    const s2 = await b.call(recorderState);
    const was = (st) => st.sessions.find((s) => s.token === old);
    sc.check('…and the old one ended with the 0.12 s fade', was(s2).ended === 0.12 && live(s2).length === 1, { ended: was(s2).ended, live: live(s2).length });
    await b.until(playingPhase, 60000);
    await b.call(drive, { speed: 1, maxSec: 3 });
    const s3 = await b.call(recorderState);
    sc.check('nothing was admitted for the old session after its end', was(s3).admitted === was(s2).admitted && was(s3).bells === was(s2).bells, { before: was(s2).admitted, after: was(s3).admitted });
    const retried = live(s3)[0].token;
    await enterLevel(b, 'mountain-valley');
    const s4 = await b.call(recorderState);
    const after = s4.sessions.find((s) => s.token === retried);
    sc.check('a level change ends the attempt\'s session', after.ended === 0.12 && live(s4).length === 1 && live(s4)[0].level === 'mountain-valley', s4.sessions.map((s) => [s.token, s.level, s.ended]));
    const nulls = s4.routerCalls.filter((c) => c === 'cue null').length;
    sc.check('Arcade music continues across retry and level change (no cue null in between)', s4.cue === 'wonder' && s4.routerCalls.slice(s4.routerCalls.indexOf('cue wonder')).every((c) => c !== 'cue null'), { cue: s4.cue, nulls });
    await b.call(nav, { screen: 'levelSelect' });
    await sleep(500);
    const s5 = await b.call(recorderState);
    sc.check('quitting to the menu ends the session and clears the cue', live(s5).length === 0 && s5.cue === null, { live: live(s5).length, cue: s5.cue });
    sc.check('every session ended, with the 0.12 s fade', s5.sessions.every((s) => s.endCalls >= 1 && s.ended === 0.12), s5.sessions.map((s) => [s.token, s.endCalls, s.ended]));
    // Story: the chapter card and the chapter's level keep the chapter's cue, as do the Story screens after it.
    await b.call(nav, { chapterCard: 'ch4-people' });
    await sleep(300);
    const c1 = await b.call(recorderState);
    await b.call(nav, { chapter: 'ch4-people' });
    await b.until(playingPhase, 90000);
    const c2 = await b.call(recorderState);
    await b.call(nav, { screen: 'levelSelect' });
    await sleep(300);
    const c3 = await b.call(recorderState);
    sc.check('Story: the chapter\'s cue on the card, in play and on the chapter list', c1.cue === 'cost' && c2.cue === 'cost' && c3.cue === 'cost', [c1.cue, c2.cue, c3.cue]);
    sc.check('Story ch4 play: the bed sits 2 dB under the card', c2.trimDb === -2 && c3.trimDb === 0, [c2.trimDb, c3.trimDb]);
    sc.check('Story session ended on leaving', live(c3).length === 0 && c3.sessions.at(-1).ended === 0.12 && c3.sessions.at(-1).chapter === 'ch4-people', c3.sessions.at(-1));
    sc.data.recorder = c3;
    await consoleProblems(b, sc);
  },

  async S3(b, sc) {
    await b.load(opts.url);
    await b.click();
    await b.call(installRecorder);
    await b.call(async () => {
      window.__kindSounds = (await import('/src/audio/contract.ts')).KIND_SOUNDS;
      return true;
    });
    // Every level on its default line, the lanes that reach trees and the stone barrier (RARE_LANES),
    // and (not with --quick) more lanes for S4's sample of hits (S4_LANES).
    const levels = opts.quick
      ? ['mountain-valley', 'riverside-town', 'power-valley'].map((level) => ({ level, lane: 0 }))
      : [...ARCADE_LEVELS.map((level) => ({ level, lane: 0 })), ...RARE_LANES, ...S4_LANES];
    const runs = [];
    for (const { level, lane } of levels) {
      await enterLevel(b, level);
      const d = await b.call(drive, { speed: 3, maxSec: 150, lane });
      const s = await b.call(bridgeSummary);
      const name = lane === 0 ? level : `${level} lane ${lane}`;
      runs.push({ drive: d, ...s, level: name });
      const coverage = s.events ? (s.ended + s.overflowed) / s.events : 1;
      console.log(`  ${name}: ${d.phase} at ${d.time.toFixed(1)} s, ${s.events} events, ${s.admitted}/${s.requests} requests, ${s.hits.length} hits, coverage ${(coverage * 100).toFixed(1)} %`);
    }
    sc.data.runs = runs.map(({ hits, breaks, ...r }) => ({ ...r, hits: hits.length, breaks: breaks.length }));
    sc.data.hits = runs.flatMap((r) => r.hits.map((h) => ({ level: r.level, ...h })));
    sc.data.breaks = runs.flatMap((r) => r.breaks.map((x) => ({ level: r.level, ...x })));
    const events = runs.reduce((n, r) => n + r.events, 0);
    const ended = runs.reduce((n, r) => n + r.ended + r.overflowed, 0);
    sc.check('100 % of events end in the trace (played, merged, or dropped with a reason)', ended === events, `${ended}/${events}`, '100 %');
    sc.check('every traced event matches the run log\'s type', runs.every((r) => r.typeMismatch === 0), runs.map((r) => r.typeMismatch));
    sc.check('hits play their kind\'s sound (KIND_SOUNDS)', runs.every((r) => r.kindMismatch === 0), runs.map((r) => r.kindMismatch));
    sc.check('at most 4 requests admitted per frame', runs.every((r) => r.maxAdmittedInFrame <= 4), runs.map((r) => r.maxAdmittedInFrame));
    sc.check('at most 4 layers per request', runs.every((r) => r.maxLayers <= 4), runs.map((r) => r.maxLayers));
    const storyOnly = ['aftermath', 'landmark', 'church', 'seaCh9', 'scar', 'act3Entry'];
    const arcadeDucks = runs.flatMap((r) => r.ducks.map((d) => d.key));
    sc.check('Arcade: no narrative duck in any level (only pause, fail, dam)', !arcadeDucks.some((k) => storyOnly.includes(k)), [...new Set(arcadeDucks)]);
    const types = {};
    for (const r of runs) for (const [t, n] of Object.entries(r.types)) types[t] = (types[t] ?? 0) + n;
    sc.data.types = types;
    const families = {};
    for (const r of runs) for (const [f, n] of Object.entries(r.families)) families[f] = (families[f] ?? 0) + n;
    sc.data.families = families;
    const sounds = {};
    for (const r of runs) for (const [s, n] of Object.entries(r.sounds)) sounds[s] = (sounds[s] ?? 0) + n;
    sc.data.sounds = sounds;
    const FAMILY_OF = { collision: ['hit', 'scatter'], obstacleBroken: ['breakStructure', 'breakLight', 'dam', 'scatter', 'hit'], treeFelled: ['tree'], splash: ['splash'], landed: ['land', 'plunge'], waterfallCrossed: ['plunge'], enteredOcean: ['ocean'], iceChipped: ['chip', 'hit'], absorbed: ['absorb'] };
    for (const [t, fams] of Object.entries(FAMILY_OF)) {
      if (!types[t]) continue;
      sc.check(`${t}: at least one played request of its family`, fams.some((f) => families[f] > 0), fams.map((f) => `${f} ${families[f] ?? 0}`).join(', '));
    }
    sc.note(`event types seen: ${Object.entries(types).map(([t, n]) => `${t} ${n}`).join(', ')}`);
    sc.note(`sounds asked for: ${Object.keys(sounds).length} ids (${Object.keys(sounds).sort().join(', ')})`);
    // S4, magnitude in the wild, from the same runs: the bridge's requests are the mapping's levels.
    s4Checks(sc, sc.data.hits.map((h) => ({ ...h, reqDb: h.gainDb })), sc.data.breaks.map((x) => ({ ...x, reqDb: x.peakDb })), 'bridge');
    await consoleProblems(b, sc);
  },

  async S5(b, sc) {
    await b.load(opts.url);
    await b.click();
    await b.call(installRecorder);
    await enterLevel(b, 'power-valley');
    // Real time first, then the whole plant line in 3 s fastForward chunks: up to 180 fixed steps'
    // worth of events (the plant's towers, tanks and boiler house) land in one animation frame.
    await b.call(drive, { speed: 1, maxSec: 4 });
    const burst = await b.call(async () => {
      const frames = [];
      for (let i = 0; i < 60; i++) {
        const h = window.__iceberg;
        if (!h || h.snapshot().phase !== 'playing') break;
        h.autopilot(true, 0);
        h.fastForward(3);
        await new Promise((r) => requestAnimationFrame(r));
        const s = window.__audioRec.m.sessions.at(-1);
        frames.push({ frame: s.frame, admitted: s.admittedThisFrame });
      }
      return frames;
    });
    const s = await b.call(bridgeSummary);
    sc.data.summary = { ...s, hits: s.hits.length, breaks: s.breaks.length };
    sc.data.frames = burst.length;
    sc.note(`${s.events} events; up to ${s.maxEventsInFrame} events and ${s.maxRequestsInFrame} requests resolved in one frame; run ended ${(await b.evaluate('window.__iceberg?.snapshot().phase')) ?? 'gone'}`);
    sc.check('fastForward bursts: at most 4 requests admitted in any frame', s.maxAdmittedInFrame <= 4, s.maxAdmittedInFrame, '<= 4');
    sc.check('the overflow is bounded and counted (ring overflow, frame cap)', (s.drops.overflow ?? 0) + (s.drops.frameCap ?? 0) > 0 || s.events < 128, s.drops);
    sc.check('every request carries at most 4 layers', s.maxLayers <= 4, s.maxLayers);
    sc.check('100 % of events accounted for (ended or counted in the overflow)', s.ended + s.overflowed === s.events, `${s.ended}+${s.overflowed}/${s.events}`);
    // The recording engine replaced package A's for this run: its voices and meters are S5E's.
    sc.na('engine: active voices ≤ 24, master peak ≤ −1 dBFS', 'the recording engine is installed in this run; measured on the real engine in S5E');
    await consoleProblems(b, sc);
  },

  async S9(b, sc) {
    await b.load(opts.url);
    await b.click();
    await enterLevel(b, 'mountain-valley');
    await b.evaluate('window.__iceberg.autopilot(true, 0), true');
    await sleep(4000);
    const setVis = (v) => b.evaluate(`(Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => '${v}' }), Object.defineProperty(document, 'hidden', { configurable: true, get: () => ${v === 'hidden'} }), document.dispatchEvent(new Event('visibilitychange')), true)`);
    await setVis('hidden');
    const h = await b.call(watchMusic, { until: 'm.every((x) => x.paused || x.muted)', maxMs: 1000, everyMs: 10 });
    sc.check('hidden tab: the music pauses at once', h.ms >= 0 && h.ms <= 200, Math.round(h.ms), '<= 200 ms');
    const st = await b.evaluate(engineState());
    if (st) sc.check('engine: suspended while hidden', ['suspended', 'starting'].includes(st.status) || st.buses.master < 0.01, st.status);
    else sc.na('engine: master gate 0, then suspended', 'engine not installed (package A)');
    sc.check('the game paused itself too', (await b.evaluate('window.__iceberg.snapshot().phase')) === 'paused', 'paused');
    await setVis('visible');
    const v = await b.call(watchMusic, { until: 'm.some((x) => !x.paused && !x.muted)', maxMs: 4000 });
    sc.check('visible again: the music comes back (under the pause duck)', v.ms >= 0, Math.round(v.ms));
    await consoleProblems(b, sc);
  },

  async S10(b, sc) {
    await b.load(opts.url);
    await b.click();
    await b.call(installRecorder);
    const runs = {};
    const churchLevels = opts.quick ? ['riverside-town', 'highland-maze'] : Object.keys(CHURCH_LEVELS);
    for (const level of churchLevels) {
      await enterLevel(b, level);
      const d = await b.call(drive, { speed: 2, maxSec: 150 });
      const s = await b.call(bridgeSummary);
      runs[level] = { drive: d, bells: s.bells };
      const hours = s.bells.notes.filter((n) => n.note.startsWith('bell-hour'));
      console.log(`  ${level}: ${d.phase} at ${d.time.toFixed(1)} s; strikes ${s.bells.strikes} ${JSON.stringify(s.bells.byVoicing)}; ${hours.map((x) => x.note).join(' | ')}`);
      for (const voicing of CHURCH_LEVELS[level]) {
        sc.check(`${level}: ${voicing} rings`, (s.bells.byVoicing[voicing] ?? 0) > 0, s.bells.byVoicing[voicing] ?? 0, '> 0 strikes');
      }
      const strokes = hours.map((x) => Number(/strokes=(\d+)/.exec(x.note)[1]));
      sc.check(`${level}: the approach hour strikes three in Arcade (once per church)`, strokes.length >= 1 && strokes.every((n) => n === 3) && strokes.length <= CHURCH_LEVELS[level].length, hours.map((x) => x.note));
      // Runs of regularly spaced strokes: a church's strikes split wherever a gap is more than 1.5 × its
      // shortest one (the stroke interval; this run plays at 2× speed, so gaps are in audio time).
      const phrases = [];
      for (const slot of new Set(s.bells.list.map((x) => x.slot))) {
        const w = s.bells.list.filter((x) => x.slot === slot && x.form === 'strike').map((x) => x.when).sort((a, b) => a - b);
        const minGap = Math.min(...w.slice(1).map((t, i) => t - w[i]));
        let n = 0;
        for (let i = 0; i < w.length; i++) {
          n++;
          if (i === w.length - 1 || w[i + 1] - w[i] > 1.5 * minGap) {
            phrases.push({ slot, strokes: n });
            n = 0;
          }
        }
      }
      sc.check(`${level}: no run of strokes is a single stroke, none longer than 6 (never a toll)`, phrases.length > 0 && phrases.every((p) => p.strokes >= 2 && p.strokes <= 6), phrases.map((p) => p.strokes));
    }
    for (const level of opts.quick ? ['mountain-valley'] : ['mountain-valley', 'rocky-canyon', 'glacier-avalanche', 'power-valley', 'ravine-run']) {
      await enterLevel(b, level);
      await b.call(drive, { speed: 3, maxSec: 25 });
      const s = await b.call(bridgeSummary);
      runs[level] = { bells: s.bells };
      sc.check(`${level} has no church: no bell`, s.bells.list.length === 0, s.bells.list.length, 0);
    }
    sc.data.runs = runs;
    await consoleProblems(b, sc);
  },

  async S11(b, sc) {
    await b.load(opts.url);
    await b.click();
    await b.call(installRecorder);
    const finish = async (chapter, speed) => {
      await b.call(nav, { chapterCard: chapter });
      await sleep(400);
      await b.call(nav, { chapter });
      if ((await b.until(playingPhase, 90000)) < 0) throw new Error(`${chapter} never reached play`);
      const d = await b.call(drive, { speed, maxSec: 240 });
      if (d.phase !== 'complete') sc.note(`${chapter}: autopilot ended ${d.phase} at ${d.time.toFixed(1)} s`);
      await sleep(700);
      return d;
    };
    // Chapter 1 to completion: the revelation.
    const d1 = await finish('ch1-beginning', 6);
    const r1 = await b.call(recorderState);
    const outcome = await b.call(async () => {
      const { useStoryRun } = await import('/src/ui/story/storyRun.ts');
      const { anyHuman, isHumanFragment } = await import('/src/audio/story/human.ts');
      const o = useStoryRun.getState().outcome;
      return o ? { fragments: o.fragments.map((f) => ({ id: f.id, kind: f.kind, human: isHumanFragment(f) })), human: anyHuman(o.fragments) } : null;
    });
    sc.data.ch1 = { drive: d1, outcome, recorder: r1 };
    sc.check('ch1 completes (the revelation opens)', d1.phase === 'complete' && outcome !== null, d1.phase);
    if (outcome?.human) {
      sc.check('M1: the music is held (reveal) at completion', r1.holds.includes('reveal'), r1.holds);
      sc.check('M1: "No. 14" (act1) asked for 4.0 s after', r1.motifs.length === 1 && r1.motifs[0].variant === 'act1' && r1.motifs[0].delaySec === 4, r1.motifs);
    } else sc.note('ch1: no human document surfaced, so no motif (M1′)');
    sc.check('M1: the reading duck (music −6 dB) under the panel', r1.appDucks.some((d) => d.key === 'reading' && d.on && d.music === -6), r1.appDucks);
    await b.key('v');
    await sleep(500);
    await b.key('v');
    await sleep(500);
    const r2 = await b.call(recorderState);
    sc.check('"View the river" swaps reading for the lighter readingRiver, and back', r2.appDucks.some((d) => d.key === 'readingRiver' && d.on) && r2.appDucks.at(-1).key === 'reading' && r2.appDucks.at(-1).on, r2.appDucks.slice(-4));
    sc.check('toggling the river view twice adds no second motif', r2.motifs.length === r1.motifs.length, r2.motifs.length);
    if (outcome?.human) {
      const wait = (r1.motifs[0]?.delaySec ?? 4) + 14 + 4.5;
      await sleep(wait * 1000);
      const r3 = await b.call(recorderState);
      sc.check('M1: the music is let back in after the motif and 4 s of quiet', !r3.holds.includes('reveal'), { holds: r3.holds, afterSec: wait });
    }
    // Chapter 8's card: Callum's letter names Mara. Begin early fades the motif.
    await b.call(nav, { screen: 'story' });
    await b.call(nav, { chapterCard: 'ch8-remains' });
    await sleep(600);
    const r4 = await b.call(recorderState);
    const card = r4.motifs.at(-1);
    sc.check('M3: the ch8 card holds the music and asks for the ch8 motif at +1.2 s', r4.holds.includes('card') && card?.variant === 'ch8' && card?.delaySec === 1.2, { holds: r4.holds, card });
    await b.call(nav, { screen: 'story' });
    await sleep(300);
    await b.call(nav, { chapterCard: 'ch8-remains' });
    await sleep(300);
    const r5 = await b.call(recorderState);
    sc.check('M3: once per app session (a second visit plays nothing)', r5.motifs.filter((x) => x.variant === 'ch8').length === 1, r5.motifs.length);
    sc.check('M3: leaving the card early fades the motif (1.5 s) and lets the music in', card && r5.motifs.find((x) => x.variant === 'ch8')?.stopped === 1.5 && !r5.holds.includes('card'), { stopped: r5.motifs.find((x) => x.variant === 'ch8')?.stopped, holds: r5.holds });
    // Chapter 9: the fjord chapel falls on the default line, the sea, then the epilogue.
    const d9 = await finish('ch9-last-thaw', 2);
    const s9 = await b.call(bridgeSummary);
    const r9 = await b.call(recorderState);
    sc.data.ch9 = { drive: d9, bells: s9.bells, ducks: s9.ducks, recorder: r9 };
    const silenced = s9.bells.notes.find((n) => n.note.startsWith('bell-silenced'));
    if (silenced) {
      const after = s9.bells.list.filter((x) => x.voicing === 'fjord-chapel' && x.form === 'strike' && x.frame > silenced.frame).length;
      sc.check('ch9: the chapel falls silent, no strike after (both modes)', after === 0, { silenced: silenced.note, strikesAfter: after });
      sc.check('ch9: the church moment lowers the music (church duck, −14 dB)', s9.ducks.some((d) => d.key === 'church' && d.music === -14), s9.ducks.filter((d) => d.key === 'church'));
      const clank = s9.bells.list.find((x) => x.form === 'clank');
      sc.check('ch9: one dull buried clank under the collapse, no toll', s9.bells.clanks === 1 && clank !== undefined, s9.bells.clanks);
    } else sc.note('ch9: the chapel did not fall on this run (no bell-silenced in the trace)');
    const hour = s9.bells.notes.find((n) => n.note.startsWith('bell-hour'));
    sc.check('ch9: the approach hour strikes six in Story', hour ? /strokes=6/.test(hour.note) : false, hour?.note ?? 'none');
    if (s9.types.enteredOcean) sc.check('M7: the sea takes the music down in ch9 (seaCh9)', s9.ducks.some((d) => d.key === 'seaCh9'), s9.ducks.map((d) => d.key));
    sc.check('M8: Act III held the music until the caption (act3Entry hold, then the duck)', r9.routerCalls.includes('hold act3Entry') && r9.routerCalls.includes('release act3Entry') && s9.ducks.some((d) => d.key === 'act3Entry'), r9.routerCalls.filter((c) => /act3Entry/.test(c)));
    const reveal9 = r9.motifs.at(-1);
    if (d9.phase === 'complete') {
      sc.check('ch9 revelation: the bare Act III motif', reveal9?.variant === 'act3-bare', reveal9);
      const clicked = await b.evaluate(`(() => { const el = [...document.querySelectorAll('button')].find((x) => /epilogue/i.test(x.textContent)); if (!el) return false; el.click(); return true; })()`);
      if (!clicked) await b.call(async () => (await import('/src/ui/story/storyRun.ts')).startEpilogue());
      await sleep(800);
      const re = await b.call(recorderState);
      const epi = re.motifs.at(-1);
      sc.check('M2: the epilogue holds the music and asks for the epilogue motif at +4.5 s', re.holds.includes('epilogue') && epi?.variant === 'epilogue' && epi?.delaySec === 4.5, { holds: re.holds, epi });
      sc.check('M2: the revelation motif fades (1.5 s) when the epilogue begins', re.motifs.find((x) => x.variant === 'act3-bare')?.stopped === 1.5, re.motifs);
      sc.check('M2: epilogueReading replaces reading', re.appDucks.at(-1)?.key === 'epilogueReading' && re.appDucks.at(-1)?.on, re.appDucks.slice(-3));
      sc.data.epilogue = re;
    } else sc.na('ch9 revelation and epilogue', `the autopilot run ended ${d9.phase}`);
    // Narrative off: no motif, only the reading level.
    await b.call(nav, { screen: 'story' });
    await b.call(async () => {
      (await import('/src/state/storyStore.ts')).useStoryStore.getState().updateStorySettings({ narrative: false });
      return true;
    });
    const before = (await b.call(recorderState)).motifs.length;
    const d1b = await finish('ch1-beginning', 6);
    const rn = await b.call(recorderState);
    sc.check('narrative off: no motif and no hold at completion (M1′)', d1b.phase === 'complete' && rn.motifs.length === before && !rn.holds.includes('reveal'), { motifs: rn.motifs.length - before, holds: rn.holds });
    await consoleProblems(b, sc);
  },

  async CALVE(b, sc) {
    // The first attempt plays the full intro (flyover, then the calving); Retry plays the short beat.
    await b.load(opts.url, { settings: { skipIntros: false } });
    await b.click();
    await b.call(installRecorder);
    await b.call(nav, { level: 'rocky-canyon' });
    const ms = await b.until(playingPhase, 120000);
    sc.check('the full intro ends in play', ms >= 0, ms);
    await sleep(500);
    const full = (await b.call(recorderState)).sessions.filter((s) => s.ended === null)[0];
    sc.data.full = full;
    sc.check('full calving: groan, crack, landing, once each', JSON.stringify(full?.calve.map((c) => c.sound)) === JSON.stringify(['ice.calve.groan', 'ice.calve.crack', 'ice.land.ground']), full?.calve);
    sc.check('…at their fixed levels (−22, −16 dBFS; the landing at m 0.7 = −18.2)', JSON.stringify(full?.calve.map((c) => c.gainDb)) === JSON.stringify([-22, -16, -18.2]), full?.calve.map((c) => c.gainDb));
    const old = full?.token ?? 0;
    await b.key('r');
    await b.until(`window.__audioRec.m.sessions.some((s) => s.token > ${old} && s.ended === null)`, 15000);
    await b.until(playingPhase, 60000);
    await sleep(500);
    const retry = (await b.call(recorderState)).sessions.filter((s) => s.ended === null)[0];
    sc.data.retry = retry;
    sc.check('Retry (the short beat): the crack and the landing only', JSON.stringify(retry?.calve.map((c) => c.sound)) === JSON.stringify(['ice.calve.crack', 'ice.land.ground']), retry?.calve);
    await consoleProblems(b, sc);
  },

  /**
   * The level set's bake from a cold start straight into play, on the real engine (no recorder):
   * Riverside Town by the main menu's Play, Story chapter 4 by its card, Power Valley by Play. The
   * first click is the unlock gesture and starts the level. Reports when the bell strike and the whole
   * set were baked against when play began, every bell strike played or dropped, every notReady drop,
   * and the frame times during loading and play. BAKEOFF runs the same flows with ?audio=off (no Web
   * Audio, so no bake) as the frame-time baseline.
   */
  async BAKE(b, sc) {
    await bakeRuns(b, sc, false);
  },

  async BAKEOFF(b, sc) {
    await bakeRuns(b, sc, true);
  },

  async S0(b, sc) {
    await b.load(opts.url);
    await b.click();
    const ms = await b.until('window.__icebergAudio && window.__icebergAudio.state().status === "running"', 3000);
    sc.check('the context runs after one click', ms >= 0, ms);
    const r = await b.evaluate(`(async () => {
      const { audio } = await import('/src/audio/manager.ts');
      const c0 = audio.now(), w0 = performance.now();
      await new Promise((r) => setTimeout(r, 3000));
      return { ctxSec: audio.now() - c0, wallSec: (performance.now() - w0) / 1000 };
    })()`);
    const ratio = r.ctxSec / r.wallSec;
    sc.data.clock = { ...r, ratio };
    // DESIGN §11.3 S0: at >= 0.95 s per wall second the live meters can be read on the wall clock; if
    // not, they are "not measurable" there. Headless Chrome's clock runs, only slower, so this driver
    // times every meter window on the context's own clock (ctxWait) instead: the check is that the
    // clock runs at all, and the ratio is reported against the design's 0.95.
    sc.check('the audio clock runs (currentTime advances; live meter windows are timed on it)', ratio > 0.5, +ratio.toFixed(3), '> 0.5');
    if (ratio < 0.95) sc.note(`currentTime advances ${ratio.toFixed(3)} s per wall second, under the design's 0.95: headless Chrome's audio clock is slow, so the meter windows in S2, S6, S11E and S8E are timed on the context clock, not the wall clock`);
    await b.until('window.__icebergAudio.state().bank.pending === 0', 30000);
    await b.evaluate('window.__icebergAudio.meter(), true');
    await b.evaluate(`(async () => (await window.__icebergAudio.lab()).fire('hit.stone.heavy', { gainDb: -12, rate: 1, lowpassHz: 16000, distM: 0 }))()`);
    await b.call(ctxWait, 600);
    const m = JSON.parse(await b.evaluate('JSON.stringify(Object.entries(window.__icebergAudio.meter()).map(([k, v]) => [k, String(v.peakDb)]))'));
    const master = Number(m.find(([k]) => k === 'master')[1]);
    sc.check('the master meter sees a fired reference sound (hit.stone.heavy at -12 dBFS)', master > -30, +master.toFixed(1), '> -30 dBFS');
    await consoleProblems(b, sc);
  },

  async S13(b, sc) {
    await b.load(opts.url);
    await b.click();
    await b.evaluate(`(async () => { const { audio } = await import('/src/audio/manager.ts'); audio.prepare({ sounds: ['house.collapse', 'tree.fall.pine', 'masonry.collapse.large', 'metal.break.structure'], bells: [], motifs: [] }); return true; })()`);
    await b.until('window.__icebergAudio.state().bank.pending === 0', 60000);
    const spec = '{ collisions: 120, breaks: 10, splashes: 30, seconds: 2 }';
    const a = await b.evaluate(`(async () => { const lab = await window.__icebergAudio.lab(); lab.variation(true); return lab.burst(${spec}); })()`, 300000);
    const c = await b.evaluate(`(async () => { const lab = await window.__icebergAudio.lab(); lab.variation(true); return lab.burst(${spec}); })()`, 300000);
    sc.data.runs = [a, c];
    const keys = ['peakDb', 'truePeakDb', 'rmsDb', 'lufsI', 'lufsMMax', 'maxVoices'];
    // Offline rendering is not bit-exact between two renders in Chrome (float order in its convolver
    // and compressor); the choices (variant, rate, level) are, so the renders agree to far below a dB.
    const diff = Math.max(...keys.filter((k) => k !== 'maxVoices').map((k) => Math.abs(a[k] - c[k])));
    sc.check('the same seeded lab sequence twice (jitter and shuffled variants on): the same render within 0.001 dB, the same voice count', diff <= 0.001 && a.maxVoices === c.maxVoices, { maxDiffDb: diff, voices: [a.maxVoices, c.maxVoices] }, '<= 0.001 dB');
    // The bank: two builds in this browser, and node's checksum of the same set.
    const sums = await b.evaluate(`(async () => {
      const { createSoundBank } = await import('/src/audio/synth/bank.ts');
      const build = () => { const bank = createSoundBank((w) => { while (w(Infinity)) {} }, 42); bank.request({ scope: 'core' }); bank.request({ scope: 'level', set: { sounds: ['house.collapse', 'dam.break', 'glass.break'], bells: ['clachan-kirk'], motifs: [] } }); return bank.stats().checksum; };
      return [build(), build()];
    })()`, 300000);
    sc.data.checksums = sums;
    sc.check('R9: two bank builds in this browser give the same checksum', sums[0] === sums[1] && /^[0-9a-f]{8}$/.test(sums[0]), sums);
    // Node's checksum of the same set, pinned by src/audio/synth/bank.test.ts (R9) and recorded in
    // docs/evidence/AUDIO_RUNS.md; NODE_BANK_CHECKSUM overrides it after a recipe change.
    const node = process.env.NODE_BANK_CHECKSUM ?? NODE_BANK_CHECKSUM;
    sc.check("R9: the browser's checksum equals node's", sums[0] === node, { browser: sums[0], node });
    // Every motif the game plays, rendered here on the main thread and in the motif worker (each
    // render's time too): the same samples as node's (pinned from the render before it was made
    // cheaper, src/audio/synth/motifRender.test.ts), either way.
    const motifs = await b.evaluate(`(async () => {
      const [{ renderMotif }, { pcmHash }, { browserMotifRenderer }] = await Promise.all([import('/src/audio/synth/piano.ts'), import('/src/audio/synth/dsp.ts'), import('/src/audio/synth/motifRenderer.ts')]);
      const reqs = ${JSON.stringify(Object.keys(NODE_MOTIF_HASHES))}.map((k) => ({ variant: k.split('@')[0], tempoScale: Number(k.split('@')[1]) }));
      const hex = (h) => h.toString(16).padStart(8, '0');
      const main = {};
      for (const m of reqs) {
        const t0 = performance.now();
        const pcm = renderMotif(m, 42);
        main[m.variant + '@' + m.tempoScale] = { hash: hex(pcmHash(pcm.data)), ms: Math.round(performance.now() - t0) };
      }
      const r = browserMotifRenderer();
      const worker = {};
      if (r) {
        for (const m of reqs) {
          const res = await new Promise((done) => r.render(m, 42, done));
          worker[m.variant + '@' + m.tempoScale] = res instanceof Error ? { error: res.message } : { hash: hex(res.hash), ms: Math.round(res.ms), length: res.data.length };
        }
      }
      return { main, worker: r ? worker : null };
    })()`, 300000);
    sc.data.motifs = motifs;
    const keysM = Object.keys(NODE_MOTIF_HASHES);
    sc.note(`motif renders here (ms, main thread / worker): ${keysM.map((k) => `${k} ${motifs.main[k]?.ms} / ${motifs.worker?.[k]?.ms ?? '-'}`).join(', ')}`);
    sc.check("every motif renders on this browser's main thread to node's samples (pcmHash)", keysM.every((k) => motifs.main[k]?.hash === NODE_MOTIF_HASHES[k]), Object.fromEntries(keysM.map((k) => [k, motifs.main[k]?.hash])), JSON.stringify(NODE_MOTIF_HASHES));
    if (opts.audioWorker === 'off') sc.na('the motif worker renders the same samples', '--audio-worker off');
    else sc.check('the motif worker renders the same samples as the main thread', motifs.worker !== null && keysM.every((k) => motifs.worker[k]?.hash === motifs.main[k]?.hash), motifs.worker);
    await consoleProblems(b, sc);
  },

  /** S3/S4 on the real engine: every level to completion on the autopilot, the engine's own trace. */
  async S3E(b, sc) {
    await b.load(opts.url);
    await b.click();
    await b.call(traceTap);
    await b.call(async () => {
      window.__kindSounds = (await import('/src/audio/contract.ts')).KIND_SOUNDS;
      return true;
    });
    const C = await b.evaluate(`(async () => {
      const c = await import('/src/audio/contract.ts');
      window.__variation = { jitter: Object.fromEntries(Object.entries(c.VARIATION).map(([f, v]) => [f, v.gainDb])), densityK: c.GLOBAL_LIMITS.densityK };
      return { lref: c.HIT_LREF, mag: c.COLLISION_MAG, variation: c.VARIATION };
    })()`);
    // Every level on its default line, then the lanes that reach what the default lines never do
    // (trees felled, a stone barrier struck: RARE_LANES, found by a headless lane sweep).
    const levels = opts.quick
      ? ['mountain-valley', 'riverside-town', 'power-valley'].map((level) => ({ level, lane: 0 }))
      : [...ARCADE_LEVELS.map((level) => ({ level, lane: 0 })), ...RARE_LANES, ...S4_LANES];
    const runs = [];
    const mixes = {};
    const fidelity = { n: 0, outside: [], maxUp: -Infinity, maxDown: Infinity };
    for (const { level, lane } of levels) {
      await enterLevel(b, level);
      const d = await b.call(drive, { speed: 3, maxSec: 150, lane });
      const s = await b.call(engineSummary);
      // R11: the attempt's plays replayed offline through the real graph (the first 90 s of them).
      if (lane === 0 && ['riverside-town', 'power-valley', 'highland-maze'].includes(level) && s.plays.length > 0) {
        const t0 = s.plays[0].t;
        const trace = s.plays.filter((p) => p.t - t0 < 90);
        try {
          mixes[level] = await b.evaluate(`(async () => (await window.__icebergAudio.lab()).renderMix(${JSON.stringify(trace)}))()`, 600000);
        } catch (err) {
          mixes[level] = { error: String(err).slice(0, 200) };
        }
      }
      delete s.plays;
      fidelity.n += s.fidelity.n;
      fidelity.outside.push(...s.fidelity.outside.map((x) => `${level}: ${x}`));
      fidelity.maxUp = Math.max(fidelity.maxUp, s.fidelity.maxUp);
      fidelity.maxDown = Math.min(fidelity.maxDown, s.fidelity.maxDown);
      delete s.fidelity;
      runs.push({ level: lane === 0 ? level : `${level} lane ${lane}`, drive: d, ...s });
      const coverage = s.events ? (s.ended + s.overflowed) / s.events : 1;
      console.log(`  ${level}: ${d.phase} at ${d.time.toFixed(1)} s, ${s.events} events, ${s.requests} requests, coverage ${(coverage * 100).toFixed(1)} %, drops ${JSON.stringify(s.drops)}`);
    }
    sc.data.runs = runs.map(({ hits, breaks, ...r }) => ({ ...r, hits: hits.length, breaks: breaks.length }));
    sc.data.hits = runs.flatMap((r) => r.hits.map((h) => ({ level: r.level, ...h })));
    sc.data.breaks = runs.flatMap((r) => r.breaks.map((x) => ({ level: r.level, ...x })));
    sc.data.mixes = mixes;
    sc.data.fidelity = fidelity;
    const events = runs.reduce((n, r) => n + r.events, 0);
    const ended = runs.reduce((n, r) => n + r.ended + r.overflowed, 0);
    sc.check('100 % of events end in the engine trace (played, merged, or dropped with a reason)', ended === events, `${ended}/${events}`, '100 %');
    const nd = runs.reduce((n, r) => n + r.notDroppedByCap, 0);
    const pl = runs.reduce((n, r) => n + r.playedOfThose, 0);
    sc.check('>= 90 % of the events not dropped by a rate, cap or mask are played', nd === 0 || pl / nd >= 0.9, `${pl}/${nd}`, '>= 90 %');
    sc.check('every traced event matches the run log\'s type', runs.every((r) => r.typeMismatch === 0), runs.map((r) => r.typeMismatch));
    sc.check('hits play their kind\'s sound (KIND_SOUNDS)', runs.every((r) => r.kindMismatch === 0), runs.map((r) => r.kindMismatch));
    sc.check('at most 4 requests admitted per frame', runs.every((r) => r.maxAdmittedInFrame <= 4), runs.map((r) => r.maxAdmittedInFrame));
    sc.check('at most 4 layers per request', runs.every((r) => r.maxLayers <= 4), runs.map((r) => r.maxLayers));
    const nr = runs.reduce((n, r) => n + (r.drops.notReady ?? 0), 0);
    sc.check('no request dropped as notReady (the set baked in time)', nr === 0, runs.map((r) => [r.level, r.drops.notReady ?? 0]).filter((x) => x[1] > 0));
    const types = {};
    for (const r of runs) for (const [t, n] of Object.entries(r.types)) types[t] = (types[t] ?? 0) + n;
    sc.data.types = types;
    const families = {};
    for (const r of runs) for (const [f, n] of Object.entries(r.families)) families[f] = (families[f] ?? 0) + n;
    sc.data.families = families;
    const sounds = {};
    for (const r of runs) for (const [x, n] of Object.entries(r.sounds)) sounds[x] = (sounds[x] ?? 0) + n;
    sc.data.sounds = sounds;
    const FAMILY_OF = { collision: ['hit', 'scatter'], obstacleBroken: ['breakStructure', 'breakLight', 'dam', 'scatter', 'hit'], treeFelled: ['tree'], splash: ['splash'], landed: ['land', 'plunge'], waterfallCrossed: ['plunge'], enteredOcean: ['ocean'], iceChipped: ['chip', 'hit'], absorbed: ['absorb'] };
    for (const [t, fams] of Object.entries(FAMILY_OF)) {
      if (!types[t]) continue;
      sc.check(`${t}: at least one played sound of its family on the engine`, fams.some((f) => families[f] > 0), fams.map((f) => `${f} ${families[f] ?? 0}`).join(', '));
    }
    sc.note(`event types seen: ${Object.entries(types).map(([t, n]) => `${t} ${n}`).join(', ')}`);
    sc.note(`sounds played: ${Object.keys(sounds).length} ids (${Object.entries(sounds).sort().map(([k, n]) => `${k} ${n}`).join(', ')})`);
    // S4 on the engine's trace: the requested levels (requestDb, the mapping), then what the engine
    // did to them (jitter, density, distance: engine fidelity), then the levels as played.
    const hits = sc.data.hits.filter((h) => typeof h.impulse === 'number' && typeof h.m === 'number');
    s4Checks(sc, hits, sc.data.breaks, 'engine');
    const fid = sc.data.fidelity;
    sc.check('engine fidelity: every play = its request + jitter (± its family’s gainDb) + density (≤ 0) + distance', fid.outside.length === 0, { plays: fid.n, outside: fid.outside.slice(0, 5), maxUp: +fid.maxUp.toFixed(2), maxDown: +fid.maxDown.toFixed(2) });
    const rep = magnitudeReport(hits, C.variation.hit.gainDb);
    sc.data.magnitude = rep;
    sc.note(`S4 as played (engine): n ${rep.n}; rho(impulse, played gain at the source) ${rep.rhoImpulseAtSource.toFixed(3)} [bootstrap 95 % ${rep.bootstrap95?.map((x) => x.toFixed(3)).join(' to ')}]; the requested levels alone ${rep.rhoImpulseRequest.toFixed(3)}; the requested levels with simulated ±${C.variation.hit.gainDb} dB jitter: mean ${rep.jitterSim.mean.toFixed(3)} (5-95 % ${rep.jitterSim.p5.toFixed(3)} to ${rep.jitterSim.p95.toFixed(3)}); rho(m, played at the source) ${rep.rhoMAtSource.toFixed(3)}; rho(impulse x speed, played at the source) ${rep.rhoEnergyAtSource.toFixed(3)}`);
    sc.check('S4 as played: rho(m, played gain at the source) >= 0.9 (the engine keeps the mapping’s order up to its jitter)', rep.rhoMAtSource >= 0.9, +rep.rhoMAtSource.toFixed(3), '>= 0.9');
    for (const [level, mix] of Object.entries(mixes)) {
      if (mix.error) {
        sc.check(`R11 ${level}: the mix replays`, false, mix.error);
        continue;
      }
      sc.check(`R11 ${level}: master true peak <= -1 dBTP`, mix.truePeakDb <= -1, +mix.truePeakDb.toFixed(2), '<= -1');
      sc.check(`R11 ${level}: limiter reduction p99 <= 0.5 dB`, mix.limiterP99ReductionDb <= 0.5, { p99: +mix.limiterP99ReductionDb.toFixed(2), max: +mix.limiterMaxReductionDb.toFixed(2), lufsI: +mix.lufsI.toFixed(1) }, '<= 0.5 dB');
    }
    await consoleProblems(b, sc);
  },

  /** S5 on the real engine: Power Valley's plant line in fastForward bursts; voices, peaks, drops. */
  async S5E(b, sc) {
    await b.load(opts.url);
    await b.click();
    await b.call(traceTap);
    await enterLevel(b, 'power-valley');
    await b.call(drive, { speed: 1, maxSec: 4 });
    await b.evaluate('window.__icebergAudio.meter(), true');
    const burst = await b.call(async () => {
      const out = [];
      for (let i = 0; i < 40; i++) {
        const h = window.__iceberg;
        if (!h || h.snapshot().phase !== 'playing') break;
        h.autopilot(true, 0);
        h.fastForward(3);
        await new Promise((r) => requestAnimationFrame(r));
        const st = window.__icebergAudio.state();
        out.push({ active: st.voices.active, peak: st.voices.peak });
        await new Promise((r) => setTimeout(r, 120));
      }
      return out;
    });
    const m = JSON.parse(await b.evaluate('JSON.stringify(Object.entries(window.__icebergAudio.meter()).map(([k, v]) => [k, String(v.peakDb), String(v.rmsDb)]))'));
    const meter = Object.fromEntries(m.map(([k, p, r]) => [k, { peakDb: Number(p), rmsDb: Number(r) }]));
    const s = await b.call(engineSummary);
    delete s.plays;
    sc.data.summary = { ...s, hits: s.hits.length, breaks: s.breaks.length };
    sc.data.burst = burst;
    sc.data.meter = meter;
    const peakVoices = Math.max(0, ...burst.map((x) => x.peak));
    sc.note(`${s.events} events in ${burst.length} bursts of 3 s; drops ${JSON.stringify(s.drops)}; master peak ${meter.master.peakDb.toFixed(1)} dBFS, effects RMS ${meter.effects.rmsDb.toFixed(1)} dBFS over the bursts`);
    sc.check('engine: never more than 24 effect voices', peakVoices <= 24, peakVoices, '<= 24');
    sc.check('engine: at most 4 requests admitted per frame', s.maxAdmittedInFrame <= 4, s.maxAdmittedInFrame, '<= 4');
    sc.check('engine: the master peak stays at or under -1 dBFS (no clipping)', meter.master.peakDb <= -1, +meter.master.peakDb.toFixed(2), '<= -1 dBFS');
    sc.check('engine: drops are counted by reason', Object.keys(s.drops).length > 0 || s.events < 20, s.drops);
    sc.check('engine: 100 % of events accounted for', s.ended + s.overflowed === s.events, `${s.ended}+${s.overflowed}/${s.events}`);
    await consoleProblems(b, sc);
  },

  /**
   * S8 on the real engine: Retry, a level change, quitting to the menu and leaving a Story chapter,
   * each during play with the river, the scrape and the level's sounds running. After each: the old
   * attempt's session ended in the engine's own trace and nothing of it played afterwards; on the menu
   * every bus meter is silent 300 ms (audio time) after leaving and no effect voice is left.
   */
  async S8E(b, sc) {
    await b.load(opts.url);
    await b.click();
    await b.call(traceTap);
    const session = () => b.evaluate('window.__icebergAudio.state().session');
    const afterEnd = async (token) =>
      JSON.parse(
        await b.evaluate(`JSON.stringify((() => {
          const all = window.__tap.entries.concat(window.__icebergAudio.trace(window.__tap.seq));
          const end = all.find((e) => e.kind === 'lifecycle' && (e.note ?? '').startsWith('session ${token} ends'));
          if (!end) return { ended: false };
          const later = all.filter((e) => e.seq > end.seq && e.token === ${token} && (e.kind === 'play' || (e.kind === 'bell' && !/^bell-/.test(e.note ?? ''))));
          const plays = all.filter((e) => e.seq < end.seq && e.token === ${token} && e.kind === 'play').length;
          return { ended: true, end: end.note, playsBefore: plays, after: later.length, afterWhat: later.slice(0, 4).map((e) => e.kind + ' ' + (e.sound ?? e.note)) };
        })())`),
      );
    const silent = async (label) => {
      await b.call(ctxWait, 300);
      const m = await meterOver(b, 300);
      const st = await b.evaluate(engineState());
      const buses = { master: dbText(m.master.rmsDb), effects: dbText(m.effects.rmsDb), ambience: dbText(m.ambience.rmsDb) };
      sc.check(`${label}: every bus below -90 dBFS RMS 300-600 ms (audio time) after leaving, no effect voice left`, m.master.rmsDb < -90 && m.effects.rmsDb < -90 && m.ambience.rmsDb < -90 && st.voices.active === 0 && st.session === null, { ...buses, voices: st.voices.active, session: st.session });
    };
    // Riverside Town: play 15 s of wall time at 2x (the river, the scrape, the first houses).
    await enterLevel(b, 'riverside-town');
    await b.call(drive, { speed: 2, maxSec: 15 });
    const t1 = await session();
    const live = await meterOver(b, 500);
    sc.check('Riverside Town in play: the effects and ambience buses are sounding before anything is left', live.ambience.rmsDb > -60 && live.master.rmsDb > -60, { ambience: +live.ambience.rmsDb.toFixed(1), effects: +live.effects.rmsDb.toFixed(1), session: t1 });
    // Retry.
    await b.key('r');
    await b.until(`window.__icebergAudio.state().session !== null && window.__icebergAudio.state().session !== ${t1}`, 15000);
    await b.until(playingPhase, 60000);
    await b.call(ctxWait, 300);
    const r1 = await afterEnd(t1);
    sc.check('Retry: the old attempt’s session ended and nothing of it played afterwards', r1.ended && r1.after === 0, r1);
    await b.call(drive, { speed: 2, maxSec: 12 });
    const t2 = await session();
    // A level change.
    await enterLevel(b, 'power-valley');
    await b.call(ctxWait, 300);
    const r2 = await afterEnd(t2);
    sc.check('Level change: the old attempt’s session ended and nothing of it played afterwards', r2.ended && r2.after === 0, r2);
    await b.call(drive, { speed: 2, maxSec: 12 });
    const t3 = await session();
    // Quit to the menu.
    await b.call(nav, { screen: 'levelSelect' });
    const r3 = await afterEnd(t3);
    sc.check('Quit to the menu: the session ended', r3.ended, r3);
    await silent('Quit to the menu');
    const r3b = await afterEnd(t3);
    sc.check('Quit to the menu: nothing of the session played afterwards', r3b.after === 0, r3b);
    // A Story chapter, then back to the chapter list.
    await b.call(nav, { chapterCard: 'ch4-people' });
    await sleep(600);
    await b.call(nav, { chapter: 'ch4-people' });
    if ((await b.until(playingPhase, 90000)) < 0) throw new Error('ch4 never reached play');
    await b.call(drive, { speed: 2, maxSec: 12 });
    const t4 = await session();
    await b.call(nav, { screen: 'story' });
    await silent('Leaving Story chapter 4 for the chapter list');
    const r4 = await afterEnd(t4);
    sc.check('Leaving Story chapter 4: the session ended and nothing of it played afterwards', r4.ended && r4.after === 0, r4);
    await consoleProblems(b, sc);
  },

  /**
   * S4M, the magnitude mapping against every collision the physics produces (not only the hits that
   * were played): every level on five autopilot lines (0, ±8, ±16 m) at 6x with ?audio=off (the
   * physics does not depend on the sound), each collision's kind, impulse J and closing speed v; then
   * the level each candidate mapping would give it (the kind's hit sound, HIT_LREF + 26(m - 1), silent
   * under 0.08) and Spearman ρ against J and against J·v (≈ the energy of the impact), with and without
   * ±1.5 dB of simulated jitter. The evidence for the S4 decision (docs/evidence/AUDIO_RUNS.md).
   */
  async S4M(b, sc) {
    await b.load(opts.url + '?audio=off');
    const C = await b.evaluate(`(async () => { const c = await import('/src/audio/contract.ts'); return { kinds: c.KIND_SOUNDS, lref: c.HIT_LREF, mag: c.COLLISION_MAG }; })()`);
    const events = [];
    for (const lane of [0, -8, 8, -16, 16]) {
      for (const level of ARCADE_LEVELS) {
        await enterLevel(b, level);
        const r = await b.call(collisions, { lane, maxSec: 90 });
        console.log(`  ${level} lane ${lane}: ${r.phase} at ${r.time.toFixed(1)} s, ${r.ev.length} collisions`);
        for (const e of r.ev) events.push({ level, lane, ...e });
      }
    }
    sc.data.events = events;
    const ln = Math.log;
    const cl = (x) => Math.min(1, Math.max(0, x));
    const gate = (J, j0) => Math.min(1, ln(1 + J) / ln(1 + j0));
    const maps = {
      'design: 0.75 ln(1+J)/ln 1501 + 0.25 min(1, v/25)': (J, v) => (0.75 * ln(1 + J)) / ln(1501) + 0.25 * Math.min(1, v / 25),
      'speed weight 0.10': (J, v) => (0.9 * ln(1 + J)) / ln(1501) + 0.1 * Math.min(1, v / 25),
      'impulse only': (J) => ln(1 + J) / ln(1501),
      'speed term gated by the impulse, J0 10': (J, v) => (0.75 * ln(1 + J)) / ln(1501) + 0.25 * Math.min(1, v / 25) * gate(J, 10),
      'speed term gated by the impulse, J0 20': (J, v) => (0.75 * ln(1 + J)) / ln(1501) + 0.25 * Math.min(1, v / 25) * gate(J, 20),
      'speed term gated by the impulse, J0 50': (J, v) => (0.75 * ln(1 + J)) / ln(1501) + 0.25 * Math.min(1, v / 25) * gate(J, 50),
      'energy: ln(1+Jv)/ln(1+1500*25)': (J, v) => ln(1 + J * v) / ln(1 + 1500 * 25),
    };
    const levelOf = (kind, m) => {
      const k = C.kinds[kind];
      const sound = m >= C.mag.heavyFrom && k.hitHeavy ? k.hitHeavy : k.hit;
      return (C.lref[sound] ?? -13) + C.mag.spanDb * (m - 1);
    };
    let seed = SEED;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const table = {};
    for (const [name, fn] of Object.entries(maps)) {
      const audible = events.map((e) => ({ e, m: cl(fn(e.J, e.v)) })).filter((x) => x.m >= C.mag.silentBelow);
      const J = audible.map((x) => x.e.J);
      const E = audible.map((x) => x.e.J * x.e.v);
      const L = audible.map((x) => levelOf(x.e.kind, x.m));
      const sims = [];
      for (let k = 0; k < 400; k++) sims.push(spearman(J, L.map((x) => x + (rnd() * 2 - 1) * 1.5)));
      sims.sort((a, c) => a - c);
      table[name] = { audible: audible.length, quiet: events.length - audible.length, rhoJ: spearman(J, L), rhoJv: spearman(E, L), rhoJJitterMean: sims.reduce((a, x) => a + x, 0) / sims.length, rhoJJitterP5: sims[Math.floor(0.05 * sims.length)] };
      const t = table[name];
      sc.note(`${name}: ${t.audible} audible (${t.quiet} silent); ρ(J, level) ${t.rhoJ.toFixed(3)}, ρ(J·v, level) ${t.rhoJv.toFixed(3)}; with ±1.5 dB jitter ρ(J) ${t.rhoJJitterMean.toFixed(3)} (5 % ${t.rhoJJitterP5.toFixed(3)})`);
    }
    sc.data.table = table;
    sc.note(`${events.length} collisions over ${new Set(events.map((e) => `${e.level} ${e.lane}`)).size} runs with at least one`);
    // The mapping in use (the game's own collisionM and hit levels), on every audible collision.
    const used = await b.call(async (evs) => {
      const g = await import('/src/audio/game/magnitude.ts');
      return evs.map((e) => {
        const m = g.collisionM(e.J, e.v);
        return g.isQuietHit(m) ? null : g.hitLevelDb(g.hitSound(e.kind, m), m);
      });
    }, events);
    const aud = events.map((e, i) => ({ e, L: used[i] })).filter((x) => x.L !== null);
    const rJ = spearman(aud.map((x) => x.e.J), aud.map((x) => x.L));
    const rE = spearman(aud.map((x) => x.e.J * x.e.v), aud.map((x) => x.L));
    sc.data.inUse = { audible: aud.length, rhoJ: rJ, rhoJv: rE };
    sc.check('S4M: the mapping in use orders every audible collision by impulse, ρ(J, level) >= 0.9', rJ >= 0.9, { rho: +rJ.toFixed(3), audible: aud.length }, '>= 0.9');
    sc.check('…and by impulse × closing speed (the energy of the impact), ρ(J·v, level) >= 0.9', rE >= 0.9, { rho: +rE.toFixed(3), audible: aud.length }, '>= 0.9');
    const inUse = await b.evaluate(`(async () => { const g = await import('/src/audio/game/magnitude.ts'); return [[2, 2], [10, 10], [0.4, 25], [2.1, 25], [4.6, 7.1], [160, 15]].map(([J, v]) => +g.collisionM(J, v).toFixed(3)); })()`);
    sc.note(`collisionM in use at (J, v) = (2, 2), (10, 10), (0.4, 25), (2.1, 25), (4.6, 7.1), (160, 15): ${inUse.join(', ')}`);
  },

  /** S10 on the real engine: each church level from the menu, the strikes the engine really played. */
  async S10E(b, sc) {
    await b.load(opts.url);
    await b.click();
    await b.call(traceTap);
    const runs = {};
    const churchLevels = opts.quick ? ['riverside-town', 'highland-maze'] : Object.keys(CHURCH_LEVELS);
    for (const level of churchLevels) {
      await b.call(nav, { screen: 'levelSelect' });
      await sleep(300);
      const ms = await enterLevel(b, level);
      const d = await b.call(drive, { speed: 2, maxSec: 150, lane: 0 });
      const s = await b.call(engineSummary);
      runs[level] = { drive: d, toPlayMs: ms, bells: s.bells, notReady: s.drops.notReady ?? 0 };
      const hours = s.bells.notes.filter((n) => n.note.startsWith('bell-hour'));
      console.log(`  ${level}: ${d.phase} at ${d.time.toFixed(1)} s; strikes played ${s.bells.strikes} ${JSON.stringify(s.bells.byVoicing)}, notReady ${s.bells.notReady}; ${s.bells.notes.map((x) => x.note).join(' | ')}`);
      for (const voicing of CHURCH_LEVELS[level]) sc.check(`${level}: ${voicing} rings on the engine`, (s.bells.byVoicing[voicing] ?? 0) > 0, s.bells.byVoicing[voicing] ?? 0, '> 0 strikes played');
      sc.check(`${level}: no strike dropped as notReady`, s.bells.notReady === 0, s.bells.notReady, 0);
      const strokes = hours.map((x) => Number(/strokes=(\d+)/.exec(x.note)[1]));
      sc.check(`${level}: the approach hour strikes three in Arcade (once per church)`, strokes.length >= 1 && strokes.every((n) => n === 3) && strokes.length <= CHURCH_LEVELS[level].length, hours.map((x) => x.note));
    }
    for (const level of opts.quick ? ['mountain-valley'] : ['mountain-valley', 'rocky-canyon', 'glacier-avalanche', 'power-valley', 'ravine-run']) {
      await enterLevel(b, level);
      await b.call(drive, { speed: 3, maxSec: 25 });
      const s = await b.call(engineSummary);
      runs[level] = { bells: s.bells };
      sc.check(`${level} has no church: no bell on the engine`, s.bells.strikes + s.bells.notReady === 0, s.bells.strikes, 0);
    }
    sc.data.runs = runs;
    await consoleProblems(b, sc);
  },

  /** S11 on the real engine: the motif really plays (or says why not), ducks and holds on the trace and the media elements. */
  async S11E(b, sc) {
    await b.load(opts.url, { storyCompleted: ['ch1-beginning', 'ch2-measurements', 'ch3-warning', 'ch4-people', 'ch5-denial', 'ch6-price', 'ch7-escape'] });
    await b.click();
    await b.call(traceTap);
    const motifNotes = async () =>
      JSON.parse(
        await b.evaluate(
          `JSON.stringify(window.__tap.entries.concat(window.__icebergAudio.trace(window.__tap.seq)).filter((e) => e.kind === 'motif' || e.kind === 'hold' || (e.kind === 'duck' && /^(reading|church|reveal|epilogue|card)/.test(e.note ?? ''))).map((e) => [+e.t.toFixed(2), e.kind, e.note]))`,
        ),
      );
    // Every 100 ms for the whole scenario: the router's duck product and trim, and every recording's
    // el.volume against the sliders (story ducks may only lower the music).
    await b.evaluate(`(() => {
      const S = { n: 0, maxDuckDb: -Infinity, maxTrimDb: -Infinity, maxOverSlider: -Infinity, at: null };
      window.__musicWatch = S;
      setInterval(() => {
        const st = window.__icebergAudio.state();
        const slider = st.levels.master * st.levels.music;
        S.n++;
        if (st.music.duckDb > S.maxDuckDb) { S.maxDuckDb = st.music.duckDb; S.at = st.music.cue; }
        S.maxTrimDb = Math.max(S.maxTrimDb, st.music.trimDb);
        for (const el of window.__audioProbe.media) if (!el.paused) S.maxOverSlider = Math.max(S.maxOverSlider, el.volume - slider);
      }, 100);
      return true;
    })()`);
    // Chapter 8's card, the way a player reaches it: the Story menu (chapter 8 is next) for 3 s first.
    await b.call(nav, { screen: 'story' });
    await sleep(3000);
    await b.call(nav, { chapterCard: 'ch8-remains' });
    await sleep(2500);
    const meterCard = await meterOver(b, 1500);
    const card = await motifNotes();
    sc.data.card = { notes: card, meter: meterCard };
    sc.check('M3 (engine): the ch8 card plays the ch8 motif', card.some((n) => n[1] === 'motif' && /^motif ch8@1 at/.test(n[2])), card.filter((n) => n[1] === 'motif'));
    sc.check('M3 (engine): the motif is heard on the music bus (RMS > -40 dBFS)', meterCard.music.rmsDb > -40, +meterCard.music.rmsDb.toFixed(1), '> -40');
    // Chapter 1 to completion (a human document surfaces): the revelation's motif.
    await b.call(nav, { screen: 'story' });
    await sleep(500);
    await b.call(nav, { chapterCard: 'ch1-beginning' });
    await sleep(800);
    await b.call(nav, { chapter: 'ch1-beginning' });
    if ((await b.until(playingPhase, 90000)) < 0) throw new Error('ch1 never reached play');
    const d1 = await b.call(drive, { speed: 3, maxSec: 240 });
    const tDone = await b.evaluate('window.__icebergAudio.state().music ? performance.now() : 0');
    const vol = await b.call(watchMusic, { until: 'm.every((x) => x.paused || x.volume <= 0.001)', maxMs: 6000, everyMs: 50 });
    await sleep(Math.max(0, 4300 - vol.ms));
    const meterMotif = await meterOver(b, 2000);
    const n1 = await motifNotes();
    sc.data.ch1 = { drive: d1, volMs: vol.ms, notes: n1, meter: meterMotif, tDone };
    sc.check('ch1 completes', d1.phase === 'complete', d1.phase);
    sc.check('M1 (engine): the recording is out (el.volume <= 0.001 or paused) by +3.1 s', vol.ms >= 0 && vol.ms <= 3100, Math.round(vol.ms), '<= 3100 ms');
    sc.check('M1 (engine): "No. 14" (act1) played, not skipped', n1.some((n) => n[1] === 'motif' && /^motif act1@1 at/.test(n[2])), n1.filter((n) => n[1] === 'motif'));
    sc.check('M1 (engine): the motif is heard on the music bus while it plays (RMS > -40 dBFS)', meterMotif.music.rmsDb > -40, +meterMotif.music.rmsDb.toFixed(1), '> -40');
    // Chapter 9: the chapel, the sea, the epilogue.
    const trims = await b.evaluate(`(async () => { const c = await import('/src/audio/contract.ts'); return { reveal: c.MOTIF_MOMENT_TRIM_DB.reveal['ch9-last-thaw'], epilogue: c.MOTIF_MOMENT_TRIM_DB.epilogue, sea: c.DUCK_PRESETS.seaCh9.story.music, floor: c.PLAY_DUCK_FLOOR_DB, reading: c.DUCK_PRESETS.reading.story.music, epiReading: c.DUCK_PRESETS.epilogueReading.story.music, epiAt: c.MOMENT_TIMING.epilogueMotifAtSec }; })()`);
    /** The moment's gain from a motif trace note ("motif act3-bare@1 at +4.00 s, 15.2 s, -19.5 dB"). */
    const motifDb = (note) => Number(/, (-?[\d.]+) dB$/.exec(note ?? '')?.[1]);
    await b.call(nav, { screen: 'story' });
    // From chapter 9's start: when its two motifs are baked, and the bake's pace meanwhile.
    await b.call(motifBakeWatch, { motifs: [{ variant: 'act3-bare', tempoScale: 1 }, { variant: 'epilogue', tempoScale: 1 }] });
    await b.call(nav, { chapter: 'ch9-last-thaw' });
    if ((await b.until(playingPhase, 90000)) < 0) throw new Error('ch9 never reached play');
    const d9 = await b.call(drive, { speed: 2, maxSec: 300 });
    const s9 = await b.call(engineSummary);
    const n9 = await motifNotes();
    sc.data.ch9 = { drive: d9, bells: s9.bells, ducks: s9.ducks, notes: n9 };
    const silenced = s9.bells.notes.find((n) => n.note.startsWith('bell-silenced'));
    if (silenced) {
      sc.check('ch9 (engine): the chapel falls silent: no strike played after bell-silenced', s9.bells.afterSilence === 0, { silenced: silenced.note, strikesAfter: s9.bells.afterSilence });
      sc.check('ch9 (engine): the church duck lowers the music by 14 dB', s9.ducks.some((x) => /^church -14\//.test(x)), s9.ducks.filter((x) => /^church/.test(x)));
      sc.note(`ch9: ${silenced.note}; strikes played ${s9.bells.strikes}, clanks ${s9.bells.clanks}, notReady ${s9.bells.notReady}`);
    } else sc.note('ch9: the chapel did not fall on this run');
    const hour = s9.bells.notes.find((n) => n.note.startsWith('bell-hour'));
    sc.check('ch9 (engine): the approach hour strikes six in Story', hour ? /strokes=6/.test(hour.note) : false, hour?.note ?? 'none');
    sc.check('ch9 (engine): no strike dropped as notReady', s9.bells.notReady === 0, s9.bells.notReady, 0);
    const ducks = s9.ducks.filter((x) => !/release/.test(x)).map((x) => Number(/^\S+ (-?[\d.]+)\//.exec(x)?.[1]));
    sc.check('every duck asked for in ch9 lowers the music (<= 0 dB)', ducks.every((v) => !(v > 0)), s9.ducks.slice(0, 20));
    if (d9.phase === 'complete') {
      // A reader: the revelation's motif and its quiet first (20 s, or --read-sec), then the epilogue.
      // The Revelation's motif is checked once its moment has stopped waiting for it (+4.5 s; a motif
      // baked inside that wait is scheduled then, not at the run's end when n9 was read).
      const firstSec = Math.min(opts.readSec, 5);
      await sleep(firstSec * 1000);
      const n9r = await motifNotes();
      sc.data.ch9.revelationNotes = n9r.filter((n) => n[1] === 'motif' && /act3-bare/.test(n[2]));
      sc.check('ch9 (engine): the revelation motif act3-bare played', n9r.some((n) => n[1] === 'motif' && /^motif act3-bare@1 at/.test(n[2])), n9r.filter((n) => n[1] === 'motif').slice(-4));
      // L1/L1b: the motif follows the attempt's scar (never further than the router's floor takes the
      // recording) but not the sea duck, which would sink it under the waves.
      const g9 = motifDb(n9r.filter((n) => n[1] === 'motif' && /^motif act3-bare@1 at/.test(n[2])).at(-1)?.[2]);
      const lo9 = trims.reveal + trims.floor - trims.reading;
      sc.check("L1b (engine): the ch9 Revelation motif is at its trim, lowered by a scar only (not the sea's -10 dB), the floor's at most", g9 <= trims.reveal + 1e-6 && g9 >= lo9 - 1e-6, g9, `${lo9} .. ${trims.reveal} dB`);
      await sleep((opts.readSec - firstSec) * 1000);
      const clicked = await b.evaluate(`(() => { const el = [...document.querySelectorAll('button')].find((x) => /epilogue/i.test(x.textContent)); if (!el) return false; el.click(); return true; })()`);
      if (!clicked) await b.call(async () => (await import('/src/ui/story/storyRun.ts')).startEpilogue());
      // The motif starts at +4.5 s when it is baked by then, later when the moment waits for its bake;
      // the meter reads 2 s of it from 1.5 s after its start (the audio clock).
      const epiMotif = `window.__tap.entries.concat(window.__icebergAudio.trace(window.__tap.seq)).some((e) => e.kind === 'motif' && /^motif epilogue@1 at/.test(e.note))`;
      const epiGone = `window.__tap.entries.concat(window.__icebergAudio.trace(window.__tap.seq)).some((e) => e.kind === 'hold' && /release 'epilogue'/.test(e.note))`;
      await b.until(`(${epiMotif}) || (${epiGone})`, 40000);
      const startAt = await b.evaluate(`(() => { const e = window.__tap.entries.concat(window.__icebergAudio.trace(window.__tap.seq)).filter((x) => x.kind === 'motif' && /^motif epilogue@1 at/.test(x.note)).at(-1); return e ? e.t + Number(/at \\+([\\d.]+) s/.exec(e.note)[1]) : null; })()`);
      if (startAt !== null) await b.call(async (o) => { const { audio } = await import('/src/audio/manager.ts'); const w0 = performance.now(); while (audio.now() < o.at && performance.now() - w0 < 30000) await new Promise((r) => setTimeout(r, 20)); return true; }, { at: startAt + 1.5 });
      const meterEpi = await meterOver(b, 2000);
      const ne = await motifNotes();
      const watch9 = await b.evaluate('(window.__motifWatch.stop(), JSON.parse(JSON.stringify(window.__motifWatch)))');
      const offThread = await b.evaluate('window.__icebergAudio.bake().bank.offThread ?? null');
      const holdEpi = ne.find((n) => n[1] === 'hold' && n[2] === "hold 'epilogue'");
      const lateBy = startAt !== null && holdEpi ? +(startAt - holdEpi[0]).toFixed(2) : null;
      sc.data.epilogue = { notes: ne, meter: meterEpi, bake: watch9, motifStartsAfterSec: lateBy, offThread, notReady: s9.drops.notReady ?? 0 };
      sc.note(`epilogue motif bake (wall s from chapter 9's start): play ${watch9.events.playing}, run complete ${watch9.events.complete}, act3-bare baked ${watch9.events['baked act3-bare@1'] ?? 'never'}, epilogue started ${watch9.events.epilogue}, epilogue motif baked ${watch9.events['baked epilogue@1'] ?? 'never'}; the motif starts ${lateBy ?? 'never'} s (audio clock) after the epilogue's start (on time: ${trims.epiAt} s); bank pending at the run's end ${watch9.pending.complete} and the epilogue's start ${watch9.pending.epilogue}; wall s per pace ${JSON.stringify(watch9.paceSec)}, ${watch9.awaitedSec} s of it with a moment's motif asked for (waited for, or the epilogue's on chapter 9's Revelation); motifs off the main thread ${offThread ? `${offThread.renders} renders, ${offThread.ms} ms in the worker${offThread.failed ? ', the worker FAILED' : ''}` : 'no (main thread)'}; ch9 sounds dropped as notReady in play ${s9.drops.notReady ?? 0}`);
      sc.check('M2 (engine): the epilogue motif played', ne.some((n) => n[1] === 'motif' && /^motif epilogue@1 at/.test(n[2])), ne.filter((n) => n[1] === 'motif').slice(-3));
      // The epilogue's motif sits 1 LU under Traumerei at the epilogue's reading level (L1), no longer
      // lowered by the sea duck (L1b); the ambience under it is taken down 14 dB. Before L1b it read
      // -55.6 dBFS RMS against -37.2 for the ambience (second fix round): it is checked to sound, and
      // its level against the ambience is recorded for a listener.
      sc.check('M2 (engine): sounding on the music bus (RMS > -75 dBFS; silence reads below -100)', meterEpi.music.rmsDb > -75, +meterEpi.music.rmsDb.toFixed(1), '> -75');
      if (Number.isFinite(meterEpi.ambience?.rmsDb)) sc.note(`M2 (engine): epilogue motif ${meterEpi.music.rmsDb.toFixed(1)} dBFS RMS on the music bus, ambience ${meterEpi.ambience.rmsDb.toFixed(1)} (motif minus ambience ${(meterEpi.music.rmsDb - meterEpi.ambience.rmsDb).toFixed(1)} dB)`);
      const ge = motifDb(ne.filter((n) => n[1] === 'motif' && /^motif epilogue@1 at/.test(n[2])).at(-1)?.[2]);
      const loE = trims.epilogue + trims.floor - trims.epiReading;
      sc.check('L1b (engine): the epilogue motif is at its trim, lowered by a scar only (not the sea), the floor at most', ge <= trims.epilogue + 1e-6 && ge >= loE - 1e-6, ge, `${loE} .. ${trims.epilogue} dB`);
      sc.note(`L1: the ch9 Revelation motif at ${g9} dB and the epilogue's at ${ge} dB under MOTIF_CALIB_DB; the music bus over 2 s of the epilogue motif ${meterEpi.music.rmsDb.toFixed(1)} dBFS RMS, the ambience bus ${meterEpi.ambience.rmsDb.toFixed(1)}`);
    } else sc.na('ch9 revelation and epilogue', `the autopilot run ended ${d9.phase}`);
    const watch = JSON.parse(await b.evaluate('JSON.stringify(Object.fromEntries(Object.entries(window.__musicWatch).map(([k, v]) => [k, typeof v === "number" ? String(v) : v])))'));
    sc.data.musicWatch = watch;
    sc.check('story ducks never raise the music: the router’s duck product stayed <= 0 dB, every 100 ms over the ch8 card, ch1, ch9, the revelation and the epilogue', Number(watch.maxDuckDb) <= 1e-9, { samples: Number(watch.n), maxDuckDb: watch.maxDuckDb, maxTrimDb: watch.maxTrimDb });
    sc.check('…and no recording ever played above the sliders (el.volume <= master × music)', Number(watch.maxOverSlider) <= 1e-6, { maxOverSlider: watch.maxOverSlider });
    await consoleProblems(b, sc);
  },

  /**
   * EPI, the epilogue motif's bake on the main thread (docs/evidence/AUDIO_RUNS.md, "Epilogue motif
   * bake"): the page runs with ?audioworker=off, the fallback where no Web Worker can be made, so every
   * motif bakes in the main thread's slices. Chapter 9 on the autopilot at double speed (the Story menu
   * first, as a player reaches it), then on the Revelation, the river view rendering behind the panel:
   * (1) the frame time with nothing to bake; (2) with work pending (eleven other motif renders asked
   * for again before each pair of windows), at the idle pace and at the loading pace a waiting moment
   * gets, alternated in 4 s windows; (3) the worst case: the epilogue's motif dropped and asked for
   * again, so nothing of it is baked, and the epilogue started in the same task. The moment must wait
   * for the whole bake and play it.
   */
  async EPI(b, sc) {
    await epilogueBake(b, sc, { worker: false });
  },

  /** EPIW: EPI's worst case (3) as the game ships, the motifs rendered in a Web Worker. */
  async EPIW(b, sc) {
    await epilogueBake(b, sc, { worker: true });
  },

  /**
   * S14, a Story restart that keeps the game screen up (second review): "Replay chapter" pressed 1 s
   * into the Revelation (before the motif starts), and "Continue to chapter 2" with narrative off. The
   * attempt that follows must play at the sliders: no reading level left on the buses or the
   * recording, no hold, no motif sounding.
   */
  async S14(b, sc) {
    const READING = ['reading', 'readingRiver', 'epilogueReading'];
    const look = async () => {
      const st = await b.evaluate(engineState());
      return { buses: { ambience: +st.buses.ambience.toFixed(4), effects: +st.buses.effects.toFixed(4) }, ducks: Object.keys(st.ducks), holds: st.music.holds, playing: st.music.playing, musicDucks: st.music.ducks };
    };
    const atSliders = (x) => !x.ducks.some((k) => READING.includes(k)) && !Object.keys(x.musicDucks).some((k) => READING.includes(k)) && x.holds.length === 0 && (x.ducks.length > 0 || (near(x.buses.ambience, 0.8, 1e-3) && near(x.buses.effects, 0.8, 1e-3)));
    const completeCh1 = async () => {
      await b.call(nav, { chapterCard: 'ch1-beginning' });
      await sleep(800);
      await b.call(nav, { chapter: 'ch1-beginning' });
      if ((await b.until(playingPhase, 90000)) < 0) throw new Error('ch1 never reached play');
      const d = await b.call(drive, { speed: 3, maxSec: 240 });
      if (d.phase !== 'complete') throw new Error(`ch1 ended ${d.phase}`);
      return d;
    };
    // Replay chapter, 1 s into the Revelation.
    await b.load(opts.url, { storyCompleted: [] });
    await b.click();
    await b.call(traceTap);
    await completeCh1();
    await b.until(`[...document.querySelectorAll('button')].some((x) => /Replay chapter/.test(x.textContent))`, 20000);
    await b.call(ctxWait, 1000);
    const panel = await look();
    sc.data.replayPanel = panel;
    sc.check('Revelation panel: the reading level and the reveal hold are on', panel.ducks.includes('reading') && panel.holds.includes('reveal'), panel);
    await b.evaluate(`[...document.querySelectorAll('button')].find((x) => /Replay chapter/.test(x.textContent))?.scrollIntoView({ block: 'center' }), true`);
    await b.clickText('button', /Replay chapter/);
    if ((await b.until(playingPhase, 60000)) < 0) throw new Error('the replay never reached play');
    await b.call(ctxWait, 4000); // past the motif's start (+4 s after the panel) and its 1.5 s fade
    const meter = await meterOver(b, 3000);
    const replay = await look();
    sc.data.replay = { state: replay, meter };
    sc.check('Replay chapter: the replayed attempt plays at the sliders (no reading level, no hold)', atSliders(replay), replay);
    sc.check('Replay chapter: the recording is back (the router plays the cue)', replay.playing === 'wonder', replay.playing, 'wonder');
    sc.check('Replay chapter: no motif sounds in the replayed attempt (music bus RMS < -90 dBFS)', meter.music.rmsDb < -90, dbText(meter.music.rmsDb), '< -90');
    const tr = JSON.parse(await b.evaluate(`JSON.stringify(window.__tap.entries.concat(window.__icebergAudio.trace(window.__tap.seq)).filter((e) => e.kind === 'motif' || e.kind === 'hold' || (e.kind === 'duck' && /^reading/.test(e.note ?? ''))).map((e) => [+e.t.toFixed(2), e.kind, e.note]))`));
    sc.data.replayTrace = tr;
    sc.check('Replay chapter: the trace shows the motif stopped, the hold released and the reading level released', tr.some((e) => /motif stopped/.test(e[2])) && tr.some((e) => /release 'reveal'/.test(e[2])) && tr.some((e) => /^reading release/.test(e[2])), tr);
    // Continue to chapter 2 with narrative off.
    await b.load(opts.url, { storyCompleted: [], narrative: false });
    await b.click();
    await completeCh1();
    await b.until(`[...document.querySelectorAll('button')].some((x) => /Continue to chapter/.test(x.textContent))`, 20000);
    await b.call(ctxWait, 3000);
    const done = await look();
    sc.check('Chapter complete (narrative off): the reading level is on, no hold', done.ducks.includes('reading') && done.holds.length === 0, done);
    await b.evaluate(`(async () => { window.__s14app = (await import('/src/state/appStore.ts')).useAppStore; return true; })()`);
    await b.evaluate(`[...document.querySelectorAll('button')].find((x) => /Continue to chapter/.test(x.textContent))?.scrollIntoView({ block: 'center' }), true`);
    await b.clickText('button', /Continue to chapter/);
    if ((await b.until(`window.__s14app.getState().chapterId === 'ch2-measurements' && window.__iceberg && window.__iceberg.snapshot().phase === 'playing'`, 90000)) < 0) throw new Error('chapter 2 never reached play');
    const screen = await b.evaluate(`window.__s14app.getState().screen`);
    await b.call(drive, { speed: 1, maxSec: 8 });
    const next = await look();
    sc.data.continueOff = { screen, state: next };
    sc.check('Continue (narrative off) keeps the game screen up', screen === 'game', screen, 'game');
    sc.check('Continue (narrative off): chapter 2 plays at the sliders (no reading level, no hold)', atSliders(next), next);
    await consoleProblems(b, sc);
  },

  async S12(b, sc) {
    await b.load(opts.url);
    await b.click();
    await enterLevel(b, 'riverside-town');
    await b.call(drive, { speed: 1, maxSec: 20 });
    const st = await b.evaluate(engineState());
    if (st) {
      sc.check('engine: frame() median ≤ 0.05 ms', st.perf.frameMsMedian <= 0.05, st.perf.frameMsMedian);
      sc.check('engine: frame() p99 ≤ 0.3 ms', st.perf.frameMsP99 <= 0.3, st.perf.frameMsP99);
      sc.note(`bank: ${JSON.stringify(st.bank)}`);
    } else sc.na('engine: frame cost and bank bytes', 'engine not installed (package A); the bridge\'s headless cost is bounded in integration.test.ts');
    // A/B against ?audio=off at high quality: Riverside Town on the autopilot, 30 s of play each, the
    // set baked first (this measures the running sound, not the bake: BAKE measures that), the two
    // conditions alternated so a drift of the machine falls on both.
    const ab = { on: [], off: [] };
    for (let i = 0; i < 4; i++) {
      for (const off of i % 2 === 0 ? [false, true] : [true, false]) {
        await b.load(opts.url + (off ? '?audio=off' : ''), { settings: { quality: 'high' } });
        await b.click();
        await enterLevel(b, 'riverside-town');
        if (!off) await b.until('window.__icebergAudio.state().bank.pending === 0', 120000);
        const f = await b.call(frameTimes, { sec: 30 });
        ab[off ? 'off' : 'on'].push(f);
        console.log(`  S12 A/B ${off ? 'off' : 'on '} #${i + 1}: median ${f.median} ms, p95 ${f.p95}, mean ${f.mean}, frames ${f.n}`);
      }
    }
    const med = (xs) => median(xs);
    const on = { median: med(ab.on.map((x) => x.median)), p95: med(ab.on.map((x) => x.p95)), mean: med(ab.on.map((x) => x.mean)) };
    const off = { median: med(ab.off.map((x) => x.median)), p95: med(ab.off.map((x) => x.p95)), mean: med(ab.off.map((x) => x.mean)) };
    sc.data.ab = { runs: ab, on, off };
    sc.note(`S12 A/B (median of 4 runs each): audio on median ${on.median} ms, p95 ${on.p95}, mean ${on.mean}; ?audio=off median ${off.median}, p95 ${off.p95}, mean ${off.mean}`);
    sc.check('S12: median frame-time change <= 0.3 ms (rAF, high quality)', Math.abs(on.median - off.median) <= 0.3, +(on.median - off.median).toFixed(2), '<= 0.3 ms');
    sc.note('Headless Chrome on this laptop (Iris Xe and an RTX 3050 Laptop GPU; ANGLE D3D11 picks the GPU), not a visible window: frame pacing differs from a real session, and audio underruns cannot be observed headless.');
  },

  async R(b, sc) {
    await b.load(opts.url);
    await b.click();
    const has = await b.evaluate('!!window.__icebergAudio');
    if (!has) {
      sc.na('R1–R11 offline renders', 'engine not installed (package A): window.__icebergAudio.lab() is not available');
      return;
    }
    // The lab renders bank buffers: wait for the core bake, and bake the burst's breaks (they are level
    // sounds) as a level set of their own, or they would be dropped as notReady and lighten the burst.
    await b.evaluate(`(async () => {
      const { audio } = await import('/src/audio/manager.ts');
      audio.prepare({
        sounds: ['house.collapse', 'tree.fall.pine', 'masonry.collapse.large', 'metal.break.structure', 'dam.break'],
        bells: ['st-brides'],
        motifs: [{ variant: 'act1', tempoScale: 1 }, { variant: 'act1', tempoScale: 0.94 }, { variant: 'act2', tempoScale: 1 }, { variant: 'act3', tempoScale: 1 }, { variant: 'act3-bare', tempoScale: 1 }, { variant: 'ch8', tempoScale: 1 }, { variant: 'epilogue', tempoScale: 1 }],
      });
      return true;
    })()`);
    const baked = await b.until('window.__icebergAudio.state().status === "running" && window.__icebergAudio.state().bank.pending === 0', 180000);
    sc.check('engine: the core and the burst\'s sounds bake on the menu', baked >= 0, baked, '>= 0 ms');
    sc.note(`bank after the bake: ${JSON.stringify(await b.evaluate('window.__icebergAudio.state().bank'))}`);
    const lab = 'window.__icebergAudio.lab()';
    // R1: a stone hit as the magnitude law plays it at m 0.1 ... 0.9: the light or (from m 0.55) the
    // heavy variant, level -12 + 26(m - 1), rate 1.06 - 0.12m, low-pass 1500 * 2^(3.2m) Hz.
    const ladder = [];
    for (const m of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const id = m >= 0.55 ? 'hit.stone.heavy' : 'hit.stone.light';
      const o = { gainDb: -12 + 26 * (m - 1), rate: 1.06 - 0.12 * m, lowpassHz: 1500 * 2 ** (3.2 * m) };
      ladder.push(await b.evaluate(`(async () => (await ${lab}).renderAt('${id}', ${JSON.stringify(o)}))()`));
    }
    sc.data.ladder = ladder;
    sc.check('R1: hit loudness rises strictly with m', ladder.every((s, i) => i === 0 || s.lufsMMax > ladder[i - 1].lufsMMax), ladder.map((s) => +s.lufsMMax.toFixed(1)));
    const burst = await b.evaluate(`(async () => (await ${lab}).burst({ collisions: 200, breaks: 20, splashes: 40, seconds: 2 }))()`, 300000);
    sc.data.burst = burst;
    sc.check('R3: stress burst true peak ≤ −1 dBTP', burst.truePeakDb <= -1, burst.truePeakDb);
    sc.check('R3: no clipped samples', burst.clippedSamples === 0, burst.clippedSamples);
    sc.check('R3: at most 24 concurrent voices', burst.maxVoices <= 24, burst.maxVoices, '<= 24');
    // R1 for breaks: M 0.2 ... 1.0 at the house collapse's level law (BREAK_TYP: -14 at M 0.56, span 12,
    // clamped to -26 ... -10).
    const brk = [];
    for (const M of [0.2, 0.4, 0.6, 0.8, 1.0]) brk.push(await b.evaluate(`(async () => (await ${lab}).render('house.collapse', 0, ${Math.min(-10, Math.max(-26, -14 + 12 * (M - 0.56)))}))()`));
    sc.note('R1 breaks: one buffer at the levels the break law gives (rate 1, no low-pass): the gain law and the analysis, not a timbre change with M');
    sc.check('R1: break loudness rises strictly with M', brk.every((s, i) => i === 0 || s.lufsMMax > brk[i - 1].lufsMMax), brk.map((s) => +s.lufsMMax.toFixed(1)));
    sc.check('R1: hit ΔL(0.1 → 0.9) is 18–28 LU', ladder[4].lufsMMax - ladder[0].lufsMMax >= 18 && ladder[4].lufsMMax - ladder[0].lufsMMax <= 28, +(ladder[4].lufsMMax - ladder[0].lufsMMax).toFixed(1));
    sc.check('R1: the low band (< 150 Hz) share rises with m (light at 0.1 against heavy at 0.9)', ladder[4].below150 > ladder[0].below150, ladder.map((s) => +s.below150.toFixed(4)));
    sc.note(`R1: spectral centroid by m: ${ladder.map((s) => Math.round(s.centroidHz)).join(', ')} Hz`);
    // R2: cross-family ordering at 30 m with default sliders, and after a 150 Hz high-pass.
    const at = (id, g, hp) => b.evaluate(`(async () => (await ${lab}).renderAt('${id}', { gainDb: ${g}, distM: 30, levels: { effects: 0.8, ambience: 0.8 }, highpass150: ${hp} }))()`, 300000);
    for (const hp of [false, true]) {
      const tap = await at('hit.stone.light', -34.6, hp);
      const pine = await at('hit.wood', -27.9, hp);
      const house = await at('house.collapse', -14, hp);
      const dam = await at('dam.break', -9, hp);
      const L = (x) => +x.lufsMMax.toFixed(1);
      const tag = hp ? ' (after a 150 Hz high-pass)' : '';
      sc.data[`r2${hp ? 'hp' : ''}`] = { tap, pine, house, dam };
      sc.check(`R2: tap <= pine hit - 4 LU <= house collapse - 12 LU${tag}`, tap.lufsMMax <= pine.lufsMMax - 4 && pine.lufsMMax - 4 <= house.lufsMMax - 12, { tap: L(tap), pine: L(pine), house: L(house) });
      sc.check(`R2: house + 3 LU <= dam break${tag}`, house.lufsMMax + 3 <= dam.lufsMMax, { house: L(house), dam: L(dam) });
      if (!hp) sc.check('R2: nothing above -8 dBFS', [tap, pine, house, dam].every((x) => x.peakDb <= -8), [tap, pine, house, dam].map((x) => +x.peakDb.toFixed(1)));
    }
    // R4: the limiter's makeup: a -20 dBFS sine through preMaster comes out at -20 ± 0.3 dB; a
    // full-scale burst at <= -1 dBTP.
    const sine = await b.evaluate(`(async () => (await ${lab}).sine({ dbfs: -20, hz: 1000, seconds: 2 }))()`);
    sc.data.r4 = { sine };
    sc.check('R4: a -20 dBFS sine through preMaster comes out at -20 ± 0.3 dBFS', Math.abs(sine.peakDb + 20) <= 0.3, +sine.peakDb.toFixed(2), '-20 ± 0.3');
    // The burst band-limited at 16 kHz, as the game's one-shots are (each effect strip's low-pass stops
    // there); full-band white noise carries ~3.5 dB of intersample peaks of its own (reported below).
    const fs = await b.evaluate(`(async () => (await ${lab}).sine({ dbfs: 0, seconds: 1, burst: true, bandHz: 16000 }))()`);
    sc.data.r4.burst = fs;
    sc.check('R4: a full-scale burst (band-limited at 16 kHz) comes out at <= -1 dBTP', fs.truePeakDb <= -1, { whole: +fs.truePeakDb.toFixed(2), fromPoint1s: +fs.steady.truePeakDb.toFixed(2), samplePeak: +fs.peakDb.toFixed(2) }, '<= -1');
    const white = await b.evaluate(`(async () => (await ${lab}).sine({ dbfs: 0, seconds: 1, burst: true }))()`);
    sc.data.r4.white = white;
    sc.note(`R4: full-band white noise at a 0 dBFS sample peak comes out at sample peak ${white.peakDb.toFixed(2)} dBFS but ${white.truePeakDb.toFixed(2)} dBTP: the noise itself carries about 3.5 dB of intersample peaks, and Chrome's DynamicsCompressorNode limits samples, not true peak (no oversampling)`);
    const loud = await b.evaluate(`(async () => (await ${lab}).sine({ dbfs: -6, seconds: 1, burst: true, bandHz: 16000 }))()`);
    sc.data.r4.burst6 = loud;
    sc.note(`R4: a -6 dBFS noise burst comes out at ${loud.truePeakDb.toFixed(2)} dBTP (${loud.steady.truePeakDb.toFixed(2)} from 0.1 s); the R3 stress burst of game sounds at ${burst.truePeakDb.toFixed(2)}`);
    // R5: channels.
    const e1 = await b.evaluate(`(async () => (await ${lab}).renderAt('hit.stone.heavy', { gainDb: -12, levels: { effects: 1 } }))()`);
    const e5 = await b.evaluate(`(async () => (await ${lab}).renderAt('hit.stone.heavy', { gainDb: -12, levels: { effects: 0.5 } }))()`);
    sc.check('R5: effects 0.5 vs 1.0 = -6.02 ± 0.05 dB', Math.abs(e5.peakDb - e1.peakDb + 6.02) <= 0.05, +(e5.peakDb - e1.peakDb).toFixed(3));
    const amb0 = await b.evaluate(`(async () => (await ${lab}).renderBell('st-brides', { distM: 40, levels: { ambience: 0 } }))()`);
    sc.check('R5: ambience 0 renders below -120 dBFS (a bell at 40 m)', !(amb0.peakDb > -120), String(amb0.peakDb), '< -120 dBFS');
    const muted = await b.evaluate(`(async () => (await ${lab}).renderAt('hit.stone.heavy', { gainDb: -12, levels: { soundMuted: true } }))()`);
    sc.check('R5: mute all renders silence', muted.peakDb < -120, String(muted.peakDb), '< -120 dBFS');
    const gate = await b.evaluate(`(async () => (await ${lab}).renderAt('house.collapse', { gainDb: -14, gateAtSec: 0.5 }))()`);
    sc.check('R5: the pause gate reaches -60 dB within 0.25 s', gate.gateDbAt <= -60, +gate.gateDbAt.toFixed(1), '<= -60 dB');
    sc.data.r5 = { e1: e1.peakDb, e5: e5.peakDb, muted: String(muted.peakDb), gate: gate.gateDbAt, amb0: String(amb0.peakDb) };
    // R6: bells against a house collapse.
    const bell250 = await b.evaluate(`(async () => (await ${lab}).renderBell('st-brides', { distM: 250 }))()`);
    const bell40 = await b.evaluate(`(async () => (await ${lab}).renderBell('st-brides', { distM: 40 }))()`);
    const house30 = await b.evaluate(`(async () => (await ${lab}).renderAt('house.collapse', { gainDb: -14, distM: 30 }))()`);
    sc.data.r6 = { bell250, bell40, house30 };
    sc.check('R6: a bell at 250 m is >= 12 LU below a house collapse at 30 m', bell250.lufsMMax <= house30.lufsMMax - 12, { bell250: +bell250.lufsMMax.toFixed(1), house30: +house30.lufsMMax.toFixed(1) });
    sc.check('R6: a bell at 40 m peaks at <= -16 dBFS', bell40.peakDb <= -16, +bell40.peakDb.toFixed(1), '<= -16');
    // R10 and R7: the six recordings as heard at el.volume 1, and the motif through motifBus.
    const recs = [];
    for (const f of ['mozart-k545-allegro.mp3', 'chopin-waltz-a-minor-b150.mp3', 'chopin-nocturne-e-minor-op72-1.mp3', 'beethoven-moonlight-adagio.mp3', 'schumann-the-poet-speaks.mp3', 'schumann-traumerei.mp3']) {
      recs.push(await b.evaluate(`(async () => (await ${lab}).recording('/audio/${f}'))()`, 600000));
    }
    // As heard: the player cuts each file to MUSIC_TARGET_LUFS (src/audio/tracks.ts).
    const tracks = await b.evaluate(`(async () => { const t = await import('/src/audio/tracks.ts'); return { target: t.MUSIC_TARGET_LUFS, files: Object.fromEntries(Object.entries(t.CUE_TRACKS).map(([cue, d]) => [d.file, { cue, lufsI: d.lufsI, cutDb: t.recordingGainDb(cue) }])) }; })()`);
    for (const r of recs) {
      const t = tracks.files[r.url.split('/').pop()];
      r.cue = t.cue;
      r.cutDb = t.cutDb;
      r.heardLufsI = r.lufsI + t.cutDb;
      r.tableLufsI = t.lufsI;
    }
    sc.data.recordings = recs;
    for (const r of recs) sc.note(`R10 ${r.url.split('/').pop()}: ${r.channels} ch, ${r.sampleRate} Hz, ${r.durationSec.toFixed(1)} s, peak ${r.peakDb.toFixed(2)} dBFS, ${r.lufsI.toFixed(2)} LUFS-I, max momentary ${r.lufsMMax.toFixed(1)}; the player's cut ${r.cutDb.toFixed(2)} dB, heard ${r.heardLufsI.toFixed(2)}`);
    const recMedian = median(recs.map((r) => r.heardLufsI));
    sc.check('R10: every recording measured (integrated loudness)', recs.every((r) => Number.isFinite(r.lufsI)), recs.map((r) => +r.lufsI.toFixed(2)));
    sc.check("R10: tracks.ts's lufsI is each file's measured loudness (±0.05 LU)", recs.every((r) => Math.abs(r.lufsI - r.tableLufsI) <= 0.05), recs.map((r) => [r.cue, +r.lufsI.toFixed(2), r.tableLufsI]));
    sc.check('R10: loudness-matched: every recording is heard at MUSIC_TARGET_LUFS ± 0.1 LU', recs.every((r) => Math.abs(r.heardLufsI - tracks.target) <= 0.1), recs.map((r) => +r.heardLufsI.toFixed(2)), tracks.target);
    sc.check('R10: the recordings peak at or under 0 dBFS (music is outside the limiter)', recs.every((r) => r.peakDb <= 0), recs.map((r) => +r.peakDb.toFixed(2)));
    const motifs = [{ variant: 'act1', tempoScale: 1 }, { variant: 'act1', tempoScale: 0.94 }, { variant: 'act2', tempoScale: 1 }, { variant: 'act3', tempoScale: 1 }, { variant: 'act3-bare', tempoScale: 1 }, { variant: 'ch8', tempoScale: 1 }, { variant: 'epilogue', tempoScale: 1 }];
    const motifStats = [];
    for (const m of motifs) {
      const raw = await b.evaluate(`(async () => (await ${lab}).renderMotif(${JSON.stringify(m)}, { calibrated: false }))()`, 300000);
      const cal = await b.evaluate(`(async () => (await ${lab}).renderMotif(${JSON.stringify(m)}, { calibrated: true, music: 0.6 }))()`, 300000);
      motifStats.push({ ...m, rawLufsI: raw.lufsI, rawPeakDb: raw.peakDb, calLufsI06: cal.lufsI, calPeakDb06: cal.peakDb, clipped: cal.clippedSamples });
    }
    sc.data.motifs = motifStats;
    const calib = await b.evaluate('(async () => (await import("/src/audio/manager.ts")).audio.motifCalibDb)()');
    const target06 = recMedian + 20 * Math.log10(0.6) - 3;
    const motifMedianRaw = median(motifStats.map((x) => x.rawLufsI));
    sc.data.calibration = { recordingsMedianLufsI: recMedian, motifMedianRawLufsI: motifMedianRaw, wantedCalibDb: recMedian - 3 - motifMedianRaw, inUse: calib, target06 };
    sc.note(`R7: recordings' median as heard ${recMedian.toFixed(2)} LUFS-I at el.volume 1; the motifs' median before calibration ${motifMedianRaw.toFixed(2)} LUFS-I at music 1; calibration wanted ${(recMedian - 3 - motifMedianRaw).toFixed(2)} dB, in use ${calib}`);
    for (const x of motifStats) sc.note(`R7 ${x.variant}@${x.tempoScale}: ${x.rawLufsI.toFixed(2)} LUFS-I raw (peak ${x.rawPeakDb.toFixed(1)}); at music 0.6 calibrated ${x.calLufsI06.toFixed(2)} (peak ${x.calPeakDb06.toFixed(1)}), target ${target06.toFixed(2)}`);
    sc.check("R7: the motifs' median at music 0.6 = the recordings' median at el.volume 0.6 − 3 ± 1 LU", Math.abs(median(motifStats.map((x) => x.calLufsI06)) - target06) <= 1, { motifMedian: +median(motifStats.map((x) => x.calLufsI06)).toFixed(2), target: +target06.toFixed(2) });
    sc.note(`R7: each variant against that target (LU): ${motifStats.map((x) => `${x.variant}@${x.tempoScale} ${(x.calLufsI06 - target06).toFixed(1)}`).join(', ')}`);
    sc.check('R7: no clipping in the motif', motifStats.every((x) => x.clipped === 0), motifStats.map((x) => x.clipped));
    // R7 per moment (lead decision L1): each moment's motif, rendered at its own trim through the same
    // gain as playMotif, against its chapter's recording at that moment (the heard recording, the bed,
    // the moment's reading level), both at music 1.
    const moments = await b.evaluate(`(async () => {
      const c = await import('/src/audio/contract.ts');
      const { CHAPTERS } = await import('/src/story/chapters/index.ts');
      const t = await import('/src/audio/tracks.ts');
      const rows = CHAPTERS.map((ch) => ({ moment: ch.id + ' revelation', motif: c.REVELATION_MOTIF[ch.id], trimDb: c.MOTIF_MOMENT_TRIM_DB.reveal[ch.id], cue: ch.music, bedDb: c.CHAPTER_MIX[ch.id].musicBedDb, duckDb: c.DUCK_PRESETS.reading.story.music }));
      for (const [id, trim] of Object.entries(c.MOTIF_MOMENT_TRIM_DB.card)) rows.push({ moment: id + ' card', motif: { variant: c.CARD_MOTIF[id], tempoScale: 1 }, trimDb: trim, cue: CHAPTERS.find((x) => x.id === id).music, bedDb: 0, duckDb: 0 });
      rows.push({ moment: 'epilogue', motif: { variant: c.EPILOGUE_MOTIF, tempoScale: 1 }, trimDb: c.MOTIF_MOMENT_TRIM_DB.epilogue, cue: 'thaw', bedDb: c.CHAPTER_MIX['ch9-last-thaw'].musicBedDb, duckDb: c.DUCK_PRESETS.epilogueReading.story.music });
      return rows.map((r) => ({ ...r, playlist: t.CUE_PLAYLISTS[r.cue] }));
    })()`);
    const heardByCue = Object.fromEntries(recs.map((r) => [r.cue, r.heardLufsI]));
    const momentStats = [];
    for (const row of moments) {
      const out = await b.evaluate(`(async () => (await ${lab}).renderMotif(${JSON.stringify(row.motif)}, { calibrated: true, music: 1, gainDb: ${row.trimDb} }))()`, 300000);
      // Whichever file of the chapter's playlist is playing: the quietest as heard (the strictest).
      const recording = Math.min(...row.playlist.map((cue) => heardByCue[cue])) + row.bedDb + row.duckDb;
      momentStats.push({ moment: row.moment, variant: `${row.motif.variant}@${row.motif.tempoScale}`, trimDb: row.trimDb, motifLufsI: out.lufsI, recordingLufsI: recording, underLu: recording - out.lufsI, peakDb: out.peakDb });
    }
    sc.data.moments = momentStats;
    for (const x of momentStats) sc.note(`R7 L1 ${x.moment}: ${x.variant} at ${x.trimDb} dB = ${x.motifLufsI.toFixed(2)} LUFS-I, the recording at that moment ${x.recordingLufsI.toFixed(2)}: ${x.underLu.toFixed(2)} LU under`);
    sc.check("R7 (L1): every moment's motif sits at least 1 LU under its chapter's recording at that moment (bed and reading level included)", momentStats.every((x) => x.underLu >= 1), momentStats.map((x) => [x.moment, +x.underLu.toFixed(2)]), '>= 1 LU');
  },
};

/**
 * EPI (worker false: ?audioworker=off, every motif baked on the main thread) and EPIW (worker true, as
 * the game ships: motifs rendered in a Web Worker). EPIW runs only the worst case (3): the frame-time
 * windows (1) and (2) measure the main thread's bake pace, which a motif never uses there.
 */
async function epilogueBake(b, sc, { worker }) {
  const all = ['ch1-beginning', 'ch2-measurements', 'ch3-warning', 'ch4-people', 'ch5-denial', 'ch6-price', 'ch7-escape', 'ch8-remains'];
  await b.load(worker ? opts.url : withQuery(opts.url, { audioworker: 'off' }), { storyCompleted: all });
  await b.click();
  await b.call(traceTap);
  await b.call(nav, { screen: 'story' });
  await sleep(2000);
  await b.call(nav, { chapter: 'ch9-last-thaw' });
  if ((await b.until(playingPhase, 90000)) < 0) throw new Error('ch9 never reached play');
  const d9 = await b.call(drive, { speed: 2, maxSec: 300 });
  if (d9.phase !== 'complete') return sc.na('the Revelation and the epilogue', `the autopilot run ended ${d9.phase}`);
  await sleep(5000); // the Revelation's motif has started
  const offThread0 = await b.evaluate('window.__icebergAudio.bake().bank.offThread ?? null');
  sc.check(worker ? 'the motifs render off the main thread (a Web Worker)' : 'the motifs bake on the main thread (?audioworker=off)', worker ? offThread0 !== null && !offThread0.failed && offThread0.renders >= 1 : offThread0 === null, offThread0);
  if (!worker) {
    const pace = (on) => b.evaluate(`(async () => { (await import('/src/audio/manager.ts')).audio.setLoadingScreen(${on}); return true; })()`);
    const prepare = (motifs) =>
      b.evaluate(`(async () => { const [{ audio }, { levelSoundSet }] = await Promise.all([import('/src/audio/manager.ts'), import('/src/audio/game/levelSet.ts')]); const set = levelSoundSet('', 'ch9-last-thaw'); audio.prepare({ ...set, motifs: ${motifs} }); return audio.bakeReport().bank.pending; })()`);
    // (1) Nothing to bake: what is left of the set is finished at the loading pace first.
    await pace(true);
    const drained = await b.until('window.__icebergAudio.bake().bank.pending === 0', 90000);
    await pace(false);
    const none = await b.call(frameWindow, { ms: 4000 });
    console.log(`  nothing to bake (drained in ${drained} ms): ${JSON.stringify(none)}`);
    // (2) Work pending, idle and loading pace alternated.
    // The five other motifs the game plays, and (since the render is about 4.5x cheaper, 2026-10-23)
    // the epilogue at six other tempi, so a 4 s window at the loading pace cannot finish them all.
    const extra = "[...set.motifs, { variant: 'act1', tempoScale: 1 }, { variant: 'act1', tempoScale: 0.94 }, { variant: 'act2', tempoScale: 1 }, { variant: 'act3', tempoScale: 1 }, { variant: 'ch8', tempoScale: 1 }, ...[0.9, 0.92, 0.96, 0.98, 1.02, 1.04].map((t) => ({ variant: 'epilogue', tempoScale: t }))]";
    const windows = { idle: [], loading: [] };
    const queued = [];
    for (let i = 0; i < 3; i++) {
      // The extra renders dropped and asked for again: each pair starts with all of them pending.
      await prepare('set.motifs');
      queued.push(await prepare(extra));
      for (const p of i % 2 === 0 ? ['idle', 'loading'] : ['loading', 'idle']) {
        await pace(p === 'loading');
        const f = await b.call(frameWindow, { ms: 4000 });
        windows[p].push(f);
        console.log(`  ${p} #${i + 1}: ${JSON.stringify(f)}`);
      }
    }
    await pace(false);
    const valid = (f) => f.pendingEnd > 0;
    const sum = (fs) => ({
      windows: fs.length,
      allPending: fs.every(valid),
      median: median(fs.map((f) => f.median)),
      p95: median(fs.map((f) => f.p95)),
      mean: median(fs.map((f) => f.mean)),
      over33PerSec: +(fs.reduce((a, f) => a + f.over33, 0) / (fs.length * 4)).toFixed(2),
      bakeMsPerSec: +(fs.reduce((a, f) => a + f.bakeMs.idle + f.bakeMs.loading + f.bakeMs.play, 0) / (fs.length * 4)).toFixed(1),
    });
    const ab = { none, queued, idle: sum(windows.idle), loading: sum(windows.loading), windows };
    sc.data.revelationFrames = ab;
    sc.note(`Revelation frame time (rAF intervals, 4 s windows): nothing to bake median ${none.median} ms, p95 ${none.p95}, mean ${none.mean}, frames over 33 ms ${(none.over33 / 4).toFixed(2)}/s; work pending at the idle pace (3 windows) median ${ab.idle.median}, p95 ${ab.idle.p95}, mean ${ab.idle.mean}, over 33 ms ${ab.idle.over33PerSec}/s, bake ${ab.idle.bakeMsPerSec} ms/s; at the loading pace median ${ab.loading.median}, p95 ${ab.loading.p95}, mean ${ab.loading.mean}, over 33 ms ${ab.loading.over33PerSec}/s, bake ${ab.loading.bakeMsPerSec} ms/s`);
    sc.check('the A/B windows all had work pending to the end', ab.idle.allPending && ab.loading.allPending, { idle: windows.idle.map((f) => f.pendingEnd), loading: windows.loading.map((f) => f.pendingEnd) });
  } else {
    // What is left of the set first, at the loading pace (as EPI's (1)), so the worst case below starts
    // from the same place as EPI's: only the epilogue's motif to bake.
    await b.evaluate(`(async () => { (await import('/src/audio/manager.ts')).audio.setLoadingScreen(true); return true; })()`);
    await b.until('window.__icebergAudio.bake().bank.pending === 0', 120000);
    await b.evaluate(`(async () => { (await import('/src/audio/manager.ts')).audio.setLoadingScreen(false); return true; })()`);
  }
  // (3) The worst case: the epilogue's motif not baked at all when the epilogue starts. It is dropped,
  // asked for again and the epilogue started in one task (chapter 9's Revelation asks for the
  // epilogue's motif, so any time between the two would bake some of it). The trace is marked first:
  // the epilogue's own ask must come after the mark (the Revelation's, long before, does not count),
  // and the bank must still bake the new entry first (edge case A: before the fix its priority was lost
  // while bakeReport().awaitedMotif still named it).
  await b.call(motifBakeWatch, { motifs: [{ variant: 'epilogue', tempoScale: 1 }] });
  const start = await b.evaluate(`(async () => {
    const [{ audio }, { levelSoundSet }, { startEpilogue }] = await Promise.all([import('/src/audio/manager.ts'), import('/src/audio/game/levelSet.ts'), import('/src/ui/story/storyRun.ts')]);
    const set = levelSoundSet('', 'ch9-last-thaw');
    const mark = audio.traceRing.lastSeq;
    audio.prepare({ ...set, motifs: [{ variant: 'act3-bare', tempoScale: 1 }] });
    audio.prepare(set);
    const rep = audio.bakeReport();
    const pending = rep.bank.pending;
    const bankAwaited = rep.bank.awaited ?? null;
    const awaitedMotif = rep.awaitedMotif;
    const unbaked = audio.bank().motif({ variant: 'epilogue', tempoScale: 1 }) === null;
    const el = [...document.querySelectorAll('button')].find((x) => /epilogue/i.test(x.textContent));
    if (el) el.click();
    else startEpilogue();
    const after = audio.bakeReport();
    return { mark, pending, unbaked, clicked: !!el, bankAwaited, awaitedMotif, bankAwaitedAtStart: after.bank.awaited ?? null, paceAtStart: after.pace };
  })()`);
  sc.check('worst case: the epilogue motif is not baked when the epilogue starts', start.unbaked && start.pending === 1, start);
  sc.check('worst case (edge case A): dropped and asked for again, the bank still bakes it first, as bakeReport says', start.bankAwaited === 'epilogue@1' && start.awaitedMotif === 'epilogue@1' && start.bankAwaitedAtStart === 'epilogue@1', { bankAwaited: start.bankAwaited, awaitedMotif: start.awaitedMotif, atStart: start.bankAwaitedAtStart });
  const during = await b.call(frameWindow, { ms: 4000 });
  console.log(`  the epilogue's wait, first 4 s: ${JSON.stringify(during)}`);
  const epiMotif = `window.__tap.entries.concat(window.__icebergAudio.trace(window.__tap.seq)).some((e) => e.kind === 'motif' && /^motif epilogue@1 at/.test(e.note))`;
  const epiGone = `window.__tap.entries.concat(window.__icebergAudio.trace(window.__tap.seq)).some((e) => e.kind === 'hold' && /release 'epilogue'/.test(e.note))`;
  await b.until(`(${epiMotif}) || (${epiGone})`, 40000);
  const tr = JSON.parse(await b.evaluate(`JSON.stringify(window.__tap.entries.concat(window.__icebergAudio.trace(window.__tap.seq)).filter((e) => e.kind === 'motif' || e.kind === 'hold' || /^bake: /.test(e.note ?? '')).map((e) => [+e.t.toFixed(2), e.kind, e.note, e.seq]))`));
  const hold = tr.filter((e) => e[2] === "hold 'epilogue'").at(-1);
  const motif = tr.filter((e) => /^motif epilogue@1 at/.test(e[2])).at(-1);
  const startAt = motif ? motif[0] + Number(/at \+([\d.]+) s/.exec(motif[2])[1]) : null;
  const lateBy = startAt !== null && hold ? +(startAt - hold[0]).toFixed(2) : null;
  const { waitSec, epiAt } = await b.evaluate(`(async () => ({ waitSec: (await import('/src/audio/story/moments.ts')).EPILOGUE_MOTIF_WAIT_SEC, epiAt: (await import('/src/audio/contract.ts')).MOMENT_TIMING.epilogueMotifAtSec }))()`);
  let meter = null;
  if (startAt !== null) {
    await b.call(async (o) => { const { audio } = await import('/src/audio/manager.ts'); const w0 = performance.now(); while (audio.now() < o.at && performance.now() - w0 < 30000) await new Promise((r) => setTimeout(r, 20)); return true; }, { at: startAt + 1.5 });
    meter = await meterOver(b, 2000);
  }
  const watch = await b.evaluate('(window.__motifWatch.stop(), JSON.parse(JSON.stringify(window.__motifWatch)))');
  const offThread1 = await b.evaluate('window.__icebergAudio.bake().bank.offThread ?? null');
  const bakedIn = watch.events['baked epilogue@1'] !== undefined && watch.events.epilogue !== undefined ? +(watch.events['baked epilogue@1'] - watch.events.epilogue).toFixed(2) : null;
  const t0 = watch.time.epilogue?.ms;
  const t1 = watch.time['baked epilogue@1']?.ms;
  const bakeWorkMs = t0 && t1 ? +Object.keys(t1).reduce((a, k) => a + t1[k] - t0[k], 0).toFixed(0) : null;
  const workerMs = worker && offThread0 && offThread1 ? offThread1.ms - offThread0.ms : null;
  sc.data.worstCase = { trace: tr.filter((e) => e[0] >= (hold?.[0] ?? 0) - 0.01), during, lateBy, meter, watch, bakedIn, bakeWorkMs, offThread: [offThread0, offThread1], workerMs };
  sc.note(`worst case (nothing of the epilogue motif baked at the epilogue's start): baked ${bakedIn ?? 'never'} s (wall) after the epilogue's start, ${bakeWorkMs ?? '?'} ms of main-thread bake work meanwhile${worker ? ` (the worker's renders since the Revelation took ${workerMs ?? '?'} ms there, ${offThread1?.renders ?? '?'} renders in all)` : ''}; the motif starts ${lateBy ?? 'never'} s (audio clock) after the epilogue's start (on time: ${epiAt} s; wait ${waitSec} s); frames during the first 4 s of the wait median ${during.median} ms, p95 ${during.p95}, over 33 ms ${(during.over33 / 4).toFixed(2)}/s, bake ${JSON.stringify(during.bakeMs)} ms`);
  sc.check('worst case: the epilogue motif played', motif !== undefined, tr.filter((e) => e[1] === 'motif').slice(-3));
  sc.check(`worst case: it started inside the epilogue's wait (<= ${waitSec} s)`, lateBy !== null && lateBy <= waitSec + 0.3, lateBy, `<= ${waitSec} s`);
  // On time means baked before its start time: the moment then schedules it at its start time, give or take
  // its retry timers (each 250 ms, later on a throttled main thread).
  if (worker) sc.check(`worst case (worker): rendered off the main thread and baked before its start time (+${epiAt} s)`, bakedIn !== null && bakedIn < epiAt && offThread1 !== null && !offThread1.failed && offThread1.renders > (offThread0?.renders ?? 0), { bakedIn, lateBy, offThread: offThread1 }, `< ${epiAt} s`);
  const own = tr.filter((e) => e[3] > start.mark && /^bake: /.test(e[2]));
  sc.check("worst case: the epilogue asked for its own motif (its own trace line, after the drop), at the loading pace, and let it go once it played", own.some((e) => e[2] === 'bake: motif epilogue@1 wanted by a moment: baked first, at the loading pace') && start.paceAtStart === 'loading' && motif !== undefined && own.some((e) => e[2] === 'bake: no motif wanted by a moment' && e[0] >= motif[0]), { own, paceAtStart: start.paceAtStart });
  if (meter) sc.check('worst case: the motif sounds on the music bus (RMS > -75 dBFS)', meter.music.rmsDb > -75, dbText(meter.music.rmsDb), '> -75');
  await consoleProblems(b, sc);
}

// --- engine evidence: the real engine's own trace --------------------------------------------------------

/** Page-side: autopilot at 1x for `sec` seconds; rAF frame intervals (ms): median, p95, mean. */
function frameTimes(o) {
  return new Promise((resolve) => {
    const xs = [];
    const t0 = performance.now();
    let last = t0;
    const step = (t) => {
      const h = window.__iceberg;
      if (h) h.autopilot(true, 0);
      xs.push(t - last);
      last = t;
      const phase = h?.snapshot().phase;
      if (t - t0 > o.sec * 1000 || phase === 'complete' || phase === 'failed') {
        const srt = xs.slice(1).sort((a, b) => a - b);
        const q = (p) => +srt[Math.min(srt.length - 1, Math.floor(p * srt.length))].toFixed(2);
        resolve({ n: srt.length, median: q(0.5), p95: q(0.95), mean: +(srt.reduce((a, x) => a + x, 0) / srt.length).toFixed(2) });
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/**
 * Page-side: from now on, every 100 ms, when each of `o.motifs` is baked (the bank hands out its
 * buffer, after having been seen without one), when the game reaches play and completes, and when the epilogue begins; the wall seconds
 * spent at each bake pace (and with a moment's motif asked for first), and at each of those points the
 * bake's main-thread time per pace and the bank's pending count. Times are wall seconds from the
 * install (performance.now()), so to 0.1 s.
 */
async function motifBakeWatch(o) {
  const [{ audio }, { useStoryRun }] = await Promise.all([import('/src/audio/manager.ts'), import('/src/ui/story/storyRun.ts')]);
  window.__motifWatch?.stop();
  const W = { t0: performance.now(), events: {}, paceSec: { loading: 0, idle: 0, play: 0 }, time: {}, pending: {}, awaitedSec: 0 };
  /** Motifs seen not baked since the install: only those can be marked baked (a bake, not a leftover). */
  const unbaked = new Set();
  window.__motifWatch = W;
  const at = () => +((performance.now() - W.t0) / 1000).toFixed(2);
  let last = performance.now();
  const id = setInterval(() => {
    const now = performance.now();
    const rep = audio.bakeReport();
    W.paceSec[rep.pace] = +(W.paceSec[rep.pace] + (now - last) / 1000).toFixed(2);
    if (rep.awaitedMotif) W.awaitedSec = +(W.awaitedSec + (now - last) / 1000).toFixed(2);
    last = now;
    const mark = (name) => {
      if (W.events[name] !== undefined) return;
      W.events[name] = at();
      W.time[name] = rep.time;
      W.pending[name] = rep.bank.pending;
    };
    const bank = audio.bank();
    for (const m of o.motifs) {
      const k = `${m.variant}@${m.tempoScale}`;
      if (!bank?.motif(m)) unbaked.add(k);
      else if (unbaked.has(k)) mark(`baked ${k}`);
    }
    const phase = window.__iceberg?.snapshot().phase;
    if (phase === 'playing' || phase === 'complete') mark(phase);
    if (useStoryRun.getState().epilogue) mark('epilogue');
  }, 100);
  W.stop = () => clearInterval(id);
  return true;
}

/**
 * Page-side: rAF frame intervals over the next `o.ms` of wall time (median, p95, p99, mean, frames
 * over 33.4 ms), the bake's pace at the end, the bank's pending count at both ends, and the bake's
 * main-thread ms per pace meanwhile.
 */
async function frameWindow(o) {
  const { audio } = await import('/src/audio/manager.ts');
  const r0 = audio.bakeReport();
  const ms0 = r0.time ? { ...r0.time.ms } : null;
  const xs = [];
  await new Promise((resolve) => {
    const t0 = performance.now();
    let last = t0;
    const step = (t) => {
      xs.push(t - last);
      last = t;
      if (t - t0 >= o.ms) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  const r1 = audio.bakeReport();
  const srt = xs.slice(1).sort((a, b) => a - b);
  const q = (p) => +srt[Math.min(srt.length - 1, Math.floor(p * srt.length))].toFixed(2);
  const bakeMs = ms0 && r1.time ? Object.fromEntries(Object.keys(r1.time.ms).map((k) => [k, +(r1.time.ms[k] - ms0[k]).toFixed(1)])) : null;
  return { n: srt.length, median: q(0.5), p95: q(0.95), p99: q(0.99), mean: +(srt.reduce((a, x) => a + x, 0) / srt.length).toFixed(2), over33: srt.filter((x) => x > 33.4).length, pace: r1.pace, pendingStart: r0.bank.pending, pendingEnd: r1.bank.pending, bakeMs };
}

/** Page-side: keep every trace entry (the ring holds 4096) in window.__tap, polled every 250 ms. */
function traceTap() {
  if (window.__tap) return true;
  const T = { entries: [], seq: 0 };
  window.__tap = T;
  const poll = () => {
    const api = window.__icebergAudio;
    if (api) {
      for (const e of api.trace(T.seq)) {
        T.seq = e.seq;
        T.entries.push(e);
      }
    }
    setTimeout(poll, 250);
  };
  poll();
  return true;
}

/**
 * Page-side: the newest attempt's trace on the real engine against the run's own event log (the
 * engine's counterpart of bridgeSummary). Its entries are dropped from the tap afterwards.
 */
function engineSummary() {
  const h = window.__iceberg;
  const api = window.__icebergAudio;
  const T = window.__tap;
  if (!h || !api || !T) return { error: 'no game, engine or tap' };
  for (const e of api.trace(T.seq)) {
    T.seq = e.seq;
    T.entries.push(e);
  }
  const log = h.runLog().events;
  let token = -1;
  for (const e of T.entries) if (e.kind === 'event' && e.token > token) token = e.token;
  const all = T.entries.filter((e) => e.token === token);
  const byCause = new Map();
  for (const t of all) {
    if (t.cause < 0) continue;
    let a = byCause.get(t.cause);
    if (!a) byCause.set(t.cause, (a = []));
    a.push(t);
  }
  const types = {};
  let traced = 0;
  let ended = 0;
  let typeMismatch = 0;
  let notDroppedByCap = 0;
  let playedOfThose = 0;
  const unended = [];
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    types[e.type] = (types[e.type] ?? 0) + 1;
    const ts = byCause.get(i + 1) ?? [];
    const ev = ts.find((t) => t.kind === 'event');
    if (!ev) continue;
    traced++;
    if (ev.ev !== e.type) typeMismatch++;
    const byDesign = ev.note === 'no sound by design';
    const played = ts.some((t) => t.kind === 'play' || t.kind === 'coalesce');
    const ok = byDesign || played || ts.some((t) => t.kind === 'drop' && t.reason);
    if (ok) ended++;
    else if (unended.length < 10) unended.push({ seq: i + 1, type: e.type });
    const capped = ts.some((t) => t.kind === 'drop' && ['frameCap', 'rate', 'busy', 'overflow', 'masked', 'quiet', 'culled'].includes(t.reason));
    if (!byDesign && !capped) {
      notDroppedByCap++;
      if (played) playedOfThose++;
    }
  }
  const overflowed = all.filter((t) => t.kind === 'drop' && t.reason === 'overflow').reduce((n, t) => n + Number((/(\d+) events/.exec(t.note ?? '') ?? [0, 0])[1]), 0);
  const drops = {};
  for (const t of all) if (t.kind === 'drop' && t.reason) drops[t.reason] = (drops[t.reason] ?? 0) + 1;
  // One request = the play entries of one cause in one frame (one per layer that started).
  const groups = new Map();
  for (const t of all) {
    if (t.kind !== 'play' || t.cause < 0) continue;
    const k = `${t.cause}|${t.frame}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push(t);
  }
  const perFrame = new Map();
  for (const g of groups.values()) perFrame.set(g[0].frame, (perFrame.get(g[0].frame) ?? 0) + 1);
  const families = {};
  const sounds = {};
  for (const t of all) {
    if (t.kind !== 'play' || !t.sound) continue;
    families[t.family] = (families[t.family] ?? 0) + 1;
    sounds[t.sound] = (sounds[t.sound] ?? 0) + 1;
  }
  const K = window.__kindSounds;
  const hits = [];
  const breaks = [];
  const brokenPlacements = new Set();
  let kindMismatch = 0;
  for (const g of groups.values()) {
    const cause = g[0].cause;
    const e = log[cause - 1];
    const ev = (byCause.get(cause) ?? []).find((t) => t.kind === 'event');
    if (!e || !ev) continue;
    if (e.type === 'collision' && g[0].family === 'hit') {
      const k = K && ev.note ? K[ev.note] : null;
      const main = (k && g.find((t) => t.sound === k.hit || t.sound === k.hitHeavy)) || g[0];
      if (k && ![k.hit, k.hitHeavy].includes(main.sound)) kindMismatch++;
      hits.push({ kind: ev.note, sound: main.sound, gainDb: main.gainDb, reqDb: main.requestDb ?? null, distM: main.distM ?? 0, active: main.activeVoices ?? 0, impulse: e.impulse, relSpeed: e.relSpeed, m: ev.input?.m ?? null });
    } else if (e.type === 'obstacleBroken' || e.type === 'treeFelled') {
      // A placement's first break is the break; later bodies of it are add-ons (9 dB under).
      const key = `${ev.placement ?? 'x' + cause}`;
      const addOn = e.type === 'obstacleBroken' && brokenPlacements.has(key);
      brokenPlacements.add(key);
      const peak = g.reduce((m, t) => (t.gainDb > m.gainDb ? t : m), g[0]);
      const req = Math.max(...g.map((t) => t.requestDb ?? -Infinity));
      breaks.push({ kind: ev.note, family: g[0].family, sounds: g.map((t) => t.sound), peakDb: peak.gainDb, reqDb: Number.isFinite(req) ? req : null, distM: peak.distM ?? 0, massT: ev.input?.massT ?? null, addOn });
    }
  }
  // Engine fidelity: each play's level against its request. Jitter is ± VARIATION[family].gainDb;
  // density compensation is 1/sqrt(1 + densityK·n) with n the family's voices before it, at most the
  // voices active after it (activeVoices); distance is (40/d) beyond 40 m (SPATIAL.effects).
  const V = window.__variation;
  const fidelity = { n: 0, outside: [], maxUp: -Infinity, maxDown: Infinity };
  for (const t of all) {
    if (t.kind !== 'play' || typeof t.requestDb !== 'number' || typeof t.gainDb !== 'number' || !V) continue;
    const dist = t.distM > 40 ? 20 * Math.log10(40 / t.distM) : 0;
    const dev = t.gainDb - t.requestDb - dist;
    const jit = V.jitter[t.family] ?? 0;
    const dens = 10 * Math.log10(1 + V.densityK * (t.activeVoices ?? 0));
    fidelity.n++;
    fidelity.maxUp = Math.max(fidelity.maxUp, dev);
    fidelity.maxDown = Math.min(fidelity.maxDown, dev);
    if (dev > jit + 0.05 || dev < -jit - dens - 0.05) fidelity.outside.push(`${t.sound} ${dev.toFixed(2)} dB (jitter ${jit}, active ${t.activeVoices})`);
  }
  const bellEntries = all.filter((t) => t.kind === 'bell');
  const strikes = bellEntries.filter((t) => / strike /.test(` ${t.note ?? ''} `) && !/^bell-/.test(t.note ?? ''));
  const notes = bellEntries.filter((t) => /^bell-/.test(t.note ?? '')).map((t) => ({ frame: t.frame, gt: +(t.gt ?? 0).toFixed(1), note: t.note }));
  const byVoicing = {};
  for (const t of strikes) if (!t.reason) byVoicing[t.note.split(' ')[0]] = (byVoicing[t.note.split(' ')[0]] ?? 0) + 1;
  const ducks = all.filter((t) => t.kind === 'duck').map((t) => t.note);
  const plays = all.filter((t) => t.kind === 'play' && t.sound).map((t) => ({ kind: 'play', t: t.t, sound: t.sound, family: t.family, priority: t.priority, variant: t.variant, gainDb: t.gainDb, lowpassHz: t.lowpassHz, pan: t.pan, rate: t.rate }));
  // Keep the app-level entries (token 0: motifs, holds, app ducks) and anything newer.
  T.entries = T.entries.filter((e) => e.token > token || e.token === 0);
  const silencedFrame = notes.find((n) => n.note.startsWith('bell-silenced'))?.frame ?? null;
  return {
    token,
    events: log.length,
    types,
    traced,
    ended,
    overflowed,
    typeMismatch,
    unended,
    notDroppedByCap,
    playedOfThose,
    drops,
    requests: groups.size,
    maxAdmittedInFrame: Math.max(0, ...perFrame.values()),
    maxLayers: Math.max(0, ...[...groups.values()].map((g) => g.length)),
    families,
    sounds,
    hits,
    breaks,
    kindMismatch,
    bells: {
      strikes: strikes.filter((t) => !t.reason).length,
      notReady: strikes.filter((t) => t.reason === 'notReady').length,
      cap: strikes.filter((t) => t.reason === 'cap').length,
      shivers: bellEntries.filter((t) => / shiver /.test(` ${t.note ?? ''} `) && !t.reason).length,
      clanks: bellEntries.filter((t) => / clank /.test(` ${t.note ?? ''} `) && !t.reason).length,
      byVoicing,
      notes,
      afterSilence: silencedFrame === null ? null : strikes.filter((t) => !t.reason && t.frame > silencedFrame).length,
    },
    ducks,
    plays,
    fidelity,
    notReady: (window.__icebergAudio.bake?.() ?? {}).notReady ?? null,
  };
}

/**
 * S4 (DESIGN §11.3) on the levels the magnitude mapping asked for (`reqDb`): Spearman ρ(impulse,
 * level) of played hits >= 0.9, every collapse >= the median small-rock hit + 12 dB, the median break
 * above the 90th-percentile hit; and, a property of the mapping, within one hit sound the level never
 * falls as m rises. The engine's jitter and density compensation come after the mapping and are
 * checked on their own (S3E's engine fidelity); see docs/evidence/AUDIO_RUNS.md for why the threshold
 * is applied here and not to the levels as played.
 */
function s4Checks(sc, allHits, breaks, tag) {
  const hits = allHits.filter((h) => typeof h.impulse === 'number' && typeof h.reqDb === 'number');
  const J = hits.map((h) => h.impulse);
  const L = hits.map((h) => h.reqDb);
  const rho = spearman(J, L);
  const ci = bootstrapRho(J, L);
  sc.data.s4 = { n: hits.length, rho, ci, rhoEnergy: spearman(hits.map((h) => h.impulse * h.relSpeed), L), rhoM: spearman(hits.map((h) => h.m), L) };
  sc.check(`S4 (${tag}): Spearman ρ(impulse, requested level) of played hits >= 0.9`, rho >= 0.9, { rho: +rho.toFixed(3), n: hits.length, ci95: ci.map((x) => +x.toFixed(3)) }, '>= 0.9');
  const lanes8 = hits.filter((h) => s4LaneRun(h.level));
  if (lanes8.length >= 3) sc.note(`S4 (${tag}): over the ±8 m lanes only (S4_LANES; in S4M's sample too, so not held out): ρ ${spearman(lanes8.map((h) => h.impulse), lanes8.map((h) => h.reqDb)).toFixed(3)}, n ${lanes8.length}; the other lines ρ ${spearman(hits.filter((h) => !s4LaneRun(h.level)).map((h) => h.impulse), hits.filter((h) => !s4LaneRun(h.level)).map((h) => h.reqDb)).toFixed(3)}, n ${hits.length - lanes8.length}`);
  sc.note(`S4 (${tag}): ρ(impulse × closing speed, requested level) ${sc.data.s4.rhoEnergy.toFixed(3)}; ρ(m, requested level) ${sc.data.s4.rhoM.toFixed(3)}`);
  const bySound = {};
  for (const h of hits) if (typeof h.m === 'number') (bySound[h.sound] ??= []).push(h);
  const inverted = Object.entries(bySound).flatMap(([sound, hs]) => {
    const srt = [...hs].sort((a, c) => a.m - c.m);
    return srt.slice(1).filter((h, i) => h.reqDb < srt[i].reqDb - 1e-6).map((h) => `${sound} m ${h.m.toFixed(3)}`);
  });
  sc.check(`S4 (${tag}): within each hit sound, the requested level never falls as m rises`, inverted.length === 0, { sounds: Object.keys(bySound).length, inverted });
  const smallRock = median(hits.filter((h) => h.kind === 'rockSmall').map((h) => h.reqDb));
  const brk = breaks.filter((x) => typeof x.reqDb === 'number');
  const collapses = brk.filter((x) => (x.family === 'breakStructure' || x.family === 'dam') && !x.addOn);
  if (collapses.length && Number.isFinite(smallRock)) {
    const low = collapses.reduce((a, x) => (x.reqDb < a.reqDb ? x : a), collapses[0]);
    sc.check(`S4 (${tag}): every collapse >= the median small-rock hit + 12 dB`, low.reqDb >= smallRock + 12, { lowestCollapse: +low.reqDb.toFixed(1), what: `${low.kind} ${low.massT?.toFixed?.(1) ?? ''} t`, smallRockMedian: +smallRock.toFixed(1), collapses: collapses.length }, '+12 dB');
  } else sc.na(`S4 (${tag}): collapse vs small rock`, `${collapses.length} collapses, ${hits.filter((h) => h.kind === 'rockSmall').length} small-rock hits`);
  const whole = brk.filter((x) => !x.addOn);
  if (whole.length && hits.length) {
    const brkMed = median(whole.map((x) => x.reqDb));
    const hit90 = quantile(L, 0.9);
    sc.check(`S4 (${tag}): the median break is above the 90th-percentile hit`, brkMed > hit90, { breakMedian: +brkMed.toFixed(1), hitP90: +hit90.toFixed(1), breaks: whole.length });
  }
}

/** Bootstrap 95 % interval of Spearman ρ (2000 resamples, SEED 42). */
function bootstrapRho(a, b) {
  let seed = SEED;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const rs = [];
  for (let k = 0; k < 2000 && a.length >= 3; k++) {
    const idx = a.map(() => Math.floor(rnd() * a.length));
    const r = spearman(idx.map((i) => a[i]), idx.map((i) => b[i]));
    if (Number.isFinite(r)) rs.push(r);
  }
  rs.sort((x, y) => x - y);
  return rs.length ? [rs[Math.floor(0.025 * rs.length)], rs[Math.floor(0.975 * rs.length)]] : [NaN, NaN];
}

/**
 * S4 as played (engine): ρ against the played level at the source (distance taken out), the requested
 * level, and what ±jitter dB of uniform jitter alone would do to the requested levels' ρ (2000 draws).
 */
function magnitudeReport(hits, jitterDb) {
  const dist = (d) => (d > 40 ? 20 * Math.log10(40 / d) : 0);
  const J = hits.map((h) => h.impulse);
  const src = hits.map((h) => h.gainDb - dist(h.distM));
  const req = hits.map((h) => h.reqDb);
  let seed = SEED;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const sims = [];
  for (let k = 0; k < 2000 && hits.length >= 3; k++) sims.push(spearman(J, req.map((x) => x + (rnd() * 2 - 1) * jitterDb)));
  sims.sort((x, y) => x - y);
  return {
    n: hits.length,
    rhoImpulseAtSource: spearman(J, src),
    rhoImpulseRequest: spearman(J, req),
    rhoMAtSource: spearman(hits.map((h) => h.m), src),
    rhoEnergyAtSource: spearman(hits.map((h) => h.impulse * h.relSpeed), src),
    bootstrap95: bootstrapRho(J, src),
    jitterSim: sims.length ? { mean: sims.reduce((a, x) => a + x, 0) / sims.length, p5: sims[Math.floor(0.05 * sims.length)], p95: sims[Math.floor(0.95 * sims.length)] } : null,
  };
}

// --- BAKE: the level set from a cold start ----------------------------------------------------------

const RIVERSIDE_BEFORE = ['mountain-valley', 'rocky-canyon', 'alpine-pass'];
/**
 * menuMs: how long the main menu (or the Story menu) is on screen before the first click. 1500 is a
 * quick player; 0 clicks as soon as the button exists (the worst case: almost nothing baked before).
 */
const BAKE_RUNS = [
  { name: 'riverside-arcade', level: 'riverside-town', before: RIVERSIDE_BEFORE, bell: 'st-brides', playSec: 60, menuMs: 1500 },
  { name: 'riverside-arcade-instant', level: 'riverside-town', before: RIVERSIDE_BEFORE, bell: 'st-brides', playSec: 60, menuMs: 0 },
  { name: 'riverside-ch4', chapter: 'ch4-people', level: 'riverside-town', bell: 'st-brides', playSec: 60, menuMs: 1500 },
  { name: 'power-valley', level: 'power-valley', before: [...RIVERSIDE_BEFORE, 'riverside-town', 'glacier-avalanche'], bell: null, playSec: 45, menuMs: 1500 },
];

/**
 * Page-side: a collector from the moment it is installed. Frame intervals (rAF) and long tasks, each
 * labelled with the screen or the game phase; every 100 ms the bank (pending, ready, the level's bell
 * strike baked); the trace's bell entries, notReady drops, played one-shots and lifecycle notes.
 */
async function bakeProbe(o) {
  const [{ useAppStore }, { useGameStore }, mgr, ls] = await Promise.all([
    import('/src/state/appStore.ts'),
    import('/src/state/gameStore.ts'),
    import('/src/audio/manager.ts'),
    import('/src/audio/game/levelSet.ts'),
  ]);
  // The run's own set: its sounds and bell strikes (motifs aside: they play after a run).
  const set = ls.levelSoundSet(o.level, o.chapter ?? null);
  const P = { t0: performance.now(), frames: [], longtasks: [], samples: [], bells: [], notReady: [], plays: 0, notes: [], gesture: null, stop: false };
  window.__bakeProbe = P;
  const label = () => {
    const app = useAppStore.getState();
    return app.screen !== 'game' ? app.screen : useGameStore.getState().phase;
  };
  const now = () => performance.now() - P.t0;
  addEventListener('pointerdown', () => (P.gesture ??= now()), { capture: true });
  addEventListener('keydown', () => (P.gesture ??= now()), { capture: true });
  let last = performance.now();
  const raf = (t) => {
    P.frames.push([+(t - P.t0).toFixed(1), +(t - last).toFixed(2), label()]);
    last = t;
    if (!P.stop) requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) P.longtasks.push([+(e.startTime - P.t0).toFixed(1), +e.duration.toFixed(1), label()]);
    }).observe({ type: 'longtask' });
  } catch {}
  let seq = 0;
  const poll = () => {
    const api = window.__icebergAudio;
    if (api && api.state().available) {
      const st = api.state();
      const bank = typeof mgr.audio.bank === 'function' ? mgr.audio.bank() : null;
      const sounds = bank ? set.sounds.every((id) => bank.ready(id)) && set.bells.every((v) => bank.bell(v, 'strike') !== null) : false;
      P.samples.push({ t: +now().toFixed(0), label: label(), status: st.status, pending: st.bank.pending, ready: st.bank.ready, bell: o.bell && bank ? bank.bell(o.bell, 'strike') !== null : null, sounds });
      for (const e of api.trace(seq)) {
        seq = e.seq;
        if (e.kind === 'bell') P.bells.push({ t: +now().toFixed(0), reason: e.reason ?? null, note: e.note });
        else if (e.kind === 'drop' && e.reason === 'notReady') P.notReady.push({ t: +now().toFixed(0), sound: e.sound, family: e.family });
        else if (e.kind === 'play') P.plays++;
        else if (e.kind === 'lifecycle' && /bake|notReady|session/.test(e.note ?? '')) P.notes.push({ t: +now().toFixed(0), note: e.note });
      }
    }
    if (!P.stop) setTimeout(poll, 100);
  };
  poll();
  return true;
}

/** Page-side: the collector's results, summarised. */
function bakeResults() {
  const P = window.__bakeProbe;
  P.stop = true;
  const stats = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null);
    return { n: s.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s.length ? s[s.length - 1] : null, over50: s.filter((x) => x > 50).length, mean: s.length ? +(s.reduce((a, x) => a + x, 0) / s.length).toFixed(2) : null };
  };
  const first = (pred) => P.frames.find(pred)?.[0] ?? null;
  const gameAt = first((f) => f[2] === 'loading' || f[2] === 'intro' || f[2] === 'playing');
  const playAt = first((f) => f[2] === 'playing');
  const loadingEnd = first((f) => gameAt !== null && f[0] > gameAt && f[2] !== 'loading');
  const byLabel = {};
  for (const [t, dt, l] of P.frames) (byLabel[l] ??= []).push(dt);
  // Play frames split: the first 10 s of play, and after.
  const play10 = P.frames.filter((f) => f[2] === 'playing' && playAt !== null && f[0] < playAt + 10000).map((f) => f[1]);
  const playLate = P.frames.filter((f) => f[2] === 'playing' && playAt !== null && f[0] >= playAt + 10000).map((f) => f[1]);
  const lt = {};
  for (const [, d, l] of P.longtasks) {
    lt[l] ??= { n: 0, ms: 0, max: 0 };
    lt[l].n++;
    lt[l].ms = +(lt[l].ms + d).toFixed(1);
    lt[l].max = Math.max(lt[l].max, d);
  }
  const requested = P.samples.find((s) => s.pending > 0 && gameAt !== null && s.t >= (P.gesture ?? 0))?.t ?? null;
  const bakedAt = P.samples.find((s) => requested !== null && s.t > requested && s.pending === 0 && s.ready > 0)?.t ?? null;
  const bellAt = P.samples.find((s) => s.bell === true)?.t ?? null;
  const soundsAt = P.samples.find((s) => s.sounds === true)?.t ?? null;
  const strikes = P.bells.filter((x) => / strike /.test(` ${x.note} `) || /^\S+ strike/.test(x.note ?? ''));
  return {
    gesture: P.gesture,
    gameAt,
    loadingEnd,
    playAt,
    bellBakedAt: bellAt,
    soundsBakedAt: soundsAt,
    setBakedAt: bakedAt,
    lastSample: P.samples.at(-1) ?? null,
    frames: Object.fromEntries(Object.entries(byLabel).map(([l, xs]) => [l, stats(xs)])),
    play10: stats(play10),
    playLate: stats(playLate),
    longtasks: lt,
    bellStrikes: { played: strikes.filter((x) => x.reason === null).length, notReady: strikes.filter((x) => x.reason === 'notReady').length, cap: strikes.filter((x) => x.reason === 'cap').length },
    bellNotes: P.bells.filter((x) => /^bell-/.test(x.note ?? '')).map((x) => `${x.t} ${x.note}`),
    bellEntries: P.bells.slice(0, 60).map((x) => `${x.t} ${x.reason ?? 'played'} ${x.note}`),
    notReady: { total: P.notReady.length, bySound: P.notReady.reduce((a, x) => ((a[x.sound] = (a[x.sound] ?? 0) + 1), a), {}), first: P.notReady[0] ?? null, last: P.notReady.at(-1) ?? null },
    plays: P.plays,
    notes: P.notes.slice(-20),
    bake: window.__icebergAudio?.bake?.() ?? null,
  };
}

async function bakeRuns(b, sc, off) {
  const base = opts.url + (off ? '?audio=off' : '');
  const results = {};
  for (const run of BAKE_RUNS) {
    const progress = { version: 1, completed: Object.fromEntries((run.before ?? []).map((id) => [id, { bestTime: 100, bestScore: 1000, completions: 1 }])) };
    const storyDone = run.chapter ? ['ch1-beginning', 'ch2-measurements', 'ch3-warning'] : [];
    // A fresh document with a seeded profile; the probe goes in as soon as the app has rendered.
    await b.send('Page.navigate', { url: pageUrl(base) });
    await b.until('document.readyState === "complete"', FIRST_RENDER_MS);
    await b.call(seedProfile, { settings: { unlockAllLevels: false }, progress, storyCompleted: storyDone });
    b.console.length = 0;
    await b.send('Page.reload', { ignoreCache: false });
    await sleep(300);
    if ((await b.until('document.querySelector(".app") !== null && [...document.querySelectorAll("button")].some((x) => /^(Play|Story)/.test(x.textContent.trim()))', FIRST_RENDER_MS)) < 0) throw notRendered();
    await b.call(bakeProbe, { bell: run.bell, level: run.level, chapter: run.chapter ?? null });
    await sleep(run.menuMs);
    if (run.chapter) {
      // The first click opens Story (and unlocks the audio); the card, then Begin after 0.6 s.
      await b.clickText('button', /^Story/);
      await sleep(300);
      await b.call(nav, { chapterCard: run.chapter });
      await sleep(600);
      await b.call(nav, { chapter: run.chapter });
    } else {
      const label = await b.evaluate(`[...document.querySelectorAll('button')].find((x) => /^Play/.test(x.textContent.trim()))?.textContent ?? ''`);
      sc.note(`${run.name}: the main menu's Play reads "${label.replace(/\s+/g, ' ').trim()}"`);
      await b.clickText('button', /^Play/);
    }
    const ms = await b.until(playingPhase, 120000);
    if (ms < 0) throw new Error(`${run.name}: never reached play`);
    const d = await b.call(drive, { speed: 1, maxSec: run.playSec, lane: 0 });
    await sleep(500);
    const r = await b.call(bakeResults);
    r.drive = d;
    results[run.name] = r;
    r.menuMs = run.menuMs;
    const rel = (t) => (t === null || r.gesture === null ? null : +((t - r.gesture) / 1000).toFixed(2));
    console.log(`  ${run.name}${off ? ' (audio=off)' : ''}: gesture→game ${rel(r.gameAt)} s, loading ends ${rel(r.loadingEnd)} s, play ${rel(r.playAt)} s, bell baked ${rel(r.bellBakedAt)} s, sounds baked ${rel(r.soundsBakedAt)} s, set baked ${rel(r.setBakedAt)} s; strikes ${JSON.stringify(r.bellStrikes)}; notReady ${r.notReady.total} ${JSON.stringify(r.notReady.bySound)}`);
    console.log(`    frames loading ${JSON.stringify(r.frames.loading)} | play first 10 s ${JSON.stringify(r.play10)} | play after ${JSON.stringify(r.playLate)} | long tasks ${JSON.stringify(r.longtasks)}`);
    if (!off) {
      if (run.bell) {
        sc.check(`${run.name}: every bell strike asked for was played (none dropped as notReady)`, r.bellStrikes.played > 0 && r.bellStrikes.notReady === 0, r.bellStrikes, 'played > 0, notReady 0');
        sc.check(`${run.name}: the bell strike was baked before play began`, r.bellBakedAt !== null && r.playAt !== null && r.bellBakedAt <= r.playAt, { bell: rel(r.bellBakedAt), play: rel(r.playAt) });
      }
      sc.check(`${run.name}: every sound and bell strike of the set baked by the end of the run`, r.soundsBakedAt !== null, { sounds: rel(r.soundsBakedAt), withMotifs: rel(r.setBakedAt) });
      sc.check(`${run.name}: no sound dropped as notReady`, r.notReady.total === 0, r.notReady.bySound, 0);
    }
  }
  sc.data.runs = results;
  await consoleProblems(b, sc);
}

function median(xs) {
  return quantile(xs, 0.5);
}
function quantile(xs, q) {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo);
}
function ranks(xs) {
  const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}
function spearman(a, b) {
  if (a.length < 3) return NaN;
  return pearson(ranks(a), ranks(b));
}
function pearson(ra, rb) {
  if (ra.length < 3) return NaN;
  const n = ra.length;
  const ma = ra.reduce((s, x) => s + x, 0) / n;
  const mb = rb.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let dbb = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    dbb += (rb[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * dbb);
}

const TITLES = {
  S1: ['Autoplay: nothing before a gesture, unlock on the first click', 'engine'],
  S2: ['Arcade basics: K.545 under the effects, the fade on leaving', 'engine'],
  S6: ['Volume controls by keyboard, the M key, persistence', 'engine'],
  S7: ['Pause, rapid toggles and blur', 'engine'],
  S8: ['Leave, retry, level change: every attempt\'s sound ends', 'bridge'],
  S3: ['Event coverage on every level, and magnitude in the wild (S4)', 'bridge'],
  S5: ['Rapid collisions: fastForward bursts stay bounded', 'bridge'],
  S9: ['Hidden tab', 'engine'],
  S10: ['Church bells: every church rings, the hour, levels without a church', 'bridge'],
  S11: ['Story moments: revelation, river view, ch8 card, ch9 chapel and sea, epilogue, narrative off', 'bridge'],
  CALVE: ['The intro\'s calving (P1): full on the first attempt, the short beat on Retry', 'bridge'],
  S12: ['Performance', 'engine'],
  R: ['Offline renders (lab)', 'engine'],
  S0: ['Clock sanity: the audio clock against the wall clock, a fired sound on the meter', 'engine'],
  S13: ['Determinism: the same lab sequence twice; the bank checksum (R9); every motif on the main thread and in the worker against node', 'engine'],
  S3E: ['S3/S4 on the real engine: coverage, magnitude in the wild, mix replays (R11)', 'engine'],
  S4M: ['The magnitude mapping against every collision of nine levels on five lines (audio off)', 'physics'],
  S8E: ['S8 on the real engine: Retry, level change, quit and leaving Story end every sound', 'engine'],
  S10E: ['S10 on the real engine: every church level from the menu, strikes played or dropped', 'engine'],
  S5E: ['S5 on the real engine: fastForward bursts on the plant line; voices, master peak, drops', 'engine'],
  S11E: ['S11 on the real engine: the ch8 card, chapter 1 and chapter 9 motifs, the chapel, the epilogue', 'engine'],
  S14: ['Story restarts on the same screen: Replay chapter, Continue with narrative off', 'engine'],
  EPI: ["The epilogue motif's bake on the main thread (?audioworker=off): Revelation frame time at the idle and loading paces; the epilogue started with its motif unbaked", 'engine'],
  EPIW: ["The epilogue started with its motif unbaked, the motifs rendered in a Web Worker (as the game ships)", 'engine'],
  BAKE: ['The level set from a cold start straight into play: bells, notReady drops, frame times', 'engine'],
  BAKEOFF: ['The same flows with ?audio=off (the frame-time baseline)', 'engine'],
};

// --- run --------------------------------------------------------------------------------------------------

async function main() {
  const server = opts.serve ? await startServer(opts.port) : null;
  if (server) opts.url = server.url;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.resolve(ROOT, opts.out, stamp);
  mkdirSync(outDir, { recursive: true });
  const ORDER = ['S0', 'S1', 'S2', 'S3', 'S3E', 'S4M', 'S5', 'S5E', 'S6', 'S7', 'S8', 'S8E', 'S9', 'S10', 'S10E', 'S11', 'S11E', 'EPI', 'EPIW', 'S14', 'CALVE', 'S12', 'S13', 'R', 'BAKE', 'BAKEOFF'];
  const ids = ORDER.filter((id) => SCENARIOS[id] && (opts.only === null || opts.only.includes(id)));
  const unknown = (opts.only ?? []).filter((id) => !SCENARIOS[id]);
  if (unknown.length) console.warn(`unknown scenario(s) ignored: ${unknown.join(', ')} (known: ${ORDER.join(', ')}; S4 runs inside S3)`);
  const results = [];
  let browserVersion = '';
  console.log(`audio-e2e on ${opts.url} (seed ${SEED}${opts.cpuThrottle > 1 ? `, CPU throttled ${opts.cpuThrottle}x` : ''}${opts.readSec !== 20 ? `, S11E reads ${opts.readSec} s` : ''}${opts.audioWorker === 'off' ? ', motif worker off' : ''}), scenarios ${ids.join(', ')}; output ${outDir}`);
  for (const id of ids) {
    const [title, kind] = TITLES[id];
    const sc = new Scenario(id, title, kind);
    console.log(`\n${id} [${kind}] ${title}`);
    const b = await Browser.launch();
    browserVersion ||= b.version;
    const t0 = Date.now();
    try {
      await SCENARIOS[id](b, sc);
    } catch (err) {
      sc.check('scenario ran to the end', false, String(err?.stack ?? err).slice(0, 600));
    } finally {
      sc.data.console = b.console.slice(-60);
      sc.data.wallSec = (Date.now() - t0) / 1000;
      // Closing the browser must not lose the scenario's results.
      await b.close().catch((err) => console.warn(`  (closing the browser failed: ${err?.message ?? err})`));
    }
    results.push(sc);
    writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify(sc, null, 1));
  }
  server?.stop();
  const rows = results.map((sc) => {
    const pass = sc.checks.filter((c) => c.pass === true).length;
    const fail = sc.checks.filter((c) => c.pass === false).length;
    const na = sc.checks.filter((c) => c.pass === null).length;
    return { id: sc.id, kind: sc.kind, title: sc.title, pass, fail, na, wallSec: Math.round(sc.data.wallSec) };
  });
  const md = [
    `# audio-e2e ${stamp}`,
    '',
    `Server ${opts.url}, ${browserVersion || 'browser version unknown'}, ${os.platform()} ${os.release()}, seed ${SEED}${opts.cpuThrottle > 1 ? `, CPU throttled ${opts.cpuThrottle}x` : ''}${opts.readSec !== 20 ? `, S11E reads ${opts.readSec} s` : ''}${opts.audioWorker === 'off' ? ', motif worker off (?audioworker=off)' : ''}. ` +
      '"bridge" = the real 3D view playing into a recording engine; "engine" = the page\'s own audio.',
    '',
    '| Scenario | Evidence | Pass | Fail | n/a | Wall s |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
    ...rows.map((r) => `| ${r.id} ${r.title} | ${r.kind} | ${r.pass} | ${r.fail} | ${r.na} | ${r.wallSec} |`),
    '',
    ...results.flatMap((sc) => [
      `## ${sc.id} ${sc.title}`,
      '',
      ...sc.checks.map((c) => `- ${c.pass === true ? 'PASS' : c.pass === false ? '**FAIL**' : 'n/a'} ${c.name}: \`${JSON.stringify(c.value)}\`${c.expect !== undefined ? ` (want ${c.expect})` : ''}`),
      ...sc.notes.map((n) => `- note: ${n}`),
      '',
    ]),
  ].join('\n');
  writeFileSync(path.join(outDir, 'summary.md'), md);
  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(rows, null, 1));
  console.log(`\n${rows.map((r) => `${r.id}: ${r.pass} pass, ${r.fail} fail, ${r.na} n/a`).join('\n')}\nsummary: ${path.join(outDir, 'summary.md')}`);
  process.exit(rows.some((r) => r.fail > 0) ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
