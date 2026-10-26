import type { Vec3 } from '../types';
import type { GeneratedTerrain } from '../terrain/terrain';
import type { LakeFootprint } from './geometry';
import type { StreamInfo } from './network';
import { SPRING } from './tuning';

/**
 * A cave spring's pool: the small reservoir of still water a 'cave' stream flows out of (its bowl is
 * carved by the terrain: SPRING_POOL in src/core/terrain/stream.ts; the cave mouth over its back:
 * ./cave.ts). One level over the bowl: the highest water surface of the stream's cells inside it
 * (they lie flat on the outlet's bed, ./network.ts), so the lake meets the stream at the outlet
 * without a step and stands over the stream's own water everywhere inside (WaterSystem.sample
 * answers from it there: still water drifting gently toward the outlet, SPRING.drift). The terrain
 * decides the shoreline: the footprint is every grid vertex below the level 4-connected to the
 * spring within the pool's radius + SPRING.fillMargin. Static (a spring's level does not change).
 * geometry.ts draws its lake like a reservoir's (footprint()).
 */
export class SpringPool {
  /** Index of the stream in the session's stream list, and in level.features. */
  readonly stream: number;
  readonly feature: number;
  readonly radius: number;
  /** The spring (pool centre, the stream's first cell) and the outlet (the cell at the radius). */
  readonly cx: number;
  readonly cz: number;
  readonly ox: number;
  readonly oz: number;
  /** Unit vector from the outlet toward the spring (the lake mesh's v runs against it). */
  readonly upX: number;
  readonly upZ: number;
  /** A line across the outlet (for the lake mesh's across coordinate, like a dam's axis). */
  readonly ends: readonly [Vec3, Vec3];
  /** Still water level (m) and the floor of the bowl. */
  readonly level: number;
  readonly floorY: number;
  /** Footprint: grid vertex window [ix0, ix0 + cols) × [iz0, iz0 + rows) and its mask (1 = lake). */
  readonly ix0: number;
  readonly iz0: number;
  readonly cols: number;
  readonly rows: number;
  readonly mask: Uint8Array;
  readonly vertexCount: number;

  private readonly terrain: GeneratedTerrain;
  private readonly sill: Sill;

  private constructor(
    terrain: GeneratedTerrain,
    stream: number,
    st: StreamInfo,
    level: number,
    fill: { ix0: number; iz0: number; cols: number; rows: number; mask: Uint8Array; count: number },
    sill: Sill,
  ) {
    this.sill = sill;
    const r = st.reach;
    const pool = st.pool!;
    this.terrain = terrain;
    this.stream = stream;
    this.feature = st.feature;
    this.radius = pool.radius;
    this.floorY = pool.floorY;
    this.level = level;
    this.cx = r.x[0];
    this.cz = r.z[0];
    const out = outletCell(st);
    this.ox = r.x[out];
    this.oz = r.z[out];
    const ux = this.cx - this.ox;
    const uz = this.cz - this.oz;
    const ul = Math.hypot(ux, uz);
    this.upX = ul > 1e-6 ? ux / ul : -r.dirX[0];
    this.upZ = ul > 1e-6 ? uz / ul : -r.dirZ[0];
    const hx = -this.upZ * this.radius;
    const hz = this.upX * this.radius;
    this.ends = [
      { x: this.ox - hx, y: level, z: this.oz - hz },
      { x: this.ox + hx, y: level, z: this.oz + hz },
    ];
    this.ix0 = fill.ix0;
    this.iz0 = fill.iz0;
    this.cols = fill.cols;
    this.rows = fill.rows;
    this.mask = fill.mask;
    this.vertexCount = fill.count;
  }

  /** The spring pool of stream `stream` (an index into `streams`), or null when it has none. */
  static build(terrain: GeneratedTerrain, stream: number, streams: readonly StreamInfo[]): SpringPool | null {
    const st = streams[stream];
    if (!st?.pool) return null;
    const r = st.reach;
    const out = outletCell(st);
    let level = -Infinity;
    for (let i = 0; i <= out; i++) level = Math.max(level, r.baseY[i] + r.h[i]);
    if (!Number.isFinite(level)) return null;
    // Not past the sill: there the stream runs on, below the pool's level.
    const sill = { x: r.x[out], z: r.z[out], nx: r.dirX[out], nz: r.dirZ[out] };
    const fill = floodFill(terrain, r.x[0], r.z[0], level, st.pool.radius + SPRING.fillMargin, sill);
    return fill ? new SpringPool(terrain, stream, st, level, fill, sill) : null;
  }

