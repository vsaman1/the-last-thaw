import type { CoursePoint } from '../types';
import { clamp } from '../math';

/**
 * Course centreline geometry: centripetal Catmull-Rom through the level control points, resampled
 * into a uniform polyline (~2 m spacing) with smoothed floor and half-width profiles, plus a
 * precomputed spatial hash so nearest-point projection is cheap for any world point.
 */

/** Result of projecting a world point onto the course. */
export interface CourseProjection {
  /** Arc length of the nearest centreline point, clamped to [0, length]. */
  s: number;
  /** Arc length extrapolated along the end tangents (negative before the start, > length past the end). */
  sExt: number;
  /** Signed lateral offset; positive = right of travel. Beyond the ends: offset from the end tangent line. */
  d: number;
}

export interface CourseGeometryOptions {
  /** Target spacing of the resampled polyline (m). */
  spacing?: number;
  /** Half-window of the moving average applied to the floor profile (m). */
  floorSmoothRadius?: number;
  /** Half-window of the moving average applied to the half-width profile (m). */
  widthSmoothRadius?: number;
  /** Spatial-hash cell size (m). */
  hashCell?: number;
  /** Extra margin around the bounds covered by the hash (m); queries outside fall back to brute force. */
  hashMargin?: number;
}

const ALPHA = 0.5;
/** Polyline segments per bounding-circle group in the projection hash. */
const GROUP = 8;

function knot(ax: number, az: number, bx: number, bz: number): number {
  return Math.max(1e-4, Math.pow(Math.hypot(bx - ax, bz - az), ALPHA));
}

/** Barry–Goldman pyramid evaluation of one coordinate of a centripetal Catmull-Rom segment. */
function barryGoldman(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t0: number,
  t1: number,
  t2: number,
  t3: number,
  t: number,
): number {
  const a1 = ((t1 - t) * p0 + (t - t0) * p1) / (t1 - t0);
  const a2 = ((t2 - t) * p1 + (t - t1) * p2) / (t2 - t1);
  const a3 = ((t3 - t) * p2 + (t - t2) * p3) / (t3 - t2);
  const b1 = ((t2 - t) * a1 + (t - t0) * a2) / (t2 - t0);
  const b2 = ((t3 - t) * a2 + (t - t1) * a3) / (t3 - t1);
  return ((t2 - t) * b1 + (t - t1) * b2) / (t2 - t1);
}

interface DenseCurve {
  x: number[];
  z: number[];
  s: number[];
  controlS: number[];
}

function denseCatmullRom(pts: readonly CoursePoint[]): DenseCurve {
  const n = pts.length;
  const px = (i: number): number =>
    i < 0 ? 2 * pts[0].x - pts[1].x : i >= n ? 2 * pts[n - 1].x - pts[n - 2].x : pts[i].x;
  const pz = (i: number): number =>
    i < 0 ? 2 * pts[0].z - pts[1].z : i >= n ? 2 * pts[n - 1].z - pts[n - 2].z : pts[i].z;

  const out: DenseCurve = { x: [pts[0].x], z: [pts[0].z], s: [0], controlS: [0] };
  let acc = 0;
  for (let i = 0; i < n - 1; i++) {
    const x0 = px(i - 1);
    const z0 = pz(i - 1);
    const x1 = px(i);
    const z1 = pz(i);
    const x2 = px(i + 1);
    const z2 = pz(i + 1);
    const x3 = px(i + 2);
    const z3 = pz(i + 2);
    const t0 = 0;
    const t1 = t0 + knot(x0, z0, x1, z1);
    const t2 = t1 + knot(x1, z1, x2, z2);
    const t3 = t2 + knot(x2, z2, x3, z3);
    const steps = Math.max(8, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 0.5));
    let lx = x1;
    let lz = z1;
    for (let k = 1; k <= steps; k++) {
      const t = t1 + ((t2 - t1) * k) / steps;
      const cx = k === steps ? x2 : barryGoldman(x0, x1, x2, x3, t0, t1, t2, t3, t);
      const cz = k === steps ? z2 : barryGoldman(z0, z1, z2, z3, t0, t1, t2, t3, t);
      acc += Math.hypot(cx - lx, cz - lz);
      out.x.push(cx);
      out.z.push(cz);
      out.s.push(acc);
      lx = cx;
      lz = cz;
    }
    out.controlS.push(acc);
  }
  return out;
}

