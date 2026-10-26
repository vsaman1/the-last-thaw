import { describe, expect, it } from 'vitest';
import {
  audibleDuration,
  bandEnergy,
  cents,
  envelopeAutocorrelation,
  loudness,
  onsets,
  peakDb,
  renderStats,
  rmsDb,
  schroederT60,
  spectralCentroid,
  spectralPeaks,
  truePeakDb,
  yinPitch,
} from './analysis';
import { createRng } from '../core/rng';

const sine = (fs: number, sec: number, hz: number, amp: number, phase = 0): Float32Array => {
  const x = new Float32Array(Math.round(fs * sec));
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * hz * i) / fs + phase);
  return x;
};

describe('loudness (ITU-R BS.1770-4)', () => {
  it('reads a 1 kHz sine at -20 dBFS in one channel as -23.0 LUFS, at 48 and 24 kHz', () => {
    for (const fs of [48000, 24000]) {
      const l = loudness(sine(fs, 5, 1000, 0.1), fs);
      expect(l.integrated, `${fs}`).toBeGreaterThan(-23.1);
      expect(l.integrated, `${fs}`).toBeLessThan(-22.9);
      expect(Math.abs(l.momentaryMax - l.integrated)).toBeLessThan(0.05);
    }
  });

  it('adds channels by power: the same sine in two channels reads 3 LU louder', () => {
    const s = sine(48000, 3, 1000, 0.1);
    const one = loudness(s, 48000).integrated;
    const two = loudness([s, s], 48000).integrated;
    expect(two - one).toBeCloseTo(3.01, 1);
  });

  it('gates silence out of the integrated value but not out of the ungated mean', () => {
    const fs = 48000;
    const x = new Float32Array(fs * 6);
    x.set(sine(fs, 2, 1000, 0.1));
    const l = loudness(x, fs);
    // Blocks straddling the edges pass the relative gate and pull the value down a little.
    expect(Math.abs(l.integrated + 23)).toBeLessThan(0.5);
    expect(l.ungated).toBeLessThan(l.integrated - 3);
  });
});

describe('peak, true peak, RMS', () => {
  it('detects an inter-sample overshoot as true peak', () => {
    // fs/4 at 45°: every sample lands at ±0.707, the waveform between them reaches 1.0.
    const x = sine(48000, 0.5, 12000, 1, Math.PI / 4);
    expect(peakDb(x)).toBeCloseTo(-3.01, 1);
    expect(Math.abs(truePeakDb(x))).toBeLessThan(0.2);
  });

  it('measures RMS of a sine as peak - 3.01 dB', () => {
    expect(rmsDb(sine(24000, 1, 440, 0.5))).toBeCloseTo(-9.03, 1);
  });

  it('fills every RenderStats field', () => {
    const s = renderStats(sine(24000, 1, 100, 0.5), 24000);
    expect(s.peakDb).toBeCloseTo(-6.02, 1);
    expect(s.below150).toBeGreaterThan(0.99);
    expect(s.below40).toBeLessThan(0.01);
    expect(s.clippedSamples).toBe(0);
    expect(s.durationSec).toBeCloseTo(1, 6);
  });
});

describe('spectrum', () => {
  it('splits band energy by Parseval: two equal sines either side of 150 Hz share it evenly', () => {
    const fs = 24000;
    const a = sine(fs, 2, 100, 0.5);
    const b = sine(fs, 2, 1000, 0.5);
    for (let i = 0; i < a.length; i++) a[i] += b[i];
    expect(bandEnergy(a, fs, 0, 150)).toBeCloseTo(0.5, 2);
  });

  it('finds the centroid of a pure tone at the tone', () => {
    expect(Math.abs(spectralCentroid(sine(24000, 1, 1000, 0.5), 24000) - 1000)).toBeLessThan(60);
  });

  it('picks spectral peaks within 0.05 %', () => {
    const fs = 24000;
    const x = sine(fs, 2, 523.25, 0.5);
    const y = sine(fs, 2, 1046.5, 0.25);
    const z = sine(fs, 2, 1569.8, 0.1);
    for (let i = 0; i < x.length; i++) x[i] += y[i] + z[i];
    const peaks = spectralPeaks(x, fs, { minHz: 100, maxHz: 3000, floorDb: 30 });
    for (const f of [523.25, 1046.5, 1569.8]) {
      const p = peaks.find((q) => Math.abs(q.hz - f) / f < 0.005);
      expect(p, `${f}`).toBeDefined();
      expect(Math.abs(p!.hz - f) / f).toBeLessThan(0.0005);
    }
  });
});

