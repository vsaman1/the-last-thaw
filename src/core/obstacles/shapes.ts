import { Vector3 } from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { createRng } from '../rng';
import type { Vec3 } from '../types';
import { HOUSE } from './catalog';

/**
 * Shape kit: deterministic low-poly geometry shared by Rapier colliders and the renderer.
 *
 * Every geometry is either a convex hull (collider = Rapier convex mesh over `points`, render mesh =
 * the triangulated hull of exactly those points) or a box (collider = cuboid(halfExtents), render
 * mesh = the same box plus thin decorative insets such as windows). A body part references a
 * geometry by key plus a per-axis scale, so the same scaled vertices feed both systems.
 *
 * Structure-kit primitives ('kit:*') all fill the unit cube [-0.5, 0.5]³, so a part's scale is its
 * size in metres. One exception to "render = hull": a lathe renders its true surface of revolution
 * (a concave profile such as a cooling tower's waist) while it collides as the hull of the same
 * vertices; the bounding boxes are identical.
 */

export const ROCK_VARIANTS = 6;
export const PEBBLE_VARIANTS = 4;
export const STONE_VARIANTS = 3;
export const BLOB_VARIANTS = 3;
export const ICE_VARIANTS = 6;

/**
 * Geometry key. The built-in keys are created eagerly; the structure kit registers more on first
 * use ('kit:box', 'kit:cyl:8:1', 'kit:lathe:<id>', 'kit:prism:<id>') and glacier ice uses 'ice0'...
 */
export type GeomKey = string;

/** Flat-shaded triangle soup. Colours are sRGB 0..1 and multiply with the per-instance tint. */
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
}

export interface GeomDef {
  readonly key: GeomKey;
  readonly collider: 'hull' | 'box';
  /** Hull vertices (x,y,z triplets) for 'hull'; the 8 corners for 'box'. Geometry-local units. */
  readonly points: Float32Array;
  /**
   * Outward-wound triangles of the hull over `points` (empty for 'box'). Lets the collider be a
   * Rapier convexMesh, skipping a per-body hull computation.
   */
  readonly hullIndices: Uint32Array;
  /** Half extents of the cuboid for 'box' geometries (centred on the origin). */
  readonly halfExtents: Vec3;
  readonly min: Vec3;
  readonly max: Vec3;
  /** Volume of the collider solid at scale 1 (m³). */
  readonly volume: number;
  readonly mesh: MeshData;
  /** Render material class: 'ice' draws translucent pale glacier ice. Default opaque. */
  readonly surface?: 'ice';
}

type RGB = readonly [number, number, number];
/** 2D points: [radius, y] lathe profiles or [u, v] prism outlines. */
type Pts2 = readonly (readonly [number, number])[];
const WHITE: RGB = [1, 1, 1];
const UNDERSIDE: RGB = [0.72, 0.72, 0.72];
const WINDOW: RGB = [0.11, 0.13, 0.2];
const DOOR: RGB = [0.42, 0.24, 0.14];

class MeshBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly col: number[] = [];

  tri(a: Vector3, b: Vector3, c: Vector3, color: RGB): void {
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize();
    for (const p of [a, b, c]) {
      this.pos.push(p.x, p.y, p.z);
      this.nrm.push(n.x, n.y, n.z);
      this.col.push(color[0], color[1], color[2]);
    }
  }

  /** Triangle wound so its normal points away from `inside`. */
  triOut(a: Vector3, b: Vector3, c: Vector3, inside: Vector3, color: RGB): void {
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    if (n.lengthSq() < 1e-14) return;
    const centroid = new Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3);
    if (n.dot(centroid.sub(inside)) < 0) this.tri(a, c, b, color);
    else this.tri(a, b, c, color);
  }

  /** Quad a-b-c-d in counter-clockwise order seen from outside. */
  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, color: RGB): void {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  build(): MeshData {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nrm),
      colors: new Float32Array(this.col),
    };
  }
}

