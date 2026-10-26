import { describe, expect, it } from 'vitest';
import { FIXED_DT, GameSession } from '../session';
import { autopilotSteer } from '../autopilot';
import { dirToHeading } from '../math';
import { createIceberg, setIce, stepIceberg } from '../sim/iceberg';
import { DEFAULT_ICEBERG_PARAMS, withLevelIceberg } from '../sim/params';
import { buildObstacleSpecs } from '../obstacles/spawn';
import { isStructureKind, structureDef } from '../obstacles/structures';
import { createTerrain, type GeneratedTerrain } from '../terrain/terrain';
import type { PhysicsWorld } from '../physics/world';
import { analyzeRoutes } from '../terrain/routes';
import { featureContains } from '../terrain/features';
import { validateLevel, validateVehiclePlacements } from '../terrain/validate';
import type { CourseCoord, ObstaclePlacement, RunStats, SteeringInput, TerrainFeature } from '../types';
import { timed } from '../testing/timing';
import { alpinePass } from './alpinePass';

/**
 * Alpine Pass, the open mountainside (see the header of ./alpinePass.ts): build and validity, things
 * where they make sense (vehicles on roads, buildings by roads), the route search's dead ends, the
 * col, the intended line and two other routes to the sea, the dead-end branches, and the glacier
 * tongue gamble. Runs use the real water budget and chipping.
 */

const L = alpinePass;
const line = L.line!;
const features = L.features!;
type Feature<T extends TerrainFeature['type']> = Extract<TerrainFeature, { type: T }>;
const featuresOf = <T extends TerrainFeature['type']>(type: T): Feature<T>[] =>
  features.filter((f): f is Feature<T> => f.type === type);
const find = (kind: ObstaclePlacement['kind']): ObstaclePlacement[] =>
  L.obstacles.filter((o) => o.kind === kind);

// Build once (CPU time: other test workers stretch wall time). A busy machine can still push one
// build over budget, so a slow first measure gets one re-measure.
let built = timed(() => createTerrain(L));
if (built.ms >= 2000) built = timed(() => createTerrain(L));
const terrain: GeneratedTerrain = built.result;

/** Every paved feature: streets and car parks. */
const paved = features.filter((f) => f.type === 'street' || f.type === 'road' || f.type === 'parking');
const col = featuresOf('ridge').find((r) => r.profile === 'mound' && r.points[0].s < 600)!;
const colS = (col.points[0].s + col.points[col.points.length - 1].s) / 2;
const ravines = featuresOf('ravine');

/** True when (s, d) lies within `m` metres of a street, road or car park. */
const nearRoad = (s: number, d: number, m: number): boolean =>
  paved.some((f) => featureContains(f, s, d, terrain.course.halfWidthAt(s), m));

