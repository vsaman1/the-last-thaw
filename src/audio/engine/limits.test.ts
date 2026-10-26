import { describe, expect, it } from 'vitest';
import { FAMILY_LIMITS, GLOBAL_LIMITS } from '../contract';
import { FAMILIES, FrameCap, PerKeyLimiter, RateLimits, TokenBucket } from './limits';

describe('token buckets (on audio time)', () => {
  it('start full, refill at their rate up to the burst, and never run time backwards', () => {
    const b = new TokenBucket(16, 6, 0);
    expect(b.available(0)).toBe(6);
    b.take(6, 0);
    expect(b.available(0)).toBe(0);
    expect(b.available(0.25)).toBeCloseTo(4, 9);
    expect(b.available(0.1)).toBeCloseTo(4, 9); // an earlier time changes nothing
    expect(b.available(100)).toBe(6);
  });

  it('a take never goes below its floor (debt only where allowed)', () => {
    const b = new TokenBucket(40, 12, 0);
    b.take(20, 0);
    expect(b.available(0)).toBe(0);
    b.take(3, 0, -4);
    expect(b.available(0)).toBe(-3);
    b.take(3, 0, -4);
    expect(b.available(0)).toBe(-4);
  });

  it('one bucket per family with the contract numbers, and the global voice bucket', () => {
    const r = new RateLimits(0);
    for (const f of FAMILIES) {
      expect(r.family(f).rate).toBe(FAMILY_LIMITS[f].ratePerSec);
      expect(r.family(f).burst).toBe(FAMILY_LIMITS[f].burst);
    }
    expect(r.global.rate).toBe(GLOBAL_LIMITS.ratePerSec);
    expect(r.global.burst).toBe(GLOBAL_LIMITS.burst);
    expect(r.family('hit')).not.toBe(r.family('splash'));
  });
});

describe('per-key interval', () => {
  it('the 150 ms per-obstacle hit rule', () => {
    const k = new PerKeyLimiter();
    const gap = FAMILY_LIMITS.hit.perKeySec;
    expect(k.allowed('hit', 7, gap, 0)).toBe(true);
    k.record('hit', 7, 0);
    expect(k.allowed('hit', 7, gap, 0.1)).toBe(false);
    expect(k.allowed('hit', 8, gap, 0.1)).toBe(true); // another obstacle
    expect(k.allowed('splash', 7, gap, 0.1)).toBe(true); // another family
    expect(k.allowed('hit', 7, gap, gap)).toBe(true);
  });

  it('key -1 and interval 0 are never limited', () => {
    const k = new PerKeyLimiter();
    k.record('hit', -1, 0);
    expect(k.size).toBe(0);
    k.record('chip', 3, 0);
    expect(k.allowed('chip', 3, 0, 0)).toBe(true);
    expect(k.allowed('hit', -1, 5, 0)).toBe(true);
  });

  it('is an LRU of 256: the least recently used key is forgotten first', () => {
    const k = new PerKeyLimiter(256);
    for (let i = 0; i < 300; i++) k.record('breakStructure', i, 0);
    expect(k.size).toBe(256);
    expect(k.allowed('breakStructure', 0, 1.5, 0.1)).toBe(true); // forgotten
    expect(k.allowed('breakStructure', 299, 1.5, 0.1)).toBe(false);
    k.record('breakStructure', 44, 0.05); // touched again: now the most recent
    for (let i = 300; i < 555; i++) k.record('breakStructure', i, 0.1);
    expect(k.allowed('breakStructure', 44, 1.5, 0.2)).toBe(false);
    expect(k.allowed('breakStructure', 45, 1.5, 0.2)).toBe(true);
  });
});

describe('frame cap', () => {
  it('admits at most 4 per frame; a new frame number resets, the same one does not', () => {
    const f = new FrameCap();
    f.begin(1);
    for (let i = 0; i < 4; i++) {
      expect(f.full).toBe(false);
      f.admit();
    }
    expect(f.full).toBe(true);
    f.begin(1);
    expect(f.full).toBe(true);
    f.begin(2);
    expect(f.full).toBe(false);
  });
});
