import type {
  IcebergContact,
  IcebergParams,
  IcebergState,
  IcebergStepEvent,
  LevelDef,
  ObstacleProxy,
  SteeringInput,
  Terrain,
  Vec3,
} from '../types';
import {
  clamp,
  clamp01,
  damp,
  dampAngle,
  dirToHeading,
  smoothstep,
  steerToYawDelta,
  wrapAngle,
} from '../math';
import { rectGap, rectGyration, rectReach, type RectDirection } from '../proxyRect';
import { DEFAULT_ICEBERG_PARAMS, SIM_TUNING, type IcebergSimTuning } from './params';
import { ConfinementTracker } from './confinement';
import {
  alongLip,
  faceHeight,
  faceOnGrid,
  kickerFace,
  kickerTakeoff,
  type KickerFace,
  type KickerTakeoff,
} from './kicker';
import { gradientInto, type GradientOut } from './surface';
import {
  createWaterSample,
  floatDraft,
  hullCurrent,
  INLAND_FLOAT,
  isConfinedBy,
  type InlandWater,
  type InlandWaterSample,
} from './inlandWater';

/**
 * Iceberg movement integrator and iceberg-vs-obstacle contact solver.
 *
 * State model: `pos` is the BASE of the iceberg (it rests on the ground / floats at sea level).
 * Grounded: horizontal velocity is integrated and y follows the terrain; vel.y is the vertical
 * speed of following the surface over the last step (grad · v within a triangle). Airborne: full
 * ballistic 3D motion.
 * Visual angles: `pitch` > 0 = nose up, `roll` > 0 = right side raised (both radians).
 */

// --- shared collision rule (must match the physics world exactly) ------------------------------

/** Restitution e in the shared iceberg-obstacle impulse rule. */
export const CONTACT_RESTITUTION = 0.25;
/** Obstacles whose top is below pos.y - this are passed over. */
export const CONTACT_BELOW = 0.3;
/** Obstacles whose bottom is above pos.y + this are passed under. */
export const CONTACT_ABOVE = 2.8;
/** Upward part of the impulse given to a loose / breaking obstacle, as a fraction of J. */
export const CONTACT_LIFT = 0.2;

/**
 * J = (1 + e) · vn · M·m / (M + m). Infinite m behaves as a wall (reduced mass M). This is the impulse
 * exchanged with loose bodies, and with anchored ones that give way (so smashing through something
 * costs the same speed as shoving a loose body of its mass).
 */
export function contactTestImpulse(vn: number, icebergMass: number, obstacleMass: number): number {
  if (!(vn > 0)) return 0;
  let reduced: number;
  if (obstacleMass === Infinity) reduced = icebergMass;
  else if (obstacleMass > 0) reduced = (icebergMass * obstacleMass) / (icebergMass + obstacleMass);
  else reduced = 0;
  return (1 + CONTACT_RESTITUTION) * vn * reduced;
}

/**
 * Break test for anchored obstacles: J_test = (1 + e) · vn · M with the iceberg's CURRENT mass, so
 * a heavy iceberg flattens a house at low speed. Compared with ObstacleProxy.breakImpulse.
 */
export function momentumTestImpulse(vn: number, icebergMass: number): number {
  if (!(vn > 0) || !(icebergMass > 0)) return 0;
  return (1 + CONTACT_RESTITUTION) * vn * icebergMass;
}

/**
 * Closing speed an anchored body's break test counts (momentumTestImpulse of it): the normal speed
 * vn plus the share `mu` (SIM_TUNING.breakFriction) of the sliding speed vt that a hull scraping
 * past drags the body's foot along with, never more than the whole relative speed, so a scrape
 * never counts for more than a head-on hit at the same speed (a light or slow iceberg grazing a
 * tower cannot fell what it could not fell head-on). 0 unless the bodies close (vn > 0).
 */
export function breakClosingSpeed(vn: number, vt: number, mu: number = SIM_TUNING.breakFriction): number {
  if (!(vn > 0)) return 0;
  const t = vt > 0 && Number.isFinite(vt) ? vt : 0;
  const k = mu > 0 ? mu : 0;
  return Math.min(vn + k * t, Math.hypot(vn, t));
}

/**
 * Fraction of the iceberg's current ice a hit of `shock` m/s chips off:
 * chipPerShock·(shock − threshold), capped at chipMax.
 */
export function chipAmount(shock: number, p: IcebergParams): number {
  if (!(p.chipPerShock > 0) || !(shock > p.chipThreshold)) return 0;
  const v = Math.min(p.chipPerShock * (shock - p.chipThreshold), p.chipMax);
  return v > 0 ? v : 0;
}

/** Largest ice ratio allowed by the params (at least 1). */
function maxIceOf(p: IcebergParams): number {
  return p.maxIce > 1 ? p.maxIce : 1;
}

/** True while absorbing glacier ice can still grow the iceberg (ice < params.maxIce). */
export function canGrow(s: IcebergState, p: IcebergParams): boolean {
  return s.ice < maxIceOf(p);
}

/** Size multiplier for an ice ratio: minSize + (1 − minSize)·ice up to 1, cbrt(ice) above. */
export function sizeForIce(ice: number, p: IcebergParams): number {
  return ice > 1 ? Math.cbrt(ice) : p.minSize + (1 - p.minSize) * ice;
}

/** Obstacles whose bottom is above pos.y + this are passed under (a bigger iceberg is taller). */
function contactAbove(s: IcebergState): number {
  const k = s.radius / DEFAULT_ICEBERG_PARAMS.radius;
  return k > 1 ? CONTACT_ABOVE * k : CONTACT_ABOVE;
}

function inContactBand(s: IcebergState, o: ObstacleProxy): boolean {
  if (o.passable) return false;
  return !(o.top < s.pos.y - CONTACT_BELOW || o.bottom > s.pos.y + contactAbove(s));
}

/** Output of proxyGap: unit direction from the query point toward the body. */
export interface ProxyDirection {
  nx: number;
  nz: number;
}

/**
 * Signed horizontal distance from (x, z) to the edge of a proxy's footprint: its rect when it has
 * one (ObstacleProxy.rect), else its circle; negative inside. Writes the unit direction from the
 * point toward the body into `out` (toward the nearest face from inside a rect; (0, 0) exactly
 * on a circle's centre).
 */
export function proxyGap(x: number, z: number, o: ObstacleProxy, out: ProxyDirection): number {
  const dx = o.x - x;
  const dz = o.z - z;
  const r = o.rect;
  if (!r) {
    const d = Math.hypot(dx, dz);
    if (d > 1e-6) {
      out.nx = dx / d;
      out.nz = dz / d;
    } else {
      out.nx = 0;
      out.nz = 0;
    }
    return d - o.radius;
  }
  // The point in the rect's frame (u along its axis, v = (-uz, ux) across it); a skewed one is
  // its quadrilateral (../proxyRect.ts).
  const lu = -(dx * r.ux + dz * r.uz);
  const lv = dx * r.uz - dz * r.ux;
  const gap = rectGap(lu, lv, r, rdir);
  out.nx = rdir.nu * r.ux - rdir.nv * r.uz;
  out.nz = rdir.nu * r.uz + rdir.nv * r.ux;
  return gap;
}

const rdir: RectDirection = { nu: 0, nv: 0 };

const dir: ProxyDirection = { nx: 0, nz: 0 };

/**
 * Ids of absorbable proxies (glacier ice) the iceberg overlaps, written into `out` (cleared first);
 * none once it cannot grow any more. Returns the count.
 */
export function collectAbsorbable(
  s: IcebergState,
  proxies: readonly ObstacleProxy[],
  out: number[],
  p: IcebergParams = DEFAULT_ICEBERG_PARAMS,
): number {
  out.length = 0;
  if (!canGrow(s, p)) return 0;
  for (let i = 0; i < proxies.length; i++) {
    const o = proxies[i];
    if (!o.absorbable || !inContactBand(s, o)) continue;
    // Its footprint (a long block's rectangle, not its bounding circle) has to touch the iceberg.
    if (proxyGap(s.pos.x, s.pos.z, o, dir) < s.radius) out.push(o.id);
  }
  return out.length;
}

/**
 * Merge `mass` t of glacier ice moving at `vel` into the iceberg: horizontal momentum is conserved
 * (absorbing still ice slows it), ice/mass/size/radius grow. Only what fits under params.maxIce is
 * merged; returns the tonnes merged (0 when full or for an invalid mass).
 */
export function absorbIce(s: IcebergState, mass: number, vel: Vec3, p: IcebergParams): number {
  if (!(mass > 0) || !Number.isFinite(mass) || !(p.mass > 0)) return 0;
  const maxIce = maxIceOf(p);
  const room = (maxIce - s.ice) * p.mass;
  const m = Math.min(mass, room);
  if (!(m > 0)) return 0;
  const M = s.ice * p.mass;
  const ux = Number.isFinite(vel.x) ? vel.x : 0;
  const uz = Number.isFinite(vel.z) ? vel.z : 0;
  s.vel.x = (M * s.vel.x + m * ux) / (M + m);
  s.vel.z = (M * s.vel.z + m * uz) / (M + m);
  setIce(s, m === room ? maxIce : s.ice + m / p.mass, p);
  return m;
}

/** Options for resolveIcebergContacts. */
export interface ContactOptions {
  /**
   * Leave absorbable proxies (glacier ice) to absorption while the iceberg can still grow (default
   * true). False, or once at maxIce, they collide like any loose body.
   */
  absorbing?: boolean;
  /** When given, separation never shoves a grounded iceberg up a face too steep to climb. */
  terrain?: Terrain;
}

// --- per-iceberg hidden state -------------------------------------------------------------------

interface SimExtras {
  oceanEventSent: boolean;
  /** Cached unit course direction used for the ocean current. */
  curX: number;
  curZ: number;
  curAge: number;
  /** Horizontal speed at the start of the current step, i.e. after the last obstacle contacts. */
  hsStart: number;
  /** Smoothed acceleration (m/s²) produced by the integrator alone (obstacle contacts excluded). */
  accel: number;
  /** Speed (m/s) the crawl push may have added this step; true if the player wriggled this step. */
  crawlGain: number;
  wriggled: boolean;
  /** Seconds since a solid obstacle contact last cancelled what a step gained (pinned / hit). */
  sinceBlocked: number;
  /** Side (-1/1, 0 = none) of the last hard steer and seconds since it was last hard. */
  hardSign: number;
  hardAge: number;
  /** Last fully finite state, restored if a step ever produces NaN/Infinity. */
  good: { px: number; py: number; pz: number; vx: number; vy: number; vz: number; heading: number };
  /** Simulated seconds (sum of stepIceberg dt) and the last step's dt: the contact solver's clock. */
  clock: number;
  stepDt: number;
  /**
   * Obstacles (origin ids) the iceberg touched or broke recently, when (clock), and the hardest
   * closing speed it exchanged momentum with them at (Infinity once broken: its pieces are always
   * pushed). Touching one again within SIM_TUNING.pushWindow, no harder than that (plus
   * pushMaxClosing), is pushing it. A small ring; -1 = free slot.
   */
  touchIds: Int32Array;
  touchAt: Float64Array;
  touchHit: Float64Array;
}

/** Obstacles remembered for bulldozing (a pile of rubble rarely touches more than a dozen at once). */
const TOUCH_SLOTS = 24;

const extrasMap = new WeakMap<IcebergState, SimExtras>();

const finiteOr = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);

