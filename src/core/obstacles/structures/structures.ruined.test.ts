/**
 * The 'ruined' look (./ruin.ts): house, chalet and barn built as flood-wrecked shells. Checked like
 * every kit build (parts, masses, colliders that match the render mesh, standing on the ground) and
 * against the intact building: fewer colliders (the gone roof and wall are not there to hit), lighter,
 * weaker, the flood marks and broken windows present, no chimney smoke.
 */
import { describe, expect, it } from 'vitest';
import { createAnalyticTerrain, inclinedPlane } from '../../testing/analyticTerrain';
import type { ObstacleKind, ObstaclePlacement, Terrain } from '../../types';
import { validatePlacements } from '../../terrain/validate';
import { getGeom, scaledPoints } from '../shapes';
import { partsBounds, rotateVec, type BodySpec } from '../specs';
import { buildObstacleSpecs } from '../spawn';
import { structureDef, structureDefs } from './index';
import { RUIN, weathered } from './ruin';

const flat = () => 5;

function terrainWith(obstacles: ObstaclePlacement[], height: (x: number, z: number) => number = flat): Terrain {
  return createAnalyticTerrain({ height, cellSize: 2, level: { obstacles } });
}

const RUINABLE: readonly ObstacleKind[] = ['house', 'chalet', 'barn'];

/** Collider (non-decor) bounding box of a spec in world space. */
function worldBounds(spec: BodySpec) {
  const { min, max } = partsBounds(spec.parts);
  const lo = { x: Infinity, y: Infinity, z: Infinity };
  const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
  const c = { x: 0, y: 0, z: 0 };
  for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
    rotateVec(spec.rotation, x, y, z, c);
    lo.x = Math.min(lo.x, c.x + spec.position.x);
    lo.y = Math.min(lo.y, c.y + spec.position.y);
    lo.z = Math.min(lo.z, c.z + spec.position.z);
    hi.x = Math.max(hi.x, c.x + spec.position.x);
    hi.y = Math.max(hi.y, c.y + spec.position.y);
    hi.z = Math.max(hi.z, c.z + spec.position.z);
  }
  return { min: lo, max: hi };
}

