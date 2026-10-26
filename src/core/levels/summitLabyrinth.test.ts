import { describe, expect, it } from 'vitest';
import { FELL_BEAT, FIXED_DT, GameSession, getTerrain } from '../session';
import { autopilotSteer } from '../autopilot';
import { dirToHeading } from '../math';
import { buildObstacleSpecs } from '../obstacles/spawn';
import { isStructureKind, missingStructureKinds } from '../obstacles/structures';
import { DEFAULT_ICEBERG_PARAMS } from '../sim/params';
import { analyzeRoutes } from '../terrain/routes';
import { createTerrain, type GeneratedTerrain } from '../terrain/terrain';
import { validateLevel } from '../terrain/validate';
import { WaterSystem } from '../water/system';
import type {
  GameEvent,
  LevelDef,
  ObstaclePlacement,
  SteeringInput,
  Terrain,
  TerrainFeature,
} from '../types';
import { timed } from '../testing/timing';
import { summitLabyrinth as L } from './summitLabyrinth';

/**
 * Level 9, Summit Labyrinth (./summitLabyrinth.ts): an open-mountain finale. Layout and route
 * checks, then playthroughs with the real water budget and chipping: the intended line (grow,
 * burst the dam and flood its reservoir, five waterfalls), the right-hand route (snow bridge, no
 * dam), the meltwater stream holding a small iceberg, and the designed failures (no ice, a slow
 * kicker, greedy absorbing, the obvious centre).
 */

type Feature<T extends TerrainFeature['type']> = Extract<TerrainFeature, { type: T }>;
const features = L.features ?? [];
const START_MASS = L.iceberg!.mass;
const isIce = (o: ObstaclePlacement): boolean => o.kind === 'iceField' || o.kind === 'iceBlock';
const ofKind = (kind: ObstaclePlacement['kind']): ObstaclePlacement[] =>
  L.obstacles.filter((o) => o.kind === kind);
const dam = ofKind('dam')[0];
const kicker = features.find((f): f is Feature<'ramp'> => f.type === 'ramp')!;
const stream = features.find((f): f is Feature<'stream'> => f.type === 'stream')!;
const terrain = (): Terrain => getTerrain(L);

/** The right-hand route: slalom, kicker over C2, right plateau, snow bridge over C3, no dam. */
const RIGHT_LINE: LevelDef['line'] = [
  [30, 0], [115, 62], [150, 88], [205, 95], [300, 95], [345, 92], [395, 104], [412, 110],
  [434.5, 110], [470, 110], [560, 120], [640, 125], [700, 115], [760, 112], [800, 119], [840, 119],
  [870, 116], [920, 95], [990, 75], [1060, 72], [1080, 68], [1190, 62], [1250, 62], [1400, 40],
  [1500, 40], [1740, 0], [1830, 0], [2000, 0],
].map(([s, d]) => ({ s, d }));

/** The intended line, but straight through the trap field at the foot of the moraine mound. */
const GREEDY_LINE: LevelDef['line'] = [
  [30, 0], [120, -45], [200, -95], [255, -100], [320, -112], [390, -120], [440, -123], [480, -123],
  [520, -110], [585, -85], [636, -62], [667, -75], [712, -104], [750, -90], [900, -90], [1250, -60],
  [1830, -20], [2000, 0],
].map(([s, d]) => ({ s, d }));

interface Run {
  phase: string;
  reason: string | null;
  endS: number;
  endD: number;
  stats: GameSession['stats'];
  events: GameEvent[];
  damBroken: boolean;
  /** The reservoir behind the dam drained (the dam breach released its flood). */
  flooded: boolean;
  ice: number;
}

/** The cached terrain with another line (the autopilot reads it) and/or other obstacles. */
function variant(over: Partial<LevelDef>): Terrain {
  const t = terrain();
  return { ...t, level: { ...t.level, ...over } } as Terrain;
}

/** Teleport to (s, d) moving down-course at `speed`, grounded. */
function place(session: GameSession, s: number, d: number, speed: number): void {
  const t = session.terrain;
  const ice = session.iceberg;
  const w = t.course.toWorld(s, d);
  const c = t.course.sampleAt(s);
  ice.pos.x = w.x;
  ice.pos.y = w.y;
  ice.pos.z = w.z;
  ice.vel.x = c.dirX * speed;
  ice.vel.z = c.dirZ * speed;
  const g = t.gradientAt(w.x, w.z);
  ice.vel.y = g.dx * ice.vel.x + g.dz * ice.vel.z;
  ice.heading = dirToHeading(c.dirX, c.dirZ);
  ice.grounded = true;
  ice.stuckTimer = 0;
}