function extrasFor(s: IcebergState): SimExtras {
  let ex = extrasMap.get(s);
  if (!ex) {
    ex = {
      oceanEventSent: false,
      curX: Math.sin(s.heading) || 0,
      curZ: Math.cos(s.heading) || 1,
      curAge: 0,
      hsStart: 0,
      accel: 0,
      crawlGain: 0,
      wriggled: false,
      sinceBlocked: Infinity,
      hardSign: 0,
      hardAge: Infinity,
      // Seeded from the state itself so a state that is already broken on its very first step
      // recovers where it is rather than at the world origin.
      good: {
        px: finiteOr(s.pos.x, 0),
        py: finiteOr(s.pos.y, 0),
        pz: finiteOr(s.pos.z, 0),
        vx: finiteOr(s.vel.x, 0),
        vy: finiteOr(s.vel.y, 0),
        vz: finiteOr(s.vel.z, 0),
        heading: finiteOr(s.heading, 0),
      },
      clock: 0,
      stepDt: 0,
      touchIds: new Int32Array(TOUCH_SLOTS).fill(-1),
      touchAt: new Float64Array(TOUCH_SLOTS),
      touchHit: new Float64Array(TOUCH_SLOTS),
    };
    extrasMap.set(s, ex);
  }
  return ex;
}

/**
 * Hardest closing speed (m/s) the iceberg exchanged momentum with obstacle `origin` at within the
 * last `window` s (Infinity if it broke it), or -1 if it has not touched it in that time.
 */
function recentHit(ex: SimExtras, origin: number, window: number): number {
  const ids = ex.touchIds;
  for (let i = 0; i < TOUCH_SLOTS; i++) {
    if (ids[i] === origin) return ex.clock - ex.touchAt[i] <= window ? ex.touchHit[i] : -1;
  }
  return -1;
}

/**
 * Remember touching `origin` now after exchanging momentum at closing speed `hit` (Infinity: it
 * broke). A remembered entry is refreshed, keeping its hardest hit while it is still recent; else
 * the stalest entry is replaced.
 */
function rememberTouch(ex: SimExtras, origin: number, hit: number, window: number): void {
  const ids = ex.touchIds;
  let slot = 0;
  for (let i = 0; i < TOUCH_SLOTS; i++) {
    if (ids[i] === origin) {
      slot = i;
      break;
    }
    if (ids[i] < 0 || ex.touchAt[i] < ex.touchAt[slot]) slot = i;
    if (ids[slot] < 0) break;
  }
  const kept = ids[slot] === origin && ex.clock - ex.touchAt[slot] <= window ? ex.touchHit[slot] : 0;
  ids[slot] = origin;
  ex.touchAt[slot] = ex.clock;
  ex.touchHit[slot] = Math.max(kept, hit);
}

// --- scratch (hot path is allocation-free except for emitted events) ---------------------------

const grad: GradientOut = { dx: 0, dz: 0 };
const grad2: GradientOut = { dx: 0, dz: 0 };
const grad3: GradientOut = { dx: 0, dz: 0 };
const kick: KickerTakeoff = { vy: 0, scale: 1 };
const face: KickerFace = { kicker: null, lipY: 0, slope: 0, curve: 0, cross: 0 };
let pending: IcebergStepEvent[] | null = null;

const NO_EVENTS = Object.freeze([]) as unknown as IcebergStepEvent[];
const NO_CONTACTS = Object.freeze([]) as unknown as IcebergContact[];

/** Extra drop (m) beyond a wallSlope descent that marks a step as going over a cliff lip. */
const LIP_TOLERANCE = 0.02;

/** Probe directions relative to the velocity: straight ahead and ±0.6 rad. */
const PROBE_COS = [1, Math.cos(0.6), Math.cos(0.6)];
const PROBE_SIN = [0, Math.sin(0.6), -Math.sin(0.6)];

function emit(e: IcebergStepEvent): void {
  if (pending) pending.push(e);
  else pending = [e];
}

// --- public API ---------------------------------------------------------------------------------

/** Spawn on the ground at the level start, facing down-course with `launchSpeed`. */
export function createIceberg(
  terrain: Terrain,
  params: IcebergParams = DEFAULT_ICEBERG_PARAMS,
): IcebergState {
  const level = terrain.level;
  const start = terrain.course.toWorld(level.startS, 0);
  const cs = terrain.course.sampleAt(level.startS);
  let dx = cs.dirX;
  let dz = cs.dirZ;
  const dl = Math.hypot(dx, dz);
  if (dl > 1e-9 && Number.isFinite(dl)) {
    dx /= dl;
    dz /= dl;
  } else {
    dx = 0;
    dz = 1;
  }
  const ground = terrain.heightAt(start.x, start.z);
  const ocean = terrain.isOcean(start.x, start.z);
  const y = ocean ? Math.max(ground, level.seaLevel) : ground;
  const vx = dx * params.launchSpeed;
  const vz = dz * params.launchSpeed;
  gradientInto(terrain.grid, start.x, start.z, grad);
  const heading = dirToHeading(dx, dz);
  const fwdSlope = grad.dx * dx + grad.dz * dz;
  const latSlope = -grad.dx * dz + grad.dz * dx;
  return {
    pos: { x: start.x, y, z: start.z },
    vel: { x: vx, y: ocean ? 0 : grad.dx * vx + grad.dz * vz, z: vz },
    heading,
    steer: 0,
    yawRate: 0,
    grounded: true,
    airTime: 0,
    airPeakY: y,
    inOcean: ocean,
    stuckTimer: 0,
    pitch: ocean ? 0 : Math.atan(fwdSlope),
    roll: ocean ? 0 : Math.atan(latSlope),
    impact: 0,
    radius: params.radius,
    mass: params.mass,
    ice: 1,
    size: 1,
  };
}

/** 0..1: how close the stuck timer is to failing the run. */
export function stuckFraction(s: IcebergState, p: IcebergParams): number {
  if (!(p.stuckTime > 0)) return s.stuckTimer > 0 ? 1 : 0;
  return clamp01(s.stuckTimer / p.stuckTime);
}

/** True once the iceberg has been too slow for `stuckTime` seconds; the session fails the run. */
export function isStuck(s: IcebergState, p: IcebergParams): boolean {
  return s.stuckTimer > 0 && s.stuckTimer >= p.stuckTime;
}

/** True while the stuck rule considers the iceberg trapped (rocking or circling in one spot). */
export function isTrapped(s: IcebergState): boolean {
  return trapMap.get(s)?.inside ?? false;
}

/** True once all the ice has melted into river; the session fails the run ('melted'). */
export function isMelted(s: IcebergState): boolean {
  return s.ice <= 0;
}

/**
 * Set the ice ratio (clamped to 0..params.maxIce) and derive size, collision radius and mass from
 * it: size = sizeForIce(ice) (minSize..1 while melting, cbrt(ice) when grown), radius =
 * params.radius × size, mass = params.mass × ice. A non-number counts as full ice (1) so a bad value
 * can never fail a run on its own.
 */
export function setIce(s: IcebergState, ice: number, p: IcebergParams): void {
  const v = ice === ice ? clamp(ice, 0, maxIceOf(p)) : 1;
  s.ice = v;
  s.size = sizeForIce(v, p);
  s.radius = p.radius * s.size;
  s.mass = p.mass * v;
}

/**
 * Advance the iceberg by dt (mutates `s`). `elapsed` is play time since spawn (for graceTime).
 * Melting: on land (grounded, not in the ocean, not afloat) ice drains by meltPerMetre per
 * horizontal metre plus meltPerRadian per radian of net change of the travel direction; size/radius
 * follow ice. `water` (levels with streams): inland water the iceberg floats on, is carried by, and
 * is held in a stream channel by (see inlandStep). Returns events for this step; when there are
 * none it returns a shared frozen empty array, so callers must only iterate the result, never
 * mutate it.
 */
export function stepIceberg(
  s: IcebergState,
  input: SteeringInput,
  terrain: Terrain,
  dt: number,
  p: IcebergParams,
  elapsed: number,
  tuning: IcebergSimTuning = SIM_TUNING,
  water?: InlandWater,
): IcebergStepEvent[] {
  if (!(dt > 0) || !Number.isFinite(dt)) return NO_EVENTS;
  const T = tuning;
  const ex = extrasFor(s);
  if (stateFinite(s)) saveGood(ex, s);
  else restoreGood(ex, s);
  pending = null;
  ex.hsStart = Math.hypot(s.vel.x, s.vel.z);
  ex.crawlGain = 0;
  ex.wriggled = false;
  ex.clock += dt;
  ex.stepDt = dt;

  const raw = input ? input.steer : 0;
  const steerIn = Number.isFinite(raw) ? clamp(raw, -1, 1) : 0;
  const headingBefore = s.heading;
  const travel = Math.hypot(s.vel.x, s.vel.y, s.vel.z) * dt;
  const n =
    travel > T.maxSubstepTravel ? Math.min(T.maxSubsteps, Math.ceil(travel / T.maxSubstepTravel)) : 1;
  const h = dt / n;
  const melting = p.meltPerMetre > 0 || p.meltPerRadian > 0;
  const onLandBefore = s.grounded && !s.inOcean && !s.afloat;
  const vx0 = s.vel.x;
  const vz0 = s.vel.z;
  let landTravel = 0;

  for (let i = 0; i < n; i++) {
    const x0 = s.pos.x;
    const z0 = s.pos.z;
    const onLand = s.grounded && !s.inOcean && !s.afloat;
    if (s.inOcean) oceanStep(s, steerIn, terrain, h, p, T, ex);
    else if (!s.grounded) airStep(s, steerIn, terrain, h, p, T, water);
    else if (water) inlandStep(s, steerIn, terrain, h, p, T, ex, water);
    else groundStep(s, steerIn, terrain, h, p, T, ex);
    keepInBounds(s, terrain.level.bounds);
    if (!s.inOcean) keepAboveGround(s, terrain);
    if (melting && onLand) landTravel += Math.hypot(s.pos.x - x0, s.pos.z - z0);
  }

  if (s.inOcean && !ex.oceanEventSent) {
    ex.oceanEventSent = true;
    emit({ type: 'enteredOcean', pos: { x: s.pos.x, y: s.pos.y, z: s.pos.z } });
  }

  s.yawRate = wrapAngle(s.heading - headingBefore) / dt;
  updateStuck(s, p, T, dt, elapsed, ex);
  updateVisuals(s, terrain, T, dt);
  if (!stateFinite(s)) restoreGood(ex, s);

  let drain = 0;
  if (melting) {
    drain = p.meltPerMetre * landTravel;
    // Net turning: how far the travel direction swung over the whole step on land (contacts are
    // resolved between steps and already cost speed, so they are not charged twice).
    if (onLandBefore && s.grounded && !s.inOcean && !s.afloat && p.meltPerRadian > 0) {
      const vx1 = s.vel.x;
      const vz1 = s.vel.z;
      const slow = T.meltTurnMinSpeed;
      if (vx0 * vx0 + vz0 * vz0 >= slow * slow && vx1 * vx1 + vz1 * vz1 >= slow * slow) {
        drain += p.meltPerRadian * Math.abs(Math.atan2(vx0 * vz1 - vz0 * vx1, vx0 * vx1 + vz0 * vz1));
      }
    }
  }
  setIce(s, drain > 0 ? s.ice - drain : s.ice, p);

  const out = pending;
  pending = null;
  return out ?? NO_EVENTS;
}

/** dt assumed by the contact solver before the iceberg has taken a step (tests). */
const DEFAULT_CONTACT_DT = 1 / 60;

