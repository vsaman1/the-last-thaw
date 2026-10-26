/**
 * Synthesis building blocks on top of dsp.ts (docs/AUDIO_DESIGN.md §6.1): excitations, the modal
 * bank, noise grains and Poisson grain trains, chirps, stick-slip trains (creaks and groans), noise
 * layers with static or swept filters, and the loop helpers. Every block ADDS into an output buffer
 * at a time in seconds, so a recipe reads as a list of layers.
 *
 * Levels: a block's `gain` is roughly the peak amplitude it contributes. Excitations are normalised
 * (a pulse sums to 1, a noise burst has unit energy) so a mode of amplitude `amp` rings at about amp,
 * and band-passed noise is scaled back to unit RMS whatever its bandwidth, so a grain's gain does not
 * depend on its centre frequency.
 */
import type { SoundId } from '../contract';
import {
  Biquad,
  type BiquadType,
  type NoiseColour,
  type Rng,
  TAU,
  ahd,
  mixInto,
  noise,
  range,
  resonate,
} from './dsp';

// -------------------------------------------------------------------------------------------------
// Recipes
// -------------------------------------------------------------------------------------------------

/** What a recipe gets: a zeroed output of the bake length, its rate, and its seeded stream. */
export interface BakeContext {
  readonly id: SoundId;
  readonly variant: number;
  readonly fs: number;
  /** Samples in the finished buffer (SOUND_DEFS seconds × sampleRate). */
  readonly n: number;
  readonly out: Float32Array;
  readonly r: Rng;
}

/**
 * A recipe renders into c.out and yields between layers, so the bank can bake in short slices
 * (§6.1: ≤ 4 ms). It never finishes the buffer: the bake rules are applied by bakeSound.
 * A loop recipe must leave c.out seamless (see fold and loopCrossfade in dsp.ts).
 */
export type Recipe = (c: BakeContext) => Generator<void, void, void>;

export const sec = (fs: number, s: number): number => Math.round(s * fs);

/**
 * Resumable work: a generator that yields wherever the bank may end a slice. Every long block has a
 * *Steps form (used with yield* in recipes) and a plain form that runs it at once; both produce the
 * same samples, in the same order of random draws.
 */
export type Steps<T = void> = Generator<void, T, void>;

/** Runs resumable work to its end. */
export function runSteps<T>(steps: Steps<T>): T {
  for (;;) {
    const s = steps.next();
    if (s.done) return s.value;
  }
}

/** Samples of per-sample work between two yields (a fraction of a millisecond). */
const CHUNK = 4096;

// -------------------------------------------------------------------------------------------------
// Excitations
// -------------------------------------------------------------------------------------------------

/** Half-cosine pulse of the given width, summing to 1 (flat spectrum up to about 1/width). */
export function pulse(fs: number, width: number): Float32Array {
  const n = Math.max(1, sec(fs, width));
  const x = new Float32Array(n);
  let s = 0;
  for (let i = 0; i < n; i++) {
    x[i] = Math.sin((Math.PI * (i + 0.5)) / n);
    s += x[i];
  }
  for (let i = 0; i < n; i++) x[i] /= s;
  return x;
}

/** White noise burst of length `len` under exp(-t/tau), unit energy. */
export function noiseBurst(fs: number, r: Rng, len: number, tau: number): Float32Array {
  const n = Math.max(1, sec(fs, len));
  const x = new Float32Array(n);
  let e = 0;
  for (let i = 0; i < n; i++) {
    x[i] = (r() * 2 - 1) * Math.exp(-i / (tau * fs));
    e += x[i] * x[i];
  }
  const g = e > 0 ? 1 / Math.sqrt(e) : 0;
  for (let i = 0; i < n; i++) x[i] *= g;
  return x;
}

// -------------------------------------------------------------------------------------------------
// Modes
// -------------------------------------------------------------------------------------------------

/** [frequency Hz, T60 s, amplitude]. */
export type Mode = readonly [number, number, number];

/** T60 of a resonance with quality factor q (bandwidth f/q): 3·ln(10)·q/(π·f). */
export const qToT60 = (f: number, q: number): number => (3 * Math.LN10 * q) / (Math.PI * f);

/** Rings every mode from the excitation, starting at t seconds, scaled by gain (yields per mode). */
export function* modalSteps(out: Float32Array, fs: number, t: number, exc: Float32Array, modes: readonly Mode[], gain = 1): Steps {
  for (const [f, t60, amp] of modes) {
    resonate(out, exc, fs, f, t60, amp * gain, sec(fs, t));
    yield;
  }
}

