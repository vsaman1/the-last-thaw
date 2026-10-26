import type { PartDef, StructureDef } from './kit';

/**
 * A 12 m city bus (12.0 × 2.55 × 3.3 m, 10 t): one loose body built as two halves, the front one
 * with a raked windscreen, plus four wheels; the window band, doors, pillars, destination sign,
 * lights, livery and the roof air-conditioning unit are decor. A 30 t iceberg at 12 m/s hands it
 * ~112 t·m/s and loses ~3.8 m/s (a car costs ~0.6, a box truck ~3.2). A hit above 20 m/s by a
 * 30 t iceberg (loose-body impulse 187.5 t·m/s; ≈ 16.5 m/s for a 100 t iceberg) breaks it in two:
 * each half flies off with its own wheels and windows. Doors are on the right (-x) side.
 * Local frame: +z = front. With no yaw given it is parked along or across the valley at random.
 */

const BOTTOM = 0.32;
const BODY_H = 2.7;
const TOP = BOTTOM + BODY_H;
const HALF_W = 1.275;
const HALF_L = 6;
const WHEEL_R = 0.5;
const FRONT_AXLE = 3.3;
const REAR_AXLE = -2.6;
/** Front half side profile (z, y) in metres: vertical bumper face, raked windscreen, roof edge. */
const NOSE_Y = 0.85;
const SCREEN_TOP = 2.55;
const FRONT: readonly (readonly [number, number])[] = [
  [0, 0],
  [HALF_L, 0],
  [HALF_L, NOSE_Y],
  [HALF_L - 0.14, SCREEN_TOP],
  [HALF_L - 0.3, BODY_H],
  [0, BODY_H],
];
const SCREEN_TILT = Math.atan2(0.14, SCREEN_TOP - NOSE_Y);
/** Gap between the halves so the shattered pieces never start inside each other. */
const GAP = 0.01;
const SIDE = HALF_W + 0.008;

type Piece = 'front' | 'rear';

const decor = (piece: Piece, at: PartDef['at'], size: PartDef['size'], color: string | number,
  rot?: PartDef['rot']): PartDef => ({ shape: 'box', piece, at, size, color, rot, decor: true });

/** z on the raked windscreen face at body-profile height y (front half only). */
const screenZ = (y: number): number => HALF_L - (0.14 * (y - NOSE_Y)) / (SCREEN_TOP - NOSE_Y);

function wheel(x: number, z: number, piece: Piece): PartDef {
  return {
    shape: { type: 'cylinder', segments: 10 },
    name: 'wheel',
    piece,
    at: [x, WHEEL_R, z],
    size: [2 * WHEEL_R, 0.35, 2 * WHEEL_R],
    rot: [0, 0, Math.PI / 2],
    color: 'tyre',
    weight: 0.02,
  };
}

/** Glass from z0 to z1 on side s (window band, or a full-height door when `door`). */
function glass(piece: Piece, s: number, z0: number, z1: number, door = false): PartDef {
  const y0 = door ? BOTTOM + 0.22 : BOTTOM + 1.2;
  const y1 = BOTTOM + 2.45;
  // Doors stand a little prouder than the livery stripe they cross.
  const x = s * (door ? SIDE + 0.006 : SIDE);
  return decor(piece, [x, (y0 + y1) / 2, (z0 + z1) / 2], [0.02, y1 - y0, z1 - z0], 'glass');
}

function sideDecor(): PartDef[] {
  const out: PartDef[] = [];
  for (const s of [1, -1]) {
    const piece = (z: number): Piece => (z > 0 ? 'front' : 'rear');
    // Wheel arches, livery stripe per half, window pillars.
    for (const z of [FRONT_AXLE, REAR_AXLE]) {
      out.push(decor(piece(z), [s * (HALF_W + 0.004), BOTTOM + 0.38, z], [0.006, 0.76, 1.24], 'trim'));
    }
    out.push(
      decor('rear', [s * SIDE, BOTTOM + 0.95, -HALF_L / 2], [0.02, 0.18, HALF_L - 0.1], 'stripe'),
      decor('front', [s * SIDE, BOTTOM + 0.95, HALF_L / 2], [0.02, 0.18, HALF_L - 0.3], 'stripe'),
    );
    const pillars = s > 0 ? [-4.3, -2.9, -1.5, 1.4, 2.8, 4.2] : [-4.3, -2.9, 1.4, 2.8];
    for (const z of pillars) {
      out.push(decor(piece(z), [s * (SIDE + 0.012), BOTTOM + 1.825, z], [0.02, 1.25, 0.12], 'paint'));
    }
  }
  // Left side (+x): one window band per half. Right side (-x): front and middle doors.
  out.push(glass('rear', 1, -5.7, -0.1), glass('front', 1, 0.1, 5.35));
  out.push(
    glass('rear', -1, -5.7, -2.05),
    glass('rear', -1, -1.95, -0.65, true),
    glass('rear', -1, -0.55, -0.1),
    glass('front', -1, 0.1, 4.25),
    glass('front', -1, 4.35, 5.45, true),
  );
  return out;
}

