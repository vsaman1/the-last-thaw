/**
 * Pure DSP for the baked sounds (docs/AUDIO_DESIGN.md §6.1): seeded noise in three colours, RBJ
 * biquads, a one-pole smoother, the two-pole modal resonator, envelopes, a loop crossfade, and the
 * bake rules every buffer gets before the engine sees it.
 *
 * Everything writes into Float32Array and runs under node, so every recipe is testable without a
 * browser. There is no Math.random anywhere: every choice comes from a mulberry32 stream
 * (src/core/rng.ts) seeded by hash(SEED, sound id, variant), so two bakes are bit-identical.
 */
import { createRng } from '../../core/rng';

export type Rng = () => number;

export const TAU = Math.PI * 2;

/** Every bake's high-pass: weight must survive laptop speakers and never read as a cinematic boom. */
export const BAKE_HIGHPASS_HZ = 40;
/** Loops are RMS-normalised to this (one-shots are peak-normalised to 1). */
export const LOOP_RMS = 0.25;
/** Minimum end fade of a one-shot; long sounds fade over a share of their length (finishOneShot). */
export const END_FADE_MIN_SEC = 0.03;
/** RMS the noise generators normalise to, so recipes mix colours at comparable levels. */
export const NOISE_RMS = 0.3;

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const dbToLin = (db: number): number => Math.pow(10, db / 20);
export const linToDb = (x: number): number => 20 * Math.log10(Math.max(x, 1e-12));
/** Uniform in [lo, hi). */
export const range = (r: Rng, lo: number, hi: number): number => lo + (hi - lo) * r();
/** x scaled by a uniform factor in [1 - frac, 1 + frac]. */
export const vary = (r: Rng, x: number, frac: number): number => x * (1 + frac * (2 * r() - 1));
/** Integer in [lo, hi] inclusive. */
export const pick = (r: Rng, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));

// -------------------------------------------------------------------------------------------------
// Seeds
// -------------------------------------------------------------------------------------------------

