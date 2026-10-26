import { Euler, Quaternion, Vector3 } from 'three';
import { clamp, dirToHeading } from '../../math';
import type { StructureKind, StructureVariant, Terrain, Vec3 } from '../../types';
import {
  CONTACT_RESTITUTION,
  momentumBreakImpulse,
  REFERENCE_ICEBERG_MASS,
  type ObstacleMaterial,
  type ProxyMode,
} from '../catalog';
import { getGeom, KIT_BOX, kitCylinder, kitHull, kitLathe, kitPrism, type GeomKey } from '../shapes';
import {
  centreOfMassY,
  DEFAULT_BREAKUP,
  partsBounds,
  pick,
  restingY,
  rotateVec,
  yawQuat,
  type BodyPart,
  type BodySpec,
  type Breakup,
  type PlanFootprint,
  type PlumeKind,
  type Quat,
  type SignalLamp,
  type SpawnOptions,
} from '../specs';

/**
 * Structure kit: turns a StructureDef (plain data + a small build function, one file per kind)
 * into BodySpecs for the physics world and the renderer. See ./index.ts for the authoring guide.
 */

export type V3 = readonly [number, number, number];
/** 2D points: [radius, y] for lathes, [u, v] outlines for prisms (any units, normalised). */
export type Profile = readonly (readonly [number, number])[];

/**
 * A shape primitive. Every kit shape fills the unit cube [-0.5, 0.5]³ before scaling, so PartDef.size
 * is its real size in metres; colliders are built from exactly the rendered vertices.
 */
export type ShapeRef =
  | 'box'
  /** Axis +y, diameter size[0]/size[2], height size[1]. taper = top radius / bottom radius. */
  | { readonly type: 'cylinder'; readonly segments?: number; readonly taper?: number }
  /** Apex at +y. */
  | { readonly type: 'cone'; readonly segments?: number }
  /** Surface of revolution of [radius, y] points (bottom to top) about +y; collides as its hull. */
  | { readonly type: 'lathe'; readonly id: string; readonly profile: Profile; readonly segments?: number }
  /**
   * Convex 2D outline extruded along z (outline in x/y), along x (axis 'x': outline in z/y) or along
   * y (axis 'y': a plan outline in x/z).
   */
  | {
      readonly type: 'prism';
      readonly id: string;
      readonly outline: Profile;
      readonly axis?: 'x' | 'y' | 'z';
    }
  /**
   * Convex hull of `points` ([x, y, z], any units, normalised to the unit cube): e.g. a slab whose
   * sides stand plumb in a tilted body (a sheared prism). Ids must be unique per point set.
   */
  | { readonly type: 'hull'; readonly id: string; readonly points: readonly V3[] }
  /** A shape-kit geometry at its own size (size = per-axis multiplier), e.g. the house walls. */
  | { readonly type: 'geom'; readonly key: GeomKey };

export interface PartDef {
  readonly shape: ShapeRef;
  /** Centre of the shape in the BODY's local frame (metres, before placement scale). */
  readonly at: V3;
  /** Size of the unit cube the shape is fitted into (metres); a multiplier for 'geom'. */
  readonly size: V3;
  /** Euler XYZ rotation (radians) about the part centre. */
  readonly rot?: V3;
  /** Palette name (StructureDef.palettes, picked once per instance) or a fixed 0xRRGGBB. */
  readonly color: string | number;
  /** Proxy label of the debris piece (default: piece name or the body's part). */
  readonly name?: string;
  /** Relative mass weight inside its body (default: the shape's volume). */
  readonly weight?: number;
  /** Render-only detail (windows, lamps, balusters): no collider, no mass. */
  readonly decor?: boolean;
  /**
   * Parts sharing a piece name fly off together when the body shatters (default: every collider
   * part is its own piece; decor follows the nearest collider part).
   */
  readonly piece?: string;
  /**
   * Living world, render-only:
   * - lamp: a traffic-light lamp, drawn glowing while its body's signal shows that colour;
   * - spin: turned about `axis` through `pivot` (body frame, nominal m) at `rate` rad/s while the
   *   body is undisturbed (wind turbine blades);
   * - plume: smoke / steam rising from the part's top centre while the body stands.
   */
  readonly lamp?: SignalLamp;
  readonly spin?: { readonly axis: V3; readonly pivot: V3; readonly rate: number };
  readonly plume?: PlumeKind;
}

