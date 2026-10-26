import { describe, expect, it } from 'vitest';
import { createAnalyticTerrain, inclinedPlane } from '../testing/analyticTerrain';
import { sampleGradient } from '../heightGrid';
import { createRng, fbm2 } from '../rng';
import { wrapAngle } from '../math';
import type {
  IcebergContact,
  IcebergParams,
  IcebergState,
  IcebergStepEvent,
  ObstacleProxy,
  Terrain,
} from '../types';
import { DEFAULT_ICEBERG_PARAMS as P } from './params';
import {
  CONTACT_RESTITUTION,
  contactTestImpulse,
  createIceberg,
  isStuck,
  resolveIcebergContacts,
  stepIceberg,
  stuckFraction,
} from './iceberg';
import { gradientInto } from './surface';

const DT = 1 / 60;
const hspeed = (s: IcebergState): number => Math.hypot(s.vel.x, s.vel.z);

interface RunOptions {
  seconds: number;
  steer?: (t: number, s: IcebergState) => number;
  iceberg?: IcebergState;
  params?: IcebergParams;
  onStep?: (t: number, s: IcebergState, events: readonly IcebergStepEvent[]) => void;
}

/** Fixed-step loop like the session's; `t` is play time (elapsed) before the step. */
function run(terrain: Terrain, o: RunOptions): { s: IcebergState; events: IcebergStepEvent[] } {
  const params = o.params ?? P;
  const s = o.iceberg ?? createIceberg(terrain, params);
  const events: IcebergStepEvent[] = [];
  const steps = Math.round(o.seconds / DT);
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    const steer = o.steer ? o.steer(t, s) : 0;
    const ev = stepIceberg(s, { steer, source: 'scripted' }, terrain, DT, params, t);
    for (const e of ev) events.push(e);
    o.onStep?.(t + DT, s, ev);
  }
  return { s, events };
}

const zigzag = (t: number): number => (Math.floor(t / 0.4) % 2 === 0 ? 1 : -1);

function allFinite(s: IcebergState): boolean {
  const nums = [
    s.pos.x, s.pos.y, s.pos.z, s.vel.x, s.vel.y, s.vel.z, s.heading, s.steer, s.yawRate,
    s.airTime, s.airPeakY, s.stuckTimer, s.pitch, s.roll, s.impact,
  ];
  return nums.every(Number.isFinite);
}

describe('spawn', () => {
  it('spawns on the ground at startS, facing down-course with launchSpeed', () => {
    const terrain = createAnalyticTerrain({ height: inclinedPlane(0.1) });
    const s = createIceberg(terrain, P);
    expect(s.pos.z).toBeCloseTo(terrain.level.startS, 6);
    expect(s.pos.x).toBeCloseTo(0, 6);
    expect(s.pos.y).toBeCloseTo(terrain.heightAt(s.pos.x, s.pos.z), 6);
    expect(s.heading).toBeCloseTo(0, 6);
    expect(s.vel.z).toBeCloseTo(P.launchSpeed, 6);
    expect(s.grounded).toBe(true);
    expect(s.inOcean).toBe(false);
    expect(s.radius).toBe(P.radius);
    expect(s.mass).toBe(P.mass);
  });
});

