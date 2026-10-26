import type { CourseCoord, LevelDef, RoadSurface, TerrainFeature } from '../types';
import { coursePolyline, polylineDistance, type CoursePolyline, type PolylineHit } from './features';
import { themeOf } from './themes';

/**
 * The road network in course coordinates (living world): every road-like feature as a centreline
 * polyline, and the junctions where centrelines cross or meet. Shared by the terrain (streets level
 * to one height at their junctions), the traffic network (src/core/traffic/network.ts) and the
 * placement validator (vehicles stand on a road or a parking area, rail wagons on a track bed).
 *
 * - `road` (straight): along the course from (s0, d) to (s1, d); one shorter than it is wide
 *   (s1 − s0 < width) is a cross street ACROSS the course at the middle of s0..s1, from d − width/2
 *   to d + width/2, (s1 − s0) wide: the old "wide short strip" idiom becomes a real cross street.
 * - `street`: its points as given.
 * Junctions: centrelines that cross, and an end that meets another line (within its half-width +
 * ROAD_RULES.meetReach: a T, or an L where two ends meet). Candidates closer than mergeDistance
 * merge, so several streets through one point make one junction. Rail beds (surface 'rail') take
 * no part (no level crossings).
 */

export const ROAD_RULES = {
  /** Default speed limits (m/s) by surface. */
  asphaltSpeed: 12.5,
  gravelSpeed: 9,
  /** An end within (the other line's width / 2 + meetReach) m of another centreline joins it. */
  meetReach: 1.5,
  /** Junction candidates closer than this (m) merge into one. */
  mergeDistance: 6,
  /** A junction this close (m) to a line's end has no leg beyond that end. */
  legMin: 3,
} as const;

type Street = Extract<TerrainFeature, { type: 'street' }>;
type Parking = Extract<TerrainFeature, { type: 'parking' }>;

export interface RoadLine {
  /** Index into level.features. */
  readonly feature: number;
  readonly type: 'road' | 'street';
  readonly points: readonly CourseCoord[];
  readonly poly: CoursePolyline;
  readonly width: number;
  readonly surface: RoadSurface;
  /** Speed limit (m/s). */
  readonly speed: number;
  /** Street override for traffic lights at its junctions (undefined = automatic). */
  readonly signals: boolean | undefined;
  /** False: the line shapes no terrain (a street on a bridge deck or a dam crest). */
  readonly carve: boolean;
  /**
   * Laid by a road bridge along its deck (index into level.obstacles; feature is then -1): see
   * src/core/obstacles/bridges.ts.
   */
  readonly bridge?: number;
}

/** One line through a junction and where along it (course units of arc length). */
export interface JunctionMember {
  readonly line: number;
  readonly arc: number;
}

export interface RoadJunction {
  readonly s: number;
  readonly d: number;
  readonly at: readonly JunctionMember[];
}

/** True when a straight road runs across the course (shorter along s than it is wide). */
export const roadRunsAcross = (f: Extract<TerrainFeature, { type: 'road' }>): boolean =>
  f.s1 - f.s0 < f.width;

/** Every road-like feature of a level as a centreline, in feature order. */
export function roadLines(level: LevelDef): RoadLine[] {
  const theme = themeOf(level);
  const out: RoadLine[] = [];
  (level.features ?? []).forEach((f, feature) => {
    if (f.type === 'road') {
      const surface: RoadSurface = f.surface ?? theme.roadSurface;
      const across = roadRunsAcross(f);
      const mid = (f.s0 + f.s1) / 2;
      const points = across
        ? [
            { s: mid, d: f.d - f.width / 2 },
            { s: mid, d: f.d + f.width / 2 },
          ]
        : [
            { s: f.s0, d: f.d },
            { s: f.s1, d: f.d },
          ];
      out.push({
        feature,
        type: 'road',
        points,
        poly: coursePolyline(points),
        width: across ? f.s1 - f.s0 : f.width,
        surface,
        speed: speedFor(surface),
        signals: undefined,
        carve: true,
      });
    } else if (f.type === 'street') {
      const surface: RoadSurface = f.surface ?? theme.roadSurface;
      out.push({
        feature,
        type: 'street',
        points: f.points,
        poly: coursePolyline(f.points),
        width: f.width,
        surface,
        speed: f.speed ?? speedFor(surface),
        signals: f.signals,
        carve: f.carve !== false,
      });
    }
  });
  return out;
}

const speedFor = (surface: RoadSurface): number =>
  surface === 'asphalt' ? ROAD_RULES.asphaltSpeed : ROAD_RULES.gravelSpeed;

/** True for lines that carry road traffic (not rail beds). */
export const carriesTraffic = (l: RoadLine): boolean => l.surface !== 'rail';

interface Candidate {
  s: number;
  d: number;
  n: number;
  at: { line: number; arc: number; n: number }[];
}

const hit: PolylineHit = { arc: 0 };

