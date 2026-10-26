// The recorded music against the game's own sound, per chapter: what the player hears in play.
// For each flow: fresh profile, one click (unlock), into play, autopilot; from 16 s of game time,
// capture 20 s (context time) of the master, ambience and effects buses, and measure the played
// segment of the music at its el.volume.
import { writeFileSync } from 'node:fs';
import { CAPTURE, DRIVE, freshPage, until } from './common.mjs';

const FLOWS = (process.env.FLOWS ?? 'arcade,ch1,ch3,ch4,ch6,ch7,ch8,ch9').split(',');
const DEF = {
  arcade: { level: 'riverside-town' },
  ch1: { chapter: 'ch1-beginning' },
  ch3: { chapter: 'ch3-warning' },
  ch4: { chapter: 'ch4-people' },
  ch6: { chapter: 'ch6-price' },
  ch7: { chapter: 'ch7-escape' },
  ch8: { chapter: 'ch8-remains' },
  ch9: { chapter: 'ch9-last-thaw' },
};

export default async (b) => {
  const results = {};
  for (const name of FLOWS) {
    const f = DEF[name];
    await freshPage(b, {});
    await b.click(4, 4);
    await until(b, 'window.__icebergAudio && window.__icebergAudio.state().status === "running"', 20000);
    const nav = f.level
      ? `(async () => { const { useAppStore } = await import('/src/state/appStore.ts'); useAppStore.getState().playLevel(${JSON.stringify(f.level)}); return true; })()`
      : `(async () => { const { useAppStore } = await import('/src/state/appStore.ts'); useAppStore.getState().playChapter(${JSON.stringify(f.chapter)}, false); return true; })()`;
    await b.evaluate(nav);
    const ok = await until(b, 'window.__iceberg && window.__iceberg.snapshot().phase === "playing"', 90000, 300);
    await b.evaluate(DRIVE(0));
    await until(b, '!window.__iceberg || window.__iceberg.snapshot().time >= 16 || ["complete","failed"].includes(window.__iceberg.snapshot().phase)', 60000, 300);
    const snap0 = await b.evaluate('(() => { const s = window.__iceberg.snapshot(); return { t: s.time, phase: s.phase }; })()');
    const cap = await b.evaluate(CAPTURE(20), 180000);
    const snap1 = await b.evaluate('(() => { const s = window.__iceberg?.snapshot(); return s ? { t: s.time, phase: s.phase } : null; })()');
    const router = cap?.musicRouter ?? null;
    results[name] = { flow: f, playing: ok, snap0, snap1, cap };
    const m = cap?.music?.[0];
    b.log(name, JSON.stringify({ snap0, snap1, buses: cap?.buses, music: cap?.music, router: router && { cue: router.cue, trimDb: router.trimDb, duckDb: router.duckDb, volume: router.volume, holds: router.holds } }));
    if (m && cap.buses) b.log(`  ${name}: music heard ${m.segLufsHeard} LUFS (${m.src} ${m.from}-${m.to}s at vol ${m.meanVolume}); master ${cap.buses.master.lufsI}, ambience ${cap.buses.ambience.lufsI}, effects ${cap.buses.effects.lufsI}; music - ambience = ${(m.segLufsHeard - cap.buses.ambience.lufsI).toFixed(1)} LU, music - master = ${(m.segLufsHeard - cap.buses.master.lufsI).toFixed(1)} LU`);
    await b.evaluate('window.__drive = false; true');
  }
  writeFileSync(new URL(process.env.OUT ?? './music-balance.json', import.meta.url), JSON.stringify(results, null, 1));
};
