import type { IcebergParams, LevelDef, WaterBudget } from '../types';

/**
 * Tuned iceberg parameters. With these, a straight run's terminal (cruising) speed is about
 * 15 m/s on a 0.06 slope and 23 m/s on a 0.09 slope; slopes below ~0.04 (= friction) decelerate.
 */
export const DEFAULT_ICEBERG_PARAMS: IcebergParams = {
  gravity: 9.81, // m/s²
  mass: 30, // tonnes
  radius: 2.2, // m, horizontal collision radius
  launchSpeed: 6, // m/s along the course at spawn
  maxSpeed: 34, // m/s, horizontal speed cap
  friction: 0.038, // Coulomb μ: deceleration μ·g·cosα
  drag: 0.00095, // 1/m: deceleration drag·v²
  maxYawRate: 1.6, // rad/s at full steer
  grip: 4.5, // 1/s: lateral (sideways) velocity decay; the removed speed is lost
  turnPenalty: 0.07, // fraction of speed lost per radian turned at full lock (less for gentle steer)
  stuckSpeed: 2.0, // m/s (the timer only runs while slow AND not picking up speed freely)
  stuckTime: 3.0, // s below stuckSpeed before isStuck()
  graceTime: 3.0, // s after spawn during which the stuck timer cannot run
  airborneDrop: 0.3, // m of ground falling away (vs. a ballistic path) that launches the iceberg
  oceanCurrent: 5, // m/s, current along the course direction once in the ocean
  meltPerMetre: 0, // set per level from LevelDef.water (0 = never melts)
  meltPerRadian: 0,
  minSize: 0.55, // size at 0 ice
  // Chunks breaking off: ice lost = chipPerShock × (shock - chipThreshold), shock in m/s (see
  // IcebergContact.shock). At 30 t: smash a house 9.75 %, fell a pine 3.75 %, bounce off a house at
  // 12 m/s 7.5 %, light rocks 0; at 100 t smashing a house costs 1.9 %.
  chipThreshold: 2.5, // m/s of shock below which hits chip no ice
  chipPerShock: 0.006, // fraction of a full iceberg per m/s of shock above the threshold
  chipMax: 0.35, // most a single hit can chip off
  maxIce: 6, // absorbing glacier ice grows the iceberg up to 6× its starting mass (size cbrt(6) ≈ 1.82)
};

/**
 * Params with the melt rates of a level's water budget: meltPerMetre = 1 / metres and
 * meltPerRadian = turnMetresPerRadian / metres. Returned unchanged when there is no (valid) budget
 * or the params already carry their own non-zero melt rates (explicit overrides win).
 */
export function withWaterBudget(p: IcebergParams, water: WaterBudget | undefined): IcebergParams {
  if (!water || !(water.metres > 0) || !Number.isFinite(water.metres)) return p;
  if (p.meltPerMetre !== 0 || p.meltPerRadian !== 0) return p;
  const t = water.turnMetresPerRadian;
  const turn = t > 0 && Number.isFinite(t) ? t : 0;
  return { ...p, meltPerMetre: 1 / water.metres, meltPerRadian: turn / water.metres };
}

/**
 * Params for a level's own iceberg: radius = params.radius (2.2 m by default) × scale and
 * mass = iceberg.mass. Returned unchanged when the level has none; invalid values are ignored.
 */
export function withLevelIceberg(p: IcebergParams, iceberg: LevelDef['iceberg']): IcebergParams {
  if (!iceberg) return p;
  const { scale, mass } = iceberg;
  const okScale = scale > 0 && Number.isFinite(scale);
  const okMass = mass > 0 && Number.isFinite(mass);
  if (!okScale && !okMass) return p;
  return { ...p, radius: okScale ? p.radius * scale : p.radius, mass: okMass ? mass : p.mass };
}

/**
 * Secondary constants of the movement model that IcebergParams has no field for. Exposed so tools
 * and tests can tweak feel without editing the integrator; stepIceberg takes them as an optional
 * last argument.
 */
