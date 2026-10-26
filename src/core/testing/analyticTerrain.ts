import type { CourseFrame, CourseSample, LevelDef, Terrain, Vec3 } from '../types';
import { buildGrid, sampleGradient, sampleHeight } from '../heightGrid';

/**
 * A Terrain built from a plain height function, for unit tests. The course is a straight line
 * along +Z starting at z = 0 and x = 0, so: s = z, and d (right of travel) = -x.
 */
export interface AnalyticTerrainOptions {
  height: (x: number, z: number) => number;
  halfWidth?: number;
  length?: number;
  width?: number;
  cellSize?: number;
  seaLevel?: number;
  level?: Partial<LevelDef>;
}

export function createAnalyticTerrain(opts: AnalyticTerrainOptions): Terrain {
  const length = opts.length ?? 400;
  const width = opts.width ?? 120;
  const cellSize = opts.cellSize ?? 1;
  const seaLevel = opts.seaLevel ?? -1000;
  const halfWidth = opts.halfWidth ?? 20;
  const bounds = { minX: -width / 2, maxX: width / 2, minZ: -20, maxZ: length };
  const grid = buildGrid(bounds, cellSize, opts.height);

  const level: LevelDef = {
    id: 'test',
    index: 0,
    name: 'Test',
    subtitle: 'Analytic test terrain',
    seed: 1,
    bounds,
    cellSize,
    seaLevel,
    course: [
      { x: 0, z: 0, floor: opts.height(0, 0), halfWidth },
      { x: 0, z: length, floor: opts.height(0, length), halfWidth },
    ],
    cliffs: [],
    wallHeight: 0,
    wallRamp: 10,
    startS: 10,
    coastS: length,
    finishS: length - 10,
    obstacles: [],
    decor: { sceneryTreeDensity: 0, bushDensity: 0, grassTuftDensity: 0, pebbleDensity: 0 },
    ...opts.level,
  };

  const heightAt = (x: number, z: number): number => sampleHeight(grid, x, z);

  const course: CourseFrame = {
    length,
    sampleAt(s: number): CourseSample {
      return { s, x: 0, z: s, dirX: 0, dirZ: 1, floor: heightAt(0, s), halfWidth };
    },
    toWorld(s: number, d: number): Vec3 {
      const x = -d;
      const z = s;
      return { x, y: heightAt(x, z), z };
    },
    project(x: number, z: number) {
      return { s: z, d: -x };
    },
  };

  return {
    level,
    grid,
    course,
    heightAt,
    gradientAt: (x, z) => sampleGradient(grid, x, z),
    normalAt(x, z) {
      const g = sampleGradient(grid, x, z);
      const n = Math.hypot(g.dx, 1, g.dz);
      return { x: -g.dx / n, y: 1 / n, z: -g.dz / n };
    },
    surfaceAt: (x, z) => (heightAt(x, z) < seaLevel ? 'seabed' : 'grass'),
    isOcean: (x, z) => heightAt(x, z) < seaLevel,
  };
}

/** A plane falling `slope` metres per metre along +Z. */
export const inclinedPlane = (slope: number, top = 100) => (_x: number, z: number) => top - slope * z;
