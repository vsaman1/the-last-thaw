import type { ObstacleKind } from '../types';

/**
 * Constants of the inland-water model (streams, reservoirs, dam-break floods, river capture). The
 * model is deliberately cheap: every stream (and every captured river) is a chain of 2 m cells that
 * hold a wetted cross-section area and pass water downstream with a kinematic wave (./reach.ts);
 * a reservoir is one level over a flood-filled footprint (./reservoir.ts). No CFD.
 */

export const HYDRO = {
  /** Cell length (m) of stream and captured-river reaches (also the drawn cross-section spacing). */
  cell: 2,
  /** Bed slope at which a stream flows at its authored `flow` speed. */
  slopeRef: 0.05,
  /** Speed factor sqrt(slope / slopeRef) is clamped to this range: pools and rapids. */
  rapidMin: 0.6,
  rapidMax: 2.2,
  /** Fastest water (m/s) and the slowest as a share of a cell's speed scale. */
  uMax: 16,
  uMinShare: 0.25,
  /** A cell whose bed falls steeper than this (rise/run) is a waterfall. */
  fallSlope: 0.8,
  /** Above its bank tops a flood widens by this much (m per m of rise, each side), at most spreadMax. */
  floodSpread: 6,
  floodSpreadMax: 24,
  /** Turbulent plunge pool below a waterfall (m). */
  plunge: 6,
  /** A pool end's water comes to rest over its last this many metres. */
  poolStill: 30,
  /** Water shallower than this (m) counts as dry (not drawn, no forces). */
  dry: 0.03,
} as const;

/**
 * A cave spring's pool (./pool.ts; its bowl: SPRING_POOL in src/core/terrain/stream.ts): one still
 * level over the grid vertices of the bowl, the stream leaving it over the sill at its outlet.
 */
export const SPRING = {
  /** The stream's current picks up from stillIn m inside the outlet to stillOut m past it. */
  stillIn: 2,
  stillOut: 6,
  /**
   * Still water drifting toward the outlet (m/s): an iceberg in the pool is carried out gently, above
   * INLAND_FLOAT.stuckSpeed (0.6 m/s: drifting on a lake is not stuck; a reservoir drifts at 2 m/s).
   */
  drift: 1,
  /**
   * The lake covers the bowl's vertices below its level within its radius + this (m), up to its
   * sill (the line across the stream at the outlet: past it the stream runs on below the level).
   */
  fillMargin: 2,
} as const;

export const RESERVOIR = {
  /** Dam crest above the lowest ground along its axis (m × placement scale): dam.ts CREST. */
  crest: 9,
  /** Thickness of the dam's base course (m × scale): dam.ts COURSES[0].depth. */
  thickness: 4.6,
  /** The full reservoir stands this far below the crest (m)... */
  freeboard: 0.8,
  /**
   * ...and this far below its abutments: the highest ground within abutmentReach m beyond each end
   * of the dam (the lower end decides; water above it would run round the dam).
   */
  abutmentMargin: 0.2,
  abutmentReach: 4,
  /** A dam that would hold less than this (m) above the stream's own surface holds no reservoir. */
  minHead: 0.3,
  /** Share of the stream's flow an intact dam lets through (the spillway trickle below it). */
  spillShare: 0.12,
  /**
   * Draining after a breach: the head above the breach floor falls as H0 / (1 + t/τ)² (the weir
   * law's shape), so 75 % of it is gone after τ s and 89 % after 2τ.
   */
  drainTau: 5,
  /**
   * The flood carries what the lake loses each step (m³/s), at most what the breach passes as a weir
   * (weir × breach width × head^1.5) and at most floodMax (the rest of the drop soaks away: the level
   * falls on its fixed curve whatever the breach).
   */
  weir: 1.7,
  floodMax: 1500,
  /** Breach width (m × scale) per broken monolith (dam.ts COLUMN). */
  breachWidth: 10,
  /** Still-water drift toward the dam (m/s), and the extra pull toward a breach at peak outflow. */
  lakeDrift: 2,
  drainDrift: 4,
  /** Farthest (m) from the dam the reservoir footprint is searched, and its vertex budget. */
  maxReach: 900,
  maxVertices: 250_000,
} as const;

export const CAPTURE = {
  /**
   * A departure counts once the iceberg is this far (m, plus its radius) from where it left the
   * channel without having come back into it (a brief excursion over a bank carves nothing).
   */
  away: 6,
  /** Seconds after that before its water starts to follow, and to ramp up to `share`. */
  delay: 1,
  ramp: 4,
  /** Water runs downhill: the captured river ends where the path climbs this far (m) above its low. */
  climb: 1.5,
  /** Share of the stream's water (and of any flood) diverted into the iceberg's path. */
  share: 0.9,
  /** The captured river is the wider of the meltwater trail × widthFactor and the stream × streamWidth. */
  widthFactor: 1.6,
  streamWidth: 0.8,
  /** It runs this much faster than the stream would on the same slope... */
  speedFactor: 1.3,
  /** ...is this deep at its authored speed (m), and spreads past this depth (m) like a flood. */
  depth: 0.45,
  bank: 0.7,
  /** Turbulence of the captured river (foam), on top of bends and falls. */
  turbulence: 0.55,
  /** Longest captured river (cells of HYDRO.cell m). */
  maxCells: 4000,
} as const;

/**
 * Flood damage hook for standing vehicles: anchored bodies of these kinds in flood water at least
 * `minWet` m deep flowing at least `minSpeed` m/s (where the water stands `minRise` m above its
 * normal level, or in a captured river) are released through PhysicsWorldApi.applyContact with an
 * unbounded testImpulse (the existing break path), then the water forces carry them. Checked every
 * `stride` steps. (Driving vehicles need no hook here: the physics world releases any the water
 * reaches, and it reads this water through the session's combined flowAt, WaterSystem.flowAdapter.)
 */
export const SWEEP = {
  kinds: ['car', 'truck', 'bus', 'boat', 'railWagon'] as readonly ObstacleKind[],
  minWet: 0.5,
  minSpeed: 2.5,
  minRise: 0.4,
  stride: 6,
} as const;
