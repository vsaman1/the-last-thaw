import type { BodyDef, PartDef, Profile, StructureDef } from './kit';

/**
 * A village church in stone: a 9 x 16 m nave with 7.5 m walls under a steep 50° slate (or tile)
 * roof, a half-octagonal apse at the back, a 5 m square west tower with a setback belfry, clock
 * faces, corner pinnacles and an octagonal spire with a gilded cross (29.5 m). Lancet windows of
 * stained glass between buttresses, a rose window and an arched door are decor.
 *
 * Bodies (structure frame: +z = facade/tower; by default it faces up-course, toward the player):
 * - nave front half and back half (with the apse): two anchored bodies that SHATTER into walls,
 *   gable, roof slabs (and apse) at 22 m/s for a 30 t iceberg (breakImpulse 825 t·m/s; 100 t:
 *   6.6 m/s, 220 t: 3 m/s); 22 t each. Two halves, not one long body, because the kit's footprint
 *   proxy is a circle: one 20 m body would collide ~7 m beside its long walls.
 * - the tower with its spire: one anchored body (30 t) that UPROOTS at 20 m/s (breakImpulse 750),
 *   hit at its centre of percussion so it pivots about its foot and topples in the push direction
 *   (onto the nave when struck from the front).
 * The iceberg keeps 1 - 1.25·m/(M + m) of its speed per body it smashes (m = 22 or 30 t).
 */

const W = 9;
const L = 16;
const H = 7.5;
const T = 0.7;
const PITCH = (50 * Math.PI) / 180;
const RISE = (W / 2) * Math.tan(PITCH);
const ROOF_T = 0.35;
const OVERHANG = 0.5;
const SLAB_L = (W / 2 + OVERHANG) / Math.cos(PITCH);
const TOWER_W = 5;
const SHAFT_H = 13;
const BELFRY_W = 4.4;
const BELFRY_H = 5;
const SPIRE_H = 11;
const TOWER_TOP = SHAFT_H + BELFRY_H;
const APSE_W = 6.4;
const APSE_D = 3.2;
const APSE_H = 6;
/** The whole plan runs from the apse (z = -L/2 - APSE_D) to the tower front; centre it. */
const Z0 = -(TOWER_W - APSE_D) / 2;
const TOWER_Z = Z0 + L / 2 + TOWER_W / 2;
const NAVE_MASS = 22;
const TOWER_MASS = 30;

const GABLE: Profile = [
  [-W / 2, 0],
  [W / 2, 0],
  [W / 2, H],
  [0, H + RISE],
  [-W / 2, H],
];
/**
 * Half-octagon apse plan (u across, v outward; a face at the back), extruded upward by the part's
 * rotation. Its corners line up with those of an unrotated 8-sided kit cone (the apse roof).
 */
const C8 = Math.cos(Math.PI / 8);
const S8 = Math.sin(Math.PI / 8);
const APSE: Profile = [
  [-C8, 0],
  [C8, 0],
  [C8, S8],
  [S8, C8],
  [-S8, C8],
  [-C8, S8],
];

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

/** A pointed lancet window (dark glass + a diamond for the arch) on a long wall's outer face. */
function lancet(side: number, z: number, piece: string): PartDef[] {
  const x = side * (W / 2 + 0.03);
  return [
    { shape: 'box', piece, at: [x, 4.0, z], size: [0.05, 3.0, 1.0], color: 'glass', decor: true },
    {
      shape: 'box',
      piece,
      at: [x, 5.5, z],
      size: [0.05, 0.71, 0.71],
      rot: [Math.PI / 4, 0, 0],
      color: 'glass',
      decor: true,
    },
  ];
}

