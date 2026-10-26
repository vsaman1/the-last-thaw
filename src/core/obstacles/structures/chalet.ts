import { deco, faceCentreline, groundWall, roofSlab, type P2 } from './barn';
import type { PartDef, StructureContext, StructureDef } from './kit';
import { RUIN, ruinMass, ruinParts } from './ruin';

/**
 * An alpine timber chalet (8.4 × 9.6 m, two storeys, steep 40° roof with deep overhangs, ridge
 * 8.7 m): dark larch walls over a white-plastered ground floor, a full-width front balcony with
 * board railing and geranium boxes, shuttered windows, a stone chimney. One anchored body of 9
 * pieces: four walls, two gables, two roof slabs and the balcony.
 * Mass 15 t (timber); a 30 t iceberg breaks it above 12 m/s (breakImpulse 450), weaker than the
 * stone house (15 m/s); a 100 t iceberg needs only 3.6 m/s.
 * Local frame: ridge along z, gable and balcony on +z. With no yaw given the balcony faces the
 * centreline (or up-course toward the player on the centreline).
 * Ground: walls follow the ground (barn.ts groundWall), so on a slope it stands level with a
 * taller downhill side, as chalets on a hillside do.
 */

const W = 8.4;
const D = 9.6;
/** Ground-floor (plastered) height and eave height above the ground at the origin. */
const G = 2.7;
const E = 5.2;
const T = 0.3;
const PITCH = (40 * Math.PI) / 180;
const RISE = (W / 2) * Math.tan(PITCH);
const ROOF_T = 0.26;
/** Eave overhang along the slope; gable overhangs at the front (over the balcony) and back. */
const EAVE_OUT = 1.1;
const FRONT_OUT = 1.7;
const BACK_OUT = 0.7;
const BALC_D = 1.35;
const BALC_W = 8.8;
const BALC_Y = G;
const FRONT_Z = D / 2 - T / 2;
const SIDE_X = W / 2 - T / 2;
const SIDE_Z = D / 2 - T;

/** Glass plus a pair of shutters on the front face (z = zf), centred at (x, y). */
function shutteredWindow(x: number, y: number, zf: number, w: number, h: number, piece: string): PartDef[] {
  return [
    deco([x, y, zf + 0.02], [w, h, 0.04], 'glass', { piece }),
    deco([x - w / 2 - 0.27, y, zf + 0.03], [0.5, h, 0.05], 'shutter', { piece }),
    deco([x + w / 2 + 0.27, y, zf + 0.03], [0.5, h, 0.05], 'shutter', { piece }),
  ];
}

/** Lowest ground (relative) along the outer face of a wall from a to b. */
function faceLow(ctx: StructureContext, a: P2, b: P2): number {
  let low = Infinity;
  for (let i = 0; i <= 4; i++) {
    low = Math.min(low, ctx.groundAt(a[0] + ((b[0] - a[0]) * i) / 4, a[1] + ((b[1] - a[1]) * i) / 4));
  }
  return low;
}

