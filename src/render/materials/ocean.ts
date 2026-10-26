import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  FrontSide,
  LinearFilter,
  RedFormat,
  ShaderMaterial,
  Sphere,
  UniformsLib,
  UniformsUtils,
  UnsignedByteType,
  Vector3,
  Vector4,
} from 'three';
import type { IUniform } from 'three';
import type { HeightGrid } from '../../core/types';
import {
  NOISE_GLSL,
  OCEAN_INNER_HALF,
  OCEAN_OUTER_RADIUS,
  OCEAN_WAVES_GLSL,
  createOceanWaveUniforms,
  type OceanFrame,
  type OceanWaveUniforms,
} from './oceanWaves';

export const OCEAN_PALETTE = {
  deep: '#0B3A8C',
  mid: '#1677D2',
  shallow: '#3FE6D6',
  foam: '#F4FFFF',
  sky: '#CDEFFF',
  sun: '#FFF6E0',
} as const;

/** Depths (m) the 8-bit depth texture can represent; deeper water saturates. */
export const OCEAN_DEPTH_RANGE = 24;

// ---------------------------------------------------------------------------------------------
// Geometry: a fine square grid around the coast plus a coarse ring out to the horizon. The ring's
// inner edge reuses the grid's boundary vertices exactly, so the surface is watertight.
// ---------------------------------------------------------------------------------------------

