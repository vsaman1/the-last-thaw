import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import { LEVELS } from '../levels';
import type { LevelDef } from '../types';
import { BACKDROP, backdropHorizon, buildBackdropGeometry, type BackdropStats } from './backdrop';
import { createTerrain, type GeneratedTerrain } from './terrain';

const terrains = new Map<string, GeneratedTerrain>();
const terrainOf = (level: LevelDef): GeneratedTerrain => {
  let t = terrains.get(level.id);
  if (!t) terrains.set(level.id, (t = createTerrain(level)));
  return t;
};

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}
const rectOf = (t: GeneratedTerrain): Rect => {
  const g = t.grid;
  return {
    x0: g.originX,
    z0: g.originZ,
    x1: g.originX + (g.cols - 1) * g.cellSize,
    z1: g.originZ + (g.rows - 1) * g.cellSize,
  };
};
const outside = (r: Rect, x: number, z: number): number =>
  Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

describe.each(LEVELS.map((l) => [l.id, l] as const))('backdrop around %s', (_id, level) => {
  const terrain = terrainOf(level);
  const t0 = performance.now();
  const geo: BufferGeometry = buildBackdropGeometry(terrain);
  const buildMs = performance.now() - t0;
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const col = geo.getAttribute('color');
  const stats = geo.userData.stats as BackdropStats;
  const r = rectOf(terrain);
  const g = terrain.grid;
  const sea = level.seaLevel;

  it('stays within the triangle budget and builds quickly', () => {
    expect(stats.triangles).toBe(pos.count / 3);
    expect(stats.triangles).toBeLessThanOrEqual(BACKDROP.maxTriangles);
    expect(buildMs).toBeLessThan(1500);
    const ms = buildMs.toFixed(0);
    console.info(`${level.id}: ${stats.triangles} triangles, ${stats.rings} rings, ${ms} ms`);
  });

  it('has finite positions, upward faces and sane colours', () => {
    for (let v = 0; v < pos.count; v++) {
      expect(Number.isFinite(pos.getX(v) + pos.getY(v) + pos.getZ(v))).toBe(true);
      const c = [col.getX(v), col.getY(v), col.getZ(v)];
      for (const k of c) expect(k >= 0 && k <= 1.5).toBe(true);
      if (v % 3 === 0) expect(nor.getY(v)).toBeGreaterThan(0);
    }
  });

  it('meets the terrain edge exactly: every boundary vertex of the grid, at its height', () => {
    const onEdge = new Set<string>();
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v);
      const z = pos.getZ(v);
      const inside = x >= r.x0 - 1e-3 && x <= r.x1 + 1e-3 && z >= r.z0 - 1e-3 && z <= r.z1 + 1e-3;
      if (!inside) continue;
      const boundary =
        Math.abs(x - r.x0) < 1e-3 ||
        Math.abs(x - r.x1) < 1e-3 ||
        Math.abs(z - r.z0) < 1e-3 ||
        Math.abs(z - r.z1) < 1e-3;
      // Nothing of the backdrop lies over the level itself.
      expect(boundary, `${x}, ${z}`).toBe(true);
      expect(Math.abs(pos.getY(v) - terrain.heightAt(x, z))).toBeLessThan(1e-3);
      onEdge.add(`${Math.round((x - g.originX) / g.cellSize)}:${Math.round((z - g.originZ) / g.cellSize)}`);
    }
    expect(onEdge.size).toBe(2 * (g.cols - 1) + 2 * (g.rows - 1));
  });

  it('carries on from the edge without a step on every side (no slab sides)', () => {
    const near = 3 * g.cellSize;
    const steps = { minZ: 0, maxX: 0, maxZ: 0, minX: 0 };
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v);
      const z = pos.getZ(v);
      const d = outside(r, x, z);
      if (d <= 1e-3 || d > near) continue;
      const fx = Math.min(r.x1, Math.max(r.x0, x));
      const fz = Math.min(r.z1, Math.max(r.z0, z));
      const step = Math.abs(pos.getY(v) - terrain.heightAt(fx, fz));
      expect(step, `at ${x.toFixed(1)}, ${z.toFixed(1)} (${d.toFixed(1)} m out)`).toBeLessThan(1 + 1.6 * d);
      if (z < r.z0) steps.minZ++;
      else if (z > r.z1) steps.maxZ++;
      else if (x > r.x1) steps.maxX++;
      else steps.minX++;
    }
    for (const n of Object.values(steps)) expect(n).toBeGreaterThan(10);
  });

  it('reaches the horizon all round, with land rising into ranges and the sea staying open', () => {
    let maxD = 0;
    let maxY = -Infinity;
    for (let v = 0; v < pos.count; v++) {
      const d = outside(r, pos.getX(v), pos.getZ(v));
      maxD = Math.max(maxD, d);
      maxY = Math.max(maxY, pos.getY(v));
    }
    expect(maxD).toBeGreaterThan(BACKDROP.reach - 1);
    expect(maxD).toBeLessThan(BACKDROP.reach + 1);
    expect(backdropHorizon(terrain, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2)).toBe(BACKDROP.reach);
    let edgeMax = -Infinity;
    for (let ix = 0; ix < g.cols; ix++) edgeMax = Math.max(edgeMax, g.heights[ix]);
    expect(maxY).toBeGreaterThan(Math.max(edgeMax, sea) + 100);

    // Out to sea beyond the finish (it lies in the sea) the backdrop stays under water.
    const end = terrain.course.sampleAt(terrain.course.length);
    const dl = Math.hypot(end.dirX, end.dirZ) || 1;
    for (const k of [1.2, 2, 4]) {
      const px = terrain.finishPos.x + (end.dirX / dl) * k * 1000;
      const pz = terrain.finishPos.z + (end.dirZ / dl) * k * 1000;
      if (outside(r, px, pz) < 300) continue;
      let best = Infinity;
      let y = 0;
      for (let v = 0; v < pos.count; v += 3) {
        const q = (pos.getX(v) - px) ** 2 + (pos.getZ(v) - pz) ** 2;
        if (q < best) {
          best = q;
          y = pos.getY(v);
        }
      }
      expect(y, `${k} km out to sea`).toBeLessThan(sea);
    }
  });
});

describe('backdrop determinism', () => {
  it('is identical when rebuilt (deterministic from the level seed)', () => {
    const t = terrainOf(LEVELS[0]);
    const a = buildBackdropGeometry(t);
    const b = buildBackdropGeometry(t);
    for (const name of ['position', 'color'] as const) {
      const pa = a.getAttribute(name).array;
      const pb = b.getAttribute(name).array;
      expect(pa.length).toBe(pb.length);
      let same = true;
      for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) same = false;
      expect(same, name).toBe(true);
    }
    const c = buildBackdropGeometry(t, { seed: 999 });
    expect(c.getAttribute('position').array).not.toEqual(a.getAttribute('position').array);
    for (const x of [a, b, c]) x.dispose();
  });
});
