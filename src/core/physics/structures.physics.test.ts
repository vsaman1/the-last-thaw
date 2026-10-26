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
import { CONTACT_RESTITUTION, contactImpulseFor, ICE } from '../obstacles/catalog';
import { buildStructureSpecs, type StructureDef } from '../obstacles/structures/kit';
import { createPhysicsWorld, initRapier, type ObstacleBody, type PhysicsWorld } from './world';
import { PHYSICS_TUNING as T } from './tuning';

const DT = 1 / 60;
const E = CONTACT_RESTITUTION;

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

/**
 * The contact the iceberg solver produces for a head-on hit at closing speed vn by an iceberg of
 * mass M: the obstacle receives the loose-body impulse (1+e)·vn·Mm/(M+m); anchored obstacles are
 * tested with the iceberg's momentum (1+e)·vn·M.
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

/** Fake river: uniform flow (0, 0, 6) m/s in the strip |x| < 6, surface 0.5 m above the ground. */
function fakeRiver(terrain: Terrain): RiverTrailApi {
  const samples: RiverSample[] = [];
  return {
    samples,
    version: 0,
    length: 0,
    record: (_i: IcebergState, _t: Terrain, _time: number) => {},
    flowAt: (x: number, z: number): FlowQuery | null =>
      Math.abs(x) < 6 ? { vx: 0, vz: 6, surfaceY: terrain.heightAt(x, z) + 0.5, strength: 1 } : null,
    disturb: () => {},
    reset: () => {},
  };
}

const ofKind = (w: PhysicsWorld, kind: ObstacleKind, part?: string): ObstacleBody[] =>
  w.bodies.filter((b) => b.active && b.kind === kind && (part === undefined || b.part === part));

describe('momentum break rule (testImpulse ?? |impulse|)', () => {
  it('a house breaks at 15 m/s for a 30 t iceberg but at ~4.5 m/s for a 100 t one', async () => {
    const t = terrainWith([
      { kind: 'house', s: 40, d: 0 },
      { kind: 'house', s: 90, d: 0 },
      { kind: 'house', s: 140, d: 0 },
      { kind: 'house', s: 190, d: 0 },
    ]);
    const w = await createPhysicsWorld(t, { seed: 6 });
    const [a, b, c, d] = ofKind(w, 'house');
    expect(w.applyContact(hit(a, 14.6, 30)).result).toBe('shook');
    expect(w.applyContact(hit(b, 15.3, 30)).result).toBe('broken');
    expect(w.applyContact(hit(c, 4.35, 100)).result).toBe('shook');
    expect(w.applyContact(hit(d, 4.65, 100)).result).toBe('broken');
    expect(a.active && c.active).toBe(true);
    expect(w.stats.buildingsDestroyed).toBe(2);
    // The shake strength follows the momentum test, not the (much smaller) loose-body impulse.
    expect(a.shake.amp).toBeGreaterThan(0.9);
    w.dispose();
  });

  it('without testImpulse the break decision falls back to |impulse|', async () => {
    const t = terrainWith([{ kind: 'pine', s: 40, d: 0 }]);
    const w = await createPhysicsWorld(t, { seed: 6 });
    const [pine] = ofKind(w, 'pine');
    const c = hit(pine, 8);
    const weak = { ...c, testImpulse: undefined, impulse: { x: 0, y: 0, z: pine.breakImpulse * 0.9 } };
    expect(w.applyContact(weak).result).toBe('shook');
    const strong = { ...c, testImpulse: undefined, impulse: { x: 0, y: 0, z: pine.breakImpulse * 1.05 } };
    expect(w.applyContact(strong).result).toBe('uprooted');
    w.dispose();
  });

  it('smashing through hands the debris the loose-body impulse, so heavy icebergs bulldoze slowly', async () => {
    const t = terrainWith([{ kind: 'house', s: 60, d: 0 }]);
    const w = await createPhysicsWorld(t, { seed: 8 });
    const [house] = ofKind(w, 'house');
    const c = hit(house, 5, 100);
    expect(Math.hypot(c.impulse.x, c.impulse.z)).toBeCloseTo(contactImpulseFor(house.mass, 5) * (100 / 30) * (42 / 112), 1);
    expect(w.applyContact(c).result).toBe('broken');
    run(w, 1.5);
    const pieces = w.bodies.filter((b) => b.originId === house.id && b.id !== house.id);
    const fastest = Math.max(...pieces.map((p) => Math.hypot(p.proxy.vx, p.proxy.vz)));
    // Nothing is flung much faster than the iceberg pushed it.
    expect(fastest).toBeLessThan(8);
    w.dispose();
  });
});

