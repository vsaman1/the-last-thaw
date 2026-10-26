import { describe, expect, it } from 'vitest';
import { bridgePlan, bridgePlans, placementFrame, type BridgePlan } from '../obstacles/bridges';
import { deckTopAt, type DeckPlan } from '../obstacles/structures/deck';
import { createAnalyticTerrain } from '../testing/analyticTerrain';
import { LEVELS } from '../levels';
import { ravineRun } from '../levels/ravineRun';
import { getTerrain } from '../session';
import type { ObstaclePlacement, Terrain, TerrainFeature } from '../types';
import { BRIDGE_CUT, cutBridgeApproaches } from './bridgeCuts';
import { createTerrain } from './terrain';

/**
 * Bridge approach cuttings (./bridgeCuts.ts). Analytic terrain: a 0.05 slope along +z (s = z,
 * d = -x) with a 20 m gorge across it at s 200 (turned `deg` from square to the road), a knoll on
 * its upstream rim beside the road that rises above the deck line under the abutment, and a cross
 * slope that leaves the approach off the deck's grade behind the abutments.
 */

const GORGE_DEPTH = 14;
const KNOLL = 1.2;
const across = (deg: number, x: number, z: number): number => {
  const a = (deg * Math.PI) / 180;
  return Math.abs((z - 200) * Math.cos(a) - x * Math.sin(a));
};
const knoll = (x: number, z: number): number => KNOLL * Math.max(0, 1 - Math.hypot(x - 4, z - 186) / 6);
const heightOf = (deg = 0, withKnoll = true, cross = 0, fall = 0.8) => (x: number, z: number): number => {
  const q = across(deg, x, z);
  const cut = q <= 10 ? GORGE_DEPTH : q < 11 ? GORGE_DEPTH * (11 - q) : 0;
  // A rim lower downstream: the deck runs at a grade the plain slope behind it does not follow.
  const drop = z > 205 ? fall : 0;
  return 60 - 0.05 * z - cut - drop + (withKnoll ? knoll(x, z) : 0) + cross * x;
};
const BRIDGE: ObstaclePlacement = { kind: 'roadBridge', s: 200, d: 0, yaw: Math.PI / 2, span: 34 };

const terrainWith = (
  height: (x: number, z: number) => number,
  obstacles: ObstaclePlacement[] = [BRIDGE],
  features: TerrainFeature[] = [],
): Terrain =>
  createAnalyticTerrain({
    height,
    halfWidth: 60,
    width: 200,
    length: 420,
    cellSize: 1,
    level: { obstacles, features, theme: 'town' },
  });

/** Cut `t` in place; the graded terrain (with its bridgeCutAt) or null when nothing moved. */
function graded(t: Terrain): Terrain | null {
  const c = cutBridgeApproaches(t);
  return c ? { ...t, bridgeCutAt: c.at } : null;
}

/** Highest the ground stands above the running surface over the carriageway, end to end. */
function worstAbove(t: Terrain, b: BridgePlan): number {
  const f = placementFrame(t, t.level.obstacles[b.index], b.index)!;
  let worst = -Infinity;
  for (let x = b.plan.x0 - b.spec.back; x <= b.plan.x1 + b.spec.back; x += 0.25) {
    for (let z = -4.6; z <= 4.6; z += 0.46) worst = Math.max(worst, f.ctx.groundAt(x, z) - deckTopAt(b.plan, x));
  }
  return worst;
}

/** Every number of a deck plan, flattened (supports, their banks, the measured rims). */
const numbers = (p: DeckPlan): number[] => [
  p.x0,
  p.x1,
  p.top0,
  p.top1,
  ...p.rimSkew,
  ...p.rimOver,
  ...p.supports.flatMap((s) => [s.x, s.skew, ...(s.bank ?? []).flat()]),
];
function expectSamePlan(a: BridgePlan, b: BridgePlan): void {
  expect(b.mode).toBe(a.mode);
  expect(b.plan.supports.map((s) => s.type)).toEqual(a.plan.supports.map((s) => s.type));
  const na = numbers(a.plan);
  const nb = numbers(b.plan);
  expect(nb).toHaveLength(na.length);
  na.forEach((v, i) => expect(Math.abs(nb[i] - v)).toBeLessThan(1e-9));
}

