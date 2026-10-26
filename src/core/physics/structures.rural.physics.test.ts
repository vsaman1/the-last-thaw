import { beforeAll, describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { createAnalyticTerrain, inclinedPlane } from '../testing/analyticTerrain';
import type {
  FlowQuery,
  GameEvent,
  IcebergContact,
  IcebergState,
  ObstacleKind,
  ObstaclePlacement,
  RiverTrailApi,
  Terrain,
} from '../types';
import { CONTACT_RESTITUTION } from '../obstacles/catalog';
import { getGeom, scaledPoints } from '../obstacles/shapes';
import { createPhysicsWorld, initRapier, type ObstacleBody, type PhysicsWorld } from './world';

/**
 * Industry, farm and mountain structures in the Rapier world: break thresholds, clean releases
 * (no buried piece kicked out or stuck, nothing flung faster than the hit allows), the silo toppling
 * the way it is pushed, the log pile collapsing into logs that roll downhill and float off, the
 * chalet giving way before the stone house.
 */

const DT = 1 / 60;
const E = CONTACT_RESTITUTION;
const G = 9.81;

beforeAll(async () => {
  await initRapier();
});

type Height = (x: number, z: number) => number;

const flat =
  (h: number): Height =>
  (): number =>
    h;

function terrainWith(obstacles: ObstaclePlacement[], height: Height = flat(5)): Terrain {
  return createAnalyticTerrain({ height, cellSize: 2, level: { obstacles } });
}

/** Head-on contact at closing speed vn from an iceberg of mass M along (nx, nz) (as in the solver). */
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

function run(w: PhysicsWorld, seconds: number, river?: RiverTrailApi, events?: GameEvent[]): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    if (river) w.applyWaterForces(river, DT);
    w.step(DT);
    const ev = w.drainEvents();
    if (events) events.push(...ev);
  }
}

/** Uniform river (0, 0, 6) m/s in the strip |x| < 6, surface 0.5 m above the ground. */
function fakeRiver(terrain: Terrain): RiverTrailApi {
  return {
    samples: [],
    version: 0,
    length: 0,
    record: (_i: IcebergState, _t: Terrain, _time: number) => {},
    flowAt: (x: number, z: number): FlowQuery | null =>
      Math.abs(x) < 6 ? { vx: 0, vz: 6, surfaceY: terrain.heightAt(x, z) + 0.5, strength: 1 } : null,
    disturb: () => {},
    reset: () => {},
  };
}

const ofKind = (w: PhysicsWorld, kind: ObstacleKind): ObstacleBody[] =>
  w.bodies.filter((b) => b.active && b.kind === kind && b.originId === b.id);

const piecesOf = (w: PhysicsWorld, b: ObstacleBody): ObstacleBody[] =>
  w.bodies.filter((p) => p.originId === b.id && p.id !== b.id);

const speed = (b: ObstacleBody): number => Math.hypot(b.proxy.vx, b.proxy.vy, b.proxy.vz);

/** How deep (m) the body's deepest hull vertex is below the terrain under it (≤ 0: clear). */
function depth(b: ObstacleBody, t: Terrain): number {
  const q = new Quaternion(b.quat.x, b.quat.y, b.quat.z, b.quat.w);
  const pq = new Quaternion();
  const v = new Vector3();
  let worst = -Infinity;
  for (const part of b.parts) {
    if (part.decor) continue;
    const pts = scaledPoints(getGeom(part.geom), part.scale);
    pq.set(part.rotation.x, part.rotation.y, part.rotation.z, part.rotation.w);
    for (let i = 0; i < pts.length; i += 3) {
      v.set(pts[i], pts[i + 1], pts[i + 2]).applyQuaternion(pq);
      v.set(v.x + part.offset.x, v.y + part.offset.y, v.z + part.offset.z).applyQuaternion(q);
      const x = b.pos.x + v.x;
      const z = b.pos.z + v.z;
      worst = Math.max(worst, t.heightAt(x, z) - (b.pos.y + v.y));
    }
  }
  return worst;
}

// kind, iceberg mass (t), closing speed at which it breaks (m/s), result, pieces, building
const KINDS: [ObstacleKind, number, number, 'broken' | 'uprooted', number, boolean][] = [
  ['tank', 30, 20, 'broken', 7, true],
  // (tank: 12 plates torn off in pairs + roof = 7 pieces)
  ['factoryHall', 100, 9, 'broken', 15, true],
  ['chalet', 30, 12, 'broken', 9, true],
  ['skiLiftPylon', 30, 10, 'uprooted', 0, false],
  ['barn', 30, 11, 'broken', 12, true],
  ['silo', 30, 18, 'broken', 5, true],
  ['logPile', 30, 2, 'broken', 10, false],
];