describe('alpine pass: an open mountainside that makes sense', () => {
  it('passes every level-design check (incl. a way to the sea) and builds in under 2 s CPU', () => {
    expect(validateLevel(terrain)).toEqual([]);
    expect(built.ms).toBeLessThan(2000);
    expect(terrain.grid.cols * terrain.grid.rows).toBeLessThan(250_000);
    expect(buildObstacleSpecs(terrain, L.seed).length).toBeLessThanOrEqual(250);
    for (const o of L.obstacles) {
      if (isStructureKind(o.kind)) expect(structureDef(o.kind), o.kind).toBeDefined();
    }
  });

  it('is the wide alpine face: relief, ridges, ravines, cliff bands, a 40 t iceberg', () => {
    expect(L.theme).toBe('alpine');
    expect(L.iceberg).toEqual({ scale: 1.1, mass: 40 });
    expect(L.relief).toBeDefined();
    expect(terrain.course.halfWidthAt(600)).toBeGreaterThan(150);
    expect(L.cliffs.length).toBeGreaterThanOrEqual(3);
    for (const c of L.cliffs) expect(c.width, `band at s=${c.s}`).toBeDefined();
    expect(ravines.length).toBeGreaterThanOrEqual(2);
    expect(ravines.every((r) => r.fatal !== false)).toBe(true);
    expect(featuresOf('ridge').filter((r) => r.profile !== 'mound').length).toBeGreaterThanOrEqual(3);
    expect(featuresOf('gully').filter((g) => g.closed).length).toBeGreaterThanOrEqual(2);
    expect(featuresOf('stream').length).toBeGreaterThanOrEqual(1);
    expect(find('skiLiftPylon').length).toBeGreaterThanOrEqual(4);
    expect(find('roadBridge')).toHaveLength(1);
    expect(find('chalet').length).toBeGreaterThanOrEqual(3);
    const finish = terrain.course.toWorld(L.finishS, 0);
    expect(terrain.isOcean(finish.x, finish.z)).toBe(true);
  });

  it('puts vehicles on streets or car parks, buildings by roads and fences along them', () => {
    expect(validateVehiclePlacements(terrain)).toEqual([]);
    for (const o of L.obstacles) {
      const at = `${o.kind} at s=${o.s} d=${o.d}`;
      const building = ['chalet', 'barn', 'silo', 'church'].includes(o.kind);
      if (building) expect(nearRoad(o.s, o.d, 60), at).toBe(true);
      if (o.kind === 'fence' || o.kind === 'guardrail') expect(nearRoad(o.s, o.d, 10), at).toBe(true);
    }
    // The road bridge spans the Devil's Cut and connects: its deck carries a street (carve: false) whose
    // two ends are where carved streets arrive on the rims.
    const bridge = find('roadBridge')[0];
    const hw = terrain.course.halfWidthAt(bridge.s);
    expect(ravines.some((r) => featureContains(r, bridge.s, bridge.d, hw))).toBe(true);
    const streets = featuresOf('street');
    const deck = streets.find((f) => f.carve === false)!;
    expect(deck).toBeDefined();
    const ends = [deck.points[0], deck.points[deck.points.length - 1]];
    for (const e of ends) {
      expect(Math.abs(e.d - bridge.d)).toBeLessThan(2);
      expect(Math.abs(e.s - bridge.s)).toBeLessThanOrEqual(bridge.span! / 2);
      const meets = streets.some((f) => f !== deck && f.carve !== false &&
        [f.points[0], f.points[f.points.length - 1]].some((q) => Math.hypot(q.s - e.s, q.d - e.d) < 2));
      expect(meets, `a road arrives at the deck end s=${e.s}`).toBe(true);
    }
    // Streets bend (no road grid): at least one has a bend sharper than 45°.
    const bends = featuresOf('street').some((f) =>
      f.points.slice(2).some((c, i) => {
        const a = f.points[i];
        const b = f.points[i + 1];
        const t1 = Math.atan2(b.d - a.d, b.s - a.s);
        const t2 = Math.atan2(c.d - b.d, c.s - b.s);
        return Math.abs(t2 - t1) > Math.PI / 4;
      }),
    );
    expect(bends).toBe(true);
  });

  it('the route search finds a way down and the designed dead ends', () => {
    const r = analyzeRoutes(terrain);
    expect(r.solvable).toBe(true);
    const near = (s: number, d: number, cause: 'ravine' | 'trap') =>
      r.deadEnds.find((e) => e.cause === cause && Math.hypot(e.s - s, e.d - d) < 60);
    // The Devil's Cut (open slope right of the gorge), the Couloir (slot by the ski run), the Tobel.
    expect(near(430, 180, 'ravine'), "Devil's Cut").toBeDefined();
    expect(near(360, -105, 'trap'), 'Couloir').toBeDefined();
    expect(near(970, 140, 'trap'), 'Tobel').toBeDefined();
  });
});

/** Slides the level's iceberg from (s, d) down-course at `speed`, no input, no melting. */
function slide(s: number, d: number, speed: number, ice: number, seconds: number) {
  const noMelt = { ...DEFAULT_ICEBERG_PARAMS, meltPerMetre: 0, meltPerRadian: 0 };
  const params = withLevelIceberg(noMelt, L.iceberg);
  const ib = createIceberg(terrain, params);
  setIce(ib, ice, params);
  const w = terrain.course.toWorld(s, d);
  const c = terrain.course.sampleAt(s);
  ib.pos.x = w.x;
  ib.pos.y = w.y;
  ib.pos.z = w.z;
  ib.vel.x = c.dirX * speed;
  ib.vel.z = c.dirZ * speed;
  const g = terrain.gradientAt(w.x, w.z);
  ib.vel.y = g.dx * ib.vel.x + g.dz * ib.vel.z;
  ib.heading = dirToHeading(c.dirX, c.dirZ);
  let maxS = s;
  for (let i = 0; i < seconds * 60; i++) {
    stepIceberg(ib, { steer: 0, source: 'scripted' }, terrain, FIXED_DT, params, 10 + i / 60);
    maxS = Math.max(maxS, terrain.course.project(ib.pos.x, ib.pos.z).s);
  }
  return { maxS, endS: terrain.course.project(ib.pos.x, ib.pos.z).s };
}

