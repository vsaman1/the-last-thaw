import { deco, faceCentreline, groundWall } from './barn';
import type { PartDef, StructureContext, StructureDef, V3 } from './kit';

/**
 * An industrial hall (24 × 18 m, eaves 7 m) under a three-bay sawtooth (north-light) roof, peaks
 * 10.2 m: brick or clad walls, three roller doors under their roller boxes and a sign on the front,
 * window bands on the sides and back, glazed steep roof faces, gable triangles and turbine vents as
 * decor. One anchored body of 15 pieces: three front, two back and four side wall panels and six
 * roof halves (each sawtooth bay split front/back); it breaks into those panels.
 * Mass 55 t. A 30 t iceberg only breaks it above 30 m/s (breakImpulse 1125), so the tutorial
 * iceberg bounces off; big icebergs flatten it: 100 t at 9 m/s, 150 t at 6 m/s, 220 t at 4.1 m/s.
 * Local frame: sawtooth ridges along z, doors on +z. With no yaw given the doors face the centreline
 * (or up-course toward the player on the centreline). Walls follow the ground (barn.ts groundWall).
 */

const W = 24;
const D = 18;
const H = 7;
const T = 0.35;
const BAY = 8;
const BAYS = [-BAY, 0, BAY] as const;
const PEAK = 3.2;
/** One sawtooth bay in section (x, y): shallow slope up to the peak, steep glazed face back down. */
const TOOTH = [
  [-BAY / 2, 0],
  [BAY / 2, 0],
  [BAY / 2 - 0.8, PEAK],
] as const;
const TOOTH_SHAPE = { type: 'prism', id: 'factory-bay', outline: TOOTH } as const;
/**
 * Mass weight of a roof half: the solid prism's volume would hand the roof ~80 % of the mass, so it
 * is weighted as its skin instead (both faces × 0.25 m × length, in the walls' volume units).
 */
const ROOF_WEIGHT = (Math.hypot(BAY - 0.8, PEAK) + Math.hypot(0.8, PEAK)) * 0.25 * (D / 2);
/** Steep face: midpoint, outward normal and tilt from vertical. */
const GLASS_TILT = Math.atan2(0.8, PEAK);
const GLASS_N = [Math.cos(GLASS_TILT), Math.sin(GLASS_TILT)] as const;
const FRONT_Z = D / 2 - T / 2;
const SIDE_X = W / 2 - T / 2;
const SIDE_Z = D / 2 - T;

function rollerDoor(ctx: StructureContext, x: number, piece: string): PartDef[] {
  const z = D / 2;
  const y0 = ctx.groundAt(x, z) - 0.03;
  const h = Math.max(3, Math.min(4.8, H - 1.6 - y0));
  const out: PartDef[] = [deco([x, y0 + h / 2, z + 0.025], [4.8, h, 0.05], 'door', { piece })];
  for (let i = 1; i <= 3; i++) {
    out.push(deco([x, y0 + (h * i) / 4, z + 0.055], [4.8, 0.06, 0.02], 0x2b2e31, { piece }));
  }
  out.push(deco([x, y0 + h + 0.25, z + 0.18], [5.3, 0.45, 0.36], 'trim', { piece }));
  return out;
}

