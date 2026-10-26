import type { BuiltinObstacleKind, ObstacleKind } from '../types';

/**
 * Obstacle catalog: masses, sizes, break thresholds and colours for the built-in kinds (structures
 * are data-driven: see ./structures/index.ts).
 *
 * Break thresholds are authored as the closing SPEED at which a reference 30 t iceberg breaks the
 * obstacle and converted with the momentum rule: an anchored (standing) obstacle breaks iff
 *   J_test = (1 + e) · vn · M >= breakImpulse,   M = the iceberg's current mass, e = 0.25,
 * so breakImpulse = (1 + e) · breakSpeed · 30 t (· scale² for scaled placements: strength grows
 * with cross-section). Heavier icebergs break the same obstacle at proportionally lower speeds.
 * When an obstacle gives way, the impulse it RECEIVES stays the shared loose-body rule
 *   J = (1 + e) · vn · (M · m / (M + m)).
 */

/** The tutorial iceberg's mass; break speeds are quoted for an iceberg this heavy. */
export const REFERENCE_ICEBERG_MASS = 30;
/** @deprecated kept for older call sites; same value as REFERENCE_ICEBERG_MASS. */
export const ICEBERG_MASS = REFERENCE_ICEBERG_MASS;
export const CONTACT_RESTITUTION = 0.25;

/** Impulse the shared (loose-body) rule produces for a 30 t iceberg hitting a body of mass m. */
export function contactImpulseFor(mass: number, closingSpeed: number): number {
  return (1 + CONTACT_RESTITUTION) * closingSpeed * ((ICEBERG_MASS * mass) / (ICEBERG_MASS + mass));
}

/** Closing speed at which the loose-body rule's impulse reaches `impulse` for a body of mass m. */
export function closingSpeedFor(mass: number, impulse: number): number {
  return impulse / ((1 + CONTACT_RESTITUTION) * ((ICEBERG_MASS * mass) / (ICEBERG_MASS + mass)));
}

/** breakImpulse of an anchored obstacle that a 30 t iceberg breaks at `speed` (scaled by scale²). */
export function momentumBreakImpulse(speed: number, scale = 1): number {
  return (1 + CONTACT_RESTITUTION) * speed * REFERENCE_ICEBERG_MASS * scale * scale;
}

/** Closing speed at which an iceberg of mass M breaks an anchored obstacle of `breakImpulse`. */
export function momentumBreakSpeed(breakImpulse: number, icebergMass = REFERENCE_ICEBERG_MASS): number {
  return breakImpulse / ((1 + CONTACT_RESTITUTION) * icebergMass);
}

/**
 * What a body is made of: decides buoyancy, damping and friction (PHYSICS_TUNING.materials).
 * Wood, masonry debris and ice float; metal is mostly dragged along and sinks; stone sinks.
 */
export type ObstacleMaterial = 'stone' | 'wood' | 'masonry' | 'metal' | 'ice';

/**
 * How the collision proxy's horizontal radius is derived.
 * - sphere: rotation-invariant bounding radius (rocks, stones)
 * - trunk: a standing tree only collides with its trunk
 * - footprint: intact building, between its half-diagonal and half-length
 * - extent: loose debris / fallen trees, mean of the world AABB half extents
 */
export type ProxyMode = 'sphere' | 'trunk' | 'footprint' | 'extent';

export interface RockSizeSpec {
  /** Mean radius range (m) before placement.scale. */
  radiusMin: number;
  radiusMax: number;
  /** Mass (t) at the nominal radius; scales with r^3. */
  nominalMass: number;
  nominalRadius: number;
  /** Vertical squash range (sy / r). */
  squashMin: number;
  squashMax: number;
}

export const ROCK_SIZES: Record<'rockSmall' | 'rockMedium' | 'boulder', RockSizeSpec> = {
  rockSmall: {
    radiusMin: 0.6,
    radiusMax: 0.9,
    nominalMass: 0.8,
    nominalRadius: 0.75,
    squashMin: 0.95,
    squashMax: 1.0,
  },
  rockMedium: {
    radiusMin: 1.2,
    radiusMax: 1.6,
    nominalMass: 4,
    nominalRadius: 1.4,
    squashMin: 0.72,
    squashMax: 0.88,
  },
  boulder: {
    radiusMin: 2.2,
    radiusMax: 3.0,
    nominalMass: 22,
    nominalRadius: 2.6,
    squashMin: 0.7,
    squashMax: 0.85,
  },
};

