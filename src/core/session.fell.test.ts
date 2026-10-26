import { describe, expect, it } from 'vitest';
import { FELL_BEAT, FELL_DEPTH, FIXED_DT, GameSession } from './session';
import { dirToHeading } from './math';
import { DEFAULT_ICEBERG_PARAMS } from './sim/params';
import { createTerrain, type GeneratedTerrain } from './terrain/terrain';
import type {
  ContactOutcome,
  GameEvent,
  IcebergContact,
  IcebergParams,
  LevelDef,
  ObstacleStats,
  PhysicsWorldApi,
  SteeringInput,
} from './types';

/**
 * Fatal ravines ('fell'): when a fall ends the run, how quickly, and everything that must NOT
 * count (jumping a ravine, landing on its far edge, riding along its rim, cliffs and cliff bands,
 * the sea, ravines marked fatal: false). Straight synthetic valley along +Z (s = z, d = −x),
 * floor slope 0.1, no obstacles.
 */

const level = (over: Partial<LevelDef> = {}): LevelDef => ({
  id: 'fell',
  index: 99,
  name: 'Fell',
  subtitle: 'test',
  seed: 3,
  bounds: { minX: -90, maxX: 90, minZ: -60, maxZ: 760 },
  cellSize: 2,
  seaLevel: 0,
  course: [
    { x: 0, z: 0, floor: 90, halfWidth: 25 },
    { x: 0, z: 700, floor: 20, halfWidth: 25 },
  ],
  cliffs: [
    { s: 330, drop: 10 },
    { s: 420, drop: 8, d: -10, width: 22 },
  ],
  wallHeight: 25,
  wallRamp: 15,
  startS: 20,
  coastS: 600,
  finishS: 620,
  obstacles: [],
  decor: { sceneryTreeDensity: 0, bushDensity: 0, grassTuftDensity: 0, pebbleDensity: 0 },
  features: [
    // A kicker and a full-width ravine (14 m, 8 m deep).
    { type: 'ramp', s: 200, d: 0, width: 12, length: 12, height: 3 },
    { type: 'gap', s: 200, length: 14, depth: 8 },
    // A ravine running down the slope on the right (rim at d = 6).
    {
      type: 'ravine',
      points: [
        { s: 250, d: 10 },
        { s: 310, d: 10 },
      ],
      width: 8,
      depth: 7,
    },
  ],
  ...over,
});

class NoPhysics implements PhysicsWorldApi {
  readonly stats: ObstacleStats = {
    knockedDown: 0,
    buildingsDestroyed: 0,
    treesFelled: 0,
    rocksMoved: 0,
    sweptByWater: 0,
  };
  step(): void {}
  proxiesNear(): never[] {
    return [];
  }
  applyContact(c: IcebergContact): ContactOutcome {
    return { obstacleId: c.obstacleId, kind: 'rockSmall', result: 'none' };
  }
  applyWaterForces(): void {}
  drainEvents(): GameEvent[] {
    return [];
  }
  dispose(): void {}
}

const NONE: SteeringInput = { steer: 0, source: 'none' };
const PARAMS: IcebergParams = { ...DEFAULT_ICEBERG_PARAMS, graceTime: 0 };
const terrains = new Map<string, GeneratedTerrain>();

async function session(lv: LevelDef = level(), params = PARAMS): Promise<GameSession> {
  const key = JSON.stringify(lv);
  let t = terrains.get(key);
  if (!t) {
    t = createTerrain(lv);
    terrains.set(key, t);
  }
  return GameSession.create({ level: lv, terrain: t, physics: new NoPhysics(), skipIntro: true, params });
}

/** Put the iceberg at (s, d) moving down-course at `speed`; `above` > 0 starts it in the air. */
function place(s: GameSession, at: number, d: number, speed: number, above = 0): void {
  const t = s.terrain;
  const ice = s.iceberg;
  const w = t.course.toWorld(at, d);
  ice.pos.x = w.x;
  ice.pos.z = w.z;
  ice.pos.y = w.y + above;
  ice.vel.x = 0;
  ice.vel.z = speed;
  ice.vel.y = above > 0 ? 0 : t.gradientAt(w.x, w.z).dz * speed;
  ice.heading = dirToHeading(0, 1);
  ice.grounded = above <= 0;
  ice.airPeakY = ice.pos.y;
  ice.stuckTimer = 0;
}

interface Watch {
  /** Play time when the iceberg first stood on a ravine floor (−1: never). */
  floorAt: number;
  steps: number;
}

/** Run until the phase changes from playing (or `seconds`), noting the first ravine-floor contact. */
function run(s: GameSession, seconds: number): Watch {
  const w: Watch = { floorAt: -1, steps: 0 };
  for (; w.steps < seconds * 60 && s.phase === 'playing'; w.steps++) {
    s.update(FIXED_DT, NONE);
    const ice = s.iceberg;
    const depth = s.terrain.ravineDepthAt?.(ice.pos.x, ice.pos.z) ?? 0;
    if (w.floorAt < 0 && ice.grounded && depth >= FELL_DEPTH) w.floorAt = s.stats.time;
  }
  return w;
}