describe('structures in the physics world', () => {
  it('fence: a light segment shatters into its rails and post, neighbours stay standing', async () => {
    const t = terrainWith([{ kind: 'fence', s: 60, d: 0, span: 12 }]);
    const w = await createPhysicsWorld(t, { seed: 3 });
    const segs = ofKind(w, 'fence');
    expect(segs.length).toBe(5);
    const mid = segs.reduce((a, b) => (Math.abs(b.pos.x) < Math.abs(a.pos.x) ? b : a));
    expect(w.applyContact(hit(mid, 2, 30)).result).toBe('shook');
    expect(w.applyContact(hit(mid, 4, 30)).result).toBe('broken');
    const events: GameEvent[] = [];
    run(w, 2, undefined, events);
    const pieces = w.bodies.filter((b) => b.originId === mid.id && b.id !== mid.id);
    expect(pieces.length).toBeGreaterThanOrEqual(3);
    expect(pieces.every((p) => !p.anchored && w.isDynamic(p.id))).toBe(true);
    expect(pieces.reduce((a, p) => a + p.mass, 0)).toBeCloseTo(mid.mass, 6);
    expect(segs.filter((s) => s !== mid).every((s) => s.active && s.anchored)).toBe(true);
    // A fence is not a building.
    expect(w.stats.buildingsDestroyed).toBe(0);
    expect(w.stats.knockedDown).toBe(1);
    expect(events.some((e) => e.type === 'obstacleBroken' && e.kind === 'fence')).toBe(true);
    w.dispose();
  });

  it('footbridge: stands, lets the iceberg slide under the deck, and the deck falls when its posts break', async () => {
    const t = terrainWith([{ kind: 'footbridge', s: 60, d: 0, span: 40 }]);
    const w = await createPhysicsWorld(t, { seed: 4 });
    const decks = ofKind(w, 'footbridge', 'deck');
    const posts = ofKind(w, 'footbridge', 'post');
    expect(decks.length).toBe(5);
    expect(posts.length).toBe(6);
    const deckY0 = decks.map((d) => d.pos.y);
    run(w, 3);
    decks.forEach((d, i) => expect(Math.abs(d.pos.y - deckY0[i])).toBeLessThan(0.05));
    expect(w.stats.knockedDown).toBe(0);

    // The iceberg's contact band (ground .. ground + 2.8 m) only meets the posts.
    const near = w.proxiesNear(0, 60, 25);
    for (const p of near) {
      if (p.part === 'deck') expect(p.bottom).toBeGreaterThan(5 + 2.8 + 1);
      if (p.part === 'post') {
        expect(p.anchored).toBe(true);
        expect(p.bottom).toBeLessThan(5);
        expect(p.radius).toBeLessThan(0.8);
      }
    }

    // Knock out one of the two middle posts: the two deck segments resting on it come down.
    const post = posts.reduce((a, b) => (Math.abs(b.pos.x) < Math.abs(a.pos.x) ? b : a));
    expect(w.applyContact(hit(post, 3, 30)).result).toBe('shook');
    expect(w.applyContact(hit(post, 8, 30)).result).toBe('uprooted');
    const events: GameEvent[] = [];
    run(w, 4, undefined, events);
    const onPost = decks.filter((d) => Math.abs(Math.abs(d.pos.x - post.spawn.x) - 4) < 1.5);
    const others = decks.filter((d) => !onPost.includes(d));
    expect(onPost.length).toBe(2);
    for (const d of onPost) expect(d.pos.y).toBeLessThan(d.spawn.y - 2);
    for (const d of others) expect(Math.abs(d.pos.y - d.spawn.y)).toBeLessThan(0.3);
    expect(events.some((e) => e.type === 'obstacleBroken' && e.kind === 'footbridge')).toBe(true);
    expect(w.stats.knockedDown).toBeGreaterThanOrEqual(3);
    w.dispose();
  });

  it('car: a 12 m/s hit sends it flying and tumbling', async () => {
    const t = terrainWith([{ kind: 'car', s: 60, d: 0, yaw: Math.PI / 2 }]);
    const w = await createPhysicsWorld(t, { seed: 5 });
    const [car] = ofKind(w, 'car');
    expect(car.anchored).toBe(false);
    expect(car.sleeping).toBe(true);
    const start = { ...car.pos };
    expect(w.applyContact(hit(car, 12, 30)).result).toBe('pushed');
    let maxGap = 0;
    let maxTilt = 0;
    for (let i = 0; i < 180; i++) {
      w.step(DT);
      maxGap = Math.max(maxGap, w.lowestPointY(car.id) - 5);
      maxTilt = Math.max(maxTilt, w.tiltOf(car.id));
    }
    expect(car.pos.z - start.z).toBeGreaterThan(10);
    expect(maxGap).toBeGreaterThan(0.3);
    expect(maxTilt).toBeGreaterThan(0.6);
    expect(w.stats.knockedDown).toBe(1);
    w.dispose();
  });

  it('light debris stays bounded: no fence piece outruns a head-on bounce, whirls or tunnels', async () => {
    const t = terrainWith([{ kind: 'fence', s: 60, d: 0, span: 12 }]);
    const w = await createPhysicsWorld(t, { seed: 3 });
    for (const seg of ofKind(w, 'fence')) expect(w.applyContact(hit(seg, 16, 30)).result).toBe('broken');
    w.step(DT);
    const pieces = w.bodies.filter((b) => b.active && b.state === 'broken');
    expect(pieces.length).toBeGreaterThanOrEqual(15);
    for (const p of pieces) {
      expect(Math.hypot(p.proxy.vx, p.proxy.vy, p.proxy.vz)).toBeLessThan((1 + E) * 16 + 0.5);
      expect(Math.hypot(p.angVel.x, p.angVel.y, p.angVel.z)).toBeLessThan(T.maxDebrisSpin + 0.5);
    }
    for (let i = 0; i < 180; i++) {
      w.step(DT);
      for (const p of pieces) if (p.active) expect(w.lowestPointY(p.id)).toBeGreaterThan(4.6);
    }
    w.dispose();
  });

  it('a loose structure with a breakSpeed is pushed by soft hits and shatters into its pieces by hard ones', async () => {
    const t = terrainWith([]);
    const w = await createPhysicsWorld(t, { seed: 13 });
    // A synthetic two-piece crate (never registered): 'left' = box + lid, 'right' = box + decor label.
    const crate: StructureDef = {
      kind: 'logPile',
      label: 'Test crate',
      material: 'wood',
      footprint: 1.5,
      palettes: { wood: [0x9c7b56] },
      build: () => [
        {
          part: 'crate',
          stand: 'loose',
          mass: 1,
          breakSpeed: 6,
          parts: [
            { shape: 'box', at: [-0.5, 0.5, 0], size: [1, 1, 1], color: 'wood', piece: 'left' },
            { shape: 'box', at: [0.5, 0.5, 0], size: [1, 1, 1], color: 'wood', piece: 'right' },
            { shape: 'box', at: [0, 1.05, 0], size: [2, 0.1, 1], color: 'wood', piece: 'left' },
            { shape: 'box', at: [0.5, 0.5, 0.52], size: [0.3, 0.3, 0.02], color: 0x333333, decor: true },
          ],
        },
      ],
    };
    const [spec] = buildStructureSpecs(crate, 0, 60, t, () => 0.5);
    const body = w.addBody(spec);
    expect(body.breakImpulse).toBeCloseTo((1 + E) * 6 * (30 / 31), 6);
    expect(w.applyContact(hit(body, 4, 30)).result).toBe('pushed');
    run(w, 0.5);
    const events: GameEvent[] = [];
    expect(w.applyContact(hit(body, 9, 30)).result).toBe('broken');
    expect(body.active).toBe(false);
    run(w, 0.5, undefined, events);
    const pieces = w.bodies.filter((b) => b.originId === body.id && b.id !== body.id);
    expect(pieces.length).toBe(2);
    expect(pieces.map((p) => p.parts.length).sort()).toEqual([2, 2]);
    expect(pieces.reduce((a, p) => a + p.mass, 0)).toBeCloseTo(1, 6);
    // Kept moving the way it was going and was hit.
    for (const p of pieces) expect(p.pos.z).toBeGreaterThan(body.pos.z);
    expect(events.some((e) => e.type === 'obstacleBroken' && e.obstacleId === body.id)).toBe(true);
    expect(w.stats.buildingsDestroyed).toBe(0);
    w.dispose();
  });

  it('colliders match the render geometry: rays land on the car roof and the bridge deck', async () => {
    const t = terrainWith([
      { kind: 'car', s: 50, d: 0, yaw: 0 },
      { kind: 'footbridge', s: 100, d: 0, span: 24 },
    ]);
    const w = await createPhysicsWorld(t, { seed: 7 });
    const [car] = ofKind(w, 'car');
    const roof = w.raycastBodies(car.pos.x, car.pos.z);
    expect(roof?.id).toBe(car.id);
    expect(roof?.y).toBeCloseTo(car.proxy.top, 1);
    const deck = ofKind(w, 'footbridge', 'deck')[1];
    const hitDeck = w.raycastBodies(deck.pos.x, deck.pos.z);
    expect(hitDeck?.id).toBe(deck.id);
    expect(hitDeck?.y).toBeCloseTo(deck.pos.y + deck.localMax.y * 0 + 0.22, 1);
    w.dispose();
  });
});

