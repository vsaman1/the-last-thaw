import type { CourseCoord, LevelDef, TerrainFeature } from '../types';
import { clamp, smoothstep } from '../math';
import { ridged2 } from '../rng';
import type { CourseGeometry } from './course';
import { parkingContains, parkingLocal, roadJunctions, roadLines } from './roads';
import type { ThemeDef } from './themes';
import {
  descendingProfile,
  profileAt,
  springPoolLevels,
  springPoolRadius,
  springPoolSection,
  STREAM_SHAPE,
  streamAlong,
  streamReach,
  streamSection,
  type SpringPoolLevels,
  type StreamProfile,
} from './stream';

/**
 * Terrain features (islands, hills, basins, ramps, gaps, plateaus, roads, ridges, gullies, ravines)
 * evaluated per grid vertex in course coordinates on top of the valley height function.
 *
 * Shapes (s along the course, d lateral; positive d = right of travel):
 * - hill / basin: (1 − q²)² bump of `height` / `depth`, q = distance from (s, d) / radius. Smooth.
 * - ramp: kicker over [s − length, s] rising as t² to `height` (lip slope 2·height/length), then
 *   a back face steeper than any grid cell, so the lip launches jumps; crisp side edges.
 * - gap: ravine over [s, s + length] (`s` = take-off edge), `depth` below the local ground with
 *   near-vertical walls; omitted width = across the whole floor (cut a little into the wall foot).
 * - island: pill-shaped rocky ridge over [s0, s1] with sheer walls and a craggy top.
 * - plateau: raised shelf over [s0, s1], flat across and following the valley descent, with
 *   driveable end ramps and steeper (rocky) side edges.
 * - road: levelled strip over [s0, s1] (flat across, smooth along, tapered at the ends) plus a level
 *   shoulder, banked into the surrounding ground; works on the floor or as a terrace cut into a wall.
 * Polyline features take `points` (course coordinates, used as flat (s, d) coordinates: exact on
 * straight courses, stretched by 1 − κ·d on bends) and a `width`; q = distance to the polyline /
 * (width / 2), so their ends are round:
 * - ridge: 'wall' profile = an island along the line (sheer, craggy); 'mound' = (1 − q²)² bank.
 * - gully: (1 − q²)² groove `depth` deep; fades in over max(width, 5·depth) from its first point
 *   and out over the same distance before its last point unless `closed`.
 * - ravine: a gap along the line: `depth` below the local ground, near-vertical walls.
 * - stream: a river channel cut down to a bed that follows the ground under the line and never
 *   rises downstream (./stream.ts); the ground is only ever lowered to it. A 'cave' source adds
 *   its round spring pool around the first point.
 * Living world (see ./roads.ts):
 * - street: a road along its polyline: level along it (smoothed profile), flat across, with the
 *   road's shoulder and bank; round ends; at junctions every street meeting there is levelled to
 *   one height (a straight road's own height where one crosses it). carve: false shapes nothing.
 * - parking: a levelled rectangle (profile along its length, flat across) with shoulder and bank.
 * Fatal cuts (gaps and ravines unless fatal: false) also report how far they lowered each vertex
 * (FeatureField.cut), which the session uses to end a run that falls in. They never cut a ramp's
 * face (up to its lip): a lip at, or a little past, a ravine's edge keeps its whole face.
 *
 * Every shape contributes exactly 0 outside its footprint, so featureless terrain is unchanged;
 * only the floor bumps and relief fade out toward ramps, plateaus and roads (begin(): over
 * rampClear m around a ramp, so its toe meets the ground without a step).
 */

export const PAINT = { none: 0, asphalt: 1, gravel: 2, dirt: 3, rock: 4 } as const;
export type PaintCode = (typeof PAINT)[keyof typeof PAINT];

export const FEATURE_TUNING = {
  /** Horizontal run (m) of island walls; share of the island height that is sheer wall. */
  islandWallRun: 0.8,
  islandWallShare: 0.85,
  /** Craggy height variation of island tops (fraction) and its noise scale (m). */
  islandRough: 0.25,
  islandNoiseScale: 6,
  /** Run (m) of a ramp's back face, and the range of its side-edge run (m). */
  rampBackRun: 0.6,
  rampEdgeMin: 0.8,
  rampEdgeMax: 2,
  /**
   * Floor bumps and relief are gone under a ramp (face, back face and side edges) and fade back in
   * over this distance (m) around it, so a ramp keeps its authored shape and its toe meets the
   * ground without a step (they used to stop dead at the toe: a ~0.5 m step on a relief slope).
   */
  rampClear: 30,
  /** Run (m) of gap walls; full-width gaps cut this far past the floor edge. */
  gapWallRun: 0.6,
  gapBeyondFloor: 2,
  /** Scree roughness (m) on gap bottoms. */
  gapScree: 0.3,
  /** Steepest slope of plateau end ramps and side edges (relative to the floor). */
  plateauRampSlope: 0.3,
  plateauEdgeSlope: 0.9,
  /**
   * Roads stay level this far (m) past the paved edge, so the grid vertex just outside the edge is
   * flat too and the paved strip reads flat across at any cellSize up to 2 × this.
   */
  roadShoulder: 1.25,
  /** Road bank run beyond the shoulder: base + per metre of cut/fill, capped (m). */
  roadBank: 2.5,
  roadBankPerMetre: 0.6,
  roadBankMax: 12,
  /** Roads blend into the ground over this distance beyond s0/s1 (m). */
  roadTaper: 8,
  /** Road level profile: sample spacing and moving-average half-window (m). */
  roadStep: 2,
  roadSmooth: 8,
  /** Streets at a junction blend to its common height over this distance (m) past their width. */
  junctionBlend: 10,
} as const;

