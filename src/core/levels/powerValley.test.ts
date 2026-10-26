import { describe, expect, it } from 'vitest';
import { FIXED_DT, GameSession, getTerrain } from '../session';
import { autopilotSteer } from '../autopilot';
import { dirToHeading } from '../math';
import { createTerrain } from '../terrain/terrain';
import { featureContains } from '../terrain/features';
import { analyzeRoutes } from '../terrain/routes';
import { validateLevel, validateVehiclePlacements } from '../terrain/validate';
import { validateDams } from '../water/validate';
import { trafficNetwork } from '../traffic/network';
import { buildObstacleSpecs } from '../obstacles/spawn';
import type { PhysicsWorld } from '../physics/world';
import type {
  CourseCoord,
  GameEvent,
  LevelDef,
  ObstacleKind,
  SteeringInput,
  TerrainFeature,
} from '../types';
import { bestOf } from '../testing/timing';
import { getGlacier } from '../glacier/glacier';
import { rockyCanyon } from './rockyCanyon';
import { powerValley } from './powerValley';

const L = powerValley;
type Feature<T extends TerrainFeature['type']> = Extract<TerrainFeature, { type: T }>;
const features = L.features ?? [];
const roads = features.filter((f): f is Feature<'road'> => f.type === 'road');
const of = (kind: ObstacleKind) => L.obstacles.filter((o) => o.kind === kind);
const dam = of('dam')[0];
const NONE: SteeringInput = { steer: 0, source: 'none' };

