import { describe, expect, it } from 'vitest';
import { FIXED_DT, GameSession } from './session';
import { dirToHeading } from './math';
import { createAnalyticTerrain, inclinedPlane } from './testing/analyticTerrain';
import type { PhysicsWorld } from './physics/world';
import type { GameEvent, ObstacleKind, ObstaclePlacement, SteeringInput } from './types';

/**
 * Iceberg vs the rubble of what it smashes, with the real session (solver, physics world, chipping,
 * stuck rule). A heavy iceberg ploughs through the debris of houses, power plants and dams, losing
 * the speed the break costs and a little to the rubble; a light one still loses a big bite. Before
 * the bulldozing contacts every re-contact with a piece cost a fresh J / M, so rubble parked just
 * ahead pinned icebergs several times its weight (numbers in each test).
 */

const NONE: SteeringInput = { steer: 0, source: 'none' };

interface Crash {
  name: string;
  /** Horizontal speed on the step before the first contact with the target. */
  vIn: number;
  /** Lowest speed after that contact. */
  vMin: number;
  /** Speed when the iceberg is 40 m past the last placement (NaN if it never got there). */
  vOut: number;
  endS: number;
  phase: string;
  reason: string | null;
  broken: ObstacleKind[];
  /** Collisions counted with chunks broken off the iceberg less than 1 s after a chip. */
  ownChunkHits: number;
  /** Collisions counted with pieces of obstacles it broke (bulldozed rubble is no new impact). */
  pieceHits: number;
  chips: number;
}

interface Scenario {
  name: string;
  mass: number;
  scale: number;
  speed: number;
  slope?: number;
  obstacles: ObstaclePlacement[];
  target: ObstacleKind;
  /** Lateral offset of the iceberg's line (d, + = right of travel). */
  d?: number;
  height?: (x: number, z: number) => number;
  seconds?: number;
}

/**
 * Put a level iceberg (mass t, size scale) on a straight slope 45 m before the first placement,
 * moving down-course at `speed`, and let it run with no input.
 */
async function crash(sc: Scenario): Promise<Crash> {
  const slope = sc.slope ?? 0.06;
  const t = createAnalyticTerrain({
    height: sc.height ?? inclinedPlane(slope, 200),
    cellSize: 2,
    length: 700,
    width: 160,
    level: { obstacles: sc.obstacles, iceberg: { scale: sc.scale, mass: sc.mass } },
  });
  const s = await GameSession.create({ level: t.level, terrain: t, skipIntro: true });
  const w = s.physics as PhysicsWorld;
  const events: GameEvent[] = [];
  s.events.on((e) => events.push(e));
  s.advance(200, NONE); // past the start grace
  const ice = s.iceberg;
  const x0 = -(sc.d ?? 0);
  const z0 = sc.obstacles[0].s - 45;
  ice.pos.x = x0;
  ice.pos.z = z0;
  ice.pos.y = t.heightAt(x0, z0);
  ice.vel.x = 0;
  ice.vel.z = sc.speed;
  ice.vel.y = -slope * sc.speed;
  ice.heading = dirToHeading(0, 1);
  ice.stuckTimer = 0;
  const lastS = Math.max(...sc.obstacles.map((o) => o.s));
  const out: Crash = {
    name: sc.name,
    vIn: NaN,
    vMin: Infinity,
    vOut: NaN,
    endS: 0,
    phase: '',
    reason: null,
    broken: [],
    ownChunkHits: 0,
    pieceHits: 0,
    chips: 0,
  };
  let lastChip = -Infinity;
  for (let n = 0; n < (sc.seconds ?? 12) * 60 && s.phase === 'playing'; n++) {
    const before = Math.hypot(ice.vel.x, ice.vel.z);
    const k = events.length;
    s.update(FIXED_DT, NONE);
    for (let i = k; i < events.length; i++) {
      const e = events[i];
      if (e.type === 'iceChipped') {
        out.chips++;
        lastChip = n;
      } else if (e.type === 'obstacleBroken') {
        out.broken.push(e.kind);
      } else if (e.type === 'collision') {
        if (e.kind === sc.target && Number.isNaN(out.vIn)) out.vIn = before;
        const b = w.bodies[e.obstacleId];
        if (b.part === 'chunk' && (n - lastChip) * FIXED_DT < 1) out.ownChunkHits++;
        if (b.originId !== b.id) out.pieceHits++;
      }
    }
    const v = Math.hypot(ice.vel.x, ice.vel.z);
    if (!Number.isNaN(out.vIn)) out.vMin = Math.min(out.vMin, v);
    if (Number.isNaN(out.vOut) && ice.pos.z > lastS + 40) out.vOut = v;
  }
  out.endS = ice.pos.z;
  out.phase = s.phase;
  out.reason = s.failReason;
  s.dispose();
  console.log(
    `[rubble] ${sc.name.padEnd(40)} in ${out.vIn.toFixed(1)} min ${out.vMin.toFixed(1)} ` +
      `+40m ${out.vOut.toFixed(1)} m/s, end s=${out.endS.toFixed(0)} ${out.phase}` +
      `${out.reason ? ` (${out.reason})` : ''}, broken ${out.broken.length}, chips ${out.chips}`,
  );
  return out;
}

