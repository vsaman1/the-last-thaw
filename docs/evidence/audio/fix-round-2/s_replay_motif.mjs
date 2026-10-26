// Probe: Replay chapter pressed 1 s after the Archive revelation opens (narrative on, a human document
// surfaced). The revelation's motif is scheduled 4 s after the panel; does it play into the new attempt,
// and does the 'reveal' hold keep the chapter's music out of it?
import { nav, drive, playingPhase, summary, meterOver } from './lib.mjs';
import { internals, phaseOf } from './lib2.mjs';

export default async (b) => {
  await b.load('http://localhost:5199/', { storyCompleted: [] });
  await b.click();
  await b.wait(300);
  await b.call(nav, { chapter: 'ch1-beginning' });
  if ((await b.until(playingPhase, 90000)) < 0) throw new Error('ch1 never reached play');
  const d = await b.call(drive, { speed: 3, maxSec: 240 });
  b.log('drive:', JSON.stringify(d));
  await b.until(`[...document.querySelectorAll('button')].some((x) => /Replay chapter/.test(x.textContent))`, 20000);
  await b.wait(1000);
  const i0 = await b.call(internals);
  b.log('panel +1 s:', JSON.stringify({ motif: i0.motif, router: i0.router, ctxTime: i0.ctxTime }));
  await b.clickText('button', /Replay chapter/);
  for (let k = 0; k < 16; k++) {
    const m = await b.call(meterOver, 900);
    const i = await b.call(internals);
    const p = await b.call(phaseOf);
    b.log(`replay +${k + 1} s`, JSON.stringify({ phase: p.store, attempt: p.attempt, live: i.live, motifBusPeak: m.music.peak, master: m.master.peak, motif: i.motif, ctxTime: i.ctxTime, holds: i.router.holds, playing: i.router.playing, musicDuckDb: i.router.duckDb, buses: (await b.call(summary)).buses }));
    if (p.store === 'playing') await b.call(drive, { speed: 1, maxSec: 0.1 });
  }
};
