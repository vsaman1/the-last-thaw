/**
 * Spatial hash of river segments for flowAt/disturb: every cell lists, in insertion order, the
 * segments added to it. The full rebuild after a decimation pass adds every segment to every cell
 * its box covers (tens of thousands of entries for a wide river), so cells are found by open
 * addressing on an Int32Array rather than a Map, and each cell's list is a contiguous array (fast
 * to scan, unlike a linked list) whose capacity survives clear(): a rebuild only writes numbers.
 * Cell keys must be non-negative int32s (-1 marks a free slot).
 */

const EMPTY = -1;
const NO_LIST: number[] = [];

export class SegmentGrid {
  private keys: Int32Array;
  private sizes: Int32Array;
  private lists: number[][];
  private shift: number;
  private readonly pool: number[][] = [];
  private used = 0;
  private count = 0;

  constructor(cellSlots = 4096) {
    const slots = 1 << Math.max(4, Math.ceil(Math.log2(cellSlots)));
    this.keys = new Int32Array(slots).fill(EMPTY);
    this.sizes = new Int32Array(slots);
    this.lists = new Array<number[]>(slots).fill(NO_LIST);
    this.shift = 32 - Math.log2(slots);
  }

  /** Distinct non-empty cells. */
  get cellCount(): number {
    return this.used;
  }

  /** Total (cell, segment) entries. */
  get entryCount(): number {
    return this.count;
  }

  clear(): void {
    if (this.used === 0) return;
    const keys = this.keys;
    for (let h = 0; h < keys.length; h++) {
      if (keys[h] === EMPTY) continue;
      this.pool.push(this.lists[h]);
      this.lists[h] = NO_LIST;
    }
    keys.fill(EMPTY);
    this.used = 0;
    this.count = 0;
  }

  /** Slot of cell `key` for list()/size(), or -1 if the cell is empty. */
  find(key: number): number {
    const keys = this.keys;
    const mask = keys.length - 1;
    let h = Math.imul(key, 0x9e3779b1) >>> this.shift;
    for (;;) {
      const k = keys[h];
      if (k === key) return h;
      if (k === EMPTY) return -1;
      h = (h + 1) & mask;
    }
  }

  /** The segments of the cell in `slot`: only the first size(slot) entries are valid. */
  list(slot: number): readonly number[] {
    return this.lists[slot];
  }

  size(slot: number): number {
    return this.sizes[slot];
  }

  add(key: number, segment: number): void {
    if (2 * (this.used + 1) > this.keys.length) this.growCells();
    const keys = this.keys;
    const mask = keys.length - 1;
    let h = Math.imul(key, 0x9e3779b1) >>> this.shift;
    let k = keys[h];
    while (k !== key && k !== EMPTY) {
      h = (h + 1) & mask;
      k = keys[h];
    }
    if (k === EMPTY) {
      keys[h] = key;
      this.lists[h] = this.pool.pop() ?? [];
      this.sizes[h] = 0;
      this.used++;
    }
    const list = this.lists[h];
    const n = this.sizes[h];
    if (n < list.length) list[n] = segment;
    else list.push(segment);
    this.sizes[h] = n + 1;
    this.count++;
  }

  /** Double the slot table; each cell keeps its list. */
  private growCells(): void {
    const oldKeys = this.keys;
    const oldSizes = this.sizes;
    const oldLists = this.lists;
    const slots = oldKeys.length * 2;
    const keys = new Int32Array(slots).fill(EMPTY);
    const sizes = new Int32Array(slots);
    const lists = new Array<number[]>(slots).fill(NO_LIST);
    const mask = slots - 1;
    this.shift--;
    for (let i = 0; i < oldKeys.length; i++) {
      const key = oldKeys[i];
      if (key === EMPTY) continue;
      let h = Math.imul(key, 0x9e3779b1) >>> this.shift;
      while (keys[h] !== EMPTY) h = (h + 1) & mask;
      keys[h] = key;
      sizes[h] = oldSizes[i];
      lists[h] = oldLists[i];
    }
    this.keys = keys;
    this.sizes = sizes;
    this.lists = lists;
  }
}
