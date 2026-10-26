import type { PartDef, StructureDef } from './kit';

/**
 * A 7.5 t-class box truck (~7.6 × 2.45 × 3.5 m, 8 t with some load): one loose body. The cab-over
 * cab, the cargo box, the chassis frame and four wheels collide (the rear ones are wide: twin
 * tyres); glass, lights, grille, mirrors, wind deflector, livery and underrun bars are decor.
 * Six times a car's mass, so it costs real speed: a 30 t iceberg at 12 m/s hands it ~95 t·m/s and
 * loses ~3.2 m/s (a car costs ~0.6). A hit above 18 m/s by a 30 t iceberg (loose-body impulse
 * ~142 t·m/s; ≈ 15 m/s for a 100 t iceberg) tears it apart: cab, cargo box and chassis with its
 * wheels fly as three pieces. Pieces never overlap, so a shattered truck is not kicked apart by
 * depenetration. Local frame: +z = front. With no yaw given it is parked along or across the
 * valley at random.
 */

const WHEEL_R = 0.47;
const CHASSIS_TOP = 2 * WHEEL_R;
const CAB_BOTTOM = CHASSIS_TOP + 0.01;
const CAB_H = 2.0;
const CAB_L = 1.95;
const CAB_Z = 3.8 - CAB_L / 2;
const CAB_HALF_W = 1.175;
const BOX_BOTTOM = 1.05;
const BOX_H = 2.45;
const BOX_L = 5.5;
const BOX_Z = 1.75 - BOX_L / 2;
const BOX_HALF_W = 1.225;
const FRONT_AXLE = 2.75;
const REAR_AXLE = -1.75;

/** Cab side profile (z, y) in metres: flat cab-over front with a slightly raked windscreen. */
const CAB: readonly (readonly [number, number])[] = [
  [-CAB_L / 2, 0],
  [CAB_L / 2, 0],
  [CAB_L / 2, 0.95],
  [CAB_L / 2 - 0.2, CAB_H],
  [-CAB_L / 2, CAB_H],
];
const SCREEN_RUN = 0.2;
const SCREEN_RISE = CAB_H - 0.95;
const SCREEN_TILT = Math.atan2(SCREEN_RUN, SCREEN_RISE);

function wheel(x: number, z: number, width: number): PartDef {
  return {
    shape: { type: 'cylinder', segments: 10 },
    name: 'wheel',
    piece: 'chassis',
    at: [x, WHEEL_R, z],
    size: [2 * WHEEL_R, width, 2 * WHEEL_R],
    rot: [0, 0, Math.PI / 2],
    color: 'tyre',
    weight: 0.03,
  };
}

function hub(x: number, z: number): PartDef {
  return {
    shape: { type: 'cylinder', segments: 10 },
    piece: 'chassis',
    at: [x, WHEEL_R, z],
    size: [0.42, 0.02, 0.42],
    rot: [0, 0, Math.PI / 2],
    color: 'hub',
    decor: true,
  };
}

const decor = (piece: string, at: PartDef['at'], size: PartDef['size'], color: string | number,
  rot?: PartDef['rot']): PartDef => ({ shape: 'box', piece, at, size, color, rot, decor: true });

function cabDecor(): PartDef[] {
  const front = 3.8;
  const out: PartDef[] = [
    // Windscreen on the raked face, a hair proud of it along its normal.
    decor(
      'cab',
      [0, CAB_BOTTOM + (0.95 + CAB_H) / 2 + 0.012 * Math.sin(SCREEN_TILT),
        front - SCREEN_RUN / 2 + 0.012 * Math.cos(SCREEN_TILT)],
      [2.05, SCREEN_RISE * 0.92, 0.02],
      'glass',
      [-SCREEN_TILT, 0, 0],
    ),
    decor('cab', [0, CAB_BOTTOM + 0.55, front + 0.012], [1.3, 0.42, 0.02], 'trim'),
    decor('cab', [0, CAB_BOTTOM + 0.12, front + 0.06], [2.35, 0.26, 0.12], 'trim'),
    decor('cab', [0.9, CAB_BOTTOM + 0.42, front + 0.012], [0.32, 0.16, 0.02], 0xfff1c4),
    decor('cab', [-0.9, CAB_BOTTOM + 0.42, front + 0.012], [0.32, 0.16, 0.02], 0xfff1c4),
    // Air deflector on the roof, sloping up to the top of the cargo box.
    decor('cab', [0, CAB_BOTTOM + CAB_H + 0.27, CAB_Z - 0.05], [2.2, 0.05, 1.35], 'cab', [0.37, 0, 0]),
  ];
  for (const s of [1, -1]) {
    out.push(
      decor('cab', [s * (CAB_HALF_W + 0.01), CAB_BOTTOM + 1.45, CAB_Z + 0.12], [0.02, 0.68, 1.05], 'glass'),
      decor('cab', [s * (CAB_HALF_W + 0.01), CAB_BOTTOM + 0.85, CAB_Z - 0.62], [0.02, 1.55, 0.03], 'trim'),
      decor('cab', [s * (CAB_HALF_W + 0.17), CAB_BOTTOM + 1.45, front - 0.3], [0.06, 0.45, 0.18], 'trim'),
      decor('cab', [s * (CAB_HALF_W + 0.08), CAB_BOTTOM + 1.6, front - 0.3], [0.18, 0.04, 0.04], 'trim'),
    );
  }
  return out;
}

