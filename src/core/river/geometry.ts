import type { RiverSample, Terrain } from '../types';

/**
 * Typed-array geometry for the river trail, built per chunk of samples.
 *
 * Every sample becomes a cross-section of RIVER_CROSS_VERTS vertices from the left bank (u = 0)
 * to the right bank (u = 1). A cross-section is a pure function of the sample array (it never
 * depends on which chunk is building it), so consecutive chunks share their boundary
 * cross-section bit-for-bit and there are no seams.
 *
 * A sample with gapBefore starts a new stretch of river after a jumped ravine: cross-sections
 * never look across it (each side is shaped as a trail end) and the quads joining the two sides
 * are degenerate, so nothing is drawn over the gap.
 */

export const RIVER_CROSS_VERTS = 9;
/** Segments (sample → sample) per chunk; chunk k spans samples [k·N, (k+1)·N]. */
export const RIVER_CHUNK_SEGMENTS = 128;
/**
 * Samples on each side of i that influence cross-section i (tangent smoothing ±2, inner-bend
 * curvature ±1 on top, waterfall-lip lookahead +3, normals ±1 on top). A renderer must rebuild a
 * chunk when any sample within this distance of its range changed.
 */
export const RIVER_GEOMETRY_REACH = 4;

const CROSS = RIVER_CROSS_VERTS;
const MID = (CROSS - 1) / 2;
/** Land sections up to this many samples before a waterfall stay level (≤ reach − normals). */
const LIP_LOOKAHEAD = 3;

export interface RiverGeometryOptions {
  /** Minimum height of land water vertices above the terrain (m). */
  landClearance: number;
  /** How far the banks curl up above the centreline (m). */
  bankCurl: number;
  /** Tangent smoothing radius in samples. */
  tangentRadius: number;
  /** Inner half-width is limited to this fraction of the local turn radius. */
  innerBendFactor: number;
  minInnerHalfWidth: number;
  /** Newer water sits slightly higher so a trail crossing itself does not z-fight. */
  heightBiasPerMetre: number;
  maxHeightBias: number;
  /**
   * The trail already keeps waterfall sheets clear of the ground (with a larger margin); any fall
   * vertex this cross-section still brings within this of the ground under it, or halfway to its
   * neighbours across, is lifted (m).
   */
  fallClearance: number;
  /**
   * Land water hangs at most this far above landClearance; lower ground across the section (a
   * valley wall) is draped instead of bridged by a flat slab (m).
   */
  maxHover: number;
  /**
   * Draping stops at a drop-off: once the water would fall faster than this (rise/run) between
   * neighbouring vertices, or cut under a convex edge between them, the rest of that bank stays
   * level (an overhanging shelf, as at a waterfall lip).
   */
  dropOffSlope: number;
}

export const DEFAULT_RIVER_GEOMETRY_OPTIONS: Readonly<RiverGeometryOptions> = Object.freeze({
  landClearance: 0.08,
  bankCurl: 0.1,
  tangentRadius: 2,
  innerBendFactor: 0.85,
  minInnerHalfWidth: 0.5,
  heightBiasPerMetre: 1e-4,
  maxHeightBias: 0.2,
  fallClearance: 0.15,
  maxHover: 0.4,
  dropOffSlope: 3,
});

