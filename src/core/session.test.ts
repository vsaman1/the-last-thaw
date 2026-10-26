import { describe, expect, it } from 'vitest';
import { GameSession, FIXED_DT, ICE_SCORE, SHATTER_BELOW, computeScore } from './session';
import { autopilotSteer } from './autopilot';
import { getSnapshot } from './api';
import { level1 } from './levels/level1';
import { dirToHeading } from './math';
import { DEFAULT_ICEBERG_PARAMS } from './sim/params';
import { setIce } from './sim/iceberg';
import { createAnalyticTerrain, inclinedPlane } from './testing/analyticTerrain';
import type { PhysicsWorld } from './physics/world';
import { stepKeyboardSteer } from '../input/input';
import type {
  ContactOutcome,
  GameEvent,
  IcebergContact,
  IcebergParams,
  LevelDef,
  ObstacleKind,
  ObstacleProxy,
  ObstacleStats,
  PhysicsWorldApi,
  SteeringInput,
  Terrain,
  Vec3,
  WaterBudget,
} from './types';

const MAX_STEPS = 60 * 240;
const NONE: SteeringInput = { steer: 0, source: 'none' };
const hspeed = (s: GameSession): number => Math.hypot(s.iceberg.vel.x, s.iceberg.vel.z);
const courseS = (s: GameSession): number => s.terrain.course.project(s.iceberg.pos.x, s.iceberg.pos.z).s;

/** A session already past the start grace period, recording every event. */
async function warmSession(): Promise<{ session: GameSession; events: GameEvent[] }> {
  const session = await GameSession.create({ level: level1, skipIntro: true });
  const events: GameEvent[] = [];
  session.events.on((e) => events.push(e));
  session.advance(200, NONE);
  return { session, events };
}

/** Teleport the grounded iceberg to world (x, z) moving `speed` m/s toward (aimX, aimZ). */
function place(session: GameSession, x: number, z: number, speed: number, aimX: number, aimZ: number): void {
  const ice = session.iceberg;
  const l = Math.hypot(aimX - x, aimZ - z);
  const dx = (aimX - x) / l;
  const dz = (aimZ - z) / l;
  ice.pos.x = x;
  ice.pos.z = z;
  ice.pos.y = session.terrain.heightAt(x, z);
  ice.vel.x = dx * speed;
  ice.vel.y = 0;
  ice.vel.z = dz * speed;
  ice.heading = dirToHeading(dx, dz);
  ice.steer = 0;
  ice.grounded = true;
  ice.stuckTimer = 0;
}

/** Teleport to course (s, d) heading down-course at `speed`. */
function placeOnCourse(session: GameSession, s: number, d: number, speed: number): void {
  const c = session.terrain.course;
  const w = c.toWorld(s, d);
  const ahead = c.toWorld(s + 5, d);
  place(session, w.x, w.z, speed, ahead.x, ahead.z);
}

/** Horizontal centroid of the live bodies of one placement (e.g. the barrier's stones). */
function placementCentre(session: GameSession, kind: ObstacleKind): { x: number; z: number; ids: number[] } {
  const bodies = (session.physics as PhysicsWorld).bodies.filter((b) => b.kind === kind && b.active);
  const placement = bodies[0].placement;
  const mine = bodies.filter((b) => b.placement === placement);
  const x = mine.reduce((a, b) => a + b.proxy.x, 0) / mine.length;
  const z = mine.reduce((a, b) => a + b.proxy.z, 0) / mine.length;
  return { x, z, ids: mine.map((b) => b.id) };
}

/** Keyboard player: the autopilot's wish through a deadband, ramped like the real key input. */
function keyboardPlayer(lane: number, deadband = 0.3): (s: GameSession) => SteeringInput {
  let cur = 0;
  return (s) => {
    const a = autopilotSteer(s.iceberg, s.terrain, { lane }).steer;
    cur = stepKeyboardSteer(cur, a > deadband ? 1 : a < -deadband ? -1 : 0, FIXED_DT);
    return { steer: cur, source: 'keyboard' };
  };
}

async function runAutopilot(lane = 0) {
  const session = await GameSession.create({ level: level1, skipIntro: true });
  const events: GameEvent[] = [];
  session.events.on((e) => events.push(e));
  let steps = 0;
  while (session.phase === 'playing' && steps < MAX_STEPS) {
    session.update(FIXED_DT, autopilotSteer(session.iceberg, session.terrain, { lane }));
    steps++;
  }
  return { session, events, steps };
}

