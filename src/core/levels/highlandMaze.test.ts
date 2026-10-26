import { beforeAll, describe, expect, it } from 'vitest';
import { FIXED_DT, GameSession, getTerrain } from '../session';
import { autopilotSteer } from '../autopilot';
import { dirToHeading } from '../math';
import { createTerrain } from '../terrain/terrain';
import { featureContains } from '../terrain/features';
import { analyzeRoutes } from '../terrain/routes';
import { trapWallDepth, validateLevel, validateVehiclePlacements } from '../terrain/validate';
import { buildObstacleSpecs } from '../obstacles/spawn';
import type { PhysicsWorld } from '../physics/world';
import { trafficNetwork } from '../traffic/network';
import type { CourseCoord, GameEvent, ObstacleKind, RunStats, Terrain, TerrainFeature } from '../types';
import { timed } from '../testing/timing';
import { highlandMaze as level } from './highlandMaze';
import { rockyCanyon } from './rockyCanyon';

/**
 * Level 8, the Highland Maze (see the design note in ./highlandMaze.ts): an open mountainside with
 * three ways to the sea (the Leap, the middle slalom, the Clachan), dead-end glens, and fatal
 * ravines. Runs use the level's real water budget and chipping.
 */

type Feature<T extends TerrainFeature['type']> = Extract<TerrainFeature, { type: T }>;
const features = level.features ?? [];
const of = <T extends TerrainFeature['type']>(type: T, i: number): Feature<T> => {
  const f = features[i];
  if (f.type !== type) throw new Error(`feature ${i} is ${f.type}, not ${type}`);
  return f as Feature<T>;
};
/** The Leap's ravine (under band 0), the Devil's Cut, the Gorge (R3a, R3b, R3c). */
const leap = of('ravine', 5);
const devilsCut = of('ravine', 6);
const gorge = [of('ravine', 23), of('ravine', 24), of('ravine', 28)];
const band0 = level.cliffs[0];
const leapFar = Math.max(...leap.points.map((p) => p.s)) + leap.width / 2;
const terrain = (): Terrain => getTerrain(level);
const hw = (s: number): number => terrain().course.sampleAt(s).halfWidth;

/** Flat s, d pairs → a line. */
const path = (sd: number[]): CourseCoord[] =>
  Array.from({ length: sd.length / 2 }, (_, i) => ({ s: sd[2 * i], d: sd[2 * i + 1] }));

/** The middle route: right glen, hairpin round the crags' apex, the slalom, round the Gorge. */
const MIDDLE = path([
  30, 0, 62, 9, 106, 41, 142, 47, 178, 67, 218, 84, 246, 90, 270, 104, 302, 109, 338, 119, 408, 127, 452,
  114, 540, 115, 568, 102, 584, 83, 628, 25, 652, 10, 682, 19, 712, 23, 744, 41, 766, 42, 788, 33, 832, -9,
  848, -15, 864, -10, 880, 6, 904, 16, 950, 18, 988, 25, 1030, 7, 1070, -28, 1110, -60, 1182, -68, 1216, -80,
  1250, -84, 1296, -100, 1392, -100, 1444, -77, 1480, -72, 1514, -58, 1548, -54, 1582, -40, 1620, -28, 1660,
  -20, 1724, -25, 1800, -20,
]);
/** The Clachan: right glen, through Achadh farm and Balnacoil, the mill falls, the rock bridge. */
const CLACHAN = path([
  30, 0, 62, 9, 106, 41, 142, 47, 178, 67, 218, 84, 246, 90, 270, 104, 302, 109, 338, 119, 372, 121, 405,
  126, 452, 114, 540, 116, 570, 110, 605, 105, 640, 108, 668, 116, 692, 122, 720, 116, 760, 110, 800, 110,
  856, 116, 890, 119, 918, 112, 956, 110, 1000, 108, 1040, 108, 1074, 112, 1114, 101, 1170, 97, 1228, 67,
  1254, 60, 1284, 64, 1366, 64, 1408, 56, 1442, 63, 1480, 72, 1512, 56, 1534, 47, 1600, 47, 1640, 29, 1682,
  25, 1718, 15, 1800, 0,
]);