function build(ctx: StructureContext): PartDef[] {
  const parts: PartDef[] = [];
  const wall = { name: 'wall' };
  // Front: three panels with roller doors (one per bay) and the company sign over the middle one.
  for (const [i, x] of BAYS.entries()) {
    const piece = `front${i}`;
    const [x0, x1] = [x - BAY / 2, x + BAY / 2];
    parts.push(groundWall(ctx, [x0, FRONT_Z], [x1, FRONT_Z], T, H, 'wall', { ...wall, piece }));
    parts.push(...rollerDoor(ctx, x, piece));
  }
  parts.push(deco([0, H - 0.55, D / 2 + 0.03], [6.4, 0.8, 0.06], 'sign', { piece: 'front1' }));
  // Back: two panels with a high window band.
  for (const [i, sx] of [-1, 1].entries()) {
    const piece = `back${i}`;
    parts.push(groundWall(ctx, [sx * (W / 2), -FRONT_Z], [0, -FRONT_Z], T, H, 'wall', { ...wall, piece }));
    parts.push(deco([sx * (W / 4), H - 1.7, -D / 2 - 0.02], [10, 1.1, 0.04], 'glass', { piece }));
  }
  // Sides: two panels each between front and back, with a window band.
  for (const sx of [-1, 1]) {
    for (const [z0, z1, id] of [[-SIDE_Z, 0, 'A'], [0, SIDE_Z, 'B']] as const) {
      const piece = `side${sx > 0 ? 'R' : 'L'}${id}`;
      parts.push(groundWall(ctx, [sx * SIDE_X, z0], [sx * SIDE_X, z1], T, H, 'wall', { ...wall, piece }));
      parts.push(deco([sx * (W / 2 + 0.02), H - 1.7, (z0 + z1) / 2], [0.04, 1.1, 7.2], 'glass', { piece }));
    }
  }
  // Sawtooth roof: per bay a front and a back half (solid prisms resting on the walls) with the
  // glazed steep face, a gable triangle on the end wall and a turbine vent on the shallow slope.
  for (const [i, x] of BAYS.entries()) {
    for (const sz of [-1, 1]) {
      const piece = `roof${i}${sz > 0 ? 'F' : 'B'}`;
      const zc = (sz * D) / 4;
      parts.push({
        shape: TOOTH_SHAPE,
        piece,
        name: 'roof',
        at: [x, H + PEAK / 2, zc],
        size: [BAY, PEAK, D / 2 - 0.005],
        color: 'roof',
        weight: ROOF_WEIGHT,
      });
      const gx = x + BAY / 2 - 0.4 + GLASS_N[0] * 0.03;
      const gy = H + PEAK / 2 + GLASS_N[1] * 0.03;
      const glass: V3 = [0.04, PEAK - 0.15, D / 2 - 0.5];
      parts.push(deco([gx, gy, zc], glass, 'glass', { piece }, [0, 0, GLASS_TILT]));
      parts.push({
        shape: TOOTH_SHAPE,
        piece,
        at: [x, H + PEAK / 2, sz * (D / 2 + 0.02)],
        size: [BAY, PEAK, 0.04],
        color: 'wall',
        decor: true,
      });
      const vx = x - 1.2;
      const vy = H + (PEAK * (vx - x + BAY / 2)) / (BAY - 0.8);
      parts.push({
        shape: { type: 'cylinder', segments: 8 },
        piece,
        at: [vx, vy + 0.3, zc],
        size: [0.7, 0.7, 0.7],
        color: 'vent',
        decor: true,
      });
      parts.push({
        shape: { type: 'cylinder', segments: 8, taper: 0.4 },
        piece,
        at: [vx, vy + 0.82, zc],
        size: [0.95, 0.35, 0.95],
        color: 'vent',
        decor: true,
        // One vent per hall breathes a thin wisp (render-only).
        ...(i === 0 && sz > 0 ? { plume: 'thin' as const } : {}),
      });
    }
  }
  return parts;
}

const factoryHall: StructureDef = {
  kind: 'factoryHall',
  label: 'Factory hall',
  material: 'masonry',
  building: true,
  footprint: 15.5,
  palettes: {
    // Brick, grey and blue-grey steel cladding, pale concrete.
    wall: [0x9a4b36, 0xa9aeb2, 0x8fa1ab, 0xd2c9b4],
    // Dark grey or galvanised sheet roofing, rusty corrugated iron.
    roof: [0x5a5f63, 0x8e959a, 0x6e5a4e],
    // Roller doors: safety yellow, grey, blue, oxide red.
    door: [0xd9a320, 0x6f7478, 0x2f5c87, 0xa8402c],
    glass: [0x334a5c, 0x3b5568],
    trim: [0x3a3f44, 0x50565b],
    vent: [0xb4b9bd, 0x9aa0a5],
    sign: [0xf2f2ee, 0x1f3f6e, 0xb8322a],
  },
  // Big heavy panels: most of the hit goes into tearing the hall down, so it collapses roughly in
  // place under a slow bulldozing iceberg instead of skating its panels across the valley (which
  // also keeps ~1000 m² of debris from sliding around awake for seconds).
  breakup: { impulseScale: 0.45, spin: 0.15, falloff: 6, floor: 0.2 },
  defaultYaw: faceCentreline,
  build: (ctx) => [
    {
      part: 'factoryHall',
      stand: 'anchored',
      ground: 'fixed',
      mass: 55,
      breakSpeed: 30,
      breakMode: 'shatter',
      parts: build(ctx),
    },
  ],
};

export default factoryHall;
