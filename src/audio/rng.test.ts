import { describe, expect, it } from 'vitest';
import { createRng } from '../core/rng';
import { RNG_STREAMS, SEED } from './contract';
import { fnv1a, hashSeed, signed, streamRng, streamSeed } from './rng';

const take = (rng: () => number, n: number): number[] => Array.from({ length: n }, () => rng());

describe('seeded streams', () => {
  it('pins the first outputs of mulberry32(42), the seed every stream descends from', () => {
    const first = take(createRng(SEED), 3).map((x) => Number(x.toFixed(10)));
    expect(first).toEqual([0.6011037519, 0.4482905590, 0.8524657935]);
  });

  it('FNV-1a matches the published 32-bit test vectors', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('foobar')).toBe(0xbf9cf968);
  });

  it('the same level, attempt and stream give the same sequence', () => {
    const a = take(streamRng('riverside-town', 3, 'sfx'), 50);
    const b = take(streamRng('riverside-town', 3, 'sfx'), 50);
    expect(a).toEqual(b);
  });

  it('streams are independent: every stream, attempt and level starts differently', () => {
    const seeds = new Set<number>();
    for (const level of ['mountain-valley', 'riverside-town']) {
      for (const attempt of [1, 2]) {
        for (const stream of RNG_STREAMS) seeds.add(streamSeed(level, attempt, stream));
      }
    }
    expect(seeds.size).toBe(2 * 2 * RNG_STREAMS.length);
    // Drawing from one stream does not move another.
    const amb = streamRng('power-valley', 1, 'amb');
    const before = take(streamRng('power-valley', 1, 'sfx'), 5);
    take(amb, 1000);
    expect(take(streamRng('power-valley', 1, 'sfx'), 5)).toEqual(before);
  });

  it('separates the parts, so ("ab","c") and ("a","bc") differ', () => {
    expect(hashSeed(SEED, 'ab', 'c')).not.toBe(hashSeed(SEED, 'a', 'bc'));
    expect(hashSeed(SEED, 'x')).not.toBe(hashSeed(SEED + 1, 'x'));
  });

  it('signed() stays in [-1, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = signed(rng);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThan(1);
    }
  });
});