/**
 * - anchored: immovable until the iceberg's momentum test J = (1+e)·vn·M reaches breakImpulse
 * - resting: loose but placed exactly (asleep) where the build put it, e.g. a deck on its posts;
 *   it falls when what holds it breaks
 * - loose: a free body set down on the ground and tilted onto the slope (vehicles)
 */
export type Stand = 'anchored' | 'resting' | 'loose';

export interface BodyDef {
  /** Proxy label while intact ('house', 'post', 'deck', 'car', ...). */
  readonly part: string;
  readonly parts: readonly PartDef[];
  readonly stand: Stand;
  /** Total mass (t) before placement scale (scales with scale³). */
  readonly mass: number;
  /** Body origin in the structure frame (default [0, 0, 0]) and extra yaw (radians). */
  readonly at?: V3;
  readonly yaw?: number;
  /**
   * Rotation (radians) about the body's own z axis, applied before the yaw: + raises its +x end
   * (a bridge deck on a grade, the abutment under its end).
   */
  readonly tilt?: number;
  /** The iceberg rides over it like the ground: no contact (an abutment buried in a bank). */
  readonly passable?: boolean;
  /**
   * Plan footprint in the body frame (nominal m) of a body with skewed ends (BodySpec.footprint):
   * its proxy is that quadrilateral, not the bounding rectangle.
   */
  readonly footprint?: PlanFootprint;
  /**
   * anchored: closing speed (m/s) at which a 30 t iceberg breaks it under the momentum rule
   * (omitted = unbreakable); loose: speed at which a 30 t hit shatters it (loose-body impulse).
   */
  readonly breakSpeed?: number;
  /** 'shatter': each piece becomes a body (default); 'uproot': it topples as one body. */
  readonly breakMode?: 'shatter' | 'uproot';
  readonly breakup?: Partial<Breakup>;
  /** Default: 'footprint' when anchored, 'extent' otherwise ('trunk' needs trunkRadius). */
  readonly proxy?: ProxyMode;
  readonly trunkRadius?: number;
  /** 'trunk' proxy as a square of half-width trunkRadius aligned with the body (BodySpec.squareTrunk). */
  readonly squareTrunk?: boolean;
  /**
   * How the origin's height is found. 'footprint' (anchored default): the lowest parts sit at the
   * lowest ground under them, slightly sunk. 'rest' (loose default): tilted onto the slope with the
   * lowest vertex on the ground. 'fixed' (resting default): at.y metres above the ground at the
   * structure origin (use ctx.groundAt to lay things on uneven ground). 'float': over open water the
   * origin sits at sea level + at.y metres (negative = draft below the waterline); on land like 'rest'.
   */
  readonly ground?: 'footprint' | 'rest' | 'fixed' | 'float';
  readonly material?: ObstacleMaterial;
  /** Counts toward buildingsDestroyed when it shatters (default: StructureDef.building). */
  readonly building?: boolean;
  /** 'shook' wobble style (default: 'tilt' for trunk proxies, 'offset' otherwise). */
  readonly shake?: 'tilt' | 'offset';
  /** Needs warm-up settling (stacks). Default false. */
  readonly settle?: boolean;
  /** Continuous collision detection (default: loose bodies under 3 t). */
  readonly ccd?: boolean;
  /**
   * Height (nominal m above the body origin) where an uprooting hit is applied. Default: a little
   * above the centre of mass, so trees topple forward; posts under a deck want the iceberg's
   * contact height instead, so their base is knocked out from under the load.
   */
  readonly hitHeight?: number;
}

