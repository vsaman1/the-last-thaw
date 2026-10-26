/**
 * Masonry and the big failures (docs/AUDIO_DESIGN.md §6.4): the weight layer under heavy hits, hits on
 * buildings that hold, houses collapsing (masonry, timber and glass that gives way), stone buildings
 * and towers coming down, the dam breaking, and the quiet settle after (Story).
 *
 * Weight without spectacle: every low layer is high-passed (45–70 Hz) and carries a 180–300 Hz body,
 * so at least half of each heavy sound's energy sits above 150 Hz (tested) and it never reads as a
 * cinematic boom. Long rumbles are shortened to decay inside their buffers: house slump τ 0.8 → 0.6 s,
 * masonry.collapse.small rumble 0.8 → 0.5 s, masonry.collapse.large rumble 1.2–2.5 → 0.75–0.95 s, dam
 * rumble 3 → 1.1 s (the live flood voice carries the water on after the dam's one-shot).
 */
import type { SoundId } from '../../contract';
import {
  type BakeContext,
  type Mode,
  type Recipe,
  type Steps,
  chirp,
  crack,
  grainTrainSteps,
  modal,
  noiseLayer,
  noiseLayerSteps,
  pulse,
  qToT60,
  stickSlipSteps,
} from '../blocks';
import { Biquad, ahd, filterSteps, pick, processSteps, range } from '../dsp';
import { shards, paneTick } from './glass';
import { structureThump } from './metal';
import { woodSnap } from './wood';

/** Pebble ticks: tiny light-stone modes at 1.5–4 kHz. */
function pebble(c: BakeContext, t: number, gain: number): void {
  const f = range(c.r, 1500, 4000);
  modal(c.out, c.fs, t, pulse(c.fs, 0.0002), [
    [f, range(c.r, 0.015, 0.04), 1],
    [f * range(c.r, 1.5, 1.9), range(c.r, 0.01, 0.025), 0.5],
  ], gain);
}

/** A settle trickle between t0 and t1: pebbles thinning from rate0 to rate1 a second, quieter as they go. */
function* settle(c: BakeContext, t0: number, t1: number, rate0: number, rate1: number, gain0: number, gain1: number): Steps {
  const { r } = c;
  let t = t0;
  for (;;) {
    const u = (t - t0) / (t1 - t0);
    t += -Math.log(1 - r() * 0.999999) / (rate0 * Math.pow(rate1 / rate0, u));
    if (t >= t1) return;
    const v = (t - t0) / (t1 - t0);
    pebble(c, t, gain0 * Math.pow(gain1 / gain0, v) * range(r, 0.5, 1));
    yield;
  }
}

/** A masonry crack: an impulse train band-passed at 1.2 kHz, high-passed hiss, and a short thud with a body. */
function* masonryCrack(c: BakeContext, t: number, gain: number, stretch = 1): Steps {
  const { fs, out, r } = c;
  crack(out, fs, r, t, pick(r, 4, 7), 0.01 * stretch, 1200, 1.6, gain);
  noiseLayer(out, fs, r, {
    colour: 'white',
    at: t,
    len: 0.03 * stretch,
    gain: gain * 0.6,
    env: (s) => ahd(s, 0.0003, 0.002 * stretch, 0.004 * stretch),
    filters: [['highpass', 1000, 0.7]],
  });
  yield;
  chirp(out, fs, t, 100, 60, 0.1, 0.08, gain * 0.5, 0.004);
  yield;
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'brown',
    at: t,
    len: 0.5,
    gain: gain * 0.5,
    env: (s) => ahd(s, 0.004, 0, 0.09),
    filters: [['bandpass', 240, 1.2]],
    normaliseBand: true,
  });
}

