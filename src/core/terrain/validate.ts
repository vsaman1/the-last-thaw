import type { CliffDef, ObstacleKind, ObstaclePlacement, Terrain, TerrainFeature } from '../types';
import { DEFAULT_ICEBERG_PARAMS, SIM_TUNING } from '../sim/params';
import { ICE } from '../obstacles/catalog';
import { isSpanningKind, structureDef, structureFootprint } from '../obstacles/structures';
import {
  FEATURE_TUNING,
  featureContains,
  featureSRange,
  gapLateral,
  isPolyFeature,
  plateauRampRun,
  polylineDistance,
  polylineOf,
  rampLaunch,
} from './features';
import {
  cliffBandOut,
  cliffDropShare,
  cliffLipS,
  COAST_REACH,
  isCliffBand,
  isGeneratedTerrain,
} from './terrain';
import { locate, parkingAt, parkingLocal, roadLineAt, type RoadLine } from './roads';
import { trafficLines } from '../obstacles/bridges';
import { partsBounds } from '../obstacles/specs';
import { specsForPlacement } from '../obstacles/spawn';
import { nearestLane, trafficNetwork } from '../traffic/network';
import { TRAFFIC_TUNING, TrafficSystem, type VehicleKind } from '../traffic/traffic';
import { analyzeRoutes, headToSpeed, lineHeads, probeFlight, type RouteAnalysis } from './routes';
import { damProblems, streamProblems } from '../water/validate';
import { validateWorldLogic } from './logic';

export { damProblems, streamProblems, validateDams, STREAM_RULES } from '../water/validate';
export { LOGIC_RULES, validateWorldLogic, type LogicIssue, type LogicRule } from './logic';

/**
 * Level-design checks: obstacle placements, terrain features, cliffs and cliff bands, the intended
 * line (including where it flies ravines), and for open-mountain levels the routes (./routes.ts).
 *
 * Footprints (conservative horizontal radii) keep placements clear of walls, cliffs, the start, the
 * sea, ravines, islands and ramp faces. Defined structures use the structure kit's own footprint
 * (src/core/obstacles/structures); everything else uses OBSTACLE_FOOTPRINT. Spanning kinds (fences,
 * guardrails, bridges, dams) are a segment `span` long, laid across the valley at yaw 0, and may
 * bite PLACEMENT_RULES.spanIntoWall metres into the walls they are anchored in. The structure
 * registry uses Vite's import.meta.glob, so this module runs under Vite / vitest (not plain node).
 */

export { isSpanningKind, SPANNING_KINDS } from '../obstacles/structures';

/**
 * Horizontal footprint radius (m) per kind at scale 1 — the fallback for kinds the structure kit
 * has no definition for yet (and for builtins it does not build). For spanning kinds it is the
 * half-depth across the span (along the course at yaw 0); their length comes from placementSpan().
 */
export const OBSTACLE_FOOTPRINT: Record<ObstacleKind, number> = {
  rockSmall: 1,
  rockMedium: 1.8,
  boulder: 2.8,
  rockCluster: 4,
  stoneBarrier: 6,
  pine: 2,
  broadleaf: 2.5,
  house: 6,
  iceBlock: 2.2,
  /** Default spread (7 m) + the biggest block; placementFootprint uses the actual spread. */
  iceField: 9,
  // roads, rail, water
  car: 2.6,
  truck: 5,
  bus: 6.5,
  fence: 0.5,
  guardrail: 0.6,
  footbridge: 1.8,
  roadBridge: 5,
  railWagon: 7.5,
  boat: 4.5,
  dam: 4,
  // town
  church: 11,
  waterTower: 5.5,
  lighthouse: 3.5,
  apartmentBlock: 15.5,
  monument: 3.6,
  // industry and energy
  coolingTower: 14,
  smokestack: 3,
  tank: 6.5,
  factoryHall: 14,
  pylon: 4.5,
  windTurbine: 3,
  // oil and gas extraction
  pumpjack: 6.2,
  oilRig: 10.8,
  pipeline: 1.2,
  // mountains and farms
  chalet: 6.5,
  skiLiftPylon: 1.5,
  barn: 9.5,
  silo: 3.5,
  logPile: 4.5,
  // traffic
  trafficLight: 0.6,
};

/** Every obstacle kind, builtin and structure. */
export const ALL_OBSTACLE_KINDS = Object.keys(OBSTACLE_FOOTPRINT) as ObstacleKind[];


/**
 * Kinds that may stand inside a feature's footprint; every other kind is flagged there. Features not
 * listed take anything (hills, basins, plateaus, roads).
 */
export const FEATURE_ALLOWED: Partial<Record<TerrainFeature['type'], readonly ObstacleKind[]>> = {
  /** Bridges may cross a ravine; anything else would sit at the bottom. */
  gap: ['footbridge', 'roadBridge'],
  ravine: ['footbridge', 'roadBridge'],
  /** Islands are rocky ridges the iceberg cannot climb: only natural things grow there. */
  island: ['pine', 'broadleaf', 'rockSmall', 'rockMedium', 'boulder'],
  ridge: ['pine', 'broadleaf', 'rockSmall', 'rockMedium', 'boulder'],
  /** Anything on a kicker face blocks the jump. */
  ramp: [],
  /** In a stream's channel: what can stand (or lie, or float) in running water. */
  stream: [
    'footbridge',
    'roadBridge',
    'dam',
    'boat',
    'rockSmall',
    'rockMedium',
    'boulder',
    'rockCluster',
    'stoneBarrier',
    'iceBlock',
    'iceField',
    'logPile',
    'pine',
    'broadleaf',
    'fence',
    'guardrail',
    'pipeline',
  ],
};

/** Clearances (m) used by validatePlacements. */
export const PLACEMENT_RULES = {
  /** Keep this far upstream of a cliff lip. */
  cliffUpstream: 12,
  /** Keep this far downstream of the cliff base (base = lip + one grid cell). */
  cliffDownstream: 15,
  /** Nothing within this distance after the spawn point. */
  startClear: 20,
  /** Ground under an obstacle must be at least this far above sea level. */
  minAboveSea: 0.5,
  /** Spanning kinds may reach this far past the floor edge into the walls they anchor in. */
  spanIntoWall: 1.5,
  /** Sample spacing (m) along a span when testing it against features. */
  spanStep: 1,
  /** Beyond this distance (m) past the end of a cliff band, its exclusion zone no longer applies. */
  bandSide: 10,
} as const;

/** Thresholds used by validateFeatures and validateLine. */
export const FEATURE_RULES = {
  /** Features (except roads) start at least this far after the spawn point. */
  startClear: 20,
  /**
   * A glacier-fed stream (which rises under the ice upstream of the spawn) keeps its channel's bank
   * top at least this many iceberg diameters from the spawn point instead.
   */
  spawnStreamDiameters: 1,
  /** Design take-off speed (m/s) for jump estimates: a decent line, not a perfect one. */
  jumpSpeed: 15,
  /** A jump must carry the iceberg this far (m) past a gap's far edge, on top of its radius. */
  landingMargin: 2,
  /** Clear run (m) after a jump (gap far edge, or a lone ramp's lip): no cliff, basin, gap, island. */
  landingClear: 25,
  /** A gap's ramp lip may sit up to this far (m) upstream of its take-off edge. */
  rampLead: 8,
  /** Steepest face (rise/run) of a hill the iceberg can still drive over. */
  maxHillSlope: 0.6,
  /** Steepest basin wall or ramp face, as a fraction of the sim's wall slope. */
  maxFaceOfWall: 0.75,
  /**
   * Trap walls (gap depth, island wall height) must make grid faces this much steeper than the
   * sim's wall slope even across a cell diagonal.
   */
  trapWallMargin: 1.3,
  /** Each island channel, and the way around a partial gap, is at least this many iceberg diameters. */
  channelDiameters: 2.5,
  /** Ramps are at least this many iceberg diameters wide. */
  rampDiameters: 1.5,
  /** Roads are at least this wide (m). */
  minRoadWidth: 4,
  /** Flat top (m) a plateau needs between its end ramps. */
  plateauMinTop: 4,
  /** Basin and gap bottoms stay this far above the sea (m). */
  minAboveSea: 0.5,
  /** Slack (m) for edges that touch (a ramp lip on a cliff lip, a ramp lip at a gap edge). */
  tolerance: 1,
  /**
   * A line may cross a fatal cut without a ramp rule (ravines; gaps flown off a drop) where a jump
   * along it clears at this share of the speed the line carries there (lineHeads).
   */
  lineJumpShare: 0.9,
  /** Polyline features: at least this many grid cells wide. */
  polyMinCells: 2,
  /** Steepest skew (ds per metre across) of a cliff band's lip. */
  maxBandSkew: 1.5,
  /** Relief (open-mountain) levels: the course's bend radius must stay above halfWidth × this. */
  bendRadiusShare: 1.1,
} as const;

