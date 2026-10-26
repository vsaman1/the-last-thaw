/**
 * Non-uniform Catmull-Rom spline (Barry–Goldman pyramid) over keyframes stored as rows of `dim`
 * numbers. Knots are explicit times, so velocity stays continuous across keyframes even when they
 * are unevenly spaced. End segments use mirrored phantom keys. Allocation-free evaluation.
 */
export class KeyframeSpline {
  readonly dim: number;
  readonly capacity: number;
  readonly data: Float64Array;
  readonly knots: Float64Array;
  count = 0;

  constructor(dim: number, capacity: number) {
    this.dim = dim;
    this.capacity = capacity;
    this.data = new Float64Array(dim * capacity);
    this.knots = new Float64Array(capacity);
  }

  /** Value of component `c` of key `i`, with mirrored phantom keys at i = -1 and i = count. */
  private value(i: number, c: number): number {
    const d = this.dim;
    const n = this.count;
    if (i < 0) return 2 * this.data[c] - this.data[d + c];
    if (i >= n) return 2 * this.data[(n - 1) * d + c] - this.data[(n - 2) * d + c];
    return this.data[i * d + c];
  }

  private knot(i: number): number {
    const n = this.count;
    const k = this.knots;
    if (i < 0) return 2 * k[0] - k[1];
    if (i >= n) return 2 * k[n - 1] - k[n - 2];
    return k[i];
  }

  get start(): number {
    return this.knots[0];
  }

  get end(): number {
    return this.knots[this.count - 1];
  }

  /** Evaluate at knot time `t` (clamped to the key range) into `out` (length >= dim). */
  evaluate(t: number, out: Float64Array): void {
    const n = this.count;
    const d = this.dim;
    if (n === 1) {
      for (let c = 0; c < d; c++) out[c] = this.data[c];
      return;
    }
    const k = this.knots;
    if (t <= k[0]) t = k[0];
    if (t >= k[n - 1]) t = k[n - 1];
    let i = 0;
    while (i < n - 2 && t > k[i + 1]) i++;

    const t0 = this.knot(i - 1);
    const t1 = k[i];
    const t2 = k[i + 1];
    const t3 = this.knot(i + 2);

    const a10 = (t1 - t) / (t1 - t0);
    const a11 = (t - t0) / (t1 - t0);
    const a21 = (t2 - t) / (t2 - t1);
    const a22 = (t - t1) / (t2 - t1);
    const a32 = (t3 - t) / (t3 - t2);
    const a33 = (t - t2) / (t3 - t2);
    const b1a = (t2 - t) / (t2 - t0);
    const b1b = (t - t0) / (t2 - t0);
    const b2a = (t3 - t) / (t3 - t1);
    const b2b = (t - t1) / (t3 - t1);
    const ca = a21;
    const cb = a22;

    const w0 = ca * b1a * a10;
    const w1 = ca * (b1a * a11 + b1b * a21) + cb * b2a * a21;
    const w2 = ca * b1b * a22 + cb * (b2a * a22 + b2b * a32);
    const w3 = cb * b2b * a33;

    for (let c = 0; c < d; c++) {
      out[c] =
        w0 * this.value(i - 1, c) +
        w1 * this.value(i, c) +
        w2 * this.value(i + 1, c) +
        w3 * this.value(i + 2, c);
    }
  }
}
