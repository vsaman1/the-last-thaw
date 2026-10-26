import type { IcebergState, RiverSample, Terrain } from '../types';
import { dirToHeading } from '../math';
import {
  RIVER_CHUNK_SEGMENTS,
  RIVER_CROSS_VERTS,
  RIVER_GEOMETRY_REACH,
  buildRiverChunk,
  createRiverChunkGeometry,
  riverChunkCount,
  riverChunkRange,
  type RiverChunkGeometry,
} from './geometry';
import type { RiverTrail } from './trail';

/**
 * Test-only helpers for checking built river geometry against the terrain. Not used at runtime.
 */

const CROSS = RIVER_CROSS_VERTS;
const DT = 1 / 60;

export function makeIceberg(radius = 2.2): IcebergState {
  return {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    heading: 0,
    steer: 0,
    yawRate: 0,
    grounded: true,
    airTime: 0,
    airPeakY: 0,
    inOcean: false,
    stuckTimer: 0,
    pitch: 0,
    roll: 0,
    impact: 0,
    radius,
    mass: 30,
    ice: 1,
    size: 1,
  };
}

export type PathFn = (d: number) => { x: number; z: number };

export interface DriveOptions {
  speed: number;
  from: number;
  to: number;
  /** Per-step overrides keyed on distance travelled along the path (called before recording). */
  state?: (d: number, ice: IcebergState) => void;
}

