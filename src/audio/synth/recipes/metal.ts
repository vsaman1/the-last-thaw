/**
 * Metal (docs/AUDIO_DESIGN.md §6.4): panel and heavy hits, light fittings and vehicles giving way,
 * and industrial structures failing: a metal groan bending down, rivets, clangs and the thump of the
 * weight landing. No explosion, no fire, no sci-fi: everything is plates, bars and friction.
 */
import type { SoundId } from '../../contract';
import {
  type BakeContext,
  type Mode,
  type Recipe,
  type Steps,
  chirp,
  grainTrainSteps,
  modal,
  noiseBurst,
  noiseLayer,
  noiseLayerSteps,
  pulse,
  qToT60,
  stickSlipSteps,
} from '../blocks';
import { Biquad, OnePole, ahd, filter, mixInto, pick, processSteps, range } from '../dsp';

const PLATE_RATIOS = [1, 1.41, 1.73, 2.24, 2.65, 3.16, 3.6] as const;
const PLATE_AMPS = [1, 0.8, 0.7, 0.55, 0.45, 0.35, 0.3] as const;
const BAR_RATIOS = [1, 2.76, 5.4, 8.93, 13.34] as const;
const BAR_AMPS = [1, 0.7, 0.5, 0.3, 0.2] as const;

/** Plate modes of a panel: f0 × {1, 1.41, 1.73, 2.24, 2.65, 3.16, 3.6}, T60 from t60Top down to 0.37 of it. */
export function plateModes(c: BakeContext, f0: number, t60Top: number): Mode[] {
  return PLATE_RATIOS.map((k, i): Mode => [
    f0 * k * range(c.r, 0.98, 1.02),
    t60Top * (1 - (i / (PLATE_RATIOS.length - 1)) * 0.63),
    PLATE_AMPS[i],
  ]);
}

/** Free-bar modes 1 : 2.76 : 5.40 : 8.93 : 13.34, T60 from t60Top falling to 0.28 of it. */
export function barModes(c: BakeContext, f1: number, t60Top: number): Mode[] {
  return BAR_RATIOS.map((k, i): Mode => [
    f1 * k * range(c.r, 0.985, 1.015),
    t60Top * (1 - (i / (BAR_RATIOS.length - 1)) * 0.72),
    BAR_AMPS[i],
  ]);
}

/** A panel clang: click excitation, plate modes, a short hollow 300 Hz body; low-passed at 7 kHz. */
function panelClang(c: BakeContext, t: number, f0: number, t60Top: number, gain: number): void {
  const { fs, out, r } = c;
  const tmp = new Float32Array(out.length);
  const exc = noiseBurst(fs, r, 0.003, 0.001);
  const p = pulse(fs, 0.0004);
  for (let i = 0; i < exc.length; i++) exc[i] *= 0.3;
  for (let i = 0; i < p.length; i++) exc[i] += p[i];
  modal(tmp, fs, t, exc, plateModes(c, f0, t60Top), 1);
  noiseLayer(tmp, fs, r, {
    colour: 'white',
    at: t,
    len: 0.3,
    gain: 0.4,
    env: (s) => ahd(s, 0.001, 0, 0.04),
    filters: [['bandpass', 300, 1.2]],
    normaliseBand: true,
  });
  filter(tmp, fs, 'lowpass', 7000, 0.7);
  mixInto(out, tmp, 0, gain);
}

/** A heavy clang: a struck free bar plus a hollow 120 Hz body. */
function heavyClang(c: BakeContext, t: number, f1: number, t60Top: number, gain: number): void {
  const { fs, out, r } = c;
  const exc = noiseBurst(fs, r, 0.006, 0.002);
  const p = pulse(fs, 0.001);
  for (let i = 0; i < exc.length; i++) exc[i] *= 0.4;
  for (let i = 0; i < p.length; i++) exc[i] += p[i];
  modal(out, fs, t, exc, barModes(c, f1, t60Top), gain);
  noiseLayer(out, fs, r, {
    colour: 'white',
    at: t,
    len: 0.5,
    gain: gain * 0.55,
    env: (s) => ahd(s, 0.002, 0, 0.06),
    filters: [['bandpass', 120, 1.5]],
    normaliseBand: true,
  });
}

