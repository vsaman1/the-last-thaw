import { describe, expect, it } from 'vitest';
import type { LevelDef, ObstaclePlacement, TerrainFeature } from '../types';
import { createTerrain, type GeneratedTerrain } from './terrain';
import { PAINT } from './features';
import { roadJunctions, roadLines } from './roads';
import { validateFeatures, validateLevel, validateVehiclePlacements } from './validate';

/**
 * Living world: streets (polyline roads), parking areas, the road network in course coordinates and
 * the vehicle placement rules, on a straight synthetic town valley (s = z, d = -x; floor slope
 * ≈ 0.087, half-width 40 m).
 */

const level = (features: TerrainFeature[], obstacles: ObstaclePlacement[] = []): LevelDef => ({
  id: 'streets',
  index: 99,
  name: 'Streets',
  subtitle: 'test',
  seed: 7,
  bounds: { minX: -130, maxX: 130, minZ: -60, maxZ: 640 },
  cellSize: 2,
  seaLevel: 0,
  course: [
    { x: 0, z: 0, floor: 70, halfWidth: 40 },
    { x: 0, z: 300, floor: 44, halfWidth: 40 },
    { x: 0, z: 600, floor: 16, halfWidth: 40 },
  ],
  cliffs: [],
  wallHeight: 20,
  wallRamp: 15,
  startS: 20,
  coastS: 540,
  finishS: 570,
  obstacles,
  decor: { sceneryTreeDensity: 0, bushDensity: 0, grassTuftDensity: 0, pebbleDensity: 0 },
  features,
  theme: 'town',
});

type Street = Extract<TerrainFeature, { type: 'street' }>;

const MAIN: TerrainFeature = { type: 'road', s0: 60, s1: 480, d: 0, width: 8 };
const CROSS: Street = { type: 'street', points: [{ s: 200, d: -38 }, { s: 200, d: 38 }], width: 8 };
const BEND: Street = {
  type: 'street',
  points: [
    { s: 300, d: 10 },
    { s: 330, d: 25 },
    { s: 380, d: 30 },
  ],
  width: 6,
};

const plain = createTerrain(level([MAIN]));
const y = (t: GeneratedTerrain, s: number, d: number): number => t.course.toWorld(s, d).y;
const paint = (t: GeneratedTerrain, s: number, d: number): number => {
  const w = t.course.toWorld(s, d);
  return t.paintAt(w.x, w.z);
};

