import { describe, expect, it } from 'vitest';
import type { LevelDef, ObstaclePlacement, TerrainFeature } from '../types';
import { createTerrain, type GeneratedTerrain } from './terrain';
import { featureContains, featureSRange, PAINT } from './features';
import { RELIEF_DEFAULTS } from './relief';
import { validateCliffs, validateFeatures, validatePlacements } from './validate';
import { timed } from '../testing/timing';

/**
 * Open-mountain terrain: relief, polyline features (ridge, gully, ravine) and cliff bands, on a
 * straight wide synthetic slope (s = z, d = −x; floor slope 0.1, halfWidth 120 m, cellSize 2.5).
 */

const wide = (over: Partial<LevelDef> = {}): LevelDef => ({
  id: 'mountain',
  index: 99,
  name: 'Mountain',
  subtitle: 'test',
  seed: 41,
  bounds: { minX: -200, maxX: 200, minZ: -60, maxZ: 900 },
  cellSize: 2.5,
  seaLevel: 0,
  course: [
    { x: 0, z: 0, floor: 90, halfWidth: 120 },
    { x: 0, z: 880, floor: 2, halfWidth: 120 },
  ],
  cliffs: [],
  wallHeight: 30,
  wallRamp: 25,
  startS: 20,
  coastS: 800,
  finishS: 820,
  obstacles: [],
  decor: { sceneryTreeDensity: 0, bushDensity: 0, grassTuftDensity: 0, pebbleDensity: 0 },
  ...over,
});

const RELIEF = { roll: 3, gullies: 2.5, outcrops: 6, outcropCover: 0.06 };
const plain = createTerrain(wide());
const y = (t: GeneratedTerrain, s: number, d: number): number => t.course.toWorld(s, d).y;
const rise = (t: GeneratedTerrain, s: number, d: number): number => y(t, s, d) - y(plain, s, d);
const slopeAt = (t: GeneratedTerrain, s: number, d: number): number => {
  const w = t.course.toWorld(s, d);
  const g = t.gradientAt(w.x, w.z);
  return Math.hypot(g.dx, g.dz);
};
const paintAt = (t: GeneratedTerrain, s: number, d: number): number => {
  const w = t.course.toWorld(s, d);
  return t.paintAt(w.x, w.z);
};
const depthAt = (t: GeneratedTerrain, s: number, d: number): number => {
  const w = t.course.toWorld(s, d);
  return t.ravineDepthAt?.(w.x, w.z) ?? 0;
};
const withFeatures = (features: TerrainFeature[], over: Partial<LevelDef> = {}): GeneratedTerrain =>
  createTerrain(wide({ features, ...over }));