/**
 * How far a loose body yields to the iceberg (0..1, see IcebergSimTuning.pushWindow): how low it
 * is against the iceberg's height (ridden over), and, while the iceberg is pushing it, also how
 * much lighter than the iceberg it is (shoved aside), whichever is larger.
 */
export function debrisYield(
  s: IcebergState,
  o: ObstacleProxy,
  M: number,
  pushing: boolean,
  T: IcebergSimTuning = SIM_TUNING,
): number {
  const low = 1 - smoothstep(T.rideOverLow, T.rideOverHigh, (o.top - o.bottom) / contactAbove(s));
  if (!pushing) return low;
  const plough = o.mass > 0 ? smoothstep(T.ploughRatioMin, T.ploughRatioFull, M / o.mass) : 1;
  return Math.max(plough, low);
}

/**
 * Resolve iceberg-vs-obstacle overlaps with the shared impulse rule. Mutates the iceberg's
 * velocity (and position, for immovable bodies) and returns one contact per closing obstacle;
 * returns a shared frozen empty array when nothing was hit. Bodies collide as their footprint
 * rectangle when they have one (ObstacleProxy.rect), else as their circle.
 *
 * Anchored obstacles break iff momentumTestImpulse (J_test = (1+e)·v·M) >= breakImpulse, where v
 * is breakClosingSpeed: the normal closing speed plus the friction share of a glancing scrape
 * (contact.testImpulse carries J_test); when one gives way the iceberg's velocity change is the
 * loose-body impulse contactTestImpulse (closing speed vn), otherwise it bounces as off a wall.
 * Several that break at once (a seam between dam monoliths) are resolved together first
 * (breakTogether).
 * contact.shock is how hard the hit was on the ice (m/s): (1+e)·vn when it bounces,
 * breakImpulse / M when the obstacle gives way, J / M for loose bodies.
 *
 * Loose bodies exchange J once. Touching one again within SIM_TUNING.pushWindow of the last touch
 * (no harder than that exchange plus pushMaxClosing), or touching a piece of an obstacle broken
 * within that time (ObstacleProxy.origin), is pushing it: the iceberg ploughs through rubble that
 * yields (debrisYield) for the friction of dragging it instead of paying J / M every step, and
 * shoves it aside (contact.push). Low rubble yields even on the first touch (ridden over). A long
 * body touched off its centre meets the iceberg with its mass at that point (leverMass).
 */
export function resolveIcebergContacts(
  s: IcebergState,
  proxies: readonly ObstacleProxy[],
  p: IcebergParams,
  opts?: ContactOptions,
): IcebergContact[] {
  const M = s.mass > 0 ? s.mass : p.mass;
  const e = CONTACT_RESTITUTION;
  const T = SIM_TUNING;
  const leaveAbsorbable = (opts?.absorbing ?? true) && canGrow(s, p);
  const terrain = opts?.terrain;
  const ex = extrasFor(s);
  const dt = ex.stepDt > 0 ? ex.stepDt : DEFAULT_CONTACT_DT;
  transmitted.length = 0;
  let out = breakTogether(s, proxies, M, ex, terrain);
  let blocking = out !== null;
  for (let i = 0; i < proxies.length; i++) {
    const o = proxies[i];
    if (o.absorbable && leaveAbsorbable) continue;
    // Already broken in this call (together with another, or through debris pressed against it).
    if (o.anchored && transmitted.includes(o.id)) continue;
    if (!inContactBand(s, o)) continue;
    const depth = s.radius - proxyGap(s.pos.x, s.pos.z, o, dir);
    if (!(depth > 0)) continue;

    let nx = dir.nx;
    let nz = dir.nz;
    if (nx === 0 && nz === 0) {
      const hs = Math.hypot(s.vel.x, s.vel.z);
      if (hs > 1e-6) {
        nx = s.vel.x / hs;
        nz = s.vel.z / hs;
      } else {
        nx = Math.sin(s.heading);
        nz = Math.cos(s.heading);
      }
    }

    const ovx = Number.isFinite(o.vx) ? o.vx : 0;
    const ovz = Number.isFinite(o.vz) ? o.vz : 0;
    const vn = (s.vel.x - ovx) * nx + (s.vel.z - ovz) * nz;
    if (!(vn > 0)) {
      if (o.anchored) separate(s, nx, nz, depth, terrain);
      continue;
    }

    const hsBefore = Math.hypot(s.vel.x, s.vel.z);
    const origin = o.origin ?? o.id;
    let J: number;
    let testImpulse: number;
    let shock: number;
    let push = false;
    let ix: number;
    let iy: number;
    let iz: number;
    if (o.anchored) {
      J = contactTestImpulse(vn, M, o.mass);
      // A glancing hull also drags the body's foot along: the test counts the scrape (the speed
      // the iceberg slides past at, vt), the exchange below stays the loose-body rule.
      const vt = Math.hypot(s.vel.x - ovx - vn * nx, s.vel.z - ovz - vn * nz);
      testImpulse = momentumTestImpulse(breakClosingSpeed(vn, vt, T.breakFriction), M);
      const breaks = testImpulse >= o.breakImpulse;
      if (!breaks || o.mass >= T.stuckBlockMass) blocking = true;
      if (breaks) {
        // It gives way: the iceberg pays the loose-body impulse for its mass and backs out of its
        // share of the overlap; its pieces are then pushed, not hit afresh (rememberTouch).
        // The ice takes only what the obstacle pushes back with: its strength.
        shock = Math.max(0, o.breakImpulse) / M;
        s.vel.x -= (J / M) * nx;
        s.vel.z -= (J / M) * nz;
        ix = J * nx;
        iy = CONTACT_LIFT * J;
        iz = J * nz;
        const m = o.mass;
        separate(s, nx, nz, depth * (m === Infinity ? 1 : m > 0 ? m / (M + m) : 0), terrain);
        rememberTouch(ex, origin, Infinity, T.pushWindow);
        transmitted.push(o.id);
      } else {
        // Immovable: reflect the relative normal velocity, Coulomb friction on the tangent. The
        // ice takes all of the bounce.
        shock = (1 + e) * vn;
        s.vel.x -= (1 + e) * vn * nx;
        s.vel.z -= (1 + e) * vn * nz;
        const rvx = s.vel.x - ovx;
        const rvz = s.vel.z - ovz;
        const rn = rvx * nx + rvz * nz;
        const tx = rvx - rn * nx;
        const tz = rvz - rn * nz;
        const ts = Math.hypot(tx, tz);
        if (ts > 1e-9) {
          const k = Math.max(0, ts - T.contactFriction * (1 + e) * vn) / ts;
          s.vel.x = ovx + rn * nx + tx * k;
          s.vel.z = ovz + rn * nz + tz * k;
        }
        ix = J * nx;
        iy = 0;
        iz = J * nz;
        separate(s, nx, nz, depth, terrain);
      }
    } else {
      const m = o.mass;
      // The mass it meets the iceberg with: all of it, or less where a long body also turns.
      const mx = o.rect ? leverMass(s, o, nx, nz, depth) : m;
      J = contactTestImpulse(vn, M, mx);
      testImpulse = J;
      // Pieces of something it broke are pushed however fast it meets them; a body it only hit
      // is pushed while it closes no faster than it was already hit (it is riding along, or
      // jammed), so a graze does not make the head-on hit that follows a free one.
      const hit = recentHit(ex, origin, T.pushWindow);
      const pushing = hit >= 0 && vn <= hit + T.pushMaxClosing;
      const give = debrisYield(s, o, M, pushing, T);
      push = pushing && give > 0;
      let dv = J / M;
      let jo = J;
      if (give > 0) {
        // Bulldozing: dragging the body costs at most its ground friction, and it is shoved with at
        // most pushAccel (a body jammed in a pile would otherwise take J every step).
        const drag = Math.min(dv, (T.pushFriction * p.gravity * dt * m) / M);
        dv += (drag - dv) * give;
        jo += (Math.min(J, T.pushAccel * dt * m) - J) * give;
      }
      // Heavy debris glances off, and a pushed body that yields is shoved aside (bow wave): the
      // impulse is tilted away from the tangential relative velocity, so the body leaves the
      // iceberg's line (the iceberg veers the other way) instead of stopping just ahead of it.
      let jx = nx;
      let jz = nz;
      const heavy = T.debrisSideKick * smoothstep(T.debrisSideMassMin, T.debrisSideMassFull, m);
      const tilt = Math.max(heavy, T.ploughSideKick * give);
      if (tilt > 0) {
        let tx = s.vel.x - ovx - vn * nx;
        let tz = s.vel.z - ovz - vn * nz;
        let tl = Math.hypot(tx, tz);
        if (!(tl > 1e-6) && give > 0) {
          // Dead ahead: shove it to a side of its own (deterministic per body).
          const side = o.id % 2 === 0 ? 1 : -1;
          tx = -nz * side;
          tz = nx * side;
          tl = 1;
        }
        if (tl > 1e-6) {
          jx -= (tilt * tx) / tl;
          jz -= (tilt * tz) / tl;
          const jl = Math.hypot(jx, jz);
          jx /= jl;
          jz /= jl;
        }
      }
      s.vel.x -= dv * jx;
      s.vel.z -= dv * jz;
      // A glancing contact tilted against the iceberg's sideways motion must not speed it up.
      const hs = Math.hypot(s.vel.x, s.vel.z);
      if (hs > hsBefore) {
        s.vel.x *= hsBefore / hs;
        s.vel.z *= hsBefore / hs;
      }
      ix = jo * jx;
      iy = CONTACT_LIFT * jo;
      iz = jo * jz;
      // The ice takes what it actually lost: the exchanged J / M, or the drag of rubble that yields.
      shock = dv;
      if ((1 - give) * m >= T.stuckBlockMass) blocking = true;
      // Share of the overlap the iceberg backs out of (heavy debris pinned against terrain must
      // not be driven through; rubble that yields is ridden over); the physics world moves the
      // body itself.
      const share = mx === Infinity ? 1 : mx > 0 ? (1 - give) * (mx / (M + mx)) : 0;
      separate(s, nx, nz, depth * share, terrain);
      rememberTouch(ex, origin, pushing ? 0 : vn, T.pushWindow);
    }

    const speedLoss = hsBefore - Math.hypot(s.vel.x, s.vel.z);
    const shove = Math.hypot(ix, iz);
    s.impact = Math.max(s.impact, clamp01(0.1 + Math.max(0, speedLoss) / 6 + shove / (M * 25)));
    const contact: IcebergContact = {
      obstacleId: o.id,
      impulse: { x: ix, y: iy, z: iz },
      point: {
        x: s.pos.x + nx * s.radius,
        y: clamp(s.pos.y + 1.2, Math.min(o.bottom, o.top), Math.max(o.bottom, o.top)),
        z: s.pos.z + nz * s.radius,
      },
      normal: { x: nx, y: 0, z: nz },
      relSpeed: vn,
      speedLoss,
      testImpulse,
      shock,
    };
    if (push) contact.push = true;
    if (out) out.push(contact);
    else out = [contact];
    if (!o.anchored) {
      const behind = pressedInto(s, o, nx, nz, proxies, M, ex);
      if (behind) out.push(behind);
    }
  }
  // Blocked: a solid contact cancelled everything this step gained (pinned, or just hit). Sliding
  // along a body while still speeding up is not blocked.
  if (blocking && Math.hypot(s.vel.x, s.vel.z) <= ex.hsStart + 1e-4) ex.sinceBlocked = 0;
  transmitted.length = 0;
  return out ?? NO_CONTACTS;
}

