import RAPIER, {
  type Collider,
  type ColliderDesc,
  type RigidBody,
  type World,
} from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { clamp } from '../math';
import { createRng } from '../rng';
import type {
  ChunkSource,
  ContactOutcome,
  GameEvent,
  IcebergContact,
  ObstacleKind,
  ObstacleProxy,
  ObstacleState,
  ObstacleStats,
  PhysicsWorldApi,
  ProxyRect,
  RiverBank,
  RiverTrailApi,
  Terrain,
  Vec3,
} from '../types';
import {
  CONTACT_RESTITUTION,
  ICE,
  isRockKind,
  isTreeKind,
  type ObstacleMaterial,
  type ProxyMode,
} from '../obstacles/catalog';
import { iceChunkSpecs } from '../obstacles/ice';
import { getGeom, scaledPoints } from '../obstacles/shapes';
import { buildObstacleSpecs, placementRng, specsForKind } from '../obstacles/spawn';
import {
  DEFAULT_BREAKUP,
  type BodyPart,
  type BodySpec,
  type BreakMode,
  type Breakup,
  type PlanFootprint,
  type Quat,
  type SpawnOptions,
} from '../obstacles/specs';
import { rectCorners, rectGap, rectRadius, type RectDirection } from '../proxyRect';
import { bridgePlans } from '../obstacles/bridges';
import { DeckGround, isParapetId, type DeckBarrier, type DeckSurface } from './deckGround';
import { SpatialGrid } from './spatialHash';
import { PHYSICS_TUNING as T, WATER_TUNING as W } from './tuning';
import { parkingAt, roadLineAt } from '../terrain/roads';
import {
  laneOffset as laneOffsetOf,
  nearestLane,
  trafficNetwork,
  type TrafficPath,
} from '../traffic/network';
import { type SignalState } from '../traffic/signals';
import {
  pointAt,
  TrafficSystem,
  VEHICLE_SPECS,
  type VehicleKind,
  type VehicleSpawn,
} from '../traffic/traffic';

let initPromise: Promise<void> | null = null;

/** Initialise the Rapier WASM module once (works in the browser and in vitest/node). */
export function initRapier(): Promise<void> {
  if (!initPromise) {
    initPromise = RAPIER.init().catch((e: unknown) => {
      initPromise = null;
      throw e;
    });
  }
  return initPromise;
}

/**
 * One Rapier step: World.step without the handle bookkeeping it runs after every step
 * (rapier3d-compat 0.21's mapNewSoftBodies walks every collider and body through JS callbacks to
 * pick up ones created outside the JS API: soft bodies, deserialisation). Here every body and
 * collider is created and removed through the API, which keeps those maps current, so the walk
 * finds nothing; on a crowded level (chapter 7: 2,560 colliders) it cost more than the step itself.
 * The simulation is the same.
 */
export function stepRapier(w: World): void {
  w.physicsPipeline.step(
    w.gravity,
    w.integrationParameters,
    w.islands,
    w.broadPhase,
    w.narrowPhase,
    w.bodies,
    w.colliders,
    w.softBodies,
    w.impulseJoints,
    w.multibodyJoints,
    w.ccdSolver,
  );
}

export interface ShakeState {
  /** 0..1 strength (J / breakImpulse, floored); 0 = not shaking. */
  amp: number;
  /** Horizontal push direction (unit). */
  dirX: number;
  dirZ: number;
  /** World time (PhysicsWorld.time) when the shake started. */
  t0: number;
}

/** One rigid body in the obstacle world. Fields are live; renderers read pos/quat each frame. */
export interface ObstacleBody {
  readonly id: number;
  /** Id of the original level obstacle this body came from (== id unless it is debris). */
  readonly originId: number;
  readonly kind: ObstacleKind;
  readonly part: string;
  readonly material: ObstacleMaterial;
  readonly parts: readonly BodyPart[];
  /** Loose mass (t). */
  readonly mass: number;
  readonly breakImpulse: number;
  readonly breakMode: BreakMode;
  readonly hitHeight: number;
  readonly trunkRadius: number;
  /** Its 'trunk' proxy is a square aligned with it (BodySpec.squareTrunk). */
  readonly squareTrunk: boolean;
  /** Index into level.obstacles, -1 for runtime spawns/debris. */
  readonly placement: number;
  proxyMode: ProxyMode;
  anchored: boolean;
  state: ObstacleState;
  /** False once removed (broken apart, fell out of the world, left the bounds). */
  active: boolean;
  sleeping: boolean;
  readonly pos: Vec3;
  readonly quat: Quat;
  /** Position after warm-up (or at creation for debris/runtime spawns). */
  readonly spawn: Vec3;
  readonly proxy: ObstacleProxy;
  /** The footprint rectangle proxy.rect points at while the body is elongated (reused). */
  readonly rect: ProxyRect;
  /**
   * Exact plan footprint of a body with skewed ends (BodySpec.footprint): while it stands (its own
   * z axis level), its proxy is that quadrilateral rather than the bounding rectangle.
   */
  readonly footprint: PlanFootprint | null;
  readonly shake: ShakeState;
  /** Body-local AABB of all parts. */
  readonly localMin: Vec3;
  readonly localMax: Vec3;
  /** Max distance of any hull vertex from the body origin. */
  readonly boundingRadius: number;
  /** Angular velocity (rad/s) at the last refresh. */
  readonly angVel: Vec3;
  /** Seconds the body has been nearly still (drives early sleep). */
  restTime: number;
  /** Seconds the body has been awake far from the focus point (distance LOD). */
  farTime: number;
  inWater: boolean;
  everWet: boolean;
  lastHitTime: number;
  /** Horizontal distance travelled while carried by water vs. anything else. */
  waterTravel: number;
  otherTravel: number;
  /** Tallies already credited to this body's origin (only meaningful on original bodies). */
  countedKnocked: boolean;
  countedRock: boolean;
  countedSwept: boolean;
  /** Glacier ice the iceberg absorbs on contact (absorb(id) removes it). */
  readonly absorbable: boolean;
  /** Counts toward ObstacleStats.buildingsDestroyed when it shatters. */
  readonly building: boolean;
  /** Left out of the knocked / rocks / swept tallies (glacier ice and ice chunks). */
  readonly noTally: boolean;
  /** How a shattering body hands the hit to its pieces. */
  readonly breakup: Breakup;
  /** 'shook' wobble: tilt about the base (trees, posts) or a sideways jolt (buildings). */
  readonly shakeStyle: 'tilt' | 'offset';
  /** Uniform scale of the rendered parts (and, stepwise, the colliders): < 1 while a chunk melts. */
  renderScale: number;
  /** World time before which proxiesNear() leaves the body out (fresh ice chunks). */
  hiddenUntil: number;
  /** World time at which the body melts away and is removed (Infinity = never). */
  expiresAt: number;
  /** PhysicsWorld.stampSeq when the transform, shake or renderScale last changed. */
  stamp: number;
  /**
   * Released toppler (PHYSICS_TUNING.toppleRate): world time until which it is kept tipping over,
   * and the horizontal unit direction it was pushed (-Infinity / unused otherwise).
   */
  toppleUntil: number;
  toppleX: number;
  toppleZ: number;
  /**
   * Driving in the road traffic: its pose comes from PhysicsWorld.traffic every step and its rigid
   * body is disabled, until it is hit, flooded or loses its road (then an ordinary dynamic body).
   */
  driven: boolean;
  /** Its spinning parts (BodyPart.spin) turn: true until the body is disturbed (render-only). */
  spinning: boolean;
  /** Traffic light: the junction and signal phase its lamps show (junction -1: its own cycle). */
  signal: { junction: number; group: number } | null;
}

/** Result of PhysicsWorld.raycastBodies. */
export interface BodyRayHit {
  id: number;
  /** World y of the hit point. */
  y: number;
}

export interface PhysicsWorldOptions {
  seed: number;
  /** Spawn terrain.level.obstacles (default true). */
  spawnLevelObstacles?: boolean;
  /** Warm-up steps after spawning (default PHYSICS_TUNING.warmUpSteps). */
  warmUpSteps?: number;
  /** 'course' keeps only cells near the course plus the coast (default); 'full' meshes everything. */
  terrainMode?: 'course' | 'full';
  /**
   * Road traffic (default true): vehicles placed on roads drive, signalised junctions get traffic
   * lights. false = every vehicle stays parked and no lights are added (old behaviour).
   */
  traffic?: boolean;
}

export interface PhysicsBuildInfo {
  terrainTriangles: number;
  terrainMs: number;
  /** True when the trimesh arrays came from the per-terrain cache (restarts). */
  terrainCached: boolean;
  spawnMs: number;
  warmUpMs: number;
}

interface TerrainMesh {
  readonly verts: Float32Array;
  readonly indices: Uint32Array;
}

/**
 * Trimesh arrays per terrain and mode. Terrains are immutable and cached per level, so a restart
 * only has to hand these to Rapier instead of re-deriving the course mask (~120 ms on level 1).
 */
const terrainMeshCache = new WeakMap<Terrain, Partial<Record<'course' | 'full', TerrainMesh>>>();

function buildTerrainMesh(terrain: Terrain, mode: 'course' | 'full'): TerrainMesh {
  const g = terrain.grid;
  const { cols, rows, cellSize, originX, originZ, heights } = g;
  const verts = new Float32Array(cols * rows * 3);
  for (let iz = 0; iz < rows; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      const i = iz * cols + ix;
      verts[i * 3] = originX + ix * cellSize;
      verts[i * 3 + 1] = heights[i];
      verts[i * 3 + 2] = originZ + iz * cellSize;
    }
  }
  let keep: Uint8Array | null = null;
  if (mode === 'course') {
    keep = new Uint8Array(cols * rows);
    const course = terrain.course;
    const level = terrain.level;
    const coastY = level.seaLevel + T.coastBand;
    for (let iz = 0; iz < rows; iz++) {
      for (let ix = 0; ix < cols; ix++) {
        const i = iz * cols + ix;
        const x = originX + ix * cellSize;
        const z = originZ + iz * cellSize;
        if (heights[i] <= coastY) {
          keep[i] = 1;
          continue;
        }
        const p = course.project(x, z);
        const hw = course.sampleAt(clamp(p.s, 0, course.length)).halfWidth;
        if (Math.abs(p.d) < hw + level.wallRamp + T.terrainMargin || p.s >= level.coastS - 10) keep[i] = 1;
      }
    }
  }
  const idx: number[] = [];
  for (let iz = 0; iz + 1 < rows; iz++) {
    for (let ix = 0; ix + 1 < cols; ix++) {
      const i00 = iz * cols + ix;
      const i10 = i00 + 1;
      const i01 = i00 + cols;
      const i11 = i01 + 1;
      if (keep && !(keep[i00] | keep[i10] | keep[i01] | keep[i11])) continue;
      // Same split as heightGrid: (00,10,11) and (00,11,01), wound so normals face +Y.
      idx.push(i00, i11, i10, i00, i01, i11);
    }
  }
  return { verts, indices: new Uint32Array(idx) };
}

/** Build the obstacle world: Rapier init, terrain trimesh, level obstacles, settle warm-up. */
export async function createPhysicsWorld(terrain: Terrain, opts: PhysicsWorldOptions): Promise<PhysicsWorld> {
  await initRapier();
  const w = new PhysicsWorld(terrain, opts);
  const t0 = performance.now();
  if (opts.spawnLevelObstacles !== false) {
    for (const spec of buildObstacleSpecs(terrain, opts.seed)) w.addBody(spec);
  }
  const t1 = performance.now();
  w.warmUp(opts.warmUpSteps ?? T.warmUpSteps);
  w.buildInfo.spawnMs = t1 - t0;
  w.buildInfo.warmUpMs = performance.now() - t1;
  if (opts.traffic !== false) w.setupTraffic();
  return w;
}

/** Vehicle kinds that drive in road traffic. */
const DRIVING_KINDS: ReadonlySet<ObstacleKind> = new Set<ObstacleKind>(['car', 'truck', 'bus']);

/** Living-world tuning for the traffic the physics world hosts. */
export const TRAFFIC_WORLD = {
  /** A vehicle drives when its placement lies within a road's half-width + this (m). */
  roadMargin: 1,
  /** ...and a lane is within this distance (m). */
  laneReach: 6,
  /** Half-width (m) of the corridor probed ahead of a vehicle for obstacles. */
  laneHalf: 1.3,
  /** Things lower than this above the road (m) are driven over; higher than `overhead`, under. */
  lowClear: 0.35,
  overhead: 3.2,
  /** Extra clearance (m) kept from the iceberg's edge. */
  icebergClear: 1.5,
  /**
   * A road carried over the ground (a bridge deck, a dam crest) that drops this much (m) between
   * probes 3 m apart is broken: stop. Carved ground cannot break, and mountain roads run as steep as
   * 1.7 m in 3 m (Alpine Pass), so there only a drop of groundDrop stops traffic: a wall no vehicle
   * drives (where a road's end runs up the valley side).
   */
  roadDrop: 1.2,
  groundDrop: 2.4,
  /** A vehicle whose support falls this much in one step (its deck gave way) is released. */
  supportDrop: 1,
  /** An awake loose body touching a driving vehicle this fast (m/s, relative) releases it. */
  debrisSpeed: 1.5,
  /** Deck tops within this height (m) of a vehicle carry it (bridges, dam crests). */
  deckReach: 1.5,
  /** A deck carries a wheel this far (m) past its edge: over the joints between bridge decks. */
  deckJoint: 0.3,
  /**
   * A road with something standing in it (TrafficEnv.closed) is probed every closedStep m along it,
   * and judged again at most once every closedEvery traffic steps (1 s).
   */
  closedStep: 3,
  closedEvery: 60,
  /** A vehicle turning round keeps this much room (m) round its box from what stands in the road. */
  turnRoom: 0.3,
  /** A designer-placed traffic light binds to the nearest signalised approach within this (m). */
  lightBind: 30,
  /** Own cycle (s) of a traffic light bound to no junction: green, amber, red. */
  ownCycle: [14, 3, 13] as readonly [number, number, number],
} as const;
const TW = TRAFFIC_WORLD;

const NO_EVENTS: GameEvent[] = [];

const dryAngularDamping = (m: ObstacleMaterial): number => T.materials[m].angularDamping;
const dryLinearDamping = (m: ObstacleMaterial): number => T.materials[m].linearDamping;
const _q1 = new Quaternion();
const _q2 = new Quaternion();
const _v1 = new Vector3();
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Horizontal footprint of a rotated box from the (x, z) projections of its three half axes
 * a, b, q: its bounding rectangle along the longest projection (exact for an upright box, and the
 * tight frame of a lying one), written into `out`. Returns false, leaving `out` alone, unless it is
 * at least PHYSICS_TUNING.rectAspect times as long as wide (a circle approximates it well enough).
 */