export interface IcebergSimTuning {
  /** Rate (1/s) at which the applied steer approaches the input steer. */
  steerResponse: number;
  /** Turn authority at rest as a fraction of maxYawRate (ramps to 1 by `turnFullSpeed`). */
  turnAtRest: number;
  /** Speed (m/s) at which turning reaches full authority. */
  turnFullSpeed: number;
  /** Fractional turn-rate reduction at maxSpeed (starts at `turnHighSpeed`). */
  turnHighSpeedCut: number;
  turnHighSpeed: number;
  /** Rate (1/s) the heading drifts toward the velocity direction when not steering. */
  headingAlign: number;
  /** |steer| above which the drift toward velocity is fully off. */
  alignSteerCutoff: number;
  /** Extra alignment rate (1/s) once heading and velocity disagree by > ~1 rad (after bounces). */
  spinAlign: number;
  /** cos(angle) between heading and velocity at which grip reaches full strength. */
  gripFullAlign: number;
  /** Grip ramps from 0 at `gripMinSpeed` to full at `gripFullSpeed` (m/s). */
  gripMinSpeed: number;
  gripFullSpeed: number;
  /** Fraction of grip engaged with no steer input; full grip from |steer| >= `gripSteerFull`. */
  idleGrip: number;
  gripSteerFull: number;
  /** |grad| above which an uphill face is a wall the iceberg cannot climb. */
  wallSlope: number;
  /** Wall probe distance as a fraction of the radius (ahead of the centre, along velocity). */
  wallProbe: number;
  /** Normal restitution against terrain walls. */
  wallRestitution: number;
  /** Coulomb friction against walls (tangential loss = μ·normal impulse). */
  wallFriction: number;
  /** Acceleration (m/s²) pushing the iceberg off a steep face it ended up on. */
  wallPushAccel: number;
  /** Steering authority while airborne (fraction). */
  airControl: number;
  /** Ballistic lookahead time (s) used to detect crests the iceberg should fly over. */
  launchLookahead: number;
  /** Below this horizontal speed (m/s) crests never launch the iceberg. */
  minLaunchSpeed: number;
  /** Fraction of the vertical impact speed turned into forward speed on landing. */
  landingBoost: number;
  /** Cap (m/s) on the landing boost. */
  landingBoostMax: number;
  /** Ocean: linear drag (1/s) on velocity relative to the current. */
  waterLinearDrag: number;
  /** Ocean: multiplier on params.drag for quadratic water drag. */
  waterQuadDrag: number;
  /** Ocean: grip and steering multipliers. */
  oceanGrip: number;
  oceanSteer: number;
  /** Stuck timer decay rate (s per s) once speed recovers. */
  stuckRecover: number;
  /**
   * A slow iceberg is "recovering", not stuck, while its own acceleration (gravity, friction,
   * steering, walls; smoothed over `stuckAccelWindow` s) exceeds `stuckGainAccel` m/s² and for
   * `stuckBlockHold` s no solid contact (anchored, or at least `stuckBlockMass` t) has cancelled
   * what a step gained. The timer then decays at `stuckGainRecover` s per s instead of growing.
   */
  stuckAccelWindow: number;
  stuckGainAccel: number;
  stuckBlockHold: number;
  stuckBlockMass: number;
  stuckGainRecover: number;
  /** Stuck timer rate (s per s, < 1) while the player wriggles at crawl speed (see crawlPush). */
  stuckWriggleRate: number;
  /**
   * Trap rule (./confinement.ts): the iceberg is trapped when it comes back to within
   * `confineReturn` × (path since) of where it was at least `confineMinAge` s (at most
   * `confineWindow` s) ago after travelling at least `confineMinPath` m, sampled every
   * `confineSample` s. The trap region is that stretch of ground grown by `confineEscape` m; the trap
   * is released after `confineHold` s outside it. Inside, the stuck timer runs whatever the speed and
   * gaining speed only counts as recovering while moving away from the trap; outside, until
   * released, the timer holds instead of draining (rocking in a bowl fails in seconds, not ~30 s).
   */
  confineWindow: number;
  confineSample: number;
  confineMinAge: number;
  confineMinPath: number;
  confineReturn: number;
  confineEscape: number;
  confineHold: number;
  /**
   * Sideways acceleration (m/s²) from full steer at a standstill, fading out by crawlSpeed (m/s):
   * a stopped iceberg can wriggle around what it hit. Wriggled speed never counts as recovering
   * (it stays below stuckSpeed anyway), so steering cannot keep an iceberg alive on flat ground.
   */
  crawlPush: number;
  crawlSpeed: number;
  /** Below this speed (m/s) an iceberg pushed backwards keeps facing forward (no spin-round). */
  backFaceSpeed: number;
  /** |steer| from which turning starts to cost turnPenalty (full cost at full lock). */
  turnCostSteer: number;
  /**
   * Rapid reversal: a hard steer (|steer| >= reversalSteer) to the other side within
   * reversalWindow s of the last hard steer multiplies speed by reversalKeep.
   */
  reversalSteer: number;
  reversalWindow: number;
  reversalKeep: number;
  /**
   * Loose bodies heavier than debrisSideMassMin t (fully from debrisSideMassFull t) take the contact
   * impulse tilted by up to debrisSideKick (tangent/normal ratio) toward the side they sit on (the
   * iceberg gets the opposite), so knocked heavy debris is shoved aside instead of parking ahead.
   */
  debrisSideKick: number;
  debrisSideMassMin: number;
  debrisSideMassFull: number;
  /**
   * Bulldozing. A loose body exchanges momentum with the iceberg once; touching it again within
   * pushWindow s of the last touch, closing no faster than the hardest exchange so far plus
   * pushMaxClosing m/s (a graze does not make a later head-on hit free), or touching a piece of
   * an obstacle the iceberg broke within that time, is PUSHING it, not a new hit. Only pushes on a
   * body that yields are contact.push (no new impact). How far a pushed body yields (0..1) is the
   * larger of:
   * - mass: smoothstep(ploughRatioMin, ploughRatioFull, M / m) (much lighter than the iceberg);
   * - height: 1 − smoothstep(rideOverLow, rideOverHigh, its height (top − bottom) / the iceberg's
   *   contact height): low rubble is ridden over and pressed under, whatever it weighs, even on the
   *   first touch.
   * A fully yielding body costs the iceberg at most pushFriction·g·m/M of deceleration (dragging it
   * along the ground) instead of a fresh J / M every step, no longer holds it back, takes at most
   * pushAccel·m of impulse per second, and is shoved aside by a bow wave tilting its impulse by up
   * to ploughSideKick (tangent/normal). A body that does not yield (heavy and tall) keeps the plain
   * impulse rule, so a small iceberg can still be stopped by heavy rubble.
   */
  pushWindow: number;
  pushMaxClosing: number;
  pushFriction: number;
  pushAccel: number;
  ploughRatioMin: number;
  ploughRatioFull: number;
  rideOverLow: number;
  rideOverHigh: number;
  ploughSideKick: number;
  /** Below this horizontal speed (m/s) changes of the travel direction cost no ice (noise). */
  meltTurnMinSpeed: number;
  /** Rate (1/s) the impact flash decays. */
  impactDecay: number;
  /** Visual tilt smoothing rate (1/s) and lean into turns (rad per rad/s of yaw). */
  tiltRate: number;
  leanGain: number;
  maxLean: number;
  /** Substep when one step would move farther than this (m). */
  maxSubstepTravel: number;
  maxSubsteps: number;
  /** Iceberg-obstacle tangential friction for immovable contacts. */
  contactFriction: number;
  /**
   * Share of the sliding (tangential) speed a scrape along an anchored body adds to the closing
   * speed of its break test (breakClosingSpeed): the hull drags the body's foot along with it.
   */
  breakFriction: number;
  /**
   * Drag of a grown iceberg (size > 1) is params.drag × size^-growthDragExponent: mass grows with
   * volume but drag with area, so a big iceberg carries its speed better (the avalanche). Melting
   * (size < 1) leaves drag unchanged. 0 = off.
   */
  growthDragExponent: number;
}

