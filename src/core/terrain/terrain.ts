import type {
  CliffDef,
  CourseFrame,
  CourseSample,
  HeightGrid,
  KickerLip,
  LevelDef,
  SurfaceKind,
  Terrain,
  Vec3,
} from '../types';
import { buildGrid, sampleGradient, sampleHeight } from '../heightGrid';
import { clamp, lerp, smoothstep } from '../math';
import { fbm2, ridged2 } from '../rng';
import { cutBridgeApproaches } from './bridgeCuts';
import { CourseGeometry, type CourseProjection } from './course';
import { FeatureField, featureContains, gapLateral, PAINT, type PaintCode } from './features';
import { hasRelief, ReliefField } from './relief';
import type { StreamProfile } from './stream';
import { snowCoverFor, themeOf, type SnowCover, type ThemeDef } from './themes';

/**
 * Terrain generation for a LevelDef.
 *
 * The height function is evaluated once per grid vertex; every query afterwards (heightAt,
 * gradientAt, normalAt, surfaceAt) samples the triangulated grid through src/core/heightGrid.ts,
 * so physics, rendering and gameplay agree exactly.
 *
 * Height model, in course coordinates (s along the centreline, d lateral, u = distance past the
 * floor edge, c = distance past the coastline):
 *   floor(s) [smoothed control floors − cliff steps, blended into a beach + seabed near the coast]
 *   + concave bowl across the floor + low bumps (none on the centreline)
 *   + relief (./relief.ts, open-mountain levels only), faded out near the start, the coast, the
 *     floor edge, cliff lips and under ramps / plateaus / roads
 *   + walls (smoothstep over wallRamp, ridged + terraced) + mountains further out, tapered to 0
 *     over the last `coastTaper` metres before the coastline
 *   + level features (./features.ts), which leave everything outside their footprints untouched.
 * Cliff bands (CliffDef.width) are sheer over their width only; beyond their ends the drop spreads
 * along s over cliffBandSpread m per metre (a slope to ride round), like cliffs do in the walls.
 * Crisp features (ramp lips, gap and island walls) are only as sharp as the grid: levels built
 * around jumps should use cellSize 2 (a 1 km level still builds in well under a second).
 */

export const TERRAIN_TUNING = {
  /** Floor rise at the floor edge (m), so loose things drift to the middle. */
  bowlRise: 0.6,
  /** Floor bump amplitude and feature size (m); bumps fade to 0 within ~2–9 m of the centreline. */
  bumpAmp: 0.22,
  bumpScale: 13,
  /** Fractional height variation of the walls from ridged noise. */
  wallNoise: 0.45,
  wallNoiseScale: 24,
  /** Terrace step (m) and blend (0..1) that give the walls rocky strata. */
  wallTerrace: 3.2,
  wallTerraceMix: 0.35,
  /** Grassy bench above the walls: mountains start this many wallRamps past the floor edge. */
  benchWidth: 0.55,
  /** Mountains outside the walls: base rise + noise amplitude (m), ramp distance and noise scale (m). */
  mountainBase: 30,
  mountainAmp: 90,
  mountainRamp: 120,
  mountainScale: 170,
  /** Extra floor rise per metre behind the course start (headwall of the start cirque). */
  startBackSlope: 0.12,
  /** Away from the floor, cliff steps are spread over min(u * spread, maxSpread) metres. */
  cliffSpreadPerMetre: 2.4,
  cliffMaxSpread: 90,
  /**
   * Beyond the end of a cliff band, its drop is spread over this many metres along s per metre out
   * (max slope 1.5·drop / spread: rideable, < 0.6, from 0.63·drop beyond the end).
   */
  cliffBandSpread: 4,
  /** Relief fades in over this distance (m) inside the floor edge, and after startS + 15. */
  reliefEdge: 20,
  reliefStart: 30,
  /** Bumps are suppressed within this distance (m) of a cliff lip. */
  cliffClear: 12,
  /** Walls/mountains taper to nothing over this many metres before the coastline. */
  coastTaper: 90,
  /** Floor blends from the designed profile to the beach/seabed profile over this distance (m). */
  coastBlend: 70,
  /** Depth of the open-sea floor below sea level (m) and the distance scale of the shelf (m). */
  seaDepth: 14,
  seaShelf: 45,
  /** Headlands either side of the river mouth reach this far seaward (m). */
  headlandOut: 28,
  coastNoiseAmp: 9,
  coastNoiseScale: 30,
  /** Sand band height above sea level (m). */
  sandBand: 2.5,
  /** isOcean threshold below sea level (m). */
  oceanMargin: 0.3,
  /** Slope above which any face is rock; on walls a lower slope suffices. */
  rockSlope: 0.75,
  wallRockSlope: 0.42,
  /** Coarse cell (m) and box-blur radius (cells, 3 passes) of the regional floor under the mountains. */
  regionalCell: 10,
  regionalBlur: 4,
} as const;