export function elongatedRect(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  qx: number,
  qz: number,
  out: ProxyRect,
): boolean {
  const la = ax * ax + az * az;
  const lb = bx * bx + bz * bz;
  const lq = qx * qx + qz * qz;
  let ux = ax;
  let uz = az;
  let l = la;
  if (lb > l) {
    ux = bx;
    uz = bz;
    l = lb;
  }
  if (lq > l) {
    ux = qx;
    uz = qz;
    l = lq;
  }
  if (!(l > 1e-12)) return false;
  l = Math.sqrt(l);
  ux /= l;
  uz /= l;
  const hu = Math.abs(ax * ux + az * uz) + Math.abs(bx * ux + bz * uz) + Math.abs(qx * ux + qz * uz);
  const hv = Math.abs(az * ux - ax * uz) + Math.abs(bz * ux - bx * uz) + Math.abs(qz * ux - qx * uz);
  if (!(hu >= T.rectAspect * hv)) return false;
  out.ux = ux;
  out.uz = uz;
  out.hu = hu;
  out.hv = Math.max(hv, 0.05);
  return true;
}

/**
 * Horizontal distance (m) from (x, z) to a proxy's footprint (≤ 0 inside it): its rectangle, the
 * quadrilateral of a skewed one (ProxyRect.k0 / k1), or its circle.
 */
export function proxyDistance(p: ObstacleProxy, x: number, z: number): number {
  const dx = x - p.x;
  const dz = z - p.z;
  const r = p.rect;
  if (!r) return Math.hypot(dx, dz) - p.radius;
  return rectGap(dx * r.ux + dz * r.uz, dz * r.ux - dx * r.uz, r, _rdir);
}
const _rdir: RectDirection = { nu: 0, nv: 0 };

/**
 * True if the plan box centred at (x, z), reaching hl along the unit vector (hx, hz) and hw across it,
 * overlaps a proxy's footprint: separating axes against its rectangle (or skewed quadrilateral), the
 * box's nearest point against its circle.
 */
export function boxMeetsProxy(
  x: number,
  z: number,
  hx: number,
  hz: number,
  hl: number,
  hw: number,
  p: ObstacleProxy,
): boolean {
  const r = p.rect;
  if (!r) {
    const dx = p.x - x;
    const dz = p.z - z;
    const ea = Math.max(0, Math.abs(dx * hx + dz * hz) - hl);
    const ec = Math.max(0, Math.abs(dx * hz - dz * hx) - hw);
    return ea * ea + ec * ec < p.radius * p.radius;
  }
  const c = rectCorners(r, _bc);
  for (let k = 0; k < 4; k++) {
    const u = c[2 * k];
    const v = c[2 * k + 1];
    _bx[k] = p.x + u * r.ux - v * r.uz;
    _bz[k] = p.z + u * r.uz + v * r.ux;
  }
  // The box's own two axes, then the footprint's four edge normals.
  for (let a = 0; a < 6; a++) {
    let nx: number;
    let nz: number;
    if (a === 0) {
      nx = hx;
      nz = hz;
    } else if (a === 1) {
      nx = -hz;
      nz = hx;
    } else {
      const k = a - 2;
      const m = (k + 1) % 4;
      nx = _bz[m] - _bz[k];
      nz = -(_bx[m] - _bx[k]);
      const l = Math.hypot(nx, nz);
      if (l < 1e-9) continue;
      nx /= l;
      nz /= l;
    }
    const centre = x * nx + z * nz;
    const reach = hl * Math.abs(hx * nx + hz * nz) + hw * Math.abs(hz * nx - hx * nz);
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < 4; k++) {
      const s = _bx[k] * nx + _bz[k] * nz;
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
    if (lo >= centre + reach || hi <= centre - reach) return false;
  }
  return true;
}
const _bc: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
const _bx = new Float64Array(4);
const _bz = new Float64Array(4);

/** Bodies vehicles drive on: road bridge decks and abutments, dam crests. */
export const isDeckBody = (b: ObstacleBody): boolean =>
  (b.kind === 'roadBridge' && (b.part === 'deck' || b.part === 'abutment')) || b.kind === 'dam';

/**
 * Height of a body's top face over world (x, z): the plane of its local top (the top of its collider
 * box) as the body stands, so a deck on a grade carries a vehicle at the height under its wheels
 * (proxy.top would be its highest corner). Equals proxy.top for a level body.
 */
export function deckSurfaceAt(b: ObstacleBody, x: number, z: number): number {
  const { x: qx, y: qy, z: qz, w: qw } = b.quat;
  // The body's local up axis in world space (second column of its rotation).
  const nx = 2 * (qx * qy - qw * qz);
  const ny = 1 - 2 * (qx * qx + qz * qz);
  const nz = 2 * (qy * qz + qw * qx);
  if (!(ny > 0.2)) return b.proxy.top;
  const k = b.renderScale * 0.5;
  const cx = (b.localMin.x + b.localMax.x) * k;
  const cy = b.localMax.y * b.renderScale;
  const cz = (b.localMin.z + b.localMax.z) * k;
  // The top-face centre: pos + R·(cx, cy, cz).
  const r00 = 1 - 2 * (qy * qy + qz * qz);
  const r02 = 2 * (qx * qz + qw * qy);
  const r20 = 2 * (qx * qz - qw * qy);
  const r22 = 1 - 2 * (qx * qx + qy * qy);
  const px = b.pos.x + r00 * cx + nx * cy + r02 * cz;
  const py = b.pos.y + 2 * (qx * qy + qw * qz) * cx + ny * cy + 2 * (qy * qz - qw * qx) * cz;
  const pz = b.pos.z + r20 * cx + nz * cy + r22 * cz;
  return py - (nx * (x - px) + nz * (z - pz)) / ny;
}

/** The barriers along a road bridge's deck and abutments (../obstacles/structures/roadBridge.ts). */
const BARRIER_GEOM = 'kit:prism:roadBridge-barrier';

/**
 * A road bridge body's barriers (decor prisms along its sides) as built, for the parapet walls the
 * iceberg meets (./deckGround.ts): each one's centre line at its base, end to end, and its half
 * width at the base.
 */
function barriersOf(b: ObstacleBody): DeckBarrier[] {
  const out: DeckBarrier[] = [];
  const s = b.renderScale;
  const { x: qx, y: qy, z: qz, w: qw } = b.quat;
  // pos + R·(p·s): R from the body's quaternion.
  const r00 = 1 - 2 * (qy * qy + qz * qz);
  const r01 = 2 * (qx * qy - qw * qz);
  const r02 = 2 * (qx * qz + qw * qy);
  const r10 = 2 * (qx * qy + qw * qz);
  const r11 = 1 - 2 * (qx * qx + qz * qz);
  const r12 = 2 * (qy * qz - qw * qx);
  const r20 = 2 * (qx * qz - qw * qy);
  const r21 = 2 * (qy * qz + qw * qx);
  const r22 = 1 - 2 * (qx * qx + qy * qy);
  for (const part of b.parts) {
    if (part.geom !== BARRIER_GEOM) continue;
    const o = part.offset;
    const k = part.scale;
    const y = (o.y - k.y / 2) * s;
    const z = o.z * s;
    const ends = [(o.x - k.x / 2) * s, (o.x + k.x / 2) * s].map((x) => ({
      x: b.pos.x + r00 * x + r01 * y + r02 * z,
      y: b.pos.y + r10 * x + r11 * y + r12 * z,
      z: b.pos.z + r20 * x + r21 * y + r22 * z,
    }));
    out.push({
      x0: ends[0].x,
      z0: ends[0].z,
      x1: ends[1].x,
      z1: ends[1].z,
      half: (k.z / 2) * s,
      y0: ends[0].y,
      y1: ends[1].y,
    });
  }
  return out;
}

/** World AABB centre and horizontal half extents of a body (scratch output). */
interface FlatBox {
  x: number;
  z: number;
  hx: number;
  hz: number;
}

export class PhysicsWorld implements PhysicsWorldApi {
  readonly terrain: Terrain;
  readonly seed: number;
  readonly stats: ObstacleStats = {
    knockedDown: 0,
    buildingsDestroyed: 0,
    treesFelled: 0,
    rocksMoved: 0,
    sweptByWater: 0,
  };
  /** Every body ever created, indexed by id (inactive ones stay so ids never shift). */
  readonly bodies: ObstacleBody[] = [];
  /** Simulated seconds since the end of warm-up. */
  time = 0;
  steps = 0;
  /** Bumped whenever any body transform or shake changes; renderers skip work when unchanged. */
  version = 0;
  /** Bumped when bodies are added or removed (renderers re-map instance slots). */
  structureVersion = 0;
  /** Monotonic counter behind ObstacleBody.stamp: bodies with stamp > a reader's last seen value changed. */
  stampSeq = 0;
  readonly buildInfo: PhysicsBuildInfo = {
    terrainTriangles: 0,
    terrainMs: 0,
    terrainCached: false,
    spawnMs: 0,
    warmUpMs: 0,
  };

  private readonly world: World;
  private readonly rbs: (RigidBody | null)[] = [];
  private readonly terrainCollider: Collider;
  private readonly grid: SpatialGrid;
  private readonly rng: () => number;
  private readonly seaLevel: number;
  private events: GameEvent[] = [];
  private readonly nearOut: ObstacleProxy[] = [];
  private gridIds = new Int32Array(64);
  private gridXs = new Float64Array(64);
  private gridZs = new Float64Array(64);
  private maxProxyRadius = 0;
  private spawnCounter = 0;
  private warmedUp = false;
  /** Distance-LOD focus (NaN = off; comparisons with NaN are false, so nothing counts as far). */
  private focusX = NaN;
  private focusZ = NaN;
  /** spec.settle per body id (only consulted during warm-up). */
  private readonly settleFlags: boolean[] = [];
  private disposed = false;
  private gridDirty = true;
  private readonly tImp = { x: 0, y: 0, z: 0 };
  private readonly tPt = { x: 0, y: 0, z: 0 };
  private readonly tVel = { x: 0, y: 0, z: 0 };
  /** Rapier rigid-body handle → body id (ray casts). */
  private readonly idByHandle = new Map<number, number>();
  /** Ice chunks broken off the iceberg, oldest first (pruned as they melt or get capped). */
  private chunks: ObstacleBody[] = [];
  /** Released topplers still being kept tipping over (assistTopples). */
  private readonly toppling: ObstacleBody[] = [];
  /** Collider scale each melting chunk was last re-shaped to, by body id. */
  private readonly chunkShape = new Map<number, number>();
  private readonly boxA: FlatBox = { x: 0, z: 0, hx: 0, hz: 0 };
  private readonly boxB: FlatBox = { x: 0, z: 0, hx: 0, hz: 0 };
  /** Road traffic (src/core/traffic): null on levels without roads or traffic lights. */
  traffic: TrafficSystem | null = null;
  /** pathClosed cache per traffic path: the traffic step it was judged at, and the answer. */
  private closedAt = new Int32Array(0);
  private closedState = new Uint8Array(0);
  private readonly closedPt = { x: 0, z: 0 };
  /** Vehicles that gave up driving (TrafficSystem.gaveUp): put to sleep after one settling step. */
  private readonly parking: ObstacleBody[] = [];
  /** Bodies vehicles can drive on (bridge decks, dam crests). */
  private decks: ObstacleBody[] = [];
  /** The road bridges the iceberg rides (./deckGround.ts): built on first use, null = none. */
  private deckGround: DeckGround | null | undefined = undefined;
  /** The parapet walls the iceberg meets this step (icebergGround; proxiesNear hands them out). */
  private parapets: readonly ObstacleProxy[] = [];
  /** The iceberg this step (setIceberg; NaN = unknown) and the river (applyWaterForces). */
  private iceX = NaN;
  /** The iceberg's velocity at the last setIceberg (the parapets carry it along themselves). */
  private iceVx = 0;
  private iceVz = 0;
  private iceZ = NaN;
  private iceR = 0;
  private river: RiverTrailApi | null = null;
  private readonly zero = { x: 0, y: 0, z: 0 };

  /** Requires initRapier() to have resolved. Prefer createPhysicsWorld(). */
  constructor(terrain: Terrain, opts: PhysicsWorldOptions) {
    this.terrain = terrain;
    this.seed = opts.seed;
    this.seaLevel = terrain.level.seaLevel;
    this.rng = createRng((opts.seed ^ 0x0b57ac1e) >>> 0);
    this.world = new RAPIER.World({ x: 0, y: -T.gravity, z: 0 });
    this.world.timestep = T.fixedDt;
    this.world.numSolverIterations = T.solverIterations;
    const t0 = performance.now();
    this.terrainCollider = this.buildTerrain(opts.terrainMode ?? 'course');
    this.buildInfo.terrainMs = performance.now() - t0;
    const b = terrain.level.bounds;
    this.grid = new SpatialGrid(b.minX, b.minZ, b.maxX, b.maxZ, T.hashCell);
  }

  // -------------------------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------------------------

  private buildTerrain(mode: 'course' | 'full'): Collider {
    let byMode = terrainMeshCache.get(this.terrain);
    if (!byMode) {
      byMode = {};
      terrainMeshCache.set(this.terrain, byMode);
    }
    let mesh = byMode[mode];
    this.buildInfo.terrainCached = mesh !== undefined;
    if (!mesh) {
      mesh = buildTerrainMesh(this.terrain, mode);
      byMode[mode] = mesh;
    }
    this.buildInfo.terrainTriangles = mesh.indices.length / 3;
    const flags = T.terrainFixInternalEdges ? RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES : undefined;
    const desc = RAPIER.ColliderDesc.trimesh(mesh.verts, mesh.indices, flags);
    return this.world.createCollider(desc.setFriction(T.terrainFriction).setRestitution(0));
  }

  private colliderFor(part: BodyPart, material: ObstacleMaterial): ColliderDesc {
    const g = getGeom(part.geom);
    let desc: ColliderDesc | null;
    if (g.collider === 'box') {
      desc = RAPIER.ColliderDesc.cuboid(
        g.halfExtents.x * part.scale.x,
        g.halfExtents.y * part.scale.y,
        g.halfExtents.z * part.scale.z,
      );
    } else {
      const pts = scaledPoints(g, part.scale);
      desc = RAPIER.ColliderDesc.convexMesh(pts, g.hullIndices) ?? RAPIER.ColliderDesc.convexHull(pts);
      if (!desc) {
        const s = Math.max(part.scale.x, part.scale.y, part.scale.z);
        desc = RAPIER.ColliderDesc.ball(s * 0.8);
      }
    }
    return desc
      .setTranslation(part.offset.x, part.offset.y, part.offset.z)
      .setRotation(part.rotation)
      .setMass(Math.max(part.mass, 0.01))
      .setFriction(T.materials[material].friction)
      .setRestitution(T.restitution);
  }