/** A brown rumble low-passed at lpHz and high-passed at 55 Hz, attack then exp decay, optional slow AM. */
function* rumble(c: BakeContext, t: number, len: number, lpHz: number, attack: number, tau: number, gain: number, amHz = 0, amDepth = 0): Steps {
  const ph = c.r() * Math.PI * 2;
  yield* noiseLayerSteps(c.out, c.fs, c.r, {
    colour: 'brown',
    at: t,
    len,
    gain,
    env: (s) => ahd(s, attack, 0, tau) * (1 - amDepth + amDepth * (0.5 + 0.5 * Math.sin(2 * Math.PI * amHz * s + ph))),
    filters: [
      ['lowpass', lpHz, 0.7],
      ['highpass', 55, 0.7],
      ['highpass', 55, 0.7],
    ],
  });
}

/** Crumble: grains at 300–2000 Hz whose rate falls from rate0 to rate1 a second. */
function* crumble(c: BakeContext, t0: number, t1: number, rate0: number, rate1: number, gain0: number, gain1: number, fLo = 300, fHi = 2000): Steps {
  yield* grainTrainSteps(c.out, c.fs, c.r, { start: t0, end: t1, rate0, rate1, fLo, fHi, q: 1.4, tauLo: 0.002, tauHi: 0.007, gain: gain0, gainEnd: gain1 });
}

/**
 * The weight layer under heavy hits: a 95 → 48 Hz sweep (τ 90 ms), 150 Hz-low-passed brown noise,
 * and a 180–300 Hz band-passed body that carries the weight on laptop speakers.
 */
function* weightThump(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  chirp(out, fs, 0, 95, 48, 0.12, 0.09, 0.18, 0.005);
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'brown',
    at: 0,
    len: 0.6,
    gain: 0.12,
    env: (s) => ahd(s, 0.005, 0, 0.1),
    filters: [
      ['lowpass', 150, 0.7],
      ['highpass', 55, 0.7],
    ],
  });
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'brown',
    at: 0,
    len: 0.8,
    gain: 2.2,
    env: (s) => ahd(s, 0.004, 0.006, 0.06),
    filters: [['bandpass', range(r, 220, 270), 1.2]],
    normaliseBand: true,
  });
  yield;
}

/** A building that holds ("shook"): a 110 → 70 Hz thud, 500 Hz-low-passed brown noise, plaster grit. */
function* hitMasonry(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  chirp(out, fs, 0, 110, 70, 0.1, 0.08, 0.7, 0.004);
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'brown',
    at: 0,
    len: 0.55,
    gain: 0.75,
    env: (s) => ahd(s, 0.003, 0, 0.11),
    filters: [
      ['lowpass', 500, 0.7],
      ['highpass', 90, 0.7],
    ],
  });
  yield* crumble(c, 0.004, 0.25, 160, 20, 0.45, 0.06, 900, 2500);
  yield;
}

/**
 * A house collapsing: the masonry crack; glass that gives way (a pane tick, then 8–14 shards spread
 * to 0.9 s at -6 dB); 3–5 timber snaps at -6 dB and a timber groan from 0.15 s; the slump rumble with
 * rubble grains thinning from 60 to 5 a second; the roof coming down at 0.9 s; a settle trickle at -20 dB.
 */
