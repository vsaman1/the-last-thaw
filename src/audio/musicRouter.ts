/**
 * MusicRouter (contract §10, DESIGN §3 and §8.1): the only caller of the recorded-music player once
 * the sound system is wired in. The player (./music.ts) is untouched; the router composes what it
 * is told:
 *
 *   volume = master · music · 10^((trim + ducks)/20)      ducks: linear-in-dB ramps, sum >= -20 dB
 *   muted  = musicMuted || soundMuted || hidden            (the player pauses while muted)
 *   cue    = the wanted cue, or null while any hold is active
 *
 * A hold plays cue null, so the player's own 3 s fade-out and pause apply, and releasing the last
 * hold plays the wanted cue again, which resumes the piece where it paused with the 3 s fade-in. A
 * hold never outlives HOLD_MAX_SEC, and once the moment that owns it has scheduled its motif, never
 * its end + HOLD_SAFETY_SEC either (limitHolds): music cannot be left switched off by a lost release.
 * Those limits count only while the tab is shown: a hidden tab suspends the audio clock the motif is
 * scheduled on, so the time it spends hidden is added to every hold's deadline when it is shown again
 * (otherwise the recording would come back over a motif that has not finished).
 *
 * Every method is idempotent (StrictMode runs effects twice). While a ramp moves, the volume is
 * stepped at 20 Hz and setVolume is called only when it has moved by more than ROUTER_MIN_STEP (or
 * RELATIVE_STEP of itself, which matters at quiet settings); once everything has settled the exact
 * value is sent. setMuted and play are called only on a change. Nothing is called on the player
 * before the first setLevels / setCue, so constructing the router has no effect on the music.
 */
import type { MusicCue } from '../story/types';
import {
  HOLD_MAX_SEC,
  HOLD_SAFETY_SEC,
  ROUTER_MIN_STEP,
  ROUTER_TICK_MS,
  type AudioLevels,
  type DuckKey,
  type MusicHoldKey,
  type MusicRouter,
  type MusicRouterOptions,
  type MusicRouterState,
} from './contract';
import { DuckMixer, type DuckSetOptions } from './ducks';
import type { FadeTicker } from './music';

/** A bed or trim change glides over this long (linear in dB) instead of jumping. */
export const TRIM_RAMP_SEC = 1;
/** A volume step also counts when it is this fraction of the level (0.17 dB), for quiet settings. */
export const RELATIVE_STEP = 0.02;

export interface MusicRouterImpl extends MusicRouter {
  /** A duck that releases itself: attack, hold (Infinity = until unduck), release. */
  duckFor(key: DuckKey, db: number, attackSec: number, holdSec: number, releaseSec: number, options?: DuckSetOptions): void;
  /** A motif ends endInSec from now: every active hold now ends by then + HOLD_SAFETY_SEC at the latest. */
  limitHolds(endInSec: number): void;
  /** Current duck sum (dB, floored), for the engine's state(). */
  duckDb(): number;
  /** Stop the ticker (tests and HMR). */
  dispose(): void;
}

export interface MusicRouterExtraOptions {
  /** Throw on a positive duck or trim (default: under tests); otherwise clamp and report via onNote. */
  readonly strict?: boolean;
  /** Notes for the trace (holds released by the safety timer). */
  readonly onNote?: (kind: 'hold' | 'music' | 'duck' | 'error', note: string) => void;
}

interface Hold {
  readonly start: number;
  deadline: number;
}

const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);

