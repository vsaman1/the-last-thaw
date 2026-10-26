import { describe, expect, it } from 'vitest';
import { autopilotSteer } from '../autopilot';
import { CONTACT_RESTITUTION } from '../obstacles/catalog';
import { dirToHeading } from '../math';
import { FIXED_DT, GameSession } from '../session';
import { createAnalyticTerrain } from '../testing/analyticTerrain';
import { bridgeSandbox } from '../testing/bridgeSandbox';
import type { GameEvent, IcebergContact, ObstaclePlacement, TerrainFeature } from '../types';
import { createPhysicsWorld, initRapier, type ObstacleBody, type PhysicsWorld } from './world';

/**
 * A road bridge carries the iceberg (./deckGround.ts, playtest 2): from the road onto the abutment,
 * across the deck high over the gorge and down the road beyond, without ever colliding with the
 * deck, which stays on its seats; beside the deck the gorge is as fatal as before, and a deck that
 * has left its seats carries nothing.
 */

interface Crossing {
  phase: string;
  reason: string | null;
  maxS: number;
  /** Highest the iceberg rode above the terrain while over the gorge (m). */
  overGorge: number;
  /** Collisions with the bridge's decks, and how far any deck moved (m). */
  deckHits: number;
  deckMoved: number;
}

/** The sandbox's glen road bridge (s 145-175, d -40): the iceberg sent down the road at it. */
async function cross(lane: number, speed: number, seconds = 14): Promise<Crossing> {
  const s = await GameSession.create({ level: bridgeSandbox, skipIntro: true });
  const t = s.terrain;
  const ice = s.iceberg;
  const w = t.course.toWorld(110, lane);
  const c = t.course.sampleAt(110);
  ice.pos.x = w.x;
  ice.pos.y = w.y;
  ice.pos.z = w.z;
  ice.vel.x = c.dirX * speed;
  ice.vel.z = c.dirZ * speed;
  ice.heading = dirToHeading(c.dirX, c.dirZ);
  ice.grounded = true;
  const world = s.physics as PhysicsWorld;
  const decks = world.bodies.filter((b) => b.kind === 'roadBridge' && b.part === 'deck');
  const deckIds = new Set(decks.map((b) => b.id));
  let deckHits = 0;
  s.events.on((e: GameEvent) => {
    if (e.type === 'collision' && deckIds.has(e.obstacleId)) deckHits++;
  });
  let maxS = -Infinity;
  let overGorge = 0;
  let deckMoved = 0;
  for (let n = 0; n < seconds * 60 && s.phase === 'playing'; n++) {
    s.update(FIXED_DT, autopilotSteer(ice, t, { pursuit: 'course', followLine: false, lane }));
    const p = t.course.project(ice.pos.x, ice.pos.z);
    maxS = Math.max(maxS, p.s);
    if (p.s > 152 && p.s < 168) overGorge = Math.max(overGorge, ice.pos.y - t.heightAt(ice.pos.x, ice.pos.z));
    for (const b of decks) {
      deckMoved = Math.max(deckMoved, Math.hypot(b.pos.x - b.spawn.x, b.pos.y - b.spawn.y, b.pos.z - b.spawn.z));
    }
  }
  const out = { phase: s.phase, reason: s.failReason, maxS, overGorge, deckHits, deckMoved };
  s.dispose();
  return out;
}

describe('road bridges carry the iceberg', () => {
  it('across the gorge from the road and its lanes, slow or fast, never hitting the deck', async () => {
    for (const lane of [-42, -40, -38]) {
      for (const speed of [6, 14]) {
        const r = await cross(lane, speed);
        const tag = `lane ${lane}, ${speed} m/s: ${r.phase} ${r.reason ?? ''} to s ${r.maxS.toFixed(0)}`;
        expect(r.reason, tag).not.toBe('fell');
        expect(r.reason, tag).not.toBe('stuck');
        // Over the far rim (s 175) and on down the road.
        expect(r.maxS, tag).toBeGreaterThan(200);
        // High over the gorge floor (14 m deep), on the deck.
        expect(r.overGorge, tag).toBeGreaterThan(9);
        expect(r.deckHits, tag).toBe(0);
        // On its seats, unmoved (the meltwater it lays on the road does not push the deck).
        expect(r.deckMoved, tag).toBeLessThan(0.05);
      }
    }
  }, 240_000);

  it('beside the deck the gorge is as fatal as ever', async () => {
    const r = await cross(-52, 10);
    expect(r.reason).toBe('fell');
    expect(r.maxS).toBeLessThan(175);
  }, 120_000);
});