describe('GameSession end-to-end (headless, level 1)', () => {
  it('an autopilot that follows the valley completes the level', async () => {
    const { session, events } = await runAutopilot();
    const snap = getSnapshot(session);
    expect(snap.outcome, `ended at s=${snap.course.s.toFixed(0)} phase=${snap.phase}`).toBe('won');
    expect(session.stats.time).toBeGreaterThan(20);
    expect(session.stats.distance).toBeGreaterThan(level1.finishS - level1.startS - 50);
    expect(session.stats.waterfallsCrossed).toBe(level1.cliffs.length);
    expect(events.some((e) => e.type === 'enteredOcean')).toBe(true);
    expect(events.filter((e) => e.type === 'complete')).toHaveLength(1);
    expect(session.stats.score).toBeGreaterThan(0);
    session.dispose();
  });

  it('the river follows the route the iceberg actually took', async () => {
    const { session } = await runAutopilot(6);
    const samples = session.river.samples;
    expect(samples.length).toBeGreaterThan(100);
    // Every recorded route point on land has river water within a couple of metres.
    for (const p of session.route) {
      if (session.terrain.isOcean(p.x, p.z)) continue;
      let best = Infinity;
      for (const s of samples) best = Math.min(best, Math.hypot(s.x - p.x, s.z - p.z));
      expect(best).toBeLessThan(3);
    }
    // Trail is continuous: no horizontal gap between consecutive samples except across a fall.
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(4);
    }
    session.dispose();
  });

  it('a run that loses all momentum fails as stuck, and a fresh session restarts cleanly', async () => {
    const sticky = { ...DEFAULT_ICEBERG_PARAMS, friction: 0.6, launchSpeed: 0 };
    const session = await GameSession.create({ level: level1, skipIntro: true, params: sticky });
    const failed: GameEvent[] = [];
    session.events.on((e) => e.type === 'failed' && failed.push(e));
    session.advance(60 * 30, { steer: 0, source: 'none' });
    expect(session.phase).toBe('failed');
    expect(session.failReason).toBe('stuck');
    expect(failed).toHaveLength(1);
    session.dispose();

    const again = await GameSession.create({ level: level1, skipIntro: true });
    expect(again.phase).toBe('playing');
    expect(again.stats.time).toBe(0);
    again.advance(60, { steer: 0, source: 'none' });
    expect(again.stats.time).toBeGreaterThan(0.9);
    again.dispose();
  });

  it('intro, skip, pause and resume move through the right phases', async () => {
    const session = await GameSession.create({ level: level1 });
    expect(session.phase).toBe('intro');
    const start = { ...session.iceberg.pos };
    session.advance(60, { steer: 0, source: 'none' });
    expect(session.iceberg.pos).toEqual(start);
    session.skipIntro();
    expect(session.phase).toBe('playing');
    session.advance(30, { steer: 0, source: 'none' });
    session.pause();
    expect(session.phase).toBe('paused');
    const t = session.stats.time;
    session.advance(120, { steer: 0, source: 'none' });
    expect(session.stats.time).toBe(t);
    session.resume();
    expect(session.phase).toBe('playing');
    session.dispose();
  });

  it('pausing during the intro resumes it where it was instead of restarting', async () => {
    const session = await GameSession.create({ level: level1 });
    session.advance(120, { steer: 0, source: 'none' });
    const before = session.introProgress;
    expect(before).toBeGreaterThan(0.1);
    session.pause();
    session.advance(60, { steer: 0, source: 'none' });
    session.resume();
    expect(session.phase).toBe('intro');
    session.advance(1, { steer: 0, source: 'none' });
    expect(session.introProgress).toBeGreaterThanOrEqual(before);
    session.dispose();
  });

  it('gravity accelerates the iceberg down the opening slope with no input', async () => {
    const session = await GameSession.create({ level: level1, skipIntro: true });
    const v0 = getSnapshot(session).speed;
    session.advance(60 * 3, { steer: 0, source: 'none' });
    const snap = getSnapshot(session);
    expect(snap.speed).toBeGreaterThan(v0 + 3);
    expect(Number.isFinite(snap.momentum)).toBe(true);
    session.dispose();
  });
});

/**
 * Centreline spots on land where the floor is gentlest but still descends (0.05-0.085), clear of
 * cliff lips, the coast and obstacles: where a slow iceberg is most at risk of being failed as
 * stuck. Derived from the level so the test follows layout changes.
 */
function gentleSpots(level: LevelDef, terrain: Terrain, count: number): number[] {
  const c = terrain.course;
  const found: { s: number; slope: number }[] = [];
  for (let s = level.startS + 20; s < level.coastS - 25; s += 5) {
    const slope = (c.sampleAt(s).floor - c.sampleAt(s + 10).floor) / 10;
    if (slope < 0.05 || slope > 0.085) continue;
    if (level.cliffs.some((k) => s >= k.s - 10 && s < k.s + 10)) continue;
    if (level.obstacles.some((o) => Math.abs(o.s - s) < 15 && Math.abs(o.d) < 12)) continue;
    found.push({ s, slope });
  }
  found.sort((a, b) => a.slope - b.slope);
  const picked: number[] = [];
  for (const f of found) {
    if (picked.length < count && picked.every((p) => Math.abs(p - f.s) >= 20)) picked.push(f.s);
  }
  return picked;
}

