import { describe, expect, it } from 'vitest';
import { FELL_BEAT, FIXED_DT, GameSession, getTerrain } from '../session';
import { autopilotSteer } from '../autopilot';
import { dirToHeading } from '../math';
import { createPhysicsWorld, type PhysicsWorld } from '../physics/world';
import { buildTerrainChunks } from '../terrain/terrainGeometry';
import { generateDecor } from '../terrain/decor';
import { createTerrain, type GeneratedTerrain } from '../terrain/terrain';
import { analyzeRoutes } from '../terrain/routes';
import { validateLevel } from '../terrain/validate';
import type { GameEvent, SteeringInput, TerrainFeature } from '../types';
import { timed } from './timing';
import { mountainSandbox as level } from './mountainSandbox';
import { rockyCanyon } from '../levels/rockyCanyon';

/**
 * The open-mountain sandbox (./mountainSandbox.ts): build cost, validator and route search, the
 * autopilot following a winding line, dead-end branches, and the fatal ravine.
 */

type Feature<T extends TerrainFeature['type']> = Extract<TerrainFeature, { type: T }>;
const features = level.features ?? [];
const ramp = features[5] as Feature<'ramp'>;
const r1 = features[3] as Feature<'ravine'>;
const NONE: SteeringInput = { steer: 0, source: 'none' };
const terrain = (): GeneratedTerrain => getTerrain(level) as GeneratedTerrain;

interface Run {
  phase: string;
  reason: string | null;
  time: number;
  endS: number;
  endD: number;
  events: GameEvent[];
  msPerStep: number;
  stats: GameSession['stats'];
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
  opts: { seconds?: number; setup?: (s: GameSession) => void } = {},
): Promise<Run> {
  const session = await GameSession.create({ level, skipIntro: true });
  const events: GameEvent[] = [];
  session.events.on((e) => events.push(e));
  opts.setup?.(session);
  const steps = (opts.seconds ?? 200) * 60;
  let total = 0;
  let n = 0;
  for (; n < steps && session.phase === 'playing'; n++) {
    const input = steer(session);
    const t0 = performance.now();
    session.update(FIXED_DT, input);
    total += performance.now() - t0;
  }
  const ice = session.iceberg;
  const p = session.terrain.course.project(ice.pos.x, ice.pos.z);
  const run: Run = {
    phase: session.phase,
    reason: session.failReason,
    time: session.stats.time,
    endS: p.s,
    endD: p.d,
    events,
    msPerStep: total / Math.max(1, n),
    stats: { ...session.stats },
  };
  session.dispose();
  return run;
}

/** Straight down the course (centreline aim), for runs placed on the kicker's axis. */
const straightOn = (s: GameSession): SteeringInput =>
  autopilotSteer(s.iceberg, s.terrain, { pursuit: 'course', followLine: false });

const describeRun = (r: Run): string =>
  `${r.phase}${r.reason ? ` (${r.reason})` : ''} at s=${r.endS.toFixed(0)} d=${r.endD.toFixed(0)}, ` +
  `${r.time.toFixed(1)} s`;