const T = TERRAIN_TUNING;

/**
 * Farthest a cliff can be upstream of coastS (on the centreline) and still be reached by the coast
 * blend: coastBlend plus the shoreline wobble. Exported for the level validator and docs.
 */
export const COAST_REACH = T.coastBlend + T.coastNoiseAmp;

/** True for a cliff band (a cliff that is sheer over part of the floor only). */
export const isCliffBand = (c: CliffDef): boolean => c.width !== undefined;

/** Arc length of a cliff's lip at lateral offset d (a skewed band runs diagonally across its width). */
export function cliffLipS(c: CliffDef, d: number): number {
  if (c.width === undefined || !c.skew) return c.s;
  const dc = c.d ?? 0;
  const half = c.width / 2;
  return c.s + c.skew * (clamp(d, dc - half, dc + half) - dc);
}

/** Lateral distance (m) beyond the sheer part of a cliff band; 0 inside it and for whole cliffs. */
export function cliffBandOut(c: CliffDef, d: number): number {
  return c.width === undefined ? 0 : Math.max(0, Math.abs(d - (c.d ?? 0)) - c.width / 2);
}

/**
 * Longest spread (m along s) of a cliff's drop: cliffMaxSpread, or for a band with spreadSlope the
 * length that keeps the floor far beyond its ends at most that much steeper (1.5 · drop / length).
 */
export function cliffSpreadCap(c: CliffDef): number {
  const k = c.width !== undefined ? c.spreadSlope : undefined;
  return k !== undefined && k > 0 ? Math.max(T.cliffMaxSpread, (1.5 * c.drop) / k) : T.cliffMaxSpread;
}

/**
 * Share (0..1) of a cliff's drop the designed floor has taken at (sExt, d), u m past the floor edge
 * (u ≤ 0: on the floor). A whole cliff is a step on the floor; beyond a band's ends, and in the
 * walls, the drop is spread along s over min(cliffBandSpread · metres beyond the end (or
 * cliffSpreadPerMetre · u), cliffSpreadCap) m, from 35 % of that before the lip to 65 % after it.
 */
export function cliffDropShare(c: CliffDef, sExt: number, d: number, u = -1): number {
  const ds = sExt - cliffLipS(c, d);
  const out = cliffBandOut(c, d) * T.cliffBandSpread;
  const w = Math.min(Math.max(u > 0 ? u * T.cliffSpreadPerMetre : 0, out), cliffSpreadCap(c));
  if (w <= 0) return ds >= 0 ? 1 : 0;
  return smoothstep(-0.35 * w, 0.65 * w, ds);
}

/** Coarse scalar field over the level bounds (row-major, bilinear sampling, clamped at the edges). */
interface ScalarField {
  minX: number;
  minZ: number;
  cell: number;
  cols: number;
  rows: number;
  values: Float64Array;
}

function boxBlurPass(
  src: Float64Array,
  dst: Float64Array,
  cols: number,
  rows: number,
  r: number,
  alongX: boolean,
): void {
  const n = alongX ? cols : rows;
  const lines = alongX ? rows : cols;
  const at = (line: number, i: number): number => {
    const k = i < 0 ? 0 : i >= n ? n - 1 : i;
    return alongX ? line * cols + k : k * cols + line;
  };
  for (let line = 0; line < lines; line++) {
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += src[at(line, i)];
    for (let i = 0; i < n; i++) {
      dst[at(line, i)] = sum / (2 * r + 1);
      sum += src[at(line, i + r + 1)] - src[at(line, i - r)];
    }
  }
}

/** Samples `channels` values per coarse node with `fn` (writes into `out`), then blurs each channel. */
function buildBlurredFields(
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  cell: number,
  radius: number,
  channels: number,
  fn: (x: number, z: number, out: Float64Array) => void,
): ScalarField[] {
  const pad = cell * 2;
  const minX = bounds.minX - pad;
  const minZ = bounds.minZ - pad;
  const cols = Math.ceil((bounds.maxX + pad - minX) / cell) + 1;
  const rows = Math.ceil((bounds.maxZ + pad - minZ) / cell) + 1;
  const fields: ScalarField[] = [];
  for (let c = 0; c < channels; c++) {
    fields.push({ minX, minZ, cell, cols, rows, values: new Float64Array(cols * rows) });
  }
  const tmp = new Float64Array(channels);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      fn(minX + i * cell, minZ + j * cell, tmp);
      for (let c = 0; c < channels; c++) fields[c].values[j * cols + i] = tmp[c];
    }
  }
  const scratch = new Float64Array(cols * rows);
  for (const f of fields) {
    for (let pass = 0; pass < 3; pass++) {
      boxBlurPass(f.values, scratch, cols, rows, radius, true);
      boxBlurPass(scratch, f.values, cols, rows, radius, false);
    }
  }
  return fields;
}

