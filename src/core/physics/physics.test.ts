import { beforeAll, describe, expect, it } from 'vitest';
import { createAnalyticTerrain, inclinedPlane } from '../testing/analyticTerrain';
import type {
  FlowQuery,
  GameEvent,
  IcebergContact,
  IcebergState,
  ObstacleKind,
  ObstaclePlacement,
  RiverSample,
  RiverTrailApi,
  Terrain,
} from '../types';
import {
  closingSpeedFor,
  contactImpulseFor,
  HOUSE,
  momentumBreakSpeed,
  PINE,
  STONE_BARRIER,
} from '../obstacles/catalog';
import { buildObstacleSpecs } from '../obstacles/spawn';
import { geomRegistry } from '../obstacles/shapes';
import { createIceberg, isStuck, resolveIcebergContacts, stepIceberg } from '../sim/iceberg';
import { DEFAULT_ICEBERG_PARAMS } from '../sim/params';
import { createPhysicsWorld, initRapier, type ObstacleBody, type PhysicsWorld } from './world';

const DT = 1 / 60;

beforeAll(async () => {
  await initRapier();
});

const flat =
  (h: number) =>
  (): number =>
    h;

function terrainWith(obstacles: ObstaclePlacement[], height: (x: number, z: number) => number = flat(5)): Terrain {
  return createAnalyticTerrain({ height, cellSize: 2, level: { obstacles } });
}

function run(w: PhysicsWorld, seconds: number, river?: RiverTrailApi, events?: GameEvent[]): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    if (river) w.applyWaterForces(river, DT);
    w.step(DT);
    const ev = w.drainEvents();
    if (events) events.push(...ev);
  }
}

/** Momentum-rule test impulse a 30 t iceberg brings at closing speed vn: (1+e)·vn·M. */
const testFor = (vn: number): number => 1.25 * vn * 30;

/**
 * A head-on contact along +normal at closing speed vn, as the 30 t iceberg's solver makes it: the
 * body receives the shared (loose-body) impulse; anchored bodies are tested with its momentum.
 */
function contactFor(b: ObstacleBody, vn: number, nx = 0, nz = 1): IcebergContact {
  const J = contactImpulseFor(b.mass, vn);
  return {
    obstacleId: b.id,
    impulse: { x: J * nx, y: 0.2 * J, z: J * nz },
    point: { x: b.proxy.x - nx * b.proxy.radius, y: b.proxy.bottom + 1.2, z: b.proxy.z - nz * b.proxy.radius },
    normal: { x: nx, y: 0, z: nz },
    relSpeed: vn,
    speedLoss: 0,
    testImpulse: b.anchored ? testFor(vn) : J,
    shock: J / 30,
  };
}

/** Fake river: uniform flow (0, 0, 6) m/s in the strip |x| < 5, surface 0.4 m above the ground. */
function fakeRiver(terrain: Terrain): RiverTrailApi {
  const samples: RiverSample[] = [];
  return {
    samples,
    version: 0,
    length: 0,
    record: (_i: IcebergState, _t: Terrain, _time: number) => {},
    flowAt: (x: number, z: number): FlowQuery | null =>
      Math.abs(x) < 5 ? { vx: 0, vz: 6, surfaceY: terrain.heightAt(x, z) + 0.4, strength: 1 } : null,
    disturb: () => {},
    reset: () => {},
  };
}

const horiz = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);

describe('catalog calibration (shared impulse rule)', () => {
  it('break thresholds land on the authored iceberg speeds', () => {
    expect(closingSpeedFor(PINE.nominalMass, contactImpulseFor(PINE.nominalMass, 7))).toBeCloseTo(7);
    expect(contactImpulseFor(2, 7)).toBeCloseTo(1.25 * 7 * (60 / 32));
    expect(contactImpulseFor(HOUSE.mass, 15)).toBeCloseTo(1.25 * 15 * (360 / 42));
  });

  it('every geometry has a non-empty mesh and hull', () => {
    for (const g of geomRegistry().values()) {
      expect(g.mesh.positions.length).toBeGreaterThan(0);
      expect(g.mesh.positions.length % 9).toBe(0);
      expect(g.points.length).toBeGreaterThanOrEqual(12);
    }
  });

  it('spawn specs are deterministic for a seed', () => {
    const t = terrainWith([
      { kind: 'rockCluster', s: 40, d: 3 },
      { kind: 'pine', s: 60, d: -8 },
      { kind: 'stoneBarrier', s: 80, d: 0 },
    ]);
    const a = buildObstacleSpecs(t, 11);
    const b = buildObstacleSpecs(t, 11);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(buildObstacleSpecs(t, 12))).not.toBe(JSON.stringify(a));
  });
});