function build(ctx: StructureContext): PartDef[] {
  const parts: PartDef[] = [];
  const wall = (a: P2, b: P2, piece: string): PartDef =>
    groundWall(ctx, a, b, T, E, 'timber', { piece, name: 'wall' });
  parts.push(wall([-W / 2, FRONT_Z], [W / 2, FRONT_Z], 'front'));
  parts.push(wall([W / 2, -FRONT_Z], [-W / 2, -FRONT_Z], 'back'));
  parts.push(wall([SIDE_X, -SIDE_Z], [SIDE_X, SIDE_Z], 'right'));
  parts.push(wall([-SIDE_X, SIDE_Z], [-SIDE_X, -SIDE_Z], 'left'));

  // Plastered ground floor: render-only skins on the four outer faces, from the ground up to G.
  const skins: [P2, P2, string][] = [
    [[-W / 2, D / 2], [W / 2, D / 2], 'front'],
    [[-W / 2, -D / 2], [W / 2, -D / 2], 'back'],
    [[W / 2, -D / 2], [W / 2, D / 2], 'right'],
    [[-W / 2, -D / 2], [-W / 2, D / 2], 'left'],
  ];
  for (const [a, b, piece] of skins) {
    const y0 = faceLow(ctx, a, b) - 0.06;
    if (G - y0 < 0.2) continue;
    const alongX = a[1] === b[1];
    const out = 0.015;
    const at: [number, number, number] = alongX
      ? [0, (y0 + G) / 2, a[1] + Math.sign(a[1]) * out]
      : [a[0] + Math.sign(a[0]) * out, (y0 + G) / 2, 0];
    const size: [number, number, number] = alongX ? [W + 0.04, G - y0, 0.03] : [0.03, G - y0, D];
    parts.push(deco(at, size, 'plaster', { piece }));
  }

  // Gables and the two roof slabs (ridge along z, deep overhang over the balcony).
  for (const [sz, piece] of [[1, 'gableF'], [-1, 'gableB']] as const) {
    parts.push({
      shape: { type: 'prism', id: 'chalet-gable', outline: [[-1, 0], [1, 0], [0, 1]] },
      piece,
      name: 'gable',
      at: [0, E + RISE / 2, sz * FRONT_Z],
      size: [W, RISE, T],
      color: 'timber',
    });
  }
  const depth = D + FRONT_OUT + BACK_OUT;
  const zc = (FRONT_OUT - BACK_OUT) / 2;
  const ridge: P2 = [0, E + RISE];
  for (const sx of [-1, 1]) {
    const lip: P2 = [sx * (W / 2 + EAVE_OUT * Math.cos(PITCH)), E - EAVE_OUT * Math.sin(PITCH)];
    const piece = sx > 0 ? 'roofR' : 'roofL';
    parts.push(roofSlab(lip, ridge, ROOF_T, depth, zc, [0, E], 'roof', { piece, name: 'roof' }));
  }
  parts.push(deco([0, E + RISE + 0.1, zc], [0.45, 0.16, depth + 0.04], 'roof', { piece: 'roofR' }));
  // Stone chimney through the left slab, with a cap.
  const chX = -1.8;
  const roofTop = E + RISE - Math.abs(chX) * Math.tan(PITCH) + ROOF_T / Math.cos(PITCH);
  parts.push(deco([chX, roofTop + 0.45, -1.6], [0.7, 1.7, 0.7], 'plaster', { piece: 'roofL' }));
  const cap = deco([chX, roofTop + 1.36, -1.6], [0.9, 0.12, 0.9], 'roof', { piece: 'roofL' });
  parts.push({ ...cap, plume: 'thin' });

  // Balcony: a slab cantilevered from the front wall at the upper floor, board railing, flowers.
  const bz = D / 2 + 0.01 + BALC_D / 2;
  parts.push({
    shape: 'box',
    piece: 'balcony',
    name: 'balcony',
    at: [0, BALC_Y, bz],
    size: [BALC_W, 0.2, BALC_D],
    color: 'board',
  });
  const railY = BALC_Y + 0.1 + 0.55;
  const fz = D / 2 + 0.01 + BALC_D - 0.04;
  const balcony = { piece: 'balcony' };
  parts.push(deco([0, railY, fz], [BALC_W, 0.9, 0.06], 'board', balcony));
  for (const sx of [-1, 1]) {
    parts.push(deco([sx * (BALC_W / 2 - 0.03), railY, bz], [0.06, 0.9, BALC_D - 0.1], 'board', balcony));
    parts.push(deco([sx * (BALC_W / 2 - 0.03), railY + 0.5, bz], [0.12, 0.08, BALC_D], 'timber', balcony));
  }
  parts.push(deco([0, railY + 0.5, fz], [BALC_W + 0.1, 0.08, 0.14], 'timber', balcony));
  // Carved-board look: dark slots in the railing.
  for (let i = -2; i <= 2; i++) {
    parts.push(deco([i * 1.7, railY, fz + 0.035], [0.14, 0.5, 0.02], 0x3a2616, balcony));
  }
  for (const x of [-2.9, 0, 2.9]) {
    parts.push(deco([x, railY + 0.3, fz + 0.2], [1.3, 0.26, 0.3], 'timber', balcony));
    parts.push(deco([x, railY + 0.5, fz + 0.2], [1.2, 0.2, 0.26], 'flower', balcony));
  }

  // Openings: door and shuttered windows on the front, glazed doors behind the balcony, windows
  // on the gable, the sides and the back.
  const zf = D / 2;
  const doorY0 = ctx.groundAt(-2.4, zf) - 0.03;
  const doorH = Math.max(1.6, Math.min(2.1, G - 0.25 - doorY0));
  parts.push(deco([-2.4, doorY0 + doorH / 2, zf + 0.025], [1.0, doorH, 0.05], 0x4a2f1c, { piece: 'front' }));
  parts.push(...shutteredWindow(0.2, 1.55, zf, 0.9, 1.1, 'front'));
  parts.push(...shutteredWindow(2.6, 1.55, zf, 0.9, 1.1, 'front'));
  parts.push(deco([0, G + 1.15, zf + 0.02], [1.1, 2.0, 0.04], 'glass', { piece: 'front' }));
  parts.push(...shutteredWindow(-2.6, G + 1.4, zf, 0.9, 1.1, 'front'));
  parts.push(...shutteredWindow(2.6, G + 1.4, zf, 0.9, 1.1, 'front'));
  parts.push(deco([0, E + 1.1, zf + 0.02], [1.0, 0.95, 0.04], 'glass', { piece: 'gableF' }));
  parts.push(deco([0, E + 1.1, -zf - 0.02], [0.8, 0.8, 0.04], 'glass', { piece: 'gableB' }));
  for (const sx of [-1, 1]) {
    const piece = sx > 0 ? 'right' : 'left';
    for (const z of [-2.3, 2.3]) {
      for (const y of [1.55, G + 1.4]) {
        parts.push(deco([sx * (W / 2 + 0.02), y, z], [0.04, 1.05, 0.9], 'glass', { piece }));
      }
    }
  }
  for (const x of [-2.0, 2.0]) {
    parts.push(deco([x, 1.55, -zf - 0.02], [0.9, 1.05, 0.04], 'glass', { piece: 'back' }));
  }
  return parts;
}

