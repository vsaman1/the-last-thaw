import { describe, expect, it } from 'vitest';
import { createAnalyticTerrain, inclinedPlane } from '../testing/analyticTerrain';
import type { IcebergParams, IcebergState, ObstacleProxy, ProxyRect } from '../types';
import { DEFAULT_ICEBERG_PARAMS, SIM_TUNING, withLevelIceberg } from './params';
import {
  collectAbsorbable,
  contactTestImpulse,
  createIceberg,
  debrisYield,
  leverMass,
  proxyGap,
  resolveIcebergContacts,
  stepIceberg,
  type ProxyDirection,
} from './iceberg';

/**
 * Bulldozing contacts: a loose body exchanges momentum with the iceberg once, and touching it
 * again shortly after is pushing it. Rubble much lighter than the iceberg, or low against its
 * height, yields (costs the friction of dragging it, no longer holds the iceberg back, is shoved
 * aside); heavy rubble does not, so a small iceberg can still be stopped by it. Long and wide
 * bodies collide as their footprint rectangles.
 */

const DT = 1 / 60;
const T = SIM_TUNING;
const flat = createAnalyticTerrain({ height: () => 0 });
const hspeed = (s: IcebergState): number => Math.hypot(s.vel.x, s.vel.z);

/** Params of a level iceberg of `mass` t (radius 2.2 m × cbrt(mass / 30), as the levels size them). */
const paramsFor = (mass: number): IcebergParams =>
  withLevelIceberg(DEFAULT_ICEBERG_PARAMS, { mass, scale: Math.cbrt(mass / 30) });

function icebergAt(P: IcebergParams, speed: number): IcebergState {
  const s = createIceberg(flat, P);
  s.pos.x = 0;
  s.pos.z = 50;
  s.vel.x = 0;
  s.vel.z = speed;
  s.heading = 0;
  return s;
}

/** A loose body overlapping the iceberg's bow by 0.2 m (x: offset across the line). */
function bodyAhead(s: IcebergState, o: Partial<ObstacleProxy> = {}, x = 0): ObstacleProxy {
  const radius = o.radius ?? 1;
  return {
    id: 11,
    kind: 'house',
    part: 'wall',
    x,
    y: 1,
    z: s.pos.z + Math.sqrt((s.radius + radius - 0.2) ** 2 - x * x),
    radius,
    top: 2.5,
    bottom: 0,
    mass: 4,
    vx: 0,
    vy: 0,
    vz: 0,
    anchored: false,
    breakImpulse: Infinity,
    state: 'broken',
    ...o,
  };
}

const rect = (ux: number, uz: number, hu: number, hv: number): ProxyRect => ({ ux, uz, hu, hv });

describe('proxyGap: distance to a circle or a footprint rectangle', () => {
  const out: ProxyDirection = { nx: 0, nz: 0 };
  const base = bodyAhead(icebergAt(DEFAULT_ICEBERG_PARAMS, 0), { radius: 2 });

  it('circle: centre distance minus radius, direction toward the centre', () => {
    const o = { ...base, x: 3, z: 4 };
    expect(proxyGap(0, 0, o, out)).toBeCloseTo(3, 12);
    expect(out.nx).toBeCloseTo(0.6, 12);
    expect(out.nz).toBeCloseTo(0.8, 12);
  });

  it('rectangle (rotated 90°): faces, corners and the nearest face from inside', () => {
    // Long axis along z: 10 m long (hu 5), 4 m wide (hv 2), centred on (0, 20).
    const o = { ...base, x: 0, z: 20, radius: Math.hypot(5, 2), rect: rect(0, 1, 5, 2) };
    expect(proxyGap(-5, 20, o, out)).toBeCloseTo(3, 12); // beside its long side
    expect(out.nx).toBeCloseTo(1, 12);
    expect(out.nz).toBeCloseTo(0, 12);
    expect(proxyGap(0, 10, o, out)).toBeCloseTo(5, 12); // off its end
    expect(out.nz).toBeCloseTo(1, 12);
    expect(proxyGap(-5, 11, o, out)).toBeCloseTo(5, 12); // off a corner (3, 4, 5)
    expect(out.nx).toBeCloseTo(0.6, 12);
    expect(out.nz).toBeCloseTo(0.8, 12);
    // Inside, 0.5 m from the -x long side: pushed out that way, so the body lies toward +x.
    expect(proxyGap(-1.5, 21, o, out)).toBeCloseTo(-0.5, 12);
    expect(out.nx).toBeCloseTo(1, 12);
    expect(out.nz).toBeCloseTo(0, 12);
  });

  it('a monolith beside a dam breach as a rectangle leaves the 10 m gap a circle closed', () => {
    // A 220 t iceberg at scale 2.2 (radius 4.84 m, Power Valley's) in the middle of a 10 m breach;
    // the neighbour monolith, 7.5 m wide, starts at x = 5 (its circle reaches 0.6 m into the breach).
    const R = withLevelIceberg(DEFAULT_ICEBERG_PARAMS, { mass: 220, scale: 2.2 }).radius;
    const neighbour = { ...base, x: 8.75, z: 0, radius: 4.39, rect: rect(1, 0, 3.74, 2.3) };
    expect(proxyGap(0, 0, neighbour, out)).toBeGreaterThan(R);
    expect(proxyGap(0, 0, { ...neighbour, rect: undefined }, out)).toBeLessThan(R);
  });
});