/** PolyBLEP sawtooth whose frequency follows f(t). */
function* sawtooth(n: number, fs: number, f: (t: number) => number): Steps<Float32Array> {
  const x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    if ((i & 4095) === 4095) yield;
    const dt = f(i / fs) / fs;
    ph += dt;
    if (ph >= 1) ph -= 1;
    let v = 2 * ph - 1;
    if (ph < dt) {
      const u = ph / dt;
      v -= u + u - u * u - 1;
    } else if (ph > 1 - dt) {
      const u = (ph - 1) / dt;
      v -= u * u + u + u + 1;
    }
    x[i] = v;
  }
  return x;
}

/** Stick-slip amplitude modulation: smoothed jittered bumps at `rate` Hz, between floor and 1. */
function stickSlipAm(n: number, fs: number, r: () => number, rate: number, floor: number): Float32Array {
  const am = new Float32Array(n);
  let t = 0;
  while (t < n / fs) {
    const i = Math.floor(t * fs);
    if (i < n) am[i] = 1 + 0.3 * (2 * r() - 1);
    t += (1 / rate) * (1 + 0.15 * (2 * r() - 1));
  }
  const lp = new OnePole(fs, 25);
  lp.process(am);
  const lp2 = new OnePole(fs, 25);
  lp2.process(am);
  let pk = 0;
  for (const v of am) pk = Math.max(pk, v);
  for (let i = 0; i < n; i++) am[i] = floor + (1 - floor) * (am[i] / (pk || 1));
  return am;
}

/**
 * The metal groan: a 40–75 Hz sawtooth low-passed at 600 Hz, into two resonant band-passes (Q 10) at
 * 220–320 Hz and 480–700 Hz that drift ±8 %, its pitch bending down `semis` over `bendSec`, under
 * stick-slip AM at 8–14 Hz. Added into out at t.
 */
function* metalGroan(c: BakeContext, t: number, f0: number, semis: number, bendSec: number, len: number, gain: number): Steps {
  const { fs, out, r } = c;
  const n = Math.min(out.length - Math.round(t * fs), Math.round(len * fs));
  if (n <= 0) return;
  const bend = (s: number): number => {
    const u = Math.min(1, s / bendSec);
    return f0 * Math.pow(2, (-semis / 12) * (u * u * (3 - 2 * u)));
  };
  const saw = yield* sawtooth(n, fs, bend);
  yield;
  yield* processSteps(new Biquad(fs).set('lowpass', 600, 0.7), saw);
  yield;
  const body = new Float32Array(n);
  for (const [lo, hi, g] of [
    [220, 320, 1],
    [480, 700, 0.7],
  ] as const) {
    const fc = range(r, lo, hi);
    const ph = r() * Math.PI * 2;
    const rate = range(r, 0.2, 0.5);
    const band = saw.slice();
    const bq = new Biquad(fs);
    for (let i = 0; i < n; i += 32) {
      const s = i / fs;
      bq.set('bandpass', fc * (1 + 0.08 * Math.sin(2 * Math.PI * rate * s + ph)) * (bend(s) / f0) ** 0.3, 10);
      const stop = Math.min(n, i + 32);
      for (let k = i; k < stop; k++) band[k] = bq.tick(band[k]);
      if ((i & 4095) === 0) yield;
    }
    for (let i = 0; i < n; i++) body[i] += g * band[i];
    yield;
  }
  const am = stickSlipAm(n, fs, r, range(r, 8, 14), 0.45);
  yield;
  let pk = 0;
  for (let i = 0; i < n; i++) {
    if ((i & 4095) === 4095) yield;
    const s = i / fs;
    const env = s < 0.3 ? Math.sin((s / 0.3) * Math.PI * 0.5) ** 2 : s < len - 0.5 ? 1 : Math.exp(-(s - (len - 0.5)) / 0.12);
    body[i] *= env * am[i];
    pk = Math.max(pk, Math.abs(body[i]));
  }
  mixInto(out, body, Math.round(t * fs), pk > 0 ? gain / pk : 0);
}