export const modal = (out: Float32Array, fs: number, t: number, exc: Float32Array, modes: readonly Mode[], gain = 1): void =>
  runSteps(modalSteps(out, fs, t, exc, modes, gain));

/** Modes with every frequency scaled by `factor` and jittered by ±spread, T60 by ±t60Spread. */
export function jitterModes(r: Rng, modes: readonly Mode[], factor: number, spread: number, t60Spread = 0): Mode[] {
  return modes.map(([f, t60, a]) => [
    f * factor * (1 + spread * (2 * r() - 1)),
    t60 * (1 + t60Spread * (2 * r() - 1)),
    a,
  ]);
}

// -------------------------------------------------------------------------------------------------
// Noise grains
// -------------------------------------------------------------------------------------------------

/** RMS of unit-RMS white noise through an RBJ band-pass of centre fc and Q (equivalent noise bandwidth). */
const bandpassRmsGain = (fs: number, fc: number, q: number): number =>
  Math.sqrt(Math.min(1, (Math.PI * fc) / (q * fs)));

/**
 * One grain: a slice of white noise under a 0.5 ms attack and exp(-t/tau), through a band-pass at fc,
 * scaled to unit RMS at the envelope peak, added into out at t seconds.
 */
export function grain(out: Float32Array, fs: number, r: Rng, t: number, fc: number, q: number, tau: number, gain: number): void {
  const start = sec(fs, t);
  if (start >= out.length || fc >= fs * 0.45) return;
  const len = Math.min(out.length - start, Math.ceil(tau * 7 * fs) + 8);
  const bq = new Biquad(fs).set('bandpass', fc, q);
  const g = (gain * Math.sqrt(3)) / bandpassRmsGain(fs, fc, q);
  const att = Math.max(2, sec(fs, 0.0005));
  const d = Math.exp(-1 / (tau * fs));
  let e = 1;
  for (let i = 0; i < len; i++) {
    const env = i < att ? i / att : (e *= d);
    out[start + i] += g * bq.tick((r() * 2 - 1) * env);
  }
}

export interface GrainTrain {
  /** Seconds. */
  readonly start: number;
  readonly end: number;
  /** Grains per second at start and end (exponential in between). */
  readonly rate0: number;
  readonly rate1: number;
  /** Band-pass centre range (log-uniform) and Q. */
  readonly fLo: number;
  readonly fHi: number;
  readonly q: number;
  /** Grain decay range (s). */
  readonly tauLo: number;
  readonly tauHi: number;
  /** Grain peak gain at start and end (exponential in between), and per-grain jitter (dB). */
  readonly gain: number;
  readonly gainEnd?: number;
  readonly jitterDb?: number;
}

/** A Poisson train of grains whose rate and gain glide exponentially from start to end. Returns the count. */
export function* grainTrainSteps(out: Float32Array, fs: number, r: Rng, g: GrainTrain): Steps<number> {
  const span = Math.max(1e-6, g.end - g.start);
  const gEnd = g.gainEnd ?? g.gain;
  const jit = g.jitterDb ?? 3;
  let t = g.start;
  let count = 0;
  for (;;) {
    const u = (t - g.start) / span;
    const rate = g.rate0 * Math.pow(g.rate1 / g.rate0, u);
    t += -Math.log(1 - r() * 0.999999) / Math.max(rate, 1e-3);
    if (t >= g.end) return count;
    const u2 = (t - g.start) / span;
    const level = g.gain * Math.pow(Math.max(gEnd, 1e-9) / g.gain, u2) * Math.pow(10, (jit * (2 * r() - 1)) / 20);
    const fc = g.fLo * Math.pow(g.fHi / g.fLo, r());
    grain(out, fs, r, t, fc, g.q, range(r, g.tauLo, g.tauHi), level);
    count++;
    if (count % 16 === 0) yield;
  }
}

export const grainTrain = (out: Float32Array, fs: number, r: Rng, g: GrainTrain): number => runSteps(grainTrainSteps(out, fs, r, g));

// -------------------------------------------------------------------------------------------------
// Tones
// -------------------------------------------------------------------------------------------------

/**
 * A sine whose frequency glides exponentially from f0 to f1 over glideSec (then holds), under a
 * raised-cosine attack and exp(-t/tau) decay, for len seconds (default 7·tau): thuds, bubbles, bloops.
 */
