import { InstancedMesh, Matrix4, MeshStandardMaterial, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createAnalyticTerrain } from '../core/testing/analyticTerrain';
import { createPhysicsWorld } from '../core/physics/world';
import type { ObstaclePlacement, TerrainFeature } from '../core/types';
import { ObstacleBatches, prewarmMesh, spinMatrix } from './Obstacles';
import { obstacleTreeTint } from './worldCondition';
import { worldCondition } from '../story/environment';

function terrainWith(obstacles: ObstaclePlacement[], features: TerrainFeature[] = []) {
  return createAnalyticTerrain({
    height: () => 10,
    cellSize: 2,
    width: 200,
    length: 400,
    halfWidth: 80,
    level: { obstacles, features, theme: 'town' },
  });
}

describe('turning rotors', () => {
  it('spinMatrix turns a part about its pivot', () => {
    const spin = { axis: { x: 0, y: 0, z: 1 }, pivot: { x: 0, y: 40, z: 2 }, rate: -1.6 };
    const m = spinMatrix(spin, Math.PI / 2 / 1.6, new Matrix4());
    // A blade tip 16 m above the hub swings to the side (clockwise seen from +z: toward +x).
    const tip = new Vector3(0, 56, 2).applyMatrix4(m);
    expect(tip.x).toBeCloseTo(16, 6);
    expect(tip.y).toBeCloseTo(40, 6);
    expect(tip.z).toBeCloseTo(2, 6);
  });

  it('turn while the turbine stands and stop where they are once it falls', async () => {
    const w = await createPhysicsWorld(terrainWith([{ kind: 'windTurbine', s: 150, d: 0 }]), { seed: 5 });
    const head = w.bodies.find((b) => b.kind === 'windTurbine' && b.part === 'deck')!;
    const tower = w.bodies.find((b) => b.kind === 'windTurbine' && b.part === 'windTurbine')!;
    expect(head.spinning).toBe(true);
    expect(tower.spinning).toBe(false);
    const batches = new ObstacleBatches(w);
    for (let k = 0; k <= 60; k++) batches.update(k / 60);
    expect(batches.spinTimeOf(head)).toBeCloseTo(1, 6);
    // Knock the tower over: the head is thrown off and its rotor stops.
    w.applyContact({
      obstacleId: tower.id,
      impulse: { x: 0, y: 0, z: 600 },
      point: { x: tower.pos.x, y: tower.pos.y + 1, z: tower.pos.z - 2 },
      normal: { x: 0, y: 0, z: 1 },
      relSpeed: 20,
      speedLoss: 0,
      testImpulse: 5000,
      shock: 0,
    });
    for (let k = 0; k < 30; k++) w.step(1 / 60);
    expect(head.spinning).toBe(false);
    const frozen = batches.spinTimeOf(head);
    for (let k = 61; k <= 180; k++) batches.update(k / 60);
    expect(batches.spinTimeOf(head)).toBeCloseTo(frozen, 6);
    batches.dispose();
    w.dispose();
  });
});

describe('traffic-light lamps', () => {
  it('glow with the signal and go dark when the light is knocked over', async () => {
    const roads: TerrainFeature[] = [
      { type: 'road', s0: 30, s1: 380, d: 0, width: 8 },
      { type: 'street', points: [{ s: 200, d: -60 }, { s: 200, d: 60 }], width: 8 },
    ];
    const w = await createPhysicsWorld(terrainWith([], roads), { seed: 5 });
    const lights = w.bodies.filter((b) => b.kind === 'trafficLight');
    expect(lights).toHaveLength(4);
    const batches = new ObstacleBatches(w);
    batches.update(0);
    // Two heads per light, one lamp of each lit (green, amber or red): 8 lit lamps.
    expect(batches.litLamps).toBe(8);
    w.applyContact({
      obstacleId: lights[0].id,
      impulse: { x: 20, y: 0, z: 0 },
      point: { x: lights[0].pos.x, y: lights[0].pos.y + 1, z: lights[0].pos.z },
      normal: { x: 1, y: 0, z: 0 },
      relSpeed: 10,
      speedLoss: 0,
      testImpulse: 1000,
      shock: 0,
    });
    batches.update(1 / 60);
    expect(batches.litLamps).toBe(6);
    batches.dispose();
    w.dispose();
  });
});

