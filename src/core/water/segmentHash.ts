/**
 * Uniform-grid hash of reach segments (cell i → i + 1 of reach r), each inserted into every cell its
 * bounding box grown by a half width touches. Queries read the one cell under the point. Keys alias
 * every 2^15 cells (they only add candidates that the exact test then rejects).
 */
export class SegmentHash {
  private readonly cells = new Map<number, number[]>();
  private readonly inv: number;

  constructor(readonly cellSize: number) {
    this.inv = 1 / cellSize;
  }

  private static key(cx: number, cz: number): number {
    return ((cx & 0x7fff) << 15) | (cz & 0x7fff);
  }

  /** Encoded entry for segment `seg` of reach `reach` (reach < 64, seg < 2^24). */
  static entry(reach: number, seg: number): number {
    return reach * 0x1000000 + seg;
  }

  static reachOf(entry: number): number {
    return Math.floor(entry / 0x1000000);
  }

  static segOf(entry: number): number {
    return entry % 0x1000000;
  }

  insert(entry: number, ax: number, az: number, bx: number, bz: number, half: number): void {
    const inv = this.inv;
    const cx0 = Math.floor((Math.min(ax, bx) - half) * inv);
    const cx1 = Math.floor((Math.max(ax, bx) + half) * inv);
    const cz0 = Math.floor((Math.min(az, bz) - half) * inv);
    const cz1 = Math.floor((Math.max(az, bz) + half) * inv);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const k = SegmentHash.key(cx, cz);
        const list = this.cells.get(k);
        if (list) list.push(entry);
        else this.cells.set(k, [entry]);
      }
    }
  }

  /** Entries whose grown box covers the cell under (x, z), or null. Do not mutate. */
  at(x: number, z: number): readonly number[] | null {
    return this.cells.get(SegmentHash.key(Math.floor(x * this.inv), Math.floor(z * this.inv))) ?? null;
  }

  clear(): void {
    this.cells.clear();
  }

  get size(): number {
    return this.cells.size;
  }
}
