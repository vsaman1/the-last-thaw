import type { HeightGrid } from './types';
import { clamp } from './math';

/**
 * Shared sampling for HeightGrid. The rendered terrain mesh, the Rapier collider and the iceberg
 * integrator must all agree on the surface, so everything samples through these functions.
 * Each grid cell is split into two triangles along the (ix,iz)→(ix+1,iz+1) diagonal, and sampling
 * is exact on those triangles (not bilinear), so the physics surface matches the mesh exactly.
 */

export function gridValue(g: HeightGrid, ix: number, iz: number): number {
  const cx = clamp(ix, 0, g.cols - 1);
  const cz = clamp(iz, 0, g.rows - 1);
  return g.heights[cz * g.cols + cx];
}

/** Locate (x, z) in the grid: cell indices and fractional position, clamped to the grid. */
function locate(g: HeightGrid, x: number, z: number): { ix: number; iz: number; fx: number; fz: number } {
  const gx = clamp((x - g.originX) / g.cellSize, 0, g.cols - 1.000001);
  const gz = clamp((z - g.originZ) / g.cellSize, 0, g.rows - 1.000001);
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  return { ix, iz, fx: gx - ix, fz: gz - iz };
}

/** Height on the triangulated surface. */
export function sampleHeight(g: HeightGrid, x: number, z: number): number {
  const { ix, iz, fx, fz } = locate(g, x, z);
  const h00 = gridValue(g, ix, iz);
  const h11 = gridValue(g, ix + 1, iz + 1);
  if (fx >= fz) {
    // triangle (00, 10, 11)
    const h10 = gridValue(g, ix + 1, iz);
    return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
  }
  // triangle (00, 11, 01)
  const h01 = gridValue(g, ix, iz + 1);
  return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
}

/** Gradient (dh/dx, dh/dz) of the triangulated surface — constant within each triangle. */
export function sampleGradient(g: HeightGrid, x: number, z: number): { dx: number; dz: number } {
  const { ix, iz, fx, fz } = locate(g, x, z);
  const h00 = gridValue(g, ix, iz);
  const h11 = gridValue(g, ix + 1, iz + 1);
  const c = g.cellSize;
  if (fx >= fz) {
    const h10 = gridValue(g, ix + 1, iz);
    return { dx: (h10 - h00) / c, dz: (h11 - h10) / c };
  }
  const h01 = gridValue(g, ix, iz + 1);
  return { dx: (h11 - h01) / c, dz: (h01 - h00) / c };
}

/** Build a grid by evaluating a height function at every vertex. */
export function buildGrid(
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  cellSize: number,
  fn: (x: number, z: number) => number,
): HeightGrid {
  const cols = Math.floor((bounds.maxX - bounds.minX) / cellSize) + 1;
  const rows = Math.floor((bounds.maxZ - bounds.minZ) / cellSize) + 1;
  const heights = new Float32Array(cols * rows);
  for (let iz = 0; iz < rows; iz++) {
    const z = bounds.minZ + iz * cellSize;
    for (let ix = 0; ix < cols; ix++) {
      heights[iz * cols + ix] = fn(bounds.minX + ix * cellSize, z);
    }
  }
  return { cols, rows, cellSize, originX: bounds.minX, originZ: bounds.minZ, heights };
}
