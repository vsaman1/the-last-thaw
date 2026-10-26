/**
 * Measurement for sound that nobody can listen to (docs/AUDIO_DESIGN.md §10, §11.2): every claim the
 * sound design makes about loudness, timbre, pitch and timing is checked by one of these numbers.
 *
 * Pure TypeScript over Float32Array, so the same code measures baked PCM in node (the synthesis tests)
 * and offline renders in Chrome (package A's lab). Contents: sample peak, 4x true peak, RMS, ITU-R
 * BS.1770-4 loudness (K-weighting, momentary, gated integrated), FFT, spectral centroid, band energy,
 * onsets, YIN pitch, Schroeder decay (T60), envelope autocorrelation and FFT peak picking.
 */
import type { RenderStats } from './contract';

const TAU = Math.PI * 2;
const EPS = 1e-20;

export const toDb = (x: number): number => 20 * Math.log10(Math.max(Math.abs(x), 1e-12));
const powDb = (p: number): number => 10 * Math.log10(Math.max(p, 1e-24));

// -------------------------------------------------------------------------------------------------
// Level
// -------------------------------------------------------------------------------------------------

export function samplePeak(x: Float32Array, start = 0, end = x.length): number {
  let p = 0;
  for (let i = Math.max(0, start); i < Math.min(end, x.length); i++) {
    const a = Math.abs(x[i]);
    if (a > p) p = a;
  }
  return p;
}

export function rmsOf(x: Float32Array, start = 0, end = x.length): number {
  const s = Math.max(0, start);
  const e = Math.min(end, x.length);
  let acc = 0;
  for (let i = s; i < e; i++) acc += x[i] * x[i];
  return e > s ? Math.sqrt(acc / (e - s)) : 0;
}

export const peakDb = (x: Float32Array, start = 0, end = x.length): number => toDb(samplePeak(x, start, end));
export const rmsDb = (x: Float32Array, start = 0, end = x.length): number => toDb(rmsOf(x, start, end));

export function dcOffset(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return x.length ? s / x.length : 0;
}

export function clippedSamples(x: Float32Array, limit = 1): number {
  let n = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= limit) n++;
  return n;
}

/** 4x oversampling interpolator: a 48-tap Blackman-windowed sinc, 12 taps per phase (BS.1770 Annex 2). */
const TP_TAPS = 12;
const TP_PHASES = 4;
const TP_KERNEL: Float64Array = (() => {
  const n = TP_TAPS * TP_PHASES;
  const h = new Float64Array(n);
  const c = (n - 1) / 2;
  for (let k = 0; k < n; k++) {
    const t = (k - c) / TP_PHASES;
    const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
    const w = 0.42 - 0.5 * Math.cos((TAU * k) / (n - 1)) + 0.08 * Math.cos((2 * TAU * k) / (n - 1));
    h[k] = sinc * w;
  }
  // Each phase sums to 1 so DC passes at unity in every phase.
  for (let p = 0; p < TP_PHASES; p++) {
    let s = 0;
    for (let j = 0; j < TP_TAPS; j++) s += h[j * TP_PHASES + p];
    for (let j = 0; j < TP_TAPS; j++) h[j * TP_PHASES + p] /= s;
  }
  return h;
})();

/** True peak (linear) by 4x oversampling: catches overshoots between samples that a DAC will make. */
export function truePeak(x: Float32Array): number {
  let peak = samplePeak(x);
  const n = x.length;
  for (let i = 0; i < n + TP_TAPS; i++) {
    for (let p = 0; p < TP_PHASES; p++) {
      let acc = 0;
      for (let j = 0; j < TP_TAPS; j++) {
        const idx = i - j;
        if (idx >= 0 && idx < n) acc += x[idx] * TP_KERNEL[j * TP_PHASES + p];
      }
      const a = Math.abs(acc);
      if (a > peak) peak = a;
    }
  }
  return peak;
}

export const truePeakDb = (x: Float32Array): number => toDb(truePeak(x));

// -------------------------------------------------------------------------------------------------
// Loudness (ITU-R BS.1770-4)
// -------------------------------------------------------------------------------------------------

