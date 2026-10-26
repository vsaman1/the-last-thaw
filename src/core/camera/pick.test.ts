import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../types';
import { createAnalyticTerrain, inclinedPlane } from '../testing/analyticTerrain';
import { createCameraPose } from './follow';
import { TapDetector, createRay, raycastGround, screenRay } from './pick';
import { RIVER_VIEW, orbitMinElevation } from './riverView';

const DEG = Math.PI / 180;

/** Camera at `pos` looking at `at` (the same lookAt convention the renderer uses). */
function pose(pos: Vec3, at: Vec3, fov = 50) {
  const p = createCameraPose();
  p.position = { ...pos };
  p.lookAt = { ...at };
  p.fov = fov;
  return p;
}

/** Independent projection (world up +Y): ndc of a world point for a pose. */
function project(q: Vec3, ps: ReturnType<typeof pose>, aspect: number): { x: number; y: number } {
  const p = ps.position;
  const f = { x: ps.lookAt.x - p.x, y: ps.lookAt.y - p.y, z: ps.lookAt.z - p.z };
  const fl = Math.hypot(f.x, f.y, f.z);
  f.x /= fl;
  f.y /= fl;
  f.z /= fl;
  const rl = Math.hypot(f.z, f.x);
  const r = { x: -f.z / rl, z: f.x / rl };
  const u = { x: -r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y };
  const tanV = Math.tan((ps.fov * DEG) / 2);
  const d = { x: q.x - p.x, y: q.y - p.y, z: q.z - p.z };
  const depth = d.x * f.x + d.y * f.y + d.z * f.z;
  return {
    x: (d.x * r.x + d.z * r.z) / (depth * tanV * aspect),
    y: (d.x * u.x + d.y * u.y + d.z * u.z) / (depth * tanV),
  };
}

describe('screenRay', () => {
  const ps = pose({ x: 10, y: 120, z: -40 }, { x: 0, y: 20, z: 80 });

  it('the centre of the screen looks straight along the view direction', () => {
    const ray = screenRay(ps, 50, 16 / 9, 0, 0, createRay());
    const f = { x: -10, y: -100, z: 120 };
    const fl = Math.hypot(f.x, f.y, f.z);
    expect(ray.ox).toBe(10);
    expect(ray.oy).toBe(120);
    expect(ray.oz).toBe(-40);
    expect(ray.dx).toBeCloseTo(f.x / fl, 12);
    expect(ray.dy).toBeCloseTo(f.y / fl, 12);
    expect(ray.dz).toBeCloseTo(f.z / fl, 12);
    expect(Math.hypot(ray.dx, ray.dy, ray.dz)).toBeCloseTo(1, 12);
  });

  it('round-trips with an independent projection at any screen position', () => {
    const aspect = 390 / 844;
    const ray = createRay();
    for (const [nx, ny] of [
      [0.7, -0.4],
      [-0.95, 0.9],
      [0.2, 0.99],
      [-0.5, -0.8],
    ]) {
      screenRay(ps, 70, aspect, nx, ny, ray);
      const q = { x: ray.ox + ray.dx * 300, y: ray.oy + ray.dy * 300, z: ray.oz + ray.dz * 300 };
      const n = project(q, { ...ps, fov: 70 }, aspect);
      expect(n.x).toBeCloseTo(nx, 9);
      expect(n.y).toBeCloseTo(ny, 9);
    }
  });

  it('right of centre points to the camera’s right', () => {
    // Looking along +Z from above: the camera's right is world -X (right = forward × up).
    const down = pose({ x: 0, y: 50, z: 0 }, { x: 0, y: 0, z: 60 });
    const ray = screenRay(down, 50, 1.5, 1, 0, createRay());
    expect(ray.dx).toBeLessThan(-0.3);
  });
});