/** Everything a build function may use. Distances are in the structure's unscaled local frame. */
export interface StructureContext {
  /** Deterministic per-placement random numbers. */
  readonly rng: () => number;
  /** Placement scale (already applied by the kit: build in nominal metres). */
  readonly scale: number;
  /** Spanning kinds: length to cover along local x (nominal metres); 0 otherwise. */
  readonly span: number;
  /** Signed lateral course offset of the placement (+ = right of travel). */
  readonly d: number;
  /** Colour from a named palette, picked once per structure instance. */
  palette(name: string): number;
  /**
   * Ground height under local (x, z), relative to the ground at the structure origin (nominal
   * metres). Not available inside defaultYaw (the orientation is not decided yet).
   */
  groundAt(x: number, z: number): number;
  /**
   * The ground at local (x, z) before the bridge approach cuttings graded it
   * (src/core/terrain/bridgeCuts.ts; relative like groundAt): what bridge decks are planned on, so
   * the cuttings, made against a deck's plan, cannot move the plan. Equal to groundAt away from
   * bridges.
   */
  ungradedAt(x: number, z: number): number;
  /**
   * The ground at local (x, z) as if no cut were there, neither a fatal one (gap, ravine: its rim
   * height) nor a bridge approach cutting (relative like groundAt). Equal to groundAt elsewhere.
   */
  uncutAt(x: number, z: number): number;
  /** How far (world m) local (x, z) lies beyond the floor edge (negative: on the floor). */
  beyondFloor(x: number, z: number): number;
  /**
   * Sea level relative to the ground at the structure origin (nominal metres, like groundAt):
   * positive when the origin is on the sea floor. Lets a kind that stands IN the sea (oilRig) reach
   * from the sea floor to a deck above the water.
   */
  readonly seaLevel: number;
  /**
   * The placement's look (ObstaclePlacement.variant) when the definition offers it
   * (StructureDef.variants); undefined = the intact building.
   */
  readonly variant?: StructureVariant;
}

export interface StructureDef {
  readonly kind: StructureKind | 'house';
  readonly label: string;
  readonly material: ObstacleMaterial;
  /** Shattering counts toward ObstacleStats.buildingsDestroyed. */
  readonly building?: boolean;
  /**
   * Conservative horizontal radius (m) at scale 1 for placement validation. Spanning kinds: the
   * half depth along the course (their length is `span`).
   */
  readonly footprint: number;
  /** Named sRGB palettes (realistic colours); each name is picked once per instance. */
  readonly palettes: Readonly<Record<string, readonly number[]>>;
  /**
   * Spanning kinds lay out along local x (across the valley at yaw 0) over ObstaclePlacement.span,
   * defaulting to the floor width ('floor') or a fixed length; clamped to [min, max].
   */
  readonly span?: { readonly default: number | 'floor'; readonly min: number; readonly max?: number };
  readonly breakup?: Partial<Breakup>;
  /**
   * Looks besides the intact one that build() honours through ctx.variant (e.g. 'ruined', see
   * ./ruin.ts). Placement validation rejects a variant its kind does not list.
   */
  readonly variants?: readonly StructureVariant[];
  /** Yaw relative to the course when the placement omits it (default 0 = facing down-course). */
  defaultYaw?(ctx: StructureContext): number;
  /** Bodies in the structure frame: x across the valley, y up, z down-course / facing. */
  build(ctx: StructureContext): BodyDef[];
}

export type StructureSpawnOptions = SpawnOptions & { placement?: number };

/** Span used for spanning kinds spawned without course context (runtime spawns). */
const FALLBACK_SPAN = 20;
/** Bodies are sunk this far (m, × scale) into the lowest ground under their footprint. */
const FOOTPRINT_SINK = 0.05;

const _q = new Quaternion();
const _e = new Euler();
const _up = new Vector3(0, 1, 0);
const _n = new Vector3();

/** Resolve a ShapeRef to a registered geometry key. */
export function shapeKey(shape: ShapeRef): GeomKey {
  if (shape === 'box') return KIT_BOX;
  switch (shape.type) {
    case 'cylinder':
      return kitCylinder(shape.segments ?? 8, shape.taper ?? 1);
    case 'cone':
      return kitCylinder(shape.segments ?? 8, 0);
    case 'lathe':
      return kitLathe(shape.id, shape.profile, shape.segments ?? 12);
    case 'prism':
      return kitPrism(shape.id, shape.outline, shape.axis ?? 'z');
    case 'hull':
      return kitHull(shape.id, shape.points);
    case 'geom':
      getGeom(shape.key);
      return shape.key;
  }
}

function eulerQuat(rot: V3 | undefined): Quat {
  if (!rot) return { x: 0, y: 0, z: 0, w: 1 };
  _q.setFromEuler(_e.set(rot[0], rot[1], rot[2], 'XYZ'));
  return { x: _q.x, y: _q.y, z: _q.z, w: _q.w };
}

/** Evenly split `span` into about span / target segments: count, length and centres (local x). */
export function spanSegments(
  span: number,
  target: number,
): { n: number; length: number; centres: number[] } {
  const n = Math.max(1, Math.round(span / target));
  const length = span / n;
  const centres = Array.from({ length: n }, (_, i) => -span / 2 + (i + 0.5) * length);
  return { n, length, centres };
}