describe('terrain trimesh', () => {
  it('matches the heightGrid triangulation exactly (ray casts on a bumpy grid)', async () => {
    const bumpy = (x: number, z: number): number => 8 + 3 * Math.sin(x * 0.37) * Math.cos(z * 0.23) + 0.04 * x * z;
    const t = createAnalyticTerrain({ height: bumpy, cellSize: 2.5 });
    for (const mode of ['course', 'full'] as const) {
      const w = await createPhysicsWorld(t, { seed: 1, terrainMode: mode });
      let worst = 0;
      for (let i = 0; i < 300; i++) {
        const x = -40 + ((i * 37) % 80) + 0.31 * (i % 7);
        const z = 5 + ((i * 53) % 380) + 0.17 * (i % 5);
        const y = w.castRayDown(x, z);
        expect(y).not.toBeNull();
        worst = Math.max(worst, Math.abs((y ?? 0) - t.heightAt(x, z)));
      }
      expect(worst).toBeLessThan(2e-3);
      w.dispose();
    }
  });

  it('restarts reuse the terrain mesh arrays per terrain and mode (only the collider is new)', async () => {
    const bumpy = (x: number, z: number): number => 8 + 2 * Math.sin(x * 0.29) * Math.cos(z * 0.19);
    const t = createAnalyticTerrain({ height: bumpy, cellSize: 2.5 });
    const first = await createPhysicsWorld(t, { seed: 1 });
    const again = await createPhysicsWorld(t, { seed: 2 });
    const full = await createPhysicsWorld(t, { seed: 1, terrainMode: 'full' });
    const twin = createAnalyticTerrain({ height: bumpy, cellSize: 2.5 });
    const other = await createPhysicsWorld(twin, { seed: 1 });
    expect(first.buildInfo.terrainCached).toBe(false);
    expect(again.buildInfo.terrainCached).toBe(true);
    expect(full.buildInfo.terrainCached).toBe(false);
    expect(other.buildInfo.terrainCached).toBe(false);
    expect(again.buildInfo.terrainTriangles).toBe(first.buildInfo.terrainTriangles);
    expect(full.buildInfo.terrainTriangles).toBeGreaterThanOrEqual(first.buildInfo.terrainTriangles);
    first.dispose();
    // The cached mesh still collides exactly like the height grid in the rebuilt world.
    for (let i = 0; i < 50; i++) {
      const x = -30 + ((i * 37) % 60);
      const z = 20 + ((i * 53) % 300);
      expect(Math.abs((again.castRayDown(x, z) ?? NaN) - t.heightAt(x, z))).toBeLessThan(2e-3);
    }
    again.dispose();
    full.dispose();
    other.dispose();
  });

  it('dropped rocks settle at ground height (+/- 0.3 m) at several spots', async () => {
    const t = terrainWith([]);
    const w = await createPhysicsWorld(t, { seed: 2 });
    const spots: [ObstacleKind, number, number][] = [
      ['rockSmall', 0, 30],
      ['rockMedium', -14.3, 77.7],
      ['boulder', 9.1, 150.2],
      ['rockSmall', 17.6, 233.9],
      ['rockMedium', -31.2, 310.4],
    ];
    const bodies = spots.map(([k, x, z]) => w.spawn(k, x, z, { y: 9 })[0]);
    run(w, 4);
    for (const b of bodies) {
      expect(b.active).toBe(true);
      expect(Math.abs(w.lowestPointY(b.id) - 5)).toBeLessThan(0.3);
    }
    w.dispose();
  });

  it('a loose rock rolls downhill on a 0.3 slope (and rests on a 0.15 one)', async () => {
    const steep = await createPhysicsWorld(terrainWith([], inclinedPlane(0.3)), { seed: 3 });
    const gentle = await createPhysicsWorld(terrainWith([], inclinedPlane(0.15)), { seed: 3 });
    const xs = [-12, -6, 0, 6, 12];
    const rolled = xs.map((x, i) => steep.spawn('rockSmall', x, 60 + i * 30, { yaw: i * 1.3 })[0]);
    const rested = xs.map((x, i) => gentle.spawn('rockSmall', x, 60 + i * 30, { yaw: i * 1.3 })[0]);
    const starts = rolled.map((b) => ({ ...b.pos }));
    const gentleStarts = rested.map((b) => ({ ...b.pos }));
    run(steep, 4);
    run(gentle, 4);
    rolled.forEach((b, i) => {
      expect(b.pos.z - starts[i].z).toBeGreaterThan(2);
      expect(b.pos.y).toBeLessThan(starts[i].y - 0.6);
      expect(Math.abs(b.pos.x - starts[i].x)).toBeLessThan(b.pos.z - starts[i].z);
    });
    rested.forEach((b, i) => expect(b.pos.z - gentleStarts[i].z).toBeLessThan(1.5));
    steep.dispose();
    gentle.dispose();
  });
});

