import { describe, expect, it } from 'vitest';
import { createTerrain } from '../terrain/terrain';
import { SANDBOX_GLACIER_RUN, streamSandboxOpen } from '../testing/streamSandbox';
import type { IcebergState, RiverSample, RiverTrailApi } from '../types';
import { WaterSystem } from './system';
import { CAPTURE, HYDRO } from './tuning';

/**
 * River capture on its own: an iceberg moved along a scripted path (in the stream, out over a bank,
 * along the valley floor) with a meltwater trail laid behind it. A big iceberg leaving the channel
 * captures the stream: its water follows the trail and the old channel drains; a small one cannot
 * leave (the banks hold it), and a path that comes back into the channel gives the water back.
 */

const terrain = createTerrain(streamSandboxOpen);
const FIXED = 1 / 60;

/** A meltwater trail with only what the water system reads (samples in order of s). */
class Trail implements RiverTrailApi {
  readonly samples: RiverSample[] = [];
  version = 0;
  get length(): number {
    return this.samples.length > 0 ? this.samples[this.samples.length - 1].s : 0;
  }
  lay(x: number, z: number, width: number): void {
    const last = this.samples[this.samples.length - 1];
    if (last && Math.hypot(x - last.x, z - last.z) < 1.2) return;
    const s = last ? last.s + Math.hypot(x - last.x, z - last.z) : 0;
    this.samples.push({
      x,
      y: terrain.heightAt(x, z) + 0.15,
      z,
      dirX: 0,
      dirZ: 1,
      s,
      width,
      flowSpeed: 3,
      turbulence: 0.1,
      t: 0,
      kind: 'flow',
    });
    this.version++;
  }
  record(): void {}
  flowAt(): null {
    return null;
  }
  disturb(): void {}
  reset(): void {}
}

const iceberg = (radius: number): IcebergState =>
  ({ pos: { x: 0, y: 0, z: 0 }, radius, grounded: true, inOcean: false }) as unknown as IcebergState;

/**
 * Drive an iceberg at 5 m/s along course points (s, d) relative to the stream (d = the stream's d at
 * that s + `off`), laying trail, stepping the water. Returns the system and the trail.
 */
function drive(
  radius: number,
  path: { s: number; off: number }[],
  extra = 0,
): { w: WaterSystem; trail: Trail; ice: IcebergState } {
  const w = new WaterSystem(terrain);
  const trail = new Trail();
  const ice = iceberg(radius);
  const pts = streamSandboxOpen.features![0].type === 'stream' ? streamSandboxOpen.features![0].points : [];
  const streamD = (s: number): number => {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (s <= b.s) return a.d + ((b.d - a.d) * (s - a.s)) / (b.s - a.s);
    }
    return pts[pts.length - 1].d;
  };
  const at = (p: { s: number; off: number }): { x: number; z: number } => {
    const v = terrain.course.toWorld(p.s, streamD(p.s) + p.off);
    return { x: v.x, z: v.z };
  };
  for (let k = 0; k + 1 < path.length; k++) {
    const a = at(path[k]);
    const b = at(path[k + 1]);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.round(len / (5 * FIXED)));
    for (let j = 1; j <= steps; j++) {
      ice.pos.x = a.x + ((b.x - a.x) * j) / steps;
      ice.pos.z = a.z + ((b.z - a.z) * j) / steps;
      trail.lay(ice.pos.x, ice.pos.z, 2.6 * radius);
      w.step(FIXED, ice, trail, null);
    }
  }
  for (let k = 0; k < Math.round(extra / FIXED); k++) w.step(FIXED, ice, trail, null);
  return { w, trail, ice };
}

/** In the stream at s 150-200, out over the right bank, then down the floor 20 m beside it. */
const LEAVE = [
  { s: 150, off: 0 },
  { s: 200, off: 0 },
  { s: 215, off: 20 },
  { s: 330, off: 22 },
];

