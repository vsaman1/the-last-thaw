import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { clamp01, damp, smoothstep } from '../core/math';
import { createRng } from '../core/rng';
import { getGlacier } from '../core/glacier/glacier';
import { createCalvingClock, readCalving } from './calvingClock';
import { usePrefersReducedMotion } from './reducedMotion';
import { useRuntime } from './RuntimeContext';

export const ICEBERG_VISUAL = {
  /** Fixed shape seed so the player's iceberg looks the same in every level. */
  shapeSeed: 20_251,
  /** Horizontal radius of the built geometry (m); matches the sim's base collision radius. */
  baseRadius: 2.2,
  topColor: '#5CFCEE',
  slopeColor: '#2ED3EE',
  sideColor: '#1C8FD6',
  baseColor: '#0F5FB0',
  /** Emissive tint; the shader multiplies it by the face colour so tops glow turquoise. */
  emissive: '#9FF6FF',
  glow: 0.28,
  rimColor: '#3FE0FF',
  rimOpacity: 0.18,
  rimScale: 1.07,
  lightColor: '#5FF3FF',
  lightIntensity: 14,
  lightDistance: 16,
  /** Sink into the ground so triangle-scale bumps never show a gap under the hull (m). */
  groundSink: 0.35,
  /** Extra depth below the surface once floating (m). */
  oceanDraft: 0.75,
  /** Visual size follows IcebergState.size at this rate (1/s), so melting / refills never pop. */
  sizeRate: 5,
  /** Below this much ice the glow pulses slightly paler (a subtle "running out" cue). */
  lowIce: 0.25,
  lowIcePale: '#F2FFFF',
  /** Pulse frequency of that cue (Hz). */
  lowIcePulse: 1.1,
  /** Vertex count of the original hull; accreted glacier ice is appended after it. */
  hullVertices: 114,
  /** IcebergState.size at which the growth look is complete (cbrt(maxIce ≈ 6) ≈ 1.82). */
  maxGrowthSize: 1.8,
  /** Growth range over which one accreted chunk swells from nothing to full size. */
  growWindow: 0.15,
  accretions: 14,
  /** Frost fades in over ±this much growth around each facet's threshold. */
  frostWindow: 0.12,
  /** Most a facet is tinted toward snow (keeps the glowing ice readable underneath). */
  frostMax: 0.8,
  snowColor: '#F2FAFF',
  /** Fresh fracture faces shown for a moment after a chip. */
  scarColor: '#E9FFFF',
  /** Largest fraction of facets that show a fresh fracture after one hit. */
  maxScar: 0.4,
  /** Chip flash decay rate (1/s, exponential) and scar fade speed (coverage per second, linear). */
  flashRate: 9,
  scarFade: 0.28,
  /** Big-iceberg levels start a little snow-crusted: frost per unit of level scale above 1. */
  levelFrost: 0.4,
  /** After a skipped calving the drawn pose catches up with the sim at this rate (1/s). */
  calvingCatchUp: 14,
  /** Pre-break shudder: lateral amplitude (m per unit of scale) and roll amplitude (rad). */
  shudder: 0.05,
  shudderRoll: 0.012,
  /** Fraction of the radius from the centre to the front-bottom edge the chunk tips over. */
  tipEdge: 0.8,
} as const;

/** Drawn pose offset while the iceberg calves off the glacier (or catches up after a skip). */
interface CalvingOffset {
  along: number;
  lift: number;
  tilt: number;
  roll: number;
}

/** 0 while melting or as spawned, rising to 1 as absorbed glacier ice grows the iceberg. */
export function icebergGrowth(size: number): number {
  return clamp01((size - 1) / (ICEBERG_VISUAL.maxGrowthSize - 1));
}

/**
 * Uniform scale of the drawn iceberg: its collision radius over the geometry's radius (that already
 * includes the level's iceberg.scale and the melt/growth size). Falls back to size × level scale.
 */
export function icebergVisualScale(radius: number, size: number, levelScale = 1): number {
  if (radius > 0) return radius / ICEBERG_VISUAL.baseRadius;
  const s = size * levelScale;
  return s > 0 ? s : 1;
}