describe('power valley: an open industrial mountain valley', () => {
  const terrain = getTerrain(L);
  const hw = (s: number): number => terrain.course.sampleAt(s).halfWidth;

  it('passes every level-design check, including a way to the sea', () => {
    expect(validateLevel(terrain)).toEqual([]);
  });

  it('builds its terrain within budget (CPU; compared with a valley level on a busy machine)', () => {
    // Both warmed up, then the fastest of two each: timed once and first, this level paid the JIT's
    // warm-up and failed the ratio on a busy machine (2026-10-23).
    const { result: t, ms } = bestOf((i) => createTerrain({ ...L, id: `${L.id}-build-timing-${i}` }));
    const ref = bestOf((i) => createTerrain({ ...rockyCanyon, id: `${rockyCanyon.id}-build-ref-${i}` }));
    const vertices = t.grid.cols * t.grid.rows;
    const perVertex = ms / vertices;
    const refPerVertex = ref.ms / (ref.result.grid.cols * ref.result.grid.rows);
    console.log(
      `[power valley] terrain ${t.grid.cols}x${t.grid.rows} = ${vertices} vertices (cell ${L.cellSize} m) ` +
        `in ${ms.toFixed(0)} ms CPU, ${(perVertex * 1000).toFixed(2)} µs/vertex ` +
        `(Rocky Canyon ${(refPerVertex * 1000).toFixed(2)})`,
    );
    expect(vertices).toBeLessThanOrEqual(250_000);
    expect(perVertex).toBeLessThan(2 * refPerVertex);
    expect(ms).toBeLessThan(4000);
  });

  it('keeps the obstacle bodies at spawn within 250', () => {
    const specs = buildObstacleSpecs(terrain, L.seed);
    console.log(`[power valley] ${L.obstacles.length} placements -> ${specs.length} bodies at spawn`);
    expect(specs.length).toBeLessThanOrEqual(250);
  });

  it('keeps its identity: industrial, the 220 t iceberg, the longest run, finish 20 m out to sea', () => {
    expect(L.index).toBe(6);
    expect(L.theme).toBe('industrial');
    expect(L.iceberg).toEqual({ scale: 2.2, mass: 220 });
    expect(L.relief).toBeDefined();
    expect(L.coastS - L.startS).toBeGreaterThanOrEqual(1750);
    expect(L.finishS - L.coastS).toBe(20);
    expect(hw(800)).toBeGreaterThanOrEqual(150);
    const sea = terrain.course.toWorld(L.finishS, 0);
    expect(terrain.isOcean(sea.x, sea.z)).toBe(true);
    // At least three drops the iceberg flies off (arcing waterfalls), each ≥ 12 m.
    expect(L.cliffs.filter((c) => c.drop >= 12).length).toBeGreaterThanOrEqual(3);
  });

  it('builds the power plant, wind farm and rail yard at full size', () => {
    expect(of('coolingTower').length).toBeGreaterThanOrEqual(4);
    expect(of('smokestack').length).toBeGreaterThanOrEqual(3);
    expect(of('tank').length).toBeGreaterThanOrEqual(5);
    expect(of('factoryHall').length).toBeGreaterThanOrEqual(5);
    expect(of('pylon').length).toBeGreaterThanOrEqual(6);
    expect(of('railWagon').length).toBeGreaterThanOrEqual(10);
    const kinds: ObstacleKind[] = ['coolingTower', 'smokestack', 'factoryHall', 'windTurbine', 'tank'];
    for (const k of [...kinds, 'dam'] as const) {
      for (const o of of(k)) expect(o.scale ?? 1, `${k} at s=${o.s}`).toBe(1);
    }
    // The wind farm stands on open mound ridges.
    const mounds = features.filter(
      (f): f is Feature<'ridge'> => f.type === 'ridge' && f.profile === 'mound',
    );
    const onRidge = of('windTurbine').filter((t) =>
      mounds.some((m) => featureContains(m, t.s, t.d, hw(t.s))),
    );
    expect(onRidge.length).toBeGreaterThanOrEqual(5);
  });

  it('puts things where they make sense: vehicles on roads and parking, wagons on track beds', () => {
    expect(validateVehiclePlacements(terrain)).toEqual([]);
    // Every wagon stands on a rail track bed (the yard, the freight train's cross track, the cutting).
    const rails = roads.filter((r) => r.surface === 'rail');
    for (const w of of('railWagon')) {
      const on = rails.some((r) =>
        r.s1 - r.s0 < r.width
          ? Math.abs(w.s - (r.s0 + r.s1) / 2) <= (r.s1 - r.s0) / 2 && Math.abs(w.d - r.d) <= r.width / 2
          : w.s >= r.s0 && w.s <= r.s1 && Math.abs(w.d - r.d) <= r.width / 2,
      );
      expect(on, `wagon at s=${w.s} d=${w.d}`).toBe(true);
    }
  });

  it('has a real river: from the glacier, held by the dam, over the falls to the sea', async () => {
    expect(validateDams(terrain)).toEqual([]);
    const river = features.find((f): f is Feature<'stream'> => f.type === 'stream');
    expect(river).toBeDefined();
    expect(river!.points[river!.points.length - 1].s).toBeGreaterThan(L.finishS);
    // Meltwater: it rises under the level-start glacier and runs out of a portal in its snout (the
    // world logic rule stream-source, in validateLevel above, checks it holds).
    expect(river!.source).toBe('glacier');
    const glacier = getGlacier(terrain);
    expect(glacier.portals.map((p) => p.feature)).toEqual([features.indexOf(river!)]);
    expect(glacier.portals[0].s).toBeLessThan(L.startS);
    const session = await GameSession.create({ level: L, skipIntro: true });
    const lake = session.water?.reservoirs[0];
    console.log(
      `[power valley] reservoir: floor ${lake?.floorY.toFixed(1)} crest ${lake?.crestY.toFixed(1)} ` +
        `level ${lake?.fullLevel.toFixed(1)}, ${lake?.vertexCount} vertices`,
    );
    session.dispose();
    expect(lake).toBeDefined();
    expect(lake!.placement).toBe(L.obstacles.indexOf(dam));
    expect(lake!.fullLevel - lake!.floorY).toBeGreaterThan(4);
    expect(lake!.vertexCount).toBeGreaterThan(100);
  }, 120_000);

  it('runs traffic through signalised junctions in the plant and the port', async () => {
    const net = trafficNetwork(terrain);
    const at = net.junctions.map((j) => ({ ...terrain.course.project(j.x, j.z), j }));
    console.log(
      '[power valley] junctions ' +
        JSON.stringify(at.map((a) => [Math.round(a.s), Math.round(a.d), a.j.legs.length, a.j.signalised])),
    );
    const lit = at.filter((a) => a.j.signalised && a.j.legs.length >= 3);
    expect(lit.filter((a) => a.s > 650 && a.s < 990).length).toBeGreaterThanOrEqual(2);
    expect(lit.filter((a) => a.s > 1550).length).toBeGreaterThanOrEqual(2);
    const session = await GameSession.create({ level: L, skipIntro: true });
    const traffic = (session.physics as PhysicsWorld).traffic;
    for (let n = 0; n < 300; n++) session.update(FIXED_DT, NONE);
    const driving = traffic?.driving ?? 0;
    const lights = (session.physics as PhysicsWorld).bodies.filter((b) => b.kind === 'trafficLight').length;
    console.log(`[power valley] traffic: ${driving} vehicles driving, ${lights} traffic lights`);
    session.dispose();
    expect(driving).toBeGreaterThanOrEqual(20);
    expect(lights).toBeGreaterThanOrEqual(12);
  }, 120_000);

  it('the route search finds the way to the sea and the designed dead ends', () => {
    const r = analyzeRoutes(terrain);
    console.log(
      `[power valley] routes ${r.ms.toFixed(0)} ms, ${r.jumps} jumps, dead ends ` +
        JSON.stringify(r.deadEnds.map((d) => [Math.round(d.s), Math.round(d.d), d.area, d.cause])),
    );
    expect(r.solvable).toBe(true);
    const cutting = r.deadEnds.find((d) => d.s > 250 && d.s < 450 && d.d > 90);
    const coalYard = r.deadEnds.find((d) => d.s > 520 && d.s < 740 && d.d > 90);
    expect(cutting?.cause).toBe('trap');
    expect(coalYard?.cause).toBe('trap');
  });
});

