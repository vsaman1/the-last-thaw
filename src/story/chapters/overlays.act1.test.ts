/**
 * ACT I overlays (chapters 1–3, "The Wonder"): the extra structures the story adds to Mountain Valley,
 * Rocky Canyon and Alpine Pass, checked on the STORY level (base level + overlay) and played headless
 * with the real session (Rapier physics, real terrain, water budget and chipping on).
 *
 * Act I's escalation property: it stays light. The overlay adds at most two placements per chapter
 * (0, 1, 2), and on the intended line and every natural alternative route no overlay placement is
 * destroyed or even approached within 20 m: leaving the story's structures alone takes no effort. They
 * are still a choice, not a wall: a line bent through the road builders' stone breaks it and reaches
 * the sea. Measured numbers are recorded in each chapter's OVERLAY comment.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { autopilotSteer } from '../../core/autopilot';
import { getLevel } from '../../core/levels';
import { buildObstacleSpecs } from '../../core/obstacles/spawn';
import type { PhysicsWorld } from '../../core/physics/world';
import { FIXED_DT, GameSession, getTerrain } from '../../core/session';
import { validateWorldLogic } from '../../core/terrain/logic';
import { validateLevel } from '../../core/terrain/validate';
import type { CourseCoord } from '../../core/types';
import { attachEventClock, buildRunEvidence } from '../evidence';
import { tallyStoryPoints } from '../scoring';
import { chapterBindingIssues, landmarkPlacement, storyLevel } from '../storyLevel';
import { runTestChapter } from '../testkit';
import type { ChapterDef, RunEvidence } from '../types';
import { CH1, OVERLAY_REQUESTS as REQ1 } from './ch1';
import { CH2, OVERLAY_REQUESTS as REQ2 } from './ch2';
import { CH3, OVERLAY_REQUESTS as REQ3 } from './ch3';
import type { OverlayRequest } from './authoring';

const ACT1: readonly { ch: ChapterDef; req: readonly OverlayRequest[] }[] = [
  { ch: CH1, req: REQ1 },
  { ch: CH2, req: REQ2 },
  { ch: CH3, req: REQ3 },
];

/** Minimum distance (m) between a natural route and any overlay placement. */
const CLEARANCE = 20;

// ---------------------------------------------------------------------------------------------------
// Playing a chapter headless
// ---------------------------------------------------------------------------------------------------

interface Played {
  ev: RunEvidence;
  /** Kinds of the overlay placements the run destroyed. */
  overlayDestroyed: string[];
  /** Closest approach (m) of the iceberg's route to each overlay placement. */
  overlayClosest: number[];
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const l2 = vx * vx + vz * vz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / l2)) : 0;
  return Math.hypot(px - (ax + t * vx), pz - (az + t * vz));
}

function summarise(session: GameSession, ch: ChapterDef, clock: ReturnType<typeof attachEventClock>): Played {
  const level = storyLevel(ch);
  const ev = buildRunEvidence({ session, chapter: ch, level, clock });
  const nBase = getLevel(ch.levelId).obstacles.length;
  const world = session.physics as PhysicsWorld;
  const { destroyed } = tallyStoryPoints(session.events.log, (id) => world.getBody(id));
  const route = [...session.route.map((p) => ({ x: p.x, z: p.z })), { x: session.iceberg.pos.x, z: session.iceberg.pos.z }];
  const overlayClosest = ch.overlay.obstacles.map((p) => {
    const w = session.terrain.course.toWorld(p.s, p.d);
    let best = Infinity;
    for (let i = 1; i < route.length; i++) {
      best = Math.min(best, segDist(w.x, w.z, route[i - 1].x, route[i - 1].z, route[i].x, route[i].z));
    }
    return best;
  });
  return {
    ev,
    overlayDestroyed: destroyed.filter((d) => d.placement >= nBase).map((d) => d.kind),
    overlayClosest,
  };
}

/** The autopilot on the level line, offset by `laneAt(s)` (src/story/testkit.ts). */
async function playLane(ch: ChapterDef, laneAt: (s: number) => number = () => 0): Promise<Played> {
  const { session, clock } = await runTestChapter(laneAt, 240, ch);
  const out = summarise(session, ch, clock);
  session.dispose();
  return out;
}