/**
 * The glen road (playtest 2): the Clachan's way down the right glen and through the hamlet, then
 * on down the glen road over the Gorge on the road bridge, past the lochans to the loch falls and
 * through the lochside village to the sea.
 */
const GLEN_ROAD = path([
  ...CLACHAN.filter((p) => p.s <= 1114).flatMap((p) => [p.s, p.d]),
  1170, 96, 1200, 95, 1260, 95, 1300, 95, 1400, 94, 1500, 92, 1575, 90, 1620, 80, 1690, 80, 1720, 60, 1800, 40,
]);

type Steer = 'line' | 'none' | 'centre' | CourseCoord[];

interface Run {
  phase: string;
  reason: string | null;
  stats: RunStats;
  endS: number;
  endD: number;
  broken: { kind: ObstacleKind; s: number }[];
  /** Take-offs: where (s), how fast, and where the iceberg came down (s). */
  air: { s: number; d: number; speed: number; landS: number }[];
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
  steer: Steer,
  opts: { seconds?: number; at?: { s: number; d: number; speed: number } } = {},
): Promise<Run> {
  const session = await GameSession.create({ level, skipIntro: true });
  const t = session.terrain;
  const at = (p: { x: number; z: number }): { s: number; d: number } => t.course.project(p.x, p.z);
  const broken: Run['broken'] = [];
  const air: Run['air'] = [];
  let up: { s: number; d: number; speed: number } | null = null;
  session.events.on((e: GameEvent) => {
    if (e.type === 'obstacleBroken') broken.push({ kind: e.kind, s: at(e.pos).s });
    if (e.type === 'airborne') up = { ...at(e.pos), speed: e.speed };
    if (e.type === 'landed' && up) {
      air.push({ ...up, landS: at(e.pos).s });
      up = null;
    }
  });
  if (opts.at) place(session, opts.at.s, opts.at.d, opts.at.speed);
  // An alternative line rides on a copy of the terrain whose level carries it (the autopilot reads
  // terrain.level.line).
  const alt = Array.isArray(steer) ? { ...t, level: { ...t.level, line: steer } } : t;
  for (let n = 0; n < (opts.seconds ?? 200) * 60 && session.phase === 'playing'; n++) {
    let st = 0;
    if (steer === 'centre') st = autopilotSteer(session.iceberg, t, { followLine: false }).steer;
    else if (steer !== 'none') st = autopilotSteer(session.iceberg, alt).steer;
    session.update(FIXED_DT, { steer: st, source: steer === 'none' ? 'none' : 'scripted' });
  }
  const end = at(session.iceberg.pos);
  const run: Run = {
    phase: session.phase,
    reason: session.failReason,
    stats: { ...session.stats },
    endS: end.s,
    endD: end.d,
    broken,
    air,
  };
  session.dispose();
  return run;
}

const describeRun = (r: Run): string =>
  `${r.phase}${r.reason ? ` (${r.reason})` : ''} at s=${r.endS.toFixed(0)} d=${r.endD.toFixed(0)}, ` +
  `${r.stats.time.toFixed(1)} s, ice ${(r.stats.iceLeft * 100).toFixed(1)} %, ` +
  `falls ${r.stats.waterfallsCrossed}, buildings ${r.stats.buildingsDestroyed}`;

