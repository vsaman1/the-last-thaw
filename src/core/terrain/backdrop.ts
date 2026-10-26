import { BufferAttribute, BufferGeometry, Color, Sphere, Vector3 } from 'three';
import type { Terrain } from '../types';
import { gridValue } from '../heightGrid';
import { clamp, lerp, smoothstep } from '../math';
import { fbm2, hash2, ridged2 } from '../rng';
import { isGeneratedTerrain } from './terrain';
import { dirtPatchAt, isSnowAt, snowLineFor, themeOf, type ThemeDef } from './themes';

/**
 * The world around a level: low-poly land and seabed continuing from the level's bounds out to the
 * horizon, so the level never reads as a cut-out slab. Render-only (nothing collides with it, the
 * level's heights are untouched) and deterministic from the level seed.
 *
 * Shape: closed rings at growing offsets d from the bounds rectangle (rounded at the corners), zipped
 * into triangles. Ring 0 is exactly the height grid's boundary vertices, so the join with the terrain
 * mesh is watertight. Rings get coarser with distance (spacing ≈ 2 cells + growth·d), which keeps the
 * whole world at a few tens of thousands of triangles.
 *
 * Height at offset d beyond perimeter position s. Near the bounds the level's edge carries on: its
 * profile blurred along the perimeter by a window that grows with d (the edge's detail melts into
 * broad landforms instead of streaking outward), land and seabed blurred apart (a wall is never
 * averaged into the sea), plus the edge's outward slope carried on for a while (walls keep rising,
 * the seabed keeps falling: no crease along the bounds). By farBlend it has settled into the far
 * field: land behind a wandering coast line across the course's end, at the edge's typical height
 * and climbing inland like the level does, open sea ahead. On land the theme's ranges (ridged or
 * rolling noise, terraced into mesas for the canyon) and foothills rise in with d and climb from the
 * shore; under the sea the seabed falls away, so the sea opens to the horizon. Colours follow the
 * level's terrain palette near the bounds (rock and snow where its edge has them, so the seam does
 * not show) and the theme's backdrop palette further out (forest, fields, snow on the high ranges).
 */
export const BACKDROP = {
  /** How far (m) the world continues beyond the level bounds. */
  reach: 12000,
  /** Ring spacing (m) = firstCells × cellSize + growth × d... */
  firstCells: 2,
  growth: 0.08,
  /** Edge profile blur half-window (m) per metre of distance from the bounds, and its cap. */
  blurPerMetre: 0.5,
  blurMax: 250,
  /**
   * Near the bounds the world continues the level's edge; by this distance (m) it has settled into
   * the far field: land behind a coast line across the course's end, open sea ahead of it.
   */
  farBlend: 700,
  /** The edge's outward slope is read this far inside the bounds (m, ≤ a quarter of the level)... */
  slopeInset: 16,
  /** ...clamped to this range (rise per metre) and carried on with this e-folding distance (m). */
  slopeMin: -1,
  slopeMax: 1.5,
  slopeReach: 45,
  /** Distance (m) over which the theme's ranges rise to full height... */
  reliefRamp: 900,
  /** ...their peak height (m, × the theme's heightScale)... */
  peak: 640,
  /** ...and a general rise of the land away from the level (m, × heightScale) over liftRamp. */
  lift: 160,
  liftRamp: 1600,
  /** Foothills a third the size of the ranges (m, × heightScale), in by hillRamp metres out. */
  hills: 70,
  hillRamp: 500,
  /** Land rises from the far coast line to full height over this distance inland (m)... */
  coastRise: 350,
  /** ...and near the bounds from the shore over about this much (m) of edge beside the coast. */
  shoreWidth: 500,
  /** Small hummocks on land: height per metre of distance, capped at detailReach metres. */
  detail: 0.12,
  detailReach: 140,
  /** The far coastline wanders by up to this × d (m, d capped at 3 km)... */
  coastWarp: 0.25,
  /** ...and the seabed falls away at this slope down to seaDepth below sea level. */
  seaFall: 0.05,
  seaDepth: 45,
  /** Colours: the level's terrain palette fades into the theme's backdrop palette by this distance. */
  nearPalette: 1100,
  /** Budget the builder is tested against, for every level. */
  maxTriangles: 100_000,
} as const;

const B = BACKDROP;