describe('relief (open mountainside)', () => {
  const rough = createTerrain(wide({ relief: RELIEF }));

  it('is deterministic, seeded, and costs little to build', () => {
    const again = timed(() => createTerrain(wide({ relief: RELIEF })));
    expect(again.result.grid.heights).toEqual(rough.grid.heights);
    const other = createTerrain(wide({ relief: { ...RELIEF, seed: 7 } }));
    expect(other.grid.heights).not.toEqual(rough.grid.heights);
    const base = timed(() => createTerrain(wide()));
    // 61k vertices: relief adds well under a microsecond per vertex.
    expect(again.ms - base.ms).toBeLessThan(250);
  });

  it('is off without settings, and an empty or all-zero setting changes nothing', () => {
    expect(createTerrain(wide({ relief: {} })).grid.heights).toEqual(plain.grid.heights);
    const zero = createTerrain(wide({ relief: { roll: 0, outcrops: 0 } }));
    expect(zero.grid.heights).toEqual(plain.grid.heights);
  });

  it('roughens the floor within its amplitudes but leaves the spawn, the beach and the walls', () => {
    let worst = 0;
    let moved = 0;
    for (let s = 80; s <= 700; s += 9) {
      for (let d = -100; d <= 100; d += 7) {
        const r = rise(rough, s, d);
        worst = Math.max(worst, Math.abs(r));
        if (Math.abs(r) > 0.5) moved++;
      }
    }
    expect(worst).toBeLessThanOrEqual(RELIEF.roll + RELIEF.gullies + RELIEF.outcrops + 0.5);
    expect(moved).toBeGreaterThan(500);
    for (const d of [-10, 0, 10]) expect(Math.abs(rise(rough, 20, d))).toBeLessThan(0.01);
    expect(Math.abs(rise(rough, 790, 30))).toBeLessThan(0.01);
    expect(Math.abs(rise(rough, 400, 150))).toBeLessThan(0.01);
  });

  it('outcrops are sheer rock covering about the requested share of the floor', () => {
    let rock = 0;
    let n = 0;
    let steep = 0;
    for (let s = 100; s <= 650; s += 5) {
      for (let d = -95; d <= 95; d += 5) {
        n++;
        if (paintAt(rough, s, d) === PAINT.rock) {
          rock++;
          if (slopeAt(rough, s + 1.5, d) > 1.2 || slopeAt(rough, s - 1.5, d) > 1.2) steep++;
        }
      }
    }
    const share = rock / n;
    expect(share).toBeGreaterThan(0.5 * RELIEF.outcropCover);
    expect(share).toBeLessThan(1.6 * RELIEF.outcropCover);
    expect(steep).toBeGreaterThan(0);
    expect(RELIEF_DEFAULTS.outcropCover).toBeGreaterThan(0);
  });

  it('lineClear keeps outcrops off a band around the intended line', () => {
    const line = [
      { s: 20, d: 0 },
      { s: 300, d: 40 },
      { s: 800, d: -20 },
    ];
    const t = createTerrain(wide({ relief: { ...RELIEF, outcropCover: 0.2, lineClear: 12 }, line }));
    for (let s = 60; s <= 760; s += 2) {
      const ld = s <= 300 ? (40 * (s - 20)) / 280 : 40 - (60 * (s - 300)) / 500;
      for (let off = -11; off <= 11; off += 2) expect(paintAt(t, s, ld + off)).not.toBe(PAINT.rock);
    }
  });
});

