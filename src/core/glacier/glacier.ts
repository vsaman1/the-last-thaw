import type { IcebergState, Terrain, TerrainFeature, Vec3 } from '../types';
import { clamp, lerp, smoothstep } from '../math';
import { fbm2, hash2 } from '../rng';
import { createIceberg } from '../sim/iceberg';
import { DEFAULT_ICEBERG_PARAMS, withLevelIceberg } from '../sim/params';
import { type CameraPose, createCameraPose, followPose, followScale } from '../camera/follow';
import { profileAt as streamProfileAt, streamDepth } from '../terrain/stream';
import { isGeneratedTerrain } from '../terrain/terrain';

/**
 * The glacier at the top of every level: a snow-covered tongue of ice filling the valley just
 * upstream of the spawn, with a calving face at its snout and the player's iceberg embedded in a
 * socket at the front as the leading chunk. Placement is derived from the level (startS, the course
 * direction there, the iceberg's size) and the follow camera's hand-off pose, so it works for every
 * level without level data, and is deterministic from the level seed. The one thing a level adds is
 * its meltwater: every stream with source 'glacier' runs out of the snout through a PORTAL (see
 * PORTAL_TUNING), an arched opening in the face over its channel, with a local lobe of thicker ice
 * over it where the plain glacier would leave too thin a roof.
 *
 * Frame: a straight local frame at the spawn point along the iceberg's spawn direction. `s` is the
 * course arc length (startS at the spawn, increasing downstream), `d` the lateral offset (+ = right
 * of travel). The glacier is visual only: no colliders (the iceberg never goes back up there).
 */

export const GLACIER_TUNING = {
  /** Geometry radius (m) of the iceberg at visual scale 1 (ICEBERG_VISUAL.baseRadius). */
  icebergBaseRadius: 2.2,
  /** Drawn height of the iceberg above the ground at scale 1 (2.8 m hull − 0.35 m ground sink). */
  icebergHeight: 2.45,
  /**
   * How far it slides out of the glacier: clamp(perRadius × r + base, min, max) metres. Far enough
   * that at the hand-off the follow camera sees it whole over the snout; at most what the short
   * calving can cover reaching the spawn speed (see calving.ts).
   */
  slidePerRadius: 1.1,
  slideBase: 1.6,
  slideMin: 3.2,
  slideMax: 5,
  /** Face line at the centre this many radii upstream of the embedded iceberg's centre. */
  faceBack: 0.3,
  /** Socket the iceberg sits in: half-width and back wall (radii from its centre). */
  socketHalf: 1.12,
  socketBack: 1.06,
  /** Ledge (m per unit of iceberg scale) it drops from; equals the iceberg's visual ground sink. */
  ledgePerScale: 0.35,
  /** The snout recedes upstream toward the sides: this fraction of the floor half-width at its edge. */
  lobe: 0.28,
  /** Glacier half-width = floor half-width + climb × wallRamp (it rides up onto the walls). */
  climb: 0.35,
  /** Dome exponent across the glacier (flatter top, steeper edges for larger values). */
  domePower: 2.5,
  /** Thickness growth upstream of the face (m per m) and the cap (m). */
  thickGrow: 0.35,
  thickMax: 8,
  thickMin: 0.8,
  /** Upstream end: this many wallRamps behind the course start (onto the cirque headwall). */
  backWallRamps: 0.9,
  /**
   * Clearance under the follow camera's hand-off sight line, at the camera and at the face (m). The
   * sight line aims this low on the spawned iceberg (m per unit of scale), so the snout hides at most
   * its foot.
   */
  camMargin: 3,
  sightMargin: 0.25,
  sightTargetUp: 0.6,
  /** Profile sample step along s (m). */
  profileStep: 1,
  /** Snow around the glacier: reach downstream of the face at its ground height (m)... */
  snowReach: 3,
  /** ...plus this much per metre of height above the face's ground... */
  snowReachPerHeight: 1.1,
  /** ...capped (m downstream of the face), ragged by this much (m). */
  snowReachMax: 75,
  snowRagged: 6,
  /** Snow-field ellipse: centre this far upstream of the face, half-length (m), wallRamps beyond the floor. */
  snowCentreBack: 30,
  snowHalfLength: 95,
  snowWallRamps: 2.6,
  /** Faces steeper than this stay bare. */
  snowMaxSlope: 1.25,
} as const;

