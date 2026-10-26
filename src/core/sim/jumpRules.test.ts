import { describe, expect, it } from 'vitest';
import { createTerrain, type GeneratedTerrain } from '../terrain/terrain';
import { FELL_DEPTH } from '../fall';
import type { CliffDef, CoursePoint, LevelDef, TerrainFeature } from '../types';
import { createIceberg, stepIceberg } from './iceberg';
import { DEFAULT_ICEBERG_PARAMS as P } from './params';

/**
 * The jump rules of thumb in docs/LEVEL_AUTHORING.md ("Fatal ravines"), measured in the sim: a fatal
 * ravine W m wide across a straight 0.13 slope (s = z, cellSize 2.5, the open-level grid), crossed
 * straight down the fall line from 40 m before its edge.
 * - On a uniform slope the iceberg leaves the edge along the slope and the far rim lies on that
 *   take-off plane, so it cannot be cleared (the old guide's v² > g·W / (2·slope) was wrong). Only
 *   the grid's rounded edges let narrow ones (≤ 10 m) be hopped at 20–25 m/s.
 * - Off a drop (the far rim `drop` m below the take-off plane): v > W·sqrt(g / (2·drop)), measured
 *   within −1.2 … +1.6 m/s of it (the slope cancels out; the old rule counted it).
 * - Over a crest (the slope steepens by Δs at the edge, the far rim Δs·W below the plane) the same
 *   formula with Δh = Δs·W is optimistic: the iceberg needs 1.25–1.7× that speed to leave the crest.
 */

const SLOPE = 0.13;
const EDGE = 300;

function level(id: string, course: CoursePoint[], cliffs: CliffDef[], width: number): LevelDef {
  const ravine: TerrainFeature = {
    type: 'ravine',
    points: [
      { s: EDGE + width / 2, d: -60 },
      { s: EDGE + width / 2, d: 60 },
    ],
    width,
    depth: 10,
  };
  return {
    id,
    index: 0,
    name: 'jump rules',
    subtitle: '',
    seed: 3,
    bounds: { minX: -110, maxX: 110, minZ: -60, maxZ: 760 },
    cellSize: 2.5,
    seaLevel: 0,
    course,
    cliffs,
    wallHeight: 20,
    wallRamp: 20,
    startS: 20,
    coastS: 700,
    finishS: 720,
    features: [ravine],
    obstacles: [],
    decor: { sceneryTreeDensity: 0, bushDensity: 0, grassTuftDensity: 0, pebbleDensity: 0 },
  };
}

/** A straight 0.13 slope; with `kink`, steeper by `kink` from the ravine's near edge on. */
function slopeLevel(width: number, kink = 0, drop = 0): LevelDef {
  const top = 200;
  const course: CoursePoint[] = [
    { x: 0, z: 0, floor: top, halfWidth: 40 },
    { x: 0, z: EDGE, floor: top - SLOPE * EDGE, halfWidth: 40 },
    { x: 0, z: 750, floor: top - SLOPE * 750 - kink * (750 - EDGE), halfWidth: 40 },
  ];
  const cliffs = drop > 0 ? [{ s: EDGE, drop }] : [];
  return level(`jump-rules-${width}-${kink}-${drop}`, course, cliffs, width);
}

/** Does an iceberg sent straight down the slope at `speed` (40 m before the edge) get across? */
function clears(t: GeneratedTerrain, speed: number): boolean {
  const ice = createIceberg(t, P);
  const w = t.course.toWorld(EDGE - 40, 0);
  ice.pos.x = w.x;
  ice.pos.y = w.y;
  ice.pos.z = w.z;
  ice.vel.x = 0;
  ice.vel.z = speed;
  ice.heading = 0;
  for (let i = 0; i < 8 * 60; i++) {
    stepIceberg(ice, { steer: 0, source: 'none' }, t, 1 / 60, P, 100 + i / 60);
    if (ice.grounded && (t.ravineDepthAt?.(ice.pos.x, ice.pos.z) ?? 0) >= FELL_DEPTH) return false;
    if (ice.pos.z > EDGE + 80) return true;
  }
  return ice.pos.z > EDGE + 40;
}

/** Slowest approach speed (m/s, 40 m before the edge) that clears; Infinity if 34 m/s does not. */
function minSpeed(t: GeneratedTerrain): number {
  if (!clears(t, P.maxSpeed)) return Infinity;
  let lo = 2;
  let hi = P.maxSpeed;
  for (let k = 0; k < 9; k++) {
    const mid = 0.5 * (lo + hi);
    if (clears(t, mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

describe('jump rules of thumb (docs/LEVEL_AUTHORING.md)', () => {
  it('a ravine on a uniform slope cannot be cleared without a kicker, crest or drop', () => {
    // Measured: 12, 16 and 20 m never (34 m/s cap); 6 / 8 / 10 m hop at 24.6 / 22.0 / 20.0 m/s
    // because the grid rounds both edges (at cellSize 2: 14–21 m/s up to 10 m, 30–33 from 12 m).
    for (const w of [12, 16, 20]) expect(minSpeed(createTerrain(slopeLevel(w))), `${w} m`).toBe(Infinity);
    for (const w of [6, 10]) expect(minSpeed(createTerrain(slopeLevel(w))), `${w} m`).toBeGreaterThan(18);
  });

  it('off a drop: v > W·sqrt(g / (2·drop)) (the slope cancels out)', () => {
    // Measured 13.6 / 6.0 / 18.5 m/s; the rule says 12.5 / 6.4 / 18.1 (the old one 11.2 / 6.1 / 15.1).
    for (const [w, drop] of [
      [16, 8],
      [10, 12],
      [20, 6],
    ]) {
      const v = minSpeed(createTerrain(slopeLevel(w, 0, drop)));
      const rule = w * Math.sqrt(9.81 / (2 * drop));
      expect(v, `${w} m under ${drop} m`).toBeGreaterThan(rule - 1.5);
      expect(v, `${w} m under ${drop} m`).toBeLessThan(rule + 2);
    }
  });

  it('over a crest it needs 1.25–1.7× what the same formula gives for Δh = Δs·W', () => {
    // Measured 16.0 m/s (rule 12.8) for 10 m over +0.3, 21.4 (12.5) for 16 m over +0.5.
    for (const [w, kink] of [
      [10, 0.3],
      [16, 0.5],
    ]) {
      const v = minSpeed(createTerrain(slopeLevel(w, kink)));
      const rule = w * Math.sqrt(9.81 / (2 * kink * w));
      expect(v, `${w} m, +${kink}`).toBeGreaterThan(1.15 * rule);
      expect(v, `${w} m, +${kink}`).toBeLessThan(1.8 * rule);
    }
  });
});
