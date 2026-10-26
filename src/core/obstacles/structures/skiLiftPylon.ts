import { deco } from './barn';
import type { PartDef, StructureDef } from './kit';

/**
 * A chairlift support tower: a tapered steel tube (0.7 → 0.55 m, 11.5 m) on a concrete footing,
 * a 7 m cross-arm on top with a sheave train and a length of haul rope at each end, a maintenance
 * ladder and arm handrail, and a three-seat chair hanging from one rope by the tower. Colliders:
 * footing, tube and cross-arm; sheaves, rope, ladder and chair are decor that ride along.
 * Mass 4.5 t; a 30 t iceberg knocks it over above 10 m/s (breakImpulse 375), a 100 t one at
 * 3 m/s. It is UPROOTED as one body (breakMode 'uproot'): the hit lands a little above its centre of
 * mass (≈ 7 m), so it topples in the push direction like a felled tree, chair and all.
 * Collides as a 'trunk' proxy around the tube only, so the iceberg passes under the arm.
 * Local frame: cross-arm across the valley (x), rope along the course (z), as a lift line running
 * up the valley; no yaw is randomised.
 */

const FOOT = 0.5;
const POLE_H = 11.5;
const POLE_D = 0.7;
const TAPER = 0.55 / 0.7;
const ARM_Y = FOOT + POLE_H;
const ARM_L = 7;
const ARM_T = 0.45;
const ROPE_X = 3.2;
/** Haul rope height (on top of the sheaves) and the length of rope drawn either side. */
const ROPE_Y = ARM_Y + ARM_T + 0.55;
const ROPE_L = 9;

function sheaveTrain(x: number): PartDef[] {
  const parts: PartDef[] = [deco([x, ARM_Y + ARM_T + 0.08, 0], [0.22, 0.16, 2.6], 'steel')];
  for (const z of [-0.9, -0.3, 0.3, 0.9]) {
    parts.push({
      shape: { type: 'cylinder', segments: 10 },
      at: [x, ARM_Y + ARM_T + 0.32, z],
      size: [0.5, 0.14, 0.5],
      rot: [0, 0, Math.PI / 2],
      color: 'sheave',
      decor: true,
    });
  }
  parts.push(deco([x, ROPE_Y, 0], [0.06, 0.06, ROPE_L], 'rope'));
  return parts;
}

/** A three-seat chair hanging from the rope at (x, z), facing up-course (-z). */
function chair(x: number, z: number): PartDef[] {
  const seatY = ROPE_Y - 2.55;
  return [
    deco([x, ROPE_Y + 0.02, z], [0.2, 0.22, 0.4], 'steel'),
    deco([x, ROPE_Y - 1.1, z], [0.08, 2.2, 0.08], 'chair'),
    deco([x, ROPE_Y - 2.15, z + 0.15], [0.08, 0.08, 0.4], 'chair'),
    deco([x, seatY, z - 0.05], [1.8, 0.1, 0.55], 'seat'),
    deco([x, seatY + 0.36, z + 0.27], [1.8, 0.62, 0.08], 'seat', {}, [-0.22, 0, 0]),
    deco([x, seatY + 0.55, z - 0.5], [1.8, 0.05, 0.05], 'chair'),
    deco([x - 0.92, seatY + 0.25, z - 0.1], [0.05, 0.05, 0.65], 'chair'),
    deco([x + 0.92, seatY + 0.25, z - 0.1], [0.05, 0.05, 0.65], 'chair'),
    deco([x, seatY - 0.45, z - 0.55], [1.5, 0.05, 0.25], 'chair'),
  ];
}

const parts: PartDef[] = [
  {
    shape: 'box',
    name: 'footing',
    at: [0, FOOT / 2, 0],
    size: [1.6, FOOT, 1.6],
    color: 'concrete',
    weight: 0.25,
  },
  {
    shape: { type: 'cylinder', segments: 10, taper: TAPER },
    name: 'pole',
    at: [0, FOOT + POLE_H / 2, 0],
    size: [POLE_D, POLE_H, POLE_D],
    color: 'steel',
    weight: 0.55,
  },
  {
    shape: 'box',
    name: 'arm',
    at: [0, ARM_Y + ARM_T / 2, 0],
    size: [ARM_L, ARM_T, ARM_T],
    color: 'steel',
    weight: 0.2,
  },
  // Handrail along the arm and a ladder up the back of the tube.
  deco([0, ARM_Y + ARM_T + 1.0, -0.2], [ARM_L - 0.4, 0.05, 0.05], 'steel'),
  deco([-2.4, ARM_Y + ARM_T + 0.5, -0.2], [0.05, 1.0, 0.05], 'steel'),
  deco([2.4, ARM_Y + ARM_T + 0.5, -0.2], [0.05, 1.0, 0.05], 'steel'),
  deco([-0.16, FOOT + 1 + (POLE_H - 1.2) / 2, -0.36], [0.05, POLE_H - 1.2, 0.05], 'steel'),
  deco([0.16, FOOT + 1 + (POLE_H - 1.2) / 2, -0.36], [0.05, POLE_H - 1.2, 0.05], 'steel'),
  ...sheaveTrain(-ROPE_X),
  ...sheaveTrain(ROPE_X),
  ...chair(ROPE_X, 2.2),
];

const skiLiftPylon: StructureDef = {
  kind: 'skiLiftPylon',
  label: 'Ski lift pylon',
  material: 'metal',
  footprint: 4,
  palettes: {
    // Tower paint: grey, green, blue-grey, yellow.
    steel: [0x8a9095, 0x3f6b4f, 0x5a6e80, 0xc9a227],
    concrete: [0xb9b4aa],
    sheave: [0x2a2c30],
    rope: [0x3a3a3a],
    // Chair frame and seat cushions.
    chair: [0x2f5d9a, 0xc0392b, 0xe1a722, 0x3a3f44],
    seat: [0x2b2e33, 0x1f3550],
  },
  build: () => [
    {
      part: 'pylon',
      stand: 'anchored',
      mass: 4.5,
      breakSpeed: 10,
      breakMode: 'uproot',
      proxy: 'trunk',
      trunkRadius: POLE_D / 2,
      parts,
    },
  ],
};

export default skiLiftPylon;