describe('gameplay review fixes (level 1)', () => {
  it('a slow iceberg sliding free down a gentle stretch recovers instead of failing stuck', async () => {
    const { session: probe } = await warmSession();
    const spots = gentleSpots(level1, probe.terrain, 3);
    probe.dispose();
    expect(spots.length).toBeGreaterThanOrEqual(2);
    for (const [k, s0] of spots.entries()) {
      const v0 = k === 0 ? 0.3 : 1.0;
      const { session } = await warmSession();
      placeOnCourse(session, s0, 0, v0);
      for (let i = 0; i < 60 * 12 && session.phase === 'playing'; i++) {
        session.update(FIXED_DT, autopilotSteer(session.iceberg, session.terrain));
      }
      expect(session.phase, `from s=${s0} at ${v0} m/s`).not.toBe('failed');
      expect(hspeed(session)).toBeGreaterThan(DEFAULT_ICEBERG_PARAMS.stuckSpeed);
      session.dispose();
    }
  });

  it('a keyboard player holding the centre line is not pinned by rocks it knocks and finishes', async () => {
    const session = await GameSession.create({ level: level1, skipIntro: true });
    const player = keyboardPlayer(0);
    for (let i = 0; i < MAX_STEPS && session.phase === 'playing'; i++) {
      session.update(FIXED_DT, player(session));
    }
    expect(session.phase, `ended at s=${courseS(session).toFixed(0)}`).toBe('complete');
    session.dispose();
  });

  async function chargeBarrier(
    speed: number,
    lane: number | null,
  ): Promise<{ kept: number; session: GameSession; events: GameEvent[]; barrierS: number }> {
    const { session, events } = await warmSession();
    const c = placementCentre(session, 'stoneBarrier');
    const course = session.terrain.course;
    const p = course.project(c.x, c.z);
    const from = course.toWorld(p.s - (14 + 0.2 * speed), p.d);
    place(session, from.x, from.z, speed, c.x, c.z);
    let hitAt = -1;
    let kept = NaN;
    let vHit = 0;
    for (let i = 0; i < 60 * 25 && session.phase === 'playing' && courseS(session) < p.s + 40; i++) {
      const recovering = lane !== null && hitAt >= 0 && i > hitAt + 18;
      const steer = recovering ? autopilotSteer(session.iceberg, session.terrain, { lane }) : NONE;
      const n = events.length;
      session.update(FIXED_DT, steer);
      if (hitAt < 0 && events.slice(n).some((e) => e.type === 'collision' && e.kind === 'stoneBarrier')) {
        hitAt = i;
        vHit = speed;
      }
      if (hitAt >= 0 && i === hitAt + 30) kept = hspeed(session) / vHit;
    }
    return { kept, session, events, barrierS: p.s };
  }

  it('the stone barrier is costly but passable: a fast hit keeps roughly 40-55 % of the speed', async () => {
    for (const v of [10, 18]) {
      const { kept, session } = await chargeBarrier(v, null);
      expect(kept, `hit at ${v} m/s`).toBeGreaterThan(0.38);
      expect(kept, `hit at ${v} m/s`).toBeLessThan(0.62);
      session.dispose();
    }
  });

  it('a slow 5 m/s barrier hit does not end the run when the player then steers for the gap', async () => {
    const { session, barrierS } = await chargeBarrier(5, -3);
    expect(session.phase).not.toBe('failed');
    expect(courseS(session)).toBeGreaterThan(barrierS + 30);
    session.dispose();
  });

  it('pressing against one obstacle counts one collision, not one per physics step', async () => {
    const { session, events } = await warmSession();
    const c = placementCentre(session, 'stoneBarrier');
    const course = session.terrain.course;
    const p = course.project(c.x, c.z);
    const from = course.toWorld(p.s - 16, p.d);
    place(session, from.x, from.z, 10, c.x, c.z);
    const n0 = events.length;
    const c0 = session.stats.collisions;
    session.advance(60 * 8, NONE);
    const hits = events.slice(n0).filter((e) => e.type === 'collision');
    const ids = new Set(hits.map((e) => (e.type === 'collision' ? e.obstacleId : -1)));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(3 * ids.size);
    if (session.phase === 'playing') expect(session.stats.collisions - c0).toBe(hits.length);
    session.dispose();
  });

  it('a fast iceberg can choose to smash a lower-valley house; the centre line misses them', async () => {
    const houses = level1.obstacles.filter((o) => o.kind === 'house');
    const target = houses.reduce((a, h) => (Math.abs(h.d) < Math.abs(a.d) ? h : a));
    const { session } = await warmSession();
    // 18 m/s (was 16): houses now break on the iceberg's momentum, J = 1.25·vn·M with its current
    // mass. Slightly melted (29 t) it reaches the house at ~15.4 m/s from 16, just under the 562.5
    // threshold (1.25 × 15.4 × 29.1 = 560), so it would bounce off.
    placeOnCourse(session, target.s - 60, target.d * 0.6, 18);
    for (let i = 0; i < 60 * 8 && session.phase === 'playing' && !session.stats.buildingsDestroyed; i++) {
      session.update(FIXED_DT, autopilotSteer(session.iceberg, session.terrain, { lane: target.d }));
    }
    expect(session.stats.buildingsDestroyed).toBe(1);
    session.dispose();

    const { session: centre } = await runAutopilot(0);
    expect(centre.stats.buildingsDestroyed).toBe(0);
    expect(getSnapshot(centre).outcome).toBe('won');
    centre.dispose();
  });
});

// --- melt (analytic terrains, independent of the level-1 layout) --------------------------------

const WATER: WaterBudget = { metres: 400, turnMetresPerRadian: 30 };
const P0 = DEFAULT_ICEBERG_PARAMS;

/** Straight 0.1 slope, course along +Z (s = z, d = -x); with `sea` the coast is at s = 300. */
function slopeTerrain(level: Partial<LevelDef>, sea = false): Terrain {
  return createAnalyticTerrain({
    height: inclinedPlane(0.1, sea ? 30 : 60),
    length: 500,
    width: 80,
    cellSize: 2,
    seaLevel: sea ? 0 : -1000,
    level,
  });
}

async function slopeSession(
  level: Partial<LevelDef>,
  opts: { sea?: boolean; skipIntro?: boolean; params?: typeof P0 } = {},
): Promise<{ session: GameSession; events: GameEvent[]; terrain: Terrain }> {
  const terrain = slopeTerrain(level, opts.sea);
  const session = await GameSession.create({
    level: terrain.level,
    terrain,
    skipIntro: opts.skipIntro ?? true,
    params: opts.params,
  });
  const events: GameEvent[] = [];
  session.events.on((e) => events.push(e));
  return { session, events, terrain };
}

