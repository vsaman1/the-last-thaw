import type { Vec3 } from '../types';
import type { GeneratedTerrain } from '../terrain/terrain';
import type { Reach } from './reach';
import { HYDRO } from './tuning';

/**
 * Mesh data for inland water, in the attribute layout of the river water material
 * (src/render/materials/water.ts: position, normal, uv, aFlow, aTurb, aFall, aOcean, aBirth,
 * aLateral), so streams, reservoirs and captured rivers look like the meltwater river.
 *
 * - Ribbons (streams, captured rivers): STREAM_CROSS vertices across every reach cell, flat at the
 *   cell's water surface and as wide as its water (+ RIBBON_MARGIN, so the terrain's banks hide the
 *   edge), u across 0..1, v = metres along the reach (+ V_START, past the shader's start taper).
 *   Dry cells and cells under the sea collapse to zero width. Cells before `from` (a spring pool's
 *   or a parent stream's water is drawn over them) are drawn HIDDEN_SINK m lower, so the two
 *   surfaces never z-fight and the stream still runs on from under them. Rebuilt when the water
 *   changes.
 * - Lakes (reservoirs, spring pools): the footprint's grid cells (grown by one cell) at y = 0, drawn
 *   at the lake's level (mesh position); the terrain decides the shoreline. v runs toward the dam
 *   (a spring pool's outlet).
 */

export const STREAM_CROSS = 5;
/** Ribbon half width beyond the water's edge (m). */
export const RIBBON_MARGIN = 0.6;
/** How far (m) a ribbon's cells under other water are drawn below their own surface. */
export const HIDDEN_SINK = 0.25;
const V_START = 10;
/** Water laid out ahead of play: born long ago (the shader hides water not yet born). */
const BORN = -1e4;

export interface WaterMeshData {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  flow: Float32Array;
  turb: Float32Array;
  fall: Float32Array;
  ocean: Float32Array;
  birth: Float32Array;
  lateral: Float32Array;
  index: Uint32Array;
  vertexCount: number;
  indexCount: number;
  /** Axis-aligned bounds of the drawn vertices. */
  bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
}

function alloc(verts: number, indices: number): WaterMeshData {
  return {
    position: new Float32Array(verts * 3),
    normal: new Float32Array(verts * 3),
    uv: new Float32Array(verts * 2),
    flow: new Float32Array(verts),
    turb: new Float32Array(verts),
    fall: new Float32Array(verts),
    ocean: new Float32Array(verts),
    birth: new Float32Array(verts).fill(BORN),
    lateral: new Float32Array(verts * 2),
    index: new Uint32Array(indices),
    vertexCount: 0,
    indexCount: 0,
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 },
  };
}

/** Ribbon mesh data for up to `cells` cross-sections (index written once). */
export function createRibbonData(cells: number): WaterMeshData {
  const n = Math.max(2, cells);
  const d = alloc(n * STREAM_CROSS, (n - 1) * (STREAM_CROSS - 1) * 6);
  let k = 0;
  for (let i = 0; i + 1 < n; i++) {
    for (let j = 0; j + 1 < STREAM_CROSS; j++) {
      const a = i * STREAM_CROSS + j;
      const b = a + STREAM_CROSS;
      d.index[k++] = a;
      d.index[k++] = b;
      d.index[k++] = a + 1;
      d.index[k++] = a + 1;
      d.index[k++] = b;
      d.index[k++] = b + 1;
    }
  }
  for (let v = 0; v < n * STREAM_CROSS; v++) d.normal[v * 3 + 1] = 1;
  return d;
}

/** Cross-sections a ribbon data object holds. */
export const ribbonCapacity = (d: WaterMeshData): number => d.flow.length / STREAM_CROSS;

/**
 * Fill ribbon data from a reach (its first min(n, capacity) cells). `extraTurb(i)` adds foam (a
 * flood's rise); cells before `from` lie under other water (drawn HIDDEN_SINK lower). Returns the
 * number of cross-sections written.
 */
export function fillRibbon(
  r: Reach,
  seaLevel: number,
  d: WaterMeshData,
  extraTurb?: (i: number) => number,
  from = 0,
): number {
  const n = Math.min(r.n, ribbonCapacity(d));
  const b = d.bounds;
  b.minX = b.minY = b.minZ = Infinity;
  b.maxX = b.maxY = b.maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const h = r.h[i];
    const y = r.baseY[i] + h - (i < from ? HIDDEN_SINK : 0);
    const wet = h > HYDRO.dry && y > seaLevel + 0.05;
    const half = wet ? r.waterHalf(i, h) + RIBBON_MARGIN : 0;
    const rx = -r.dirZ[i];
    const rz = r.dirX[i];
    const turb = Math.min(1, Math.max(r.turb[i], extraTurb ? extraTurb(i) : 0));
    for (let j = 0; j < STREAM_CROSS; j++) {
      const u = j / (STREAM_CROSS - 1);
      const off = (u - 0.5) * 2 * half;
      const v = i * STREAM_CROSS + j;
      const x = r.x[i] + rx * off;
      const z = r.z[i] + rz * off;
      d.position[v * 3] = x;
      d.position[v * 3 + 1] = y;
      d.position[v * 3 + 2] = z;
      d.uv[v * 2] = u;
      d.uv[v * 2 + 1] = r.arc[i] + V_START;
      d.flow[v] = r.u[i];
      d.turb[v] = turb;
      d.fall[v] = r.fall[i];
      d.lateral[v * 2] = Math.abs(off);
      d.lateral[v * 2 + 1] = 0;
      if (wet) {
        if (x < b.minX) b.minX = x;
        if (x > b.maxX) b.maxX = x;
        if (y < b.minY) b.minY = y;
        if (y > b.maxY) b.maxY = y;
        if (z < b.minZ) b.minZ = z;
        if (z > b.maxZ) b.maxZ = z;
      }
    }
  }
  d.vertexCount = n * STREAM_CROSS;
  d.indexCount = Math.max(0, n - 1) * (STREAM_CROSS - 1) * 6;
  if (!(b.minX <= b.maxX)) b.minX = b.minY = b.minZ = b.maxX = b.maxY = b.maxZ = 0;
  return n;
}