function boundsOf(points: Float32Array): { min: Vec3; max: Vec3 } {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i < points.length; i += 3) {
    min.x = Math.min(min.x, points[i]);
    min.y = Math.min(min.y, points[i + 1]);
    min.z = Math.min(min.z, points[i + 2]);
    max.x = Math.max(max.x, points[i]);
    max.y = Math.max(max.y, points[i + 1]);
    max.z = Math.max(max.z, points[i + 2]);
  }
  return { min, max };
}

/** Volume enclosed by closed triangles over `points` (divergence theorem). */
function meshVolume(points: Float32Array, tris: Uint32Array): number {
  let v = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i] * 3;
    const b = tris[i + 1] * 3;
    const c = tris[i + 2] * 3;
    const ax = points[a];
    const ay = points[a + 1];
    const az = points[a + 2];
    const bx = points[b];
    const by = points[b + 1];
    const bz = points[b + 2];
    const cx = points[c];
    const cy = points[c + 1];
    const cz = points[c + 2];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return Math.abs(v) / 6;
}

/**
 * Convex hull of `input`: returns the hull's own vertices (used for the collider) and its
 * triangulated faces (used for rendering), so both describe the identical solid.
 */
function hullGeom(
  key: GeomKey,
  input: readonly Vector3[],
  faceColor: (normal: Vector3, faceIndex: number) => RGB,
): GeomDef {
  const hull = new ConvexHull().setFromPoints(input as Vector3[]);
  const mb = new MeshBuilder();
  const index = new Map<Vector3, number>();
  const pts: number[] = [];
  const tris: number[] = [];
  const idOf = (p: Vector3): number => {
    let i = index.get(p);
    if (i === undefined) {
      i = index.size;
      index.set(p, i);
      pts.push(p.x, p.y, p.z);
    }
    return i;
  };
  hull.faces.forEach((face, fi) => {
    const loop: Vector3[] = [];
    let edge = face.edge;
    do {
      loop.push(edge.head().point);
      edge = edge.next;
    } while (edge !== face.edge);
    const color = faceColor(face.normal, fi);
    for (let i = 1; i + 1 < loop.length; i++) {
      mb.tri(loop[0], loop[i], loop[i + 1], color);
      tris.push(idOf(loop[0]), idOf(loop[i]), idOf(loop[i + 1]));
    }
  });
  const points = new Float32Array(pts);
  const hullIndices = new Uint32Array(tris);
  const { min, max } = boundsOf(points);
  return {
    key,
    collider: 'hull',
    points,
    hullIndices,
    halfExtents: { x: 0, y: 0, z: 0 },
    min,
    max,
    volume: meshVolume(points, hullIndices),
    mesh: mb.build(),
  };
}

/** Vertices of an icosahedron subdivided `detail` times (12, 42, 162 points) on the unit sphere. */
function icosphere(detail: 0 | 1 | 2): Vector3[] {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(([x, y, z]) => new Vector3(x, y, z).normalize());
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let level = 0; level < detail; level++) {
    const mid = new Map<string, number>();
    const midpoint = (a: number, b: number): number => {
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      let i = mid.get(k);
      if (i === undefined) {
        i = verts.length;
        verts.push(new Vector3().addVectors(verts[a], verts[b]).normalize());
        mid.set(k, i);
      }
      return i;
    };
    faces = faces.flatMap(([a, b, c]) => {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
    });
  }
  return verts;
}

/** Push every point that lies beyond the plane n·p = c back onto it (a flat "chipped" facet). */
function cut(points: Vector3[], n: Vector3, c: number): void {
  for (const p of points) {
    const d = p.dot(n);
    if (d > c) p.addScaledVector(n, c - d);
  }
}

function shadeFacet(rng: () => number, normal: Vector3, lo: number, hi: number): RGB {
  const v = Math.min(1, lo + (hi - lo) * rng() + 0.05 * Math.max(0, normal.y));
  return [v, v, v];
}

