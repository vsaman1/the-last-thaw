/**
 * Wood (docs/AUDIO_DESIGN.md §6.4): knocks on trees and timber, trees falling, wood snapping, log
 * piles collapsing, and timber buildings (chalet, barn) coming down. Every snap is a click, a 2.2 kHz band-passed burst and a
 * thinning splinter crackle; groans are stick-slip friction ringing wood resonators.
 */
import type { SoundId } from '../../contract';
import {
  type BakeContext,
  type Mode,
  type Recipe,
  chirp,
  crack,
  grain,
  grainTrain,
  grainTrainSteps,
  jitterModes,
  limitCrestSteps,
  modal,
  noiseBurst,
  noiseLayer,
  noiseLayerSteps,
  pulse,
  qToT60,
  stickSlipSteps,
} from '../blocks';
import { TAU, ahd, pick, range } from '../dsp';

/** Wood knock modes {180, 410, 690, 1150} Hz, T60 50–90 ms. */
export const WOOD_MODES: readonly Mode[] = [
  [180, 0.085, 0.8],
  [410, 0.09, 1],
  [690, 0.075, 0.65],
  [1150, 0.065, 0.45],
];

/** Wood resonators for creaks and groans {210, 540, 1180} Hz at Q 6. */
const woodResonators = (c: BakeContext, factor: number, q = 6): Mode[] =>
  [210, 540, 1180].map((f, i): Mode => {
    const fr = f * factor * range(c.r, 0.94, 1.06);
    return [fr, qToT60(fr, q), [1, 0.7, 0.4][i]];
  });

/** A wood knock: 6 ms of noise (and a soft pulse) through the wood modes, with a bark crunch. */
export function woodKnock(c: BakeContext, t: number, gain: number, factor = 1, crunch = true): void {
  const { fs, out, r } = c;
  const exc = noiseBurst(fs, r, 0.006, 0.002);
  const p = pulse(fs, 0.002);
  for (let i = 0; i < exc.length; i++) exc[i] *= 0.6;
  for (let i = 0; i < p.length; i++) exc[i] += 0.8 * p[i];
  modal(out, fs, t, exc, jitterModes(r, WOOD_MODES, factor, 0.08, 0.15), gain);
  if (!crunch) return;
  const grains = pick(r, 8, 14);
  for (let k = 0; k < grains; k++) {
    grain(out, fs, r, t + r() * 0.03, range(r, 1800, 3500), 2, range(r, 0.004, 0.008), gain * range(r, 0.025, 0.055));
  }
}

/**
 * One wood snap at t: a 1.5 ms click, a 25 ms burst band-passed at 2.2 kHz (Q 2), then a splinter
 * crackle of 0.5–2 ms grains at 1–4 kHz whose rate falls from 300 to 20 a second over 120–350 ms.
 */
export function woodSnap(c: BakeContext, t: number, gain: number, crackleMax = 0.35): void {
  const { fs, out, r } = c;
  crack(out, fs, r, t, 1, 0.001, 2200, 2, gain * 0.8);
  noiseLayer(out, fs, r, {
    colour: 'white',
    at: t,
    len: 0.025,
    gain: gain * 0.7,
    env: (s) => ahd(s, 0.0004, 0.004, 0.006),
    filters: [['bandpass', 2200 * range(r, 0.9, 1.1), 2]],
    normaliseBand: true,
  });
  modal(out, fs, t, pulse(fs, 0.0006), jitterModes(r, [[350, 0.04, 0.5], [820, 0.035, 0.35], [1500, 0.03, 0.25]], 1, 0.1), gain);
  grainTrain(out, fs, r, {
    start: t + 0.004,
    end: t + range(r, 0.12, crackleMax),
    rate0: 300,
    rate1: 20,
    fLo: 1000,
    fHi: 4000,
    q: 1.5,
    tauLo: 0.0005,
    tauHi: 0.002,
    gain: gain * 0.35,
    gainEnd: gain * 0.05,
  });
}

function* hitWood(c: BakeContext): Generator<void, void, void> {
  woodKnock(c, 0, 1, range(c.r, 0.9, 1.1));
  yield;
}

/** A trunk's own knock: lower and longer than a plank's (a trunk 0.3-0.5 m thick). */
const TRUNK_MODES: readonly Mode[] = [
  [110, 0.22, 0.8],
  [240, 0.18, 1],
  [450, 0.12, 0.75],
  [780, 0.08, 0.45],
  [1250, 0.05, 0.25],
];