function endDecor(): PartDef[] {
  const nose = HALF_L + 0.012;
  const tail = -HALF_L - 0.012;
  const screenY = 1.55;
  const signY = 2.38;
  const n = 0.012;
  return [
    decor(
      'front',
      [0, BOTTOM + screenY + n * Math.sin(SCREEN_TILT), screenZ(screenY) + n * Math.cos(SCREEN_TILT)],
      [2.3, 1.3, 0.02],
      'glass',
      [-SCREEN_TILT, 0, 0],
    ),
    decor(
      'front',
      [0, BOTTOM + signY + n * Math.sin(SCREEN_TILT), screenZ(signY) + n * Math.cos(SCREEN_TILT)],
      [1.9, 0.26, 0.02],
      0xffb02e,
      [-SCREEN_TILT, 0, 0],
    ),
    decor('front', [0.95, BOTTOM + 0.52, nose], [0.36, 0.17, 0.02], 0xfff1c4),
    decor('front', [-0.95, BOTTOM + 0.52, nose], [0.36, 0.17, 0.02], 0xfff1c4),
    decor('front', [0, BOTTOM + 0.12, HALF_L + 0.04], [2.55, 0.24, 0.08], 'trim'),
    decor('front', [1.45, BOTTOM + 2.15, HALF_L - 0.35], [0.06, 0.42, 0.16], 'trim'),
    decor('front', [-1.45, BOTTOM + 2.15, HALF_L - 0.35], [0.06, 0.42, 0.16], 'trim'),
    decor('front', [1.36, BOTTOM + 2.4, HALF_L - 0.35], [0.2, 0.04, 0.04], 'trim'),
    decor('front', [-1.36, BOTTOM + 2.4, HALF_L - 0.35], [0.2, 0.04, 0.04], 'trim'),
    decor('rear', [0, BOTTOM + 2.0, tail], [2.1, 0.75, 0.02], 'glass'),
    decor('rear', [0, BOTTOM + 0.72, tail], [1.7, 0.45, 0.02], 'trim'),
    decor('rear', [1.08, BOTTOM + 0.95, tail], [0.2, 0.55, 0.02], 0xb3261e),
    decor('rear', [-1.08, BOTTOM + 0.95, tail], [0.2, 0.55, 0.02], 0xb3261e),
    decor('rear', [0, BOTTOM + 0.12, -HALF_L - 0.04], [2.55, 0.24, 0.08], 'trim'),
    // Air-conditioning unit on the roof.
    decor('rear', [0, TOP + 0.13, -1.6], [1.6, 0.26, 2.6], 'roof'),
  ];
}

const bus: StructureDef = {
  kind: 'bus',
  label: 'Bus',
  material: 'metal',
  footprint: 6.3,
  palettes: {
    // City-bus liveries: yellow, red, white, blue, green, orange.
    paint: [0xd8a31a, 0xb3202a, 0xe8e8e4, 0x1f5fa0, 0x2f7d4f, 0xd9661f],
    stripe: [0x2a2c30, 0x1f4e8c, 0xb3202a, 0xe8e8e4],
    roof: [0xd5d7d9, 0xbfc3c7],
    glass: [0x1d2733],
    tyre: [0x1f1f1f],
    trim: [0x2a2c30],
  },
  breakup: { impulseScale: 0.8, spin: 0.45, falloff: 4, floor: 0.3 },
  defaultYaw: (ctx) => Math.floor(ctx.rng() * 4) * (Math.PI / 2) + (ctx.rng() - 0.5) * 0.4,
  build: () => [
    {
      part: 'bus',
      stand: 'loose',
      mass: 10,
      breakSpeed: 20,
      parts: [
        {
          shape: { type: 'prism', id: 'bus-front', outline: FRONT, axis: 'x' },
          name: 'body',
          piece: 'front',
          at: [0, BOTTOM + BODY_H / 2, (HALF_L + GAP) / 2],
          size: [2 * HALF_W, BODY_H, HALF_L - GAP],
          color: 'paint',
          weight: 0.45,
        },
        {
          shape: 'box',
          name: 'body',
          piece: 'rear',
          at: [0, BOTTOM + BODY_H / 2, -(HALF_L + GAP) / 2],
          size: [2 * HALF_W, BODY_H, HALF_L - GAP],
          color: 'paint',
          weight: 0.47,
        },
        wheel(1.115, FRONT_AXLE, 'front'),
        wheel(-1.115, FRONT_AXLE, 'front'),
        wheel(1.115, REAR_AXLE, 'rear'),
        wheel(-1.115, REAR_AXLE, 'rear'),
        ...sideDecor(),
        ...endDecor(),
      ],
    },
  ],
};

export default bus;