export function createMusicRouter(options: MusicRouterOptions & MusicRouterExtraOptions): MusicRouterImpl {
  const { player, ticker } = options;
  const strict = options.strict ?? import.meta.env.MODE === 'test';
  const mixer = new DuckMixer({ strict, onInvalid: (m) => note('error', m) });
  const holds = new Map<MusicHoldKey, Hold>();
  const now = (): number => ticker.now() / 1000;

  let levels: AudioLevels | null = null;
  let hidden = false;
  /** When the tab was hidden (router seconds); holds do not run out while hidden. */
  let hiddenAt = 0;
  let wanted: MusicCue | null = null;
  let cueSet = false;
  /** What was last passed to play(); undefined = never. */
  let playing: MusicCue | null | undefined;
  let lastVolume: number | null = null;
  let lastMuted: boolean | null = null;
  let trimFrom = 0;
  let trimTo = 0;
  let trimT0 = 0;
  let trimT1 = 0;
  let ticking = false;
  let disposed = false;

  const trimAt = (t: number): number =>
    t >= trimT1 || trimT1 <= trimT0 ? trimTo : trimFrom + (trimTo - trimFrom) * ((t - trimT0) / (trimT1 - trimT0));

  function note(kind: 'hold' | 'music' | 'duck' | 'error', text: string): void {
    options.onNote?.(kind, text);
  }

  const checkDb = (what: string, db: number): number => {
    if (Number.isFinite(db) && db <= 0) return db;
    const message = `music ${what}: ${db} dB (must be <= 0 and finite)`;
    if (strict) throw new RangeError(message);
    note('error', message);
    return 0;
  };

  function apply(): void {
    if (disposed) return;
    const t = now();
    for (const [key, h] of holds) {
      if (!hidden && t >= h.deadline) {
        holds.delete(key);
        note('hold', `hold '${key}' released by its safety limit`);
      }
    }
    const cue = holds.size > 0 ? null : wanted;
    if (cueSet && cue !== playing) {
      playing = cue;
      player.play(cue);
    }
    if (levels !== null) {
      const muted = levels.musicMuted || levels.soundMuted || hidden;
      if (muted !== lastMuted) {
        lastMuted = muted;
        player.setMuted(muted);
      }
      const db = trimAt(t) + mixer.sum('music', t);
      const v = clamp01(levels.master * levels.music * Math.pow(10, db / 20));
      const delta = lastVolume === null ? Infinity : Math.abs(v - lastVolume);
      // ROUTER_MIN_STEP alone would leave a quiet setting (music 0.05 under a -20 dB duck is 0.005)
      // up to 0.002 off, i.e. several dB, so a relative step also counts, and the exact value is sent
      // once the ramps have settled.
      if (delta > ROUTER_MIN_STEP || delta > RELATIVE_STEP * Math.max(v, lastVolume ?? 0) || (delta > 0 && mixer.settled(t) && t >= trimT1)) {
        lastVolume = v;
        player.setVolume(v);
      }
    }
    const moving = !mixer.settled(t) || t < trimT1 || holds.size > 0;
    if (moving && !ticking) {
      ticking = true;
      ticker.start(apply);
    } else if (!moving && ticking) {
      ticking = false;
      ticker.stop();
    }
  }

  return {
    setCue(cue: MusicCue | null): void {
      if (cueSet && cue === wanted) return;
      cueSet = true;
      wanted = cue;
      apply();
    },
    setLevels(next: AudioLevels): void {
      levels = next;
      apply();
    },
    setHidden(h: boolean): void {
      if (h === hidden) return;
      const t = now();
      if (h) hiddenAt = t;
      else for (const hold of holds.values()) hold.deadline += Math.max(0, t - hiddenAt);
      hidden = h;
      apply();
    },
    setTrim(db: number): void {
      const target = checkDb('trim', db);
      if (target === trimTo) return;
      const t = now();
      trimFrom = trimAt(t);
      trimTo = target;
      trimT0 = t;
      trimT1 = t + TRIM_RAMP_SEC;
      apply();
    },
    hold(key: MusicHoldKey): void {
      if (holds.has(key)) return;
      const t = now();
      holds.set(key, { start: t, deadline: t + HOLD_MAX_SEC });
      note('hold', `hold '${key}'`);
      apply();
    },
    release(key: MusicHoldKey): void {
      if (!holds.delete(key)) return;
      note('hold', `release '${key}'`);
      apply();
    },
    duck(key: DuckKey, db: number, attackSec: number): void {
      mixer.set(key, { music: checkDb(`duck '${key}'`, db), ambience: 0, effects: 0 }, attackSec, Infinity, 0, now());
      apply();
    },
    duckFor(key: DuckKey, db: number, attackSec: number, holdSec: number, releaseSec: number, opts?: DuckSetOptions): void {
      mixer.set(key, { music: checkDb(`duck '${key}'`, db), ambience: 0, effects: 0 }, attackSec, holdSec, releaseSec, now(), opts);
      apply();
    },
    unduck(key: DuckKey, releaseSec: number): void {
      mixer.release(key, releaseSec, now());
      apply();
    },
    limitHolds(endInSec: number): void {
      if (!Number.isFinite(endInSec)) return;
      const t = now();
      for (const h of holds.values()) h.deadline = Math.min(h.deadline, t + Math.max(0, endInSec) + HOLD_SAFETY_SEC);
      apply();
    },
    unlock(): void {
      player.unlock();
    },
    duckDb(): number {
      return mixer.sum('music', now());
    },
    state(): MusicRouterState {
      const t = now();
      const ducks: Partial<Record<DuckKey, number>> = {};
      for (const [key, lv] of Object.entries(mixer.snapshot(t)) as [DuckKey, { music: number }][]) {
        if (lv.music !== 0) ducks[key] = lv.music;
      }
      return {
        cue: wanted,
        playing: playing ?? null,
        holds: [...holds.keys()],
        ducks,
        targets: mixer.targets('music', t),
        duckDb: mixer.sum('music', t),
        trimDb: trimAt(t),
        volume: lastVolume ?? 0,
        muted: lastMuted ?? false,
        hidden,
      };
    },
    dispose(): void {
      disposed = true;
      if (ticking) ticker.stop();
      ticking = false;
    },
  };
}

/** The production ticker: a 20 Hz interval while the router has something moving. */
export function intervalTicker(ms: number = ROUTER_TICK_MS): FadeTicker {
  let id: ReturnType<typeof setInterval> | null = null;
  return {
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    start(onTick: () => void): void {
      if (id === null) id = setInterval(onTick, ms);
    },
    stop(): void {
      if (id !== null) clearInterval(id);
      id = null;
    },
  };
}
