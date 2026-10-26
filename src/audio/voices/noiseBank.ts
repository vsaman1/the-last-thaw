/**
 * Shared noise for the live voices (docs/AUDIO_DESIGN.md §7): seamless loops of white, pink and brown
 * noise, and slow control signals that are wired straight into gain params, so gusts, babble and
 * swells move with no JavaScript running per frame.
 *
 * Rates are chosen for memory: white and pink at 32 kHz (content to 16 kHz), brown at 16 kHz (it has
 * nothing up there), the control walks at 8 kHz (the lowest rate every engine must accept). About
 * 5.8 MB in all, made once per context.
 *
 * The samples need no AudioContext, and making them takes about 0.1 s of main thread (headless
 * Chrome), so the engine computes them on the menu in idle time, one piece at a time
 * (noiseBankSteps), before the gesture that builds the context; createNoiseBank then only wraps them
 * into AudioBuffers (and lets go of its copy).
 */
import type { CreateNoiseBank, NoiseBank } from '../contract';
import { NOISE_RMS, bakeSeed, brownNoise, loopCrossfade, pinkNoise, rms, scale, seededRng, whiteNoise, type Rng } from '../synth/dsp';

export const NOISE_SECONDS = 6;
export const NOISE_RATES = { white: 32000, pink: 32000, brown: 16000 } as const;
export const CONTROL_SECONDS = 30;
export const CONTROL_RATE = 8000;

/**
 * The control walks, by index into NoiseBank.control: each a smooth 0..1 random walk over 30 s with
 * its own pace (seconds between its random points). `gustTroughs` is `gust` cubed, so its troughs
 * sink to near silence (Act III wind).
 */
export const CONTROL = { gust: 0, babble: 1, swell: 2, gustTroughs: 3 } as const;
export const CONTROL_PACE_SEC: readonly number[] = [0.8, 0.12, 2.5, 0.8];

/** A seamless noise loop of `seconds` (crossfaded over 0.25 s), RMS NOISE_RMS. */
function noiseLoop(make: (n: number, r: Rng) => Float32Array, rate: number, r: Rng): Float32Array {
  const n = Math.round(NOISE_SECONDS * rate);
  const loop = loopCrossfade(make(n + Math.round(0.25 * rate), r), n);
  const v = rms(loop);
  return v > 0 ? scale(loop, NOISE_RMS / v) : loop;
}

/**
 * A smooth periodic random walk: random points every `pace` seconds around a circle, joined by
 * Catmull-Rom curves (so the loop is seamless), scaled to 0..1.
 */
export function controlWalk(seconds: number, rate: number, pace: number, r: Rng): Float32Array {
  const n = Math.round(seconds * rate);
  const k = Math.max(4, Math.round(seconds / pace));
  const pts = Array.from({ length: k }, () => r());
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = (i / n) * k;
    const j = Math.floor(u);
    const t = u - j;
    const p0 = pts[(j - 1 + k) % k];
    const p1 = pts[j % k];
    const p2 = pts[(j + 1) % k];
    const p3 = pts[(j + 2) % k];
    out[i] = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of out) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  for (let i = 0; i < n; i++) out[i] = (out[i] - lo) / (hi - lo || 1);
  return out;
}

type NoisePart = 'white' | 'pink' | 'brown' | 'gust' | 'babble' | 'swell';

const NOISE_PARTS: Readonly<Record<NoisePart, (seed: number) => Float32Array>> = {
  white: (seed) => noiseLoop(whiteNoise, NOISE_RATES.white, seededRng(bakeSeed(seed, 'noise:white', 0))),
  pink: (seed) => noiseLoop(pinkNoise, NOISE_RATES.pink, seededRng(bakeSeed(seed, 'noise:pink', 0))),
  brown: (seed) => noiseLoop(brownNoise, NOISE_RATES.brown, seededRng(bakeSeed(seed, 'noise:brown', 0))),
  gust: (seed) => controlWalk(CONTROL_SECONDS, CONTROL_RATE, CONTROL_PACE_SEC[CONTROL.gust], seededRng(bakeSeed(seed, 'control:gust', 0))),
  babble: (seed) => controlWalk(CONTROL_SECONDS, CONTROL_RATE, CONTROL_PACE_SEC[CONTROL.babble], seededRng(bakeSeed(seed, 'control:babble', 0))),
  swell: (seed) => controlWalk(CONTROL_SECONDS, CONTROL_RATE, CONTROL_PACE_SEC[CONTROL.swell], seededRng(bakeSeed(seed, 'control:swell', 0))),
};

/** Parts computed ahead of the context, by seed (each part depends only on its own seeded stream). */
const prepared = new Map<number, Partial<Record<NoisePart | 'troughs', Float32Array>>>();

function partsOf(seed: number): Partial<Record<NoisePart | 'troughs', Float32Array>> {
  let p = prepared.get(seed);
  if (!p) prepared.set(seed, (p = {}));
  return p;
}

/**
 * The noise bank's work as separate steps (each one part, 5-25 ms), to run in idle time before the
 * context exists. A step whose part is already there does nothing.
 */
export function noiseBankSteps(seed: number): (() => void)[] {
  return (Object.keys(NOISE_PARTS) as NoisePart[]).map((part) => () => {
    const p = partsOf(seed);
    p[part] ??= NOISE_PARTS[part](seed);
    if (part === 'gust') p.troughs ??= troughsOf(p.gust!);
  });
}

/** `gust` cubed: its troughs sink to near silence. */
const troughsOf = (gust: Float32Array): Float32Array => gust.map((v) => v * v * v);

/** The raw sample data of a noise bank (node-testable; createNoiseBank wraps it): the prepared parts, and any missing made now. */
export function noiseBankData(seed: number): {
  white: Float32Array;
  pink: Float32Array;
  brown: Float32Array;
  control: Float32Array[];
} {
  const p = partsOf(seed);
  for (const part of Object.keys(NOISE_PARTS) as NoisePart[]) p[part] ??= NOISE_PARTS[part](seed);
  p.troughs ??= troughsOf(p.gust!);
  return { white: p.white!, pink: p.pink!, brown: p.brown!, control: [p.gust!, p.babble!, p.swell!, p.troughs] };
}

function wrap(ctx: BaseAudioContext, data: Float32Array, rate: number): AudioBuffer {
  const b = ctx.createBuffer(1, data.length, rate);
  b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
  return b;
}

export const createNoiseBank: CreateNoiseBank = (ctx, seed): NoiseBank => {
  const d = noiseBankData(seed);
  // The AudioBuffers hold their own copy: the prepared parts are not needed again for this context.
  prepared.delete(seed);
  return {
    white: wrap(ctx, d.white, NOISE_RATES.white),
    pink: wrap(ctx, d.pink, NOISE_RATES.pink),
    brown: wrap(ctx, d.brown, NOISE_RATES.brown),
    control: d.control.map((c) => wrap(ctx, c, CONTROL_RATE)),
  };
};
