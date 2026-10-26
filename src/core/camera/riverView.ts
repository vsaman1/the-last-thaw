import type { Terrain, Vec3 } from '../types';
import { clamp, clamp01, damp, dirToHeading, lerp, smoothstep } from '../math';
import { type CameraPose, createCameraPose, enforceClearance, groundAt } from './follow';
import { createRay, raycastGround, screenRay } from './pick';

/** Anything with a centre and a width — RiverSample satisfies this. */
export interface FitPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Full width; the fit keeps a sphere of radius width / 2 around the point in frame. */
  readonly width: number;
}

/** Tuning for the LEVEL COMPLETE "view the river" orbit camera. Angles in radians. */
export const RIVER_VIEW = {
  /** Vertical fov (degrees) before the portrait widening in effectiveFov(). */
  fov: 50,
  /** Seconds to blend into and out of the orbit. */
  blend: 1,
  /** The river is fitted into a frame this much smaller than the real one (slack on every side). */
  margin: 1.1,
  /** Fraction of the frame height kept clear at the bottom for the UI's "your river" bar... */
  bottomInset: 0.1,
  /** ...which wraps to two lines on portrait screens. */
  bottomInsetPortrait: 0.18,
  /**
   * The river runs along the floor of a deep valley: below ~40° the canyon walls hide it from most
   * azimuths (seen in a real-GPU playtest after a sideways drag), so the orbit stays steep.
   */
  minElevation: 0.75,
  maxElevation: 1.45,
  /** Entering from a lower camera starts at least this high, so the river reads as a whole. */
  startElevation: 0.95,
  /**
   * Close up there are no walls between the camera and the spot, so the floor relaxes from
   * minElevation (at farDistance and beyond) down to this (at closeDistance and nearer).
   */
  minElevationClose: 0.12,
  closeDistance: 60,
  farDistance: 320,
  /** Zoom is a multiple of the fit distance; 1 = the whole river just fits. */
  zoomMin: 0.01,
  zoomMax: 1.6,
  /** Closest the camera may get to the orbit centre (m). */
  minDistance: 15,
  /** Double-click / double-tap flies to the spot at this distance (or nearer) and elevation (or lower). */
  focusDistance: 70,
  focusElevation: 0.6,
  /** Centre / distance / zoom smoothing (1/s) after a wheel, pinch, key or pan step. */
  moveRate: 9,
  /** Duration (s) of the eased flight of a fly-to or reset. */
  flyTime: 1.2,
  /** How far past the river's bounding box the focus can be panned (m). */
  panMargin: 150,
  /** Re-centring onto the ground looks along the view axis up to this multiple of the distance. */
  anchorReach: 2.5,
  /** Ground grabs need the pointer ray at least this steep against the slope (cos of the angle). */
  grabMinCos: 0.12,
  /** One grab step moves the focus at most this multiple of the distance (guards grazing views). */
  grabMaxStep: 0.6,
  /** Cap on ground metres per screen metre when panning at grazing angles. */
  panMaxStretch: 3,
  /** Close-ups keep the sight line to this far above the focus clear of the terrain (m)... */
  focusLineUp: 2,
  /** ...fading that rule in / out over this long (s) when leaving / returning to the framing. */
  lineBlend: 1,
  /** Orbit angle per drag across the full canvas height. */
  dragPerHeight: Math.PI * 0.75,
  angleRate: 12,
  /** How fast the centre follows a refreshed river bounding box (1/s). */
  targetRate: 2,
  /** Pointer-idle seconds before the slow auto-rotation starts, its ramp-in and speed. */
  idleDelay: 3,
  autoRotateRamp: 2,
  autoRotateRate: 0.06,
  /** The river keeps growing at sea after the finish; re-fit at most this often (s)... */
  refreshInterval: 1.5,
  /** ...and only once its bounding box moved by more than this (m). */
  refreshDelta: 2,
  azBins: 36,
  elBins: 8,
} as const;

