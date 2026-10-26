import { describe, expect, it } from 'vitest';
import { createAnalyticTerrain, inclinedPlane } from '../testing/analyticTerrain';
import type { IcebergState, Terrain } from '../types';
import { ConfinementTracker } from './confinement';
import { createIceberg, isStuck, isTrapped, stepIceberg, stuckFraction } from './iceberg';
import { DEFAULT_ICEBERG_PARAMS as P, SIM_TUNING, type IcebergSimTuning } from './params';

const DT = 1 / 60;
/** The stuck rule without the trap test (the rule before it existed). */
const NO_TRAP: IcebergSimTuning = { ...SIM_TUNING, confineWindow: 0 };

describe('ConfinementTracker', () => {
  const T = SIM_TUNING;
  const feed = (
    tr: ConfinementTracker,
    seconds: number,
    pos: (t: number) => [number, number],
    t0 = 0,
  ): { firstTrapped: number; trappedAtEnd: boolean } => {
    let firstTrapped = -1;
    for (let i = 0; i < seconds * 60; i++) {
      const t = t0 + i * DT;
      const [x, z] = pos(t);
      const [px, pz] = pos(t - DT);
      const speed = Math.hypot(x - px, z - pz) / DT;
      if (tr.update(x, z, speed, 0, DT, true, T) && firstTrapped < 0) firstTrapped = t;
    }
    return { firstTrapped, trappedAtEnd: tr.trapped };
  };

  it('never traps monotone motion, however slow or curved', () => {
    for (const pos of [
      (t: number): [number, number] => [0, 0.4 * t], // a crawl
      (t: number): [number, number] => [0, 0.05 * t * t], // a slow start
      (t: number): [number, number] => [20 * Math.sin(t / 8), 20 * (1 - Math.cos(t / 8))], // a half turn
    ]) {
      expect(feed(new ConfinementTracker(), 25, pos).firstTrapped).toBe(-1);
    }
  });

  it('traps rocking within one swing and keeps it trapped while it rocks', () => {
    const tr = new ConfinementTracker();
    const rock = (t: number): [number, number] => [0, 8 * Math.sin((2 * Math.PI * t) / 5)];
    const r = feed(tr, 20, rock);
    expect(r.firstTrapped).toBeGreaterThan(0);
    expect(r.firstTrapped).toBeLessThan(5);
    expect(r.trappedAtEnd).toBe(true);
    expect(tr.radius).toBeGreaterThan(8);
    // Circling traps too.
    const circle = feed(new ConfinementTracker(), 12, (t) => [6 * Math.cos(t), 6 * Math.sin(t)]);
    expect(circle.firstTrapped).toBeGreaterThan(0);
  });

  it('releases a trap once the iceberg has been out of its region for confineHold s', () => {
    const tr = new ConfinementTracker();
    feed(tr, 12, (t) => [0, 5 * Math.sin(t)]);
    expect(tr.trapped).toBe(true);
    // Leave along +x at 3 m/s.
    const out = feed(tr, T.confineHold + 6, (t) => [3 * (t - 12), 5 * Math.sin(12)], 12);
    expect(out.trappedAtEnd).toBe(false);
  });

  it('forgets everything when airborne, at sea or teleported', () => {
    const tr = new ConfinementTracker();
    feed(tr, 12, (t) => [0, 5 * Math.sin(t)]);
    expect(tr.trapped).toBe(true);
    tr.update(0, 0, 0, 0, DT, false, T);
    expect(tr.trapped).toBe(false);
    feed(tr, 12, (t) => [0, 5 * Math.sin(t)]);
    expect(tr.trapped).toBe(true);
    tr.update(500, 500, 3, 0, DT, true, T);
    expect(tr.trapped).toBe(false);
  });
});

/** Bowl (and optional mound behind it) on a plane descending `slope` along +Z. */
function bowl(r: number, depth: number, slope: number, mound = 0, at = 115): Terrain {
  return createAnalyticTerrain({
    height: (x, z) => {
      const q2 = (x * x + (z - at) ** 2) / (r * r);
      const m2 = (x * x + (z - at - 1.6 * r) ** 2) / (r * r);
      const dip = q2 < 1 ? depth * (1 - q2) * (1 - q2) : 0;
      const bump = m2 < 1 ? mound * (1 - m2) * (1 - m2) : 0;
      return 100 - slope * z - dip + bump;
    },
    width: 160,
    length: 900,
  });
}

interface Outcome {
  stuckAt: number;
  maxFraction: number;
  everTrapped: boolean;
  s: IcebergState;
}

/** Puts the iceberg at (x0, z0) moving +Z at v0 (past the start grace) and runs until stuck. */
function runFrom(
  terrain: Terrain,
  z0: number,
  v0: number,
  seconds: number,
  o: { x0?: number; steer?: (t: number, s: IcebergState) => number; tuning?: IcebergSimTuning } = {},
): Outcome {
  const s = createIceberg(terrain, P);
  s.pos.x = o.x0 ?? 0;
  s.pos.z = z0;
  s.pos.y = terrain.heightAt(s.pos.x, z0);
  s.vel.x = 0;
  s.vel.z = v0;
  s.heading = 0;
  let maxFraction = 0;
  let everTrapped = false;
  for (let i = 0; i < seconds * 60; i++) {
    const t = i * DT;
    const steer = o.steer ? o.steer(t, s) : 0;
    stepIceberg(s, { steer, source: 'scripted' }, terrain, DT, P, P.graceTime + 1 + t, o.tuning);
    maxFraction = Math.max(maxFraction, stuckFraction(s, P));
    everTrapped ||= isTrapped(s);
    if (isStuck(s, P)) return { stuckAt: t, maxFraction, everTrapped, s };
  }
  return { stuckAt: -1, maxFraction, everTrapped, s };
}

