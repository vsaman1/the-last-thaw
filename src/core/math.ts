import type { Vec2, Vec3 } from './types';

export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => (b === a ? 0 : (v - a) / (b - a));

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01(invLerp(edge0, edge1, x));
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential approach: move `current` toward `target` at `rate` (1/s). */
export const damp = (current: number, target: number, rate: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-rate * dt));

/** Wrap an angle to [-π, π). */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Damp an angle along the shortest arc. */
export const dampAngle = (current: number, target: number, rate: number, dt: number): number =>
  current + wrapAngle(target - current) * (1 - Math.exp(-rate * dt));

// --- heading convention (see types.ts) --------------------------------------------------------

/** Heading θ → unit horizontal direction (sin θ, cos θ). */
export const headingToDir = (heading: number): Vec2 => ({ x: Math.sin(heading), z: Math.cos(heading) });

/** Horizontal direction → heading θ. */
export const dirToHeading = (x: number, z: number): number => Math.atan2(x, z);

/** Unit vector to the right of a horizontal direction (when looking along it with +Y up). */
export const rightOf = (dirX: number, dirZ: number): Vec2 => ({ x: -dirZ, z: dirX });

/** Heading change for a steer input: positive steer turns right, which decreases θ. */
export const steerToYawDelta = (steer: number, yawRate: number, dt: number): number => -steer * yawRate * dt;

// --- small vector helpers (allocation-light) ----------------------------------------------------

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const len2 = (x: number, z: number): number => Math.hypot(x, z);
export const len3 = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);
export const dist2 = (ax: number, az: number, bx: number, bz: number): number => Math.hypot(bx - ax, bz - az);
