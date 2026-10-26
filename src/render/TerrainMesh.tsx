import { useEffect, useMemo } from 'react';
import { MeshStandardMaterial } from 'three';
import type { Terrain } from '../core/types';
import { buildTerrainChunks, type TerrainChunk } from '../core/terrain/terrainGeometry';
import { lastOnly } from './lastOnly';
import { patchVegetation, useWorldCondition } from './worldCondition';

export interface TerrainMeshProps {
  terrain: Terrain;
  /** Terrain self-shadowing (walls onto the floor). Off by default to keep the shadow pass cheap. */
  castShadow?: boolean;
}

// Terrains are reused across restarts (the session caches them per level), so the CPU-side chunk
// geometry of the current level is cached too (another level replaces it). Unmounting only frees GPU
// buffers; three re-uploads on the next mount.
const chunksFor: (terrain: Terrain) => TerrainChunk[] = lastOnly(buildTerrainChunks);

/**
 * Static, flat-shaded, vertex-coloured terrain in ~64×64-cell chunks (frustum culled individually).
 * Triangles are exactly the heightGrid triangulation, so what you see is what the physics samples.
 */
export function TerrainMesh({ terrain, castShadow = false }: TerrainMeshProps) {
  const chunks = useMemo(() => chunksFor(terrain), [terrain]);
  // Story Mode's world condition dries the grass and dulls the snow in the shader (vertex colours
  // and the cached chunk geometry stay as built, shared with Arcade).
  const world = useWorldCondition();
  const material = useMemo(
    () =>
      patchVegetation(
        new MeshStandardMaterial({
          vertexColors: true,
          flatShading: true,
          roughness: 0.9,
          metalness: 0,
        }),
        world,
        'ground',
      ),
    [world],
  );

  useEffect(
    () => () => {
      for (const c of chunks) c.geometry.dispose();
    },
    [chunks],
  );
  useEffect(() => () => material.dispose(), [material]);

  return (
    <group name="terrain">
      {chunks.map((c) => (
        <mesh
          key={c.key}
          name={`terrain-${c.key}`}
          geometry={c.geometry}
          material={material}
          receiveShadow
          castShadow={castShadow}
          matrixAutoUpdate={false}
        />
      ))}
    </group>
  );
}
