import type { IcebergState, Terrain } from '../types';
import { clamp, smoothstep } from '../math';
import { type IntroTimeline, calvingTimeAt, introTimeline, routeLengthOf } from '../intro';
import {
  type CameraPose,
  createCameraPose,
  enforceClearance,
  followHeading,
  followScale,
  groundAt,
} from './follow';
import { type CalvingShot, getCalvingShot } from './calvingShot';
import { KeyframeSpline } from './spline';

/** A course point that keeps extrapolating straight beyond [0, length] instead of clamping. */
export interface CoursePoint2 {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  floor: number;
}

export function courseAt(terrain: Terrain, s: number): CoursePoint2 {
  const len = terrain.course.length;
  const sc = clamp(s, 0, len);
  const smp = terrain.course.sampleAt(sc);
  const extra = s - sc;
  return {
    x: smp.x + smp.dirX * extra,
    z: smp.z + smp.dirZ * extra,
    dirX: smp.dirX,
    dirZ: smp.dirZ,
    floor: smp.floor,
  };
}

/** Course extents the cinematics frame: playable stretch from spawn to the coast. */
export interface RouteInfo {
  startS: number;
  coastS: number;
  /** coastS - startS (at least 100). */
  length: number;
  /** Highest valley floor / centreline ground between start and coast. */
  maxFloor: number;
  startFloor: number;
}

export function routeInfo(terrain: Terrain): RouteInfo {
  const lv = terrain.level;
  const startS = lv.startS;
  const coastS = Math.max(lv.coastS, startS + 100);
  const length = coastS - startS;
  const step = Math.max(10, length / 80);
  const startFloor = courseAt(terrain, startS).floor;
  let maxFloor = -Infinity;
  for (let s = startS; s <= coastS + 1e-6; s += step) {
    const p = courseAt(terrain, s);
    maxFloor = Math.max(maxFloor, p.floor, groundAt(terrain, p.x, p.z));
  }
  return { startS, coastS, length, maxFloor, startFloor };
}

export interface AerialShotSpec {
  /** Distance beyond the coast, out to sea, along the course direction there. */
  seaDist: number;
  /**
   * Sideways offset as a fraction of the route length, always toward the middle of the level
   * bounds so the shot does not look past the edge of the terrain.
   */
  lateral: number;
  /** Height above the route's highest floor. */
  heightAbove: number;
  /** Look at the course this fraction of the route upstream of the coast. */
  focusFrac: number;
  fov: number;
}

/** Distance from (x, z) along unit (ux, uz) until leaving the level bounds. */
function roomAlong(
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
  x: number,
  z: number,
  ux: number,
  uz: number,
): number {
  let t = Infinity;
  if (ux > 1e-6) t = Math.min(t, (b.maxX - x) / ux);
  else if (ux < -1e-6) t = Math.min(t, (b.minX - x) / ux);
  if (uz > 1e-6) t = Math.min(t, (b.maxZ - z) / uz);
  else if (uz < -1e-6) t = Math.min(t, (b.minZ - z) / uz);
  return t;
}

/** A high shot from out at sea looking back up the valley. */
export function aerialShot(
  terrain: Terrain,
  info: RouteInfo,
  spec: AerialShotSpec,
  out: CameraPose,
): CameraPose {
  const L = info.length;
  const coast = courseAt(terrain, info.coastS);
  // Chord direction is steadier than the local tangent if the course wiggles at the coast.
  const up = courseAt(terrain, info.coastS - Math.min(80, L * 0.2));
  let dx = coast.x - up.x;
  let dz = coast.z - up.z;
  const n = Math.hypot(dx, dz);
  if (n > 1e-3) {
    dx /= n;
    dz /= n;
  } else {
    dx = coast.dirX;
    dz = coast.dirZ;
  }
  let rx = -dz;
  let rz = dx;
  const b = terrain.level.bounds;
  if (roomAlong(b, coast.x, coast.z, -rx, -rz) > roomAlong(b, coast.x, coast.z, rx, rz)) {
    rx = -rx;
    rz = -rz;
  }
  out.position.x = coast.x + dx * spec.seaDist + rx * spec.lateral * L;
  out.position.z = coast.z + dz * spec.seaDist + rz * spec.lateral * L;
  out.position.y = info.maxFloor + spec.heightAbove;
  const focus = courseAt(terrain, info.coastS - spec.focusFrac * L);
  out.lookAt.x = focus.x;
  out.lookAt.z = focus.z;
  out.lookAt.y = Math.max(focus.floor, terrain.level.seaLevel);
  out.fov = spec.fov;
  enforceClearance(terrain, out.position, 0, 0, 0, false);
  return out;
}

export function introEstablishingSpec(info: RouteInfo): AerialShotSpec {
  const L = info.length;
  return {
    seaDist: clamp(0.35 * L, 120, 420),
    lateral: 0.1,
    heightAbove: 90 + 0.08 * L,
    focusFrac: 0.5,
    fov: 52,
  };
}

export function outroSpec(info: RouteInfo): AerialShotSpec {
  const L = info.length;
  return {
    seaDist: clamp(0.3 * L, 120, 420),
    lateral: 0.05,
    heightAbove: 60 + 0.12 * L,
    focusFrac: 0.45,
    fov: 60,
  };
}

