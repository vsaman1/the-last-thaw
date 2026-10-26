import type { PartDef, StructureContext, StructureDef } from './kit';

/**
 * A two-bogie freight wagon (14.4 m over buffers, 2.9 m wide, ~4 m tall, 18 t): either a covered
 * boxcar (arched-roof body with sliding doors) or a tank wagon (horizontal tank with dished ends,
 * dome and walkway), picked per placement. One loose body: the body or tank and the two bogies
 * collide; wheels, side frames, sole bars, buffers, couplers, ribs, ladders and markings are decor.
 * The heaviest loose obstacle: a 30 t iceberg at 12 m/s loses ~5.6 m/s shoving it (a car costs
 * ~0.6). A hit above 24 m/s by a 30 t iceberg (loose-body impulse ~338 t·m/s; ≈ 17.7 m/s at
 * 100 t) throws the body off its bogies (three pieces). Several placements in a row make a
 * train. Local frame: +z = along the track; with no yaw given it stands across the valley,
 * broadside to the iceberg.
 */

const BODY_L = 13.0;
const BODY_HALF_W = 1.45;
const BODY_BOTTOM = 1.18;
const BODY_H = 2.95;
const TANK_D = 2.7;
const TANK_L = 11.4;
const TANK_BOTTOM = 1.25;
const BOGIE_Z = 4.6;
const BOGIE_H = 0.92;
const WHEEL_R = BOGIE_H / 2;
const END_Z = 6.78;

/** Boxcar cross-section (x, y) in metres: vertical sides and an arched roof. */
const BOXCAR: readonly (readonly [number, number])[] = [
  [-BODY_HALF_W, 0],
  [BODY_HALF_W, 0],
  [BODY_HALF_W, 2.55],
  [1.2, 2.82],
  [0.65, BODY_H],
  [-0.65, BODY_H],
  [-1.2, 2.82],
  [-BODY_HALF_W, 2.55],
];

const decor = (piece: string, at: PartDef['at'], size: PartDef['size'], color: string | number,
  rot?: PartDef['rot']): PartDef => ({ shape: 'box', piece, at, size, color, rot, decor: true });

function bogie(z: number, piece: string): PartDef[] {
  const out: PartDef[] = [
    {
      shape: 'box',
      name: 'bogie',
      piece,
      at: [0, BOGIE_H / 2, z],
      size: [1.72, BOGIE_H, 2.8],
      color: 'bogie',
      weight: 0.17,
    },
  ];
  for (const s of [1, -1]) {
    out.push(decor(piece, [s * 1.05, 0.6, z], [0.14, 0.34, 2.6], 'bogie'));
    for (const dz of [-0.9, 0.9]) {
      out.push(
        {
          shape: { type: 'cylinder', segments: 10 },
          piece,
          at: [s * 0.89, WHEEL_R, z + dz],
          size: [2 * WHEEL_R, 0.14, 2 * WHEEL_R],
          rot: [0, 0, Math.PI / 2],
          color: 'steel',
          decor: true,
        },
        decor(piece, [s * 1.05, WHEEL_R, z + dz], [0.2, 0.22, 0.26], 'trim'),
      );
    }
  }
  return out;
}

/** Sole bars, headstocks, buffers and couplers (they ride with the body when it breaks off). */
function underframe(halfW: number): PartDef[] {
  const out: PartDef[] = [];
  for (const s of [1, -1]) {
    out.push(decor('body', [s * halfW, BODY_BOTTOM - 0.14, 0], [0.16, 0.28, 13.4], 'trim'));
    out.push(decor('body', [0, 1.02, s * END_Z], [2.9, 0.32, 0.16], 'trim'));
    out.push(decor('body', [0, 1.0, s * (END_Z + 0.15)], [0.14, 0.14, 0.3], 'steel'));
    for (const x of [0.88, -0.88]) {
      out.push(
        {
          shape: { type: 'cylinder', segments: 8 },
          piece: 'body',
          at: [x, 1.05, s * (END_Z + 0.21)],
          size: [0.36, 0.42, 0.36],
          rot: [Math.PI / 2, 0, 0],
          color: 'trim',
          decor: true,
        },
        {
          shape: { type: 'cylinder', segments: 8 },
          piece: 'body',
          at: [x, 1.05, s * (END_Z + 0.44)],
          size: [0.46, 0.05, 0.46],
          rot: [Math.PI / 2, 0, 0],
          color: 'steel',
          decor: true,
        },
      );
    }
  }
  return out;
}

