import { describe, expect, it } from 'vitest';
import { getLevel, LEVELS } from '../../core/levels';
import { createRng } from '../../core/rng';
import type { GameRuntime } from '../../core/runtime';
import { getTerrain } from '../../core/session';
import { BELL_PATTERN, BELL_VOICINGS, CHURCH_BELLS, type BellVoicingId, type SessionAudioInfo } from '../contract';
import { ARCADE_MIX } from '../contract';
import { BellDriver, BellScheduler, churchesOf } from './bells';
import { RecordingSessionAudio } from './testing/recording';
import { body, iceberg } from './testing/world';

/** Run a scheduler for `seconds` of session time in `dt` steps; strokes by church, in session time. */
function run(s: BellScheduler, seconds: number, dt = 1 / 30, from = 0, inRange = (): boolean => true): number[][] {
  const out: number[][] = s.churches.map(() => []);
  for (let t = from; t <= from + seconds; t += dt) {
    s.tick(t, inRange);
    for (const d of s.strokes()) out[d.slot].push(t + d.inSec);
  }
  return out;
}

/** Split stroke times into phrases (strokes closer than 10 s belong together). */
const phrases = (times: number[]): number[][] => {
  const out: number[][] = [];
  for (const t of times) {
    const last = out[out.length - 1];
    if (last && t - last[last.length - 1] < 10) last.push(t);
    else out.push([t]);
  }
  return out;
};

