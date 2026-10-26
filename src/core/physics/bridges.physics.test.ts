import { beforeAll, describe, expect, it } from 'vitest';
import { FIXED_DT, getTerrain } from '../session';
import { LEVELS } from '../levels';
import { createAnalyticTerrain } from '../testing/analyticTerrain';
import { CONTACT_RESTITUTION } from '../obstacles/catalog';
import { createIceberg, resolveIcebergContacts } from '../sim/iceberg';
import { DEFAULT_ICEBERG_PARAMS } from '../sim/params';
import type { IcebergContact, IcebergState, ObstaclePlacement, Terrain, TerrainFeature } from '../types';
import { createPhysicsWorld, initRapier, proxyDistance, type ObstacleBody, type PhysicsWorld } from './world';

/**
 * Bridges that connect, in the physics world: traffic drives from a road over a road bridge's deck
 * (the street it carries) and on along the road beyond, at deck height over the gorge, up a ramped
 * deck between uneven rims; knocking out a pier still drops the decks resting on it (the abutments
 * hold the other ends) and releases a vehicle on them; the iceberg rides over an abutment like the
 * ground it is buried in.
 *
 * Analytic terrain: a 0.06 slope along +z (s = z, d = -x) with a gorge across it at s 200, 40 m wide
 * and 15 m deep; a road down the course to each rim (s 30-170 and 230-380, d 0), and a road bridge
 * along the course from rim to rim (span 60: s 170-230).
 */

const DEPTH = 15;
const cutAt = (z: number): number => {
  const q = Math.abs(z - 200);
  return q <= 20 ? DEPTH : q < 21 ? DEPTH * (21 - q) : 0;
};
const height = (_x: number, z: number): number => 70 - 0.06 * z - cutAt(z);
const ROADS: TerrainFeature[] = [
  { type: 'road', s0: 30, s1: 170, d: 0, width: 8 },
  { type: 'road', s0: 230, s1: 380, d: 0, width: 8 },
];
const BRIDGE: ObstaclePlacement = { kind: 'roadBridge', s: 200, d: 0, yaw: Math.PI / 2, span: 60 };

beforeAll(async () => {
  await initRapier();
});

function world(obstacles: ObstaclePlacement[]): Promise<PhysicsWorld> {
  const t = createAnalyticTerrain({
    height,
    halfWidth: 70,
    width: 200,
    length: 420,
    cellSize: 2,
    level: { obstacles, features: ROADS, theme: 'town' },
  });
  return createPhysicsWorld(t, { seed: 5 });
}

const ofPart = (w: PhysicsWorld, part: string): ObstacleBody[] =>
  w.bodies.filter((b) => b.active && b.kind === 'roadBridge' && b.part === part);

/**
 * A gorge turned `angle` (°) from square to the course, across it at s 200 (floor `floor` m either
 * side of its axis, DEPTH deep, 1 m walls) on a `grade` slope; a road bridge along the course over
 * it (span 44 by default: its ends 4.5 m or more past the rims, so both skew along them).
 */
function skewedTerrain(angle: number, bridge: Partial<ObstaclePlacement> = {}, floor = 10, grade = 0.06): Terrain {
  const a = (angle * Math.PI) / 180;
  return createAnalyticTerrain({
    height: (x, z) => {
      const q = Math.abs((z - 200) * Math.cos(a) - x * Math.sin(a));
      return 70 - grade * z - (q <= floor ? DEPTH : q < floor + 1 ? DEPTH * (floor + 1 - q) : 0);
    },
    halfWidth: 70,
    width: 200,
    length: 420,
    cellSize: 1,
    level: { obstacles: [{ ...BRIDGE, span: 44, ...bridge }], features: [], theme: 'town' },
  });
}
const skewedWorld = (angle: number, bridge: Partial<ObstaclePlacement> = {}, floor = 10, grade = 0.06) =>
  createPhysicsWorld(skewedTerrain(angle, bridge, floor, grade), { seed: 5 });