function rockGeom(variant: number): GeomDef {
  const rng = createRng(0x51ab + variant * 977);
  const pts = icosphere(1).map((p) => p.multiplyScalar(1 + (rng() * 2 - 1) * 0.12));
  for (let i = 0; i < 2; i++) {
    const n = new Vector3(rng() * 2 - 1, rng() * 1.4 - 0.4, rng() * 2 - 1).normalize();
    cut(pts, n, 0.78 + rng() * 0.12);
  }
  const faceRng = createRng(0x77 + variant);
  return hullGeom(`rock${variant}`, pts, (n) => shadeFacet(faceRng, n, 0.84, 1));
}

/**
 * Rounded, uncut small rock. Detail 2 keeps every facet under ~10 degrees, so it cannot rest on
 * slopes steeper than that (a detail-1 rock can sit still on a 17-degree slope).
 */
function pebbleGeom(variant: number): GeomDef {
  const rng = createRng(0x9eb1 + variant * 313);
  const pts = icosphere(2).map((p) => p.multiplyScalar(1 + (rng() * 2 - 1) * 0.025));
  const faceRng = createRng(0x44 + variant);
  return hullGeom(`pebble${variant}`, pts, (n) => shadeFacet(faceRng, n, 0.84, 1));
}

function stoneGeom(variant: number): GeomDef {
  const rng = createRng(0x5701 + variant * 131);
  const pts = icosphere(1).map((p) => p.multiplyScalar(1 + (rng() * 2 - 1) * 0.05));
  cut(pts, new Vector3(0, -1, 0), 0.8);
  cut(pts, new Vector3(0, 1, 0), 0.88);
  const faceRng = createRng(0x99 + variant);
  return hullGeom(`stone${variant}`, pts, (n) => shadeFacet(faceRng, n, 0.86, 1));
}

function blobGeom(variant: number): GeomDef {
  const rng = createRng(0xb10b + variant * 71);
  const pts = icosphere(0).map((p) => p.multiplyScalar(1 + (rng() * 2 - 1) * 0.14));
  const faceRng = createRng(0x33 + variant);
  return hullGeom(`blob${variant}`, pts, (n) => shadeFacet(faceRng, n, 0.8, 1));
}

/**
 * A block of glacier ice: a box with jittered faces and chipped corners, normalised to the unit
 * cube. Facets vary between white and a faint blue so the translucent material reads as ice.
 */
function iceGeom(variant: number): GeomDef {
  const rng = createRng(0x1ce0 + variant * 523);
  const pts: Vector3[] = [];
  for (let ix = -1; ix <= 1; ix++) {
    for (let iy = -1; iy <= 1; iy++) {
      for (let iz = -1; iz <= 1; iz++) {
        if (ix === 0 && iy === 0 && iz === 0) continue;
        const j = (): number => (rng() * 2 - 1) * 0.07;
        pts.push(new Vector3(ix * 0.5 + j(), iy * 0.5 + j() * 0.6, iz * 0.5 + j()));
      }
    }
  }
  const cuts = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < cuts; i++) {
    const n = new Vector3(
      (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.5),
      (rng() < 0.6 ? 1 : -1) * (0.3 + rng() * 0.7),
      (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.5),
    ).normalize();
    cut(pts, n, 0.5 + rng() * 0.14);
  }
  const box = boundsOf(new Float32Array(pts.flatMap((p) => [p.x, p.y, p.z])));
  for (const p of pts) {
    p.x = (p.x - box.min.x) / (box.max.x - box.min.x) - 0.5;
    p.y = (p.y - box.min.y) / (box.max.y - box.min.y) - 0.5;
    p.z = (p.z - box.min.z) / (box.max.z - box.min.z) - 0.5;
  }
  const faceRng = createRng(0x1ce5 + variant);
  const g = hullGeom(`ice${variant}`, pts, (n) => {
    const v = 0.82 + 0.18 * faceRng() + 0.06 * Math.max(0, n.y);
    const blue = Math.max(0, -n.y) * 0.08 + faceRng() * 0.05;
    return [Math.min(1, v - blue * 1.6), Math.min(1, v - blue * 0.5), Math.min(1, v)];
  });
  return { ...g, surface: 'ice' };
}