const R = FEATURE_RULES;
/** Steepest slope of a (1 − q²)² hill or basin of height 1 and radius 1: 8 / (3√3). */
const BUMP_SLOPE = 8 / (3 * Math.sqrt(3));

export interface PlacementIssue {
  /** Index into level.obstacles. */
  index: number;
  kind: ObstacleKind;
  s: number;
  d: number;
  problem: string;
}

export interface FeatureIssue {
  /** Index into level.features. */
  index: number;
  type: TerrainFeature['type'];
  problem: string;
}

export interface LineIssue {
  /** Index into level.line (segment problems are reported on the segment's first point). */
  index: number;
  s: number;
  d: number;
  problem: string;
}

export interface CliffIssue {
  /** Index into level.cliffs. */
  index: number;
  s: number;
  problem: string;
}

export interface LevelIssue {
  area: 'obstacle' | 'feature' | 'line' | 'cliff' | 'route' | 'logic';
  index: number;
  problem: string;
}

/** The level iceberg's base collision radius (m). */
export const levelIcebergRadius = (terrain: Terrain): number =>
  DEFAULT_ICEBERG_PARAMS.radius * (terrain.level.iceberg?.scale ?? 1);

/** Minimum depth (m) of a trap wall on this terrain's grid. */
export const trapWallDepth = (cellSize: number): number =>
  R.trapWallMargin * SIM_TUNING.wallSlope * Math.SQRT2 * cellSize;

/** Footprint radius (m) of one kind at a scale: the structure kit's when defined, else the table's. */
export function obstacleFootprint(kind: ObstacleKind, scale = 1): number {
  return structureFootprint(kind, scale) ?? OBSTACLE_FOOTPRINT[kind] * scale;
}

export function placementFootprint(p: ObstaclePlacement): number {
  const scale = p.scale ?? 1;
  if (p.kind === 'rockCluster') {
    return Math.max(OBSTACLE_FOOTPRINT.rockCluster * scale, (p.spread ?? 3) + 1.2);
  }
  // Members land anywhere within the spread; the biggest blocks reach ~2 m (× scale) beyond.
  if (p.kind === 'iceField') return (p.spread ?? ICE.fieldSpread) + 2 * scale;
  return obstacleFootprint(p.kind, scale);
}

/** Length (m) of a spanning placement: its span, or the floor width at s; 0 for other kinds. */
export function placementSpan(terrain: Terrain, p: ObstaclePlacement): number {
  if (!isSpanningKind(p.kind)) return 0;
  return p.span ?? 2 * terrain.course.sampleAt(p.s).halfWidth;
}

const halfWidthAt = (terrain: Terrain, s: number): number =>
  terrain.course.sampleAt(Math.min(Math.max(s, 0), terrain.course.length)).halfWidth;

/**
 * Problems with a placement site: start, coast, cliffs, floor edge and the sea. `along` is the
 * half-extent along the course (0 = judge the centre only); `across`, when given, is a spanning
 * placement's lateral half-extent, checked against the floor plus the wall allowance.
 */
function siteProblems(
  terrain: Terrain,
  s: number,
  d: number,
  radius: number,
  along = 0,
  across?: { half: number; span: number },
  /** SEA_KINDS belong on the sea, so the coast and sea rules don't apply (see vehicleProblems). */
  atSea = false,
): string[] {
  const level = terrain.level;
  const out: string[] = [];
  if (s - along < level.startS + PLACEMENT_RULES.startClear) out.push('too close to the start');
  if (s + along > terrain.course.length) out.push('beyond the end of the course');
  else if (!atSea && s + along > level.coastS) out.push('beyond the coast / course');
  for (const c of level.cliffs) {
    // A cliff band's zone only covers its sheer part (and a margin), not the slope round its ends.
    if (cliffBandOut(c, d) > radius + (across?.half ?? 0) + PLACEMENT_RULES.bandSide) continue;
    const lip = cliffLipS(c, d);
    const from = lip - PLACEMENT_RULES.cliffUpstream;
    const to = lip + level.cellSize + PLACEMENT_RULES.cliffDownstream;
    if (s + along > from && s - along < to) out.push(`within the exclusion zone of the cliff at s=${c.s}`);
  }
  const hw = terrain.course.sampleAt(s).halfWidth;
  if (across) {
    const reach = Math.abs(d) + across.half;
    if (reach > hw + PLACEMENT_RULES.spanIntoWall) {
      out.push(
        `span ${across.span.toFixed(1)} m does not fit across the floor ` +
          `(reaches |d| = ${reach.toFixed(1)} > ${hw.toFixed(1)} + ${PLACEMENT_RULES.spanIntoWall})`,
      );
    }
  } else if (Math.abs(d) > hw - radius) {
    out.push(`outside the floor (|d| + r = ${(Math.abs(d) + radius).toFixed(1)} > ${hw.toFixed(1)})`);
  }
  const w = terrain.course.toWorld(s, d);
  const tooLow = w.y < level.seaLevel + PLACEMENT_RULES.minAboveSea;
  if (!atSea && (terrain.isOcean(w.x, w.z) || tooLow)) out.push('in or at the sea');
  return out;
}

const FEATURE_PLACE_PROBLEM: Partial<Record<TerrainFeature['type'], string>> = {
  gap: 'inside the gap',
  ravine: 'inside the ravine',
  island: 'on the island',
  ridge: 'on the ridge',
  ramp: 'on the ramp face (it would block the kicker)',
  stream: 'in the stream channel (it would stand in the water)',
};

/** Feature footprints a placement intrudes on although its kind is not allowed there. */
function featureProblems(terrain: Terrain, p: ObstaclePlacement, radius: number, span: number): string[] {
  const features = terrain.level.features ?? [];
  const out: string[] = [];
  const yaw = p.yaw ?? 0;
  const ss = Math.sin(yaw);
  const cs = Math.cos(yaw);
  const n = span > 0 ? Math.max(1, Math.ceil(span / PLACEMENT_RULES.spanStep)) : 0;
  features.forEach((f, i) => {
    const allowed = FEATURE_ALLOWED[f.type];
    if (!allowed || allowed.includes(p.kind)) return;
    if (f.type === 'ridge' && f.profile === 'mound') return;
    let hit = false;
    for (let k = 0; k <= n && !hit; k++) {
      const t = n === 0 ? 0 : -span / 2 + (span * k) / n;
      const s = p.s + t * ss;
      hit = featureContains(f, s, p.d + t * cs, halfWidthAt(terrain, s), radius);
    }
    if (hit) out.push(`${FEATURE_PLACE_PROBLEM[f.type]} (feature ${i})`);
  });
  return out;
}

/** Vehicle kinds that need a road or parking area under them (they drive in road traffic). */
export const ROAD_VEHICLES: readonly ObstacleKind[] = ['car', 'truck', 'bus'];

/** Placement sanity rules (living world) used by vehicleProblems. */
export const VEHICLE_RULES = {
  /** A vehicle's centre may be this far (m) off a road's paved strip or a parking area's edge. */
  margin: 0.5,
  /**
   * ...and each corner of its footprint (the collider box its structure builds, at the pose it
   * really has: see vehiclePoses) this far (m) past the paved edge: a bumper or a mirror over the
   * kerb line. Further out, part of the vehicle stands on the verge, the bank or the grass.
   */
  overhang: 0.25,
  /**
   * Steepest sideways tilt: the ground's fall from one side of the footprint to the other, over the
   * footprint's width. 12 % (≈ 6.8°) is the steepest banking road design uses (the highest maximum
   * superelevation rate of the AASHTO Green Book): 0.31 m across a 2.55 m bus, 0.30 m across a
   * truck, 0.22 m across a car. A loose vehicle settles onto the ground, so across a steeper slope
   * (or half on a bank) it visibly leans over. Pitch is not limited: mountain roads are steep.
   */
  maxRoll: 0.12,
  /**
   * PhysicsWorld.setupTraffic's TRAFFIC_WORLD.roadMargin and laneReach (src/core/physics/world.ts,
   * not imported: it loads Rapier): a car, truck or bus that is not parked and not on a parking area
   * drives when its placement lies within a road's half-width + driveMargin and a lane is within
   * laneReach of it. Its pose is then the traffic's on that lane, not its spawn pose.
   */
  driveMargin: 1,
  laneReach: 6,
} as const;