function sampleField(f: ScalarField, x: number, z: number): number {
  const gx = clamp((x - f.minX) / f.cell, 0, f.cols - 1.000001);
  const gz = clamp((z - f.minZ) / f.cell, 0, f.rows - 1.000001);
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const i0 = iz * f.cols + ix;
  const i1 = i0 + f.cols;
  const v = f.values;
  const top = v[i0] + (v[i0 + 1] - v[i0]) * fx;
  const bot = v[i1] + (v[i1 + 1] - v[i1]) * fx;
  return top + (bot - top) * fz;
}

/** World-space summary of a cliff, for cameras, rivers and effects. */
export interface CliffInfo {
  index: number;
  /** Arc length of the lip. */
  s: number;
  drop: number;
  /** Point on the lip at the cliff's centre (y = floor just upstream); a band's centre d. */
  lip: Vec3;
  /** Point at the foot below `lip` (y = floor just downstream). */
  base: Vec3;
  dirX: number;
  dirZ: number;
  /** Floor half-width, or a band's half-width. */
  halfWidth: number;
}

/** CourseFrame plus allocation-free variants for per-frame code. */
export interface TerrainCourse extends CourseFrame {
  readonly geometry: CourseGeometry;
  /** Same as sampleAt but writes into `out` (s is clamped to [0, length]). */
  sampleInto(s: number, out: CourseSample): CourseSample;
  /** Same as project but writes into `out` and also reports the unclamped arc length `sExt`. */
  projectInto(x: number, z: number, out: CourseProjection): CourseProjection;
  /** Centreline floor (after cliffs and coast shaping) — equals sampleAt(s).floor. */
  floorAt(s: number): number;
  /**
   * Designed floor at lateral offset d (cliffs and cliff bands, coast shaping without the shoreline
   * wobble; no bowl, bumps, relief or features). floorAtD(s, 0) = floorAt(s).
   */
  floorAtD(s: number, d: number): number;
  halfWidthAt(s: number): number;
}

/** World-space summary of a 'gap' feature (ravine), for the river, cameras and effects. */
export interface GapInfo {
  /** Index into level.features. */
  index: number;
  /** Take-off edge and far edge (arc length). */
  s0: number;
  s1: number;
  /** Lateral centre and half-width of the cut at s0 (full-width gaps: the floor + wall foot). */
  d: number;
  halfWidth: number;
  /** Points on the gap's centre line at the take-off and far edges; y = the rim height there. */
  lip: Vec3;
  far: Vec3;
  /** Ground height in the middle of the ravine. */
  bottomY: number;
  dirX: number;
  dirZ: number;
}

export interface GeneratedTerrain extends Terrain {
  readonly course: TerrainCourse;
  /** Per grid vertex (same layout as grid.heights): 0 on the floor, → 1 on rocky walls/mountains. */
  readonly wallness: Float32Array;
  /** Per grid vertex: PAINT code left by features (roads, ramp kickers, island and gap rock). */
  readonly paint: Uint8Array;
  /**
   * Per grid vertex: how far fatal cuts (gaps, ravines) lowered it (m); null when the level has
   * none. ravineDepthAt samples it.
   */
  readonly cut: Float32Array | null;
  /**
   * Per grid vertex: how far the bridge approach cuttings lowered it (m; ./bridgeCuts.ts); null when
   * nothing was cut. bridgeCutAt samples it.
   */
  readonly bridgeCut: Float32Array | null;
  readonly cliffInfo: readonly CliffInfo[];
  readonly gapInfo: readonly GapInfo[];
  /** Exact lips of the ramp features, in level.features order (see KickerLip). */
  readonly kickers: readonly KickerLip[];
  /** Bed profiles of the 'stream' features, in level.features order (./stream.ts; empty: none). */
  readonly streamProfiles: readonly StreamProfile[];
  /**
   * Resolved level theme, where its snow lies (with LevelDef.snow) and the absolute snow line
   * (= snowCover.line; Infinity when there is no snow).
   */
  readonly theme: ThemeDef;
  readonly snowCover: SnowCover;
  readonly snowLine: number;
  /** Centreline world points at level.startS, level.coastS and level.finishS. */
  readonly startPos: Vec3;
  readonly coastPos: Vec3;
  readonly finishPos: Vec3;
  /** Wall-clock time the build took (ms). */
  readonly buildMs: number;
  /** 0..1 rockiness at a world point (bilinear over the grid). */
  wallnessAt(x: number, z: number): number;
  /** PAINT code of the nearest grid vertex. */
  paintAt(x: number, z: number): PaintCode;
  /** Index into level.features of the first feature whose footprint holds the point, or -1. */
  featureIndexAt(x: number, z: number): number;
}

export function isGeneratedTerrain(t: Terrain): t is GeneratedTerrain {
  return 'wallness' in t && 'cliffInfo' in t;
}

