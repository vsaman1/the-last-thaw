import type { BodyDef, PartDef, Profile, StructureContext, StructureDef } from './kit';

/**
 * A modern three-bladed wind turbine: a 38 m tapered steel tower (3.8 m -> 2.3 m) on a concrete
 * pad, a 7 m nacelle with a spinner, and three 16.5 m blades (hub at ~40 m, tips up to ~57 m),
 * with red blade tips (or plain), a cooler, an aviation light and a tower door.
 *
 * Bodies:
 * - the tower (pad + tower, 36 t): anchored, breaks at 20 m/s for a 30 t iceberg (breakImpulse
 *   750 t·m/s; 100 t: 6 m/s, 220 t: 2.7 m/s) and UPROOTS with the hit at its centre of percussion,
 *   so it pivots about its foot and falls in the push direction;
 * - the nacelle with rotor (14 t, balanced over the tower axis): RESTS on the tower top and is
 *   thrown off as the tower goes over.
 * Why two bodies: a loose body's collision proxy is a circle from its bounding box, so a rotor
 *   attached to the falling tower would make the iceberg collide ~10 m away from the tower.
 *
 * The rotor starts at a random angle per instance (seeded) and turns (PartDef.spin: the renderer
 * rotates the blades about the hub axis) until the head is knocked off or the tower falls; the
 * colliders keep the build angle (a few blade colliders are not worth rebuilding every step).
 * "Game" steel masses: the iceberg keeps 1 - 1.25·36/(M + 36) of its speed when it knocks the tower
 * over (~32 % at 30 t, ~67 % at 100 t). Faces up-course (rotor toward the player) by default.
 * The head uses the proxy label 'deck', the kit's convention for a body carried above the ground by
 * another (the shared kit test exempts exactly that label from the "stands on the ground" check).
 */

const PAD_H = 0.6;
const PAD_D = 6;
const TOWER_H = 38;
const TOWER_D = 3.8;
const TOWER_TOP_D = 2.3;
const TOP = PAD_H + TOWER_H;
const NACELLE: [number, number, number] = [2.6, 2.6, 7];
const NACELLE_Z = -1.2;
/** Hub height above the tower top (the head's origin). */
const HUB_Y = NACELLE[1] / 2;
const SPINNER_L = 2;
const SPINNER_Z = NACELLE_Z + NACELLE[2] / 2 + SPINNER_L / 2;
const ROTOR_Z = SPINNER_Z - 0.4;
const BLADE_ROOT = 0.6;
const BLADE_T = 0.35;
/** Blade planform (chord across, span along +v from the root), convex. */
const BLADE: Profile = [
  [-0.35, 0],
  [0.35, 0],
  [0.85, 3],
  [0.25, 16.5],
  [-0.15, 16.5],
  [-0.55, 3],
];
const BLADE_W = 1.4;
const BLADE_L = 16.5;
/** Planform bounding-box centre (the prism's origin) relative to the root centre. */
const BLADE_CX = 0.15;
/**
 * The rotor turns clockwise seen from the front (upwind, +z) at ~15 rpm about the hub axis while the
 * head is undisturbed (render-only: the colliders keep the build angle).
 */
const ROTOR_SPIN = { axis: [0, 0, 1], pivot: [0, HUB_Y, ROTOR_Z], rate: -1.6 } as const;
const TOWER_MASS = 36;
const HEAD_MASS = 14;
/** Head mass weights (t at mass 14): nacelle 8, spinner 1.5, blades 1.5 each → centre ~0.6 m forward. */
const W_NACELLE = 8;
const W_SPINNER = 1.5;
const W_BLADE = 1.5;
const SINK = 0.05;

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

/** Tapered tower mass is lower down: centre of mass of a frustum of radii r0 -> r1, height h. */
const frustumCentre = (r0: number, r1: number, h: number): number =>
  (h * (r0 * r0 + 2 * r0 * r1 + 3 * r1 * r1)) / (4 * (r0 * r0 + r0 * r1 + r1 * r1));

const HIT_HEIGHT = percussionHeight([
  { y: PAD_H / 2, h: PAD_H, m: 0.1 },
  { y: PAD_H + frustumCentre(TOWER_D, TOWER_TOP_D, TOWER_H), h: TOWER_H, m: 0.9 },
]);

/** Lowest ground (relative, nominal m) under a circle of radius r around the origin. */
function lowestGround(ctx: StructureContext, r: number): number {
  let lo = ctx.groundAt(0, 0);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    lo = Math.min(lo, ctx.groundAt(r * Math.sin(a), r * Math.cos(a)));
  }
  return lo;
}