/** A felled trunk landing: a dull thud, kept above 130 Hz so laptop speakers still play it. */
const LANDING_MODES: readonly Mode[] = [
  [130, 0.2, 0.8],
  [220, 0.17, 1],
  [340, 0.13, 0.85],
  [520, 0.09, 0.6],
  [800, 0.06, 0.35],
];

function trunkKnock(c: BakeContext, t: number, gain: number, factor: number): void {
  const { fs, out, r } = c;
  const exc = noiseBurst(fs, r, 0.008, 0.003);
  const p = pulse(fs, 0.003);
  for (let i = 0; i < exc.length; i++) exc[i] *= 0.5;
  for (let i = 0; i < p.length; i++) exc[i] += p[i];
  modal(out, fs, t, exc, jitterModes(r, TRUNK_MODES, factor, 0.06, 0.12), gain);
}

/**
 * A tree felled (playtest 2026-10-23: "similar to the house breaking"): the wood snapping and the tree
 * falling, both as loud as each other. The snap: a loud wood snap, the trunk's own knock, the fibres
 * ripping (6-10 cracks in 140 ms and a crackle thinning out over 0.4-0.55 s), the hinge giving way at
 * 0.16-0.26 s. The lean: the hinge creaking (stick-slip 42 → 16 Hz into wood resonators). The fall: the
 * crown swishing down faster and faster (band-passed noise sweeping up). The landing at 1.0-1.15 s: the
 * trunk's thud and a bounce, the crown crashing, 6-10 branches snapping, twigs settling for 0.75 s.
 * Broadleaf: a heavier trunk, a leafier and lower crown. Everything that carries it sits above 130 Hz
 * (the old recipe's ground whump was a 250 Hz-low-passed rumble a laptop cannot play), and the crest is
 * held to 13 dB so the variants bake equally loud.
 */
function treeFall(kind: 'pine' | 'broadleaf') {
  return function* (c: BakeContext): Generator<void, void, void> {
    const { fs, out, r } = c;
    const leafy = kind === 'broadleaf';
    const f = leafy ? 0.9 : 1;
    // 1. The snap.
    woodSnap(c, 0, 1, 0.35);
    trunkKnock(c, 0, 0.7, f * range(r, 1.15, 1.3));
    crack(out, fs, r, 0.02, pick(r, 6, 10), 0.14, 1700, 1.8, 0.75);
    yield;
    yield* grainTrainSteps(out, fs, r, {
      start: 0.01,
      end: range(r, 0.42, 0.55),
      rate0: 700,
      rate1: 50,
      fLo: 600,
      fHi: 3200,
      q: 1.4,
      tauLo: 0.001,
      tauHi: 0.004,
      gain: 0.75,
      gainEnd: 0.12,
    });
    const hinge = range(r, 0.16, 0.26);
    woodSnap(c, hinge, range(r, 0.6, 0.8), 0.3);
    trunkKnock(c, hinge, 0.35, f * range(r, 1.2, 1.4));
    yield;
    // 2. The lean: the hinge creaks.
    yield* stickSlipSteps(out, fs, r, {
      start: 0.06,
      dur: range(r, 0.7, 0.85),
      rate0: 42,
      rate1: 16,
      jitter: 0.2,
      modes: woodResonators(c, f * 1.1, 8),
      gain: 1,
      env: (u) => Math.sin(Math.PI * Math.min(1, u * 1.15)) * (1 - 0.4 * u),
    });
    yield;
    // 3. The crown swishing down, faster and faster.
    const tw = range(r, 1.0, 1.15);
    const from = 0.3;
    const lo = leafy ? 700 : 1200;
    const hi = leafy ? 2200 : 3800;
    yield* noiseLayerSteps(out, fs, r, {
      colour: 'pink',
      at: from,
      len: tw - from + 0.04,
      gain: leafy ? 2.2 : 1.9,
      env: (s) => Math.pow(Math.min(1, s / (tw - from)), 1.6),
      sweep: { type: 'bandpass', q: 1.1, freqAt: (s) => lo * Math.pow(hi / lo, Math.min(1, s / (tw - from))) },
    });
    yield;
    // 4. The landing: the trunk's thud (and a bounce), the crown crashing, branches snapping.
    const thud: Mode[] = jitterModes(r, LANDING_MODES, f, 0.06, 0.1);
    const exc = noiseBurst(fs, r, 0.012, 0.004);
    const p = pulse(fs, 0.004);
    for (let i = 0; i < p.length; i++) exc[i] += 1.4 * p[i];
    modal(out, fs, tw, exc, thud, 0.9);
    yield* noiseLayerSteps(out, fs, r, {
      colour: 'pink',
      at: tw,
      len: 0.6,
      gain: 0.6,
      env: (s) => ahd(s, 0.008, 0.02, 0.1),
      filters: [['bandpass', 380, 1]],
      normaliseBand: true,
    });
    yield* noiseLayerSteps(out, fs, r, {
      colour: 'pink',
      at: tw,
      len: 0.8,
      gain: leafy ? 0.98 : 0.85,
      env: (s) => ahd(s, 0.006, 0.04, leafy ? 0.16 : 0.13),
      filters: [['bandpass', leafy ? 1600 : 2600, 0.8]],
      normaliseBand: true,
    });
    yield;
    const branches = pick(r, 6, 10);
    for (let k = 0; k < branches; k++) woodSnap(c, tw + range(r, 0.005, 0.35), range(r, 0.3, 0.65), 0.18);
    modal(out, fs, tw + range(r, 0.17, 0.26), exc, jitterModes(r, thud, 1.05, 0.04), 0.4);
    yield;
    yield* grainTrainSteps(out, fs, r, {
      start: tw + 0.02,
      end: tw + 0.75,
      rate0: 180,
      rate1: 6,
      fLo: 900,
      fHi: 4000,
      q: 1.5,
      tauLo: 0.0008,
      tauHi: 0.003,
      gain: 0.35,
      gainEnd: 0.015,
    });
    yield* limitCrestSteps(out, fs, 13);
    yield;
  };
}

