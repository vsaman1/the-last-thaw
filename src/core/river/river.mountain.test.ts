import { describe, expect, it } from 'vitest';
import { FIXED_DT, GameSession } from '../session';
import { autopilotSteer } from '../autopilot';
import { dirToHeading } from '../math';
import type { SteeringInput, TerrainFeature } from '../types';
import { mountainSandbox as level } from '../testing/mountainSandbox';
import { buildRiverChunk } from './geometry';
import { distanceToPolyline, fallClearance, fallRuns, gapIndices, type Point3 } from './testkit';

/*
 * Waterfalls on the open-mountain sandbox (src/core/testing/mountainSandbox.ts): a partial-width
 * cliff band flown over on wide relief, and the fatal ravines, where the run ends in the plunge.
 */

type Feature<T extends TerrainFeature['type']> = Extract<TerrainFeature, { type: T }>;
const ramp = (level.features ?? [])[5] as Feature<'ramp'>;
const NONE: SteeringInput = { steer: 0, source: 'none' };
const straightOn = (s: GameSession): SteeringInput =>
  autopilotSteer(s.iceberg, s.terrain, { pursuit: 'course', followLine: false });

interface Run {
  session: GameSession;
  /** Water-level flights: last grounded point, airborne points, touchdown. */
  flights: Point3[][];
  /** River samples before the teleport's straight run from the spawn (ignored). */
  from: number;
  /** The iceberg's last grounded position. */
  lastGround: Point3 | null;
}

/** Teleport to (s, d) moving down-course at `speed` and drive for `seconds`. */
async function run(s0: number, d0: number, speed: number, seconds: number, steer = straightOn): Promise<Run> {
  const session = await GameSession.create({ level, skipIntro: true });
  const t = session.terrain;
  const ice = session.iceberg;
  const w = t.course.toWorld(s0, d0);
  const c = t.course.sampleAt(s0);
  ice.pos.x = w.x;
  ice.pos.y = w.y;
  ice.pos.z = w.z;
  ice.vel.x = c.dirX * speed;
  ice.vel.z = c.dirZ * speed;
  const g = t.gradientAt(w.x, w.z);
  ice.vel.y = g.dx * ice.vel.x + g.dz * ice.vel.z;
  ice.heading = dirToHeading(c.dirX, c.dirZ);
  // the first record lays a straight run from the spawn to here: ignore what it puts down
  session.update(FIXED_DT, steer(session));
  const from = session.river.samples.length;
  const flights: Point3[][] = [];
  let cur: Point3[] | null = null;
  let prev: Point3 = { x: ice.pos.x, y: ice.pos.y + 0.15, z: ice.pos.z };
  let lastGround: Point3 | null = null;
  for (let n = 0; n < seconds * 60 && session.phase === 'playing'; n++) {
    session.update(FIXED_DT, steer(session));
    const p = { x: ice.pos.x, y: ice.pos.y + 0.15, z: ice.pos.z };
    if (!ice.grounded) {
      if (!cur) flights.push((cur = [prev]));
      cur.push(p);
    } else {
      if (cur) cur.push(p);
      cur = null;
      lastGround = p;
    }
    prev = p;
  }
  return { session, flights, from, lastGround };
}

function falls(r: Run): ReturnType<typeof fallRuns> {
  return fallRuns(r.session.river.samples).filter((f) => f.lip >= r.from);
}

describe('waterfalls on open-mountain terrain', () => {
  it.each([
    ['in the middle of the band', 880, -60, 16],
    ['near its end', 880, 30, 14],
    ['slowly', 895, -60, 4],
  ])('flying off the partial-width cliff band %s: along the flight, clear of the rock', async (_n, s0, d, v) => {
    const r = await run(s0, d, v, 12);
    const s = r.session.river.samples;
    const t = r.session.terrain;
    const band = falls(r).filter((f) => Math.abs(t.course.project(s[f.lip].x, s[f.lip].z).s - 900) < 8);
    expect(band).toHaveLength(1);
    const { lip, first, last, base } = band[0];
    const flight = r.flights.find((f) => Math.hypot(f[0].x - s[lip].x, f[0].z - s[lip].z) < 0.3);
    expect(flight, 'the fall starts at a take-off point').toBeDefined();
    let dev = 0;
    for (let i = first; i <= last; i++) dev = Math.max(dev, distanceToPolyline(s[i], flight ?? []));
    // (lifted a little where the relief under the flight comes close, moved out from the band's face
    // when slow)
    expect(dev).toBeLessThan(1);
    const fc = fallClearance([buildRiverChunk(s, lip - 1, base + 1, t)], t);
    expect(fc.minVertical).toBeGreaterThan(0.149);
    expect(fc.trianglesLow, `lowest ${fc.minTriangle.toFixed(2)} m`).toBe(0);
    r.session.dispose();
  }, 120_000);

  it('too slow off the kicker into the ravine: it plunges to the floor, the river follows it down', async () => {
    // The fell rule ends the run 0.6 s after the iceberg lands on the ravine floor, never while it
    // is still flying over the cut (riding the kicker's exact lip beside the cut does not count).
    const r = await run(ramp.s - 25, ramp.d, 7, 20);
    expect(r.session.failReason).toBe('fell');
    const s = r.session.river.samples;
    const t = r.session.terrain;
    const runs = falls(r);
    expect(runs).toHaveLength(1);
    const { lip, first, last, base } = runs[0];
    const flight = r.flights.find((f) => Math.hypot(f[0].x - s[lip].x, f[0].z - s[lip].z) < 0.3);
    expect(flight).toBeDefined();
    for (let i = first; i <= last; i++) expect(distanceToPolyline(s[i], flight ?? [])).toBeLessThan(0.3);
    expect(t.ravineDepthAt?.(s[base].x, s[base].z) ?? 0).toBeGreaterThan(2);
    expect(gapIndices(s).filter((i) => i >= r.from)).toHaveLength(0);
    r.session.dispose();
  }, 120_000);

  it('running into the wide ravine: one waterfall along the flight down to its floor', async () => {
    const r = await run(588, 160, 12, 30, () => NONE);
    expect(r.session.failReason).toBe('fell');
    const s = r.session.river.samples;
    const t = r.session.terrain;
    const runs = falls(r);
    expect(runs).toHaveLength(1);
    const { lip, first, last, base } = runs[0];
    const flight = r.flights.find((f) => Math.hypot(f[0].x - s[lip].x, f[0].z - s[lip].z) < 0.3);
    expect(flight).toBeDefined();
    for (let i = first; i <= last; i++) expect(distanceToPolyline(s[i], flight ?? [])).toBeLessThan(0.3);
    // the base is on the ravine floor and the river ends in the plunge pool there
    expect(t.ravineDepthAt?.(s[base].x, s[base].z) ?? 0).toBeGreaterThan(2);
    expect(gapIndices(s).filter((i) => i >= r.from)).toHaveLength(0);
    const fc = fallClearance([buildRiverChunk(s, lip - 1, Math.min(s.length - 1, base + 1), t)], t);
    expect(fc.trianglesLow, `lowest ${fc.minTriangle.toFixed(2)} m`).toBe(0);
    r.session.dispose();
  }, 120_000);
});