export function chirp(
  out: Float32Array,
  fs: number,
  t: number,
  f0: number,
  f1: number,
  glideSec: number,
  tau: number,
  gain: number,
  attack = 0.002,
  len = attack + 7 * tau,
): void {
  const start = sec(fs, t);
  const n = Math.min(out.length - start, sec(fs, len));
  let phase = 0;
  const k = Math.log(f1 / f0) / Math.max(glideSec, 1e-6);
  for (let i = 0; i < n; i++) {
    const ts = i / fs;
    const f = ts < glideSec ? f0 * Math.exp(k * ts) : f1;
    phase += (TAU * f) / fs;
    out[start + i] += gain * ahd(ts, attack, 0, tau) * Math.sin(phase);
  }
}

/**
 * Sum of harmonics 1..count of a fundamental that follows f(t), amplitudes amp(n), under env(t):
 * motors and drones. The phase is accumulated, so a glide is smooth.
 */
export function* harmonicsSteps(
  out: Float32Array,
  fs: number,
  t: number,
  len: number,
  f: (ts: number) => number,
  count: number,
  amp: (n: number) => number,
  env: (ts: number) => number,
  gain: number,
): Steps {
  const start = sec(fs, t);
  const n = Math.min(out.length - start, sec(fs, len));
  const amps = Array.from({ length: count }, (_, i) => amp(i + 1));
  const block = Math.max(256, Math.floor(CHUNK / Math.max(1, count / 2)));
  let phase = 0;
  for (let c0 = 0; c0 < n; c0 += block) {
    const c1 = Math.min(n, c0 + block);
    for (let i = c0; i < c1; i++) {
      const ts = i / fs;
      const f0 = f(ts);
      phase += (TAU * f0) / fs;
      let s = 0;
      for (let h = 1; h <= count; h++) if (h * f0 < fs * 0.45) s += amps[h - 1] * Math.sin(h * phase);
      out[start + i] += gain * env(ts) * s;
    }
    yield;
  }
}

export const harmonics = (
  out: Float32Array,
  fs: number,
  t: number,
  len: number,
  f: (ts: number) => number,
  count: number,
  amp: (n: number) => number,
  env: (ts: number) => number,
  gain: number,
): void => runSteps(harmonicsSteps(out, fs, t, len, f, count, amp, env, gain));

// -------------------------------------------------------------------------------------------------
// Stick-slip trains (creaks, groans)
// -------------------------------------------------------------------------------------------------

export interface StickSlip {
  readonly start: number;
  readonly dur: number;
  /** Impulse rate (per second) at the start and end (exponential glide). */
  readonly rate0: number;
  readonly rate1: number;
  /** ± fraction of jitter on each interval and amplitude (0.15 in the design). */
  readonly jitter: number;
  readonly modes: readonly Mode[];
  readonly gain: number;
  /** Amplitude envelope over the train, u in 0..1. */
  readonly env?: (u: number) => number;
}

/** Friction: impulses at a gliding rate with jitter, ringing a set of resonators. */
export function* stickSlipSteps(out: Float32Array, fs: number, r: Rng, s: StickSlip): Steps {
  const n = sec(fs, s.dur);
  const exc = new Float32Array(n);
  let t = 0;
  while (t < s.dur) {
    const u = t / s.dur;
    const rate = s.rate0 * Math.pow(s.rate1 / s.rate0, u);
    const i = sec(fs, t);
    if (i < n) exc[i] += (s.env ? s.env(u) : 1) * (1 + s.jitter * (2 * r() - 1));
    t += (1 / rate) * (1 + s.jitter * (2 * r() - 1));
  }
  yield* modalSteps(out, fs, s.start, exc, s.modes, s.gain);
}

export const stickSlip = (out: Float32Array, fs: number, r: Rng, s: StickSlip): void => runSteps(stickSlipSteps(out, fs, r, s));

// -------------------------------------------------------------------------------------------------
// Noise layers
// -------------------------------------------------------------------------------------------------

/** [type, frequency, Q?, gainDb?]. */
export type FilterSpec = readonly [BiquadType, number, number?, number?];

export interface NoiseLayer {
  readonly colour: NoiseColour;
  /** Start and length (s). */
  readonly at: number;
  readonly len: number;
  readonly gain: number;
  /** Amplitude envelope, seconds since `at`. */
  readonly env: (t: number) => number;
  /** Static filters, in order. */
  readonly filters?: readonly FilterSpec[];
  /** A swept filter after the static ones: frequency as a function of seconds since `at`. */
  readonly sweep?: { readonly type: BiquadType; readonly q: number; readonly freqAt: (t: number) => number };
  /** Scale band-passed noise back to unit RMS (the first band-pass's equivalent noise bandwidth). */
  readonly normaliseBand?: boolean;
}

