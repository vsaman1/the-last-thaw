import { describe, expect, it } from 'vitest';
import { getSnapshot } from './api';
import { level1 } from './levels/level1';
import { INTRO_TIMING } from './intro';
import { INTRO_DURATION } from './runtime';
import { FIXED_DT, GameSession } from './session';
import type { SteeringInput } from './types';

const NONE: SteeringInput = { steer: 0, source: 'none' };
const secs = (s: number): number => Math.round(s / FIXED_DT);

describe('level-start sequence (flyover → calving → play)', () => {
  it('headless sessions with skipIntro start playing at once, intro already over', async () => {
    const s = await GameSession.create({ level: level1, skipIntro: true });
    expect(s.phase).toBe('playing');
    expect(s.introProgress).toBe(1);
    expect(s.introTimeline.kind).toBe('none');
    expect(s.introStage).toBe('done');
    expect(s.introTime).toBe(s.introTimeline.total);
    expect(getSnapshot(s).intro).toEqual({ kind: 'none', stage: 'done', time: 0, total: 0 });
    s.dispose();
  });

  it('plays the full intro (flyover then calving) without moving the iceberg, then hands off', async () => {
    const s = await GameSession.create({ level: level1 });
    expect(s.introTimeline.total).toBe(INTRO_DURATION);
    const start = { ...s.iceberg.pos };
    const vel = { ...s.iceberg.vel };
    s.advance(secs(INTRO_TIMING.flyover - 0.5), NONE);
    expect(s.introStage).toBe('flyover');
    s.advance(secs(1), NONE);
    expect(s.introStage).toBe('calving');
    expect(s.phase).toBe('intro');
    expect(s.iceberg.pos).toEqual(start);
    expect(s.iceberg.vel).toEqual(vel);
    s.advance(secs(INTRO_DURATION - INTRO_TIMING.flyover - 0.5) + 2, NONE);
    expect(s.phase).toBe('playing');
    expect(s.introStage).toBe('done');
    expect(s.introProgress).toBe(1);
    expect(s.introTime).toBe(s.introTimeline.total);
    s.dispose();
  });

  it('a short intro (Skip intros, Retry) is just the calving beat', async () => {
    const s = await GameSession.create({ level: level1, intro: 'short' });
    expect(s.introTimeline.kind).toBe('short');
    expect(s.introStage).toBe('calving');
    s.advance(secs(INTRO_TIMING.calvingShort) - 3, NONE);
    expect(s.phase).toBe('intro');
    s.advance(4, NONE);
    expect(s.phase).toBe('playing');
    s.dispose();
  });

  it('Space steps through: flyover → short calving → play; skipIntro() still goes straight to play', async () => {
    const s = await GameSession.create({ level: level1 });
    s.advance(secs(2), NONE);
    s.skipIntroStep();
    expect(s.phase).toBe('intro');
    expect(s.introTimeline.kind).toBe('short');
    expect(s.introStage).toBe('calving');
    expect(s.introTime).toBe(0);
    expect(s.introProgress).toBe(0);
    s.advance(secs(0.5), NONE);
    s.skipFlyover(); // no-op once calving
    expect(s.introTime).toBeCloseTo(0.5, 6);
    s.skipIntroStep();
    expect(s.phase).toBe('playing');
    expect(s.introStage).toBe('done');
    // A skipped intro leaves introProgress short of 1 (the camera blends instead of cutting).
    expect(s.introProgress).toBeLessThan(1);
    s.dispose();

    const t = await GameSession.create({ level: level1 });
    t.advance(secs(1), NONE);
    t.skipIntro();
    expect(t.phase).toBe('playing');
    expect(t.introStage).toBe('done');
    t.dispose();
  });

  it('pausing in the calving freezes it; the flyover can be skipped while paused', async () => {
    const s = await GameSession.create({ level: level1 });
    s.advance(secs(1), NONE);
    s.pause();
    s.skipFlyover();
    expect(s.introTimeline.kind).toBe('short');
    s.advance(secs(2), NONE);
    expect(s.introTime).toBe(0);
    s.resume();
    expect(s.phase).toBe('intro');
    s.advance(secs(0.4), NONE);
    s.pause();
    const frozen = s.introTime;
    s.advance(secs(3), NONE);
    expect(s.introTime).toBe(frozen);
    expect(s.phase).toBe('paused');
    s.resume();
    s.advance(secs(1), NONE);
    expect(s.phase).toBe('playing');
    s.dispose();
  });

  it('leaves gameplay unchanged: after the calving the run matches a run with no intro', async () => {
    const a = await GameSession.create({ level: level1, skipIntro: true });
    const b = await GameSession.create({ level: level1, intro: 'short' });
    while (b.phase === 'intro') b.update(FIXED_DT, NONE);
    expect(b.iceberg.pos).toEqual(a.iceberg.pos);
    expect(b.iceberg.vel).toEqual(a.iceberg.vel);
    const steer: SteeringInput = { steer: 0.3, source: 'scripted' };
    a.advance(secs(6), steer);
    b.advance(secs(6), steer);
    expect(b.iceberg.pos.x).toBeCloseTo(a.iceberg.pos.x, 9);
    expect(b.iceberg.pos.z).toBeCloseTo(a.iceberg.pos.z, 9);
    expect(b.stats.distance).toBeCloseTo(a.stats.distance, 9);
    expect(b.stats.time).toBeCloseTo(a.stats.time, 9);
    a.dispose();
    b.dispose();
  });
});