describe('grounded motion', () => {
  it('accelerates downhill on a 0.12 slope', () => {
    const terrain = createAnalyticTerrain({ height: inclinedPlane(0.12) });
    let v1 = 0;
    let v3 = 0;
    run(terrain, {
      seconds: 3,
      onStep: (t, s) => {
        if (Math.abs(t - 1) < DT / 2) v1 = hspeed(s);
        if (Math.abs(t - 3) < DT / 2) v3 = hspeed(s);
      },
    });
    expect(v3).toBeGreaterThan(v1);
    expect(v3).toBeGreaterThan(8);
  });

  it('cruises at a terminal speed in the 14-24 m/s band on 0.06-0.09 slopes', () => {
    for (const [slope, lo, hi] of [
      [0.06, 13.5, 17],
      [0.09, 21, 25],
    ]) {
      const terrain = createAnalyticTerrain({
        height: inclinedPlane(slope, 500),
        length: 4500,
        width: 60,
        cellSize: 5,
      });
      const { s } = run(terrain, { seconds: 150 });
      expect(hspeed(s)).toBeGreaterThan(lo);
      expect(hspeed(s)).toBeLessThan(hi);
    }
  });

  it('on flat ground slows down and becomes stuck after grace + stuckTime', () => {
    const terrain = createAnalyticTerrain({ height: () => 10 });
    let firstStuck = -1;
    let maxFractionInGrace = 0;
    const { s } = run(terrain, {
      seconds: 30,
      onStep: (t, st) => {
        if (t <= P.graceTime) maxFractionInGrace = Math.max(maxFractionInGrace, stuckFraction(st, P));
        if (firstStuck < 0 && isStuck(st, P)) firstStuck = t;
      },
    });
    expect(maxFractionInGrace).toBe(0);
    expect(firstStuck).toBeGreaterThanOrEqual(P.graceTime + P.stuckTime);
    expect(isStuck(s, P)).toBe(true);
    expect(stuckFraction(s, P)).toBe(1);
    expect(hspeed(s)).toBeLessThan(P.stuckSpeed);

    // Speed recovering drains the stuck timer quickly.
    s.vel.z = 12;
    run(terrain, { seconds: 1.2, iceberg: s, steer: () => 0 });
    expect(stuckFraction(s, P)).toBe(0);
  });

  it('steering right moves the iceberg to its right (-X on the +Z course), left to +X', () => {
    const terrain = createAnalyticTerrain({ height: inclinedPlane(0.1) });
    const right = run(terrain, { seconds: 4, steer: (t) => (t < 1.5 ? 1 : 0) }).s;
    expect(right.pos.x).toBeLessThan(-3);
    expect(right.heading).toBeLessThan(0);
    const left = run(terrain, { seconds: 4, steer: (t) => (t < 1.5 ? -1 : 0) }).s;
    expect(left.pos.x).toBeGreaterThan(3);
    expect(left.heading).toBeGreaterThan(0);
  });

  it('a hard zig-zag bleeds >= 15% speed versus straight, a gentle turn costs less', () => {
    const terrain = createAnalyticTerrain({ height: inclinedPlane(0.08) });
    const straight = hspeed(run(terrain, { seconds: 8 }).s);
    const zig = hspeed(run(terrain, { seconds: 8, steer: zigzag }).s);
    const gentle = run(terrain, { seconds: 8, steer: () => 0.1 }).s;
    expect(zig).toBeLessThanOrEqual(0.85 * straight);
    expect(gentle.heading).toBeLessThan(-0.2); // it really turned
    expect(straight - hspeed(gentle)).toBeLessThan(straight - zig);
  });

  it('at cruising speed a U-turn stalls the iceberg', () => {
    const terrain = createAnalyticTerrain({ height: () => 0, length: 600, width: 600 });
    const s = createIceberg(terrain, P);
    s.vel.z = 20;
    let minSpeed = Infinity;
    run(terrain, {
      seconds: 4,
      iceberg: s,
      steer: () => 1,
      onStep: (_t, st) => {
        minSpeed = Math.min(minSpeed, hspeed(st));
      },
    });
    expect(minSpeed).toBeLessThan(5);
  });
});

describe('airborne', () => {
  it('flies off a 15 m cliff, lands with drop ~15 m and keeps its horizontal speed', () => {
    const cliffZ = 120;
    const terrain = createAnalyticTerrain({
      height: (_x, z) => 60 - 0.08 * z - (z >= cliffZ ? 15 : 0),
      length: 300,
    });
    let speedAtLaunch = -1;
    let speedAfterLanding = -1;
    let landedAt = -1;
    const { events } = run(terrain, {
      seconds: 20,
      onStep: (t, s, ev) => {
        for (const e of ev) {
          if (e.type === 'airborne' && speedAtLaunch < 0) speedAtLaunch = e.speed;
          if (e.type === 'landed' && landedAt < 0) landedAt = t;
        }
        if (landedAt > 0 && speedAfterLanding < 0 && t > landedAt + DT / 2) speedAfterLanding = hspeed(s);
      },
    });
    const airborne = events.filter((e) => e.type === 'airborne');
    const landed = events.filter((e) => e.type === 'landed');
    expect(airborne.length).toBe(1);
    expect(landed.length).toBe(1);
    const l = landed[0];
    if (l.type !== 'landed') throw new Error('unreachable');
    expect(l.drop).toBeGreaterThan(12);
    expect(l.drop).toBeLessThan(18);
    expect(l.pos.z).toBeGreaterThan(cliffZ);
    expect(speedAtLaunch).toBeGreaterThan(5);
    expect(l.speed).toBeGreaterThanOrEqual(0.9 * speedAtLaunch);
    expect(speedAfterLanding).toBeGreaterThanOrEqual(0.9 * speedAtLaunch);
  });

  it('does not hop on a smooth slope or on gentle bumps', () => {
    const terrain = createAnalyticTerrain({
      height: (x, z) => 80 - 0.1 * z + 0.15 * Math.sin(z / 9) + 0.1 * Math.sin(x / 7),
    });
    const { events } = run(terrain, { seconds: 15 });
    expect(events.filter((e) => e.type === 'airborne').length).toBe(0);
  });
});

