import { Euler, Quaternion, Vector3 } from 'three';
import type { BodyDef, PartDef, StructureContext, StructureDef, V3 } from './kit';

/**
 * A coastal lighthouse: an octagonal granite plinth, a 24 m tapered masonry tower (5.8 m -> 3.8 m)
 * in six alternating white/colour bands, an iron gallery with railing, a lit lantern room (warm
 * glass with dark mullions and a parapet) under a cap with a vent ball and lightning rod, plus a
 * door, a step and small windows. ~31 m tall.
 *
 * Topples in two segments:
 * - the tower with its gallery: anchored, breaks at 25 m/s for a 30 t iceberg (breakImpulse
 *   937.5 t·m/s; 100 t: 7.5 m/s, 220 t: 3.4 m/s) and UPROOTS with the hit applied at its centre of
 *   percussion, so it pivots about its foot and falls in the push direction as one rigid column;
 * - the lantern head (lantern, cap): RESTS on the gallery (asleep, nothing jointed) and is thrown
 *   off as the tower goes over (the uproot's jolt pops it loose), landing near the foot or beyond.
 * The tower is slender (5.8 m at the foot) so even a big iceberg barely above the break speed tips
 * it past balance; it then falls slowly under its own weight.
 * Why not more segments: the kit cannot joint pieces or spin a column about its foot. A shattered
 * column (tried: impulse shares growing with height) only slides apart; on weak hits the middle
 * piece often fell back toward the iceberg and pieces were left stacked on a standing stump.
 *
 * Each band is one tapered-cylinder collider; bands share one shape key (the radius shrinks
 * geometrically, so every band has the same taper); the first band runs down through the plinth
 * (decor) to the ground. Masses: tower 62 t, head 8 t ("game" masonry: the iceberg keeps
 * 1 - 1.25·62/(M + 62) of its speed when it knocks the tower over: ~16 % at 30 t, ~52 % at 100 t).
 * The head uses the proxy label 'deck', the kit's convention for a body carried above the ground
 * by another (the shared kit test exempts exactly that label from the "stands on the ground"
 * check).
 */

const PLINTH_H = 1.6;
const PLINTH_D = 7;
const BASE_D = 5.8;
const BAND_H = 4;
const BANDS = 6;
/** Per-band taper, rounded like the shape kit's key so the sizes match it. */
const K = Math.round((3.8 / BASE_D) ** (1 / BANDS) * 1000) / 1000;
const TOWER_TOP = PLINTH_H + BANDS * BAND_H;
const GALLERY_H = 0.4;
const GALLERY_D = 5.6;
const LANTERN_D = 2.9;
const LANTERN_H = 2.6;
const ROOF_D = 3.5;
const ROOF_H = 1.7;
const LANTERN_Y = TOWER_TOP + GALLERY_H;
const TOWER_MASS = 62;
const HEAD_MASS = 8;
const SINK = 0.05;
const BAND_SHAPE = { type: 'cylinder', segments: 16, taper: K } as const;
const OCTAGON = { type: 'cylinder', segments: 8 } as const;
/** The first band continues down through the plinth to the ground (same geometric taper). */
const FOOT_D = BASE_D * K ** (-PLINTH_H / BAND_H);
const FOOT_SHAPE = {
  type: 'cylinder',
  segments: 16,
  taper: Math.round(K ** ((PLINTH_H + BAND_H) / BAND_H) * 1000) / 1000,
} as const;
const IRON = 0x2c3135;

const _q = new Quaternion();
const _e = new Euler();
const _d = new Vector3();
const UP = new Vector3(0, 1, 0);

const diameter = (i: number): number => BASE_D * K ** i;
const bandY = (i: number): number => PLINTH_H + i * BAND_H;

