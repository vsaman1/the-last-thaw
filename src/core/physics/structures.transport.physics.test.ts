import { beforeAll, describe, expect, it } from 'vitest';
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
import { createIceberg, resolveIcebergContacts, stepIceberg } from '../sim/iceberg';
import { DEFAULT_ICEBERG_PARAMS, withLevelIceberg } from '../sim/params';
import { createPhysicsWorld, initRapier, type ObstacleBody, type PhysicsWorld } from './world';

const DT = 1 / 60;
const E = CONTACT_RESTITUTION;

beforeAll(async () => {
  await initRapier();
});

const flat =
  (h: number) =>
  (): number =>
    h;

function terrainWith(
  obstacles: ObstaclePlacement[],
  height: (x: number, z: number) => number = flat(5),
): Terrain {
  return createAnalyticTerrain({ height, cellSize: 2, level: { obstacles } });
}

function run(w: PhysicsWorld, seconds: number, river?: RiverTrailApi, events?: GameEvent[]): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    if (river) w.applyWaterForces(river, DT);
    w.step(DT);
    const ev = w.drainEvents();
    if (events) events.push(...ev);
  }
}

/** A head-on contact as the solver makes it for an iceberg of mass M at closing speed vn. */
function hit(b: ObstacleBody, vn: number, M = 30): IcebergContact {
  const m = b.mass;
  const J = (1 + E) * vn * ((M * m) / (M + m));
  const p = b.proxy;
  return {
    obstacleId: b.id,
    impulse: { x: 0, y: 0.2 * J, z: J },
    point: { x: p.x, y: Math.min(p.top, p.bottom + 1.2), z: p.z - p.radius },
    normal: { x: 0, y: 0, z: 1 },
    relSpeed: vn,
    speedLoss: 0,
    testImpulse: b.anchored ? (1 + E) * vn * M : J,
    shock: J / M,
  };
}

/** River stub: still water (null) or a uniform 6 m/s flow along +z in |x| < 6, 0.5 m deep. */
function river(terrain: Terrain, flowing: boolean): RiverTrailApi {
  return {
    samples: [],
    version: 0,
    length: 0,
    record: (_i: IcebergState, _t: Terrain, _time: number) => {},
    flowAt: (x: number, z: number): FlowQuery | null =>
      flowing && Math.abs(x) < 6
        ? { vx: 0, vz: 6, surfaceY: terrain.heightAt(x, z) + 0.5, strength: 1 }
        : null,
    disturb: () => {},
    reset: () => {},
  };
}

const ofKind = (w: PhysicsWorld, kind: ObstacleKind, part?: string): ObstacleBody[] =>
  w.bodies.filter((b) => b.active && b.kind === kind && (part === undefined || b.part === part));

const piecesOf = (w: PhysicsWorld, b: ObstacleBody): ObstacleBody[] =>
  w.bodies.filter((p) => p.originId === b.id && p.id !== b.id);

const nearestX = (bodies: ObstacleBody[], x = 0): ObstacleBody =>
  bodies.reduce((a, b) => (Math.abs(b.pos.x - x) < Math.abs(a.pos.x - x) ? b : a));

interface Charge {
  w: PhysicsWorld;
  ice: IcebergState;
  results: string[];
  vHit: number;
  /** Horizontal speed `after` seconds after the first contact. */
  vAfter: number;
  contacts: number;
}

/**
 * The real iceberg solver driving an iceberg (mass t, size scale) straight down a 0.05-0.06 slope
 * along x = x0 at v0 into the placements, for `seconds`.
 */