const V = RIVER_VIEW;
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
/** Below this aspect the vertical fov widens so portrait screens keep a usable horizontal view. */
export const PORTRAIT_MIN_ASPECT = 1.3;
export const MAX_FOV = 85;

/** The vertical fov actually rendered for a pose fov on a canvas of this aspect (width / height). */
export function effectiveFov(fovDeg: number, aspect: number): number {
  if (!(aspect < PORTRAIT_MIN_ASPECT) || aspect <= 0) return fovDeg;
  const hHalf = Math.atan(Math.tan((fovDeg * DEG) / 2) * PORTRAIT_MIN_ASPECT);
  return Math.min(MAX_FOV, (2 * Math.atan(Math.tan(hHalf) / aspect)) / DEG);
}

const LOG_CLOSE = Math.log(V.closeDistance);
const LOG_FAR = Math.log(V.farDistance);

/** Lowest orbit elevation allowed at this camera distance: steep when far, relaxed close up. */
export function orbitMinElevation(distance: number): number {
  if (!(distance > 0)) return V.minElevation;
  const t = smoothstep(LOG_CLOSE, LOG_FAR, Math.log(distance));
  return lerp(V.minElevationClose, V.minElevation, t);
}

export interface RiverBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  cx: number;
  cy: number;
  cz: number;
  count: number;
}

export const createRiverBounds = (): RiverBounds => ({
  minX: 0,
  maxX: 0,
  minY: 0,
  maxY: 0,
  minZ: 0,
  maxZ: 0,
  cx: 0,
  cy: 0,
  cz: 0,
  count: 0,
});

/** Axis-aligned bounding box of the sample centres and its centre (count 0 = empty). */
export function riverBounds(
  points: readonly FitPoint[],
  out: RiverBounds = createRiverBounds(),
): RiverBounds {
  out.count = points.length;
  if (points.length === 0) {
    out.minX = out.maxX = out.minY = out.maxY = out.minZ = out.maxZ = 0;
    out.cx = out.cy = out.cz = 0;
    return out;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  out.minX = minX;
  out.maxX = maxX;
  out.minY = minY;
  out.maxY = maxY;
  out.minZ = minZ;
  out.maxZ = maxZ;
  out.cx = (minX + maxX) / 2;
  out.cy = (minY + maxY) / 2;
  out.cz = (minZ + maxZ) / 2;
  return out;
}

/**
 * Smallest distance from (cx, cy, cz) along the orbit direction (azimuth `az` in the heading
 * convention, elevation `el` above the horizon) at which a camera looking at the centre sees every
 * point, each with a sphere of radius width / 2, inside a frame shrunk by `margin`, with the
 * bottom `bottomInset` (fraction of the frame height) also kept clear.
 *
 * Per point, in camera space x = q·right, y = q·up and depth = q·forward + d; the sphere is inside
 * the side planes when depth ≥ |x| / tanH + r / sinH (likewise vertically), which is linear in d.
 */
export function fitOrbitDistance(
  points: readonly FitPoint[],
  cx: number,
  cy: number,
  cz: number,
  az: number,
  el: number,
  vFovDeg: number,
  aspect: number,
  margin: number = V.margin,
  bottomInset = 0,
): number {
  const ce = Math.cos(el);
  // forward = -(direction from centre to camera); heading θ → (sin θ, cos θ)
  const fx = -Math.sin(az) * ce;
  const fy = -Math.sin(el);
  const fz = -Math.cos(az) * ce;
  // right = forward × worldUp; up' = right × forward
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz);
  if (rl < 1e-9) {
    rx = Math.cos(az);
    rz = -Math.sin(az);
  } else {
    rx /= rl;
    rz /= rl;
  }
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;
  const tanV = Math.tan((vFovDeg * DEG) / 2) / margin;
  const tanH = tanV * aspect;
  const tanB = tanV * Math.max(0.05, 1 - 2 * bottomInset);
  const invSinV = Math.sqrt(1 + tanV * tanV) / tanV;
  const invSinB = Math.sqrt(1 + tanB * tanB) / tanB;
  const invSinH = Math.sqrt(1 + tanH * tanH) / tanH;
  let need = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const qx = p.x - cx;
    const qy = p.y - cy;
    const qz = p.z - cz;
    const r = p.width * 0.5;
    const along = qx * fx + qy * fy + qz * fz;
    const sx = Math.abs(qx * rx + qz * rz) / tanH + r * invSinH;
    const y = qx * ux + qy * uy + qz * uz;
    const sy = y >= 0 ? y / tanV + r * invSinV : -y / tanB + r * invSinB;
    const d = (sx > sy ? sx : sy) - along;
    if (d > need) need = d;
  }
  return need;
}

