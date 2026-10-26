import { DEFAULT_ICEBERG_PARAMS } from './params';

/**
 * Inland water (streams, dam reservoirs, floods, captured rivers) as the iceberg integrator sees
 * it, and the rules that decide whether a stream's banks hold the iceberg in its channel.
 *
 * CONFINEMENT. An iceberg in a stream channel is confined (the banks act as walls: it is carried
 * along and can only steer within the channel) iff
 *   bank ≥ CONFINE_RATIO × icebergHeight(radius)   and   2 × radius ≤ the channel's top width,
 * where bank = the channel's bank height above its bed and icebergHeight = 1.27 × radius (the
 * collision height: 2.8 m for the base 2.2 m iceberg). With CONFINE_RATIO 0.75 a bank holds an
 * iceberg of radius ≤ bank / 0.955: the base iceberg (r 2.2) by banks ≥ 2.1 m, scale 1.5 (r 3.3) by
 * ≥ 3.15 m, scale 2 (r 4.4) by ≥ 4.2 m. Melting shrinks the iceberg (more easily held), absorbing ice
 * grows it (it can break out). An iceberg wider than the channel straddles it and is never held.
 * Bigger icebergs ride over the banks at will (no wall, no climb). Speed does not free a confined
 * iceberg, but a fast one can fly over a narrow stream from the land before it falls in. Where the
 * water stands over the bank tops (a reservoir or a flood drowns the channel) nothing confines.
 *
 * FLOATING. Water at least `floatDraft(radius)` deep (0.75 m × radius / 2.2, the drawn ocean draft)
 * floats the iceberg: its base rides the water surface and the current carries it.
 */

/** Radius (m) of the base iceberg. */
export const BASE_RADIUS = DEFAULT_ICEBERG_PARAMS.radius;
/** Collision height (m) of the base iceberg (= CONTACT_ABOVE in ./iceberg.ts; checked by a test). */
export const CONTACT_ABOVE_BASE = 2.8;

/** Bank height (as a share of the iceberg's height) from which a stream's banks hold the iceberg. */
export const CONFINE_RATIO = 0.75;
/** Floating draft (m) of the base iceberg; scales with the radius. Matches the ocean's drawn draft. */
export const FLOAT_DRAFT = 0.75;

/** How an iceberg moves on inland water (stepIceberg's float, ride and wade steps). */
export const INLAND_FLOAT = {
  /** Rate (1/s) at which a floating iceberg's speed relative to flowing water decays... */
  streamDrag: 0.6,
  /** ...and on still water (a reservoir, a pool: it glides). Plus the ocean's quadratic water drag. */
  stillDrag: 0.08,
  /** Sideways push (m/s²) at full steer: across the current, or across the heading on still water. */
  steerPush: 2.5,
  /** In water shallower than the draft, the current drags at this rate (1/s) × depth / draft. */
  wadeDrag: 0.8,
  /**
   * Afloat, the stuck timer runs (at stuckRate s per s, so stuckTime 3 s fails after 9 s) only while
   * slower than stuckSpeed (m/s): drifting on a lake is not stuck, being pinned against a dam is.
   */
  stuckSpeed: 0.6,
  stuckRate: 1 / 3,
  /**
   * The surface fallProbe m ahead (or one step, if longer) dropping more than fallDrop +
   * fallPerMetre × that distance (m) is a waterfall: the iceberg leaves the lip and flies.
   */
  fallProbe: 1.5,
  fallDrop: 0.6,
  fallPerMetre: 0.35,
  /** A confined iceberg's centre stays within confineShare × the half top width − half its radius. */
  confineShare: 0.75,
  /** Friction (tangential loss per unit normal impulse) of a channel's banks against the hull. */
  bankFriction: 0.1,
  /**
   * A big iceberg riding in a channel the banks cannot hold: its motion across the channel decays at
   * this rate (1/s) unless the player steers (fully off from |steer| ≥ guideSteer), so it follows
   * the stream until it is steered out.
   */
  rideGuide: 1.5,
  guideSteer: 0.3,
  /**
   * Riding a channel it is too big for, steering turns the hull at this share of its usual rate and
   * pushes it across at ridePush m/s² instead: it crabs out over the bank and keeps its way.
   */
  rideTurn: 0.35,
  ridePush: 4,
} as const;

