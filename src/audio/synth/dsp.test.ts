import { describe, expect, it } from 'vitest';
import { bandEnergy, rmsOf, schroederT60, welch } from '../analysis';
import {
  Biquad,
  LOOP_RMS,
  NOISE_RMS,
  bakeSeed,
  brownNoise,
  finishLoop,
  finishOneShot,
  loopCrossfade,
  fnv1a,
  peakAbs,
  pinkNoise,
  resonate,
  seededRng,
  whiteNoise,
} from './dsp';

/** Least-squares slope (dB per octave) of the Welch PSD in octave bands between lo and hi. */
function octaveSlope(x: Float32Array, fs: number, lo: number, hi: number): number {
  const seg = 8192;
  const psd = welch(x, seg);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let f = lo; f * 2 <= hi; f *= 2) {
    let s = 0;
    let n = 0;
    for (let k = Math.ceil((f * seg) / fs); k < (2 * f * seg) / fs; k++) {
      s += psd[k];
      n++;
    }
    // Mean density over the band (per Hz), so a -3 dB/octave noise has a -3 dB/octave fit.
    xs.push(Math.log2(f * Math.SQRT2));
    ys.push(10 * Math.log10(s / n));
  }
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return num / den;
}

describe('seeds', () => {
  it('FNV-1a matches the published test vectors', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('foobar')).toBe(0xbf9cf968);
  });

  it('bake seeds differ by id and variant and repeat exactly', () => {
    expect(bakeSeed(42, 'hit.ice', 0)).toBe(bakeSeed(42, 'hit.ice', 0));
    expect(bakeSeed(42, 'hit.ice', 0)).not.toBe(bakeSeed(42, 'hit.ice', 1));
    expect(bakeSeed(42, 'hit.ice', 0)).not.toBe(bakeSeed(42, 'hit.wood', 0));
    expect(bakeSeed(42, 'hit.ice', 0)).not.toBe(bakeSeed(43, 'hit.ice', 0));
  });
});

describe('noise colours', () => {
  const fs = 24000;
  const n = 1 << 18;

  it('white is flat, pink falls 3 dB and brown 6 dB per octave (± 0.5)', () => {
    expect(Math.abs(octaveSlope(whiteNoise(n, seededRng(1)), fs, 100, 6400))).toBeLessThan(0.5);
    expect(Math.abs(octaveSlope(pinkNoise(n, seededRng(2)), fs, 100, 6400) + 3)).toBeLessThan(0.5);
    expect(Math.abs(octaveSlope(brownNoise(n, seededRng(3)), fs, 100, 3200) + 6)).toBeLessThan(0.5);
  });

  it('every colour is normalised to the same RMS', () => {
    for (const x of [whiteNoise(48000, seededRng(4)), pinkNoise(48000, seededRng(5)), brownNoise(48000, seededRng(6))]) {
      expect(rmsOf(x)).toBeCloseTo(NOISE_RMS, 6);
    }
  });
});

describe('biquads', () => {
  it('band-pass: 0 ± 0.1 dB at the centre, -3 dB points within 2 % of the design', () => {
    for (const [fs, f0, q] of [
      [48000, 1000, 2],
      [24000, 700, 1.5],
      [32000, 4500, 1.2],
    ] as const) {
      const bq = new Biquad(fs).set('bandpass', f0, q);
      // Measured on a filtered sine, not only from the formula.
      const x = new Float32Array(fs);
      for (let i = 0; i < x.length; i++) x[i] = Math.sin((2 * Math.PI * f0 * i) / fs);
      bq.process(x);
      const centreDb = 20 * Math.log10(rmsOf(x, fs / 2) * Math.SQRT2);
      expect(Math.abs(centreDb), `${f0}`).toBeLessThan(0.1);
      // The analogue design's edges, mapped through the bilinear transform's frequency warping.
      const k = Math.sqrt(1 + 1 / (4 * q * q));
      const t0 = Math.tan((Math.PI * f0) / fs);
      const unwarp = (r: number): number => (fs / Math.PI) * Math.atan(t0 * r);
      for (const edge of [unwarp(k - 1 / (2 * q)), unwarp(k + 1 / (2 * q))]) {
        // Find the measured -3 dB point nearest the analogue design edge.
        let best = edge;
        let err = Infinity;
        for (let f = edge * 0.9; f < edge * 1.1; f += edge * 0.0005) {
          const e = Math.abs(20 * Math.log10(bq.gainAt(f)) + 3.0103);
          if (e < err) [err, best] = [e, f];
        }
        expect(Math.abs(best - edge) / edge, `${f0} edge ${edge.toFixed(1)}`).toBeLessThan(0.02);
      }
    }
  });

  it('low-pass is -3 dB at its corner with Q 0.707', () => {
    const bq = new Biquad(24000).set('lowpass', 1500);
    expect(20 * Math.log10(bq.gainAt(1500))).toBeCloseTo(-3.01, 1);
    expect(bq.gainAt(50)).toBeCloseTo(1, 3);
  });
});

