/**
 * Story Mode's world condition (src/story/environment.ts) applied to the view: colours, fog and
 * material tints only. Nothing here touches geometry, physics bodies or the session, and with no
 * condition (Arcade, or `?world=off`) every function returns its input unchanged and no material
 * is patched, so Arcade renders exactly as before.
 *
 * - Sky and light: the fog closes in and turns grey-brown, the zenith and the clouds dull, the sun
 *   dims and warms, the ground bounce browns with the grass (conditionSkyLook, conditionLightingLook).
 * - Water: the river, streams and lakes blend toward murky olive-brown, the sea near the coast half as
 *   far (conditionWaterColours, conditionOceanColours): uniform colours, no shader change.
 * - Ground and plants: the terrain, the far backdrop, bushes and grass tufts get a small vertex-shader
 *   step that dries vegetation-coloured vertices to straw, then brown, in large patches; scenery trees
 *   also yellow, and a share of them stand dead (rust brown or bare grey crowns, trunks unchanged);
 *   snow dulls with soot (patchVegetation). Obstacle trees get the same look from their instance
 *   colours (obstacleTreeTint).
 */
import { createContext, useContext } from 'react';
import { Color, SRGBColorSpace, type MeshStandardMaterial, type WebGLProgramParametersWithUniforms } from 'three';
import { isTreeKind } from '../core/obstacles/catalog';
import { hash2 } from '../core/rng';
import type { ObstacleKind } from '../core/types';
import { isHealthy, WORLD_PALETTE as P, type WorldCondition } from '../story/environment';
import type { LightingLook } from './Lighting';
import type { SkyLook } from './Sky';

/** The world condition of the view (null = none: Arcade, or a healthy chapter). */
export const WorldConditionContext = createContext<WorldCondition | null>(null);

export function useWorldCondition(): WorldCondition | null {
  return useContext(WorldConditionContext);
}

/** A condition that changes something visible (a healthy one is treated as none). */
export function activeCondition(c: WorldCondition | null | undefined): c is WorldCondition {
  return c !== null && c !== undefined && !isHealthy(c);
}

const clamp01 = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 1 : v);
const _a = new Color();
const _b = new Color();

/** `a` blended toward `b` by t (in linear light), as an upper-case sRGB hex. */
export function mixHex(a: string, b: string, t: number): string {
  return `#${_a.set(a).lerp(_b.set(b), clamp01(t)).getHexString().toUpperCase()}`;
}

/** The level's sky in this world: hazier, browner fog that closes in, duller zenith and clouds. */
export function conditionSkyLook(look: SkyLook, c: WorldCondition | null): SkyLook {
  if (!activeCondition(c)) return look;
  const h = c.air.haze;
  return {
    ...look,
    top: mixHex(look.top, P.smogTop, 0.45 * h),
    horizon: mixHex(look.horizon, P.smogHorizon, 0.5 * h),
    fog: mixHex(look.fog, P.smog, 0.6 * h),
    sun: mixHex(look.sun, P.hazeSun, 0.4 * h),
    fogNear: look.fogNear * (1 - 0.3 * h),
    fogFar: look.fogFar * (1 - 0.32 * h),
    cloudColor: mixHex(look.cloudColor, P.hazeCloud, 0.6 * h),
    cloudEmissive: mixHex(look.cloudEmissive, P.hazeCloudGlow, 0.6 * h),
    viewHaze: Math.min(0.45, look.viewHaze + 0.12 * h),
  };
}

/** The level's light in this world: a dimmer, warmer sun through the haze, a browner ground bounce. */
export function conditionLightingLook(look: LightingLook, c: WorldCondition | null): LightingLook {
  if (!activeCondition(c)) return look;
  const h = c.air.haze;
  const ground = c.grass.dry * c.grass.cover;
  return {
    ...look,
    sunColor: mixHex(look.sunColor, P.hazeSun, 0.35 * h),
    sunIntensity: look.sunIntensity * (1 - 0.16 * h),
    hemiSky: mixHex(look.hemiSky, P.hazeSkyFill, 0.45 * h),
    hemiGround: mixHex(look.hemiGround, P.dryBounce, 0.8 * ground),
    ambientColor: mixHex(look.ambientColor, P.hazeAmbient, 0.4 * h),
  };
}

type ColorUniform = { value: Color };

const _s = { r: 0, g: 0, b: 0 };
const _t = { r: 0, g: 0, b: 0 };
/**
 * `c` blended toward the sRGB hex `to` by t in sRGB (perceptual) space, in place. Linear-light mixing
 * keeps far too much of the river's saturated blue: 80 % of the way to brown still read as blue.
 */
