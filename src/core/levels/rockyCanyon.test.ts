import { describe, expect, it } from 'vitest';
import { FIXED_DT, GameSession, getTerrain } from '../session';
import { autopilotSteer } from '../autopilot';
import { dirToHeading } from '../math';
import { DEFAULT_ICEBERG_PARAMS } from '../sim/params';
import { buildObstacleSpecs } from '../obstacles/spawn';
import { isTreeKind } from '../obstacles/catalog';
import { createTerrain } from '../terrain/terrain';
import { validateLevel } from '../terrain/validate';
import type { GameEvent, LevelDef, ObstaclePlacement, TerrainFeature } from '../types';
import { rockyCanyon as level } from './rockyCanyon';
import { timed } from '../testing/timing';

type Feature<T extends TerrainFeature['type']> = Extract<TerrainFeature, { type: T }>;
const features = level.features ?? [];
const of = <T extends TerrainFeature['type']>(type: T): Feature<T>[] =>
  features.filter((f): f is Feature<T> => f.type === type);
const placed = (kind: ObstaclePlacement['kind']): ObstaclePlacement[] =>
  level.obstacles.filter((o) => o.kind === kind);

const gap = of('gap')[0];
const ramp = of('ramp')[0];
const basin = of('basin')[0];
const gapEnd = gap.s + gap.length;

/** The wide channel along the right wall, round the ravine through the bypass and the rubble. */
const SAFE_LINE: LevelDef['line'] = [
  ...(level.line ?? []).filter((p) => p.s <= 140),
  { s: 160, d: -2 },
  { s: 178, d: 0 },
  { s: 205, d: 8 },
  { s: 228, d: 14 },
  { s: 250, d: 19 },
  { s: 330, d: 21 },
  { s: 368, d: 21 },
  { s: 392, d: 16 },
  { s: 415, d: 15 },
  { s: 432, d: 11 },
  { s: 445, d: 3 },
  { s: 470, d: -2 },
  { s: 490, d: 0 },
  ...(level.line ?? []).filter((p) => p.s > 490),
];

describe('rocky canyon layout', () => {
  it('passes every level-design check and builds its terrain in under 2 s', () => {
    const { result: terrain, ms } = timed(() => createTerrain(level));
    expect(validateLevel(terrain)).toEqual([]);
    expect(ms).toBeLessThan(2000);
  });

  it('spawns a bounded number of bodies, every placement included (no pending kinds)', () => {
    const terrain = getTerrain(level);
    const specs = buildObstacleSpecs(terrain, level.seed);
    expect(specs.length).toBeLessThanOrEqual(250);
    level.obstacles.forEach((o, i) => {
      expect(specs.some((s) => s.placement === i), `${o.kind} at s=${o.s}`).toBe(true);
    });
  });

  it('has the canyon set pieces: steep chutes, three rising falls, two islands, the ravine', () => {
    const terrain = getTerrain(level);
    const floor = (s: number): number => terrain.course.sampleAt(s).floor;
    const slope = (a: number, b: number): number => (floor(a) - floor(b)) / (b - a);
    expect(level.theme).toBe('canyon');
    expect(level.iceberg).toEqual({ scale: 1, mass: 30 });
    expect(level.coastS - level.startS).toBeGreaterThan(850);
    expect(slope(40, 160)).toBeGreaterThan(0.17);
    expect(slope(550, 760)).toBeGreaterThan(0.17);
    expect(level.cliffs.map((c) => c.drop)).toEqual([10, 14, 22]);
    expect(of('island')).toHaveLength(2);
    // The kicker's lip is the ravine's take-off edge, and the ravine leaves a bypass.
    expect(ramp.s).toBe(gap.s);
    expect(gap.width).toBeDefined();
    expect(placed('footbridge')).toHaveLength(2);
    expect(placed('logPile').length).toBeGreaterThanOrEqual(3);
    expect(placed('stoneBarrier').length).toBeGreaterThanOrEqual(2);
    expect(placed('boulder').length).toBeGreaterThanOrEqual(6);
    expect(placed('pine').length).toBeGreaterThanOrEqual(5);
    expect(level.finishS).toBe(level.coastS + 20);
    const beach = terrain.course.toWorld(level.coastS - 15, 0);
    expect(terrain.surfaceAt(beach.x, beach.z)).toBe('sand');
  });

  it('never puts two trees so close that the iceberg could wedge between them', () => {
    const trees = level.obstacles.filter((o) => isTreeKind(o.kind));
    for (const a of trees) {
      for (const b of trees) {
        if (a !== b) expect(Math.hypot(a.s - b.s, a.d - b.d), `s=${a.s}/${b.s}`).toBeGreaterThan(7.5);
      }
    }
  });
});

