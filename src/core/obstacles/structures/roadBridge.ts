import {
  DECK_RULES,
  deckGrade,
  deckSegments,
  deckTopAt,
  planDeck,
  ROAD_DECK,
  type DeckPlan,
  type DeckSupport,
} from './deck';
import type { BodyDef, PartDef, StructureContext, StructureDef } from './kit';

/**
 * A two-lane concrete highway bridge that carries a road from ground to ground (./deck.ts plans
 * it). Spanning: across a gorge, ravine, stream or cutting the deck runs from the rim at one end
 * of `span` to the rim at the other, ramped when they differ; an ABUTMENT at each end (anchored,
 * unbreakable, buried in the bank, the road on top, passable for the iceberg like the ground)
 * carries the road out to where the deck meets the ground and holds the deck end on its seat (where
 * the rim crosses the road at an angle, the abutment's front, its seat and the girder end skew along
 * it: a trapezoid in plan, the deck a slab rather than a box girder); the
 * girder between is split into ~20 m bays with an anchored pier (a round column under a flared
 * pier head) at every inner bay end, each bay a box-girder deck segment that RESTS on its two
 * supports as a sleeping loose body; nothing joins them. A span reaching the floor edge at both
 * ends is the old wall-to-wall viaduct: a level deck DECK_CLEARANCE (8 m) above the highest floor
 * ground, so even a big iceberg (contact band 2.8 m × its size) slides underneath between piers
 * ~20 m apart, running on into the valley walls to where they rise to it. Over nothing (no ground
 * falls away under the line between its ends) it is built the old way, a level deck 8 m up on
 * piers at both ends, and validateWorldLogic fails it. Roads drive over it on a street the traffic
 * network lays along the deck (src/core/obstacles/bridges.ts). The iceberg drives over a rim-to-rim
 * bridge too: while it is on the bridge's level, the running surface (the abutments' caps and the
 * decks on their seats) is its ground and the decks are passable, like the abutments
 * (src/core/physics/deckGround.ts); under the deck, or once it slides off the side, the deck is a
 * solid body as before. Barriers, handrails, asphalt, lane markings and lamp posts are decor.
 *
 * The piers are the targets: breakSpeed 25 m/s for a 30 t iceberg (momentum rule, breakImpulse
 * 937.5 t·m/s × scale²), so a normal iceberg barely dents them while a 100 t one breaks one from
 * 7.5 m/s. A broken pier topples down-course as one body, pivoting on its loaded foot, and both
 * decks resting on it hinge down from their other pier (their middles drop 3.5 m or more). A pier is
 * solid reinforced concrete at its real density (~56 t), heavier than the deck ends it carries:
 * a light one, or one knocked at its foot, stays pinned under the decks by friction (and a wide
 * hammerhead under the deck would lock it upright, hence the narrow head). The hollow box-girder
 * decks use the dam's effective density of 0.3 t/m³, ~1.9 t per metre. Breaking a pier costs a
 * 100 t iceberg at 8 m/s ~3.6 m/s; a 30 t one needs 25 m/s and is nearly stopped. The pier falls
 * in the iceberg's path and, at 56 t, is heavy rubble for a 100 t iceberg (bulldozing, see
 * SIM_TUNING.pushWindow): measured on a 0.06 slope, 100 t at 9 m/s drops to ~1.5 m/s and creeps
 * past it, at 12 m/s to ~2.5 (on at ~4.5), at 16 m/s it carries on at ~7; 220 t at 10 m/s at ~8.
 */

const RUN = 10;
const DECK_W = ROAD_DECK.width;
const DECK_H = ROAD_DECK.depth;
/** Deck underside above the highest ground under a wall-to-wall bridge (m). */
export const DECK_CLEARANCE = ROAD_DECK.clearance;
const CONCRETE = 0.3;
/** Abutment: block width (wing walls a little wider than the deck), footing below the ground (m). */
const ABUT_W = DECK_W + 0.8;
const FOOTING = 0.8;
/** Deepest an abutment seat reaches down a sheer rim face (m). */
const SEAT_MAX = 6;
/** Box-girder cross-section area (m²) and the solid share of it (the box is hollow). */
const GIRDER_AREA = ((6.8 + DECK_W) / 2) * 1.1 + DECK_W * (DECK_H - 1.1);
const GIRDER_SOLID = 0.5;
const COL_D = 1.8;
const CAP_H = 1.2;
const CAP_X = 2.4;
const CAP_W = 2.6;
/**
 * Piers are solid reinforced concrete at its real density: a pier must outweigh the deck ends it
 * carries, or once knocked out it stays pinned under them by friction and props the decks up.
 */