  /**
   * Create a body from a spec. Before warm-up, only specs with `settle` start awake (everything
   * else already rests where the spawner put it); bodies created after warm-up start awake.
   */
  addBody(spec: BodySpec, originId?: number, state?: ObstacleState): ObstacleBody {
    const id = this.bodies.length;
    const desc = spec.anchored ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic();
    const asleep = !spec.anchored && !this.warmedUp && !spec.settle;
    desc
      .setTranslation(spec.position.x, spec.position.y, spec.position.z)
      .setRotation(spec.rotation)
      .setLinearDamping(dryLinearDamping(spec.material))
      .setAngularDamping(dryAngularDamping(spec.material))
      .setCcdEnabled(spec.ccd && T.ccd)
      .setCanSleep(true)
      .setSleeping(asleep);
    const rb = this.world.createRigidBody(desc);
    // Decor (windows, railings, lamps) is drawn but neither collides nor counts for the proxy.
    for (const part of spec.parts) {
      if (!part.decor) this.world.createCollider(this.colliderFor(part, spec.material), rb);
    }

    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    let bound = 0;
    for (const part of spec.parts) {
      if (part.decor) continue;
      const pts = scaledPoints(getGeom(part.geom), part.scale);
      _q1.set(part.rotation.x, part.rotation.y, part.rotation.z, part.rotation.w);
      for (let i = 0; i < pts.length; i += 3) {
        _v1.set(pts[i], pts[i + 1], pts[i + 2]).applyQuaternion(_q1);
        _v1.x += part.offset.x;
        _v1.y += part.offset.y;
        _v1.z += part.offset.z;
        min.x = Math.min(min.x, _v1.x);
        min.y = Math.min(min.y, _v1.y);
        min.z = Math.min(min.z, _v1.z);
        max.x = Math.max(max.x, _v1.x);
        max.y = Math.max(max.y, _v1.y);
        max.z = Math.max(max.z, _v1.z);
        bound = Math.max(bound, _v1.length());
      }
    }
    const anchored = spec.anchored;
    const body: ObstacleBody = {
      id,
      originId: originId ?? id,
      kind: spec.kind,
      part: spec.part,
      material: spec.material,
      parts: spec.parts,
      mass: spec.mass,
      breakImpulse: spec.breakImpulse,
      breakMode: spec.breakMode,
      hitHeight: spec.hitHeight,
      trunkRadius: spec.trunkRadius,
      squareTrunk: spec.squareTrunk === true,
      placement: spec.placement,
      proxyMode: spec.proxyMode,
      anchored,
      state: state ?? (anchored ? 'intact' : 'loose'),
      active: true,
      sleeping: false,
      pos: { ...spec.position },
      quat: { ...spec.rotation },
      spawn: { ...spec.position },
      proxy: {
        id,
        kind: spec.kind,
        part: spec.part,
        x: spec.position.x,
        y: spec.position.y,
        z: spec.position.z,
        radius: 0,
        top: 0,
        bottom: 0,
        mass: spec.mass,
        vx: 0,
        vy: 0,
        vz: 0,
        anchored,
        breakImpulse: spec.breakImpulse,
        state: state ?? (anchored ? 'intact' : 'loose'),
        absorbable: spec.absorbable === true,
        ...(spec.passable ? { passable: true } : {}),
        origin: originId ?? id,
      },
      rect: { ux: 1, uz: 0, hu: 0, hv: 0 },
      footprint: spec.footprint ?? null,
      shake: { amp: 0, dirX: 0, dirZ: 0, t0: 0 },
      localMin: min,
      localMax: max,
      boundingRadius: bound,
      angVel: { x: 0, y: 0, z: 0 },
      restTime: 0,
      farTime: 0,
      inWater: false,
      everWet: false,
      lastHitTime: -Infinity,
      waterTravel: 0,
      otherTravel: 0,
      countedKnocked: false,
      countedRock: false,
      countedSwept: false,
      absorbable: spec.absorbable === true,
      building: spec.building === true,
      noTally: spec.noTally === true,
      breakup: spec.breakup ?? DEFAULT_BREAKUP,
      shakeStyle: spec.shakeStyle ?? (spec.proxyMode === 'trunk' ? 'tilt' : 'offset'),
      renderScale: 1,
      hiddenUntil: -Infinity,
      expiresAt: Infinity,
      stamp: ++this.stampSeq,
      toppleUntil: -Infinity,
      toppleX: 0,
      toppleZ: 0,
      driven: false,
      spinning: state !== 'broken' && spec.parts.some((p) => p.spin !== undefined),
      signal: spec.signal ? { ...spec.signal } : null,
    };
    this.bodies.push(body);
    this.rbs.push(rb);
    this.idByHandle.set(rb.handle, id);
    this.settleFlags.push(spec.settle);
    this.refreshProxy(body);
    this.structureVersion++;
    this.version++;
    this.gridDirty = true;
    return body;
  }

  /**
   * Spawn an obstacle of `kind` at world (x, z) at runtime (resting on the ground, awake).
   * Returns the created bodies (several for clusters/barriers).
   */
  spawn(
    kind: ObstacleKind,
    x: number,
    z: number,
    opts: SpawnOptions & { y?: number } = {},
  ): ObstacleBody[] {
    const rng = placementRng(this.seed ^ 0x5eed, 100000 + this.spawnCounter++);
    const specs = specsForKind(kind, x, z, this.terrain, rng, opts);
    if (opts.y !== undefined && specs.length > 0) {
      const dy = opts.y - specs[0].position.y;
      for (const s of specs) s.position.y += dy;
    }
    return specs.map((s) => this.addBody(s));
  }

  /**
   * Settle stacked bodies (spec.settle, e.g. barrier stones) with extra damping, then put every
   * loose body to sleep and reset spawn positions, tallies and events. Bodies spawned before
   * this are created asleep unless they need settling, so warm-up cost scales with stacks only.
   */
  warmUp(steps: number): void {
    this.forEachLoose((rb) => {
      rb.setLinearDamping(T.warmUpLinearDamping);
      rb.setAngularDamping(T.warmUpAngularDamping);
    });
    this.world.timestep = T.fixedDt;
    for (let i = 0; i < steps; i++) {
      stepRapier(this.world);
      // Rapier wakes sleeping bodies when their first ground contact appears; put the ones that
      // already rest where the spawner placed them back to sleep so only stacks are simulated.
      if (i === 0) this.forEachLoose((rb, b) => !this.settleFlags[b.id] && rb.sleep());
    }
    const zero = { x: 0, y: 0, z: 0 };
    this.forEachLoose((rb, b) => {
      rb.setLinearDamping(dryLinearDamping(b.material));
      rb.setAngularDamping(dryAngularDamping(b.material));
      rb.setLinvel(zero, false);
      rb.setAngvel(zero, false);
      rb.sleep();
    });
    for (const b of this.bodies) {
      if (!b.active) continue;
      this.readTransform(b);
      this.refreshProxy(b);
      b.spawn.x = b.pos.x;
      b.spawn.y = b.pos.y;
      b.spawn.z = b.pos.z;
      b.sleeping = !b.anchored;
      b.waterTravel = 0;
      b.otherTravel = 0;
      b.stamp = ++this.stampSeq;
    }
    this.cullLost();
    this.rebuildGrid();
    this.events = [];
    this.time = 0;
    this.warmedUp = true;
    this.version++;
  }