export interface BackdropOptions {
  /** How far (m) the world continues beyond the bounds (default BACKDROP.reach). */
  reach?: number;
  seed?: number;
}

/** The level bounds as the backdrop sees them: the height grid's own extent. */
interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

function gridRect(terrain: Terrain): Rect {
  const g = terrain.grid;
  return {
    x0: g.originX,
    z0: g.originZ,
    x1: g.originX + (g.cols - 1) * g.cellSize,
    z1: g.originZ + (g.rows - 1) * g.cellSize,
  };
}

/** Horizontal distance (m) from (x, z) to the rectangle (0 inside). */
function distanceToRect(r: Rect, x: number, z: number): number {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}

/**
 * Distance (m) from a point to the outer edge of the backdrop around a terrain: the world ends no
 * nearer than this in any direction (render code keeps its fog thick enough by then).
 */
export function backdropHorizon(terrain: Terrain, x: number, z: number, reach: number = B.reach): number {
  return Math.max(0, reach - distanceToRect(gridRect(terrain), x, z));
}

/** Spacing (m) of ring samples and between rings at distance d from the bounds. */
const spacingAt = (cell: number, d: number): number => B.firstCells * cell + B.growth * d;

/** Ring offsets from 0 (the bounds) out to `reach`. */
export function backdropRingOffsets(cell: number, reach: number): number[] {
  const out = [0];
  let d = 0;
  while (d < reach) {
    d = Math.min(reach, d + spacingAt(cell, d));
    // Avoid a sliver ring just inside the last one.
    if (reach - d < 0.35 * spacingAt(cell, d)) d = reach;
    out.push(d);
  }
  return out;
}

/** One closed ring: world x/z, perimeter position s of the foot point, and the outward normal. */
interface Ring {
  d: number;
  n: number;
  x: Float64Array;
  z: Float64Array;
  s: Float64Array;
  y: Float64Array;
  /** Rockiness and snow cover carried out from the edge (0..1), blurred like the heights. */
  rock: Float64Array;
  snow: Float64Array;
}

function newRing(d: number, n: number): Ring {
  return {
    d,
    n,
    x: new Float64Array(n),
    z: new Float64Array(n),
    s: new Float64Array(n),
    y: new Float64Array(n),
    rock: new Float64Array(n),
    snow: new Float64Array(n),
  };
}

/**
 * Ring 0: every boundary vertex of the height grid, counter-clockwise seen from above starting at
 * (minX, minZ): along minZ, up maxX, back along maxZ, down minX. Perimeter position s = index × cell.
 */
function edgeRing(terrain: Terrain): { ring: Ring; nx: Float64Array; nz: Float64Array } {
  const g = terrain.grid;
  const c = g.cellSize;
  const cx = g.cols - 1;
  const cz = g.rows - 1;
  const n = 2 * cx + 2 * cz;
  const ring = newRing(0, n);
  const nx = new Float64Array(n);
  const nz = new Float64Array(n);
  let k = 0;
  const put = (ix: number, iz: number, ox: number, oz: number): void => {
    ring.x[k] = g.originX + ix * c;
    ring.z[k] = g.originZ + iz * c;
    ring.y[k] = gridValue(g, ix, iz);
    ring.s[k] = k * c;
    nx[k] = ox;
    nz[k] = oz;
    k++;
  };
  for (let ix = 0; ix < cx; ix++) put(ix, 0, 0, -1);
  for (let iz = 0; iz < cz; iz++) put(cx, iz, 1, 0);
  for (let ix = cx; ix > 0; ix--) put(ix, cz, 0, 1);
  for (let iz = cz; iz > 0; iz--) put(0, iz, -1, 0);
  return { ring, nx, nz };
}