describe('Highland Maze layout', () => {
  it('passes every level-design check, including a way to the sea', () => {
    expect(validateLevel(terrain())).toEqual([]);
    // Vehicles on roads or the farmyard apron, boats moored on the open sea.
    expect(validateVehiclePlacements(terrain())).toEqual([]);
  });

  it('builds its 380 m wide mountainside in ~1–1.5 s (CPU) on fewer than 250k vertices', () => {
    // Fresh ids: the session cache must not answer. Rocky Canyon, built right after it in the same
    // worker, is the yardstick for the cost per vertex when the whole suite loads the CPU.
    timed(() => createTerrain({ ...level, id: `${level.id}-warm` }));
    const { result: t, ms } = timed(() => createTerrain({ ...level, id: `${level.id}-timing` }));
    const ref = timed(() => createTerrain({ ...rockyCanyon, id: `${rockyCanyon.id}-timing` }));
    const vertices = t.grid.cols * t.grid.rows;
    const perVertex = ms / vertices;
    const refPerVertex = ref.ms / (ref.result.grid.cols * ref.result.grid.rows);
    console.log(
      `[highland maze] terrain ${ms.toFixed(0)} ms, ${t.grid.cols}×${t.grid.rows} = ${vertices} vertices, ` +
        `${(perVertex * 1000).toFixed(2)} µs/vertex (Rocky Canyon ${(refPerVertex * 1000).toFixed(2)})`,
    );
    expect(vertices).toBeLessThan(250_000);
    expect(perVertex).toBeLessThan(1.5 * refPerVertex);
    expect(ms).toBeLessThan(3000);
    expect(2 * t.course.halfWidthAt(800)).toBeCloseTo(380, 0);
  });

  it('keeps the obstacle bodies at spawn at or under 250', () => {
    const bodies = buildObstacleSpecs(terrain(), level.seed).length;
    console.log(`[highland maze] ${level.obstacles.length} placements -> ${bodies} bodies`);
    expect(bodies).toBeGreaterThan(150);
    expect(bodies).toBeLessThanOrEqual(250);
  });

  it('is an open-mountain level for a big iceberg, ~1.7 km to the sea, finishing 20 m out', () => {
    expect(level.index).toBe(8);
    expect(level.theme).toBe('alpine');
    expect(level.iceberg).toEqual({ scale: 1.3, mass: 60 });
    expect(level.relief).toBeDefined();
    expect(level.coastS - level.startS).toBeGreaterThanOrEqual(1500);
    expect(level.coastS - level.startS).toBeLessThanOrEqual(1800);
    expect(level.finishS).toBe(level.coastS + 20);
    expect(terrain().course.length).toBeGreaterThanOrEqual(level.finishS + 100);
    const sea = terrain().course.toWorld(level.finishS, 0);
    expect(terrain().isOcean(sea.x, sea.z)).toBe(true);
    // Three or more drops to fly off (cliff bands), all on land and with their full height.
    expect(level.cliffs.length).toBeGreaterThanOrEqual(3);
    for (const c of level.cliffs) {
      expect(c.width).toBeDefined();
      expect(c.s).toBeLessThan(level.coastS);
      expect(c.drop).toBeGreaterThanOrEqual(8);
    }
  });

  it('route search: both outer glens lead to the sea; the Blind Glen and the Devil’s Cut do not', () => {
    const t = terrain();
    const r = analyzeRoutes(t);
    console.log(
      `[highland maze] routes ${r.ms.toFixed(0)} ms, ${r.jumps} jumps, dead ends ` +
        JSON.stringify(r.deadEnds.map((d) => [Math.round(d.s), Math.round(d.d), d.area, d.cause])),
    );
    expect(r.solvable).toBe(true);
    const live = (s: number, d: number): boolean => {
      const w = t.course.toWorld(s, d);
      const ix = Math.floor((w.x - r.originX) / r.cell);
      const iz = Math.floor((w.z - r.originZ) / r.cell);
      return r.live[iz * r.cols + ix] === 1;
    };
    // Two genuinely different ways down: the left glen (over the Leap) and the right glen (to the
    // junction, then the middle or the Clachan); both lower lanes and the lower braes too.
    expect(live(420, -130)).toBe(true);
    expect(live(420, 120)).toBe(true);
    expect(live(720, 20)).toBe(true);
    expect(live(800, 120)).toBe(true);
    expect(live(1250, -110)).toBe(true);
    // The Blind Glen is a trap; right of ridge D the Devil's Cut swallows everything.
    const blind = r.deadEnds.find((d) => Math.abs(d.d) < 60 && d.s > 380 && d.s < 610);
    const cut = r.deadEnds.find((d) => d.d > 140 && d.s > 450 && d.s < 680);
    expect(blind?.cause).toBe('trap');
    expect(blind!.area).toBeGreaterThan(10_000);
    expect(cut?.cause).toBe('ravine');
    expect(cut!.area).toBeGreaterThan(3_000);
  });

  it('is a maze, not a corridor: the line keeps well off the centreline', () => {
    const line = level.line!;
    let sum = 0;
    let n = 0;
    for (let s = 150; s <= 1550; s += 10) {
      const i = line.findIndex((p) => p.s >= s);
      const a = line[i - 1];
      const b = line[i];
      sum += Math.abs(a.d + ((b.d - a.d) * (s - a.s)) / (b.s - a.s));
      n++;
    }
    expect(sum / n).toBeGreaterThan(60);
  });

  it('its ravines are fatal and deep; the Devil’s Cut and the Gorge’s ends are too wide to jump', () => {
    const trap = trapWallDepth(level.cellSize);
    for (const f of [leap, devilsCut, ...gorge]) {
      expect(f.fatal).not.toBe(false);
      expect(f.depth).toBeGreaterThanOrEqual(trap);
    }
    expect(devilsCut.width).toBeGreaterThanOrEqual(40);
    expect(gorge[2].width).toBeGreaterThanOrEqual(40);
    // The Leap: its near edge sits on band 0's lip, across the band.
    expect(Math.min(...leap.points.map((p) => p.s)) - leap.width / 2).toBeLessThan(band0.s + 2);
    expect(Math.min(...leap.points.map((p) => p.d))).toBeLessThan((band0.d ?? 0) - (band0.width ?? 0) / 2);
  });

  it('makes sense: vehicles on roads, buildings by a road, a bridge where the road meets the Gorge', () => {
    const roads = features.filter((f): f is Feature<'road'> => f.type === 'road');
    const onRoad = (s: number, d: number, margin = 0): boolean =>
      roads.some((r) => featureContains(r, s, d, hw(s), margin));
    // Vehicles on roads or the farmyard apron, boats on the sea (validateVehiclePlacements, above).
    const vehicles = level.obstacles.filter((o) => ['car', 'truck', 'bus'].includes(o.kind));
    expect(vehicles.length).toBeGreaterThanOrEqual(6);
    for (const b of level.obstacles.filter((o) => o.kind === 'boat'))
      expect(b.s).toBeGreaterThan(level.coastS);
    const buildings = level.obstacles.filter((o) =>
      ['house', 'barn', 'silo', 'chalet', 'church'].includes(o.kind),
    );
    expect(buildings.length).toBeGreaterThanOrEqual(15);
    for (const b of buildings) expect(onRoad(b.s, b.d, 50), `${b.kind} at s=${b.s}`).toBe(true);
    // The church stands on its knoll; dry-stone dykes (fences) line the road and fields.
    const knoll = features.find((f): f is Feature<'hill'> => f.type === 'hill')!;
    const kirk = level.obstacles.find((o) => o.kind === 'church' && o.s < 1000)!;
    expect(featureContains(knoll, kirk.s, kirk.d, hw(kirk.s))).toBe(true);
    expect(level.obstacles.filter((o) => o.kind === 'fence').length).toBeGreaterThanOrEqual(3);
    const bridge = level.obstacles.find((o) => o.kind === 'roadBridge')!;
    expect(featureContains(gorge[0], bridge.s, bridge.d, hw(bridge.s))).toBe(true);
    expect(roads.some((r) => r.s1 < bridge.s && Math.abs(r.d - bridge.d) < 1)).toBe(true);
    expect(roads.some((r) => r.s0 > bridge.s && Math.abs(r.d - bridge.d) < 1)).toBe(true);
  });
});

