import {
  deckGrade,
  deckSegments,
  deckTopAt,
  FOOT_DECK,
  planDeck,
  type DeckPlan,
} from './deck';
import type { BodyDef, PartDef, StructureContext, StructureDef } from './kit';

/**
 * A timber footbridge that carries a path from bank to bank (./deck.ts plans it, like the road
 * bridge). Across a stream, ravine, gorge or cutting the deck runs from the bank at one end of
 * `span` to the bank at the other, ramped when they differ, a stone SILL at each end (anchored,
 * unbreakable, bedded in the bank, passable for the iceberg like the ground) carrying the path out
 * to where it meets the ground and holding the deck end. Between them the deck is split into ~8 m
 * bays with an anchored post (a square timber with a cross-head the deck sits on) at every inner bay
 * end, every bay a deck segment (planked slab plus handrails) that RESTS on its two supports as a
 * sleeping loose body. Nothing joins them: knock a post out and Rapier lets the two decks it carried
 * fall.
 *
 * A span reaching the floor edge at both ends is the old wall-to-wall footbridge: the deck's
 * underside is DECK_CLEARANCE above the highest floor ground under it, so the iceberg (contact
 * band ~2.8 m at size 1, scaled up with its radius) slides underneath; only the posts are in its
 * way (bays are ~8 m apart, so a 4.4 m-wide iceberg can thread between them), and the ends run on
 * into the walls to where they rise to the deck. A grown iceberg taller than the clearance shoves
 * the decks off instead. Over nothing it is built the old way (posts at both ends, the ends in the
 * air) and validateWorldLogic fails it. Posts give way above ~5.5 m/s for a 30 t iceberg (momentum
 * rule) and are knocked out as one piece at the iceberg's contact height (so the base goes and the
 * load comes down even from a single hit); slower hits bounce off.
 */

const DECK_W = FOOT_DECK.width;
const SLAB = FOOT_DECK.depth;
/** Deck underside above the highest ground under a wall-to-wall footbridge (m). */
export const DECK_CLEARANCE = FOOT_DECK.clearance;
/** Sill: width and footing below the ground (m). */
const SILL_W = DECK_W + 0.5;
const FOOTING = 0.4;
/** Deepest a sill's seat reaches down a sheer bank (m). */
const SEAT_MAX = 3;
const POST_W = 0.42;
/**
 * Below the lowest ground under the post. Kept shallow: a post sunk deep into the terrain gets
 * popped back up by Rapier's depenetration when it is knocked loose and then props the decks up.
 */
const POST_SINK = 0.06;
/** The iceberg strikes a post about this high above the ground (its contact point is pos.y + 1.2). */
const HIT_Y = 1.2;
const HEAD_H = 0.2;
const RAIL_Y = 1.0;
const RAIL_T = 0.09;
const BALUSTER_GAP = 1.15;

/** A post at x standing on `ground`; its cross-head, tilted with the deck, carries `soffit`. */
function postBody(x: number, ground: number, soffit: number, tilt: number): BodyDef {
  const headH = HEAD_H / Math.cos(tilt);
  const h = Math.max(0.3 + headH, soffit - ground + POST_SINK);
  // The square post stops under the tilted cross-head at both of its faces.
  const ph = h - (POST_W / 2) * Math.abs(Math.tan(tilt)) - 0.005;
  const parts: PartDef[] = [
    { shape: 'box', name: 'post', at: [0, ph / 2, 0], size: [POST_W, ph, POST_W], color: 'post' },
    // Cross-head the deck rests on, the full deck width plus a little.
    {
      shape: 'box',
      name: 'post',
      at: [0, h - headH / 2, 0],
      size: [POST_W + 0.08, HEAD_H, DECK_W + 0.3],
      rot: [0, 0, tilt],
      color: 'post',
    },
  ];
  // Knee braces from the post up to the cross-head ends (decor).
  for (const side of [-1, 1]) {
    parts.push({
      shape: 'box',
      at: [0, h - HEAD_H - 0.42, side * 0.42],
      size: [0.12, 1.05, 0.12],
      rot: [side * 0.78, 0, 0],
      color: 'post',
      decor: true,
    });
  }
  return {
    part: 'post',
    stand: 'anchored',
    at: [x, soffit - h, 0],
    ground: 'fixed',
    mass: 0.11 * h + 0.15,
    breakSpeed: 5.5,
    breakMode: 'uproot',
    proxy: 'trunk',
    trunkRadius: 0.3,
    hitHeight: POST_SINK + HIT_Y,
    parts,
  };
}

