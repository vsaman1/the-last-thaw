import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  Mesh,
  Sphere,
  type ShaderMaterial,
} from 'three';
import type { RiverTrailApi, Terrain } from '../core/types';
import { isRiverTrail } from '../core/river/trail';
import {
  DEFAULT_RIVER_GEOMETRY_OPTIONS,
  RIVER_CROSS_VERTS,
  RIVER_GEOMETRY_REACH,
  buildRiverChunk,
  createRiverChunkGeometry,
  riverChunkCount,
  riverChunkRange,
  type RiverChunkGeometry,
} from '../core/river/geometry';
import { useRuntime } from './RuntimeContext';
import { computeOceanFrame } from './materials/oceanWaves';
import { createWaterMaterial, createWaterUniforms } from './materials/water';
import { SunTracker, skyTintFromScene } from './materials/sun';
import { conditionWaterColours, useWorldCondition } from './worldCondition';

/** Extra bounding-sphere radius for shader waves and swell (m). */
const BOUNDS_MARGIN = 1.5;
/** A RiverTrailApi without change stamps is fully rebuilt at most this often (s). */
const GENERIC_REBUILD_INTERVAL = 0.25;

interface ChunkMesh {
  readonly data: RiverChunkGeometry;
  readonly geometry: BufferGeometry;
  readonly mesh: Mesh;
  readonly attrs: readonly BufferAttribute[];
  builtVersion: number;
  /** Last data.indexVersion uploaded: gaps (jumped ravines) rewrite the index with degenerate quads. */
  indexVersion: number;
}

/** Owns the chunk meshes and decides, per frame, which chunks need (partial) rebuilding. */
class RiverChunks {
  readonly group = new Group();
  private readonly chunks: ChunkMesh[] = [];
  private river: RiverTrailApi | null = null;
  private seenVersion = -1;
  private seenStructure = -1;
  private lastGenericBuild = -Infinity;

  /** Never-drawn meshes that make both water programs compile with the rest of the scene. */
  private readonly prewarm: ChunkMesh[];

  constructor(
    private readonly opaque: ShaderMaterial,
    private readonly plume: ShaderMaterial,
  ) {
    this.group.name = 'River';
    // No chunk exists until the iceberg moves, and the plume material is only assigned once the
    // river reaches the sea — without these, each program would link mid-gameplay (a 1 s+ freeze
    // on a cold shader cache). three still calls setProgram for a mesh whose draw range is empty.
    this.prewarm = [this.opaque, this.plume].map((material) => {
      const entry = this.createChunk(2);
      entry.geometry.setDrawRange(0, 0);
      entry.mesh.material = material;
      entry.mesh.frustumCulled = false;
      entry.mesh.name = 'RiverPrewarm';
      return entry;
    });
  }

  update(river: RiverTrailApi, terrain: Terrain, now: number): void {
    if (river !== this.river) {
      this.river = river;
      this.seenVersion = -1;
      this.seenStructure = -1;
    }
    if (river.version === this.seenVersion) return;
    const trail = isRiverTrail(river) ? river : null;
    if (!trail) {
      // `now` (R3F's clock) restarts from 0 when the frameloop mode changes: a backwards step rebuilds.
      const since = now - this.lastGenericBuild;
      if (since >= 0 && since < GENERIC_REBUILD_INTERVAL) return;
      this.lastGenericBuild = now;
    }
    const samples = river.samples;
    const n = samples.length;
    const count = riverChunkCount(n);
    const full = !trail || trail.structureVersion !== this.seenStructure;

    while (this.chunks.length > count) this.disposeChunk(this.chunks.pop() as ChunkMesh);
    for (let k = 0; k < count; k++) {
      const r = riverChunkRange(k, n);
      let entry = this.chunks[k];
      if (!entry) {
        entry = this.createChunk();
        this.chunks.push(entry);
        this.build(entry, river, terrain, r.start, r.end, r.start);
        continue;
      }
      if (full || !trail) {
        this.build(entry, river, terrain, r.start, r.end, r.start);
        continue;
      }
      // First sample within reach of this chunk that changed since it was built.
      const ts = trail.samples;
      const lo = Math.max(0, r.start - RIVER_GEOMETRY_REACH);
      const hi = Math.min(n - 1, r.end + RIVER_GEOMETRY_REACH);
      const built = entry.builtVersion;
      let first = -1;
      for (let i = lo; i <= hi; i++) {
        if (ts[i].rev > built) {
          first = i;
          break;
        }
      }
      if (first < 0 && entry.data.end === r.end) continue;
      const from = first < 0 ? r.start : Math.max(r.start, first - RIVER_GEOMETRY_REACH);
      this.build(entry, river, terrain, r.start, r.end, from);
    }
    this.seenVersion = river.version;
    this.seenStructure = trail ? trail.structureVersion : -1;
  }