/** 32-bit FNV-1a over a string's UTF-16 code units. */
export function fnv1a(text: string, hash = 0x811c9dc5): number {
  let h = hash >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * FNV-1a over the samples quantised to Int16 (little-endian bytes): each baked buffer's hash, which
 * the bank combines into its checksum (here, so the motif worker hashes what it renders too).
 */
export function pcmHash(data: Float32Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    const v = Math.max(-32768, Math.min(32767, Math.round(data[i] * 32767)));
    h = Math.imul(h ^ (v & 0xff), 0x01000193) >>> 0;
    h = Math.imul(h ^ ((v >> 8) & 0xff), 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The bake seed of one buffer: hash(SEED, id, variant). Separate ids never share a sequence. */
export const bakeSeed = (seed: number, id: string, variant: number): number =>
  fnv1a(`${seed}|${id}|${variant}`);

/** A seeded mulberry32 stream (core/rng). */
export const seededRng = (seed: number): Rng => createRng(seed);

// -------------------------------------------------------------------------------------------------
// Noise
// -------------------------------------------------------------------------------------------------

export function rms(x: Float32Array, start = 0, end = x.length): number {
  let s = 0;
  for (let i = start; i < end; i++) s += x[i] * x[i];
  return end > start ? Math.sqrt(s / (end - start)) : 0;
}

export function peakAbs(x: Float32Array, start = 0, end = x.length): number {
  let p = 0;
  for (let i = start; i < end; i++) {
    const a = Math.abs(x[i]);
    if (a > p) p = a;
  }
  return p;
}

export function scale(x: Float32Array, g: number, start = 0, end = x.length): Float32Array {
  for (let i = start; i < end; i++) x[i] *= g;
  return x;
}

function normaliseRms(x: Float32Array, target: number): Float32Array {
  const r = rms(x);
  return r > 0 ? scale(x, target / r) : x;
}

/** Uniform white noise, RMS NOISE_RMS. */
export function whiteNoise(n: number, r: Rng): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = r() * 2 - 1;
  return normaliseRms(x, NOISE_RMS);
}

/**
 * Pink noise by Paul Kellet's refined filter (within 0.05 dB of -3 dB/octave from 9.2 Hz at 44.1 kHz;
 * the response is fixed in normalised frequency, so at 24 kHz it holds from 5 Hz to Nyquist). RMS NOISE_RMS.
 */
export function pinkNoise(n: number, r: Rng): Float32Array {
  const x = new Float32Array(n);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  // Settle the slow poles first so the buffer starts in steady state rather than ramping in.
  for (let i = -4096; i < n; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const y = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    if (i >= 0) x[i] = y;
  }
  return normaliseRms(x, NOISE_RMS);
}

/** Brown noise: a leaky integrator (0.997) of white noise, DC removed, RMS NOISE_RMS. */
export function brownNoise(n: number, r: Rng): Float32Array {
  const x = new Float32Array(n);
  let y = 0;
  for (let i = -2048; i < n; i++) {
    y = 0.997 * y + (r() * 2 - 1) * 0.06;
    if (i >= 0) x[i] = y;
  }
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= Math.max(1, n);
  for (let i = 0; i < n; i++) x[i] -= mean;
  return normaliseRms(x, NOISE_RMS);
}

export type NoiseColour = 'white' | 'pink' | 'brown';

export function noise(colour: NoiseColour, n: number, r: Rng): Float32Array {
  return colour === 'white' ? whiteNoise(n, r) : colour === 'pink' ? pinkNoise(n, r) : brownNoise(n, r);
}

// -------------------------------------------------------------------------------------------------
// Filters
// -------------------------------------------------------------------------------------------------

export type BiquadType = 'lowpass' | 'highpass' | 'bandpass' | 'peaking' | 'lowshelf' | 'highshelf' | 'allpass';

/**
 * RBJ cookbook biquad, direct form I, state kept in doubles. Q is linear for every type. Band-pass is
 * the constant 0 dB peak form: the bilinear transform of the analogue band-pass, so its -3 dB points
 * sit at tan(πf/fs) = tan(πf0/fs)·(√(1 + 1/4Q²) ± 1/2Q), the analogue edges warped toward Nyquist.
 *
 * `webAudio: true` reproduces BiquadFilterNode instead (for node-side models of the live voices):
 * lowpass/highpass Q is then read in dB, as the spec computes it.
 */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(
    private readonly fs: number,
    private readonly webAudio = false,
  ) {}

  set(type: BiquadType, freq: number, q = Math.SQRT1_2, gainDb = 0): this {
    const f = clamp(freq, 1, this.fs * 0.49);
    const w = (TAU * f) / this.fs;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const dbQ = this.webAudio && (type === 'lowpass' || type === 'highpass');
    const alpha = dbQ ? sw / (2 * Math.pow(10, q / 20)) : sw / (2 * Math.max(q, 1e-4));
    const A = Math.pow(10, gainDb / 40);
    let b0: number;
    let b1: number;
    let b2: number;
    let a0: number;
    let a1: number;
    let a2: number;
    switch (type) {
      case 'lowpass':
        b0 = (1 - cw) / 2;
        b1 = 1 - cw;
        b2 = (1 - cw) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'highpass':
        b0 = (1 + cw) / 2;
        b1 = -(1 + cw);
        b2 = (1 + cw) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'bandpass':
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'peaking':
        b0 = 1 + alpha * A;
        b1 = -2 * cw;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cw;
        a2 = 1 - alpha / A;
        break;
      case 'lowshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 - (A - 1) * cw + s);
        b1 = 2 * A * (A - 1 - (A + 1) * cw);
        b2 = A * (A + 1 - (A - 1) * cw - s);
        a0 = A + 1 + (A - 1) * cw + s;
        a1 = -2 * (A - 1 + (A + 1) * cw);
        a2 = A + 1 + (A - 1) * cw - s;
        break;
      }
      case 'highshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 + (A - 1) * cw + s);
        b1 = -2 * A * (A - 1 + (A + 1) * cw);
        b2 = A * (A + 1 + (A - 1) * cw - s);
        a0 = A + 1 - (A - 1) * cw + s;
        a1 = 2 * (A - 1 - (A + 1) * cw);
        a2 = A + 1 - (A - 1) * cw - s;
        break;
      }
      case 'allpass':
        b0 = 1 - alpha;
        b1 = -2 * cw;
        b2 = 1 + alpha;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
    return this;
  }

  reset(): this {
    this.x1 = 0;
    this.x2 = 0;
    this.y1 = 0;
    this.y2 = 0;
    return this;
  }

  tick(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = Math.abs(y) < 1e-30 ? 0 : y;
    return y;
  }

  /** Filters buf[start..end) in place. */
  process(buf: Float32Array, start = 0, end = buf.length): Float32Array {
    for (let i = start; i < end; i++) buf[i] = this.tick(buf[i]);
    return buf;
  }

  /** Magnitude response at freq (Hz), for tests and calibration. */
  gainAt(freq: number): number {
    const w = (TAU * freq) / this.fs;
    const c1 = Math.cos(w);
    const s1 = Math.sin(w);
    const c2 = Math.cos(2 * w);
    const s2 = Math.sin(2 * w);
    const nr = this.b0 + this.b1 * c1 + this.b2 * c2;
    const ni = -(this.b1 * s1 + this.b2 * s2);
    const dr = 1 + this.a1 * c1 + this.a2 * c2;
    const di = -(this.a1 * s1 + this.a2 * s2);
    return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
  }
}