/** How far an accreted chunk with this threshold has grown in (mirrors the vertex shader). */
export function growthFactor(threshold: number, growth: number): number {
  return smoothstep(threshold, threshold + ICEBERG_VISUAL.growWindow, growth);
}

/** Snow tint of a facet with this frost threshold (mirrors the vertex shader). */
export function frostFactor(threshold: number, frost: number): number {
  const w = ICEBERG_VISUAL.frostWindow;
  return smoothstep(threshold - w, threshold + w, frost) * ICEBERG_VISUAL.frostMax;
}

/** Damage look: a quick glow flash and a fraction of facets showing fresh fracture. */
export interface ChipLook {
  flash: number;
  scar: number;
}

/** Add a chip of `amount` (fraction of a full iceberg) to the look; never weakens it. */
export function chipLookFor(amount: number, look: ChipLook): void {
  if (!(amount > 0)) return;
  const flash = Math.min(1, 0.45 + amount * 6);
  const scar = Math.min(ICEBERG_VISUAL.maxScar, 0.1 + amount * 3);
  if (flash > look.flash) look.flash = flash;
  if (scar > look.scar) look.scar = scar;
}

/** Fade the damage look: the flash decays fast, scars fade facet by facet at a steady pace. */
export function decayChipLook(look: ChipLook, dt: number): void {
  if (look.flash > 0) {
    look.flash *= Math.exp(-ICEBERG_VISUAL.flashRate * dt);
    if (look.flash < 0.01) look.flash = 0;
  }
  if (look.scar > 0) look.scar = Math.max(0, look.scar - ICEBERG_VISUAL.scarFade * dt);
}

interface Face {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  /** Accretion threshold (−1 = part of the hull, always shown). */
  grow: number;
  /** Where an accretion grows out of the hull (null for hull faces). */
  anchor: THREE.Vector3 | null;
  /** A point inside the solid the face belongs to (its normal must point away from it). */
  inside: THREE.Vector3;
}

const ORIGIN = new THREE.Vector3();
const HULL_CENTRE = new THREE.Vector3(0, 1.35, 0);

/**
 * A chunky low-poly ice floe: irregular hexagonal prism (base, waist and shoulder rings, tapered
 * toward the base and the top) capped by a faceted top with two low peaks. Base at y = 0, facing
 * +Z, ~4.4 m across and ~2.8 m tall. Non-indexed with per-face normals and colours.
 *
 * After the hull come accreted glacier-ice chunks (aGrow > 0, aAnchor = where each grows out of the
 * hull) that the shader swells in as the iceberg grows, plus per-facet frost (aFrost) and fracture
 * (aChip) thresholds. Everything is seeded, so the shape is identical every run.
 */