describe('melt', () => {
  it('derives melt rates from the level water budget; explicit params keep their overrides', async () => {
    const own = { ...P0, friction: 0.03 };
    const cases: [Partial<LevelDef>, typeof P0 | undefined, number, number][] = [
      [{ water: WATER }, undefined, 1 / 400, 30 / 400],
      [{ water: WATER }, own, 1 / 400, 30 / 400],
      [{ water: WATER }, { ...own, meltPerMetre: 0.01 }, 0.01, 0],
      [{}, undefined, 0, 0],
    ];
    for (const [level, params, perMetre, perRadian] of cases) {
      const { session } = await slopeSession(level, { params });
      expect(session.params.meltPerMetre).toBeCloseTo(perMetre, 12);
      expect(session.params.meltPerRadian).toBeCloseTo(perRadian, 12);
      expect(session.params.friction).toBe((params ?? P0).friction);
      session.dispose();
    }
  });

  it('starts with a full iceberg, reported in the stats and the snapshot', async () => {
    const { session } = await slopeSession({ water: WATER });
    expect(session.iceberg.ice).toBe(1);
    expect(session.stats.iceLeft).toBe(1);
    const snap = getSnapshot(session);
    expect(snap.ice).toBe(1);
    expect(snap.size).toBe(1);
    session.dispose();
  });

  it('laying river drains ice with distance on land, and nothing melts during the intro', async () => {
    const { session } = await slopeSession({ water: WATER }, { skipIntro: false });
    expect(session.phase).toBe('intro');
    session.advance(120, NONE);
    expect(session.iceberg.ice).toBe(1);
    session.skipIntro();
    session.advance(60 * 8, NONE);
    const ice = session.iceberg.ice;
    expect(session.stats.distance).toBeGreaterThan(50);
    // Straight down the fall line: only distance costs ice.
    expect(1 - ice).toBeCloseTo(session.stats.distance / WATER.metres, 6);
    expect(session.stats.iceLeft).toBe(ice);
    const snap = getSnapshot(session);
    expect(snap.ice).toBe(ice);
    expect(snap.size).toBeCloseTo(P0.minSize + (1 - P0.minSize) * ice, 12);
    expect(session.iceberg.radius).toBeCloseTo(P0.radius * snap.size, 12);
    session.dispose();
  });

  it('running out of ice fails the run as melted, with the event and final stats', async () => {
    const { session, events } = await slopeSession({ water: { ...WATER, metres: 40 } });
    session.advance(60 * 20, NONE);
    expect(session.phase).toBe('failed');
    expect(session.failReason).toBe('melted');
    const failed = events.filter((e) => e.type === 'failed');
    expect(failed).toHaveLength(1);
    const f = failed[0];
    if (f.type !== 'failed') throw new Error('unreachable');
    expect(f.reason).toBe('melted');
    expect(f.stats.iceLeft).toBe(0);
    expect(f.stats.score).toBe(0);
    expect(session.stats.distance).toBeGreaterThanOrEqual(40 - 1e-6);
    expect(session.stats.distance).toBeLessThan(40.5);
    expect(session.iceberg.ice).toBe(0);
    expect(session.iceberg.size).toBeCloseTo(P0.minSize, 12);
    const snap = getSnapshot(session);
    expect(snap.outcome).toBe('lost');
    expect(snap.failReason).toBe('melted');
    session.dispose();
  });

  it('a level without a water budget never melts, however winding the route', async () => {
    const { session } = await slopeSession({});
    for (let i = 0; i < 60 * 25 && session.phase === 'playing'; i++) {
      session.update(FIXED_DT, { steer: 0.4 * Math.sin(i / 40), source: 'scripted' });
    }
    expect(session.stats.distance).toBeGreaterThan(100);
    expect(session.failReason).not.toBe('melted');
    expect(session.iceberg.ice).toBe(1);
    expect(session.iceberg.size).toBe(1);
    expect(session.iceberg.radius).toBe(P0.radius);
    expect(session.stats.iceLeft).toBe(1);
    session.dispose();
  });

  it('computeScore adds round(iceLeft × 600)', () => {
    const level = { ...level1, startS: 0, finishS: 500 };
    const st = {
      levelId: level.id,
      time: 50,
      distance: 500,
      topSpeed: 20,
      knockedDown: 3,
      buildingsDestroyed: 0,
      treesFelled: 0,
      waterfallsCrossed: 1,
      collisions: 3,
      iceLeft: 0,
      absorbed: 0,
      peakMass: 30,
      score: 0,
    };
    const base = computeScore(st, level);
    expect(computeScore({ ...st, iceLeft: 0.5 }, level) - base).toBe(300);
    expect(computeScore({ ...st, iceLeft: 0.3333 }, level) - base).toBe(200);
    // A grown iceberg (absorbed glacier ice) scores its extra ice too.
    expect(computeScore({ ...st, iceLeft: 1.39 }, level) - base).toBe(834);
    expect(ICE_SCORE).toBe(600);
  });

  it('autopilot completes with a water budget; score counts the ice left; no melt at sea', async () => {
    const { session, events } = await slopeSession(
      { water: { ...WATER, metres: 800 }, finishS: 330 },
      { sea: true },
    );
    let iceAtSea = -1;
    session.events.on((e) => {
      if (e.type === 'enteredOcean') iceAtSea = session.iceberg.ice;
    });
    for (let i = 0; i < 60 * 120 && session.phase === 'playing'; i++) {
      session.update(FIXED_DT, autopilotSteer(session.iceberg, session.terrain));
    }
    expect(session.phase).toBe('complete');
    const st = session.stats;
    expect(st.iceLeft).toBe(session.iceberg.ice);
    expect(st.iceLeft).toBe(iceAtSea);
    expect(st.iceLeft).toBeGreaterThan(0.3);
    expect(st.iceLeft).toBeLessThan(0.95);
    const withoutBonus = computeScore({ ...st, iceLeft: 0 }, session.level);
    expect(st.score).toBe(withoutBonus + Math.round(st.iceLeft * ICE_SCORE));
    const done = events.filter((e) => e.type === 'complete');
    expect(done).toHaveLength(1);
    if (done[0].type === 'complete') expect(done[0].stats.score).toBe(st.score);
    // The iceberg keeps drifting after the finish without melting further.
    session.advance(120, NONE);
    expect(session.iceberg.ice).toBe(st.iceLeft);
    session.dispose();
  });
});