describe('a loose body: one momentum exchange, then pushing', () => {
  it('the first hit is the plain exchange; touching it again costs at most its ground friction', () => {
    const P = paramsFor(220);
    const s = icebergAt(P, 15);
    const o = bodyAhead(s, { mass: 4 });
    const [first] = resolveIcebergContacts(s, [o], P);
    expect(first.push).toBeUndefined();
    expect(first.speedLoss).toBeCloseTo(contactTestImpulse(15, 220, 4) / 220, 6);
    // The body did not get out of the way (jammed): before, every step cost J / M again.
    const v = hspeed(s);
    const [again] = resolveIcebergContacts(s, [o], P);
    expect(again.push).toBe(true);
    expect(again.speedLoss).toBeLessThanOrEqual((T.pushFriction * 9.81 * DT * 4) / 220 + 1e-9);
    expect(again.speedLoss).toBeLessThan(0.01 * contactTestImpulse(v, 220, 4) / 220 + 0.01);
    // Shoved at most pushAccel, not with a fresh J; no new impact on the ice.
    expect(Math.hypot(again.impulse.x, again.impulse.z)).toBeLessThanOrEqual(T.pushAccel * DT * 4 + 1e-9);
    expect(again.shock).toBeLessThanOrEqual((T.pushFriction * 9.81 * DT * 4) / 220 + 1e-9);
  });

  it('a pushed body straight ahead is shoved to one side (bow wave)', () => {
    const P = paramsFor(220);
    const s = icebergAt(P, 15);
    const o = bodyAhead(s, { mass: 4 });
    resolveIcebergContacts(s, [o], P);
    const [push] = resolveIcebergContacts(s, [o], P);
    const l = Math.hypot(push.impulse.x, push.impulse.z);
    expect(Math.abs(push.impulse.x) / l).toBeGreaterThan(0.4);
  });

  it('pieces of an obstacle the iceberg just broke are pushed from the first touch', () => {
    const P = paramsFor(80);
    const s = icebergAt(P, 12);
    const house = bodyAhead(s, { id: 3, anchored: true, mass: 12, radius: 3, breakImpulse: 500 });
    const [hit] = resolveIcebergContacts(s, [house], P);
    expect(hit.testImpulse).toBeGreaterThan(500);
    const piece = bodyAhead(s, { id: 40, origin: 3, mass: 1.7, radius: 1.2 });
    const [touch] = resolveIcebergContacts(s, [piece], P);
    expect(touch.push).toBe(true);
    expect(touch.speedLoss).toBeLessThan(0.01);
  });

  it('the yield grows with the mass ratio and with how low the body is', () => {
    const s = icebergAt(DEFAULT_ICEBERG_PARAMS, 10); // 30 t, contact height 2.8 m
    const tall = (mass: number): ObstacleProxy => bodyAhead(s, { mass, top: 2, bottom: 0 });
    expect(debrisYield(s, tall(40), 30, true)).toBe(0); // heavier than the iceberg
    expect(debrisYield(s, tall(20), 30, true)).toBeCloseTo(0.5, 9); // two thirds of it
    expect(debrisYield(s, tall(10), 30, true)).toBe(1); // a third of its mass
    expect(debrisYield(s, tall(10), 30, false)).toBe(0); // a fresh hit is a full exchange ...
    const slab = bodyAhead(s, { mass: 40, top: 0.4, bottom: 0 });
    expect(debrisYield(s, slab, 30, false)).toBe(1); // ... unless it is low: ridden over
  });
});