export interface Bounds3 {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/**
 * Geometry of one chunk. Arrays are allocated for `maxCrossSections` and reused across rebuilds;
 * only the first `vertexCount` vertices / `indexCount` indices are valid. The index buffer is a
 * fixed quad strip (a chunk with fewer cross-sections uses a prefix of it) except that the quads
 * of a segment across a jumped gap are degenerate; `indexVersion` changes whenever a build
 * rewrote any index, so a renderer knows to re-upload it.
 *
 * Per-vertex attributes: position(3), normal(3), uv(2: u across 0..1, v = trail s in metres),
 * flowSpeed, turbulence, fall (1 on waterfall samples), ocean (1 on ocean samples), birth (sample
 * time t), lateral(2: x/z offset of the vertex from the centreline, for shader-side spreading).
 * The distance to the newest sample ("lead") is not baked: it changes on every append, so the
 * shader computes it as headS − v from a uniform.
 */
export interface RiverChunkGeometry {
  start: number;
  end: number;
  crossSections: number;
  /** Local index of the first cross-section written by the last build (0 for a full build). */
  writtenFrom: number;
  vertexCount: number;
  indexCount: number;
  readonly maxCrossSections: number;
  readonly position: Float32Array;
  readonly normal: Float32Array;
  readonly uv: Float32Array;
  readonly flowSpeed: Float32Array;
  readonly turbulence: Float32Array;
  readonly fall: Float32Array;
  readonly ocean: Float32Array;
  readonly birth: Float32Array;
  readonly lateral: Float32Array;
  readonly index: Uint16Array | Uint32Array;
  /** 1 where the quads from cross-section c to c + 1 span a jumped gap (degenerate, not drawn). */
  readonly segmentGap: Uint8Array;
  /** Incremented whenever a build rewrote part of `index`. */
  indexVersion: number;
  hasOcean: boolean;
  hasFall: boolean;
  readonly bounds: Bounds3;
}

export function riverChunkCount(sampleCount: number, segments = RIVER_CHUNK_SEGMENTS): number {
  return sampleCount < 2 ? 0 : Math.ceil((sampleCount - 1) / segments);
}

/** Inclusive sample range of chunk k. */
export function riverChunkRange(
  k: number,
  sampleCount: number,
  segments = RIVER_CHUNK_SEGMENTS,
): { start: number; end: number } {
  const start = k * segments;
  return { start, end: Math.min(sampleCount - 1, start + segments) };
}

/** Write the quads joining cross-section c to c + 1, or degenerate triangles over a gap. */
function writeSegmentIndices(index: Uint16Array | Uint32Array, c: number, gap: boolean): void {
  let w = c * (CROSS - 1) * 6;
  for (let k = 0; k < CROSS - 1; k++) {
    const a = c * CROSS + k;
    if (gap) {
      for (let q = 0; q < 6; q++) index[w++] = a;
      continue;
    }
    const b = a + 1;
    const d = a + CROSS;
    const e = d + 1;
    // (a, b, d) and (b, e, d) face +Y for a left→right, upstream→downstream layout
    index[w++] = a;
    index[w++] = b;
    index[w++] = d;
    index[w++] = b;
    index[w++] = e;
    index[w++] = d;
  }
}

export function createRiverChunkGeometry(maxCrossSections = RIVER_CHUNK_SEGMENTS + 1): RiverChunkGeometry {
  const maxVerts = maxCrossSections * CROSS;
  const segments = Math.max(0, maxCrossSections - 1);
  const quads = segments * (CROSS - 1);
  const index = maxVerts > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
  for (let c = 0; c < segments; c++) writeSegmentIndices(index, c, false);
  return {
    start: 0,
    end: 0,
    crossSections: 0,
    writtenFrom: 0,
    vertexCount: 0,
    indexCount: 0,
    maxCrossSections,
    position: new Float32Array(maxVerts * 3),
    normal: new Float32Array(maxVerts * 3),
    uv: new Float32Array(maxVerts * 2),
    flowSpeed: new Float32Array(maxVerts),
    turbulence: new Float32Array(maxVerts),
    fall: new Float32Array(maxVerts),
    ocean: new Float32Array(maxVerts),
    birth: new Float32Array(maxVerts),
    lateral: new Float32Array(maxVerts * 2),
    index,
    segmentGap: new Uint8Array(Math.max(1, segments)),
    indexVersion: 0,
    hasOcean: false,
    hasFall: false,
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 },
  };
}

// ---------------------------------------------------------------------------------------------
// Cross-sections
// ---------------------------------------------------------------------------------------------

const tan = { x: 0, z: 1 };
/** Sample range [run.lo, run.hi] around i that holds no gap, set by gapFreeRun. */
const run = { lo: 0, hi: 0 };

