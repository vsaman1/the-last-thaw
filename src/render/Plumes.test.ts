import { describe, expect, it } from 'vitest';
import { createAnalyticTerrain } from '../core/testing/analyticTerrain';
import { createPhysicsWorld, type PhysicsWorld } from '../core/physics/world';
import type { ObstaclePlacement } from '../core/types';
import { emitPlumes, PLUME_QUALITY, PlumeEmitters, PlumePool } from './Plumes';
import { WIND } from './Sky';

/** Smoke and steam emitters: found on the marked parts, alive while their body stands. */

async function world(obstacles: ObstaclePlacement[]): Promise<PhysicsWorld> {
  const t = createAnalyticTerrain({
    height: () => 10,
    cellSize: 2,
    width: 200,
    length: 400,
    halfWidth: 80,
    level: { obstacles },
  });
  return createPhysicsWorld(t, { seed: 3 });
}

const scratch = { x: 0, y: 0, z: 0 };

describe('plumes', () => {
  it('finds a smokestack mouth, a cooling-tower throat and house/chalet chimneys', async () => {
    const w = await world([
      { kind: 'smokestack', s: 80, d: -30 },
      { kind: 'coolingTower', s: 160, d: 20 },
      { kind: 'house', s: 240, d: 0 },
      { kind: 'chalet', s: 300, d: 0 },
      { kind: 'factoryHall', s: 350, d: 30 },
    ]);
    const e = new PlumeEmitters(w);
    e.refresh();
    const kinds = e.list.map((p) => p.kind).sort();
    expect(kinds).toEqual(['smoke', 'steam', 'thin', 'thin', 'thin']);
    for (const p of e.list) expect(e.standing(p)).toBe(true);
    // The smokestack's smoke comes out of its 41.5 m top, the tower's steam out of its 42 m rim.
    const smoke = e.list.find((p) => p.kind === 'smoke')!;
    expect(e.mouth(smoke, scratch).y - 10).toBeGreaterThan(40);
    expect(e.mouth(smoke, scratch).y - 10).toBeLessThan(43);
    const steam = e.list.find((p) => p.kind === 'steam')!;
    expect(e.mouth(steam, scratch).y - 10).toBeCloseTo(41.4, 0);
    expect(steam.radius).toBeGreaterThan(6);
    w.dispose();
  });

  it('stops for good when the body is broken or toppled', async () => {
    const w = await world([
      { kind: 'house', s: 100, d: 0 },
      { kind: 'smokestack', s: 200, d: 0 },
    ]);
    const e = new PlumeEmitters(w);
    e.refresh();
    const house = w.bodies.find((b) => b.kind === 'house')!;
    const shaft = w.bodies.find((b) => b.kind === 'smokestack' && b.part === 'smokestack')!;
    const hit = (id: number, x: number, y: number, z: number): void => {
      w.applyContact({
        obstacleId: id,
        impulse: { x: 0, y: 0, z: 300 },
        point: { x, y, z },
        normal: { x: 0, y: 0, z: 1 },
        relSpeed: 20,
        speedLoss: 0,
        testImpulse: 5000,
        shock: 0,
      });
    };
    hit(house.id, house.pos.x, house.pos.y + 1, house.pos.z - 3);
    hit(shaft.id, shaft.pos.x, shaft.pos.y + 1, shaft.pos.z - 2);
    for (let k = 0; k < 90; k++) w.step(1 / 60);
    e.refresh();
    // The house shattered (its chimney is debris now): no emitter. The chimney top fell off.
    expect(e.list.some((p) => p.body.kind === 'house')).toBe(false);
    const smoke = e.list.find((p) => p.kind === 'smoke');
    if (smoke) expect(e.standing(smoke)).toBe(false);
    const pool = new PlumePool(200, 1);
    expect(emitPlumes(e, pool, 'high', 5, 0, 0, scratch)).toBe(0);
    w.dispose();
  });

  it('emits by quality (no thin wisps on low), rises, drifts downwind and fades', async () => {
    const w = await world([
      { kind: 'smokestack', s: 80, d: 0 },
      { kind: 'house', s: 200, d: 0 },
    ]);
    const e = new PlumeEmitters(w);
    e.refresh();
    const count = (q: 'high' | 'medium' | 'low'): number => {
      const pool = new PlumePool(PLUME_QUALITY[q].capacity, 1);
      for (const p of e.list) p.budget = 0;
      let n = 0;
      for (let k = 0; k < 600; k++) n += emitPlumes(e, pool, q, 1 / 60, 0, 100, scratch);
      return n;
    };
    const high = count('high');
    const low = count('low');
    expect(high).toBeGreaterThan(40);
    expect(low).toBeLessThan(high * 0.4);
    // Far from the camera nothing is emitted.
    const pool = new PlumePool(400, 2);
    expect(emitPlumes(e, pool, 'high', 2, 5000, 5000, scratch)).toBe(0);
    // A puff rises and drifts with the wind.
    pool.emit('smoke', 0, 50, 0, 0.01);
    pool.update(1 / 60);
    const y0 = pool.positions[1];
    for (let k = 0; k < 6 * 60; k++) pool.update(1 / 60);
    expect(pool.positions[1]).toBeGreaterThan(y0 + 8);
    const drift = pool.positions[0] * WIND.x + pool.positions[2] * WIND.z;
    expect(drift).toBeGreaterThan(6);
    for (let k = 0; k < 10 * 60; k++) pool.update(1 / 60);
    expect(pool.alive).toBe(0);
    w.dispose();
  });
});
