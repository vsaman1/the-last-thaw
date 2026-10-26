import type { Terrain } from '../types';
import { trafficLines } from '../obstacles/bridges';
import { carriesTraffic, locate, roadJunctions, ROAD_RULES, type RoadLine } from '../terrain/roads';

/**
 * The traffic network of a level, in world space: right-hand two-lane roads split at their
 * junctions, the turns through each junction and the turn-arounds at dead ends. Built once per
 * terrain from its road lines (src/core/terrain/roads.ts) and immutable; deterministic.
 *
 * Every drivable piece is a TrafficPath (a polyline with arc length):
 * - lane:  one direction of a road between two nodes (junctions or dead ends), offset to the right
 *          of travel by NETWORK_TUNING.laneShare × width; it stops short of a junction at its stop
 *          line (the widest road there's half-width + junctionMargin from the junction centre).
 * - turn:  a cubic Bézier through a junction from an incoming lane's end to an outgoing lane's start
 *          (every other leg; straight on, left or right), with the turns it crosses (`conflicts`).
 * - uturn: a half circle at a dead end from a lane's end into the opposite lane.
 * A lane's successors are the turns (or the U-turn) at its end, picked by weight (straight on 6,
 * right 3, left 2); a turn's only successor is its outgoing lane.
 *
 * Signals: a junction of 3+ legs may be signalised when every road meeting there is asphalt (a street
 * can force it with signals: true / false); the busiest (most legs, widest roads) get lights first,
 * none within NETWORK_TUNING.signalSpacing of another. Legs are grouped into signal phases by direction
 * (opposite legs share one; the widest road's pair goes first) and the phases cycle green →
 * amber → all-red with a per-junction offset (./signals.ts).
 */

export const NETWORK_TUNING = {
  /** Centreline sample spacing (m of course arc). */
  sampleStep: 2,
  /** Lane centre offset from the road centreline: width × laneShare, clamped to [laneMin, laneMax]. */
  laneShare: 0.25,
  laneMin: 1.2,
  laneMax: 2.6,
  /** Stop lines sit this far (m) beyond the half-width of the widest road at the junction. */
  junctionMargin: 2,
  /** Lanes end this far (m) before a dead end, where they turn round. */
  deadEndMargin: 1,
  /** Lanes shorter than this (m) are dropped (junctions too close together). */
  minLane: 4,
  /** Lateral acceleration (m/s²) that limits speed through turns, and the floor of that limit. */
  turnLatAccel: 2.5,
  minTurnSpeed: 2.5,
  /** Turns whose paths come closer than this (m) conflict: one at a time in the junction. */
  conflictDistance: 2.4,
  /** Turns within this angle (rad) of straight on count as straight. */
  straightAngle: 0.6,
  /** Successor weights. */
  straightWeight: 6,
  rightWeight: 3,
  leftWeight: 2,
  /** Legs within this angle (rad) of opposite share a signal phase. */
  oppositeAngle: 0.7,
  /**
   * Signalised junctions are at least this far apart (m): the busiest crossroads get lights, the
   * minor junctions next to them are unsignalised (one vehicle at a time through crossing paths).
   */
  signalSpacing: 70,
  /** Signal timing (s): green of the first phase, of the others, amber, all-red clearance. */
  green: 12,
  minorGreen: 9,
  amber: 3,
  allRed: 1.5,
} as const;

const N = NETWORK_TUNING;

export type PathKind = 'lane' | 'turn' | 'uturn';

export interface TrafficPath {
  readonly id: number;
  readonly kind: PathKind;
  /** World x/z samples and cumulative arc length (m). */
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  readonly arc: Float64Array;
  readonly length: number;
  /** Road line of a lane (index into TrafficNetwork.lines); the outgoing lane's for turns. */
  readonly line: number;
  /** Lanes: junction at the end (-1 = dead end); turns: the junction they cross; U-turns: -1. */
  readonly junction: number;
  /** Lanes ending at a junction: the approach leg (index into junction.legs), else -1. */
  readonly leg: number;
  /** Successor paths and their choice weights. */
  readonly succ: number[];
  readonly weights: number[];
  /** Speed limit (m/s). */
  readonly speed: number;
  /** Turns: other turns at the same junction this one crosses or merges with. */
  readonly conflicts: number[];
  /** Turns and U-turns: the lane they lead into; lanes: -1. */
  readonly out: number;
}

