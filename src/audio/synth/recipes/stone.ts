/**
 * Stone (docs/AUDIO_DESIGN.md §6.4): light and heavy knocks, the stone barrier breaking apart, a rock
 * knocked loose and tumbling away, and the shared stone knock the other recipes reuse for pebbles and
 * tumbling blocks.
 */
import type { SoundId } from '../../contract';
import {
  type BakeContext,
  type Mode,
  type Recipe,
  crack,
  grain,
  grainTrainSteps,
  jitterModes,
  limitCrestSteps,
  modal,
  noiseLayer,
  noiseLayerSteps,
  pulse,
  qToT60,
  stickSlipSteps,
} from '../blocks';
import { TAU, ahd, pick, range } from '../dsp';

/** Light stone modes {520, 830, 1290, 1920, 2750} Hz, T60 40–90 ms (higher modes shorter). */
export const STONE_LIGHT_MODES: readonly Mode[] = [
  [520, 0.09, 1],
  [830, 0.08, 0.6],
  [1290, 0.065, 0.45],
  [1920, 0.055, 0.3],
  [2750, 0.045, 0.2],
];

/** Heavy stone modes {160, 270, 430, 690, 1050} Hz, T60 120–220 ms. */
export const STONE_HEAVY_MODES: readonly Mode[] = [
  [160, 0.19, 1],
  [270, 0.165, 0.75],
  [430, 0.145, 0.55],
  [690, 0.13, 0.4],
  [1050, 0.12, 0.28],
];

export interface KnockOptions {
  /** Mode frequency factor (stone size; > 1 is smaller) and spread. */
  readonly factor: number;
  readonly spread: number;
  /** T60 multiplier. */
  readonly t60Scale: number;
  /** Width of the pulse that excites the modes (s): wider is a softer, lower strike. */
  readonly strike: number;
  readonly clickHz: number;
  readonly clickGain: number;
  readonly grit: number;
  readonly gritSpan: number;
  readonly gritGain: number;
  /** Grit band (Hz). */
  readonly gritLo: number;
  readonly gritHi: number;
  readonly gain: number;
}

/** One stone knock at t: band-passed click, ringing modes, a scatter of grit grains. */
export function stoneKnock(c: BakeContext, t: number, modes: readonly Mode[], o: KnockOptions): void {
  const { fs, out, r } = c;
  const m = jitterModes(r, modes, o.factor, o.spread, 0.12).map(([f, t60, a]): Mode => [f, t60 * o.t60Scale, a]);
  modal(out, fs, t, pulse(fs, o.strike), m, o.gain);
  noiseLayer(out, fs, r, {
    colour: 'white',
    at: t,
    len: 0.04,
    gain: o.clickGain * o.gain,
    env: (s) => ahd(s, 0.0004, 0.0025, 0.006),
    filters: [['bandpass', o.clickHz, 0.9]],
    normaliseBand: true,
  });
  for (let k = 0; k < o.grit; k++) {
    const fc = o.gritLo * Math.pow(o.gritHi / o.gritLo, r());
    grain(out, fs, r, t + r() * o.gritSpan, fc, 2, range(r, 0.0015, 0.005), o.gritGain * o.gain * range(r, 0.4, 1));
  }
}

function* hitStoneLight(c: BakeContext): Generator<void, void, void> {
  stoneKnock(c, 0, STONE_LIGHT_MODES, {
    factor: range(c.r, 0.9, 1.1),
    spread: 0.03,
    t60Scale: 1,
    strike: 0.00025,
    clickHz: 2600,
    clickGain: 0.3,
    grit: pick(c.r, 6, 10),
    gritSpan: 0.04,
    gritGain: 0.1,
    gritLo: 1200,
    gritHi: 4500,
    gain: 1,
  });
  yield;
}

function* hitStoneHeavy(c: BakeContext): Generator<void, void, void> {
  stoneKnock(c, 0, STONE_HEAVY_MODES, {
    factor: range(c.r, 0.9, 1.1),
    spread: 0.04,
    t60Scale: 1,
    strike: 0.0012,
    clickHz: 1600,
    clickGain: 0.3,
    grit: pick(c.r, 10, 16),
    gritSpan: 0.06,
    gritGain: 0.08,
    gritLo: 800,
    gritHi: 3000,
    gain: 1,
  });
  yield;
}

/**
 * A stone barrier breaking apart (rule F6; reworked after the playtest of 2026-10-23, when it was a knock
 * and a few pebbles 14 LU under a house collapse): the crack (3-5 cracks in 20 ms and a big block's
 * knock), the blocks grinding as they shift (stick-slip into stone modes at 190-540 Hz), 3-6 blocks
 * tumbling (bigger than pebbles, so lower and longer) from +80 ms, a 320 Hz rumble under them and a
 * gravel spill. Crest held to 12 dB.
 */
