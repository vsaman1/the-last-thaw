import type { ObstacleKind, ObstaclePlacement, RoadEnd, Terrain, TerrainFeature } from '../types';
import {
  bridgePlans,
  placementFrame,
  trafficLines,
  type BridgeEnd,
  type BridgePlan,
} from '../obstacles/bridges';
import { isSpanningKind, structureDef, structureFootprint } from '../obstacles/structures';
import { featureContains, polylineDistance, polylineOf, type PolylineHit } from './features';
import { cliffBandOut, cliffLipS, isGeneratedTerrain } from './terrain';
import { DECK_RULES } from '../obstacles/structures/deck';
import { carriesTraffic, locate, parkingContains, roadJunctions, ROAD_RULES, type RoadLine } from './roads';
import {
  findGlacierPortal,
  getGlacier,
  glacierFrame,
  glacierSnoutS,
  glacierSurface,
} from '../glacier/glacier';
import { caveFace, cavePlacement } from '../water/cave';
import { profileAt, streamDepth } from './stream';

/**
 * WORLD LOGIC: does the world make sense? Bridges reach the ground at both ends and carry a road
 * (or a path) across something; roads and track beds end somewhere; rivers have a source; things
 * stand where they would really stand. Each rule is one LogicRule with its tolerances in
 * LOGIC_RULES (documented in docs/LEVEL_AUTHORING.md §6b). Errors are clear nonsense (a deck ending
 * in mid-air, wagons on 5 m of track, a river out of nowhere); warnings are taste. validateLevel
 * includes the errors; call validateWorldLogic alone for both, e.g. in a level's tests.
 *
 * Kept apart from ./validate.ts (placements, features, cliffs, the line, routes) on purpose.
 */

export type LogicRule =
  | 'bridge-crossing'
  | 'bridge-end'
  | 'bridge-grade'
  | 'bridge-ground'
  | 'bridge-road'
  | 'bridge-skew'
  | 'road-end'
  | 'rail-wagon'
  | 'rail-short'
  | 'rail-end'
  | 'lighthouse-coast'
  | 'lift-line'
  | 'lift-slope'
  | 'open-ground'
  | 'building-road'
  | 'fence-road'
  | 'road-ground'
  | 'stream-source';

export interface LogicIssue {
  readonly rule: LogicRule;
  readonly severity: 'error' | 'warning';
  /** What the index points into: level.obstacles or level.features. */
  readonly area: 'obstacle' | 'feature';
  readonly index: number;
  /** The placement's kind or the feature's type. */
  readonly what: ObstacleKind | TerrainFeature['type'];
  /** Where (course coordinates). */
  readonly s: number;
  readonly d: number;
  readonly problem: string;
}

/** Tolerances (m unless noted) of the world logic rules. */
export const LOGIC_RULES = {
  /** A bridge's running surface meets the ground at each end within this. */
  bridgeEnd: 0.75,
  /**
   * A deck edge may reach this far (m) out over the gap at an end: the rim crossing that edge line
   * beyond the end of the span (an oblique rim met too close to the end on the centre line).
   */
  bridgeEdgeOver: 0.1,
  /** The ground may rise this far into a deck's underside between its supports. */
  bridgeIntrusion: 0.3,
  /** An approach road reaches a road bridge's end: within its half-width + this of the end. */
  bridgeRoadReach: 2,
  /**
   * A rim may cross a bridge this obliquely (degrees): a road deck skews its ends along the rim up
   * to DECK_RULES.skewMax (45°); a footbridge stays square (it is narrow).
   */
  bridgeSkewRoad: 45,
  bridgeSkewFoot: 30,
  /** A road end is fine within this (along the line) of a junction on it: a short spur, a drive. */
  endSpur: 15,
  /** ... within this of a parking area's edge. */
  endParking: 4,
  /** ... within this of a destination's footprint (building, works, dam, log pile: a drive or yard). */
  endDestination: 25,
  /** ... within its half-width + this of a bridge end (a road bridge, or a footbridge: a trailhead). */
  endBridge: 3,
  /** ... within this of the floor edge, or beyond it (it climbs into the valley wall). */
  endWall: 3,
  /** ... within its half-width + this of a wall ridge or island (a cul-de-sac against the rock). */
  endRock: 6,
  /** ... within this of a cliff's lip or foot where it is sheer (roads cannot cross a cliff). */
  endCliff: 20,
  /** ... within this of coastS (the beach blend), or this close to the sea (a harbour, a slipway). */
  endCoast: 70,
  endSea: 30,
  /** ... within this of the level's top (startS), the end of the course or the map bounds. */
  endEdge: 10,
  /** A track bed's end is fine within this of a wall ridge or island (a tunnel portal). */
  railPortal: 8,
  /** Track beds are at least this long (two wagons). */
  railMinLength: 30,
  /** A wagon may overhang its track bed's end by this much (the buffer). */
  wagonSlack: 1,
  /** A wagon stands within this (degrees) of its track's direction. */
  wagonAlign: 15,
  /** A lighthouse stands within this of the sea, or of coastS. */
  lighthouseCoast: 150,
  /** Ski-lift pylons this close to each other belong to one lift. */
  liftGroup: 150,
  /** A lift's pylons stand within this of the line through its end pylons (warning). */
  liftLine: 6,
  /** A pylon's rope runs within this (degrees) of the lift's line (warning). */
  liftAlign: 20,
  /** A lift climbs at least this grade between its end pylons (warning). */
  liftSlope: 0.05,
  /** Houses, chalets, barns and churches stand within this of a road, street or parking area. */
  buildingRoad: 60,
  /** A fence or guardrail sample this far inside a road's paved strip crosses it. */
  fenceInset: 0.5,
  /**
   * stream-source, 'cave': within sourceCaveReach behind the cave mouth the ground rises at least
   * sourceCaveRise above the spring's ground, somewhere by at least sourceCaveSteep (rise/run) over
   * sourceCaveRun: a rock face. Measured with these values (caveFace, all nine levels; a 12 m stream
   * pointing away from the rock): valley-wall feet rise 15.6–40.6 m, steepest 1.27–3.57; cliff-band
   * and rock-step feet 8.9–35.4 m, 1.66–7.60; the open floor on the centre line 1.0–3.8 m, 0.07–0.98,
   * and the stream heads that lay in open ground 2.1–6.2 m, 0.11–0.36 (all fail). Floor that passes
   * has rock in it (Rocky Canyon s 300: 8.4 m, 1.65); Highland Maze's s 600 rises 11.4 m but at most
   * 0.13 (a long slope, not a face: fails). The level caves: 8.2–18.6 m, 1.55–2.40. (The terrain
   * paints slopes ≥ 0.75 as rock.)
   */
  sourceCaveReach: 15,
  sourceCaveRise: 6,
  sourceCaveRun: 4,
  sourceCaveSteep: 1,
  /** stream-source, 'glacier': a meltwater portal's opening keeps this far from the iceberg's socket. */
  sourcePortalGap: 2,
  /** ... and its first point lies under at least this much ice (the glacier thins out at its edges). */
  sourceIceCover: 1,
  /** stream-source, 'branch': the parent's water may stand this little below the branch's bed. */
  sourceBranchSlack: 0.05,
  /**
   * road-ground: the ground at a lane's centre (a quarter of the width off the centreline) may stand at
   * most this far above the road there. A rock, ridge or wall reaching into the road lifts the cars
   * driving that lane up its face (Power Valley, 2026-10-21: a slag heap's end cap stood 10.2 m above
   * the plant street). Roads over a crestable mound tilt 1–1.6 m across and stay legal.
   */
  roadLaneRise: 3,
  /** road-ground: sample spacing along a road (m). */
  roadLaneStep: 2,
} as const;