const F = FEATURE_TUNING;

/** Application order: additive shapes, then levelling, then kickers, ridges and cuts on top. */
const ORDER: Record<TerrainFeature['type'], number> = {
  hill: 0,
  basin: 1,
  gully: 2,
  plateau: 3,
  road: 4,
  ramp: 5,
  island: 6,
  ridge: 7,
  stream: 8,
  gap: 9,
  ravine: 10,
  // Living world: levelled like roads.
  street: 4,
  parking: 4,
};

type Road = Extract<TerrainFeature, { type: 'road' }>;
type Street = Extract<TerrainFeature, { type: 'street' }>;
type Parking = Extract<TerrainFeature, { type: 'parking' }>;

/** How far (m) beyond a street's or parking area's paved edge its levelling can reach. */
const streetReach = (): number => F.roadShoulder + F.roadBankMax;
type PolyFeature = Extract<TerrainFeature, { points: CourseCoord[] }>;

/** The natural polyline features (ridge, gully, ravine, stream); streets are the living world's. */
type NaturalPoly = Extract<TerrainFeature, { type: 'ridge' | 'gully' | 'ravine' | 'stream' }>;

/** True for the features drawn along a polyline of course points (ridge, gully, ravine, stream). */
export const isPolyFeature = (f: TerrainFeature): f is NaturalPoly =>
  f.type === 'ridge' || f.type === 'gully' || f.type === 'ravine' || f.type === 'stream';

/** Half the lateral extent (m) a polyline feature changes the ground over (a stream's outer cut too). */
const polyReach = (f: NaturalPoly): number => (f.type === 'stream' ? streamReach(f) : f.width / 2);

/** True for features whose floor ends the run (gaps and ravines unless fatal: false). */
export const isFatalCut = (f: TerrainFeature): boolean =>
  (f.type === 'gap' || f.type === 'ravine') && f.fatal !== false;

/** Distance (m) over which a gully opens at its first point (and closes at an open last point). */
export const gullyTaper = (f: Extract<TerrainFeature, { type: 'gully' }>): number =>
  Math.max(f.width, 5 * f.depth);

/** A polyline in (s, d), precomputed for nearest-point queries. */
export interface CoursePolyline {
  readonly s: Float64Array;
  readonly d: Float64Array;
  /** Cumulative arc length at each point. */
  readonly arc: Float64Array;
  readonly length: number;
  /** Bounding box of the points. */
  readonly s0: number;
  readonly s1: number;
  readonly d0: number;
  readonly d1: number;
}

export function coursePolyline(points: readonly CourseCoord[]): CoursePolyline {
  const n = Math.max(1, points.length);
  const s = new Float64Array(n);
  const d = new Float64Array(n);
  const arc = new Float64Array(n);
  let s0 = Infinity;
  let s1 = -Infinity;
  let d0 = Infinity;
  let d1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = points[Math.min(i, points.length - 1)] ?? { s: 0, d: 0 };
    s[i] = p.s;
    d[i] = p.d;
    if (i > 0) arc[i] = arc[i - 1] + Math.hypot(s[i] - s[i - 1], d[i] - d[i - 1]);
    s0 = Math.min(s0, p.s);
    s1 = Math.max(s1, p.s);
    d0 = Math.min(d0, p.d);
    d1 = Math.max(d1, p.d);
  }
  return { s, d, arc, length: arc[n - 1], s0, s1, d0, d1 };
}

/** Result of polylineDistance: arc length along the polyline of the nearest point. */
export interface PolylineHit {
  arc: number;
}

const hitScratch: PolylineHit = { arc: 0 };

/** Distance from (s, d) to the polyline (round ends); writes the nearest point's arc into `out`. */
export function polylineDistance(
  p: CoursePolyline,
  s: number,
  d: number,
  out: PolylineHit = hitScratch,
): number {
  const n = p.s.length;
  if (n === 1) {
    out.arc = 0;
    return Math.hypot(s - p.s[0], d - p.d[0]);
  }
  let best = Infinity;
  let arc = 0;
  for (let i = 0; i + 1 < n; i++) {
    const as = p.s[i];
    const ad = p.d[i];
    const es = p.s[i + 1] - as;
    const ed = p.d[i + 1] - ad;
    const l2 = es * es + ed * ed;
    let t = l2 > 0 ? ((s - as) * es + (d - ad) * ed) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qs = as + es * t - s;
    const qd = ad + ed * t - d;
    const d2 = qs * qs + qd * qd;
    if (d2 < best) {
      best = d2;
      arc = p.arc[i] + t * (p.arc[i + 1] - p.arc[i]);
    }
  }
  out.arc = arc;
  return Math.sqrt(best);
}

