import { getGeom } from '../shapes';
import { shapeKey, type PartDef, type StructureContext, type V3 } from './kit';

/** A point in the structure's horizontal plane (x, z). */
type P2 = readonly [number, number];

/** Decor box (render only), as barn.ts deco (not imported: barn.ts imports this module). */
const deco = (at: V3, size: V3, color: number, extras: { piece?: string }, rot?: V3): PartDef => ({
  shape: 'box',
  at,
  size,
  color,
  decor: true,
  ...(rot ? { rot } : {}),
  ...extras,
});

/**
 * THE 'ruined' LOOK (ObstaclePlacement.variant): an abandoned building the floods have been through
 * again and again, built from the kind's own parts. What it shows, all at once so it reads at speed:
 * - part of the roof and one wall section gone (those parts are simply not built, so the colliders
 *   are exactly the parts that remain: a ruin collides as the shell it looks like);
 * - a level brown flood line on every remaining outer wall (water stands level), with the wall below
 *   it stained by mud;
 * - every window broken (dark), some boarded over with planks;
 * - a heap of rubble where the wall came down;
 * - weathered, greyed colours and no smoke from the chimney: nobody lives here.
 * Weaker and lighter than the intact building (RUIN): soaked, half-fallen walls give way sooner.
 * Everything added is render-only box decor (one shared kit geometry, so no new draw calls).
 * Kinds opt in with StructureDef.variants = ['ruined'] and call ruinParts from their build (house,
 * chalet, barn).
 */

export const RUIN = {
  /** Break speed of a ruin as a share of the intact building's (strength ∝ breakSpeed). */
  strength: 0.55,
  /** Mass of a ruin: this share of the collider weight that remains standing. */
  massShare: 0.5,
  /** Flood line height range (m above the ground at the building's origin). */
  flood: [1.1, 1.9] as const,
  /** Colours (sRGB): broken window, dried mud (weathering, rubble), the stain below the flood line, the dark tide line, planks. */
  broken: 0x111315,
  mud: 0x5c4b36,
  stain: 0x8c7a5c,
  tide: 0x2e261c,
  plank: 0x6e5a42,
  /** The roof that remains sags: tilted this much (rad, a random share of the range) along its ridge and sunk. */
  sag: [0.07, 0.13] as const,
  sagDrop: 0.25,
  /** Weathering: desaturation and darkening of every colour, then a pull toward the mud. */
  grey: 0.45,
  dark: 0.8,
  toMud: 0.14,
} as const;

/** One outer wall face for the flood marks: its base line a → b in structure x/z and its piece. */
export interface RuinFace {
  readonly a: P2;
  readonly b: P2;
  /** The face's wall piece: no marks when that piece is gone. */
  readonly piece: string;
  /** Wall colour (palette name or 0xRRGGBB) the mud stain is mixed from. */
  readonly color: string | number;
  /** Lowest structure y the stain starts from (default: the ground under the face). */
  readonly y0?: number;
}

export interface RuinPlan {
  /** Pieces not built at all (roof slabs that fell in, a wall section that went). */
  readonly gone: readonly string[];
  /** Outer wall faces that get the flood line and mud stain. */
  readonly faces: readonly RuinFace[];
  /** Where the fallen wall lies: a rubble heap centred here (structure x/z), this wide. */
  readonly rubble?: { readonly at: P2; readonly along: P2; readonly length: number };
  /**
   * Structure y of the ground where the build's y = 0 is not the origin's ground (the house sits on
   * the lowest ground under its footprint): subtracted from ctx.groundAt.
   */
  readonly groundShift?: number;
  /**
   * The roof slabs that remain (collider parts named 'roof') sag: tilted along the ridge, which runs
   * along this structure axis, and sunk RUIN.sagDrop; the decor of their pieces (chimney, ridge cap,
   * trim) fell with them.
   */
  readonly sag?: 'x' | 'z';
}

const ch = (c: number, k: number): number => (c >> k) & 0xff;
const rgb = (r: number, g: number, b: number): number =>
  (Math.round(Math.min(255, Math.max(0, r))) << 16) | (Math.round(Math.min(255, Math.max(0, g))) << 8) | Math.round(Math.min(255, Math.max(0, b)));