describe('modal resonator', () => {
  it('rings with the specified T60 (within 5 %) and unit impulse amplitude', () => {
    const fs = 24000;
    for (const [f, t60] of [
      [210, 0.18],
      [1020, 0.08],
      [160, 1.2],
    ] as const) {
      const out = new Float32Array(Math.round(fs * t60 * 1.6));
      resonate(out, new Float32Array([1]), fs, f, t60, 1);
      expect(Math.abs(schroederT60(out, fs) - t60) / t60, `${f} Hz`).toBeLessThan(0.05);
      expect(peakAbs(out)).toBeGreaterThan(0.95);
      expect(peakAbs(out)).toBeLessThan(1.0001);
    }
  });
});

describe('bake rules', () => {
  it('one-shot: silent first sample, faded tail, no DC, peak exactly 1', () => {
    const fs = 24000;
    const x = brownNoise(fs, seededRng(9));
    for (let i = 0; i < x.length; i++) x[i] = x[i] * Math.exp(-i / (0.08 * fs)) + 0.05;
    finishOneShot(x, fs);
    expect(Math.abs(x[0])).toBeLessThan(1e-3);
    expect(peakAbs(x)).toBeCloseTo(1, 6);
    let mean = 0;
    for (const v of x) mean += v;
    expect(Math.abs(mean / x.length)).toBeLessThan(1e-3);
    expect(20 * Math.log10(rmsOf(x, x.length - 480) + 1e-12)).toBeLessThan(-70);
  });

  it('one-shot: the 40 Hz high-pass takes 20 Hz down at least 23 dB more than 1 kHz', () => {
    const fs = 24000;
    const n = fs * 2;
    const tone = (hz: number): Float32Array => {
      const x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * hz * i) / fs) * Math.exp(-i / (0.5 * fs));
      return x;
    };
    const lo = tone(20);
    const hi = tone(1000);
    const before = rmsOf(lo) / rmsOf(hi);
    const mix = new Float32Array(n);
    for (let i = 0; i < n; i++) mix[i] = lo[i] + hi[i];
    finishOneShot(mix, fs);
    // The 1 kHz share of the energy is now overwhelming; 20 Hz keeps under 0.5 % of it.
    expect(bandEnergy(mix, fs, 0, 40)).toBeLessThan(0.005 * before * before + 0.001);
  });

  it('loop: seamless seam, no RMS step, RMS 0.25', () => {
    const fs = 24000;
    const n = fs * 2;
    const loop = finishLoop(loopCrossfade(pinkNoise(n + fs / 4, seededRng(11)), n), fs);
    expect(loop.length).toBe(n);
    expect(rmsOf(loop)).toBeCloseTo(LOOP_RMS, 6);
    // Noise has no smooth seam to match, so the test is statistical: the step x[n-1] -> x[0] is an
    // ordinary step (under 4 sigma of the steps inside the loop), not a discontinuity.
    let sq = 0;
    for (let i = 1; i < n; i++) sq += (loop[i] - loop[i - 1]) ** 2;
    expect(Math.abs(loop[0] - loop[n - 1])).toBeLessThan(4 * Math.sqrt(sq / (n - 1)));
    const head = rmsOf(loop, 0, fs / 10);
    const tail = rmsOf(loop, n - fs / 10, n);
    expect(Math.abs(20 * Math.log10(head / tail))).toBeLessThan(1.5);
  });
});