const G = GLACIER_TUNING;

/**
 * MELTWATER PORTALS. A stream with source 'glacier' rises under the ice and leaves it through the
 * snout: where its polyline first crosses the snout line (glacierSnoutS) the face opens in an arch
 * over the channel, springing from the bank tops (sunk springSink into them) and rising
 * clamp(riseShare × half width, riseMin, riseMax) above them; behind it a vault runs `depth` m into
 * the ice along the stream, narrowing to backShare, and ends in a dark back wall
 * (src/core/glacier/geometry.ts). The opening spans the channel's width measured along the face (wider
 * where the stream leaves obliquely). Over the arch the ice stands at least `roof` m: where the
 * plain glacier is thinner the top rises in a lobe (full over the opening, fading over lobeSide m
 * beside it and lobeBack m upstream of the snout), at most maxLift m; where even that leaves no
 * room the arch is lower, down to riseMin (a thinner snout is reported by the world logic rule
 * 'stream-source': GlacierPortal.short). Measured: Power Valley's snout (220 t iceberg) stands
 * 3.9 m over the river's bank tops at d 30 (arch 3.85 m, lobe 1.48 m), Riverside Town's (100 t)
 * 2.9 m at d −47 (arch 3.88 m, lobe 2.5 m), the stream sandbox's (30 t) 2.1 m at d −16 (arch
 * 3.1 m, lobe 2.5 m).
 */
export const PORTAL_TUNING = {
  riseShare: 0.55,
  riseMin: 1.8,
  riseMax: 4.5,
  springSink: 0.45,
  roof: 1.5,
  lobeSide: 8,
  lobeBack: 14,
  maxLift: 2.5,
  depthShare: 1.2,
  depthMin: 5,
  depthMax: 12,
  backShare: 0.8,
  /** Sample step (m) along the stream when looking for where it leaves the ice. */
  walkStep: 0.5,
} as const;

const PT = PORTAL_TUNING;

type Stream = Extract<TerrainFeature, { type: 'stream' }>;

/** Where a glacier-fed stream leaves the ice (frame coordinates; heights in m). */
export interface GlacierPortal {
  /** Index of the stream in level.features. */
  readonly feature: number;
  /** The crossing of the channel's centre line with the snout line, and the stream's arc there. */
  readonly s: number;
  readonly d: number;
  readonly arc: number;
  /** Unit downstream direction of the stream at the crossing (frame s, d). */
  readonly dirS: number;
  readonly dirD: number;
  /** Half width (m) of the opening measured along the face. */
  readonly half: number;
  /** Bank tops, bed and design water surface at the crossing; the arch's apex. */
  readonly springY: number;
  readonly bedY: number;
  readonly waterY: number;
  readonly apexY: number;
  /** How far the lobe raises the glacier top over the opening (m; 0 = the plain glacier is enough). */
  readonly lift: number;
  /** Ice the lobe would need beyond PORTAL_TUNING.maxLift (m; > 0 = the snout is too thin there). */
  readonly short: number;
  /** Vault depth into the ice (m). */
  readonly depth: number;
  /** Bank tops at the back of the vault (the bed rises upstream). */
  readonly backSpringY: number;
}

export interface GlacierPlacement {
  readonly terrain: Terrain;
  readonly seed: number;
  readonly startS: number;
  /** Spawn point (iceberg base) and the frame: unit direction of travel and its right. */
  readonly spawn: Readonly<Vec3>;
  readonly fx: number;
  readonly fz: number;
  readonly rx: number;
  readonly rz: number;
  /** Iceberg collision radius, visual scale (radius / 2.2) and drawn height above the ground (m). */
  readonly radius: number;
  readonly scale: number;
  readonly iceHeight: number;
  /** Slide distance from the socket to the spawn point (m), ledge height (m), spawn speed (m/s). */
  readonly slide: number;
  readonly ledge: number;
  readonly endSpeed: number;
  /** s of the embedded iceberg's centre, of the face at d = 0 and of the upstream end. */
  readonly embedS: number;
  readonly faceS: number;
  readonly backS: number;
  /** Socket half-width and the s of its back wall at d = 0. */
  readonly socketHalf: number;
  readonly socketBackS: number;
  /** Floor half-width at the face, and the glacier's lateral half-extent. */
  readonly floorHalfWidth: number;
  readonly halfWidth: number;
  /** Face height above the ground at the centre (m). */
  readonly faceHeight: number;
  /** ±1: which way the chunk rolls as it tips out (from the seed). */
  readonly rollSign: number;
  /** Side (+1 right of travel, −1 left) the calving camera stands on: the side with lower ground. */
  readonly cameraSide: number;
  /** The follow camera's pose at the hand-off (the glacier stays under its sight line). */
  readonly handoff: Readonly<CameraPose>;
  /** Centreline ground height and glacier thickness, sampled every profileStep from backS. */
  readonly base: Float64Array;
  readonly thick: Float64Array;
  /** Meltwater portals of the level's glacier-fed streams (see PORTAL_TUNING). */
  readonly portals: readonly GlacierPortal[];
}