// --- runs --------------------------------------------------------------------------------------

interface Run {
  phase: string;
  reason: string | null;
  time: number;
  endS: number;
  endD: number;
  ice: number;
  stats: GameSession['stats'];
  events: GameEvent[];
  msPerStep: number;
  /** Largest tilt (deg) of the bodies of the wind turbine at `turbineIndex`, measured at the end. */
  turbineTilt: number;
  /** The reservoir at the end: breached, peak outflow (m³/s), breach width (m). */
  flood: { broken: boolean; qPeak: number; breach: number };
}

/** The turbine on the intended line (on the middle mound, s ≈ 306). */
const turbineIndex = L.obstacles.findIndex((o) => o.kind === 'windTurbine' && o.s === 306);

/** A copy of the level whose intended line is `line` (the autopilot reads terrain.level.line). */
const withLine = (line: CourseCoord[]): LevelDef => ({ ...L, line });

async function drive(
  steer: (s: GameSession) => SteeringInput,
  opts: { line?: CourseCoord[]; seconds?: number; setup?: (s: GameSession) => void } = {},
): Promise<Run> {
  const level = opts.line ? withLine(opts.line) : L;
  const session = await GameSession.create({
    level,
    terrain: opts.line ? { ...getTerrain(L), level } : undefined,
    skipIntro: true,
  });
  const events: GameEvent[] = [];
  session.events.on((e) => events.push(e));
  opts.setup?.(session);
  const steps = (opts.seconds ?? 240) * 60;
  let n = 0;
  let total = 0;
  const cpu0 = process.cpuUsage();
  const wall0 = performance.now();
  for (; n < steps && session.phase === 'playing'; n++) {
    const input = steer(session);
    const t0 = performance.now();
    session.update(FIXED_DT, input);
    total += performance.now() - t0;
  }
  // Wall time, or this process's CPU time when lower (other suites compete for the cores).
  const cpu = process.cpuUsage(cpu0);
  const k = Math.min(1, (cpu.user + cpu.system) / 1000 / Math.max(1e-9, performance.now() - wall0));
  let tilt = 0;
  for (const b of (session.physics as PhysicsWorld).bodies) {
    if (b.placement !== turbineIndex || !b.active) continue;
    const q = b.quat;
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    tilt = Math.max(tilt, (Math.acos(Math.max(-1, Math.min(1, upY))) * 180) / Math.PI);
  }
  const lake = session.water?.reservoirs[0];
  const flood = { broken: lake?.broken ?? false, qPeak: lake?.qPeak ?? 0, breach: lake?.breachWidth ?? 0 };
  const ice = session.iceberg;
  const p = session.terrain.course.project(ice.pos.x, ice.pos.z);
  const run: Run = {
    phase: session.phase,
    reason: session.failReason,
    time: session.stats.time,
    endS: p.s,
    endD: p.d,
    ice: ice.ice,
    stats: { ...session.stats },
    events,
    msPerStep: (total * k) / Math.max(1, n),
    turbineTilt: tilt,
    flood,
  };
  session.dispose();
  return run;
}

/** Teleport to (s, d) moving down-course at `speed`, grounded (for the dead-end checks). */
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

const describeRun = (name: string, r: Run): string =>
  `[power valley] ${name.padEnd(14)} ${r.phase}${r.reason ? `(${r.reason})` : ''} ` +
  `at s=${r.endS.toFixed(0)} d=${r.endD.toFixed(0)} t=${r.time.toFixed(1)}s ` +
  `ice=${(r.ice * 100).toFixed(1)}% knocked=${r.stats.knockedDown} ` +
  `buildings=${r.stats.buildingsDestroyed} falls=${r.stats.waterfallsCrossed} ` +
  `score=${r.stats.score} step=${r.msPerStep.toFixed(2)}ms`;

