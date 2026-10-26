import { ICE } from '../obstacles/catalog';

/** Tuning constants for the obstacle physics world. Exposed so the integrator/agents can tweak them. */
export const PHYSICS_TUNING = {
  gravity: 9.81,
  /** Fixed step used for warm-up (the session passes its own dt to step()). */
  fixedDt: 1 / 60,
  warmUpSteps: 90,
  /** Damping applied only during warm-up so rocks on slopes settle instead of rolling away. */
  warmUpLinearDamping: 4,
  warmUpAngularDamping: 6,

  /** Rapier velocity solver iterations (default 4). */
  solverIterations: 4,
  /** Global switch for continuous collision detection on small fast bodies. */
  ccd: true,

  friction: 0.7,
  restitution: 0.08,
  terrainFriction: 0.75,
  linearDamping: 0.08,
  angularDamping: 0.35,
  /** Wood and house debris: a felled tree should settle rather than roll on and on. */
  woodLinearDamping: 0.15,
  woodAngularDamping: 0.9,

  /**
   * Coulomb-like rolling resistance coefficient for stone bodies touching the ground: rocks roll
   * on slopes steeper than ~this (rise/run) and settle on gentler ones.
   */
  rollingResistance: 0.15,
  /** A body whose bottom is within this of the terrain counts as touching the ground. */
  groundedGap: 0.25,
  /** Bodies below these speeds (m/s, rad/s) for restTime seconds are put to sleep. */
  restLinear: 0.15,
  restAngular: 0.3,
  restTime: 0.6,
  /**
   * Distance LOD: bodies further than this (m) from the focus (the last proxiesNear query, i.e.
   * the iceberg) are put to sleep after farSleepAfter seconds awake. Infinity disables it.
   */
  farSleepDistance: 160,
  farSleepAfter: 3,
  /** ...and only while their AABB bottom is within this of the ground (or they are in water). */
  farSleepGroundGap: 0.6,

  /**
   * Rapier's internal-edge fix smooths rolling over triangle seams but roughly triples trimesh
   * build time and costs ~30% more per contact step; off by default.
   */
  terrainFixInternalEdges: false,
  /** Terrain trimesh keeps cells with |d| < halfWidth + wallRamp + this (plus coast/ocean cells). */
  terrainMargin: 25,
  /** Cells at or below seaLevel + this are always included (coast and seabed). */
  coastBand: 4,

  /** Spatial hash cell size (m) for proxiesNear. */
  hashCell: 8,
  /**
   * Footprint and extent proxies whose horizontal footprint is at least this many times as long as
   * it is wide collide as that rectangle (ObstacleProxy.rect) instead of a circle: a dam monolith,
   * a nave, a wagon, a toppled chimney. A circle around a 10 m monolith reaches into the breach
   * beside it; one around a 40 m chimney lying down is a 22 m disc.
   */
  rectAspect: 1.3,

  /** Displacement from spawn (m) that counts an obstacle as knocked down / a rock as moved. */
  knockDistance: 1.5,
  /** Displacement (m) for the swept-by-water tally. */
  sweptDistance: 3,
  /** Seconds after an iceberg hit during which motion is attributed to the iceberg, not water. */
  hitAttribution: 1.0,
  /** Bodies below seaLevel - this are disabled. */
  killDepth: 30,
  /** Bodies further than this outside the level bounds are disabled. */
  boundsMargin: 10,

  /** Shake animation for anchored bodies hit below their break threshold. */
  shakeDuration: 0.9,
  shakeFrequency: 22,
  /** Peak tilt (rad) for trees and offset (m) for houses at J == breakImpulse. */
  shakeTreeTilt: 0.14,
  shakeHouseOffset: 0.09,

  /** Minimum upward fraction of break/uproot impulses (the solver usually supplies its own lift). */
  breakLift: 0.15,
  /**
   * An uprooted body is lifted (its foundation torn out) so that none of its collider parts starts
   * buried deeper than this fraction of its own height: a 0.6 m turbine pad set into a hill crest
   * starts up to 0.85 m deep, and Rapier resolves a part more than about half buried by pushing it
   * further in, which jams the released tower upright in the ground.
   */
  releaseBuried: 0.25,
  /**
   * While an uprooted body still stands (tilted less than this, rad), the iceberg's pushes land
   * where the uprooting hit did (hitHeight along its axis) and never drive that point faster than
   * the iceberg closes: shoving a tower's foot at the iceberg's contact height kicked it out from
   * under the tower, which then stood back up or fell backwards instead of going over.
   */
  standingTilt: 0.8,
  /**
   * A released body built to topple (its uprooting hit lands above its centre of mass: towers,
   * chimneys, trees, a bridge pier) always comes down: for up to toppleTime s, until it tilts past
   * toppleTilt rad (beyond the balance point of the squattest of them), it keeps tipping over its
   * foot at no less than toppleRate rad/s, the way it leans (or was pushed, while upright). A hit
   * that only just breaks a tower on a wide footing otherwise rocks it back onto its foot, where
   * it stands loose for good.
   */
  toppleRate: 0.12,
  toppleTilt: 0.5,
  toppleTime: 6,
  /** Lean (sine of the tilt) from which the assist follows the body's own lean, not the push. */
  toppleLean: 0.03,
  /**
   * When an anchored body breaks, sleeping bodies resting on it (bottom at least this far above its
   * bottom, footprints overlapping within wakeMargin m) are woken so they fall (bridge decks).
   */
  wakeAbove: 0.3,
  wakeMargin: 0.5,
  /**
   * A road bridge deck within this (m) of where it was built is still on its seats: a push from the
   * iceberg moves it only along its own line (see PhysicsWorld.applyContact).
   */
  deckSeated: 0.5,
  /**
   * Debris from a shattering body never leaves faster than a free body the iceberg hits head-on
   * ((1+e)·closing speed, plus what the body already had) and spins at most this fast (rad/s):
   * light, long pieces (fence rails) would otherwise whirl through the terrain.
   */
  maxDebrisSpin: 10,

  /**
   * Per-material body behaviour. buoyancy scales WATER_TUNING.floatRatio (0 = sinks like stone and
   * gets the ocean rock treatment); friction is the collider's; damping applies on land.
   */
  materials: {
    stone: { linearDamping: 0.08, angularDamping: 0.35, friction: 0.7, buoyancy: 0 },
    wood: { linearDamping: 0.15, angularDamping: 0.9, friction: 0.7, buoyancy: 1 },
    masonry: { linearDamping: 0.15, angularDamping: 0.9, friction: 0.7, buoyancy: 1 },
    /** Vehicles and steel: partly buoyant (air inside), so the river drags them but they sink. */
    metal: { linearDamping: 0.1, angularDamping: 0.6, friction: 0.6, buoyancy: 0.35 },
    ice: { linearDamping: 0.1, angularDamping: 0.5, friction: ICE.friction, buoyancy: 1 },
  },
  /** Ice chunk colliders are re-shaped when the melt has shrunk them by more than this fraction. */
  chunkReshapeStep: 0.12,
} as const;