/** The gap-free stretch around sample i, looking at most `reach` samples either way → `run`. */
function gapFreeRun(samples: readonly RiverSample[], i: number, reach: number): void {
  const loLimit = Math.max(0, i - reach);
  const hiLimit = Math.min(samples.length - 1, i + reach);
  let lo = i;
  while (lo > loLimit && !samples[lo].gapBefore) lo--;
  let hi = i;
  while (hi < hiLimit && !samples[hi + 1].gapBefore) hi++;
  run.lo = lo;
  run.hi = hi;
}

/**
 * Smoothed horizontal tangent at sample i → `tan`. Uses dirs i-R+1 … i+R (half weight at the
 * window ends), limited to samples lo…hi.
 */
function smoothTangent(
  samples: readonly RiverSample[],
  i: number,
  radius: number,
  lo: number,
  hi: number,
): void {
  let tx = 0;
  let tz = 0;
  const j0 = i - radius + 1;
  const j1 = i + radius;
  const end = Math.min(j1, hi);
  for (let j = Math.max(j0, lo); j <= end; j++) {
    const w = j === j0 || j === j1 ? 0.5 : 1;
    tx += samples[j].dirX * w;
    tz += samples[j].dirZ * w;
  }
  const l = Math.sqrt(tx * tx + tz * tz);
  if (l > 1e-6) {
    tan.x = tx / l;
    tan.z = tz / l;
  } else {
    tan.x = samples[i].dirX;
    tan.z = samples[i].dirZ;
  }
}

/**
 * Write the CROSS vertex positions of sample i into pos[off…] (x, y, z triples) and, if given,
 * the lateral offsets into lat[latOff…] (x, z pairs).
 */
