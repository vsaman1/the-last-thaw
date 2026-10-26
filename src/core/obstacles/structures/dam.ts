import { groundWall } from './barn';
import { spanSegments, type BodyDef, type PartDef, type StructureContext, type StructureDef } from './kit';

/**
 * A concrete gravity dam across a gorge (along local x) with a stepped downstream face, 9 m high.
 * Spanning: a 10 m monolith sits on the placement's centre line (see monolithLayout) and the rest
 * of `span` is split into ~10 m monoliths either side. Each is ONE anchored body: two base
 * courses (up to 2.6 and 5.2 m above the gorge floor, 4.6 and 3.6 m thick) and the crest course
 * (2.8 m thick) with its road, parapets and lamps (a valve house on the last monolith). The
 * upstream face (-z, toward the iceberg) is vertical. Each course is cast as three blocks, so a
 * broken monolith bursts into nine blocks that all start moving at once and tumble down the
 * steps, while the neighbours stand (a partial breach). Each column of blocks stands on its own
 * ground, its lowest block following the ground under it, so on a cross slope or a bumpy floor no
 * block starts deep in the terrain (the lowest under the whole monolith left the high side's
 * blocks buried up to 1.5 m, and freed they stayed stuck). On the gorge sides, where the ground
 * rises, courses that do not fit are left out; where even the crest would not fit, no monolith.
 *
 * breakSpeed 40 m/s for a 30 t iceberg (momentum rule, breakImpulse 1500 t·m/s × scale²): no
 * normal iceberg can break it, a 100 t one breaks a monolith from 12 m/s. Masses use an effective
 * concrete density of 0.3 t/m³ (an eighth of solid concrete: the game's massive obstacles weigh
 * 15-50 % of the real thing, and the dam sits at the light end so that a big iceberg can plough
 * through the rubble of its breach): ~97 t per 10 m monolith. Breaking the monolith costs the
 * loose-body impulse for its mass; its blocks are then bulldozed (see SIM_TUNING.pushWindow).
 * Measured (40 m span, 0.06 slope): a 100 t iceberg breaching at 14 m/s keeps ~5 m/s and ploughs
 * on; 220 t at 12 m/s keeps ~7 m/s, centred or off-centre. A hit at or near a joint breaks both
 * monoliths together at about the cost of one (breakTogether in sim/iceberg.ts): on the 42 m dam
 * 110-220 t at 12-14 m/s get through at 5-8 m/s wherever they hit (they pinned 2-8 m off a centre
 * before). Monoliths collide as their footprint rectangles, so the 10 m breach clears icebergs up
 * to ~2× the normal size.
 */

const COLUMN = 10;
/** Blocks each course is cast in across the monolith. */
const ACROSS = 3;
/** Crest height above the gorge floor (the lowest ground along the axis). */
const CREST = 9;
/** Courses: top above the gorge floor and thickness along z; the last one is the crest. */
const COURSES = [
  { top: 2.6, depth: 4.6 },
  { top: 5.2, depth: 3.6 },
  { top: CREST, depth: 2.8 },
] as const;
const CREST_DEPTH = COURSES[COURSES.length - 1].depth;
/** The upstream face (z) every course shares. */
const FACE = -COURSES[0].depth / 2;
const MIN_COURSE = 0.6;
const CONCRETE = 0.3;
/** Shallow, or Rapier pops a freed block sunk deep in the terrain back up. */
const SINK = 0.06;
/** Gap between blocks so freed pieces never start inside each other. */
const GAP = 0.01;
const PARAPET_H = 1.0;
/** Height of one concrete lift (the formwork lines on the upstream face). */
const LIFT = 1.3;

/** Lowest ground (relative, nominal) along x in [x0, x1] under the upstream face, axis and toe. */
function lowestGround(ctx: StructureContext, x0: number, x1: number): number {
  let g = Infinity;
  const n = Math.max(1, Math.ceil(x1 - x0));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    for (const z of [FACE, 0, -FACE]) g = Math.min(g, ctx.groundAt(x, z));
  }
  return g;
}

function detail(at: PartDef['at'], size: PartDef['size'], color: string | number, piece: string): PartDef {
  return { shape: 'box', at, size, color, piece, decor: true };
}