describe('ocean', () => {
  it('floats at sea level and drifts out with the current from low speed', () => {
    const terrain = createAnalyticTerrain({ height: () => -5, seaLevel: 0 });
    const s = createIceberg(terrain, P);
    expect(s.inOcean).toBe(true);
    s.vel.x = 0;
    s.vel.z = 0.5;
    const z0 = s.pos.z;
    let oceanEvents = 0;
    let alwaysAtSea = true;
    run(terrain, {
      seconds: 10,
      iceberg: s,
      onStep: (_t, st, ev) => {
        oceanEvents += ev.filter((e) => e.type === 'enteredOcean').length;
        if (st.pos.y !== 0 || !st.inOcean) alwaysAtSea = false;
      },
    });
    expect(alwaysAtSea).toBe(true);
    expect(s.pos.y).toBe(0);
    expect(s.pos.z - z0).toBeGreaterThan(15);
    expect(s.vel.z).toBeGreaterThan(3);
    expect(oceanEvents).toBe(1);
    expect(isStuck(s, P)).toBe(false);
  });

  it('slides off the beach into the sea, emits enteredOcean once and keeps going', () => {
    const terrain = createAnalyticTerrain({ height: inclinedPlane(0.12, 6), seaLevel: 0 });
    const { s, events } = run(terrain, { seconds: 20 });
    expect(events.filter((e) => e.type === 'enteredOcean').length).toBe(1);
    expect(s.inOcean).toBe(true);
    expect(s.pos.y).toBe(0);
    expect(s.pos.z).toBeGreaterThan(80);
    expect(s.vel.z).toBeGreaterThan(3);
  });

  it('a waterfall straight into the sea splashes down and floats', () => {
    const terrain = createAnalyticTerrain({
      height: (_x, z) => (z < 60 ? 20 - 0.1 * z : -8),
      seaLevel: 0,
    });
    const { s, events } = run(terrain, { seconds: 12 });
    const landed = events.filter((e) => e.type === 'landed');
    expect(events.filter((e) => e.type === 'airborne')).toHaveLength(1);
    expect(landed).toHaveLength(1);
    expect(landed[0].pos.y).toBe(0);
    expect(events.filter((e) => e.type === 'enteredOcean')).toHaveLength(1);
    expect(s.inOcean).toBe(true);
    expect(s.pos.y).toBe(0);
    expect(s.vel.z).toBeGreaterThan(3);
  });

  it('steering still works in the ocean', () => {
    const terrain = createAnalyticTerrain({ height: () => -5, seaLevel: 0 });
    const s = createIceberg(terrain, P);
    s.vel.z = 10;
    run(terrain, { seconds: 3, iceberg: s, steer: () => 1 });
    expect(s.pos.x).toBeLessThan(-2);
  });
});

describe('terrain walls', () => {
  it('driving straight into a steep ridge at 25 m/s never ends up on the far side', () => {
    const ridgeZ = 100;
    const terrain = createAnalyticTerrain({
      height: (_x, z) => 10 + Math.max(0, 6 - Math.abs(z - ridgeZ) * 2.5),
    });
    for (const vx of [0, 6, -12]) {
      const s = createIceberg(terrain, P);
      s.vel.x = vx;
      s.vel.z = Math.sqrt(25 * 25 - vx * vx);
      s.heading = Math.atan2(s.vel.x, s.vel.z);
      let maxZ = -Infinity;
      run(terrain, {
        seconds: 12,
        iceberg: s,
        onStep: (_t, st) => {
          maxZ = Math.max(maxZ, st.pos.z);
        },
      });
      expect(maxZ).toBeLessThan(ridgeZ);
      expect(allFinite(s)).toBe(true);
    }
  });

  it('cannot climb a tall cliff wall even with gravity pushing it in', () => {
    const wallZ = 200;
    const terrain = createAnalyticTerrain({
      height: (_x, z) => 100 - 0.1 * z + Math.min(40, Math.max(0, (z - wallZ) * 3)),
    });
    const s = createIceberg(terrain, P);
    s.vel.z = 25;
    let maxZ = -Infinity;
    let maxRise = -Infinity;
    run(terrain, {
      seconds: 20,
      iceberg: s,
      onStep: (_t, st) => {
        maxZ = Math.max(maxZ, st.pos.z);
        maxRise = Math.max(maxRise, st.pos.y - (100 - 0.1 * st.pos.z));
      },
    });
    expect(maxZ).toBeLessThan(wallZ + 1);
    expect(maxRise).toBeLessThan(2);
  });
});