/** Unit tapered hexagonal trunk: base radius 1 at y = 0, top radius 0.72 at y = 1. */
function trunkGeom(): GeomDef {
  const pts: Vector3[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    pts.push(new Vector3(Math.cos(a), 0, Math.sin(a)));
    pts.push(new Vector3(Math.cos(a) * 0.72, 1, Math.sin(a) * 0.72));
  }
  return hullGeom('trunk', pts, (n) => (Math.abs(n.y) > 0.9 ? [0.8, 0.8, 0.8] : WHITE));
}

/** Unit 7-sided cone: base radius 1 at y = 0, apex at y = 1. */
function coneGeom(): GeomDef {
  const pts: Vector3[] = [new Vector3(0, 1, 0)];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    pts.push(new Vector3(Math.cos(a), 0, Math.sin(a)));
  }
  const rng = createRng(0xc0e);
  return hullGeom('cone', pts, (n) => (n.y < -0.9 ? [0.7, 0.7, 0.7] : shadeFacet(rng, n, 0.86, 1)));
}

/** Axis-aligned box centred on the origin with optional decorative insets on its ±z faces. */
interface Inset {
  /** +1 = on the +z face, -1 = on the -z face. */
  side: 1 | -1;
  cx: number;
  cy: number;
  w: number;
  h: number;
  color: RGB;
}

function boxGeom(key: GeomKey, hx: number, hy: number, hz: number, insets: readonly Inset[] = []): GeomDef {
  const mb = new MeshBuilder();
  const v = (x: number, y: number, z: number): Vector3 => new Vector3(x * hx, y * hy, z * hz);
  mb.quad(v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1), WHITE);
  mb.quad(v(1, -1, -1), v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1), WHITE);
  mb.quad(v(1, -1, 1), v(1, -1, -1), v(1, 1, -1), v(1, 1, 1), WHITE);
  mb.quad(v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1), WHITE);
  mb.quad(v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1), v(-1, 1, -1), WHITE);
  mb.quad(v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1), [0.7, 0.7, 0.7]);
  for (const ins of insets) addInset(mb, ins, hz);
  const points = new Float32Array(24);
  let i = 0;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    points[i++] = sx * hx;
    points[i++] = sy * hy;
    points[i++] = sz * hz;
  }
  return {
    key,
    collider: 'box',
    points,
    hullIndices: new Uint32Array(0),
    halfExtents: { x: hx, y: hy, z: hz },
    min: { x: -hx, y: -hy, z: -hz },
    max: { x: hx, y: hy, z: hz },
    volume: 8 * hx * hy * hz,
    mesh: mb.build(),
  };
}

/** A thin dark panel standing 2.5 cm off the face at z = side * faceZ (render-only detail). */
function addInset(mb: MeshBuilder, ins: Inset, faceZ: number): void {
  const z = ins.side * (faceZ + 0.025);
  const x0 = ins.cx - ins.w / 2;
  const x1 = ins.cx + ins.w / 2;
  const y0 = ins.cy - ins.h / 2;
  const y1 = ins.cy + ins.h / 2;
  const a = new Vector3(x0, y0, z);
  const b = new Vector3(x1, y0, z);
  const c = new Vector3(x1, y1, z);
  const d = new Vector3(x0, y1, z);
  if (ins.side === 1) mb.quad(a, b, c, d, ins.color);
  else mb.quad(b, a, d, c, ins.color);
}

/** Derived house measurements shared by the gable geometry and the house definition. */
export const HOUSE_DIMS = (() => {
  const { width: W, depth: D, wallHeight: H, wallThickness: T, pitch, roofThickness: t, overhang } = HOUSE;
  const tanA = Math.tan(pitch);
  const cosA = Math.cos(pitch);
  const sinA = Math.sin(pitch);
  /** Underside of the roof at the ridge. */
  const ridgeBottom = H + (D / 2) * tanA;
  const slabLength = (D / 2 + overhang + t * sinA) / cosA;
  const slabWidth = W + 2 * overhang * 0.7;
  return {
    W,
    D,
    H,
    T,
    t,
    tanA,
    cosA,
    sinA,
    ridgeBottom,
    gableHalfWidth: D / 2 - T,
    gableEaveY: H + T * tanA,
    slabLength,
    slabWidth,
  };
})();