/** Road, parapets, lamp and valve house on one crest block (centre x, width bw, top y). */
function crestDecor(x: number, bw: number, y: number, piece: string, lamp: boolean,
  house: boolean): PartDef[] {
  const zc = FACE + CREST_DEPTH / 2;
  const out = [detail([x, y + 0.015, zc], [bw - 0.02, 0.03, CREST_DEPTH - 0.6], 'asphalt', piece)];
  for (const z of [FACE + 0.15, FACE + CREST_DEPTH - 0.15]) {
    out.push(detail([x, y + PARAPET_H / 2, z], [bw, PARAPET_H, 0.3], 'parapet', piece));
  }
  if (lamp) {
    const lz = FACE + CREST_DEPTH - 0.15;
    out.push(
      detail([x, y + 3, lz], [0.14, 4, 0.14], 'trim', piece),
      detail([x, y + 5, lz - 0.4], [0.1, 0.1, 0.8], 'trim', piece),
      detail([x, y + 4.92, lz - 0.75], [0.24, 0.1, 0.4], 0xffe9b0, piece),
    );
  }
  if (house) {
    out.push(
      detail([x, y + 1.2, zc], [2.8, 2.4, 2.2], 'house', piece),
      detail([x, y + 2.5, zc], [3.2, 0.22, 2.6], 'roof', piece),
      detail([x + 0.6, y + 0.95, zc + 1.11], [0.8, 1.9, 0.02], 'trim', piece),
      detail([x - 0.6, y + 1.5, zc + 1.11], [0.8, 0.6, 0.02], 'glass', piece),
      detail([x - 0.6, y + 1.5, zc - 1.11], [0.8, 0.6, 0.02], 'glass', piece),
    );
  }
  return out;
}

/**
 * One monolith of width w on floor-relative ground g (the lowest under it): in each of its ACROSS
 * columns the courses between that column's own ground and the crest, one block (piece) per
 * course, with their surface detail. The lowest block of each column follows the ground under it
 * (groundWall: a sloped bottom on a cross slope), so on uneven ground no block starts sunk deep in
 * the terrain, where a freed one would stay stuck. Body origin at g - SINK.
 */