describe('iceberg contacts', () => {
  it('pushes a rock along the impulse; a heavier rock moves less for the same impulse', async () => {
    const t = terrainWith([]);
    const w = await createPhysicsWorld(t, { seed: 4 });
    const small = w.spawn('rockSmall', -8, 50)[0];
    const medium = w.spawn('rockMedium', 8, 50)[0];
    run(w, 1.5);
    const s0 = { ...small.pos };
    const m0 = { ...medium.pos };
    const J = 6;
    for (const b of [small, medium]) {
      const out = w.applyContact({
        obstacleId: b.id,
        impulse: { x: J * 0.6, y: 0, z: J * 0.8 },
        point: { x: b.proxy.x, y: b.proxy.y, z: b.proxy.z - b.proxy.radius },
        normal: { x: 0.6, y: 0, z: 0.8 },
        relSpeed: 5,
        speedLoss: 0,
        shock: J / 30,
      });
      expect(out.result).toBe('pushed');
    }
    run(w, 1.5);
    const ds = { x: small.pos.x - s0.x, z: small.pos.z - s0.z };
    const dm = { x: medium.pos.x - m0.x, z: medium.pos.z - m0.z };
    expect(Math.hypot(ds.x, ds.z)).toBeGreaterThan(0.8);
    // Moved along the impulse direction (0.6, 0.8).
    expect((ds.x * 0.6 + ds.z * 0.8) / Math.hypot(ds.x, ds.z)).toBeGreaterThan(0.8);
    expect(Math.hypot(dm.x, dm.z)).toBeLessThan(Math.hypot(ds.x, ds.z) * 0.6);
    w.dispose();
  });

  it('pine: below threshold it shakes and stays; above it uproots and topples', async () => {
    const t = terrainWith([
      { kind: 'pine', s: 50, d: 0 },
      { kind: 'pine', s: 120, d: 0 },
    ]);
    const w = await createPhysicsWorld(t, { seed: 5 });
    const [p1, p2] = w.bodies.filter((b) => b.kind === 'pine');
    expect(p1.anchored).toBe(true);
    expect(p1.proxy.mass).toBeCloseTo(p1.mass);
    // Momentum rule: a 30 t iceberg uproots it at the authored speed, whatever the tree weighs.
    expect(momentumBreakSpeed(p1.breakImpulse)).toBeCloseTo(PINE.breakSpeed);

    const start = { ...p1.pos };
    const weak = w.applyContact(contactFor(p1, 5.5));
    expect(weak.result).toBe('shook');
    expect(p1.shake.amp).toBeGreaterThan(0);
    run(w, 1);
    expect(horiz(p1.pos, start)).toBeLessThan(1e-6);
    expect(w.isDynamic(p1.id)).toBe(false);
    expect(w.stats.treesFelled).toBe(0);

    const strong = w.applyContact(contactFor(p2, 8.5));
    expect(strong.result).toBe('uprooted');
    expect(w.isDynamic(p2.id)).toBe(true);
    expect(p2.proxy.anchored).toBe(false);
    let maxTilt = 0;
    const events: GameEvent[] = [];
    for (let i = 0; i < 180; i++) {
      w.step(DT);
      events.push(...w.drainEvents());
      maxTilt = Math.max(maxTilt, w.tiltOf(p2.id));
    }
    expect(maxTilt).toBeGreaterThan(Math.PI / 4);
    // Toppled/pushed in the push direction (+z); p2 started at z = 120.
    expect(p2.pos.z - 120).toBeGreaterThan(1);
    expect(events.some((e) => e.type === 'treeFelled' && e.obstacleId === p2.id)).toBe(true);
    expect(w.stats.treesFelled).toBe(1);
    expect(w.stats.knockedDown).toBe(1);
    w.dispose();
  });

  it('house: below threshold shakes; above breaks into >= 6 loose pieces', async () => {
    const t = terrainWith([
      { kind: 'house', s: 60, d: 0 },
      { kind: 'house', s: 160, d: 12 },
    ]);
    const w = await createPhysicsWorld(t, { seed: 6 });
    const [h1, h2] = w.bodies.filter((b) => b.kind === 'house');
    expect(momentumBreakSpeed(h1.breakImpulse)).toBeCloseTo(HOUSE.breakSpeed);
    expect(w.applyContact(contactFor(h2, 12)).result).toBe('shook');
    expect(h2.active).toBe(true);

    const out = w.applyContact(contactFor(h1, 17));
    expect(out.result).toBe('broken');
    const events: GameEvent[] = [];
    run(w, 2, undefined, events);
    const pieces = w.bodies.filter((b) => b.originId === h1.id && b.id !== h1.id);
    expect(pieces.length).toBeGreaterThanOrEqual(6);
    expect(pieces.every((p) => p.active && !p.anchored && w.isDynamic(p.id))).toBe(true);
    expect(h1.active).toBe(false);
    const totalMass = pieces.reduce((a, p) => a + p.mass, 0);
    expect(totalMass).toBeCloseTo(h1.mass, 3);
    // Debris was flung mostly in the push direction (+z).
    const meanDz = pieces.reduce((a, p) => a + (p.pos.z - p.spawn.z), 0) / pieces.length;
    expect(meanDz).toBeGreaterThan(0.5);
    expect(w.stats.buildingsDestroyed).toBe(1);
    expect(w.stats.knockedDown).toBe(1);
    expect(events.some((e) => e.type === 'obstacleBroken' && e.obstacleId === h1.id)).toBe(true);
    w.dispose();
  });

  it('house break emits an obstacleBroken event for the original id', async () => {
    const t = terrainWith([{ kind: 'house', s: 60, d: 0 }]);
    const w = await createPhysicsWorld(t, { seed: 6 });
    const h = w.bodies[0];
    w.applyContact(contactFor(h, 18));
    const ev = w.drainEvents();
    expect(ev.some((e) => e.type === 'obstacleBroken' && e.obstacleId === h.id && e.kind === 'house')).toBe(true);
    w.dispose();
  });
});

