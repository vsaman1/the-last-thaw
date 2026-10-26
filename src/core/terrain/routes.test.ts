import { describe, expect, it } from 'vitest';
import type {
  ContactOutcome,
  GameEvent,
  IcebergContact,
  LevelDef,
  ObstacleStats,
  PhysicsWorldApi,
  TerrainFeature,
} from '../types';
import { createTerrain } from './terrain';
import { analyzeRoutes, headToSpeed, lineHeads, minClearSpeed, probeFlight } from './routes';
import { validateLevel, validateLine, validateRoutes } from './validate';
import { autopilotSteer, lineOffsetAt } from '../autopilot';
import { FIXED_DT, GameSession } from '../session';
import { DEFAULT_ICEBERG_PARAMS } from '../sim/params';

/**
 * Route tools (./routes.ts) on a straight synthetic valley (s = z, d = −x, floor slope 0.1,
 * halfWidth 40 m, cellSize 2): jump probes, the route search's way to the sea and dead ends, the
 * validator's ravine-crossing and route checks, and the autopilot's path pursuit.
 */

const valley = (over: Partial<LevelDef> = {}): LevelDef => ({
  id: 'routes',
  index: 99,
  name: 'Routes',
  subtitle: 'test',
  seed: 12,
  bounds: { minX: -110, maxX: 110, minZ: -60, maxZ: 700 },
  cellSize: 2,
  seaLevel: 0,
  course: [
    { x: 0, z: 0, floor: 64, halfWidth: 40 },
    { x: 0, z: 680, floor: -4, halfWidth: 40 },
  ],
  cliffs: [],
  wallHeight: 25,
  wallRamp: 15,
  startS: 20,
  coastS: 600,
  finishS: 620,
  obstacles: [],
  decor: { sceneryTreeDensity: 0, bushDensity: 0, grassTuftDensity: 0, pebbleDensity: 0 },
  ...over,
});

/** A ravine straight across the floor (into both walls) at s0 … s0 + width. */
const across = (s0: number, width: number, depth = 8): TerrainFeature => ({
  type: 'ravine',
  points: [
    { s: s0 + width / 2, d: -55 },
    { s: s0 + width / 2, d: 55 },
  ],
  width,
  depth,
});
const kicker: TerrainFeature = { type: 'ramp', s: 300, d: 0, width: 14, length: 14, height: 3.5 };
const dir = { x: 0, z: 1 };

describe('jump probes', () => {
  const t = createTerrain(valley({ features: [kicker, across(300, 16)] }));
  const at = (s: number, d = 0): { x: number; z: number } => t.course.toWorld(s, d);

  it('fly off the kicker and land clear when fast, fall in when slow', () => {
    const p = at(282);
    const fast = probeFlight(t, p.x, p.z, dir.x, dir.z, 18, 30);
    expect(fast.outcome).toBe('landed');
    expect(t.course.project(fast.x, fast.z).s).toBeGreaterThan(316);
    expect(fast.flown).toBeGreaterThan(16);
    expect(fast.over).toBe(true);
    expect(probeFlight(t, p.x, p.z, dir.x, dir.z, 6, 30).outcome).toBe('fell');
    const slowest = minClearSpeed(t, p.x, p.z, dir.x, dir.z, 30);
    expect(slowest.speed).toBeGreaterThan(6);
    expect(slowest.speed).toBeLessThan(18);
  });

  it('without the kicker the same ravine cannot be cleared below the speed cap', () => {
    const p = at(282, 25);
    expect(minClearSpeed(t, p.x, p.z, dir.x, dir.z, 30).speed).toBe(Infinity);
  });

  it('stop at a wall', () => {
    const wall = createTerrain(
      valley({
        features: [
          {
            type: 'ridge',
            points: [
              { s: 300, d: -55 },
              { s: 300, d: 55 },
            ],
            width: 6,
            height: 10,
          },
        ],
      }),
    );
    const p = wall.course.toWorld(290, 0);
    expect(probeFlight(wall, p.x, p.z, 0, 1, 15, 20).outcome).toBe('wall');
  });
});

