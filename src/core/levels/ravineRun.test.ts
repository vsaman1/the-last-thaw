import { describe, expect, it } from 'vitest';
import { FELL_BEAT, FIXED_DT, GameSession, getTerrain } from '../session';
import { autopilotSteer } from '../autopilot';
import { dirToHeading } from '../math';
import { DEFAULT_ICEBERG_PARAMS } from '../sim/params';
import { buildObstacleSpecs } from '../obstacles/spawn';
import { createTerrain } from '../terrain/terrain';
import { featureContains } from '../terrain/features';
import { analyzeRoutes } from '../terrain/routes';
import { validateLevel } from '../terrain/validate';
import type { GameEvent, LevelDef, ObstacleKind, TerrainFeature } from '../types';
import { timed } from '../testing/timing';
import { ravineRun as level } from './ravineRun';

/**
 * Level 7 "Ravine Run" (./ravineRun.ts): an open red-rock mountainside cut by six fatal ravines.
 * Layout and budgets, the route search, the jump thresholds that make momentum matter, the
 * intended line and two alternatives with the real water budget, the naive runs, the dead ends.
 */

type Feature<T extends TerrainFeature['type']> = Extract<TerrainFeature, { type: T }>;
const features = level.features ?? [];
const of = <T extends TerrainFeature['type']>(type: T): Feature<T>[] =>
  features.filter((f): f is Feature<T> => f.type === type);
const ramps = of('ramp');
/** The kicker whose lip is nearest arc length s. */
const kicker = (s: number): Feature<'ramp'> =>
  ramps.reduce((a, b) => (Math.abs(b.s - s) < Math.abs(a.s - s) ? b : a));
const K1 = kicker(255);
const K3 = kicker(615);
const K4 = kicker(800);
const K5 = kicker(970);
const K6 = kicker(1205);
/** The narrow crossing of R1 (8 m between 22 m parts, a rock lip on its rim). */
const N1 = { s: 255, d: -130 };

const NONE = 0;
const terrain = () => getTerrain(level);
const course = () => terrain().course;
const along = (e: GameEvent): number => {
  const pos = (e as { pos?: { x: number; z: number } }).pos;
  return pos ? course().project(pos.x, pos.z).s : NaN;
};

/**
 * Far edge (arc length) of the fatal cut the iceberg meets going down-course from s at lateral d:
 * where the ground a ravine lowered by 2 m or more ends again.
 */
function farEdge(s: number, d: number): number {
  const t = terrain();
  let inside = false;
  for (let x = s; x < s + 90; x += 0.5) {
    const w = t.course.toWorld(x, d);
    const cut = t.ravineDepthAt?.(w.x, w.z) ?? 0;
    if (cut >= 2) inside = true;
    else if (inside) return x;
  }
  return NaN;
}

// --- layout -------------------------------------------------------------------------------------

