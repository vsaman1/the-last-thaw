import { Quaternion, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAnalyticTerrain, inclinedPlane } from '../testing/analyticTerrain';
import type { IcebergContact, ObstacleKind, ObstaclePlacement, Terrain } from '../types';
import { CONTACT_RESTITUTION, momentumBreakSpeed } from '../obstacles/catalog';
import { getGeom, scaledPoints } from '../obstacles/shapes';
import { createIceberg, resolveIcebergContacts, stepIceberg } from '../sim/iceberg';
import { DEFAULT_ICEBERG_PARAMS } from '../sim/params';
import { createPhysicsWorld, initRapier, type ObstacleBody, type PhysicsWorld } from './world';

/**
 * Town and energy structures in the physics world: tall ones topple in the push direction, the
 * cooling tower stops a normal iceberg but shatters under a huge one (real iceberg solver), the
 * water tank falls when its legs go, the church nave collapses.
 */

const DT = 1 / 60;
const E = CONTACT_RESTITUTION;

beforeAll(async () => {
  await initRapier();
});

const flat =
  (h: number) =>
  (): number =>
    h;

type Height = (x: number, z: number) => number;

function terrainWith(obstacles: ObstaclePlacement[], height: Height = flat(5)): Terrain {
  return createAnalyticTerrain({ height, cellSize: 2, length: 600, level: { obstacles } });
}

function run(w: PhysicsWorld, seconds: number): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    w.step(DT);
    w.drainEvents();
  }
}

/**
 * The contact the iceberg solver produces for a hit at closing speed vn along (nx, nz) by an
 * iceberg of mass M (same as the shared structures physics test).
 */
function hit(b: ObstacleBody, vn: number, M = 30, nx = 0, nz = 1): IcebergContact {
  const m = b.mass;
  const J = (1 + E) * vn * ((M * m) / (M + m));
  const p = b.proxy;
  return {
    obstacleId: b.id,
    impulse: { x: J * nx, y: 0.2 * J, z: J * nz },
    point: { x: p.x - nx * p.radius, y: Math.min(p.top, p.bottom + 1.2), z: p.z - nz * p.radius },
    normal: { x: nx, y: 0, z: nz },
    relSpeed: vn,
    speedLoss: 0,
    testImpulse: b.anchored ? (1 + E) * vn * M : J,
    shock: J / M,
  };
}

const ofKind = (w: PhysicsWorld, kind: ObstacleKind, part?: string): ObstacleBody[] =>
  w.bodies.filter((b) => b.active && b.kind === kind && (part === undefined || b.part === part));

const _q = new Quaternion();
const _v = new Vector3();

/** World position of the top of a body (its local up axis, at the top of its local box). */
function topOf(b: ObstacleBody): Vector3 {
  _q.set(b.quat.x, b.quat.y, b.quat.z, b.quat.w);
  return _v.set(0, b.localMax.y, 0).applyQuaternion(_q).add(new Vector3(b.pos.x, b.pos.y, b.pos.z));
}

/** Every active body of the kind rests on or above the ground (nothing driven through it). */
function expectAboveGround(w: PhysicsWorld, t: Terrain, kind: ObstacleKind): void {
  const pq = new Quaternion();
  for (const b of ofKind(w, kind)) {
    // Every collider vertex against the ground right under it (bodies lie across slopes).
    let worst = Infinity;
    _q.set(b.quat.x, b.quat.y, b.quat.z, b.quat.w);
    for (const part of b.parts) {
      if (part.decor) continue;
      const pts = scaledPoints(getGeom(part.geom), part.scale);
      pq.set(part.rotation.x, part.rotation.y, part.rotation.z, part.rotation.w);
      for (let i = 0; i < pts.length; i += 3) {
        _v.set(pts[i], pts[i + 1], pts[i + 2]).applyQuaternion(pq);
        _v.set(_v.x + part.offset.x, _v.y + part.offset.y, _v.z + part.offset.z).applyQuaternion(_q);
        const x = b.pos.x + _v.x;
        const z = b.pos.z + _v.z;
        worst = Math.min(worst, b.pos.y + _v.y - t.heightAt(x, z));
      }
    }
    expect(worst, `${kind}/${b.part} #${b.id}`).toBeGreaterThan(-0.5);
  }
}

/**
 * The tall anchored body of each toppling kind (the one the iceberg strikes); whether its footing
 * is square (it then pivots about a base edge, so it may fall up to 45° off the push); the
 * placement yaw for the big-iceberg runs (the church tower is pushed away from its nave); the
 * big iceberg's speed as a multiple of its break speed (the squat church tower needs a firmer
 * shove than a slender column to pass its balance point); and whether a bulldozing big iceberg
 * (real solver, it keeps shoving the loose foot) still fells it ahead (round, compact columns do;
 * see the report for the pylon and the church tower).
 */
