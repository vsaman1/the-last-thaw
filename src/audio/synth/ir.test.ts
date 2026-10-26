import { describe, expect, it } from 'vitest';
import { SEED, SPACE } from '../contract';
import { schroederT60 } from '../analysis';
import { Biquad } from './dsp';
import { SPACE_RT60_SEC, generateSpaceIR, spaceIRSteps } from './ir';

const FS = 48000;
const [L, R] = generateSpaceIR(FS, SPACE.irSeconds, SEED);

const band = (x: Float32Array, type: 'lowpass' | 'highpass', f: number): Float32Array => {
  const y = x.slice();
  new Biquad(FS).set(type, f, 0.7).process(y);
  new Biquad(FS).set(type, f, 0.7).process(y);
  return y;
};

describe('the space impulse response', () => {
  it('is two channels of the asked length, finite, with unit energy each', () => {
    for (const x of [L, R]) {
      expect(x.length).toBe(Math.round(FS * SPACE.irSeconds));
      expect(x.every(Number.isFinite)).toBe(true);
      let e = 0;
      for (const v of x) e += v * v;
      expect(e).toBeCloseTo(1, 6);
    }
  });

  it('bakes in the predelay: the first 15 ms are silent, and it ends clean', () => {
    const pre = Math.round(SPACE.predelaySec * FS);
    for (const x of [L, R]) {
      for (let i = 0; i < pre; i++) expect(x[i]).toBe(0);
      expect(Math.abs(x[x.length - 1])).toBeLessThan(1e-6);
    }
  });

  it('decays with the specified RT60 (± 15 %), and the highs die first', () => {
    for (const x of [L, R]) {
      const t = schroederT60(x, FS, -5, -35);
      expect(Math.abs(t - SPACE_RT60_SEC) / SPACE_RT60_SEC).toBeLessThan(0.15);
      expect(schroederT60(band(x, 'highpass', 5000), FS, -5, -25)).toBeLessThan(schroederT60(band(x, 'lowpass', 1000), FS, -5, -25));
    }
  });

  it('is stereo: the two channels are decorrelated', () => {
    let lr = 0;
    for (let i = 0; i < L.length; i++) lr += L[i] * R[i];
    expect(Math.abs(lr)).toBeLessThan(0.2);
  });

  it('is deterministic per seed', () => {
    const [L2] = generateSpaceIR(FS, SPACE.irSeconds, SEED);
    expect(Buffer.from(L2.buffer).equals(Buffer.from(L.buffer))).toBe(true);
    const [L3] = generateSpaceIR(FS, SPACE.irSeconds, SEED + 1);
    expect(Buffer.from(L3.buffer).equals(Buffer.from(L.buffer))).toBe(false);
  });
});

describe('made ahead of the context (lead decision L2)', () => {
  it('the two idle steps make the IR the context then takes as it is, at that rate only', () => {
    const seed = SEED + 5;
    const steps = spaceIRSteps(FS, SPACE.irSeconds, seed);
    expect(steps).toHaveLength(2);
    for (const step of steps) step();
    const [l, r] = generateSpaceIR(FS, SPACE.irSeconds, seed);
    const [l2, r2] = generateSpaceIR(FS, SPACE.irSeconds, seed);
    expect(l2).toBe(l);
    expect(r2).toBe(r);
    // Another rate is its own IR (a 44.1 kHz context makes its own when it is built).
    expect(generateSpaceIR(44100, SPACE.irSeconds, seed)[0].length).toBe(Math.round(44100 * SPACE.irSeconds));
  });
});