/**
 * Surface classification shared by surfaceAt and the terrain mesh colouring.
 * `slope` is the gradient magnitude (rise/run); `wallness` is 0 on the floor and 1 on walls.
 * Painted ground: asphalt and feature rock count as 'rock', gravel and kicker earth as 'sand'.
 */
export function classifySurface(
  h: number,
  slope: number,
  wallness: number,
  seaLevel: number,
  paint: number = PAINT.none,
): SurfaceKind {
  if (h < seaLevel) return 'seabed';
  if (paint === PAINT.rock || paint === PAINT.asphalt) return 'rock';
  if (paint === PAINT.gravel || paint === PAINT.dirt) return 'sand';
  if (slope > T.rockSlope || (wallness > 0.55 && slope > T.wallRockSlope)) return 'rock';
  if (h < seaLevel + T.sandBand) return 'sand';
  return 'grass';
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Kicker lips: sample spacing across (m), and the offsets (m) short of the lip read to profile it. */
const KICKER_STEP = 0.5;
const KICKER_EPS = 0.1;
const KICKER_DS = 0.3;
/**
 * Largest miss (m) of a lip's fitted profile against the height function `before` m short of the
 * lip. The face is a t² curve on a smooth floor, so the quadratic is exact up to the floor's own
 * curvature; a bigger miss means something else shapes the last metres (a ridge or island across the
 * face, a fold of the course projection on the inside of a bend: Alpine Pass's ski jump, d −11…−9)
 * and that sample gets no exact face (NaN).
 */
const KICKER_FIT = 0.2;

/**
 * Exact lips of a level's ramps (Terrain.kickers), read from the height function in its own course
 * parameterisation: each sample point is placed so that it projects onto the course exactly at the
 * wanted (s, d) (on a bend the polyline projection need not agree with frameAt), three points short
 * of the lip are fitted with a quadratic (exact for the t² face on a smooth floor) and extrapolated
 * onto it, and the slope is converted to rise per world metre (on a bend the face is shorter or
 * longer than `length` by the factor 1 − κd, with κ the course curvature smoothed over the face).
 * `drop` is how far below the lip the face is `before` m short of it: the grid's lip is no lower.
 */
function kickerLips(
  level: LevelDef,
  geo: CourseGeometry,
  heightFn: (x: number, z: number) => number,
): KickerLip[] {
  const out: KickerLip[] = [];
  const fr = { x: 0, z: 0, dirX: 0, dirZ: 1 };
  const proj: CourseProjection = { s: 0, sExt: 0, d: 0 };
  /** World point that projects onto the course at (s, d): Newton steps from the frame point. */
  const pointAt = (s: number, d: number): { x: number; z: number } => {
    geo.frameAt(s, fr);
    let x = fr.x - fr.dirZ * d;
    let z = fr.z + fr.dirX * d;
    for (let k = 0; k < 8; k++) {
      geo.projectInto(x, z, proj);
      const es = s - proj.sExt;
      const ed = d - proj.d;
      if (Math.abs(es) < 1e-6 && Math.abs(ed) < 1e-6) break;
      geo.frameAt(proj.s, fr);
      x += fr.dirX * es - fr.dirZ * ed;
      z += fr.dirZ * es + fr.dirX * ed;
    }
    return { x, z };
  };
  const heightAtSD = (s: number, d: number): number => {
    const p = pointAt(s, d);
    return heightFn(p.x, p.z);
  };
  const e = KICKER_EPS;
  const ds = KICKER_DS;
  (level.features ?? []).forEach((f, index) => {
    if (f.type !== 'ramp') return;
    const before = Math.min(level.cellSize * Math.SQRT2 + 0.5, f.length);
    const half = f.width / 2;
    const n = Math.max(2, Math.ceil(f.width / KICKER_STEP) + 1);
    const step = f.width / (n - 1);
    const height: number[] = [];
    const slope: number[] = [];
    const curve: number[] = [];
    const drop: number[] = [];
    // Curvature of the course over the face (positive turning right, toward +d), smoothed over
    // the face length: the polyline itself bends only at its vertices.
    const reach = Math.max(f.length, 4) / 2;
    geo.frameAt(f.s - reach, fr);
    const h0x = fr.dirX;
    const h0z = fr.dirZ;
    geo.frameAt(f.s + reach, fr);
    const turn = Math.atan2(fr.dirX * h0z - fr.dirZ * h0x, fr.dirX * h0x + fr.dirZ * h0z);
    const kappa = turn / (-2 * reach);
    for (let i = 0; i < n; i++) {
      const d = f.d - half + i * step;
      const h0 = heightAtSD(f.s - e, d);
      const h1 = heightAtSD(f.s - e - ds, d);
      const h2 = heightAtSD(f.s - e - 2 * ds, d);
      // Quadratic through the three samples (Newton form), evaluated on the lip.
      const f01 = (h0 - h1) / ds;
      const c = (f01 - (h1 - h2) / ds) / (2 * ds);
      const lipY = h0 + f01 * e + c * e * (e + ds);
      // Course metres per world metre along the course at this offset.
      const m = 1 / Math.max(1 - kappa * d, 0.2);
      const sl = f01 + c * (2 * e + ds);
      const dr = lipY - heightAtSD(f.s - before * m, d);
      // The fitted face `before` m short of the lip must be the terrain there.
      const b = before * m;
      const fits = Math.abs(dr - sl * b + c * b * b) <= KICKER_FIT;
      height.push(fits ? lipY : NaN);
      slope.push(fits ? sl * m : NaN);
      curve.push(fits ? 2 * c * m * m : NaN);
      drop.push(fits ? dr : NaN);
    }
    // The lip line, through the lip's ends as the terrain parameterises them.
    const left = pointAt(f.s, f.d - half);
    const right = pointAt(f.s, f.d + half);
    const centre = pointAt(f.s, f.d);
    const span = Math.max(Math.hypot(right.x - left.x, right.z - left.z), 1e-6);
    const rx = (right.x - left.x) / span;
    const rz = (right.z - left.z) / span;
    // Right of travel is (-dirZ, dirX), so travel is (rz, -rx).
    out.push({
      index,
      x: centre.x,
      z: centre.z,
      dirX: rz,
      dirZ: -rx,
      halfWidth: half,
      before,
      step,
      height,
      slope,
      curve,
      drop,
    });
  });
  return out;
}

export interface TerrainOptions {
  /**
   * false: leave out the bridge approach cuttings (./bridgeCuts.ts): the ground exactly as the
   * level's features made it (tests compare the two).
   */
  readonly bridgeCuts?: boolean;
}

export function createTerrain(level: LevelDef, opts: TerrainOptions = {}): GeneratedTerrain {
  const t0 = now();
  const geo = new CourseGeometry(level.course, level.bounds);
  const L = geo.length;
  const seed = level.seed;
  const seaLevel = level.seaLevel;
  const cliffs = [...level.cliffs].sort((a, b) => a.s - b.s);
  const wallHeight = level.wallHeight;
  const wallRamp = Math.max(1, level.wallRamp);
  const coastS = level.coastS;
  const hwCoast = geo.halfWidthAt(coastS);

  // Beach slope matches the designed descent approaching the coast so the blend stays monotone.
  const beachSlope = clamp((geo.floorBaseAt(coastS - 30) - geo.floorBaseAt(coastS)) / 30, 0.03, 0.12);

  const seaDepthAt = (c: number): number =>
    T.seaDepth * (1 - Math.exp(-((c * beachSlope) / T.seaDepth + (c / T.seaShelf) ** 2)));

  /** Seaward shift of the coastline (headlands either side of the river mouth). */
  const coastOffset = (d: number): number =>
    T.headlandOut * smoothstep(hwCoast + 6, hwCoast + 90, Math.abs(d));

  /**
   * Designed floor before coast shaping at lateral offset d. u <= 0 means on the valley floor
   * (cliffs are hard steps there; a band's drop spreads out beyond its ends).
   */
  const inlandFloor = (sExt: number, u: number, d: number): number => {
    let f = geo.floorBaseAt(sExt);
    if (sExt < 0) f -= sExt * Math.max(T.startBackSlope, geo.startSlope);
    else if (sExt > L) f -= (sExt - L) * geo.endSlope;
    for (let i = 0; i < cliffs.length; i++) f -= cliffs[i].drop * cliffDropShare(cliffs[i], sExt, d, u);
    return f;
  };

  // The coast blend starts no earlier than the foot of the last cliff within its reach: blended
  // across, a cliff lost its drop (15 m from the coast it vanished; 55 m out, 30 m became 27 m).
  // (Cliff bands must stay out of its reach: validateCliffs.)
  const coastCliff = cliffs
    .filter((cl) => !isCliffBand(cl) && cl.s < coastS && cl.s > coastS - COAST_REACH)
    .pop();
  /** Weight of the coast blend: 0 upstream of coastCliff, 1 downstream (spread like the cliff). */
  const coastGate = (sExt: number, u: number): number => {
    if (!coastCliff) return 1;
    const ds = sExt - coastCliff.s;
    if (u <= 0) return ds >= 0 ? 1 : 0;
    const w = Math.min(u * T.cliffSpreadPerMetre, T.cliffMaxSpread);
    return smoothstep(-0.35 * w, 0.65 * w, ds);
  };

  const coastShape = (f: number, c: number, gate: number): number => {
    if (c <= -T.coastBlend || gate <= 0) return f;
    const coastal = seaLevel + (c <= 0 ? -c * beachSlope : -seaDepthAt(c));
    return lerp(f, coastal, smoothstep(-T.coastBlend, -15, c) * gate);
  };

  const floorAtD = (s: number, d: number): number => {
    const sc = clamp(s, 0, L);
    return coastShape(inlandFloor(sc, -1, d), sc - coastS - coastOffset(d), coastGate(sc, -1));
  };
  const floorAt = (s: number): number => floorAtD(s, 0);

  /** Distance past the floor edge; the area behind the course start counts as wall too. */
  const wallDistance = (sExt: number, ad: number, hw: number): number => {
    const qLat = ad - hw;
    const qBack = -sExt;
    return qLat > 0 && qBack > 0 ? Math.hypot(qLat, qBack) : Math.max(qLat, qBack);
  };

  const proj: CourseProjection = { s: 0, sExt: 0, d: 0 };
  let lastWallness = 0;

  // Far from the course the nearest centreline point can jump (inside of bends), so anything that
  // depends on s would step there. The mountains use blurred regional versions instead.
  const [regionalHalfWidth, regionalCoast, regionalFloor] = buildBlurredFields(
    level.bounds,
    T.regionalCell,
    T.regionalBlur,
    3,
    (x, z, out) => {
      geo.projectInto(x, z, proj);
      const hw = geo.halfWidthAt(proj.sExt);
      out[0] = hw;
      out[1] = proj.sExt - coastS - coastOffset(proj.d);
      out[2] = inlandFloor(proj.sExt, wallDistance(proj.sExt, Math.abs(proj.d), hw), proj.d);
    },
  );

  const theme = themeOf(level);
  const features = new FeatureField(level, seed, theme, floorAt, T.bowlRise);
  const relief = hasRelief(level.relief) ? new ReliefField(level, level.relief, geo) : null;
  let lastRock = 0;
  /** Coast distance beyond which coastShape, the bowl, the taper and wallness ignore the wobble. */
  const coastInland = Math.max(T.coastBlend, T.coastTaper, 30) + T.coastNoiseAmp;

  /** The valley without features (also starts the vertex in `features`). */
  const baseHeight = (x: number, z: number): number => {
    geo.projectInto(x, z, proj);
    const sExt = proj.sExt;
    const d = proj.d;
    const ad = Math.abs(d);
    const hw = geo.halfWidthAt(sExt);
    const bumpKeep = features.count > 0 ? features.begin(sExt, d, hw) : 1;
    let u = wallDistance(sExt, ad, hw);
    let c = sExt - coastS - coastOffset(d);
    let h = inlandFloor(sExt, u, d);

    const uFar = wallDistance(sExt, ad, sampleField(regionalHalfWidth, x, z));
    const far = smoothstep(wallRamp * 0.6, wallRamp * 1.6, uFar);
    if (far > 0) {
      u = lerp(u, uFar, far);
      c = lerp(c, sampleField(regionalCoast, x, z), far);
      h = lerp(h, sampleField(regionalFloor, x, z), far);
    }
    // World-space wobble keeps the shoreline irregular; none at the river mouth centre. Far inland
    // every use of c below saturates whatever the wobble, so it is skipped there (same result).
    if (c > -coastInland) {
      const ns = T.coastNoiseScale;
      c -= T.coastNoiseAmp * fbm2(x / ns, z / ns, seed + 77, 3) * smoothstep(3, 16, ad);
    }
    h = coastShape(h, c, coastGate(sExt, u));

    const across = Math.min(ad / hw, 1);
    h += T.bowlRise * across * across * (1 - smoothstep(0, 20, c));

    let lipFade = 1;
    for (let i = 0; i < cliffs.length; i++) {
      const cl = cliffs[i];
      const near =
        cl.width === undefined
          ? Math.abs(sExt - cl.s)
          : Math.hypot(sExt - cliffLipS(cl, d), cliffBandOut(cl, d));
      lipFade = Math.min(lipFade, smoothstep(T.cliffClear - 4, T.cliffClear, near));
    }
    const centreFade = smoothstep(2, 9, ad) * bumpKeep;
    if (lipFade > 0 && centreFade > 0) {
      h += T.bumpAmp * fbm2(x / T.bumpScale, z / T.bumpScale, seed + 11, 2) * centreFade * lipFade;
    }

    lastRock = 0;
    if (relief && u < 0 && lipFade > 0 && bumpKeep > 0) {
      const fade =
        lipFade *
        bumpKeep *
        (1 - smoothstep(-T.reliefEdge, 0, u)) *
        smoothstep(level.startS + 15, level.startS + 15 + T.reliefStart, sExt) *
        smoothstep(15, T.coastBlend + 15, -c);
      if (fade > 0) {
        h += relief.at(x, z, sExt, d) * fade;
        lastRock = relief.rock * fade;
      }
    }

    lastWallness = 0;
    const taper = smoothstep(0, T.coastTaper, -c);
    if (u > 0 && taper > 0) {
      const ramp = smoothstep(0, wallRamp, u);
      // Canyon band: rough, terraced rock; it fades out on the bench and mountains beyond.
      const band = 1 - smoothstep(wallRamp, wallRamp * 1.6, u);
      const rough = ridged2(x / T.wallNoiseScale, z / T.wallNoiseScale, seed + 21, 3);
      let wh = wallHeight * ramp * (1 + T.wallNoise * (rough - 0.5) * (0.25 + 0.75 * band));
      if (band > 0) {
        const q = Math.floor(wh / T.wallTerrace);
        const frac = wh / T.wallTerrace - q;
        wh = lerp(wh, (q + smoothstep(0.55, 1, frac)) * T.wallTerrace, T.wallTerraceMix * band);
      }
      const m0 = wallRamp * (1 + T.benchWidth);
      const m = smoothstep(m0, m0 + T.mountainRamp, u);
      if (m > 0) {
        const ms = T.mountainScale;
        const ridges = ridged2(x / ms, z / ms, seed + 31, 4);
        const hills = 0.5 + 0.5 * fbm2(x / (ms * 0.6), z / (ms * 0.6), seed + 41, 3);
        wh += m * (T.mountainBase + T.mountainAmp * (0.6 * ridges + 0.4 * hills));
      }
      h += wh * taper;
      lastWallness =
        smoothstep(wallRamp * 0.08, wallRamp * 0.4, u) *
        (1 - smoothstep(wallRamp * 1.05, wallRamp * 1.5, u)) *
        smoothstep(0, 30, -c);
    }
    if (lastRock > lastWallness) lastWallness = lastRock;
    return h;
  };

  if (features.count > 0) features.prepare(geo, baseHeight);

  let lastPaint: PaintCode = PAINT.none;
  let lastCut = 0;
  const heightFn = (x: number, z: number): number => {
    let h = baseHeight(x, z);
    lastPaint = lastRock > 0.5 ? PAINT.rock : PAINT.none;
    lastCut = 0;
    if (features.count > 0 && features.active) {
      h = features.finish(x, z, h, lastWallness);
      lastWallness = features.wallness;
      if (features.paint !== PAINT.none) lastPaint = features.paint;
      lastCut = features.cut;
    }
    return h;
  };

  const { bounds, cellSize } = level;
  const cols = Math.floor((bounds.maxX - bounds.minX) / cellSize) + 1;
  const vertexCount = cols * (Math.floor((bounds.maxZ - bounds.minZ) / cellSize) + 1);
  const wallness = new Float32Array(vertexCount);
  const paint = new Uint8Array(vertexCount);
  const cut = features.hasFatal ? new Float32Array(vertexCount) : null;
  const grid = buildGrid(bounds, cellSize, (x, z) => {
    const h = heightFn(x, z);
    const ix = Math.round((x - bounds.minX) / cellSize);
    const iz = Math.round((z - bounds.minZ) / cellSize);
    wallness[iz * cols + ix] = lastWallness;
    paint[iz * cols + ix] = lastPaint;
    if (cut) cut[iz * cols + ix] = lastCut;
    return h;
  });
  // The cut field shares the grid's layout and triangulation, so it interpolates like the heights.
  const cutGrid: HeightGrid | null = cut ? { ...grid, heights: cut } : null;
  const kickers = kickerLips(level, geo, heightFn);

  const heightAt = (x: number, z: number): number => sampleHeight(grid, x, z);
  const gradientAt = (x: number, z: number): { dx: number; dz: number } => sampleGradient(grid, x, z);

  const wallnessAt = (x: number, z: number): number => {
    const gx = clamp((x - grid.originX) / grid.cellSize, 0, grid.cols - 1.000001);
    const gz = clamp((z - grid.originZ) / grid.cellSize, 0, grid.rows - 1.000001);
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const i0 = iz * grid.cols + ix;
    const i1 = i0 + grid.cols;
    const a = wallness[i0] + (wallness[i0 + 1] - wallness[i0]) * fx;
    const b = wallness[i1] + (wallness[i1 + 1] - wallness[i1]) * fx;
    return a + (b - a) * fz;
  };

  const frame = { x: 0, z: 0, dirX: 0, dirZ: 1 };

  const course: TerrainCourse = {
    length: L,
    geometry: geo,
    floorAt,
    floorAtD,
    halfWidthAt: (s: number) => geo.halfWidthAt(s),
    sampleInto(s: number, out: CourseSample): CourseSample {
      const sc = clamp(s, 0, L);
      geo.frameAt(sc, out);
      out.s = sc;
      out.floor = floorAt(sc);
      out.halfWidth = geo.halfWidthAt(sc);
      return out;
    },
    sampleAt(s: number): CourseSample {
      return course.sampleInto(s, { s: 0, x: 0, z: 0, dirX: 0, dirZ: 1, floor: 0, halfWidth: 0 });
    },
    toWorld(s: number, d: number): Vec3 {
      geo.frameAt(s, frame);
      const extra = s < 0 ? s : s > L ? s - L : 0;
      const x = frame.x + frame.dirX * extra - frame.dirZ * d;
      const z = frame.z + frame.dirZ * extra + frame.dirX * d;
      return { x, y: heightAt(x, z), z };
    },
    project(x: number, z: number): { s: number; d: number } {
      geo.projectInto(x, z, proj);
      return { s: proj.s, d: proj.d };
    },
    projectInto(x: number, z: number, out: CourseProjection): CourseProjection {
      return geo.projectInto(x, z, out);
    },
  };

  const cliffInfo: CliffInfo[] = cliffs.map((cl, index) => {
    geo.frameAt(cl.s, frame);
    const dc = isCliffBand(cl) ? (cl.d ?? 0) : 0;
    const x = frame.x - frame.dirZ * dc;
    const z = frame.z + frame.dirX * dc;
    return {
      index,
      s: cl.s,
      drop: cl.drop,
      lip: { x, y: floorAtD(cl.s - 0.01, dc), z },
      base: { x, y: floorAtD(cl.s + 0.01, dc), z },
      dirX: frame.dirX,
      dirZ: frame.dirZ,
      halfWidth: cl.width !== undefined ? cl.width / 2 : geo.halfWidthAt(cl.s),
    };
  });

  const gapInfo: GapInfo[] = [];
  (level.features ?? []).forEach((f, index) => {
    if (f.type !== 'gap') return;
    const lat = gapLateral(f, geo.halfWidthAt(f.s));
    const s1 = f.s + f.length;
    // Edge points at exactly s0 / s1; their y is the rim (the wall occupies up to one grid cell).
    const lip = course.toWorld(f.s, lat.d);
    lip.y = Math.max(course.toWorld(f.s - 0.05, lat.d).y, course.toWorld(f.s - cellSize, lat.d).y);
    const far = course.toWorld(s1, lat.d);
    far.y = Math.max(course.toWorld(s1 + 0.05, lat.d).y, course.toWorld(s1 + cellSize, lat.d).y);
    geo.frameAt(f.s, frame);
    gapInfo.push({
      index,
      s0: f.s,
      s1,
      d: lat.d,
      halfWidth: lat.half,
      lip,
      far,
      bottomY: course.toWorld(f.s + f.length / 2, lat.d).y,
      dirX: frame.dirX,
      dirZ: frame.dirZ,
    });
  });

  const paintAt = (x: number, z: number): PaintCode => {
    const ix = clamp(Math.round((x - grid.originX) / grid.cellSize), 0, grid.cols - 1);
    const iz = clamp(Math.round((z - grid.originZ) / grid.cellSize), 0, grid.rows - 1);
    return paint[iz * grid.cols + ix] as PaintCode;
  };

  const snowCover = snowCoverFor(level, theme, floorAt(level.startS));
  const startPos = course.toWorld(level.startS, 0);
  const coastPos = course.toWorld(level.coastS, 0);
  const finishPos = course.toWorld(level.finishS, 0);

  const terrain: GeneratedTerrain = {
    level,
    grid,
    course,
    wallness,
    paint,
    cut,
    ravineDepthAt: cutGrid ? (x: number, z: number): number => sampleHeight(cutGrid, x, z) : undefined,
    bridgeCut: null,
    cliffInfo,
    gapInfo,
    kickers,
    streamProfiles: features.count > 0 ? features.streamProfiles() : [],
    theme,
    snowCover,
    snowLine: snowCover.line,
    startPos,
    coastPos,
    finishPos,
    buildMs: now() - t0,
    heightAt,
    gradientAt,
    normalAt(x: number, z: number): Vec3 {
      const g = sampleGradient(grid, x, z);
      const n = Math.hypot(g.dx, 1, g.dz);
      return { x: -g.dx / n, y: 1 / n, z: -g.dz / n };
    },
    surfaceAt(x: number, z: number): SurfaceKind {
      const g = sampleGradient(grid, x, z);
      const slope = Math.hypot(g.dx, g.dz);
      return classifySurface(heightAt(x, z), slope, wallnessAt(x, z), seaLevel, paintAt(x, z));
    },
    isOcean: (x: number, z: number): boolean => heightAt(x, z) < seaLevel - T.oceanMargin,
    wallnessAt,
    paintAt,
    featureIndexAt(x: number, z: number): number {
      const list = level.features;
      if (!list || list.length === 0) return -1;
      geo.projectInto(x, z, proj);
      const hw = geo.halfWidthAt(proj.sExt);
      for (let i = 0; i < list.length; i++) if (featureContains(list[i], proj.sExt, proj.d, hw)) return i;
      return -1;
    },
  };
  // Road bridges grade the bank under their approaches down to the road (./bridgeCuts.ts), against
  // plans made on the ground as it stands here; what they lowered is kept apart (bridgeCut).
  const cuts = opts.bridgeCuts === false ? null : cutBridgeApproaches(terrain);
  if (cuts) return { ...terrain, bridgeCut: cuts.field, bridgeCutAt: cuts.at, buildMs: now() - t0 };
  return terrain;
}