async function charge(
  placements: ObstaclePlacement[],
  opts: { mass?: number; scale?: number; v0: number; x0?: number; seconds?: number; after?: number },
): Promise<Charge> {
  const P = withLevelIceberg(DEFAULT_ICEBERG_PARAMS, { scale: opts.scale ?? 1, mass: opts.mass ?? 30 });
  const t = createAnalyticTerrain({
    height: inclinedPlane(0.06),
    cellSize: 2,
    level: { obstacles: placements, startS: 10 },
  });
  const w = await createPhysicsWorld(t, { seed: 5 });
  const ice = createIceberg(t, P);
  const x0 = opts.x0 ?? 0;
  ice.pos.x = x0;
  ice.pos.y = t.heightAt(x0, ice.pos.z);
  ice.vel.x = 0;
  ice.vel.z = opts.v0;
  const out: Charge = { w, ice, results: [], vHit: 0, vAfter: 0, contacts: 0 };
  let first = -1;
  const afterSteps = Math.round((opts.after ?? 0.5) / DT);
  for (let i = 0; i < Math.round((opts.seconds ?? 6) / DT); i++) {
    stepIceberg(ice, { steer: 0, source: 'none' }, t, DT, P, 10 + i * DT);
    const speed = Math.hypot(ice.vel.x, ice.vel.z);
    const contacts = resolveIcebergContacts(ice, w.proxiesNear(ice.pos.x, ice.pos.z, ice.radius + 10), P);
    if (contacts.length > 0 && first < 0) {
      first = i;
      out.vHit = speed;
    }
    for (const c of contacts) {
      out.contacts++;
      out.results.push(`${w.bodies[c.obstacleId].part}:${w.applyContact(c).result}`);
    }
    w.step(DT);
    w.drainEvents();
    if (first >= 0 && i === first + afterSteps) out.vAfter = Math.hypot(ice.vel.x, ice.vel.z);
  }
  return out;
}

describe('vehicles in the physics world', () => {
  it('a box truck, a bus and a freight wagon cost a 30 t iceberg far more speed than a car', async () => {
    const loss = new Map<ObstacleKind, number>();
    for (const kind of ['car', 'truck', 'bus', 'railWagon'] as const) {
      const c = await charge([{ kind, s: 40, d: 0, yaw: Math.PI / 2 }], { v0: 12, seconds: 4 });
      const [body] = c.w.bodies;
      expect(c.vHit).toBeGreaterThan(11.5);
      loss.set(kind, c.vHit - c.vAfter);
      // Shoved, not broken: a 12 m/s hit is below every vehicle's shatter speed.
      expect(body.active).toBe(true);
      expect(Math.hypot(body.pos.x - body.spawn.x, body.pos.z - body.spawn.z)).toBeGreaterThan(3);
      c.w.dispose();
    }
    const [car, truck, bus, wagon] = ['car', 'truck', 'bus', 'railWagon'].map(
      (k) => loss.get(k as ObstacleKind) ?? 0,
    );
    expect(car).toBeLessThan(1);
    expect(truck).toBeGreaterThan(2);
    expect(truck).toBeGreaterThan(3 * car);
    expect(bus).toBeGreaterThan(truck);
    expect(wagon).toBeGreaterThan(bus);
    expect(wagon).toBeGreaterThan(4);
  });

  it('soft hits push vehicles; hard ones shatter them into their documented pieces', async () => {
    const cases: [ObstacleKind, number, number, number][] = [
      // kind, a speed that only pushes it, one that shatters it, pieces
      ['truck', 16, 19, 3],
      ['bus', 18, 21, 2],
      ['railWagon', 22, 25, 3],
      ['boat', 8, 10, 4],
    ];
    for (const [kind, soft, hard, n] of cases) {
      const t = terrainWith([
        { kind, s: 40, d: 0, yaw: Math.PI / 2 },
        { kind, s: 100, d: 0, yaw: Math.PI / 2 },
      ]);
      const w = await createPhysicsWorld(t, { seed: 8 });
      const [a, b] = ofKind(w, kind);
      expect(w.applyContact(hit(a, soft)).result, kind).toBe('pushed');
      const events: GameEvent[] = [];
      expect(w.applyContact(hit(b, hard)).result, kind).toBe('broken');
      run(w, 1, undefined, events);
      const pieces = piecesOf(w, b);
      expect(pieces.length, kind).toBe(n);
      expect(pieces.reduce((s, p) => s + p.mass, 0)).toBeCloseTo(b.mass, 6);
      // They fly on the way the vehicle was hit and stay above the ground.
      for (const p of pieces) {
        expect(p.pos.z, kind).toBeGreaterThan(b.spawn.z - 1);
        expect(w.lowestPointY(p.id), kind).toBeGreaterThan(4.5);
      }
      expect(events.some((e) => e.type === 'obstacleBroken' && e.kind === kind)).toBe(true);
      expect(w.stats.buildingsDestroyed).toBe(0);
      w.dispose();
    }
  });
});