describe('mountain sandbox: terrain and tools', () => {
  it('builds a 2 km × 480 m mountainside in ~1.2–1.5 s (CPU, alone) and reports its size', () => {
    // The first build in a fresh worker also compiles the terrain code; the budget is for the build.
    // Under a full parallel suite every CPU-time budget inflates (2–5×), so the cost per vertex is
    // also compared with a valley level built right after it in the same worker.
    const cold = timed(() => createTerrain(level));
    const { result: t, ms } = timed(() => createTerrain(level));
    const ref = timed(() => createTerrain(rockyCanyon));
    const vertices = t.grid.cols * t.grid.rows;
    const perVertex = ms / vertices;
    const refPerVertex = ref.ms / (ref.result.grid.cols * ref.result.grid.rows);
    console.log(
      `[sandbox] terrain ${ms.toFixed(0)} ms (first build ${cold.ms.toFixed(0)} ms), ` +
        `${t.grid.cols}×${t.grid.rows} = ${vertices} vertices, ${(perVertex * 1000).toFixed(2)} µs per ` +
        `vertex (Rocky Canyon ${(refPerVertex * 1000).toFixed(2)})`,
    );
    expect(perVertex).toBeLessThan(1.5 * refPerVertex);
    expect(ms).toBeLessThan(3000);
    expect(vertices).toBeGreaterThan(250_000);
    expect(t.course.length).toBeGreaterThan(2000);
    expect(2 * t.course.halfWidthAt(1000)).toBeCloseTo(480, 0);
  });

  it('passes every level-design check, including a way to the sea', () => {
    expect(validateLevel(terrain())).toEqual([]);
  });

  it('the route search finds the way and the designed dead ends', () => {
    const r = analyzeRoutes(terrain());
    console.log(
      `[sandbox] routes ${r.ms.toFixed(0)} ms ${JSON.stringify(r.phases)}, ${r.jumps} jumps, dead ends ` +
        JSON.stringify(r.deadEnds.map((d) => [Math.round(d.s), Math.round(d.d), d.area, d.cause])),
    );
    expect(r.solvable).toBe(true);
    expect(r.ms).toBeLessThan(6000);
    // The left branch is a pocket (trap), the right one ends at the wide ravine.
    const left = r.deadEnds.find((d) => d.d < -110 && d.s > 200 && d.s < 620);
    const right = r.deadEnds.find((d) => d.d > 110 && d.s > 200 && d.s < 660);
    expect(left?.cause).toBe('trap');
    expect(right?.cause).toBe('ravine');
    expect(left!.area).toBeGreaterThan(20_000);
    expect(right!.area).toBeGreaterThan(20_000);
    // The best route crosses the ravine in the middle branch, between ridges A and B.
    const before = r.path.filter((p) => p.s > 560 && p.s < 600);
    expect(before.length).toBeGreaterThan(0);
    for (const p of before) expect(Math.abs(p.d)).toBeLessThan(100);
  });

  it('render, collision and scenery stay bounded on the wide terrain', async () => {
    const t = terrain();
    const chunks = timed(() => buildTerrainChunks(t));
    const triangles = chunks.result.reduce((a, c) => a + c.geometry.getAttribute('position').count / 3, 0);
    const decor = timed(() => generateDecor(t, level.seed));
    const physics = await createPhysicsWorld(t, { seed: level.seed });
    const info = (physics as PhysicsWorld).buildInfo;
    console.log(
      `[sandbox] render chunks ${chunks.ms.toFixed(0)} ms (${chunks.result.length} chunks, ` +
        `${(triangles / 1000).toFixed(0)}k triangles); decor ${decor.ms.toFixed(0)} ms ` +
        `(${decor.result.trees.count} trees, ${decor.result.tufts.count} tufts); trimesh ` +
        `${info.terrainTriangles} triangles in ${info.terrainMs.toFixed(0)} ms, ` +
        `spawn ${info.spawnMs.toFixed(0)} ms`,
    );
    physics.dispose();
    for (const c of chunks.result) c.geometry.dispose();
    expect(triangles).toBeLessThan(700_000);
    expect(info.terrainTriangles).toBeLessThan(700_000);
  });
});

