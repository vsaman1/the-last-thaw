import { useEffect, useMemo, type ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Terrain } from '../core/types';
import { useRuntime } from './RuntimeContext';
import { BACKDROP } from '../core/terrain/backdrop';
import { computeOceanFrame, OCEAN_INNER_HALF } from './materials/oceanWaves';
import {
  createOceanDepthTexture,
  createOceanGeometry,
  createOceanMaterial,
  createOceanUniforms,
} from './materials/ocean';
import { SunTracker, skyTintFromScene } from './materials/sun';
import { conditionOceanColours, useWorldCondition } from './worldCondition';

/** Ring radius (m) that covers the world around the level, from the ocean's centre on the coast. */
function oceanRadius(terrain: Terrain, frame: { centerX: number; centerZ: number }): number {
  const g = terrain.grid;
  const x1 = g.originX + (g.cols - 1) * g.cellSize;
  const z1 = g.originZ + (g.rows - 1) * g.cellSize;
  let corner = 0;
  for (const x of [g.originX, x1]) {
    for (const z of [g.originZ, z1]) {
      corner = Math.max(corner, Math.hypot(x - frame.centerX, z - frame.centerZ));
    }
  }
  return BACKDROP.reach + corner + 500;
}

/**
 * The sea: a fine Gerstner-wave grid (~1.5 km) centred on the coast plus a flat ring out past the
 * edge of the world around the level (src/core/terrain/backdrop.ts), so open sea continues to the
 * horizon wherever the land does not, and disappears into the scene fog. Shallows are tinted from
 * the terrain height grid.
 */
export function Ocean(): ReactElement {
  const runtime = useRuntime();
  const world = useWorldCondition();

  const res = useMemo(() => {
    const frame = computeOceanFrame(runtime.level, runtime.terrain);
    const depth = createOceanDepthTexture(runtime.terrain.grid, runtime.level.seaLevel);
    const uniforms = createOceanUniforms(frame, depth);
    conditionOceanColours(uniforms, world);
    return {
      frame,
      depth,
      uniforms,
      material: createOceanMaterial(uniforms),
      geometry: createOceanGeometry(OCEAN_INNER_HALF, undefined, oceanRadius(runtime.terrain, frame)),
    };
  }, [runtime, world]);
  const sun = useMemo(() => new SunTracker(), []);

  useEffect(
    () => () => {
      res.geometry.dispose();
      res.material.dispose();
      res.depth.texture.dispose();
    },
    [res],
  );

  useFrame((state) => {
    const u = res.uniforms;
    u.uTime.value = runtime.time;
    sun.update(state.scene, state.clock.elapsedTime, u.uSunDir.value, u.uSunColor.value);
    skyTintFromScene(state.scene.fog, u.uSky.value);
  });

  return (
    <mesh
      name="Ocean"
      geometry={res.geometry}
      material={res.material}
      position={[res.frame.centerX, res.frame.seaLevel, res.frame.centerZ]}
      frustumCulled={false}
    />
  );
}