  private forEachLoose(f: (rb: RigidBody, b: ObstacleBody) => void): void {
    for (const b of this.bodies) {
      const rb = this.rbs[b.id];
      if (b.active && !b.anchored && !b.driven && rb) f(rb, b);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Per-step
  // -------------------------------------------------------------------------------------------

  step(dt: number): void {
    if (this.disposed) return;
    this.stepTraffic(dt);
    this.applyRollingResistance(dt);
    if (this.toppling.length > 0) this.assistTopples();
    this.world.timestep = dt;
    stepRapier(this.world);
    if (this.parking.length > 0) this.parkGaveUp();
    this.time += dt;
    this.steps++;
    let changed = false;
    for (const b of this.bodies) {
      if (!b.active || b.anchored || b.driven) continue;
      const rb = this.rbs[b.id];
      if (!rb) continue;
      const asleep = rb.isSleeping();
      if (asleep && b.sleeping) continue;
      b.sleeping = asleep;
      // A resting rotor head that wakes up has been knocked (or its tower fell): it stops turning.
      if (!asleep) b.spinning = false;
      const px = b.pos.x;
      const pz = b.pos.z;
      this.readTransform(b);
      this.refreshProxy(b);
      b.stamp = ++this.stampSeq;
      changed = true;
      const moved = Math.hypot(b.pos.x - px, b.pos.z - pz);
      if (b.inWater && this.time - b.lastHitTime > T.hitAttribution) b.waterTravel += moved;
      else b.otherTravel += moved;
      this.updateTallies(b);
      if (this.isLost(b)) {
        this.removeBody(b);
        continue;
      }
      if (!asleep) this.updateRest(b, rb, dt);
    }
    if (this.chunks.length > 0 && this.meltChunks()) changed = true;
    if (changed) this.version++;
    this.rebuildGrid();
  }

  /**
   * Ice chunks shrink over their last ICE.chunkMelt seconds (rendered smoothly, colliders in steps)
   * and are removed when their time is up. Returns true if anything changed.
   */
  private meltChunks(): boolean {
    let changed = false;
    let live = 0;
    for (const b of this.chunks) {
      if (!b.active) continue;
      const left = b.expiresAt - this.time;
      if (left <= 0) {
        this.removeBody(b);
        changed = true;
        continue;
      }
      this.chunks[live++] = b;
      if (left >= ICE.chunkMelt) continue;
      b.renderScale = Math.max(0.1, left / ICE.chunkMelt);
      b.stamp = ++this.stampSeq;
      changed = true;
      const shaped = this.chunkShape.get(b.id) ?? 1;
      if (shaped - b.renderScale > T.chunkReshapeStep) this.reshape(b, b.renderScale);
      if (b.sleeping) this.refreshProxy(b);
    }
    this.chunks.length = live;
    return changed;
  }

  /** Rebuild a body's colliders at `scale` times their spawn size (melting chunks; a few per second). */
  private reshape(b: ObstacleBody, scale: number): void {
    const rb = this.rbs[b.id];
    if (!rb) return;
    let k = 0;
    for (const part of b.parts) {
      if (part.decor) continue;
      const c = rb.collider(k++);
      if (!c) break;
      const g = getGeom(part.geom);
      const sx = part.scale.x * scale;
      const sy = part.scale.y * scale;
      const sz = part.scale.z * scale;
      if (g.collider === 'box') {
        c.setHalfExtents({ x: g.halfExtents.x * sx, y: g.halfExtents.y * sy, z: g.halfExtents.z * sz });
      } else {
        const pts = scaledPoints(g, { x: sx, y: sy, z: sz });
        c.setShape(new RAPIER.ConvexPolyhedron(pts, g.hullIndices));
      }
      const o = part.offset;
      c.setTranslationWrtParent({ x: o.x * scale, y: o.y * scale, z: o.z * scale });
    }
    this.chunkShape.set(b.id, scale);
  }

  /**
   * Released topplers (uproot) still standing keep tipping over their foot at no less than
   * PHYSICS_TUNING.toppleRate, the way they lean (the way they were pushed while upright), until
   * they tilt past toppleTilt or toppleTime runs out: the angular velocity about the horizontal
   * axis across that direction is raised to the rate, the centre of mass moving with it about the
   * foot (the body origin), so the foot stays put.
   */
  private assistTopples(): void {
    let live = 0;
    for (const b of this.toppling) {
      const rb = this.rbs[b.id];
      if (!rb || !b.active || b.anchored || this.time > b.toppleUntil) continue;
      const { x: qx, y: qy, z: qz, w: qw } = b.quat;
      // The body's up axis in the world.
      const ux = 2 * (qx * qy - qw * qz);
      const uy = 1 - 2 * (qx * qx + qz * qz);
      const uz = 2 * (qy * qz + qw * qx);
      if (Math.acos(clamp(uy, -1, 1)) >= T.toppleTilt) continue;
      this.toppling[live++] = b;
      let dx = b.toppleX;
      let dz = b.toppleZ;
      const lean = Math.hypot(ux, uz);
      if (lean > T.toppleLean) {
        dx = ux / lean;
        dz = uz / lean;
      }
      // Rotation about a = up × d = (dz, 0, -dx) tips the top toward d.
      const w = rb.angvel();
      const k = T.toppleRate - (w.x * dz - w.z * dx);
      if (!(k > 0)) continue;
      const ax = dz * k;
      const az = -dx * k;
      const com = rb.worldCom();
      const rx = com.x - b.pos.x;
      const ry = com.y - b.pos.y;
      const rz = com.z - b.pos.z;
      const v = rb.linvel();
      this.tImp.x = v.x - az * ry;
      this.tImp.y = v.y + az * rx - ax * rz;
      this.tImp.z = v.z + ax * ry;
      rb.setLinvel(this.tImp, true);
      this.tImp.x = w.x + ax;
      this.tImp.y = w.y;
      this.tImp.z = w.z + az;
      rb.setAngvel(this.tImp, true);
      b.sleeping = false;
    }
    this.toppling.length = live;
  }

  /**
   * Rapier has no rolling friction, so a faceted rock on a slope would roll forever. A Coulomb-like
   * rolling resistance (torque c * m * g * r against the spin) lets rocks roll on slopes steeper
   * than ~c and come to rest on gentler ones.
   */
  private applyRollingResistance(dt: number): void {
    const c = T.rollingResistance;
    if (c <= 0) return;
    for (const b of this.bodies) {
      if (!b.active || b.anchored || b.sleeping || b.material !== 'stone') continue;
      const w = b.angVel;
      const ws = Math.hypot(w.x, w.y, w.z);
      if (ws < 1e-4) continue;
      const p = b.proxy;
      if (p.bottom - this.terrain.heightAt(p.x, p.z) > T.groundedGap) continue;
      const rb = this.rbs[b.id];
      if (!rb) continue;
      const r = b.boundingRadius;
      const mag = Math.min(ws * 0.4 * b.mass * r * r, c * b.mass * T.gravity * r * dt);
      this.tImp.x = (-w.x / ws) * mag;
      this.tImp.y = (-w.y / ws) * mag;
      this.tImp.z = (-w.z / ws) * mag;
      rb.applyTorqueImpulse(this.tImp, false);
    }
  }

  /** True if any collider of rb has a contact pair with an awake dynamic body other than itself. */
  private touchesAwakeBody(rb: RigidBody): boolean {
    let found = false;
    for (let i = 0, n = rb.numColliders(); i < n && !found; i++) {
      this.world.contactPairsWith(rb.collider(i), (other) => {
        const parent = other.parent();
        if (parent && parent.handle !== rb.handle && parent.isDynamic() && !parent.isSleeping()) {
          found = true;
        }
      });
    }
    return found;
  }

  /**
   * Put bodies to sleep sooner than Rapier's 2 s default once they have come to rest, and (LOD)
   * after a while once they are far from the focus point.
   */
  private updateRest(b: ObstacleBody, rb: RigidBody, dt: number): void {
    const p = b.proxy;
    const v2 = p.vx * p.vx + p.vy * p.vy + p.vz * p.vz;
    const w = b.angVel;
    const w2 = w.x * w.x + w.y * w.y + w.z * w.z;
    if (v2 < T.restLinear * T.restLinear && w2 < T.restAngular * T.restAngular) b.restTime += dt;
    else b.restTime = 0;
    // Only freeze far bodies that lie on the ground or float, never one in mid-air.
    const far =
      this.isFar(p) && (b.inWater || p.bottom - this.terrain.heightAt(p.x, p.z) < T.farSleepGroundGap);
    b.farTime = far ? b.farTime + dt : 0;
    // Never force-sleep a support while an awake body still presses on it: Rapier stops resolving
    // that contact, the top body sinks into it and pushes it down through the terrain mesh.
    if ((b.restTime > T.restTime || b.farTime > T.farSleepAfter) && !this.touchesAwakeBody(rb)) {
      rb.sleep();
      b.sleeping = true;
      b.restTime = 0;
      b.farTime = 0;
      p.vx = 0;
      p.vy = 0;
      p.vz = 0;
    }
  }

  private isFar(p: ObstacleProxy): boolean {
    const fx = p.x - this.focusX;
    const fz = p.z - this.focusZ;
    return fx * fx + fz * fz > T.farSleepDistance * T.farSleepDistance;
  }

  /**
   * Point that the distance LOD measures from. proxiesNear() sets it automatically (the session
   * queries around the iceberg every step); call this to override, or pass NaN to disable.
   */
  setFocus(x: number, z: number): void {
    this.focusX = x;
    this.focusZ = z;
  }

  private readTransform(b: ObstacleBody): void {
    const rb = this.rbs[b.id];
    if (!rb) return;
    const t = rb.translation();
    b.pos.x = t.x;
    b.pos.y = t.y;
    b.pos.z = t.z;
    const r = rb.rotation();
    b.quat.x = r.x;
    b.quat.y = r.y;
    b.quat.z = r.z;
    b.quat.w = r.w;
    if (!b.anchored) {
      const v = rb.linvel();
      b.proxy.vx = v.x;
      b.proxy.vy = v.y;
      b.proxy.vz = v.z;
      const a = rb.angvel();
      b.angVel.x = a.x;
      b.angVel.y = a.y;
      b.angVel.z = a.z;
    } else {
      b.proxy.vx = 0;
      b.proxy.vy = 0;
      b.proxy.vz = 0;
    }
  }

  /** Recompute the proxy (centre, radius, top/bottom) from pos/quat and the local AABB. */
  private refreshProxy(b: ObstacleBody): void {
    const { x: qx, y: qy, z: qz, w: qw } = b.quat;
    const r00 = 1 - 2 * (qy * qy + qz * qz);
    const r01 = 2 * (qx * qy - qw * qz);
    const r02 = 2 * (qx * qz + qw * qy);
    const r10 = 2 * (qx * qy + qw * qz);
    const r11 = 1 - 2 * (qx * qx + qz * qz);
    const r12 = 2 * (qy * qz - qw * qx);
    const r20 = 2 * (qx * qz - qw * qy);
    const r21 = 2 * (qy * qz + qw * qx);
    const r22 = 1 - 2 * (qx * qx + qy * qy);
    const lmin = b.localMin;
    const lmax = b.localMax;
    const k = b.renderScale * 0.5;
    const cx = (lmin.x + lmax.x) * k;
    const cy = (lmin.y + lmax.y) * k;
    const cz = (lmin.z + lmax.z) * k;
    const ex = (lmax.x - lmin.x) * k;
    const ey = (lmax.y - lmin.y) * k;
    const ez = (lmax.z - lmin.z) * k;
    const wx = b.pos.x + r00 * cx + r01 * cy + r02 * cz;
    const wy = b.pos.y + r10 * cx + r11 * cy + r12 * cz;
    const wz = b.pos.z + r20 * cx + r21 * cy + r22 * cz;
    const hx = Math.abs(r00) * ex + Math.abs(r01) * ey + Math.abs(r02) * ez;
    const hy = Math.abs(r10) * ex + Math.abs(r11) * ey + Math.abs(r12) * ez;
    const hz = Math.abs(r20) * ex + Math.abs(r21) * ey + Math.abs(r22) * ez;
    const p = b.proxy;
    p.y = wy;
    p.top = wy + hy;
    p.bottom = wy - hy;
    p.rect = undefined;
    switch (b.proxyMode) {
      case 'sphere':
        p.x = b.pos.x;
        p.z = b.pos.z;
        p.radius = b.boundingRadius;
        p.top = Math.min(p.top, b.pos.y + b.boundingRadius);
        p.bottom = Math.max(p.bottom, b.pos.y - b.boundingRadius);
        break;
      case 'trunk': {
        p.x = b.pos.x;
        p.z = b.pos.z;
        const h = b.trunkRadius + 0.25;
        p.radius = h;
        if (b.squareTrunk) {
          // A square along the body's own x axis (it stands upright while it has this proxy).
          const l = Math.hypot(r00, r20) || 1;
          b.rect.ux = r00 / l;
          b.rect.uz = r20 / l;
          b.rect.hu = h;
          b.rect.hv = h;
          p.rect = b.rect;
          p.radius = Math.SQRT2 * h;
        }
        break;
      }
      case 'footprint':
      case 'extent': {
        if (b.footprint) {
          if (this.skewedProxy(b, wx, wz, hx, hz)) break;
          b.rect.k0 = 0;
          b.rect.k1 = 0;
        }
        p.x = wx;
        p.z = wz;
        const ax = r00 * ex;
        const az = r20 * ex;
        const bx = r01 * ey;
        const bz = r21 * ey;
        const qx = r02 * ez;
        const qz = r22 * ez;
        if (elongatedRect(ax, az, bx, bz, qx, qz, b.rect)) {
          p.rect = b.rect;
          p.radius = Math.hypot(b.rect.hu, b.rect.hv);
        } else if (b.proxyMode === 'footprint') {
          p.radius = 0.5 * (Math.hypot(hx, hz) + Math.max(hx, hz));
        } else {
          p.radius = Math.max(0.3, 0.5 * (hx + hz));
        }
        break;
      }
    }
    p.anchored = b.anchored;
    p.state = b.state;
    if (p.radius > this.maxProxyRadius) this.maxProxyRadius = p.radius;
  }

  /**
   * The proxy of a body with skewed ends (b.footprint, a skewed bridge deck or abutment) as its
   * real plan quadrilateral (ProxyRect.k0 / k1), not the bounding rectangle that reaches |skew| ×
   * width past one end: centred on its centre line, hu half that line's length. Holds while it
   * stands roughly as built (on its seats, hinging down off a broken pier, or jolted: its own x
   * axis within ~70° of level, its z axis within 45°); false once it has tumbled, and the bounding
   * rectangle takes over. The radius still bounds every collider (wx, wz, hx, hz: the body's world
   * AABB centre and half extents), for queries.
   */
  private skewedProxy(b: ObstacleBody, wx: number, wz: number, hx: number, hz: number): boolean {
    const f = b.footprint!;
    const { x: qx, y: qy, z: qz, w: qw } = b.quat;
    const r00 = 1 - 2 * (qy * qy + qz * qz);
    const r01 = 2 * (qx * qy - qw * qz);
    const r02 = 2 * (qx * qz + qw * qy);
    const r20 = 2 * (qx * qz - qw * qy);
    const r21 = 2 * (qy * qz + qw * qx);
    const r22 = 1 - 2 * (qx * qx + qy * qy);
    const cu = Math.hypot(r00, r20);
    if (!(cu > 0.3)) return false;
    const ux = r00 / cu;
    const uz = r20 / cu;
    // The body's z axis across the rect (v = (-uz, ux)), and its y axis along and across it.
    const zv = -uz * r02 + ux * r22;
    if (!(Math.abs(zv) > 0.7)) return false;
    const yu = r01 * ux + r21 * uz;
    const yv = -uz * r01 + ux * r21;
    const s = b.renderScale;
    const xm = ((f.x0 + f.x1) / 2) * s;
    const ym = ((f.y0 + f.y1) / 2) * s;
    const p = b.proxy;
    p.x = b.pos.x + r00 * xm + r01 * ym;
    p.z = b.pos.z + r20 * xm + r21 * ym;
    const r = b.rect;
    r.ux = ux;
    r.uz = uz;
    // A tilted body's square end faces reach further in plan at one height than another (and a
    // rolled one's sides).
    const hy = ((f.y1 - f.y0) / 2) * s;
    r.hu = ((f.x1 - f.x0) / 2) * s * cu + Math.abs(yu) * hy;
    r.hv = f.hz * s * Math.abs(zv) + Math.abs(yv) * hy;
    // An end x = x0 + k0 · z lies at u = k0 · cu · z, v = zv · z.
    r.k0 = (f.k0 * cu) / zv;
    r.k1 = (f.k1 * cu) / zv;
    p.rect = r;
    p.radius = Math.max(rectRadius(r), Math.hypot(wx - p.x, wz - p.z) + Math.hypot(hx, hz));
    return true;
  }

  private updateTallies(b: ObstacleBody): void {
    if (b.noTally) return;
    const origin = this.bodies[b.originId];
    const dx = b.pos.x - b.spawn.x;
    const dz = b.pos.z - b.spawn.z;
    const d = Math.hypot(dx, dz);
    // 3D for "knocked": a bridge deck that drops off its posts barely moves sideways.
    if (Math.hypot(d, b.pos.y - b.spawn.y) > T.knockDistance) {
      this.markKnocked(origin);
      if (isRockKind(b.kind) && !origin.countedRock) {
        origin.countedRock = true;
        this.stats.rocksMoved++;
      }
    }
    if (d > T.sweptDistance && b.waterTravel > b.otherTravel && !origin.countedSwept) {
      origin.countedSwept = true;
      this.stats.sweptByWater++;
    }
  }

  private markKnocked(origin: ObstacleBody): void {
    if (origin.countedKnocked) return;
    origin.countedKnocked = true;
    this.stats.knockedDown++;
  }

  private isLost(b: ObstacleBody): boolean {
    const bounds = this.terrain.level.bounds;
    const m = T.boundsMargin;
    return (
      b.pos.y < this.seaLevel - T.killDepth ||
      b.pos.x < bounds.minX - m ||
      b.pos.x > bounds.maxX + m ||
      b.pos.z < bounds.minZ - m ||
      b.pos.z > bounds.maxZ + m
    );
  }

  private cullLost(): void {
    for (const b of this.bodies) if (b.active && this.isLost(b)) this.removeBody(b);
  }

  private removeBody(b: ObstacleBody): void {
    const rb = this.rbs[b.id];
    if (rb) {
      this.idByHandle.delete(rb.handle);
      this.world.removeRigidBody(rb);
    }
    this.rbs[b.id] = null;
    b.active = false;
    b.spinning = false;
    if (b.driven) {
      b.driven = false;
      const t = this.traffic;
      const i = t ? t.indexOfBody(b.id) : -1;
      if (t && i >= 0) t.release(i);
    }
    b.stamp = ++this.stampSeq;
    this.structureVersion++;
    this.version++;
    this.gridDirty = true;
  }

  private rebuildGrid(): void {
    const n = this.bodies.length;
    if (this.gridIds.length < n) {
      const cap = Math.max(n, this.gridIds.length * 2);
      this.gridIds = new Int32Array(cap);
      this.gridXs = new Float64Array(cap);
      this.gridZs = new Float64Array(cap);
    }
    let k = 0;
    let maxR = 0;
    for (const b of this.bodies) {
      if (!b.active) continue;
      this.gridIds[k] = b.id;
      this.gridXs[k] = b.proxy.x;
      this.gridZs[k] = b.proxy.z;
      if (b.proxy.radius > maxR) maxR = b.proxy.radius;
      k++;
    }
    this.maxProxyRadius = maxR;
    this.grid.rebuild(k, this.gridIds, this.gridXs, this.gridZs);
    this.gridDirty = false;
  }

  /**
   * Active bodies whose proxy circle comes within `radius` of (x, z). The returned array is
   * reused: consume it before the next call.
   */
  proxiesNear(x: number, z: number, radius: number): readonly ObstacleProxy[] {
    if (this.gridDirty) this.rebuildGrid();
    this.focusX = x;
    this.focusZ = z;
    const out = this.nearOut;
    out.length = 0;
    const g = this.grid;
    const reach = radius + this.maxProxyRadius;
    const cx0 = g.cellX(x - reach);
    const cx1 = g.cellX(x + reach);
    const cz0 = g.cellZ(z - reach);
    const cz1 = g.cellZ(z + reach);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = cz * g.cols + cx;
        for (let i = g.cellStart[c]; i < g.cellStart[c + 1]; i++) {
          const body = this.bodies[g.items[i]];
          if (body.hiddenUntil > this.time) continue;
          const p = body.proxy;
          const lim = radius + p.radius;
          const dx = p.x - x;
          const dz = p.z - z;
          if (dx * dx + dz * dz < lim * lim) out.push(p);
        }
      }
    }
    for (const p of this.parapets) {
      const lim = radius + p.radius;
      const dx = p.x - x;
      const dz = p.z - z;
      if (dx * dx + dz * dz < lim * lim) out.push(p);
    }
    return out;
  }

  // -------------------------------------------------------------------------------------------
  // Iceberg contacts
  // -------------------------------------------------------------------------------------------

  /**
   * Anchored bodies break iff the contact's testImpulse (the iceberg's momentum rule
   * (1+e)·vn·M; |impulse| when absent) reaches breakImpulse, and then receive contact.impulse (the
   * loose-body rule), so a heavy iceberg bulldozes through without flinging debris faster than it
   * pushed it. Loose bodies with a finite breakImpulse shatter the same way; others are pushed.
   */
  applyContact(contact: IcebergContact): ContactOutcome {
    // A road bridge's parapet (./deckGround.ts) has no body: it holds, and nothing moves.
    if (isParapetId(contact.obstacleId)) {
      return { obstacleId: contact.obstacleId, kind: 'roadBridge', result: 'none' };
    }
    const b = this.bodies[contact.obstacleId];
    const rb = b ? this.rbs[b.id] : null;
    if (!b || !b.active || !rb) {
      return { obstacleId: contact.obstacleId, kind: b?.kind ?? 'rockSmall', result: 'none' };
    }
    const imp = contact.impulse;
    const J = Math.hypot(imp.x, imp.y, imp.z);
    const test = contact.testImpulse ?? J;
    b.lastHitTime = this.time;
    b.spinning = false;
    // A driving vehicle becomes an ordinary loose body moving at its driving velocity (the solver
    // already exchanged momentum against that velocity: its proxy carried it).
    if (b.driven) this.releaseVehicle(b);
    const outcome = (result: ContactOutcome['result']): ContactOutcome => ({
      obstacleId: b.id,
      kind: b.kind,
      result,
    });
    if (b.anchored) {
      if (test >= b.breakImpulse && b.breakMode !== 'none') {
        if (b.breakMode === 'shatter') {
          this.shatter(b, rb, contact, J);
          return outcome('broken');
        }
        this.uproot(b, rb, contact, J);
        return outcome('uprooted');
      }
      this.startShake(b, contact, test);
      return outcome('shook');
    }
    if (b.breakMode === 'shatter' && test >= b.breakImpulse) {
      this.shatter(b, rb, contact, J);
      return outcome('broken');
    }
    if (J < 1e-6) return outcome('none');
    if (b.breakMode === 'uproot' && this.tiltOf(b.id) < T.standingTilt) {
      this.pushStanding(b, rb, contact);
      b.sleeping = false;
      return outcome('pushed');
    }
    if (b.kind === 'roadBridge' && b.part === 'deck' && this.seated(b)) {
      this.pushSeatedDeck(b, rb, imp);
      return outcome('pushed');
    }
    // Apply on the near side of the body at the contact height, so pushes also tumble it.
    const p = b.proxy;
    const r = p.rect;
    if (r) {
      // A long body is pushed where it was touched (along it), so a hit near one end swings it
      // round and out of the way; across it, half way in.
      const dx = contact.point.x - p.x;
      const dz = contact.point.z - p.z;
      const cv = clamp(dz * r.ux - dx * r.uz, -r.hv, r.hv);
      // Within its ends where touched (a skewed end runs along u = ±hu + k · v).
      const lu = clamp(dx * r.ux + dz * r.uz, -r.hu + (r.k0 ?? 0) * cv, r.hu + (r.k1 ?? 0) * cv);
      const lv = 0.5 * cv;
      this.tPt.x = p.x + lu * r.ux - lv * r.uz;
      this.tPt.z = p.z + lu * r.uz + lv * r.ux;
    } else {
      const hl = Math.hypot(contact.normal.x, contact.normal.z) || 1;
      const reach = Math.min(p.radius, b.boundingRadius) * 0.5;
      this.tPt.x = p.x - (contact.normal.x / hl) * reach;
      this.tPt.z = p.z - (contact.normal.z / hl) * reach;
    }
    this.tPt.y = clamp(contact.point.y, p.bottom + 0.1 * (p.top - p.bottom), p.top);
    rb.applyImpulseAtPoint(imp, this.tPt, true);
    if (r) {
      // The solver exchanged J with the mass the body has where it was touched (leverMass), so
      // this spin is what the iceberg paid for; still, never let the far end outrun a free body hit
      // head-on ((1+e)·closing speed), as shatter() caps debris.
      const w = rb.angvel();
      const cap = ((1 + CONTACT_RESTITUTION) * Math.max(contact.relSpeed, 1)) / Math.max(r.hu, 0.5);
      if (Math.abs(w.y) > cap) {
        this.tImp.x = w.x;
        this.tImp.y = Math.sign(w.y) * cap;
        this.tImp.z = w.z;
        rb.setAngvel(this.tImp, true);
      }
    }
    b.sleeping = false;
    return outcome('pushed');
  }