export function buildIcebergGeometry(seed: number): THREE.BufferGeometry {
  const rng = createRng(seed);
  const R = ICEBERG_VISUAL.baseRadius;
  const N = 6;
  const angles: number[] = [];
  const radial: number[] = [];
  for (let i = 0; i < N; i++) {
    angles.push(((i + 0.5) / N) * Math.PI * 2 + (rng() - 0.5) * 0.24);
    radial.push(0.92 + rng() * 0.12);
  }
  const ringDefs = [
    { y: 0, f: 0.8, jy: 0 },
    { y: 1.05, f: 1.0, jy: 0.2 },
    { y: 1.95, f: 0.8, jy: 0.24 },
  ];
  const rings = ringDefs.map((r) =>
    angles.map((a, i) => {
      const rr = R * r.f * radial[i] * (0.96 + rng() * 0.08);
      return new THREE.Vector3(Math.sin(a) * rr, r.y + (rng() - 0.5) * r.jy, Math.cos(a) * rr);
    }),
  );

  const faces: Face[] = [];
  const hull = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void => {
    faces.push({ a, b, c, grow: -1, anchor: null, inside: HULL_CENTRE });
  };
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const a = rings[k][i];
      const b = rings[k][j];
      const c = rings[k + 1][j];
      const d = rings[k + 1][i];
      if ((i + k) % 2 === 0) {
        hull(a, b, c);
        hull(a, c, d);
      } else {
        hull(a, b, d);
        hull(b, c, d);
      }
    }
  }
  const bottomCentre = new THREE.Vector3(0, 0, 0);
  for (let i = 0; i < N; i++) hull(rings[0][(i + 1) % N], rings[0][i], bottomCentre);

  // Faceted top: each shoulder edge fans to its nearer peak; two bridge triangles join the fans.
  const pa = angles[1] + (rng() - 0.5) * 0.4;
  const pb = pa + Math.PI + (rng() - 0.5) * 0.4;
  const peaks = [
    new THREE.Vector3(Math.sin(pa) * 0.75, 2.8, Math.cos(pa) * 0.75),
    new THREE.Vector3(Math.sin(pb) * 0.6, 2.45 + rng() * 0.1, Math.cos(pb) * 0.6),
  ];
  const top = rings[rings.length - 1];
  const owner: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = top[i];
    const b = top[(i + 1) % N];
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const d0 = Math.hypot(mx - peaks[0].x, mz - peaks[0].z);
    const d1 = Math.hypot(mx - peaks[1].x, mz - peaks[1].z);
    owner.push(d0 <= d1 ? 0 : 1);
  }
  for (let i = 0; i < N; i++) {
    hull(top[i], top[(i + 1) % N], peaks[owner[i]]);
    const prev = owner[(i + N - 1) % N];
    if (prev !== owner[i]) hull(top[i], peaks[owner[i]], peaks[prev]);
  }
  const hullFaces = faces.length;
  addAccretions(faces, createRng((seed ^ 0x5eed1ce) >>> 0));

  const vcount = faces.length * 3;
  const positions = new Float32Array(vcount * 3);
  const normals = new Float32Array(vcount * 3);
  const colors = new Float32Array(vcount * 3);
  const anchors = new Float32Array(vcount * 3);
  const grow = new Float32Array(vcount);
  const frost = new Float32Array(vcount);
  const chip = new Float32Array(vcount);
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const n = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const toMid = new THREE.Vector3();
  const col = new THREE.Color();
  const cTop = new THREE.Color(ICEBERG_VISUAL.topColor);
  const cSlope = new THREE.Color(ICEBERG_VISUAL.slopeColor);
  const cSide = new THREE.Color(ICEBERG_VISUAL.sideColor);
  const cBase = new THREE.Color(ICEBERG_VISUAL.baseColor);
  const cSnow = new THREE.Color(ICEBERG_VISUAL.snowColor);
  const cPale = new THREE.Color('#B4ECF8');
  const cPaleDeep = new THREE.Color('#86D8F0');
  const cUnder = new THREE.Color('#4FA6D6');
  // Separate streams so the hull keeps its original colours whatever is added after it.
  const accRng = createRng((seed ^ 0xacc7e) >>> 0);
  const faceRng = createRng((seed * 31 + 7) >>> 0);

  faces.forEach((t, ti) => {
    let { b, c } = t;
    const a = t.a;
    const isHull = ti < hullFaces;
    e1.subVectors(b, a);
    e2.subVectors(c, a);
    n.crossVectors(e1, e2);
    mid.copy(a).add(b).add(c).divideScalar(3);
    if (n.dot(toMid.copy(mid).sub(t.inside)) < 0) {
      [b, c] = [c, b];
      n.negate();
    }
    n.normalize();

    let fr: number;
    if (isHull) {
      // Alternate top facets between turquoise and a deeper teal so the faceting reads in bright sun.
      if (n.y > 0.6) col.copy(cTop).lerp(cSlope, n.x * 0.7 + n.z * 0.3 > 0 ? 0.35 : 0);
      else if (n.y > 0.22) col.copy(cSlope).lerp(cTop, ((n.y - 0.22) / 0.38) * 0.5);
      else if (n.y < -0.5) col.copy(cBase);
      else col.copy(cBase).lerp(cSide, THREE.MathUtils.clamp(mid.y / 1.9, 0, 1));
      col.multiplyScalar(0.93 + rng() * 0.12);
      // Snow settles on the top first, then the slopes, then the sides; never underneath. Even fully
      // grown, some slopes and most sides stay glowing ice, so it still reads as the player's iceberg.
      const r = faceRng();
      if (n.y > 0.6) fr = 0.15 + 0.3 * r;
      else if (n.y > 0.22) fr = 0.45 + 0.85 * r;
      else if (n.y < -0.5) fr = 2;
      else if (n.y < 0) fr = 0.95 + 0.4 * r;
      else fr = 0.7 + 0.6 * r;
    } else {
      if (n.y > 0.45) col.copy(cSnow);
      else if (n.y < -0.4) col.copy(cUnder);
      else col.copy(cPale).lerp(cPaleDeep, accRng());
      col.multiplyScalar(0.93 + accRng() * 0.1);
      fr = n.y > 0.45 ? -0.2 : n.y < -0.4 ? 2 : 0.55 + 0.5 * faceRng();
    }
    const ch = n.y < -0.5 ? 2 : faceRng();

    const verts = [a, b, c];
    const anchor = t.anchor ?? ORIGIN;
    for (let v = 0; v < 3; v++) {
      const vi = ti * 3 + v;
      const o = vi * 3;
      positions[o] = verts[v].x;
      positions[o + 1] = verts[v].y;
      positions[o + 2] = verts[v].z;
      normals[o] = n.x;
      normals[o + 1] = n.y;
      normals[o + 2] = n.z;
      colors[o] = col.r;
      colors[o + 1] = col.g;
      colors[o + 2] = col.b;
      anchors[o] = anchor.x;
      anchors[o + 1] = anchor.y;
      anchors[o + 2] = anchor.z;
      grow[vi] = t.grow;
      frost[vi] = fr;
      chip[vi] = ch;
    }
  });

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('aAnchor', new THREE.BufferAttribute(anchors, 3));
  g.setAttribute('aGrow', new THREE.BufferAttribute(grow, 1));
  g.setAttribute('aFrost', new THREE.BufferAttribute(frost, 1));
  g.setAttribute('aChip', new THREE.BufferAttribute(chip, 1));
  // Bounds include fully grown accretions, so culling stays conservative.
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/**
 * Glacier ice that has frozen onto the hull: squat, hipped lumps stuck to the shoulders,
 * sides and top, spread around the iceberg (golden-angle azimuths) and given staggered growth
 * thresholds so the silhouette bulks up gradually and unevenly as the iceberg grows.
 */