function* stoneScatter(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  crack(out, fs, r, 0, pick(r, 3, 5), 0.02, 2200, 1.4, 0.8);
  stoneKnock(c, 0, STONE_HEAVY_MODES, {
    factor: range(r, 0.8, 0.95),
    spread: 0.04,
    t60Scale: 1.5,
    strike: 0.0014,
    clickHz: 1600,
    clickGain: 0.35,
    grit: 18,
    gritSpan: 0.08,
    gritGain: 0.12,
    gritLo: 800,
    gritHi: 3500,
    gain: 1,
  });
  yield;
  yield* stickSlipSteps(out, fs, r, {
    start: 0.04,
    dur: range(r, 0.45, 0.6),
    rate0: 38,
    rate1: 22,
    jitter: 0.2,
    modes: [190, 330, 540].map((f0, i): Mode => {
      const fr = f0 * range(r, 0.94, 1.06);
      return [fr, qToT60(fr, 8), [1, 0.7, 0.45][i]];
    }),
    gain: 0.4,
    env: (u) => Math.sin(Math.PI * u),
  });
  yield;
  const count = pick(r, 3, 6);
  let t = range(r, 0.08, 0.12);
  let gain = 0.85;
  for (let k = 0; k < count && t < 0.95; k++) {
    stoneKnock(c, t, STONE_HEAVY_MODES, {
      factor: range(r, 0.85, 1.3),
      spread: 0.05,
      t60Scale: 1,
      strike: 0.0013,
      clickHz: 2000,
      clickGain: 0.35,
      grit: 8,
      gritSpan: 0.04,
      gritGain: 0.12,
      gritLo: 1000,
      gritHi: 4000,
      gain,
    });
    t += range(r, 0.09, 0.2);
    gain *= range(r, 0.72, 0.88);
    yield;
  }
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'pink',
    at: 0.03,
    len: 1.2,
    gain: 0.55,
    env: (s) => ahd(s, 0.03, 0.2, 0.2),
    filters: [['bandpass', 320, 0.9]],
    normaliseBand: true,
  });
  yield* grainTrainSteps(out, fs, r, {
    start: 0.02,
    end: range(r, 0.8, 1.0),
    rate0: 140,
    rate1: 10,
    fLo: 600,
    fHi: 3500,
    q: 1.6,
    tauLo: 0.0015,
    tauHi: 0.005,
    gain: 0.16,
    gainEnd: 0.02,
  });
  yield* limitCrestSteps(out, fs, 12);
  yield;
}

/**
 * A rock knocked loose (rule F6b, playtest 2026-10-23): the crack of the blow (2-4 bright cracks, the
 * stone's heavy knock with fracture grit, chips flying for 140 ms), then the rock tumbling away: 5-7
 * knocks, irregular and fading, over a rolling rumble at 380 Hz that turns 7-11 times a second, and a
 * spray of gravel. The router pitches it by the rock's mass (a small rock higher). Crest held to 13 dB.
 */
function* stoneTumble(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  crack(out, fs, r, 0, pick(r, 2, 4), 0.014, 3000, 1.6, 0.7);
  stoneKnock(c, 0, STONE_HEAVY_MODES, {
    factor: range(r, 0.95, 1.15),
    spread: 0.04,
    t60Scale: 1.25,
    strike: 0.0009,
    clickHz: 2400,
    clickGain: 0.45,
    grit: 18,
    gritSpan: 0.08,
    gritGain: 0.14,
    gritLo: 1200,
    gritHi: 5000,
    gain: 1,
  });
  yield;
  yield* grainTrainSteps(out, fs, r, {
    start: 0.004,
    end: 0.14,
    rate0: 450,
    rate1: 80,
    fLo: 2000,
    fHi: 6000,
    q: 2,
    tauLo: 0.0006,
    tauHi: 0.002,
    gain: 0.25,
    gainEnd: 0.06,
  });
  yield;
  const count = pick(r, 5, 7);
  let t = range(r, 0.12, 0.18);
  let gain = 0.95;
  let last = t;
  for (let k = 0; k < count && t < 1; k++) {
    stoneKnock(c, t, STONE_HEAVY_MODES, {
      factor: range(r, 1, 1.35),
      spread: 0.06,
      t60Scale: 0.85,
      strike: 0.001,
      clickHz: 1900,
      clickGain: 0.5,
      grit: 8,
      gritSpan: 0.04,
      gritGain: 0.12,
      gritLo: 900,
      gritHi: 3500,
      gain,
    });
    last = t;
    gain *= range(r, 0.75, 0.9);
    t += range(r, 0.1, 0.2) * (1 + 0.12 * k);
    yield;
  }
  const rollHz = range(r, 7, 11);
  const end = last + 0.15;
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'pink',
    at: 0.08,
    len: end - 0.08 + 0.4,
    gain: 0.3,
    env: (s) => {
      const u = s / (end - 0.08);
      const shape = u < 0.1 ? u / 0.1 : u <= 1 ? 1 - (0.55 * (u - 0.1)) / 0.9 : 0.45 * Math.exp(-(s - (end - 0.08)) / 0.08);
      return shape * (0.6 + 0.4 * Math.sin(TAU * rollHz * s));
    },
    filters: [['bandpass', 380, 0.9]],
    normaliseBand: true,
  });
  yield* grainTrainSteps(out, fs, r, {
    start: 0.05,
    end: Math.min(1.2, end + 0.1),
    rate0: 110,
    rate1: 10,
    fLo: 700,
    fHi: 3500,
    q: 1.6,
    tauLo: 0.0015,
    tauHi: 0.005,
    gain: 0.1,
    gainEnd: 0.02,
  });
  yield* limitCrestSteps(out, fs, 13);
  yield;
}

export const STONE_RECIPES = {
  'hit.stone.light': hitStoneLight,
  'hit.stone.heavy': hitStoneHeavy,
  'stone.scatter': stoneScatter,
  'stone.tumble': stoneTumble,
} satisfies Partial<Record<SoundId, Recipe>>;
