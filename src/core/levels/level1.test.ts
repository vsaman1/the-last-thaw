import { describe, expect, it } from 'vitest';
import { FIXED_DT, GameSession, getTerrain } from '../session';
import { autopilotSteer } from '../autopilot';
import { DEFAULT_ICEBERG_PARAMS } from '../sim/params';
import { buildObstacleSpecs } from '../obstacles/spawn';
import { isTreeKind } from '../obstacles/catalog';
import { validatePlacements } from '../terrain/validate';
import type { LevelDef, ObstaclePlacement } from '../types';
import { level1 } from './level1';

const find = (kind: ObstaclePlacement['kind']): ObstaclePlacement[] =>
  level1.obstacles.filter((o) => o.kind === kind);
const cliff = level1.cliffs[0];
const barrier = find('stoneBarrier')[0];
const house = find('house')[0];

/** Level-design checks from the gameplay review (layout only; behaviour is in session.test.ts). */
describe('level 1 layout', () => {
  const terrain = getTerrain(level1);

  it('keeps every obstacle placement valid', () => {
    expect(validatePlacements(terrain)).toEqual([]);
  });

  it('keeps the tutorial beats in order: open start, rocky gate, waterfall, house, beach, sea', () => {
    const hw = (s: number): number => terrain.course.sampleAt(s).halfWidth;
    for (let s = level1.startS; s < level1.startS + 80; s += 10) expect(hw(s), `s=${s}`).toBeGreaterThan(26);
    const early = level1.obstacles.filter((o) => o.s < level1.startS + 100);
    expect(early.length).toBeGreaterThanOrEqual(2);
    // Nothing heavy while learning to steer: small rocks and trees only.
    const light = (o: ObstaclePlacement): boolean =>
      o.kind === 'rockSmall' || o.kind === 'rockCluster' || isTreeKind(o.kind);
    expect(early.filter((o) => !light(o))).toEqual([]);
    expect(hw(barrier.s)).toBeLessThan(16);
    expect(barrier.s).toBeLessThan(cliff.s);
    expect(house.s).toBeGreaterThan(cliff.s);
    const lowerGrove = level1.obstacles.filter((o) => o.kind === 'pine' && o.s > cliff.s);
    expect(lowerGrove.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(house.s, ...lowerGrove.map((p) => p.s))).toBeLessThan(level1.coastS - 25);
    const beach = terrain.course.toWorld(level1.coastS - 10, 0);
    expect(terrain.surfaceAt(beach.x, beach.z)).toBe('sand');
    expect(level1.coastS).toBeLessThan(level1.finishS);
  });

  it('always builds the stone barrier from exactly three stones, whatever the seed', () => {
    const index = level1.obstacles.indexOf(barrier);
    for (const seed of [level1.seed, 1, 2, 3, 4, 5, 6, 7, 8]) {
      const stones = buildObstacleSpecs(terrain, seed).filter((s) => s.placement === index);
      expect(stones, `seed ${seed}`).toHaveLength(3);
    }
  });

  it('has a tree cluster near the line in both the upper and the lower valley', () => {
    const near = level1.obstacles.filter((o) => isTreeKind(o.kind) && Math.abs(o.d) <= 14);
    const hasCluster = (s0: number, s1: number): boolean => {
      const inRange = near.filter((o) => o.s >= s0 && o.s <= s1);
      return inRange.some((a) => inRange.some((b) => b !== a && Math.abs(a.s - b.s) <= 15));
    };
    expect(hasCluster(level1.startS, barrier.s)).toBe(true);
    expect(hasCluster(cliff.s, level1.coastS)).toBe(true);
  });

  it('never puts two trees so close that the iceberg (4.4 m wide) could wedge between them', () => {
    const trees = level1.obstacles.filter((o) => isTreeKind(o.kind));
    for (const a of trees) {
      for (const b of trees) {
        if (a === b) continue;
        const gap = Math.hypot(a.s - b.s, a.d - b.d);
        expect(gap, `trees at s=${a.s} d=${a.d} and s=${b.s} d=${b.d}`).toBeGreaterThan(7.5);
      }
    }
  });

  it('puts the one house where a deliberate line through the lower valley reaches it', () => {
    // Reachable: in the central half of the floor, below the waterfall.
    expect(house.s).toBeGreaterThan(cliff.s);
    expect(Math.abs(house.d)).toBeLessThanOrEqual(terrain.course.sampleAt(house.s).halfWidth / 2);
    // ...but off the centre line: a centred iceberg (r 2.2) passes the house footprint (~6 m) by > 2 m.
    expect(Math.abs(house.d)).toBeGreaterThan(2.2 + 6 + 2);
  });
});

describe('level 1 water budget', () => {
  it('has a water budget that lasts a straight run but makes winding matter', () => {
    const water = level1.water!;
    expect(water).toBeDefined();
    const run = level1.coastS - level1.startS;
    expect(water.metres).toBeGreaterThan(1.1 * run);
    expect(water.metres).toBeLessThan(2 * run);
    expect(water.turnMetresPerRadian).toBeGreaterThan(0);
    expect(water.turnMetresPerRadian).toBeLessThan(60);
  });

  // Balance guard (measured in DEVLOG): smooth play keeps a healthy reserve, extreme winding melts.
  const drive = async (steer: (s: GameSession, n: number) => number) => {
    const s = await GameSession.create({ level: level1, skipIntro: true });
    let n = 0;
    while (s.phase === 'playing' && n < 150 * 60) {
      s.update(FIXED_DT, { steer: steer(s, n), source: 'scripted' });
      n++;
    }
    const out = { phase: s.phase, reason: s.failReason, ice: s.iceberg.ice };
    s.dispose();
    return out;
  };

  it('a smooth centre line reaches the sea with roughly a third of the ice left', async () => {
    const r = await drive((s) => autopilotSteer(s.iceberg, s.terrain, { lane: 0 }).steer);
    expect(r.phase).toBe('complete');
    expect(r.ice).toBeGreaterThan(0.25);
    expect(r.ice).toBeLessThan(0.55);
  });

  it('weaving wall to wall melts the iceberg before the sea', async () => {
    const r = await drive((s, n) => autopilotSteer(s.iceberg, s.terrain, { lane: 18 * Math.sin(n / 33) }).steer);
    expect(r.phase).toBe('failed');
    expect(r.reason).toBe('melted');
  });
});

describe('level 1 playability (autopilot, no water budget)', () => {
  // Independent of the melt mechanic: no budget on the level and no melt in the params.
  const noMelt: LevelDef = { ...level1, id: `${level1.id}-no-melt`, water: undefined };
  const params = { ...DEFAULT_ICEBERG_PARAMS, meltPerMetre: 0, meltPerRadian: 0 };

  it.each([-10, 0, 10])('an autopilot on lane %i m completes in under 60 s of game time', async (lane) => {
    const session = await GameSession.create({ level: noMelt, skipIntro: true, params });
    for (let i = 0; i < 60 * 90 && session.phase === 'playing'; i++) {
      session.update(FIXED_DT, autopilotSteer(session.iceberg, session.terrain, { lane }));
    }
    const at = session.terrain.course.project(session.iceberg.pos.x, session.iceberg.pos.z).s;
    expect(session.phase, `lane ${lane} ended at s=${at.toFixed(0)}`).toBe('complete');
    expect(session.stats.time).toBeLessThan(60);
    expect(session.stats.waterfallsCrossed).toBe(1);
    session.dispose();
  });
});