/** The iceberg as a session spawns it on this terrain (level iceberg scale, default params). */
export function spawnIcebergFor(terrain: Terrain): IcebergState {
  return createIceberg(terrain, withLevelIceberg(DEFAULT_ICEBERG_PARAMS, terrain.level.iceberg));
}

/** World x/z of frame point (s, d) into `out` (y untouched). */
export function glacierWorld(g: GlacierPlacement, s: number, d: number, out: Vec3): Vec3 {
  const u = s - g.startS;
  out.x = g.spawn.x + g.fx * u + g.rx * d;
  out.z = g.spawn.z + g.fz * u + g.rz * d;
  return out;
}

const tmp: Vec3 = { x: 0, y: 0, z: 0 };

/** The local frame while a placement is being built (u = s − startS). */
interface Frame {
  terrain: Terrain;
  spawn: Vec3;
  fx: number;
  fz: number;
  rx: number;
  rz: number;
}

function groundOnFrame(f: Frame, u: number, d: number): number {
  return f.terrain.heightAt(f.spawn.x + f.fx * u + f.rx * d, f.spawn.z + f.fz * u + f.rz * d);
}

function insideBounds(terrain: Terrain, x: number, z: number, pad: number): boolean {
  const b = terrain.level.bounds;
  return x >= b.minX + pad && x <= b.maxX - pad && z >= b.minZ + pad && z <= b.maxZ - pad;
}

function profileAt(g: GlacierPlacement, arr: Float64Array, s: number): number {
  const f = (s - g.backS) / G.profileStep;
  if (f <= 0) return arr[0];
  const n = arr.length - 1;
  if (f >= n) return arr[n];
  const i = Math.floor(f);
  return arr[i] + (arr[i + 1] - arr[i]) * (f - i);
}

/** Centreline ground height under the glacier at s (sampled profile). */
export function glacierBaseAt(g: GlacierPlacement, s: number): number {
  return profileAt(g, g.base, s);
}

/** Glacier thickness at the centreline at s (0 outside [backS, faceS]). */
export function glacierThickAt(g: GlacierPlacement, s: number): number {
  if (s < g.backS || s > g.faceS + 1e-9) return 0;
  return profileAt(g, g.thick, s);
}

/** 0..1 dome factor across the glacier (1 on the centreline, 0 at the lateral edge). */
export function glacierDome(g: GlacierPlacement, d: number): number {
  const a = Math.abs(d) / g.halfWidth;
  return a >= 1 ? 0 : 1 - a ** G.domePower;
}

/** s of the snout (face line) at lateral offset d, ignoring the socket. */
export function glacierSnoutS(g: GlacierPlacement, d: number): number {
  const a = d / g.floorHalfWidth;
  return g.faceS - G.lobe * g.floorHalfWidth * a * a;
}

/** s of the socket's back wall at d (−Infinity outside the socket's width). */
export function glacierSocketS(g: GlacierPlacement, d: number): number {
  const a = d / g.socketHalf;
  if (a <= -1 || a >= 1) return -Infinity;
  return g.embedS - G.socketBack * g.radius * Math.sqrt(1 - a * a);
}

/** Front edge of the glacier top at d: the snout, or the socket's back wall where that is further up. */
export function glacierFrontS(g: GlacierPlacement, d: number): number {
  const snout = glacierSnoutS(g, d);
  const socket = glacierSocketS(g, d);
  return socket > -Infinity ? Math.min(snout, socket) : snout;
}

/** Height of the glacier's top surface at frame point (s, d), ignoring the terrain (may be below it). */
export function glacierSurface(g: GlacierPlacement, s: number, d: number): number {
  return glacierBaseAt(g, s) + glacierThickAt(g, s) * glacierDome(g, d) + portalLift(g, s, d);
}