describe('river capture', () => {
  it('a big iceberg leaving the stream takes its water along its own path', () => {
    const { w, ice } = drive(4.84, LEAVE, 20);
    expect(w.captures).toHaveLength(1);
    const cap = w.captures[0];
    const st = w.streams[cap.stream];
    // The junction is where it left (s ≈ 200 → ~140 m below s 60).
    expect(cap.junction * HYDRO.cell - SANDBOX_GLACIER_RUN).toBeGreaterThan(120);
    expect(cap.junction * HYDRO.cell - SANDBOX_GLACIER_RUN).toBeLessThan(170);
    // The captured river follows the trail to the iceberg, on the ground, and carries the water.
    expect(cap.reach.n).toBeGreaterThan(50);
    const last = cap.reach.n - 1;
    expect(Math.hypot(cap.reach.x[last] - ice.pos.x, cap.reach.z[last] - ice.pos.z)).toBeLessThan(4);
    for (let i = 0; i < cap.reach.n; i += 10) {
      expect(cap.reach.baseY[i]).toBeCloseTo(terrain.heightAt(cap.reach.x[i], cap.reach.z[i]), 6);
    }
    expect(st.reach.divertShare).toBeCloseTo(CAPTURE.share, 6);
    expect(cap.reach.qIn / st.q).toBeGreaterThan(0.85);
    expect(cap.reach.outflow / st.q).toBeGreaterThan(0.5);
    // Wider and faster than the meltwater trail beside it.
    const mid = Math.floor(cap.reach.n / 2);
    expect(2 * cap.reach.waterHalf(mid, cap.reach.h[mid])).toBeGreaterThan(2.6 * 4.84);
    expect(cap.reach.u[mid]).toBeGreaterThan(3);
    // The old channel below the departure drains to the tenth left in it.
    const below = st.reach.A[cap.junction + 20] * st.reach.u[cap.junction + 20];
    expect(below / st.q).toBeLessThan(0.15);
    expect(st.reach.h[cap.junction + 20]).toBeLessThan(0.5 * st.reach.steady[cap.junction + 20]);
    // Its water is there for bodies too.
    expect(w.flowAt(cap.reach.x[mid], cap.reach.z[mid])).not.toBeNull();
  });

  it('a small iceberg the banks hold captures nothing (and a brief hop over a bank neither)', () => {
    expect(drive(2.2, LEAVE, 10).w.captures).toHaveLength(0);
    const hop = [
      { s: 150, off: 0 },
      { s: 200, off: 0 },
      { s: 204, off: 9 },
      { s: 210, off: 0 },
      { s: 260, off: 0 },
    ];
    expect(drive(4.84, hop, 10).w.captures).toHaveLength(0);
  });

  it('gives the water back where the path returns to the channel', () => {
    const back = [...LEAVE.slice(0, 3), { s: 260, off: 20 }, { s: 280, off: 0 }, { s: 330, off: 0 }];
    const { w } = drive(4.84, back, 30);
    expect(w.captures).toHaveLength(1);
    const cap = w.captures[0];
    expect(cap.done).toBe(true);
    expect(cap.rejoin).toBeGreaterThan(cap.junction + 3);
    const st = w.streams[cap.stream];
    // Between the departure and the return the channel runs low; below the return it is whole again.
    const between = st.reach.A[cap.junction + 5] * st.reach.u[cap.junction + 5];
    const after = st.reach.A[cap.rejoin + 10] * st.reach.u[cap.rejoin + 10];
    expect(between / st.q).toBeLessThan(0.2);
    expect(after / st.q).toBeGreaterThan(0.85);
  });

  it('is deterministic', () => {
    const a = drive(4.84, LEAVE, 5).w;
    const b = drive(4.84, LEAVE, 5).w;
    expect(Array.from(a.captures[0].reach.A)).toEqual(Array.from(b.captures[0].reach.A));
    expect(Array.from(a.streams[0].reach.A)).toEqual(Array.from(b.streams[0].reach.A));
  });
});