/** A ring at offset d > 0: the rectangle's sides pushed out by d, joined by quarter circles. */
function offsetRing(r: Rect, d: number, step: number): Ring {
  const W = r.x1 - r.x0;
  const H = r.z1 - r.z0;
  const ne = (len: number): number => Math.max(1, Math.round(len / step));
  const nW = ne(W);
  const nH = ne(H);
  const nC = Math.max(1, Math.round((0.5 * Math.PI * d) / step));
  const ring = newRing(d, 2 * nW + 2 * nH + 4 * nC);
  let k = 0;
  const put = (x: number, z: number, s: number): void => {
    ring.x[k] = x;
    ring.z[k] = z;
    ring.s[k] = s;
    k++;
  };
  const arc = (cx: number, cz: number, a0: number, s: number): void => {
    for (let j = 0; j < nC; j++) {
      const a = a0 + (0.5 * Math.PI * j) / nC;
      put(cx + d * Math.cos(a), cz + d * Math.sin(a), s);
    }
  };
  for (let j = 0; j < nW; j++) put(r.x0 + (W * j) / nW, r.z0 - d, (W * j) / nW);
  arc(r.x1, r.z0, -0.5 * Math.PI, W);
  for (let j = 0; j < nH; j++) put(r.x1 + d, r.z0 + (H * j) / nH, W + (H * j) / nH);
  arc(r.x1, r.z1, 0, W + H);
  for (let j = 0; j < nW; j++) put(r.x1 - (W * j) / nW, r.z1 + d, W + H + (W * j) / nW);
  arc(r.x0, r.z1, 0.5 * Math.PI, 2 * W + H);
  for (let j = 0; j < nH; j++) put(r.x0 - d, r.z1 - (H * j) / nH, 2 * W + H + (H * j) / nH);
  arc(r.x0, r.z0, Math.PI, 2 * W + 2 * H);
  return ring;
}

/** Circular box blur of `src` with half-width m samples (prefix sums; m ≥ n/2 gives the mean). */
function boxBlur(src: Float64Array, m: number, out: Float64Array): void {
  const n = src.length;
  if (m <= 0) {
    out.set(src);
    return;
  }
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + src[i];
  const total = pre[n];
  if (2 * m + 1 >= n) {
    out.fill(total / n);
    return;
  }
  // Sum of src over [0, k) for any integer k, wrapping.
  const S = (k: number): number => {
    const q = Math.floor(k / n);
    return pre[k - q * n] + q * total;
  };
  const inv = 1 / (2 * m + 1);
  for (let i = 0; i < n; i++) out[i] = (S(i + m + 1) - S(i - m)) * inv;
}

/** Triangle-filtered profile (two box passes) of half-width ≈ w metres, samples `cell` apart. */
function blurProfile(
  src: Float64Array,
  w: number,
  cell: number,
  tmp: Float64Array,
  out: Float64Array,
): void {
  const m = Math.round((0.5 * w) / cell);
  boxBlur(src, m, tmp);
  boxBlur(tmp, m, out);
}

/** Linear sample of a circular profile (samples `cell` apart) at perimeter position s (m). */
function sampleProfile(p: Float64Array, s: number, cell: number): number {
  const n = p.length;
  const u = s / cell;
  const i = Math.floor(u);
  const f = u - i;
  const a = ((i % n) + n) % n;
  const b = (a + 1) % n;
  return p[a] + (p[b] - p[a]) * f;
}

/** Shape of the theme's surrounding ranges at a world point, 0..1. */
function rangeShape(theme: ThemeDef, x: number, z: number, seed: number): number {
  const st = theme.backdrop;
  const sc = st.rangeScale;
  const wsc = sc * 1.7;
  const wx = x / sc + 0.6 * fbm2(x / wsc, z / wsc, seed + 11, 2);
  const wz = z / sc + 0.6 * fbm2(x / wsc + 7.3, z / wsc - 3.1, seed + 12, 2);
  const ridge = Math.pow(ridged2(wx, wz, seed + 13, 4), 1.35);
  const roll = 0.5 + 0.5 * fbm2(wx * 0.7, wz * 0.7, seed + 14, 4);
  // Broad massifs and lowlands, so the ranges are not one uniform field of peaks.
  const massif = smoothstep(-0.45, 0.55, fbm2(x / (sc * 3.2), z / (sc * 3.2), seed + 15, 2));
  return lerp(roll, ridge, st.ridge) * (0.3 + 0.7 * massif);
}

/** Flat-topped steps of `step` metres above `base` (mesas). */
function terraced(base: number, h: number, step: number): number {
  const q = (h - base) / step;
  const k = Math.floor(q);
  return base + (k + smoothstep(0.8, 1, q - k)) * step;
}

/**
 * Zips two closed rings into a strip of triangles, always taking the shorter of the two candidate
 * diagonals (both rings start at the same corner and run the same way round).
 */
type Emit = (ra: Ring, ia: number, rb: Ring, ib: number, rc: Ring, ic: number) => void;

