import type { CourseCoord, ObstaclePlacement, Terrain, TerrainFeature } from '../types';
import { polylineOf } from '../terrain/features';

/**
 * Where a dam placement crosses a stream, in course coordinates (both the dam's axis and the
 * stream's polyline are laid out in (s, d) like every polyline feature). Used by the placement check
 * (./validate.ts) and to build the dam's reservoir (./reservoir.ts).
 */

type Stream = Extract<TerrainFeature, { type: 'stream' }>;

/** A dam's axis: centre, unit direction (ds, dd per metre) and half its span (m). */
export interface DamAxis {
  s: number;
  d: number;
  us: number;
  ud: number;
  half: number;
}

export interface DamCrossing {
  /** Index of the stream in level.features. */
  feature: number;
  /** Arc length along the stream (m from its source) and along the dam's axis (m from its centre). */
  arc: number;
  t: number;
  /** sin of the angle between the dam's axis and the stream (1 = square across it). */
  sin: number;
  /** Span the channel needs each side of the crossing (its half top width / sin), and what the dam has. */
  need: number;
  left: number;
  right: number;
}

/** Span (m) of a spanning placement: its `span`, or the floor width at its s (like placementSpan). */
export function damSpan(terrain: Terrain, p: ObstaclePlacement): number {
  const L = terrain.course.length;
  return p.span ?? 2 * terrain.course.sampleAt(Math.min(Math.max(p.s, 0), L)).halfWidth;
}

/** A dam placement's axis: at yaw 0 it runs across the course (along d). */
export function damAxis(terrain: Terrain, p: ObstaclePlacement): DamAxis {
  const yaw = p.yaw ?? 0;
  return { s: p.s, d: p.d, us: Math.sin(yaw), ud: Math.cos(yaw), half: damSpan(terrain, p) / 2 };
}

/** The axis end points in course coordinates. */
export function damEnds(a: DamAxis): [CourseCoord, CourseCoord] {
  return [
    { s: a.s - a.us * a.half, d: a.d - a.ud * a.half },
    { s: a.s + a.us * a.half, d: a.d + a.ud * a.half },
  ];
}

/**
 * Every crossing of the dam's axis with the polyline of stream `f` (feature index `feature`), in
 * order along the stream. The axis is extended by `reach` m at both ends (to report a dam that stops
 * short of a channel it was meant to close).
 */
export function streamCrossings(a: DamAxis, f: Stream, feature: number, reach = 0): DamCrossing[] {
  const p = polylineOf(f);
  const out: DamCrossing[] = [];
  const h = a.half + reach;
  const as0 = a.s - a.us * h;
  const ad0 = a.d - a.ud * h;
  const es = 2 * h * a.us;
  const ed = 2 * h * a.ud;
  const half = f.width / 2;
  for (let i = 0; i + 1 < p.s.length; i++) {
    const bs = p.s[i];
    const bd = p.d[i];
    const fs = p.s[i + 1] - bs;
    const fd = p.d[i + 1] - bd;
    const den = es * fd - ed * fs;
    if (Math.abs(den) < 1e-9) continue;
    // Solve a0 + e·u = b + f·v for u, v in [0, 1].
    const u = ((bs - as0) * fd - (bd - ad0) * fs) / den;
    const v = ((bs - as0) * ed - (bd - ad0) * es) / den;
    if (u < 0 || u > 1 || v < 0 || v > 1) continue;
    const segLen = Math.hypot(fs, fd);
    const sin = Math.abs(den) / (2 * h * segLen);
    const t = u * 2 * h - h;
    const need = half / Math.max(sin, 1e-3);
    out.push({ feature, arc: p.arc[i] + v * segLen, t, sin, need, left: t + a.half, right: a.half - t });
  }
  return out.sort((x, y) => x.arc - y.arc);
}

/** True when the crossing closes the channel from bank to bank (tolerance `tol` m each side). */
export const spansChannel = (c: DamCrossing, tol = 0.5): boolean =>
  c.left >= c.need - tol && c.right >= c.need - tol;

/** Smallest |sin| of the angle between a dam and a stream it may cross (≈ 30°). */
export const MIN_DAM_SIN = 0.5;

/**
 * The stream crossing a dam holds back: the first crossing (over all streams) that spans the
 * channel bank to bank at a proper angle, or null.
 */
export function damStream(terrain: Terrain, p: ObstaclePlacement): DamCrossing | null {
  const features = terrain.level.features ?? [];
  const a = damAxis(terrain, p);
  let best: DamCrossing | null = null;
  features.forEach((f, index) => {
    if (f.type !== 'stream' || best) return;
    for (const c of streamCrossings(a, f, index)) {
      if (c.sin >= MIN_DAM_SIN && spansChannel(c)) {
        best = c;
        break;
      }
    }
  });
  return best;
}