/** Mix two sRGB colours (t = share of b). */
export function mixColor(a: number, b: number, t: number): number {
  return rgb(
    ch(a, 16) + (ch(b, 16) - ch(a, 16)) * t,
    ch(a, 8) + (ch(b, 8) - ch(a, 8)) * t,
    ch(a, 0) + (ch(b, 0) - ch(a, 0)) * t,
  );
}

/** A colour aged by floods and neglect: greyed, darkened, a little toward the mud. */
export function weathered(c: number): number {
  const r = ch(c, 16);
  const g = ch(c, 8);
  const b = ch(c, 0);
  const y = 0.3 * r + 0.59 * g + 0.11 * b;
  const k = RUIN.grey;
  const grey = rgb((r + (y - r) * k) * RUIN.dark, (g + (y - g) * k) * RUIN.dark, (b + (y - b) * k) * RUIN.dark);
  return mixColor(grey, RUIN.mud, RUIN.toMud);
}

const resolve = (ctx: StructureContext, c: string | number): number => (typeof c === 'number' ? c : ctx.palette(c));

/** Planks nailed across a window pane (decor `p`), on its outer side. */
function boards(ctx: StructureContext, p: PartDef): PartDef[] {
  const [sx, sy, sz] = p.size;
  const facesZ = sz <= sx;
  const w = facesZ ? sx : sz;
  if (w < 0.4 || sy < 0.4) return [];
  const out: PartDef[] = [];
  const n = ctx.rng() < 0.5 ? 1 : 2;
  for (let i = 0; i < n; i++) {
    const tilt = (i === 0 ? 1 : -1) * (0.35 + 0.25 * ctx.rng());
    const y = p.at[1] + (n === 1 ? 0 : (i === 0 ? 0.18 : -0.18) * sy);
    if (facesZ) {
      const z = p.at[2] + Math.sign(p.at[2] || 1) * (sz / 2 + 0.025);
      out.push(deco([p.at[0], y, z], [w * 1.2, 0.14, 0.035], RUIN.plank, { piece: p.piece }, [0, 0, tilt]));
    } else {
      const x = p.at[0] + Math.sign(p.at[0] || 1) * (sx / 2 + 0.025);
      out.push(deco([x, y, p.at[2]], [0.035, 0.14, w * 1.2], RUIN.plank, { piece: p.piece }, [tilt, 0, 0]));
    }
  }
  return out;
}

/** Lowest structure y of the ground along a → b (five samples). */
function lowAlong(ctx: StructureContext, a: P2, b: P2, shift: number): number {
  let low = Infinity;
  for (let i = 0; i <= 4; i++) {
    low = Math.min(low, ctx.groundAt(a[0] + ((b[0] - a[0]) * i) / 4, a[1] + ((b[1] - a[1]) * i) / 4) - shift);
  }
  return low;
}

/**
 * The ruined version of a building's parts (see the header): `parts` is the intact build. Returns
 * the parts that remain (weathered, windows broken, no plumes) plus the decor of the flood marks,
 * boards and rubble. Deterministic per placement (ctx.rng).
 */
