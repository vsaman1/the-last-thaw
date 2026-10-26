import { deco, faceCentreline, groundWall } from './barn';
import { maxGround, type PartDef, type StructureContext, type StructureDef } from './kit';

/**
 * A town monument on a stepped stone plinth: a 5 m and a 3.8 m step, then a 2.6 m pedestal with a
 * bronze plaque on its front, crowned (picked per placement) by a stone obelisk 9 m tall with its
 * pyramidion (two in three) or by a bronze figure in a long coat on a bronze base (one in three).
 * Top of the obelisk ~13.6 m above the lower step's base, of the figure ~7.5 m. The cornice, plaque,
 * wreath, and the figure's arms are decor.
 * One anchored body that shatters into 3 pieces: the steps, the pedestal, and the obelisk or figure
 * (which falls on its own). Mass 40 t either way; a 30 t iceberg breaks it above 16 m/s
 * (breakImpulse 600), a 60 t one at 8 m/s, a 100 t one at 4.8 m/s.
 * Ground: the lower step's bottom follows the ground (barn.ts groundWall) and its top is level, 0.5 m
 * above the highest ground under it. With no yaw given the plaque faces the centreline (or up-course
 * toward the player when on the centreline).
 */

const STEP0 = 5;
const STEP1 = 3.8;
const STEP_H = 0.5;
const PED = 2.4;
const PED_H = 2.6;
/** Gap between pieces so a smashed monument's pieces never start inside each other. */
const GAP = 0.03;
const SHAFT_H = 9;
const SHAFT_BASE = 1.5;
const SHAFT_TAPER = 0.6;
const CAP_H = 1;
/** A 4-sided kit cylinder or cone is a square with its edges along x and z, side 0.71 × size. */
const SQUARE = Math.SQRT2;
/** Share of placements that get the obelisk; the rest get the bronze figure. */
const OBELISK_SHARE = 2 / 3;

function plinth(ctx: StructureContext): { parts: PartDef[]; top: number } {
  const h = STEP0 / 2;
  const zs = [-h, -h / 2, 0, h / 2, h];
  const y0 = maxGround(ctx, -h, h, zs, 0.5) + STEP_H;
  const y1 = y0 + STEP_H;
  const top = y1 + GAP + PED_H;
  const step = { piece: 'steps', name: 'steps', color: 'stone' } as const;
  const ped = { piece: 'pedestal', name: 'pedestal', color: 'stone' } as const;
  const parts: PartDef[] = [
    groundWall(ctx, [0, -h], [0, h], STEP0, y0, 'stone', { piece: 'steps', name: 'steps', weight: 3 }),
    { shape: 'box', ...step, at: [0, y0 + STEP_H / 2, 0], size: [STEP1, STEP_H, STEP1], weight: 1.5 },
    { shape: 'box', ...ped, at: [0, y1 + GAP + PED_H / 2, 0], size: [PED, PED_H, PED], weight: 2 },
    deco([0, top - 0.15, 0], [PED + 0.3, 0.3, PED + 0.3], 'stone', { piece: 'pedestal' }),
    deco([0, y1 + GAP + 1.3, PED / 2 + 0.02], [1.2, 0.8, 0.04], 'bronze', { piece: 'pedestal' }),
    // A wreath laid against the pedestal's foot.
    {
      shape: { type: 'cylinder', segments: 8 },
      piece: 'pedestal',
      at: [0, y1 + 0.45, PED / 2 + 0.12],
      size: [0.8, 0.2, 0.8],
      rot: [Math.PI / 2, 0, 0],
      color: 'wreath',
      decor: true,
    },
  ];
  return { parts, top };
}

function obelisk(base: number): PartDef[] {
  const capBase = SHAFT_BASE * SHAFT_TAPER;
  return [
    {
      shape: { type: 'cylinder', segments: 4, taper: SHAFT_TAPER },
      piece: 'crown',
      name: 'obelisk',
      at: [0, base + SHAFT_H / 2, 0],
      size: [SHAFT_BASE * SQUARE, SHAFT_H, SHAFT_BASE * SQUARE],
      color: 'stone',
      weight: 2,
    },
    {
      shape: { type: 'cone', segments: 4 },
      piece: 'crown',
      name: 'obelisk',
      at: [0, base + SHAFT_H + CAP_H / 2, 0],
      size: [capBase * SQUARE, CAP_H, capBase * SQUARE],
      color: 'stone',
      weight: 0.1,
    },
  ];
}

/** A standing figure in a long coat, one arm raised, on a bronze base (heroic scale, ~3.2 m). */
function figure(base: number): PartDef[] {
  const coat = base + 0.3;
  const statue = { piece: 'crown', name: 'statue', color: 'bronze' } as const;
  const cyl = (taper = 1): PartDef['shape'] => ({ type: 'cylinder', segments: 8, taper });
  return [
    { shape: 'box', ...statue, at: [0, base + 0.15, 0], size: [1.6, 0.3, 1.4], weight: 0.6 },
    { shape: cyl(0.6), ...statue, at: [0, coat + 1.3, 0], size: [1.1, 2.6, 0.8], weight: 1.2 },
    { shape: cyl(), ...statue, at: [0, coat + 2.9, 0], size: [0.45, 0.55, 0.5], weight: 0.2 },
    deco([0, coat + 2.55, 0], [1.05, 0.25, 0.5], 'bronze', { piece: 'crown' }),
    deco([-0.6, coat + 1.75, 0.05], [0.22, 1.2, 0.22], 'bronze', { piece: 'crown' }, [0, 0, -0.12]),
    deco([0.62, coat + 3.0, 0.05], [0.22, 1.3, 0.22], 'bronze', { piece: 'crown' }, [0.2, 0, 0.35]),
  ];
}

const monument: StructureDef = {
  kind: 'monument',
  label: 'Monument',
  material: 'masonry',
  footprint: 3.6,
  palettes: {
    // Granite greys, limestone, red sandstone.
    stone: [0xa7a9a6, 0x8f9290, 0xd2ccbc, 0xa5634a],
    // Weathered bronze: verdigris or dark.
    bronze: [0x4f7f6a, 0x5e8a74, 0x6b4f2a],
    wreath: [0x3f6b3a],
  },
  breakup: { impulseScale: 0.6, spin: 0.25, falloff: 3, floor: 0.25 },
  defaultYaw: faceCentreline,
  build(ctx) {
    const { parts, top } = plinth(ctx);
    const crown = ctx.rng() < OBELISK_SHARE ? obelisk(top + GAP) : figure(top + GAP);
    return [
      {
        part: 'monument',
        stand: 'anchored',
        ground: 'fixed',
        mass: 40,
        breakSpeed: 16,
        breakMode: 'shatter',
        parts: [...parts, ...crown],
      },
    ];
  },
};

export default monument;