const PIER_DENSITY = 2.4;
/** Below the lowest ground under the pier; shallow, or Rapier pops a freed column back up. */
const SINK = 0.06;
const BARRIER_H = 0.9;
const RAIL_Y = 0.36;

/** Box-girder cross-section (z, y) in metres: flat soffit, sloped webs, thin cantilevers. */
const GIRDER: readonly (readonly [number, number])[] = [
  [-3.4, 0],
  [3.4, 0],
  [DECK_W / 2, 1.1],
  [DECK_W / 2, DECK_H],
  [-DECK_W / 2, DECK_H],
  [-DECK_W / 2, 1.1],
];
/**
 * Pier head (z, y): flares from the column to a bearing narrower than the deck's soffit. A wide
 * hammerhead under a loaded deck acts as a rigid joint, so a knocked-out pier could never tilt.
 */
const CAP: readonly (readonly [number, number])[] = [
  [-COL_D / 2, 0],
  [COL_D / 2, 0],
  [CAP_W / 2, 0.9],
  [CAP_W / 2, CAP_H],
  [-CAP_W / 2, CAP_H],
  [-CAP_W / 2, 0.9],
];
const BARRIER: readonly (readonly [number, number])[] = [
  [-0.3, 0],
  [0.3, 0],
  [0.1, BARRIER_H],
  [-0.1, BARRIER_H],
];
/** Area of the CAP outline (m²), for its mass. */
const CAP_AREA = ((COL_D + CAP_W) / 2) * 0.9 + CAP_W * (CAP_H - 0.9);

/**
 * A long decor strip along x split into runs of at most RUN m: box half extents are compared with
 * Float32 collider points to 1e-6, which a single 30 m+ box at placement scale would miss.
 */
function runs(length: number, y: number, z: number, size: readonly [number, number],
  color: string | number, cx = 0): PartDef[] {
  const n = Math.max(1, Math.ceil(length / RUN));
  const l = length / n;
  return Array.from({ length: n }, (_, i): PartDef => ({
    shape: 'box',
    at: [cx - length / 2 + (i + 0.5) * l, y, z],
    size: [l - 0.005, size[0], size[1]],
    color,
    decor: true,
  }));
}

/**
 * A slab with the convex plan outline `pts` ([x, z], body frame, m) from y up to y + h: the girder,
 * asphalt and abutment blocks of a skewed end. Its shape id is its normalised outline, so equal
 * shapes share one geometry.
 */
function planSlab(pts: readonly (readonly [number, number])[], y: number, h: number,
  color: string | number, opts: { name?: string; decor?: boolean } = {}): PartDef {
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const z0 = Math.min(...zs);
  const sx = Math.max(...xs) - x0;
  const sz = Math.max(...zs) - z0;
  const round = (v: number): number => Math.round(v * 1e4) / 1e4;
  const outline = pts.map(([x, z]) => [round((x - x0) / sx - 0.5), round((z - z0) / sz - 0.5)] as const);
  return {
    shape: {
      type: 'prism',
      id: `roadBridge-plan:${outline.map((p) => p.join(',')).join(';')}`,
      outline,
      axis: 'y',
    },
    ...(opts.name ? { name: opts.name } : {}),
    at: [x0 + sx / 2, y + h / 2, z0 + sz / 2],
    size: [sx, h, sz],
    color,
    ...(opts.decor ? { decor: true } : {}),
  };
}

/** A plan strip from xa(z) to xb(z) across z in [-hw, hw] (straight ends: the 4 corners). */
const strip = (xa: (z: number) => number, xb: (z: number) => number, hw: number):
  [number, number][] => [[xa(-hw), -hw], [xb(-hw), -hw], [xb(hw), hw], [xa(hw), hw]];

/**
 * A slab with the convex plan outline `pts` ([x, z], body frame, m) at y = top, reaching `h` m down
 * the body's y axis, with its sides PLUMB in the world rather than square to the body: in a body
 * tilted by atan(t) a square side leans out by h · sin(tilt) at the bottom (an abutment block on a
 * grade would hang its foot out over the gap). Going straight down by D the body frame moves
 * D · sin(tilt) back along x and D · cos(tilt) down y, so the bottom outline is the top one shifted
 * by −h · t in x.
 */