function boxDecor(): PartDef[] {
  const rear = BOX_Z - BOX_L / 2 - 0.012;
  const out: PartDef[] = [
    decor('box', [0, BOX_BOTTOM + BOX_H / 2, rear], [0.04, BOX_H - 0.1, 0.02], 'trim'),
    decor('box', [0.62, BOX_BOTTOM + BOX_H / 2, rear], [0.05, BOX_H - 0.25, 0.03], 'hub'),
    decor('box', [-0.62, BOX_BOTTOM + BOX_H / 2, rear], [0.05, BOX_H - 0.25, 0.03], 'hub'),
  ];
  for (const s of [1, -1]) {
    out.push(
      decor('box', [s * (BOX_HALF_W + 0.01), BOX_BOTTOM + 0.85, BOX_Z], [0.02, 0.36, BOX_L - 0.3], 'stripe'),
      decor('box', [s * (BOX_HALF_W + 0.01), BOX_BOTTOM + 1.25, BOX_Z], [0.02, 0.08, BOX_L - 0.3], 'stripe'),
      decor('box', [s * 0.9, BOX_BOTTOM + BOX_H - 0.08, BOX_Z + BOX_L / 2 + 0.012], [0.14, 0.08, 0.02],
        0xffa726),
    );
  }
  return out;
}

function chassisDecor(): PartDef[] {
  const out: PartDef[] = [
    // Rear underrun bar and tail lights on it.
    decor('chassis', [0, 0.62, BOX_Z - BOX_L / 2 + 0.2], [2.2, 0.14, 0.1], 'trim'),
    decor('chassis', [0.92, 0.78, BOX_Z - BOX_L / 2 + 0.2], [0.26, 0.13, 0.12], 0xb3261e),
    decor('chassis', [-0.92, 0.78, BOX_Z - BOX_L / 2 + 0.2], [0.26, 0.13, 0.12], 0xb3261e),
    hub(1.19, FRONT_AXLE),
    hub(-1.19, FRONT_AXLE),
    hub(1.25, REAR_AXLE),
    hub(-1.25, REAR_AXLE),
  ];
  for (const s of [1, -1]) {
    // Side guard between the axles and a fuel tank behind the cab.
    out.push(
      decor('chassis', [s * 1.12, 0.7, (FRONT_AXLE + REAR_AXLE) / 2 - 0.25], [0.04, 0.22, 2.6], 'trim'),
      decor('chassis', [s * 0.78, 0.66, 1.0], [0.48, 0.48, 0.9], 'hub'),
    );
  }
  return out;
}

const truck: StructureDef = {
  kind: 'truck',
  label: 'Box truck',
  material: 'metal',
  footprint: 3.9,
  palettes: {
    // Fleet cab colours and the usual white/silver box; livery stripe in a contrasting colour.
    cab: [0xe8e8e4, 0xb3202a, 0x1f4e8c, 0xd9661f, 0x2e6b3f, 0xa9adb3],
    box: [0xf0f0ec, 0xd8dadc, 0xbfc3c7],
    stripe: [0xc0392b, 0x2a5aa8, 0x2f8f4f, 0xe07b1a, 0xd9a520],
    glass: [0x1d2733],
    tyre: [0x1f1f1f],
    trim: [0x2a2c30],
    chassis: [0x26282b],
    hub: [0x8e959c],
  },
  breakup: { impulseScale: 0.8, spin: 0.5, falloff: 3, floor: 0.3 },
  defaultYaw: (ctx) => Math.floor(ctx.rng() * 4) * (Math.PI / 2) + (ctx.rng() - 0.5) * 0.4,
  build: () => [
    {
      part: 'truck',
      stand: 'loose',
      mass: 8,
      breakSpeed: 18,
      parts: [
        {
          shape: { type: 'prism', id: 'truck-cab', outline: CAB, axis: 'x' },
          name: 'cab',
          piece: 'cab',
          at: [0, CAB_BOTTOM + CAB_H / 2, CAB_Z],
          size: [2 * CAB_HALF_W, CAB_H, CAB_L],
          color: 'cab',
          weight: 0.24,
        },
        {
          shape: 'box',
          name: 'cargo',
          piece: 'box',
          at: [0, BOX_BOTTOM + BOX_H / 2, BOX_Z],
          size: [2 * BOX_HALF_W, BOX_H, BOX_L],
          color: 'box',
          weight: 0.36,
        },
        {
          shape: 'box',
          name: 'chassis',
          piece: 'chassis',
          at: [0, CHASSIS_TOP - 0.16, 0.0],
          size: [0.95, 0.32, 7.1],
          color: 'chassis',
          weight: 0.28,
        },
        wheel(1.02, FRONT_AXLE, 0.32),
        wheel(-1.02, FRONT_AXLE, 0.32),
        wheel(0.94, REAR_AXLE, 0.6),
        wheel(-0.94, REAR_AXLE, 0.6),
        ...cabDecor(),
        ...boxDecor(),
        ...chassisDecor(),
      ],
    },
  ],
};

export default truck;