describe('traffic over a road bridge', () => {
  it('a car drives off the road, over the deck at deck height, and on down the road beyond', async () => {
    // Driving down-course (+z) in the right-hand lane (d +2), and one coming up the other way.
    const w = await world([
      BRIDGE,
      { kind: 'car', s: 120, d: 2, yaw: 0 },
      { kind: 'car', s: 290, d: -2, yaw: Math.PI },
    ]);
    const t = w.traffic!;
    expect(t.count).toBe(2);
    // The street over the deck is part of the network: the roads meet it at both rims.
    expect(t.net.lines.some((l) => l.bridge !== undefined && !l.carve)).toBe(true);
    const down = w.bodies[t.body[0]];
    const up = w.bodies[t.body[1]];
    const highest = { down: 0, up: 0 };
    const crossed = { down: false, up: false };
    /** Height above the ground when it first reached the road beyond the far rim. */
    const landed = { down: NaN, up: NaN };
    const beyond = { down: (z: number) => z > 240, up: (z: number) => z < 160 };
    for (let k = 0; k < 30 * 60; k++) {
      w.step(FIXED_DT);
      for (const [name, car] of [['down', down], ['up', up]] as const) {
        const above = car.pos.y - w.terrain.heightAt(car.pos.x, car.pos.z);
        if (Math.abs(car.pos.z - 200) < 15 && Number.isNaN(landed[name])) {
          // Over the gorge: on the deck, far above the gorge floor.
          highest[name] = Math.max(highest[name], above);
          crossed[name] = true;
        }
        if (crossed[name] && Number.isNaN(landed[name]) && beyond[name](car.pos.z)) landed[name] = above;
      }
    }
    for (const [name, car] of [['down', down], ['up', up]] as const) {
      expect(crossed[name], name).toBe(true);
      expect(car.driven, name).toBe(true);
      expect(highest[name], name).toBeGreaterThan(DEPTH - 2);
      // On down the road beyond the far rim, on the ground.
      expect(Math.abs(landed[name]), name).toBeLessThan(0.3);
    }
    // Nothing was knocked: the bridge stands.
    for (const d of ofPart(w, 'deck')) expect(Math.abs(d.pos.y - d.spawn.y)).toBeLessThan(0.05);
    expect(w.stats.knockedDown).toBe(0);
    w.dispose();
  });

  it('with its decks gone, a car stops at the rim rather than driving into the gorge', async () => {
    // The road the deck carried can break (carved ground cannot): the scan still reads the drop.
    const w = await world([BRIDGE, { kind: 'car', s: 120, d: 2, yaw: 0 }]);
    for (const d of ofPart(w, 'deck')) d.active = false;
    const t = w.traffic!;
    const car = w.bodies[t.body[0]];
    for (let k = 0; k < 30 * 60; k++) w.step(FIXED_DT);
    expect(car.driven).toBe(true);
    expect(t.v[0]).toBeLessThan(0.05);
    // Short of the rim (the gorge's wall top at z 179), on the road.
    expect(car.pos.z).toBeLessThan(179 - 2.1);
    expect(car.pos.z).toBeGreaterThan(150);
    expect(car.pos.y).toBeCloseTo(w.terrain.heightAt(car.pos.x, car.pos.z), 0);
    w.dispose();
  });
});

