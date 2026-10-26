import { Quaternion, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAnalyticTerrain } from '../testing/analyticTerrain';
import type { IcebergContact, ObstacleKind, ObstaclePlacement, Terrain } from '../types';
import { CONTACT_RESTITUTION, momentumBreakSpeed } from '../obstacles/catalog';
import { getGeom, scaledPoints } from '../obstacles/shapes';
import { proxyGap, type ProxyDirection } from '../sim/iceberg';
import { PHYSICS_TUNING } from './tuning';
import { createPhysicsWorld, initRapier, type ObstacleBody, type PhysicsWorld } from './world';

/**
 * A released tall body comes down: its footing is torn out of the ground it was set into (a turbine
 * pad buried in a hill crest jammed the dynamic tower upright), the iceberg's pushes on it while it
 * still stands tip it over its foot instead of kicking the foot out from under it, and one that a
 * hit only just broke keeps tipping until it is past its balance point. A lattice pylon collides as
 * the square of its legs.
 */

const DT = 1 / 60;
const E = CONTACT_RESTITUTION;

beforeAll(async () => {
  await initRapier();
});

function run(w: PhysicsWorld, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    w.step(DT);
    w.drainEvents();
  }
}

const ofKind = (w: PhysicsWorld, kind: ObstacleKind, part?: string): ObstacleBody[] =>
  w.bodies.filter((b) => b.active && b.kind === kind && (part === undefined || b.part === part));

/** The contact the solver makes for a hit at closing speed vn along (nx, nz) by an M t iceberg. */
function hit(b: ObstacleBody, vn: number, M: number, nx = 0, nz = 1): IcebergContact {
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
    testImpulse: (1 + E) * vn * M,
    shock: J / M,
  };
}

const _q = new Quaternion();
const _pq = new Quaternion();
const _v = new Vector3();

/** Top of a body (its local up axis at the top of its box) relative to `foot`. */
function topFrom(b: ObstacleBody, foot: { x: number; z: number }): { x: number; z: number } {
  _q.set(b.quat.x, b.quat.y, b.quat.z, b.quat.w);
  _v.set(0, b.localMax.y, 0).applyQuaternion(_q);
  return { x: b.pos.x + _v.x - foot.x, z: b.pos.z + _v.z - foot.z };
}

/** World positions of a body's collider vertices. */
function colliderPoints(b: ObstacleBody): Vector3[] {
  const out: Vector3[] = [];
  _q.set(b.quat.x, b.quat.y, b.quat.z, b.quat.w);
  for (const part of b.parts) {
    if (part.decor) continue;
    const pts = scaledPoints(getGeom(part.geom), part.scale);
    _pq.set(part.rotation.x, part.rotation.y, part.rotation.z, part.rotation.w);
    for (let i = 0; i < pts.length; i += 3) {
      const v = new Vector3(pts[i], pts[i + 1], pts[i + 2]).applyQuaternion(_pq);
      v.set(v.x + part.offset.x, v.y + part.offset.y, v.z + part.offset.z).applyQuaternion(_q);
      out.push(v.set(b.pos.x + v.x, b.pos.y + v.y, b.pos.z + v.z));
    }
  }
  return out;
}

/** Deepest any collider vertex of the body lies below the ground right under it (m). */
function buried(b: ObstacleBody, t: Terrain): number {
  let worst = -Infinity;
  for (const p of colliderPoints(b)) worst = Math.max(worst, t.heightAt(p.x, p.z) - p.y);
  return worst;
}

/** Power Valley's wind ridge: a 6 m hill (radius 22 m) on a 0.10 slope, the turbine on its crest. */
const crest = (x: number, z: number): number => {
  const q2 = (x * x + (z - 100) * (z - 100)) / (22 * 22);
  return 200 - 0.1 * z + (q2 < 1 ? 6 * (1 - q2) * (1 - q2) : 0);
};