describe('polyline features', () => {
  const ridge: TerrainFeature = {
    type: 'ridge',
    points: [
      { s: 200, d: -60 },
      { s: 300, d: 0 },
      { s: 360, d: 0 },
    ],
    width: 8,
    height: 10,
  };

  it('a wall ridge rises along its polyline with sheer craggy walls, and nowhere else', () => {
    const t = withFeatures([ridge]);
    // On the diagonal segment and the straight one.
    expect(rise(t, 250, -30)).toBeGreaterThan(8);
    expect(rise(t, 330, 0)).toBeGreaterThan(8);
    expect(rise(t, 330, 0)).toBeLessThan(12);
    expect(Math.abs(rise(t, 330, 6))).toBeLessThan(0.01);
    expect(Math.abs(rise(t, 368, 0))).toBeLessThan(0.01);
    expect(paintAt(t, 330, 0)).toBe(PAINT.rock);
    expect(t.wallnessAt(t.course.toWorld(330, 0).x, t.course.toWorld(330, 0).z)).toBe(1);
    // The wall is steeper than the iceberg can climb.
    expect(slopeAt(t, 330, 3.5)).toBeGreaterThan(1.2);
    expect(featureContains(ridge, 250, -30, 120)).toBe(true);
    expect(featureContains(ridge, 250, -20, 120)).toBe(false);
    expect(featureSRange(ridge)).toEqual({ s0: 196, s1: 364 });
  });

  it('a mound ridge is a smooth bank to crest', () => {
    const mound: TerrainFeature = { ...ridge, profile: 'mound', width: 30, height: 4 } as TerrainFeature;
    const t = withFeatures([mound]);
    expect(rise(t, 330, 0)).toBeCloseTo(4, 0);
    let steepest = 0;
    for (let d = -15; d <= 15; d += 0.5) steepest = Math.max(steepest, slopeAt(t, 330, d));
    expect(steepest).toBeLessThan(0.6);
    expect(paintAt(t, 330, 0)).not.toBe(PAINT.rock);
  });

  it('a gully is a groove that opens at its first point and fades out, or ends in a wall if closed', () => {
    const points = [
      { s: 200, d: 20 },
      { s: 400, d: 20 },
    ];
    const open = withFeatures([{ type: 'gully', points, width: 14, depth: 5 }]);
    const closed = withFeatures([{ type: 'gully', points, width: 14, depth: 5, closed: true }]);
    expect(rise(open, 300, 20)).toBeCloseTo(-5, 0);
    expect(Math.abs(rise(open, 200, 20))).toBeLessThan(0.3);
    expect(Math.abs(rise(open, 399, 20))).toBeLessThan(0.3);
    expect(rise(closed, 399, 20)).toBeLessThan(-4.5);
    // The closed end is as steep as the sides: a wall to bounce off.
    expect(slopeAt(closed, 403.5, 20)).toBeGreaterThan(0.8);
    expect(Math.abs(rise(open, 300, 28))).toBeLessThan(0.01);
  });

  it('a ravine cuts sheer along its polyline and reports its depth for the fatal-fall rule', () => {
    const t = withFeatures([
      {
        type: 'ravine',
        points: [
          { s: 300, d: -100 },
          { s: 340, d: 100 },
        ],
        width: 12,
        depth: 9,
      },
    ]);
    expect(rise(t, 320, 0)).toBeLessThan(-8.5);
    expect(depthAt(t, 320, 0)).toBeGreaterThan(8.5);
    expect(depthAt(t, 320, 0)).toBeLessThan(9.5);
    expect(depthAt(t, 309, 0)).toBe(0);
    expect(depthAt(t, 331, 0)).toBe(0);
    expect(paintAt(t, 320, 0)).toBe(PAINT.rock);
    expect(t.cut).not.toBeNull();
    expect(plain.cut).toBeNull();
    expect(plain.ravineDepthAt).toBeUndefined();
  });

  it('gaps are fatal by default; fatal: false keeps the old trench without a fatal depth', () => {
    const gap: TerrainFeature = { type: 'gap', s: 300, length: 12, depth: 8, d: 0, width: 30 };
    expect(depthAt(withFeatures([gap]), 306, 0)).toBeGreaterThan(7.5);
    const trench = withFeatures([{ ...gap, fatal: false } as TerrainFeature]);
    expect(rise(trench, 306, 0)).toBeLessThan(-7.5);
    expect(trench.ravineDepthAt).toBeUndefined();
  });

  it('validates the new features: walls tall enough, mounds crestable, channels wide, ravines deep', () => {
    const check = (features: TerrainFeature[]): string =>
      validateFeatures(withFeatures(features))
        .map((i) => `${i.index}: ${i.problem}`)
        .join(' | ');
    expect(check([ridge])).toBe('');
    expect(check([{ ...ridge, height: 4 } as TerrainFeature])).toMatch(/too low to block/);
    expect(check([{ ...ridge, profile: 'mound', width: 8, height: 6 } as TerrainFeature])).toMatch(
      /too steep to crest/,
    );
    const gully: TerrainFeature = { type: 'gully', points: ridge.points, width: 6, depth: 3 };
    expect(check([gully])).toMatch(/too narrow for the iceberg/);
    const ravine: TerrainFeature = { type: 'ravine', points: ridge.points, width: 10, depth: 3 };
    expect(check([ravine])).toMatch(/too shallow/);
    const off: TerrainFeature = {
      type: 'ridge',
      points: [
        { s: 300, d: 200 },
        { s: 320, d: 210 },
      ],
      width: 8,
      height: 10,
    };
    expect(check([off])).toMatch(/does not cross the floor/);
    // Polyline features may meet anything (mazes are junctions), and straddle cliffs.
    const deep = { ...ravine, depth: 9 } as TerrainFeature;
    const t = withFeatures([ridge, deep], { cliffs: [{ s: 330, drop: 6 }] });
    expect(validateFeatures(t)).toEqual([]);
  });

  it('placements: only bridges in ravines, only natural things on wall ridges', () => {
    const at = (kind: ObstaclePlacement['kind'], s: number, d: number): string[] =>
      validatePlacements(
        withFeatures(
          [
            ridge,
            {
              type: 'ravine',
              points: [
                { s: 500, d: -50 },
                { s: 500, d: 50 },
              ],
              width: 12,
              depth: 9,
            },
          ],
          { obstacles: [{ kind, s, d }] },
        ),
      ).map((i) => i.problem);
    expect(at('pine', 330, 0)).toEqual([]);
    expect(at('house', 330, 0).join()).toMatch(/on the ridge/);
    expect(at('boulder', 500, 0).join()).toMatch(/inside the ravine/);
    expect(at('footbridge', 500, 0).join()).not.toMatch(/inside the ravine/);
  });
});