const L = LOGIC_RULES;

/** Half length (m, at scale 1) of a rail wagon over its buffers. */
const WAGON_HALF = 7.2;
/** Buildings that need a road (rule building-road). */
const ROADSIDE: readonly ObstacleKind[] = ['house', 'chalet', 'barn', 'church'];
/** Structures that stand on open ground, never on a road (rule open-ground). */
const OPEN_GROUND: readonly ObstacleKind[] = ['pylon', 'windTurbine'];
/** Non-building destinations a road may end at (works, a dam, a log pile, a turbine's pad). */
const DESTINATIONS: readonly ObstacleKind[] = [
  'tank',
  'silo',
  'coolingTower',
  'smokestack',
  'waterTower',
  'lighthouse',
  'windTurbine',
  'skiLiftPylon',
  'dam',
  'logPile',
];

const hit: PolylineHit = { arc: 0 };
const fmt = (v: number): string => v.toFixed(1);
const at = (s: number, d: number): string => `(s ${fmt(s)}, d ${fmt(d)})`;

const isDestination = (kind: ObstacleKind): boolean =>
  kind === 'house' || structureDef(kind)?.building === true || DESTINATIONS.includes(kind);

/** Every world-logic issue of the level (see LogicRule; errors and warnings). */
export function validateWorldLogic(terrain: Terrain): LogicIssue[] {
  const out: LogicIssue[] = [];
  const lines = trafficLines(terrain);
  const plans = bridgePlans(terrain);
  out.push(...bridgeIssues(terrain, lines, plans));
  out.push(...roadEndIssues(terrain, lines, plans));
  out.push(...railIssues(terrain, lines));
  out.push(...placementIssues(terrain, lines));
  out.push(...streamSourceIssues(terrain));
  out.push(...roadGroundIssues(terrain, lines));
  return out;
}

// --- (f) the ground in a road's lanes ------------------------------------------------------------

/**
 * Rule road-ground: a road or street is driveable across its lanes. Vehicles are posed on the ground
 * under them, so where a rock, ridge or wall reaches into the carriageway the cars of that lane drive
 * up its face. One error per road, at the worst place. Decks and dam crests (carve: false) are not
 * ground roads and are skipped.
 */