function terrainWith(obstacles: ObstaclePlacement[], height: (x: number, z: number) => number): Terrain {
  return createAnalyticTerrain({ height, cellSize: 2, length: 400, width: 160, level: { obstacles } });
}

describe('a footing set deep into a hill crest is torn out when the tower is released', () => {
  it('the turbine pad starts buried, is lifted clear with its head, and the tower falls', async () => {
    const t = terrainWith([{ kind: 'windTurbine', s: 100, d: 0 }], crest);
    const w = await createPhysicsWorld(t, { seed: 5 });
    run(w, 0.5);
    const [tower] = ofKind(w, 'windTurbine', 'windTurbine');
    const [head] = ofKind(w, 'windTurbine', 'deck');
    // The 0.6 m pad is set into the lowest ground under it: on the crest it is buried completely.
    expect(buried(tower, t)).toBeGreaterThan(0.6);
    const gap0 = w.lowestPointY(head.id) - tower.proxy.top;
    const foot = { x: tower.pos.x, z: tower.pos.z };
    const v = momentumBreakSpeed(tower.breakImpulse, 220) * 1.3;
    expect(w.applyContact(hit(tower, v, 220)).result).toBe('uprooted');
    // Lifted so no collider part is buried deeper than a quarter of its thinnest size (pad: 0.15
    // m), the head with it (still resting on the tower top, not driven into it).
    expect(buried(tower, t)).toBeLessThan(PHYSICS_TUNING.releaseBuried * 0.6 + 1e-6);
    expect(w.lowestPointY(head.id) - tower.proxy.top).toBeCloseTo(gap0, 3);
    run(w, 8);
    // Before, Rapier pushed the buried pad further in and the tower stood jammed (tilt 0.05).
    expect(w.tiltOf(tower.id)).toBeGreaterThan(1.2);
    const top = topFrom(tower, foot);
    expect(top.z).toBeGreaterThan(0.6 * tower.localMax.y);
    expect(head.pos.y).toBeLessThan(head.spawn.y - 15);
    expect(buried(tower, t)).toBeLessThan(0.5);
    w.dispose();
  });
});

describe('pushes on a released tower that still stands tip it over its foot', () => {
  it('a shove at its foot tips it over the foot instead of kicking the foot out', async () => {
    const t = terrainWith([{ kind: 'windTurbine', s: 100, d: 0 }], () => 5);
    const w = await createPhysicsWorld(t, { seed: 5 });
    run(w, 0.5);
    const [tower] = ofKind(w, 'windTurbine', 'windTurbine');
    const foot = { x: tower.pos.x, z: tower.pos.z };
    // Released by a hit that hands over almost nothing, then shoved six times at its foot (1.2 m up)
    // by an iceberg closing at 6 m/s, 36 t·m/s each (pushAccel·dt·m, what the solver gives rubble
    // it ploughs through). Before, the shoves drove the foot ahead under the tower, which rocked
    // back toward the iceberg (in the real solver it then stood, balanced on its pad's edge).
    const c0 = hit(tower, 0.05, 220);
    c0.testImpulse = tower.breakImpulse;
    expect(w.applyContact(c0).result).toBe('uprooted');
    for (let i = 0; i < 6; i++) {
      w.step(DT);
      const p = tower.proxy;
      const c: IcebergContact = {
        obstacleId: tower.id,
        impulse: { x: 0, y: 7.2, z: 36 },
        point: { x: p.x, y: p.bottom + 1.2, z: p.z - 3 },
        normal: { x: 0, y: 0, z: 1 },
        relSpeed: 6 - p.vz,
        speedLoss: 0,
        testImpulse: 36,
        shock: 0,
        push: true,
      };
      expect(w.applyContact(c).result).toBe('pushed');
    }
    w.step(DT);
    // Tipping forward (+z) well beyond the topple guarantee's 0.12 rad/s (its centre of percussion
    // driven up to the iceberg's 6 m/s: 0.25 rad/s), its foot still in place.
    expect(tower.angVel.x).toBeGreaterThan(0.2);
    expect(Math.hypot(tower.pos.x - foot.x, tower.pos.z - foot.z)).toBeLessThan(0.3);
    run(w, 8);
    expect(w.tiltOf(tower.id)).toBeGreaterThan(1.2);
    expect(topFrom(tower, foot).z).toBeGreaterThan(0.6 * tower.localMax.y);
    w.dispose();
  });

  it('the pushes never drive the point they land on faster than the iceberg closes', async () => {
    const t = terrainWith([{ kind: 'windTurbine', s: 100, d: 0 }], () => 5);
    const w = await createPhysicsWorld(t, { seed: 5 });
    run(w, 0.5);
    const [tower] = ofKind(w, 'windTurbine', 'windTurbine');
    expect(w.applyContact(hit(tower, 3, 220)).result).toBe('uprooted');
    let fastest = 0;
    for (let i = 0; i < 60; i++) {
      w.step(DT);
      const p = tower.proxy;
      w.applyContact({
        obstacleId: tower.id,
        impulse: { x: 0, y: 0, z: 36 },
        point: { x: p.x, y: p.bottom + 1.2, z: p.z - 3 },
        normal: { x: 0, y: 0, z: 1 },
        relSpeed: 8 - p.vz,
        speedLoss: 0,
        testImpulse: 36,
        shock: 0,
        push: true,
      });
      // The tower turns about its foot: its top moves (39 / 23.8) times as fast as the push point.
      fastest = Math.max(fastest, tower.angVel.x * tower.hitHeight);
    }
    expect(fastest).toBeLessThan(8 * 1.05);
    w.dispose();
  });
});