/** A deck segment `length` m long (along its axis) centred on x, its underside at `soffit`. */
function deckBody(x: number, length: number, soffit: number, tilt: number): BodyDef {
  const L = length - 0.02;
  const railZ = DECK_W / 2 - RAIL_T / 2;
  const parts: PartDef[] = [
    { shape: 'box', name: 'deck', at: [0, SLAB / 2, 0], size: [L, SLAB, DECK_W], color: 'timber' },
    ...[-railZ, railZ].map(
      (z): PartDef => ({
        shape: 'box',
        name: 'rail',
        at: [0, SLAB + RAIL_Y, z],
        size: [L, RAIL_T, RAIL_T],
        color: 'rail',
      }),
    ),
  ];
  const n = Math.max(2, Math.round(L / BALUSTER_GAP));
  for (let i = 0; i <= n; i++) {
    const bx = -L / 2 + 0.05 + ((L - 0.1) * i) / n;
    for (const z of [-railZ, railZ]) {
      parts.push({
        shape: 'box',
        at: [bx, SLAB + RAIL_Y / 2, z],
        size: [0.07, RAIL_Y - RAIL_T / 2, 0.07],
        color: 'rail',
        decor: true,
      });
    }
  }
  // Plank seams across the deck (decor), so it reads as boards rather than a slab.
  for (let i = 1; i < Math.round(L / 0.9); i++) {
    parts.push({
      shape: 'box',
      at: [-L / 2 + (i * L) / Math.round(L / 0.9), SLAB + 0.004, 0],
      size: [0.03, 0.01, DECK_W - 0.3],
      color: 0x5a4430,
      decor: true,
    });
  }
  return {
    part: 'deck',
    stand: 'resting',
    at: [x, soffit, 0],
    tilt,
    ground: 'fixed',
    mass: 0.17 * length,
    parts,
  };
}

/**
 * The sill at one end (out = -1: the x0 end, +1: the x1 end): a stone block bedded in the bank whose
 * top carries the path from beyond the end of the running surface to the deck end, and a seat in
 * front of it, a slab lower, that the end deck rests on; a newel post at each handrail end.
 */