export interface JunctionLeg {
  readonly line: number;
  /** Arc along the line (course units) of the junction. */
  readonly arc: number;
  /** +1: the leg runs toward increasing arc from the junction; -1: toward decreasing. */
  readonly sign: 1 | -1;
  /** World unit direction from the junction centre along the leg. */
  readonly dirX: number;
  readonly dirZ: number;
  /** Signal phase of traffic arriving on this leg (-1: unsignalised). */
  group: number;
  /** Lane arriving at the junction on this leg, and the lane leaving it (-1: none). */
  inLane: number;
  outLane: number;
}

export interface TrafficJunction {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  /** Stop lines are this far (m) from the centre. */
  readonly radius: number;
  readonly legs: JunctionLeg[];
  signalised: boolean;
  /** Signal phases: count, green time of each (s), cycle length (s) and this junction's offset (s). */
  groups: number;
  greens: number[];
  cycle: number;
  offset: number;
}

export interface TrafficNetwork {
  readonly lines: readonly RoadLine[];
  readonly junctions: readonly TrafficJunction[];
  readonly paths: readonly TrafficPath[];
}

const cache = new WeakMap<Terrain, TrafficNetwork>();

/** The terrain's traffic network (built once per terrain). */
export function trafficNetwork(terrain: Terrain): TrafficNetwork {
  let net = cache.get(terrain);
  if (!net) {
    net = buildTrafficNetwork(terrain);
    cache.set(terrain, net);
  }
  return net;
}

/** Lane offset (m) from the centreline of a road this wide. */
export const laneOffset = (width: number): number =>
  Math.min(N.laneMax, Math.max(N.laneMin, width * N.laneShare));

interface PathDraft {
  kind: PathKind;
  xs: number[];
  zs: number[];
  line: number;
  junction: number;
  leg: number;
  speed: number;
  out: number;
}

