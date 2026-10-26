import { HYDRO } from './tuning';

/** A dam on a reach (see Reach.sinks). */
export interface ReachSink {
  at: number;
  inflow: number;
  sunk: number;
}

/**
 * A reach: a chain of cells `dx` m long along a stream (or a captured river) that hold water and
 * pass it downstream. Each cell has a wetted cross-section area A (m²); its depth h follows from a
 * rectangular channel `width` m wide up to its bank-full depth `bank`, above which the water widens
 * by HYDRO.floodSpread m per m each side (a flood over the banks, at most floodSpreadMax). It flows
 * at u = U·(h / h0)^(2/3) (Manning's shape; U = the cell's speed at its design depth h0), clamped
 * to [uMinShare·U, uMax], and passes Q = A·u to the next cell each step (explicit upwind kinematic
 * wave: A += dt/dx · (Qin − Qout); stable while u·dt/dx < 1, i.e. dx = 2 m up to 120 m/s at 60 Hz).
 * Water enters at the head (qIn) and from springs along the reach, leaves at its end (into the sea,
 * a pool, the ground), and can be taken out at a dam (`sinks`: all inflow from upstream goes to the
 * reservoir, what the dam lets through comes out of it) or split off at a capture (divertAt:
 * `divertShare` of what leaves that cell goes into the captured river). Deterministic and
 * allocation-free per step.
 */
export class Reach {
  n = 0;
  readonly dx: number;
  /** Cell centres, unit downstream direction, arc length from the reach's start (m). */
  x: Float64Array;
  z: Float64Array;
  dirX: Float64Array;
  dirZ: Float64Array;
  arc: Float64Array;
  /** Bed height (m): the water surface is baseY + h. */
  baseY: Float64Array;
  /** Channel width (m), bank-full depth (m), speed scale U (m/s) and design depth h0 (m). */
  width: Float64Array;
  bank: Float64Array;
  speed: Float64Array;
  h0: Float64Array;
  /** Half width between the bank tops (m), for queries and drawing. */
  topHalf: Float64Array;
  /** Baseline turbulence (bends, rapids, plunge pools) and waterfall flag (0/1). */
  turb: Float64Array;
  fall: Float64Array;
  /** Multiplier (0..1) on the current reported to bodies and the iceberg: 0 = still water. */
  still: Float64Array;
  /** Water entering each cell from the side (m³/s): springs along a stream's first metres. */
  springs: Float64Array;
  /** Depth of the steady state the reach started in (m), to tell a flood from normal flow. */
  steady: Float64Array;
  /** State: wetted area (m²), and the depth and speed it gave at the last step. */
  A: Float64Array;
  h: Float64Array;
  u: Float64Array;
  private Q: Float64Array;

  /** Inflow at the head (m³/s). */
  qIn = 0;
  /**
   * Dams: at each sink's cell the inflow from upstream is taken into its reservoir (`sunk`, m³/s at
   * the last step) and replaced by `inflow` (what the dam lets through).
   */
  readonly sinks: ReachSink[] = [];
  /** Capture: cell whose outflow is split, the share diverted and the diverted discharge (m³/s). */
  divertAt = -1;
  divertShare = 0;
  diverted = 0;
  /** Rejoin: cell receiving `joinQ` m³/s (a captured river coming back). */
  joinAt = -1;
  joinQ = 0;
  /** Discharge out of the last cell at the last step (m³/s). */
  outflow = 0;

  constructor(capacity: number, dx: number = HYDRO.cell) {
    this.dx = dx;
    const cap = Math.max(2, capacity);
    this.x = new Float64Array(cap);
    this.z = new Float64Array(cap);
    this.dirX = new Float64Array(cap);
    this.dirZ = new Float64Array(cap);
    this.arc = new Float64Array(cap);
    this.baseY = new Float64Array(cap);
    this.width = new Float64Array(cap);
    this.bank = new Float64Array(cap);
    this.speed = new Float64Array(cap);
    this.h0 = new Float64Array(cap);
    this.topHalf = new Float64Array(cap);
    this.turb = new Float64Array(cap);
    this.fall = new Float64Array(cap);
    this.still = new Float64Array(cap);
    this.springs = new Float64Array(cap);
    this.steady = new Float64Array(cap);
    this.A = new Float64Array(cap);
    this.h = new Float64Array(cap);
    this.u = new Float64Array(cap);
    this.Q = new Float64Array(cap);
  }

  get capacity(): number {
    return this.x.length;
  }

  /** Grow the arrays to hold at least `min` cells (keeps the contents). */
  reserve(min: number): void {
    if (min <= this.capacity) return;
    const cap = Math.max(min, this.capacity * 2);
    const grow = (a: Float64Array): Float64Array => {
      const b = new Float64Array(cap);
      b.set(a);
      return b;
    };
    this.x = grow(this.x);
    this.z = grow(this.z);
    this.dirX = grow(this.dirX);
    this.dirZ = grow(this.dirZ);
    this.arc = grow(this.arc);
    this.baseY = grow(this.baseY);
    this.width = grow(this.width);
    this.bank = grow(this.bank);
    this.speed = grow(this.speed);
    this.h0 = grow(this.h0);
    this.topHalf = grow(this.topHalf);
    this.turb = grow(this.turb);
    this.fall = grow(this.fall);
    this.still = grow(this.still);
    this.springs = grow(this.springs);
    this.steady = grow(this.steady);
    this.A = grow(this.A);
    this.h = grow(this.h);
    this.u = grow(this.u);
    this.Q = grow(this.Q);
  }