/** The held wide shot at the end of the outro (before the slow drift). */
export function outroShot(terrain: Terrain, out: CameraPose = createCameraPose()): CameraPose {
  const info = routeInfo(terrain);
  return aerialShot(terrain, info, outroSpec(info), out);
}

// --- intro path --------------------------------------------------------------------------------

const DIM = 7; // position xyz, lookAt xyz, fov
const SWEEP_ALT = 55;
const APPROACH_DIST = 90;
/** The sweep pauses this far downstream of each cliff lip, facing the waterfall. */
const CLIFF_VIEW_DIST = 80;
const DYNAMIC_KEYS = 3;
const MAX_KEYS = 40;

/**
 * The intro fly-through: an establishing shot beyond the coast, a sweep up the valley at altitude
 * (with a stop facing each waterfall), then a descent onto the glacier at the top of the valley that
 * lands exactly on the calving shot's start pose (the iceberg in its socket in the glacier front).
 * Terrain-dependent keys are built once; the last three depend on the iceberg and are refreshed on
 * every evaluation.
 */
export class IntroPath {
  readonly terrain: Terrain;
  readonly info: RouteInfo;
  private readonly spline = new KeyframeSpline(DIM, MAX_KEYS);
  private readonly staticCount: number;
  private readonly weights = new Float64Array(MAX_KEYS);
  private readonly approach = { x: 0, y: 0, z: 0 };
  private readonly buf = new Float64Array(DIM);
  private readonly endPose = createCameraPose();
  private readonly calving: CalvingShot;

  constructor(terrain: Terrain) {
    this.terrain = terrain;
    this.calving = getCalvingShot(terrain);
    const info = routeInfo(terrain);
    this.info = info;
    const L = info.length;
    const sea = terrain.level.seaLevel;
    const tmp = createCameraPose();
    let k = 0;
    const put = (pose: CameraPose, weight: number): void => {
      this.setKey(k, pose);
      this.weights[k] = weight;
      k++;
    };

    const est = introEstablishingSpec(info);
    // The establishing hold is short in distance, so weight its segment to linger.
    put(aerialShot(terrain, info, est, tmp), 2.2);
    const drift: AerialShotSpec = {
      seaDist: est.seaDist * 0.55,
      lateral: est.lateral * 0.6,
      heightAbove: est.heightAbove * 0.85,
      focusFrac: 0.55,
      fov: 54,
    };
    put(aerialShot(terrain, info, drift, tmp), 1);

    const sHi = info.coastS - 0.04 * L;
    const sLo = info.startS + APPROACH_DIST;
    if (sHi > sLo + 20) {
      const lead = clamp(0.12 * L, 60, 140);
      const span = sHi - sLo;
      const n = clamp(Math.round(span / 160), 1, 10);
      const cliffKeys: number[] = [];
      for (const c of terrain.level.cliffs) {
        const s = c.s + CLIFF_VIEW_DIST;
        if (s > sLo + 30 && s < sHi - 30) cliffKeys.push(s);
      }
      const keys: { s: number; cliff: number }[] = [];
      for (let i = 0; i < n; i++) {
        const s = sHi - (span * i) / n;
        if (i === 0 || !cliffKeys.some((c) => Math.abs(c - s) < 60)) keys.push({ s, cliff: -1 });
      }
      for (const s of cliffKeys) keys.push({ s, cliff: s - CLIFF_VIEW_DIST });
      keys.sort((a, b) => b.s - a.s);
      for (const key of keys) {
        if (k >= MAX_KEYS - DYNAMIC_KEYS) break;
        const p = courseAt(terrain, key.s);
        tmp.position.x = p.x;
        tmp.position.z = p.z;
        const alt = key.cliff >= 0 ? SWEEP_ALT + 12 : SWEEP_ALT;
        tmp.position.y = Math.max(p.floor, groundAt(terrain, p.x, p.z), sea) + alt;
        if (key.cliff >= 0) {
          const lip = courseAt(terrain, key.cliff);
          const above = courseAt(terrain, key.cliff - 8).floor;
          const below = courseAt(terrain, key.cliff + 8).floor;
          tmp.lookAt.x = lip.x;
          tmp.lookAt.z = lip.z;
          tmp.lookAt.y = Math.max(sea, (above + below) * 0.5);
        } else {
          const f = courseAt(terrain, key.s - lead);
          tmp.lookAt.x = f.x;
          tmp.lookAt.z = f.z;
          tmp.lookAt.y = Math.max(f.floor, sea) + 2;
        }
        tmp.fov = 58;
        enforceClearance(terrain, tmp.position, 0, 0, 0, false);
        put(tmp, 1);
      }
    }
    const a = courseAt(terrain, sLo);
    this.approach.x = a.x;
    this.approach.z = a.z;
    this.approach.y = Math.max(a.floor, groundAt(terrain, a.x, a.z), sea) + 30;
    this.staticCount = k;
    for (let i = 0; i < DYNAMIC_KEYS; i++) this.weights[k + i] = 1;
    this.spline.count = k + DYNAMIC_KEYS;
  }

