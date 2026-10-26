import { spanSegments, type BodyDef, type PartDef, type StructureDef } from './kit';

/**
 * A post-and-rail field fence across the valley. Spanning: `span` is split into ~2.4 m segments,
 * each an anchored body (its post plus the two rails to the next post) that follows the ground.
 * Very light (~70 kg a segment): any hit above ~2.5 m/s by a 30 t iceberg snaps it into post and
 * rails, and the iceberg hardly notices (the loose-body impulse on 0.07 t is tiny).
 */

const TARGET = 2.4;
const POST_W = 0.12;
const POST_UP = 0.9;
/** Shallow on purpose: a freed post sunk deep in the terrain is kicked out by depenetration. */
const POST_SINK = 0.06;
const RAIL_H = 0.11;
const RAIL_T = 0.05;
const RAILS = [0.42, 0.8] as const;

function post(x: number, ground: number, piece: string): PartDef {
  const h = POST_UP + POST_SINK;
  return {
    shape: 'box',
    name: 'post',
    piece,
    at: [x, ground - POST_SINK + h / 2, 0],
    size: [POST_W, h, POST_W],
    color: 'wood',
  };
}

const fence: StructureDef = {
  kind: 'fence',
  label: 'Fence',
  material: 'wood',
  footprint: 0.4,
  span: { default: 'floor', min: TARGET, max: 240 },
  palettes: {
    // Weathered timber, or (one in four) white-painted.
    wood: [0x9c7b56, 0x8b6b4a, 0xa88a63, 0xe9e4d8],
  },
  build(ctx) {
    const { n, length: L, centres } = spanSegments(ctx.span, TARGET);
    return centres.map((xc, i): BodyDef => {
      const gc = ctx.groundAt(xc, 0);
      const g0 = ctx.groundAt(xc - L / 2, 0) - gc;
      const g1 = ctx.groundAt(xc + L / 2, 0) - gc;
      const parts: PartDef[] = [post(-L / 2, g0, 'post')];
      if (i === n - 1) parts.push(post(L / 2, g1, 'endPost'));
      RAILS.forEach((h, k) => {
        const rise = g1 - g0;
        // Nailed to the posts' down-course face, a hair short of the next segment's rail, so a
        // freed rail never starts inside a neighbour (Rapier would fling it).
        parts.push({
          shape: 'box',
          name: 'rail',
          piece: `rail${k}`,
          at: [0, (g0 + g1) / 2 + h, (POST_W + RAIL_T) / 2],
          size: [Math.hypot(L, rise) - 0.02, RAIL_H, RAIL_T],
          rot: [0, 0, Math.atan2(rise, L)],
          color: 'wood',
        });
      });
      return {
        part: 'fence',
        stand: 'anchored',
        at: [xc, gc, 0],
        ground: 'fixed',
        mass: i === n - 1 ? 0.1 : 0.07,
        breakSpeed: 2.5,
        breakMode: 'shatter',
        breakup: { impulseScale: 0.9, spin: 0.6, falloff: 1.5 },
        shake: 'tilt',
        parts,
      };
    });
  },
};

export default fence;
