import { Quaternion, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAnalyticTerrain, inclinedPlane } from '../testing/analyticTerrain';
import type {
  IcebergContact,
  ObstacleKind,
  ObstaclePlacement,
  ObstacleProxy,
  ProxyRect,
  Terrain,
} from '../types';
import { CONTACT_RESTITUTION, ICE, momentumBreakSpeed } from '../obstacles/catalog';
import { getGeom, scaledPoints } from '../obstacles/shapes';
import { createIceberg, resolveIcebergContacts } from '../sim/iceberg';
import { DEFAULT_ICEBERG_PARAMS, withLevelIceberg } from '../sim/params';
import { PHYSICS_TUNING } from './tuning';
import {
  boxMeetsProxy,
  createPhysicsWorld,
  elongatedRect,
  initRapier,
  type ObstacleBody,
  type PhysicsWorld,
} from './world';

/**
 * Proxies of long and wide bodies (footprint rectangles), where a push on a long body lands,
 * dams standing on uneven ground, and ice chunks breaking off the iceberg's flanks.
 */

const DT = 1 / 60;
const E = CONTACT_RESTITUTION;

beforeAll(async () => {
  await initRapier();
});

function terrainWith(obstacles: ObstaclePlacement[], height = inclinedPlane(0.06, 200)): Terrain {
  return createAnalyticTerrain({ height, cellSize: 2, length: 400, width: 160, level: { obstacles } });
}

function run(w: PhysicsWorld, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    w.step(DT);
    w.drainEvents();
  }
}

const ofKind = (w: PhysicsWorld, kind: ObstacleKind, part?: string): ObstacleBody[] =>
  w.bodies.filter((b) => b.active && b.kind === kind && (part === undefined || b.part === part));

/** Head-on contact (along +z unless given) as the solver makes it, applied at `point`. */
function hit(b: ObstacleBody, vn: number, M: number, point?: { x: number; z: number }): IcebergContact {
  const m = b.mass;
  const J = (1 + E) * vn * ((M * m) / (M + m));
  const p = b.proxy;
  return {
    obstacleId: b.id,
    impulse: { x: 0, y: 0.2 * J, z: J },
    point: { x: point?.x ?? p.x, y: Math.min(p.top, p.bottom + 1.2), z: point?.z ?? p.z - p.radius },
    normal: { x: 0, y: 0, z: 1 },
    relSpeed: vn,
    speedLoss: 0,
    testImpulse: b.anchored ? (1 + E) * vn * M : J,
    shock: J / M,
  };
}

