import { useEffect, useLayoutEffect, useMemo } from 'react';
import {
  BufferGeometry,
  Color,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { Terrain } from '../core/types';
import { generateDecor, TREE_VARIANT, type DecorBatch } from '../core/terrain/decor';
import { buildBackdropGeometry, createSceneryModels } from '../core/terrain/sceneryGeometry';
import { isGeneratedTerrain } from '../core/terrain/terrain';
import { themeOf } from '../core/terrain/themes';
import { hash2 } from '../core/rng';
import { lastOnly } from './lastOnly';
import { activeCondition, patchVegetation, useWorldCondition, type VegetationRole } from './worldCondition';

export interface SceneryProps {
  terrain: Terrain;
  /** Trees and bushes cast shadows (default true). */
  castShadow?: boolean;
}

interface SceneryObjects {
  meshes: (InstancedMesh | Mesh)[];
  /** The shared materials: vertex-coloured foliage (trees, bushes, tufts, pebbles) and the backdrop. */
  foliage: MeshStandardMaterial;
  backdropMaterial: MeshStandardMaterial;
  /** Frees GPU resources; the objects stay valid and are re-uploaded if rendered again. */
  releaseGpu(): void;
}

// Terrains are reused across restarts, so the built scenery of the current level is cached (CPU side;
// another level replaces it, and its GPU resources were already released when it unmounted).
const sceneryByShadow = lastOnly((_terrain: Terrain) => new Map<boolean, SceneryObjects>());

function sceneryFor(terrain: Terrain, castShadow: boolean): SceneryObjects {
  const byShadow = sceneryByShadow(terrain);
  let objects = byShadow.get(castShadow);
  if (!objects) {
    objects = buildScenery(terrain, castShadow);
    byShadow.set(castShadow, objects);
  }
  return objects;
}

/**
 * Side of the square tiles scenery is split into. One map-wide InstancedMesh can never be frustum
 * culled (and every instance is drawn into the shadow map), so each tile gets its own mesh + bounds.
 */
const TILE = 128;

/**
 * Fills InstancedMeshes from a decor batch (optionally only one variant) with tinted instance colours,
 * one mesh per spatial tile so the camera and shadow camera can cull them.
 */
function instanced(
  name: string,
  geometry: BufferGeometry,
  material: Material,
  batch: DecorBatch,
  tint: (variant: number, rnd: number, out: Color) => void,
  onlyVariant = -1,
): InstancedMesh[] {
  const tiles = new Map<string, number[]>();
  for (let i = 0; i < batch.count; i++) {
    if (onlyVariant >= 0 && batch.variant[i] !== onlyVariant) continue;
    const key = `${Math.floor(batch.positions[i * 3] / TILE)}:${Math.floor(batch.positions[i * 3 + 2] / TILE)}`;
    let list = tiles.get(key);
    if (!list) tiles.set(key, (list = []));
    list.push(i);
  }
  const m = new Matrix4();
  const p = new Vector3();
  const q = new Quaternion();
  const s = new Vector3();
  const up = new Vector3(0, 1, 0);
  const c = new Color();
  const meshes: InstancedMesh[] = [];
  for (const [key, list] of tiles) {
    const mesh = new InstancedMesh(geometry, material, list.length);
    list.forEach((i, k) => {
      const v = batch.variant[i];
      p.set(batch.positions[i * 3], batch.positions[i * 3 + 1], batch.positions[i * 3 + 2]);
      q.setFromAxisAngle(up, batch.yaw[i]);
      const sc = batch.scale[i];
      s.set(sc, sc, sc);
      mesh.setMatrixAt(k, m.compose(p, q, s));
      tint(v, hash2(i, v, 977), c);
      mesh.setColorAt(k, c);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.matrixAutoUpdate = false;
    mesh.name = `${name}:${key}`;
    meshes.push(mesh);
  }
  return meshes;
}

function buildScenery(terrain: Terrain, castShadow: boolean): SceneryObjects {
  const theme = isGeneratedTerrain(terrain) ? terrain.theme : themeOf(terrain.level);
  const decor = generateDecor(terrain, terrain.level.seed);
  const models = createSceneryModels(theme.scenery);
  const foliage = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
  const backdropMaterial = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });

  const warm = new Color(theme.tintWarm);
  const cool = new Color(theme.tintCool);
  const white = new Color(1, 1, 1);
  const tintTree = (variant: number, rnd: number, out: Color): void => {
    out.copy(white).lerp(variant === TREE_VARIANT.broadleaf ? warm : cool, rnd * 0.6);
    out.multiplyScalar(0.88 + 0.22 * hash2(variant, Math.floor(rnd * 1e6), 3));
  };
  const tintSoft = (variant: number, rnd: number, out: Color): void => {
    out.copy(white).lerp(variant === 1 ? warm : cool, 0.15 + 0.3 * rnd);
    out.multiplyScalar(0.85 + 0.25 * rnd);
  };
  const tintPebble = (variant: number, rnd: number, out: Color): void => {
    out.set(variant === 0 ? '#FFFFFF' : variant === 1 ? '#D8C6B0' : '#B9BCD0');
    out.multiplyScalar(0.75 + 0.35 * rnd);
  };

  const { conifer, broadleaf } = TREE_VARIANT;
  const conifers = instanced('scenery-conifers', models.conifer, foliage, decor.trees, tintTree, conifer);
  const broadleaves = instanced('scenery-broadleaves', models.broadleaf, foliage, decor.trees, tintTree, broadleaf);
  const bushes = instanced('scenery-bushes', models.bush, foliage, decor.bushes, tintSoft);
  const tufts = instanced('scenery-tufts', models.tuft, foliage, decor.tufts, tintSoft);
  const pebbles = instanced('scenery-pebbles', models.pebble, foliage, decor.pebbles, tintPebble);
  for (const m of [...conifers, ...broadleaves, ...bushes]) m.castShadow = castShadow;

  const backdropGeometry = buildBackdropGeometry(terrain);
  const backdrop = new Mesh(backdropGeometry, backdropMaterial);
  backdrop.name = 'scenery-backdrop';
  backdrop.matrixAutoUpdate = false;

  const instancedMeshes = [...conifers, ...broadleaves, ...bushes, ...tufts, ...pebbles];
  return {
    meshes: [...instancedMeshes, backdrop],
    foliage,
    backdropMaterial,
    releaseGpu() {
      for (const m of instancedMeshes) m.dispose();
      for (const g of Object.values(models)) g.dispose();
      backdropGeometry.dispose();
      foliage.dispose();
      backdropMaterial.dispose();
    },
  };
}

/** The vegetation role of a scenery mesh: trees can stand dead, everything else only dries. */
const roleOf = (mesh: Mesh): VegetationRole =>
  mesh.name.startsWith('scenery-conifers') || mesh.name.startsWith('scenery-broadleaves') ? 'trees' : 'ground';

/**
 * Story Mode's world condition on the (cached, Arcade-shared) scenery: while mounted, its meshes draw
 * with patched copies of the shared materials, and get the originals back on unmount. Before the
 * first frame (a layout effect), so the loading warm-up compiles the patched programs.
 */
function useWorldConditionMaterials(objects: SceneryObjects): void {
  const world = useWorldCondition();
  useLayoutEffect(() => {
    if (!activeCondition(world)) return;
    const trees = patchVegetation(objects.foliage.clone(), world, 'trees');
    const ground = patchVegetation(objects.foliage.clone(), world, 'ground');
    const backdrop = patchVegetation(objects.backdropMaterial.clone(), world, 'ground');
    const swapped = objects.meshes.map((m) => {
      const original = m.material;
      m.material = m.material === objects.backdropMaterial ? backdrop : roleOf(m) === 'trees' ? trees : ground;
      return { m, original };
    });
    return () => {
      for (const { m, original } of swapped) m.material = original;
      trees.dispose();
      ground.dispose();
      backdrop.dispose();
    };
  }, [objects, world]);
}

/**
 * Non-interactive scenery: instanced trees, bushes, grass tufts and pebbles from generateDecor(),
 * plus the world around the level (src/core/terrain/backdrop.ts): land and seabed from the bounds
 * out to the horizon, one draw call, no shadows. Models, tints and the backdrop follow the theme.
 */
export function Scenery({ terrain, castShadow = true }: SceneryProps) {
  const objects = useMemo(() => sceneryFor(terrain, castShadow), [terrain, castShadow]);
  useEffect(() => () => objects.releaseGpu(), [objects]);
  useWorldConditionMaterials(objects);

  return (
    <group name="scenery">
      {objects.meshes.map((m) => (
        <primitive key={m.name} object={m} />
      ))}
    </group>
  );
}