describe('glacier ice: absorb', () => {
  it('absorb(id) removes the block and reports its mass and velocity; second call and rocks give null', async () => {
    const t = terrainWith([
      { kind: 'iceBlock', s: 40, d: 0 },
      { kind: 'iceBlock', s: 70, d: 0 },
      { kind: 'rockMedium', s: 100, d: 0 },
    ]);
    const w = await createPhysicsWorld(t, { seed: 9 });
    const [still, pushed] = ofKind(w, 'iceBlock');
    const [rock] = ofKind(w, 'rockMedium');
    expect(still.proxy.absorbable).toBe(true);
    expect(rock.proxy.absorbable).toBeFalsy();
    const structure = w.structureVersion;
    const got = w.absorb(still.id);
    expect(got).not.toBeNull();
    expect(got?.mass).toBeCloseTo(still.mass);
    expect(Math.hypot(got?.vel.x ?? 1, got?.vel.y ?? 1, got?.vel.z ?? 1)).toBeLessThan(1e-6);
    expect(still.active).toBe(false);
    expect(w.structureVersion).toBeGreaterThan(structure);
    expect(w.proxiesNear(0, 40, 6).some((p) => p.id === still.id)).toBe(false);
    expect(w.absorb(still.id)).toBeNull();
    expect(w.absorb(rock.id)).toBeNull();
    expect(w.absorb(9999)).toBeNull();
    // A moving block reports its velocity (momentum conservation is the iceberg's job).
    w.applyContact(hit(pushed, 6, 30));
    run(w, 0.25);
    const moving = w.absorb(pushed.id);
    expect(moving?.vel.z).toBeGreaterThan(1);
    // Ice is not an "obstacle knocked down".
    expect(w.stats.knockedDown).toBe(0);
    w.dispose();
  });
});