export const ROCK_CLUSTER = {
  countMin: 3,
  countMax: 6,
  defaultSpread: 4.5,
  /** Fraction of members that are medium rocks (the rest are small). */
  mediumShare: 0.35,
} as const;

export const STONE_BARRIER = {
  /** Half extents of one stone: along the wall, height, depth (m). */
  halfLength: [1.15, 1.35] as const,
  halfHeight: [0.72, 0.85] as const,
  halfDepth: [0.95, 1.1] as const,
  /**
   * The shared rule keeps 1 - 1.25 m/(30 + m) of the speed per stone engaged: 7-8 t stones keep
   * ~45-50 % of a centred hit across three stones (costly but passable); 10-14 t kept only ~30 %.
   */
  massMin: 7,
  massMax: 8,
  /** Total stones (bottom row + top row); default picked in [3, 4]. */
  countMin: 3,
  countMax: 5,
} as const;

export const PINE = {
  heightMin: 6,
  heightMax: 9,
  nominalHeight: 7.5,
  nominalMass: 2,
  breakSpeed: 7,
  /**
   * The uprooting impulse is applied this far (fraction of height) above the centre of mass, so
   * the tree topples forward instead of cartwheeling away.
   */
  hitAboveCom: 0.08,
} as const;

export const BROADLEAF = {
  heightMin: 5,
  heightMax: 7.5,
  nominalHeight: 6.2,
  nominalMass: 3,
  breakSpeed: 9,
  hitAboveCom: 0.08,
} as const;

/** House dimensions in metres (house-local frame: ridge along x, front door faces +z). */
export const HOUSE = {
  width: 6.4,
  depth: 5.2,
  wallHeight: 2.9,
  wallThickness: 0.3,
  pitch: (34 * Math.PI) / 180,
  roofThickness: 0.24,
  overhang: 0.45,
  chimney: { w: 0.62, h: 2.1, d: 0.62 },
  /** Mass (t) split across the pieces when the house breaks. */
  mass: 12,
  /** A 30 t iceberg flattens it above this closing speed (momentum rule: ~562 t·m/s). */
  breakSpeed: 15,
  /** Mass shares of the pieces (sum = 1). */
  share: { front: 0.17, back: 0.17, gable: 0.15, roof: 0.14, chimney: 0.08 },
  /** Fraction of the contact impulse that is handed to the debris (the rest is "absorbed"). */
  debrisImpulseScale: 0.75,
} as const;

/**
 * Glacier ice. Blocks are loose bodies the iceberg absorbs on contact; chunks are pieces broken off
 * the iceberg itself by hard hits (not absorbable, they tumble, float and melt away).
 */
export const ICE = {
  /** t/m³: block and chunk masses follow their hull volume. */
  density: 0.917,
  /** Range every iceBlock / iceField member falls in at scale 1 (t). */
  blockMass: [2, 25] as const,
  /** A lone iceBlock's mass range at scale 1 (t). */
  singleMass: [4, 14] as const,
  /** iceField: default member count and spread radius (m). */
  fieldCount: [5, 9] as const,
  fieldSpread: 7,
  /** Friction of ice on terrain and debris (blocks start asleep, so they stay put until touched). */
  friction: 0.25,
  /** Chunks broken off per hit and the most alive at once (the oldest goes first beyond that). */
  chunksPerHit: 6,
  maxChunks: 30,
  /** Hits chipping less than this (t) shed no visible chunk. */
  chunkMinTotal: 0.04,
  /** Aim for chunks of about this mass (t) before the per-hit cap. */
  chunkTarget: 0.6,
  /** Seconds a chunk lives (random in range); it shrinks during the last chunkMelt seconds. */
  chunkLife: [12, 20] as const,
  chunkMelt: 2.5,
  /**
   * Seconds a new chunk is hidden from the iceberg solver: it spawns against the iceberg, and in
   * this time it has fallen behind and out to the side (the iceberg is not hit by its own ice).
   */
  chunkGrace: 1.5,
  /** Chunk launch: share of the iceberg velocity kept, sideways and upward scatter (m/s). */
  chunkKeep: 0.6,
  chunkScatter: [1.5, 4] as const,
  /**
   * Chunks breaking off an iceberg (spawnIceChunks with `around`) start on its flanks, this far
   * round from straight ahead (rad: beside to behind it), and fly outward at chunkScatter.
   */
  chunkFlank: [1.4, 2.6] as const,
  chunkLift: [2, 4.5] as const,
  /** Random spin (rad/s) per axis. */
  chunkSpin: 4,
} as const;

