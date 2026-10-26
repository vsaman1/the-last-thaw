import { spanSegments, type BodyDef, type PartDef, type StructureDef } from './kit';

/**
 * An above-ground oil or gas trunk line across the valley (along local x): a 1.2 m steel pipe carried
 * 2.4 m up (centre) on H-frame supports. Spanning, like the guardrail: `span` is split into ~8 m
 * segments, each an anchored body of one support (two posts and a crossbeam) and the pipe from it to
 * the next support, following the ground; the last segment also carries the end support.
 * About 5 t a segment (the pipe 4 t, the support 1 t): a 30 t iceberg breaks it above 8 m/s
 * (breakImpulse 300 t·m/s), a 100 t one at 2.4 m/s, into the pipe length and the support, which
 * tumble away. The clamp band at each support and the end caps are decor.
 */

const TARGET = 8;
const PIPE_D = 1.2;
/** Pipe centre above the ground line between two supports. */
const PIPE_Y = 2.4;
const POST_W = 0.35;
/** Posts stand either side of the pipe at z = ±POST_Z. */
const POST_Z = 0.9;
const BEAM_H = 0.35;
const BEAM_LEN = 2.2;
/** Shallow on purpose: a freed post sunk deep in the terrain is kicked out by depenetration. */
const POST_SINK = 0.06;
/** Between the crossbeam and the pipe (separate pieces must not start inside each other). */
const GAP = 0.03;
/** Kit cylinders run along +y; this turns one to lie along +x before the segment's tilt. */
const ALONG_X = -Math.PI / 2;

/** An H-frame support at `x` on ground `g` under a pipe whose centre there is at `pipeY`. */
function support(x: number, g: number, pipeY: number, piece: string): PartDef[] {
  const top = pipeY - PIPE_D / 2 - GAP;
  const postTop = top - BEAM_H;
  const h = postTop - g + POST_SINK;
  const posts = [-POST_Z, POST_Z].map(
    (z): PartDef => ({
      shape: 'box',
      name: 'support',
      piece,
      at: [x, postTop - h / 2, z],
      size: [POST_W, h, POST_W],
      color: 'support',
      weight: 0.4,
    }),
  );
  return [
    ...posts,
    {
      shape: 'box',
      name: 'support',
      piece,
      at: [x, top - BEAM_H / 2, 0],
      size: [POST_W + 0.1, BEAM_H, BEAM_LEN],
      color: 'support',
      weight: 0.2,
    },
  ];
}

const pipeline: StructureDef = {
  kind: 'pipeline',
  label: 'Pipeline',
  material: 'metal',
  footprint: 1.2,
  span: { default: 'floor', min: TARGET, max: 240 },
  palettes: {
    // Pipe coating: gas-line yellow, insulation-jacket silver, primer red-brown, dark green.
    pipe: [0xd9b021, 0xb8bec3, 0x8a4a32, 0x3f5e4a],
    support: [0x6f777d, 0x5b6166, 0x8e959a],
    band: [0x2b2e31],
  },
  build(ctx) {
    const { n, length: L, centres } = spanSegments(ctx.span, TARGET);
    return centres.map((xc, i): BodyDef => {
      const gc = ctx.groundAt(xc, 0);
      const g0 = ctx.groundAt(xc - L / 2, 0) - gc;
      const g1 = ctx.groundAt(xc + L / 2, 0) - gc;
      const rise = g1 - g0;
      const tilt = Math.atan2(rise, L);
      const pipeLen = Math.hypot(L, rise) - 0.02;
      const pipeY = (g0 + g1) / 2 + PIPE_Y;
      const parts: PartDef[] = [...support(-L / 2, g0, g0 + PIPE_Y, 'support')];
      if (i === n - 1) parts.push(...support(L / 2, g1, g1 + PIPE_Y, 'endSupport'));
      const rot = [0, 0, tilt + ALONG_X] as const;
      parts.push({
        shape: { type: 'cylinder', segments: 10 },
        name: 'pipe',
        piece: 'pipe',
        at: [0, pipeY, 0],
        size: [PIPE_D, pipeLen, PIPE_D],
        rot,
        color: 'pipe',
        weight: 4,
      });
      // Clamp band where the pipe sits on this segment's support, end caps where the line stops.
      const band = (x: number, w: number, color: string): PartDef => ({
        shape: { type: 'cylinder', segments: 10 },
        piece: 'pipe',
        at: [x, pipeY + (x / L) * rise, 0],
        size: [PIPE_D + 0.08, w, PIPE_D + 0.08],
        rot,
        color,
        decor: true,
      });
      parts.push(band(-L / 2 + 0.3, 0.3, 'band'));
      if (i === 0) parts.push(band(-L / 2 + 0.03, 0.06, 'support'));
      if (i === n - 1) parts.push(band(L / 2 - 0.03, 0.06, 'support'));
      return {
        part: 'pipeline',
        stand: 'anchored',
        at: [xc, gc, 0],
        ground: 'fixed',
        mass: i === n - 1 ? 6 : 5,
        breakSpeed: 8,
        breakMode: 'shatter',
        breakup: { impulseScale: 0.8, spin: 0.4, falloff: 2 },
        shake: 'tilt',
        parts,
      };
    });
  },
};

export default pipeline;