const smootherstep01 = (t: number): number => {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/**
 * Orbit camera for LEVEL COMPLETE → "view the river". Pure maths, no DOM: the renderer forwards
 * pointer / wheel / key input to drag(), zoomAt(), zoomBy(), grab(), pan(), flyTo(), rotateBy() and
 * reset().
 *
 * - Framed (on begin and after reset): the centre is the river's bounding-box centre and the
 *   distance is zoom × the fit distance for the current angles, read from a table precomputed over
 *   azimuth × elevation, so the whole river stays framed while auto-rotating at zoom 1.
 * - Free (after zooming at a point, panning or flying to a spot): the centre is the user's focus and
 *   the distance is in metres, down to a close-up. Zooming out past the fit distance frames again.
 * Fly-to and reset are timed eased flights; wheel / pinch / pan steps are damped.
 */
export class RiverOrbit {
  /** Orbit centre = look point (smoothed toward the goal). */
  readonly centre = { x: 0, y: 0, z: 0 };
  /** Where the centre is heading: the bounding-box centre while framed, else the user's focus. */
  private readonly goal = { x: 0, y: 0, z: 0 };
  private readonly bounds = createRiverBounds();
  private readonly fitted = createRiverBounds();
  private readonly table = new Float64Array(V.azBins * V.elBins);
  private az = 0;
  private el: number = V.startElevation;
  private azGoal = 0;
  private elGoal: number = V.startElevation;
  /** Framed: distance as a multiple of the fit distance. */
  private zoom = 1;
  private zoomGoal = 1;
  /** Free: distance in metres. */
  private dist: number = V.minDistance;
  private distGoal: number = V.minDistance;
  private isFramed = true;
  private rate: number = V.targetRate;
  /** Seconds into the current fly-to / reset flight; negative = none. */
  private flightT = -1;
  /** Centre, elevation and distance (zoom while framed) when the flight started. */
  private readonly flightFrom = { x: 0, y: 0, z: 0, el: 0, d: 0 };
  /** 0..1 how much the close-up sight-line clearance applies (ramps so modes switch without a jump). */
  private lineWeight = 0;
  private readonly axisRay = createRay();
  private readonly axisHit = { x: 0, y: 0, z: 0 };
  private readonly grabPose = createCameraPose();
  private readonly grabHit = { x: 0, y: 0, z: 0 };
  private readonly grabN = { x: 0, y: 1, z: 0 };
  private idle = 0;
  private aspect = 16 / 9;
  private sinceRefresh = 0;
  private fittedCount = -1;

  get azimuth(): number {
    return this.az;
  }

  get elevation(): number {
    return this.el;
  }

  /** True while the whole river is framed (not zoomed in at, panned or flown to a spot). */
  get framed(): boolean {
    return this.isFramed;
  }

  /** Current distance from the centre before ground clearance (m). */
  get distance(): number {
    if (!this.isFramed) return this.dist;
    return Math.max(V.minDistance, this.fitDistance(this.az, this.el) * this.zoom);
  }

  private goalDistance(): number {
    if (!this.isFramed) return this.distGoal;
    return Math.max(V.minDistance, this.fitDistance(this.azGoal, this.elGoal) * this.zoomGoal);
  }

  private maxDistance(): number {
    return Math.max(V.minDistance, this.fitDistance(this.azGoal, this.elGoal) * V.zoomMax);
  }

  /** Start orbiting `points`, continuing from the direction the camera `from` is looking from. */
  begin(points: readonly FitPoint[], from: CameraPose, aspect: number): void {
    this.aspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 16 / 9;
    this.isFramed = true;
    this.refit(points);
    this.centre.x = this.goal.x;
    this.centre.y = this.goal.y;
    this.centre.z = this.goal.z;
    const dx = from.position.x - this.goal.x;
    const dz = from.position.z - this.goal.z;
    const horiz = Math.hypot(dx, dz);
    this.az = horiz > 1e-3 ? dirToHeading(dx, dz) : Math.PI;
    const el = Math.atan2(from.position.y - this.goal.y, Math.max(horiz, 1e-3));
    this.el = clamp(Math.max(el, V.startElevation), V.minElevation, V.maxElevation);
    this.azGoal = this.az;
    this.elGoal = this.el;
    this.zoom = 1;
    this.zoomGoal = 1;
    this.dist = this.distGoal = this.distance;
    this.rate = V.targetRate;
    this.flightT = -1;
    this.lineWeight = 0;
    this.idle = 0;
  }

  /** Re-fit when the canvas aspect changed or the river grew (throttled). Call every frame. */
  sync(points: readonly FitPoint[], aspect: number, dt: number): void {
    this.sinceRefresh += dt;
    if (aspect > 0 && Number.isFinite(aspect) && Math.abs(aspect - this.aspect) > 1e-3) {
      this.aspect = aspect;
      this.refit(points);
      return;
    }
    if (points.length === this.fittedCount || this.sinceRefresh < V.refreshInterval) return;
    const b = riverBounds(points, this.bounds);
    const f = this.fitted;
    const moved = Math.max(
      Math.abs(b.minX - f.minX),
      Math.abs(b.maxX - f.maxX),
      Math.abs(b.minY - f.minY),
      Math.abs(b.maxY - f.maxY),
      Math.abs(b.minZ - f.minZ),
      Math.abs(b.maxZ - f.maxZ),
    );
    this.sinceRefresh = 0;
    if (moved > V.refreshDelta) this.refit(points);
    else this.fittedCount = points.length;
  }

  private refit(points: readonly FitPoint[]): void {
    const b = riverBounds(points, this.fitted);
    if (this.isFramed) {
      this.goal.x = b.cx;
      this.goal.y = b.cy;
      this.goal.z = b.cz;
    }
    this.fittedCount = points.length;
    this.sinceRefresh = 0;
    const fov = effectiveFov(V.fov, this.aspect);
    const aspect = this.aspect;
    const inset = aspect < 1 ? V.bottomInsetPortrait : V.bottomInset;
    for (let j = 0; j < V.elBins; j++) {
      const el = lerp(V.minElevation, V.maxElevation, j / (V.elBins - 1));
      for (let i = 0; i < V.azBins; i++) {
        const az = (i / V.azBins) * TAU;
        const d = fitOrbitDistance(points, b.cx, b.cy, b.cz, az, el, fov, aspect, V.margin, inset);
        this.table[j * V.azBins + i] = d;
      }
    }
  }

  /** Fit distance for the given angles (bilinear in the precomputed table). */
  fitDistance(az: number, el: number): number {
    const nA = V.azBins;
    const u = ((((az / TAU) * nA) % nA) + nA) % nA;
    const i0 = Math.floor(u);
    const i1 = (i0 + 1) % nA;
    const fu = u - i0;
    const v = clamp01((el - V.minElevation) / (V.maxElevation - V.minElevation)) * (V.elBins - 1);
    const j0 = Math.min(V.elBins - 2, Math.floor(v));
    const fv = v - j0;
    const t = this.table;
    const a = lerp(t[j0 * nA + i0], t[j0 * nA + i1], fu);
    const b = lerp(t[(j0 + 1) * nA + i0], t[(j0 + 1) * nA + i1], fu);
    return lerp(a, b, fv);
  }

  /** Pointer drag in CSS pixels: right turns the view around to the left, down raises the camera. */
  drag(dxPx: number, dyPx: number, heightPx: number): void {
    const k = V.dragPerHeight / Math.max(1, heightPx);
    this.rotateBy(-dxPx * k, dyPx * k);
  }

  /** Orbit by angles (rad): +azimuth moves the camera to its right, +elevation raises it. */
  rotateBy(dAz: number, dEl: number): void {
    if (!Number.isFinite(dAz + dEl)) return;
    this.azGoal += dAz;
    this.elGoal = clamp(this.elGoal + dEl, orbitMinElevation(this.goalDistance()), V.maxElevation);
    this.idle = 0;
  }

  /** Zoom about the centre: factor > 1 moves away, < 1 moves closer (clamped). */
  zoomBy(factor: number): void {
    if (!(factor > 0) || !Number.isFinite(factor)) return;
    this.flightT = -1;
    this.rate = V.moveRate;
    this.idle = 0;
    if (this.isFramed) {
      this.zoomGoal = clamp(this.zoomGoal * factor, V.zoomMin, V.zoomMax);
      return;
    }
    const d = clamp(this.distGoal * factor, V.minDistance, this.maxDistance());
    const fit = this.fitDistance(this.azGoal, this.elGoal);
    if (factor > 1 && d >= fit) this.reframe(d / Math.max(1e-6, fit));
    else this.distGoal = d;
  }

  /**
   * Zoom about a world point (the spot under the cursor): scaling the camera about it keeps it at
   * the same place on screen. Zooming out of the framed overview stays framed. With `terrain`, the
   * orbit centre then slides along the view axis onto the ground (the camera stays put), so later
   * orbiting turns about the spot in the middle of the screen.
   */
  zoomAt(factor: number, p: Readonly<Vec3>, terrain?: Terrain): void {
    if (!(factor > 0) || !Number.isFinite(factor)) return;
    if (!Number.isFinite(p.x + p.y + p.z) || (this.isFramed && factor >= 1)) {
      this.zoomBy(factor);
      return;
    }
    this.unframe();
    const d0 = this.distGoal;
    const d1 = clamp(d0 * factor, V.minDistance, this.maxDistance());
    const fit = this.fitDistance(this.azGoal, this.elGoal);
    if (factor > 1 && d1 >= fit) {
      this.reframe(d1 / Math.max(1e-6, fit));
      return;
    }
    const k = d1 / d0;
    const g = this.goal;
    g.x = p.x + (g.x - p.x) * k;
    g.y = p.y + (g.y - p.y) * k;
    g.z = p.z + (g.z - p.z) * k;
    this.distGoal = d1;
    // No clampGoal here: the goal only moves toward a spot already on screen, and clamping it would
    // break the scaling (the spot would slide away from the cursor).
    if (terrain) this.anchorGoal(terrain);
    this.flightT = -1;
    this.rate = V.moveRate;
    this.idle = 0;
  }

  /** Fly to a spot (double-click / double-tap) and orbit around it, a little closer and lower. */
  flyTo(p: Readonly<Vec3>): void {
    if (!Number.isFinite(p.x + p.y + p.z)) return;
    this.unframe();
    this.goal.x = p.x;
    this.goal.y = p.y;
    this.goal.z = p.z;
    this.distGoal = clamp(Math.min(this.distGoal, V.focusDistance), V.minDistance, this.maxDistance());
    const floor = orbitMinElevation(this.distGoal);
    this.elGoal = clamp(Math.min(this.elGoal, V.focusElevation), floor, V.maxElevation);
    this.startFlight();
  }

  /**
   * Pan by a pointer drag in CSS pixels ("grab": the ground follows the pointer). The focus moves
   * over the ground, keeping its height above it, and stays near the river.
   */
  pan(dxPx: number, dyPx: number, heightPx: number, terrain: Terrain): void {
    if (!Number.isFinite(dxPx + dyPx)) return;
    this.unframe();
    // Grab the ground at the middle of the screen (not the framed centre, which can float above
    // or sit inside a hillside), so the ground under the pointer moves with it.
    this.anchorGoal(terrain);
    const fov = effectiveFov(V.fov, this.aspect);
    const mpp = (2 * this.distGoal * Math.tan((fov * DEG) / 2)) / Math.max(1, heightPx);
    const stretch = Math.min(V.panMaxStretch, 1 / Math.max(1e-3, Math.sin(this.elGoal)));
    const side = -dxPx * mpp;
    const ahead = dyPx * mpp * stretch;
    const ca = Math.cos(this.azGoal);
    const sa = Math.sin(this.azGoal);
    const g = this.goal;
    const x0 = g.x;
    const z0 = g.z;
    const before = groundAt(terrain, g.x, g.z);
    // camera right = (cos az, -sin az); camera forward over the ground = (-sin az, -cos az)
    g.x += side * ca - ahead * sa;
    g.z += -side * sa - ahead * ca;
    this.clampGoal(x0, z0);
    const after = groundAt(terrain, g.x, g.z);
    g.y = Math.max(g.y + after - before, after);
    this.flightT = -1;
    this.rate = V.moveRate;
    this.idle = 0;
  }

  /**
   * Pan by dragging the ground (pointer right-/Shift-/two-finger drag): the spot under the pointer
   * at (x0, y0) moves to stay under it at (x1, y1) (ndc, -1..1, +y up, as this orbit is drawn). The
   * focus slides along the local slope there, so it keeps to the ground. Over the sky, or along a
   * grazing slope, it falls back to pan().
   */
  grab(x0: number, y0: number, x1: number, y1: number, heightPx: number, terrain: Terrain): void {
    if (!Number.isFinite(x0 + y0 + x1 + y1)) return;
    const fallback = (): void =>
      this.pan(((x1 - x0) * heightPx * this.aspect) / 2, ((y0 - y1) * heightPx) / 2, heightPx, terrain);
    this.unframe();
    this.anchorGoal(terrain);
    const pose = this.goalPose(this.grabPose);
    const fov = effectiveFov(V.fov, this.aspect);
    const ray = this.axisRay;
    const hit = this.grabHit;
    screenRay(pose, fov, this.aspect, x0, y0, ray);
    if (!raycastGround(terrain, ray, this.distGoal * V.anchorReach * 2, hit)) return fallback();
    // Plane through the grabbed spot: the slope there, or level over the sea / when that is grazing.
    const sea = terrain.level.seaLevel;
    const n = this.grabN;
    n.x = 0;
    n.y = 1;
    n.z = 0;
    if (terrain.heightAt(hit.x, hit.z) > sea) {
      const tn = terrain.normalAt(hit.x, hit.z);
      n.x = tn.x;
      n.y = tn.y;
      n.z = tn.z;
    }
    screenRay(pose, fov, this.aspect, x1, y1, ray);
    let den = ray.dx * n.x + ray.dy * n.y + ray.dz * n.z;
    if (den > -V.grabMinCos) {
      n.x = 0;
      n.y = 1;
      n.z = 0;
      den = ray.dy;
      if (den > -V.grabMinCos) return fallback();
    }
    const t = ((hit.x - ray.ox) * n.x + (hit.y - ray.oy) * n.y + (hit.z - ray.oz) * n.z) / den;
    if (!(t > 0)) return fallback();
    // Moving the camera by (hit − q) within that plane puts the spot back under the pointer.
    let dx = hit.x - (ray.ox + ray.dx * t);
    let dy = hit.y - (ray.oy + ray.dy * t);
    let dz = hit.z - (ray.oz + ray.dz * t);
    const len = Math.hypot(dx, dy, dz);
    const cap = this.distGoal * V.grabMaxStep;
    if (len > cap) {
      dx *= cap / len;
      dy *= cap / len;
      dz *= cap / len;
    }
    const g = this.goal;
    const gx = g.x;
    const gy = g.y;
    const gz = g.z;
    g.x += dx;
    g.y += dy;
    g.z += dz;
    const wantX = g.x;
    const wantZ = g.z;
    this.clampGoal(gx, gz);
    // Held at the pan margin: the slope's rise no longer matches, keep the height above the ground.
    if (g.x !== wantX || g.z !== wantZ) {
      g.y = gy + groundAt(terrain, g.x, g.z) - groundAt(terrain, gx, gz);
    }
    // On curved ground the slope's plane leaves the focus above or below the surface: slide it back
    // along the view axis (the camera, and so the grab, stay exact); lift it only if that fails.
    if (!this.anchorGoal(terrain)) g.y = Math.max(g.y, groundAt(terrain, g.x, g.z));
    this.flightT = -1;
    this.rate = V.moveRate;
    this.idle = 0;
  }

  /** Back to the whole-river framing (Home / "Reset view"), at least as steep as on entry. */
  reset(): void {
    this.reframe(1);
    this.elGoal = clamp(Math.max(this.elGoal, V.startElevation), V.minElevation, V.maxElevation);
  }

  private unframe(): void {
    if (!this.isFramed) return;
    this.distGoal = this.goalDistance();
    this.dist = this.distance;
    this.isFramed = false;
  }

  /** Switch to framed (continuing from the current distance) and fly back to the river's centre. */
  private reframe(zoomGoal: number): void {
    if (!this.isFramed) {
      this.zoom = this.dist / Math.max(1e-6, this.fitDistance(this.az, this.el));
      this.isFramed = true;
    }
    this.zoomGoal = clamp(zoomGoal, V.zoomMin, V.zoomMax);
    const f = this.fitted;
    this.goal.x = f.cx;
    this.goal.y = f.cy;
    this.goal.z = f.cz;
    this.startFlight();
  }

  private startFlight(): void {
    const f = this.flightFrom;
    f.x = this.centre.x;
    f.y = this.centre.y;
    f.z = this.centre.z;
    f.el = this.el;
    f.d = this.isFramed ? this.zoom : this.dist;
    this.flightT = 0;
    this.rate = V.moveRate;
    this.idle = 0;
  }

  /**
   * Keep panning near the river: within panMargin of its bounding box, or no further out than
   * (x0, z0) when a fly-to / zoom already went beyond it (so the next pan cannot snap back).
   */
  private clampGoal(x0: number, z0: number): void {
    const f = this.fitted;
    const m = V.panMargin;
    const g = this.goal;
    g.x = clamp(g.x, Math.min(f.minX - m, x0), Math.max(f.maxX + m, x0));
    g.z = clamp(g.z, Math.min(f.minZ - m, z0), Math.max(f.maxZ + m, z0));
  }

  /** The pose this orbit is heading for (goal centre, angles and distance; before ground clearance). */
  private goalPose(out: CameraPose): CameraPose {
    const g = this.goal;
    const d = this.goalDistance();
    const ce = Math.cos(this.elGoal);
    out.position.x = g.x + Math.sin(this.azGoal) * ce * d;
    out.position.y = g.y + Math.sin(this.elGoal) * d;
    out.position.z = g.z + Math.cos(this.azGoal) * ce * d;
    out.lookAt.x = g.x;
    out.lookAt.y = g.y;
    out.lookAt.z = g.z;
    out.fov = V.fov;
    return out;
  }

  /**
   * Slide the goal centre along the goal view axis to where that axis meets the ground, keeping the
   * goal camera position (so the view does not change). Skipped (false) when framed, when the ground
   * is nearer than minDistance or much farther than the centre, or when the axis misses it.
   */
  private anchorGoal(terrain: Terrain): boolean {
    if (this.isFramed) return false;
    const ce = Math.cos(this.elGoal);
    // centre → camera direction (heading θ → (sin θ, cos θ))
    const ux = Math.sin(this.azGoal) * ce;
    const uy = Math.sin(this.elGoal);
    const uz = Math.cos(this.azGoal) * ce;
    const g = this.goal;
    const d = this.distGoal;
    const r = this.axisRay;
    r.ox = g.x + ux * d;
    r.oy = g.y + uy * d;
    r.oz = g.z + uz * d;
    r.dx = -ux;
    r.dy = -uy;
    r.dz = -uz;
    const hit = this.axisHit;
    if (!raycastGround(terrain, r, d * V.anchorReach, hit)) return false;
    const t = Math.hypot(hit.x - r.ox, hit.y - r.oy, hit.z - r.oz);
    if (t < V.minDistance) return false;
    g.x = hit.x;
    g.y = hit.y;
    g.z = hit.z;
    this.distGoal = t;
    return true;
  }

  /** Advance smoothing / flights / auto-rotation and write the orbit pose (kept above the ground). */
  update(dt: number, autoRotate: boolean, terrain: Terrain, out: CameraPose): CameraPose {
    this.idle += dt;
    if (autoRotate) {
      const ramp = clamp01((this.idle - V.idleDelay) / V.autoRotateRamp);
      this.azGoal += V.autoRotateRate * ramp * dt;
    }
    const floor = orbitMinElevation(this.goalDistance());
    if (this.elGoal < floor) this.elGoal = floor;
    this.az = damp(this.az, this.azGoal, V.angleRate, dt);
    const c = this.centre;
    const g = this.goal;
    if (this.flightT >= 0) {
      this.flightT += dt;
      const k = smootherstep01(this.flightT / V.flyTime);
      const f = this.flightFrom;
      c.x = lerp(f.x, g.x, k);
      c.y = lerp(f.y, g.y, k);
      c.z = lerp(f.z, g.z, k);
      this.el = lerp(f.el, this.elGoal, k);
      if (this.isFramed) this.zoom = lerp(f.d, this.zoomGoal, k);
      else this.dist = lerp(f.d, this.distGoal, k);
      if (k >= 1) this.flightT = -1;
    } else {
      const r = this.rate;
      c.x = damp(c.x, g.x, r, dt);
      c.y = damp(c.y, g.y, r, dt);
      c.z = damp(c.z, g.z, r, dt);
      this.el = damp(this.el, this.elGoal, V.angleRate, dt);
      if (this.isFramed) this.zoom = damp(this.zoom, this.zoomGoal, r, dt);
      else this.dist = damp(this.dist, this.distGoal, r, dt);
    }
    this.lineWeight = clamp01(this.lineWeight + (this.isFramed ? -dt : dt) / V.lineBlend);

    const d = this.distance;
    const ce = Math.cos(this.el);
    const p = out.position;
    // heading θ → (sin θ, cos θ)
    p.x = c.x + Math.sin(this.az) * ce * d;
    p.y = c.y + Math.sin(this.el) * d;
    p.z = c.z + Math.cos(this.az) * ce * d;
    out.lookAt.x = c.x;
    out.lookAt.y = c.y;
    out.lookAt.z = c.z;
    out.fov = V.fov;
    enforceClearance(terrain, p, 0, 0, 0, false);
    // Close up, also keep the line of sight to the focus clear (framed, the bounding-box centre can
    // sit inside a hillside, so this would lift the overview for nothing).
    if (this.lineWeight > 0) {
      const own = p.y;
      enforceClearance(terrain, p, c.x, c.y + V.focusLineUp, c.z, true);
      p.y = own + (p.y - own) * smoothstep(0, 1, this.lineWeight);
    }
    return out;
  }
}

