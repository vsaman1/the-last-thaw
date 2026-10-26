/**
 * The iceberg's own voice (docs/AUDIO_DESIGN.md §6.4): ice hits, chips, absorbing loose blocks, the
 * terrain-wall scrape, landings on ground and water, the intro calving, and the grit loop the live
 * scrape voice plays.
 *
 * Where the design's decay is longer than its buffer allows (the bake rules want every one-shot to
 * decay on its own before the end fade), the time constant is shortened and the change noted here:
 * ice.absorb settle 150 → 60 ms; ice.wallScrape 150–300 → 100–150 ms; ice.land.water spray 400 → 300 ms;
 * ice.calve.crack thud 0.3 → 0.22 s. The calving groan's modes start at 48 Hz rather than 38 (under 2 %
 * of a bake's energy may sit below 40 Hz).
 */
import type { SoundId } from '../../contract';
import {
  type BakeContext,
  type Mode,
  type Recipe,
  chirp,
  grainTrainSteps,
  jitterModes,
  modal,
  noiseBurst,
  noiseLayerSteps,
  pulse,
  qToT60,
  sec,
  stickSlipSteps,
} from '../blocks';
import { Biquad, ahd, loopCrossfade, fold, mixInto, noise, pick, processSteps, range, whiteNoise } from '../dsp';

/** Ice modes {210, 395, 640, 1020, 1710, 2830} Hz with T60 {180, 140, 110, 80, 55, 35} ms. */
export const ICE_MODES: readonly Mode[] = [
  [210, 0.18, 1],
  [395, 0.14, 0.8],
  [640, 0.11, 0.65],
  [1020, 0.08, 0.5],
  [1710, 0.055, 0.38],
  [2830, 0.035, 0.28],
];

/** The ice strike: a 3 ms half-cosine plus a 12 ms noise burst (τ 4 ms) through the ice modes. */
export function iceStrike(c: BakeContext, t: number, gain: number): void {
  const { fs, out, r } = c;
  const exc = noiseBurst(fs, r, 0.012, 0.004);
  const p = pulse(fs, 0.003);
  for (let i = 0; i < exc.length; i++) exc[i] *= 0.6;
  for (let i = 0; i < p.length; i++) exc[i] += p[i];
  modal(out, fs, t, exc, jitterModes(r, ICE_MODES, 1, 0.05, 0.1), gain);
}

/** Ice ticks: sines at 2.4, 3.9 and 5.6 kHz (±5 %), τ 12–30 ms. */
function iceTicks(c: BakeContext, t: number, gain: number): void {
  for (const f of [2400, 3900, 5600]) {
    chirp(c.out, c.fs, t + c.r() * 0.004, f * range(c.r, 0.95, 1.05), f, 0.001, range(c.r, 0.012, 0.03), gain * range(c.r, 0.6, 1), 0.0005);
  }
}

function* hitIce(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  iceStrike(c, 0, 1);
  yield;
  // The crack: band-passed at 4.5 kHz (Q 1.2) for 25 ms.
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'white',
    at: 0,
    len: 0.025,
    gain: 0.35,
    env: (s) => ahd(s, 0.0005, 0.002, 0.006),
    filters: [['bandpass', 4500, 1.2]],
    normaliseBand: true,
  });
  iceTicks(c, 0.002, 0.15);
  yield;
}

/** Chips: 3–7 high pings at 3–7.5 kHz, two tink modes, and a flick of 5 kHz-high-passed noise. */
function* iceChip(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  const pings = pick(r, 3, 7);
  let t = 0;
  for (let k = 0; k < pings && t < 0.05; k++) {
    const f = range(r, 3000, 7500);
    chirp(out, fs, t, f, f, 0.001, range(r, 0.012, 0.02), Math.pow(0.75, k) * range(r, 0.5, 1), 0.0004);
    t += range(r, 0.008, 0.016);
  }
  modal(out, fs, 0, pulse(fs, 0.0002), [
    [3800 * range(r, 0.97, 1.03), 0.03, 0.6],
    [6100 * range(r, 0.97, 1.03), 0.03, 0.4],
  ]);
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'white',
    at: 0,
    len: 0.012,
    gain: 0.35,
    env: (s) => ahd(s, 0.0003, 0.001, 0.002),
    filters: [['highpass', 5000, 0.7]],
  });
  yield;
}