  private createChunk(maxCrossSections?: number): ChunkMesh {
    const data = createRiverChunkGeometry(maxCrossSections);
    const geometry = new BufferGeometry();
    const attr = (name: string, array: Float32Array, size: number): BufferAttribute => {
      const a = new BufferAttribute(array, size);
      a.setUsage(DynamicDrawUsage);
      geometry.setAttribute(name, a);
      return a;
    };
    const attrs = [
      attr('position', data.position, 3),
      attr('normal', data.normal, 3),
      attr('uv', data.uv, 2),
      attr('aFlow', data.flowSpeed, 1),
      attr('aTurb', data.turbulence, 1),
      attr('aFall', data.fall, 1),
      attr('aOcean', data.ocean, 1),
      attr('aBirth', data.birth, 1),
      attr('aLateral', data.lateral, 2),
    ];
    geometry.setIndex(new BufferAttribute(data.index, 1));
    geometry.boundingSphere = new Sphere();
    const mesh = new Mesh(geometry, this.opaque);
    mesh.name = 'RiverChunk';
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    return { data, geometry, mesh, attrs, builtVersion: -1, indexVersion: data.indexVersion };
  }

  private build(
    entry: ChunkMesh,
    river: RiverTrailApi,
    terrain: Terrain,
    start: number,
    end: number,
    from: number,
  ): void {
    const d = entry.data;
    buildRiverChunk(river.samples, start, end, terrain, d, DEFAULT_RIVER_GEOMETRY_OPTIONS, from);
    if (d.indexVersion !== entry.indexVersion) {
      entry.indexVersion = d.indexVersion;
      (entry.geometry.index as BufferAttribute).needsUpdate = true;
    }
    const firstVert = d.writtenFrom * RIVER_CROSS_VERTS;
    const verts = d.vertexCount - firstVert;
    for (const a of entry.attrs) {
      a.clearUpdateRanges();
      if (verts > 0) a.addUpdateRange(firstVert * a.itemSize, verts * a.itemSize);
      a.needsUpdate = true;
    }
    entry.geometry.setDrawRange(0, d.indexCount);
    const b = d.bounds;
    const sphere = entry.geometry.boundingSphere as Sphere;
    if (d.vertexCount > 0) {
      sphere.center.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
      sphere.radius = 0.5 * Math.hypot(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) + BOUNDS_MARGIN;
    } else {
      sphere.radius = 0;
    }
    entry.mesh.material = d.hasOcean ? this.plume : this.opaque;
    entry.mesh.visible = d.indexCount > 0;
    entry.builtVersion = river.version;
  }

  private disposeChunk(entry: ChunkMesh): void {
    this.group.remove(entry.mesh);
    entry.geometry.dispose();
  }

  dispose(): void {
    while (this.chunks.length) this.disposeChunk(this.chunks.pop() as ChunkMesh);
    for (const p of this.prewarm) this.disposeChunk(p);
    this.river = null;
  }
}

/**
 * The river trail: chunked meshes rebuilt incrementally from runtime.river as the iceberg
 * travels, with the shared flowing-water material. Mount inside <RuntimeContext.Provider>.
 */
export function River(): ReactElement {
  const runtime = useRuntime();
  const groupRef = useRef<Group>(null);
  const chunksRef = useRef<RiverChunks | null>(null);
  const world = useWorldCondition();

  const { uniforms, opaque, plume } = useMemo(() => {
    const u = createWaterUniforms(computeOceanFrame(runtime.level, runtime.terrain));
    conditionWaterColours(u, world);
    return { uniforms: u, opaque: createWaterMaterial(u, 'river'), plume: createWaterMaterial(u, 'plume') };
  }, [runtime, world]);
  const sun = useMemo(() => new SunTracker(), []);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const chunks = new RiverChunks(opaque, plume);
    chunksRef.current = chunks;
    group.add(chunks.group);
    return () => {
      group.remove(chunks.group);
      chunks.dispose();
      if (chunksRef.current === chunks) chunksRef.current = null;
    };
  }, [opaque, plume]);

  useEffect(
    () => () => {
      opaque.dispose();
      plume.dispose();
    },
    [opaque, plume],
  );

  useFrame((state) => {
    const river = runtime.river;
    const u = uniforms;
    u.uTime.value = runtime.time;
    u.uHeadS.value = river.length;
    u.uStartS.value = river.samples.length > 0 ? river.samples[0].s : 0;
    u.uCoastS.value = isRiverTrail(river) ? (river.coastS ?? -1) : -1;
    sun.update(state.scene, state.clock.elapsedTime, u.uSunDir.value, u.uSunColor.value);
    skyTintFromScene(state.scene.fog, u.uSky.value);
    chunksRef.current?.update(river, runtime.terrain, state.clock.elapsedTime);
  });

  return <group ref={groupRef} name="RiverRoot" />;
}
