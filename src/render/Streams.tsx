import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  Mesh,
  MeshStandardMaterial,
  Sphere,
  type ShaderMaterial,
} from 'three';
import type { GameRuntime } from '../core/runtime';
import { buildCaveGeometry, cavePlacement } from '../core/water/cave';
import {
  buildLakeData,
  createRibbonData,
  fillRibbon,
  ribbonCapacity,
  type WaterMeshData,
} from '../core/water/geometry';
import type { Reach } from '../core/water/reach';
import type { WaterSystem } from '../core/water/system';
import { useRuntime } from './RuntimeContext';
import { computeOceanFrame } from './materials/oceanWaves';
import { createWaterMaterial, createWaterUniforms, type WaterUniforms } from './materials/water';
import { SunTracker, skyTintFromScene } from './materials/sun';
import { conditionWaterColours, useWorldCondition } from './worldCondition';

/** Cave rock: the scenery's flat-shaded vertex colours, matte. */
function createCaveMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 });
}

/**
 * Inland water (src/core/water): the level's streams and captured rivers as ribbons rebuilt when the
 * water changes (floods, draining, captures), each dam's reservoir as a lake mesh built once and
 * moved to the reservoir's level, and each cave spring's pool as a lake at its still level with the
 * cave's rock hood over its back (src/core/water/cave.ts). Uses the meltwater river's material with
 * its own uniforms (no leading-edge foam), so the two waters read as one where they meet. Renders
 * nothing on levels without streams. Mount inside <RuntimeContext.Provider>.
 */
export function Streams(): ReactElement | null {
  const runtime = useRuntime();
  return runtime.water ? <StreamsView runtime={runtime} water={runtime.water} /> : null;
}

/** Extra bounding-sphere radius for shader waves (m). */
const BOUNDS_MARGIN = 1.5;

interface WaterMesh {
  data: WaterMeshData;
  geometry: BufferGeometry;
  mesh: Mesh;
  attrs: BufferAttribute[];
}

function createMesh(
  data: WaterMeshData,
  material: ShaderMaterial,
  name: string,
  dynamic: boolean,
): WaterMesh {
  const geometry = new BufferGeometry();
  const attr = (n: string, array: Float32Array, size: number): BufferAttribute => {
    const a = new BufferAttribute(array, size);
    if (dynamic) a.setUsage(DynamicDrawUsage);
    geometry.setAttribute(n, a);
    return a;
  };
  const attrs = [
    attr('position', data.position, 3),
    attr('normal', data.normal, 3),
    attr('uv', data.uv, 2),
    attr('aFlow', data.flow, 1),
    attr('aTurb', data.turb, 1),
    attr('aFall', data.fall, 1),
    attr('aOcean', data.ocean, 1),
    attr('aBirth', data.birth, 1),
    attr('aLateral', data.lateral, 2),
  ];
  geometry.setIndex(new BufferAttribute(data.index, 1));
  geometry.boundingSphere = new Sphere();
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  return { data, geometry, mesh, attrs };
}

function refresh(m: WaterMesh): void {
  for (const a of m.attrs) a.needsUpdate = true;
  m.geometry.setDrawRange(0, m.data.indexCount);
  const b = m.data.bounds;
  const s = m.geometry.boundingSphere as Sphere;
  s.center.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
  s.radius = 0.5 * Math.hypot(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) + BOUNDS_MARGIN;
  m.mesh.visible = m.data.indexCount > 0 && b.maxX > b.minX;
}

/** Foam from a flood: how far a stream cell stands above its free-flowing depth. */
const floodFoam =
  (r: Reach) =>
  (i: number): number =>
    Math.min(0.9, Math.max(0, (r.h[i] - r.steady[i]) / 1.5));

