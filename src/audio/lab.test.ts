import { describe, expect, it } from 'vitest';
import { LAB_RATE, limiterReduction } from './lab';

describe('limiterReduction (R11)', () => {
  // Sparse hits: silence, then a 30 ms burst whose onset falls 2 ms before the end of a 20 ms block,
  // through a "limiter" that only delays (by 6 ms) and applies the makeup: no gain reduction at all.
  const n = LAB_RATE;
  const latency = Math.round(0.006 * LAB_RATE);
  const block = Math.round(0.02 * LAB_RATE);
  const pre = new Float32Array(n);
  for (let start = 5 * block - Math.round(0.002 * LAB_RATE); start < n - 2 * block; start += 10 * block) {
    for (let i = 0; i < Math.round(0.03 * LAB_RATE); i++) pre[start + i] = 0.5 * Math.sin(i / 7);
  }
  const makeup = 0.8;
  const post = new Float32Array(n);
  for (let i = 0; i + latency < n; i++) post[i + latency] = pre[i] * makeup;

  it('reads no reduction once the look-ahead is taken out', () => {
    const r = limiterReduction([pre, pre], [post, post], makeup, latency);
    expect(r.max).toBeLessThan(0.01);
    expect(r.p99).toBeLessThan(0.01);
  });

  it('without the look-ahead, an onset at the end of a block reads as a huge reduction (the first R11 run)', () => {
    const r = limiterReduction([pre, pre], [post, post], makeup, 0);
    expect(r.max).toBeGreaterThan(40);
  });
});
