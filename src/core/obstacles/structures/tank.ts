import { deco } from './barn';
import type { PartDef, StructureContext, StructureDef, V3 } from './kit';

/**
 * An industrial storage tank (11 m diameter, 8.5 m shell, shallow cone roof to 9.5 m): a welded
 * steel shell of twelve plates under a cone roof, a coloured band, a caged access ladder, a level
 * gauge board and an outlet pipe with a valve as decor. One anchored body of 13 colliders (twelve
 * 30° shell plates making a 12-sided shell, and the roof) that ruptures into 7 pieces: six bent
 * 60° shell sections (plates torn off in pairs) and the roof.
 * Mass 28 t (empty steel tank); a 30 t iceberg breaks it above 20 m/s (breakImpulse 750), a 100 t
 * one at 6 m/s, a 220 t one at 2.7 m/s. Metal: the plates sink slowly once in water.
 * Collides as a round 'trunk' proxy of the shell's radius. With no yaw given it is turned at
 * random (the ladder can face anywhere).
 * Cost: the plates are flat-faced trapezoids (8-vertex hulls) and the roof a 12-sided frustum, so
 * the debris settles. Curved plates (arc outlines: a ridged or rounded underside) and a lathe dome
 * (91 hull vertices) rocked and rolled for seconds; tearing the plates off in pairs halves the
 * debris bodies. A smashed tank costs ~1-4 ms/step for its first second, ~1 ms/step after.
 * Ground: each shell plate starts at the lowest ground under it (top level at 8.5 m above the
 * origin's ground), so on a slope the downhill plates are taller and none is buried more than
 * the ground's rise across one plate.
 */

const R = 5.5;
const H = 8.5;
const SHELL_T = 0.3;
const PLATES = 12;
const ARC = (2 * Math.PI) / PLATES;
const ROOF_RISE = 1.0;
/** Roof corners stand right over the shell's corners, 12 cm further out (an overhanging eave). */
const ROOF_R = R + 0.12;
const SINK = 0.05;
const DEG = Math.PI / 180;

/**
 * One shell plate in its own frame (x, z), centred on +z: a trapezoid between the shell's corners at
 * ±15° (outer, radius R) and the same angles SHELL_T further in, so neighbouring plates share their
 * radial end faces exactly. Flat faces: a plate lying on the ground settles instead of rocking.
 */
const PLATE: readonly (readonly [number, number])[] = [
  [(R - SHELL_T) * Math.sin(-15 * DEG), (R - SHELL_T) * Math.cos(15 * DEG)],
  [R * Math.sin(-15 * DEG), R * Math.cos(15 * DEG)],
  [R * Math.sin(15 * DEG), R * Math.cos(15 * DEG)],
  [(R - SHELL_T) * Math.sin(15 * DEG), (R - SHELL_T) * Math.cos(15 * DEG)],
];
const PLATE_W = 2 * R * Math.sin(15 * DEG);
const PLATE_Z0 = (R - SHELL_T) * Math.cos(15 * DEG);
const PLATE_Z1 = R * Math.cos(15 * DEG);
const PLATE_D = PLATE_Z1 - PLATE_Z0;
const PLATE_ZC = (PLATE_Z0 + PLATE_Z1) / 2;
const PLATE_SHAPE = { type: 'prism', id: 'tank-shell', outline: PLATE } as const;
/** Cone roof: a 12-sided frustum with a small flat crown; the kit puts its corners at 15° + 30°k. */
const ROOF = { type: 'cylinder', segments: 12, taper: 0.12 } as const;

/** Rotate a plate-frame point (x, z) to the structure frame for the plate centred at angle a. */
function turn(x: number, z: number, a: number): [number, number] {
  return [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)];
}

/**
 * A plate-shaped part at angle a (from +z toward +x) spanning y0..y1, the outline scaled by k about
 * the tank axis (k > 1: a band just outside the shell). The prism is stood up (rot x 90°) and then
 * turned about y by a (Euler XYZ [π/2, 0, -a] = Ry(a)·Rx(π/2)).
 */
function plate(
  a: number,
  y0: number,
  y1: number,
  k: number,
  color: string,
  extras: Pick<PartDef, 'piece' | 'name' | 'weight' | 'decor'>,
): PartDef {
  const [x, z] = turn(0, PLATE_ZC * k, a);
  return {
    shape: PLATE_SHAPE,
    at: [x, (y0 + y1) / 2, z],
    size: [PLATE_W * k, PLATE_D * k, y1 - y0],
    rot: [Math.PI / 2, 0, -a],
    color,
    ...extras,
  };
}

/** Lowest ground under a plate (its outline corners and chord). */
function plateGround(ctx: StructureContext, a: number): number {
  let low = Infinity;
  const pts = [...PLATE, [0, PLATE_Z0], [0, PLATE_ZC]] as const;
  for (const [px, pz] of pts) {
    const [x, z] = turn(px, pz, a);
    low = Math.min(low, ctx.groundAt(x, z));
  }
  return low;
}

/**
 * Decor in the frame of the plate at angle a (x tangential, y up, r radial), turned with it; a
 * `radial` part (a cylinder) lies along the radius instead of standing up.
 */
function onPlate(
  a: number,
  [x, y, r]: V3,
  size: V3,
  color: string | number,
  piece: string,
  shape: PartDef['shape'] = 'box',
  radial = false,
): PartDef {
  const [sx, sz] = turn(x, r, a);
  const rot: V3 = radial ? [Math.PI / 2, 0, -a] : [0, a, 0];
  return { shape, at: [sx, y, sz], size, rot, color, decor: true, piece };
}

