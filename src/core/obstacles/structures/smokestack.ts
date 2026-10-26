import { Euler, Quaternion, Vector3 } from 'three';
import type { BodyDef, PartDef, StructureContext, StructureDef, V3 } from './kit';

/**
 * An industrial chimney: a 40 m tapered shaft (4.4 m at the foot, 2.6 m at the top) of concrete or
 * brick on a 1.5 m plinth; the top half is painted in red/white aviation bands, with a soot-stained
 * lip, a service platform and railing at ~37 m, a ladder, red obstruction lights and a flue door.
 *
 * Topples in two segments:
 * - the 31.5 m shaft: anchored, breaks at 30 m/s for a 30 t iceberg (breakImpulse 1125 t·m/s;
 *   100 t: 9 m/s, 220 t: 4.1 m/s) and UPROOTS with the hit applied at its centre of percussion, so
 *   it pivots about its foot and falls in the push direction as one rigid column;
 * - the 10 m painted top (with platform, lip and lights): RESTS on the shaft (asleep, nothing
 *   jointed) and breaks away as the shaft goes over.
 * Why not more segments: the kit cannot joint pieces or spin a column about its foot. A shattered
 * column (tried: impulse shares growing with height) only slides apart; on weak hits the middle
 * segment often fell back toward the iceberg and segments were left stacked on a standing stump.
 *
 * Every 2.5 m band is one tapered-cylinder collider (all share a shape key: the radius shrinks
 * geometrically, so every band has the same taper; the first band runs down through the plinth,
 * which is decor). Masses: shaft 70 t, top 15 t ("game" masonry: the iceberg keeps
 * 1 - 1.25·70/(M + 70) of its speed when it knocks the shaft over: ~12 % at 30 t, ~49 % at 100 t,
 * ~70 % at 220 t). The top uses the proxy label 'deck', the kit's convention for a body carried
 * above the ground by another (the shared kit test exempts exactly that label from the "stands on
 * the ground" check).
 */

const PLINTH_H = 1.5;
const PLINTH_D = 5.6;
const BASE_D = 4.4;
const BAND_H = 2.5;
const BANDS = 16;
const HEIGHT = PLINTH_H + BANDS * BAND_H;
/** Per-band taper (top/bottom diameter), rounded like the shape kit's key so sizes match it. */
const K = Math.round((2.6 / BASE_D) ** (1 / BANDS) * 1000) / 1000;
/** First band of the resting top section. */
const TOP_FROM = 12;
/** Bands from this index up are painted, alternating, with the top band red. */
const PAINT_FROM = 8;
const SHAFT_MASS = 70;
const TOP_MASS = 15;
/** The foot band is 1.6x a band's height and carries the plinth: extra mass weight. */
const FOOT_EXTRA = 0.9;
const SINK = 0.05;
const SEGS = 12;
const BAND_SHAPE = { type: 'cylinder', segments: SEGS, taper: K } as const;
const DRUM = { type: 'cylinder', segments: SEGS } as const;
/** The first band continues down through the plinth to the ground (same geometric taper). */
const FOOT_D = BASE_D * K ** (-PLINTH_H / BAND_H);
const FOOT_SHAPE = {
  type: 'cylinder',
  segments: SEGS,
  taper: Math.round(K ** ((PLINTH_H + BAND_H) / BAND_H) * 1000) / 1000,
} as const;
const STEEL = 0x4a4f54;
const RAIL = 0x50565c;

const _q = new Quaternion();
const _e = new Euler();
const _d = new Vector3();
const UP = new Vector3(0, 1, 0);

/** Outer diameter of the shaft at the bottom of band i. */
const diameter = (i: number): number => BASE_D * K ** i;
const bandY = (i: number): number => PLINTH_H + i * BAND_H;

function beam(a: V3, b: V3, w: number, color: string | number): PartDef {
  _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _d.length();
  _e.setFromQuaternion(_q.setFromUnitVectors(UP, _d.normalize()), 'XYZ');
  return {
    shape: 'box',
    at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    size: [w, len, w],
    rot: [_e.x, _e.y, _e.z],
    color,
    decor: true,
  };
}

/** Lowest ground (relative, nominal m) under a circle of radius r around the origin. */
function lowestGround(ctx: StructureContext, r: number): number {
  let lo = ctx.groundAt(0, 0);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    lo = Math.min(lo, ctx.groundAt(r * Math.sin(a), r * Math.cos(a)));
  }
  return lo;
}

/** Centre of percussion (height above the foot) of parts pivoting about the foot. */
function percussionHeight(parts: readonly { y: number; h: number; m: number }[]): number {
  let my = 0;
  let inertia = 0;
  for (const p of parts) {
    my += p.m * p.y;
    inertia += p.m * (p.y * p.y + (p.h * p.h) / 12);
  }
  return inertia / my;
}

/**
 * Band colliders first..last-1 (structure heights minus y0, the body origin), with the ladder
 * rails along them. Returns the parts and their mass list for the centre of percussion.
 */