function zip(a: Ring, b: Ring, emit: Emit): void {
  let i = 0;
  let j = 0;
  while (i < a.n || j < b.n) {
    const ia = i % a.n;
    const ia1 = (i + 1) % a.n;
    const ib = j % b.n;
    const ib1 = (j + 1) % b.n;
    let advanceA: boolean;
    if (i >= a.n) advanceA = false;
    else if (j >= b.n) advanceA = true;
    else {
      const dA = (a.x[ia1] - b.x[ib]) ** 2 + (a.z[ia1] - b.z[ib]) ** 2;
      const dB = (a.x[ia] - b.x[ib1]) ** 2 + (a.z[ia] - b.z[ib1]) ** 2;
      advanceA = dA <= dB;
    }
    if (advanceA) {
      emit(a, ia, a, ia1, b, ib);
      i++;
    } else {
      emit(a, ia, b, ib1, b, ib);
      j++;
    }
  }
}

type RGB = { r: number; g: number; b: number };
const rgb = (hex: string): RGB => {
  const c = new Color(hex);
  return { r: c.r, g: c.g, b: c.b };
};

export interface BackdropStats {
  triangles: number;
  rings: number;
  reach: number;
}

/**
 * Builds the world around a terrain as one non-indexed, flat-shaded, vertex-coloured geometry
 * (position, normal, color). Caller disposes. `userData.stats` holds BackdropStats.
 */
