import { Quaternion, Vector3 } from 'three';
import type { ObstacleKind, StructureVariant, Terrain, Vec3 } from '../types';
import type { ObstacleMaterial, ProxyMode } from './catalog';
import { getGeom, scaledPoints, type GeomKey } from './shapes';

/**
 * Plain-data body specs shared by the spawner, the structure kit and the physics world. Pure and
 * deterministic (no Rapier), so every body can be inspected and tested headless.
 */

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** One rendered (and, unless decor, collided) piece of a body, in the body's local frame. */
export interface BodyPart {
  readonly geom: GeomKey;
  /** 'rock', 'stone', 'trunk', 'cone', 'canopy', 'wall', 'gable', 'roof', 'chimney', 'deck', ... */
  readonly name: string;
  readonly offset: Vec3;
  readonly rotation: Quat;
  /** Per-axis scale applied to the geometry's points before `rotation`/`offset`. */
  readonly scale: Vec3;
  /** Instance tint 0xRRGGBB (sRGB). */
  readonly color: number;
  /** Mass (t) of this part once the body is loose (0 for decor). */
  readonly mass: number;
  /**
   * Break group: when the body shatters, parts with the same piece index fly off together as one
   * body. Omitted = the part is its own piece.
   */
  readonly piece?: number;
  /** Render-only detail (windows, lamps, balusters): no collider and no mass. */
  readonly decor?: boolean;
  /** Living world (render-only): see PartLiving in ./structures/kit.ts. */
  readonly lamp?: SignalLamp;
  readonly spin?: PartSpin;
  readonly plume?: PlumeKind;
}

/** A traffic-light lamp: lit while its signal shows this colour (BodySpec.signal). */
export type SignalLamp = 'red' | 'amber' | 'green';

/**
 * A part the renderer turns about an axis while its body is undisturbed (wind turbine blades):
 * unit axis and pivot in the body frame (m, scaled), rate in rad/s.
 */
export interface PartSpin {
  readonly axis: Vec3;
  readonly pivot: Vec3;
  readonly rate: number;
}

/**
 * Smoke or steam rising from the top centre of a part while its body stands (render-only):
 * 'smoke' dark industrial smoke (chimneys), 'steam' big slow white clouds (cooling towers), 'thin'
 * a thin wisp (house and chalet chimneys, factory vents).
 */
export type PlumeKind = 'smoke' | 'steam' | 'thin';

/**
 * - none: never breaks (rocks, stones, debris, vehicles without a shatter speed)
 * - uproot: anchored, becomes one dynamic body when broken (trees, posts)
 * - shatter: every piece becomes its own dynamic body when broken (houses, fence segments)
 */
export type BreakMode = 'none' | 'uproot' | 'shatter';

/** How a shattering body hands the hit to its pieces. */
export interface Breakup {
  /** Fraction of the contact impulse given to the pieces (the rest is "absorbed" by the break). */
  impulseScale: number;
  /** Random torque impulse per unit of a piece's impulse share. */
  spin: number;
  /** Pieces within ~falloff metres of the contact point get most of the impulse... */
  falloff: number;
  /** ...and every piece gets at least this weight (times its mass). */
  floor: number;
}

export const DEFAULT_BREAKUP: Breakup = { impulseScale: 0.75, spin: 0.35, falloff: 3, floor: 0.25 };

/**
 * A body's plan footprint in its own frame (metres): between the end faces x = x0 + k0 · z and
 * x = x1 + k1 · z, for |z| ≤ hz, over body heights y0..y1 (end faces square to the body's x axis,
 * so on a tilted body they reach a little further in plan at one height than at another).
 */
export interface PlanFootprint {
  readonly x0: number;
  readonly x1: number;
  readonly k0: number;
  readonly k1: number;
  readonly hz: number;
  readonly y0: number;
  readonly y1: number;
}

export interface BodySpec {
  kind: ObstacleKind;
  /** Proxy part label ('rock', 'stone', 'trunk', 'house', 'wall', 'post', 'deck', ...). */
  part: string;
  material: ObstacleMaterial;
  proxyMode: ProxyMode;
  /** Body origin in world space (ground contact point for trees/houses, centre for rocks). */
  position: Vec3;
  rotation: Quat;
  anchored: boolean;
  /** Mass once loose (t). */
  mass: number;
  /**
   * Anchored: impulse the iceberg's momentum test (J = (1+e)·vn·M) must reach to break it.
   * Loose: impulse that shatters it (Infinity = never).
   */
  breakImpulse: number;
  breakMode: BreakMode;
  /** Local y where an uprooting impulse is applied (high on the trunk so it topples forward). */
  hitHeight: number;
  /** Trunk radius (m) for 'trunk' proxies; 0 otherwise. */
  trunkRadius: number;
  /**
   * The 'trunk' proxy is a square of half-width trunkRadius (+ the trunk margin) aligned with the
   * body, not a circle: a lattice tower's four corner legs reach well past the circle round its
   * faces (default false).
   */
  squareTrunk?: boolean;
  ccd: boolean;
  /** Needs physics warm-up to settle (stacked stones); everything else spawns already at rest. */
  settle: boolean;
  parts: BodyPart[];
  /** Index into level.obstacles, or -1 for runtime spawns and debris. */
  placement: number;
  /** Glacier ice the iceberg absorbs on contact. */
  absorbable?: boolean;
  /** Counts toward ObstacleStats.buildingsDestroyed when it shatters. */
  building?: boolean;
  /** Excluded from the knocked/rocks/swept tallies (ice blocks and chunks). */
  noTally?: boolean;
  /** The iceberg rides over it like the ground (a bridge abutment buried in the bank). */
  passable?: boolean;
  /**
   * Exact plan footprint of a body whose ends are skewed (a skewed bridge deck or abutment), in its
   * own frame: the physics proxy is then that quadrilateral (ProxyRect.k0 / k1) rather than the
   * bounding rectangle, which reaches |skew| × width past the real end along one edge.
   */
  footprint?: PlanFootprint;
  breakup?: Breakup;
  /** 'shook' wobble: tilt about the base (trees, posts) or a sideways jolt (buildings). */
  shakeStyle?: 'tilt' | 'offset';
  /** Traffic light: the junction (index into the traffic network) and signal phase its lamps show. */
  signal?: { junction: number; group: number };
}

