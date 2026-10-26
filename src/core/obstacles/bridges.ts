import type { ObstacleKind, ObstaclePlacement, Terrain } from '../types';
import { coursePolyline, polylineDistance } from '../terrain/features';
import { carriesTraffic, roadLines, ROAD_RULES, type RoadLine } from '../terrain/roads';
import { structureDef } from './structures';
import {
  DECK_RULES,
  deckGrade,
  deckTopAt,
  FOOT_DECK,
  planDeck,
  ROAD_DECK,
  type DeckMode,
  type DeckPlan,
  type DeckSpec,
} from './structures/deck';
import { structureFrame, type StructureFrame } from './structures/kit';

/**
 * Bridges in the world: every roadBridge / footbridge placement's deck (./structures/deck.ts) in
 * world and course coordinates — where its running surface meets the ground, its grade, what it
 * crosses — exactly as the structure build lays it out (same frame, same ground samples). Used by
 * the traffic network (a road bridge carries a street along its deck, laid automatically unless the
 * level authors one: bridgeDeckLines / trafficLines) and by the world logic check
 * (src/core/terrain/logic.ts).
 */

export type BridgeKind = 'roadBridge' | 'footbridge';

export const isBridgeKind = (kind: ObstacleKind): kind is BridgeKind =>
  kind === 'roadBridge' || kind === 'footbridge';

/** The deck spec of a bridge kind. */
export const bridgeDeck = (kind: BridgeKind): DeckSpec => (kind === 'roadBridge' ? ROAD_DECK : FOOT_DECK);

/** One end of a bridge's running surface, on its centre line. */
export interface BridgeEnd {
  /** World position and height of the running surface there. */
  readonly x: number;
  readonly z: number;
  readonly top: number;
  /** Terrain height under it. */
  readonly ground: number;
  /** Course coordinates. */
  readonly s: number;
  readonly d: number;
}

export interface BridgePlan {
  /** Index into level.obstacles. */
  readonly index: number;
  readonly kind: BridgeKind;
  readonly mode: DeckMode;
  readonly spec: DeckSpec;
  /** The deck in the structure frame (nominal metres, heights relative to the placement's ground). */
  readonly plan: DeckPlan;
  readonly scale: number;
  /** The x0 end and the x1 end. */
  readonly ends: readonly [BridgeEnd, BridgeEnd];
  /** Grade of the running surface (rise / run, signed along x). */
  readonly grade: number;
  /** Deepest the ground lies below the deck's underside between its girder ends (m). */
  readonly depthBelow: number;
  /** Where the ground rises most into the deck's underside between the girder ends (by > 0: it does). */
  readonly intrusion: { readonly by: number; readonly s: number; readonly d: number };
  /**
   * How obliquely the rims cross the deck (rad, the larger end; ./structures/deck.ts DeckPlan.rimSkew):
   * a road deck's ends skew along a rim up to DECK_RULES.skewMax.
   */
  readonly skew: number;
  /**
   * How far (world m) the deck's edge reaches out over the gap at the x0 and x1 ends: the rim
   * crosses an edge line beyond the end of the span (./structures/deck.ts DeckPlan.rimOver).
   */
  readonly over: readonly [number, number];
}

/** Stand-in for the placement rng: the deck plan never draws from it. */
const NO_RNG = (): number => 0.5;

/** The frame a placement is built in (as buildObstacleSpecs builds it). */
export function placementFrame(
  terrain: Terrain,
  p: ObstaclePlacement,
  index: number,
): StructureFrame | null {
  const def = structureDef(p.kind);
  if (!def) return null;
  const w = terrain.course.toWorld(p.s, p.d);
  const cs = terrain.course.sampleAt(p.s);
  return structureFrame(def, w.x, w.z, terrain, NO_RNG, {
    yaw: p.yaw,
    scale: p.scale,
    span: p.span,
    dirX: cs.dirX,
    dirZ: cs.dirZ,
    d: p.d,
    halfWidth: cs.halfWidth,
    placement: index,
  });
}

