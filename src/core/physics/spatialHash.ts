/**
 * Uniform grid over the level bounds, rebuilt each step with a counting sort (no per-step
 * allocation once capacity is reached). Items are integer ids with an x/z position.
 */
export class SpatialGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cell: number;
  readonly minX: number;
  readonly minZ: number;
  /** cellStart[c]..cellStart[c+1] index into `items` for cell c. */
  readonly cellStart: Int32Array;
  private readonly cellFill: Int32Array;
  items: Int32Array = new Int32Array(64);
  private cellOf: Int32Array = new Int32Array(64);
  count = 0;

  constructor(minX: number, minZ: number, maxX: number, maxZ: number, cell: number) {
    this.cell = cell;
    this.minX = minX;
    this.minZ = minZ;
    this.cols = Math.max(1, Math.ceil((maxX - minX) / cell));
    this.rows = Math.max(1, Math.ceil((maxZ - minZ) / cell));
    this.cellStart = new Int32Array(this.cols * this.rows + 1);
    this.cellFill = new Int32Array(this.cols * this.rows);
  }

  cellX(x: number): number {
    const c = Math.floor((x - this.minX) / this.cell);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  cellZ(z: number): number {
    const c = Math.floor((z - this.minZ) / this.cell);
    return c < 0 ? 0 : c >= this.rows ? this.rows - 1 : c;
  }

  /** Rebuild from parallel arrays: ids[i] at (xs[i], zs[i]) for i < n. */
  rebuild(n: number, ids: Int32Array, xs: Float64Array, zs: Float64Array): void {
    if (this.items.length < n) {
      const cap = Math.max(n, this.items.length * 2);
      this.items = new Int32Array(cap);
      this.cellOf = new Int32Array(cap);
    }
    const start = this.cellStart;
    start.fill(0);
    for (let i = 0; i < n; i++) {
      const c = this.cellZ(zs[i]) * this.cols + this.cellX(xs[i]);
      this.cellOf[i] = c;
      start[c + 1]++;
    }
    for (let c = 0; c < this.cols * this.rows; c++) start[c + 1] += start[c];
    this.cellFill.set(start.subarray(0, this.cols * this.rows));
    for (let i = 0; i < n; i++) this.items[this.cellFill[this.cellOf[i]]++] = ids[i];
    this.count = n;
  }
}
