/**
 * Machines (docs/AUDIO_DESIGN.md §6.4, §7.8): the run-down layered under failing industry, and the
 * four running loops the P1 emitters play while their machine still stands. "The small sounds that
 * stop": a loop is ordinary, steady and a little dull on purpose, so its absence is what is heard.
 *
 * Loops are made seamless by construction: periodic layers (motors, hums, blade swish) have a whole
 * number of cycles in the loop, events are laid out cyclically (fold), noise beds are crossfaded.
 */
import type { SoundId } from '../../contract';
import {
  type BakeContext,
  type Mode,
  type Recipe,
  type Steps,
  harmonicsSteps,
  modal,
  noiseBurst,
  pulse,
  qToT60,
  sec,
  stickSlipSteps,
} from '../blocks';
import { Biquad, filterSweepSteps, fold, loopCrossfade, noise, processSteps, range } from '../dsp';
import { plateModes } from './metal';

/**
 * A machine running down: motor harmonics 1–8 gliding 50 → 18 Hz (τ 1.2 s) under a low-pass closing
 * 600 → 150 Hz, a bearing whine 900 → 300 Hz at -24 dB, gear ticks slowing from 12 to 1 a second
 * through a 1.5 kHz band-pass, and a last clunk. The router sets its rate per kind.
 */
function* machineWinddown(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r, n } = c;
  const speed = (t: number): number => 18 + 32 * Math.exp(-t / 1.2);
  const motor = new Float32Array(n);
  yield* harmonicsSteps(motor, fs, 0, 2.9, speed, 8, (h) => 1 / h, (t) => Math.min(1, t / 0.02) * Math.pow(speed(t) / 50, 3) * Math.exp(-t / 1.5), 0.5);
  yield* filterSweepSteps(motor, fs, 'lowpass', 0.7, (t) => 600 * Math.pow(150 / 600, Math.min(1, t / 2.8)));
  // The shaft sinks out of hearing rather than into the sub-bass: nothing of the motor below 60 Hz.
  yield* processSteps(new Biquad(fs).set('highpass', 60, 0.54), motor);
  yield* processSteps(new Biquad(fs).set('highpass', 60, 1.31), motor);
  for (let i = 0; i < n; i++) out[i] += motor[i];
  yield;
  yield* harmonicsSteps(out, fs, 0, 2.8, (t) => 300 + 600 * Math.exp(-t / 1.2), 1, () => 1, (t) => Math.min(1, t / 0.03) * Math.exp(-t / 1.4), 0.063);
  // Gear ticks: one per tooth, their rate following the shaft down from 12 to 1 a second.
  const ticks = new Float32Array(n);
  let t = 0.03;
  while (t < 2.4) {
    const i = sec(fs, t);
    if (i < n) ticks[i] = range(r, 0.7, 1);
    t += 1 / Math.max(1, 12 * Math.exp(-t / 1.0));
  }
  yield* processSteps(new Biquad(fs).set('bandpass', 1500, 4), ticks);
  for (let i = 0; i < n; i++) out[i] += 3 * ticks[i];
  yield;
  const clunk: Mode[] = [
    [120 * range(r, 0.95, 1.05), 0.12, 1],
    [260 * range(r, 0.95, 1.05), 0.1, 0.6],
    [410 * range(r, 0.95, 1.05), 0.08, 0.4],
  ];
  const exc = noiseBurst(fs, r, 0.004, 0.0015);
  const p = pulse(fs, 0.002);
  for (let i = 0; i < p.length; i++) exc[i] += p[i];
  modal(out, fs, range(r, 2.35, 2.55), exc, clunk, 0.45);
  yield;
}

/** A knock of a machine's iron: low modes from a soft strike. */
function knock(c: BakeContext, buf: Float32Array, t: number, modes: readonly Mode[], gain: number): void {
  const exc = noiseBurst(c.fs, c.r, 0.004, 0.0015);
  const p = pulse(c.fs, 0.003);
  for (let i = 0; i < p.length; i++) exc[i] += p[i];
  modal(buf, c.fs, t, exc, modes, gain);
}

/** A seamless noise bed of n samples: coloured noise, filtered, crossfaded over 0.25 s. */
function* bed(c: BakeContext, colour: 'white' | 'pink' | 'brown', type: 'bandpass' | 'lowpass', f: number, q: number): Steps<Float32Array> {
  const x = noise(colour, c.n + sec(c.fs, 0.25), c.r);
  yield;
  yield* processSteps(new Biquad(c.fs).set(type, f, q), x);
  yield;
  return loopCrossfade(x, c.n);
}

