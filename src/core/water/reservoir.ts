import type { ObstaclePlacement, Vec3 } from '../types';
import type { GeneratedTerrain } from '../terrain/terrain';
import { damAxis, damEnds, damStream, type DamCrossing } from './dams';
import type { StreamInfo } from './network';
import { HYDRO, RESERVOIR } from './tuning';

/**
 * A dam's reservoir. The dam (a 'dam' placement whose axis spans a stream's channel bank to bank)
 * stands RESERVOIR.crest × scale m above the lowest ground along its axis; the full lake stands
 *   level = min(crest − freeboard, abutment − abutmentMargin)
 * where abutment = the lower of the highest ground within abutmentReach m beyond either end of the
 * dam (a dam that does not reach high ground at its ends holds only as much as they do). The terrain
 * decides the shoreline: the footprint is every grid vertex below that level reachable from the
 * stream just upstream of the dam without crossing the dam's line (a 4-neighbour flood fill on the
 * terrain grid, at most RESERVOIR.maxReach m away). Volume(level) = cell area × Σ(level − h) over
 * the footprint's vertices below the level (sorted heights + prefix sums).
 *
 * Intact, the lake stays full and the dam lets RESERVOIR.spillShare of the stream through. Broken
 * where its foot is under water, it drains: the head above the breach floor falls as
 * H0 / (1 + t/τ)², and the flood that leaves through the breach carries what the lake lost each
 * step, at most weir × breach width × head^1.5 (each broken monolith adds RESERVOIR.breachWidth ×
 * scale m) and at most floodMax. Further breaks widen the breach (the drain restarts from the
 * current head).
 */
export class Reservoir {
  /** Index into level.obstacles of the dam, and of the stream (into the session's stream list). */
  readonly placement: number;
  readonly stream: number;
  /** The crossing on the stream, and the reach cell the dam lets water into (first one below it). */
  readonly crossing: DamCrossing;
  readonly cell: number;
  /** World crossing point and the unit normal of the dam's axis pointing upstream. */
  readonly cx: number;
  readonly cz: number;
  readonly upX: number;
  readonly upZ: number;
  /** World end points of the dam's axis. */
  readonly ends: readonly [Vec3, Vec3];
  /** Lowest ground along the axis, the crest, and the full level (m). */
  readonly floorY: number;
  readonly crestY: number;
  readonly fullLevel: number;
  /** Footprint: grid vertex window [ix0, ix0 + cols) × [iz0, iz0 + rows) and its mask (1 = lake). */
  readonly ix0: number;
  readonly iz0: number;
  readonly cols: number;
  readonly rows: number;
  readonly mask: Uint8Array;
  readonly vertexCount: number;
  readonly fullVolume: number;

  level: number;
  broken = false;
  /** Seconds since the breach (re)started, the head then (m), peak outflow (m³/s), breach width (m). */
  drainTime = 0;
  head0 = 0;
  qPeak = 0;
  breachWidth = 0;
  breachFloor = 0;
  /** Breach point (world). */
  bx = 0;
  bz = 0;
  /** Outflow through the breach at the last step (m³/s). */
  outflow = 0;

  private readonly terrain: GeneratedTerrain;
  private readonly scale: number;
  private readonly sorted: Float64Array;
  private readonly prefix: Float64Array;
  private readonly cellArea: number;

  private constructor(
    terrain: GeneratedTerrain,
    placement: number,
    stream: number,
    crossing: DamCrossing,
    geo: {
      cell: number;
      cx: number;
      cz: number;
      upX: number;
      upZ: number;
      ends: [Vec3, Vec3];
      floorY: number;
      crestY: number;
      level: number;
    },
    fill: { ix0: number; iz0: number; cols: number; rows: number; mask: Uint8Array; heights: number[] },
    scale: number,
  ) {
    this.terrain = terrain;
    this.placement = placement;
    this.stream = stream;
    this.crossing = crossing;
    this.cell = geo.cell;
    this.cx = geo.cx;
    this.cz = geo.cz;
    this.upX = geo.upX;
    this.upZ = geo.upZ;
    this.ends = geo.ends;
    this.floorY = geo.floorY;
    this.crestY = geo.crestY;
    this.fullLevel = geo.level;
    this.level = geo.level;
    this.ix0 = fill.ix0;
    this.iz0 = fill.iz0;
    this.cols = fill.cols;
    this.rows = fill.rows;
    this.mask = fill.mask;
    this.vertexCount = fill.heights.length;
    this.scale = scale;
    this.sorted = Float64Array.from(fill.heights).sort();
    this.prefix = new Float64Array(this.sorted.length + 1);
    for (let i = 0; i < this.sorted.length; i++) this.prefix[i + 1] = this.prefix[i] + this.sorted[i];
    this.cellArea = terrain.grid.cellSize * terrain.grid.cellSize;
    this.fullVolume = this.volumeAt(geo.level);
    this.bx = geo.cx;
    this.bz = geo.cz;
  }