describe('the scheduler (session time in, strokes out)', () => {
  it('the first phrase falls 6–14 s in; phrases have 2–4 strokes, never 1; gaps 45–75 s', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = new BellScheduler(['st-brides'], 6, createRng(seed));
      const [times] = run(s, 600);
      const ph = phrases(times);
      expect(ph[0][0]).toBeGreaterThanOrEqual(6);
      expect(ph[0][0]).toBeLessThanOrEqual(14);
      for (const p of ph) {
        expect(p.length).toBeGreaterThanOrEqual(2);
        expect(p.length).toBeLessThanOrEqual(4);
      }
      for (let i = 1; i < ph.length; i++) {
        const gap = ph[i][0] - ph[i - 1][ph[i - 1].length - 1];
        expect(gap).toBeGreaterThanOrEqual(45 - 0.1);
        expect(gap).toBeLessThanOrEqual(75 + 0.1);
      }
    }
  });

  it('two Highland churches keep at least 20 s apart', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = new BellScheduler(['clachan-kirk', 'loch-kirk'], 6, createRng(seed));
      const [a, b] = run(s, 900).map(phrases);
      for (const pa of a) for (const pb of b) expect(Math.abs(pa[0] - pb[0])).toBeGreaterThanOrEqual(20 - 1e-6);
    }
  });

  it('the hour strikes once, six times (Story) or three (Arcade), after a phrase in progress', () => {
    for (const strokes of [6, 3]) {
      const s = new BellScheduler(['st-brides'], strokes, createRng(42));
      run(s, 30);
      s.startHour(0, 30);
      s.startHour(0, 30.5);
      const [times] = run(s, 200, 1 / 30, 30);
      const hour = phrases(times).find((p) => p.length === strokes)!;
      expect(hour).toBeDefined();
      // Evenly spaced at the voicing's stroke interval (±15 ms jitter).
      for (let i = 1; i < hour.length; i++) expect(Math.abs(hour[i] - hour[i - 1] - BELL_VOICINGS['st-brides'].strokeSec)).toBeLessThan(0.04);
      expect(s.churches[0].hourDone).toBe(true);
      s.startHour(0, 300);
      const [later] = run(s, 30, 1 / 30, 300);
      expect(phrases(later).every((p) => p.length <= 4)).toBe(true);
    }
  });

  it('never more than six regularly spaced strokes in a row', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = new BellScheduler(['st-brides'], 6, createRng(seed));
      run(s, 40);
      // Ask for the hour in the middle of whatever is sounding.
      s.startHour(0, 40);
      const [times] = run(s, 300, 1 / 30, 40);
      const step = BELL_VOICINGS['st-brides'].strokeSec;
      let runLen = 1;
      let maxRun = 1;
      for (let i = 1; i < times.length; i++) {
        runLen = Math.abs(times[i] - times[i - 1] - step) < 0.05 ? runLen + 1 : 1;
        maxRun = Math.max(maxRun, runLen);
      }
      expect(maxRun, `seed ${seed}`).toBeLessThanOrEqual(6);
    }
  });

  it('a 60 s jump gives no catch-up; pausing loses and doubles nothing', () => {
    const s = new BellScheduler(['st-brides'], 6, createRng(7));
    s.tick(0, () => true);
    s.tick(13.9, () => true);
    let emitted = s.strokes().length;
    // Jump a minute ahead: whatever fell behind is skipped, at most one new phrase starts.
    s.tick(80, () => true);
    emitted += s.strokes().length;
    expect(s.strokes().length).toBeLessThanOrEqual(1);
    // Paused: session time stands still for many frames; nothing doubles.
    const before = s.churches[0].strikes;
    for (let i = 0; i < 300; i++) s.tick(80, () => true);
    expect(s.churches[0].strikes - before).toBeLessThanOrEqual(1);
    const all = run(new BellScheduler(['st-brides'], 6, createRng(9)), 200)[0];
    const paused = new BellScheduler(['st-brides'], 6, createRng(9));
    const got: number[] = [];
    for (let t = 0; t <= 200; t += 1 / 30) {
      for (let k = 0; k < (t > 50 && t < 60 ? 5 : 1); k++) {
        paused.tick(t, () => true);
        for (const d of paused.strokes()) got.push(t + d.inSec);
      }
    }
    expect(got).toEqual(all);
    expect(emitted).toBeGreaterThanOrEqual(0);
  });

  it('a phrase whose strike is not baked waits for it (late, never lost), with the same strokes', () => {
    let ready = false;
    const s = new BellScheduler(['st-brides'], 6, createRng(5), () => ready);
    const early = run(s, 40)[0];
    expect(early).toHaveLength(0);
    expect(s.churches[0].deferred).toBe('phrase');
    expect(s.churches[0].deferrals).toBe(1);
    ready = true;
    const [times] = run(s, 30, 1 / 30, 40);
    const ph = phrases(times);
    // The deferred phrase starts on the first tick after the strike is baked: a phrase of 2-4.
    expect(ph[0][0]).toBeCloseTo(40, 1);
    expect(ph[0].length).toBeGreaterThanOrEqual(2);
    expect(ph[0].length).toBeLessThanOrEqual(4);
    expect(s.churches[0].deferred).toBeNull();
    expect(s.churches[0].deferrals).toBe(1);
  });

  it('an hour asked for before its strike is baked strikes when it is, even if the church was passed meanwhile', () => {
    let ready = false;
    const s = new BellScheduler(['st-brides'], 3, createRng(11), () => ready);
    run(s, 20);
    s.startHour(0, 20);
    expect(s.churches[0].hourPending).toBe(true);
    expect(s.churches[0].deferred).toBe('hour');
    run(s, 10, 1 / 30, 20);
    s.passed(0); // the iceberg went by while the bake caught up
    expect(run(s, 5, 1 / 30, 30)[0]).toHaveLength(0);
    ready = true;
    const [times] = run(s, 20, 1 / 30, 35);
    expect(phrases(times)[0]).toHaveLength(3);
    expect(s.churches[0].hourDone).toBe(true);
    expect(s.churches[0].hourPending).toBe(false);
  });

  it('phrases wait while the listener is out of range; a silenced church never strikes again', () => {
    const s = new BellScheduler(['st-brides'], 6, createRng(3));
    expect(run(s, 100, 1 / 30, 0, () => false)[0]).toHaveLength(0);
    s.silence(0);
    expect(run(s, 300, 1 / 30, 100)[0]).toHaveLength(0);
  });
});

describe('every church has a bell', () => {
  it('the five churches of the four church levels, base placements only, with their voicings', () => {
    const found = LEVELS.flatMap((l) => churchesOf(l).map((c) => `${l.id}:${c.placement}:${c.voicing}`));
    expect(found.sort()).toEqual(CHURCH_BELLS.map((c) => `${c.levelId}:${c.placement}:${c.voicing}`).sort());
    for (const id of ['mountain-valley', 'rocky-canyon', 'riverside-town', 'glacier-avalanche', 'power-valley', 'ravine-run']) {
      expect(churchesOf(getLevel(id)).length, id).toBe(id === 'riverside-town' ? 1 : 0);
    }
  });

  it('a church a story overlay adds would ring too (the default voicing)', () => {
    const base = getLevel('ravine-run');
    const level = { ...base, id: 'ravine-run~test', obstacles: [...base.obstacles, { kind: 'church' as const, s: 300, d: 40 }] };
    expect(churchesOf(level)).toEqual([{ placement: base.obstacles.length, voicing: 'st-brides', scale: 1 }]);
  });
});