function beam(a: V3, b: V3, w: number, color: number): PartDef {
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

function tower(ctx: StructureContext, base: number): BodyDef {
  const stripe = ctx.palette('stripe');
  let area = 0;
  for (let i = 0; i < BANDS; i++) area += diameter(i) ** 2;
  const masses: { y: number; h: number; m: number }[] = [];
  const parts: PartDef[] = [
    // The plinth is decor round the foot of the first band, which runs down to the ground as one
    // solid collider.
    {
      shape: OCTAGON,
      at: [0, PLINTH_H / 2, 0],
      size: [PLINTH_D, PLINTH_H, PLINTH_D],
      color: 'stone',
      decor: true,
    },
  ];
  for (let i = 0; i < BANDS; i++) {
    const d = diameter(i);
    const foot = i === 0;
    const y0 = foot ? 0 : bandY(i);
    const h = foot ? bandY(1) : BAND_H;
    const m = ((foot ? 0.92 : 0.8) * d * d) / area;
    parts.push({
      shape: foot ? FOOT_SHAPE : BAND_SHAPE,
      name: 'tower',
      at: [0, y0 + h / 2, 0],
      size: foot ? [FOOT_D, h, FOOT_D] : [d, BAND_H, d],
      color: i % 2 === 0 ? 'white' : stripe,
      weight: m,
    });
    masses.push({ y: y0 + h / 2, h, m });
    // A small window per band, alternating front and back (none on the door band).
    if (i > 0) {
      const r = ((d + diameter(i + 1)) / 4) * Math.cos(Math.PI / 16);
      const side = i % 2 === 0 ? 1 : -1;
      parts.push({
        shape: 'box',
        at: [0, bandY(i) + BAND_H / 2, side * (r + 0.02)],
        size: [0.55, 0.9, 0.06],
        color: 0x1d2630,
        decor: true,
      });
    }
  }
  // Door at the foot of the tower with a stone lintel, and a step up onto the plinth.
  const apothem = (PLINTH_D / 2) * Math.cos(Math.PI / 8);
  const doorR = (BASE_D / 2) * Math.cos(Math.PI / 16);
  parts.push(
    {
      shape: 'box',
      at: [0, PLINTH_H + 1.05, doorR + 0.03],
      size: [1.1, 2.1, 0.06],
      color: 0x2f4f6a,
      decor: true,
    },
    {
      shape: 'box',
      at: [0, PLINTH_H + 2.25, doorR + 0.04],
      size: [1.4, 0.3, 0.1],
      color: 0x8a8580,
      decor: true,
    },
    {
      shape: 'box',
      at: [0, PLINTH_H / 2, apothem + 0.35],
      size: [1.6, PLINTH_H, 0.7],
      color: 0x8a8580,
      decor: true,
    },
    {
      shape: { type: 'cylinder', segments: 16 },
      name: 'gallery',
      at: [0, TOWER_TOP + GALLERY_H / 2, 0],
      size: [GALLERY_D, GALLERY_H, GALLERY_D],
      color: IRON,
      weight: 0.06,
    },
  );
  masses.push({ y: TOWER_TOP + GALLERY_H / 2, h: GALLERY_H, m: 0.06 });
  // Railing round the gallery.
  const n = 12;
  const rr = GALLERY_D / 2 - 0.1;
  const ry = TOWER_TOP + GALLERY_H;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const p0: V3 = [rr * Math.sin(a0), ry + 1.0, rr * Math.cos(a0)];
    const p1: V3 = [rr * Math.sin(a1), ry + 1.0, rr * Math.cos(a1)];
    parts.push(beam([p0[0], ry, p0[2]], p0, 0.07, IRON), beam(p0, p1, 0.07, IRON));
  }
  return {
    part: 'lighthouse',
    stand: 'anchored',
    at: [0, base, 0],
    ground: 'fixed',
    mass: TOWER_MASS,
    breakSpeed: 25,
    breakMode: 'uproot',
    proxy: 'trunk',
    trunkRadius: (PLINTH_D / 2) * Math.cos(Math.PI / 8) - 0.15,
    shake: 'tilt',
    hitHeight: percussionHeight(masses),
    parts,
  };
}

function head(base: number): BodyDef {
  const parts: PartDef[] = [
    {
      shape: OCTAGON,
      name: 'lantern',
      at: [0, LANTERN_H / 2, 0],
      size: [LANTERN_D, LANTERN_H, LANTERN_D],
      color: 'lamp',
      weight: 0.6,
    },
    {
      shape: { type: 'cone', segments: 8 },
      name: 'lantern',
      at: [0, LANTERN_H + ROOF_H / 2, 0],
      size: [ROOF_D, ROOF_H, ROOF_D],
      color: 'cap',
      weight: 0.4,
    },
    // Parapet wall round the foot of the glazing, vent ball and lightning rod.
    {
      shape: OCTAGON,
      at: [0, 0.35, 0],
      size: [LANTERN_D + 0.16, 0.7, LANTERN_D + 0.16],
      color: IRON,
      decor: true,
    },
    {
      shape: OCTAGON,
      at: [0, LANTERN_H + ROOF_H + 0.15, 0],
      size: [0.6, 0.55, 0.6],
      color: IRON,
      decor: true,
    },
    {
      shape: 'box',
      at: [0, LANTERN_H + ROOF_H + 1.1, 0],
      size: [0.06, 1.6, 0.06],
      color: IRON,
      decor: true,
    },
  ];
  // Mullions at the lantern's eight corners (the octagon's vertices sit at odd multiples of pi/8).
  for (let i = 0; i < 8; i++) {
    const a = ((2 * i + 1) * Math.PI) / 8;
    const r = LANTERN_D / 2;
    parts.push({
      shape: 'box',
      at: [r * Math.sin(a), LANTERN_H / 2, r * Math.cos(a)],
      size: [0.12, LANTERN_H, 0.12],
      rot: [0, a, 0],
      color: IRON,
      decor: true,
    });
  }
  return {
    part: 'deck',
    stand: 'resting',
    at: [0, base + LANTERN_Y, 0],
    ground: 'fixed',
    mass: HEAD_MASS,
    parts,
  };
}

const lighthouse: StructureDef = {
  kind: 'lighthouse',
  label: 'Lighthouse',
  material: 'masonry',
  building: true,
  footprint: 4.1,
  palettes: {
    stone: [0x8f8c86, 0x9b968e, 0x847f78],
    white: [0xf2efe8, 0xece8df],
    // Classic day-marks: red, black or deep blue bands.
    stripe: [0xc4372b, 0xb3302a, 0x26292d, 0x24476b],
    lamp: [0xf6e7a2, 0xfbeeb8],
    cap: [0xb3302a, 0x26292d],
  },
  // Door toward the player (up-course) unless the placement says otherwise.
  defaultYaw: () => Math.PI,
  build(ctx) {
    const base = lowestGround(ctx, FOOT_D / 2) - SINK;
    return [tower(ctx, base), head(base)];
  },
};

export default lighthouse;
