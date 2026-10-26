import { spanSegments, type BodyDef, type PartDef, type StructureDef } from './kit';

/**
 * A steel W-beam road guardrail across the valley (along local x). Spanning: `span` is split into
 * ~4 m segments, each an anchored body that follows the ground: two steel posts 2 m apart and the
 * galvanised beam bolted to them on spacer blocks, facing up-course (-z, the traffic side). About
 * 90 kg a segment (beam ~13 kg/m, posts ~14 kg): a 30 t iceberg snaps it above 3 m/s (momentum
 * rule, breakImpulse 112.5 t·m/s) into posts and beam that tumble away, and hardly notices it.
 * Spacers, the beam's groove, reflectors and the flared end terminals are decor.
 */

const TARGET = 4;
const POST_X = 0.1;
const POST_Z = 0.15;
const POST_UP = 0.72;
/** Shallow on purpose: a freed post sunk deep in the terrain is kicked out by depenetration. */
const POST_SINK = 0.06;
const BEAM_Y = 0.55;
const BEAM_H = 0.31;
const BEAM_D = 0.085;
const SPACER = 0.15;
const BEAM_Z = -(POST_Z / 2 + SPACER + BEAM_D / 2);

/** A post from `ground` (sunk a little) up to just above the beam, whose centre is at `beam`. */
function post(x: number, ground: number, beam: number, piece: string): PartDef[] {
  const top = beam + POST_UP - BEAM_Y;
  const h = top - ground + POST_SINK;
  return [
    {
      shape: 'box',
      name: 'post',
      piece,
      at: [x, top - h / 2, 0],
      size: [POST_X, h, POST_Z],
      color: 'post',
      weight: 0.2,
    },
    {
      shape: 'box',
      piece,
      at: [x, beam, -(POST_Z + SPACER) / 2],
      size: [0.08, 0.2, SPACER],
      color: 'post',
      decor: true,
    },
  ];
}

const guardrail: StructureDef = {
  kind: 'guardrail',
  label: 'Guardrail',
  material: 'metal',
  footprint: 0.45,
  span: { default: 'floor', min: TARGET, max: 240 },
  palettes: {
    // Galvanised steel, fresh or weathered.
    steel: [0xb3babf, 0xa4abb1, 0x9aa1a6],
    post: [0x7d858b, 0x6f777d],
    groove: [0x8a9196],
  },
  build(ctx) {
    const { n, length: L, centres } = spanSegments(ctx.span, TARGET);
    return centres.map((xc, i): BodyDef => {
      const gc = ctx.groundAt(xc, 0);
      const g0 = ctx.groundAt(xc - L / 2, 0) - gc;
      const g1 = ctx.groundAt(xc + L / 2, 0) - gc;
      const rise = g1 - g0;
      const tilt = Math.atan2(rise, L);
      const beamLen = Math.hypot(L, rise) - 0.02;
      const beamY = (g0 + g1) / 2 + BEAM_Y;
      const parts: PartDef[] = [
        ...post(-L / 2, g0, g0 + BEAM_Y, 'post0'),
        ...post(0, Math.min(0, beamY - BEAM_Y), beamY, 'post1'),
      ];
      if (i === n - 1) parts.push(...post(L / 2, g1, g1 + BEAM_Y, 'endPost'));
      parts.push(
        {
          shape: 'box',
          name: 'beam',
          piece: 'beam',
          at: [0, beamY, BEAM_Z],
          size: [beamLen, BEAM_H, BEAM_D],
          rot: [0, 0, tilt],
          color: 'steel',
          weight: 0.6,
        },
        {
          shape: 'box',
          piece: 'beam',
          at: [0, beamY, BEAM_Z - BEAM_D / 2 - 0.004],
          size: [beamLen - 0.02, 0.05, 0.01],
          rot: [0, 0, tilt],
          color: 'groove',
          decor: true,
        },
      );
      for (const x of [-L / 2, 0]) {
        const y = g0 + ((x + L / 2) / L) * rise + BEAM_Y + BEAM_H / 2 + 0.03;
        parts.push({
          shape: 'box',
          piece: 'beam',
          at: [x + 0.12, y, BEAM_Z],
          size: [0.07, 0.06, 0.02],
          color: i % 2 === 0 ? 0xffb02e : 0xf2f2ee,
          decor: true,
        });
      }
      // Flared end terminals where the rail starts and stops.
      for (const [end, g] of [[-1, g0], [1, g1]] as const) {
        if ((end < 0 && i !== 0) || (end > 0 && i !== n - 1)) continue;
        parts.push({
          shape: 'box',
          piece: 'beam',
          at: [end * (L / 2 + 0.12), g + BEAM_Y, BEAM_Z + 0.08],
          size: [0.3, BEAM_H + 0.05, 0.08],
          rot: [0, end * 0.5, 0],
          color: 'steel',
          decor: true,
        });
      }
      return {
        part: 'guardrail',
        stand: 'anchored',
        at: [xc, gc, 0],
        ground: 'fixed',
        mass: i === n - 1 ? 0.1 : 0.09,
        breakSpeed: 3,
        breakMode: 'shatter',
        breakup: { impulseScale: 0.9, spin: 0.6, falloff: 1.5 },
        shake: 'tilt',
        parts,
      };
    });
  },
};

export default guardrail;
