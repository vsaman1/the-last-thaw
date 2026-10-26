import { describe, expect, it } from 'vitest';
import { headingToDir, rightOf, steerToYawDelta, wrapAngle, dirToHeading } from './math';
import { buildGrid, sampleGradient, sampleHeight } from './heightGrid';
import { createAnalyticTerrain, inclinedPlane } from './testing/analyticTerrain';
import { createRng, fbm2 } from './rng';

describe('heading convention', () => {
  it('heading 0 faces +Z and right of +Z is -X', () => {
    const d = headingToDir(0);
    expect(d.x).toBeCloseTo(0);
    expect(d.z).toBeCloseTo(1);
    const r = rightOf(d.x, d.z);
    expect(r.x).toBeCloseTo(-1);
    expect(r.z).toBeCloseTo(0);
  });

  it('positive steer rotates the direction toward its right-hand side', () => {
    const h0 = 0.3;
    const d0 = headingToDir(h0);
    const r = rightOf(d0.x, d0.z);
    const d1 = headingToDir(h0 + steerToYawDelta(1, 1, 0.1));
    expect(d1.x * r.x + d1.z * r.z).toBeGreaterThan(0);
  });

  it('dirToHeading inverts headingToDir and wrapAngle stays in [-π, π)', () => {
    for (const h of [-3, -1, 0, 0.5, 2.9]) {
      const d = headingToDir(h);
      expect(dirToHeading(d.x, d.z)).toBeCloseTo(h);
    }
    expect(Math.abs(wrapAngle(3 * Math.PI))).toBeCloseTo(Math.PI);
    expect(Math.abs(wrapAngle(7))).toBeLessThanOrEqual(Math.PI);
  });
});

describe('height grid sampling', () => {
  it('reproduces a plane exactly, including its gradient', () => {
    const g = buildGrid({ minX: 0, maxX: 10, minZ: 0, maxZ: 10 }, 1, (x, z) => 2 * x - 3 * z + 5);
    for (const [x, z] of [
      [0.3, 0.7],
      [4.9, 2.1],
      [9.5, 9.5],
    ]) {
      expect(sampleHeight(g, x, z)).toBeCloseTo(2 * x - 3 * z + 5, 4);
      const gr = sampleGradient(g, x, z);
      expect(gr.dx).toBeCloseTo(2, 4);
      expect(gr.dz).toBeCloseTo(-3, 4);
    }
  });

  it('is continuous across cell and triangle boundaries', () => {
    const g = buildGrid({ minX: 0, maxX: 10, minZ: 0, maxZ: 10 }, 1, (x, z) => Math.sin(x) * 3 + z * z * 0.1);
    for (let i = 0; i < 200; i++) {
      const x = 0.5 + (i / 200) * 8;
      const z = 3.3 + Math.sin(i) * 2;
      expect(Math.abs(sampleHeight(g, x + 1e-4, z) - sampleHeight(g, x, z))).toBeLessThan(1e-2);
    }
  });
});

describe('analytic terrain + rng', () => {
  it('builds a descending plane with course coords s=z, d=-x', () => {
    const t = createAnalyticTerrain({ height: inclinedPlane(0.2) });
    expect(t.heightAt(0, 100)).toBeCloseTo(80, 3);
    expect(t.course.project(-5, 50)).toEqual({ s: 50, d: 5 });
    expect(t.course.toWorld(50, 5).x).toBe(-5);
  });

  it('rng and noise are deterministic', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(fbm2(1.3, 2.7, 9)).toBe(fbm2(1.3, 2.7, 9));
  });
});