/**
 * Current (m/s) an iceberg of this radius feels in water sample `w`, into `out`: the hull spans most
 * of a stream channel, so it is carried at the centre line's speed unless it is pressed toward a
 * bank (the profile is taken at its near side, 0.6 × radius in from its centre, and kept ≥ 35 %).
 */
export function hullCurrent(w: InlandWaterSample, radius: number, out: { x: number; z: number }): void {
  if (!w.channel || w.drowned) {
    out.x = w.vx;
    out.z = w.vz;
    return;
  }
  const q = Math.max(0, Math.abs(w.lat) - 0.6 * radius) / Math.max(w.waterHalf, 0.5);
  const k = Math.min(1, Math.max(0.35, 1 - q * q * q * q));
  out.x = w.cvx * k;
  out.z = w.cvz * k;
}

/** Height (m) of an iceberg of this radius: its collision height (2.8 m at the base 2.2 m radius). */
export function icebergHeight(radius: number): number {
  return (CONTACT_ABOVE_BASE * Math.max(radius, 0)) / BASE_RADIUS;
}

/** Lowest bank (m) that confines an iceberg of this radius: CONFINE_RATIO × icebergHeight. */
export function confiningBank(radius: number): number {
  return CONFINE_RATIO * icebergHeight(radius);
}

/**
 * True when a channel with banks `bank` m high and `topWidth` m wide between its bank tops holds an
 * iceberg of this radius (see the module comment).
 */
export function isConfinedBy(bank: number, topWidth: number, radius: number): boolean {
  return bank >= confiningBank(radius) && 2 * radius <= topWidth;
}

/** Water depth (m) from which an iceberg of this radius floats. */
export function floatDraft(radius: number): number {
  return (FLOAT_DRAFT * Math.max(radius, 0)) / BASE_RADIUS;
}

/** Inland water at one point (written by InlandWater.sample). */
export interface InlandWaterSample {
  /** Water surface y; equals groundY where the point is dry. */
  surfaceY: number;
  /** Terrain height at the point. */
  groundY: number;
  /** Current (m/s, horizontal) at the point (slower toward a channel's banks). */
  vx: number;
  vz: number;
  /** Current on the channel's centre line (= vx, vz outside channels, on reservoirs and floods). */
  cvx: number;
  cvz: number;
  /** True inside a stream channel's footprint (between its bank tops). */
  channel: boolean;
  /**
   * True on a stream's outer cut beside the channel (where the ground beside it stands above the
   * bank top, the bank continues up as a cut face). A big iceberg rides over it like the bank.
   */
  cut: boolean;
  /** Index of that stream (for confinement hysteresis); -1 outside channels. */
  stream: number;
  /** Channel frame: unit downstream direction and signed lateral offset (m, + = right of it). */
  dirX: number;
  dirZ: number;
  lat: number;
  /** Half width of the water surface across the channel, and of the channel at its bank tops (m). */
  waterHalf: number;
  topHalf: number;
  /** Bank height above the channel bed (m): what confines an iceberg (isConfinedBy). */
  bank: number;
  /** The water stands at or over the bank tops here (reservoir, flood): no confinement. */
  drowned: boolean;
  /** Still water (a reservoir or a pool end): the slow-drift stuck rule applies while afloat. */
  still: boolean;
}

/** What stepIceberg queries for inland water. Implemented by WaterSystem (src/core/water). */
export interface InlandWater {
  /**
   * Water at (x, z) into `out`. Returns true when the point is in water (surface above the ground),
   * inside a stream channel's footprint (even a dry one) or on its outer cut; false = dry land.
   */
  sample(x: number, z: number, out: InlandWaterSample): boolean;
}

export function createWaterSample(): InlandWaterSample {
  return {
    surfaceY: 0,
    groundY: 0,
    vx: 0,
    vz: 0,
    cvx: 0,
    cvz: 0,
    channel: false,
    cut: false,
    stream: -1,
    dirX: 0,
    dirZ: 1,
    lat: 0,
    waterHalf: 0,
    topHalf: 0,
    bank: 0,
    drowned: false,
    still: false,
  };
}