function build(ctx: StructureContext): PartDef[] {
  const parts: PartDef[] = [];
  for (let i = 0; i < PLATES; i++) {
    const a = i * ARC;
    // Plates tear off in pairs: six bent 60° sections.
    const piece = `plate${Math.floor(i / 2)}`;
    const y0 = plateGround(ctx, a) - SINK;
    parts.push(plate(a, y0, H, 1, 'shell', { piece, name: 'plate', weight: 1 }));
    parts.push(plate(a, H - 1.75, H - 0.95, (R + 0.05) / R, 'band', { piece, decor: true }));
  }
  parts.push({
    shape: ROOF,
    piece: 'roof',
    name: 'roof',
    at: [0, H + ROOF_RISE / 2, 0],
    size: [2 * ROOF_R, ROOF_RISE, 2 * ROOF_R],
    color: 'roof',
    weight: 2.8,
  });
  parts.push(deco([0, H + ROOF_RISE + 0.2, 0], [0.6, 0.45, 0.6], 'steel', { piece: 'roof' }));
  parts.push(deco([0, H + ROOF_RISE + 0.47, 0], [0.85, 0.1, 0.85], 'steel', { piece: 'roof' }));

  // Caged ladder on plate 0 (facing +z), from the ground to a handhold above the roof edge.
  const lr = R + 0.2;
  const yl = ctx.groundAt(0, lr) - 0.05;
  const railLen = H + 1 - yl;
  for (const x of [-0.24, 0.24]) {
    parts.push(onPlate(0, [x, yl + railLen / 2, lr], [0.06, railLen, 0.06], 'steel', 'plate0'));
  }
  const cage0 = yl + 2.6;
  const cageTop = H + 0.4;
  for (let y = cage0; y <= cageTop; y += 1.25) {
    parts.push(onPlate(0, [0, y, lr + 0.72], [0.8, 0.05, 0.05], 'steel', 'plate0'));
    for (const x of [-0.4, 0.4]) {
      parts.push(onPlate(0, [x, y, lr + 0.36], [0.05, 0.05, 0.74], 'steel', 'plate0'));
    }
  }
  for (const x of [-0.3, 0.3]) {
    const at: V3 = [x, (cage0 + cageTop) / 2, lr + 0.72];
    parts.push(onPlate(0, at, [0.05, cageTop - cage0, 0.05], 'steel', 'plate0'));
  }
  // Level gauge board on plate 3 (facing +x).
  const side = 3 * ARC;
  parts.push(onPlate(side, [0, H / 2 + 0.4, R + 0.05], [0.28, H - 2, 0.06], 0xf0f0ea, 'plate3'));
  parts.push(onPlate(side, [0, H * 0.62, R + 0.1], [0.4, 0.12, 0.06], 'valve', 'plate3'));

  // Outlet pipe with a flange, valve and handwheel on plate 6 (facing -z), dropping into the ground.
  const back = 6 * ARC;
  const px = 0.9;
  const gp = Math.min(ctx.groundAt(...turn(px, R + 1.1, back)), ctx.groundAt(...turn(px, R + 2.1, back)));
  const py = gp + 0.9;
  const cyl = (n: number): PartDef['shape'] => ({ type: 'cylinder', segments: n });
  const pipe = 'plate6';
  parts.push(onPlate(back, [px, py, R + 1.1], [0.45, 2.2, 0.45], 'steel', pipe, cyl(8), true));
  parts.push(onPlate(back, [px, py, R + 0.06], [0.75, 0.1, 0.75], 'steel', pipe, cyl(8), true));
  parts.push(onPlate(back, [px, py, R + 1.3], [0.55, 0.62, 0.5], 'valve', pipe));
  parts.push(onPlate(back, [px, py + 0.5, R + 1.3], [0.06, 0.4, 0.06], 'steel', pipe));
  parts.push(onPlate(back, [px, py + 0.72, R + 1.3], [0.65, 0.06, 0.65], 'valve', pipe, cyl(10)));
  const riser = py - gp + 0.2;
  parts.push(onPlate(back, [px, gp - 0.2 + riser / 2, R + 2.0], [0.45, riser, 0.45], 'steel', pipe, cyl(8)));
  return parts;
}

const tank: StructureDef = {
  kind: 'tank',
  label: 'Storage tank',
  material: 'metal',
  building: true,
  footprint: 7.8,
  palettes: {
    // White, light grey, aluminium, cream and pale green tank paint.
    shell: [0xe6e4dd, 0xd7d9d6, 0xb9bec2, 0xd8cfb8, 0x9fb3a5],
    // Company band: red, blue, green, orange, charcoal.
    band: [0xc0392b, 0x2e5f8f, 0x2f7d4a, 0xe08a1e, 0x3b3f44],
    roof: [0xb9bec2, 0x9ca3a8, 0xd7d9d6],
    // Ladder and pipework: galvanised grey or safety yellow.
    steel: [0x5b6166, 0xd8a31a],
    valve: [0xb3261e],
  },
  breakup: { impulseScale: 0.6, spin: 0.2, falloff: 5, floor: 0.3 },
  defaultYaw: (ctx) => ctx.rng() * 2 * Math.PI,
  build: (ctx) => [
    {
      part: 'tank',
      stand: 'anchored',
      ground: 'fixed',
      mass: 28,
      breakSpeed: 20,
      breakMode: 'shatter',
      proxy: 'trunk',
      trunkRadius: R - 0.25,
      shake: 'offset',
      parts: build(ctx),
    },
  ],
};

export default tank;