export interface KindInfo {
  anchored: boolean;
  material: ObstacleMaterial;
  /** Closing speed (m/s) at which a 30 t iceberg breaks/uproots it. Infinity for loose bodies. */
  breakSpeed: number;
  proxyMode: ProxyMode;
  /** Proxy `part` label for the intact body. */
  part: string;
}

const looseStone = (part: string): KindInfo => ({
  anchored: false,
  material: 'stone',
  breakSpeed: Infinity,
  proxyMode: 'sphere',
  part,
});

const anchoredTree = (breakSpeed: number): KindInfo => ({
  anchored: true,
  material: 'wood',
  breakSpeed,
  proxyMode: 'trunk',
  part: 'trunk',
});

const glacierIce: KindInfo = {
  anchored: false,
  material: 'ice',
  breakSpeed: Infinity,
  proxyMode: 'extent',
  part: 'ice',
};

/** Built-in kinds. Structures (StructureKind) and the house are defined by the structure kit. */
export const KIND_INFO: Record<Exclude<BuiltinObstacleKind, 'house'>, KindInfo> = {
  rockSmall: looseStone('rock'),
  rockMedium: looseStone('rock'),
  boulder: looseStone('rock'),
  rockCluster: looseStone('rock'),
  stoneBarrier: looseStone('stone'),
  pine: anchoredTree(PINE.breakSpeed),
  broadleaf: anchoredTree(BROADLEAF.breakSpeed),
  iceBlock: glacierIce,
  iceField: glacierIce,
};

export const isRockKind = (k: ObstacleKind): boolean =>
  k === 'rockSmall' || k === 'rockMedium' || k === 'boulder' || k === 'rockCluster' || k === 'stoneBarrier';

export const isTreeKind = (k: ObstacleKind): boolean => k === 'pine' || k === 'broadleaf';

export const isIceKind = (k: ObstacleKind): boolean => k === 'iceBlock' || k === 'iceField';

/** Instance tints (0xRRGGBB). Geometry vertex colours multiply with these. */
export const COLORS = {
  rock: [0x8d8f99, 0x9a9ca6, 0x8a8584, 0x9c8572, 0x8f7a68, 0x80828e] as const,
  boulder: [0x858894, 0x929099, 0x977f6c, 0x8a7a6e] as const,
  barrierStone: [0xb8ab98, 0xab9f8f, 0xc2b5a2, 0xb3a593] as const,
  trunk: [0x6b4a2e, 0x7a5434, 0x5e4029] as const,
  pineCone: [0x2f9e44, 0x37b24d, 0x2b8a3e] as const,
  pineAccent: [0xc8f04a, 0xb5e83c] as const,
  canopy: [0x5bd43a, 0x4cc23a, 0x6ad94a, 0x45b035] as const,
  wall: [0xf6ead0, 0xf3e3c3, 0xf7efdc, 0xf1dcc0] as const,
  roof: [0xd2603a, 0xc4532f, 0xdb6c42] as const,
  chimney: [0x9c4a32, 0x8f4430] as const,
  /** Glacier blocks: pale blue-white compacted ice. */
  glacier: [0xd3eef8, 0xc2e6f4, 0xdff4fb, 0xb7dff0] as const,
  /** Chunks off the player's iceberg: its own turquoise (paler tints read grey-teal over grass). */
  chunk: [0x6ff7ec, 0x4fe6e8, 0x9ffbf4] as const,
} as const;