interface Sos {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * The K-weighting pre-filter (high shelf) and RLB high-pass, derived for any sample rate.
 *
 * Provenance: the six constants (f0, G, Q and the Vb exponent of the shelf; f0 and Q of the
 * high-pass) and the coefficient formulas are taken from libebur128's ebur128_init_filter
 * (https://github.com/jiixyj/libebur128, ebur128/ebur128.c), which fits ITU-R BS.1770-4's 48 kHz
 * coefficients to analogue prototypes so they can be re-derived at any rate. libebur128 is used under
 * the MIT licence:
 *
 *   Copyright (c) 2011 Jan Kokemüller
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 *   associated documentation files (the "Software"), to deal in the Software without restriction,
 *   including without limitation the rights to use, copy, modify, merge, publish, distribute,
 *   sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
 *   furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in all copies or
 *   substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
 *   NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 *   NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
 *   OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 *   CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * Credited in docs/AUDIO_CREDITS.md (Sources) and the README's Credits.
 */
function kWeighting(fs: number): [Sos, Sos] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: Sos = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  const hp: Sos = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, hp];
}

function runSos(x: Float32Array | Float64Array, s: Sos): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = s.b0 * x[i] + s.b1 * x1 + s.b2 * x2 - s.a1 * y1 - s.a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

export interface Loudness {
  /** Gated integrated loudness (LUFS); -Infinity when every block is below the absolute gate. */
  readonly integrated: number;
  /** Ungated mean over 400 ms blocks (LUFS). */
  readonly ungated: number;
  /** Highest momentary loudness (400 ms window, 10 ms hop: finer than the standard's 100 ms). */
  readonly momentaryMax: number;
}

/**
 * BS.1770-4 loudness of one or more channels (all weighted 1, as for L, R and C). A mono buffer is
 * one channel: a 1 kHz sine at -20 dBFS peak reads -23.0 LUFS. Signals shorter than a 400 ms block
 * are measured as if padded with silence to one block.
 */
