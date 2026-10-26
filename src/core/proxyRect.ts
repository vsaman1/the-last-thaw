import type { ProxyRect } from './types';

/**
 * The footprint geometry of a ProxyRect, shared by the iceberg's contact solver
 * (src/core/sim/iceberg.ts proxyGap) and the physics world's footprint queries
 * (src/core/physics/world.ts proxyDistance, traffic deck support). Coordinates are in the rect's own
 * frame: u along (ux, uz) from its centre, v along (−uz, ux). A rect with skewed ends (k0 / k1, a
 * skewed bridge deck) is the quadrilateral |v| ≤ hv, −hu + k0 · v ≤ u ≤ hu + k1 · v.
 */

/** Unit direction, in the rect's frame, from a query point toward the body (rectGap). */
export interface RectDirection {
  nu: number;
  nv: number;
}

const skewed = (r: ProxyRect): boolean => (r.k0 ?? 0) !== 0 || (r.k1 ?? 0) !== 0;

/** Corners of a skewed footprint, counter-clockwise (v up): u then v of each. */
function corners(r: ProxyRect, out: number[]): number[] {
  const k0 = r.k0 ?? 0;
  const k1 = r.k1 ?? 0;
  out[0] = -r.hu - k0 * r.hv;
  out[1] = -r.hv;
  out[2] = r.hu - k1 * r.hv;
  out[3] = -r.hv;
  out[4] = r.hu + k1 * r.hv;
  out[5] = r.hv;
  out[6] = -r.hu + k0 * r.hv;
  out[7] = r.hv;
  return out;
}
const _c: number[] = [0, 0, 0, 0, 0, 0, 0, 0];

/**
 * The four corners of a footprint (skewed or not), counter-clockwise, in its own frame: u then v of
 * each into `out` (8 numbers).
 */
export function rectCorners(r: ProxyRect, out: number[]): number[] {
  return corners(r, out);
}

/**
 * Signed distance from (lu, lv) to the edge of the footprint (negative inside), writing into `out`
 * the unit direction from the point toward the body: toward the nearest point of it from outside,
 * away from the nearest face from inside.
 */
export function rectGap(lu: number, lv: number, r: ProxyRect, out: RectDirection): number {
  if (!skewed(r)) {
    const eu = Math.abs(lu) - r.hu;
    const ev = Math.abs(lv) - r.hv;
    if (eu > 0 || ev > 0) {
      // Outside: toward the closest point of the rectangle.
      let nu = eu > 0 ? -Math.sign(lu) * eu : 0;
      let nv = ev > 0 ? -Math.sign(lv) * ev : 0;
      const gap = Math.hypot(nu, nv);
      nu /= gap;
      nv /= gap;
      out.nu = nu;
      out.nv = nv;
      return gap;
    }
    // Inside, nearest the ±u or the ±v face: the body lies on the other side of the point.
    if (eu > ev) {
      out.nu = lu < 0 ? 1 : -1;
      out.nv = 0;
      return eu;
    }
    out.nu = 0;
    out.nv = lv < 0 ? 1 : -1;
    return ev;
  }
  const c = corners(r, _c);
  // Inside a convex polygon the nearest boundary point is the foot on the nearest face's line.
  let face = 0;
  let best = -Infinity;
  for (let i = 0; i < 4; i++) {
    const pu = c[2 * i];
    const pv = c[2 * i + 1];
    const eu = c[(2 * i + 2) % 8] - pu;
    const ev = c[(2 * i + 3) % 8] - pv;
    const l = Math.hypot(eu, ev) || 1;
    const d = (ev * (lu - pu) - eu * (lv - pv)) / l;
    if (d > best) {
      best = d;
      face = i;
    }
  }
  if (best <= 0) {
    const eu = c[(2 * face + 2) % 8] - c[2 * face];
    const ev = c[(2 * face + 3) % 8] - c[2 * face + 1];
    const l = Math.hypot(eu, ev) || 1;
    // Away from the face's outward normal (ev, −eu) / l.
    out.nu = -ev / l;
    out.nv = eu / l;
    return best;
  }
  // Outside: the nearest point on the four edges.
  let gap = Infinity;
  for (let i = 0; i < 4; i++) {
    const pu = c[2 * i];
    const pv = c[2 * i + 1];
    const eu = c[(2 * i + 2) % 8] - pu;
    const ev = c[(2 * i + 3) % 8] - pv;
    const l2 = eu * eu + ev * ev || 1;
    const t = Math.min(1, Math.max(0, ((lu - pu) * eu + (lv - pv) * ev) / l2));
    const du = pu + t * eu - lu;
    const dv = pv + t * ev - lv;
    const d = Math.hypot(du, dv);
    if (d < gap) {
      gap = d;
      out.nu = d > 0 ? du / d : 0;
      out.nv = d > 0 ? dv / d : 0;
    }
  }
  return gap;
}

/** How far the footprint reaches from its centre along the unit direction (du, dv) (its frame). */
export function rectReach(r: ProxyRect, du: number, dv: number): number {
  if (!skewed(r)) return Math.abs(du) * r.hu + Math.abs(dv) * r.hv;
  const c = corners(r, _c);
  let reach = -Infinity;
  for (let i = 0; i < 4; i++) reach = Math.max(reach, c[2 * i] * du + c[2 * i + 1] * dv);
  return reach;
}

/** Furthest any point of the footprint lies from its centre (m): a bound for queries. */
export function rectRadius(r: ProxyRect): number {
  const k = Math.max(Math.abs(r.k0 ?? 0), Math.abs(r.k1 ?? 0));
  return Math.hypot(r.hu + k * r.hv, r.hv);
}

/**
 * Second moment of the footprint's area about its centre over its area (m²): (hu² + hv²) / 3 for
 * the rectangle, plus hv² (k0² + k1²) / 6 for skewed ends (the area itself is 4 · hu · hv either way).
 */
export function rectGyration(r: ProxyRect): number {
  const k0 = r.k0 ?? 0;
  const k1 = r.k1 ?? 0;
  return (r.hu * r.hu + r.hv * r.hv) / 3 + (r.hv * r.hv * (k0 * k0 + k1 * k1)) / 6;
}
