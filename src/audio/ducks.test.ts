import { describe, expect, it } from 'vitest';
import { createRng } from '../core/rng';
import {
  AFTERMATH_MAX_HOLD_SEC,
  CHAPTER_MIX,
  DUCK_PRESETS,
  PLAY_DUCK_FLOOR_DB,
  SEED,
  type DuckKey,
  type DuckLevels,
} from './contract';
import { DuckMixer, DUCK_BUSES } from './ducks';
import type { MusicPlayer } from './music';
import { createMusicRouter } from './musicRouter';
import { ManualTicker } from './testing/manualTicker';

const KEYS = Object.keys(DUCK_PRESETS) as DuckKey[];
const EPS = 1e-9;

describe('every DUCK_PRESETS entry: exact targets and timings', () => {
  for (const key of KEYS) {
    for (const mode of ['story', 'arcade'] as const) {
      const preset = DUCK_PRESETS[key];
      const levels = preset[mode];
      if (levels === null) continue;
      it(`${key} (${mode})`, () => {
        const m = new DuckMixer();
        const hold = preset.holdSec === 'untilRelease' ? Infinity : preset.holdSec;
        m.set(key, levels, preset.attackSec, hold, preset.releaseSec, 0);
        const a = preset.attackSec;
        for (const bus of DUCK_BUSES) {
          if (a > 0) expect(m.factor(key, bus, a / 2)).toBeCloseTo(levels[bus] / 2, 9); // linear in dB
          expect(m.factor(key, bus, a)).toBeCloseTo(levels[bus], 9);
        }
        let relStart: number;
        if (hold === Infinity) {
          expect(m.factor(key, 'music', a + 1000)).toBeCloseTo(levels.music, 9);
          expect(m.settled(a + 1000)).toBe(true);
          relStart = a + 1000;
          m.release(key, preset.releaseSec, relStart);
        } else {
          relStart = a + hold;
          if (hold > 0) expect(m.factor(key, 'music', relStart - 1e-6)).toBeCloseTo(levels.music, 6);
        }
        for (const bus of DUCK_BUSES) {
          expect(m.factor(key, bus, relStart + preset.releaseSec / 2)).toBeCloseTo(levels[bus] / 2, 6);
        }
        expect(m.has(key, relStart + preset.releaseSec)).toBe(false);
        expect(m.sum('music', relStart + preset.releaseSec)).toBe(0);
      });
    }
  }
});

describe('DuckMixer rules', () => {
  it('repeats extend a timed hold (landmark), and the aftermath extends only up to its 10 s cap', () => {
    const m = new DuckMixer();
    const lm = DUCK_PRESETS.landmark;
    m.set('landmark', lm.story!, lm.attackSec, lm.holdSec as number, lm.releaseSec, 0);
    m.set('landmark', lm.story!, lm.attackSec, lm.holdSec as number, lm.releaseSec, 5);
    // Without the repeat it would start releasing at 7.5 s; with it, at 5 + 1.5 + 6 = 12.5 s.
    expect(m.factor('landmark', 'music', 12.4)).toBeCloseTo(-10, 9);
    expect(m.factor('landmark', 'music', 12.5 + 4)).toBeCloseTo(-5, 9);

    const am = DUCK_PRESETS.aftermath;
    const depth = CHAPTER_MIX['ch7-escape'].aftermathDb;
    const opts = { deepest: true, maxHoldSec: AFTERMATH_MAX_HOLD_SEC };
    for (let t = 0; t <= 20; t += 0.5) {
      m.set('aftermath', { music: depth, ambience: 0, effects: 0 }, am.attackSec, am.holdSec as number, 6, t, opts);
    }
    // The hold began at 0.6 s and may last 10 s at most, however often it is re-triggered.
    expect(m.factor('aftermath', 'music', 0.6 + AFTERMATH_MAX_HOLD_SEC + 1)).toBeLessThan(0);
    expect(m.factor('aftermath', 'music', 20 + am.attackSec + 0.01)).toBeGreaterThan(depth);
  });

  it('the deepest overlapping aftermath wins', () => {
    const m = new DuckMixer();
    const opts = { deepest: true, maxHoldSec: AFTERMATH_MAX_HOLD_SEC };
    m.set('aftermath', { music: -8, ambience: 0, effects: 0 }, 0.6, 1, 6, 0, opts);
    m.set('aftermath', { music: -2, ambience: 0, effects: 0 }, 0.6, 1, 6, 0.5, opts);
    expect(m.factor('aftermath', 'music', 1.2)).toBeCloseTo(-8, 9);
  });

  it('untilRelease ducks re-target (the scar deepens loss by loss)', () => {
    const m = new DuckMixer();
    m.set('scar', { music: -0.75, ambience: 0, effects: 0 }, 4, Infinity, 4, 0);
    m.set('scar', { music: -1.5, ambience: 0, effects: 0 }, 4, Infinity, 4, 10);
    expect(m.factor('scar', 'music', 12)).toBeCloseTo(-1.125, 9);
    expect(m.factor('scar', 'music', 14)).toBeCloseTo(-1.5, 9);
  });

  it('a positive or non-finite dB throws in development and tests, and is clamped to 0 otherwise', () => {
    expect(() => new DuckMixer().set('reading', { music: 1, ambience: 0, effects: 0 }, 1, Infinity, 1, 0)).toThrow(RangeError);
    expect(() => new DuckMixer().set('reading', { music: -1, ambience: Number.NaN, effects: 0 }, 1, Infinity, 1, 0)).toThrow(
      RangeError,
    );
    const lax = new DuckMixer({ strict: false });
    lax.set('reading', { music: 6, ambience: -3, effects: Infinity }, 0, Infinity, 1, 0);
    expect(lax.snapshot(1).reading).toEqual({ music: 0, ambience: -3, effects: 0 });
  });
});

