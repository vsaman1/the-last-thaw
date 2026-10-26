import type { KickerLip } from '../types';

/**
 * Kicker take-offs that do not depend on where a ramp's lip falls on the terrain grid.
 *
 * The grid only has vertices every cellSize, so the triangulated lip ends up to a cell diagonal
 * short of the authored one, lower and flatter (a chord of the face curve); left to the grid, fast
 * icebergs launched early off that truncated lip and slow ones slid off it without a jump. Instead,
 * over the last `before` metres of a kicker face (Terrain.kickers) an iceberg heading over the lip
 * rides the exact face (kickerFace: height and slope from the lip's profile, no early launch), and
 * the step that reaches the lip line takes off with the exact lip's take-off (kickerTakeoff).
 */

/**
 * Riding the exact face needs the velocity's component across the lip line to be at least this
 * share of the horizontal speed (≈ 53° off square at most). Running along a ramp or off its side
 * edge is left to the grid.
 */
export const KICKER_OVER_LIP = 0.6;
/** Slack (m) on KickerLip.drop when judging whether the iceberg is on the face at all. */
export const KICKER_DROP_SLACK = 0.3;
/**
 * Farthest (m) the exact face may lie under the grid's surface (the grid's chords of the convex face
 * lie a few cm above it): riding the exact face never takes the iceberg into the ground.
 */
export const KICKER_BELOW_GRID = 0.25;
/** Steepest exact face (rise/run, the sim's wall slope): anything steeper is no kicker face. */
export const KICKER_MAX_SLOPE = 1.2;

/** Where an iceberg rides a kicker's exact face (filled by kickerFace). */
export interface KickerFace {
  /** The kicker (Terrain.kickers element). */
  kicker: KickerLip | null;
  /** Lip height, face slope and curvature along the kicker's direction where the path meets the lip. */
  lipY: number;
  slope: number;
  curve: number;
  /** Cross slope of the exact surface there (rise per metre to the right of travel). */
  cross: number;
}

/** Interpolated profile value at sample position f (0 … n-1). */
function sample(values: readonly number[], f: number): number {
  const j = Math.min(Math.floor(f), values.length - 2);
  return values[j] + (values[j + 1] - values[j]) * (f - j);
}

/** Metres along a kicker's direction from its lip line (negative = short of it). */
export const alongLip = (k: KickerLip, x: number, z: number): number =>
  (x - k.x) * k.dirX + (z - k.z) * k.dirZ;

/** Height of the exact face at `along` (≤ 0) m from the lip, in the profile found by kickerFace. */
export const faceHeight = (f: KickerFace, along: number): number =>
  f.lipY + f.slope * along + 0.5 * f.curve * along * along;

/**
 * True (and `out` filled) when an iceberg at (x, z, y) moving (vx, vz) is on the last `before` m of a
 * kicker face, short of the lip line (never past it: the back face, the floor or a gap edge), heading
 * over the lip (KICKER_OVER_LIP) on a path that meets the lip line within the ramp's width (not off
 * a side edge), and no lower than the face can be there (KickerLip.drop + KICKER_DROP_SLACK).
 */
export function kickerFace(
  kickers: readonly KickerLip[],
  x: number,
  z: number,
  y: number,
  vx: number,
  vz: number,
  out: KickerFace,
): boolean {
  const speed = Math.hypot(vx, vz);
  if (!(speed > 1e-3)) return false;
  for (let i = 0; i < kickers.length; i++) {
    const k = kickers[i];
    const along = alongLip(k, x, z);
    if (!(along < 0) || along < -k.before) continue;
    const forward = vx * k.dirX + vz * k.dirZ;
    if (!(forward > 0) || forward < KICKER_OVER_LIP * speed) continue;
    // Right of travel is (-dirZ, dirX). Where the path meets the lip line:
    const sideways = vz * k.dirX - vx * k.dirZ;
    const across = (z - k.z) * k.dirX - (x - k.x) * k.dirZ + (sideways * -along) / forward;
    if (Math.abs(across) > k.halfWidth) continue;
    const f = Math.min(Math.max((across + k.halfWidth) / k.step, 0), k.height.length - 1);
    const lipY = sample(k.height, f);
    // NaN: no exact face there (KickerLip): the grid's face it is.
    if (!Number.isFinite(lipY)) continue;
    if (lipY - y > Math.max(sample(k.drop, f), 0) + KICKER_DROP_SLACK) continue;
    const slope = sample(k.slope, f);
    const curve = sample(k.curve, f);
    const here = slope + curve * along;
    if (!(Math.abs(slope) <= KICKER_MAX_SLOPE && Math.abs(here) <= KICKER_MAX_SLOPE)) continue;
    out.kicker = k;
    out.lipY = lipY;
    out.slope = slope;
    out.curve = curve;
    const j = Math.min(Math.floor(f), k.height.length - 2);
    out.cross = (k.height[j + 1] - k.height[j]) / k.step;
    return true;
  }
  return false;
}

/**
 * True when the exact face found by kickerFace, at `along` m from the lip, is not under the grid's
 * surface `gridY` at the same point (by more than KICKER_BELOW_GRID). It may be well above it: the
 * grid's triangles across the lip reach down to the back face, or into a ravine beyond the lip.
 * A face under the ground is not that face (a mis-fitted profile once put an iceberg 66 m under
 * the ground): ride the grid instead.
 */
export function faceOnGrid(face: KickerFace, along: number, gridY: number): boolean {
  return faceHeight(face, along) >= gridY - KICKER_BELOW_GRID;
}

/** Result of kickerTakeoff: vertical speed and the factor for the horizontal velocity. */
export interface KickerTakeoff {
  vy: number;
  scale: number;
}

/**
 * Take-off off the exact lip of `face` for a step that leaves the face from height y0 with
 * horizontal velocity (vx, vz). The step started up to one substep short of the lip, a little
 * lower than it: the horizontal speed is that after climbing the rest of the way, and the vertical
 * speed tops the flight out where the exact take-off's does (lip height + vy²/2g, vy from the lip's
 * slope and cross slope). Writes `out`; false when the take-off would not rise (the iceberg then
 * just follows the ground).
 */
export function kickerTakeoff(
  face: KickerFace,
  y0: number,
  vx: number,
  vz: number,
  gravity: number,
  out: KickerTakeoff,
): boolean {
  const k = face.kicker;
  if (!k) return false;
  const v2 = vx * vx + vz * vz;
  if (!(v2 > 1e-6)) return false;
  const left = v2 - (2 * gravity * (face.lipY - y0)) / (1 + face.slope * face.slope);
  const scale = left > 0 ? Math.min(Math.sqrt(left / v2), 1.1) : 0;
  const forward = vx * k.dirX + vz * k.dirZ;
  const sideways = vz * k.dirX - vx * k.dirZ;
  const vy = scale * (forward * face.slope + sideways * face.cross);
  if (!(vy > 0)) return false;
  const apex = face.lipY + (vy * vy) / (2 * gravity);
  out.vy = apex > y0 ? Math.sqrt(2 * gravity * (apex - y0)) : 0;
  out.scale = scale;
  return true;
}