function roadGroundIssues(terrain: Terrain, lines: readonly RoadLine[]): LogicIssue[] {
  const out: LogicIssue[] = [];
  const ground = (s: number, d: number): number => terrain.course.toWorld(s, d).y;
  for (const l of lines) {
    if (l.bridge !== undefined || !l.carve || l.feature < 0) continue;
    let worst = { rise: 0, s: 0, d: 0 };
    for (let k = 0; k + 1 < l.points.length; k++) {
      const a = l.points[k];
      const b = l.points[k + 1];
      const len = Math.hypot(b.s - a.s, b.d - a.d);
      if (!(len > 0)) continue;
      const n = Math.max(1, Math.ceil(len / L.roadLaneStep));
      // Unit normal of the segment in course coordinates.
      const ns = -(b.d - a.d) / len;
      const nd = (b.s - a.s) / len;
      for (let j = 0; j <= n; j++) {
        const cs = a.s + ((b.s - a.s) * j) / n;
        const cd = a.d + ((b.d - a.d) * j) / n;
        const yc = ground(cs, cd);
        for (const off of [-l.width / 4, l.width / 4]) {
          const ps = cs + ns * off;
          const pd = cd + nd * off;
          const rise = ground(ps, pd) - yc;
          if (rise > worst.rise) worst = { rise, s: ps, d: pd };
        }
      }
    }
    if (worst.rise > L.roadLaneRise) {
      out.push({
        rule: 'road-ground',
        severity: 'error',
        area: 'feature',
        index: l.feature,
        what: l.type,
        s: worst.s,
        d: worst.d,
        problem:
          `the ground in this ${l.type}'s lane stands ${fmt(worst.rise)} m above the road at ${at(worst.s, worst.d)} ` +
          `(at most ${L.roadLaneRise} m): a rock, ridge or wall reaches into the carriageway and cars would drive up ` +
          'its face — move the road or shorten the feature',
      });
    }
  }
  return out;
}

// --- (e) stream sources ----------------------------------------------------------------------------

type Stream = Extract<TerrainFeature, { type: 'stream' }>;

/**
 * Rule stream-source: a river cannot pop out of open ground. Every stream has a `source` that holds
 * (types.ts StreamSource): under the glacier and out through its snout, from a cave in a rock face,
 * or from another stream's channel. One error per stream, telling the author what to change.
 */
function streamSourceIssues(terrain: Terrain): LogicIssue[] {
  const out: LogicIssue[] = [];
  (terrain.level.features ?? []).forEach((f, index) => {
    if (f.type !== 'stream' || f.points.length === 0) return;
    const p0 = f.points[0];
    const problem = streamSourceProblem(terrain, f, index);
    if (problem) {
      out.push({
        rule: 'stream-source',
        severity: 'error',
        area: 'feature',
        index,
        what: 'stream',
        s: p0.s,
        d: p0.d,
        problem,
      });
    }
  });
  return out;
}

/** Why stream `f` (feature `index`) has no believable source, or null when it has one. */
export function streamSourceProblem(terrain: Terrain, f: Stream, index: number): string | null {
  const p0 = f.points[0];
  const where = at(p0.s, p0.d);
  switch (f.source) {
    case undefined:
      return (
        `rises out of open ground at ${where}: a river needs a source — start it under the ` +
        "level-start glacier (source: 'glacier'), at a spring in a rock face (source: 'cave': the " +
        "valley wall, a wall ridge, a cliff or rock step) or in another stream's channel " +
        "(source: 'branch')"
      );
    case 'glacier':
      return glacierSourceProblem(terrain, f, index);
    case 'cave':
      return caveSourceProblem(terrain, f, index);
    case 'branch':
      return branchSourceProblem(terrain, f, index);
  }
}

function glacierSourceProblem(terrain: Terrain, f: Stream, index: number): string | null {
  const g = getGlacier(terrain);
  const p0 = f.points[0];
  const portal = findGlacierPortal(g, f, index);
  const w = terrain.course.toWorld(p0.s, p0.d);
  const fd = (w.x - g.spawn.x) * g.rx + (w.z - g.spawn.z) * g.rz;
  if (portal === 'not-under') {
    return (
      `its first point ${at(p0.s, p0.d)} is not under the glacier: start it under the ice — ` +
      `upstream of the snout (s < ${fmt(glacierSnoutS(g, fd))} at that d, the glacier reaches back to ` +
      `s ${fmt(g.backS)}) and within its width (|d| < ${fmt(g.halfWidth)})`
    );
  }
  if (portal === 'side') {
    return (
      'it leaves the glacier through its side, where there is no face to open a portal in: run it ' +
      `out through the snout (|d| < ${fmt(g.floorHalfWidth)} where it crosses the snout line)`
    );
  }
  if (portal === 'stays') return 'it never leaves the glacier: run it out through the snout';
  // Really under the ice (the glacier thins to nothing at its edges): over the source's bank top.
  const first = glacierFrame(g, w.x, w.z);
  const gen = isGeneratedTerrain(terrain) ? terrain : null;
  const prof = gen?.streamProfiles.find((p) => p.index === index);
  const bankTop = prof ? profileAt(prof, 0) : w.y;
  const cover = glacierSurface(g, first.s, first.d) - bankTop;
  if (cover < L.sourceIceCover) {
    return (
      `its first point ${at(p0.s, p0.d)} lies under only ${fmt(Math.max(0, cover))} m of the glacier's ` +
      `thin edge (needs ≥ ${L.sourceIceCover} m of ice over the ground): start it further in under the ice`
    );
  }
  const inner = Math.abs(portal.d) - portal.half;
  const need = g.socketHalf + L.sourcePortalGap;
  if (inner < need) {
    return (
      `its ice portal (d ${fmt(portal.d - portal.half)}..${fmt(portal.d + portal.half)} on the snout) ` +
      `reaches the iceberg's socket (keep |d| ≥ ${fmt(need)}): move the stream sideways under the ice`
    );
  }
  if (portal.short > 0) {
    return (
      `the snout over its ice portal at d ${fmt(portal.d)} is ${fmt(portal.short)} m too thin to arch ` +
      'over the channel: run it out nearer the middle of the glacier (or make the channel shallower)'
    );
  }
  return null;
}