/** One nave half: z from z0 to z1 (front half: the tower end; back half: the apse end). */
function naveHalf(front: boolean): BodyDef {
  const zEnd = Z0 + (front ? L / 2 : -L / 2);
  const zMid = Z0;
  const dir = front ? 1 : -1;
  const tag = front ? 'f' : 'b';
  const wallLen = L / 2 - T;
  const wallZ = zMid + (dir * wallLen) / 2;
  const gableZ = zEnd - (dir * T) / 2;
  // Roof: no overhang against the tower, OVERHANG over the back gable.
  const roofLen = L / 2 + (front ? 0 : OVERHANG);
  const roofZ = zMid + (dir * roofLen) / 2;
  const parts: PartDef[] = [];
  for (const side of [-1, 1]) {
    parts.push({
      shape: 'box',
      name: 'wall',
      piece: `wall${tag}${side}`,
      at: [side * (W / 2 - T / 2), H / 2, wallZ],
      size: [T, H, wallLen],
      color: 'stone',
      weight: 0.18,
    });
    // Roof slab: underside on the gable's sloped edge from the ridge, past the wall by OVERHANG.
    const ux = Math.cos(PITCH);
    const uy = -Math.sin(PITCH);
    const nx = Math.sin(PITCH);
    const ny = Math.cos(PITCH);
    parts.push({
      shape: 'box',
      name: 'roof',
      piece: `roof${tag}${side}`,
      at: [
        side * ((ux * SLAB_L) / 2 + (nx * ROOF_T) / 2),
        H + RISE + (uy * SLAB_L) / 2 + (ny * ROOF_T) / 2,
        roofZ,
      ],
      size: [SLAB_L, ROOF_T, roofLen],
      rot: [0, 0, -side * PITCH],
      color: 'roof',
      weight: 0.12,
    });
    // Windows and a buttress between them.
    for (const k of [0.27, 0.73]) parts.push(...lancet(side, zMid + dir * k * wallLen, `wall${tag}${side}`));
    parts.push({
      shape: 'box',
      piece: `wall${tag}${side}`,
      at: [side * (W / 2 + 0.3), 2.6, zMid + dir * 0.5 * wallLen],
      size: [0.6, 5.2, 0.8],
      color: 'stone',
      decor: true,
    });
  }
  parts.push({
    shape: { type: 'prism', id: 'church-gable', outline: GABLE },
    name: 'gable',
    piece: `gable${tag}`,
    at: [0, (H + RISE) / 2, gableZ],
    size: [W, H + RISE, T],
    color: 'stone',
    weight: 0.2,
  });
  // Ridge cap along the top of the two slabs.
  parts.push({
    shape: 'box',
    piece: `roof${tag}1`,
    at: [0, H + RISE + ROOF_T * Math.cos(PITCH) - 0.05, roofZ],
    size: [0.55, 0.3, roofLen],
    color: 0x3a3f45,
    decor: true,
  });
  if (!front) {
    parts.push(
      {
        shape: { type: 'prism', id: 'church-apse', outline: APSE },
        name: 'apse',
        piece: 'apse',
        at: [0, APSE_H / 2, zEnd - APSE_D / 2],
        size: [APSE_W, APSE_D, APSE_H],
        rot: [-Math.PI / 2, 0, 0],
        color: 'stone',
        weight: 0.16,
      },
      // Apse roof: half of an octagonal cone, the rest hidden inside the nave.
      {
        shape: { type: 'cone', segments: 8 },
        piece: 'apse',
        at: [0, APSE_H + 1.2, zEnd],
        size: [APSE_W + 0.5, 2.4, APSE_W + 0.5],
        color: 'roof',
        decor: true,
      },
      {
        shape: 'box',
        piece: 'apse',
        at: [0, 3.6, zEnd - APSE_D - 0.03],
        size: [0.9, 2.6, 0.05],
        color: 'glass',
        decor: true,
      },
      // Rose window high in the back gable.
      {
        shape: { type: 'cylinder', segments: 12 },
        piece: `gable${tag}`,
        at: [0, H + 2.2, zEnd - 0.04],
        size: [1.8, 0.06, 1.8],
        rot: [Math.PI / 2, 0, 0],
        color: 'glass',
        decor: true,
      },
    );
  }
  return {
    part: 'church',
    stand: 'anchored',
    mass: NAVE_MASS,
    breakSpeed: 22,
    breakMode: 'shatter',
    proxy: 'footprint',
    breakup: { impulseScale: 0.8, spin: 0.7, falloff: 6, floor: 0.5 },
    parts,
  };
}

const TOWER_SHARES = { shaft: 0.6, belfry: 0.28, spire: 0.12 } as const;

