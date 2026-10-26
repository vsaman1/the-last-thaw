import { deco } from './barn';
import type { PartDef, StructureContext, StructureDef, V3 } from './kit';

/**
 * A tall farm grain silo (6 m diameter, 18 m of wall, dome to 20.2 m): a concrete-stave silo with
 * steel hoops or (one in four) a blue glass-fused steel silo with a white top band; an enclosed
 * chute, a fill pipe and a concrete footing as decor. One anchored body of 5 pieces: four
 * stacked 4.5 m wall rings and the dome.
 * Mass 26 t; a 30 t iceberg breaks it above 18 m/s (breakImpulse 675), a 100 t one at 5.4 m/s.
 * It TOPPLES IN SEGMENTS: the hit is shared out almost evenly by mass (breakup falloff 40, floor
 * 1) so every ring starts moving the push direction at the same speed; ground friction stops the
 * bottom ring first and the rings above keep going and tumble off forward, then roll.
 * Collides as a round 'trunk' proxy of the wall's radius. With no yaw given it is turned at random.
 * Ground: the stack starts at the lowest ground around its rim, so a slope buries the uphill
 * edge of the bottom ring (diameter × slope, 0.7 m on a 0.12 slope; the ring is thick enough
 * for Rapier to push it out cleanly).
 */

const R = 3;
const RINGS = 4;
const RING_H = 4.5;
const GAP = 0.01;
const DOME_RISE = 2.2;
const DOME_OUT = 0.1;
const SINK = 0.05;
const RING = { type: 'cylinder', segments: 16 } as const;
const DOME = {
  type: 'lathe',
  id: 'silo-dome',
  profile: [
    [1, 0],
    [0.93, 0.3],
    [0.74, 0.62],
    [0.42, 0.88],
    [0, 1],
  ],
  segments: 16,
} as const;
/** Glass-fused steel blue (the one-in-four steel silo). */
const STEEL_BLUE = 0x27466e;
const FILL_PIPE = (120 * Math.PI) / 180;

/** Lowest ground (relative) on the silo's rim and centre. */
function baseGround(ctx: StructureContext): number {
  let low = ctx.groundAt(0, 0);
  for (let i = 0; i < 16; i++) {
    const a = ((i + 0.5) / 16) * 2 * Math.PI;
    low = Math.min(low, ctx.groundAt(R * Math.sin(a), R * Math.cos(a)));
  }
  return low;
}

function build(ctx: StructureContext): PartDef[] {
  const parts: PartDef[] = [];
  const b0 = baseGround(ctx) - SINK;
  const steel = ctx.palette('body') === STEEL_BLUE;
  const top = b0 + RINGS * RING_H;
  const px = Math.sin(FILL_PIPE) * (R + 0.18);
  const pz = Math.cos(FILL_PIPE) * (R + 0.18);
  /** A round decor part (hoop, band, footing, pipe length) that goes with `piece`. */
  const round = (at: V3, size: V3, color: string | number, piece: string): PartDef => ({
    shape: RING,
    at,
    size,
    color,
    decor: true,
    piece,
  });
  for (let k = 0; k < RINGS; k++) {
    const piece = `ring${k}`;
    const y0 = b0 + k * RING_H;
    const mid = y0 + (RING_H - GAP) / 2;
    parts.push({
      shape: RING,
      piece,
      name: 'ring',
      at: [0, mid, 0],
      size: [2 * R, RING_H - GAP, 2 * R],
      color: 'body',
    });
    // Chute up the front and the fill pipe, in lengths that go with their ring.
    parts.push(deco([0, mid, R + 0.22], [0.9, RING_H - 0.06, 0.55], 'chute', { piece }));
    parts.push(round([px, mid, pz], [0.22, RING_H - 0.02, 0.22], 'chute', piece));
    if (!steel) {
      for (const dy of [1.2, 3.3]) {
        parts.push(round([0, y0 + dy, 0], [2 * R + 0.07, 0.09, 2 * R + 0.07], 'hoop', piece));
      }
    }
  }
  if (steel) {
    parts.push(round([0, top - 0.75, 0], [2 * R + 0.06, 0.9, 2 * R + 0.06], 0xf2f2ee, `ring${RINGS - 1}`));
  }
  parts.push(round([0, b0 + 0.2, 0], [2 * R + 0.5, 0.5, 2 * R + 0.5], 'footing', 'ring0'));
  parts.push({
    shape: DOME,
    piece: 'dome',
    name: 'roof',
    at: [0, top + DOME_RISE / 2, 0],
    size: [2 * (R + DOME_OUT), DOME_RISE, 2 * (R + DOME_OUT)],
    color: steel ? STEEL_BLUE : 'dome',
  });
  parts.push(deco([0, top + 0.35, R - 0.15], [1.0, 0.8, 1.1], 'chute', { piece: 'dome' }));
  const dome = { piece: 'dome' };
  parts.push(deco([px * 0.9, top + 0.45, pz * 0.9], [0.24, 0.24, 0.8], 'chute', dome, [0, FILL_PIPE, 0]));
  parts.push(deco([0, top + DOME_RISE + 0.1, 0], [0.7, 0.25, 0.7], 'chute', dome));
  parts.push({
    shape: { type: 'cone', segments: 8 },
    at: [0, top + DOME_RISE + 0.42, 0],
    size: [0.5, 0.4, 0.5],
    color: 'chute',
    decor: true,
    ...dome,
  });
  return parts;
}

const silo: StructureDef = {
  kind: 'silo',
  label: 'Grain silo',
  material: 'masonry',
  building: true,
  footprint: 3.8,
  palettes: {
    // Concrete staves in three weathered greys, or blue glass-fused steel.
    body: [0xd8d4c8, 0xc9c3b5, 0xbab3a3, STEEL_BLUE],
    // Galvanised, darker steel or red-painted domes on the concrete silos.
    dome: [0x9aa1a6, 0x7d8489, 0xb34a2c],
    hoop: [0x4f5458],
    chute: [0x9aa1a6, 0x8a9095],
    footing: [0xa9a49a],
  },
  breakup: { impulseScale: 0.6, spin: 0.06, falloff: 40, floor: 1 },
  defaultYaw: (ctx) => ctx.rng() * 2 * Math.PI,
  build: (ctx) => [
    {
      part: 'silo',
      stand: 'anchored',
      ground: 'fixed',
      mass: 26,
      breakSpeed: 18,
      breakMode: 'shatter',
      proxy: 'trunk',
      trunkRadius: R - 0.25,
      shake: 'tilt',
      parts: build(ctx),
    },
  ],
};

export default silo;
