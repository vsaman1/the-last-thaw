import type { HeightGrid } from '../types';

/** Mutable gradient holder so per-step code can sample without allocating. */
export interface GradientOut {
  dx: number;
  dz: number;
}

/**
 * Allocation-free twin of heightGrid.sampleGradient: same clamping, same (ix,iz)→(ix+1,iz+1)
 * diagonal, same per-triangle constant gradient. Terrain.gradientAt returns a fresh object per
 * call, which the integrator would otherwise do ~10× per step.
 */
export function gradientInto(g: HeightGrid, x: number, z: number, out: GradientOut): GradientOut {
  const c = g.cellSize;
  const cols = g.cols;
  const rows = g.rows;
  let gx = (x - g.originX) / c;
  let gz = (z - g.originZ) / c;
  const maxX = cols - 1.000001;
  const maxZ = rows - 1.000001;
  gx = gx < 0 ? 0 : gx > maxX ? maxX : gx;
  gz = gz < 0 ? 0 : gz > maxZ ? maxZ : gz;
  if (!(gx === gx) || !(gz === gz)) {
    out.dx = 0;
    out.dz = 0;
    return out;
  }
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const h = g.heights;
  const ix1 = ix + 1 < cols ? ix + 1 : cols - 1;
  const iz1 = iz + 1 < rows ? iz + 1 : rows - 1;
  const h00 = h[iz * cols + ix];
  const h11 = h[iz1 * cols + ix1];
  if (fx >= fz) {
    const h10 = h[iz * cols + ix1];
    out.dx = (h10 - h00) / c;
    out.dz = (h11 - h10) / c;
  } else {
    const h01 = h[iz1 * cols + ix];
    out.dx = (h11 - h01) / c;
    out.dz = (h01 - h00) / c;
  }
  return out;
}