// --- expansion mechanics: chipping, absorbing, per-level iceberg, line autopilot ----------------
// Analytic 0.1 slope (s = z, d = -x) with a scripted physics world, so these tests are independent
// of the Rapier world and of any level layout.

interface Chunk {
  pos: Vec3;
  vel: Vec3;
  mass: number;
}

/** Minimal physics world: anchored bodies break at testImpulse >= breakImpulse, loose ones slide. */
class ScriptedPhysics implements PhysicsWorldApi {
  readonly stats: ObstacleStats = {
    knockedDown: 0,
    buildingsDestroyed: 0,
    treesFelled: 0,
    rocksMoved: 0,
    sweptByWater: 0,
  };
  readonly chunks: Chunk[] = [];
  readonly contacts: IcebergContact[] = [];
  readonly absorbed: number[] = [];
  bodies: ObstacleProxy[];
  absorb?: (id: number) => { mass: number; vel: Vec3 } | null;

  constructor(bodies: ObstacleProxy[], absorbing = true) {
    this.bodies = bodies;
    if (absorbing) this.absorb = (id) => this.take(id);
  }

  step(dt: number): void {
    for (const b of this.bodies) {
      if (b.anchored) continue;
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      b.vx *= 0.97;
      b.vz *= 0.97;
    }
  }

  proxiesNear(x: number, z: number, radius: number): readonly ObstacleProxy[] {
    return this.bodies.filter((b) => Math.hypot(b.x - x, b.z - z) < radius + b.radius);
  }

  applyContact(c: IcebergContact): ContactOutcome {
    this.contacts.push(c);
    const b = this.bodies.find((o) => o.id === c.obstacleId);
    if (!b) return { obstacleId: c.obstacleId, kind: 'rockSmall', result: 'none' };
    if (b.anchored) {
      const J = c.testImpulse ?? Math.hypot(c.impulse.x, c.impulse.y, c.impulse.z);
      if (J < b.breakImpulse) return { obstacleId: b.id, kind: b.kind, result: 'shook' };
      this.bodies = this.bodies.filter((o) => o !== b);
      this.stats.buildingsDestroyed++;
      return { obstacleId: b.id, kind: b.kind, result: 'broken' };
    }
    b.vx += c.impulse.x / b.mass;
    b.vz += c.impulse.z / b.mass;
    return { obstacleId: b.id, kind: b.kind, result: 'pushed' };
  }

  applyWaterForces(): void {}

  drainEvents(): GameEvent[] {
    return [];
  }

  spawnIceChunks(pos: Vec3, vel: Vec3, totalMass: number): void {
    this.chunks.push({ pos, vel, mass: totalMass });
  }

  private take(id: number): { mass: number; vel: Vec3 } | null {
    const b = this.bodies.find((o) => o.id === id);
    if (!b || !b.absorbable) return null;
    this.bodies = this.bodies.filter((o) => o !== b);
    this.absorbed.push(id);
    return { mass: b.mass, vel: { x: b.vx, y: b.vy, z: b.vz } };
  }

  dispose(): void {}
}

const SLOPE_Y = (z: number): number => 60 - 0.1 * z;

/** A body standing on the analytic slope at s = z (d = 0 unless x is given). */
function bodyAt(id: number, z: number, o: Partial<ObstacleProxy>, x = 0): ObstacleProxy {
  const y = SLOPE_Y(z);
  return {
    id,
    kind: 'rockSmall',
    part: 'body',
    x,
    y,
    z,
    radius: 1,
    top: y + 2,
    bottom: y - 0.5,
    mass: 1,
    vx: 0,
    vy: 0,
    vz: 0,
    anchored: false,
    breakImpulse: Infinity,
    state: 'loose',
    ...o,
  };
}

const houseAt = (id: number, z: number, breakImpulse: number): ObstacleProxy =>
  bodyAt(id, z, {
    kind: 'house',
    part: 'house',
    mass: 12,
    radius: 3,
    top: SLOPE_Y(z) + 6,
    anchored: true,
    breakImpulse,
    state: 'intact',
  });

const iceBlockAt = (id: number, z: number, mass: number): ObstacleProxy =>
  bodyAt(id, z, { kind: 'iceBlock', part: 'ice', mass, radius: 1.5, absorbable: true });

