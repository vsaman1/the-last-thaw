import type { Terrain } from '../types';
import { TAU, smoothstep } from '../math';
import { createRng, fbm2 } from '../rng';
import { getGlacier, glacierSnowAt, glacierTopAt } from '../glacier/glacier';
import type { CourseProjection } from './course';
import { isGeneratedTerrain } from './terrain';
import { dirtPatchAt, snowCoverAt, snowCoverFor, themeOf } from './themes';

/**
 * Non-interactive scenery placement (trees on the mountainsides, bushes, grass tufts, pebbles).
 * Pure data: struct-of-arrays per kind so renderers can fill InstancedMesh matrices directly and
 * agents can inspect counts and positions. The level theme flavours densities, the conifer mix and
 * sizes; nothing grows above the snow line or on bare dirt patches. Snow a level brings down onto
 * the floor (LevelDef.snow) keeps the scenery forests (snowy conifers) but no bushes or tufts.
 */

export interface DecorBatch {
  readonly count: number;
  /** x, y, z per instance (y = terrain height at the base). */
  readonly positions: Float32Array;
  /** Rotation about +Y (radians). */
  readonly yaw: Float32Array;
  /** Uniform scale multiplier. */
  readonly scale: Float32Array;
  /** Kind-specific model/colour variant (see *_VARIANT constants). */
  readonly variant: Uint8Array;
}

export interface DecorLayout {
  readonly seed: number;
  /** variant: TREE_VARIANT. Always off the valley floor. */
  readonly trees: DecorBatch;
  /** variant 0..2 colour. Always off the valley floor. */
  readonly bushes: DecorBatch;
  /** variant 0..2 colour. May sit on the floor (tiny). */
  readonly tufts: DecorBatch;
  /** variant 0..2 colour. May sit on the floor (tiny). */
  readonly pebbles: DecorBatch;
}

export const TREE_VARIANT = { conifer: 0, broadleaf: 1 } as const;

export const DECOR_LIMITS = {
  trees: 2500,
  bushes: 2500,
  tufts: 6000,
  pebbles: 3000,
} as const;

/** Clearance (m) beyond the floor edge that trees and bushes keep. */
export const DECOR_FLOOR_CLEARANCE = { trees: 3, bushes: 2 } as const;

class BatchBuilder {
  private n = 0;
  private readonly pos: Float32Array;
  private readonly yaw: Float32Array;
  private readonly scale: Float32Array;
  private readonly variant: Uint8Array;

  constructor(readonly capacity: number) {
    this.pos = new Float32Array(capacity * 3);
    this.yaw = new Float32Array(capacity);
    this.scale = new Float32Array(capacity);
    this.variant = new Uint8Array(capacity);
  }

  get full(): boolean {
    return this.n >= this.capacity;
  }

  push(x: number, y: number, z: number, yaw: number, scale: number, variant: number): void {
    if (this.n >= this.capacity) return;
    const i = this.n++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.yaw[i] = yaw;
    this.scale[i] = scale;
    this.variant[i] = variant;
  }

  build(): DecorBatch {
    const n = this.n;
    return {
      count: n,
      positions: this.pos.slice(0, n * 3),
      yaw: this.yaw.slice(0, n),
      scale: this.scale.slice(0, n),
      variant: this.variant.slice(0, n),
    };
  }
}