function addAccretions(faces: Face[], rng: () => number): void {
  const count = ICEBERG_VISUAL.accretions;
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const eligible: { f: Face; n: THREE.Vector3; mid: THREE.Vector3; az: number }[] = [];
  for (const f of faces) {
    const mid = new THREE.Vector3().copy(f.a).add(f.b).add(f.c).divideScalar(3);
    const n = new THREE.Vector3().crossVectors(e1.subVectors(f.b, f.a), e2.subVectors(f.c, f.a));
    if (n.dot(e1.subVectors(mid, HULL_CENTRE)) < 0) n.negate();
    n.normalize();
    if (mid.y < 0.9 || n.y < -0.2) continue;
    eligible.push({ f, n, mid, az: Math.atan2(mid.x, mid.z) });
  }
  // Staggered thresholds, shuffled so chunks appear all around rather than in azimuth order.
  const thresholds: number[] = [];
  for (let i = 0; i < count; i++) thresholds.push(0.05 + ((i + rng()) / count) * 0.8);
  for (let i = thresholds.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [thresholds[i], thresholds[j]] = [thresholds[j], thresholds[i]];
  }

  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const X = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < count; i++) {
    const target = i * 2.39996 + rng() * 0.4;
    const sorted = eligible
      .map((e) => ({ e, d: Math.abs(Math.atan2(Math.sin(e.az - target), Math.cos(e.az - target))) }))
      .sort((p, q) => p.d - q.d);
    const pick = sorted[Math.min(sorted.length - 1, Math.floor(rng() * 3))].e;
    // Random point on the chosen facet (kept away from its edges).
    let r1 = 0.15 + rng() * 0.7;
    let r2 = 0.15 + rng() * 0.7;
    if (r1 + r2 > 1) {
      r1 = 1 - r1;
      r2 = 1 - r2;
    }
    const f = pick.f;
    const anchor = new THREE.Vector3()
      .copy(f.a)
      .addScaledVector(e1.subVectors(f.b, f.a), r1)
      .addScaledVector(e2.subVectors(f.c, f.a), r2);
    const n = pick.n;
    const topFacet = n.y > 0.6;
    const h = topFacet ? 0.2 + rng() * 0.12 : 0.3 + rng() * 0.15;
    const w1 = 0.45 + rng() * 0.4;
    const w2 = topFacet ? 0.4 + rng() * 0.35 : 0.34 + rng() * 0.18;
    u.crossVectors(Math.abs(n.y) > 0.9 ? X : UP, n).normalize();
    v.crossVectors(n, u).normalize();
    const c = new THREE.Vector3().copy(anchor).addScaledVector(n, h * (topFacet ? 0.3 : 0.4));
    const jit = (): number => 0.85 + rng() * 0.3;
    // A ridge instead of a single apex: a hipped, slab-like lump of ice rather than a crystal spike.
    const ridge = c.clone().addScaledVector(n, h * jit()).addScaledVector(v, (rng() - 0.5) * w2 * 0.4);
    const pts = [
      ridge.clone().addScaledVector(u, w1 * (0.3 + rng() * 0.2)),
      ridge.clone().addScaledVector(u, -w1 * (0.3 + rng() * 0.2)),
      c.clone().addScaledVector(n, -h * jit()),
      c.clone().addScaledVector(u, w1 * jit()).addScaledVector(n, (rng() - 0.5) * h * 0.4),
      c.clone().addScaledVector(u, -w1 * jit()).addScaledVector(n, (rng() - 0.5) * h * 0.4),
      c.clone().addScaledVector(v, w2 * jit()).addScaledVector(n, (rng() - 0.5) * h * 0.4),
      c.clone().addScaledVector(v, -w2 * jit()).addScaledVector(n, (rng() - 0.5) * h * 0.4),
    ];
    const [ra, rb, nn, pu, mu, pv, mv] = pts;
    const tris: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [
      [pu, pv, ra],
      [pv, mu, rb],
      [pv, rb, ra],
      [mu, mv, rb],
      [mv, pu, ra],
      [mv, ra, rb],
      [nn, pv, pu],
      [nn, mu, pv],
      [nn, mv, mu],
      [nn, pu, mv],
    ];
    for (const [a, b, cc] of tris) faces.push({ a, b, c: cc, grow: thresholds[i], anchor, inside: c });
  }
}