function plumbSlab(pts: readonly (readonly [number, number])[], top: number, h: number, t: number,
  color: string | number, name: string): PartDef {
  if (Math.abs(t) < 1e-9) return planSlab(pts, top - h, h, color, { name });
  const all: [number, number, number][] = [
    ...pts.map(([x, z]): [number, number, number] => [x, top, z]),
    ...pts.map(([x, z]): [number, number, number] => [x - h * t, top - h, z]),
  ];
  const lo = [0, 1, 2].map((a) => Math.min(...all.map((p) => p[a])));
  const hi = [0, 1, 2].map((a) => Math.max(...all.map((p) => p[a])));
  const size: [number, number, number] = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const round = (v: number): number => Math.round(v * 1e4) / 1e4;
  const points = all.map((p) => p.map((v, a) => round((v - lo[a]) / size[a] - 0.5)) as [number, number, number]);
  return {
    shape: { type: 'hull', id: `roadBridge-plumb:${points.map((p) => p.join(',')).join(';')}`, points },
    name,
    at: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2],
    size,
    color,
  };
}

/**
 * A pier at x: the column stands on the lowest ground under it and the head, tilted with the deck,
 * carries the deck underside `soffit` (relative, nominal m) on its top face.
 */
function pierBody(x: number, ground: number, soffit: number, tilt: number): BodyDef {
  const capH = CAP_H / Math.cos(tilt);
  const colH = Math.max(0.3, soffit - capH - ground + SINK);
  const parts: PartDef[] = [
    {
      shape: { type: 'cylinder', segments: 12 },
      name: 'column',
      at: [0, colH / 2, 0],
      size: [COL_D, colH, COL_D],
      color: 'pier',
    },
    {
      shape: { type: 'prism', id: 'roadBridge-cap', outline: CAP, axis: 'x' },
      name: 'head',
      at: [0, colH + capH / 2, 0],
      size: [CAP_X, CAP_H, CAP_W],
      rot: [0, 0, tilt],
      color: 'pier',
    },
    // Plinth at ground level and a band of weathering under the pier head.
    { shape: 'box', at: [0, SINK + 0.12, 0], size: [2.6, 0.3, 2.6], color: 'stain', decor: true },
    {
      shape: { type: 'cylinder', segments: 12 },
      at: [0, colH - 0.6, 0],
      size: [COL_D + 0.02, 1.2, COL_D + 0.02],
      color: 'stain',
      decor: true,
    },
  ];
  const colVolume = 0.95 * (Math.PI / 4) * COL_D * COL_D * colH;
  return {
    part: 'pier',
    stand: 'anchored',
    at: [x, soffit - capH - colH, 0],
    ground: 'fixed',
    mass: PIER_DENSITY * (colVolume + CAP_AREA * CAP_X),
    breakSpeed: 25,
    breakMode: 'uproot',
    // At the top: the loaded foot is the pivot and the pier topples down-course from under the
    // decks. Knocked at the foot, it would slide a metre and stay upright under them.
    hitHeight: colH + CAP_H,
    proxy: 'trunk',
    trunkRadius: COL_D / 2,
    shake: 'offset',
    parts,
  };
}

/**
 * A deck segment `length` m long (along its axis, on the centre line) centred on x, its underside
 * at `soffit`. A skewed end (skew0 / skew1: plan dx / dz, ./deck.ts) runs along its support line, so
 * the deck is a trapezoid in plan; it is then a slab (the cantilevers over a narrower box) rather
 * than the sloped-web box girder, and its barriers and lines end on the skewed ends.
 */