  /** Depth (m) of cell i holding `area` m² (rectangle up to the bank, then widening). */
  depthOf(i: number, area: number): number {
    const W = Math.max(this.width[i], 0.1);
    const B = this.bank[i];
    if (!(area > 0)) return 0;
    if (area <= W * B) return area / W;
    const k = HYDRO.floodSpread;
    const eMax = HYDRO.floodSpreadMax / k;
    const rest = area - W * B;
    const atMax = W * eMax + k * eMax * eMax;
    if (rest <= atMax) return B + (-W + Math.sqrt(W * W + 4 * k * rest)) / (2 * k);
    return B + eMax + (rest - atMax) / (W + 2 * HYDRO.floodSpreadMax);
  }

  /** Area (m²) of cell i at depth h (inverse of depthOf). */
  areaOf(i: number, h: number): number {
    const W = Math.max(this.width[i], 0.1);
    const B = this.bank[i];
    if (!(h > 0)) return 0;
    if (h <= B) return W * h;
    const k = HYDRO.floodSpread;
    const eMax = HYDRO.floodSpreadMax / k;
    const e = h - B;
    if (e <= eMax) return W * B + W * e + k * e * e;
    return W * B + W * eMax + k * eMax * eMax + (W + 2 * HYDRO.floodSpreadMax) * (e - eMax);
  }

  /** Speed (m/s) of cell i at depth h. */
  speedAt(i: number, h: number): number {
    const U = this.speed[i];
    const h0 = Math.max(this.h0[i], 0.05);
    const u = U * Math.cbrt((h / h0) * (h / h0));
    return Math.min(Math.max(u, HYDRO.uMinShare * U), HYDRO.uMax);
  }

  /** Half width (m) of the water surface of cell i at depth h (0 when dry). */
  waterHalf(i: number, h: number): number {
    if (!(h > HYDRO.dry)) return 0;
    const top = this.topHalf[i];
    const B = this.bank[i];
    if (h <= B) {
      // The channel's sloping banks: half the bed at the bottom, the full top at the bank tops.
      return top * (0.5 + 0.5 * Math.min(1, h / Math.max(B, 1e-3)));
    }
    return top + Math.min(HYDRO.floodSpread * (h - B), HYDRO.floodSpreadMax);
  }

  /** Area of cell i carrying q m³/s steadily (bisection on the depth). */
  steadyArea(i: number, q: number): number {
    if (!(q > 0)) return 0;
    let lo = 0;
    let hi = this.bank[i] + 40;
    for (let k = 0; k < 48; k++) {
      const mid = 0.5 * (lo + hi);
      if (this.areaOf(i, mid) * this.speedAt(i, mid) < q) lo = mid;
      else hi = mid;
    }
    return this.areaOf(i, 0.5 * (lo + hi));
  }

  /**
   * Fill cells from `from` to n−1 with the steady state of a discharge q (+ springs on the way);
   * `baseline`: also record it as the depth a flood is measured against (`steady`).
   */
  settle(q: number, from = 0, baseline = true): void {
    let flow = q;
    for (let i = from; i < this.n; i++) {
      flow += this.springs[i];
      this.A[i] = this.steadyArea(i, flow);
      this.h[i] = this.depthOf(i, this.A[i]);
      this.u[i] = this.speedAt(i, this.h[i]);
      if (baseline) this.steady[i] = this.h[i];
    }
  }

  /** Advance the water by dt. Returns the largest change of depth (m) in any cell. */
  step(dt: number): number {
    const n = this.n;
    if (n === 0 || !(dt > 0)) return 0;
    const A = this.A;
    const Q = this.Q;
    const k = dt / this.dx;
    for (let i = 0; i < n; i++) {
      const a = A[i];
      const h = this.depthOf(i, a);
      this.h[i] = h;
      const u = h > 0 ? this.speedAt(i, h) : 0;
      this.u[i] = u;
      // Never pass on more than the cell holds.
      Q[i] = Math.min(a * u, a / k);
    }
    this.diverted = 0;
    const sinks = this.sinks;
    let change = 0;
    for (let i = 0; i < n; i++) {
      let inflow = i === 0 ? this.qIn : Q[i - 1];
      if (i - 1 === this.divertAt && i > 0) {
        this.diverted = inflow * this.divertShare;
        inflow -= this.diverted;
      }
      for (let s = 0; s < sinks.length; s++) {
        if (sinks[s].at !== i) continue;
        sinks[s].sunk = inflow;
        inflow = sinks[s].inflow;
      }
      if (i === this.joinAt) inflow += this.joinQ;
      inflow += this.springs[i];
      const next = Math.max(0, A[i] + k * (inflow - Q[i]));
      const dh = Math.abs(this.depthOf(i, next) - this.h[i]);
      if (dh > change) change = dh;
      A[i] = next;
    }
    this.outflow = Q[n - 1];
    // Depth and speed after the update (what queries and drawing read).
    for (let i = 0; i < n; i++) {
      const h = this.depthOf(i, A[i]);
      this.h[i] = h;
      this.u[i] = h > 0 ? this.speedAt(i, h) : 0;
    }
    return change;
  }
}