describe('route search', () => {
  it('a plain valley has a way to the sea and no dead ends', () => {
    const r = analyzeRoutes(createTerrain(valley()));
    expect(r.solvable).toBe(true);
    expect(r.deadEnds).toEqual([]);
    expect(r.path[0].s).toBeLessThan(30);
    expect(r.path[r.path.length - 1].s).toBeGreaterThanOrEqual(600);
  });

  it('a ravine across the floor with no kicker closes the level; a kicker opens it', () => {
    const closed = createTerrain(valley({ features: [across(300, 16)] }));
    const r = analyzeRoutes(closed);
    expect(r.solvable).toBe(false);
    expect(r.reachedS).toBeLessThan(305);
    expect(r.deadEnds[0].cause).toBe('ravine');
    const issues = validateRoutes(closed, r).map((i) => i.problem);
    expect(issues.join()).toMatch(/no way from the spawn to the sea/);

    const open = analyzeRoutes(createTerrain(valley({ features: [kicker, across(300, 16)] })));
    expect(open.solvable).toBe(true);
    expect(open.jumps).toBeGreaterThan(0);
    // The route crosses on the kicker (its take-off cell may lie up to ~16 m before the lip).
    const before = open.path.filter((p) => p.s > 270 && p.s < 300);
    expect(before.length).toBeGreaterThan(0);
    for (const p of before) expect(Math.abs(p.d)).toBeLessThan(10);
  });

  it('reports a pocket behind a diagonal wall as a dead end', () => {
    const t = createTerrain(
      valley({
        features: [
          {
            type: 'ridge',
            points: [
              { s: 120, d: -5 },
              { s: 220, d: -30 },
              { s: 240, d: -52 },
            ],
            width: 6,
            height: 10,
          },
        ],
      }),
    );
    const r = analyzeRoutes(t);
    expect(r.solvable).toBe(true);
    const pocket = r.deadEnds.find((d) => d.d < -12 && d.s > 120 && d.s < 245);
    expect(pocket?.cause).toBe('trap');
    expect(pocket!.area).toBeGreaterThan(1000);
  });

  it('flags open-mountain courses that bend tighter than the floor is wide', () => {
    const bent = createTerrain(
      valley({
        bounds: { minX: -400, maxX: 400, minZ: -60, maxZ: 800 },
        course: [
          { x: 0, z: 0, floor: 64, halfWidth: 150 },
          { x: 0, z: 300, floor: 34, halfWidth: 150 },
          { x: 150, z: 450, floor: 14, halfWidth: 150 },
          { x: 300, z: 600, floor: -4, halfWidth: 150 },
        ],
        coastS: 500,
        finishS: 520,
      }),
    );
    expect(validateRoutes(bent).map((i) => i.problem).join()).toMatch(/bends with radius/);
  });

  it('the energy model carries a good line near the terminal speed of the slope', () => {
    const t = createTerrain(valley());
    const heads = lineHeads(t, [{ s: 20, d: 0 }]);
    const v = headToSpeed(heads[200]);
    // Terminal speed on a 0.1 slope: sqrt(g (0.1 − μ) / drag) ≈ 25 m/s.
    expect(v).toBeGreaterThan(18);
    expect(v).toBeLessThan(27);
  });
});

describe('validator: crossing ravines on the line', () => {
  it('a line through a ravine must fly it at the speed it carries; over the kicker it does', () => {
    const line = [
      { s: 20, d: 0 },
      { s: 600, d: 0 },
    ];
    const blind = createTerrain(valley({ features: [across(300, 16)], line }));
    expect(validateLine(blind).map((i) => i.problem).join()).toMatch(/into the ravine \(feature 0\)/);
    const jump = createTerrain(valley({ features: [kicker, across(300, 16)], line }));
    expect(validateLine(jump)).toEqual([]);
    expect(validateLevel(jump).map((i) => i.problem)).toEqual([]);
  });
});

// --- path pursuit ------------------------------------------------------------------------------

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

describe('autopilot path pursuit', () => {
  const line = [
    { s: 20, d: 0 },
    { s: 120, d: 0 },
    { s: 170, d: 32 },
    { s: 260, d: 32 },
    { s: 310, d: -32 },
    { s: 420, d: -32 },
    { s: 470, d: 0 },
    { s: 620, d: 0 },
  ];
  const lv = valley({ id: 'pursuit', line });
  const terrain = createTerrain(lv);

  /** Largest lateral miss (m) from the line over s 100 … 500, and whether the run finished. */
  const follow = async (pursuit: 'course' | 'path'): Promise<{ miss: number; phase: string }> => {
    const s = await GameSession.create({
      level: lv,
      terrain,
      physics: new NoPhysics(),
      skipIntro: true,
      params: DEFAULT_ICEBERG_PARAMS,
    });
    let miss = 0;
    for (let n = 0; n < 120 * 60 && s.phase === 'playing'; n++) {
      s.update(FIXED_DT, autopilotSteer(s.iceberg, s.terrain, { pursuit }));
      const p = s.terrain.course.project(s.iceberg.pos.x, s.iceberg.pos.z);
      if (p.s > 100 && p.s < 500) miss = Math.max(miss, Math.abs(p.d - lineOffsetAt(line, p.s)));
    }
    const out = { miss, phase: s.phase };
    s.dispose();
    return out;
  };

  it('follows a winding line with big lateral moves more closely than course pursuit', async () => {
    const path = await follow('path');
    const course = await follow('course');
    expect(path.phase).toBe('complete');
    expect(path.miss).toBeLessThan(course.miss);
    expect(path.miss).toBeLessThan(14);
  }, 60_000);
});
