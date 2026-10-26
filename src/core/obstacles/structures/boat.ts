import type { PartDef, StructureDef } from './kit';

/**
 * A small wooden fishing boat for harbours (8 m long, 2.9 m beam, 3 t): one loose body. Four
 * parts collide: the bottom (a narrower pointed hull below the waterline), the raised bow
 * (forecastle), the stern topsides and the wheelhouse base. The wheelhouse with its windows and
 * roof, the mast, radar, exhaust, stern gantry, net drum, fish boxes, gunwales and rubbing strakes
 * are decor. Wood floats: the water forces lift a floating body until half its collider height is
 * under (WATER_TUNING.floatRatio × buoyancy 1), and the colliders stop at the wheelhouse base
 * (2 m) on purpose, so it floats with the bottom submerged, 0.6 m of freeboard aft and 1 m at the
 * bow. The water model lifts at the centre of the colliders' bounding box, so the part weights
 * (engine and ballast low in the bottom, gear and hold forward) put the centre of mass right under
 * it and 0.27 m lower: it floats level and rights itself. A hit above 9 m/s by a 30 t iceberg
 * (loose-body impulse ~31 t·m/s; ≈ 8.4 m/s at 100 t) smashes it into bottom, bow, stern and
 * wheelhouse; slower hits shove it aside (a 30 t iceberg at 6 m/s loses ~0.7 m/s).
 *
 * Placed over open water it spawns afloat (ground 'float': hull bottom 1 m below the surface); on a
 * beach or in shallows it rests on its flat bottom. Local frame: +z = bow. With no yaw given it is moored at a random heading.
 */

const BOTTOM_H = 0.75;
const DECK_Y = 1.6;
const BOW_TOP = 2.0;
const HALF_BEAM = 1.45;
const STERN_Z = -4.0;
const BOW_Z = 4.0;
const HOUSE_Z0 = -2.0;
const HOUSE_Z1 = -0.1;
const HOUSE_HALF_W = 1.05;
const HOUSE_BASE = 2.0;
const HOUSE_TOP = 3.3;
/** Gap between pieces so a smashed boat's pieces never start inside each other. */
const GAP = 0.01;
/** Top-down prisms are extruded along local z, then turned so the outline lies in x/z. */
const FLAT: PartDef['rot'] = [Math.PI / 2, 0, 0];

type Outline = readonly (readonly [number, number])[];
/** Bottom below the chine, top-down (x, z) in metres: narrower and shorter than the topsides. */
const HULL: Outline = [
  [-1.15, -3.7],
  [1.15, -3.7],
  [1.15, 0.3],
  [0.95, 1.9],
  [0.55, 3.0],
  [0, 3.9],
  [-0.55, 3.0],
  [-0.95, 1.9],
  [-1.15, 0.3],
];
/** Forecastle, top-down (x, z): from the full beam amidships to the stem. */
const BOW: Outline = [
  [-HALF_BEAM, 0],
  [HALF_BEAM, 0],
  [1.36, 1.4],
  [0.88, 2.9],
  [0, BOW_Z],
  [-0.88, 2.9],
  [-1.36, 1.4],
];

const detail = (piece: string, at: PartDef['at'], size: PartDef['size'], color: string | number,
  rot?: PartDef['rot']): PartDef => ({ shape: 'box', piece, at, size, color, rot, decor: true });

/** Rubbing strake along the bow's flanks, one box per outline edge on each side. */
function bowStrakes(): PartDef[] {
  const out: PartDef[] = [];
  const right = BOW.slice(1, 5);
  for (let i = 0; i + 1 < right.length; i++) {
    const [u0, v0] = right[i];
    const [u1, v1] = right[i + 1];
    const du = u1 - u0;
    const dv = v1 - v0;
    const len = Math.hypot(du, dv);
    const nu = (dv / len) * 0.012;
    const nv = (-du / len) * 0.012;
    for (const s of [1, -1]) {
      out.push(
        detail('bow', [s * ((u0 + u1) / 2 + nu), 1.25, (v0 + v1) / 2 + nv], [0.02, 0.1, len],
          'trim', [0, s * Math.atan2(du, dv), 0]),
      );
    }
  }
  return out;
}