/** One run at the sandbox's glen bridge, from s 110 on `lane`, aimed `angle` rad off the road. */
async function ride(
  lane: number,
  speed: number,
  angle: number,
  steerLane: number | null,
): Promise<{ reason: string | null; maxS: number; off: number; v0: number; vMin: number; walls: number; radius: number }> {
  const s = await GameSession.create({ level: bridgeSandbox, skipIntro: true });
  const t = s.terrain;
  const ice = s.iceberg;
  const w = t.course.toWorld(110, lane);
  const c = t.course.sampleAt(110);
  // d > 0 is right of the course direction.
  const dx = c.dirX * Math.cos(angle) - c.dirZ * Math.sin(angle);
  const dz = c.dirZ * Math.cos(angle) + c.dirX * Math.sin(angle);
  ice.pos.x = w.x;
  ice.pos.y = w.y;
  ice.pos.z = w.z;
  ice.vel.x = dx * speed;
  ice.vel.z = dz * speed;
  ice.heading = dirToHeading(dx, dz);
  ice.grounded = true;
  let walls = 0;
  s.events.on((e: GameEvent) => {
    if (e.type === 'collision' && e.obstacleId < 0) walls++;
  });
  let maxS = -Infinity;
  let off = 0;
  let v0 = NaN;
  let vMin = Infinity;
  for (let n = 0; n < 14 * 60 && s.phase === 'playing'; n++) {
    const steer =
      steerLane === null
        ? { steer: 0, source: 'none' as const }
        : autopilotSteer(ice, t, { pursuit: 'course', followLine: false, lane: steerLane });
    s.update(FIXED_DT, steer);
    const p = t.course.project(ice.pos.x, ice.pos.z);
    maxS = Math.max(maxS, p.s);
    // On the deck (s 145-175, between the abutments' ends).
    if (p.s > 147 && p.s < 173) {
      off = Math.max(off, Math.abs(p.d + 40));
      const v = Math.hypot(ice.vel.x, ice.vel.z);
      if (Number.isNaN(v0)) v0 = v;
      vMin = Math.min(vMin, v);
    }
  }
  const out = { reason: s.failReason, maxS, off, v0, vMin, walls, radius: ice.radius };
  s.dispose();
  return out;
}

describe('the parapets of a road bridge', () => {
  // The sandbox bridge's barriers stand 4.95 m either side of its axis, 0.6 m wide at the base: the
  // corridor between their inner faces is 4.65 m either side of the axis.
  const INNER = 4.65;

  it('an iceberg aimed at a parapet glances off it and stays between them, and crosses', async () => {
    for (const [speed, angle] of [
      [10, 0.12],
      [10, -0.12],
      [14, 0.2],
    ]) {
      const r = await ride(-40, speed, angle, null);
      const tag = `${speed} m/s at ${angle} rad: ${r.reason ?? 'playing'} to s ${r.maxS.toFixed(0)}, ${r.off.toFixed(2)} m off the axis`;
      expect(r.walls, tag).toBeGreaterThan(0);
      // Its centre never further out than the corridor allows (plus one step's overlap).
      expect(r.off, tag).toBeLessThan(INNER - r.radius + 0.25);
      expect(r.reason, tag).toBeNull();
      expect(r.maxS, tag).toBeGreaterThan(200);
      expect(r.vMin, tag).toBeGreaterThan(0.9 * r.v0);
    }
  }, 240_000);

  it('steered into a parapet it never grinds to a crawl: the barrier gives way as before the walls', async () => {
    // Held for a lane outside the corridor (5 m off the axis, over the barrier): it crosses at speed.
    const r = await ride(-40, 10, 0, -45);
    const tag = `${r.reason ?? 'playing'} to s ${r.maxS.toFixed(0)}, ${r.off.toFixed(2)} m off, v ${r.v0.toFixed(1)}/${r.vMin.toFixed(1)}`;
    expect(r.reason, tag).toBeNull();
    expect(r.maxS, tag).toBeGreaterThan(200);
    expect(r.vMin, tag).toBeGreaterThan(0.85 * r.v0);
  }, 120_000);
});

