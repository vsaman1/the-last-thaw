import { describe, expect, it } from 'vitest';
import { createAnalyticTerrain, inclinedPlane } from '../testing/analyticTerrain';
import type { IcebergParams, IcebergState, Terrain } from '../types';
import { DEFAULT_ICEBERG_PARAMS as P, withWaterBudget } from './params';
import { createIceberg, isMelted, setIce, stepIceberg } from './iceberg';

const DT = 1 / 60;
/** 500 m of straight river per iceberg; every radian of turning costs another 40 m. */
const MELT: IcebergParams = { ...P, meltPerMetre: 1 / 500, meltPerRadian: 40 / 500 };
const DIST_ONLY: IcebergParams = { ...MELT, meltPerRadian: 0 };

interface StepInfo {
  /** Horizontal distance moved this step. */
  moved: number;
  /** |change of horizontal velocity direction| this step (rad). */
  turned: number;
  wasGrounded: boolean;
  wasInOcean: boolean;
  iceBefore: number;
}

/** Fixed-step loop like the session's, reporting what each step did. */
function drive(
  terrain: Terrain,
  params: IcebergParams,
  opts: {
    steps: number;
    steer?: (t: number) => number;
    iceberg?: IcebergState;
    until?: (s: IcebergState, distance: number) => boolean;
    onStep?: (s: IcebergState, info: StepInfo) => void;
  },
): { s: IcebergState; distance: number } {
  const s = opts.iceberg ?? createIceberg(terrain, params);
  let distance = 0;
  for (let i = 0; i < opts.steps; i++) {
    if (opts.until?.(s, distance)) break;
    const t = i * DT;
    const x0 = s.pos.x;
    const z0 = s.pos.z;
    const vx0 = s.vel.x;
    const vz0 = s.vel.z;
    const info = { wasGrounded: s.grounded, wasInOcean: s.inOcean, iceBefore: s.ice, moved: 0, turned: 0 };
    stepIceberg(s, { steer: opts.steer?.(t) ?? 0, source: 'scripted' }, terrain, DT, params, t);
    info.moved = Math.hypot(s.pos.x - x0, s.pos.z - z0);
    info.turned = Math.abs(Math.atan2(vx0 * s.vel.z - vz0 * s.vel.x, vx0 * s.vel.x + vz0 * s.vel.z));
    distance += info.moved;
    opts.onStep?.(s, info);
  }
  return { s, distance };
}

const slope = (): Terrain =>
  createAnalyticTerrain({ height: inclinedPlane(0.1, 100), length: 600, width: 200, cellSize: 2 });

