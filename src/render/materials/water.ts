import { Color, DoubleSide, ShaderMaterial, UniformsLib, UniformsUtils, Vector2, Vector3 } from 'three';
import type { IUniform } from 'three';
import {
  NOISE_GLSL,
  OCEAN_WAVES_GLSL,
  createOceanWaveUniforms,
  type OceanFrame,
  type OceanWaveUniforms,
} from './oceanWaves';

/**
 * The river water material. Geometry comes from src/core/river/geometry.ts; custom attributes:
 * aFlow, aTurb, aFall, aOcean, aBirth (floats) and aLateral (vec2), plus the standard
 * position / normal / uv (u across 0..1, v = trail metres, increasing downstream).
 *
 * Two variants share one uniforms object: 'river' (opaque) and 'plume' (alpha-blended, used for
 * chunks that contain ocean samples so the plume can fade into the sea).
 */

export const RIVER_PALETTE = {
  deep: '#1450E6',
  mid: '#2C7DFF',
  cyan: '#5FF3FF',
  foam: '#FFFFFF',
  foamShade: '#B4ECFF',
  plume: '#3A8DFF',
  sky: '#CDEFFF',
  sun: '#FFF6E0',
} as const;

export interface WaterUniforms extends OceanWaveUniforms {
  uTime: { value: number };
  /** Trail length at the newest sample (lead = uHeadS − v). */
  uHeadS: { value: number };
  /** Trail s at its first sample (the glacier meltwater starts below 0): the start tapers in from it. */
  uStartS: { value: number };
  /** Trail s where the river entered the sea (< 0 if it has not). */
  uCoastS: { value: number };
  uSeaLevel: { value: number };
  /** Ocean plume fades between these distances past the coast (m). */
  uPlumeFade: { value: Vector2 };
  uDeep: { value: Color };
  uMid: { value: Color };
  uCyan: { value: Color };
  uFoam: { value: Color };
  uFoamShade: { value: Color };
  uPlume: { value: Color };
  uSky: { value: Color };
  uSunDir: { value: Vector3 };
  uSunColor: { value: Color };
}

export function createWaterUniforms(frame: OceanFrame): WaterUniforms {
  const fog = UniformsUtils.clone(UniformsLib.fog) as Record<string, IUniform>;
  return {
    ...fog,
    ...createOceanWaveUniforms(frame),
    uTime: { value: 0 },
    uHeadS: { value: 0 },
    uStartS: { value: 0 },
    uCoastS: { value: -1 },
    uSeaLevel: { value: frame.seaLevel },
    uPlumeFade: { value: new Vector2(25, 170) },
    uDeep: { value: new Color(RIVER_PALETTE.deep) },
    uMid: { value: new Color(RIVER_PALETTE.mid) },
    uCyan: { value: new Color(RIVER_PALETTE.cyan) },
    uFoam: { value: new Color(RIVER_PALETTE.foam) },
    uFoamShade: { value: new Color(RIVER_PALETTE.foamShade) },
    uPlume: { value: new Color(RIVER_PALETTE.plume) },
    uSky: { value: new Color(RIVER_PALETTE.sky) },
    uSunDir: { value: new Vector3(0.35, 0.85, 0.4).normalize() },
    uSunColor: { value: new Color(RIVER_PALETTE.sun) },
  };
}

const WATER_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>

attribute float aFlow;
attribute float aTurb;
attribute float aFall;
attribute float aOcean;
attribute float aBirth;
attribute vec2 aLateral;

uniform float uTime;
uniform float uSeaLevel;
uniform float uStartS;

${OCEAN_WAVES_GLSL}

varying vec2 vUv;
varying float vFlow;
varying float vTurb;
varying float vFall;
varying float vOcean;
varying float vAge;
varying float vAcross;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vBorn;

float flowWave(float across, float phase) {
  return sin(phase * 1.3 + across * 0.9) * 0.55
    + sin(phase * 2.9 - across * 2.1 + 1.7) * 0.3
    + sin(phase * 0.55 + across * 0.35 + 4.1) * 0.15;
}