/** Highest ground (relative, nominal metres) along local x in [x0, x1] at each of `zs`. */
export function maxGround(
  ctx: StructureContext,
  x0: number,
  x1: number,
  zs: readonly number[],
  step = 1,
): number {
  let top = -Infinity;
  const n = Math.max(1, Math.ceil((x1 - x0) / step));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    for (const z of zs) top = Math.max(top, ctx.groundAt(x, z));
  }
  return top;
}

/**
 * Body specs for one placement of `def` at world (x, z). Placement yaw is relative to the course
 * direction (opts.dirX/dirZ); the placement scale multiplies sizes, mass (³) and strength (²).
 */
export function buildStructureSpecs(
  def: StructureDef,
  x: number,
  z: number,
  terrain: Terrain,
  rng: () => number,
  opts: StructureSpawnOptions = {},
): BodySpec[] {
  const env = structureFrame(def, x, z, terrain, rng, opts);
  return def.build(env.ctx).map((bd) => bodySpec(env, bd));
}

/** Where a placement stands: its context, yaw and local → world transform (see BuildEnv). */
export type StructureFrame = Readonly<BuildEnv>;

/**
 * The frame one placement of `def` is built in (what buildStructureSpecs hands its build): the
 * StructureContext, the final yaw and the local (nominal metres) → world x/z transform. Exposed so
 * code that must agree with a build (bridge decks: src/core/obstacles/bridges.ts) sees the same
 * ground the build saw.
 */
export function structureFrame(
  def: StructureDef,
  x: number,
  z: number,
  terrain: Terrain,
  rng: () => number,
  opts: StructureSpawnOptions = {},
): StructureFrame {
  const s = opts.scale ?? 1;
  const dl = Math.hypot(opts.dirX ?? 0, opts.dirZ ?? 1) || 1;
  const courseYaw = dirToHeading((opts.dirX ?? 0) / dl, (opts.dirZ ?? 1) / dl);
  let span = 0;
  if (def.span) {
    const floor = opts.halfWidth !== undefined ? 2 * opts.halfWidth : FALLBACK_SPAN;
    const dflt = def.span.default === 'floor' ? floor : def.span.default;
    span = clamp(opts.span ?? dflt, def.span.min, def.span.max ?? Infinity);
  }
  const originY = terrain.heightAt(x, z);
  let yaw = courseYaw;
  let cos = Math.cos(yaw);
  let sin = Math.sin(yaw);
  // Structure-local (nominal metres) → world x/z: rotate by yaw about +y, then scale.
  const worldX = (lx: number, lz: number): number => x + s * (lx * cos + lz * sin);
  const worldZ = (lx: number, lz: number): number => z + s * (-lx * sin + lz * cos);
  const picked = new Map<string, number>();
  const ctx: StructureContext = {
    rng,
    scale: s,
    span: span / s,
    d: opts.d ?? 0,
    palette(name: string): number {
      let c = picked.get(name);
      if (c === undefined) {
        const p = def.palettes[name];
        if (!p || p.length === 0) throw new Error(`${def.kind}: unknown palette "${name}"`);
        c = pick(rng, p);
        picked.set(name, c);
      }
      return c;
    },
    groundAt: (lx, lz) => (terrain.heightAt(worldX(lx, lz), worldZ(lx, lz)) - originY) / s,
    ungradedAt: (lx, lz) => {
      const wx = worldX(lx, lz);
      const wz = worldZ(lx, lz);
      return (terrain.heightAt(wx, wz) + (terrain.bridgeCutAt?.(wx, wz) ?? 0) - originY) / s;
    },
    uncutAt: (lx, lz) => {
      const wx = worldX(lx, lz);
      const wz = worldZ(lx, lz);
      const cut = (terrain.ravineDepthAt?.(wx, wz) ?? 0) + (terrain.bridgeCutAt?.(wx, wz) ?? 0);
      return (terrain.heightAt(wx, wz) + cut - originY) / s;
    },
    beyondFloor: (lx, lz) => {
      const c = terrain.course.project(worldX(lx, lz), worldZ(lx, lz));
      const L = terrain.course.length;
      return Math.abs(c.d) - terrain.course.sampleAt(Math.min(Math.max(c.s, 0), L)).halfWidth;
    },
    seaLevel: (terrain.level.seaLevel - originY) / s,
    ...(opts.variant && def.variants?.includes(opts.variant) ? { variant: opts.variant } : {}),
  };
  yaw = courseYaw + (opts.yaw ?? def.defaultYaw?.(ctx) ?? 0);
  cos = Math.cos(yaw);
  sin = Math.sin(yaw);
  const placement = opts.placement ?? -1;
  return { def, terrain, s, yaw, originY, worldX, worldZ, ctx, placement };
}

