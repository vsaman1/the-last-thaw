import type { PartDef, StructureContext, StructureDef, V3 } from './kit';
import { RUIN, ruinMass, ruinParts } from './ruin';

/**
 * A red timber barn with a gambrel roof (10 Ã— 14 m, eaves 4.2 m, ridge 8.8 m): plank walls, two
 * gambrel gables, four roof slabs (steep lower, shallow upper) and white trim, sliding double doors,
 * a hayloft door and a ridge cupola as decor. One anchored body of 12 pieces: front and back walls,
 * two panels per side, the two gables and the four roof slabs; it breaks into those panels.
 * Mass 16 t; a 30 t iceberg breaks it above 11 m/s (breakImpulse 412.5), a 100 t one at 3.3 m/s.
 * Local frame: ridge along z, big doors on +z. With no yaw given the doors face the centreline
 * (or up-course toward the player on the centreline), like the house.
 *
 * Ground: the walls follow the ground under them (ground 'fixed' + groundWall below), so on a
 * slope the barn stands level with taller walls on the downhill side instead of being sunk into
 * the hillside: a shattered panel never starts buried (a thin slab sunk into the terrain gets
 * pushed sideways by Rapier and stays stuck there).
 */

// -------------------------------------------------------------------------------------------
// Shared helpers for ground-following buildings (also used by chalet.ts and factoryHall.ts)
// -------------------------------------------------------------------------------------------

/** Ground-following walls start this far (m) below the lowest ground under them. */
export const WALL_SINK = 0.05;
/** Sloping wall bottoms are quantised to 1/WALL_STEPS of the wall height (shared prism shapes). */
const WALL_STEPS = 40;

/** A point in the structure's horizontal plane (x, z), or in a vertical section (x, y). */
export type P2 = readonly [number, number];

export interface PartExtras {
  readonly piece?: string;
  readonly name?: string;
  readonly weight?: number;
}

/**
 * A straight wall `t` thick whose base centre line runs from `a` to `b` (structure x/z), from just
 * under the ground up to height `top` (structure y). Its bottom edge is a straight line that follows
 * the ground under the wall (lowered where the ground dips between the ends), so it neither hovers
 * nor sits deep in a slope: a box on level ground, otherwise a trapezoid prism whose slope is
 * quantised (ids 'rural-wall-<n>', shared by every kind that uses this helper).
 */
export function groundWall(
  ctx: StructureContext,
  a: P2,
  b: P2,
  t: number,
  top: number,
  color: string | number,
  extras: PartExtras = {},
): PartDef {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  const nx = (-dz / len) * (t / 2);
  const nz = (dx / len) * (t / 2);
  const ground = (f: number): number => {
    const x = a[0] + dx * f;
    const z = a[1] + dz * f;
    return Math.min(ctx.groundAt(x + nx, z + nz), ctx.groundAt(x - nx, z - nz));
  };
  let ya = ground(0);
  let yb = ground(1);
  let dip = 0;
  for (const f of [0.25, 0.5, 0.75]) dip = Math.max(dip, ya + (yb - ya) * f - ground(f));
  ya -= dip + WALL_SINK;
  yb -= dip + WALL_SINK;
  const low = Math.min(ya, yb);
  const h = Math.max(top - low, 0.3);
  // Rounded down: the high end sits at most h / WALL_STEPS into the ground, never above it.
  const n = Math.min(WALL_STEPS - 1, Math.floor((Math.abs(yb - ya) / h) * WALL_STEPS));
  const shape: PartDef['shape'] =
    n === 0
      ? 'box'
      : { type: 'prism', id: `rural-wall-${n}`, outline: [[0, 0], [1, n / WALL_STEPS], [1, 1], [0, 1]] };
  // Local +x runs from the low end to the high end of the bottom edge.
  const yaw = Math.atan2(-dz, dx) + (yb < ya ? Math.PI : 0);
  return {
    shape,
    at: [(a[0] + b[0]) / 2, low + h / 2, (a[1] + b[1]) / 2],
    size: [len, h, t],
    rot: [0, yaw, 0],
    color,
    ...extras,
  };
}

/**
 * A roof slab `t` thick lying on the outside of the line q0 â†’ q1 in a vertical x/y section (the
 * side away from `inside`), `depth` long along z and centred at z = zc. Its inner face is exactly
 * the line, so slabs meeting at a convex kink or ridge (and the gable under them) only touch.
 */