/** How far the portal lobes raise the glacier top at frame point (s, d) (m). */
function portalLift(g: GlacierPlacement, s: number, d: number): number {
  let lift = 0;
  for (const p of g.portals) {
    if (!(p.lift > 0)) continue;
    const wd = 1 - smoothstep(0, PT.lobeSide, Math.abs(d - p.d) - p.half);
    if (wd <= 0) continue;
    const ws = 1 - smoothstep(0, PT.lobeBack, glacierSnoutS(g, d) - s);
    lift = Math.max(lift, p.lift * wd * ws);
  }
  return lift;
}

/** Height (m) of a portal's arch at frame lateral d (its springs where |d − p.d| = half). */
export function portalArchY(p: GlacierPortal, d: number, scale = 1): number {
  const u = clamp((d - p.d) / (p.half * scale), -1, 1);
  const spring = p.springY - PT.springSink;
  return spring + (p.apexY - spring) * scale * Math.sqrt(1 - u * u);
}

/** Frame point (s, d) of a world point. */
export function glacierFrame(g: GlacierPlacement, x: number, z: number): { s: number; d: number } {
  const px = x - g.spawn.x;
  const pz = z - g.spawn.z;
  return { s: g.startS + px * g.fx + pz * g.fz, d: px * g.rx + pz * g.rz };
}

/** True when frame point (s, d) lies under the glacier (upstream of the snout, inside its width). */
export function underGlacier(g: GlacierPlacement, s: number, d: number): boolean {
  return s >= g.backS && s < glacierSnoutS(g, d) && Math.abs(d) < g.halfWidth;
}

/**
 * Where stream `f` (feature `index`) leaves the glacier through its snout, or why it does not:
 * 'not-under' (its first point is not under the ice), 'side' (it leaves through the glacier's side,
 * where there is no face to open), 'stays' (it never leaves the ice).
 */
export function findGlacierPortal(
  g: GlacierPlacement,
  f: Stream,
  index: number,
): GlacierPortal | 'not-under' | 'side' | 'stays' {
  const t = g.terrain;
  const pts = f.points;
  if (pts.length < 2) return 'stays';
  const frameOf = (s: number, d: number): { s: number; d: number } => {
    const w = t.course.toWorld(s, d);
    return glacierFrame(g, w.x, w.z);
  };
  const first = frameOf(pts[0].s, pts[0].d);
  if (!underGlacier(g, first.s, first.d)) return 'not-under';
  let arc = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    const len = Math.hypot(b.s - a.s, b.d - a.d);
    const n = Math.max(1, Math.ceil(len / PT.walkStep));
    for (let i = 1; i <= n; i++) {
      const u = i / n;
      const q = frameOf(a.s + (b.s - a.s) * u, a.d + (b.d - a.d) * u);
      if (underGlacier(g, q.s, q.d)) continue;
      // Left the ice between u − 1/n and u: find the crossing of the snout line.
      let lo = (i - 1) / n;
      let hi = u;
      for (let it = 0; it < 30; it++) {
        const mid = 0.5 * (lo + hi);
        const m = frameOf(a.s + (b.s - a.s) * mid, a.d + (b.d - a.d) * mid);
        if (underGlacier(g, m.s, m.d)) lo = mid;
        else hi = mid;
      }
      const c = frameOf(a.s + (b.s - a.s) * hi, a.d + (b.d - a.d) * hi);
      if (Math.abs(c.d) >= g.halfWidth - 1e-6 || c.s < g.backS) return 'side';
      const fa = frameOf(a.s, a.d);
      const fb = frameOf(b.s, b.d);
      const el = Math.hypot(fb.s - fa.s, fb.d - fa.d) || 1;
      return portalAt(g, f, index, c.s, c.d, arc + len * hi, (fb.s - fa.s) / el, (fb.d - fa.d) / el);
    }
    arc += len;
  }
  return 'stays';
}