function lerpSrgb(c: Color, to: string, t: number): void {
  c.getRGB(_s, SRGBColorSpace);
  _b.set(to).getRGB(_t, SRGBColorSpace);
  const k = clamp01(t);
  c.setRGB(_s.r + (_t.r - _s.r) * k, _s.g + (_t.g - _s.g) * k, _s.b + (_t.b - _s.b) * k, SRGBColorSpace);
}

/** The river material's colours (src/render/materials/water.ts; streams and lakes share them). */
export interface WaterColourUniforms {
  uDeep: ColorUniform;
  uMid: ColorUniform;
  uCyan: ColorUniform;
  uFoam: ColorUniform;
  uFoamShade: ColorUniform;
  uPlume: ColorUniform;
}

/** Murky river water: every colour blended toward olive-brown by the murk (in place). */
export function conditionWaterColours(u: WaterColourUniforms, c: WorldCondition | null): void {
  if (!activeCondition(c)) return;
  const m = c.water.murk;
  lerpSrgb(u.uDeep.value, P.murkDeep, m);
  lerpSrgb(u.uMid.value, P.murkMid, m);
  lerpSrgb(u.uCyan.value, P.murkLight, m);
  lerpSrgb(u.uPlume.value, P.murkPlume, m);
  lerpSrgb(u.uFoam.value, P.murkFoam, m);
  lerpSrgb(u.uFoamShade.value, P.murkFoamShade, m);
}

/** The sea's colours (src/render/materials/ocean.ts). */
export interface OceanColourUniforms {
  uDeep: ColorUniform;
  uMid: ColorUniform;
  uShallow: ColorUniform;
  uFoam: ColorUniform;
}

/** The sea takes half the river's murk (it is the river's water, diluted). In place. */
export function conditionOceanColours(u: OceanColourUniforms, c: WorldCondition | null): void {
  if (!activeCondition(c)) return;
  const m = 0.5 * c.water.murk;
  lerpSrgb(u.uDeep.value, P.seaDeep, m);
  lerpSrgb(u.uMid.value, P.seaMid, m);
  lerpSrgb(u.uShallow.value, P.seaShallow, m);
  lerpSrgb(u.uFoam.value, P.murkFoam, m);
}

/**
 * Which colours count as living plants, shared by the shader and its CPU mirror (plantAmount): hues
 * from olive (~46°) to blue-green (~165°, linear-light hue), saturated enough. Every theme's grass,
 * leaves, needles, bushes and tufts pass; sand, dirt, rock strata, trunks, roads, snow and the
 * seabed do not (src/render/worldCondition.test.ts checks each theme's palette).
 */
export const PLANT_HUE = { from: [40, 52], to: [160, 175] } as const;
export const PLANT_SATURATION = [0.42, 0.55] as const;
/** Dry patches are about 1 / PATCH_FREQUENCY metres across. */
export const PATCH_FREQUENCY = 1 / 45;
/**
 * Which ground dries as grass.cover rises: plant vertices dry where the patch noise (0..1) is above
 * a threshold that falls from `empty` (no cover) to `full` (all of it); from `dropFrom` on it falls
 * a further `drop`, so full cover leaves no green island where the noise happens to dip low.
 * `blend` is the half-width of a patch's soft edge. Shared by the shader and its CPU mirror
 * (coverAmount).
 */
export const COVER_THRESHOLD = {
  empty: 0.78,
  full: 0.08,
  dropFrom: 0.85,
  drop: 0.2,
  blend: 0.08,
} as const;
/**
 * A target colour takes the brightness of what it replaces (sqrt of the luma ratio) within these
 * limits, so mown stripes, patches and the per-face jitter survive; the top limit keeps bright
 * spring green from turning dry grass mustard.
 */
export const SHADE_RANGE = [0.7, 1.15] as const;

const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** CPU mirror of the shader's wcPlant(): 0..1, how much a linear-light colour reads as plants. */
export function plantAmount(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  if (d < 1e-5) return 0;
  const h = mx === r ? (60 * (g - b)) / d : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return (
    smooth(PLANT_HUE.from[0], PLANT_HUE.from[1], h) *
    (1 - smooth(PLANT_HUE.to[0], PLANT_HUE.to[1], h)) *
    smooth(PLANT_SATURATION[0], PLANT_SATURATION[1], d / mx)
  );
}

/**
 * CPU mirror of the shader's patch test: 0..1, how far a plant vertex whose patch noise is `noise`
 * (0..1) dries at this cover, before grass.dry and the small second noise scale it.
 */
