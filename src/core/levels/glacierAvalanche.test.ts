import { describe, expect, it } from 'vitest';
import { FIXED_DT, GameSession, getTerrain } from '../session';
import { autopilotSteer, lineOffsetAt } from '../autopilot';
import { dirToHeading } from '../math';
import { buildObstacleSpecs } from '../obstacles/spawn';
import { isStructureKind, missingStructureKinds } from '../obstacles/structures';
import { DEFAULT_ICEBERG_PARAMS } from '../sim/params';
import { analyzeRoutes } from '../terrain/routes';
import { createTerrain } from '../terrain/terrain';
import { placementFootprint, validateLevel } from '../terrain/validate';
import { timed } from '../testing/timing';
import type {
  CourseCoord,
  ObstaclePlacement,
  RunStats,
  SteeringInput,
  Terrain,
  TerrainFeature,
} from '../types';
import { glacierAvalanche as L } from './glacierAvalanche';

const START_MASS = L.iceberg!.mass;
const isIce = (o: ObstaclePlacement): boolean => o.kind === 'iceField' || o.kind === 'iceBlock';
const ofKind = (kind: ObstaclePlacement['kind']): ObstaclePlacement[] =>
  L.obstacles.filter((o) => o.kind === kind);
const dam = ofKind('dam')[0];
const features = L.features ?? [];
const roads = features.filter((f): f is Extract<TerrainFeature, { type: 'road' }> => f.type === 'road');
const river = features.find((f): f is Extract<TerrainFeature, { type: 'stream' }> => f.type === 'stream')!;
/** Iceberg radius (m) at a mass (t): scale 0.8 base, size = cbrt(mass / start) once grown. */
const radiusAt = (mass: number): number => 2.2 * 0.8 * Math.cbrt(mass / 18);
interface Reservoir {
  fullVolume: number;
  broken: boolean;
  qPeak: number;
}
const reservoirs = (s: GameSession): Reservoir[] =>
  (s as unknown as { water: { reservoirs: Reservoir[] } }).water.reservoirs;
const onRoad = (o: ObstaclePlacement, margin = 1): boolean =>
  roads.some((r) => o.s >= r.s0 && o.s <= r.s1 && Math.abs(o.d - r.d) <= r.width / 2 + margin);

/** Alternative routes, steered with the real autopilot on a terrain whose level.line is replaced. */
const CENTRE: CourseCoord[] = [
  { s: 30, d: 0 }, { s: 150, d: 0 }, { s: 200, d: 6 }, { s: 270, d: 2 }, { s: 330, d: 4 }, { s: 400, d: 2 },
  { s: 440, d: 5 }, { s: 480, d: 15 }, { s: 505, d: 25 }, { s: 560, d: 38 }, { s: 600, d: 55 },
  { s: 650, d: 75 }, { s: 700, d: 86 }, { s: 760, d: 100 }, { s: 800, d: 105 }, { s: 860, d: 100 },
  { s: 920, d: 70 }, { s: 970, d: 45 }, { s: 1040, d: 15 }, { s: 1062, d: 0 }, { s: 1520, d: 0 },
];
/** Down the centre couloir, over the crevasse, then clear of every field. */
const SKIP: CourseCoord[] = [
  { s: 30, d: 0 }, { s: 150, d: 0 }, { s: 200, d: 6 }, { s: 270, d: 2 }, { s: 330, d: 4 }, { s: 400, d: 2 },
  { s: 440, d: 0 }, { s: 500, d: -16 }, { s: 600, d: -12 }, { s: 650, d: -10 },
  { s: 760, d: 5 }, { s: 820, d: 12 }, { s: 900, d: 20 }, { s: 960, d: 24 }, { s: 1000, d: 24 },
  { s: 1040, d: 12 }, { s: 1062, d: 4 }, { s: 1100, d: 0 }, { s: 1520, d: 0 },
];
/** Down the left couloir between moraine M1 and its fields, over the icefall, then clear of the ice. */
const SKIP_LEFT: CourseCoord[] = [
  { s: 30, d: 0 }, { s: 110, d: -20 }, { s: 175, d: -55 }, { s: 240, d: -75 }, { s: 300, d: -86 },
  { s: 350, d: -88 }, { s: 400, d: -88 }, { s: 440, d: -86 }, { s: 470, d: -70 }, { s: 500, d: -20 },
  { s: 600, d: -12 }, ...SKIP.filter((p) => p.s >= 650),
];
/** The centre route, but it swallows the 76 t trap field at the foot of the ridge. */
const GRAB: CourseCoord[] = [
  ...CENTRE.filter((p) => p.s <= 560), { s: 600, d: 22 }, { s: 626, d: 20 }, { s: 660, d: 40 },
  ...CENTRE.filter((p) => p.s >= 700),
];
/** Straight down the right couloir as fast as it goes. */
const RIGHT: CourseCoord[] = [
  { s: 30, d: 0 }, { s: 120, d: 25 }, { s: 170, d: 70 }, { s: 230, d: 92 }, { s: 330, d: 90 },
  { s: 380, d: 92 }, { s: 440, d: 95 }, { s: 520, d: 95 }, { s: 600, d: 90 },
  ...CENTRE.filter((p) => p.s >= 700),
];