/**
 * The mass a long loose body (a rect proxy) meets the iceberg with where it is touched: a push off
 * its centre also turns it, so only m / (1 + m·r⊥² / I) resists (I = m (hu² + hv²) / 3, a uniform
 * slab about the vertical, a little more for skewed ends: rectGyration; r⊥ = lever arm of the
 * contact normal about its centre). Exchanging J with this mass keeps the energy the push gives its
 * spin plus its motion within what the iceberg loses, so the far end of a long body is never flung
 * faster than a free body would be.
 */
export function leverMass(s: IcebergState, o: ObstacleProxy, nx: number, nz: number, depth: number): number {
  const r = o.rect;
  if (!r || !(o.mass > 0) || !(o.mass < Infinity)) return o.mass;
  const reach = s.radius - depth;
  const rx = s.pos.x + nx * reach - o.x;
  const rz = s.pos.z + nz * reach - o.z;
  const lever = rx * nz - rz * nx;
  return o.mass / (1 + (lever * lever) / rectGyration(r));
}

/** Share (0.2..1) of a standing body's width the iceberg spans: along its rectangle's long axis. */
function spanShare(s: IcebergState, o: ObstacleProxy): number {
  const r = o.rect;
  if (!r) return 1;
  const lu = (s.pos.x - o.x) * r.ux + (s.pos.z - o.z) * r.uz;
  const span = Math.min(lu + s.radius, r.hu) - Math.max(lu - s.radius, -r.hu);
  return clamp(span / (2 * r.hu), 0.2, 1);
}

/**
 * Standing bodies breaking together in this call: proxy, normal, closing speed, the momentum test
 * it passed, depth, mass.
 */
interface Together {
  o: ObstacleProxy;
  nx: number;
  nz: number;
  vn: number;
  test: number;
  depth: number;
  m: number;
}
const together: Together[] = [];
/**
 * A standing body within this many metres of the iceberg breaks together with the one it hits even
 * when it is not in its path (see breakTogether for those that are).
 */
const TOGETHER_REACH = 1;

/**
 * Standing bodies the iceberg breaks at once, like two dam monoliths hit at or near their seam,
 * or a monolith narrower than the iceberg and its neighbours: at least one it overlaps, plus any
 * it is about to run into (in its path) or within TOGETHER_REACH of. Each is tested with the
 * iceberg's full momentum along its own normal (one after the other, the first took so much speed
 * that the second held and pinned the iceberg in a half-open breach), and together they cost one
 * loose-body exchange with the mass of the parts the iceberg spans (each body's mass × spanShare),
 * shared out by that mass: a seam hit costs about what a hit on the middle of one monolith does.
 * Returns their contacts and lists them in `transmitted`, or null (nothing done) unless at least
 * two break.
 */
function breakTogether(
  s: IcebergState,
  proxies: readonly ObstacleProxy[],
  M: number,
  ex: SimExtras,
  terrain: Terrain | undefined,
): IcebergContact[] | null {
  together.length = 0;
  const speed = Math.hypot(s.vel.x, s.vel.z);
  if (!(speed > 1e-3)) return null;
  const fx = s.vel.x / speed;
  const fz = s.vel.z / speed;
  let touching = false;
  for (let i = 0; i < proxies.length; i++) {
    const o = proxies[i];
    if (!o.anchored || !(o.breakImpulse < Infinity) || !(o.mass < Infinity)) continue;
    if (!inContactBand(s, o)) continue;
    const gap = proxyGap(s.pos.x, s.pos.z, o, dir);
    const depth = s.radius - gap;
    let nx = dir.nx;
    let nz = dir.nz;
    if (nx === 0 && nz === 0) continue;
    if (!(depth > 0)) {
      // Not touched yet: it joins if the iceberg is about to run into it, i.e. it lies in the
      // iceberg's path (its nearest point ahead, within a radius of the line of travel, less than
      // a diameter from the centre); then it is met head-on at the iceberg's speed.
      const ahead = gap * (nx * fx + nz * fz);
      const aside = Math.abs(gap * (nz * fx - nx * fz));
      if (!(ahead >= 0 && aside < s.radius && gap < 2 * s.radius) && !(depth > -TOGETHER_REACH)) continue;
      nx = fx;
      nz = fz;
    }
    const vn = s.vel.x * nx + s.vel.z * nz;
    // The same test as a lone hit, scrape included (none for one met head-on in the path).
    const vt = Math.abs(s.vel.z * nx - s.vel.x * nz);
    const test = momentumTestImpulse(breakClosingSpeed(vn, vt, SIM_TUNING.breakFriction), M);
    if (!(test >= o.breakImpulse)) continue;
    together.push({ o, nx, nz, vn, test, depth, m: Math.max(0, o.mass) * spanShare(s, o) });
    if (depth > 0) touching = true;
  }
  if (together.length < 2 || !touching) return null;
  const T = SIM_TUNING;
  let mc = 0;
  for (const t of together) mc += t.m;
  const hsBefore = Math.hypot(s.vel.x, s.vel.z);
  const out: IcebergContact[] = [];
  let paid = 0;
  for (const t of together) {
    // Its share of one exchange with all of them: (1 + e)·vn·M·m / (M + Σm).
    const J = (1 + CONTACT_RESTITUTION) * t.vn * ((M * t.m) / (M + mc));
    paid += J;
    out.push({
      obstacleId: t.o.id,
      impulse: { x: J * t.nx, y: CONTACT_LIFT * J, z: J * t.nz },
      point: {
        x: s.pos.x + t.nx * s.radius,
        y: clamp(s.pos.y + 1.2, Math.min(t.o.bottom, t.o.top), Math.max(t.o.bottom, t.o.top)),
        z: s.pos.z + t.nz * s.radius,
      },
      normal: { x: t.nx, y: 0, z: t.nz },
      relSpeed: t.vn,
      speedLoss: 0,
      testImpulse: t.test,
      shock: Math.max(0, t.o.breakImpulse) / M,
    });
  }
  for (const t of together) {
    const J = (1 + CONTACT_RESTITUTION) * t.vn * ((M * t.m) / (M + mc));
    s.vel.x -= (J / M) * t.nx;
    s.vel.z -= (J / M) * t.nz;
    separate(s, t.nx, t.nz, t.depth * (t.m / (M + mc)), terrain);
    rememberTouch(ex, t.o.origin ?? t.o.id, Infinity, T.pushWindow);
    transmitted.push(t.o.id);
  }
  const lost = hsBefore - Math.hypot(s.vel.x, s.vel.z);
  out.forEach((c, k) => {
    const J = Math.hypot(c.impulse.x, c.impulse.z);
    c.speedLoss = paid > 0 ? (lost * J) / paid : 0;
    if (k === 0) s.impact = Math.max(s.impact, clamp01(0.1 + Math.max(0, lost) / 6 + paid / (M * 25)));
  });
  return out;
}

/** Anchored ids broken in the current resolveIcebergContacts call (directly, together, through debris). */
const transmitted: number[] = [];
const dir2: ProxyDirection = { nx: 0, nz: 0 };
/** Debris counts as pressed against a standing body within this gap (m) beyond its own radius. */
const PRESS_GAP = 0.3;

/**
 * Debris the iceberg pushes (loose body `o`, contact normal n) that is pressed against a standing
 * obstacle just beyond it passes the push on: the obstacle gets the iceberg's momentum test as if
 * the iceberg touched it, so rubble shoved ahead never shields the next building. Returns the break
 * contact when it gives way (the iceberg pays as for a direct hit), else null (the debris contact
 * already holds the iceberg back).
 */
function pressedInto(
  s: IcebergState,
  o: ObstacleProxy,
  nx: number,
  nz: number,
  proxies: readonly ObstacleProxy[],
  M: number,
  ex: SimExtras,
): IcebergContact | null {
  for (let i = 0; i < proxies.length; i++) {
    const a = proxies[i];
    if (!a.anchored || a === o || !(a.breakImpulse < Infinity) || transmitted.includes(a.id)) continue;
    if (!inContactBand(s, a)) continue;
    // Pressed: the debris touches it, on the far side of the debris from the iceberg ... (a long
    // piece reaches as far as its rectangle does in that direction, not its bounding circle)
    const gap = proxyGap(o.x, o.z, a, dir2);
    const r = o.rect;
    const reachOut = r
      ? rectReach(r, dir2.nx * r.ux + dir2.nz * r.uz, dir2.nz * r.ux - dir2.nx * r.uz)
      : o.radius;
    if (!(gap < reachOut + PRESS_GAP) || dir2.nx * nx + dir2.nz * nz < 0.5) continue;
    // ... and the iceberg is not touching it itself (then it gets its own contact).
    if (!(proxyGap(s.pos.x, s.pos.z, a, dir) > s.radius)) continue;
    const vn = s.vel.x * dir.nx + s.vel.z * dir.nz;
    const test = momentumTestImpulse(vn, M);
    if (!(test >= a.breakImpulse)) continue;
    transmitted.push(a.id);
    const hsBefore = Math.hypot(s.vel.x, s.vel.z);
    const J = contactTestImpulse(vn, M, a.mass);
    s.vel.x -= (J / M) * dir.nx;
    s.vel.z -= (J / M) * dir.nz;
    rememberTouch(ex, a.origin ?? a.id, Infinity, SIM_TUNING.pushWindow);
    const reach = Math.max(0, gap);
    return {
      obstacleId: a.id,
      impulse: { x: J * dir.nx, y: CONTACT_LIFT * J, z: J * dir.nz },
      point: {
        x: o.x + dir2.nx * reach,
        y: clamp(s.pos.y + 1.2, Math.min(a.bottom, a.top), Math.max(a.bottom, a.top)),
        z: o.z + dir2.nz * reach,
      },
      normal: { x: dir.nx, y: 0, z: dir.nz },
      relSpeed: vn,
      speedLoss: hsBefore - Math.hypot(s.vel.x, s.vel.z),
      testImpulse: test,
      shock: Math.max(0, a.breakImpulse) / M,
    };
  }
  return null;
}

// --- integrator pieces --------------------------------------------------------------------------

/** Quadratic drag while sliding or flying: lower per tonne for a grown iceberg (growthDragExponent). */
function dragFor(s: IcebergState, p: IcebergParams, T: IcebergSimTuning): number {
  return s.size > 1 && T.growthDragExponent > 0 ? p.drag * Math.pow(s.size, -T.growthDragExponent) : p.drag;
}

function turnAuthority(speed: number, p: IcebergParams, T: IcebergSimTuning): number {
  const low = T.turnAtRest + (1 - T.turnAtRest) * smoothstep(0, T.turnFullSpeed, speed);
  const high = 1 - T.turnHighSpeedCut * smoothstep(T.turnHighSpeed, p.maxSpeed, speed);
  return low * high;
}

/** Drift the heading toward the velocity direction (fully when not steering; fast after bounces). */
function alignToVelocity(
  heading: number,
  vx: number,
  vz: number,
  speed: number,
  steer: number,
  h: number,
  T: IcebergSimTuning,
): number {
  if (speed < 0.5) return heading;
  let target = Math.atan2(vx, vz);
  // Pushed backwards slowly (bounced off something): keep facing forward instead of spinning round,
  // so the camera and the steering keep their sense of left and right while the player recovers.
  if (speed < T.backFaceSpeed && Math.abs(wrapAngle(target - heading)) > Math.PI / 2) {
    target = wrapAngle(target + Math.PI);
  }
  const mis = Math.abs(wrapAngle(target - heading));
  const free = 1 - smoothstep(0, T.alignSteerCutoff, Math.abs(steer));
  const rate =
    (T.headingAlign * free + T.spinAlign * smoothstep(0.6, 1.4, mis)) * smoothstep(0.2, 1.5, speed);
  return rate > 0 ? dampAngle(heading, target, rate, h) : heading;
}