  /** A road deck still within T.deckSeated of where it was built: on its seats. */
  private seated(b: ObstacleBody): boolean {
    return Math.hypot(b.pos.x - b.spawn.x, b.pos.y - b.spawn.y, b.pos.z - b.spawn.z) < T.deckSeated;
  }

  /**
   * A push on a road deck still on its seats: only its share along the deck's own line, through the
   * deck's axis; its bearings carry the rest (sideways, up, and the turn about its middle) into the
   * supports. End-on along its line a deck is braced by its neighbours and the far abutment anyway;
   * but the push off a skewed end face is partly sideways (as much as sin(skew)), and so is the bow
   * wave the solver gives heavy debris, and nothing but friction held a deck against that: an
   * iceberg sliding off the Highland Maze glen road into a skewed deck end shoved it 13-29 m off
   * its seats into the gorge. A deck dislodged (its pier knocked out: it drops off its seat) is a
   * loose body again.
   */
  private pushSeatedDeck(b: ObstacleBody, rb: RigidBody, imp: Vec3): void {
    const { x: qx, y: qy, z: qz, w: qw } = b.quat;
    // The deck's own x axis (along its line), level.
    const ax = 1 - 2 * (qy * qy + qz * qz);
    const az = 2 * (qx * qz - qw * qy);
    const l = Math.hypot(ax, az) || 1;
    const along = (imp.x * ax + imp.z * az) / (l * l);
    this.tImp.x = along * ax;
    this.tImp.y = 0;
    this.tImp.z = along * az;
    rb.applyImpulse(this.tImp, true);
    b.sleeping = false;
  }

  /**
   * A push on an uprooted body that still stands: along the contact normal, straight away from the
   * iceberg (not tilted aside like the bow wave that clears rubble), applied where its uprooting
   * hit was (hitHeight along its up axis: a tower's centre of percussion, so it keeps pivoting over
   * its foot; a post's contact height), and only until that point moves along the push as fast as
   * the iceberg closes (the iceberg is not a catapult). Pushed at the iceberg's contact height
   * instead, a tall body's foot is shoved out from under it, and it stands back up, balanced on
   * the edge of its footing, or falls back across the iceberg.
   */
  private pushStanding(b: ObstacleBody, rb: RigidBody, c: IcebergContact): void {
    const imp = c.impulse;
    const jh = Math.hypot(imp.x, imp.z);
    const nl = Math.hypot(c.normal.x, c.normal.z);
    if (!(jh > 1e-6) || !(nl > 1e-6)) return;
    const dx = c.normal.x / nl;
    const dz = c.normal.z / nl;
    this.tImp.x = dx * jh;
    this.tImp.y = imp.y;
    this.tImp.z = dz * jh;
    _q1.set(b.quat.x, b.quat.y, b.quat.z, b.quat.w);
    _v1.set(0, b.hitHeight, 0).applyQuaternion(_q1);
    this.tPt.x = b.pos.x + _v1.x;
    this.tPt.y = b.pos.y + _v1.y;
    this.tPt.z = b.pos.z + _v1.z;
    // The iceberg's speed along the normal (relSpeed is measured against the body's centre of mass).
    const lv = rb.linvel();
    const vIce = Math.max(0, c.relSpeed) + lv.x * dx + lv.z * dz;
    const v0 = rb.velocityAtPoint(this.tPt, this.tVel);
    const before = v0.x * dx + v0.z * dz;
    const room = vIce - before;
    if (!(room > 0)) return;
    rb.applyImpulseAtPoint(this.tImp, this.tPt, true);
    const v1 = rb.velocityAtPoint(this.tPt, this.tVel);
    const gained = v1.x * dx + v1.z * dz - before;
    if (gained > room) {
      const k = room / gained - 1;
      this.tImp.x *= k;
      this.tImp.y *= k;
      this.tImp.z *= k;
      rb.applyImpulseAtPoint(this.tImp, this.tPt, true);
    }
  }

  /**
   * How far (m) to lift a body as it is released so that none of its collider parts starts buried
   * deeper than PHYSICS_TUNING.releaseBuried of the part's thinnest size (0 if none is). Anchored
   * footings are set into the lowest ground under them, which on a crest or a slope buries a low
   * pad or the uphill legs of a lattice tower; Rapier separates a part buried that deep the short
   * way, down or sideways, so the dynamic body stays staked in the ground.
   */
  private releaseLift(b: ObstacleBody): number {
    let lift = 0;
    _q1.set(b.quat.x, b.quat.y, b.quat.z, b.quat.w);
    for (const part of b.parts) {
      if (part.decor) continue;
      const pts = scaledPoints(getGeom(part.geom), part.scale);
      _q2.set(part.rotation.x, part.rotation.y, part.rotation.z, part.rotation.w);
      let deep = -Infinity;
      for (let i = 0; i < pts.length; i += 3) {
        _v1.set(pts[i], pts[i + 1], pts[i + 2]).applyQuaternion(_q2);
        _v1.x += part.offset.x;
        _v1.y += part.offset.y;
        _v1.z += part.offset.z;
        _v1.multiplyScalar(b.renderScale).applyQuaternion(_q1);
        deep = Math.max(deep, this.terrain.heightAt(b.pos.x + _v1.x, b.pos.z + _v1.z) - b.pos.y - _v1.y);
      }
      if (!(deep > 0)) continue;
      // Thinnest size of the part in its own frame (the hull is centred on the part's origin).
      const g = getGeom(part.geom);
      const s = b.renderScale;
      const thin = Math.min(
        (g.max.x - g.min.x) * part.scale.x,
        (g.max.y - g.min.y) * part.scale.y,
        (g.max.z - g.min.z) * part.scale.z,
      );
      lift = Math.max(lift, deep - T.releaseBuried * thin * s);
    }
    return lift;
  }

  private startShake(b: ObstacleBody, c: IcebergContact, J: number): void {
    const hl = Math.hypot(c.normal.x, c.normal.z);
    const ratio = Number.isFinite(b.breakImpulse) && b.breakImpulse > 0 ? J / b.breakImpulse : 0.5;
    b.shake.amp = clamp(ratio, 0.25, 1);
    b.shake.dirX = hl > 1e-6 ? c.normal.x / hl : 0;
    b.shake.dirZ = hl > 1e-6 ? c.normal.z / hl : 1;
    b.shake.t0 = this.time;
    b.stamp = ++this.stampSeq;
    this.version++;
  }

  private brokenEvent(b: ObstacleBody): void {
    this.events.push({ type: 'obstacleBroken', obstacleId: b.originId, kind: b.kind, pos: { ...b.pos } });
  }

  private uproot(b: ObstacleBody, rb: RigidBody, c: IcebergContact, J: number): void {
    rb.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    rb.recomputeMassPropertiesFromColliders();
    // Tear a footing set deep into a crest or a slope out of the ground (and what rests on it).
    const lift = this.releaseLift(b);
    if (lift > 0) {
      b.pos.y += lift;
      rb.setTranslation(b.pos, true);
    }
    b.anchored = false;
    b.state = 'loose';
    b.proxyMode = 'extent';
    b.sleeping = false;
    b.shake.amp = 0;
    // Impulse high on the trunk (along the body's up axis) so the tree topples in the push direction.
    _q1.set(b.quat.x, b.quat.y, b.quat.z, b.quat.w);
    _v1.set(0, b.hitHeight, 0).applyQuaternion(_q1);
    this.tPt.x = b.pos.x + _v1.x;
    this.tPt.y = b.pos.y + _v1.y;
    this.tPt.z = b.pos.z + _v1.z;
    this.tImp.x = c.impulse.x;
    this.tImp.y = Math.max(c.impulse.y, T.breakLift * J);
    this.tImp.z = c.impulse.z;
    rb.applyImpulseAtPoint(this.tImp, this.tPt, true);
    // Built to topple (hit above its centre of mass, not a post knocked out at its foot): make
    // sure it comes down (assistTopples), the way it was pushed.
    const jh = Math.hypot(c.impulse.x, c.impulse.z);
    const nh = Math.hypot(c.normal.x, c.normal.z);
    if (b.hitHeight > rb.localCom().y && (jh > 1e-9 || nh > 1e-9)) {
      b.toppleX = jh > 1e-9 ? c.impulse.x / jh : c.normal.x / nh;
      b.toppleZ = jh > 1e-9 ? c.impulse.z / jh : c.normal.z / nh;
      b.toppleUntil = this.time + T.toppleTime;
      this.toppling.push(b);
    }
    this.refreshProxy(b);
    b.stamp = ++this.stampSeq;
    const origin = this.bodies[b.originId];
    if (!b.noTally) this.markKnocked(origin);
    if (isTreeKind(b.kind)) {
      this.stats.treesFelled++;
      this.events.push({ type: 'treeFelled', obstacleId: b.originId, pos: { ...b.pos } });
    } else {
      this.brokenEvent(b);
    }
    this.wakeRiders(b, lift > 0 ? lift : 0);
    this.version++;
  }

  /**
   * Replace a compound body by one dynamic body per break piece (BodyPart.piece; parts without one
   * are their own piece), handing each a share of the contact impulse biased toward the contact
   * point (StructureDef breakup), plus a random spin. Pieces keep the body's velocity.
   */
  private shatter(b: ObstacleBody, rb: RigidBody, c: IcebergContact, J: number): void {
    const origin = this.bodies[b.originId];
    const lv = rb.linvel();
    const av = rb.angvel();
    const v0 = { x: lv.x, y: lv.y, z: lv.z };
    const w0 = { x: av.x, y: av.y, z: av.z };
    this.wakeRiders(b);
    this.removeBody(b);
    b.state = 'broken';
    b.anchored = false;
    if (b.building) this.stats.buildingsDestroyed++;
    if (!b.noTally) this.markKnocked(origin);
    this.brokenEvent(b);

    const bk = b.breakup;
    _q1.set(b.quat.x, b.quat.y, b.quat.z, b.quat.w);
    const pieces = this.pieceSpecs(b);
    const weights = pieces.map((pc) => {
      const p = pc.position;
      const d = Math.hypot(p.x - c.point.x, p.y - c.point.y, p.z - c.point.z);
      return pc.mass * (bk.floor + Math.exp(-d / bk.falloff));
    });
    const wSum = weights.reduce((a, w) => a + w, 0) || 1;
    const maxDv = (1 + CONTACT_RESTITUTION) * Math.max(c.relSpeed, 1);
    pieces.forEach((piece, i) => {
      const pb = this.addBody(piece, b.originId, 'broken');
      pb.lastHitTime = this.time;
      const prb = this.rbs[pb.id];
      if (!prb) return;
      // Inherit the body's motion (loose bodies that shatter): v + w × r.
      const rx = piece.position.x - b.pos.x;
      const ry = piece.position.y - b.pos.y;
      const rz = piece.position.z - b.pos.z;
      this.tImp.x = v0.x + w0.y * rz - w0.z * ry;
      this.tImp.y = v0.y + w0.z * rx - w0.x * rz;
      this.tImp.z = v0.z + w0.x * ry - w0.y * rx;
      prb.setLinvel(this.tImp, true);
      prb.setAngvel(w0, true);
      const share = (weights[i] / wSum) * bk.impulseScale;
      const ji = J * share;
      this.tImp.x = c.impulse.x * share;
      this.tImp.y = Math.max(c.impulse.y * share, T.breakLift * ji);
      this.tImp.z = c.impulse.z * share;
      const dv = Math.hypot(this.tImp.x, this.tImp.y, this.tImp.z) / Math.max(piece.mass, 1e-6);
      if (dv > maxDv) {
        this.tImp.x *= maxDv / dv;
        this.tImp.y *= maxDv / dv;
        this.tImp.z *= maxDv / dv;
      }
      prb.applyImpulse(this.tImp, true);
      const spin = bk.spin * ji;
      this.tImp.x = (this.rng() * 2 - 1) * spin;
      this.tImp.y = (this.rng() * 2 - 1) * spin * 0.5;
      this.tImp.z = (this.rng() * 2 - 1) * spin;
      prb.applyTorqueImpulse(this.tImp, true);
      const w = prb.angvel();
      const ws = Math.hypot(w.x, w.y, w.z);
      if (ws > T.maxDebrisSpin) {
        const k = T.maxDebrisSpin / ws;
        this.tImp.x = w.x * k;
        this.tImp.y = w.y * k;
        this.tImp.z = w.z * k;
        prb.setAngvel(this.tImp, true);
      }
    });
  }