const sNow = (s: GameSession): number => s.terrain.course.project(s.iceberg.pos.x, s.iceberg.pos.z).s;

describe('fatal ravines: falling in ends the run', () => {
  it('too slow off the kicker: plunges in, the run ends FELL_BEAT after touching the floor', async () => {
    const s = await session();
    const failed: GameEvent[] = [];
    s.events.on((e) => e.type === 'failed' && failed.push(e));
    place(s, 186, 0, 9);
    const w = run(s, 15);
    expect(s.phase).toBe('failed');
    expect(s.failReason).toBe('fell');
    expect(failed).toHaveLength(1);
    expect(failed[0].type === 'failed' && failed[0].reason).toBe('fell');
    expect(w.floorAt).toBeGreaterThan(0);
    expect(s.stats.time - w.floorAt).toBeCloseTo(FELL_BEAT, 1);
    // Well inside the ravine, down on its floor.
    expect(sNow(s)).toBeGreaterThan(200);
    expect(sNow(s)).toBeLessThan(214);
    const rim = s.terrain.course.toWorld(199, 0).y;
    expect(s.iceberg.pos.y).toBeLessThan(rim - 5);
    // Prompt: a few seconds, not the stuck timer.
    expect(s.stats.time).toBeLessThan(5);
    s.dispose();
  });

  it('the stuck rule never pre-empts the fall during the beat', async () => {
    const s = await session(level(), { ...PARAMS, stuckTime: 0.05 });
    place(s, 192, 0, 7);
    run(s, 10);
    expect(s.failReason).toBe('fell');
    s.dispose();
  });

  it('crawling over a ravine edge falls in too', async () => {
    const s = await session();
    place(s, 248, 4.5, 2.5);
    // Nudge it sideways into the ravine on its right.
    s.iceberg.vel.x = -3;
    run(s, 10);
    expect(s.failReason).toBe('fell');
    s.dispose();
  });
});

describe('fatal ravines: what does not count', () => {
  it('a fast jump clears the ravine and lands on the far side', async () => {
    const s = await session();
    const landed: number[] = [];
    s.events.on((e) => e.type === 'landed' && landed.push(s.terrain.course.project(e.pos.x, e.pos.z).s));
    place(s, 180, 0, 18);
    run(s, 4);
    expect(s.phase).toBe('playing');
    expect(landed[0]).toBeGreaterThan(214);
    expect(sNow(s)).toBeGreaterThan(230);
    s.dispose();
  });

  it('the far edge decides: landing just past it is safe, landing just short of it is not', async () => {
    const far = 214;
    const safe = await session();
    const rimY = safe.terrain.course.toWorld(far + 1, 0).y;
    place(safe, far - 1, 0, 9);
    safe.iceberg.pos.y = rimY + 2;
    safe.iceberg.grounded = false;
    safe.iceberg.airPeakY = safe.iceberg.pos.y;
    run(safe, 3);
    expect(safe.phase).toBe('playing');
    expect(sNow(safe)).toBeGreaterThan(far + 5);
    safe.dispose();

    const short = await session();
    place(short, far - 9, 0, 9);
    short.iceberg.pos.y = rimY + 2;
    short.iceberg.grounded = false;
    short.iceberg.airPeakY = short.iceberg.pos.y;
    run(short, 5);
    expect(short.failReason).toBe('fell');
    short.dispose();
  });

  it('riding along a ravine rim is safe', async () => {
    const s = await session();
    place(s, 240, 2, 10);
    run(s, 8);
    expect(s.phase).toBe('playing');
    expect(sNow(s)).toBeGreaterThan(320);
    s.dispose();
  });

  it('cliffs and cliff bands are waterfalls, not ravines', async () => {
    const s = await session();
    const crossed: GameEvent[] = [];
    s.events.on((e) => e.type === 'waterfallCrossed' && crossed.push(e));
    place(s, 300, -10, 12);
    run(s, 14);
    expect(s.phase).toBe('playing');
    expect(sNow(s)).toBeGreaterThan(440);
    expect(crossed.map((e) => e.type === 'waterfallCrossed' && e.index)).toEqual([0, 1]);
    s.dispose();
  });

  it('the sea finish completes the run', async () => {
    const s = await session();
    place(s, 540, 0, 12);
    run(s, 30);
    expect(s.phase).toBe('complete');
    s.dispose();
  });

  it('a ravine marked fatal: false is a plain trench (the old trap: stuck, never fell)', async () => {
    const lv = level({
      id: 'fell-trench',
      features: [
        { type: 'ramp', s: 200, d: 0, width: 12, length: 12, height: 3 },
        { type: 'gap', s: 200, length: 14, depth: 8, fatal: false },
      ],
    });
    const s = await session(lv);
    expect(s.terrain.ravineDepthAt).toBeUndefined();
    place(s, 186, 0, 9);
    run(s, 40);
    expect(s.phase).toBe('failed');
    expect(s.failReason).toBe('stuck');
    expect(sNow(s)).toBeGreaterThan(200);
    expect(sNow(s)).toBeLessThan(214);
    s.dispose();
  });
});
