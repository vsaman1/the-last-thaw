import { describe, expect, it } from 'vitest';
import { createAnalyticTerrain, inclinedPlane } from '../testing/analyticTerrain';
import type {
  CourseFrame,
  IcebergParams,
  IcebergState,
  IcebergStepEvent,
  ObstacleProxy,
  Terrain,
} from '../types';
import { DEFAULT_ICEBERG_PARAMS as P, SIM_TUNING } from './params';
import {
  createIceberg,
  isStuck,
  resolveIcebergContacts,
  stepIceberg,
  stuckFraction,
} from './iceberg';

/**
 * Edge cases found in review: stale base height after external position changes, sea cliffs,
 * blocked moves, degenerate params, and the sign conventions the renderer relies on.
 */

const DT = 1 / 60;
const NONE = { steer: 0, source: 'none' } as const;
const hspeed = (s: IcebergState): number => Math.hypot(s.vel.x, s.vel.z);

function runSteps(
  terrain: Terrain,
  s: IcebergState,
  seconds: number,
  steer = 0,
  params: IcebergParams = P,
  dt = DT,
): IcebergStepEvent[] {
  const events: IcebergStepEvent[] = [];
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    for (const e of stepIceberg(s, { steer, source: 'scripted' }, terrain, dt, params, 10 + i * dt)) {
      events.push(e);
    }
  }
  return events;
}

function anchoredHouse(x: number, z: number, radius = 3.5): ObstacleProxy {
  return {
    id: 3,
    kind: 'house',
    part: 'body',
    x,
    y: 0,
    z,
    radius,
    top: 1000,
    bottom: -1000,
    mass: 60,
    vx: 0,
    vy: 0,
    vz: 0,
    anchored: true,
    breakImpulse: Infinity,
    state: 'intact',
  };
}

/** Same analytic terrain, but with a straight course pointing along (dirX, dirZ). */
function withCourse(t: Terrain, dirX: number, dirZ: number): Terrain {
  const l = Math.hypot(dirX, dirZ);
  const dx = dirX / l;
  const dz = dirZ / l;
  const course: CourseFrame = {
    length: t.course.length,
    sampleAt: (s) => ({ s, x: dx * s, z: dz * s, dirX: dx, dirZ: dz, floor: 0, halfWidth: 20 }),
    toWorld: (s, d) => {
      const x = dx * s - dz * d;
      const z = dz * s + dx * d;
      return { x, y: t.heightAt(x, z), z };
    },
    project: (x, z) => ({ s: x * dx + z * dz, d: -x * dz + z * dx }),
  };
  return { ...t, course };
}

describe('external position changes (contact separation, bounds) on slopes', () => {
  it('being pushed downhill by a contact does not launch a fake airborne hop', () => {
    const terrain = createAnalyticTerrain({ height: inclinedPlane(0.6, 300) });
    const s = createIceberg(terrain, P);
    s.vel.z = 3;
    // An anchored house overlapping 1.5 m from uphill: the iceberg is pushed 1.5 m downhill.
    const house = anchoredHouse(0, s.pos.z - (s.radius + 3.5 - 1.5));
    resolveIcebergContacts(s, [house], P);
    expect(s.pos.y - terrain.heightAt(s.pos.x, s.pos.z)).toBeGreaterThan(0.5);
    const events = runSteps(terrain, s, 0.5);
    expect(events.filter((e) => e.type === 'airborne')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'landed')).toHaveLength(0);
    expect(s.pos.y).toBeCloseTo(terrain.heightAt(s.pos.x, s.pos.z), 6);
  });

  it('being pushed uphill by a contact does not make the next move count as a wall', () => {
    const terrain = createAnalyticTerrain({ height: inclinedPlane(0.6, 300) });
    const s = createIceberg(terrain, P);
    s.vel.z = 0.5;
    // House downhill, overlapping 1.5 m: the iceberg is pushed 1.5 m uphill (0.9 m higher ground).
    const house = anchoredHouse(0, s.pos.z + (s.radius + 3.5 - 1.5));
    resolveIcebergContacts(s, [house], P);
    s.vel.x = 4; // now sliding sideways across the slope, away from the house
    s.vel.z = 0;
    s.heading = Math.PI / 2;
    const x0 = s.pos.x;
    runSteps(terrain, s, 0.1);
    // A stale base height would make the first move look like a 0.9 m climb and block it.
    expect(s.pos.x - x0).toBeGreaterThan(0.3);
    expect(s.impact).toBeLessThan(0.05);
  });
});

