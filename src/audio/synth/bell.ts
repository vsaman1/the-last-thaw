/**
 * Church bells (docs/AUDIO_DESIGN.md §7.7): the strike, the shiver (a struck tower resonating with no
 * clapper) and the dull clank under a fallen tower, for each voicing in the contract.
 *
 * A bell is a sum of decaying partials at the classic ratios (hum 0.5, prime 1, tierce 1.2, quint 1.5,
 * nominal 2, then upper partials), each a seeded doublet split by 0.05–0.15 % so it warbles slowly as
 * real bells do. Each partial is a two-pole recursion (no Math.sin per sample). The three forms of one
 * voicing share the same partials (the bell's identity is seeded by voicing only), and the shiver and
 * clank are scaled by the strike's normalisation, so their levels are relative to the strike's.
 *
 * Clachan kirk, cracked in 1911, "rang a note slightly wrong": hum 0.485 and a neutral tierce 1.17,
 * a 0.4 % prime doublet (a 2.3 Hz beat at 573.9 Hz), two extra inharmonic partials, a 31 Hz buzz on
 * the partials from the nominal up for the first 0.4 s, short T60s and a faint rattle.
 */
import {
  BELL_BAKE,
  BELL_PARTIAL_AMPS,
  BELL_PARTIAL_RATIOS,
  BELL_PARTIAL_T60,
  BELL_VOICINGS,
  type BakeBell,
  type BakedPcm,
  type BellForm,
  type BellVoicing,
  type BellVoicingId,
} from '../contract';
import { type Steps, noiseLayer, runSteps } from './blocks';
import {
  Biquad,
  END_GUARD_SEC,
  TAU,
  ahd,
  bakeSeed,
  fadeIn,
  highpass4Steps,
  peakAbs,
  processSteps,
  range,
  removeDcWindowed,
  scale,
  seededRng,
} from './dsp';

/** One sinusoidal component: frequency, amplitude, T60 (s), phase. */
export interface BellPartial {
  readonly hz: number;
  readonly amp: number;
  readonly t60: number;
  readonly phase: number;
  /** Index into BELL_PARTIAL_RATIOS, or -1 for the cracked bell's extra partials. */
  readonly index: number;
  /** True for partials at or above the nominal (the cracked bell's buzz acts on these). */
  readonly upper: boolean;
}

const NOMINAL = BELL_PARTIAL_RATIOS.indexOf(2);
/** Hum, prime and tierce: all a resonating tower gives back. */
const SHIVER_INDICES: readonly number[] = [0, 1, 2];

/** The partial ratios of a voicing (the cracked bell overrides hum and tierce). */
export function bellRatios(v: BellVoicing): number[] {
  return BELL_PARTIAL_RATIOS.map((k, i) => (v.cracked && i === 0 ? v.cracked.humRatio : v.cracked && i === 2 ? v.cracked.tierceRatio : k));
}

/**
 * Every component of a voicing's bell: each partial as a seeded doublet (the second component 0.35–0.7
 * of the first; the cracked prime 0.8, for a clear beat), plus the cracked bell's extra partials.
 */
export function bellPartials(voicing: BellVoicingId, seed: number): BellPartial[] {
  const v = BELL_VOICINGS[voicing];
  const r = seededRng(bakeSeed(seed, `bell:${voicing}`, 0));
  const ratios = bellRatios(v);
  const out: BellPartial[] = [];
  ratios.forEach((k, i) => {
    const f = v.strikeHz * k;
    const split = v.cracked && i === 1 ? v.cracked.primeSplit : range(r, v.doubletSplit[0], v.doubletSplit[1]);
    const second = v.cracked && i === 1 ? 0.8 : range(r, 0.35, 0.7);
    const amp = BELL_PARTIAL_AMPS[i];
    const t60 = BELL_PARTIAL_T60[i] * v.t60Scale;
    const norm = 1 / (1 + second);
    out.push({ hz: f * (1 - split / 2), amp: amp * norm, t60, phase: r() * TAU, index: i, upper: i >= NOMINAL });
    out.push({ hz: f * (1 + split / 2), amp: amp * second * norm, t60: t60 * range(r, 0.9, 1.1), phase: r() * TAU, index: i, upper: i >= NOMINAL });
  });
  for (const [k, amp, t60] of v.cracked?.extra ?? []) {
    out.push({ hz: v.strikeHz * k, amp, t60, phase: r() * TAU, index: -1, upper: k >= 2 });
  }
  return out;
}

