import type { StructureContext } from './kit';

/**
 * Bridge decks that connect (roadBridge, footbridge): where a deck runs, how high it is and what
 * holds it. Pure, on the structure frame (local x along the span, nominal metres, heights relative
 * to the ground at the placement), so the builds (./roadBridge.ts, ./footbridge.ts) and the world
 * logic check (src/core/obstacles/bridges.ts, src/core/terrain/logic.ts) see the same deck.
 *
 * Plans read the ground as the level made it (StructureContext.ungradedAt / uncutAt), before the
 * approach cuttings (src/core/terrain/bridgeCuts.ts) graded the banks: the cuttings are made
 * against the plans, so a plan made afterwards is the same plan.
 *
 * A bridge carries its road (or path) from ground to ground. Three modes:
 * - 'rims' (a span that stays inside the floor): each end of the running surface sits on the
 *   ground there — the rim of the gorge, ravine, stream or cutting it crosses (a ravine's cut is
 *   ignored: its rim height) — and the deck runs straight from one to the other, ramped when they
 *   differ. Near each end, where the bank still stands above the deck's underside, an ABUTMENT
 *   (anchored, buried in the bank, the road on top) carries the road; the girder starts where the
 *   ground falls away below it, and piers stand in between. A rim that crosses the deck obliquely
 *   (a road meeting a gorge at an angle) SKEWS that end: the girder end runs along the rim
 *   (x = support.x + skew · z), clear of the ground on every line across the deck (lines no more
 *   than R.lineStep apart, so no bank between them is missed), and the abutment's block stops at
 *   the bank edge measured on those lines (DeckSupport.bank), so on a curved or ragged rim no part
 *   of it stands out over the drop where the straight girder end does (road decks only; a
 *   footbridge is narrow enough to stay square). A rim that crosses a deck edge line beyond the
 *   end of the span leaves that corner of the running surface over the gap (DeckPlan.rimOver; the
 *   logic check fails it: the span must reach tan(angle) · width / 2 past the rim).
 * - 'walls' (a span reaching the floor edge at both ends: the wall-to-wall idiom of the narrow
 *   valleys): the deck is level, `clearance` above the highest floor ground under the span (the
 *   iceberg passes under it as before, the floor piers stay where they were), and each end runs on
 *   into the valley wall to where the wall has risen to the deck, an abutment there.
 * - 'floating' (a 'rims' span over nothing: no ground falls away under the line between its ends):
 *   the old build, a level deck `clearance` above the highest ground on piers at both ends. Its ends
 *   hang in the air; validateWorldLogic fails it.
 */

export interface DeckSpec {
  /** Running surface above the deck's underside, perpendicular to the deck (m). */
  readonly depth: number;
  /** Deck width across the span (m). */
  readonly width: number;
  /** Underside above the highest ground under a 'walls' / 'floating' deck (m). */
  readonly clearance: number;
  /** Target and longest bay between supports (m). */
  readonly bay: number;
  readonly maxBay: number;
  /** Steepest grade (rise / run) between the ends that the logic check accepts. */
  readonly maxGrade: number;
  /** Abutment: seat under the deck end, and how far it reaches back under the approach (m). */
  readonly seat: number;
  readonly back: number;
  /** Whether an end may be skewed along a rim that crosses the deck obliquely. */
  readonly skew: boolean;
}

/** The highway bridge (./roadBridge.ts). */
export const ROAD_DECK: DeckSpec = {
  depth: 1.4,
  width: 10.5,
  clearance: 8,
  bay: 20,
  maxBay: 24,
  maxGrade: 0.15,
  seat: 1.2,
  back: 2.5,
  skew: true,
};

/** The timber footbridge (./footbridge.ts). */
export const FOOT_DECK: DeckSpec = {
  depth: 0.22,
  width: 2.2,
  clearance: 4.6,
  bay: 8,
  maxBay: 12,
  maxGrade: 0.2,
  seat: 0.6,
  back: 1.2,
  skew: false,
};