describe('obstacle contacts (shared impulse rule)', () => {
  const flat = createAnalyticTerrain({ height: () => 0 });

  function icebergAt(speed: number): IcebergState {
    const s = createIceberg(flat, P);
    s.pos.x = 0;
    s.pos.z = 50;
    s.vel.x = 0;
    s.vel.z = speed;
    s.heading = 0;
    return s;
  }

  function proxyAhead(s: IcebergState, o: Partial<ObstacleProxy>): ObstacleProxy {
    const radius = o.radius ?? 0.8;
    return {
      id: 7,
      kind: 'rockSmall',
      part: 'stone',
      x: 0,
      y: 0.4,
      z: s.pos.z + s.radius + radius - 0.2,
      radius,
      top: 1.2,
      bottom: 0,
      mass: 1,
      vx: 0,
      vy: 0,
      vz: 0,
      anchored: false,
      breakImpulse: Infinity,
      state: 'loose',
      ...o,
    };
  }

  const J = (vn: number, m: number): number => (1 + 0.25) * vn * ((30 * m) / (30 + m));

  it('uses J = (1 + e) vn Mm/(M+m) with e = 0.25', () => {
    expect(CONTACT_RESTITUTION).toBe(0.25);
    expect(contactTestImpulse(15, 30, 0.8)).toBeCloseTo(J(15, 0.8), 9);
    expect(contactTestImpulse(-3, 30, 5)).toBe(0);
  });

  it('a light loose rock (m = 0.8) at 15 m/s costs < 1.5 m/s', () => {
    const s = icebergAt(15);
    const c = resolveIcebergContacts(s, [proxyAhead(s, { mass: 0.8 })], P);
    expect(c).toHaveLength(1);
    expect(c[0].speedLoss).toBeLessThan(1.5);
    expect(c[0].speedLoss).toBeGreaterThan(0);
    expect(c[0].relSpeed).toBeCloseTo(15, 9);
    expect(c[0].impulse.z).toBeCloseTo(J(15, 0.8), 9);
    expect(c[0].impulse.y).toBeCloseTo(0.2 * J(15, 0.8), 9);
    expect(c[0].normal.z).toBeCloseTo(1, 9);
    expect(15 - hspeed(s)).toBeCloseTo(J(15, 0.8) / 30, 9);
  });

  it('a heavy loose boulder (m = 22) costs > 5 m/s', () => {
    const s = icebergAt(15);
    const c = resolveIcebergContacts(s, [proxyAhead(s, { kind: 'boulder', mass: 22, radius: 1.6 })], P);
    expect(c).toHaveLength(1);
    expect(c[0].speedLoss).toBeGreaterThan(5);
  });

  it('an anchored body with a huge breakImpulse bounces the iceberg and reports J < breakImpulse', () => {
    const s = icebergAt(15);
    const o = proxyAhead(s, {
      kind: 'house',
      part: 'wall',
      mass: 40,
      radius: 3,
      top: 6,
      anchored: true,
      breakImpulse: 5000,
      state: 'intact',
    });
    const c = resolveIcebergContacts(s, [o], P);
    expect(c).toHaveLength(1);
    expect(s.vel.z).toBeLessThanOrEqual(0.3 * 15);
    const mag = Math.hypot(c[0].impulse.x, c[0].impulse.y, c[0].impulse.z);
    expect(mag).toBeCloseTo(J(15, 40), 6);
    expect(mag).toBeLessThan(o.breakImpulse);
    // Pushed out of penetration.
    expect(Math.hypot(o.x - s.pos.x, o.z - s.pos.z)).toBeGreaterThanOrEqual(s.radius + o.radius - 1e-9);
    expect(s.impact).toBeGreaterThan(0.5);
  });

  it('an anchored body with a small breakImpulse breaks and the iceberg keeps most speed', () => {
    const s = icebergAt(15);
    const o = proxyAhead(s, {
      kind: 'pine',
      part: 'trunk',
      mass: 3,
      radius: 0.5,
      top: 9,
      anchored: true,
      breakImpulse: 20,
      state: 'intact',
    });
    const c = resolveIcebergContacts(s, [o], P);
    expect(c).toHaveLength(1);
    const mag = Math.hypot(c[0].impulse.x, c[0].impulse.y, c[0].impulse.z);
    expect(mag).toBeGreaterThanOrEqual(o.breakImpulse);
    expect(hspeed(s)).toBeGreaterThan(0.8 * 15);
  });

  it('skips bodies it passes over or under, separating ones, and survives coincident centres', () => {
    const s = icebergAt(15);
    const low = proxyAhead(s, { top: s.pos.y - 0.5, bottom: s.pos.y - 1.5 });
    const high = proxyAhead(s, { bottom: s.pos.y + 3, top: s.pos.y + 5 });
    const behind = { ...proxyAhead(s, {}), z: s.pos.z - 2 };
    expect(resolveIcebergContacts(s, [low, high, behind], P)).toHaveLength(0);
    expect(hspeed(s)).toBe(15);

    const still = icebergAt(0);
    const same = {
      ...proxyAhead(still, { anchored: true, mass: 10, breakImpulse: Infinity }),
      z: still.pos.z,
    };
    resolveIcebergContacts(still, [same], P);
    expect(allFinite(still)).toBe(true);
    expect(Math.hypot(same.x - still.pos.x, same.z - still.pos.z)).toBeGreaterThanOrEqual(
      still.radius + same.radius - 1e-9,
    );
  });

  it('never lets the iceberg pass through an immovable house over many steps', () => {
    const terrain = createAnalyticTerrain({ height: inclinedPlane(0.1) });
    const s = createIceberg(terrain, P);
    s.vel.z = 25;
    const house: ObstacleProxy = {
      id: 1,
      kind: 'house',
      part: 'body',
      x: 0,
      y: 0,
      z: 80,
      radius: 3.5,
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
    let minDist = Infinity;
    for (let i = 0; i < 60 * 10; i++) {
      stepIceberg(s, { steer: 0, source: 'none' }, terrain, DT, P, i * DT);
      resolveIcebergContacts(s, [house], P);
      minDist = Math.min(minDist, Math.hypot(s.pos.x - house.x, s.pos.z - house.z));
    }
    expect(s.pos.z).toBeLessThan(house.z);
    expect(minDist).toBeGreaterThanOrEqual(s.radius + house.radius - 1e-6);
  });

  it('cannot be driven through a heavy loose boulder that is pinned in place', () => {
    const terrain = createAnalyticTerrain({ height: inclinedPlane(0.3, 200) });
    const s = createIceberg(terrain, P);
    s.vel.z = 20;
    const rock: ObstacleProxy = {
      id: 2,
      kind: 'boulder',
      part: 'stone',
      x: 0,
      y: 0,
      z: 70,
      radius: 1.8,
      top: 1000,
      bottom: -1000,
      mass: 22,
      vx: 0,
      vy: 0,
      vz: 0,
      anchored: false,
      breakImpulse: Infinity,
      state: 'loose',
    };
    let minDist = Infinity;
    let passedThrough = false;
    for (let i = 0; i < 60 * 40; i++) {
      stepIceberg(s, { steer: 0, source: 'none' }, terrain, DT, P, i * DT);
      resolveIcebergContacts(s, [rock], P);
      minDist = Math.min(minDist, Math.hypot(s.pos.x - rock.x, s.pos.z - rock.z));
      if (s.pos.z > rock.z && Math.abs(s.pos.x - rock.x) < 0.5 * (s.radius + rock.radius)) {
        passedThrough = true;
      }
    }
    expect(minDist).toBeGreaterThan(0.6 * (s.radius + rock.radius));
    expect(passedThrough).toBe(false);
  });
});

describe('stuck rule (review fixes)', () => {
  const NONE = { steer: 0, source: 'none' } as const;

  it('a slow iceberg gaining speed on the gentlest level slope (0.056) is not failed', () => {
    const terrain = createAnalyticTerrain({ height: inclinedPlane(0.056), length: 600 });
    const s = createIceberg(terrain, P);
    s.vel.z = 0.3;
    let maxFraction = 0;
    let stuck = false;
    for (let i = 0; i < 60 * 15; i++) {
      stepIceberg(s, NONE, terrain, DT, P, P.graceTime + 1 + i * DT);
      maxFraction = Math.max(maxFraction, stuckFraction(s, P));
      stuck ||= isStuck(s, P);
    }
    expect(stuck).toBe(false);
    expect(maxFraction).toBeLessThan(0.5);
    expect(hspeed(s)).toBeGreaterThan(2);
  });

  it('an iceberg held against an immovable body on a slope still fails within a few seconds', () => {
    const terrain = createAnalyticTerrain({ height: inclinedPlane(0.08) });
    const s = createIceberg(terrain, P);
    const wall: ObstacleProxy = {
      id: 9,
      kind: 'house',
      part: 'house',
      x: 0,
      y: 0,
      z: 40,
      radius: 3.5,
      top: 1000,
      bottom: -1000,
      mass: 12,
      vx: 0,
      vy: 0,
      vz: 0,
      anchored: true,
      breakImpulse: Infinity,
      state: 'intact',
    };
    let firstContact = -1;
    let lastMoving = -1;
    let failedAt = -1;
    for (let i = 0; i < 60 * 20 && failedAt < 0; i++) {
      const t = P.graceTime + 1 + i * DT;
      stepIceberg(s, NONE, terrain, DT, P, t);
      if (resolveIcebergContacts(s, [wall], P).length > 0 && firstContact < 0) firstContact = t;
      if (hspeed(s) > 0.5) lastMoving = t;
      if (isStuck(s, P)) failedAt = t;
    }
    expect(firstContact).toBeGreaterThan(0);
    expect(failedAt).toBeGreaterThan(firstContact);
    // It bounces back and slides into the wall again (visible motion), then fails once at rest.
    expect(failedAt - firstContact).toBeLessThan(P.stuckTime + 5);
    expect(failedAt - lastMoving).toBeLessThan(P.stuckTime + 0.5);
  });
});

describe('wriggling free at crawl speed (review fixes)', () => {
  const wall = (z: number): ObstacleProxy => ({
    id: 5,
    kind: 'pine',
    part: 'trunk',
    x: 0.3,
    y: 0,
    z,
    radius: 0.6,
    top: 1000,
    bottom: -1000,
    mass: 2,
    vx: 0,
    vy: 0,
    vz: 0,
    anchored: true,
    breakImpulse: Infinity,
    state: 'intact',
  });

  function pinnedRun(steer: (t: number) => number): { stuck: boolean; passed: boolean } {
    const terrain = createAnalyticTerrain({ height: inclinedPlane(0.08) });
    const s = createIceberg(terrain, P);
    const tree = wall(30);
    let stuck = false;
    let hitAt = -1;
    for (let i = 0; i < 60 * 15 && !stuck && s.pos.z < tree.z + 5; i++) {
      const t = i * DT;
      const st = hitAt >= 0 && t > hitAt + 0.3 ? steer(t - hitAt) : 0;
      stepIceberg(s, { steer: st, source: 'scripted' }, terrain, DT, P, P.graceTime + 1 + t);
      if (resolveIcebergContacts(s, [tree], P).length > 0 && hitAt < 0) hitAt = t;
      stuck = isStuck(s, P);
    }
    return { stuck, passed: s.pos.z > tree.z + 5 };
  }

  it('after a slow head-on hit on a tree, steering for open floor gets round it; no input fails', () => {
    // Hold a key toward open floor for 2.5 s after a 0.3 s reaction, then let go.
    const left = pinnedRun((t) => (t < 2.8 ? -1 : 0));
    const right = pinnedRun((t) => (t < 2.8 ? 1 : 0));
    const none = pinnedRun(() => 0);
    expect(left).toEqual({ stuck: false, passed: true });
    expect(right).toEqual({ stuck: false, passed: true });
    expect(none.stuck).toBe(true);
  });

  it('wriggling cannot keep an iceberg alive on flat ground (it still ends stuck)', () => {
    const flatT = createAnalyticTerrain({ height: () => 10, width: 400, length: 400 });
    for (const steer of [(): number => 1, (t: number): number => (Math.floor(t / 1.5) % 2 ? 1 : -1)]) {
      const s = createIceberg(flatT, { ...P, launchSpeed: 0 });
      s.pos.z = 200;
      let stuckAt = -1;
      for (let i = 0; i < 60 * 40 && stuckAt < 0; i++) {
        const t = i * DT;
        stepIceberg(s, { steer: steer(t), source: 'scripted' }, flatT, DT, P, P.graceTime + 1 + t);
        if (isStuck(s, P)) stuckAt = t;
      }
      expect(stuckAt).toBeGreaterThan(0);
      expect(stuckAt).toBeLessThan(15);
    }
  });
});

describe('turn cost (review fixes)', () => {
  // Frictionless, dragless flat plane: every lost m/s is a steering cost.
  const plane = createAnalyticTerrain({ height: () => 50, width: 1500, length: 1500 });
  const P0: IcebergParams = { ...P, friction: 0, drag: 0, launchSpeed: 18 };

  function turnRun(
    steer: (t: number) => number,
    done: (turned: number, t: number) => boolean,
  ): { keep: number; turned: number } {
    const s = createIceberg(plane, P0);
    s.pos.z = 700;
    let turned = 0;
    let t = 0;
    while (!done(turned, t) && t < 60) {
      const before = s.heading;
      stepIceberg(s, { steer: steer(t), source: 'scripted' }, plane, DT, P0, 10 + t);
      turned += Math.abs(wrapAngle(s.heading - before));
      t += DT;
    }
    return { keep: hspeed(s) / P0.launchSpeed, turned };
  }

  it('a gentle curve keeps clearly more speed than a zig-zag with the same total heading change', () => {
    const zig = turnRun((t) => (Math.floor(t / 0.25) % 2 === 0 ? 1 : -1), (_h, t) => t >= 6);
    const gentle = turnRun(() => 0.1, (h) => h >= zig.turned);
    const gentle90 = turnRun(() => 0.1, (h) => h >= Math.PI / 2);
    const sharp90 = turnRun(() => 1, (h) => h >= Math.PI / 2);
    expect(zig.turned).toBeGreaterThan(1);
    expect(gentle90.keep).toBeGreaterThan(0.88);
    expect(sharp90.keep).toBeLessThan(gentle90.keep - 0.1);
    expect(gentle.keep - zig.keep).toBeGreaterThan(0.1);
  });
});

describe('heavy debris (review fixes)', () => {
  const flatT = createAnalyticTerrain({ height: () => 0 });

  function hit(mass: number, radius: number, offsetX: number): { c: IcebergContact; s: IcebergState } {
    const s = createIceberg(flatT, P);
    s.pos.x = 0;
    s.pos.z = 50;
    s.vel.x = 0;
    s.vel.z = 12;
    s.heading = 0;
    const o: ObstacleProxy = {
      id: 4,
      kind: 'boulder',
      part: 'boulder',
      x: offsetX,
      y: 1,
      z: 50 + Math.sqrt((s.radius + radius - 0.2) ** 2 - offsetX * offsetX),
      radius,
      top: 2,
      bottom: 0,
      mass,
      vx: 0,
      vy: 0,
      vz: 0,
      anchored: false,
      breakImpulse: Infinity,
      state: 'loose',
    };
    const contacts = resolveIcebergContacts(s, [o], P);
    expect(contacts).toHaveLength(1);
    return { c: contacts[0], s };
  }

  it('a heavy loose body hit off-centre is shoved out of the line, not ahead of the iceberg', () => {
    // Boulder slightly right of the line (right of +Z travel is -X).
    const { c, s } = hit(25, 2.5, -1);
    const jl = Math.hypot(c.impulse.x, c.impulse.z);
    expect(c.normal.x).toBeLessThan(0);
    expect(c.impulse.x / jl).toBeLessThan(c.normal.x - 0.2);
    // Same J as the shared rule, applied equal and opposite: the iceberg veers left (+X).
    const J = contactTestImpulse(c.relSpeed, 30, 25);
    expect(jl).toBeCloseTo(J, 9);
    expect(s.vel.x).toBeCloseTo(-c.impulse.x / 30, 9);
    expect(s.vel.z).toBeCloseTo(12 - c.impulse.z / 30, 9);
    expect(s.vel.x).toBeGreaterThan(0);
  });

  it('light rocks are still pushed straight along the contact normal', () => {
    const { c } = hit(0.8, 0.8, -1);
    const jl = Math.hypot(c.impulse.x, c.impulse.z);
    expect(c.impulse.x / jl).toBeCloseTo(c.normal.x, 9);
    expect(c.impulse.z / jl).toBeCloseTo(c.normal.z, 9);
  });
});

describe('robustness', () => {
  it('60 s of seeded random input on rough terrain never produces NaN or leaves bounds', () => {
    const seed = 1234;
    const terrain = createAnalyticTerrain({
      height: (x, z) =>
        120 -
        0.09 * z +
        6 * fbm2(x / 25, z / 25, seed) +
        (z > 150 ? -12 : 0) +
        (z > 260 ? -8 : 0) +
        Math.max(0, Math.abs(x) - 22) * 2.2,
      length: 500,
      width: 100,
      cellSize: 2,
      seaLevel: 50,
    });
    const rng = createRng(seed);
    const s = createIceberg(terrain, P);
    let steer = 0;
    let nextChange = 0;
    const b = terrain.level.bounds;
    let ok = true;
    for (let i = 0; i < 60 * 60; i++) {
      const t = i * DT;
      if (t >= nextChange) {
        steer = rng() * 2 - 1;
        if (rng() < 0.2) steer = rng() < 0.5 ? -1 : 1;
        nextChange = t + 0.1 + rng() * 0.9;
      }
      stepIceberg(s, { steer, source: 'scripted' }, terrain, DT, P, t);
      if (rng() < 0.05) {
        const a = rng() * Math.PI * 2;
        const proxy: ObstacleProxy = {
          id: i,
          kind: 'boulder',
          part: 'stone',
          x: s.pos.x + Math.sin(a) * rng() * 3,
          y: s.pos.y,
          z: s.pos.z + Math.cos(a) * rng() * 3,
          radius: 0.5 + rng() * 2,
          top: s.pos.y + 2,
          bottom: s.pos.y,
          mass: rng() < 0.1 ? 0 : 0.5 + rng() * 40,
          vx: (rng() - 0.5) * 10,
          vy: 0,
          vz: (rng() - 0.5) * 10,
          anchored: rng() < 0.5,
          breakImpulse: rng() < 0.3 ? Infinity : rng() * 400,
          state: 'intact',
        };
        resolveIcebergContacts(s, [proxy], P);
      }
      if (!allFinite(s)) ok = false;
      if (s.pos.x < b.minX || s.pos.x > b.maxX || s.pos.z < b.minZ || s.pos.z > b.maxZ) ok = false;
    }
    expect(ok).toBe(true);
    // Garbage input is ignored rather than propagated.
    stepIceberg(s, { steer: Number.NaN, source: 'scripted' }, terrain, DT, P, 61);
    stepIceberg(s, { steer: 1, source: 'scripted' }, terrain, Number.NaN, P, 61);
    expect(allFinite(s)).toBe(true);
  });

  it('returns fresh event positions and a frozen shared empty list when nothing happened', () => {
    const terrain = createAnalyticTerrain({ height: inclinedPlane(0.1) });
    const s = createIceberg(terrain, P);
    const ev = stepIceberg(s, { steer: 0, source: 'none' }, terrain, DT, P, 0);
    expect(ev).toHaveLength(0);
    expect(Object.isFrozen(ev)).toBe(true);

    const cliff = createAnalyticTerrain({ height: (_x, z) => (z < 14 ? 50 : 30) });
    const c = createIceberg(cliff, P);
    c.vel.z = 12;
    const { events } = run(cliff, { seconds: 3, iceberg: c });
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(e.pos).not.toBe(c.pos);
  });

  it('gradientInto matches heightGrid.sampleGradient everywhere, including off-grid', () => {
    const terrain = createAnalyticTerrain({
      height: (x, z) => 30 * fbm2(x / 13, z / 17, 5),
      cellSize: 2.5,
    });
    const rng = createRng(99);
    const out = { dx: 0, dz: 0 };
    for (let i = 0; i < 2000; i++) {
      const x = -80 + rng() * 160;
      const z = -40 + rng() * 480;
      const ref = sampleGradient(terrain.grid, x, z);
      gradientInto(terrain.grid, x, z, out);
      expect(out.dx).toBeCloseTo(ref.dx, 9);
      expect(out.dz).toBeCloseTo(ref.dz, 9);
    }
  });
});
