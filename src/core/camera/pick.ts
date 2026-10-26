import type { Terrain, Vec3 } from '../types';
import { type CameraPose, groundAt } from './follow';

const DEG = Math.PI / 180;

/** A ray from (ox, oy, oz) along the unit direction (dx, dy, dz). */
export interface Ray {
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
}

export const createRay = (): Ray => ({ ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 1 });

/**
 * The view ray through a screen point for a camera pose (lookAt convention, world up +Y, as the
 * renderer's camera.lookAt). ndc in -1..1, +y up; vFovDeg = the fov actually rendered
 * (effectiveFov), aspect = width / height.
 */
export function screenRay(
  pose: CameraPose,
  vFovDeg: number,
  aspect: number,
  ndcX: number,
  ndcY: number,
  out: Ray,
): Ray {
  const p = pose.position;
  let fx = pose.lookAt.x - p.x;
  let fy = pose.lookAt.y - p.y;
  let fz = pose.lookAt.z - p.z;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // right = forward × up; up' = right × forward
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz);
  if (rl < 1e-9) {
    rx = 1;
    rz = 0;
  } else {
    rx /= rl;
    rz /= rl;
  }
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;
  const tanV = Math.tan((vFovDeg * DEG) / 2);
  const sx = ndcX * tanV * aspect;
  const sy = ndcY * tanV;
  const dx = fx + rx * sx + ux * sy;
  const dy = fy + uy * sy;
  const dz = fz + rz * sx + uz * sy;
  const dl = Math.hypot(dx, dy, dz);
  out.ox = p.x;
  out.oy = p.y;
  out.oz = p.z;
  out.dx = dx / dl;
  out.dy = dy / dl;
  out.dz = dz / dl;
  return out;
}

/**
 * First point where the ray meets the ground or the sea surface (groundAt), within maxDist.
 * Marches with steps proportional to the height above the ground (so a steep ridge in the way is
 * not skipped), then bisects. For pointer events, not per frame. Writes `out`, returns false on a miss.
 */
export function raycastGround(terrain: Terrain, ray: Ray, maxDist: number, out: Vec3): boolean {
  const maxStep = Math.max(2, terrain.grid.cellSize * 2);
  const heightAbove = (t: number): number =>
    ray.oy + ray.dy * t - groundAt(terrain, ray.ox + ray.dx * t, ray.oz + ray.dz * t);
  let t0 = 0;
  let h0 = heightAbove(0);
  if (h0 <= 0) {
    out.x = ray.ox;
    out.y = ray.oy;
    out.z = ray.oz;
    return true;
  }
  while (t0 < maxDist) {
    const step = Math.min(maxStep, Math.max(0.25, h0 * 0.5));
    const t1 = Math.min(maxDist, t0 + step);
    const h1 = heightAbove(t1);
    if (h1 <= 0) {
      let lo = t0;
      let hi = t1;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (heightAbove(mid) > 0) lo = mid;
        else hi = mid;
      }
      out.x = ray.ox + ray.dx * hi;
      out.z = ray.oz + ray.dz * hi;
      out.y = groundAt(terrain, out.x, out.z);
      return true;
    }
    t0 = t1;
    h0 = h1;
  }
  return false;
}

/** Detects a double tap (touch) from successive short taps. */
export class TapDetector {
  private t = -Infinity;
  private x = 0;
  private y = 0;

  constructor(
    readonly maxGapMs = 320,
    readonly maxDistPx = 30,
  ) {}

  /** Register a tap; true when it completes a double tap (the pair is then used up). */
  tap(timeMs: number, x: number, y: number): boolean {
    const double = timeMs - this.t <= this.maxGapMs && Math.hypot(x - this.x, y - this.y) <= this.maxDistPx;
    if (double) {
      this.t = -Infinity;
      return true;
    }
    this.t = timeMs;
    this.x = x;
    this.y = y;
    return false;
  }

  reset(): void {
    this.t = -Infinity;
  }
}