describe('a deck knocked off its seats carries nothing', () => {
  // A 0.06 slope along +z (s = z, d = -x), a gorge across it at s 200 (40 m wide, 15 m deep), a road
  // to each rim, and a road bridge from rim to rim on two decks and a pier.
  const DEPTH = 15;
  const cut = (z: number): number => {
    const q = Math.abs(z - 200);
    return q <= 20 ? DEPTH : q < 21 ? DEPTH * (21 - q) : 0;
  };
  const ROADS: TerrainFeature[] = [
    { type: 'road', s0: 30, s1: 170, d: 0, width: 8 },
    { type: 'road', s0: 230, s1: 380, d: 0, width: 8 },
  ];
  const BRIDGE: ObstaclePlacement = { kind: 'roadBridge', s: 200, d: 0, yaw: Math.PI / 2, span: 60 };

  async function run(knockPier: boolean): Promise<{ maxS: number; lowest: number }> {
    await initRapier();
    const t = createAnalyticTerrain({
      height: (_x, z) => 70 - 0.06 * z - cut(z),
      halfWidth: 70,
      width: 200,
      length: 420,
      cellSize: 2,
      level: { obstacles: [BRIDGE], features: ROADS, theme: 'town' },
    });
    const w = await createPhysicsWorld(t, { seed: 5 });
    const piers = w.bodies.filter((b) => b.kind === 'roadBridge' && b.part === 'pier');
    expect(piers).toHaveLength(1);
    if (knockPier) {
      expect(w.applyContact(hit(piers[0], 7.6, 100)).result).toBe('uprooted');
      for (let k = 0; k < 5 * 60; k++) w.step(FIXED_DT);
    }
    const s = await GameSession.create({ level: t.level, terrain: t, physics: w, skipIntro: true });
    const ice = s.iceberg;
    ice.pos.x = 0;
    ice.pos.z = 150;
    ice.pos.y = t.heightAt(0, 150);
    ice.vel.x = 0;
    ice.vel.z = 10;
    ice.heading = dirToHeading(0, 1);
    ice.grounded = true;
    let maxS = 0;
    let lowest = Infinity;
    for (let n = 0; n < 12 * 60 && s.phase === 'playing'; n++) {
      s.update(FIXED_DT, { steer: 0, source: 'scripted' });
      maxS = Math.max(maxS, ice.pos.z);
      if (Math.abs(ice.pos.z - 200) < 10) {
        lowest = Math.min(lowest, ice.pos.y - t.heightAt(ice.pos.x, ice.pos.z));
      }
    }
    s.dispose();
    return { maxS, lowest };
  }

  /** A head-on contact as the solver makes it for an iceberg of mass M at closing speed vn. */
  function hit(b: ObstacleBody, vn: number, M: number): IcebergContact {
    const m = b.mass;
    const J = (1 + CONTACT_RESTITUTION) * vn * ((M * m) / (M + m));
    const p = b.proxy;
    return {
      obstacleId: b.id,
      impulse: { x: 0, y: 0.2 * J, z: J },
      point: { x: p.x, y: Math.min(p.top, p.bottom + 1.2), z: p.z - p.radius },
      normal: { x: 0, y: 0, z: 1 },
      relSpeed: vn,
      speedLoss: 0,
      testImpulse: (1 + CONTACT_RESTITUTION) * vn * M,
      shock: J / M,
    };
  }

  it('standing, the bridge carries it over; with its pier knocked out, it drops into the gorge', async () => {
    const standing = await run(false);
    expect(standing.maxS).toBeGreaterThan(250);
    expect(standing.lowest).toBeGreaterThan(DEPTH - 2);
    const fallen = await run(true);
    expect(fallen.maxS).toBeLessThan(225);
    expect(fallen.lowest).toBeLessThan(3);
  }, 120_000);
});