describe('ploughing on a slope (solver only, body pinned where it lies)', () => {
  /**
   * Drive an iceberg of mass M at 12 m/s down a 0.06 slope into a loose body of mass m that never
   * moves (jammed in a pile, against the ground): its speed after 3 s and whether it got past.
   */
  function plough(M: number, m: number, top = 2.5): { speed: number; past: boolean } {
    const terrain = createAnalyticTerrain({ height: inclinedPlane(0.06) });
    const P = paramsFor(M);
    const s = createIceberg(terrain, P);
    s.vel.z = 12;
    const z = s.pos.z + 20;
    const o: ObstacleProxy = { ...bodyAhead(s, { mass: m, radius: 1.2, top: 1000, bottom: -1000 }), z };
    o.top = terrain.heightAt(0, z) + top;
    o.bottom = terrain.heightAt(0, z);
    for (let i = 0; i < 180; i++) {
      stepIceberg(s, { steer: 0, source: 'none' }, terrain, DT, P, 10 + i * DT);
      resolveIcebergContacts(s, [o], P);
    }
    return { speed: hspeed(s), past: s.pos.z > z + s.radius + o.radius };
  }

  it('a 220 t iceberg ploughs through a jammed 4 t piece at almost no cost', () => {
    const r = plough(220, 4);
    expect(r.past).toBe(true);
    expect(r.speed).toBeGreaterThan(11);
  });

  it('heavy rubble still stops a small iceberg: 30 t against a jammed 40 t block', () => {
    const r = plough(30, 40);
    expect(r.past).toBe(false);
    expect(r.speed).toBeLessThan(1);
  });

  it('...but a 30 t iceberg rides over a 40 t slab lying 0.4 m high', () => {
    const r = plough(30, 40, 0.4);
    expect(r.past).toBe(true);
    expect(r.speed).toBeGreaterThan(8);
  });
});

describe('rubble pressed against a standing building passes the push on', () => {
  function pressed(M: number): { ids: number[]; testImpulse: number } {
    const P = paramsFor(M);
    const s = icebergAt(P, 10);
    const debris = bodyAhead(s, { id: 21, mass: 1, radius: 1 });
    const house: ObstacleProxy = {
      ...debris,
      id: 22,
      anchored: true,
      state: 'intact',
      mass: 12,
      radius: 3.5,
      top: 6,
      breakImpulse: 563,
      z: debris.z + debris.radius + 3.5 + 0.1,
    };
    const contacts = resolveIcebergContacts(s, [debris, house], P);
    const h = contacts.find((c) => c.obstacleId === 22);
    return { ids: contacts.map((c) => c.obstacleId), testImpulse: h?.testImpulse ?? 0 };
  }

  it('a 100 t iceberg at 10 m/s breaks the house through the debris in front of it', () => {
    const r = pressed(100);
    expect(r.ids).toEqual([21, 22]);
    expect(r.testImpulse).toBeGreaterThan(563);
  });

  it('a 30 t one (momentum 375 < 563) does not: the debris contact alone', () => {
    expect(pressed(30).ids).toEqual([21]);
  });

  it('a long piece lying across the line only presses what its rectangle touches, not its circle', () => {
    // Regression (engine review): the bounding circle (radius ≈ 6) made a house 3 m beyond the
    // piece's far face count as pressed, so it broke with nothing touching it.
    const P = paramsFor(30);
    const s = icebergAt(P, 12);
    const debris = bodyAhead(s, { id: 31, mass: 1, radius: Math.hypot(6, 0.5), rect: rect(1, 0, 6, 0.5) });
    // bodyAhead overlaps the bow by 0.2 m using the circle radius; put the slab's near face there.
    debris.z = s.pos.z + s.radius - 0.2 + 0.5;
    const house: ObstacleProxy = {
      ...debris,
      id: 32,
      anchored: true,
      state: 'intact',
      mass: 12,
      radius: 1,
      rect: undefined,
      top: 6,
      breakImpulse: 200,
      z: debris.z + 0.5 + 3 + 1,
    };
    expect(resolveIcebergContacts(s, [debris, house], P).map((c) => c.obstacleId)).toEqual([31]);
    // Touching its far face, the same house is pressed and breaks.
    const near = { ...house, z: debris.z + 0.5 + 0.1 + 1 };
    expect(resolveIcebergContacts(icebergAt(P, 12), [debris, near], P).map((c) => c.obstacleId))
      .toEqual([31, 32]);
  });

  it('a building broken directly is not broken again through debris in the same step', () => {
    // Regression (engine review): wall A just touched at the bow and broken first; heavy debris D
    // beside the bow, against A's face, backs the iceberg clear of A, which then counted as pressed
    // and broke a second time (J / M paid twice, two chips).
    const P = paramsFor(100);
    const s = icebergAt(P, 10);
    const wall: ObstacleProxy = {
      ...bodyAhead(s),
      id: 41,
      anchored: true,
      state: 'intact',
      mass: 12,
      x: 0,
      z: s.pos.z + s.radius - 0.19 + 1,
      radius: Math.hypot(6, 1),
      rect: rect(1, 0, 6, 1),
      top: 6,
      breakImpulse: 563,
    };
    const debris: ObstacleProxy = { ...bodyAhead(s), id: 42, mass: 60, x: -1.5, z: wall.z - 2, radius: 1 };
    const contacts = resolveIcebergContacts(s, [wall, debris], P);
    expect(contacts.filter((c) => c.obstacleId === 41)).toHaveLength(1);
    expect(contacts.filter((c) => c.obstacleId === 42)).toHaveLength(1);
  });
});