  /**
   * The reservoir of dam placement `index` on one of `streams`, or null when the dam spans no
   * stream's channel, would hold nothing above the stream, or floods no ground.
   */
  static build(terrain: GeneratedTerrain, index: number, streams: readonly StreamInfo[]): Reservoir | null {
    const p: ObstaclePlacement | undefined = terrain.level.obstacles[index];
    if (!p || p.kind !== 'dam') return null;
    const crossing = damStream(terrain, p);
    if (!crossing) return null;
    const si = streams.findIndex((st) => st.feature === crossing.feature);
    if (si < 0) return null;
    const st = streams[si];
    const r = st.reach;
    const scale = p.scale ?? 1;
    // World geometry of the axis and the crossing.
    const axis = damAxis(terrain, p);
    const [e0, e1] = damEnds(axis);
    const w0 = terrain.course.toWorld(e0.s, e0.d);
    const w1 = terrain.course.toWorld(e1.s, e1.d);
    const ax = w1.x - w0.x;
    const az = w1.z - w0.z;
    const al = Math.hypot(ax, az) || 1;
    const ux = ax / al;
    const uz = az / al;
    const fc = Math.min(crossing.arc / r.dx, r.n - 1);
    const i0 = Math.min(Math.floor(fc), r.n - 2);
    const ft = fc - i0;
    const cx = r.x[i0] + (r.x[i0 + 1] - r.x[i0]) * ft;
    const cz = r.z[i0] + (r.z[i0 + 1] - r.z[i0]) * ft;
    let upX = -uz;
    let upZ = ux;
    if (upX * r.dirX[i0] + upZ * r.dirZ[i0] > 0) {
      upX = -upX;
      upZ = -upZ;
    }
    const cell = Math.min(r.n - 1, i0 + 1);
    // Lowest ground along the axis (under its upstream face, axis and toe) and the crest.
    const half = (RESERVOIR.thickness * scale) / 2;
    let floorY = Infinity;
    const steps = Math.max(2, Math.ceil(al));
    for (let k = 0; k <= steps; k++) {
      const x = w0.x + (ax * k) / steps;
      const z = w0.z + (az * k) / steps;
      for (const o of [-half, 0, half]) floorY = Math.min(floorY, terrain.heightAt(x + upX * o, z + upZ * o));
    }
    const crestY = floorY + RESERVOIR.crest * scale;
    // The abutments: the highest ground within abutmentReach m beyond each end (the dam is keyed
    // into the slope there); water above the lower of them would run round the dam.
    let abut = Infinity;
    for (const [w, sx] of [
      [w0, -1],
      [w1, 1],
    ] as const) {
      let high = -Infinity;
      for (let out = 0.5; out <= RESERVOIR.abutmentReach; out += 0.5) {
        high = Math.max(high, terrain.heightAt(w.x + ux * sx * out, w.z + uz * sx * out));
      }
      abut = Math.min(abut, high);
    }
    const level = Math.min(crestY - RESERVOIR.freeboard, abut - RESERVOIR.abutmentMargin);
    const streamSurface = r.baseY[i0] + r.h[i0];
    if (!(level > streamSurface + RESERVOIR.minHead)) return null;
    const fill = floodFill(terrain, r, i0, level, cx, cz, upX, upZ, half + 0.5);
    if (!fill) return null;
    const geo = { cell, cx, cz, upX, upZ, ends: [w0, w1] as [Vec3, Vec3], floorY, crestY, level };
    return new Reservoir(terrain, index, si, crossing, geo, fill, scale);
  }