describe('melt: the river is the iceberg’s meltwater', () => {
  it('drains ice in proportion to the horizontal distance laid on land', () => {
    const terrain = slope();
    let at60 = { ice: 0, d: 0 };
    let total = 0;
    const { s, distance } = drive(terrain, DIST_ONLY, {
      steps: 60 * 15,
      onStep: (st, info) => {
        total += info.moved;
        if (Math.abs(total - 60) < 0.5 && at60.d === 0) at60 = { ice: st.ice, d: total };
      },
    });
    expect(distance).toBeGreaterThan(100);
    expect(1 - s.ice).toBeCloseTo(distance / 500, 9);
    expect(1 - at60.ice).toBeCloseTo(at60.d / 500, 9);
    // A straight run down the fall line has (practically) no turning to pay for.
    const both = drive(terrain, MELT, { steps: 60 * 15 });
    expect(1 - both.s.ice).toBeCloseTo(both.distance / 500, 6);
  });

  it('a winding route drains clearly more than a straight one of equal length', () => {
    const terrain = slope();
    // A big budget so neither run melts away and the comparison is not clamped at 0 ice.
    const wind: IcebergParams = { ...P, meltPerMetre: 1 / 2000, meltPerRadian: 40 / 2000 };
    const L = 150;
    const until = (_s: IcebergState, d: number): boolean => d >= L;
    const straight = drive(terrain, wind, { steps: 3000, until });
    let turned = 0;
    let moved = 0;
    const weave = (t: number): number => 0.7 * Math.sin((2 * Math.PI * t) / 2.5);
    const winding = drive(terrain, wind, {
      steps: 3000,
      until,
      steer: weave,
      onStep: (_s, info) => {
        moved += info.moved;
        turned += info.turned;
      },
    });
    expect(straight.distance).toBeGreaterThanOrEqual(L);
    expect(winding.distance).toBeGreaterThanOrEqual(L);
    expect(turned).toBeGreaterThan(3);
    const drainStraight = 1 - straight.s.ice;
    const drainWinding = 1 - winding.s.ice;
    expect(drainWinding).toBeGreaterThan(1.5 * drainStraight);
    // Exactly the specified budget: metres travelled plus net turning, nothing else.
    expect(drainWinding).toBeCloseTo(moved * wind.meltPerMetre + turned * wind.meltPerRadian, 6);
  });

  it('ignores direction noise of an iceberg slower than ~0.5 m/s', () => {
    const terrain = createAnalyticTerrain({ height: () => 10 });
    const s = createIceberg(terrain, MELT);
    s.vel.x = 0.3;
    s.vel.z = 0;
    // Steering at a crawl shoves the hull sideways, swinging the (tiny) velocity direction around.
    let turned = 0;
    let moved = 0;
    drive(terrain, MELT, {
      steps: 60,
      iceberg: s,
      steer: () => 1,
      until: (st) => Math.hypot(st.vel.x, st.vel.z) > 0.45,
      onStep: (_st, info) => {
        turned += info.turned;
        moved += info.moved;
      },
    });
    expect(1 - s.ice).toBeCloseTo(moved * MELT.meltPerMetre, 9);
    expect(turned).toBeGreaterThan(0);
  });

  it('does not drain while airborne over a cliff', () => {
    const terrain = createAnalyticTerrain({
      height: (_x, z) => 60 - 0.08 * z - (z >= 120 ? 15 : 0),
      length: 300,
    });
    let airSteps = 0;
    let landDrain = 0;
    drive(terrain, MELT, {
      steps: 60 * 20,
      steer: (t) => 0.3 * Math.sin(t),
      onStep: (st, info) => {
        if (!info.wasGrounded && !st.grounded) {
          airSteps++;
          expect(st.ice).toBe(info.iceBefore);
        } else if (info.wasGrounded && st.grounded) {
          landDrain += info.iceBefore - st.ice;
        }
      },
    });
    expect(airSteps).toBeGreaterThan(10);
    expect(landDrain).toBeGreaterThan(0.1);
  });

  it('does not drain in the ocean, however the iceberg is steered', () => {
    const sea = createAnalyticTerrain({ height: () => -5, seaLevel: 0 });
    const s = createIceberg(sea, MELT);
    expect(s.inOcean).toBe(true);
    s.vel.z = 10;
    drive(sea, MELT, { steps: 180, iceberg: s, steer: (t) => (Math.floor(t / 0.5) % 2 ? 1 : -1) });
    expect(s.pos.z).toBeGreaterThan(20);
    expect(s.ice).toBe(1);

    // Slide off a beach: land drains, then the ice level freezes once afloat.
    const beach = createAnalyticTerrain({ height: inclinedPlane(0.12, 6), seaLevel: 0 });
    let iceAtSea = -1;
    const run = drive(beach, MELT, {
      steps: 60 * 20,
      steer: (t) => 0.5 * Math.sin(t * 3),
      onStep: (_st, info) => {
        if (info.wasInOcean && iceAtSea < 0) iceAtSea = info.iceBefore;
      },
    });
    expect(run.s.inOcean).toBe(true);
    expect(iceAtSea).toBeGreaterThan(0);
    expect(iceAtSea).toBeLessThan(1);
    expect(run.s.ice).toBe(iceAtSea);
  });

  it('size and collision radius follow the ice left', () => {
    const terrain = slope();
    let lastRadius = Infinity;
    const { s } = drive(terrain, { ...MELT, meltPerMetre: 1 / 120 }, {
      steps: 60 * 30,
      until: (st) => st.ice < 0.4,
      onStep: (st) => {
        expect(st.size).toBeCloseTo(P.minSize + (1 - P.minSize) * st.ice, 12);
        expect(st.radius).toBeCloseTo(P.radius * st.size, 12);
        expect(st.radius).toBeLessThanOrEqual(lastRadius);
        lastRadius = st.radius;
      },
    });
    expect(s.ice).toBeLessThan(0.4);
    expect(s.radius).toBeLessThan(0.75 * P.radius);

    // Ice set from outside (tools, tests) is reflected immediately, and kept by the step.
    setIce(s, 0.5, P);
    expect(s.size).toBeCloseTo(P.minSize + (1 - P.minSize) * 0.5, 12);
    stepIceberg(s, { steer: 0, source: 'none' }, terrain, DT, P, 10);
    expect(s.ice).toBe(0.5);
    expect(s.radius).toBeCloseTo(P.radius * (P.minSize + (1 - P.minSize) * 0.5), 12);
    // Above 1 the iceberg has grown (absorbed glacier ice): capped at maxIce, size = cbrt(ice).
    setIce(s, 7, P);
    expect(s.ice).toBe(P.maxIce);
    expect(s.radius).toBeCloseTo(P.radius * Math.cbrt(P.maxIce), 12);
  });

  it('melts away at 0 ice: clamps there, shrinks to minSize, isMelted', () => {
    const terrain = slope();
    const fast: IcebergParams = { ...MELT, meltPerMetre: 1 / 25 };
    const s = createIceberg(terrain, fast);
    expect(isMelted(s)).toBe(false);
    let meltedAt = -1;
    drive(terrain, fast, {
      steps: 60 * 15,
      iceberg: s,
      onStep: (st) => {
        expect(st.ice).toBeGreaterThanOrEqual(0);
        if (meltedAt < 0 && isMelted(st)) meltedAt = st.pos.z;
      },
    });
    expect(s.ice).toBe(0);
    expect(isMelted(s)).toBe(true);
    expect(s.size).toBeCloseTo(P.minSize, 12);
    expect(s.radius).toBeCloseTo(P.radius * P.minSize, 12);
    expect(meltedAt - terrain.level.startS).toBeGreaterThan(24);
    expect(meltedAt - terrain.level.startS).toBeLessThan(27);
  });

  it('with no melt rates the iceberg never shrinks (default params)', () => {
    const terrain = slope();
    const zig = (t: number): number => (Math.floor(t / 0.4) % 2 === 0 ? 1 : -1);
    const { s } = drive(terrain, P, { steps: 60 * 20, steer: zig });
    expect(s.ice).toBe(1);
    expect(s.size).toBe(1);
    expect(s.radius).toBe(P.radius);
  });
});

describe('withWaterBudget', () => {
  it('turns a level budget into melt rates and leaves explicit rates alone', () => {
    const water = { metres: 800, turnMetresPerRadian: 20 };
    const p = withWaterBudget(P, water);
    expect(p.meltPerMetre).toBeCloseTo(1 / 800, 15);
    expect(p.meltPerRadian).toBeCloseTo(20 / 800, 15);
    expect(p.radius).toBe(P.radius);
    expect(withWaterBudget(P, undefined)).toBe(P);
    expect(withWaterBudget(P, { ...water, metres: 0 })).toBe(P);
    const own = { ...P, meltPerMetre: 0.01 };
    expect(withWaterBudget(own, water)).toBe(own);
  });
});