function sillBody(ctx: StructureContext, plan: DeckPlan, g: number, out: -1 | 1, tilt: number): BodyDef {
  const { seat, back } = FOOT_DECK;
  const cos = Math.cos(tilt);
  const e = out < 0 ? plan.x0 : plan.x1;
  const xa = e + out * back;
  const xc = (xa + g) / 2;
  const lh = Math.abs(xa - g);
  const topC = deckTopAt(plan, xc);
  /** Lowest and highest ground under the sill's width between from and to. */
  const ground = (from: number, to: number): { low: number; high: number } => {
    let low = Infinity;
    let high = -Infinity;
    const n = Math.max(1, Math.ceil(Math.abs(to - from) / 0.5));
    for (let i = 0; i <= n; i++) {
      const x = from + ((to - from) * i) / n;
      for (const z of [-SILL_W / 2, 0, SILL_W / 2]) {
        const h = ctx.groundAt(x, z);
        low = Math.min(low, h);
        high = Math.max(high, h);
      }
    }
    return { low, high };
  };
  const slack = (lh / 2) * Math.abs(Math.tan(tilt));
  const blockH = Math.max(SLAB + 0.5, topC - ground(xa, g).low + FOOTING + slack);
  // The seat bears on the bank: a footing below the highest ground under it.
  const s0 = g - out * seat;
  const s1 = g + out * 0.2;
  const xs = (s0 + s1) / 2;
  const seatTop = deckTopAt(plan, xs) - SLAB / cos;
  const seatH = Math.min(SEAT_MAX, Math.max(0.5, seatTop - ground(s0, s1).high + FOOTING));
  const railZ = DECK_W / 2 - RAIL_T / 2;
  // Body frame (along the tilted axis): the back face, and the front through the deck end at the
  // slab's underside (square to the deck, like the deck's own end face), so on a grade the deck end
  // neither runs into the block nor leaves a slot (the joint is the deck's 1 cm).
  const back0 = (xa - xc) / cos;
  const front = (g - xc) / cos - SLAB * Math.tan(tilt);
  const parts: PartDef[] = [
    {
      shape: 'box',
      name: 'sill',
      at: [(back0 + front) / 2, -blockH / 2, 0],
      size: [Math.abs(front - back0), blockH, SILL_W],
      color: 'stone',
    },
    {
      shape: 'box',
      name: 'sill',
      at: [(xs - xc) / cos, -SLAB - seatH / 2, 0],
      size: [Math.abs(s1 - s0) / cos, seatH, SILL_W],
      color: 'stone',
    },
  ];
  // Newel posts where the handrails end, plumb.
  const nx = (g + out * 0.15 - xc) / cos;
  for (const z of [-railZ, railZ]) {
    parts.push({
      shape: 'box',
      at: [nx, (RAIL_Y + 0.15) / 2, z],
      size: [0.14, RAIL_Y + 0.15, 0.14],
      rot: tilt ? [0, 0, -tilt] : undefined,
      color: 'rail',
      decor: true,
    });
  }
  return {
    part: 'sill',
    stand: 'anchored',
    at: [xc, topC, 0],
    tilt,
    ground: 'fixed',
    material: 'stone',
    mass: 2.2 * Math.abs(front - back0) * blockH * SILL_W,
    proxy: 'extent',
    passable: true,
    parts,
  };
}

const footbridge: StructureDef = {
  kind: 'footbridge',
  label: 'Footbridge',
  material: 'wood',
  footprint: DECK_W / 2 + 0.3,
  span: { default: 'floor', min: FOOT_DECK.bay, max: 160 },
  palettes: {
    timber: [0x8a6a4a, 0x7d5f42, 0x96754f],
    post: [0x5e4630, 0x6b5038],
    rail: [0xa07d57, 0x8f6e4c],
    stone: [0x8f8a80, 0x9a958b, 0x857f75],
  },
  build(ctx) {
    const plan = planDeck(FOOT_DECK, ctx);
    const tilt = Math.atan(deckGrade(plan));
    const cos = Math.cos(tilt);
    const soffit = (x: number): number => deckTopAt(plan, x) - SLAB / cos;
    const sup = plan.supports;
    const bodies: BodyDef[] = [];
    const r = POST_W / 2;
    sup.forEach((sp, i) => {
      if (sp.type === 'abutment') {
        bodies.push(sillBody(ctx, plan, sp.x, i === 0 ? -1 : 1, tilt));
        return;
      }
      let ground = ctx.groundAt(sp.x, 0);
      for (const [dx, dz] of [[-r, -r], [r, -r], [r, r], [-r, r]]) {
        ground = Math.min(ground, ctx.groundAt(sp.x + dx, dz));
      }
      bodies.push(postBody(sp.x, ground, soffit(sp.x), tilt));
    });
    for (const { x, length } of deckSegments(FOOT_DECK, plan)) {
      bodies.push(deckBody(x, length, soffit(x), tilt));
    }
    return bodies;
  },
};

export default footbridge;