describe('the ruined look', () => {
  it('is offered by exactly the house, the chalet and the barn', () => {
    const offering = structureDefs()
      .filter((d) => d.variants?.includes('ruined'))
      .map((d) => d.kind)
      .sort();
    expect(offering).toEqual([...RUINABLE].sort());
  });

  for (const kind of RUINABLE) {
    for (const [label, height] of [['flat', flat], ['0.12 slope', inclinedPlane(0.12)]] as const) {
      for (const scale of [1, 0.8]) {
        it(`${kind} (${label}, scale ${scale}): a valid build whose colliders are the parts it shows`, () => {
          const t = terrainWith([{ kind, s: 80, d: 3, scale, variant: 'ruined' }], height);
          const specs = buildObstacleSpecs(t, 7);
          expect(specs.length).toBe(1);
          expect(JSON.stringify(buildObstacleSpecs(t, 7))).toBe(JSON.stringify(specs));
          const [spec] = specs;
          expect(spec.kind).toBe(kind);
          expect(spec.parts.reduce((a, p) => a + p.mass, 0)).toBeCloseTo(spec.mass, 6);
          for (const p of spec.parts) {
            if (p.decor) expect(p.mass).toBe(0);
            else expect(p.mass).toBeGreaterThan(0);
            const g = getGeom(p.geom);
            const pts = scaledPoints(g, p.scale);
            const pos = g.mesh.positions;
            const s = [p.scale.x, p.scale.y, p.scale.z];
            for (let k = 0; k < 3; k++) {
              let cmin = Infinity;
              let cmax = -Infinity;
              let rmin = Infinity;
              let rmax = -Infinity;
              for (let i = k; i < pts.length; i += 3) {
                cmin = Math.min(cmin, pts[i]);
                cmax = Math.max(cmax, pts[i]);
              }
              for (let i = k; i < pos.length; i += 3) {
                rmin = Math.min(rmin, pos[i] * s[k]);
                rmax = Math.max(rmax, pos[i] * s[k]);
              }
              const tol = 0.03 * Math.max(1, ...s);
              expect(Math.abs(rmin - cmin)).toBeLessThan(tol);
              expect(Math.abs(rmax - cmax)).toBeLessThan(tol);
            }
          }
          const b = worldBounds(spec);
          const corners = [t.heightAt(b.min.x, b.min.z), t.heightAt(b.max.x, b.min.z), t.heightAt(b.min.x, b.max.z), t.heightAt(b.max.x, b.max.z)];
          expect(b.min.y).toBeGreaterThan(Math.min(...corners) - 0.6 * scale);
          expect(b.min.y).toBeLessThan(Math.max(...corners) + 0.15);
        });
      }
    }

    it(`${kind}: lighter, weaker and with fewer colliders than the intact one; flood marks, broken windows, no smoke`, () => {
      for (let seed = 1; seed <= 12; seed++) {
        const t = terrainWith([
          { kind, s: 80, d: 3 },
          { kind, s: 140, d: 3, variant: 'ruined' },
        ]);
        const [intact, ruin] = buildObstacleSpecs(t, seed);
        const colliders = (s: BodySpec) => s.parts.filter((p) => !p.decor).length;
        expect(colliders(ruin), `seed ${seed}`).toBeLessThan(colliders(intact));
        expect(ruin.mass).toBeLessThan(intact.mass * RUIN.massShare);
        expect(ruin.mass).toBeGreaterThan(intact.mass * RUIN.massShare * 0.4);
        expect(ruin.breakImpulse).toBeCloseTo(intact.breakImpulse * RUIN.strength, 6);
        expect(ruin.anchored).toBe(true);
        expect(ruin.building).toBe(true);
        expect(ruin.parts.some((p) => p.plume)).toBe(false);
        expect(ruin.parts.filter((p) => p.decor && p.color === RUIN.tide).length).toBeGreaterThanOrEqual(2);
        expect(ruin.parts.filter((p) => p.decor && p.color === RUIN.broken).length).toBeGreaterThanOrEqual(2);
        // The roof that remains sags: each roof piece is an intact one sunk by RUIN.sagDrop and tilted.
        const roofs = (s: BodySpec) => s.parts.filter((p) => !p.decor && p.name === 'roof');
        expect(roofs(ruin).length, `seed ${seed}`).toBeGreaterThan(0);
        expect(roofs(ruin).length).toBeLessThan(roofs(intact).length);
        for (const p of roofs(ruin)) {
          const was = roofs(intact).find((q) => Math.abs(q.offset.x - p.offset.x) < 1e-6 && Math.abs(q.offset.z - p.offset.z) < 1e-6);
          expect(was, `seed ${seed}`).toBeDefined();
          if (!was) continue;
          expect(was.offset.y - p.offset.y).toBeCloseTo(RUIN.sagDrop, 6);
          expect(Math.abs(was.rotation.w - p.rotation.w) + Math.abs(was.rotation.x - p.rotation.x) + Math.abs(was.rotation.z - p.rotation.z)).toBeGreaterThan(1e-3);
        }
        // Weathered: no intact colour survives on a collider.
        const intactColours = new Set(intact.parts.filter((p) => !p.decor).map((p) => p.color));
        for (const p of ruin.parts.filter((q) => !q.decor)) expect(intactColours.has(p.color)).toBe(false);
      }
    });
  }

  it('weathers colours toward a muddy grey, darker than they were', () => {
    for (const c of [0xffffff, 0x9b2d20, 0x2f6b3a, 0xf2eee4]) {
      const w = weathered(c);
      const lum = (x: number) => 0.3 * ((x >> 16) & 255) + 0.59 * ((x >> 8) & 255) + 0.11 * (x & 255);
      expect(lum(w)).toBeLessThan(lum(c));
    }
  });

  it('a kind without the look builds intact, and the placement check says so', () => {
    expect(structureDef('tank')?.variants).toBeUndefined();
    const t = terrainWith([
      { kind: 'tank', s: 80, d: 0 },
      { kind: 'tank', s: 140, d: 0, variant: 'ruined' },
    ]);
    const [a, b] = buildObstacleSpecs(t, 3);
    expect(b.parts.length).toBe(a.parts.length);
    const issues = validatePlacements(t);
    expect(issues.filter((i) => i.problem.includes("'ruined'")).map((i) => i.index)).toEqual([1]);
  });
});