// --- shaders ----------------------------------------------------------------------------------

interface IceUniforms {
  uGrowth: { value: number };
  uFrost: { value: number };
  uScar: { value: number };
  uSnow: { value: THREE.Color };
  uScarColor: { value: THREE.Color };
}

function createIceUniforms(): IceUniforms {
  return {
    uGrowth: { value: 0 },
    uFrost: { value: 0 },
    uScar: { value: 0 },
    uSnow: { value: new THREE.Color(ICEBERG_VISUAL.snowColor) },
    uScarColor: { value: new THREE.Color(ICEBERG_VISUAL.scarColor) },
  };
}

const glslFloat = (v: number): string => v.toFixed(4);

const GROWTH_PARS = /* glsl */ `
attribute float aGrow;
attribute vec3 aAnchor;
uniform float uGrowth;
`;
// Accretions collapse onto their anchor (zero-area, not rasterised) until the iceberg grows.
const GROWTH_VERTEX = /* glsl */ `
transformed = aAnchor + (transformed - aAnchor)
  * smoothstep(aGrow, aGrow + ${glslFloat(ICEBERG_VISUAL.growWindow)}, uGrowth);
`;

const LOOK_VERTEX_PARS = /* glsl */ `
attribute float aFrost;
attribute float aChip;
uniform float uFrost;
uniform float uScar;
varying float vFrost;
varying float vScar;
`;
const LOOK_VERTEX = /* glsl */ `
vFrost = smoothstep(aFrost - ${glslFloat(ICEBERG_VISUAL.frostWindow)}, aFrost + ${glslFloat(
  ICEBERG_VISUAL.frostWindow,
)}, uFrost) * ${glslFloat(ICEBERG_VISUAL.frostMax)};
vScar = clamp((uScar - aChip) * 6.0, 0.0, 1.0);
`;