describe('ice chunks broken off the iceberg', () => {
  it('spawns 1-6 loose chunks carrying the mass, ghosted briefly, that melt away and are removed', async () => {
    const t = terrainWith([], inclinedPlane(0.05));
    const w = await createPhysicsWorld(t, { seed: 10 });
    const y = t.heightAt(0, 60);
    w.spawnIceChunks({ x: 0, y: y + 1.2, z: 60 }, { x: 0, y: 0, z: 10 }, 3);
    const chunks = w.bodies.filter((b) => b.active && b.part === 'chunk');
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.length).toBeLessThanOrEqual(6);
    expect(chunks.reduce((a, b) => a + b.mass, 0)).toBeCloseTo(3, 6);
    expect(chunks.every((c) => !c.anchored && !c.proxy.absorbable && c.material === 'ice')).toBe(true);
    expect(chunks.every((c) => c.pos.y > t.heightAt(c.pos.x, c.pos.z))).toBe(true);
    expect(w.iceChunkCount).toBe(chunks.length);
    // Not offered to the iceberg solver straight away (they spawn against it).
    expect(w.proxiesNear(0, 60, 8).some((p) => chunks.some((c) => c.id === p.id))).toBe(false);
    run(w, 1);
    // They fly on roughly with the iceberg, then scatter.
    const meanVz = chunks.reduce((a, c) => a + c.pos.z, 0) / chunks.length - 60;
    expect(meanVz).toBeGreaterThan(2);
    // Offered to the solver again once their grace is over.
    run(w, ICE.chunkGrace - 1 + 0.1);
    const all = w.proxiesNear(0, 70, 60).map((p) => p.id);
    expect(chunks.some((c) => all.includes(c.id))).toBe(true);

    let shrank = false;
    for (let i = 0; i < 25 * 60 && w.iceChunkCount > 0; i++) {
      w.step(DT);
      if (chunks.some((c) => c.active && c.renderScale < 0.9)) shrank = true;
    }
    expect(shrank).toBe(true);
    expect(w.iceChunkCount).toBe(0);
    expect(chunks.every((c) => !c.active)).toBe(true);
    expect(w.time).toBeLessThan(ICE.chunkLife[1] + 2.5);
    expect(w.time).toBeGreaterThan(ICE.chunkLife[0]);
    w.dispose();
  });

  it('tiny amounts spawn nothing; big ones are capped at 6 chunks; the live total stays bounded', async () => {
    const t = terrainWith([]);
    const w = await createPhysicsWorld(t, { seed: 11 });
    w.spawnIceChunks({ x: 0, y: 6, z: 60 }, { x: 0, y: 0, z: 8 }, 0.01);
    expect(w.iceChunkCount).toBe(0);
    w.spawnIceChunks({ x: 0, y: 6, z: 60 }, { x: 0, y: 0, z: 8 }, 12);
    expect(w.iceChunkCount).toBe(6);
    for (let i = 0; i < 20; i++) w.spawnIceChunks({ x: (i % 5) * 6 - 12, y: 7, z: 80 + i * 6 }, { x: 0, y: 0, z: 8 }, 4);
    expect(w.iceChunkCount).toBeLessThanOrEqual(ICE.maxChunks);
    expect(w.activeCount).toBeLessThanOrEqual(ICE.maxChunks);
    run(w, 1);
    for (const b of w.bodies) if (b.active) expect(b.pos.y).toBeGreaterThan(t.heightAt(b.pos.x, b.pos.z) - 0.5);
    w.dispose();
  });

  it('the river pushes chunks downstream; they float', async () => {
    const t = terrainWith([]);
    const w = await createPhysicsWorld(t, { seed: 12 });
    w.spawnIceChunks({ x: 0, y: 6.5, z: 60 }, { x: 0, y: 0, z: 0 }, 2);
    const chunks = w.bodies.filter((b) => b.active && b.part === 'chunk');
    const z0 = chunks.map((c) => c.pos.z);
    run(w, 4, fakeRiver(t));
    const inRiver = chunks.filter((c) => Math.abs(c.pos.x) < 5);
    expect(inRiver.length).toBeGreaterThan(0);
    for (const c of inRiver) {
      expect(c.pos.z - z0[chunks.indexOf(c)]).toBeGreaterThan(6);
      expect(c.inWater).toBe(true);
    }
    w.dispose();
  });
});

