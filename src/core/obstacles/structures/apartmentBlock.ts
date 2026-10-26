import { deco, faceCentreline, groundWall } from './barn';
import type { PartDef, StructureContext, StructureDef } from './kit';

/**
 * A big concrete apartment block (26 × 12 m, eight storeys of 3 m, flat roof at 24 m, parapet to
 * 25.3 m, two lift housings to ~27 m): panel walls with a window band on every upper storey front
 * and back, solid-parapet balconies on the front, a column of stair windows on each gable end, two
 * entrance doors under canopies, roof parapet, lift housings and an antenna as decor.
 * One anchored body of 14 pieces, split the way such a block comes down: the walls in a lower band
 * (storeys 1-4, following the ground: barn.ts groundWall) and an upper band (storeys 5-8) resting
 * on it, front and back in two halves each, and the roof slab in two halves.
 * Mass 110 t, the heaviest building after the cooling tower. A 30 t iceberg can NOT break it (40
 * m/s for 30 t, above the iceberg's 34 m/s speed cap: breakImpulse 1500), so small icebergs bounce
 * off; big ones flatten it: 60 t at 20 m/s, 100 t at 12 m/s, 220 t at 5.5 m/s.
 * Local frame: long side along x, entrances on +z. With no yaw given the entrances face the
 * centreline (or up-course toward the player when on the centreline), like the factory hall.
 */

const W = 26;
const D = 12;
const T = 0.4;
const STOREY = 3;
const STOREYS = 8;
/** Roof underside: the top of the walls. */
const H = STOREY * STOREYS;
/** The lower wall band (storeys 1-4) stops here; the upper band stands on it. */
const BAND = 4 * STOREY;
const ROOF_T = 0.4;
const FRONT_Z = D / 2 - T / 2;
const SIDE_X = W / 2 - T / 2;
const SIDE_Z = D / 2 - T;
/** Front and back are built in two halves: x from -W/2 to 0 and from 0 to W/2. */
const HALVES = [
  [-W / 2, 0],
  [0, W / 2],
] as const;
const GLASS_H = 1.3;
/** Window band centre above a storey's floor. */
const GLASS_Y = 1.6;
const BALCONY: readonly [number, number, number] = [3.0, 1.1, 1.3];

/** Lower ('L', storeys 1-4) or upper ('U') band piece of a wall, by height. */
const band = (y: number): 'L' | 'U' => (y < BAND ? 'L' : 'U');

function walls(ctx: StructureContext): PartDef[] {
  const parts: PartDef[] = [];
  const upperH = H - BAND;
  const upperY = (BAND + H) / 2;
  for (const [i, [x0, x1]] of HALVES.entries()) {
    const xc = (x0 + x1) / 2;
    for (const [sz, side] of [[1, 'front'], [-1, 'back']] as const) {
      const z = sz * FRONT_Z;
      const lower = groundWall(ctx, [x0, z], [x1, z], T, BAND, 'wall', { name: 'wall', piece: `${side}${i}L` });
      parts.push(lower, {
        shape: 'box',
        name: 'wall',
        piece: `${side}${i}U`,
        at: [xc, upperY, z],
        size: [W / 2, upperH, T],
        color: 'wall',
      });
    }
  }
  for (const sx of [-1, 1]) {
    const id = sx > 0 ? 'R' : 'L';
    const x = sx * SIDE_X;
    parts.push(groundWall(ctx, [x, -SIDE_Z], [x, SIDE_Z], T, BAND, 'wall', { name: 'wall', piece: `side${id}L` }));
    parts.push({
      shape: 'box',
      name: 'wall',
      piece: `side${id}U`,
      at: [x, upperY, 0],
      size: [T, upperH, 2 * SIDE_Z],
      color: 'wall',
    });
  }
  return parts;
}