/** Polylines per feature object, so validators can ask featureContains repeatedly without rebuilding. */
const polyCache = new WeakMap<object, CoursePolyline>();

/** The cached polyline of a polyline feature. */
export function polylineOf(f: PolyFeature): CoursePolyline {
  let p = polyCache.get(f);
  if (!p) {
    p = coursePolyline(f.points);
    polyCache.set(f, p);
  }
  return p;
}

/** End-ramp run (m) of a plateau of this height. */
export const plateauRampRun = (height: number): number => (1.5 * height) / F.plateauRampSlope;
/** Side-edge run (m) of a plateau of this height. */
export const plateauEdgeRun = (height: number): number => Math.max(1, (1.5 * height) / F.plateauEdgeSlope);
const rampEdgeRun = (height: number): number => clamp(0.5 * height, F.rampEdgeMin, F.rampEdgeMax);
const islandNose = (s0: number, s1: number, width: number): number =>
  Math.min((s1 - s0) / 2, Math.max(width, 6));

/** Island half-width at arc length s (0 outside [s0, s1]); noses are quarter circles in plan. */
function islandHalfWidth(f: Extract<TerrainFeature, { type: 'island' }>, s: number): number {
  const along = Math.min(s - f.s0, f.s1 - s);
  if (along <= 0) return 0;
  const e = Math.min(1, along / islandNose(f.s0, f.s1, f.width));
  return (f.width / 2) * Math.sqrt(1 - (1 - e) * (1 - e));
}

/** Arc-length range where a feature can change the terrain. */
export function featureSRange(f: TerrainFeature): { s0: number; s1: number } {
  switch (f.type) {
    case 'hill':
    case 'basin':
      return { s0: f.s - f.radius, s1: f.s + f.radius };
    case 'ramp':
      return { s0: f.s - f.length, s1: f.s + F.rampBackRun };
    case 'gap':
      return { s0: f.s, s1: f.s + f.length };
    case 'island':
    case 'plateau':
      return { s0: f.s0, s1: f.s1 };
    case 'road':
      return { s0: f.s0 - F.roadTaper, s1: f.s1 + F.roadTaper };
    case 'ridge':
    case 'gully':
    case 'ravine':
    case 'stream': {
      const p = polylineOf(f);
      const r = polyReach(f);
      return { s0: p.s0 - r, s1: p.s1 + r };
    }
    case 'street': {
      const p = polylineOf(f);
      const r = f.width / 2 + (f.carve === false ? 0 : streetReach());
      return { s0: p.s0 - r, s1: p.s1 + r };
    }
    case 'parking': {
      const r = parkingRadius(f) + streetReach();
      return { s0: f.s - r, s1: f.s + r };
    }
  }
}

/** Half the diagonal of a parking area: it lies within this distance (m) of its centre. */
const parkingRadius = (f: Parking): number => Math.hypot(f.length, f.width) / 2;

/**
 * Arc-length spans of a level where features may break the plain-valley guarantees (e.g. the
 * centreline descending), each widened by `margin`.
 */
export function featureSpans(
  level: LevelDef,
  margin = 0,
): { index: number; type: TerrainFeature['type']; s0: number; s1: number }[] {
  return (level.features ?? []).map((f, index) => {
    const r = featureSRange(f);
    return { index, type: f.type, s0: r.s0 - margin, s1: r.s1 + margin };
  });
}

/**
 * True if the course point (s, d) lies on the feature's footprint grown by `margin` (m): the paved
 * strip of a road, the face of a ramp, the cut of a gap, the plan of an island/plateau, the disc
 * of a hill/basin. `hw` = floor half-width at s (full-width gaps follow the floor).
 */
export function featureContains(f: TerrainFeature, s: number, d: number, hw: number, margin = 0): boolean {
  switch (f.type) {
    case 'hill':
    case 'basin':
      return Math.hypot(s - f.s, d - f.d) <= f.radius + margin;
    case 'ramp':
      return s >= f.s - f.length - margin && s <= f.s + margin && Math.abs(d - f.d) <= f.width / 2 + margin;
    case 'gap': {
      if (s < f.s - margin || s > f.s + f.length + margin) return false;
      if (f.width === undefined) return Math.abs(d) <= hw + F.gapBeyondFloor + margin;
      return Math.abs(d - (f.d ?? 0)) <= f.width / 2 + margin;
    }
    case 'island': {
      if (s < f.s0 - margin || s > f.s1 + margin) return false;
      return Math.abs(d - f.d) <= islandHalfWidth(f, s) + margin;
    }
    case 'plateau':
    case 'road':
      return s >= f.s0 - margin && s <= f.s1 + margin && Math.abs(d - f.d) <= f.width / 2 + margin;
    case 'stream': {
      // A cave spring's pool is part of the stream's water.
      const pool = springPoolRadius(f);
      const p0 = f.points[0];
      if (pool > 0 && p0 && Math.hypot(s - p0.s, d - p0.d) <= pool + margin) return true;
      const p = polylineOf(f);
      const r = f.width / 2 + margin;
      if (s < p.s0 - r || s > p.s1 + r || d < p.d0 - r || d > p.d1 + r) return false;
      return polylineDistance(p, s, d) <= r;
    }
    case 'ridge':
    case 'gully':
    case 'ravine':
    case 'street': {
      const p = polylineOf(f);
      const r = f.width / 2 + margin;
      if (s < p.s0 - r || s > p.s1 + r || d < p.d0 - r || d > p.d1 + r) return false;
      return polylineDistance(p, s, d) <= r;
    }
    case 'parking':
      return parkingContains(f, s, d, margin);
  }
}