describe('stone barrier', () => {
  for (const [label, height] of [
    ['flat', flat(5)],
    ['0.1 slope', inclinedPlane(0.1)],
  ] as const) {
    it(`stands after warm-up (${label})`, async () => {
      const placements: ObstaclePlacement[] = [
        { kind: 'stoneBarrier', s: 80, d: 0, count: 4 },
        { kind: 'stoneBarrier', s: 160, d: 4, count: 3 },
        { kind: 'stoneBarrier', s: 240, d: -6, count: 5 },
      ];
      const t = terrainWith(placements, height);
      const specs = buildObstacleSpecs(t, 9);
      const w = await createPhysicsWorld(t, { seed: 9 });
      expect(w.bodies.length).toBe(specs.length);
      expect(specs.length).toBe(4 + 3 + 5);
      for (let i = 0; i < specs.length; i++) {
        const b = w.bodies[i];
        expect(horiz(b.pos, specs[i].position)).toBeLessThan(0.5);
        expect(Math.abs(b.pos.y - specs[i].position.y)).toBeLessThan(0.5);
        expect(b.sleeping).toBe(true);
        expect(b.mass).toBeGreaterThanOrEqual(STONE_BARRIER.massMin);
        expect(b.mass).toBeLessThanOrEqual(STONE_BARRIER.massMax);
      }
      // Still standing two seconds later (asleep until hit).
      run(w, 2);
      for (let i = 0; i < specs.length; i++) expect(horiz(w.bodies[i].pos, specs[i].position)).toBeLessThan(0.5);
      expect(w.stats.knockedDown).toBe(0);
      w.dispose();
    });
  }

  it('with the real iceberg solver: a slow iceberg is held up, a fast one bursts through', async () => {
    const P = DEFAULT_ICEBERG_PARAMS;
    const charge = async (v0: number): Promise<{ z: number; vHit: number; vAfter: number }> => {
      const t = createAnalyticTerrain({
        height: inclinedPlane(0.05),
        cellSize: 2,
        level: { obstacles: [{ kind: 'stoneBarrier', s: 40, d: 0, count: 3 }], startS: 10 },
      });
      const w = await createPhysicsWorld(t, { seed: 21 });
      const ice = createIceberg(t, P);
      ice.vel.x = 0;
      ice.vel.y = -0.05 * v0;
      ice.vel.z = v0;
      let vHit = 0;
      let vAfter = 0;
      let hitStep = -1;
      for (let i = 0; i < 420; i++) {
        stepIceberg(ice, { steer: 0, source: 'none' }, t, DT, P, 10);
        const speed = Math.hypot(ice.vel.x, ice.vel.z);
        const contacts = resolveIcebergContacts(ice, w.proxiesNear(ice.pos.x, ice.pos.z, ice.radius + 8), P);
        if (contacts.length > 0 && hitStep < 0) {
          hitStep = i;
          vHit = speed;
        }
        for (const c of contacts) w.applyContact(c);
        w.step(DT);
        if (i === hitStep + 30) vAfter = Math.hypot(ice.vel.x, ice.vel.z);
      }
      w.dispose();
      return { z: ice.pos.z, vHit, vAfter };
    };
    const slow = await charge(6);
    expect(slow.vHit).toBeGreaterThan(5);
    // Held up: shoving the stones costs it a large share of its (already low) speed.
    expect(slow.vAfter / slow.vHit).toBeLessThan(0.7);
    const fast = await charge(18);
    expect(fast.z).toBeGreaterThan(60);
    // Costly but passable: the shared rule keeps ~75 % per 7-8 t stone engaged, and a centred hit
    // engages all three (two bottom, one top), so roughly half the speed survives.
    expect(fast.vAfter / fast.vHit).toBeGreaterThan(0.38);
    expect(fast.vAfter / fast.vHit).toBeLessThan(0.62);
  });

  it('a strong hit knocks stones out of the wall', async () => {
    const t = terrainWith([{ kind: 'stoneBarrier', s: 80, d: 0, count: 4 }]);
    const w = await createPhysicsWorld(t, { seed: 10 });
    const bottom = w.bodies.reduce((a, b) => (b.pos.y < a.pos.y ? b : a));
    w.applyContact(contactFor(bottom, 18));
    run(w, 2);
    expect(horiz(bottom.pos, bottom.spawn)).toBeGreaterThan(2);
    expect(w.stats.knockedDown).toBeGreaterThanOrEqual(1);
    expect(w.stats.rocksMoved).toBeGreaterThanOrEqual(1);
    w.dispose();
  });
});