describe('time structure', () => {
  it('YIN reads a 440 Hz sine within 0.5 cents', () => {
    for (const fs of [48000, 24000]) {
      const f = yinPitch(sine(fs, 1, 440, 0.5), fs, { start: 1000 });
      expect(Math.abs(cents(f, 440)), `${fs}`).toBeLessThan(0.5);
    }
  });

  it('YIN finds the fundamental of a harmonic tone, not its strongest partial', () => {
    const fs = 24000;
    const x = sine(fs, 1, 220, 0.2);
    const h2 = sine(fs, 1, 440, 0.5);
    const h3 = sine(fs, 1, 660, 0.3);
    for (let i = 0; i < x.length; i++) x[i] += h2[i] + h3[i];
    expect(Math.abs(cents(yinPitch(x, fs, { start: 500 }), 220))).toBeLessThan(1);
  });

  it('Schroeder T60 of exponentially decaying noise is within 5 % of the truth', () => {
    const fs = 24000;
    const rng = createRng(42);
    for (const t60 of [0.15, 0.5, 2]) {
      const x = new Float32Array(Math.round(fs * t60 * 1.5));
      for (let i = 0; i < x.length; i++) x[i] = (rng() * 2 - 1) * Math.pow(10, (-3 * i) / (fs * t60));
      const m = schroederT60(x, fs);
      expect(Math.abs(m - t60) / t60, `${t60}`).toBeLessThan(0.05);
    }
  });

  it('finds click onsets within 2 ms, including a soft one under a ringing tone', () => {
    const fs = 24000;
    const x = sine(fs, 2, 220, 0.2);
    // The tone itself starting at 0 is the first onset.
    const times = [0, 0.25, 0.7, 1.1, 1.5];
    for (const [k, t] of times.entries()) {
      const at = Math.round(t * fs);
      if (t === 0) continue;
      const amp = k === 3 ? 0.12 : 0.5;
      for (let i = 0; i < 48; i++) x[at + i] += amp * Math.sin((2 * Math.PI * 3000 * i) / fs) * Math.exp(-i / 12);
    }
    const found = onsets(x, fs);
    expect(found.length).toBe(times.length);
    for (const [k, t] of times.entries()) expect(Math.abs(found[k] - t)).toBeLessThan(0.002);
  });

  it('envelope autocorrelation finds a 2 Hz amplitude modulation at 0.5 s', () => {
    const fs = 8000;
    const rng = createRng(7);
    const x = new Float32Array(fs * 6);
    for (let i = 0; i < x.length; i++) x[i] = (rng() * 2 - 1) * (1 + 0.8 * Math.sin((2 * Math.PI * 2 * i) / fs));
    const ac = envelopeAutocorrelation(x, fs, 0.01, 1);
    let best = 20;
    for (let lag = 20; lag < ac.length; lag++) if (ac[lag] > ac[best]) best = lag;
    expect(Math.abs(best * 0.01 - 0.5)).toBeLessThan(0.02);
  });

  it('audibleDuration follows an exponential decay to its floor', () => {
    const fs = 24000;
    const x = new Float32Array(fs * 3);
    const rng = createRng(3);
    // tau 0.2 s: 40 dB below the peak after 0.2·ln(100) = 0.92 s.
    for (let i = 0; i < x.length; i++) x[i] = (rng() * 2 - 1) * Math.exp(-i / fs / 0.2);
    expect(Math.abs(audibleDuration(x, fs, 40) - 0.92)).toBeLessThan(0.06);
  });
});