export const DECK_RULES = {
  /** The running surface sits this far (m) above the ground at its ends (over the joint). */
  lift: 0.04,
  /** The girder starts where the ground under it is this far (m) below its underside. */
  free: 0.05,
  /** A 'rims' deck needs a girder at least this long (m) clear of the ground, else 'floating'. */
  minGirder: 2,
  /** Both nominal ends within this (world m) of the floor edge, or beyond it: a 'walls' bridge. */
  wallReach: 2,
  /** A 'walls' end runs at most this far (nominal m) into the wall looking for the deck height. */
  wallSearch: 40,
  /** Sample step (nominal m) along the span. */
  step: 0.25,
  /** A 'walls' approach bay shorter than this (m) merges into the floor bay next to it. */
  minApproach: 1.5,
  /** A rim crossing a skew deck this obliquely (rad, 5°) or more skews that end. */
  skewMin: (5 * Math.PI) / 180,
  /** Skews are capped at this (rad, 45°); validateWorldLogic fails a rim more oblique than it. */
  skewMax: Math.PI / 4,
  /**
   * A rim's angle is measured on the deck's two edge lines where the ground has fallen this far (m)
   * below the underside; a shallow crossing that never falls that far, where the girder clears it.
   */
  skewDrop: 1,
  /** Lines across the deck an abutment's block is shaped on (both edges and between). */
  skewLines: 9,
  /**
   * The girder end clears the ground on lines across the deck at most this far apart (nominal m),
   * the same as the sample step along it, so no bank between two lines is missed.
   */
  lineStep: 0.25,
  /**
   * Where a deck edge line is already over the gap at the end of the span, its rim is looked for
   * this many deck half-widths back beyond the end (a rim up to atan(2) ≈ 63° off square).
   */
  rimReach: 2,
} as const;

const R = DECK_RULES;

export type DeckMode = 'rims' | 'walls' | 'floating';

export interface DeckSupport {
  /** Local x where the deck ends rest. */
  readonly x: number;
  /** 'abutment': an end block buried in the bank; 'pier': a pier / post standing on the ground. */
  readonly type: 'abutment' | 'pier';
  /**
   * Plan skew of the support line (local dx / dz): it runs through (x + skew · z, z) across the
   * deck. 0 (square) for piers and for every support of an unskewed deck.
   */
  readonly skew: number;
  /**
   * A 'rims' abutment: the bank edge on each line across the deck ([z, x], local, z from −width/2
   * to width/2, R.lineStep apart at most), where the ground first falls `free` below the underside
   * going from the end inward. The girder end (the support line) lies on or beyond every one of
   * them; the abutment's block stops at them.
   */
  readonly bank?: readonly (readonly [number, number])[];
}

export interface DeckPlan {
  readonly mode: DeckMode;
  /** Ends of the running surface (local x, x0 < x1) and its height there (relative, nominal m). */
  readonly x0: number;
  readonly x1: number;
  readonly top0: number;
  readonly top1: number;
  /** Supports from x0's end to x1's (increasing x); a deck segment spans each neighbouring pair. */
  readonly supports: readonly DeckSupport[];
  /**
   * How obliquely the rims cross the deck at the x0 and x1 ends (rad, unsigned, before the
   * skewMax cap): 0 where the rim is square to it or is not measured ('walls', 'floating').
   */
  readonly rimSkew: readonly [number, number];
  /**
   * How far (nominal m) the rim lies beyond the x0 and x1 ends on the deck's edge lines: that
   * corner of the running surface stands out over the gap (0: the rim is inside the span on both
   * edges, or not measured).
   */
  readonly rimOver: readonly [number, number];
}

/**
 * What planDeck reads from the structure context: the ground before the bridge approach cuttings
 * (ungradedAt, and uncutAt for a ravine's rim), never the graded ground.
 */
export type DeckContext = Pick<StructureContext, 'span' | 'ungradedAt' | 'uncutAt' | 'beyondFloor'>;

/** Running-surface height at local x (relative, nominal m; straight between the ends). */
export const deckTopAt = (p: DeckPlan, x: number): number =>
  p.x1 > p.x0 ? p.top0 + ((p.top1 - p.top0) * (x - p.x0)) / (p.x1 - p.x0) : p.top0;

/** Grade of the running surface (rise / run along +x). */
export const deckGrade = (p: DeckPlan): number => (p.x1 > p.x0 ? (p.top1 - p.top0) / (p.x1 - p.x0) : 0);

