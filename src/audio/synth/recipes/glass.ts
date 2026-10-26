/**
 * Glass (docs/AUDIO_DESIGN.md §6.4): glass that gives way rather than shatters. A first pane tick,
 * then a few shards spread out in time, each 3–5 inharmonic modes at 2.4–9.5 kHz; later shards ring
 * shorter and quieter, so the sound thins out instead of crashing. house.collapse reuses `shards`.
 */
import type { SoundId } from '../../contract';
import {
  type BakeContext,
  type Mode,
  type Recipe,
  type Steps,
  modal,
  noiseLayer,
  pulse,
} from '../blocks';
import { ahd, filterSteps, pick, range } from '../dsp';

/** The pane tick that starts a break: two or three high modes and a 3 ms hiss. */
export function paneTick(c: BakeContext, t: number, gain: number): void {
  const { fs, out, r } = c;
  const f = range(r, 3000, 5200);
  modal(out, fs, t, pulse(fs, 0.00012), [
    [f, 0.05, 1],
    [f * range(r, 1.47, 1.62), 0.035, 0.6],
    [f * range(r, 2.1, 2.4), 0.025, 0.35],
  ], gain);
  noiseLayer(out, fs, r, {
    colour: 'white',
    at: t,
    len: 0.01,
    gain: gain * 0.4,
    env: (s) => ahd(s, 0.0002, 0.0005, 0.0012),
    filters: [['highpass', 3000, 0.7]],
  });
}

/**
 * `count` shards between t0 + from and t0 + to (bunched early), each 3–5 inharmonic modes at
 * 2.4–9.5 kHz with T60 up to maxT60 (0.08–0.5 s), shorter and quieter as the break goes on; the
 * ringing of a shard never runs past `ringEnd` (seconds).
 */
export function* shards(
  c: BakeContext,
  t0: number,
  count: number,
  from: number,
  to: number,
  gain: number,
  maxT60: number,
  ringEnd: number,
): Steps {
  const { fs, out, r } = c;
  const hi = Math.min(9500, fs * 0.42);
  for (let k = 0; k < count; k++) {
    const u = Math.pow((k + r()) / count, 1.5);
    const t = t0 + from + (to - from) * u;
    const room = Math.max(0.02, (ringEnd - t) / 2.2);
    const t60Top = Math.min(maxT60 * (1 - 0.6 * u), room);
    const modes: Mode[] = [];
    const m = pick(r, 3, 5);
    const base = range(r, 2400, 5000);
    for (let j = 0; j < m; j++) {
      const f = Math.min(hi, base * (1 + j * range(r, 0.45, 0.85)));
      modes.push([f, range(r, 0.08, 1) * t60Top + 0.01, (1 - j * 0.15) * range(r, 0.6, 1)]);
    }
    modal(out, fs, t, pulse(fs, 0.0001), modes, gain * (1 - 0.65 * u) * range(r, 0.6, 1));
    yield;
  }
}

/** Glass breaking (church windows, apartment blocks): a tick, then 6–14 shards over 0.05–0.7 s, high-passed at 1.8 kHz. */
function* glassBreak(c: BakeContext): Generator<void, void, void> {
  paneTick(c, 0, 1);
  yield* shards(c, 0, pick(c.r, 6, 14), 0.05, 0.7, 0.8, 0.5, 0.86);
  yield* filterSteps(c.out, c.fs, 'highpass', 1800, 0.7);
}

/** A pane (vehicles, chalet, lighthouse, traffic light): a tick and 3–5 shards over 0.3 s. */
function* glassPane(c: BakeContext): Generator<void, void, void> {
  paneTick(c, 0, 1);
  yield* shards(c, 0, pick(c.r, 3, 5), 0.03, 0.22, 0.7, 0.12, 0.32);
  yield* filterSteps(c.out, c.fs, 'highpass', 1800, 0.7);
}

export const GLASS_RECIPES = {
  'glass.break': glassBreak,
  'glass.pane': glassPane,
} satisfies Partial<Record<SoundId, Recipe>>;