  /**
   * Debris specs for a shattering body (expects _q1 = the body's rotation). A single-part piece is
   * centred on its part; a multi-part piece keeps the body's rotation and is centred on its parts'
   * mass-weighted centre. Decor-only groups ride along with the first collider piece.
   */
  private pieceSpecs(b: ObstacleBody): BodySpec[] {
    const groups = new Map<number, BodyPart[]>();
    b.parts.forEach((part, i) => {
      const key = part.piece ?? -1 - i;
      const g = groups.get(key);
      if (g) g.push(part);
      else groups.set(key, [part]);
    });
    const list = [...groups.values()];
    const solid = list.filter((g) => g.some((p) => !p.decor));
    for (const g of list) if (!g.some((p) => !p.decor) && solid.length > 0) solid[0].push(...g);
    return solid.map((parts) => {
      const main = parts.find((p) => !p.decor) ?? parts[0];
      let mass = 0;
      for (const p of parts) mass += p.mass;
      let position: Vec3;
      let rotation: Quat;
      let local: BodyPart[];
      if (parts.length === 1) {
        _v1.set(main.offset.x, main.offset.y, main.offset.z).applyQuaternion(_q1);
        position = { x: b.pos.x + _v1.x, y: b.pos.y + _v1.y, z: b.pos.z + _v1.z };
        _q2.set(main.rotation.x, main.rotation.y, main.rotation.z, main.rotation.w).premultiply(_q1);
        rotation = { x: _q2.x, y: _q2.y, z: _q2.z, w: _q2.w };
        local = [{ ...main, offset: { ...ZERO }, rotation: { x: 0, y: 0, z: 0, w: 1 } }];
      } else {
        let cx = 0;
        let cy = 0;
        let cz = 0;
        let m = 0;
        for (const p of parts) {
          if (p.decor) continue;
          const w = Math.max(p.mass, 1e-6);
          cx += p.offset.x * w;
          cy += p.offset.y * w;
          cz += p.offset.z * w;
          m += w;
        }
        cx /= m;
        cy /= m;
        cz /= m;
        _v1.set(cx, cy, cz).applyQuaternion(_q1);
        position = { x: b.pos.x + _v1.x, y: b.pos.y + _v1.y, z: b.pos.z + _v1.z };
        rotation = { ...b.quat };
        local = parts.map((p) => ({
          ...p,
          offset: { x: p.offset.x - cx, y: p.offset.y - cy, z: p.offset.z - cz },
        }));
      }
      return {
        kind: b.kind,
        part: main.name,
        material: b.material,
        proxyMode: 'extent',
        position,
        rotation,
        anchored: false,
        mass,
        breakImpulse: Infinity,
        breakMode: 'none',
        hitHeight: 0,
        trunkRadius: 0,
        ccd: mass < 1.2,
        settle: false,
        parts: local,
        placement: b.placement,
        noTally: b.noTally,
      };
    });
  }

  /** World AABB centre and horizontal half extents of a body into `out`. */
  private flatBox(b: ObstacleBody, out: FlatBox): FlatBox {
    const { x: qx, y: qy, z: qz, w: qw } = b.quat;
    const lmin = b.localMin;
    const lmax = b.localMax;
    const cx = (lmin.x + lmax.x) / 2;
    const cy = (lmin.y + lmax.y) / 2;
    const cz = (lmin.z + lmax.z) / 2;
    const r00 = 1 - 2 * (qy * qy + qz * qz);
    const r01 = 2 * (qx * qy - qw * qz);
    const r02 = 2 * (qx * qz + qw * qy);
    const r20 = 2 * (qx * qz - qw * qy);
    const r21 = 2 * (qy * qz + qw * qx);
    const r22 = 1 - 2 * (qx * qx + qy * qy);
    out.x = b.pos.x + r00 * cx + r01 * cy + r02 * cz;
    out.z = b.pos.z + r20 * cx + r21 * cy + r22 * cz;
    out.hx = this.halfExtentX(b);
    out.hz = this.halfExtentZ(b);
    return out;
  }

