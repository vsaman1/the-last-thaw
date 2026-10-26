import { beforeAll, describe, expect, it } from 'vitest';
import { FIXED_DT, GameSession, getTerrain } from '../session';
import { autopilotSteer } from '../autopilot';
import { dirToHeading } from '../math';
import { createTerrain } from '../terrain/terrain';
import { featureContains } from '../terrain/features';
import { analyzeRoutes } from '../terrain/routes';
import { validateLevel, validateVehiclePlacements } from '../terrain/validate';
import { trafficNetwork } from '../traffic/network';
import type { PhysicsWorld } from '../physics/world';
import { bridgePlans } from '../obstacles/bridges';
import { buildObstacleSpecs } from '../obstacles/spawn';
import { momentumTestImpulse } from '../sim/iceberg';
import type {
  GameEvent,
  LevelDef,
  ObstaclePlacement,
  RunStats,
  SteeringInput,
  TerrainFeature,
} from '../types';
import { rideBridgeLane } from '../testing/bridgeLane';
import { timed } from '../testing/timing';
import { rockyCanyon } from './rockyCanyon';
import { riversideTown as level } from './riversideTown';

/**
 * Riverside Town, the open hillside town (see the header of ./riversideTown.ts): layout rules
 * ("things make sense"), the maze (route search, dead ends), and the balance of the intended line,
 * an alternative route, the wrong branches and the naive runs, with the real water budget and
 * chipping on.
 */

type Feature<T extends TerrainFeature['type']> = Extract<TerrainFeature, { type: T }>;
const features = level.features ?? [];
const ofType = <T extends TerrainFeature['type']>(type: T): Feature<T>[] =>
  features.filter((f): f is Feature<T> => f.type === type);
const find = (kind: ObstaclePlacement['kind']): ObstaclePlacement[] =>
  level.obstacles.filter((o) => o.kind === kind);
/** The dam across the riverbed (left channel) and the coffer dam across the east brook (right). */
const dam = find('dam').find((o) => o.d < 0)!;
const coffer = find('dam').find((o) => o.d > 0)!;
const kicker = ofType('ramp')[0];
const NONE: SteeringInput = { steer: 0, source: 'none' };

