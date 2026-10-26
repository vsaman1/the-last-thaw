import { deco } from './barn';
import type { PartDef, StructureContext, StructureDef } from './kit';
import { strut } from './pumpjack';

/**
 * A small fixed offshore oil platform for shallow coastal water: four steel legs 1.4 m across, 12 ×
 * 10 m apart, standing on the sea floor; a 16 × 14 m steel deck 6 m above the water; a process
 * module with a helideck on its roof; a drilling derrick (a square frustum 4.2 m → 1.2 m, 16 m tall)
 * and a flare stack with its flame at one corner. Cross-bracing between the legs, the helideck, crane
 * boom, lifeboat, crown block and flame are decor.
 * Water depth: every leg runs from the ground under it (ctx.groundAt: the sea floor) up to the deck,
 * whose underside sits DECK_CLEAR above sea level (ctx.seaLevel) or, when placed on land (the kit
 * tests, a level editor), above the highest ground under the legs: the same definition stands in
 * any depth. Placement: SEA_KINDS in terrain/validate.ts (open water required, no coast rule).
 * One anchored body of 8 colliders that shatters into 8 pieces (four legs, deck, module, derrick,
 * flare stack). Mass 60 t; a 30 t iceberg breaks it above 16 m/s (breakImpulse 600), a 60 t one at
 * 8 m/s, a 100 t one at 4.8 m/s. Metal: the wreck sinks.
 * Local frame: derrick toward -x, module toward +x. With no yaw given it is turned at random.
 */

const LEG_X = 6;
const LEG_Z = 5;
const LEG_D = 1.4;
/** Legs are driven a little into the ground so a sloping sea floor never shows a gap under one. */
const LEG_SINK = 0.3;
const DECK_W = 16;
const DECK_D = 14;
const DECK_T = 1.2;
/** Deck underside above the water: waves and small icebergs pass under it, between the legs. */
const DECK_CLEAR = 6;
/** Gap between pieces so a smashed rig's pieces never start inside each other. */
const GAP = 0.05;
const MODULE: readonly [number, number, number] = [7, 4, 9];
const MODULE_X = 4;
const DERRICK_H = 16;
const DERRICK_BASE = 4.2;
const DERRICK_TAPER = 1.2 / DERRICK_BASE;
const DERRICK_AT: readonly [number, number] = [-4, -1];
const FLARE_H = 14;
const FLARE_AT: readonly [number, number] = [-7, 6];
/** A 4-sided kit cylinder is a square with its edges along x and z, side 0.71 × size. */
const SQUARE = Math.SQRT2;

const LEGS = [
  [-LEG_X, -LEG_Z],
  [LEG_X, -LEG_Z],
  [LEG_X, LEG_Z],
  [-LEG_X, LEG_Z],
] as const;

