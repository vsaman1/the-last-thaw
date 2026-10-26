import { clamp, dirToHeading, len2, wrapAngle } from './math';
import type { CourseFrame, IcebergState, LevelDef, SteeringInput, Terrain } from './types';

export interface AutopilotOptions {
  /**
   * Lateral offset (m, positive = right) to aim for: from the level's intended line (LevelDef.line)
   * when it has one, otherwise from the centreline. In 'path' pursuit it is measured square to the
   * line's own direction.
   */
  lane?: number;
  /** Proportional gain from heading error (rad) to steer. */
  gain?: number;
  /** Follow LevelDef.line when the level has one (default true); false aims from the centreline. */
  followLine?: boolean;
  /**
   * 'course': aim at the line LOOK_BASE + LOOK_PER_SPEED·v m of COURSE arc length ahead (≈ 40 m
   * at 24 m/s): it cuts bends and starts lateral moves early (the classic behaviour the six valley
   * levels were balanced with). 'path': pursue the line as a world-space path: the look-ahead is
   * measured along the line itself and shortened until the chord to the aim point cuts no corner
   * of the line by more than `cornerTolerance` m, so winding lines with big lateral offsets and
   * turns round diagonal ridges are followed closely. Default: 'path' on open-mountain levels
   * (LevelDef.relief set), else 'course'.
   */
  pursuit?: 'course' | 'path';
  /** 'path' pursuit: how far (m) the chord to the aim point may cut inside the line (default 3). */
  cornerTolerance?: number;
}

/** Look-ahead (m) = LOOK_BASE + LOOK_PER_SPEED × horizontal speed (m/s). */
export const LOOK_BASE = 18;
export const LOOK_PER_SPEED = 0.9;
/** 'path' pursuit never looks closer than this (m). */
const LOOK_MIN = 8;
/** Spacing (m of s) of the world-space path built from a line. */
const PATH_STEP = 2;

/**
 * Lateral offset d of a course line at arc length s: linear between points (listed in order of s),
 * held at the first/last point outside them; 0 without a line.
 */
export function lineOffsetAt(line: LevelDef['line'], s: number): number {
  if (!line || line.length === 0) return 0;
  let d = line[line.length - 1].d;
  if (s <= line[0].s) d = line[0].d;
  else {
    for (let i = 1; i < line.length; i++) {
      const b = line[i];
      if (s > b.s) continue;
      const a = line[i - 1];
      const span = b.s - a.s;
      d = span > 1e-9 ? a.d + ((b.d - a.d) * (s - a.s)) / span : b.d;
      break;
    }
  }
  return Number.isFinite(d) ? d : 0;
}

/** A line laid out in world space: points every PATH_STEP m of s, with world arc length. */
interface LinePath {
  x: Float64Array;
  z: Float64Array;
  s: Float64Array;
  arc: Float64Array;
}

/** Paths per course and line (terrains spread into copies keep the same course object). */
const pathCache = new WeakMap<CourseFrame, WeakMap<object, LinePath>>();

function linePath(course: CourseFrame, line: NonNullable<LevelDef['line']>): LinePath {
  let byLine = pathCache.get(course);
  if (!byLine) {
    byLine = new WeakMap();
    pathCache.set(course, byLine);
  }
  let p = byLine.get(line);
  if (p) return p;
  const s0 = line[0].s;
  const s1 = Math.max(course.length, line[line.length - 1].s);
  const n = Math.max(2, Math.ceil((s1 - s0) / PATH_STEP) + 1);
  p = { x: new Float64Array(n), z: new Float64Array(n), s: new Float64Array(n), arc: new Float64Array(n) };
  for (let i = 0; i < n; i++) {
    const s = Math.min(s1, s0 + i * PATH_STEP);
    const w = course.toWorld(s, lineOffsetAt(line, s));
    p.x[i] = w.x;
    p.z[i] = w.z;
    p.s[i] = s;
    if (i > 0) p.arc[i] = p.arc[i - 1] + Math.hypot(w.x - p.x[i - 1], w.z - p.z[i - 1]);
  }
  byLine.set(line, p);
  return p;
}

/** Where each iceberg last was on a path (vertex index), so the search stays local and in order. */
const progress = new WeakMap<IcebergState, { path: LinePath; i: number }>();

/** Nearest point of the path to (x, z) near vertex `from` (or near course arc length sHint). */
function nearestOnPath(
  p: LinePath,
  x: number,
  z: number,
  from: number,
  sHint: number,
): { i: number; t: number; dist: number } {
  const n = p.x.length;
  let lo: number;
  let hi: number;
  if (from >= 0) {
    lo = Math.max(0, from - 20);
    hi = Math.min(n - 2, from + 80);
  } else {
    lo = 0;
    hi = n - 2;
  }
  let best = { i: lo, t: 0, dist: Infinity };
  for (let i = lo; i <= hi; i++) {
    if (from < 0 && Math.abs(p.s[i] - sHint) > 120) continue;
    const ex = p.x[i + 1] - p.x[i];
    const ez = p.z[i + 1] - p.z[i];
    const l2 = ex * ex + ez * ez;
    const t = l2 > 0 ? clamp(((x - p.x[i]) * ex + (z - p.z[i]) * ez) / l2, 0, 1) : 0;
    const d = Math.hypot(p.x[i] + ex * t - x, p.z[i] + ez * t - z);
    if (d < best.dist) best = { i, t, dist: d };
  }
  return best;
}