async function scriptedSession(
  bodies: ObstacleProxy[],
  opts: { level?: Partial<LevelDef>; params?: IcebergParams; absorbing?: boolean } = {},
): Promise<{ session: GameSession; events: GameEvent[]; physics: ScriptedPhysics }> {
  const terrain = slopeTerrain(opts.level ?? {});
  const physics = new ScriptedPhysics(bodies, opts.absorbing ?? true);
  const session = await GameSession.create({
    level: terrain.level,
    terrain,
    physics,
    skipIntro: true,
    params: opts.params,
  });
  const events: GameEvent[] = [];
  session.events.on((e) => events.push(e));
  session.advance(200, NONE); // past the start grace period
  return { session, events, physics };
}

/** Put the iceberg at s = z on the centreline moving straight down the slope at `speed`. */
function placeOnSlope(session: GameSession, z: number, speed: number): void {
  place(session, 0, z, speed, 0, z + 10);
}

const ofType = <T extends GameEvent['type']>(events: GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

const HOUSE_BREAK = 1.25 * 15 * 30;

describe('chunks break off on crashes', () => {
  it('smashing a house at 30 t chips 9.75 % once, with the event and the chunks', async () => {
    const { session, events, physics } = await scriptedSession([houseAt(1, 60, HOUSE_BREAK)]);
    placeOnSlope(session, 40, 16);
    for (let i = 0; i < 120 && !physics.stats.buildingsDestroyed; i++) session.update(FIXED_DT, NONE);
    session.advance(60, NONE);
    expect(physics.stats.buildingsDestroyed).toBe(1);
    const chips = ofType(events, 'iceChipped');
    expect(chips).toHaveLength(1);
    expect(chips[0].amount).toBeCloseTo(0.006 * (HOUSE_BREAK / 30 - 2.5), 9);
    expect(chips[0].chunkMass).toBeCloseTo(chips[0].amount * 30, 9);
    expect(physics.chunks).toHaveLength(1);
    expect(physics.chunks[0].mass).toBeCloseTo(chips[0].chunkMass, 9);
    expect(physics.chunks[0].vel.z).toBeGreaterThan(5); // carried along with the iceberg
    const ice = session.iceberg;
    expect(ice.ice).toBeCloseTo(1 - chips[0].amount, 9);
    expect(ice.mass).toBeCloseTo(30 * ice.ice, 9);
    expect(ice.radius).toBeCloseTo(P0.radius * (P0.minSize + (1 - P0.minSize) * ice.ice), 9);
    expect(session.stats.iceLeft).toBeCloseTo(ice.ice, 12);
    expect(getSnapshot(session).ice).toBeCloseTo(ice.ice, 12);
    session.dispose();
  });

  it('chips once per impact, never per step spent pressing on a body', async () => {
    // Never failed as stuck: it bounces off the house at 12 m/s, rolls back down the slope into it
    // (a second, gentle impact), bounces less and less, and finally rests against it.
    const params = { ...P0, stuckTime: 1e6 };
    const { session, events, physics } = await scriptedSession([houseAt(1, 60, Infinity)], { params });
    placeOnSlope(session, 60 - 3 - P0.radius - 0.15, 12);
    session.advance(60 * 15, NONE);
    expect(session.phase).toBe('playing');
    expect(physics.contacts.length).toBeGreaterThan(100); // a contact every step while resting on it
    const hits = ofType(events, 'collision');
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.length).toBeLessThanOrEqual(4);
    // Every chip directly follows the counted collision it belongs to, sized by that impact and by
    // the ice the iceberg still had (chips are a fraction of the current ice).
    const chips = ofType(events, 'iceChipped');
    expect(chips.length).toBeGreaterThanOrEqual(1);
    expect(chips.length).toBeLessThanOrEqual(2);
    let iceBefore = 1;
    for (const chip of chips) {
      const before = events[events.indexOf(chip) - 1];
      if (before.type !== 'collision') throw new Error('a chip without its impact');
      expect(chip.amount).toBeCloseTo(0.006 * (1.25 * before.relSpeed - 2.5) * iceBefore, 9);
      iceBefore -= chip.amount;
    }
    // The 12 m/s bounce costs 7-9 %; the roll-back impact (~2 m/s) next to nothing.
    expect(chips[0].amount).toBeGreaterThan(0.07);
    expect(chips[0].amount).toBeLessThan(0.09);
    if (chips.length > 1) expect(chips[1].amount).toBeLessThan(0.005);
    expect(physics.chunks).toHaveLength(chips.length);
    const lost = chips.reduce((a, c) => a + c.amount, 0);
    expect(session.iceberg.ice).toBeCloseTo(1 - lost, 9);
    session.dispose();
  });

  it('light rocks chip nothing', async () => {
    const rocks = [bodyAt(1, 60, { mass: 0.8 }), bodyAt(2, 90, { mass: 0.8 }, 1)];
    const { session, events } = await scriptedSession(rocks);
    placeOnSlope(session, 40, 18);
    session.advance(60 * 4, NONE);
    expect(ofType(events, 'collision').length).toBeGreaterThanOrEqual(2);
    expect(ofType(events, 'iceChipped')).toHaveLength(0);
    expect(session.iceberg.ice).toBe(1);
    session.dispose();
  });

  it('a hit on a half-melted iceberg chips half the tonnage a full one would', async () => {
    const full = await scriptedSession([houseAt(1, 60, Infinity)]);
    placeOnSlope(full.session, 60 - 3 - P0.radius - 0.15, 12);
    full.session.advance(30, NONE);
    const half = await scriptedSession([houseAt(1, 60, Infinity)]);
    placeOnSlope(half.session, 60 - 3 - P0.radius - 0.15, 12);
    setIce(half.session.iceberg, 0.5, half.session.params);
    half.session.advance(30, NONE);
    const a = ofType(full.events, 'iceChipped')[0];
    const b = ofType(half.events, 'iceChipped')[0];
    expect(b.chunkMass / a.chunkMass).toBeCloseTo(0.5, 1);
    full.session.dispose();
    half.session.dispose();
  });

  it('a hit that would leave only a sliver shatters the rest and fails the run as melted', async () => {
    const { session, events } = await scriptedSession([houseAt(1, 60, Infinity)]);
    placeOnSlope(session, 60 - 3 - P0.radius - 0.15, 12);
    setIce(session.iceberg, SHATTER_BELOW + 0.001, session.params);
    session.advance(30, NONE);
    expect(session.phase).toBe('failed');
    expect(session.failReason).toBe('melted');
    const chips = ofType(events, 'iceChipped');
    expect(chips).toHaveLength(1);
    expect(chips[0].amount).toBeCloseTo(SHATTER_BELOW + 0.001, 12);
    expect(ofType(events, 'failed')).toHaveLength(1);
    expect(session.iceberg.ice).toBe(0);
    expect(session.stats.iceLeft).toBe(0);
    session.dispose();
  });

  it('chips nothing when the params disable chipping', async () => {
    const off = { ...P0, chipPerShock: 0 };
    const { session, events } = await scriptedSession([houseAt(1, 60, Infinity)], { params: off });
    placeOnSlope(session, 60 - 3 - P0.radius - 0.15, 12);
    session.advance(60, NONE);
    expect(ofType(events, 'collision').length).toBeGreaterThan(0);
    expect(ofType(events, 'iceChipped')).toHaveLength(0);
    session.dispose();
  });
});