describe('knocked heavy debris (review fixes)', () => {
  // Concave chute like the level's valley floor (a knocked boulder drifts back to the middle), boulder
  // almost on the line: before the fix it rolled a few metres, parked ahead and pinned the iceberg.
  for (const scale of [1, 1.2]) {
    it(`a boulder (scale ${scale}) the iceberg knocks leaves its line instead of pinning it`, async () => {
      const P = DEFAULT_ICEBERG_PARAMS;
      const t = createAnalyticTerrain({
        height: (x, z) => 100 - 0.07 * z + 0.01 * x * x,
        cellSize: 2,
        length: 600,
        level: { obstacles: [{ kind: 'boulder', s: 70, d: 0.3, scale }], startS: 10 },
      });
      const w = await createPhysicsWorld(t, { seed: 31 });
      const boulder = w.bodies[0];
      const ice = createIceberg(t, P);
      ice.vel.z = 12;
      let contactSteps = 0;
      let stuck = false;
      for (let i = 0; i < 60 * 45 && !stuck && ice.pos.z < 300; i++) {
        stepIceberg(ice, { steer: 0, source: 'none' }, t, DT, P, 10 + i * DT);
        const contacts = resolveIcebergContacts(ice, w.proxiesNear(ice.pos.x, ice.pos.z, ice.radius + 8), P);
        if (contacts.length > 0) contactSteps++;
        for (const c of contacts) w.applyContact(c);
        w.step(DT);
        stuck = isStuck(ice, P);
      }
      const b = boulder.pos;
      const where = `iceberg z=${ice.pos.z.toFixed(1)}, boulder (${b.x.toFixed(1)}, ${b.z.toFixed(1)})`;
      expect(stuck, where).toBe(false);
      expect(ice.pos.z, where).toBeGreaterThan(300);
      expect(contactSteps, where).toBeLessThan(20);
      w.dispose();
    });
  }
});