describe('footprint rectangles for long and wide bodies', () => {
  it('elongatedRect: the exact footprint of an upright box at any yaw; none for a squarish one', () => {
    const out: ProxyRect = { ux: 0, uz: 0, hu: 0, hv: 0 };
    const a = Math.PI / 6;
    // A 10 x 3 x 4 m box (half 5, 1.5, 2) yawed by 30°: its x axis is (cos, -sin) in x/z.
    const c = Math.cos(a);
    const s = Math.sin(a);
    expect(elongatedRect(5 * c, -5 * s, 0, 0, 2 * s, 2 * c, out)).toBe(true);
    expect(out.hu).toBeCloseTo(5, 9);
    expect(out.hv).toBeCloseTo(2, 9);
    expect(Math.abs(out.ux * c - out.uz * s)).toBeCloseTo(1, 9);
    // 5 x 4.5: a circle does.
    expect(elongatedRect(2.5, 0, 0, 0, 0, 2.25, out)).toBe(false);
    expect(PHYSICS_TUNING.rectAspect).toBeGreaterThan(1.1);
  });

  it('boxMeetsProxy: a vehicle box against a lying bus (rectangle), a skewed deck and a disc', () => {
    // A bus on its side: 12 x 3 m footprint along x, centred at the origin.
    const bus = { x: 0, z: 0, radius: Math.hypot(6, 1.5), rect: { ux: 1, uz: 0, hu: 6, hv: 1.5 } };
    const proxy = (p: object): ObstacleProxy => p as ObstacleProxy;
    // A car (half 2.1 x 0.9) facing +z with its nose 0.2 m short of the bus's side: apart; 0.2 m
    // into it: overlapping.
    expect(boxMeetsProxy(0, -3.8, 0, 1, 2.1, 0.9, proxy(bus))).toBe(false);
    expect(boxMeetsProxy(0, -3.4, 0, 1, 2.1, 0.9, proxy(bus))).toBe(true);
    // Turned 45° beside the bus's end: its corner reaches 2.1·cos45 + 0.9·sin45 = 2.12 m.
    const k = Math.SQRT1_2;
    expect(boxMeetsProxy(8.3, 0, k, k, 2.1, 0.9, proxy(bus))).toBe(false);
    expect(boxMeetsProxy(7.9, 0, k, k, 2.1, 0.9, proxy(bus))).toBe(true);
    // A skewed footprint (ends x = ±6 + 0.5 z): the far end at z = +1.5 reaches x 6.75.
    const skew = { ...bus, rect: { ...bus.rect, k0: 0.5, k1: 0.5 } };
    expect(boxMeetsProxy(7.4, 1.2, 1, 0, 0.5, 0.2, proxy(skew))).toBe(false);
    expect(boxMeetsProxy(7.0, 1.2, 1, 0, 0.5, 0.2, proxy(skew))).toBe(true);
    expect(boxMeetsProxy(6.0, -1.2, 1, 0, 0.3, 0.2, proxy(skew))).toBe(false);
    // A disc of radius 1 off the box's corner (2.1, 0.9) along the diagonal.
    const disc = (d: number) => proxy({ x: 2.1 + d * k, z: 0.9 + d * k, radius: 1 });
    expect(boxMeetsProxy(0, 0, 1, 0, 2.1, 0.9, disc(1.05))).toBe(false);
    expect(boxMeetsProxy(0, 0, 1, 0, 2.1, 0.9, disc(0.95))).toBe(true);
  });

  it('dam monoliths collide as their footprints, houses as circles', async () => {
    const t = terrainWith([
      { kind: 'dam', s: 100, d: 0, span: 40 },
      { kind: 'house', s: 200, d: 0 },
    ]);
    const w = await createPhysicsWorld(t, { seed: 4 });
    const monoliths = ofKind(w, 'dam');
    expect(monoliths.length).toBe(5);
    for (const m of monoliths) {
      const r = m.proxy.rect!;
      expect(r).toBeDefined();
      expect(Math.abs(r.ux)).toBeCloseTo(1, 6);
      expect(r.hv).toBeCloseTo(2.3, 1);
      expect(r.hu).toBeCloseTo((m.localMax.x - m.localMin.x) / 2, 6);
    }
    // The 10 m centre monolith's neighbours leave the breach open: their faces at |x| > 4.9.
    const side = monoliths.filter((m) => Math.abs(m.proxy.x) > 1);
    for (const m of side) expect(Math.abs(m.proxy.x) - m.proxy.rect!.hu).toBeGreaterThan(4.9);
    const [house] = ofKind(w, 'house');
    expect(house.proxy.rect).toBeUndefined();
    w.dispose();
  });

  it('a toppled smokestack lies as a rectangle along its length, not a disc of half of it', async () => {
    const t = terrainWith([{ kind: 'smokestack', s: 100, d: 0 }], () => 5);
    const w = await createPhysicsWorld(t, { seed: 5 });
    run(w, 0.5);
    const [stack] = ofKind(w, 'smokestack', 'smokestack');
    const v = momentumBreakSpeed(stack.breakImpulse, 220) * 1.3;
    expect(w.applyContact(hit(stack, v, 220)).result).toBe('uprooted');
    run(w, 8);
    expect(w.tiltOf(stack.id)).toBeGreaterThan(1.2);
    const r = stack.proxy.rect!;
    expect(r).toBeDefined();
    expect(r.hu).toBeGreaterThan(12);
    expect(r.hv).toBeLessThan(3.5);
    // Lying down-course (the push), so its long axis runs along z.
    expect(Math.abs(r.uz)).toBeGreaterThan(0.8);
    w.dispose();
  });

  it('a push near one end of a long body swings it round; one at its middle barely turns it', async () => {
    const spins: number[] = [];
    for (const along of [0, 5]) {
      const t = terrainWith([], () => 5);
      const w = await createPhysicsWorld(t, { seed: 6 });
      const [bus] = w.spawn('bus', 0, 100, { yaw: Math.PI / 2 }); // lying across the push
      run(w, 1);
      const r = bus.proxy.rect!;
      expect(r).toBeDefined();
      const px = bus.proxy.x + r.ux * along;
      w.applyContact(hit(bus, 6, 100, { x: px, z: bus.proxy.z - r.hv }));
      w.step(DT);
      spins.push(Math.abs(bus.angVel.y));
      w.dispose();
    }
    expect(spins[1]).toBeGreaterThan(0.3);
    expect(spins[1]).toBeGreaterThan(3 * spins[0]);
  });

  it('pushing a long body at one end gives it no more energy than the iceberg loses', async () => {
    // Regression (engine review): the point-mass impulse applied near one end of a long body also
    // spun it up, energy the iceberg never paid for (its ends flew off far faster than a free body
    // would). Now the exchange uses the mass the body has where it is touched (leverMass), and its
    // spin is capped at (1+e)·closing speed at its ends.
    for (const along of [3, 5, 5.8]) {
      const t = terrainWith([], () => 5);
      const w = await createPhysicsWorld(t, { seed: 6 });
      const [bus] = w.spawn('bus', 0, 100, { yaw: Math.PI / 2 });
      run(w, 1);
      const r = bus.proxy.rect!;
      const P = withLevelIceberg(DEFAULT_ICEBERG_PARAMS, { mass: 100, scale: 1.5 });
      const ice = createIceberg(t, P);
      ice.pos.x = bus.proxy.x + r.ux * along;
      ice.pos.z = bus.proxy.z - r.hv - ice.radius + 0.1;
      ice.pos.y = 5;
      ice.vel.x = 0;
      ice.vel.z = 12;
      const contacts = resolveIcebergContacts(ice, w.proxiesNear(ice.pos.x, ice.pos.z, ice.radius + 8), P);
      const c = contacts.find((k) => k.obstacleId === bus.id)!;
      expect(c).toBeDefined();
      const v1 = Math.hypot(ice.vel.x, ice.vel.z);
      w.applyContact(c);
      w.step(DT);
      const v = Math.hypot(bus.proxy.vx, bus.proxy.vz);
      const spin = Math.abs(bus.angVel.y);
      // Kinetic energy of the bus (a uniform slab about the vertical) vs what the iceberg lost.
      const inertia = (bus.mass * (r.hu * r.hu + r.hv * r.hv)) / 3;
      const gained = 0.5 * bus.mass * v * v + 0.5 * inertia * spin * spin;
      const lost = 0.5 * P.mass * (12 * 12 - v1 * v1);
      const where = `pushed ${along} m off its centre`;
      expect(gained, where).toBeLessThan(lost);
      expect(spin * r.hu, where).toBeLessThanOrEqual((1 + E) * c.relSpeed * 1.01);
      w.dispose();
    }
  });
});

