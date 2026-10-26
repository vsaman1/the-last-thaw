// Profile the first click (the audio unlock) on the main menu: node first-click-profile.mjs <url> [ms on the menu first]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const url = process.argv[2] ?? 'http://localhost:5199/';
const waitMs = Number(process.argv[3] ?? 1500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9800 + Math.floor(Math.random() * 100);
const profile = mkdtempSync(path.join(os.tmpdir(), 'prof-'));
const proc = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--mute-audio', '--autoplay-policy=document-user-activation-required', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
let ws;
for (let i = 0; i < 100 && !ws; i++) { try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} if (!ws) await sleep(200); }
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pend = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await sleep(1500);
await ev(`(() => { localStorage.clear(); localStorage.setItem('iceberg-river.settings.v1', JSON.stringify({ skipIntros: true, quality: 'low', mouseSteering: false })); localStorage.setItem('iceberg-river.story.v1', JSON.stringify({ version: 1, completed: [], archive: [], settings: { narrative: true, ai: 'off' } })); return true; })()`);
await send('Page.reload', {});
await sleep(1000 + waitMs);
await ev(`(() => { window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask' }); return true; })()`);
await send('Profiler.enable');
await send('Profiler.setSamplingInterval', { interval: 100 });
await send('Profiler.start');
for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: 4, y: 4, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
await sleep(1500);
const prof = (await send('Profiler.stop')).result.profile;
const lt = await ev('JSON.stringify(window.__lt)');
console.log('long tasks after the click:', lt, 'status', await ev('window.__icebergAudio?.state().status'));
// self time per function
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = prof.timeDeltas;
for (let i = 0; i < prof.samples.length; i++) { const n = byId.get(prof.samples[i]); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0) / 1000); }
const top = [...self.entries()].filter(([k]) => !/^\(idle\)|^\(program\)|^\(garbage/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 25);
for (const [k, ms] of top) console.log(ms.toFixed(1).padStart(7), 'ms', k);
// inclusive time of a few interesting frames
const parent = new Map(); for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const incl = new Map();
for (let i = 0; i < prof.samples.length; i++) { let nid = prof.samples[i]; const seen = new Set(); while (nid !== undefined) { const n = byId.get(nid); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-1)[0]}:${n.callFrame.lineNumber + 1}`; if (!seen.has(k)) { incl.set(k, (incl.get(k) ?? 0) + (dt[i] ?? 0) / 1000); seen.add(k); } nid = parent.get(nid); } }
console.log('--- inclusive (audio files) ---');
for (const [k, ms] of [...incl.entries()].filter(([k]) => /audio|synth|manager|graph|ir\.ts|noise|voices/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(ms.toFixed(1).padStart(7), 'ms', k);
ws.close(); proc.kill(); await sleep(500); rmSync(profile, { recursive: true, force: true });
