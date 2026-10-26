import { DirectionalLight, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createAnalyticTerrain } from '../../core/testing/analyticTerrain';
import { OCEAN_INNER_HALF, OCEAN_WAVES_GLSL, computeOceanFrame } from './oceanWaves';
import {
  OCEAN_DEPTH_RANGE,
  OCEAN_SHADERS,
  createOceanDepthTexture,
  createOceanGeometry,
  createOceanMaterial,
  createOceanUniforms,
} from './ocean';
import { SunTracker } from './sun';
import { WATER_SHADERS, createWaterMaterial, createWaterUniforms } from './water';

const terrain = createAnalyticTerrain({
  height: (_x, z) => 20 - 0.1 * z,
  length: 400,
  width: 120,
  cellSize: 2.5,
  seaLevel: 0,
  level: { coastS: 200 },
});

describe('ocean geometry', () => {
  const geo = createOceanGeometry(OCEAN_INNER_HALF, 64, 6000);
  const pos = geo.getAttribute('position').array as Float32Array;
  const index = geo.getIndex()?.array as Uint32Array;

  it('every triangle faces up and indices are in range', () => {
    const count = pos.length / 3;
    let down = 0;
    for (let i = 0; i < index.length; i += 3) {
      const [a, b, c] = [index[i] * 3, index[i + 1] * 3, index[i + 2] * 3];
      expect(Math.max(index[i], index[i + 1], index[i + 2])).toBeLessThan(count);
      const ux = pos[b] - pos[a];
      const uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a];
      const vz = pos[c + 2] - pos[a + 2];
      if (uz * vx - ux * vz <= 0) down++;
    }
    expect(down).toBe(0);
  });

  it('reaches the horizon and stays flat at y = 0 (waves are applied in the shader)', () => {
    let maxR = 0;
    for (let i = 0; i < pos.length; i += 3) {
      expect(pos[i + 1]).toBe(0);
      maxR = Math.max(maxR, Math.hypot(pos[i], pos[i + 2]));
    }
    expect(maxR).toBeCloseTo(6000, 0);
  });
});

describe('ocean depth texture', () => {
  it('stores seaLevel − height with grid vertices at texel centres', () => {
    const { texture, xform } = createOceanDepthTexture(terrain.grid, 0);
    const g = terrain.grid;
    const img = texture.image as { width: number; height: number; data: Uint8Array };
    expect(img.width).toBe(g.cols);
    expect(img.height).toBe(g.rows);
    expect(texture.unpackAlignment).toBe(1);
    // z = 300 → height −10 → depth 10 m
    const iz = Math.round((300 - g.originZ) / g.cellSize);
    const v = img.data[iz * g.cols + 3] / 255;
    expect(v * OCEAN_DEPTH_RANGE).toBeCloseTo(10, 0);
    // uv of a grid vertex lands on its texel centre
    const x = g.originX + 3 * g.cellSize;
    const z = g.originZ + iz * g.cellSize;
    expect((x - xform.x) * xform.z * g.cols).toBeCloseTo(3.5, 6);
    expect((z - xform.y) * xform.w * g.rows).toBeCloseTo(iz + 0.5, 6);
  });
});

describe('materials', () => {
  it('ocean frame sits on the coast with swell rolling toward the shore', () => {
    const f = computeOceanFrame(terrain.level, terrain);
    expect(f.centerZ).toBeCloseTo(200);
    expect(f.seaDirZ).toBeCloseTo(1);
    const amp = f.waves.reduce((s, w) => s + w.amplitude, 0);
    expect(amp).toBeLessThanOrEqual(0.35);
    for (const w of f.waves) expect(w.dirX * f.seaDirX + w.dirZ * f.seaDirZ).toBeLessThan(0);
  });

  it('water and ocean materials build with fog, shared uniforms and resolved sources', () => {
    const frame = computeOceanFrame(terrain.level, terrain);
    const u = createWaterUniforms(frame);
    const river = createWaterMaterial(u, 'river');
    const plume = createWaterMaterial(u, 'plume');
    expect(river.uniforms).toBe(plume.uniforms);
    expect(river.fog).toBe(true);
    expect(river.transparent).toBe(false);
    expect(plume.transparent).toBe(true);
    expect('PLUME' in plume.defines).toBe(true);
    expect(u.fogColor).toBeDefined();
    const depth = createOceanDepthTexture(terrain.grid, 0);
    const ocean = createOceanMaterial(createOceanUniforms(frame, depth));
    expect(ocean.fog).toBe(true);
    const sources = [
      WATER_SHADERS.vertex,
      WATER_SHADERS.fragment,
      OCEAN_SHADERS.vertex,
      OCEAN_SHADERS.fragment,
    ];
    for (const src of sources) {
      expect(src).not.toContain('${');
      expect(src.split('{').length).toBe(src.split('}').length);
    }
    expect(WATER_SHADERS.vertex).toContain('oceanDisplace');
    expect(OCEAN_WAVES_GLSL).toContain('uOceanBox');
    river.dispose();
    plume.dispose();
    ocean.dispose();
  });
});

describe('SunTracker', () => {
  it('finds a light added later, even after the R3F clock restarts from 0 (pause / resume)', () => {
    const scene = new Scene();
    const sun = new SunTracker();
    const dir = new Vector3();
    expect(sun.update(scene, 5, dir)).toBe(false); // no light yet; next search at 6 s
    const light = new DirectionalLight();
    light.position.set(0, 10, 0);
    scene.add(light, light.target);
    scene.updateMatrixWorld(true);
    // The frameloop mode changed: the clock now reads 0.2 s, far below the next search time.
    expect(sun.update(scene, 0.2, dir)).toBe(true);
    expect(dir.y).toBeCloseTo(1, 6);
  });
});