const broke = (r: Run, kind: ObstacleKind): number =>
  r.events.filter((e) => e.type === 'obstacleBroken' && e.kind === kind).length;

/**
 * The ridge route: left of the first fork onto the wind-farm bench, over the ends of its mound
 * ridges, off cliff band 1 on the left, down the bench past the plant and off the 30 m cliff left
 * of the dam gorge, over the canal off the far-left kicker, round the lower block's left.
 */
const RIDGE: CourseCoord[] = [
  { s: 30, d: 0 },
  { s: 90, d: -12 },
  { s: 150, d: -45 },
  { s: 185, d: -65 },
  { s: 230, d: -100 },
  { s: 280, d: -135 },
  { s: 330, d: -160 },
  { s: 440, d: -165 },
  { s: 520, d: -178 },
  { s: 1000, d: -180 },
  { s: 1150, d: -175 },
  { s: 1262, d: -170 },
  { s: 1284, d: -170 },
  { s: 1330, d: -165 },
  { s: 1400, d: -160 },
  { s: 1450, d: -135 },
  { s: 1530, d: -80 },
  { s: 1650, d: -60 },
  { s: 1700, d: -45 },
  { s: 1790, d: -15 },
  { s: 1845, d: 0 },
  { s: 1900, d: 0 },
];

/**
 * The breach: from the boiler house straight down the gorge, across the reservoir, square onto the
 * monolith over the riverbed (the deepest water: the biggest flood), over the 30 m fall with the
 * flood, then over the middle kicker K1 and down the middle of the port.
 */
function breachLine(): CourseCoord[] {
  const t = getTerrain(L);
  const river = features.find((f): f is Feature<'stream'> => f.type === 'stream')!;
  const near = (best: CourseCoord, p: CourseCoord): CourseCoord =>
    Math.abs(p.s - dam.s) < Math.abs(best.s - dam.s) ? p : best;
  const riverD = river.points.reduce(near).d;
  const index = L.obstacles.indexOf(dam);
  const blocks = buildObstacleSpecs(t, L.seed).filter((b) => b.placement === index && b.anchored);
  const ds = blocks.map((b) => t.course.project(b.position.x, b.position.z).d);
  const target = ds.reduce((a, b) => (Math.abs(b - riverD) < Math.abs(a - riverD) ? b : a));
  const line = L.line ?? [];
  return [
    ...line.filter((q) => q.s <= 915),
    { s: 960, d: -46 },
    { s: 1010, d: -34 },
    { s: 1050, d: target },
    { s: 1085, d: target },
    { s: 1150, d: -20 },
    { s: 1265, d: -20 },
    { s: 1288, d: -20 },
    { s: 1330, d: -20 },
    { s: 1400, d: -15 },
    { s: 1450, d: -20 },
    { s: 1500, d: 5 },
    { s: 1560, d: -10 },
    { s: 1640, d: -12 },
    { s: 1700, d: -2 },
    { s: 1790, d: 0 },
    { s: 1845, d: 0 },
    { s: 1900, d: 0 },
  ];
}

let lineRun: Promise<Run> | null = null;
const theLine = (): Promise<Run> => (lineRun ??= drive((s) => autopilotSteer(s.iceberg, s.terrain)));