function caveSourceProblem(terrain: Terrain, f: Stream, index: number): string | null {
  if (f.points.length < 2) return 'needs a first segment: the cave faces down it';
  const c = cavePlacement(terrain, index);
  if (!c) return 'its first segment has no length: the cave faces down it';
  const face = caveFace(terrain, c, L.sourceCaveReach, L.sourceCaveRun);
  if (face.rise >= L.sourceCaveRise && face.steepest >= L.sourceCaveSteep) return null;
  const m = terrain.course.project(face.x, face.z);
  return (
    `its cave mouth ${at(m.s, m.d)} has no rock face behind it: the ground behind the mouth rises ` +
    `${fmt(face.rise)} m within ${L.sourceCaveReach} m (needs ≥ ${L.sourceCaveRise} m) and its steepest ` +
    `${L.sourceCaveRun} m climbs ${face.steepest.toFixed(2)} per m (a rock face: ≥ ${L.sourceCaveSteep}) — ` +
    'put the spring at the foot of the valley wall, a wall ridge, a cliff or rock step, with its ' +
    'first segment pointing away from the rock'
  );
}

function branchSourceProblem(terrain: Terrain, f: Stream, index: number): string | null {
  const level = terrain.level;
  const p0 = f.points[0];
  const hw = halfWidth(terrain, p0.s);
  const features = level.features ?? [];
  const parent = features.findIndex(
    (g, k) => k !== index && g.type === 'stream' && featureContains(g, p0.s, p0.d, hw),
  );
  if (parent < 0) {
    return (
      `its first point ${at(p0.s, p0.d)} is in no other stream's channel: start a branch inside ` +
      "its parent's channel (between its bank tops)"
    );
  }
  const g = features[parent] as Stream;
  const gen = isGeneratedTerrain(terrain) ? terrain : null;
  const ground = terrain.course.toWorld(p0.s, p0.d).y;
  const own = gen?.streamProfiles.find((p) => p.index === index);
  const bed = (own ? profileAt(own, 0) : ground) - f.bank;
  const prof = gen?.streamProfiles.find((p) => p.index === parent);
  polylineDistance(polylineOf(g), p0.s, p0.d, hit);
  const water = (prof ? profileAt(prof, hit.arc) : ground) - g.bank + streamDepth(g);
  if (water >= bed - L.sourceBranchSlack) return null;
  return (
    `its bed (${fmt(bed)} m) stands ${fmt(bed - water)} m above the water of stream feature ${parent} ` +
    `where it leaves it (${fmt(water)} m): no water flows in — deepen it (a higher bank) or start it ` +
    'where the parent stands higher'
  );
}

// --- (a) bridges --------------------------------------------------------------------------------

/** The authored road or street that runs over a bridge's deck (both ends and the middle), or -1. */
function lineOverDeck(lines: readonly RoadLine[], b: BridgePlan): number {
  const [e0, e1] = b.ends;
  const mid = { s: (e0.s + e1.s) / 2, d: (e0.d + e1.d) / 2 };
  return lines.findIndex((l) => {
    if (!carriesTraffic(l) || l.bridge !== undefined) return false;
    const r = l.width / 2 + 1;
    return [e0, e1, mid].every((q) => polylineDistance(l.poly, q.s, q.d) <= r);
  });
}