/** The portal of stream `f` leaving the snout at frame (s, d), stream arc `arc`, direction (es, ed). */
function portalAt(
  g: GlacierPlacement,
  f: Stream,
  index: number,
  s: number,
  d: number,
  arc: number,
  es: number,
  ed: number,
): GlacierPortal {
  const t = g.terrain;
  const prof = isGeneratedTerrain(t) ? t.streamProfiles.find((p) => p.index === index) : undefined;
  const ground = (a: number, fs: number, fd: number): number => {
    if (prof) return streamProfileAt(prof, a);
    glacierWorld(g, fs, fd, tmp);
    return t.heightAt(tmp.x, tmp.z);
  };
  const springY = ground(arc, s, d);
  const bedY = springY - f.bank;
  // The opening spans the channel along the face: the snout's tangent at d is (dS/dd, 1).
  const slope = (-2 * G.lobe * d) / g.floorHalfWidth;
  const tl = Math.hypot(slope, 1);
  const sin = Math.abs(es * (1 / tl) - ed * (slope / tl));
  const half = f.width / 2 / Math.max(0.5, sin);
  const depth = clamp(PT.depthShare * (f.width / 2), PT.depthMin, PT.depthMax);
  // The plain glacier (no lobes yet) over the opening: the arch rises as far as the ice (with at
  // most a maxLift lobe) leaves room for its roof, at least riseMin (else the snout is too thin).
  const front = glacierFrontS(g, d);
  const plainTop = glacierBaseAt(g, front) + glacierThickAt(g, front) * glacierDome(g, d);
  const room = plainTop + PT.maxLift - PT.roof - springY;
  const wanted = clamp(PT.riseShare * (f.width / 2), PT.riseMin, PT.riseMax);
  const rise = Math.max(PT.riseMin, Math.min(wanted, room));
  const apexY = springY + rise;
  const need = Math.max(0, apexY + PT.roof - plainTop);
  const backArc = Math.max(0, arc - depth);
  return {
    feature: index,
    s,
    d,
    arc,
    dirS: es,
    dirD: ed,
    half,
    springY,
    bedY,
    waterY: bedY + streamDepth(f),
    apexY,
    lift: Math.min(need, PT.maxLift),
    short: Math.max(0, need - PT.maxLift),
    depth,
    backSpringY: ground(backArc, s - es * depth, d - ed * depth),
  };
}

/** The portals of a placement's level (its glacier-fed streams that leave through the snout). */
function glacierPortals(g: GlacierPlacement): GlacierPortal[] {
  const out: GlacierPortal[] = [];
  (g.terrain.level.features ?? []).forEach((f, index) => {
    if (f.type !== 'stream' || f.source !== 'glacier') return;
    const p = findGlacierPortal(g, f, index);
    if (typeof p !== 'string') out.push(p);
  });
  return out;
}

/**
 * Height of the glacier's top at world (x, z), or −Infinity where there is no glacier (outside its
 * footprint, in the socket, or where the terrain is higher). For camera clearance.
 */
export function glacierTopAt(g: GlacierPlacement, x: number, z: number): number {
  const px = x - g.spawn.x;
  const pz = z - g.spawn.z;
  const s = g.startS + px * g.fx + pz * g.fz;
  const d = px * g.rx + pz * g.rz;
  if (s < g.backS || Math.abs(d) >= g.halfWidth || s > glacierFrontS(g, d)) return -Infinity;
  const top = glacierSurface(g, s, d);
  return top > g.terrain.heightAt(x, z) ? top : -Infinity;
}

/**
 * 0..1 snow cover of the terrain around the glacier at (x, z), ground height h and gradient
 * magnitude `slope`: the cirque, the walls around it and the upper slopes further down-valley (the
 * higher, the further), ragged at the edge, bare on steep rock, never on the iceberg's spawn spot.
 */
export function glacierSnowAt(g: GlacierPlacement, x: number, z: number, h: number, slope: number): number {
  const px = x - g.spawn.x;
  const pz = z - g.spawn.z;
  const s = g.startS + px * g.fx + pz * g.fz;
  const d = px * g.rx + pz * g.rz;
  const terrain = g.terrain;
  const halfW = g.floorHalfWidth + G.snowWallRamps * Math.max(1, terrain.level.wallRamp);
  const cs = g.faceS - G.snowCentreBack;
  const eu = (s - cs) / G.snowHalfLength;
  const ev = d / halfW;
  const e = eu * eu + ev * ev;
  if (e >= 1.3 || slope > G.snowMaxSlope + 0.3) return 0;
  const faceGround = glacierBaseAt(g, g.faceS);
  const rag = fbm2(x / 22, z / 22, g.seed + 611, 3);
  let reach = g.faceS + G.snowReach + G.snowReachPerHeight * Math.max(0, h - faceGround);
  reach = Math.min(reach, g.faceS + G.snowReachMax) + G.snowRagged * rag;
  // The valley floor stays clear in front of the snout (the iceberg slides out onto it).
  if (Math.abs(d) < g.floorHalfWidth + 2) reach = Math.min(reach, glacierSnoutS(g, d) - 0.3);
  if (s > reach) return 0;
  const edge = 1 - smoothstep(0.75, 1.15, e + 0.18 * rag);
  const steep = 1 - smoothstep(G.snowMaxSlope - 0.25, G.snowMaxSlope + 0.25, slope);
  const front = smoothstep(0, 2.5, reach - s);
  const sea = terrain.level.seaLevel;
  return h < sea + 2 ? 0 : edge * steep * front;
}

