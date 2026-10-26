import { describe, expect, it } from 'vitest';
import { FIXED_DT, GameSession } from '../session';
import { createAnalyticTerrain } from '../testing/analyticTerrain';
import { CONTACT_RESTITUTION } from '../obstacles/catalog';
import { DEFAULT_ICEBERG_PARAMS } from '../sim/params';
import { createIceberg, resolveIcebergContacts } from '../sim/iceberg';
import type { FlowQuery, ObstaclePlacement, RiverTrailApi, TerrainFeature } from '../types';
import { createPhysicsWorld, type PhysicsWorld } from './world';

/**
 * Road traffic in the physics world: vehicles placed on roads drive (their rigid bodies disabled,
 * poses from the traffic), signalised junctions get traffic lights whose lamps follow the signal,
 * and a vehicle hit by the iceberg, by debris, flooded by the river or losing its road becomes an
 * ordinary dynamic body moving at its driving velocity.
 *
 * Analytic terrain: a 0.03 slope along +z (s = z, d = -x), a main road along the course and a cross
 * street at s = 200 (town: asphalt, so the crossroads is signalised).
 */

const MAIN: TerrainFeature = { type: 'road', s0: 30, s1: 380, d: 0, width: 8 };
const CROSS: TerrainFeature = { type: 'street', points: [{ s: 200, d: -60 }, { s: 200, d: 60 }], width: 8 };
/** Lanes: driving +z keeps to d = +2 (right of travel), -z to d = -2. */
const UP_CAR: ObstaclePlacement = { kind: 'car', s: 120, d: 2, yaw: 0 };

function level(obstacles: ObstaclePlacement[], features: TerrainFeature[] = [MAIN, CROSS]) {
  return createAnalyticTerrain({
    height: (_x, z) => 60 - 0.03 * z,
    halfWidth: 70,
    width: 200,
    length: 420,
    cellSize: 2,
    level: { obstacles, features, theme: 'town' },
  });
}

async function world(obstacles: ObstaclePlacement[], features?: TerrainFeature[]): Promise<PhysicsWorld> {
  return createPhysicsWorld(level(obstacles, features), { seed: 11 });
}

const run = (w: PhysicsWorld, seconds: number): void => {
  for (let k = 0; k < seconds * 60; k++) w.step(FIXED_DT);
};