/** Deepest point (m) any collider vertex of a dam block starts below the ground right under it. */
function deepestSink(w: PhysicsWorld, t: Terrain): number {
  const q = new Quaternion();
  const pq = new Quaternion();
  const v = new Vector3();
  let worst = 0;
  for (const b of ofKind(w, 'dam')) {
    q.set(b.quat.x, b.quat.y, b.quat.z, b.quat.w);
    for (const part of b.parts) {
      if (part.decor) continue;
      const pts = scaledPoints(getGeom(part.geom), part.scale);
      pq.set(part.rotation.x, part.rotation.y, part.rotation.z, part.rotation.w);
      for (let i = 0; i < pts.length; i += 3) {
        v.set(pts[i], pts[i + 1], pts[i + 2]).applyQuaternion(pq);
        v.set(v.x + part.offset.x, v.y + part.offset.y, v.z + part.offset.z).applyQuaternion(q);
        worst = Math.max(worst, t.heightAt(b.pos.x + v.x, b.pos.z + v.z) - (b.pos.y + v.y));
      }
    }
  }
  return worst;
}

describe('a dam on uneven ground', () => {
  // Before each column followed its own ground, the high-side blocks started 1.46 m (V gorge) and
  // 1.56 m (bumpy cross slope) deep in the terrain; the 0.06 down-course slope alone sinks the
  // upstream face 0.06 × 4.6 m (both before and now).
  const grounds: [string, (x: number, z: number) => number, number][] = [
    ['V gorge rising 0.15 to both sides', (x, z) => 200 - 0.06 * z + 0.15 * Math.abs(x), 0.7],
    [
      'bumpy floor on a 0.12 cross slope',
      (x, z) => 200 - 0.06 * z + 0.12 * x + 0.6 * Math.sin(x * 0.7) * Math.cos(z * 0.5),
      0.9,
    ],
    ['plain 0.06 slope', inclinedPlane(0.06, 200), 0.4],
  ];
  for (const [name, height, limit] of grounds) {
    it(`${name}: no block starts more than ${limit} m below the ground`, async () => {
      const t = terrainWith([{ kind: 'dam', s: 100, d: 0, span: 40 }], height);
      const w = await createPhysicsWorld(t, { seed: 3 });
      expect(ofKind(w, 'dam').length).toBeGreaterThanOrEqual(4);
      expect(deepestSink(w, t)).toBeLessThan(limit);
      w.dispose();
    });
  }
});

describe('ice chunks break off the iceberg\'s flanks', () => {
  it('they start beside or behind it, outside its hull, and fly outward', async () => {
    const t = terrainWith([]);
    const w = await createPhysicsWorld(t, { seed: 10 });
    const around = { x: 0, z: 60, radius: 3 };
    const y = t.heightAt(0, 63) + 1.2;
    w.spawnIceChunks({ x: 0, y, z: 63 }, { x: 0, y: 0, z: 12 }, 3, around);
    const chunks = w.bodies.filter((b) => b.active && b.part === 'chunk');
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const sides = new Set<number>();
    for (const c of chunks) {
      const dx = c.pos.x - around.x;
      const dz = c.pos.z - around.z;
      const d = Math.hypot(dx, dz);
      expect(d).toBeGreaterThan(around.radius);
      // Never ahead of it (forward is +z): at least 1.4 rad round from straight ahead.
      expect(dz / d).toBeLessThanOrEqual(Math.cos(ICE.chunkFlank[0]) + 1e-9);
      sides.add(Math.sign(dx));
      // Moving out from the iceberg relative to it (it keeps its 12 m/s, the chunk 60 % of it).
      const v = w.getBody(c.id)!.proxy;
      const rx = v.vx;
      const rz = v.vz - 12;
      expect(rx * dx + rz * dz).toBeGreaterThan(0);
    }
    expect(sides.size).toBe(2);
    w.dispose();
  });
});