/** Number of bays over a girder `length` m long. */
export const deckBays = (spec: DeckSpec, length: number): number =>
  Math.max(1, Math.round(length / spec.bay), Math.ceil(length / spec.maxBay));

/** Highest ground across the deck's width at local x (before the approach cuttings). */
function across(spec: DeckSpec, ctx: DeckContext, x: number): number {
  const w = spec.width / 2;
  return Math.max(ctx.ungradedAt(x, -w), ctx.ungradedAt(x, 0), ctx.ungradedAt(x, w));
}

/**
 * First x from `from` toward `to` where the ground across the deck lies `free` m below the
 * underside (`soffit(x)`), or NaN when it never does ('walls' ends).
 */
function bankEdge(
  spec: DeckSpec,
  ctx: DeckContext,
  from: number,
  to: number,
  soffit: (x: number) => number,
): number {
  const n = Math.max(1, Math.ceil(Math.abs(to - from) / R.step));
  for (let i = 0; i <= n; i++) {
    const x = from + ((to - from) * i) / n;
    if (across(spec, ctx, x) <= soffit(x) - R.free) return x;
  }
  return NaN;
}

/**
 * Where the ground on the line z across the deck first falls to `below` m under the underside
 * going from `from` toward `to` (or, with `rise`, first climbs back above that), interpolated
 * between the last sample on one side and the first on the other, so the crossing moves smoothly
 * with the ground rather than in R.step jumps. `from` itself when the ground there is already on
 * the far side; NaN when it never crosses.
 */
function lineCross(
  ctx: DeckContext,
  z: number,
  from: number,
  to: number,
  soffit: (x: number) => number,
  below: number,
  rise = false,
): number {
  const n = Math.max(1, Math.ceil(Math.abs(to - from) / R.step));
  let px = from;
  let pf = NaN;
  for (let i = 0; i <= n; i++) {
    const x = from + ((to - from) * i) / n;
    // f > 0: still on the near side (above the threshold falling, below it rising).
    const h = ctx.ungradedAt(x, z) - (soffit(x) - below);
    const f = rise ? -h : h;
    if (f <= 0) return i === 0 ? x : px + ((x - px) * pf) / (pf - f || 1);
    px = x;
    pf = f;
  }
  return NaN;
}

/** One end of a 'rims' deck at its rim (rimEnd). */
interface RimEnd {
  /** Support line through (x + skew · z, z): the girder end. */
  readonly x: number;
  readonly skew: number;
  /** How obliquely the rim crosses the deck (rad, unsigned; 0 when not measured). */
  readonly angle: number;
  /** Bank edge per line across the deck ([z, x]; DeckSupport.bank). */
  readonly bank: readonly (readonly [number, number])[];
  /** How far (nominal m) the rim lies beyond the end on the deck's edge lines (DeckPlan.rimOver). */
  readonly over: number;
}

/**
 * The girder end at the rim met going from `from` (the end of the span) toward `to`: a line
 * x + skew · z across the deck that keeps the girder `free` clear of the ground on every line
 * across the deck (no more than R.lineStep apart), skewed along the rim when it crosses the deck
 * at skewMin or more. The rim's angle is measured on the two edge lines where the ground has
 * fallen skewDrop below the underside (or, on a crossing too shallow for that, where the girder
 * clears it); where an edge line is already over the gap at the end, its rim is looked for back
 * beyond the end, so the angle is still measured and `over` says how far the deck edge reaches
 * out over the gap. Null when some line never clears (no rim: not a 'rims' deck).
 */