function deckBody(x: number, length: number, soffit: number, tilt: number, lamp: number,
  skew0 = 0, skew1 = 0): BodyDef {
  const L = length - 0.02;
  // Lamp posts stand plumb on a deck on a grade.
  const plumb: PartDef['rot'] = tilt ? [0, 0, -tilt] : undefined;
  const top = DECK_H;
  // The ends on the line z across the deck (body frame: along the tilted axis).
  const k0 = skew0 / Math.cos(tilt);
  const k1 = skew1 / Math.cos(tilt);
  const xa = (z: number): number => -L / 2 + k0 * z;
  const xb = (z: number): number => L / 2 + k1 * z;
  const skewed = skew0 !== 0 || skew1 !== 0;
  const parts: PartDef[] = skewed
    ? [
        planSlab(strip(xa, xb, 4), 0, 1.1, 'deck', { name: 'deck' }),
        planSlab(strip(xa, xb, DECK_W / 2), 1.1, DECK_H - 1.1, 'deck', { name: 'deck' }),
        planSlab(strip((z) => xa(z) + 0.02, (z) => xb(z) - 0.02, (DECK_W - 1.3) / 2), top, 0.03,
          'asphalt', { decor: true }),
      ]
    : [
        {
          shape: { type: 'prism', id: 'roadBridge-girder', outline: GIRDER, axis: 'x' },
          name: 'deck',
          at: [0, DECK_H / 2, 0],
          size: [L, DECK_H, DECK_W],
          color: 'deck',
        },
        ...runs(L - 0.04, top + 0.015, 0, [0.03, DECK_W - 1.3], 'asphalt'),
      ];
  /** Length and centre of the deck on the line z. */
  const along = (z: number): { l: number; c: number } => ({ l: xb(z) - xa(z), c: (xa(z) + xb(z)) / 2 });
  for (const s of [1, -1]) {
    const bz = s * (DECK_W / 2 - 0.3);
    const b = along(bz);
    const m = along(s * 4.05);
    const f = along(s * (DECK_W / 2 + 0.01));
    parts.push(
      {
        shape: { type: 'prism', id: 'roadBridge-barrier', outline: BARRIER, axis: 'x' },
        at: [b.c, top + BARRIER_H / 2, bz],
        size: [b.l - 0.04, BARRIER_H, 0.6],
        color: 'barrier',
        decor: true,
      },
      ...runs(b.l - 0.04, top + BARRIER_H + RAIL_Y, bz, [0.07, 0.07], 'rail', b.c),
      ...runs(m.l - 0.2, top + 0.035, s * 4.05, [0.01, 0.15], 0xf2f2ee, m.c),
      // Fascia along the cantilever edge.
      ...runs(f.l, 1.25, s * (DECK_W / 2 + 0.01), [0.3, 0.02], 'barrier', f.c),
    );
    const posts = Math.max(2, Math.round(b.l / 2.5));
    for (let i = 0; i <= posts; i++) {
      parts.push({
        shape: 'box',
        at: [b.c - b.l / 2 + 0.1 + ((b.l - 0.2) * i) / posts, top + BARRIER_H + RAIL_Y / 2, bz],
        size: [0.06, RAIL_Y, 0.06],
        color: 'rail',
        decor: true,
      });
    }
  }
  // Dashed centre line.
  const dashes = Math.max(1, Math.round(L / 6));
  for (let i = 0; i < dashes; i++) {
    parts.push({
      shape: 'box',
      at: [-L / 2 + ((i + 0.5) * L) / dashes, top + 0.035, 0],
      size: [3, 0.01, 0.15],
      color: 0xf2f2ee,
      decor: true,
    });
  }
  // One lamp post per deck, alternating sides: pole, arm over the road, lamp head.
  const lz = lamp * (DECK_W / 2 - 0.3);
  const poleTop = top + BARRIER_H + 6.5;
  parts.push(
    {
      shape: 'box',
      at: [0, top + BARRIER_H + 3.25, lz],
      size: [0.18, 6.5, 0.18],
      rot: plumb,
      color: 'rail',
      decor: true,
    },
    {
      shape: 'box',
      at: [-6.5 * Math.sin(tilt), poleTop, lz - lamp * 0.8],
      size: [0.12, 0.12, 1.6],
      rot: plumb,
      color: 'rail',
      decor: true,
    },
    {
      shape: 'box',
      at: [-6.5 * Math.sin(tilt), poleTop - 0.1, lz - lamp * 1.55],
      size: [0.3, 0.12, 0.6],
      rot: plumb,
      color: 0xffe9b0,
      decor: true,
    },
  );
  return {
    part: 'deck',
    stand: 'resting',
    at: [x, soffit, 0],
    tilt,
    ground: 'fixed',
    mass: CONCRETE * GIRDER_SOLID * GIRDER_AREA * length,
    // A skewed deck collides as its trapezoid: its bounding rectangle reaches |k| × the width past
    // the acute corner of each skewed end, a phantom corner the iceberg would hit over the bank.
    ...(skewed ? { footprint: { x0: -L / 2, x1: L / 2, k0, k1, hz: DECK_W / 2, y0: 0, y1: DECK_H } } : {}),
    parts,
  };
}

