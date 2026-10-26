import type { IcebergState, Terrain, Vec3 } from '../types';
import { clamp, dirToHeading, lerp, smoothstep } from '../math';

/** A camera placement: where it sits, what it looks at, vertical field of view in degrees. */
export interface CameraPose {
  position: Vec3;
  lookAt: Vec3;
  fov: number;
}

export const createCameraPose = (): CameraPose => ({
  position: { x: 0, y: 0, z: 0 },
  lookAt: { x: 0, y: 0, z: 1 },
  fov: 55,
});

export function copyPose(src: CameraPose, dst: CameraPose): CameraPose {
  dst.position.x = src.position.x;
  dst.position.y = src.position.y;
  dst.position.z = src.position.z;
  dst.lookAt.x = src.lookAt.x;
  dst.lookAt.y = src.lookAt.y;
  dst.lookAt.z = src.lookAt.z;
  dst.fov = src.fov;
  return dst;
}

/** Tuning for the follow camera and cinematics. Distances in metres, rates in 1/s, fov in degrees. */
export const CAMERA_TUNING = {
  back: 14,
  up: 7.5,
  lookAhead: 10,
  lookUp: 1,
  /** Extra distance behind at top speed (adds to the sense of speed together with fov). */
  backAtSpeed: 1.5,
  fovBase: 55,
  fovFast: 64,
  fovSpeedLo: 10,
  fovSpeedHi: 28,
  /** Below this horizontal speed the camera direction blends toward the iceberg heading. */
  dirFallbackLo: 0.5,
  dirFallbackHi: 3,
  /** Drop-ahead / airborne response (multiplied by the 0..1 drop factor). */
  dropRise: 4,
  dropBack: 2,
  dropLookAhead: 10,
  dropLookDown: 7,
  dropFov: 3,
  /** Expected downhill fall per metre ahead; only falls steeper than this count as a "drop". */
  normalSlope: 0.22,
  dropExcessLo: 2,
  dropExcessHi: 14,
  /** Minimum height above ground/sea of the camera and of the sampled sight line to the iceberg. */
  minClearance: 2.5,
  /** Fractions along the camera → iceberg line that must also clear the ground. */
  lineSamples: [1 / 3, 2 / 3] as readonly number[],
  /** Height above iceberg.pos (its ground contact) the sight line aims at. */
  lineTargetUp: 1.5,
  // controller smoothing
  dirRate: 3,
  maxDirRate: 2,
  posRateLateral: 7,
  posRateVertical: 4,
  lookRate: 9,
  fovRate: 2.5,
  dropRate: 3,
  /** Blend from the intro pose to follow when the intro is skipped (s). */
  skipBlend: 0.6,
  /** Blend from the flyover into the short calving shot when the flyover is skipped (s). */
  introSwitchBlend: 0.5,
  outroDuration: 4,
  /** Outro hold drift (rad/s of orbit around the focus point). */
  outroDrift: 0.012,
  failRadius: 16,
  failHeight: 10,
  failOrbitRate: 0.22,
  /**
   * Follow distances scale with the iceberg radius relative to this base (m): a melting iceberg is
   * framed tighter, a bigger one further back. Gently: scale = 1 + sizeResponse × (r / sizeRef − 1).
   */
  sizeRef: 2.2,
  sizeResponse: 0.6,
  sizeScaleMin: 0.6,
  sizeScaleMax: 2.5,
  /** Smoothing of that scale in the controller (1/s), so a sudden size change does not jolt the shot. */
  sizeRate: 2,
} as const;

const T = CAMERA_TUNING;

/** Follow-distance multiplier for an iceberg of this collision radius (1 at the base 2.2 m). */
export function followScale(radius: number): number {
  if (!(radius > 0)) return 1;
  return clamp(1 + T.sizeResponse * (radius / T.sizeRef - 1), T.sizeScaleMin, T.sizeScaleMax);
}

/** Height of whatever the camera must stay above: terrain or the sea surface. */
export function groundAt(terrain: Terrain, x: number, z: number): number {
  const h = terrain.heightAt(x, z);
  const sea = terrain.level.seaLevel;
  return h > sea ? h : sea;
}

/**
 * Push `pos` straight up until it clears the ground by `minClearance` at its own position and at
 * the `lineSamples` points along the line toward (tx, ty, tz). Raising the camera never moves the
 * horizontal position of those line points, so each constraint has a closed-form minimum y.
 */
export function enforceClearance(
  terrain: Terrain,
  pos: Vec3,
  tx: number,
  ty: number,
  tz: number,
  withLine = true,
): void {
  const c = T.minClearance;
  let y = pos.y;
  const own = groundAt(terrain, pos.x, pos.z) + c;
  if (y < own) y = own;
  if (withLine) {
    const fs = T.lineSamples;
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      const x = pos.x + (tx - pos.x) * f;
      const z = pos.z + (tz - pos.z) * f;
      const need = (groundAt(terrain, x, z) + c - f * ty) / (1 - f);
      if (y < need) y = need;
    }
  }
  pos.y = y;
}