describe('guardrail in the physics world', () => {
  it('a segment snaps into posts and beam at 4 m/s and only shakes at 2; its neighbours stand', async () => {
    const t = terrainWith([{ kind: 'guardrail', s: 60, d: 0, span: 20 }]);
    const w = await createPhysicsWorld(t, { seed: 3 });
    const segs = ofKind(w, 'guardrail');
    expect(segs.length).toBe(5);
    const mid = nearestX(segs);
    expect(w.applyContact(hit(mid, 2)).result).toBe('shook');
    expect(w.applyContact(hit(mid, 4)).result).toBe('broken');
    run(w, 1);
    const pieces = piecesOf(w, mid);
    expect(pieces.length).toBe(3);
    expect(pieces.every((p) => !p.anchored && w.isDynamic(p.id))).toBe(true);
    for (const p of pieces) expect(w.lowestPointY(p.id)).toBeGreaterThan(4.6);
    expect(segs.filter((s) => s !== mid).every((s) => s.active && s.anchored)).toBe(true);
    expect(w.stats.knockedDown).toBe(1);
    w.dispose();
  });
});

describe('roadBridge in the physics world', () => {
  const bridge: ObstaclePlacement[] = [{ kind: 'roadBridge', s: 60, d: 0, span: 40 }];

  it('a normal iceberg slides under the intact deck between the piers, touching nothing', async () => {
    // Piers at x = -20, 0, 20: the iceberg goes down the middle of a bay.
    const c = await charge(bridge, { v0: 14, x0: 10, seconds: 7 });
    expect(c.contacts).toBe(0);
    expect(c.ice.pos.z).toBeGreaterThan(100);
    expect(Math.hypot(c.ice.vel.x, c.ice.vel.z)).toBeGreaterThan(13);
    for (const d of ofKind(c.w, 'roadBridge', 'deck')) {
      expect(Math.abs(d.pos.y - d.spawn.y)).toBeLessThan(0.05);
    }
    expect(c.w.stats.knockedDown).toBe(0);
    c.w.dispose();
  });

  it('a 30 t iceberg only dents a pier; a 100 t one topples it and both its decks come down', async () => {
    const t = terrainWith(bridge);
    const w = await createPhysicsWorld(t, { seed: 4 });
    const decks = ofKind(w, 'roadBridge', 'deck');
    const piers = ofKind(w, 'roadBridge', 'pier');
    expect(decks.length).toBe(2);
    expect(piers.length).toBe(3);
    run(w, 2);
    for (const d of decks) expect(Math.abs(d.pos.y - d.spawn.y)).toBeLessThan(0.05);
    const pier = nearestX(piers);
    expect(w.applyContact(hit(pier, 20, 30)).result).toBe('shook');
    expect(w.applyContact(hit(pier, 7.2, 100)).result).toBe('shook');
    const events: GameEvent[] = [];
    expect(w.applyContact(hit(pier, 7.6, 100)).result).toBe('uprooted');
    run(w, 5, undefined, events);
    for (const d of decks) expect(d.pos.y).toBeLessThan(d.spawn.y - 2.5);
    // Toppled down-course about its foot.
    expect(pier.proxy.z).toBeGreaterThan(pier.spawn.z + 2);
    expect(w.tiltOf(pier.id)).toBeGreaterThan(1);
    expect(piers.filter((p) => p !== pier).every((p) => p.active && p.anchored)).toBe(true);
    expect(events.some((e) => e.type === 'obstacleBroken' && e.kind === 'roadBridge')).toBe(true);
    expect(w.stats.knockedDown).toBeGreaterThanOrEqual(3);
    w.dispose();
  });

  it('the collapse is robust: spans, seeds, sloped and uneven ground, hits from 7.6 to 20 m/s', async () => {
    const grounds: ((x: number, z: number) => number)[] = [
      flat(5),
      inclinedPlane(0.08),
      (x) => 5 + 0.003 * x * x,
    ];
    for (const [g, height] of grounds.entries()) {
      for (const [span, seed, vn] of [
        [30, 1, 7.6],
        [45, 7, 12],
        [60, 3, 20],
        [100, 9, 7.6],
      ] as const) {
        const t = terrainWith([{ kind: 'roadBridge', s: 60, d: 0, span }], height);
        const w = await createPhysicsWorld(t, { seed });
        const pier = nearestX(ofKind(w, 'roadBridge', 'pier'));
        const decks = ofKind(w, 'roadBridge', 'deck');
        const bay = span / decks.length;
        const onPier = decks.filter((d) => Math.abs(Math.abs(d.spawn.x - pier.spawn.x) - bay / 2) < 1);
        expect(onPier.length).toBe(2);
        expect(w.applyContact(hit(pier, vn, 100)).result).toBe('uprooted');
        run(w, 5);
        const where = `ground ${g}, span ${span}, seed ${seed}, ${vn} m/s`;
        for (const d of onPier) expect(d.pos.y, where).toBeLessThan(d.spawn.y - 2.5);
        for (const d of decks.filter((d) => !onPier.includes(d))) {
          expect(Math.abs(d.pos.y - d.spawn.y), where).toBeLessThan(0.3);
        }
        w.dispose();
      }
    }
  });

  it('real solver: a 100 t iceberg at 16 m/s drops the decks and ploughs on past the pier', async () => {
    const c = await charge(bridge, { mass: 100, scale: 1.5, v0: 16, seconds: 10 });
    expect(c.results[0]).toBe('pier:uprooted');
    for (const d of ofKind(c.w, 'roadBridge', 'deck')) expect(d.pos.y).toBeLessThan(d.spawn.y - 2.5);
    expect(c.ice.pos.z).toBeGreaterThan(90);
    expect(Math.hypot(c.ice.vel.x, c.ice.vel.z)).toBeGreaterThan(3);
    c.w.dispose();
  });
});

