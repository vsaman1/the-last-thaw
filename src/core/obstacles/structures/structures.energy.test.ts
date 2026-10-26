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
 * Town and energy structures (church, waterTower, lighthouse, pylon, windTurbine, coolingTower,
 * smokestack): documented masses, break speeds and break modes, dimensions, footprints, and the
 * exact stacking of resting parts. The shared kit suite (./structures.test.ts) additionally builds
 * every kind on flat and sloped ground at two scales and compares colliders with meshes.
 */

const KINDS = [
  'church',
  'waterTower',
  'lighthouse',
  'pylon',
  'windTurbine',
  'coolingTower',
  'smokestack',
] as const satisfies readonly ObstacleKind[];
type Kind = (typeof KINDS)[number];

const flat =
  (h: number) =>
  (): number =>
    h;

type Height = (x: number, z: number) => number;

function terrainWith(obstacles: ObstaclePlacement[], height: Height = flat(5)): Terrain {
  return createAnalyticTerrain({ height, cellSize: 2, level: { obstacles } });
}

function specsOf(
  kind: Kind,
  opts: Partial<ObstaclePlacement> = {},
  height: Height = flat(5),
  seed = 7,
): BodySpec[] {
  return buildObstacleSpecs(terrainWith([{ kind, s: 80, d: 0, yaw: 0, ...opts }], height), seed);
}

const _q = new Quaternion();
const _p = new Quaternion();
const _v = new Vector3();