function writeCrossSection(
  samples: readonly RiverSample[],
  i: number,
  terrain: Terrain,
  o: RiverGeometryOptions,
  pos: Float64Array,
  off: number,
  lat: Float32Array | null,
  latOff: number,
): void {
  const sm = samples[i];
  const radius = o.tangentRadius;
  gapFreeRun(samples, i, Math.max(radius + 1, LIP_LOOKAHEAD));
  const lo = run.lo;
  const hi = run.hi;
  smoothTangent(samples, i, radius, lo, hi);
  const tx = tan.x;
  const tz = tan.z;
  const rx = -tz;
  const rz = tx;

  let hwL = sm.width * 0.5;
  let hwR = hwL;
  if (i > lo && i < hi) {
    smoothTangent(samples, i - 1, radius, lo, hi);
    const ax = tan.x;
    const az = tan.z;
    smoothTangent(samples, i + 1, radius, lo, hi);
    const bx = tan.x;
    const bz = tan.z;
    const pa = samples[i - 1];
    const pb = samples[i + 1];
    const ex = pb.x - pa.x;
    const ez = pb.z - pa.z;
    const ds = Math.sqrt(ex * ex + ez * ez);
    const ang = Math.atan2(ax * bz - az * bx, ax * bx + az * bz);
    if (ds > 1e-3 && Math.abs(ang) > 1e-4) {
      // Inner offset curve folds once the half-width exceeds the turn radius.
      const inner = Math.max(o.minInnerHalfWidth, (ds / Math.abs(ang)) * o.innerBendFactor);
      if (ang > 0) hwR = Math.min(hwR, inner);
      else hwL = Math.min(hwL, inner);
    }
  }
  // Laid on a road bridge's deck: no wider than the corridor between its barriers.
  const bank = sm.bank;
  if (bank) {
    const rn = rx * bank.nx + rz * bank.nz;
    if (Math.abs(rn) > 0.3) {
      const v0 = (sm.x - bank.x) * bank.nx + (sm.z - bank.z) * bank.nz;
      // Across the section the offset is v0 + l·rn (l from -hwL to hwR).
      const right = ((rn > 0 ? bank.hi : bank.lo) - v0) / rn;
      const left = (v0 - (rn > 0 ? bank.lo : bank.hi)) / rn;
      hwR = Math.max(o.minInnerHalfWidth, Math.min(hwR, right));
      hwL = Math.max(o.minInnerHalfWidth, Math.min(hwL, left));
    }
  }

  const bias = Math.min(o.maxHeightBias, Math.max(0, sm.s) * o.heightBiasPerMetre);
  const fall = sm.kind === 'fall';
  const ocean = sm.kind === 'ocean';
  const land = !fall && !ocean;
  const curl = land ? o.bankCurl : 0;
  const base = sm.y + bias;
  // Fall vertices also check the ground halfway to their neighbours across.
  const hx = (rx * Math.max(hwL, hwR)) / (2 * MID);
  const hz = (rz * Math.max(hwL, hwR)) / (2 * MID);
  for (let k = 0; k < CROSS; k++) {
    const q = Math.abs(k - MID) / MID;
    const l = k < MID ? -hwL * q : hwR * q;
    const vx = sm.x + rx * l;
    const vz = sm.z + rz * l;
    let y = base + curl * q * q * q;
    if (fall) {
      // Sheets follow the flight and the trail keeps their centreline clear of the ground; this
      // lifts the banks (and anything the smoothed cross-section still brings too close).
      const c = o.fallClearance;
      const h = Math.max(
        terrain.heightAt(vx, vz),
        terrain.heightAt(vx - hx, vz - hz),
        terrain.heightAt(vx + hx, vz + hz),
      );
      if (h > y - c) y = h + c;
    } else if (ocean || k === MID) {
      const g = terrain.heightAt(vx, vz) + o.landClearance;
      if (g > y) y = g;
    }
    const p = off + k * 3;
    pos[p] = vx;
    pos[p + 1] = y;
    pos[p + 2] = vz;
    if (lat) {
      lat[latOff + k * 2] = rx * l;
      lat[latOff + k * 2 + 1] = rz * l;
    }
  }
  if (land) {
    // At a waterfall lip the river is about to pour over an edge, often at an angle: keep those
    // sections level so no bank drapes over the edge and cuts into it between sections.
    let drape = true;
    for (let j = i + 1; j <= i + LIP_LOOKAHEAD && j <= hi; j++) {
      if (samples[j].kind === 'fall') drape = false;
    }
    // Water held up above the terrain (on the glacier socket's ice floor, a kicker's exact lip)
    // stays level across too: draped down to the ground its banks would sink under what holds it.
    if (sm.y - terrain.heightAt(sm.x, sm.z) > o.landClearance + o.maxHover) drape = false;
    drapeBank(terrain, o, pos, off, -1, hwL / MID, base, curl, bias, drape);
    drapeBank(terrain, o, pos, off, 1, hwR / MID, base, curl, bias, drape);
  }
  // A waterfall section, or the plunge pool's first one, also lifts any vertex whose quads back
  // to the previous section would cut into the ground, e.g. a bank still over the edge of an
  // angled lip, or a ridge before the base. The previous section's vertex is estimated from its
  // sample (height, tangent, width) and the ground under it, as its own vertex lift would put it.
  if (i > lo && (fall || samples[i - 1].kind === 'fall')) {
    const prev = samples[i - 1];
    smoothTangent(samples, i - 1, radius, lo, hi);
    const prx = -tan.z * prev.width * 0.5;
    const prz = tan.x * prev.width * 0.5;
    const c = fall ? o.fallClearance : o.landClearance;
    const cPrev = prev.kind === 'fall' ? o.fallClearance : o.landClearance;
    for (let k = 0; k < CROSS; k++) {
      const p = off + k * 3;
      // the edges back to the previous section's vertex k and (the quads' diagonal) k + 1
      for (let e = k; e <= k + 1 && e < CROSS; e++) {
        const f = (e - MID) / MID;
        const qx = prev.x + prx * f;
        const qz = prev.z + prz * f;
        const yPrev = Math.max(prev.y + bias, terrain.heightAt(qx, qz) + cPrev);
        const hm = terrain.heightAt(0.5 * (pos[p] + qx), 0.5 * (pos[p + 2] + qz));
        // lifting this vertex by L lifts the point halfway back by L/2
        const need = 2 * (hm + c) - yPrev;
        if (need > pos[p + 1]) pos[p + 1] = need;
      }
    }
  }
}

