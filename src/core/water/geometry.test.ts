import { describe, expect, it } from 'vitest';
import { createTerrain } from '../terrain/terrain';
import { streamSandbox } from '../testing/streamSandbox';
import type {
  ContactOutcome,
  IcebergContact,
  ObstacleProxy,
  ObstacleStats,
  PhysicsWorldApi,
} from '../types';
import { buildLakeData, createRibbonData, fillRibbon, RIBBON_MARGIN, STREAM_CROSS } from './geometry';
import { WaterSystem } from './system';
import { SWEEP } from './tuning';

/** Mesh data for the renderer (src/render/Streams.tsx) and the flood's hook on standing vehicles. */

const terrain = createTerrain(streamSandbox);

describe('water meshes', () => {
  it('lays a stream ribbon on its surface, as wide as its water, collapsed where it is dry', () => {
    const w = new WaterSystem(terrain);
    const r = w.streams[0].reach;
    const d = createRibbonData(r.n);
    expect(fillRibbon(r, streamSandbox.seaLevel, d)).toBe(r.n);
    expect(d.vertexCount).toBe(r.n * STREAM_CROSS);
    expect(d.indexCount).toBe((r.n - 1) * (STREAM_CROSS - 1) * 6);
    const i = 120;
    const v0 = i * STREAM_CROSS;
    const v4 = v0 + STREAM_CROSS - 1;
    expect(d.position[v0 * 3 + 1]).toBeCloseTo(r.baseY[i] + r.h[i], 4);
    const p = d.position;
    const width = Math.hypot(p[v4 * 3] - p[v0 * 3], p[v4 * 3 + 2] - p[v0 * 3 + 2]);
    expect(width).toBeCloseTo(2 * (r.waterHalf(i, r.h[i]) + RIBBON_MARGIN), 3);
    expect(d.flow[v0]).toBeCloseTo(r.u[i], 4);
    // The meltwater runs at full width from its source under the glacier (no fade-in).
    const w0 = Math.hypot(p[(STREAM_CROSS - 1) * 3] - p[0], p[(STREAM_CROSS - 1) * 3 + 2] - p[2]);
    expect(w0).toBeCloseTo(2 * (r.waterHalf(0, r.h[0]) + RIBBON_MARGIN), 3);
    expect(r.h[0]).toBeGreaterThan(0.8);
    expect(d.bounds.maxZ).toBeGreaterThan(d.bounds.minZ + 500);
    // A dry cell (no water) is collapsed: the bounds cover the wet part only.
    r.h[i] = 0;
    fillRibbon(r, streamSandbox.seaLevel, d);
    expect(d.position[v0 * 3]).toBe(d.position[v4 * 3]);
    // Every vertex was born long ago (the shader shows it at once).
    expect(d.birth[v0]).toBeLessThan(-1000);
  });

  it('builds a reservoir lake over its footprint, drawn at the lake level', () => {
    const w = new WaterSystem(terrain);
    const res = w.reservoirs[0];
    const d = buildLakeData(res, terrain);
    expect(d.vertexCount).toBe((res.cols + 2) * (res.rows + 2));
    // At least every lake cell, plus a ring for the shoreline.
    expect(d.indexCount / 6).toBeGreaterThan(res.vertexCount * 0.9);
    for (let v = 0; v < d.vertexCount; v++) expect(d.position[v * 3 + 1]).toBe(0);
    // u straddles the middle (no bank foam), v grows toward the dam.
    expect(Math.abs(d.uv[0] - 0.5)).toBeLessThan(0.01);
    const far = 0;
    const near = d.vertexCount - 1;
    const distTo = (v: number): number =>
      Math.hypot(d.position[v * 3] - res.cx, d.position[v * 3 + 2] - res.cz);
    expect(distTo(far) > distTo(near)).toBe(d.uv[far * 2 + 1] < d.uv[near * 2 + 1]);
  });
});

describe('flood damage hook', () => {
  it('releases standing vehicles caught in a flood through applyContact (the break path)', () => {
    const w = new WaterSystem(terrain);
    const res = w.reservoirs[0];
    const r = w.streams[0].reach;
    // A standing (anchored) truck and a standing house in the channel 30 m below the dam.
    const i = res.cell + 15;
    const proxy = (id: number, kind: ObstacleProxy['kind']): ObstacleProxy => ({
      id,
      kind,
      part: 'body',
      x: r.x[i],
      y: r.baseY[i] + 1,
      z: r.z[i],
      radius: 2,
      top: r.baseY[i] + 3,
      bottom: r.baseY[i],
      mass: 8,
      vx: 0,
      vy: 0,
      vz: 0,
      anchored: true,
      breakImpulse: 400,
      state: 'intact',
    });
    const near = [proxy(1, 'truck'), proxy(2, 'house')];
    const hits: IcebergContact[] = [];
    const stats: ObstacleStats = {
      knockedDown: 0,
      buildingsDestroyed: 0,
      treesFelled: 0,
      rocksMoved: 0,
      sweptByWater: 0,
    };
    const physics: PhysicsWorldApi = {
      step: () => {},
      proxiesNear: () => near,
      applyContact: (c: IcebergContact): ContactOutcome => {
        hits.push(c);
        return { obstacleId: c.obstacleId, kind: 'truck', result: 'uprooted' };
      },
      applyWaterForces: () => {},
      stats,
      drainEvents: () => [],
      dispose: () => {},
    };
    // Normal flow (the trickle below the intact dam) sweeps nothing.
    for (let k = 0; k < 120; k++) w.step(1 / 60, null, null, physics);
    expect(hits).toHaveLength(0);
    w.damBroken({ x: res.cx, y: res.floorY, z: res.cz });
    for (let k = 0; k < 60 * 8; k++) w.step(1 / 60, null, null, physics);
    // The truck once (a sweepable kind), the house never; along the flow, unbounded test impulse.
    expect(hits.map((h) => h.obstacleId)).toEqual([1]);
    expect(SWEEP.kinds).toContain('truck');
    expect(hits[0].testImpulse).toBe(Infinity);
    expect(hits[0].impulse.x * r.dirX[i] + hits[0].impulse.z * r.dirZ[i]).toBeGreaterThan(0);
    expect(w.swept.has(1)).toBe(true);
  });
});