export function loudness(channels: Float32Array | readonly Float32Array[], fs: number): Loudness {
  const chans: readonly Float32Array[] = channels instanceof Float32Array ? [channels] : channels;
  const block = Math.round(0.4 * fs);
  const len = Math.max(block, ...chans.map((c) => c.length));
  const [shelf, hp] = kWeighting(fs);
  // Prefix sums of the K-weighted square, summed over channels.
  const cum = new Float64Array(len + 1);
  for (const c of chans) {
    const padded = new Float64Array(len);
    padded.set(c);
    const k = runSos(runSos(padded, shelf), hp);
    for (let i = 0; i < len; i++) cum[i + 1] += k[i] * k[i];
  }
  for (let i = 0; i < len; i++) cum[i + 1] += cum[i];
  const ms = (start: number): number => (cum[start + block] - cum[start]) / block;
  const L = (z: number): number => -0.691 + powDb(z);

  let momentaryMax = -Infinity;
  const fine = Math.max(1, Math.round(0.01 * fs));
  for (let s = 0; s + block <= len; s += fine) momentaryMax = Math.max(momentaryMax, L(ms(s)));

  // Gating blocks: 400 ms, 75 % overlap.
  const hop = Math.round(0.1 * fs);
  const z: number[] = [];
  for (let s = 0; s + block <= len; s += hop) z.push(ms(s));
  const ungated = L(z.reduce((a, b) => a + b, 0) / Math.max(1, z.length));
  const abs = z.filter((v) => L(v) > -70);
  if (!abs.length) return { integrated: -Infinity, ungated, momentaryMax };
  const relGate = L(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const rel = abs.filter((v) => L(v) > relGate);
  const integrated = L(rel.reduce((a, b) => a + b, 0) / Math.max(1, rel.length));
  return { integrated, ungated, momentaryMax };
}

// -------------------------------------------------------------------------------------------------
// Spectrum
// -------------------------------------------------------------------------------------------------

export const nextPow2 = (n: number): number => {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
};

/** In-place iterative radix-2 complex FFT (re, im of equal power-of-two length). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const ang = -TAU / size;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let start = 0; start < n; start += size) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = start + k;
        const b = a + half;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/**
 * rect: none. hann: symmetric. decay: flat for the first half, a cosine taper over the second, for
 * sounds that start from silence and decay (a Hann window would hide a fast-decaying partial at its
 * zero start).
 */
export type WindowKind = 'rect' | 'hann' | 'decay';

/** |X[k]|² for k in 0..nfft/2 of x[start..end) (windowed, zero-padded to nfft). */
export function powerSpectrum(
  x: Float32Array,
  options: { start?: number; end?: number; nfft?: number; window?: WindowKind } = {},
): Float64Array {
  const start = Math.max(0, options.start ?? 0);
  const end = Math.min(x.length, options.end ?? x.length);
  const len = Math.max(0, end - start);
  const nfft = options.nfft ?? nextPow2(Math.max(2, len));
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  const kind = options.window ?? 'rect';
  const half = len / 2;
  for (let i = 0; i < Math.min(len, nfft); i++) {
    const w =
      kind === 'hann'
        ? 0.5 - 0.5 * Math.cos((TAU * i) / Math.max(1, len - 1))
        : kind === 'decay' && i > half
          ? 0.5 + 0.5 * Math.cos((Math.PI * (i - half)) / half)
          : 1;
    re[i] = x[start + i] * w;
  }
  fft(re, im);
  const out = new Float64Array(nfft / 2 + 1);
  for (let k = 0; k <= nfft / 2; k++) out[k] = re[k] * re[k] + im[k] * im[k];
  return out;
}

/** Welch power spectral density (Hann segments, 50 % overlap), averaged; bin k is at k·fs/seg. */
export function welch(x: Float32Array, seg = 4096): Float64Array {
  const out = new Float64Array(seg / 2 + 1);
  let count = 0;
  for (let s = 0; s + seg <= x.length; s += seg / 2) {
    const p = powerSpectrum(x, { start: s, end: s + seg, nfft: seg, window: 'hann' });
    for (let k = 0; k < out.length; k++) out[k] += p[k];
    count++;
  }
  if (count === 0) return powerSpectrum(x, { nfft: seg, window: 'hann' });
  for (let k = 0; k < out.length; k++) out[k] /= count;
  return out;
}

/** Share of the signal's energy between loHz and hiHz (exact by Parseval: rectangular, full length). */
export function bandEnergy(x: Float32Array, fs: number, loHz: number, hiHz: number): number {
  const p = powerSpectrum(x);
  const nfft = (p.length - 1) * 2;
  let total = 0;
  let band = 0;
  for (let k = 0; k < p.length; k++) {
    // Bins other than DC and Nyquist stand for two (the mirrored half).
    const w = k === 0 || k === p.length - 1 ? 1 : 2;
    const f = (k * fs) / nfft;
    total += w * p[k];
    if (f >= loHz && f < hiHz) band += w * p[k];
  }
  return total > 0 ? band / total : 0;
}

/** Magnitude-weighted spectral centroid (Hz) of x[start..end). */
export function spectralCentroid(x: Float32Array, fs: number, start = 0, end = x.length): number {
  const p = powerSpectrum(x, { start, end, window: 'hann' });
  const nfft = (p.length - 1) * 2;
  let num = 0;
  let den = 0;
  for (let k = 1; k < p.length; k++) {
    const m = Math.sqrt(p[k]);
    num += m * ((k * fs) / nfft);
    den += m;
  }
  return den > 0 ? num / den : 0;
}

export interface SpectralPeak {
  readonly hz: number;
  /** Level relative to the strongest peak in range (dB). */
  readonly db: number;
}

/**
 * Local maxima of the windowed (default Hann) magnitude spectrum between minHz and maxHz within floorDb of the
 * strongest, refined by parabolic interpolation on the log magnitude; strongest first.
 */
export function spectralPeaks(
  x: Float32Array,
  fs: number,
  options: {
    minHz?: number;
    maxHz?: number;
    floorDb?: number;
    nfft?: number;
    start?: number;
    end?: number;
    window?: WindowKind;
  } = {},
): SpectralPeak[] {
  const len = (options.end ?? x.length) - (options.start ?? 0);
  const nfft = options.nfft ?? nextPow2(len) * 4;
  const p = powerSpectrum(x, { start: options.start, end: options.end, nfft, window: options.window ?? 'hann' });
  const lo = Math.max(1, Math.floor(((options.minHz ?? 20) * nfft) / fs));
  const hi = Math.min(p.length - 2, Math.ceil(((options.maxHz ?? fs / 2) * nfft) / fs));
  const db = (k: number): number => powDb(p[k]);
  let max = -Infinity;
  for (let k = lo; k <= hi; k++) max = Math.max(max, db(k));
  const floor = max - (options.floorDb ?? 40);
  const peaks: SpectralPeak[] = [];
  for (let k = lo; k <= hi; k++) {
    const c = db(k);
    if (c < floor || c < db(k - 1) || c <= db(k + 1)) continue;
    const a = db(k - 1);
    const b = db(k + 1);
    const den = a - 2 * c + b;
    const d = den !== 0 ? (0.5 * (a - b)) / den : 0;
    peaks.push({ hz: ((k + d) * fs) / nfft, db: c - 0.25 * (a - b) * d - max });
  }
  return peaks.sort((u, v) => v.db - u.db);
}

// -------------------------------------------------------------------------------------------------
// Time structure
// -------------------------------------------------------------------------------------------------

/** RMS envelope in frames of frameSec (one value per frame). */
export function envelope(x: Float32Array, fs: number, frameSec: number): Float64Array {
  const f = Math.max(1, Math.round(frameSec * fs));
  const n = Math.floor(x.length / f);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = rmsOf(x, i * f, (i + 1) * f);
  return out;
}

/** Normalised autocorrelation (mean removed) of a sequence for lags 0..maxLag. */
export function autocorrelation(seq: ArrayLike<number>, maxLag: number): Float64Array {
  const n = seq.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += seq[i];
  mean /= Math.max(1, n);
  let den = 0;
  for (let i = 0; i < n; i++) den += (seq[i] - mean) ** 2;
  const out = new Float64Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag && lag < n; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += (seq[i] - mean) * (seq[i + lag] - mean);
    out[lag] = den > 0 ? s / den : 0;
  }
  return out;
}