/**
 * Adds one decaying partial into out from sample 0: A·r^n·sin(ωn + φ) by the recursion
 * y[n] = 2r·cos(ω)·y[n-1] - r²·y[n-2]. `am` (optional) multiplies it sample by sample.
 */
function* addPartial(out: Float32Array, fs: number, p: BellPartial, t60Scale: number, attackSec: number, am?: (n: number) => number): Steps {
  const w = (TAU * p.hz) / fs;
  if (p.hz >= fs * 0.45) return;
  const rr = Math.pow(10, -3 / (p.t60 * t60Scale * fs));
  const c1 = 2 * rr * Math.cos(w);
  const c2 = -rr * rr;
  let y2 = p.amp * Math.sin(p.phase - w) / rr;
  let y1 = p.amp * Math.sin(p.phase);
  const att = Math.max(1, Math.round(attackSec * fs));
  const stop = Math.min(out.length, Math.ceil(p.t60 * t60Scale * fs * (100 / 60)));
  for (let n = 0; n < stop; n++) {
    const env = n < att ? 0.5 - 0.5 * Math.cos((Math.PI * n) / att) : 1;
    out[n] += y1 * env * (am ? am(n) : 1);
    if ((n & 16383) === 16383) yield;
    const y = c1 * y1 + c2 * y2;
    y2 = y1;
    y1 = y;
  }
}

const FORM_SECONDS: Readonly<Record<BellForm, number>> = {
  strike: BELL_BAKE.strikeSec,
  shiver: BELL_BAKE.shiverSec,
  clank: BELL_BAKE.clankSec,
};

/** End fade per form (the strike's is BELL_BAKE.endFadeSec). */
const FORM_FADE: Readonly<Record<BellForm, number>> = { strike: BELL_BAKE.endFadeSec, shiver: 1, clank: 0.3 };

