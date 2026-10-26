import { BufferAttribute, BufferGeometry, Color } from 'three';
import type { Terrain, TerrainFeature } from '../types';
import { clamp, lerp, smoothstep } from '../math';
import { hash2 } from '../rng';
import {
  profileAt,
  springPoolLevels,
  springPoolRadius,
  springPoolSection,
  SPRING_POOL,
  streamDepth,
  type SpringPoolLevels,
} from '../terrain/stream';
import { isGeneratedTerrain } from '../terrain/terrain';
import type { ThemeDef } from '../terrain/themes';

/**
 * The cave a 'cave' stream rises from (types.ts StreamSource): a spring pool at the foot of a rock
 * face (its bowl: SPRING_POOL in src/core/terrain/stream.ts; its still water: ./pool.ts) and, at the
 * back of the pool, a CAVE MOUTH the water comes out of. Render-only, low-poly and flat-shaded like
 * the scenery: a rock hood standing in the back of the pool against the face, with an arched
 * opening facing down the stream's first segment and a dark recess behind it.
 *
 * Frame: the spring (the stream's first point, the pool's centre), `back` = the horizontal unit
 * vector against the first segment (into the face), `right` = its right; a = metres behind the
 * spring, b = metres to the right, y = world height.
 *
 * Where it stands: the recess runs from the mouth (a = mouthA) back to where the pool's bank rises
 * out of the water (a = backA, so everything inside it above the water is the cave's own
 * geometry, nothing of the terrain), `depth` m deep; the arch springs CAVE_TUNING.springSink under
 * the water and rises `rise` m above it over a mouth `half` m each side; the hood around it is
 * sideThick / topThick m of rock and runs back up the ground behind (its top following the slope)
 * until the face buries it: a spur of rock coming down from the face with the cave in its end.
 *
 * The world logic rule 'stream-source' (src/core/terrain/logic.ts) checks that the face is there:
 * caveFace() measures how high the ground behind the mouth rises.
 */

type Stream = Extract<TerrainFeature, { type: 'stream' }>;

export const CAVE_TUNING = {
  /** Mouth half width = clamp(halfShare × stream width, halfMin, halfMax) (m). */
  halfShare: 0.4,
  halfMin: 2.5,
  halfMax: 6,
  /** Arch height above the water = clamp(riseShare × half + riseBase, riseMin, riseMax) (m). */
  riseShare: 0.6,
  riseBase: 1,
  riseMin: 2.6,
  riseMax: 5.5,
  /** Recess depth = clamp(depthShare × half, depthMin, depthMax) (m); it narrows to backShare. */
  depthShare: 1.1,
  depthMin: 3.5,
  depthMax: 7,
  backShare: 0.75,
  /** The mouth stands at least this share of the pool radius behind the spring. */
  mouthMinShare: 0.2,
  /** The arch springs this far (m) under the water. */
  springSink: 0.6,
  /** Rock around the arch: beside it and over it (m); the hood's foot sinks footSink m deeper. */
  sideThick: 2.4,
  topThick: 1.7,
  footSink: 1,
  /**
   * The hood runs back up the ground behind the mouth, its top bury m under the ground where it
   * ends (there the face takes over), at most maxLength m from the mouth; where no ground rises
   * that high it stops backInto m behind the recess (an outcrop, closed by its end cap). Its top
   * follows the slope overGround m above it, and it widens by `spread` (share) toward its end.
   */
  bury: 0.5,
  maxLength: 30,
  backInto: 6,
  overGround: 0.8,
  spread: 0.5,
  /** Cross-section exponent of the hood (1 = elliptic; lower = squarer: steep flanks, broad top). */
  blockiness: 0.6,
  /** Roughness (m) of the hood's outer vertices. */
  jitter: 0.5,
  /** Points around the arch, recess slices; the hood's rings: at least hoodRings, ringStep m apart. */
  archPoints: 11,
  recessSlices: 4,
  hoodRings: 4,
  ringStep: 2.5,
} as const;

const T = CAVE_TUNING;

/** Where a cave stream's cave stands (world; see the module comment). */
export interface CavePlacement {
  /** Index of the stream in level.features. */
  readonly feature: number;
  /** The spring (pool centre) and the frame: into the face (backX, backZ) and its right. */
  readonly cx: number;
  readonly cz: number;
  readonly backX: number;
  readonly backZ: number;
  readonly rightX: number;
  readonly rightZ: number;
  readonly pool: SpringPoolLevels;
  /** The pool's water level (m). */
  readonly waterY: number;
  /** Mouth and back of the recess (m behind the spring), mouth half width and arch height (m). */
  readonly mouthA: number;
  readonly backA: number;
  readonly half: number;
  readonly rise: number;
}