/**
 * The abutment at one end (out = -1: the x0 end, +1: the x1 end) of support `sup`, tilted with the
 * deck. Anchored and unbreakable; the iceberg rides over it like the ground it is buried in
 * (passable); vehicles drive on its top. Three parts:
 * - the CAP, a deck depth thick, carries the road from beyond the end of the running surface
 *   (`back` m, under the approach) to the girder end; its front is the deck end's own face (square
 *   to the deck, through the girder end at underside level: support.x + skew · z), so on a grade
 *   the deck end neither runs into the block nor leaves a slot (the joint is the deck's 1 cm);
 * - the BLOCK under it, buried in the bank, stops where the bank does: at the bank edge measured on
 *   lines across the deck (DeckSupport.bank), shaped per pair of neighbouring lines (never past the
 *   girder end, never past a measured edge), so on a curved or ragged rim no part of it stands out
 *   over the drop where the straight girder end does; its sides are plumb, so on a grade its foot
 *   does not lean out over the gap, and it reaches a footing below the lowest ground under it;
 * - the SEAT, a deck depth down, from inside the block out under the deck end (`seat` m), that the
 *   end deck rests on; it bears on the rim (a footing below the highest ground under it).
 * On a skewed end (the support line's plan dx / dz) the cap's front and the seat run along the rim:
 * trapezoids in plan.
 */