  /** Water stored (m³) when the lake stands at `level`. */
  volumeAt(level: number): number {
    const a = this.sorted;
    let lo = 0;
    let hi = a.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (a[mid] < level) lo = mid + 1;
      else hi = mid;
    }
    return this.cellArea * (lo * level - this.prefix[lo]);
  }

  /** True when (x, z) lies in the footprint (any corner of its grid cell is lake). */
  contains(x: number, z: number): boolean {
    const g = this.terrain.grid;
    const fx = (x - g.originX) / g.cellSize - this.ix0;
    const fz = (z - g.originZ) / g.cellSize - this.iz0;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    if (ix < -1 || iz < -1 || ix >= this.cols || iz >= this.rows) return false;
    const m = this.mask;
    const c = this.cols;
    for (let dz = 0; dz <= 1; dz++) {
      const j = iz + dz;
      if (j < 0 || j >= this.rows) continue;
      for (let dx = 0; dx <= 1; dx++) {
        const i = ix + dx;
        if (i >= 0 && i < c && m[j * c + i] === 1) return true;
      }
    }
    return false;
  }

  /** Share (0..1) of the head that has drained since the breach (0 while intact). */
  get drained(): number {
    if (!this.broken || !(this.head0 > 0)) return 0;
    return Math.min(1, Math.max(0, 1 - (this.level - this.breachFloor) / this.head0));
  }

  /**
   * A body of this dam broke at `pos` (its origin, ~ the foot of the monolith): a breach if its foot
   * was under water. Returns true when the lake starts (or keeps) draining because of it.
   */
  breakAt(pos: Vec3): boolean {
    const g = this.terrain.heightAt(pos.x, pos.z);
    const floor = Math.max(Math.min(g, pos.y + 0.5), this.floorY);
    if (!(floor < this.level - 0.3)) return false;
    this.breachWidth += RESERVOIR.breachWidth * this.scale;
    this.breachFloor = this.broken ? Math.min(this.breachFloor, floor) : floor;
    if (!this.broken) {
      this.bx = pos.x;
      this.bz = pos.z;
    }
    this.broken = true;
    this.drainTime = 0;
    this.head0 = Math.max(this.level - this.breachFloor, 0.01);
    // The most the breach can pass (at the start, with the full head).
    const weir = RESERVOIR.weir * this.breachWidth * Math.pow(this.head0, 1.5);
    this.qPeak = Math.min(weir, RESERVOIR.floodMax);
    return true;
  }

  /** Advance the drain by dt. Returns true when the level changed. */
  step(dt: number): boolean {
    if (!this.broken) {
      this.outflow = 0;
      return false;
    }
    this.drainTime += dt;
    const k = 1 + this.drainTime / RESERVOIR.drainTau;
    const head = this.head0 / (k * k);
    const before = this.level;
    this.level = this.breachFloor + head;
    // The flood carries what the lake lost, up to what the breach passes at this head.
    const lost = (this.volumeAt(before) - this.volumeAt(this.level)) / dt;
    const weir = RESERVOIR.weir * this.breachWidth * Math.pow(head, 1.5);
    this.outflow = Math.max(0, Math.min(lost, weir, RESERVOIR.floodMax));
    return Math.abs(before - this.level) > 1e-5;
  }
}

/**
 * Footprint of a lake standing at `level`: grid vertices below it, 4-connected to the stream cells
 * just upstream of the crossing, on the upstream side of the dam's line (at least `keep` m from it).
 */
function floodFill(
  terrain: GeneratedTerrain,
  r: StreamInfo['reach'],
  crossingCell: number,
  level: number,
  cx: number,
  cz: number,
  upX: number,
  upZ: number,
  keep: number,
): { ix0: number; iz0: number; cols: number; rows: number; mask: Uint8Array; heights: number[] } | null {
  const g = terrain.grid;
  const { cols, rows, cellSize, originX, originZ, heights } = g;
  const seen = new Uint8Array(cols * rows);
  const queue = new Int32Array(Math.min(cols * rows, RESERVOIR.maxVertices) + 8);
  let qh = 0;
  let qt = 0;
  const maxR2 = RESERVOIR.maxReach * RESERVOIR.maxReach;
  const ok = (ix: number, iz: number): boolean => {
    const i = iz * cols + ix;
    if (seen[i]) return false;
    if (!(heights[i] < level)) return false;
    const x = originX + ix * cellSize - cx;
    const z = originZ + iz * cellSize - cz;
    if (x * upX + z * upZ < keep) return false;
    return x * x + z * z <= maxR2;
  };
  const push = (ix: number, iz: number): void => {
    if (ix < 0 || iz < 0 || ix >= cols || iz >= rows || qt >= queue.length || !ok(ix, iz)) return;
    seen[iz * cols + ix] = 1;
    queue[qt++] = iz * cols + ix;
  };
  // Seeds: the stream's cells up to ~16 m upstream of the dam.
  const reach = Math.ceil(16 / HYDRO.cell);
  for (let i = crossingCell; i >= Math.max(0, crossingCell - reach); i--) {
    push(Math.round((r.x[i] - originX) / cellSize), Math.round((r.z[i] - originZ) / cellSize));
  }
  let ix0 = cols;
  let iz0 = rows;
  let ix1 = -1;
  let iz1 = -1;
  while (qh < qt) {
    const i = queue[qh++];
    const ix = i % cols;
    const iz = (i - ix) / cols;
    if (ix < ix0) ix0 = ix;
    if (ix > ix1) ix1 = ix;
    if (iz < iz0) iz0 = iz;
    if (iz > iz1) iz1 = iz;
    push(ix + 1, iz);
    push(ix - 1, iz);
    push(ix, iz + 1);
    push(ix, iz - 1);
  }
  if (qt === 0) return null;
  const wc = ix1 - ix0 + 1;
  const wr = iz1 - iz0 + 1;
  const mask = new Uint8Array(wc * wr);
  const hs: number[] = [];
  for (let k = 0; k < qt; k++) {
    const i = queue[k];
    const ix = i % cols;
    const iz = (i - ix) / cols;
    mask[(iz - iz0) * wc + (ix - ix0)] = 1;
    hs.push(heights[i]);
  }
  return { ix0, iz0, cols: wc, rows: wr, mask, heights: hs };
}