describe('cliff bands', () => {
  const band = { s: 400, drop: 10, d: -30, width: 60 };
  const t = createTerrain(wide({ cliffs: [band] }));

  it('are sheer over their width and drop the ground below everywhere', () => {
    // The face spans one grid cell (2.5 m), as for any cliff.
    const lip = y(t, band.s - 3, -30) - y(t, band.s + 3, -30);
    expect(lip).toBeGreaterThan(band.drop);
    expect(lip).toBeLessThan(band.drop + 1.5);
    expect(slopeAt(t, band.s - 1.25, -30)).toBeGreaterThan(1.2);
    for (const d of [-100, -30, 0, 60, 100]) {
      expect(rise(t, band.s + 120, d)).toBeCloseTo(-band.drop, 0);
      expect(Math.abs(rise(t, band.s - 120, d))).toBeLessThan(0.05);
    }
  });

  it('beyond their ends the drop spreads into a slope you can ride round', () => {
    const end = -30 + 30;
    for (const out of [8, 15, 30]) {
      let steepest = 0;
      for (let s = band.s - 60; s <= band.s + 80; s += 1) {
        steepest = Math.max(steepest, slopeAt(t, s, end + out));
      }
      expect(steepest, `${out} m beyond the end`).toBeLessThan(0.6 + 0.15);
    }
    expect(t.course.floorAtD(band.s + 0.5, -30)).toBeLessThan(t.course.floorAtD(band.s - 0.5, -30) - 9.5);
  });

  it('report their centre, and validate their placement', () => {
    const info = t.cliffInfo[0];
    expect(t.course.project(info.lip.x, info.lip.z).d).toBeCloseTo(-30, 1);
    expect(info.halfWidth).toBe(30);
    expect(info.lip.y - info.base.y).toBeCloseTo(band.drop, 0);
    expect(validateCliffs(t)).toEqual([]);
    const near = validateCliffs(createTerrain(wide({ cliffs: [{ ...band, s: 760 }] })));
    expect(near.map((i) => i.problem).join()).toMatch(/must stay/);
    const out = validateCliffs(createTerrain(wide({ cliffs: [{ ...band, d: 140 }] })));
    expect(out.map((i) => i.problem).join()).toMatch(/outside the floor/);
  });

  it('a skewed band runs diagonally across its width', () => {
    const skewed = createTerrain(wide({ cliffs: [{ ...band, skew: 0.5 }] }));
    // Lip at s 400 + 0.5 (d + 30): s 385 at d −60, s 415 at d 0.
    expect(y(skewed, 381.5, -58) - y(skewed, 388.5, -58)).toBeGreaterThan(band.drop);
    expect(y(skewed, 411.5, -2) - y(skewed, 418.5, -2)).toBeGreaterThan(band.drop);
    expect(Math.abs(y(skewed, 393.5, -2) - y(skewed, 400.5, -2))).toBeLessThan(1.5);
  });
});