function houseGableGeom(): GeomDef {
  const { gableHalfWidth: hw, gableEaveY, ridgeBottom, T } = HOUSE_DIMS;
  const pts: Vector3[] = [];
  for (const z of [-T / 2, T / 2]) {
    pts.push(new Vector3(-hw, 0, z), new Vector3(hw, 0, z));
    pts.push(new Vector3(-hw, gableEaveY, z), new Vector3(hw, gableEaveY, z));
    pts.push(new Vector3(0, ridgeBottom, z));
  }
  const g = hullGeom('houseGable', pts, (n) => (n.y < -0.9 ? [0.7, 0.7, 0.7] : WHITE));
  const mb = new MeshBuilder();
  mb.pos.push(...g.mesh.positions);
  mb.nrm.push(...g.mesh.normals);
  mb.col.push(...g.mesh.colors);
  addInset(mb, { side: 1, cx: 0, cy: 1.6, w: 0.9, h: 0.9, color: WINDOW }, T / 2);
  addInset(mb, { side: 1, cx: 0, cy: HOUSE.wallHeight + 0.75, w: 0.5, h: 0.5, color: WINDOW }, T / 2);
  addInset(mb, { side: -1, cx: 0, cy: 1.6, w: 0.9, h: 0.9, color: WINDOW }, T / 2);
  return { ...g, mesh: mb.build() };
}

// ---------------------------------------------------------------------------------------------
// Structure-kit primitives (unit cube, scale = size in metres)
// ---------------------------------------------------------------------------------------------

const faceShade = (n: Vector3): RGB => (n.y < -0.9 ? UNDERSIDE : WHITE);

/** Unit box: size 1 × 1 × 1 centred on the origin. */
function kitBoxGeom(): GeomDef {
  return boxGeom('kit:box', 0.5, 0.5, 0.5);
}

/**
 * Unit cylinder along +y (diameter 1, height 1, centred). taper = top radius / bottom radius;
 * 0 makes a cone with its apex at y = +0.5.
 */
function kitCylinderGeom(key: GeomKey, segments: number, taper: number): GeomDef {
  const pts: Vector3[] = [];
  const off = Math.PI / segments;
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2 + off;
    pts.push(new Vector3(0.5 * Math.sin(a), -0.5, 0.5 * Math.cos(a)));
    if (taper > 0) pts.push(new Vector3(0.5 * taper * Math.sin(a), 0.5, 0.5 * taper * Math.cos(a)));
  }
  if (taper <= 0) pts.push(new Vector3(0, 0.5, 0));
  return hullGeom(key, pts, faceShade);
}

/** Map arbitrary 2D coordinates onto [-0.5, 0.5] per axis. */
function normalise2(points: readonly (readonly [number, number])[]): [number, number][] {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const sx = x1 > x0 ? 1 / (x1 - x0) : 0;
  const sy = y1 > y0 ? 1 / (y1 - y0) : 0;
  return points.map(([x, y]) => [(x - x0) * sx - 0.5, (y - y0) * sy - 0.5]);
}

/**
 * Surface of revolution of `profile` ([radius, y] pairs, bottom to top, any units) about +y,
 * normalised to the unit cube. Renders the true (possibly concave) surface; collides as its hull.
 */