/** Lateral offset of a gap's centre and its half-width at a floor half-width `hw`. */
export function gapLateral(
  f: Extract<TerrainFeature, { type: 'gap' }>,
  hw: number,
): { d: number; half: number } {
  return f.width === undefined ? { d: 0, half: hw + F.gapBeyondFloor } : { d: f.d ?? 0, half: f.width / 2 };
}

/**
 * Ballistic estimate of a jump off a ramp lip at horizontal `speed` (m/s, at the lip) over floor
 * that keeps descending at `floorSlope`: the take-off climbs at (2·height/length − floorSlope)
 * relative to level ground, like the iceberg integrator's launch. `distance` = horizontal metres
 * from the lip to touching the continued floor again.
 */
export function rampLaunch(
  ramp: Extract<TerrainFeature, { type: 'ramp' }>,
  speed: number,
  floorSlope: number,
  gravity = 9.81,
): { distance: number; time: number; vy: number } {
  const lipSlope = (2 * ramp.height) / ramp.length;
  const vy = speed * (lipSlope - floorSlope);
  // Height above the continued floor: H + v·lipSlope·t − g t²/2 = 0.
  const b = speed * lipSlope;
  const time = (b + Math.sqrt(b * b + 2 * gravity * ramp.height)) / gravity;
  return { distance: speed * time, time, vy };
}

/** Surface of a road feature in a theme (rail track beds are gravel ballast). */
export const roadPaint = (f: Road | Street | Parking, theme: ThemeDef): PaintCode =>
  (f.surface ?? theme.roadSurface) === 'asphalt' ? PAINT.asphalt : PAINT.gravel;

/** Paint a feature leaves on its footprint: roads paved, kickers bare earth, ridges and ravines rock. */
function featurePaint(f: TerrainFeature, theme: ThemeDef): PaintCode {
  switch (f.type) {
    case 'road':
    case 'parking':
      return roadPaint(f, theme);
    case 'street':
      return f.carve === false ? PAINT.none : roadPaint(f, theme);
    case 'ramp':
      return PAINT.dirt;
    case 'island':
    case 'gap':
    case 'ravine':
      return PAINT.rock;
    case 'ridge':
      return f.profile === 'mound' ? PAINT.none : PAINT.rock;
    default:
      return PAINT.none;
  }
}

interface Compiled {
  f: TerrainFeature;
  s0: number;
  s1: number;
  /** Lateral cull range (−/+Infinity for full-width gaps). */
  d0: number;
  d1: number;
  /** How far (m) beyond the cull range the feature still fades bumps and relief (ramps only). */
  clear: number;
  /** Road only: level profile sampled every roadStep from s0. */
  profile: Float64Array | null;
  /** Polyline features only. */
  poly: CoursePolyline | null;
  /** Stream only: its bed profile (see ./stream.ts), sampled in prepare(). */
  stream: StreamProfile | null;
  /** 'cave' stream only: its spring pool (from the profile, in prepare()). */
  pool: SpringPoolLevels | null;
  paint: PaintCode;
  fatal: boolean;
}

/**
 * Per-vertex feature evaluation, allocation-free. Usage per vertex: begin() (after projecting the
 * vertex; returns the multiplier for small floor bumps), then finish() on the valley height.
 */
export class FeatureField {
  readonly features: readonly TerrainFeature[];
  /**
   * Outputs of the last finish(): paint code, adjusted wallness, and how far fatal cuts (gaps and
   * ravines) lowered the vertex (m, 0 outside them).
   */
  paint: PaintCode = PAINT.none;
  wallness = 0;
  cut = 0;
  /** True when the level has fatal cuts (terrains only keep a cut array then). */
  readonly hasFatal: boolean;

  private readonly list: Compiled[];
  private readonly act: Int32Array;
  private actN = 0;
  private sExt = 0;
  private d = 0;
  private hw = 1;