export function ruinParts(ctx: StructureContext, parts: readonly PartDef[], plan: RuinPlan): PartDef[] {
  const gone = new Set(plan.gone);
  const shift = plan.groundShift ?? 0;
  const out: PartDef[] = [];
  const panes: PartDef[] = [];
  const sagging = new Set(
    plan.sag ? parts.filter((p) => !p.decor && p.name === 'roof' && !gone.has(p.piece ?? '')).map((p) => p.piece ?? '') : [],
  );
  const sag = (RUIN.sag[0] + (RUIN.sag[1] - RUIN.sag[0]) * ctx.rng()) * (ctx.rng() < 0.5 ? 1 : -1);
  for (const p of parts) {
    if (p.piece !== undefined && gone.has(p.piece)) continue;
    const { plume: _smoke, ...rest } = p;
    if (p.piece !== undefined && sagging.has(p.piece)) {
      if (p.decor) continue;
      const [rx, ry, rz] = p.rot ?? [0, 0, 0];
      const rot: V3 = plan.sag === 'x' ? [rx, ry, rz + sag] : [rx + sag, ry, rz];
      out.push({ ...rest, at: [p.at[0], p.at[1] - RUIN.sagDrop, p.at[2]], rot, color: weathered(resolve(ctx, p.color)) });
      continue;
    }
    if (p.decor && p.color === 'glass') {
      const pane = { ...rest, color: RUIN.broken };
      out.push(pane);
      panes.push(pane);
      continue;
    }
    out.push({ ...rest, color: weathered(resolve(ctx, p.color)) });
  }
  for (const pane of panes) if (ctx.rng() < 0.45) out.push(...boards(ctx, pane));

  // The flood line: one level for the whole building.
  const flood = RUIN.flood[0] + (RUIN.flood[1] - RUIN.flood[0]) * ctx.rng();
  for (const f of plan.faces) {
    if (gone.has(f.piece)) continue;
    const dx = f.b[0] - f.a[0];
    const dz = f.b[1] - f.a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.5) continue;
    let nx = -dz / len;
    let nz = dx / len;
    const mx = (f.a[0] + f.b[0]) / 2;
    const mz = (f.a[1] + f.b[1]) / 2;
    if (nx * mx + nz * mz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const y0 = f.y0 ?? lowAlong(ctx, f.a, f.b, shift) - 0.05;
    if (flood - y0 < 0.25) continue;
    const yaw = Math.atan2(-dz, dx);
    const wall = resolve(ctx, f.color);
    const stain = mixColor(weathered(wall), RUIN.stain, 0.6);
    const piece = { piece: f.piece };
    out.push(deco([mx + nx * 0.016, (y0 + flood) / 2, mz + nz * 0.016], [len + 0.01, flood - y0, 0.02], stain, piece, [0, yaw, 0]));
    out.push(deco([mx + nx * 0.03, flood, mz + nz * 0.03], [len + 0.03, 0.11, 0.03], RUIN.tide, piece, [0, yaw, 0]));
  }

  // Rubble where the wall came down: a few broken blocks half sunk in the ground.
  if (plan.rubble) {
    const { at, along, length } = plan.rubble;
    const al = Math.hypot(along[0], along[1]) || 1;
    const ux = along[0] / al;
    const uz = along[1] / al;
    const colors = out.filter((p) => !p.decor).map((p) => p.color as number);
    const n = 5;
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1) - 0.5) * length + (ctx.rng() - 0.5) * 0.8;
      const off = (ctx.rng() - 0.3) * 1.6;
      const x = at[0] + ux * t - uz * off;
      const z = at[1] + uz * t + ux * off;
      const sx = 0.6 + 0.9 * ctx.rng();
      const sy = 0.3 + 0.4 * ctx.rng();
      const sz = 0.5 + 0.8 * ctx.rng();
      const y = ctx.groundAt(x, z) - shift + sy * 0.25;
      const c = colors.length ? colors[Math.floor(ctx.rng() * colors.length)] : RUIN.mud;
      const rot: V3 = [(ctx.rng() - 0.5) * 0.6, ctx.rng() * Math.PI, (ctx.rng() - 0.5) * 0.6];
      out.push(deco([x, y, z], [sx, sy, sz], mixColor(c, RUIN.mud, 0.3), {}, rot));
    }
  }
  return out;
}

/**
 * Mass of a ruin: RUIN.massShare of the intact mass times the share of the collider weight that
 * remains (weights as the kit splits a body's mass: PartDef.weight, else the shape's volume).
 */
export function ruinMass(intactMass: number, intact: readonly PartDef[], ruined: readonly PartDef[]): number {
  const w = (ps: readonly PartDef[]): number =>
    ps
      .filter((p) => !p.decor)
      .reduce((a, p) => a + (p.weight ?? getGeom(shapeKey(p.shape)).volume * p.size[0] * p.size[1] * p.size[2]), 0);
  const all = w(intact);
  return all > 0 ? intactMass * RUIN.massShare * (w(ruined) / all) : intactMass * RUIN.massShare;
}