/** The follow camera at the hand-off, seen from the glacier frame. */
interface HandoffSight {
  startS: number;
  /** Camera position along the frame (u = s − startS), its height, and the sight line's target height. */
  camU: number;
  camY: number;
  targetY: number;
  faceS: number;
  /** Metres behind the camera the calving swing passes over (kept low), before the icefall. */
  swingBack: number;
}

/** Thickness ceiling at s: under the follow camera's hand-off sight line and the camera itself. */
function ceilingAt(s: number, h: HandoffSight): number {
  const u = s - h.startS;
  if (u >= h.camU) {
    const f = h.camU < 0 ? (u - h.camU) / -h.camU : 1;
    const line = h.camY + (h.targetY - h.camY) * clamp(f, 0, 1);
    const k = clamp((s - (h.startS + h.camU)) / Math.max(1e-3, h.faceS - (h.startS + h.camU)), 0, 1);
    return line - lerp(G.camMargin, G.sightMargin, k);
  }
  // Behind the camera: low where the calving swing passes over, then the ice may rise steeply
  // (the icefall; nothing there is in the follow view).
  const back = h.camU - u;
  const gentle = Math.min(back, h.swingBack);
  return h.camY - G.camMargin + gentle * 0.4 + Math.max(0, back - h.swingBack) * 3;
}

/**
 * Builds the placement for a terrain. `spawn` is the iceberg as the session spawns it (default: the
 * level's iceberg with default params); the glacier only depends on its position, direction, radius
 * and speed, so a retry builds the same glacier.
 */