describe('rural structures: break thresholds in the physics world', () => {
  it('each kind shakes just below its break speed and gives way just above it', async () => {
    const t = terrainWith(KINDS.map(([kind], i): ObstaclePlacement => ({ kind, s: 40 + i * 50, d: 0 })));
    const w = await createPhysicsWorld(t, { seed: 4 });
    const events: GameEvent[] = [];
    for (const [kind, M, v, result, n] of KINDS) {
      const [b] = ofKind(w, kind);
      expect(b.anchored, kind).toBe(true);
      expect(w.applyContact(hit(b, v * 0.97, M)).result, kind).toBe('shook');
      expect(b.active && b.anchored).toBe(true);
      expect(w.applyContact(hit(b, v * 1.03, M)).result, kind).toBe(result);
      const pieces = piecesOf(w, b);
      expect(pieces.length, kind).toBe(n);
      if (n > 0) {
        expect(b.active).toBe(false);
        expect(pieces.every((p) => p.active && !p.anchored && w.isDynamic(p.id))).toBe(true);
        expect(pieces.reduce((a, p) => a + p.mass, 0)).toBeCloseTo(b.mass, 6);
        expect(pieces.every((p) => p.material === b.material)).toBe(true);
      } else {
        expect(b.active && !b.anchored && w.isDynamic(b.id)).toBe(true);
      }
    }
    run(w, 1, undefined, events);
    expect(w.stats.buildingsDestroyed).toBe(KINDS.filter((k) => k[5]).length);
    expect(w.stats.knockedDown).toBe(KINDS.length);
    for (const [kind] of KINDS) {
      expect(events.some((e) => e.type === 'obstacleBroken' && e.kind === kind)).toBe(true);
    }
    w.dispose();
  });

  it('the timber chalet gives way at speeds the stone house shrugs off', async () => {
    const t = terrainWith([
      { kind: 'chalet', s: 40, d: 0 },
      { kind: 'house', s: 80, d: 0 },
      { kind: 'chalet', s: 120, d: 0 },
    ]);
    const w = await createPhysicsWorld(t, { seed: 6 });
    const [c1, c2] = ofKind(w, 'chalet');
    const [house] = ofKind(w, 'house');
    expect(w.applyContact(hit(c1, 11.6)).result).toBe('shook');
    expect(w.applyContact(hit(house, 13)).result).toBe('shook');
    expect(w.applyContact(hit(c2, 13)).result).toBe('broken');
    // A heavier iceberg needs proportionally less: 100 t breaks the chalet at 3.6 m/s.
    expect(w.applyContact(hit(c1, 3.7, 100)).result).toBe('broken');
    expect(house.active && house.anchored).toBe(true);
    expect(w.stats.buildingsDestroyed).toBe(2);
    w.dispose();
  });
});

describe('rural structures: clean release on flat and sloped ground', () => {
  // Regression cover for the forced-sleep fix: debris resting under still-moving debris used to be
  // slept by updateRest() and sink through the ground (see sleep.test.ts).
  const grounds: [string, (x: number, z: number) => number][] = [
    ['flat', flat(5)],
    ['0.12 slope', inclinedPlane(0.12)],
  ];
  for (const [label, height] of grounds) {
    for (const [kind, M, v] of KINDS) {
      it(`${kind} (${label}): debris no faster than the hit allows, none left in the ground`, async () => {
        const t = terrainWith([{ kind, s: 80, d: 0, yaw: 0.3 }], height);
        const w = await createPhysicsWorld(t, { seed: 8 });
        const [b] = ofKind(w, kind);
        const vHit = v * 1.15;
        const tall = b.proxy.top - b.proxy.bottom;
        expect(w.applyContact(hit(b, vHit, M)).result).not.toBe('shook');
        const pieces = piecesOf(w, b);
        const all = pieces.length > 0 ? pieces : [b];
        const buried0 = Math.max(...all.map((p) => depth(p, t)));
        w.step(DT);
        // Straight after the break: the share of the hit plus a step of gravity, no depenetration kick.
        for (const p of all) expect(speed(p)).toBeLessThan((1 + E) * vHit + 0.3);
        let fastest = 0;
        let deepest = -Infinity;
        for (let i = 0; i < 120; i++) {
          w.step(DT);
          for (const p of all) {
            if (!p.active) continue;
            fastest = Math.max(fastest, speed(p));
            deepest = Math.max(deepest, depth(p, t));
          }
        }
        // Falling from the structure's height is the only extra speed.
        expect(fastest).toBeLessThan((1 + E) * vHit + Math.sqrt(2 * G * tall) + 1);
        // Never pushed further into the ground than it started; out of it after two seconds.
        expect(deepest).toBeLessThan(Math.max(buried0, 0.05) + 0.15);
        for (const p of all) if (p.active) expect(depth(p, t)).toBeLessThan(0.3);
        w.dispose();
      });
    }
  }
});