void main() {
  // Water laid ahead of time (the glacier meltwater, revealed behind the calving iceberg) is not
  // there until it is born: no width, and the fragments are dropped.
  float born = step(aBirth, uTime);
  // Fresh water spreads out from the iceberg; the very start of the trail tapers in.
  float age = max(uTime - aBirth, 0.0);
  float spread = mix(0.45, 1.0, smoothstep(0.0, 0.6, age))
    * mix(0.35, 1.0, smoothstep(uStartS, uStartS + 4.0, uv.y));
  spread *= born;
  vBorn = born;
  vec3 p = position;
  p.xz -= aLateral * (1.0 - spread);
  float across = length(aLateral) * sign(uv.x - 0.5);

  // Two-phase flow advection: crests travel downstream (toward larger v) at aFlow without the
  // phase drifting apart between samples that flow at different speeds.
  const float T = 1.6;
  float ph0 = fract(uTime / T);
  float ph1 = fract(uTime / T + 0.5);
  float w0 = 1.0 - abs(2.0 * ph0 - 1.0);
  float wave = mix(
    flowWave(across, uv.y + 7.3 - aFlow * ph1 * T),
    flowWave(across, uv.y - aFlow * ph0 * T),
    w0
  );
  float bank = 1.0 - 0.7 * pow(abs(uv.x - 0.5) * 2.0, 3.0);
  float amp = (0.035 + 0.09 * aTurb * aTurb + 0.14 * aFall) * bank;
  p += normal * (wave * amp);

  vec3 n = normal;
  if (aOcean > 0.001) {
    // The plume rides the same swell as the sea surface.
    float m = aOcean * (1.0 - smoothstep(0.15, 0.6, p.y - uSeaLevel));
    vec3 on;
    vec3 d = oceanDisplace(position.xz, uTime, on);
    p += d * m;
    p.y += 0.05 * m;
    n = normalize(mix(n, on, m));
  }

  vec4 worldPos = modelMatrix * vec4(p, 1.0);
  vWorldPos = worldPos.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * n);
  vUv = uv;
  vFlow = aFlow;
  vTurb = aTurb;
  vFall = aFall;
  vOcean = aOcean;
  vAge = age;
  vAcross = across;
  vec4 mvPosition = viewMatrix * worldPos;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const WATER_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>

uniform float uTime;
uniform float uHeadS;
uniform float uCoastS;
uniform vec2 uPlumeFade;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uCyan;
uniform vec3 uFoam;
uniform vec3 uFoamShade;
uniform vec3 uPlume;
uniform vec3 uSky;
uniform vec3 uSunDir;
uniform vec3 uSunColor;

varying vec2 vUv;
varying float vFlow;
varying float vTurb;
varying float vFall;
varying float vOcean;
varying float vAge;
varying float vAcross;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vBorn;

${NOISE_GLSL}