/** World-space vertices of a spec's parts (colliders only unless withDecor). */
function worldPoints(spec: BodySpec, withDecor = false): Vec3[] {
  const out: Vec3[] = [];
  _q.set(spec.rotation.x, spec.rotation.y, spec.rotation.z, spec.rotation.w);
  for (const part of spec.parts) {
    if (part.decor && !withDecor) continue;
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

function bounds(points: readonly Vec3[]): { min: Vec3; max: Vec3 } {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of points) {
    min.x = Math.min(min.x, p.x);
    min.y = Math.min(min.y, p.y);
    min.z = Math.min(min.z, p.z);
    max.x = Math.max(max.x, p.x);
    max.y = Math.max(max.y, p.y);
    max.z = Math.max(max.z, p.z);
  }
  return { min, max };
}

const colliders = (s: BodySpec): number => s.parts.filter((p) => !p.decor).length;
const pieces = (s: BodySpec): number => new Set(s.parts.filter((p) => !p.decor).map((p) => p.piece)).size;
const byPart = (specs: BodySpec[], part: string): BodySpec[] => specs.filter((s) => s.part === part);

interface BodyDoc {
  part: string;
  count: number;
  /** Total mass of these bodies at scale 1 (t). */
  mass: number;
  /** Break speed for a 30 t iceberg (m/s); undefined = resting, never breaks itself. */
  breakSpeed?: number;
  mode: BodySpec['breakMode'];
  maxColliders: number;
}

/** What each file header documents. */
const DOCS: Record<Kind, { height: [number, number]; bodies: BodyDoc[] }> = {
  church: {
    height: [29, 32],
    bodies: [
      { part: 'church', count: 2, mass: 44, breakSpeed: 22, mode: 'shatter', maxColliders: 6 },
      { part: 'churchTower', count: 1, mass: 30, breakSpeed: 20, mode: 'uproot', maxColliders: 3 },
    ],
  },
  waterTower: {
    height: [22, 24],
    bodies: [
      { part: 'leg', count: 4, mass: 10, breakSpeed: 12, mode: 'uproot', maxColliders: 1 },
      { part: 'riser', count: 1, mass: 1.2, breakSpeed: 6, mode: 'uproot', maxColliders: 1 },
      { part: 'deck', count: 1, mass: 24, mode: 'none', maxColliders: 2 },
    ],
  },
  lighthouse: {
    height: [30, 33],
    bodies: [
      { part: 'lighthouse', count: 1, mass: 62, breakSpeed: 25, mode: 'uproot', maxColliders: 7 },
      { part: 'deck', count: 1, mass: 8, mode: 'none', maxColliders: 2 },
    ],
  },
  pylon: {
    height: [19.5, 22],
    bodies: [{ part: 'pylon', count: 1, mass: 20, breakSpeed: 18, mode: 'uproot', maxColliders: 6 }],
  },
  windTurbine: {
    // The top blade is within 60° of vertical: hub 39.9 m + 17.1 m x (0.5 .. 1).
    height: [48, 57.5],
    bodies: [
      { part: 'windTurbine', count: 1, mass: 36, breakSpeed: 20, mode: 'uproot', maxColliders: 2 },
      { part: 'deck', count: 1, mass: 14, mode: 'none', maxColliders: 5 },
    ],
  },
  coolingTower: {
    height: [41.5, 43],
    bodies: [
      { part: 'coolingTower', count: 1, mass: 120, breakSpeed: 45, mode: 'shatter', maxColliders: 30 },
    ],
  },
  smokestack: {
    height: [40.5, 42.5],
    bodies: [
      { part: 'smokestack', count: 1, mass: 70, breakSpeed: 30, mode: 'uproot', maxColliders: 12 },
      { part: 'deck', count: 1, mass: 15, mode: 'none', maxColliders: 4 },
    ],
  },
};

describe('energy & town structures: documented numbers', () => {
  for (const kind of KINDS) {
    for (const scale of [1, 1.4]) {
      it(`${kind} (scale ${scale}): bodies, masses (x s^3), break speeds (x s^2), modes and height`, () => {
        const def = structureDef(kind);
        expect(def).toBeDefined();
        const specs = specsOf(kind, { scale });
        const doc = DOCS[kind];
        expect(specs.length).toBe(doc.bodies.reduce((a, b) => a + b.count, 0));
        for (const b of doc.bodies) {
          const group = byPart(specs, b.part);
          expect(group.length, b.part).toBe(b.count);
          const mass = group.reduce((a, s) => a + s.mass, 0);
          expect(mass / scale ** 3, b.part).toBeCloseTo(b.mass, 4);
          for (const s of group) {
            expect(s.breakMode, b.part).toBe(b.mode);
            expect(colliders(s), b.part).toBeLessThanOrEqual(b.maxColliders);
            if (b.breakSpeed === undefined) {
              expect(s.anchored).toBe(false);
              expect(s.breakImpulse).toBe(Infinity);
            } else {
              expect(s.anchored).toBe(true);
              const v30 = momentumBreakSpeed(s.breakImpulse, 30) / scale ** 2;
              expect(v30, b.part).toBeCloseTo(b.breakSpeed, 6);
            }
          }
        }
        const all = bounds(specs.flatMap((s) => worldPoints(s, true)));
        const h = (all.max.y - 5) / scale;
        expect(h).toBeGreaterThan(doc.height[0]);
        expect(h).toBeLessThan(doc.height[1]);
      });
    }
  }

  it('heavier icebergs break them at proportionally lower speeds (momentum rule)', () => {
    const cooling = specsOf('coolingTower')[0];
    expect(momentumBreakSpeed(cooling.breakImpulse, 30)).toBeCloseTo(45);
    expect(momentumBreakSpeed(cooling.breakImpulse, 100)).toBeCloseTo(13.5);
    expect(momentumBreakSpeed(cooling.breakImpulse, 220)).toBeLessThan(6.2);
    // A 30 t iceberg cannot reach 45 m/s (speed cap 34): only a grown or big iceberg breaks it.
    const [church] = byPart(specsOf('church'), 'church');
    expect(momentumBreakSpeed(church.breakImpulse, 100)).toBeCloseTo(6.6);
  });

  for (const kind of KINDS) {
    it(`${kind}: everything near the ground lies within its footprint (flat, 0.12 slope)`, () => {
      for (const height of [flat(5), inclinedPlane(0.12)]) {
        for (const scale of [1, 1.4]) {
          const r = (structureDef(kind)?.footprint ?? 0) * scale;
          const t = terrainWith([], height);
          for (const p of specsOf(kind, { scale }, height).flatMap((s) => worldPoints(s, true))) {
            if (p.y - t.heightAt(p.x, p.z) > 3 * scale) continue;
            expect(Math.hypot(p.x, p.z - 80)).toBeLessThan(r + 1e-6);
          }
        }
      }
    });
  }
});

describe('energy & town structures: layout and stacking', () => {
  for (const [label, height] of [
    ['flat', flat(5)],
    ['0.12 slope', inclinedPlane(0.12)],
  ] as const) {
    it(`resting tops sit exactly on what carries them (${label})`, () => {
      for (const kind of ['lighthouse', 'smokestack'] as const) {
        const specs = specsOf(kind, { scale: 1.4 }, height);
        const [column] = specs.filter((s) => s.anchored);
        const [top] = byPart(specs, 'deck');
        const columnTop = bounds(worldPoints(column)).max.y;
        expect(bounds(worldPoints(top)).min.y, kind).toBeCloseTo(columnTop, 5);
        // Both stand upright (yaw only), so the top is centred on the column.
        const off = Math.hypot(top.position.x - column.position.x, top.position.z - column.position.z);
        expect(off).toBeLessThan(1e-6);
      }
      const tower = specsOf('waterTower', {}, height);
      const [tank] = byPart(tower, 'deck');
      const t = terrainWith([], height);
      for (const leg of byPart(tower, 'leg')) {
        const b = bounds(worldPoints(leg));
        // Every leg carries the ring girder and stands in the ground under it.
        expect(b.max.y).toBeCloseTo(tank.position.y, 5);
        expect(b.min.y).toBeLessThan(t.heightAt(leg.position.x, leg.position.z));
      }
      // The tank is level and its bulge clears the riser pipe.
      expect(Math.abs(tank.rotation.x) + Math.abs(tank.rotation.z)).toBeLessThan(1e-9);
      const [riser] = byPart(tower, 'riser');
      expect(bounds(worldPoints(riser)).max.y).toBeLessThan(bounds(worldPoints(tank)).min.y);
    });
  }

  it('water tower: four legs 6.4 m apart (trunk proxies the iceberg can pass between), tank 14 m up', () => {
    const specs = specsOf('waterTower');
    const legs = byPart(specs, 'leg');
    for (const leg of legs) {
      expect(leg.proxyMode).toBe('trunk');
      expect(leg.trunkRadius).toBeLessThan(0.5);
      // Knocked out at the iceberg's contact height, so the foot goes and the top drops away.
      expect(leg.hitHeight).toBeLessThan(1.5);
    }
    const xs = legs.map((l) => l.position.x).sort((a, b) => a - b);
    expect(xs[3] - xs[0]).toBeCloseTo(6.4, 6);
    const [tank] = byPart(specs, 'deck');
    expect(tank.position.y - 5).toBeCloseTo(14, 6);
  });

  it('cooling tower: a hollow shell of 30 non-overlapping panels in 3 bands, 3 shape keys', () => {
    const [tower] = specsOf('coolingTower');
    const panels = tower.parts.filter((p) => !p.decor);
    expect(panels.length).toBe(30);
    expect(pieces(tower)).toBe(30);
    expect(new Set(panels.map((p) => p.geom)).size).toBe(3);
    expect(tower.proxyMode).toBe('trunk');
    expect(tower.trunkRadius + 0.25).toBeGreaterThan(12.5);
    expect(tower.trunkRadius + 0.25).toBeLessThan(13.1);
    // Each panel's vertices stay inside its own 36° wedge (so pieces never start interpenetrating),
    // and nothing comes near the axis (the shell is hollow and open at the top).
    _q.set(tower.rotation.x, tower.rotation.y, tower.rotation.z, tower.rotation.w);
    for (const part of panels) {
      _p.set(part.rotation.x, part.rotation.y, part.rotation.z, part.rotation.w);
      const centre = Math.atan2(part.offset.x, part.offset.z);
      const pts = scaledPoints(getGeom(part.geom), part.scale);
      for (let i = 0; i < pts.length; i += 3) {
        _v.set(pts[i], pts[i + 1], pts[i + 2]).applyQuaternion(_p);
        const x = _v.x + part.offset.x;
        const z = _v.z + part.offset.z;
        let da = Math.atan2(x, z) - centre;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        expect(Math.abs(da)).toBeLessThan(Math.PI / 10);
        expect(Math.hypot(x, z)).toBeGreaterThan(6.5);
      }
    }
  });

  it('church: two nave halves (5 and 6 pieces) and a tower with spire facing the player by default', () => {
    const t = terrainWith([]);
    const specs = buildObstacleSpecs(terrainWith([{ kind: 'church', s: 80, d: 0 }]), 3);
    const halves = byPart(specs, 'church');
    expect(halves.map(pieces).sort()).toEqual([5, 6]);
    expect(halves.every((h) => h.building && h.proxyMode === 'footprint')).toBe(true);
    const [tower] = byPart(specs, 'churchTower');
    const tb = bounds(worldPoints(tower));
    const nb = bounds(halves.flatMap((h) => worldPoints(h)));
    // Default yaw: facade and tower up-course (toward the oncoming player).
    expect((tb.min.z + tb.max.z) / 2).toBeLessThan((nb.min.z + nb.max.z) / 2);
    expect(tb.max.y - t.heightAt(0, 80)).toBeGreaterThan(28);
    // Each nave half's proxy circle stays near its walls (the reason the nave is split).
    for (const h of halves) {
      const b = bounds(worldPoints(h));
      expect(Math.max(b.max.x - b.min.x, b.max.z - b.min.z)).toBeLessThan(12);
    }
  });

  it('wind turbine: balanced head on the tower top, rotor clear of the tower, fixed per instance', () => {
    for (const height of [flat(5), inclinedPlane(0.12)]) {
      const specs = specsOf('windTurbine', { scale: 1.4 }, height);
      const [tower] = specs.filter((s) => s.anchored);
      const [head] = byPart(specs, 'deck');
      // The head's origin is the nacelle floor, which sits exactly on the tower top...
      expect(head.position.y).toBeCloseTo(bounds(worldPoints(tower)).max.y, 5);
      const off = Math.hypot(head.position.x - tower.position.x, head.position.z - tower.position.z);
      expect(off).toBeLessThan(1e-6);
      // ...and its centre of mass is over the 2.3 m top (it stays put if woken).
      const m = head.parts.reduce((a, p) => a + p.mass, 0);
      const cz = head.parts.reduce((a, p) => a + p.mass * p.offset.z, 0) / m;
      const cx = head.parts.reduce((a, p) => a + p.mass * p.offset.x, 0) / m;
      expect(Math.hypot(cx, cz)).toBeLessThan(0.8 * 1.4);
    }
    const a = byPart(specsOf('windTurbine', {}, flat(5), 1), 'deck')[0];
    const b = byPart(specsOf('windTurbine', {}, flat(5), 2), 'deck')[0];
    const blades = (s: BodySpec): BodySpec['parts'] => s.parts.filter((p) => p.name === 'blade');
    expect(blades(a).length).toBe(3);
    const angles = (s: BodySpec): string => JSON.stringify(blades(s).map((p) => p.rotation));
    expect(angles(a)).not.toBe(angles(b));
    // Every blade vertex is in front of the tower (body frame: tower axis at x = z = 0, r < 2).
    for (const part of blades(a)) {
      _p.set(part.rotation.x, part.rotation.y, part.rotation.z, part.rotation.w);
      const pts = scaledPoints(getGeom(part.geom), part.scale);
      for (let i = 0; i < pts.length; i += 3) {
        _v.set(pts[i], pts[i + 1], pts[i + 2]).applyQuaternion(_p);
        expect(_v.z + part.offset.z).toBeGreaterThan(2.4);
      }
    }
    // The tower uproots about a hit high up (its centre of percussion), so it pivots on its foot.
    const [tower] = specsOf('windTurbine').filter((s) => s.anchored);
    expect(tower.hitHeight).toBeGreaterThan(20);
    expect(tower.hitHeight).toBeLessThan(30);
  });

  it('pylon: arms across the valley at yaw 0, lattice as decor on six colliders', () => {
    const [p] = specsOf('pylon');
    const arms = p.parts.filter((q) => q.name === 'arm');
    expect(arms.length).toBe(2);
    expect(arms[0].scale.x).toBeGreaterThan(12);
    expect(p.parts.filter((q) => q.decor).length).toBeGreaterThan(50);
    expect(new Set(p.parts.map((q) => q.geom)).size).toBeLessThanOrEqual(2);
    const b = bounds(worldPoints(p));
    // Course runs along +z: the arms span x.
    expect(b.max.x - b.min.x).toBeGreaterThan(12);
    expect(b.max.z - b.min.z).toBeLessThan(6);
  });

  it('tall uprooting bodies are hit at their centre of percussion (about 2/3 of their height)', () => {
    for (const kind of ['lighthouse', 'smokestack', 'windTurbine', 'pylon'] as const) {
      const [s] = specsOf(kind).filter((q) => q.anchored);
      const top = bounds(worldPoints(s)).max.y - 5;
      expect(s.hitHeight / top, kind).toBeGreaterThan(0.45);
      expect(s.hitHeight / top, kind).toBeLessThan(0.75);
    }
    const [tower] = byPart(specsOf('church'), 'churchTower');
    expect(tower.hitHeight).toBeGreaterThan(10);
  });
});