describe('rural structures: how they fall', () => {
  it('silo: topples in segments in the direction it is pushed', async () => {
    const t = terrainWith([
      { kind: 'silo', s: 60, d: 0 },
      { kind: 'silo', s: 140, d: 0 },
    ]);
    const w = await createPhysicsWorld(t, { seed: 9 });
    const [a, b] = ofKind(w, 'silo');
    const top0 = a.proxy.top;
    // One pushed down-course (+z), the other across the valley (+x).
    for (const [silo, nx, nz] of [[a, 0, 1], [b, 1, 0]] as const) {
      expect(w.applyContact(hit(silo, 20, 30, nx, nz)).result).toBe('broken');
    }
    // An 18 m column leans over and lands in ~3.5 s.
    run(w, 1.5);
    for (const silo of [a, b]) {
      const segs = piecesOf(w, silo);
      const tilts = segs.map((p) => w.tiltOf(p.id));
      // Still one leaning column at first: the segments tilt together.
      expect(Math.min(...tilts)).toBeGreaterThan(0.2);
      expect(Math.max(...tilts) - Math.min(...tilts)).toBeLessThan(0.25);
    }
    run(w, 3.5);
    for (const [silo, nx, nz] of [[a, 0, 1], [b, 1, 0]] as const) {
      const segs = piecesOf(w, silo);
      expect(segs.length).toBe(5);
      const along = (p: ObstacleBody): number => (p.pos.x - silo.pos.x) * nx + (p.pos.z - silo.pos.z) * nz;
      const across = (p: ObstacleBody): number => (p.pos.x - silo.pos.x) * nz - (p.pos.z - silo.pos.z) * nx;
      const byHeight = [...segs].sort((p, q) => p.spawn.y - q.spawn.y);
      const bottom = byHeight[0];
      const dome = byHeight[byHeight.length - 1];
      // Everything went the push direction, the higher segments further: it fell over forward.
      for (const p of segs) expect(along(p)).toBeGreaterThan(1);
      expect(along(dome)).toBeGreaterThan(along(bottom) + 8);
      for (const p of segs) expect(Math.abs(across(p))).toBeLessThan(0.5 * along(p) + 2);
      // Down on the ground: a ring on its side has its centre ~3 m up (one may land on another).
      expect(dome.proxy.top).toBeLessThan(top0 - 10);
      expect(segs.filter((p) => p.pos.y - 5 < 4.2).length).toBeGreaterThanOrEqual(4);
      // In separate segments strung out along the fall line.
      const along0 = byHeight.map(along);
      for (let i = 1; i < along0.length; i++) expect(along0[i]).toBeGreaterThan(along0[i - 1] + 1);
    }
    w.dispose();
  });

  it('ski lift pylon: topples over in the push direction, chair and all', async () => {
    const t = terrainWith([{ kind: 'skiLiftPylon', s: 60, d: 0 }]);
    const w = await createPhysicsWorld(t, { seed: 10 });
    const [pylon] = ofKind(w, 'skiLiftPylon');
    const x0 = pylon.pos.x;
    expect(w.applyContact(hit(pylon, 8)).result).toBe('shook');
    expect(w.applyContact(hit(pylon, 11)).result).toBe('uprooted');
    run(w, 3);
    expect(w.tiltOf(pylon.id)).toBeGreaterThan(1.2);
    // Lying along the push direction (+z): its top end came down ahead of where it stood.
    expect(pylon.proxy.top).toBeLessThan(5 + 2.5);
    expect(pylon.proxy.z).toBeGreaterThan(60 + 3);
    expect(Math.abs(pylon.proxy.x - x0)).toBeLessThan(3);
    expect(pylon.parts.filter((p) => p.decor).length).toBeGreaterThan(15);
    w.dispose();
  });

  it('log pile: holds until hit, then collapses and the logs roll down the slope', async () => {
    const t = terrainWith([{ kind: 'logPile', s: 60, d: 0, yaw: 0 }], inclinedPlane(0.15));
    const w = await createPhysicsWorld(t, { seed: 11 });
    const [pile] = ofKind(w, 'logPile');
    const top0 = pile.proxy.top - t.heightAt(pile.proxy.x, pile.proxy.z);
    expect(top0).toBeGreaterThan(1.1);
    run(w, 2);
    expect(pile.active && pile.anchored).toBe(true);
    expect(w.applyContact(hit(pile, 1.5)).result).toBe('shook');
    expect(w.applyContact(hit(pile, 5)).result).toBe('broken');
    const logs = piecesOf(w, pile);
    expect(logs.length).toBe(10);
    expect(logs.every((l) => l.part === 'log' && l.material === 'wood')).toBe(true);
    const rolled = new Set<number>();
    for (let i = 0; i < 240; i++) {
      w.step(DT);
      for (const l of logs) {
        const wv = l.angVel;
        // Rolling: spinning about the log's own axis (across the slope, ~x) at a good rate.
        if (Math.abs(wv.x) > 3 && Math.abs(wv.x) > 2 * Math.hypot(wv.y, wv.z)) rolled.add(l.id);
      }
    }
    expect(rolled.size).toBeGreaterThanOrEqual(6);
    const downhill = logs.map((l) => l.pos.z - l.spawn.z);
    expect(downhill.filter((d) => d > 2).length).toBeGreaterThanOrEqual(8);
    expect(downhill.reduce((a, d) => a + d, 0) / logs.length).toBeGreaterThan(4);
    // The stack is gone: no log is still up on the others.
    for (const l of logs) {
      expect(l.proxy.top - t.heightAt(l.proxy.x, l.proxy.z)).toBeLessThan(0.75);
      expect(depth(l, t)).toBeLessThan(0.2);
    }
    expect(w.stats.buildingsDestroyed).toBe(0);
    w.dispose();
  });

  it('log pile: knocked into the river, the logs float and drift downstream', async () => {
    const t = terrainWith([{ kind: 'logPile', s: 60, d: 0, yaw: 0 }]);
    const w = await createPhysicsWorld(t, { seed: 12 });
    const river = fakeRiver(t);
    const [pile] = ofKind(w, 'logPile');
    // Anchored while intact: the water alone does not carry the stack off.
    run(w, 1, river);
    expect(pile.active && pile.anchored).toBe(true);
    expect(w.applyContact(hit(pile, 2.5)).result).toBe('broken');
    const logs = piecesOf(w, pile);
    run(w, 4, river);
    const wet = logs.filter((l) => l.inWater);
    expect(wet.length).toBeGreaterThanOrEqual(8);
    for (const l of wet) {
      expect(l.pos.z - l.spawn.z).toBeGreaterThan(6);
      // Afloat: riding at the surface, not dragged along the bed.
      expect(l.proxy.top).toBeGreaterThan(t.heightAt(l.proxy.x, l.proxy.z) + 0.5);
    }
    expect(w.stats.sweptByWater).toBeGreaterThanOrEqual(1);
    w.dispose();
  });
});