describe('glacier avalanche layout', () => {
  const terrain = getTerrain(L);
  const specs = buildObstacleSpecs(terrain, L.seed);
  const iceMass = (o: ObstaclePlacement): number =>
    specs.filter((s) => s.placement === L.obstacles.indexOf(o)).reduce((a, s) => a + s.mass, 0);

  it('passes every level check, including a way from the spawn to the sea', () => {
    expect(validateLevel(terrain)).toEqual([]);
  });

  it('builds in under 2 s (CPU) on a grid under 250k vertices', () => {
    let best = Infinity;
    for (let i = 0; i < 2; i++) best = Math.min(best, timed(() => createTerrain(L)).ms);
    expect(best).toBeLessThan(2000);
    expect(terrain.grid.cols * terrain.grid.rows).toBeLessThan(250_000);
  });

  it('spawns at most 250 bodies, all from defined kinds', () => {
    expect(specs.length).toBeLessThanOrEqual(250);
    const used = new Set(L.obstacles.map((o) => o.kind).filter(isStructureKind));
    expect(missingStructureKinds().filter((k) => used.has(k))).toEqual([]);
  });

  it('is an open alpine mountainside: wide, straight, ~1.3 km to the sea, four drops', () => {
    expect(L.theme).toBe('alpine');
    expect(L.relief).toBeDefined();
    expect(L.iceberg).toEqual({ scale: 0.8, mass: 18 });
    expect(L.course.every((p) => p.x === 0)).toBe(true);
    for (let s = 200; s <= 880; s += 40) expect(terrain.course.sampleAt(s).halfWidth).toBeGreaterThan(150);
    const run = L.coastS - L.startS;
    expect(run).toBeGreaterThan(1200);
    expect(run).toBeLessThan(1450);
    expect(L.finishS - L.coastS).toBe(20);
    expect(terrain.course.length).toBeGreaterThanOrEqual(L.finishS + 100);
    const fin = terrain.course.toWorld(L.finishS, 0);
    expect(terrain.isOcean(fin.x, fin.z)).toBe(true);
    expect(L.cliffs.length).toBeGreaterThanOrEqual(4);
  });

  it('the route search reaches the sea and finds the right couloir a crevasse dead end', () => {
    const r = analyzeRoutes(terrain);
    expect(r.solvable).toBe(true);
    const right = r.deadEnds.find((d) => d.cause === 'ravine' && d.d > 80 && d.s > 300 && d.s < 480);
    expect(right).toBeDefined();
  });

  it('spreads physical glacier ice over competing branches, with bait in the dead ends', () => {
    const ice = L.obstacles.filter(isIce);
    const near = (pts: CourseCoord[], o: ObstaclePlacement): boolean =>
      Math.abs(lineOffsetAt(pts, o.s) - o.d) <= (o.spread ?? 0) + 1;
    const line = ice.filter((o) => near(L.line!, o));
    const centre = ice.filter((o) => near(CENTRE, o) && !near(L.line!, o));
    expect(line.length).toBeGreaterThanOrEqual(8);
    expect(centre.length).toBeGreaterThanOrEqual(4);
    const sum = (os: ObstaclePlacement[]): number => os.reduce((a, o) => a + iceMass(o), 0);
    expect(sum(line)).toBeGreaterThan(100);
    expect(sum(centre)).toBeGreaterThan(100);
    // Bait: the biggest field is the trap at the ridge foot; a big one sits deep in the pocket.
    const trap = ice.reduce((a, o) => (iceMass(o) > iceMass(a) ? o : a));
    expect(trap.s).toBeGreaterThan(600);
    expect(trap.s).toBeLessThan(650);
    expect(ice.some((o) => o.d < -140 && o.s > 480 && o.s < 610 && iceMass(o) > 40)).toBe(true);
    // Line fields lie on steep ground, where the iceberg wins its speed back.
    const slope = (s: number): number =>
      (terrain.course.sampleAt(s - 10).floor - terrain.course.sampleAt(s + 10).floor) / 20;
    for (const o of line) expect(slope(o.s), `slope at the field at s=${o.s}`).toBeGreaterThan(0.09);
  });

  it('builds a village that makes sense: cars on roads, buildings by them, fences along them', () => {
    for (const o of L.obstacles.filter((x) => ['car', 'truck', 'bus'].includes(x.kind))) {
      expect(onRoad(o), `${o.kind} at s=${o.s} d=${o.d}`).toBe(true);
    }
    const buildings = L.obstacles.filter((o) => ['chalet', 'barn', 'silo'].includes(o.kind));
    for (const b of buildings) {
      const gap = Math.min(...roads.filter((r) => b.s >= r.s0 && b.s <= r.s1)
        .map((r) => Math.abs(b.d - r.d) - r.width / 2 - placementFootprint(b)));
      expect(gap, `${b.kind} at s=${b.s}`).toBeLessThan(6);
    }
    for (const f of ofKind('fence')) {
      expect(Math.abs(Math.abs(f.yaw ?? 0) - Math.PI / 2)).toBeLessThan(1e-9);
      expect(onRoad(f, 5)).toBe(true);
    }
    // The line ploughs head-on through three buildings on the main street.
    const onLine = buildings.filter((o) => Math.abs(lineOffsetAt(L.line, o.s) - o.d) <= 1);
    expect(onLine.length).toBeGreaterThanOrEqual(3);
  });

  it('dams the gorge wall to wall above the final waterfall, for big icebergs only', () => {
    const hw = terrain.course.sampleAt(dam.s).halfWidth;
    expect(hw).toBeLessThan(20);
    expect(dam.d).toBe(0);
    expect(dam.span!).toBeGreaterThanOrEqual(2 * hw + 2);
    const finalFall = L.cliffs[L.cliffs.length - 1];
    expect(dam.s).toBeLessThan(finalFall.s);
    const brk = Math.min(...specs.filter((s) => s.kind === 'dam').map((s) => s.breakImpulse));
    const test = (v: number, m: number): number => 1.25 * v * m;
    expect(test(DEFAULT_ICEBERG_PARAMS.maxSpeed, START_MASS)).toBeLessThan(brk);
    // Skip-the-ice runs reach it with ≤ 20 t at ≤ 25 m/s; 40 t would need 30 m/s.
    expect(test(25, 40)).toBeLessThan(brk);
    // The reservoir slows everyone to 16–20 m/s: ~60 % of a route's ice (78 t at 16 m/s) still
    // breaks it, and a full iceberg from 11 m/s.
    expect(test(16, 78)).toBeGreaterThanOrEqual(brk);
    expect(test(11.2, 6 * START_MASS)).toBeGreaterThanOrEqual(brk);
  });

  it('carries the meltwater river over three waterfalls, dammed in the gorge, into the sea', () => {
    expect(river.end ?? 'sea').toBe('sea');
    const last = river.points[river.points.length - 1];
    expect(last.s).toBeGreaterThan(L.coastS);
    // It runs through the dam's span and over icefall band 2, the rock band and the final falls.
    const at = (s: number): number => lineOffsetAt(river.points, s);
    expect(Math.abs(at(dam.s) - dam.d)).toBeLessThan(dam.span! / 2 - river.width / 2);
    const crosses = (c: (typeof L.cliffs)[number]): boolean =>
      c.width === undefined || Math.abs(at(c.s) - (c.d ?? 0)) < c.width / 2 - river.width / 2;
    const stepped = L.cliffs.filter((c) => c.s > river.points[0].s && c.s < last.s && crosses(c));
    expect(stepped.length).toBeGreaterThanOrEqual(3);
    // Its banks hold the starting iceberg (a trap for a small one) but not one grown past ~50 t.
    expect(river.bank).toBeGreaterThanOrEqual(0.75 * 1.27 * radiusAt(START_MASS));
    expect(river.bank).toBeLessThan(0.75 * 1.27 * radiusAt(50));
    // It keeps clear of the line until the gorge, so the avalanche never rides in its current.
    for (let s = river.points[0].s; s < 1150; s += 5) {
      expect(Math.abs(at(s) - lineOffsetAt(L.line, s)), ).toBeGreaterThan(river.width / 2 + 4);
    }
  });

  it('has a generous water budget (absorbed ice adds more)', () => {
    expect(L.water!.metres).toBeGreaterThan(1.4 * (L.coastS - L.startS));
    expect(L.water!.turnMetresPerRadian).toBeGreaterThan(0);
  });
});

