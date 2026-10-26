import { Euler, Quaternion, Vector3 } from 'three';
import { maxGround, type BodyDef, type PartDef, type Profile, type StructureDef, type V3 } from './kit';

/**
 * An elevated steel water tower: a 9 m tank (cylindrical shell, rounded bottom, conical roof with
 * a finial) on a ring girder with a railed catwalk, carried 14 m up on four steel legs with
 * X-bracing, plus a central riser pipe. ~24 m tall.
 *
 * Bodies (nothing is jointed; Rapier does the falling):
 * - four legs: anchored, uproot at 12 m/s for a 30 t iceberg (breakImpulse 450 t·m/s; 100 t:
 *   3.6 m/s), knocked out at the iceberg's contact height so the foot goes and the top drops away
 *   from the tank (like the footbridge posts). 'trunk' proxies, so the iceberg can slide between
 *   them (they are 6.4 m apart) and only meets the legs it actually strikes.
 * - the riser pipe: anchored, uproots at 6 m/s (thin pipe between the legs).
 * - the tank: 24 t, RESTING on the four leg tops (asleep until something under it breaks). Lose
 *   one or two legs and it tips toward the gap, falls 14 m and rolls.
 * Legs follow the ground; the tank stays level 14 m above the highest ground under the legs.
 * The tank uses the proxy label 'deck', the kit's convention for a body carried above the ground
 * by others (the shared kit test exempts exactly that label from the "stands on the ground" check).
 */

const LEG_XZ = 3.2;
const LEG_W = 0.55;
const LEG_H = 14;
/** Below the lowest ground under a leg; shallow so a freed leg is not popped out of the terrain. */
const SINK = 0.06;
/** The iceberg strikes a leg about this high above the ground (its contact point is pos.y + 1.2). */
const HIT_Y = 1.2;
const LEG_MASS = 2.5;
const TANK_MASS = 24;
const RING_D = 10.4;
const RING_H = 0.45;
/** Tank shell profile [radius, y] above the ring underside; the bulge stays inside the legs. */
const SHELL: Profile = [
  [0, -2.0],
  [2.4, -1.65],
  [3.5, -0.9],
  [4.1, 0],
  [4.5, 0.5],
  [4.5, 6.0],
  [3.4, 7.0],
  [1.0, 7.7],
  [0, 7.8],
];
const SHELL_BOTTOM = -2.0;
const SHELL_TOP = 7.8;
const RISER_D = 1.1;
const CORNERS: readonly (readonly [number, number])[] = [
  [LEG_XZ, LEG_XZ],
  [-LEG_XZ, LEG_XZ],
  [-LEG_XZ, -LEG_XZ],
  [LEG_XZ, -LEG_XZ],
];

const _q = new Quaternion();
const _e = new Euler();
const _d = new Vector3();
const UP = new Vector3(0, 1, 0);

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

/** A ring of n posts with a top rail at radius r, from y to y + h (decor). */
function railing(r: number, y: number, h: number, n: number, color: string | number): PartDef[] {
  const out: PartDef[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const p0: V3 = [r * Math.sin(a0), y + h, r * Math.cos(a0)];
    const p1: V3 = [r * Math.sin(a1), y + h, r * Math.cos(a1)];
    out.push(beam([p0[0], y, p0[2]], p0, 0.07, color), beam(p0, p1, 0.07, color));
  }
  return out;
}

function leg(i: number, foot: number, ringY: number, feet: readonly number[]): BodyDef {
  const [x, z] = CORNERS[i];
  const base = foot - SINK;
  const h = ringY - base;
  const parts: PartDef[] = [
    { shape: 'box', name: 'leg', at: [0, h / 2, 0], size: [LEG_W, h, LEG_W], color: 'steel' },
    { shape: 'box', at: [0, SINK + 0.15, 0], size: [1.1, 0.5, 1.1], color: 0xa8a49b, decor: true },
  ];
  // Bracing toward the next leg (decor riding on this leg): two struts and X rods in two bays.
  const [nx, nz] = CORNERS[(i + 1) % 4];
  const local = (px: number, py: number, pz: number): V3 => [px - x, py - base, pz - z];
  const levels = [ringY - 9.2, ringY - 4.6, ringY - 0.35];
  const nextBase = feet[(i + 1) % 4] - SINK;
  const ends = (y: number): [V3, V3] => [
    local(x, Math.max(y, base + 1), z),
    local(nx, Math.max(y, nextBase + 1), nz),
  ];
  for (let k = 0; k < levels.length; k++) {
    const [a, b] = ends(levels[k]);
    if (k < 2) parts.push(beam(a, b, 0.22, 'steel'));
    if (k > 0) {
      const [a0, b0] = ends(levels[k - 1]);
      parts.push(beam(a0, b, 0.09, 'steel'), beam(a, b0, 0.09, 'steel'));
    }
  }
  return {
    part: 'leg',
    stand: 'anchored',
    at: [x, base, z],
    ground: 'fixed',
    mass: (LEG_MASS * h) / (LEG_H + SINK),
    breakSpeed: 12,
    breakMode: 'uproot',
    proxy: 'trunk',
    trunkRadius: 0.35,
    hitHeight: SINK + HIT_Y,
    parts,
  };
}