/**
 * Aim point of 'path' pursuit (world x/z): LOOK_BASE + LOOK_PER_SPEED·v m along the line from the
 * nearest point, shortened (× 0.75 per try, not below LOOK_MIN) until the line between here and the
 * aim strays at most `tolerance` m from the straight chord to it.
 */
function pathAim(
  ice: IcebergState,
  terrain: Terrain,
  line: NonNullable<LevelDef['line']>,
  speed: number,
  lane: number,
  tolerance: number,
): { x: number; z: number } {
  const p = linePath(terrain.course, line);
  const n = p.x.length;
  const px = ice.pos.x;
  const pz = ice.pos.z;
  const mem = progress.get(ice);
  let near = nearestOnPath(p, px, pz, mem && mem.path === p ? mem.i : -1, 0);
  if (near.dist > 25 || !mem || mem.path !== p) {
    // Lost (teleported, knocked far off): search by course position instead.
    near = nearestOnPath(p, px, pz, -1, terrain.course.project(px, pz).s);
  }
  progress.set(ice, { path: p, i: near.i });
  const at = p.arc[near.i] + near.t * (p.arc[near.i + 1] - p.arc[near.i]);
  let look = LOOK_BASE + LOOK_PER_SPEED * speed;
  let ax = p.x[n - 1];
  let az = p.z[n - 1];
  let j = n - 1;
  for (let attempt = 0; attempt < 8; attempt++) {
    const target = at + look;
    j = near.i + 1;
    while (j < n - 1 && p.arc[j] < target) j++;
    const seg = p.arc[j] - p.arc[j - 1];
    const f = seg > 1e-9 ? clamp((target - p.arc[j - 1]) / seg, 0, 1) : 1;
    ax = p.x[j - 1] + (p.x[j] - p.x[j - 1]) * f;
    az = p.z[j - 1] + (p.z[j] - p.z[j - 1]) * f;
    // How far the line between here and the aim strays from the straight chord to it.
    const cx = ax - px;
    const cz = az - pz;
    const cl = Math.hypot(cx, cz);
    let worst = 0;
    if (cl > 1e-6) {
      for (let k = near.i + 1; k < j; k++) {
        const off = Math.abs((p.x[k] - px) * cz - (p.z[k] - pz) * cx) / cl;
        if (off > worst) worst = off;
      }
    }
    if (worst <= tolerance || look <= LOOK_MIN) break;
    look = Math.max(LOOK_MIN, look * 0.75);
  }
  if (lane !== 0) {
    const tx = p.x[j] - p.x[j - 1];
    const tz = p.z[j] - p.z[j - 1];
    const tl = Math.hypot(tx, tz) || 1;
    // Right of a direction (dx, dz) is (-dz, dx).
    ax += (-tz / tl) * lane;
    az += (tx / tl) * lane;
  }
  return { x: ax, z: az };
}

/**
 * Steers toward a point ahead on the level's line (or the centreline). Used by the headless
 * completion tests and the debug API; it is a legitimate "player" that only produces SteeringInput,
 * never touches game state. See AutopilotOptions.pursuit for how far ahead it aims.
 */
export function autopilotSteer(
  ice: IcebergState,
  terrain: Terrain,
  opts: AutopilotOptions = {},
): SteeringInput {
  const speed = len2(ice.vel.x, ice.vel.z);
  const line = opts.followLine === false ? undefined : terrain.level.line;
  const pursuit = opts.pursuit ?? (terrain.level.relief ? 'path' : 'course');
  let target: { x: number; z: number };
  if (pursuit === 'path' && line && line.length > 0) {
    target = pathAim(ice, terrain, line, speed, opts.lane ?? 0, opts.cornerTolerance ?? 3);
  } else {
    const { s } = terrain.course.project(ice.pos.x, ice.pos.z);
    const ahead = Math.min(terrain.course.length, s + LOOK_BASE + speed * LOOK_PER_SPEED);
    target = terrain.course.toWorld(ahead, lineOffsetAt(line, ahead) + (opts.lane ?? 0));
  }
  const want = dirToHeading(target.x - ice.pos.x, target.z - ice.pos.z);
  const have = speed > 0.5 ? dirToHeading(ice.vel.x, ice.vel.z) : ice.heading;
  // Positive steer turns right, which decreases heading.
  const steer = clamp(-wrapAngle(want - have) * (opts.gain ?? 2.2), -1, 1);
  return { steer, source: 'scripted' };
}
