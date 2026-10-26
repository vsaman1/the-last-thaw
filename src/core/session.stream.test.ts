import { describe, expect, it } from 'vitest';
import { FIXED_DT, GameSession } from './session';
import { dirToHeading } from './math';
import { level1 } from './levels/level1';
import type { PhysicsWorld } from './physics/world';
import { confiningStream } from './sim/iceberg';
import { createWaterSample, INLAND_FLOAT } from './sim/inlandWater';
import { streamSandbox, streamSandboxBig, streamSandboxOpen } from './testing/streamSandbox';
import type { GameEvent, LevelDef, SteeringInput } from './types';
import { RESERVOIR } from './water/tuning';

/**
 * Icebergs in streams, end to end (real physics, src/core/testing/streamSandbox.ts): a small iceberg
 * falls into the stream, is carried along and cannot leave it, floats down to the sea, or is held
 * against a dam or in a closed pool until the stuck rule ends the run; a big one rides out of the
 * stream at will (capturing it) and breaks the dam: the reservoir drains, the flood runs down the
 * stream over the breach and its rubble and sweeps a parked car away.
 */

const NONE: SteeringInput = { steer: 0, source: 'none' };
const steer = (v: number): SteeringInput => ({ steer: v, source: 'scripted' });

/** Teleport to (s, d) moving down-course at `speed` (on the water surface where it floats). */
function place(session: GameSession, s: number, d: number, speed: number): void {
  const t = session.terrain;
  const ice = session.iceberg;
  const w = t.course.toWorld(s, d);
  const c = t.course.sampleAt(s);
  const ws = createWaterSample();
  const wet = session.water?.sample(w.x, w.z, ws) ?? false;
  ice.pos.x = w.x;
  ice.pos.y = wet ? Math.max(ws.surfaceY, w.y) : w.y;
  ice.pos.z = w.z;
  ice.vel.x = c.dirX * speed;
  ice.vel.y = 0;
  ice.vel.z = c.dirZ * speed;
  ice.heading = dirToHeading(c.dirX, c.dirZ);
  ice.grounded = true;
  ice.stuckTimer = 0;
}

interface Track {
  session: GameSession;
  events: GameEvent[];
}

async function start(level: LevelDef): Promise<Track> {
  const session = await GameSession.create({ level, skipIntro: true });
  const events: GameEvent[] = [];
  session.events.on((e) => events.push(e));
  return { session, events };
}

const courseOf = (s: GameSession): { s: number; d: number } =>
  s.terrain.course.project(s.iceberg.pos.x, s.iceberg.pos.z);