describe('mountain sandbox: runs', () => {
  it('the autopilot follows the winding line to the sea, over the kicker and the cliff band', async () => {
    const r = await drive((s) => autopilotSteer(s.iceberg, s.terrain));
    console.log(
      `[sandbox] line: ${describeRun(r)}, ${r.msPerStep.toFixed(2)} ms/step, ` +
        `top ${r.stats.topSpeed.toFixed(1)} m/s`,
    );
    expect(r.phase, describeRun(r)).toBe('complete');
    expect(r.stats.waterfallsCrossed).toBe(1);
    // It jumped the ravine off the kicker: airborne near the lip, down beyond the far edge.
    const t = terrain();
    const along = (e: Extract<GameEvent, { pos: unknown }>): number => t.course.project(e.pos.x, e.pos.z).s;
    const off = r.events.findIndex((e) => e.type === 'airborne' && Math.abs(along(e) - ramp.s) < 5);
    expect(off).toBeGreaterThanOrEqual(0);
    const down = r.events.slice(off).find((e) => e.type === 'landed');
    expect(down && down.type === 'landed' ? along(down) : 0).toBeGreaterThan(r1.points[1].s + 10);
    expect(r.msPerStep).toBeLessThan(10);
  }, 120_000);

  it('the left branch is a dead end: the pocket keeps the iceberg until it is stuck', async () => {
    const r = await drive(() => NONE, { seconds: 90, setup: (s) => place(s, 330, -150, 8) });
    console.log(`[sandbox] left branch: ${describeRun(r)}`);
    expect(r.phase).toBe('failed');
    expect(r.reason).toBe('stuck');
    expect(r.endS).toBeLessThan(605);
    expect(r.endD).toBeLessThan(-110);
  }, 120_000);

  it('the right branch is a dead end: at its foot the iceberg runs into the wide ravine', async () => {
    // (On the way down, its tors and hollows can stop an iceberg before it gets here.)
    const r = await drive(() => NONE, { seconds: 30, setup: (s) => place(s, 588, 160, 12) });
    console.log(`[sandbox] right branch: ${describeRun(r)}`);
    expect(r.phase).toBe('failed');
    expect(r.reason).toBe('fell');
    expect(r.endS).toBeGreaterThan(590);
    expect(r.endS).toBeLessThan(700);
  }, 120_000);

  it('the closed gully below the band is a dead end too', async () => {
    const r = await drive(() => NONE, { seconds: 90, setup: (s) => place(s, 1000, 150, 10) });
    console.log(`[sandbox] closed gully: ${describeRun(r)}`);
    expect(r.phase).toBe('failed');
    expect(r.reason).toBe('stuck');
    expect(r.endS).toBeGreaterThan(1040);
    expect(r.endS).toBeLessThan(1160);
  }, 120_000);

  it('too slow off the kicker: it falls into the ravine and the run ends at once', async () => {
    let airborneAt = -1;
    const r = await drive(straightOn, {
      seconds: 20,
      setup: (s) => {
        place(s, ramp.s - 25, ramp.d, 7);
        const t = terrain();
        s.events.on((e) => {
          // the take-off from the kicker (not a hop on the approach)
          if (e.type === 'airborne' && Math.abs(t.course.project(e.pos.x, e.pos.z).s - ramp.s) < 3) {
            airborneAt = s.stats.time;
          }
        });
      },
    });
    console.log(`[sandbox] slow jump: ${describeRun(r)}, off the kicker at ${airborneAt.toFixed(2)} s`);
    expect(r.phase).toBe('failed');
    expect(r.reason).toBe('fell');
    expect(airborneAt).toBeGreaterThan(0);
    // The plunge (12 m: ~1.6 s) and the beat, no stuck timer.
    expect(r.time - airborneAt).toBeLessThan(2.5 + FELL_BEAT);
    expect(r.endS).toBeGreaterThan(ramp.s);
    expect(r.endS).toBeLessThan(r1.points[1].s + 15);
  }, 120_000);

  it('fast off the kicker: it clears the ravine, lands on the far side and keeps going', async () => {
    const r = await drive(straightOn, {
      seconds: 6,
      setup: (s) => place(s, ramp.s - 25, ramp.d, 20),
    });
    console.log(`[sandbox] fast jump: ${describeRun(r)}`);
    expect(r.phase).toBe('playing');
    const t = terrain();
    const along = (e: Extract<GameEvent, { pos: unknown }>): number => t.course.project(e.pos.x, e.pos.z).s;
    const off = r.events.findIndex((e) => e.type === 'airborne' && Math.abs(along(e) - ramp.s) < 3);
    expect(off).toBeGreaterThanOrEqual(0);
    const land = r.events.slice(off).find((e) => e.type === 'landed');
    expect(land).toBeDefined();
    const s = land && land.type === 'landed' ? along(land) : 0;
    expect(s).toBeGreaterThan(r1.points[1].s + 10);
    expect(r.endS).toBeGreaterThan(s);
  }, 120_000);
});