/**
 * The cave of stream feature `index` (null unless it is a 'cave' stream with two points). `waterY`:
 * the pool's level when a water system has it (./pool.ts), else the design level (the outlet's bed +
 * the stream's depth). On terrains without stream profiles the pool is taken from the ground at
 * the spring (for validation on analytic test terrains).
 */
export function cavePlacement(terrain: Terrain, index: number, waterY?: number): CavePlacement | null {
  const f = (terrain.level.features ?? [])[index];
  if (!f || f.type !== 'stream' || f.source !== 'cave' || f.points.length < 2) return null;
  const c = terrain.course.toWorld(f.points[0].s, f.points[0].d);
  const n = terrain.course.toWorld(f.points[1].s, f.points[1].d);
  const ul = Math.hypot(n.x - c.x, n.z - c.z);
  if (!(ul > 1e-6)) return null;
  const backX = -(n.x - c.x) / ul;
  const backZ = -(n.z - c.z) / ul;
  const pool = poolOf(terrain, f, index);
  const water = waterY ?? designLevel(terrain, f, index, pool);
  // Where the bank behind the spring rises out of the water: the back of the recess.
  let lo = 0;
  let hi = pool.radius;
  for (let it = 0; it < 40; it++) {
    const mid = 0.5 * (lo + hi);
    if (springPoolSection(pool, mid) < water) lo = mid;
    else hi = mid;
  }
  const half = clamp(T.halfShare * f.width, T.halfMin, T.halfMax);
  const depth = clamp(T.depthShare * half, T.depthMin, T.depthMax);
  const backA = hi + 0.5;
  const mouthA = Math.max(T.mouthMinShare * pool.radius, backA - depth);
  return {
    feature: index,
    cx: c.x,
    cz: c.z,
    backX,
    backZ,
    rightX: -backZ,
    rightZ: backX,
    pool,
    waterY: water,
    mouthA,
    backA,
    half,
    rise: clamp(T.riseShare * half + T.riseBase, T.riseMin, T.riseMax),
  };
}

/** The spring pool of a cave stream (from its profile, or from the ground on analytic terrains). */
function poolOf(terrain: Terrain, f: Stream, index: number): SpringPoolLevels {
  const prof = isGeneratedTerrain(terrain) ? terrain.streamProfiles.find((p) => p.index === index) : undefined;
  const levels = prof ? springPoolLevels(f, prof) : null;
  if (levels) return levels;
  const top = terrain.course.toWorld(f.points[0].s, f.points[0].d).y;
  return { radius: springPoolRadius(f), floorY: top - f.bank - SPRING_POOL.deepen, topY: top };
}

/** The pool's design water level: the bed at its outlet + the stream's depth. */
function designLevel(terrain: Terrain, f: Stream, index: number, pool: SpringPoolLevels): number {
  const prof = isGeneratedTerrain(terrain) ? terrain.streamProfiles.find((p) => p.index === index) : undefined;
  const outlet = prof ? profileAt(prof, Math.min(pool.radius, prof.length)) : pool.topY;
  return outlet - f.bank + streamDepth(f);
}

/** World point of frame (a, b) at height y. */
function at(c: CavePlacement, a: number, b: number, y: number): [number, number, number] {
  return [c.cx + c.backX * a + c.rightX * b, y, c.cz + c.backZ * a + c.rightZ * b];
}

/** The rock face behind a cave's mouth, as the world logic rule measures it. */
export interface CaveFace {
  /** World point of the mouth (at the water). */
  readonly x: number;
  readonly z: number;
  /** Highest rise (m) of the ground above the spring's ground within `reach` m behind the mouth. */
  readonly rise: number;
  /** Steepest rise (rise/run) over `run` m along the way. */
  readonly steepest: number;
}

/**
 * How the ground rises behind a cave's mouth: sampled every metre up to `reach` m behind it, along
 * its axis and `half` + 2 m either side of it (a face that only rises off to one side still counts:
 * the hood stands against it), against the spring's natural ground (the pool's rim).
 */
export function caveFace(terrain: Terrain, c: CavePlacement, reach: number, run: number): CaveFace {
  const side = c.half + 2;
  const heights: number[] = [];
  for (let t = 0; t <= reach + 1e-9; t += 1) {
    let h = -Infinity;
    for (const b of [-side, 0, side]) {
      const p = at(c, c.mouthA + t, b, 0);
      h = Math.max(h, terrain.heightAt(p[0], p[2]));
    }
    heights.push(h);
  }
  let rise = -Infinity;
  for (const h of heights) rise = Math.max(rise, h - c.pool.topY);
  let steepest = 0;
  const k = Math.max(1, Math.round(run));
  for (let i = 0; i + k < heights.length; i++) steepest = Math.max(steepest, (heights[i + k] - heights[i]) / k);
  const m = at(c, c.mouthA, 0, 0);
  return { x: m[0], z: m[2], rise, steepest };
}