describe('trap rule: an iceberg rocking in a bowl is failed in seconds', () => {
  const bowls: [string, Terrain, number, number][] = [
    // name, terrain, start z, start speed
    ['sinkhole r8 d4 backed by a mound, slope 0.067', bowl(8, 4, 0.067, 2), 106, 4],
    ['bowl r12 d5 on the flat', bowl(12, 5, 0), 102, 3],
    ['bowl r12 d5 backed by a mound, slope 0.087', bowl(12, 5, 0.087, 3), 102, 3],
    ['bowl r15 d4.5 backed by a mound, slope 0.06', bowl(15, 4.5, 0.06, 2.5), 99, 4],
  ];
  for (const [name, terrain, z0, v0] of bowls) {
    it(`${name}: stuck within ~stuckTime + 10 s (it rocked for 30+ s before)`, () => {
      const now = runFrom(terrain, z0, v0, 60);
      const before = runFrom(terrain, z0, v0, 60, { tuning: NO_TRAP });
      expect(now.everTrapped).toBe(true);
      expect(now.stuckAt).toBeGreaterThan(0);
      expect(now.stuckAt).toBeLessThan(P.stuckTime + 11);
      expect(before.stuckAt).toBeGreaterThan(30);
      // It is failed where it was trapped: still in the bowl.
      expect(Math.abs(now.s.pos.z - 115)).toBeLessThan(16);
    });
  }
});

describe('trap rule: legitimate runs are not failed', () => {
  it('slow climbs over a hill that make it (h 5 / r 16 on a 0.087 slope, from 8.5 m/s)', () => {
    const hill = createAnalyticTerrain({
      height: (x, z) => {
        const q2 = (x * x + (z - 120) ** 2) / 256;
        return 100 - 0.087 * z + (q2 < 1 ? 5 * (1 - q2) * (1 - q2) : 0);
      },
      length: 900,
    });
    for (const v0 of [8.5, 9, 10, 12]) {
      const r = runFrom(hill, 100, v0, 20);
      expect(r.stuckAt, `from ${v0} m/s`).toBe(-1);
      expect(r.s.pos.z, `from ${v0} m/s`).toBeGreaterThan(140);
    }
  });

  it('a slow start on the gentlest level slope is never trapped', () => {
    const plane = createAnalyticTerrain({ height: inclinedPlane(0.056), length: 600 });
    const r = runFrom(plane, 20, 0.3, 15);
    expect(r.everTrapped).toBe(false);
    expect(r.stuckAt).toBe(-1);
    expect(r.maxFraction).toBeLessThan(0.5);
  });

  it('steering out of a sinkhole still works whenever it worked before', () => {
    // Aims for a line 10 m to the right of the bowl after a reaction delay.
    const aim = (delay: number) => (t: number, s: IcebergState): number =>
      t < delay ? 0 : Math.max(-1, Math.min(1, -2 * (Math.atan2(-10 - s.pos.x, 15) - s.heading)));
    const sink = bowl(8, 4, 0.067, 2);
    let escapes = 0;
    for (const v0 of [4, 5, 6, 7]) {
      for (const delay of [0, 1, 2]) {
        const before = runFrom(sink, 106, v0, 40, { steer: aim(delay), tuning: NO_TRAP });
        if (before.stuckAt >= 0) continue;
        escapes++;
        const now = runFrom(sink, 106, v0, 40, { steer: aim(delay) });
        expect(now.stuckAt, `${v0} m/s, steering after ${delay} s`).toBe(-1);
        expect(now.s.pos.z).toBeGreaterThan(200);
      }
    }
    expect(escapes).toBeGreaterThanOrEqual(6);
  });

  it('sliding along a wall while gaining speed is never trapped', () => {
    // Floor falls 0.08 along +Z and 0.12 toward a 6 m wall at x = 4.
    const wall = createAnalyticTerrain({ height: (x, z) => 100 - 0.08 * z - 0.12 * x + (x > 4 ? 6 : 0) });
    const r = runFrom(wall, 40, 3, 20, { x0: 1.5 });
    expect(r.everTrapped).toBe(false);
    expect(r.stuckAt).toBe(-1);
  });

  it('circling at sea (past the finish) is never trapped or stuck', () => {
    const sea = createAnalyticTerrain({ height: () => -5, seaLevel: 0, width: 400, length: 400 });
    const s = createIceberg(sea, P);
    s.pos.z = 200;
    for (let i = 0; i < 60 * 30; i++) {
      stepIceberg(s, { steer: 1, source: 'scripted' }, sea, DT, P, P.graceTime + 1 + i * DT);
      expect(isTrapped(s)).toBe(false);
    }
    expect(s.inOcean).toBe(true);
    expect(stuckFraction(s, P)).toBe(0);
  });
});