export function buildBackdropGeometry(terrain: Terrain, opts: BackdropOptions = {}): BufferGeometry {
  const g = terrain.grid;
  const level = terrain.level;
  const sea = level.seaLevel;
  const seed = opts.seed ?? level.seed + 404;
  const reach = Math.max(10 * g.cellSize, opts.reach ?? B.reach);
  const gen = isGeneratedTerrain(terrain) ? terrain : null;
  const theme = gen ? gen.theme : themeOf(level);
  const st = theme.backdrop;
  const cell = g.cellSize;
  const rect = gridRect(terrain);

  // --- the level's edge: heights, outward slope and rockiness along the perimeter ---------------
  const { ring: ring0, nx, nz } = edgeRing(terrain);
  const n0 = ring0.n;
  const edgeH = ring0.y;
  const edgeSlope = new Float64Array(n0);
  const edgeRock = new Float64Array(n0);
  const edgeSnow = new Float64Array(n0);
  const startFloor = terrain.course.sampleAt(level.startS).floor;
  const nearSnowLine = gen ? gen.snowLine : snowLineFor(theme, startFloor, sea);
  const inset = Math.min(B.slopeInset, 0.25 * Math.min(rect.x1 - rect.x0, rect.z1 - rect.z0));
  for (let i = 0; i < n0; i++) {
    const x = ring0.x[i];
    const z = ring0.z[i];
    const inner = terrain.heightAt(x - nx[i] * inset, z - nz[i] * inset);
    edgeSlope[i] = clamp((edgeH[i] - inner) / inset, B.slopeMin, B.slopeMax);
    const kind = terrain.surfaceAt(x - nx[i] * 0.5 * cell, z - nz[i] * 0.5 * cell);
    edgeRock[i] = kind === 'rock' ? 1 : 0;
    const gr = terrain.gradientAt(x - nx[i] * 0.5 * cell, z - nz[i] * 0.5 * cell);
    const slope = Math.hypot(gr.dx, gr.dz);
    edgeSnow[i] = isSnowAt(theme, nearSnowLine, edgeH[i], slope, x, z, level.seed) ? 1 : 0;
  }
  ring0.rock.set(edgeRock);
  ring0.snow.set(edgeSnow);

  // Soft land (0 sea .. 1 land) along the edge, and heights split by it so that blurring never
  // averages a high wall into the sea (or the sea into a beach plateau).
  const edgeLand = new Float64Array(n0);
  const edgeLandH = new Float64Array(n0);
  const edgeSeaH = new Float64Array(n0);
  let landSum = 0;
  let landN = 0;
  let seaSum = 0;
  let seaN = 0;
  for (let i = 0; i < n0; i++) {
    const l = smoothstep(sea - 1.5, sea + 1.5, edgeH[i]);
    edgeLand[i] = l;
    edgeLandH[i] = edgeH[i] * l;
    edgeSeaH[i] = edgeH[i] * (1 - l);
    if (l >= 0.5) {
      landSum += edgeH[i];
      landN++;
    } else {
      seaSum += edgeH[i];
      seaN++;
    }
  }
  /** Typical land / seabed heights of the edge: what the far field settles to. */
  const landHome = landN > 0 ? landSum / landN : sea + 20;
  const seaHome = Math.min(sea - 3, seaN > 0 ? seaSum / seaN : sea - 15);

  // Far field: the coast runs across the course's last stretch, through its coast point; land
  // behind it, open sea ahead (wandering into bays and headlands further out).
  const course = terrain.course;
  const coastS = Math.min(level.coastS, course.length);
  const coast = gen ? gen.coastPos : course.toWorld(coastS, 0);
  const back = course.toWorld(Math.max(0, coastS - 300), 0);
  const tip = course.toWorld(course.length, 0);
  const seaDirLen = Math.hypot(tip.x - back.x, tip.z - back.z) || 1;
  const seaX = (tip.x - back.x) / seaDirLen;
  const seaZ = (tip.z - back.z) / seaDirLen;
  // Inland of a coastal plain the region stands at least at the edge's typical land height and
  // climbs away from the sea like the level does (from its start down to the coast), up to regionCap.
  const start = gen ? gen.startPos : course.toWorld(level.startS, 0);
  const startH = terrain.heightAt(start.x, start.z);
  const ref = Math.max(startH, landHome) - sea;
  const startBack = Math.max(150, (coast.x - start.x) * seaX + (coast.z - start.z) * seaZ);
  const regionGrad = clamp(ref / startBack, 0.02, 0.3);
  const regionCap = Math.max(40, 1.4 * ref);

  // --- rings --------------------------------------------------------------------------------------
  const offsets = backdropRingOffsets(cell, reach);
  const rings: Ring[] = [ring0];
  const tmp = new Float64Array(n0);
  const pLand = new Float64Array(n0);
  // How far inland along the edge (a wide blur of the land): the shore climbs over this.
  const pShore = new Float64Array(n0);
  blurProfile(edgeLand, B.shoreWidth, cell, tmp, pShore);
  const pLandH = new Float64Array(n0);
  const pSeaH = new Float64Array(n0);
  const pSlope = new Float64Array(n0);
  const pRock = new Float64Array(n0);
  const pSnow = new Float64Array(n0);
  let blurred = -1;
  const peak = B.peak * st.heightScale;
  const lift = B.lift * st.heightScale;
  const hills = B.hills * st.heightScale;
  const hillScale = st.rangeScale / 3;
  for (let k = 1; k < offsets.length; k++) {
    const d = offsets[k];
    const ring = offsetRing(rect, d, spacingAt(cell, d));
    const w = Math.min(B.blurPerMetre * d, B.blurMax);
    const m = Math.round((0.5 * w) / cell);
    if (m !== blurred) {
      blurred = m;
      blurProfile(edgeLand, w, cell, tmp, pLand);
      blurProfile(edgeLandH, w, cell, tmp, pLandH);
      blurProfile(edgeSeaH, w, cell, tmp, pSeaH);
      blurProfile(edgeSlope, w, cell, tmp, pSlope);
      blurProfile(edgeRock, w, cell, tmp, pRock);
      blurProfile(edgeSnow, w, cell, tmp, pSnow);
    }
    const far = smoothstep(0, B.farBlend, d);
    const carry = B.slopeReach * (1 - Math.exp(-d / B.slopeReach)) * (1 - far);
    const ramp = smoothstep(0, B.reliefRamp, d);
    const hillRamp = smoothstep(0, B.hillRamp, d);
    const rise = lift * smoothstep(0, B.liftRamp, d);
    const detailAmp = B.detail * Math.min(d, B.detailReach);
    const warpAmp = B.coastWarp * Math.min(d, 3000);
    const coastSoft = 30 + 0.04 * d;
    const fall = Math.min(B.seaDepth, d * B.seaFall);
    const mesa = st.terrace > 0 ? smoothstep(80, 400, d) : 0;
    // Mesa steps grow with the faces, so the far cliffs stay wider than a face is tall.
    const step = st.terrace * (1 + Math.min(d, 1500) / 500);
    const shoreIn = smoothstep(0, 0.5 * B.shoreWidth, d);
    for (let i = 0; i < ring.n; i++) {
      const x = ring.x[i];
      const z = ring.z[i];
      const s = ring.s[i];
      // Near field: the edge carried outward.
      const lN = sampleProfile(pLand, s, cell);
      const hL = lN > 1e-3 ? sampleProfile(pLandH, s, cell) / lN : landHome;
      const hS = lN < 1 - 1e-3 ? sampleProfile(pSeaH, s, cell) / (1 - lN) : seaHome;
      // Far field: which side of the (wandering) coast line the point lies on.
      const wander = warpAmp * fbm2(x / 900, z / 900, seed + 21, 3);
      const ahead = (x - coast.x) * seaX + (z - coast.z) * seaZ + wander;
      const lF = smoothstep(coastSoft, -coastSoft, ahead);
      const lRaw = lerp(lN, lF, far);
      const land = smoothstep(0.35, 0.65, lRaw);
      // Away from the sea the land climbs from the shore to the edge's land height (near), or with
      // the level's own fall to the sea (far), and the ranges grow in: a shore, not a cliff.
      const inland = smoothstep(0, B.coastRise, -ahead);
      const shore = lerp(1, smoothstep(0.5, 0.95, sampleProfile(pShore, s, cell)), shoreIn);
      const nearUp = smoothstep(0.5, 1, lRaw) * shore;
      const upland = lerp(nearUp, inland, far);
      const plateau = Math.max(landHome - sea, Math.min(regionGrad * Math.max(0, -ahead), regionCap));
      const farLand = sea + 2.5 + inland * Math.max(0, plateau - 2.5);
      const hLand = lerp(lerp(sea + 2.5, hL, nearUp), farLand, far);
      const base = lerp(lerp(hS, seaHome, far), hLand, land);
      // Carry the edge's outward slope on, but never so far down that land turns into sea.
      const cont = Math.max(sampleProfile(pSlope, s, cell) * carry, -0.5 * Math.max(0, base - sea - 8));
      let h = base + cont - (1 - land) * fall;
      if (land > 0) {
        const hill = hills * hillRamp * (0.5 + 0.5 * fbm2(x / hillScale, z / hillScale, seed + 17, 3));
        const relief = (peak * ramp * rangeShape(theme, x, z, seed) + rise + hill) * upland;
        const detail = detailAmp * (0.5 + 0.5 * fbm2(x / 85, z / 85, seed + 31, 3));
        h += land * (relief + detail);
        if (mesa > 0) h = lerp(h, terraced(sea, h, step), mesa * land);
      }
      ring.y[i] = h;
      ring.rock[i] = sampleProfile(pRock, s, cell) * (1 - far);
      ring.snow[i] = sampleProfile(pSnow, s, cell) * (1 - far);
    }
    rings.push(ring);
  }

  // --- triangles ----------------------------------------------------------------------------------
  const pos: number[] = [];
  const rock: number[] = [];
  const snow: number[] = [];
  const emit = (ra: Ring, ia: number, rb: Ring, ib: number, rc: Ring, ic: number): void => {
    const ax = ra.x[ia];
    const az = ra.z[ia];
    const ux = rb.x[ib] - ax;
    const uz = rb.z[ib] - az;
    const vx = rc.x[ic] - ax;
    const vz = rc.z[ic] - az;
    const ny = uz * vx - ux * vz;
    if (Math.abs(ny) < 1e-9) return;
    // Wind counter-clockwise from above, so every face points up.
    const [r1, i1, r2, i2] = ny > 0 ? [rb, ib, rc, ic] : [rc, ic, rb, ib];
    pos.push(ax, ra.y[ia], az, r1.x[i1], r1.y[i1], r1.z[i1], r2.x[i2], r2.y[i2], r2.z[i2]);
    rock.push((ra.rock[ia] + r1.rock[i1] + r2.rock[i2]) / 3);
    snow.push((ra.snow[ia] + r1.snow[i1] + r2.snow[i2]) / 3);
  };
  for (let k = 0; k + 1 < rings.length; k++) zip(rings[k], rings[k + 1], emit);

  // --- colours ------------------------------------------------------------------------------------
  const T = theme.terrain;
  const near = {
    grass: rgb(T.grass),
    grassDeep: rgb(T.grassDeep),
    accent: rgb(T.grassAccent),
    sand: rgb(T.sand),
    sandWet: rgb(T.sandWet),
    seabed: rgb(T.seabed),
    seabedDeep: rgb(T.seabedDeep),
    snow: rgb(T.snow),
    snowShade: rgb(T.snowShade),
    dirt: rgb(T.dirt),
    dark: rgb(T.rockDark),
  };
  const far = {
    grass: rgb(st.grass),
    rock: rgb(st.rock),
    rockWarm: rgb(st.rockWarm),
    snow: rgb(st.snow),
    sand: rgb(st.sand),
    seabed: rgb(st.seabed),
    forest: rgb(theme.scenery.coniferLow),
  };
  const bands = theme.rockBands.map(rgb);
  const nb = bands.length;
  const strata = theme.bandMode === 'strata';
  const fieldColours = [near.grass, near.accent, near.grassDeep, near.dirt, near.sand];
  // Snow caps the high ranges only: never below the theme's snow height, the level's own snow line
  // or the upper part of the ranges. Near the bounds the edge's own snow cover carries on instead.
  const farSnowLine = Number.isFinite(st.snowAt)
    ? Math.max(
        sea + st.snowAt,
        Number.isFinite(nearSnowLine) ? nearSnowLine + 40 : -Infinity,
        landHome + lift + 0.3 * peak,
      )
    : Infinity;
  const snowMaxSlope = theme.snow?.maxSlope ?? 1.1;
  const forestEdge = 0.35 - 0.7 * st.forest;
  /** Whether this world has snow at all (ragged snow-line noise is only needed then). */
  const snowy0 = Number.isFinite(farSnowLine) || edgeSnow.some((v) => v > 0);
  const fieldCos = Math.cos(0.37);
  const fieldSin = Math.sin(0.37);

  const triCount = pos.length / 9;
  const positions = new Float32Array(pos);
  const normals = new Float32Array(pos.length);
  const colors = new Float32Array(pos.length);
  const out: RGB = { r: 0, g: 0, b: 0 };
  const mix = (a: RGB, b: RGB, t: number): void => {
    out.r = lerp(a.r, b.r, t);
    out.g = lerp(a.g, b.g, t);
    out.b = lerp(a.b, b.b, t);
  };
  const mixInto = (b: RGB, t: number): void => {
    out.r = lerp(out.r, b.r, t);
    out.g = lerp(out.g, b.g, t);
    out.b = lerp(out.b, b.b, t);
  };
  const mod = (k: number, n: number): number => ((k % n) + n) % n;
  /** Near-rock colour: the terrain's strata / stripes, coarser where faces are large. */
  const nearRock = (h: number, cx: number, cz: number, size: number): RGB => {
    const step = theme.bandStep * Math.max(1, size / (4 * theme.bandStep));
    const u = h / step + 0.9 * fbm2(cx / 55, cz / 55, level.seed + 93, 2);
    if (!strata) return Math.floor(u / 2) % 3 === 0 && nb > 1 ? bands[1] : bands[0];
    return bands[mod(Math.floor(u), nb)];
  };

  for (let t = 0; t < triCount; t++) {
    const f = t * 9;
    const ax = positions[f];
    const ay = positions[f + 1];
    const az = positions[f + 2];
    const ux = positions[f + 3] - ax;
    const uy = positions[f + 4] - ay;
    const uz = positions[f + 5] - az;
    const vx = positions[f + 6] - ax;
    const vy = positions[f + 7] - ay;
    const vz = positions[f + 8] - az;
    let fx = uy * vz - uz * vy;
    let fy = uz * vx - ux * vz;
    let fz = ux * vy - uy * vx;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl;
    fy /= fl;
    fz /= fl;
    const slope = fy > 1e-6 ? Math.hypot(fx, fz) / fy : 1e6;
    const cx = ax + (ux + vx) / 3;
    const cy = ay + (uy + vy) / 3;
    const cz = az + (uz + vz) / 3;
    const dC = distanceToRect(rect, cx, cz);
    const size = spacingAt(cell, dC);
    const rnd = hash2(t, 7, seed);
    const nearW = 1 - smoothstep(30, B.nearPalette, dC);
    const edgeW = 1 - smoothstep(20, 200, dC);

    if (cy < sea - 0.3) {
      mix(near.seabed, near.seabedDeep, smoothstep(sea - 1, sea - 12, cy));
      mixInto(far.seabed, 1 - nearW);
    } else if (cy < sea + 2.5 && slope < 0.6) {
      mix(near.sandWet, near.sand, smoothstep(sea + 0.1, sea + 1.4, cy));
      mixInto(far.sand, 1 - nearW);
    } else {
      const ragged = snowy0 ? 40 * (0.5 + 0.5 * fbm2(cx / 300, cz / 300, seed + 61, 2)) : 0;
      const snowLine = farSnowLine + ragged;
      const rockSlope = smoothstep(0.6, 1.1, slope);
      const rockHigh = smoothstep(snowLine - 140, snowLine - 30, cy);
      const rockiness = lerp(Math.max(rockSlope, rockHigh), rock[t], edgeW);
      const patchy = edgeW > 0 ? 0.7 * edgeW * fbm2(cx / 45, cz / 45, seed + 81, 2) : 0;
      const snowy = lerp(cy > snowLine && slope < snowMaxSlope ? 1 : 0, snow[t], edgeW);
      if (snowy > 0.5 + patchy) {
        mix(near.snow, near.snowShade, smoothstep(0.25, snowMaxSlope, slope));
        mixInto(far.snow, 1 - nearW);
      } else if (rockiness > 0.5 + patchy + 0.15 * (rnd - 0.5)) {
        const nr = nearRock(cy, cx, cz, size);
        const fr = Math.floor(cy / 26 + 2 * rnd) % 3 === 0 ? far.rockWarm : far.rock;
        mix(fr, nr, nearW);
        if (slope > 2.2) mixInto(near.dark, 0.35);
      } else {
        mix(near.grassDeep, near.grass, 0.45 + 0.55 * rnd);
        // The terrain's accent patches, stretched where faces are bigger than the patches.
        if (nearW > 0) {
          const ps = 38 * Math.max(1, size / 12);
          const patch = smoothstep(0.12, 0.42, fbm2(cx / ps, cz / ps, level.seed + 91, 3));
          mixInto(near.accent, patch * theme.grassPatch * nearW);
          if (theme.dirtPatch > 0) mixInto(near.dirt, dirtPatchAt(theme, cx, cz, level.seed) * nearW);
        }
        if (nearW < 1) {
          mixInto(far.grass, 1 - nearW);
          // Broad lighter and darker swathes, so far grassland is not one flat tone.
          const swathe = fbm2(cx / 650, cz / 650, seed + 71, 2);
          mixInto(swathe > 0 ? near.accent : near.grassDeep, Math.min(0.4, Math.abs(swathe)) * (1 - nearW));
        }
        mixInto(near.grassDeep, smoothstep(0.25, 0.7, slope) * 0.45);
        const gentle = 1 - smoothstep(0.2, 0.45, slope);
        if (st.fields > 0 && dC > 30) {
          const fu = Math.floor((cx * fieldCos + cz * fieldSin) / 150);
          const fv = Math.floor((cz * fieldCos - cx * fieldSin) / 95);
          const pick = fieldColours[Math.floor(hash2(fu, fv, seed + 51) * fieldColours.length)];
          mixInto(pick, st.fields * gentle * 0.75 * (1 - smoothstep(sea + 90, sea + 200, cy)));
        }
        const woodIn = smoothstep(40, 220, dC) * (1 - smoothstep(0.9, 1.3, slope));
        if (st.forest > 0 && woodIn > 0) {
          const wood = smoothstep(forestEdge, forestEdge + 0.12, fbm2(cx / 420, cz / 420, seed + 41, 3));
          const treeLine = 1 - smoothstep(snowLine - 220, snowLine - 90, cy);
          mixInto(far.forest, wood * treeLine * woodIn);
        }
      }
    }
    const j = 0.92 + 0.16 * rnd;
    for (let v = 0; v < 9; v += 3) {
      normals[f + v] = fx;
      normals[f + v + 1] = fy;
      normals[f + v + 2] = fz;
      colors[f + v] = out.r * j;
      colors[f + v + 1] = out.g * j;
      colors[f + v + 2] = out.b * j;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  geometry.boundingSphere = box ? box.getBoundingSphere(new Sphere()) : new Sphere(new Vector3(), reach);
  const stats: BackdropStats = { triangles: triCount, rings: rings.length, reach };
  geometry.userData.stats = stats;
  return geometry;
}