function build(ctx: StructureContext): PartDef[] {
  const grounds = LEGS.map(([x, z]) => ctx.groundAt(x, z));
  const base = Math.max(ctx.seaLevel, ...grounds);
  const deckY = base + DECK_CLEAR;
  const deckTop = deckY + DECK_T;
  const parts: PartDef[] = [];
  LEGS.forEach(([x, z], i) => {
    const y0 = grounds[i] - LEG_SINK;
    const y1 = deckY - GAP;
    parts.push({
      shape: { type: 'cylinder', segments: 10 },
      piece: `leg${i}`,
      name: 'leg',
      at: [x, (y0 + y1) / 2, z],
      size: [LEG_D, y1 - y0, LEG_D],
      color: 'jacket',
      weight: 1,
    });
  });
  // X-bracing on each face of the jacket, from the foot of one leg to the top of the next.
  LEGS.forEach(([x, z], i) => {
    const j = (i + 1) % LEGS.length;
    const [xn, zn] = LEGS[j];
    parts.push(strut([x, grounds[i] + 0.5, z], [xn, deckY - 0.6, zn], 0.35, 'jacket'));
    parts.push(strut([xn, grounds[j] + 0.5, zn], [x, deckY - 0.6, z], 0.35, 'jacket'));
  });
  parts.push({
    shape: 'box',
    piece: 'deck',
    name: 'deck',
    at: [0, deckY + DECK_T / 2, 0],
    size: [DECK_W, DECK_T, DECK_D],
    color: 'deck',
    weight: 2.5,
  });
  // Process module with the helideck (a dark octagon and its white ring) on its roof.
  const modTop = deckTop + GAP + MODULE[1];
  parts.push(
    {
      shape: 'box',
      piece: 'module',
      name: 'module',
      at: [MODULE_X, deckTop + GAP + MODULE[1] / 2, 0],
      size: MODULE,
      color: 'module',
      weight: 1.5,
    },
    { ...octagon([MODULE_X, modTop + 0.2, 0], 8, 0.3, 'helideck'), piece: 'module' },
    { ...octagon([MODULE_X, modTop + 0.37, 0], 5, 0.04, 0xf2f2ee), piece: 'module' },
  );
  // Derrick, crown block, flare stack and its flame.
  const [dx, dz] = DERRICK_AT;
  parts.push(
    {
      shape: { type: 'cylinder', segments: 4, taper: DERRICK_TAPER },
      piece: 'derrick',
      name: 'derrick',
      at: [dx, deckTop + GAP + DERRICK_H / 2, dz],
      size: [DERRICK_BASE * SQUARE, DERRICK_H, DERRICK_BASE * SQUARE],
      color: 'derrick',
      weight: 1,
    },
    deco([dx, deckTop + GAP + DERRICK_H + 0.4, dz], [1.6, 0.8, 1.6], 'steel', { piece: 'derrick' }),
  );
  const [fx, fz] = FLARE_AT;
  parts.push(
    {
      shape: { type: 'cylinder', segments: 8 },
      piece: 'flare',
      name: 'flare',
      at: [fx, deckTop + GAP + FLARE_H / 2, fz],
      size: [0.8, FLARE_H, 0.8],
      color: 'steel',
      weight: 0.2,
    },
    {
      shape: { type: 'cone', segments: 6 },
      piece: 'flare',
      at: [fx, deckTop + GAP + FLARE_H + 1.2, fz],
      size: [1.3, 2.4, 1.3],
      color: 'flame',
      decor: true,
    },
  );
  // Crane boom over the side and a lifeboat hung at the deck edge.
  parts.push({ ...strut([1.5, modTop, 4], [-4, modTop + 5, 7], 0.4, 'crane'), piece: 'module' });
  parts.push(deco([4, deckY - 0.2, DECK_D / 2 + 0.75], [3.2, 1.3, 1.4], 'lifeboat', { piece: 'deck' }));
  return parts;
}

/** A flat octagonal decor disc `d` across and `t` thick centred at `at`. */
function octagon(at: readonly [number, number, number], d: number, t: number, color: string | number): PartDef {
  return { shape: { type: 'cylinder', segments: 8 }, at, size: [d, t, d], color, decor: true };
}

const oilRig: StructureDef = {
  kind: 'oilRig',
  label: 'Oil rig',
  material: 'metal',
  footprint: 10.8,
  palettes: {
    // Jacket legs: anti-corrosion yellow, grey or rust-streaked orange.
    jacket: [0xd9a521, 0x8e959a, 0xb5622e],
    deck: [0x5b6166, 0x4a4f54],
    // Process module cladding: white, pale grey, safety orange.
    module: [0xe6e4dd, 0xc9ccce, 0xd9682b],
    derrick: [0xb3322b, 0xe6e4dd, 0xd9a521],
    helideck: [0x2f5a3c, 0x3b3f44],
    steel: [0x6f777d, 0x5b6166],
    crane: [0xd9a521, 0xd9682b],
    lifeboat: [0xe8601c],
    flame: [0xff9a2e, 0xffb347],
  },
  // Heavy steel: the topsides drop roughly in place and the legs fold, rather than skating away.
  breakup: { impulseScale: 0.5, spin: 0.25, falloff: 5, floor: 0.2 },
  defaultYaw: (ctx) => ctx.rng() * 2 * Math.PI,
  build: (ctx) => [
    {
      part: 'oilRig',
      stand: 'anchored',
      ground: 'fixed',
      mass: 60,
      breakSpeed: 16,
      breakMode: 'shatter',
      parts: build(ctx),
    },
  ],
};

export default oilRig;