describe('road traffic in the physics world', () => {
  it('drives vehicles on roads, leaves parked ones, lights the signalised crossroads', async () => {
    const w = await world([
      UP_CAR,
      { kind: 'truck', s: 280, d: -2, yaw: Math.PI },
      { kind: 'car', s: 60, d: -2, yaw: Math.PI, parked: true },
      { kind: 'bus', s: 200, d: -40, yaw: -Math.PI / 2 },
      { kind: 'car', s: 100, d: 40 }, // in a field: stays put
    ]);
    const t = w.traffic!;
    expect(t).not.toBeNull();
    expect(t.count).toBe(3);
    const lights = w.bodies.filter((b) => b.kind === 'trafficLight');
    expect(lights).toHaveLength(4);
    expect(lights.every((b) => b.anchored && b.signal && b.signal.junction === 0)).toBe(true);
    const car = w.bodies[t.body[0]];
    const parked = w.bodies.find((b) => b.placement === 2)!;
    const field = w.bodies.find((b) => b.placement === 4)!;
    expect(car.driven).toBe(true);
    expect(parked.driven).toBe(false);
    expect(field.driven).toBe(false);
    const z0 = car.pos.z;
    run(w, 4);
    // It has driven up the course, standing on the road, its proxy carrying its velocity.
    // (From rest, accelerating at up to 1.6 m/s².)
    expect(car.pos.z - z0).toBeGreaterThan(10);
    expect(car.pos.y).toBeCloseTo(w.terrain.heightAt(car.pos.x, car.pos.z), 0);
    expect(car.proxy.vz).toBeGreaterThan(4);
    expect(Math.hypot(car.proxy.vx, car.proxy.vy, car.proxy.vz)).toBeCloseTo(t.v[0], 6);
    expect(parked.pos.z).toBeCloseTo(parked.spawn.z, 3);
    // Driving does not count as being knocked down.
    expect(w.stats.knockedDown).toBe(0);
    // Lamps show the junction's signals: exactly one phase green or amber at a time.
    const states = lights.map((b) => w.signalOf(b));
    expect(states.every((s) => s === 'green' || s === 'amber' || s === 'red')).toBe(true);
    w.dispose();
  });

  it('is deterministic: the same level drives the same poses', async () => {
    const poses = async (): Promise<number[]> => {
      const w = await world([UP_CAR, { kind: 'truck', s: 300, d: -2, yaw: Math.PI }]);
      run(w, 20);
      const out = w.bodies
        .filter((b) => b.kind === 'car' || b.kind === 'truck')
        .flatMap((b) => [b.pos.x, b.pos.z]);
      w.dispose();
      return out;
    };
    expect(await poses()).toEqual(await poses());
  });

  it('brakes for the iceberg in its lane', async () => {
    const w = await world([UP_CAR]);
    const car = w.bodies[w.traffic!.body[0]];
    // The iceberg sits on the lane 40 m ahead.
    w.setIceberg(-2, car.pos.z + 40, 2.2);
    run(w, 12);
    expect(w.traffic!.v[0]).toBeLessThan(0.1);
    const gap = car.pos.z + 40 - car.pos.z;
    expect(gap).toBeGreaterThan(0);
    expect(car.driven).toBe(true);
    expect(car.pos.z).toBeLessThan(car.spawn.z + 40 - 2.2 - 2.1);
    w.dispose();
  });

  it('drives a mountain road steeper than a broken deck’s drop: carved ground cannot break', async () => {
    // 1.5 m of fall in every 3 m (Alpine Pass's roads reach 1.7 m): the lane scan's broken-deck rule
    // (1.2 m) once stopped every car on such a road for good.
    const steep = createAnalyticTerrain({
      height: (_x, z) => 220 - 0.5 * z,
      halfWidth: 70,
      width: 200,
      length: 420,
      cellSize: 2,
      level: { obstacles: [UP_CAR], features: [MAIN], theme: 'alpine' },
    });
    const w = await createPhysicsWorld(steep, { seed: 11 });
    const t = w.traffic!;
    const car = w.bodies[t.body[0]];
    const z0 = car.pos.z;
    run(w, 10);
    expect(t.blocked[0]).toBe(Infinity);
    expect(car.driven).toBe(true);
    expect(car.pos.z - z0).toBeGreaterThan(60);
    expect(car.pos.y).toBeCloseTo(steep.heightAt(car.pos.x, car.pos.z), 0);
    w.dispose();
  });

  it('drives past a standing traffic light beside its lane, but stops for one knocked into it', async () => {
    // The pole 0.9 m from the lane's centre (a turn may pass that close to an auto-placed light).
    const w = await world([UP_CAR, { kind: 'trafficLight', s: 170, d: 3.3, yaw: Math.PI }]);
    const t = w.traffic!;
    const car = w.bodies[t.body[0]];
    const light = w.bodies.find((b) => b.kind === 'trafficLight' && b.placement === 1)!;
    expect(light.anchored).toBe(true);
    expect(light.signal).not.toBeNull();
    // (From rest at s 120: by 12 s it is past the pole, at or before the crossroads' stop line.)
    run(w, 12);
    expect(car.pos.z).toBeGreaterThan(light.pos.z + 5);
    w.dispose();
    // Knocked over (loose), the same light blocks the lane like any debris.
    const w2 = await world([UP_CAR, { kind: 'trafficLight', s: 170, d: 3.3, yaw: Math.PI }]);
    const light2 = w2.bodies.find((b) => b.kind === 'trafficLight' && b.placement === 1)!;
    light2.anchored = false;
    run(w2, 12);
    expect(w2.traffic!.v[0]).toBeLessThan(0.1);
    expect(w2.bodies[w2.traffic!.body[0]].pos.z).toBeLessThan(light2.pos.z);
    w2.dispose();
  });

  it('hands a vehicle the iceberg hits to the physics, its velocity in the momentum exchange', async () => {
    const w = await world([{ kind: 'car', s: 200, d: -40, yaw: -Math.PI / 2 }]);
    const t = w.traffic!;
    run(w, 3);
    const car = w.bodies[t.body[0]];
    const vCar = { x: car.proxy.vx, z: car.proxy.vz };
    expect(Math.hypot(vCar.x, vCar.z)).toBeGreaterThan(3);
    // A 30 t iceberg sliding down the course at 10 m/s meets the car crossing in front of it.
    const ice = createIceberg(w.terrain, DEFAULT_ICEBERG_PARAMS);
    ice.pos.x = car.proxy.x;
    ice.pos.z = car.proxy.z - ice.radius - 0.6;
    ice.pos.y = w.terrain.heightAt(ice.pos.x, ice.pos.z);
    ice.vel.x = 0;
    ice.vel.z = 10;
    const near = w.proxiesNear(ice.pos.x, ice.pos.z, ice.radius + 8);
    const contacts = resolveIcebergContacts(ice, near, DEFAULT_ICEBERG_PARAMS, { terrain: w.terrain });
    const c = contacts.find((k) => k.obstacleId === car.id)!;
    expect(c).toBeDefined();
    // The closing speed is relative to the moving car.
    const vn = (0 - vCar.x) * c.normal.x + (10 - vCar.z) * c.normal.z;
    expect(c.relSpeed).toBeCloseTo(vn, 6);
    const M = 30;
    const m = car.mass;
    const J = (1 + CONTACT_RESTITUTION) * vn * ((M * m) / (M + m));
    expect(Math.hypot(c.impulse.x, c.impulse.z)).toBeCloseTo(J, 3);
    w.applyContact(c);
    expect(car.driven).toBe(false);
    expect(t.driving).toBe(0);
    expect(w.isDynamic(car.id)).toBe(true);
    // Its Rapier body moves at the driving velocity plus exactly what the hit gave it.
    const v = w.rigidBodyVelocity(car.id)!;
    expect(v.x).toBeCloseTo(vCar.x + c.impulse.x / m, 4);
    expect(v.z).toBeCloseTo(vCar.z + c.impulse.z / m, 4);
    // ...and carries on as ordinary debris.
    run(w, 1);
    expect(car.pos.z).toBeGreaterThan(car.spawn.z + 1);
    w.dispose();
  });

  it('releases a vehicle the river floods, and one that debris hits', async () => {
    const w = await world([UP_CAR, { kind: 'car', s: 290, d: -2, yaw: Math.PI }]);
    const t = w.traffic!;
    const [a, b] = [w.bodies[t.body[0]], w.bodies[t.body[1]]];
    // A river that covers the first car's spot only.
    const wet = { x: a.proxy.x, z: a.proxy.z };
    const river: RiverTrailApi = {
      samples: [],
      version: 0,
      length: 0,
      record: () => {},
      flowAt: (x, z): FlowQuery | null =>
        Math.hypot(x - wet.x, z - wet.z) < 3
          ? { vx: 0, vz: 2, surfaceY: w.terrain.heightAt(x, z) + 0.5, strength: 1 }
          : null,
      disturb: () => {},
      reset: () => {},
    };
    w.applyWaterForces(river, FIXED_DT);
    expect(a.driven).toBe(false);
    expect(b.driven).toBe(true);
    // A rock flung at the second car.
    const [rock] = w.spawn('rockMedium', b.pos.x - 6, b.pos.z, { y: b.pos.y + 0.6 });
    w.applyContact({
      obstacleId: rock.id,
      impulse: { x: 12 * rock.mass, y: 0, z: 0 },
      point: { ...rock.pos },
      normal: { x: 1, y: 0, z: 0 },
      relSpeed: 12,
      speedLoss: 0,
      shock: 0,
    });
    for (let k = 0; k < 120 && b.driven; k++) w.step(FIXED_DT);
    expect(b.driven).toBe(false);
    w.dispose();
  });

  it('turns lamps dark when the light is knocked over', async () => {
    const w = await world([]);
    const light = w.bodies.find((b) => b.kind === 'trafficLight')!;
    expect(w.signalOf(light)).not.toBeNull();
    w.applyContact({
      obstacleId: light.id,
      impulse: { x: 20, y: 0, z: 0 },
      point: { x: light.pos.x, y: light.pos.y + 1, z: light.pos.z },
      normal: { x: 1, y: 0, z: 0 },
      relSpeed: 10,
      speedLoss: 0,
      testImpulse: 1000,
      shock: 0,
    });
    expect(light.anchored).toBe(false);
    expect(w.signalOf(light)).toBeNull();
    w.dispose();
  });

  it('a session plays traffic during the intro and stays deterministic with skipIntro', async () => {
    const t = level([UP_CAR]);
    const s = await GameSession.create({ level: t.level, terrain: t, intro: 'short' });
    const w = s.physics as PhysicsWorld;
    const car = w.bodies[w.traffic!.body[0]];
    const z0 = car.pos.z;
    for (let k = 0; k < 60 && s.phase === 'intro'; k++) s.update(FIXED_DT, { steer: 0, source: 'none' });
    expect(car.pos.z).toBeGreaterThan(z0);
    expect(w.time).toBe(0); // the rigid bodies wait for play
    s.dispose();
  });
});
