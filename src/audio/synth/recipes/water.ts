/**
 * Water one-shots (docs/AUDIO_DESIGN.md §6.4): splashes by size, the plunge over a waterfall, the
 * iceberg meeting the sea, and liquid escaping a broken tank. Bubbles are rising chirps, sheets and
 * spray are band- and high-passed noise, droplets are tiny chirps scattered after the impact.
 *
 * Decays shortened to fit their buffers: splash.small body 50–120 → 50–90 ms, splash.medium spray
 * 250 → 200 ms.
 */
import type { SoundId } from '../../contract';
import { type BakeContext, type Recipe, chirp, grainTrainSteps, noiseLayerSteps } from '../blocks';
import { ahd, pick, range } from '../dsp';
import { droplet } from './ice';

/** A bubble: a sine chirping up from f by `rise` over glide seconds. */
function bubble(c: BakeContext, t: number, f: number, rise: number, glide: number, tau: number, gain: number): void {
  chirp(c.out, c.fs, t, f, f * rise, glide, tau, gain, 0.001);
}

function* splashSmall(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  bubble(c, 0.002, range(r, 550, 650), 2, range(r, 0.015, 0.03), 0.012, 0.55);
  const tau = range(r, 0.05, 0.09);
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'white',
    at: 0,
    len: 0.35,
    gain: 0.7,
    env: (s) => ahd(s, 0.002, 0, tau),
    filters: [['bandpass', 1500, 0.9]],
    normaliseBand: true,
  });
  const drops = pick(r, 5, 10);
  for (let k = 0; k < drops; k++) {
    droplet(c, range(r, 0.03, 0.25), range(r, 0.1, 0.22));
    if (k % 8 === 7) yield;
  }
  yield;
}

function* splashMedium(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'white',
    at: 0,
    len: 0.4,
    gain: 0.9,
    env: (s) => ahd(s, 0.002, 0, 0.05),
    filters: [['bandpass', 900, 1]],
    normaliseBand: true,
  });
  const chirps = pick(r, 3, 6);
  for (let k = 0; k < chirps; k++) {
    bubble(c, range(r, 0.01, 0.25), range(r, 400, 1200), range(r, 1.6, 2), range(r, 0.02, 0.04), range(r, 0.015, 0.03), range(r, 0.25, 0.45));
  }
  yield;
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'white',
    at: 0.005,
    len: 0.8,
    gain: 0.3,
    env: (s) => ahd(s, 0.015, 0.02, 0.2),
    filters: [['highpass', 3000, 0.7]],
  });
  const drops = pick(r, 10, 20);
  for (let k = 0; k < drops; k++) {
    droplet(c, range(r, 0.1, 0.6), range(r, 0.06, 0.15));
    if (k % 8 === 7) yield;
  }
  yield;
}

/** Large: a 70 Hz thud, a 300–2500 Hz burst decaying over 0.9 s, sheet hiss, droplets, a submerge whoomp. */
function* splashLarge(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  chirp(out, fs, 0, 80, 62, 0.1, 0.05, 0.5, 0.004);
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'white',
    at: 0,
    len: 1.2,
    gain: 0.9,
    env: (s) => ahd(s, 0.005, 0.02, 0.2),
    filters: [
      ['highpass', 300, 0.7],
      ['lowpass', 2500, 0.7],
    ],
  });
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'white',
    at: 0.01,
    len: 1.2,
    gain: 0.25,
    env: (s) => ahd(s, 0.03, 0.05, 0.25),
    filters: [['highpass', 4000, 0.7]],
  });
  yield;
  const drops = pick(r, 30, 60);
  for (let k = 0; k < drops; k++) {
    const t = 0.1 + Math.pow(r(), 1.3) * 1.15;
    droplet(c, t, range(r, 0.05, 0.14) * (1 - 0.5 * (t / 1.25)));
    if (k % 8 === 7) yield;
  }
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'brown',
    at: 0.08,
    len: 1.0,
    gain: 0.45,
    env: (s) => ahd(s, 0.15, 0.03, 0.15),
    filters: [
      ['lowpass', 200, 0.7],
      ['highpass', 60, 0.7],
    ],
  });
  yield;
}