async function drive(
  steer: (s: GameSession) => SteeringInput,
  opts: { terrain?: Terrain; seconds?: number; setup?: (s: GameSession) => void } = {},
): Promise<Run> {
  const t = opts.terrain ?? terrain();
  const session = await GameSession.create({ level: t.level, terrain: t, skipIntro: true });
  const events: GameEvent[] = [];
  session.events.on((e) => events.push(e));
  opts.setup?.(session);
  for (let n = 0; n < (opts.seconds ?? 220) * 60 && session.phase === 'playing'; n++) {
    session.update(FIXED_DT, steer(session));
  }
  const p = session.terrain.course.project(session.iceberg.pos.x, session.iceberg.pos.z);
  const run: Run = {
    phase: session.phase,
    reason: session.failReason,
    endS: p.s,
    endD: p.d,
    stats: { ...session.stats },
    events,
    damBroken: events.some((e) => e.type === 'obstacleBroken' && e.kind === 'dam'),
    flooded: session.water?.reservoirs.some((r) => r.broken) ?? false,
    ice: session.iceberg.ice,
  };
  session.dispose();
  return run;
}

const auto = (s: GameSession): SteeringInput => autopilotSteer(s.iceberg, s.terrain);
/** Holds lateral offset `d` from the centreline (course pursuit, ignoring the line). */
const holdD = (d: number) => (s: GameSession): SteeringInput =>
  autopilotSteer(s.iceberg, s.terrain, { pursuit: 'course', followLine: false, lane: d });

const describeRun = (r: Run): string =>
  `${r.phase}${r.reason ? ` (${r.reason})` : ''} at s=${r.endS.toFixed(0)} d=${r.endD.toFixed(0)}, ` +
  `${r.stats.time.toFixed(1)} s, absorbed ${r.stats.absorbed.toFixed(1)} t, peak ` +
  `${r.stats.peakMass.toFixed(1)} t, ice ${r.stats.iceLeft.toFixed(2)}, ` +
  `${r.stats.waterfallsCrossed} falls, ` +
  `${r.stats.buildingsDestroyed} buildings, dam ${r.damBroken ? 'burst' : 'intact'}`;

