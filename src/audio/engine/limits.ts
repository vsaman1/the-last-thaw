/**
 * Rate limits (DESIGN §2.4 step 3, §6.5): token buckets on AudioContext time, a per-key minimum
 * interval with a bounded LRU, and a per-frame admission cap. All clocked by the caller, so a
 * fastForward burst, which emits hundreds of steps' events while the audio clock barely moves, is
 * bounded twice: by the frame cap and by buckets that hardly refill.
 *
 * Nothing here allocates per request: buckets are plain numbers and per-key entries are keyed by one
 * number (key·32 + family index).
 */
import { FAMILY_LIMITS, GLOBAL_LIMITS, type SoundFamily } from '../contract';

export const FAMILIES = Object.keys(FAMILY_LIMITS) as SoundFamily[];
const FAMILY_INDEX: Readonly<Record<SoundFamily, number>> = Object.fromEntries(
  FAMILIES.map((f, i) => [f, i]),
) as Record<SoundFamily, number>;
export const familyIndex = (f: SoundFamily): number => FAMILY_INDEX[f];

/** A token bucket: `rate` tokens per second up to `burst`. Tokens may go into debt when allowed. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    readonly rate: number,
    readonly burst: number,
    now = 0,
  ) {
    this.tokens = burst;
    this.last = now;
  }

  /** Tokens available at `now` (refills first; time never runs backwards). */
  available(now: number): number {
    if (now > this.last) {
      this.tokens = Math.min(this.burst, this.tokens + (now - this.last) * this.rate);
      this.last = now;
    }
    return this.tokens;
  }

  /** Spend n tokens, never going below `floor` (0 normally; negative = debt allowed). */
  take(n: number, now: number, floor = 0): void {
    this.available(now);
    this.tokens = Math.max(floor, this.tokens - n);
  }

  reset(now: number): void {
    this.tokens = this.burst;
    this.last = now;
  }
}

/** One bucket per family (requests) and one global bucket (voices), shared by every session. */
export class RateLimits {
  readonly global: TokenBucket;
  private readonly families: TokenBucket[];

  constructor(now = 0) {
    this.global = new TokenBucket(GLOBAL_LIMITS.ratePerSec, GLOBAL_LIMITS.burst, now);
    this.families = FAMILIES.map((f) => new TokenBucket(FAMILY_LIMITS[f].ratePerSec, FAMILY_LIMITS[f].burst, now));
  }

  family(f: SoundFamily): TokenBucket {
    return this.families[FAMILY_INDEX[f]];
  }
}

/**
 * Minimum seconds between two requests with the same key in one family (an obstacle's repeated hits,
 * a placement's repeated breaks). Bounded: beyond `capacity` keys the least recently used is dropped,
 * which at worst lets one early repeat through.
 */
export class PerKeyLimiter {
  private readonly last = new Map<number, number>();

  constructor(readonly capacity = 256) {}

  private id(family: SoundFamily, key: number): number {
    return key * 32 + FAMILY_INDEX[family];
  }

  allowed(family: SoundFamily, key: number, intervalSec: number, now: number): boolean {
    if (key < 0 || intervalSec <= 0) return true;
    const t = this.last.get(this.id(family, key));
    return t === undefined || now - t >= intervalSec;
  }

  record(family: SoundFamily, key: number, now: number): void {
    if (key < 0) return;
    const id = this.id(family, key);
    this.last.delete(id); // re-insert: Map order is the LRU order
    this.last.set(id, now);
    if (this.last.size > this.capacity) {
      const oldest = this.last.keys().next();
      if (!oldest.done) this.last.delete(oldest.value);
    }
  }

  get size(): number {
    return this.last.size;
  }
}

/** At most `max` requests admitted per animation frame (beginFrame marks a new frame). */
export class FrameCap {
  private frame = Number.NaN;
  count = 0;

  constructor(readonly max: number = GLOBAL_LIMITS.maxRequestsPerFrame) {}

  begin(frame: number): void {
    if (frame === this.frame) return;
    this.frame = frame;
    this.count = 0;
  }

  get full(): boolean {
    return this.count >= this.max;
  }

  admit(): void {
    this.count++;
  }
}