/** Coloured noise, filtered (statically and/or swept), under an envelope, added into out. */
export function* noiseLayerSteps(out: Float32Array, fs: number, r: Rng, l: NoiseLayer): Steps {
  const start = sec(fs, l.at);
  const n = Math.min(out.length - start, sec(fs, l.len));
  if (n <= 0) return;
  const x = noise(l.colour, n, r);
  yield;
  let norm = 1;
  for (const [type, f, q, g] of l.filters ?? []) {
    const bq = new Biquad(fs).set(type, f, q ?? Math.SQRT1_2, g ?? 0);
    for (let c0 = 0; c0 < n; c0 += CHUNK) {
      bq.process(x, c0, Math.min(n, c0 + CHUNK));
      yield;
    }
    if (l.normaliseBand && type === 'bandpass' && norm === 1) norm = 1 / bandpassRmsGain(fs, f, q ?? Math.SQRT1_2);
  }
  if (l.sweep) {
    const bq = new Biquad(fs);
    const { type, q, freqAt } = l.sweep;
    for (let i = 0; i < n; i += 32) {
      bq.set(type, freqAt(i / fs), q);
      const stop = Math.min(n, i + 32);
      for (let k = i; k < stop; k++) x[k] = bq.tick(x[k]);
      if ((i & (CHUNK - 1)) === 0) yield;
    }
  }
  const g = l.gain * norm;
  for (let c0 = 0; c0 < n; c0 += CHUNK) {
    const c1 = Math.min(n, c0 + CHUNK);
    for (let i = c0; i < c1; i++) out[start + i] += g * l.env(i / fs) * x[i];
    yield;
  }
}

export const noiseLayer = (out: Float32Array, fs: number, r: Rng, l: NoiseLayer): void => runSteps(noiseLayerSteps(out, fs, r, l));

// -------------------------------------------------------------------------------------------------
// Crest
// -------------------------------------------------------------------------------------------------

/**
 * Holds every peak within crestDb of the loudest 400 ms of the buffer (RMS): a smooth limiter whose gain
 * falls 1 ms ahead of a peak and recovers over 25 ms, never above 1. The bake normalises a one-shot's
 * PEAK to 1, so without it a variant whose tallest click happens to be sharper bakes several dB quieter
 * than its siblings; with it, the variants of a long, busy sound (a tree falling, a log pile) keep about
 * the same loudness under the same peak. Run it as a recipe's last layer.
 */
export function* limitCrestSteps(out: Float32Array, fs: number, crestDb: number): Steps {
  const n = out.length;
  const w = Math.max(1, Math.min(n, sec(fs, 0.4)));
  let sum = 0;
  for (let i = 0; i < w; i++) sum += out[i] * out[i];
  let best = sum;
  for (let i = w; i < n; i++) {
    sum += out[i] * out[i] - out[i - w] * out[i - w];
    if (sum > best) best = sum;
  }
  yield;
  const ceil = Math.sqrt(Math.max(0, best) / w) * Math.pow(10, crestDb / 20);
  if (!(ceil > 0)) return;
  const g = new Float32Array(n);
  const release = Math.exp(-1 / (0.025 * fs));
  let s = 1;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(out[i]);
    s = Math.min(a > ceil ? ceil / a : 1, 1 - (1 - s) * release);
    g[i] = s;
  }
  yield;
  // Backwards: the gain starts to fall 1 ms before each peak, so the limiting never clicks.
  const attack = Math.exp(-1 / (0.001 * fs));
  let b = 1;
  for (let i = n - 1; i >= 0; i--) {
    b = Math.min(g[i], 1 - (1 - b) * attack);
    out[i] *= b;
  }
}

/** A short burst of noise impulses (a crack): count impulses of 1–2 ms within spanSec, band-passed. */
export function crack(out: Float32Array, fs: number, r: Rng, t: number, count: number, spanSec: number, fc: number, q: number, gain: number): void {
  const buf = new Float32Array(sec(fs, spanSec + 0.03));
  for (let k = 0; k < count; k++) {
    const at = k === 0 ? 0 : r() * spanSec;
    const w = range(r, 0.001, 0.002);
    const a = k === 0 ? 1 : range(r, 0.4, 1);
    const p = pulse(fs, w);
    const sign = r() < 0.5 ? -1 : 1;
    // A pulse is a lowpass blip; its band-passed ring is the snap.
    mixInto(buf, p, sec(fs, at), sign * a * p.length);
  }
  new Biquad(fs).set('bandpass', fc, q).process(buf);
  let pk = 0;
  for (const v of buf) pk = Math.max(pk, Math.abs(v));
  mixInto(out, buf, sec(fs, t), pk > 0 ? gain / pk : 0);
}

