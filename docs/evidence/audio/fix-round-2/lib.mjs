// Page-side helpers (serialised with toString: no closures).
export async function nav(action) {
  const { useAppStore } = await import('/src/state/appStore.ts');
  const s = useAppStore.getState();
  if (action.level) s.playLevel(action.level);
  else if (action.chapterCard) s.openChapter(action.chapterCard);
  else if (action.chapter) s.playChapter(action.chapter, false);
  else if (action.screen) s.goTo(action.screen);
  else if (action.settings) s.updateSettings(action.settings);
  return useAppStore.getState().screen;
}

export function drive(o) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let frames = 0;
    const done = (why) => {
      const h = window.__iceberg;
      const s = h ? h.snapshot() : null;
      resolve({ why, frames, wallSec: (performance.now() - t0) / 1000, phase: s?.phase ?? 'gone', time: s?.time ?? 0 });
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

export const playingPhase = `window.__iceberg && window.__iceberg.snapshot().phase === 'playing'`;

export function summary() {
  const st = window.__icebergAudio.state();
  const r = (x) => (typeof x === 'number' ? +x.toFixed(4) : x);
  return {
    status: st.status,
    session: st.session,
    paused: st.paused,
    hidden: st.hidden,
    buses: Object.fromEntries(Object.entries(st.buses).map(([k, v]) => [k, r(v)])),
    ducks: st.ducks,
    voices: st.voices.active,
    bank: st.bank,
    music: { cue: st.music.cue, duckDb: st.music.duckDb, holds: st.music.holds, trimDb: st.music.trimDb },
  };
}

export async function meterOver(ms) {
  const A = window.__icebergAudio;
  A.meter();
  await new Promise((r) => setTimeout(r, ms));
  const m = A.meter();
  const f = (x) => (Number.isFinite(x) ? +x.toFixed(1) : -999);
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { peak: f(v.peakDb), rms: f(v.rmsDb) }]));
}