// --- headless sessions ---------------------------------------------------------------------------

const noMelt: LevelDef = { ...level, water: undefined };
const noMeltParams = { ...DEFAULT_ICEBERG_PARAMS, meltPerMetre: 0, meltPerRadian: 0 };

/** Puts the iceberg at (s, d) moving down-course at `speed`. */
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
}

/** Arc length of an event position. */
const along = (e: Extract<GameEvent, { pos: unknown }>): number =>
  getTerrain(level).course.project(e.pos.x, e.pos.z).s;

interface Run {
  phase: string;
  reason: string | null;
  time: number;
  ice: number;
  endS: number;
  stats: GameSession['stats'];
  events: readonly GameEvent[];
}

async function drive(
  steer: (s: GameSession) => number,
  opts: { lv?: LevelDef; seconds?: number; setup?: (s: GameSession) => void } = {},
): Promise<Run> {
  const lv = opts.lv ?? level;
  const session = await GameSession.create({
    level: lv,
    terrain: getTerrain(level),
    skipIntro: true,
    params: lv.water ? undefined : noMeltParams,
  });
  opts.setup?.(session);
  const steps = (opts.seconds ?? 150) * 60;
  for (let i = 0; i < steps && session.phase === 'playing'; i++) {
    session.update(FIXED_DT, { steer: steer(session), source: 'scripted' });
  }
  const ice = session.iceberg;
  const run: Run = {
    phase: session.phase,
    reason: session.failReason,
    time: session.stats.time,
    ice: ice.ice,
    endS: session.terrain.course.project(ice.pos.x, ice.pos.z).s,
    stats: { ...session.stats },
    events: [...session.events.log],
  };
  session.dispose();
  return run;
}

const followLine = (line?: LevelDef['line']) => (s: GameSession): number =>
  autopilotSteer(s.iceberg, line ? { ...s.terrain, level: { ...s.terrain.level, line } } : s.terrain).steer;
const lane = (d: number) => (s: GameSession): number =>
  autopilotSteer(s.iceberg, s.terrain, { followLine: false, lane: d }).steer;

describe('rocky canyon traps (no melting)', () => {
  /** Approaches the kicker on its axis from 30 m out at `speed`. */
  const jump = async (speed: number) => {
    const run = await drive(lane(ramp.d), {
      lv: noMelt,
      seconds: 25,
      setup: (s) => place(s, ramp.s - 29.5, ramp.d, speed),
    });
    return { run, air: run.events.find((e) => e.type === 'airborne') };
  };

  it('the ravine swallows an iceberg too slow off the kicker: it falls in and the run ends', async () => {
    const { run, air } = await jump(14);
    expect(air && air.type === 'airborne' ? air.speed : 99).toBeLessThan(14);
    expect(run.phase).toBe('failed');
    expect(run.reason).toBe('fell');
    expect(run.endS).toBeGreaterThan(gap.s);
    expect(run.endS).toBeLessThan(gapEnd);
    // ~3 s up to the lip, the plunge and the beat: no longer ~10 s of the stuck timer on top.
    expect(run.time).toBeLessThan(6.5);
  });

  it('a fast take-off (≥ 14 m/s) clears the ravine and lands on the far side', async () => {
    const terrain = getTerrain(level);
    const session = await GameSession.create({
      level: noMelt,
      terrain,
      skipIntro: true,
      params: noMeltParams,
    });
    place(session, ramp.s - 29.5, ramp.d, 18);
    const landings: number[] = [];
    let takeoff = 0;
    session.events.on((e) => {
      if (e.type === 'airborne' && takeoff === 0) takeoff = e.speed;
      if (e.type === 'landed') landings.push(along(e));
    });
    for (let i = 0; i < 5 * 60 && session.phase === 'playing'; i++) {
      session.update(FIXED_DT, { steer: lane(ramp.d)(session), source: 'scripted' });
      if (landings.length > 0) break;
    }
    expect(takeoff).toBeGreaterThan(14);
    expect(landings[0]).toBeGreaterThan(gapEnd + 2);
    for (let i = 0; i < 2 * 60 && session.phase === 'playing'; i++) {
      session.update(FIXED_DT, { steer: lane(ramp.d)(session), source: 'scripted' });
    }
    const ice = session.iceberg;
    expect(session.phase).toBe('playing');
    // Past the ravine and up on the far floor where it now is, not down in the 7 m deep gap.
    const sNow = terrain.course.project(ice.pos.x, ice.pos.z).s;
    expect(sNow).toBeGreaterThan(gapEnd + 5);
    expect(ice.pos.y).toBeGreaterThan(terrain.course.sampleAt(sNow).floor - 3);
    expect(Math.hypot(ice.vel.x, ice.vel.z)).toBeGreaterThan(14);
    session.dispose();
  });

  it('the sinkhole keeps a slow iceberg until it is stuck, while a fast one rides out of it', async () => {
    const slow = await drive(() => 0, {
      lv: noMelt,
      seconds: 60,
      setup: (s) => place(s, basin.s - basin.radius - 1, basin.d, 4),
    });
    expect(slow.phase).toBe('failed');
    expect(slow.reason).toBe('stuck');
    expect(Math.abs(slow.endS - basin.s)).toBeLessThan(basin.radius);
    const fast = await drive(lane(basin.d), {
      lv: noMelt,
      seconds: 4,
      setup: (s) => place(s, basin.s - 38, basin.d, 20),
    });
    expect(fast.phase).toBe('playing');
    expect(fast.endS).toBeGreaterThan(basin.s + 30);
  });
});