export function createGlacierPlacement(terrain: Terrain, spawnIce?: IcebergState): GlacierPlacement {
  const ice = spawnIce ?? spawnIcebergFor(terrain);
  const level = terrain.level;
  const startS = level.startS;
  const spawn = { x: ice.pos.x, y: ice.pos.y, z: ice.pos.z };
  let fx = ice.vel.x;
  let fz = ice.vel.z;
  let fl = Math.hypot(fx, fz);
  if (!(fl > 1e-6)) {
    const cs = terrain.course.sampleAt(startS);
    fx = cs.dirX;
    fz = cs.dirZ;
    fl = Math.hypot(fx, fz) || 1;
  }
  fx /= fl;
  fz /= fl;
  const rx = -fz;
  const rz = fx;
  const frame: Frame = { terrain, spawn, fx, fz, rx, rz };

  const radius = ice.radius > 0 ? ice.radius : DEFAULT_ICEBERG_PARAMS.radius;
  const scale = radius / G.icebergBaseRadius;
  const iceHeight = G.icebergHeight * scale;
  const slide = clamp(G.slidePerRadius * radius + G.slideBase, G.slideMin, G.slideMax);
  const ledge = G.ledgePerScale * scale;
  const embedS = startS - slide;
  const faceS = embedS - G.faceBack * radius;
  const socketHalf = G.socketHalf * radius;
  const socketBackS = embedS - G.socketBack * radius;
  const endSpeed = Math.hypot(ice.vel.x, ice.vel.z);

  const floorHalfWidth = terrain.course.sampleAt(clamp(faceS, 0, terrain.course.length)).halfWidth;
  const wallRamp = Math.max(1, level.wallRamp);
  const halfWidth = floorHalfWidth + G.climb * wallRamp;

  // Upstream end: onto the headwall, but inside the level bounds (with the full width).
  let backS = Math.min(-G.backWallRamps * wallRamp, faceS - 20);
  for (let k = 0; k < 200; k++) {
    const u = backS - startS;
    const cx = spawn.x + fx * u;
    const cz = spawn.z + fz * u;
    const ok = [-1, 0, 1].every((side) =>
      insideBounds(terrain, cx + rx * halfWidth * side, cz + rz * halfWidth * side, 3),
    );
    if (ok || backS >= faceS - 12) break;
    backS += 1;
  }

  const handoff = followPose(ice, terrain, createCameraPose());
  const camU = (handoff.position.x - spawn.x) * fx + (handoff.position.z - spawn.z) * fz;
  const targetY = spawn.y + G.sightTargetUp * scale;
  const camY = handoff.position.y;

  const step = G.profileStep;
  const n = Math.max(2, Math.ceil((faceS - backS) / step) + 2);
  const base = new Float64Array(n);
  const thick = new Float64Array(n);
  for (let i = 0; i < n; i++) base[i] = groundOnFrame(frame, backS + i * step - startS, 0);
  const baseAt = (s: number): number => {
    const f = clamp((s - backS) / step, 0, n - 1);
    const i = Math.min(n - 2, Math.floor(f));
    return base[i] + (base[i + 1] - base[i]) * (f - i);
  };

  const sight: HandoffSight = { startS, camU, camY, targetY, faceS, swingBack: slide + 6 };
  const ceilFace = ceilingAt(faceS, sight) - baseAt(faceS);
  const faceHeight = Math.max(ledge + 0.8, Math.min(iceHeight + ledge + 0.1 * scale, ceilFace));
  for (let i = 0; i < n; i++) {
    const s = backS + i * step;
    let nominal = Math.min(G.thickMax, faceHeight + Math.max(0, faceS - s) * G.thickGrow);
    nominal *= lerp(0.25, 1, smoothstep(backS, backS + 12, s));
    const ceil = ceilingAt(Math.min(s, faceS), sight) - base[i];
    thick[i] = Math.max(G.thickMin, Math.min(nominal, ceil));
  }
  // The ceiling kinks under the camera; interpolating across the kink would overshoot it there.
  const camS = startS + camU;
  const ci = Math.floor((camS - backS) / step);
  if (ci >= 0 && ci + 1 < n) {
    const f = (camS - backS) / step - ci;
    const top = (1 - f) * (base[ci] + thick[ci]) + f * (base[ci + 1] + thick[ci + 1]);
    const over = top - ceilingAt(camS, sight);
    if (over > 0) {
      thick[ci] = Math.max(G.thickMin, thick[ci] - over);
      thick[ci + 1] = Math.max(G.thickMin, thick[ci + 1] - over);
    }
  }

  // Calving camera side: the side whose ground beside the embedded iceberg is lower (more room).
  const ue = embedS - startS;
  const probe = 14 * followScale(radius);
  const right = groundOnFrame(frame, ue + probe * 0.7, probe);
  const left = groundOnFrame(frame, ue + probe * 0.7, -probe);
  const cameraSide = right <= left + 0.25 ? 1 : -1;

  const plain: GlacierPlacement = {
    terrain,
    seed: level.seed,
    startS,
    spawn,
    fx,
    fz,
    rx,
    rz,
    radius,
    scale,
    iceHeight,
    slide,
    ledge,
    endSpeed,
    embedS,
    faceS,
    backS,
    socketHalf,
    socketBackS,
    floorHalfWidth,
    halfWidth,
    faceHeight,
    rollSign: hash2(level.seed, 7, 41) < 0.5 ? -1 : 1,
    cameraSide,
    handoff,
    base,
    thick,
    portals: [],
  };
  // The meltwater portals are measured on the plain glacier, then raise it locally (their lobes).
  return { ...plain, portals: glacierPortals(plain) };
}

const cache = new WeakMap<Terrain, GlacierPlacement>();

/** The (cached) placement for a terrain's own spawn. */
export function getGlacier(terrain: Terrain): GlacierPlacement {
  let g = cache.get(terrain);
  if (!g) {
    g = createGlacierPlacement(terrain);
    cache.set(terrain, g);
  }
  return g;
}

/** World point at frame (s, d) on the ground (y = terrain height). Allocates; for builders/tests. */
export function glacierGroundPoint(g: GlacierPlacement, s: number, d: number): Vec3 {
  glacierWorld(g, s, d, tmp);
  return { x: tmp.x, y: g.terrain.heightAt(tmp.x, tmp.z), z: tmp.z };
}