function kitLatheGeom(key: GeomKey, profile: Pts2, segments: number): GeomDef {
  let rMax = 0;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [r, y] of profile) {
    rMax = Math.max(rMax, r);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const prof = profile.map(([r, y]): [number, number] => [
    rMax > 0 ? (0.5 * r) / rMax : 0,
    y1 > y0 ? (y - y0) / (y1 - y0) - 0.5 : 0,
  ]);
  const off = Math.PI / segments;
  const rings = prof.map(([r, y]) => {
    const ring: Vector3[] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2 + off;
      ring.push(new Vector3(r * Math.sin(a), y, r * Math.cos(a)));
    }
    return ring;
  });
  const hull = hullGeom(key, rings.flat(), faceShade);
  const mb = new MeshBuilder();
  for (let k = 0; k + 1 < rings.length; k++) {
    const lo = rings[k];
    const hi = rings[k + 1];
    const axis = new Vector3(0, (prof[k][1] + prof[k + 1][1]) / 2, 0);
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      mb.triOut(lo[i], lo[j], hi[j], axis, WHITE);
      mb.triOut(lo[i], hi[j], hi[i], axis, WHITE);
    }
  }
  const caps: [number, number][] = [
    [0, -1],
    [rings.length - 1, 1],
  ];
  for (const [k, dir] of caps) {
    if (prof[k][0] <= 1e-6) continue;
    const c = new Vector3(0, prof[k][1], 0);
    const inside = new Vector3(0, prof[k][1] - dir, 0);
    for (let i = 0; i < segments; i++) {
      mb.triOut(c, rings[k][i], rings[k][(i + 1) % segments], inside, dir < 0 ? UNDERSIDE : WHITE);
    }
  }
  return { ...hull, mesh: mb.build() };
}

/**
 * Prism: a 2D `outline` (any units) extruded through the unit cube. axis 'z' (default): outline in
 * x/y, extruded along z; axis 'x': outline in z/y (a side profile), extruded along x; axis 'y':
 * outline in x/z (a plan), extruded along y.
 */
function kitPrismGeom(key: GeomKey, outline: Pts2, axis: 'x' | 'y' | 'z'): GeomDef {
  const pts: Vector3[] = [];
  for (const [u, v] of normalise2(outline)) {
    for (const w of [-0.5, 0.5]) {
      pts.push(
        axis === 'z' ? new Vector3(u, v, w) : axis === 'x' ? new Vector3(w, v, u) : new Vector3(u, w, v),
      );
    }
  }
  return hullGeom(key, pts, faceShade);
}

// ---------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------

function buildRegistry(): Map<GeomKey, GeomDef> {
  const m = new Map<GeomKey, GeomDef>();
  const add = (g: GeomDef): void => {
    m.set(g.key, g);
  };
  for (let i = 0; i < ROCK_VARIANTS; i++) add(rockGeom(i));
  for (let i = 0; i < PEBBLE_VARIANTS; i++) add(pebbleGeom(i));
  for (let i = 0; i < STONE_VARIANTS; i++) add(stoneGeom(i));
  for (let i = 0; i < BLOB_VARIANTS; i++) add(blobGeom(i));
  for (let i = 0; i < ICE_VARIANTS; i++) add(iceGeom(i));
  add(trunkGeom());
  add(coneGeom());
  add(kitBoxGeom());
  const { W, H, T, t, slabLength, slabWidth } = HOUSE_DIMS;
  const wy = (y: number): number => y - H / 2;
  add(
    boxGeom('houseFront', W / 2, H / 2, T / 2, [
      { side: 1, cx: -1.5, cy: wy(0.98), w: 1.0, h: 1.9, color: DOOR },
      { side: 1, cx: 1.2, cy: wy(1.65), w: 1.0, h: 0.95, color: WINDOW },
      { side: -1, cx: 1.2, cy: wy(1.65), w: 1.0, h: 0.95, color: WINDOW },
    ]),
  );
  add(
    boxGeom('houseBack', W / 2, H / 2, T / 2, [
      { side: 1, cx: -1.5, cy: wy(1.65), w: 1.0, h: 0.95, color: WINDOW },
      { side: 1, cx: 1.5, cy: wy(1.65), w: 1.0, h: 0.95, color: WINDOW },
    ]),
  );
  add(houseGableGeom());
  add(boxGeom('roofSlab', slabWidth / 2, t / 2, slabLength / 2));
  const c = HOUSE.chimney;
  add(boxGeom('chimney', c.w / 2, c.h / 2, c.d / 2));
  return m;
}