interface BuildEnv {
  def: StructureDef;
  terrain: Terrain;
  s: number;
  yaw: number;
  originY: number;
  worldX: (lx: number, lz: number) => number;
  worldZ: (lx: number, lz: number) => number;
  ctx: StructureContext;
  placement: number;
}

function bodySpec(env: BuildEnv, bd: BodyDef): BodySpec {
  const { def, terrain, s } = env;
  const at = bd.at ?? [0, 0, 0];
  const parts = buildParts(env, bd);
  const mass = bd.mass * s * s * s;
  const anchored = bd.stand === 'anchored';
  const wx = env.worldX(at[0], at[2]);
  const wz = env.worldZ(at[0], at[2]);
  let rotation = tiltedYaw(env.yaw + (bd.yaw ?? 0), bd.tilt ?? 0);
  let y: number;
  const ground = bd.ground ?? (anchored ? 'footprint' : bd.stand === 'loose' ? 'rest' : 'fixed');
  const sea = terrain.level.seaLevel;
  if (ground === 'float' && terrain.heightAt(wx, wz) < sea + at[1] * s) {
    y = sea + at[1] * s;
  } else if (ground === 'fixed') {
    y = env.originY + at[1] * s;
  } else if (ground === 'footprint') {
    y = footprintBase(terrain, wx, wz, rotation, parts) - FOOTPRINT_SINK * s;
  } else {
    const nrm = terrain.normalAt(wx, wz);
    _q.setFromUnitVectors(_up, _n.set(nrm.x, nrm.y, nrm.z)).multiply(
      new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
    );
    rotation = { x: _q.x, y: _q.y, z: _q.z, w: _q.w };
    y = restingY(terrain, wx, wz, rotation, parts) - 0.02;
  }
  let breakImpulse = Infinity;
  let breakMode: BodySpec['breakMode'] = 'none';
  if (bd.breakSpeed !== undefined && bd.stand !== 'resting') {
    if (anchored) {
      breakImpulse = momentumBreakImpulse(bd.breakSpeed, s);
      breakMode = bd.breakMode ?? 'shatter';
    } else {
      const M = REFERENCE_ICEBERG_MASS;
      breakImpulse = (1 + CONTACT_RESTITUTION) * bd.breakSpeed * ((M * mass) / (M + mass));
      breakMode = 'shatter';
    }
  }
  const proxyMode = bd.proxy ?? (anchored ? 'footprint' : 'extent');
  const b = partsBounds(parts);
  return {
    kind: def.kind,
    part: bd.part,
    material: bd.material ?? def.material,
    proxyMode,
    position: { x: wx, y, z: wz },
    rotation,
    anchored,
    mass,
    breakImpulse,
    breakMode,
    hitHeight:
      bd.hitHeight !== undefined ? bd.hitHeight * s : centreOfMassY(parts) + 0.1 * (b.max.y - b.min.y),
    trunkRadius: (bd.trunkRadius ?? 0) * s,
    ...(bd.squareTrunk ? { squareTrunk: true } : {}),
    ...(bd.passable ? { passable: true } : {}),
    ...(bd.footprint ? { footprint: scaleFootprint(bd.footprint, s) } : {}),
    ccd: bd.ccd ?? (bd.stand === 'loose' && mass < 3),
    settle: bd.settle ?? false,
    parts,
    placement: env.placement,
    building: bd.building ?? def.building ?? false,
    breakup: { ...DEFAULT_BREAKUP, ...def.breakup, ...bd.breakup },
    shakeStyle: bd.shake ?? (proxyMode === 'trunk' ? 'tilt' : 'offset'),
  };
}

/** A body-frame footprint at placement scale (its skews are ratios and stay). */
const scaleFootprint = (f: PlanFootprint, s: number): PlanFootprint => ({
  x0: f.x0 * s,
  x1: f.x1 * s,
  k0: f.k0,
  k1: f.k1,
  hz: f.hz * s,
  y0: f.y0 * s,
  y1: f.y1 * s,
});