/**
 * Heights of one bank's land vertices (dir = ±1 from the centre vertex, whose height is set),
 * walked outward. Water stays level over higher or nearly level ground and (if `drape`) drapes
 * onto lower ground; at a drop-off the rest of the bank stays level instead, because draping over
 * a convex edge would cut the water into it (e.g. a cliff edge beside the river).
 */
function drapeBank(
  terrain: Terrain,
  o: RiverGeometryOptions,
  pos: Float64Array,
  off: number,
  dir: number,
  step: number,
  base: number,
  curl: number,
  bias: number,
  drape: boolean,
): void {
  let shelf = false;
  for (let j = 1; j <= MID; j++) {
    const p = off + (MID + dir * j) * 3;
    const pin = p - dir * 3;
    const q = j / MID;
    const qin = (j - 1) / MID;
    const level = base + curl * q * q * q;
    const x = pos[p];
    const z = pos[p + 2];
    const yIn = pos[pin + 1];
    const g = terrain.heightAt(x, z) + o.landClearance;
    const flat = level > g ? level : g;
    let y = drape ? Math.max(g, Math.min(level, g + o.maxHover + bias)) : flat;
    if (!shelf && y < flat) {
      shelf =
        yIn - y > o.dropOffSlope * step || cutsUnder(terrain, pos[pin], pos[pin + 2], yIn, x, z, y);
    }
    if (shelf) y = Math.max(g, Math.min(flat, yIn + curl * (q * q * q - qin * qin * qin)));
    pos[p + 1] = y;
  }
}

/** True if the straight water edge from (ax, ay, az) to (bx, by, bz) passes under the terrain. */
function cutsUnder(
  terrain: Terrain,
  ax: number,
  az: number,
  ay: number,
  bx: number,
  bz: number,
  by: number,
): boolean {
  for (let f = 0.25; f < 1; f += 0.25) {
    if (terrain.heightAt(ax + (bx - ax) * f, az + (bz - az) * f) > ay + (by - ay) * f) return true;
  }
  return false;
}

/** Positions (x, y, z × RIVER_CROSS_VERTS) of the cross-section at sample i, for inspection. */
export function riverCrossSection(
  samples: readonly RiverSample[],
  i: number,
  terrain: Terrain,
  opts?: Partial<RiverGeometryOptions>,
): Float64Array {
  const out = new Float64Array(CROSS * 3);
  writeCrossSection(samples, i, terrain, { ...DEFAULT_RIVER_GEOMETRY_OPTIONS, ...opts }, out, 0, null, 0);
  return out;
}

let scratch = new Float64Array((RIVER_CHUNK_SEGMENTS + 3) * CROSS * 3);

/**
 * Build cross-sections for samples [start, end] (inclusive) into `out` (allocated if omitted).
 * Allocation-free when `out` is passed and `opts` is the same object across calls.
 *
 * Incremental mode: pass `from` > start with an `out` previously built for the same `start`
 * and only cross-sections [from, end] are rewritten (bounds only grow). The caller must choose
 * `from` ≤ (first changed sample − RIVER_GEOMETRY_REACH).
 */
