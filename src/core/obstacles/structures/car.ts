import type { PartDef, StructureDef } from './kit';

/**
 * A parked hatchback (~4.2 × 1.8 × 1.45 m, 1.3 t): one loose rigid body (body shell, cabin and four
 * wheels collide; glass, lights, grille and bumpers are decor). A 30 t iceberg at 12 m/s hands it
 * ~19 t·m/s, enough to launch it ~14 m/s with lift high on its flank, so it tumbles and flies.
 * Local frame: +z = front. With no yaw given it is parked along or across the valley at random.
 */

const WHEEL_R = 0.33;
const WHEEL_W = 0.24;
const BODY_BOTTOM = 0.28;
const BODY_H = 0.62;
const BODY_TOP = BODY_BOTTOM + BODY_H;
/** Matches the profile below, so its coordinates are metres. */
const CABIN_H = 0.6;
const CABIN_Z = -0.15;
/** Side profile (z, y) of the cabin: sloped windscreen in front, steeper hatch at the back. */
const CABIN: readonly (readonly [number, number])[] = [
  [-1.05, 0],
  [1.0, 0],
  [0.45, 0.6],
  [-0.8, 0.6],
];
const WINDOW: readonly (readonly [number, number])[] = [
  [-0.85, 0.06],
  [0.85, 0.06],
  [0.38, 0.5],
  [-0.65, 0.5],
];
// Windscreen and hatch glass lie on the cabin's sloped faces: tilt of each face normal from +y.
const SCREEN_TILT = Math.atan2(0.6, 0.55);
const HATCH_TILT = Math.atan2(0.6, 0.25);

const wheel = (x: number, z: number): PartDef => ({
  shape: { type: 'cylinder', segments: 10 },
  name: 'wheel',
  at: [x, WHEEL_R, z],
  size: [2 * WHEEL_R, WHEEL_W, 2 * WHEEL_R],
  rot: [0, 0, Math.PI / 2],
  color: 'tyre',
  weight: 0.04,
});

const lamp = (x: number, z: number, color: number): PartDef => ({
  shape: 'box',
  at: [x, 0.72, z],
  size: [0.3, 0.12, 0.02],
  color,
  decor: true,
});

const car: StructureDef = {
  kind: 'car',
  label: 'Car',
  material: 'metal',
  footprint: 2.4,
  palettes: {
    // Common real paint colours: red, blue, white, silver, graphite, green, mustard.
    paint: [0xb3202a, 0x1f4e8c, 0xe8e8e4, 0xa9adb3, 0x34373c, 0x2e6b3f, 0xd8a31a],
    glass: [0x1d2733],
    tyre: [0x1f1f1f],
    trim: [0x2a2c30],
  },
  defaultYaw: (ctx) => Math.floor(ctx.rng() * 4) * (Math.PI / 2) + (ctx.rng() - 0.5) * 0.6,
  build: () => [
    {
      part: 'car',
      stand: 'loose',
      mass: 1.3,
      ccd: true,
      parts: [
        {
          shape: 'box',
          name: 'body',
          at: [0, BODY_BOTTOM + BODY_H / 2, 0],
          size: [1.78, BODY_H, 4.2],
          color: 'paint',
          weight: 0.62,
        },
        {
          shape: { type: 'prism', id: 'car-cabin', outline: CABIN, axis: 'x' },
          name: 'body',
          at: [0, BODY_TOP + CABIN_H / 2, CABIN_Z],
          size: [1.56, CABIN_H, 2.05],
          color: 'paint',
          weight: 0.22,
        },
        wheel(0.8, 1.33),
        wheel(-0.8, 1.33),
        wheel(0.8, -1.33),
        wheel(-0.8, -1.33),
        // Glass: side windows on both flanks, windscreen and hatch on the sloped faces.
        ...[0.79, -0.79].map(
          (x): PartDef => ({
            shape: { type: 'prism', id: 'car-window', outline: WINDOW, axis: 'x' },
            at: [x, BODY_TOP + 0.06 + 0.22, CABIN_Z + 0.025],
            size: [0.02, 0.44, 1.7],
            color: 'glass',
            decor: true,
          }),
        ),
        {
          shape: 'box',
          at: [0, BODY_TOP + 0.3 + 0.01, CABIN_Z + 0.76],
          size: [1.36, 0.02, 0.68],
          rot: [SCREEN_TILT, 0, 0],
          color: 'glass',
          decor: true,
        },
        {
          shape: 'box',
          at: [0, BODY_TOP + 0.3 + 0.005, CABIN_Z - 0.91],
          size: [1.3, 0.02, 0.5],
          rot: [-HATCH_TILT, 0, 0],
          color: 'glass',
          decor: true,
        },
        lamp(0.6, 2.11, 0xfff1c4),
        lamp(-0.6, 2.11, 0xfff1c4),
        lamp(0.6, -2.11, 0xb3261e),
        lamp(-0.6, -2.11, 0xb3261e),
        { shape: 'box', at: [0, 0.6, 2.11], size: [0.7, 0.14, 0.02], color: 'trim', decor: true },
        { shape: 'box', at: [0, 0.36, 2.13], size: [1.8, 0.16, 0.1], color: 'trim', decor: true },
        { shape: 'box', at: [0, 0.36, -2.13], size: [1.8, 0.16, 0.1], color: 'trim', decor: true },
      ],
    },
  ],
};

export default car;