function rimEnd(
  spec: DeckSpec,
  ctx: DeckContext,
  from: number,
  to: number,
  soffit: (x: number) => number,
): RimEnd | null {
  const w = spec.width / 2;
  const dir = Math.sign(to - from);
  // At the low end of a ramped deck its end face (square to the deck) leans back over the bank by
  // up to depth · sin(tilt), rising 1 / tan(tilt) m per metre back: against a rim wall steeper than
  // that, the girder end moves out until the wall is clear of the face too (else the end is built
  // into the rim, and the physics pops the deck up off its seats).
  const grade = soffit(1) - soffit(0);
  const lean = grade * dir > 0 ? spec.depth * Math.sin(Math.atan(Math.abs(grade))) : 0;
  const faceClear = (x: number, z: number): boolean => {
    for (let k = 1; k <= 4; k++) {
      const d = (lean * k) / 4;
      if (ctx.ungradedAt(x - dir * d, z) > soffit(x) + d / Math.abs(grade) - R.free) return false;
    }
    return true;
  };
  const n = Math.max(R.skewLines, Math.ceil((2 * w) / R.lineStep) + 1);
  const bank: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const z = -w + (2 * w * i) / (n - 1);
    let e = lineCross(ctx, z, from, to, soffit, R.free);
    if (Number.isNaN(e)) return null;
    for (let k = 0; lean > 0 && k < 40 && !faceClear(e, z); k++) e += (dir * R.step) / 4;
    bank.push([z, e]);
  }
  const beyond = from - dir * R.rimReach * w;
  /**
   * The rim on the edge line z (`below` the underside), looked for back beyond the end too (at
   * least `beyond` when it is not found there either).
   */
  const edge = (z: number, below: number): number => {
    const x = lineCross(ctx, z, from, to, soffit, below);
    if (x !== from) return x;
    const back = lineCross(ctx, z, from, beyond, soffit, below, true);
    return Number.isNaN(back) ? beyond : back;
  };
  let a = edge(-w, R.skewDrop);
  let b = edge(w, R.skewDrop);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    a = edge(-w, R.free);
    b = edge(w, R.free);
  }
  const measured = !Number.isNaN(a) && !Number.isNaN(b);
  const angle = measured ? Math.abs(Math.atan((b - a) / (2 * w))) : 0;
  const over = measured ? Math.max(0, (from - a) * dir, (from - b) * dir) : 0;
  const skew = spec.skew && angle >= R.skewMin ? Math.sign(b - a) * Math.tan(Math.min(angle, R.skewMax)) : 0;
  // Clear of the ground on every line: the last (going from `from`) of edge − skew · z.
  let x = NaN;
  for (const [z, e] of bank) {
    const at = e - skew * z;
    if (Number.isNaN(x) || (at - x) * dir > 0) x = at;
  }
  return { x, skew, angle, bank, over };
}

/** Where the deck runs, how high, and what holds it (see the module comment for the modes). */
export function planDeck(spec: DeckSpec, ctx: DeckContext): DeckPlan {
  const half = ctx.span / 2;
  const walls = ctx.beyondFloor(-half, 0) >= -R.wallReach && ctx.beyondFloor(half, 0) >= -R.wallReach;
  if (!walls) {
    const rims = rimsPlan(spec, ctx, half);
    if (rims) return rims;
  }
  return levelPlan(spec, ctx, half, walls);
}

function rimsPlan(spec: DeckSpec, ctx: DeckContext, half: number): DeckPlan | null {
  const top0 = ctx.uncutAt(-half, 0) + R.lift;
  const top1 = ctx.uncutAt(half, 0) + R.lift;
  const grade = (top1 - top0) / (2 * half);
  const drop = spec.depth * Math.sqrt(1 + grade * grade);
  const soffit = (x: number): number => top0 + grade * (x + half) - drop;
  const e0 = rimEnd(spec, ctx, -half, half, soffit);
  const e1 = rimEnd(spec, ctx, half, -half, soffit);
  if (!e0 || !e1) return null;
  const w = spec.width / 2;
  const g0 = e0.x;
  const g1 = e1.x;
  // The girder is at least minGirder long on its centre line and along both edges.
  for (const z of [-w, 0, w]) {
    if (!(g1 + e1.skew * z - (g0 + e0.skew * z) >= R.minGirder)) return null;
  }
  const n = deckBays(spec, g1 - g0);
  const supports: DeckSupport[] = [{ x: g0, type: 'abutment', skew: e0.skew, bank: e0.bank }];
  for (let i = 1; i < n; i++) {
    supports.push({ x: g0 + ((g1 - g0) * i) / n, type: 'pier', skew: 0 });
  }
  supports.push({ x: g1, type: 'abutment', skew: e1.skew, bank: e1.bank });
  return {
    mode: 'rims',
    x0: -half,
    x1: half,
    top0,
    top1,
    supports,
    rimSkew: [e0.angle, e1.angle],
    rimOver: [e0.over, e1.over],
  };
}

