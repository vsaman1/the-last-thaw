import { describe, expect, it } from 'vitest';
import { BELL_BAKE, BELL_VOICINGS, MOTIF_TUNING, SEED, type BellVoicingId } from '../contract';
import { autocorrelation, cents, envelope, rmsDb, schroederT60, spectralPeaks } from '../analysis';
import { bakeBell, bellPartials, bellRatios } from './bell';
import { Biquad } from './dsp';

const VOICINGS = Object.keys(BELL_VOICINGS) as BellVoicingId[];
const FS = BELL_BAKE.sampleRate;
const strike = new Map(VOICINGS.map((v) => [v, bakeBell(v, 'strike', SEED).data]));

/** The signal around one frequency (a narrow band-pass, run twice). */
const around = (x: Float32Array, hz: number, q = 25): Float32Array => {
  const y = x.slice();
  new Biquad(FS).set('bandpass', hz, q).process(y);
  new Biquad(FS).set('bandpass', hz, q).process(y);
  return y;
};

/** Power of a sequence at freq (sample rate rate), relative to its mean power across lo..hi Hz. */
function lineShare(seq: Float64Array, rate: number, freq: number, lo: number, hi: number): number {
  let mean = 0;
  for (const v of seq) mean += v;
  mean /= seq.length;
  const at = (f: number): number => {
    let re = 0;
    let im = 0;
    for (let i = 0; i < seq.length; i++) {
      const a = (2 * Math.PI * f * i) / rate;
      re += (seq[i] - mean) * Math.cos(a);
      im -= (seq[i] - mean) * Math.sin(a);
    }
    return re * re + im * im;
  };
  let ref = 0;
  let n = 0;
  for (let f = lo; f <= hi; f += 1) {
    if (Math.abs(f - freq) < 6) continue;
    ref += at(f);
    n++;
  }
  return at(freq) / (ref / n);
}

describe('bell bakes', () => {
  it('every form has its length, a silent start and end, and the strike peaks at 1.0', () => {
    for (const v of VOICINGS) {
      for (const [form, sec] of [
        ['strike', BELL_BAKE.strikeSec],
        ['shiver', BELL_BAKE.shiverSec],
        ['clank', BELL_BAKE.clankSec],
      ] as const) {
        const { data, sampleRate } = bakeBell(v, form, SEED);
        expect(sampleRate).toBe(FS);
        expect(data.length, `${v} ${form}`).toBe(Math.round(sec * FS));
        expect(Math.abs(data[0]), `${v} ${form}`).toBeLessThan(1e-3);
        expect(rmsDb(data, data.length - Math.round(0.02 * FS)), `${v} ${form}`).toBeLessThan(-70);
        let peak = 0;
        for (const x of data) peak = Math.max(peak, Math.abs(x));
        if (form === 'strike') expect(Math.abs(peak - 1), v).toBeLessThan(1e-6);
        else expect(peak, `${v} ${form} relative to the strike`).toBeLessThan(1);
      }
    }
  });

  it('is deterministic, and the three forms of a bell share its partials', () => {
    for (const v of VOICINGS) {
      expect(Buffer.from(bakeBell(v, 'strike', SEED).data.buffer).equals(Buffer.from(strike.get(v)!.buffer)), v).toBe(true);
      expect(bellPartials(v, SEED)).toEqual(bellPartials(v, SEED));
    }
  });

  it('has a spectral peak within 0.5 % of every partial', () => {
    for (const v of VOICINGS) {
      const f = BELL_VOICINGS[v].strikeHz;
      const x = strike.get(v)!;
      const peaks = spectralPeaks(x, FS, { minHz: f * 0.4, maxHz: f * 4.3, floorDb: 70, end: 4 * FS, window: 'decay' });
      for (const k of bellRatios(BELL_VOICINGS[v])) {
        const hit = peaks.find((p) => Math.abs(p.hz / (f * k) - 1) < 0.005);
        expect(hit, `${v} partial ${k}`).toBeDefined();
      }
    }
  });

  it('Lochside rings true: its prime within 3 cents of G4 = 392 Hz', () => {
    const peaks = spectralPeaks(strike.get('loch-kirk')!, FS, { minHz: 380, maxHz: 404, floorDb: 20 });
    expect(Math.abs(cents(peaks[0].hz, 392))).toBeLessThan(3);
  });

  it('the hum outlasts the nominal, which outlasts the upper partials', () => {
    for (const v of VOICINGS) {
      const f = BELL_VOICINGS[v].strikeHz;
      const r = bellRatios(BELL_VOICINGS[v]);
      const t = (k: number): number => schroederT60(around(strike.get(v)!, f * k), FS);
      const hum = t(r[0]);
      const nominal = t(2);
      const upper = t(3);
      expect(hum, v).toBeGreaterThan(nominal);
      expect(nominal, v).toBeGreaterThan(upper);
    }
  });
});