export function buildRiverChunk(
  samples: readonly RiverSample[],
  start: number,
  end: number,
  terrain: Terrain,
  out?: RiverChunkGeometry,
  opts: RiverGeometryOptions = DEFAULT_RIVER_GEOMETRY_OPTIONS,
  from: number = start,
): RiverChunkGeometry {
  const n = samples.length;
  const s0 = Math.max(0, start);
  const s1 = Math.min(n - 1, end);
  const count = Math.max(0, s1 - s0 + 1);
  const g = out ?? createRiverChunkGeometry(Math.max(2, count));
  if (count > g.maxCrossSections) {
    throw new Error(`river chunk of ${count} cross-sections exceeds capacity ${g.maxCrossSections}`);
  }
  const partial = out !== undefined && from > s0 && g.start === s0 && g.crossSections > 0 && count > 0;
  const w0 = partial ? Math.min(from, g.start + g.crossSections, s1) : s0;
  g.start = s0;
  g.end = s1;
  g.crossSections = count;
  g.writtenFrom = w0 - s0;
  g.vertexCount = count * CROSS;
  g.indexCount = Math.max(0, count - 1) * (CROSS - 1) * 6;
  const b = g.bounds;
  if (!partial) {
    g.hasOcean = false;
    g.hasFall = false;
    b.minX = b.minY = b.minZ = Infinity;
    b.maxX = b.maxY = b.maxZ = -Infinity;
  }
  if (count === 0) return g;

  // Segment c joins cross-sections c and c + 1; only segments touching rewritten ones can change.
  let indexChanged = false;
  for (let c = partial ? Math.max(0, w0 - s0 - 1) : 0; c < count - 1; c++) {
    const gap = samples[s0 + c + 1].gapBefore === true ? 1 : 0;
    if (g.segmentGap[c] === gap) continue;
    writeSegmentIndices(g.index, c, gap === 1);
    g.segmentGap[c] = gap;
    indexChanged = true;
  }
  if (indexChanged) g.indexVersion++;

  // positions of [lo, hi] = one extra cross-section each side, for normals
  const lo = Math.max(0, w0 - 1);
  const hi = Math.min(n - 1, s1 + 1);
  const rowLen = CROSS * 3;
  const need = (hi - lo + 1) * rowLen;
  if (scratch.length < need) scratch = new Float64Array(need);
  const P = scratch;
  for (let i = lo; i <= hi; i++) {
    const inRange = i >= w0 && i <= s1;
    const lat = inRange ? g.lateral : null;
    writeCrossSection(samples, i, terrain, opts, P, (i - lo) * rowLen, lat, (i - s0) * CROSS * 2);
  }

  for (let i = w0; i <= s1; i++) {
    const sm = samples[i];
    const row = (i - lo) * rowLen;
    // one-sided differences at a gap, as at the ends of the trail
    const prevRow = (i > lo && !sm.gapBefore ? i - 1 - lo : i - lo) * rowLen;
    const nextRow = (i < hi && !samples[i + 1].gapBefore ? i + 1 - lo : i - lo) * rowLen;
    const vBase = (i - s0) * CROSS;
    const isFall = sm.kind === 'fall' ? 1 : 0;
    const isOcean = sm.kind === 'ocean' ? 1 : 0;
    if (isFall) g.hasFall = true;
    if (isOcean) g.hasOcean = true;
    for (let k = 0; k < CROSS; k++) {
      const p = row + k * 3;
      const kl = row + Math.max(k - 1, 0) * 3;
      const kr = row + Math.min(k + 1, CROSS - 1) * 3;
      const ax = P[kr] - P[kl];
      const ay = P[kr + 1] - P[kl + 1];
      const az = P[kr + 2] - P[kl + 2];
      const bx = P[nextRow + k * 3] - P[prevRow + k * 3];
      const by = P[nextRow + k * 3 + 1] - P[prevRow + k * 3 + 1];
      const bz = P[nextRow + k * 3 + 2] - P[prevRow + k * 3 + 2];
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nl > 1e-9) {
        nx /= nl;
        ny /= nl;
        nz /= nl;
      } else {
        nx = 0;
        ny = 1;
        nz = 0;
      }
      const v = vBase + k;
      const x = P[p];
      const y = P[p + 1];
      const z = P[p + 2];
      g.position[v * 3] = x;
      g.position[v * 3 + 1] = y;
      g.position[v * 3 + 2] = z;
      g.normal[v * 3] = nx;
      g.normal[v * 3 + 1] = ny;
      g.normal[v * 3 + 2] = nz;
      g.uv[v * 2] = k / (CROSS - 1);
      g.uv[v * 2 + 1] = sm.s;
      g.flowSpeed[v] = sm.flowSpeed;
      g.turbulence[v] = sm.turbulence;
      g.fall[v] = isFall;
      g.ocean[v] = isOcean;
      g.birth[v] = sm.t;
      if (x < b.minX) b.minX = x;
      if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y;
      if (y > b.maxY) b.maxY = y;
      if (z < b.minZ) b.minZ = z;
      if (z > b.maxZ) b.maxZ = z;
    }
  }
  return g;
}