describe('the driver on Riverside Town', () => {
  const level = getLevel('riverside-town');
  const terrain = getTerrain(level);
  const church = CHURCH_BELLS.find((c) => c.levelId === 'riverside-town')!;
  const p = level.obstacles[church.placement];
  const INFO: SessionAudioInfo = { levelId: 'riverside-town', mode: 'story', chapterId: 'ch4-people', attempt: 1, mix: ARCADE_MIX };

  function setup(hourStrokes: number) {
    const foot = terrain.course.toWorld(p.s, p.d);
    const tower = body(900, 'church', { placement: church.placement, part: 'churchTower', mass: 30, spawn: foot, pos: foot });
    const physics = { bodies: [tower], structureVersion: 1, getBody: (id: number) => (id === 900 ? tower : undefined) };
    const ice = iceberg();
    const clock = { t: 0, ctx: 100 };
    const rt = {
      level,
      terrain,
      iceberg: ice,
      physics,
      get time() {
        return clock.t;
      },
    } as unknown as GameRuntime;
    const session = new RecordingSessionAudio(1, INFO, { now: () => clock.ctx });
    const silenced: number[] = [];
    const driver = new BellDriver(rt, session, { hourStrokes, now: () => clock.ctx, onSilenced: (pl) => silenced.push(pl) });
    const pose = { px: foot.x, py: foot.y + 30, pz: foot.z - 40, rightX: 1, rightZ: 0, fwdX: 0, fwdZ: 1 };
    const place = (s: number, speed: number) => {
      const w = terrain.course.toWorld(s, 0);
      const c = terrain.course.sampleAt(s);
      ice.pos.x = w.x;
      ice.pos.z = w.z;
      ice.vel.x = c.dirX * speed;
      ice.vel.z = c.dirZ * speed;
    };
    const step = (dt: number, playing = true) => {
      clock.t += dt;
      clock.ctx += dt;
      driver.frame(dt, playing, pose, false);
    };
    return { tower, session, driver, place, step, clock, silenced, physics };
  }

  it('the approach hour: six strokes heard, the last at least 2 s before the iceberg arrives (18 m/s)', () => {
    const { session, place, step, clock } = setup(6);
    let s = p.s - 700;
    let arrival = -1;
    for (let i = 0; i < 60 * 60 && arrival < 0; i++) {
      s += 18 / 30;
      place(s, 18);
      step(1 / 30);
      if (s >= p.s) arrival = clock.t;
    }
    // Session time of each strike: ctx time − the clock's fixed offset (100 s).
    const strikes = session.bells.filter((b) => b.form === 'strike').map((b) => b.when - 100);
    const hour = phrases(strikes).filter((ph) => ph.length === 6);
    expect(hour).toHaveLength(1);
    expect(hour[0][5]).toBeLessThanOrEqual(arrival - 2);
    // Traced once, even if it waited for a phrase to finish.
    expect(session.traces.filter((t) => t.note?.startsWith('bell-hour p44'))).toHaveLength(1);
    // Strikes are positional: −18 dBFS at 40 m, quieter further away.
    expect(session.bells[0].gainLin).toBeLessThanOrEqual(Math.pow(10, BELL_PATTERN.strikeDbAt40m / 20) + 1e-9);
  });

  it("the driver given Arcade's mix (ARCADE_MIX.hourStrokes, the lead's three) strikes three", () => {
    // That the bridge passes ARCADE_MIX on a real Arcade run is integration.test.ts's to check.
    expect(ARCADE_MIX.hourStrokes).toBe(3);
    const { session, place, step } = setup(ARCADE_MIX.hourStrokes);
    let s = p.s - 500;
    for (let i = 0; i < 60 * 30 && s < p.s; i++) {
      s += 18 / 30;
      place(s, 18);
      step(1 / 30);
    }
    const strikes = session.bells.filter((b) => b.form === 'strike').map((b) => b.when);
    expect(phrases(strikes).some((ph) => ph.length === 3)).toBe(true);
    expect(phrases(strikes).every((ph) => ph.length <= 4)).toBe(true);
  });

  it('the tower falls mid-hour: its strikes are choked, a clank 1.1 s later, then nothing', () => {
    const { session, tower, place, step, clock, silenced, physics } = setup(6);
    place(p.s - 100, 2);
    // Wait for the hour to start, then two of its strokes.
    let hourAt = -1;
    for (let i = 0; i < 30 * 60 && hourAt < 0; i++) {
      step(1 / 30);
      if (session.traces.some((t) => t.note?.startsWith('bell-hour'))) hourAt = clock.t;
    }
    expect(hourAt).toBeGreaterThan(0);
    const beforeFall = () => session.bells.filter((b) => b.form === 'strike').length;
    for (let i = 0; i < 30 * 5; i++) step(1 / 30);
    const struck = beforeFall();
    tower.anchored = false;
    tower.state = 'loose';
    physics.structureVersion++;
    step(0.1);
    expect(silenced).toEqual([church.placement]);
    const note = session.traces.find((t) => t.note?.startsWith('bell-silenced'))!.note!;
    // The clock stopped part-way through the hour (it had struck two or three of its six).
    expect(note).toMatch(/^bell-silenced p44 strikes=[1-5] \(mid-hour\)$/);
    expect(session.bells.filter((b) => b.form === 'strike' && b.choked !== null).length).toBeGreaterThan(0);
    const fellAt = clock.t;
    for (let i = 0; i < 30 * 120; i++) step(1 / 30);
    const clanks = session.bells.filter((b) => b.form === 'clank');
    expect(clanks).toHaveLength(1);
    expect(clanks[0].when - 100 - fellAt).toBeGreaterThan(BELL_PATTERN.clankDelaySec - 0.1);
    expect(clanks[0].when - 100 - fellAt).toBeLessThan(BELL_PATTERN.clankDelaySec + 0.1);
    expect(beforeFall()).toBeGreaterThanOrEqual(struck);
    const after = session.bells.filter((b) => b.form === 'strike' && b.when - 100 > fellAt + 0.3);
    expect(after).toHaveLength(0);
  });

  it('a struck tower that holds shivers (amp >= 0.15), at most once per 3 s', () => {
    const { session, tower, step } = setup(6);
    step(0.2);
    tower.shake.amp = 0.1;
    tower.shake.t0 = 1;
    step(0.2);
    expect(session.bells.filter((b) => b.form === 'shiver')).toHaveLength(0);
    tower.shake.amp = 0.5;
    tower.shake.t0 = 2;
    step(0.2);
    tower.shake.t0 = 3;
    step(0.2);
    const shivers = session.bells.filter((b) => b.form === 'shiver');
    expect(shivers).toHaveLength(1);
    expect(shivers[0].velocity).toBeCloseTo(0.5, 6);
    for (let i = 0; i < 20; i++) step(0.2);
    tower.shake.t0 = 4;
    step(0.2);
    expect(session.bells.filter((b) => b.form === 'shiver')).toHaveLength(2);
  });

  it('a strike that is not baked yet: the phrase and the hour wait, are traced once each way, and nothing is dropped', () => {
    const { session, place, step } = setup(3);
    let baked = false;
    session.bellReadyFn = () => baked;
    let s = p.s - 900;
    place(s, 1);
    // 20 s at the far end: the first phrase is due (6-14 s) but waits.
    for (let i = 0; i < 30 * 20; i++) step(1 / 30);
    expect(session.bells).toHaveLength(0);
    // Ride up to the church: the hour is asked for, and waits too.
    for (let i = 0; i < 30 * 60 && s < p.s - 150; i++) {
      s += 18 / 30;
      place(s, 18);
      step(1 / 30);
    }
    expect(session.bells).toHaveLength(0);
    expect(session.traces.some((t) => t.note?.startsWith('bell-hour p44'))).toBe(true);
    const notes = () => session.traces.filter((t) => /^bell-(deferred|ready)/.test(t.note ?? '')).map((t) => t.note);
    expect(notes()).toEqual(['bell-deferred p44 st-brides phrase (strike not baked)', 'bell-deferred p44 st-brides hour (strike not baked)']);
    baked = true;
    for (let i = 0; i < 30 * 15; i++) step(1 / 30);
    // The hour (three strokes) rang once the strike was there; nothing was dropped as not ready.
    const strikes = session.bells.filter((b) => b.form === 'strike').map((b) => b.when);
    expect(phrases(strikes)[0]).toHaveLength(3);
    expect(notes().slice(2)).toHaveLength(1);
    expect(notes()[2]).toMatch(/^bell-ready p44 st-brides after \d+\.\d s$/);
  });

  it('levels without a church strike nothing', () => {
    const mv = getLevel('mountain-valley');
    const rt = { level: mv, terrain: getTerrain(mv), iceberg: iceberg(), physics: {}, time: 0 } as unknown as GameRuntime;
    const session = new RecordingSessionAudio(1, { ...INFO, levelId: 'mountain-valley' });
    const d = new BellDriver(rt, session, { hourStrokes: 6, now: () => 0 });
    for (let i = 0; i < 100; i++) d.frame(1, true, { px: 0, py: 0, pz: 0, rightX: 1, rightZ: 0, fwdX: 0, fwdZ: 1 }, false);
    expect(session.bells).toHaveLength(0);
  });

  it('every voicing in the table has a stroke interval', () => {
    for (const v of Object.keys(BELL_VOICINGS) as BellVoicingId[]) expect(BELL_VOICINGS[v].strokeSec).toBeGreaterThan(1);
  });
});
