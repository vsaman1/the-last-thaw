import { clamp01, lerp, smoothstep } from '../math';
import { INTRO_TIMING } from '../intro';

/**
 * The calving beat: cracks spread round the iceberg embedded in the glacier front, chips and snow
 * dust fall, the chunk tilts out and breaks away, drops onto the slope and slides off, arriving at
 * the spawn pose exactly at the hand-off with the spawn velocity. Pure maths over seconds into the
 * calving; the renderers (iceberg pose offset, crack glow, particles) and the calving camera all read
 * the same CalvingState, so they always agree. The simulation never moves during it.
 */

/** Key times (s from the start of the calving) for a calving of `duration` seconds. */
export interface CalvingKeys {
  duration: number;
  /** The chunk starts to shudder (pre-break tension). */
  shudderFrom: number;
  /** Cracks have spread all the way round. */
  crackEnd: number;
  /** The chunk breaks free: flash, burst of ice; it starts to move. */
  breakAt: number;
  /** Largest forward tilt as it leans out of the face. */
  tiltPeak: number;
  /** It lands on the slope below the ledge (dust puff). */
  landAt: number;
  /** The landing hop has settled. */
  settleAt: number;
  /** prefers-reduced-motion: the camera cuts (under a veil) from the front shot to the follow pose. */
  cutAt: number;
  /** Veil fade in before / out after the cut. */
  veilIn: number;
  veilOut: number;
}

type KeyFractions = Omit<CalvingKeys, 'duration'>;

/** Key times of the full and the short calving, in seconds of their own durations. */
const FULL: KeyFractions = {
  shudderFrom: 0.55,
  crackEnd: 1.2,
  breakAt: 1.3,
  tiltPeak: 1.65,
  landAt: 2.05,
  settleAt: 2.35,
  cutAt: 1.95,
  veilIn: 0.3,
  veilOut: 0.35,
};
const SHORT: KeyFractions = {
  shudderFrom: 0.08,
  crackEnd: 0.3,
  breakAt: 0.34,
  tiltPeak: 0.52,
  landAt: 0.7,
  settleAt: 0.88,
  cutAt: 0.64,
  veilIn: 0.16,
  veilOut: 0.24,
};

/** Largest forward tilt (rad) and roll (rad) while leaning out of the face. */
export const CALVING_TUNING = {
  maxTilt: 0.2,
  maxRoll: 0.07,
  /** Lean before the break (rad), as the crack opens. */
  preTilt: 0.025,
  /** Landing hop height as a fraction of the ledge height. */
  hop: 0.18,
  /** Crack reveal value at full spread (> 1 so the last segments light fully). */
  crackFull: 1.15,
  /** Peak opacity of the reduced-motion veil. */
  veilPeak: 0.92,
} as const;

const C = CALVING_TUNING;

/**
 * Key times for a calving lasting `duration` s: the full (3 s) and short (1.2 s) presets, blended in
 * proportion for anything in between (and scaled beyond).
 */
export function calvingKeys(duration: number): CalvingKeys {
  const d = duration > 0 && Number.isFinite(duration) ? duration : INTRO_TIMING.calving;
  const span = INTRO_TIMING.calving - INTRO_TIMING.calvingShort;
  const f = clamp01((d - INTRO_TIMING.calvingShort) / span);
  const key = (k: keyof KeyFractions): number =>
    lerp(SHORT[k] / INTRO_TIMING.calvingShort, FULL[k] / INTRO_TIMING.calving, f) * d;
  return {
    duration: d,
    shudderFrom: key('shudderFrom'),
    crackEnd: key('crackEnd'),
    breakAt: key('breakAt'),
    tiltPeak: key('tiltPeak'),
    landAt: key('landAt'),
    settleAt: key('settleAt'),
    cutAt: key('cutAt'),
    veilIn: key('veilIn'),
    veilOut: key('veilOut'),
  };
}

/** What the calving looks like at one moment. Offsets are relative to the iceberg's spawn pose. */
export interface CalvingState {
  /** 0..crackFull: how far the cracks have spread (crack segments with reveal < crack are lit). */
  crack: number;
  /** Crack glow multiplier (flash at the break, 0 by the end). */
  glow: number;
  /** 0..1 pre-break shudder amplitude. */
  shudder: number;
  /** Metres upstream of the spawn point along the course (D while embedded, 0 at the hand-off). */
  along: number;
  /** Metres above the ground under it (the ledge height while embedded). */
  lift: number;
  /** Forward tilt (rad, front down) and roll (rad, multiplied by the level's roll sign). */
  tilt: number;
  roll: number;
  /** Speed along the course (m/s): 0 while embedded, the spawn speed at the hand-off. */
  speed: number;
  /** Past the break. */
  broken: boolean;
  /** Snow cap on the iceberg (iceberg frost uniform floor), shaken off as it breaks away. */
  frost: number;
}

export const createCalvingState = (): CalvingState => ({
  crack: 0,
  glow: 0,
  shudder: 0,
  along: 0,
  lift: 0,
  tilt: 0,
  roll: 0,
  speed: 0,
  broken: true,
  frost: 0,
});