describe('ravine run layout', () => {
  it('passes every level-design check (incl. a way to the sea) and builds in < 2 s CPU', () => {
    timed(() => createTerrain(level)); // the first build in a worker also compiles the code
    const { result: t, ms } = timed(() => createTerrain(level));
    const vertices = t.grid.cols * t.grid.rows;
    console.log(`[ravine run] terrain ${ms.toFixed(0)} ms CPU, ${t.grid.cols}x${t.grid.rows} = ${vertices}`);
    expect(validateLevel(terrain())).toEqual([]);
    expect(ms).toBeLessThan(2000);
    expect(vertices).toBeLessThanOrEqual(250_000);
  }, 60_000);

  it('spawns a bounded number of bodies, every placement included', () => {
    const specs = buildObstacleSpecs(terrain(), level.seed);
    console.log(`[ravine run] ${specs.length} bodies from ${level.obstacles.length} placements`);
    expect(specs.length).toBeLessThanOrEqual(250);
    level.obstacles.forEach((o, i) => {
      expect(specs.some((s) => s.placement === i), `${o.kind} at s=${o.s}`).toBe(true);
    });
  });

  it('is an open canyon mountainside: six ravines, four cliff bands, a big set-piece jump', () => {
    const t = terrain();
    expect(level.theme).toBe('canyon');
    expect(level.iceberg).toEqual({ scale: 1, mass: 30 });
    expect(level.coastS - level.startS).toBeGreaterThan(1200);
    expect(level.coastS - level.startS).toBeLessThan(1500);
    expect(2 * t.course.sampleAt(600).halfWidth).toBeGreaterThanOrEqual(400);
    expect(level.relief).toBeDefined();
    // Every ravine crossing the slope is fatal; they come in six groups along s.
    const ravines = of('ravine');
    expect(ravines.every((r) => r.fatal !== false)).toBe(true);
    const groups = new Set(ravines.map((r) => Math.round(r.points[0].s / 100)));
    expect(groups.size).toBeGreaterThanOrEqual(6);
    // Each crossing ravine varies in width: narrow spots (8 m) beside kicker spots (28 m).
    expect(ravines.filter((r) => r.width === 8).length).toBeGreaterThanOrEqual(4);
    expect(ravines.filter((r) => r.width >= 28).length).toBeGreaterThanOrEqual(4);
    // Cliff bands (waterfalls), the Leap: a kicker on band 2's lip over a 44 m gorge at its foot.
    expect(level.cliffs.length).toBeGreaterThanOrEqual(4);
    expect(level.cliffs.every((c) => c.width !== undefined)).toBe(true);
    const band2 = level.cliffs.find((c) => Math.abs(c.s - K4.s) < 1)!;
    expect(band2.drop).toBeGreaterThanOrEqual(16);
    expect(farEdge(K4.s, 0) - K4.s).toBeGreaterThan(40);
    expect(level.finishS).toBe(level.coastS + 20);
  });

  it('things make sense: vehicles on roads, buildings and fences beside them', () => {
    const roads = of('road');
    const onRoad = (s: number, d: number, slack: number): boolean =>
      roads.some((r) => s >= r.s0 && s <= r.s1 && Math.abs(d - r.d) <= r.width / 2 + slack);
    const kinds = (k: ObstacleKind[]) => level.obstacles.filter((o) => k.includes(o.kind));
    for (const v of kinds(['car', 'truck', 'bus'])) {
      expect(onRoad(v.s, v.d, 0.6), `${v.kind} at s=${v.s} d=${v.d}`).toBe(true);
    }
    for (const b of kinds(['house', 'waterTower', 'barn', 'chalet'])) {
      expect(onRoad(b.s, b.d, 22), `${b.kind} at s=${b.s} d=${b.d}`).toBe(true);
    }
    for (const f of kinds(['fence'])) expect(onRoad(f.s, f.d, 3), `fence at s=${f.s}`).toBe(true);
    expect(kinds(['dam'])).toHaveLength(0);
  });

  it('kicker approaches are calm: no relief step where a face starts (no early launch)', () => {
    const t = terrain();
    for (const k of ramps) {
      const s0 = k.s - k.length;
      for (const dd of [-4, 0, 4]) {
        const a = t.course.toWorld(s0 - 2.5, k.d + dd).y;
        const b = t.course.toWorld(s0 + 2.5, k.d + dd).y;
        const floor = t.course.sampleAt(s0 + 2.5).floor - t.course.sampleAt(s0 - 2.5).floor;
        expect(Math.abs(b - a - floor), `ramp at s=${k.s}, d=${k.d + dd}`).toBeLessThan(0.3);
      }
    }
  });

  it('the route search finds the way to the sea', () => {
    const r = analyzeRoutes(terrain());
    const dead = r.deadEnds.slice(0, 6).map((d) => [Math.round(d.s), Math.round(d.d), d.area, d.cause]);
    console.log(`[ravine run] routes ${r.ms.toFixed(0)} ms, ${r.jumps} jumps`, JSON.stringify(dead));
    expect(r.solvable).toBe(true);
    expect(r.ms).toBeLessThan(15_000);
  }, 60_000);
});

// --- headless sessions --------------------------------------------------------------------------

const noMelt: LevelDef = { ...level, water: undefined };
const noMeltParams = { ...DEFAULT_ICEBERG_PARAMS, meltPerMetre: 0, meltPerRadian: 0 };