export function coverAmount(cover: number, noise: number): number {
  const T = COVER_THRESHOLD;
  const c = clamp01(cover);
  const threshold = T.empty + (T.full - T.empty) * c - T.drop * smooth(T.dropFrom, 1, c);
  return smooth(threshold - T.blend, threshold + T.blend, noise) * smooth(0, 0.1, c);
}

const f = (v: number): string => v.toFixed(4);

/** Declarations (after three's <common>). */
export const WORLD_CONDITION_PARS = /* glsl */ `
uniform vec4 uWcGrass;
uniform vec2 uWcTrees;
uniform vec3 uWcStraw;
uniform vec3 uWcBrown;
uniform vec3 uWcRust;
uniform vec3 uWcGrey;
uniform vec3 uWcSoot;
float wcHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float wcNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 q = fract(p);
  vec2 u = q * q * (3.0 - 2.0 * q);
  return mix(mix(wcHash(i), wcHash(i + vec2(1.0, 0.0)), u.x),
    mix(wcHash(i + vec2(0.0, 1.0)), wcHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float wcLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float wcPlant(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float d = mx - min(c.r, min(c.g, c.b));
  if (d < 1e-5) return 0.0;
  float h = mx == c.r ? 60.0 * (c.g - c.b) / d
    : mx == c.g ? 60.0 * ((c.b - c.r) / d + 2.0) : 60.0 * ((c.r - c.g) / d + 4.0);
  return smoothstep(${f(PLANT_HUE.from[0])}, ${f(PLANT_HUE.from[1])}, h)
    * (1.0 - smoothstep(${f(PLANT_HUE.to[0])}, ${f(PLANT_HUE.to[1])}, h))
    * smoothstep(${f(PLANT_SATURATION[0])}, ${f(PLANT_SATURATION[1])}, d / mx);
}
vec3 wcShade(vec3 t, vec3 c) { return t * clamp(sqrt(wcLuma(c) / max(wcLuma(t), 1e-4)), ${f(SHADE_RANGE[0])}, ${f(SHADE_RANGE[1])}); }
`;

/**
 * The vertex step (after three's <color_vertex>, so vColor already holds the vertex and instance
 * colours). Per vertex, not per pixel: a few dozen ALU operations on geometry that is already there.
 */
export const WORLD_CONDITION_VERTEX = /* glsl */ `
{
  #ifdef USE_INSTANCING
    vec2 wcAt = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xz;
  #else
    vec2 wcAt = (modelMatrix * vec4(position, 1.0)).xz;
  #endif
  vec3 wcC = vColor.rgb;
  float wcN = 0.65 * wcNoise(wcAt * ${f(PATCH_FREQUENCY)}) + 0.35 * wcNoise(wcAt * ${f(PATCH_FREQUENCY * 2.7)} + 17.0);
  // COVER_THRESHOLD (coverAmount on the CPU): full cover leaves no green island where noise dips.
  float wcT = mix(${f(COVER_THRESHOLD.empty)}, ${f(COVER_THRESHOLD.full)}, uWcGrass.y)
    - ${f(COVER_THRESHOLD.drop)} * smoothstep(${f(COVER_THRESHOLD.dropFrom)}, 1.0, uWcGrass.y);
  float wcK = uWcGrass.x
    * smoothstep(wcT - ${f(COVER_THRESHOLD.blend)}, wcT + ${f(COVER_THRESHOLD.blend)}, wcN)
    * smoothstep(0.0, 0.1, uWcGrass.y);
  // A second, smaller noise: some ground drier and browner than the rest, never one flat colour.
  float wcV = wcNoise(wcAt * ${f(PATCH_FREQUENCY * 3.7)} + 41.0);
  wcK *= 0.88 + 0.12 * wcV;
  float wcBrown = clamp(uWcGrass.z + 0.7 * (wcV - 0.5), 0.0, 1.0) * step(1e-3, uWcGrass.z);
  #ifdef WC_TREES
    wcK = max(0.7 * wcK, uWcTrees.y * (0.35 + 0.65 * wcHash(wcAt * 1.37 + 2.1)));
  #endif
  float wcP = wcPlant(wcC);
  wcC = mix(wcC, wcShade(mix(uWcStraw, uWcBrown, wcBrown), wcC), wcP * wcK);
  #ifdef WC_TREES
    float wcDead = 1.0 - step(uWcTrees.x, wcHash(wcAt * 0.731 + 5.3));
    vec3 wcDeadC = mix(uWcRust, uWcGrey, step(0.5, wcHash(wcAt * 2.9 + 8.7)));
    wcC = mix(wcC, wcShade(wcDeadC, vColor.rgb), wcP * wcDead);
  #endif
  float wcMx = max(wcC.r, max(wcC.g, wcC.b));
  float wcSat = (wcMx - min(wcC.r, min(wcC.g, wcC.b))) / max(wcMx, 1e-4);
  float wcSnow = smoothstep(0.5, 0.7, wcLuma(wcC)) * (1.0 - smoothstep(0.12, 0.3, wcSat));
  wcC *= mix(vec3(1.0), uWcSoot, uWcGrass.w * wcSnow);
  vColor.rgb = wcC;
}
`;