export interface SpawnOptions {
  /** Yaw relative to the course direction (dirX/dirZ); omitted = the kind picks one. */
  yaw?: number;
  scale?: number;
  count?: number;
  spread?: number;
  /** Spanning kinds: length in metres (default: the floor width, 2 × halfWidth). */
  span?: number;
  /** Course direction of travel at the spot (barriers are laid across it, houses face it). */
  dirX?: number;
  dirZ?: number;
  /** Signed lateral course offset (houses turn their door toward the centreline). */
  d?: number;
  /** Half-width of the valley floor at the spot (default span of spanning kinds). */
  halfWidth?: number;
  /** A structure's look (ObstaclePlacement.variant); kinds without it build their intact look. */
  variant?: StructureVariant;
}

export const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const _q = new Quaternion();
const _v = new Vector3();

export const yawQuat = (yaw: number): Quat => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });

export const pitchQuat = (a: number): Quat => ({ x: Math.sin(a / 2), y: 0, z: 0, w: Math.cos(a / 2) });

export const pick = <T>(rng: () => number, arr: readonly T[]): T =>
  arr[Math.floor(rng() * arr.length) % arr.length];

/** Rotate a local vector by q into `out`. */
export function rotateVec(q: Quat, x: number, y: number, z: number, out: Vec3): Vec3 {
  _v.set(x, y, z).applyQuaternion(_q.set(q.x, q.y, q.z, q.w));
  out.x = _v.x;
  out.y = _v.y;
  out.z = _v.z;
  return out;
}

/**
 * Lowest body-origin y at which no hull vertex of the body is below the terrain: the body then
 * rests on the ground touching it at (at least) one vertex. Decor parts are ignored.
 */
export function restingY(
  terrain: Terrain,
  x: number,
  z: number,
  rotation: Quat,
  parts: readonly BodyPart[],
): number {
  let y = -Infinity;
  const bodyQ = new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
  const partQ = new Quaternion();
  const v = new Vector3();
  for (const part of parts) {
    if (part.decor) continue;
    const pts = scaledPoints(getGeom(part.geom), part.scale);
    partQ.set(part.rotation.x, part.rotation.y, part.rotation.z, part.rotation.w);
    for (let i = 0; i < pts.length; i += 3) {
      v.set(pts[i], pts[i + 1], pts[i + 2]).applyQuaternion(partQ);
      v.x += part.offset.x;
      v.y += part.offset.y;
      v.z += part.offset.z;
      v.applyQuaternion(bodyQ);
      y = Math.max(y, terrain.heightAt(x + v.x, z + v.z) - v.y);
    }
  }
  return y;
}

/** Approximate local centre-of-mass height (mean hull-vertex height per part, mass weighted). */
export function centreOfMassY(parts: readonly BodyPart[]): number {
  let my = 0;
  let m = 0;
  const v = new Vector3();
  const q = new Quaternion();
  for (const part of parts) {
    if (part.decor || part.mass <= 0) continue;
    const pts = scaledPoints(getGeom(part.geom), part.scale);
    q.set(part.rotation.x, part.rotation.y, part.rotation.z, part.rotation.w);
    let sum = 0;
    for (let i = 0; i < pts.length; i += 3) {
      sum += v.set(pts[i], pts[i + 1], pts[i + 2]).applyQuaternion(q).y;
    }
    my += part.mass * (part.offset.y + sum / (pts.length / 3));
    m += part.mass;
  }
  return m > 0 ? my / m : 0;
}

/** Body-local AABB of the collider (non-decor) parts. */
export function partsBounds(parts: readonly BodyPart[]): { min: Vec3; max: Vec3 } {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  const v = new Vector3();
  const q = new Quaternion();
  for (const part of parts) {
    if (part.decor) continue;
    const pts = scaledPoints(getGeom(part.geom), part.scale);
    q.set(part.rotation.x, part.rotation.y, part.rotation.z, part.rotation.w);
    for (let i = 0; i < pts.length; i += 3) {
      v.set(pts[i], pts[i + 1], pts[i + 2]).applyQuaternion(q);
      min.x = Math.min(min.x, v.x + part.offset.x);
      min.y = Math.min(min.y, v.y + part.offset.y);
      min.z = Math.min(min.z, v.z + part.offset.z);
      max.x = Math.max(max.x, v.x + part.offset.x);
      max.y = Math.max(max.y, v.y + part.offset.y);
      max.z = Math.max(max.z, v.z + part.offset.z);
    }
  }
  return { min, max };
}
