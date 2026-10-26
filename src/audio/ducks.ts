/**
 * DuckMixer: named, multiplicative level reductions per bus (DESIGN §8.7), pure and clocked by the
 * caller. Nothing here can make a sound louder:
 *
 *  - every contribution is <= 0 dB (a positive or non-finite level throws in strict mode, which is
 *    the default under tests, and is clamped to 0 and reported through onInvalid otherwise);
 *  - contributions multiply, i.e. their dB add, and the sum per bus never goes below the floor
 *    (PLAY_DUCK_FLOOR_DB, -20 dB): only a music hold removes music entirely, never a stack of ducks;
 *  - every ramp is linear in dB.
 *
 * A contribution has an attack ramp from wherever it currently is, a hold (a number of seconds, or
 * Infinity until its owner releases it) and a release ramp back to 0 dB, after which it disappears.
 * Values are evaluated lazily at the time the caller asks about, so the mixer needs no timers: the
 * owner just re-reads it on its own ticks (the music router at 20 Hz, the engine's bus stepper).
 */
import { PLAY_DUCK_FLOOR_DB, type DuckKey, type DuckLevels } from './contract';

export type DuckBus = 'music' | 'ambience' | 'effects';
const BUSES: readonly DuckBus[] = ['music', 'ambience', 'effects'];
const busIndex = (bus: DuckBus): number => (bus === 'music' ? 0 : bus === 'ambience' ? 1 : 2);

export interface DuckSetOptions {
  /** Overlapping triggers keep the deeper level per bus (the aftermath rule). */
  readonly deepest?: boolean;
  /** Repeats extend the hold, but never past this many seconds from the first hold's start. */
  readonly maxHoldSec?: number;
}

export interface DuckMixerOptions {
  readonly floorDb?: number;
  /** Throw on a level above 0 dB or not finite (default: under tests, import.meta.env.MODE 'test'). */
  readonly strict?: boolean;
  /** Told about a clamped level when not strict (the engine traces it and warns once in dev). */
  readonly onInvalid?: (message: string) => void;
}

interface Entry {
  /** dB per bus at t0, and the attack target. */
  readonly a0: [number, number, number];
  readonly a1: [number, number, number];
  readonly t0: number;
  readonly t1: number;
  /** End of the hold (Infinity: until released). */
  readonly holdEnd: number;
  readonly relSec: number;
  /** When the first trigger's hold began (for maxHoldSec). */
  readonly holdStart: number;
}

export class DuckMixer {
  private readonly entries = new Map<DuckKey, Entry>();
  readonly floorDb: number;
  private readonly strict: boolean;
  private readonly onInvalid: ((message: string) => void) | undefined;

  constructor(options: DuckMixerOptions = {}) {
    this.floorDb = options.floorDb ?? PLAY_DUCK_FLOOR_DB;
    this.strict = options.strict ?? import.meta.env.MODE === 'test';
    this.onInvalid = options.onInvalid;
  }

  /**
   * Ramp `key` to `levels` over attackSec (from its current value), hold for holdSec (Infinity =
   * until release()), then release over releaseSec. Calling again re-targets and restarts the hold.
   */
  set(
    key: DuckKey,
    levels: DuckLevels,
    attackSec: number,
    holdSec: number,
    releaseSec: number,
    now: number,
    options: DuckSetOptions = {},
  ): void {
    const target: [number, number, number] = [
      this.check(key, levels.music),
      this.check(key, levels.ambience),
      this.check(key, levels.effects),
    ];
    const attack = Math.max(0, finiteOr(attackSec, 0));
    const hold = holdSec === Infinity ? Infinity : Math.max(0, finiteOr(holdSec, 0));
    const release = Math.max(0, finiteOr(releaseSec, 0));
    const prev = this.live(key, now);
    const cur: [number, number, number] = prev ? [this.at(prev, 0, now), this.at(prev, 1, now), this.at(prev, 2, now)] : [0, 0, 0];
    if (prev && options.deepest) for (let i = 0; i < 3; i++) target[i] = Math.min(target[i], prev.a1[i]);
    // A repeat during the attack or hold extends the same hold; one after it began releasing starts anew.
    const holdStart = prev && prev.holdEnd !== Infinity && now < prev.holdEnd ? prev.holdStart : now + attack;
    let holdEnd = now + attack + hold;
    if (options.maxHoldSec !== undefined && hold !== Infinity) {
      holdEnd = Math.max(now + attack, Math.min(holdEnd, holdStart + options.maxHoldSec));
    }
    this.entries.set(key, { a0: cur, a1: target, t0: now, t1: now + attack, holdEnd, relSec: release, holdStart });
  }