/**
 * What a lake mesh needs of a reservoir or a spring pool: its footprint on the terrain grid, a point
 * on its outflow (the dam's crossing, the pool's outlet: cx, cz), the unit vector from there into the
 * lake (upX, upZ) and a line across the outflow (ends).
 */
export interface LakeFootprint {
  readonly ix0: number;
  readonly iz0: number;
  readonly cols: number;
  readonly rows: number;
  readonly mask: Uint8Array;
  readonly cx: number;
  readonly cz: number;
  readonly upX: number;
  readonly upZ: number;
  readonly ends: readonly [Vec3, Vec3];
  /**
   * Optional cut: no cell whose centre lies past the line through (x, z) along +(nx, nz) (a spring
   * pool's sill: past it the stream runs on below the lake's level).
   */
  readonly clip?: { x: number; z: number; nx: number; nz: number };
}

/** Static lake mesh of a reservoir or spring pool (y = 0: draw it at the lake's level). */
export function buildLakeData(res: LakeFootprint, terrain: GeneratedTerrain): WaterMeshData {
  const g = terrain.grid;
  // Window grown by one node each side; a cell is drawn if any node within one cell of it is lake.
  const cols = res.cols + 2;
  const rows = res.rows + 2;
  const lake = (i: number, j: number): boolean => {
    const ii = i - 1;
    const jj = j - 1;
    return ii >= 0 && jj >= 0 && ii < res.cols && jj < res.rows && res.mask[jj * res.cols + ii] === 1;
  };
  const clipped = (i: number, j: number): boolean => {
    const c = res.clip;
    if (!c) return false;
    const x = g.originX + (res.ix0 + i - 0.5) * g.cellSize;
    const z = g.originZ + (res.iz0 + j - 0.5) * g.cellSize;
    return (x - c.x) * c.nx + (z - c.z) * c.nz > 0;
  };
  const cells: number[] = [];
  for (let j = 0; j + 1 < rows; j++) {
    for (let i = 0; i + 1 < cols; i++) {
      let any = false;
      for (let dj = -1; dj <= 2 && !any; dj++) {
        for (let di = -1; di <= 2 && !any; di++) any = lake(i + di, j + dj);
      }
      if (any && !clipped(i, j)) cells.push(j * cols + i);
    }
  }
  const d = alloc(cols * rows, cells.length * 6);
  const ax = res.ends[1].x - res.ends[0].x;
  const az = res.ends[1].z - res.ends[0].z;
  const al = Math.hypot(ax, az) || 1;
  const b = d.bounds;
  b.minX = b.minZ = Infinity;
  b.maxX = b.maxZ = -Infinity;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = j * cols + i;
      const x = g.originX + (res.ix0 + i - 1) * g.cellSize;
      const z = g.originZ + (res.iz0 + j - 1) * g.cellSize;
      d.position[v * 3] = x;
      d.position[v * 3 + 2] = z;
      d.normal[v * 3 + 1] = 1;
      const across = ((x - res.cx) * ax + (z - res.cz) * az) / al;
      const toward = -((x - res.cx) * res.upX + (z - res.cz) * res.upZ);
      // u just either side of the middle: no bank foam, and the sign gives the across coordinate.
      d.uv[v * 2] = across >= 0 ? 0.501 : 0.499;
      d.uv[v * 2 + 1] = toward + 1000;
      d.lateral[v * 2] = Math.abs(across);
      d.flow[v] = 0.6;
      d.turb[v] = 0.05;
      b.minX = Math.min(b.minX, x);
      b.maxX = Math.max(b.maxX, x);
      b.minZ = Math.min(b.minZ, z);
      b.maxZ = Math.max(b.maxZ, z);
    }
  }
  let k = 0;
  for (const c of cells) {
    const a = c;
    const bb = c + cols;
    d.index[k++] = a;
    d.index[k++] = bb;
    d.index[k++] = a + 1;
    d.index[k++] = a + 1;
    d.index[k++] = bb;
    d.index[k++] = bb + 1;
  }
  d.vertexCount = cols * rows;
  d.indexCount = k;
  b.minY = -0.5;
  b.maxY = 0.5;
  return d;
}
