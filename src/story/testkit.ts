/**
 * Test helpers for Story Mode: a small test chapter on level 1 and REAL headless runs of it (Rapier
 * physics, the real terrain and iceberg). Only tests import this module.
 *
 * The test chapter adds one structure, a chalet at s 115 on the left (d −15, scale 0.8 so a 30 t
 * iceberg breaks it from ~8 m/s), and names two landmarks: the chalet (overlay) and level 1's own
 * cottage (base, s 470, d −12). Steering the autopilot onto the chalet's lane until s 125 smashes it;
 * the centre line passes 15 m from it and reaches both landmarks untouched. Both runs complete.
 */
import { autopilotSteer } from '../core/autopilot';
import { level1 } from '../core/levels/level1';
import { FIXED_DT, GameSession } from '../core/session';
import { CHAPTERS } from './chapters';
import { attachEventClock, type EventClock } from './evidence';
import { storyLevel } from './storyLevel';
import type { ChapterDef } from './types';

/** Index of level 1's cottage among its obstacles. */
export const COTTAGE_INDEX = level1.obstacles.findIndex((o) => o.kind === 'house');

export const TEST_CHAPTER: ChapterDef = {
  ...CHAPTERS[0],
  levelId: level1.id,
  landmarks: [
    {
      id: 'test-chalet',
      name: 'The chalet above the bend',
      category: 'home',
      bind: { source: 'overlay', index: 0 },
      bibleRefs: [],
    },
    {
      id: 'test-cottage',
      name: 'The cottage by the track',
      category: 'home',
      bind: { source: 'base', index: COTTAGE_INDEX },
      bibleRefs: [],
    },
  ],
  overlay: { obstacles: [{ kind: 'chalet', s: 115, d: -15, scale: 0.8 }] },
};

export interface TestRun {
  session: GameSession;
  clock: EventClock;
}

/** Steering plans: smash the chalet, or keep to the centre line. */
export const LANES = {
  smash: (s: number): number => (s < 125 ? -15 : 0),
  avoid: (): number => 0,
} as const;

/**
 * Run the test chapter headless with the autopilot on `laneAt(course s)` until the run ends (or
 * `maxSeconds` of play). The caller disposes the session.
 */
export async function runTestChapter(
  laneAt: (s: number) => number,
  maxSeconds = 240,
  chapter: ChapterDef = TEST_CHAPTER,
  /** Called with the new session before the first step (e.g. the UI's story bridge). */
  onCreate?: (session: GameSession) => void,
): Promise<TestRun> {
  const session = await GameSession.create({ level: storyLevel(chapter), skipIntro: true });
  const clock = attachEventClock(session);
  onCreate?.(session);
  const steps = Math.round(maxSeconds / FIXED_DT);
  for (let i = 0; i < steps && session.phase === 'playing'; i++) {
    const s = session.terrain.course.project(session.iceberg.pos.x, session.iceberg.pos.z).s;
    session.update(FIXED_DT, autopilotSteer(session.iceberg, session.terrain, { lane: laneAt(s) }));
  }
  return { session, clock };
}