export function buildTrafficNetwork(terrain: Terrain): TrafficNetwork {
  // The authored roads and streets, and the streets road bridges carry over their decks.
  const lines = trafficLines(terrain);
  const raw = roadJunctions(lines);
  const drafts: PathDraft[] = [];
  const course = terrain.course;

  /** World centreline point of a line at arc (course units). */
  const centre = (line: RoadLine, arc: number): { x: number; z: number } => {
    const p = locate(line.poly, arc);
    const w = course.toWorld(p.s, p.d);
    return { x: w.x, z: w.z };
  };

  const junctions: TrafficJunction[] = raw.map((j, id) => {
    let wide = 0;
    for (const m of j.at) wide = Math.max(wide, lines[m.line].width);
    const w = course.toWorld(j.s, j.d);
    return {
      id,
      x: w.x,
      z: w.z,
      radius: wide / 2 + N.junctionMargin,
      legs: [],
      signalised: false,
      groups: 0,
      greens: [],
      cycle: 0,
      offset: 0,
    };
  });

  /** Lane along `line` from arc a to arc b (either order), offset to the right of travel. */
  const lane = (li: number, a: number, b: number, end: number, leg: number): number => {
    const line = lines[li];
    const off = laneOffset(line.width);
    const len = Math.abs(b - a);
    const n = Math.max(2, Math.ceil(len / N.sampleStep) + 1);
    const cx: number[] = [];
    const cz: number[] = [];
    for (let i = 0; i < n; i++) {
      const c = centre(line, a + ((b - a) * i) / (n - 1));
      cx.push(c.x);
      cz.push(c.z);
    }
    const xs: number[] = [];
    const zs: number[] = [];
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(n - 1, i + 1);
      let dx = cx[i1] - cx[i0];
      let dz = cz[i1] - cz[i0];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      // Right of travel (dx, dz) is (-dz, dx).
      xs.push(cx[i] - dz * off);
      zs.push(cz[i] + dx * off);
    }
    drafts.push({ kind: 'lane', xs, zs, line: li, junction: end, leg, speed: line.speed, out: -1 });
    return drafts.length - 1;
  };

  const deadEnds: { inLane: number; outLane: number }[] = [];

  lines.forEach((line, li) => {
    if (!carriesTraffic(line)) return;
    const L = line.poly.length;
    // Nodes along the line: junction arcs, plus the ends unless a junction sits there.
    const nodes: { arc: number; junction: number }[] = [];
    junctions.forEach((J, ji) => {
      for (const m of raw[ji].at) if (m.line === li) nodes.push({ arc: m.arc, junction: J.id });
    });
    nodes.sort((p, q) => p.arc - q.arc);
    if (!(nodes.length > 0 && nodes[0].arc < ROAD_RULES.legMin)) nodes.unshift({ arc: 0, junction: -1 });
    const last = nodes[nodes.length - 1];
    if (!(last.junction >= 0 && last.arc > L - ROAD_RULES.legMin)) nodes.push({ arc: L, junction: -1 });
    for (let k = 0; k + 1 < nodes.length; k++) {
      const A = nodes[k];
      const B = nodes[k + 1];
      const ta = A.junction >= 0 ? junctions[A.junction].radius : N.deadEndMargin;
      const tb = B.junction >= 0 ? junctions[B.junction].radius : N.deadEndMargin;
      const a = A.arc + ta;
      const b = B.arc - tb;
      if (b - a < N.minLane) continue;
      // (Which leg each lane ends on is filled in once every leg is known, below.)
      const fwd = lane(li, a, b, B.junction, -1);
      const bwd = lane(li, b, a, A.junction, -1);
      const dirAt = (arc: number, toward: number): { x: number; z: number } => {
        const c0 = centre(line, arc);
        const c1 = centre(line, toward);
        const l = Math.hypot(c1.x - c0.x, c1.z - c0.z) || 1;
        return { x: (c1.x - c0.x) / l, z: (c1.z - c0.z) / l };
      };
      if (B.junction >= 0) {
        const dir = dirAt(B.arc, Math.max(0, B.arc - 5));
        junctions[B.junction].legs.push({
          line: li,
          arc: B.arc,
          sign: -1,
          dirX: dir.x,
          dirZ: dir.z,
          group: -1,
          inLane: fwd,
          outLane: bwd,
        });
      } else deadEnds.push({ inLane: fwd, outLane: bwd });
      if (A.junction >= 0) {
        const dir = dirAt(A.arc, Math.min(L, A.arc + 5));
        junctions[A.junction].legs.push({
          line: li,
          arc: A.arc,
          sign: 1,
          dirX: dir.x,
          dirZ: dir.z,
          group: -1,
          inLane: bwd,
          outLane: fwd,
        });
      } else deadEnds.push({ inLane: bwd, outLane: fwd });
    }
  });

  // Lanes record which leg they end on (legs were pushed in the order the lanes were built).
  for (const J of junctions) {
    J.legs.forEach((leg, i) => {
      const d = drafts[leg.inLane];
      d.leg = i;
    });
  }

  const succ: number[][] = drafts.map(() => []);
  const weights: number[][] = drafts.map(() => []);
  const turnOf: { junction: number; from: number; to: number }[] = [];

  const addTurn = (J: TrafficJunction, inLane: number, outLane: number): void => {
    const a = drafts[inLane];
    const b = drafts[outLane];
    const n0 = a.xs.length - 1;
    const p0x = a.xs[n0];
    const p0z = a.zs[n0];
    const t0 = unit(a.xs[n0] - a.xs[n0 - 1], a.zs[n0] - a.zs[n0 - 1]);
    const p3x = b.xs[0];
    const p3z = b.zs[0];
    const t3 = unit(b.xs[1] - b.xs[0], b.zs[1] - b.zs[0]);
    const k = Math.max(1, 0.4 * Math.hypot(p3x - p0x, p3z - p0z));
    const xs: number[] = [];
    const zs: number[] = [];
    const segs = 12;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const u = 1 - t;
      const b0 = u * u * u;
      const b1 = 3 * u * u * t;
      const b2 = 3 * u * t * t;
      const b3 = t * t * t;
      xs.push(b0 * p0x + b1 * (p0x + t0.x * k) + b2 * (p3x - t3.x * k) + b3 * p3x);
      zs.push(b0 * p0z + b1 * (p0z + t0.z * k) + b2 * (p3z - t3.z * k) + b3 * p3z);
    }
    const speed = Math.min(lines[b.line].speed, turnSpeed(xs, zs));
    drafts.push({ kind: 'turn', xs, zs, line: b.line, junction: J.id, leg: -1, speed, out: outLane });
    const id = drafts.length - 1;
    succ.push([outLane]);
    weights.push([1]);
    turnOf[id] = { junction: J.id, from: inLane, to: outLane };
    // Weight by the turn's angle: straight on, right, left.
    const cross = t0.x * t3.z - t0.z * t3.x;
    const angle = Math.atan2(cross, t0.x * t3.x + t0.z * t3.z);
    // Right of (dx, dz) is (-dz, dx): a right turn has t3 on that side, i.e. cross < 0.
    const w = Math.abs(angle) < N.straightAngle ? N.straightWeight : cross < 0 ? N.rightWeight : N.leftWeight;
    succ[inLane].push(id);
    weights[inLane].push(w);
  };

  const addUturn = (inLane: number, outLane: number): void => {
    const a = drafts[inLane];
    const b = drafts[outLane];
    const n0 = a.xs.length - 1;
    const p0x = a.xs[n0];
    const p0z = a.zs[n0];
    const t0 = unit(a.xs[n0] - a.xs[n0 - 1], a.zs[n0] - a.zs[n0 - 1]);
    const cx = (p0x + b.xs[0]) / 2;
    const cz = (p0z + b.zs[0]) / 2;
    const r = Math.max(0.5, Math.hypot(b.xs[0] - p0x, b.zs[0] - p0z) / 2);
    const ux = (p0x - cx) / r;
    const uz = (p0z - cz) / r;
    const xs: number[] = [];
    const zs: number[] = [];
    const segs = 10;
    for (let i = 0; i <= segs; i++) {
      const phi = (Math.PI * i) / segs;
      xs.push(cx + r * (Math.cos(phi) * ux + Math.sin(phi) * t0.x));
      zs.push(cz + r * (Math.cos(phi) * uz + Math.sin(phi) * t0.z));
    }
    const speed = Math.max(N.minTurnSpeed, Math.sqrt(N.turnLatAccel * r));
    drafts.push({ kind: 'uturn', xs, zs, line: b.line, junction: -1, leg: -1, speed, out: outLane });
    const id = drafts.length - 1;
    succ.push([outLane]);
    weights.push([1]);
    succ[inLane].push(id);
    weights[inLane].push(1);
  };

  for (const J of junctions) {
    for (const from of J.legs) {
      if (from.inLane < 0) continue;
      let any = false;
      for (const to of J.legs) {
        if (to === from || to.outLane < 0) continue;
        addTurn(J, from.inLane, to.outLane);
        any = true;
      }
      if (!any && from.outLane >= 0) addUturn(from.inLane, from.outLane);
    }
  }
  // Lights at the most important junctions first; none closer than signalSpacing to another.
  const ranked = junctions
    .map((J) => ({ J, score: signalScore(J, lines) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.J.id - b.J.id);
  const lit: TrafficJunction[] = [];
  for (const { J, score } of ranked) {
    const crowded = lit.some((o) => Math.hypot(o.x - J.x, o.z - J.z) < N.signalSpacing);
    if (crowded && score !== Infinity) continue;
    if (assignSignals(J, lines)) lit.push(J);
  }
  for (const e of deadEnds) addUturn(e.inLane, e.outLane);

  // Conflicts between turns of one junction from different incoming lanes.
  const conflicts: number[][] = drafts.map(() => []);
  for (const J of junctions) {
    const turns = turnOf.flatMap((t, id) => (t && t.junction === J.id ? [id] : []));
    for (let i = 0; i < turns.length; i++) {
      for (let j = i + 1; j < turns.length; j++) {
        const a = turns[i];
        const b = turns[j];
        if (turnOf[a].from === turnOf[b].from) continue;
        if (turnOf[a].to === turnOf[b].to || pathsMeet(drafts[a], drafts[b], N.conflictDistance)) {
          conflicts[a].push(b);
          conflicts[b].push(a);
        }
      }
    }
  }

  const paths: TrafficPath[] = drafts.map((d, id) => {
    const n = d.xs.length;
    const arc = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      arc[i] = arc[i - 1] + Math.hypot(d.xs[i] - d.xs[i - 1], d.zs[i] - d.zs[i - 1]);
    }
    return {
      id,
      kind: d.kind,
      xs: Float64Array.from(d.xs),
      zs: Float64Array.from(d.zs),
      arc,
      length: arc[n - 1],
      line: d.line,
      junction: d.junction,
      leg: d.leg,
      succ: succ[id],
      weights: weights[id],
      speed: d.speed,
      conflicts: conflicts[id],
      out: d.out,
    };
  });
  return { lines, junctions, paths };
}