/** Absorbing a loose block: crunch grains at 0.4–2.5 kHz over 120–200 ms and a low settle. */
function* iceAbsorb(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  yield* grainTrainSteps(out, fs, r, {
    start: 0,
    end: range(r, 0.12, 0.2),
    rate0: 260,
    rate1: 50,
    fLo: 400,
    fHi: 2500,
    q: 1.5,
    tauLo: 0.002,
    tauHi: 0.006,
    gain: 0.55,
    gainEnd: 0.15,
  });
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'brown',
    at: 0.005,
    len: 0.28,
    gain: 0.6,
    env: (s) => ahd(s, 0.01, 0, 0.06),
    filters: [
      ['lowpass', 400, 0.7],
      ['highpass', 70, 0.7],
    ],
  });
  yield;
}

/**
 * A terrain wall or bank: brown and pink noise through three rock band-passes {700, 1400, 2600} Hz
 * (Q 1.5), roughened by a 40 Hz noise amplitude modulation, with 40 grit grains a second.
 */
function* iceWallScrape(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r, n } = c;
  const tau = range(r, 0.1, 0.15);
  const len = n;
  const src = noise('brown', len, r);
  yield;
  const pink = noise('pink', len, r);
  yield;
  for (let i = 0; i < len; i++) src[i] = 0.6 * src[i] + 0.8 * pink[i];
  const body = new Float32Array(len);
  for (const [f, g] of [
    [700, 1],
    [1400, 0.8],
    [2600, 0.55],
  ] as const) {
    const band = src.slice();
    yield* processSteps(new Biquad(fs).set('bandpass', f * range(r, 0.92, 1.08), 1.5), band);
    for (let i = 0; i < len; i++) body[i] += g * band[i];
    yield;
  }
  yield;
  // Roughness: |40 Hz-low-passed noise| as amplitude modulation.
  const am = whiteNoise(len, r);
  yield* processSteps(new Biquad(fs).set('lowpass', 40, 0.7), am);
  let amPeak = 0;
  for (const v of am) amPeak = Math.max(amPeak, Math.abs(v));
  for (let i = 0; i < len; i++) {
    const s = i / fs;
    body[i] *= ahd(s, 0.02, 0, tau) * (0.55 + (0.45 * am[i]) / (amPeak || 1));
    if ((i & 4095) === 4095) yield;
  }
  mixInto(out, body, 0, 3);
  yield;
  yield* grainTrainSteps(out, fs, r, {
    start: 0.005,
    end: 0.02 + 2.5 * tau,
    rate0: 40,
    rate1: 40,
    fLo: 1500,
    fHi: 5000,
    q: 2,
    tauLo: 0.0015,
    tauHi: 0.004,
    gain: 0.35,
    gainEnd: 0.05,
  });
  yield;
}

/** Landing on ground: a 70 → 45 Hz thud with a 220 Hz body, crunch grains, an ice tick, ice modes at -6 dB. */
function* iceLandGround(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  chirp(out, fs, 0, 70, 45, 0.15, 0.15, 0.8, 0.004);
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'brown',
    at: 0,
    len: 0.6,
    gain: 0.7,
    env: (s) => ahd(s, 0.004, 0, 0.09),
    filters: [['bandpass', 220, 1.1]],
    normaliseBand: true,
  });
  yield;
  yield* grainTrainSteps(out, fs, r, {
    start: 0.002,
    end: range(r, 0.2, 0.28),
    rate0: 300,
    rate1: 30,
    fLo: 600,
    fHi: 3000,
    q: 1.5,
    tauLo: 0.002,
    tauHi: 0.006,
    gain: 0.4,
    gainEnd: 0.08,
  });
  iceTicks(c, 0.004, 0.12);
  iceStrike(c, 0, 0.5);
  yield;
}

/** A droplet: a tiny rising chirp. */
export function droplet(c: BakeContext, t: number, gain: number): void {
  const f = range(c.r, 1200, 3500);
  chirp(c.out, c.fs, t, f, f * range(c.r, 1.3, 1.7), range(c.r, 0.008, 0.015), range(c.r, 0.006, 0.012), gain, 0.0008);
}

/** Landing on water: a 900 Hz slap, a 180 → 90 Hz bloop, 2.5 kHz-high-passed spray, droplets. */
function* iceLandWater(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'white',
    at: 0,
    len: 0.4,
    gain: 0.8,
    env: (s) => ahd(s, 0.002, 0, 0.06),
    filters: [['bandpass', 900, 1]],
    normaliseBand: true,
  });
  chirp(out, fs, 0.004, 180, 90, 0.1, 0.08, 0.5, 0.003);
  yield;
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'white',
    at: 0.01,
    len: 1.3,
    gain: 0.25,
    env: (s) => ahd(s, 0.02, 0.05, 0.3),
    filters: [['highpass', 2500, 0.7]],
  });
  const drops = pick(r, 10, 20);
  for (let k = 0; k < drops; k++) {
    droplet(c, range(r, 0.3, 1.0), range(r, 0.05, 0.12));
    if (k % 8 === 7) yield;
  }
  yield;
}