function abutmentBody(
  ctx: StructureContext,
  plan: DeckPlan,
  sup: DeckSupport,
  out: -1 | 1,
  tilt: number,
): BodyDef {
  const { seat, back } = ROAD_DECK;
  const g = sup.x;
  const skew = sup.skew;
  const cos = Math.cos(tilt);
  const tan = Math.tan(tilt);
  /** From the bank toward the gap (plan x). */
  const toGap = -out;
  const e = out < 0 ? plan.x0 : plan.x1;
  const xa = e + out * back;
  const xc = (xa + g) / 2;
  const topC = deckTopAt(plan, xc);
  // A skewed block is the deck's own width (no wing walls): the rim it stops at was fitted across
  // the deck, and a wider block's front corners would reach out past it over the edge.
  const width = skew ? DECK_W : ABUT_W;
  const w = width / 2;
  const dw = DECK_W / 2;
  // Body frame (along the tilted axis, origin on the running surface at xc): plan x on the running
  // surface, and on the underside, a deck depth lower square to it.
  const uTop = (x: number): number => (x - xc) / cos;
  const uLow = (x: number): number => (x - xc) / cos - DECK_H * tan;
  const k = skew / cos;
  /** The girder end (plan), and the cap's front: the deck end's face, through it at underside level. */
  const support = (z: number): number => g + skew * z;
  const front = (z: number): number => uLow(g) + k * z;
  // The back face is square, under the approach (a deck edge ending over the gap could bring the
  // front round past it: keep 0.5 m, the logic check fails such a bridge).
  const fronts = [front(-w), front(w)];
  const back0 = toGap > 0
    ? Math.min(uTop(xa), Math.min(...fronts) - 0.5)
    : Math.max(uTop(xa), Math.max(...fronts) + 0.5);
  const lo = (z: number): number => Math.min(back0, front(z));
  const hi = (z: number): number => Math.max(back0, front(z));

  // The block's front (plan x) per piece between neighbouring coarse lines across the deck: through
  // the measured bank edges, moved back where a measured line between lies behind it, and never
  // past the girder end; pieces at the girder end merge.
  const bank = sup.bank ?? [];
  /** The bank edge at z: between two measured lines, the one further back (the edge may jump). */
  const bankAt = (z: number): number => {
    if (bank.length === 0) return support(z);
    if (z <= bank[0][0]) return bank[0][1];
    for (let i = 1; i < bank.length; i++) {
      if (z <= bank[i][0] + 1e-9) {
        const a = bank[i - 1][1];
        const b = bank[i][1];
        return Math.abs(z - bank[i][0]) < 1e-9 ? b : (a - b) * toGap < 0 ? a : b;
      }
    }
    return bank[bank.length - 1][1];
  };
  const C = DECK_RULES.skewLines - 1;
  /** Pieces: z range and the block front (plan x) at each end of it. */
  const pieces: { za: number; zb: number; fa: number; fb: number }[] = [];
  for (let i = 0; i < C; i++) {
    const za = -dw + (2 * dw * i) / C;
    const zb = -dw + (2 * dw * (i + 1)) / C;
    let fa = bankAt(za);
    let fb = bankAt(zb);
    let behind = 0;
    for (const [z, x] of bank) {
      if (z < za - 1e-9 || z > zb + 1e-9) continue;
      behind = Math.max(behind, (fa + ((fb - fa) * (z - za)) / (zb - za) - x) * toGap);
    }
    fa = fa - toGap * behind;
    fb = fb - toGap * behind;
    // Never past the girder end (the bank edges never are; this only guards rounding).
    if ((fa - support(za)) * toGap > 0) fa = support(za);
    if ((fb - support(zb)) * toGap > 0) fb = support(zb);
    const atGirder = (support(za) - fa) * toGap <= 0.02 && (support(zb) - fb) * toGap <= 0.02;
    const last = pieces[pieces.length - 1];
    if (atGirder && last && last.fa === support(last.za) && last.fb === support(last.zb)) {
      last.zb = zb;
      last.fb = support(zb);
    } else if (atGirder) {
      pieces.push({ za, zb, fa: support(za), fb: support(zb) });
    } else {
      pieces.push({ za, zb, fa, fb });
    }
  }
  // The outermost pieces carry on over the wing walls (square ends: ABUT_W is wider than the deck),
  // back to the bank edge on the wing's own outer line where it lies further back.
  const first = pieces[0];
  const lastPiece = pieces[pieces.length - 1];
  first.za = -w;
  lastPiece.zb = w;
  if (w > dw && bank.length > 0) {
    const soffit = (x: number): number => deckTopAt(plan, x) - DECK_H / cos;
    const wingEdge = (z: number): number => {
      // The last point (from the end toward the gap) where the bank still stands within `free`
      // of the underside on the wing's outer line.
      let x = e;
      for (let i = 1; i <= 400 && (x - g) * toGap < 0; i++) {
        const nx = e + toGap * i * DECK_RULES.step;
        if (ctx.ungradedAt(nx, z) <= soffit(nx) - DECK_RULES.free) break;
        x = nx;
      }
      return x;
    };
    const back = (a: number, b: number): number => ((a - b) * toGap < 0 ? a : b);
    first.fa = back(first.fa, wingEdge(-w));
    lastPiece.fb = back(lastPiece.fb, wingEdge(w));
  }
  /** The block's front at z (plan x), on its piece. */
  const blockFront = (z: number): number => {
    const p = pieces.find((q) => z <= q.zb + 1e-9) ?? pieces[pieces.length - 1];
    const za = Math.max(p.za, -dw);
    const zb = Math.min(p.zb, dw);
    const t = zb > za ? Math.min(1, Math.max(0, (z - za) / (zb - za))) : 0;
    return p.fa + (p.fb - p.fa) * t;
  };

  // Block depth: a footing below the lowest ground under it, everywhere (its bottom is the plane
  // DECK_H + blockH below the running surface, square to the deck; ground in vertical metres).
  let blockH = DECK_H + 1;
  // Seat depth: a footing below the highest ground under it (on a sheer rim, the rim's edge).
  let seatHigh = -Infinity;
  const m = Math.ceil((2 * w) / DECK_RULES.lineStep);
  for (let j = 0; j <= m; j++) {
    const z = -w + (2 * w * j) / m;
    const f = blockFront(z);
    const n = Math.max(2, Math.ceil(Math.abs(f - xa) / 0.5));
    for (let i = 0; i <= n; i++) {
      const x = xa + ((f - xa) * i) / n;
      blockH = Math.max(blockH, (deckTopAt(plan, x) - ctx.groundAt(x, z) + FOOTING) * cos);
    }
    const s0 = f - toGap * 0.3;
    const s1 = support(z) + toGap * seat;
    for (let i = 0; i <= 4; i++) seatHigh = Math.max(seatHigh, ctx.groundAt(s0 + ((s1 - s0) * i) / 4, z));
  }
  const seatTop = deckTopAt(plan, g + (toGap * seat) / 2) - DECK_H / cos;
  const seatH = Math.min(SEAT_MAX, Math.max(1, seatTop - seatHigh + FOOTING));

  const parts: PartDef[] = [planSlab(strip(lo, hi, w), -DECK_H, DECK_H, 'pier', { name: 'abutment' })];
  for (const p of pieces) {
    const fa = uLow(p.fa);
    const fb = uLow(p.fb);
    const outline: [number, number][] = [[back0, p.za], [fa, p.za], [fb, p.zb], [back0, p.zb]];
    parts.push(plumbSlab(outline, -DECK_H, blockH - DECK_H, tan, 'pier', 'abutment'));
    // The seat under it: from 0.3 m inside the block out under the deck end.
    const sa = uLow(p.fa - toGap * 0.3);
    const sb = uLow(p.fb - toGap * 0.3);
    const ga = uLow(support(p.za) + toGap * seat);
    const gb = uLow(support(p.zb) + toGap * seat);
    parts.push(plumbSlab([[sa, p.za], [ga, p.za], [gb, p.zb], [sb, p.zb]], -DECK_H, seatH, tan, 'pier',
      'abutment'));
  }
  // The road over it and the parapets along it, like the deck's.
  parts.push(planSlab(strip((z) => lo(z) + 0.02, (z) => hi(z) - 0.02, (DECK_W - 1.3) / 2), 0, 0.03,
    'asphalt', { decor: true }));
  for (const side of [1, -1]) {
    const bz = side * (DECK_W / 2 - 0.3);
    const l = hi(bz) - lo(bz);
    const c = (hi(bz) + lo(bz)) / 2;
    const lz = side * 4.05;
    parts.push(
      {
        shape: { type: 'prism', id: 'roadBridge-barrier', outline: BARRIER, axis: 'x' },
        at: [c, BARRIER_H / 2, bz],
        size: [l - 0.04, BARRIER_H, 0.6],
        color: 'barrier',
        decor: true,
      },
      ...runs(hi(lz) - lo(lz) - 0.2, 0.035, lz, [0.01, 0.15], 0xf2f2ee, (hi(lz) + lo(lz)) / 2),
    );
  }
  const f0 = front(0);
  return {
    part: 'abutment',
    stand: 'anchored',
    at: [xc, topC, 0],
    tilt,
    ground: 'fixed',
    mass: 2.4 * Math.abs(f0 - back0) * blockH * width,
    proxy: 'extent',
    passable: true,
    // Vehicles drive on the cap's top: its plan, not the bounding box of the block and seat under it.
    footprint: toGap > 0
      ? { x0: back0, x1: f0, k0: 0, k1: k, hz: w, y0: 0, y1: 0 }
      : { x0: f0, x1: back0, k0: k, k1: 0, hz: w, y0: 0, y1: 0 },
    parts,
  };
}