function unit(x: number, z: number): { x: number; z: number } {
  const l = Math.hypot(x, z) || 1;
  return { x: x / l, z: z / l };
}

/** Speed (m/s) a turn along these samples allows: sqrt(lateral accel × tightest radius). */
function turnSpeed(xs: readonly number[], zs: readonly number[]): number {
  let rMin = Infinity;
  for (let i = 1; i + 1 < xs.length; i++) {
    const ax = xs[i] - xs[i - 1];
    const az = zs[i] - zs[i - 1];
    const bx = xs[i + 1] - xs[i];
    const bz = zs[i + 1] - zs[i];
    const la = Math.hypot(ax, az);
    const lb = Math.hypot(bx, bz);
    if (la < 1e-6 || lb < 1e-6) continue;
    const turn = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
    if (turn > 1e-6) rMin = Math.min(rMin, (la + lb) / 2 / turn);
  }
  return Math.max(N.minTurnSpeed, Math.sqrt(N.turnLatAccel * rMin));
}

/** True if two sampled paths come within `dist` m of each other (segment midpoints included). */
function pathsMeet(a: PathDraft, b: PathDraft, dist: number): boolean {
  const d2 = dist * dist;
  for (let i = 0; i < a.xs.length * 2 - 1; i++) {
    const ax = i % 2 === 0 ? a.xs[i / 2] : (a.xs[(i - 1) / 2] + a.xs[(i + 1) / 2]) / 2;
    const az = i % 2 === 0 ? a.zs[i / 2] : (a.zs[(i - 1) / 2] + a.zs[(i + 1) / 2]) / 2;
    for (let j = 0; j < b.xs.length * 2 - 1; j++) {
      const bx = j % 2 === 0 ? b.xs[j / 2] : (b.xs[(j - 1) / 2] + b.xs[(j + 1) / 2]) / 2;
      const bz = j % 2 === 0 ? b.zs[j / 2] : (b.zs[(j - 1) / 2] + b.zs[(j + 1) / 2]) / 2;
      const dx = ax - bx;
      const dz = az - bz;
      if (dx * dx + dz * dz < d2) return true;
    }
  }
  return false;
}