describe('a small iceberg in the stream', () => {
  it('falls in from the spawn, floats, is carried along at the flow and cannot steer out', async () => {
    const water = { metres: 3000, turnMetresPerRadian: 10 };
    const level: LevelDef = { ...streamSandbox, id: 'stream-sandbox-melt', water };
    const { session } = await start(level);
    const ice = session.iceberg;
    const ws = createWaterSample();
    let afloatAt = -1;
    // (It falls in across the meltwater's diagonal run from the glacier and may touch the far bank
    // once: its ice is taken after two seconds afloat without a break.)
    let afloatFor = 0;
    let iceAtFloat = -1;
    for (let k = 0; k < 60 * 12; k++) {
      session.update(FIXED_DT, NONE);
      if (ice.afloat && afloatAt < 0) afloatAt = k * FIXED_DT;
      afloatFor = ice.afloat ? afloatFor + FIXED_DT : 0;
      if (afloatFor >= 2 && iceAtFloat < 0) iceAtFloat = ice.ice;
    }
    expect(afloatAt).toBeGreaterThan(0);
    expect(afloatAt).toBeLessThan(10);
    expect(iceAtFloat).toBeGreaterThan(0);
    expect(confiningStream(ice)).toBe(0);
    // Carried at about the stream's speed, on its surface.
    const speed = Math.hypot(ice.vel.x, ice.vel.z);
    expect(speed).toBeGreaterThan(3.5);
    expect(speed).toBeLessThan(7);
    expect(session.water!.sample(ice.pos.x, ice.pos.z, ws)).toBe(true);
    expect(ice.pos.y).toBeCloseTo(ws.surfaceY, 1);
    // Afloat it does not melt (the water carries it, it lays no river).
    expect(ice.ice).toBeCloseTo(iceAtFloat, 6);
    // Full right for 6 s: it crosses to the bank and slides along it, never out.
    const max = INLAND_FLOAT.confineShare * 7 - 0.5 * ice.radius;
    let widest = 0;
    for (let k = 0; k < 60 * 6; k++) {
      session.update(FIXED_DT, steer(1));
      session.water!.sample(ice.pos.x, ice.pos.z, ws);
      expect(ws.channel).toBe(true);
      widest = Math.max(widest, Math.abs(ws.lat));
    }
    expect(widest).toBeGreaterThan(max - 0.5);
    expect(widest).toBeLessThan(max + 0.3);
    expect(session.phase).toBe('playing');
    session.dispose();
  }, 120_000);

  it('rides the stream to the sea (no dam in the way)', async () => {
    const { session, events } = await start(streamSandboxOpen);
    let falls = 0;
    for (let k = 0; k < 60 * 400 && session.phase === 'playing'; k++) session.update(FIXED_DT, NONE);
    for (const e of events) if (e.type === 'landed' && e.drop > 3) falls++;
    console.log(
      `small iceberg down the open stream: ${session.phase} in ${session.stats.time.toFixed(1)} s, ` +
        `${session.stats.distance.toFixed(0)} m, falls ${falls}, ` +
        `waterfalls ${session.stats.waterfallsCrossed}`,
    );
    expect(session.phase).toBe('complete');
    // It went over the stream's waterfall (the cliff band at s 760).
    expect(falls).toBeGreaterThanOrEqual(1);
    session.dispose();
  }, 300_000);

  it('drifts across the reservoir and is held against the dam until stuck ends the run', async () => {
    const { session } = await start(streamSandbox);
    const res = session.water!.reservoirs[0];
    place(session, 540, 0, 3);
    let atDam = -1;
    let slowest = Infinity;
    for (let k = 0; k < 60 * 120 && session.phase === 'playing'; k++) {
      session.update(FIXED_DT, NONE);
      const p = courseOf(session);
      if (atDam < 0 && p.s > 590) atDam = session.stats.time;
      if (atDam < 0) slowest = Math.min(slowest, Math.hypot(session.iceberg.vel.x, session.iceberg.vel.z));
    }
    console.log(
      `small iceberg on the lake: reached the dam at ${atDam.toFixed(1)} s, ` +
        `${session.failReason} at ${session.stats.time.toFixed(1)} s`,
    );
    // Drifting, it never slowed to the afloat stuck speed; pinned against the dam it failed.
    expect(atDam).toBeGreaterThan(0);
    expect(slowest).toBeGreaterThan(INLAND_FLOAT.stuckSpeed);
    expect(res.broken).toBe(false);
    expect(session.failReason).toBe('stuck');
    expect(session.stats.time - atDam).toBeLessThan(25);
  }, 120_000);

  it('is carried into a closed pool and the run ends as stuck there (no soft lock)', async () => {
    const { session } = await start(streamSandbox);
    // The side stream: s 300 → 430 at d −26 → −30, ending in a still pool.
    place(session, 320, -26.6, 2);
    for (let k = 0; k < 60 * 90 && session.phase === 'playing'; k++) session.update(FIXED_DT, NONE);
    const p = courseOf(session);
    const when = session.stats.time.toFixed(1);
    console.log(`small iceberg in the pool stream: ${session.failReason} at ${when} s, s ${p.s.toFixed(0)}`);
    expect(session.failReason).toBe('stuck');
    expect(p.s).toBeGreaterThan(400);
    expect(session.stats.time).toBeLessThan(60);
  }, 120_000);

  it('floats in a cave spring pool like on other still water, and drifts out over its sill', async () => {
    const { session } = await start(streamSandbox);
    const ice = session.iceberg;
    const pool = session.water!.pools[0];
    // Dropped into the pool beside the spring (the side stream's source, s 290, d −36).
    place(session, 291, -34, 0.5);
    let afloatFor = 0;
    let fastest = 0;
    for (let k = 0; k < 60 * 6; k++) {
      session.update(FIXED_DT, NONE);
      afloatFor = ice.afloat ? afloatFor + FIXED_DT : 0;
      if (k > 60) fastest = Math.max(fastest, Math.hypot(ice.vel.x, ice.vel.z));
    }
    console.log(
      `small iceberg in the spring pool: afloat ${afloatFor.toFixed(1)} s, fastest ${fastest.toFixed(2)} m/s, ` +
        `base ${ice.pos.y.toFixed(2)} at level ${pool.level.toFixed(2)}`,
    );
    expect(afloatFor).toBeGreaterThan(4);
    expect(ice.pos.y).toBeCloseTo(pool.level, 0);
    // Still water: it glides, at most the pool's gentle drift plus what it came in with.
    expect(fastest).toBeLessThan(1.5);
    expect(session.phase).toBe('playing');
    // Left alone it drifts out over the sill and the side stream takes it (to its closed pool).
    for (let k = 0; k < 60 * 90 && session.phase === 'playing'; k++) session.update(FIXED_DT, NONE);
    const p = courseOf(session);
    console.log(`  ... then ${session.failReason} at ${session.stats.time.toFixed(1)} s, s ${p.s.toFixed(0)}`);
    expect(p.s).toBeGreaterThan(330);
  }, 120_000);
});