describe('bodies coming and going', () => {
  /** Drawn instances per batch, in slot order: [matrix elements, colour], hidden slots left out. */
  const drawn = (b: ObstacleBatches): Map<string, number[][]> =>
    new Map(
      b.group.children
        .filter((m): m is InstancedMesh => m instanceof InstancedMesh && m.visible && m.count > 0)
        .map((m) => {
          const out: number[][] = [];
          for (let i = 0; i < m.count; i++) {
            const e = Array.from(m.instanceMatrix.array.slice(i * 16, i * 16 + 16));
            if (e.every((v, k) => v === 0 || k === 15)) continue; // a removed body's hidden slot
            const colour = Array.from(m.instanceColor!.array.slice(i * 3, i * 3 + 3));
            out.push([...e.map((v) => +v.toFixed(5)), ...colour]);
          }
          return [m.name, out] as const;
        })
        .filter(([, list]) => list.length > 0),
    );

  it('a break touches only its own slots and draws what a full layout draws', async () => {
    // A row of a well pad's light tanks (chapter 7), so every batch has room for one tank's debris.
    const placements: ObstaclePlacement[] = [
      ...[-15, -9, -3, 3, 9, 15].map((d) => ({ kind: 'tank' as const, s: 150, d, scale: 0.32 })),
      { kind: 'house', s: 220, d: 40 },
      { kind: 'pine', s: 120, d: -30 },
    ];
    const w = await createPhysicsWorld(terrainWith(placements), { seed: 5 });
    const layouts = vi.spyOn(ObstacleBatches.prototype as unknown as { layout(): void }, 'layout');
    const live = new ObstacleBatches(w);
    live.update(0);
    const slots = (b: ObstacleBatches) =>
      b.group.children.reduce((n, m) => n + (m instanceof InstancedMesh ? m.count : 0), 0);
    const before = slots(live);
    const tank = w.bodies.find((b) => b.kind === 'tank')!;
    const p = tank.proxy;
    const J = 2 * 20 * ((100 * tank.mass) / (100 + tank.mass));
    w.applyContact({
      obstacleId: tank.id,
      impulse: { x: 0, y: 0.2 * J, z: J },
      point: { x: p.x, y: p.bottom + 1, z: p.z - p.radius },
      normal: { x: 0, y: 0, z: 1 },
      relSpeed: 20,
      speedLoss: 0,
      testImpulse: 2 * 20 * 100,
      shock: J / 100,
    });
    expect(tank.active).toBe(false);
    for (let k = 1; k <= 30; k++) {
      w.step(1 / 60);
      live.update(k / 60);
    }
    // No full layout: the tank's slots were hidden and its pieces appended after the last slot.
    expect(layouts).not.toHaveBeenCalled();
    expect(slots(live)).toBe(before + tank.parts.length);
    layouts.mockRestore();
    // A fresh renderer lays every body out from scratch: the same instances, in the same order.
    const fresh = new ObstacleBatches(w);
    fresh.update(30 / 60);
    expect(drawn(live)).toEqual(drawn(fresh));
    // The full layout (a batch out of room) compacts the hidden slots away and draws the same.
    (live as unknown as { layout(): void }).layout();
    live.update(30 / 60);
    expect(slots(live)).toBe(before);
    expect(drawn(live)).toEqual(drawn(fresh));
    live.dispose();
    fresh.dispose();
    w.dispose();
  });

  it('ice chips: new shapes get their own batch, a full batch falls back to layout', async () => {
    // A town with no glacier ice: the iceberg's first chips are geometries new to the level.
    const placements: ObstaclePlacement[] = [
      { kind: 'house', s: 220, d: 40 },
      { kind: 'pine', s: 120, d: -30 },
    ];
    const w = await createPhysicsWorld(terrainWith(placements), { seed: 5 });
    const layouts = vi.spyOn(ObstacleBatches.prototype as unknown as { layout(): void }, 'layout');
    const live = new ObstacleBatches(w);
    live.update(0);
    const iceBatches = () =>
      live.group.children.filter(
        (m) => m instanceof InstancedMesh && /^obstacles-ice\d+$/.test(m.name),
      ).length;
    expect(iceBatches()).toBe(0);
    let frame = 0;
    for (let i = 0; i < 24; i++) {
      // Six chips a hit; past ICE.maxChunks live the oldest go, leaving hidden slots behind.
      w.spawnIceChunks({ x: (i % 5) * 6 - 12, y: 7, z: 80 + i * 6 }, { x: 0, y: 0, z: 8 }, 4);
      for (let k = 0; k < 5; k++) {
        w.step(1 / 60);
        live.update(++frame / 60);
      }
      if (i === 0) {
        // The first hit: batches of their own for its shapes, no full layout.
        expect(iceBatches()).toBeGreaterThan(0);
        expect(layouts).not.toHaveBeenCalled();
      }
      const fresh = new ObstacleBatches(w);
      fresh.update(frame / 60);
      expect(drawn(live)).toEqual(drawn(fresh));
      fresh.dispose();
    }
    // The hidden slots filled a batch: the full layout ran and compacted them (checked above).
    expect(layouts).toHaveBeenCalled();
    layouts.mockRestore();
    live.dispose();
    w.dispose();
  });
});