function* houseCollapse(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  yield* masonryCrack(c, 0, 0.6);
  yield;
  paneTick(c, range(r, 0.06, 0.1), 0.5);
  yield* shards(c, 0, pick(r, 8, 14), 0.1, 0.9, 0.45, 0.5, 2.0);
  yield;
  const snaps = pick(r, 3, 5);
  for (let k = 0; k < snaps; k++) woodSnap(c, range(r, 0.1, 1.2), 0.5 * range(r, 0.6, 1), 0.3);
  yield* stickSlipSteps(out, fs, r, {
    start: 0.15,
    dur: 0.9,
    rate0: 60,
    rate1: 35,
    jitter: 0.15,
    modes: [140, 360, 790].map((f, i): Mode => {
      const fr = f * range(r, 0.94, 1.06);
      return [fr, qToT60(fr, 7), [1, 0.7, 0.4][i]];
    }),
    gain: 0.2,
    env: (u) => Math.sin(Math.PI * u),
  });
  yield;
  yield* rumble(c, 0.2, 2.9, 220, 0.15, 0.62, 0.4);
  // The slump's body: the building shifting and grinding as it goes down, above the rumble's band.
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'pink',
    at: 0.2,
    len: 2.9,
    gain: 1.0,
    env: (s) => ahd(s, 0.15, 0.5, 0.75),
    filters: [['bandpass', 320, 0.8]],
    normaliseBand: true,
  });
  yield* crumble(c, 0.2, 2.6, 90, 10, 0.7, 0.1, 300, 1500);
  yield;
  yield* structureThump(c, range(r, 0.85, 0.95), 0.55);
  yield* settle(c, 1.4, 2.9, 16, 3, 0.18, 0.05);
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'pink',
    at: 1.4,
    len: 1.6,
    gain: 0.04,
    env: (s) => ahd(s, 0.2, 0, 0.4),
    filters: [['highpass', 2000, 0.7]],
  });
  yield;
}

/** Monument, silo (and F2 add-ons): a crack, a 350 Hz grind, a rumble, crumble thinning out, a 1 s settle. */
function* masonryCollapseSmall(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  yield* masonryCrack(c, 0, 1);
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'pink',
    at: 0.02,
    len: 0.7,
    gain: 0.45,
    env: (s) => ahd(s, 0.05, 0.2, 0.1),
    filters: [['bandpass', 350, 2]],
    normaliseBand: true,
  });
  yield;
  yield* rumble(c, 0.05, 2.2, 200, 0.15, 0.5, 0.5);
  yield* crumble(c, 0.05, 1.7, 100, 8, 0.35, 0.05, 400, 2000);
  yield* settle(c, 1.1, 2.0, 12, 2, 0.08, 0.025);
  yield;
}

/**
 * Church, apartment block, cooling tower, smokestack, lighthouse, road bridge: the crack; the stone
 * groan of the lean (friction-excited stone modes at 60–220 Hz for 1.2 s); a grind; the rumble with
 * 3–6 Hz movement; crumble; 30–60 slate clicks; the heavy landing; a 2–3 s settle. High-passed at 45 Hz.
 */
function* masonryCollapseLarge(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  yield* masonryCrack(c, 0, 1, 1.3);
  const stone: Mode[] = [62, 97, 141, 188, 219].map((f, i): Mode => {
    const fr = f * range(r, 0.95, 1.05);
    return [fr, qToT60(fr, 8), 1 - i * 0.12];
  });
  const upper: Mode[] = [310, 470, 690].map((f): Mode => {
    const fr = f * range(r, 0.95, 1.05);
    return [fr, qToT60(fr, 10), 0.4];
  });
  yield* stickSlipSteps(out, fs, r, {
    start: 0.05,
    dur: 1.2,
    rate0: 30,
    rate1: 18,
    jitter: 0.15,
    modes: [...stone, ...upper],
    gain: 0.35,
    env: (u) => Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.1)), 0.8),
  });
  yield;
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'pink',
    at: 0.6,
    len: 0.9,
    gain: 0.4,
    env: (s) => ahd(s, 0.08, 0.3, 0.12),
    filters: [['bandpass', 300, 2]],
    normaliseBand: true,
  });
  yield* rumble(c, 0.5, 3.4, range(r, 160, 220), 0.2, range(r, 0.75, 0.95), 0.38, range(r, 3, 6), 0.2);
  yield;
  yield* crumble(c, 0.6, 3.0, 120, 8, 0.35, 0.04, 300, 1800);
  const land = range(r, 0.9, 1.1);
  const slates = pick(r, 30, 60);
  for (let k = 0; k < slates; k++) {
    const t = land + Math.pow(r(), 1.4) * 0.8;
    const f = range(r, 1500, 4500);
    modal(out, fs, t, pulse(fs, 0.00015), [
      [f, range(r, 0.015, 0.04), 1],
      [f * range(r, 1.6, 2.3), range(r, 0.01, 0.03), 0.6],
    ], range(r, 0.12, 0.28) * (1 - 0.5 * ((t - land) / 0.8)));
    if (k % 8 === 7) yield;
  }
  yield;
  yield* structureThump(c, land, 0.9);
  yield* settle(c, 1.8, 3.9, 15, 1.5, 0.1, 0.02);
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'pink',
    at: 1.8,
    len: 2.2,
    gain: 0.03,
    env: (s) => ahd(s, 0.3, 0, 0.5),
    filters: [['highpass', 2000, 0.7]],
  });
  yield* filterSteps(out, fs, 'highpass', 45, 0.7);
  yield;
}