describe('alpine pass: the col', () => {
  it('rolls a slow, heavy iceberg back, while the line speed crests it', () => {
    // 90 t at 9 m/s, 30 m before the crest: what is left after the bait or the whole tongue.
    const slow = slide(colS - 30, 28, 9, 2.25, 15);
    expect(slow.maxS).toBeLessThan(colS + 5);
    expect(slow.endS).toBeLessThan(colS);
    // The line reaches the col at ≈ 18–20 m/s.
    expect(slide(colS - 30, 28, 17, 1, 6).maxS).toBeGreaterThan(colS + 30);
  });
});

interface Result {
  phase: string;
  reason: string | null;
  ice: number;
  endS: number;
  endD: number;
  stats: RunStats;
  /** Furthest any road bridge deck moved from where it was built (m). */
  deckMoved: number;
}

/** Plays with the real budget; `alt` replaces the line the autopilot follows; `at` teleports first. */
interface PlayOptions {
  alt?: CourseCoord[];
  steer?: (s: GameSession) => SteeringInput;
  at?: [number, number, number];
}

async function play(opts: PlayOptions = {}): Promise<Result> {
  const t = opts.alt ? { ...terrain, level: { ...L, line: opts.alt } } : terrain;
  const s = await GameSession.create({ level: L, skipIntro: true, terrain: t });
  if (opts.at) {
    const [s0, d0, v] = opts.at;
    const ice = s.iceberg;
    const w = terrain.course.toWorld(s0, d0);
    const c = terrain.course.sampleAt(s0);
    ice.pos.x = w.x;
    ice.pos.y = w.y;
    ice.pos.z = w.z;
    ice.vel.x = c.dirX * v;
    ice.vel.z = c.dirZ * v;
    const g = terrain.gradientAt(w.x, w.z);
    ice.vel.y = g.dx * ice.vel.x + g.dz * ice.vel.z;
    ice.heading = dirToHeading(c.dirX, c.dirZ);
  }
  const steer = opts.steer ?? ((x: GameSession) => autopilotSteer(x.iceberg, x.terrain));
  const decks = (s.physics as PhysicsWorld).bodies.filter((b) => b.kind === 'roadBridge' && b.part === 'deck');
  let deckMoved = 0;
  for (let n = 0; n < 150 * 60 && s.phase === 'playing'; n++) {
    s.update(FIXED_DT, steer(s));
    for (const b of decks) {
      deckMoved = Math.max(deckMoved, Math.hypot(b.pos.x - b.spawn.x, b.pos.y - b.spawn.y, b.pos.z - b.spawn.z));
    }
  }
  const p = terrain.course.project(s.iceberg.pos.x, s.iceberg.pos.z);
  const out = {
    phase: s.phase,
    reason: s.failReason,
    ice: s.iceberg.ice,
    endS: p.s,
    endD: p.d,
    stats: { ...s.stats },
    deckMoved,
  };
  s.dispose();
  return out;
}

const tell = (r: Result): string =>
  `${r.phase}${r.reason ? ` (${r.reason})` : ''} at s=${r.endS.toFixed(0)} d=${r.endD.toFixed(0)}`;

/** The level's line with the points in [s0, s1] replaced by `pts`. */
const splice = (s0: number, s1: number, pts: CourseCoord[]): CourseCoord[] => [
  ...line.filter((p) => p.s < s0),
  ...pts,
  ...line.filter((p) => p.s > s1),
];
const pts = (...a: [number, number][]): CourseCoord[] => a.map(([s, d]) => ({ s, d }));

/** The ski route: left of ridge L, the ski jump, the falls over the ravine's left arm, the village. */
const SKI = splice(31, 1430, pts(
  [70, -4], [120, -15], [165, -45], [215, -100], [250, -125], [285, -135], [300, -135], [330, -136],
  [345, -134], [380, -140], [440, -140], [500, -145], [530, -150], [560, -155], [600, -145], [640, -120],
  [700, -100], [740, -82], [760, -82], [800, -90], [830, -95], [860, -85], [960, -78], [1000, -80],
  [1044, -62], [1100, -55], [1178, -45], [1300, -30], [1420, -20],
));
/** The gorge route: the old road down the right side, under the viaduct, round the big falls' end. */
const GORGE = splice(31, 1430, pts(
  [60, 8], [100, 40], [160, 58], [200, 85], [240, 112], [265, 119], [690, 119], [740, 125], [760, 126],
  [800, 140], [850, 160], [1000, 168], [1040, 150], [1100, 128], [1150, 90], [1178, 85], [1300, 80],
  [1420, 75],
));