describe('collapse with abutments', () => {
  /** A head-on contact as the solver makes it for an iceberg of mass M at closing speed vn. */
  function hit(b: ObstacleBody, vn: number, M: number): IcebergContact {
    const m = b.mass;
    const E = CONTACT_RESTITUTION;
    const J = (1 + E) * vn * ((M * m) / (M + m));
    const p = b.proxy;
    return {
      obstacleId: b.id,
      impulse: { x: 0, y: 0.2 * J, z: J },
      point: { x: p.x, y: Math.min(p.top, p.bottom + 1.2), z: p.z - p.radius },
      normal: { x: 0, y: 0, z: 1 },
      relSpeed: vn,
      speedLoss: 0,
      testImpulse: (1 + E) * vn * M,
      shock: J / M,
    };
  }

  /**
   * A gorge along the course (|d| < 20, 15 m deep) on a 0.03 cross slope: the bridge spans it
   * across the course (rims 1.8 m apart), the pier in the middle is hit down-course, side-on to the
   * deck, as the iceberg would hit it; a street on each rim.
   */
  function across(obstacles: ObstaclePlacement[]): Promise<PhysicsWorld> {
    const cut = (x: number): number => {
      const q = Math.abs(x);
      return q <= 20 ? DEPTH : q < 21 ? DEPTH * (21 - q) : 0;
    };
    const t = createAnalyticTerrain({
      height: (x, z) => 70 - 0.06 * z + 0.03 * x - cut(x),
      halfWidth: 70,
      width: 200,
      length: 420,
      cellSize: 2,
      level: {
        obstacles,
        features: [
          { type: 'street', points: [{ s: 200, d: 30 }, { s: 200, d: 66 }], width: 8 },
          { type: 'street', points: [{ s: 200, d: -30 }, { s: 200, d: -66 }], width: 8 },
        ],
        theme: 'town',
      },
    });
    return createPhysicsWorld(t, { seed: 5 });
  }

  it('knocking out the pier drops both decks; the abutments stay; a car on it is released', async () => {
    // Driving toward +d on the street over the deck (its lane 2 m up-course of the centre line).
    const w = await across([
      { kind: 'roadBridge', s: 200, d: 0, span: 60 },
      { kind: 'car', s: 198, d: 6, yaw: -Math.PI / 2 },
    ]);
    const decks = ofPart(w, 'deck');
    const piers = ofPart(w, 'pier');
    const abutments = ofPart(w, 'abutment');
    expect(decks).toHaveLength(2);
    expect(piers).toHaveLength(1);
    expect(abutments).toHaveLength(2);
    const t = w.traffic!;
    const car = w.bodies[t.body[0]];
    // The car starts on the deck, not in the gorge.
    expect(car.pos.y - w.terrain.heightAt(car.pos.x, car.pos.z)).toBeGreaterThan(DEPTH - 2);
    for (let k = 0; k < 60; k++) w.step(FIXED_DT);
    for (const d of decks) expect(Math.abs(d.pos.y - d.spawn.y)).toBeLessThan(0.05);
    expect(w.applyContact(hit(piers[0], 7.6, 100)).result).toBe('uprooted');
    for (let k = 0; k < 5 * 60; k++) w.step(FIXED_DT);
    for (const d of decks) expect(d.pos.y).toBeLessThan(d.spawn.y - 2.5);
    for (const a of abutments) {
      expect(a.anchored).toBe(true);
      expect(a.pos.y).toBeCloseTo(a.spawn.y, 3);
    }
    expect(car.driven).toBe(false);
    expect(car.pos.y).toBeLessThan(car.spawn.y - 2);
    w.dispose();
  });

  it('knocking out the pier of a skewed bridge still drops both decks (the shear keys hold sideways)', async () => {
    const w = await skewedWorld(37, { span: 50 }, 15);
    const piers = ofPart(w, 'pier');
    const decks = ofPart(w, 'deck');
    expect(piers).toHaveLength(1);
    expect(decks).toHaveLength(2);
    expect(decks.every((d) => d.footprint !== null)).toBe(true);
    for (let k = 0; k < 60; k++) w.step(FIXED_DT);
    expect(w.applyContact(hit(piers[0], 7.6, 100)).result).toBe('uprooted');
    for (let k = 0; k < 5 * 60; k++) w.step(FIXED_DT);
    for (const d of decks) expect(d.pos.y).toBeLessThan(d.spawn.y - 2.5);
    w.dispose();
  });

  it('the iceberg rides over an abutment like the ground (no contact)', async () => {
    const w = await world([BRIDGE]);
    const [a] = ofPart(w, 'abutment');
    expect(a.proxy.passable).toBe(true);
    const ice = createIceberg(w.terrain);
    ice.pos.x = a.proxy.x;
    ice.pos.z = a.proxy.z;
    ice.pos.y = w.terrain.heightAt(a.proxy.x, a.proxy.z);
    ice.vel.x = 0;
    ice.vel.z = 10;
    const near = w.proxiesNear(ice.pos.x, ice.pos.z, ice.radius + 8).filter((p) => p.id === a.id);
    expect(near).toHaveLength(1);
    expect(resolveIcebergContacts(ice, near, DEFAULT_ICEBERG_PARAMS)).toHaveLength(0);
    w.dispose();
  });
});