let registry: Map<GeomKey, GeomDef> | null = null;
/** Parameter signature per id-keyed kit shape, to catch two definitions reusing one id. */
const signatures = new Map<GeomKey, string>();

/** All geometries created so far (built-ins are built once on first use; deterministic). */
export function geomRegistry(): ReadonlyMap<GeomKey, GeomDef> {
  if (!registry) registry = buildRegistry();
  return registry;
}

export function getGeom(key: GeomKey): GeomDef {
  const g = geomRegistry().get(key);
  if (!g) throw new Error(`Unknown obstacle geometry: ${key}`);
  return g;
}

function ensure(key: GeomKey, signature: string, build: () => GeomDef): GeomKey {
  const reg = geomRegistry() as Map<GeomKey, GeomDef>;
  const known = signatures.get(key);
  if (known !== undefined && known !== signature) {
    throw new Error(`Shape key "${key}" was registered twice with different parameters`);
  }
  if (!reg.has(key)) {
    reg.set(key, build());
    signatures.set(key, signature);
  }
  return key;
}

/** Unit box (size 1 m per axis). */
export const KIT_BOX: GeomKey = 'kit:box';

/** Unit cylinder (or cone when taper = 0) with `segments` sides; registered on first use. */
export function kitCylinder(segments = 8, taper = 1): GeomKey {
  const n = Math.max(3, Math.min(32, Math.round(segments)));
  const tp = Math.round(Math.max(0, taper) * 1000) / 1000;
  const key = `kit:cyl:${n}:${tp}`;
  return ensure(key, key, () => kitCylinderGeom(key, n, tp));
}

/** Lathe shape `id` from a [radius, y] profile (bottom to top); ids must be unique per profile. */
export function kitLathe(id: string, profile: Pts2, segments = 12): GeomKey {
  if (profile.length < 2) throw new Error(`Lathe "${id}" needs at least two profile points`);
  const n = Math.max(3, Math.min(48, Math.round(segments)));
  const key = `kit:lathe:${id}`;
  return ensure(key, JSON.stringify([profile, n]), () => kitLatheGeom(key, profile, n));
}

/** Prism shape `id` from a convex 2D outline; ids must be unique per outline. */
export function kitPrism(id: string, outline: Pts2, axis: 'x' | 'y' | 'z' = 'z'): GeomKey {
  if (outline.length < 3) throw new Error(`Prism "${id}" needs at least three outline points`);
  const key = `kit:prism:${id}`;
  return ensure(key, JSON.stringify([outline, axis]), () => kitPrismGeom(key, outline, axis));
}

/**
 * Hull shape `id`: the convex hull of `points` ([x, y, z], any units), normalised to the unit cube
 * (e.g. a prism sheared so its sides stand plumb in a tilted body); ids must be unique per point set.
 */
export function kitHull(id: string, points: readonly (readonly [number, number, number])[]): GeomKey {
  if (points.length < 4) throw new Error(`Hull "${id}" needs at least four points`);
  const key = `kit:hull:${id}`;
  return ensure(key, JSON.stringify(points), () => {
    const lo = [0, 1, 2].map((a) => Math.min(...points.map((p) => p[a])));
    const hi = [0, 1, 2].map((a) => Math.max(...points.map((p) => p[a])));
    const n = (v: number, a: number): number => (hi[a] > lo[a] ? (v - lo[a]) / (hi[a] - lo[a]) - 0.5 : 0);
    return hullGeom(key, points.map((p) => new Vector3(n(p[0], 0), n(p[1], 1), n(p[2], 2))), faceShade);
  });
}

/** Hull/box points multiplied per axis by `scale` (what the collider is built from). */
export function scaledPoints(g: GeomDef, scale: Vec3): Float32Array {
  const out = new Float32Array(g.points.length);
  for (let i = 0; i < g.points.length; i += 3) {
    out[i] = g.points[i] * scale.x;
    out[i + 1] = g.points[i + 1] * scale.y;
    out[i + 2] = g.points[i + 2] * scale.z;
  }
  return out;
}