function StreamsView({ runtime, water }: { runtime: GameRuntime; water: WaterSystem }): ReactElement {
  const group = useRef<Group>(null);
  const world = useWorldCondition();
  const { uniforms, material } = useMemo(() => {
    const u: WaterUniforms = createWaterUniforms(computeOceanFrame(runtime.level, runtime.terrain));
    // No leading edge: a stream has always been there.
    u.uHeadS.value = 1e9;
    // Story Mode: the same murk as the meltwater river, so the two still read as one water.
    conditionWaterColours(u, world);
    return { uniforms: u, material: createWaterMaterial(u, 'river') };
  }, [runtime, world]);
  const sun = useMemo(() => new SunTracker(), []);
  const state = useRef<{
    streams: WaterMesh[];
    lakes: WaterMesh[];
    captures: WaterMesh[];
    seen: number;
  } | null>(null);

  useEffect(() => {
    const root = group.current;
    if (!root) return;
    const sea = runtime.level.seaLevel;
    const streams = water.streams.map((st, k) => {
      const m = createMesh(createRibbonData(st.reach.n), material, `Stream${k}`, true);
      fillRibbon(st.reach, sea, m.data, floodFoam(st.reach), st.drawFrom);
      refresh(m);
      root.add(m.mesh);
      return m;
    });
    const lakes = water.reservoirs.map((res, k) => {
      const m = createMesh(buildLakeData(res, water.terrain), material, `Reservoir${k}`, false);
      refresh(m);
      m.mesh.visible = true;
      m.mesh.position.y = res.level;
      m.mesh.updateMatrix();
      // The bounds are local (y = 0): the sphere moves with the mesh.
      root.add(m.mesh);
      return m;
    });
    // Spring pools: still lakes (static), with the cave's rock hood over the back of each.
    const pools = water.pools.map((pool, k) => {
      const m = createMesh(buildLakeData(pool.footprint(), water.terrain), material, `SpringPool${k}`, false);
      refresh(m);
      m.mesh.visible = true;
      m.mesh.position.y = pool.level;
      m.mesh.updateMatrix();
      root.add(m.mesh);
      return m;
    });
    const caveMaterial = createCaveMaterial();
    const caves: Mesh[] = [];
    for (const pool of water.pools) {
      const c = cavePlacement(water.terrain, pool.feature, pool.level);
      if (!c) continue;
      const seed = runtime.level.seed + pool.feature;
      const mesh = new Mesh(buildCaveGeometry(c, water.terrain, water.terrain.theme, seed), caveMaterial);
      mesh.name = `Cave${pool.feature}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
      caves.push(mesh);
    }
    state.current = { streams, lakes: [...lakes], captures: [], seen: water.version };
    return () => {
      for (const m of [...streams, ...lakes, ...pools, ...(state.current?.captures ?? [])]) {
        root.remove(m.mesh);
        m.geometry.dispose();
      }
      for (const mesh of caves) {
        root.remove(mesh);
        mesh.geometry.dispose();
      }
      caveMaterial.dispose();
      state.current = null;
    };
  }, [runtime, water, material]);

  useEffect(() => () => material.dispose(), [material]);

  useFrame((frame) => {
    uniforms.uTime.value = runtime.time;
    sun.update(frame.scene, frame.clock.elapsedTime, uniforms.uSunDir.value, uniforms.uSunColor.value);
    skyTintFromScene(frame.scene.fog, uniforms.uSky.value);
    const st = state.current;
    const root = group.current;
    if (!st || !root || st.seen === water.version) return;
    st.seen = water.version;
    const sea = runtime.level.seaLevel;
    water.streams.forEach((s, k) => {
      fillRibbon(s.reach, sea, st.streams[k].data, floodFoam(s.reach), s.drawFrom);
      refresh(st.streams[k]);
    });
    water.reservoirs.forEach((res, k) => {
      const m = st.lakes[k];
      m.mesh.position.y = res.level;
      m.mesh.visible = res.level > res.floorY + 0.05;
    });
    water.captures.forEach((cap, k) => {
      let m = st.captures[k];
      if (!m || ribbonCapacity(m.data) < cap.reach.n) {
        if (m) {
          root.remove(m.mesh);
          m.geometry.dispose();
        }
        m = createMesh(createRibbonData(Math.max(64, cap.reach.n * 2)), material, `Capture${k}`, true);
        st.captures[k] = m;
        root.add(m.mesh);
      }
      fillRibbon(cap.reach, sea, m.data);
      refresh(m);
    });
  });

  return <group ref={group} name="Streams" />;
}
