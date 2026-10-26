// Probe: Story with narrative OFF. Complete ch1, press "Continue to chapter 2" (playChapter: the
// screen stays 'game'). Does the revelation's 'reading' duck (-6/-8/-12 dB) carry into chapter 2's play?
import { nav, drive, playingPhase, summary, meterOver } from './lib.mjs';

export default async (b) => {
  await b.load('http://localhost:5199/', { storyCompleted: [], narrative: false });
  await b.click();
  await b.wait(300);
  await b.call(nav, { chapter: 'ch1-beginning' });
  if ((await b.until(playingPhase, 90000)) < 0) throw new Error('ch1 never reached play');
  await b.call(drive, { speed: 1, maxSec: 6 });
  const fresh = await b.call(summary);
  b.log('CH1 in play:', JSON.stringify({ buses: fresh.buses, ducks: fresh.ducks, music: fresh.music, session: fresh.session }));
  const d = await b.call(drive, { speed: 3, maxSec: 240 });
  b.log('drive:', JSON.stringify(d));
  if (d.phase !== 'complete') throw new Error('ch1 did not complete: ' + d.phase);
  await b.until(`[...document.querySelectorAll('button')].some((x) => /Continue to chapter/.test(x.textContent))`, 20000);
  await b.wait(3000);
  const atPanel = await b.call(summary);
  b.log('CHAPTER COMPLETE panel (+3 s):', JSON.stringify({ buses: atPanel.buses, ducks: atPanel.ducks, music: atPanel.music }));
  const box = await b.clickText('button', /Continue to chapter/);
  b.log('clicked Continue at', JSON.stringify(box));
  if ((await b.until(`window.__iceberg && window.__iceberg.snapshot().phase === 'playing' && (async()=>1)() && document.querySelector('.app')`, 5000)) < 0) {}
  const where = await b.evaluate(`(async () => { const a = (await import('/src/state/appStore.ts')).useAppStore.getState(); return JSON.stringify({ screen: a.screen, chapterId: a.chapterId, attempt: a.attempt }); })()`);
  b.log('after Continue:', where);
  for (let i = 0; i < 60; i++) {
    const ok = await b.evaluate(`(async () => { const a = (await import('/src/state/appStore.ts')).useAppStore.getState(); return a.chapterId === 'ch2-quiet-town' || a.chapterId !== 'ch1-beginning'; })()`);
    if (ok === true) break;
    await b.wait(500);
  }
  const where2 = await b.evaluate(`(async () => { const a = (await import('/src/state/appStore.ts')).useAppStore.getState(); return JSON.stringify({ screen: a.screen, chapterId: a.chapterId, attempt: a.attempt }); })()`);
  b.log('next chapter:', where2);
  await b.wait(1500);
  if ((await b.until(playingPhase, 90000)) < 0) throw new Error('ch2 never reached play');
  await b.call(drive, { speed: 1, maxSec: 10 });
  const ch2 = await b.call(summary);
  b.log('NEXT CHAPTER in play (+10 s):', JSON.stringify({ buses: ch2.buses, ducks: ch2.ducks, music: ch2.music, session: ch2.session }));
  const m = await b.call(meterOver, 1500);
  b.log('meter in next chapter:', JSON.stringify(m));
  await b.call(drive, { speed: 1, maxSec: 20 });
  const later = await b.call(summary);
  b.log('NEXT CHAPTER +30 s:', JSON.stringify({ phase: await b.evaluate('window.__iceberg.snapshot().phase'), buses: later.buses, ducks: later.ducks, music: later.music }));
  const tr = await b.evaluate(
    `JSON.stringify(window.__icebergAudio.trace(0).filter((e) => e.kind === 'duck' || e.kind === 'hold' || (e.kind === 'lifecycle' && /session \\d+ (begins|ends)/.test(e.note ?? ''))).map((e) => [+e.t.toFixed(2), e.kind, e.note]))`,
  );
  b.log('trace (ducks, holds, sessions):', tr);
};