describe('obstacle material prewarm', () => {
  it('is an empty, never-culled, shadow-casting ice batch with instance colours', () => {
    // Like a real ice batch, so the warm-up compiles the same program variants (colour + depth).
    const ice = new MeshStandardMaterial({ vertexColors: true, flatShading: true, transparent: true });
    const mesh = prewarmMesh(ice);
    expect(mesh.material).toBe(ice);
    expect(mesh.count).toBe(0); // draws nothing
    expect(mesh.instanceColor).not.toBeNull(); // the instancingColor variant
    expect(mesh.geometry.getAttribute('color').itemSize).toBe(3); // vertex colours, no alpha
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(false);
    expect(mesh.frustumCulled).toBe(false);
    expect(mesh.visible).toBe(true);
    mesh.geometry.dispose();
    mesh.dispose();
  });
});

describe("Story Mode's world condition on obstacle trees", () => {
  /** Instance colours per batch (by geometry), in slot order. */
  const colours = (b: ObstacleBatches): Map<string, number[]> =>
    new Map(
      b.group.children
        .filter((m): m is InstancedMesh => m instanceof InstancedMesh && m.count > 0)
        .map((m) => [m.name, Array.from(m.instanceColor!.array.slice(0, m.count * 3))]),
    );

  it('recolours tree crowns only, and never the bodies or the simulation', async () => {
    const placements: ObstaclePlacement[] = Array.from({ length: 40 }, (_, i) => ({
      kind: i % 2 ? 'pine' : 'broadleaf',
      s: 40 + i * 8,
      d: (i % 5) * 12 - 24,
    }));
    placements.push({ kind: 'house', s: 200, d: 60 }, { kind: 'rockMedium', s: 120, d: -60 });
    const terrain = terrainWith(placements);
    const arcade = await createPhysicsWorld(terrain, { seed: 5 });
    const story = await createPhysicsWorld(terrain, { seed: 5 });
    const partColours = story.bodies.map((b) => b.parts.map((p) => p.color));
    const plain = new ObstacleBatches(arcade);
    const worn = new ObstacleBatches(story, obstacleTreeTint(worldCondition('ch8-remains')));
    plain.update(0);
    worn.update(0);
    const a = colours(plain);
    const b = colours(worn);
    expect([...b.keys()]).toEqual([...a.keys()]);
    let changed = 0;
    for (const [name, list] of a) {
      const crown = name === 'obstacles-cone' || name.startsWith('obstacles-blob');
      if (!crown) expect(b.get(name), name).toEqual(list); // trunks, the house, the rock
      else changed += list.filter((v, i) => v !== b.get(name)![i]).length;
    }
    expect(changed).toBeGreaterThan(0);
    // The bodies keep their own colours, and both worlds step identically.
    expect(story.bodies.map((x) => x.parts.map((p) => p.color))).toEqual(partColours);
    for (let k = 0; k < 120; k++) {
      arcade.step(1 / 60);
      story.step(1 / 60);
      plain.update(k / 60);
      worn.update(k / 60);
    }
    expect(story.bodies.map((x) => [x.pos.x, x.pos.y, x.pos.z, x.state])).toEqual(
      arcade.bodies.map((x) => [x.pos.x, x.pos.y, x.pos.z, x.state]),
    );
    plain.dispose();
    worn.dispose();
    arcade.dispose();
    story.dispose();
  });
});