/** Move an iceberg along a parametric path (d = distance along it), recording every 60 Hz step. */
export function drive(
  trail: RiverTrail,
  terrain: Terrain,
  path: PathFn,
  o: DriveOptions,
  t0 = 0,
  ice: IcebergState = makeIceberg(),
): number {
  let t = t0;
  for (let d = o.from; d <= o.to; d += o.speed * DT) {
    const p = path(d);
    const q = path(d + 0.01);
    const len = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    const dx = (q.x - p.x) / len;
    const dz = (q.z - p.z) / len;
    ice.pos.x = p.x;
    ice.pos.z = p.z;
    ice.pos.y = terrain.heightAt(p.x, p.z);
    ice.vel.x = dx * o.speed;
    ice.vel.z = dz * o.speed;
    ice.heading = dirToHeading(dx, dz);
    ice.grounded = true;
    ice.inOcean = false;
    o.state?.(d, ice);
    trail.record(ice, terrain, t);
    t += DT;
  }
  return t;
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** What a hop() flew: take-off (last grounded position), airborne positions, landing. */
export interface Flight {
  takeoff: Point3 | null;
  readonly points: Point3[];
  landing: Point3 | null;
  /** True if it came down on the sea. */
  ocean: boolean;
}

const GRAVITY = 9.81;

/**
 * A ballistic flight for drive()'s `state`, as the iceberg sim flies one: grounded until path
 * distance `at`, then airborne from the last grounded position with vertical speed `vy0` (at the
 * ground height there, or `y0`), until the parabola meets the ground or the sea (then it floats).
 * `then` runs on every step after (for chaining overrides). Positions are the iceberg's base.
 */
export function hop(
  terrain: Terrain,
  path: PathFn,
  speed: number,
  at: number,
  vy0 = 0,
  o: { y0?: number; then?: (d: number, ice: IcebergState) => void } = {},
): { state: (d: number, ice: IcebergState) => void; flight: Flight } {
  const flight: Flight = { takeoff: null, points: [], landing: null, ocean: false };
  let lastD = 0;
  let last: Point3 | null = null;
  const sea = terrain.level.seaLevel;
  const state = (d: number, ice: IcebergState): void => {
    if (flight.landing) {
      if (flight.ocean) {
        ice.inOcean = true;
        ice.grounded = true;
        ice.pos.y = sea;
      }
      o.then?.(d, ice);
      return;
    }
    const p = path(d);
    const ground = terrain.heightAt(p.x, p.z);
    const from: Point3 | null = flight.takeoff ?? (last ? { ...last, y: o.y0 ?? last.y } : null);
    const t = (d - lastD) / speed;
    const y = from ? from.y + vy0 * t - 0.5 * GRAVITY * t * t : -Infinity;
    // (like the sim, it only takes off once the ground falls away under the flight)
    if (!flight.takeoff && (d < at || !from || !(y > ground))) {
      lastD = d;
      last = { x: ice.pos.x, y: ice.pos.y, z: ice.pos.z };
      o.then?.(d, ice);
      return;
    }
    flight.takeoff ??= from;
    const ocean = y <= sea && terrain.isOcean(p.x, p.z);
    if (ocean || y <= ground) {
      flight.ocean = ocean;
      flight.landing = { x: p.x, y: ocean ? sea : ground, z: p.z };
      if (ocean) {
        ice.inOcean = true;
        ice.pos.y = sea;
      }
      o.then?.(d, ice);
      return;
    }
    ice.grounded = false;
    ice.pos.y = y;
    flight.points.push({ x: ice.pos.x, y, z: ice.pos.z });
    o.then?.(d, ice);
  };
  return { state, flight };
}

/** Distance from p to the polyline pts in 3D. */
export function distanceToPolyline(p: Point3, pts: readonly Point3[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const ez = b.z - a.z;
    const l2 = ex * ex + ey * ey + ez * ez;
    const dot = (p.x - a.x) * ex + (p.y - a.y) * ey + (p.z - a.z) * ez;
    const t = l2 > 1e-12 ? Math.max(0, Math.min(1, dot / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - a.x - ex * t, p.y - a.y - ey * t, p.z - a.z - ez * t));
  }
  return best;
}

/**
 * The water's version of a flight: take-off, airborne points and landing, all raised by the
 * river's landOffset (the water runs at the iceberg's base, as on the ground).
 */
export function waterFlight(f: Flight, landOffset = 0.15): Point3[] {
  const out: Point3[] = [];
  const lift = (p: Point3): Point3 => ({ x: p.x, y: p.y + landOffset, z: p.z });
  if (f.takeoff) out.push(lift(f.takeoff));
  for (const p of f.points) out.push(lift(p));
  if (f.landing) out.push(f.ocean ? { ...f.landing, y: f.landing.y + 0.06 } : lift(f.landing));
  return out;
}

/**
 * Mirrors the renderer's incremental chunk updates (src/render/River.tsx) without three.js, with
 * an adjustable chunk length so tests can put chunk seams wherever they like.
 */
export class ChunkMirror {
  readonly chunks: { geo: RiverChunkGeometry; built: number }[] = [];
  private structure = -1;

  constructor(readonly segments = RIVER_CHUNK_SEGMENTS) {}

  update(trail: RiverTrail, terrain: Terrain): void {
    const samples = trail.samples;
    const n = samples.length;
    const seg = this.segments;
    const full = trail.structureVersion !== this.structure;
    this.structure = trail.structureVersion;
    const count = riverChunkCount(n, seg);
    this.chunks.length = Math.min(this.chunks.length, count);
    for (let k = 0; k < count; k++) {
      const r = riverChunkRange(k, n, seg);
      let entry = this.chunks[k];
      if (!entry || full) {
        entry ??= { geo: createRiverChunkGeometry(seg + 1), built: -1 };
        this.chunks[k] = entry;
        buildRiverChunk(samples, r.start, r.end, terrain, entry.geo);
        entry.built = trail.version;
        continue;
      }
      const lo = Math.max(0, r.start - RIVER_GEOMETRY_REACH);
      const hi = Math.min(n - 1, r.end + RIVER_GEOMETRY_REACH);
      let first = -1;
      for (let i = lo; i <= hi && first < 0; i++) if (samples[i].rev > entry.built) first = i;
      if (first < 0 && entry.geo.end === r.end) continue;
      const from = first < 0 ? r.start : Math.max(r.start, first - RIVER_GEOMETRY_REACH);
      buildRiverChunk(samples, r.start, r.end, terrain, entry.geo, undefined, from);
      entry.built = trail.version;
    }
  }
}

/** Indices of samples that start a new stretch of river after a jumped gap. */
export function gapIndices(samples: readonly RiverSample[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < samples.length; i++) if (samples[i].gapBefore) out.push(i);
  return out;
}

/**
 * Drawn (non-degenerate) triangles of the built chunks that join cross-section i − 1 to i, for
 * each i in `at`.
 */
export function trianglesAcross(chunks: readonly RiverChunkGeometry[], at: readonly number[]): number {
  let hits = 0;
  for (const g of chunks) {
    for (let t = 0; t < g.indexCount; t += 3) {
      const a = g.index[t];
      const b = g.index[t + 1];
      const c = g.index[t + 2];
      if (a === b || b === c || a === c) continue;
      const lo = g.start + Math.floor(Math.min(a, b, c) / CROSS);
      const hi = g.start + Math.floor(Math.max(a, b, c) / CROSS);
      if (hi > lo && at.includes(hi)) hits++;
    }
  }
  return hits;
}

/** Barycentric probe points per triangle: corners are skipped (vertices sit on a clearance). */
const BARY: readonly (readonly [number, number, number])[] = [
  [1 / 3, 1 / 3, 1 / 3],
  [2 / 3, 1 / 6, 1 / 6],
  [1 / 6, 2 / 3, 1 / 6],
  [1 / 6, 1 / 6, 2 / 3],
  [0.5, 0.5, 0],
  [0, 0.5, 0.5],
  [0.5, 0, 0.5],
];

export function buildAllChunks(samples: readonly RiverSample[], terrain: Terrain): RiverChunkGeometry[] {
  const n = samples.length;
  const out: RiverChunkGeometry[] = [];
  for (let k = 0; k < riverChunkCount(n); k++) {
    const r = riverChunkRange(k, n);
    out.push(buildRiverChunk(samples, r.start, r.end, terrain));
  }
  return out;
}

export interface FallRun {
  /** Index of the last sample before the first fall sample. */
  lip: number;
  first: number;
  last: number;
  /** Index of the first sample after the run (the plunge-pool base). */
  base: number;
}

export function fallRuns(samples: readonly RiverSample[]): FallRun[] {
  const runs: FallRun[] = [];
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].kind !== 'fall' || (i > 0 && samples[i - 1].kind === 'fall')) continue;
    let j = i;
    while (j + 1 < samples.length && samples[j + 1].kind === 'fall') j++;
    runs.push({ lip: i - 1, first: i, last: j, base: Math.min(samples.length - 1, j + 1) });
  }
  return runs;
}