/** Fence: 2–3 wood snaps. */
function* timberBreakLight(c: BakeContext): Generator<void, void, void> {
  const snaps = pick(c.r, 2, 3);
  let t = 0;
  for (let k = 0; k < snaps; k++) {
    woodSnap(c, t, k === 0 ? 1 : range(c.r, 0.45, 0.8), 0.28);
    t += range(c.r, 0.03, 0.06);
  }
  yield;
}

/** A log struck: a round, hollow-sounding knock (a spruce log 0.4 m thick, 5 m long), a little bark crunch. */
const LOG_MODES: readonly Mode[] = [
  [140, 0.2, 0.75],
  [310, 0.16, 1],
  [580, 0.11, 0.65],
  [940, 0.07, 0.4],
  [1450, 0.045, 0.2],
];

function logKnock(c: BakeContext, t: number, gain: number, factor: number): void {
  const { fs, out, r } = c;
  const exc = noiseBurst(fs, r, 0.005, 0.0018);
  const p = pulse(fs, 0.0025);
  for (let i = 0; i < exc.length; i++) exc[i] *= 0.5;
  for (let i = 0; i < p.length; i++) exc[i] += p[i];
  modal(out, fs, t, exc, jitterModes(r, LOG_MODES, factor, 0.05, 0.12), gain);
  const grains = pick(r, 5, 9);
  for (let k = 0; k < grains; k++) {
    grain(out, fs, r, t + r() * 0.025, range(r, 1400, 3200), 2, range(r, 0.003, 0.007), gain * range(r, 0.03, 0.06));
  }
}

/**
 * A log pile collapsing (playtest 2026-10-23): the blow on the stack, then the logs knocking on each
 * other as they come down (10-16 knocks, dense at first and thinning out, each log its own pitch),
 * rolling away over the ground (a 230 Hz rumble that turns with the logs, 3-5 times a second), bark
 * scraping, and two or three last knocks as they come to rest at 1.3-1.7 s. Crest held to 12 dB.
 */
function* logsTumble(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  logKnock(c, 0, 1, range(r, 0.85, 0.95));
  woodSnap(c, 0.005, 0.4, 0.15);
  yield;
  const count = pick(r, 10, 16);
  let t = range(r, 0.04, 0.07);
  let gap = range(r, 0.035, 0.05);
  let gain = 0.95;
  for (let k = 0; k < count && t < 1.5; k++) {
    logKnock(c, t, gain * range(r, 0.75, 1), range(r, 0.8, 1.3));
    t += gap * range(r, 0.6, 1.5);
    gap *= 1.17;
    gain *= range(r, 0.86, 0.95);
    if (k % 3 === 2) yield;
  }
  yield;
  const turnHz = range(r, 3, 5);
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'pink',
    at: 0.1,
    len: 1.9,
    gain: 0.5,
    env: (s) => ahd(s, 0.12, 0.5, 0.32) * (0.55 + 0.45 * Math.sin(TAU * turnHz * s)),
    filters: [['bandpass', 230, 0.9]],
    normaliseBand: true,
  });
  yield* grainTrainSteps(out, fs, r, {
    start: 0.08,
    end: 1.5,
    rate0: 80,
    rate1: 8,
    fLo: 800,
    fHi: 2600,
    q: 1.5,
    tauLo: 0.002,
    tauHi: 0.006,
    gain: 0.12,
    gainEnd: 0.02,
  });
  yield;
  const rest = pick(r, 2, 3);
  for (let k = 0; k < rest; k++) logKnock(c, range(r, 1.3, 1.7), range(r, 0.18, 0.32), range(r, 0.9, 1.3));
  yield* limitCrestSteps(out, fs, 12);
  yield;
}

