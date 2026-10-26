/**
 * The one shared space (docs/AUDIO_DESIGN.md §2.2): a procedural stereo impulse response for the
 * ConvolverNode the effects strips send to. Outdoors in a valley, not a hall: a few early reflections
 * off the slopes, then a diffuse tail of decorrelated noise that decays exponentially and darkens as it
 * goes (high frequencies die first in air), with SPACE.predelaySec of silence at the start.
 *
 * Each channel has unit energy, so with `convolver.normalize = false` a send of g returns noise at the
 * same RMS × g; the predelay is baked in (no DelayNode needed).
 *
 * The IR needs no context, only its sample rate, and takes 40-50 ms to make (headless Chrome), so the
 * engine makes it on the menu in idle time for the rate the context will most likely have
 * (spaceIRSteps); generateSpaceIR returns that one when the rate matches. The result is kept (about
 * 0.8 MB at 48 kHz): the lab's offline renders use the same IR.
 */
import { SPACE, type GenerateSpaceIR } from '../contract';
import { Biquad, bakeSeed, range, seededRng, type Rng } from './dsp';

/** The tail's RT60 (s): it falls 60 dB in this time, about 73 dB over the 2.2 s IR. */
export const SPACE_RT60_SEC = 1.8;

function channel(n: number, fs: number, r: Rng): Float32Array {
  const pre = Math.round(SPACE.predelaySec * fs);
  const x = new Float32Array(n);
  const decay = Math.pow(10, -3 / (SPACE_RT60_SEC * fs));
  // Diffuse tail: noise under the exponential decay, building over the first 30 ms.
  let env = 1;
  const build = Math.round(0.03 * fs);
  for (let i = pre; i < n; i++) {
    const k = i - pre;
    x[i] = (r() * 2 - 1) * env * (k < build ? k / build : 1) * 0.6;
    env *= decay;
  }
  // Early reflections off the valley sides: 6 taps within 15-90 ms, each a short smeared click.
  for (let k = 0; k < 6; k++) {
    const at = pre + Math.round(range(r, 0.0, 0.075) * fs);
    const g = range(r, 0.4, 1) * (r() < 0.5 ? -1 : 1);
    for (let j = 0; j < 24 && at + j < n; j++) x[at + j] += g * Math.exp(-j / 6) * (r() * 0.4 + 0.8);
  }
  // Air: a low-pass closing from 9 kHz to 1.5 kHz over the length (recomputed every 64 samples).
  const bq = new Biquad(fs);
  for (let i = 0; i < n; i += 64) {
    const u = i / n;
    bq.set('lowpass', Math.min(fs * 0.45, 9000 * Math.pow(1500 / 9000, u)), 0.7);
    const stop = Math.min(n, i + 64);
    for (let j = i; j < stop; j++) x[j] = bq.tick(x[j]);
  }
  new Biquad(fs).set('highpass', 80, 0.7).process(x);
  // A clean end and unit energy.
  const fade = Math.round(0.1 * n);
  for (let i = n - fade; i < n; i++) x[i] *= 0.5 + 0.5 * Math.cos((Math.PI * (i - (n - fade) + 1)) / fade);
  for (let i = 0; i < pre; i++) x[i] = 0;
  let e = 0;
  for (const v of x) e += v * v;
  const g = e > 0 ? 1 / Math.sqrt(e) : 0;
  for (let i = 0; i < n; i++) x[i] *= g;
  return x;
}

/** IRs made so far, by sample rate, length and seed: [left, right], either still missing. */
const made = new Map<string, [Float32Array | null, Float32Array | null]>();

function irEntry(sampleRate: number, seconds: number, seed: number): [Float32Array | null, Float32Array | null] {
  const key = [sampleRate, seconds, seed].join('|');
  let e = made.get(key);
  if (!e) made.set(key, (e = [null, null]));
  return e;
}

const makeChannel = (sampleRate: number, seconds: number, seed: number, side: 0 | 1): Float32Array =>
  channel(Math.max(1, Math.round(sampleRate * seconds)), sampleRate, seededRng(bakeSeed(seed, 'space-ir', side)));

/** The IR's work as two steps (one channel each), to run in idle time before the context exists. */
export function spaceIRSteps(sampleRate: number, seconds: number, seed: number): (() => void)[] {
  return ([0, 1] as const).map((side) => () => {
    const e = irEntry(sampleRate, seconds, seed);
    e[side] ??= makeChannel(sampleRate, seconds, seed, side);
  });
}

/** Two decorrelated channels of `seconds` at `sampleRate`, seeded by hash(seed, 'space-ir'). */
export const generateSpaceIR: GenerateSpaceIR = (sampleRate, seconds, seed) => {
  const e = irEntry(sampleRate, seconds, seed);
  e[0] ??= makeChannel(sampleRate, seconds, seed, 0);
  e[1] ??= makeChannel(sampleRate, seconds, seed, 1);
  return [e[0], e[1]] as const;
};