const TALL: [ObstacleKind, string, boolean, number, number, boolean][] = [
  ['smokestack', 'smokestack', false, 0.6, 1.3, true],
  ['lighthouse', 'lighthouse', false, 0.6, 1.3, true],
  ['windTurbine', 'windTurbine', false, 0.6, 1.3, true],
  ['pylon', 'pylon', true, 0.6, 1.3, false],
  ['church', 'churchTower', true, 0.2, 2, false],
];

/** Lying down with its top well out along (nx, nz) from where its foot stood; tops came down. */
function expectToppled(
  w: PhysicsWorld,
  t: Terrain,
  kind: ObstacleKind,
  body: ObstacleBody,
  foot: { x: number; z: number },
  push: { nx: number; nz: number; square: boolean },
): void {
  expect(w.tiltOf(body.id)).toBeGreaterThan(1.2);
  const top = topOf(body);
  const along = (top.x - foot.x) * push.nx + (top.z - foot.z) * push.nz;
  const across = Math.abs((top.x - foot.x) * push.nz - (top.z - foot.z) * push.nx);
  expect(along).toBeGreaterThan(0.6 * body.localMax.y);
  expect(across).toBeLessThan((push.square ? 1 : 0.5) * along);
  // A resting top section came down too (a rotor may end up propped on its blades).
  for (const r of ofKind(w, kind, 'deck')) {
    expect(r.pos.y).toBeLessThan(r.spawn.y - 15);
    expect(w.lowestPointY(r.id) - t.heightAt(r.pos.x, r.pos.z)).toBeLessThan(1.5);
  }
  expectAboveGround(w, t, kind);
  expect(w.stats.knockedDown).toBeGreaterThanOrEqual(1);
}

describe('tall structures topple in the push direction when broken', () => {
  for (const [kind, part, square, yaw, bigK, bulldozed] of TALL) {
    it(`${kind}: a 220 t hit at ${bigK}x its (low) break speed fells it the way it is pushed`, async () => {
      const t = terrainWith([{ kind, s: 100, d: 0, yaw }]);
      const w = await createPhysicsWorld(t, { seed: 5 });
      run(w, 0.5);
      const [body] = ofKind(w, kind, part);
      const vBreak = momentumBreakSpeed(body.breakImpulse, 220);
      expect(vBreak).toBeLessThan(4.2);
      expect(w.applyContact(hit(body, vBreak * bigK, 220)).result).toBe('uprooted');
      const foot = { x: body.pos.x, z: body.pos.z };
      run(w, 8);
      expectToppled(w, t, kind, body, foot, { nx: 0, nz: 1, square });
      w.dispose();
    });

    it(`${kind}: a 30 t hit just above the break speed from the side (+x) topples it that way`, async () => {
      const t = terrainWith([{ kind, s: 100, d: 0, yaw: 0 }]);
      const w = await createPhysicsWorld(t, { seed: 5 });
      run(w, 0.5);
      const [body] = ofKind(w, kind, part);
      const vBreak = momentumBreakSpeed(body.breakImpulse, 30);
      expect(w.applyContact(hit(body, vBreak * 0.9, 30, 1, 0)).result).toBe('shook');
      expect(body.anchored).toBe(true);
      expect(w.applyContact(hit(body, vBreak * 1.1, 30, 1, 0)).result).toBe('uprooted');
      const foot = { x: body.pos.x, z: body.pos.z };
      run(w, 8);
      expectToppled(w, t, kind, body, foot, { nx: 1, nz: 0, square });
      w.dispose();
    });

    if (!bulldozed) continue;
    it(`${kind}: a 220 t iceberg ploughing in at 1.3x its break speed fells it ahead`, async () => {
      const slope = 0.04;
      const t = createAnalyticTerrain({
        height: inclinedPlane(slope),
        cellSize: 2,
        length: 600,
        level: { obstacles: [{ kind, s: 100, d: 0, yaw }] },
      });
      const w = await createPhysicsWorld(t, { seed: 5 });
      const [body] = ofKind(w, kind, part);
      const M = 220;
      const radius = DEFAULT_ICEBERG_PARAMS.radius * Math.cbrt(M / 30);
      const P = { ...DEFAULT_ICEBERG_PARAMS, mass: M, radius };
      const ice = createIceberg(t, P);
      const v = momentumBreakSpeed(body.breakImpulse, M) * 1.3;
      ice.pos.x = body.proxy.x;
      ice.pos.z = body.proxy.z - body.proxy.radius - P.radius - 3;
      ice.pos.y = t.heightAt(ice.pos.x, ice.pos.z);
      ice.vel.x = 0;
      ice.vel.y = -slope * v;
      ice.vel.z = v;
      const foot = { x: body.pos.x, z: body.pos.z };
      let result = 'none';
      for (let i = 0; i < 8 * 60; i++) {
        stepIceberg(ice, { steer: 0, source: 'none' }, t, DT, P, 10 + i * DT);
        const near = w.proxiesNear(ice.pos.x, ice.pos.z, ice.radius + 8);
        for (const c of resolveIcebergContacts(ice, near, P)) {
          const r = w.applyContact(c).result;
          if (c.obstacleId === body.id && result === 'none') result = r;
        }
        w.step(DT);
        w.drainEvents();
      }
      expect(result).toBe('uprooted');
      expectToppled(w, t, kind, body, foot, { nx: 0, nz: 1, square });
      w.dispose();
    });
  }
});

