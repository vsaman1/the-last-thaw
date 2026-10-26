import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FIXED_DT, GameSession } from './session';
import { dirToHeading } from './math';
import { createAnalyticTerrain } from './testing/analyticTerrain';
import type { ObstacleBody, PhysicsWorld } from './physics/world';
import type { ContactOutcome, IcebergContact, ObstacleKind, SteeringInput } from './types';

/**
 * Tall structures a heavy iceberg passes, with the real session (solver, physics world, bulldozing,
 * chipping): whatever it breaks comes down, falling across and along its path, whether it meets
 * it square or only grazes its foot, on a slope, a hill crest or a hill's flank (Power Valley's
 * wind turbines stand on crests and valley sides). A light or slow iceberg still cannot fell what
 * it could not fell head-on. "was" numbers: the same pass before these fixes, when a released
 * tower stood on (its foot kicked out by the iceberg's pushes, or jammed in the ground it was set
 * into), and a glancing hull bounced off a tower's shaft.
 */

const NONE: SteeringInput = { steer: 0, source: 'none' };
const S = 150;
const SLOPE = 0.05;

type Ground = 'slope' | 'crest' | 'flank';

interface Pass {
  kind: ObstacleKind;
  /** Proxy part label of the tall body (default: the kind). */
  part?: string;
  /** Iceberg mass (t); its radius is Power Valley's melted iceberg (scale 2.2 at 220 t). */
  M: number;
  v: number;
  /** Lateral offset of the iceberg's line from the structure (m, + = right of travel). */
  d: number;
  ground: Ground;
  seconds?: number;
}

interface Outcome {
  result: ContactOutcome['result'] | 'untouched';
  testImpulse: number;
  breakImpulse: number;
  tilt: number;
  anchored: boolean;
  /** Top of the tall body relative to where its foot stood. */
  top: { x: number; z: number };
  height: number;
  /** Lowest a resting top section (turbine head) dropped (m), NaN if none. */
  deckDrop: number;
  /** Fastest any of its bodies moved (m/s) from 4 s after it broke (fallen, at rest or drifting). */
  lateFastest: number;
}

const _q = new Quaternion();
const _v = new Vector3();

/** A 6 m hill (radius 22 m, the level's hill profile) on a 0.05 slope, under or beside the structure. */
function heightFor(ground: Ground): (x: number, z: number) => number {
  const hx = ground === 'flank' ? 9 : 0;
  return (x, z) => {
    const base = 200 - SLOPE * z;
    if (ground === 'slope') return base;
    const q2 = ((x - hx) * (x - hx) + (z - S) * (z - S)) / (22 * 22);
    return base + (q2 < 1 ? 6 * (1 - q2) * (1 - q2) : 0);
  };
}