describe('power valley: routes (real water budget and chipping)', () => {
  it('the intended line goes through the plant and over the spillway to the sea', async () => {
    const r = await theLine();
    console.log(describeRun('line', r));
    expect(r.phase, describeRun('line', r)).toBe('complete');
    expect(r.stats.waterfallsCrossed).toBeGreaterThanOrEqual(3);
    expect(r.stats.buildingsDestroyed).toBeGreaterThanOrEqual(5);
    expect(r.stats.knockedDown).toBeGreaterThanOrEqual(12);
    expect(broke(r, 'coolingTower')).toBeGreaterThanOrEqual(2);
    expect(broke(r, 'windTurbine')).toBeGreaterThanOrEqual(1);
    expect(r.stats.peakMass).toBe(220);
    expect(r.ice).toBeGreaterThan(0.18);
    expect(r.ice).toBeLessThan(0.55);
    expect(r.time).toBeLessThan(180);
    // Generous: the step shares the CPU with other suites (~3 ms alone on this level).
    expect(r.msPerStep).toBeLessThan(10);
  }, 300_000);

  it('the wind turbine it hits on the way comes down', async () => {
    const r = await theLine();
    console.log(`[power valley] turbine on the line: tilted ${r.turbineTilt.toFixed(0)}° at the end`);
    expect(turbineIndex).toBeGreaterThanOrEqual(0);
    expect(r.turbineTilt).toBeGreaterThan(45);
  }, 300_000);

  it('the ridge route (wind farm, no plant, no dam) is faster and keeps more ice', async () => {
    const line = await theLine();
    const r = await drive((s) => autopilotSteer(s.iceberg, s.terrain), { line: RIDGE });
    console.log(describeRun('ridge route', r));
    expect(r.phase, describeRun('ridge route', r)).toBe('complete');
    expect(r.stats.waterfallsCrossed).toBeGreaterThanOrEqual(3);
    expect(r.time).toBeLessThan(line.time);
    expect(r.ice).toBeGreaterThan(line.ice);
    expect(r.stats.buildingsDestroyed).toBeLessThan(line.stats.buildingsDestroyed);
  }, 300_000);

  it('breaching the dam floods the lower valley: the spectacular, risky route', async () => {
    const r = await drive((s) => autopilotSteer(s.iceberg, s.terrain), { line: breachLine() });
    console.log(
      describeRun('dam breach', r) +
        ` | flood: breach ${r.flood.breach.toFixed(0)} m, peak ${r.flood.qPeak.toFixed(0)} m³/s`,
    );
    expect(r.phase, describeRun('dam breach', r)).toBe('complete');
    expect(broke(r, 'dam')).toBeGreaterThanOrEqual(1);
    expect(r.flood.broken).toBe(true);
    expect(r.flood.qPeak).toBeGreaterThan(100);
  }, 300_000);

  it('the highway bridge carries the hydro road, and the iceberg, over the fatal canal', async () => {
    // Playtest 2: a road bridge carries the iceberg (src/core/physics/deckGround.ts). It used to
    // glance off the girder end into the canal (fell at s 1294-1302, every lane and speed): the deck
    // was a wall at road level. From the hydro road and 3 m either side of it, slow or fast, it now
    // rides the deck ~9.5 m over the canal floor and runs on down the road to the depot.
    const bridge = of('roadBridge')[0];
    for (const d of [-138, -135, -132]) {
      for (const speed of [6, 18]) {
        let maxS = 0;
        let high = 0;
        const steer = (x: GameSession): SteeringInput => {
          const ice = x.iceberg;
          const p = x.terrain.course.project(ice.pos.x, ice.pos.z);
          maxS = Math.max(maxS, p.s);
          if (Math.abs(p.s - 1296) < 5) high = Math.max(high, ice.pos.y - x.terrain.heightAt(ice.pos.x, ice.pos.z));
          return autopilotSteer(ice, x.terrain, { pursuit: 'course', followLine: false, lane: d });
        };
        const r = await drive(steer, { seconds: 16, setup: (x) => place(x, 1215, d, speed) });
        const tag = `lane d ${d}, ${speed} m/s: ${describeRun('bridge', r)}`;
        console.log(`${tag}, ${high.toFixed(1)} m over the canal`);
        expect(r.reason, tag).toBeNull();
        // Over the far end of the deck (s 1325) and on down the road.
        expect(maxS, tag).toBeGreaterThan(bridge.s + (bridge.span ?? 0) / 2 + 15);
        expect(high, tag).toBeGreaterThan(8);
      }
    }
  }, 240_000);

  it.each([
    ['the slag-heap pocket', 705, -15, 12, 'stuck'],
    ['the rail cutting', 300, 150, 10, 'stuck'],
    ['the coal yard', 600, 150, 10, 'stuck'],
    ['the ravine branch below the dam', 1180, 100, 14, 'fell'],
    ['the canal off the kickers', 1225, -70, 18, 'fell'],
  ] as const)('a wrong branch ends the run: %s', async (name, s, d, speed, reason) => {
    const r = await drive(() => NONE, { seconds: 60, setup: (x) => place(x, s, d, speed) });
    console.log(describeRun(name.slice(0, 14), r));
    expect(r.phase).toBe('failed');
    expect(r.reason).toBe(reason);
  }, 120_000);

  it('a naive centreline run and a no-input run both fail', async () => {
    const naive = await drive((s) => autopilotSteer(s.iceberg, s.terrain, { followLine: false }));
    const none = await drive(() => NONE);
    console.log(describeRun('centreline', naive));
    console.log(describeRun('no input', none));
    expect(naive.phase).toBe('failed');
    expect(none.phase).toBe('failed');
  }, 300_000);
});