function wheelhouse(): PartDef[] {
  const zc = (HOUSE_Z0 + HOUSE_Z1) / 2;
  const len = HOUSE_Z1 - HOUSE_Z0;
  const wy = (HOUSE_BASE + HOUSE_TOP) / 2;
  const winY = HOUSE_TOP - 0.35;
  const mastZ = zc - 0.35;
  const mastTop = HOUSE_TOP + 0.12 + 3.2;
  const cyl = (segments: number) => ({ type: 'cylinder', segments }) as const;
  return [
    detail('cabin', [0, wy, zc], [2 * HOUSE_HALF_W, HOUSE_TOP - HOUSE_BASE, len], 'house'),
    detail('cabin', [0, winY, HOUSE_Z1 + 0.012], [1.8, 0.5, 0.02], 'glass'),
    detail('cabin', [0, winY, HOUSE_Z0 - 0.012], [1.4, 0.5, 0.02], 'glass'),
    detail('cabin', [HOUSE_HALF_W + 0.012, winY, zc - 0.1], [0.02, 0.5, 1.3], 'glass'),
    detail('cabin', [-HOUSE_HALF_W - 0.012, winY, zc - 0.1], [0.02, 0.5, 1.3], 'glass'),
    detail('cabin', [HOUSE_HALF_W + 0.03, HOUSE_TOP - 0.15, HOUSE_Z1 - 0.2], [0.04, 0.1, 0.12], 0xc0392b),
    detail('cabin', [-HOUSE_HALF_W - 0.03, HOUSE_TOP - 0.15, HOUSE_Z1 - 0.2], [0.04, 0.1, 0.12], 0x2f8f4f),
    detail('cabin', [0, HOUSE_TOP + 0.06, zc], [2.3, 0.12, len + 0.2], 'roof'),
    detail('cabin', [0, HOUSE_TOP + 0.12 + 1.6, mastZ], [0.12, 3.2, 0.12], 'trim'),
    detail('cabin', [0, mastTop - 0.6, mastZ], [1.2, 0.08, 0.08], 'trim'),
    detail('cabin', [0, mastTop + 0.06, mastZ], [0.14, 0.12, 0.14], 0xfff1c4),
    detail('cabin', [0, HOUSE_TOP + 0.27, zc + 0.35], [0.08, 0.3, 0.08], 'trim'),
    detail('cabin', [0, HOUSE_TOP + 0.45, zc + 0.35], [0.9, 0.08, 0.2], 'trim'),
    { shape: cyl(8), piece: 'cabin', at: [0.7, HOUSE_TOP + 0.4, HOUSE_Z0 + 0.25], size: [0.22, 1.0, 0.22],
      color: 'trim', decor: true },
    { shape: cyl(10), piece: 'cabin', at: [HOUSE_HALF_W + 0.04, HOUSE_BASE + 0.35, HOUSE_Z0 + 0.45],
      size: [0.6, 0.08, 0.6], rot: [0, 0, Math.PI / 2], color: 0xd9481f, decor: true },
  ];
}

function sternGear(): PartDef[] {
  const sternLen = -STERN_Z - GAP;
  const sz = STERN_Z / 2 - GAP / 2;
  const gantryZ = STERN_Z + 0.25;
  const out: PartDef[] = [
    detail('stern', [0, DECK_Y + 0.005, sz], [2 * HALF_BEAM - 0.2, 0.01, sternLen - 0.15], 'deck'),
    detail('stern', [0, DECK_Y + 0.03, STERN_Z + 0.04], [2 * HALF_BEAM, 0.06, 0.08], 'cap'),
    detail('stern', [0, DECK_Y + 1.9, gantryZ], [2.52, 0.14, 0.14], 'gear'),
    {
      shape: { type: 'cylinder', segments: 10 },
      piece: 'stern',
      at: [0, DECK_Y + 0.45, STERN_Z + 1.0],
      size: [0.8, 1.7, 0.8],
      rot: [0, 0, Math.PI / 2],
      color: 'net',
      decor: true,
    },
    detail('stern', [0.65, DECK_Y + 0.16, HOUSE_Z0 - 0.35], [0.6, 0.32, 0.42], 'box'),
    detail('stern', [-0.65, DECK_Y + 0.16, HOUSE_Z0 - 0.35], [0.6, 0.32, 0.42], 'box'),
    detail('stern', [0.65, DECK_Y + 0.48, HOUSE_Z0 - 0.35], [0.6, 0.32, 0.42], 'box'),
  ];
  for (const s of [1, -1]) {
    out.push(
      detail('stern', [s * 1.2, DECK_Y + 0.95, gantryZ], [0.12, 1.9, 0.12], 'gear'),
      detail('stern', [s * (HALF_BEAM - 0.04), DECK_Y + 0.03, sz], [0.08, 0.06, sternLen], 'cap'),
      detail('stern', [s * (HALF_BEAM + 0.012), 1.25, sz], [0.02, 0.1, sternLen], 'trim'),
    );
  }
  return out;
}