/** Where a car, truck or bus really stands when the run starts (see vehiclePoses). */
export interface VehiclePose {
  /** Driving in the road traffic: the pose is the traffic system's on its lane. */
  readonly driving: boolean;
  /** Body origin (world x/z) and unit heading (local +z) in world x/z. */
  readonly x: number;
  readonly z: number;
  readonly hx: number;
  readonly hz: number;
  /** Collider box in the vehicle frame (m): x across (+x = left of travel), z along (+z = front). */
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

const VEHICLE_CORNERS = [
  ['front left', 1, 1],
  ['front right', 1, -1],
  ['rear left', -1, 1],
  ['rear right', -1, -1],
] as const;

/** World x/z of the footprint corners (front left, front right, rear left, rear right). */
export function vehicleCorners(pose: VehiclePose): { name: string; x: number; z: number }[] {
  return VEHICLE_CORNERS.map(([name, along, side]) => {
    const lz = along > 0 ? pose.maxZ : pose.minZ;
    const lx = side > 0 ? pose.maxX : pose.minX;
    // Local +x at heading (hx, hz) is (hz, -hx): the structure kit's yaw convention.
    return { name, x: pose.x + lx * pose.hz + lz * pose.hx, z: pose.z - lx * pose.hx + lz * pose.hz };
  });
}

const unitXZ = (q: { x: number; y: number; z: number; w: number }): { hx: number; hz: number } => {
  // Local +z rotated by q, projected on the ground (tilt and roll do not turn it).
  const hx = 2 * (q.x * q.z + q.w * q.y);
  const hz = 1 - 2 * (q.x * q.x + q.y * q.y);
  const l = Math.hypot(hx, hz) || 1;
  return { hx: hx / l, hz: hz / l };
};

/**
 * The pose a road vehicle placement has when the run starts, or null for other kinds: its spawn
 * pose (the structure kit's, with the yaw it really gets from the level seed when the placement
 * gives none), or, when it drives, the pose the traffic system gives it on its lane. `driving` is
 * the number of vehicles placed before it that drive (only TRAFFIC_TUNING.maxVehicles do).
 */
export function vehiclePose(
  terrain: Terrain,
  p: ObstaclePlacement,
  index: number,
  driving = 0,
): VehiclePose | null {
  if (!ROAD_VEHICLES.includes(p.kind)) return null;
  const level = terrain.level;
  const specs = specsForPlacement(p, index, terrain, level.seed);
  const body = specs.find((b) => b.part === p.kind) ?? specs[0];
  if (!body) return null;
  const box = partsBounds(body.parts);
  const frame = { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
  const { x, z } = body.position;
  const { hx, hz } = unitXZ(body.rotation);
  const standing: VehiclePose = { driving: false, x, z, hx, hz, ...frame };
  // Mirrors PhysicsWorld.setupTraffic (src/core/physics/world.ts).
  if (p.parked || driving >= TRAFFIC_TUNING.maxVehicles) return standing;
  const c = terrain.course.project(x, z);
  if (parkingAt(level, c.s, c.d) >= 0) return standing;
  const net = trafficNetwork(terrain);
  const li = roadLineAt(net.lines, c.s, c.d, VEHICLE_RULES.driveMargin);
  if (li < 0 || net.lines[li].surface === 'rail') return standing;
  const lane = nearestLane(net, x, z, hx, hz, VEHICLE_RULES.laneReach);
  if (!lane) return standing;
  const kind = p.kind as VehicleKind;
  const t = new TrafficSystem(net, [{ body: 0, kind, path: lane.path, arc: lane.arc, seed: 0 }], {
    support: (wx, wz) => terrain.heightAt(wx, wz),
  });
  const h = unitXZ({ x: t.qx[0], y: t.qy[0], z: t.qz[0], w: t.qw[0] });
  return { driving: true, x: t.x[0], z: t.z[0], hx: h.hx, hz: h.hz, ...frame };
}

/** vehiclePose for every placement of the level, in order (null for kinds that are not vehicles). */
export function vehiclePoses(terrain: Terrain): (VehiclePose | null)[] {
  let driving = 0;
  return terrain.level.obstacles.map((p, i) => {
    const pose = vehiclePose(terrain, p, i, driving);
    if (pose?.driving) driving++;
    return pose;
  });
}

/** How far (m) (s, d) lies outside every paved road strip and parking area (≤ 0: on one). */
function pavedOut(level: Terrain['level'], roads: readonly RoadLine[], s: number, d: number): number {
  let out = Infinity;
  const hit = { arc: 0 };
  for (const l of roads) out = Math.min(out, polylineDistance(l.poly, s, d, hit) - l.width / 2);
  for (const f of level.features ?? []) {
    if (f.type !== 'parking') continue;
    const { a, b } = parkingLocal(f, s, d);
    out = Math.min(out, Math.max(Math.abs(a) - f.length / 2, Math.abs(b) - f.width / 2));
  }
  return out;
}

const listed = (names: readonly string[]): string =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/**
 * A road vehicle's footprint and tilt at its pose: every corner on a road, street or parking area
 * (within VEHICLE_RULES.overhang), and the ground falling at most VEHICLE_RULES.maxRoll of its
 * width from one side to the other across either axle (not checked on a bridge deck or dam crest:
 * they carry it flat).
 */
function footprintProblems(terrain: Terrain, lines: readonly RoadLine[], pose: VehiclePose): string[] {
  const roads = lines.filter((l) => l.surface !== 'rail');
  const corners = vehicleCorners(pose);
  const c = terrain.course.project(pose.x, pose.z);
  const where = pose.driving
    ? ` where the traffic puts it (its lane at s ${c.s.toFixed(0)} d ${c.d.toFixed(1)})`
    : '';
  const out: string[] = [];
  const off: string[] = [];
  let worst = 0;
  let onDeck = false;
  for (const k of corners) {
    const q = terrain.course.project(k.x, k.z);
    const o = pavedOut(terrain.level, roads, q.s, q.d);
    if (o > VEHICLE_RULES.overhang) {
      off.push(k.name);
      worst = Math.max(worst, o);
    }
    if (roads.some((l) => !l.carve && roadLineAt([l], q.s, q.d) >= 0)) onDeck = true;
  }
  if (off.length > 0) {
    out.push(
      `${listed(off)} corner${off.length > 1 ? 's' : ''} off the road or parking area${where} ` +
        `(up to ${worst.toFixed(1)} m past its edge; ` +
        'the whole vehicle stands on a road, street or parking area)',
    );
  }
  if (!onDeck) {
    const [fl, fr, rl, rr] = corners.map((k) => terrain.heightAt(k.x, k.z));
    // Each axle on its own: averaging the front and rear let a twisted lay-by through (level across
    // the front, 13 % across the rear), and the truck stood there on three wheels.
    const roll = Math.max(Math.abs(fl - fr), Math.abs(rl - rr));
    const width = pose.maxX - pose.minX;
    if (roll > VEHICLE_RULES.maxRoll * width) {
      out.push(
        `tilts sideways${where}: the ground falls ${roll.toFixed(2)} m ` +
          `across its ${width.toFixed(1)} m width ` +
          `(${((100 * roll) / width).toFixed(1)} % > ${(100 * VEHICLE_RULES.maxRoll).toFixed(0)} %; ` +
          'turn it along the slope or move it to level ground)',
      );
    }
  }
  return out;
}

/**
 * Where a vehicle stands, and whether it may: cars, trucks and buses on a road / street (not a
 * track bed) or a parking area (parking areas double as garage aprons), their whole footprint on it
 * and not tilted sideways (at the pose they really have: `pose`, default vehiclePose), rail wagons
 * on a track bed (a road or street with surface 'rail'), boats and oil rigs on open water. Other
 * kinds: no problem.
 */
export function vehicleProblems(
  terrain: Terrain,
  p: ObstaclePlacement,
  lines?: readonly RoadLine[],
  pose?: VehiclePose | null,
): string[] {
  const level = terrain.level;
  const all = lines ?? trafficLines(terrain);
  const m = VEHICLE_RULES.margin;
  const road = (rail: boolean): boolean =>
    all.some((l) => (l.surface === 'rail') === rail && roadLineAt([l], p.s, p.d, m) >= 0);
  if (ROAD_VEHICLES.includes(p.kind)) {
    if (!road(false) && parkingAt(level, p.s, p.d, m) < 0) {
      return ['not on a road or parking area (vehicles stand on roads, streets or parking areas)'];
    }
    const at = pose ?? vehiclePose(terrain, p, level.obstacles.indexOf(p));
    return at ? footprintProblems(terrain, all, at) : [];
  }
  if (p.kind === 'railWagon') {
    return road(true) ? [] : ["not on a track bed (a road or street with surface: 'rail')"];
  }
  if (p.kind === 'boat') {
    const w = terrain.course.toWorld(p.s, p.d);
    return terrain.isOcean(w.x, w.z) ? [] : ['not on water (boats float on the sea)'];
  }
  if (p.kind === 'oilRig') {
    const w = terrain.course.toWorld(p.s, p.d);
    return terrain.isOcean(w.x, w.z) ? [] : ['not at sea (an offshore rig stands on the sea floor)'];
  }
  return [];
}

/**
 * Kinds that belong IN the sea (boats float, an offshore rig stands on the sea floor): the coast and
 * sea site rules do not apply to them; vehicleProblems requires open water under them instead.
 */
export const SEA_KINDS: readonly ObstacleKind[] = ['boat', 'oilRig'];

/**
 * Only the vehicle placement rules (vehicleProblems) for every placement of the level: call it in a
 * level's tests to list misplaced vehicles. validatePlacements (and validateLevel) include them.
 */
export function validateVehiclePlacements(terrain: Terrain): PlacementIssue[] {
  const lines = trafficLines(terrain);
  const poses = vehiclePoses(terrain);
  const issues: PlacementIssue[] = [];
  terrain.level.obstacles.forEach((p, index) => {
    for (const problem of vehicleProblems(terrain, p, lines, poses[index])) {
      issues.push({ index, kind: p.kind, s: p.s, d: p.d, problem });
    }
  });
  return issues;
}

export function validatePlacements(terrain: Terrain): PlacementIssue[] {
  const level = terrain.level;
  const issues: PlacementIssue[] = [];
  const lines = trafficLines(terrain);
  const poses = vehiclePoses(terrain);
  level.obstacles.forEach((p, index) => {
    const radius = placementFootprint(p);
    const span = placementSpan(terrain, p);
    let problems: string[];
    if (span > 0) {
      const yaw = p.yaw ?? 0;
      const ac = Math.abs(Math.cos(yaw));
      const as = Math.abs(Math.sin(yaw));
      const across = { half: (span / 2) * ac + radius * as, span };
      const along = (span / 2) * as + radius * ac;
      problems = siteProblems(terrain, p.s, p.d, radius, along, across, SEA_KINDS.includes(p.kind));
    } else {
      problems = siteProblems(terrain, p.s, p.d, radius, 0, undefined, SEA_KINDS.includes(p.kind));
    }
    problems.push(...featureProblems(terrain, p, radius, span));
    problems.push(...vehicleProblems(terrain, p, lines, poses[index]));
    // A dam must hold back a stream (src/core/water/validate.ts).
    if (p.kind === 'dam') problems.push(...damProblems(terrain, p));
    // A look the kind does not offer would silently build the intact one (structures/ruin.ts).
    if (p.variant && !structureDef(p.kind)?.variants?.includes(p.variant)) {
      problems.push(`has no '${p.variant}' look (StructureDef.variants)`);
    }
    for (const problem of problems) issues.push({ index, kind: p.kind, s: p.s, d: p.d, problem });
  });
  return issues;
}

type Gap = Extract<TerrainFeature, { type: 'gap' }>;
type Ramp = Extract<TerrainFeature, { type: 'ramp' }>;

/** Lateral range [d0, d1] of a feature's footprint (hw = floor half-width there). */
function lateralRange(f: TerrainFeature, hw: number): [number, number] {
  switch (f.type) {
    case 'hill':
    case 'basin':
      return [f.d - f.radius, f.d + f.radius];
    case 'gap': {
      const lat = gapLateral(f, hw);
      return [lat.d - lat.half, lat.d + lat.half];
    }
    case 'ridge':
    case 'gully':
    case 'ravine':
    case 'stream':
    case 'street': {
      const p = polylineOf(f);
      return [p.d0 - f.width / 2, p.d1 + f.width / 2];
    }
    case 'parking': {
      const r = Math.hypot(f.length, f.width) / 2;
      return [f.d - r, f.d + r];
    }
    default:
      return [f.d - f.width / 2, f.d + f.width / 2];
  }
}

/** Arc-length range of a feature's footprint (ramp: the face; road: the paved strip). */
function footprintS(f: TerrainFeature): [number, number] {
  if (f.type === 'ramp') return [f.s - f.length, f.s];
  if (f.type === 'road') return [f.s0, f.s1];
  if (f.type === 'street') {
    const p = polylineOf(f);
    return [p.s0 - f.width / 2, p.s1 + f.width / 2];
  }
  if (f.type === 'parking') {
    const r = Math.hypot(f.length, f.width) / 2;
    return [f.s - r, f.s + r];
  }
  const r = featureSRange(f);
  return [r.s0, r.s1];
}

/** Length of the intersection of [a0, a1] and [b0, b1] (negative when they are apart). */
const overlap = (a0: number, a1: number, b0: number, b1: number): number =>
  Math.min(a1, b1) - Math.max(a0, b0);

/**
 * Every ramp whose lip launches over a gap: lip at or a little before its take-off edge, and
 * overlapping it laterally. A gap may have several (e.g. one per lane).
 */
export function rampsForGap(
  features: readonly TerrainFeature[],
  gap: Gap,
  hw: number,
): { index: number; ramp: Ramp }[] {
  const [g0, g1] = lateralRange(gap, hw);
  const out: { index: number; ramp: Ramp }[] = [];
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    if (f.type !== 'ramp') continue;
    if (f.s < gap.s - R.rampLead || f.s > gap.s + R.tolerance) continue;
    if (overlap(f.d - f.width / 2, f.d + f.width / 2, g0, g1) <= 0) continue;
    out.push({ index: i, ramp: f });
  }
  return out;
}

/** The first ramp that launches over a gap (see rampsForGap), if any. */
export function rampForGap(
  features: readonly TerrainFeature[],
  gap: Gap,
  hw: number,
): { index: number; ramp: Ramp } | null {
  return rampsForGap(features, gap, hw)[0] ?? null;
}

/**
 * Features that close a way round a gap: island walls, other ravines, and bowls (the slow iceberg
 * that takes the way round is the one a basin traps).
 */
const BYPASS_BLOCKERS: ReadonlySet<TerrainFeature['type']> = new Set([
  'island',
  'gap',
  'basin',
  'ridge',
  'ravine',
]);

/** A wall ridge blocks like an island; a mound ridge can be crested. */
const blocksBypass = (f: TerrainFeature): boolean =>
  BYPASS_BLOCKERS.has(f.type) && !(f.type === 'ridge' && f.profile === 'mound');

/** True if a polyline feature's footprint touches the box [s0, s1] × [d0, d1] (1 m samples). */
function polyInBox(f: TerrainFeature, s0: number, s1: number, d0: number, d1: number, hw: number): boolean {
  if (!isPolyFeature(f)) return false;
  const p = polylineOf(f);
  const r = f.width / 2;
  if (s1 < p.s0 - r || s0 > p.s1 + r || d1 < p.d0 - r || d0 > p.d1 + r) return false;
  for (let s = s0; s <= s1 + 1e-9; s += 1) {
    for (let d = d0; d <= d1 + 1e-9; d += 1) if (featureContains(f, s, d, hw)) return true;
  }
  return false;
}

/**
 * Where a street's paved strip meets a cliff's lip where it is sheer (its centreline sampled every
 * metre, the strip's width across), or null: only the segments that actually cross count.
 */
function streetCrossesCliff(
  f: Extract<TerrainFeature, { type: 'street' }>,
  c: CliffDef,
): { s: number; d: number } | null {
  if (f.points.length < 2) return null;
  const poly = polylineOf(f);
  const half = f.width / 2;
  const n = Math.max(1, Math.ceil(poly.length));
  for (let i = 0; i <= n; i++) {
    const q = locate(poly, (poly.length * i) / n);
    if (bandGap(c, q.d - half, q.d + half) > PLACEMENT_RULES.bandSide) continue;
    if (Math.abs(q.s - cliffLipS(c, q.d)) < half + R.tolerance) return { s: q.s, d: q.d };
  }
  return null;
}

/** How far (m) the lateral range [d0, d1] stays from a cliff band's sheer part (0 when they overlap). */
function bandGap(c: CliffDef, d0: number, d1: number): number {
  if (!isCliffBand(c)) return 0;
  return Math.max(0, cliffBandOut(c, Math.min(Math.max(c.d ?? 0, d0), d1)));
}

/**
 * Narrowest clear way past a partial gap. Every metre along the gap, each side of the cut is
 * scanned across the floor (0.25 m steps) for the widest stretch free of BYPASS_BLOCKERS; a side's
 * width is its narrowest such stretch, and the wider side wins. `blockers` are the features that
 * narrowed either side (empty when only the floor edges limit them).
 */
function bypassWidth(
  terrain: Terrain,
  features: readonly TerrainFeature[],
  self: number,
  gap: Gap,
): { width: number; blockers: number[] } {
  const step = 0.25;
  const sides = [
    { width: Infinity, blocker: -1 },
    { width: Infinity, blocker: -1 },
  ];
  for (let s = gap.s; s <= gap.s + gap.length + 1e-9; s += 1) {
    const hw = halfWidthAt(terrain, s);
    const lat = gapLateral(gap, hw);
    const spans: [number, number][] = [
      [-hw, lat.d - lat.half],
      [lat.d + lat.half, hw],
    ];
    spans.forEach(([a, b], k) => {
      let best = 0;
      let start = a;
      let blocker = -1;
      for (let c = a + step / 2; c < b; c += step) {
        const hit = features.findIndex(
          (f, i) => i !== self && blocksBypass(f) && featureContains(f, s, c, hw),
        );
        if (hit < 0) continue;
        best = Math.max(best, c - step / 2 - start);
        start = c + step / 2;
        blocker = hit;
      }
      best = Math.max(best, b - start);
      if (best < sides[k].width) sides[k] = { width: best, blocker };
    });
  }
  const blockers = [...new Set(sides.map((side) => side.blocker).filter((b) => b >= 0))];
  return { width: Math.max(sides[0].width, sides[1].width), blockers };
}

/** Ramp flight distance (m) at the design speed, and the distance a gap needs from that ramp's lip. */
function jumpFor(terrain: Terrain, ramp: Ramp, gap: Gap): { flies: number; needs: number } {
  const c = terrain.course;
  const slope = (c.sampleAt(ramp.s - 10).floor - c.sampleAt(ramp.s + 10).floor) / 20;
  const flies = rampLaunch(ramp, R.jumpSpeed, slope).distance;
  const needs = gap.s + gap.length - ramp.s + levelIcebergRadius(terrain) + R.landingMargin;
  return { flies, needs };
}

/** Problems with the landing run [s0, s0 + landingClear] in the lateral corridor [d0, d1]. */
function landingProblems(
  terrain: Terrain,
  features: readonly TerrainFeature[],
  self: number,
  s0: number,
  d0: number,
  d1: number,
  checkCliffs: boolean,
  /** A second feature index to ignore (the ravine a ramp launches over). */
  over = -1,
): string[] {
  const s1 = s0 + R.landingClear;
  const out: string[] = [];
  if (checkCliffs) {
    for (const c of terrain.level.cliffs) {
      if (bandGap(c, d0, d1) > 0) continue;
      if (c.s >= s0 && c.s <= s1) out.push(`no clear landing: the cliff at s=${c.s} is in the landing run`);
    }
  }
  features.forEach((f, i) => {
    if (i === self || i === over) return;
    if (f.type === 'ravine' || (f.type === 'ridge' && f.profile !== 'mound')) {
      const hw = halfWidthAt(terrain, (s0 + s1) / 2);
      if (polyInBox(f, s0 + R.tolerance, s1, d0, d1, hw)) {
        out.push(`no clear landing: the ${f.type} (feature ${i}) is in the landing run`);
      }
      return;
    }
    if (f.type !== 'basin' && f.type !== 'gap' && f.type !== 'island') return;
    const [a, b] = footprintS(f);
    if (overlap(a, b, s0 + R.tolerance, s1) <= 0) return;
    const [l0, l1] = lateralRange(f, halfWidthAt(terrain, (a + b) / 2));
    if (overlap(l0, l1, d0, d1) <= 0) return;
    out.push(`no clear landing: the ${f.type} (feature ${i}) is in the landing run`);
  });
  return out;
}

export function validateFeatures(terrain: Terrain): FeatureIssue[] {
  const level = terrain.level;
  const features = level.features ?? [];
  const issues: FeatureIssue[] = [];
  const L = terrain.course.length;
  const sea = level.seaLevel;
  const radius = levelIcebergRadius(terrain);
  const channelMin = R.channelDiameters * 2 * radius;
  const trapDepth = trapWallDepth(level.cellSize);
  const wallFace = R.maxFaceOfWall * SIM_TUNING.wallSlope;
  const gapsWithRamp = new Set<number>();

  features.forEach((f, index) => {
    const push = (problem: string): void => {
      issues.push({ index, type: f.type, problem });
    };
    const r = featureSRange(f);
    const mid = (r.s0 + r.s1) / 2;
    const hw = halfWidthAt(terrain, mid);
    const fix = (v: number): string => v.toFixed(1);

    // A glacier-fed stream rises under the level-start glacier, upstream of the spawn (and of s 0
    // where the glacier reaches back onto the headwall): the world logic rule 'stream-source' checks
    // that its start really is under the ice.
    const underIce = f.type === 'stream' && f.source === 'glacier';
    if ((r.s0 < 0 && !underIce) || r.s1 > L) {
      push(`outside the course (s ${fix(r.s0)}..${fix(r.s1)} of 0..${fix(L)})`);
    } else if (r.s1 > level.coastS && f.type !== 'stream') {
      // (Streams run out into the sea.)
      push(`beyond the coast (ends at s=${fix(r.s1)}, coast at ${level.coastS})`);
    }
    // (A stream starts where its channel does, not where its outer cut could reach.)
    const begins = f.type === 'stream' ? polylineOf(f).s0 - f.width / 2 : r.s0;
    const paved = f.type === 'road' || f.type === 'street' || f.type === 'parking';
    if (!paved && !underIce && begins < level.startS + R.startClear) {
      push(`too close to the start (begins at s=${fix(begins)}, start at ${level.startS})`);
    }
    if (underIce) {
      // It runs out of the snout beside the spawn: the iceberg slides out onto dry ground, at least
      // a diameter (R.spawnStreamDiameters) from the channel's bank top.
      const clear = polylineDistance(polylineOf(f), level.startS, 0) - f.width / 2;
      const need = R.spawnStreamDiameters * 2 * radius;
      if (clear < need) {
        push(
          `its channel passes ${fix(clear)} m from the spawn (keep ≥ ${fix(need)} m: the iceberg ` +
            'slides out of the glacier onto dry ground — move the stream sideways under the ice)',
        );
      }
    }

    // Lateral placement.
    if (f.type === 'road') {
      if (Math.abs(f.d) - f.width / 2 > hw + level.wallRamp) push('outside the floor and its walls');
    } else if (f.type === 'street') {
      f.points.forEach((p, k) => {
        const reach = halfWidthAt(terrain, p.s) + level.wallRamp;
        if (Math.abs(p.d) - f.width / 2 > reach) push(`point ${k} outside the floor and its walls`);
      });
      if (f.points.length < 2) push('needs at least two points');
    } else if (f.type === 'parking') {
      if (Math.abs(f.d) > hw + level.wallRamp) push('outside the floor and its walls');
    } else if (isPolyFeature(f)) {
      // Polyline features may run into the walls (to seal a branch) but must cross the floor.
      let onFloor = false;
      f.points.forEach((p, k) => {
        const hwp = halfWidthAt(terrain, p.s);
        if (Math.abs(p.d) > hwp + level.wallRamp) {
          push(`point ${k} beyond the walls (|d| = ${fix(Math.abs(p.d))} > ${fix(hwp + level.wallRamp)})`);
        }
        const q = f.points[k + 1] ?? p;
        const n = Math.max(1, Math.ceil(Math.hypot(q.s - p.s, q.d - p.d) / 2));
        for (let i = 0; i <= n && !onFloor; i++) {
          const s = p.s + ((q.s - p.s) * i) / n;
          if (Math.abs(p.d + ((q.d - p.d) * i) / n) <= halfWidthAt(terrain, s)) onFloor = true;
        }
      });
      if (!onFloor) push('does not cross the floor');
      if (f.points.length === 0) push('needs at least one point');
    } else {
      const d = f.type === 'gap' ? gapLateral(f, hw).d : f.d;
      if (Math.abs(d) > hw) push(`centre outside the floor (|d| = ${fix(Math.abs(d))} > ${fix(hw)})`);
      else if (f.type === 'ramp' && Math.abs(f.d) + f.width / 2 > hw) {
        push('ramp reaches past the floor edge');
      }
    }

    // Cliffs: islands and polyline features may straddle one, a ramp lip may sit on one; nothing
    // else may overlap them (a cliff band only where it is sheer).
    for (const c of level.cliffs) {
      if (f.type === 'island' || isPolyFeature(f)) continue;
      if (f.type === 'street') {
        // Per segment: only where the street itself crosses the sheer part of the cliff.
        const crossing = streetCrossesCliff(f, c);
        if (crossing) {
          push(`crosses the cliff at s=${c.s} near (s ${fix(crossing.s)}, d ${fix(crossing.d)})`);
        }
        continue;
      }
      const [l0, l1] = lateralRange(f, hw);
      if (bandGap(c, l0, l1) > PLACEMENT_RULES.bandSide) continue;
      if (f.type === 'ramp') {
        if (c.s > f.s - f.length + R.tolerance && c.s < f.s - R.tolerance) {
          push(`ramp face crosses the cliff at s=${c.s}`);
        }
      } else if (c.s > r.s0 - R.tolerance && c.s < r.s1 + R.tolerance) {
        push(`overlaps the cliff at s=${c.s}`);
      }
    }

    switch (f.type) {
      case 'hill': {
        const slope = (BUMP_SLOPE * f.height) / f.radius;
        if (slope > R.maxHillSlope) {
          push(`too steep to drive (max slope ${slope.toFixed(2)} > ${R.maxHillSlope})`);
        }
        break;
      }
      case 'basin': {
        const slope = (BUMP_SLOPE * f.depth) / f.radius;
        if (slope > wallFace) push(`too steep (max slope ${slope.toFixed(2)}): its rim would be a wall`);
        if (terrain.course.toWorld(f.s, f.d).y < sea + R.minAboveSea) push('bottom below sea level');
        break;
      }
      case 'ramp': {
        const lip = (2 * f.height) / f.length;
        if (lip > wallFace) push(`ramp too steep (lip slope ${lip.toFixed(2)} > ${wallFace.toFixed(2)})`);
        if (f.width < R.rampDiameters * 2 * radius) {
          push(`ramp too narrow (${f.width} m < ${R.rampDiameters} iceberg diameters)`);
        }
        break;
      }
      case 'gap': {
        const lat = gapLateral(f, halfWidthAt(terrain, f.s));
        if (f.depth < trapDepth) {
          push(
            `too shallow to trap (depth ${f.depth} m < ${trapDepth.toFixed(1)} m at cellSize ` +
              `${level.cellSize})`,
          );
        }
        if (terrain.course.toWorld(f.s + f.length / 2, lat.d).y < sea + R.minAboveSea) {
          push('bottom below sea level');
        }
        // Every ramp launching over the gap is judged by it (jump length, landing run).
        const ramps = rampsForGap(features, f, halfWidthAt(terrain, f.s));
        const landing = new Set<string>();
        for (const { index: ri, ramp: rp } of ramps) {
          gapsWithRamp.add(ri);
          const j = jumpFor(terrain, rp, f);
          if (j.flies < j.needs) {
            const which = ramps.length > 1 ? ` from ramp ${ri}` : '';
            push(
              `too long to jump${which} (needs ${fix(j.needs)} m from the lip; the ramp flies ` +
                `${fix(j.flies)} m at ${R.jumpSpeed} m/s)`,
            );
          }
          const d0 = rp.d - rp.width / 2;
          const d1 = rp.d + rp.width / 2;
          for (const p of landingProblems(terrain, features, index, f.s + f.length, d0, d1, true)) {
            landing.add(p);
          }
        }
        for (const p of landing) push(p);
        if (ramps.length === 0 && f.width === undefined) {
          push('cannot be cleared: a full-width gap needs a ramp lip at its take-off edge');
        }
        if (f.width !== undefined) {
          const way = bypassWidth(terrain, features, index, f);
          if (way.width < channelMin) {
            const n = way.blockers.length;
            const why = n > 0 ? `; feature${n > 1 ? 's' : ''} ${way.blockers.join(', ')} in the way` : '';
            push(`no channel around it (widest ${fix(way.width)} m < ${fix(channelMin)} m${why})`);
          }
        }
        break;
      }
      case 'island': {
        const wall = f.height * FEATURE_TUNING.islandWallShare * (1 - FEATURE_TUNING.islandRough / 2);
        if (wall < trapDepth) {
          push(`too low to block the iceberg (walls ${fix(wall)} m < ${fix(trapDepth)} m)`);
        }
        let hwMin = Infinity;
        for (let s = f.s0; s <= f.s1; s += 2) hwMin = Math.min(hwMin, halfWidthAt(terrain, s));
        const left = hwMin + (f.d - f.width / 2);
        const right = hwMin - (f.d + f.width / 2);
        for (const [side, w] of [
          ['left', left],
          ['right', right],
        ] as const) {
          if (w < channelMin) push(`${side} channel only ${fix(w)} m wide (needs ${fix(channelMin)} m)`);
        }
        break;
      }
      case 'plateau': {
        const need = 2 * plateauRampRun(f.height) + R.plateauMinTop;
        if (f.s1 - f.s0 < need) push(`too short for its end ramps (${fix(f.s1 - f.s0)} m < ${fix(need)} m)`);
        break;
      }
      case 'road':
      case 'street':
        if (f.width < R.minRoadWidth) push(`too narrow (${f.width} m < ${R.minRoadWidth} m)`);
        break;
      case 'parking':
        if (Math.min(f.width, f.length) < R.minRoadWidth) {
          push(`too small (${f.length} × ${f.width} m; each side ≥ ${R.minRoadWidth} m)`);
        }
        break;
      case 'ridge': {
        const minW = R.polyMinCells * level.cellSize;
        if (f.width < minW) push(`too thin for the grid (${f.width} m < ${fix(minW)} m)`);
        if (f.profile === 'mound') {
          const slope = (BUMP_SLOPE * f.height) / (f.width / 2);
          if (slope > R.maxHillSlope) {
            push(`too steep to crest (max slope ${slope.toFixed(2)} > ${R.maxHillSlope}): make it a wall`);
          }
        } else {
          const wall = f.height * FEATURE_TUNING.islandWallShare * (1 - FEATURE_TUNING.islandRough / 2);
          if (wall < trapDepth) {
            push(`too low to block the iceberg (walls ${fix(wall)} m < ${fix(trapDepth)} m): use a mound`);
          }
        }
        break;
      }
      case 'gully': {
        if (f.width < channelMin) push(`too narrow for the iceberg (${f.width} m < ${fix(channelMin)} m)`);
        if (!(f.depth > 0)) push('needs a positive depth');
        for (const p of f.points) {
          const w = terrain.course.toWorld(p.s, p.d);
          if (w.y - f.depth < sea + R.minAboveSea) {
            push('bottom below sea level');
            break;
          }
        }
        break;
      }
      case 'stream':
        for (const p of streamProblems(terrain, f, index)) push(p);
        break;
      case 'ravine': {
        const minW = R.polyMinCells * level.cellSize;
        if (f.width < minW) push(`too narrow for the grid (${f.width} m < ${fix(minW)} m)`);
        if (f.depth < trapDepth) {
          push(
            `too shallow to trap (depth ${f.depth} m < ${trapDepth.toFixed(1)} m at cellSize ` +
              `${level.cellSize})`,
          );
        }
        for (const p of f.points) {
          if (terrain.course.toWorld(p.s, p.d).y < sea + R.minAboveSea) {
            push('bottom below sea level');
            break;
          }
        }
        break;
      }
    }
  });

  // Lone ramps need a clear landing too (a ramp that launches over a gap is judged by its gap; one
  // that launches over a ravine by the line's jump check, so that ravine is not in its way).
  features.forEach((f, index) => {
    if (f.type !== 'ramp' || gapsWithRamp.has(index)) return;
    const d0 = f.d - f.width / 2;
    const d1 = f.d + f.width / 2;
    const hw0 = halfWidthAt(terrain, f.s);
    const over = features.findIndex(
      (g) => g.type === 'ravine' && featureContains(g, f.s, f.d, hw0, R.rampLead),
    );
    for (const p of landingProblems(terrain, features, index, f.s, d0, d1, false, over)) {
      issues.push({ index, type: f.type, problem: p });
    }
  });

  // Gaps and islands must not overlap other features (a ramp lip touching a gap edge is fine).
  // Polyline features may meet anything: mazes are built from junctions.
  for (let j = 0; j < features.length; j++) {
    for (let i = 0; i < j; i++) {
      const a = features[i];
      const b = features[j];
      if (a.type !== 'gap' && a.type !== 'island' && b.type !== 'gap' && b.type !== 'island') continue;
      if (isPolyFeature(a) || isPolyFeature(b) || a.type === 'street' || b.type === 'street') continue;
      const [as0, as1] = footprintS(a);
      const [bs0, bs1] = footprintS(b);
      const so = overlap(as0, as1, bs0, bs1);
      if (so <= R.tolerance) continue;
      const hw = halfWidthAt(terrain, (Math.max(as0, bs0) + Math.min(as1, bs1)) / 2);
      const [a0, a1] = lateralRange(a, hw);
      const [b0, b1] = lateralRange(b, hw);
      if (overlap(a0, a1, b0, b1) <= R.tolerance) continue;
      issues.push({ index: j, type: b.type, problem: `overlaps feature ${i} (${a.type})` });
    }
  }
  return issues;
}

export function validateLine(terrain: Terrain): LineIssue[] {
  const level = terrain.level;
  const line = level.line ?? [];
  const features = level.features ?? [];
  const L = terrain.course.length;
  const issues: LineIssue[] = [];

  /** The line's lateral offset at s (piecewise linear between its points). */
  const lineD = (s: number): number => {
    if (line.length === 0) return 0;
    if (s <= line[0].s) return line[0].d;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      if (s <= b.s && b.s > a.s) return a.d + ((b.d - a.d) * (s - a.s)) / (b.s - a.s);
    }
    return line[line.length - 1].d;
  };
  /** Gaps the line may cross: those with a clearable ramp whose face the line actually uses. */
  const jumpable = features.map((f) => {
    if (f.type !== 'gap') return false;
    return rampsForGap(features, f, halfWidthAt(terrain, f.s)).some(({ ramp }) => {
      const j = jumpFor(terrain, ramp, f);
      return j.flies >= j.needs && Math.abs(lineD(ramp.s) - ramp.d) <= ramp.width / 2;
    });
  });
  const isCut = (f: TerrainFeature): boolean => f.type === 'gap' || f.type === 'ravine';