/** Got through: not failed, 40 m past the last placement, still moving at more than `v` m/s. */
function expectThrough(c: Crash, v: number): void {
  expect(c.phase, c.name).toBe('playing');
  expect(c.vOut, `${c.name}: speed 40 m past it`).toBeGreaterThan(v);
}

describe('a heavy iceberg ploughs through the rubble of what it smashes', () => {
  it('80 t at 16 m/s through two houses back to back on a 0.12 slope (was: 1.5 m/s, crawling)', async () => {
    const c = await crash({
      name: '80 t @16 two houses, slope 0.12',
      mass: 80,
      scale: 1.4,
      speed: 16,
      slope: 0.12,
      obstacles: [
        { kind: 'house', s: 150, d: 0 },
        { kind: 'house', s: 163, d: 0 },
      ],
      target: 'house',
    });
    expect(c.broken.filter((k) => k === 'house')).toHaveLength(2);
    expectThrough(c, 10);
    // Ploughing through their rubble is no new impact: one collision and one chip per house.
    expect(c.pieceHits).toBe(0);
    expect(c.chips).toBe(2);
    // Each break costs the loose-body impulse for the house (1.25·12/92 ≈ 16 %), the rubble little.
    expect(c.vIn - c.vMin).toBeGreaterThan(2);
    expect(c.vMin).toBeGreaterThan(9);
  });

  it('132 t at 14 m/s fells a full-size smokestack and carries on (was: 4.6 m/s)', async () => {
    const c = await crash({
      name: '132 t @14 smokestack',
      mass: 132,
      scale: 1.64,
      speed: 14,
      obstacles: [{ kind: 'smokestack', s: 150, d: 0 }],
      target: 'smokestack',
    });
    expect(c.broken).toContain('smokestack');
    expectThrough(c, 5);
    // 70 t shaft against 132 t: felling it costs ~40 %, more than a house would.
    expect(c.vMin).toBeLessThan(0.6 * c.vIn);
  });

  it('220 t at 14 m/s smashes a full-size factory hall and carries on (was: 6.8 m/s)', async () => {
    const c = await crash({
      name: '220 t @14 factoryHall',
      mass: 220,
      scale: 2.2,
      speed: 14,
      obstacles: [{ kind: 'factoryHall', s: 150, d: 0 }],
      target: 'factoryHall',
    });
    expect(c.broken).toContain('factoryHall');
    expectThrough(c, 8);
  });

  it('220 t at 20 m/s smashes a full-size cooling tower and carries on (was: stuck)', async () => {
    const c = await crash({
      name: '220 t @20 coolingTower 1.0',
      mass: 220,
      scale: 2.2,
      speed: 20,
      obstacles: [{ kind: 'coolingTower', s: 150, d: 0 }],
      target: 'coolingTower',
    });
    expect(c.broken).toContain('coolingTower');
    expectThrough(c, 8);
    // The 120 t shell costs the loose-body share (1.25·120/340 ≈ 44 %); its 30 panels almost nothing.
    expect(c.vMin).toBeGreaterThan(0.45 * c.vIn);
  });

  it('220 t at 14 m/s fells a pylon and a wind turbine at little cost (was: 8.5 and 1.0 m/s)', async () => {
    for (const kind of ['pylon', 'windTurbine'] as const) {
      const c = await crash({
        name: `220 t @14 ${kind}`,
        mass: 220,
        scale: 2.2,
        speed: 14,
        obstacles: [{ kind, s: 150, d: 0, yaw: kind === 'pylon' ? 0.6 : 0 }],
        target: kind,
      });
      expect(c.broken).toContain(kind);
      expectThrough(c, 10);
    }
  });

  it('100 t knocks out a bridge pier at 12 or 16 m/s and gets past it (was: stuck at 12)', async () => {
    for (const speed of [12, 16]) {
      const c = await crash({
        name: `100 t @${speed} roadBridge pier`,
        mass: 100,
        scale: 1.6,
        speed,
        obstacles: [{ kind: 'roadBridge', s: 150, d: 0 }],
        target: 'roadBridge',
        seconds: 16,
      });
      expect(c.broken).toContain('roadBridge');
      expect(c.phase).toBe('playing');
      // The 56 t pier is heavy rubble for 100 t: a big bite, but it is shoved out of the way.
      expect(c.endS).toBeGreaterThan(170); // well past the pier (s = 150) and still going
      expect(c.vMin).toBeLessThan(0.5 * c.vIn);
    }
  });

  it('rubble pushed into the next building does not shield it: chalet, barn, 40 t at 14 m/s', async () => {
    const c = await crash({
      name: '40 t @14 chalet then barn, slope 0.08',
      mass: 40,
      scale: 1.1,
      speed: 14,
      slope: 0.08,
      obstacles: [
        { kind: 'chalet', s: 150, d: 0 },
        { kind: 'barn', s: 175, d: 0 },
      ],
      target: 'chalet',
      seconds: 16,
    });
    expect(c.broken).toContain('chalet');
    expect(c.broken).toContain('barn');
    expectThrough(c, 5);
  });
});

