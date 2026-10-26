// Page-side helpers shared by the review's step files (serialised into the page as strings).

export const SEED_AND_RELOAD = (seed = {}) => `(() => {
  localStorage.clear();
  const settings = Object.assign({ skipIntros: true, unlockAllLevels: true, quality: 'low', mouseSteering: false }, ${JSON.stringify(seed.settings ?? {})});
  localStorage.setItem('iceberg-river.settings.v1', JSON.stringify(settings));
  localStorage.setItem('iceberg-river.story.v1', JSON.stringify({ version: 1, completed: ${JSON.stringify(seed.storyCompleted ?? [])}, archive: [], settings: { narrative: ${seed.narrative ?? true}, ai: 'off' } }));
  setTimeout(() => location.reload(), 50);
  return true;
})()`;

export const HOOK_MEDIA = `(() => {
  window.__media = new Set();
  const op = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { window.__media.add(this); return op.apply(this, arguments); };
  return true;
})()`;

export const DRIVE = (lane = 0) => `(() => {
  window.__drive = true;
  const step = () => {
    const h = window.__iceberg;
    if (h && window.__drive) h.autopilot(true, ${lane});
    if (window.__drive) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return true;
})()`;

/** Capture the master, ambience and effects buses (post-gain taps) for `sec` of context time. */
export const CAPTURE = (sec, buses = ['master', 'ambience', 'effects']) => `(async () => {
  const { audio } = await import('/src/audio/manager.ts');
  const an = await import('/src/audio/analysis.ts');
  const g = audio.graph();
  if (!g || !g.meters) return { error: 'no graph or meters' };
  const ctx = g.ctx;
  const taps = [];
  for (const b of ${JSON.stringify(buses)}) {
    const sp = ctx.createScriptProcessor(4096, 2, 2);
    const L = [], R = [];
    sp.onaudioprocess = (e) => { L.push(new Float32Array(e.inputBuffer.getChannelData(0))); R.push(new Float32Array(e.inputBuffer.getChannelData(1))); };
    g.meters[b].connect(sp);
    sp.connect(ctx.destination);
    taps.push({ b, sp, L, R });
  }
  const media = [];
  const t0 = ctx.currentTime;
  const w0 = performance.now();
  const ducks = [];
  while (ctx.currentTime - t0 < ${sec}) {
    for (const el of window.__media ?? []) if (!el.paused) media.push({ src: el.src.split('/').pop(), v: el.volume, t: el.currentTime, muted: el.muted, ct: ctx.currentTime - t0 });
    const st = window.__icebergAudio.state();
    ducks.push(st.music ?? null);
    await new Promise((r) => setTimeout(r, 250));
  }
  const t1 = ctx.currentTime;
  const cat = (arr) => { const n = arr.reduce((a, x) => a + x.length, 0); const o = new Float32Array(n); let k = 0; for (const x of arr) { o.set(x, k); k += x.length; } return o; };
  const out = { ctxSec: t1 - t0, wallSec: (performance.now() - w0) / 1000, sampleRate: ctx.sampleRate, buses: {} };
  for (const t of taps) {
    try { g.meters[t.b].disconnect(t.sp); } catch {}
    t.sp.disconnect();
    const l = cat(t.L), r = cat(t.R);
    const lo = an.loudness([l, r], ctx.sampleRate);
    out.buses[t.b] = { lufsI: +lo.integrated.toFixed(2), ungated: +lo.ungated.toFixed(2), mMax: +lo.momentaryMax.toFixed(2), rmsDb: +an.rmsDb(l).toFixed(2), peakDb: +an.peakDb(l).toFixed(2), sec: +(l.length / ctx.sampleRate).toFixed(2) };
  }
  // The music: the dominant element over the window, its played segment decoded and measured at its volume.
  const bySrc = {};
  for (const m of media) (bySrc[m.src] ??= []).push(m);
  const srcs = Object.entries(bySrc).sort((a, b) => b[1].length - a[1].length);
  out.mediaSamples = media.length;
  out.music = [];
  for (const [src, arr] of srcs.slice(0, 2)) {
    const tA = Math.min(...arr.map((x) => x.t)), tB = Math.max(...arr.map((x) => x.t));
    const vPow = arr.reduce((a, x) => a + x.v * x.v * (x.muted ? 0 : 1), 0) / arr.length;
    const bytes = await (await fetch('/audio/' + src)).arrayBuffer();
    const dctx = new OfflineAudioContext(2, 1, 48000);
    const buf = await dctx.decodeAudioData(bytes);
    const a0 = Math.floor(tA * buf.sampleRate), a1 = Math.min(buf.length, Math.ceil(tB * buf.sampleRate));
    const chans = [];
    for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) chans.push(buf.getChannelData(c).slice(a0, a1));
    if (chans.length === 1) chans.push(chans[0]);
    const lo = an.loudness(chans, buf.sampleRate);
    const vDb = 10 * Math.log10(Math.max(1e-12, vPow));
    out.music.push({ src, samples: arr.length, from: +tA.toFixed(1), to: +tB.toFixed(1), meanVolume: +Math.sqrt(vPow).toFixed(4), segLufsAtVol1: +lo.integrated.toFixed(2), segLufsHeard: +(lo.integrated + vDb).toFixed(2), segMMaxHeard: +(lo.momentaryMax + vDb).toFixed(2) });
  }
  out.musicRouter = ducks.length ? ducks[ducks.length - 1] : null;
  return out;
})()`;

export async function freshPage(b, seed) {
  await b.evaluate(SEED_AND_RELOAD(seed));
  await b.wait(2500);
  for (let i = 0; i < 120; i++) {
    const ok = await b.evaluate('document.readyState === "complete" && !!document.querySelector(".app")');
    if (ok === true) break;
    await b.wait(500);
  }
  await b.wait(800);
  await b.evaluate(HOOK_MEDIA);
}

export async function until(b, expr, ms = 60000, step = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await b.evaluate(expr);
    if (v === true) return Date.now() - t0;
    await b.wait(step);
  }
  return -1;
}