/** Piecewise-linear interpolation through (xs, ys); linear extrapolation or clamping beyond the ends. */
function piecewiseLinear(
  xs: readonly number[],
  ys: readonly number[],
  x: number,
  extrapolate: boolean,
): number {
  const n = xs.length;
  if (x <= xs[0]) {
    if (!extrapolate) return ys[0];
    return ys[0] + ((ys[1] - ys[0]) / (xs[1] - xs[0])) * (x - xs[0]);
  }
  if (x >= xs[n - 1]) {
    if (!extrapolate) return ys[n - 1];
    return ys[n - 1] + ((ys[n - 1] - ys[n - 2]) / (xs[n - 1] - xs[n - 2])) * (x - xs[n - 1]);
  }
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + (ys[hi] - ys[lo]) * t;
}

/** Moving average over [x - r, x + r] sampled every metre (keeps a monotone input monotone). */
function movingAverage(fn: (x: number) => number, x: number, r: number): number {
  const k = Math.max(0, Math.round(r));
  let sum = 0;
  for (let i = -k; i <= k; i++) sum += fn(x + i);
  return sum / (2 * k + 1);
}

export class CourseGeometry {
  readonly length: number;
  /** Number of polyline vertices (segments = count - 1). */
  readonly count: number;
  /** Arc-length spacing between polyline vertices. */
  readonly spacing: number;
  readonly x: Float64Array;
  readonly z: Float64Array;
  /** Unit tangent at each vertex. */
  readonly dirX: Float64Array;
  readonly dirZ: Float64Array;
  /** Smoothed control-point floor (no cliffs, no coast shaping). */
  readonly floorBase: Float64Array;
  readonly halfWidth: Float64Array;
  /** Arc length of each level control point on the smoothed curve. */
  readonly controlS: Float64Array;
  /** Slope (drop per metre) used to extrapolate the floor before the start / past the end. */
  readonly startSlope: number;
  readonly endSlope: number;

  private readonly hashMinX: number;
  private readonly hashMinZ: number;
  private readonly hashCell: number;
  private readonly hashCols: number;
  private readonly hashRows: number;
  private readonly cellStart: Int32Array;
  /** Group indices per hash cell (CSR layout with cellStart). */
  private readonly cellItems: Int32Array;
  private readonly groups: number;
  private readonly groupX: Float64Array;
  private readonly groupZ: Float64Array;
  private readonly groupR: Float64Array;

  constructor(
    points: readonly CoursePoint[],
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
    opts: CourseGeometryOptions = {},
  ) {
    if (points.length < 2) throw new Error('A course needs at least two control points');
    const targetSpacing = opts.spacing ?? 2;
    const floorR = opts.floorSmoothRadius ?? 16;
    const widthR = opts.widthSmoothRadius ?? 30;

    const dense = denseCatmullRom(points);
    const length = dense.s[dense.s.length - 1];
    const segs = Math.max(1, Math.round(length / targetSpacing));
    const count = segs + 1;
    const spacing = length / segs;
    this.length = length;
    this.count = count;
    this.spacing = spacing;
    this.controlS = Float64Array.from(dense.controlS);

    const x = new Float64Array(count);
    const z = new Float64Array(count);
    let j = 0;
    for (let i = 0; i < count; i++) {
      const target = i === count - 1 ? length : i * spacing;
      while (j < dense.s.length - 2 && dense.s[j + 1] < target) j++;
      const span = dense.s[j + 1] - dense.s[j];
      const t = span > 0 ? clamp((target - dense.s[j]) / span, 0, 1) : 0;
      x[i] = dense.x[j] + (dense.x[j + 1] - dense.x[j]) * t;
      z[i] = dense.z[j] + (dense.z[j + 1] - dense.z[j]) * t;
    }
    this.x = x;
    this.z = z;

    const dirX = new Float64Array(count);
    const dirZ = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(count - 1, i + 1);
      const ex = x[b] - x[a];
      const ez = z[b] - z[a];
      const len = Math.hypot(ex, ez) || 1;
      dirX[i] = ex / len;
      dirZ[i] = ez / len;
    }
    this.dirX = dirX;
    this.dirZ = dirZ;

