import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createAnalyticTerrain, inclinedPlane } from '../../testing/analyticTerrain';
import type { ObstacleKind, ObstaclePlacement, Terrain, Vec3 } from '../../types';
import { momentumBreakSpeed } from '../catalog';
import { getGeom, scaledPoints } from '../shapes';
import type { BodySpec } from '../specs';
import { buildObstacleSpecs } from '../spawn';
import { structureDef } from './index';

/**
 * Story Mode props (apartmentBlock, pumpjack, oilRig, pipeline, monument): documented masses, break
 * speeds and modes, heights and footprints, the rig standing in water of any depth, and the pipeline
 * laid out across the valley. The shared kit suite (./structures.test.ts) additionally builds every
 * kind on flat and sloped ground at two scales and compares colliders with meshes.
 */

const SINGLE = ['apartmentBlock', 'pumpjack', 'oilRig', 'monument'] as const satisfies readonly ObstacleKind[];
type Single = (typeof SINGLE)[number];
type Height = (x: number, z: number) => number;

const flat =
  (h: number) =>
  (): number =>
    h;

function terrainWith(obstacles: ObstaclePlacement[], height: Height = flat(5), seaLevel?: number): Terrain {
  return createAnalyticTerrain({ height, cellSize: 2, seaLevel, level: { obstacles } });
}

function specsOf(
  kind: ObstacleKind,
  opts: Partial<ObstaclePlacement> = {},
  height: Height = flat(5),
  seed = 7,
  seaLevel?: number,
): BodySpec[] {
  return buildObstacleSpecs(terrainWith([{ kind, s: 80, d: 0, yaw: 0, ...opts }], height, seaLevel), seed);
}

const _q = new Quaternion();
const _p = new Quaternion();
const _v = new Vector3();

/** World-space vertices of the parts of a spec that pass `keep` (default: colliders only). */
function worldPoints(spec: BodySpec, keep: (p: BodySpec['parts'][number]) => boolean = (p) => !p.decor): Vec3[] {
  const out: Vec3[] = [];
  _q.set(spec.rotation.x, spec.rotation.y, spec.rotation.z, spec.rotation.w);
  for (const part of spec.parts) {
    if (!keep(part)) continue;
    const pts = scaledPoints(getGeom(part.geom), part.scale);
    _p.set(part.rotation.x, part.rotation.y, part.rotation.z, part.rotation.w);
    for (let i = 0; i < pts.length; i += 3) {
      _v.set(pts[i], pts[i + 1], pts[i + 2]).applyQuaternion(_p);
      _v.set(_v.x + part.offset.x, _v.y + part.offset.y, _v.z + part.offset.z).applyQuaternion(_q);
      out.push({ x: _v.x + spec.position.x, y: _v.y + spec.position.y, z: _v.z + spec.position.z });
    }
  }
  return out;
}

const all = (): boolean => true;
const named = (name: string) => (p: BodySpec['parts'][number]) => !p.decor && p.name === name;

function yRange(points: readonly Vec3[]): [number, number] {
  return [Math.min(...points.map((p) => p.y)), Math.max(...points.map((p) => p.y))];
}

const colliders = (s: BodySpec): number => s.parts.filter((p) => !p.decor).length;
const pieces = (s: BodySpec): number => new Set(s.parts.filter((p) => !p.decor).map((p) => p.piece)).size;

/** What each file header documents (one anchored shattering body each). */
const DOCS: Record<Single, { mass: number; breakSpeed: number; colliders: number; pieces: number; height: [number, number] }> = {
  // Antenna tip 30 m (roof 24.4 m, lift housings to 27 m).
  apartmentBlock: { mass: 110, breakSpeed: 40, colliders: 14, pieces: 14, height: [29.5, 30.5] },
  // Horse head top ~7 m.
  pumpjack: { mass: 14, breakSpeed: 14, colliders: 9, pieces: 4, height: [6.5, 7.5] },
  // On land: deck 6 m up, derrick crown 24 m.
  oilRig: { mass: 60, breakSpeed: 16, colliders: 8, pieces: 8, height: [23.5, 24.5] },
  // Obelisk 13.7 m or bronze figure ~7.5 m: checked per variant below.
  monument: { mass: 40, breakSpeed: 16, colliders: 6, pieces: 3, height: [7, 14] },
};