type V = [number, number, number];
type RGB = { r: number; g: number; b: number };

const linear = (hex: string): RGB => {
  const col = new Color(hex);
  return { r: col.r, g: col.g, b: col.b };
};
const mix = (a: RGB, b: RGB, t: number, k = 1): RGB => ({
  r: lerp(a.r, b.r, t) * k,
  g: lerp(a.g, b.g, t) * k,
  b: lerp(a.b, b.b, t) * k,
});

/** Triangle soup with per-face normals and colours (winding follows a hint direction). */
class Soup {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];

  add(a: V, b: V, c: V, rgb: RGB, hx: number, hy: number, hz: number): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (!(l > 1e-9)) return;
    nx /= l;
    ny /= l;
    nz /= l;
    let p = b;
    let q = c;
    if (nx * hx + ny * hy + nz * hz < 0) {
      p = c;
      q = b;
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    for (const v of [a, p, q]) {
      this.pos.push(v[0], v[1], v[2]);
      this.nor.push(nx, ny, nz);
      this.col.push(rgb.r, rgb.g, rgb.b);
    }
  }

  quad(a: V, b: V, c: V, d: V, rgb: RGB, hx: number, hy: number, hz: number): void {
    this.add(a, b, c, rgb, hx, hy, hz);
    this.add(a, c, d, rgb, hx, hy, hz);
  }
}

/**
 * Low-poly geometry of a cave (non-indexed; position, normal, color in linear RGB): the arch's rock
 * frame facing down the stream, the recess (dark rock, darker inside, a near-black back wall down
 * under the water) and the hood's outer shell, a block of rock running back up the ground until
 * the slope behind buries it, closed at its end. Deterministic from `seed`.
 */