/** One bridge placement's deck in the world, or null for other kinds. */
export function bridgePlan(terrain: Terrain, p: ObstaclePlacement, index: number): BridgePlan | null {
  if (!isBridgeKind(p.kind)) return null;
  const f = placementFrame(terrain, p, index);
  if (!f) return null;
  const spec = bridgeDeck(p.kind);
  const plan = planDeck(spec, f.ctx);
  const s = f.s;
  const end = (x: number, top: number): BridgeEnd => {
    const wx = f.worldX(x, 0);
    const wz = f.worldZ(x, 0);
    const c = terrain.course.project(wx, wz);
    return { x: wx, z: wz, top: f.originY + top * s, ground: terrain.heightAt(wx, wz), s: c.s, d: c.d };
  };
  const grade = deckGrade(plan);
  const drop = spec.depth * Math.sqrt(1 + grade * grade);
  const sup = plan.supports;
  const a = sup[0];
  const b = sup[sup.length - 1];
  let depthBelow = -Infinity;
  let intrusion = { by: -Infinity, s: 0, d: 0 };
  const n = Math.max(1, Math.ceil((b.x - a.x) / 0.5));
  // On lines across the deck as close as the girder end's own (DECK_RULES.lineStep), edges included.
  const w = spec.width / 2;
  const m = Math.ceil((2 * w) / DECK_RULES.lineStep);
  const lines = Array.from({ length: m + 1 }, (_, k) => -w + (2 * w * k) / m);
  for (let i = 0; i <= n; i++) {
    for (const z of lines) {
      // Between the girder ends on this line (along the support lines of skewed ends).
      const g0 = a.x + a.skew * z;
      const x = g0 + ((b.x + b.skew * z - g0) * i) / n;
      const soffit = deckTopAt(plan, x) - drop;
      const below = soffit - f.ctx.groundAt(x, z);
      depthBelow = Math.max(depthBelow, below * s);
      if (-below * s > intrusion.by) {
        const c = terrain.course.project(f.worldX(x, z), f.worldZ(x, z));
        intrusion = { by: -below * s, s: c.s, d: c.d };
      }
    }
  }
  return {
    index,
    kind: p.kind,
    mode: plan.mode,
    spec,
    plan,
    scale: s,
    ends: [end(plan.x0, plan.top0), end(plan.x1, plan.top1)],
    grade,
    depthBelow,
    intrusion,
    skew: Math.max(...plan.rimSkew),
    over: [plan.rimOver[0] * s, plan.rimOver[1] * s],
  };
}

const PLANS = new WeakMap<Terrain, readonly BridgePlan[]>();

/** Every bridge placement's deck (cached per terrain). */
export function bridgePlans(terrain: Terrain): readonly BridgePlan[] {
  let out = PLANS.get(terrain);
  if (!out) {
    const list: BridgePlan[] = [];
    terrain.level.obstacles.forEach((p, i) => {
      const b = bridgePlan(terrain, p, i);
      if (b) list.push(b);
    });
    out = list;
    PLANS.set(terrain, out);
  }
  return out;
}

/** The street a road bridge carries along its deck (bridgeDeckLines). */
export const DECK_STREET = {
  /** Carriageway width (m, × the bridge's scale): two lanes 2 m either side of the centre line. */
  width: 8,
  /** An authored line within its half-width + this (m) of both deck ends and the middle runs over it. */
  overReach: 1,
} as const;

/**
 * The streets road bridges carry: for every road bridge whose deck reaches the ground (not
 * 'floating'), a street (carve: false: the deck is the road) from one end of its running surface
 * to the other, unless an authored road or street already runs over the deck. It joins the
 * approach roads by the usual junction rule (an end within the other line's half-width + 1.5 m),
 * so traffic arriving at a rim drives across.
 */
export function bridgeDeckLines(terrain: Terrain, authored?: readonly RoadLine[]): RoadLine[] {
  const lines = authored ?? roadLines(terrain.level);
  const out: RoadLine[] = [];
  for (const b of bridgePlans(terrain)) {
    if (b.kind !== 'roadBridge' || b.mode === 'floating') continue;
    const [e0, e1] = b.ends;
    const mid = { s: (e0.s + e1.s) / 2, d: (e0.d + e1.d) / 2 };
    const over = lines.some((l) => {
      if (!carriesTraffic(l)) return false;
      const r = l.width / 2 + DECK_STREET.overReach;
      return [e0, e1, mid].every((q) => polylineDistance(l.poly, q.s, q.d) <= r);
    });
    if (over) continue;
    const points = [
      { s: e0.s, d: e0.d },
      { s: e1.s, d: e1.d },
    ];
    out.push({
      feature: -1,
      bridge: b.index,
      type: 'street',
      points,
      poly: coursePolyline(points),
      width: DECK_STREET.width * b.scale,
      surface: 'asphalt',
      speed: ROAD_RULES.asphaltSpeed,
      signals: false,
      carve: false,
    });
  }
  return out;
}

const LINES = new WeakMap<Terrain, readonly RoadLine[]>();

/**
 * Every road-like line of the level the traffic drives: the authored roads and streets
 * (roadLines) followed by the streets the road bridges carry (bridgeDeckLines). Cached per terrain.
 */
export function trafficLines(terrain: Terrain): readonly RoadLine[] {
  let out = LINES.get(terrain);
  if (!out) {
    const authored = roadLines(terrain.level);
    out = [...authored, ...bridgeDeckLines(terrain, authored)];
    LINES.set(terrain, out);
  }
  return out;
}