/** One static biquad over buf (in place). */
export function filter(
  buf: Float32Array,
  fs: number,
  type: BiquadType,
  freq: number,
  q = Math.SQRT1_2,
  gainDb = 0,
  start = 0,
  end = buf.length,
): Float32Array {
  return new Biquad(fs).set(type, freq, q, gainDb).process(buf, start, end);
}

/**
 * A biquad whose frequency follows freqAt(seconds from start), recomputed every 32 samples (a
 * 1.3 ms step at 24 kHz: inaudible as zipper). In place over buf[start..end).
 */
export function filterSweep(
  buf: Float32Array,
  fs: number,
  type: BiquadType,
  q: number,
  freqAt: (t: number) => number,
  start = 0,
  end = buf.length,
): Float32Array {
  const bq = new Biquad(fs);
  for (let i = start; i < end; i += 32) {
    bq.set(type, freqAt((i - start) / fs), q);
    const stop = Math.min(end, i + 32);
    for (let k = i; k < stop; k++) buf[k] = bq.tick(buf[k]);
  }
  return buf;
}

/** Exponential glide from f0 to f1 over sec, then held: for filterSweep. */
export const glide = (f0: number, f1: number, sec: number) => (t: number): number =>
  f0 * Math.pow(f1 / f0, Math.min(1, Math.max(0, t / sec)));

/** Samples of filtering between two yields in the resumable forms below (well under a millisecond). */
export const STEP_SAMPLES = 8192;

/** Runs a biquad over buf[start..end) in place, yielding every STEP_SAMPLES (resumable). */
export function* processSteps(bq: Biquad, buf: Float32Array, start = 0, end = buf.length): Generator<void, void, void> {
  for (let i = start; i < end; i += STEP_SAMPLES) {
    bq.process(buf, i, Math.min(end, i + STEP_SAMPLES));
    yield;
  }
}

/** filter() in resumable steps (the same samples). */
export function* filterSteps(buf: Float32Array, fs: number, type: BiquadType, freq: number, q = Math.SQRT1_2, gainDb = 0): Generator<void, void, void> {
  yield* processSteps(new Biquad(fs).set(type, freq, q, gainDb), buf);
}