/** yaw (about +y) ∘ tilt (about the body's z, applied first): + tilt raises the +x end. */
function tiltedYaw(yaw: number, tilt: number): Quat {
  if (tilt === 0) return yawQuat(yaw);
  const sy = Math.sin(yaw / 2);
  const cy = Math.cos(yaw / 2);
  const st = Math.sin(tilt / 2);
  const ct = Math.cos(tilt / 2);
  return { x: sy * st, y: sy * ct, z: cy * st, w: cy * ct };
}

function buildParts(env: BuildEnv, bd: BodyDef): BodyPart[] {
  const { s, ctx } = env;
  if (!bd.parts.some((p) => !p.decor)) throw new Error(`${env.def.kind}/${bd.part}: no collider parts`);
  const keys = bd.parts.map((p) => shapeKey(p.shape));
  const weights = bd.parts.map((p, i) => {
    if (p.decor) return 0;
    if (p.weight !== undefined) return p.weight;
    return getGeom(keys[i]).volume * p.size[0] * p.size[1] * p.size[2];
  });
  const wsum = weights.reduce((a, w) => a + w, 0) || 1;
  const mass = bd.mass * s * s * s;
  // Piece index per part: named pieces share one; unnamed collider parts are their own piece.
  const named = new Map<string, number>();
  let next = 0;
  const piece = bd.parts.map((p) => {
    if (p.decor) return -1;
    if (p.piece === undefined) return next++;
    let i = named.get(p.piece);
    if (i === undefined) {
      i = next++;
      named.set(p.piece, i);
    }
    return i;
  });
  bd.parts.forEach((p, i) => {
    if (!p.decor) return;
    if (p.piece !== undefined && named.has(p.piece)) {
      piece[i] = named.get(p.piece) ?? 0;
      return;
    }
    let best = Infinity;
    bd.parts.forEach((q, j) => {
      if (q.decor) return;
      const d = Math.hypot(q.at[0] - p.at[0], q.at[1] - p.at[1], q.at[2] - p.at[2]);
      if (d < best) {
        best = d;
        piece[i] = piece[j];
      }
    });
  });
  return bd.parts.map((p, i): BodyPart => {
    const color = typeof p.color === 'number' ? p.color : ctx.palette(p.color);
    const part: BodyPart = {
      geom: keys[i],
      name: p.name ?? p.piece ?? bd.part,
      offset: { x: p.at[0] * s, y: p.at[1] * s, z: p.at[2] * s },
      rotation: eulerQuat(p.rot),
      scale: { x: p.size[0] * s, y: p.size[1] * s, z: p.size[2] * s },
      color,
      mass: (mass * weights[i]) / wsum,
      piece: piece[i],
      ...living(p, s),
    };
    return p.decor ? { ...part, decor: true } : part;
  });
}

/** The render-only living-world fields of a part, scaled (only those it has). */
function living(p: PartDef, s: number): Pick<BodyPart, 'lamp' | 'spin' | 'plume'> {
  const out: { lamp?: SignalLamp; spin?: BodyPart['spin']; plume?: PlumeKind } = {};
  if (p.lamp) out.lamp = p.lamp;
  if (p.plume) out.plume = p.plume;
  if (p.spin) {
    const [ax, ay, az] = p.spin.axis;
    const l = Math.hypot(ax, ay, az) || 1;
    out.spin = {
      axis: { x: ax / l, y: ay / l, z: az / l },
      pivot: { x: p.spin.pivot[0] * s, y: p.spin.pivot[1] * s, z: p.spin.pivot[2] * s },
      rate: p.spin.rate,
    };
  }
  return out;
}

/**
 * Lowest ground under the parts that touch the ground (those whose bottom is within 0.5 m of the
 * lowest part), returned as the body-origin y that puts those parts' bottoms on it.
 */
function footprintBase(
  terrain: Terrain,
  x: number,
  z: number,
  rotation: Quat,
  parts: readonly BodyPart[],
): number {
  const all = partsBounds(parts);
  const low = parts.filter((p) => !p.decor && partsBounds([p]).min.y <= all.min.y + 0.5);
  const b = partsBounds(low);
  const c: Vec3 = { x: 0, y: 0, z: 0 };
  let base = Infinity;
  for (const [cx, cz] of [
    [b.min.x, b.min.z],
    [b.max.x, b.min.z],
    [b.max.x, b.max.z],
    [b.min.x, b.max.z],
    [(b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2],
  ]) {
    rotateVec(rotation, cx, 0, cz, c);
    base = Math.min(base, terrain.heightAt(x + c.x, z + c.z));
  }
  return base - all.min.y;
}
