import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { SegmentGrid } from './segmentGrid';

const SEED = 42;

function listOf(grid: SegmentGrid, key: number): number[] {
  const slot = grid.find(key);
  return slot < 0 ? [] : grid.list(slot).slice(0, grid.size(slot));
}

describe('SegmentGrid', () => {
  it('matches a Map of arrays, in insertion order, while both tables grow', () => {
    const rnd = createRng(SEED);
    // a tiny initial slot table so it doubles several times
    const grid = new SegmentGrid(16);
    const ref = new Map<number, number[]>();
    for (let seg = 0; seg < 6000; seg++) {
      // clustered keys like a river's cells, plus a few far-flung ones
      const key = rnd() < 0.9 ? Math.floor(rnd() * 900) : Math.floor(rnd() * 0x3fffffff);
      grid.add(key, seg);
      const list = ref.get(key);
      if (list) list.push(seg);
      else ref.set(key, [seg]);
    }
    expect(grid.cellCount).toBe(ref.size);
    expect(grid.entryCount).toBe(6000);
    for (const [key, list] of ref) expect(listOf(grid, key)).toEqual(list);
    for (let key = 900; key < 1900; key++) {
      if (!ref.has(key)) expect(grid.find(key)).toBe(-1);
    }
  });

  it('is empty after clear and refills correctly, reusing the old lists', () => {
    const grid = new SegmentGrid(16);
    for (let i = 0; i < 100; i++) grid.add(i % 13, i);
    grid.clear();
    expect(grid.cellCount).toBe(0);
    expect(grid.entryCount).toBe(0);
    for (let k = 0; k < 13; k++) expect(grid.find(k)).toBe(-1);
    grid.add(5, 1);
    grid.add(5, 2);
    grid.add(77, 3);
    expect(listOf(grid, 5)).toEqual([1, 2]);
    expect(listOf(grid, 77)).toEqual([3]);
    expect(grid.cellCount).toBe(2);
  });
});