describe('streets and parking areas', () => {
  const LOT: TerrainFeature = { type: 'parking', s: 120, d: -25, length: 24, width: 14 };
  const t = createTerrain(level([MAIN, CROSS, BEND, LOT]));

  it('levels a cross street flat across and paints it, meeting the road at its own height', () => {
    for (let d = -30; d <= 30; d += 5) {
      const hs: number[] = [];
      for (let s = 197.5; s <= 202.5; s += 0.5) hs.push(y(t, s, d));
      expect(Math.max(...hs) - Math.min(...hs), `d=${d}`).toBeLessThan(0.08);
      expect(paint(t, 200, d)).toBe(PAINT.asphalt);
    }
    // At the crossroads the street takes the straight road's height (the road is unchanged).
    expect(Math.abs(y(t, 200, 0) - y(plain, 200, 0))).toBeLessThan(0.02);
    expect(Math.abs(y(t, 150, 0) - y(plain, 150, 0))).toBeLessThan(1e-9);
  });

  it('follows a bending polyline, flat across it', () => {
    // Mid-segment of the bend: (315, 17.5); across = perpendicular to the segment direction.
    const ds = 30;
    const dd = 15;
    const l = Math.hypot(ds, dd);
    const hs: number[] = [];
    for (let k = -2.5; k <= 2.5; k += 0.5) hs.push(y(t, 315 - (dd / l) * k, 17.5 + (ds / l) * k));
    expect(Math.max(...hs) - Math.min(...hs)).toBeLessThan(0.1);
    expect(paint(t, 315, 17.5)).toBe(PAINT.asphalt);
    expect(paint(t, 315, 0)).toBe(PAINT.asphalt); // the main road
    expect(paint(t, 340, 10)).toBe(PAINT.none);
  });

  it('levels a parking area and paints it', () => {
    const hs: number[] = [];
    for (let d = -31; d <= -19; d += 1) hs.push(y(t, 120, d));
    expect(Math.max(...hs) - Math.min(...hs)).toBeLessThan(0.08);
    expect(paint(t, 120, -25)).toBe(PAINT.asphalt);
    expect(paint(t, 140, -25)).toBe(PAINT.none);
  });

  it('shapes nothing for a street with carve: false', () => {
    const t2 = createTerrain(level([MAIN, { ...CROSS, carve: false }]));
    expect(Math.abs(y(t2, 200, 25) - y(plain, 200, 25))).toBeLessThan(1e-9);
    expect(paint(t2, 200, 25)).toBe(PAINT.none);
  });

  it('finds the junctions in course coordinates: a crossing and a T where the bend starts', () => {
    const lines = roadLines(t.level);
    expect(lines.map((l) => l.type)).toEqual(['road', 'street', 'street']);
    const j = roadJunctions(lines);
    expect(j).toHaveLength(1);
    expect(j[0].s).toBeCloseTo(200, 6);
    expect(j[0].d).toBeCloseTo(0, 6);
    // The bend starts 10 m off the road (> half-width + 1.5): a dead end, not a T. Move it closer.
    const near: TerrainFeature = { ...BEND, points: [{ s: 300, d: 4 }, ...BEND.points.slice(1)] };
    const tee = roadJunctions(roadLines(level([MAIN, near])));
    expect(tee).toHaveLength(1);
    expect(tee[0].at.map((m) => m.line)).toEqual([0, 1]);
  });

  it('validates streets and parking areas like roads', () => {
    expect(validateFeatures(t)).toEqual([]);
    const tiny: TerrainFeature = { type: 'parking', s: 120, d: 0, length: 3, width: 9 };
    const narrow = createTerrain(level([{ ...CROSS, width: 3 }, tiny]));
    const problems = validateFeatures(narrow).map((i) => i.problem);
    expect(problems.join()).toMatch(/too narrow/);
    expect(problems.join()).toMatch(/too small/);
  });
});

describe('vehicle placements', () => {
  it('wants cars, trucks and buses on a road or parking area, wagons on a track bed, boats afloat', () => {
    const feats: TerrainFeature[] = [
      MAIN,
      CROSS,
      { type: 'parking', s: 120, d: -25, length: 24, width: 14 },
      { type: 'road', s0: 60, s1: 480, d: 30, width: 6, surface: 'rail' },
    ];
    const obstacles: ObstaclePlacement[] = [
      { kind: 'car', s: 100, d: 2 }, // on the road: fine
      { kind: 'bus', s: 200, d: -20, yaw: Math.PI / 2 }, // on the cross street: fine
      { kind: 'truck', s: 120, d: -25, parked: true }, // parking area: fine
      { kind: 'car', s: 250, d: -20 }, // in a field
      { kind: 'truck', s: 300, d: 30 }, // on the track bed: not a road
      { kind: 'railWagon', s: 350, d: 30, yaw: Math.PI / 2 }, // on the track bed: fine
      { kind: 'railWagon', s: 400, d: 0, yaw: Math.PI / 2 }, // on the road: not a track bed
      { kind: 'boat', s: 420, d: -20 }, // on land
      { kind: 'house', s: 260, d: -25 }, // no rule
    ];
    const t = createTerrain(level(feats, obstacles));
    const issues = validateVehiclePlacements(t);
    expect(issues.map((i) => i.index)).toEqual([3, 4, 6, 7]);
    expect(issues[0].problem).toMatch(/not on a road or parking area/);
    expect(issues[2].problem).toMatch(/track bed/);
    expect(issues[3].problem).toMatch(/not on water/);
    // validateLevel reports them too.
    const all = validateLevel(t).filter((i) => i.area === 'obstacle');
    expect(all.map((i) => i.index)).toEqual([3, 4, 6, 7]);
  });
});