describe('a light iceberg still pays for a house', () => {
  it('30 t at 16 m/s breaks a house but loses over a third of its speed (was: 1.4 m/s)', async () => {
    const c = await crash({
      name: '30 t @16 house',
      mass: 30,
      scale: 1,
      speed: 16,
      obstacles: [{ kind: 'house', s: 150, d: 0 }],
      target: 'house',
    });
    expect(c.broken).toContain('house');
    expect(c.vMin).toBeLessThan(0.7 * c.vIn);
    expect(c.vOut).toBeLessThan(0.7 * c.vIn);
    expect(c.chips).toBeGreaterThanOrEqual(1);
  });

  it('30 t at 12 m/s does not break it and is stopped', async () => {
    const c = await crash({
      name: '30 t @12 house',
      mass: 30,
      scale: 1,
      speed: 12,
      obstacles: [{ kind: 'house', s: 150, d: 0 }],
      target: 'house',
    });
    expect(c.broken).toEqual([]);
    expect(c.endS).toBeLessThan(150);
    expect(c.vMin).toBeLessThan(1);
  });
});

describe('dams', () => {
  const dam: ObstaclePlacement[] = [{ kind: 'dam', s: 150, d: 0 }];

  it('220 t at 12 m/s breaks through a few metres off-centre (was: stuck in the breach)', async () => {
    for (const d of [3, 4]) {
      const c = await crash({ name: `220 t @12 dam d=${d}`, mass: 220, scale: 2.2, speed: 12, obstacles: dam,
        target: 'dam', d });
      expect(c.broken).toContain('dam');
      expectThrough(c, 3);
    }
  });

  it('...and on a V-shaped gorge whose blocks follow the cross slope', async () => {
    const gorge = (x: number, z: number): number => 200 - 0.06 * z + 0.15 * Math.abs(x);
    const c = await crash({ name: '220 t @12 dam d=3 on a V gorge', mass: 220, scale: 2.2, speed: 12,
      obstacles: dam, target: 'dam', d: 3, height: gorge });
    expect(c.broken).toContain('dam');
    expectThrough(c, 3);
  });

  it('100 t at 14 m/s breaches the centre monolith and ploughs on (was: stuck)', async () => {
    const c = await crash({ name: '100 t @14 dam', mass: 100, scale: 1.6, speed: 14, obstacles: dam,
      target: 'dam' });
    expect(c.broken).toContain('dam');
    expectThrough(c, 3);
  });

  // Power Valley's dam (42 m: monoliths with joints at x = ±5 and ±13) and Riverside Town's (0.85
  // scale, joints at ±4.25 m), met by a melted iceberg at the seam between two monoliths. One after
  // the other, the first took so much speed that the second held and pinned the iceberg.
  const pv: ObstaclePlacement[] = [{ kind: 'dam', s: 150, d: 0, span: 42 }];
  const seams: [string, number, number, number, number, ObstaclePlacement[]][] = [
    ['132 t @14 at the joint', 132, 1.8, 14, -5, pv],
    ['132 t @18 at the joint', 132, 1.8, 18, -5, pv],
    ['110 t @14, 3.5 m off the centre', 110, 1.7, 14, -3.5, pv],
    ['100 t @14 at a 0.85 dam joint', 100, 1.6, 14, -4.25, [{ ...pv[0], span: 31.4, scale: 0.85 }]],
  ];
  for (const [name, mass, scale, speed, d, obstacles] of seams) {
    it(`a seam hit breaks both monoliths and gets through: ${name} (was: pinned)`, async () => {
      const c = await crash({ name: `${name} (seam)`, mass, scale, speed, obstacles, target: 'dam', d,
        seconds: 16 });
      expect(c.broken.filter((k) => k === 'dam').length).toBeGreaterThanOrEqual(2);
      expectThrough(c, 2);
    });
  }

  it('a seam is no way through for an iceberg too light to break one monolith: 60 t, 14 m/s', async () => {
    const c = await crash({ name: '60 t @14 at the joint (seam)', mass: 60, scale: 1.26, speed: 14,
      obstacles: pv, target: 'dam', d: -5 });
    expect(c.broken).toEqual([]);
    expect(c.endS).toBeLessThan(150);
  });
});

describe('the iceberg does not run into its own ice', () => {
  it('no collisions with its chunks in the second after a chip (was: 166 in one dam breach)', async () => {
    let chips = 0;
    for (const sc of [
      { name: '100 t @14 dam (chunks)', mass: 100, scale: 1.6, speed: 14, target: 'dam' as const,
        obstacles: [{ kind: 'dam' as const, s: 150, d: 0 }] },
      { name: '30 t @16 house (chunks)', mass: 30, scale: 1, speed: 16, target: 'house' as const,
        obstacles: [{ kind: 'house' as const, s: 150, d: 0 }] },
    ]) {
      const c = await crash(sc);
      chips += c.chips;
      expect(c.ownChunkHits, c.name).toBe(0);
    }
    expect(chips).toBeGreaterThanOrEqual(2);
  });
});