/** filterSweep() in resumable steps (the same samples). */
export function* filterSweepSteps(buf: Float32Array, fs: number, type: BiquadType, q: number, freqAt: (t: number) => number): Generator<void, void, void> {
  const bq = new Biquad(fs);
  for (let i = 0; i < buf.length; i += 32) {
    bq.set(type, freqAt(i / fs), q);
    const stop = Math.min(buf.length, i + 32);
    for (let k = i; k < stop; k++) buf[k] = bq.tick(buf[k]);
    if ((i & (STEP_SAMPLES - 1)) === 0) yield;
  }
}

/** Fourth-order Butterworth high-pass in resumable steps. */
export function* highpass4Steps(buf: Float32Array, fs: number, freq: number): Generator<void, void, void> {
  yield* processSteps(new Biquad(fs).set('highpass', freq, 0.5411961), buf);
  yield* processSteps(new Biquad(fs).set('highpass', freq, 1.306563), buf);
}

/** Fourth-order Butterworth high-pass (two cascaded biquads), in place. */
export function highpass4(buf: Float32Array, fs: number, freq: number): Float32Array {
  new Biquad(fs).set('highpass', freq, 0.5411961).process(buf);
  return new Biquad(fs).set('highpass', freq, 1.3065630).process(buf);
}

/** Fourth-order Butterworth low-pass (two cascaded biquads), in place. */
export function lowpass4(buf: Float32Array, fs: number, freq: number): Float32Array {
  new Biquad(fs).set('lowpass', freq, 0.5411961).process(buf);
  return new Biquad(fs).set('lowpass', freq, 1.3065630).process(buf);
}

/** One-pole low-pass smoother y += a·(x - y), a = 1 - e^(-2πf/fs). */
export class OnePole {
  private y = 0;
  private readonly a: number;
  constructor(fs: number, freq: number) {
    this.a = 1 - Math.exp((-TAU * freq) / fs);
  }
  tick(x: number): number {
    this.y += this.a * (x - this.y);
    return this.y;
  }
  process(buf: Float32Array, start = 0, end = buf.length): Float32Array {
    for (let i = start; i < end; i++) buf[i] = this.tick(buf[i]);
    return buf;
  }
}

// -------------------------------------------------------------------------------------------------
// Modal resonator
// -------------------------------------------------------------------------------------------------

/** Pole radius for a given T60: the amplitude falls 60 dB in t60 seconds. */
export const t60Radius = (t60: number, fs: number): number => Math.pow(10, -3 / (Math.max(t60, 1e-4) * fs));

/**
 * Two-pole resonator y[n] = 2r·cos(ω)·y[n-1] - r²·y[n-2] + x[n], r = 10^(-3/(T60·fs)): three
 * multiplies per sample and no Math.sin in the loop. The input is scaled by amp·sin(ω), so a unit
 * impulse rings as amp·r^n·sin((n+1)ω). The response of `input` (starting at out[at]) is ADDED into
 * out, and the loop stops once the ring has fallen 100 dB after the input ends.
 */
export function resonate(
  out: Float32Array,
  input: Float32Array,
  fs: number,
  freq: number,
  t60: number,
  amp: number,
  at = 0,
): void {
  if (freq <= 0 || freq >= fs * 0.45 || amp === 0) return;
  const w = (TAU * freq) / fs;
  const r = t60Radius(t60, fs);
  const c1 = 2 * r * Math.cos(w);
  const c2 = -r * r;
  const g = amp * Math.sin(w);
  const inLen = input.length;
  const start = Math.max(0, Math.floor(at));
  const stop = Math.min(out.length, start + inLen + Math.ceil(t60 * fs * (100 / 60)));
  let y1 = 0;
  let y2 = 0;
  for (let n = start; n < stop; n++) {
    const k = n - start;
    const y = c1 * y1 + c2 * y2 + (k < inLen ? input[k] * g : 0);
    out[n] += y;
    y2 = y1;
    y1 = y;
  }
}

// -------------------------------------------------------------------------------------------------
// Envelopes and mixing
// -------------------------------------------------------------------------------------------------