describe('Highland Maze traffic', () => {
  it('the Clachan crossroads has traffic lights; the glen road’s cars drive and stop at red', async () => {
    const net = trafficNetwork(terrain());
    const lit = net.junctions.filter((j) => j.signalised);
    expect(lit).toHaveLength(1);
    expect(lit[0].legs).toHaveLength(4);
    const at = terrain().course.project(lit[0].x, lit[0].z);
    expect(at.s).toBeCloseTo(820, -1);
    expect(at.d).toBeCloseTo(95, -1);
    const session = await GameSession.create({ level, skipIntro: true });
    const w = session.physics as PhysicsWorld;
    const t = w.traffic!;
    const bodies = w.bodies.length;
    let waits = 0;
    for (let n = 0; n < 45 * 60 && session.phase === 'playing'; n++) {
      session.update(FIXED_DT, autopilotSteer(session.iceberg, session.terrain));
      for (let i = 0; i < t.count; i++) {
        if (!t.active[i] || t.v[i] > 0.05) continue;
        const p = t.net.paths[t.path[i]];
        if (p.kind !== 'lane' || p.junction < 0 || p.leg < 0) continue;
        const J = t.net.junctions[p.junction];
        if (p.length - t.arc[i] < 6 && t.signal(J.id, J.legs[p.leg].group) === 'red') waits++;
      }
    }
    const lights = w.bodies.filter((b) => b.kind === 'trafficLight').length;
    console.log(
      `[highland maze] traffic: ${t.driving}/${t.count} driving, ${lights} lights, ${bodies} bodies at ` +
        `spawn, red-light waits ${waits} steps in 45 s`,
    );
    session.dispose();
    expect(lights).toBe(4);
    expect(t.driving).toBeGreaterThanOrEqual(6);
    expect(bodies).toBeLessThanOrEqual(250);
    expect(waits).toBeGreaterThan(60);
  }, 120_000);
});