describe('performance with ~300 bodies (structures, ice, chunks)', () => {
  it('builds and steps a dense level within budget', async () => {
    const valley = (x: number, z: number): number =>
      200 - 0.15 * z + Math.max(0, Math.abs(x) - 30) * 0.9 + 1.2 * Math.sin(x * 0.11) * Math.cos(z * 0.07);
    const kinds: ObstaclePlacement[] = [];
    const add = (p: ObstaclePlacement): void => {
      kinds.push(p);
    };
    for (let i = 0; i < 16; i++) add({ kind: 'car', s: 40 + i * 50, d: ((i * 13) % 40) - 20 });
    for (let i = 0; i < 4; i++) add({ kind: 'fence', s: 70 + i * 200, d: 0, span: 50 });
    for (let i = 0; i < 2; i++) add({ kind: 'footbridge', s: 150 + i * 400, d: 0, span: 56 });
    for (let i = 0; i < 6; i++) add({ kind: 'iceField', s: 100 + i * 130, d: ((i * 17) % 30) - 15, count: 8 });
    // Glacier ice right on the stand-in iceberg's opening line, so absorbing is exercised under load.
    add({ kind: 'iceField', s: 48, d: 0, count: 6, spread: 6 });
    for (let i = 0; i < 20; i++) add({ kind: 'iceBlock', s: 60 + i * 40, d: ((i * 23) % 44) - 22 });
    for (let i = 0; i < 12; i++) add({ kind: 'house', s: 90 + i * 65, d: i % 2 ? 18 : -18 });
    const fill: ObstacleKind[] = ['rockSmall', 'pine', 'rockCluster', 'broadleaf', 'rockMedium', 'boulder'];
    for (let i = 0; i < 70; i++) add({ kind: fill[i % fill.length], s: 35 + i * 12.5, d: ((i * 29) % 50) - 25 });
    const t = createAnalyticTerrain({
      height: valley,
      width: 400,
      length: 950,
      cellSize: 2.5,
      halfWidth: 30,
      level: { obstacles: kinds, wallRamp: 30 },
    });
    const c0 = performance.now();
    const cpu0 = process.cpuUsage();
    const w = await createPhysicsWorld(t, { seed: 21 });
    const createWall = performance.now() - c0;
    const cc = process.cpuUsage(cpu0);
    // Wall time, or this process's CPU time when lower (other processes competing for the cores).
    const createMs = Math.min(createWall, (cc.user + cc.system) / 1000);
    expect(w.bodies.length).toBeGreaterThanOrEqual(280);

    // A stand-in iceberg (30 t, growing as it absorbs) charges down at 16 m/s steering at what is
    // ahead, doing what the session does: absorb ice, hit the rest, chip chunks off on hard hits.
    const ice = { x: 0, z: 20, r: 2.2, speed: 16, M: 30 };
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
    let absorbed = 0;
    let maxStep = 0;
    const s0 = performance.now();
    const sc0 = process.cpuUsage();
    for (let i = 0; i < 600; i++) {
      const st = performance.now();
      let targetX = 0;
      let ahead = 60;
      for (const b of w.bodies) {
        if (!b.active) continue;
        const dz = b.pos.z - ice.z;
        if ((b.anchored || b.proxy.absorbable) && dz > 2 && dz < ahead && Math.abs(b.pos.x - ice.x) < dz * 0.5 + 2) {
          ahead = dz;
          targetX = b.pos.x;
        }
      }
      ice.x += Math.max(-8 * DT, Math.min(8 * DT, targetX - ice.x));
      ice.z += ice.speed * DT;
      trail.push({ x: ice.x, z: ice.z });
      const y = t.heightAt(ice.x, ice.z);
      const ids: number[] = [];
      for (const p of w.proxiesNear(ice.x, ice.z, ice.r + 8)) {
        const dx = p.x - ice.x;
        const dz = p.z - ice.z;
        const d = Math.hypot(dx, dz);
        if (d > ice.r + p.radius || p.top < y - 0.3 || p.bottom > y + 2.8) continue;
        if ((lastHit.get(p.id) ?? -1) > i - 20) continue;
        ids.push(p.id);
      }
      for (const id of ids) {
        lastHit.set(id, i);
        const b = w.getBody(id);
        if (!b || !b.active) continue;
        if (b.proxy.absorbable) {
          const got = w.absorb(id);
          if (got) {
            ice.M += got.mass;
            absorbed++;
          }
          continue;
        }
        const dx = b.proxy.x - ice.x;
        const dz = b.proxy.z - ice.z;
        const d = Math.hypot(dx, dz) || 1;
        const c = hit(b, Math.max(1, ice.speed * (dz / d)), ice.M, dx / d, dz / d);
        const res = w.applyContact(c).result;
        contacts++;
        if (res === 'broken' || res === 'uprooted') broken++;
        if (c.shock > 2.5) w.spawnIceChunks(c.point, { x: 0, y: 0, z: ice.speed }, 0.02 * ice.M);
      }
      w.applyWaterForces(river, DT);
      w.step(DT);
      w.drainEvents();
      maxStep = Math.max(maxStep, performance.now() - st);
    }
    const wall = performance.now() - s0;
    const sc = process.cpuUsage(sc0);
    const cpu = (sc.user + sc.system) / 1000;
    const ms = Math.min(wall, cpu);
    console.log(
      `[physics perf] dense structures: bodies=${w.bodies.length} active=${w.activeCount} ` +
        `create=${createMs.toFixed(0)}ms (wall ${createWall.toFixed(0)}) ` +
        `600 steps=${ms.toFixed(0)}ms (wall ${wall.toFixed(0)}, cpu ${cpu.toFixed(0)}) = ` +
        `${(ms / 600).toFixed(2)} ms/step, worst step ${maxStep.toFixed(1)}ms, awake at end=${w.awakeCount}, ` +
        `contacts=${contacts} broken=${broken} absorbed=${absorbed} chunks live=${w.iceChunkCount}`,
    );
    expect(contacts).toBeGreaterThan(10);
    expect(broken).toBeGreaterThan(2);
    expect(absorbed).toBeGreaterThan(3);
    expect(createMs).toBeLessThan(4000);
    expect(ms).toBeLessThan(3000);
    for (const b of w.bodies) {
      // Rapier's position, not b.pos (stale while asleep): a sleeping body must not sink unseen.
      const p = b.active ? w.rigidBodyPosition(b.id) : null;
      if (p) expect(p.y).toBeGreaterThan(t.heightAt(p.x, p.z) - 3);
    }
    expect(w.iceChunkCount).toBeLessThanOrEqual(ICE.maxChunks);
    expect(T.farSleepDistance).toBeGreaterThan(0);
    w.dispose();
  });
});