    const cs = dense.controlS;
    const floors = points.map((p) => p.floor);
    const widths = points.map((p) => p.halfWidth);
    const floorFn = (s: number): number => piecewiseLinear(cs, floors, s, true);
    const widthFn = (s: number): number => piecewiseLinear(cs, widths, s, false);
    this.floorBase = new Float64Array(count);
    this.halfWidth = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const s = i * spacing;
      this.floorBase[i] = movingAverage(floorFn, s, floorR);
      this.halfWidth[i] = movingAverage(widthFn, s, widthR);
    }
    const n = points.length;
    this.startSlope = (floors[0] - floors[1]) / (cs[1] - cs[0]);
    this.endSlope = (floors[n - 2] - floors[n - 1]) / (cs[n - 1] - cs[n - 2]);

    // Segments are bucketed into groups with bounding circles; each hash cell lists every group
    // that can hold the nearest segment for some point inside the cell.
    const groups = Math.ceil(segs / GROUP);
    this.groups = groups;
    this.centreD2 = new Float64Array(groups);
    this.groupX = new Float64Array(groups);
    this.groupZ = new Float64Array(groups);
    this.groupR = new Float64Array(groups);
    for (let gi = 0; gi < groups; gi++) {
      const k0 = gi * GROUP;
      const k1 = Math.min(segs, k0 + GROUP);
      let lx = Infinity;
      let hx = -Infinity;
      let lz = Infinity;
      let hz = -Infinity;
      for (let k = k0; k <= k1; k++) {
        lx = Math.min(lx, x[k]);
        hx = Math.max(hx, x[k]);
        lz = Math.min(lz, z[k]);
        hz = Math.max(hz, z[k]);
      }
      const gx = (lx + hx) / 2;
      const gz = (lz + hz) / 2;
      let r = 0;
      for (let k = k0; k <= k1; k++) r = Math.max(r, Math.hypot(x[k] - gx, z[k] - gz));
      this.groupX[gi] = gx;
      this.groupZ[gi] = gz;
      this.groupR[gi] = r + 1e-6;
    }

    const cell = opts.hashCell ?? 20;
    const margin = opts.hashMargin ?? 240;
    this.hashCell = cell;
    this.hashMinX = Math.min(bounds.minX, ...points.map((p) => p.x)) - margin;
    this.hashMinZ = Math.min(bounds.minZ, ...points.map((p) => p.z)) - margin;
    const maxX = Math.max(bounds.maxX, ...points.map((p) => p.x)) + margin;
    const maxZ = Math.max(bounds.maxZ, ...points.map((p) => p.z)) + margin;
    this.hashCols = Math.ceil((maxX - this.hashMinX) / cell);
    this.hashRows = Math.ceil((maxZ - this.hashMinZ) / cell);
    const cells = this.hashCols * this.hashRows;
    const cellStart = new Int32Array(cells + 1);
    const items: number[] = [];
    const centreDist = new Float64Array(groups);
    const half = cell * Math.SQRT1_2;
    for (let cj = 0; cj < this.hashRows; cj++) {
      const cz = this.hashMinZ + (cj + 0.5) * cell;
      for (let ci = 0; ci < this.hashCols; ci++) {
        const cx = this.hashMinX + (ci + 0.5) * cell;
        // upper = an upper bound on the nearest-segment distance from the cell centre.
        let upper = Infinity;
        for (let gi = 0; gi < groups; gi++) {
          const dc = Math.hypot(cx - this.groupX[gi], cz - this.groupZ[gi]);
          centreDist[gi] = dc;
          if (dc + this.groupR[gi] < upper) upper = dc + this.groupR[gi];
        }
        // For p in the cell: nearest(p) <= upper + half, and a group's distance from p is at least
        // its centre distance from the cell centre minus (radius + half).
        const limit = upper + 2 * half + 0.01;
        cellStart[cj * this.hashCols + ci] = items.length;
        for (let gi = 0; gi < groups; gi++) if (centreDist[gi] - this.groupR[gi] <= limit) items.push(gi);
      }
    }
    cellStart[cells] = items.length;
    this.cellStart = cellStart;
    this.cellItems = Int32Array.from(items);
  }

  private qBest = 0;
  private qK = 0;
  private qT = 0;
  /** Per-query scratch: squared centre distance of each candidate group. */
  private readonly centreD2: Float64Array;

  /** Tests the segments of group `gi` against (px, pz), updating the query's best match. */
  private testGroup(gi: number, px: number, pz: number): void {
    const k0 = gi * GROUP;
    const k1 = Math.min(this.count - 1, k0 + GROUP);
    for (let k = k0; k < k1; k++) {
      const ax = this.x[k];
      const az = this.z[k];
      const ex = this.x[k + 1] - ax;
      const ez = this.z[k + 1] - az;
      const l2 = ex * ex + ez * ez;
      const t = l2 > 0 ? ((px - ax) * ex + (pz - az) * ez) / l2 : 0;
      const tc = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + ex * tc - px;
      const qz = az + ez * tc - pz;
      const d2 = qx * qx + qz * qz;
      if (d2 < this.qBest) {
        this.qBest = d2;
        this.qK = k;
        this.qT = t;
      }
    }
  }

  /** Fractional polyline index for an arc length (clamped). */
  private locate(s: number): number {
    return clamp(s, 0, this.length) / this.spacing;
  }

  floorBaseAt(s: number): number {
    const f = this.locate(s);
    const i = Math.min(Math.floor(f), this.count - 2);
    const t = f - i;
    return this.floorBase[i] + (this.floorBase[i + 1] - this.floorBase[i]) * t;
  }

  halfWidthAt(s: number): number {
    const f = this.locate(s);
    const i = Math.min(Math.floor(f), this.count - 2);
    const t = f - i;
    return this.halfWidth[i] + (this.halfWidth[i + 1] - this.halfWidth[i]) * t;
  }

  /** Position and unit direction at arc length s (clamped). Writes into `out`. */
  frameAt<T extends { x: number; z: number; dirX: number; dirZ: number }>(s: number, out: T): T {
    const f = this.locate(s);
    const i = Math.min(Math.floor(f), this.count - 2);
    const t = f - i;
    out.x = this.x[i] + (this.x[i + 1] - this.x[i]) * t;
    out.z = this.z[i] + (this.z[i + 1] - this.z[i]) * t;
    const dx = this.dirX[i] + (this.dirX[i + 1] - this.dirX[i]) * t;
    const dz = this.dirZ[i] + (this.dirZ[i + 1] - this.dirZ[i]) * t;
    const len = Math.hypot(dx, dz) || 1;
    out.dirX = dx / len;
    out.dirZ = dz / len;
    return out;
  }

  /** Nearest course coordinates of a world point. Allocation-free; writes into `out`. */
  projectInto(px: number, pz: number, out: CourseProjection): CourseProjection {
    const segs = this.count - 1;
    const ci = Math.floor((px - this.hashMinX) / this.hashCell);
    const cj = Math.floor((pz - this.hashMinZ) / this.hashCell);
    const inHash = ci >= 0 && cj >= 0 && ci < this.hashCols && cj < this.hashRows;
    const start = inHash ? this.cellStart[cj * this.hashCols + ci] : 0;
    const end = inHash ? this.cellStart[cj * this.hashCols + ci + 1] : this.groups;
    // Seed with the group whose centre is closest, then skip groups that cannot beat it.
    const cd = this.centreD2;
    let first = -1;
    let firstD = Infinity;
    for (let q = start; q < end; q++) {
      const gi = inHash ? this.cellItems[q] : q;
      const dx = px - this.groupX[gi];
      const dz = pz - this.groupZ[gi];
      const d2 = dx * dx + dz * dz;
      cd[q - start] = d2;
      if (d2 < firstD) {
        firstD = d2;
        first = gi;
      }
    }
    this.qBest = Infinity;
    this.qK = 0;
    this.qT = 0;
    if (first >= 0) this.testGroup(first, px, pz);
    for (let q = start; q < end; q++) {
      const gi = inHash ? this.cellItems[q] : q;
      if (gi === first) continue;
      const lb = Math.sqrt(cd[q - start]) - this.groupR[gi];
      if (lb > 0 && lb * lb >= this.qBest) continue;
      this.testGroup(gi, px, pz);
    }
    const best = this.qBest;
    const bestK = this.qK;
    const bestT = this.qT;
    const ax = this.x[bestK];
    const az = this.z[bestK];
    const ex = this.x[bestK + 1] - ax;
    const ez = this.z[bestK + 1] - az;
    const len = Math.hypot(ex, ez) || 1;
    const perp = (-(px - ax) * ez + (pz - az) * ex) / len;
    const beyondStart = bestK === 0 && bestT < 0;
    const beyondEnd = bestK === segs - 1 && bestT > 1;
    if (beyondStart || beyondEnd) {
      out.sExt = (bestK + bestT) * this.spacing;
      out.d = perp;
    } else {
      const tc = bestT < 0 ? 0 : bestT > 1 ? 1 : bestT;
      out.sExt = (bestK + tc) * this.spacing;
      out.d = (perp >= 0 ? 1 : -1) * Math.sqrt(best);
    }
    out.s = clamp(out.sExt, 0, this.length);
    return out;
  }
}