export const SIM_TUNING: IcebergSimTuning = {
  steerResponse: 8,
  turnAtRest: 0.3,
  turnFullSpeed: 5,
  turnHighSpeedCut: 0.2,
  turnHighSpeed: 20,
  headingAlign: 2.2,
  alignSteerCutoff: 0.3,
  spinAlign: 5,
  gripFullAlign: 0.6,
  gripMinSpeed: 0.5,
  gripFullSpeed: 6,
  idleGrip: 0.3,
  gripSteerFull: 0.35,
  wallSlope: 1.2,
  wallProbe: 0.7,
  wallRestitution: 0.2,
  wallFriction: 0.3,
  wallPushAccel: 12,
  airControl: 0.3,
  launchLookahead: 0.25,
  minLaunchSpeed: 6,
  landingBoost: 0.35,
  landingBoostMax: 7,
  waterLinearDrag: 0.3,
  waterQuadDrag: 4,
  oceanGrip: 0.6,
  oceanSteer: 0.8,
  stuckRecover: 3,
  stuckAccelWindow: 0.3,
  stuckGainAccel: 0.1,
  stuckBlockHold: 0.75,
  stuckBlockMass: 2,
  stuckGainRecover: 1,
  stuckWriggleRate: 0.5,
  confineWindow: 10,
  confineSample: 0.1,
  confineMinAge: 1.5,
  confineMinPath: 4,
  confineReturn: 0.3,
  confineEscape: 4,
  confineHold: 4,
  crawlPush: 1.6,
  crawlSpeed: 2.5,
  backFaceSpeed: 4,
  turnCostSteer: 0.25,
  reversalSteer: 0.6,
  reversalWindow: 0.5,
  reversalKeep: 0.95,
  debrisSideKick: 0.4,
  debrisSideMassMin: 3,
  debrisSideMassFull: 9,
  pushWindow: 1,
  pushMaxClosing: 2,
  pushFriction: 0.6,
  pushAccel: 60,
  ploughRatioMin: 1,
  ploughRatioFull: 2,
  rideOverLow: 0.2,
  rideOverHigh: 0.4,
  ploughSideKick: 0.6,
  meltTurnMinSpeed: 0.5,
  impactDecay: 2.5,
  tiltRate: 7,
  leanGain: 0.14,
  maxLean: 0.22,
  maxSubstepTravel: 0.8,
  maxSubsteps: 8,
  contactFriction: 0.3,
  breakFriction: 0.3,
  growthDragExponent: 1,
};