/**
 * The dam: concrete cracks at 0 and +0.15 s (the masonry crack, 1.5x longer), a deep rumble, a
 * 260 Hz grind for 1.5 s, and the rush onset (noise through a low-pass opening 300 → 2500 Hz over
 * 2.5 s with a swell) that the live flood voice takes over. No explosion layer.
 */
function* damBreak(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  yield* masonryCrack(c, 0, 0.7, 1.5);
  yield* masonryCrack(c, 0.15, 0.55, 1.5);
  yield;
  yield* rumble(c, 0.05, 4.8, 140, 0.4, 1.1, 0.85);
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'pink',
    at: 0.1,
    len: 2.2,
    gain: 0.7,
    env: (s) => ahd(s, 0.2, 0.9, 0.25),
    filters: [['bandpass', 260, 1.5]],
    normaliseBand: true,
  });
  yield;
  const peak = range(r, 2.4, 2.7);
  const rush = new Float32Array(Math.round(4.7 * fs));
  yield* noiseLayerSteps(rush, fs, r, {
    colour: 'pink',
    at: 0,
    len: 4.7,
    gain: 1,
    env: (s) => {
      const t = s + 0.3;
      // The water gathers force quickly and the low-pass keeps opening: a surge, not a riser.
      if (t < peak) return Math.pow((t - 0.3) / (peak - 0.3), 0.5);
      return Math.exp(-(t - peak) / 0.5);
    },
    sweep: { type: 'lowpass', q: 0.8, freqAt: (s) => 300 * Math.pow(2500 / 300, Math.min(1, s / 2.5)) },
  });
  yield* processSteps(new Biquad(fs).set('highpass', 120, 0.7), rush);
  let pk = 0;
  for (let i = 0; i < rush.length; i++) {
    pk = Math.max(pk, Math.abs(rush[i]));
    if ((i & 32767) === 32767) yield;
  }
  const off = Math.round(0.3 * fs);
  for (let i = 0; i < rush.length && off + i < out.length; i++) {
    out[off + i] += (1.6 * rush[i]) / (pk || 1);
    if ((i & 32767) === 32767) yield;
  }
  yield;
}

/** Story only: "the quiet after". Pebble ticks and dust hiss thinning from 12 to 0.5 a second over 3 s. */
function* debrisSettle(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  yield* settle(c, 0, 2.5, 12, 0.5, 0.6, 0.1);
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'pink',
    at: 0,
    len: 2.7,
    gain: 0.03,
    env: (s) => ahd(s, 0.05, 0, 0.5),
    filters: [['highpass', 2000, 0.7]],
  });
  yield;
}

export const MASONRY_RECIPES = {
  'weight.thump': weightThump,
  'hit.masonry': hitMasonry,
  'house.collapse': houseCollapse,
  'masonry.collapse.small': masonryCollapseSmall,
  'masonry.collapse.large': masonryCollapseLarge,
  'dam.break': damBreak,
  'debris.settle': debrisSettle,
} satisfies Partial<Record<SoundId, Recipe>>;