function bridgeIssues(
  terrain: Terrain,
  lines: readonly RoadLine[],
  plans: readonly BridgePlan[],
): LogicIssue[] {
  const out: LogicIssue[] = [];
  const level = terrain.level;
  const features = level.features ?? [];
  for (const b of plans) {
    const p = level.obstacles[b.index];
    const push = (
      rule: LogicRule,
      problem: string,
      s = p.s,
      d = p.d,
      severity: 'error' | 'warning' = 'error',
    ): void => {
      out.push({ rule, severity, area: 'obstacle', index: b.index, what: b.kind, s, d, problem });
    };
    const label = (k: number): string => (k === 0 ? 'one end' : 'the other end');
    if (b.mode === 'floating') {
      const hang = b.ends.map((e) => fmt(e.top - e.ground)).join(' m and ');
      push(
        'bridge-crossing',
        `crosses nothing: no ground falls away under the line between its ends (no gorge, ravine, ` +
          `stream or cutting), so its deck stands ${fmt(b.spec.clearance)} m up with both ends in the ` +
          `air (${hang} m above the ground): span a gap from rim to rim, or remove it`,
      );
      continue;
    }
    b.ends.forEach((e, k) => {
      const gap = e.top - e.ground;
      const where = at(e.s, e.d);
      const inStream = features.findIndex(
        (f) => f.type === 'stream' && featureContains(f, e.s, e.d, halfWidth(terrain, e.s)),
      );
      if (terrain.isOcean(e.x, e.z)) {
        push('bridge-end', `${label(k)} ${where} ends in the sea: a bridge ends on land`, e.s, e.d);
      } else if (inStream >= 0) {
        push(
          'bridge-end',
          `${label(k)} ${where} ends in the stream channel (feature ${inStream}): lengthen the span ` +
            'past the bank top',
          e.s,
          e.d,
        );
      } else if (Math.abs(gap) > L.bridgeEnd) {
        const why =
          gap > 0
            ? b.mode === 'walls'
              ? `the valley wall does not rise to the deck within ${DECK_RULES.wallSearch * b.scale} m: ` +
                'shorten the span ' +
                'into a gap, or give it a span that ends on the rims'
              : 'it hangs over the edge (inside a ravine cut or past a rim): move the end onto the rim ' +
                '(lengthen the span past the edge)'
            : 'it is buried in the ground: shorten the span';
        push(
          'bridge-end',
          `${label(k)} ${where} is ${fmt(Math.abs(gap))} m ${gap > 0 ? 'above' : 'below'} the ground ` +
            `(a deck meets the ground within ${L.bridgeEnd} m at both ends): ${why}`,
          e.s,
          e.d,
        );
      } else if (b.over[k] > L.bridgeEdgeOver) {
        // (An end already over the gap on its centre line is reported once, above.)
        const angle = b.plan.rimSkew[k];
        const need = Math.tan(angle) * (b.spec.width / 2) * b.scale;
        push(
          'bridge-end',
          `${label(k)} ${where}: the rim crosses the deck ${((angle * 180) / Math.PI).toFixed(0)}° from ` +
            `square and lies ${fmt(b.over[k])} m beyond the end on one edge, so that corner of the deck ` +
            `stands out over the gap: lengthen the span so each end lies at least tan(angle) × half ` +
            `the deck's width (${fmt(need)} m) past the rim on the centre line`,
          e.s,
          e.d,
        );
      }
    });
    const rise = Math.abs(b.ends[1].top - b.ends[0].top);
    const run = Math.hypot(b.ends[1].x - b.ends[0].x, b.ends[1].z - b.ends[0].z);
    if (Math.abs(b.grade) > b.spec.maxGrade) {
      push(
        'bridge-grade',
        `its ends differ by ${fmt(rise)} m over ${fmt(run)} m (grade ` +
          `${(100 * Math.abs(b.grade)).toFixed(0)} % > ${(100 * b.spec.maxGrade).toFixed(0)} %): ` +
          'put it where the rims are nearer level, or across ' +
          'the slope rather than down it',
      );
    }
    const skewMax = b.kind === 'roadBridge' ? L.bridgeSkewRoad : L.bridgeSkewFoot;
    if ((b.skew * 180) / Math.PI > skewMax + 0.5) {
      push(
        'bridge-skew',
        `the rim crosses it at ${((b.skew * 180) / Math.PI).toFixed(0)}° from square (at most ` +
          `${skewMax}°): its ${b.kind === 'roadBridge' ? 'skewed ends cannot follow' : 'square ends hang over'} ` +
          'the edge — turn it (yaw) more nearly square to the gap',
      );
    }
    if (b.intrusion.by > L.bridgeIntrusion) {
      push(
        'bridge-ground',
        `the ground rises ${fmt(b.intrusion.by)} m into the deck at ${at(b.intrusion.s, b.intrusion.d)}: ` +
          'a hump between its ends; shorten the span to the gap it crosses',
        b.intrusion.s,
        b.intrusion.d,
      );
    }
    if (b.kind !== 'roadBridge') continue;
    const over = lineOverDeck(lines, b);
    if (over >= 0 && lines[over].carve) {
      push(
        'bridge-road',
        `the ${lines[over].type} (feature ${lines[over].feature}) over its deck is carved: give it ` +
          'carve: false (the deck is the road) or end it at the rims',
        p.s,
        p.d,
        'warning',
      );
    }
    b.ends.forEach((e, k) => {
      const reached = lines.some((l, li) => {
        if (li === over || l.bridge !== undefined || !carriesTraffic(l)) return false;
        return polylineDistance(l.poly, e.s, e.d) <= l.width / 2 + L.bridgeRoadReach;
      });
      if (!reached) {
        push(
          'bridge-road',
          `no road reaches ${label(k)} ${at(e.s, e.d)}: a road bridge carries a road — end a road or ` +
            `street within ${L.bridgeRoadReach} m of it (the street over the deck joins it there)`,
          e.s,
          e.d,
        );
      }
    });
  }
  return out;
}

// --- (b) road ends --------------------------------------------------------------------------------

const halfWidth = (terrain: Terrain, s: number): number =>
  terrain.course.sampleAt(Math.min(Math.max(s, 0), terrain.course.length)).halfWidth;

/** True if open sea lies within `r` m of world (x, z) (16 directions, 5 m rings). */
function seaNear(terrain: Terrain, x: number, z: number, r: number): boolean {
  if (terrain.isOcean(x, z)) return true;
  for (let ring = 5; ring <= r + 1e-9; ring += 5) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * 2 * Math.PI;
      if (terrain.isOcean(x + ring * Math.cos(a), z + ring * Math.sin(a))) return true;
    }
  }
  return false;
}