/**
 * Turn cost multiplier for one substep. turnPenalty is charged on the heading change the steering
 * actually produced (net of alignToVelocity), scaled by how sharp the steer is, so gentle carving
 * costs only grip; a hard steer reversal shortly after a hard steer the other way costs extra.
 */
function turnKeep(
  s: IcebergState,
  yaw: number,
  net: number,
  h: number,
  p: IcebergParams,
  T: IcebergSimTuning,
  ex: SimExtras,
): number {
  const a = Math.abs(s.steer);
  const steered = yaw > 0 ? clamp(net, 0, yaw) : clamp(net, yaw, 0);
  let keep = 1 - p.turnPenalty * Math.abs(steered) * smoothstep(T.turnCostSteer, 1, a);
  ex.hardAge += h;
  if (a >= T.reversalSteer) {
    const side = s.steer > 0 ? 1 : -1;
    if (ex.hardSign === -side && ex.hardAge < T.reversalWindow) keep *= T.reversalKeep;
    ex.hardSign = side;
    ex.hardAge = 0;
  }
  return Math.max(0, keep);
}

/**
 * Steering: smooth the input, yaw the heading, then pull the velocity onto the heading. The lateral
 * velocity removed by grip is lost (carving cost), plus the turn cost from turnKeep.
 */
function steerAndGrip(
  s: IcebergState,
  steerIn: number,
  h: number,
  p: IcebergParams,
  T: IcebergSimTuning,
  gripRate: number,
  authority: number,
  ex: SimExtras,
): void {
  s.steer = damp(s.steer, steerIn, T.steerResponse, h);
  const vx = s.vel.x;
  const vz = s.vel.z;
  const sp = Math.hypot(vx, vz);
  const yaw = steerToYawDelta(s.steer, p.maxYawRate * turnAuthority(sp, p, T) * authority, h);
  const heading = alignToVelocity(s.heading + yaw, vx, vz, sp, s.steer, h, T);
  const keep = turnKeep(s, yaw, wrapAngle(heading - s.heading), h, p, T, ex);
  if (sp > 1e-6) {
    const hx = Math.sin(heading);
    const hz = Math.cos(heading);
    let fwd = vx * hx + vz * hz;
    let lat = hx * vz - hz * vx;
    // Grip is the "edge" the player carves with: mostly released when not steering (so gravity
    // bends the path like flowing water) and absent at crawl speed (a slow iceberg just slides).
    const engage = T.idleGrip + (1 - T.idleGrip) * smoothstep(0, T.gripSteerFull, Math.abs(s.steer));
    const g =
      gripRate *
      engage *
      smoothstep(0, T.gripFullAlign, Math.abs(fwd) / sp) *
      smoothstep(T.gripMinSpeed, T.gripFullSpeed, sp);
    lat *= Math.exp(-g * h);
    fwd *= keep;
    lat *= keep;
    s.vel.x = fwd * hx - lat * hz;
    s.vel.z = fwd * hz + lat * hx;
  }
  s.heading = wrapAngle(heading);
}

/** Reflect (vx, vz) off a wall with outward-into-wall unit normal n; returns via s.vel. */
function reflectOffWall(s: IcebergState, nx: number, nz: number, vn: number, T: IcebergSimTuning): void {
  const e = T.wallRestitution;
  let vx = s.vel.x - (1 + e) * vn * nx;
  let vz = s.vel.z - (1 + e) * vn * nz;
  const rn = vx * nx + vz * nz;
  const tx = vx - rn * nx;
  const tz = vz - rn * nz;
  const ts = Math.hypot(tx, tz);
  if (ts > 1e-9) {
    const k = Math.max(0, ts - T.wallFriction * (1 + e) * vn) / ts;
    vx = rn * nx + tx * k;
    vz = rn * nz + tz * k;
  }
  s.vel.x = vx;
  s.vel.z = vz;
  s.impact = Math.max(s.impact, clamp01(vn / 12));
}

/** Probe the ground just ahead of the hull; bounce off faces too steep to climb. */
function wallProbe(s: IcebergState, terrain: Terrain, h: number, T: IcebergSimTuning): void {
  const reach = s.radius * T.wallProbe;
  for (let k = 0; k < 3; k++) {
    const vx = s.vel.x;
    const vz = s.vel.z;
    const sp = Math.hypot(vx, vz);
    if (sp < 1e-4) return;
    const dx = vx / sp;
    const dz = vz / sp;
    const c = PROBE_COS[k];
    const sn = PROBE_SIN[k];
    const px = s.pos.x + vx * h + (dx * c + dz * sn) * reach;
    const pz = s.pos.z + vz * h + (dz * c - dx * sn) * reach;
    gradientInto(terrain.grid, px, pz, grad2);
    const sl = Math.hypot(grad2.dx, grad2.dz);
    if (!(sl > T.wallSlope)) continue;
    const nx = grad2.dx / sl;
    const nz = grad2.dz / sl;
    const vn = vx * nx + vz * nz;
    if (vn > 0) reflectOffWall(s, nx, nz, vn, T);
  }
}

/**
 * Last line of defence against climbing/tunnelling: if the move would rise faster than wallSlope,
 * bounce off that face and stay put. Returns true when the move was blocked.
 */
function blockSteepMove(
  s: IcebergState,
  terrain: Terrain,
  nx: number,
  nz: number,
  ground1: number,
  baseY: number,
  T: IcebergSimTuning,
): boolean {
  const mdx = nx - s.pos.x;
  const mdz = nz - s.pos.z;
  const dist = Math.hypot(mdx, mdz);
  if (!(ground1 - baseY > T.wallSlope * dist + 0.05)) return false;
  gradientInto(terrain.grid, nx, nz, grad2);
  const sl = Math.hypot(grad2.dx, grad2.dz);
  if (sl > 1e-6) {
    const vn = (s.vel.x * grad2.dx + s.vel.z * grad2.dz) / sl;
    if (vn > 0) {
      reflectOffWall(s, grad2.dx / sl, grad2.dz / sl, vn, T);
      return true;
    }
  }
  // The face at the destination does not oppose the motion (flat, or just past a crest so its
  // gradient points back at us): bounce off the refused move itself, otherwise the same move is
  // refused every step and the iceberg sits frozen in place at full speed.
  if (dist > 1e-9) {
    const vm = (s.vel.x * mdx + s.vel.z * mdz) / dist;
    if (vm > 0) reflectOffWall(s, mdx / dist, mdz / dist, vm, T);
  }
  return true;
}

/**
 * Ground under (x, z) for a grounded move `along` m from the lip of the kicker face found this step
 * (`face`): that exact face while short of the lip and it agrees with the grid (faceOnGrid), else
 * the grid (also when not riding a face: along = 0).
 */
function groundOrFace(terrain: Terrain, x: number, z: number, along: number): number {
  const gy = terrain.heightAt(x, z);
  return along < 0 && faceOnGrid(face, along, gy) ? faceHeight(face, along) : gy;
}

function groundStep(
  s: IcebergState,
  steerIn: number,
  terrain: Terrain,
  h: number,
  p: IcebergParams,
  T: IcebergSimTuning,
  ex: SimExtras,
): void {
  const g = p.gravity;
  const level = terrain.level;
  // Contact separation and the bounds clamp move x/z without touching y. A grounded hull sits on
  // the ground, and a stale base height would read as a cliff (fake hop) or a wall (refused move).
  const yIn = s.pos.y;
  s.pos.y = terrain.heightAt(s.pos.x, s.pos.z);
  // The last metres of a kicker face, heading over its lip: ride the exact face, not the grid's
  // truncated lip, and take off at the lip line (./kicker.ts).
  const kickers = terrain.kickers;
  const riding =
    kickers !== undefined &&
    kickerFace(kickers, s.pos.x, s.pos.z, yIn, s.vel.x, s.vel.z, face) &&
    faceOnGrid(face, alongLip(face.kicker!, s.pos.x, s.pos.z), s.pos.y);
  const lip = riding ? face.kicker : null;
  if (lip) s.pos.y = faceHeight(face, alongLip(lip, s.pos.x, s.pos.z));
  steerAndGrip(s, steerIn, h, p, T, p.grip, 1, ex);

  // Gravity along the surface, Coulomb friction, quadratic drag.
  gradientInto(terrain.grid, s.pos.x, s.pos.z, grad);
  if (lip) {
    // The exact face's gradient (the grid's lip crease would tilt it every which way).
    const along = face.slope + face.curve * alongLip(lip, s.pos.x, s.pos.z);
    grad.dx = lip.dirX * along - lip.dirZ * face.cross;
    grad.dz = lip.dirZ * along + lip.dirX * face.cross;
  }
  const gdx = grad.dx;
  const gdz = grad.dz;
  const gg = gdx * gdx + gdz * gdz;
  const inv = 1 / (1 + gg);
  let vx = s.vel.x - g * gdx * inv * h;
  let vz = s.vel.z - g * gdz * inv * h;
  let sp = Math.hypot(vx, vz);
  if (sp > 0) {
    const loss = (p.friction * g * Math.sqrt(inv) + dragFor(s, p, T) * sp * sp) * h;
    const ns = sp > loss ? sp - loss : 0;
    const k = Math.min(ns, p.maxSpeed) / sp;
    vx *= k;
    vz *= k;
    sp = Math.min(ns, p.maxSpeed);
  }
  // Wriggling: at crawl speed the edge has no grip, so steering shoves the hull sideways instead.
  // This is what lets a stopped iceberg work its way around a tree or house it ran into.
  const crawl = T.crawlPush * s.steer * (1 - smoothstep(0, T.crawlSpeed, sp));
  if (crawl !== 0) {
    // Right of the heading is (-cos θ, sin θ).
    vx -= Math.cos(s.heading) * crawl * h;
    vz += Math.sin(s.heading) * crawl * h;
    ex.crawlGain += Math.abs(crawl) * h;
    if (Math.abs(s.steer) >= 0.5) ex.wriggled = true;
  }
  // Standing on a face too steep to hold: never press into it, slide off it.
  const slope0 = Math.sqrt(gg);
  if (slope0 > T.wallSlope) {
    const wx = gdx / slope0;
    const wz = gdz / slope0;
    const vn = vx * wx + vz * wz;
    if (vn > 0) {
      vx -= vn * wx;
      vz -= vn * wz;
    }
    vx -= wx * T.wallPushAccel * h;
    vz -= wz * T.wallPushAccel * h;
  }
  s.vel.x = vx;
  s.vel.z = vz;
  // (Riding a kicker face, the grid's lip crease ahead is no wall.)
  if (!lip) wallProbe(s, terrain, h, T);

  let nx = s.pos.x + s.vel.x * h;
  let nz = s.pos.z + s.vel.z * h;
  let along1 = lip ? alongLip(lip, nx, nz) : 0;
  let ground1 = groundOrFace(terrain, nx, nz, along1);
  if (blockSteepMove(s, terrain, nx, nz, ground1, s.pos.y, T)) {
    nx = s.pos.x;
    nz = s.pos.z;
    along1 = lip ? alongLip(lip, nx, nz) : 0;
    ground1 = groundOrFace(terrain, nx, nz, along1);
  }

  const sea = level.seaLevel;
  const ocean1 = terrain.isOcean(nx, nz);
  // Over open water the iceberg comes down on the sea surface: a sea cliff is a fall, not a snap.
  const surf1 = ocean1 ? Math.max(ground1, sea) : ground1;

  const y0 = s.pos.y;
  // Surface-following vertical speed for the current (post-steer, post-contact) velocity.
  let vy0 = gdx * s.vel.x + gdz * s.vel.z;
  let yBall = y0 + vy0 * h - 0.5 * g * h * h;
  sp = Math.hypot(s.vel.x, s.vel.z);
  let launch = false;
  if (lip && along1 >= 0 && kickerTakeoff(face, y0, s.vel.x, s.vel.z, g, kick)) {
    // Over a kicker's lip line while riding its face: take off as off the exact lip.
    launch = true;
    s.vel.x *= kick.scale;
    s.vel.z *= kick.scale;
    sp *= kick.scale;
    vy0 = kick.vy;
    yBall = y0 + vy0 * h - 0.5 * g * h * h;
  } else if (!(along1 < 0)) {
    // (Still short of the lip on a kicker's exact face: no early launch off the grid's lip.)
    // Launch when the ground drops away within this step (cliff lip), or when the surface curves
    // away faster than gravity and the resulting flight would clear the ground by > airborneDrop.
    launch = yBall - surf1 > p.airborneDrop;
    if (!launch && sp > T.minLaunchSpeed && surf1 <= yBall) {
      const tau = h + T.launchLookahead;
      const yb = y0 + vy0 * tau - 0.5 * g * tau * tau;
      const ga = Math.max(terrain.heightAt(s.pos.x + s.vel.x * tau, s.pos.z + s.vel.z * tau), sea);
      launch = yb - ga > p.airborneDrop;
    }
    if (!launch) {
      // Cliff lip at crawl speed. A slow step only pokes into a cliff face, and from then on the
      // gradient under the iceberg is the face's, so the checks above would let it walk down a
      // vertical face. Judge the step against the descent actually carried in from the last step
      // instead: a convex kink sharper than the steepest slideable slope is a drop-off.
      const vyIn = s.vel.y < 0 ? s.vel.y : 0;
      const yLip = y0 + vyIn * h - 0.5 * g * h * h;
      const dist = Math.hypot(nx - s.pos.x, nz - s.pos.z);
      if (yLip - surf1 > T.wallSlope * dist + LIP_TOLERANCE) {
        launch = true;
        vy0 = vyIn;
        yBall = yLip;
      }
    }
  }

  if (launch) {
    s.grounded = false;
    s.airTime = 0;
    s.airPeakY = y0;
    s.vel.y = vy0 - g * h;
    s.pos.x = nx;
    s.pos.y = yBall;
    s.pos.z = nz;
    emit({ type: 'airborne', pos: { x: nx, y: yBall, z: nz }, speed: sp });
    return;
  }
  if (ocean1) {
    enterOcean(s, nx, nz, level);
    return;
  }

  s.pos.x = nx;
  s.pos.y = ground1;
  s.pos.z = nz;
  // Vertical speed actually travelled this step (equals grad · v inside one triangle). Unlike the
  // gradient at the new point it does not jump to a cliff face's descent rate on first contact.
  s.vel.y = (ground1 - y0) / h;
}