describe('Highland Maze runs (real water budget and chipping)', () => {
  let line: Run;
  beforeAll(async () => {
    line = await drive('line');
    console.log(`[highland maze] line: ${describeRun(line)}`);
  }, 180_000);

  it('the line leaps the ravine, flies three waterfalls and reaches the sea with ~25–40 % ice', () => {
    expect(line.phase, describeRun(line)).toBe('complete');
    expect(line.stats.iceLeft).toBeGreaterThan(0.25);
    expect(line.stats.iceLeft).toBeLessThan(0.4);
    expect(line.stats.waterfallsCrossed).toBeGreaterThanOrEqual(3);
    expect(line.stats.time).toBeLessThan(90);
    expect(line.stats.buildingsDestroyed).toBeGreaterThanOrEqual(1);
    // Off band 0's lip and down beyond the ravine's far edge.
    const off = line.air.find((a) => Math.abs(a.s - band0.s) < 6);
    expect(off).toBeDefined();
    expect(off!.speed).toBeGreaterThan(19);
    expect(off!.landS).toBeGreaterThan(leapFar);
  });

  it('the Leap is only for the fast: ~17 m/s off the lip falls in, ~19.5 m/s clears it', async () => {
    const slow = await drive('line', { seconds: 10, at: { s: 458, d: -125, speed: 16 } });
    console.log(`[highland maze] slow leap: ${describeRun(slow)}`);
    expect(slow.air[0].speed).toBeLessThan(18);
    expect(slow.phase).toBe('failed');
    expect(slow.reason).toBe('fell');
    expect(slow.endS).toBeGreaterThan(band0.s);
    expect(slow.endS).toBeLessThan(leapFar + 2);
    const fast = await drive('line', { seconds: 6, at: { s: 458, d: -125, speed: 19 } });
    expect(fast.phase).toBe('playing');
    const off = fast.air.find((a) => Math.abs(a.s - band0.s) < 6);
    expect(off!.speed).toBeLessThan(20.5);
    expect(off!.landS).toBeGreaterThan(leapFar);
  }, 120_000);

  it('the middle (the long, safe way round) reaches the sea, slower and with less ice', async () => {
    const r = await drive(MIDDLE);
    console.log(`[highland maze] middle: ${describeRun(r)}`);
    expect(r.phase, describeRun(r)).toBe('complete');
    expect(r.stats.iceLeft).toBeLessThan(line.stats.iceLeft - 0.05);
    expect(r.stats.time).toBeGreaterThan(line.stats.time + 10);
    // It never jumps a ravine: no take-off near the Leap or the Gorge.
    expect(r.air.some((a) => Math.abs(a.s - band0.s) < 10)).toBe(false);
  }, 180_000);

  it('the Clachan smashes the hamlet and barely makes it to the sea', async () => {
    const r = await drive(CLACHAN);
    console.log(`[highland maze] Clachan: ${describeRun(r)}`);
    expect(r.phase, describeRun(r)).toBe('complete');
    expect(r.stats.buildingsDestroyed).toBeGreaterThanOrEqual(3);
    expect(r.broken.filter((b) => b.s > 640 && b.s < 1060).length).toBeGreaterThanOrEqual(3);
    expect(r.stats.iceLeft).toBeLessThan(line.stats.iceLeft - 0.1);
  }, 180_000);

  it('the glen road crosses the Gorge on its bridge and reaches the sea (playtest 2)', async () => {
    const r = await drive(GLEN_ROAD);
    console.log(`[highland maze] glen road: ${describeRun(r)}`);
    expect(r.phase, describeRun(r)).toBe('complete');
    // Through the hamlet like the Clachan, then the bridge instead of the rock bridge.
    expect(r.broken.filter((b) => b.s > 640 && b.s < 1060).length).toBeGreaterThanOrEqual(3);
    expect(r.stats.iceLeft).toBeLessThan(line.stats.iceLeft - 0.1);
  }, 180_000);

  it('drifting 8 or 10 m right of the glen road beyond the bridge still reaches the sea', async () => {
    // Playtest 2 review: 10 m right of the road from s 1290 to 1560 the run stuck at s 1477, in the strip
    // between the raised road and a tor (s 1396-1404) and a 5 m rock hump (s 1452); relief.clear now keeps
    // that strip free of tors (measured: +8 … +16 all complete, 10.5-11.3 % ice).
    for (const shift of [8, 10]) {
      const drifted = GLEN_ROAD.map((p) => {
        const k = p.s >= 1290 && p.s <= 1560 ? 1 : p.s > 1260 && p.s < 1290 ? (p.s - 1260) / 30 : p.s > 1560 && p.s < 1590 ? (1590 - p.s) / 30 : 0;
        return { s: p.s, d: p.d + k * shift };
      });
      const r = await drive(drifted);
      console.log(`[highland maze] glen road, +${shift} m after the bridge: ${describeRun(r)}`);
      expect(r.phase, `+${shift}: ${describeRun(r)}`).toBe('complete');
    }
  }, 240_000);

  it('wrong branches end the run: the Devil’s Cut (fell), the Blind Glen and gully G1 (stuck)', async () => {
    const cut = await drive('none', { seconds: 40, at: { s: 560, d: 168, speed: 12 } });
    console.log(`[highland maze] Devil's Cut: ${describeRun(cut)}`);
    expect(cut.reason).toBe('fell');
    expect(cut.endD).toBeGreaterThan(120);
    const blind = await drive('none', { seconds: 90, at: { s: 470, d: 0, speed: 10 } });
    console.log(`[highland maze] Blind Glen: ${describeRun(blind)}`);
    expect(blind.reason).toBe('stuck');
    expect(blind.endS).toBeLessThan(610);
    const gully = await drive('none', { seconds: 90, at: { s: 290, d: -158, speed: 8 } });
    console.log(`[highland maze] G1: ${describeRun(gully)}`);
    expect(gully.reason).toBe('stuck');
    expect(gully.endS).toBeLessThan(450);
    expect(gully.endD).toBeLessThan(-150);
  }, 180_000);

  it('no input and the naive centreline both die in the Blind Glen', async () => {
    for (const steer of ['none', 'centre'] as const) {
      const r = await drive(steer, { seconds: 120 });
      console.log(`[highland maze] ${steer}: ${describeRun(r)}`);
      expect(r.phase).toBe('failed');
      expect(r.endS).toBeLessThan(610);
      expect(Math.abs(r.endD)).toBeLessThan(100);
    }
  }, 180_000);
});