function tower(base: number): BodyDef {
  return {
    part: 'windTurbine',
    stand: 'anchored',
    at: [0, base, 0],
    ground: 'fixed',
    mass: TOWER_MASS,
    breakSpeed: 20,
    breakMode: 'uproot',
    proxy: 'trunk',
    trunkRadius: PAD_D / 2 - 0.25,
    shake: 'tilt',
    hitHeight: HIT_HEIGHT,
    parts: [
      {
        shape: { type: 'cylinder', segments: 12 },
        name: 'pad',
        at: [0, PAD_H / 2, 0],
        size: [PAD_D, PAD_H, PAD_D],
        color: 'pad',
        weight: 0.1,
      },
      {
        shape: { type: 'cylinder', segments: 12, taper: TOWER_TOP_D / TOWER_D },
        name: 'tower',
        at: [0, PAD_H + TOWER_H / 2, 0],
        size: [TOWER_D, TOWER_H, TOWER_D],
        color: 'white',
        weight: 0.9,
      },
      // Tower door with steps and a darker foot band.
      {
        shape: 'box',
        at: [0, PAD_H + 1.2, -TOWER_D / 2 + 0.02],
        size: [0.9, 2.1, 0.08],
        color: 0x5b6166,
        decor: true,
      },
      {
        shape: 'box',
        at: [0, PAD_H / 2 + 0.25, -PAD_D / 2 + 0.1],
        size: [1.4, 0.5, 1.2],
        color: 0x8d8a83,
        decor: true,
      },
      {
        shape: { type: 'cylinder', segments: 12 },
        at: [0, PAD_H + 0.6, 0],
        size: [TOWER_D + 0.08, 1.2, TOWER_D + 0.08],
        color: 0x9ea7a1,
        decor: true,
      },
    ],
  };
}

function head(ctx: StructureContext, base: number): BodyDef {
  const angle = ctx.rng() * ((Math.PI * 2) / 3);
  const parts: PartDef[] = [
    {
      shape: 'box',
      name: 'nacelle',
      at: [0, HUB_Y, NACELLE_Z],
      size: NACELLE,
      color: 'white',
      weight: W_NACELLE,
    },
    {
      shape: { type: 'cone', segments: 12 },
      name: 'nacelle',
      at: [0, HUB_Y, SPINNER_Z],
      size: [1.9, SPINNER_L, 1.9],
      rot: [Math.PI / 2, 0, 0],
      color: 'white',
      weight: W_SPINNER,
    },
    // Cooler on the nacelle roof and the aviation light.
    {
      shape: 'box',
      at: [0, NACELLE[1] + 0.25, NACELLE_Z - 2.4],
      size: [1.6, 0.5, 1.3],
      color: 0xc9cdcb,
      decor: true,
    },
    {
      shape: 'box',
      at: [0, NACELLE[1] + 0.2, NACELLE_Z - 3.2],
      size: [0.3, 0.4, 0.3],
      color: 0xd2261c,
      decor: true,
    },
  ];
  for (let k = 0; k < 3; k++) {
    const a = angle + (k * Math.PI * 2) / 3;
    // Blade frame: +v along the blade, rotated by a about the rotor axis (+z).
    const along = BLADE_ROOT + BLADE_L / 2;
    parts.push({
      shape: { type: 'prism', id: 'windTurbine-blade', outline: BLADE },
      name: 'blade',
      at: [
        BLADE_CX * Math.cos(a) - along * Math.sin(a),
        HUB_Y + BLADE_CX * Math.sin(a) + along * Math.cos(a),
        ROTOR_Z,
      ],
      size: [BLADE_W, BLADE_L, BLADE_T],
      rot: [0, 0, a],
      color: 'white',
      weight: W_BLADE,
      spin: ROTOR_SPIN,
    });
    // Coloured tip: the outer 2 m of the blade.
    const tip = BLADE_ROOT + BLADE_L - 1.0;
    parts.push({
      shape: 'box',
      at: [0.05 * Math.cos(a) - tip * Math.sin(a), HUB_Y + 0.05 * Math.sin(a) + tip * Math.cos(a), ROTOR_Z],
      size: [0.5, 2, BLADE_T + 0.04],
      rot: [0, 0, a],
      color: 'tips',
      decor: true,
      spin: ROTOR_SPIN,
    });
  }
  return { part: 'deck', stand: 'resting', at: [0, base + TOP, 0], ground: 'fixed', mass: HEAD_MASS, parts };
}

const windTurbine: StructureDef = {
  kind: 'windTurbine',
  label: 'Wind turbine',
  material: 'metal',
  building: true,
  footprint: 3.6,
  palettes: {
    white: [0xf1f2f0, 0xe9ebe8, 0xdfe2e1],
    pad: [0xa9a59c, 0x9d998f],
    // Red aviation tips on some machines, plain on others.
    tips: [0xc8372d, 0xc8372d, 0xe9ebe8],
  },
  defaultYaw: () => Math.PI,
  build(ctx) {
    const base = lowestGround(ctx, PAD_D / 2) - SINK;
    return [tower(base), head(ctx, base)];
  },
};

export default windTurbine;