/** Water drag/buoyancy constants. Drag F = k * frontalArea * (vFlow - vBody) * strength. */
export const WATER_TUNING = {
  /** Drag coefficient k (t / (m^2 s)). */
  drag: 3,
  /** A body counts as in the river when its bottom is below surfaceY + reach. */
  reach: 0.3,
  /** Minimum effective wetted height (m) so a body touching the water always feels it. */
  minWetHeight: 0.2,
  /** Strength floor so bodies near the banks still drift. */
  minStrength: 0.2,
  /** Max fraction of the velocity gap closed per step (keeps the explicit drag stable). */
  maxGapPerStep: 0.9,
  /**
   * ...and at most this many times the gap gained by the point the drag is applied at, which can
   * have far less effective mass than the body (2: past it, each step overshoots further).
   */
  maxPointGain: 2,
  /** Buoyancy of wood/house pieces: B = m g * floatRatio * submergedFraction (floats ~half under). */
  floatRatio: 2,
  /** Vertical damping rate (1/s) while in water. */
  verticalDamping: 1.5,
  /** Angular damping while wet (replaces the dry value). */
  wetAngularDamping: 1.2,
  /** Rocks in the ocean: fraction of gravity cancelled and vertical damping (1/s) — slow sinking. */
  oceanRockLift: 0.6,
  oceanRockDamping: 2,
  /** Sleeping bodies are only woken if the drag at rest exceeds this fraction of their friction. */
  wakeFraction: 0.6,
  /** ...and never by water slower than this (m/s), e.g. the open ocean. */
  wakeFlowSpeed: 0.3,
  /** Sleeping bodies are polled for water every N steps (staggered by id). */
  sleepPollStride: 8,
} as const;