/** Pumpjack (9 s): two strokes, each a low knock and a creak, over a 48 Hz motor. */
function* emitterPumpjack(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r, n } = c;
  const events = new Float32Array(n + sec(fs, 1.5));
  const knockModes: Mode[] = [
    [85, 0.15, 1],
    [170, 0.12, 0.6],
    [260, 0.1, 0.4],
  ];
  for (const stroke of [0, 4.5]) {
    knock(c, events, stroke + 0.3, knockModes, 0.8);
    yield* stickSlipSteps(events, fs, r, {
      start: stroke + 2.2,
      dur: 0.8,
      rate0: 30,
      rate1: 18,
      jitter: 0.15,
      modes: [310, 720, 1340].map((f, i): Mode => [f * range(r, 0.95, 1.05), qToT60(f, 7), [1, 0.6, 0.35][i]]),
      gain: 0.25,
      env: (u) => Math.sin(Math.PI * u),
    });
  }
  yield;
  const looped = fold(events, n);
  // 48 Hz x 9 s = 432 whole cycles: the motor is periodic in the loop.
  yield* harmonicsSteps(out, fs, 0, n / fs, () => 48, 6, (h) => 1 / (h * h), () => 1, 0.15);
  for (let i = 0; i < n; i++) out[i] += looped[i];
  yield;
}

/** Factory (4 s): a 50 Hz hum with odd harmonics, two or three sparse clanks, a light mechanical bed. */
function* emitterFactory(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r, n } = c;
  yield* harmonicsSteps(out, fs, 0, n / fs, () => 50, 9, (h) => (h % 2 === 1 ? 1 / h : 0), () => 1, 0.3);
  const events = new Float32Array(n + sec(fs, 0.6));
  const clanks = 2 + (r() < 0.5 ? 1 : 0);
  for (let k = 0; k < clanks; k++) {
    const t = ((k + range(r, 0.1, 0.8)) / clanks) * (n / fs);
    knock(c, events, t, plateModes(c, range(r, 400, 700), 0.2), 0.3);
  }
  const b = yield* bed(c, 'pink', 'bandpass', 1200, 0.7);
  const looped = fold(events, n);
  for (let i = 0; i < n; i++) out[i] += looped[i] + 0.15 * b[i];
  yield;
}

/** Turbine (4 s): the blade swish at 0.75 Hz (three passes in the loop) and a 140 Hz gearbox. */
function* emitterTurbine(c: BakeContext): Generator<void, void, void> {
  const { fs, out, n } = c;
  const swish = yield* bed(c, 'pink', 'bandpass', 600, 0.9);
  for (let i = 0; i < n; i++) {
    const p = 0.5 - 0.5 * Math.cos((2 * Math.PI * 0.75 * i) / fs);
    out[i] += swish[i] * 1.6 * (0.15 + 0.85 * p * p);
    if ((i & 8191) === 8191) yield;
  }
  yield* harmonicsSteps(out, fs, 0, n / fs, () => 140, 4, (h) => 1 / h, () => 1, 0.05);
  yield;
}

/** Rig (4 s): a 55/110/165 Hz drone, a pump knock every 2 s, a low bed. */
function* emitterRig(c: BakeContext): Generator<void, void, void> {
  const { fs, out, r, n } = c;
  yield* harmonicsSteps(out, fs, 0, n / fs, () => 55, 3, (h) => [1, 0.6, 0.4][h - 1], () => 1, 0.25);
  const events = new Float32Array(n + sec(fs, 0.8));
  const modes: Mode[] = [
    [95 * range(r, 0.96, 1.04), 0.18, 1],
    [210 * range(r, 0.96, 1.04), 0.14, 0.6],
    [330 * range(r, 0.96, 1.04), 0.1, 0.35],
  ];
  knock(c, events, 0.4, modes, 0.6);
  knock(c, events, 2.4, modes, 0.55);
  const b = yield* bed(c, 'brown', 'lowpass', 300, 0.7);
  const looped = fold(events, n);
  for (let i = 0; i < n; i++) out[i] += looped[i] + 0.25 * b[i];
  yield;
}

export const MACHINE_RECIPES = {
  'machine.winddown': machineWinddown,
  'emitter.pumpjack': emitterPumpjack,
  'emitter.factory': emitterFactory,
  'emitter.turbine': emitterTurbine,
  'emitter.rig': emitterRig,
} satisfies Partial<Record<SoundId, Recipe>>;