function boxcar(): PartDef[] {
  const out: PartDef[] = [
    {
      shape: { type: 'prism', id: 'railWagon-boxcar', outline: BOXCAR },
      name: 'body',
      piece: 'body',
      at: [0, BODY_BOTTOM + BODY_H / 2, 0],
      size: [2 * BODY_HALF_W, BODY_H, BODY_L],
      color: 'paint',
      weight: 0.66,
    },
    ...underframe(1.36),
  ];
  const side = BODY_HALF_W + 0.015;
  for (const s of [1, -1]) {
    out.push(
      decor('body', [s * side, BODY_BOTTOM + 1.3, 0], [0.03, 2.4, 3.1], 'door'),
      decor('body', [s * (side + 0.01), BODY_BOTTOM + 2.58, 0], [0.04, 0.07, 6.4], 'trim'),
      decor('body', [s * (side + 0.01), BODY_BOTTOM + 0.06, 0], [0.04, 0.07, 6.4], 'trim'),
      decor('body', [s * (side + 0.03), BODY_BOTTOM + 0.45, -4.25], [0.02, 0.38, 1.5], 0xe9e4d8),
      decor('body', [s * 1.0, BODY_BOTTOM + 1.25, s * (BODY_L / 2 + 0.02)], [0.42, 2.3, 0.04], 'trim'),
    );
    for (const z of [3.6, 4.9, 6.2, -3.6, -4.9, -6.2]) {
      out.push(decor('body', [s * (side + 0.005), BODY_BOTTOM + 1.27, z], [0.04, 2.45, 0.1], 'paint'));
    }
  }
  return out;
}

function tankWagon(): PartDef[] {
  const cy = TANK_BOTTOM + TANK_D / 2;
  const top = cy + 0.483 * TANK_D;
  const out: PartDef[] = [
    {
      shape: { type: 'cylinder', segments: 12 },
      name: 'tank',
      piece: 'body',
      at: [0, cy, 0],
      size: [TANK_D, TANK_L, TANK_D],
      rot: [Math.PI / 2, 0, 0],
      color: 'tank',
      weight: 0.66,
    },
    ...underframe(1.2),
    // Dished ends, saddles on the bogies, dome, walkway.
    {
      shape: { type: 'cone', segments: 12 },
      piece: 'body',
      at: [0, cy, TANK_L / 2 + 0.22],
      size: [TANK_D, 0.45, TANK_D],
      rot: [Math.PI / 2, 0, 0],
      color: 'tank',
      decor: true,
    },
    {
      shape: { type: 'cone', segments: 12 },
      piece: 'body',
      at: [0, cy, -TANK_L / 2 - 0.22],
      size: [TANK_D, 0.45, TANK_D],
      rot: [-Math.PI / 2, 0, 0],
      color: 'tank',
      decor: true,
    },
    decor('body', [0, (BOGIE_H + TANK_BOTTOM) / 2 + 0.05, BOGIE_Z], [2.0, 0.42, 0.7], 'trim'),
    decor('body', [0, (BOGIE_H + TANK_BOTTOM) / 2 + 0.05, -BOGIE_Z], [2.0, 0.42, 0.7], 'trim'),
    {
      shape: { type: 'cylinder', segments: 10 },
      piece: 'body',
      at: [0, top + 0.17, 0],
      size: [0.9, 0.36, 0.9],
      color: 'tank',
      decor: true,
    },
    decor('body', [0, top + 0.02, 0], [0.6, 0.04, 10.6], 'trim'),
  ];
  for (const s of [1, -1]) {
    out.push(
      decor('body', [s * 1.33, cy, 3.2], [0.02, 0.3, 0.42], 0xe07b1a),
      decor('body', [s * 1.4, cy - 0.2, 0.7], [0.04, 2.0, 0.42], 'trim'),
    );
  }
  return out;
}

const railWagon: StructureDef = {
  kind: 'railWagon',
  label: 'Freight wagon',
  material: 'metal',
  footprint: 7.3,
  palettes: {
    // Freight-car oxide red, brown, green, blue and grey; tank wagons black, white, silver, blue.
    paint: [0x8b3a2b, 0x6e2f22, 0x3d5a40, 0x2f4f6f, 0x8a8478],
    door: [0x7a3326, 0x5e281d, 0x34503a, 0x29445f, 0x7a756a],
    tank: [0x2b2d30, 0xd8d8d2, 0x8c9399, 0x3f6e8c],
    bogie: [0x2a2a2a, 0x33302c],
    steel: [0x6f757b],
    trim: [0x232427],
  },
  breakup: { impulseScale: 0.75, spin: 0.3, falloff: 5, floor: 0.35 },
  defaultYaw: () => Math.PI / 2,
  build: (ctx: StructureContext) => [
    {
      part: 'railWagon',
      stand: 'loose',
      mass: 18,
      breakSpeed: 24,
      parts: [
        ...(ctx.rng() < 0.35 ? tankWagon() : boxcar()),
        ...bogie(BOGIE_Z, 'bogieFront'),
        ...bogie(-BOGIE_Z, 'bogieRear'),
      ],
    },
  ],
};

export default railWagon;