export function generateDecor(terrain: Terrain, seed: number): DecorLayout {
  const level = terrain.level;
  const { bounds } = level;
  const sea = level.seaLevel;
  const course = terrain.course;
  const L = course.length;
  const gen = isGeneratedTerrain(terrain) ? terrain : null;
  const theme = gen ? gen.theme : themeOf(level);
  const fl = theme.decor;
  const snow = gen ? gen.snowCover : snowCoverFor(level, theme, course.sampleAt(level.startS).floor);
  // Trees stop at the theme's own snow line (LevelDef.snow only paints the ground below it white).
  const snowLine = snow.natural;
  const hasSnow = Number.isFinite(snowLine);
  const lowSnow = snow.line < snow.natural;
  /** 1 below the tree line, fading to 0 at the snow line. */
  const belowSnow = (y: number): number => (hasSnow ? 1 - smoothstep(snowLine - 40, snowLine, y) : 1);
  /** True where the ground is too bare (dirt patch) or snowy for plants. */
  const barren = (x: number, y: number, z: number): boolean =>
    (hasSnow && y > snowLine) || (theme.dirtPatch > 0 && dirtPatchAt(theme, x, z, level.seed) > 0.35);
  const rng = createRng((seed ^ 0x5eed) >>> 0);
  const proj: CourseProjection = { s: 0, sExt: 0, d: 0 };

  const halfWidthAt = (s: number): number =>
    gen ? gen.course.halfWidthAt(s) : course.sampleAt(s).halfWidth;

  /** Distance past the valley-floor edge (negative = on the floor). Behind the start counts as off-floor. */
  const offFloor = (x: number, z: number): number => {
    if (gen) {
      gen.course.projectInto(x, z, proj);
    } else {
      const p = course.project(x, z);
      proj.s = p.s;
      proj.sExt = p.s;
      proj.d = p.d;
    }
    const lat = Math.abs(proj.d) - halfWidthAt(proj.s);
    return proj.sExt < 0 ? Math.max(lat, -proj.sExt) : lat;
  };

  const slopeAt = (x: number, z: number): number => {
    const g = terrain.gradientAt(x, z);
    return Math.hypot(g.dx, g.dz);
  };
  /** True on snow the level brought down below the theme's line (no bushes or tufts there). */
  const lowSnowAt = (x: number, y: number, z: number): boolean =>
    lowSnow && snowCoverAt(snow, y, slopeAt(x, z), x, z, level.seed, gen ? gen.paintAt(x, z) : 0);

  // Nothing grows on the glacier the level starts from or on the snow field around it.
  const glacier = getGlacier(terrain);
  const snowy = (x: number, y: number, z: number): boolean =>
    glacierTopAt(glacier, x, z) > y || glacierSnowAt(glacier, x, z, y, slopeAt(x, z)) > 0.3;

  const area = (bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ);
  const forest = (x: number, z: number): number =>
    0.2 + 0.8 * smoothstep(-0.15, 0.35, fbm2(x / 95, z / 95, seed + 5, 3));

  // Trees: on grass outside the valley floor, clustered into forests.
  const trees = new BatchBuilder(DECOR_LIMITS.trees);
  const treeDensity = level.decor.sceneryTreeDensity * fl.trees;
  const treeTries = Math.min(60000, Math.ceil((area / 1000) * treeDensity * 1.8));
  for (let i = 0; i < treeTries && !trees.full; i++) {
    const x = bounds.minX + rng() * (bounds.maxX - bounds.minX);
    const z = bounds.minZ + rng() * (bounds.maxZ - bounds.minZ);
    const keep = rng();
    const yaw = rng() * TAU;
    // Scenery trees are stylised large so forests read on 100 m mountainsides.
    const sc = fl.treeScaleMin + rng() * fl.treeScaleRange;
    const kind = rng();
    if (keep > forest(x, z)) continue;
    const y = terrain.heightAt(x, z);
    if (y < sea + 2.5 || slopeAt(x, z) > 0.6) continue;
    if (hasSnow && keep > forest(x, z) * belowSnow(y)) continue;
    if (terrain.surfaceAt(x, z) !== 'grass') continue;
    if (offFloor(x, z) < DECOR_FLOOR_CLEARANCE.trees) continue;
    if (barren(x, y, z) || snowy(x, y, z)) continue;
    const high = smoothstep(sea + 40, sea + 170, y);
    const coniferBias = fl.coniferLow + (fl.coniferHigh - fl.coniferLow) * high;
    const variant = kind < coniferBias ? TREE_VARIANT.conifer : TREE_VARIANT.broadleaf;
    trees.push(x, y - 0.2, z, yaw, sc, variant);
  }

  // Bushes: same rules, sparser clustering, a little closer to the floor edge.
  const bushes = new BatchBuilder(DECOR_LIMITS.bushes);
  const bushTries = Math.min(60000, Math.ceil((area / 1000) * level.decor.bushDensity * fl.bushes * 1.6));
  for (let i = 0; i < bushTries && !bushes.full; i++) {
    const x = bounds.minX + rng() * (bounds.maxX - bounds.minX);
    const z = bounds.minZ + rng() * (bounds.maxZ - bounds.minZ);
    const keep = rng();
    const yaw = rng() * TAU;
    const sc = 0.6 + rng() * 0.7;
    const variant = Math.floor(rng() * 3);
    if (keep > 0.35 + 0.65 * forest(x + 400, z)) continue;
    const y = terrain.heightAt(x, z);
    if (y < sea + 1.5 || slopeAt(x, z) > 0.7) continue;
    if (terrain.surfaceAt(x, z) !== 'grass') continue;
    if (offFloor(x, z) < DECOR_FLOOR_CLEARANCE.bushes) continue;
    if (barren(x, y, z) || snowy(x, y, z) || lowSnowAt(x, y, z)) continue;
    bushes.push(x, y - 0.15, z, yaw, sc, variant);
  }

  // Tufts and pebbles: in the corridor the camera actually sees (floor + lower walls).
  const corridorEnd = Math.min(L, level.coastS + 20);
  const corridorPad = 35;
  let corridorArea = 0;
  for (let s = 0; s < corridorEnd; s += 10) corridorArea += 10 * 2 * (halfWidthAt(s) + corridorPad);

  // Oversampled ×2 because walls (rock) and part of the floor are rejected.
  const scatter = (
    b: BatchBuilder,
    density: number,
    floorKeep: number,
    allowSand: boolean,
    scale: number,
    plant: boolean,
  ): void => {
    const tries = Math.min(40000, Math.ceil((corridorArea / 1000) * density * 2));
    for (let i = 0; i < tries && !b.full; i++) {
      const s = rng() * corridorEnd;
      const u = rng() * 2 - 1;
      const keep = rng();
      const yaw = rng() * TAU;
      const sc = 0.7 + rng() * 0.6;
      const variant = Math.floor(rng() * 3);
      const hw = halfWidthAt(s);
      const d = u * (hw + corridorPad);
      const onFloor = Math.abs(d) < hw;
      if (onFloor && keep > floorKeep) continue;
      const w = course.toWorld(s, d);
      if (terrain.isOcean(w.x, w.z) || w.y < sea + 0.2) continue;
      const surf = terrain.surfaceAt(w.x, w.z);
      if (surf === 'rock' || surf === 'seabed' || (!allowSand && surf === 'sand')) continue;
      if (plant && ((hasSnow && w.y > snowLine) || lowSnowAt(w.x, w.y, w.z))) continue;
      if (snowy(w.x, w.y, w.z)) continue;
      // On the floor keep them short enough to stay under the river surface (no theme scale).
      b.push(w.x, w.y, w.z, yaw, onFloor ? sc * 0.55 : sc * scale, variant);
    }
  };
  const tufts = new BatchBuilder(DECOR_LIMITS.tufts);
  scatter(tufts, level.decor.grassTuftDensity * fl.tufts, 0.4, false, 1, true);
  const pebbles = new BatchBuilder(DECOR_LIMITS.pebbles);
  scatter(pebbles, level.decor.pebbleDensity * fl.pebbles, 0.6, true, fl.pebbleScale, false);

  return {
    seed,
    trees: trees.build(),
    bushes: bushes.build(),
    tufts: tufts.build(),
    pebbles: pebbles.build(),
  };
}
