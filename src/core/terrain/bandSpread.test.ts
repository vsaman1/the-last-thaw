import { describe, expect, it } from 'vitest';
import type { CliffDef, LevelDef } from '../types';
import { createTerrain, type GeneratedTerrain } from './terrain';
import { levelWarnings } from './validate';

/**
 * A cliff band's spread zone (the Glacier Avalanche and Alpine Pass reports): by default, beyond
 * 22.5 m from its ends the drop is spread over 90 m along s across the whole rest of the floor, so
 * every branch gets +1.5·drop/90; CliffDef.spreadSlope confines that far-field steepening.
 */

const level = (band: CliffDef): LevelDef => ({
  id: `band-spread-${JSON.stringify(band)}`,
  index: 0,
  name: 'band spread',
  subtitle: '',
  seed: 8,
  bounds: { minX: -220, maxX: 220, minZ: -100, maxZ: 1000 },
  cellSize: 2.5,
  seaLevel: 0,
  course: [
    { x: 0, z: 0, floor: 130, halfWidth: 50 },
    { x: 0, z: 60, floor: 122, halfWidth: 180 },
    { x: 0, z: 980, floor: 2, halfWidth: 180 },
  ],
  cliffs: [band],
  wallHeight: 30,
  wallRamp: 25,
  startS: 30,
  coastS: 940,
  finishS: 960,
  features: [{ type: 'ramp', s: 462, d: 90, width: 14, length: 14, height: 3.5 }],
  obstacles: [],
  decor: { sceneryTreeDensity: 0, bushDensity: 0, grassTuftDensity: 0, pebbleDensity: 0 },
});

/** Steepest extra slope (over the course's 0.13) of the designed floor along s at offset d. */
function extraSlope(t: GeneratedTerrain, d: number, s0 = 150, s1 = 850): number {
  let worst = 0;
  for (let s = s0; s < s1; s += 2) {
    const k = (t.course.floorAtD(s, d) - t.course.floorAtD(s + 2, d)) / 2 - 0.13;
    worst = Math.max(worst, k);
  }
  return worst;
}

describe('cliff band spread zone', () => {
  const band: CliffDef = { s: 450, drop: 12, d: -80, width: 60 };
  const plain = createTerrain(level(band));
  const confined = createTerrain(level({ ...band, spreadSlope: 0.05 }));

  it('by default steepens every branch beyond 22.5 m from its ends by 1.5 · drop / 90', () => {
    for (const d of [10, 90, 160]) expect(extraSlope(plain, d)).toBeCloseTo(0.2, 1);
    const warned = levelWarnings(plain).some((w) => /spread slope .* 0\.(19|2\d) steeper/.test(w.problem));
    expect(warned).toBe(true);
  });

  it('with spreadSlope, keeps the far branches within it and the ride round its ends as before', () => {
    // 50 m beyond the end (d 0): spread over 200 m, +0.09; 110 m beyond (d 60): 0.05.
    expect(extraSlope(confined, 0)).toBeLessThan(0.1);
    for (const d of [60, 90, 160]) expect(extraSlope(confined, d)).toBeLessThan(0.052);
    // Near the end nothing changes (the slope to ride round), and the ground below is 12 m lower.
    for (const d of [-45, -40]) expect(extraSlope(confined, d)).toBeCloseTo(extraSlope(plain, d), 3);
    for (const d of [-80, 0, 160]) {
      const drop = confined.course.floorAtD(200, d) - confined.course.floorAtD(800, d);
      expect(drop).toBeCloseTo(plain.course.floorAtD(200, d) - plain.course.floorAtD(800, d), 3);
    }
    expect(levelWarnings(confined).some((w) => /spread slope/.test(w.problem))).toBe(true);
    const w = levelWarnings(confined).find((x) => /spread slope/.test(x.problem))!.problem;
    expect(Number(/up to ([\d.]+) steeper/.exec(w)![1])).toBeLessThan(0.06);
  });
});
