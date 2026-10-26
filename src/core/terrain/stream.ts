import type { TerrainFeature } from '../types';
import { smoothstep } from '../math';

/**
 * Shape of a 'stream' feature (a natural river channel), shared by the terrain carve
 * (./features.ts) and the water network (src/core/water).
 *
 * Along the stream, its bed follows the PROFILE: the valley height (without features) sampled
 * every STREAM_SHAPE.profileStep m under the polyline from source to mouth, made non-increasing
 * (a running minimum: the water never runs uphill, it cuts through rises; where the ground steps
 * down, e.g. at a cliff, the bed steps down: a waterfall). Across it (q = distance to the polyline
 * in course coordinates, like the other polyline features), the cross-section is
 *   bed = profile − bank·along                                     for q ≤ half − run
 *   bed + bank·along · smoothstep(0, run, q − (half − run))         up the bank face
 *   profile + (q − half)·outerSlope                                beyond the bank top
 * and the ground is lowered to it where it is higher (min), so where the ground beside the channel
 * stands above the profile the cut continues as a steeper bank. `along` (0..1) opens the channel
 * gently over taper = max(width, 4·bank) from the source and closes it the same way at a 'sea'
 * end (a 'pool' end stops short in a round bowl). A stream with a `source` (types.ts StreamSource:
 * the glacier, a cave spring, another stream) starts at its FULL section instead: its start is
 * hidden under the ice, in the spring pool or in the parent channel, so nothing fades in from open
 * ground (the "river popping out of the meadow" look the world logic rule 'stream-source' forbids).
 *
 * SPRING POOL ('cave' source). A round bowl of radius R = clamp(radiusShare × width, radiusMin,
 * radiusMax) centred on the first point (the spring). Its floor lies SPRING_POOL.deepen m below the
 * channel bed at the pool's outlet (arc R: the stream leaves over a sill); it rises like a bank to
 * the natural ground at the spring and beyond the rim cuts back into the ground at
 * SPRING_POOL.outerSlope (a rock alcove where the face behind it rises; at most outerMax m out). The
 * cave mouth stands in that face at the back of the pool (src/core/water/cave.ts); the pool holds
 * still water at the stream's level at its outlet (src/core/water/pool.ts).
 */

type Stream = Extract<TerrainFeature, { type: 'stream' }>;

export const STREAM_SHAPE = {
  /** Steepest bank face (rise/run): the smoothstep face over `run` m has max slope 1.5·bank/run. */
  bankSlope: 1.6,
  /** The bed keeps at least this share of the top width. */
  minBedShare: 0.2,
  /** Beyond the bank top the cut rises at this slope until it meets the ground (at most outerMax m). */
  outerSlope: 1,
  outerMax: 12,
  /** Profile sample spacing along the polyline (m). */
  profileStep: 1,
  /** Default water depth: min(depthMax, depthShare × bank). */
  depthShare: 0.45,
  depthMax: 1.2,
  /** Default flow speed (m/s) on a 0.05 bed slope. */
  flow: 4,
} as const;

const S = STREAM_SHAPE;

/** Water depth (m) of a stream on a 0.05 bed slope. */
export const streamDepth = (f: Stream): number =>
  f.depth !== undefined && f.depth > 0 ? f.depth : Math.min(S.depthMax, S.depthShare * f.bank);

/** Flow speed (m/s) of a stream on a 0.05 bed slope. */
export const streamFlow = (f: Stream): number => (f.flow !== undefined && f.flow > 0 ? f.flow : S.flow);

/** Distance (m) over which a stream's channel opens at its source (and closes at a 'sea' end). */
export const streamTaper = (f: Stream): number => Math.max(f.width, 4 * f.bank);

/**
 * 0..1 share of the full bank (and water depth) at arc length `arc` of a stream `length` m long:
 * full from the first point when the stream has a source, else opening over the taper.
 */
export function streamAlong(f: Stream, arc: number, length: number): number {
  const taper = Math.min(streamTaper(f), length / 2);
  let a = f.source ? 1 : smoothstep(0, taper, arc);
  if (f.end !== 'pool') a *= 1 - smoothstep(length - taper, length, arc);
  return a;
}