describe('sea cliffs', () => {
  for (const speed of [3, 15]) {
    it(`sliding off a 10 m sea cliff at ${speed} m/s falls and splashes down (no teleport)`, () => {
      const terrain = createAnalyticTerrain({
        height: (_x, z) => (z < 60 ? 10 : -8),
        seaLevel: 0,
      });
      const s = createIceberg(terrain, P);
      s.pos.z = 50;
      s.pos.y = 10;
      s.vel.z = speed;
      let maxStepDrop = 0;
      let prevY = s.pos.y;
      const events: IcebergStepEvent[] = [];
      for (let i = 0; i < 60 * 8; i++) {
        for (const e of stepIceberg(s, NONE, terrain, DT, P, 10)) events.push(e);
        maxStepDrop = Math.max(maxStepDrop, prevY - s.pos.y);
        prevY = s.pos.y;
      }
      expect(s.inOcean).toBe(true);
      expect(s.pos.y).toBe(0);
      const landed = events.filter((e) => e.type === 'landed');
      expect(events.filter((e) => e.type === 'airborne')).toHaveLength(1);
      expect(landed).toHaveLength(1);
      if (landed[0].type !== 'landed') throw new Error('unreachable');
      expect(landed[0].drop).toBeGreaterThan(9);
      expect(landed[0].drop).toBeLessThan(11);
      // Free fall from 10 m reaches ~14 m/s, i.e. ~0.25 m per step; never a 10 m jump.
      expect(maxStepDrop).toBeLessThan(0.5);
      expect(events.filter((e) => e.type === 'enteredOcean')).toHaveLength(1);
    });
  }

  it('a low beach step (< airborneDrop) still slides straight into the sea', () => {
    const terrain = createAnalyticTerrain({
      height: (_x, z) => (z < 60 ? 0.1 - 0.001 * z : -3),
      seaLevel: 0,
    });
    const s = createIceberg(terrain, P);
    s.vel.z = 8;
    const events = runSteps(terrain, s, 8);
    expect(events.filter((e) => e.type === 'airborne')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'enteredOcean')).toHaveLength(1);
    expect(s.inOcean).toBe(true);
  });
});

describe('blocked moves', () => {
  it('a move blocked by a steep crest never leaves the iceberg frozen in place at speed', () => {
    // Steep 6 m face between z = 99 and 100, then a crest falling away (gradient points back).
    const terrain = createAnalyticTerrain({
      height: (_x, z) => (z < 99.5 ? 10 : 16 - 0.5 * Math.max(0, z - 100)),
    });
    // Disable the look-ahead probes and substeps so only the move check can stop it.
    const tuning = { ...SIM_TUNING, wallProbe: 0, maxSubstepTravel: 100 };
    const s = createIceberg(terrain, P);
    s.pos.z = 98.8;
    s.pos.y = terrain.heightAt(0, 98.8);
    s.vel.z = 30;
    const dt = 0.05;
    let frozenFastSteps = 0;
    for (let i = 0; i < 40; i++) {
      const z0 = s.pos.z;
      stepIceberg(s, NONE, terrain, dt, P, 10, tuning);
      if (Math.abs(s.pos.z - z0) < 1e-9 && s.vel.z > 5) frozenFastSteps++;
    }
    expect(s.pos.z).toBeLessThan(100);
    expect(frozenFastSteps).toBeLessThanOrEqual(1);
  });
});

describe('degenerate params and inputs', () => {
  it('stuckTime = 0 fails as soon as the iceberg is slow after grace', () => {
    const terrain = createAnalyticTerrain({ height: () => 10 });
    const p0 = { ...P, stuckTime: 0, launchSpeed: 0 };
    const s = createIceberg(terrain, p0);
    stepIceberg(s, NONE, terrain, DT, p0, p0.graceTime + 1);
    expect(isStuck(s, p0)).toBe(true);
    expect(stuckFraction(s, p0)).toBe(1);
  });

  it('a state that is already broken on the first step recovers near where it was', () => {
    const terrain = createAnalyticTerrain({ height: inclinedPlane(0.1) });
    const s = createIceberg(terrain, P);
    const z0 = s.pos.z;
    s.vel.x = Number.NaN;
    stepIceberg(s, NONE, terrain, DT, P, 0);
    expect(Number.isFinite(s.vel.x)).toBe(true);
    expect(Math.abs(s.pos.z - z0)).toBeLessThan(1);
  });

  it('large dt values do not tunnel through a ridge', () => {
    const terrain = createAnalyticTerrain({
      height: (_x, z) => 10 + Math.max(0, 6 - Math.abs(z - 100) * 2.5),
    });
    for (const dt of [0.1, 0.25, 0.5]) {
      const s = createIceberg(terrain, P);
      s.vel.z = 30;
      let maxZ = -Infinity;
      for (let t = 0; t < 8; t += dt) {
        stepIceberg(s, NONE, terrain, dt, P, t);
        maxZ = Math.max(maxZ, s.pos.z);
      }
      expect(maxZ).toBeLessThan(100);
    }
  });
});