function airStep(
  s: IcebergState,
  steerIn: number,
  terrain: Terrain,
  h: number,
  p: IcebergParams,
  T: IcebergSimTuning,
  water?: InlandWater,
): void {
  const g = p.gravity;
  if (s.afloat) s.afloat = false;
  s.steer = damp(s.steer, steerIn, T.steerResponse, h);
  let vx = s.vel.x;
  let vz = s.vel.z;
  const sp = Math.hypot(vx, vz);
  const yaw = steerToYawDelta(s.steer, p.maxYawRate * turnAuthority(sp, p, T) * T.airControl, h);
  if (yaw !== 0) {
    // Air control turns the flight path with the nose, without grip losses.
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const rx = vx * c + vz * sn;
    vz = vz * c - vx * sn;
    vx = rx;
  }
  s.heading = wrapAngle(alignToVelocity(s.heading + yaw, vx, vz, sp, s.steer, h, T));
  if (sp > 0) {
    const k = Math.max(0, 1 - dragFor(s, p, T) * sp * h);
    vx *= k;
    vz *= k;
  }
  const vy = s.vel.y - g * h;
  s.vel.x = vx;
  s.vel.y = vy;
  s.vel.z = vz;
  s.airTime += h;

  const nx = s.pos.x + vx * h;
  const nz = s.pos.z + vz * h;
  const ny = s.pos.y + vy * h;
  const sea = terrain.level.seaLevel;

  if (ny <= sea && terrain.isOcean(nx, nz)) {
    land(s, nx, sea, nz, 0, 0, p, T);
    s.inOcean = true;
    return;
  }
  // Coming down on inland water deep enough to float in: splash down on its surface.
  if (water && vy <= 0 && water.sample(nx, nz, wsAir)) {
    const surf = wsAir.surfaceY;
    if (ny <= surf && surf - wsAir.groundY >= floatDraft(s.radius)) {
      land(s, nx, surf, nz, 0, 0, p, T);
      s.afloat = true;
      return;
    }
  }

  let ground1 = terrain.heightAt(nx, nz);
  // Coming down on the last metres of a kicker face, heading over its lip: touch down on the exact
  // face the ground step rides there (the grid's truncated lip is lower), with its gradient.
  const kickers = terrain.kickers;
  let onFace = false;
  if (kickers !== undefined && kickerFace(kickers, nx, nz, ny, vx, vz, face)) {
    const along = alongLip(face.kicker!, nx, nz);
    if (faceOnGrid(face, along, ground1)) {
      ground1 = Math.max(ground1, faceHeight(face, along));
      onFace = true;
    }
  }
  if (ny > ground1) {
    s.pos.x = nx;
    s.pos.y = ny;
    s.pos.z = nz;
    if (ny > s.airPeakY) s.airPeakY = ny;
    return;
  }
  if (onFace) {
    const k = face.kicker!;
    const along = face.slope + face.curve * alongLip(k, nx, nz);
    const gx = k.dirX * along - k.dirZ * face.cross;
    const gz = k.dirZ * along + k.dirX * face.cross;
    land(s, nx, ground1, nz, gx, gz, p, T);
    return;
  }

  // Touching terrain: flying into a steep face is a wall hit (bounce, keep falling where we are);
  // anything else is a landing.
  gradientInto(terrain.grid, nx, nz, grad);
  const sl = Math.hypot(grad.dx, grad.dz);
  if (sl > T.wallSlope && ny > terrain.heightAt(s.pos.x, s.pos.z)) {
    const wx = grad.dx / sl;
    const wz = grad.dz / sl;
    const vn = vx * wx + vz * wz;
    if (vn > 0) {
      reflectOffWall(s, wx, wz, vn, T);
      s.pos.y = ny;
      if (ny > s.airPeakY) s.airPeakY = ny;
      return;
    }
  }
  land(s, nx, ground1, nz, grad.dx, grad.dz, p, T);
}

/** Touch down at (x, y, z) on a surface with gradient (gdx, gdz) (zero for water). */
function land(
  s: IcebergState,
  x: number,
  y: number,
  z: number,
  gdx: number,
  gdz: number,
  p: IcebergParams,
  T: IcebergSimTuning,
): void {
  let vx = s.vel.x;
  let vz = s.vel.z;
  const impactV = Math.max(0, gdx * vx + gdz * vz - s.vel.y);
  let sp = Math.hypot(vx, vz);
  const boost = Math.min(T.landingBoost * impactV, T.landingBoostMax);
  if (boost > 0) {
    if (sp > 1e-3) {
      const k = (sp + boost) / sp;
      vx *= k;
      vz *= k;
    } else {
      vx += Math.sin(s.heading) * boost;
      vz += Math.cos(s.heading) * boost;
    }
    sp = Math.hypot(vx, vz);
    if (sp > p.maxSpeed) {
      const k = p.maxSpeed / sp;
      vx *= k;
      vz *= k;
      sp = p.maxSpeed;
    }
  }
  const drop = Math.max(0, Math.max(s.airPeakY, s.pos.y) - y);
  s.pos.x = x;
  s.pos.y = y;
  s.pos.z = z;
  s.vel.x = vx;
  s.vel.z = vz;
  s.vel.y = gdx * vx + gdz * vz;
  s.grounded = true;
  s.airTime = 0;
  s.airPeakY = y;
  s.impact = Math.max(s.impact, clamp01(0.2 + drop / 16));
  emit({ type: 'landed', pos: { x, y, z }, drop, speed: sp });
}

/** How far (m) under the terrain a hull on land may be (an exact kicker face: ≤ KICKER_BELOW_GRID). */
const UNDERGROUND = 0.5;

/**
 * Last line of defence: a hull on land is never under the terrain, whatever moved it (an exact
 * kicker face, contact separation or the bounds clamp move it without the ground's say).
 */
function keepAboveGround(s: IcebergState, terrain: Terrain): void {
  const gy = terrain.heightAt(s.pos.x, s.pos.z);
  if (!(s.pos.y >= gy - UNDERGROUND)) {
    s.pos.y = gy;
    if (s.vel.y < 0) s.vel.y = 0;
  }
}

function enterOcean(s: IcebergState, x: number, z: number, level: LevelDef): void {
  s.inOcean = true;
  if (s.afloat) s.afloat = false;
  s.grounded = true;
  s.airTime = 0;
  s.pos.x = x;
  s.pos.y = level.seaLevel;
  s.pos.z = z;
  s.vel.y = 0;
  s.airPeakY = level.seaLevel;
}

function updateCurrentDir(s: IcebergState, terrain: Terrain, ex: SimExtras, h: number): void {
  ex.curAge -= h;
  if (ex.curAge > 0) return;
  ex.curAge = 0.25;
  const pr = terrain.course.project(s.pos.x, s.pos.z);
  const cs = terrain.course.sampleAt(pr.s);
  const l = Math.hypot(cs.dirX, cs.dirZ);
  if (l > 1e-9 && Number.isFinite(l)) {
    ex.curX = cs.dirX / l;
    ex.curZ = cs.dirZ / l;
  }
}

function oceanStep(
  s: IcebergState,
  steerIn: number,
  terrain: Terrain,
  h: number,
  p: IcebergParams,
  T: IcebergSimTuning,
  ex: SimExtras,
): void {
  const sea = terrain.level.seaLevel;
  steerAndGrip(s, steerIn, h, p, T, p.grip * T.oceanGrip, T.oceanSteer, ex);
  updateCurrentDir(s, terrain, ex, h);
  // Water drag acts on velocity relative to the current, so a slow iceberg drifts out to sea.
  const cx = ex.curX * p.oceanCurrent;
  const cz = ex.curZ * p.oceanCurrent;
  const rx = s.vel.x - cx;
  const rz = s.vel.z - cz;
  const rs = Math.hypot(rx, rz);
  const k = Math.max(0, 1 - (T.waterLinearDrag + p.drag * T.waterQuadDrag * rs) * h);
  let vx = cx + rx * k;
  let vz = cz + rz * k;
  const sp = Math.hypot(vx, vz);
  if (sp > p.maxSpeed) {
    vx *= p.maxSpeed / sp;
    vz *= p.maxSpeed / sp;
  }
  s.vel.x = vx;
  s.vel.y = 0;
  s.vel.z = vz;
  wallProbe(s, terrain, h, T);

  let nx = s.pos.x + s.vel.x * h;
  let nz = s.pos.z + s.vel.z * h;
  if (terrain.isOcean(nx, nz)) {
    s.pos.x = nx;
    s.pos.y = sea;
    s.pos.z = nz;
    return;
  }
  let ground1 = terrain.heightAt(nx, nz);
  if (blockSteepMove(s, terrain, nx, nz, ground1, sea, T)) {
    nx = s.pos.x;
    nz = s.pos.z;
    if (terrain.isOcean(nx, nz)) {
      s.pos.y = sea;
      return;
    }
    ground1 = terrain.heightAt(nx, nz);
  }
  // Drifted back onto land (beach / sand bar / shallows): continue as a grounded slide.
  s.inOcean = false;
  s.grounded = true;
  s.pos.x = nx;
  s.pos.y = ground1;
  s.pos.z = nz;
  gradientInto(terrain.grid, nx, nz, grad);
  s.vel.y = grad.dx * s.vel.x + grad.dz * s.vel.z;
}