describe('growth: absorbing glacier ice', () => {
  it('merges a block: momentum conserved, mass/size/radius grow, event, stats, snapshot', async () => {
    const { session, events, physics } = await scriptedSession([iceBlockAt(5, 60, 15)]);
    placeOnSlope(session, 45, 10);
    let before = NaN;
    let after = NaN;
    for (let i = 0; i < 120 && Number.isNaN(after); i++) {
      const v = hspeed(session);
      const n = events.length;
      session.update(FIXED_DT, NONE);
      if (events.slice(n).some((e) => e.type === 'absorbed')) {
        before = v;
        after = hspeed(session);
      }
    }
    expect(physics.absorbed).toEqual([5]);
    expect(physics.bodies).toHaveLength(0);
    // One step of gravity on a 0.1 slope adds < 0.02 m/s on top of the momentum exchange.
    expect(Math.abs(after - (before * 30) / 45)).toBeLessThan(0.03);
    expect(after).toBeLessThan(before);
    const ice = session.iceberg;
    expect(ice.ice).toBeCloseTo(1.5, 12);
    expect(ice.mass).toBeCloseTo(45, 12);
    expect(ice.size).toBeCloseTo(Math.cbrt(1.5), 12);
    expect(ice.radius).toBeCloseTo(P0.radius * Math.cbrt(1.5), 12);
    const ev = ofType(events, 'absorbed');
    expect(ev).toHaveLength(1);
    expect(ev[0].obstacleId).toBe(5);
    expect(ev[0].mass).toBe(15);
    expect(ev[0].newMass).toBeCloseTo(45, 12);
    expect(ofType(events, 'collision')).toHaveLength(0);
    expect(session.stats.absorbed).toBe(15);
    expect(session.stats.peakMass).toBeCloseTo(45, 12);
    expect(session.stats.iceLeft).toBe(1.5); // RunStats.iceLeft follows growth (scored too)
    const snap = getSnapshot(session);
    expect(snap.ice).toBeCloseTo(1.5, 12);
    expect(snap.mass).toBeCloseTo(45, 12);
    expect(snap.size).toBeCloseTo(Math.cbrt(1.5), 12);
    expect(snap.radius).toBeCloseTo(ice.radius, 12);
    expect(snap.absorbed).toBe(15);
    expect(snap.peakMass).toBeCloseTo(45, 12);
    expect(snap.momentum).toBeCloseTo(45 * snap.speed, 9);
    session.dispose();
  });

  it('respects maxIce: the overflow shatters into chunks and a full iceberg just pushes ice', async () => {
    const params = { ...P0, maxIce: 1.5 };
    // A light second block: pushing it chips nothing, so the iceberg stays exactly full.
    const blocks = [iceBlockAt(5, 60, 30), iceBlockAt(6, 80, 2)];
    const { session, events, physics } = await scriptedSession(blocks, { params });
    placeOnSlope(session, 45, 12);
    for (let i = 0; i < 60 * 5; i++) {
      session.update(FIXED_DT, NONE);
      expect(session.iceberg.ice).toBeLessThanOrEqual(1.5);
    }
    expect(physics.absorbed).toEqual([5]);
    expect(session.iceberg.ice).toBe(1.5);
    expect(session.stats.absorbed).toBeCloseTo(15, 9);
    expect(session.stats.peakMass).toBeCloseTo(45, 9);
    expect(physics.chunks).toHaveLength(1);
    expect(physics.chunks[0].mass).toBeCloseTo(15, 9);
    expect(physics.contacts.some((c) => c.obstacleId === 6)).toBe(true);
    expect(ofType(events, 'absorbed')).toHaveLength(1);
    expect(ofType(events, 'iceChipped')).toHaveLength(0);
    session.dispose();
  });

  it('a full iceberg crashing into a heavy block chips a little and then tops up from it', async () => {
    const params = { ...P0, maxIce: 1.5 };
    const blocks = [iceBlockAt(5, 60, 30), iceBlockAt(6, 80, 30)];
    const { session, events, physics } = await scriptedSession(blocks, { params });
    placeOnSlope(session, 45, 12);
    for (let i = 0; i < 60 * 5; i++) {
      session.update(FIXED_DT, NONE);
      expect(session.iceberg.ice).toBeLessThanOrEqual(1.5);
    }
    expect(physics.absorbed).toEqual([5, 6]);
    const chips = ofType(events, 'iceChipped');
    expect(chips).toHaveLength(1);
    const topUp = ofType(events, 'absorbed')[1];
    expect(topUp.mass).toBeCloseTo(chips[0].chunkMass, 9);
    expect(session.iceberg.ice).toBe(1.5);
  });

  it('without an absorb() in the physics world glacier ice is an ordinary loose body', async () => {
    const blocks = [iceBlockAt(5, 60, 3)];
    const { session, events, physics } = await scriptedSession(blocks, { absorbing: false });
    placeOnSlope(session, 45, 10);
    session.advance(60 * 2, NONE);
    expect(session.iceberg.ice).toBe(1);
    expect(physics.contacts.some((c) => c.obstacleId === 5)).toBe(true);
    expect(ofType(events, 'absorbed')).toHaveLength(0);
    session.dispose();
  });
});