export function roofSlab(
  q0: P2,
  q1: P2,
  t: number,
  depth: number,
  zc: number,
  inside: P2,
  color: string | number,
  extras: PartExtras = {},
): PartDef {
  const dx = q1[0] - q0[0];
  const dy = q1[1] - q0[1];
  const len = Math.hypot(dx, dy);
  let nx = -dy / len;
  let ny = dx / len;
  const mx = (q0[0] + q1[0]) / 2;
  const my = (q0[1] + q1[1]) / 2;
  if ((inside[0] - mx) * nx + (inside[1] - my) * ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  return {
    shape: 'box',
    at: [mx + (nx * t) / 2, my + (ny * t) / 2, zc],
    size: [len, t, depth],
    rot: [0, 0, Math.atan2(dy, dx)],
    color,
    ...extras,
  };
}

/** Default yaw of the farm/industry buildings: front toward the centreline (or the player). */
export function faceCentreline(ctx: StructureContext): number {
  const side = Math.sign(ctx.d);
  return side === 0 ? Math.PI : (side * Math.PI) / 2;
}

/** Decor box (render only). */
export function deco(at: V3, size: V3, color: string | number, extras: PartExtras = {}, rot?: V3): PartDef {
  return { shape: 'box', at, size, color, decor: true, ...(rot ? { rot } : {}), ...extras };
}

// -------------------------------------------------------------------------------------------
// Barn
// -------------------------------------------------------------------------------------------

const W = 10;
const D = 14;
/** Eave height above the ground at the origin. */
const H = 4.2;
const T = 0.25;
/** Gambrel profile above the eave (x, y): eave corner, kink (lower slope 60Â°), ridge (upper 30Â°). */
const KINK: P2 = [3.5, 2.6];
const RIDGE = 4.6;
const ROOF_T = 0.18;
/** Lower slabs reach this far past the wall (along the slope); slabs overhang the gables by ROOF_Z. */
const EAVE_OUT = 0.45;
const ROOF_Z = 0.4;
const GABLE: readonly P2[] = [
  [-W / 2, 0],
  [W / 2, 0],
  KINK,
  [0, RIDGE],
  [-KINK[0], KINK[1]],
];
const FRONT_Z = D / 2 - T / 2;
const SIDE_X = W / 2 - T / 2;
const SIDE_Z = D / 2 - T;

/** A sliding door leaf (white frame, red leaf, white X brace) on the front face, bottom at y0. */
function doorLeaf(x: number, y0: number, h: number, w: number, piece: string): PartDef[] {
  const z = D / 2;
  const diag = Math.hypot(w - 0.2, h - 0.2);
  const ang = Math.atan2(h - 0.2, w - 0.2);
  const yc = y0 + h / 2;
  return [
    deco([x, yc, z + 0.02], [w + 0.16, h + 0.1, 0.04], 'trim', { piece }),
    deco([x, yc, z + 0.045], [w - 0.06, h - 0.08, 0.05], 'wall', { piece }),
    deco([x, yc, z + 0.085], [diag, 0.14, 0.03], 'trim', { piece }, [0, 0, ang]),
    deco([x, yc, z + 0.085], [diag, 0.14, 0.03], 'trim', { piece }, [0, 0, -ang]),
  ];
}

function sideWindow(sx: number, z: number, piece: string): PartDef[] {
  const x = sx * (W / 2);
  return [
    deco([x + sx * 0.02, 2.4, z], [0.04, 1.05, 1.15], 'trim', { piece }),
    deco([x + sx * 0.045, 2.4, z], [0.05, 0.85, 0.95], 'glass', { piece }),
  ];
}

function build(ctx: StructureContext): PartDef[] {
  const parts: PartDef[] = [];
  const g = ctx.groundAt;
  const wall = (a: P2, b: P2, piece: string): PartDef =>
    groundWall(ctx, a, b, T, H, 'wall', { piece, name: 'wall' });
  // Walls: front and back span the full width, the sides sit between them in two panels each.
  parts.push(wall([-W / 2, FRONT_Z], [W / 2, FRONT_Z], 'front'));
  parts.push(wall([W / 2, -FRONT_Z], [-W / 2, -FRONT_Z], 'back'));
  for (const sx of [-1, 1]) {
    for (const [z0, z1, id] of [[-SIDE_Z, 0, 'A'], [0, SIDE_Z, 'B']] as const) {
      const piece = `side${sx > 0 ? 'R' : 'L'}${id}`;
      parts.push(wall([sx * SIDE_X, z0], [sx * SIDE_X, z1], piece));
      parts.push(...sideWindow(sx, (z0 + z1) / 2, piece));
    }
  }
  // Gambrel gables on the front and back walls.
  for (const [sz, piece] of [[1, 'gableF'], [-1, 'gableB']] as const) {
    parts.push({
      shape: { type: 'prism', id: 'barn-gable', outline: GABLE },
      piece,
      name: 'gable',
      at: [0, H + RIDGE / 2, sz * FRONT_Z],
      size: [W, RIDGE, T],
      color: 'wall',
    });
  }
  // Roof: steep lower and shallow upper slab on each side.
  const depth = D + 2 * ROOF_Z;
  const inside: P2 = [0, H + 1];
  const slab = (q0: P2, q1: P2, piece: string): PartDef =>
    roofSlab(q0, q1, ROOF_T, depth, 0, inside, 'roof', { piece, name: 'roof' });
  for (const sx of [-1, 1]) {
    const eave: P2 = [sx * (W / 2), H];
    const kink: P2 = [sx * KINK[0], H + KINK[1]];
    const ex = eave[0] - kink[0];
    const ey = eave[1] - kink[1];
    const el = Math.hypot(ex, ey);
    const lip: P2 = [eave[0] + (ex / el) * EAVE_OUT, eave[1] + (ey / el) * EAVE_OUT];
    const side = sx > 0 ? 'R' : 'L';
    parts.push(slab(lip, kink, `roof${side}1`));
    parts.push(slab(kink, [0, H + RIDGE], `roof${side}2`));
    // Trim strip along the gambrel kink.
    const trim: V3 = [kink[0] + sx * 0.08, kink[1] + 0.1, 0];
    parts.push(deco(trim, [0.22, 0.1, depth + 0.02], 'trim', { piece: `roof${side}1` }));
  }
  // Ridge cap and a louvred cupola with a weathervane on the ridge.
  const top = H + RIDGE;
  const cupola = { piece: 'roofL2' };
  parts.push(deco([0, top + 0.08, 0], [0.4, 0.14, depth + 0.04], 'roof', { piece: 'roofR2' }));
  parts.push(deco([0, top + 0.55, 0], [1.3, 1.0, 1.3], 'trim', cupola));
  parts.push(deco([0, top + 0.6, 0], [1.34, 0.5, 0.8], 0x2b2b2b, cupola));
  // A 4-sided kit cone is a square pyramid with its edges along x and z (base side 0.71 × size).
  parts.push({
    shape: { type: 'cone', segments: 4 },
    at: [0, top + 1.45, 0],
    size: [2.1, 0.8, 2.1],
    color: 'roof',
    decor: true,
    ...cupola,
  });
  parts.push(deco([0, top + 2.2, 0], [0.05, 0.9, 0.05], 0x2b2b2b, cupola));
  parts.push(deco([0, top + 2.4, 0], [0.05, 0.05, 0.75], 0x2b2b2b, cupola));

  // Front: sliding double doors under a track, a hayloft door and hay beam on the gable.
  const doorW = 2.1;
  const front = { piece: 'front' };
  for (const sx of [-1, 1]) {
    const x = sx * (doorW / 2 + 0.02);
    const y0 = g(x, D / 2) - 0.02;
    parts.push(...doorLeaf(x, y0, Math.min(3.3, H - 0.6 - y0), doorW, 'front'));
  }
  const trackY = Math.min(3.3 + Math.max(g(-1, D / 2), g(1, D / 2)), H - 0.6) + 0.22;
  parts.push(deco([0, trackY, D / 2 + 0.04], [2 * doorW + 0.5, 0.18, 0.08], 'trim', front));
  const loftY = H + 1.85;
  const gableF = { piece: 'gableF' };
  const gableB = { piece: 'gableB' };
  parts.push(deco([0, loftY, D / 2 + 0.02], [1.75, 1.75, 0.04], 'trim', gableF));
  parts.push(deco([0, loftY, D / 2 + 0.045], [1.5, 1.5, 0.05], 'wall', gableF));
  for (const s of [-1, 1]) {
    const rot: V3 = [0, 0, (s * Math.PI) / 4];
    parts.push(deco([0, loftY, D / 2 + 0.085], [1.9, 0.12, 0.03], 'trim', gableF, rot));
  }
  parts.push(deco([0, H + 3.75, D / 2 + 0.55], [0.22, 0.22, 1.1], 'trim', gableF));
  parts.push(deco([0, H + 2.0, -D / 2 - 0.02], [1.15, 1.15, 0.04], 'trim', gableB));
  parts.push(deco([0, H + 2.0, -D / 2 - 0.045], [0.9, 0.9, 0.05], 'glass', gableB));
  // White corner boards from the ground at each corner up to the eave.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (W / 2 - 0.07);
      const z = sz * (D / 2 - 0.07);
      const y0 = Math.min(g(x, z), g(x - sx * 0.3, z), g(x, z - sz * 0.3)) - 0.05;
      const at: V3 = [x + sx * 0.03, (y0 + H) / 2, z + sz * 0.03];
      parts.push(deco(at, [0.22, H - y0, 0.22], 'trim', { piece: sz > 0 ? 'front' : 'back' }));
    }
  }
  return parts;
}