describe('raycastGround', () => {
  const terrain = createAnalyticTerrain({ height: inclinedPlane(0.2, 200), width: 400, length: 900 });

  it('hits a slope where the analytic intersection is', () => {
    const ray = createRay();
    const ps = pose({ x: 30, y: 400, z: 100 }, { x: -20, y: 120, z: 420 });
    const hit = { x: 0, y: 0, z: 0 };
    for (const [nx, ny] of [
      [0, 0],
      [0.6, -0.5],
      [-0.8, 0.3],
    ]) {
      screenRay(ps, 50, 16 / 9, nx, ny, ray);
      expect(raycastGround(terrain, ray, 3000, hit)).toBe(true);
      // On the plane y = 200 - 0.2 z: hit.y matches the surface and lies on the ray.
      expect(hit.y).toBeCloseTo(200 - 0.2 * hit.z, 1);
      const t = (hit.x - ray.ox) / ray.dx;
      expect(ray.oy + ray.dy * t).toBeCloseTo(hit.y, 1);
      expect(t).toBeGreaterThan(0);
    }
  });

  it('misses when looking at the sky or beyond maxDist', () => {
    const ray = createRay();
    const hit = { x: 0, y: 0, z: 0 };
    screenRay(pose({ x: 0, y: 300, z: 100 }, { x: 0, y: 400, z: 300 }), 50, 1.6, 0, 0, ray);
    expect(raycastGround(terrain, ray, 3000, hit)).toBe(false);
    screenRay(pose({ x: 0, y: 300, z: 100 }, { x: 0, y: 150, z: 300 }), 50, 1.6, 0, 0, ray);
    expect(raycastGround(terrain, ray, 50, hit)).toBe(false);
  });

  it('stops at the first ridge in the way, not the valley behind it', () => {
    const ridge = createAnalyticTerrain({
      height: (_x, z) => 100 + 60 * Math.exp(-((z - 200) ** 2) / (2 * 6 ** 2)),
      width: 200,
      length: 400,
    });
    const ray = createRay();
    // Grazing ray at y = 140 heading along +Z: it clears the flat floor but meets the 160 m ridge.
    ray.ox = 0;
    ray.oy = 140;
    ray.oz = 0;
    ray.dx = 0;
    ray.dy = -0.01;
    ray.dz = 1;
    const l = Math.hypot(ray.dy, ray.dz);
    ray.dy /= l;
    ray.dz /= l;
    const hit = { x: 0, y: 0, z: 0 };
    expect(raycastGround(ridge, ray, 1000, hit)).toBe(true);
    expect(hit.z).toBeLessThan(200);
    expect(hit.z).toBeGreaterThan(180);
  });

  it('treats the sea surface as ground', () => {
    const sea = createAnalyticTerrain({
      height: inclinedPlane(0.2, 50),
      width: 200,
      length: 900,
      seaLevel: 0,
    });
    const ray = createRay();
    screenRay(pose({ x: 0, y: 120, z: 300 }, { x: 0, y: 0, z: 500 }), 50, 1.6, 0, 0, ray);
    const hit = { x: 0, y: 0, z: 0 };
    expect(raycastGround(sea, ray, 3000, hit)).toBe(true);
    expect(hit.y).toBeCloseTo(0, 1);
    expect(hit.z).toBeCloseTo(500, 0);
  });
});

describe('TapDetector', () => {
  it('reports a double tap for two quick taps close together, once', () => {
    const taps = new TapDetector(300, 30);
    expect(taps.tap(1000, 100, 100)).toBe(false);
    expect(taps.tap(1200, 110, 95)).toBe(true);
    // A third tap starts a new pair instead of re-triggering.
    expect(taps.tap(1350, 110, 95)).toBe(false);
    expect(taps.tap(1500, 112, 96)).toBe(true);
  });

  it('ignores slow or distant second taps, and forgets after reset', () => {
    const taps = new TapDetector(300, 30);
    taps.tap(0, 0, 0);
    expect(taps.tap(400, 0, 0)).toBe(false); // too slow (but becomes the new first tap)
    expect(taps.tap(500, 80, 0)).toBe(false); // too far
    taps.reset();
    expect(taps.tap(550, 80, 0)).toBe(false);
  });
});

describe('orbitMinElevation', () => {
  it('is steep when far (overview), relaxed when close, and never decreases with distance', () => {
    expect(orbitMinElevation(5000)).toBeCloseTo(RIVER_VIEW.minElevation, 9);
    expect(orbitMinElevation(RIVER_VIEW.farDistance)).toBeCloseTo(RIVER_VIEW.minElevation, 9);
    expect(orbitMinElevation(RIVER_VIEW.minDistance)).toBeCloseTo(RIVER_VIEW.minElevationClose, 9);
    expect(RIVER_VIEW.minElevationClose).toBeLessThan(0.25);
    let prev = 0;
    for (let d = 5; d < 2000; d *= 1.1) {
      const e = orbitMinElevation(d);
      expect(e).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = e;
    }
    expect(orbitMinElevation(Number.NaN)).toBe(RIVER_VIEW.minElevation);
  });
});