  constructor(
    level: LevelDef,
    private readonly seed: number,
    theme: ThemeDef,
    /** Valley floor on the centreline (after cliffs and coast shaping). */
    private readonly floorAt: (s: number) => number,
    /** Height of the floor bowl at relative lateral position |d|/hw = 1. */
    private readonly bowlRise: number,
  ) {
    this.features = level.features ?? [];
    this.list = this.features
      .map((f): Compiled => {
        const r = featureSRange(f);
        let d0 = -Infinity;
        let d1 = Infinity;
        if (f.type === 'hill' || f.type === 'basin') {
          d0 = f.d - f.radius;
          d1 = f.d + f.radius;
        } else if (f.type === 'ramp' || f.type === 'island' || f.type === 'plateau') {
          d0 = f.d - f.width / 2;
          d1 = f.d + f.width / 2;
        } else if (f.type === 'road') {
          d0 = f.d - f.width / 2 - F.roadShoulder - F.roadBankMax;
          d1 = f.d + f.width / 2 + F.roadShoulder + F.roadBankMax;
        } else if (isPolyFeature(f)) {
          const p = polylineOf(f);
          d0 = p.d0 - polyReach(f);
          d1 = p.d1 + polyReach(f);
        } else if (f.type === 'street') {
          const p = polylineOf(f);
          const reach = f.width / 2 + streetReach();
          d0 = p.d0 - reach;
          d1 = p.d1 + reach;
        } else if (f.type === 'parking') {
          const reach = parkingRadius(f) + streetReach();
          d0 = f.d - reach;
          d1 = f.d + reach;
        } else if (f.width !== undefined) {
          d0 = (f.d ?? 0) - f.width / 2;
          d1 = (f.d ?? 0) + f.width / 2;
        }
        const poly = isPolyFeature(f) || f.type === 'street' ? polylineOf(f) : null;
        const paint = featurePaint(f, theme);
        const fatal = isFatalCut(f);
        const clear = f.type === 'ramp' ? F.rampClear : 0;
        return {
          f,
          s0: r.s0,
          s1: r.s1,
          d0,
          d1,
          clear,
          profile: null,
          poly,
          stream: null,
          pool: null,
          paint,
          fatal,
        };
      })
      .sort((a, b) => ORDER[a.f.type] - ORDER[b.f.type]);
    this.act = new Int32Array(this.list.length);
    this.hasFatal = this.list.some((c) => c.fatal);
  }

  get count(): number {
    return this.list.length;
  }