async function pass(p: Pass): Promise<Outcome> {
  const ice = p.M / 220;
  const t = createAnalyticTerrain({
    height: heightFor(p.ground),
    cellSize: 2,
    length: 400,
    width: 160,
    level: {
      obstacles: [{ kind: p.kind, s: S, d: 0 }],
      iceberg: { scale: 2.2 * (0.55 + 0.45 * ice), mass: p.M },
    },
  });
  const s = await GameSession.create({ level: t.level, terrain: t, skipIntro: true });
  const w = s.physics as PhysicsWorld;
  s.advance(200, NONE); // past the start grace
  const part = p.part ?? p.kind;
  const body = w.bodies.find((b) => b.kind === p.kind && b.part === part) as ObstacleBody;
  const decks = w.bodies.filter((b) => b.kind === p.kind && b.part === 'deck');
  const deckY = decks.map((b) => b.pos.y);
  const foot = { x: body.pos.x, z: body.pos.z };
  const out: Outcome = {
    result: 'untouched',
    testImpulse: 0,
    breakImpulse: body.breakImpulse,
    tilt: 0,
    anchored: true,
    top: { x: 0, z: 0 },
    height: body.localMax.y,
    deckDrop: NaN,
    lateFastest: 0,
  };
  let n = 0;
  let broke = -1;
  const apply = w.applyContact.bind(w);
  w.applyContact = (c: IcebergContact): ContactOutcome => {
    const r = apply(c);
    if (c.obstacleId === body.id) {
      out.testImpulse = Math.max(out.testImpulse, c.testImpulse ?? 0);
      if (out.result === 'untouched' || r.result === 'uprooted') out.result = r.result;
      if (r.result === 'uprooted' && broke < 0) broke = n;
    }
    return r;
  };
  const ib = s.iceberg;
  ib.pos.x = -p.d;
  ib.pos.z = S - 30;
  ib.pos.y = t.heightAt(ib.pos.x, ib.pos.z);
  ib.vel.x = 0;
  ib.vel.y = 0;
  ib.vel.z = p.v;
  ib.heading = dirToHeading(0, 1);
  ib.stuckTimer = 0;
  const mine = w.bodies.filter((b) => b.kind === p.kind);
  for (n = 0; n < (p.seconds ?? 10) / FIXED_DT && s.phase === 'playing'; n++) {
    s.update(FIXED_DT, NONE);
    if (broke < 0 || n < broke + 4 / FIXED_DT) continue;
    for (const b of mine) {
      if (!b.active) continue;
      out.lateFastest = Math.max(out.lateFastest, Math.hypot(b.proxy.vx, b.proxy.vy, b.proxy.vz));
    }
  }
  out.tilt = w.tiltOf(body.id);
  out.anchored = body.anchored;
  _q.set(body.quat.x, body.quat.y, body.quat.z, body.quat.w);
  _v.set(0, body.localMax.y, 0).applyQuaternion(_q);
  out.top = { x: body.pos.x + _v.x - foot.x, z: body.pos.z + _v.z - foot.z };
  if (decks.length > 0) out.deckDrop = Math.min(...decks.map((b, i) => deckY[i] - b.pos.y));
  s.dispose();
  console.log(
    `[topple] ${p.kind.padEnd(12)} ${p.ground.padEnd(5)} ${p.M} t @${p.v} line ${p.d} m off: ` +
      `${out.result} (test ${out.testImpulse.toFixed(0)}/${out.breakImpulse.toFixed(0)}), ` +
      `tilt ${out.tilt.toFixed(2)}, top ${out.top.x.toFixed(1)},${out.top.z.toFixed(1)}, ` +
      `head dropped ${out.deckDrop.toFixed(1)} m, then at most ${out.lateFastest.toFixed(1)} m/s`,
  );
  return out;
}

/** Broken and lying down, its top well out from its foot across (+x) and along (+z) the path. */
function expectFelled(o: Outcome, what: string): void {
  expect(o.result, what).toBe('uprooted');
  expect(o.anchored, what).toBe(false);
  expect(o.tilt, what).toBeGreaterThan(1);
  // The iceberg passes on the tower's -x side (line d m right of travel = -x), moving +z.
  expect(o.top.x + o.top.z, what).toBeGreaterThan(0.5 * o.height);
  expect(o.top.z, what).toBeGreaterThan(-0.2 * o.height);
  // The head (nacelle and rotor) came down with it (it may end up propped on a blade).
  if (!Number.isNaN(o.deckDrop)) expect(o.deckDrop, what).toBeGreaterThan(15);
}

describe('a released wind turbine comes down (was: it stood on, loose)', () => {
  const cases: [string, Pass][] = [
    ['220 t @6 on a 0.05 slope, line 1 m off (was: stood, tilt 0.10)', { kind: 'windTurbine', M: 220, v: 6,
      d: 1, ground: 'slope' }],
    ['220 t @6 on a 0.05 slope, line 3 m off (was: stood, tilt 0.34)', { kind: 'windTurbine', M: 220, v: 6,
      d: 3, ground: 'slope' }],
    ['220 t @14 on a hill crest, head-on (was: stood, tilt 0.05)', { kind: 'windTurbine', M: 220, v: 14,
      d: 0, ground: 'crest' }],
    ['220 t @14 on a hill crest, line 3 m off (was: stood, tilt 0.05)', { kind: 'windTurbine', M: 220, v: 14,
      d: 3, ground: 'crest' }],
    ['180 t @10 on a hill flank, line 2 m off (was: stood, tilt 0.35)', { kind: 'windTurbine', M: 180, v: 10,
      d: 2, ground: 'flank' }],
    ['130 t @14 on a hill flank, line 4 m off (was: stood, tilt 0.35)', { kind: 'windTurbine', M: 130, v: 14,
      d: 4, ground: 'flank' }],
  ];
  for (const [name, p] of cases) {
    it(name, async () => expectFelled(await pass(p), name));
  }
});