describe('water', () => {
  it('carries a small rock several metres while a boulder barely moves', async () => {
    const t = terrainWith([
      { kind: 'rockSmall', s: 40, d: 0 },
      { kind: 'rockMedium', s: 90, d: 0 },
      { kind: 'boulder', s: 150, d: 0 },
    ]);
    const w = await createPhysicsWorld(t, { seed: 12 });
    const [small, medium, boulder] = w.bodies;
    const river = fakeRiver(t);
    const events: GameEvent[] = [];
    run(w, 3, river, events);
    const ds = small.pos.z - small.spawn.z;
    const dm = medium.pos.z - medium.spawn.z;
    const db = boulder.pos.z - boulder.spawn.z;
    expect(ds).toBeGreaterThan(5);
    expect(db).toBeLessThan(0.5);
    expect(db).toBeLessThan(ds * 0.1);
    expect(dm).toBeLessThan(ds);
    expect(events.filter((e) => e.type === 'splash').length).toBe(3);
    expect(w.stats.sweptByWater).toBeGreaterThanOrEqual(1);
    w.dispose();
  });

  it('a felled tree floats downstream', async () => {
    const make = async (): Promise<{ w: PhysicsWorld; tree: ObstacleBody; t: Terrain }> => {
      const t = terrainWith([{ kind: 'pine', s: 60, d: 0 }]);
      const w = await createPhysicsWorld(t, { seed: 13 });
      const tree = w.bodies[0];
      expect(w.applyContact(contactFor(tree, 9)).result).toBe('uprooted');
      return { w, tree, t };
    };
    const wet = await make();
    const dry = await make();
    const river = fakeRiver(wet.t);
    run(wet.w, 2, river);
    run(dry.w, 2);
    const zWet1 = wet.tree.pos.z;
    const zDry1 = dry.tree.pos.z;
    run(wet.w, 4, river);
    run(dry.w, 4);
    const wetTravel = wet.tree.pos.z - zWet1;
    const dryTravel = dry.tree.pos.z - zDry1;
    expect(wetTravel).toBeGreaterThan(8);
    expect(dryTravel).toBeLessThan(1);
    expect(wet.tree.inWater).toBe(true);
    wet.w.dispose();
    dry.w.dispose();
  });

  it('distance LOD: far bodies are put to sleep and the river does not re-wake them', async () => {
    const t = terrainWith([
      { kind: 'rockSmall', s: 40, d: 0 },
      { kind: 'rockSmall', s: 330, d: 0 },
    ]);
    const w = await createPhysicsWorld(t, { seed: 16 });
    const [farRock, nearRock] = w.bodies;
    const river = fakeRiver(t);
    // The session's per-step query puts the LOD focus on the iceberg: first next to farRock...
    w.proxiesNear(0, 40, 10);
    run(w, 1, river);
    expect(farRock.sleeping).toBe(false);
    // ...then it moves on, and farRock is frozen after farSleepAfter seconds.
    w.proxiesNear(0, 330, 10);
    run(w, 5, river);
    expect(nearRock.pos.z - nearRock.spawn.z).toBeGreaterThan(15);
    expect(farRock.sleeping).toBe(true);
    const frozenZ = farRock.pos.z;
    expect(frozenZ - farRock.spawn.z).toBeGreaterThan(3);
    run(w, 2, river);
    expect(farRock.pos.z).toBe(frozenZ);
    // Disabling the LOD (NaN focus) lets the water pick it up again.
    w.setFocus(NaN, NaN);
    run(w, 2, river);
    expect(farRock.pos.z - frozenZ).toBeGreaterThan(3);
    w.dispose();
  });
});