function tower(): BodyDef {
  // Parts relative to the tower's own foot: an uprooting hit is applied above the BODY origin.
  const z = 0;
  const front = z + TOWER_W / 2;
  const parts: PartDef[] = [
    {
      shape: 'box',
      name: 'tower',
      at: [0, SHAFT_H / 2, z],
      size: [TOWER_W, SHAFT_H, TOWER_W],
      color: 'stone',
      weight: TOWER_SHARES.shaft,
    },
    {
      shape: 'box',
      name: 'tower',
      at: [0, SHAFT_H + BELFRY_H / 2, z],
      size: [BELFRY_W, BELFRY_H, BELFRY_W],
      color: 'stone',
      weight: TOWER_SHARES.belfry,
    },
    {
      shape: { type: 'cone', segments: 8 },
      name: 'spire',
      at: [0, TOWER_TOP + SPIRE_H / 2, z],
      size: [BELFRY_W, SPIRE_H, BELFRY_W],
      color: 'spire',
      weight: TOWER_SHARES.spire,
    },
    // Cornice, gilded cross and ball, arched door with a pointed head.
    {
      shape: 'box',
      at: [0, SHAFT_H, z],
      size: [TOWER_W + 0.3, 0.35, TOWER_W + 0.3],
      color: 0x8f877a,
      decor: true,
    },
    {
      shape: 'box',
      at: [0, TOWER_TOP + SPIRE_H + 0.9, z],
      size: [0.14, 1.8, 0.14],
      color: 'gold',
      decor: true,
    },
    {
      shape: 'box',
      at: [0, TOWER_TOP + SPIRE_H + 1.2, z],
      size: [0.9, 0.14, 0.14],
      color: 'gold',
      decor: true,
    },
    { shape: 'box', at: [0, 1.5, front + 0.03], size: [1.6, 3.0, 0.06], color: 0x5a3a22, decor: true },
    {
      shape: 'box',
      at: [0, 3.0, front + 0.03],
      size: [1.13, 1.13, 0.06],
      rot: [0, 0, Math.PI / 4],
      color: 0x5a3a22,
      decor: true,
    },
    { shape: 'box', at: [0, 7.5, front + 0.03], size: [0.5, 1.6, 0.05], color: 'glass', decor: true },
  ];
  // Belfry openings and clock faces on all four sides.
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const s = Math.sin(a);
    const c = Math.cos(a);
    const rb = BELFRY_W / 2 + 0.03;
    for (const off of [-0.75, 0.75]) {
      parts.push({
        shape: 'box',
        at: [rb * s + off * c, SHAFT_H + 2.6, z + rb * c - off * s],
        size: [0.7, 2.3, 0.05],
        rot: [0, a, 0],
        color: 0x1f2226,
        decor: true,
      });
    }
    const rc = TOWER_W / 2 + 0.05;
    parts.push({
      shape: { type: 'cylinder', segments: 12 },
      at: [rc * s, SHAFT_H - 2.2, z + rc * c],
      size: [1.8, 0.08, 1.8],
      rot: [Math.PI / 2, 0, -a],
      color: 0xf1ede2,
      decor: true,
    });
    const rh = rc + 0.06;
    parts.push(
      {
        shape: 'box',
        at: [rh * s, SHAFT_H - 1.95, z + rh * c],
        size: [0.08, 0.55, 0.04],
        rot: [0, a, 0],
        color: 0x1c1c1c,
        decor: true,
      },
      {
        shape: 'box',
        at: [rh * s - 0.2 * c, SHAFT_H - 2.2, z + rh * c + 0.2 * s],
        size: [0.4, 0.07, 0.04],
        rot: [0, a, 0],
        color: 0x1c1c1c,
        decor: true,
      },
    );
    // Corner pinnacles round the foot of the spire.
    const px = (k === 0 || k === 3 ? 1 : -1) * (BELFRY_W / 2 - 0.25);
    const pz = (k < 2 ? 1 : -1) * (BELFRY_W / 2 - 0.25);
    parts.push({
      shape: { type: 'cone', segments: 6 },
      at: [px, TOWER_TOP + 0.9, z + pz],
      size: [0.5, 1.8, 0.5],
      color: 'stone',
      decor: true,
    });
  }
  return {
    part: 'churchTower',
    stand: 'anchored',
    at: [0, 0, TOWER_Z],
    mass: TOWER_MASS,
    breakSpeed: 20,
    breakMode: 'uproot',
    proxy: 'footprint',
    shake: 'tilt',
    hitHeight: percussionHeight([
      { y: SHAFT_H / 2, h: SHAFT_H, m: TOWER_SHARES.shaft },
      { y: SHAFT_H + BELFRY_H / 2, h: BELFRY_H, m: TOWER_SHARES.belfry },
      { y: TOWER_TOP + SPIRE_H / 4, h: SPIRE_H / 2, m: TOWER_SHARES.spire },
    ]),
    parts,
  };
}

const church: StructureDef = {
  kind: 'church',
  label: 'Church',
  material: 'masonry',
  building: true,
  footprint: 12.5,
  palettes: {
    // Limestone, grey granite, sandstone.
    stone: [0xd8cfbb, 0xc9bfa8, 0xb9b0a0, 0xcdb48f, 0xa9a49a],
    roof: [0x4c5661, 0x5a636d, 0x3f4851, 0x9c4a33],
    // Copper verdigris or slate.
    spire: [0x5c9a8b, 0x6aa697, 0x4a5560],
    glass: [0x2b3d66, 0x3b2f5e, 0x23435c],
    gold: [0xc9a640],
  },
  // Facade and tower toward the player (up-course) unless the placement says otherwise.
  defaultYaw: () => Math.PI,
  build: () => [naveHalf(true), naveHalf(false), tower()],
};

export default church;
