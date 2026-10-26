import { Vector3, Vector4 } from 'three';
import type { LevelDef, Terrain } from '../../core/types';

/**
 * Gerstner sea waves shared by the ocean surface and the river's ocean plume. Both materials
 * compute the same frame from the level, so the plume rides exactly the same swell as the sea.
 */

/** Half-size of the high-resolution ocean grid centred on the coast (m). */
export const OCEAN_INNER_HALF = 768;
/** Radius of the low-resolution outer ring that runs out to the fog (m). */
export const OCEAN_OUTER_RADIUS = 6000;
/** Waves fade to flat over this distance inside the inner grid's edge, so the ring meets it seamlessly. */
export const OCEAN_WAVE_FADE = 220;

export interface OceanWave {
  /** Unit horizontal travel direction (toward the shore). */
  dirX: number;
  dirZ: number;
  wavelength: number;
  /** Vertical amplitude (m). */
  amplitude: number;
  /** 0..1 horizontal (crest-sharpening) factor. */
  steepness: number;
}

export interface OceanFrame {
  centerX: number;
  centerZ: number;
  seaLevel: number;
  half: number;
  fade: number;
  /** Unit direction from the coast out to the open sea. */
  seaDirX: number;
  seaDirZ: number;
  waves: readonly OceanWave[];
}

/** Ocean placement and swell for a level: centred where the course meets the sea. */
export function computeOceanFrame(level: LevelDef, terrain: Terrain): OceanFrame {
  const c = terrain.course.sampleAt(Math.min(level.coastS, terrain.course.length));
  const len = Math.hypot(c.dirX, c.dirZ) || 1;
  const sx = c.dirX / len;
  const sz = c.dirZ / len;
  // Swell rolls in toward the shore, i.e. against the course direction, from a few angles.
  const wave = (angle: number, wavelength: number, amplitude: number, steepness: number): OceanWave => {
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    return { dirX: -(sx * ca - sz * sa), dirZ: -(sx * sa + sz * ca), wavelength, amplitude, steepness };
  };
  return {
    centerX: c.x,
    centerZ: c.z,
    seaLevel: level.seaLevel,
    half: OCEAN_INNER_HALF,
    fade: OCEAN_WAVE_FADE,
    seaDirX: sx,
    seaDirZ: sz,
    // total amplitude 0.34 m
    waves: [wave(-0.35, 31, 0.15, 0.6), wave(0.25, 47, 0.11, 0.5), wave(0.6, 71, 0.08, 0.4)],
  };
}

export interface OceanWaveUniforms {
  uWaveA: { value: Vector4 };
  uWaveB: { value: Vector4 };
  uWaveC: { value: Vector4 };
  uWaveAmp: { value: Vector3 };
  uOceanBox: { value: Vector4 };
  [name: string]: { value: unknown };
}

const packWave = (w: OceanWave | undefined): Vector4 =>
  w ? new Vector4(w.dirX, w.dirZ, (2 * Math.PI) / w.wavelength, w.steepness) : new Vector4(1, 0, 1, 0);

export function createOceanWaveUniforms(frame: OceanFrame): OceanWaveUniforms {
  const [a, b, c] = frame.waves;
  return {
    uWaveA: { value: packWave(a) },
    uWaveB: { value: packWave(b) },
    uWaveC: { value: packWave(c) },
    uWaveAmp: { value: new Vector3(a?.amplitude ?? 0, b?.amplitude ?? 0, c?.amplitude ?? 0) },
    uOceanBox: { value: new Vector4(frame.centerX, frame.centerZ, frame.half, frame.fade) },
  };
}

/** GLSL: `vec3 oceanDisplace(vec2 worldXZ, float time, out vec3 normal)` + its uniforms. */
export const OCEAN_WAVES_GLSL = /* glsl */ `
uniform vec4 uWaveA;
uniform vec4 uWaveB;
uniform vec4 uWaveC;
uniform vec3 uWaveAmp;
uniform vec4 uOceanBox;

void gerstnerWave(vec4 w, float amp, vec2 p, float t, inout vec3 disp, inout vec3 tg, inout vec3 bn) {
  vec2 d = w.xy;
  float k = w.z;
  float qa = w.w * amp;
  float f = k * (dot(d, p) - sqrt(9.81 / k) * t);
  float sf = sin(f);
  float cf = cos(f);
  disp += vec3(d.x * qa * cf, amp * sf, d.y * qa * cf);
  float ka = k * amp;
  float kqa = k * qa;
  tg += vec3(-d.x * d.x * kqa * sf, d.x * ka * cf, -d.x * d.y * kqa * sf);
  bn += vec3(-d.x * d.y * kqa * sf, d.y * ka * cf, -d.y * d.y * kqa * sf);
}

float oceanWaveFade(vec2 p) {
  vec2 o = abs(p - uOceanBox.xy);
  return 1.0 - smoothstep(uOceanBox.z - uOceanBox.w, uOceanBox.z, max(o.x, o.y));
}

vec3 oceanDisplace(vec2 p, float t, out vec3 nrm) {
  float fade = oceanWaveFade(p);
  vec3 disp = vec3(0.0);
  vec3 tg = vec3(1.0, 0.0, 0.0);
  vec3 bn = vec3(0.0, 0.0, 1.0);
  gerstnerWave(uWaveA, uWaveAmp.x * fade, p, t, disp, tg, bn);
  gerstnerWave(uWaveB, uWaveAmp.y * fade, p, t, disp, tg, bn);
  gerstnerWave(uWaveC, uWaveAmp.z * fade, p, t, disp, tg, bn);
  nrm = normalize(cross(bn, tg));
  return disp;
}
`;

/** Shared value-noise helpers (prefixed to avoid clashing with three's <common> chunk). */
export const NOISE_GLSL = /* glsl */ `
float wHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float wNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = wHash(i);
  float b = wHash(i + vec2(1.0, 0.0));
  float c = wHash(i + vec2(0.0, 1.0));
  float d = wHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float wFbm(vec2 p) {
  return 0.55 * wNoise(p) + 0.3 * wNoise(p * 2.03 + 17.1) + 0.15 * wNoise(p * 4.07 + 41.7);
}

// Bump a normal by a scalar height field using screen-space derivatives (Mikkelsen 2010).
vec3 wPerturbNormal(vec3 n, vec3 pos, float h) {
  vec3 dpdx = dFdx(pos);
  vec3 dpdy = dFdy(pos);
  float dhdx = dFdx(h);
  float dhdy = dFdy(h);
  vec3 r1 = cross(dpdy, n);
  vec3 r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
  // A pixel seeing a sheet edge-on can leave nothing to normalise: keep the surface normal then
  // rather than shading from a NaN (a black speck).
  vec3 r = abs(det) * n - grad;
  float l2 = dot(r, r);
  return l2 > 1e-30 ? r * inversesqrt(l2) : n;
}
`;