// --- inland water (streams, reservoirs, floods, captured rivers) --------------------------------

/** Water samples for the inland steps (allocation-free). */
const wsIn: InlandWaterSample = createWaterSample();
const wsNext: InlandWaterSample = createWaterSample();
const wsAir: InlandWaterSample = createWaterSample();

/** Per iceberg: the stream whose banks currently hold it (−1: none). See confineToChannel. */
const channelLock = new WeakMap<IcebergState, { stream: number }>();

function lockFor(s: IcebergState): { stream: number } {
  let l = channelLock.get(s);
  if (!l) {
    l = { stream: -1 };
    channelLock.set(s, l);
  }
  return l;
}

/** The stream whose banks hold the iceberg, or −1 (for tests and agents). */
export function confiningStream(s: IcebergState): number {
  return channelLock.get(s)?.stream ?? -1;
}

/**
 * A grounded step on a level with inland water. In water at least floatDraft(radius) deep the
 * iceberg floats (floatStep). In a stream channel whose banks do not hold it (isConfinedBy) it rides
 * over the bed and banks as if they were not there (rideStep): big icebergs leave a stream at will.
 * Otherwise it slides on the ground (groundStep) and shallow water drags it along. Then a confined
 * iceberg is kept inside its channel (confineToChannel).
 */
function inlandStep(
  s: IcebergState,
  steerIn: number,
  terrain: Terrain,
  h: number,
  p: IcebergParams,
  T: IcebergSimTuning,
  ex: SimExtras,
  water: InlandWater,
): void {
  const w = wsIn;
  const has = water.sample(s.pos.x, s.pos.z, w);
  const depth = has ? w.surfaceY - w.groundY : 0;
  const draft = floatDraft(s.radius);
  if (has && depth >= draft) {
    floatStep(s, steerIn, terrain, h, p, T, ex, water, w);
  } else if (has && (w.channel || w.cut) && !w.drowned && !isConfinedBy(w.bank, 2 * w.topHalf, s.radius)) {
    rideStep(s, steerIn, terrain, h, p, T, ex, w);
  } else {
    if (s.afloat) s.afloat = false;
    groundStep(s, steerIn, terrain, h, p, T, ex);
    if (has && depth > HYDRO_WET && s.grounded && !s.inOcean) {
      // Shallow water drags the hull along with it.
      const k = Math.min(1, INLAND_FLOAT.wadeDrag * Math.min(1, depth / draft) * h);
      hullCurrent(w, s.radius, cur);
      s.vel.x += (cur.x - s.vel.x) * k;
      s.vel.z += (cur.z - s.vel.z) * k;
    }
  }
  if (s.grounded && !s.inOcean) confineToChannel(s, water, T);
}

/** Water shallower than this (m) does not drag the iceberg. */
const HYDRO_WET = 0.05;
/** Scratch: the current the hull feels (hullCurrent). */
const cur = { x: 0, z: 0 };

/**
 * Floating on inland water: the speed relative to the water decays (fast in a stream, slowly on
 * still water), steering pushes sideways across the current, and the base rides the surface. The
 * surface dropping away ahead is a waterfall (airborne); water too shallow ahead beaches it.
 */
function floatStep(
  s: IcebergState,
  steerIn: number,
  terrain: Terrain,
  h: number,
  p: IcebergParams,
  T: IcebergSimTuning,
  ex: SimExtras,
  water: InlandWater,
  w: InlandWaterSample,
): void {
  const F = INLAND_FLOAT;
  s.afloat = true;
  s.grounded = true;
  s.airTime = 0;
  s.steer = damp(s.steer, steerIn, T.steerResponse, h);
  hullCurrent(w, s.radius, cur);
  const cx = cur.x;
  const cz = cur.z;
  const cl = Math.hypot(cx, cz);
  let rx = s.vel.x - cx;
  let rz = s.vel.z - cz;
  const rs = Math.hypot(rx, rz);
  const k = Math.max(0, 1 - ((w.still ? F.stillDrag : F.streamDrag) + p.drag * T.waterQuadDrag * rs) * h);
  rx *= k;
  rz *= k;
  // Steering pushes across the current (across the heading on still water); right of (bx, bz) is
  // (−bz, bx).
  const bx = cl > 0.3 ? cx / cl : Math.sin(s.heading);
  const bz = cl > 0.3 ? cz / cl : Math.cos(s.heading);
  const push = F.steerPush * s.steer * h;
  rx -= bz * push;
  rz += bx * push;
  let vx = cx + rx;
  let vz = cz + rz;
  let sp = Math.hypot(vx, vz);
  if (sp > p.maxSpeed) {
    vx *= p.maxSpeed / sp;
    vz *= p.maxSpeed / sp;
    sp = p.maxSpeed;
  }
  s.vel.x = vx;
  s.vel.z = vz;
  const yaw = steerToYawDelta(s.steer, p.maxYawRate * T.oceanSteer * turnAuthority(sp, p, T), h);
  s.heading = wrapAngle(alignToVelocity(s.heading + yaw, vx, vz, sp, s.steer, h, T));
  ex.hardAge += h;

  const x0 = s.pos.x;
  const z0 = s.pos.z;
  const y0 = s.pos.y;
  const surf0 = w.surfaceY;
  const nx = x0 + vx * h;
  const nz = z0 + vz * h;
  if (terrain.isOcean(nx, nz)) {
    enterOcean(s, nx, nz, terrain.level);
    return;
  }
  const w2 = wsNext;
  if (water.sample(nx, nz, w2) && w2.surfaceY - w2.groundY >= floatDraft(s.radius)) {
    // The surface a little way ahead (a waterfall's lip is only a cell or two wide).
    const probe = Math.max(F.fallProbe, sp * h);
    const ahead = sp > 1e-6 && water.sample(x0 + (vx / sp) * probe, z0 + (vz / sp) * probe, wsAir);
    if (ahead && surf0 - wsAir.surfaceY > F.fallDrop + F.fallPerMetre * probe) {
      // Over a waterfall: leave the lip level, then fall.
      s.grounded = false;
      s.afloat = false;
      s.airTime = 0;
      s.airPeakY = surf0;
      s.vel.y = -p.gravity * h;
      s.pos.x = nx;
      s.pos.y = surf0 - 0.5 * p.gravity * h * h;
      s.pos.z = nz;
      emit({ type: 'airborne', pos: { x: nx, y: s.pos.y, z: nz }, speed: sp });
      return;
    }
    s.pos.x = nx;
    s.pos.y = w2.surfaceY;
    s.pos.z = nz;
    s.vel.y = (w2.surfaceY - y0) / h;
    return;
  }
  // Too shallow ahead: run aground (or bounce off a shore too steep to slide onto).
  const ground1 = terrain.heightAt(nx, nz);
  if (blockSteepMove(s, terrain, nx, nz, ground1, Math.max(y0, surf0), T)) {
    s.pos.y = surf0;
    return;
  }
  s.afloat = false;
  s.pos.x = nx;
  s.pos.y = ground1;
  s.pos.z = nz;
  s.vel.y = (ground1 - y0) / h;
}

/**
 * An iceberg too big for the stream channel it is in: it rides over the bed and up the banks as if
 * they were flat (no climb, no wall), slowed by friction and drag, pulled along the channel by its
 * slope and dragged by the water it stands in; steering also pushes it across the channel, so it
 * leaves wherever the player wants. Outside the channel groundStep takes over again.
 */
function rideStep(
  s: IcebergState,
  steerIn: number,
  terrain: Terrain,
  h: number,
  p: IcebergParams,
  T: IcebergSimTuning,
  ex: SimExtras,
  w: InlandWaterSample,
): void {
  const g = p.gravity;
  if (s.afloat) s.afloat = false;
  s.grounded = true;
  steerAndGrip(s, steerIn, h, p, T, p.grip, INLAND_FLOAT.rideTurn, ex);
  gradientInto(terrain.grid, s.pos.x, s.pos.z, grad);
  // Only the channel's fall along its length pulls (the banks are no slope to an iceberg this big).
  const along = grad.dx * w.dirX + grad.dz * w.dirZ;
  let vx = s.vel.x - g * along * w.dirX * h;
  let vz = s.vel.z - g * along * w.dirZ * h;
  const sp = Math.hypot(vx, vz);
  if (sp > 0) {
    const loss = (p.friction * g + dragFor(s, p, T) * sp * sp) * h;
    const ns = sp > loss ? sp - loss : 0;
    const k = Math.min(ns, p.maxSpeed) / sp;
    vx *= k;
    vz *= k;
  }
  const depth = w.surfaceY - w.groundY;
  if (depth > HYDRO_WET) {
    const k = Math.min(1, INLAND_FLOAT.wadeDrag * Math.min(1, depth / floatDraft(s.radius)) * h);
    hullCurrent(w, s.radius, cur);
    vx += (cur.x - vx) * k;
    vz += (cur.z - vz) * k;
  }
  // Across the channel: right of its direction is (−dirZ, dirX). Steering pushes that way; left
  // alone, the channel guides the hull along it.
  const F = INLAND_FLOAT;
  const across = -vx * w.dirZ + vz * w.dirX;
  const guide = F.rideGuide * (1 - Math.min(1, Math.abs(s.steer) / F.guideSteer));
  const push = F.ridePush * s.steer * h - across * Math.min(1, guide * h);
  vx -= w.dirZ * push;
  vz += w.dirX * push;
  s.vel.x = vx;
  s.vel.z = vz;
  const y0 = s.pos.y;
  const nx = s.pos.x + vx * h;
  const nz = s.pos.z + vz * h;
  if (terrain.isOcean(nx, nz)) {
    enterOcean(s, nx, nz, terrain.level);
    return;
  }
  const y1 = terrain.heightAt(nx, nz);
  // The bed dropping away faster than it falls (a waterfall's lip): it flies, as off a cliff.
  const yBall = y0 + s.vel.y * h - 0.5 * g * h * h;
  if (yBall - y1 > p.airborneDrop) {
    s.grounded = false;
    s.airTime = 0;
    s.airPeakY = y0;
    s.vel.y -= g * h;
    s.pos.x = nx;
    s.pos.y = yBall;
    s.pos.z = nz;
    emit({ type: 'airborne', pos: { x: nx, y: yBall, z: nz }, speed: Math.hypot(vx, vz) });
    return;
  }
  s.pos.x = nx;
  s.pos.y = y1;
  s.pos.z = nz;
  s.vel.y = (y1 - y0) / h;
}

/**
 * Keep an iceberg the banks hold inside its channel: once it is in the channel's water within
 * INLAND_FLOAT.confineShare × its half top width − half its radius of the centre line, it is locked
 * to that stream, and from then on that is a wall (it bounces off it like off a terrain wall) until
 * it leaves the channel along it (the stream's mouth or end), the water drowns the banks (a
 * reservoir, a flood), or it grows too big for them.
 */