/** Why an end at (s, d) is not in the middle of nowhere, or null when it is. */
function endReason(
  terrain: Terrain,
  s: number,
  d: number,
  plans: readonly BridgePlan[],
  width: number,
): string | null {
  const level = terrain.level;
  for (const f of level.features ?? []) {
    if (f.type === 'parking' && parkingContains(f, s, d, L.endParking)) return 'parking';
  }
  for (const p of level.obstacles) {
    if (!isDestination(p.kind)) continue;
    const r = (structureFootprint(p.kind, p.scale ?? 1) ?? 6) + L.endDestination;
    const reach = p.kind === 'dam' ? r + (p.span ?? 0) / 2 : r;
    if (Math.hypot(p.s - s, p.d - d) <= reach) return 'destination';
  }
  const near = (e: BridgeEnd): boolean => Math.hypot(e.s - s, e.d - d) <= width / 2 + L.endBridge;
  if (plans.some((b) => b.ends.some(near))) return 'bridge';
  const hw = halfWidth(terrain, s);
  if (Math.abs(d) >= hw - L.endWall) return 'wall';
  const rock = (level.features ?? []).some(
    (f) =>
      (f.type === 'island' || (f.type === 'ridge' && f.profile !== 'mound')) &&
      featureContains(f, s, d, hw, width / 2 + L.endRock),
  );
  if (rock) return 'rock';
  // A road the game cannot carve down a cliff stops at its lip and goes on from its foot.
  for (const c of level.cliffs) {
    if (cliffBandOut(c, d) > width / 2) continue;
    const lip = cliffLipS(c, d);
    if (s > lip - L.endCliff && s < lip + level.cellSize + L.endCliff) return 'cliff';
  }
  const w = terrain.course.toWorld(s, d);
  if (s >= level.coastS - L.endCoast || seaNear(terrain, w.x, w.z, L.endSea)) return 'coast';
  const b = level.bounds;
  const e = L.endEdge;
  if (s <= level.startS + e || s >= terrain.course.length - e) return 'edge';
  if (w.x <= b.minX + e || w.x >= b.maxX - e || w.z <= b.minZ + e || w.z >= b.maxZ - e) return 'edge';
  return null;
}

/** The marks an authored line carries at its first and last point. */
function endMarks(terrain: Terrain, l: RoadLine): [RoadEnd | undefined, RoadEnd | undefined] {
  const f = (terrain.level.features ?? [])[l.feature];
  if (!f || (f.type !== 'road' && f.type !== 'street')) return [undefined, undefined];
  return [f.start, f.end];
}

function roadEndIssues(
  terrain: Terrain,
  lines: readonly RoadLine[],
  plans: readonly BridgePlan[],
): LogicIssue[] {
  const out: LogicIssue[] = [];
  const junctions = roadJunctions(lines);
  lines.forEach((l, li) => {
    if (l.bridge !== undefined || !carriesTraffic(l)) return;
    const marks = endMarks(terrain, l);
    const len = l.poly.length;
    for (const k of [0, 1] as const) {
      if (marks[k]) continue;
      const arc = k === 0 ? 0 : len;
      // How far the end runs past the nearest junction on this line.
      let spur = Infinity;
      for (const j of junctions) {
        if (j.at.length < 2) continue;
        for (const m of j.at) if (m.line === li) spur = Math.min(spur, Math.abs(m.arc - arc));
      }
      if (spur <= L.endSpur) continue;
      const p = locate(l.poly, arc);
      if (endReason(terrain, p.s, p.d, plans, l.width)) continue;
      const past = Number.isFinite(spur)
        ? `runs ${fmt(spur)} m past its last junction and `
        : 'meets no other road and ';
      const f = (terrain.level.features ?? [])[l.feature];
      out.push({
        rule: 'road-end',
        severity: 'error',
        area: 'feature',
        index: l.feature,
        what: f?.type ?? l.type,
        s: p.s,
        d: p.d,
        problem:
          `its ${k === 0 ? 'first' : 'last'} end ${at(p.s, p.d)} ${past}stops in the middle of nowhere: ` +
          `end a road at a junction, a parking area, a building or yard (≤ ${L.endDestination} m), a ` +
          'bridge, the valley wall or a rock wall, the coast or a level edge — or mark it ' +
          `(${k === 0 ? 'start' : 'end'}: ` +
          `'turning' for a turning circle, 'trailhead' where a footpath goes on)`,
      });
    }
  });
  return out;
}

// --- (c) rail -------------------------------------------------------------------------------------

