// Probe: Story "Replay chapter" from the Archive revelation panel. Does the revelation's
// 'reading' duck (music -6, ambience -8, effects -12 dB, held until released) and its motif/hold
// carry into the replayed attempt?
import { nav, drive, playingPhase, summary, meterOver } from './lib.mjs';

export default async (b) => {
  await b.load('http://localhost:5199/', { storyCompleted: [] });
  await b.click();
  await b.wait(300);
  await b.call(nav, { chapterCard: 'ch1-beginning' });
  await b.wait(800);
  await b.call(nav, { chapter: 'ch1-beginning' });
  if ((await b.until(playingPhase, 90000)) < 0) throw new Error('ch1 never reached play');
  await b.call(drive, { speed: 1, maxSec: 6 });
  const fresh = await b.call(summary);
  b.log('FIRST ATTEMPT in play:', JSON.stringify({ buses: fresh.buses, ducks: fresh.ducks, music: fresh.music, session: fresh.session }));
  const d = await b.call(drive, { speed: 3, maxSec: 240 });
  b.log('drive:', JSON.stringify(d));
  if (d.phase !== 'complete') throw new Error('ch1 did not complete: ' + d.phase);
  await b.until(`[...document.querySelectorAll('button')].some((x) => /Replay chapter/.test(x.textContent))`, 20000);
  await b.wait(5000);
  const atReveal = await b.call(summary);
  b.log('REVELATION panel (+5 s):', JSON.stringify({ buses: atReveal.buses, ducks: atReveal.ducks, music: atReveal.music }));
  const box = await b.clickText('button', /Replay chapter/);
  b.log('clicked at', JSON.stringify(box));
  for (let i = 0; i < 20; i++) {
    await b.wait(1000);
    const ph = await b.evaluate(`(async () => JSON.stringify({ phase: window.__iceberg ? window.__iceberg.snapshot().phase : 'none', store: (await import('/src/state/gameStore.ts')).useGameStore.getState().phase, attempt: (await import('/src/state/appStore.ts')).useAppStore.getState().attempt, btn: [...document.querySelectorAll('button')].map((x) => x.textContent.trim()).slice(0, 8) }))()`);
    b.log('after click', i, ph);
    if (String(ph).includes('"playing"')) break;
  }
  if ((await b.until(playingPhase, 30000)) < 0) throw new Error('replay never reached play');
  await b.call(drive, { speed: 1, maxSec: 8 });
  const replay = await b.call(summary);
  b.log('REPLAYED ATTEMPT in play (+8 s):', JSON.stringify({ buses: replay.buses, ducks: replay.ducks, music: replay.music, session: replay.session }));
  const m = await b.call(meterOver, 1500);
  b.log('meter during replay:', JSON.stringify(m));
  await b.call(drive, { speed: 2, maxSec: 30 });
  const later = await b.call(summary);
  b.log('REPLAYED ATTEMPT later (+~60 s game):', JSON.stringify({ buses: later.buses, ducks: later.ducks, music: later.music }));
  const tr = await b.evaluate(
    `JSON.stringify(window.__icebergAudio.trace(0).filter((e) => (e.kind === 'duck' && /^(reading|readingRiver)/.test(e.note ?? '')) || e.kind === 'motif' || e.kind === 'hold' || (e.kind === 'lifecycle' && /session \\d+ (begins|ends)/.test(e.note ?? ''))).map((e) => [+e.t.toFixed(2), e.kind, e.note]))`,
  );
  b.log('trace (reading ducks, motif, holds, sessions):', tr);
};