/** Shape of a 'cave' stream's spring pool (see the module comment). */
export const SPRING_POOL = {
  /** Pool radius = clamp(radiusShare × width, radiusMin, radiusMax) (m). */
  radiusShare: 0.9,
  radiusMin: 6,
  radiusMax: 20,
  /** The pool floor lies this far (m) below the channel bed at its outlet (the sill). */
  deepen: 1,
  /**
   * Beyond its rim the pool cuts back into higher ground at this slope (rise/run), at most outerMax
   * m out: steeper than the stream's outer cut, so against a rising face it leaves a rock alcove
   * (a valley wall rises at ~1.3, a cliff band is sheer) instead of a step where the cut stops.
   */
  outerSlope: 2.5,
  outerMax: 12,
} as const;

/** Radius (m) of a stream's spring pool (0 unless its source is a 'cave'). */
export function springPoolRadius(f: Stream): number {
  if (f.source !== 'cave') return 0;
  const P = SPRING_POOL;
  return Math.min(P.radiusMax, Math.max(P.radiusMin, P.radiusShare * f.width));
}

/** Heights (m) of a spring pool: its floor, and its rim (the natural ground at the spring). */
export interface SpringPoolLevels {
  readonly radius: number;
  readonly floorY: number;
  readonly topY: number;
}

/** A 'cave' stream's spring pool from its bed profile (null for other streams). */
export function springPoolLevels(f: Stream, p: StreamProfile): SpringPoolLevels | null {
  const radius = springPoolRadius(f);
  if (!(radius > 0)) return null;
  const outlet = profileAt(p, Math.min(radius, p.length)) - f.bank;
  return { radius, floorY: outlet - SPRING_POOL.deepen, topY: profileAt(p, 0) };
}

/**
 * Target height of a spring pool at distance `q` (m) from its centre (the first point), or
 * +Infinity where it leaves the ground alone.
 */
export function springPoolSection(pool: SpringPoolLevels, q: number): number {
  const R = pool.radius;
  if (q >= R + SPRING_POOL.outerMax) return Infinity;
  if (q >= R) return pool.topY + (q - R) * SPRING_POOL.outerSlope;
  const rise = Math.max(0, pool.topY - pool.floorY);
  const run = streamBankRun(rise, R);
  const inner = R - run;
  return q <= inner ? pool.floorY : pool.floorY + rise * smoothstep(0, run, q - inner);
}

/** Horizontal run (m) of a bank face `bank` m high in a channel of half top width `half`. */
export function streamBankRun(bank: number, half: number): number {
  return Math.max(0.05, Math.min((1.5 * bank) / S.bankSlope, (1 - S.minBedShare) * half));
}

/**
 * Lateral reach (m) of a stream's cut from its polyline: its half width plus the outer cut, or its
 * spring pool's radius plus the pool's cut back into the ground where that reaches further.
 */
export const streamReach = (f: Stream): number => {
  const pool = springPoolRadius(f);
  return Math.max(f.width / 2 + S.outerMax, pool > 0 ? pool + SPRING_POOL.outerMax : 0);
};

/**
 * Target height of the channel at distance `q` (m) from the polyline where the profile is
 * `profileY` and the bank share is `along`; +Infinity where the stream leaves the ground alone.
 */
export function streamSection(f: Stream, q: number, profileY: number, along: number): number {
  const half = f.width / 2;
  if (q >= half + S.outerMax) return Infinity;
  const bank = f.bank * along;
  if (q >= half) return bank > 0 ? profileY + (q - half) * S.outerSlope : Infinity;
  const run = streamBankRun(bank, half);
  const bed = profileY - bank;
  const inner = half - run;
  return q <= inner ? bed : bed + bank * smoothstep(0, run, q - inner);
}

/** A stream's profile (the bed before the bank is cut), sampled every `step` m from its source. */
export interface StreamProfile {
  /** Index of the stream in level.features. */
  readonly index: number;
  readonly step: number;
  /** Polyline length (m) in course coordinates. */
  readonly length: number;
  readonly values: Float64Array;
}

/** Profile height at arc length `arc` (linear between samples, clamped at the ends). */
export function profileAt(p: StreamProfile, arc: number): number {
  const v = p.values;
  const f = Math.min(Math.max(arc / p.step, 0), v.length - 1);
  const i = Math.min(Math.floor(f), v.length - 2);
  if (i < 0) return v[0];
  return v[i] + (v[i + 1] - v[i]) * (f - i);
}

/** Running minimum from the source: the bed never rises downstream. Mutates and returns `raw`. */
export function descendingProfile(raw: Float64Array): Float64Array {
  for (let i = 1; i < raw.length; i++) if (raw[i] > raw[i - 1]) raw[i] = raw[i - 1];
  return raw;
}