describe('glacier avalanche runs (real water budget and chipping)', () => {
  interface Outcome {
    phase: string;
    reason: string | null;
    stats: RunStats;
    damBroken: boolean;
    endS: number;
    endD: number;
  }

  const altTerrain = (t: Terrain, line: CourseCoord[]): Terrain =>
    ({ ...t, level: { ...t.level, line } }) as Terrain;

  const drive = async (
    steer: (s: GameSession) => SteeringInput,
    opts: { setup?: (s: GameSession) => void; seconds?: number } = {},
  ): Promise<Outcome> => {
    const s = await GameSession.create({ level: L, skipIntro: true });
    opts.setup?.(s);
    const steps = (opts.seconds ?? 220) * 60;
    for (let n = 0; s.phase === 'playing' && n < steps; n++) s.update(FIXED_DT, steer(s));
    const p = s.terrain.course.project(s.iceberg.pos.x, s.iceberg.pos.z);
    const out: Outcome = {
      phase: s.phase,
      reason: s.failReason,
      stats: { ...s.stats },
      damBroken: s.events.log.some((e) => e.type === 'obstacleBroken' && e.kind === 'dam'),
      endS: p.s,
      endD: p.d,
    };
    s.dispose();
    return out;
  };
  const along = (line?: CourseCoord[]) => (s: GameSession): SteeringInput =>
    autopilotSteer(s.iceberg, line ? altTerrain(s.terrain, line) : s.terrain);
  const straight = (lane: number) => (s: GameSession): SteeringInput =>
    autopilotSteer(s.iceberg, s.terrain, { pursuit: 'course', followLine: false, lane });
  const none = (): SteeringInput => ({ steer: 0, source: 'none' });
  /** Teleport to (s, d) moving toward (aimS, aimD) at `speed`, grounded. */
  const place = (s0: number, d0: number, speed: number, aimS = s0 + 10, aimD = d0) => (s: GameSession) => {
    const t = s.terrain;
    const ice = s.iceberg;
    const w = t.course.toWorld(s0, d0);
    const a = t.course.toWorld(aimS, aimD);
    const l = Math.hypot(a.x - w.x, a.z - w.z);
    const dx = (a.x - w.x) / l;
    const dz = (a.z - w.z) / l;
    Object.assign(ice.pos, { x: w.x, y: w.y, z: w.z });
    ice.vel.x = dx * speed;
    ice.vel.z = dz * speed;
    const g = t.gradientAt(w.x, w.z);
    ice.vel.y = g.dx * ice.vel.x + g.dz * ice.vel.z;
    ice.heading = dirToHeading(dx, dz);
    ice.grounded = true;
  };
  const where = (r: Outcome): string =>
    `${r.phase} ${r.reason ?? ''} at s=${r.endS.toFixed(0)} d=${r.endD.toFixed(0)}, ` +
    `${r.stats.time.toFixed(1)} s`;

  it('the line: left couloir, icefall drop, the village head-on, the dam and its flood', async () => {
    let flood: Reservoir | undefined;
    const r = await drive(along(), { setup: (s) => { flood = reservoirs(s)[0]; } });
    expect(flood?.fullVolume).toBeGreaterThan(3000);
    expect(flood?.broken).toBe(true);
    expect(flood?.qPeak).toBeGreaterThan(200);
    expect(r.phase, where(r)).toBe('complete');
    expect(r.stats.absorbed).toBeGreaterThan(80);
    expect(r.stats.peakMass).toBeGreaterThanOrEqual(3 * START_MASS);
    expect(r.stats.waterfallsCrossed).toBeGreaterThanOrEqual(3);
    expect(r.stats.buildingsDestroyed).toBeGreaterThanOrEqual(3);
    expect(r.damBroken).toBe(true);
  }, 120_000);

  it('another way (centre couloir, 20 m crevasse jump, right forest) also gets through', async () => {
    const r = await drive(along(CENTRE));
    expect(r.phase, where(r)).toBe('complete');
    expect(r.stats.absorbed).toBeGreaterThan(70);
    expect(r.stats.waterfallsCrossed).toBeGreaterThanOrEqual(3);
    expect(r.damBroken).toBe(true);
  }, 120_000);

  it.each([
    ['centre', SKIP],
    ['left', SKIP_LEFT],
  ])('skipping the ice down the %s, the iceberg arrives small and bounces off the dam', async (_, line) => {
    const r = await drive(along(line));
    expect(r.phase, where(r)).toBe('failed');
    expect(r.reason).toBe('stuck');
    expect(r.damBroken).toBe(false);
    expect(r.stats.absorbed).toBeLessThan(10);
    expect(r.endS).toBeGreaterThan(dam.s - 30);
    expect(r.endS).toBeLessThan(dam.s);
  }, 120_000);

  it.each([-17, 17])('the dam seals the gorge: hugging the wall (d %i) it never gets past', async (dd) => {
    // Afloat on the reservoir, steering keeps it moving (never stuck): it just cannot get by.
    const r = await drive(straight(dd), { setup: place(1180, dd, 18), seconds: 40 });
    expect(r.phase, where(r)).not.toBe('complete');
    expect(r.damBroken).toBe(false);
    expect(r.endS).toBeLessThan(dam.s);
  }, 120_000);

  it('too slow over the centre of the crevasse (14 m/s) it falls in; at 18 m/s it clears', async () => {
    const slow = await drive(straight(0), { setup: place(415, 0, 14), seconds: 20 });
    expect(slow.reason, where(slow)).toBe('fell');
    expect(slow.endS).toBeGreaterThan(440);
    expect(slow.endS).toBeLessThan(465);
    const fast = await drive(straight(0), { setup: place(415, 0, 18), seconds: 6 });
    expect(fast.reason, where(fast)).not.toBe('fell');
    expect(fast.endS).toBeGreaterThan(470);
  }, 120_000);

  it('a small iceberg in the river is carried past every field and pinned at the dam', async () => {
    const r = await drive(none, { setup: place(620, -95, 8), seconds: 220 });
    expect(r.reason, where(r)).toBe('stuck');
    expect(r.stats.absorbed).toBeLessThan(1);
    expect(r.endS).toBeGreaterThan(dam.s - 15);
    expect(r.endS).toBeLessThan(dam.s);
    expect(r.stats.waterfallsCrossed).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it('the pocket below the icefall is a dead end: the iceberg ends up stuck in it', async () => {
    const r = await drive(none, { setup: place(470, -150, 10), seconds: 90 });
    expect(r.reason, where(r)).toBe('stuck');
    expect(r.endS).toBeGreaterThan(560);
    expect(r.endS).toBeLessThan(625);
    expect(r.endD).toBeLessThan(-125);
  }, 120_000);

  it('the closed gully on the lower left is a dead end too', async () => {
    const r = await drive(none, { setup: place(686, -113, 10, 700, -121), seconds: 90 });
    expect(r.reason, where(r)).toBe('stuck');
    expect(r.endS).toBeGreaterThan(720);
    expect(r.endS).toBeLessThan(750);
  }, 120_000);

  it('the right couloir ends in the wide crevasse, even at full speed', async () => {
    const r = await drive(along(RIGHT), { seconds: 60 });
    expect(r.reason, where(r)).toBe('fell');
    expect(r.endS).toBeGreaterThan(440);
    expect(r.endS).toBeLessThan(495);
    expect(r.endD).toBeGreaterThan(55);
  }, 120_000);

  it('swallowing the trap field at the ridge foot leaves the iceberg too slow to crest it', async () => {
    const r = await drive(along(GRAB), { seconds: 120 });
    expect(r.reason, where(r)).toBe('stuck');
    expect(r.stats.absorbed).toBeGreaterThan(60);
    expect(r.endS).toBeGreaterThan(600);
    expect(r.endS).toBeLessThan(660);
  }, 120_000);
});