/**
 * How much a junction wants traffic lights: 0 = none (fewer than 3 legs, a gravel road, or a street
 * with signals: false), Infinity = forced (signals: true), else legs × 100 + the widths of its roads
 * (busier crossroads first).
 */
function signalScore(J: TrafficJunction, lines: readonly RoadLine[]): number {
  if (J.legs.length < 3) return 0;
  const members = [...new Set(J.legs.map((l) => l.line))].map((i) => lines[i]);
  const forced = members.map((l) => l.signals).filter((v) => v !== undefined);
  if (forced.includes(true)) return Infinity;
  if (forced.includes(false) || !members.every((l) => l.surface === 'asphalt')) return 0;
  return J.legs.length * 100 + members.reduce((a, l) => a + l.width, 0);
}

/**
 * Signal phases of a junction (see the header): which legs share a phase, timing and offset.
 * False if its legs make a single phase (nothing to alternate).
 */
function assignSignals(J: TrafficJunction, lines: readonly RoadLine[]): boolean {
  // Widest road first, then by direction: the first phase is the main road's pair of legs.
  const order = J.legs
    .map((leg, i) => ({ leg, i }))
    .sort(
      (p, q) =>
        lines[q.leg.line].width - lines[p.leg.line].width ||
        Math.atan2(p.leg.dirX, p.leg.dirZ) - Math.atan2(q.leg.dirX, q.leg.dirZ),
    );
  let groups = 0;
  const cosOpp = -Math.cos(N.oppositeAngle);
  for (const { leg } of order) {
    if (leg.group >= 0) continue;
    leg.group = groups;
    for (const { leg: other } of order) {
      if (other.group >= 0) continue;
      if (leg.dirX * other.dirX + leg.dirZ * other.dirZ <= cosOpp) {
        other.group = groups;
        break;
      }
    }
    groups++;
  }
  if (groups < 2) {
    for (const leg of J.legs) leg.group = -1;
    return false;
  }
  J.signalised = true;
  J.groups = groups;
  J.greens = Array.from({ length: groups }, (_, g) => (g === 0 ? N.green : N.minorGreen));
  J.cycle = J.greens.reduce((a, g) => a + g + N.amber + N.allRed, 0);
  // Deterministic offset from the junction's position, so neighbouring lights are not in step.
  const h =
    Math.imul(Math.round(J.x * 10) ^ 0x2545f491, 0x9e3779b1) ^ Math.imul(Math.round(J.z * 10), 0x85ebca6b);
  J.offset = ((h >>> 0) / 4294967296) * J.cycle;
  return true;
}