describe('rocky canyon balance (real water budget and chipping)', () => {
  it('has a water budget that lasts a straight run but not a careless one', () => {
    const water = level.water!;
    const run = level.coastS - level.startS;
    expect(water.metres).toBeGreaterThan(1.1 * run);
    expect(water.metres).toBeLessThan(2 * run);
    expect(water.turnMetresPerRadian).toBeGreaterThan(0);
  });

  let line: Run | undefined;
  const lineRun = async (): Promise<Run> => (line ??= await drive(followLine()));

  it('the intended line jumps the ravine and reaches the sea with ~25–35 % ice', async () => {
    const r = await lineRun();
    expect(r.phase, `ended at s=${r.endS.toFixed(0)} (${r.reason})`).toBe('complete');
    expect(r.ice).toBeGreaterThan(0.22);
    expect(r.ice).toBeLessThan(0.38);
    expect(r.time).toBeLessThan(55);
    expect(r.stats.waterfallsCrossed).toBe(3);
    expect(r.stats.buildingsDestroyed).toBeGreaterThanOrEqual(1);
    // The ravine was jumped off the kicker: airborne at its lip, down beyond its far edge.
    const offLip = r.events.findIndex((e) => e.type === 'airborne' && Math.abs(along(e) - ramp.s) < 4);
    expect(offLip).toBeGreaterThanOrEqual(0);
    const down = r.events.slice(offLip).find((e) => e.type === 'landed');
    expect(down && down.type === 'landed' ? along(down) : 0).toBeGreaterThan(gapEnd);
  });

  it('a naive centreline falls into the ravine; a no-input run is far worse than the line', async () => {
    const centre = await drive((s) => autopilotSteer(s.iceberg, s.terrain, { followLine: false }).steer);
    expect(centre.phase).toBe('failed');
    expect(centre.reason).toBe('fell');
    expect(centre.endS).toBeGreaterThan(gap.s);
    expect(centre.endS).toBeLessThan(gapEnd + 2);
    const best = await lineRun();
    const none = await drive(() => 0);
    const worse = none.phase !== 'complete' || (none.time > best.time * 1.15 && none.ice < best.ice);
    const msg = `no input: ${none.phase} ${none.time.toFixed(1)} s, ice ${none.ice.toFixed(2)}`;
    expect(worse, msg).toBe(true);
  });

  it('the safe route (wide channel, bypass) also finishes, with less ice than the line', async () => {
    const safe = await drive(followLine(SAFE_LINE));
    const best = await lineRun();
    expect(safe.phase, `ended at s=${safe.endS.toFixed(0)} (${safe.reason})`).toBe('complete');
    expect(safe.ice).toBeLessThan(best.ice);
    expect(safe.ice).toBeGreaterThan(0.1);
  });
});