/** Over a waterfall: the large splash core, a 300 Hz-low-passed whoomph, 1.5 s of rising bubbles, spray. */
function* waterPlunge(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'white',
    at: 0,
    len: 1.4,
    gain: 0.8,
    env: (s) => ahd(s, 0.004, 0.03, 0.18),
    filters: [['bandpass', 1200, 0.6]],
    normaliseBand: true,
  });
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'brown',
    at: 0,
    len: 2.2,
    gain: 0.6,
    env: (s) => ahd(s, 0.03, 0, 0.45),
    filters: [
      ['lowpass', 300, 0.7],
      ['highpass', 60, 0.7],
    ],
  });
  yield;
  const bubbles = pick(r, 40, 80);
  for (let k = 0; k < bubbles; k++) {
    const t = 0.1 + r() * 1.5;
    bubble(c, t, range(r, 300, 1200), range(r, 1.6, 2.2), range(r, 0.01, 0.04), range(r, 0.008, 0.02), range(r, 0.08, 0.18) * (1 - 0.5 * ((t - 0.1) / 1.5)));
    if (k % 8 === 7) yield;
  }
  yield;
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'white',
    at: 0.02,
    len: 2.2,
    gain: 0.3,
    env: (s) => ahd(s, 0.05, 0.3, 0.42),
    filters: [['highpass', 3000, 0.7]],
  });
  yield;
}

/**
 * The iceberg meets the sea: a swell (pink noise through a low-pass opening 250 → 1600 Hz over 2.2 s,
 * rising), the break (a burst high-passed at 1.5 kHz, τ 0.6 s), and the wash drawing back (low-pass
 * 1600 → 400 Hz as it decays) with foam fizz above 4 kHz.
 */
function* oceanEntry(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  const swellSec = 2.2;
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'pink',
    at: 0,
    len: 2.6,
    gain: 0.5,
    env: (s) => (s < swellSec ? Math.pow(Math.sin((s / swellSec) * Math.PI * 0.5), 2) : Math.exp(-(s - swellSec) / 0.15)),
    sweep: { type: 'lowpass', q: 0.7, freqAt: (s) => 250 * Math.pow(1600 / 250, Math.min(1, s / swellSec)) },
  });
  yield;
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'white',
    at: swellSec - 0.02,
    len: 2.6,
    gain: 0.6,
    env: (s) => ahd(s, 0.02, 0, 0.55),
    filters: [['highpass', 1500, 0.7]],
  });
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'pink',
    at: swellSec + 0.05,
    len: 2.6,
    gain: 0.55,
    env: (s) => ahd(s, 0.1, 0, 0.5),
    sweep: { type: 'lowpass', q: 0.7, freqAt: (s) => 1600 * Math.pow(400 / 1600, Math.min(1, s / 2.5)) },
  });
  yield;
  yield* grainTrainSteps(out, fs, r, {
    start: swellSec + 0.1,
    end: 4.2,
    rate0: 200,
    rate1: 20,
    fLo: 4000,
    fHi: Math.min(9000, fs * 0.4),
    q: 2,
    tauLo: 0.001,
    tauHi: 0.003,
    gain: 0.12,
    gainEnd: 0.01,
  });
  yield;
}

/** Liquid escaping (tank, rig, pipeline, water tower): bubbles chirping up 80 → 400 Hz over a low gurgle. */
function* liquidRelease(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  let t = 0.02;
  while (t < 1.5) {
    const g = 0.3 * Math.exp(-t / 0.7) * range(r, 0.5, 1);
    bubble(c, t, range(r, 80, 160), range(r, 2.2, 3.5), range(r, 0.02, 0.06), range(r, 0.012, 0.03), g);
    t += -Math.log(1 - r() * 0.999999) / 30;
    yield;
  }
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'brown',
    at: 0,
    len: 1.9,
    gain: 0.4,
    env: (s) => ahd(s, 0.05, 0.1, 0.3),
    filters: [
      ['lowpass', 400, 0.7],
      ['highpass', 60, 0.7],
    ],
  });
  yield;
}

export const WATER_RECIPES = {
  'splash.small': splashSmall,
  'splash.medium': splashMedium,
  'splash.large': splashLarge,
  'water.plunge': waterPlunge,
  'ocean.entry': oceanEntry,
  'liquid.release': liquidRelease,
} satisfies Partial<Record<SoundId, Recipe>>;