  private setKey(i: number, pose: CameraPose): void {
    const d = this.spline.data;
    const o = i * DIM;
    d[o] = pose.position.x;
    d[o + 1] = pose.position.y;
    d[o + 2] = pose.position.z;
    d[o + 3] = pose.lookAt.x;
    d[o + 4] = pose.lookAt.y;
    d[o + 5] = pose.lookAt.z;
    d[o + 6] = pose.fov;
  }

  private setKeyRaw(
    i: number,
    px: number,
    py: number,
    pz: number,
    lx: number,
    ly: number,
    lz: number,
    fov: number,
  ): void {
    const d = this.spline.data;
    const o = i * DIM;
    d[o] = px;
    d[o + 1] = py;
    d[o + 2] = pz;
    d[o + 3] = lx;
    d[o + 4] = ly;
    d[o + 5] = lz;
    d[o + 6] = fov;
  }

  /** Refresh the iceberg-relative keys and the centripetal knot spacing. */
  private updateDynamic(ice: IcebergState): void {
    const p = ice.pos;
    const yaw = followHeading(ice);
    // heading θ → (sin θ, cos θ); right of (dx, dz) is (-dz, dx)
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const g = this.calving.glacier;
    // Descend on the side the calving shot stands on (the side with lower ground).
    const rx = -fz * g.cameraSide;
    const rz = fx * g.cameraSide;
    const fs = followScale(ice.radius);
    // The glacier front: where the iceberg sits in its socket before it breaks away.
    const ex = p.x - g.fx * g.slide;
    const ez = p.z - g.fz * g.slide;
    const ey = p.y + g.faceHeight * 0.5;
    let i = this.staticCount;
    const a = this.approach;
    this.setKeyRaw(i++, a.x, a.y, a.z, ex, ey, ez, 56);
    const hx = ex + fx * 30 * fs + rx * 16 * fs;
    const hz = ez + fz * 30 * fs + rz * 16 * fs;
    this.setKeyRaw(i++, hx, ey + 15 * fs, hz, ex, ey, ez, 54);
    this.setKey(i, this.calving.startPose('full', ice, this.endPose));

    const d = this.spline.data;
    const knots = this.spline.knots;
    const n = this.spline.count;
    knots[0] = 0;
    for (let j = 1; j < n; j++) {
      const o = j * DIM;
      const q = (j - 1) * DIM;
      const chord = Math.hypot(d[o] - d[q], d[o + 1] - d[q + 1], d[o + 2] - d[q + 2]);
      knots[j] = knots[j - 1] + Math.sqrt(Math.max(1, chord)) * this.weights[j - 1];
    }
  }

  /** Flyover pose at progress t01 (0..1); equals the full calving's start pose at t01 = 1. */
  evaluate(t01: number, ice: IcebergState, out: CameraPose): CameraPose {
    this.updateDynamic(ice);
    const te = smoothstep(0, 1, t01);
    const sp = this.spline;
    const b = this.buf;
    sp.evaluate(sp.start + te * (sp.end - sp.start), b);
    out.position.x = b[0];
    out.position.y = b[1];
    out.position.z = b[2];
    out.lookAt.x = b[3];
    out.lookAt.y = b[4];
    out.lookAt.z = b[5];
    out.fov = b[6];
    enforceClearance(this.terrain, out.position, 0, 0, 0, false);
    return out;
  }
}

const introCache = new WeakMap<Terrain, IntroPath>();

export function getIntroPath(terrain: Terrain): IntroPath {
  let path = introCache.get(terrain);
  if (!path) {
    path = new IntroPath(terrain);
    introCache.set(terrain, path);
  }
  return path;
}

/**
 * Camera `t` seconds into an intro with timeline `tl`: the flyover (if any), then the calving shot,
 * ending exactly on followPose(iceberg) at tl.total (and from then on).
 */
export function introCameraPose(
  tl: IntroTimeline,
  t: number,
  terrain: Terrain,
  iceberg: IcebergState,
  reduceMotion: boolean,
  out: CameraPose,
): CameraPose {
  const time = Number.isFinite(t) ? Math.max(0, t) : tl.total;
  if (time < tl.flyover) return getIntroPath(terrain).evaluate(time / tl.flyover, iceberg, out);
  const kind = tl.kind === 'full' ? 'full' : 'short';
  const ct = calvingTimeAt(tl, time);
  return getCalvingShot(terrain).pose(ct, tl.calving, kind, iceberg, reduceMotion, out);
}

/**
 * Opening cinematic pose at progress t01 over the full intro (INTRO_DURATION): high beyond the coast
 * looking up the valley, sweep up the course past the waterfalls, descend onto the glacier at the top
 * where the iceberg calves off, then swing into the follow pose.
 */
export function introPose(
  t01: number,
  terrain: Terrain,
  iceberg: IcebergState,
  out: CameraPose = createCameraPose(),
): CameraPose {
  const tl = introTimeline('full', routeLengthOf(terrain.level));
  return introCameraPose(tl, clamp(t01, 0, 1) * tl.total, terrain, iceberg, false, out);
}
