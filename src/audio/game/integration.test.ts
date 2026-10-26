/**
 * The bridge on real runs (DESIGN §10 integration): the same headless autopilot runs as listenOnly,
 * with the trace on. Every event the session emitted ends in the trace as played, merged or dropped
 * with a reason; hits play the sound of what was hit; the per-frame caps hold; and the whole trace is
 * the same on a second run at SEED 42.
 */
import { describe, expect, it } from 'vitest';
import { getLevel } from '../../core/levels';
import type { ObstacleKind } from '../../core/types';
import { chapterById } from '../../story/chapters';
import { storyLevel } from '../../story/storyLevel';
import { ARCADE_MIX, CHAPTER_MIX, EVENT_MAG, GLOBAL_LIMITS, KIND_SOUNDS, type TraceEntry } from '../contract';
import { runHeadless, type HeadlessRun } from './testing/headless';
import { RecordingAmbience } from './testing/recording';
import { FALL_Q_REF } from './waterSources';

const SECONDS = 40;

/** The trace without what differs between runs by design (session token, wall-clock-free already). */
const comparable = (t: readonly TraceEntry[]) => t.map(({ token: _token, seq: _seq, ...rest }) => rest);

describe('the bridge on real runs', () => {
  const ch4 = chapterById('ch4-people')!;
  const cases = [
    { name: 'mountain-valley, Arcade', level: getLevel('mountain-valley'), mode: 'arcade' as const, chapter: null },
    { name: 'riverside-town, Story chapter 4', level: storyLevel(ch4), mode: 'story' as const, chapter: ch4 },
  ];

  for (const c of cases) {
    it(`${c.name}: every event accounted for, families as KIND_SOUNDS, caps held, deterministic`, async () => {
      const runs: HeadlessRun[] = [];
      for (let k = 0; k < 2; k++) runs.push(await runHeadless({ level: c.level, seconds: SECONDS, bridge: true, mode: c.mode, chapter: c.chapter }));
      const [a, b] = runs;
      const audio = a.audio!;
      const log = a.session.events.log;
      const traces = audio.traces;

      // 1. 100 % of events end in a play, a merge or a reasoned drop (seq k is the k-th event).
      expect(traces.filter((t) => t.kind === 'drop' && t.reason === 'overflow')).toHaveLength(0);
      for (let i = 0; i < log.length; i++) {
        const seq = i + 1;
        const ev = traces.find((t) => t.kind === 'event' && t.cause === seq);
        expect(ev?.ev, `event ${seq}`).toBe(log[i].type);
        const ended =
          ev?.note === 'no sound by design' ||
          traces.some((t) => t.cause === seq && (t.kind === 'play' || t.kind === 'coalesce' || (t.kind === 'drop' && t.reason !== undefined)));
        expect(ended, `${log[i].type} #${seq}`).toBe(true);
      }

      // 2. A hit plays its kind's hit sound (or the stone barrier's scatter).
      for (const p of audio.plays) {
        if (p.family !== 'hit') continue;
        const ev = log[p.cause - 1];
        if (ev.type !== 'collision') continue;
        const kind = traces.find((t) => t.kind === 'event' && t.cause === p.cause)?.note as ObstacleKind;
        const k = KIND_SOUNDS[kind];
        expect([k.hit, k.hitHeavy], `${kind}`).toContain(p.layers[0].sound);
      }

      // 3. Caps: at most four requests admitted a frame, four layers a request.
      expect(audio.maxAdmittedInFrame).toBeLessThanOrEqual(GLOBAL_LIMITS.maxRequestsPerFrame);
      for (const p of audio.plays) expect(p.layers.length).toBeLessThanOrEqual(GLOBAL_LIMITS.maxLayers);

      // 4. The same trace, request for request, on a second run (SEED 42 streams, no wall clock).
      expect(comparable(b.audio!.traces)).toEqual(comparable(traces));
      expect(b.audio!.bells).toEqual(audio.bells);

      // 5. The ambience was fed from the run: scrape at 30 Hz, the rest at 10 Hz.
      const amb = audio.ambience as RecordingAmbience;
      expect(amb.counts.scrape).toBeGreaterThan(SECONDS * 29);
      expect(amb.counts.wind).toBeGreaterThan(SECONDS * 9);
      expect(amb.timbre?.wind).toEqual(a.bridge!.mix.wind);

      // 6. Arcade is the same world with no narrative layer: no Story duck is ever asked for.
      if (c.mode === 'arcade') {
        const storyOnly = new Set(['aftermath', 'landmark', 'church', 'seaCh9', 'scar', 'act3Entry', 'reading', 'readingRiver', 'epilogueReading']);
        expect(audio.ducks.filter((d) => storyOnly.has(d.key))).toEqual([]);
      }

      // 7. Chips stay within the reference (EVENT_MAG.chipAmountRef: their 95th percentile over headless
      //    autopilot runs of all nine levels on 2026-10-22, 29 chips, median 0.034, p95 0.417). This is
      //    only a bound; the value itself is pinned below.
      const chips = log.flatMap((e) => (e.type === 'iceChipped' ? [e.amount] : []));
      for (const amount of chips) expect(amount).toBeLessThanOrEqual(EVENT_MAG.chipAmountRef * 1.1);

      for (const r of runs) {
        r.bridge!.end();
        r.session.dispose();
      }
    }, 180000);
  }

  it('the measured calibration constants are pinned (re-measure them if the physics tuning changes)', () => {
    // EVENT_MAG.chipAmountRef: the p95 of real chips, 0.417, rounded (AUDIO.md, DESIGN risk 10).
    expect(EVENT_MAG.chipAmountRef).toBe(0.4);
    // FALL_Q_REF: the p90 of source flow over the same runs (median 3.6, p90 17.5).
    expect(FALL_Q_REF).toBe(17.5);
  });

  it('riverside-town in Arcade: the lead decision, the approach hour strikes three (the bridge passes ARCADE_MIX)', async () => {
    expect(ARCADE_MIX.hourStrokes).toBe(3);
    const r = await runHeadless({ level: getLevel('riverside-town'), seconds: 60, bridge: true, mode: 'arcade', chapter: null });
    const audio = r.audio!;
    expect(r.bridge!.bells.hourStrokes).toBe(3);
    expect(audio.traces.some((t) => t.note?.startsWith('bell-hour p44 st-brides strokes=3'))).toBe(true);
    expect(audio.traces.filter((t) => /^bell-hour /.test(t.note ?? '') && !/ strokes=3 /.test(t.note ?? ''))).toEqual([]);
    r.bridge!.end();
    r.session.dispose();
  }, 180000);

  it('riverside-town in Story: St Bride\'s rings, and its hour strikes six on the approach', async () => {
    const r = await runHeadless({ level: storyLevel(ch4), seconds: 60, bridge: true, mode: 'story', chapter: ch4 });
    const audio = r.audio!;
    const strikes = audio.bells.filter((b) => b.form === 'strike');
    expect(strikes.length).toBeGreaterThan(0);
    for (const mix of Object.values(CHAPTER_MIX)) expect(mix.hourStrokes).toBe(6);
    expect(r.bridge!.bells.hourStrokes).toBe(6);
    expect(audio.traces.some((t) => t.note?.startsWith('bell-hour p44 st-brides strokes=6'))).toBe(true);
    // The bridge's own cost per frame (generous bound for a test machine; the browser target is 0.05 ms).
    expect(r.bridgeMs / r.frames).toBeLessThan(1);
    r.bridge!.end();
    expect(audio.ended).toBe(0.12);
    r.session.dispose();
  }, 180000);
});