describe('skewed road bridges: a deck collides and carries as its trapezoid', () => {
  /** World ↔ the deck proxy's own frame (u along its axis, v across). */
  const toRect = (b: ObstacleBody, x: number, z: number): { u: number; v: number } => {
    const r = b.proxy.rect!;
    const dx = x - b.proxy.x;
    const dz = z - b.proxy.z;
    return { u: dx * r.ux + dz * r.uz, v: dz * r.ux - dx * r.uz };
  };
  const fromRect = (b: ObstacleBody, u: number, v: number): { x: number; z: number } => {
    const r = b.proxy.rect!;
    return { x: b.proxy.x + u * r.ux - v * r.uz, z: b.proxy.z + u * r.uz + v * r.ux };
  };
  /** The skewed end of a deck: its skew k (the end runs along u = side·hu + k·v), and its side. */
  const skewedEnd = (b: ObstacleBody): { k: number; side: -1 | 1 } => {
    const r = b.proxy.rect!;
    return Math.abs(r.k1 ?? 0) > Math.abs(r.k0 ?? 0) ? { k: r.k1!, side: 1 } : { k: r.k0!, side: -1 };
  };
  /**
   * The point `off` m out from the skewed end face of deck `b`, square to it, at v across the deck
   * (the face's outward normal is side · (1, −k) / √(1 + k²) in the rect's frame).
   */
  const offFace = (b: ObstacleBody, v: number, off: number): { x: number; z: number } => {
    const r = b.proxy.rect!;
    const { k, side } = skewedEnd(b);
    const n = Math.hypot(1, k);
    return fromRect(b, side * r.hu + k * v + (side * off) / n, v - (side * k * off) / n);
  };
  /** An iceberg standing on the ground at (x, z), moving at (vx, vz). */
  const iceAt = (w: PhysicsWorld, x: number, z: number, vx = 0, vz = 0): IcebergState => {
    const ice = createIceberg(w.terrain);
    ice.pos.x = x;
    ice.pos.z = z;
    ice.pos.y = w.terrain.heightAt(x, z);
    ice.vel.x = vx;
    ice.vel.z = vz;
    return ice;
  };

  it('an iceberg on the abutment beside the receding corner of a skewed end is not touched', async () => {
    const w = await skewedWorld(37);
    const decks = ofPart(w, 'deck');
    expect(decks).toHaveLength(2);
    const radius = createIceberg(w.terrain).radius;
    for (const [d, share] of decks.flatMap((x) => [[x, 0.5], [x, 1]] as const)) {
      const r = d.proxy.rect!;
      const { k, side } = skewedEnd(d);
      expect(Math.abs(k)).toBeGreaterThan(0.6);
      // Toward the edge where the end falls back, half way out (|k|·W/4 short of its centre-line
      // end) and at the edge itself (|k|·W/2 short), 0.3 m clear of the end face, moving toward the
      // deck along it at 8 m/s.
      const v = -Math.sign(k * side) * r.hv * share;
      const at = offFace(d, v, radius + 0.3);
      const ice = iceAt(w, at.x, at.z, -side * r.ux * 8, -side * r.uz * 8);
      // Its bounding rectangle (the old proxy) reaches half a metre or more into the iceberg.
      const q = toRect(d, at.x, at.z);
      const reach = r.hu + Math.abs(k) * r.hv;
      expect(Math.hypot(Math.max(0, Math.abs(q.u) - reach), Math.max(0, Math.abs(q.v) - r.hv))).toBeLessThan(radius - 0.5);
      // The trapezoid does not touch it.
      expect(resolveIcebergContacts(ice, [d.proxy], DEFAULT_ICEBERG_PARAMS)).toHaveLength(0);
      // 0.8 m further on it touches the end face, and pushes square to it.
      const on = offFace(d, v, radius - 0.5);
      const [c] = resolveIcebergContacts(iceAt(w, on.x, on.z, -side * r.ux * 8, -side * r.uz * 8), [d.proxy], DEFAULT_ICEBERG_PARAMS);
      expect(c).toBeDefined();
      const nu = c.normal.x * r.ux + c.normal.z * r.uz;
      const nv = c.normal.z * r.ux - c.normal.x * r.uz;
      expect(nv / nu).toBeCloseTo(-k, 2);
    }
    w.dispose();
  });

  it('an iceberg sliding along the bank beside a skewed end never touches the deck', async () => {
    const w = await skewedWorld(37);
    const radius = createIceberg(w.terrain).radius;
    for (const d of ofPart(w, 'deck')) {
      const r = d.proxy.rect!;
      const { k } = skewedEnd(d);
      // Along the end face's line (direction (k, 1) in the rect's frame), r + 0.5 m out on the
      // bank side, from 12 m beyond one edge of the deck to 12 m beyond the other, at 8 m/s.
      const a = fromRect(d, 0, 0);
      const b = fromRect(d, k, 1);
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      let contacts = 0;
      for (let v = -r.hv - 12; v <= r.hv + 12; v += 0.25) {
        const p = offFace(d, v, radius + 0.5);
        const ice = iceAt(w, p.x, p.z, (8 * (b.x - a.x)) / len, (8 * (b.z - a.z)) / len);
        const near = w.proxiesNear(ice.pos.x, ice.pos.z, ice.radius + 8).filter((o) => o.part === 'deck');
        contacts += resolveIcebergContacts(ice, near, DEFAULT_ICEBERG_PARAMS).length;
      }
      expect(contacts).toBe(0);
    }
    w.dispose();
  });

  it('traffic finds no support over the gorge beside a skewed abutment once the decks are gone', async () => {
    const w = await skewedWorld(37);
    const t = w.terrain;
    const abutments = ofPart(w, 'abutment');
    expect(abutments).toHaveLength(2);
    // The decks fall away (out of the support search, as decks knocked out of deckReach are).
    for (const d of ofPart(w, 'deck')) d.active = false;
    const supportAt = (x: number, z: number, y: number): number =>
      (w as unknown as { supportAt(x: number, z: number, y: number): number }).supportAt(x, z, y);
    let over = 0;
    let carried = 0;
    for (const a of abutments) {
      const top = a.proxy.top;
      for (let x = a.proxy.x - 16; x <= a.proxy.x + 16; x += 0.5) {
        for (let z = a.proxy.z - 16; z <= a.proxy.z + 16; z += 0.5) {
          // Over the gorge (more than 3 m of drop under the road) and off the abutment's own road.
          if (t.heightAt(x, z) > top - 3 || proxyDistance(a.proxy, x, z) <= 0.3) continue;
          over++;
          if (supportAt(x, z, top) > t.heightAt(x, z) + 0.5) carried++;
        }
      }
    }
    expect(over).toBeGreaterThan(100);
    expect(carried).toBe(0);
    w.dispose();
  });
});

describe('decks stay on their seats when woken (their ends clear the abutments)', () => {
  it('a graded, skewed bridge and every bridge of every level', async () => {
    const worlds: [string, PhysicsWorld][] = [['analytic 12 % grade, 30°', await skewedWorld(30, {}, 10, 0.12)]];
    for (const level of LEVELS) {
      if (!level.obstacles.some((o) => o.kind === 'roadBridge' || o.kind === 'footbridge')) continue;
      worlds.push([level.id, await createPhysicsWorld(getTerrain(level), { seed: 1, traffic: false })]);
    }
    for (const [name, w] of worlds) {
      const decks = w.bodies.filter((b) => (b.kind === 'roadBridge' || b.kind === 'footbridge') && b.part === 'deck');
      expect(decks.length, name).toBeGreaterThan(0);
      w.wakeAll();
      for (let k = 0; k < 180; k++) w.step(FIXED_DT);
      for (const d of decks) {
        const moved = Math.hypot(d.pos.x - d.spawn.x, d.pos.y - d.spawn.y, d.pos.z - d.spawn.z);
        expect(moved, `${name} deck #${d.id}`).toBeLessThan(0.02);
      }
      w.dispose();
    }
  }, 120_000);
});