  /**
   * The footprint as a lake mesh reads it (anchored at the outlet: v runs toward it), cut at the
   * sill so the lake does not hang over the stream running on below its level.
   */
  footprint(): LakeFootprint {
    const { ix0, iz0, cols, rows, mask, upX, upZ, ends } = this;
    const clip = { x: this.sill.x, z: this.sill.z, nx: this.sill.nx, nz: this.sill.nz };
    return { ix0, iz0, cols, rows, mask, cx: this.ox, cz: this.oz, upX, upZ, ends, clip };
  }

  /** True when (x, z) lies in the footprint (any corner of its grid cell is lake), not past the sill. */
  contains(x: number, z: number): boolean {
    if ((x - this.sill.x) * this.sill.nx + (z - this.sill.z) * this.sill.nz > 0) return false;
    const g = this.terrain.grid;
    const fx = (x - g.originX) / g.cellSize - this.ix0;
    const fz = (z - g.originZ) / g.cellSize - this.iz0;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    if (ix < -1 || iz < -1 || ix >= this.cols || iz >= this.rows) return false;
    for (let dz = 0; dz <= 1; dz++) {
      const j = iz + dz;
      if (j < 0 || j >= this.rows) continue;
      for (let dx = 0; dx <= 1; dx++) {
        const i = ix + dx;
        if (i >= 0 && i < this.cols && this.mask[j * this.cols + i] === 1) return true;
      }
    }
    return false;
  }
}

/** The pool's sill: a point on it (the outlet cell) and the stream's downstream direction there. */
interface Sill {
  x: number;
  z: number;
  nx: number;
  nz: number;
}

/** The stream cell at the pool's outlet (the last one within its radius). */
function outletCell(st: StreamInfo): number {
  const r = st.reach;
  const R = st.pool?.radius ?? 0;
  let i = 0;
  while (i + 1 < r.n && r.arc[i + 1] <= R) i++;
  return i;
}

/**
 * Grid vertices below `level` 4-connected to the one nearest (cx, cz), within `reach` m of it and
 * not past the sill line (through the outlet, across the stream's direction there).
 */
function floodFill(
  terrain: GeneratedTerrain,
  cx: number,
  cz: number,
  level: number,
  reach: number,
  sill: Sill,
): { ix0: number; iz0: number; cols: number; rows: number; mask: Uint8Array; count: number } | null {
  const g = terrain.grid;
  const { cols, rows, cellSize, originX, originZ, heights } = g;
  const span = Math.ceil(reach / cellSize) + 1;
  const ci = Math.round((cx - originX) / cellSize);
  const cj = Math.round((cz - originZ) / cellSize);
  const ix0 = Math.max(0, ci - span);
  const iz0 = Math.max(0, cj - span);
  const ix1 = Math.min(cols - 1, ci + span);
  const iz1 = Math.min(rows - 1, cj + span);
  const wc = ix1 - ix0 + 1;
  const wr = iz1 - iz0 + 1;
  if (wc <= 0 || wr <= 0) return null;
  const mask = new Uint8Array(wc * wr);
  const queue: number[] = [];
  const r2 = reach * reach;
  const push = (ix: number, iz: number): void => {
    if (ix < ix0 || iz < iz0 || ix > ix1 || iz > iz1) return;
    const k = (iz - iz0) * wc + (ix - ix0);
    if (mask[k]) return;
    if (!(heights[iz * cols + ix] < level)) return;
    const x = originX + ix * cellSize - cx;
    const z = originZ + iz * cellSize - cz;
    if (x * x + z * z > r2) return;
    if ((x + cx - sill.x) * sill.nx + (z + cz - sill.z) * sill.nz > 0) return;
    mask[k] = 1;
    queue.push(iz * cols + ix);
  };
  push(ci, cj);
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const ix = i % cols;
    const iz = (i - ix) / cols;
    push(ix + 1, iz);
    push(ix - 1, iz);
    push(ix, iz + 1);
    push(ix, iz - 1);
  }
  return queue.length > 0 ? { ix0, iz0, cols: wc, rows: wr, mask, count: queue.length } : null;
}