let lineRun: Promise<Result> | null = null;
const playLine = (): Promise<Result> => (lineRun ??= play());

describe('alpine pass: the way down (real water budget, chipping on)', () => {
  it('the intended line reaches the sea over three falls, having grown on glacier ice', async () => {
    const r = await playLine();
    expect(r.phase, tell(r)).toBe('complete');
    expect(r.ice).toBeGreaterThan(0.25);
    expect(r.ice).toBeLessThan(0.55);
    expect(r.stats.waterfallsCrossed).toBeGreaterThanOrEqual(3);
    expect(r.stats.absorbed).toBeGreaterThan(10);
    expect(r.stats.peakMass).toBeGreaterThan(L.iceberg!.mass);
    expect(r.stats.time).toBeLessThan(90);
  }, 180_000);

  it('two other routes reach the sea too: the ski run and the gorge road', async () => {
    const ski = await play({ alt: SKI });
    expect(ski.phase, `ski: ${tell(ski)}`).toBe('complete');
    expect(ski.stats.waterfallsCrossed).toBeGreaterThanOrEqual(3);
    const gorge = await play({ alt: GORGE });
    expect(gorge.phase, `gorge: ${tell(gorge)}`).toBe('complete');
  }, 240_000);

  it('wrong branches end the run: the Couloir traps, the Devil’s Cut swallows; the bridge carries', async () => {
    const none = (): SteeringInput => ({ steer: 0, source: 'none' });
    const couloir = await play({ at: [260, -103, 10], steer: none });
    expect(couloir.reason, tell(couloir)).toBe('stuck');
    expect(couloir.endS).toBeLessThan(440);
    // On the open slope right of the bridge road.
    const devil = await play({ at: [400, 196, 12], steer: none });
    expect(devil.reason, tell(devil)).toBe('fell');
    expect(devil.endD).toBeGreaterThan(140);
    // Down the bridge road itself the iceberg rides the road bridge over the Devil's Cut (a road
    // bridge carries it since playtest 2: src/core/physics/deckGround.ts) and slides on down the
    // bridge road, never touching the deck. It used to meet the girder end as a wall at road level
    // and stop there (stuck at s 480-490, every lane and speed). With no steering it then runs on
    // down to the right valley road and stalls on the flat by the lake (s ≈ 980): the bridge road
    // is a long way round on the ground, no way to the sea by itself.
    const road = await play({ at: [400, 178, 12], steer: none });
    expect(road.endS, tell(road)).toBeGreaterThan(600);
    expect(road.reason, tell(road)).not.toBe('fell');
    expect(road.deckMoved).toBeLessThan(0.5);
  }, 360_000);

  it('a naive centre line and a run with no input do not make it', async () => {
    const centre = await play({ steer: (s) => autopilotSteer(s.iceberg, s.terrain, { followLine: false }) });
    expect(centre.phase, `centre: ${tell(centre)}`).toBe('failed');
    const none = await play({ steer: () => ({ steer: 0, source: 'none' }) });
    expect(none.phase, `no input: ${tell(none)}`).toBe('failed');
  }, 240_000);

  it('the glacier tongue is a gamble: graze it and grow, swallow it (or the bait): stuck', async () => {
    const graze = await play({ alt: splice(370, 445, pts([380, 32], [400, 42], [410, 43], [435, 32])) });
    expect(graze.phase, `graze: ${tell(graze)}`).toBe('complete');
    expect(graze.ice).toBeGreaterThan((await playLine()).ice);
    const swallow = await play({ alt: splice(370, 445, pts([375, 35], [400, 48], [412, 49], [435, 34])) });
    expect(swallow.stats.peakMass).toBeGreaterThan(90);
    expect(swallow.reason, `swallow: ${tell(swallow)}`).toBe('stuck');
    expect(Math.abs(swallow.endS - colS)).toBeLessThan(40);
    const bait = await play({ alt: splice(420, 475, pts([425, 15], [450, 5], [475, 15])) });
    expect(bait.reason, `bait: ${tell(bait)}`).toBe('stuck');
    expect(Math.abs(bait.endS - colS)).toBeLessThan(40);
  }, 300_000);
});
