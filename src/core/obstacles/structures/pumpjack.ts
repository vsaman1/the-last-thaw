import { Euler, Quaternion, Vector3 } from 'three';
import { deco, groundWall } from './barn';
import { maxGround, type PartDef, type StructureContext, type StructureDef, type V3 } from './kit';

/**
 * An oil well pumpjack (beam pump, ~10 m long, horse head ~7 m up): a steel skid, a four-legged
 * samson post, the walking beam with its horse head over the wellhead, and a gearbox on a pedestal
 * at the back. Crank arms, counterweights, pitman arms, equalizer, motor and belt guard, the saddle
 * bearing, bridle and polished rod, and the wellhead ('christmas tree') are decor; it is shown
 * standing still (no rocking: the kit only spins parts, and a beam that rocks needs its pitman
 * arms to follow).
 * One anchored body of 9 colliders that shatters into 4 pieces: skid, samson post, walking beam
 * with head, and gearbox (its weight includes the counterweights). The wellhead stays with the skid.
 * Mass 14 t; a 30 t iceberg breaks it above 14 m/s (breakImpulse 525), a 60 t one at 7 m/s, a
 * 100 t one at 4.2 m/s. Metal: the pieces sink in water.
 * Ground: the skid's bottom follows the ground (barn.ts groundWall) and its top is level, 0.5 m above
 * the highest ground under it, so the machine stands level on a slope and no piece starts buried.
 * Local frame: beam along z, horse head on +z. With no yaw given it is turned at random.
 */

const SKID_HW = 1.1;
const SKID_Z0 = -5.6;
const SKID_Z1 = 2.4;
const SKID_H = 0.5;
/** Samson post: legs from the skid to just under the beam's saddle at z = PIVOT_Z. */
const POST_H = 5.0;
const PIVOT_Z = 0.6;
const LEG_W = 0.24;
const BEAM_H = 0.6;
const BEAM_Z0 = -3.8;
const BEAM_Z1 = 3.6;
/** Gap between pieces so a smashed pumpjack's pieces never start inside each other. */
const GAP = 0.05;
/** Beam centre above the skid top. */
const BEAM_Y = POST_H + GAP + BEAM_H / 2;
/** Horse head in section (z, y) from its back face at the beam's end; convex 'D' shape. */
const HEAD: readonly (readonly [number, number])[] = [
  [0, -1.9],
  [0.55, -1.75],
  [0.9, -1.2],
  [1.0, -0.4],
  [0.9, 0.4],
  [0.55, 0.95],
  [0, 1.1],
];
const HEAD_SHAPE = { type: 'prism', id: 'pumpjack-head', outline: HEAD, axis: 'x' } as const;
/** The bridle hangs from the head's front, right over the wellhead. */
const WELL_Z = BEAM_Z1 + 1.0 + 0.02;
const CRANK_Z = -4.4;
const CRANK_Y = 1.6;

const _q = new Quaternion();
const _e = new Euler();
const _d = new Vector3();
const UP = new Vector3(0, 1, 0);

/** A square bar `w` thick from a to b (decor unless `decor` is false). Shared with oilRig.ts. */
export function strut(a: V3, b: V3, w: number, color: string | number, decor = true): PartDef {
  _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _d.length();
  _e.setFromQuaternion(_q.setFromUnitVectors(UP, _d.normalize()), 'XYZ');
  return {
    shape: 'box',
    at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    size: [w, len, w],
    rot: [_e.x, _e.y, _e.z],
    color,
    decor,
  };
}