/** Raised-cosine attack, hold, then exponential decay (amplitude), t in seconds since onset. */
export function ahd(t: number, attack: number, hold: number, tau: number): number {
  if (t < 0) return 0;
  if (t < attack) return 0.5 - 0.5 * Math.cos((Math.PI * t) / attack);
  if (t < attack + hold) return 1;
  return Math.exp(-(t - attack - hold) / tau);
}

/** Multiplies buf[start..start+len) by env(seconds since start). */
export function applyEnv(buf: Float32Array, fs: number, env: (t: number) => number, start = 0, len = buf.length - start): Float32Array {
  const end = Math.min(buf.length, start + len);
  for (let i = Math.max(0, start); i < end; i++) buf[i] *= env((i - start) / fs);
  return buf;
}

/** dst[at + i] += src[i]·gain (clipped to dst). */
export function mixInto(dst: Float32Array, src: Float32Array, at: number, gain = 1): Float32Array {
  const o = Math.floor(at);
  const from = Math.max(0, -o);
  const to = Math.min(src.length, dst.length - o);
  for (let i = from; i < to; i++) dst[o + i] += src[i] * gain;
  return dst;
}

/** Raised-cosine fade-in over the first `sec` (sample 0 becomes exactly 0). */
export function fadeIn(buf: Float32Array, fs: number, sec: number): Float32Array {
  const n = Math.min(buf.length, Math.max(1, Math.round(sec * fs)));
  for (let i = 0; i < n; i++) buf[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / n);
  return buf;
}

/** Raised-cosine fade-out over the last `sec` (the last sample becomes exactly 0). */
export function fadeOut(buf: Float32Array, fs: number, sec: number): Float32Array {
  const len = buf.length;
  const n = Math.min(len, Math.max(1, Math.round(sec * fs)));
  for (let i = 0; i < n; i++) {
    const k = len - n + i;
    buf[k] *= 0.5 + 0.5 * Math.cos((Math.PI * (i + 1)) / n);
  }
  return buf;
}

// -------------------------------------------------------------------------------------------------
// Bake rules (§6.1)
// -------------------------------------------------------------------------------------------------

/**
 * Subtracts the mean of buf[0..n) through a sin² window that is 0 at both ends, so the DC goes and
 * the edges the fades made silent stay silent.
 */
export function removeDcWindowed(buf: Float32Array, n = buf.length): Float32Array {
  if (n < 3) return buf;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += buf[i];
  mean /= n;
  // Σ sin²(πi/(n-1)) over i = 0..n-1 is exactly (n-1)/2. The window is generated by a rotating
  // phasor (no Math.sin per sample: this runs over every baked buffer).
  const k = (mean * n) / ((n - 1) / 2);
  const d = Math.PI / (n - 1);
  const cd = Math.cos(d);
  const sd = Math.sin(d);
  let s = 0;
  let c = 1;
  for (let i = 0; i < n; i++) {
    buf[i] -= k * s * s;
    const ns = s * cd + c * sd;
    c = c * cd - s * sd;
    s = ns;
  }
  return buf;
}

/** The last 20 ms of every one-shot are silent, so a rate-shifted playback can never click at the end. */
export const END_GUARD_SEC = 0.02;
/** Share of a one-shot's length its end fade covers (never less than END_FADE_MIN_SEC). */
export const END_FADE_SHARE = 0.1;

/** Where a one-shot of `len` samples starts its end fade (the recipe's own decay is measured before it). */
export const endFadeStart = (len: number, fs: number): number =>
  len - Math.round(END_GUARD_SEC * fs) - Math.round(Math.max(END_FADE_MIN_SEC, (END_FADE_SHARE * len) / fs) * fs);

/**
 * The one-shot bake rules: 40 Hz fourth-order high-pass; a 1 ms fade-in (first sample 0); a
 * raised-cosine end fade over max(30 ms, 10 % of the length) that closes 20 ms before the end, then
 * those 20 ms silent; windowed DC removal; peak normalised to 1.0, so a layer's gainDb IS its peak
 * dBFS. The fade is cosmetic: every recipe decays on its own first (the recipes test measures how far).
 */