/** 'ground': terrain, backdrop, bushes and tufts. 'trees': scenery trees (also yellowing and dead). */
export type VegetationRole = 'ground' | 'trees';

export interface WorldConditionUniforms {
  uWcGrass: { value: [number, number, number, number] };
  uWcTrees: { value: [number, number] };
  uWcStraw: ColorUniform;
  uWcBrown: ColorUniform;
  uWcRust: ColorUniform;
  uWcGrey: ColorUniform;
  uWcSoot: ColorUniform;
}

export function worldConditionUniforms(c: WorldCondition): WorldConditionUniforms {
  return {
    uWcGrass: { value: [c.grass.dry, c.grass.cover, c.grass.brown, c.snow.soot] },
    uWcTrees: { value: [c.trees.dead, c.trees.fade] },
    uWcStraw: { value: new Color(P.straw) },
    uWcBrown: { value: new Color(P.brownGrass) },
    uWcRust: { value: new Color(P.deadRust) },
    uWcGrey: { value: new Color(P.deadGrey) },
    uWcSoot: { value: new Color(P.soot) },
  };
}

/**
 * Patches a vertex-coloured standard material (in place) with the world condition's vertex step and
 * returns it; with no active condition it is returned untouched. Programs are keyed by role, so
 * patched materials share programs with each other and never with unpatched ones.
 */
export function patchVegetation<M extends MeshStandardMaterial>(
  material: M,
  c: WorldCondition | null,
  role: VegetationRole,
): M {
  if (!activeCondition(c)) return material;
  const uniforms = worldConditionUniforms(c);
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${role === 'trees' ? '#define WC_TREES\n' : ''}${WORLD_CONDITION_PARS}`)
      .replace('#include <color_vertex>', `#include <color_vertex>\n${WORLD_CONDITION_VERTEX}`);
  };
  material.customProgramCacheKey = () => `world-condition:${role}`;
  material.userData.worldCondition = uniforms;
  material.needsUpdate = true;
  return material;
}

/** A body as the obstacle renderer knows it (src/core/physics/world.ts ObstacleBody). */
interface TintedBody {
  readonly originId: number;
  readonly kind: ObstacleKind;
}

/** Recolours one obstacle part's linear instance colour in place. */
export type ObstacleTint = (body: TintedBody, part: { readonly name: string }, out: Color) => void;

const luma = (c: Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/** `target` in the shade of `c` (the shader's wcShade), written into `out`. */
function shadeInto(out: Color, target: Color, c: Color): Color {
  const k = Math.min(SHADE_RANGE[1], Math.max(SHADE_RANGE[0], Math.sqrt(luma(c) / Math.max(luma(target), 1e-4))));
  return out.copy(target).multiplyScalar(k);
}

/**
 * Obstacle trees (pines and broadleaves in the valley) in this world, from their instance colours:
 * the same share stand dead (rust or grey crowns), the living yellow by trees.fade; trunks and every
 * other kind are unchanged. Null when there is nothing to change. Deterministic per body.
 */
export function obstacleTreeTint(c: WorldCondition | null): ObstacleTint | null {
  if (!activeCondition(c) || (c.trees.dead <= 0 && c.trees.fade <= 0)) return null;
  const dry = new Color(P.straw).lerp(new Color(P.brownGrass), c.grass.brown);
  const rust = new Color(P.deadRust);
  const grey = new Color(P.deadGrey);
  const shaded = new Color();
  const { dead, fade } = c.trees;
  return (body, part, out) => {
    if (!isTreeKind(body.kind) || (part.name !== 'cone' && part.name !== 'canopy')) return;
    const id = body.originId;
    if (hash2(id, 1, 7331) < dead) {
      out.copy(shadeInto(shaded, hash2(id, 2, 7331) < 0.5 ? rust : grey, out));
      return;
    }
    out.lerp(shadeInto(shaded, dry, out), fade * (0.35 + 0.65 * hash2(id, 3, 7331)));
  };
}
