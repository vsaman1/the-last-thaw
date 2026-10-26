import { COLORS, HOUSE } from '../catalog';
import { HOUSE_DIMS } from '../shapes';
import type { PartDef, StructureContext, StructureDef, V3 } from './kit';
import { RUIN, ruinMass, ruinParts } from './ruin';

/**
 * The tutorial's cottage (migrated onto the kit with identical geometry and behaviour): walls,
 * gables, two roof slabs and a chimney in one anchored body that shatters into those seven pieces.
 * A 30 t iceberg flattens it above 15 m/s (momentum rule: breakImpulse ≈ 562), a 100 t one at 4.5.
 * House-local frame: ridge along x, front door on +z. With no yaw given it turns its door toward
 * the centreline (or up-course toward the player when on the centreline).
 */

const d = HOUSE_DIMS;
const sh = HOUSE.share;
const a = HOUSE.pitch;
const L = d.slabLength;
const innerTopY = d.ridgeBottom + d.t / d.cosA;
const slabY = innerTopY - (d.t / 2) * d.cosA - (L / 2) * d.sinA;
const slabZ = -(d.t / 2) * d.sinA + (L / 2) * d.cosA;
const ch = HOUSE.chimney;
const chZ = -d.D * 0.22;
const roofUnder = d.H + (d.D / 2 - Math.abs(chZ)) * d.tanA;
const wallX = d.W / 2 - d.T / 2;
const wallZ = d.D / 2 - d.T / 2;
const ONE = [1, 1, 1] as const;

const geom = (key: string): PartDef['shape'] => ({ type: 'geom', key });

const PARTS: PartDef[] = [
  {
    shape: geom('houseFront'),
    name: 'wall',
    at: [0, d.H / 2, wallZ],
    size: ONE,
    color: 'wall',
    weight: sh.front,
  },
  {
    shape: geom('houseBack'),
    name: 'wall',
    at: [0, d.H / 2, -wallZ],
    size: ONE,
    rot: [0, Math.PI, 0],
    color: 'wall',
    weight: sh.back,
  },
  {
    shape: geom('houseGable'),
    name: 'gable',
    at: [wallX, 0, 0],
    size: ONE,
    rot: [0, Math.PI / 2, 0],
    color: 'wall',
    weight: sh.gable,
  },
  {
    shape: geom('houseGable'),
    name: 'gable',
    at: [-wallX, 0, 0],
    size: ONE,
    rot: [0, -Math.PI / 2, 0],
    color: 'wall',
    weight: sh.gable,
  },
  {
    shape: geom('roofSlab'),
    name: 'roof',
    at: [0, slabY, slabZ],
    size: ONE,
    rot: [a, 0, 0],
    color: 'roof',
    weight: sh.roof,
  },
  {
    shape: geom('roofSlab'),
    name: 'roof',
    at: [0, slabY, -slabZ],
    size: ONE,
    rot: [-a, 0, 0],
    color: 'roof',
    weight: sh.roof,
  },
  {
    shape: geom('chimney'),
    name: 'chimney',
    at: [d.W * 0.22, roofUnder - 0.1 + ch.h / 2, chZ],
    size: ONE,
    color: 'chimney',
    weight: sh.chimney,
    plume: 'thin',
  },
];

/** Piece names of PARTS, in order, for the ruined look (the intact house leaves them unnamed). */
const PIECES = ['front', 'back', 'gableR', 'gableL', 'roofF', 'roofB', 'chimney'] as const;

/**
 * The ruined cottage (ObstaclePlacement.variant 'ruined', see ./ruin.ts): one gable wall and one roof
 * slab gone (and mostly the chimney), its door and windows dark holes, a flood line round it.
 */
function ruinedHouse(ctx: StructureContext): { parts: PartDef[]; mass: number } {
  const intact = PARTS.map((p, i) => ({ ...p, piece: PIECES[i] }));
  // The collapse is always on the +x / +z corner (the right gable and the front roof slab): a level
  // author turns the ruin (yaw) so that corner faces up the course, where the chase camera comes from,
  // and the slab that remains is seen across, never edge-on (playtest 2 review).
  const side = 1;
  const gone = ['gableR', 'roofF'];
  if (ctx.rng() < 0.5) gone.push('chimney');
  const zF = d.D / 2 + 0.02;
  const xG = d.W / 2 + 0.02;
  const pane = (at: V3, size: V3, piece: string): PartDef => ({ shape: 'box', at, size, color: 'glass', decor: true, piece });
  const openings: PartDef[] = [
    pane([1.2, 1.65, zF], [1.0, 0.95, 0.04], 'front'),
    pane([-1.5, 0.98, zF], [1.0, 1.9, 0.04], 'front'),
    pane([1.5, 1.65, -zF], [1.0, 0.95, 0.04], 'back'),
    pane([-1.5, 1.65, -zF], [1.0, 0.95, 0.04], 'back'),
    pane([xG, 1.6, 0], [0.04, 0.9, 0.9], 'gableR'),
    pane([xG, d.H + 0.75, 0], [0.04, 0.5, 0.5], 'gableR'),
    pane([-xG, 1.6, 0], [0.04, 0.9, 0.9], 'gableL'),
    pane([-xG, d.H + 0.75, 0], [0.04, 0.5, 0.5], 'gableL'),
  ];
  // The body sits on the lowest ground under its footprint (anchored 'footprint'): its y = 0.
  let shift = Infinity;
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]] as const) {
    shift = Math.min(shift, ctx.groundAt((x * d.W) / 2, (z * d.D) / 2));
  }
  const w = d.W / 2;
  const h = d.D / 2;
  const parts = ruinParts(ctx, [...intact, ...openings], {
    gone,
    faces: [
      { a: [-w, h], b: [w, h], piece: 'front', color: 'wall' },
      { a: [w, -h], b: [-w, -h], piece: 'back', color: 'wall' },
      { a: [w, -h], b: [w, h], piece: 'gableR', color: 'wall' },
      { a: [-w, h], b: [-w, -h], piece: 'gableL', color: 'wall' },
    ],
    rubble: { at: [side * (w + 1.1), 0], along: [0, 1], length: d.D },
    sag: 'x',
    groundShift: shift,
  });
  return { parts, mass: ruinMass(HOUSE.mass, intact, parts) };
}

const house: StructureDef = {
  kind: 'house',
  label: 'House',
  material: 'masonry',
  building: true,
  footprint: 6,
  palettes: { wall: COLORS.wall, roof: COLORS.roof, chimney: COLORS.chimney },
  breakup: { impulseScale: HOUSE.debrisImpulseScale },
  variants: ['ruined'],
  defaultYaw(ctx) {
    const side = Math.sign(ctx.d);
    return side === 0 ? Math.PI : (side * Math.PI) / 2;
  },
  build: (ctx) => {
    const ruin = ctx.variant === 'ruined' ? ruinedHouse(ctx) : null;
    return [
      {
        part: 'house',
        stand: 'anchored',
        mass: ruin ? ruin.mass : HOUSE.mass,
        breakSpeed: ruin ? HOUSE.breakSpeed * RUIN.strength : HOUSE.breakSpeed,
        breakMode: 'shatter',
        proxy: 'footprint',
        parts: ruin ? ruin.parts : PARTS,
      },
    ];
  },
};

export default house;