export interface SurfaceReport {
  /** Probe points on land water (not fall, not ocean) more than 1 m above the terrain. */
  floatOver1: number;
  maxFloat: number;
  /** Sample index of the cross-section nearest the worst float. */
  maxFloatAt: number;
  /** Deepest land-water probe point under the terrain (m, ≥ 0). */
  maxBury: number;
  maxBuryAt: number;
  /** Waterfall vertices more than 5 cm inside the terrain, and the deepest of them. */
  fallInRock: number;
  maxFallDepth: number;
  landTriangles: number;
}

/**
 * Probe every land triangle of the built chunks against the terrain. `skipFloat(i)` excludes
 * triangles touching cross-section i from the float statistics only (burial is always measured).
 */
export function probeSurface(
  chunks: readonly RiverChunkGeometry[],
  terrain: Terrain,
  skipFloat: (i: number) => boolean = () => false,
): SurfaceReport {
  const r: SurfaceReport = {
    floatOver1: 0,
    maxFloat: 0,
    maxFloatAt: -1,
    maxBury: 0,
    maxBuryAt: -1,
    fallInRock: 0,
    maxFallDepth: 0,
    landTriangles: 0,
  };
  for (const g of chunks) {
    const P = g.position;
    for (let v = 0; v < g.vertexCount; v++) {
      if (g.fall[v] !== 1) continue;
      const depth = terrain.heightAt(P[v * 3], P[v * 3 + 2]) - P[v * 3 + 1];
      if (depth > 0.05) r.fallInRock++;
      r.maxFallDepth = Math.max(r.maxFallDepth, depth);
    }
    for (let t = 0; t < g.indexCount; t += 3) {
      const a = g.index[t];
      const b = g.index[t + 1];
      const c = g.index[t + 2];
      // degenerate triangles fill the quads of a jumped gap and are never rasterised
      if (a === b || b === c || a === c) continue;
      if (g.fall[a] || g.fall[b] || g.fall[c] || g.ocean[a] || g.ocean[b] || g.ocean[c]) continue;
      r.landTriangles++;
      const i = g.start + Math.floor(a / CROSS);
      const skip = skipFloat(i) || skipFloat(g.start + Math.floor(c / CROSS));
      for (const w of BARY) {
        const x = w[0] * P[a * 3] + w[1] * P[b * 3] + w[2] * P[c * 3];
        const y = w[0] * P[a * 3 + 1] + w[1] * P[b * 3 + 1] + w[2] * P[c * 3 + 1];
        const z = w[0] * P[a * 3 + 2] + w[1] * P[b * 3 + 2] + w[2] * P[c * 3 + 2];
        const h = y - terrain.heightAt(x, z);
        if (-h > r.maxBury) {
          r.maxBury = -h;
          r.maxBuryAt = i;
        }
        if (skip) continue;
        if (h > 1) r.floatOver1++;
        if (h > r.maxFloat) {
          r.maxFloat = h;
          r.maxFloatAt = i;
        }
      }
    }
  }
  return r;
}