function injectGrowth(
  shader: THREE.WebGLProgramParametersWithUniforms,
  u: IceUniforms,
  look: boolean,
): void {
  shader.uniforms.uGrowth = u.uGrowth;
  let pars = GROWTH_PARS;
  let body = GROWTH_VERTEX;
  if (look) {
    shader.uniforms.uFrost = u.uFrost;
    shader.uniforms.uScar = u.uScar;
    pars += LOOK_VERTEX_PARS;
    body += LOOK_VERTEX;
  }
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${pars}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${body}`);
}

function createIceMaterial(u: IceUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.28,
    metalness: 0.05,
    emissive: new THREE.Color(ICEBERG_VISUAL.emissive),
    emissiveIntensity: ICEBERG_VISUAL.glow,
  });
  m.onBeforeCompile = (shader) => {
    injectGrowth(shader, u, true);
    shader.uniforms.uSnow = u.uSnow;
    shader.uniforms.uScarColor = u.uScarColor;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform vec3 uSnow;',
          'uniform vec3 uScarColor;',
          'varying float vFrost;',
          'varying float vScar;',
        ].join('\n'),
      )
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          'diffuseColor.rgb = mix(mix(diffuseColor.rgb, uSnow, vFrost), uScarColor, vScar * 0.8);',
        ].join('\n'),
      )
      // Emissive × vertex colour: glowing turquoise tops and deep-blue sides instead of a flat wash.
      // Snow glows less than ice (enough that crust in shadow reads pale blue-white, not grey); fresh
      // fractures glow a little brighter for a moment.
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          '#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )',
          '  totalEmissiveRadiance *= mix(vColor.rgb, vec3(0.6, 0.75, 0.8), vFrost)',
          '    + vec3(0.6, 0.85, 0.85) * vScar;',
          '#endif',
        ].join('\n'),
      );
  };
  m.customProgramCacheKey = () => 'iceberg-growth-v3';
  return m;
}

function createRimMaterial(u: IceUniforms): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    color: ICEBERG_VISUAL.rimColor,
    side: THREE.BackSide,
    transparent: true,
    opacity: ICEBERG_VISUAL.rimOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  m.onBeforeCompile = (shader) => injectGrowth(shader, u, false);
  m.customProgramCacheKey = () => 'iceberg-rim-growth';
  return m;
}

/** Shadow pass: same growth so hidden accretions cast no shadow. */
function createDepthMaterial(u: IceUniforms): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial();
  m.onBeforeCompile = (shader) => injectGrowth(shader, u, false);
  m.customProgramCacheKey = () => 'iceberg-depth-growth';
  return m;
}

/**
 * The player's glowing iceberg. Reads `useRuntime().iceberg` every frame; no React state.
 * Scales with its collision radius (level scale × melt/growth size, smoothed), bulks up with
 * snow-crusted glacier ice as it grows, flashes and shows fresh fractures when ice is chipped off,
 * and pulses paler when almost out of ice. During the intro it is drawn embedded in the glacier
 * front, snow-capped, and calves off (shudder, break flash, tip, drop, slide) onto its spawn pose —
 * a drawn offset only: the simulated iceberg stays at the spawn until the hand-off.
 */
export function Iceberg() {
  const rt = useRuntime();
  const outer = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  const levelScale = rt.level.iceberg?.scale ?? 1;
  const glacier = useMemo(() => getGlacier(rt.terrain), [rt]);
  const calving = useRef(createCalvingClock());
  const offset = useRef<CalvingOffset>({ along: 0, lift: 0, tilt: 0, roll: 0 });
  const broken = useRef(true);
  const reduceMotion = usePrefersReducedMotion();
  const vis = useRef({
    ocean: rt.iceberg.inOcean ? 1 : 0,
    size: rt.iceberg.size > 0 ? rt.iceberg.size : 1,
    scale: icebergVisualScale(rt.iceberg.radius, rt.iceberg.size, levelScale),
  });
  const chip = useRef<ChipLook>({ flash: 0, scar: 0 });
  const glow = useMemo(
    () => ({
      base: new THREE.Color(ICEBERG_VISUAL.emissive),
      pale: new THREE.Color(ICEBERG_VISUAL.lowIcePale),
      white: new THREE.Color('#FFFFFF'),
    }),
    [],
  );

  const uniforms = useMemo(() => createIceUniforms(), []);
  const geometry = useMemo(() => buildIcebergGeometry(ICEBERG_VISUAL.shapeSeed), []);
  const material = useMemo(() => createIceMaterial(uniforms), [uniforms]);
  const rimMaterial = useMemo(() => createRimMaterial(uniforms), [uniforms]);
  const depthMaterial = useMemo(() => createDepthMaterial(uniforms), [uniforms]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      rimMaterial.dispose();
      depthMaterial.dispose();
    },
    [geometry, material, rimMaterial, depthMaterial],
  );

  useEffect(
    () =>
      rt.events.on((e) => {
        if (e.type === 'iceChipped') chipLookFor(e.amount, chip.current);
      }),
    [rt],
  );

  useFrame((_state, delta) => {
    const g = outer.current;
    const b = body.current;
    if (!g || !b) return;
    const ice = rt.iceberg;
    const t = rt.time;
    const v = vis.current;
    const dt = Math.min(delta, 0.1);
    // Floating on a stream or reservoir looks like floating at sea (draft and bob).
    v.ocean = damp(v.ocean, ice.inOcean || ice.afloat ? 1 : 0, 3, dt);
    if (ice.size > 0) {
      v.size = damp(v.size, ice.size, ICEBERG_VISUAL.sizeRate, dt);
      const target = icebergVisualScale(ice.radius, ice.size, levelScale);
      v.scale = damp(v.scale, target, ICEBERG_VISUAL.sizeRate, dt);
    }
    const scale = v.scale;
    const growth = icebergGrowth(v.size);
    uniforms.uGrowth.value = growth;

    // Calving: the drawn pose offset from the spawn (exact while the intro runs; after a skip it
    // catches up with the sim instead of popping).
    const cv = readCalving(rt, glacier, calving.current);
    const cs = cv.state;
    const off = offset.current;
    if (cv.active) {
      off.along = cs.along;
      off.lift = cs.lift;
      off.tilt = cs.tilt;
      off.roll = cs.roll * glacier.rollSign;
    } else {
      const k = ICEBERG_VISUAL.calvingCatchUp;
      off.along = damp(off.along, 0, k, dt);
      off.lift = damp(off.lift, 0, k, dt);
      off.tilt = damp(off.tilt, 0, k, dt);
      off.roll = damp(off.roll, 0, k, dt);
    }
    const snowCap = cv.active ? cs.frost : 0;
    const levelCrust = Math.min(0.35, (levelScale - 1) * ICEBERG_VISUAL.levelFrost);
    uniforms.uFrost.value = Math.max(growth, levelCrust, snowCap);

    const look = chip.current;
    // The break: the same flash a hard chip gives, as the chunk tears free.
    if (cv.active && cs.broken && !broken.current) look.flash = Math.max(look.flash, 0.9);
    broken.current = !cv.active || cs.broken;
    decayChipLook(look, dt);
    uniforms.uScar.value = look.scar;
    const flash = look.flash;

    const o = v.ocean;
    const bob = o * (Math.sin(t * 1.4) * 0.14 + Math.sin(t * 2.3 + 1) * 0.05) * scale;
    const sink = (ICEBERG_VISUAL.groundSink + o * ICEBERG_VISUAL.oceanDraft) * scale;
    let x = ice.pos.x;
    let y = ice.pos.y;
    let z = ice.pos.z;
    let shudderRoll = 0;
    if (off.along > 1e-4 || off.lift > 1e-4 || Math.abs(off.tilt) > 1e-5) {
      x -= glacier.fx * off.along;
      z -= glacier.fz * off.along;
      const amp = cv.active && !reduceMotion ? cs.shudder : 0;
      if (amp > 0) {
        const j = amp * ICEBERG_VISUAL.shudder * scale * Math.sin(t * 71) * Math.cos(t * 23);
        x += glacier.rx * j;
        z += glacier.rz * j;
        shudderRoll = amp * ICEBERG_VISUAL.shudderRoll * Math.sin(t * 59 + 1.7);
      }
      // Tipping forward over its front-bottom edge raises the centre of the base.
      const tip = ICEBERG_VISUAL.tipEdge * ice.radius * Math.sin(Math.max(0, off.tilt));
      y = rt.terrain.heightAt(x, z) + off.lift + tip;
    }
    g.position.set(x, y - sink + bob, z);
    g.scale.setScalar(scale);
    const bobPitch = o * Math.sin(t * 1.1) * 0.035;
    const bobRoll = o * Math.sin(t * 0.9 + 0.5) * 0.045;
    // Euler order YXZ: yaw by heading, then nose-up pitch and right-side-up roll (see sim/iceberg.ts).
    // A calving tilt tips the nose down (−pitch).
    g.rotation.set(
      -(ice.pitch - off.tilt + bobPitch),
      ice.heading,
      -(ice.roll + off.roll + shudderRoll + bobRoll),
    );

    const k = ice.impact;
    const w = k * 0.13 * Math.sin(t * 38);
    // A chip makes the hull flinch inward a touch (smoothly, with the flash).
    const j = 1 - flash * 0.035;
    b.scale.set((1 + w) * j, (1 - w * 0.8) * j, (1 + w) * j);
    // 0 above lowIce, rising to 1 near empty; the pulse only ever brightens toward a paler tint.
    const low = 1 - smoothstep(ICEBERG_VISUAL.lowIce * 0.2, ICEBERG_VISUAL.lowIce, ice.ice);
    const pulse = low * (0.5 + 0.5 * Math.sin(t * ICEBERG_VISUAL.lowIcePulse * Math.PI * 2));
    material.emissive.lerpColors(glow.base, glow.pale, pulse * 0.6).lerp(glow.white, flash * 0.45);
    material.emissiveIntensity = ICEBERG_VISUAL.glow * (1 + k * 1.2 + pulse * 0.35 + flash * 1.4);
    rimMaterial.opacity = ICEBERG_VISUAL.rimOpacity * (1 + pulse * 0.6 + flash * 0.8);
    if (light.current) {
      const ls = Math.min(scale, 2.2);
      const boost = 1 + k * 0.8 + flash * 0.5;
      light.current.intensity = ICEBERG_VISUAL.lightIntensity * boost * (0.6 + 0.4 * ls);
      light.current.distance = ICEBERG_VISUAL.lightDistance * (0.7 + 0.3 * ls);
    }
  });

  return (
    <group ref={outer} rotation={[0, 0, 0, 'YXZ']}>
      <group ref={body}>
        <mesh geometry={geometry} material={material} customDepthMaterial={depthMaterial} castShadow />
        <mesh geometry={geometry} material={rimMaterial} scale={ICEBERG_VISUAL.rimScale} renderOrder={1} />
      </group>
      <pointLight
        ref={light}
        color={ICEBERG_VISUAL.lightColor}
        intensity={ICEBERG_VISUAL.lightIntensity}
        distance={ICEBERG_VISUAL.lightDistance}
        decay={2}
        position={[0, 1.8, 0]}
      />
    </group>
  );
}