describe('a big iceberg', () => {
  it('rides out of the stream when steered and the stream follows its path', async () => {
    const { session } = await start(streamSandboxBig);
    const ice = session.iceberg;
    const ws = createWaterSample();
    for (let k = 0; k < 60 * 14; k++) session.update(FIXED_DT, NONE);
    // Riding the stream (too shallow to float it), held by nothing: left alone it follows it.
    expect(session.water!.sample(ice.pos.x, ice.pos.z, ws) && ws.channel).toBe(true);
    expect(confiningStream(ice)).toBe(-1);
    // The player steers right until it is out of the channel, then lets go.
    let steered = 0;
    while (steered < 240 && session.water!.sample(ice.pos.x, ice.pos.z, ws) && (ws.channel || ws.cut)) {
      session.update(FIXED_DT, steer(1));
      steered++;
    }
    console.log(`big iceberg steered out of the stream in ${(steered / 60).toFixed(2)} s`);
    expect(steered).toBeLessThan(240);
    for (let k = 0; k < 60 * 20; k++) session.update(FIXED_DT, NONE);
    expect(session.water!.sample(ice.pos.x, ice.pos.z, ws) && ws.channel).toBe(false);
    expect(session.phase).toBe('playing');
    const caps = session.water!.captures;
    expect(caps).toHaveLength(1);
    const st = session.water!.streams[caps[0].stream];
    expect(caps[0].reach.n).toBeGreaterThan(20);
    expect(caps[0].reach.qIn / st.q).toBeGreaterThan(0.8);
    const below = caps[0].junction + 10;
    expect((st.reach.A[below] * st.reach.u[below]) / st.q).toBeLessThan(0.2);
    session.dispose();
  }, 120_000);

  it('breaks the dam from the lake: the lake drains, the flood runs down over the rubble', async () => {
    const { session, events } = await start(streamSandboxBig);
    const world = session.physics as PhysicsWorld;
    const res = session.water!.reservoirs[0];
    const reach = session.water!.streams[0].reach;
    const car = world.bodies.find((b) => b.kind === 'car')!;
    const carAt = { ...car.pos };
    place(session, 578, 0, 6);
    let brokeAt = -1;
    let headAtTau = Infinity;
    let peakRise = 0;
    const c650 = (() => {
      let best = 0;
      for (let i = 0; i < reach.n; i++) {
        if (Math.abs(reach.z[i] - 650) < Math.abs(reach.z[best] - 650)) best = i;
      }
      return best;
    })();
    for (let k = 0; k < 60 * 40 && session.phase === 'playing'; k++) {
      session.update(FIXED_DT, NONE);
      const t = session.stats.time;
      if (brokeAt < 0 && res.broken) brokeAt = t;
      if (brokeAt >= 0 && t - brokeAt <= RESERVOIR.drainTau + 0.5) headAtTau = res.level - res.breachFloor;
      peakRise = Math.max(peakRise, reach.h[c650] - reach.steady[c650]);
    }
    const head0 = res.fullLevel - res.breachFloor;
    const blocks = world.bodies.filter((b) => b.kind === 'dam' && b.active && !b.anchored);
    const movedDown = blocks.filter((b) => b.pos.z > 600 + 8).length;
    const carMoved = Math.hypot(car.pos.x - carAt.x, car.pos.z - carAt.z);
    const p = courseOf(session);
    console.log(
      `big iceberg vs dam: broke at ${brokeAt.toFixed(1)} s (breach ${res.breachWidth} m), head after τ ` +
        `${((100 * headAtTau) / head0).toFixed(0)} %, flood rise at s 650 ${peakRise.toFixed(2)} m, ` +
        `${movedDown}/${blocks.length} blocks carried > 8 m below the dam, ` +
        `car moved ${carMoved.toFixed(1)} m ` +
        `(swept ${session.physics.stats.sweptByWater}), iceberg at s ${p.s.toFixed(0)}, ${session.phase}`,
    );
    expect(events.some((e) => e.type === 'obstacleBroken' && e.kind === 'dam')).toBe(true);
    expect(brokeAt).toBeGreaterThan(0);
    expect(headAtTau / head0).toBeLessThan(0.3);
    expect(peakRise).toBeGreaterThan(1.5);
    expect(movedDown).toBeGreaterThan(0);
    expect(carMoved).toBeGreaterThan(3);
    // Through the breach and on down the stream, over its waterfall (the cliff band at s 760).
    expect(p.s).toBeGreaterThan(780);
    expect(session.stats.waterfallsCrossed).toBe(1);
    expect(session.phase).toBe('playing');
    session.dispose();
  }, 180_000);

  it('floods the traffic below the dam: a driving car is released (the living world hook)', async () => {
    // A short street on the gorge floor below the dam, beside the stream, with a car driving on it.
    const level: LevelDef = {
      ...streamSandboxBig,
      id: 'stream-sandbox-traffic',
      features: [
        ...(streamSandboxBig.features ?? []),
        { type: 'street', points: [{ s: 612, d: 12 }, { s: 642, d: 12 }], width: 6 },
      ],
      obstacles: [{ kind: 'dam', s: 600, d: 0, span: 34 }, { kind: 'car', s: 620, d: 13.5, yaw: 0 }],
    };
    const { session } = await start(level);
    const world = session.physics as PhysicsWorld;
    const car = world.bodies.find((b) => b.kind === 'car')!;
    expect(car.driven).toBe(true);
    // Intact dam, spillway trickle: the car keeps driving.
    for (let k = 0; k < 60 * 3; k++) session.update(FIXED_DT, NONE);
    expect(car.driven).toBe(true);
    place(session, 578, 0, 6);
    let releasedAt = -1;
    let brokeAt = -1;
    for (let k = 0; k < 60 * 20 && releasedAt < 0; k++) {
      session.update(FIXED_DT, NONE);
      if (brokeAt < 0 && session.water!.reservoirs[0].broken) brokeAt = session.stats.time;
      if (!car.driven) releasedAt = session.stats.time;
    }
    console.log(`flooded car: dam broke at ${brokeAt.toFixed(1)} s, car released at ${releasedAt.toFixed(1)} s`);
    expect(brokeAt).toBeGreaterThan(0);
    expect(releasedAt).toBeGreaterThan(brokeAt);
    expect(releasedAt - brokeAt).toBeLessThan(6);
    session.dispose();
  }, 120_000);

  it('runs the same twice (deterministic)', async () => {
    const run = async (): Promise<number[]> => {
      const { session } = await start(streamSandboxBig);
      place(session, 578, 0, 6);
      for (let k = 0; k < 60 * 12; k++) session.update(FIXED_DT, k < 600 ? NONE : steer(0.6));
      const w = session.water!;
      const world = session.physics as PhysicsWorld;
      const out = [
        session.iceberg.pos.x,
        session.iceberg.pos.z,
        w.reservoirs[0].level,
        ...Array.from(w.streams[0].reach.A.slice(250, 320)),
        ...world.bodies.filter((b) => b.active).map((b) => b.pos.x + b.pos.z),
      ];
      session.dispose();
      return out;
    };
    expect(await run()).toEqual(await run());
  }, 180_000);
});

describe('levels without streams', () => {
  it('have no inland water (nothing changes for them)', async () => {
    const session = await GameSession.create({ level: level1, skipIntro: true });
    expect(session.water).toBeNull();
    session.dispose();
  });
});