describe('props: documented numbers', () => {
  for (const kind of SINGLE) {
    for (const scale of [1, 1.4]) {
      it(`${kind} (scale ${scale}): one anchored shattering body, mass (x s^3), break speed (x s^2), height`, () => {
        const doc = DOCS[kind];
        const specs = specsOf(kind, { scale });
        expect(specs.length).toBe(1);
        const [s] = specs;
        expect(s.part).toBe(kind);
        expect(s.anchored).toBe(true);
        expect(s.breakMode).toBe('shatter');
        expect(s.mass / scale ** 3).toBeCloseTo(doc.mass, 4);
        expect(momentumBreakSpeed(s.breakImpulse, 30) / scale ** 2).toBeCloseTo(doc.breakSpeed, 6);
        expect(colliders(s)).toBeLessThanOrEqual(doc.colliders);
        expect(pieces(s)).toBe(doc.pieces);
        const h = (yRange(worldPoints(s, all))[1] - 5) / scale;
        expect(h).toBeGreaterThan(doc.height[0]);
        expect(h).toBeLessThan(doc.height[1]);
      });
    }
    it(`${kind}: everything near the ground lies within its footprint (flat, 0.12 slope)`, () => {
      for (const height of [flat(5), inclinedPlane(0.12)]) {
        for (const scale of [1, 1.4]) {
          const r = (structureDef(kind)?.footprint ?? 0) * scale;
          const t = terrainWith([], height);
          for (const p of specsOf(kind, { scale }, height).flatMap((s) => worldPoints(s, all))) {
            if (p.y - t.heightAt(p.x, p.z) > 3 * scale) continue;
            expect(Math.hypot(p.x, p.z - 80)).toBeLessThan(r + 1e-6);
          }
        }
      }
    });
  }

  it('the apartment block only falls to big icebergs; the others break to a fast 30 t one', () => {
    const block = specsOf('apartmentBlock')[0];
    // Above the 34 m/s speed cap for 30 t; 60 t at 20 m/s, 100 t at 12 m/s.
    expect(momentumBreakSpeed(block.breakImpulse, 30)).toBeGreaterThan(34);
    expect(momentumBreakSpeed(block.breakImpulse, 60)).toBeCloseTo(20);
    expect(momentumBreakSpeed(block.breakImpulse, 100)).toBeCloseTo(12);
    for (const kind of ['pumpjack', 'oilRig', 'monument'] as const) {
      expect(momentumBreakSpeed(specsOf(kind)[0].breakImpulse, 30), kind).toBeLessThan(20);
    }
    expect(structureDef('apartmentBlock')?.building).toBe(true);
  });

  it('monument: an obelisk on two in three placements, otherwise a bronze figure', () => {
    const variants = { obelisk: 0, statue: 0 };
    for (let seed = 1; seed <= 30; seed++) {
      const [s] = specsOf('monument', {}, flat(5), seed);
      const isObelisk = s.parts.some((p) => p.name === 'obelisk');
      variants[isObelisk ? 'obelisk' : 'statue']++;
      const h = yRange(worldPoints(s, all))[1] - 5;
      if (isObelisk) expect(h).toBeCloseTo(13.66, 1);
      else expect(h).toBeGreaterThan(7);
      if (!isObelisk) expect(h).toBeLessThan(8);
      expect(s.mass).toBeCloseTo(40, 6);
    }
    expect(variants.obelisk).toBeGreaterThan(variants.statue);
    expect(variants.statue).toBeGreaterThan(0);
  });
});

describe('oilRig: stands in water of any depth', () => {
  for (const [label, height] of [
    ['flat sea floor', flat(5)],
    ['sloping sea floor', inclinedPlane(0.12)],
  ] as const) {
    it(`legs reach from the sea floor to a deck 6 m above the water (${label}, 12 m deep at the origin)`, () => {
      const sea = height(0, 80) + 12;
      for (const scale of [1, 1.4]) {
        const [rig] = specsOf('oilRig', { scale }, height, 7, sea);
        const t = terrainWith([], height, sea);
        const legs = rig.parts.filter((p) => !p.decor && p.name === 'leg');
        expect(legs.length).toBe(4);
        const deck = yRange(worldPoints(rig, named('deck')));
        expect(deck[0]).toBeCloseTo(sea + 6 * scale, 4);
        // Each leg's foot is in the sea floor right under it (driven 0.3 m in), its top under the deck.
        const legPts = worldPoints(rig, named('leg'));
        const foot = Math.min(...legPts.map((p) => p.y - t.heightAt(p.x, p.z)));
        expect(foot).toBeGreaterThan(-0.4 * scale - 0.1);
        expect(foot).toBeLessThan(0);
        expect(Math.max(...legPts.map((p) => p.y))).toBeLessThan(deck[0]);
        expect(Math.max(...legPts.map((p) => p.y))).toBeGreaterThan(deck[0] - 0.1);
      }
    });
  }
});

describe('pipeline: a raised pipe across the valley', () => {
  it('splits its span into ~8 m segments of 5 t (6 t with the end support), breaking above 8 m/s', () => {
    for (const span of [16, 40, 61]) {
      const specs = specsOf('pipeline', { span });
      expect(specs.length).toBe(Math.max(1, Math.round(span / 8)));
      specs.forEach((s, i) => {
        expect(s.part).toBe('pipeline');
        expect(s.anchored).toBe(true);
        expect(s.mass).toBeCloseTo(i === specs.length - 1 ? 6 : 5, 6);
        expect(momentumBreakSpeed(s.breakImpulse, 30)).toBeCloseTo(8, 6);
      });
      // Pipe lengths add up to the span (each a hair short so neighbours never overlap).
      const xs = specs.flatMap((s) => worldPoints(s, named('pipe')).map((p) => p.x));
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(span - 0.05);
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(span + 0.05);
    }
  });

  for (const [label, height] of [
    ['flat', flat(5)],
    ['0.12 slope across', (x: number): number => 5 + 0.12 * x],
  ] as const) {
    it(`the pipe rides ~1.8 m clear of the ground on supports that stand on it (${label})`, () => {
      const t = terrainWith([], height);
      for (const s of specsOf('pipeline', { span: 40 }, height)) {
        const pipe = worldPoints(s, named('pipe'));
        const clear = Math.min(...pipe.map((p) => p.y - t.heightAt(p.x, p.z)));
        expect(clear).toBeGreaterThan(1.7);
        expect(clear).toBeLessThan(1.9);
        const supports = worldPoints(s, named('support'));
        const foot = Math.min(...supports.map((p) => p.y - t.heightAt(p.x, p.z)));
        expect(foot).toBeLessThan(0);
        expect(foot).toBeGreaterThan(-0.1);
        // Each crossbeam stops just under the pipe end it carries: separate pieces never start
        // inside each other.
        for (const top of supports) {
          const near = pipe.filter((q) => Math.abs(q.x - top.x) < 1).map((q) => q.y);
          if (near.length) expect(top.y).toBeLessThan(Math.min(...near));
        }
      }
    });
  }
});