function railIssues(terrain: Terrain, lines: readonly RoadLine[]): LogicIssue[] {
  const out: LogicIssue[] = [];
  const level = terrain.level;
  const features = level.features ?? [];
  const beds = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.surface === 'rail');
  for (const { l, i } of beds) {
    const f = features[l.feature];
    const what = f?.type ?? l.type;
    const push = (rule: LogicRule, s: number, d: number, problem: string): void => {
      out.push({ rule, severity: 'error', area: 'feature', index: l.feature, what, s, d, problem });
    };
    const len = l.poly.length;
    if (len < L.railMinLength) {
      const p = locate(l.poly, len / 2);
      push('rail-short', p.s, p.d, `only ${fmt(len)} m of track (a track bed is ≥ ${L.railMinLength} m)`);
    }
    const marks = endMarks(terrain, l);
    for (const k of [0, 1] as const) {
      if (marks[k]) continue;
      const p = locate(l.poly, k === 0 ? 0 : len);
      const joins = beds.some(
        ({ l: o, i: oi }) =>
          oi !== i && polylineDistance(o.poly, p.s, p.d) <= o.width / 2 + ROAD_RULES.meetReach,
      );
      if (joins) continue;
      const hw = halfWidth(terrain, p.s);
      const portal = features.some(
        (g) =>
          (g.type === 'island' || (g.type === 'ridge' && g.profile !== 'mound')) &&
          featureContains(g, p.s, p.d, hw, L.railPortal),
      );
      if (portal) continue;
      if (endReason(terrain, p.s, p.d, [], l.width)) continue;
      push(
        'rail-end',
        p.s,
        p.d,
        `its ${k === 0 ? 'first' : 'last'} end ${at(p.s, p.d)} stops mid-field: run a track bed into ` +
          'the valley wall, a tunnel portal (a wall ridge), the coast or a level edge, to a goods shed, ' +
          `or end it at a buffer stop (${k === 0 ? 'start' : 'end'}: 'buffer')`,
      );
    }
  }
  // Wagons: wholly on their track bed, along it.
  level.obstacles.forEach((p, index) => {
    if (p.kind !== 'railWagon') return;
    const bed = beds.find(({ l }) => polylineDistance(l.poly, p.s, p.d, hit) <= l.width / 2 + 0.5);
    if (!bed) return; // vehicleProblems reports a wagon off any track bed
    polylineDistance(bed.l.poly, p.s, p.d, hit);
    const a = hit.arc;
    const half = WAGON_HALF * (p.scale ?? 1);
    const over = Math.max(half - a, a + half - bed.l.poly.length) - L.wagonSlack;
    const push = (rule: LogicRule, problem: string): void => {
      out.push({ rule, severity: 'error', area: 'obstacle', index, what: p.kind, s: p.s, d: p.d, problem });
    };
    if (over > 0) {
      push(
        'rail-wagon',
        `overhangs the end of its track bed (feature ${bed.l.feature}, ${fmt(bed.l.poly.length)} m long) ` +
          `by ${fmt(over + L.wagonSlack)} m: lengthen the track or move the wagon along it`,
      );
    }
    const t = locate(bed.l.poly, a);
    const yaw = p.yaw ?? Math.PI / 2;
    // Local +z (the wagon's length) at yaw is (cos yaw, −sin yaw) in (s, d).
    const dot = Math.abs(Math.cos(yaw) * t.ts - Math.sin(yaw) * t.td);
    const off = (Math.acos(Math.min(1, dot)) * 180) / Math.PI;
    if (off > L.wagonAlign) {
      push(
        'rail-wagon',
        `stands ${off.toFixed(0)}° across its track bed (feature ${bed.l.feature}): turn it along ` +
          'the rails',
      );
    }
  });
  return out;
}

// --- (d) placement in context ---------------------------------------------------------------------

/** Distance (m) from (s, d) to the nearest paved strip edge of the lines (0 on one), and its line. */
function nearestRoad(lines: readonly RoadLine[], s: number, d: number): { dist: number; line: number } {
  let best = { dist: Infinity, line: -1 };
  lines.forEach((l, i) => {
    const dist = Math.max(0, polylineDistance(l.poly, s, d) - l.width / 2);
    if (dist < best.dist) best = { dist, line: i };
  });
  return best;
}

/** Course points along a spanning placement, every metre (as the build lays it out). */
function spanPoints(terrain: Terrain, p: ObstaclePlacement, index: number): { s: number; d: number }[] {
  const f = placementFrame(terrain, p, index);
  if (!f) return [{ s: p.s, d: p.d }];
  const half = f.ctx.span / 2;
  const n = Math.max(1, Math.ceil(2 * half * f.s));
  const pts: { s: number; d: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const x = -half + (2 * half * i) / n;
    pts.push(terrain.course.project(f.worldX(x, 0), f.worldZ(x, 0)));
  }
  return pts;
}