  /**
   * Samples each road's level from `base` (the valley height without features) along its centre
   * line and smooths it. Call once before the grid is built.
   */
  prepare(geo: CourseGeometry, base: (x: number, z: number) => number): void {
    const frame = { x: 0, z: 0, dirX: 0, dirZ: 1 };
    const L = geo.length;
    for (const c of this.list) {
      if (c.f.type === 'stream' && c.poly) {
        c.stream = this.streamProfile(c, geo, base);
        c.pool = springPoolLevels(c.f, c.stream);
      }
      if (c.f.type === 'street' || c.f.type === 'parking') {
        if (c.f.type === 'parking' || c.f.carve !== false) c.profile = streetProfile(c.f, geo, base);
        continue;
      }
      if (c.f.type !== 'road') continue;
      const n = Math.max(2, Math.ceil((c.s1 - c.s0) / F.roadStep) + 1);
      const raw = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const s = c.s0 + i * F.roadStep;
        geo.frameAt(s, frame);
        const extra = s < 0 ? s : s > L ? s - L : 0;
        const x = frame.x + frame.dirX * extra - frame.dirZ * c.f.d;
        const z = frame.z + frame.dirZ * extra + frame.dirX * c.f.d;
        raw[i] = base(x, z);
      }
      c.profile = smoothProfile(raw);
    }
    this.levelJunctions();
  }

  /**
   * Streets meeting at a junction take one height there (a straight road's own height where one
   * crosses it, else their mean), blended back into their own profiles over junctionBlend m. Straight
   * roads are never changed.
   */
  private levelJunctions(): void {
    const streets = this.list.filter((c) => c.f.type === 'street' && c.profile);
    if (streets.length === 0) return;
    const level = { features: this.features } as LevelDef;
    const lines = roadLines(level);
    const byFeature = new Map<TerrainFeature, Compiled>(this.list.map((c) => [c.f, c]));
    for (const j of roadJunctions(lines)) {
      const roads: number[] = [];
      const own: { c: Compiled; arc: number; v: number }[] = [];
      let wide = 0;
      for (const m of j.at) {
        const line = lines[m.line];
        const c = byFeature.get(this.features[line.feature]);
        if (!c?.profile) continue;
        wide = Math.max(wide, line.width);
        if (c.f.type === 'road') roads.push(sampleProfile(c.profile, (j.s - c.s0) / F.roadStep));
        else if (c.f.type === 'street' && line.carve) {
          own.push({ c, arc: m.arc, v: sampleProfile(c.profile, m.arc / F.roadStep) });
        }
      }
      if (own.length === 0 || own.length + roads.length < 2) continue;
      const src = roads.length > 0 ? roads : own.map((o) => o.v);
      const target = src.reduce((a, v) => a + v, 0) / src.length;
      for (const o of own) {
        const prof = o.c.profile!;
        for (let i = 0; i < prof.length; i++) {
          const far = Math.abs(i * F.roadStep - o.arc) - wide / 2;
          const w = 1 - smoothstep(0, F.junctionBlend, far);
          if (w > 0) prof[i] += (target - prof[i]) * w;
        }
      }
    }
  }

  /**
   * A stream's bed profile: `base` under its polyline every STREAM_SHAPE.profileStep m from the
   * source, made non-increasing (./stream.ts).
   */
  private streamProfile(
    c: Compiled,
    geo: CourseGeometry,
    base: (x: number, z: number) => number,
  ): StreamProfile {
    const poly = c.poly!;
    const step = STREAM_SHAPE.profileStep;
    const n = Math.max(2, Math.ceil(poly.length / step) + 1);
    const raw = new Float64Array(n);
    const frame = { x: 0, z: 0, dirX: 0, dirZ: 1 };
    const L = geo.length;
    let seg = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.min(i * step, poly.length);
      while (seg < poly.s.length - 2 && poly.arc[seg + 1] < a) seg++;
      const span = poly.arc[seg + 1] - poly.arc[seg];
      const t = poly.s.length > 1 && span > 1e-9 ? (a - poly.arc[seg]) / span : 0;
      const k = Math.min(seg + 1, poly.s.length - 1);
      const s = poly.s[seg] + (poly.s[k] - poly.s[seg]) * t;
      const d = poly.d[seg] + (poly.d[k] - poly.d[seg]) * t;
      geo.frameAt(s, frame);
      const extra = s < 0 ? s : s > L ? s - L : 0;
      const x = frame.x + frame.dirX * extra - frame.dirZ * d;
      raw[i] = base(x, frame.z + frame.dirZ * extra + frame.dirX * d);
    }
    return { index: this.features.indexOf(c.f), step, length: poly.length, values: descendingProfile(raw) };
  }

  /** Bed profiles of the level's streams (after prepare()), in level.features order. */
  streamProfiles(): StreamProfile[] {
    const out: StreamProfile[] = [];
    for (const c of this.list) if (c.stream) out.push(c.stream);
    return out.sort((a, b) => a.index - b.index);
  }

  /** Starts a vertex: culls features by range and returns the bump multiplier (1 = keep bumps). */
  begin(sExt: number, d: number, hw: number): number {
    this.sExt = sExt;
    this.d = d;
    this.hw = hw;
    this.actN = 0;
    let keep = 1;
    for (let i = 0; i < this.list.length; i++) {
      const c = this.list[i];
      const r = c.clear;
      if (sExt <= c.s0 - r || sExt >= c.s1 + r || d <= c.d0 - r || d >= c.d1 + r) continue;
      const f = c.f;
      let smooth = 0;
      if (f.type === 'ramp') {
        // None under the ramp, fading back in around it: continuous at its toe, sides and back.
        const os = Math.max(0, c.s0 - sExt, sExt - c.s1);
        const od = Math.max(0, Math.abs(d - f.d) - f.width / 2);
        smooth = 1 - smoothstep(0, r, Math.hypot(os, od));
      } else if (f.type === 'plateau') {
        smooth = this.plateauWeight(f, sExt, d);
      } else if (f.type === 'road') {
        const e = Math.abs(d - f.d) - f.width / 2 - F.roadShoulder;
        smooth = this.roadAlong(f, sExt) * (e <= 0 ? 1 : 1 - smoothstep(0, F.roadBank, e));
      } else if (c.profile && (f.type === 'street' || f.type === 'parking')) {
        const e = this.pavedEdge(c, sExt, d) - F.roadShoulder;
        smooth = e <= 0 ? 1 : 1 - smoothstep(0, F.roadBank, e);
      }
      if (1 - smooth < keep) keep = 1 - smooth;
      if (r === 0 || !(sExt <= c.s0 || sExt >= c.s1 || d <= c.d0 || d >= c.d1)) {
        this.act[this.actN++] = i;
      }
    }
    return keep;
  }

  /** True when the current vertex has features to apply. */
  get active(): boolean {
    return this.actN > 0;
  }

  /** Applies the active features to the valley height `h` (wallness 0..1 at the vertex). */
  finish(x: number, z: number, h: number, wallness: number): number {
    this.paint = PAINT.none;
    this.wallness = wallness;
    this.cut = 0;
    const sExt = this.sExt;
    const d = this.d;
    // On a ramp's face (up to its lip): gaps and ravines do not cut it, so a lip at a ravine's edge
    // keeps its whole face (a ravine wall eating its last metres broke the exact take-off).
    let onFace = false;
    for (let k = 0; k < this.actN; k++) {
      const c = this.list[this.act[k]];
      const f = c.f;
      switch (f.type) {
        case 'hill':
        case 'basin': {
          const ds = sExt - f.s;
          const dd = d - f.d;
          const q2 = (ds * ds + dd * dd) / (f.radius * f.radius);
          if (q2 < 1) h += (f.type === 'hill' ? f.height : -f.depth) * (1 - q2) * (1 - q2);
          break;
        }
        case 'plateau': {
          const w = this.plateauWeight(f, sExt, d);
          if (w <= 0) break;
          const rel = Math.min(1, Math.abs(f.d) / this.hw);
          const top = this.floorAt(sExt) + this.bowlRise * rel * rel + f.height;
          if (top > h) h += (top - h) * w;
          break;
        }
        case 'road': {
          const wa = this.roadAlong(f, sExt);
          if (wa <= 0 || !c.profile) break;
          const fi = clamp((sExt - c.s0) / F.roadStep, 0, c.profile.length - 1);
          const i0 = Math.min(Math.floor(fi), c.profile.length - 2);
          const target = c.profile[i0] + (c.profile[i0 + 1] - c.profile[i0]) * (fi - i0);
          const edge = Math.abs(d - f.d) - f.width / 2;
          const e = edge - F.roadShoulder;
          const bank = Math.min(F.roadBankMax, F.roadBank + F.roadBankPerMetre * Math.abs(h - target));
          const w = wa * (e <= 0 ? 1 : 1 - smoothstep(0, bank, e));
          if (w <= 0) break;
          h += (target - h) * w;
          this.wallness *= 1 - w;
          if (edge <= 0 && wa > 0.5) this.paint = c.paint;
          break;
        }
        case 'street':
        case 'parking': {
          if (!c.profile) break;
          const edge = this.pavedEdge(c, sExt, d);
          const e = edge - F.roadShoulder;
          const target = sampleProfile(c.profile, this.along / F.roadStep);
          const bank = Math.min(F.roadBankMax, F.roadBank + F.roadBankPerMetre * Math.abs(h - target));
          const w = e <= 0 ? 1 : 1 - smoothstep(0, bank, e);
          if (w <= 0) break;
          h += (target - h) * w;
          this.wallness *= 1 - w;
          if (edge <= 0) this.paint = c.paint;
          break;
        }
        case 'ramp': {
          const e = f.width / 2 - Math.abs(d - f.d);
          if (e <= 0) break;
          const t0 = f.s - f.length;
          let along: number;
          if (sExt <= f.s) {
            const t = (sExt - t0) / f.length;
            along = t * t;
            onFace = true;
          } else {
            along = 1 - (sExt - f.s) / F.rampBackRun;
          }
          const lift = f.height * along * Math.min(1, e / rampEdgeRun(f.height));
          if (lift <= 0) break;
          h += lift;
          if (lift > 0.15) this.paint = c.paint;
          break;
        }
        case 'island': {
          const half = islandHalfWidth(f, sExt);
          const inside = half - Math.abs(d - f.d);
          if (inside <= 0) break;
          const wall = Math.min(1, inside / F.islandWallRun);
          const crown = smoothstep(0, half, inside);
          const ns = F.islandNoiseScale;
          const rough = 1 + F.islandRough * (ridged2(x / ns, z / ns, this.seed + 303, 2) - 0.5);
          h += f.height * wall * (F.islandWallShare + (1 - F.islandWallShare) * crown) * rough;
          this.paint = c.paint;
          this.wallness = 1;
          break;
        }
        case 'gap': {
          const ea = Math.min(sExt - f.s, f.s + f.length - sExt);
          if (ea <= 0 || onFace) break;
          const lat = gapLateral(f, this.hw);
          const el = lat.half - Math.abs(d - lat.d);
          if (el <= 0) break;
          const k = Math.min(1, ea / F.gapWallRun) * Math.min(1, el / F.gapWallRun);
          const scree = F.gapScree * (ridged2(x / 4, z / 4, this.seed + 313, 2) - 0.5);
          const cut = (f.depth - scree) * k;
          h -= cut;
          if (c.fatal && cut > this.cut) this.cut = cut;
          this.paint = c.paint;
          break;
        }
        case 'ridge': {
          const half = f.width / 2;
          const inside = half - polylineDistance(c.poly!, sExt, d, this.hit);
          if (inside <= 0) break;
          if (f.profile === 'mound') {
            const q = 1 - inside / half;
            h += f.height * (1 - q * q) * (1 - q * q);
            break;
          }
          const wall = Math.min(1, inside / F.islandWallRun);
          const crown = smoothstep(0, half, inside);
          const ns = F.islandNoiseScale;
          const rough = 1 + F.islandRough * (ridged2(x / ns, z / ns, this.seed + 307, 2) - 0.5);
          h += f.height * wall * (F.islandWallShare + (1 - F.islandWallShare) * crown) * rough;
          this.paint = c.paint;
          this.wallness = 1;
          break;
        }
        case 'gully': {
          const half = f.width / 2;
          const dist = polylineDistance(c.poly!, sExt, d, this.hit);
          if (dist >= half) break;
          const taper = gullyTaper(f);
          const arc = this.hit.arc;
          let along = smoothstep(0, taper, arc);
          if (!f.closed) along *= 1 - smoothstep(c.poly!.length - taper, c.poly!.length, arc);
          if (along <= 0) break;
          const q = dist / half;
          h -= f.depth * (1 - q * q) * (1 - q * q) * along;
          break;
        }
        case 'stream': {
          const p = c.stream;
          if (!p) break;
          const q = polylineDistance(c.poly!, sExt, d, this.hit);
          const along = streamAlong(f, this.hit.arc, p.length);
          let target = streamSection(f, q, profileAt(p, this.hit.arc), along);
          let half = f.width / 2;
          let inner = q;
          if (c.pool) {
            // The spring pool around the first point (gravel floor, rock banks like the channel).
            const p0 = f.points[0];
            const qp = Math.hypot(sExt - p0.s, d - p0.d);
            const pool = springPoolSection(c.pool, qp);
            if (pool < target) {
              target = pool;
              half = c.pool.radius;
              inner = qp;
            }
          }
          if (!(target < h)) break;
          h = target;
          // The bed is gravel, the banks rock.
          this.paint = inner < half * 0.5 ? PAINT.gravel : PAINT.rock;
          if (inner >= half * 0.5) this.wallness = 1;
          break;
        }
        case 'ravine': {
          if (onFace) break;
          const inside = f.width / 2 - polylineDistance(c.poly!, sExt, d, this.hit);
          if (inside <= 0) break;
          const k = Math.min(1, inside / F.gapWallRun);
          const scree = F.gapScree * (ridged2(x / 4, z / 4, this.seed + 317, 2) - 0.5);
          const cut = (f.depth - scree) * k;
          h -= cut;
          if (c.fatal && cut > this.cut) this.cut = cut;
          this.paint = c.paint;
          break;
        }
      }
    }
    return h;
  }

  private readonly hit: PolylineHit = { arc: 0 };
  /** Set by pavedEdge: position along the street (arc) or parking area (from its near end). */
  private along = 0;

  /**
   * Distance (m) from a street's or parking area's paved edge (negative inside), and `along` = where
   * its profile is sampled.
   */
  private pavedEdge(c: Compiled, s: number, d: number): number {
    const f = c.f;
    if (f.type === 'parking') {
      const { a, b } = parkingLocal(f, s, d);
      const hl = f.length / 2;
      this.along = clamp(a + hl, 0, f.length);
      const oa = Math.abs(a) - hl;
      const ob = Math.abs(b) - f.width / 2;
      return oa > 0 && ob > 0 ? Math.hypot(oa, ob) : Math.max(oa, ob);
    }
    const dist = polylineDistance(c.poly!, s, d, this.hit);
    this.along = this.hit.arc;
    return dist - (f.type === 'street' ? f.width / 2 : 0);
  }

  private plateauWeight(f: Extract<TerrainFeature, { type: 'plateau' }>, s: number, d: number): number {
    const inside = f.width / 2 - Math.abs(d - f.d);
    if (inside <= 0 || s <= f.s0 || s >= f.s1) return 0;
    const rl = plateauRampRun(f.height);
    const wa = smoothstep(f.s0, f.s0 + rl, s) * (1 - smoothstep(f.s1 - rl, f.s1, s));
    return wa * smoothstep(0, plateauEdgeRun(f.height), inside);
  }

  private roadAlong(f: Road, s: number): number {
    const out = Math.max(0, f.s0 - s, s - f.s1);
    return out <= 0 ? 1 : 1 - smoothstep(0, F.roadTaper, out);
  }
}