/** Autocorrelation of the RMS envelope (frames of frameSec) at lags up to maxLagSec. */
export function envelopeAutocorrelation(x: Float32Array, fs: number, frameSec: number, maxLagSec: number): Float64Array {
  return autocorrelation(envelope(x, fs, frameSec), Math.round(maxLagSec / frameSec));
}

/**
 * Schroeder backward-integrated energy decay; the slope fitted between fromDb and toDb below the
 * start (defaults -5 to -25 dB, a T20) is extrapolated to 60 dB. Measured from the energy peak.
 * NaN when the decay never reaches toDb.
 */
export function schroederT60(x: Float32Array, fs: number, fromDb = -5, toDb_ = -25): number {
  let peakAt = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > Math.abs(x[peakAt])) peakAt = i;
  const n = x.length - peakAt;
  const edc = new Float64Array(n);
  let acc = 0;
  for (let i = x.length - 1; i >= peakAt; i--) {
    acc += x[i] * x[i];
    edc[i - peakAt] = acc;
  }
  const e0 = edc[0] || EPS;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let count = 0;
  let reached = false;
  for (let i = 0; i < n; i++) {
    const d = powDb(edc[i] / e0);
    if (d > fromDb) continue;
    if (d < toDb_) {
      reached = true;
      break;
    }
    const t = i / fs;
    sx += t;
    sy += d;
    sxx += t * t;
    sxy += t * d;
    count++;
  }
  if (!reached || count < 3) return NaN;
  const slope = (count * sxy - sx * sy) / (count * sxx - sx * sx);
  return slope < 0 ? -60 / slope : NaN;
}

/**
 * How long the sound stays within dropDb of its loudest 10 ms frame: from the first frame at or above
 * that floor to the last (s). A swell that peaks late counts from where it became audible.
 */
export function audibleDuration(x: Float32Array, fs: number, dropDb = 40): number {
  const frame = 0.01;
  const env = envelope(x, fs, frame);
  let peak = 0;
  let peakAt = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > peak) [peak, peakAt] = [env[i], i];
  const floor = peak * Math.pow(10, -dropDb / 20);
  let first = peakAt;
  let last = peakAt;
  for (let i = 0; i < env.length; i++) {
    if (env[i] < floor) continue;
    first = Math.min(first, i);
    last = i;
  }
  return (last - first + 1) * frame;
}

/**
 * Onset times (s). The signal's first difference (which favours attacks over sustained low partials)
 * is measured as log energy in 1 ms hops over a 3 ms window; an onset is where that energy rises at
 * least riseDb (default 6) above the loudest of the preceding 6..40 ms and sits within floorDb of the loudest
 * point overall. Each onset is placed where its rise begins (the end of the first window still
 * climbing more than 1 dB above the background); onsets closer than minGapSec merge.
 */