/**
 * Calving groan (intro, P1): friction-excited low ice modes at 38–160 Hz swelling over 1.3 s, with
 * a few stressed upper modes so the groan survives small speakers.
 */
function* iceCalveGroan(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  const lowModes: Mode[] = [48, 62, 81, 106, 134, 160].map((f, i): Mode => {
    const fr = f * range(r, 0.95, 1.05);
    return [fr, qToT60(fr, 7), 0.8 - i * 0.08];
  });
  const upper: Mode[] = [236, 371, 512].map((f): Mode => {
    const fr = f * range(r, 0.95, 1.05);
    return [fr, qToT60(fr, 12), 0.45];
  });
  const swell = (u: number): number => Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.3) * 0.5), 2) * (u < 0.77 ? 1 : Math.exp(-(u - 0.77) * 25));
  yield* stickSlipSteps(out, fs, r, { start: 0.02, dur: 1.15, rate0: 24, rate1: 34, jitter: 0.15, modes: [...lowModes, ...upper], gain: 0.5, env: swell });
  yield* processSteps(new Biquad(fs).set('highpass', 45, 0.7), out);
  yield* processSteps(new Biquad(fs).set('highpass', 45, 0.7), out);
  yield;
}

/**
 * Calving crack (intro, P1): a 2 ms impulse, 1 kHz-high-passed noise for 60 ms, the dispersive chirp
 * of lake ice sweeping 6 kHz → 1 kHz in 40 ms (the "pew"), and a 60 Hz thud at -10 dB.
 */
function* iceCalveCrack(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r } = c;
  mixInto(out, pulse(fs, 0.002), 0, sec(fs, 0.002) * 0.4);
  yield* noiseLayerSteps(out, fs, r, {
    colour: 'white',
    at: 0,
    len: 0.06,
    gain: 0.7,
    env: (s) => ahd(s, 0.0005, 0.005, 0.012),
    filters: [['highpass', 1000, 0.7]],
  });
  chirp(out, fs, 0.002, 6000, 1000, 0.04, 0.03, 0.6, 0.0005, 0.12);
  chirp(out, fs, 0.006, 6000 * range(r, 0.9, 1.1), 1100, 0.045, 0.025, 0.3, 0.0005, 0.1);
  yield;
  chirp(out, fs, 0.004, 60, 55, 0.2, 0.22, 0.32, 0.006);
  yield;
}

/**
 * The scrape's grit loop (2 s): dense small grains at 0.9–5 kHz over a faint band of noise. The
 * grains are laid out cyclically (tails folded over the seam), the noise bed crossfaded.
 */
function* scrapeGrit(c: BakeContext): Generator<void, void, void> {
  const { fs, r, n, out } = c;
  const tail = sec(fs, 0.03);
  const grains = new Float32Array(n + tail);
  const sub: BakeContext = { ...c, out: grains };
  yield* grainTrainSteps(sub.out, fs, r, {
    start: 0,
    end: n / fs,
    rate0: 180,
    rate1: 180,
    fLo: 900,
    fHi: 5000,
    q: 1.6,
    tauLo: 0.001,
    tauHi: 0.004,
    gain: 0.5,
    jitterDb: 6,
  });
  yield;
  const bed = noise('white', n + sec(fs, 0.25), r);
  yield* processSteps(new Biquad(fs).set('bandpass', 2500, 0.8), bed);
  const looped = fold(grains, n);
  const bedLoop = loopCrossfade(bed, n);
  for (let i = 0; i < n; i++) out[i] = looped[i] + 0.25 * bedLoop[i];
  yield;
}

export const ICE_RECIPES = {
  'hit.ice': hitIce,
  'ice.chip': iceChip,
  'ice.absorb': iceAbsorb,
  'ice.wallScrape': iceWallScrape,
  'ice.land.ground': iceLandGround,
  'ice.land.water': iceLandWater,
  'ice.calve.groan': iceCalveGroan,
  'ice.calve.crack': iceCalveCrack,
  'scrape.grit': scrapeGrit,
} satisfies Partial<Record<SoundId, Recipe>>;