describe('summit labyrinth layout', () => {
  // ~5 s alone (terrain build + route search); a full parallel run on a busy machine took 38–48 s.
  it('passes every level-design check, including a way to the sea', () => {
    expect(validateLevel(terrain())).toEqual([]);
  }, 120_000);

  it('builds its terrain in under 2 s CPU on a grid of at most 250k vertices', () => {
    // Best of two fresh builds (the cached one does not count), so a busy runner is not flaky.
    let best = Infinity;
    let vertices = 0;
    for (let i = 0; i < 2; i++) {
      const { result, ms } = timed(() => createTerrain(L));
      best = Math.min(best, ms);
      vertices = result.grid.cols * result.grid.rows;
    }
    console.log(`[summit] terrain ${best.toFixed(0)} ms, ${vertices} vertices`);
    expect(best).toBeLessThan(2000);
    expect(vertices).toBeLessThanOrEqual(250_000);
  });

  it('spawns at most 250 bodies, every placement included, all from defined kinds', () => {
    const specs = buildObstacleSpecs(terrain(), L.seed);
    expect(specs.length).toBeLessThanOrEqual(250);
    L.obstacles.forEach((o, i) => {
      expect(specs.some((s) => s.placement === i), `${o.kind} at s=${o.s}`).toBe(true);
    });
    const used = new Set(L.obstacles.map((o) => o.kind).filter(isStructureKind));
    expect(missingStructureKinds().filter((k) => used.has(k))).toEqual([]);
  });

  it('is a ~1.8 km open-mountain finale on a wide snowy summit that starts small', () => {
    const t = terrain();
    expect(L.theme).toBe('alpine');
    expect(L.relief).toBeDefined();
    expect(L.iceberg).toEqual({ scale: 0.9, mass: 22 });
    const run = L.coastS - L.startS;
    expect(run).toBeGreaterThanOrEqual(1600);
    expect(run).toBeLessThanOrEqual(2000);
    expect(2 * t.course.sampleAt(500).halfWidth).toBeGreaterThanOrEqual(400);
    expect(t.course.length).toBeGreaterThanOrEqual(L.finishS + 100);
    const fin = t.course.toWorld(L.finishS, 0);
    expect(t.isOcean(fin.x, fin.z)).toBe(true);
    // Four cliff bands on the descent and the full-width fjord falls, all before the coast.
    expect(L.cliffs.filter((c) => c.width !== undefined).length).toBeGreaterThanOrEqual(4);
    expect(L.cliffs.every((c) => c.s < L.coastS)).toBe(true);
  });

  it('route search: a way to the sea and the designed dead ends', () => {
    const r = analyzeRoutes(terrain());
    console.log(
      `[summit] routes ${r.ms.toFixed(0)} ms, ${r.jumps} jumps, dead ends ` +
        JSON.stringify(r.deadEnds.map((d) => [Math.round(d.s), Math.round(d.d), d.area, d.cause])),
    );
    expect(r.solvable).toBe(true);
    const found = (cause: 'ravine' | 'trap', s0: number, s1: number, d0: number, d1: number): boolean =>
      r.deadEnds.some((d) => d.cause === cause && d.s > s0 && d.s < s1 && d.d > d0 && d.d < d1);
    // The obvious centre: the icefall ends at the bergschrund.
    expect(found('ravine', 360, 470, -40, 40)).toBe(true);
    // The slot on the left shelf, the slot on the right plateau and the funnel pocket.
    expect(found('trap', 240, 420, -200, -160)).toBe(true);
    expect(found('trap', 650, 780, 160, 200)).toBe(true);
    expect(found('trap', 680, 790, 30, 95)).toBe(true);
  });

  it('vehicles stand on roads; the dam closes the walled meltwater channel', () => {
    const roads = features.filter((f): f is Feature<'road'> => f.type === 'road');
    const vehicles = L.obstacles.filter((o) => ['car', 'bus', 'truck'].includes(o.kind));
    expect(vehicles.length).toBeGreaterThan(0);
    for (const v of vehicles) {
      const on = roads.some((r) => v.s >= r.s0 && v.s <= r.s1 && Math.abs(v.d - r.d) <= r.width / 2);
      expect(on, `${v.kind} at s=${v.s} d=${v.d}`).toBe(true);
    }
    // The channel: two parallel wall ridges either side of the dam, running past it to the lip.
    const walls = features.filter(
      (f): f is Feature<'ridge'> =>
        f.type === 'ridge' &&
        f.points.length === 2 &&
        f.points[0].d === f.points[1].d &&
        f.points[0].s < dam.s &&
        f.points[1].s > dam.s &&
        Math.abs(f.points[0].d - dam.d) < 25,
    );
    expect(walls.length).toBe(2);
    const inner = walls.map((w) => Math.abs(w.points[0].d - dam.d) - w.width / 2);
    for (const gap of inner) expect(gap - (dam.span ?? 0) / 2).toBeLessThan(3.5);
  });

  it('makes the dam a gate that only a grown iceberg passes (1.25 · v · M ≥ break impulse)', () => {
    const block = buildObstacleSpecs(terrain(), L.seed).filter((s) => s.kind === 'dam');
    const brk = Math.min(...block.map((b) => b.breakImpulse));
    const test = (v: number, m: number): number => 1.25 * v * m;
    // The starting iceberg bounces even at the speed cap, and so does the plateau-only line
    // (≈ 66 t at 18.4 m/s measured); the line flies off the rock step into it with ≈ 107 t at 20 m/s.
    expect(block.length).toBe(3);
    expect(test(DEFAULT_ICEBERG_PARAMS.maxSpeed, START_MASS)).toBeLessThan(brk);
    expect(test(18.4, 66)).toBeLessThan(brk);
    expect(test(20, 107)).toBeGreaterThan(1.25 * brk);
  });

  it('the dam holds a reservoir in the pool between the rock step and the dam', () => {
    const t = terrain() as GeneratedTerrain;
    const water = new WaterSystem(t);
    expect(water.reservoirs.length).toBe(1);
    const r = water.reservoirs[0];
    const step = L.cliffs.find((c) => c.s < dam.s && c.s > dam.s - 40)!;
    let s0 = Infinity;
    let s1 = -Infinity;
    for (let j = 0; j < r.rows; j++) {
      for (let i = 0; i < r.cols; i++) {
        if (!r.mask[j * r.cols + i]) continue;
        const p = t.course.project(
          t.grid.originX + (r.ix0 + i) * t.grid.cellSize,
          t.grid.originZ + (r.iz0 + j) * t.grid.cellSize,
        );
        s0 = Math.min(s0, p.s);
        s1 = Math.max(s1, p.s);
      }
    }
    console.log(
      `[summit] reservoir level ${r.fullLevel.toFixed(1)} m (bed ${r.floorY.toFixed(1)}, crest ` +
        `${r.crestY.toFixed(1)}), ${r.vertexCount} vertices, ${r.fullVolume.toFixed(0)} m³, s ` +
        `${s0.toFixed(0)}..${s1.toFixed(0)}`,
    );
    expect(r.fullLevel - r.floorY).toBeGreaterThan(8);
    expect(r.vertexCount).toBeGreaterThan(50);
    // The lake stops at the foot of the step, so the iceberg flies off the step into the dam.
    expect(s0).toBeGreaterThanOrEqual(step.s - 2);
    expect(s1).toBeLessThan(dam.s);
    // The stream runs on from the dam to the sea.
    expect(stream.points[stream.points.length - 1].s).toBeGreaterThan(L.coastS);
  });

  it('lays the glacier ice out so that growth is a choice: line fields, a trap field, side ice', () => {
    const specs = buildObstacleSpecs(terrain(), L.seed);
    const mass = (o: ObstaclePlacement): number =>
      specs.filter((s) => s.placement === L.obstacles.indexOf(o)).reduce((a, s) => a + s.mass, 0);
    const ice = L.obstacles.filter(isIce);
    const left = ice.filter((o) => o.d < -60);
    const trap = ice.reduce((a, o) => (mass(o) > mass(a) ? o : a));
    const mound = features.find((f): f is Feature<'ridge'> => f.type === 'ridge' && f.profile === 'mound')!;
    expect(left.reduce((a, o) => a + mass(o), 0) - mass(trap)).toBeGreaterThan(100);
    expect(mass(trap)).toBeGreaterThan(60);
    // The trap field lies at the foot of the moraine mound, on its upslope.
    expect(trap.s).toBeLessThan(mound.points[0].s);
    expect(trap.s + (trap.spread ?? 0)).toBeGreaterThan(mound.points[0].s - mound.width / 2);
    // Ice on the right-hand route too (water for the way without the dam).
    expect(ice.filter((o) => o.d > 60).reduce((a, o) => a + mass(o), 0)).toBeGreaterThan(30);
  });
});