describe('rural structures: performance', () => {
  it('one of each kind smashed at once on a slope stays within the step budget', async () => {
    const placements = KINDS.map(([kind], i): ObstaclePlacement => {
      return { kind, s: 50 + i * 55, d: i % 2 ? 12 : -12 };
    });
    const t = createAnalyticTerrain({
      height: inclinedPlane(0.1, 200),
      cellSize: 2,
      width: 160,
      length: 500,
      halfWidth: 40,
      level: { obstacles: placements },
    });
    const w = await createPhysicsWorld(t, { seed: 13 });
    const intact = w.bodies.length;
    for (const b of [...w.bodies]) if (b.anchored) w.applyContact(hit(b, 12, 150));
    const t0 = performance.now();
    const c0 = process.cpuUsage();
    run(w, 5);
    const wall = performance.now() - t0;
    const c = process.cpuUsage(c0);
    const ms = Math.min(wall, (c.user + c.system) / 1000);
    const debris = w.bodies.filter((b) => b.active).length;
    console.log(
      `[rural perf] ${intact} intact bodies -> ${debris} active after smashing; 300 steps ` +
        `${ms.toFixed(0)} ms (${(ms / 300).toFixed(2)} ms/step), awake at end ${w.awakeCount}`,
    );
    // 7 + 15 + 9 + 1 + 12 + 5 + 10 bodies of debris (the pylon topples whole).
    expect(debris).toBe(59);
    // Seven big structures collapsing in the same five seconds: a guard against pathological
    // contact cost (~3 ms/step measured on a laptop), not a benchmark.
    expect(ms).toBeLessThan(3000);
    w.dispose();
  });
});