function bands(
  ctx: StructureContext,
  first: number,
  last: number,
  y0: number,
): { parts: PartDef[]; masses: { y: number; h: number; m: number }[] } {
  const shaft = ctx.palette('shaft');
  const parts: PartDef[] = [];
  const masses: { y: number; h: number; m: number }[] = [];
  for (let i = first; i < last; i++) {
    const d = diameter(i);
    const painted = i >= PAINT_FROM;
    const red = painted && (BANDS - 1 - i) % 2 === 0;
    const foot = i === 0;
    const yb = foot ? 0 : bandY(i);
    const h = foot ? bandY(1) : BAND_H;
    const m = (foot ? 1 + FOOT_EXTRA : 1) * d * d;
    parts.push({
      shape: foot ? FOOT_SHAPE : BAND_SHAPE,
      name: 'shaft',
      at: [0, yb + h / 2 - y0, 0],
      size: foot ? [FOOT_D, h, FOOT_D] : [d, BAND_H, d],
      color: painted ? (red ? 'red' : 'white') : shaft,
      weight: m,
    });
    masses.push({ y: yb + h / 2 - y0, h, m });
  }
  // Ladder rails up the back of the shaft, following the taper.
  const r0 = diameter(first) / 2 + 0.22;
  const r1 = diameter(last) / 2 + 0.22;
  const ya = bandY(first) - y0 + 0.05;
  const yb = bandY(last) - y0 - 0.05;
  for (const x of [-0.25, 0.25]) parts.push(beam([x, ya, -r0], [x, yb, -r1], 0.07, STEEL));
  return { parts, masses };
}

function shaftBody(ctx: StructureContext, base: number): BodyDef {
  const { parts, masses } = bands(ctx, 0, TOP_FROM, 0);
  parts.push(
    // The plinth is decor round the foot of the first band, which runs down to the ground as one
    // solid collider.
    {
      shape: DRUM,
      at: [0, PLINTH_H / 2, 0],
      size: [PLINTH_D, PLINTH_H, PLINTH_D],
      color: 'plinth',
      decor: true,
    },
    // Steel door in the plinth and the flue inlet above it.
    {
      shape: 'box',
      at: [0, 1.0, PLINTH_D / 2 - 0.04],
      size: [1.0, 1.8, 0.12],
      color: 0x4a5056,
      decor: true,
    },
    {
      shape: 'box',
      at: [0, PLINTH_H + 1.3, FOOT_D / 2 - 0.08],
      size: [1.3, 2.0, 0.14],
      color: 0x2c2b2a,
      decor: true,
    },
  );
  return {
    part: 'smokestack',
    stand: 'anchored',
    at: [0, base, 0],
    ground: 'fixed',
    mass: SHAFT_MASS,
    breakSpeed: 30,
    breakMode: 'uproot',
    proxy: 'trunk',
    trunkRadius: PLINTH_D / 2 - 0.2,
    shake: 'tilt',
    hitHeight: percussionHeight(masses),
    parts,
  };
}

function topBody(ctx: StructureContext, base: number): BodyDef {
  const y0 = bandY(TOP_FROM);
  const { parts } = bands(ctx, TOP_FROM, BANDS, y0);
  const top = HEIGHT - y0;
  const dt = diameter(BANDS);
  // Soot-stained lip and cornice ring.
  parts.push(
    {
      shape: BAND_SHAPE,
      at: [0, top - 0.45, 0],
      size: [(dt * 1.035) / K, 0.9, (dt * 1.035) / K],
      color: 0x2a2826,
      decor: true,
    },
    {
      shape: DRUM,
      at: [0, top - 0.2, 0],
      size: [dt + 0.5, 0.4, dt + 0.5],
      color: 0x3a3836,
      decor: true,
      // The mouth: dark smoke rises from here while the top stands on the shaft.
      plume: 'smoke',
    },
  );
  // Service platform with a railing, two bands below the top.
  const py = bandY(BANDS - 2) - y0 + 0.4;
  const pd = diameter(BANDS - 2) + 2.2;
  parts.push({ shape: DRUM, at: [0, py, 0], size: [pd, 0.22, pd], color: RAIL, decor: true });
  const n = 10;
  const pr = pd / 2 - 0.1;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const p0: V3 = [pr * Math.sin(a0), py + 1.1, pr * Math.cos(a0)];
    const p1: V3 = [pr * Math.sin(a1), py + 1.1, pr * Math.cos(a1)];
    parts.push(beam([p0[0], py, p0[2]], p0, 0.06, RAIL), beam(p0, p1, 0.06, RAIL));
  }
  // Red obstruction lights on two sides near the top.
  for (const z of [-1, 1]) {
    parts.push({
      shape: 'box',
      at: [0, top - 1.4, z * (dt / 2 + 0.12)],
      size: [0.3, 0.3, 0.2],
      color: 0xd2261c,
      decor: true,
    });
  }
  return { part: 'deck', stand: 'resting', at: [0, base + y0, 0], ground: 'fixed', mass: TOP_MASS, parts };
}

const smokestack: StructureDef = {
  kind: 'smokestack',
  label: 'Smokestack',
  material: 'masonry',
  building: true,
  footprint: 3.2,
  palettes: {
    // Board-marked concrete or factory brick.
    shaft: [0xbdb8ae, 0xaca89f, 0xc6c1b7, 0x9a5641, 0x8c4b37],
    plinth: [0x8f8b84, 0x9c978f, 0x85817a],
    red: [0xc4372b, 0xb83226],
    white: [0xefebe3],
  },
  defaultYaw: (ctx) => ctx.rng() * Math.PI * 2,
  build(ctx) {
    const base = lowestGround(ctx, FOOT_D / 2) - SINK;
    return [shaftBody(ctx, base), topBody(ctx, base)];
  },
};

export default smokestack;