/** Junctions of the traffic-carrying lines, sorted by s then d (deterministic). */
export function roadJunctions(lines: readonly RoadLine[]): RoadJunction[] {
  const cands: Candidate[] = [];
  const add = (s: number, d: number, members: { line: number; arc: number }[]): void => {
    cands.push({ s, d, n: 1, at: members.map((m) => ({ ...m, n: 1 })) });
  };
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i];
    if (!carriesTraffic(a)) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const b = lines[j];
      if (!carriesTraffic(b)) continue;
      crossings(a.poly, b.poly, (s, d, arcA, arcB) => {
        add(s, d, [
          { line: i, arc: arcA },
          { line: j, arc: arcB },
        ]);
      });
    }
  }
  // Ends that meet another line: T-junctions (and L-junctions where two ends meet).
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i];
    if (!carriesTraffic(a)) continue;
    const p = a.poly;
    const n = p.s.length;
    for (const end of [0, n - 1]) {
      const es = p.s[end];
      const ed = p.d[end];
      const arcA = p.arc[end];
      for (let j = 0; j < lines.length; j++) {
        const b = lines[j];
        if (j === i || !carriesTraffic(b)) continue;
        const dist = polylineDistance(b.poly, es, ed, hit);
        if (dist > b.width / 2 + ROAD_RULES.meetReach) continue;
        const arcB = hit.arc;
        const k = locate(b.poly, arcB);
        add(k.s, k.d, [
          { line: i, arc: arcA },
          { line: j, arc: arcB },
        ]);
      }
    }
  }
  // Merge candidates (single linkage within mergeDistance), averaging positions and arcs.
  const merged: Candidate[] = [];
  for (const c of cands) {
    const into = merged.find((m) => Math.hypot(m.s / m.n - c.s, m.d / m.n - c.d) < ROAD_RULES.mergeDistance);
    if (!into) {
      merged.push({ ...c, at: c.at.map((m) => ({ ...m })) });
      continue;
    }
    into.s += c.s;
    into.d += c.d;
    into.n++;
    for (const m of c.at) {
      const same = into.at.find((x) => x.line === m.line);
      if (same) {
        same.arc += m.arc;
        same.n++;
      } else into.at.push({ ...m });
    }
  }
  return merged
    .map((m) => ({
      s: m.s / m.n,
      d: m.d / m.n,
      at: m.at
        .map((x) => ({ line: x.line, arc: x.arc / x.n }))
        .sort((p, q) => p.line - q.line),
    }))
    .sort((p, q) => p.s - q.s || p.d - q.d);
}

/** Point (s, d) at arc length `arc` along a polyline (clamped to its ends). */
export function locate(p: CoursePolyline, arc: number): { s: number; d: number; ts: number; td: number } {
  const n = p.s.length;
  if (n === 1) return { s: p.s[0], d: p.d[0], ts: 1, td: 0 };
  let i = 0;
  while (i + 2 < n && p.arc[i + 1] < arc) i++;
  const l = p.arc[i + 1] - p.arc[i];
  const t = l > 0 ? Math.min(1, Math.max(0, (arc - p.arc[i]) / l)) : 0;
  const es = p.s[i + 1] - p.s[i];
  const ed = p.d[i + 1] - p.d[i];
  const el = Math.hypot(es, ed) || 1;
  return { s: p.s[i] + es * t, d: p.d[i] + ed * t, ts: es / el, td: ed / el };
}

/** Calls `fn` for every proper crossing of two polylines (segment interiors and shared points). */
function crossings(
  a: CoursePolyline,
  b: CoursePolyline,
  fn: (s: number, d: number, arcA: number, arcB: number) => void,
): void {
  for (let i = 0; i + 1 < a.s.length; i++) {
    const as = a.s[i];
    const ad = a.d[i];
    const es = a.s[i + 1] - as;
    const ed = a.d[i + 1] - ad;
    for (let j = 0; j + 1 < b.s.length; j++) {
      const bs = b.s[j];
      const bd = b.d[j];
      const fs = b.s[j + 1] - bs;
      const fd = b.d[j + 1] - bd;
      const den = es * fd - ed * fs;
      if (Math.abs(den) < 1e-9) continue;
      const qs = bs - as;
      const qd = bd - ad;
      const t = (qs * fd - qd * fs) / den;
      const u = (qs * ed - qd * es) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      fn(
        as + es * t,
        ad + ed * t,
        a.arc[i] + t * (a.arc[i + 1] - a.arc[i]),
        b.arc[j] + u * (b.arc[j + 1] - b.arc[j]),
      );
    }
  }
}

/** Index (into `lines`) of a line whose paved strip holds (s, d) (within width/2 + margin), or -1. */
export function roadLineAt(lines: readonly RoadLine[], s: number, d: number, margin = 0): number {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const r = l.width / 2 + margin;
    const p = l.poly;
    if (s < p.s0 - r || s > p.s1 + r || d < p.d0 - r || d > p.d1 + r) continue;
    if (polylineDistance(p, s, d, hit) <= r) return i;
  }
  return -1;
}

/** A parking rectangle's local coordinates of (s, d): `a` along its length, `b` across. */
export function parkingLocal(f: Parking, s: number, d: number): { a: number; b: number } {
  const yaw = f.yaw ?? 0;
  // Structure-yaw convention: local +z at yaw is (cos yaw, −sin yaw) in (s, d).
  const us = Math.cos(yaw);
  const ud = -Math.sin(yaw);
  const ds = s - f.s;
  const dd = d - f.d;
  return { a: ds * us + dd * ud, b: -ds * ud + dd * us };
}

/** True if (s, d) lies on the parking area grown by `margin` (m). */
export function parkingContains(f: Parking, s: number, d: number, margin = 0): boolean {
  const { a, b } = parkingLocal(f, s, d);
  return Math.abs(a) <= f.length / 2 + margin && Math.abs(b) <= f.width / 2 + margin;
}

/** Index into level.features of a parking area holding (s, d) (grown by margin), or -1. */
export function parkingAt(level: LevelDef, s: number, d: number, margin = 0): number {
  const list = level.features ?? [];
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (f.type === 'parking' && parkingContains(f, s, d, margin)) return i;
  }
  return -1;
}

export type { Parking, Street };