export interface FallClearance {
  /** Waterfall vertices checked. */
  verts: number;
  /** Lowest waterfall vertex above the ground straight under it (m). */
  minVertical: number;
  /** Probe points inside waterfall triangles less than 2 cm above the ground, and the lowest (m). */
  trianglesLow: number;
  minTriangle: number;
  /**
   * Closest a waterfall vertex comes to the terrain surface in 3D (sampled within 2 m), leaving out
   * the cross-sections next to the lip and the base, which meet the river by design, and vertices
   * `falling` rejects (m).
   */
  minDistance: number;
  /** Sample index of that vertex. */
  minDistanceAt: number;
}

/**
 * Waterfall sheets against the terrain: every vertex (both banks) and triangle of the fall runs.
 * `falling(i, y)` picks the vertices (sample i, height y) the 3D distance is measured for.
 */
export function fallClearance(
  chunks: readonly RiverChunkGeometry[],
  terrain: Terrain,
  falling: (i: number, y: number) => boolean = () => true,
): FallClearance {
  const r: FallClearance = {
    verts: 0,
    minVertical: Infinity,
    trianglesLow: 0,
    minTriangle: Infinity,
    minDistance: Infinity,
    minDistanceAt: -1,
  };
  for (const g of chunks) {
    const P = g.position;
    const fallAt = (c: number): boolean => c >= 0 && c < g.crossSections && g.fall[c * CROSS] === 1;
    for (let v = 0; v < g.vertexCount; v++) {
      if (g.fall[v] !== 1) continue;
      r.verts++;
      const x = P[v * 3];
      const y = P[v * 3 + 1];
      const z = P[v * 3 + 2];
      r.minVertical = Math.min(r.minVertical, y - terrain.heightAt(x, z));
      const c = Math.floor(v / CROSS);
      // inner sections only: a fall section on both sides (in this chunk)
      if (!fallAt(c - 1) || !fallAt(c + 1) || !falling(g.start + c, y)) continue;
      let d = Infinity;
      for (let dx = -2; dx <= 2; dx += 0.1) {
        for (let dz = -2; dz <= 2; dz += 0.1) {
          d = Math.min(d, Math.hypot(dx, dz, y - terrain.heightAt(x + dx, z + dz)));
        }
      }
      if (d < r.minDistance) {
        r.minDistance = d;
        r.minDistanceAt = g.start + c;
      }
    }
    for (let t = 0; t < g.indexCount; t += 3) {
      const a = g.index[t];
      const b = g.index[t + 1];
      const c = g.index[t + 2];
      if (a === b || b === c || a === c) continue;
      if (!g.fall[a] && !g.fall[b] && !g.fall[c]) continue;
      for (const w of BARY) {
        const x = w[0] * P[a * 3] + w[1] * P[b * 3] + w[2] * P[c * 3];
        const y = w[0] * P[a * 3 + 1] + w[1] * P[b * 3 + 1] + w[2] * P[c * 3 + 1];
        const z = w[0] * P[a * 3 + 2] + w[1] * P[b * 3 + 2] + w[2] * P[c * 3 + 2];
        const h = y - terrain.heightAt(x, z);
        if (h < 0.02) r.trianglesLow++;
        r.minTriangle = Math.min(r.minTriangle, h);
      }
    }
  }
  return r;
}

/** True for cross-sections from `before` samples ahead of a fall run's first sample through the lip. */
export function nearFallLip(samples: readonly RiverSample[], before: number): (i: number) => boolean {
  const near = new Uint8Array(samples.length);
  for (const run of fallRuns(samples)) {
    for (let i = Math.max(0, run.first - before); i < run.first; i++) near[i] = 1;
  }
  return (i) => near[i] === 1;
}