/** Footbridge, boat: two snaps, a deck or hull thump, a 0.6 s timber groan. */
function* timberBreakMedium(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  woodSnap(c, 0, 1);
  woodSnap(c, range(r, 0.08, 0.2), range(r, 0.5, 0.75));
  yield;
  const tt = range(r, 0.1, 0.25);
  const exc = noiseBurst(fs, r, 0.004, 0.0015);
  const p = pulse(fs, 0.003);
  for (let i = 0; i < p.length; i++) exc[i] += p[i];
  modal(out, fs, tt, exc, jitterModes(r, [[95, 0.25, 1], [180, 0.2, 0.8], [290, 0.15, 0.6], [450, 0.1, 0.4]], 1, 0.06), 0.8);
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'brown',
    at: tt,
    len: 0.4,
    gain: 0.35,
    env: (s) => ahd(s, 0.006, 0, 0.07),
    filters: [['bandpass', 220, 1.1]],
    normaliseBand: true,
  });
  yield* stickSlipSteps(out, fs, r, {
    start: 0.15,
    dur: 0.6,
    rate0: 55,
    rate1: 30,
    jitter: 0.15,
    modes: woodResonators(c, 0.8, 7),
    gain: 0.28,
    env: (u) => Math.sin(Math.PI * u),
  });
  yield;
}

/**
 * Chalet, barn: two snaps, a long timber groan (stick-slip 70 → 45 Hz into wood resonators), a wood
 * tumble of 8–14 knocks thinning out over 0.2–2 s, the roof coming down at 0.9 s, and a settle.
 */
function* timberCollapse(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  woodSnap(c, 0, 1);
  woodSnap(c, range(r, 0.05, 0.15), range(r, 0.55, 0.8));
  yield* stickSlipSteps(out, fs, r, {
    start: 0.1,
    dur: range(r, 1.2, 1.6),
    rate0: 70,
    rate1: 45,
    jitter: 0.15,
    modes: [...woodResonators(c, 0.8, 7), [1300 * range(r, 0.95, 1.05), qToT60(1300, 8), 0.3]],
    gain: 0.32,
    env: (u) => Math.pow(Math.sin(Math.PI * u), 0.7),
  });
  yield;
  const knocks = pick(r, 8, 14);
  let t = 0.2;
  let gap = 0.08;
  for (let k = 0; k < knocks && t < 2.0; k++) {
    woodKnock(c, t, 0.6 * Math.pow(0.86, k) * range(r, 0.7, 1), range(r, 0.9, 1.5), k % 2 === 0);
    t += gap * range(r, 0.6, 1.4);
    gap *= 1.22;
    yield;
  }
  yield;
  const roof = range(r, 0.85, 0.95);
  chirp(out, fs, roof, 90, 60, 0.12, 0.1, 0.3, 0.006);
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'brown',
    at: roof,
    len: 0.7,
    gain: 0.6,
    env: (s) => ahd(s, 0.008, 0, 0.13),
    filters: [['bandpass', 220, 1.1]],
    normaliseBand: true,
  });
  yield* grainTrainSteps(out, fs, r, {
    start: roof,
    end: roof + 0.5,
    rate0: 120,
    rate1: 10,
    fLo: 500,
    fHi: 2500,
    q: 1.5,
    tauLo: 0.002,
    tauHi: 0.006,
    gain: 0.3,
    gainEnd: 0.04,
  });
  yield* grainTrainSteps(out, fs, r, {
    start: 1.6,
    end: 2.55,
    rate0: 25,
    rate1: 3,
    fLo: 1500,
    fHi: 4000,
    q: 2,
    tauLo: 0.001,
    tauHi: 0.003,
    gain: 0.08,
    gainEnd: 0.01,
  });
  yield;
}

export const WOOD_RECIPES = {
  'hit.wood': hitWood,
  'tree.fall.pine': treeFall('pine'),
  'tree.fall.broadleaf': treeFall('broadleaf'),
  'timber.break.light': timberBreakLight,
  'timber.break.medium': timberBreakMedium,
  'logs.tumble': logsTumble,
  'timber.collapse': timberCollapse,
} satisfies Partial<Record<SoundId, Recipe>>;