export function buildCaveGeometry(
  c: CavePlacement,
  terrain: Terrain,
  theme: ThemeDef,
  seed: number,
): BufferGeometry {
  const soup = new Soup();
  const bands = theme.rockBands.map(linear);
  const rockA = bands[0] ?? linear(theme.terrain.rockGrey);
  const rockB = bands[1] ?? linear(theme.terrain.rockBrown);
  const dark = linear(theme.terrain.rockDark);
  const n = T.archPoints;
  const ys = c.waterY - T.springSink;
  const foot = ys - T.footSink;
  const rnd = (i: number, j: number, k: number): number => hash2(i * 7 + k, j, seed + 401) - 0.5;
  // The arch (mouth) and the outer contour of the hood at angle θ (0 = right foot, π = left foot).
  const archAt = (j: number, half: number, rise: number, base: number): { b: number; y: number } => {
    const th = (Math.PI * j) / n;
    return { b: half * Math.cos(th), y: base + rise * Math.sin(th) };
  };
  const riseAbove = c.rise + T.springSink;
  // --- recess slices (slice 0 = the mouth) ---
  const slices: V[][] = [];
  for (let k = 0; k <= T.recessSlices; k++) {
    const f = k / T.recessSlices;
    const a = lerp(c.mouthA, c.backA, f);
    const sh = lerp(1, T.backShare, f);
    const row: V[] = [];
    for (let j = 0; j <= n; j++) {
      const p = archAt(j, c.half * sh, riseAbove * sh, ys);
      const edge = j === 0 || j === n;
      const jit = edge ? 0 : 0.18 * rnd(j, k, 1);
      row.push(at(c, a + (k === 0 ? 0 : 0.25 * rnd(j, k, 2)), p.b + jit, p.y + jit));
    }
    slices.push(row);
  }
  // Inside: dark rock, darker toward the back.
  for (let k = 0; k < T.recessSlices; k++) {
    const f = (k + 0.5) / T.recessSlices;
    const shade = lerp(0.42, 0.12, smoothstep(0, 1, f));
    const axis = at(c, lerp(c.mouthA, c.backA, f), 0, ys);
    for (let j = 0; j < n; j++) {
      const p0 = slices[k][j];
      const p1 = slices[k][j + 1];
      const q0 = slices[k + 1][j];
      const q1 = slices[k + 1][j + 1];
      const cx = (p0[0] + q1[0]) / 2;
      const cy = (p0[1] + q1[1]) / 2;
      const cz = (p0[2] + q1[2]) / 2;
      const rgb = mix(dark, rockA, 0.2, shade * (0.85 + 0.3 * (rnd(j, k, 3) + 0.5)));
      soup.quad(p0, q0, q1, p1, rgb, axis[0] - cx, axis[1] - cy, axis[2] - cz);
    }
  }
  // Back wall: the last arch closed down under the water, facing out of the mouth.
  const last = slices[T.recessSlices];
  const backCentre = at(c, c.backA, 0, foot);
  const black = mix(dark, dark, 0, 0.08);
  const out = { x: -c.backX, z: -c.backZ };
  soup.add(backCentre, at(c, c.backA, c.half * T.backShare, foot), last[0], black, out.x, 0, out.z);
  for (let j = 0; j < n; j++) soup.add(backCentre, last[j], last[j + 1], black, out.x, 0, out.z);
  soup.add(backCentre, last[n], at(c, c.backA, -c.half * T.backShare, foot), black, out.x, 0, out.z);
  // --- the hood: a rock mass from the mouth back up the ground until the slope buries it ---
  const topMin = ys + riseAbove + T.topThick;
  const groundAt = (a: number): number => {
    const p = at(c, a, 0, 0);
    return terrain.heightAt(p[0], p[2]);
  };
  // It ends where the ground behind has risen over its top (the face takes over), else it is an
  // outcrop of its own, closed by its end cap.
  let hoodEnd = c.backA + T.backInto;
  for (let a = c.backA + 2; a <= c.mouthA + T.maxLength; a += 1) {
    if (groundAt(a) >= topMin + T.bury) {
      hoodEnd = a;
      break;
    }
  }
  const ringCount = Math.max(T.hoodRings, Math.ceil((hoodEnd - c.mouthA) / T.ringStep));
  const rings: V[][] = [];
  for (let k = 0; k <= ringCount; k++) {
    const f = k / ringCount;
    const a = lerp(c.mouthA, hoodEnd, f) + (k === 0 ? -0.3 : 0);
    const half = (c.half + T.sideThick) * (1 + T.spread * f);
    // Its top follows the ground up the slope behind (a rib of rock running into the face).
    const height = Math.max(topMin, groundAt(a) + T.overGround) - foot;
    const row: V[] = [];
    for (let j = 0; j <= n; j++) {
      const th = (Math.PI * j) / n;
      const cs = Math.cos(th);
      const sn = Math.sin(th);
      // Squarer than the arch (steep flanks, a broad top): a block of rock, not a tube.
      const b = half * Math.sign(cs) * Math.abs(cs) ** T.blockiness;
      const y = foot + height * Math.abs(sn) ** T.blockiness;
      const edge = j === 0 || j === n;
      const jt = T.jitter * (edge ? 0.3 : 1);
      row.push(at(c, a + jt * rnd(j, k, 4), b + jt * rnd(j, k, 5), y + jt * rnd(j, k, 6)));
    }
    rings.push(row);
  }
  const grey = linear(theme.terrain.rockGrey);
  const rock = (j: number, k: number, up: number): RGB => {
    const t = 0.5 + 0.5 * rnd(j, k, 7);
    const base = mix(grey, rockA, 0.35 * t);
    const shade = (0.8 + 0.25 * (rnd(j, k, 8) + 0.5)) * lerp(0.75, 1.05, up);
    return mix(base, rockB, 0.25 * (0.5 + rnd(j, k, 9)), shade);
  };
  // Front: the rock frame between the arch and the hood's front ring.
  const front = rings[0];
  const mouth = slices[0];
  for (let j = 0; j < n; j++) {
    const up = Math.sin((Math.PI * (j + 0.5)) / n);
    soup.quad(mouth[j], front[j], front[j + 1], mouth[j + 1], rock(j, -1, up * 0.6), out.x, 0, out.z);
  }
  // Outer shell, facing away from the hood's axis.
  for (let k = 0; k < ringCount; k++) {
    const axis = at(c, lerp(c.mouthA, hoodEnd, (k + 0.5) / ringCount), 0, foot);
    for (let j = 0; j < n; j++) {
      const p0 = rings[k][j];
      const p1 = rings[k][j + 1];
      const q0 = rings[k + 1][j];
      const q1 = rings[k + 1][j + 1];
      const cx = (p0[0] + q1[0]) / 2;
      const cy = (p0[1] + q1[1]) / 2;
      const cz = (p0[2] + q1[2]) / 2;
      const up = Math.sin((Math.PI * (j + 0.5)) / n);
      soup.quad(p0, q0, q1, p1, rock(j, k, up), cx - axis[0], cy - axis[1], cz - axis[2]);
    }
  }
  // End cap (inside the slope where the face rises; closes the outcrop where it does not).
  const end = rings[ringCount];
  const endCentre = at(c, hoodEnd, 0, foot);
  for (let j = 0; j < n; j++) soup.add(endCentre, end[j], end[j + 1], rock(j, 9, 0.5), c.backX, 0, c.backZ);

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(soup.pos), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(soup.nor), 3));
  geo.setAttribute('color', new BufferAttribute(new Float32Array(soup.col), 3));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