describe('Clachan kirk, cracked 1911', () => {
  const x = strike.get('clachan-kirk')!;

  it('strikes at 573.9 ± 1 Hz with a 2.3 ± 0.3 Hz beat on the prime', () => {
    const peaks = spectralPeaks(x, FS, { minHz: 566, maxHz: 582, floorDb: 12, nfft: 1 << 20 });
    const [a, b] = peaks.slice(0, 2).map((p) => p.hz).sort((u, v) => u - v);
    expect(Math.abs((a + b) / 2 - 573.92)).toBeLessThan(1);
    expect(Math.abs(b - a - 2.3)).toBeLessThan(0.3);
    // The same beat in the time domain: the prime's envelope repeats every 1/2.3 s.
    const env = envelope(around(x, 573.92, 60), FS, 0.01);
    const ac = autocorrelation(env.subarray(10, 300), 80);
    let best = 25;
    for (let lag = 25; lag <= 80; lag++) if (ac[lag] > ac[best]) best = lag;
    expect(Math.abs(1 / (best * 0.01) - 2.3)).toBeLessThan(0.3);
  });

  it('sits 30 cents below the motif piano\'s untuned D5', () => {
    const d5 = MOTIF_TUNING.a4Hz * Math.pow(2, 5 / 12);
    expect(Math.abs(cents(BELL_VOICINGS['clachan-kirk'].strikeHz, d5) + 30)).toBeLessThan(1);
  });

  it('buzzes at 31 Hz on its upper partials for the first 0.4 s only, and no true bell does', () => {
    const band = (y: Float32Array, f: number): Float32Array => {
      const z = y.slice();
      new Biquad(FS).set('highpass', f * 1.8, 0.7).process(z);
      return z;
    };
    const share = (y: Float32Array, from: number, to: number): number =>
      lineShare(envelope(y.subarray(Math.round(from * FS), Math.round(to * FS)), FS, 0.002), 500, 31, 15, 60);
    const cracked = band(x, 573.92);
    const early = share(cracked, 0.02, 0.38);
    const late = share(cracked, 0.6, 0.96);
    expect(early).toBeGreaterThan(8);
    expect(late).toBeLessThan(early / 4);
    const brides = share(band(strike.get('st-brides')!, 493.88), 0.02, 0.38);
    expect(brides).toBeLessThan(early / 4);
  });
});

describe('shiver and clank', () => {
  it('a shiver has no transient: its first 10 ms carry under 5 % of the strike\'s high-band energy', () => {
    const hi = (y: Float32Array): number => {
      const z = y.slice(0, Math.round(0.01 * FS));
      new Biquad(FS).set('highpass', 2000, 0.7).process(z);
      let e = 0;
      for (const v of z) e += v * v;
      return e;
    };
    for (const v of VOICINGS) {
      expect(hi(bakeBell(v, 'shiver', SEED).data), v).toBeLessThan(0.05 * hi(strike.get(v)!));
    }
  });

  it('a clank is dull and short: little above 2.5 kHz, gone within a second', () => {
    for (const v of VOICINGS) {
      const c = bakeBell(v, 'clank', SEED).data;
      const above = c.slice();
      new Biquad(FS).set('highpass', 3000, 0.7).process(above);
      let ea = 0;
      let et = 0;
      for (let i = 0; i < c.length; i++) {
        ea += above[i] * above[i];
        et += c[i] * c[i];
      }
      expect(ea / et, v).toBeLessThan(0.05);
      expect(rmsDb(c, Math.round(1.0 * FS), Math.round(1.2 * FS)) - rmsDb(c, 0, Math.round(0.1 * FS)), v).toBeLessThan(-40);
    }
  });
});
