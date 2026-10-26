import { Euler, Quaternion, Vector3 } from 'three';
import type { PartDef, StructureDef, V3 } from './kit';

/**
 * A steel-lattice high-voltage pylon (~21.5 m): four legs splaying from a 5 m square footing to a
 * 1.7 m waist at 13 m, a slimmer top section, two cross arms (12.4 m and 9.2 m) with hanging
 * insulator strings, an earth-wire peak, X-bracing on every face, concrete footings and a danger
 * sign. Arms run across the valley at yaw 0, so the (implied) line runs down-course.
 *
 * One anchored body; its colliders are the four main legs and the two arms (6 boxes) — the lattice
 * bracing, top section, insulators and footings are decor (~70 thin boxes, one shared shape key).
 * breakSpeed 18 m/s for a 30 t iceberg (breakImpulse 675 t·m/s; 100 t: 5.4 m/s, 220 t: 2.5 m/s);
 * it then UPROOTS with the hit at its centre of percussion, so it pivots about its feet and topples
 * in the push direction. Mass 20 t (a heavy lattice; the iceberg keeps 1 - 1.25·20/(M + 20) of its
 * speed: 50 % at 30 t). Conductors between pylons are not modelled: placements are independent and
 * the kit has no way to hang a cable between two of them.
 */

const BASE_HW = 2.5;
const WAIST_Y = 13;
const WAIST_HW = 0.85;
const TOP_Y = 19.5;
const TOP_HW = 0.55;
const PEAK_Y = 21.5;
const LEG_W = 0.35;
const LEVELS = [0, 4.6, 9, WAIST_Y] as const;
const ARMS = [
  { y: 13.6, span: 12.4, h: 0.7, d: 0.9, weight: 0.18 },
  { y: 17.3, span: 9.2, h: 0.6, d: 0.8, weight: 0.14 },
] as const;
const LEG_WEIGHT = 0.17;
const INSULATOR_H = 1.8;

const _q = new Quaternion();
const _e = new Euler();
const _d = new Vector3();
const UP = new Vector3(0, 1, 0);

function beam(a: V3, b: V3, w: number, color: string | number, decor = true): PartDef {
  _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _d.length();
  _e.setFromQuaternion(_q.setFromUnitVectors(UP, _d.normalize()), 'XYZ');
  return {
    shape: 'box',
    at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    size: [w, len, w],
    rot: [_e.x, _e.y, _e.z],
    color,
    decor,
  };
}

/** Half-width of the lattice at height y (linear in each section). */
function halfWidth(y: number): number {
  if (y <= WAIST_Y) return BASE_HW + ((WAIST_HW - BASE_HW) * y) / WAIST_Y;
  return WAIST_HW + ((TOP_HW - WAIST_HW) * (y - WAIST_Y)) / (TOP_Y - WAIST_Y);
}

/** A point on one of the four faces: u across the face, at height y. */
type Face = (u: number, y: number) => V3;
const FACES: Face[] = [
  (u, y) => [u, y, halfWidth(y)],
  (u, y) => [u, y, -halfWidth(y)],
  (u, y) => [halfWidth(y), y, u],
  (u, y) => [-halfWidth(y), y, u],
];

/** Centre of percussion (height above the feet) of parts pivoting about the feet. */
function percussionHeight(parts: readonly { y: number; h: number; m: number }[]): number {
  let my = 0;
  let inertia = 0;
  for (const p of parts) {
    my += p.m * p.y;
    inertia += p.m * (p.y * p.y + (p.h * p.h) / 12);
  }
  return inertia / my;
}

const HIT_HEIGHT = percussionHeight([
  { y: WAIST_Y / 2, h: WAIST_Y, m: 4 * LEG_WEIGHT },
  ...ARMS.map((a) => ({ y: a.y, h: a.h, m: a.weight })),
]);