/** The autopilot pursuing another line on the same story level (as the level tests do). */
async function playLine(ch: ChapterDef, line: CourseCoord[]): Promise<Played> {
  const level = storyLevel(ch);
  const terrain = getTerrain(level);
  const steerOn = { ...terrain, level: { ...level, line } };
  const session = await GameSession.create({ level, skipIntro: true, terrain });
  const clock = attachEventClock(session);
  for (let i = 0; i < 240 / FIXED_DT && session.phase === 'playing'; i++) {
    session.update(FIXED_DT, autopilotSteer(session.iceberg, steerOn));
  }
  const out = summarise(session, ch, clock);
  session.dispose();
  return out;
}

const pts = (...a: [number, number][]): CourseCoord[] => a.map(([s, d]) => ({ s, d }));
/** `line` with the points in [s0, s1] replaced by `p`. */
const splice = (line: readonly CourseCoord[], s0: number, s1: number, p: CourseCoord[]): CourseCoord[] => [
  ...line.filter((q) => q.s < s0),
  ...p,
  ...line.filter((q) => q.s > s1),
];

const line2 = getLevel(CH2.levelId).line ?? [];
const line3 = getLevel(CH3.levelId).line ?? [];
/** Rocky Canyon's safe route: the wide channel, the bypass, the rubble (src/core/levels/rockyCanyon.test.ts). */
const CANYON_SAFE = splice(line2, 141, 490, pts(
  [160, -2], [178, 0], [205, 8], [228, 14], [250, 19], [330, 21], [368, 21], [392, 16], [415, 15],
  [432, 11], [445, 3], [470, -2], [490, 0],
));
/** Alpine Pass's ski and gorge routes (src/core/levels/alpinePass.test.ts). */
const PASS_SKI = splice(line3, 31, 1430, pts(
  [70, -4], [120, -15], [165, -45], [215, -100], [250, -125], [285, -135], [300, -135], [330, -136],
  [345, -134], [380, -140], [440, -140], [500, -145], [530, -150], [560, -155], [600, -145], [640, -120],
  [700, -100], [740, -82], [760, -82], [800, -90], [830, -95], [860, -85], [960, -78], [1000, -80],
  [1044, -62], [1100, -55], [1178, -45], [1300, -30], [1420, -20],
));
const GORGE_TAIL: [number, number][] = [
  [200, 85], [240, 112], [265, 119], [690, 119], [740, 125], [760, 126], [800, 140], [850, 160],
  [1000, 168], [1040, 150], [1100, 128], [1150, 90], [1178, 85], [1300, 80], [1420, 75],
];
const PASS_GORGE = splice(line3, 31, 1430, pts([60, 8], [100, 40], [160, 58], ...GORGE_TAIL));
/** The gorge route bent right off the summit, through the road builders' stone. */
const PASS_STONE = splice(line3, 31, 1430, pts([55, 12], [75, 40], [87, 57], [110, 64], [160, 64], ...GORGE_TAIL));

// ---------------------------------------------------------------------------------------------------
// Static checks
// ---------------------------------------------------------------------------------------------------