describe('dam in the physics world', () => {
  const dam: ObstaclePlacement[] = [{ kind: 'dam', s: 60, d: 0, span: 40 }];

  it('break thresholds: 40 m/s for a 30 t iceberg, 12 m/s for a 100 t one', async () => {
    const t = terrainWith([
      { kind: 'dam', s: 60, d: 0, span: 10 },
      { kind: 'dam', s: 120, d: 0, span: 10 },
    ]);
    const w = await createPhysicsWorld(t, { seed: 2 });
    const [a, b] = ofKind(w, 'dam');
    expect(w.applyContact(hit(a, 39, 30)).result).toBe('shook');
    expect(w.applyContact(hit(a, 11.8, 100)).result).toBe('shook');
    expect(w.applyContact(hit(a, 12.2, 100)).result).toBe('broken');
    expect(w.applyContact(hit(b, 40.5, 30)).result).toBe('broken');
    w.dispose();
  });

  it('it stops a 30 t iceberg at 20 m/s dead', async () => {
    const c = await charge(dam, { v0: 20, seconds: 5 });
    expect(c.results.length).toBeGreaterThan(0);
    expect(c.results.every((r) => r === 'block:shook')).toBe(true);
    expect(ofKind(c.w, 'dam').every((m) => m.anchored)).toBe(true);
    // Bounced back off the upstream face.
    expect(c.ice.pos.z).toBeLessThan(60 - 2.3);
    expect(Math.hypot(c.ice.vel.x, c.ice.vel.z)).toBeLessThan(3);
    c.w.dispose();
  });

  it('a 100 t iceberg at 14 m/s breaches it: the monolith bursts and its blocks tumble down', async () => {
    const t = createAnalyticTerrain({ height: inclinedPlane(0.06), cellSize: 2, level: { obstacles: dam } });
    const before = await createPhysicsWorld(t, { seed: 5 });
    const spawnTop = Math.max(...ofKind(before, 'dam').map((m) => m.proxy.top));
    before.dispose();
    // It reaches the dam after ~3 s; the blocks need ~2 s to tumble down the steps.
    const c = await charge(dam, { mass: 100, scale: 1.5, v0: 14, seconds: 7 });
    const { w } = c;
    expect(c.results[0]).toBe('block:broken');
    const monoliths = w.bodies.filter((b) => b.kind === 'dam' && b.originId === b.id);
    const broken = monoliths.filter((m) => !m.active);
    expect(broken.length).toBe(1);
    expect(Math.abs(broken[0].spawn.x)).toBeLessThan(0.5);
    // The neighbours stand: a partial breach.
    expect(monoliths.filter((m) => m.active).every((m) => m.anchored)).toBe(true);
    const blocks = piecesOf(w, broken[0]);
    expect(blocks.length).toBe(9);
    const moved = blocks.filter(
      (p) => Math.hypot(p.pos.x - p.spawn.x, p.pos.y - p.spawn.y, p.pos.z - p.spawn.z) > 2,
    );
    expect(moved.length).toBeGreaterThanOrEqual(6);
    // Downstream, and none pushed into the ground.
    for (const p of moved) expect(p.pos.z).toBeGreaterThan(p.spawn.z + 1);
    for (const p of blocks) expect(w.lowestPointY(p.id)).toBeGreaterThan(t.heightAt(p.pos.x, p.pos.z) - 0.5);
    // The crest blocks came down from the top of the wall.
    const crest = blocks.filter((p) => p.spawn.y + p.localMax.y > spawnTop - 0.5);
    expect(crest.length).toBe(3);
    for (const p of crest) expect(p.pos.y).toBeLessThan(p.spawn.y - 2);
    expect(w.stats.knockedDown).toBeGreaterThanOrEqual(1);
    expect(w.stats.buildingsDestroyed).toBe(0);
    w.dispose();
  });
});

