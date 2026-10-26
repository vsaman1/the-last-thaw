import { describe, expect, it } from 'vitest';
import { calvingKeys } from '../../core/glacier/calving';
import { introTimeline, type IntroKind } from '../../core/intro';
import type { GameRuntime } from '../../core/runtime';
import type { GamePhase } from '../../core/types';
import { ARCADE_MIX, EVENT_MAG, GLOBAL_LIMITS } from '../contract';
import { CalvingSounds } from './calving';
import { landingLevelDb } from './magnitude';
import { RecordingSessionAudio } from './testing/recording';

interface FakeRt {
  phase: GamePhase;
  introTime: number;
  introTimeline: ReturnType<typeof introTimeline>;
  iceberg: { pos: { x: number; y: number; z: number } };
}

function setup(kind: IntroKind) {
  const rt: FakeRt = { phase: 'intro', introTime: 0, introTimeline: introTimeline(kind), iceberg: { pos: { x: 10, y: 120, z: -40 } } };
  const session = new RecordingSessionAudio(1, { levelId: 'mountain-valley', mode: 'arcade', chapterId: null, attempt: 1, mix: ARCADE_MIX });
  const calving = new CalvingSounds(rt as unknown as GameRuntime, session);
  // When (on the intro clock) each request was made.
  const times: number[] = [];
  const play = session.play.bind(session);
  session.play = (req) => {
    times.push(rt.introTime);
    return play(req);
  };
  /** Run the intro clock at 60 fps from its current time to `until` seconds. */
  const run = (until: number) => {
    while (rt.introTime < until) {
      rt.introTime = Math.min(until, rt.introTime + 1 / 60);
      calving.frame();
    }
  };
  return { rt, session, calving, run, times };
}

describe('the calving at the start of every attempt (P1)', () => {
  it('the full calving: groan at the shudder, crack at the break, the landing at m 0.7, once each', () => {
    const { rt, session, calving, run, times } = setup('full');
    const tl = rt.introTimeline;
    const keys = calvingKeys(tl.calving);
    run(tl.flyover); // the flyover is silent
    expect(session.plays).toHaveLength(0);
    run(tl.total - 1e-6);
    expect(calving.played).toEqual(['groan', 'crack', 'land']);
    const [groan, crack, land] = session.plays;
    expect(groan.layers[0]).toMatchObject({ sound: 'ice.calve.groan', gainDb: EVENT_MAG.calveGroanDb });
    expect(crack.layers[0]).toMatchObject({ sound: 'ice.calve.crack', gainDb: EVENT_MAG.calveCrackDb });
    expect(land.layers[0].sound).toBe('ice.land.ground');
    expect(land.layers[0].gainDb).toBeCloseTo(landingLevelDb(0.7), 9);
    for (const p of session.plays) {
      expect(p).toMatchObject({ family: 'calve', priority: 1, positional: true, x: 10, y: 120, z: -40, send: ARCADE_MIX.calveSend });
      expect(p.layers.length).toBeLessThanOrEqual(GLOBAL_LIMITS.maxLayers);
    }
    // Each in the frame its key passed (60 fps: within one frame of the key).
    const due = [keys.shudderFrom, keys.breakAt, keys.landAt].map((k) => tl.flyover + k);
    times.forEach((t, i) => {
      expect(t).toBeGreaterThanOrEqual(due[i] - 1e-9);
      expect(t - due[i]).toBeLessThan(1 / 60 + 1e-9);
    });
    rt.phase = 'playing';
    rt.introTime = tl.total;
    calving.frame();
    expect(session.plays).toHaveLength(3);
  });

  it('the short beat (Retry, Skip intros) keeps only the crack and the landing', () => {
    const { rt, calving, run } = setup('short');
    run(rt.introTimeline.total - 1e-6);
    expect(calving.played).toEqual(['crack', 'land']);
    expect(calving.skipped).toEqual(['groan']);
  });

  it('a skip past the keys plays nothing late; play beginning early drops what is left', () => {
    const a = setup('full');
    a.run(a.rt.introTimeline.flyover + 0.2);
    a.rt.introTime = a.rt.introTimeline.total - 0.01; // Space: the clock jumps to the end
    a.calving.frame();
    expect(a.calving.played).toEqual([]);
    expect(a.calving.skipped).toEqual(['groan', 'crack', 'land']);
    expect(a.session.plays).toHaveLength(0);

    const b = setup('full');
    b.run(b.rt.introTimeline.flyover + calvingKeys(3).breakAt + 0.05);
    b.rt.phase = 'playing';
    b.calving.frame();
    expect(b.calving.played).toEqual(['groan', 'crack']);
    expect(b.calving.skipped).toEqual(['land']);
  });

  it('no intro (headless and scripted runs): nothing at all', () => {
    const { rt, session, calving } = setup('none');
    rt.phase = 'playing';
    for (let i = 0; i < 300; i++) calving.frame();
    expect(session.plays).toHaveLength(0);
    expect(calving.played).toEqual([]);
  });
});