function lattice(): PartDef[] {
  const out: PartDef[] = [];
  const brace = (a: V3, b: V3, w = 0.12): void => {
    out.push(beam(a, b, w, 'steel'));
  };
  for (const face of FACES) {
    // Lower section: an X in every panel and a strut on every level above the ground.
    for (let k = 0; k + 1 < LEVELS.length; k++) {
      const y0 = LEVELS[k];
      const y1 = LEVELS[k + 1];
      const h0 = halfWidth(y0) - 0.1;
      const h1 = halfWidth(y1) - 0.1;
      brace(face(-h0, y0 + 0.15), face(h1, y1));
      brace(face(h0, y0 + 0.15), face(-h1, y1));
      brace(face(-h1, y1), face(h1, y1), 0.14);
    }
    // Top section: one X and the top strut.
    const hw = WAIST_HW - 0.06;
    const ht = TOP_HW - 0.06;
    brace(face(-hw, WAIST_Y), face(ht, TOP_Y));
    brace(face(hw, WAIST_Y), face(-ht, TOP_Y));
    brace(face(-ht, TOP_Y), face(ht, TOP_Y), 0.12);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      // Top-section legs, earth-wire peak and concrete footings.
      const waist: V3 = [sx * WAIST_HW, WAIST_Y, sz * WAIST_HW];
      out.push(beam(waist, [sx * TOP_HW, TOP_Y, sz * TOP_HW], 0.24, 'steel'));
      out.push(beam([sx * TOP_HW, TOP_Y, sz * TOP_HW], [0, PEAK_Y, 0], 0.16, 'steel'));
      out.push({
        shape: 'box',
        at: [sx * BASE_HW, 0.12, sz * BASE_HW],
        size: [1.0, 0.6, 1.0],
        color: 0xa8a49b,
        decor: true,
      });
    }
  }
  for (const arm of ARMS) {
    const tip = arm.span / 2;
    for (const s of [-1, 1]) {
      // Tie from the arm tip up to the mast, insulator string and conductor clamp.
      const mastY = arm.y + 3;
      const armTip: V3 = [s * (tip - 0.3), arm.y + arm.h / 2, 0];
      out.push(beam(armTip, [s * halfWidth(mastY), mastY, 0], 0.12, 'steel'));
      const ix = s * (tip - 0.45);
      const iy = arm.y - arm.h / 2 - INSULATOR_H / 2;
      out.push({
        shape: { type: 'cylinder', segments: 6 },
        at: [ix, iy, 0],
        size: [0.32, INSULATOR_H, 0.32],
        color: 'insulator',
        decor: true,
      });
      out.push({
        shape: 'box',
        at: [ix, iy - INSULATOR_H / 2 - 0.12, 0],
        size: [0.5, 0.24, 0.3],
        color: 0x3b3f43,
        decor: true,
      });
    }
  }
  // Danger sign on the front face.
  out.push({
    shape: 'box',
    at: [0, 3, halfWidth(3) + 0.05],
    size: [0.55, 0.55, 0.04],
    color: 0xf2c12e,
    decor: true,
  });
  return out;
}

const DECOR = lattice();

const pylon: StructureDef = {
  kind: 'pylon',
  label: 'Power pylon',
  material: 'metal',
  footprint: 4.3,
  palettes: {
    // Galvanised steel, or the grey-green paint of older lines.
    steel: [0x8e979c, 0x7f888d, 0x9ba3a7, 0x6f7c72],
    insulator: [0x6f8f7a, 0xe2ded4, 0x7b5a45],
  },
  build() {
    const legs: PartDef[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        legs.push({
          ...beam(
            [sx * BASE_HW, 0, sz * BASE_HW],
            [sx * WAIST_HW, WAIST_Y, sz * WAIST_HW],
            LEG_W,
            'steel',
            false,
          ),
          name: 'leg',
          weight: LEG_WEIGHT,
        });
      }
    }
    const arms = ARMS.map(
      (a): PartDef => ({
        shape: 'box',
        name: 'arm',
        at: [0, a.y, 0],
        size: [a.span, a.h, a.d],
        color: 'steel',
        weight: a.weight,
      }),
    );
    return [
      {
        part: 'pylon',
        stand: 'anchored',
        mass: 20,
        breakSpeed: 18,
        breakMode: 'uproot',
        // The square of the four corner legs (a circle round the faces left the legs 0.8 m out).
        proxy: 'trunk',
        trunkRadius: BASE_HW + LEG_W / 2,
        squareTrunk: true,
        shake: 'tilt',
        hitHeight: HIT_HEIGHT,
        parts: [...legs, ...arms, ...DECOR],
      },
    ];
  },
};

export default pylon;
