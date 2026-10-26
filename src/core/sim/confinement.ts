import type { IcebergSimTuning } from './params';

/**
 * Trap detection for the stuck rule.
 *
 * The stuck timer only runs while the iceberg is slow and not picking up speed, so an iceberg
 * rocking in a bowl escapes it on every swing: each downhill half "recovers" speed and the bottom of
 * each swing is above stuckSpeed. Left alone it is only failed once the rocking has died out (~30 s).
 *
 * The tracker samples the horizontal position (and the distance travelled) every `confineSample` s
 * over the last `confineWindow` s. The iceberg is TRAPPED when it is back near where it was at least
 * `confineMinAge` s ago although it has travelled at least `confineMinPath` m since: the straight
 * distance to that old sample is at most `confineReturn` × the path since. Rocking, circling and
 * rolling back all cancel out that way; monotone motion (a slow start, a slow climb that makes it,
 * sliding along a wall) never comes back, however slow it is.
 *
 * A trap is a region: the bounding circle of the samples since that old one, grown by
 * `confineEscape` m, and widened to take in every later detection (the first detection only sees
 * part of a swing). The trap is released once the iceberg has stayed outside the region for
 * `confineHold` s without being caught again; the history then starts afresh.
 */

/** The confinement constants (documented on IcebergSimTuning). */
export type ConfinementTuning = Pick<
  IcebergSimTuning,
  | 'confineWindow'
  | 'confineSample'
  | 'confineMinAge'
  | 'confineMinPath'
  | 'confineReturn'
  | 'confineEscape'
  | 'confineHold'
>;

/** A step moving farther than this (m) beyond what its speed allows is a teleport: history reset. */
const TELEPORT = 5;
/** Values per history sample: x, z, path so far, time, stuck timer. */
const STRIDE = 5;

/** Per-iceberg trap detector. Allocation-free after construction. */
export class ConfinementTracker {
  /** True while a trap holds the iceberg (inside its region, or outside it for < confineHold s). */
  trapped = false;
  /** True while trapped and inside the trap region. */
  inside = false;
  /** Trap region (world x/z centre and radius in m) while trapped. */
  cx = 0;
  cz = 0;
  radius = 0;
  /**
   * Set by an update that caught the iceberg coming back: the highest stuck timer it had since the
   * sample it came back to (in hindsight the speed it picked up since got it nowhere); else -1.
   */
  peak = -1;

  private buf: Float64Array = new Float64Array(0);
  private cap = 0;
  private head = 0;
  private count = 0;
  private path = 0;
  private clock = 0;
  private time = 0;
  private outside = 0;
  private lastX = NaN;
  private lastZ = NaN;

  /** Forget the history and any trap (airborne, at sea, teleported, escaped). */
  reset(): void {
    this.trapped = false;
    this.inside = false;
    this.outside = 0;
    this.count = 0;
    this.head = 0;
    this.path = 0;
    this.clock = 0;
    this.lastX = NaN;
    this.lastZ = NaN;
  }

  /**
   * Feed the position after a step of `dt` s at horizontal speed `speed`, with the current stuck
   * `timer`. `eligible` = grounded on land; anything else resets the history. Returns `trapped`.
   */
  update(
    x: number,
    z: number,
    speed: number,
    timer: number,
    dt: number,
    eligible: boolean,
    T: ConfinementTuning,
  ): boolean {
    this.peak = -1;
    if (!eligible || !Number.isFinite(x) || !Number.isFinite(z) || !(T.confineWindow > 0)) {
      this.reset();
      return false;
    }
    const cap = Math.max(2, Math.ceil(T.confineWindow / Math.max(T.confineSample, 1e-3)) + 1);
    if (cap !== this.cap) {
      this.cap = cap;
      this.buf = new Float64Array(cap * STRIDE);
      this.reset();
    }
    if (this.lastX === this.lastX) {
      const jump = Math.hypot(x - this.lastX, z - this.lastZ);
      if (jump > TELEPORT + 2 * Math.max(0, speed) * dt) this.reset();
      else this.path += jump;
    }
    this.lastX = x;
    this.lastZ = z;
    this.time += dt;

    this.clock -= dt;
    if (this.clock <= 0) {
      this.clock = Math.max(0, this.clock + T.confineSample);
      this.push(x, z, timer);
      this.detect(x, z, T);
    }
    if (this.trapped) {
      this.inside = Math.hypot(x - this.cx, z - this.cz) <= this.radius;
      this.outside = this.inside ? 0 : this.outside + dt;
      if (this.outside > T.confineHold) this.reset();
    }
    return this.trapped;
  }

  private push(x: number, z: number, timer: number): void {
    const i = this.head * STRIDE;
    this.buf[i] = x;
    this.buf[i + 1] = z;
    this.buf[i + 2] = this.path;
    this.buf[i + 3] = this.time;
    this.buf[i + 4] = timer;
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
  }

  /** Index into buf of the k-th oldest sample (0 = oldest). */
  private at(k: number): number {
    return ((this.head - this.count + k + this.cap) % this.cap) * STRIDE;
  }

  /** Looks for the oldest sample the iceberg has come back to; traps (or widens the trap) if found. */
  private detect(x: number, z: number, T: ConfinementTuning): void {
    const b = this.buf;
    const now = this.time;
    for (let k = 0; k < this.count - 1; k++) {
      const i = this.at(k);
      if (now - b[i + 3] < T.confineMinAge) return;
      const travelled = this.path - b[i + 2];
      if (travelled < T.confineMinPath) continue;
      if (Math.hypot(x - b[i], z - b[i + 1]) > T.confineReturn * travelled) continue;
      this.addRegion(k, T.confineEscape);
      return;
    }
  }

  /** Traps in (or widens the trap to cover) the bounding circle of the samples from the k-th on. */
  private addRegion(k0: number, escape: number): void {
    const b = this.buf;
    let sx = 0;
    let sz = 0;
    const n = this.count - k0;
    for (let k = k0; k < this.count; k++) {
      const i = this.at(k);
      sx += b[i];
      sz += b[i + 1];
    }
    const cx = sx / n;
    const cz = sz / n;
    let r = 0;
    let peak = 0;
    for (let k = k0; k < this.count; k++) {
      const i = this.at(k);
      r = Math.max(r, Math.hypot(b[i] - cx, b[i + 1] - cz));
      peak = Math.max(peak, b[i + 4]);
    }
    this.peak = peak;
    r += escape;
    if (!this.trapped) {
      this.trapped = true;
      this.cx = cx;
      this.cz = cz;
      this.radius = r;
      return;
    }
    // Smallest circle holding both the old region and the new one.
    const d = Math.hypot(cx - this.cx, cz - this.cz);
    if (d + r <= this.radius) return;
    if (d + this.radius <= r) {
      this.cx = cx;
      this.cz = cz;
      this.radius = r;
      return;
    }
    const R = (d + r + this.radius) / 2;
    const t = (R - this.radius) / d;
    this.cx += (cx - this.cx) * t;
    this.cz += (cz - this.cz) * t;
    this.radius = R;
  }
}