function monolith(ctx: StructureContext, x: number, w: number, g: number, floor: number, lamp: boolean,
  house: boolean): BodyDef {
  const origin = g - SINK;
  const bw = (w - (ACROSS + 1) * GAP) / ACROSS;
  const blockX = (i: number): number => -w / 2 + GAP + bw / 2 + i * (bw + GAP);
  // The ground in the body's frame (origin at floor + origin, x relative to the monolith).
  const local: StructureContext = { ...ctx, groundAt: (px, pz) => ctx.groundAt(x + px, pz) - floor - origin };
  const parts: PartDef[] = [];
  // Per column: floor-relative bottom of its next block, or NaN while it has none (on the ground).
  const y0 = new Array<number>(ACROSS).fill(NaN);
  let volume = 0;
  COURSES.forEach((c, k) => {
    const crest = k === COURSES.length - 1;
    const toe = FACE + c.depth + 0.006;
    const zc = FACE + c.depth / 2;
    let streak: { y: number; h: number } | null = null;
    const si = Math.min(ACROSS - 1, Math.floor(ctx.rng() * ACROSS));
    for (let i = 0; i < ACROSS; i++) {
      const piece = `course${k}-${i}`;
      const bx = blockX(i);
      let bottom = y0[i];
      if (Number.isNaN(bottom)) {
        // The column's first block stands on the ground: skipped where the course does not fit.
        const gi = lowestGround(ctx, x + bx - bw / 2, x + bx + bw / 2) - floor;
        if (c.top - gi < (crest ? 0.3 : MIN_COURSE)) continue;
        const wall = groundWall(local, [bx - bw / 2, zc], [bx + bw / 2, zc], c.depth, c.top - origin,
          'concrete', { piece, name: 'block' });
        parts.push(wall);
        bottom = wall.at[1] - wall.size[1] / 2 + origin;
        volume += bw * wall.size[1] * c.depth;
        // A drain outlet at the foot of the step face.
        const foot: PartDef['at'] = [bx, Math.max(bottom, gi) - origin + 0.5, toe];
        if (!crest) parts.push(detail(foot, [0.3, 0.3, 0.01], 'joint', piece));
      } else {
        const h = c.top - bottom;
        const at: PartDef['at'] = [bx, bottom - origin + h / 2, zc];
        parts.push({ shape: 'box', name: 'block', piece, at, size: [bw, h, c.depth], color: 'concrete' });
        volume += bw * h * c.depth;
      }
      // Formwork lines on the upstream face, aligned across monoliths.
      for (let y = (Math.floor(Math.max(bottom, g) / LIFT) + 1) * LIFT; y < c.top - 0.2; y += LIFT) {
        parts.push(detail([bx, y - origin, FACE - 0.006], [bw - 0.04, 0.05, 0.01], 'joint', piece));
      }
      const last = i === ACROSS - 1;
      if (crest) parts.push(...crestDecor(bx, bw, c.top - origin, piece, lamp && last, house && last));
      if (i === si) streak = { y: Math.max(bottom, g), h: c.top - Math.max(bottom, g) };
      y0[i] = c.top;
    }
    // A weathering streak down the step face.
    const len = 0.5 + 0.6 * ctx.rng();
    const sx = blockX(si) + (ctx.rng() - 0.5) * (bw - len);
    if (streak && streak.h > 0.6) {
      const at: PartDef['at'] = [sx, streak.y - origin + streak.h / 2, toe];
      parts.push(detail(at, [len, streak.h - 0.3, 0.01], 'stain', `course${k}-${si}`));
    }
  });
  return {
    part: 'block',
    stand: 'anchored',
    at: [x, floor + origin, 0],
    ground: 'fixed',
    mass: CONCRETE * volume,
    breakSpeed: 40,
    breakMode: 'shatter',
    breakup: { impulseScale: 0.85, spin: 0.35, falloff: 4, floor: 0.45 },
    shake: 'offset',
    parts,
  };
}

/**
 * Monolith centres and widths along x: one COLUMN wide on the centre line, so a centred iceberg
 * meets the middle of a monolith (a hit on a joint breaks two and buries it in twice the rubble),
 * whose breach is wide enough for a big iceberg; the rest in ~COLUMN monoliths each side.
 */
export function monolithLayout(span: number): { x: number; w: number }[] {
  const side = (span - COLUMN) / 2;
  if (side < COLUMN / 4) return [{ x: 0, w: span }];
  const { length, centres } = spanSegments(side, COLUMN);
  const out = [{ x: 0, w: COLUMN }];
  for (const c of centres) {
    const off = COLUMN / 2 + side / 2 + c;
    out.push({ x: off, w: length }, { x: -off, w: length });
  }
  return out.sort((a, b) => a.x - b.x);
}

const dam: StructureDef = {
  kind: 'dam',
  label: 'Dam',
  material: 'stone',
  footprint: -FACE + 0.25,
  span: { default: 'floor', min: COLUMN, max: 160 },
  palettes: {
    // Weathered concrete, darker joints and outlets, lighter parapets.
    concrete: [0xb7b3a9, 0xaeaaa0, 0xbfbbb1],
    joint: [0x8d8a83],
    stain: [0x9c988e, 0x948f85],
    parapet: [0xcfccc4, 0xd6d3cb],
    asphalt: [0x3a3c40],
    trim: [0x2a2c30],
    house: [0xe9e4d8, 0xd9d2c3],
    roof: [0x7a3b2e, 0x3d4a57],
    glass: [0x1d2733],
  },
  build(ctx) {
    const half = ctx.span / 2;
    const floor = lowestGround(ctx, -half, half);
    const bodies: BodyDef[] = [];
    const cols = monolithLayout(ctx.span);
    cols.forEach(({ x, w }, i) => {
      const g = lowestGround(ctx, x - w / 2, x + w / 2) - floor;
      if (g > CREST - MIN_COURSE) return;
      bodies.push(monolith(ctx, x, w, g, floor, i % 2 === 1, i === cols.length - 1 && cols.length > 2));
    });
    return bodies;
  },
};

export default dam;
