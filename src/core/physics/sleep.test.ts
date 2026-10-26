import { describe, expect, it } from 'vitest';
import { createAnalyticTerrain } from '../testing/analyticTerrain';
import type { BodySpec } from '../obstacles/specs';
import { KIT_BOX } from '../obstacles/shapes';
import { createPhysicsWorld } from './world';

/** A loose 2 m cube of `mass` t whose centre is at (x, y, z). */
function box(x: number, y: number, z: number, mass: number): BodySpec {
  return {
    kind: 'boulder',
    part: 'stone',
    material: 'stone',
    proxyMode: 'extent',
    position: { x, y, z },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    anchored: false,
    mass,
    breakImpulse: Infinity,
    breakMode: 'none',
    hitHeight: 0,
    trunkRadius: 0,
    ccd: false,
    settle: true,
    placement: -1,
    parts: [
      {
        geom: KIT_BOX,
        name: 'stone',
        offset: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 2, y: 2, z: 2 },
        color: 0x888888,
        mass,
      },
    ],
  };
}

describe('resting supports', () => {
  it('a box under a still-moving box is never put to sleep and pushed through the ground', async () => {
    const ground = 20;
    const terrain = createAnalyticTerrain({ height: () => ground });
    const world = await createPhysicsWorld(terrain, { seed: 7 });
    const bottom = world.addBody(box(0, ground + 1, 100, 10));
    const top = world.addBody(box(0, ground + 3, 100, 10));
    for (let k = 0; k < 30; k++) world.step(1 / 60);
    // Shove only the top box: it slides across the bottom one while the bottom one rests.
    world.applyContact({
      obstacleId: top.id,
      impulse: { x: 0, y: 0, z: 9 },
      point: { x: top.proxy.x, y: top.proxy.y, z: top.proxy.z },
      normal: { x: 0, y: 0, z: 1 },
      relSpeed: 1,
      speedLoss: 0,
      shock: 0,
    });
    for (let k = 0; k < 240; k++) world.step(1 / 60);
    for (const b of [bottom, top]) {
      expect(b.active).toBe(true);
      expect(b.proxy.bottom).toBeGreaterThan(terrain.heightAt(b.proxy.x, b.proxy.z) - 0.3);
      // Rapier's own position too: ObstacleBody.pos/proxy stop updating while a body sleeps.
      const p = world.rigidBodyPosition(b.id);
      expect(p && p.y - 1).toBeGreaterThan(ground - 0.3);
    }
    world.dispose();
  });
});
