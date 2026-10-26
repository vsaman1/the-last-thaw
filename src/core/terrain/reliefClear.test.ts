import { describe, expect, it } from 'vitest';
import type { CourseCoord, LevelDef } from '../types';
import { PAINT } from './features';
import { createTerrain, type GeneratedTerrain } from './terrain';

/**
 * ReliefSettings.clear: corridors kept free of outcrops besides the line (Power Valley's designer had
 * to switch tors off: they walled off the alternative routes and the dam breach).
 */

const ROUTE: CourseCoord[] = [
  { s: 100, d: 60 },
  { s: 300, d: 110 },
  { s: 500, d: 40 },
];

const level = (clear?: { points: CourseCoord[]; width?: number }[]): LevelDef => ({
  id: `relief-clear-${JSON.stringify(clear ?? null)}`,
  index: 0,
  name: 'relief clear',
  subtitle: '',
  seed: 77,
  bounds: { minX: -220, maxX: 220, minZ: -100, maxZ: 700 },
  cellSize: 2.5,
  seaLevel: 0,
  course: [
    { x: 0, z: 0, floor: 100, halfWidth: 50 },
    { x: 0, z: 60, floor: 92, halfWidth: 160 },
    { x: 0, z: 690, floor: 2, halfWidth: 160 },
  ],
  cliffs: [],
  wallHeight: 30,
  wallRamp: 25,
  startS: 30,
  coastS: 650,
  finishS: 670,
  relief: { outcrops: 7, outcropCover: 0.12, lineClear: 15, ...(clear ? { clear } : {}) },
  line: [
    { s: 30, d: 0 },
    { s: 650, d: 0 },
  ],
  obstacles: [],
  decor: { sceneryTreeDensity: 0, bushDensity: 0, grassTuftDensity: 0, pebbleDensity: 0 },
});

/** Rock (outcrop) grid vertices within `r` m of the route, and in the whole floor. */
function rock(t: GeneratedTerrain, r: number): { near: number; all: number } {
  const g = t.grid;
  let near = 0;
  let all = 0;
  for (let iz = 0; iz < g.rows; iz++) {
    for (let ix = 0; ix < g.cols; ix++) {
      if (t.paint[iz * g.cols + ix] !== PAINT.rock) continue;
      const p = t.course.project(g.originX + ix * g.cellSize, g.originZ + iz * g.cellSize);
      if (p.s < 40 || p.s > 640 || Math.abs(p.d) > 150) continue;
      all++;
      for (let k = 0; k + 1 < ROUTE.length; k++) {
        const a = ROUTE[k];
        const b = ROUTE[k + 1];
        const es = b.s - a.s;
        const ed = b.d - a.d;
        const u = Math.min(1, Math.max(0, ((p.s - a.s) * es + (p.d - a.d) * ed) / (es * es + ed * ed)));
        if (Math.hypot(a.s + es * u - p.s, a.d + ed * u - p.d) <= r) {
          near++;
          break;
        }
      }
    }
  }
  return { near, all };
}

describe('relief.clear keeps outcrops off designer-chosen corridors', () => {
  const plain = createTerrain(level());
  const cleared = createTerrain(level([{ points: ROUTE, width: 30 }]));

  it('clears the corridor (outcrops fade out within width / 2) and leaves the rest alone', () => {
    const before = rock(plain, 15);
    const after = rock(cleared, 15);
    expect(before.near).toBeGreaterThan(20);
    expect(after.near).toBe(0);
    // Beyond the corridor's end (s 500, + 15 + 12 m) nothing changes, and most tors stay.
    const g = plain.grid;
    let checked = 0;
    for (let i = 0; i < g.heights.length; i += 7) {
      const z = g.originZ + Math.floor(i / g.cols) * g.cellSize;
      if (z < 530) continue;
      expect(cleared.grid.heights[i]).toBe(g.heights[i]);
      checked++;
    }
    expect(checked).toBeGreaterThan(1000);
    expect(after.all).toBeGreaterThan(before.all * 0.6);
  });

  it('defaults the corridor half-width to lineClear', () => {
    const t = createTerrain(level([{ points: ROUTE }]));
    expect(rock(t, 15).near).toBe(0);
  });
});

describe('outcrops are anchored to the course, not the level bounds', () => {
  it('keeps every tor where it was when the bounds grow', () => {
    // Before: the cover quantile was sampled over the bounds, so widening them by 100 m moved tors
    // (the Alpine Pass designer's report).
    const a = createTerrain(level());
    const wide = level();
    wide.id = 'relief-clear-wide';
    wide.bounds = { minX: -320, maxX: 320, minZ: -100, maxZ: 800 };
    const b = createTerrain(wide);
    let tors = 0;
    let moved = 0;
    for (let iz = 0; iz < a.grid.rows; iz++) {
      for (let ix = 0; ix < a.grid.cols; ix++) {
        const x = a.grid.originX + ix * a.grid.cellSize;
        const z = a.grid.originZ + iz * a.grid.cellSize;
        const p = a.course.project(x, z);
        if (p.s < 40 || p.s > 640 || Math.abs(p.d) > 140) continue;
        const ra = a.paint[iz * a.grid.cols + ix] === PAINT.rock;
        const rb = b.paintAt(x, z) === PAINT.rock;
        if (ra) tors++;
        if (ra !== rb) moved++;
      }
    }
    expect(tors).toBeGreaterThan(500);
    expect(moved).toBe(0);
  });
});