/** Moving average of a raw road profile (half-window roadSmooth m, clamped at the ends). */
function smoothProfile(raw: Float64Array): Float64Array {
  const n = raw.length;
  const k = Math.max(1, Math.round(F.roadSmooth / F.roadStep));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = -k; j <= k; j++) sum += raw[clamp(i + j, 0, n - 1)];
    out[i] = sum / (2 * k + 1);
  }
  return out;
}

/** Linear interpolation of a profile at fractional sample index `fi` (clamped). */
function sampleProfile(p: Float64Array, fi: number): number {
  if (p.length === 1) return p[0];
  const f = clamp(fi, 0, p.length - 1);
  const i0 = Math.min(Math.floor(f), p.length - 2);
  return p[i0] + (p[i0 + 1] - p[i0]) * (f - i0);
}

/**
 * Smoothed level profile of a street (every roadStep along its polyline's arc) or a parking area
 * (along its length from the near end), sampled from the valley height without features.
 */
function streetProfile(
  f: Street | Parking,
  geo: CourseGeometry,
  base: (x: number, z: number) => number,
): Float64Array {
  const frame = { x: 0, z: 0, dirX: 0, dirZ: 1 };
  const L = geo.length;
  const at = (s: number, d: number): number => {
    geo.frameAt(s, frame);
    const extra = s < 0 ? s : s > L ? s - L : 0;
    return base(frame.x + frame.dirX * extra - frame.dirZ * d, frame.z + frame.dirZ * extra + frame.dirX * d);
  };
  let length: number;
  let point: (t: number) => { s: number; d: number };
  if (f.type === 'parking') {
    const yaw = f.yaw ?? 0;
    const us = Math.cos(yaw);
    const ud = -Math.sin(yaw);
    length = f.length;
    point = (t) => ({ s: f.s + us * (t - f.length / 2), d: f.d + ud * (t - f.length / 2) });
  } else {
    const p = polylineOf(f);
    length = p.length;
    point = (t) => {
      let i = 0;
      while (i + 2 < p.s.length && p.arc[i + 1] < t) i++;
      const j = Math.min(i + 1, p.s.length - 1);
      const l = p.arc[j] - p.arc[i];
      const u = l > 0 ? clamp((t - p.arc[i]) / l, 0, 1) : 0;
      return { s: p.s[i] + (p.s[j] - p.s[i]) * u, d: p.d[i] + (p.d[j] - p.d[i]) * u };
    };
  }
  const n = Math.max(2, Math.ceil(length / F.roadStep) + 1);
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const q = point(Math.min(length, i * F.roadStep));
    raw[i] = at(q.s, q.d);
  }
  return smoothProfile(raw);
}