/** Puts the iceberg at (s, d) moving down-course at `speed`, grounded. */
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
  opts: { melt?: boolean; seconds?: number; setup?: (s: GameSession) => void } = {},
): Promise<Run> {
  const melt = opts.melt ?? true;
  const session = await GameSession.create({
    level: melt ? level : noMelt,
    terrain: terrain(),
    skipIntro: true,
    params: melt ? undefined : noMeltParams,
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

/** Follows `line` (the level's own by default) as the autopilot does. */
const followLine = (line?: LevelDef['line']) => (s: GameSession): number =>
  autopilotSteer(s.iceberg, line ? { ...s.terrain, level: { ...s.terrain.level, line } } : s.terrain).steer;
/** Straight down-course at lateral offset d. */
const lane = (d: number) => (s: GameSession): number =>
  autopilotSteer(s.iceberg, s.terrain, { followLine: false, lane: d }).steer;

const describeRun = (r: Run): string =>
  `${r.phase}${r.reason ? ` (${r.reason})` : ''} at s=${r.endS.toFixed(0)}, ${r.time.toFixed(1)} s, ` +
  `ice ${r.ice.toFixed(3)}, ${r.stats.waterfallsCrossed} falls, ${r.stats.knockedDown} knocked`;

/** Approaches a crossing straight on from 30 m before it at `speed` (no melting). */
const approach = (s: number, d: number, speed: number, seconds = 8) =>
  drive(lane(d), { melt: false, seconds, setup: (x) => place(x, s - 30, d, speed) });

/** The first landing after the first take-off near s (±4 m). */
function jumpAt(r: Run, s: number): { off: number; land: number } | null {
  const i = r.events.findIndex((e) => e.type === 'airborne' && Math.abs(along(e) - s) < 4);
  if (i < 0) return null;
  const land = r.events.slice(i).find((e) => e.type === 'landed');
  return { off: along(r.events[i]), land: land ? along(land) : NaN };
}

/** Session tests run 5–10 s alone and 2–5x longer under a full parallel suite. */
const SESSION = { timeout: 120_000 };

describe('ravine run jumps (no melting)', SESSION, () => {
  it('too slow off kicker K3 the ravine swallows the iceberg: the run ends at once', async () => {
    const r = await approach(K3.s, K3.d, 16);
    console.log(`[ravine run] K3 at 16 m/s: ${describeRun(r)}`);
    expect(r.phase).toBe('failed');
    expect(r.reason).toBe('fell');
    expect(r.endS).toBeGreaterThan(K3.s);
    expect(r.endS).toBeLessThan(farEdge(K3.s, K3.d));
    // ~1.5 s to the lip, the plunge and the beat.
    expect(r.time).toBeLessThan(5 + FELL_BEAT);
  });

  it('fast off K3 it clears the ravine, lands on the far side and keeps going', async () => {
    const r = await approach(K3.s, K3.d, 24, 5);
    const j = jumpAt(r, K3.s);
    console.log(`[ravine run] K3 at 24 m/s: ${describeRun(r)}, jump ${JSON.stringify(j)}`);
    expect(r.phase).toBe('playing');
    expect(j).not.toBeNull();
    expect(j!.land).toBeGreaterThan(farEdge(K3.s, K3.d) + 2);
    expect(r.endS).toBeGreaterThan(j!.land);
  });

  it('a narrow spot needs less speed: at 16 m/s K1 falls short, the narrow lip of R1 clears', async () => {
    const wide = await approach(K1.s, K1.d, 16);
    const narrow = await approach(N1.s, N1.d, 16);
    console.log(`[ravine run] 16 m/s: K1 ${describeRun(wide)} | narrow ${describeRun(narrow)}`);
    expect(wide.reason).toBe('fell');
    expect(narrow.phase).toBe('playing');
    expect(narrow.endS).toBeGreaterThan(N1.s + 40);
  });

  // R5's rope bridge and R6's trail bridge mark narrow spots: straight down each bridge's own line
  // the lip under its up-course end still clears at the narrow-spot speeds (the bridge approach
  // cuttings of 82b4508 shaved both lips there and made both crossings fatal; footbridges and
  // take-offs are never graded now, src/core/terrain/bridgeCuts.ts). R1's rope bridge (d −121)
  // stands behind its two boulders and rock cluster, which stop a straight run before the lip; R1's
  // narrow spot is crossed at N1 above.
  const footbridges = level.obstacles.filter((o) => o.kind === 'footbridge' && o.s > 900);
  it.each(footbridges.map((o) => [o.s, o.d] as const))(
    'the footbridge crossing at s %d d %d clears at 12 and 16 m/s on its own line',
    async (s, d) => {
      for (const v of [12, 16]) {
        const r = await approach(s, d, v);
        console.log(`[ravine run] footbridge s ${s} d ${d} at ${v} m/s: ${describeRun(r)}`);
        expect(r.phase, `${v} m/s: ${describeRun(r)}`).toBe('playing');
        expect(r.endS, `${v} m/s: ${describeRun(r)}`).toBeGreaterThan(s + 40);
      }
    },
  );

  it('the Leap needs full momentum: K4 drops a 20 m/s iceberg into the gorge, clears at 24', async () => {
    const slow = await approach(K4.s, K4.d, 20);
    const fast = await approach(K4.s, K4.d, 24, 5);
    const j = jumpAt(fast, K4.s);
    console.log(`[ravine run] Leap: 20 m/s ${describeRun(slow)} | 24 m/s jump ${JSON.stringify(j)}`);
    expect(slow.reason).toBe('fell');
    expect(fast.phase).toBe('playing');
    expect(j!.land).toBeGreaterThan(farEdge(K4.s, K4.d));
    // Landed inside the waterfall window of band 2 (80 m past its lip).
    expect(j!.land).toBeLessThan(K4.s + 80);
  });
});

describe('ravine run dead ends (no melting)', SESSION, () => {
  // Pockets sealed by wall ridges above a ravine part too wide to jump: drifting in, or trying to
  // steer back to the line, both end the run.
  const POCKETS: [string, number, number, number][] = [
    ['centre-right sub-lane above R3', 540, 70, 20],
    ['left sub-lane B above R3', 500, -180, 18],
    ['middle-right pocket above R5', 890, 135, 22],
    ['middle-right pocket above R6', 1170, 95, 22],
  ];
  for (const [name, s, d, v] of POCKETS) {
    it(`the ${name} is a dead end`, async () => {
      const drift = await drive(() => NONE, { melt: false, seconds: 60, setup: (x) => place(x, s, d, v) });
      const back = await drive(followLine(), { melt: false, seconds: 60, setup: (x) => place(x, s, d, v) });
      console.log(`[ravine run] ${name}: drift ${describeRun(drift)} | steer back ${describeRun(back)}`);
      expect(drift.phase).toBe('failed');
      expect(back.phase).toBe('failed');
      expect(['fell', 'stuck']).toContain(drift.reason);
      expect(['fell', 'stuck']).toContain(back.reason);
    });
  }

  it('the right gully from the top leads into R1 where it is too wide to jump', async () => {
    const r = await drive(() => NONE, { melt: false, seconds: 30, setup: (x) => place(x, 175, 62, 16) });
    console.log(`[ravine run] right gully: ${describeRun(r)}`);
    expect(r.reason).toBe('fell');
    expect(r.endS).toBeLessThan(310);
  });
});

/** The ranger road: down the right lane round R1, R3, the Leap and R5, then R6's right lip. */
const ROAD: LevelDef['line'] = [
  { s: 30, d: 0 },
  { s: 60, d: 10 },
  { s: 100, d: 55 },
  { s: 150, d: 140 },
  { s: 175, d: 170 },
  { s: 195, d: 177 },
  { s: 1150, d: 177 },
  { s: 1200, d: 145 },
  { s: 1260, d: 140 },
  { s: 1330, d: 140 },
  { s: 1420, d: 120 },
  { s: 1500, d: 110 },
];

/** The narrows: R1's narrow lip, the moat under band 1, R3's narrow lip, the Leap's left lip, R5, R6. */
const NARROWS: LevelDef['line'] = [
  { s: 30, d: 0 },
  { s: 100, d: -30 },
  { s: 160, d: -100 },
  { s: 205, d: -130 },
  { s: 285, d: -130 },
  { s: 330, d: -140 },
  { s: 380, d: -148 },
  { s: 420, d: -140 },
  { s: 450, d: -125 },
  { s: 520, d: -120 },
  { s: 600, d: -116 },
  { s: 650, d: -115 },
  { s: 700, d: -121 },
  { s: 760, d: -138 },
  { s: 860, d: -141 },
  { s: 900, d: -138 },
  { s: 930, d: -133 },
  { s: 977, d: -131 },
  { s: 1040, d: -125 },
  { s: 1090, d: -118 },
  { s: 1135, d: -116 },
  { s: 1200, d: -86 },
  { s: 1214, d: -85 },
  { s: 1260, d: -70 },
  { s: 1335, d: -55 },
  { s: 1420, d: -30 },
  { s: 1500, d: -25 },
];

describe('ravine run balance (real water budget and chipping)', SESSION, () => {
  let line: Run | undefined;
  const lineRun = async (): Promise<Run> => (line ??= await drive(followLine()));

  it('has a water budget that lasts a good line but not a crawl', () => {
    const water = level.water!;
    const run = level.coastS - level.startS;
    expect(water.metres).toBeGreaterThan(run);
    expect(water.metres).toBeLessThan(1.5 * run);
  });

  it('the line jumps all five kickers, takes four waterfalls, ends with ~25-45 % ice', async () => {
    const r = await lineRun();
    console.log(`[ravine run] line: ${describeRun(r)}, top ${r.stats.topSpeed.toFixed(1)} m/s`);
    expect(r.phase, describeRun(r)).toBe('complete');
    expect(r.ice).toBeGreaterThan(0.25);
    expect(r.ice).toBeLessThan(0.45);
    expect(r.time).toBeLessThan(70);
    expect(r.stats.waterfallsCrossed).toBeGreaterThanOrEqual(3);
    expect(r.stats.knockedDown).toBeGreaterThanOrEqual(1);
    for (const k of [K1, K3, K4, K5, K6]) {
      const j = jumpAt(r, k.s);
      expect(j, `kicker at s=${k.s}`).not.toBeNull();
      expect(j!.land, `kicker at s=${k.s}`).toBeGreaterThan(farEdge(k.s, k.d));
    }
  });

  it('the ranger road also reaches the sea: slower, one waterfall, much less ice', async () => {
    const road = await drive(followLine(ROAD));
    const best = await lineRun();
    console.log(`[ravine run] ranger road: ${describeRun(road)}`);
    expect(road.phase, describeRun(road)).toBe('complete');
    expect(road.time).toBeGreaterThan(best.time + 5);
    expect(road.ice).toBeLessThan(best.ice);
    expect(road.ice).toBeGreaterThan(0.05);
    expect(road.stats.waterfallsCrossed).toBeLessThan(best.stats.waterfallsCrossed);
  });

  it('the narrows (four narrow lips, the moat, the Leap off its left lip) also reach the sea', async () => {
    const r = await drive(followLine(NARROWS));
    const best = await lineRun();
    console.log(`[ravine run] narrows: ${describeRun(r)}`);
    expect(r.phase, describeRun(r)).toBe('complete');
    expect(r.time).toBeGreaterThan(best.time);
    expect(r.stats.waterfallsCrossed).toBeGreaterThanOrEqual(2);
  });

  it('a naive centreline and a no-input run both fall into R1', async () => {
    const centre = await drive(lane(0));
    const none = await drive(() => NONE);
    console.log(`[ravine run] centreline: ${describeRun(centre)} | no input: ${describeRun(none)}`);
    for (const r of [centre, none]) {
      expect(r.phase).toBe('failed');
      expect(r.reason).toBe('fell');
      expect(r.endS).toBeGreaterThan(K1.s);
      expect(r.endS).toBeLessThan(310);
    }
  });
});

// Geometry sanity used by the tests above: the narrow lip of R1 sits on the R1 narrow segment.
describe('ravine run helpers', () => {
  it('N1 lies on the 8 m segment of R1 and K1 on its 28 m segment', () => {
    const r1 = of('ravine').filter((r) => r.points[0].s > 240 && r.points[0].s < 280);
    const at = (s: number, d: number) => r1.find((r) => featureContains(r, s, d, 200));
    expect(at(N1.s, N1.d)?.width).toBe(8);
    expect(at(K1.s + 15, K1.d)?.width).toBe(28);
  });
});