/** A recording player for the router leg of the property test. */
class VolumePlayer implements MusicPlayer {
  volume = 0.6;
  muted = false;
  play(): void {}
  setVolume(v: number): void {
    this.volume = v;
  }
  setMuted(m: boolean): void {
    this.muted = m;
  }
  unlock(): void {}
}

describe('property test: 10,000 seeded random moment sequences', () => {
  it('every factor <= 0 dB, every sum in [floor, 0], and the music never above master·music·bed', () => {
    const rng = createRng(SEED);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
    const randLevels = (): DuckLevels => {
      const mode = rng() < 0.5 ? 'story' : 'arcade';
      const preset = DUCK_PRESETS[pick(KEYS)][mode];
      if (preset && rng() < 0.7) return preset;
      return { music: -rng() * 30, ambience: -rng() * 20, effects: -rng() * 20 };
    };
    // Plain comparisons in the loop (millions of expect() calls would take minutes); one expect at the end.
    let checks = 0;
    const violations: string[] = [];
    for (let seq = 0; seq < 10000; seq++) {
      const m = new DuckMixer();
      const withRouter = seq % 5 === 0;
      const player = new VolumePlayer();
      const ticker = new ManualTicker();
      const router = withRouter ? createMusicRouter({ player, ticker }) : null;
      const master = rng();
      const music = rng();
      const bed = -rng() * 6;
      router?.setLevels({ master, music, ambience: 1, effects: 1, musicMuted: false, soundMuted: false });
      router?.setTrim(bed);
      ticker.advance(1100); // let the bed settle: its own glide is not a duck
      let t = 1.1;
      const ops = 2 + Math.floor(rng() * 10);
      for (let i = 0; i < ops; i++) {
        t = Math.max(t + rng() * 8, ticker.t / 1000);
        ticker.t = t * 1000;
        const key = pick(KEYS);
        const preset = DUCK_PRESETS[key];
        if (rng() < 0.75) {
          const lv = randLevels();
          const hold = preset.holdSec === 'untilRelease' ? Infinity : preset.holdSec;
          const opts = key === 'aftermath' ? { deepest: true, maxHoldSec: AFTERMATH_MAX_HOLD_SEC } : {};
          m.set(key, lv, preset.attackSec, hold, preset.releaseSec, t, opts);
          router?.duckFor(key, lv.music, preset.attackSec, hold, preset.releaseSec, opts);
        } else {
          m.release(key, preset.releaseSec, t);
          router?.unduck(key, preset.releaseSec);
        }
        // Sample forward in time (sum() forgets finished ducks, so never sample backwards).
        for (let s = 0; s < 3; s++) {
          t += rng() * 3;
          for (const bus of DUCK_BUSES) {
            for (const k of KEYS) if (m.factor(k, bus, t) > EPS) violations.push(`${seq}: ${k}.${bus} > 0`);
            const sum = m.sum(bus, t);
            if (sum > EPS || sum < PLAY_DUCK_FLOOR_DB - EPS) violations.push(`${seq}: sum ${bus} = ${sum}`);
            checks++;
          }
        }
        if (router) {
          ticker.t = Math.max(ticker.t, t * 1000);
          ticker.advance(rng() * 3000);
          if (player.volume > master * music * Math.pow(10, bed / 20) + 1e-9) violations.push(`${seq}: music above the bed`);
          if (router.state().duckDb < PLAY_DUCK_FLOOR_DB - EPS) violations.push(`${seq}: router below the floor`);
        }
      }
      router?.dispose();
    }
    expect(violations.slice(0, 5)).toEqual([]);
    expect(checks).toBeGreaterThan(100000);
  });
});