const roadBridge: StructureDef = {
  kind: 'roadBridge',
  label: 'Road bridge',
  material: 'stone',
  footprint: DECK_W / 2 + 0.3,
  span: { default: 'floor', min: 16, max: 240 },
  palettes: {
    // Weathered concrete; barriers a touch lighter; galvanised rails; dark asphalt.
    deck: [0xb9b6ae, 0xaeaba3, 0xc2bfb6],
    pier: [0xa9a69e, 0xb3b0a8, 0x9f9c94],
    barrier: [0xcdcac2, 0xd6d3cb],
    rail: [0x9aa2a8, 0x8a9298],
    asphalt: [0x3a3c40, 0x44464a],
    stain: [0x8f8c85],
    trim: [0x2a2c30],
  },
  build(ctx) {
    const plan = planDeck(ROAD_DECK, ctx);
    const tilt = Math.atan(deckGrade(plan));
    const cos = Math.cos(tilt);
    const soffit = (x: number): number => deckTopAt(plan, x) - DECK_H / cos;
    const sup = plan.supports;
    const bodies: BodyDef[] = [];
    const r = COL_D / 2;
    sup.forEach((sp, i) => {
      if (sp.type === 'abutment') {
        bodies.push(abutmentBody(ctx, plan, sp, i === 0 ? -1 : 1, tilt));
        return;
      }
      let ground = ctx.groundAt(sp.x, 0);
      for (const [dx, dz] of [[-r, -r], [r, -r], [r, r], [-r, r]]) {
        ground = Math.min(ground, ctx.groundAt(sp.x + dx, dz));
      }
      bodies.push(pierBody(sp.x, ground, soffit(sp.x), tilt));
    });
    deckSegments(ROAD_DECK, plan).forEach(({ x, length, skew0, skew1 }, i) => {
      bodies.push(deckBody(x, length, soffit(x), tilt, i % 2 === 0 ? 1 : -1, skew0, skew1));
    });
    return bodies;
  },
};

export default roadBridge;
