/**
 * The level-start sequence: an optional flyover of the course, then the calving — the iceberg cracks
 * out of the glacier at the top of the valley and slides off — then play. Pure timing; the session
 * owns the clock, the camera and renderers derive everything from (timeline, seconds into the intro).
 *
 * - 'full': flyover + full calving (the first attempt at a level).
 * - 'short': a short calving beat only (Settings → Skip intros, Retry/Replay, Space during the flyover).
 * - 'none': straight to play (headless tests and scripted runs).
 */

export type IntroKind = 'full' | 'short' | 'none';

/** Where the intro clock is: on the flyover, in the calving, or over (play has begun). */
export type IntroStage = 'flyover' | 'calving' | 'done';

export const INTRO_TIMING = {
  /** Course flyover, ending on the glacier front (s): this long up to flyoverRoute metres of route. */
  flyover: 7.5,
  flyoverRoute: 1200,
  /** Longer routes add a second per this many metres, up to flyoverMax (else ~1 km/s sweeps). */
  flyoverPer: 300,
  flyoverMax: 11,
  /** The full calving: cracks, break, drop, slide (s). */
  calving: 3,
  /** The short calving beat (s). */
  calvingShort: 1.2,
} as const;

export interface IntroTimeline {
  readonly kind: IntroKind;
  /** Seconds of flyover before the calving starts (0 unless 'full'). */
  readonly flyover: number;
  /** Seconds of calving (0 for 'none'). */
  readonly calving: number;
  /** flyover + calving. */
  readonly total: number;
}

const timeline = (kind: IntroKind, flyover: number, calving: number): IntroTimeline =>
  Object.freeze({ kind, flyover, calving, total: flyover + calving });

const TIMELINES: Readonly<Record<IntroKind, IntroTimeline>> = {
  full: timeline('full', INTRO_TIMING.flyover, INTRO_TIMING.calving),
  short: timeline('short', 0, INTRO_TIMING.calvingShort),
  none: timeline('none', 0, 0),
};

/** Flyover seconds for a route (spawn to coast) of `length` m; the default without one. */
export function flyoverFor(length?: number): number {
  const T = INTRO_TIMING;
  if (length === undefined || !(length > T.flyoverRoute)) return T.flyover;
  return Math.min(T.flyoverMax, T.flyover + (length - T.flyoverRoute) / T.flyoverPer);
}

/**
 * The timeline of an intro kind (shared and frozen unless a long route stretches the flyover).
 * `routeLength`: the level's spawn-to-coast distance (m), so long levels don't whip past.
 */
export function introTimeline(kind: IntroKind, routeLength?: number): IntroTimeline {
  const base = TIMELINES[kind] ?? TIMELINES.full;
  if (base.kind !== 'full') return base;
  const flyover = flyoverFor(routeLength);
  return flyover === base.flyover ? base : timeline('full', flyover, INTRO_TIMING.calving);
}

/** Spawn-to-coast distance of a level (m): what the flyover sweeps. */
export const routeLengthOf = (level: { startS: number; coastS: number }): number =>
  Math.max(0, level.coastS - level.startS);

/** Stage at `t` seconds into the intro. */
export function introStageAt(tl: IntroTimeline, t: number): IntroStage {
  if (!(t < tl.total)) return 'done';
  return t < tl.flyover ? 'flyover' : 'calving';
}

/**
 * Seconds into the calving at intro time `t`: 0 during the flyover, tl.calving once it is over.
 * Never NaN (a NaN clock counts as the end).
 */
export function calvingTimeAt(tl: IntroTimeline, t: number): number {
  if (!(t < tl.total)) return tl.calving;
  return t <= tl.flyover ? 0 : t - tl.flyover;
}