/**
 * Yaw (heading convention) the camera should look along: the horizontal velocity direction,
 * blending to the iceberg heading when it is nearly stationary.
 */
export function followHeading(ice: IcebergState): number {
  const vx = ice.vel.x;
  const vz = ice.vel.z;
  const sp = Math.hypot(vx, vz);
  const w = smoothstep(T.dirFallbackLo, T.dirFallbackHi, sp);
  if (w >= 1) return dirToHeading(vx, vz);
  // heading θ → (sin θ, cos θ)
  const hx = Math.sin(ice.heading);
  const hz = Math.cos(ice.heading);
  if (w <= 0) return ice.heading;
  const dx = hx * (1 - w) + (vx / sp) * w;
  const dz = hz * (1 - w) + (vz / sp) * w;
  if (dx * dx + dz * dz < 1e-6) return ice.heading;
  return dirToHeading(dx, dz);
}

/**
 * 0..1: how much the ground ahead falls away faster than a normal slope (chute, cliff lip), or
 * how airborne the iceberg is. Drives the camera rising and aiming lower/further ahead.
 */
export function measureDrop(ice: IcebergState, dirX: number, dirZ: number, terrain: Terrain): number {
  const px = ice.pos.x;
  const pz = ice.pos.z;
  const g0 = groundAt(terrain, px, pz);
  let excess = 0;
  for (let d = 12; d <= 48; d += 12) {
    const e = g0 - groundAt(terrain, px + dirX * d, pz + dirZ * d) - T.normalSlope * d;
    if (e > excess) excess = e;
  }
  const drop = smoothstep(T.dropExcessLo, T.dropExcessHi, excess);
  const air = ice.grounded ? 0 : smoothstep(0.1, 0.5, ice.airTime);
  const above = smoothstep(2, 8, ice.pos.y - g0);
  return Math.max(drop, air, above);
}

/**
 * Target follow pose for an iceberg at (px, py, pz) travelling along unit (dirX, dirZ) at
 * horizontal speed `speed`, with drop factor `drop` (0..1) and size multiplier `scale`
 * (followScale). Writes into `out`.
 */
export function computeFollowTarget(
  px: number,
  py: number,
  pz: number,
  dirX: number,
  dirZ: number,
  speed: number,
  drop: number,
  terrain: Terrain,
  out: CameraPose,
  scale = 1,
): CameraPose {
  const sp = smoothstep(T.fovSpeedLo, T.fovSpeedHi, speed);
  const back = (T.back + T.backAtSpeed * sp + T.dropBack * drop) * scale;
  const up = (T.up + T.dropRise * drop) * scale;
  const p = out.position;
  p.x = px - dirX * back;
  p.y = py + up;
  p.z = pz - dirZ * back;

  const ahead = T.lookAhead * scale + T.dropLookAhead * drop;
  const l = out.lookAt;
  l.x = px + dirX * ahead;
  l.z = pz + dirZ * ahead;
  l.y = py + T.lookUp * scale;
  if (drop > 1e-3) {
    // Tilt down toward the lowest ground just beyond the look point so the drop is in frame.
    let low = groundAt(terrain, l.x, l.z);
    for (let d = 12; d <= 36; d += 12) {
      const g = groundAt(terrain, l.x + dirX * d, l.z + dirZ * d);
      if (g < low) low = g;
    }
    l.y -= drop * Math.min(T.dropLookDown, Math.max(0, py - low) * 0.35);
  }

  out.fov = lerp(T.fovBase, T.fovFast, sp) + T.dropFov * drop;
  enforceClearance(terrain, p, px, py + T.lineTargetUp * scale, pz);
  return out;
}

/**
 * Instantaneous follow pose: behind the iceberg along its horizontal velocity (heading when slow),
 * above it, looking a little ahead. No smoothing — CameraController adds that.
 */
export function followPose(iceberg: IcebergState, terrain: Terrain, out: CameraPose): CameraPose {
  const yaw = followHeading(iceberg);
  // heading θ → (sin θ, cos θ)
  const dx = Math.sin(yaw);
  const dz = Math.cos(yaw);
  const drop = measureDrop(iceberg, dx, dz, terrain);
  const p = iceberg.pos;
  const speed = Math.hypot(iceberg.vel.x, iceberg.vel.z);
  return computeFollowTarget(p.x, p.y, p.z, dx, dz, speed, drop, terrain, out, followScale(iceberg.radius));
}

export const isFinitePose = (p: CameraPose): boolean =>
  Number.isFinite(p.position.x) &&
  Number.isFinite(p.position.y) &&
  Number.isFinite(p.position.z) &&
  Number.isFinite(p.lookAt.x) &&
  Number.isFinite(p.lookAt.y) &&
  Number.isFinite(p.lookAt.z) &&
  Number.isFinite(p.fov);