describe('a tower a hit only just broke still comes down', () => {
  for (const kind of ['windTurbine', 'lighthouse', 'smokestack'] as const) {
    it(`${kind}: broken with almost no momentum, it keeps tipping over the way it was pushed`, async () => {
      const t = terrainWith([{ kind, s: 100, d: 0 }], () => 5);
      const w = await createPhysicsWorld(t, { seed: 5 });
      run(w, 0.5);
      const [tower] = ofKind(w, kind, kind);
      const foot = { x: tower.pos.x, z: tower.pos.z };
      // A glancing scrape that passes the momentum test but hands over next to nothing (+x).
      const c = hit(tower, 0.05, 220, 1, 0);
      c.testImpulse = tower.breakImpulse;
      expect(w.applyContact(c).result).toBe('uprooted');
      run(w, 10);
      // Before, it rocked back onto its wide footing and stood loose for good (tilt ~0).
      expect(w.tiltOf(tower.id)).toBeGreaterThan(1.2);
      const top = topFrom(tower, foot);
      expect(top.x).toBeGreaterThan(0.6 * tower.localMax.y);
      w.dispose();
    });
  }
});

describe('a lattice pylon collides as the square of its legs', () => {
  it('every leg foot lies inside its proxy at any yaw (a circle left corner legs 0.8 m out)', async () => {
    for (const yaw of [0, 0.6, Math.PI / 4]) {
      const t = terrainWith([{ kind: 'pylon', s: 100, d: 0, yaw }], () => 5);
      const w = await createPhysicsWorld(t, { seed: 5 });
      const [pylon] = ofKind(w, 'pylon', 'pylon');
      const p = pylon.proxy;
      expect(p.rect).toBeDefined();
      const dir: ProxyDirection = { nx: 0, nz: 0 };
      let reach = 0;
      for (const v of colliderPoints(pylon)) {
        if (v.y > 5 + 3) continue;
        reach = Math.max(reach, Math.hypot(v.x - p.x, v.z - p.z));
        expect(proxyGap(v.x, v.z, p, dir), `yaw ${yaw}`).toBeLessThan(0);
      }
      expect(reach).toBeGreaterThan(3.4);
      // Face-on it reaches no further than the old circle did.
      expect(Math.max(p.rect!.hu, p.rect!.hv)).toBeLessThanOrEqual(3);
      w.dispose();
    }
  });
});