describe('summit labyrinth playthroughs (real water budget and chipping)', () => {
  it('the line grows past 4x, bursts the dam, flies five waterfalls and smashes the village', async () => {
    const r = await drive(auto);
    console.log(`[summit] line: ${describeRun(r)}`);
    expect(r.phase, describeRun(r)).toBe('complete');
    expect(r.stats.absorbed).toBeGreaterThan(80);
    expect(r.stats.peakMass).toBeGreaterThanOrEqual(4 * START_MASS);
    expect(r.damBroken).toBe(true);
    expect(r.flooded).toBe(true);
    expect(r.stats.waterfallsCrossed).toBeGreaterThanOrEqual(4);
    expect(r.stats.buildingsDestroyed).toBeGreaterThanOrEqual(2);
    expect(r.stats.time).toBeLessThan(160);
  }, 180_000);

  it('the right-hand route completes over the kicker and the snow bridge, without the dam', async () => {
    const r = await drive(auto, { terrain: variant({ line: RIGHT_LINE }) });
    console.log(`[summit] right route: ${describeRun(r)}`);
    expect(r.phase, describeRun(r)).toBe('complete');
    expect(r.damBroken).toBe(false);
    expect(r.stats.absorbed).toBeGreaterThan(20);
    expect(r.stats.waterfallsCrossed).toBeGreaterThanOrEqual(3);
  }, 180_000);

  it('without glacier ice the line bounces off the dam, and the right route runs dry', async () => {
    const noIce = L.obstacles.filter((o) => !isIce(o));
    const line = await drive(auto, { terrain: variant({ obstacles: noIce }) });
    console.log(`[summit] no ice, line: ${describeRun(line)}`);
    expect(line.phase).toBe('failed');
    expect(line.reason).toBe('stuck');
    expect(line.damBroken).toBe(false);
    expect(line.endS).toBeGreaterThan(dam.s - 40);
    expect(line.endS).toBeLessThan(dam.s);
    const right = await drive(auto, { terrain: variant({ obstacles: noIce, line: RIGHT_LINE }) });
    console.log(`[summit] no ice, right route: ${describeRun(right)}`);
    expect(right.phase).toBe('failed');
    expect(right.ice).toBeLessThan(0.1);
  }, 240_000);

  it('a light iceberg cannot squeeze past the dam, at either end or in the middle', async () => {
    const noIce = L.obstacles.filter((o) => !isIce(o));
    // The gaps between the dam's ends and the channel walls, and the middle.
    const half = (dam.span ?? 0) / 2;
    for (const d of [dam.d - half - 1, dam.d, dam.d + half + 1]) {
      const r = await drive(holdD(d), {
        terrain: variant({ obstacles: noIce }),
        // Afloat in the reservoir it is stuck only after ~30–60 s pinned against the dam.
        seconds: 90,
        setup: (s) => place(s, dam.s - 52, d, 18),
      });
      console.log(`[summit] squeeze at d=${d}: ${describeRun(r)}`);
      expect(r.phase).toBe('failed');
      expect(r.endS).toBeLessThan(dam.s);
      expect(r.damBroken).toBe(false);
    }
  }, 300_000);

  it('the meltwater stream holds a small iceberg: carried slowly, it cannot steer out', async () => {
    // In the village stretch (straight along d ≈ −150): left alone, and steering hard out.
    const at = 1350;
    const d = -150;
    const free = await drive(() => ({ steer: 0, source: 'none' }), {
      seconds: 25,
      setup: (s) => place(s, at, d, 5),
    });
    console.log(`[summit] small iceberg in the stream, no input: ${describeRun(free)}`);
    expect(free.phase).toBe('playing');
    expect(Math.abs(free.endD - d)).toBeLessThan(stream.width / 2);
    expect(free.endS).toBeGreaterThan(at + 30);
    expect((free.endS - at) / free.stats.time).toBeLessThan(5);
    const out = await drive(holdD(d + 50), { seconds: 25, setup: (s) => place(s, at, d, 5) });
    console.log(`[summit] small iceberg in the stream, steering out: ${describeRun(out)}`);
    expect(Math.abs(out.endD - d)).toBeLessThan(stream.width / 2);
  }, 120_000);

  it('too slow off the kicker: it falls into the crevasse and the run ends at once', async () => {
    let airborneAt = -1;
    const r = await drive(holdD(kicker.d), {
      seconds: 20,
      setup: (s) => {
        place(s, kicker.s - 30, kicker.d, 7);
        s.events.on((e) => {
          if (e.type === 'airborne' && airborneAt < 0) airborneAt = s.stats.time;
        });
      },
    });
    console.log(`[summit] slow kicker: ${describeRun(r)}, airborne at ${airborneAt.toFixed(2)} s`);
    expect(r.phase).toBe('failed');
    expect(r.reason).toBe('fell');
    expect(airborneAt).toBeGreaterThan(0);
    expect(r.stats.time - airborneAt).toBeLessThan(2.5 + FELL_BEAT);
    expect(r.endS).toBeGreaterThan(kicker.s);
    expect(r.endS).toBeLessThan(kicker.s + 30);
  }, 120_000);

  it('greedy absorbing at the foot of the moraine leaves the iceberg too slow to crest it', async () => {
    const r = await drive(auto, { terrain: variant({ line: GREEDY_LINE }) });
    console.log(`[summit] greedy: ${describeRun(r)}`);
    expect(r.phase).toBe('failed');
    expect(r.reason).toBe('stuck');
    expect(r.stats.peakMass).toBeGreaterThan(120);
    expect(r.endS).toBeGreaterThan(610);
    expect(r.endS).toBeLessThan(690);
  }, 180_000);

  it('the obvious way down the middle fails: centreline and no input end in the icefall', async () => {
    const centre = await drive((s) => autopilotSteer(s.iceberg, s.terrain, { followLine: false }));
    console.log(`[summit] centreline: ${describeRun(centre)}`);
    const none = await drive(() => ({ steer: 0, source: 'none' }));
    console.log(`[summit] no input: ${describeRun(none)}`);
    for (const r of [centre, none]) {
      expect(r.phase).toBe('failed');
      expect(r.endS).toBeLessThan(480);
    }
    expect(none.reason).toBe('fell');
  }, 180_000);
});