/** A level deck `clearance` above the highest ground under the span ('walls' and 'floating'). */
function levelPlan(spec: DeckSpec, ctx: DeckContext, half: number, walls: boolean): DeckPlan {
  let high = -Infinity;
  const m = Math.max(1, Math.ceil(2 * half));
  for (let i = 0; i <= m; i++) high = Math.max(high, across(spec, ctx, -half + (2 * half * i) / m));
  const soffit = high + spec.clearance;
  const top = soffit + spec.depth;
  const n = deckBays(spec, 2 * half);
  const supports: DeckSupport[] = [];
  for (let i = 0; i <= n; i++) {
    supports.push({ x: -half + (2 * half * i) / n, type: 'pier', skew: 0 });
  }
  let x0 = -half;
  let x1 = half;
  if (walls) {
    for (const side of [-1, 1] as const) {
      const end = wallEnd(ctx, side * half, side, top);
      if (Number.isNaN(end)) continue;
      const g = bankEdge(spec, ctx, end, side * half, () => soffit);
      if (Number.isNaN(g)) continue;
      const abutment: DeckSupport = { x: g, type: 'abutment', skew: 0 };
      const short = Math.abs(side * half - g) < R.minApproach;
      if (side < 0) {
        x0 = end;
        if (short) supports[0] = abutment;
        else supports.unshift(abutment);
      } else {
        x1 = end;
        if (short) supports[supports.length - 1] = abutment;
        else supports.push(abutment);
      }
    }
  }
  return {
    mode: walls ? 'walls' : 'floating',
    x0,
    x1,
    top0: top,
    top1: top,
    supports,
    rimSkew: [0, 0],
    rimOver: [0, 0],
  };
}

/** Where the wall beyond `from` (going `side`) rises to `top` − lift (interpolated), or NaN. */
function wallEnd(ctx: DeckContext, from: number, side: -1 | 1, top: number): number {
  const want = top - R.lift;
  let prevX = from;
  let prevH = ctx.uncutAt(from, 0);
  if (prevH >= want) return from;
  const n = Math.ceil(R.wallSearch / R.step);
  for (let i = 1; i <= n; i++) {
    const x = from + side * i * R.step;
    const h = ctx.uncutAt(x, 0);
    if (h >= want) return prevX + ((x - prevX) * (want - prevH)) / (h - prevH || 1);
    prevX = x;
    prevH = h;
  }
  return NaN;
}

/** A deck segment: centre (local x) and length along the deck on its centre line (z = 0). */
export interface DeckSegment {
  readonly x: number;
  readonly length: number;
  /** Plan skew of its x0 and x1 ends (their supports'): an end runs along x + skew · z. */
  readonly skew0: number;
  readonly skew1: number;
}

/**
 * The deck segments, one per neighbouring pair of supports: centre (local x) and length along the
 * deck on the centre line, and the skew of their ends (the builds keep a further 1 cm clear at
 * each end). On a bridge with abutments the joints
 * over piers open wider, depth² / (2 · (length − seat)) + 1 cm per side: a deck hinging down off a
 * knocked-out pier swings its top corner toward its neighbour by up to that much, and two decks
 * that touched there would lock into an arch braced against the abutments (or the bank behind
 * them) and never fall.
 */
export function deckSegments(spec: DeckSpec, plan: DeckPlan): DeckSegment[] {
  const grade = deckGrade(plan);
  const cos = 1 / Math.sqrt(1 + grade * grade);
  const sup = plan.supports;
  const braced = sup.some((s) => s.type === 'abutment');
  const out: DeckSegment[] = [];
  for (let i = 0; i + 1 < sup.length; i++) {
    const a = sup[i];
    const b = sup[i + 1];
    const axis = (b.x - a.x) / cos;
    const open = braced ? spec.depth ** 2 / (2 * Math.max(4, axis - spec.seat)) + 0.01 : 0;
    const ja = a.type === 'pier' ? open : 0;
    const jb = b.type === 'pier' ? open : 0;
    out.push({
      x: (a.x + b.x) / 2 + ((ja - jb) * cos) / 2,
      length: axis - ja - jb,
      skew0: a.skew,
      skew1: b.skew,
    });
  }
  return out;
}