describe('queries and scale', () => {
  it('proxiesNear returns near bodies only', async () => {
    const t = terrainWith([
      { kind: 'rockSmall', s: 50, d: 0 },
      { kind: 'rockSmall', s: 70, d: 0 },
      { kind: 'rockMedium', s: 50, d: -20 },
      { kind: 'pine', s: 200, d: 10 },
    ]);
    const w = await createPhysicsWorld(t, { seed: 14 });
    const [a, b, c, tree] = w.bodies;
    const ids = (x: number, z: number, r: number): number[] => w.proxiesNear(x, z, r).map((p) => p.id).sort();
    expect(ids(0, 50, 2)).toEqual([a.id]);
    expect(ids(0, 60, 11)).toEqual([a.id, b.id].sort());
    expect(ids(20, 50, 2)).toEqual([c.id]);
    expect(ids(-10, 200, 3)).toEqual([tree.id]);
    expect(ids(0, 130, 10)).toEqual([]);
    const p = w.proxiesNear(-10, 200, 3)[0];
    expect(p.anchored).toBe(true);
    expect(p.top).toBeGreaterThan(p.bottom + 5);
    expect(p.radius).toBeLessThan(1);
    w.dispose();
  });

  const valley = (x: number, z: number): number =>
    200 - 0.2 * z + Math.max(0, Math.abs(x) - 30) * 0.9 + 1.5 * Math.sin(x * 0.11) * Math.cos(z * 0.07);
  const bigLevel = (): Terrain => {
    const kinds: ObstacleKind[] = [
      'rockSmall',
      'rockMedium',
      'boulder',
      'rockCluster',
      'stoneBarrier',
      'pine',
      'broadleaf',
      'house',
      'pine',
      'rockSmall',
    ];
    const obstacles: ObstaclePlacement[] = [];
    for (let i = 0; i < 150; i++) {
      obstacles.push({ kind: kinds[i % kinds.length], s: 30 + i * 5.5, d: ((i * 37) % 50) - 25 });
    }
    return createAnalyticTerrain({
      height: valley,
      width: 400,
      length: 900,
      cellSize: 2.5,
      halfWidth: 30,
      level: { obstacles, wallRamp: 30 },
    });
  };
  interface Cost {
    wall: number;
    cpu: number;
    /**
     * What the work cost (ms): wall time, or this process's CPU time when that is lower, i.e. when
     * parallel test files or other processes were competing for the cores.
     */
    ms: number;
  }
  const startTimer = (): (() => Cost) => {
    const w0 = performance.now();
    const c0 = process.cpuUsage();
    return () => {
      const wall = performance.now() - w0;
      const c = process.cpuUsage(c0);
      const cpu = (c.user + c.system) / 1000;
      return { wall, cpu, ms: Math.min(wall, cpu) };
    };
  };
  const fmt = (c: Cost): string => `${c.ms.toFixed(0)}ms (wall ${c.wall.toFixed(0)}, cpu ${c.cpu.toFixed(0)})`;
  const perfLine = (label: string, w: PhysicsWorld, create: Cost, steps: Cost): string =>
    `[physics perf] ${label}: bodies=${w.bodies.length} active=${w.activeCount} ` +
    `tris=${w.buildInfo.terrainTriangles} create=${fmt(create)} ` +
    `[terrain ${w.buildInfo.terrainMs.toFixed(0)}, spawn ${w.buildInfo.spawnMs.toFixed(0)}, ` +
    `warm-up ${w.buildInfo.warmUpMs.toFixed(0)}] 600 steps=${fmt(steps)} ` +
    `= ${(steps.ms / 600).toFixed(2)} ms/step, awake at end=${w.awakeCount}`;

  it('builds a 400 x 900 m level with ~150 obstacles in < 3 s and runs 600 game-like steps in < 3 s', async () => {
    const t = bigLevel();
    const createTimer = startTimer();
    const w = await createPhysicsWorld(t, { seed: 15 });
    const create = createTimer();
    expect(w.bodies.length).toBeGreaterThan(200);

    // A stand-in iceberg slides down the course at 18 m/s doing what the session does each step:
    // steer toward the next standing obstacle ahead (players aim for trees and houses), query
    // proxies, hit what it overlaps (shared impulse rule), and leave a river behind.
    const ice = { x: 0, z: 20, r: 2.2, speed: 18 };
    const trail: { x: number; z: number }[] = [];
    const river: RiverTrailApi = {
      ...fakeRiver(t),
      flowAt: (x, z) => {
        if (z >= ice.z) return null;
        const p = trail[Math.max(0, Math.floor((z - 20) / (ice.speed * DT)))];
        if (!p || Math.abs(x - p.x) >= 5) return null;
        return { vx: 0, vz: 6, surfaceY: t.heightAt(x, z) + 0.4, strength: 1 };
      },
    };
    const lastHit = new Map<number, number>();
    let contacts = 0;
    let broken = 0;
    const stepTimer = startTimer();
    for (let i = 0; i < 600; i++) {
      let targetX = 0;
      let ahead = 60;
      for (const b of w.bodies) {
        const dz = b.pos.z - ice.z;
        const reachable = Math.abs(b.pos.x - ice.x) < (8 / ice.speed) * dz + 1.5;
        if (b.anchored && reachable && dz > 2 && dz < ahead) {
          ahead = dz;
          targetX = b.pos.x;
        }
      }
      ice.x += Math.max(-8 * DT, Math.min(8 * DT, targetX - ice.x));
      ice.z += ice.speed * DT;
      trail.push({ x: ice.x, z: ice.z });
      const y = t.heightAt(ice.x, ice.z);
      for (const p of w.proxiesNear(ice.x, ice.z, ice.r + 8)) {
        const dx = p.x - ice.x;
        const dz = p.z - ice.z;
        const d = Math.hypot(dx, dz);
        if (d > ice.r + p.radius || p.top < y - 0.3 || p.bottom > y + 2.8) continue;
        if ((lastHit.get(p.id) ?? -1) > i - 20) continue;
        lastHit.set(p.id, i);
        const nx = dx / (d || 1);
        const nz = dz / (d || 1);
        const vn = Math.max(1, ice.speed * nz - (p.vx * nx + p.vz * nz));
        const J = contactImpulseFor(p.mass, vn);
        const res = w.applyContact({
          obstacleId: p.id,
          impulse: { x: J * nx, y: 0.2 * J, z: J * nz },
          point: { x: ice.x + nx * ice.r, y: y + 1.2, z: ice.z + nz * ice.r },
          normal: { x: nx, y: 0, z: nz },
          relSpeed: vn,
          speedLoss: 0,
          testImpulse: p.anchored ? testFor(vn) : J,
          shock: J / 30,
        }).result;
        contacts++;
        if (res === 'broken' || res === 'uprooted') broken++;
      }
      w.applyWaterForces(river, DT);
      w.step(DT);
      w.drainEvents();
    }
    const steps = stepTimer();
    console.log(perfLine('game-like', w, create, steps) + ` contacts=${contacts} broken=${broken}`);
    expect(contacts).toBeGreaterThan(10);
    expect(broken).toBeGreaterThan(2);
    expect(create.ms).toBeLessThan(3000);
    expect(steps.ms).toBeLessThan(3000);
    for (const b of w.bodies) if (b.active) expect(b.pos.y).toBeGreaterThan(t.heightAt(b.pos.x, b.pos.z) - 3);
    w.dispose();
  });

  // Heavier measurement (~4 s); run with PHYSICS_PERF=1 to log it.
  it.skipIf(!process.env.PHYSICS_PERF)('stress: 12 violent hits + a river along the whole course', async () => {
    const t = bigLevel();
    const createTimer = startTimer();
    const w = await createPhysicsWorld(t, { seed: 15 });
    const create = createTimer();
    const river = fakeRiver(t);
    // The session's proxiesNear() calls put the LOD focus on the iceberg; here it sits among the hits.
    w.setFocus(0, 100);
    let hits = 0;
    for (const b of w.bodies) {
      if (hits >= 12) break;
      if (b.kind === 'house' || b.kind === 'pine' || b.kind === 'rockCluster') {
        w.applyContact(contactFor(b, 20));
        hits++;
      }
    }
    const stepTimer = startTimer();
    run(w, 600 * DT, river);
    console.log(perfLine('stress', w, create, stepTimer()));
    // Nothing fell through the trimesh.
    for (const b of w.bodies) if (b.active) expect(b.pos.y).toBeGreaterThan(t.heightAt(b.pos.x, b.pos.z) - 3);
    w.dispose();
  });
});