/** The raw (unnormalised) render of one form, in steps (one per partial). */
function* renderForm(voicing: BellVoicingId, form: BellForm, seed: number): Steps<Float32Array> {
  const v = BELL_VOICINGS[voicing];
  const fs = BELL_BAKE.sampleRate;
  const out = new Float32Array(Math.round(FORM_SECONDS[form] * fs));
  const partials = bellPartials(voicing, seed);
  const r = seededRng(bakeSeed(seed, `bell:${voicing}:${form}`, 0));
  const cracked = v.cracked;
  // The crack's buzz: 31 Hz AM at 35 % on the upper partials, tapering out by 0.4 s.
  const buzz = cracked
    ? (n: number): number => {
        const t = n / fs;
        if (t >= cracked.buzzSec) return 1;
        const taper = t < cracked.buzzSec * 0.75 ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (t - cracked.buzzSec * 0.75)) / (cracked.buzzSec * 0.25));
        return 1 - cracked.buzzDepth * taper * (0.5 + 0.5 * Math.sin(TAU * cracked.buzzHz * t));
      }
    : undefined;
  for (const p of partials) {
    if (form === 'shiver' && !SHIVER_INDICES.includes(p.index)) continue;
    const t60Scale = form === 'clank' ? BELL_BAKE.clankT60Scale : 1;
    // A shiver builds slowly (sympathetic resonance, nothing struck it); a strike is instant.
    const attack = form === 'shiver' ? 0.08 : 0.0005;
    yield* addPartial(out, fs, p, t60Scale, attack, form !== 'shiver' && p.upper ? buzz : undefined);
  }
  if (form === 'strike' || form === 'clank') {
    // The clapper: a 5 ms noise burst band-passed at 3 kHz (-14 dB) and a 400 Hz thunk (-20 dB). The
    // clank's is duller: rubble, not a clapper.
    const ref = peakAbs(out) || 1;
    noiseLayer(out, fs, r, {
      colour: 'white',
      at: 0,
      len: 0.03,
      gain: ref * Math.pow(10, BELL_BAKE.transientDb / 20) * (form === 'clank' ? 0.3 : 1),
      env: (s) => ahd(s, 0.0005, 0.002, 0.0015),
      filters: [['bandpass', 3000, 1.2]],
      normaliseBand: true,
    });
    noiseLayer(out, fs, r, {
      colour: 'brown',
      at: 0,
      len: 0.15,
      gain: ref * Math.pow(10, BELL_BAKE.thunkDb / 20) * (form === 'clank' ? 3 : 1),
      env: (s) => ahd(s, 0.001, 0, 0.02),
      filters: [['lowpass', 400, 0.7]],
    });
    if (cracked && form === 'strike') {
      // The rattle of the crack: 2 kHz noise in 31 Hz pulses, fading over 0.35 s.
      noiseLayer(out, fs, r, {
        colour: 'white',
        at: 0.002,
        len: 0.4,
        gain: ref * Math.pow(10, cracked.rattleDb / 20),
        env: (s) => Math.exp(-s / 0.1) * Math.pow(0.5 + 0.5 * Math.sin(TAU * cracked.buzzHz * s), 4),
        filters: [['bandpass', 2000, 1.5]],
        normaliseBand: true,
      });
    }
    yield;
  }
  if (form === 'clank') yield* processSteps(new Biquad(fs).set('lowpass', BELL_BAKE.clankLowpassHz, 0.7), out);
  // Bake rules as for one-shots: 40 Hz high-pass, 1 ms fade-in, a cosine end fade closing 20 ms before
  // the end, DC removed.
  yield* highpass4Steps(out, fs, 40);
  fadeIn(out, fs, 0.001);
  const guard = Math.round(END_GUARD_SEC * fs);
  const span = Math.round(FORM_FADE[form] * fs);
  const from = out.length - guard - span;
  for (let i = from; i < out.length; i++) {
    const k = i - from;
    out[i] *= k < span ? 0.5 + 0.5 * Math.cos((Math.PI * (k + 1)) / span) : 0;
  }
  yield;
  removeDcWindowed(out, out.length - guard);
  yield;
  return out;
}

/** 1/peak of a voicing's raw strike: the gain every form of that bell is baked with. */
const strikeGains = new Map<string, number>();

function* strikeGain(voicing: BellVoicingId, seed: number): Steps<number> {
  const key = `${voicing}|${seed}`;
  const known = strikeGains.get(key);
  if (known !== undefined) return known;
  const strike = yield* renderForm(voicing, 'strike', seed);
  const g = 1 / (peakAbs(strike) || 1);
  strikeGains.set(key, g);
  return g;
}

/** Bakes one form of one bell in steps (for the bank's slices). */
export function* bakeBellSteps(voicing: BellVoicingId, form: BellForm, seed: number): Steps<BakedPcm> {
  if (form === 'strike') {
    const data = yield* renderForm(voicing, 'strike', seed);
    const g = 1 / (peakAbs(data) || 1);
    strikeGains.set(`${voicing}|${seed}`, g);
    scale(data, g);
    return { sampleRate: BELL_BAKE.sampleRate, data };
  }
  const g = yield* strikeGain(voicing, seed);
  const data = yield* renderForm(voicing, form, seed);
  scale(data, g);
  return { sampleRate: BELL_BAKE.sampleRate, data };
}

/** The strike is peak-normalised to 1.0; the shiver and clank keep their level relative to it. */
export const bakeBell: BakeBell = (voicing, form, seed) => runSteps(bakeBellSteps(voicing, form, seed));