describe('boat on the water', () => {
  it('floats level at its waterline in still sea water and rights itself after a shove', async () => {
    const sea = 2.5;
    const t = createAnalyticTerrain({ height: flat(0), cellSize: 2, seaLevel: sea, level: {} });
    const w = await createPhysicsWorld(t, { seed: 6 });
    const [boat] = w.spawn('boat', 0, 60, { yaw: 0, y: sea - 1 });
    const y0 = boat.pos.y;
    run(w, 6, river(t, false));
    expect(boat.inWater).toBe(true);
    expect(w.lowestPointY(boat.id)).toBeLessThan(sea - 0.6);
    expect(boat.proxy.top).toBeGreaterThan(sea + 0.6);
    expect(Math.abs(boat.pos.y - y0)).toBeLessThan(0.1);
    expect(w.tiltOf(boat.id)).toBeLessThan(0.05);
    // A shove from the side rocks it; it rights itself and stays afloat.
    const side = { ...hit(boat, 4), impulse: { x: 4, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } };
    side.point = { x: boat.proxy.x - 1.4, y: boat.proxy.top, z: boat.proxy.z };
    expect(w.applyContact(side).result).toBe('pushed');
    let heel = 0;
    const still = river(t, false);
    for (let i = 0; i < 8 * 60; i++) {
      w.applyWaterForces(still, DT);
      w.step(DT);
      heel = Math.max(heel, w.tiltOf(boat.id));
    }
    expect(heel).toBeGreaterThan(0.5);
    expect(w.tiltOf(boat.id)).toBeLessThan(0.15);
    expect(w.lowestPointY(boat.id)).toBeLessThan(sea - 0.6);
    expect(boat.proxy.top).toBeGreaterThan(sea + 0.6);
    w.dispose();
  });

  it('a boat placed over open water spawns afloat at the waterline and stays afloat', async () => {
    const sea = 4;
    const t = createAnalyticTerrain({
      height: flat(0),
      cellSize: 2,
      seaLevel: sea,
      level: { obstacles: [{ kind: 'boat', s: 60, d: 0, yaw: 0 }] },
    });
    const w = await createPhysicsWorld(t, { seed: 6 });
    const [boat] = ofKind(w, 'boat');
    const afloat = (): void => {
      expect(w.lowestPointY(boat.id)).toBeLessThan(sea - 0.6);
      expect(boat.proxy.top).toBeGreaterThan(sea + 0.5);
    };
    afloat();
    run(w, 1, river(t, false));
    afloat();
    w.wakeAll();
    run(w, 8, river(t, false));
    afloat();
    w.dispose();
  });

  it('the meltwater river carries a beached boat downstream', async () => {
    const t = terrainWith([{ kind: 'boat', s: 60, d: 0, yaw: 0 }]);
    const w = await createPhysicsWorld(t, { seed: 6 });
    const [boat] = ofKind(w, 'boat');
    run(w, 4, river(t, true));
    expect(boat.pos.z - boat.spawn.z).toBeGreaterThan(3);
    expect(boat.inWater).toBe(true);
    w.dispose();
  });
});