export function onsets(
  x: Float32Array,
  fs: number,
  options: { riseDb?: number; floorDb?: number; minGapSec?: number } = {},
): number[] {
  const riseDb = options.riseDb ?? 6;
  const floorDb = options.floorDb ?? 60;
  const minGap = options.minGapSec ?? 0.05;
  const hop = Math.max(1, Math.round(0.001 * fs));
  const win = 3 * hop;
  const frames = Math.floor((x.length - win) / hop);
  if (frames <= 0) return [];
  const e = new Float64Array(frames);
  let maxE = -Infinity;
  for (let k = 0; k < frames; k++) {
    let s = 0;
    const a = k * hop;
    for (let i = a + 1; i < a + win; i++) {
      const d = x[i] - x[i - 1];
      s += d * d;
    }
    e[k] = powDb(s / win);
    maxE = Math.max(maxE, e[k]);
  }
  const out: number[] = [];
  let lastAt = -Infinity;
  for (let k = 0; k < frames; k++) {
    if (e[k] < maxE - floorDb) continue;
    let bg = -Infinity;
    for (let j = k - 40; j <= k - 6; j++) bg = Math.max(bg, j >= 0 ? e[j] : -240);
    if (e[k] - bg < riseDb) continue;
    // Walk back to where this rise begins: while the energy is still climbing and above the background.
    let first = k;
    while (first > 0 && e[first - 1] < e[first] && e[first - 1] - bg > 1) first--;
    // The first rising window ends (win - hop) after it starts: that is where the new sound is.
    const t = first === 0 ? 0 : (first * hop + win - hop) / fs;
    if (t - lastAt >= minGap) {
      out.push(t);
      lastAt = t;
    }
  }
  return out;
}

/**
 * YIN fundamental frequency (de Cheveigné and Kawahara 2002) of x[start..start+window): difference
 * function, cumulative-mean normalisation, absolute threshold, then parabolic interpolation on the
 * raw difference. NaN when nothing in [minHz, maxHz] is periodic enough.
 */
export function yinPitch(
  x: Float32Array,
  fs: number,
  options: { start?: number; window?: number; minHz?: number; maxHz?: number; threshold?: number } = {},
): number {
  const start = options.start ?? 0;
  const W = options.window ?? 4096;
  const tauMax = Math.floor(fs / (options.minHz ?? 50));
  const tauMin = Math.max(2, Math.floor(fs / (options.maxHz ?? 2000)));
  const thr = options.threshold ?? 0.1;
  if (start + W + tauMax + 1 > x.length) return NaN;
  const d = new Float64Array(tauMax + 2);
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    let s = 0;
    for (let j = 0; j < W; j++) {
      const v = x[start + j] - x[start + j + tau];
      s += v * v;
    }
    d[tau] = s;
  }
  const dn = new Float64Array(tauMax + 2);
  dn[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    run += d[tau];
    dn[tau] = run > 0 ? (d[tau] * tau) / run : 1;
  }
  let best = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (dn[tau] < thr) {
      while (tau + 1 <= tauMax && dn[tau + 1] < dn[tau]) tau++;
      best = tau;
      break;
    }
  }
  if (best < 0) {
    let min = Infinity;
    for (let tau = tauMin; tau <= tauMax; tau++) if (dn[tau] < min) [min, best] = [dn[tau], tau];
    if (min > 0.5) return NaN;
  }
  const a = d[best - 1];
  const b = d[best];
  const c = d[best + 1];
  const den = a - 2 * b + c;
  const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
  return fs / (best + shift);
}

/** Cents from ref to f. */
export const cents = (f: number, ref: number): number => 1200 * Math.log2(f / ref);

// -------------------------------------------------------------------------------------------------
// The contract's RenderStats
// -------------------------------------------------------------------------------------------------

/** Every RenderStats field for a mono or multi-channel render. */
export function renderStats(channels: Float32Array | readonly Float32Array[], fs: number): RenderStats {
  const chans: readonly Float32Array[] = channels instanceof Float32Array ? [channels] : channels;
  const l = loudness(chans, fs);
  const first = chans[0];
  let peak = 0;
  let tp = 0;
  let sq = 0;
  let count = 0;
  let clipped = 0;
  let dc = 0;
  for (const c of chans) {
    peak = Math.max(peak, samplePeak(c));
    tp = Math.max(tp, truePeak(c));
    for (let i = 0; i < c.length; i++) sq += c[i] * c[i];
    count += c.length;
    clipped += clippedSamples(c);
    dc = Math.max(dc, Math.abs(dcOffset(c)));
  }
  return {
    peakDb: toDb(peak),
    truePeakDb: toDb(tp),
    rmsDb: toDb(Math.sqrt(sq / Math.max(1, count))),
    lufsI: l.integrated,
    lufsMMax: l.momentaryMax,
    clippedSamples: clipped,
    dcOffset: dc,
    centroidHz: spectralCentroid(first, fs),
    below150: bandEnergy(first, fs, 0, 150),
    below40: bandEnergy(first, fs, 0, 40),
    durationSec: first.length / fs,
  };
}