function placementIssues(terrain: Terrain, lines: readonly RoadLine[]): LogicIssue[] {
  const out: LogicIssue[] = [];
  const level = terrain.level;
  const features = level.features ?? [];
  const roads = lines.filter((l) => carriesTraffic(l));
  const parkings = features.filter((f) => f.type === 'parking');
  const lifts: number[] = [];
  level.obstacles.forEach((p, index) => {
    const push = (rule: LogicRule, problem: string, severity: 'error' | 'warning' = 'error'): void => {
      out.push({ rule, severity, area: 'obstacle', index, what: p.kind, s: p.s, d: p.d, problem });
    };
    const w = terrain.course.toWorld(p.s, p.d);
    if (p.kind === 'lighthouse') {
      if (p.s < level.coastS - L.lighthouseCoast && !seaNear(terrain, w.x, w.z, L.lighthouseCoast)) {
        push(
          'lighthouse-coast',
          `${fmt(level.coastS - p.s)} m above the coast and no sea within ${L.lighthouseCoast} m: a ` +
            'lighthouse stands on the coast (a headland, a harbour mole)',
        );
      }
    }
    if (p.kind === 'skiLiftPylon') lifts.push(index);
    if (OPEN_GROUND.includes(p.kind)) {
      const r = (structureFootprint(p.kind, p.scale ?? 1) ?? 3) / 2;
      const on = lines.findIndex((l) => polylineDistance(l.poly, p.s, p.d) <= l.width / 2 + r);
      const park = parkings.findIndex((f) => f.type === 'parking' && parkingContains(f, p.s, p.d, r));
      if (on >= 0 || park >= 0) {
        const what = on >= 0 ? describeLine(lines[on]) : 'a parking area';
        push('open-ground', `stands on ${what}: pylons and wind turbines stand on open ground beside roads`);
      }
    }
    if (ROADSIDE.includes(p.kind)) {
      const n = nearestRoad(roads, p.s, p.d);
      let dist = n.dist;
      for (const f of parkings) {
        if (f.type !== 'parking') continue;
        // Distance to the rectangle (in its frame).
        const c = Math.cos(f.yaw ?? 0);
        const sn = -Math.sin(f.yaw ?? 0);
        const a = (p.s - f.s) * c + (p.d - f.d) * sn;
        const b = -(p.s - f.s) * sn + (p.d - f.d) * c;
        const da = Math.max(0, Math.abs(a) - f.length / 2);
        const db = Math.max(0, Math.abs(b) - f.width / 2);
        dist = Math.min(dist, Math.hypot(da, db));
      }
      if (dist > L.buildingRoad) {
        push(
          'building-road',
          `${Number.isFinite(dist) ? fmt(dist) + ' m' : 'far'} from the nearest road, street or parking ` +
          'area: ' +
            `buildings stand within ${L.buildingRoad} m of one (a street, a farm track, a drive)`,
        );
      }
    }
    if (p.kind === 'fence' || p.kind === 'guardrail') {
      if (!isSpanningKind(p.kind)) return;
      const crossed = new Set<number>();
      let first: { s: number; d: number } | null = null;
      for (const q of spanPoints(terrain, p, index)) {
        lines.forEach((l, li) => {
          if (crossed.has(li)) return;
          if (polylineDistance(l.poly, q.s, q.d) <= l.width / 2 - L.fenceInset) {
            crossed.add(li);
            first ??= q;
          }
        });
      }
      for (const li of crossed) {
        const q = first ?? p;
        push(
          'fence-road',
          `crosses ${describeLine(lines[li])} near ${at(q.s, q.d)}: fences and guardrails run beside ` +
            'roads and track beds, not across them',
        );
      }
    }
  });
  out.push(...liftIssues(terrain, lifts));
  return out;
}

const describeLine = (l: RoadLine): string =>
  l.bridge !== undefined
    ? `the street over the bridge (obstacle ${l.bridge})`
    : `the ${l.surface === 'rail' ? 'track bed' : l.type} (feature ${l.feature})`;

/** Ski lifts: pylons grouped by proximity; a lift is a line of pylons up a slope. */
function liftIssues(terrain: Terrain, pylons: readonly number[]): LogicIssue[] {
  const out: LogicIssue[] = [];
  const obs = terrain.level.obstacles;
  const seen = new Set<number>();
  for (const start of pylons) {
    if (seen.has(start)) continue;
    const group = [start];
    seen.add(start);
    for (let k = 0; k < group.length; k++) {
      const a = obs[group[k]];
      for (const j of pylons) {
        if (seen.has(j)) continue;
        if (Math.hypot(obs[j].s - a.s, obs[j].d - a.d) <= L.liftGroup) {
          seen.add(j);
          group.push(j);
        }
      }
    }
    const push = (index: number, rule: LogicRule, problem: string, severity: 'error' | 'warning'): void => {
      const p = obs[index];
      out.push({ rule, severity, area: 'obstacle', index, what: p.kind, s: p.s, d: p.d, problem });
    };
    if (group.length === 1) {
      push(
        start,
        'lift-line',
        `a ski-lift pylon on its own (none within ${L.liftGroup} m): a lift is a line of pylons up a slope`,
        'error',
      );
      continue;
    }
    // The line through the two pylons furthest apart.
    let ia = group[0];
    let ib = group[1];
    let far = -1;
    for (const i of group) {
      for (const j of group) {
        const dd = Math.hypot(obs[i].s - obs[j].s, obs[i].d - obs[j].d);
        if (dd > far) {
          far = dd;
          ia = i;
          ib = j;
        }
      }
    }
    const A = obs[ia];
    const B = obs[ib];
    const us = (B.s - A.s) / (far || 1);
    const ud = (B.d - A.d) / (far || 1);
    for (const i of group) {
      const p = obs[i];
      const off = Math.abs((p.s - A.s) * ud - (p.d - A.d) * us);
      if (off > L.liftLine) {
        const why = `${fmt(off)} m off the line of its lift: a lift's pylons stand in a line`;
        push(i, 'lift-line', why, 'warning');
      }
      const yaw = p.yaw ?? 0;
      const dot = Math.abs(Math.cos(yaw) * us - Math.sin(yaw) * ud);
      const ang = (Math.acos(Math.min(1, dot)) * 180) / Math.PI;
      if (ang > L.liftAlign) {
        const why = `its rope runs ${ang.toFixed(0)}° across the line of its lift: turn it along the line`;
        push(i, 'lift-line', why, 'warning');
      }
    }
    const ya = terrain.course.toWorld(A.s, A.d).y;
    const yb = terrain.course.toWorld(B.s, B.d).y;
    const grade = Math.abs(yb - ya) / (far || 1);
    if (grade < L.liftSlope) {
      push(
        ia,
        'lift-slope',
        `the lift through pylons ${ia}–${ib} climbs only ${(100 * grade).toFixed(1)} %: ` +
          'ski lifts climb slopes',
        'warning',
      );
    }
  }
  return out;
}