describe('cooling tower (real iceberg solver)', () => {
  /** Drive an iceberg of mass M (radius scaled with cbrt(M/30)) into the tower at speed v. */
  async function charge(M: number, v: number): Promise<{
    w: PhysicsWorld;
    t: Terrain;
    vHit: number;
    vzAfter: number;
    result: string;
  }> {
    const slope = 0.04;
    const t = createAnalyticTerrain({
      height: inclinedPlane(slope),
      cellSize: 2,
      length: 600,
      level: { obstacles: [{ kind: 'coolingTower', s: 100, d: 0 }] },
    });
    const w = await createPhysicsWorld(t, { seed: 9 });
    const k = Math.cbrt(M / 30);
    const P = { ...DEFAULT_ICEBERG_PARAMS, mass: M, radius: DEFAULT_ICEBERG_PARAMS.radius * k };
    const ice = createIceberg(t, P);
    const [tower] = ofKind(w, 'coolingTower');
    ice.pos.z = 100 - (tower.proxy.radius + P.radius) - 4;
    ice.pos.y = t.heightAt(0, ice.pos.z);
    ice.vel.x = 0;
    ice.vel.y = -slope * v;
    ice.vel.z = v;
    let vHit = 0;
    let vzAfter = NaN;
    let hitStep = -1;
    let result = 'none';
    for (let i = 0; i < 420; i++) {
      stepIceberg(ice, { steer: 0, source: 'none' }, t, DT, P, 10 + i * DT);
      const speed = Math.hypot(ice.vel.x, ice.vel.z);
      const contacts = resolveIcebergContacts(ice, w.proxiesNear(ice.pos.x, ice.pos.z, ice.radius + 20), P);
      for (const c of contacts) {
        const r = w.applyContact(c).result;
        if (c.obstacleId === tower.id && hitStep < 0) {
          hitStep = i;
          vHit = speed;
          result = r;
        }
      }
      w.step(DT);
      w.drainEvents();
      if (i === hitStep + 20) vzAfter = ice.vel.z;
    }
    return { w, t, vHit, vzAfter, result };
  }

  it('stops a 30 t iceberg at 20 m/s: it bounces off and the tower stands', async () => {
    const { w, vHit, vzAfter, result } = await charge(30, 20);
    expect(vHit).toBeGreaterThan(19);
    expect(result).toBe('shook');
    // Thrown back (restitution 0.25), not through.
    expect(vzAfter).toBeLessThan(0);
    const [tower] = ofKind(w, 'coolingTower');
    expect(tower.anchored && tower.active).toBe(true);
    expect(w.stats.buildingsDestroyed).toBe(0);
    w.dispose();
  });

  it('breaks for a 220 t iceberg at 12 m/s: 30 panels, the iceberg keeps about half its speed', async () => {
    const { w, t, vHit, vzAfter, result } = await charge(220, 12);
    expect(vHit).toBeGreaterThan(11.5);
    expect(result).toBe('broken');
    expect(w.stats.buildingsDestroyed).toBe(1);
    const panels = ofKind(w, 'coolingTower');
    expect(panels.length).toBe(30);
    expect(panels.every((p) => !p.anchored && w.isDynamic(p.id))).toBe(true);
    expect(panels.reduce((a, p) => a + p.mass, 0)).toBeCloseTo(120, 6);
    // Loose-body rule: keeps 1 - 1.25·120/340 ≈ 56 % (minus friction and the panels it ploughs into).
    expect(vzAfter / vHit).toBeGreaterThan(0.3);
    expect(vzAfter / vHit).toBeLessThan(0.62);
    // Within ~7 s the 42 m shell has caved in (panel centres start at 6-40 m, mean ~21 m).
    const mean = panels.reduce((a, p) => a + p.pos.y - t.heightAt(p.pos.x, p.pos.z), 0) / panels.length;
    expect(mean).toBeLessThan(10);
    w.dispose();
  });

  it('its 30 panels fall into a pile that settles on the ground and goes to sleep', async () => {
    const t = terrainWith([{ kind: 'coolingTower', s: 100, d: 0, yaw: 0 }]);
    const w = await createPhysicsWorld(t, { seed: 4 });
    const [tower] = ofKind(w, 'coolingTower');
    expect(w.applyContact(hit(tower, 12, 220)).result).toBe('broken');
    let fastest = 0;
    for (let i = 0; i < 12 * 60; i++) {
      w.step(DT);
      w.drainEvents();
      if (i % 30 === 29) expectAboveGround(w, t, 'coolingTower');
      for (const p of ofKind(w, 'coolingTower')) {
        fastest = Math.max(fastest, Math.hypot(p.proxy.vx, p.proxy.vz));
      }
    }
    // Nothing is flung (the break hands out 45 % of the hit, capped per piece) ...
    expect(fastest).toBeLessThan(20);
    // ... and the pile is at rest within 12 s (no piece kept awake or sinking through the ground).
    expect(w.awakeCount).toBeLessThanOrEqual(2);
    w.dispose();
  });
});