describe('bridge approach cuttings', () => {
  it('grade a knoll under the abutment down to the road, and the plan is exactly the one cut against', () => {
    const before = terrainWith(heightOf());
    const b0 = bridgePlans(before)[0];
    expect(worstAbove(before, b0)).toBeGreaterThan(0.5);

    const t = graded(terrainWith(heightOf()))!;
    expect(t).not.toBeNull();
    const b = bridgePlans(t)[0];
    expect(b.plan.mode).toBe('rims');
    expectSamePlan(b0, b);
    // Over the whole carriageway, abutments included, the ground lies the lift under the road.
    expect(worstAbove(t, b)).toBeLessThan(-0.03);
    // Grading twice would plan on graded ground: refused.
    expect(() => cutBridgeApproaches(t)).toThrow();
    // Only the footprint is touched: the knoll's far side, the gorge and the approach further up.
    expect(t.heightAt(-12, 186)).toBeCloseTo(before.heightAt(-12, 186), 5);
    expect(t.heightAt(0, 200)).toBeCloseTo(before.heightAt(0, 200), 5);
    expect(t.heightAt(0, 150)).toBeCloseTo(before.heightAt(0, 150), 5);
  });

  it('a skewed crossing on a grade keeps its plan too: tops, supports, skews and banks', () => {
    for (const deg of [20, 37]) {
      const raw = terrainWith(heightOf(deg, true, 0.02));
      const b0 = bridgePlan(raw, BRIDGE, 0)!;
      expect(b0.plan.supports[0].skew).not.toBe(0);
      expect(Math.abs(b0.grade)).toBeGreaterThan(0.01);
      const t = graded(terrainWith(heightOf(deg, true, 0.02)))!;
      expect(t).not.toBeNull();
      expectSamePlan(b0, bridgePlan(t, BRIDGE, 0)!);
      expect(worstAbove(t, bridgePlan(t, BRIDGE, 0)!)).toBeLessThan(-0.03);
    }
  });

  it('makes the approach up to the abutment: no step over 5 cm at either back face, across the road', () => {
    const t = graded(terrainWith(heightOf(0, false, 0.03)))!;
    expect(t).not.toBeNull();
    const b = bridgePlans(t)[0];
    const f = placementFrame(t, t.level.obstacles[b.index], b.index)!;
    for (const x of [b.plan.x0 - b.spec.back - 0.05, b.plan.x1 + b.spec.back + 0.05]) {
      // The abutment's top, carried at the deck's grade to its back face, against the road behind.
      const top = deckTopAt(b.plan, x);
      for (let z = -4.6; z <= 4.6; z += 0.46) {
        expect(Math.abs(top - f.ctx.groundAt(x, z))).toBeLessThan(0.05);
      }
    }
  });

  it('cuts nothing where the bank already lies under the road and the approach follows it', () => {
    expect(cutBridgeApproaches(terrainWith(heightOf(0, false, 0, 0)))).toBeNull();
  });

  it('never touches a take-off (a crestable mound) or a footbridge', () => {
    // A 2 m mound ridge across the road on the upstream rim, its crest above the deck line.
    const mound: TerrainFeature = {
      type: 'ridge',
      points: [{ s: 188, d: -20 }, { s: 188, d: 20 }],
      width: 8,
      height: 2,
      profile: 'mound',
    };
    const bump = (x: number, z: number): number => heightOf(0, false)(x, z) + 2 * Math.max(0, 1 - Math.abs(z - 188) / 4);
    const before = terrainWith(bump, [BRIDGE], [mound]);
    const t = terrainWith(bump, [BRIDGE], [mound]);
    cutBridgeApproaches(t);
    for (let x = -6; x <= 6; x += 1) {
      for (let z = 184; z <= 192; z += 1) expect(t.heightAt(x, z)).toBe(before.heightAt(x, z));
    }
    // A footbridge over the knoll's rim cuts nothing.
    const foot: ObstaclePlacement = { ...BRIDGE, kind: 'footbridge' };
    expect(cutBridgeApproaches(terrainWith(heightOf(), [foot]))).toBeNull();
  });

  it(`never moves the ground more than ${BRIDGE_CUT.maxDepth} m (x scale)`, () => {
    // A bridge whose end runs into a hillside 9 m above its deck line.
    const hill = (x: number, z: number): number => heightOf(0, false)(x, z) + (x < -4 && z < 192 ? 9 : 0);
    const before = terrainWith(hill);
    const t = terrainWith(hill);
    const c = cutBridgeApproaches(t)!;
    expect(c.deepest).toBeLessThanOrEqual(BRIDGE_CUT.maxDepth + 1e-4);
    expect(c.highest).toBeLessThanOrEqual(BRIDGE_CUT.maxDepth + 1e-4);
    let most = 0;
    for (let k = 0; k < t.grid.heights.length; k++) most = Math.max(most, before.grid.heights[k] - t.grid.heights[k]);
    expect(most).toBeCloseTo(BRIDGE_CUT.maxDepth, 3);
  });
});