/**
 * The ruined barn (ObstaclePlacement.variant 'ruined', see ./ruin.ts): its +x side's roof gone with a
 * wall panel under it (the back-gable collapse is kept below but no longer chosen); the flood line
 * on its planks, windows broken.
 */
function ruinedBarn(ctx: StructureContext): { parts: PartDef[]; mass: number } {
  const intact = build(ctx);
  // Always the +x side collapse (its roof and a wall panel under it): a level author turns the ruin
  // (yaw) so that side faces up the course, where the chase camera comes from (playtest 2 review).
  const side: number = 1;
  const s = side > 0 ? 'R' : 'L';
  const sideCollapse: boolean = true;
  const panel = `side${s}${ctx.rng() < 0.5 ? 'A' : 'B'}`;
  const gone = sideCollapse ? [`roof${s}1`, `roof${s}2`, panel] : ['roofL2', 'roofR2', 'gableB'];
  const w = W / 2;
  const h = D / 2;
  const parts = ruinParts(ctx, intact, {
    gone,
    faces: [
      { a: [-w, h], b: [w, h], piece: 'front', color: 'wall' },
      { a: [w, -h], b: [-w, -h], piece: 'back', color: 'wall' },
      { a: [w, -h], b: [w, 0], piece: 'sideRA', color: 'wall' },
      { a: [w, 0], b: [w, h], piece: 'sideRB', color: 'wall' },
      { a: [-w, 0], b: [-w, -h], piece: 'sideLA', color: 'wall' },
      { a: [-w, h], b: [-w, 0], piece: 'sideLB', color: 'wall' },
    ],
    rubble: sideCollapse
      ? { at: [side * (w + 1.2), panel.endsWith('A') ? -h / 2 : h / 2], along: [0, 1], length: h }
      : { at: [0, -(h + 1.2)], along: [1, 0], length: W },
    sag: 'z',
  });
  return { parts, mass: ruinMass(16, intact, parts) };
}

const barn: StructureDef = {
  kind: 'barn',
  label: 'Barn',
  material: 'wood',
  building: true,
  footprint: 10,
  palettes: {
    // Barn red (iron-oxide paint) in a few weathered shades.
    wall: [0x9b2d20, 0x8c271c, 0xa8382a, 0x7f2419],
    // Dark grey or green standing-seam metal, weathered shingles, galvanised steel.
    roof: [0x4b5157, 0x3f5a46, 0x5a4a42, 0x6b7075],
    trim: [0xefe9dc, 0xf4f1ea],
    glass: [0x26313b],
  },
  breakup: { impulseScale: 0.75, spin: 0.45, falloff: 3.5, floor: 0.25 },
  variants: ['ruined'],
  defaultYaw: faceCentreline,
  build: (ctx) => {
    const ruin = ctx.variant === 'ruined' ? ruinedBarn(ctx) : null;
    return [
      {
        part: 'barn',
        stand: 'anchored',
        ground: 'fixed',
        mass: ruin ? ruin.mass : 16,
        breakSpeed: ruin ? 11 * RUIN.strength : 11,
        breakMode: 'shatter',
        parts: ruin ? ruin.parts : build(ctx),
      },
    ];
  },
};

export default barn;
