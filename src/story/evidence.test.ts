/**
 * RunEvidence from REAL headless runs (Rapier physics, level 1 terrain, the real iceberg): one run
 * steers into a structure, one avoids it, and the evidence must say so — and nothing more.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { level1 } from '../core/levels/level1';
import type { PhysicsWorld } from '../core/physics/world';
import {
  attachEventClock,
  buildRunEvidence,
  destroyedCount,
  MAX_NOTABLE,
  MAX_ROUTE,
  REACH_RADIUS,
} from './evidence';
import { STORY_POINTS, tallyStoryPoints } from './scoring';
import { storyLevel } from './storyLevel';
import { COTTAGE_INDEX, LANES, runTestChapter, TEST_CHAPTER, type TestRun } from './testkit';
import { useStoryStore } from '../state/storyStore';
import { fallbackReflection, selectFragments } from './select';
import type { ArchiveFragment, ChapterDef, RunEvidence } from './types';

const level = storyLevel(TEST_CHAPTER);
const landmark = (e: RunEvidence, id: string) => {
  const l = e.landmarks.find((x) => x.id === id);
  if (!l) throw new Error(`no landmark ${id}`);
  return l;
};

let smash: TestRun;
let avoid: TestRun;
let smashEv: RunEvidence;
let avoidEv: RunEvidence;

beforeAll(async () => {
  smash = await runTestChapter(LANES.smash);
  avoid = await runTestChapter(LANES.avoid);
  smashEv = buildRunEvidence({ session: smash.session, chapter: TEST_CHAPTER, level, clock: smash.clock });
  avoidEv = buildRunEvidence({ session: avoid.session, chapter: TEST_CHAPTER, level, clock: avoid.clock });
}, 120_000);

afterAll(() => {
  smash.session.dispose();
  avoid.session.dispose();
});

describe('buildRunEvidence on real runs', () => {
  it('the overlay structure is spawned at base length + overlay index', () => {
    const w = smash.session.physics as PhysicsWorld;
    const chalet = w.bodies.filter((b) => b.placement === level1.obstacles.length && b.id === b.originId);
    expect(chalet.length).toBe(1);
    expect(chalet[0].kind).toBe('chalet');
  });

  it('steering into the chalet: destroyed, scored, a notable break; the cottage is left standing', () => {
    expect(smashEv.outcome).toBe('complete');
    expect(landmark(smashEv, 'test-chalet').status).toBe('destroyed');
    expect(smashEv.destroyedByKind.chalet).toBe(1);
    expect(smashEv.destroyedByCategory.home).toBeGreaterThanOrEqual(1);
    expect(smashEv.storyPoints).toBeGreaterThanOrEqual(STORY_POINTS.chalet);
    const broke = smashEv.notable.find((n) => n.type === 'broke' && n.landmarkId === 'test-chalet');
    expect(broke).toBeDefined();
    expect(broke!.kind).toBe('chalet');
    expect(broke!.category).toBe('home');
    expect(broke!.s).toBeGreaterThan(95);
    expect(broke!.s).toBeLessThan(135);
    // The run went on past the cottage (s 470) without touching it.
    const cottage = landmark(smashEv, 'test-cottage');
    expect(cottage.status).toBe('intact');
    expect(cottage.closest).toBeGreaterThan(3);
  });

  it('keeping to the centre: the chalet is reached and untouched, nothing scored for it', () => {
    expect(avoidEv.outcome).toBe('complete');
    const chalet = landmark(avoidEv, 'test-chalet');
    expect(chalet.status).toBe('intact');
    expect(chalet.closest).toBeGreaterThan(5);
    expect(chalet.closest).toBeLessThan(REACH_RADIUS);
    expect(avoidEv.destroyedByKind.chalet).toBeUndefined();
    expect(avoidEv.notable.some((n) => n.landmarkId === 'test-chalet')).toBe(false);
    expect(landmark(avoidEv, 'test-cottage').status).toBe('intact');
  });

  it('the two runs leave different evidence', () => {
    expect(landmark(smashEv, 'test-chalet').status).not.toBe(landmark(avoidEv, 'test-chalet').status);
    expect(smashEv.storyPoints).toBeGreaterThan(avoidEv.storyPoints);
    expect(destroyedCount(smashEv, ['home'])).toBe(destroyedCount(avoidEv, ['home']) + 1);
  });

  it('story points are the scoring table applied to the real event log, each placement once', () => {
    const w = smash.session.physics as PhysicsWorld;
    const { points, destroyed } = tallyStoryPoints(smash.session.events.log, (id) => w.getBody(id));
    expect(smashEv.storyPoints).toBe(points);
    expect(new Set(destroyed.map((d) => d.unit)).size).toBe(destroyed.length);
    // The chalet broke into many pieces, but counts once.
    expect(destroyed.filter((d) => d.kind === 'chalet')).toHaveLength(1);
  });

  it('run statistics are copied from the session, not invented', () => {
    const st = smash.session.stats;
    expect(smashEv.time).toBeCloseTo(st.time, 1);
    expect(smashEv.distance).toBe(Math.round(st.distance));
    expect(smashEv.waterfallsCrossed).toBe(st.waterfallsCrossed);
    expect(smashEv.collisions).toBe(st.collisions);
    expect(smashEv.buildingsDestroyed).toBe(st.buildingsDestroyed);
    expect(smashEv.startMass).toBe(smash.session.params.mass);
    expect(smashEv.coastS).toBe(level.coastS);
    expect(smashEv.reachedS).toBeGreaterThanOrEqual(level.finishS - 1);
    expect(smashEv.notable.filter((n) => n.type === 'waterfall')).toHaveLength(st.waterfallsCrossed);
    expect(smashEv.notable.some((n) => n.type === 'enteredOcean')).toBe(true);
  });

  it('compact: capped notable events and route, in time / course order, a few KB of JSON', () => {
    for (const e of [smashEv, avoidEv]) {
      expect(e.notable.length).toBeLessThanOrEqual(MAX_NOTABLE);
      expect(e.route.length).toBeLessThanOrEqual(MAX_ROUTE);
      expect(e.route.length).toBeGreaterThan(10);
      for (let i = 1; i < e.notable.length; i++) expect(e.notable[i].t).toBeGreaterThanOrEqual(e.notable[i - 1].t);
      expect(e.route[0].s).toBeLessThan(e.route[e.route.length - 1].s);
      expect(JSON.stringify(e).length).toBeLessThan(6000);
      // Nothing that could be read as people.
      expect(JSON.stringify(e)).not.toMatch(/casualt|death|dead|killed|injur|people|resident/i);
    }
  });

  it('timed events: the clock and the route estimate agree to within a second', () => {
    const timed = smashEv.notable.find((n) => n.landmarkId === 'test-chalet')!;
    const estimated = buildRunEvidence({ session: smash.session, chapter: TEST_CHAPTER, level });
    const est = estimated.notable.find((n) => n.landmarkId === 'test-chalet')!;
    expect(timed.t).toBeGreaterThan(0);
    expect(timed.t).toBeLessThan(smashEv.time);
    expect(Math.abs(est.t - timed.t)).toBeLessThan(1);
  });

  it('damaged: a placement knocked from where it stood but not broken', () => {
    const w = avoid.session.physics as PhysicsWorld;
    const knocked = w.bodies.find(
      (b) =>
        b.id === b.originId &&
        b.countedKnocked &&
        b.state !== 'broken' &&
        b.placement >= 0 &&
        b.placement < level1.obstacles.length,
    );
    expect(knocked, 'the centre run knocks at least one rock').toBeDefined();
    const chapter: ChapterDef = {
      ...TEST_CHAPTER,
      landmarks: [
        ...TEST_CHAPTER.landmarks,
        { id: 'test-rock', name: 'A rock', category: 'nature', bind: { source: 'base', index: knocked!.placement }, bibleRefs: [] },
      ],
    };
    const e = buildRunEvidence({ session: avoid.session, chapter, level, clock: avoid.clock });
    expect(landmark(e, 'test-rock').status).toBe('damaged');
  });

  it('a landmark of several placements: destroyed if any broke, damaged if one was knocked, intact only if all stood', async () => {
    // Two chalets above the bend, one on the smash lane (d −15) and its twin on the other side (d +15),
    // named as one landmark, as the co-op's three turbines are. The twin chapter gets its own id so
    // its story level (and the terrain cached for it) is its own.
    const twin: ChapterDef = {
      ...TEST_CHAPTER,
      id: 'ch9-last-thaw',
      landmarks: [
        { id: 'test-chalets', name: 'The chalets above the bend', category: 'home', bind: { source: 'overlay', index: 0, also: [1] }, bibleRefs: [] },
      ],
      overlay: { obstacles: [...TEST_CHAPTER.overlay.obstacles, { kind: 'chalet', s: 115, d: 15, scale: 0.8 }] },
    };
    const play = async (laneAt: (s: number) => number): Promise<RunEvidence> => {
      const run = await runTestChapter(laneAt, 240, twin);
      try {
        return buildRunEvidence({ session: run.session, chapter: twin, level: storyLevel(twin), clock: run.clock });
      } finally {
        run.session.dispose();
      }
    };
    const hit = await play(LANES.smash);
    const missed = await play(LANES.avoid);
    expect(hit.destroyedByKind.chalet, 'the smash lane breaks one chalet of the two').toBe(1);
    expect(landmark(hit, 'test-chalets').status).toBe('destroyed');
    expect(hit.notable.some((n) => n.landmarkId === 'test-chalets' && n.kind === 'chalet')).toBe(true);
    expect(missed.destroyedByKind.chalet).toBeUndefined();
    expect(landmark(missed, 'test-chalets').status).toBe('intact');
    // Knocked: the cottage (reached, untouched) with a rock the centre run knocked is 'damaged'.
    const w = avoid.session.physics as PhysicsWorld;
    const knocked = w.bodies.find(
      (b) => b.id === b.originId && b.countedKnocked && b.state !== 'broken' && b.placement >= 0 && b.placement < level1.obstacles.length,
    );
    expect(knocked).toBeDefined();
    const chapter: ChapterDef = {
      ...TEST_CHAPTER,
      landmarks: [
        ...TEST_CHAPTER.landmarks,
        { id: 'with-knocked', name: 'A pair', category: 'home', bind: { source: 'base', index: COTTAGE_INDEX, also: [knocked!.placement] }, bibleRefs: [] },
      ],
    };
    const a = buildRunEvidence({ session: avoid.session, chapter, level, clock: avoid.clock });
    expect(landmark(a, 'test-cottage').status).toBe('intact');
    expect(landmark(a, 'with-knocked').status).toBe('damaged');
    // Its closest approach is to the nearer of its placements.
    expect(landmark(a, 'with-knocked').closest).toBeLessThanOrEqual(landmark(a, 'test-cottage').closest);
  }, 120_000);
});

describe('buildRunEvidence before the end', () => {
  it('a run that has not got far: unreached landmarks are notReached, never "intact"', async () => {
    const early = await runTestChapter(LANES.avoid, 1.5);
    try {
      expect(early.session.phase).toBe('playing');
      const e = buildRunEvidence({ session: early.session, chapter: TEST_CHAPTER, level, clock: early.clock });
      expect(e.outcome).toBe('failed');
      expect(e.failReason).toBeUndefined();
      const cottage = landmark(e, 'test-cottage');
      expect(cottage.status).toBe('notReached');
      expect(cottage.closest).toBeGreaterThan(REACH_RADIUS);
      expect(e.reachedS).toBeLessThan(level1.obstacles[0].s + 60);
      expect(e.storyPoints).toBe(0);
      // A landmark of several placements is intact only once the run has reached every one of them: a
      // placement the run has already passed, paired with the cottage far below, is not "intact".
      const each: ChapterDef = {
        ...TEST_CHAPTER,
        landmarks: level1.obstacles.map((_, i) => ({ id: `p${i}`, name: `p${i}`, category: 'home', bind: { source: 'base', index: i }, bibleRefs: [] })),
      };
      const near = buildRunEvidence({ session: early.session, chapter: each, level }).landmarks.find((l) => l.status === 'intact');
      expect(near, 'the run has reached a placement by now').toBeDefined();
      const pair: ChapterDef = {
        ...TEST_CHAPTER,
        landmarks: [{ id: 'test-pair', name: 'A pair', category: 'home', bind: { source: 'base', index: COTTAGE_INDEX, also: [Number(near!.id.slice(1))] }, bibleRefs: [] }],
      };
      expect(landmark(buildRunEvidence({ session: early.session, chapter: pair, level }), 'test-pair').status).toBe('notReached');
    } finally {
      early.session.dispose();
    }
  });

  it('deterministic: the same steering gives the same evidence', async () => {
    const again = await runTestChapter(LANES.avoid);
    try {
      const e = buildRunEvidence({ session: again.session, chapter: TEST_CHAPTER, level, clock: again.clock });
      expect(e).toEqual(avoidEv);
    } finally {
      again.session.dispose();
    }
  });

  it('a clock attached mid-run only times what it saw; earlier events fall back to the estimate', async () => {
    const run = await runTestChapter(LANES.avoid, 0.5);
    try {
      const late = attachEventClock(run.session);
      expect(late.offset).toBe(run.session.events.log.length);
      late.dispose();
    } finally {
      run.session.dispose();
    }
  });
});

describe('different runs leave different archive entries (real runs → selection → Archive)', () => {
  const doc = (id: string, when: ArchiveFragment['when'], priority = 0): ArchiveFragment => ({
    id,
    chapterId: TEST_CHAPTER.id,
    kind: 'record',
    title: id,
    body: `${id}.`,
    when,
    priority,
  });
  const chapter: ChapterDef = {
    ...TEST_CHAPTER,
    fragments: [
      doc('chalet-gone', { landmark: 'test-chalet', status: 'destroyed' }, 2),
      doc('chalet-standing', { landmark: 'test-chalet', status: 'intact' }, 2),
      doc('arrival', { outcome: 'complete' }),
    ],
    fallbackReflections: [
      doc('reflect-lost', { destroyedAtLeast: 1, categories: ['home'] }, 1),
      doc('reflect-quiet', { always: true }),
    ],
  };

  it('fragments, reflection and story points follow what each run really did', () => {
    const store = useStoryStore.getState();
    const record = (ev: RunEvidence, at: string) =>
      store.recordChapter({
        chapterId: chapter.id,
        completedAt: at,
        evidence: ev,
        fragmentIds: selectFragments(chapter, ev, []).map((f) => f.id),
        reflection: fallbackReflection(chapter, ev, []),
      });
    const a = record(smashEv, '2026-10-21T10:00:00.000Z');
    const b = record(avoidEv, '2026-10-21T11:00:00.000Z');
    expect(a.fragmentIds).toEqual(['chalet-gone', 'arrival']);
    expect(b.fragmentIds).toEqual(['chalet-standing', 'arrival']);
    expect(a.reflection.fragmentIds).toEqual(['reflect-lost']);
    expect(b.reflection.fragmentIds).toEqual(['reflect-quiet']);
    expect(a.evidence.storyPoints).toBeGreaterThan(b.evidence.storyPoints);
    // The replay replaced the first entry.
    const archive = useStoryStore.getState().progress.archive;
    expect(archive).toHaveLength(1);
    expect(archive[0].fragmentIds).toEqual(['chalet-standing', 'arrival']);
  });
});