describe('water tower', () => {
  it('the iceberg can slide between the legs; it meets only the riser on the centre line', async () => {
    const t = terrainWith([{ kind: 'waterTower', s: 100, d: 0, yaw: 0 }]);
    const w = await createPhysicsWorld(t, { seed: 6 });
    for (let z = 90; z <= 110; z += 2) {
      for (const p of w.proxiesNear(0, z, 2.2)) {
        if (p.bottom > 5 + 2.8) continue;
        expect(p.part).toBe('riser');
      }
    }
    w.dispose();
  });

  it('knock out the two legs on one side and the tank falls toward the gap and rolls off', async () => {
    const t = terrainWith([{ kind: 'waterTower', s: 100, d: 0, yaw: 0 }]);
    const w = await createPhysicsWorld(t, { seed: 6 });
    run(w, 1);
    const [tank] = ofKind(w, 'waterTower', 'deck');
    const y0 = tank.pos.y;
    // One leg alone leaves the tank balanced on the other three (documented).
    const legs = ofKind(w, 'waterTower', 'leg').sort((a, b) => a.pos.z - b.pos.z || a.pos.x - b.pos.x);
    expect(w.applyContact(hit(legs[0], 10)).result).toBe('shook');
    expect(w.applyContact(hit(legs[0], 13)).result).toBe('uprooted');
    run(w, 3);
    expect(Math.abs(tank.pos.y - y0)).toBeLessThan(0.3);
    // The second leg on the approach side: down it comes.
    expect(w.applyContact(hit(legs[1], 13)).result).toBe('uprooted');
    run(w, 5);
    expect(tank.pos.y).toBeLessThan(y0 - 8);
    expect(w.lowestPointY(tank.id)).toBeLessThan(t.heightAt(tank.pos.x, tank.pos.z) + 0.3);
    expect(w.tiltOf(tank.id)).toBeGreaterThan(0.8);
    // It fell toward the missing legs (the approach side, -z).
    expect(tank.pos.z).toBeLessThan(100);
    expectAboveGround(w, t, 'waterTower');
    w.dispose();
  });
});

describe('church', () => {
  it('a nave half shatters into walls, gable, roofs, apse at 22 m/s for 30 t; slower bounces', async () => {
    const t = terrainWith([{ kind: 'church', s: 100, d: 0, yaw: 0 }]);
    const w = await createPhysicsWorld(t, { seed: 8 });
    // yaw 0: facade down-course, so the iceberg meets the back half (with the apse) first.
    const back = ofKind(w, 'church', 'church').sort((a, b) => a.proxy.z - b.proxy.z)[0];
    expect(w.applyContact(hit(back, 21)).result).toBe('shook');
    expect(w.applyContact(hit(back, 23)).result).toBe('broken');
    run(w, 4);
    const pieces = w.bodies.filter((b) => b.active && b.originId === back.id && b.id !== back.id);
    expect(pieces.map((p) => p.part).sort()).toEqual(['apse', 'gable', 'roof', 'roof', 'wall', 'wall']);
    expect(pieces.reduce((a, p) => a + p.mass, 0)).toBeCloseTo(back.mass, 6);
    // The roof came down (it is not left resting on standing walls).
    for (const r of pieces.filter((p) => p.part === 'roof')) expect(r.proxy.top - 5).toBeLessThan(9);
    expect(w.stats.buildingsDestroyed).toBe(1);
    // The front half and the tower are untouched.
    expect(ofKind(w, 'church').filter((b) => b.anchored).length).toBe(2);
    expectAboveGround(w, t, 'church');
    w.dispose();
  });
});