describe('per-level iceberg', () => {
  it('LevelDef.iceberg sets radius (2.2 × scale) and mass; chunks weigh in its tonnes', async () => {
    const level = { iceberg: { scale: 2, mass: 100 } };
    const { session, events } = await scriptedSession([houseAt(1, 70, Infinity)], { level });
    expect(session.params.radius).toBeCloseTo(4.4, 12);
    expect(session.params.mass).toBe(100);
    expect(session.iceberg.radius).toBeCloseTo(4.4, 12);
    expect(session.iceberg.mass).toBe(100);
    expect(session.stats.peakMass).toBe(100);
    placeOnSlope(session, 70 - 3 - 4.4 - 0.15, 12);
    session.advance(30, NONE);
    const chips = ofType(events, 'iceChipped');
    expect(chips).toHaveLength(1);
    expect(chips[0].chunkMass).toBeCloseTo(chips[0].amount * 100, 9);
    expect(getSnapshot(session).mass).toBeCloseTo(100 * session.iceberg.ice, 9);
    session.dispose();
  });

  it('a 100 t level iceberg smashes a house at ~5 m/s that bounces a 30 t one', async () => {
    for (const [mass, broken] of [
      [100, 1],
      [30, 0],
    ] as const) {
      const { session, physics } = await scriptedSession([houseAt(1, 60, HOUSE_BREAK)], {
        level: { iceberg: { scale: 1, mass } },
      });
      placeOnSlope(session, 60 - 3 - P0.radius - 0.1, 5);
      session.advance(20, NONE);
      expect(physics.stats.buildingsDestroyed, `${mass} t`).toBe(broken);
      session.dispose();
    }
  });
});

describe('autopilot', () => {
  const line = [
    { s: 0, d: 0 },
    { s: 120, d: 10 },
    { s: 240, d: -8 },
    { s: 420, d: 0 },
  ];
  const lineD = (s: number): number => {
    for (let i = 1; i < line.length; i++) {
      if (s <= line[i].s) {
        const a = line[i - 1];
        const b = line[i];
        return a.d + ((b.d - a.d) * (s - a.s)) / (b.s - a.s);
      }
    }
    return line[line.length - 1].d;
  };

  async function follow(lane: number | undefined): Promise<{ s: number; d: number }[]> {
    const { session } = await scriptedSession([], { level: { line } });
    const track: { s: number; d: number }[] = [];
    for (let i = 0; i < 60 * 60 && session.phase === 'playing'; i++) {
      session.update(FIXED_DT, autopilotSteer(session.iceberg, session.terrain, { lane }));
      const p = session.terrain.course.project(session.iceberg.pos.x, session.iceberg.pos.z);
      track.push(p);
      if (p.s > 380) break;
    }
    session.dispose();
    return track.filter((p) => p.s > 60 && p.s < 360);
  }

  it('follows the level line when no lane is given', async () => {
    const track = await follow(undefined);
    expect(track.length).toBeGreaterThan(100);
    const err = track.map((p) => Math.abs(p.d - lineD(p.s)));
    expect(err.reduce((a, b) => a + b, 0) / err.length).toBeLessThan(2.5);
    expect(Math.max(...err)).toBeLessThan(5);
    const near = (s: number): number[] => track.filter((p) => Math.abs(p.s - s) < 8).map((p) => p.d);
    expect(Math.max(...near(120))).toBeGreaterThan(6);
    expect(Math.min(...near(240))).toBeLessThan(-4);
  });

  it('an explicit lane offsets from the line', async () => {
    const track = await follow(4);
    const off = track.map((p) => p.d - lineD(p.s));
    expect(Math.abs(off.reduce((a, b) => a + b, 0) / off.length - 4)).toBeLessThan(1.5);
  });

  it('without a line it aims along the centreline (plus lane) as before', async () => {
    const { session } = await scriptedSession([]);
    for (let i = 0; i < 60 * 15; i++) {
      session.update(FIXED_DT, autopilotSteer(session.iceberg, session.terrain, { lane: -6 }));
    }
    const p = session.terrain.course.project(session.iceberg.pos.x, session.iceberg.pos.z);
    expect(Math.abs(p.d + 6)).toBeLessThan(1.5);
    session.dispose();
  });
});