function confineToChannel(s: IcebergState, water: InlandWater, T: IcebergSimTuning): void {
  const lock = lockFor(s);
  const w = wsNext;
  if (!water.sample(s.pos.x, s.pos.z, w) || !w.channel || w.drowned) {
    if (!w.channel) lock.stream = -1;
    return;
  }
  if (!isConfinedBy(w.bank, 2 * w.topHalf, s.radius)) {
    lock.stream = -1;
    return;
  }
  const max = Math.max(0.3, INLAND_FLOAT.confineShare * w.topHalf - 0.5 * s.radius);
  const lat = w.lat;
  if (lock.stream !== w.stream) {
    if (!(w.surfaceY > w.groundY + 0.15) || Math.abs(lat) > max + 0.5) return;
    lock.stream = w.stream;
  }
  const excess = Math.abs(lat) - max;
  if (!(excess > 0)) return;
  // Outward unit normal (toward the bank it is pressing on): ±right of the channel direction.
  const side = lat > 0 ? 1 : -1;
  const nx = -w.dirZ * side;
  const nz = w.dirX * side;
  s.pos.x -= nx * excess;
  s.pos.z -= nz * excess;
  const vn = s.vel.x * nx + s.vel.z * nz;
  if (!(vn > 0)) return;
  // A bank: bounce like off a terrain wall, but it is smooth (a hull scraping along it keeps going).
  const e = T.wallRestitution;
  let vx = s.vel.x - (1 + e) * vn * nx;
  let vz = s.vel.z - (1 + e) * vn * nz;
  const rn = vx * nx + vz * nz;
  const tx = vx - rn * nx;
  const tz = vz - rn * nz;
  const ts = Math.hypot(tx, tz);
  if (ts > 1e-9) {
    const k = Math.max(0, ts - INLAND_FLOAT.bankFriction * (1 + e) * vn) / ts;
    vx = rn * nx + tx * k;
    vz = rn * nz + tz * k;
  }
  s.vel.x = vx;
  s.vel.z = vz;
  s.impact = Math.max(s.impact, clamp01(vn / 12));
}

function keepInBounds(s: IcebergState, b: LevelDef['bounds']): void {
  const r = s.radius;
  const bounce = 0.3;
  if (s.pos.x < b.minX + r) {
    s.pos.x = b.minX + r;
    if (s.vel.x < 0) s.vel.x = -s.vel.x * bounce;
  } else if (s.pos.x > b.maxX - r) {
    s.pos.x = b.maxX - r;
    if (s.vel.x > 0) s.vel.x = -s.vel.x * bounce;
  }
  if (s.pos.z < b.minZ + r) {
    s.pos.z = b.minZ + r;
    if (s.vel.z < 0) s.vel.z = -s.vel.z * bounce;
  } else if (s.pos.z > b.maxZ - r) {
    s.pos.z = b.maxZ - r;
    if (s.vel.z > 0) s.vel.z = -s.vel.z * bounce;
  }
}

/**
 * Back the iceberg out of an overlap by `depth` along -n. With terrain, a grounded iceberg is only
 * pushed as far as it could slide: never onto a rising face steeper than wallSlope (an iceberg that
 * just grew next to a tree and a wall stays wedged instead of being shoved up the wall).
 */
function separate(s: IcebergState, nx: number, nz: number, depth: number, terrain?: Terrain): void {
  if (!(depth > 0)) return;
  let d = depth;
  if (terrain && s.grounded && !s.inOcean) {
    const y0 = terrain.heightAt(s.pos.x, s.pos.z);
    if (!pushAllowed(s, terrain, nx, nz, d, y0)) {
      let lo = 0;
      for (let k = 0; k < 6; k++) {
        const mid = 0.5 * (lo + d);
        if (pushAllowed(s, terrain, nx, nz, mid, y0)) lo = mid;
        else d = mid;
      }
      d = lo;
    }
  }
  s.pos.x -= nx * d;
  s.pos.z -= nz * d;
}

function pushAllowed(
  s: IcebergState,
  terrain: Terrain,
  nx: number,
  nz: number,
  d: number,
  y0: number,
): boolean {
  const x = s.pos.x - nx * d;
  const z = s.pos.z - nz * d;
  if (terrain.heightAt(x, z) - y0 <= 0.05) return true;
  gradientInto(terrain.grid, x, z, grad3);
  return Math.hypot(grad3.dx, grad3.dz) <= SIM_TUNING.wallSlope;
}

/** Trap detectors (stuck rule), kept apart from SimExtras. */
const trapMap = new WeakMap<IcebergState, ConfinementTracker>();

function trapFor(s: IcebergState): ConfinementTracker {
  let t = trapMap.get(s);
  if (!t) {
    t = new ConfinementTracker();
    trapMap.set(s, t);
  }
  return t;
}

function updateStuck(
  s: IcebergState,
  p: IcebergParams,
  T: IcebergSimTuning,
  dt: number,
  elapsed: number,
  ex: SimExtras,
): void {
  const hs = Math.hypot(s.vel.x, s.vel.z);
  // Speed the player wriggled up does not count as picking up speed (no endless crawl on the flat).
  const gain = hs - ex.hsStart - ex.crawlGain;
  ex.accel = damp(ex.accel, gain / dt, 1 / T.stuckAccelWindow, dt);
  ex.sinceBlocked += dt;
  const trap = trapFor(s);
  trap.update(s.pos.x, s.pos.z, hs, s.stuckTimer, dt, s.grounded && !s.inOcean && !s.afloat, T);
  // Caught coming back: the time it spent slow since then counts again (see ConfinementTracker.peak).
  if (trap.peak > s.stuckTimer) s.stuckTimer = Math.min(trap.peak, Math.max(p.stuckTime, dt));
  const recovering = ex.accel > T.stuckGainAccel && ex.sinceBlocked > T.stuckBlockHold;
  if (s.afloat && !s.inOcean && elapsed > p.graceTime) {
    // Afloat on inland water: drifting is not stuck, sitting still (pinned against a dam, a closed
    // pool) is, after stuckTime / stuckRate s (INLAND_FLOAT).
    const F = INLAND_FLOAT;
    const cap = Math.max(p.stuckTime, dt);
    if (hs < F.stuckSpeed) s.stuckTimer = Math.min(s.stuckTimer + F.stuckRate * dt, cap);
    else s.stuckTimer = Math.max(0, s.stuckTimer - T.stuckRecover * dt);
  } else if (!(s.grounded && !s.inOcean && elapsed > p.graceTime)) {
    s.stuckTimer = Math.max(0, s.stuckTimer - T.stuckRecover * dt);
  } else if (trap.inside) {
    // Trapped (back where it was a few seconds ago, see ./confinement.ts): the timer runs while it
    // swings back in, however fast, or is slow; heading out it holds while fast, and only drains
    // while it also picks up speed (getting away downhill).
    const leaving = (s.pos.x - trap.cx) * s.vel.x + (s.pos.z - trap.cz) * s.vel.z > 0;
    if (recovering && leaving) s.stuckTimer = Math.max(0, s.stuckTimer - T.stuckGainRecover * dt);
    else if (!(leaving && hs >= p.stuckSpeed)) growStuck(s, p, T, dt, ex);
  } else if (hs >= p.stuckSpeed) {
    // Just out of a trap (it may be one long swing), the timer holds instead of draining.
    if (!trap.trapped) s.stuckTimer = Math.max(0, s.stuckTimer - T.stuckRecover * dt);
  } else if (recovering) {
    // Slow, but sliding free and picking up speed (a gentle slope, or getting going after a hit).
    if (!trap.trapped) s.stuckTimer = Math.max(0, s.stuckTimer - T.stuckGainRecover * dt);
  } else {
    growStuck(s, p, T, dt, ex);
  }
}

function growStuck(s: IcebergState, p: IcebergParams, T: IcebergSimTuning, dt: number, ex: SimExtras): void {
  // Capped so recovery is quick; the cap is at least dt so stuckTime <= 0 means "fail at once".
  // Wriggling to get free runs it slower: time to work round an obstacle, but not forever.
  const rate = ex.wriggled ? T.stuckWriggleRate : 1;
  s.stuckTimer = Math.min(s.stuckTimer + rate * dt, Math.max(p.stuckTime, dt));
}

function updateVisuals(s: IcebergState, terrain: Terrain, T: IcebergSimTuning, dt: number): void {
  const hs = Math.hypot(s.vel.x, s.vel.z);
  const lean = clamp(T.leanGain * s.yawRate * Math.min(1, hs / 12), -T.maxLean, T.maxLean);
  let tp: number;
  let tr: number;
  if (s.inOcean || s.afloat) {
    tp = 0;
    tr = lean * 0.6;
  } else if (s.grounded) {
    const hx = Math.sin(s.heading);
    const hz = Math.cos(s.heading);
    gradientInto(terrain.grid, s.pos.x, s.pos.z, grad);
    tp = Math.atan(clamp(grad.dx * hx + grad.dz * hz, -1.5, 1.5));
    tr = Math.atan(clamp(grad.dz * hx - grad.dx * hz, -1.5, 1.5)) + lean;
  } else {
    tp = clamp(Math.atan2(s.vel.y, Math.max(hs, 2)) * 0.5, -0.45, 0.45);
    tr = lean;
  }
  s.pitch = damp(s.pitch, tp, T.tiltRate, dt);
  s.roll = damp(s.roll, tr, T.tiltRate, dt);
  s.impact = Math.max(0, s.impact - T.impactDecay * dt);
}

// --- NaN safety ---------------------------------------------------------------------------------

function stateFinite(s: IcebergState): boolean {
  return (
    Number.isFinite(s.pos.x) &&
    Number.isFinite(s.pos.y) &&
    Number.isFinite(s.pos.z) &&
    Number.isFinite(s.vel.x) &&
    Number.isFinite(s.vel.y) &&
    Number.isFinite(s.vel.z) &&
    Number.isFinite(s.heading) &&
    Number.isFinite(s.steer) &&
    Number.isFinite(s.pitch) &&
    Number.isFinite(s.roll) &&
    Number.isFinite(s.impact) &&
    Number.isFinite(s.stuckTimer) &&
    Number.isFinite(s.airPeakY) &&
    Number.isFinite(s.airTime) &&
    Number.isFinite(s.yawRate)
  );
}

function saveGood(ex: SimExtras, s: IcebergState): void {
  const g = ex.good;
  g.px = s.pos.x;
  g.py = s.pos.y;
  g.pz = s.pos.z;
  g.vx = s.vel.x;
  g.vy = s.vel.y;
  g.vz = s.vel.z;
  g.heading = s.heading;
}

function restoreGood(ex: SimExtras, s: IcebergState): void {
  const g = ex.good;
  s.pos.x = g.px;
  s.pos.y = g.py;
  s.pos.z = g.pz;
  s.vel.x = g.vx;
  s.vel.y = g.vy;
  s.vel.z = g.vz;
  s.heading = g.heading;
  s.steer = 0;
  s.yawRate = 0;
  if (!Number.isFinite(s.pitch)) s.pitch = 0;
  if (!Number.isFinite(s.roll)) s.roll = 0;
  if (!Number.isFinite(s.impact)) s.impact = 0;
  if (!Number.isFinite(s.stuckTimer)) s.stuckTimer = 0;
  if (!Number.isFinite(s.airTime)) s.airTime = 0;
  if (!Number.isFinite(s.airPeakY)) s.airPeakY = s.pos.y;
}
