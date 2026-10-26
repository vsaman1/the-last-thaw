// A hidden tab during the Archive revelation (ch1, narrative on, a human document): hidden 20 s while
// the motif waits, then shown. The 'reveal' hold must stay until the audio clock passes the motif's end
// plus the 4 s of silence, and the recording must stay out until then (no recording over the motif).
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
  const motif = i0.motif;
  b.log('panel +1 s:', JSON.stringify({ ctxTime: i0.ctxTime, motif, holds: i0.router.holds }));
  b.log('hide ->', await b.call(setHidden, true));
  await b.wait(20000);
  const i1 = await b.call(internals);
  b.log('hidden 20 s:', JSON.stringify({ ctx: i1.ctxState, ctxTime: i1.ctxTime, holds: i1.router.holds, playing: i1.router.playing }));
  b.log('show ->', await b.call(setHidden, false));
  let overlap = 0;
  let releasedAt = null;
  for (let k = 0; k < 40 && releasedAt === null; k++) {
    const m = await b.call(meterOver, 700);
    const i = await b.call(internals);
    const rec = Array.isArray(i.player?.voices) ? i.player.voices.filter((x) => x.playing && x.volume > 0.001) : [];
    const motifSounding = motif && i.ctxTime >= motif.startsAt && i.ctxTime <= motif.endsAt;
    if (motifSounding && rec.length > 0) overlap++;
    if (i.router.holds.length === 0) releasedAt = i.ctxTime;
    b.log(`visible +${(0.7 * (k + 1)).toFixed(1)} s`, JSON.stringify({ ctxTime: i.ctxTime, motifBusPeak: m.music.peak, holds: i.router.holds, playing: i.router.playing, recordingPlaying: rec.map((x) => [x.cue, +x.volume.toFixed(3)]) }));
  }
  const tr = await b.evaluate(`JSON.stringify(window.__icebergAudio.trace(0).filter((e) => e.kind === 'motif' || e.kind === 'hold' || (e.kind === 'lifecycle' && /context/.test(e.note ?? ''))).map((e) => [+e.t.toFixed(2), e.kind, e.note]))`);
  b.log('trace:', tr);
  b.log('RESULT', JSON.stringify({ motifEndsAt: motif?.endsAt, dueAt: motif ? +(motif.endsAt + 4).toFixed(2) : null, releasedAtCtx: releasedAt, samplesWithRecordingDuringMotif: overlap }));
};