describe('act I overlays: bindings and the story levels', () => {
  it('adds at most two placements per chapter, exactly the requested kinds, and no features', () => {
    expect(ACT1.map(({ ch }) => ch.overlay.obstacles.length)).toEqual([0, 1, 2]);
    for (const { ch, req } of ACT1) {
      expect(ch.overlay.obstacles.map((o) => o.kind), ch.id).toEqual(req.map((r) => r.kind));
      expect(ch.overlay.features ?? [], ch.id).toEqual([]);
    }
  });

  it('binds every requested landmark to its overlay placement, with the requested name and label', () => {
    for (const { ch, req } of ACT1) {
      expect(chapterBindingIssues(ch), ch.id).toEqual([]);
      const obstacles = storyLevel(ch).obstacles;
      req.forEach((r, i) => {
        if (!r.landmark) return;
        const lm = ch.landmarks.find((l) => l.id === r.landmark?.id);
        expect(lm, `${ch.id}: ${r.landmark.id}`).toBeDefined();
        if (!lm) return;
        expect(lm.bind).toEqual({ source: 'overlay', index: i });
        expect(lm.name).toBe(r.landmark.name);
        expect(lm.label).toBe(r.landmark.label);
        expect(obstacles[landmarkPlacement(ch, lm)].kind).toBe(r.kind);
        expect(lm.category).toBe('community');
        expect(lm.bibleRefs.length).toBeGreaterThan(0);
      });
    }
  });

  it('validates each story level: placements, features, line, routes and world logic', () => {
    for (const { ch } of ACT1) {
      const level = storyLevel(ch);
      const terrain = getTerrain(level);
      expect(validateLevel(terrain), ch.id).toEqual([]);
      expect(validateWorldLogic(terrain), ch.id).toEqual([]);
    }
  });

  it('keeps the body count within a few of the base level', () => {
    for (const { ch } of ACT1) {
      const base = getLevel(ch.levelId);
      const level = storyLevel(ch);
      const specs = buildObstacleSpecs(getTerrain(level), level.seed);
      const baseSpecs = buildObstacleSpecs(getTerrain(base), base.seed);
      expect(specs.length - baseSpecs.length, ch.id).toBeLessThanOrEqual(4);
      ch.overlay.obstacles.forEach((_, i) => {
        expect(specs.some((s) => s.placement === base.obstacles.length + i), `${ch.id} overlay ${i}`).toBe(true);
      });
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// Playtests
// ---------------------------------------------------------------------------------------------------

const runs: Record<string, Played> = {};

beforeAll(async () => {
  runs['ch1 line'] = await playLane(CH1);
  runs['ch1 hut-left'] = await playLane(CH1, (s) => (s > 380 && s < 480 ? -12 : 0));
  runs['ch2 line'] = await playLane(CH2);
  runs['ch2 safe'] = await playLine(CH2, CANYON_SAFE);
  runs['ch3 line'] = await playLane(CH3);
  runs['ch3 ski'] = await playLine(CH3, PASS_SKI);
  runs['ch3 gorge'] = await playLine(CH3, PASS_GORGE);
  runs['ch3 stone'] = await playLine(CH3, PASS_STONE);
}, 600_000);

afterAll(() => {
  for (const k of Object.keys(runs)) delete runs[k];
});

const tell = (p: Played): string =>
  `${p.ev.outcome}${p.ev.failReason ? ` (${p.ev.failReason})` : ''} at s ${p.ev.reachedS.toFixed(0)}`;

describe('act I overlays: played headless on the story levels', () => {
  it('every chapter is finishable on its intended line, with the overlay in place', () => {
    for (const k of ['ch1 line', 'ch2 line', 'ch3 line']) {
      expect(runs[k].ev.outcome, `${k}: ${tell(runs[k])}`).toBe('complete');
      expect(runs[k].ev.iceLeft, k).toBeGreaterThan(0.2);
    }
  });

  it('the natural alternatives still reach the sea', () => {
    for (const k of ['ch1 hut-left', 'ch2 safe', 'ch3 ski', 'ch3 gorge']) {
      expect(runs[k].ev.outcome, `${k}: ${tell(runs[k])}`).toBe('complete');
    }
  });

  it('stays light: no natural route destroys or comes within 20 m of an overlay placement', () => {
    for (const k of ['ch1 line', 'ch2 line', 'ch2 safe', 'ch3 line', 'ch3 ski', 'ch3 gorge']) {
      const r = runs[k];
      expect(r.overlayDestroyed, k).toEqual([]);
      for (const c of r.overlayClosest) expect(c, k).toBeGreaterThanOrEqual(CLEARANCE);
    }
    // The named overlay landmarks are reached and left standing.
    expect(runs['ch2 line'].ev.landmarks.find((l) => l.id === 'stake-zero')?.status).toBe('intact');
    expect(runs['ch3 line'].ev.landmarks.find((l) => l.id === 'road-stone')?.status).toBe('intact');
    // On the intended lines the overlay scores nothing, and Act I's lines break at most two things.
    for (const k of ['ch1 line', 'ch2 line', 'ch3 line']) {
      const built = Object.entries(runs[k].ev.destroyedByCategory)
        .filter(([cat]) => cat !== 'nature')
        .reduce((n, [, v]) => n + (v ?? 0), 0);
      expect(built, k).toBeLessThanOrEqual(2);
    }
  });

  it('is a choice, not a trap: a line through the road builders\' stone breaks it and finishes', () => {
    const r = runs['ch3 stone'];
    expect(r.ev.outcome, tell(r)).toBe('complete');
    expect(r.overlayDestroyed).toEqual(['monument']);
    expect(r.ev.landmarks.find((l) => l.id === 'road-stone')?.status).toBe('destroyed');
    expect(r.ev.destroyedByCategory.community).toBe(1);
    // The tutorial's hook works in chapter 1 too: the left line takes the survey hut.
    expect(runs['ch1 hut-left'].ev.landmarks.find((l) => l.id === 'survey-hut')?.status).toBe('destroyed');
  });
});