function build(ctx: StructureContext): PartDef[] {
  const zs: number[] = [];
  for (let z = SKID_Z0; z < SKID_Z1; z += 1) zs.push(z);
  zs.push(SKID_Z1);
  const y0 = maxGround(ctx, -SKID_HW, SKID_HW, zs, 0.55) + SKID_H;
  const beamY = y0 + BEAM_Y;
  const parts: PartDef[] = [
    groundWall(ctx, [0, SKID_Z0], [0, SKID_Z1], 2 * SKID_HW, y0, 'steel', { piece: 'skid', name: 'skid', weight: 3 }),
  ];
  // Samson post: four legs leaning in to the saddle (ends kept clear of the skid and the beam).
  const top = y0 + POST_H;
  for (const sx of [-1, 1]) {
    for (const z of [-0.9, 2.0]) {
      const leg = strut([sx * 0.75, y0 + 0.04, z], [sx * 0.22, top, PIVOT_Z], LEG_W, 'steel', false);
      parts.push({ ...leg, piece: 'post', name: 'post', weight: 0.6 });
    }
  }
  parts.push(deco([0, top + GAP / 2, PIVOT_Z], [0.6, GAP + 0.2, 0.5], 'dark', { piece: 'beam' }));
  // Walking beam and horse head.
  const beamLen = BEAM_Z1 - BEAM_Z0;
  parts.push(
    {
      shape: 'box',
      piece: 'beam',
      name: 'beam',
      at: [0, beamY, (BEAM_Z0 + BEAM_Z1) / 2],
      size: [0.45, BEAM_H, beamLen],
      color: 'paint',
      weight: 2.4,
    },
    {
      shape: HEAD_SHAPE,
      piece: 'beam',
      name: 'head',
      at: [0, beamY - 0.4, BEAM_Z1 + 0.5],
      size: [0.6, 3.0, 1.0],
      color: 'paint',
      weight: 1.2,
    },
  );
  // Gearbox on its pedestal; crank arms and counterweights (decor) either side.
  const crankY = y0 + CRANK_Y;
  parts.push(
    { shape: 'box', piece: 'crank', name: 'gearbox', at: [0, y0 + 0.5, CRANK_Z], size: [1.0, 1.0, 1.2], color: 'steel', weight: 1.5 },
    { shape: 'box', piece: 'crank', name: 'gearbox', at: [0, y0 + 1.6, CRANK_Z], size: [1.3, 1.2, 1.7], color: 'dark', weight: 3.5 },
  );
  for (const sx of [-1, 1]) {
    const x = sx * 0.85;
    parts.push(deco([x, crankY, CRANK_Z - 0.65], [0.18, 0.4, 1.6], 'paint', { piece: 'crank' }));
    parts.push(deco([x, crankY, CRANK_Z - 0.9], [0.3, 1.4, 0.9], 'weight', { piece: 'crank' }));
    // Pitman arm from the crank pin up to the equalizer under the beam's tail.
    parts.push({ ...strut([x, crankY, CRANK_Z - 1.3], [sx * 0.3, beamY - 0.45, BEAM_Z0 + 0.2], 0.15, 'paint'), piece: 'beam' });
  }
  parts.push(deco([0, beamY - 0.45, BEAM_Z0 + 0.2], [0.9, 0.2, 0.3], 'paint', { piece: 'beam' }));
  // Motor and belt guard between the gearbox and the post.
  parts.push(deco([0, y0 + 0.4, -2.7], [0.9, 0.8, 1.0], 'motor', { piece: 'skid' }));
  parts.push(deco([0.6, y0 + 1.0, -3.4], [0.12, 0.9, 1.6], 'motor', { piece: 'skid' }));
  // Wellhead on the ground in front of the skid, polished rod and bridle up to the horse head.
  const gw = ctx.groundAt(0, WELL_Z) - 0.05;
  const cyl = (n: number): PartDef['shape'] => ({ type: 'cylinder', segments: n });
  parts.push(
    { shape: cyl(8), at: [0, gw + 0.15, WELL_Z], size: [0.7, 0.3, 0.7], color: 'pipe', decor: true, piece: 'skid' },
    { shape: cyl(8), at: [0, gw + 1.0, WELL_Z], size: [0.3, 1.4, 0.3], color: 'pipe', decor: true, piece: 'skid' },
    deco([0, gw + 0.9, WELL_Z], [0.9, 0.18, 0.18], 'valve', { piece: 'skid' }),
    deco([0, gw + 1.8, WELL_Z], [0.35, 0.3, 0.35], 'pipe', { piece: 'skid' }),
  );
  const carrier = gw + 2.6;
  const headFront = beamY - 0.4;
  parts.push(deco([0, (gw + 1.95 + carrier) / 2, WELL_Z], [0.08, carrier - gw - 1.95, 0.08], 'pipe', { piece: 'beam' }));
  parts.push(deco([0, carrier, WELL_Z], [0.5, 0.12, 0.15], 'dark', { piece: 'beam' }));
  for (const x of [-0.12, 0.12]) {
    parts.push(deco([x, (carrier + headFront) / 2, WELL_Z], [0.05, headFront - carrier, 0.05], 'dark', { piece: 'beam' }));
  }
  return parts;
}

const pumpjack: StructureDef = {
  kind: 'pumpjack',
  label: 'Pumpjack',
  material: 'metal',
  footprint: 6,
  palettes: {
    // Beam and head paint: oilfield yellow, blue, red, green, charcoal.
    paint: [0xd8a31a, 0x2f5c87, 0xb3322b, 0x2f7d4a, 0x4a4f54],
    steel: [0x5b6166, 0x6f777d],
    dark: [0x2b2e31, 0x3b3f44],
    weight: [0x3b3f44, 0x4a4f54],
    motor: [0x2e6b4f, 0x2f5c87, 0x6d7378],
    pipe: [0x8e959a, 0x9aa0a5],
    valve: [0xb3261e],
  },
  breakup: { impulseScale: 0.6, spin: 0.3, falloff: 3, floor: 0.3 },
  defaultYaw: (ctx) => ctx.rng() * 2 * Math.PI,
  build: (ctx) => [
    {
      part: 'pumpjack',
      stand: 'anchored',
      ground: 'fixed',
      mass: 14,
      breakSpeed: 14,
      breakMode: 'shatter',
      parts: build(ctx),
    },
  ],
};

export default pumpjack;