/**
 * The ruined chalet (ObstaclePlacement.variant 'ruined', see ./ruin.ts): its +x side gone (its wall
 * and its roof slab, and the balcony; the back-gable collapse is kept below but no longer chosen);
 * the flood line on the plastered ground floor, windows broken.
 */
function ruinedChalet(ctx: StructureContext): { parts: PartDef[]; mass: number } {
  const intact = build(ctx);
  // Always the +x side collapse (its wall, roof slab and the balcony): a level author turns the ruin
  // (yaw) so that side faces up the course, where the chase camera comes from (playtest 2 review).
  const side: number = 1;
  const sideCollapse: boolean = true;
  const s = side > 0 ? 'R' : 'L';
  const gone = sideCollapse ? [side > 0 ? 'right' : 'left', `roof${s}`, 'balcony'] : [`roof${s}`, 'gableB'];
  const w = W / 2;
  const h = D / 2;
  const parts = ruinParts(ctx, intact, {
    gone,
    faces: [
      { a: [-w, h], b: [w, h], piece: 'front', color: 'plaster' },
      { a: [w, -h], b: [-w, -h], piece: 'back', color: 'plaster' },
      { a: [w, -h], b: [w, h], piece: 'right', color: 'plaster' },
      { a: [-w, h], b: [-w, -h], piece: 'left', color: 'plaster' },
    ],
    rubble: sideCollapse
      ? { at: [side * (w + 1.2), 0], along: [0, 1], length: D }
      : { at: [0, -(h + 1.2)], along: [1, 0], length: W },
    sag: 'z',
  });
  return { parts, mass: ruinMass(15, intact, parts) };
}

const chalet: StructureDef = {
  kind: 'chalet',
  label: 'Chalet',
  material: 'wood',
  building: true,
  footprint: 8.5,
  palettes: {
    // Weathered larch / spruce, dark to honey brown.
    timber: [0x7a4e2d, 0x6b4428, 0x8a5a34, 0x5e3b22],
    // Lighter boards for the balcony.
    board: [0xa0703f, 0x9a6a3c, 0xab7a48],
    // Lime plaster or grey stone base.
    plaster: [0xf2eee4, 0xe9e3d3, 0xd9d4c8],
    // Dark wooden shingles, slate, dark metal.
    roof: [0x4a3b32, 0x55595e, 0x3d4248, 0x6b5a4c],
    // Classic shutter colours: green, oxblood, dark green.
    shutter: [0x2f6b3a, 0x9c2f24, 0x3a5a3a],
    glass: [0x26313b],
    // Geraniums.
    flower: [0xd8323f, 0xe0457b, 0xc8243a],
  },
  breakup: { impulseScale: 0.75, spin: 0.4, falloff: 3, floor: 0.25 },
  variants: ['ruined'],
  defaultYaw: faceCentreline,
  build: (ctx) => {
    const ruin = ctx.variant === 'ruined' ? ruinedChalet(ctx) : null;
    return [
      {
        part: 'chalet',
        stand: 'anchored',
        ground: 'fixed',
        mass: ruin ? ruin.mass : 15,
        breakSpeed: ruin ? 12 * RUIN.strength : 12,
        breakMode: 'shatter',
        parts: ruin ? ruin.parts : build(ctx),
      },
    ];
  },
};

export default chalet;
