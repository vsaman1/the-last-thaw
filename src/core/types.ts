/**
 * Shared contracts for every game system.
 *
 * Everything under src/core is pure TypeScript (no React, no WebGL) so it can run headless in
 * tests and, later, be driven or inspected by an agent through src/core/api.ts.
 *
 * Units: metres, seconds, radians. Mass is in "tonnes" (an arbitrary but consistent unit that
 * Rapier also uses), so impulse = tonne·m/s.
 *
 * World axes (three.js): +Y is up. The ground plane is X/Z.
 * Heading convention: heading θ (radians) → horizontal direction (sin θ, cos θ) in (x, z).
 * "Right" of a direction (dx, dz) is (-dz, dx). Positive steer = turn right = θ decreases.
 * Use the helpers in ./math.ts rather than re-deriving these.
 */

export interface Vec2 {
  x: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// ---------------------------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------------------------

/** A control point of the level's centreline ("course"), listed from start to open ocean. */
export interface CoursePoint {
  x: number;
  z: number;
  /** Valley-floor elevation here BEFORE cliff drops are subtracted (gentle descent only). */
  floor: number;
  /** Half-width of the passable valley floor at this point. */
  halfWidth: number;
}

/**
 * A sharp drop in the valley floor that becomes a waterfall. With `width` it is a CLIFF BAND: sheer
 * only over that part of the floor; beyond its ends the same drop is spread into a slope you can
 * ride round (steeper the closer to the band). The ground below is `drop` lower everywhere.
 */
export interface CliffDef {
  /** Arc length along the course where the lip of the cliff is (at the band's centre `d`). */
  s: number;
  /** Height of the drop in metres (subtracted from every floor point downstream of `s`). */
  drop: number;
  /** Cliff band: lateral centre (m, default 0) and width (m) of the sheer part (omitted = whole floor). */
  d?: number;
  width?: number;
  /** Diagonal band: its lip runs at s + skew·(d' − d) (ds per metre across; |skew| ≤ 1.5). */
  skew?: number;
  /**
   * Band only: confine its spread. By default, from 22.5 m beyond its ends on, the drop is spread over
   * 90 m along s across the whole rest of the floor (+1.5·drop/90 steeper: +0.2 for 12 m, in every
   * branch). With spreadSlope it keeps lengthening (4 m per metre out) until the floor there is at
   * most this much steeper: 0.05 spreads a 12 m drop over up to 360 m (+0.05 far across the slope).
   */
  spreadSlope?: number;
}

/** A point in course coordinates (arc length s, lateral offset d; positive d = right of travel). */
export interface CourseCoord {
  s: number;
  d: number;
}

export type BuiltinObstacleKind =
  | 'rockSmall'
  | 'rockMedium'
  | 'boulder'
  | 'rockCluster'
  | 'stoneBarrier'
  | 'pine'
  | 'broadleaf'
  | 'house'
  /** Loose blocks of glacier ice the iceberg ABSORBS on contact (it grows, momentum is conserved). */
  | 'iceBlock'
  /** A field of iceBlocks of mixed sizes (cluster: count, spread). */
  | 'iceField';

/**
 * Data-driven structures (one definition file each under src/core/obstacles/structures/): compounds
 * of simple parts that stand (anchored) until hit hard enough, then break into loose pieces.
 */
export type StructureKind =
  // roads, rail, water
  | 'car'
  | 'truck'
  | 'bus'
  | 'fence'
  | 'guardrail'
  | 'footbridge'
  | 'roadBridge'
  | 'railWagon'
  | 'boat'
  | 'dam'
  // town
  | 'church'
  | 'waterTower'
  | 'lighthouse'
  | 'apartmentBlock'
  | 'monument'
  // industry and energy
  | 'coolingTower'
  | 'smokestack'
  | 'tank'
  | 'factoryHall'
  | 'pylon'
  | 'windTurbine'
  // oil and gas extraction (added for Story Mode; usable in any level)
  | 'pumpjack'
  | 'oilRig'
  | 'pipeline'
  // mountains and farms
  | 'chalet'
  | 'skiLiftPylon'
  | 'barn'
  | 'silo'
  | 'logPile'
  // traffic (auto-placed at signalised junctions: see src/core/traffic)
  | 'trafficLight';

export type ObstacleKind = BuiltinObstacleKind | StructureKind;

/** Obstacles are placed in course coordinates so level authors never compute world x/z. */
export interface ObstaclePlacement {
  kind: ObstacleKind;
  /** Arc length along the course. */
  s: number;
  /** Signed lateral offset from the centreline; positive = right of travel direction. */
  d: number;
  /**
   * Yaw in radians RELATIVE TO THE COURSE DIRECTION at s (0 = the kind's default orientation:
   * spanning kinds such as bridges, dams, fences and guardrails run across the valley; vehicles and
   * buildings face down-course). Omitted = the spawner picks a deterministic value.
   */
  yaw?: number;
  /** Uniform scale multiplier (default 1). */
  scale?: number;
  /** For cluster kinds: number of members (default chosen by the catalog). */
  count?: number;
  /** For cluster kinds: radius in metres members are spread over. */
  spread?: number;
  /** For spanning kinds (bridges, dams, fences, guardrails): length in metres (default: floor width). */
  span?: number;
  /**
   * Vehicles (car, truck, bus) placed on a road drive in its traffic; parked ones stay where they
   * are (vehicles on a `parking` feature are always parked).
   */
  parked?: boolean;
  /**
   * A look of the same kind (src/core/obstacles/structures/ruin.ts). 'ruined': an abandoned building
   * the floods have been through (part of its roof and walls gone, a dark flood line, broken and
   * boarded windows, rubble, no smoke), lighter and weaker than the intact one. Only the kinds whose
   * definition lists it in StructureDef.variants take it (house, chalet, barn).
   */
  variant?: StructureVariant;
}

/** Looks a structure kind may offer besides its intact one (ObstaclePlacement.variant). */
export type StructureVariant = 'ruined';

/** Surface of a road: paved, gravel, or a rail track bed (no road traffic; rail wagons stand on it). */
/**
 * An intended end of a road, street or track bed where the world logic check would otherwise call it
 * a dead end in the middle of nowhere: 'turning' (a turning circle / cul-de-sac), 'trailhead' (a
 * footpath goes on), 'buffer' (a buffer stop at the end of a track bed).
 */
export type RoadEnd = 'turning' | 'trailhead' | 'buffer';

export type RoadSurface = 'asphalt' | 'gravel' | 'rail';

/**
 * Where a stream's water comes from: a river cannot just pop out of open ground (world logic rule
 * 'stream-source', src/core/terrain/logic.ts). With a source the channel starts at its full section
 * (no fade-in): hidden under the ice, in the spring pool, or in the parent stream.
 * - 'glacier': meltwater from the level-start glacier (src/core/glacier). The first point lies under
 *   the ice (upstream of the snout at its d, inside the glacier's width); the channel runs out of an
 *   ice portal, an arched opening in the snout's face.
 * - 'cave': a spring. The first point is the middle of a round spring pool (a small reservoir of
 *   still water the river flows out of) at the foot of a rock face, with a cave mouth in the face
 *   behind it (against the first segment's direction): the valley wall, a wall ridge, a cliff or
 *   rock step. The ground behind the mouth must rise like a rock face (STREAM_SOURCE_RULES).
 * - 'branch': a mill race or distributary leaving another stream: the first point lies in that
 *   stream's channel, whose water there stands at or above this stream's bed.
 */
export type StreamSource = 'glacier' | 'cave' | 'branch';

/**
 * Extra terrain shapes added on top of the course valley (all in course coordinates). They make the
 * ideal line less obvious: split channels, momentum hills, traps, jumps.
 */
export type TerrainFeature =
  /** A rocky ridge/island on the floor splitting it into two channels between s0 and s1. */
  | { type: 'island'; s0: number; s1: number; d: number; width: number; height: number }
  /** A rounded hill or mound: crest it with enough momentum, or roll back and get stuck. */
  | { type: 'hill'; s: number; d: number; radius: number; height: number }
  /** A bowl in the floor that is hard to climb out of when slow (a trap). */
  | { type: 'basin'; s: number; d: number; radius: number; depth: number }
  /** A kicker ramp rising over `length` to a sharp lip `height` m above the floor: launches jumps. */
  | { type: 'ramp'; s: number; d: number; width: number; length: number; height: number }
  /**
   * A ravine across the floor (or part of it): jump it, or fall in. width omitted = full floor.
   * `s` is the take-off (upstream) edge; the far edge is at s + length. Fatal by default: touching
   * its floor ends the run ('fell'); fatal: false makes it a plain trench (a stuck trap).
   */
  | { type: 'gap'; s: number; length: number; depth: number; d?: number; width?: number; fatal?: boolean }
  /**
   * A rock spine along a polyline of course points: branching and diagonal walls, dead ends.
   * profile 'wall' (default): sheer craggy sides like an island, impassable when tall enough;
   * 'mound': a smooth (1 − q²)² bank you crest with momentum (a hill drawn as a line).
   */
  | { type: 'ridge'; points: CourseCoord[]; width: number; height: number; profile?: 'wall' | 'mound' }
  /**
   * A groove carved along a polyline (gully / channel) that guides the iceberg. It opens gently at
   * its first point; it fades out at its last point unless `closed` (then it ends in a rounded wall
   * as steep as its sides: a dead end when those are walls).
   */
  | { type: 'gully'; points: CourseCoord[]; width: number; depth: number; closed?: boolean }
  /**
   * A ravine along a polyline (diagonal cuts across the slope): sheer walls, `depth` below the local
   * ground, rounded ends. Fatal like a gap (fatal: false = a plain trench).
   */
  | { type: 'ravine'; points: CourseCoord[]; width: number; depth: number; fatal?: boolean }
  /** A raised flat shelf with sloped edges between s0 and s1. */
  | { type: 'plateau'; s0: number; s1: number; d: number; width: number; height: number }
  /**
   * A natural stream along a polyline from its source (first point) to its mouth: a channel `width`
   * m wide between its bank tops, carved `bank` m into the ground, holding water `depth` m deep
   * (default min(1.2, 0.45 × bank)) flowing at `flow` m/s (default 4; faster and shallower on steep
   * stretches, a waterfall where the bed steps down). The bed follows the ground under the polyline
   * and never rises downstream. Banks at least ~0.95 × the iceberg's radius high hold it in the
   * channel (src/core/sim/inlandWater.ts). `end`: 'sea' (default: runs out into the sea or into
   * another stream) or 'pool' (closes in still water: a trap). A dam across it holds a reservoir.
   * `source` (see StreamSource): where its water comes from — required by the world logic check;
   * without one the channel fades in from nothing over max(width, 4 × bank).
   */
  | {
      type: 'stream';
      points: CourseCoord[];
      width: number;
      bank: number;
      depth?: number;
      flow?: number;
      end?: 'sea' | 'pool';
      source?: StreamSource;
    }
  /**
   * A levelled road/terrace cut into the floor or slope (flat across, coloured as road).
   * surface omitted = the theme's default (asphalt in town/industrial, gravel elsewhere). Runs along
   * the course; one shorter (s1 − s0) than it is wide runs ACROSS it (a cross street at the middle
   * of s0..s1, from d − width/2 to d + width/2) for the traffic network.
   */
  | {
      type: 'road';
      s0: number;
      s1: number;
      d: number;
      width: number;
      surface?: RoadSurface;
      /** An intended end at s0 / s1 (validateWorldLogic: roads must not stop in the middle of nowhere). */
      start?: RoadEnd;
      end?: RoadEnd;
    }
  // --- Living world (streets, parking, traffic: src/core/terrain/roads.ts, src/core/traffic) ---
  /**
   * A street: a levelled road along a polyline of course points (cross streets, bends, junctions;
   * junctions are found where street/road centrelines cross or meet). Vehicles placed on it drive
   * in its two lanes. carve: false = no terrain shaping or paint (a street over a road bridge or a
   * dam crest); signals: force traffic lights at its junctions on (true) or off (false).
   */
  | {
      type: 'street';
      points: CourseCoord[];
      width: number;
      surface?: RoadSurface;
      /** Speed limit (m/s; default 12.5 on asphalt, 9 on gravel). */
      speed?: number;
      signals?: boolean;
      carve?: boolean;
      /** An intended end at the first / last point (validateWorldLogic). */
      start?: RoadEnd;
      end?: RoadEnd;
    }
  /**
   * A paved parking area / garage apron (a levelled rectangle centred on s, d; `length` along the
   * course rotated by `yaw`, `width` across): vehicles placed on it are parked.
   */
  | {
      type: 'parking';
      s: number;
      d: number;
      length: number;
      width: number;
      yaw?: number;
      surface?: 'asphalt' | 'gravel';
    };

/** Terrain palette and decor flavour. */
export type LevelTheme = 'meadow' | 'canyon' | 'alpine' | 'town' | 'industrial';

/**
 * Natural relief over the whole floor (LevelDef.relief): with a wide floor (halfWidth 150–300 m) it
 * turns the valley into an OPEN MOUNTAINSIDE where several ways to the sea compete. Deterministic
 * (seeded from LevelDef.seed + `seed`). Heights in metres; every part is optional (0/omitted = off).
 * Relief fades out near the start, the coast, cliff lips, the floor edge and under ramps, plateaus
 * and roads; features are applied on top of it.
 */
export interface ReliefSettings {
  /** Broad rolling undulation: amplitude (m) and feature size (m, default 140). */
  roll?: number;
  rollScale?: number;
  /** Braided gullies running down the slope: depth (m), lateral spacing (m, default 45) and how many
   * times longer than wide they are (default 5). */
  gullies?: number;
  gullySpacing?: number;
  gullyStretch?: number;
  /** Rocky outcrops (sheer tors): height (m), share of the floor they cover (default 0.05, ≤ 0.4) and
   * size (m, default 28). Taller than ~4.5 m at cellSize 2.5 they block like islands. */
  outcrops?: number;
  outcropCover?: number;
  outcropScale?: number;
  /** Outcrops fade out within this distance (m) of LevelDef.line (default 0: anywhere). */
  lineClear?: number;
  /**
   * More corridors kept free of outcrops: alternative routes, a dam breach, a way round a band.
   * Each is a polyline of course points; outcrops fade out within `width` / 2 m of it (default:
   * lineClear m, else 15 m) and reach full height 12 m further out, as lineClear does for the line.
   */
  clear?: { points: CourseCoord[]; width?: number }[];
  /** Added to LevelDef.seed for the relief noise (default 0). */
  seed?: number;
}

export interface DecorSettings {
  /** Trees per 1000 m² on grass that are pure scenery (outside the valley floor). */
  sceneryTreeDensity: number;
  bushDensity: number;
  grassTuftDensity: number;
  pebbleDensity: number;
}

export interface LevelDef {
  id: string;
  /** 1-based display order; also drives unlocking (level n unlocks when n-1 is complete). */
  index: number;
  name: string;
  /** One-line description shown in level select and intro. */
  subtitle: string;
  seed: number;
  /** Terrain extents in world coordinates. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Terrain grid spacing in metres. */
  cellSize: number;
  /** Y of the ocean surface. */
  seaLevel: number;
  course: CoursePoint[];
  cliffs: CliffDef[];
  /** Height of the rocky valley walls above the floor. */
  wallHeight: number;
  /** Horizontal distance over which the wall rises from floor to full height. */
  wallRamp: number;
  /** Arc length where the iceberg spawns (facing down-course). */
  startS: number;
  /** Arc length where land meets the sea (approximate; terrain decides exactly). */
  coastS: number;
  /** Arc length where the completion zone begins (must be out in open water). */
  finishS: number;
  obstacles: ObstaclePlacement[];
  decor: DecorSettings;
  /** Optional sky/fog tint overrides for variety between levels. */
  sky?: { top: string; horizon: string; fog: string };
  /** Meltwater budget. Omitted = the iceberg never melts (tests, sandbox levels). */
  water?: WaterBudget;
  /**
   * This level's iceberg. scale multiplies the base radius (2.2 m) — and with it the visuals, river
   * width and camera distance; mass (t) sets how hard it hits. Default { scale: 1, mass: 30 }.
   */
  iceberg?: { scale: number; mass: number };
  /**
   * Terrain shapes on top of the valley (islands, hills, basins, ramps, gaps, plateaus, roads,
   * ridges, gullies, ravines, streams).
   */
  features?: TerrainFeature[];
  /**
   * Natural relief over the floor. Set it (with a wide halfWidth) for an OPEN MOUNTAINSIDE level: the
   * autopilot then pursues LevelDef.line as a path and validateLevel requires a way to the sea.
   */
  relief?: ReliefSettings;
  /**
   * An intended good line down the level in course coordinates (in order of s). Used by the
   * autopilot and the level's tests; the player is free to find better ones.
   */
  line?: { s: number; d: number }[];
  /** Terrain palette / decor flavour (default 'meadow'). */
  theme?: LevelTheme;
  /**
   * Snow on the playable floor (glacier and summit levels). Omitted = the theme's own snow (alpine:
   * above max(sea + 60, start floor + 18) m, so the floor stays green). Looks only.
   */
  snow?: SnowSettings;
}

/**
 * LevelDef.snow: bring the theme's snow down onto the floor. Colours and decor only — the iceberg
 * slides on snow exactly as on grass (same friction; no gameplay change). Roads, kickers, beaches and
 * painted rock (outcrops, wall ridges, islands, ravine walls) stay as they are; faces steeper than the
 * theme's snow slope (alpine 1.1) stay rock; mound ridges and the floor turn white.
 */
export interface SnowSettings {
  /**
   * World height (m, y) the snow reaches down to (default: sea level, the whole land). Its edge is
   * ragged like the theme's (alpine: raised by up to 14 m in places). Only lowers the theme's line.
   */
  line?: number;
  /**
   * Below the theme's own line: 'snow' (default) a full cover; 'patchy' snow fields with grass
   * between, closing up over the first ~80 m of height above `line`.
   */
  floor?: 'snow' | 'patchy';
}

/**
 * The river is the iceberg's own meltwater: laying river costs ice. A full iceberg can lay `metres`
 * of straight river on land; every radian of net turning costs an extra `turnMetresPerRadian`
 * (winding routes drain faster). At 0 ice the iceberg has melted away and the run fails.
 */
export interface WaterBudget {
  metres: number;
  turnMetresPerRadian: number;
}

// ---------------------------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------------------------

/** Row-major height grid: heights[iz * cols + ix] at x = originX + ix*cellSize, z = originZ + iz*cellSize. */
export interface HeightGrid {
  cols: number;
  rows: number;
  cellSize: number;
  originX: number;
  originZ: number;
  heights: Float32Array;
}

export type SurfaceKind = 'grass' | 'rock' | 'sand' | 'seabed';

export interface CourseSample {
  s: number;
  x: number;
  z: number;
  /** Unit direction of travel. */
  dirX: number;
  dirZ: number;
  /** Valley floor elevation after cliffs (the y the river would sit at on the centreline). */
  floor: number;
  halfWidth: number;
}

export interface CourseFrame {
  /** Total arc length of the smoothed centreline. */
  readonly length: number;
  sampleAt(s: number): CourseSample;
  /** Course coords → world x/z (y is terrain height at that point). */
  toWorld(s: number, d: number): Vec3;
  /** World x/z → nearest course coords. `d` positive = right of travel. */
  project(x: number, z: number): { s: number; d: number };
}

export interface Terrain {
  readonly level: LevelDef;
  readonly grid: HeightGrid;
  readonly course: CourseFrame;
  /** Bilinear height of the rendered/collided surface. Outside the grid: clamps to the edge. */
  heightAt(x: number, z: number): number;
  /** dh/dx and dh/dz of the same surface. */
  gradientAt(x: number, z: number): { dx: number; dz: number };
  normalAt(x: number, z: number): Vec3;
  surfaceAt(x: number, z: number): SurfaceKind;
  /** True if (x, z) is open water (terrain below sea level). */
  isOcean(x: number, z: number): boolean;
  /** Exact take-offs of the level's kicker ramps (none for terrains without ramp features). */
  readonly kickers?: readonly KickerLip[];
  /**
   * How far (m) fatal ravines (gap / ravine features) have lowered the surface at (x, z): 0 outside
   * them, ≈ their depth on their floor. Bilinear over the grid like the heights. Absent = no ravines.
   */
  ravineDepthAt?(x: number, z: number): number;
  /**
   * How far (m) the bridge approach cuttings (src/core/terrain/bridgeCuts.ts) lowered the surface
   * at (x, z): 0 away from bridges. Same grid and triangulation as the heights, so heightAt plus
   * this is the ground as the level made it, which is what bridge decks are planned on (a cutting
   * made against a plan can then never move the plan). Kept apart from ravineDepthAt on purpose:
   * that one feeds the fatal-fall rule and the route search. Absent = no cuttings.
   */
  bridgeCutAt?(x: number, z: number): number;
}

/**
 * The exact lip of a kicker ('ramp' feature), sampled from the terrain's height function before it
 * is triangulated. The grid only has vertices every cellSize, so the triangulated lip can end up to
 * a cell diagonal short of the authored one (lower and flatter, depending on where the lip falls on
 * the grid); the iceberg integrator launches off this instead, so jumps do not depend on alignment.
 */
export interface KickerLip {
  /** Index into level.features. */
  index: number;
  /** World x/z of the lip on the ramp's centre line, and the unit course direction there. */
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  /**
   * The lip line runs through (x, z) across (dirX, dirZ) and spans ±halfWidth m along it (positive =
   * right of travel).
   */
  halfWidth: number;
  /**
   * The grid's lip lies at most this far (m, along dir) short of the exact lip (a cell diagonal +
   * 0.5 m, at most the ramp length): over this stretch the integrator rides the exact face.
   */
  before: number;
  /**
   * Spacing (m) of the samples below, the first at -halfWidth. A sample whose fitted face does not
   * match the terrain `before` m short of the lip (something else shapes those metres) is NaN in
   * every array: the iceberg rides the grid there.
   */
  step: number;
  /** World height of the lip. */
  height: readonly number[];
  /** Slope along (dirX, dirZ) of the face at the lip (rise per metre; includes the floor's fall). */
  slope: readonly number[];
  /** Second derivative of the face height along dir (1/m): face ≈ height + slope·a + curve·a²/2. */
  curve: readonly number[];
  /** How far (m) the face `before` m short of the lip is below it: the lowest a grid lip can be. */
  drop: readonly number[];
}

// ---------------------------------------------------------------------------------------------
// Iceberg
// ---------------------------------------------------------------------------------------------

export interface SteeringInput {
  /** -1 = full left, +1 = full right. */
  steer: number;
  source: 'none' | 'keyboard' | 'mouse' | 'scripted';
}

export interface IcebergState {
  pos: Vec3;
  /** World velocity (m/s). Horizontal part is what the player feels as speed. */
  vel: Vec3;
  /** Facing yaw (see heading convention at top of file). */
  heading: number;
  /** Smoothed steer actually applied this step (-1..1). */
  steer: number;
  /** Yaw rate in rad/s. */
  yawRate: number;
  grounded: boolean;
  /** Seconds since leaving the ground (0 when grounded). */
  airTime: number;
  /** Highest y reached during the current airborne phase (for drop height on landing). */
  airPeakY: number;
  /** True once floating in the ocean. */
  inOcean: boolean;
  /**
   * True while floating on inland water (a stream, reservoir or flood; not the ocean): drawn with
   * the ocean's draft and bob. Absent / false otherwise (levels without streams never set it).
   */
  afloat?: boolean;
  /** Seconds the iceberg has been below the stuck speed threshold. */
  stuckTimer: number;
  /** Visual tilt (radians) derived from slope and turning. */
  pitch: number;
  roll: number;
  /** Hit flash / wobble for visuals, decays to 0. */
  impact: number;
  /** Horizontal radius used for collisions and river width (= params.radius × size). */
  radius: number;
  mass: number;
  /**
   * Ice relative to the level's starting iceberg (1 = as spawned). Melting and chipping lower it
   * (0 = melted away, the run fails); absorbing glacier ice raises it above 1 (up to params.maxIce).
   * The iceberg's mass is params.mass × ice.
   */
  ice: number;
  /**
   * Size multiplier applied to visuals, collision radius and river width: minSize + (1 - minSize)·ice
   * while ice <= 1 (melting), cbrt(ice) above 1 (growing — mass scales with volume).
   */
  size: number;
}

export interface IcebergParams {
  gravity: number;
  mass: number;
  radius: number;
  /** Initial shove along the course at spawn (m/s). */
  launchSpeed: number;
  maxSpeed: number;
  /** Coulomb-like friction coefficient on grass. */
  friction: number;
  /** Quadratic air/water drag coefficient. */
  drag: number;
  /** Max yaw rate at full steer (rad/s). */
  maxYawRate: number;
  /** How fast velocity aligns with heading (1/s). Lateral velocity removed this way is lost. */
  grip: number;
  /** Extra fractional speed loss per radian of heading change (zig-zag penalty). */
  turnPenalty: number;
  /** Below this horizontal speed the stuck timer runs. */
  stuckSpeed: number;
  /** Seconds below stuckSpeed before the run fails. */
  stuckTime: number;
  /** Seconds after spawn during which the stuck timer cannot run. */
  graceTime: number;
  /** Ground drop (m) within one step that makes the iceberg go airborne. */
  airborneDrop: number;
  /** Ocean: forward current speed that carries the iceberg out to sea (m/s). */
  oceanCurrent: number;
  /** Ice lost per metre of horizontal travel on land (1 / WaterBudget.metres; 0 = never melts). */
  meltPerMetre: number;
  /** Extra ice lost per radian of net heading change on land (turnMetresPerRadian / metres). */
  meltPerRadian: number;
  /** Size at 0 ice (size = minSize + (1 - minSize) × ice). */
  minSize: number;
  /** Hits with IcebergContact.shock below this (m/s) chip no ice. */
  chipThreshold: number;
  /** Ice lost per m/s of shock above the threshold (fraction of a full iceberg). */
  chipPerShock: number;
  /** Most ice a single hit can chip off. */
  chipMax: number;
  /** Largest ice ratio the iceberg can grow to by absorbing glacier ice. */
  maxIce: number;
}

/** Events emitted by the iceberg integrator during one step. */
export type IcebergStepEvent =
  | { type: 'airborne'; pos: Vec3; speed: number }
  | { type: 'landed'; pos: Vec3; drop: number; speed: number }
  | { type: 'enteredOcean'; pos: Vec3 };

// ---------------------------------------------------------------------------------------------
// Obstacles / physics
// ---------------------------------------------------------------------------------------------

export type ObstacleState = 'intact' | 'loose' | 'broken';

/** What the iceberg collision solver sees of each obstacle body each step. */
export interface ObstacleProxy {
  id: number;
  kind: ObstacleKind;
  /** Which part of a compound obstacle (e.g. 'roof', 'trunk', 'stone'). */
  part: string;
  x: number;
  y: number;
  z: number;
  /** Horizontal collision radius. */
  radius: number;
  /** World y of the top and bottom of the body (to skip things the iceberg passes over). */
  top: number;
  bottom: number;
  mass: number;
  vx: number;
  vy: number;
  vz: number;
  /** Anchored bodies (standing trees, intact houses) behave as immovable until broken. */
  anchored: boolean;
  /** Impulse magnitude needed to break/uproot an anchored body. Infinity = never. */
  breakImpulse: number;
  state: ObstacleState;
  /** Glacier ice the iceberg absorbs on contact instead of colliding with. */
  absorbable?: boolean;
  /** The iceberg rides over it like the ground: no contact (a bridge abutment buried in the bank). */
  passable?: boolean;
  /**
   * Exact horizontal footprint of a long or wide body (a dam monolith, a toppled chimney): the
   * iceberg collides with this rectangle instead of the circle, and `radius` only bounds it (for
   * queries). Absent: the body collides as the circle.
   */
  rect?: ProxyRect;
  /** Id of the obstacle a debris piece broke off (absent / own id for original bodies). */
  origin?: number;
}

/** Horizontal centre and radius of the iceberg that ice chunks broke off. */
export interface ChunkSource {
  x: number;
  z: number;
  radius: number;
}

/**
 * A rectangle centred on the proxy's (x, z): half extents hu along the unit axis (ux, uz), hv across
 * (v along (−uz, ux)). With k0 / k1 its two ends are skewed (a skewed bridge deck): the footprint is
 * then the quadrilateral |v| ≤ hv, −hu + k0 · v ≤ u ≤ hu + k1 · v (hu the half length on the centre
 * line), not its bounding rectangle.
 */
export interface ProxyRect {
  ux: number;
  uz: number;
  hu: number;
  hv: number;
  k0?: number;
  k1?: number;
}

/** One iceberg-vs-obstacle contact produced by the collision solver. */
export interface IcebergContact {
  obstacleId: number;
  /** Impulse to apply to the obstacle (tonne·m/s), already direction-correct. */
  impulse: Vec3;
  point: Vec3;
  /** Contact normal pointing from iceberg toward obstacle. */
  normal: Vec3;
  /** Closing speed along the normal before resolution (m/s). */
  relSpeed: number;
  /** Horizontal speed the iceberg lost in this contact (m/s). */
  speedLoss: number;
  /**
   * Impulse magnitude used for the break decision of an anchored obstacle (the iceberg's momentum
   * rule J = (1+e)·vn·M). Absent = use |impulse|.
   */
  testImpulse?: number;
  /**
   * How hard the hit was on the ICE (m/s): the impulse the iceberg had to absorb divided by its own
   * mass. Immovable obstacle: (1+e)·vn. Anchored obstacle that gives way: breakImpulse / M (it can
   * only push back as hard as it is strong). Loose body: J / M, or the speed it actually lost to
   * rubble that yields (ridden over, or pushed: see `push`). Drives chunks breaking off the iceberg.
   */
  shock: number;
  /**
   * True when the iceberg is pushing a body it already hit (bulldozing rubble), not hitting it
   * anew: no new collision, no chipping.
   */
  push?: boolean;
}

export interface ContactOutcome {
  obstacleId: number;
  kind: ObstacleKind;
  /** What happened to the obstacle as a result of this contact. */
  result: 'pushed' | 'shook' | 'uprooted' | 'broken' | 'none';
}

/** Running tallies the physics world keeps for scoring. */
export interface ObstacleStats {
  /** Distinct obstacles that have been moved/knocked from their spawn (any cause). */
  knockedDown: number;
  /** Houses (and later buildings) that broke apart. */
  buildingsDestroyed: number;
  treesFelled: number;
  rocksMoved: number;
  /** Bodies moved primarily by water flow rather than the iceberg. */
  sweptByWater: number;
}

export interface PhysicsWorldApi {
  /** Advance rigid bodies by dt (fixed step). */
  step(dt: number): void;
  /** Bodies near (x, z) within `radius`, for the iceberg collision solver. */
  proxiesNear(x: number, z: number, radius: number): readonly ObstacleProxy[];
  applyContact(contact: IcebergContact): ContactOutcome;
  /** Push loose bodies that sit in the river along the flow. */
  applyWaterForces(river: RiverTrailApi, dt: number): void;
  readonly stats: ObstacleStats;
  /** Drain events since the last call (breaks, splashes into water, etc.). */
  drainEvents(): GameEvent[];
  /**
   * Spawn loose ice chunks broken off the iceberg (total mass in tonnes) at pos with roughly the
   * iceberg's velocity plus scatter. They tumble, can be pushed by the river and melt away after a while.
   * With `around` (the iceberg's centre and radius) they start beside and behind it and fly out
   * sideways, so the iceberg does not run into its own ice.
   */
  spawnIceChunks?(pos: Vec3, vel: Vec3, totalMass: number, around?: ChunkSource): void;
  /**
   * Remove an absorbable body (glacier ice) the iceberg just merged with and report its mass and
   * velocity for momentum conservation; null if it is not absorbable or already gone.
   */
  absorb?(obstacleId: number): { mass: number; vel: Vec3 } | null;
  /**
   * The iceberg's position, radius and velocity this step, so road traffic brakes for it (call
   * before step()).
   */
  setIceberg?(x: number, z: number, radius: number, vx: number, vz: number): void;
  /**
   * The ground under an iceberg at (x, y, z) (its base) of `radius` this step: the terrain, or the
   * terrain with the running surface of a road bridge it is on (src/core/physics/deckGround.ts).
   * Absent: the terrain.
   */
  icebergGround?(x: number, y: number, z: number, radius: number): Terrain;
  /**
   * The corridor between the barriers of the road bridge an iceberg at (x, y, z) (its base) is
   * riding, for the meltwater it lays there (RiverSample.bank), or null off the bridges. Absent:
   * none.
   */
  icebergBank?(x: number, y: number, z: number): RiverBank | null;
  /**
   * Advance only the ambient world (road traffic and its signals) by dt, without stepping the
   * rigid bodies: the intro flyover shows a living valley while the sim proper waits.
   */
  stepAmbient?(dt: number): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------------------------
// River
// ---------------------------------------------------------------------------------------------

export type RiverSampleKind = 'flow' | 'fall' | 'ocean';

/** One cross-section of the river trail, recorded behind the iceberg as it travels. */
export interface RiverSample {
  x: number;
  /** Water surface y on the centreline (ground + small offset). */
  y: number;
  z: number;
  /** Unit horizontal flow direction. */
  dirX: number;
  dirZ: number;
  /** Cumulative trail length at this sample (metres). */
  s: number;
  /** Full width of the water here. */
  width: number;
  /** Flow speed (m/s) used by the shader and for pushing obstacles. */
  flowSpeed: number;
  /** 0..1 turbulence (foam amount): high on falls, sharp bends, collisions. */
  turbulence: number;
  /** Game time when recorded. */
  t: number;
  kind: RiverSampleKind;
  /**
   * True when the iceberg jumped a ravine between the previous sample and this one: no water surface
   * is drawn across the gap (the river pours into the ravine and restarts at the landing).
   */
  gapBefore?: boolean;
  /**
   * How far across the water laid here may spread (on a road bridge's deck: between its barriers,
   * src/core/physics/deckGround.ts); absent or null: as wide as the sample. Drawing only: the
   * river's flow (flowAt) still spans the whole width.
   */
  bank?: RiverBank | null;
}

/**
 * A corridor across the river at a sample: the points whose offset from (x, z) along the unit
 * horizontal (nx, nz) lies within [lo, hi] (m; ±Infinity: unbounded on that side).
 */
export interface RiverBank {
  readonly x: number;
  readonly z: number;
  readonly nx: number;
  readonly nz: number;
  readonly lo: number;
  readonly hi: number;
}

export interface FlowQuery {
  /** Flow velocity at the point (m/s). */
  vx: number;
  vz: number;
  /** Water surface y. */
  surfaceY: number;
  /** 0 at the bank, 1 on the centreline. */
  strength: number;
}

export interface RiverTrailApi {
  readonly samples: readonly RiverSample[];
  /** Incremented whenever samples change (renderers rebuild geometry on change). */
  readonly version: number;
  readonly length: number;
  /**
   * Record the iceberg's current position if it moved far enough since the last sample. `bank`:
   * the corridor the water laid now may spread across (RiverSample.bank), if any.
   */
  record(iceberg: IcebergState, terrain: Terrain, time: number, bank?: RiverBank | null): void;
  /** Flow at a world point, or null if the point is not in the river. */
  flowAt(x: number, z: number): FlowQuery | null;
  /** Mark extra turbulence near a point (collisions, landings). */
  disturb(x: number, z: number, amount: number): void;
  reset(): void;
}

// ---------------------------------------------------------------------------------------------
// Session / events / stats
// ---------------------------------------------------------------------------------------------

export type GamePhase = 'loading' | 'intro' | 'playing' | 'paused' | 'failed' | 'complete';

/** 'fell': the iceberg touched the floor of a fatal ravine (see FELL_DEPTH in session.ts). */
export type FailReason = 'stuck' | 'melted' | 'outOfBounds' | 'fell';

export type GameEvent =
  | { type: 'collision'; obstacleId: number; kind: ObstacleKind; pos: Vec3; relSpeed: number; impulse: number }
  | { type: 'obstacleBroken'; obstacleId: number; kind: ObstacleKind; pos: Vec3 }
  | { type: 'treeFelled'; obstacleId: number; pos: Vec3 }
  | { type: 'splash'; pos: Vec3; intensity: number }
  | { type: 'airborne'; pos: Vec3; speed: number }
  | { type: 'landed'; pos: Vec3; drop: number; speed: number }
  | { type: 'waterfallCrossed'; index: number; pos: Vec3 }
  | { type: 'enteredOcean'; pos: Vec3 }
  /** A hit broke ice off the iceberg: amount = fraction of a full iceberg lost, chunkMass in tonnes. */
  | { type: 'iceChipped'; pos: Vec3; amount: number; chunkMass: number }
  /** Glacier ice merged into the iceberg (mass in tonnes; newMass = the iceberg after merging). */
  | { type: 'absorbed'; obstacleId: number; pos: Vec3; mass: number; newMass: number }
  | { type: 'complete'; stats: RunStats }
  | { type: 'failed'; reason: FailReason; stats: RunStats };

export interface RunStats {
  levelId: string;
  /** Seconds of active play (excludes intro and pause). */
  time: number;
  /** Horizontal distance the iceberg travelled. */
  distance: number;
  topSpeed: number;
  knockedDown: number;
  buildingsDestroyed: number;
  treesFelled: number;
  waterfallsCrossed: number;
  collisions: number;
  /** Ice remaining at the end of the run: 1 = the starting tonnage, above 1 after absorbing ice. */
  iceLeft: number;
  /** Tonnes of glacier ice absorbed, and the heaviest the iceberg got (t). */
  absorbed: number;
  peakMass: number;
  score: number;
}

/** A sample of the iceberg's route, kept for analysis (coarser than the river trail). */
export interface RoutePoint {
  t: number;
  x: number;
  y: number;
  z: number;
  speed: number;
  steer: number;
  /** Terrain slope magnitude under the iceberg (rise/run). */
  slope: number;
}

// ---------------------------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------------------------

export type FxKind = 'splash' | 'spray' | 'mist' | 'debris' | 'foam' | 'sparkle';

export interface FxEmitter {
  emit(kind: FxKind, pos: Vec3, opts?: { dir?: Vec3; intensity?: number; count?: number }): void;
}