describe('Highland Maze bridge', () => {
  it('an iceberg sliding down the glen road crosses the Gorge on the bridge, and the deck stays put', async () => {
    // Playtest 2: "on level 8 see the bridge here i can't cross it". The iceberg used to meet the
    // x1 end of the deck (skewed 37° along the rim) as a wall at road level and glance off it into
    // the Gorge, from every lane and speed. A road bridge now carries it (src/core/physics/
    // deckGround.ts): down the glen road, over the deck high above the Gorge floor and on down the
    // road beyond, never touching the deck, which stays on its seats. (Before that, the deck's
    // bounding-rectangle proxy threw it 17-33 m into the gorge; PhysicsWorld.pushSeatedDeck still
    // holds a deck against a push from the side.)
    const bridge = level.obstacles.find((o) => o.kind === 'roadBridge')!;
    for (const d of [91, 95, 99]) {
      for (const speed of [6, 12]) {
        const session = await GameSession.create({ level, skipIntro: true });
        const t = session.terrain;
        const decks = (session.physics as PhysicsWorld).bodies.filter((b) => b.kind === 'roadBridge' && b.part === 'deck');
        expect(decks.length).toBeGreaterThan(0);
        place(session, 1190, d, speed);
        let moved = 0;
        let maxS = 0;
        let high = 0;
        for (let n = 0; n < 16 * 60 && session.phase === 'playing'; n++) {
          const st = autopilotSteer(session.iceberg, t, { pursuit: 'course', followLine: false, lane: d });
          session.update(FIXED_DT, st);
          const ice = session.iceberg;
          const p = t.course.project(ice.pos.x, ice.pos.z);
          maxS = Math.max(maxS, p.s);
          if (Math.abs(p.s - bridge.s) < 12) high = Math.max(high, ice.pos.y - t.heightAt(ice.pos.x, ice.pos.z));
          for (const b of decks) moved = Math.max(moved, Math.hypot(b.pos.x - b.spawn.x, b.pos.y - b.spawn.y, b.pos.z - b.spawn.z));
        }
        const hit = decks.some((b) => b.lastHitTime > 0);
        const tag = `d ${d}, ${speed} m/s: ${session.phase} ${session.failReason ?? ''} to s ${maxS.toFixed(0)}`;
        console.log(`[highland maze] glen road ${tag}, ${high.toFixed(1)} m over the Gorge floor, deck hit ${hit}, moved ${moved.toFixed(2)} m`);
        expect(session.failReason, tag).toBeNull();
        // Over the far rim (s 1260) and on down the glen road.
        expect(maxS, tag).toBeGreaterThan(1290);
        // On the deck, high over the Gorge floor (14 m deep).
        expect(high, tag).toBeGreaterThan(10);
        expect(hit, tag).toBe(false);
        expect(moved, tag).toBeLessThan(0.05);
        session.dispose();
      }
    }
  }, 240_000);
});