  const pointProblems = (s: number, d: number): string[] => {
    if (s < 0 || s > L) return ['outside the course'];
    const out: string[] = [];
    const hw = halfWidthAt(terrain, s);
    if (Math.abs(d) > hw) out.push(`outside the floor (|d| = ${Math.abs(d).toFixed(1)} > ${hw.toFixed(1)})`);
    features.forEach((f, i) => {
      if (f.type === 'island' && featureContains(f, s, d, hw)) out.push(`on the island (feature ${i})`);
      if (f.type === 'ridge' && f.profile !== 'mound' && featureContains(f, s, d, hw)) {
        out.push(`on the ridge (feature ${i})`);
      }
    });
    return out;
  };

  // The line's samples: every point and every whole metre of s between points.
  const samples: { s: number; d: number; index: number }[] = [];
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    samples.push({ s: p.s, d: p.d, index: i });
    const q = line[i + 1];
    if (!q || q.s <= p.s) continue;
    for (let s = Math.floor(p.s) + 1; s < q.s; s++) {
      samples.push({ s, d: p.d + ((q.d - p.d) * (s - p.s)) / (q.s - p.s), index: i });
    }
  }

  // Crossings of gaps and ravines: runs of samples inside one. A run is fine over a ramp that
  // clears the gap, or where a jump along the line clears it at lineJumpShare of the line's speed.
  let heads: Float64Array | null = null;
  const crossingProblem = (i: number, sIn: number): string | null => {
    const f = features[i];
    if (f.type === 'gap' && jumpable[i]) return null;
    heads ??= lineHeads(terrain, line);
    const back = Math.max(line[0].s, sIn - 12);
    const hi = clampIndex(heads, (back - level.startS) / 2);
    const carry = headToSpeed(heads[hi]);
    const v = R.lineJumpShare * carry;
    const a = terrain.course.toWorld(back, lineD(back));
    const b = terrain.course.toWorld(sIn + 6, lineD(sIn + 6));
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const fl = probeFlight(terrain, a.x, a.z, (b.x - a.x) / l, (b.z - a.z) / l, v, sIn - back + 8);
    if (fl.outcome === 'landed' && fl.over) return null;
    const why =
      `a jump along the line at ${v.toFixed(1)} m/s (${Math.round(R.lineJumpShare * 100)} % of ` +
      `the ~${carry.toFixed(1)} m/s it carries) ${fl.outcome === 'wall' ? 'hits the far wall' : 'falls in'}`;
    return f.type === 'gap'
      ? `into the gap (feature ${i}) with no ramp to jump it; ${why}`
      : `into the ravine (feature ${i}): ${why}`;
  };
  const verdict = new Map<number, { s0: number; s1: number; problem: string | null }[]>();
  features.forEach((f, i) => {
    if (!isCut(f)) return;
    const runs: { s0: number; s1: number; problem: string | null }[] = [];
    let open: number | null = null;
    let last = 0;
    for (const p of samples) {
      if (p.s < 0 || p.s > L) continue;
      const inside = featureContains(f, p.s, p.d, halfWidthAt(terrain, p.s));
      if (inside && open === null) open = p.s;
      if (!inside && open !== null) {
        runs.push({ s0: open, s1: last, problem: crossingProblem(i, open) });
        open = null;
      }
      last = p.s;
    }
    if (open !== null) runs.push({ s0: open, s1: last, problem: crossingProblem(i, open) });
    verdict.set(i, runs);
  });

  const seen = new Set<string>();
  const add = (index: number, problem: string): void => {
    const key = `${index}:${problem}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ index, s: line[index].s, d: line[index].d, problem });
  };
  for (let i = 1; i < line.length; i++) {
    if (line[i].s <= line[i - 1].s) add(i, `out of order (s=${line[i].s} after s=${line[i - 1].s})`);
  }
  for (const p of samples) {
    for (const problem of pointProblems(p.s, p.d)) add(p.index, problem);
    for (const [, runs] of verdict) {
      for (const r of runs) if (r.problem && p.s >= r.s0 && p.s <= r.s1) add(p.index, r.problem);
    }
  }
  return issues;
}

const clampIndex = (a: ArrayLike<number>, f: number): number =>
  Math.min(a.length - 1, Math.max(0, Math.round(f)));

/** Share of a cliff's authored drop the terrain must keep (coast shaping can only take a little). */
export const CLIFF_MIN_DROP_SHARE = 0.9;

/**
 * Cliff checks: a cliff must drop onto land (before coastS), and the terrain must keep its drop.
 * The coast blend (COAST_REACH m before coastS) starts at the foot of the last cliff inside it, so
 * such a cliff keeps its drop; this catches anything that still shaves it.
 */
export function validateCliffs(terrain: Terrain): CliffIssue[] {
  const level = terrain.level;
  const out: CliffIssue[] = [];
  const gen = isGeneratedTerrain(terrain) ? terrain : null;
  level.cliffs.forEach((c, index) => {
    const push = (problem: string): void => {
      out.push({ index, s: c.s, problem });
    };
    if (c.s >= level.coastS) push(`at or beyond the coast (coastS ${level.coastS}): it must drop onto land`);
    const dc = isCliffBand(c) ? (c.d ?? 0) : 0;
    if (isCliffBand(c)) {
      const hw = halfWidthAt(terrain, c.s);
      if (!((c.width ?? 0) > 0)) push('a cliff band needs a positive width');
      if (Math.abs(dc) > hw) {
        push(`band centre outside the floor (|d| = ${Math.abs(dc).toFixed(1)} > ${hw.toFixed(1)})`);
      }
      if (Math.abs(c.skew ?? 0) > R.maxBandSkew) push(`band skew ${c.skew} steeper than ±${R.maxBandSkew}`);
      if (c.spreadSlope !== undefined && !(c.spreadSlope > 0)) push('spreadSlope must be positive');
      if (c.s > level.coastS - COAST_REACH) {
        push(`a cliff band must stay ≥ ${COAST_REACH} m before coastS (the coast blend would shave it)`);
      }
    }
    // The designed floor at the cliff's centre (a band's d), without relief or features.
    const floor = (s: number): number =>
      gen ? gen.course.floorAtD(s, dc) : terrain.course.sampleAt(s).floor;
    const kept = floor(c.s - 0.5) - floor(c.s + 0.5);
    if (kept < CLIFF_MIN_DROP_SHARE * c.drop) {
      push(
        `the terrain keeps only ${kept.toFixed(1)} m of its ${c.drop} m drop ` +
          `(the coast blend reaches ${COAST_REACH} m before coastS)`,
      );
    }
  });
  return out;
}

export interface RouteIssue {
  /** Arc length the problem is reported at. */
  s: number;
  problem: string;
}

/**
 * Route checks for open-mountain levels (LevelDef.relief set): there must be a way from the spawn
 * to the sea (analyzeRoutes), and the course must not bend tighter than the floor is wide (course
 * coordinates fold on the inside of such a bend). Dead ends are not issues: read them from
 * analyzeRoutes(terrain).deadEnds. Pass a precomputed analysis to avoid running it twice.
 */
export function validateRoutes(terrain: Terrain, routes?: RouteAnalysis): RouteIssue[] {
  const level = terrain.level;
  const out: RouteIssue[] = [];
  const course = terrain.course;
  const reach = 20;
  for (let s = level.startS + reach; s <= level.coastS - reach; s += 10) {
    const a = course.sampleAt(s - reach);
    const b = course.sampleAt(s + reach);
    const turn = Math.abs(Math.atan2(a.dirX * b.dirZ - a.dirZ * b.dirX, a.dirX * b.dirX + a.dirZ * b.dirZ));
    if (turn < 1e-6) continue;
    const radius = (2 * reach) / turn;
    const hw = course.sampleAt(s).halfWidth;
    if (radius < R.bendRadiusShare * hw) {
      out.push({
        s,
        problem:
          `the course bends with radius ${radius.toFixed(0)} m < ${R.bendRadiusShare} × halfWidth ` +
          `${hw.toFixed(0)} m: course coordinates fold on the inside of the bend`,
      });
      s += 40;
    }
  }
  const r = routes ?? analyzeRoutes(terrain);
  if (!r.solvable) {
    out.push({
      s: r.reachedS,
      problem:
        `no way from the spawn to the sea: the route search got as far as s=${r.reachedS.toFixed(0)} ` +
        `(see analyzeRoutes for the dead ends)`,
    });
  }
  return out;
}

/**
 * Every design check for a level: obstacle placements, features, cliffs and the intended line; for
 * open-mountain levels (LevelDef.relief) also the routes (a way to the sea must exist); and the
 * world logic errors (./logic.ts: bridges that reach the ground, roads that end somewhere, ...;
 * its warnings only from validateWorldLogic).
 */
export function validateLevel(terrain: Terrain): LevelIssue[] {
  const routes = terrain.level.relief
    ? validateRoutes(terrain).map((i) => ({ area: 'route' as const, index: 0, problem: i.problem }))
    : [];
  return [
    ...routes,
    ...validatePlacements(terrain).map((i) => ({
      area: 'obstacle' as const,
      index: i.index,
      problem: `${i.kind} at s=${i.s}, d=${i.d}: ${i.problem}`,
    })),
    ...validateFeatures(terrain).map((i) => ({
      area: 'feature' as const,
      index: i.index,
      problem: `${i.type}: ${i.problem}`,
    })),
    ...validateCliffs(terrain).map((i) => ({
      area: 'cliff' as const,
      index: i.index,
      problem: `cliff at s=${i.s}: ${i.problem}`,
    })),
    ...validateLine(terrain).map((i) => ({ area: 'line' as const, index: i.index, problem: i.problem })),
    ...validateWorldLogic(terrain)
      .filter((i) => i.severity === 'error')
      .map((i) => ({
        area: 'logic' as const,
        index: i.index,
        problem: `[${i.rule}] ${i.area} ${i.index} (${i.what}): ${i.problem}`,
      })),
  ];
}

/** Steepening of the floor (rise per metre) by a cliff band's spread that levelWarnings reports. */
export const SPREAD_WARN_SLOPE = 0.03;

/**
 * Design smells that are not failures (validateLevel stays []): print them in a level's test while
 * designing.
 * - A ramp in a cliff band's spread zone: the floor under its face is steeper by up to the band's
 *   1.5 · drop / spread, so it takes off that much flatter than on the plain slope (fly it with
 *   rampLaunch(ramp, v, localSlope)).
 * - A ramp whose face reaches into a gap or ravine: the face is kept up to the lip and the cut's
 *   edge follows the lip line there.
 * - A ramp without an exact take-off over part of its width (something else shapes its last
 *   metres: a ridge, an island, a fold of the course on a bend); the iceberg rides the grid there.
 */
export function levelWarnings(terrain: Terrain): LevelIssue[] {
  const level = terrain.level;
  const features = level.features ?? [];
  const out: LevelIssue[] = [];
  const gen = isGeneratedTerrain(terrain) ? terrain : null;
  features.forEach((f, index) => {
    if (f.type !== 'ramp') return;
    const push = (problem: string): void => {
      out.push({ area: 'feature', index, problem: `ramp: ${problem}` });
    };
    const ds = [f.d - f.width / 2, f.d, f.d + f.width / 2];
    level.cliffs.forEach((c, ci) => {
      if (!isCliffBand(c)) return;
      let worst = 0;
      for (let s = f.s - f.length; s <= f.s; s += 1) {
        for (const d of ds) {
          // (Where the band is sheer its drop is a step: a lip on its lip is fine.)
          if (cliffBandOut(c, d) <= 0) continue;
          worst = Math.max(worst, c.drop * (cliffDropShare(c, s + 0.5, d) - cliffDropShare(c, s - 0.5, d)));
        }
      }
      if (worst > SPREAD_WARN_SLOPE) {
        push(
          `on cliff band ${ci}'s spread slope (s ${c.s}): the floor under its face is up to ` +
            `${worst.toFixed(2)} steeper, so it takes off that much flatter than on the plain slope`,
        );
      }
    });
    features.forEach((g, gi) => {
      if (g.type !== 'gap' && g.type !== 'ravine') return;
      let hit = false;
      for (let s = f.s - f.length; s < f.s - 0.05 && !hit; s += 0.5) {
        const hw = terrain.course.sampleAt(s).halfWidth;
        for (const d of ds) if (featureContains(g, s, d, hw)) hit = true;
      }
      if (hit) {
        push(
          `its face reaches into the ${g.type} (feature ${gi}): the face is kept up to the lip and ` +
            `the ${g.type}'s edge follows the lip line there`,
        );
      }
    });
    const k = gen?.kickers.find((q) => q.index === index);
    if (k && k.height.some((h) => !Number.isFinite(h))) {
      const off = k.height.flatMap((h, i) => (Number.isFinite(h) ? [] : [-k.halfWidth + i * k.step]));
      push(
        `no exact take-off over d ${(f.d + Math.min(...off)).toFixed(1)} … ` +
          `${(f.d + Math.max(...off)).toFixed(1)} (something else shapes the last metres of its face ` +
          `there): the iceberg rides the grid's lip`,
      );
    }
  });
  return out;
}