export function createOceanGeometry(
  half = OCEAN_INNER_HALF,
  segments = 320,
  outerRadius = OCEAN_OUTER_RADIUS,
): BufferGeometry {
  const row = segments + 1;
  const gridVerts = row * row;
  const loop = 4 * segments;
  const radii = [
    Math.max(half * 2.1, outerRadius * 0.27),
    Math.max(half * 3.9, outerRadius * 0.5),
    outerRadius,
  ];
  const total = gridVerts + loop * radii.length;
  const pos = new Float32Array(total * 3);
  const coord = (i: number): number => -half + 2 * half * (i / segments);
  for (let iz = 0; iz < row; iz++) {
    for (let ix = 0; ix < row; ix++) {
      const v = (iz * row + ix) * 3;
      pos[v] = coord(ix);
      pos[v + 2] = coord(iz);
    }
  }
  // boundary loop as grid vertex indices: bottom (+x), right (+z), top (−x), left (−z)
  const boundary = new Uint32Array(loop);
  let b = 0;
  for (let ix = 0; ix < segments; ix++) boundary[b++] = ix;
  for (let iz = 0; iz < segments; iz++) boundary[b++] = iz * row + segments;
  for (let ix = segments; ix > 0; ix--) boundary[b++] = segments * row + ix;
  for (let iz = segments; iz > 0; iz--) boundary[b++] = iz * row;
  for (let l = 0; l < radii.length; l++) {
    for (let j = 0; j < loop; j++) {
      const g = boundary[j] * 3;
      const x = pos[g];
      const z = pos[g + 2];
      const len = Math.hypot(x, z);
      const v = (gridVerts + l * loop + j) * 3;
      pos[v] = (x / len) * radii[l];
      pos[v + 2] = (z / len) * radii[l];
    }
  }

  const triCount = segments * segments * 2 + loop * radii.length * 2;
  const index = new Uint32Array(triCount * 3);
  let w = 0;
  for (let iz = 0; iz < segments; iz++) {
    for (let ix = 0; ix < segments; ix++) {
      const a = iz * row + ix;
      const bb = a + 1;
      const c = a + row;
      const d = c + 1;
      index[w++] = a;
      index[w++] = c;
      index[w++] = bb;
      index[w++] = bb;
      index[w++] = c;
      index[w++] = d;
    }
  }
  for (let l = 0; l < radii.length; l++) {
    for (let j = 0; j < loop; j++) {
      const j1 = (j + 1) % loop;
      const i0 = l === 0 ? boundary[j] : gridVerts + (l - 1) * loop + j;
      const i1 = l === 0 ? boundary[j1] : gridVerts + (l - 1) * loop + j1;
      const o0 = gridVerts + l * loop + j;
      const o1 = gridVerts + l * loop + j1;
      index[w++] = i0;
      index[w++] = i1;
      index[w++] = o0;
      index[w++] = i1;
      index[w++] = o1;
      index[w++] = o0;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setIndex(new BufferAttribute(index, 1));
  geo.boundingSphere = new Sphere(new Vector3(0, 0, 0), outerRadius + 1);
  return geo;
}

// ---------------------------------------------------------------------------------------------
// Depth texture: seaLevel − terrain height at each grid vertex (texel centres = grid vertices).
// ---------------------------------------------------------------------------------------------

export interface OceanDepthTexture {
  texture: DataTexture;
  /** uv = (worldXZ − xform.xy) · xform.zw */
  xform: Vector4;
}

const MAX_TEX = 4096;

export function createOceanDepthTexture(grid: HeightGrid, seaLevel: number): OceanDepthTexture {
  const stride = Math.max(1, Math.ceil(Math.max(grid.cols, grid.rows) / MAX_TEX));
  const w = Math.ceil(grid.cols / stride);
  const h = Math.ceil(grid.rows / stride);
  const data = new Uint8Array(w * h);
  for (let tz = 0; tz < h; tz++) {
    const iz = Math.min(grid.rows - 1, tz * stride);
    for (let tx = 0; tx < w; tx++) {
      const ix = Math.min(grid.cols - 1, tx * stride);
      const depth = seaLevel - grid.heights[iz * grid.cols + ix];
      data[tz * w + tx] = Math.round(Math.min(1, Math.max(0, depth / OCEAN_DEPTH_RANGE)) * 255);
    }
  }
  const texture = new DataTexture(data, w, h, RedFormat, UnsignedByteType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.flipY = false;
  texture.needsUpdate = true;
  const texel = grid.cellSize * stride;
  const xform = new Vector4(
    grid.originX - 0.5 * texel,
    grid.originZ - 0.5 * texel,
    1 / (w * texel),
    1 / (h * texel),
  );
  return { texture, xform };
}

// ---------------------------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------------------------

export interface OceanUniforms extends OceanWaveUniforms {
  uTime: { value: number };
  uDepthTex: { value: DataTexture };
  uDepthXform: { value: Vector4 };
  uDepthRange: { value: number };
  uDeep: { value: Color };
  uMid: { value: Color };
  uShallow: { value: Color };
  uFoam: { value: Color };
  uSky: { value: Color };
  uSunDir: { value: Vector3 };
  uSunColor: { value: Color };
}

export function createOceanUniforms(frame: OceanFrame, depth: OceanDepthTexture): OceanUniforms {
  const fog = UniformsUtils.clone(UniformsLib.fog) as Record<string, IUniform>;
  return {
    ...fog,
    ...createOceanWaveUniforms(frame),
    uTime: { value: 0 },
    uDepthTex: { value: depth.texture },
    uDepthXform: { value: depth.xform },
    uDepthRange: { value: OCEAN_DEPTH_RANGE },
    uDeep: { value: new Color(OCEAN_PALETTE.deep) },
    uMid: { value: new Color(OCEAN_PALETTE.mid) },
    uShallow: { value: new Color(OCEAN_PALETTE.shallow) },
    uFoam: { value: new Color(OCEAN_PALETTE.foam) },
    uSky: { value: new Color(OCEAN_PALETTE.sky) },
    uSunDir: { value: new Vector3(0.35, 0.85, 0.4).normalize() },
    uSunColor: { value: new Color(OCEAN_PALETTE.sun) },
  };
}

const OCEAN_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>

uniform float uTime;

${OCEAN_WAVES_GLSL}

varying vec3 vWorldPos;
varying vec3 vWaveNormal;
varying float vWaveY;
varying vec2 vBaseXZ;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vec3 n;
  vec3 d = oceanDisplace(worldPos.xz, uTime, n);
  vBaseXZ = worldPos.xz;
  worldPos.xyz += d;
  vWaveY = d.y;
  vWorldPos = worldPos.xyz;
  vWaveNormal = n;
  vec4 mvPosition = viewMatrix * worldPos;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const OCEAN_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>

uniform float uTime;
uniform sampler2D uDepthTex;
uniform vec4 uDepthXform;
uniform float uDepthRange;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uSky;
uniform vec3 uSunDir;
uniform vec3 uSunColor;

varying vec3 vWorldPos;
varying vec3 vWaveNormal;
varying float vWaveY;
varying vec2 vBaseXZ;

${NOISE_GLSL}

float depthAt(vec2 xz) {
  vec2 uv = (xz - uDepthXform.xy) * uDepthXform.zw;
  // beyond the terrain is open sea
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return uDepthRange * 2.0;
  // The seabed inside the terrain only reaches ~14 m, so shelve it down toward open-sea depth near the
  // texture border; otherwise the terrain's rectangle shows as a lighter patch from high cameras.
  float edge = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y));
  float d = texture2D(uDepthTex, uv).r * uDepthRange;
  // The terrain's flat seabed (~14 m) reads as open sea; only the coastal shelf keeps its gradient.
  d = mix(d, uDepthRange * 2.0, smoothstep(9.0, 13.5, d));
  return mix(uDepthRange * 2.0, d, smoothstep(0.0, 0.08, edge));
}

void main() {
  #include <logdepthbuf_fragment>
  float depth = depthAt(vBaseXZ);
  float camDist = length(cameraPosition - vWorldPos);
  float detail = 1.0 - smoothstep(150.0, 900.0, camDist);

  // small wind ripples drifting in two directions, faded with distance to avoid shimmer
  vec2 p = vWorldPos.xz;
  float rip = wFbm(p * 0.21 + vec2(uTime * 0.35, uTime * 0.12))
    + 0.6 * wNoise(p * 0.55 - vec2(uTime * 0.25, -uTime * 0.4));
  vec3 N = normalize(vWaveNormal);
  N = wPerturbNormal(N, vWorldPos, rip * 0.22 * detail);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uSunDir);

  vec3 col = mix(uShallow, uMid, smoothstep(0.4, 6.0, depth));
  col = mix(col, uDeep, smoothstep(5.0, 20.0, depth));
  col = mix(col, col * 1.25, smoothstep(0.1, 0.3, vWaveY) * 0.5);

  // shoreline foam band plus lapping lines rolling in toward the beach
  float wet = depth + vWaveY * 0.8;
  float fnz = wFbm(p * 0.35 + uTime * 0.1);
  float band = 1.0 - smoothstep(0.0, 0.9, wet + (fnz - 0.5) * 0.7);
  float lines = smoothstep(0.82, 0.97, sin(depth * 2.4 - uTime * 1.3 + fnz * 3.0) * 0.5 + 0.5);
  lines *= 1.0 - smoothstep(0.6, 3.2, depth);
  float foam = clamp(band + lines * 0.65, 0.0, 1.0) * step(0.0, depth + 0.6);
  col = mix(col, uFoam, foam);

  float ndl = max(dot(N, L), 0.0);
  col *= 0.78 + 0.32 * ndl;
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  col = mix(col, uSky, fres * 0.55 * (1.0 - foam));
  vec3 H = normalize(L + V);
  float nh = max(dot(N, H), 0.0);
  // Narrow lobes only: from the high view-the-river orbit, broad ones washed a third of the sea white.
  float glint = pow(nh, 320.0) * 2.4 + pow(nh, 90.0) * 0.06;
  float sparkle = step(0.985, wNoise(p * 1.7 + uTime * 0.6)) * pow(nh, 72.0) * detail;
  col += uSunColor * (glint + sparkle * 1.5) * (1.0 - foam);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function createOceanMaterial(uniforms: OceanUniforms): ShaderMaterial {
  return new ShaderMaterial({
    name: 'Ocean',
    uniforms,
    vertexShader: OCEAN_VERTEX,
    fragmentShader: OCEAN_FRAGMENT,
    fog: true,
    side: FrontSide,
  });
}

export const OCEAN_SHADERS = { vertex: OCEAN_VERTEX, fragment: OCEAN_FRAGMENT } as const;