  /** Release `key` from wherever it is, back to 0 dB over releaseSec. Unknown keys are ignored. */
  release(key: DuckKey, releaseSec: number, now: number): void {
    const e = this.live(key, now);
    if (!e) return;
    const rel = Math.max(0, finiteOr(releaseSec, 0));
    if (rel === 0) {
      this.entries.delete(key);
      return;
    }
    const cur: [number, number, number] = [this.at(e, 0, now), this.at(e, 1, now), this.at(e, 2, now)];
    this.entries.set(key, { a0: cur, a1: cur, t0: now, t1: now, holdEnd: now, relSec: rel, holdStart: e.holdStart });
  }

  /** Drop everything at once (session end releases through release(); this is for dispose). */
  clear(): void {
    this.entries.clear();
  }

  has(key: DuckKey, now: number): boolean {
    return this.live(key, now) !== null;
  }

  /** One contribution in dB (0 when absent). */
  factor(key: DuckKey, bus: DuckBus, now: number): number {
    const e = this.live(key, now);
    return e ? this.at(e, busIndex(bus), now) : 0;
  }

  /** Sum of every contribution on a bus, in dB, never below the floor. No allocation. */
  sum(bus: DuckBus, now: number): number {
    const i = busIndex(bus);
    let total = 0;
    for (const [key, e] of this.entries) {
      if (expired(e, now)) {
        this.entries.delete(key);
        continue;
      }
      total += this.at(e, i, now);
    }
    return Math.max(this.floorDb, total);
  }

  /** True when nothing will change by itself: every contribution is holding until released. */
  settled(now: number): boolean {
    for (const [key, e] of this.entries) {
      if (expired(e, now)) {
        this.entries.delete(key);
        continue;
      }
      if (now < e.t1 || e.holdEnd !== Infinity) return false;
    }
    return true;
  }

  keys(now: number): DuckKey[] {
    const out: DuckKey[] = [];
    for (const key of [...this.entries.keys()]) if (this.live(key, now)) out.push(key);
    return out;
  }

  /** Current levels of every active contribution (allocates: debug and state() only). */
  snapshot(now: number): Partial<Record<DuckKey, DuckLevels>> {
    const out: Partial<Record<DuckKey, DuckLevels>> = {};
    for (const key of this.keys(now)) {
      const e = this.entries.get(key)!;
      out[key] = { music: this.at(e, 0, now), ambience: this.at(e, 1, now), effects: this.at(e, 2, now) };
    }
    return out;
  }

  /**
   * Where each active contribution on one bus is heading (dB, non-zero only): its attack target
   * while it attacks or holds, its current level once it is releasing (allocates: state() only).
   */
  targets(bus: DuckBus, now: number): Partial<Record<DuckKey, number>> {
    const i = busIndex(bus);
    const out: Partial<Record<DuckKey, number>> = {};
    for (const key of this.keys(now)) {
      const e = this.entries.get(key)!;
      const v = now < e.holdEnd ? e.a1[i] : this.at(e, i, now);
      if (v !== 0) out[key] = v;
    }
    return out;
  }

  private live(key: DuckKey, now: number): Entry | null {
    const e = this.entries.get(key);
    if (!e) return null;
    if (expired(e, now)) {
      this.entries.delete(key);
      return null;
    }
    return e;
  }

  private at(e: Entry, i: number, t: number): number {
    if (t < e.t1) return e.a0[i] + (e.a1[i] - e.a0[i]) * ((t - e.t0) / (e.t1 - e.t0));
    if (t < e.holdEnd) return e.a1[i];
    const r = e.relSec > 0 ? (t - e.holdEnd) / e.relSec : 1;
    return r >= 1 ? 0 : e.a1[i] * (1 - r);
  }

  private check(key: DuckKey, db: number): number {
    if (Number.isFinite(db) && db <= 0) return db;
    const message = `duck '${key}': ${db} dB (ducks are <= 0 dB and finite)`;
    if (this.strict) throw new RangeError(message);
    this.onInvalid?.(message);
    return 0;
  }
}

const finiteOr = (x: number, fallback: number): number => (Number.isFinite(x) ? x : fallback);
const expired = (e: Entry, t: number): boolean => e.holdEnd !== Infinity && t >= e.holdEnd + e.relSec;

export const DUCK_BUSES = BUSES;

/** dB to linear amplitude. */
export const dbToGain = (db: number): number => Math.pow(10, db / 20);