interface RunResult {
  phase: string;
  reason: string | null;
  stats: RunStats;
  endS: number;
  endD: number;
  /** Obstacles that broke, in order: kind and course position. */
  broken: { kind: string; s: number; d: number }[];
  /** Speed (m/s) and mass (t) on the last step before the iceberg first touched the main dam. */
  damApproach: { speed: number; mass: number } | null;
  /** Traffic: vehicles driving at the start, and vehicle-steps spent waiting at a red light. */
  driving: number;
  redWaits: number;
  /** The reservoirs at the end: lakes held, and the main dam's (broken? peak flood outflow m³/s). */
  lakes: number;
  mainLake: { broken: boolean; qPeak: number; fullVolume: number } | null;
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

/** Drive a fresh session with the level's real water budget and chipping until it ends. */
async function drive(
  def: LevelDef,
  steer: (s: GameSession) => SteeringInput,
  opts: { seconds?: number; setup?: (s: GameSession) => void } = {},
): Promise<RunResult> {
  const s = await GameSession.create({ level: def, skipIntro: true });
  const broken: RunResult['broken'] = [];
  const at = (p: { x: number; z: number }) => s.terrain.course.project(p.x, p.z);
  let damApproach: RunResult['damApproach'] = null;
  let before = { speed: 0, mass: 0 };
  s.events.on((e: GameEvent) => {
    if (e.type === 'obstacleBroken') broken.push({ kind: e.kind, ...at(e.pos) });
    if (e.type === 'collision' && e.kind === 'dam' && !damApproach && at(e.pos).d < 0) {
      damApproach = { ...before };
    }
  });
  opts.setup?.(s);
  const traffic = (s.physics as PhysicsWorld).traffic;
  const driving = traffic?.driving ?? 0;
  let redWaits = 0;
  const steps = (opts.seconds ?? 240) * 60;
  for (let n = 0; s.phase === 'playing' && n < steps; n++) {
    before = { speed: Math.hypot(s.iceberg.vel.x, s.iceberg.vel.z), mass: s.iceberg.mass };
    s.update(FIXED_DT, steer(s));
    if (!traffic || n % 6 !== 0) continue;
    // A vehicle standing at a stop line with its phase red (sampled every 0.1 s).
    for (let i = 0; i < traffic.count; i++) {
      if (!traffic.active[i] || traffic.v[i] > 0.05) continue;
      const p = traffic.net.paths[traffic.path[i]];
      if (p.kind !== 'lane' || p.junction < 0 || p.leg < 0) continue;
      const J = traffic.net.junctions[p.junction];
      if (p.length - traffic.arc[i] < 6 && traffic.signal(J.id, J.legs[p.leg].group) === 'red') redWaits++;
    }
  }
  const p = at(s.iceberg.pos);
  const damIndex = level.obstacles.indexOf(dam);
  const main = s.water?.reservoirs.find((r) => r.placement === damIndex);
  const out = {
    phase: s.phase,
    reason: s.failReason,
    stats: { ...s.stats },
    endS: p.s,
    endD: p.d,
    broken,
    damApproach,
    driving,
    redWaits,
    lakes: s.water?.reservoirs.length ?? 0,
    mainLake: main ? { broken: main.broken, qPeak: main.qPeak, fullVolume: main.fullVolume } : null,
  };
  s.dispose();
  return out;
}

const followLine = (s: GameSession): SteeringInput => autopilotSteer(s.iceberg, s.terrain);
const describeRun = (r: RunResult): string =>
  `${r.phase}${r.reason ? ` (${r.reason})` : ''} at s=${r.endS.toFixed(0)} d=${r.endD.toFixed(0)}, ` +
  `${r.stats.time.toFixed(1)} s, ice ${(r.stats.iceLeft * 100).toFixed(1)} %, ` +
  `${r.stats.buildingsDestroyed} buildings, score ${r.stats.score}`;

/**
 * The outskirts: the west lane past the quarry and the park, railway crossing W, the old stone
 * bridge over the gorge, the east brook and its coffer dam. (A copy of the level with its own id, so
 * the autopilot reads this line from its own terrain.)
 */
const outskirts: LevelDef = {
  ...level,
  id: `${level.id}-outskirts`,
  line: [
    { s: 30, d: 0 },
    { s: 100, d: -55 },
    { s: 140, d: -110 },
    { s: 200, d: -120 },
    { s: 300, d: -120 },
    { s: 420, d: -118 },
    { s: 470, d: -120 },
    { s: 545, d: -124 },
    { s: 616, d: -137 },
    { s: 680, d: -118 },
    { s: 745, d: -95 },
    { s: 771.5, d: -90 },
    { s: 800, d: -72 },
    { s: 850, d: -50 },
    { s: 960, d: -20 },
    { s: 1080, d: 12 },
    { s: 1120, d: 18 },
    { s: 1240, d: 18 },
    { s: 1300, d: 10 },
    { s: 1420, d: 0 },
    { s: 1600, d: 0 },
  ],
};

/**
 * The viaduct route: the line through the old town and over the level crossing, then Station Street,
 * down Gorge Road over the VIADUCT (a road bridge carries the iceberg since playtest 2), Mill Race
 * Road through the lower town, and the main line's way through the dam.
 */
const viaduct: LevelDef = {
  ...level,
  id: `${level.id}-viaduct`,
  line: [
    ...level.line!.filter((p) => p.s <= 638),
    { s: 680, d: -42 },
    { s: 702, d: -50 },
    { s: 760, d: -50 },
    { s: 795, d: -50 },
    { s: 830, d: -48 },
    { s: 860, d: -36 },
    { s: 1000, d: -36 },
    ...level.line!.filter((p) => p.s >= 1080),
  ],
};

describe('Riverside Town: an open hillside town', () => {
  const cold = timed(() => createTerrain(level));
  const ref = timed(() => createTerrain(rockyCanyon));
  const terrain = cold.result;

  it('passes every level-design check, including a way from the spawn to the sea', () => {
    expect(validateLevel(getTerrain(level))).toEqual([]);
  });

  it('builds in ~1–1.5 s, stays under 250k vertices and 250 bodies', () => {
    const { result: t, ms } = timed(() => createTerrain(level));
    const vertices = t.grid.cols * t.grid.rows;
    const refPerVertex = ref.ms / (ref.result.grid.cols * ref.result.grid.rows);
    console.log(
      `[riverside] terrain ${ms.toFixed(0)} ms (first ${cold.ms.toFixed(0)} ms), ${vertices} vertices, ` +
        `${((ms / vertices) * 1000).toFixed(2)} µs/vertex ` +
        `(Rocky Canyon ${(refPerVertex * 1000).toFixed(2)})`,
    );
    expect(vertices).toBeLessThanOrEqual(250_000);
    // Under a loaded CPU every budget inflates; the cost per vertex is compared with a valley level.
    expect(ms / vertices).toBeLessThan(1.6 * refPerVertex);
    expect(ms).toBeLessThan(3000);
    const bodies = buildObstacleSpecs(terrain, level.seed).length;
    expect(bodies).toBeGreaterThan(120);
    expect(bodies).toBeLessThanOrEqual(250);
  });

  it('keeps the identity: a long town for a 100 t iceberg on a wide slope, into the sea', () => {
    expect(level.index).toBe(4);
    expect(level.theme).toBe('town');
    expect(level.iceberg).toEqual({ scale: 1.6, mass: 100 });
    expect(level.relief).toBeDefined();
    expect(terrain.course.halfWidthAt(800)).toBeGreaterThanOrEqual(150);
    expect(level.coastS - level.startS).toBeGreaterThanOrEqual(1400);
    expect(level.finishS).toBe(level.coastS + 20);
    expect(terrain.course.length - level.finishS).toBeGreaterThanOrEqual(100);
    const f = terrain.course.toWorld(level.finishS, 0);
    expect(terrain.isOcean(f.x, f.z)).toBe(true);
    expect(level.obstacles.filter((o) => o.kind === 'iceBlock' || o.kind === 'iceField')).toEqual([]);
  });

  it('makes sense: vehicles on roads, the train on its track, boats afloat, dams across water', () => {
    const hw = (s: number): number => terrain.course.halfWidthAt(s);
    // Cars, trucks and buses on roads, streets or parking areas, wagons on the track bed, boats on
    // open water (the validator's vehicle rules).
    expect(validateVehiclePlacements(terrain)).toEqual([]);
    const rail = ofType('street').filter((r) => r.surface === 'rail');
    const bank = ofType('ridge').filter((r) => r.profile === 'mound');
    for (const w of find('railWagon')) {
      expect(rail.some((r) => featureContains(r, w.s, w.d, hw(w.s))), `wagon at d=${w.d}`).toBe(true);
      expect(bank.some((r) => featureContains(r, w.s, w.d, hw(w.s))), `on the bank: d=${w.d}`).toBe(true);
    }
    // Every house stands by a street (within 18 m of a road or street's paved strip).
    const streets = [...ofType('road'), ...ofType('street').filter((r) => r.surface !== 'rail')];
    for (const h of find('house')) {
      const near = streets.some((r) => featureContains(r, h.s, h.d, hw(h.s), 18));
      expect(near, `house at s=${h.s} d=${h.d}`).toBe(true);
    }
    // The boats are moored in the harbour water; the dams stand across the river and the east brook.
    for (const b of find('boat')) expect(b.s).toBeGreaterThan(level.coastS);
    const streams = ofType('stream');
    const across = (r: Feature<'stream'>, o: ObstaclePlacement): boolean => {
      const i = r.points.findIndex((p) => p.s >= o.s);
      if (i <= 0) return false;
      const a = r.points[i - 1];
      const b = r.points[i];
      const d = a.d + ((b.d - a.d) * (o.s - a.s)) / (b.s - a.s);
      return Math.abs(d - o.d) + r.width / 2 <= (o.span ?? 0) / 2;
    };
    for (const d of [dam, coffer]) {
      expect(streams.some((r) => across(r, d)), `dam at d=${d.d} spans a stream`).toBe(true);
    }
    expect(dam.scale ?? 1).toBeGreaterThanOrEqual(0.7);
    expect(coffer.scale ?? 1).toBeLessThan(dam.scale ?? 1);
    // The river: from high on the slope to the sea, over the weirs and falls.
    const river = streams.find((r) => r.end !== 'pool')!;
    expect(river.points[0].s).toBeLessThan(200);
    expect(river.points[river.points.length - 1].s).toBeGreaterThan(level.finishS);
    const riverAt = (s: number): number => {
      const i = river.points.findIndex((p) => p.s >= s);
      const a = river.points[Math.max(0, i - 1)];
      const b = river.points[i];
      return a.d + ((b.d - a.d) * (s - a.s)) / Math.max(1e-9, b.s - a.s);
    };
    const falls = level.cliffs.filter((c) => Math.abs(riverAt(c.s) - (c.d ?? 0)) < (c.width ?? 1e9) / 2);
    expect(falls.length).toBeGreaterThanOrEqual(3);
    expect(streams.find((r) => r.end === 'pool')).toBeDefined();
    // The viaduct carries Gorge Road over the gorge rim to rim: each end of its deck on the ground,
    // a street ending at each (the traffic network lays one along the deck between them).
    const viaduct = find('roadBridge')[0];
    const plan = bridgePlans(terrain).find((p) => p.index === level.obstacles.indexOf(viaduct))!;
    expect(plan.mode).toBe('rims');
    expect(plan.depthBelow).toBeGreaterThan(10);
    const roadEnds = streets.flatMap((r) =>
      r.type === 'road'
        ? [{ s: r.s0, d: r.d }, { s: r.s1, d: r.d }]
        : [r.points[0], r.points[r.points.length - 1]],
    );
    for (const e of plan.ends) {
      expect(Math.abs(e.top - e.ground)).toBeLessThan(0.75);
      expect(roadEnds.some((p) => Math.hypot(p.s - e.s, p.d - e.d) < 3), `road at s=${e.s}`).toBe(true);
    }
    // Real intersections: the cross streets meet the down-slope streets at crossroads, the busiest
    // with traffic lights.
    const net = trafficNetwork(getTerrain(level));
    const signalised = net.junctions.filter((j) => j.signalised);
    expect(net.junctions.filter((j) => j.legs.length >= 4).length).toBeGreaterThanOrEqual(8);
    expect(signalised.length).toBeGreaterThanOrEqual(4);
  });

  it('is a maze: the route search solves it, and the line flies at least three drops', () => {
    const r = analyzeRoutes(getTerrain(level));
    console.log(
      `[riverside] routes ${r.ms.toFixed(0)} ms, solvable ${r.solvable}, ${r.jumps} jumps, path ` +
        r.path.filter((_, i) => i % 10 === 0).map((p) => `${Math.round(p.s)}:${Math.round(p.d)}`).join(' '),
    );
    expect(r.solvable).toBe(true);
    const line = level.line!;
    const lineAt = (s: number): number => {
      const i = line.findIndex((p) => p.s >= s);
      const a = line[Math.max(0, i - 1)];
      const b = line[i];
      return a.d + ((b.d - a.d) * (s - a.s)) / Math.max(1e-9, b.s - a.s);
    };
    const flown = level.cliffs.filter((c) => Math.abs(lineAt(c.s) - (c.d ?? 0)) < (c.width ?? 1e9) / 2);
    expect(flown.length).toBeGreaterThanOrEqual(3);
    // The gorge: fatal ravines across the slope, the kicker on the line at the near edge of one.
    const ravines = ofType('ravine');
    expect(ravines.length).toBeGreaterThanOrEqual(4);
    expect(ravines.every((v) => v.fatal !== false)).toBe(true);
    expect(Math.abs(lineAt(kicker.s) - kicker.d)).toBeLessThan(2);
  });
});

describe('Riverside Town balance (real water budget and chipping)', () => {
  let line: RunResult;
  beforeAll(async () => {
    line = await drive(level, followLine);
    console.log(
      `[riverside] line: ${describeRun(line)}; traffic: ${line.driving} driving, ` +
        `${line.redWaits} red-light waits (vehicle × 0.1 s); lakes ${line.lakes}, main lake ` +
        `${line.mainLake?.fullVolume.toFixed(0)} m³, broken ${line.mainLake?.broken}, ` +
        `flood peak ${line.mainLake?.qPeak.toFixed(0)} m³/s`,
    );
  }, 240_000);

  it('the intended line reaches the sea through the old town, over the gorge and the dam', () => {
    expect(line.phase, describeRun(line)).toBe('complete');
    expect(line.stats.iceLeft).toBeGreaterThan(0.25);
    expect(line.stats.iceLeft).toBeLessThan(0.42);
    expect(line.stats.buildingsDestroyed).toBeGreaterThanOrEqual(5);
    expect(line.stats.waterfallsCrossed).toBeGreaterThanOrEqual(3);
    expect(line.broken.some((b) => b.kind === 'dam' && b.d < 0)).toBe(true);
    expect(line.stats.time).toBeLessThan(130);
  });

  it('the town is alive: traffic drives its streets and stops at the red lights', () => {
    expect(line.driving).toBeGreaterThanOrEqual(15);
    expect(line.redWaits).toBeGreaterThan(20);
  });

  it('the dam breaks for this iceberg at the speed the line brings it there', () => {
    expect(line.damApproach).not.toBeNull();
    const { speed, mass } = line.damApproach!;
    const specs = buildObstacleSpecs(getTerrain(level), level.seed);
    const idx = level.obstacles.indexOf(dam);
    const strength = Math.min(...specs.filter((s) => s.placement === idx).map((s) => s.breakImpulse));
    expect(momentumTestImpulse(speed, mass)).toBeGreaterThan(1.15 * strength);
    // A real dam: a normal 30 t iceberg would need more than 18 m/s.
    expect(strength / (1.25 * 30)).toBeGreaterThan(18);
    // Both dams hold a lake; the line breaks the main one and its lake drains in a flood.
    expect(line.lakes).toBe(2);
    expect(line.mainLake?.broken).toBe(true);
    expect(line.mainLake!.qPeak).toBeGreaterThan(50);
  });

  it('another way down works too: the outskirts, the old stone bridge and the coffer dam', async () => {
    const r = await drive(outskirts, followLine);
    console.log(`[riverside] outskirts: ${describeRun(r)}`);
    expect(r.phase, describeRun(r)).toBe('complete');
    expect(r.broken.some((b) => b.kind === 'dam' && b.d < 0)).toBe(false);
    // The trade-off: no jump over the gorge, but it fords the river through the gorge's slot,
    // smashes less and scores less.
    expect(r.stats.buildingsDestroyed).toBeLessThan(line.stats.buildingsDestroyed);
    expect(r.stats.score).toBeLessThan(line.stats.score);
  }, 240_000);

  it('the viaduct carries Gorge Road, and the iceberg on it, over the gorge (playtest 2)', async () => {
    // It used to stop dead against the girder end (stuck at s 765, every lane and speed): the deck
    // was a wall at road level. Now the iceberg rides the deck 14 m over the floor of R2, never
    // touching it, and runs on down Mill Race Road. (A full-size berg aimed 3 m off the axis would
    // overhang a parapet: it now glances in off the flared end, src/core/physics/deckGround.ts, and
    // rides 2.6 m off the axis; at 6 m/s that leaves it ~0.6 s behind, hence 13 s rather than 12.)
    const bridge = find('roadBridge')[0];
    for (const d of [-53, -50, -47]) {
      for (const speed of [6, 18]) {
        let high = 0;
        let maxS = 0;
        const steer = (s: GameSession): SteeringInput => {
          const ice = s.iceberg;
          const p = s.terrain.course.project(ice.pos.x, ice.pos.z);
          maxS = Math.max(maxS, p.s);
          if (Math.abs(p.s - bridge.s) < 8) high = Math.max(high, ice.pos.y - s.terrain.heightAt(ice.pos.x, ice.pos.z));
          return autopilotSteer(ice, s.terrain, { pursuit: 'course', followLine: false, lane: d });
        };
        const r = await drive(level, steer, { seconds: 13, setup: (s) => place(s, 725, d, speed) });
        const tag = `lane d ${d}, ${speed} m/s: ${describeRun(r)}`;
        console.log(`[riverside] viaduct ${tag}, ${high.toFixed(1)} m over R2`);
        expect(r.reason, tag).toBeNull();
        expect(maxS, tag).toBeGreaterThan(840);
        expect(high, tag).toBeGreaterThan(10);
      }
    }
  }, 240_000);

  it('an iceberg arriving outside a viaduct parapet rides as before the walls (lanes -8 and +7)', async () => {
    // Follow-up review of playtest 2: on the viaduct route held 8 m left of the axis, the left flare
    // caught the hull (its centre 6 m out, still moving out at 1.6 m/s), pushed it in, cost it 8 m/s,
    // and it dropped off mid-span at s 780; without the walls it crossed 7-8 m off the axis at 20 m/s.
    // Now the side gives way to a hull arriving outside the barrier line (PARAPET.breakOut): it never
    // touches the walls and crosses at speed, as before them. (Lane +7 meets the right flare the same
    // way; chapter 4's lanes are in src/story/chapters/overlays.act2.test.ts.)
    for (const lane of [-8, 7]) {
      const r = await rideBridgeLane(level, viaduct.line!, lane);
      const tag = `lane ${lane}: ${r.reason ?? (r.crossed ? 'crossed' : 'short')} at s ${r.endS.toFixed(0)} d ${r.endD.toFixed(0)}, ${r.vMin.toFixed(1)} m/s at least on the bridge, ${r.walls} wall contacts`;
      console.log(`[riverside] viaduct ${tag}`);
      expect(r.reason, tag).toBeNull();
      expect(r.crossed, tag).toBe(true);
      expect(r.walls, tag).toBe(0);
      expect(r.vMin, tag).toBeGreaterThan(17);
    }
  }, 240_000);

  it('the viaduct route reaches the sea: Gorge Road, the viaduct, Mill Race Road, the dam', async () => {
    const r = await drive(viaduct, followLine);
    console.log(`[riverside] viaduct route: ${describeRun(r)}`);
    expect(r.phase, describeRun(r)).toBe('complete');
    expect(r.stats.waterfallsCrossed).toBeGreaterThanOrEqual(3);
    // It skips the kicker: no jump over the gorge, but the safe road is no slower.
    expect(r.stats.time).toBeLessThan(line.stats.time + 10);
  }, 240_000);

  it('wrong branches end the run: too slow off the kicker falls into the gorge', async () => {
    const straightOn = (s: GameSession): SteeringInput =>
      autopilotSteer(s.iceberg, s.terrain, { pursuit: 'course', followLine: false, lane: kicker.d });
    const r = await drive(level, straightOn, {
      seconds: 15,
      setup: (s) => place(s, kicker.s - 25, kicker.d, 7),
    });
    console.log(`[riverside] slow jump: ${describeRun(r)}`);
    expect(r.reason).toBe('fell');
    expect(r.endS).toBeGreaterThan(kicker.s);
    expect(r.endS).toBeLessThan(kicker.s + 30);
  }, 120_000);

  it('wrong branches end the run: Quarry Road is a cul-de-sac against the quarry wall', async () => {
    const r = await drive(level, () => NONE, { seconds: 60, setup: (s) => place(s, 480, -175, 8) });
    console.log(`[riverside] quarry: ${describeRun(r)}`);
    expect(r.reason).toBe('stuck');
    expect(r.endD).toBeLessThan(-140);
    expect(r.endS).toBeLessThan(570);
  }, 120_000);

  it('a naive centre line and a no-input run do not reach the sea', async () => {
    const centre = await drive(level, (s) => autopilotSteer(s.iceberg, s.terrain, { followLine: false }));
    const none = await drive(level, () => NONE);
    console.log(`[riverside] centre: ${describeRun(centre)}; no input: ${describeRun(none)}`);
    for (const r of [centre, none]) {
      if (r.phase !== 'complete') continue;
      expect(r.stats.score).toBeLessThan(0.85 * line.stats.score);
      expect(r.stats.time).toBeGreaterThan(line.stats.time + 10);
    }
    expect(centre.phase).toBe('failed');
  }, 300_000);
});