const boat: StructureDef = {
  kind: 'boat',
  label: 'Fishing boat',
  material: 'wood',
  footprint: 4.4,
  palettes: {
    // Painted topsides, red/dark antifouling below the waterline, white wheelhouse.
    hull: [0x1f4e8c, 0x2e6b3f, 0xb3202a, 0xe8e8e4, 0x24303c, 0x2a7a8c],
    bottom: [0x8c2a20, 0x6b2a22, 0x2a2c30],
    house: [0xf2efe6, 0xe9e4d8],
    roof: [0xb3202a, 0x1f4e8c, 0x2a2c30, 0xd8a31a],
    deck: [0x9c7b56, 0x8b6b4a],
    cap: [0xe8e8e4, 0x9c7b56],
    gear: [0xd9661f, 0xd8a31a, 0xe8e8e4],
    net: [0x2f7d4f, 0x2a6fb0, 0xd9661f],
    box: [0xe07b1a, 0x2a6fb0],
    glass: [0x1d2733],
    trim: [0x2a2c30],
  },
  breakup: { impulseScale: 0.85, spin: 0.7, falloff: 2.5, floor: 0.3 },
  defaultYaw: (ctx) => ctx.rng() * Math.PI * 2,
  build: () => [
    {
      part: 'boat',
      stand: 'loose',
      // Over open water: hull bottom 1 m under the surface (half the 2 m collider height, where the
      // water forces hold a floating body); on a beach or in shallows it rests on the ground.
      ground: 'float',
      at: [0, -1, 0],
      mass: 3,
      breakSpeed: 9,
      ccd: true,
      parts: [
        {
          shape: { type: 'prism', id: 'boat-hull', outline: HULL },
          name: 'hull',
          piece: 'bottom',
          at: [0, BOTTOM_H / 2, 0.1],
          size: [2.3, 7.6, BOTTOM_H],
          rot: FLAT,
          color: 'bottom',
          weight: 0.65,
        },
        {
          shape: { type: 'prism', id: 'boat-bow', outline: BOW },
          name: 'bow',
          piece: 'bow',
          at: [0, (BOTTOM_H + BOW_TOP) / 2, (BOW_Z + GAP) / 2],
          size: [2 * HALF_BEAM, BOW_Z - GAP, BOW_TOP - BOTTOM_H],
          rot: FLAT,
          color: 'hull',
          weight: 0.265,
        },
        {
          shape: 'box',
          name: 'stern',
          piece: 'stern',
          at: [0, (BOTTOM_H + DECK_Y) / 2, STERN_Z / 2 - GAP / 2],
          size: [2 * HALF_BEAM, DECK_Y - BOTTOM_H, -STERN_Z - GAP],
          color: 'hull',
          weight: 0.045,
        },
        {
          shape: 'box',
          name: 'wheelhouse',
          piece: 'cabin',
          at: [0, (DECK_Y + HOUSE_BASE) / 2, (HOUSE_Z0 + HOUSE_Z1) / 2],
          size: [2 * HOUSE_HALF_W, HOUSE_BASE - DECK_Y, HOUSE_Z1 - HOUSE_Z0],
          color: 'house',
          weight: 0.04,
        },
        ...wheelhouse(),
        ...sternGear(),
        ...bowStrakes(),
      ],
    },
  ],
};

export default boat;