/** Slide geometry: how far the chunk travels and how high the ledge it drops from is. */
export interface CalvingMotion {
  /** Distance (m) from the embedded position to the spawn point along the course. */
  slide: number;
  /** Ledge height (m) the chunk drops from. */
  ledge: number;
  /** Horizontal speed (m/s) at the hand-off: the iceberg's spawn speed. */
  endSpeed: number;
}

/**
 * Progress 0..1 of the slide over normalised time u (0..1) whose slope at u = 1 is `m` (end speed ×
 * window / slide) and at u = 0 is 0: a cubic ease for m ≤ 3, u^m beyond (both monotonic).
 */
export function slideProgress(u: number, m: number): number {
  const x = clamp01(u);
  if (m > 3) return x ** m;
  const a = 3 - m;
  const b = m - 2;
  return x * x * (a + b * x);
}

/** d(slideProgress)/du. */
export function slideRate(u: number, m: number): number {
  const x = clamp01(u);
  if (m > 3) return x <= 0 ? 0 : m * x ** (m - 1);
  return x * (2 * (3 - m) + 3 * (m - 2) * x);
}

/**
 * Calving state `t` seconds into a calving with keys `k`. t ≥ k.duration (or NaN) is the hand-off:
 * every offset 0, speed = endSpeed. Allocation-free (writes into `out`).
 */
export function calvingStateAt(
  k: CalvingKeys,
  t: number,
  motion: CalvingMotion,
  out: CalvingState,
): CalvingState {
  const D = motion.slide;
  const ledge = motion.ledge;
  if (!(t < k.duration)) {
    out.crack = C.crackFull;
    out.glow = 0;
    out.shudder = 0;
    out.along = 0;
    out.lift = 0;
    out.tilt = 0;
    out.roll = 0;
    out.speed = motion.endSpeed;
    out.broken = true;
    out.frost = 0;
    return out;
  }
  const time = Math.max(0, t);
  const crackU = clamp01(time / k.crackEnd);
  out.crack = C.crackFull * crackU ** 1.6;
  out.broken = time >= k.breakAt;
  if (!out.broken) {
    out.glow = 0.55 + 0.45 * (time / k.breakAt);
    out.shudder = smoothstep(k.shudderFrom, k.breakAt, time);
    out.along = D;
    out.lift = ledge;
    out.tilt = C.preTilt * out.shudder;
    out.roll = 0;
    out.speed = 0;
    out.frost = 0.5;
    return out;
  }
  const since = time - k.breakAt;
  out.glow = (0.4 + 2 * Math.exp(-6 * since)) * (1 - smoothstep(k.landAt, k.duration, time));
  out.shudder = 0;
  const window = k.duration - k.breakAt;
  const m = window > 0 && D > 0 ? (motion.endSpeed * window) / D : 0;
  const u = since / window;
  out.along = D * (1 - slideProgress(u, m));
  out.speed = window > 0 ? (D * slideRate(u, m)) / window : 0;
  // Drop off the ledge (accelerating), then a small hop as it lands.
  if (time < k.landAt) {
    const f = (time - k.breakAt) / (k.landAt - k.breakAt);
    out.lift = ledge * (1 - f * f);
  } else if (time < k.settleAt) {
    out.lift = ledge * C.hop * Math.sin(Math.PI * ((time - k.landAt) / (k.settleAt - k.landAt)));
  } else {
    out.lift = 0;
  }
  // Lean out of the face, back onto the slope by the landing, a small counter-rock after it.
  let lean: number;
  if (time < k.tiltPeak) {
    const f = (time - k.breakAt) / (k.tiltPeak - k.breakAt);
    lean = lerp(C.preTilt / C.maxTilt, 1, 1 - (1 - f) * (1 - f));
  } else if (time < k.landAt) {
    lean = 1 - smoothstep(k.tiltPeak, k.landAt, time);
  } else if (time < k.settleAt) {
    lean = -0.25 * Math.sin(Math.PI * ((time - k.landAt) / (k.settleAt - k.landAt)));
  } else {
    lean = 0;
  }
  out.tilt = C.maxTilt * lean;
  out.roll = C.maxRoll * lean;
  out.frost = 0.5 * (1 - smoothstep(k.breakAt, k.settleAt, time));
  return out;
}

/**
 * Camera shake amplitude (m) `t` s into the calving: a jolt as the chunk breaks free and a smaller
 * one as it lands. The renderer skips it for prefers-reduced-motion.
 */
export function calvingShake(k: CalvingKeys, t: number): number {
  if (!(t >= k.breakAt) || !(t < k.duration)) return 0;
  let a = 0.16 * Math.exp(-7 * (t - k.breakAt));
  if (t >= k.landAt) a += 0.07 * Math.exp(-9 * (t - k.landAt));
  return a;
}

/** Opacity of the reduced-motion veil `t` s into the calving (peaks at the camera cut). */
export function calvingVeil(k: CalvingKeys, t: number): number {
  if (!(t >= k.cutAt - k.veilIn) || !(t <= k.cutAt + k.veilOut)) return 0;
  const v =
    t <= k.cutAt
      ? smoothstep(k.cutAt - k.veilIn, k.cutAt, t)
      : 1 - smoothstep(k.cutAt, k.cutAt + k.veilOut, t);
  return C.veilPeak * v;
}