function facades(ctx: StructureContext): PartDef[] {
  const parts: PartDef[] = [];
  for (const [i, [x0, x1]] of HALVES.entries()) {
    const xc = (x0 + x1) / 2;
    // Window bands front and back on storeys 2-8 (the ground floor sits behind doors and the slope).
    for (let k = 1; k < STOREYS; k++) {
      const y = k * STOREY + GLASS_Y;
      const len = W / 2 - 1.6;
      parts.push(deco([xc, y, D / 2 + 0.02], [len, GLASS_H, 0.04], 'glass', { piece: `front${i}${band(y)}` }));
      parts.push(deco([xc, y, -D / 2 - 0.02], [len, GLASS_H, 0.04], 'glass', { piece: `back${i}${band(y)}` }));
      // Two balconies per half on the front, solid parapets in a contrasting paint.
      for (const dx of [-W / 8, W / 8]) {
        const by = k * STOREY + BALCONY[1] / 2;
        const at: [number, number, number] = [xc + dx, by, D / 2 + BALCONY[2] / 2];
        parts.push(deco(at, BALCONY, 'balcony', { piece: `front${i}${band(by)}` }));
      }
    }
    // Entrance door and canopy, the door standing on the ground in front of it.
    const g = ctx.groundAt(xc, D / 2) - 0.03;
    parts.push(deco([xc, g + 1.2, D / 2 + 0.03], [2.0, 2.4, 0.06], 'door', { piece: `front${i}L` }));
    parts.push(deco([xc, g + 2.9, D / 2 + 0.8], [3.2, 0.2, 1.6], 'trim', { piece: `front${i}L` }));
  }
  // A column of stair windows on each gable end.
  for (const sx of [-1, 1]) {
    const id = sx > 0 ? 'R' : 'L';
    for (let k = 1; k < STOREYS; k++) {
      const y = k * STOREY + GLASS_Y;
      parts.push(deco([sx * (W / 2 + 0.02), y, 0], [0.04, 1.0, 1.4], 'glass', { piece: `side${id}${band(y)}` }));
    }
  }
  return parts;
}

function roof(): PartDef[] {
  const parts: PartDef[] = [];
  const top = H + ROOF_T;
  for (const [i, sx] of [-1, 1].entries()) {
    const piece = `roof${i}`;
    const xc = (sx * W) / 4;
    parts.push({
      shape: 'box',
      name: 'roof',
      piece,
      at: [xc, H + ROOF_T / 2, 0],
      size: [W / 2 - 0.01, ROOF_T, D],
      color: 'roof',
    });
    // Parapet along the roof edges and a lift housing per stairwell.
    for (const sz of [-1, 1]) {
      parts.push(deco([xc, top + 0.45, sz * (D / 2 - 0.125)], [W / 2 - 0.01, 0.9, 0.25], 'wall', { piece }));
    }
    parts.push(deco([sx * (W / 2 - 0.125), top + 0.45, 0], [0.25, 0.9, D - 0.5], 'wall', { piece }));
    parts.push(deco([xc, top + 1.3, -1.5], [3.6, 2.6, 4], 'wall', { piece }));
  }
  parts.push(deco([-W / 4 + 1, top + 2.6 + 1.5, -2.5], [0.1, 3, 0.1], 'trim', { piece: 'roof0' }));
  return parts;
}

const apartmentBlock: StructureDef = {
  kind: 'apartmentBlock',
  label: 'Apartment block',
  material: 'masonry',
  building: true,
  footprint: 14.5,
  palettes: {
    // Concrete panels and render: off-white, pale and mid concrete, sand, pinkish beige, blue-grey.
    wall: [0xd9d4c7, 0xc8c2b4, 0xb9b3a6, 0xd8c7a3, 0xc9b8a8, 0xa9b4b6],
    // Balcony parapets: white, pale blue, terracotta, sage, ochre.
    balcony: [0xe8e4da, 0x8fb3c9, 0xc9774d, 0x9db08a, 0xe0c36a],
    glass: [0x2e3d4a, 0x35495a],
    // Bitumen or gravel roofing.
    roof: [0x55595c, 0x6a6e70],
    door: [0x4a3a2c, 0x2f4f6f, 0x7a2e26],
    trim: [0x8e9397, 0x6f7478],
  },
  // Like the factory hall: big heavy panels collapse roughly in place instead of skating away.
  breakup: { impulseScale: 0.45, spin: 0.15, falloff: 6, floor: 0.2 },
  defaultYaw: faceCentreline,
  build: (ctx) => [
    {
      part: 'apartmentBlock',
      stand: 'anchored',
      ground: 'fixed',
      mass: 110,
      breakSpeed: 40,
      breakMode: 'shatter',
      parts: [...walls(ctx), ...facades(ctx), ...roof()],
    },
  ],
};

export default apartmentBlock;