/**
 * Per level, the most (m) the grading may lower and raise the ground, a little over what it does
 * (measured: Alpine Pass 4.84 / 0.31 — the 4.84 m is one vertex of the rock wall a grid cell
 * outside the deck's edge by the x0 rim, s 529 d 172; Riverside Town 0.66 / 0.43; Power Valley
 * 0.73 / 0.21; Highland Maze 0.39 / 0.41 — the raising is the made-up approach behind an abutment).
 * Levels without road bridges grade nothing.
 */
const GRADED: Readonly<Record<string, { down: number; up: number }>> = {
  'alpine-pass': { down: 4.9, up: 0.35 },
  'riverside-town': { down: 0.7, up: 0.45 },
  'power-valley': { down: 0.8, up: 0.25 },
  'highland-maze': { down: 0.45, up: 0.45 },
};

describe('bridge approach cuttings on every level', () => {
  it('leave every deck plan exactly as planned on the ungraded ground; grade within bounds', () => {
    for (const level of LEVELS) {
      const raw = createTerrain(level, { bridgeCuts: false });
      const t = getTerrain(level);
      const a = bridgePlans(raw);
      const b = bridgePlans(t);
      expect(b.map((x) => x.index)).toEqual(a.map((x) => x.index));
      a.forEach((p, i) => {
        expectSamePlan(p, b[i]);
        expect(Math.abs(b[i].skew - p.skew)).toBeLessThan(1e-9);
      });
      let down = 0;
      let up = 0;
      for (let k = 0; k < t.grid.heights.length; k++) {
        const d = raw.grid.heights[k] - t.grid.heights[k];
        down = Math.max(down, d);
        up = Math.max(up, -d);
      }
      console.log(`[bridge cuts] ${level.id}: lowered at most ${down.toFixed(2)} m, raised ${up.toFixed(2)} m`);
      const bound = GRADED[level.id] ?? { down: 0, up: 0 };
      expect(down, level.id).toBeLessThanOrEqual(bound.down);
      expect(up, level.id).toBeLessThanOrEqual(bound.up);
      for (const p of b) {
        if (p.kind !== 'roadBridge') continue;
        expect(down, level.id).toBeLessThanOrEqual(BRIDGE_CUT.maxDepth * p.scale);
        // No ground on the road anywhere between the abutments' back faces.
        expect(worstAbove(t, p), level.id).toBeLessThan(-0.03);
        // The road behind each back face meets the abutment's top within 5 cm, across the road.
        const f = placementFrame(t, level.obstacles[p.index], p.index)!;
        for (const x of [p.plan.x0 - p.spec.back - 0.05, p.plan.x1 + p.spec.back + 0.05]) {
          for (let z = -4.6; z <= 4.6; z += 0.46) {
            const step = (deckTopAt(p.plan, x) - f.ctx.groundAt(x, z)) * p.scale;
            expect(Math.abs(step), `${level.id} #${p.index} step at x ${x.toFixed(1)} z ${z.toFixed(1)}`)
              .toBeLessThan(0.05);
          }
        }
      }
    }
  }, 240_000);

  it('never lowers a take-off (Ravine Run: every lip and kicker as the level made it)', () => {
    const raw = createTerrain(ravineRun, { bridgeCuts: false });
    const t = getTerrain(ravineRun);
    expect(Array.from(t.grid.heights)).toEqual(Array.from(raw.grid.heights));
  });
});