describe('review fixes: graze memory, glancing pushes, long bodies, glacier ice', () => {
  it('a graze does not make the head-on hit on the same body within a second a free push', () => {
    // 30 t vs a loose 15 t body: a fresh head-on hit at 12 m/s keeps ~7 m/s.
    const fresh = icebergAt(DEFAULT_ICEBERG_PARAMS, 12);
    const body = (s: IcebergState): ObstacleProxy => bodyAhead(s, { mass: 15, radius: 1.5, top: 2 });
    resolveIcebergContacts(fresh, [body(fresh)], DEFAULT_ICEBERG_PARAMS);
    const keepFresh = hspeed(fresh);
    expect(keepFresh).toBeLessThan(8);
    // A 0.3 m/s graze first (sliding past it), then the same body met head-on 0.2 s later.
    const s = icebergAt(DEFAULT_ICEBERG_PARAMS, 12);
    const o = body(s);
    s.vel.x = 12;
    s.vel.z = 0.3 * (s.radius + o.radius) / (o.z - s.pos.z);
    resolveIcebergContacts(s, [o], DEFAULT_ICEBERG_PARAMS);
    const none = { steer: 0, source: 'none' } as const;
    for (let i = 0; i < 12; i++) stepIceberg(s, none, flat, DT, DEFAULT_ICEBERG_PARAMS, 10);
    s.pos.x = 0;
    s.pos.z = 50;
    s.vel.x = 0;
    s.vel.z = 12;
    const [hit] = resolveIcebergContacts(s, [o], DEFAULT_ICEBERG_PARAMS);
    expect(hit.push).toBeUndefined();
    expect(hspeed(s)).toBeCloseTo(keepFresh, 1);
  });

  it('a glancing push on rubble tilted aside never speeds the iceberg up', () => {
    // Regression (engine review): the bow-wave tilt applied to the iceberg too, so with the body
    // beside it (kick · sideways speed > closing speed) every push added a little speed.
    const P = paramsFor(220);
    const s = icebergAt(P, 15);
    const o = bodyAhead(s, { mass: 4, radius: 1 }, 0.98 * (s.radius + 0.8)); // beside the bow
    resolveIcebergContacts(s, [o], P);
    for (let i = 0; i < 30; i++) {
      const before = hspeed(s);
      const [c] = resolveIcebergContacts(s, [o], P);
      expect(c.push).toBe(true);
      expect(hspeed(s)).toBeLessThanOrEqual(before + 1e-12);
    }
  });

  it('leverMass: a long body met off its centre resists with less than its mass', () => {
    const s = icebergAt(paramsFor(100), 10);
    // A 12 m bus (hu 6, hv 1.3) lying across the line.
    const bus = { ...bodyAhead(s, { mass: 10, radius: 6.2 }), rect: rect(1, 0, 6, 1.3) };
    bus.z = s.pos.z + s.radius + 1.3 - 0.2;
    expect(leverMass(s, bus, 0, 1, 0.2)).toBeCloseTo(10, 6); // through its middle
    const end = { ...bus, x: -5.5 }; // met 5.5 m from its centre
    const m = leverMass(s, end, 0, 1, 0.2);
    expect(m).toBeLessThan(10 / (1 + (3 * 5 * 5) / (36 + 1.69)) + 1e-9);
    expect(m).toBeGreaterThan(1);
  });

  it('a long glacier block is absorbed only once its footprint touches, not its bounding circle', () => {
    // Regression (engine review): a 6 x 1.2 m block lying across the line was absorbed up to 0.9 m
    // before it touched.
    const s = icebergAt(DEFAULT_ICEBERG_PARAMS, 5);
    const block: ObstacleProxy = {
      ...bodyAhead(s, { mass: 8, radius: Math.hypot(3, 0.6), top: 1.5 }),
      kind: 'iceBlock',
      part: 'ice',
      absorbable: true,
      rect: rect(1, 0, 3, 0.6),
    };
    const ids: number[] = [];
    block.z = s.pos.z + s.radius + 0.6 + 0.5; // its near face 0.5 m ahead: circle overlaps, block not
    expect(collectAbsorbable(s, [block], ids, DEFAULT_ICEBERG_PARAMS)).toBe(0);
    block.z = s.pos.z + s.radius + 0.6 - 0.1; // touching
    expect(collectAbsorbable(s, [block], ids, DEFAULT_ICEBERG_PARAMS)).toBe(1);
  });
});