function riser(foot: number, ringY: number): BodyDef {
  const base = foot - SINK;
  const h = ringY + SHELL_BOTTOM - 0.1 - base;
  return {
    part: 'riser',
    stand: 'anchored',
    at: [0, base, 0],
    ground: 'fixed',
    mass: 1.2,
    breakSpeed: 6,
    breakMode: 'uproot',
    proxy: 'trunk',
    trunkRadius: RISER_D / 2,
    hitHeight: SINK + HIT_Y,
    parts: [
      {
        shape: { type: 'cylinder', segments: 8 },
        name: 'riser',
        at: [0, h / 2, 0],
        size: [RISER_D, h, RISER_D],
        color: 'steel',
      },
      { shape: 'box', at: [0, SINK + 0.5, 0], size: [1.6, 1.0, 1.6], color: 0x6d7378, decor: true },
    ],
  };
}

function tank(ringY: number): BodyDef {
  const shellH = SHELL_TOP - SHELL_BOTTOM;
  const parts: PartDef[] = [
    {
      shape: { type: 'cylinder', segments: 16 },
      name: 'tank',
      at: [0, RING_H / 2, 0],
      size: [RING_D, RING_H, RING_D],
      color: 'steel',
      weight: 0.12,
    },
    {
      shape: { type: 'lathe', id: 'waterTower-tank', profile: SHELL, segments: 16 },
      name: 'tank',
      at: [0, (SHELL_TOP + SHELL_BOTTOM) / 2, 0],
      size: [9, shellH, 9],
      color: 'paint',
      weight: 0.88,
    },
    // Painted band, finial and roof vent.
    {
      shape: { type: 'cylinder', segments: 16 },
      at: [0, 3.6, 0],
      size: [9.08, 1.0, 9.08],
      color: 'accent',
      decor: true,
    },
    {
      shape: { type: 'cone', segments: 8 },
      at: [0, SHELL_TOP + 0.45, 0],
      size: [0.7, 1.0, 0.7],
      color: 'steel',
      decor: true,
    },
    { shape: 'box', at: [1.6, 7.45, 0], size: [0.8, 0.5, 0.8], color: 'steel', decor: true },
    ...railing(RING_D / 2 - 0.12, RING_H, 1.05, 14, 'steel'),
  ];
  // Ladder up the shell from the catwalk to the roof.
  for (const x of [-0.25, 0.25]) parts.push(beam([x, RING_H, -4.62], [x, 6.0, -4.62], 0.07, 'steel'));
  return { part: 'deck', stand: 'resting', at: [0, ringY, 0], ground: 'fixed', mass: TANK_MASS, parts };
}

const waterTower: StructureDef = {
  kind: 'waterTower',
  label: 'Water tower',
  material: 'metal',
  building: true,
  footprint: 5.5,
  palettes: {
    // Painted steel: white, pale blue, sage, cream, silver.
    paint: [0xdfe3e6, 0x8fb3c9, 0x9db08a, 0xe7e1d2, 0xc9ced2],
    steel: [0x5d666c, 0x6b7378, 0x535b61],
    accent: [0x2f5f8a, 0xb3322b, 0x2e6b4f, 0x3b3f45],
  },
  // Symmetric: any quarter-turn plus a little, so groups of towers do not line up.
  defaultYaw: (ctx) => (ctx.rng() - 0.5) * (Math.PI / 4),
  build(ctx) {
    const r = LEG_W / 2;
    const feet = CORNERS.map(([x, z]) => {
      let g = ctx.groundAt(x, z);
      for (const [dx, dz] of [[-r, -r], [r, -r], [r, r], [-r, r]]) {
        g = Math.min(g, ctx.groundAt(x + dx, z + dz));
      }
      return g;
    });
    // Level tank: LEG_H above the highest ground under the four legs.
    let top = -Infinity;
    for (const [x, z] of CORNERS) top = Math.max(top, maxGround(ctx, x - r, x + r, [z - r, z + r], 0.5));
    const ringY = top + LEG_H;
    let centre = ctx.groundAt(0, 0);
    for (const [dx, dz] of [[-0.55, -0.55], [0.55, -0.55], [0.55, 0.55], [-0.55, 0.55]]) {
      centre = Math.min(centre, ctx.groundAt(dx, dz));
    }
    return [...CORNERS.map((_, i) => leg(i, feet[i], ringY, feet)), riser(centre, ringY), tank(ringY)];
  },
};

export default waterTower;