describe('conventions the renderer and session rely on', () => {
  it('spawns facing an arbitrary course direction and the ocean current follows the course', () => {
    const base = createAnalyticTerrain({ height: () => -5, seaLevel: 0, width: 400 });
    const terrain = withCourse(base, 1, 0); // course runs along +X: heading = +pi/2
    const s = createIceberg(terrain, P);
    expect(s.heading).toBeCloseTo(Math.PI / 2, 9);
    expect(s.vel.x).toBeCloseTo(P.launchSpeed, 9);
    expect(s.vel.z).toBeCloseTo(0, 9);
    s.vel.x = 0;
    const x0 = s.pos.x;
    runSteps(terrain, s, 6);
    expect(s.pos.x - x0).toBeGreaterThan(8);
    expect(Math.abs(s.vel.z)).toBeLessThan(0.5);
  });

  it('pitch is nose-up uphill, roll is right-side-up when ground rises to the right', () => {
    // Facing +Z on ground that rises toward +Z and toward -X (= the right of +Z travel).
    const terrain = createAnalyticTerrain({ height: (x, z) => 50 + 0.2 * z - 0.3 * x });
    // High static friction so it stays put facing +Z instead of sliding (and turning) downhill.
    const sticky = { ...P, friction: 1, launchSpeed: 0 };
    const s = createIceberg(terrain, sticky);
    expect(s.pitch).toBeCloseTo(Math.atan(0.2), 5);
    expect(s.roll).toBeCloseTo(Math.atan(0.3), 5);
    for (let i = 0; i < 30; i++) stepIceberg(s, NONE, terrain, DT, sticky, 0);
    expect(hspeed(s)).toBeLessThan(0.05);
    expect(s.heading).toBeCloseTo(0, 6);
    expect(s.pitch).toBeCloseTo(Math.atan(0.2), 3);
    expect(s.roll).toBeCloseTo(Math.atan(0.3), 3);
  });

  it('turning right gives a negative yawRate and leans the iceberg into the turn (roll < 0)', () => {
    const terrain = createAnalyticTerrain({ height: () => 0, width: 400, length: 400 });
    const s = createIceberg(terrain, P);
    s.vel.z = 15;
    runSteps(terrain, s, 0.6, 1);
    expect(s.yawRate).toBeLessThan(-0.5);
    expect(s.roll).toBeLessThan(-0.05);
  });

  it('steering right in the air bends the flight path to the right (-X)', () => {
    const terrain = createAnalyticTerrain({ height: (_x, z) => (z < 40 ? 80 : 0), length: 300 });
    const s = createIceberg(terrain, P);
    s.pos.z = 38;
    s.pos.y = 80;
    s.vel.z = 20;
    let airborneSteps = 0;
    let xAtLanding = Number.NaN;
    for (let i = 0; i < 60 * 6 && Number.isNaN(xAtLanding); i++) {
      for (const e of stepIceberg(s, { steer: 1, source: 'scripted' }, terrain, DT, P, 10)) {
        if (e.type === 'landed') xAtLanding = s.pos.x;
      }
      if (!s.grounded) airborneSteps++;
    }
    expect(airborneSteps).toBeGreaterThan(60);
    expect(xAtLanding).toBeLessThan(-2);
  });

  it('a contact with a body moving toward the iceberg uses the relative closing speed', () => {
    const terrain = createAnalyticTerrain({ height: () => 0 });
    const s = createIceberg(terrain, P);
    s.pos.z = 50;
    s.vel.x = 0;
    s.vel.z = 5;
    const rock: ObstacleProxy = {
      ...anchoredHouse(0, 50 + s.radius + 1 - 0.1, 1),
      anchored: false,
      mass: 10,
      vz: -7,
      kind: 'boulder',
    };
    const c = resolveIcebergContacts(s, [rock], P);
    expect(c).toHaveLength(1);
    expect(c[0].relSpeed).toBeCloseTo(12, 9);
    const J = 1.25 * 12 * ((30 * 10) / 40);
    expect(c[0].impulse.z).toBeCloseTo(J, 9);
    expect(s.vel.z).toBeCloseTo(5 - J / 30, 9);
  });
});
