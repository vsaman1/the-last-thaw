// Tab hidden during the Archive revelation (ch1, narrative on): the motif runs on the context clock
// (suspended while hidden), the moment's hold is released by a wall-clock timer. After 20 s hidden,
// does the chapter's recording come back on top of the motif's remaining notes?
import { nav, drive, playingPhase, meterOver } from './lib.mjs';
import { internals, setHidden } from './lib2.mjs';

export default async (b) => {
  await b.load('http://localhost:5199/', { storyCompleted: [] });
  await b.click(4, 4);
  await b.wait(1500);
  await b.call(nav, { chapter: 'ch1-beginning' });
  if ((await b.until(playingPhase, 90000)) < 0) throw new Error('ch1 never reached play');
  const d = await b.call(drive, { speed: 3, maxSec: 240 });
  b.log('drive:', JSON.stringify(d));
  await b.until(`[...document.querySelectorAll('button')].some((x) => /Replay chapter/.test(x.textContent))`, 20000);
  await b.wait(1000);
  const i0 = await b.call(internals);
  b.log('panel +1 s:', JSON.stringify({ ctxTime: i0.ctxTime, motif: i0.motif, holds: i0.router.holds, playing: i0.router.playing }));
  b.log('hide ->', await b.call(setHidden, true));
  await b.wait(20000);
  const i1 = await b.call(internals);
  b.log('hidden 20 s:', JSON.stringify({ ctx: i1.ctxState, ctxTime: i1.ctxTime, motif: i1.motif, holds: i1.router.holds, playing: i1.router.playing, muted: i1.router.muted }));
  b.log('show ->', await b.call(setHidden, false));
  for (let k = 0; k < 14; k++) {
    const m = await b.call(meterOver, 900);
    const i = await b.call(internals);
    const v = Array.isArray(i.player?.voices) ? i.player.voices.map((x) => ({ cue: x.cue, playing: x.playing, level: +x.level.toFixed(2), vol: +x.volume.toFixed(3) })) : i.player;
    b.log(`visible +${k + 1} s`, JSON.stringify({ ctxTime: i.ctxTime, motif: i.motif, motifBusPeak: m.music.peak, holds: i.router.holds, playing: i.router.playing, recording: v }));
  }
  const tr = await b.evaluate(`JSON.stringify(window.__icebergAudio.trace(0).filter((e) => e.kind === 'motif' || e.kind === 'hold' || (e.kind === 'lifecycle' && /context/.test(e.note ?? ''))).map((e) => [+e.t.toFixed(2), e.kind, e.note]))`);
  b.log('trace:', tr);
};