void main() {
  #include <logdepthbuf_fragment>
  if (vBorn < 0.5) discard;
  float v = vUv.y;
  float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float flow = max(vFlow, 0.5);

  // Flow-advected noise moving downstream at the per-vertex flow speed (two blended phases).
  const float T = 1.0;
  float ph0 = fract(uTime / T);
  float ph1 = fract(uTime / T + 0.5);
  float w0 = 1.0 - abs(2.0 * ph0 - 1.0);
  // Rotated domain so value-noise contours do not line up into square cells.
  const mat2 ROT = mat2(0.8, -0.6, 0.6, 0.8);
  vec2 q0 = vec2(vAcross, v - flow * ph0 * T);
  vec2 q1 = vec2(vAcross + 3.7, v + 11.3 - flow * ph1 * T);
  vec2 sc = vec2(0.75, 0.28);
  float n = mix(wFbm(ROT * (q1 * sc)), wFbm(ROT * (q0 * sc)), w0);
  float rf = mix(wFbm(ROT * (q1 * vec2(1.5, 0.6)) + 5.0), wFbm(ROT * (q0 * vec2(1.5, 0.6)) + 5.0), w0);
  float fn = mix(wFbm(ROT * (q1 * vec2(1.6, 0.7)) + 9.0), wFbm(ROT * (q0 * vec2(1.6, 0.7)) + 9.0), w0);
  // waterfall streaks: long and thin, rushing down the sheet
  float streak = 0.0;
  if (vFall > 0.01) {
    vec2 s0 = vec2(q0.x * 2.4, q0.y * 0.08);
    vec2 s1 = vec2(q1.x * 2.4, q1.y * 0.08);
    streak = mix(
      0.65 * wNoise(s1) + 0.35 * wNoise(s1 * 2.1 + 3.3),
      0.65 * wNoise(s0) + 0.35 * wNoise(s0 * 2.1 + 3.3),
      w0
    );
  }

  // Fine detail fades out with distance so far-off water does not shimmer.
  float dist = length(cameraPosition - vWorldPos);
  float detail = 1.0 - smoothstep(35.0, 170.0, dist);
  n = mix(0.5, n, 0.35 + 0.65 * detail);
  rf = mix(0.5, rf, detail);
  fn = mix(0.5, fn, detail);

  // (interpolated normals can cancel out where a sheet bends sharply: never normalise zero)
  float nl2 = dot(vWorldNormal, vWorldNormal);
  vec3 N = nl2 > 1e-12 ? vWorldNormal * inversesqrt(nl2) : vec3(0.0, 1.0, 0.0);
  N = gl_FrontFacing ? N : -N;
  N = wPerturbNormal(N, vWorldPos, (n * (0.3 + 0.6 * vTurb + 0.4 * vFall) + rf * 0.15) * detail);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uSunDir);

  // base: deep electric blue, mid-blue swirls, cyan highlights and thin bright ripple ridges
  vec3 col = mix(uDeep, uMid, clamp(smoothstep(0.35, 0.8, n) * 0.7 + (1.0 - edge) * 0.25, 0.0, 1.0));
  // thresholds widened by fwidth so thin features fade instead of aliasing into sparkles
  float hlv = n + rf * 0.2;
  float hl = smoothstep(0.6 - fwidth(hlv), 0.84 + fwidth(hlv), hlv);
  float rv = 1.0 - abs(rf - 0.5) * 2.0;
  float rw = fwidth(rv);
  float ridge = smoothstep(0.9 - rw, 0.98 + rw, rv) * detail * (1.0 - smoothstep(0.04, 0.12, rw));
  col = mix(col, uCyan, clamp(hl * 0.75 + ridge * 0.5, 0.0, 1.0));
  col = mix(col, uPlume, vOcean * 0.55);
  // falls: a brighter blue-cyan sheet under the streaks
  col = mix(col, mix(uDeep, uCyan, 0.3 + 0.45 * streak), vFall * 0.85);

  // foam: banks, turbulence (bends, collisions, plunge pools), falls, the leading edge
  float lead = max(uHeadS - v, 0.0);
  float drive = (1.0 - smoothstep(0.0, 0.28, edge)) * 0.9 * (1.0 - vOcean * 0.6);
  drive += vTurb * 0.85 * (1.0 - 0.8 * vFall);
  drive += (1.0 - smoothstep(0.0, 8.0, lead)) * 0.8;
  drive += (1.0 - smoothstep(0.0, 0.8, vAge)) * 0.5;
  float fw = fwidth(fn);
  float foam = smoothstep(1.0 - drive * 0.8 - fw, 1.12 - drive * 0.8 + fw, fn);
  float sw = fwidth(streak);
  foam = max(foam, vFall * smoothstep(0.5 - sw, 0.74 + sw, streak));
  vec3 foamCol = mix(uFoamShade, uFoam, smoothstep(0.3, 0.8, fn));
  col = mix(col, foamCol, foam);

  // light: soft sun term, fresnel sky sheen, sharp glint, a little self-glow for bloom
  float ndl = max(dot(N, L), 0.0);
  col *= 0.72 + 0.38 * ndl;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  col = mix(col, uSky, fres * 0.4 * (1.0 - foam) * (1.0 - 0.7 * vFall));
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 220.0) * (1.0 - foam) * (0.15 + 0.85 * detail);
  col += uSunColor * spec * 2.2;
  col += uCyan * hl * 0.22 + foam * 0.12;

  float alpha = 1.0;
  #ifdef PLUME
    float od = uCoastS >= 0.0 ? max(v - uCoastS, 0.0) : 0.0;
    float fade = 1.0 - smoothstep(uPlumeFade.x, uPlumeFade.y, od);
    float soft = smoothstep(0.0, 0.45, edge + foam * 0.3);
    alpha = mix(1.0, fade * soft * 0.9, vOcean);
  #endif

  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export type WaterVariant = 'river' | 'plume';

/** One of the two river materials. Pass the same `uniforms` object to both variants. */
export function createWaterMaterial(uniforms: WaterUniforms, variant: WaterVariant): ShaderMaterial {
  const plume = variant === 'plume';
  const mat = new ShaderMaterial({
    name: plume ? 'RiverPlume' : 'RiverWater',
    uniforms,
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    defines: plume ? { PLUME: '' } : {},
    fog: true,
    side: DoubleSide,
    transparent: plume,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: plume ? -2 : -1,
    polygonOffsetUnits: plume ? -4 : -2,
  });
  return mat;
}

/** Exposed for tests and debugging. */
export const WATER_SHADERS = { vertex: WATER_VERTEX, fragment: WATER_FRAGMENT } as const;