describe('a glancing blow from a much heavier iceberg fells it', () => {
  it('130 t @6, hull over the shaft (line 5 m off) (was: bounced off, test 714 < 750)', async () => {
    const o = await pass({ kind: 'windTurbine', M: 130, v: 6, d: 5, ground: 'slope' });
    expect(o.testImpulse).toBeGreaterThanOrEqual(o.breakImpulse);
    expectFelled(o, 'glancing 130 t @6');
  });

  it('220 t @10, the hull just over the pad edge (line 7.5 m off) fells it too', async () => {
    expectFelled(await pass({ kind: 'windTurbine', M: 220, v: 10, d: 7.5, ground: 'slope' }), 'graze 220 t');
  });
});

describe('a felled turbine lying in the river the iceberg laid stays down', () => {
  it('130 t @20, line 1 m off: its head drifts, never flung by the drag (was: 133 m/s)', async () => {
    // The river's drag acts at a body's bounding-box centre: for the rotor (35 m across, its
    // centre of mass at the hub) that point has a fraction of its mass, and the drag sized for
    // the whole mass overshot every step until head and tower were flung across the valley.
    const o = await pass({ kind: 'windTurbine', M: 130, v: 20, d: 1, ground: 'slope', seconds: 15 });
    expectFelled(o, 'felled into the river');
    expect(o.lateFastest).toBeLessThan(15);
  });
});

describe('a light or slow iceberg grazing a tower does not fell it', () => {
  // A 30 t iceberg needs 20 m/s head-on; a graze never counts for more than that.
  const cases: [number, number][] = [
    [12, 0],
    [12, 4],
    [18, 3],
  ];
  for (const [v, d] of cases) {
    it(`30 t @${v}, line ${d} m off: shaken, still standing`, async () => {
      const o = await pass({ kind: 'windTurbine', M: 30, v, d, ground: 'slope', seconds: 6 });
      expect(o.result).toBe('shook');
      expect(o.testImpulse).toBeLessThan(o.breakImpulse);
      expect(o.anchored).toBe(true);
      expect(o.tilt).toBeLessThan(0.01);
    });
  }
});

describe('other tall kinds come down too', () => {
  const cases: [string, Pass][] = [
    ['pylon on a hill flank, 130 t @14 head-on (was: stood, legs staked in the hillside)', { kind: 'pylon',
      M: 130, v: 14, d: 0, ground: 'flank' }],
    ['lighthouse grazed at its plinth edge, 220 t @6, line 7.5 m off', { kind: 'lighthouse', M: 220, v: 6,
      d: 7.5, ground: 'slope' }],
    ['church tower grazed, 220 t @14, line 6 m off', { kind: 'church', part: 'churchTower', M: 220, v: 14,
      d: 6, ground: 'slope' }],
    ['smokestack on a hill flank, 220 t @14, line 3 m off', { kind: 'smokestack', M: 220, v: 14, d: 3,
      ground: 'flank' }],
    ['ski-lift pylon on a hill flank, 130 t @14, line 2 m off', { kind: 'skiLiftPylon', part: 'pylon',
      M: 130, v: 14, d: 2, ground: 'flank' }],
  ];
  for (const [name, p] of cases) {
    it(name, async () => {
      const o = await pass(p);
      expect(o.result, name).toBe('uprooted');
      // Down: lying, or leaning far over on what it fell onto (the church tower on its nave).
      expect(o.tilt, name).toBeGreaterThan(0.75);
      expect(o.top.x + o.top.z, name).toBeGreaterThan(0.35 * o.height);
    });
  }
});