/** The heavy thump of a structure's weight landing: a low sweep and a 220 Hz body that survives small speakers. */
export function* structureThump(c: BakeContext, t: number, gain: number): Steps {
  const { fs, out, r } = c;
  chirp(out, fs, t, 90, 50, 0.12, 0.1, gain * 0.7, 0.005);
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'brown',
    at: t,
    len: 0.7,
    gain: gain * 0.8,
    env: (s) => ahd(s, 0.006, 0, 0.12),
    filters: [['bandpass', 220, 1.1]],
    normaliseBand: true,
  });
  yield* grainTrainSteps(out, fs, r, {
    start: t,
    end: t + 0.3,
    rate0: 140,
    rate1: 12,
    fLo: 500,
    fHi: 2500,
    q: 1.5,
    tauLo: 0.002,
    tauHi: 0.005,
    gain: gain * 0.25,
    gainEnd: gain * 0.03,
  });
}

function* hitMetalPanel(c: BakeContext): Generator<void, void, void> {
  panelClang(c, 0, range(c.r, 300, 500), range(c.r, 0.28, 0.4), 1);
  yield;
}

function* hitMetalHeavy(c: BakeContext): Generator<void, void, void> {
  heavyClang(c, 0, range(c.r, 140, 260), range(c.r, 0.8, 0.9), 1);
  yield;
}

/** Guardrail, ski-lift pylon, traffic light: a panel clang and a short 0.4 s groan. */
function* metalBreakLight(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  panelClang(c, 0, range(r, 350, 600), 0.25, 1);
  panelClang(c, range(r, 0.15, 0.3), range(r, 450, 750), 0.15, 0.4);
  yield* stickSlipSteps(out, fs, r, {
    start: 0.04,
    dur: 0.4,
    rate0: 90,
    rate1: 60,
    jitter: 0.15,
    modes: [420, 980, 1650].map((f, i): Mode => {
      const fr = f * range(r, 0.94, 1.06);
      return [fr, qToT60(fr, 12), [1, 0.6, 0.35][i]];
    }),
    gain: 0.18,
    env: (u) => Math.sin(Math.PI * u),
  });
  yield;
}

/** Truck, bus, rail wagon: a heavy clang, a 0.8 s groan bending down 2 semitones, two more clangs. */
function* metalBreakVehicle(c: BakeContext): Generator<void, void, void> {
  const { r } = c;
  heavyClang(c, 0, range(r, 160, 230), 0.5, 1);
  yield;
  yield* metalGroan(c, 0.05, range(r, 80, 110), 2, 0.7, 0.85, 0.4);
  yield;
  panelClang(c, range(r, 0.3, 0.6), range(r, 300, 450), 0.25, 0.5);
  panelClang(c, range(r, 0.65, 0.95), range(r, 350, 550), 0.2, 0.35);
  yield;
}

/**
 * Pylon, water tower, tank, pipeline, factory hall, turbine, pumpjack, oil rig: the long metal groan
 * bending down 3–7 semitones over 1.5–2 s, 2–3 rivet pops, 2–4 heavy clangs at 0.3–1.5 s, and the
 * thump of the weight landing. No explosion and no fire.
 */
function* metalBreakStructure(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  const bendSec = range(r, 1.5, 2.0);
  yield* metalGroan(c, 0, range(r, 40, 75), range(r, 3, 7), bendSec, bendSec + 0.35, 0.75);
  yield;
  const rivets = pick(r, 2, 3);
  for (let k = 0; k < rivets; k++) {
    const t = range(r, 0.2, 1.4);
    const f = range(r, 2000, 4000);
    chirp(out, fs, t, f, f * 0.97, 0.01, 0.008, 0.4, 0.0003);
    modal(out, fs, t, pulse(fs, 0.0002), [[f * 0.53, 0.03, 0.4]], 0.5);
  }
  yield;
  const clangs = pick(r, 2, 4);
  for (let k = 0; k < clangs; k++) {
    heavyClang(c, 0.3 + (1.2 * (k + r() * 0.8)) / clangs, range(r, 120, 220), range(r, 0.3, 0.45), 0.6 * Math.pow(0.8, k));
    yield;
  }
  yield;
  yield* structureThump(c, Math.min(2.1, bendSec + range(r, 0.05, 0.2)), 0.8);
  yield;
}

export const METAL_RECIPES = {
  'hit.metal.panel': hitMetalPanel,
  'hit.metal.heavy': hitMetalHeavy,
  'metal.break.light': metalBreakLight,
  'metal.break.vehicle': metalBreakVehicle,
  'metal.break.structure': metalBreakStructure,
} satisfies Partial<Record<SoundId, Recipe>>;