export function* finishOneShotSteps(buf: Float32Array, fs: number): Generator<void, Float32Array, void> {
  const len = buf.length;
  yield* highpass4Steps(buf, fs, BAKE_HIGHPASS_HZ);
  fadeIn(buf, fs, 0.001);
  const guard = Math.round(END_GUARD_SEC * fs);
  const from = Math.max(1, endFadeStart(len, fs));
  const span = Math.max(1, len - guard - from);
  for (let i = from; i < len; i++) {
    const k = i - from;
    buf[i] *= k < span ? 0.5 + 0.5 * Math.cos((Math.PI * (k + 1)) / span) : 0;
  }
  yield;
  removeDcWindowed(buf, len - guard);
  yield;
  const p = peakAbs(buf);
  if (p > 0) scale(buf, 1 / p);
  return buf;
}

export function finishOneShot(buf: Float32Array, fs: number): Float32Array {
  const steps = finishOneShotSteps(buf, fs);
  for (;;) {
    const s = steps.next();
    if (s.done) return s.value;
  }
}

/**
 * Seamless loop of n samples from a render of n + xfade samples: the first xfade samples are an
 * equal-power crossfade of the render's head (fading in) with what follows sample n (fading out),
 * so out[n-1] runs straight on into out[0]. Equal power suits uncorrelated noise-like material.
 */
export function loopCrossfade(render: Float32Array, n: number): Float32Array {
  const xf = render.length - n;
  if (xf <= 0) throw new Error('loopCrossfade: the render must be longer than the loop');
  const out = render.slice(0, n);
  for (let i = 0; i < xf && i < n; i++) {
    const p = (i + 0.5) / xf;
    out[i] = render[i] * Math.sin((p * Math.PI) / 2) + render[n + i] * Math.cos((p * Math.PI) / 2);
  }
  return out;
}

/** Folds a render longer than n back onto its start: the cyclic layout of events whose tails cross the seam. */
export function fold(render: Float32Array, n: number): Float32Array {
  const out = render.slice(0, n);
  for (let i = n; i < render.length; i++) out[i % n] += render[i];
  return out;
}

/**
 * Fourth-order 40 Hz high-pass of a loop as the periodic signal it is: each biquad first runs once
 * round the loop to reach the state the previous cycle would leave, then filters it, so the seam
 * stays seamless.
 */
export function highpass4Circular(buf: Float32Array, fs: number, freq: number): Float32Array {
  for (const q of [0.5411961, 1.306563]) {
    const bq = new Biquad(fs).set('highpass', freq, q);
    for (let i = 0; i < buf.length; i++) bq.tick(buf[i]);
    bq.process(buf);
  }
  return buf;
}

/**
 * The loop bake rules, on a loop the recipe already made seamless (loopCrossfade for noise beds,
 * fold for events): circular 40 Hz high-pass, mean removed, RMS 0.25.
 */
export function* finishLoopSteps(loop: Float32Array, fs: number): Generator<void, Float32Array, void> {
  for (const q of [0.5411961, 1.306563]) {
    const bq = new Biquad(fs).set('highpass', BAKE_HIGHPASS_HZ, q);
    for (let i = 0; i < loop.length; i++) {
      bq.tick(loop[i]);
      if ((i & (STEP_SAMPLES - 1)) === STEP_SAMPLES - 1) yield;
    }
    yield* processSteps(bq, loop);
  }
  let mean = 0;
  for (let i = 0; i < loop.length; i++) mean += loop[i];
  mean /= Math.max(1, loop.length);
  for (let i = 0; i < loop.length; i++) loop[i] -= mean;
  const r = rms(loop);
  if (r > 0) scale(loop, LOOP_RMS / r);
  return loop;
}

export function finishLoop(loop: Float32Array, fs: number): Float32Array {
  const steps = finishLoopSteps(loop, fs);
  for (;;) {
    const s = steps.next();
    if (s.done) return s.value;
  }
}