  /**
   * Wake the sleeping loose bodies resting on `b` (their bottom above its bottom, footprints
   * overlapping), so a bridge deck falls when the post under it gives way. Called on breaks only.
   * `lift`: b was just raised this far (releaseLift); they rise with it, still resting on it.
   */
  private wakeRiders(b: ObstacleBody, lift = 0): void {
    const a = this.flatBox(b, this.boxA);
    const m = T.wakeMargin;
    for (const o of this.bodies) {
      if (o === b || !o.active || o.anchored || !o.sleeping) continue;
      if (o.proxy.bottom < b.proxy.bottom - lift + T.wakeAbove) continue;
      const q = this.flatBox(o, this.boxB);
      if (Math.abs(q.x - a.x) > a.hx + q.hx + m || Math.abs(q.z - a.z) > a.hz + q.hz + m) continue;
      const rb = this.rbs[o.id];
      if (!rb) continue;
      if (lift > 0) {
        o.pos.y += lift;
        rb.setTranslation(o.pos, false);
        this.refreshProxy(o);
      }
      rb.wakeUp();
      o.sleeping = false;
      o.restTime = 0;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Glacier ice
  // -------------------------------------------------------------------------------------------

  /**
   * Remove an absorbable body (glacier ice the iceberg merges with) and report its mass and
   * velocity; null if the id is unknown, gone or not absorbable.
   */
  absorb(obstacleId: number): { mass: number; vel: Vec3 } | null {
    const b = this.bodies[obstacleId];
    const rb = b ? this.rbs[b.id] : null;
    if (!b || !b.active || !rb || !b.absorbable) return null;
    const v = rb.linvel();
    const vel = { x: v.x, y: v.y, z: v.z };
    b.state = 'broken';
    this.removeBody(b);
    return { mass: b.mass, vel };
  }

  /**
   * Spawn up to ICE.chunksPerHit loose chunks (totalMass tonnes, ~ICE.chunkTarget each) broken off
   * the iceberg at `pos`: they keep part of `vel` plus sideways scatter, lift and spin, stay hidden
   * from the iceberg solver for ICE.chunkGrace s, and melt away after ICE.chunkLife s. At most
   * ICE.maxChunks live at once (the oldest go first). With `around` (the iceberg) they start on its
   * flanks (ICE.chunkFlank) at the height of `pos` and fly straight out, never ahead of it.
   */
  spawnIceChunks(pos: Vec3, vel: Vec3, totalMass: number, around?: ChunkSource): void {
    if (this.disposed || !(totalMass >= ICE.chunkMinTotal) || !Number.isFinite(totalMass)) return;
    const n = clamp(Math.round(totalMass / ICE.chunkTarget), 1, ICE.chunksPerHit);
    let live = 0;
    for (const c of this.chunks) if (c.active) live++;
    for (const c of this.chunks) {
      if (live + n <= ICE.maxChunks) break;
      if (!c.active) continue;
      this.removeBody(c);
      live--;
    }
    const rng = this.rng;
    const specs = iceChunkSpecs(pos, totalMass, n, rng);
    const keep = ICE.chunkKeep;
    const vx = Number.isFinite(vel.x) ? vel.x * keep : 0;
    const vy = Number.isFinite(vel.y) ? Math.max(0, vel.y) * keep : 0;
    const vz = Number.isFinite(vel.z) ? vel.z * keep : 0;
    // Breaking off an iceberg: forward is its travel direction (or toward the hit when it is still).
    let fx = 0;
    let fz = 1;
    if (around) {
      const vl = Math.hypot(vx, vz);
      const hx = pos.x - around.x;
      const hz = pos.z - around.z;
      const hl = Math.hypot(hx, hz);
      if (vl > 0.5) {
        fx = vx / vl;
        fz = vz / vl;
      } else if (hl > 1e-6) {
        fx = hx / hl;
        fz = hz / hl;
      }
    }
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const sc = spec.parts[0].scale;
      // Flank chunks: alternately left and right, spread from beside to behind the iceberg.
      let ox = NaN;
      let oz = NaN;
      if (around) {
        const sign = i % 2 === 0 ? 1 : -1;
        const perSide = Math.ceil((specs.length - (i % 2)) / 2);
        const [f0, f1] = ICE.chunkFlank;
        const a = f0 + ((Math.floor(i / 2) + rng()) / perSide) * (f1 - f0);
        ox = fx * Math.cos(a) + fz * Math.sin(a) * sign;
        oz = fz * Math.cos(a) - fx * Math.sin(a) * sign;
        const r = around.radius + 0.6 * Math.max(sc.x, sc.z) + 0.15;
        spec.position.x = around.x + ox * r;
        spec.position.z = around.z + oz * r;
      }
      // Never start inside the ground (chunks are only yawed, so the bottom is min.y below the
      // centre; the margin covers a slope under their footprint).
      const g = getGeom(spec.parts[0].geom);
      const ground = this.terrain.heightAt(spec.position.x, spec.position.z);
      const clear = -g.min.y * sc.y + 0.5 * Math.max(sc.x, sc.z) + 0.05;
      spec.position.y = Math.max(spec.position.y, ground + clear);
      const b = this.addBody(spec);
      const rb = this.rbs[b.id];
      if (!rb) continue;
      const a = rng() * Math.PI * 2;
      const side = ICE.chunkScatter[0] + (ICE.chunkScatter[1] - ICE.chunkScatter[0]) * rng();
      const lift = ICE.chunkLift[0] + (ICE.chunkLift[1] - ICE.chunkLift[0]) * rng();
      // Scattered at random, or straight out from the iceberg's flank.
      this.tImp.x = vx + (around ? ox : Math.cos(a)) * side;
      this.tImp.y = vy + lift;
      this.tImp.z = vz + (around ? oz : Math.sin(a)) * side;
      rb.setLinvel(this.tImp, true);
      const w = ICE.chunkSpin;
      this.tImp.x = (rng() * 2 - 1) * w;
      this.tImp.y = (rng() * 2 - 1) * w;
      this.tImp.z = (rng() * 2 - 1) * w;
      rb.setAngvel(this.tImp, true);
      b.hiddenUntil = this.time + ICE.chunkGrace;
      b.expiresAt = this.time + ICE.chunkLife[0] + (ICE.chunkLife[1] - ICE.chunkLife[0]) * rng();
      b.lastHitTime = this.time;
      this.chunks.push(b);
    }
  }

  /** Ice chunks currently alive. */
  get iceChunkCount(): number {
    let n = 0;
    for (const c of this.chunks) if (c.active) n++;
    return n;
  }

  // -------------------------------------------------------------------------------------------
  // Water
  // -------------------------------------------------------------------------------------------

  /**
   * River drag + buoyancy on loose bodies (and ocean behaviour). Call once per fixed step before
   * step(). Sleeping bodies are polled every WATER_TUNING.sleepPollStride steps.
   */
  applyWaterForces(river: RiverTrailApi, dt: number): void {
    const g = T.gravity;
    this.river = river;
    this.floodTraffic(river);
    for (const b of this.bodies) {
      if (!b.active || b.anchored || b.driven) continue;
      const rb = this.rbs[b.id];
      if (!rb) continue;
      if (b.sleeping && !b.inWater && (this.steps + b.id) % W.sleepPollStride !== 0) continue;
      const p = b.proxy;
      const q = river.flowAt(p.x, p.z);
      // The meltwater the iceberg lays as it rides across a road deck on its seats is a film on the
      // road, not a current against the girder: it crept the Highland Maze decks 0.9 m down their
      // grade after the iceberg crossed (water from below, a flood, still pushes as before).
      const onDeck = q && b.kind === 'roadBridge' && b.part === 'deck' && this.seated(b);
      if (onDeck && q.surfaceY > deckSurfaceAt(b, p.x, p.z) - 0.5) continue;
      let surfaceY: number;
      let fvx = 0;
      let fvz = 0;
      let strength = 1;
      let ocean = false;
      if (q && p.bottom < q.surfaceY + W.reach) {
        surfaceY = q.surfaceY;
        fvx = q.vx;
        fvz = q.vz;
        strength = Math.max(q.strength, W.minStrength);
      } else if (p.bottom < this.seaLevel + W.reach && this.terrain.isOcean(p.x, p.z)) {
        surfaceY = this.seaLevel;
        ocean = true;
        if (q) {
          fvx = q.vx;
          fvz = q.vz;
        }
      } else {
        if (b.inWater) {
          b.inWater = false;
          rb.setAngularDamping(dryAngularDamping(b.material));
        }
        continue;
      }
      if (!b.inWater) {
        b.inWater = true;
        rb.setAngularDamping(W.wetAngularDamping);
        if (!b.everWet) {
          b.everWet = true;
          this.events.push({
            type: 'splash',
            pos: { x: p.x, y: surfaceY, z: p.z },
            intensity: clamp(0.15 + b.mass / 20, 0.15, 1),
          });
        }
      }

      const height = Math.max(p.top - p.bottom, 0.05);
      const mat = T.materials[b.material];
      const lift = W.floatRatio * mat.buoyancy;
      const submerged = clamp((surfaceY - p.bottom) / height, 0, 1);
      const wetH = clamp(surfaceY + W.reach - p.bottom, W.minWetHeight, height);
      const rvx = fvx - p.vx;
      const rvz = fvz - p.vz;
      const rl = Math.hypot(rvx, rvz);
      const hx = this.halfExtentX(b);
      const hz = this.halfExtentZ(b);
      // Frontal width across the relative flow direction.
      const width =
        rl > 1e-3 ? 2 * (hx * Math.abs(rvz / rl) + hz * Math.abs(rvx / rl)) : 2 * Math.max(hx, hz);
      const coeff = W.drag * width * wetH * strength;
      const m = b.mass;

      if (b.sleeping) {
        // Stay asleep in still water, far from the focus (LOD), or when the drag at rest could
        // not beat ground friction.
        const flowSpeed = Math.hypot(fvx, fvz);
        if (flowSpeed < W.wakeFlowSpeed || this.isFar(p)) continue;
        const support = Math.max(0, 1 - lift * submerged);
        if (coeff * flowSpeed < W.wakeFraction * mat.friction * m * g * support) continue;
      }

      const k = Math.min(coeff * dt, W.maxGapPerStep * m);
      let iy = -m * p.vy * (1 - Math.exp(-W.verticalDamping * dt)) * Math.max(submerged, 0.3);
      if (lift > 0) iy += m * g * lift * submerged * dt;
      else if (ocean && submerged > 0.5) {
        iy += m * g * W.oceanRockLift * dt;
        if (p.vy < 0) iy -= m * p.vy * (1 - Math.exp(-W.oceanRockDamping * dt));
      }
      this.tImp.x = rvx * k;
      this.tImp.y = iy;
      this.tImp.z = rvz * k;
      this.tPt.x = p.x;
      this.tPt.y = Math.min(p.bottom + wetH * 0.5, p.y);
      this.tPt.z = p.z;
      if (rl > 1e-6 && k > 0) this.applyDrag(rb, rvx / rl, rvz / rl, W.maxPointGain * rl);
      else rb.applyImpulseAtPoint(this.tImp, this.tPt, true);
      b.sleeping = false;
    }
  }

  /**
   * Apply the river's impulse (this.tImp at this.tPt) so that its drag changes that point's
   * velocity along the relative flow (ux, uz) by at most `allowed` (WATER_TUNING.maxPointGain
   * times the gap). The drag is capped for the body's whole mass, but the point is its bounding
   * box's centre: off the centre of mass of a lopsided body (a felled turbine's rotor) it has far
   * less effective mass, every step overshot further, and the body spun up against what it lay on
   * and was flung at 60-130 m/s. Ordinary debris stays within the bound (exactly as before).
   */
  private applyDrag(rb: RigidBody, ux: number, uz: number, allowed: number): void {
    const v0 = rb.velocityAtPoint(this.tPt, this.tVel);
    const before = v0.x * ux + v0.z * uz;
    rb.applyImpulseAtPoint(this.tImp, this.tPt, true);
    const v1 = rb.velocityAtPoint(this.tPt, this.tVel);
    const gained = v1.x * ux + v1.z * uz - before;
    if (gained > allowed) {
      // Take back the excess share of the horizontal drag (the vertical part stays).
      const s = allowed / gained - 1;
      this.tImp.x *= s;
      this.tImp.y = 0;
      this.tImp.z *= s;
      rb.applyImpulseAtPoint(this.tImp, this.tPt, true);
    }
  }

  private halfExtentX(b: ObstacleBody): number {
    return this.worldHalfExtent(b, 0);
  }

  private halfExtentZ(b: ObstacleBody): number {
    return this.worldHalfExtent(b, 2);
  }

  /** World AABB half extent of a body along x (axis 0) or z (axis 2). */
  private worldHalfExtent(b: ObstacleBody, axis: 0 | 2): number {
    const { x: qx, y: qy, z: qz, w: qw } = b.quat;
    const ex = (b.localMax.x - b.localMin.x) / 2;
    const ey = (b.localMax.y - b.localMin.y) / 2;
    const ez = (b.localMax.z - b.localMin.z) / 2;
    if (axis === 0) {
      const r00 = 1 - 2 * (qy * qy + qz * qz);
      const r01 = 2 * (qx * qy - qw * qz);
      const r02 = 2 * (qx * qz + qw * qy);
      return Math.abs(r00) * ex + Math.abs(r01) * ey + Math.abs(r02) * ez;
    }
    const r20 = 2 * (qx * qz - qw * qy);
    const r21 = 2 * (qy * qz + qw * qx);
    const r22 = 1 - 2 * (qx * qx + qy * qy);
    return Math.abs(r20) * ex + Math.abs(r21) * ey + Math.abs(r22) * ez;
  }

  // -------------------------------------------------------------------------------------------
  // Road traffic (living world: src/core/traffic)
  // -------------------------------------------------------------------------------------------

  /**
   * Starts the road traffic (createPhysicsWorld calls it after warm-up): traffic lights at the right
   * kerb of every approach to a signalised junction (and designer-placed lights bound to the nearest
   * approach), and every car, truck or bus placed on a road (not `parked`, not on a parking area)
   * driving in its nearest lane, the one its yaw agrees with. Driving bodies are disabled in Rapier:
   * the traffic sets their pose, proxy and velocity every step until releaseVehicle.
   */
  setupTraffic(): void {
    if (this.traffic) return;
    const terrain = this.terrain;
    const level = terrain.level;
    const net = trafficNetwork(terrain);
    const placedLights = this.bodies.some((b) => b.active && b.kind === 'trafficLight');
    if (net.paths.length === 0 && !placedLights) return;
    this.decks = this.bodies.filter((b) => b.active && isDeckBody(b));
    let lights = 0;
    for (const J of net.junctions) {
      if (!J.signalised) continue;
      for (const leg of J.legs) {
        if (leg.inLane < 0 || leg.group < 0) continue;
        const lane = net.paths[leg.inLane];
        const n = lane.xs.length - 1;
        const ex = lane.xs[n];
        const ez = lane.zs[n];
        const l = Math.hypot(ex - lane.xs[n - 1], ez - lane.zs[n - 1]) || 1;
        const dx = (ex - lane.xs[n - 1]) / l;
        const dz = (ez - lane.zs[n - 1]) / l;
        const line = net.lines[lane.line];
        // Just past the right edge of the road (right of travel is (-dz, dx)), facing the traffic.
        const kerb = line.width / 2 - laneOffsetOf(line.width) + 0.9;
        const rng = placementRng(this.seed ^ 0x5167a1, lights++);
        const opts = { dirX: -dx, dirZ: -dz, yaw: 0 };
        for (const s of specsForKind('trafficLight', ex - dz * kerb, ez + dx * kerb, terrain, rng, opts)) {
          s.signal = { junction: J.id, group: leg.group };
          this.addBody(s);
        }
      }
    }
    for (const b of this.bodies) {
      if (b.active && b.kind === 'trafficLight' && !b.signal) b.signal = this.bindLight(b.pos.x, b.pos.z);
    }
    const spawns: VehicleSpawn[] = [];
    for (const b of this.bodies) {
      if (!b.active || b.anchored || b.placement < 0 || !DRIVING_KINDS.has(b.kind)) continue;
      const p = level.obstacles[b.placement];
      if (!p || p.parked) continue;
      const c = terrain.course.project(b.pos.x, b.pos.z);
      if (parkingAt(level, c.s, c.d) >= 0) continue;
      const li = roadLineAt(net.lines, c.s, c.d, TW.roadMargin);
      if (li < 0 || net.lines[li].surface === 'rail') continue;
      // The way it faces (local +z) picks the lane direction.
      const { x: qx, y: qy, z: qz, w: qw } = b.quat;
      const hx = 2 * (qx * qz + qw * qy);
      const hz = 1 - 2 * (qx * qx + qy * qy);
      const lane = nearestLane(net, b.pos.x, b.pos.z, hx, hz, TW.laneReach);
      if (!lane) continue;
      const seed = Math.imul((this.seed ^ 0x7ea51c) + b.placement, 0x9e3779b1) ^ b.id;
      const onDeck = net.lines[li].carve ? undefined : this.deckTopAt(b.pos.x, b.pos.z);
      const kind = b.kind as VehicleKind;
      spawns.push({ body: b.id, kind, path: lane.path, arc: lane.arc, seed, y: onDeck });
    }
    this.closedAt = new Int32Array(net.paths.length).fill(-1 << 30);
    this.closedState = new Uint8Array(net.paths.length);
    const t = new TrafficSystem(net, spawns, {
      support: (x, z, ref) => this.supportAt(x, z, ref),
      scan: (i, xs, ys, zs, n, carried) => this.scanLane(i, xs, ys, zs, n, carried),
      closed: (p) => this.pathClosed(p),
      roomFor: (i, x, z, hx, hz) => this.roomFor(i, x, z, hx, hz),
    });
    this.traffic = t;
    for (let i = 0; i < t.count; i++) {
      const b = this.bodies[t.body[i]];
      b.driven = true;
      b.sleeping = false;
      this.rbs[b.id]?.setEnabled(false);
      this.writePose(b, i);
    }
    this.rebuildGrid();
    this.version++;
  }

  /**
   * icebergGround (PhysicsWorldApi): the ground under an iceberg at (x, y, z) (its base) this step:
   * the terrain, or with the running surface of the road bridge it is on stamped in (./deckGround.ts).
   * Built on the first call, after warm-up, from the decks and abutments of every road bridge that
   * runs rim to rim (a wall-to-wall viaduct is passed under, never ridden).
   */
  icebergGround(x: number, y: number, z: number, radius: number): Terrain {
    if (this.deckGround === undefined) this.deckGround = this.buildDeckGround();
    const dg = this.deckGround;
    if (!dg) return this.terrain;
    const ground = dg.groundFor(x, y, z, radius);
    // And the bridges' parapets it meets this step, handed out with the bodies (proxiesNear).
    this.parapets = dg.parapetsFor(x, y, z, radius, this.iceVx, this.iceVz);
    return ground;
  }

  /** icebergBank (PhysicsWorldApi): the corridor between the barriers of the bridge it rides. */
  icebergBank(x: number, y: number, z: number): RiverBank | null {
    return this.deckGround ? this.deckGround.bankFor(x, y, z) : null;
  }

  private buildDeckGround(): DeckGround | null {
    const rims = new Set(
      bridgePlans(this.terrain)
        .filter((p) => p.kind === 'roadBridge' && p.mode === 'rims')
        .map((p) => p.index),
    );
    if (rims.size === 0) return null;
    const byBridge = new Map<number, DeckSurface[]>();
    for (const b of this.bodies) {
      if (!b.active || b.kind !== 'roadBridge' || !rims.has(b.placement)) continue;
      if (b.part !== 'deck' && b.part !== 'abutment') continue;
      const list = byBridge.get(b.placement) ?? [];
      list.push(this.deckSurface(b));
      byBridge.set(b.placement, list);
    }
    return byBridge.size > 0 ? new DeckGround(this.terrain, [...byBridge.values()]) : null;
  }

  /**
   * A bridge body's running surface for the iceberg: its top face (deckSurfaceAt) over its plan
   * (its skewed footprint, else its collider box), in the body frame on that face.
   */
  private deckSurface(b: ObstacleBody): DeckSurface {
    const s = b.renderScale;
    const f = b.footprint;
    const local = { x: 0, z: 0 };
    const toLocal = (x: number, z: number): { x: number; z: number } => {
      const { x: qx, y: qy, z: qz, w: qw } = b.quat;
      const dx = x - b.pos.x;
      const dy = deckSurfaceAt(b, x, z) - b.pos.y;
      const dz = z - b.pos.z;
      // Rᵀ · d: the point on the top face over (x, z), in the body frame (columns 0 and 2 of R).
      const r00 = 1 - 2 * (qy * qy + qz * qz);
      const r10 = 2 * (qx * qy + qw * qz);
      const r20 = 2 * (qx * qz - qw * qy);
      const r02 = 2 * (qx * qz + qw * qy);
      const r12 = 2 * (qy * qz - qw * qx);
      const r22 = 1 - 2 * (qx * qx + qy * qy);
      local.x = (r00 * dx + r10 * dy + r20 * dz) / s;
      local.z = (r02 * dx + r12 * dy + r22 * dz) / s;
      return local;
    };
    const deck = b.part === 'deck';
    return {
      x: b.proxy.x,
      z: b.proxy.z,
      radius: b.proxy.radius,
      distance: (x, z) => proxyDistance(b.proxy, x, z),
      top: (x, z) => deckSurfaceAt(b, x, z),
      beyondSides: (x, z, along) => {
        const p = toLocal(x, z);
        if (f) {
          if (p.x < f.x0 + f.k0 * p.z - along || p.x > f.x1 + f.k1 * p.z + along) return Infinity;
          return Math.abs(p.z) - f.hz;
        }
        const { localMin: lo, localMax: hi } = b;
        if (p.x < lo.x - along || p.x > hi.x + along) return Infinity;
        return Math.max(lo.z - p.z, p.z - hi.z);
      },
      standing: () => b.active && (b.anchored || this.seated(b)),
      ride: (on) => {
        if (deck) b.proxy.passable = on;
      },
      barriers: barriersOf(b),
    };
  }

  /** setIceberg (PhysicsWorldApi): road traffic brakes for the iceberg. */
  setIceberg(x: number, z: number, radius: number, vx = 0, vz = 0): void {
    this.iceX = x;
    this.iceZ = z;
    this.iceR = radius;
    this.iceVx = vx;
    this.iceVz = vz;
  }

  /** stepAmbient (PhysicsWorldApi): road traffic only, rigid bodies wait (the intro). */
  stepAmbient(dt: number): void {
    if (this.disposed || !this.traffic) return;
    this.stepTraffic(dt);
    this.rebuildGrid();
  }

  /** The colour a traffic light body shows now, or null when it is dark (knocked over, gone). */
  signalOf(b: ObstacleBody): SignalState | null {
    const t = this.traffic;
    const s = b.signal;
    if (!t || !s || !b.active || !b.anchored) return null;
    if (s.junction >= 0) return t.signal(s.junction, s.group);
    const [g, a, r] = TW.ownCycle;
    const tc = (t.time + s.group) % (g + a + r);
    return tc < g ? 'green' : tc < g + a ? 'amber' : 'red';
  }

  /** Nearest signalised approach within TRAFFIC_WORLD.lightBind of (x, z), else an own cycle. */
  private bindLight(x: number, z: number): { junction: number; group: number } {
    const net = this.traffic?.net ?? trafficNetwork(this.terrain);
    let best: { junction: number; group: number } | null = null;
    let bestD: number = TW.lightBind;
    for (const J of net.junctions) {
      if (!J.signalised) continue;
      for (const leg of J.legs) {
        if (leg.inLane < 0 || leg.group < 0) continue;
        const lane = net.paths[leg.inLane];
        const n = lane.xs.length - 1;
        const d = Math.hypot(lane.xs[n] - x, lane.zs[n] - z);
        if (d < bestD) {
          bestD = d;
          best = { junction: J.id, group: leg.group };
        }
      }
    }
    const [g, a, r] = TW.ownCycle;
    const offset = ((Math.imul(Math.round(x * 10), 0x9e3779b1) ^ Math.round(z * 10)) >>> 0) % (g + a + r);
    return best ?? { junction: -1, group: offset };
  }

  /** Copy vehicle i's pose from the traffic into its body (proxy, velocity, render stamp). */
  private writePose(b: ObstacleBody, i: number): void {
    const t = this.traffic!;
    b.pos.x = t.x[i];
    b.pos.y = t.y[i];
    b.pos.z = t.z[i];
    b.quat.x = t.qx[i];
    b.quat.y = t.qy[i];
    b.quat.z = t.qz[i];
    b.quat.w = t.qw[i];
    this.refreshProxy(b);
    b.proxy.vx = t.vx[i];
    b.proxy.vy = t.vy[i];
    b.proxy.vz = t.vz[i];
    b.stamp = ++this.stampSeq;
  }

  private stepTraffic(dt: number): void {
    const t = this.traffic;
    if (!t) return;
    t.step(dt);
    let moved = false;
    for (let i = 0; i < t.count; i++) {
      if (!t.active[i]) {
        // It gave up (no way round what stands in its lane): parked where it stands, a loose body.
        if (t.gaveUp[i]) {
          const g = this.bodies[t.body[i]];
          if (g.active && g.driven) {
            this.releaseVehicle(g, i);
            this.parking.push(g);
          }
        }
        continue;
      }
      const b = this.bodies[t.body[i]];
      if (!b.active || !b.driven) {
        t.release(i);
        continue;
      }
      // The deck or road under it gave way: it falls from where it was.
      if (t.y[i] < b.pos.y - TW.supportDrop) {
        this.releaseVehicle(b, i);
        continue;
      }
      this.writePose(b, i);
      moved = true;
      if (this.hitByDebris(b)) this.releaseVehicle(b, i);
    }
    if (moved) {
      this.version++;
      this.gridDirty = true;
    }
  }

  /**
   * A driving vehicle becomes an ordinary dynamic body at its current pose, moving at its driving
   * velocity; from here on the usual contact, break, water and tally rules apply (its tallies count
   * from where it was released).
   */
  private releaseVehicle(b: ObstacleBody, index = -1): void {
    const t = this.traffic;
    const i = index >= 0 ? index : t ? t.indexOfBody(b.id) : -1;
    if (t && i >= 0) t.release(i);
    b.driven = false;
    const rb = this.rbs[b.id];
    if (!rb) return;
    rb.setEnabled(true);
    rb.setTranslation(b.pos, false);
    rb.setRotation(b.quat, false);
    const p = b.proxy;
    this.tImp.x = p.vx;
    this.tImp.y = p.vy;
    this.tImp.z = p.vz;
    rb.setLinvel(this.tImp, true);
    rb.setAngvel(this.zero, true);
    b.sleeping = false;
    b.restTime = 0;
    b.farTime = 0;
    b.spawn.x = b.pos.x;
    b.spawn.y = b.pos.y;
    b.spawn.z = b.pos.z;
    b.waterTravel = 0;
    b.otherTravel = 0;
    b.stamp = ++this.stampSeq;
    this.version++;
  }

  /**
   * Vehicles that gave up driving, released this step: after the one step that seats them on the
   * ground, asleep where they stand (a parked car, as the level's own parked ones rest), so one on a
   * steep road does not creep downhill. Anything that hits them wakes them as usual.
   */
  private parkGaveUp(): void {
    for (const b of this.parking) {
      const rb = this.rbs[b.id];
      if (!b.active || b.driven || !rb) continue;
      rb.setLinvel(this.zero, false);
      rb.setAngvel(this.zero, false);
      rb.sleep();
    }
    this.parking.length = 0;
  }

  /** Release driving vehicles the river has reached. */
  private floodTraffic(river: RiverTrailApi): void {
    const t = this.traffic;
    if (!t) return;
    for (let i = 0; i < t.count; i++) {
      if (!t.active[i]) continue;
      const b = this.bodies[t.body[i]];
      const p = b.proxy;
      const q = river.flowAt(p.x, p.z);
      if (q && p.bottom < q.surfaceY + W.reach && q.surfaceY < p.top + 1) this.releaseVehicle(b, i);
    }
  }

  /** Height a wheel stands on: the terrain, or a deck within deckReach of refY (NaN: terrain). */
  private supportAt(x: number, z: number, refY: number): number {
    let h = this.terrain.heightAt(x, z);
    if (!Number.isFinite(refY)) return h;
    for (const d of this.decks) {
      if (!d.active || proxyDistance(d.proxy, x, z) > TW.deckJoint) continue;
      const top = deckSurfaceAt(d, x, z);
      if (Math.abs(top - refY) > TW.deckReach || top <= h) continue;
      h = top;
    }
    return h;
  }

  /** Highest deck top over (x, z), or undefined (vehicles placed on an elevated street). */
  private deckTopAt(x: number, z: number): number | undefined {
    let top: number | undefined;
    for (const d of this.decks) {
      if (!d.active || proxyDistance(d.proxy, x, z) > TW.deckJoint) continue;
      const y = deckSurfaceAt(d, x, z);
      if (top === undefined || y > top) top = y;
    }
    return top;
  }

  /** True if an awake loose body is touching driving vehicle v fast enough to knock it. */
  private hitByDebris(v: ObstacleBody): boolean {
    const p = v.proxy;
    const g = this.grid;
    const reach = p.radius + this.maxProxyRadius;
    const cx0 = g.cellX(p.x - reach);
    const cx1 = g.cellX(p.x + reach);
    const cz0 = g.cellZ(p.z - reach);
    const cz1 = g.cellZ(p.z + reach);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = cz * g.cols + cx;
        for (let k = g.cellStart[c]; k < g.cellStart[c + 1]; k++) {
          const o = this.bodies[g.items[k]];
          if (o === v || !o.active || o.anchored || o.driven || o.sleeping) continue;
          const q = o.proxy;
          if (q.bottom > p.top || q.top < p.bottom) continue;
          const rv = Math.hypot(q.vx - p.vx, q.vy - p.vy, q.vz - p.vz);
          if (rv < TW.debrisSpeed) continue;
          if (proxyDistance(p, q.x, q.z) - q.radius <= 0.05) return true;
        }
      }
    }
    return false;
  }

  /**
   * TrafficEnv.scan: the first of vehicle i's probe points ahead that is blocked — the road drops
   * away (a broken deck; on carved ground only a wall), the iceberg, river water on the road, or a
   * body standing in the lane that is neither low enough to drive over nor overhead (standing traffic
   * lights excepted: the traffic puts them by the kerb itself) — or -1.
   */
  private scanLane(
    i: number,
    xs: Float64Array,
    ys: Float64Array,
    zs: Float64Array,
    n: number,
    carried: Uint8Array,
  ): number {
    const t = this.traffic!;
    const v = this.bodies[t.body[i]];
    let best = n;
    let prev = v.pos.y;
    const iceReach = this.iceR + TW.laneHalf + TW.icebergClear;
    const river = this.river;
    for (let k = 0; k < n; k++) {
      if (ys[k] < prev - (carried[k] ? TW.roadDrop : TW.groundDrop)) {
        best = k;
        break;
      }
      prev = ys[k];
      const ix = xs[k] - this.iceX;
      const iz = zs[k] - this.iceZ;
      if (ix * ix + iz * iz < iceReach * iceReach) {
        best = k;
        break;
      }
      if (river && (k & 1) === 0) {
        const q = river.flowAt(xs[k], zs[k]);
        if (q && q.surfaceY > ys[k] - 0.3 && q.surfaceY < ys[k] + 3) {
          best = k;
          break;
        }
      }
    }
    if (best === 0) return 0;
    // Bodies in the lane: one sweep over the grid cells round the probes still in play.
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let k = 0; k < best; k++) {
      x0 = Math.min(x0, xs[k]);
      x1 = Math.max(x1, xs[k]);
      z0 = Math.min(z0, zs[k]);
      z1 = Math.max(z1, zs[k]);
    }
    if (this.gridDirty) this.rebuildGrid();
    const g = this.grid;
    const reach = TW.laneHalf + this.maxProxyRadius;
    const cx1 = g.cellX(x1 + reach);
    const cz1 = g.cellZ(z1 + reach);
    for (let cz = g.cellZ(z0 - reach); cz <= cz1; cz++) {
      for (let cx = g.cellX(x0 - reach); cx <= cx1; cx++) {
        const c = cz * g.cols + cx;
        for (let m = g.cellStart[c]; m < g.cellStart[c + 1]; m++) {
          const o = this.bodies[g.items[m]];
          if (o === v || !o.active || o.driven) continue;
          // A standing traffic light is kerb furniture (a turn may pass a pole's width from it); a
          // knocked-over one lies loose in the road and blocks like any debris.
          if (o.signal && o.anchored) continue;
          const q = o.proxy;
          const deck = isDeckBody(o);
          for (let k = 0; k < best; k++) {
            // A deck's top is the road where it carries it (a ramped deck's proxy top is its high end).
            const top = deck ? deckSurfaceAt(o, xs[k], zs[k]) : q.top;
            if (top < ys[k] + TW.lowClear || q.bottom > ys[k] + TW.overhead) continue;
            if (proxyDistance(q, xs[k], zs[k]) < TW.laneHalf) {
              best = k;
              break;
            }
          }
        }
      }
    }
    return best < n ? best : -1;
  }

  /**
   * TrafficEnv.roomFor: true if vehicle i's plan box (its length × width, turnRoom more each way),
   * centred at (x, z) and facing the unit (hx, hz), meets no body by the lane scan's rule (active, not
   * driven, neither low enough to drive over nor overhead; standing traffic lights excepted). Asked
   * along a turn-round's half circle and at its end, before it starts.
   */
  private roomFor(i: number, x: number, z: number, hx: number, hz: number): boolean {
    const t = this.traffic!;
    const v = this.bodies[t.body[i]];
    const spec = VEHICLE_SPECS[t.kind[i]];
    const hl = spec.length / 2 + TW.turnRoom;
    const hw = spec.width / 2 + TW.turnRoom;
    const y = this.supportAt(x, z, t.y[i]);
    if (this.gridDirty) this.rebuildGrid();
    const g = this.grid;
    const own = Math.hypot(hl, hw);
    const reach = own + this.maxProxyRadius;
    const cx1 = g.cellX(x + reach);
    const cz1 = g.cellZ(z + reach);
    for (let cz = g.cellZ(z - reach); cz <= cz1; cz++) {
      for (let cx = g.cellX(x - reach); cx <= cx1; cx++) {
        const c = cz * g.cols + cx;
        for (let m = g.cellStart[c]; m < g.cellStart[c + 1]; m++) {
          const o = this.bodies[g.items[m]];
          if (o === v || !o.active || o.driven || (o.signal && o.anchored)) continue;
          const q = o.proxy;
          const top = isDeckBody(o) ? deckSurfaceAt(o, x, z) : q.top;
          if (top < y + TW.lowClear || q.bottom > y + TW.overhead) continue;
          if (Math.hypot(q.x - x, q.z - z) > own + q.radius) continue;
          if (boxMeetsProxy(x, z, hx, hz, hl, hw, q)) return false;
        }
      }
    }
    return true;
  }

  /**
   * TrafficEnv.closed: true if a body stands in path p anywhere along it (probed every closedStep m
   * by the lane scan's own rule: neither low enough to drive over nor overhead, within laneHalf of
   * the lane; standing traffic lights excepted). Judged at most once every closedEvery traffic steps
   * per path.
   */
  private pathClosed(p: TrafficPath): boolean {
    const steps = this.traffic?.steps ?? 0;
    if (steps - this.closedAt[p.id] < TW.closedEvery) return this.closedState[p.id] === 1;
    this.closedAt[p.id] = steps;
    if (this.gridDirty) this.rebuildGrid();
    const g = this.grid;
    const reach = TW.laneHalf + this.maxProxyRadius;
    const pt = this.closedPt;
    // (The traffic is still being built when it first asks: its network is the terrain's.)
    const carried = trafficNetwork(this.terrain).lines[p.line]?.carve === false;
    let closed = false;
    for (let a = 0; a <= p.length && !closed; a += TW.closedStep) {
      pointAt(p, a, pt);
      const x = pt.x;
      const z = pt.z;
      const y = carried ? (this.deckTopAt(x, z) ?? this.terrain.heightAt(x, z)) : this.terrain.heightAt(x, z);
      const cx1 = g.cellX(x + reach);
      const cz1 = g.cellZ(z + reach);
      for (let cz = g.cellZ(z - reach); cz <= cz1 && !closed; cz++) {
        for (let cx = g.cellX(x - reach); cx <= cx1 && !closed; cx++) {
          const c = cz * g.cols + cx;
          for (let m = g.cellStart[c]; m < g.cellStart[c + 1]; m++) {
            const o = this.bodies[g.items[m]];
            if (!o.active || o.driven || (o.signal && o.anchored)) continue;
            const q = o.proxy;
            const top = isDeckBody(o) ? deckSurfaceAt(o, x, z) : q.top;
            if (top < y + TW.lowClear || q.bottom > y + TW.overhead) continue;
            if (proxyDistance(q, x, z) < TW.laneHalf) {
              closed = true;
              break;
            }
          }
        }
      }
    }
    this.closedState[p.id] = closed ? 1 : 0;
    return closed;
  }

  // -------------------------------------------------------------------------------------------
  // Queries / lifecycle
  // -------------------------------------------------------------------------------------------

  drainEvents(): GameEvent[] {
    if (this.events.length === 0) return NO_EVENTS;
    const out = this.events;
    this.events = [];
    return out;
  }

  getBody(id: number): ObstacleBody | undefined {
    return this.bodies[id];
  }

  /** Number of bodies still in the simulation. */
  get activeCount(): number {
    let n = 0;
    for (const b of this.bodies) if (b.active) n++;
    return n;
  }

  /** Number of loose bodies currently awake (simulated). */
  get awakeCount(): number {
    let n = 0;
    for (const b of this.bodies) if (b.active && !b.anchored && !b.sleeping) n++;
    return n;
  }

  /** True if the body's Rapier rigid body is dynamic. */
  isDynamic(id: number): boolean {
    const rb = this.rbs[id];
    return !!rb && rb.isDynamic();
  }

  /** Wake every loose body (e.g. after an agent edits the scene). */
  wakeAll(): void {
    this.forEachLoose((rb, b) => {
      rb.wakeUp();
      b.sleeping = false;
    });
  }

  /**
   * Rapier's current position of a loose body's origin, even while it sleeps (ObstacleBody.pos is
   * only refreshed while awake). For tests and debugging: catches a body sinking unseen.
   */
  rigidBodyPosition(id: number): Vec3 | null {
    const rb = this.rbs[id];
    if (!rb) return null;
    const t = rb.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  /** Rapier's current linear velocity of a body (tests: what a released vehicle was handed). */
  rigidBodyVelocity(id: number): Vec3 | null {
    const rb = this.rbs[id];
    if (!rb) return null;
    const v = rb.linvel();
    return { x: v.x, y: v.y, z: v.z };
  }

  /** Y where a vertical ray from (x, fromY, z) first hits the terrain collider, or null. */
  castRayDown(x: number, z: number, fromY = 10000): number | null {
    const ray = new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 });
    const tc = this.terrainCollider;
    const onlyTerrain = (c: Collider): boolean => c === tc;
    const u = undefined;
    const hit = this.world.castRay(ray, fromY + 1e5, true, u, u, u, u, onlyTerrain);
    return hit ? fromY - hit.timeOfImpact : null;
  }

  /**
   * First obstacle body a vertical ray down from (x, fromY, z) hits (colliders only, never the
   * terrain): its id and the hit y, or null. Used by tests/agents to check colliders match meshes.
   */
  raycastBodies(x: number, z: number, fromY = 10000): BodyRayHit | null {
    const ray = new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 });
    const tc = this.terrainCollider;
    const notTerrain = (c: Collider): boolean => c !== tc;
    const u = undefined;
    const hit = this.world.castRay(ray, fromY + 1e5, true, u, u, u, u, notTerrain);
    const parent = hit?.collider.parent();
    if (!hit || !parent) return null;
    const id = this.idByHandle.get(parent.handle);
    return id === undefined ? null : { id, y: fromY - hit.timeOfImpact };
  }

  /** Exact lowest world y of the body's collider vertices (tests and agents). */
  lowestPointY(id: number): number {
    const b = this.bodies[id];
    if (!b) return NaN;
    let lo = Infinity;
    _q1.set(b.quat.x, b.quat.y, b.quat.z, b.quat.w);
    for (const part of b.parts) {
      if (part.decor) continue;
      const pts = scaledPoints(getGeom(part.geom), part.scale);
      _q2.set(part.rotation.x, part.rotation.y, part.rotation.z, part.rotation.w);
      for (let i = 0; i < pts.length; i += 3) {
        _v1.set(pts[i], pts[i + 1], pts[i + 2]).applyQuaternion(_q2);
        _v1.x += part.offset.x;
        _v1.y += part.offset.y;
        _v1.z += part.offset.z;
        _v1.multiplyScalar(b.renderScale).applyQuaternion(_q1);
        lo = Math.min(lo, b.pos.y + _v1.y);
      }
    }
    return lo;
  }

  /** Angle (rad) between the body's local up axis and world up. */
  tiltOf(id: number): number {
    const b = this.bodies[id];
    if (!b) return NaN;
    const { x, z } = b.quat;
    const upY = 1 - 2 * (x * x + z * z);
    return Math.acos(clamp(upY, -1, 1));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.world.free();
    this.rbs.length = 0;
    for (const b of this.bodies) b.active = false;
    this.nearOut.length = 0;
    this.idByHandle.clear();
    this.chunks.length = 0;
    this.chunkShape.clear();
    this.toppling.length = 0;
  }
}