/**
 * The lane nearest to world (x, z) within `maxDist` m whose direction agrees with the heading
 * (hx, hz) (any direction when both are 0): its path id and arc there, or null.
 */
export function nearestLane(
  net: TrafficNetwork,
  x: number,
  z: number,
  hx: number,
  hz: number,
  maxDist: number,
): { path: number; arc: number; dist: number } | null {
  let best: { path: number; arc: number; dist: number } | null = null;
  let bestScore = Infinity;
  for (const p of net.paths) {
    if (p.kind !== 'lane') continue;
    for (let i = 0; i + 1 < p.xs.length; i++) {
      const ax = p.xs[i];
      const az = p.zs[i];
      const ex = p.xs[i + 1] - ax;
      const ez = p.zs[i + 1] - az;
      const l2 = ex * ex + ez * ez;
      if (l2 < 1e-12) continue;
      const t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / l2));
      const dist = Math.hypot(ax + ex * t - x, az + ez * t - z);
      if (dist > maxDist) continue;
      const along = hx * ex + hz * ez;
      const score = dist + (hx === 0 && hz === 0 ? 0 : along < 0 ? 1000 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = { path: p.id, arc: p.arc[i] + Math.sqrt(l2) * t, dist };
      }
    }
  }
  if (best && bestScore >= 1000) {
    // Only lanes the other way round: take the nearest anyway (the vehicle turns into it).
    best = nearestLane(net, x, z, 0, 0, maxDist);
  }
  return best;
}
